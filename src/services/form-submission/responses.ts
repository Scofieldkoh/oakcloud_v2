/**
 * Staff views of form responses and drafts: listing, detail, tags, review
 * status and deletion.
 */

import { Prisma, type FormSubmission } from '@/generated/prisma';
import { createAuditLog } from '@/lib/audit';
import {
  RESPONSE_COLUMN_STATUS_ID,
  RESPONSE_COLUMN_SUBMITTED_ID,
  parseFormResponseReviewStatus,
  parseObject,
  toAnswerRecord,
  type FormResponseReviewStatus,
} from '@/lib/form-utils';
import { prisma } from '@/lib/prisma';
import type { TenantAwareParams } from '@/lib/types';
import { sanitizeDraftMetadataForClient } from '@/services/form-draft.service';
import {
  RESPONSE_ATTACHMENTS_COLUMN_ID,
  RESPONSE_TAGS_COLUMN_ID,
  normalizeFormResponseTags,
  getFormResponseTags,
  getSubmissionColumnFilterText,
  compareSubmissionRows,
  removeUploadFromAnswerRecord,
  deleteStoredUploads,
} from './shared';
import {
  type FormResponseAttachmentListItem,
  type FormResponseDetailResult,
  type FormDraftDetailResult,
  type DeleteFormResponseResult,
  type DeleteFormResponseUploadResult,
  type RecentFormSubmissionItem,
  type FormResponsesQueryInput,
  type UpdateFormResponseTagsResult,
  type UpdateFormResponseReviewStatusResult,
  type FormResponsesResult,
} from './types';

