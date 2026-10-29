import { createHash } from 'node:crypto';
import { z } from 'zod';

/** JSON values that can be persisted in a bounded assistant artifact. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export const BUSINESS_ASSISTANT_CONTRACT_VERSION = '1';
export const BUSINESS_ASSISTANT_SERIALIZER_VERSION = '1';

export const executionKinds = ['READ_ONLY', 'CANONICAL_WRITE'] as const;
export type ExecutionKind = typeof executionKinds[number];
export const riskLevels = ['READ_ONLY', 'STANDARD_WRITE', 'SENSITIVE_WRITE'] as const;
export type RiskLevel = typeof riskLevels[number];
export const confirmationPolicies = ['NONE', 'ALWAYS', 'CONDITIONAL'] as const;
export type ConfirmationPolicy = typeof confirmationPolicies[number];
export const reviewPolicies = ['NONE', 'REQUIRED'] as const;
export type ReviewPolicy = typeof reviewPolicies[number];
export const capabilityStages = ['CLASSIFICATION', 'PREPARATION', 'EXECUTION', 'EFFECTS', 'READ_BACK', 'REVIEW'] as const;
export type CapabilityStage = typeof capabilityStages[number];

export const resourceRoles = ['source', 'target', 'context'] as const;
export type ResourceRole = typeof resourceRoles[number];

export interface ResourceRef {
  resourceType: string;
  resourceId: string;
  role: ResourceRole;
}

export const resourceRefSchema = z.object({
  resourceType: z.string().trim().min(1).max(100),
  resourceId: z.string().trim().min(1).max(200),
  role: z.enum(resourceRoles),
}).strict();

export interface CanonicalActorContext {
  tenantId: string;
  userId: string;
  requestId: string;
  source: string;
}

export interface WorkerInvocationContext extends CanonicalActorContext {
  conversationId?: string;
  runId?: string;
  runItemId?: string;
  attemptId?: string;
  claimToken?: string;
  claimGeneration?: number;
}

export interface CapabilityContext {
  actor: CanonicalActorContext;
  resources: readonly ResourceRef[];
  invocation?: WorkerInvocationContext;
  signal?: AbortSignal;
}

export interface CapabilityEffectDescriptor {
  effectKind: string;
  target: string;
  required: boolean;
  description?: string;
}

export interface PreparedCapabilityArtifact {
  status: 'PREPARED' | 'BLOCKED';
  items: readonly PreparedCapabilityItem[];
  warnings?: readonly string[];
  blockers?: readonly string[];
  preparedAt: string;
  preparedHash: string;
}

export interface PreparedCapabilityItem {
  itemId: string;
  itemKey: string;
  input: JsonValue;
  resources: readonly ResourceRef[];
  status: 'ELIGIBLE' | 'BLOCKED' | 'NOT_SELECTED';
  expectedRevisions?: Readonly<Record<string, string | number>>;
  effectManifest?: readonly CapabilityEffectDescriptor[];
  metadata?: JsonValue;
}

export interface BlockedPreparation {
  status: 'BLOCKED';
  reason: string;
  code?: string;
  items?: readonly PreparedCapabilityItem[];
}

/**
 * A module-owned correction preparation context. The generic correction
 * service supplies only already-owned, latest committed assistant records and
 * a transaction client; the capability decides whether its immutable review
 * evidence can produce a new prepared item.
 */
export interface CapabilityCorrectionContext {
  actor: CanonicalActorContext;
  request: unknown;
  sourceRunId: string;
  sourceReview: unknown;
  sourceItem: unknown;
  nextRunId: string;
  nextItemId: string;
  db: unknown;
}

export interface CapabilityCorrectionPreparation {
  status: 'PREPARED';
  preparedItem: PreparedCapabilityItem;
  lineage: JsonValue;
  resources: readonly ResourceRef[];
}

export type CapabilityCorrectionHandler = (
  context: CapabilityCorrectionContext,
) => Promise<CapabilityCorrectionPreparation | BlockedPreparation>;

export type CapabilityCorrectionErrorCode =
  | 'VALIDATION_FAILED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'PROPOSAL_STALE'
  | 'ACTION_CONFLICT';

/** Error boundary used by module handlers without importing the generic service. */
export class CapabilityCorrectionError extends Error {
  constructor(
    readonly code: CapabilityCorrectionErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'CapabilityCorrectionError';
  }
}

export function isBlockedPreparation(value: PreparedCapabilityArtifact | BlockedPreparation): value is BlockedPreparation {
  return value.status === 'BLOCKED' && 'reason' in value;
}

