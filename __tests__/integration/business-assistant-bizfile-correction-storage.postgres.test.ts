// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';

import { prisma } from '@/lib/prisma';
import { LocalStorageAdapter } from '@/lib/storage/local.adapter';
import { hashBizFileValue } from '@/services/bizfile/change-plan';
import { drainBizFileOperationEffects } from '@/services/bizfile/application/effect-executor';
import { createBizFileOperationRepository } from '@/services/bizfile/application/operation-repository';

const connectionString = process.env.BUSINESS_ASSISTANT_TEST_DATABASE_URL;
const databaseUrl = process.env.DATABASE_URL;
const suite = connectionString && databaseUrl === connectionString ? describe : describe.skip;

if (connectionString && databaseUrl !== connectionString) {
  throw new Error('BizFile correction storage integration requires DATABASE_URL and BUSINESS_ASSISTANT_TEST_DATABASE_URL to use the same isolated PostgreSQL database.');
}

suite('Business Assistant BizFile correction retained-source storage E2E', () => {
  let tenantId: string;
  let userId: string;
  let companyId: string;
  let documentId: string;
  let receiptId: string;
  let processingDocumentId: string;
  let sourceRevision: number;
  let sourceKey: string;
  let sourceBytes: Buffer;
  let storageRoot: string;
  let storage: LocalStorageAdapter;

  beforeAll(async () => {
    const url = new URL(connectionString!);
    if (url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' || url.port !== '55439'
      || url.pathname !== '/business_assistant_test' || url.username !== 'assistant_test') {
      throw new Error('BizFile correction storage integration requires the isolated PostgreSQL 16 database on port 55439.');
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
    storageRoot = await mkdtemp(join(tmpdir(), 'oakcloud-ba-correction-storage-'));
    storage = new LocalStorageAdapter(storageRoot);

    const pdf = await PDFDocument.create();
    pdf.addPage([612, 792]);
    sourceBytes = Buffer.from(await pdf.save());
    const sourceHash = createHash('sha256').update(sourceBytes).digest('hex');
    sourceKey = `${tenantId}/companies/${companyId}/documents/${documentId}/original-${sourceHash}.pdf`;
    await storage.upload(sourceKey, sourceBytes, { contentType: 'application/pdf' });

    await prisma.workspace.create({
      data: { id: tenantId, name: `Correction storage ${suffix}`, slug: `correction-storage-${suffix}`, status: 'ACTIVE' },
    });
    await prisma.user.create({
      data: { id: userId, tenantId, email: `correction-storage-${suffix}@example.test`, passwordHash: 'test-only', firstName: 'Correction', lastName: 'Tester', isActive: true },
    });
    await prisma.company.create({
      data: { id: companyId, tenantId, uen: `20${suffix.slice(0, 8)}A`, name: 'Correction Storage Pte Ltd' },
    });
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
    // Model the already-retained source of a prior committed BizFile operation.
    // Approval/extraction is a source transition; storage is already at the
    // deterministic hash-addressed key before the correction is executed.
    await prisma.document.update({
      where: { id: documentId },
      data: { extractionStatus: 'COMPLETED', extractedData: { entityDetails: { name: 'Correction Storage Pte Ltd' } } },
    });
    const sourceDocument = await prisma.document.findUniqueOrThrow({
      where: { id: documentId },
      select: { sourceRevision: true, storageKey: true },
    });
    expect(sourceDocument.storageKey).toBe(sourceKey);
    expect(sourceDocument.sourceRevision).toBeGreaterThan(0);
    sourceRevision = sourceDocument.sourceRevision;

    const processing = await prisma.processingDocument.create({
      data: { documentId, tenantId, isContainer: true, pipelineStatus: 'UPLOADED', processingPriority: 'NORMAL', uploadSource: 'WEB' },
      select: { id: true },
    });
    processingDocumentId = processing.id;

    await prisma.bizFileOperationReceipt.create({
      data: {
        id: receiptId,
        tenantId,
        operationId: `correction-storage-${suffix}`,
        capabilityId: 'bizfile.import_and_review',
        capabilityVersion: '1.0',
        schemaVersion: '1',
        mode: 'UPDATE',
        companyId,
        documentId,
        payloadHash: 'c'.repeat(64),
        expectedAggregateRevision: 0,
        beforeRevision: 0,
        afterRevision: 1,
        status: 'COMMITTED',
        effectStatus: 'PENDING',
      },
    });

    const sourceArtifact = {
      documentId,
      storageKey: sourceKey,
      sourceRevision,
      sourceHash,
      mimeType: 'application/pdf',
    };
    await prisma.bizFileOperationEvidence.create({
      data: {
        tenantId,
        receiptId,
        kind: 'SOURCE',
        artifact: sourceArtifact,
        artifactHash: hashBizFileValue(sourceArtifact),
        sourceRef: { documentId, sourceRevision },
      },
    });

    const storagePayload = { documentId, storageKey: sourceKey, sourceHash, sourceRevision };
    const pagePayload = {
      documentId,
      storageKey: sourceKey,
      mimeType: 'application/pdf',
      sourceHash,
      sourceRevision,
      finalizedSourceRevision: sourceRevision + 1,
    };
    const repository = createBizFileOperationRepository();
    await prisma.$transaction(async (tx) => {
      await repository.effect(tx, {
        tenantId,
        receiptId,
        effectKind: 'STORAGE_FINALIZE',
        target: `document:${documentId}`,
        payload: storagePayload,
        payloadHash: hashBizFileValue(storagePayload),
      });
      await repository.effect(tx, {
        tenantId,
        receiptId,
        effectKind: 'PAGE_PREPARATION',
        target: `document:${documentId}`,
        payload: pagePayload,
        payloadHash: hashBizFileValue(pagePayload),
      });
    });
  });

  afterEach(async () => {
    if (tenantId) {
      await prisma.bizFileOperationEffectIntent.deleteMany({ where: { tenantId } });
      await prisma.bizFileOperationEvidence.deleteMany({ where: { tenantId } });
      await prisma.bizFileOperationReceipt.deleteMany({ where: { tenantId } });
      await prisma.documentPage.deleteMany({ where: { processingDocumentId } });
      await prisma.processingDocument.deleteMany({ where: { tenantId } });
      await prisma.document.deleteMany({ where: { tenantId } });
      await prisma.company.deleteMany({ where: { tenantId } });
      await prisma.user.deleteMany({ where: { tenantId } });
      await prisma.workspace.deleteMany({ where: { id: tenantId } });
    }
    if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('orders required effects and completes same-pointer finalization against filesystem storage', async () => {
    const before = await storage.download(sourceKey);
    expect(before).toEqual(sourceBytes);

    const queued = await prisma.bizFileOperationEffectIntent.findMany({
      where: { tenantId, receiptId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { effectKind: true, createdAt: true },
    });
    expect(queued.map((effect) => effect.effectKind)).toEqual(['STORAGE_FINALIZE', 'PAGE_PREPARATION']);
    expect(queued[1].createdAt.getTime()).toBeGreaterThan(queued[0].createdAt.getTime());

    const drained = await drainBizFileOperationEffects({
      db: prisma,
      storage,
      receiptId,
      batchSize: 2,
    });

    expect(drained).toMatchObject({ claimed: 2, completed: 2, failed: 0, errors: 0 });
    await expect(prisma.bizFileOperationReceipt.findUniqueOrThrow({
      where: { tenantId_id: { tenantId, id: receiptId } },
      select: { effectStatus: true },
    })).resolves.toEqual({ effectStatus: 'COMPLETE' });
    await expect(prisma.document.findUniqueOrThrow({
      where: { id: documentId },
      select: { storageKey: true, sourceRevision: true },
    })).resolves.toEqual({ storageKey: sourceKey, sourceRevision: sourceRevision + 1 });
    await expect(prisma.processingDocument.findUniqueOrThrow({
      where: { id: processingDocumentId },
      select: { pageCount: true },
    })).resolves.toEqual({ pageCount: 1 });
    await expect(prisma.documentPage.findFirstOrThrow({
      where: { processingDocumentId, pageNumber: 1 },
      select: { storageKey: true, widthPx: true, heightPx: true },
    })).resolves.toEqual({ storageKey: sourceKey, widthPx: 612, heightPx: 792 });
    expect(await storage.download(sourceKey)).toEqual(sourceBytes);
  });
});
