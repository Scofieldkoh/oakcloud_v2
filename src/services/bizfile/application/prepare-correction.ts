import { createHash } from 'node:crypto';

import type { PrismaClient } from '@/generated/prisma';
import { evaluateFreshAuthorization, type FreshAuthorizationTransactionClient } from '@/lib/fresh-authorization';
import { BIZFILE_CORRECTION_FINDING_CODES, BIZFILE_CORRECTION_SOURCE_PATHS } from '@/lib/bizfile-correction-contract';
import { storage } from '@/lib/storage';
import { StorageKeys } from '@/lib/storage/config';
import { getFileExtension } from '@/lib/storage/filename';
import { bizFileReviewSchema, normalizeBizFileReviewDraft } from '@/lib/validations/bizfile-review';
import {
  CapabilityCorrectionError,
  type CapabilityCorrectionContext,
  type CapabilityCorrectionPreparation,
  type CanonicalActorContext,
  sha256,
} from '@/services/business-assistant/contracts';
import { withCorrectionPrefetch, type CapabilityCorrectionPrefetchContext } from '@/services/business-assistant/correction-prefetch';
import { assertBizFileChangePlan, assertSafeBizFileNumbers, buildBizFileChangePlan, hashBizFileValue, type BizFileBaselineSnapshot, type BizFileChange, type BizFileChangePlan } from '../change-plan';
import { baselineFromCompany } from './prepare-import';

type TransactionClient = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];
type AnyRecord = Record<string, unknown>;

interface BizFileCorrectionPrefetchEvidence {
  kind: 'BIZFILE_CORRECTION_SOURCE_PREFETCH';
  sourceRunId: string;
  reviewId: string;
  sourceItemId: string;
  sourceOperationId: string;
  receiptId: string;
  documentId: string;
  companyId: string;
  retainedSourceHash: string;
  retainedSourceRevision: number;
  currentStorageKey: string;
  currentSourceRevision: number;
  currentVersion: number;
  verifiedStorageKeys: string[];
}

const ALLOWED_FINDING_CODES = new Set<string>(BIZFILE_CORRECTION_FINDING_CODES);

/**
 * These paths have a single scalar or one-to-one target in the canonical
 * writer. Collection rows remain unavailable until they have an
 * identity-aware correction contract.
 */
const SOURCE_PATHS: Readonly<Record<string, string>> = BIZFILE_CORRECTION_SOURCE_PATHS;

const effectManifest = [
  { effectKind: 'STORAGE_FINALIZE', target: 'document', required: true, description: 'Finalize the immutable source document pointer after the canonical operation.' },
  { effectKind: 'PAGE_PREPARATION', target: 'document', required: true, description: 'Prepare document pages from the approved source artifact.' },
] as const;

function json(value: unknown): import('@/services/business-assistant/contracts').JsonValue {
  return JSON.parse(JSON.stringify(value));
}

function asRecord(value: unknown): AnyRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as AnyRecord : null;
}

function hasOwn(value: AnyRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new CapabilityCorrectionError('VALIDATION_FAILED', `The correction evidence is missing ${field}.`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new CapabilityCorrectionError('VALIDATION_FAILED', `The correction evidence contains an invalid ${field}.`);
  }
  return value;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  try {
    return hashBizFileValue(left) === hashBizFileValue(right);
  } catch {
    return false;
  }
}

function setPath(root: AnyRecord, path: string, value: unknown): void {
  const parts = path.split('.');
  let current = root;
  for (const part of parts.slice(0, -1)) {
    const next = current[part];
    if (!next || typeof next !== 'object' || Array.isArray(next)) current[part] = {};
    current = current[part] as AnyRecord;
  }
  current[parts.at(-1)!] = value;
}

function sourceFromPreparedItem(item: AnyRecord): { documentId: string; storageKey: string; mimeType: string; version: number; sourceRevision: number; sourceHash?: string } {
  const source = asRecord(asRecord(item.input)?.source);
  if (!source) throw new CapabilityCorrectionError('PROPOSAL_STALE', 'The source review proposal is unavailable.');
  const documentId = text(source.documentId, 'source document');
  const storageKey = text(source.storageKey, 'source storage key');
  const mimeType = text(source.mimeType, 'source MIME type');
  const version = nonNegativeInteger(source.version, 'source version');
  const sourceRevision = nonNegativeInteger(source.sourceRevision, 'source revision');
  const sourceHash = source.sourceHash === undefined ? undefined : text(source.sourceHash, 'source hash');
  return { documentId, storageKey, mimeType, version, sourceRevision, ...(sourceHash ? { sourceHash } : {}) };
}

