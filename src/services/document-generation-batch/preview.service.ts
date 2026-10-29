import { createHash, randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@/generated/prisma';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@/lib/errors';
import {
  normalizePlaceholderKey,
  normalizeStoredPlaceholders,
  storageFormatToCustomPlaceholders,
} from '@/lib/template-analysis';
import {
  canonicalPlaceholderType,
  masterFieldId,
} from '@/lib/document-generation-master-fields';
import {
  normalizeStoredFieldDefinitionInput,
  resolveTopLevelCustomValues,
  isWorkflowFieldValuePresent,
} from '@/lib/document-editor/template-field-workflow';
import { loadStoredFieldRegistry } from '@/lib/template-field-registry';
import {
  createPreviewFingerprint,
  createReviewedFingerprint,
} from '@/lib/document-generation-fingerprint';
import {
  resolveDocumentGenerationTitle,
  selectDocumentGenerationTitleDate,
} from '@/lib/document-generation-title';
import { claimGeneratedDocumentRevision } from '@/lib/document-editor/generated-document-revision';
import { renderTemplateForWorkflow } from '@/services/document-workflow-renderer.service';
import {
  getDocumentTemplateEngine,
  mergeGeneratedOakDocMetadata,
  mergeOakDocReviewDraftMetadata,
  OAKDOC_GENERATED_CONTENT,
  readGeneratedOakDocAssetMetadata,
  readOakDocEditedContentMetadata,
  readOakDocReviewDraftMetadata,
  type GeneratedOakDocAssetMetadata,
} from '@/lib/document-editor/document-engine';
import { OAKDOC_MIME_TYPE } from '@/lib/document-editor/oakdoc-template';
import { resolutionPartialIds } from '@/lib/resolution-composition';
import { withResolutionPartialFields } from '@/services/oakdoc-partial.service';
import {
  generateOakDocBytes,
  type OakDocGenerationInput,
  type OakDocGenerationResult,
} from '@/services/oakdoc-generation.service';
import { storage, StorageKeys } from '@/lib/storage';
import type {
  BatchItemMutationInput,
  DocumentGenerationBatchDto,
} from '@/types/document-generation-batch';
import type { CustomPlaceholderDefinition } from '@/types/placeholders';
import type { TenantAwareParams } from '@/lib/types';
import {
  loadMasterCatalogueForTemplateIds,
  loadBatchForService,
  revisionConflict,
} from './lifecycle.service';
import {
  mapBatchToDto,
  parseBatchItemConfiguration,
} from './mapper';
import {
  batchInclude,
  type BatchItemWithRelations,
  type BatchWithRelations,
} from './types';

export interface EvaluatedPreview {
  content: string;
  fingerprint: string;
  blockingErrors: string[];
  effectiveCustomData: Record<string, unknown>;
  resolvedTitle: string;
  templateVersion: number;
  rendered: Awaited<ReturnType<typeof renderTemplateForWorkflow>> | null;
  oakDocGeneration: OakDocGenerationResult | null;
}

async function templateCustomFields(
  templateId: string,
  tenantId: string,
  resolutionPartialIdList: readonly string[] = [],
): Promise<{
  ownFields: CustomPlaceholderDefinition[];
  storedDefinitions: Readonly<Record<string, unknown>>[];
  titleDateFieldKey: string | null;
}> {
  const template = await prisma.documentTemplate.findFirst({
    where: { id: templateId, tenantId, deletedAt: null },
    select: { id: true, placeholders: true, contentJson: true },
  });
  if (!template) throw new NotFoundError('Template not found');
  const placeholders = await withResolutionPartialFields(
    template.placeholders,
    resolutionPartialIdList,
    tenantId,
  );
  const storedDefinitions = normalizeStoredFieldDefinitionInput(placeholders);
  const ownFields = storageFormatToCustomPlaceholders(
    normalizeStoredPlaceholders(placeholders),
    { scope: { kind: 'template', id: template.id } },
  ).filter((field) => !field.sourcePartial);
  const contentJson = template.contentJson;
  const titleDateFieldKey = contentJson
    && typeof contentJson === 'object'
    && !Array.isArray(contentJson)
    && typeof (contentJson as Record<string, unknown>).documentTitleDateFieldKey === 'string'
    ? (contentJson as Record<string, string>).documentTitleDateFieldKey
    : null;
  return { ownFields, storedDefinitions, titleDateFieldKey };
}

function typedBatchCustomData(input: {
  templateId: string;
  storedDefinitions: readonly Readonly<Record<string, unknown>>[];
  ownFields: readonly CustomPlaceholderDefinition[];
  masterValues: Readonly<Record<string, string>>;
  overrides: Readonly<Record<string, string>>;
  itemValues: Readonly<Record<string, unknown>>;
}): Record<string, unknown> {
  const scope = { kind: 'template' as const, id: input.templateId };
  const registry = loadStoredFieldRegistry({ scope, definitions: input.storedDefinitions });
  const overridesByIdentity: Record<string, unknown> = {};
  const mastersByIdentity: Record<string, unknown> = {};
  const ownByKey = new Map(input.ownFields.map((field) => [normalizePlaceholderKey(field.key), field]));

  for (const definition of registry.definitions) {
    if (typeof definition.original.sourcePartial === 'string') continue;
    const field = ownByKey.get(normalizePlaceholderKey(definition.key));
    if (!field) continue;
    const aggregateId = masterFieldId(
      normalizePlaceholderKey(field.key),
      canonicalPlaceholderType(field.type),
    );
    if (Object.prototype.hasOwnProperty.call(input.overrides, aggregateId)) {
      overridesByIdentity[definition.identity] = input.overrides[aggregateId];
    }
    if (Object.prototype.hasOwnProperty.call(input.masterValues, aggregateId)) {
      mastersByIdentity[definition.identity] = input.masterValues[aggregateId];
    }
  }

  return resolveTopLevelCustomValues({
    definitions: input.storedDefinitions,
    scope,
    itemValues: input.itemValues,
    documentOverrides: overridesByIdentity,
    sharedMasterValues: mastersByIdentity,
  });
}

function stringValues(values: Readonly<Record<string, unknown>>): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'string') output[key] = value;
  }
  return output;
}