export interface ReadExecutionResult {
  output: JsonValue;
  observedAt: string;
  resources: readonly ResourceRef[];
  warnings?: readonly string[];
}

export interface CanonicalReceiptRef {
  receiptType: string;
  receiptId: string;
  operationId: string;
  status: 'COMMITTED' | 'NO_COMMIT' | 'UNKNOWN';
  payloadHash: string;
  /** Durable fields used to resume read-back/effects after a lost response. */
  companyId?: string | null;
  mode?: 'CREATE' | 'UPDATE';
  beforeRevision?: number | null;
  afterRevision?: number | null;
  effectStatus?: 'NOT_REQUIRED' | 'PENDING' | 'COMPLETE' | 'FAILED';
}

export interface WriteExecutionResult {
  output: JsonValue;
  receipt: CanonicalReceiptRef;
  effectStatus: 'NOT_REQUIRED' | 'PENDING' | 'COMPLETE' | 'FAILED';
}

export interface ReconcileResult {
  status: 'COMMITTED' | 'NO_COMMIT' | 'UNKNOWN';
  receipt?: CanonicalReceiptRef;
  /** Reconstructed canonical output for commit-known recovery. */
  output?: JsonValue;
  effectStatus?: 'NOT_REQUIRED' | 'PENDING' | 'COMPLETE' | 'FAILED';
  safeError?: SafeAssistantError;
}

export interface FinalizeResult {
  status: 'COMPLETE' | 'PENDING' | 'FAILED';
  output?: JsonValue;
  safeError?: SafeAssistantError;
}

export interface ReviewResult {
  verdict: 'PASS' | 'PASS_WITH_WARNINGS' | 'NEEDS_REVIEW' | 'REVIEW_FAILED';
  executionConformance: 'PASS' | 'FAIL' | 'UNVERIFIABLE';
  sourceAlignment: 'NO_UNEXPLAINED_DIFFERENCE' | 'DIFFERENCES_PRESENT' | 'INCOMPLETE';
  findings: readonly JsonValue[];
  coverage: JsonValue;
}

export interface CapabilityPresentation {
  sections: readonly CapabilityPresentationSection[];
  allowedActions?: readonly string[];
}

export interface CapabilityPresentationSection {
  id: string;
  title: string;
  kind: 'TEXT' | 'TABLE' | 'WARNINGS' | 'RESOURCES' | 'CHANGES' | 'FORM';
  value: JsonValue;
}

export interface CapabilityResourceDescriptor {
  resourceType: string;
  resourceId: string;
  title: string;
  role: ResourceRole;
  description?: string;
}

type CapabilitySchema = z.ZodTypeAny;

interface CapabilityCommon {
  id: string;
  version: string;
  contractVersion: string;
  title: string;
  description: string;
  riskLevel: RiskLevel;
  confirmationPolicy: ConfirmationPolicy;
  approvalPolicyVersion: string;
  requiredPermissions: readonly string[];
  inputSchema: CapabilitySchema;
  itemInputSchema: CapabilitySchema;
  preparedSchema: CapabilitySchema;
  outputSchema: CapabilitySchema;
  revisionSchema?: CapabilitySchema;
  snapshotSchema?: CapabilitySchema;
  effects?: readonly CapabilityEffectDescriptor[];
  splitInput: (input: unknown, actor: CanonicalActorContext) => readonly { itemKey: string; input: unknown; resources?: readonly ResourceRef[] }[];
  /** Optional module-owned, access-controlled picker search. */
  resolveResources?: (actor: CanonicalActorContext, query?: string) => Promise<readonly CapabilityResourceDescriptor[]>;
  prepare: (input: unknown, context: CapabilityContext) => Promise<PreparedCapabilityArtifact | BlockedPreparation>;
  present: (artifacts: unknown) => CapabilityPresentation;
}

export interface ReadCapabilityDefinition extends CapabilityCommon {
  executionKind: 'READ_ONLY';
  confirmationPolicy: 'NONE';
  reviewPolicy: 'NONE';
  execute: (prepared: unknown, context: CapabilityContext) => Promise<ReadExecutionResult>;
  revise?: never;
  readBack?: never;
  reconcile?: never;
  finalize?: never;
  review?: never;
  prepareCorrection?: never;
}

