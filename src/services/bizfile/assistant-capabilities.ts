import { createHash } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { storage } from '@/lib/storage';
import { evaluateFreshAuthorization } from '@/lib/fresh-authorization';
import { bizFileReviewSchema, normalizeBizFileReviewDraft } from '@/lib/validations/bizfile-review';
import {
  canonicalizeJson,
  sha256,
  type BlockedPreparation,
  type BusinessAssistantCapability,
  type CapabilityContext,
  type CapabilityPresentation,
  type CapabilityPresentationSection,
  type CanonicalActorContext,
  type CanonicalReceiptRef,
  type FinalizeResult,
  type JsonValue,
  type PreparedCapabilityArtifact,
  type PreparedCapabilityItem,
  type ReconcileResult,
  type ResourceRef,
  type ReviewResult,
  type WriteExecutionResult,
} from '@/services/business-assistant/contracts';
import { prepareBizFileImportCommand, baselineFromCompany } from './application/prepare-import';
import { prepareBizFileCorrection } from './application/prepare-correction';
import { hashBizFileValue, buildBizFileChangePlan, assertBizFileChangePlan, type BizFileBaselineSnapshot, type BizFileChangePlan, type BizFileContactDecisionBinding } from './change-plan';
import { processBizFileExtraction, processBizFileExtractionSelective } from './processor';
import { reconcileBizFileOperation, type BizFileOperationReceiptSnapshot } from './application/operation-reconciliation';
import { finalizeBizFileOperationEffects } from './application/effect-executor';
import { assessBizFileIndependentSourceReview } from './application/independent-source-review';
import { assertAssistantWorkspaceOperational } from '@/services/business-assistant/policy.service';

/**
 * Input accepted by the reference capability. Resources are the preferred
 * source/target binding; the explicit IDs are retained for non-UI callers and
 * are required to agree with resources when both are present.
 */
const contactDecisionSchema = z.object({
  sourceRecordId: z.string().trim().min(1).max(200),
  decision: z.discriminatedUnion('action', [
    z.object({ action: z.literal('REUSE'), contactId: z.string().uuid() }),
    z.object({ action: z.literal('CREATE_SEPARATE'), reason: z.string().trim().min(10).max(500) }),
  ]),
  expectedContactUpdatedAt: z.string().datetime().optional(),
}).strict();

const importInputBaseSchema = z.object({
  documentIds: z.array(z.string().trim().min(1).max(200)).min(1).max(10).optional(),
  documentId: z.string().trim().min(1).max(200).optional(),
  targetCompanyId: z.string().trim().min(1).max(200).optional(),
  mode: z.enum(['CREATE', 'UPDATE']).optional(),
  sourceVersion: z.number().int().nonnegative().optional(),
  contactDecisions: z.record(contactDecisionSchema).optional(),
  selectedChangeIds: z.array(z.string().trim().min(1).max(300)).optional(),
  /** Used by deterministic unit fixtures; production preparation reads the source document. */
  extractedData: z.unknown().optional(),
}).strict();

function refineImportInput(value: z.infer<typeof importInputBaseSchema>, context: z.RefinementCtx): void {
  const documentIds = value.documentIds ?? (value.documentId ? [value.documentId] : []);
  if (documentIds.length === 0) context.addIssue({ code: z.ZodIssueCode.custom, path: ['documentIds'], message: 'At least one BizFile document is required' });
  if (new Set(documentIds).size !== documentIds.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['documentIds'], message: 'Document IDs must be unique' });
  if (value.mode === 'UPDATE' && !value.targetCompanyId) context.addIssue({ code: z.ZodIssueCode.custom, path: ['targetCompanyId'], message: 'UPDATE requires a target company' });
  if (value.mode === 'CREATE' && value.targetCompanyId) context.addIssue({ code: z.ZodIssueCode.custom, path: ['targetCompanyId'], message: 'CREATE cannot target a company' });
}

const importInputSchema = importInputBaseSchema.superRefine(refineImportInput);

const itemInputSchema = importInputBaseSchema.extend({
  documentId: z.string().trim().min(1).max(200),
}).strict().superRefine(refineImportInput);

const preparedSchema = z.object({
  status: z.enum(['PREPARED', 'BLOCKED']),
  items: z.array(z.unknown()).max(10),
  warnings: z.array(z.string()).optional(),
  blockers: z.array(z.string()).optional(),
  preparedAt: z.string().datetime(),
  preparedHash: z.string().length(64),
}).strict();

const revisionSchema = z.object({
  itemId: z.string().trim().min(1).max(200),
  patch: z.object({
    selectedChangeIds: z.array(z.string().trim().min(1).max(300)),
  }).strict(),
}).strict();

const outputSchema = z.object({
  operationId: z.string().trim().min(1).max(200),
  companyId: z.string().trim().min(1).max(200),
  created: z.boolean(),
  receipt: z.object({
    receiptType: z.literal('BizFileOperationReceipt'),
    receiptId: z.string().trim().min(1),
    operationId: z.string().trim().min(1),
    status: z.enum(['COMMITTED', 'NO_COMMIT', 'UNKNOWN']),
    payloadHash: z.string().length(64),
    companyId: z.string().trim().min(1).nullable().optional(),
    mode: z.enum(['CREATE', 'UPDATE']).optional(),
    beforeRevision: z.number().int().nonnegative().nullable().optional(),
    afterRevision: z.number().int().nonnegative().nullable().optional(),
    effectStatus: z.enum(['NOT_REQUIRED', 'PENDING', 'COMPLETE', 'FAILED']).optional(),
  }).strict(),
  effectStatus: z.enum(['NOT_REQUIRED', 'PENDING', 'COMPLETE', 'FAILED']),
  selectedChangeIds: z.array(z.string()),
  plan: z.unknown(),
}).strict();