/** Party and agreement inputs a batch item supplies to OakDoc generation. */
export function oakDocBatchContext(
  configuration: ReturnType<typeof parseBatchItemConfiguration>,
  effectiveCustomData: Record<string, unknown>,
  serviceAgreementId?: string | null,
): Pick<
  OakDocGenerationInput,
  | 'selectedContactId'
  | 'contactIds'
  | 'customData'
  | 'selectedDirectorIds'
  | 'selectedShareholderIds'
  | 'selectedOfficerIds'
  | 'selectedContactListIds'
  | 'personValues'
  | 'agreement'
  | 'resolutionDate'
  | 'serviceAgreementId'
  | 'resolution'
  | 'companyFieldValues'
> {
  const resolutionDate = effectiveCustomData.resolution_date;
  const agreement = configuration.serviceAgreement;
  return {
    selectedContactId: configuration.selectedContactId ?? undefined,
    contactIds: configuration.contactIds,
    customData: effectiveCustomData,
    selectedDirectorIds: configuration.selectedDirectorIds,
    selectedShareholderIds: configuration.selectedShareholderIds,
    selectedOfficerIds: configuration.selectedOfficerIds,
    selectedContactListIds: configuration.selectedContactListIds,
    personValues: configuration.personValues,
    agreement: agreement
      ? {
          agreementDate: agreement.agreementDate,
          effectiveDate: agreement.effectiveDate,
          termMonths: agreement.termMonths,
        }
      : undefined,
    resolutionDate: resolutionDate instanceof Date || typeof resolutionDate === 'string'
      ? resolutionDate
      : undefined,
    ...(serviceAgreementId ? { serviceAgreementId } : {}),
    ...(configuration.resolution ? { resolution: configuration.resolution } : {}),
    ...(hasCompanyFieldValues(configuration)
      ? { companyFieldValues: configuration.companyFieldValues }
      : {}),
  };
}

function hasCompanyFieldValues(
  configuration: ReturnType<typeof parseBatchItemConfiguration>,
): boolean {
  return Object.keys(configuration.companyFieldValues ?? {}).length > 0;
}

