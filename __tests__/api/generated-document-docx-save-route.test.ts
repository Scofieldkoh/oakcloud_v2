import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requirePermission: vi.fn(),
  saveGeneratedOakDocDocument: vi.fn(),
  saveOakDocBatchDraft: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: mocks.requireAuth }));
vi.mock('@/lib/rbac', () => ({ requirePermission: mocks.requirePermission }));
vi.mock('@/services/document-generator.service', () => ({
  getGeneratedDocumentById: vi.fn(),
  updateGeneratedDocument: vi.fn(),
  deleteGeneratedDocument: vi.fn(),
  archiveDocument: vi.fn(),
}));
vi.mock('@/services/oakdoc-generation.service', () => ({
  downloadGeneratedOakDoc: vi.fn(),
  saveGeneratedOakDocDocument: mocks.saveGeneratedOakDocDocument,
}));
vi.mock('@/services/document-generation-batch/oakdoc-draft.service', () => ({
  saveOakDocBatchDraft: mocks.saveOakDocBatchDraft,
}));

import { PUT } from '@/app/api/generated-documents/[id]/route';

const id = '11111111-1111-4111-8111-111111111111';

function put(query: string, headers: Record<string, string> = {}) {
  return PUT(
    new NextRequest(`http://localhost/api/generated-documents/${id}?format=docx${query}`, {
      method: 'PUT',
      body: new Uint8Array([0x50, 0x4b]),
      headers,
    }),
    { params: Promise.resolve({ id }) },
  );
}

describe('PUT /api/generated-documents/:id?format=docx', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({ id: 'user-1', tenantId: 'tenant-1', workspaceId: 'tenant-1' });
    mocks.saveGeneratedOakDocDocument.mockResolvedValue({
      operationId: 'op-1', revision: 5, assetSha256: 'a'.repeat(64), updatedAt: '2026-09-26T00:00:00.000Z',
    });
  });

  it('requires an explicit expected revision instead of treating a missing value as 0', async () => {
    const response = await put('');
    expect(response.status).toBe(428);
    expect(mocks.saveGeneratedOakDocDocument).not.toHaveBeenCalled();

    const empty = await put('&expectedRevision=');
    expect(empty.status).toBe(428);
  });

  it('passes operation and snapshot identity through and returns the receipt', async () => {
    const response = await put(
      '&expectedRevision=4&sessionKey=s-1&writerInstanceId=w-1&localRevision=9&baseRevision=4',
      { 'idempotency-key': 'op-12345678' },
    );
    expect(response.status).toBe(200);
    expect(mocks.saveGeneratedOakDocDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: id,
        expectedRevision: 4,
        operationId: 'op-12345678',
        snapshot: { sessionKey: 's-1', writerInstanceId: 'w-1', localRevision: 9, baseRevision: 4 },
      }),
      { tenantId: 'tenant-1', userId: 'user-1' },
    );
    expect(await response.json()).toMatchObject({ revision: 5, operationId: 'op-1' });
  });

  it('rejects oversized uploads before buffering the body', async () => {
    const response = await put('&expectedRevision=1', { 'content-length': String(60 * 1024 * 1024) });
    expect(response.status).toBe(413);
    expect(mocks.saveGeneratedOakDocDocument).not.toHaveBeenCalled();
  });
});
