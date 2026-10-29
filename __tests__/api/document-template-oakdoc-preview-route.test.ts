// @vitest-environment node
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const previewOakDocMaster = vi.fn();

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(async () => ({
    id: 'user-1', tenantId: 'tenant-1', isSuperAdmin: false, firstName: 'Ada', lastName: 'Tan',
  })),
}));
vi.mock('@/lib/rbac', () => ({ requirePermission: vi.fn(async () => undefined) }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/services/oakdoc-generation.service', () => ({
  previewOakDocMaster: (...args: unknown[]) => previewOakDocMaster(...args),
}));

const { POST } = await import('@/app/api/document-templates/oakdoc-preview/route');

const companyId = '22222222-2222-4222-8222-222222222222';

function request(context: unknown) {
  const data = new FormData();
  data.append('file', new Blob([new Uint8Array([80, 75, 3, 4])]), 'Letter.docx');
  data.append('context', typeof context === 'string' ? context : JSON.stringify(context));
  return new NextRequest('http://localhost/api/document-templates/oakdoc-preview', { method: 'POST', body: data });
}

beforeEach(() => previewOakDocMaster.mockReset());

describe('OakDoc template preview route', () => {
  it('previews the uploaded master in the session workspace and returns the DOCX', async () => {
    previewOakDocMaster.mockResolvedValue({
      bytes: Buffer.from('docx'),
      diagnostics: [],
      metadata: { fieldsUpdated: 2, unresolvedTags: [], conditionsResolved: 0, repeatersResolved: 0 },
    });
    const response = await POST(request({ companyId, refreshPartialPins: 'all' }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      docxBase64: Buffer.from('docx').toString('base64'),
      fieldsUpdated: 2,
    });
    expect(previewOakDocMaster).toHaveBeenCalledWith(
      expect.objectContaining({ companyId, refreshPartialPins: 'all', fileName: 'Letter.docx', generatedBy: 'Ada Tan' }),
      { tenantId: 'tenant-1' },
    );
  });

  it('rejects a missing or malformed context', async () => {
    expect((await POST(request('{'))).status).toBe(400);
    expect((await POST(request({ companyId: 'not-a-uuid' }))).status).toBe(400);
    expect(previewOakDocMaster).not.toHaveBeenCalled();
  });
});