function planFromPreparedItem(item: AnyRecord): BizFileChangePlan {
  const plan = asRecord(item.input)?.plan;
  if (!plan) throw new CapabilityCorrectionError('PROPOSAL_STALE', 'The source review change plan is unavailable.');
  try {
    assertBizFileChangePlan(plan as BizFileChangePlan);
  } catch {
    throw new CapabilityCorrectionError('PROPOSAL_STALE', 'The source review change plan is no longer valid.');
  }
  return plan as BizFileChangePlan;
}

function preparedItemFromArtifact(artifact: unknown, itemId: string): AnyRecord | null {
  const record = asRecord(artifact);
  if (!record || !Array.isArray(record.items)) return null;
  return asRecord(record.items.find((candidate) => asRecord(candidate)?.itemId === itemId));
}

function selectedItemIds(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value as string[] : [];
}

function findingRecords(value: unknown): AnyRecord[] {
  if (!Array.isArray(value)) throw new CapabilityCorrectionError('VALIDATION_FAILED', 'The source review has no structured factual findings.');
  const findings = value.map(asRecord);
  if (findings.some((finding) => !finding || typeof finding.id !== 'string' || typeof finding.code !== 'string')) {
    throw new CapabilityCorrectionError('VALIDATION_FAILED', 'The source review findings are malformed.');
  }
  return findings as AnyRecord[];
}

function reviewFinding(findings: readonly AnyRecord[], id: string): AnyRecord {
  const finding = findings.find((candidate) => candidate.id === id);
  if (!finding) throw new CapabilityCorrectionError('NOT_FOUND', 'The requested review finding is unavailable.');
  if (typeof finding.code !== 'string' || !ALLOWED_FINDING_CODES.has(finding.code)
    || typeof finding.path !== 'string' || typeof finding.changeId !== 'string' || !SOURCE_PATHS[finding.path]) {
    throw new CapabilityCorrectionError('VALIDATION_FAILED', 'Only allowlisted factual BizFile findings can create a correction.');
  }
  if (!hasOwn(finding, 'expected') || finding.expected === undefined) {
    throw new CapabilityCorrectionError('VALIDATION_FAILED', 'The selected finding has no validated correction value.');
  }
  return finding;
}

function receiptRef(value: unknown): AnyRecord {
  const record = asRecord(value);
  if (!record || typeof record.receiptType !== 'string' || typeof record.receiptId !== 'string') {
    throw new CapabilityCorrectionError('PROPOSAL_STALE', 'The committed BizFile receipt is unavailable.');
  }
  return record;
}

function committedOutputReceipt(value: unknown): AnyRecord {
  const output = asRecord(value);
  const receipt = asRecord(output?.receipt);
  if (!receipt) throw new CapabilityCorrectionError('PROPOSAL_STALE', 'The committed BizFile receipt is unavailable.');
  return receiptRef(receipt);
}

function sourceEvidence(receipt: AnyRecord): { artifact: AnyRecord; sourceRef: AnyRecord } {
  const source = (Array.isArray(receipt.evidence) ? receipt.evidence : [])
    .find((candidate) => asRecord(candidate)?.kind === 'SOURCE');
  const row = asRecord(source);
  const artifact = asRecord(row?.artifact);
  const sourceRef = asRecord(row?.sourceRef) ?? {};
  const artifactHash = row?.artifactHash;
  if (!artifact || typeof artifactHash !== 'string' || hashBizFileValue(artifact) !== artifactHash) {
    throw new CapabilityCorrectionError('PROPOSAL_STALE', 'The committed receipt has no valid immutable source evidence.');
  }
  return { artifact, sourceRef };
}

function sourceHashFromEvidence(artifact: AnyRecord): string {
  const sourceHash = artifact.sourceHash;
  if (typeof sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(sourceHash)) {
    throw new CapabilityCorrectionError('PROPOSAL_STALE', 'The committed source hash is unavailable.');
  }
  return sourceHash;
}

function sourceRevisionFromEvidence(artifact: AnyRecord, sourceRef: AnyRecord): number {
  return nonNegativeInteger(
    typeof artifact.sourceRevision === 'number' ? artifact.sourceRevision : sourceRef.sourceRevision,
    'committed source revision',
  );
}

