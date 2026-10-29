import { v4 as uuidv4 } from 'uuid';
import { Prisma } from '@/generated/prisma';
import { prisma } from '@/lib/prisma';
import { createAuditLog } from '@/lib/audit';
import {
  NotFoundError,
  UnprocessableEntityError,
  ValidationError,
} from '@/lib/errors';
import {
  getDocumentTemplateEngine,
  readGeneratedOakDocAssetMetadata,
  readOakDocReviewDraftMetadata,
} from '@/lib/document-editor/document-engine';
import {
  createReviewedFingerprint,
} from '@/lib/document-generation-fingerprint';
import { materializeOakDocGeneratedDocument } from '@/services/oakdoc-generation.service';
import { readOakDocTemplateMetadata } from '@/lib/document-editor/oakdoc-template';
import {
  finalizeDocument,
  materializeDocumentFromTemplate,
} from '@/services/document-generator.service';
import {
  linkFirstGeneratedDocumentTaskOutcomeForBatch,
} from '@/services/tasks/integration.service';
import type {
  BatchExecutionInput,
  BatchGenerationResult,
  BatchItemDiagnostics,
  DocumentGenerationBatchDto,
} from '@/types/document-generation-batch';
import type { TenantAwareParams } from '@/lib/types';
import type { TaskLaunchContext } from '@/services/tasks/types';
import {
  STALE_CLAIM_MS,
  computeBatchStatus,
  loadMasterCatalogueForTemplateIds,
  loadBatchForService,
  revisionConflict,
} from './lifecycle.service';
import {
  buildBatchItemRenderInput,
  oakDocBatchContext,
} from './preview.service';
import {
  mapBatchToDto,
  parseBatchItemConfiguration,
} from './mapper';
import {
  batchItemInclude,
  type BatchItemWithRelations,
  type BatchWithRelations,
} from './types';

function safeFailure(
  itemId: string,
  error: unknown,
  code = 'GENERATION_FAILED',
): { itemId: string; code: string; message: string; occurredAt: string } {
  const message = error instanceof ValidationError
    || error instanceof NotFoundError
    || error instanceof UnprocessableEntityError
    ? error.message
    : 'Document generation failed';
  return {
    itemId,
    code,
    message,
    occurredAt: new Date().toISOString(),
  };
}

function taskLaunchContextFromBatch(taskContext: unknown): TaskLaunchContext | undefined {
  const record = taskContext as Record<string, unknown> | null | undefined;
  if (!record) return undefined;
  const inner = (record.taskIntegrationContext as Record<string, unknown> | undefined) ?? record;
  if (typeof inner.taskId !== 'string' || typeof inner.taskStageId !== 'string') {
    return undefined;
  }
  return {
    taskId: inner.taskId,
    taskStageId: inner.taskStageId,
    ...(typeof inner.returnTo === 'string' ? { returnTo: inner.returnTo } : {}),
  };
}

async function actorName(params: TenantAwareParams): Promise<string> {
  const creator = await prisma.user.findFirst({
    where: { id: params.userId, tenantId: params.tenantId },
    select: { firstName: true, lastName: true },
  });
  return creator
    ? [creator.firstName, creator.lastName].filter(Boolean).join(' ').trim()
    : '';
}

function diagnosticsFromEvaluation(
  item: BatchItemWithRelations,
  evaluated: Awaited<ReturnType<typeof buildBatchItemRenderInput>>,
): BatchItemDiagnostics {
  const errors = [...evaluated.blockingErrors];
  if (!item.previewFingerprint) errors.push('Document has not been previewed');
  if (item.previewFingerprint && evaluated.fingerprint !== item.previewFingerprint) {
    errors.push('Preview inputs changed since the last render');
  }
  if (!item.reviewedFingerprint) {
    errors.push('Document has not been reviewed');
  } else if (item.previewFingerprint) {
    const expected = createReviewedFingerprint({
      previewFingerprint: item.previewFingerprint,
      editedContent: item.editedContent ?? item.previewContent ?? '',
      editedContentJson: item.editedContentJson ?? null,
    });
    if (expected !== item.reviewedFingerprint) {
      errors.push('Document content changed since review');
    }
  }
  return {
    itemId: item.id,
    status: errors.length > 0 ? 'NEEDS_INPUT' : 'READY',
    errors,
    fieldErrors: [],
  };
}

