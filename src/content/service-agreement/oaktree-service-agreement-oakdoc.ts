import { buildOaktreeServiceAgreementReferenceOakDoc } from './oaktree-service-agreement-reference-oakdoc';

/**
 * The seeded Service Agreement master. Its layout and wording follow the
 * agreement the firm uses today (see
 * docs/plans/2026-09-27-service-agreement-reference-fidelity.md); the record
 * keeps its original name so re-seeding replaces the existing template.
 */
export const OAKTREE_SERVICE_AGREEMENT_OAKDOC = {
  name: 'Oaktree Master Services Agreement (OakDoc)',
  fileName: 'Oaktree Master Services Agreement - OakDoc.docx',
  description: 'Oaktree Local Master Services Agreement with company-grouped SOW fee tables.',
  category: 'CONTRACT' as const,
  compositionType: 'SERVICE_AGREEMENT' as const,
  isActive: false,
} as const;

export function buildOaktreeServiceAgreementOakDoc(): Uint8Array {
  return buildOaktreeServiceAgreementReferenceOakDoc();
}
