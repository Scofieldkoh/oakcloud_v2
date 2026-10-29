import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaTransactionClient } from '@/services/contact.service';
import { assertFreshBizFileSourceRevision } from '@/services/bizfile/application/source-revision';
import { assertBizFileChangePlan, buildBizFileChangePlan } from '@/services/bizfile/change-plan';

const { documentFindFirst, companyFindFirst, download } = vi.hoisted(() => ({
  documentFindFirst: vi.fn(),
  companyFindFirst: vi.fn(),
  download: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    document: { findFirst: documentFindFirst },
    company: { findFirst: companyFindFirst },
  },
}));
vi.mock('@/lib/storage', () => ({ storage: { download } }));

describe('BizFile source revision guard', () => {
  beforeEach(() => vi.clearAllMocks());

  function transactionWithRevision(revision: number | null) {
    const queryRawUnsafe = vi.fn().mockResolvedValue(
      revision === null ? [] : [{ sourceRevision: revision }],
    );
    return {
      tx: { $queryRawUnsafe: queryRawUnsafe } as unknown as PrismaTransactionClient,
      queryRawUnsafe,
    };
  }

  it('allows the foundation revision zero when the source is unchanged', async () => {
    const { tx, queryRawUnsafe } = transactionWithRevision(0);

    await expect(assertFreshBizFileSourceRevision(tx, {
      tenantId: 'tenant-1', documentId: 'document-1', expectedSourceRevision: 0,
    })).resolves.toBe(0);

    expect(queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('FOR UPDATE'),
      'document-1',
      'tenant-1',
    );
  });

  it('rejects a prepared revision zero after the first source update advances it to one', async () => {
    const { tx } = transactionWithRevision(1);

    await expect(assertFreshBizFileSourceRevision(tx, {
      tenantId: 'tenant-1', documentId: 'document-1', expectedSourceRevision: 0,
    })).rejects.toMatchObject({ code: 'STALE_BIZFILE_SOURCE' });
  });

  it('allows a preparation that matches the current nonzero source revision', async () => {
    const { tx } = transactionWithRevision(1);

    await expect(assertFreshBizFileSourceRevision(tx, {
      tenantId: 'tenant-1', documentId: 'document-1', expectedSourceRevision: 1,
    })).resolves.toBe(1);
  });

  it('fails closed when the locked source row is missing', async () => {
    const { tx } = transactionWithRevision(null);

    await expect(assertFreshBizFileSourceRevision(tx, {
      tenantId: 'tenant-1', documentId: 'document-1', expectedSourceRevision: 0,
    })).rejects.toMatchObject({ code: 'SOURCE_NOT_FOUND' });
  });
});