export async function buildBatchItemRenderInput(
  batch: BatchWithRelations,
  item: BatchItemWithRelations,
  params: TenantAwareParams,
  actorName: string,
): Promise<EvaluatedPreview> {
  const configuration = parseBatchItemConfiguration(item.configuration);
  const templateFieldConfig = await templateCustomFields(
    item.templateId,
    params.tenantId,
    resolutionPartialIds(configuration.resolution),
  );
  const effectiveCustomData = typedBatchCustomData({
    templateId: item.templateId,
    storedDefinitions: templateFieldConfig.storedDefinitions,
    ownFields: templateFieldConfig.ownFields,
    masterValues: (batch.masterFieldValues ?? {}) as Record<string, string>,
    overrides: configuration.masterOverrides,
    itemValues: configuration.itemValues,
  });
  const agreement = item.generatedDocument?.serviceAgreement;
  const titleValues = stringValues(effectiveCustomData);
  const titleDate = selectDocumentGenerationTitleDate({
    values: titleValues,
    selectedFieldKey: item.template.compositionType !== 'SERVICE_AGREEMENT'
      ? templateFieldConfig.titleDateFieldKey
      : null,
    serviceAgreementDate: configuration.serviceAgreement?.agreementDate
      ?? agreement?.agreementDate.toISOString().slice(0, 10),
  });
  const selectedTitleDateMissing = item.template.compositionType !== 'SERVICE_AGREEMENT'
    && configuration.title.includes('{{date}}')
    && Boolean(templateFieldConfig.titleDateFieldKey)
    && !isWorkflowFieldValuePresent(
      effectiveCustomData[templateFieldConfig.titleDateFieldKey!],
    );
  const titleErrors = selectedTitleDateMissing
    ? ['The selected document title date is missing']
    : [];
  const resolvedTitle = resolveDocumentGenerationTitle({
    title: configuration.title,
    templateName: item.template.name,
    companyName: batch.primaryCompany?.name,
    date: titleDate,
  });
  const engine = getDocumentTemplateEngine(item.template.contentJson);
  if (engine === 'OAKDOC') {
    if (!batch.primaryCompanyId) {
      throw new ValidationError('Select a primary company before previewing an OakDoc document');
    }
    const oakdoc = await generateOakDocBytes({
      templateId: item.templateId,
      companyId: batch.primaryCompanyId,
      selectedDirectorId: configuration.selectedDirectorId ?? undefined,
      selectedShareholderId: configuration.selectedShareholderId ?? undefined,
      ...oakDocBatchContext(configuration, effectiveCustomData, agreement?.id),
      generatedBy: actorName,
    }, params);
    const fingerprint = createPreviewFingerprint({
      templateId: item.templateId,
      templateVersion: oakdoc.template.version,
      // Source identity, not just the version number.
      templateSha256: oakdoc.template.sha256,
      agreementHash: oakdoc.agreementHash,
      partials: (oakdoc.resolutionPartialPins ?? []).map((pin) => ({
        name: pin.partialId,
        version: pin.version,
      })),
      primaryCompanyId: batch.primaryCompanyId,
      contactIds: configuration.contactIds,
      selectedDirectorId: configuration.selectedDirectorId,
      selectedDirectorIds: configuration.selectedDirectorIds,
      selectedShareholderId: configuration.selectedShareholderId,
      selectedShareholderIds: configuration.selectedShareholderIds,
      selectedOfficerIds: configuration.selectedOfficerIds,
      selectedContactListIds: configuration.selectedContactListIds,
      personValues: configuration.personValues,
      selectedContactId: configuration.selectedContactId,
      effectiveCustomData,
      itemValues: configuration.itemValues,
      useLetterhead: false,
      agreementData: configuration.serviceAgreement ?? undefined,
      resolutionData: configuration.resolution ?? undefined,
      companyFieldValues: hasCompanyFieldValues(configuration)
        ? configuration.companyFieldValues
        : undefined,
    });
    return {
      content: OAKDOC_GENERATED_CONTENT,
      fingerprint,
      blockingErrors: [
        ...oakdoc.diagnostics
          .filter((diagnostic) => diagnostic.severity === 'error')
          .map((diagnostic) => diagnostic.message),
        ...titleErrors,
      ],
      effectiveCustomData,
      resolvedTitle,
      templateVersion: oakdoc.template.version,
      rendered: null,
      oakDocGeneration: oakdoc,
    };
  }

  const rendered = await renderTemplateForWorkflow({
    templateId: item.templateId,
    tenantId: params.tenantId,
    userId: params.userId,
    companyId: batch.primaryCompanyId,
    contactIds: configuration.contactIds,
    selectedDirectorId: configuration.selectedDirectorId ?? undefined,
    selectedDirectorIds: configuration.selectedDirectorIds,
    selectedShareholderId: configuration.selectedShareholderId ?? undefined,
    selectedContactId: configuration.selectedContactId ?? undefined,
    customData: effectiveCustomData,
    generatedBy: actorName,
    mode: 'preview',
    serviceAgreementId: agreement?.id ?? undefined,
    generatedDocumentId: item.generatedDocumentId,
  });
  const fingerprint = createPreviewFingerprint({
    templateId: item.templateId,
    templateVersion: rendered.template.version,
    partials: rendered.dependencySnapshot.partials,
    serviceAgreement: rendered.dependencySnapshot.serviceAgreement,
    primaryCompanyId: batch.primaryCompanyId,
    contactIds: configuration.contactIds,
    selectedDirectorId: configuration.selectedDirectorId,
    selectedDirectorIds: configuration.selectedDirectorIds,
    selectedShareholderId: configuration.selectedShareholderId,
    selectedContactId: configuration.selectedContactId,
    effectiveCustomData,
    itemValues: configuration.itemValues,
    useLetterhead: configuration.useLetterhead,
    agreementData: configuration.serviceAgreement ?? undefined,
  });
  return {
    content: rendered.content,
    fingerprint,
    blockingErrors: [...rendered.blockingErrors, ...titleErrors],
    effectiveCustomData,
    resolvedTitle,
    templateVersion: rendered.template.version,
    rendered,
    oakDocGeneration: null,
  };
}

