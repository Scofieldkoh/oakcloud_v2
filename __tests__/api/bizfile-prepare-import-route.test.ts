import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyBizFilePreparationToken } from '@/services/bizfile/application/preparation-token';
import { hashBizFileValue } from '@/services/bizfile/change-plan';

const {
  mockRequireAuth,
  mockEvaluateFreshAuthorization,
  mockDocumentFindFirst,
  mockCompanyFindFirst,
  mockDownload,
  mockPrepare,
} = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockEvaluateFreshAuthorization: vi.fn(),
  mockDocumentFindFirst: vi.fn(),
  mockCompanyFindFirst: vi.fn(),
  mockDownload: vi.fn(),
  mockPrepare: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: mockRequireAuth }));
vi.mock('@/lib/fresh-authorization', () => ({ evaluateFreshAuthorization: mockEvaluateFreshAuthorization }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    document: { findFirst: mockDocumentFindFirst },
    company: { findFirst: mockCompanyFindFirst },
  },
}));
vi.mock('@/lib/storage', () => ({ storage: { download: mockDownload } }));
vi.mock('@/services/bizfile', () => ({ prepareBizFileImportCommand: mockPrepare }));

import { POST } from '@/app/api/documents/[documentId]/prepare-import/route';

const reviewedData = {
  entityDetails: {
    uen: '202626103M',
    name: 'Example Pte. Ltd.',
    entityType: 'PRIVATE_LIMITED',
    status: 'LIVE',
  },
  officers: [],
};

const document = {
  id: 'doc-1',
  tenantId: 'tenant-1',
  uploadedById: 'user-1',
  extractedData: reviewedData,
  extractionStatus: 'EXTRACTED',
  storageKey: 'pending/doc.pdf',
  mimeType: 'application/pdf',
  originalFileName: 'doc.pdf',
  version: 2,
  sourceRevision: 7,
};

