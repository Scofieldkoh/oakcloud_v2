import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildBizFileChangePlan, hashBizFileValue } from '@/services/bizfile/change-plan';
import { issueBizFilePreparationToken } from '@/services/bizfile/application/preparation-token';
import { bizFileReviewSchema, normalizeBizFileReviewDraft } from '@/lib/validations/bizfile-review';

const { mockRequireAuth, mockDocumentFindUnique, mockDocumentUpdate, mockProcess } = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockDocumentFindUnique: vi.fn(),
  mockDocumentUpdate: vi.fn(),
  mockProcess: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: mockRequireAuth }));
vi.mock('@/lib/prisma', () => ({
  prisma: { document: { findUnique: mockDocumentFindUnique, update: mockDocumentUpdate } },
}));
vi.mock('@/services/bizfile', async () => ({ processBizFileExtraction: mockProcess,
  hashBizFileValue: (await import('@/services/bizfile/change-plan')).hashBizFileValue }));

import { POST } from '@/app/api/documents/[documentId]/confirm/route';

const validPayload = {
  entityDetails: {
    uen: '202626103M',
    name: '  Corrected Pte. Ltd.  ',
    entityType: 'PRIVATE_LIMITED',
    status: 'LIVE',
  },
  officers: [],
};

const extractedDocument = {
  id: 'doc-1',
  tenantId: 'tenant-1',
  uploadedById: 'user-1',
  extractionStatus: 'EXTRACTED',
  extractedData: { entityDetails: { name: 'Stale name' } },
  companyId: null,
  storageKey: 'pending/doc.pdf',
  mimeType: 'application/pdf',
};

