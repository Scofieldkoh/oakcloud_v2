/**
 * Public form access: form lookup by slug, uploads, submission and orphaned
 * upload cleanup.
 */

import { randomUUID } from 'crypto';
import {
  FormSubmissionStatus,
  Prisma,
  type FormSubmission,
  type FormUpload,
} from '@/generated/prisma';
import { fileTypeFromBuffer } from 'file-type';
import { createAuditLog } from '@/lib/audit';
import {
  buildPublicFormSettings,
  parseFormAiSettings,
  parseObject,
  pruneHiddenConditionalAnswers,
  toAnswerRecord,
  type PublicFormDefinition,
} from '@/lib/form-utils';
import { prisma } from '@/lib/prisma';
import { resolvePresetOptionsForFields } from '@/services/form-option-preset.service';
import { storage, StorageKeys } from '@/lib/storage';
import { incrementViewCount } from '@/lib/view-count-buffer';
import { normalizeWorkspaceLogoUrl } from '@/lib/workspace-logo-url';
import type { PublicSubmissionInput } from '@/lib/validations/form-builder';
import { applyDefaultTodayAnswers, getTenantTimeZone, toJsonInput } from '@/services/form-builder.helpers';
import { resolveSubmissionUploadFileNames } from '@/services/form-pdf.service';
import { loadDraftByAccess } from '@/services/form-draft.service';
import {
  evaluateCompanyIncorporationSubmission,
  recheckAdvisoryCompanyNames,
} from '@/services/company-incorporation-intake.service';
import { UPLOAD_ID_PATTERN, collectUploadIdsFromAnswer } from './shared';
import {
  withSubmissionAiReview,
  normalizeUploadIds,
  validatePublicAnswerConstraints,
  hasActiveProgressStopInfoBlock,
  validateRequiredPublicAnswers,
  sanitizePublicAnswers,
  validateCompanyNameCheckResults,
  sanitizeSubmissionMetadata,
} from './validation';
import { sendCompletionNotificationEmailInternal } from './notifications';

export async function getPublicFormBySlug(slug: string): Promise<PublicFormDefinition | null> {
  const form = await prisma.form.findFirst({
    where: {
      slug,
      status: 'PUBLISHED',
      deletedAt: null,
    },
    include: {
      fields: {
        orderBy: { position: 'asc' },
      },
      tenant: {
        select: { logoUrl: true, name: true },
      },
    },
  });

  if (!form) {
    return null;
  }

  form.fields = await resolvePresetOptionsForFields(form.tenantId, form.fields);

  incrementViewCount(form.id);

  return {
    id: form.id,
    slug: form.slug,
    title: form.title,
    description: form.description,
    settings: buildPublicFormSettings(form.settings),
    fields: form.fields,
    tenantLogoUrl: normalizeWorkspaceLogoUrl(form.tenant?.logoUrl),
    tenantName: form.tenant?.name ?? null,
  };
}