function reviewEvidenceBindings(sourceReview: AnyRecord, sourceHash: string, receiptCompanyId: string, receiptAfterRevision: number | null): number {
  const coverage = asRecord(sourceReview.coverage);
  const reportSource = asRecord(coverage?.source);
  const expectedHash = reportSource?.expectedHash;
  const observedHash = reportSource?.observedHash;
  const hashVerified = reportSource?.hashVerified;
  if (typeof expectedHash !== 'string' || typeof observedHash !== 'string'
    || expectedHash !== sourceHash || observedHash !== sourceHash || hashVerified !== true) {
    throw new CapabilityCorrectionError('PROPOSAL_STALE', 'The review source hash is not bound to the committed source evidence.');
  }
  const reportCoverage = asRecord(coverage?.coverage);
  const sourceCoverage = asRecord(reportCoverage?.sourceCoverage);
  if (sourceCoverage && (sourceCoverage.sourceHash !== sourceHash || sourceCoverage.observedSourceHash !== sourceHash || sourceCoverage.hashVerified !== true)) {
    throw new CapabilityCorrectionError('PROPOSAL_STALE', 'The review coverage hash is not bound to the committed source evidence.');
  }
  const evidence = asRecord(sourceReview.evidence);
  const snapshot = asRecord(evidence?.snapshot);
  if (snapshot?.companyId !== receiptCompanyId) {
    throw new CapabilityCorrectionError('PROPOSAL_STALE', 'The review snapshot is bound to a different BizFile target.');
  }
  const aggregateRevision = nonNegativeInteger(snapshot?.aggregateRevision, 'review snapshot aggregate revision');
  if (receiptAfterRevision !== null && aggregateRevision !== receiptAfterRevision) {
    throw new CapabilityCorrectionError('PROPOSAL_STALE', 'The review snapshot no longer matches its committed receipt.');
  }
  return aggregateRevision;
}

function oldChangeForFinding(plan: BizFileChangePlan, finding: AnyRecord): BizFileChange {
  const change = plan.changes.find((candidate) => candidate.id === finding.changeId);
  if (!change || !plan.selectedChangeIds.includes(change.id) || change.path !== finding.path) {
    throw new CapabilityCorrectionError('PROPOSAL_STALE', 'The finding no longer belongs to the selected source proposal.');
  }
  return change;
}

function matchingNewChange(changes: readonly BizFileChange[], oldChange: BizFileChange): BizFileChange | undefined {
  return changes.find((candidate) => candidate.id === oldChange.id)
    ?? changes.find((candidate) => candidate.path === oldChange.path
      && candidate.targetId === oldChange.targetId
      && candidate.sourceRecordId === oldChange.sourceRecordId)
    ?? changes.find((candidate) => candidate.path === oldChange.path
      && !candidate.targetId && !candidate.sourceRecordId && !oldChange.targetId && !oldChange.sourceRecordId);
}

function baselineInput(baseline: BizFileBaselineSnapshot) {
  const aggregateRevision = baseline.aggregateRevision;
  const expectedAggregateRevision = baseline.expectedAggregateRevision;
  if (typeof aggregateRevision !== 'string' || typeof expectedAggregateRevision !== 'number') {
    throw new CapabilityCorrectionError('PROPOSAL_STALE', 'The current BizFile baseline is unavailable.');
  }
  return {
    baseline,
    aggregateRevision,
    expectedAggregateRevision,
    expectedUpdatedAt: baseline.updatedAt,
  };
}

async function requireFreshPermission(
  actor: CanonicalActorContext,
  permission: { resource: 'document' | 'company'; action: 'read' | 'update' },
  id: string,
  tx?: TransactionClient,
): Promise<void> {
  const request = {
    userId: actor.userId,
    workspaceId: actor.tenantId,
    permission,
    resource: { kind: permission.resource, id },
  } as const;
  const decision = tx
    ? await evaluateFreshAuthorization(request, tx as unknown as FreshAuthorizationTransactionClient)
    : await evaluateFreshAuthorization(request);
  if (!decision.allowed) throw new CapabilityCorrectionError('FORBIDDEN', 'Fresh source and target authorization is required for this correction.');
}

function destinationKeyForDocument(document: AnyRecord, tenantId: string, companyId: string, sourceHash: string): string {
  const extension = getFileExtension(text(document.originalFileName ?? document.fileName ?? document.storageKey, 'source file name'));
  const base = StorageKeys.documentOriginal(tenantId, companyId, text(document.id, 'source document'), extension);
  const withoutExtension = extension && base.endsWith(extension) ? base.slice(0, -extension.length) : base;
  return `${withoutExtension}-${sourceHash}${extension}`;
}