const snapshotSchema = z.object({
  companyId: z.string().trim().min(1),
  aggregateRevision: z.number().int().nonnegative(),
  baseline: z.record(z.unknown()),
  observedAt: z.string().datetime(),
}).strict();

type ImportInput = z.infer<typeof importInputSchema>;

function jsonValue(value: unknown, seen = new Set<object>()): unknown {
  if (value === undefined) return null;
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if (seen.has(value)) throw new Error('Cannot serialize cyclic BizFile artifact');
    seen.add(value);
    try {
      const toJSON = (value as { toJSON?: unknown }).toJSON;
      if (typeof toJSON === 'function') return jsonValue((toJSON as () => unknown)(), seen);
      if (Array.isArray(value)) return value.map((child) => jsonValue(child, seen));
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, child]) => child !== undefined).map(([key, child]) => [key, jsonValue(child, seen)]));
    } finally {
      seen.delete(value);
    }
  }
  throw new Error('Cannot serialize a non-JSON BizFile artifact');
}

function json(value: unknown): JsonValue {
  return canonicalizeJson(jsonValue(value));
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function blocked(reason: string, code: string): BlockedPreparation {
  return { status: 'BLOCKED', reason, code };
}

function isDocumentResource(resource: ResourceRef): boolean {
  return resource.role === 'source' && ['document', 'Document', 'bizfile.document'].includes(resource.resourceType);
}

function isCompanyResource(resource: ResourceRef): boolean {
  return resource.role === 'target' && ['company', 'Company'].includes(resource.resourceType);
}

function inputDocumentIds(input: ImportInput, resources: readonly ResourceRef[]): string[] {
  const explicit = input.documentIds ?? (input.documentId ? [input.documentId] : []);
  const resourceIds = resources.filter(isDocumentResource).map((resource) => resource.resourceId);
  if (explicit.length > 0 && resourceIds.length > 0 && (explicit.length !== resourceIds.length || explicit.some((id, index) => id !== resourceIds[index]))) {
    throw new Error('BizFile source IDs disagree with attached source resources');
  }
  return resourceIds.length > 0 ? resourceIds : explicit;
}

function inputTargetCompanyId(input: ImportInput, resources: readonly ResourceRef[]): string | undefined {
  const resourceTarget = resources.find(isCompanyResource)?.resourceId;
  if (input.targetCompanyId && resourceTarget && input.targetCompanyId !== resourceTarget) throw new Error('BizFile target ID disagrees with attached target resource');
  return resourceTarget ?? input.targetCompanyId;
}

function decisionsForInput(input: ImportInput): Record<string, BizFileContactDecisionBinding> {
  return Object.fromEntries(Object.entries(input.contactDecisions ?? {}).map(([key, value]) => [key, value as BizFileContactDecisionBinding]));
}

function planFromItem(item: PreparedCapabilityItem): BizFileChangePlan {
  const value = item.input;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Prepared BizFile item is malformed');
  const plan = (value as Record<string, unknown>).plan;
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw new Error('Prepared BizFile item has no change plan');
  assertBizFileChangePlan(plan as BizFileChangePlan);
  return plan as BizFileChangePlan;
}

function sourceFromItem(item: PreparedCapabilityItem): { documentId: string; storageKey: string; mimeType: string; version: number; sourceRevision: number; sourceHash?: string } {
  const value = item.input;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Prepared BizFile item is malformed');
  const source = (value as Record<string, unknown>).source;
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('Prepared BizFile item has no source manifest');
  const sourceRecord = source as Record<string, unknown>;
  if (typeof sourceRecord.documentId !== 'string' || typeof sourceRecord.storageKey !== 'string' || typeof sourceRecord.mimeType !== 'string' || typeof sourceRecord.version !== 'number' || typeof sourceRecord.sourceRevision !== 'number' || !Number.isSafeInteger(sourceRecord.sourceRevision) || sourceRecord.sourceRevision < 0) throw new Error('Prepared BizFile source manifest is incomplete');
  return {
    documentId: sourceRecord.documentId,
    storageKey: sourceRecord.storageKey,
    mimeType: sourceRecord.mimeType,
    version: sourceRecord.version,
    sourceRevision: sourceRecord.sourceRevision,
    ...(typeof sourceRecord.sourceHash === 'string' ? { sourceHash: sourceRecord.sourceHash } : {}),
  };
}

function itemValue(itemId: string, plan: BizFileChangePlan, source: ReturnType<typeof sourceFromItem>): JsonValue {
  return json({ plan, source, itemId });
}

function selectedChangePresentation(item: PreparedCapabilityItem, plan: BizFileChangePlan): JsonValue {
  return json({
    itemId: item.itemId,
    selectedChangeIds: plan.selectedChangeIds,
    changes: plan.changes.map((change) => ({ id: change.id, path: change.path, before: change.before, after: change.after })),
  });
}

function operationReceiptRef(value: unknown, operationId: string, payloadHash: string): CanonicalReceiptRef {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Canonical BizFile operation returned no receipt');
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string' || typeof record.status !== 'string') throw new Error('Canonical BizFile receipt is malformed');
  const status = record.status;
  if (status !== 'COMMITTED' && status !== 'NO_COMMIT' && status !== 'UNKNOWN') throw new Error('Canonical BizFile receipt has an unsupported status');
  return {
    receiptType: 'BizFileOperationReceipt',
    receiptId: record.id,
    operationId,
    status,
    payloadHash,
  };
}

function operationReceiptSnapshotRef(receipt: BizFileOperationReceiptSnapshot): CanonicalReceiptRef {
  return {
    receiptType: 'BizFileOperationReceipt',
    receiptId: receipt.id,
    operationId: receipt.operationId,
    status: receipt.status,
    payloadHash: receipt.payloadHash,
    companyId: receipt.companyId,
    mode: receipt.mode,
    beforeRevision: receipt.beforeRevision,
    afterRevision: receipt.afterRevision,
    effectStatus: receipt.effectStatus,
  };
}

function afterEvidenceFromReceipt(receipt: BizFileOperationReceiptSnapshot): Record<string, unknown> | null {
  const evidence = receipt.evidence.find((candidate) => candidate.kind === 'AFTER')?.artifact;
  return evidence && typeof evidence === 'object' && !Array.isArray(evidence)
    ? evidence as Record<string, unknown>
    : null;
}

function selectedChangeIdsFromReceipt(receipt: BizFileOperationReceiptSnapshot): string[] {
  const after = afterEvidenceFromReceipt(receipt);
  if (!after || !Array.isArray(after.selectedChanges)) return [];
  return after.selectedChanges.flatMap((change) => {
    if (!change || typeof change !== 'object' || Array.isArray(change)) return [];
    const id = (change as Record<string, unknown>).id;
    return typeof id === 'string' ? [id] : [];
  });
}

function reconstructedOutputFromReceipt(
  operationId: string,
  receipt: BizFileOperationReceiptSnapshot,
): { output: JsonValue; effectStatus: WriteExecutionResult['effectStatus'] } | null {
  if (receipt.status !== 'COMMITTED' || !receipt.companyId) return null;
  const receiptRef = operationReceiptSnapshotRef(receipt);
  return {
    output: json({
      operationId,
      companyId: receipt.companyId,
      created: receipt.mode === 'CREATE',
      receipt: receiptRef,
      effectStatus: receipt.effectStatus,
      selectedChangeIds: selectedChangeIdsFromReceipt(receipt),
      // The approved plan remains in the frozen proposal. The receipt-bound
      // output carries a deliberate placeholder here; the worker supplies the
      // frozen artifact when it resumes read-back/review.
      plan: null,
    }),
    effectStatus: receipt.effectStatus,
  };
}

async function prepareItem(input: ImportInput & { documentId: string }, context: CapabilityContext): Promise<{ item: PreparedCapabilityItem; sourceUen: string } | BlockedPreparation> {
  const sourceDocument = await prisma.document.findFirst({
    where: { id: input.documentId, tenantId: context.actor.tenantId, deletedAt: null },
    select: { extractedData: true, version: true, sourceRevision: true, storageKey: true },
  });
  if (!sourceDocument) return blocked('The BizFile source document is unavailable in this workspace.', 'SOURCE_NOT_FOUND');
  const sourceRevision = typeof sourceDocument.sourceRevision === 'number'
    && Number.isSafeInteger(sourceDocument.sourceRevision)
    && sourceDocument.sourceRevision >= 0
    ? sourceDocument.sourceRevision
    : 0;
  if (!sourceDocument.storageKey) return blocked('The BizFile source document has no stored original artifact.', 'SOURCE_UNAVAILABLE');
  let sourceBytes: Buffer;
  try {
    sourceBytes = await storage.download(sourceDocument.storageKey);
  } catch {
    return blocked('The BizFile source artifact is unavailable; prepare it again when the original file is accessible.', 'SOURCE_UNAVAILABLE');
  }
  const candidate = input.extractedData ?? sourceDocument.extractedData;
  const parsed = bizFileReviewSchema.safeParse(candidate);
  if (!parsed.success) return blocked('The BizFile source has not produced a complete reviewed extraction.', 'SOURCE_NOT_REVIEWED');
  const reviewedData = normalizeBizFileReviewDraft(parsed.data);
  const targetCompanyId = inputTargetCompanyId(input, context.resources);
  if (input.mode === 'UPDATE' && !targetCompanyId) return blocked('UPDATE requires an explicitly selected target company.', 'TARGET_REQUIRED');
  if (input.mode === 'CREATE' && targetCompanyId) return blocked('CREATE cannot target an existing company.', 'CREATE_TARGET');
  const prepared = await prepareBizFileImportCommand({
    tenantId: context.actor.tenantId,
    documentId: input.documentId,
    reviewedData,
    targetCompanyId,
    sourceVersion: sourceRevision,
    sourceHash: createHash('sha256').update(sourceBytes).digest('hex'),
    contactDecisions: decisionsForInput(input),
    selectedChangeIds: input.selectedChangeIds,
  });
  if (prepared.plan.mode === 'CREATE') {
    const conflict = await prisma.company.findFirst({ where: { tenantId: context.actor.tenantId, uen: reviewedData.entityDetails.uen }, select: { id: true, deletedAt: true } });
    if (conflict) return blocked('A company with this UEN already exists; choose UPDATE with that target.', conflict.deletedAt ? 'CREATE_RECYCLED_CONFLICT' : 'CREATE_ACTIVE_CONFLICT');
  }
  const sourceHash = prepared.plan.sourceHash;
  const source = {
    documentId: prepared.source.documentId,
    storageKey: prepared.source.storageKey,
    mimeType: prepared.source.mimeType,
    version: prepared.source.version,
    sourceRevision: prepared.source.sourceRevision,
    ...(sourceHash ? { sourceHash } : {}),
  };
  const itemId = `bizfile.document.${prepared.source.documentId}`;
  const item: PreparedCapabilityItem = {
    itemId,
    itemKey: `${prepared.plan.mode}:${prepared.plan.reviewedData.entityDetails.uen}:${prepared.source.documentId}`,
    input: itemValue(itemId, prepared.plan, source),
    resources: [
      { resourceType: 'document', resourceId: prepared.source.documentId, role: 'source' },
      ...(prepared.plan.targetCompanyId ? [{ resourceType: 'company', resourceId: prepared.plan.targetCompanyId, role: 'target' as const }] : []),
    ],
    status: 'ELIGIBLE',
    expectedRevisions: {
      aggregateRevision: prepared.plan.expectedAggregateRevision,
      sourceVersion: prepared.plan.sourceVersion ?? prepared.source.sourceRevision,
      ...(prepared.plan.expectedUpdatedAt ? { updatedAt: prepared.plan.expectedUpdatedAt } : {}),
    },
    effectManifest: [
      { effectKind: 'STORAGE_FINALIZE', target: `document:${prepared.source.documentId}`, required: true, description: 'Finalize the immutable source document pointer after the canonical operation.' },
      { effectKind: 'PAGE_PREPARATION', target: `document:${prepared.source.documentId}`, required: true, description: 'Prepare document pages from the approved source artifact.' },
    ],
    metadata: json({
      sourceVersion: prepared.source.sourceRevision,
      sourceHash,
      contactCandidates: prepared.contactCandidates,
    }),
  };
  return { item, sourceUen: prepared.plan.reviewedData.entityDetails.uen };
}

function artifactHash(artifact: Omit<PreparedCapabilityArtifact, 'preparedHash'>): string {
  return sha256(artifact);
}

async function prepareCapability(input: unknown, context: CapabilityContext): Promise<PreparedCapabilityArtifact | BlockedPreparation> {
  const parsed = importInputSchema.safeParse(input);
  if (!parsed.success) return blocked('The BizFile import request is invalid.', 'VALIDATION_FAILED');
  const documentIds = inputDocumentIds(parsed.data, context.resources);
  if (documentIds.length === 0 || documentIds.length > 10) return blocked('Select between one and ten BizFile source documents.', 'SOURCE_COUNT');
  const baseInput = parsed.data;
  const preparedItems: Array<{ item: PreparedCapabilityItem; sourceUen: string }> = [];
  const blockers: string[] = [];
  const blockedItems: BlockedPreparation[] = [];
  for (const documentId of [...documentIds].sort()) {
    const result = await prepareItem({ ...baseInput, documentId, documentIds: undefined }, context);
    if (!('item' in result)) {
      blockers.push(`${documentId}: ${result.reason}`);
      blockedItems.push(result);
      continue;
    }
    preparedItems.push(result);
  }
  const seenUen = new Map<string, string>();
  const items = preparedItems.map(({ item, sourceUen }) => {
    const first = seenUen.get(sourceUen);
    if (first) {
      blockers.push(`${item.itemKey}: duplicate UEN group; review ${first} first`);
      return { ...item, status: 'BLOCKED' as const, metadata: json({ ...(item.metadata as object), blockedBy: first, reason: 'DUPLICATE_UEN_GROUP' }) };
    }
    seenUen.set(sourceUen, item.itemId);
    return item;
  });
  if (items.length === 0) {
    const code = blockedItems.length === 1 && blockedItems[0].code
      ? blockedItems[0].code
      : 'PREPARATION_BLOCKED';
    return blocked(blockers.join(' ') || 'No BizFile source could be prepared.', code);
  }
  const artifactWithoutHash: Omit<PreparedCapabilityArtifact, 'preparedHash'> = {
    status: items.some((item) => item.status === 'BLOCKED') ? 'BLOCKED' : 'PREPARED',
    items,
    ...(blockers.length ? { blockers } : {}),
    preparedAt: new Date().toISOString(),
  };
  return { ...artifactWithoutHash, preparedHash: artifactHash(artifactWithoutHash) };
}

function reviseCapability(prepared: unknown, revision: unknown, _context: CapabilityContext): Promise<PreparedCapabilityArtifact | BlockedPreparation> {
  const parsedRevision = revisionSchema.safeParse(revision);
  if (!parsedRevision.success) return Promise.resolve(blocked('The BizFile selection revision is invalid.', 'VALIDATION_FAILED'));
  const artifact = prepared as PreparedCapabilityArtifact;
  if (!artifact || !Array.isArray(artifact.items)) return Promise.resolve(blocked('The prepared BizFile proposal is unavailable.', 'PROPOSAL_STALE'));
  const item = artifact.items.find((candidate) => candidate.itemId === parsedRevision.data.itemId);
  if (!item) return Promise.resolve(blocked('The prepared BizFile item is unavailable.', 'PROPOSAL_STALE'));
  try {
    const plan = planFromItem(item);
    const selected = parsedRevision.data.patch.selectedChangeIds;
    const nextPlan = buildBizFileChangePlan({
      mode: plan.mode,
      tenantId: plan.tenantId,
      documentId: plan.documentId,
      reviewedData: plan.reviewedData,
      baseline: plan.baseline,
      targetCompanyId: plan.targetCompanyId,
      sourceVersion: plan.sourceVersion,
      sourceHash: plan.sourceHash,
      aggregateRevision: plan.aggregateRevision,
      expectedAggregateRevision: plan.expectedAggregateRevision,
      expectedUpdatedAt: plan.expectedUpdatedAt,
      contactDecisions: plan.contactDecisions,
      selectedChangeIds: selected,
      officerActions: plan.officerActions,
    });
    const source = sourceFromItem(item);
    const nextItem = { ...item, input: itemValue(item.itemId, nextPlan, source), metadata: json({ ...(item.metadata as object), revisedAt: new Date().toISOString() }) };
    const items = artifact.items.map((candidate) => candidate.itemId === item.itemId ? nextItem : candidate);
    const nextWithoutHash: Omit<PreparedCapabilityArtifact, 'preparedHash'> = { ...artifact, items };
    delete (nextWithoutHash as { preparedHash?: string }).preparedHash;
    return Promise.resolve({ ...nextWithoutHash, preparedHash: artifactHash(nextWithoutHash) });
  } catch (error) {
    return Promise.resolve(blocked(error instanceof Error ? error.message : 'The BizFile selection could not be revised.', 'REVISION_INVALID'));
  }
}

async function executeCapability(prepared: unknown, context: CapabilityContext, operationId: string): Promise<WriteExecutionResult> {
  const artifact = prepared as PreparedCapabilityArtifact;
  const eligible = artifact?.items?.filter((item) => item.status === 'ELIGIBLE') ?? [];
  if (eligible.length !== 1) throw new Error('BizFile execution requires exactly one eligible prepared item');
  const item = eligible[0];
  const plan = planFromItem(item);
  const source = sourceFromItem(item);
  const effectIntents = [
    {
      tenantId: context.actor.tenantId,
      effectKind: 'STORAGE_FINALIZE',
      target: `document:${source.documentId}`,
      payload: { documentId: source.documentId, storageKey: source.storageKey, sourceHash: source.sourceHash ?? null, sourceRevision: source.sourceRevision },
      payloadHash: hashBizFileValue({ documentId: source.documentId, storageKey: source.storageKey, sourceHash: source.sourceHash ?? null, sourceRevision: source.sourceRevision }),
    },
    {
      tenantId: context.actor.tenantId,
      effectKind: 'PAGE_PREPARATION',
      target: `document:${source.documentId}`,
      payload: {
        documentId: source.documentId,
        storageKey: source.storageKey,
        mimeType: source.mimeType,
        sourceHash: source.sourceHash ?? null,
        sourceRevision: source.sourceRevision,
        finalizedSourceRevision: source.sourceRevision + 1,
      },
      payloadHash: hashBizFileValue({
        documentId: source.documentId,
        storageKey: source.storageKey,
        mimeType: source.mimeType,
        sourceHash: source.sourceHash ?? null,
        sourceRevision: source.sourceRevision,
        finalizedSourceRevision: source.sourceRevision + 1,
      }),
    },
  ];
  const sourceEvidence = {
    documentId: source.documentId,
    version: source.version,
    sourceRevision: source.sourceRevision,
    storageKey: source.storageKey,
    mimeType: source.mimeType,
    sourceHash: source.sourceHash ?? null,
    extractedDataHash: hashBizFileValue(plan.reviewedData),
  };
  const operationContext = {
    operationId,
    capabilityId: 'bizfile.import_and_review',
    capabilityVersion: '1.0',
    schemaVersion: '1',
    sourceEvidence,
    effectIntents,
    ...(context.invocation?.runItemId && context.invocation.claimToken && typeof context.invocation.claimGeneration === 'number' && Number.isInteger(context.invocation.claimGeneration)
      ? {
        claim: {
          runItemId: context.invocation.runItemId,
          claimToken: context.invocation.claimToken,
          claimGeneration: context.invocation.claimGeneration,
        },
      }
      : {}),
  };
  const result = plan.mode === 'UPDATE'
    ? await processBizFileExtractionSelective(source.documentId, plan.reviewedData, context.actor.userId, context.actor.tenantId, plan.targetCompanyId!, undefined, undefined, plan, operationContext)
    : await processBizFileExtraction(source.documentId, plan.reviewedData, context.actor.userId, context.actor.tenantId, source.storageKey, source.mimeType, undefined, plan, operationContext);
  const receipt = await prisma.bizFileOperationReceipt.findUnique({ where: { tenantId_operationId: { tenantId: context.actor.tenantId, operationId } } });
  const receiptRef = operationReceiptRef(receipt, operationId, plan.canonicalHash);
  const effectStatus = receipt?.effectStatus ?? 'PENDING';
  const output = json({ operationId, companyId: result.companyId, created: result.created, receipt: receiptRef, effectStatus, selectedChangeIds: plan.selectedChangeIds, plan });
  return { output, receipt: receiptRef, effectStatus };
}

async function reconcileCapability(operationId: string, context: CapabilityContext): Promise<ReconcileResult> {
  const invocation = context.invocation;
  const result = await reconcileBizFileOperation({
    tenantId: context.actor.tenantId,
    operationId,
    signal: context.signal,
    ...(invocation?.runItemId && invocation.claimToken && typeof invocation.claimGeneration === 'number' && Number.isInteger(invocation.claimGeneration)
      ? {
        claim: {
          runItemId: invocation.runItemId,
          claimToken: invocation.claimToken,
          claimGeneration: invocation.claimGeneration,
        },
      }
      : {}),
  });
  if (result.status === 'UNKNOWN') {
    return {
      status: 'UNKNOWN',
      ...(result.receipt ? { receipt: operationReceiptSnapshotRef(result.receipt) } : {}),
      safeError: {
        code: 'OUTCOME_UNKNOWN',
        message: 'The BizFile operation outcome remains unknown; do not submit a replacement.',
        retryable: true,
      },
    };
  }
  if (result.status === 'NO_COMMIT') return { status: 'NO_COMMIT' };
  if (!result.receipt) {
    return {
      status: 'UNKNOWN',
      safeError: { code: 'EVIDENCE_UNAVAILABLE', message: 'The committed BizFile receipt could not be read back safely.', retryable: true },
    };
  }
  const reconstructed = reconstructedOutputFromReceipt(operationId, result.receipt);
  if (!reconstructed) {
    return {
      status: 'UNKNOWN',
      receipt: operationReceiptSnapshotRef(result.receipt),
      safeError: { code: 'EVIDENCE_UNAVAILABLE', message: 'The committed BizFile receipt is missing durable output evidence.', retryable: true },
    };
  }
  return {
    status: 'COMMITTED',
    receipt: operationReceiptSnapshotRef(result.receipt),
    output: reconstructed.output,
    effectStatus: reconstructed.effectStatus,
  };
}

async function readBackCapability(output: unknown, context: CapabilityContext): Promise<{ snapshot: JsonValue; observedAt: string; resources: readonly ResourceRef[] }> {
  const value = output as Record<string, unknown>;
  const companyId = typeof value?.companyId === 'string' ? value.companyId : undefined;
  if (!companyId) throw new Error('BizFile read-back has no company ID');
  const access = await evaluateFreshAuthorization({
    userId: context.actor.userId, workspaceId: context.actor.tenantId,
    permission: { resource: 'company', action: 'read' },
    resource: { kind: 'company', id: companyId },
  });
  if (!access.allowed) throw new Error('BizFile read-back access is no longer available');
  const company = await prisma.company.findFirst({
    where: { id: companyId, tenantId: context.actor.tenantId, deletedAt: null },
    include: {
      addresses: { where: { isCurrent: true } },
      formerNames: true,
      shareCapital: true,
      officers: { where: { isCurrent: true } },
      shareholders: { where: { isCurrent: true } },
      auditor: true,
      charges: true,
    },
  });
  if (!company) throw new Error('BizFile company read-back is unavailable');
  const baseline = baselineFromCompany(company as unknown as Record<string, unknown>);
  const observedAt = new Date().toISOString();
  return {
    snapshot: json({ companyId, aggregateRevision: company.aggregateRevision, baseline, observedAt }),
    observedAt,
    resources: [{ resourceType: 'company', resourceId: companyId, role: 'target' }],
  };
}

function blockedReview(code: string, message: string, details: Record<string, unknown> = {}): ReviewResult {
  return {
    verdict: 'NEEDS_REVIEW',
    executionConformance: 'UNVERIFIABLE',
    sourceAlignment: 'INCOMPLETE',
    findings: [json({ code, message })],
    coverage: json({ complete: false, originalSourceReviewed: false, selectedFieldsReviewed: false, ...details }),
  };
}

async function reviewCapability(prepared: unknown, output: unknown, snapshot: unknown, context: CapabilityContext): Promise<ReviewResult> {
  const artifact = prepared as PreparedCapabilityArtifact;
  const item = artifact?.items?.find((candidate) => candidate.status === 'ELIGIBLE');
  if (!item) return { verdict: 'REVIEW_FAILED', executionConformance: 'UNVERIFIABLE', sourceAlignment: 'INCOMPLETE', findings: ['Prepared BizFile item is unavailable.'], coverage: json({ complete: false }) };
  const plan = planFromItem(item);
  let source: ReturnType<typeof sourceFromItem>;
  try {
    source = sourceFromItem(item);
  } catch {
    return blockedReview('SOURCE_MANIFEST_UNAVAILABLE', 'The prepared BizFile source manifest is unavailable for independent review.');
  }
  const parsedSnapshot = snapshotSchema.safeParse(snapshot);
  const parsedOutput = outputSchema.safeParse(output);
  if (!parsedSnapshot.success || !parsedOutput.success) return blockedReview('EVIDENCE_INCOMPLETE', 'Canonical receipt or read-back evidence is incomplete.', { source: parsedSnapshot.success, receipt: parsedOutput.success });
  if (parsedSnapshot.data.companyId !== parsedOutput.data.companyId) return blockedReview('COMPANY_MISMATCH', 'Canonical receipt and read-back evidence refer to different companies.');
  if (parsedOutput.data.receipt.status !== 'COMMITTED') return blockedReview('NOT_COMMITTED', 'Independent factual review requires a committed canonical outcome.', { status: parsedOutput.data.receipt.status });
  if (plan.selectedChangeIds.length === 0) return blockedReview('NO_SELECTED_CHANGES', 'Independent review has no approved selected changes to verify.');
  if (plan.selectedChangeIds.some((id) => !plan.changes.some((change) => change.id === id))) return blockedReview('SELECTED_CHANGE_UNAVAILABLE', 'The approved selected change set is incomplete.');
  if (parsedSnapshot.data.aggregateRevision <= plan.expectedAggregateRevision) {
    return blockedReview('REVISION_NOT_ADVANCED', 'The read-back aggregate revision did not advance beyond the prepared revision.', {
      expectedGreaterThan: plan.expectedAggregateRevision,
      observed: parsedSnapshot.data.aggregateRevision,
    });
  }

  const receipt = await prisma.bizFileOperationReceipt.findUnique({
    where: { tenantId_operationId: { tenantId: context.actor.tenantId, operationId: parsedOutput.data.receipt.operationId } },
    select: {
      id: true,
      tenantId: true,
      operationId: true,
      status: true,
      companyId: true,
      documentId: true,
      payloadHash: true,
      evidence: {
        where: { kind: 'SOURCE' },
        select: { artifact: true, artifactHash: true, sourceRef: true },
      },
    },
  });
  const sourceEvidence = receipt?.evidence[0];
  const sourceArtifact = recordValue(sourceEvidence?.artifact);
  const sourceRef = recordValue(sourceEvidence?.sourceRef);
  const committedStorageKey = typeof sourceArtifact?.storageKey === 'string' ? sourceArtifact.storageKey : null;
  const committedSourceHash = typeof sourceArtifact?.sourceHash === 'string' ? sourceArtifact.sourceHash : null;
  const committedDocumentId = typeof sourceArtifact?.documentId === 'string' ? sourceArtifact.documentId : null;
  const sourceEvidenceValid = Boolean(
    receipt
      && receipt.id === parsedOutput.data.receipt.receiptId
      && receipt.tenantId === context.actor.tenantId
      && receipt.operationId === parsedOutput.data.receipt.operationId
      && receipt.status === 'COMMITTED'
      && receipt.companyId === parsedOutput.data.companyId
      && receipt.documentId === source.documentId
      && receipt.payloadHash === plan.canonicalHash
      && sourceEvidence
      && sourceArtifact
      && sourceEvidence.artifactHash === hashBizFileValue(sourceArtifact)
      && committedDocumentId === source.documentId
      && sourceRef?.documentId === source.documentId
      && committedStorageKey === source.storageKey
      && /^[a-f0-9]{64}$/.test(committedSourceHash ?? '')
      && committedSourceHash === source.sourceHash,
  );
  if (!sourceEvidenceValid || !committedStorageKey || !committedSourceHash) {
    return blockedReview('SOURCE_EVIDENCE_INVALID', 'The committed receipt does not contain a verifiable original source manifest.');
  }

  let companyAccess: Awaited<ReturnType<typeof evaluateFreshAuthorization>>;
  let sourceAccess: Awaited<ReturnType<typeof evaluateFreshAuthorization>>;
  try {
    companyAccess = await evaluateFreshAuthorization({
      userId: context.actor.userId,
      workspaceId: context.actor.tenantId,
      permission: { resource: 'company', action: 'read' },
      resource: { kind: 'company', id: parsedOutput.data.companyId },
    });
    sourceAccess = await evaluateFreshAuthorization({
      userId: context.actor.userId,
      workspaceId: context.actor.tenantId,
      permission: { resource: 'document', action: 'read' },
      resource: { kind: 'document', id: source.documentId },
    });
  } catch {
    return blockedReview('REVIEW_AUTHORIZATION_UNAVAILABLE', 'Fresh source and company read authorization could not be established.');
  }
  if (!companyAccess.allowed || !sourceAccess.allowed) return blockedReview('REVIEW_AUTHORIZATION_DENIED', 'Fresh source and company read authorization is required before independent review.');
  try {
    await assertAssistantWorkspaceOperational(context.actor.userId, context.actor.tenantId);
  } catch {
    return blockedReview('WORKSPACE_PAUSED', 'Independent review is paused while workspace operations are unavailable.');
  }
  if (process.env.BUSINESS_ASSISTANT_PROVIDER_ENABLED !== 'true') return blockedReview('PROVIDER_DISABLED', 'Independent source extraction is disabled until the workspace provider flag is enabled.');

  const sourceDocument = await prisma.document.findFirst({
    where: { id: source.documentId, tenantId: context.actor.tenantId, deletedAt: null },
    select: { mimeType: true },
  });
  if (!sourceDocument || sourceDocument.mimeType !== source.mimeType) {
    return blockedReview('SOURCE_MANIFEST_MISMATCH', 'The prepared source manifest no longer matches the source document.');
  }
  // STORAGE_FINALIZE may move the current pointer to a deterministic approved
  // key. The receipt-bound source key is retained as the original evidence.
  let sourceBytes = new Uint8Array();
  try {
    sourceBytes = new Uint8Array(await storage.download(committedStorageKey));
  } catch {
    // Pass empty bytes to the deterministic reviewer so it records an
    // explicit SOURCE_BYTES_MISSING state without dispatching a provider.
  }
  const selectedChanges = plan.changes.filter((change) => plan.selectedChangeIds.includes(change.id));
  const report = await assessBizFileIndependentSourceReview({
    beforeProviderDispatch: async () => {
      await assertAssistantWorkspaceOperational(context.actor.userId, context.actor.tenantId);
      const access = await Promise.all([
        evaluateFreshAuthorization({ userId: context.actor.userId, workspaceId: context.actor.tenantId,
          permission: { resource: 'company', action: 'read' }, resource: { kind: 'company', id: parsedOutput.data.companyId } }),
        evaluateFreshAuthorization({ userId: context.actor.userId, workspaceId: context.actor.tenantId,
          permission: { resource: 'document', action: 'read' }, resource: { kind: 'document', id: source.documentId } }),
      ]);
      if (access.some((decision) => !decision.allowed)) throw new Error('REVIEW_AUTHORIZATION_DENIED');
      if (process.env.BUSINESS_ASSISTANT_PROVIDER_ENABLED !== 'true') throw new Error('PROVIDER_DISABLED');
    },
    sourceBytes,
    expectedSourceHash: source.sourceHash ?? null,
    mimeType: source.mimeType,
    selectedChanges,
    persisted: parsedSnapshot.data.baseline as unknown as BizFileBaselineSnapshot,
    commitStatus: parsedOutput.data.receipt.status,
    extractionOptions: {
      tenantId: context.actor.tenantId,
      userId: context.actor.userId,
      companyId: parsedOutput.data.companyId,
      documentId: source.documentId,
    },
  });
  return {
    verdict: report.verdict,
    executionConformance: report.executionConformance,
    sourceAlignment: report.sourceAlignment,
    findings: report.findings.map((finding) => json(finding)),
    coverage: json(report),
  };
}

async function finalizeCapability(output: unknown, context: CapabilityContext): Promise<FinalizeResult> {
  const parsed = outputSchema.safeParse(output);
  if (!parsed.success) return { status: 'FAILED', safeError: { code: 'VALIDATION_FAILED', message: 'Canonical BizFile output is malformed.' } };
  const result = await finalizeBizFileOperationEffects(context.actor.tenantId, parsed.data.receipt.receiptId);
  if (result.effectStatus === 'FAILED') return { status: 'FAILED', safeError: { code: 'INTERNAL_ERROR', message: 'A required BizFile follow-up effect failed permanently.' } };
  if (result.effectStatus !== 'COMPLETE') return { status: 'PENDING' };
  return { status: 'COMPLETE', output: json(parsed.data) };
}

function presentCapability(prepared: unknown): CapabilityPresentation {
  const artifact = prepared as PreparedCapabilityArtifact;
  const items = Array.isArray(artifact?.items) ? artifact.items : [];
  const sections: CapabilityPresentationSection[] = [];
  for (const item of items) {
    try {
      const plan = planFromItem(item);
      sections.push({ id: `${item.itemId}:changes`, title: `${plan.mode} ${plan.reviewedData.entityDetails.name}`, kind: 'CHANGES', value: selectedChangePresentation(item, plan) });
      sections.push({ id: `${item.itemId}:source`, title: 'Source evidence', kind: 'RESOURCES', value: json(item.resources) });
    } catch {
      sections.push({ id: `${item.itemId}:warning`, title: 'Review unavailable', kind: 'WARNINGS', value: 'The prepared BizFile item could not be rendered.' });
    }
  }
  if (artifact?.blockers?.length) sections.push({ id: 'blockers', title: 'Blocked items', kind: 'WARNINGS', value: json(artifact.blockers) });
  return { sections, allowedActions: ['REVISE', 'CONFIRM', 'CANCEL', 'RETRY'] };
}

function splitCapability(input: unknown, _actor: CanonicalActorContext): readonly { itemKey: string; input: unknown; resources?: readonly ResourceRef[] }[] {
  const rawInput = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const { resources: rawResources, ...payload } = rawInput;
  const parsed = importInputSchema.parse(payload);
  const resources = Array.isArray(rawResources) ? rawResources as ResourceRef[] : [];
  const ids = inputDocumentIds(parsed, resources);
  return [...ids].sort().map((documentId) => ({ itemKey: `bizfile:${documentId}`, input: { ...parsed, documentId, documentIds: undefined }, resources: [
    { resourceType: 'document', resourceId: documentId, role: 'source' as const },
    ...(inputTargetCompanyId(parsed, resources) ? [{ resourceType: 'company', resourceId: inputTargetCompanyId(parsed, resources)!, role: 'target' as const }] : []),
  ] }));
}

export const assistantCapabilities = [
  {
    id: 'bizfile.import_and_review',
    version: '1.0',
    contractVersion: '1',
    title: 'Import and review a BizFile',
    description: 'Prepare a source grounded BizFile change plan, review exact selected changes, and apply the approved canonical company update.',
    executionKind: 'CANONICAL_WRITE' as const,
    riskLevel: 'STANDARD_WRITE' as const,
    confirmationPolicy: 'ALWAYS' as const,
    reviewPolicy: 'REQUIRED' as const,
    approvalPolicyVersion: '1',
    requiredPermissions: ['document:read', 'company:read', 'company:create', 'company:update'],
    inputSchema: importInputSchema,
    itemInputSchema,
    preparedSchema,
    outputSchema,
    revisionSchema,
    snapshotSchema,
    effects: [
      { effectKind: 'STORAGE_FINALIZE', target: 'document', required: true, description: 'Finalize the source document pointer using a verified artifact.' },
      { effectKind: 'PAGE_PREPARATION', target: 'document', required: true, description: 'Prepare source document pages after commit.' },
    ],
    splitInput: splitCapability,
    prepare: prepareCapability,
    present: presentCapability,
    execute: executeCapability,
    revise: reviseCapability,
    reconcile: reconcileCapability,
    readBack: readBackCapability,
    review: reviewCapability,
    finalize: finalizeCapability,
    prepareCorrection: prepareBizFileCorrection,
  },
] satisfies readonly BusinessAssistantCapability[];