function request(body: unknown = { extractedData: validPayload }) {
  const input = body as { extractedData?: unknown; taskContext?: unknown };
  const parsed = bizFileReviewSchema.safeParse(input.extractedData);
  if (parsed.success) {
    const reviewedData = normalizeBizFileReviewDraft(parsed.data);
    const plan = buildBizFileChangePlan({ mode: 'CREATE', tenantId: 'tenant-1', documentId: 'doc-1', reviewedData });
    const { token } = issueBizFilePreparationToken({ actorId: 'user-1', tenantId: 'tenant-1', documentId: 'doc-1', planHash: plan.canonicalHash, contextHash: hashBizFileValue(input.taskContext ?? null) });
    body = { ...input, plan, preparationToken: token, operationId: 'test-operation' };
  }
  return new Request('http://localhost/api/documents/doc-1/confirm', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

function rawRequest(body: string) {
  return new Request('http://localhost/api/documents/doc-1/confirm', {
    method: 'POST',
    body,
  });
}

async function post(body?: unknown) {
  return POST(request(body) as never, { params: Promise.resolve({ documentId: 'doc-1' }) });
}

async function postRaw(body: string) {
  return POST(rawRequest(body) as never, { params: Promise.resolve({ documentId: 'doc-1' }) });
}

describe('POST /api/documents/:documentId/confirm', () => {
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => {
    vi.stubEnv('BUSINESS_ASSISTANT_PREPARATION_SECRET', 'test-only-preparation-signing-secret-32-characters');
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      id: 'user-1', tenantId: 'tenant-1', isSuperAdmin: false, isWorkspaceAdmin: false,
    });
    mockDocumentFindUnique.mockResolvedValue(extractedDocument);
    mockDocumentUpdate.mockResolvedValue({});
    mockProcess.mockResolvedValue({ companyId: 'company-1', created: true });
  });

  it('normalizes, saves, and processes the corrected request payload', async () => {
    const response = await post();

    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
    expect(mockDocumentUpdate).not.toHaveBeenCalled();
    expect(mockProcess).toHaveBeenCalledWith(
      'doc-1',
      expect.objectContaining({ entityDetails: expect.objectContaining({ name: 'Corrected Pte. Ltd.' }) }),
      'user-1', 'tenant-1', 'pending/doc.pdf', 'application/pdf', undefined,
      expect.objectContaining({ mode: 'CREATE' }), expect.objectContaining({ operationId: 'test-operation' })
    );
    await expect(response.json()).resolves.toEqual(expect.objectContaining({ success: true, companyId: 'company-1', created: true, operationId: 'test-operation' }));
  });

  it('returns field issues and makes no writes for a malformed payload', async () => {
    const response = await post({ extractedData: { entityDetails: { name: '' } } });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Please correct the highlighted fields');
    expect(body.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'entityDetails.uen', section: 'entity' }),
      expect.objectContaining({ path: 'entityDetails.entityType', section: 'entity' }),
    ]));
    expect(mockDocumentUpdate).not.toHaveBeenCalled();
    expect(mockProcess).not.toHaveBeenCalled();
  });

  it('rejects an invalid optional task context without processing the BizFile', async () => {
    const response = await post({
      extractedData: validPayload,
      taskContext: {
        taskId: 'not-a-uuid',
        taskStageId: '22222222-2222-4222-8222-222222222222',
      },
    });

    expect(response.status).toBe(400);
    expect(mockProcess).not.toHaveBeenCalled();
  });

  it('canonicalizes aliases and omits cleared identification types before saving and processing', async () => {
    const extractedData = { ...validPayload, entityDetails: { ...validPayload.entityDetails, entityType: 'PRIVATE LIMITED', status: 'LIVE COMPANY' }, officers: [{ name: 'A', role: 'COMPANY SECRETARY', identificationType: '' }], shareholders: [{ name: 'B', type: 'INDIVIDUAL', shareClass: 'ORDINARY', numberOfShares: 1, identificationType: '' }] };
    expect((await post({ extractedData })).status).toBe(200);
    const corrected = mockProcess.mock.calls[0][1];
    expect(corrected.entityDetails).toMatchObject({ entityType: 'PRIVATE_LIMITED', status: 'LIVE' });
    expect(corrected.officers[0]).toMatchObject({ role: 'SECRETARY' });
    expect(corrected.officers[0]).not.toHaveProperty('identificationType');
    expect(corrected.shareholders[0]).not.toHaveProperty('identificationType');
    expect(mockDocumentUpdate).not.toHaveBeenCalled();
  });

  it.each([
    ['invalid financial year date', { ...validPayload, financialYear: { endDay: 31, endMonth: 4 } }, 'financialYear.endDay'],
    ['invalid entity type', { ...validPayload, entityDetails: { ...validPayload.entityDetails, entityType: 'MADE_UP' } }, 'entityDetails.entityType'],
    ['invalid status', { ...validPayload, entityDetails: { ...validPayload.entityDetails, status: 'MADE_UP' } }, 'entityDetails.status'],
    ['invalid officer role', { ...validPayload, officers: [{ name: 'A', role: 'MADE_UP' }] }, 'officers.0.role'],
    ['invalid identification type', { ...validPayload, officers: [{ name: 'A', role: 'DIRECTOR', identificationType: 'MADE_UP' }] }, 'officers.0.identificationType'],
  ])('rejects %s without writes', async (_label, extractedData, path) => {
    const response = await post({ extractedData });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({ issues: expect.arrayContaining([expect.objectContaining({ path })]) }));
    expect(mockDocumentUpdate).not.toHaveBeenCalled();
    expect(mockProcess).not.toHaveBeenCalled();
  });

  it.each(['{', '{"extractedData":'])(
    'returns request issues and makes no writes for invalid JSON: %s',
    async (rawBody) => {
      const response = await postRaw(rawBody);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body).toEqual({
        error: 'Please correct the highlighted fields',
        issues: [expect.objectContaining({ path: 'request', section: 'entity' })],
      });
      expect(mockDocumentUpdate).not.toHaveBeenCalled();
      expect(mockProcess).not.toHaveBeenCalled();
    }
  );

  it('returns 404 when the document does not exist', async () => {
    mockDocumentFindUnique.mockResolvedValue(null);
    expect((await post()).status).toBe(404);
  });

  it.each([
    ['another tenant', { ...extractedDocument, tenantId: 'tenant-2' }],
    ['another owner', { ...extractedDocument, uploadedById: 'user-2' }],
  ])('returns 403 for %s', async (_label, document) => {
    mockDocumentFindUnique.mockResolvedValue(document);
    expect((await post()).status).toBe(403);
    expect(mockDocumentUpdate).not.toHaveBeenCalled();
    expect(mockProcess).not.toHaveBeenCalled();
  });

  it('requires EXTRACTED status', async () => {
    mockDocumentFindUnique.mockResolvedValue({ ...extractedDocument, extractionStatus: 'PROCESSING' });
    expect((await post()).status).toBe(400);
    expect(mockProcess).not.toHaveBeenCalled();
  });

  it('does not bypass the reviewed request contract for a completed document', async () => {
    mockDocumentFindUnique.mockResolvedValue({
      ...extractedDocument, extractionStatus: 'COMPLETED', companyId: 'company-existing',
    });
    const response = await post({ malformed: true });

    expect(response.status).toBe(400);
    expect(mockDocumentUpdate).not.toHaveBeenCalled();
    expect(mockProcess).not.toHaveBeenCalled();
  });

  it('rejects a legacy direct-save request without a prepared plan', async () => {
    const response = await postRaw(JSON.stringify({ extractedData: validPayload }));
    expect(response.status).toBe(409);
    expect(mockProcess).not.toHaveBeenCalled();
  });

  it('does not leave a partial corrected-data write if transactional processing fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockProcess.mockRejectedValue(new Error('processor credential secret'));
    const response = await post();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Internal server error' });
    expect(mockDocumentUpdate).not.toHaveBeenCalled();
    expect(mockProcess).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });

  it('preserves the known unauthorized mapping', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockRequireAuth.mockRejectedValue(new Error('Unauthorized'));

    const response = await post();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(mockDocumentFindUnique).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
