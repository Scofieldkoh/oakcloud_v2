import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const attackerTenant = '22222222-2222-4222-8222-222222222222';
const batchId = '33333333-3333-4333-8333-333333333333';
const itemId = '44444444-4444-4444-8444-444444444444';
const templateId = '55555555-5555-4555-8555-555555555555';

const mockSession = {
  id: 'user-1',
  email: 'user@example.com',
  firstName: 'Test',
  lastName: 'User',
  tenantId: workspaceId,
  isSuperAdmin: true,
  isWorkspaceAdmin: true,
  hasAllCompaniesAccess: true,
  companyIds: [],
};

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/rbac', () => ({
  requirePermission: vi.fn(),
}));

vi.mock('@/services/document-generation-batch', () => ({
  createDocumentGenerationBatch: vi.fn(),
  listDocumentGenerationBatches: vi.fn(),
  getDocumentGenerationBatch: vi.fn(),
  updateDocumentGenerationBatch: vi.fn(),
  discardDocumentGenerationBatch: vi.fn(),
  previewDocumentGenerationBatchItem: vi.fn(),
  reviewDocumentGenerationBatchItem: vi.fn(),
  preflightDocumentGenerationBatch: vi.fn(),
  generateDocumentGenerationBatch: vi.fn(),
  retryDocumentGenerationBatchItem: vi.fn(),
}));

vi.mock('@/services/tasks/integration.service', () => ({
  parseTaskLaunchContext: vi.fn(() => undefined),
  preflightTaskLaunchContext: vi.fn(),
}));

import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import * as batchService from '@/services/document-generation-batch';
import { ConflictError, NotFoundError, UnprocessableEntityError } from '@/lib/errors';
import { GET as listBatches, POST as createBatch } from '@/app/api/document-generation-batches/route';
import {
  GET as getBatch,
  PUT as updateBatch,
  DELETE as discardBatch,
} from '@/app/api/document-generation-batches/[id]/route';
import { POST as preflightBatch } from '@/app/api/document-generation-batches/[id]/preflight/route';
import { POST as generateBatch } from '@/app/api/document-generation-batches/[id]/generate/route';
import { POST as previewItem } from '@/app/api/document-generation-batches/[id]/items/[itemId]/preview/route';
import { POST as reviewItem } from '@/app/api/document-generation-batches/[id]/items/[itemId]/review/route';
import { POST as retryItem } from '@/app/api/document-generation-batches/[id]/items/[itemId]/retry/route';

function request(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(url, init);
}

function routeParams(id = batchId) {
  return { params: Promise.resolve({ id }) };
}

function itemParams(id = batchId, item = itemId) {
  return { params: Promise.resolve({ id, itemId: item }) };
}

const validCreatePayload = {
  items: [{ templateId }],
};