function request(body: unknown = { extractedData: reviewedData }) {
  return new Request('http://localhost/api/documents/doc-1/prepare-import', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

async function post(body?: unknown) {
  return POST(request(body) as never, { params: Promise.resolve({ documentId: 'doc-1' }) });
}

describe('POST /api/documents/:documentId/prepare-import', () => {
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => {
    vi.stubEnv('BUSINESS_ASSISTANT_PREPARATION_SECRET', 'test-only-preparation-signing-secret-32-characters');
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      id: 'user-1',
      tenantId: 'tenant-1',
      isSuperAdmin: false,
      isWorkspaceAdmin: false,
    });
    mockDocumentFindFirst.mockResolvedValue(document);
    mockCompanyFindFirst.mockResolvedValue({ id: 'company-1' });
    mockEvaluateFreshAuthorization.mockResolvedValue({
      allowed: true,
      actor: { id: 'user-1', isSuperAdmin: false, isWorkspaceAdmin: false },
    });
    mockDownload.mockResolvedValue(Buffer.from('original bytes'));
    mockPrepare.mockResolvedValue({
      plan: { mode: 'CREATE', sourceVersion: 7, canonicalHash: 'a'.repeat(64) },
      source: {
        documentId: 'doc-1',
        tenantId: 'tenant-1',
        version: 2,
        storageKey: 'pending/doc.pdf',
        mimeType: 'application/pdf',
        originalFileName: 'doc.pdf',
      },
      contactCandidates: [],
    });
  });

  it('binds preparation to the authoritative document source revision', async () => {
    const response = await post({ extractedData: reviewedData, sourceVersion: 999 });

    expect(response.status).toBe(200);
    expect(mockPrepare).toHaveBeenCalledWith(expect.objectContaining({
      sourceVersion: 7,
      sourceHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
    const body = await response.json();
    expect(body).toEqual(expect.objectContaining({
      source: expect.objectContaining({ sourceRevision: 7 }),
    }));
    expect(() => verifyBizFilePreparationToken(body.preparationToken, {
      actorId: 'user-1', tenantId: 'tenant-1', documentId: 'doc-1',
      planHash: 'a'.repeat(64), contextHash: hashBizFileValue(null),
    })).not.toThrow();
  });

  it('preserves source revision zero when the document version is already nonzero', async () => {
    mockDocumentFindFirst.mockResolvedValue({ ...document, version: 9, sourceRevision: 0 });
    mockPrepare.mockResolvedValue({
      plan: { mode: 'CREATE', sourceVersion: 0, canonicalHash: 'a'.repeat(64) },
      source: {
        documentId: 'doc-1', tenantId: 'tenant-1', version: 9, sourceRevision: 0,
        storageKey: 'pending/doc.pdf', mimeType: 'application/pdf', originalFileName: 'doc.pdf',
      },
      contactCandidates: [],
    });

    const response = await post({ extractedData: reviewedData, sourceVersion: 999 });

    expect(response.status).toBe(200);
    expect(mockPrepare).toHaveBeenCalledWith(expect.objectContaining({ sourceVersion: 0 }));
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      source: expect.objectContaining({ sourceRevision: 0 }),
    }));
  });

  it('denies a source after the fresh document authorization check', async () => {
    mockEvaluateFreshAuthorization.mockResolvedValueOnce({ allowed: false, reason: 'resource_deleted' });

    const response = await post();

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: 'You do not have access to this source document. Ask a workspace administrator to grant document read access.',
    });
    expect(mockDownload).not.toHaveBeenCalled();
    expect(mockPrepare).not.toHaveBeenCalled();
  });

  it('denies a target after the fresh company authorization check', async () => {
    mockEvaluateFreshAuthorization
      .mockResolvedValueOnce({
        allowed: true,
        actor: { id: 'user-1', isSuperAdmin: false, isWorkspaceAdmin: false },
      })
      .mockResolvedValueOnce({ allowed: false, reason: 'permission_denied' });

    const response = await post({ extractedData: reviewedData, mode: 'UPDATE', targetCompanyId: 'company-1' });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: 'You do not have permission to update the selected company. Ask a workspace administrator for access.',
    });
    expect(mockEvaluateFreshAuthorization).toHaveBeenCalledTimes(2);
    expect(mockEvaluateFreshAuthorization.mock.calls[1][0]).toEqual(expect.objectContaining({
      permission: { resource: 'company', action: 'update' },
      resource: { kind: 'company', id: 'company-1' },
    }));
    expect(mockDownload).not.toHaveBeenCalled();
    expect(mockPrepare).not.toHaveBeenCalled();
  });

  it('returns actionable guidance when company creation is not authorized', async () => {
    mockEvaluateFreshAuthorization
      .mockResolvedValueOnce({
        allowed: true,
        actor: { id: 'user-1', isSuperAdmin: false, isWorkspaceAdmin: false },
      })
      .mockResolvedValueOnce({ allowed: false, reason: 'permission_denied' });

    const response = await post();

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: 'You do not have permission to create a company in this workspace. Ask a workspace administrator for access.',
    });
    expect(mockDownload).not.toHaveBeenCalled();
    expect(mockPrepare).not.toHaveBeenCalled();
  });

  it('uses fresh workspace-admin authority for the uploader restriction', async () => {
    mockDocumentFindFirst.mockResolvedValue({ ...document, uploadedById: 'user-2' });
    mockEvaluateFreshAuthorization.mockResolvedValue({
      allowed: true,
      actor: { id: 'user-1', isSuperAdmin: false, isWorkspaceAdmin: true },
    });

    const response = await post();

    expect(response.status).toBe(200);
    expect(mockDownload).toHaveBeenCalledOnce();
    expect(mockPrepare).toHaveBeenCalledOnce();
  });

  it('returns actionable guidance when a non-uploader lacks workspace-admin authority', async () => {
    mockDocumentFindFirst.mockResolvedValue({ ...document, uploadedById: 'user-2' });

    const response = await post();

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: 'Only the uploader or a workspace administrator can prepare this document.',
    });
    expect(mockDownload).not.toHaveBeenCalled();
    expect(mockPrepare).not.toHaveBeenCalled();
  });

  it('maps review validation failures to the existing issue DTO', async () => {
    const response = await post({ extractedData: { entityDetails: { name: '' } } });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Please correct the highlighted fields');
    expect(body.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'entityDetails.uen', section: 'entity' }),
      expect.objectContaining({ path: 'entityDetails.entityType', section: 'entity' }),
    ]));
    expect(body.issues[0].path).toEqual(expect.any(String));
    expect(mockPrepare).not.toHaveBeenCalled();
  });

  it('does not expose unexpected preparation failures', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockPrepare.mockRejectedValue(new Error('database password'));

    const response = await post();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Internal server error' });
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