export async function createPublicUpload(
  slug: string,
  fieldKey: string,
  file: File
): Promise<FormUpload> {
  const form = await prisma.form.findFirst({
    where: {
      slug,
      status: 'PUBLISHED',
      deletedAt: null,
    },
    include: {
      fields: {
        where: { key: fieldKey, type: 'FILE_UPLOAD' },
        take: 1,
      },
    },
  });

  if (!form) {
    throw new Error('Form not found');
  }

  const field = form.fields[0];
  if (!field) {
    throw new Error('Upload field not found');
  }

  const validation = parseObject(field.validation);
  const maxFileSizeMb = typeof validation?.maxFileSizeMb === 'number' ? validation.maxFileSizeMb : 50;
  const allowedMimeTypes = Array.isArray(validation?.allowedMimeTypes)
    ? validation.allowedMimeTypes.filter((v): v is string => typeof v === 'string')
    : [];

  const maxBytes = maxFileSizeMb * 1024 * 1024;
  if (file.size > maxBytes) {
    throw new Error(`File exceeds ${maxFileSizeMb} MB limit`);
  }

  const extension = StorageKeys.getExtension(file.name, file.type);
  const uploadId = randomUUID();
  const storageKey = `${form.tenantId}/forms/${form.id}/uploads/${uploadId}${extension}`;
  const content = Buffer.from(await file.arrayBuffer());

  const detected = await fileTypeFromBuffer(content);
  const actualMime = detected?.mime || file.type || 'application/octet-stream';

  if (allowedMimeTypes.length > 0 && !allowedMimeTypes.includes(actualMime)) {
    throw new Error('File type is not allowed');
  }

  await storage.upload(storageKey, content, {
    contentType: actualMime,
    metadata: {
      formId: form.id,
      fieldId: field.id,
      fieldKey: field.key,
      uploadId,
      originalName: file.name,
    },
  });

  return prisma.formUpload.create({
    data: {
      id: uploadId,
      tenantId: form.tenantId,
      formId: form.id,
      fieldId: field.id,
      storageKey,
      fileName: file.name,
      originalFileName: file.name,
      mimeType: actualMime,
      sizeBytes: file.size,
    },
  });
}

