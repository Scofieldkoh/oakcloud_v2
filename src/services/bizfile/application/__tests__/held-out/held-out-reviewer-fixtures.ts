import {
  computeFullStateDigest,
  type FullStateAttribution,
  type FullStateDisposition,
  type FullStateFieldEvidence,
  type FullStateIndependentReviewInput,
} from '../../full-state-independent-review';
import { BIZFILE_FULL_STATE_REVIEW_CONTRACT } from '../../full-state-review-contract';

export interface HeldOutReviewerFixture {
  id: string;
  category: string;
  expectedDisposition: FullStateDisposition;
  expectedAttribution?: FullStateAttribution;
  input: FullStateIndependentReviewInput;
}

type BoundLaterEdit = NonNullable<FullStateFieldEvidence['laterHumanEdit']> & {
  fieldPath: string;
  previousValue: unknown;
  resultingValue: unknown;
  sourceRevision: string;
};

const source = {
  sourceType: 'BIZFILE_PDF',
  sourceIdentity: 'heldout-document-zeta',
  sourceReference: 'retained://heldout/zeta/source.pdf',
  sha256: '1'.repeat(64),
  sourceRevision: 'heldout-rev-11',
};

function section(path: string): FullStateFieldEvidence {
  const value = { heldOut: true, section: path, marker: `zeta-${path}` };
  return {
    path,
    selected: false,
    beforeValue: value,
    afterValue: value,
    sourceValue: value,
    coverageStatus: 'REVIEWED',
    binding: { evidenceIds: [`heldout-zeta-${path}`], section: path, pages: [2] },
  };
}

function fields(): FullStateFieldEvidence[] {
  return BIZFILE_FULL_STATE_REVIEW_CONTRACT.canonicalPaths.map(section);
}

function patch(
  all: FullStateFieldEvidence[],
  path: string,
  changes: Partial<FullStateFieldEvidence>,
): FullStateFieldEvidence[] {
  return all.map((field) => field.path === path ? { ...field, ...changes } : field);
}

function build(
  mutate: (value: FullStateFieldEvidence[]) => FullStateFieldEvidence[] = (value) => value,
  overrides: Partial<FullStateIndependentReviewInput> = {},
): FullStateIndependentReviewInput {
  const evidence = mutate(fields());
  return {
    source,
    verifiedSource: source,
    fields: evidence,
    canonicalPaths: ['producer-must-not-control-this'],
    beforeDigest: computeFullStateDigest(evidence, 'before'),
    afterDigest: computeFullStateDigest(evidence, 'after'),
    operationCompletedAt: '2026-09-10T12:00:00.000Z',
    context: { reviewRunId: 'heldout-run', reviewerVersion: 'p12-v1' },
    ...overrides,
  };
}

const selectedBefore = { heldOut: true, section: 'entity', marker: 'zeta-import-error' };
const selectedSource = { heldOut: true, section: 'entity', marker: 'zeta-entity' };
const laterPrevious = { heldOut: true, section: 'compliance', marker: 'zeta-compliance' };
const laterResult = { heldOut: true, section: 'compliance', marker: 'post-operation-human' };
const laterHumanEdit: BoundLaterEdit = {
  actorType: 'HUMAN',
  actorId: 'heldout-human-9',
  occurredAt: '2026-09-10T12:08:00.000Z',
  operationCompletedAt: '2026-09-10T12:00:00.000Z',
  auditEventId: 'heldout-audit-9',
  fieldPath: 'compliance',
  previousValue: laterPrevious,
  resultingValue: laterResult,
  sourceRevision: 'heldout-rev-11',
};

const cases: HeldOutReviewerFixture[] = [
  { id: 'holdout-01', category: 'correct-import', expectedDisposition: 'PASS', expectedAttribution: 'CONFIRMED_SOURCE_MATCH', input: build() },
  { id: 'holdout-02', category: 'selected-defect-corrected', expectedDisposition: 'PASS', expectedAttribution: 'IMPORT_TIME_DEFECT_CORRECTED', input: build((value) => patch(value, 'entity', { selected: true, beforeValue: selectedBefore, afterValue: selectedSource, sourceValue: selectedSource, approvedBeforeValue: selectedBefore, approvedAfterValue: selectedSource })) },
  { id: 'holdout-03', category: 'unselected-defect', expectedDisposition: 'FAIL', expectedAttribution: 'IMPORT_TIME_DEFECT_UNCORRECTED', input: build((value) => patch(value, 'addresses', { beforeValue: 'heldout-bad-address', afterValue: 'heldout-bad-address' })) },
  { id: 'holdout-04', category: 'unauthorized-write', expectedDisposition: 'FAIL', expectedAttribution: 'UNAUTHORIZED_UNSELECTED_WRITE', input: build((value) => patch(value, 'capital', { afterValue: 'heldout-unapproved-capital' })) },
  { id: 'holdout-05', category: 'mutation-defect', expectedDisposition: 'FAIL', expectedAttribution: 'CANONICAL_MUTATION_DEFECT', input: build((value) => patch(value, 'activities', { selected: true, afterValue: 'wrong-selected-target', approvedAfterValue: 'approved-but-not-written' })) },
  { id: 'holdout-06', category: 'missing-section', expectedDisposition: 'ABSTAIN', input: build((value) => value.filter((field) => field.path !== 'auditor')) },
  { id: 'holdout-07', category: 'unreadable', expectedDisposition: 'ABSTAIN', expectedAttribution: 'INSUFFICIENT_EVIDENCE', input: build((value) => patch(value, 'officers', { coverageStatus: 'UNREADABLE' })) },
  { id: 'holdout-08', category: 'unsupported', expectedDisposition: 'ABSTAIN', expectedAttribution: 'INSUFFICIENT_EVIDENCE', input: build((value) => patch(value, 'shareholders', { coverageStatus: 'UNSUPPORTED' })) },
  { id: 'holdout-09', category: 'absent', expectedDisposition: 'ABSTAIN', expectedAttribution: 'INSUFFICIENT_EVIDENCE', input: build((value) => patch(value, 'charges', { coverageStatus: 'ABSENT', sourceValue: null })) },
  { id: 'holdout-10', category: 'source-drift', expectedDisposition: 'ABSTAIN', expectedAttribution: 'SOURCE_DRIFT', input: build(undefined, { verifiedSource: { ...source, sha256: '2'.repeat(64), sourceRevision: 'heldout-rev-12' } }) },
  { id: 'holdout-11', category: 'later-human-edit', expectedDisposition: 'ABSTAIN', expectedAttribution: 'LATER_HUMAN_EDIT', input: build((value) => patch(value, 'compliance', { beforeValue: laterPrevious, sourceValue: laterPrevious, afterValue: laterResult, laterHumanEdit })) },
  { id: 'holdout-12', category: 'bad-section-binding', expectedDisposition: 'ABSTAIN', input: build((value) => patch(value, 'document', { binding: { evidenceIds: ['heldout-zeta-document'], section: 'entity', pages: [2] } })) },
  { id: 'holdout-13', category: 'digest-tamper', expectedDisposition: 'ABSTAIN', input: build(undefined, { afterDigest: '0'.repeat(64) }) },
];

export const HELD_OUT_REVIEWER_FIXTURES: readonly HeldOutReviewerFixture[] = Object.freeze(cases);
