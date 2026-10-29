import type { ServiceAgreementDraftDto } from './types';

export function canonicalServiceAgreementData(
  agreement: ServiceAgreementDraftDto,
): Record<string, unknown> {
  const entities = [...agreement.entities].sort(
    (left, right) =>
      left.displayOrder - right.displayOrder || left.companyId.localeCompare(right.companyId),
  );
  const entityOrder = new Map(
    entities.map((entity, index) => [entity.id, index]),
  );
  const entityCompanyById = new Map(
    entities.map((entity) => [entity.id, entity.companyId]),
  );
  const items = [...agreement.items].sort(
    (left, right) =>
      left.displayOrder - right.displayOrder || left.id.localeCompare(right.id),
  );

  return {
    id: agreement.id,
    generatedDocumentId: agreement.generatedDocumentId,
    primaryCompanyId: agreement.primaryCompanyId,
    authorizedContactIds: agreement.authorizedContactIds,
    signerContactIds: agreement.signerContactIds,
    authorizedRepresentativeSnapshots: agreement.authorizedRepresentativeSnapshots,
    agreementDate: agreement.agreementDate,
    effectiveDate: agreement.effectiveDate,
    termMonths: agreement.termMonths,
    status: agreement.status,
    entities: entities.map((entity) => ({
      companyId: entity.companyId,
      nameSnapshot: entity.nameSnapshot,
      uenSnapshot: entity.uenSnapshot,
      displayOrder: entity.displayOrder,
    })),
    items: items.map((item) => ({
      id: item.id,
      serviceVariantId: item.serviceVariantId,
      variantVersion: item.variantVersion,
      familyNameSnapshot: item.familyNameSnapshot,
      variantNameSnapshot: item.variantNameSnapshot,
      serviceCadence: item.serviceCadence,
      customCadenceLabel: item.customCadenceLabel,
      sowPartialId: item.sowPartialId,
      partialVersion: item.partialVersion,
      partialContentSnapshot: item.partialContentSnapshot,
      partialPlaceholdersSnapshot: item.partialPlaceholdersSnapshot,
      partialDependencySnapshot: item.partialDependencySnapshot,
      startDate: item.startDate,
      endDate: item.endDate,
      fieldValues: item.fieldValues,
      displayOrder: item.displayOrder,
      entityCompanyIds: [...item.entityIds]
        .sort(
          (left, right) =>
            (entityOrder.get(left) ?? Number.MAX_SAFE_INTEGER) -
              (entityOrder.get(right) ?? Number.MAX_SAFE_INTEGER) ||
            left.localeCompare(right),
        )
        .map((entityId) => entityCompanyById.get(entityId) ?? entityId),
      feeLines: [...item.feeLines]
        .sort(
          (left, right) =>
            (entityOrder.get(left.agreementEntityId) ?? Number.MAX_SAFE_INTEGER) -
              (entityOrder.get(right.agreementEntityId) ??
                Number.MAX_SAFE_INTEGER) ||
            left.displayOrder - right.displayOrder ||
            left.id.localeCompare(right.id),
        )
        .map((fee) => ({
          companyId: fee.companyId,
          description: fee.description,
          amount: fee.amount,
          currency: fee.currency,
          billingFrequency: fee.billingFrequency,
          customFrequencyLabel: fee.customFrequencyLabel,
          billingStartDate: fee.billingStartDate,
          displayOrder: fee.displayOrder,
        })),
    })),
  };
}
