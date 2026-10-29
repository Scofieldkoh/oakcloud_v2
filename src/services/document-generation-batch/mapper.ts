import { ValidationError } from '@/lib/errors';
import { batchItemConfigurationSchema } from '@/lib/validations/document-generation-batch';
import type { BatchItemConfiguration } from '@/types/document-generation-batch';
import type {
  DocumentGenerationBatchDto,
  DocumentGenerationBatchItemDto,
  BatchItemFailure,
  BatchItemDiagnostics,
  BatchItemStatus,
  ServiceAgreementWorkspaceState,
  MasterFieldCatalogue,
} from '@/types/document-generation-batch';
import type { ServiceAgreementDraftDto } from '@/services/service-agreement/types';
import { getDocumentTemplateDisplayEngine } from '@/lib/document-editor/document-engine';
import type {
  BatchWithRelations,
  BatchItemWithRelations,
} from './types';

export function parseBatchItemConfiguration(value: unknown): BatchItemConfiguration {
  const parsed = batchItemConfigurationSchema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError('Stored batch item configuration is invalid', {
      issues: parsed.error.issues,
    });
  }
  return parsed.data;
}

export function parseLastError(value: unknown): BatchItemFailure | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.code !== 'string'
    || typeof record.message !== 'string'
    || typeof record.occurredAt !== 'string'
  ) {
    return null;
  }
  return {
    itemId: typeof record.itemId === 'string' ? record.itemId : '',
    code: record.code,
    message: record.message,
    occurredAt: record.occurredAt,
  };
}

export function parseValidationDiagnostics(value: unknown): BatchItemDiagnostics | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.itemId !== 'string' || typeof record.status !== 'string') return null;
  return {
    itemId: record.itemId,
    status: record.status as BatchItemStatus,
    errors: Array.isArray(record.errors)
      ? record.errors.filter((entry): entry is string => typeof entry === 'string')
      : [],
    fieldErrors: Array.isArray(record.fieldErrors)
      ? record.fieldErrors.filter(
        (entry): entry is { field: string; message: string } =>
          Boolean(entry)
          && typeof entry === 'object'
          && typeof (entry as { field?: unknown }).field === 'string'
          && typeof (entry as { message?: unknown }).message === 'string',
      )
      : [],
  };
}

function serviceAgreementDto(item: BatchItemWithRelations) {
  return item.generatedDocument?.serviceAgreement ?? null;
}

export function mapBatchItemToDto(
  item: BatchItemWithRelations,
  _catalogue: MasterFieldCatalogue,
): DocumentGenerationBatchItemDto {
  const configuration = parseBatchItemConfiguration(item.configuration);
  const lastError = parseLastError(item.lastError);
  const diagnostics = parseValidationDiagnostics(item.validationDiagnostics);
  return {
    id: item.id,
    templateId: item.templateId,
    templateName: item.template.name,
    templateKind: item.template.compositionType,
    templateVersion: item.templateVersion,
    templateEngine: getDocumentTemplateDisplayEngine(item.template.contentJson),
    displayOrder: item.displayOrder,
    status: item.status,
    configuration,
    previewContent: item.previewContent,
    editedContent: item.editedContent,
    editedContentJson: item.editedContentJson ?? null,
    previewFingerprint: item.previewFingerprint,
    reviewedFingerprint: item.reviewedFingerprint,
    validationDiagnostics: diagnostics,
    lastError,
    generatedDocumentId: item.generatedDocumentId,
    generatedDocumentTitle: item.generatedDocument?.title ?? null,
    serviceAgreement: serviceAgreementDto(item) as never,
  };
}

export function mapBatchToDto(
  batch: BatchWithRelations,
  catalogue: MasterFieldCatalogue,
): DocumentGenerationBatchDto {
  return {
    id: batch.id,
    primaryCompanyId: batch.primaryCompanyId,
    company: batch.primaryCompany,
    activeItemId: batch.activeItemId,
    currentStage: batch.currentStage,
    revision: batch.revision,
    status: batch.status,
    masterFieldValues: (batch.masterFieldValues ?? {}) as Record<string, string>,
    masterFields: catalogue,
    taskContext: batch.taskContext ?? null,
    createdAt: batch.createdAt.toISOString(),
    updatedAt: batch.updatedAt.toISOString(),
    items: batch.items.map((item) => mapBatchItemToDto(item, catalogue)),
  };
}

export function serviceAgreementWorkspaceFromDto(
  saved: ServiceAgreementDraftDto,
): ServiceAgreementWorkspaceState {
  return {
    authorizedContactIds: saved.authorizedContactIds,
    authorizedRepresentativeRoles: Object.fromEntries(
      saved.authorizedRepresentativeSnapshots.flatMap((representative) =>
        representative.role ? [[representative.id, representative.role]] : []),
    ),
    signerContactIds: saved.signerContactIds,
    entityIds: saved.entities.map((entity) => entity.companyId),
    agreementDate: saved.agreementDate,
    effectiveDate: saved.effectiveDate,
    termMonths: saved.termMonths,
    items: saved.items.map((item) => ({
      id: item.id,
      clientKey: item.id,
      variantId: item.serviceVariantId,
      entityIds: item.entityIds
        .map((entityId) =>
          saved.entities.find((entity) => entity.id === entityId)?.companyId)
        .filter((id): id is string => Boolean(id)),
      startDate: item.startDate,
      startDateOverridden: item.startDate !== saved.agreementDate,
      endDate: item.endDate,
      fieldValues: item.fieldValues,
      displayOrder: item.displayOrder,
      feeLines: item.feeLines.map((fee) => ({
        id: fee.id,
        clientKey: fee.id,
        companyId: fee.companyId,
        description: fee.description,
        amount: fee.amount,
        currency: fee.currency,
        billingFrequency: fee.billingFrequency,
        customFrequencyLabel: fee.customFrequencyLabel ?? null,
        billingStartDate: fee.billingStartDate,
        billingStartDateOverridden: fee.billingStartDate !== item.startDate,
        displayOrder: fee.displayOrder,
      })),
    })),
  };
}
