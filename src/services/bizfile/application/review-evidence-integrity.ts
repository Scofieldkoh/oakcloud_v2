import type {
  FullStateIndependentReviewInput,
  FullStateIndependentReviewResult,
} from './full-state-independent-review';

const SHA256 = /^[a-f0-9]{64}$/;

export interface ReviewEvidenceIntegrityResult {
  valid: boolean;
  codes: string[];
}

export function validateFullStateEvidenceIntegrity(input: FullStateIndependentReviewInput): ReviewEvidenceIntegrityResult {
  const codes: string[] = [];
  const source = input.source;
  if (!source.sourceType.trim() || !source.sourceIdentity.trim()) codes.push('SOURCE_IDENTITY_INVALID');
  if (!source.sourceReference.trim()) codes.push('SOURCE_REFERENCE_INVALID');
  if (!SHA256.test(source.sha256)) codes.push('SOURCE_SHA256_INVALID');
  if (!source.sourceRevision.trim()) codes.push('SOURCE_REVISION_INVALID');

  const evidenceOwners = new Map<string, string>();
  for (const field of input.fields) {
    if (!field.path.trim()) codes.push('FIELD_PATH_INVALID');
    if (field.binding.section !== field.path) codes.push('SOURCE_SECTION_BINDING_MISMATCH');
    if (field.binding.pages.length === 0 || field.binding.pages.some((page) => !Number.isInteger(page) || page <= 0)) {
      codes.push('SOURCE_PAGE_REFERENCE_INVALID');
    }
    if (new Set(field.binding.pages).size !== field.binding.pages.length) codes.push('SOURCE_PAGE_REFERENCE_DUPLICATE');
    if (field.binding.evidenceIds.length === 0) codes.push('EVIDENCE_BINDING_MISSING');
    for (const evidenceId of field.binding.evidenceIds) {
      if (!evidenceId.trim()) {
        codes.push('EVIDENCE_ID_INVALID');
        continue;
      }
      const owner = evidenceOwners.get(evidenceId);
      if (owner && owner !== field.path) codes.push('EVIDENCE_BINDING_REUSED_ACROSS_SECTIONS');
      evidenceOwners.set(evidenceId, field.path);
    }
    if (field.coverageStatus === 'REVIEWED' && !Object.prototype.hasOwnProperty.call(field, 'sourceValue')) {
      codes.push('REVIEWED_SOURCE_VALUE_MISSING');
    }
  }
  return { valid: codes.length === 0, codes: [...new Set(codes)] };
}

export function applyEvidenceIntegrityGate(
  result: FullStateIndependentReviewResult,
  integrity: ReviewEvidenceIntegrityResult,
): FullStateIndependentReviewResult {
  if (integrity.valid) return result;
  return {
    ...result,
    disposition: result.disposition === 'FAIL' ? 'FAIL' : 'ABSTAIN',
    factualPass: false,
    fullStateEstablished: false,
    failureCodes: [...new Set([...result.failureCodes, ...integrity.codes])],
  };
}