export interface WriteCapabilityDefinition extends CapabilityCommon {
  executionKind: 'CANONICAL_WRITE';
  reviewPolicy: ReviewPolicy;
  revisionSchema: CapabilitySchema;
  execute: (prepared: unknown, context: CapabilityContext, operationId: string) => Promise<WriteExecutionResult>;
  revise: (prepared: unknown, revision: unknown, context: CapabilityContext) => Promise<PreparedCapabilityArtifact | BlockedPreparation>;
  readBack: (output: unknown, context: CapabilityContext) => Promise<{ snapshot: JsonValue; observedAt: string; resources: readonly ResourceRef[] }>;
  reconcile: (operationId: string, context: CapabilityContext) => Promise<ReconcileResult>;
  finalize?: (output: unknown, context: CapabilityContext) => Promise<FinalizeResult>;
  review?: (prepared: unknown, output: unknown, snapshot: unknown, context: CapabilityContext) => Promise<ReviewResult>;
  /** Optional module-owned preparation of a correction from committed review evidence. */
  prepareCorrection?: CapabilityCorrectionHandler;
}

export type BusinessAssistantCapability = ReadCapabilityDefinition | WriteCapabilityDefinition;

export interface SafeAssistantError {
  code:
    | 'VALIDATION_FAILED'
    | 'FORBIDDEN'
    | 'NOT_FOUND'
    | 'PROPOSAL_STALE'
    | 'APPROVAL_EXPIRED'
    | 'ACTION_CONFLICT'
    | 'RATE_LIMITED'
    | 'OUTCOME_UNKNOWN'
    | 'EVIDENCE_UNAVAILABLE'
    | 'CAPABILITY_VERSION_UNAVAILABLE'
    | 'WORKSPACE_PAUSED'
    | 'INTERNAL_ERROR';
  message: string;
  retryable?: boolean;
  details?: JsonValue;
}

export function validateCapabilityDefinition(capability: BusinessAssistantCapability): void {
  if (!capability || typeof capability !== 'object') throw new Error('Invalid capability definition');
  const capabilityIdentity = `${(capability as CapabilityCommon).id}@${(capability as CapabilityCommon).version}`;
  if (!/^[a-z][a-z0-9_.-]{1,127}$/.test(capability.id)) throw new Error(`Invalid capability id: ${capability.id}`);
  if (!/^\d+\.\d+(?:\.\d+)?$/.test(capability.version)) throw new Error(`Invalid capability version: ${capability.version}`);
  if (!capability.contractVersion || !capability.approvalPolicyVersion) throw new Error(`Missing capability policy version: ${capability.id}`);
  if (!capability.title || !capability.description) throw new Error(`Missing capability description: ${capability.id}`);
  if (!capability.inputSchema || !capability.itemInputSchema || !capability.preparedSchema || !capability.outputSchema) {
    throw new Error(`Missing capability schemas: ${capability.id}@${capability.version}`);
  }
  if (typeof capability.splitInput !== 'function' || typeof capability.prepare !== 'function' || typeof capability.present !== 'function') {
    throw new Error(`Missing capability foundation handler: ${capability.id}@${capability.version}`);
  }
  if (capability.executionKind === 'READ_ONLY') {
    if (capability.confirmationPolicy !== 'NONE' || capability.reviewPolicy !== 'NONE') {
      throw new Error(`Read capability must use NONE confirmation/review: ${capabilityIdentity}`);
    }
    if (capability.reconcile || capability.finalize || capability.readBack || capability.review || capability.revise || capability.prepareCorrection) {
      throw new Error(`Read capability declares write/review handler: ${capabilityIdentity}`);
    }
    if (typeof capability.execute !== 'function') throw new Error(`Read capability is missing execute: ${capability.id}@${capability.version}`);
    return;
  }
  if (capability.executionKind !== 'CANONICAL_WRITE') throw new Error(`Unknown execution kind: ${capabilityIdentity}`);
  if (capability.confirmationPolicy === 'NONE') throw new Error(`Write capability cannot skip confirmation: ${capability.id}@${capability.version}`);
  if (typeof capability.execute !== 'function' || typeof capability.revise !== 'function' || typeof capability.reconcile !== 'function' || typeof capability.readBack !== 'function') {
    throw new Error(`Write capability is missing recovery handlers: ${capability.id}@${capability.version}`);
  }
  if (capability.reviewPolicy === 'REQUIRED' && (typeof capability.review !== 'function' || !capability.snapshotSchema)) {
    throw new Error(`Required review is missing evidence/review handler: ${capability.id}@${capability.version}`);
  }
  if (capability.effects?.some((effect) => effect.required) && typeof capability.finalize !== 'function') {
    throw new Error(`Capability with required effects is missing finalize: ${capability.id}@${capability.version}`);
  }
}