export async function materializeBatchDocumentByEngine(input: {
  batch: BatchWithRelations;
  item: BatchItemWithRelations;
  configuration: ReturnType<typeof parseBatchItemConfiguration>;
  evaluated: Awaited<ReturnType<typeof buildBatchItemRenderInput>>;
  actor: string;
  params: TenantAwareParams;
  taskContext?: TaskLaunchContext;
}) {
  const { batch, item, configuration, evaluated, actor, params, taskContext } = input;
  const engine = getDocumentTemplateEngine(item.template.contentJson);
  if (engine === 'OAKDOC') {
    if (!batch.primaryCompanyId) {
      throw new ValidationError('Select a primary company before generating an OakDoc document');
    }

    const reviewedAsset = readGeneratedOakDocAssetMetadata(item.generatedDocument.metadata);
    const reviewedDraft = readOakDocReviewDraftMetadata(item.generatedDocument.metadata);
    if (
      reviewedAsset
      && reviewedDraft
      && item.previewFingerprint
      && reviewedDraft.previewFingerprint === item.previewFingerprint
      && reviewedAsset.templateId === item.templateId
      && reviewedAsset.templateVersion === item.templateVersion
      && reviewedAsset.templateSha256 === readOakDocTemplateMetadata(item.template.contentJson)?.sha256
    ) {
      // Review & Generate persists the exact resolved/edited DOCX on the
      // GeneratedDocument draft. Finalize that reviewed asset rather than
      // regenerating from the reusable template and losing manual Word edits.
      return item.generatedDocument;
    }

    return materializeOakDocGeneratedDocument({
      templateId: item.templateId,
      generatedDocumentId: item.generatedDocumentId,
      expectedRevision: item.generatedDocument.revision,
      expectedBatchItemId: item.id,
      companyId: batch.primaryCompanyId,
      selectedDirectorId: configuration.selectedDirectorId ?? undefined,
      selectedShareholderId: configuration.selectedShareholderId ?? undefined,
      ...oakDocBatchContext(
        configuration,
        evaluated.effectiveCustomData,
        item.generatedDocument?.serviceAgreement?.id,
      ),
      generatedBy: actor,
      title: evaluated.resolvedTitle,
      contactIds: configuration.contactIds,
    }, params, taskContext);
  }

  return materializeDocumentFromTemplate(
    {
      templateId: item.templateId,
      expectedRevision: item.generatedDocument.revision,
      companyId: batch.primaryCompanyId ?? undefined,
      contactIds: configuration.contactIds,
      selectedDirectorId: configuration.selectedDirectorId ?? undefined,
      selectedDirectorIds: configuration.selectedDirectorIds,
      selectedShareholderId: configuration.selectedShareholderId ?? undefined,
      selectedContactId: configuration.selectedContactId ?? undefined,
      title: evaluated.resolvedTitle,
      customData: evaluated.effectiveCustomData,
      useLetterhead: configuration.useLetterhead,
      editedContent: item.editedContent ?? undefined,
      editedContentJson: item.editedContentJson ?? undefined,
      serviceAgreementId: item.generatedDocument?.serviceAgreement?.id ?? undefined,
    },
    params,
    {
      generatedDocumentId: item.generatedDocumentId,
      expectedBatchItemId: item.id,
    },
    taskContext,
  );
}

async function persistDiagnostics(
  batchId: string,
  failures: Array<{
    item: BatchItemWithRelations;
    diagnostics: BatchItemDiagnostics;
  }>,
) {
  for (const failure of failures) {
    await prisma.documentGenerationBatchItem.update({
      where: { id: failure.item.id },
      data: {
        status: 'NEEDS_INPUT',
        validationDiagnostics: failure.diagnostics as never,
      },
    });
  }
}

async function recoverStaleClaims(batch: BatchWithRelations, params: TenantAwareParams) {
  const cutoff = new Date(Date.now() - STALE_CLAIM_MS);
  const recovered = await prisma.documentGenerationBatchItem.updateMany({
    where: {
      batchId: batch.id,
      tenantId: params.tenantId,
      status: 'GENERATING',
      generationClaimedAt: { lt: cutoff },
    },
    data: {
      status: 'FAILED',
      generationAttemptId: null,
      generationClaimedAt: null,
      lastError: {
        code: 'ABANDONED_CLAIM',
        message: 'Generation attempt was abandoned and can be retried',
        occurredAt: new Date().toISOString(),
      } as never,
    },
  });
  if (recovered.count > 0) {
    await createAuditLog({
      tenantId: params.tenantId,
      userId: params.userId,
      action: 'UPDATE',
      entityType: 'DocumentGenerationBatch',
      entityId: batch.id,
      entityName: `Generation batch (${batch.items.length} documents)`,
      summary: `Recovered ${recovered.count} abandoned generation claim(s)`,
      changeSource: 'MANUAL',
      metadata: { recoveredCount: recovered.count },
    });
  }
}

