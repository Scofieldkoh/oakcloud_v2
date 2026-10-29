import { createHash, randomUUID } from 'node:crypto';

export const P16_EVIDENCE_SCHEMA_VERSION = 1;
export const P16_STATUSES = Object.freeze(['NOT_RUN', 'PASS', 'FAIL', 'BLOCKED']);
export const P16_EVIDENCE_SOURCES = Object.freeze(['CI', 'STAGING', 'OPERATOR']);

export const P16_CHECKS = Object.freeze([
  { id: 'baseline.repository-validation', category: 'baseline', title: 'Repository static, unit, build, migration and audit validation', evidenceSources: ['CI'] },
  { id: 'auth.tenant-rls', category: 'authorization', title: 'Real authentication and cross-tenant RLS isolation', evidenceSources: ['STAGING'] },
  { id: 'review.full-state-evidence', category: 'review', title: 'Full-state evidence producer and final reviewer combiner', evidenceSources: ['STAGING'] },
  { id: 'correction.retained-source-e2e', category: 'correction', title: 'Retained-source correction through effects, read-back and independent review', evidenceSources: ['STAGING'] },
  { id: 'transport.listen-notify', category: 'transport', title: 'LISTEN/NOTIFY wake-up path', evidenceSources: ['STAGING'] },
  { id: 'transport.degraded-polling', category: 'transport', title: 'Degraded polling fallback and recovery', evidenceSources: ['STAGING'] },
  { id: 'provider.throttling', category: 'provider', title: 'Provider throttling, bounded retries and explicit exhaustion outcome', evidenceSources: ['STAGING'] },
  { id: 'approval.expiry-race', category: 'approval', title: 'Approval expiry race is rejected without canonical mutation', evidenceSources: ['STAGING'] },
  { id: 'authorization.action-kind-least-privilege', category: 'authorization', title: 'Action-kind-specific least privilege and revocation', evidenceSources: ['STAGING'] },
  { id: 'draft.stale-rejected', category: 'approval', title: 'Stale draft rejection', evidenceSources: ['STAGING'] },
  { id: 'draft.policy-invalidated-rejected', category: 'approval', title: 'Approval-policy-invalidated draft rejection', evidenceSources: ['STAGING'] },
  { id: 'workload.one-to-ten', category: 'capacity', title: 'Representative 1-10 item fairness, isolation, partial outcomes and budgets', evidenceSources: ['STAGING'] },
  { id: 'timezone.singapore-month-boundary', category: 'time', title: 'Singapore calendar/month-boundary behavior', evidenceSources: ['STAGING'] },
  { id: 'timezone.new-york-dst', category: 'time', title: 'America/New_York DST gap and fold behavior', evidenceSources: ['STAGING'] },
  { id: 'capacity.rolling-24h-cap', category: 'capacity', title: 'Rolling 24-hour action/resource cap behavior', evidenceSources: ['STAGING'] },
  { id: 'summary.weekly-delivery', category: 'summary', title: 'Weekly summary emits exactly one email and one in-app delivery', evidenceSources: ['STAGING'] },
  { id: 'operations.retention-backup-restore', category: 'operations', title: 'Retention plus backup/restore pause and recovery drill', evidenceSources: ['STAGING', 'OPERATOR'] },
  { id: 'rollout.kill-switch-rollback', category: 'rollout', title: 'Kill switch, staged cohort rollback and safe-default restoration', evidenceSources: ['STAGING', 'OPERATOR'] },
]);

const CHECK_BY_ID = new Map(P16_CHECKS.map((check) => [check.id, check]));
const HEX_40 = /^[0-9a-f]{40}$/i;
const HEX_64 = /^[0-9a-f]{64}$/i;
const SAFE_URI = /^(?:https:\/\/|s3:\/\/|azure:\/\/|gs:\/\/|file:\/\/|github:\/\/|run:|log:|artifact:)/i;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

export function canonicalJson(value) {
  return `${JSON.stringify(stable(value), null, 2)}\n`;
}

export function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function manifestPayloadForChecksum(manifest) {
  const copy = clone(manifest);
  delete copy.integrity;
  return copy;
}

export function calculateManifestChecksum(manifest) {
  return sha256Hex(canonicalJson(manifestPayloadForChecksum(manifest)));
}

export function createEvidenceManifest({ appSha, operator, runId = randomUUID(), startedAt = new Date().toISOString() }) {
  if (!HEX_40.test(appSha ?? '')) throw new Error('appSha must be a 40-character Git commit SHA');
  if (typeof operator !== 'string' || operator.trim().length < 2) throw new Error('operator must identify the staging operator');
  if (typeof runId !== 'string' || runId.trim().length < 3) throw new Error('runId must be a non-empty unique identifier');
  if (!validTimestamp(startedAt)) throw new Error('startedAt must be an RFC3339-compatible timestamp');

  return {
    schemaVersion: P16_EVIDENCE_SCHEMA_VERSION,
    run: {
      id: runId,
      environment: 'staging',
      appSha: appSha.toLowerCase(),
      operator: operator.trim(),
      startedAt,
      completedAt: null,
    },
    safety: {
      productionGatesUnchanged: false,
      productionDefaultsDisabled: false,
      killSwitchRestored: false,
      rollbackRehearsed: false,
    },
    checks: P16_CHECKS.map(({ id, category, title }) => ({ id, category, title, status: 'NOT_RUN', evidence: [], note: null })),
  };
}

