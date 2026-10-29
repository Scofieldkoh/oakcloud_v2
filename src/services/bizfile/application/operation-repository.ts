import { Prisma } from '@/generated/prisma';
import type {
  BizFileOperationEffectStatus,
  BizFileOperationEvidenceKind,
  BizFileOperationMode,
  BizFileOperationStatus,
} from '@/generated/prisma';
import type { PrismaTransactionClient } from '@/services/contact.service';

/**
 * The receipt is the durable idempotency record for one canonical command.
 *
 * `UNKNOWN` is deliberately the only pre-settlement state. A command writes
 * the UNKNOWN row and its domain mutation in one interactive transaction, then
 * settles the row before the transaction commits. A committed UNKNOWN row is
 * therefore a recovery signal, never permission to replay a write.
 */
export type BizFileOperationReceiptState = BizFileOperationStatus;

export interface BizFileOperationReceiptInput {
  tenantId: string;
  operationId: string;
  capabilityId: string;
  capabilityVersion: string;
  schemaVersion: string;
  documentId?: string | null;
  companyId?: string | null;
  mode: BizFileOperationMode;
  payloadHash: string;
  expectedAggregateRevision: number;
}

export interface BizFileOperationReceipt {
  id: string;
  tenantId: string;
  operationId: string;
  status: BizFileOperationReceiptState;
  mode: BizFileOperationMode;
  companyId: string | null;
  documentId: string | null;
  expectedAggregateRevision: number;
  beforeRevision: number | null;
  afterRevision: number | null;
  effectStatus: BizFileOperationEffectStatus;
  /** In-memory marker; never persisted as a schema column. */
  fresh: boolean;
}

export interface BizFileOperationCommitInput {
  receiptId: string;
  tenantId: string;
  status: Extract<BizFileOperationStatus, 'COMMITTED' | 'NO_COMMIT'>;
  companyId?: string | null;
  beforeRevision?: number | null;
  afterRevision?: number | null;
  effectStatus?: BizFileOperationEffectStatus;
}

export interface BizFileOperationEvidenceInput {
  receiptId: string;
  tenantId: string;
  kind: BizFileOperationEvidenceKind;
  artifact: unknown;
  artifactHash: string;
  sourceRef?: unknown;
}

export interface BizFileOperationEffectInput {
  receiptId: string;
  tenantId: string;
  effectKind: string;
  target: string;
  payload?: unknown;
  payloadHash?: string | null;
}

export interface BizFileOperationRepository {
  begin(
    tx: PrismaTransactionClient,
    input: BizFileOperationReceiptInput,
  ): Promise<BizFileOperationReceipt>;
  commit(tx: PrismaTransactionClient, input: BizFileOperationCommitInput): Promise<void>;
  evidence(tx: PrismaTransactionClient, input: BizFileOperationEvidenceInput): Promise<void>;
  effect(tx: PrismaTransactionClient, input: BizFileOperationEffectInput): Promise<void>;
}

const jsonValue = (value: unknown): Prisma.InputJsonValue =>
  value as Prisma.InputJsonValue;

function mapReceipt(row: {
  id: string;
  tenantId: string;
  operationId: string;
  status: BizFileOperationStatus;
  mode: BizFileOperationMode;
  companyId: string | null;
  documentId: string | null;
  expectedAggregateRevision: number;
  beforeRevision: number | null;
  afterRevision: number | null;
  effectStatus: BizFileOperationEffectStatus;
}, fresh: boolean): BizFileOperationReceipt {
  return {
    id: row.id,
    tenantId: row.tenantId,
    operationId: row.operationId,
    status: row.status,
    mode: row.mode,
    companyId: row.companyId,
    documentId: row.documentId,
    expectedAggregateRevision: row.expectedAggregateRevision,
    beforeRevision: row.beforeRevision,
    afterRevision: row.afterRevision,
    effectStatus: row.effectStatus,
    fresh,
  };
}

/**
 * Schema-authoritative Prisma repository. There is intentionally no optional
 * delegate or no-op fallback: a canonical command must fail closed if its
 * recovery tables are unavailable.
 */