describe('BizFile preparation source binding', () => {
  beforeEach(() => {
    documentFindFirst.mockResolvedValue({
      id: 'document-1',
      tenantId: 'tenant-1',
      version: 9,
      sourceRevision: 0,
      storageKey: 'tenant-1/pending/document-1.pdf',
      mimeType: 'application/pdf',
      originalFileName: 'document-1.pdf',
    });
    companyFindFirst.mockResolvedValue(null);
    download.mockResolvedValue(Buffer.from('original source bytes'));
  });

  it('binds a zero source revision instead of falling back to Document.version', async () => {
    const { prepareBizFileImportCommand } = await import('@/services/bizfile/application/prepare-import');
    const prepared = await prepareBizFileImportCommand({
      tenantId: 'tenant-1',
      documentId: 'document-1',
      reviewedData: {
        entityDetails: {
          uen: '202600001A',
          name: 'Example Pte Ltd',
          entityType: 'PRIVATE_LIMITED',
          status: 'LIVE',
        },
      },
    });

    expect(prepared.plan.sourceVersion).toBe(0);
    expect(prepared.source).toMatchObject({ version: 9, sourceRevision: 0 });
  });

  it('uses revision zero for a direct plan when no revision override is supplied', () => {
    const plan = buildBizFileChangePlan({
      mode: 'CREATE',
      tenantId: 'tenant-1',
      documentId: 'document-1',
      reviewedData: {
        entityDetails: {
          uen: '202600001A',
          name: 'Example Pte Ltd',
          entityType: 'PRIVATE_LIMITED',
          status: 'LIVE',
        },
      },
    });

    expect(plan.sourceVersion).toBe(0);
  });

  it('rejects a plan with no authoritative source revision', () => {
    const plan = buildBizFileChangePlan({
      mode: 'CREATE',
      tenantId: 'tenant-1',
      documentId: 'document-1',
      reviewedData: {
        entityDetails: {
          uen: '202600001A',
          name: 'Example Pte Ltd',
          entityType: 'PRIVATE_LIMITED',
          status: 'LIVE',
        },
      },
    });
    delete (plan as { sourceVersion?: number }).sourceVersion;

    expect(() => assertBizFileChangePlan(plan)).toThrow('source revision');
  });

  it('rejects a source revision that changed during preparation', async () => {
    const { prepareBizFileImportCommand } = await import('@/services/bizfile/application/prepare-import');

    await expect(prepareBizFileImportCommand({
      tenantId: 'tenant-1',
      documentId: 'document-1',
      sourceVersion: 9,
      reviewedData: {
        entityDetails: {
          uen: '202600001A',
          name: 'Example Pte Ltd',
          entityType: 'PRIVATE_LIMITED',
          status: 'LIVE',
        },
      },
    })).rejects.toThrow('STALE_BIZFILE_SOURCE');
  });

  it('hashes the downloaded source bytes and carries source revision zero into the adapter binding', async () => {
    const { assistantCapabilities } = await import('@/services/bizfile/assistant-capabilities');
    const prepared = await assistantCapabilities[0].prepare({
      documentId: 'document-1',
      extractedData: {
        entityDetails: {
          uen: '202600001A',
          name: 'Example Pte Ltd',
          entityType: 'PRIVATE_LIMITED',
          status: 'LIVE',
        },
      },
    }, {
      actor: { tenantId: 'tenant-1', userId: 'user-1', requestId: 'request-1', source: 'test' },
      resources: [],
    });

    expect(prepared.status).toBe('PREPARED');
    if (prepared.status !== 'PREPARED') return;
    const item = prepared.items[0];
    const input = item.input as unknown as { plan: { sourceVersion?: number }; source: { version: number; sourceRevision: number; sourceHash?: string } };
    expect(input.plan.sourceVersion).toBe(0);
    expect(input.source).toMatchObject({ version: 9, sourceRevision: 0 });
    expect(input.source.sourceHash).toBe(createHash('sha256').update(Buffer.from('original source bytes')).digest('hex'));
    expect(download).toHaveBeenCalledWith('tenant-1/pending/document-1.pdf');
  });

  it('blocks adapter preparation when the original source artifact cannot be read', async () => {
    download.mockRejectedValue(new Error('storage unavailable'));
    const { assistantCapabilities } = await import('@/services/bizfile/assistant-capabilities');

    const prepared = await assistantCapabilities[0].prepare({ documentId: 'document-1' }, {
      actor: { tenantId: 'tenant-1', userId: 'user-1', requestId: 'request-1', source: 'test' },
      resources: [],
    });

    expect(prepared).toMatchObject({ status: 'BLOCKED', code: 'SOURCE_UNAVAILABLE' });
  });
});

describe('BizFile source revision migration', () => {
  it('installs a server maintained row trigger for source changes', () => {
    const migration = readFileSync(resolve(
      process.cwd(),
      'prisma/migrations/20260907020000_bizfile_source_revision_guard/migration.sql',
    ), 'utf8');

    expect(migration).toContain('BEFORE UPDATE ON "documents"');
    expect(migration).toContain('NEW."source_revision" := OLD."source_revision"');
    expect(migration).toContain('COALESCE(OLD."source_revision", 0) + 1');
    expect(migration).toContain('OLD."storage_key" IS DISTINCT FROM NEW."storage_key"');
    expect(migration).toContain('OLD."version" IS DISTINCT FROM NEW."version"');
    expect(migration).toContain('OLD."extracted_data" IS DISTINCT FROM NEW."extracted_data"');
    expect(migration).toContain('OLD."deleted_at" IS DISTINCT FROM NEW."deleted_at"');
  });
});
