import { describe, expect, it } from 'vitest';
import { validateFullStateEvidenceIntegrity } from '../review-evidence-integrity';
import { computeFullStateDigest, type FullStateFieldEvidence } from '../full-state-independent-review';

function makeField(path: string, evidenceId: string): FullStateFieldEvidence {
  return {
    path,
    selected: false,
    beforeValue: path,
    afterValue: path,
    sourceValue: path,
    coverageStatus: 'REVIEWED',
    binding: { evidenceIds: [evidenceId], section: path, pages: [1] },
  };
}

function makeInput(fields: FullStateFieldEvidence[]) {
  const source = {
    sourceType: 'BIZFILE_PDF', sourceIdentity: 'doc-1', sourceReference: 'retained://doc-1',
    sha256: 'f'.repeat(64), sourceRevision: 'rev-1',
  };
  return {
    source,
    verifiedSource: source,
    fields,
    canonicalPaths: fields.map((field) => field.path),
    beforeDigest: computeFullStateDigest(fields, 'before'),
    afterDigest: computeFullStateDigest(fields, 'after'),
    operationCompletedAt: '2026-09-10T10:00:00.000Z',
  };
}

describe('full-state evidence integrity', () => {
  it('accepts uniquely bound section/page evidence and a valid immutable source identity', () => {
    expect(validateFullStateEvidenceIntegrity(makeInput([makeField('entity', 'ev-entity')]))).toEqual({ valid: true, codes: [] });
  });

  it('rejects malformed source SHA even when source and verifiedSource repeat the same bad value', () => {
    const input = makeInput([makeField('entity', 'ev-entity')]);
    input.source = { ...input.source, sha256: 'not-a-sha' };
    input.verifiedSource = input.source;
    expect(validateFullStateEvidenceIntegrity(input).codes).toContain('SOURCE_SHA256_INVALID');
  });

  it('rejects section-reference mistakes', () => {
    const field = makeField('entity', 'ev-entity');
    field.binding.section = 'addresses';
    expect(validateFullStateEvidenceIntegrity(makeInput([field])).codes).toContain('SOURCE_SECTION_BINDING_MISMATCH');
  });

  it('rejects one evidence binding being reused to clear two sections', () => {
    const result = validateFullStateEvidenceIntegrity(makeInput([
      makeField('entity', 'shared-evidence'),
      makeField('addresses', 'shared-evidence'),
    ]));
    expect(result.codes).toContain('EVIDENCE_BINDING_REUSED_ACROSS_SECTIONS');
  });
});