function bytesHash(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

async function verifyRetainedSourceBytes(storageKey: string, expectedHash: string): Promise<void> {
  try {
    const bytes = await storage.download(storageKey);
    if (bytesHash(bytes) !== expectedHash) throw new Error('hash mismatch');
  } catch {
    throw new CapabilityCorrectionError('PROPOSAL_STALE', 'The retained BizFile source bytes no longer match committed evidence.');
  }
}

function verifyCurrentSourcePointer(
  document: AnyRecord | null,
  oldSource: ReturnType<typeof sourceFromPreparedItem>,
  tenantId: string,
  companyId: string,
  retainedSourceHash: string,
  retainedSourceRevision: number,
): { document: AnyRecord; storageKeys: string[] } {
  if (!document || document.companyId !== companyId || document.mimeType !== oldSource.mimeType
    || document.version !== oldSource.version || document.deletedAt !== null || document.isLatest !== true) {
    throw new CapabilityCorrectionError('PROPOSAL_STALE', 'The BizFile source has changed since the committed review.');
  }
  const currentRevision = nonNegativeInteger(document.sourceRevision, 'current source revision');
  const currentStorageKey = text(document.storageKey, 'current source storage key');
  const destinationKey = destinationKeyForDocument(document, tenantId, companyId, retainedSourceHash);
  const originalPointer = currentStorageKey === oldSource.storageKey && currentRevision === retainedSourceRevision;
  const finalizedPointer = currentStorageKey === destinationKey && currentRevision === retainedSourceRevision + 1;
  if (!originalPointer && !finalizedPointer) {
    throw new CapabilityCorrectionError('PROPOSAL_STALE', 'The BizFile source pointer changed after this operation was committed.');
  }
  return {
    document,
    storageKeys: finalizedPointer ? [oldSource.storageKey, currentStorageKey] : [oldSource.storageKey],
  };
}

function requestShape(value: unknown): { reviewId: string; corrections: Array<{ findingId: string; value: unknown }> } {
  const record = asRecord(value);
  const corrections = record?.corrections;
  if (typeof record?.reviewId !== 'string' || !Array.isArray(corrections)) {
    throw new CapabilityCorrectionError('VALIDATION_FAILED', 'The BizFile correction request is malformed.');
  }
  return {
    reviewId: record.reviewId,
    corrections: corrections.map((correction) => {
      const row = asRecord(correction);
      if (!row || typeof row.findingId !== 'string' || !hasOwn(row, 'value')) {
        throw new CapabilityCorrectionError('VALIDATION_FAILED', 'The BizFile correction request is malformed.');
      }
      return { findingId: row.findingId, value: row.value };
    }),
  };
}

function validatePrefetchedEvidence(value: unknown, expected: Omit<BizFileCorrectionPrefetchEvidence, 'kind' | 'verifiedStorageKeys'> & { verifiedStorageKeys: readonly string[] }): void {
  const record = asRecord(value);
  const keys = Array.isArray(record?.verifiedStorageKeys) && record.verifiedStorageKeys.every((key) => typeof key === 'string')
    ? record.verifiedStorageKeys as string[]
    : [];
  if (!record || record.kind !== 'BIZFILE_CORRECTION_SOURCE_PREFETCH'
    || record.sourceRunId !== expected.sourceRunId || record.reviewId !== expected.reviewId
    || record.sourceItemId !== expected.sourceItemId || record.sourceOperationId !== expected.sourceOperationId
    || record.receiptId !== expected.receiptId || record.documentId !== expected.documentId || record.companyId !== expected.companyId
    || record.retainedSourceHash !== expected.retainedSourceHash || record.retainedSourceRevision !== expected.retainedSourceRevision
    || record.currentStorageKey !== expected.currentStorageKey || record.currentSourceRevision !== expected.currentSourceRevision
    || record.currentVersion !== expected.currentVersion || keys.length !== expected.verifiedStorageKeys.length
    || keys.some((key, index) => key !== expected.verifiedStorageKeys[index])) {
    throw new CapabilityCorrectionError('PROPOSAL_STALE', 'The prefetched BizFile source evidence no longer matches current transactional state.');
  }
}

/**
 * Perform authorized storage I/O before the serializable correction
 * transaction. The returned metadata is evidence only and is fully rebound to
 * current source identity, revision, pointer and hash by the transaction.
 */
export async function prefetchBizFileCorrection(context: CapabilityCorrectionPrefetchContext): Promise<BizFileCorrectionPrefetchEvidence> {
  const db = context.db as PrismaClient;
  const request = requestShape(context.request);
  const review = await db.businessAssistantReview.findFirst({
    where: { id: request.reviewId, tenantId: context.actor.tenantId },
    select: { id: true, runItemId: true, coverage: true, evidence: true },
  });
  if (!review) throw new CapabilityCorrectionError('NOT_FOUND', 'The source review is unavailable.');
  const item = await db.businessAssistantRunItem.findFirst({
    where: { id: review.runItemId, tenantId: context.actor.tenantId, runId: context.sourceRunId },
    select: {
      id: true, operationId: true, input: true, output: true, receiptRef: true,
      executionOutcome: true, lifecycleState: true, activeStage: true,
      reviews: { orderBy: { attemptNumber: 'desc' }, take: 1, select: { id: true } },
    },
  });
  if (!item || item.reviews[0]?.id !== review.id || item.executionOutcome !== 'COMMITTED' || !item.receiptRef || !item.operationId
    || item.activeStage !== null || !['NEEDS_REVIEW', 'PASSED', 'PASSED_WITH_WARNINGS'].includes(item.lifecycleState)) {
    throw new CapabilityCorrectionError('PROPOSAL_STALE', 'Corrections require the latest review of a committed operation.');
  }

  const sourceItem = item as unknown as AnyRecord;
  const oldPlan = planFromPreparedItem(sourceItem);
  const oldSource = sourceFromPreparedItem(sourceItem);
  if (oldPlan.tenantId !== context.actor.tenantId || oldPlan.documentId !== oldSource.documentId) {
    throw new CapabilityCorrectionError('PROPOSAL_STALE', 'The source plan is bound to another workspace or document.');
  }
  const oldReceiptReference = receiptRef(item.receiptRef);
  const persistedReceipt = committedOutputReceipt(item.output);
  const sourceOperationId = text(item.operationId, 'source operation');
  if (oldReceiptReference.receiptType !== 'BizFileOperationReceipt' || persistedReceipt.receiptType !== 'BizFileOperationReceipt'
    || oldReceiptReference.receiptId !== persistedReceipt.receiptId || oldReceiptReference.operationId !== sourceOperationId
    || persistedReceipt.operationId !== sourceOperationId || oldReceiptReference.status !== 'COMMITTED' || persistedReceipt.status !== 'COMMITTED') {
    throw new CapabilityCorrectionError('PROPOSAL_STALE', 'The committed BizFile receipt identity is invalid.');
  }

  const receiptId = text(oldReceiptReference.receiptId, 'receipt');
  const receipt = await db.bizFileOperationReceipt.findFirst({
    where: { tenantId: context.actor.tenantId, id: receiptId, operationId: sourceOperationId, status: 'COMMITTED' },
    select: {
      id: true, tenantId: true, operationId: true, capabilityId: true, capabilityVersion: true, schemaVersion: true,
      mode: true, companyId: true, documentId: true, payloadHash: true, beforeRevision: true, afterRevision: true, status: true, effectStatus: true,
      evidence: { select: { kind: true, artifact: true, artifactHash: true, sourceRef: true } },
    },
  });
  if (!receipt || !receipt.documentId || !receipt.companyId || receipt.capabilityId !== 'bizfile.import_and_review' || receipt.capabilityVersion !== '1.0'
    || receipt.payloadHash !== oldPlan.canonicalHash || oldReceiptReference.payloadHash !== receipt.payloadHash || persistedReceipt.payloadHash !== receipt.payloadHash
    || receipt.mode !== oldPlan.mode || (oldPlan.mode === 'UPDATE' && oldPlan.targetCompanyId !== receipt.companyId)) {
    throw new CapabilityCorrectionError('PROPOSAL_STALE', 'The committed BizFile receipt does not match its approved plan.');
  }
  const { artifact: receiptSource, sourceRef } = sourceEvidence(receipt as unknown as AnyRecord);
  const retainedSourceHash = sourceHashFromEvidence(receiptSource);
  const retainedSourceRevision = sourceRevisionFromEvidence(receiptSource, sourceRef);
  if (receiptSource.documentId !== oldSource.documentId || receiptSource.storageKey !== oldSource.storageKey || receiptSource.mimeType !== oldSource.mimeType
    || (oldSource.sourceHash && oldSource.sourceHash !== retainedSourceHash) || (oldPlan.sourceHash && oldPlan.sourceHash !== retainedSourceHash)) {
    throw new CapabilityCorrectionError('PROPOSAL_STALE', 'The committed source evidence no longer matches the reviewed proposal.');
  }
  reviewEvidenceBindings(review as unknown as AnyRecord, retainedSourceHash, receipt.companyId, receipt.afterRevision);

  // Both permissions must be fresh before any storage byte is read.
  await requireFreshPermission(context.actor, { resource: 'document', action: 'read' }, oldSource.documentId);
  await requireFreshPermission(context.actor, { resource: 'company', action: 'update' }, receipt.companyId);
  const sourceDocument = await db.document.findFirst({
    where: { id: oldSource.documentId, tenantId: context.actor.tenantId, deletedAt: null },
    select: { id: true, tenantId: true, companyId: true, version: true, sourceRevision: true, storageKey: true, mimeType: true, originalFileName: true, fileName: true, isLatest: true, deletedAt: true },
  });
  const pointer = verifyCurrentSourcePointer(sourceDocument as unknown as AnyRecord | null, oldSource, context.actor.tenantId, receipt.companyId, retainedSourceHash, retainedSourceRevision);
  for (const storageKey of pointer.storageKeys) await verifyRetainedSourceBytes(storageKey, retainedSourceHash);

  return {
    kind: 'BIZFILE_CORRECTION_SOURCE_PREFETCH',
    sourceRunId: context.sourceRunId,
    reviewId: review.id,
    sourceItemId: item.id,
    sourceOperationId,
    receiptId: receipt.id,
    documentId: oldSource.documentId,
    companyId: receipt.companyId,
    retainedSourceHash,
    retainedSourceRevision,
    currentStorageKey: text(pointer.document.storageKey, 'current source storage key'),
    currentSourceRevision: nonNegativeInteger(pointer.document.sourceRevision, 'current source revision'),
    currentVersion: nonNegativeInteger(pointer.document.version, 'current source version'),
    verifiedStorageKeys: pointer.storageKeys,
  };
}

/** Module-owned transactional correction preparation for the BizFile reference capability. */
async function prepareBizFileCorrectionTransactional(context: CapabilityCorrectionContext, prefetched?: unknown): Promise<CapabilityCorrectionPreparation> {
  const tx = context.db as TransactionClient;
  const request = requestShape(context.request);
  const sourceItem = asRecord(context.sourceItem);
  const sourceReview = asRecord(context.sourceReview);
  if (!sourceItem || !sourceReview) throw new CapabilityCorrectionError('PROPOSAL_STALE', 'The source review is unavailable.');

  const proposals = await tx.businessAssistantProposal.findMany({
    where: { tenantId: context.actor.tenantId, runId: context.sourceRunId, status: 'CONFIRMED' },
    orderBy: { revision: 'desc' },
    select: { id: true, revision: true, preparedArtifact: true, preparedHash: true, eligibleItems: true },
  });
  const sourceProposal = proposals.find((candidate) => Boolean(preparedItemFromArtifact(candidate.preparedArtifact, text(sourceItem.id, 'source item'))));
  const sourcePreparedItem = sourceProposal ? preparedItemFromArtifact(sourceProposal.preparedArtifact, text(sourceItem.id, 'source item')) : null;
  if (!sourceProposal || !sourcePreparedItem || sourcePreparedItem.status !== 'ELIGIBLE') throw new CapabilityCorrectionError('PROPOSAL_STALE', 'The source proposal is unavailable.');
  if (sourceProposal.preparedHash !== sha256({ prepared: sourceProposal.preparedArtifact, serializerVersion: '1' })) throw new CapabilityCorrectionError('PROPOSAL_STALE', 'The source proposal hash is invalid.');
  const binding = Array.isArray(sourceProposal.eligibleItems) ? sourceProposal.eligibleItems.find((candidate) => asRecord(candidate)?.itemId === sourceItem.id) : null;
  if (asRecord(binding)?.preparedHash !== sha256(sourcePreparedItem)) throw new CapabilityCorrectionError('PROPOSAL_STALE', 'The source proposal binding is invalid.');

  const approval = await tx.businessAssistantApproval.findFirst({
    where: { tenantId: context.actor.tenantId, runId: context.sourceRunId, proposalId: sourceProposal.id, decision: 'APPROVED' },
    select: { id: true, selectedItems: true, selectedBindings: true },
  });
  if (!approval || !selectedItemIds(approval.selectedItems).includes(text(sourceItem.id, 'source item'))) throw new CapabilityCorrectionError('PROPOSAL_STALE', 'The source operation has no matching approval.');
  const approvedBinding = Array.isArray(approval.selectedBindings) ? approval.selectedBindings.find((candidate) => asRecord(candidate)?.itemId === sourceItem.id) : null;
  if (asRecord(approvedBinding)?.preparedHash !== sha256(sourcePreparedItem)) throw new CapabilityCorrectionError('PROPOSAL_STALE', 'The source approval binding is invalid.');

  const oldPlan = planFromPreparedItem(sourcePreparedItem);
  const oldSource = sourceFromPreparedItem(sourcePreparedItem);
  if (oldPlan.tenantId !== context.actor.tenantId || oldPlan.documentId !== oldSource.documentId) throw new CapabilityCorrectionError('PROPOSAL_STALE', 'The source plan is bound to another workspace or document.');
  const oldReceiptReference = receiptRef(sourceItem.receiptRef);
  const persistedReceipt = committedOutputReceipt(sourceItem.output);
  const sourceOperationId = text(sourceItem.operationId, 'source operation');
  if (oldReceiptReference.receiptType !== 'BizFileOperationReceipt' || persistedReceipt.receiptType !== 'BizFileOperationReceipt'
    || oldReceiptReference.receiptId !== persistedReceipt.receiptId || oldReceiptReference.operationId !== sourceOperationId
    || persistedReceipt.operationId !== sourceOperationId || oldReceiptReference.status !== 'COMMITTED' || persistedReceipt.status !== 'COMMITTED') {
    throw new CapabilityCorrectionError('PROPOSAL_STALE', 'The committed BizFile receipt identity is invalid.');
  }

  const receiptId = text(oldReceiptReference.receiptId, 'receipt');
  const receipt = await tx.bizFileOperationReceipt.findFirst({
    where: { tenantId: context.actor.tenantId, id: receiptId, operationId: sourceOperationId, status: 'COMMITTED' },
    select: {
      id: true, tenantId: true, operationId: true, capabilityId: true, capabilityVersion: true, schemaVersion: true,
      mode: true, companyId: true, documentId: true, payloadHash: true, beforeRevision: true, afterRevision: true, status: true, effectStatus: true,
      evidence: { select: { kind: true, artifact: true, artifactHash: true, sourceRef: true } },
    },
  });
  if (!receipt || !receipt.documentId || !receipt.companyId || receipt.capabilityId !== 'bizfile.import_and_review' || receipt.capabilityVersion !== '1.0'
    || receipt.payloadHash !== oldPlan.canonicalHash || oldReceiptReference.payloadHash !== receipt.payloadHash || persistedReceipt.payloadHash !== receipt.payloadHash
    || receipt.mode !== oldPlan.mode || (oldPlan.mode === 'UPDATE' && oldPlan.targetCompanyId !== receipt.companyId)) {
    throw new CapabilityCorrectionError('PROPOSAL_STALE', 'The committed BizFile receipt does not match its approved plan.');
  }
  const { artifact: receiptSource, sourceRef } = sourceEvidence(receipt as unknown as AnyRecord);
  const retainedSourceHash = sourceHashFromEvidence(receiptSource);
  const retainedSourceRevision = sourceRevisionFromEvidence(receiptSource, sourceRef);
  if (receiptSource.documentId !== oldSource.documentId || receiptSource.storageKey !== oldSource.storageKey || receiptSource.mimeType !== oldSource.mimeType
    || (oldSource.sourceHash && oldSource.sourceHash !== retainedSourceHash) || (oldPlan.sourceHash && oldPlan.sourceHash !== retainedSourceHash)) {
    throw new CapabilityCorrectionError('PROPOSAL_STALE', 'The committed source evidence no longer matches the reviewed proposal.');
  }
  const reviewedAggregateRevision = reviewEvidenceBindings(sourceReview, retainedSourceHash, receipt.companyId, receipt.afterRevision);

  const findings = findingRecords(sourceReview.findings);
  const selectedFindings = request.corrections.map((correction) => reviewFinding(findings, correction.findingId));
  const selectedPaths = new Set<string>();
  const oldChanges: BizFileChange[] = [];
  const correctedDraft = cloneJson(oldPlan.reviewedData) as unknown as AnyRecord;
  for (const [index, correction] of request.corrections.entries()) {
    const finding = selectedFindings[index];
    const path = finding.path as string;
    if (selectedPaths.has(path)) throw new CapabilityCorrectionError('VALIDATION_FAILED', 'Only one correction may target each factual path.');
    selectedPaths.add(path);
    if (!canonicalEqual(correction.value, finding.expected)) throw new CapabilityCorrectionError('VALIDATION_FAILED', 'Correction values must match the immutable review finding.');
    oldChanges.push(oldChangeForFinding(oldPlan, finding));
    setPath(correctedDraft, SOURCE_PATHS[path], correction.value);
  }
  const parsedReviewedData = bizFileReviewSchema.safeParse(correctedDraft);
  if (!parsedReviewedData.success) throw new CapabilityCorrectionError('VALIDATION_FAILED', 'The correction value does not satisfy the BizFile review schema.', parsedReviewedData.error.flatten());
  const correctedData = normalizeBizFileReviewDraft(parsedReviewedData.data);
  assertSafeBizFileNumbers(correctedData);

  await requireFreshPermission(context.actor, { resource: 'document', action: 'read' }, oldSource.documentId, tx);
  const sourceDocument = await tx.document.findFirst({
    where: { id: oldSource.documentId, tenantId: context.actor.tenantId, deletedAt: null },
    select: { id: true, tenantId: true, companyId: true, version: true, sourceRevision: true, storageKey: true, mimeType: true, originalFileName: true, fileName: true, isLatest: true, deletedAt: true },
  });
  await requireFreshPermission(context.actor, { resource: 'company', action: 'update' }, receipt.companyId, tx);
  const pointer = verifyCurrentSourcePointer(sourceDocument as unknown as AnyRecord | null, oldSource, context.actor.tenantId, receipt.companyId, retainedSourceHash, retainedSourceRevision);
  const currentSource = pointer.document;
  validatePrefetchedEvidence(prefetched, {
    sourceRunId: context.sourceRunId,
    reviewId: text(sourceReview.id, 'source review'),
    sourceItemId: text(sourceItem.id, 'source item'),
    sourceOperationId,
    receiptId: receipt.id,
    documentId: oldSource.documentId,
    companyId: receipt.companyId,
    retainedSourceHash,
    retainedSourceRevision,
    currentStorageKey: text(currentSource.storageKey, 'current source storage key'),
    currentSourceRevision: nonNegativeInteger(currentSource.sourceRevision, 'current source revision'),
    currentVersion: nonNegativeInteger(currentSource.version, 'current source version'),
    verifiedStorageKeys: pointer.storageKeys,
  });
  const company = await tx.company.findFirst({
    where: { id: receipt.companyId, tenantId: context.actor.tenantId, deletedAt: null },
    include: {
      addresses: { where: { isCurrent: true } }, formerNames: true, shareCapital: true,
      officers: { where: { isCurrent: true } }, shareholders: { where: { isCurrent: true } }, auditor: true, charges: true,
    },
  });
  if (!company) throw new CapabilityCorrectionError('PROPOSAL_STALE', 'The BizFile target is no longer available.');
  const baseline = baselineFromCompany(company as unknown as AnyRecord);
  if (typeof company.aggregateRevision !== 'number' || company.aggregateRevision !== reviewedAggregateRevision) {
    throw new CapabilityCorrectionError('PROPOSAL_STALE', 'The current BizFile baseline changed after the source review.');
  }
  const expectedAggregateRevision = baselineInput(baseline).expectedAggregateRevision;
  const currentSourceRevision = nonNegativeInteger(currentSource.sourceRevision, 'current source revision');
  const unselectedPlan = buildBizFileChangePlan({
    mode: 'UPDATE', tenantId: context.actor.tenantId, documentId: oldSource.documentId, reviewedData: correctedData,
    targetCompanyId: receipt.companyId, sourceVersion: currentSourceRevision, sourceHash: retainedSourceHash,
    ...baselineInput(baseline), contactDecisions: oldPlan.contactDecisions,
  });
  const matchedIds = oldChanges.map((oldChange) => matchingNewChange(unselectedPlan.changes, oldChange)?.id);
  if (matchedIds.some((id) => typeof id !== 'string') || new Set(matchedIds).size !== matchedIds.length) throw new CapabilityCorrectionError('PROPOSAL_STALE', 'The factual correction no longer produces a canonical change.');
  const newChangeIds = matchedIds as string[];
  const nextPlan = buildBizFileChangePlan({
    mode: 'UPDATE', tenantId: context.actor.tenantId, documentId: oldSource.documentId, reviewedData: correctedData,
    targetCompanyId: receipt.companyId, sourceVersion: currentSourceRevision, sourceHash: retainedSourceHash,
    ...baselineInput(baseline), contactDecisions: oldPlan.contactDecisions, selectedChangeIds: newChangeIds,
  });

  const nextItemKey = `bizfile-correction:${hashBizFileValue({ reviewId: sourceReview.id, findingIds: request.corrections.map((correction) => correction.findingId) }).slice(0, 32)}`;
  const nextSource = {
    documentId: text(currentSource.id, 'source document'), storageKey: text(currentSource.storageKey, 'source storage key'), mimeType: text(currentSource.mimeType, 'source MIME type'),
    version: nonNegativeInteger(currentSource.version, 'source version'), sourceRevision: currentSourceRevision, sourceHash: retainedSourceHash,
  };
  const lineage = {
    correctionOfReviewId: sourceReview.id, sourceRunId: context.sourceRunId, sourceRunItemId: sourceItem.id, sourceProposalId: sourceProposal.id,
    sourceApprovalId: approval.id, sourceReceiptId: receipt.id, sourceOperationId: receipt.operationId,
    findingIds: request.corrections.map((correction) => correction.findingId), sourcePlanHash: oldPlan.canonicalHash,
    sourceReceiptPayloadHash: receipt.payloadHash, baselineAggregateRevision: baseline.aggregateRevision,
  };
  const resources = [
    { resourceType: 'document', resourceId: nextSource.documentId, role: 'source' as const },
    { resourceType: 'company', resourceId: receipt.companyId, role: 'target' as const },
  ];
  const preparedItem = {
    itemId: context.nextItemId,
    itemKey: nextItemKey,
    input: json({ itemId: context.nextItemId, plan: nextPlan, source: nextSource }),
    resources,
    status: 'ELIGIBLE' as const,
    expectedRevisions: { aggregateRevision: expectedAggregateRevision, sourceVersion: nextSource.sourceRevision, ...(baseline.updatedAt ? { updatedAt: baseline.updatedAt } : {}) },
    effectManifest: effectManifest.map((effect) => ({ ...effect, target: `document:${nextSource.documentId}` })),
    metadata: json({ ...lineage, correctionKind: 'CORRECTION_PROPOSAL' }),
  };
  return { status: 'PREPARED', preparedItem, lineage: json(lineage), resources };
}

export const prepareBizFileCorrection = withCorrectionPrefetch(
  prepareBizFileCorrectionTransactional,
  prefetchBizFileCorrection,
);
