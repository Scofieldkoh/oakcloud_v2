import { isDeepStrictEqual } from 'node:util';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@/generated/prisma';
import { createAuditLog } from '@/lib/audit';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@/lib/errors';
import { readActiveGenerationSession } from '@/lib/document-generation-session';
import { DEFAULT_DOCUMENT_GENERATION_TITLE_PATTERN } from '@/lib/document-generation-title';
import {
  normalizeStoredPlaceholders,
  storageFormatToCustomPlaceholders,
  mergeTemplateAndPartialPlaceholders,
} from '@/lib/template-analysis';
import {
  deriveMasterFieldCatalogue,
} from '@/lib/document-generation-master-fields';
import { rejectRetiredA4Operation } from '@/lib/document-editor/a4-retirement';
import { getDocumentTemplateEngine } from '@/lib/document-editor/document-engine';
import { resolveTemplateIdsForNewRun } from '@/services/oakdoc-migration.service';
import {
  claimGeneratedDocumentRevision,
  readGeneratedDocumentRevision,
} from '@/lib/document-editor/generated-document-revision';
import { VersionConflictError } from '@/lib/document-editor/revision-concurrency';
import { serviceAgreementDraftSchema } from '@/lib/validations/service-agreement';
import {
  upsertServiceAgreementDraft,
  type ServiceAgreementDraftDto,
} from '@/services/service-agreement';
import type {
  CreateDocumentGenerationBatchInput,
  UpdateDocumentGenerationBatchInput,
} from '@/types/document-generation-batch';
import type {
  BatchItemConfiguration,
  DocumentGenerationBatchDto,
  DocumentGenerationBatchListItem,
  MasterFieldCatalogue,
} from '@/types/document-generation-batch';
import type { TenantAwareParams } from '@/lib/types';
import type { TaskLaunchContext } from '@/services/tasks/types';
import { safelyLinkGeneratedDocumentTaskOutcome } from '@/services/tasks/integration.service';
import {
  batchInclude,
  batchItemInclude,
  type BatchWithRelations,
} from './types';
import {
  mapBatchToDto,
  parseBatchItemConfiguration,
  serviceAgreementWorkspaceFromDto,
} from './mapper';

const STALE_CLAIM_MS = 15 * 60 * 1000;

function taskLaunchContextToJson(
  taskContext?: TaskLaunchContext,
): Record<string, unknown> | undefined {
  if (!taskContext) return undefined;
  return {
    taskId: taskContext.taskId,
    taskStageId: taskContext.taskStageId,
    ...(taskContext.returnTo ? { returnTo: taskContext.returnTo } : {}),
  };
}

function taskIntegrationContextForMetadata(
  taskContext?: TaskLaunchContext,
): Record<string, unknown> | undefined {
  const json = taskLaunchContextToJson(taskContext);
  return json ? { taskIntegrationContext: json } : undefined;
}

async function safelyLinkBatchOutcome(
  batch: { items: Array<{ generatedDocumentId: string }> },
  params: TenantAwareParams,
  taskContext?: TaskLaunchContext,
) {
  const generatedDocumentId = batch.items[0]?.generatedDocumentId;
  if (!taskContext || !generatedDocumentId) return;
  await safelyLinkGeneratedDocumentTaskOutcome({
    tenantId: params.tenantId,
    context: taskContext,
    authoritativeId: generatedDocumentId,
    userId: params.userId,
  });
}

export function defaultItemConfiguration(_templateName: string): BatchItemConfiguration {
  return {
    version: 1,
    title: DEFAULT_DOCUMENT_GENERATION_TITLE_PATTERN,
    contactIds: [],
    selectedDirectorId: null,
    selectedShareholderId: null,
    selectedContactId: null,
    itemValues: {},
    masterOverrides: {},
    useLetterhead: false,
    serviceAgreement: null,
  };
}

export async function revisionConflict(
  id: string,
  tenantId: string,
): Promise<ConflictError> {
  const current = await prisma.documentGenerationBatch.findFirst({
    where: { id, tenantId },
    select: { revision: true },
  });
  return new ConflictError('The batch was changed by another save', {
    currentRevision: current?.revision ?? 0,
  });
}

