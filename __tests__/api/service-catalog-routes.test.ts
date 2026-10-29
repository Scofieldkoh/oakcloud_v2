import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '@/lib/errors';

const session = {
  id: 'user-1',
  tenantId: 'tenant-1',
  isSuperAdmin: false,
  isWorkspaceAdmin: true,
};

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requireServiceAdministrator: vi.fn(),
  requirePermission: vi.fn(),
  requireSessionWorkspaceId: vi.fn(),
  resolveWorkspaceId: vi.fn(),
  listServiceCatalog: vi.fn(),
  getSelectableServiceVariants: vi.fn(),
  getServiceVariant: vi.fn(),
  createServiceFamily: vi.fn(),
  updateServiceFamily: vi.fn(),
  archiveServiceFamily: vi.fn(),
  createServiceVariant: vi.fn(),
  updateServiceVariant: vi.fn(),
  archiveServiceVariant: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: mocks.requireAuth }));
vi.mock('@/lib/service-administration-auth', () => ({
  requireServiceAdministrator: mocks.requireServiceAdministrator,
}));
vi.mock('@/lib/rbac', () => ({ requirePermission: mocks.requirePermission }));
vi.mock('@/lib/api-helpers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-helpers')>()),
  requireSessionWorkspaceId: mocks.requireSessionWorkspaceId,
  resolveWorkspaceId: mocks.resolveWorkspaceId,
}));
vi.mock('@/services/service-catalog', () => ({
  listServiceCatalog: mocks.listServiceCatalog,
  getSelectableServiceVariants: mocks.getSelectableServiceVariants,
  getServiceVariant: mocks.getServiceVariant,
  createServiceFamily: mocks.createServiceFamily,
  updateServiceFamily: mocks.updateServiceFamily,
  archiveServiceFamily: mocks.archiveServiceFamily,
  createServiceVariant: mocks.createServiceVariant,
  updateServiceVariant: mocks.updateServiceVariant,
  archiveServiceVariant: mocks.archiveServiceVariant,
}));

import { GET as getCatalog } from '@/app/api/service-catalog/route';
import { POST as createFamily } from '@/app/api/service-catalog/families/route';
import {
  DELETE as archiveFamily,
  PATCH as updateFamily,
} from '@/app/api/service-catalog/families/[id]/route';
import { POST as createVariant } from '@/app/api/service-catalog/variants/route';
import {
  DELETE as archiveVariant,
  GET as getVariant,
  PATCH as updateVariant,
} from '@/app/api/service-catalog/variants/[id]/route';

