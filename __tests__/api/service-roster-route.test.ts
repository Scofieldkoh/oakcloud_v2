import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requirePermission: vi.fn(),
  requireServicesWorkspaceEnabled: vi.fn(),
  getCompanyReadScope: vi.fn(),
  listServiceRoster: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: mocks.requireAuth }));
vi.mock('@/lib/rbac', () => ({ requirePermission: mocks.requirePermission }));
vi.mock('@/services/schedule-reconciliation', () => ({ requireServicesWorkspaceEnabled: mocks.requireServicesWorkspaceEnabled }));
vi.mock('@/lib/api/company-query', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/company-query')>('@/lib/api/company-query');
  return { ...actual, getCompanyReadScope: mocks.getCompanyReadScope };
});
vi.mock('@/services/service-roster', () => ({ listServiceRoster: mocks.listServiceRoster }));

import { GET } from '@/app/api/client-services/route';

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

describe('GET /api/client-services', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue(session);
    mocks.requirePermission.mockResolvedValue(undefined);
    mocks.requireServicesWorkspaceEnabled.mockResolvedValue(undefined);
    mocks.getCompanyReadScope.mockReturnValue({ tenantId, options: { companyIds: [companyId] } });
    mocks.listServiceRoster.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20, totalPages: 0 });
  });

  it('authenticates, checks company read, enables the workspace, and passes the derived scope', async () => {
    const response = await GET(new NextRequest('http://localhost/api/client-services?statuses=ACTIVE,PAUSED&familyIds=33333333-3333-4333-8333-333333333333,33333333-3333-4333-8333-333333333333&companyQuery=Oaktree&familyQuery=Accounting&serviceQuery=Annual'));

    expect(response.status).toBe(200);
    expect(mocks.requirePermission).toHaveBeenCalledWith(session, 'company', 'read');
    expect(mocks.requireServicesWorkspaceEnabled).toHaveBeenCalledWith(tenantId);
    expect(mocks.getCompanyReadScope).toHaveBeenCalledWith(session);
    expect(mocks.listServiceRoster).toHaveBeenCalledWith(
      expect.objectContaining({
        statuses: ['ACTIVE', 'PAUSED'],
        familyIds: ['33333333-3333-4333-8333-333333333333'],
        companyQuery: 'Oaktree',
        familyQuery: 'Accounting',
        serviceQuery: 'Annual',
      }),
      { tenantId, companyIds: [companyId] },
    );
  });

  it('returns an empty page and does not invoke the roster query for an empty scope', async () => {
    mocks.getCompanyReadScope.mockReturnValue({ empty: true });

    const response = await GET(new NextRequest('http://localhost/api/client-services?page=2&limit=5'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ items: [], total: 0, page: 2, limit: 5, totalPages: 0 });
    expect(mocks.listServiceRoster).not.toHaveBeenCalled();
  });

  it('treats an explicitly empty company-id scope as empty without a broad query', async () => {
    mocks.getCompanyReadScope.mockReturnValue({ tenantId, options: { companyIds: [] } });

    const response = await GET(new NextRequest('http://localhost/api/client-services'));

    expect(response.status).toBe(200);
    expect(mocks.listServiceRoster).not.toHaveBeenCalled();
  });

  it('preserves an explicitly empty status filter end to end', async () => {
    const response = await GET(new NextRequest('http://localhost/api/client-services?statuses='));

    expect(response.status).toBe(200);
    expect(mocks.listServiceRoster).toHaveBeenCalledWith(
      expect.objectContaining({ statuses: [] }),
      { tenantId, companyIds: [companyId] },
    );
  });

  it.each([
    'unknown=value',
    'page=1&page=2',
    'companyId=not-a-uuid',
    'statuses=ACTIVE,BOGUS',
    'archived=yes',
  ])('rejects malformed or ambiguous query strings (%s) with a structured validation error', async (query) => {
    const response = await GET(new NextRequest(`http://localhost/api/client-services?${query}`));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(mocks.listServiceRoster).not.toHaveBeenCalled();
  });

  it('does not leak service data when permission or workspace checks fail', async () => {
    mocks.requirePermission.mockRejectedValue(new Error('Forbidden'));
    const response = await GET(new NextRequest('http://localhost/api/client-services'));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'Forbidden' });
    expect(mocks.listServiceRoster).not.toHaveBeenCalled();
  });

  it('sanitizes unexpected roster failures', async () => {
    mocks.listServiceRoster.mockRejectedValue(new Error('database password leaked'));

    const response = await GET(new NextRequest('http://localhost/api/client-services'));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Internal server error' });
    expect(JSON.stringify(body)).not.toContain('database password leaked');
  });
});
