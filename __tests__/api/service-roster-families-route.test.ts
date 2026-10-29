import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { NotFoundError } from '@/lib/errors';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requirePermission: vi.fn(),
  requireServicesWorkspaceEnabled: vi.fn(),
  getCompanyReadScope: vi.fn(),
  listServiceRosterFamilies: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: mocks.requireAuth }));
vi.mock('@/lib/rbac', () => ({ requirePermission: mocks.requirePermission }));
vi.mock('@/services/schedule-reconciliation', () => ({ requireServicesWorkspaceEnabled: mocks.requireServicesWorkspaceEnabled }));
vi.mock('@/lib/api/company-query', () => ({ getCompanyReadScope: mocks.getCompanyReadScope }));
vi.mock('@/services/service-roster', () => ({ listServiceRosterFamilies: mocks.listServiceRosterFamilies }));

import { GET } from '@/app/api/client-services/families/route';

const tenantId = '11111111-1111-4111-8111-111111111111';
const companyId = '22222222-2222-4222-8222-222222222222';
const session = {
  id: 'user-1',
  email: 'user@example.com',
  firstName: 'Test',
  lastName: 'User',
  tenantId,
  isSuperAdmin: false,
  isWorkspaceAdmin: false,
  hasAllCompaniesAccess: false,
  companyIds: [companyId],
};

describe('GET /api/client-services/families', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue(session);
    mocks.requirePermission.mockResolvedValue(undefined);
    mocks.requireServicesWorkspaceEnabled.mockResolvedValue(undefined);
    mocks.getCompanyReadScope.mockReturnValue({ tenantId, options: { companyIds: [companyId] } });
    mocks.listServiceRosterFamilies.mockResolvedValue([
      { id: '33333333-3333-4333-8333-333333333333', name: 'Accounting', displayColor: '#3F6DA8' },
    ]);
  });

  it('returns complete family facets from the authenticated access scope', async () => {
    const response = await GET(new NextRequest('http://localhost/api/client-services/families'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      families: [{ id: '33333333-3333-4333-8333-333333333333', name: 'Accounting', displayColor: '#3F6DA8' }],
    });
    expect(mocks.requirePermission).toHaveBeenCalledWith(session, 'company', 'read');
    expect(mocks.requireServicesWorkspaceEnabled).toHaveBeenCalledWith(tenantId);
    expect(mocks.listServiceRosterFamilies).toHaveBeenCalledWith({ tenantId, companyIds: [companyId] });
  });

  it('does not query family data for an empty access scope', async () => {
    mocks.getCompanyReadScope.mockReturnValue({ empty: true });

    const response = await GET(new NextRequest('http://localhost/api/client-services/families'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ families: [] });
    expect(mocks.listServiceRosterFamilies).not.toHaveBeenCalled();
  });

  it('preserves the typed disabled-workspace 404 response', async () => {
    mocks.requireServicesWorkspaceEnabled.mockRejectedValue(new NotFoundError('Services workspace is not enabled'));

    const response = await GET(new NextRequest('http://localhost/api/client-services/families'));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: 'Services workspace is not enabled',
      code: 'NOT_FOUND',
    });
  });
});