export function createBizFileOperationRepository(): BizFileOperationRepository {
  return {
    async begin(tx, input) {
      const existing = await tx.bizFileOperationReceipt.findUnique({
        where: {
          tenantId_operationId: {
            tenantId: input.tenantId,
            operationId: input.operationId,
          },
        },
        select: {
          id: true,
          tenantId: true,
          operationId: true,
          status: true,
          mode: true,
          companyId: true,
          documentId: true,
          expectedAggregateRevision: true,
          beforeRevision: true,
          afterRevision: true,
          effectStatus: true,
          payloadHash: true,
        },
      });

      if (existing) {
        if (existing.payloadHash !== input.payloadHash) {
          throw new Error('Operation ID was already used with a different BizFile payload');
        }
        if (existing.mode !== input.mode) {
          throw new Error('Operation ID was already used with a different BizFile mode');
        }
        return mapReceipt(existing, false);
      }

      const created = await tx.bizFileOperationReceipt.create({
        data: {
          tenantId: input.tenantId,
          operationId: input.operationId,
          capabilityId: input.capabilityId,
          capabilityVersion: input.capabilityVersion,
          schemaVersion: input.schemaVersion,
          documentId: input.documentId ?? null,
          companyId: input.companyId ?? null,
          mode: input.mode,
          payloadHash: input.payloadHash,
          expectedAggregateRevision: input.expectedAggregateRevision,
          status: 'UNKNOWN',
          effectStatus: 'NOT_REQUIRED',
        },
        select: {
          id: true,
          tenantId: true,
          operationId: true,
          status: true,
          mode: true,
          companyId: true,
          documentId: true,
          expectedAggregateRevision: true,
          beforeRevision: true,
          afterRevision: true,
          effectStatus: true,
          payloadHash: true,
        },
      });

      return mapReceipt(created, true);
    },

    async commit(tx, input) {
      await tx.bizFileOperationReceipt.update({
        where: {
          tenantId_id: {
            tenantId: input.tenantId,
            id: input.receiptId,
          },
        },
        data: {
          status: input.status,
          companyId: input.companyId ?? null,
          beforeRevision: input.beforeRevision ?? null,
          afterRevision: input.afterRevision ?? null,
          effectStatus: input.effectStatus ?? 'NOT_REQUIRED',
          committedAt: new Date(),
        },
      });
    },

    async evidence(tx, input) {
      await tx.bizFileOperationEvidence.create({
        data: {
          tenantId: input.tenantId,
          receiptId: input.receiptId,
          kind: input.kind,
          artifact: jsonValue(input.artifact),
          artifactHash: input.artifactHash,
          sourceRef: input.sourceRef === undefined ? undefined : jsonValue(input.sourceRef),
        },
      });
    },

    async effect(tx, input) {
      const unique = {
        tenantId_receiptId_effectKind_target: {
          tenantId: input.tenantId,
          receiptId: input.receiptId,
          effectKind: input.effectKind,
          target: input.target,
        },
      };
      const existing = await tx.bizFileOperationEffectIntent.findUnique({
        where: unique,
        select: { payloadHash: true, state: true },
      });
      if (existing) {
        if (existing.payloadHash !== (input.payloadHash ?? null)) {
          throw new Error('BizFile effect target was already assigned a different payload');
        }
        return;
      }

      let createdAt: Date | undefined;
      if (input.effectKind === 'PAGE_PREPARATION') {
        const predecessor = await tx.bizFileOperationEffectIntent.findFirst({
          where: {
            tenantId: input.tenantId,
            receiptId: input.receiptId,
            effectKind: 'STORAGE_FINALIZE',
            target: input.target,
          },
          select: { createdAt: true },
        });
        if (!predecessor) {
          throw new Error('BizFile PAGE_PREPARATION requires a durable STORAGE_FINALIZE predecessor');
        }
        // PostgreSQL `now()` is transaction-stable. Required effects inserted
        // in one canonical transaction can otherwise tie on created_at and be
        // claimed by random UUID order. Give the dependent effect a strictly
        // later durable timestamp while preserving normal receipt fairness.
        createdAt = new Date(predecessor.createdAt.getTime() + 1);
      }

      await tx.bizFileOperationEffectIntent.create({
        data: {
          tenantId: input.tenantId,
          receiptId: input.receiptId,
          effectKind: input.effectKind,
          target: input.target,
          payload: input.payload === undefined ? undefined : jsonValue(input.payload),
          payloadHash: input.payloadHash ?? null,
          state: 'PENDING',
          ...(createdAt ? { createdAt } : {}),
        },
      });

      await tx.bizFileOperationReceipt.update({
        where: {
          tenantId_id: {
            tenantId: input.tenantId,
            id: input.receiptId,
          },
        },
        data: { effectStatus: 'PENDING' },
      });
    },
  };
}