import {
  Prisma,
  type FormSubmission,
} from '@/generated/prisma';
import { createAuditLog } from '@/lib/audit';
import {
  parseFormAiSettings,
  parseFormSubmissionAiReview,
  parseObject,
  type FormSubmissionAiReview,
} from '@/lib/form-utils';
import { prisma } from '@/lib/prisma';
import { createLogger } from '@/lib/logger';
import { generateFormSubmissionAiReview } from '@/services/form-ai.service';
import type { TenantAwareParams } from '@/lib/types';
import { getDefaultModelId } from '@/lib/ai/models';
import { getTenantTimeZone, toJsonInput } from './form-builder.helpers';

export interface QueueFormSubmissionAiReviewResult {
  id: string;
  aiReview: FormSubmissionAiReview;
}

export interface ProcessQueuedFormSubmissionAiReviewsResult {
  processed: number;
  completed: number;
  failed: number;
  skipped: number;
}

export interface ResolveFormSubmissionAiWarningResult {
  id: string;
  aiReview: FormSubmissionAiReview;
}

export interface FormWarningListItem {
  formId: string;
  formTitle: string;
  formSlug: string;
  formStatus: import('@/generated/prisma').FormStatus;
  latestSubmissionId: string;
  latestSubmittedAt: Date;
  warningCount: number;
}

const log = createLogger('form-builder');

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function withSubmissionAiReview(
  metadata: unknown,
  aiReview: FormSubmissionAiReview | null
): Record<string, unknown> | null {
  const nextMetadata = parseObject(metadata) ? { ...(metadata as Record<string, unknown>) } : {};

  if (aiReview) {
    nextMetadata.aiReview = aiReview as unknown as Prisma.InputJsonValue;
  }

  return Object.keys(nextMetadata).length > 0 ? nextMetadata : null;
}

function buildQueuedSubmissionAiReview(input?: {
  existingReview?: FormSubmissionAiReview | null;
  emailNotificationPending?: boolean;
  requestedByUserId?: string | null;
}): FormSubmissionAiReview & { requestedByUserId?: string | null } {
  const now = new Date().toISOString();
  const existing = input?.existingReview ?? null;

  return {
    status: 'queued',
    reviewRequired: false,
    severity: null,
    summary: null,
    tags: [],
    sections: [],
    model: existing?.model || getDefaultModelId(),
    warningSignature: null,
    resolvedWarningSignature: existing?.resolvedWarningSignature ?? null,
    resolvedAt: existing?.resolvedAt ?? null,
    resolvedByUserId: existing?.resolvedByUserId ?? null,
    resolvedReason: existing?.resolvedReason ?? null,
    queuedAt: now,
    startedAt: null,
    processedAt: null,
    attachmentCount: 0,
    unsupportedAttachmentNames: [],
    omittedAttachmentNames: [],
    error: null,
    emailNotificationPending: input?.emailNotificationPending === true,
    ...(input?.requestedByUserId ? { requestedByUserId: input.requestedByUserId } : {}),
  };
}

