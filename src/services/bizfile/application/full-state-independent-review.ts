import { createHash } from 'node:crypto';

export type FullStateCoverageStatus = 'REVIEWED' | 'ABSENT' | 'UNREADABLE' | 'UNSUPPORTED';
export type FullStateDisposition = 'PASS' | 'FAIL' | 'ABSTAIN';
export type FullStateAttribution =
  | 'CONFIRMED_SOURCE_MATCH'
  | 'IMPORT_TIME_DEFECT_CORRECTED'
  | 'IMPORT_TIME_DEFECT_UNCORRECTED'
  | 'CANONICAL_MUTATION_DEFECT'
  | 'UNAUTHORIZED_UNSELECTED_WRITE'
  | 'LATER_HUMAN_EDIT'
  | 'SOURCE_DRIFT'
  | 'INSUFFICIENT_EVIDENCE';

export interface FullStateSourceIdentity {
  sourceType: string;
  sourceIdentity: string;
  sourceReference: string;
  sha256: string;
  sourceRevision: string;
}

export interface FullStateEvidenceBinding {
  evidenceIds: string[];
  section: string;
  pages: number[];
}

export interface LaterHumanEditEvidence {
  actorType: 'HUMAN';
  actorId: string;
  occurredAt: string;
  operationCompletedAt: string;
  auditEventId: string;
}

export interface FullStateFieldEvidence {
  path: string;
  selected: boolean;
  beforeValue: unknown;
  afterValue: unknown;
  sourceValue: unknown;
  coverageStatus: FullStateCoverageStatus;
  binding: FullStateEvidenceBinding;
  approvedBeforeValue?: unknown;
  approvedAfterValue?: unknown;
  laterHumanEdit?: LaterHumanEditEvidence;
}

export interface FullStateIndependentReviewInput {
  source: FullStateSourceIdentity;
  verifiedSource: FullStateSourceIdentity;
  fields: FullStateFieldEvidence[];
  canonicalPaths: string[];
  beforeDigest: string;
  afterDigest: string;
  operationCompletedAt: string;
  context?: Record<string, unknown>;
}

export interface FullStateFieldFinding {
  path: string;
  disposition: FullStateDisposition;
  attribution: FullStateAttribution;
  selected: boolean;
  reason: string;
}

export interface FullStateIndependentReviewResult {
  disposition: FullStateDisposition;
  factualPass: boolean;
  fullStateEstablished: boolean;
  sourceBindingValid: boolean;
  beforeDigestValid: boolean;
  afterDigestValid: boolean;
  findings: FullStateFieldFinding[];
  failureCodes: string[];
  evidenceCoverage: {
    required: number;
    reviewed: number;
    absent: number;
    unreadable: number;
    unsupported: number;
    ratio: number;
  };
}

const FORBIDDEN_CONTEXT_KEYS = new Set([
  'plannerHistory',
  'planner_history',
  'assistantMemory',
  'assistant_memory',
  'persona',
  'personalization',
  'mutationTool',
  'mutationTools',
  'mutation_tool',
  'mutation_tools',
  'plannerConclusion',
  'plannerConclusions',
  'planner_conclusion',
  'planner_conclusions',
]);

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableValue(nested)]),
    );
  }
  return value;
}

export function computeFullStateDigest(fields: FullStateFieldEvidence[], phase: 'before' | 'after'): string {
  const values = Object.fromEntries(
    [...fields]
      .sort((left, right) => left.path.localeCompare(right.path))
      .map((field) => [field.path, phase === 'before' ? field.beforeValue : field.afterValue]),
  );
  return createHash('sha256').update(JSON.stringify(stableValue(values))).digest('hex');
}

function equalValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

function sourceBindingEqual(left: FullStateSourceIdentity, right: FullStateSourceIdentity): boolean {
  return left.sourceType === right.sourceType
    && left.sourceIdentity === right.sourceIdentity
    && left.sourceReference === right.sourceReference
    && left.sha256 === right.sha256
    && left.sourceRevision === right.sourceRevision;
}

function collectForbiddenContextKeys(value: unknown, path = 'context', matches: string[] = []): string[] {
  if (!value || typeof value !== 'object') return matches;
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectForbiddenContextKeys(item, `${path}[${index}]`, matches));
    return matches;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const nextPath = `${path}.${key}`;
    if (FORBIDDEN_CONTEXT_KEYS.has(key)) matches.push(nextPath);
    collectForbiddenContextKeys(nested, nextPath, matches);
  }
  return matches;
}

