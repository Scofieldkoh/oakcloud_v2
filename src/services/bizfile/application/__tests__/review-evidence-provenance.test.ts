import { describe, expect, it } from 'vitest';
import type { FullStateFieldEvidence } from '../full-state-independent-review';
import { hasBoundLaterHumanEditEvidence } from '../review-evidence-provenance';

const source = {
  sourceType: 'BIZFILE_PDF',
  sourceIdentity: 'document-1',
  sourceReference: 'retained://document-1',
  sha256: 'c'.repeat(64),
  sourceRevision: 'rev-7',
};

const baseField: FullStateFieldEvidence = {
  path: 'entity',
  selected: false,
  beforeValue: { name: 'OAK PTE. LTD.' },
  afterValue: { name: 'OAK TREE PTE. LTD.' },
  sourceValue: { name: 'OAK PTE. LTD.' },
  coverageStatus: 'REVIEWED',
  binding: { evidenceIds: ['ev-entity'], section: 'entity', pages: [1] },
};

function laterEdit(overrides: Record<string, unknown> = {}) {
  return {
    actorType: 'HUMAN' as const,
    actorId: 'user-1',
    occurredAt: '2026-09-10T10:05:00.000Z',
    operationCompletedAt: '2026-09-10T10:00:00.000Z',
    auditEventId: 'audit-1',
    fieldPath: 'entity',
    previousValue: { name: 'OAK PTE. LTD.' },
    resultingValue: { name: 'OAK TREE PTE. LTD.' },
    sourceRevision: 'rev-7',
    ...overrides,
  };
}

describe('later human edit provenance', () => {
  it('accepts only an audit event bound to the exact state transition', () => {
    const field = { ...baseField, laterHumanEdit: laterEdit() } as FullStateFieldEvidence;
    expect(hasBoundLaterHumanEditEvidence(field, source, '2026-09-10T10:00:00.000Z')).toBe(true);
  });

  it.each([
    ['wrong path', { fieldPath: 'addresses' }],
    ['wrong resulting value', { resultingValue: { name: 'OTHER' } }],
    ['wrong source revision', { sourceRevision: 'rev-8' }],
    ['pre-operation time', { occurredAt: '2026-09-10T09:59:00.000Z' }],
  ])('rejects %s as exculpatory evidence', (_label, overrides) => {
    const field = { ...baseField, laterHumanEdit: laterEdit(overrides) } as FullStateFieldEvidence;
    expect(hasBoundLaterHumanEditEvidence(field, source, '2026-09-10T10:00:00.000Z')).toBe(false);
  });
});