function buildProcessingSubmissionAiReview(existingReview: FormSubmissionAiReview): FormSubmissionAiReview {
  return {
    ...existingReview,
    status: 'processing',
    startedAt: new Date().toISOString(),
    processedAt: null,
    error: null,
    tags: [],
    sections: [],
    summary: null,
    severity: null,
    reviewRequired: false,
    warningSignature: existingReview.warningSignature,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers (exported for use in submission service)
// ---------------------------------------------------------------------------

export async function queueFormSubmissionAiReviewInternal(input: {
  formId: string;
  submissionId: string;
  tenantId: string;
  requestedByUserId?: string | null;
  emailNotificationPending: boolean;
}): Promise<QueueFormSubmissionAiReviewResult> {
  const submissionWithForm = await prisma.formSubmission.findFirst({
    where: {
      id: input.submissionId,
      formId: input.formId,
      tenantId: input.tenantId,
      deletedAt: null,
    },
    include: {
      form: {
        select: {
          id: true,
          title: true,
          settings: true,
        },
      },
    },
  });

  if (!submissionWithForm) {
    throw new Error('Submission not found');
  }

  const aiSettings = parseFormAiSettings(submissionWithForm.form.settings);
  if (!aiSettings.enabled) {
    throw new Error('AI parsing is not enabled for this form');
  }

  const existingReview = parseFormSubmissionAiReview(submissionWithForm.metadata);
  const queuedReview = buildQueuedSubmissionAiReview({
    existingReview,
    emailNotificationPending: input.emailNotificationPending,
    requestedByUserId: input.requestedByUserId,
  });
  const metadataWithAiReview = withSubmissionAiReview(submissionWithForm.metadata, queuedReview);

  await prisma.formSubmission.update({
    where: { id: submissionWithForm.id },
    data: {
      metadata: toJsonInput(metadataWithAiReview),
      aiReviewStatus: queuedReview.status,
    },
  });

  return {
    id: submissionWithForm.id,
    aiReview: queuedReview,
  };
}

export async function triggerQueuedFormAiReviewProcessing(submissionIds: string[]): Promise<void> {
  if (submissionIds.length === 0) return;

  void processQueuedFormSubmissionAiReviews({
    submissionIds,
    limit: submissionIds.length,
  }).catch((error) => {
    log.error('Failed to trigger queued form AI review processing', {
      submissionIds,
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

export async function queueFormSubmissionAiReview(
  formId: string,
  submissionId: string,
  params: TenantAwareParams,
  reason?: string
): Promise<QueueFormSubmissionAiReviewResult> {
  const result = await queueFormSubmissionAiReviewInternal({
    formId,
    submissionId,
    tenantId: params.tenantId,
    requestedByUserId: params.userId,
    emailNotificationPending: false,
  });

  await createAuditLog({
    tenantId: params.tenantId,
    userId: params.userId,
    action: 'UPDATE',
    entityType: 'FormSubmission',
    entityId: submissionId,
    entityName: submissionId,
    summary: `Queued AI review for form response ${submissionId}`,
    reason,
    changeSource: 'MANUAL',
  });

  await triggerQueuedFormAiReviewProcessing([submissionId]);

  return result;
}

export async function processQueuedFormSubmissionAiReviews(input?: {
  limit?: number;
  submissionIds?: string[];
}): Promise<ProcessQueuedFormSubmissionAiReviewsResult> {
  const limit = Math.max(1, Math.min(input?.limit ?? 10, 50));
  const queuedSubmissions = await prisma.formSubmission.findMany({
    where: {
      ...(input?.submissionIds?.length ? { id: { in: input.submissionIds } } : {}),
      aiReviewStatus: 'queued',
      deletedAt: null,
      form: {
        deletedAt: null,
        settings: {
          path: ['aiParsing', 'enabled'],
          equals: true,
        },
      },
    },
    include: {
      form: {
        include: {
          fields: {
            orderBy: { position: 'asc' },
          },
        },
      },
      uploads: {
        orderBy: { createdAt: 'asc' },
      },
    },
    orderBy: { submittedAt: 'asc' },
    take: limit,
  });

  let processed = 0;
  let completed = 0;
  let failed = 0;
  let skipped = 0;

  for (const submission of queuedSubmissions) {
    const currentReview = parseFormSubmissionAiReview(submission.metadata);
    if (!currentReview || currentReview.status !== 'queued') {
      skipped += 1;
      continue;
    }

    const processingReview = buildProcessingSubmissionAiReview(currentReview);
    const processingMetadata = withSubmissionAiReview(submission.metadata, processingReview);
    const claimResult = await prisma.formSubmission.updateMany({
      where: {
        id: submission.id,
        aiReviewStatus: 'queued',
      },
      data: {
        metadata: toJsonInput(processingMetadata),
        aiReviewStatus: processingReview.status,
      },
    });

    if (claimResult.count === 0) {
      skipped += 1;
      continue;
    }

    processed += 1;

    const processingSubmission: FormSubmission = {
      ...submission,
      metadata: processingMetadata as Prisma.JsonObject,
    };
    const aiReview = await generateFormSubmissionAiReview({
      form: submission.form,
      submission: processingSubmission,
      uploads: submission.uploads,
    });

    if (!aiReview) {
      skipped += 1;
      continue;
    }

    const finalReview: FormSubmissionAiReview = {
      ...aiReview,
      emailNotificationPending: false,
    };
    const finalMetadata = withSubmissionAiReview(processingSubmission.metadata, finalReview);

    await prisma.formSubmission.update({
      where: { id: submission.id },
      data: {
        metadata: toJsonInput(finalMetadata),
        aiReviewStatus: finalReview.status,
        hasUnresolvedAiWarning: finalReview.status === 'completed' && !!finalReview.reviewRequired,
      },
    });

    if (currentReview.emailNotificationPending) {
      // Dynamic import to avoid circular: submission service imports from ai.task service,
      // and ai.task service needs sendCompletionNotificationEmail from submission service.
      const { sendCompletionNotificationEmailInternal } = await import('./form-submission.service') as {
        sendCompletionNotificationEmailInternal?: (input: {
          form: typeof submission.form;
          submission: FormSubmission;
          uploads: typeof submission.uploads;
          tenantTimeZone: string;
        }) => Promise<void>;
      };

      if (sendCompletionNotificationEmailInternal) {
        await sendCompletionNotificationEmailInternal({
          form: submission.form,
          submission: {
            ...processingSubmission,
            metadata: finalMetadata as Prisma.JsonObject,
          },
          uploads: submission.uploads,
          tenantTimeZone: await getTenantTimeZone(submission.form.tenantId),
        });
      }
    }

    if (finalReview.status === 'completed') {
      completed += 1;
    } else {
      failed += 1;
    }
  }

  return {
    processed,
    completed,
    failed,
    skipped,
  };
}

export async function resolveFormSubmissionAiWarning(
  formId: string,
  submissionId: string,
  params: TenantAwareParams,
  reason?: string
): Promise<ResolveFormSubmissionAiWarningResult> {
  const submission = await prisma.formSubmission.findFirst({
    where: {
      id: submissionId,
      formId,
      tenantId: params.tenantId,
      deletedAt: null,
    },
  });

  if (!submission) {
    throw new Error('Submission not found');
  }

  const aiReview = parseFormSubmissionAiReview(submission.metadata);
  if (!aiReview || aiReview.status !== 'completed' || !aiReview.reviewRequired) {
    throw new Error('No active AI warning to resolve');
  }

  const trimmedReason = typeof reason === 'string' ? reason.trim() : '';
  if (!trimmedReason) {
    throw new Error('Resolution reason is required');
  }

  const resolvedReview: FormSubmissionAiReview = {
    ...aiReview,
    resolvedWarningSignature: aiReview.warningSignature,
    resolvedAt: new Date().toISOString(),
    resolvedByUserId: params.userId,
    resolvedReason: trimmedReason.slice(0, 2000),
  };
  const metadataWithAiReview = withSubmissionAiReview(submission.metadata, resolvedReview);

  await prisma.formSubmission.update({
    where: { id: submission.id },
    data: {
      metadata: toJsonInput(metadataWithAiReview),
      hasUnresolvedAiWarning: false,
    },
  });

  await createAuditLog({
    tenantId: params.tenantId,
    userId: params.userId,
    action: 'UPDATE',
    entityType: 'FormSubmission',
    entityId: submission.id,
    entityName: submission.respondentName || submission.respondentEmail || submission.id,
    summary: `Resolved AI warning for response ${submission.id}`,
    reason: trimmedReason,
    changeSource: 'MANUAL',
  });

  return {
    id: submission.id,
    aiReview: resolvedReview,
  };
}

export async function listFormsWithWarnings(
  tenantId: string,
  limit: number = 8
): Promise<FormWarningListItem[]> {
  // Use the indexed hasUnresolvedAiWarning column to avoid a full table scan
  const submissions = await prisma.formSubmission.findMany({
    where: {
      tenantId,
      hasUnresolvedAiWarning: true,
      deletedAt: null,
      form: {
        deletedAt: null,
      },
    },
    select: {
      id: true,
      formId: true,
      submittedAt: true,
      form: {
        select: {
          id: true,
          title: true,
          slug: true,
          status: true,
        },
      },
    },
    orderBy: { submittedAt: 'desc' },
  });

  const warningsByForm = new Map<string, FormWarningListItem>();

  for (const submission of submissions) {
    const existing = warningsByForm.get(submission.formId);
    if (existing) {
      existing.warningCount += 1;
      continue;
    }

    warningsByForm.set(submission.formId, {
      formId: submission.formId,
      formTitle: submission.form.title,
      formSlug: submission.form.slug,
      formStatus: submission.form.status,
      latestSubmissionId: submission.id,
      latestSubmittedAt: submission.submittedAt,
      warningCount: 1,
    });
  }

  return Array.from(warningsByForm.values()).slice(0, limit);
}