export async function loadBatchForService(
  id: string,
  params: TenantAwareParams,
  tx: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<BatchWithRelations | null> {
  return tx.documentGenerationBatch.findFirst({
    where: { id, tenantId: params.tenantId, deletedAt: null },
    include: batchInclude,
  });
}

export async function loadMasterCatalogueForTemplateIds(
  templateIds: string[],
  tenantId: string,
): Promise<MasterFieldCatalogue> {
  if (templateIds.length === 0) return { fields: [], conflicts: [] };
  const [templates, partials] = await Promise.all([
    prisma.documentTemplate.findMany({
      where: { id: { in: templateIds }, tenantId, deletedAt: null },
      select: { id: true, content: true, contentJson: true, placeholders: true },
    }),
    prisma.templatePartial.findMany({
      where: { tenantId, deletedAt: null },
      select: {
        id: true,
        name: true,
        displayName: true,
        content: true,
        placeholders: true,
        version: true,
      },
    }),
  ]);
  const fieldsByTemplateId = new Map(templates.map((template) => {
    const templatePlaceholders = storageFormatToCustomPlaceholders(
      normalizeStoredPlaceholders(template.placeholders),
      { scope: { kind: 'template', id: template.id } },
    );
    // Word templates keep their custom fields in stored placeholders; only
    // legacy text templates pull extra fields from referenced partials.
    const fields = getDocumentTemplateEngine(template.contentJson) === 'A4'
      ? mergeTemplateAndPartialPlaceholders({
          templatePlaceholders,
          templateContent: template.content,
          partials,
        })
      : templatePlaceholders;
    return [template.id, fields] as const;
  }));
  // One source per document, so two copies of a template share fields too.
  const sources = templateIds.flatMap((templateId) => {
    const fields = fieldsByTemplateId.get(templateId);
    return fields ? [{ templateId, fields }] : [];
  });
  return deriveMasterFieldCatalogue(sources);
}

async function catalogueForBatch(batch: BatchWithRelations): Promise<MasterFieldCatalogue> {
  return loadMasterCatalogueForTemplateIds(
    batch.items.map((item) => item.templateId),
    batch.tenantId,
  );
}

function preservedMasterValues(
  raw: unknown,
  catalogue: MasterFieldCatalogue,
): Record<string, string> {
  const record = raw && typeof raw === 'object'
    ? raw as Record<string, unknown>
    : {};
  const validIds = new Set(catalogue.fields.map((field) => field.id));
  const entries = Object.entries(record)
    .filter(([id, value]) => validIds.has(id) && typeof value === 'string') as Array<[string, string]>;
  return Object.fromEntries(entries);
}

async function resolveTemplates(
  tx: Prisma.TransactionClient | typeof prisma,
  templateIds: string[],
  tenantId: string,
) {
  const templates = await tx.documentTemplate.findMany({
    where: { id: { in: templateIds }, tenantId, deletedAt: null },
  });
  if (templates.length !== new Set(templateIds).size) {
    throw new NotFoundError('Template not found');
  }
  const inactive = templates.find((template) => !template.isActive);
  if (inactive) {
    throw new ValidationError(`Template "${inactive.name}" is not active`);
  }
  if (templates.some((template) => getDocumentTemplateEngine(template.contentJson) === 'A4')) {
    rejectRetiredA4Operation('document-generate');
  }
  return templates;
}

async function requireTenantCompany(
  tx: Prisma.TransactionClient | typeof prisma,
  companyId: string,
  tenantId: string,
): Promise<void> {
  const company = await tx.company.findFirst({
    where: { id: companyId, tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!company) {
    throw new ValidationError('The selected company is not available');
  }
}

export function computeBatchStatus(itemStatuses: string[]): 'DRAFT' | 'PARTIAL' | 'COMPLETED' {
  const generated = itemStatuses.filter((status) => status === 'GENERATED').length;
  if (generated === itemStatuses.length && itemStatuses.length > 0) return 'COMPLETED';
  if (generated > 0) return 'PARTIAL';
  return 'DRAFT';
}

function hasDurableGeneratedOutput(item: BatchWithRelations['items'][number]): boolean {
  if (item.status === 'GENERATED') return true;
  if (item.generatedDocument.status !== 'DRAFT') return true;
  const agreement = item.generatedDocument.serviceAgreement;
  return Boolean(agreement && agreement.status !== 'DRAFT');
}

export async function createDocumentGenerationBatch(
  input: CreateDocumentGenerationBatchInput,
  params: TenantAwareParams,
  taskContext?: TaskLaunchContext,
): Promise<DocumentGenerationBatchDto> {
  if (input.legacyDraftId) {
    return adoptLegacyGenerationSession(
      input.legacyDraftId,
      input,
      params,
      taskContext,
    );
  }
  const { tenantId, userId } = params;
  // A new run uses the approved Word replacement of an A4 template.
  const templateIds = await resolveTemplateIdsForNewRun(
    input.items.map((item) => item.templateId),
    tenantId,
  );
  const items = input.items.map((item, index) => ({ ...item, templateId: templateIds[index] }));
  const batch = await prisma.$transaction(async (tx) => {
    const templates = await resolveTemplates(tx, templateIds, tenantId);
    const templateById = new Map(templates.map((template) => [template.id, template]));
    const created = await tx.documentGenerationBatch.create({
      data: {
        tenantId,
        createdById: userId,
        currentStage: 0,
        status: 'DRAFT',
        masterFieldValues: {},
        taskContext: taskLaunchContextToJson(taskContext) as never,
      },
    });
    const createdItems: Array<{ id: string; displayOrder: number }> = [];
    for (const [displayOrder, itemInput] of items.entries()) {
      const template = templateById.get(itemInput.templateId)!;
      const child = await tx.generatedDocument.create({
        data: {
          tenantId,
          templateId: template.id,
          templateVersion: template.version,
          sharePointRelativeFolderPathSnapshot: template.sharePointRelativeFolderPath,
          title: DEFAULT_DOCUMENT_GENERATION_TITLE_PATTERN,
          content: '',
          status: 'DRAFT',
          useLetterhead: false,
          createdById: userId,
          metadata: {
            batchItem: true,
            ...(taskIntegrationContextForMetadata(taskContext) ?? {}),
          },
        },
      });
      const item = await tx.documentGenerationBatchItem.create({
        data: {
          tenantId,
          batchId: created.id,
          templateId: template.id,
          generatedDocumentId: child.id,
          templateVersion: template.version,
          displayOrder,
          configuration: defaultItemConfiguration(template.name) as never,
        },
      });
      createdItems.push({ id: item.id, displayOrder });
    }
    if (createdItems[0]) {
      await tx.documentGenerationBatch.update({
        where: { id: created.id },
        data: { activeItemId: createdItems[0].id },
      });
    }
    return tx.documentGenerationBatch.findFirstOrThrow({
      where: { id: created.id },
      include: batchInclude,
    });
  });

  await createAuditLog({
    tenantId,
    userId,
    action: 'CREATE',
    entityType: 'DocumentGenerationBatch',
    entityId: batch.id,
    entityName: `Generation batch (${batch.items.length} documents)`,
    summary: `Created document generation batch with ${batch.items.length} documents`,
    changeSource: 'MANUAL',
  });

  await safelyLinkBatchOutcome(batch, params, taskContext);
  const catalogue = await catalogueForBatch(batch);
  return mapBatchToDto(batch, catalogue);
}

export async function listDocumentGenerationBatches(
  params: TenantAwareParams,
): Promise<DocumentGenerationBatchListItem[]> {
  const batches = await prisma.documentGenerationBatch.findMany({
    where: {
      tenantId: params.tenantId,
      deletedAt: null,
      status: { in: ['DRAFT', 'PARTIAL'] },
    },
    include: {
      primaryCompany: { select: { id: true, name: true, uen: true } },
      createdBy: { select: { firstName: true, lastName: true } },
      items: {
        select: { status: true, generatedDocument: { select: { deletedAt: true } } },
      },
    },
    orderBy: { updatedAt: 'desc' },
    take: 50,
  });
  return batches.map((batch) => {
    const counts: DocumentGenerationBatchListItem['counts'] = {
      NOT_STARTED: 0,
      NEEDS_INPUT: 0,
      PREVIEWED: 0,
      READY: 0,
      GENERATING: 0,
      GENERATED: 0,
      FAILED: 0,
      BLOCKED: 0,
    };
    for (const item of batch.items) counts[item.status]++;
    return {
      id: batch.id,
      primaryCompanyId: batch.primaryCompanyId,
      companyName: batch.primaryCompany?.name ?? null,
      itemCount: batch.items.length,
      counts,
      status: batch.status,
      currentStage: batch.currentStage,
      createdBy: {
        firstName: batch.createdBy.firstName,
        lastName: batch.createdBy.lastName,
      },
      updatedAt: batch.updatedAt.toISOString(),
    };
  });
}

export async function getDocumentGenerationBatch(
  id: string,
  params: TenantAwareParams,
): Promise<DocumentGenerationBatchDto> {
  const batch = await loadBatchForService(id, params);
  if (!batch) throw new NotFoundError('Document generation batch not found');
  const catalogue = await catalogueForBatch(batch);
  return mapBatchToDto(
    {
      ...batch,
      masterFieldValues: preservedMasterValues(
        batch.masterFieldValues,
        catalogue,
      ) as never,
    },
    catalogue,
  );
}

async function syncServiceAgreementForItem(
  tx: Prisma.TransactionClient | typeof prisma,
  params: TenantAwareParams,
  generatedDocumentId: string,
  configuration: BatchItemConfiguration,
  primaryCompanyId: string | null,
) {
  const workspace = configuration.serviceAgreement;
  if (
    !workspace
    || !primaryCompanyId
    || workspace.authorizedContactIds.length === 0
    || workspace.signerContactIds.length === 0
  ) {
    return { synced: false, agreement: null as ServiceAgreementDraftDto | null };
  }
  const parsed = serviceAgreementDraftSchema.safeParse({
    primaryCompanyId,
    ...workspace,
  });
  if (!parsed.success) {
    return {
      synced: false,
      agreement: null,
      error: 'Service Agreement configuration is incomplete',
    };
  }
  const agreement = await upsertServiceAgreementDraft(
    generatedDocumentId,
    parsed.data,
    params,
    { tx, skipDocumentCheck: true },
  );
  return { synced: true, agreement };
}

export async function updateDocumentGenerationBatch(
  id: string,
  input: UpdateDocumentGenerationBatchInput,
  params: TenantAwareParams,
): Promise<DocumentGenerationBatchDto> {
  const existing = await loadBatchForService(id, params);
  if (!existing) throw new NotFoundError('Document generation batch not found');
  if (existing.status === 'COMPLETED') {
    throw new ValidationError('Completed batches cannot be edited');
  }

  const batch = await prisma.$transaction(async (tx) => {
    const claimed = await tx.documentGenerationBatch.updateMany({
      where: {
        id,
        tenantId: params.tenantId,
        deletedAt: null,
        revision: input.expectedRevision,
      },
      data: { revision: { increment: 1 } },
    });
    if (claimed.count !== 1) {
      throw await revisionConflict(id, params.tenantId);
    }

    const current = await tx.documentGenerationBatch.findFirst({
      where: { id, tenantId: params.tenantId, deletedAt: null },
      include: batchInclude,
    });
    if (!current) throw new NotFoundError('Document generation batch not found');

    const hasGenerated = current.items.some((item) => item.status === 'GENERATED');
    const submittedTemplateIds = input.items.map((item) => item.templateId);
    const currentTemplateIds = current.items.map((item) => item.templateId);
    if (hasGenerated) {
      const sameSet =
        submittedTemplateIds.length === currentTemplateIds.length
        && [...submittedTemplateIds].sort().join('|')
          === [...currentTemplateIds].sort().join('|');
      if (!sameSet) {
        throw new ValidationError(
          'Batch composition is frozen after a document was generated',
        );
      }
      if (
        input.primaryCompanyId !== undefined
        && (input.primaryCompanyId ?? null) !== current.primaryCompanyId
      ) {
        throw new ValidationError(
          'Primary company is frozen after a document was generated',
        );
      }
      if (input.masterFieldValues !== undefined) {
        const changed = Object.entries(input.masterFieldValues).some(
          ([key, value]) =>
            (current.masterFieldValues as Record<string, unknown>)[key] !== value,
        );
        if (changed) {
          throw new ValidationError(
            'Shared field values are frozen after a document was generated',
          );
        }
      }
    }

    await resolveTemplates(tx, submittedTemplateIds, params.tenantId);
    if (input.primaryCompanyId) {
      await requireTenantCompany(tx, input.primaryCompanyId, params.tenantId);
    }

    // A template may appear more than once, so submitted items pair with
    // stored ones by id; items without a known id pair with an unclaimed
    // stored item of the same template, in order.
    const existingById = new Map(current.items.map((item) => [item.id, item]));
    const claimedIds = new Set<string>();
    const matchedIds: Array<string | undefined> = input.items.map((submitted) => {
      const byId = submitted.id ? existingById.get(submitted.id) : undefined;
      if (!byId || byId.templateId !== submitted.templateId || claimedIds.has(byId.id)) return undefined;
      claimedIds.add(byId.id);
      return byId.id;
    });
    input.items.forEach((submitted, index) => {
      if (matchedIds[index]) return;
      const sameTemplate = current.items.find(
        (item) => item.templateId === submitted.templateId && !claimedIds.has(item.id),
      );
      if (!sameTemplate) return;
      claimedIds.add(sameTemplate.id);
      matchedIds[index] = sameTemplate.id;
    });

    for (const item of current.items) {
      if (claimedIds.has(item.id)) continue;
      if (hasDurableGeneratedOutput(item)) {
        throw new ValidationError(
          'Generated documents cannot be removed from the batch',
        );
      }
      const agreement = item.generatedDocument?.serviceAgreement;
      if (agreement && agreement.status === 'DRAFT') {
        await tx.serviceAgreement.delete({ where: { id: agreement.id } });
      }
      await claimGeneratedDocumentRevision(tx, {
        id: item.generatedDocumentId,
        tenantId: params.tenantId,
        allowedStatuses: ['DRAFT'],
      });
      await tx.generatedDocument.update({
        where: { id: item.generatedDocumentId },
        data: { deletedAt: new Date() },
      });
      await tx.documentGenerationBatchItem.delete({ where: { id: item.id } });
    }

    for (const [index, existingId] of matchedIds.entries()) {
      if (!existingId) continue;
      await tx.documentGenerationBatchItem.update({
        where: { id: existingId },
        data: { displayOrder: 100 + index },
      });
    }

    const refreshedExisting = await tx.documentGenerationBatchItem.findMany({
      where: { batchId: id },
      include: batchItemInclude,
    });
    const refreshedById = new Map(
      refreshedExisting.map((item) => [item.id, item]),
    );

    for (const [index, submitted] of input.items.entries()) {
      const displayOrder = submitted.displayOrder ?? index;
      const existingId = matchedIds[index];
      const existingItem = existingId ? refreshedById.get(existingId) : undefined;
      if (existingItem) {
        if (existingItem.status === 'GENERATED') {
          if (submitted.configuration) {
            throw new ValidationError(
              `Generated document "${existingItem.template.name}" is immutable`,
            );
          }
          if (submitted.editedContent !== undefined || submitted.editedContentJson !== undefined) {
            throw new ValidationError(
              `Generated document "${existingItem.template.name}" is immutable`,
            );
          }
        }
        // Saves echo every item's stored edits back, so only a real change to an
        // A4 item's content is refused.
        const editsContent =
          (submitted.editedContent !== undefined
            && submitted.editedContent !== existingItem.editedContent)
          || (submitted.editedContentJson !== undefined
            && !isDeepStrictEqual(submitted.editedContentJson ?? null, existingItem.editedContentJson ?? null));
        if (editsContent && getDocumentTemplateEngine(existingItem.template.contentJson) === 'A4') {
          rejectRetiredA4Operation('batch-edit');
        }
        const changed =
          submitted.configuration !== undefined
          || submitted.editedContent !== undefined
          || submitted.editedContentJson !== undefined;
        await tx.documentGenerationBatchItem.update({
          where: { id: existingItem.id },
          data: {
            displayOrder,
            ...(submitted.configuration
              ? { configuration: submitted.configuration as never }
              : {}),
            ...(submitted.editedContent !== undefined
              ? { editedContent: submitted.editedContent }
              : {}),
            ...(submitted.editedContentJson !== undefined
              ? { editedContentJson: submitted.editedContentJson as never }
              : {}),
            ...(changed && existingItem.status !== 'GENERATED'
              ? {
                  reviewedFingerprint: null,
                  status: existingItem.status === 'FAILED'
                    ? 'NEEDS_INPUT'
                    : existingItem.status,
                }
              : {}),
          },
        });
      } else {
        const template = (await tx.documentTemplate.findFirst({
          where: { id: submitted.templateId, tenantId: params.tenantId, deletedAt: null },
        }))!;
        const child = await tx.generatedDocument.create({
          data: {
            tenantId: params.tenantId,
            templateId: template.id,
            templateVersion: template.version,
            sharePointRelativeFolderPathSnapshot: template.sharePointRelativeFolderPath,
            title: submitted.configuration?.title
              || DEFAULT_DOCUMENT_GENERATION_TITLE_PATTERN,
            content: '',
            status: 'DRAFT',
            useLetterhead: submitted.configuration?.useLetterhead ?? false,
            createdById: params.userId,
            metadata: {
              batchItem: true,
              ...(current.taskContext ? { taskIntegrationContext: current.taskContext } : {}),
            },
          },
        });
        await tx.documentGenerationBatchItem.create({
          data: {
            tenantId: params.tenantId,
            batchId: id,
            templateId: template.id,
            generatedDocumentId: child.id,
            templateVersion: template.version,
            displayOrder,
            configuration: (submitted.configuration
              ?? defaultItemConfiguration(template.name)) as never,
          },
        });
      }
    }

    const syncedItems = await tx.documentGenerationBatchItem.findMany({
      where: { batchId: id },
      include: batchItemInclude,
    });
    const diagnostics: Array<{ itemId: string; error: string }> = [];
    for (const item of syncedItems) {
      if (item.status === 'GENERATED') continue;
      const configuration = parseBatchItemConfiguration(item.configuration);
      if (!configuration.serviceAgreement) continue;
      try {
        const result = await syncServiceAgreementForItem(
          tx,
          params,
          item.generatedDocumentId,
          configuration,
          input.primaryCompanyId !== undefined
            ? input.primaryCompanyId
            : current.primaryCompanyId,
        );
        if (!result.synced && result.error) {
          diagnostics.push({ itemId: item.id, error: result.error });
        }
      } catch (error) {
        diagnostics.push({
          itemId: item.id,
          error: error instanceof Error ? error.message : 'Service Agreement could not be saved',
        });
      }
    }
    for (const diagnostic of diagnostics) {
      await tx.documentGenerationBatchItem.update({
        where: { id: diagnostic.itemId },
        data: {
          status: 'NEEDS_INPUT',
          reviewedFingerprint: null,
          validationDiagnostics: {
            itemId: diagnostic.itemId,
            status: 'NEEDS_INPUT',
            errors: [diagnostic.error],
            fieldErrors: [],
          } as never,
        },
      });
    }

    const finalItems = await tx.documentGenerationBatchItem.findMany({
      where: { batchId: id },
      select: { status: true },
    });
    const status = computeBatchStatus(finalItems.map((item) => item.status));

    const resolveActiveItemId = (): string | null => {
      if (input.activeItemId === undefined) return current.activeItemId;
      if (input.activeItemId === null) return null;
      const direct = syncedItems.find((item) => item.id === input.activeItemId);
      if (direct) return direct.id;
      const byTemplate = syncedItems.find(
        (item) => item.templateId === input.activeItemId,
      );
      return byTemplate?.id ?? input.activeItemId;
    };

    return tx.documentGenerationBatch.update({
      where: { id },
      data: {
        currentStage: input.currentStage ?? current.currentStage,
        primaryCompanyId:
          input.primaryCompanyId !== undefined
            ? input.primaryCompanyId
            : current.primaryCompanyId,
        activeItemId: resolveActiveItemId(),
        masterFieldValues: (
          input.masterFieldValues !== undefined
            ? input.masterFieldValues
            : (current.masterFieldValues as Record<string, string>)
        ) as Prisma.InputJsonValue,
        taskContext: (
          input.taskContext !== undefined
            ? input.taskContext
            : current.taskContext
        ) as never,
        status,
      },
      include: batchInclude,
    });
  });

  await createAuditLog({
    tenantId: params.tenantId,
    userId: params.userId,
    companyId: batch.primaryCompanyId ?? undefined,
    action: 'UPDATE',
    entityType: 'DocumentGenerationBatch',
    entityId: batch.id,
    entityName: `Generation batch (${batch.items.length} documents)`,
    summary: `Saved document generation batch "${batch.id}"`,
    changeSource: 'MANUAL',
    metadata: {
      itemCount: batch.items.length,
      stage: batch.currentStage,
      revision: batch.revision,
    },
  });

  const catalogue = await catalogueForBatch(batch);
  return mapBatchToDto(batch, catalogue);
}

export async function discardDocumentGenerationBatch(
  id: string,
  input: { expectedRevision?: number },
  params: TenantAwareParams,
): Promise<{ discardedItemCount: number; preservedItemCount: number }> {
  const result = await prisma.$transaction(async (tx) => {
    const batch = await tx.documentGenerationBatch.findFirst({
      where: { id, tenantId: params.tenantId, deletedAt: null },
      include: batchInclude,
    }) as BatchWithRelations | null;
    if (!batch) throw new NotFoundError('Document generation batch not found');
    if (input.expectedRevision !== undefined) {
      const claimed = await tx.documentGenerationBatch.updateMany({
        where: {
          id,
          tenantId: params.tenantId,
          deletedAt: null,
          revision: input.expectedRevision,
        },
        data: { revision: { increment: 1 } },
      });
      if (claimed.count !== 1) throw await revisionConflict(id, params.tenantId);
    }

    let discardedItemCount = 0;
    let preservedItemCount = 0;
    for (const item of batch.items) {
      if (hasDurableGeneratedOutput(item)) {
        preservedItemCount += 1;
        continue;
      }
      const agreement = item.generatedDocument?.serviceAgreement;
      if (agreement && agreement.status === 'DRAFT') {
        await tx.serviceAgreement.delete({ where: { id: agreement.id } });
      }
      await claimGeneratedDocumentRevision(tx, {
        id: item.generatedDocumentId,
        tenantId: params.tenantId,
        allowedStatuses: ['DRAFT'],
      });
      await tx.generatedDocument.update({
        where: { id: item.generatedDocumentId },
        data: { deletedAt: new Date() },
      });
      discardedItemCount += 1;
    }
    await tx.documentGenerationBatch.update({
      where: { id },
      data: { deletedAt: new Date(), activeItemId: null },
    });
    return { discardedItemCount, preservedItemCount, batch };
  });

  await createAuditLog({
    tenantId: params.tenantId,
    userId: params.userId,
    companyId: result.batch.primaryCompanyId ?? undefined,
    action: 'DELETE',
    entityType: 'DocumentGenerationBatch',
    entityId: id,
    entityName: `Generation batch (${result.batch.items.length} documents)`,
    summary: `Discarded document generation batch with ${result.discardedItemCount} unfinished documents`,
    changeSource: 'MANUAL',
    metadata: {
      discardedItemCount: result.discardedItemCount,
      preservedItemCount: result.preservedItemCount,
    },
  });

  return {
    discardedItemCount: result.discardedItemCount,
    preservedItemCount: result.preservedItemCount,
  };
}

export async function adoptLegacyGenerationSession(
  draftId: string,
  input: CreateDocumentGenerationBatchInput,
  params: TenantAwareParams,
  taskContext?: TaskLaunchContext,
): Promise<DocumentGenerationBatchDto> {
  const document = await prisma.generatedDocument.findFirst({
    where: { id: draftId, tenantId: params.tenantId, deletedAt: null },
  });
  if (!document) {
    throw new NotFoundError('Document draft not found');
  }

  const existingItem = await prisma.documentGenerationBatchItem.findFirst({
    where: { generatedDocumentId: draftId, tenantId: params.tenantId },
    select: { batchId: true },
  });
  if (existingItem) {
    const existingBatch = await getDocumentGenerationBatch(existingItem.batchId, params);
    await safelyLinkBatchOutcome(existingBatch, params, taskContext);
    return existingBatch;
  }

  const state = readActiveGenerationSession(document.metadata);
  if (!state) {
    throw new NotFoundError('Document draft not found');
  }
  const observedRevision = await readGeneratedDocumentRevision(
    prisma,
    document.id,
    params.tenantId,
  );

  const templateId = state.templateId ?? input.items[0].templateId;
  const template = await prisma.documentTemplate.findFirst({
    where: { id: templateId, tenantId: params.tenantId, deletedAt: null },
  });
  if (!template) throw new NotFoundError('Template not found');

  const agreement = state.serviceAgreementId
    ? await prisma.serviceAgreement.findFirst({
        where: {
          id: state.serviceAgreementId,
          tenantId: params.tenantId,
          generatedDocumentId: draftId,
        },
      })
    : null;

  const configuration: BatchItemConfiguration = {
    version: 1,
    title: state.title || DEFAULT_DOCUMENT_GENERATION_TITLE_PATTERN,
    contactIds: state.contactIds,
    selectedDirectorId: state.selectedDirectorId ?? null,
    selectedShareholderId: state.selectedShareholderId ?? null,
    selectedContactId: state.selectedContactId ?? null,
    itemValues: state.customData ?? {},
    masterOverrides: {},
    useLetterhead: state.useLetterhead,
    serviceAgreement: agreement
      ? serviceAgreementWorkspaceFromDto(agreement as unknown as ServiceAgreementDraftDto)
      : null,
  };

  let batch: BatchWithRelations;
  try {
    batch = (await prisma.$transaction(async (tx) => {
      // Claim the adopted document before creating ownership records. This makes
      // concurrent migration requests serialize on the authoritative document
      // revision instead of racing to create duplicate batches/items.
      await claimGeneratedDocumentRevision(tx, {
        id: document.id,
        tenantId: params.tenantId,
        expectedRevision: observedRevision,
        allowedStatuses: ['DRAFT'],
      });

      const created = await tx.documentGenerationBatch.create({
        data: {
          tenantId: params.tenantId,
          createdById: params.userId,
          primaryCompanyId: state.companyId ?? null,
          currentStage: Math.min(state.currentStep, 3),
          status: 'DRAFT',
          masterFieldValues: {},
          taskContext: taskLaunchContextToJson(taskContext) as never,
        },
      });
      const item = await tx.documentGenerationBatchItem.create({
        data: {
          tenantId: params.tenantId,
          batchId: created.id,
          templateId: template.id,
          generatedDocumentId: document.id,
          templateVersion: template.version,
          displayOrder: 0,
          configuration: configuration as never,
          previewContent: state.previewContent,
          editedContent: state.editedContent,
          editedContentJson: state.editedContentJson
            ? (state.editedContentJson as never)
            : Prisma.DbNull,
        },
      });
      const metadata = { ...(document.metadata as Record<string, unknown>) };
      delete metadata.generationSession;
      await tx.generatedDocument.update({
        where: { id: document.id },
        data: {
          metadata: metadata as never,
          title: configuration.title,
          useLetterhead: configuration.useLetterhead,
        },
      });
      await tx.documentGenerationBatch.update({
        where: { id: created.id },
        data: { activeItemId: item.id },
      });
      return tx.documentGenerationBatch.findFirstOrThrow({
        where: { id: created.id },
        include: batchInclude,
      });
    })) as BatchWithRelations;
  } catch (error) {
    if (error instanceof VersionConflictError) {
      const owner = await prisma.documentGenerationBatchItem.findFirst({
        where: { generatedDocumentId: draftId, tenantId: params.tenantId },
        select: { batchId: true },
      });
      if (owner) {
        const existingBatch = await getDocumentGenerationBatch(owner.batchId, params);
        await safelyLinkBatchOutcome(existingBatch, params, taskContext);
        return existingBatch;
      }
    }
    throw error;
  }

  await createAuditLog({
    tenantId: params.tenantId,
    userId: params.userId,
    companyId: state.companyId ?? undefined,
    action: 'CREATE',
    entityType: 'DocumentGenerationBatch',
    entityId: batch.id,
    entityName: `Generation batch (1 document)`,
    summary: 'Adopted legacy generation session into a batch',
    changeSource: 'MANUAL',
    metadata: { legacyDraftId: draftId },
  });

  await safelyLinkBatchOutcome(batch, params, taskContext);
  const catalogue = await catalogueForBatch(batch);
  return mapBatchToDto(batch, catalogue);
}

export function staleClaimPredicate(now = new Date()): {
  OR: Array<{ generationClaimedAt: null } | { generationClaimedAt: { lt: Date } }>;
} {
  return {
    OR: [
      { generationClaimedAt: null },
      { generationClaimedAt: { lt: new Date(now.getTime() - STALE_CLAIM_MS) } },
    ],
  };
}

export { STALE_CLAIM_MS };