export function assertCapabilityDefinition(capability: BusinessAssistantCapability): BusinessAssistantCapability {
  validateCapabilityDefinition(capability);
  return capability;
}

export class BusinessAssistantCapabilityRegistry {
  private readonly capabilities = new Map<string, BusinessAssistantCapability>();

  constructor(definitions: readonly BusinessAssistantCapability[] = []) {
    for (const definition of definitions) this.register(definition);
  }

  register(definition: BusinessAssistantCapability): void {
    validateCapabilityDefinition(definition);
    const key = `${definition.id}@${definition.version}`;
    if (this.capabilities.has(key)) throw new Error(`Duplicate capability: ${key}`);
    this.capabilities.set(key, definition);
  }

  get(id: string, version?: string): BusinessAssistantCapability | undefined {
    if (version) return this.capabilities.get(`${id}@${version}`);
    const candidates = [...this.capabilities.values()].filter((candidate) => candidate.id === id);
    return candidates.sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))[0];
  }

  require(id: string, version?: string): BusinessAssistantCapability {
    const capability = this.get(id, version);
    if (!capability) throw new Error(`Capability version unavailable: ${id}${version ? `@${version}` : ''}`);
    return capability;
  }

  list(): readonly BusinessAssistantCapability[] {
    return [...this.capabilities.values()].sort((a, b) => `${a.id}@${a.version}`.localeCompare(`${b.id}@${b.version}`));
  }

  descriptors(): readonly CapabilityDescriptor[] {
    return this.list().map((capability) => ({
      id: capability.id,
      version: capability.version,
      title: capability.title,
      description: capability.description,
      executionKind: capability.executionKind,
      riskLevel: capability.riskLevel,
      confirmationPolicy: capability.confirmationPolicy,
      reviewPolicy: capability.reviewPolicy,
      requiredPermissions: [...capability.requiredPermissions],
    }));
  }
}

export interface CapabilityDescriptor {
  id: string;
  version: string;
  title: string;
  description: string;
  executionKind: ExecutionKind;
  riskLevel: RiskLevel;
  confirmationPolicy: ConfirmationPolicy;
  reviewPolicy: ReviewPolicy;
  requiredPermissions: readonly string[];
}

/**
 * Canonical JSON used for body, proposal and operation fingerprints. It keeps
 * semantic array order and sorts object keys. Undefined, non-finite numbers,
 * functions, symbols and cyclic values are rejected instead of coerced.
 */
export function canonicalizeJson(value: unknown, seen = new Set<object>()): JsonValue {
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Cannot serialize a non-finite number');
    return value;
  }
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error('Cannot serialize an invalid date');
    return value.toISOString();
  }
  if (typeof value !== 'object' || value === undefined) throw new Error('Cannot serialize undefined or non-JSON value');
  if (seen.has(value)) throw new Error('Cannot serialize cyclic JSON');
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => canonicalizeJson(item, seen));
    const result: Record<string, JsonValue> = {};
    for (const key of Object.keys(value).sort()) result[key] = canonicalizeJson((value as Record<string, unknown>)[key], seen);
    return result;
  } finally {
    seen.delete(value);
  }
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalizeJson(value));
}

export function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

export interface RunItemAggregateInput {
  selected: boolean;
  lifecycleState: string;
  executionOutcome: string;
  reviewOutcome: string;
  requiredEffectStatus: string;
  dispositionReason?: string | null;
}

export interface RunAggregate {
  status: 'PREPARING' | 'WAITING_CONFIRMATION' | 'READY' | 'RUNNING' | 'REVIEWING' | 'RECOVERING' | 'CANCEL_REQUESTED' | 'COMPLETED' | 'COMPLETED_WITH_EXCEPTIONS' | 'FAILED' | 'CANCELLED' | 'EXPIRED';
  counts: {
    total: number;
    selected: number;
    imported: number;
    readSucceeded: number;
    noChange: number;
    blocked: number;
    excluded: number;
    failed: number;
    cancelled: number;
    expired: number;
    reviewPending: number;
    reviewPassed: number;
    reviewWarnings: number;
    needsReview: number;
    unknown: number;
  };
}

