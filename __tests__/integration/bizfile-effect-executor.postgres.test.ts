// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { randomUUID, createHash } from 'node:crypto';

import { prisma } from '@/lib/prisma';
import { hashBizFileValue } from '@/services/bizfile/change-plan';
import {
  claimBizFileOperationEffect,
  drainBizFileOperationEffects,
  executeBizFileOperationEffect,
} from '@/services/bizfile/application/effect-executor';

const connectionString = process.env.BUSINESS_ASSISTANT_TEST_DATABASE_URL;
const databaseUrl = process.env.DATABASE_URL;
const suite = connectionString && databaseUrl === connectionString ? describe : describe.skip;

if (connectionString && databaseUrl !== connectionString) {
  throw new Error('BizFile effect integration requires DATABASE_URL and BUSINESS_ASSISTANT_TEST_DATABASE_URL to be preconfigured to the same isolated PostgreSQL database.');
}

suite('BizFile required effects on disposable PostgreSQL', () => {
  let tenantId: string;
  let userId: string;
  let companyId: string;
  let documentId: string;
  let receiptId: string;
  let processingDocumentId: string;
  let sourceKey: string;
  let sourceBytes: Buffer;
  let objects: Map<string, Buffer>;

  beforeAll(async () => {
    const url = new URL(connectionString!);
    if (url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' || url.port !== '55439'
      || url.pathname !== '/business_assistant_test' || url.username !== 'assistant_test') {
      throw new Error('BizFile effect integration requires the isolated PostgreSQL 16 database on port 55439.');
    }
    await prisma.$queryRaw`SELECT 1`;
  }, 15_000);

  beforeEach(async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
    tenantId = randomUUID();
    userId = randomUUID();
    companyId = randomUUID();
    documentId = randomUUID();
    receiptId = randomUUID();
    sourceKey = `${tenantId}/pending/${documentId}.pdf`;
    const pdf = await PDFDocument.create();
    pdf.addPage([612, 792]);
    sourceBytes = Buffer.from(await pdf.save());
    objects = new Map([[sourceKey, Buffer.from(sourceBytes)]]);

    await prisma.workspace.create({ data: { id: tenantId, name: `BizFile effects ${suffix}`, slug: `bizfile-effects-${suffix}`, status: 'ACTIVE' } });
    await prisma.user.create({ data: { id: userId, tenantId, email: `bizfile-effects-${suffix}@example.test`, passwordHash: 'test-only', firstName: 'Effect', lastName: 'Tester', isActive: true } });
    await prisma.company.create({ data: { id: companyId, tenantId, uen: `20${suffix.slice(0, 8)}A`, name: 'Effect Test Pte Ltd' } });
    await prisma.document.create({
      data: {
        id: documentId,
        tenantId,
        companyId,
        uploadedById: userId,
        documentType: 'BIZFILE',
        fileName: 'bizfile.pdf',
        originalFileName: 'bizfile.pdf',
        storageKey: sourceKey,
        fileSize: sourceBytes.length,
        mimeType: 'application/pdf',
        extractionStatus: 'PENDING',
        isLatest: true,
      },
    });
    // This is the same source mutation performed by document approval. The
    // source guard advances the revision, which the committed effect payload
    // must carry forward before storage finalization advances it again.
    await prisma.document.update({ where: { id: documentId }, data: { extractionStatus: 'COMPLETED', extractedData: { reviewed: true } } });
    const committed = await prisma.document.findUniqueOrThrow({ where: { id: documentId }, select: { sourceRevision: true } });
    expect(committed.sourceRevision).toBe(1);

    const processing = await prisma.processingDocument.create({ data: { documentId, tenantId, isContainer: true, pipelineStatus: 'UPLOADED', processingPriority: 'NORMAL', uploadSource: 'WEB' }, select: { id: true } });
    processingDocumentId = processing.id;
    await prisma.bizFileOperationReceipt.create({ data: {
      id: receiptId,
      tenantId,
      operationId: `effect-operation-${suffix}`,
      capabilityId: 'bizfile.import_and_review',
      capabilityVersion: '1.0',
      schemaVersion: '1',
      mode: 'CREATE',
      companyId,
      documentId,
      payloadHash: 'a'.repeat(64),
      expectedAggregateRevision: 0,
      status: 'COMMITTED',
      effectStatus: 'PENDING',
    } });
    const sourceHash = createHash('sha256').update(sourceBytes).digest('hex');
    await prisma.bizFileOperationEvidence.create({ data: {
      tenantId,
      receiptId,
      kind: 'SOURCE',
      artifact: { documentId, storageKey: sourceKey, sourceRevision: committed.sourceRevision, sourceHash, mimeType: 'application/pdf' },
      artifactHash: hashBizFileValue({ documentId, storageKey: sourceKey, sourceRevision: committed.sourceRevision, sourceHash, mimeType: 'application/pdf' }),
      sourceRef: { documentId, sourceRevision: committed.sourceRevision },
    } });
    const storagePayload = { documentId, storageKey: sourceKey, sourceHash, sourceRevision: committed.sourceRevision };
    const pagePayload = { documentId, storageKey: sourceKey, mimeType: 'application/pdf', sourceHash, sourceRevision: committed.sourceRevision, finalizedSourceRevision: committed.sourceRevision + 1 };
    await prisma.bizFileOperationEffectIntent.createMany({ data: [
      { tenantId, receiptId, effectKind: 'STORAGE_FINALIZE', target: `document:${documentId}`, payload: storagePayload, payloadHash: hashBizFileValue(storagePayload), state: 'PENDING' },
      { tenantId, receiptId, effectKind: 'PAGE_PREPARATION', target: `document:${documentId}`, payload: pagePayload, payloadHash: hashBizFileValue(pagePayload), state: 'PENDING' },
    ] });
  });

  afterEach(async () => {
    if (!tenantId) return;
    await prisma.bizFileOperationEffectIntent.deleteMany({ where: { tenantId } });
    await prisma.bizFileOperationEvidence.deleteMany({ where: { tenantId } });
    await prisma.bizFileOperationReceipt.deleteMany({ where: { tenantId } });
    await prisma.documentPage.deleteMany({ where: { processingDocumentId } });
    await prisma.processingDocument.deleteMany({ where: { tenantId } });
    await prisma.document.deleteMany({ where: { tenantId } });
    await prisma.company.deleteMany({ where: { tenantId } });
    await prisma.user.deleteMany({ where: { tenantId } });
    await prisma.workspace.deleteMany({ where: { id: tenantId } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('claims, verifies, finalizes, and prepares both effects against the real schema', async () => {
    const sourceHash = createHash('sha256').update(sourceBytes).digest('hex');
    const destinationKey = `${tenantId}/companies/${companyId}/documents/${documentId}/original-${sourceHash}.pdf`;
    const storage = {
      download: async (key: string) => {
        const bytes = objects.get(key);
        if (!bytes) throw new Error(`missing object ${key}`);
        return Buffer.from(bytes);
      },
      exists: async (key: string) => objects.has(key),
      copy: async (from: string, to: string) => {
        const bytes = objects.get(from);
        if (!bytes) throw new Error(`missing object ${from}`);
        objects.set(to, Buffer.from(bytes));
      },
    };

    const drained = await drainBizFileOperationEffects({ db: prisma, storage, receiptId, batchSize: 2 });

    expect(drained).toMatchObject({ claimed: 2, completed: 2, failed: 0, errors: 0 });
    await expect(prisma.bizFileOperationReceipt.findUniqueOrThrow({ where: { tenantId_id: { tenantId, id: receiptId } }, select: { effectStatus: true } })).resolves.toEqual({ effectStatus: 'COMPLETE' });
    await expect(prisma.bizFileOperationEffectIntent.count({ where: { tenantId, receiptId, state: 'COMPLETE' } })).resolves.toBe(2);
    await expect(prisma.document.findUniqueOrThrow({ where: { id: documentId }, select: { storageKey: true, sourceRevision: true } })).resolves.toEqual({ storageKey: destinationKey, sourceRevision: 2 });
    await expect(prisma.processingDocument.findUniqueOrThrow({ where: { id: processingDocumentId }, select: { pageCount: true } })).resolves.toEqual({ pageCount: 1 });
    await expect(prisma.documentPage.findFirstOrThrow({ where: { processingDocumentId, pageNumber: 1 }, select: { widthPx: true, heightPx: true, storageKey: true } })).resolves.toEqual({ widthPx: 612, heightPx: 792, storageKey: sourceKey });
    expect(objects.get(sourceKey)).toEqual(sourceBytes);
    expect(objects.get(destinationKey)).toEqual(sourceBytes);
  });

  it('reclaims an expired effect lease and fences the stale worker', async () => {
    const sourceHash = createHash('sha256').update(sourceBytes).digest('hex');
    const destinationKey = `${tenantId}/companies/${companyId}/documents/${documentId}/original-${sourceHash}.pdf`;
    const storage = {
      download: async (key: string) => {
        const bytes = objects.get(key);
        if (!bytes) throw new Error(`missing object ${key}`);
        return Buffer.from(bytes);
      },
      exists: async (key: string) => objects.has(key),
      copy: async (from: string, to: string) => {
        const bytes = objects.get(from);
        if (!bytes) throw new Error(`missing object ${from}`);
        objects.set(to, Buffer.from(bytes));
      },
    };

    // Keep the page effect out of this claim so the test deterministically
    // exercises storage lease fencing regardless of UUID ordering.
    await prisma.bizFileOperationEffectIntent.updateMany({
      where: { tenantId, receiptId, effectKind: 'PAGE_PREPARATION' },
      data: { nextAttemptAt: new Date(Date.now() + 3_600_000) },
    });
    const first = await claimBizFileOperationEffect({ db: prisma, receiptId, leaseMs: 60_000 });
    expect(first).toMatchObject({ effectKind: 'STORAGE_FINALIZE', receiptId });
    await prisma.bizFileOperationEffectIntent.update({
      where: { id: first!.id },
      data: { leaseExpiresAt: new Date(Date.now() - 1_000) },
    });

    const replacement = await claimBizFileOperationEffect({ db: prisma, receiptId, leaseMs: 60_000 });
    expect(replacement?.id).toBe(first?.id);
    expect(replacement?.claimGeneration).toBeGreaterThan(first?.claimGeneration ?? 0);

    await expect(executeBizFileOperationEffect(first!, { db: prisma, storage })).resolves.toMatchObject({ status: 'STALE_WORKER' });
    await expect(executeBizFileOperationEffect(replacement!, { db: prisma, storage })).resolves.toMatchObject({ status: 'COMPLETE', destinationKey });
    await expect(prisma.bizFileOperationEffectIntent.findUniqueOrThrow({ where: { id: first!.id }, select: { state: true, attemptCount: true, claimToken: true } })).resolves.toEqual({ state: 'COMPLETE', attemptCount: 2, claimToken: null });
    await expect(prisma.document.findUniqueOrThrow({ where: { id: documentId }, select: { storageKey: true, sourceRevision: true } })).resolves.toEqual({ storageKey: destinationKey, sourceRevision: 2 });
  });

  it('skips a paused workspace while draining another workspace in the same batch', async () => {
    const extraTenantId = randomUUID();
    const extraUserId = randomUUID();
    const extraCompanyId = randomUUID();
    const extraDocumentId = randomUUID();
    const extraReceiptId = randomUUID();
    const extraSourceKey = `${extraTenantId}/pending/${extraDocumentId}.pdf`;
    const extraSourceHash = createHash('sha256').update(sourceBytes).digest('hex');
    const extraDestinationKey = `${extraTenantId}/companies/${extraCompanyId}/documents/${extraDocumentId}/original-${extraSourceHash}.pdf`;
    objects.set(extraSourceKey, Buffer.from(sourceBytes));

    try {
      await prisma.workspace.create({ data: { id: extraTenantId, name: `BizFile effects peer ${extraTenantId.slice(0, 8)}`, slug: `bizfile-effects-peer-${extraTenantId.slice(0, 16)}`, status: 'ACTIVE' } });
      await prisma.user.create({ data: { id: extraUserId, tenantId: extraTenantId, email: `bizfile-effects-peer-${extraTenantId.slice(0, 16)}@example.test`, passwordHash: 'test-only', firstName: 'Peer', lastName: 'Tester', isActive: true } });
      await prisma.company.create({ data: { id: extraCompanyId, tenantId: extraTenantId, uen: `20${extraTenantId.replaceAll('-', '').slice(0, 8)}A`, name: 'Peer Effect Test Pte Ltd' } });
      await prisma.document.create({
        data: {
          id: extraDocumentId,
          tenantId: extraTenantId,
          companyId: extraCompanyId,
          uploadedById: extraUserId,
          documentType: 'BIZFILE',
          fileName: 'peer-bizfile.pdf',
          originalFileName: 'peer-bizfile.pdf',
          storageKey: extraSourceKey,
          fileSize: sourceBytes.length,
          mimeType: 'application/pdf',
          extractionStatus: 'PENDING',
          isLatest: true,
        },
      });
      await prisma.document.update({ where: { id: extraDocumentId }, data: { extractionStatus: 'COMPLETED', extractedData: { reviewed: true } } });
      const extraCommitted = await prisma.document.findUniqueOrThrow({ where: { id: extraDocumentId }, select: { sourceRevision: true } });
      expect(extraCommitted.sourceRevision).toBe(1);
      await prisma.workspaceBackup.create({ data: { tenantId, status: 'RESTORING', storageKey: `${tenantId}/restore.tar` } });
      await prisma.bizFileOperationReceipt.create({ data: {
        id: extraReceiptId,
        tenantId: extraTenantId,
        operationId: `effect-peer-${extraTenantId}`,
        capabilityId: 'bizfile.import_and_review',
        capabilityVersion: '1.0',
        schemaVersion: '1',
        mode: 'CREATE',
        companyId: extraCompanyId,
        documentId: extraDocumentId,
        payloadHash: 'b'.repeat(64),
        expectedAggregateRevision: 0,
        status: 'COMMITTED',
        effectStatus: 'PENDING',
      } });
      await prisma.bizFileOperationEvidence.create({ data: {
        tenantId: extraTenantId,
        receiptId: extraReceiptId,
        kind: 'SOURCE',
        artifact: { documentId: extraDocumentId, storageKey: extraSourceKey, sourceRevision: extraCommitted.sourceRevision, sourceHash: extraSourceHash, mimeType: 'application/pdf' },
        artifactHash: hashBizFileValue({ documentId: extraDocumentId, storageKey: extraSourceKey, sourceRevision: extraCommitted.sourceRevision, sourceHash: extraSourceHash, mimeType: 'application/pdf' }),
        sourceRef: { documentId: extraDocumentId, sourceRevision: extraCommitted.sourceRevision },
      } });
      const extraPayload = { documentId: extraDocumentId, storageKey: extraSourceKey, sourceHash: extraSourceHash, sourceRevision: extraCommitted.sourceRevision };
      await prisma.bizFileOperationEffectIntent.create({ data: {
        tenantId: extraTenantId,
        receiptId: extraReceiptId,
        effectKind: 'STORAGE_FINALIZE',
        target: `document:${extraDocumentId}`,
        payload: extraPayload,
        payloadHash: hashBizFileValue(extraPayload),
        state: 'PENDING',
      } });

      const storage = {
        download: async (key: string) => {
          const bytes = objects.get(key);
          if (!bytes) throw new Error(`missing object ${key}`);
          return Buffer.from(bytes);
        },
        exists: async (key: string) => objects.has(key),
        copy: async (from: string, to: string) => {
          const bytes = objects.get(from);
          if (!bytes) throw new Error(`missing object ${from}`);
          objects.set(to, Buffer.from(bytes));
        },
      };
      await expect(drainBizFileOperationEffects({ db: prisma, storage, batchSize: 1 })).resolves.toMatchObject({ claimed: 1, completed: 1, failed: 0, errors: 0 });
      await expect(prisma.bizFileOperationEffectIntent.findFirstOrThrow({ where: { tenantId: extraTenantId, receiptId: extraReceiptId }, select: { state: true } })).resolves.toEqual({ state: 'COMPLETE' });
      await expect(prisma.bizFileOperationEffectIntent.count({ where: { tenantId, state: 'PENDING' } })).resolves.toBe(2);
      await expect(prisma.document.findUniqueOrThrow({ where: { id: extraDocumentId }, select: { storageKey: true, sourceRevision: true } })).resolves.toEqual({ storageKey: extraDestinationKey, sourceRevision: 2 });
      expect(objects.get(extraSourceKey)).toEqual(sourceBytes);
      expect(objects.get(extraDestinationKey)).toEqual(sourceBytes);
    } finally {
      await prisma.bizFileOperationEffectIntent.deleteMany({ where: { tenantId: extraTenantId } });
      await prisma.bizFileOperationEvidence.deleteMany({ where: { tenantId: extraTenantId } });
      await prisma.bizFileOperationReceipt.deleteMany({ where: { tenantId: extraTenantId } });
      await prisma.document.deleteMany({ where: { tenantId: extraTenantId } });
      await prisma.company.deleteMany({ where: { tenantId: extraTenantId } });
      await prisma.user.deleteMany({ where: { tenantId: extraTenantId } });
      await prisma.workspace.deleteMany({ where: { id: extraTenantId } });
      objects.delete(extraSourceKey);
      objects.delete(extraDestinationKey);
    }
  });
});
