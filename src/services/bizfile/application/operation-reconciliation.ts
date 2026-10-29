import type { PrismaTransactionClient } from '@/services/contact.service';
import { prisma } from '@/lib/prisma';

/**
 * The canonical command and reconciliation path use this exact advisory-lock
 * key.  The lock is transaction scoped, so callers must acquire it on the
 * transaction which will read or mutate the receipt.
 */
export function bizFileOperationAdvisoryKey(tenantId: string, operationId: string): string {
  return `oakcloud:bizfile:operation:${tenantId}:${operationId}`;
}

type RawQuery = <T = unknown>(query: string, ...values: unknown[]) => Promise<T>;

function rawQueryClient(tx: PrismaTransactionClient): RawQuery | undefined {
  const raw = tx as unknown as { $queryRawUnsafe?: RawQuery };
  return typeof raw.$queryRawUnsafe === 'function' ? raw.$queryRawUnsafe.bind(tx) : undefined;
}

/** Acquire the blocking form used by the canonical mutation transaction. */
export async function acquireBizFileOperationLock(
  tx: PrismaTransactionClient,
  tenantId: string,
  operationId: string,
): Promise<void> {
  const query = rawQueryClient(tx);
  if (!query) throw new Error('BizFile operation coordination is unavailable');
  await query(
    'SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended($1, 0))) AS operation_lock',
    bizFileOperationAdvisoryKey(tenantId, operationId),
  );
}

export interface BizFileOperationClaimFence {
  runItemId: string;
  claimToken: string;
  claimGeneration: number;
}

export interface BizFileOperationReceiptSnapshot {
  id: string;
  tenantId: string;
  operationId: string;
  status: 'COMMITTED' | 'NO_COMMIT' | 'UNKNOWN';
  mode: 'CREATE' | 'UPDATE';
  companyId: string | null;
  documentId: string | null;
  payloadHash: string;
  expectedAggregateRevision: number;
  beforeRevision: number | null;
  afterRevision: number | null;
  effectStatus: 'NOT_REQUIRED' | 'PENDING' | 'COMPLETE' | 'FAILED';
  evidence: Array<{
    kind: 'BEFORE' | 'AFTER' | 'SOURCE' | 'READBACK';
    artifact: unknown;
    artifactHash: string;
    sourceRef: unknown;
  }>;
  effects: Array<{
    effectKind: string;
    target: string;
    payload: unknown;
    payloadHash: string | null;
    state: 'PENDING' | 'PROCESSING' | 'COMPLETE' | 'FAILED_RETRYABLE' | 'FAILED_PERMANENT';
  }>;
}

export type BizFileOperationReconciliationReason =
  | 'LOCK_TIMEOUT'
  | 'CLAIM_CONTEXT_UNAVAILABLE'
  | 'CLAIM_FENCED'
  | 'RECEIPT_UNRESOLVED'
  | 'DATABASE_UNAVAILABLE';

export interface BizFileOperationReconciliationResult {
  status: 'COMMITTED' | 'NO_COMMIT' | 'UNKNOWN';
  receipt: BizFileOperationReceiptSnapshot | null;
  reason?: BizFileOperationReconciliationReason;
}

export interface ReconcileBizFileOperationInput {
  tenantId: string;
  operationId: string;
  /**
   * A missing receipt can only be declared NO_COMMIT for a current assistant
   * claim.  The claim check fences a delayed worker which had not entered its
   * mutation transaction when reconciliation acquired the operation lock.
   */
  claim?: BizFileOperationClaimFence;
  /** Maximum time spent waiting for an earlier operation transaction. */
  maxWaitMs?: number;
  /** Poll interval for the non-blocking advisory-lock attempt. */
  pollIntervalMs?: number;
  signal?: AbortSignal;
}

interface TransactionRunner {
  $transaction<T>(
    work: (transaction: PrismaTransactionClient) => Promise<T>,
    options?: { maxWait?: number; timeout?: number },
  ): Promise<T>;
}

const DEFAULT_MAX_WAIT_MS = 2_000;
const DEFAULT_POLL_INTERVAL_MS = 25;

function boundedMilliseconds(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(Math.floor(value as number), 30_000));
}

function advisoryLockAcquired(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const locked = (value as { locked?: unknown }).locked;
  // PostgreSQL's native driver returns boolean; a few adapter/test doubles
  // expose the equivalent `t` or 1 representation.
  return locked === true || locked === 't' || locked === 1;
}