/** Derive run state from item dimensions; the result is never user-editable. */
export function aggregateRun(items: readonly RunItemAggregateInput[], options?: { confirmationPending?: boolean; preparing?: boolean; cancellationRequested?: boolean }): RunAggregate {
  const counts = {
    total: items.length,
    selected: items.filter((item) => item.selected).length,
    imported: items.filter((item) => item.selected && item.executionOutcome === 'COMMITTED').length,
    readSucceeded: items.filter((item) => item.selected && item.executionOutcome === 'SUCCEEDED_READ').length,
    noChange: items.filter((item) => item.selected && item.executionOutcome === 'NO_CHANGE').length,
    blocked: items.filter((item) => item.lifecycleState === 'BLOCKED').length,
    excluded: items.filter((item) => !item.selected || item.dispositionReason === 'NOT_SELECTED').length,
    failed: items.filter((item) => item.selected && item.executionOutcome === 'FAILED_NO_COMMIT').length,
    cancelled: items.filter((item) => item.lifecycleState === 'CANCELLED').length,
    expired: items.filter((item) => item.lifecycleState === 'EXPIRED').length,
    reviewPending: items.filter((item) => item.selected && item.reviewOutcome === 'RUNNING' || item.selected && item.reviewOutcome === 'NOT_STARTED' && item.executionOutcome === 'COMMITTED').length,
    reviewPassed: items.filter((item) => item.selected && item.reviewOutcome === 'PASS').length,
    reviewWarnings: items.filter((item) => item.selected && item.reviewOutcome === 'PASS_WITH_WARNINGS').length,
    needsReview: items.filter((item) => item.selected && (item.reviewOutcome === 'NEEDS_REVIEW' || item.reviewOutcome === 'REVIEW_FAILED')).length,
    unknown: items.filter((item) => item.selected && item.executionOutcome === 'OUTCOME_UNKNOWN').length,
  };
  const selectedItems = items.filter((item) => item.selected);
  const active = selectedItems.some((item) => ['PENDING', 'PREPARING', 'WAITING_CONFIRMATION', 'READY', 'EXECUTING', 'RECOVERING', 'READING_BACK', 'REVIEWING'].includes(item.lifecycleState));
  const recovering = selectedItems.some((item) => item.lifecycleState === 'RECOVERING' || item.executionOutcome === 'OUTCOME_UNKNOWN');
  const reviewing = selectedItems.some((item) => item.lifecycleState === 'REVIEWING' || counts.reviewPending > 0);
  const hasSuccess = counts.imported + counts.readSucceeded + counts.noChange > 0;
  const hasException = counts.blocked + counts.excluded + counts.failed + counts.cancelled + counts.expired + counts.needsReview + counts.reviewWarnings > 0;
  const allCancelledBeforeSuccess = selectedItems.length > 0 && !hasSuccess && selectedItems.every((item) => item.lifecycleState === 'CANCELLED');
  const allExpiredBeforeSuccess = selectedItems.length > 0 && !hasSuccess && selectedItems.every((item) => item.lifecycleState === 'EXPIRED');
  let status: RunAggregate['status'];
  if (options?.cancellationRequested && active) status = 'CANCEL_REQUESTED';
  else if (recovering) status = 'RECOVERING';
  else if (options?.preparing || selectedItems.some((item) => item.lifecycleState === 'PREPARING')) status = 'PREPARING';
  else if (options?.confirmationPending || selectedItems.some((item) => item.lifecycleState === 'WAITING_CONFIRMATION')) status = 'WAITING_CONFIRMATION';
  else if (selectedItems.some((item) => item.lifecycleState === 'READY')) status = 'READY';
  else if (reviewing) status = 'REVIEWING';
  else if (active) status = 'RUNNING';
  else if (allCancelledBeforeSuccess) status = 'CANCELLED';
  else if (allExpiredBeforeSuccess) status = 'EXPIRED';
  else if (!hasSuccess && counts.failed > 0 && counts.unknown === 0) status = 'FAILED';
  else if (hasException || counts.reviewWarnings > 0 || counts.needsReview > 0) status = 'COMPLETED_WITH_EXCEPTIONS';
  else status = 'COMPLETED';
  return { status, counts };
}

export const BUSINESS_ASSISTANT_LIMITS = {
  maxItemsPerRun: 10,
  maxMessageChars: 12_000,
  maxProposalArtifactBytes: 1_000_000,
  maxReviewFindings: 200,
  maxResourceRefs: 50,
  activeStageSlots: 2,
  leaseSeconds: 90,
  heartbeatSeconds: 15,
  maxAttemptsPerStage: 3,
  approvalMinutes: 30,
} as const;