function validateEvidenceRef(ref, check, errors, prefix) {
  if (!isRecord(ref)) {
    errors.push(`${prefix} must be an object`);
    return;
  }
  if (!P16_EVIDENCE_SOURCES.includes(ref.source)) errors.push(`${prefix}.source is invalid`);
  if (!check.evidenceSources.includes(ref.source)) errors.push(`${prefix}.source must be one of ${check.evidenceSources.join(', ')}`);
  if (typeof ref.uri !== 'string' || !SAFE_URI.test(ref.uri)) errors.push(`${prefix}.uri must use an approved evidence URI scheme`);
  if (!HEX_64.test(ref.sha256 ?? '')) errors.push(`${prefix}.sha256 must be a 64-character SHA-256 digest`);
  if (!validTimestamp(ref.observedAt)) errors.push(`${prefix}.observedAt must be a timestamp`);
  if (ref.description != null && (typeof ref.description !== 'string' || ref.description.length > 500)) errors.push(`${prefix}.description must be at most 500 characters`);
}

export function validateEvidenceManifest(manifest, { expectedAppSha } = {}) {
  const errors = [];
  if (!isRecord(manifest)) return { valid: false, errors: ['manifest must be an object'] };
  if (manifest.schemaVersion !== P16_EVIDENCE_SCHEMA_VERSION) errors.push(`schemaVersion must be ${P16_EVIDENCE_SCHEMA_VERSION}`);

  const run = manifest.run;
  if (!isRecord(run)) errors.push('run must be an object');
  else {
    if (run.environment !== 'staging') errors.push('run.environment must be staging');
    if (!HEX_40.test(run.appSha ?? '')) errors.push('run.appSha must be a 40-character Git commit SHA');
    if (expectedAppSha && String(run.appSha).toLowerCase() !== String(expectedAppSha).toLowerCase()) errors.push('run.appSha does not match the expected application SHA');
    if (typeof run.id !== 'string' || run.id.trim().length < 3) errors.push('run.id is required');
    if (typeof run.operator !== 'string' || run.operator.trim().length < 2) errors.push('run.operator is required');
    if (!validTimestamp(run.startedAt)) errors.push('run.startedAt must be a timestamp');
    if (run.completedAt !== null && !validTimestamp(run.completedAt)) errors.push('run.completedAt must be null or a timestamp');
    if (validTimestamp(run.startedAt) && validTimestamp(run.completedAt) && Date.parse(run.completedAt) < Date.parse(run.startedAt)) errors.push('run.completedAt cannot precede run.startedAt');
  }

  const safety = manifest.safety;
  if (!isRecord(safety)) errors.push('safety must be an object');
  else {
    for (const key of ['productionGatesUnchanged', 'productionDefaultsDisabled', 'killSwitchRestored', 'rollbackRehearsed']) {
      if (typeof safety[key] !== 'boolean') errors.push(`safety.${key} must be boolean`);
    }
  }

  if (!Array.isArray(manifest.checks)) errors.push('checks must be an array');
  else {
    const seen = new Set();
    for (const [index, entry] of manifest.checks.entries()) {
      const prefix = `checks[${index}]`;
      if (!isRecord(entry)) {
        errors.push(`${prefix} must be an object`);
        continue;
      }
      if (seen.has(entry.id)) errors.push(`${prefix}.id is duplicated`);
      seen.add(entry.id);
      const check = CHECK_BY_ID.get(entry.id);
      if (!check) {
        errors.push(`${prefix}.id is not a P16 requirement`);
        continue;
      }
      if (entry.category !== check.category) errors.push(`${prefix}.category does not match the requirement`);
      if (entry.title !== check.title) errors.push(`${prefix}.title does not match the requirement`);
      if (!P16_STATUSES.includes(entry.status)) errors.push(`${prefix}.status is invalid`);
      if (!Array.isArray(entry.evidence)) errors.push(`${prefix}.evidence must be an array`);
      else entry.evidence.forEach((ref, refIndex) => validateEvidenceRef(ref, check, errors, `${prefix}.evidence[${refIndex}]`));
      if ((entry.status === 'PASS' || entry.status === 'FAIL') && (!Array.isArray(entry.evidence) || entry.evidence.length === 0)) errors.push(`${prefix} ${entry.status} requires immutable evidence`);
      if (entry.status === 'BLOCKED' && (typeof entry.note !== 'string' || entry.note.trim().length === 0)) errors.push(`${prefix} BLOCKED requires a note`);
      if (entry.note != null && (typeof entry.note !== 'string' || entry.note.length > 1000)) errors.push(`${prefix}.note must be at most 1000 characters`);
    }
    for (const required of P16_CHECKS) if (!seen.has(required.id)) errors.push(`missing required check ${required.id}`);
    if (seen.size !== P16_CHECKS.length) errors.push(`checks must contain exactly ${P16_CHECKS.length} P16 requirements`);
  }

  if (manifest.integrity != null) {
    if (!isRecord(manifest.integrity)) errors.push('integrity must be an object');
    else {
      if (manifest.integrity.algorithm !== 'sha256') errors.push('integrity.algorithm must be sha256');
      if (!HEX_64.test(manifest.integrity.manifestSha256 ?? '')) errors.push('integrity.manifestSha256 must be a SHA-256 digest');
      else if (manifest.integrity.manifestSha256.toLowerCase() !== calculateManifestChecksum(manifest)) errors.push('integrity.manifestSha256 does not match the manifest payload');
      if (!validTimestamp(manifest.integrity.sealedAt)) errors.push('integrity.sealedAt must be a timestamp');
    }
  }

  return { valid: errors.length === 0, errors };
}