describe('service catalog routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue(session);
    mocks.requireSessionWorkspaceId.mockReturnValue(session.tenantId);
    mocks.resolveWorkspaceId.mockReturnValue(session.tenantId);
    mocks.getSelectableServiceVariants.mockResolvedValue([]);
  });

  it('uses session workspace and document permissions for selectable reads', async () => {
    const response = await getCatalog(
      new NextRequest('http://localhost/api/service-catalog?selectable=true'),
    );

    expect(mocks.requirePermission).toHaveBeenCalledWith(session, 'document', 'read');
    expect(mocks.requireServiceAdministrator).not.toHaveBeenCalled();
    expect(mocks.requireSessionWorkspaceId).toHaveBeenCalledWith(session);
    expect(mocks.getSelectableServiceVariants).toHaveBeenCalledWith(session.tenantId);
    expect(response.status).toBe(200);
  });

  it('uses the setup workspace resolver for paginated catalog reads', async () => {
    mocks.listServiceCatalog.mockResolvedValue({ families: [], total: 0 });
    const response = await getCatalog(
      new NextRequest(
        'http://localhost/api/service-catalog?tenantId=tenant-2&page=2&limit=20',
      ),
    );

    expect(mocks.requireServiceAdministrator).toHaveBeenCalledWith(session);
    expect(mocks.requirePermission).not.toHaveBeenCalled();
    expect(mocks.resolveWorkspaceId).toHaveBeenCalledWith(session, 'tenant-2');
    expect(mocks.listServiceCatalog).toHaveBeenCalledWith(
      expect.objectContaining({ page: 2, limit: 20 }),
      { tenantId: session.tenantId, userId: session.id },
    );
    expect(response.status).toBe(200);
  });

  it('returns 400 for invalid family payloads', async () => {
    const response = await createFamily(
      new NextRequest('http://localhost/api/service-catalog/families', {
        method: 'POST',
        body: JSON.stringify({ code: '123 invalid', name: '' }),
        headers: { 'content-type': 'application/json' },
      }),
    );

    expect(mocks.requireServiceAdministrator).toHaveBeenCalledWith(session);
    expect(mocks.requirePermission).not.toHaveBeenCalled();
    expect(mocks.createServiceFamily).not.toHaveBeenCalled();
    expect(response.status).toBe(400);
  });

  it('returns 409 for duplicate codes', async () => {
    mocks.createServiceFamily.mockRejectedValue(
      new ConflictError('A service family with this code already exists'),
    );
    const response = await createFamily(
      new NextRequest('http://localhost/api/service-catalog/families', {
        method: 'POST',
        body: JSON.stringify({ code: 'CORP-SEC', name: 'Corporate Secretarial' }),
        headers: { 'content-type': 'application/json' },
      }),
    );

    expect(response.status).toBe(409);
  });

  it('returns 404 when an update is outside the active tenant', async () => {
    mocks.updateServiceFamily.mockRejectedValue(new NotFoundError('Service family not found'));
    const response = await updateFamily(
      new NextRequest('http://localhost/api/service-catalog/families/family-2', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Other tenant family' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'family-2' }) },
    );

    expect(mocks.requireServiceAdministrator).toHaveBeenCalledWith(session);
    expect(mocks.requirePermission).not.toHaveBeenCalled();
    expect(response.status).toBe(404);
  });

  it('creates a validated variant as a service administrator', async () => {
    mocks.createServiceVariant.mockResolvedValue({ id: 'variant-1' });
    const response = await createVariant(
      new NextRequest('http://localhost/api/service-catalog/variants', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          familyId: '11111111-1111-4111-8111-111111111111',
          sowPartialId: '22222222-2222-4222-8222-222222222222',
          code: 'MONTHLY_ACCOUNTING',
          name: 'Monthly Accounting',
          serviceCadence: 'MONTHLY',
          feeTemplates: [],
        }),
      }),
    );

    expect(mocks.requireServiceAdministrator).toHaveBeenCalledWith(session);
    expect(mocks.requirePermission).not.toHaveBeenCalled();
    expect(mocks.createServiceVariant).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'MONTHLY_ACCOUNTING' }),
      { tenantId: session.tenantId, userId: session.id },
    );
    expect(response.status).toBe(201);
  });

  it('rejects invalid variant input before calling the service', async () => {
    const response = await createVariant(
      new NextRequest('http://localhost/api/service-catalog/variants', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          familyId: 'not-a-uuid',
          code: 'INVALID',
          name: '',
        }),
      }),
    );

    expect(mocks.createServiceVariant).not.toHaveBeenCalled();
    expect(response.status).toBe(400);
  });

  it('reads and updates variants as a service administrator', async () => {
    mocks.getServiceVariant.mockResolvedValue({ id: 'variant-1' });
    mocks.updateServiceVariant.mockResolvedValue({ id: 'variant-1', name: 'Updated' });

    const getResponse = await getVariant(
      new NextRequest('http://localhost/api/service-catalog/variants/variant-1'),
      { params: Promise.resolve({ id: 'variant-1' }) },
    );
    const patchResponse = await updateVariant(
      new NextRequest('http://localhost/api/service-catalog/variants/variant-1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Updated' }),
      }),
      { params: Promise.resolve({ id: 'variant-1' }) },
    );

    expect(mocks.requireServiceAdministrator).toHaveBeenCalledTimes(2);
    expect(mocks.requireServiceAdministrator).toHaveBeenCalledWith(session);
    expect(mocks.requirePermission).not.toHaveBeenCalled();
    expect(getResponse.status).toBe(200);
    expect(patchResponse.status).toBe(200);
  });

  it('archives a family as a service administrator with a reason', async () => {
    mocks.archiveServiceFamily.mockResolvedValue({ id: 'family-1', archived: true });
    const response = await archiveFamily(
      new NextRequest(
        'http://localhost/api/service-catalog/families/family-1?reason=Consolidated',
        { method: 'DELETE' },
      ),
      { params: Promise.resolve({ id: 'family-1' }) },
    );

    expect(mocks.requireServiceAdministrator).toHaveBeenCalledWith(session);
    expect(mocks.requirePermission).not.toHaveBeenCalled();
    expect(mocks.archiveServiceFamily).toHaveBeenCalledWith(
      'family-1',
      'Consolidated',
      { tenantId: session.tenantId, userId: session.id },
    );
    expect(response.status).toBe(200);
  });

  it('requires delete permission and an explicit archive reason', async () => {
    mocks.archiveServiceVariant.mockResolvedValue({ id: 'variant-1', archived: true });
    const response = await archiveVariant(
      new NextRequest(
        'http://localhost/api/service-catalog/variants/variant-1?reason=No%20longer%20offered',
        { method: 'DELETE' },
      ),
      { params: Promise.resolve({ id: 'variant-1' }) },
    );

    expect(mocks.requireServiceAdministrator).toHaveBeenCalledWith(session);
    expect(mocks.requirePermission).not.toHaveBeenCalled();
    expect(mocks.archiveServiceVariant).toHaveBeenCalledWith(
      'variant-1',
      'No longer offered',
      { tenantId: session.tenantId, userId: session.id },
    );
    expect(response.status).toBe(200);
  });

  it('returns 403 and skips the service for non-administrator users', async () => {
    const nonAdminSession = {
      ...session,
      isSuperAdmin: false,
      isWorkspaceAdmin: false,
    };
    mocks.requireAuth.mockResolvedValueOnce(nonAdminSession);
    mocks.requireServiceAdministrator.mockImplementationOnce(() => {
      throw new ForbiddenError('Service administration requires Tenant Admin access');
    });

    const response = await createFamily(
      new NextRequest('http://localhost/api/service-catalog/families', {
        method: 'POST',
        body: JSON.stringify({ code: 'CORP-SEC', name: 'Corporate Secretarial' }),
        headers: { 'content-type': 'application/json' },
      }),
    );

    expect(response.status).toBe(403);
    expect(mocks.requireServiceAdministrator).toHaveBeenCalledWith(nonAdminSession);
    expect(mocks.createServiceFamily).not.toHaveBeenCalled();
  });

  it('rejects an administrator when no workspace can be resolved', async () => {
    const sessionWithoutWorkspace = { ...session, tenantId: null };
    mocks.requireAuth.mockResolvedValueOnce(sessionWithoutWorkspace);
    mocks.resolveWorkspaceId.mockImplementationOnce(() => {
      throw new BadRequestError('Workspace context required');
    });

    const response = await createFamily(
      new NextRequest('http://localhost/api/service-catalog/families', {
        method: 'POST',
        body: JSON.stringify({ code: 'CORP-SEC', name: 'Corporate Secretarial' }),
        headers: { 'content-type': 'application/json' },
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.requireServiceAdministrator).toHaveBeenCalledWith(sessionWithoutWorkspace);
    expect(mocks.createServiceFamily).not.toHaveBeenCalled();
  });

  it('keeps selectable reads behind document read authorization', async () => {
    mocks.requirePermission.mockImplementationOnce(() => {
      throw new ForbiddenError('Permission denied');
    });

    const response = await getCatalog(
      new NextRequest('http://localhost/api/service-catalog?selectable=true'),
    );

    expect(response.status).toBe(403);
    expect(mocks.requirePermission).toHaveBeenCalledWith(session, 'document', 'read');
    expect(mocks.requireServiceAdministrator).not.toHaveBeenCalled();
    expect(mocks.getSelectableServiceVariants).not.toHaveBeenCalled();
  });
});
