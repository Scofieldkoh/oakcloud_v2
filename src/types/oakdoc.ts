/**
 * Shared OakDoc contracts (C0).
 *
 * These DTOs are shared by the editor host, persistence services, render
 * pipeline, output and migration code. Feature modules extend them through
 * additive optional fields; they must not redefine local variants.
 */

export const OAKDOC_CONTRACT_VERSION = 1 as const;

/** Identity of one editor snapshot submitted for persistence. */
export interface OakDocSnapshotIdentity {
  /** Stable for one mounted editor session of one entity. */
  sessionKey: string;
  /** Unique per browser tab/editor instance. */
  writerInstanceId: string;
  /** Monotonic per session; increases on every local change. */
  localRevision: number;
  /** Persisted revision the snapshot was edited from. */
  baseRevision: number;
}

/**
 * Server acknowledgement of a native save. The client clears dirty state only
 * when the acknowledged `localRevision` still equals its current revision.
 */
export interface OakDocSaveReceipt extends Partial<OakDocSnapshotIdentity> {
  operationId: string;
  revision: number;
  assetSha256: string;
  updatedAt: string;
  batchRevision?: number;
}

export type OakDocDiagnosticSeverity = 'error' | 'warning';
export type OakDocDiagnosticStage = 'import' | 'template' | 'render' | 'review' | 'output';

export interface OakDocDiagnostic {
  code: string;
  severity: OakDocDiagnosticSeverity;
  stage: OakDocDiagnosticStage;
  message: string;
  controlTag?: string;
  part?: string;
}

export type OakDocEntityKind = 'template' | 'partial' | 'generated-document';

/** Server-verified identity of one immutable native asset. */
export interface OakDocAssetIdentity {
  tenantId: string;
  entityKind: OakDocEntityKind;
  entityId: string;
  engine: 'OAKDOC';
  schemaVersion: number;
  storageKey: string;
  fileSize: number;
  sha256: string;
  /** Null for blank or imported standalone documents. */
  templateProvenance: {
    templateId: string;
    templateVersion: number;
    templateSha256: string;
  } | null;
}

export interface OakDocMigrationEvidence {
  runId: string;
  checkerVersion: string;
  scenarioManifestHash: string;
  sourceDefinitionHash: string;
  targetDefinitionHash: string;
  dependencyHashes: string[];
  result: 'passed' | 'failed';
  issueCodes: string[];
  artifactRefs: string[];
  actorId: string;
  checkedAt: string;
}

/** Safe reason codes returned in `ApiError.details.reason`. */
export const OAKDOC_ERROR_REASONS = {
  REVISION_REQUIRED: 'OAKDOC_REVISION_REQUIRED',
  STALE_REVISION: 'OAKDOC_STALE_REVISION',
  INVALID_ENGINE_METADATA: 'OAKDOC_INVALID_ENGINE_METADATA',
  RESERVED_METADATA: 'OAKDOC_RESERVED_METADATA',
  PACKAGE_REJECTED: 'OAKDOC_PACKAGE_REJECTED',
  ASSET_INTEGRITY: 'OAKDOC_ASSET_INTEGRITY',
  UNSUPPORTED_OUTPUT: 'OAKDOC_UNSUPPORTED_OUTPUT',
  CONVERTER_UNAVAILABLE: 'OAKDOC_CONVERTER_UNAVAILABLE',
  UNRESOLVED_CONTROLS: 'OAKDOC_UNRESOLVED_CONTROLS',
  A4_RETIRED: 'A4_EDITOR_RETIRED',
} as const;

export type OakDocErrorReason = typeof OAKDOC_ERROR_REASONS[keyof typeof OAKDOC_ERROR_REASONS];
