import {
  computeFullStateDigest,
  type FullStateFieldEvidence,
  type FullStateIndependentReviewInput,
  type FullStateDisposition,
  type FullStateAttribution,
} from '../full-state-independent-review';
import { BIZFILE_FULL_STATE_REVIEW_CONTRACT } from '../full-state-review-contract';

export interface AnnotatedReviewerFixture {
  id: string;
  description: string;
  expectedDisposition: FullStateDisposition;
  expectedAttribution?: FullStateAttribution;
  input: FullStateIndependentReviewInput;
}

const retainedSource = {
  sourceType: 'BIZFILE_PDF',
  sourceIdentity: 'fixture-document',
  sourceReference: 'retained://fixtures/bizfile/source.pdf',
  sha256: 'd'.repeat(64),
  sourceRevision: 'source-rev-3',
};

function section(path: string): FullStateFieldEvidence {
  const value = { section: path, value: `source-${path}` };
  return {
    path,
    selected: false,
    beforeValue: value,
    afterValue: value,
    sourceValue: value,
    coverageStatus: 'REVIEWED',
    binding: { evidenceIds: [`fixture-evidence-${path}`], section: path, pages: [1] },
  };
}

function completeFields(): FullStateFieldEvidence[] {
  return BIZFILE_FULL_STATE_REVIEW_CONTRACT.canonicalPaths.map(section);
}

function makeInput(
  mutate: (fields: FullStateFieldEvidence[]) => FullStateFieldEvidence[] = (fields) => fields,
  overrides: Partial<FullStateIndependentReviewInput> = {},
): FullStateIndependentReviewInput {
  const fields = mutate(completeFields());
  return {
    source: retainedSource,
    verifiedSource: retainedSource,
    fields,
    canonicalPaths: [],
    beforeDigest: computeFullStateDigest(fields, 'before'),
    afterDigest: computeFullStateDigest(fields, 'after'),
    operationCompletedAt: '2026-09-10T10:00:00.000Z',
    ...overrides,
  };
}

function replace(fields: FullStateFieldEvidence[], path: string, patch: Partial<FullStateFieldEvidence>): FullStateFieldEvidence[] {
  return fields.map((field) => field.path === path ? { ...field, ...patch } : field);
}

const correctImport = makeInput();

const selectedDefect = makeInput((fields) => replace(fields, 'entity', {
  selected: true,
  beforeValue: { section: 'entity', value: 'wrong-import' },
  afterValue: { section: 'entity', value: 'source-entity' },
  sourceValue: { section: 'entity', value: 'source-entity' },
  approvedBeforeValue: { section: 'entity', value: 'wrong-import' },
  approvedAfterValue: { section: 'entity', value: 'source-entity' },
}));

const unselectedDefect = makeInput((fields) => replace(fields, 'addresses', {
  beforeValue: { section: 'addresses', value: 'wrong-import' },
  afterValue: { section: 'addresses', value: 'wrong-import' },
  sourceValue: { section: 'addresses', value: 'source-addresses' },
}));

const unauthorizedWrite = makeInput((fields) => replace(fields, 'capital', {
  afterValue: { section: 'capital', value: 'unapproved-write' },
}));

const missingSection = makeInput((fields) => fields.filter((field) => field.path !== 'charges'));

const unreadableSource = makeInput((fields) => replace(fields, 'officers', {
  coverageStatus: 'UNREADABLE',
}));

const ambiguousEvidence = makeInput((fields) => replace(fields, 'shareholders', {
  coverageStatus: 'UNSUPPORTED',
}));

const laterHumanEdit = makeInput((fields) => replace(fields, 'compliance', {
  afterValue: { section: 'compliance', value: 'later-human-value' },
  laterHumanEdit: {
    actorType: 'HUMAN',
    actorId: 'human-1',
    occurredAt: '2026-09-10T10:05:00.000Z',
    operationCompletedAt: '2026-09-10T10:00:00.000Z',
    auditEventId: 'audit-later-1',
    fieldPath: 'compliance',
    previousValue: { section: 'compliance', value: 'source-compliance' },
    resultingValue: { section: 'compliance', value: 'later-human-value' },
    sourceRevision: 'source-rev-3',
  } as FullStateFieldEvidence['laterHumanEdit'],
}));

const sourceDrift = makeInput(undefined, {
  verifiedSource: { ...retainedSource, sourceRevision: 'source-rev-4', sha256: 'e'.repeat(64) },
});

export const DEVELOPMENT_REVIEWER_FIXTURES: readonly AnnotatedReviewerFixture[] = Object.freeze([
  { id: 'dev.correct-import', description: 'All normalized sections match immutable source evidence.', expectedDisposition: 'PASS', expectedAttribution: 'CONFIRMED_SOURCE_MATCH', input: correctImport },
  { id: 'dev.selected-field-defect', description: 'Selected import-time defect is corrected to source.', expectedDisposition: 'PASS', expectedAttribution: 'IMPORT_TIME_DEFECT_CORRECTED', input: selectedDefect },
  { id: 'dev.unselected-field-defect', description: 'Defect predates mutation and remains outside approved set.', expectedDisposition: 'FAIL', expectedAttribution: 'IMPORT_TIME_DEFECT_UNCORRECTED', input: unselectedDefect },
  { id: 'dev.unauthorized-write', description: 'Unselected canonical state changed after matching source baseline.', expectedDisposition: 'FAIL', expectedAttribution: 'UNAUTHORIZED_UNSELECTED_WRITE', input: unauthorizedWrite },
  { id: 'dev.missing-section', description: 'One required normalized section lacks any evidence record.', expectedDisposition: 'ABSTAIN', input: missingSection },
  { id: 'dev.unreadable-source', description: 'Required officer evidence is explicitly unreadable.', expectedDisposition: 'ABSTAIN', expectedAttribution: 'INSUFFICIENT_EVIDENCE', input: unreadableSource },
  { id: 'dev.ambiguous-evidence', description: 'Required shareholder evidence is unsupported/ambiguous.', expectedDisposition: 'ABSTAIN', expectedAttribution: 'INSUFFICIENT_EVIDENCE', input: ambiguousEvidence },
  { id: 'dev.later-human-edit', description: 'Audited human edit occurs after reviewed operation.', expectedDisposition: 'ABSTAIN', expectedAttribution: 'LATER_HUMAN_EDIT', input: laterHumanEdit },
  { id: 'dev.source-drift', description: 'Verified source hash/revision no longer matches immutable retained source.', expectedDisposition: 'ABSTAIN', expectedAttribution: 'SOURCE_DRIFT', input: sourceDrift },
]);
