// @vitest-environment jsdom
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  company: { findFirst: vi.fn() },
  generatedDocument: { create: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

const objects = vi.hoisted(() => new Map<string, Buffer>());
const storageMock = vi.hoisted(() => ({
  upload: vi.fn(async (key: string, body: Buffer) => { objects.set(key, Buffer.from(body)); }),
  delete: vi.fn(async (key: string) => { objects.delete(key); }),
}));
vi.mock('@/lib/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/storage')>()),
  storage: storageMock,
}));
vi.mock('@/lib/audit', () => ({ createAuditLog: vi.fn(async () => undefined) }));

import { createBlankOakDocDocument } from '@/services/oakdoc-blank-document.service';
import {
  readGeneratedDocumentEngineState,
  readGeneratedOakDocAssetMetadata,
} from '@/lib/document-editor/document-engine';

const actor = { tenantId: 'tenant-1', userId: 'user-1' };

describe('blank OakDoc documents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    objects.clear();
    prismaMock.generatedDocument.create.mockImplementation(async ({ data }) => data);
  });

  it('creates an empty Word draft with its own asset and task link', async () => {
    const document = await createBlankOakDocDocument(
      { title: 'Board memo', companyId: null, useLetterhead: false },
      actor,
      { taskId: 'task-1', taskStageId: 'stage-1' } as never,
    );

    expect(document.revision).toBe(0);
    expect(document.status).toBe('DRAFT');
    expect(readGeneratedDocumentEngineState(document.metadata)).toBe('OAKDOC');
    const asset = readGeneratedOakDocAssetMetadata(document.metadata)!;
    expect(asset.fileName).toBe('Board memo.docx');
    expect(asset.templateId).toBe(document.id);
    const bytes = objects.get(asset.storageKey)!;
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256);
    expect(Object.keys(unzipSync(new Uint8Array(bytes)))).toContain('word/document.xml');
    expect((document.metadata as Record<string, unknown>).taskIntegrationContext)
      .toEqual({ taskId: 'task-1', taskStageId: 'stage-1' });
  });

  it('removes the uploaded asset when the document cannot be saved', async () => {
    prismaMock.generatedDocument.create.mockRejectedValue(new Error('database down'));

    await expect(createBlankOakDocDocument({ title: 'Memo', useLetterhead: true }, actor))
      .rejects.toThrow('database down');
    expect(storageMock.delete).toHaveBeenCalledOnce();
    expect(objects.size).toBe(0);
  });

  it('refuses a company outside the workspace', async () => {
    prismaMock.company.findFirst.mockResolvedValue(null);

    await expect(createBlankOakDocDocument(
      { title: 'Memo', companyId: '11111111-1111-4111-8111-111111111111', useLetterhead: true },
      actor,
    )).rejects.toThrow('Company not found');
    expect(storageMock.upload).not.toHaveBeenCalled();
  });
});