async function collectPreflightFailures(
  batch: BatchWithRelations,
  params: TenantAwareParams,
): Promise<Array<{
  item: BatchItemWithRelations;
  diagnostics: BatchItemDiagnostics;
}>> {
  const actor = await actorName(params);
  const failures: Array<{
    item: BatchItemWithRelations;
    diagnostics: BatchItemDiagnostics;
  }> = [];
  for (const item of batch.items) {
    if (item.status === 'GENERATED' || item.status === 'GENERATING') continue;
    if (item.status === 'BLOCKED') {
      failures.push({
        item,
        diagnostics: {
          itemId: item.id,
          status: 'BLOCKED',
          errors: ['This item is blocked and cannot be generated'],
          fieldErrors: [],
        },
      });
      continue;
    }
    const evaluated = await buildBatchItemRenderInput(batch, item, params, actor);
    const diagnostics = diagnosticsFromEvaluation(item, evaluated);
    if (diagnostics.errors.length > 0) failures.push({ item, diagnostics });
  }
  return failures;
}

export async function preflightDocumentGenerationBatch(
  id: string,
  input: BatchExecutionInput,
  params: TenantAwareParams,
): Promise<DocumentGenerationBatchDto> {
  await claimBatchRevision(id, input.expectedRevision, params);
  const batch = await loadBatchForService(id, params);
  if (!batch) throw new NotFoundError('Document generation batch not found');
  await recoverStaleClaims(batch, params);
  const recoveredBatch = await loadBatchForService(id, params);
  if (!recoveredBatch) throw new NotFoundError('Document generation batch not found');
  const failures = await collectPreflightFailures(recoveredBatch, params);
  await persistDiagnostics(id, failures);
  if (failures.length > 0) {
    throw new UnprocessableEntityError('Batch is not ready to generate', {
      items: failures.map((failure) => failure.diagnostics),
    });
  }
  const refreshed = await loadBatchForService(id, params);
  if (!refreshed) throw new NotFoundError('Document generation batch not found');
  const catalogue = await loadMasterCatalogueForTemplateIds(
    refreshed.items.map((entry) => entry.templateId),
    params.tenantId,
  );
  return mapBatchToDto(refreshed, catalogue);
}

export async function mapWithConcurrency<T, R>(
  values: T[],
  limit: number,
  worker: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (next < values.length) {
      const index = next++;
      results[index] = await worker(values[index]);
    }
  }));
  return results;
}

async function claimBatchRevision(
  id: string,
  expectedRevision: number,
  params: TenantAwareParams,
) {
  const claimed = await prisma.documentGenerationBatch.updateMany({
    where: {
      id,
      tenantId: params.tenantId,
      deletedAt: null,
      revision: expectedRevision,
    },
    data: { revision: { increment: 1 } },
  });
  if (claimed.count !== 1) throw await revisionConflict(id, params.tenantId);
}

