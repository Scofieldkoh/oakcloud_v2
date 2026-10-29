import { createHash } from 'node:crypto';

import { PDFDocument } from 'pdf-lib';
import { describe, expect, it, vi } from 'vitest';

import {
  executeBizFileOperationEffect,
  type BizFileEffectClaim,
  type BizFileEffectExecutorOptions,
} from '@/services/bizfile/application/effect-executor';
import { hashBizFileValue } from '@/services/bizfile/change-plan';

const tenantId = 'tenant-1';
const companyId = 'company-1';
const documentId = 'document-1';
const receiptId = 'receipt-1';
const sourceKey = 'tenant-1/pending/document-1.pdf';
const sourceRevision = 7;

function digest(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function storageFixture(sourceBytes: Buffer) {
  const objects = new Map<string, Buffer>([[sourceKey, Buffer.from(sourceBytes)]]);
  const storage = {
    download: vi.fn(async (key: string) => {
      const bytes = objects.get(key);
      if (!bytes) throw new Error(`missing object: ${key}`);
      return Buffer.from(bytes);
    }),
    exists: vi.fn(async (key: string) => objects.has(key)),
    copy: vi.fn(async (from: string, to: string) => {
      const bytes = objects.get(from);
      if (!bytes) throw new Error(`missing object: ${from}`);
      objects.set(to, Buffer.from(bytes));
    }),
  };
  return { storage, objects };
}

function claim(effectKind: 'STORAGE_FINALIZE' | 'PAGE_PREPARATION', payload: Record<string, unknown>, payloadHash = hashBizFileValue(payload)): BizFileEffectClaim {
  return {
    id: `${effectKind.toLowerCase()}-effect`,
    tenantId,
    receiptId,
    operationId: 'operation-1',
    documentId,
    companyId,
    effectKind,
    target: `document:${documentId}`,
    payload,
    payloadHash,
    attemptCount: 1,
    claimToken: 'claim-token',
    claimGeneration: 1,
    leaseExpiresAt: new Date('2026-09-08T00:01:00.000Z'),
  };
}

function database(options: {
  sourceBytes: Buffer;
  document?: Record<string, unknown>;
  effectUpdateCount?: number;
  effectState?: 'COMPLETE' | 'FAILED_RETRYABLE' | 'FAILED_PERMANENT';
}) {
  const sourceHash = digest(options.sourceBytes);
  const document = {
    id: documentId,
    tenantId,
    companyId,
    storageKey: sourceKey,
    fileName: 'document.pdf',
    originalFileName: 'document.pdf',
    mimeType: 'application/pdf',
    sourceRevision,
    isLatest: true,
    deletedAt: null,
    ...options.document,
  };
  const effectUpdateMany = vi.fn().mockResolvedValue({ count: options.effectUpdateCount ?? 1 });
  const receiptUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
  const tx = {
    document: {
      findFirst: vi.fn().mockResolvedValue(document),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    bizFileOperationEffectIntent: {
      updateMany: effectUpdateMany,
      findMany: vi.fn().mockResolvedValue([{ state: options.effectState ?? 'COMPLETE' }]),
    },
    bizFileOperationReceipt: { updateMany: receiptUpdateMany },
    bizFileOperationEvidence: {},
    processingDocument: {
      findUnique: vi.fn().mockResolvedValue({ id: 'processing-1', tenantId }),
      update: vi.fn().mockResolvedValue({}),
    },
    documentPage: {
      upsert: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };
  const db = {
    $transaction: vi.fn(async (work: (transaction: unknown) => Promise<unknown>) => work(tx)),
    document: { findFirst: vi.fn().mockResolvedValue(document) },
    bizFileOperationEvidence: {
      findFirst: vi.fn().mockResolvedValue({
        artifact: { documentId, storageKey: sourceKey, sourceRevision, sourceHash },
        sourceRef: { documentId, sourceRevision },
      }),
    },
    bizFileOperationEffectIntent: tx.bizFileOperationEffectIntent,
    bizFileOperationReceipt: tx.bizFileOperationReceipt,
    processingDocument: tx.processingDocument,
    documentPage: tx.documentPage,
  };
  return { db, tx, sourceHash, effectUpdateMany, receiptUpdateMany };
}

function options(db: ReturnType<typeof database>['db'], storage: ReturnType<typeof storageFixture>['storage']): BizFileEffectExecutorOptions {
  return {
    db: db as unknown as NonNullable<BizFileEffectExecutorOptions['db']>,
    storage: storage as unknown as NonNullable<BizFileEffectExecutorOptions['storage']>,
    now: () => new Date('2026-09-08T00:00:00.000Z'),
    retryBaseMs: 100,
    retryMaxMs: 1_000,
  };
}

describe('durable BizFile required effects', () => {
  it('copies a verified source to an immutable hash destination and retains the source', async () => {
    const sourceBytes = Buffer.from('verified source bytes');
    const fixture = storageFixture(sourceBytes);
    const db = database({ sourceBytes });
    const payload = {
      documentId,
      storageKey: sourceKey,
      sourceHash: digest(sourceBytes),
      sourceRevision,
    };

    const result = await executeBizFileOperationEffect(claim('STORAGE_FINALIZE', payload), options(db.db, fixture.storage));

    expect(result.status).toBe('COMPLETE');
    expect(result.destinationKey).toBe(`${tenantId}/companies/${companyId}/documents/${documentId}/original-${digest(sourceBytes)}.pdf`);
    expect(fixture.storage.copy).toHaveBeenCalledWith(sourceKey, result.destinationKey);
    expect(fixture.objects.get(sourceKey)).toEqual(sourceBytes);
    expect(fixture.objects.get(result.destinationKey!)).toEqual(sourceBytes);
    expect(db.effectUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: 'COMPLETE' }) }));
  });

  it('records a bounded retry after an external source read fails', async () => {
    const sourceBytes = Buffer.from('temporarily unavailable');
    const fixture = storageFixture(sourceBytes);
    fixture.storage.download.mockRejectedValueOnce(new Error('storage timeout'));
    const db = database({ sourceBytes, effectState: 'FAILED_RETRYABLE' });
    const payload = { documentId, storageKey: sourceKey, sourceHash: digest(sourceBytes), sourceRevision };

    const result = await executeBizFileOperationEffect(claim('STORAGE_FINALIZE', payload), options(db.db, fixture.storage));

    expect(result).toMatchObject({ status: 'PENDING', safeError: { code: 'EFFECT_EXECUTION_FAILED', retryable: true } });
    expect(db.effectUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ state: 'FAILED_RETRYABLE', nextAttemptAt: expect.any(Date) }),
    }));
  });

  it('does not settle a claim after a competing worker has fenced it', async () => {
    const sourceBytes = Buffer.from('fenced source bytes');
    const fixture = storageFixture(sourceBytes);
    const db = database({ sourceBytes, effectUpdateCount: 0 });
    const payload = { documentId, storageKey: sourceKey, sourceHash: digest(sourceBytes), sourceRevision };

    const result = await executeBizFileOperationEffect(claim('STORAGE_FINALIZE', payload), options(db.db, fixture.storage));

    expect(result.status).toBe('STALE_WORKER');
    expect(db.receiptUpdateMany).not.toHaveBeenCalled();
  });

  it('fails malformed PDF and image sources without writing placeholder pages', async () => {
    for (const [mimeType, bytes, code] of [
      ['application/pdf', Buffer.from('%PDF-1.7 but truncated'), 'PDF_PARSE_FAILED'],
      ['image/png', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 2, 0, 0, 0, 2]), 'IMAGE_PARSE_FAILED'],
    ] as const) {
      const fixture = storageFixture(bytes);
      const db = database({ sourceBytes: bytes, effectState: 'FAILED_PERMANENT' });
      const payload = {
        documentId,
        storageKey: sourceKey,
        mimeType,
        sourceHash: digest(bytes),
        sourceRevision,
        finalizedSourceRevision: sourceRevision + 1,
      };
      const result = await executeBizFileOperationEffect(claim('PAGE_PREPARATION', payload), options(db.db, fixture.storage));

      expect(result).toMatchObject({ status: 'FAILED', safeError: { code, retryable: false } });
      expect(db.tx.documentPage.upsert).not.toHaveBeenCalled();
      expect(db.tx.processingDocument.update).not.toHaveBeenCalled();
    }
  });

  it('prepares valid pages after storage finalization using the bound post-finalize revision', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([612, 792]);
    const sourceBytes = Buffer.from(await pdf.save());
    const fixture = storageFixture(sourceBytes);
    const db = database({
      sourceBytes,
      document: {
        storageKey: `${tenantId}/companies/${companyId}/documents/${documentId}/original-${digest(sourceBytes)}.pdf`,
        sourceRevision: sourceRevision + 1,
      },
    });
    const payload = {
      documentId,
      storageKey: sourceKey,
      mimeType: 'application/pdf',
      sourceHash: digest(sourceBytes),
      sourceRevision,
      finalizedSourceRevision: sourceRevision + 1,
    };

    const result = await executeBizFileOperationEffect(claim('PAGE_PREPARATION', payload), options(db.db, fixture.storage));

    expect(result).toMatchObject({ status: 'COMPLETE', pageCount: 1 });
    expect(db.tx.documentPage.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ widthPx: 612, heightPx: 792, storageKey: sourceKey }),
    }));
    expect(db.tx.processingDocument.update).toHaveBeenCalledWith(expect.objectContaining({ data: { pageCount: 1 } }));
  });
});