function oakDocPreviewFileName(title: string): string {
  const base = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || 'OakDoc';
  return base.toLowerCase().endsWith('.docx') ? base : `${base}.docx`;
}

function itemNotFound(itemId: string): NotFoundError {
  return new NotFoundError('Batch item not found', { itemId });
}

function evaluateDiagnostics(
  itemId: string,
  evaluated: EvaluatedPreview,
  reviewedFingerprint: string | null,
  currentFingerprint: string | null,
) {
  const errors = [...evaluated.blockingErrors];
  if (currentFingerprint && evaluated.fingerprint !== currentFingerprint) {
    errors.push('Preview inputs changed since the last render');
  }
  const awaitingReview = Boolean(evaluated.fingerprint) && !reviewedFingerprint;
  return {
    itemId,
    status: errors.length > 0
      ? ('NEEDS_INPUT' as const)
      : awaitingReview
        ? ('PREVIEWED' as const)
        : ('READY' as const),
    errors,
    fieldErrors: [],
  };
}

export async function previewDocumentGenerationBatchItem(
  batchId: string,
  itemId: string,
  input: BatchItemMutationInput,
  params: TenantAwareParams,
): Promise<DocumentGenerationBatchDto> {
  const oakDocUpload = {
    newKey: null as string | null,
    previousKey: null as string | null,
  };

  try {
    const batch = await prisma.$transaction(async (tx) => {
      const claimed = await tx.documentGenerationBatch.updateMany({
        where: {
          id: batchId,
          tenantId: params.tenantId,
          deletedAt: null,
          revision: input.expectedRevision,
        },
        data: { revision: { increment: 1 } },
      });
      if (claimed.count !== 1) {
        throw await revisionConflict(batchId, params.tenantId);
      }
      const loaded = await loadBatchForService(batchId, params, tx);
      if (!loaded) throw new NotFoundError('Document generation batch not found');
      const item = loaded.items.find((entry) => entry.id === itemId);
      if (!item) throw itemNotFound(itemId);
      if (item.status === 'GENERATED') {
        throw new ValidationError('Generated documents cannot be previewed again');
      }

      const hasManualEdits = Boolean(
        (item.editedContent && item.editedContent !== item.previewContent)
        || item.editedContentJson,
      );
      if (hasManualEdits && !input.replaceEditedContent) {
        throw new ConflictError(
          'Refreshing the preview would replace manual edits',
          { requiresReplaceEditedContent: true },
        );
      }

      const creator = await tx.user.findFirst({
        where: { id: params.userId, tenantId: params.tenantId },
        select: { firstName: true, lastName: true },
      });
      const actorName = creator
        ? [creator.firstName, creator.lastName].filter(Boolean).join(' ').trim()
        : '';
      const evaluated = await buildBatchItemRenderInput(loaded, item, params, actorName);
      const diagnostics = evaluateDiagnostics(
        item.id,
        evaluated,
        null,
        item.previewFingerprint,
      );

      await tx.documentGenerationBatchItem.update({
        where: { id: item.id },
        data: {
          templateVersion: evaluated.templateVersion,
          previewContent: evaluated.content,
          previewFingerprint: evaluated.fingerprint,
          reviewedFingerprint: null,
          editedContent: null,
          editedContentJson: Prisma.DbNull,
          status: diagnostics.status,
          validationDiagnostics: diagnostics as never,
        },
      });

      if (evaluated.oakDocGeneration) {
        const generation = evaluated.oakDocGeneration;
        const generatedAt = new Date().toISOString();
        const digest = createHash('sha256').update(generation.bytes).digest('hex');
        const storageKey = StorageKeys.oakDocGeneratedAsset(
          params.tenantId,
          item.generatedDocumentId,
          randomUUID(),
        );
        const previousAsset = readGeneratedOakDocAssetMetadata(item.generatedDocument.metadata);

        await storage.upload(storageKey, generation.bytes, {
          contentType: OAKDOC_MIME_TYPE,
          metadata: {
            tenantId: params.tenantId,
            generatedDocumentId: item.generatedDocumentId,
            templateId: generation.template.id,
            templateVersion: String(generation.template.version),
            templateSha256: generation.template.sha256,
            sha256: digest,
            generatedBy: params.userId,
            previewFingerprint: evaluated.fingerprint,
          },
        });
        oakDocUpload.newKey = storageKey;
        oakDocUpload.previousKey = previousAsset?.storageKey ?? null;

        const assetMetadata: GeneratedOakDocAssetMetadata = {
          ...generation.metadata,
          storageKey,
          fileName: oakDocPreviewFileName(evaluated.resolvedTitle),
          fileSize: generation.bytes.byteLength,
          sha256: digest,
          generatedAt,
        };
        const configuration = parseBatchItemConfiguration(item.configuration);
        const selectedParties = {
          ...(configuration.selectedDirectorId
            ? { directorId: configuration.selectedDirectorId }
            : {}),
          ...(configuration.selectedShareholderId
            ? { shareholderId: configuration.selectedShareholderId }
            : {}),
          ...(configuration.selectedContactId
            ? { selectedContactId: configuration.selectedContactId }
            : {}),
          ...(configuration.contactIds.length
            ? { contactIds: configuration.contactIds }
            : {}),
        };
        const generatedMetadata = mergeGeneratedOakDocMetadata(
          item.generatedDocument.metadata,
          assetMetadata,
          selectedParties,
        );
        const metadata = mergeOakDocReviewDraftMetadata(generatedMetadata, {
          schemaVersion: 1,
          previewFingerprint: evaluated.fingerprint,
          savedAt: generatedAt,
          edited: false,
        });

        await claimGeneratedDocumentRevision(tx, {
          id: item.generatedDocumentId,
          tenantId: params.tenantId,
          expectedRevision: item.generatedDocument.revision,
          allowedStatuses: ['DRAFT'],
        });
        await tx.generatedDocument.update({
          where: { id: item.generatedDocumentId },
          data: {
            template: { connect: { id: generation.template.id } },
            templateVersion: generation.template.version,
            company: loaded.primaryCompanyId
              ? { connect: { id: loaded.primaryCompanyId } }
              : undefined,
            title: evaluated.resolvedTitle,
            content: OAKDOC_GENERATED_CONTENT,
            contentJson: {
              documentEngine: 'OAKDOC',
              schemaVersion: 1,
            } as Prisma.InputJsonValue,
            useLetterhead: false,
            placeholderData: generation.values as Prisma.InputJsonValue,
            metadata: metadata as Prisma.InputJsonValue,
          },
        });
      } else {
        await claimGeneratedDocumentRevision(tx, {
          id: item.generatedDocumentId,
          tenantId: params.tenantId,
          allowedStatuses: ['DRAFT'],
        });
        await tx.generatedDocument.update({
          where: { id: item.generatedDocumentId },
          data: { title: evaluated.resolvedTitle },
        });
      }

      return tx.documentGenerationBatch.findFirstOrThrow({
        where: { id: batchId },
        include: batchInclude,
      });
    });

    const uploadedOakDocKey = oakDocUpload.newKey;
    const previousOakDocKey = oakDocUpload.previousKey;
    if (previousOakDocKey && uploadedOakDocKey && previousOakDocKey !== uploadedOakDocKey) {
      const assetPrefix = uploadedOakDocKey.slice(0, uploadedOakDocKey.lastIndexOf('/') + 1);
      if (assetPrefix && previousOakDocKey.startsWith(assetPrefix)) {
        await storage.delete(previousOakDocKey).catch(() => undefined);
      }
    }

    const catalogue = await loadMasterCatalogueForTemplateIds(
      batch.items.map((entry) => entry.templateId),
      params.tenantId,
    );
    return mapBatchToDto(batch, catalogue);
  } catch (error) {
    if (oakDocUpload.newKey) {
      await storage.delete(oakDocUpload.newKey).catch(() => undefined);
    }
    throw error;
  }
}