export function recordEvidenceCheck(manifest, { id, status, evidence = [], note = null }) {
  if (manifest.integrity) throw new Error('sealed evidence is immutable; start a new run instead of modifying it');
  const check = CHECK_BY_ID.get(id);
  if (!check) throw new Error(`unknown P16 check: ${id}`);
  if (!P16_STATUSES.includes(status) || status === 'NOT_RUN') throw new Error('record status must be PASS, FAIL, or BLOCKED');
  const next = clone(manifest);
  const entry = next.checks?.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`manifest is missing required check: ${id}`);
  entry.status = status;
  entry.evidence = clone(evidence);
  entry.note = note == null ? null : String(note);
  next.run.completedAt = null;
  const validation = validateEvidenceManifest(next);
  if (!validation.valid) throw new Error(`invalid evidence update: ${validation.errors.join('; ')}`);
  return next;
}

export function setSafetyAssertions(manifest, assertions) {
  if (manifest.integrity) throw new Error('sealed evidence is immutable; start a new run instead of modifying it');
  const next = clone(manifest);
  for (const key of ['productionGatesUnchanged', 'productionDefaultsDisabled', 'killSwitchRestored', 'rollbackRehearsed']) {
    if (Object.hasOwn(assertions, key)) {
      if (typeof assertions[key] !== 'boolean') throw new Error(`${key} must be boolean`);
      next.safety[key] = assertions[key];
    }
  }
  next.run.completedAt = null;
  return next;
}

export function evaluateEvidenceManifest(manifest, options = {}) {
  const validation = validateEvidenceManifest(manifest, options);
  const statuses = { pass: [], fail: [], blocked: [], notRun: [] };
  if (Array.isArray(manifest?.checks)) {
    for (const check of manifest.checks) {
      if (check.status === 'PASS') statuses.pass.push(check.id);
      else if (check.status === 'FAIL') statuses.fail.push(check.id);
      else if (check.status === 'BLOCKED') statuses.blocked.push(check.id);
      else statuses.notRun.push(check.id);
    }
  }
  const safetySatisfied = Boolean(manifest?.safety)
    && manifest.safety.productionGatesUnchanged === true
    && manifest.safety.productionDefaultsDisabled === true
    && manifest.safety.killSwitchRestored === true
    && manifest.safety.rollbackRehearsed === true;
  const complete = validation.valid && statuses.pass.length === P16_CHECKS.length && validTimestamp(manifest?.run?.completedAt);
  const integrityValid = Boolean(manifest?.integrity) && validation.valid;
  return {
    schemaVersion: P16_EVIDENCE_SCHEMA_VERSION,
    valid: validation.valid,
    errors: validation.errors,
    totalChecks: P16_CHECKS.length,
    ...statuses,
    safetySatisfied,
    complete,
    integrityValid,
    readyForSeparateProductionGateReview: complete && safetySatisfied && integrityValid,
    manifestSha256: calculateManifestChecksum(manifest),
  };
}

export function sealEvidenceManifest(manifest, { completedAt = new Date().toISOString() } = {}) {
  if (manifest.integrity) throw new Error('manifest is already sealed');
  if (!validTimestamp(completedAt)) throw new Error('completedAt must be a timestamp');
  const next = clone(manifest);
  next.run.completedAt = completedAt;
  const preSeal = validateEvidenceManifest(next);
  if (!preSeal.valid) throw new Error(`cannot seal invalid evidence: ${preSeal.errors.join('; ')}`);

  const readiness = evaluateEvidenceManifest(next);
  const allChecksPassed = readiness.pass.length === P16_CHECKS.length
    && readiness.fail.length === 0
    && readiness.blocked.length === 0
    && readiness.notRun.length === 0;
  if (!allChecksPassed || !readiness.safetySatisfied) {
    throw new Error('cannot seal incomplete evidence: every P16 gate must PASS and all safety assertions must be true');
  }

  next.integrity = {
    algorithm: 'sha256',
    manifestSha256: calculateManifestChecksum(next),
    sealedAt: completedAt,
  };
  return next;
}