function validBinding(field: FullStateFieldEvidence): boolean {
  return field.binding.evidenceIds.length > 0
    && field.binding.evidenceIds.every((id) => id.trim().length > 0)
    && field.binding.section.trim().length > 0
    && field.binding.pages.length > 0
    && field.binding.pages.every((page) => Number.isInteger(page) && page > 0);
}

function isProvenLaterHumanEdit(field: FullStateFieldEvidence, operationCompletedAt: string): boolean {
  const edit = field.laterHumanEdit;
  if (!edit || edit.actorType !== 'HUMAN' || !edit.actorId || !edit.auditEventId) return false;
  if (edit.operationCompletedAt !== operationCompletedAt) return false;
  const operationTime = Date.parse(operationCompletedAt);
  const editTime = Date.parse(edit.occurredAt);
  return Number.isFinite(operationTime) && Number.isFinite(editTime) && editTime > operationTime;
}

function assessReviewedField(field: FullStateFieldEvidence, operationCompletedAt: string): FullStateFieldFinding {
  const beforeMatchesSource = equalValue(field.beforeValue, field.sourceValue);
  const afterMatchesSource = equalValue(field.afterValue, field.sourceValue);
  const changed = !equalValue(field.beforeValue, field.afterValue);

  if (!field.selected) {
    if (beforeMatchesSource && afterMatchesSource) {
      return { path: field.path, disposition: 'PASS', attribution: 'CONFIRMED_SOURCE_MATCH', selected: false, reason: 'Unselected canonical value remained equal to independently reviewed source evidence.' };
    }
    if (!beforeMatchesSource && !changed) {
      return { path: field.path, disposition: 'FAIL', attribution: 'IMPORT_TIME_DEFECT_UNCORRECTED', selected: false, reason: 'The pre-existing canonical value disagreed with source evidence and was not part of the approved change set.' };
    }
    if (beforeMatchesSource && changed && isProvenLaterHumanEdit(field, operationCompletedAt)) {
      return { path: field.path, disposition: 'ABSTAIN', attribution: 'LATER_HUMAN_EDIT', selected: false, reason: 'A separately audited human edit occurred after the reviewed operation; the operation cannot be blamed or cleared for the current value.' };
    }
    if (beforeMatchesSource && changed) {
      return { path: field.path, disposition: 'FAIL', attribution: 'UNAUTHORIZED_UNSELECTED_WRITE', selected: false, reason: 'An unselected value changed away from independently reviewed source evidence without proven later-human provenance.' };
    }
    return { path: field.path, disposition: 'FAIL', attribution: 'CANONICAL_MUTATION_DEFECT', selected: false, reason: 'An unselected canonical value changed while source disagreement already existed; mutation attribution cannot be cleared.' };
  }

  if (field.approvedBeforeValue !== undefined && !equalValue(field.beforeValue, field.approvedBeforeValue)) {
    return { path: field.path, disposition: 'FAIL', attribution: 'CANONICAL_MUTATION_DEFECT', selected: true, reason: 'Selected-field before state does not equal the approved baseline.' };
  }
  if (field.approvedAfterValue !== undefined && !equalValue(field.afterValue, field.approvedAfterValue)) {
    return { path: field.path, disposition: 'FAIL', attribution: 'CANONICAL_MUTATION_DEFECT', selected: true, reason: 'Selected-field after state does not equal the approved target.' };
  }
  if (!beforeMatchesSource && afterMatchesSource) {
    return { path: field.path, disposition: 'PASS', attribution: 'IMPORT_TIME_DEFECT_CORRECTED', selected: true, reason: 'Independent source evidence shows the import-time baseline was wrong and the approved mutation restored the source value.' };
  }
  if (beforeMatchesSource && afterMatchesSource) {
    return { path: field.path, disposition: 'PASS', attribution: 'CONFIRMED_SOURCE_MATCH', selected: true, reason: 'Before and after states both agree with independently reviewed source evidence.' };
  }
  return { path: field.path, disposition: 'FAIL', attribution: 'CANONICAL_MUTATION_DEFECT', selected: true, reason: 'Selected-field after state is not established as correct by independently reviewed source evidence.' };
}