export async function createPublicSubmission(
  slug: string,
  input: PublicSubmissionInput
): Promise<FormSubmission> {
  const form = await prisma.form.findFirst({
    where: {
      slug,
      status: 'PUBLISHED',
      deletedAt: null,
    },
    include: {
      fields: {
        orderBy: { position: 'asc' },
      },
    },
  });

  if (!form) {
    throw new Error('Form not found');
  }

  form.fields = await resolvePresetOptionsForFields(form.tenantId, form.fields);

  if ((input.draftCode && !input.accessToken) || (!input.draftCode && input.accessToken)) {
    throw new Error('Draft access is incomplete');
  }

  const tenantTimeZone = await getTenantTimeZone(form.tenantId);
  const answers = pruneHiddenConditionalAnswers(
    form.fields,
    applyDefaultTodayAnswers(form.fields, toAnswerRecord(input.answers))
  );
  const referencedUploadIdSet = new Set(
    form.fields
      .filter((field) => field.type === 'FILE_UPLOAD')
      .flatMap((field) => collectUploadIdsFromAnswer(answers[field.key]))
      .filter((id) => UPLOAD_ID_PATTERN.test(id))
  );
  const uploadIds = normalizeUploadIds(input.uploadIds).filter((id) => referencedUploadIdSet.has(id));
  const uploadIdSet = new Set(uploadIds);

  if (hasActiveProgressStopInfoBlock(form.fields, answers)) {
    throw new Error('This response cannot be submitted because a stopping information block is active.');
  }

  validateRequiredPublicAnswers(form.fields, answers, uploadIdSet);
  validatePublicAnswerConstraints(form.fields, answers);
  validateCompanyNameCheckResults(form.fields, answers, input.metadata);

  const sanitizedAnswers = sanitizePublicAnswers(form.fields, answers, uploadIdSet);
  // Bounded server recheck for advisory name checks, before any transaction opens.
  const serverNameChecks = await recheckAdvisoryCompanyNames(form.fields, sanitizedAnswers);
  const companyIncorporation = evaluateCompanyIncorporationSubmission({
    settings: form.settings,
    fields: form.fields,
    answers: sanitizedAnswers,
    nameChecks: serverNameChecks,
  });
  const sanitizedMetadata = sanitizeSubmissionMetadata(input.metadata, form.fields, sanitizedAnswers, serverNameChecks);
  if (companyIncorporation) {
    sanitizedMetadata.companyIncorporation = companyIncorporation;
  }
  const fieldById = new Map(form.fields.map((field) => [field.id, { key: field.key, validation: field.validation }]));
  const renamedUploadsById = new Map<string, string>();

  const activeDraft = input.draftCode && input.accessToken
    ? await loadDraftByAccess({
      formId: form.id,
      tenantId: form.tenantId,
      draftCode: input.draftCode,
      accessToken: input.accessToken,
    })
    : null;

  if (input.draftCode && input.accessToken && !activeDraft) {
    throw new Error('Draft not found');
  }

  const submissionResult = await prisma.$transaction(async (tx) => {
    let pendingUploads: Array<Pick<FormUpload, 'id' | 'fieldId' | 'fileName' | 'mimeType'>> = [];

    if (uploadIds.length > 0) {
      pendingUploads = await tx.formUpload.findMany({
        where: {
          id: { in: uploadIds },
          formId: form.id,
          tenantId: form.tenantId,
          submissionId: null,
          ...(activeDraft
            ? {
              OR: [
                { draftId: null },
                { draftId: activeDraft.id },
              ],
            }
            : { draftId: null }),
        },
        select: {
          id: true,
          fieldId: true,
          fileName: true,
          mimeType: true,
        },
        orderBy: { createdAt: 'asc' },
      });

      if (pendingUploads.length !== uploadIds.length) {
        throw new Error('Some uploaded files are invalid or already used');
      }
    }

    const obsoleteDraftUploads = activeDraft
      ? await tx.formUpload.findMany({
        where: {
          formId: form.id,
          tenantId: form.tenantId,
          draftId: activeDraft.id,
          submissionId: null,
          ...(uploadIds.length > 0 ? { id: { notIn: uploadIds } } : {}),
        },
        select: {
          storageKey: true,
        },
      })
      : [];

    const submission = await tx.formSubmission.create({
      data: {
        formId: form.id,
        tenantId: form.tenantId,
        status: FormSubmissionStatus.COMPLETED,
        respondentName: input.respondentName?.trim() || null,
        respondentEmail: input.respondentEmail?.trim() || null,
        answers: sanitizedAnswers as Prisma.InputJsonValue,
        metadata: toJsonInput(sanitizedMetadata),
      },
    });

    if (pendingUploads.length > 0) {
      await tx.formUpload.updateMany({
        where: {
          id: { in: pendingUploads.map((upload) => upload.id) },
          formId: form.id,
          tenantId: form.tenantId,
          submissionId: null,
        },
        data: {
          submissionId: submission.id,
          draftId: null,
        },
      });

      const resolvedUploadFileNames = resolveSubmissionUploadFileNames({
        formTitle: form.title,
        formSlug: form.slug,
        submissionId: submission.id,
        submittedAt: submission.submittedAt,
        timeZone: tenantTimeZone,
        answers: sanitizedAnswers,
        uploads: pendingUploads,
        fieldById,
      });

      for (const [uploadId, fileName] of resolvedUploadFileNames.entries()) {
        renamedUploadsById.set(uploadId, fileName);
      }

      for (const upload of pendingUploads) {
        const nextFileName = resolvedUploadFileNames.get(upload.id);
        if (!nextFileName || nextFileName === upload.fileName) continue;

        await tx.formUpload.update({
          where: { id: upload.id },
          data: { fileName: nextFileName },
        });
      }
    }

    await tx.form.update({
      where: { id: form.id },
      data: {
        submissionsCount: { increment: 1 },
      },
    });

    if (activeDraft) {
      await tx.formDraft.delete({
        where: { id: activeDraft.id },
      });
    }

    return {
      submission,
      obsoleteDraftUploads,
    };
  });

  if (submissionResult.obsoleteDraftUploads.length > 0) {
    await Promise.allSettled(
      submissionResult.obsoleteDraftUploads.map((upload) => storage.delete(upload.storageKey))
    );
  }

  await createAuditLog({
    tenantId: form.tenantId,
    action: 'CREATE',
    entityType: 'FormSubmission',
    entityId: submissionResult.submission.id,
    entityName: submissionResult.submission.respondentName
      || submissionResult.submission.respondentEmail
      || submissionResult.submission.id,
    summary: `Submitted public form "${form.title}"`,
    changeSource: 'SYSTEM',
    metadata: {
      event: 'public_form_submitted',
      formId: form.id,
      formSlug: form.slug,
      formTitle: form.title,
      submissionId: submissionResult.submission.id,
      respondentName: submissionResult.submission.respondentName,
      respondentEmail: submissionResult.submission.respondentEmail,
      draftId: activeDraft?.id ?? null,
      draftCode: activeDraft?.code ?? input.draftCode ?? null,
      uploadCount: uploadIds.length,
    },
  }).catch((error) => {
    console.error('Failed to create public form submission audit log', error);
  });

  const submissionUploads = await prisma.formUpload.findMany({
    where: {
      formId: form.id,
      submissionId: submissionResult.submission.id,
      tenantId: form.tenantId,
    },
    orderBy: { createdAt: 'asc' },
  });
  const emailUploads = submissionUploads.map((upload) => {
    const renamedFileName = renamedUploadsById.get(upload.id);
    if (!renamedFileName || renamedFileName === upload.fileName) return upload;
    return {
      ...upload,
      fileName: renamedFileName,
    };
  });
  const aiSettings = parseFormAiSettings(form.settings);

  if (aiSettings.enabled) {
    const { queueFormSubmissionAiReviewInternal, triggerQueuedFormAiReviewProcessing } =
      await import('@/services/form-ai.task.service');

    const queuedReviewResult = await queueFormSubmissionAiReviewInternal({
      formId: form.id,
      submissionId: submissionResult.submission.id,
      tenantId: form.tenantId,
      emailNotificationPending: true,
    });

    const queuedMetadata = withSubmissionAiReview(
      submissionResult.submission.metadata,
      queuedReviewResult.aiReview
    );
    const queuedSubmission: FormSubmission = {
      ...submissionResult.submission,
      metadata: queuedMetadata as Prisma.JsonObject,
    };

    await triggerQueuedFormAiReviewProcessing([submissionResult.submission.id]);

    return queuedSubmission;
  }

  await sendCompletionNotificationEmailInternal({
    form,
    submission: submissionResult.submission,
    uploads: emailUploads,
    tenantTimeZone,
  });

  return submissionResult.submission;
}