async function waitForAdvisoryLock(
  tx: PrismaTransactionClient,
  tenantId: string,
  operationId: string,
  maxWaitMs: number,
  pollIntervalMs: number,
  signal?: AbortSignal,
): Promise<boolean> {
  const query = rawQueryClient(tx);
  if (!query) return false;
  const deadline = Date.now() + maxWaitMs;
  const key = bizFileOperationAdvisoryKey(tenantId, operationId);

  while (true) {
    if (signal?.aborted) return false;
    const rows = await query<Array<{ locked?: unknown }>>(
      'SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS locked',
      key,
    );
    if (Array.isArray(rows) && advisoryLockAcquired(rows[0])) return true;
    if (Date.now() >= deadline) return false;
    const remaining = Math.max(0, deadline - Date.now());
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(pollIntervalMs, remaining)));
  }
}

async function currentClaimMatchesOperation(
  tx: PrismaTransactionClient,
  tenantId: string,
  operationId: string,
  claim: BizFileOperationClaimFence,
): Promise<boolean> {
  const row = await tx.businessAssistantRunItem.findFirst({
    where: {
      id: claim.runItemId,
      tenantId,
      operationId,
      claimToken: claim.claimToken,
      claimGeneration: claim.claimGeneration,
      leaseExpiresAt: { gt: new Date() },
    },
    select: { id: true },
  });
  return row?.id === claim.runItemId;
}

const receiptSelect = {
  id: true,
  tenantId: true,
  operationId: true,
  status: true,
  mode: true,
  companyId: true,
  documentId: true,
  payloadHash: true,
  expectedAggregateRevision: true,
  beforeRevision: true,
  afterRevision: true,
  effectStatus: true,
  evidence: {
    select: {
      kind: true,
      artifact: true,
      artifactHash: true,
      sourceRef: true,
    },
  },
  effects: {
    select: {
      effectKind: true,
      target: true,
      payload: true,
      payloadHash: true,
      state: true,
    },
  },
} as const;

/**
 * Reconcile one canonical operation under the same transaction-scoped gate
 * used by the writer.  A missing receipt is NO_COMMIT only after the gate is
 * acquired and the current worker claim is still valid.  No receipt write is
 * performed here: the current claim check makes a delayed old worker fail at
 * the writer boundary, while a valid retry can reuse the operation identity.
 */
export async function reconcileBizFileOperation(
  input: ReconcileBizFileOperationInput,
  client: TransactionRunner = prisma as unknown as TransactionRunner,
): Promise<BizFileOperationReconciliationResult> {
  const maxWaitMs = boundedMilliseconds(input.maxWaitMs, DEFAULT_MAX_WAIT_MS);
  const pollIntervalMs = Math.max(1, boundedMilliseconds(input.pollIntervalMs, DEFAULT_POLL_INTERVAL_MS));
  try {
    return await client.$transaction(async (rawTx) => {
      const tx = rawTx as PrismaTransactionClient;
      const acquired = await waitForAdvisoryLock(
        tx,
        input.tenantId,
        input.operationId,
        maxWaitMs,
        pollIntervalMs,
        input.signal,
      );
      if (!acquired) {
        return { status: 'UNKNOWN' as const, receipt: null, reason: 'LOCK_TIMEOUT' as const };
      }

      const receipt = await tx.bizFileOperationReceipt.findUnique({
        where: { tenantId_operationId: { tenantId: input.tenantId, operationId: input.operationId } },
        select: receiptSelect,
      });
      if (receipt) {
        if (receipt.status === 'UNKNOWN') {
          return { status: 'UNKNOWN' as const, receipt: receipt as BizFileOperationReceiptSnapshot, reason: 'RECEIPT_UNRESOLVED' as const };
        }
        return { status: receipt.status, receipt: receipt as BizFileOperationReceiptSnapshot };
      }

      if (!input.claim) {
        return { status: 'UNKNOWN' as const, receipt: null, reason: 'CLAIM_CONTEXT_UNAVAILABLE' as const };
      }
      if (!(await currentClaimMatchesOperation(tx, input.tenantId, input.operationId, input.claim))) {
        return { status: 'UNKNOWN' as const, receipt: null, reason: 'CLAIM_FENCED' as const };
      }
      return { status: 'NO_COMMIT' as const, receipt: null };
    }, {
      // Keep connection acquisition and the interactive transaction bounded;
      // a database outage must remain UNKNOWN rather than becoming proof of a
      // rollback.
      maxWait: Math.max(1, maxWaitMs),
      timeout: Math.max(1, maxWaitMs + 500),
    });
  } catch {
    return { status: 'UNKNOWN', receipt: null, reason: 'DATABASE_UNAVAILABLE' };
  }
}