export async function reviewDocumentGenerationBatchItem(
  batchId: string,
  itemId: string,
  input: { expectedRevision: number },
  params: TenantAwareParams,
): Promise<DocumentGenerationBatchDto> {
  const batch = await prisma.$transaction(async (tx) => {
    const claimed = await tx.documentGenerationBatch.updateMany({
      where: {
        id: batchId,
        tenantId: params.tenantId,
        deletedAt: null,
        revision: input.expectedRevision,
      },
      data: { revision: { increment: 1 } },
    });
    if (claimed.count !== 1) {
      throw await revisionConflict(batchId, params.tenantId);
    }
    const loaded = await loadBatchForService(batchId, params, tx);
    if (!loaded) throw new NotFoundError('Document generation batch not found');
    const item = loaded.items.find((entry) => entry.id === itemId);
    if (!item) throw itemNotFound(itemId);
    if (item.status === 'GENERATED') {
      throw new ValidationError('Generated documents cannot be reviewed again');
    }
    if (!item.previewFingerprint || !item.previewContent) {
      throw new ValidationError('Preview the document before reviewing it');
    }

    const creator = await tx.user.findFirst({
      where: { id: params.userId, tenantId: params.tenantId },
      select: { firstName: true, lastName: true },
    });
    const actorName = creator
      ? [creator.firstName, creator.lastName].filter(Boolean).join(' ').trim()
      : '';
    const evaluated = await buildBatchItemRenderInput(loaded, item, params, actorName);
    if (evaluated.fingerprint !== item.previewFingerprint) {
      throw new ConflictError(
        'The preview is stale. Refresh it before review.',
        { stale: true },
      );
    }
    if (evaluated.blockingErrors.length > 0) {
      throw new ValidationError(
        evaluated.blockingErrors.join('; '),
        { blockingErrors: evaluated.blockingErrors },
      );
    }
    if (getDocumentTemplateEngine(item.template.contentJson) === 'OAKDOC') {
      const asset = readGeneratedOakDocAssetMetadata(item.generatedDocument.metadata);
      const reviewDraft = readOakDocReviewDraftMetadata(item.generatedDocument.metadata);
      if (
        !asset
        || !reviewDraft
        || reviewDraft.previewFingerprint !== item.previewFingerprint
        || asset.templateId !== item.templateId
        || asset.templateVersion !== item.templateVersion
      ) {
        throw new ConflictError(
          'The generated Word draft no longer matches this preview. Refresh it before review.',
          { stale: true },
        );
      }

      if (item.editedContentJson) {
        const edited = readOakDocEditedContentMetadata(item.editedContentJson);
        if (
          !edited
          || edited.previewFingerprint !== item.previewFingerprint
          || edited.oakDocDraftSha256 !== asset.sha256
        ) {
          throw new ConflictError(
            'The saved Word edits no longer match the generated draft. Save or refresh before review.',
            { stale: true },
          );
        }
      } else if (reviewDraft.edited) {
        throw new ConflictError(
          'The generated Word draft has saved edits that are not bound to this batch item.',
          { stale: true },
        );
      }
    }

    const reviewedFingerprint = createReviewedFingerprint({
      previewFingerprint: item.previewFingerprint,
      editedContent: item.editedContent ?? item.previewContent,
      editedContentJson: item.editedContentJson ?? null,
    });
    await tx.documentGenerationBatchItem.update({
      where: { id: item.id },
      data: {
        reviewedFingerprint,
        // Freeze the exact reviewed W3 scoped bytes. W2 generation already
        // treats editedContent as the final materialization override; equality
        // with previewContent is still considered unedited by refresh gating.
        editedContent: item.editedContent ?? item.previewContent,
        status: 'READY',
        validationDiagnostics: Prisma.DbNull,
      },
    });
    await claimGeneratedDocumentRevision(tx, {
      id: item.generatedDocumentId,
      tenantId: params.tenantId,
      allowedStatuses: ['DRAFT'],
    });
    await tx.generatedDocument.update({
      where: { id: item.generatedDocumentId },
      data: { title: evaluated.resolvedTitle },
    });
    return tx.documentGenerationBatch.findFirstOrThrow({
      where: { id: batchId },
      include: batchInclude,
    });
  });
  const catalogue = await loadMasterCatalogueForTemplateIds(
    batch.items.map((entry) => entry.templateId),
    params.tenantId,
  );
  return mapBatchToDto(batch, catalogue);
}