export async function getFormResponses(
  formId: string,
  tenantId: string,
  page: number,
  limit: number,
  draftPage: number = 1,
  draftLimit: number = 20,
  query: FormResponsesQueryInput = {}
): Promise<FormResponsesResult> {
  const form = await prisma.form.findFirst({
    where: {
      id: formId,
      tenantId,
      OR: [{ deletedAt: null }, { status: 'ARCHIVED' }],
    },
    select: {
      id: true,
      fields: {
        select: {
          key: true,
          type: true,
        },
      },
    },
  });

  if (!form) {
    throw new Error('Form not found');
  }

  const activeDraftWhere = {
    formId,
    tenantId,
    expiresAt: {
      gt: new Date(),
    },
  } satisfies Prisma.FormDraftWhereInput;

  const fieldTypeByKey = new Map(form.fields.map((field) => [field.key, field.type]));
  const validSubmissionColumnIds = new Set<string>([
    RESPONSE_COLUMN_SUBMITTED_ID,
    RESPONSE_COLUMN_STATUS_ID,
    RESPONSE_ATTACHMENTS_COLUMN_ID,
    RESPONSE_TAGS_COLUMN_ID,
    ...form.fields.map((field) => field.key),
  ]);
  const submissionSortBy = query.submissionSortBy && validSubmissionColumnIds.has(query.submissionSortBy)
    ? query.submissionSortBy
    : RESPONSE_COLUMN_SUBMITTED_ID;
  const submissionSortOrder = query.submissionSortOrder === 'asc' ? 'asc' : 'desc';
  const normalizedSubmissionFilters = Object.entries(query.submissionFilters || {})
    .map(([columnId, value]) => [columnId, value.trim().toLowerCase()] as const)
    .filter(([columnId, value]) => validSubmissionColumnIds.has(columnId) && value.length > 0);

  // Max rows to scan in memory for filtered/custom-sorted queries (prevents OOM on large forms)
  const IN_MEMORY_SCAN_LIMIT = 5000;

  const submissionBaseWhere = { formId, tenantId, deletedAt: null } satisfies Prisma.FormSubmissionWhereInput;
  const submissionInclude = { _count: { select: { uploads: true } } } as const;

  // Fast path: no filters and sorting by submit date — use DB-level pagination
  const useDbPagination = normalizedSubmissionFilters.length === 0
    && submissionSortBy === RESPONSE_COLUMN_SUBMITTED_ID;

  let paginatedSubmissions: (FormSubmission & { _count: { uploads: number } })[];
  let total: number;

  if (useDbPagination) {
    const [pagedRows, submissionCount, recentSubmissions, drafts, draftTotal] = await Promise.all([
      prisma.formSubmission.findMany({
        where: submissionBaseWhere,
        include: submissionInclude,
        orderBy: { submittedAt: submissionSortOrder },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.formSubmission.count({ where: submissionBaseWhere }),
      prisma.formSubmission.findMany({
        where: {
          ...submissionBaseWhere,
          submittedAt: { gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) },
        },
        select: { submittedAt: true },
      }),
      prisma.formDraft.findMany({
        where: activeDraftWhere,
        orderBy: { lastSavedAt: 'desc' },
        skip: (draftPage - 1) * draftLimit,
        take: draftLimit,
        select: {
          id: true,
          code: true,
          answers: true,
          metadata: true,
          expiresAt: true,
          lastSavedAt: true,
          createdAt: true,
          _count: { select: { uploads: true } },
        },
      }),
      prisma.formDraft.count({ where: activeDraftWhere }),
    ]);

    paginatedSubmissions = pagedRows;
    total = submissionCount;

    const submissionIds = paginatedSubmissions.map((s) => s.id);
    const draftIds = drafts.map((d) => d.id);

    const [submissionUploads, draftUploads] = await Promise.all([
      submissionIds.length > 0
        ? prisma.formUpload.findMany({
          where: { formId, tenantId, submissionId: { in: submissionIds } },
          select: { id: true, submissionId: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        })
        : Promise.resolve([]),
      draftIds.length > 0
        ? prisma.formUpload.findMany({
          where: { formId, tenantId, draftId: { in: draftIds }, submissionId: null },
          select: { id: true, draftId: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        })
        : Promise.resolve([]),
    ]);

    const submissionAttachmentsById = new Map<string, FormResponseAttachmentListItem[]>();
    for (const upload of submissionUploads) {
      if (!upload.submissionId) continue;
      const list = submissionAttachmentsById.get(upload.submissionId) ?? [];
      list.push({ id: upload.id, fileName: upload.fileName, mimeType: upload.mimeType, sizeBytes: upload.sizeBytes, createdAt: upload.createdAt });
      submissionAttachmentsById.set(upload.submissionId, list);
    }

    const draftAttachmentsById = new Map<string, FormResponseAttachmentListItem[]>();
    for (const upload of draftUploads) {
      if (!upload.draftId) continue;
      const list = draftAttachmentsById.get(upload.draftId) ?? [];
      list.push({ id: upload.id, fileName: upload.fileName, mimeType: upload.mimeType, sizeBytes: upload.sizeBytes, createdAt: upload.createdAt });
      draftAttachmentsById.set(upload.draftId, list);
    }

    const today = new Date();
    const chartMap = new Map<string, number>();
    for (let i = 13; i >= 0; i -= 1) {
      const date = new Date(today);
      date.setDate(today.getDate() - i);
      chartMap.set(date.toISOString().slice(0, 10), 0);
    }
    for (const row of recentSubmissions) {
      const key = row.submittedAt.toISOString().slice(0, 10);
      chartMap.set(key, (chartMap.get(key) ?? 0) + 1);
    }

    return {
      submissions: paginatedSubmissions.map((submission) => {
        const { _count, ...submissionData } = submission;
        return { ...submissionData, uploadCount: _count.uploads, attachments: submissionAttachmentsById.get(submission.id) ?? [] };
      }),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      drafts: drafts.map((draft) => ({
        id: draft.id,
        code: draft.code,
        answers: toAnswerRecord(draft.answers),
        metadata: sanitizeDraftMetadataForClient(draft.metadata),
        expiresAt: draft.expiresAt,
        lastSavedAt: draft.lastSavedAt,
        createdAt: draft.createdAt,
        uploadCount: draft._count.uploads,
        attachments: draftAttachmentsById.get(draft.id) ?? [],
      })),
      draftTotal,
      draftPage,
      draftLimit,
      draftTotalPages: Math.ceil(draftTotal / draftLimit),
      chart: Array.from(chartMap.entries()).map(([date, responses]) => ({ date, responses })),
    };
  }

  // Slow path: filtered or custom-sorted — load in memory with a scan limit
  const [allSubmissions, recentSubmissions, drafts, draftTotal] = await Promise.all([
    prisma.formSubmission.findMany({
      where: submissionBaseWhere,
      include: submissionInclude,
      take: IN_MEMORY_SCAN_LIMIT,
    }),
    prisma.formSubmission.findMany({
      where: {
        ...submissionBaseWhere,
        submittedAt: { gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) },
      },
      select: { submittedAt: true },
    }),
    prisma.formDraft.findMany({
      where: activeDraftWhere,
      orderBy: { lastSavedAt: 'desc' },
      skip: (draftPage - 1) * draftLimit,
      take: draftLimit,
      select: {
        id: true,
        code: true,
        answers: true,
        metadata: true,
        expiresAt: true,
        lastSavedAt: true,
        createdAt: true,
        _count: { select: { uploads: true } },
      },
    }),
    prisma.formDraft.count({ where: activeDraftWhere }),
  ]);

  const filteredSubmissions = normalizedSubmissionFilters.length === 0
    ? [...allSubmissions]
    : allSubmissions.filter((submission) => normalizedSubmissionFilters.every(([columnId, value]) => (
      getSubmissionColumnFilterText(submission, fieldTypeByKey, columnId).includes(value)
    )));

  filteredSubmissions.sort((left, right) => (
    compareSubmissionRows(left, right, fieldTypeByKey, submissionSortBy, submissionSortOrder)
  ));

  total = filteredSubmissions.length;
  paginatedSubmissions = filteredSubmissions.slice((page - 1) * limit, page * limit);

  const submissionIds = paginatedSubmissions.map((submission) => submission.id);
  const draftIds = drafts.map((draft) => draft.id);

  const [submissionUploads, draftUploads] = await Promise.all([
    submissionIds.length > 0
      ? prisma.formUpload.findMany({
        where: {
          formId,
          tenantId,
          submissionId: { in: submissionIds },
        },
        select: {
          id: true,
          submissionId: true,
          fileName: true,
          mimeType: true,
          sizeBytes: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      })
      : Promise.resolve([]),
    draftIds.length > 0
      ? prisma.formUpload.findMany({
        where: {
          formId,
          tenantId,
          draftId: { in: draftIds },
          submissionId: null,
        },
        select: {
          id: true,
          draftId: true,
          fileName: true,
          mimeType: true,
          sizeBytes: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      })
      : Promise.resolve([]),
  ]);

  const submissionAttachmentsById = new Map<string, FormResponseAttachmentListItem[]>();
  for (const upload of submissionUploads) {
    if (!upload.submissionId) continue;
    const list = submissionAttachmentsById.get(upload.submissionId) ?? [];
    list.push({
      id: upload.id,
      fileName: upload.fileName,
      mimeType: upload.mimeType,
      sizeBytes: upload.sizeBytes,
      createdAt: upload.createdAt,
    });
    submissionAttachmentsById.set(upload.submissionId, list);
  }

  const draftAttachmentsById = new Map<string, FormResponseAttachmentListItem[]>();
  for (const upload of draftUploads) {
    if (!upload.draftId) continue;
    const list = draftAttachmentsById.get(upload.draftId) ?? [];
    list.push({
      id: upload.id,
      fileName: upload.fileName,
      mimeType: upload.mimeType,
      sizeBytes: upload.sizeBytes,
      createdAt: upload.createdAt,
    });
    draftAttachmentsById.set(upload.draftId, list);
  }

  const today = new Date();
  const chartMap = new Map<string, number>();

  for (let i = 13; i >= 0; i -= 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    const key = date.toISOString().slice(0, 10);
    chartMap.set(key, 0);
  }

  for (const row of recentSubmissions) {
    const key = row.submittedAt.toISOString().slice(0, 10);
    chartMap.set(key, (chartMap.get(key) ?? 0) + 1);
  }

  return {
    submissions: paginatedSubmissions.map((submission) => {
      const attachments = submissionAttachmentsById.get(submission.id) ?? [];
      const { _count, ...submissionData } = submission;
      return {
        ...submissionData,
        uploadCount: _count.uploads,
        attachments,
      };
    }),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    drafts: drafts.map((draft) => ({
      id: draft.id,
      code: draft.code,
      answers: toAnswerRecord(draft.answers),
      metadata: sanitizeDraftMetadataForClient(draft.metadata),
      expiresAt: draft.expiresAt,
      lastSavedAt: draft.lastSavedAt,
      createdAt: draft.createdAt,
      uploadCount: draft._count.uploads,
      attachments: draftAttachmentsById.get(draft.id) ?? [],
    })),
    draftTotal,
    draftPage,
    draftLimit,
    draftTotalPages: Math.ceil(draftTotal / draftLimit),
    chart: Array.from(chartMap.entries()).map(([date, responses]) => ({ date, responses })),
  };
}

export async function getFormResponseById(
  formId: string,
  submissionId: string,
  tenantId: string
): Promise<FormResponseDetailResult> {
  const submission = await prisma.formSubmission.findFirst({
    where: {
      id: submissionId,
      formId,
      tenantId,
      deletedAt: null,
    },
  });

  if (!submission) {
    throw new Error('Submission not found');
  }

  const uploads = await prisma.formUpload.findMany({
    where: {
      formId,
      submissionId,
      tenantId,
    },
    orderBy: { createdAt: 'asc' },
  });

  return { submission, uploads };
}

export async function updateFormResponseTags(
  formId: string,
  submissionId: string,
  tags: string[],
  params: TenantAwareParams
): Promise<UpdateFormResponseTagsResult> {
  const submission = await prisma.formSubmission.findFirst({
    where: {
      id: submissionId,
      formId,
      tenantId: params.tenantId,
      deletedAt: null,
    },
    include: {
      form: {
        select: {
          title: true,
        },
      },
    },
  });

  if (!submission) {
    throw new Error('Submission not found');
  }

  const normalizedTags = normalizeFormResponseTags(tags);
  const previousTags = getFormResponseTags(submission.metadata);
  const nextMetadata = parseObject(submission.metadata)
    ? { ...(submission.metadata as Record<string, unknown>) }
    : {};

  if (normalizedTags.length > 0) {
    nextMetadata.responseTags = normalizedTags;
  } else {
    delete nextMetadata.responseTags;
  }

  await prisma.formSubmission.update({
    where: { id: submission.id },
    data: {
      metadata: Object.keys(nextMetadata).length > 0
        ? nextMetadata as Prisma.InputJsonValue
        : Prisma.NullableJsonNullValueInput.JsonNull,
    },
  });

  await createAuditLog({
    tenantId: params.tenantId,
    userId: params.userId,
    action: 'UPDATE',
    entityType: 'FormSubmission',
    entityId: submission.id,
    entityName: submission.respondentName || submission.respondentEmail || submission.id,
    summary: `Updated tags for response ${submission.id} on "${submission.form.title}"`,
    changeSource: 'MANUAL',
    metadata: {
      event: 'form_response_tags_updated',
      formId,
      previousTags,
      tags: normalizedTags,
    },
  });

  return {
    id: submission.id,
    tags: normalizedTags,
  };
}

export async function updateFormResponseReviewStatus(
  formId: string,
  submissionId: string,
  reviewStatus: FormResponseReviewStatus,
  params: TenantAwareParams
): Promise<UpdateFormResponseReviewStatusResult> {
  const submission = await prisma.formSubmission.findFirst({
    where: {
      id: submissionId,
      formId,
      tenantId: params.tenantId,
      deletedAt: null,
    },
    include: {
      form: {
        select: {
          title: true,
        },
      },
    },
  });

  if (!submission) {
    throw new Error('Submission not found');
  }

  const previousReviewStatus = parseFormResponseReviewStatus(submission.metadata);
  const nextMetadata = parseObject(submission.metadata)
    ? { ...(submission.metadata as Record<string, unknown>) }
    : {};

  if (reviewStatus === 'new') {
    delete nextMetadata.responseReviewStatus;
  } else {
    nextMetadata.responseReviewStatus = reviewStatus;
  }

  await prisma.formSubmission.update({
    where: { id: submission.id },
    data: {
      metadata: Object.keys(nextMetadata).length > 0
        ? nextMetadata as Prisma.InputJsonValue
        : Prisma.NullableJsonNullValueInput.JsonNull,
    },
  });

  await createAuditLog({
    tenantId: params.tenantId,
    userId: params.userId,
    action: 'UPDATE',
    entityType: 'FormSubmission',
    entityId: submission.id,
    entityName: submission.respondentName || submission.respondentEmail || submission.id,
    summary: `Updated review status for response ${submission.id} on "${submission.form.title}"`,
    changeSource: 'MANUAL',
    metadata: {
      event: 'form_response_review_status_updated',
      formId,
      previousReviewStatus,
      reviewStatus,
    },
  });

  return {
    id: submission.id,
    reviewStatus,
  };
}

export async function getFormDraftById(
  formId: string,
  draftId: string,
  tenantId: string
): Promise<FormDraftDetailResult> {
  const draft = await prisma.formDraft.findFirst({
    where: {
      id: draftId,
      formId,
      tenantId,
    },
    select: {
      id: true,
      code: true,
      answers: true,
      metadata: true,
      expiresAt: true,
      lastSavedAt: true,
      createdAt: true,
      _count: {
        select: {
          uploads: true,
        },
      },
    },
  });

  if (!draft) {
    throw new Error('Draft not found');
  }

  const uploads = await prisma.formUpload.findMany({
    where: {
      formId,
      draftId,
      submissionId: null,
      tenantId,
    },
    orderBy: { createdAt: 'asc' },
  });

  return {
    draft: {
      id: draft.id,
      code: draft.code,
      answers: toAnswerRecord(draft.answers),
      metadata: sanitizeDraftMetadataForClient(draft.metadata),
      expiresAt: draft.expiresAt,
      lastSavedAt: draft.lastSavedAt,
      createdAt: draft.createdAt,
      uploadCount: draft._count.uploads,
      attachments: uploads.map((upload) => ({
        id: upload.id,
        fileName: upload.fileName,
        mimeType: upload.mimeType,
        sizeBytes: upload.sizeBytes,
        createdAt: upload.createdAt,
      })),
    },
    uploads,
  };
}

export async function reconcileFormSubmissionCounts(): Promise<{ reconciled: number }> {
  const result = await prisma.$executeRaw`
    UPDATE forms
    SET submissions_count = (
      SELECT COUNT(*)::int
      FROM form_submissions
      WHERE form_submissions.form_id = forms.id
    )
    WHERE deleted_at IS NULL
  `;
  return { reconciled: result };
}

export async function deleteFormResponse(
  formId: string,
  submissionId: string,
  params: TenantAwareParams,
  reason?: string
): Promise<DeleteFormResponseResult> {
  const form = await prisma.form.findFirst({
    where: {
      id: formId,
      tenantId: params.tenantId,
      deletedAt: null,
    },
    select: {
      id: true,
      title: true,
    },
  });

  if (!form) {
    throw new Error('Form not found');
  }

  const submission = await prisma.formSubmission.findFirst({
    where: {
      id: submissionId,
      formId,
      tenantId: params.tenantId,
      deletedAt: null,
    },
    select: {
      id: true,
      respondentName: true,
      respondentEmail: true,
    },
  });

  if (!submission) {
    throw new Error('Submission not found');
  }

  const uploads = await prisma.formUpload.findMany({
    where: {
      formId,
      submissionId,
      tenantId: params.tenantId,
    },
    select: {
      id: true,
      storageKey: true,
    },
  });

  await prisma.$transaction(async (tx) => {
    if (uploads.length > 0) {
      await tx.formUpload.deleteMany({
        where: {
          id: { in: uploads.map((upload) => upload.id) },
        },
      });
    }

    await tx.formSubmission.update({
      where: { id: submission.id },
      data: { deletedAt: new Date() },
    });

    await tx.form.update({
      where: { id: form.id },
      data: {
        submissionsCount: { decrement: 1 },
      },
    });
  });

  await deleteStoredUploads(uploads, { formId, submissionId });

  await createAuditLog({
    tenantId: params.tenantId,
    userId: params.userId,
    action: 'DELETE',
    entityType: 'FormSubmission',
    entityId: submission.id,
    entityName: submission.respondentName || submission.respondentEmail || submission.id,
    summary: `Deleted response ${submission.id} from "${form.title}"`,
    reason,
    changeSource: 'MANUAL',
  });

  return {
    id: submission.id,
    deletedUploadCount: uploads.length,
  };
}

export async function deleteFormResponseUpload(
  formId: string,
  submissionId: string,
  uploadId: string,
  params: TenantAwareParams,
  reason?: string
): Promise<DeleteFormResponseUploadResult> {
  const form = await prisma.form.findFirst({
    where: {
      id: formId,
      tenantId: params.tenantId,
      deletedAt: null,
    },
    select: {
      id: true,
      title: true,
    },
  });

  if (!form) {
    throw new Error('Form not found');
  }

  const submission = await prisma.formSubmission.findFirst({
    where: {
      id: submissionId,
      formId,
      tenantId: params.tenantId,
      deletedAt: null,
    },
    select: {
      id: true,
      answers: true,
    },
  });

  if (!submission) {
    throw new Error('Submission not found');
  }

  const upload = await prisma.formUpload.findFirst({
    where: {
      id: uploadId,
      formId,
      submissionId,
      tenantId: params.tenantId,
    },
    select: {
      id: true,
      fieldId: true,
      storageKey: true,
      fileName: true,
    },
  });

  if (!upload) {
    throw new Error('Upload not found');
  }

  const field = upload.fieldId
    ? await prisma.formField.findFirst({
      where: {
        id: upload.fieldId,
        formId,
        tenantId: params.tenantId,
      },
      select: {
        key: true,
      },
    })
    : null;

  const nextAnswers = removeUploadFromAnswerRecord(
    toAnswerRecord(submission.answers),
    upload.id,
    field?.key
  );

  await prisma.$transaction(async (tx) => {
    await tx.formSubmission.update({
      where: { id: submission.id },
      data: {
        answers: nextAnswers as Prisma.InputJsonValue,
      },
    });

    await tx.formUpload.delete({
      where: { id: upload.id },
    });
  });

  await deleteStoredUploads([{ id: upload.id, storageKey: upload.storageKey }], { formId, submissionId });

  await createAuditLog({
    tenantId: params.tenantId,
    userId: params.userId,
    action: 'DELETE',
    entityType: 'FormUpload',
    entityId: upload.id,
    entityName: upload.fileName,
    summary: `Deleted attachment "${upload.fileName}" from response ${submission.id} for "${form.title}"`,
    reason,
    changeSource: 'MANUAL',
  });

  return {
    id: upload.id,
    submissionId: submission.id,
  };
}

export async function listRecentFormSubmissions(
  tenantId: string,
  limit: number = 10
): Promise<RecentFormSubmissionItem[]> {
  const take = Math.min(50, Math.max(1, limit));

  const submissions = await prisma.formSubmission.findMany({
    where: {
      tenantId,
      deletedAt: null,
      form: {
        deletedAt: null,
      },
    },
    include: {
      form: {
        select: {
          id: true,
          title: true,
          slug: true,
          status: true,
        },
      },
    },
    orderBy: {
      submittedAt: 'desc',
    },
    take,
  });

  return submissions.map((submission) => ({
    id: submission.id,
    formId: submission.formId,
    formTitle: submission.form.title,
    formSlug: submission.form.slug,
    formStatus: submission.form.status,
    submittedAt: submission.submittedAt,
    respondentName: submission.respondentName,
    respondentEmail: submission.respondentEmail,
    status: submission.status,
  }));
}