export async function generateDocumentGenerationBatch(
  id: string,
  input: BatchExecutionInput,
  params: TenantAwareParams,
): Promise<BatchGenerationResult> {
  await claimBatchRevision(id, input.expectedRevision, params);
  const batch = await loadBatchForService(id, params);
  if (!batch) throw new NotFoundError('Document generation batch not found');
  await recoverStaleClaims(batch, params);
  const recoveredBatch = await loadBatchForService(id, params);
  if (!recoveredBatch) throw new NotFoundError('Document generation batch not found');
  const failures = await collectPreflightFailures(recoveredBatch, params);
  await persistDiagnostics(id, failures);
  if (failures.length > 0) {
    throw new UnprocessableEntityError('Batch is not ready to generate', {
      items: failures.map((failure) => failure.diagnostics),
    });
  }

  const eligible = recoveredBatch.items.filter((item) => item.status === 'READY');
  if (eligible.length === 0) {
    const status = computeBatchStatus(batch.items.map((item) => item.status));
    return {
      batchId: id,
      revision: (await prisma.documentGenerationBatch.findFirst({
        where: { id, tenantId: params.tenantId },
        select: { revision: true },
      }))?.revision ?? input.expectedRevision + 1,
      batchStatus: status,
      successes: [],
      failures: [],
    };
  }

  await createAuditLog({
    tenantId: params.tenantId,
    userId: params.userId,
    companyId: batch.primaryCompanyId ?? undefined,
    action: 'UPDATE',
    entityType: 'DocumentGenerationBatch',
    entityId: id,
    entityName: `Generation batch (${batch.items.length} documents)`,
    summary: `Started generation of ${eligible.length} document(s)`,
    changeSource: 'MANUAL',
    metadata: { itemCount: eligible.length },
  });

  const claimId = uuidv4();
  const now = new Date();
  await prisma.documentGenerationBatchItem.updateMany({
    where: {
      id: { in: eligible.map((item) => item.id) },
      batchId: id,
      tenantId: params.tenantId,
      status: 'READY',
    },
    data: {
      status: 'GENERATING',
      generationAttemptId: claimId,
      generationClaimedAt: now,
    },
  });

  const claimed = await prisma.documentGenerationBatchItem.findMany({
    where: {
      id: { in: eligible.map((item) => item.id) },
      batchId: id,
      tenantId: params.tenantId,
      status: 'GENERATING',
    },
    include: batchItemInclude,
  });
  const actor = await actorName(params);
  const taskContext = taskLaunchContextFromBatch(batch.taskContext);

  const results = await mapWithConcurrency(
    claimed,
    3,
    async (item) => {
      try {
        const configuration = parseBatchItemConfiguration(item.configuration);
        const evaluated = await buildBatchItemRenderInput(batch, item, params, actor);
        const document = await materializeBatchDocumentByEngine({
          batch,
          item,
          configuration,
          evaluated,
          actor,
          params,
          taskContext,
        });
        await finalizeDocument(document.id, params, document.revision);
        await prisma.documentGenerationBatchItem.update({
          where: { id: item.id },
          data: {
            status: 'GENERATED',
            generationAttemptId: null,
            generationClaimedAt: null,
            lastError: Prisma.DbNull,
            validationDiagnostics: Prisma.DbNull,
          },
        });
        await createAuditLog({
          tenantId: params.tenantId,
          userId: params.userId,
          companyId: batch.primaryCompanyId ?? undefined,
          action: 'DOCUMENT_GENERATED',
          entityType: 'GeneratedDocument',
          entityId: document.id,
          entityName: document.title,
          summary: `Generated batch document "${document.title}"`,
          changeSource: 'MANUAL',
          metadata: { batchId: id, batchItemId: item.id },
        });
        return {
          ok: true as const,
          itemId: item.id,
          documentId: document.id,
          title: document.title,
        };
      } catch (error) {
        const failure = safeFailure(item.id, error);
        await prisma.documentGenerationBatchItem.update({
          where: { id: item.id },
          data: {
            status: 'FAILED',
            generationAttemptId: null,
            generationClaimedAt: null,
            lastError: failure as never,
          },
        });
        await createAuditLog({
          tenantId: params.tenantId,
          userId: params.userId,
          companyId: batch.primaryCompanyId ?? undefined,
          action: 'UPDATE',
          entityType: 'DocumentGenerationBatchItem',
          entityId: item.id,
          entityName: item.template.name,
          summary: `Batch document "${item.template.name}" failed to generate`,
          changeSource: 'MANUAL',
          metadata: { code: failure.code },
        });
        return { ok: false as const, itemId: item.id, failure };
      }
    },
  );

  const finalItems = await prisma.documentGenerationBatchItem.findMany({
    where: { batchId: id },
    select: { status: true, displayOrder: true, id: true },
  });
  const status = computeBatchStatus(finalItems.map((item) => item.status));
  const updated = await prisma.documentGenerationBatch.update({
    where: { id },
    data: { status },
  });

  const successes = results
    .filter((result): result is Extract<typeof result, { ok: true }> => result.ok)
    .sort((a, b) => {
      const orderA = finalItems.find((entry) => entry.id === a.itemId)?.displayOrder ?? 0;
      const orderB = finalItems.find((entry) => entry.id === b.itemId)?.displayOrder ?? 0;
      return orderA - orderB;
    })
    .map((result) => ({
      itemId: result.itemId,
      documentId: result.documentId,
      title: result.title,
    }));
  const executionFailures = results
    .filter((result): result is Extract<typeof result, { ok: false }> => !result.ok)
    .map((result) => result.failure);

  if (successes.length > 0 && taskContext) {
    await linkFirstGeneratedDocumentTaskOutcomeForBatch({
      tenantId: params.tenantId,
      taskContext,
      userId: params.userId,
      successes,
    });
  }

  await createAuditLog({
    tenantId: params.tenantId,
    userId: params.userId,
    companyId: batch.primaryCompanyId ?? undefined,
    action: 'UPDATE',
    entityType: 'DocumentGenerationBatch',
    entityId: id,
    entityName: `Generation batch (${batch.items.length} documents)`,
    summary: `Batch generation finished with ${successes.length} success(es) and ${executionFailures.length} failure(s)`,
    changeSource: 'MANUAL',
    metadata: {
      successCount: successes.length,
      failureCount: executionFailures.length,
      batchStatus: status,
    },
  });

  return {
    batchId: id,
    revision: updated.revision,
    batchStatus: status,
    successes,
    failures: executionFailures,
  };
}

