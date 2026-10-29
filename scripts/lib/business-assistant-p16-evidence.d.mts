export type P16Status = 'NOT_RUN' | 'PASS' | 'FAIL' | 'BLOCKED';
export type P16RecordableStatus = Exclude<P16Status, 'NOT_RUN'>;
export type P16EvidenceSource = 'CI' | 'STAGING' | 'OPERATOR';

export interface P16CheckDefinition {
  readonly id: string;
  readonly category: string;
  readonly title: string;
  readonly evidenceSources: readonly P16EvidenceSource[];
}

export interface P16EvidenceRef {
  source: P16EvidenceSource;
  uri: string;
  sha256: string;
  observedAt: string;
  description?: string | null;
}

export interface P16EvidenceCheck {
  id: string;
  category: string;
  title: string;
  status: P16Status;
  evidence: P16EvidenceRef[];
  note: string | null;
}

export interface P16EvidenceManifest {
  schemaVersion: number;
  run: {
    id: string;
    environment: 'staging';
    appSha: string;
    operator: string;
    startedAt: string;
    completedAt: string | null;
  };
  safety: {
    productionGatesUnchanged: boolean;
    productionDefaultsDisabled: boolean;
    killSwitchRestored: boolean;
    rollbackRehearsed: boolean;
  };
  checks: P16EvidenceCheck[];
  integrity?: {
    algorithm: 'sha256';
    manifestSha256: string;
    sealedAt: string;
  };
}

export interface P16ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface P16EvaluationResult extends P16ValidationResult {
  schemaVersion: number;
  totalChecks: number;
  pass: string[];
  fail: string[];
  blocked: string[];
  notRun: string[];
  safetySatisfied: boolean;
  complete: boolean;
  integrityValid: boolean;
  readyForSeparateProductionGateReview: boolean;
  manifestSha256: string;
}

export const P16_EVIDENCE_SCHEMA_VERSION: 1;
export const P16_STATUSES: readonly P16Status[];
export const P16_EVIDENCE_SOURCES: readonly P16EvidenceSource[];
export const P16_CHECKS: readonly P16CheckDefinition[];

export function canonicalJson(value: unknown): string;
export function sha256Hex(value: string | NodeJS.ArrayBufferView): string;
export function manifestPayloadForChecksum(manifest: P16EvidenceManifest): Omit<P16EvidenceManifest, 'integrity'>;
export function calculateManifestChecksum(manifest: P16EvidenceManifest): string;

export function createEvidenceManifest(options: {
  appSha: string;
  operator: string;
  runId?: string;
  startedAt?: string;
}): P16EvidenceManifest;

export function validateEvidenceManifest(
  manifest: P16EvidenceManifest,
  options?: { expectedAppSha?: string },
): P16ValidationResult;

export function recordEvidenceCheck(
  manifest: P16EvidenceManifest,
  update: {
    id: string;
    status: P16RecordableStatus;
    evidence?: P16EvidenceRef[];
    note?: string | null;
  },
): P16EvidenceManifest;

export function setSafetyAssertions(
  manifest: P16EvidenceManifest,
  assertions: Partial<P16EvidenceManifest['safety']>,
): P16EvidenceManifest;

export function evaluateEvidenceManifest(
  manifest: P16EvidenceManifest,
  options?: { expectedAppSha?: string },
): P16EvaluationResult;

export function sealEvidenceManifest(
  manifest: P16EvidenceManifest,
  options?: { completedAt?: string },
): P16EvidenceManifest;