describe('document generation batch routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue(mockSession);
    vi.mocked(requirePermission).mockResolvedValue(undefined);
    vi.mocked(batchService.listDocumentGenerationBatches).mockResolvedValue([]);
    vi.mocked(batchService.createDocumentGenerationBatch).mockResolvedValue({
      id: batchId,
      items: [],
      revision: 0,
    } as never);
    vi.mocked(batchService.getDocumentGenerationBatch).mockResolvedValue({
      id: batchId,
      items: [],
      revision: 0,
    } as never);
  });

  it('rejects client-owned tenant IDs and never forwards them', async () => {
    const response = await createBatch(request('http://localhost/api/document-generation-batches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...validCreatePayload, tenantId: attackerTenant }),
    }));

    expect(response.status).toBe(400);
    expect(batchService.createDocumentGenerationBatch).not.toHaveBeenCalled();
  });

  it('creates batches with the session workspace', async () => {
    const response = await createBatch(request('http://localhost/api/document-generation-batches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validCreatePayload),
    }));

    expect(response.status).toBe(201);
    expect(batchService.createDocumentGenerationBatch).toHaveBeenCalledWith(
      validCreatePayload,
      { tenantId: workspaceId, userId: mockSession.id },
    );
  });

  it('lists active batches with document read permission', async () => {
    const response = await listBatches();

    expect(response.status).toBe(200);
    expect(requirePermission).toHaveBeenCalledWith(mockSession, 'document', 'read');
    expect(batchService.listDocumentGenerationBatches).toHaveBeenCalledWith({
      tenantId: workspaceId,
      userId: mockSession.id,
    });
  });

  it('returns conflict details from a stale PUT', async () => {
    vi.mocked(batchService.updateDocumentGenerationBatch).mockRejectedValue(
      new ConflictError('Batch changed', { currentRevision: 8 }),
    );
    const response = await updateBatch(
      request('http://localhost/api/document-generation-batches/batch-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedRevision: 7,
          items: [{ templateId }],
        }),
      }),
      routeParams(),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ details: { currentRevision: 8 } });
  });

  it('returns 422 item diagnostics from preflight', async () => {
    const diagnostics = {
      items: [{
        itemId,
        status: 'NEEDS_INPUT',
        errors: ['Document has not been reviewed'],
        fieldErrors: [],
      }],
    };
    vi.mocked(batchService.preflightDocumentGenerationBatch).mockRejectedValue(
      new UnprocessableEntityError('Batch is not ready', diagnostics),
    );
    const response = await preflightBatch(
      request('http://localhost/api/document-generation-batches/batch-1/preflight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRevision: 3 }),
      }),
      routeParams(),
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ details: diagnostics });
  });

  it('returns safe 404 responses for missing batches without leaking tenant state', async () => {
    vi.mocked(batchService.getDocumentGenerationBatch).mockRejectedValue(
      new NotFoundError('Document generation batch not found'),
    );
    const response = await getBatch(
      request('http://localhost/api/document-generation-batches/batch-1'),
      routeParams(),
    );

    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe('Document generation batch not found');
  });

  it('requires create and update permissions for generate', async () => {
    await generateBatch(
      request('http://localhost/api/document-generation-batches/batch-1/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRevision: 1 }),
      }),
      routeParams(),
    );

    expect(requirePermission).toHaveBeenCalledWith(mockSession, 'document', 'create');
    expect(requirePermission).toHaveBeenCalledWith(mockSession, 'document', 'update');
    expect(batchService.generateDocumentGenerationBatch).toHaveBeenCalledWith(
      batchId,
      { expectedRevision: 1 },
      { tenantId: workspaceId, userId: mockSession.id },
    );
  });

  it('routes preview, review, and retry to the item endpoints', async () => {
    await previewItem(
      request(`http://localhost/api/document-generation-batches/batch-1/items/item-1/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRevision: 1, replaceEditedContent: true }),
      }),
      itemParams(),
    );
    expect(batchService.previewDocumentGenerationBatchItem).toHaveBeenCalledWith(
      batchId,
      itemId,
      { expectedRevision: 1, replaceEditedContent: true },
      { tenantId: workspaceId, userId: mockSession.id },
    );

    await reviewItem(
      request(`http://localhost/api/document-generation-batches/batch-1/items/item-1/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRevision: 1 }),
      }),
      itemParams(),
    );
    expect(batchService.reviewDocumentGenerationBatchItem).toHaveBeenCalledWith(
      batchId,
      itemId,
      { expectedRevision: 1 },
      { tenantId: workspaceId, userId: mockSession.id },
    );

    await retryItem(
      request(`http://localhost/api/document-generation-batches/batch-1/items/item-1/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRevision: 2 }),
      }),
      itemParams(),
    );
    expect(batchService.retryDocumentGenerationBatchItem).toHaveBeenCalledWith(
      batchId,
      itemId,
      { expectedRevision: 2 },
      { tenantId: workspaceId, userId: mockSession.id },
    );
  });

  it('discards with document delete permission', async () => {
    vi.mocked(batchService.discardDocumentGenerationBatch).mockResolvedValue({
      discardedItemCount: 2,
      preservedItemCount: 1,
    });
    const response = await discardBatch(
      request('http://localhost/api/document-generation-batches/batch-1', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRevision: 1 }),
      }),
      routeParams(),
    );

    expect(response.status).toBe(200);
    expect(requirePermission).toHaveBeenCalledWith(mockSession, 'document', 'delete');
    expect(await response.json()).toEqual({
      discardedItemCount: 2,
      preservedItemCount: 1,
    });
  });

  it('returns 400 when the session has no workspace context', async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ...mockSession, tenantId: null });
    const response = await listBatches();
    expect(response.status).toBe(400);
    expect(batchService.listDocumentGenerationBatches).not.toHaveBeenCalled();
  });
});