export async function retryDocumentGenerationBatchItem(
  batchId: string,
  itemId: string,
  input: BatchExecutionInput,
  params: TenantAwareParams,
): Promise<DocumentGenerationBatchDto> {
  await claimBatchRevision(batchId, input.expectedRevision, params);
  const batch = await loadBatchForService(batchId, params);
  if (!batch) throw new NotFoundError('Document generation batch not found');
  const item = batch.items.find((entry) => entry.id === itemId);
  if (!item) throw new NotFoundError('Batch item not found');
  if (item.status === 'GENERATED') {
    throw new ValidationError('Document is already generated');
  }

  const actor = await actorName(params);
  const evaluated = await buildBatchItemRenderInput(batch, item, params, actor);
  const diagnostics = diagnosticsFromEvaluation(item, evaluated);
  if (diagnostics.errors.length > 0) {
    await prisma.documentGenerationBatchItem.update({
      where: { id: item.id },
      data: {
        status: 'NEEDS_INPUT',
        validationDiagnostics: diagnostics as never,
      },
    });
    throw new UnprocessableEntityError('Item is not ready to retry', {
      items: [diagnostics],
    });
  }

  const configuration = parseBatchItemConfiguration(item.configuration);
  const claimId = uuidv4();
  const claimed = await prisma.documentGenerationBatchItem.updateMany({
    where: {
      id: item.id,
      batchId,
      tenantId: params.tenantId,
      status: { in: ['FAILED', 'GENERATING'] },
      OR: [
        { generationClaimedAt: null },
        { generationClaimedAt: { lt: new Date(Date.now() - STALE_CLAIM_MS) } },
      ],
    },
    data: {
      status: 'GENERATING',
      generationAttemptId: claimId,
      generationClaimedAt: new Date(),
    },
  });
  if (claimed.count !== 1) {
    throw new ValidationError('Item is not eligible for retry');
  }

  const taskContext = taskLaunchContextFromBatch(batch.taskContext);
  try {
    const document = await materializeBatchDocumentByEngine({
      batch,
      item,
      configuration,
      evaluated,
      actor,
      params,
      taskContext,
    });
    await finalizeDocument(document.id, params, document.revision);
    await prisma.documentGenerationBatchItem.update({
      where: { id: item.id },
      data: {
        status: 'GENERATED',
        generationAttemptId: null,
        generationClaimedAt: null,
        lastError: Prisma.DbNull,
        validationDiagnostics: Prisma.DbNull,
      },
    });
    if (taskContext) {
      await linkFirstGeneratedDocumentTaskOutcomeForBatch({
        tenantId: params.tenantId,
        taskContext,
        userId: params.userId,
        successes: [{
          itemId: item.id,
          documentId: item.generatedDocumentId,
          title: evaluated.resolvedTitle,
        }],
      });
    }
  } catch (error) {
    const failure = safeFailure(item.id, error);
    await prisma.documentGenerationBatchItem.update({
      where: { id: item.id },
      data: {
        status: 'FAILED',
        generationAttemptId: null,
        generationClaimedAt: null,
        lastError: failure as never,
      },
    });
    throw new ValidationError(failure.message, { item: failure });
  }

  const finalItems = await prisma.documentGenerationBatchItem.findMany({
    where: { batchId },
    select: { status: true },
  });
  const status = computeBatchStatus(finalItems.map((entry) => entry.status));
  await prisma.documentGenerationBatch.update({
    where: { id: batchId },
    data: { status },
  });
  return getBatchDto(batchId, params);
}

async function getBatchDto(id: string, params: TenantAwareParams) {
  const refreshed = await loadBatchForService(id, params);
  if (!refreshed) throw new NotFoundError('Document generation batch not found');
  const catalogue = await loadMasterCatalogueForTemplateIds(
    refreshed.items.map((entry) => entry.templateId),
    params.tenantId,
  );
  return mapBatchToDto(refreshed, catalogue);
}