export function evaluateFullStateIndependentReview(input: FullStateIndependentReviewInput): FullStateIndependentReviewResult {
  const failureCodes: string[] = [];
  const forbidden = collectForbiddenContextKeys(input.context);
  if (forbidden.length > 0) failureCodes.push('PROCEDURAL_INDEPENDENCE_VIOLATION');

  const sourceBindingValid = sourceBindingEqual(input.source, input.verifiedSource);
  if (!sourceBindingValid) failureCodes.push('SOURCE_DRIFT');

  const pathCounts = new Map<string, number>();
  input.fields.forEach((field) => pathCounts.set(field.path, (pathCounts.get(field.path) ?? 0) + 1));
  const canonicalPaths = [...new Set(input.canonicalPaths)].sort();
  const fieldPaths = [...pathCounts.keys()].sort();
  const uniquePaths = pathCounts.size === input.fields.length;
  const samePathSet = canonicalPaths.length === fieldPaths.length
    && canonicalPaths.every((path, index) => path === fieldPaths[index]);
  if (!uniquePaths) failureCodes.push('DUPLICATE_FIELD_EVIDENCE');
  if (!samePathSet) failureCodes.push('FULL_STATE_COVERAGE_MISSING');

  const beforeDigestValid = input.beforeDigest === computeFullStateDigest(input.fields, 'before');
  const afterDigestValid = input.afterDigest === computeFullStateDigest(input.fields, 'after');
  if (!beforeDigestValid) failureCodes.push('BEFORE_EVIDENCE_IMMUTABILITY_FAILURE');
  if (!afterDigestValid) failureCodes.push('AFTER_EVIDENCE_IMMUTABILITY_FAILURE');

  const coverage = { required: canonicalPaths.length, reviewed: 0, absent: 0, unreadable: 0, unsupported: 0, ratio: 0 };
  const findings: FullStateFieldFinding[] = input.fields.map((field) => {
    if (field.coverageStatus === 'REVIEWED') coverage.reviewed += 1;
    if (field.coverageStatus === 'ABSENT') coverage.absent += 1;
    if (field.coverageStatus === 'UNREADABLE') coverage.unreadable += 1;
    if (field.coverageStatus === 'UNSUPPORTED') coverage.unsupported += 1;

    if (!validBinding(field)) {
      failureCodes.push('EVIDENCE_BINDING_MISSING');
      return { path: field.path, disposition: 'ABSTAIN', attribution: 'INSUFFICIENT_EVIDENCE', selected: field.selected, reason: 'Section, page, or immutable evidence binding is missing.' };
    }
    if (field.coverageStatus !== 'REVIEWED') {
      return { path: field.path, disposition: 'ABSTAIN', attribution: 'INSUFFICIENT_EVIDENCE', selected: field.selected, reason: `Source attestation is ${field.coverageStatus}; factual correctness is not established.` };
    }
    if (!sourceBindingValid) {
      return { path: field.path, disposition: 'ABSTAIN', attribution: 'SOURCE_DRIFT', selected: field.selected, reason: 'Verified source identity/revision/hash differs from the immutable review source binding.' };
    }
    return assessReviewedField(field, input.operationCompletedAt);
  });

  coverage.ratio = coverage.required === 0 ? 0 : coverage.reviewed / coverage.required;
  const fullStateEstablished = canonicalPaths.length > 0
    && uniquePaths
    && samePathSet
    && coverage.reviewed === coverage.required
    && input.fields.every(validBinding)
    && sourceBindingValid
    && beforeDigestValid
    && afterDigestValid
    && forbidden.length === 0;

  const hasFail = findings.some((finding) => finding.disposition === 'FAIL');
  const hasAbstain = findings.some((finding) => finding.disposition === 'ABSTAIN');
  const disposition: FullStateDisposition = hasFail || failureCodes.some((code) => code === 'PROCEDURAL_INDEPENDENCE_VIOLATION')
    ? 'FAIL'
    : !fullStateEstablished || hasAbstain
      ? 'ABSTAIN'
      : 'PASS';

  return {
    disposition,
    factualPass: disposition === 'PASS' && fullStateEstablished,
    fullStateEstablished,
    sourceBindingValid,
    beforeDigestValid,
    afterDigestValid,
    findings,
    failureCodes: [...new Set(failureCodes)],
    evidenceCoverage: coverage,
  };
}
