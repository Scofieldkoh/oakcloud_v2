export const SERVICE_AGREEMENT_SLOTS = {
  serviceSections: '{{@agreement.serviceSections}}',
  feeTable: '{{@agreement.feeTable}}',
  entityAppendix: '{{@agreement.entityAppendix}}',
} as const;

export type ServiceAgreementSlotName = keyof typeof SERVICE_AGREEMENT_SLOTS;

export interface ServiceAgreementSlotViolation {
  slot: ServiceAgreementSlotName;
  kind: 'missing' | 'duplicate';
  message: string;
}

export function findServiceAgreementSlotViolations(
  content: string,
): ServiceAgreementSlotViolation[] {
  return (Object.entries(SERVICE_AGREEMENT_SLOTS) as Array<
    [ServiceAgreementSlotName, string]
  >).flatMap(([slot, token]) => {
    const count = content.split(token).length - 1;
    if (count === 1) return [];
    return [{
      slot,
      kind: count === 0 ? 'missing' : 'duplicate',
      message: `Service Agreement template must contain exactly one ${slot} slot.`,
    }];
  });
}

export function assertValidTemplateComposition(
  compositionType: 'STANDARD' | 'SERVICE_AGREEMENT' | 'RESOLUTION',
  content: string,
): void {
  if (compositionType !== 'SERVICE_AGREEMENT') return;
  const [violation] = findServiceAgreementSlotViolations(content);
  if (violation) throw new Error(violation.message);
}
