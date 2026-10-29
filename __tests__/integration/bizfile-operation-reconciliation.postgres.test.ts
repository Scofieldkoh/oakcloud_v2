// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import {
  acquireBizFileOperationLock,
  reconcileBizFileOperation,
} from '@/services/bizfile/application/operation-reconciliation';

const connectionString = process.env.BUSINESS_ASSISTANT_TEST_DATABASE_URL;
const suite = connectionString ? describe : describe.skip;

suite('BizFile operation reconciliation on PostgreSQL', () => {
  let tenantId: string;
  let userId: string;
  let conversationId: string;
  let runId: string;
  let runItemId: string;
  const operationId = randomUUID();
  const claimToken = randomUUID();

  beforeAll(async () => {
    const url = new URL(connectionString!);
    if (url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' || url.port !== '55439' || url.pathname !== '/business_assistant_test' || url.username !== 'assistant_test') {
      throw new Error('BizFile reconciliation integration tests require the dedicated PostgreSQL database on 127.0.0.1:55439.');
    }
    process.env.DATABASE_URL = connectionString;
    await prisma.$queryRaw`SELECT 1`;

    tenantId = randomUUID();
    userId = randomUUID();
    conversationId = randomUUID();
    runId = randomUUID();
    runItemId = randomUUID();
    await prisma.workspace.create({ data: { id: tenantId, name: 'BizFile Reconciliation Test', slug: `bizfile-reconciliation-${tenantId}`, status: 'ACTIVE' } });
    await prisma.user.create({ data: { id: userId, tenantId, email: `bizfile-reconciliation-${tenantId}@example.test`, passwordHash: 'test-only', firstName: 'Reconciliation', lastName: 'Tester', isActive: true } });
    await prisma.businessAssistantConversation.create({ data: { id: conversationId, tenantId, ownerId: userId, title: 'Reconciliation test', status: 'ACTIVE' } });
    await prisma.businessAssistantRun.create({
      data: {
        id: runId,
        tenantId,
        conversationId,
        conversationTenantId: tenantId,
        ownerId: userId,
        capabilityId: 'bizfile.import_and_review',
        capabilityVersion: '1.0',
        contractVersion: '1',
        schemaVersion: '1',
        input: {},
        resources: [],
        status: 'RECOVERING',
      },
    });
    await prisma.businessAssistantRunItem.create({
      data: {
        id: runItemId,
        tenantId,
        runId,
        itemKey: 'reconciliation-test',
        ordinal: 0,
        input: {},
        resources: [],
        lifecycleState: 'RECOVERING',
        executionOutcome: 'OUTCOME_UNKNOWN',
        reviewOutcome: 'NOT_STARTED',
        requiredEffectStatus: 'NOT_REQUIRED',
        operationId,
        claimToken,
        claimGeneration: 1,
        leaseExpiresAt: new Date(Date.now() + 60_000),
        activeStage: 'EXECUTION',
      },
    });
  }, 15_000);

  afterAll(async () => {
    await prisma.bizFileOperationEvidence.deleteMany({ where: { tenantId } });
    await prisma.bizFileOperationEffectIntent.deleteMany({ where: { tenantId } });
    await prisma.bizFileOperationReceipt.deleteMany({ where: { tenantId } });
    await prisma.businessAssistantRunItem.deleteMany({ where: { tenantId } });
    await prisma.businessAssistantRun.deleteMany({ where: { tenantId } });
    await prisma.businessAssistantConversation.deleteMany({ where: { tenantId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.workspace.deleteMany({ where: { id: tenantId } });
    await prisma.$disconnect();
  });

  it('waits for an earlier rollback under the same advisory gate before proving NO_COMMIT', async () => {
    let releaseReady!: () => void;
    const ready = new Promise<void>((resolve) => { releaseReady = resolve; });
    const writer = prisma.$transaction(async (tx) => {
      await acquireBizFileOperationLock(tx as never, tenantId, operationId);
      releaseReady();
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      throw new Error('intentional precommit rollback');
    });
    const writerFailure = writer.catch((error: unknown) => error);
    await ready;

    const reconciled = await reconcileBizFileOperation({
      tenantId,
      operationId,
      claim: { runItemId, claimToken, claimGeneration: 1 },
      maxWaitMs: 1_000,
      pollIntervalMs: 10,
    }, prisma as never);
    await expect(writerFailure).resolves.toMatchObject({ message: 'intentional precommit rollback' });
    expect(reconciled).toEqual({ status: 'NO_COMMIT', receipt: null });
    await expect(prisma.bizFileOperationReceipt.findUnique({ where: { tenantId_operationId: { tenantId, operationId } } })).resolves.toBeNull();
  });

  it('reconciles a durable commit repeatedly to the original operation identity without duplicating the canonical receipt', async () => {
    const committedOperationId = randomUUID();
    const receiptId = randomUUID();
    await prisma.bizFileOperationReceipt.create({ data: {
      id: receiptId,
      tenantId,
      operationId: committedOperationId,
      capabilityId: 'bizfile.import_and_review',
      capabilityVersion: '1.0',
      schemaVersion: '1',
      mode: 'UPDATE',
      payloadHash: 'a'.repeat(64),
      expectedAggregateRevision: 0,
      status: 'COMMITTED',
      effectStatus: 'COMPLETE',
    } });

    const input = { tenantId, operationId: committedOperationId, maxWaitMs: 500, pollIntervalMs: 10 };
    const first = await reconcileBizFileOperation(input, prisma as never);
    const second = await reconcileBizFileOperation(input, prisma as never);

    expect(first.status).toBe('COMMITTED');
    expect(second.status).toBe('COMMITTED');
    if (first.status !== 'COMMITTED' || second.status !== 'COMMITTED' || !first.receipt || !second.receipt) {
      throw new Error('Expected committed reconciliation with durable receipts.');
    }
    expect(first.receipt.operationId).toBe(committedOperationId);
    expect(second.receipt.id).toBe(first.receipt.id);
    await expect(prisma.bizFileOperationReceipt.count({ where: { tenantId, operationId: committedOperationId } })).resolves.toBe(1);
  });
});