export async function getSubmissionUploads(
  formId: string,
  submissionId: string,
  tenantId: string
): Promise<FormUpload[]> {
  const submission = await prisma.formSubmission.findFirst({
    where: {
      id: submissionId,
      formId,
      tenantId,
      deletedAt: null,
    },
    select: { id: true },
  });

  if (!submission) {
    throw new Error('Submission not found');
  }

  return prisma.formUpload.findMany({
    where: {
      formId,
      submissionId,
      tenantId,
    },
    orderBy: { createdAt: 'asc' },
  });
}

export async function getSubmissionUploadById(
  formId: string,
  submissionId: string,
  uploadId: string,
  tenantId: string
): Promise<FormUpload | null> {
  return prisma.formUpload.findFirst({
    where: {
      id: uploadId,
      formId,
      submissionId,
      tenantId,
    },
  });
}

export async function getDraftUploadById(
  formId: string,
  draftId: string,
  uploadId: string,
  tenantId: string
): Promise<FormUpload | null> {
  return prisma.formUpload.findFirst({
    where: {
      id: uploadId,
      formId,
      draftId,
      submissionId: null,
      tenantId,
    },
  });
}

export async function cleanupOrphanedUploads(maxAgeHours: number = 24): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);

  const orphans = await prisma.formUpload.findMany({
    where: {
      draftId: null,
      submissionId: null,
      createdAt: { lt: cutoff },
    },
    select: { id: true, storageKey: true },
  });

  if (orphans.length === 0) return 0;

  await Promise.allSettled(
    orphans.map((orphan) => storage.delete(orphan.storageKey))
  );

  await prisma.formUpload.deleteMany({
    where: {
      id: { in: orphans.map((o) => o.id) },
      submissionId: null,
    },
  });

  return orphans.length;
}

/** Exported for unit tests. */
