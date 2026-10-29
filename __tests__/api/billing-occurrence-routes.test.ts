import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { NotFoundError } from '@/lib/errors';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requirePermission: vi.fn(),
  requireServicesWorkspaceEnabled: vi.fn(),
  getCompanyReadScope: vi.fn(),
  listBillingOccurrences: vi.fn(),
  getBillingOccurrence: vi.fn(),
  updateBillingOccurrence: vi.fn(),
  resetBillingOverride: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: mocks.requireAuth }));
vi.mock('@/lib/rbac', () => ({ requirePermission: mocks.requirePermission }));
vi.mock('@/services/schedule-reconciliation', () => ({ requireServicesWorkspaceEnabled: mocks.requireServicesWorkspaceEnabled }));
vi.mock('@/lib/api/company-query', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/company-query')>('@/lib/api/company-query');
  return { ...actual, getCompanyReadScope: mocks.getCompanyReadScope };
});
vi.mock('@/services/billing', () => ({
  listBillingOccurrences: mocks.listBillingOccurrences,
  getBillingOccurrence: mocks.getBillingOccurrence,
  updateBillingOccurrence: mocks.updateBillingOccurrence,
  resetBillingOverride: mocks.resetBillingOverride,
}));

import { GET as listGET } from '@/app/api/billing-occurrences/route';
import { GET as detailGET, PATCH as detailPATCH } from '@/app/api/billing-occurrences/[id]/route';
import { POST as resetPOST } from '@/app/api/billing-occurrences/[id]/reset-override/route';

const tenantId = '11111111-1111-4111-8111-111111111111';
const companyId = '22222222-2222-4222-8222-222222222222';
const occurrenceId = '33333333-3333-4333-8333-333333333333';
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
const occurrence = {
  id: occurrenceId,
  tenantId,
  companyId,
  status: 'OPEN',
  updatedAt: '2026-08-10T00:00:00.000Z',
};

describe('billing occurrence routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue(session);
    mocks.requirePermission.mockResolvedValue(undefined);
    mocks.requireServicesWorkspaceEnabled.mockResolvedValue(undefined);
    mocks.getCompanyReadScope.mockReturnValue({ tenantId, options: { companyIds: [companyId] } });
    mocks.listBillingOccurrences.mockResolvedValue({ mode: 'TABLE', items: [], total: 0, page: 1, limit: 50, totalPages: 0 });
    mocks.getBillingOccurrence.mockResolvedValue(occurrence);
    mocks.updateBillingOccurrence.mockResolvedValue(occurrence);
    mocks.resetBillingOverride.mockResolvedValue(occurrence);
  });

  it('requires company:read and sends the accessible-company scope to list service', async () => {
    const response = await listGET(new NextRequest('http://localhost/api/billing-occurrences?from=2026-08-01&to=2026-08-31'));

    expect(response.status).toBe(200);
    expect(mocks.requirePermission).toHaveBeenCalledWith(session, 'company', 'read');
    expect(mocks.requireServicesWorkspaceEnabled).toHaveBeenCalledWith(tenantId);
    expect(mocks.getCompanyReadScope).toHaveBeenCalledWith(session);
    expect(mocks.listBillingOccurrences).toHaveBeenCalledWith(expect.objectContaining({ from: '2026-08-01', to: '2026-08-31' }), {
      tenantId,
      companyIds: [companyId],
    });
  });

  it('allows the billing list to be requested without a date range', async () => {
    const response = await listGET(new NextRequest('http://localhost/api/billing-occurrences?page=2&limit=20'));

    expect(response.status).toBe(200);
    const search = mocks.listBillingOccurrences.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(search).toMatchObject({ page: 2, limit: 20 });
    expect(search).not.toHaveProperty('from');
    expect(search).not.toHaveProperty('to');
    expect(mocks.listBillingOccurrences).toHaveBeenCalledWith(expect.objectContaining({ page: 2, limit: 20 }), {
      tenantId,
      companyIds: [companyId],
    });
  });

  it('rejects unknown and duplicate list query keys before service access', async () => {
    const unknown = await listGET(new NextRequest('http://localhost/api/billing-occurrences?from=2026-08-01&to=2026-08-31&bad=value'));
    expect(unknown.status).toBe(400);
    expect(mocks.listBillingOccurrences).not.toHaveBeenCalled();

    const duplicate = await listGET(new NextRequest('http://localhost/api/billing-occurrences?from=2026-08-01&from=2026-08-02&to=2026-08-31'));
    expect(duplicate.status).toBe(400);
    expect(mocks.listBillingOccurrences).not.toHaveBeenCalled();
  });

  it('loads the row before requiring company:update for lifecycle mutation', async () => {
    const response = await detailPATCH(
      new NextRequest(`http://localhost/api/billing-occurrences/${occurrenceId}`, {
        method: 'PATCH',
        body: JSON.stringify({ expectedUpdatedAt: occurrence.updatedAt, status: 'BILLED', billedDate: null, updateScope: 'THIS_OCCURRENCE', reason: null }),
      }),
      { params: Promise.resolve({ id: occurrenceId }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.getBillingOccurrence).toHaveBeenCalledWith(occurrenceId, { tenantId, userId: session.id, companyIds: [companyId] });
    expect(mocks.requirePermission).toHaveBeenCalledWith(session, 'company', 'update', companyId);
    expect(mocks.updateBillingOccurrence).toHaveBeenCalledWith(occurrenceId, expect.objectContaining({ status: 'BILLED' }), { tenantId, userId: session.id, companyIds: [companyId] });
  });

  it('blocks lifecycle mutations when the Services workspace is disabled', async () => {
    mocks.requireServicesWorkspaceEnabled.mockRejectedValueOnce(new NotFoundError('Services workspace is disabled'));

    const response = await detailPATCH(
      new NextRequest(`http://localhost/api/billing-occurrences/${occurrenceId}`, {
        method: 'PATCH',
        body: JSON.stringify({ expectedUpdatedAt: occurrence.updatedAt, status: 'BILLED', billedDate: null, updateScope: 'THIS_OCCURRENCE', reason: null }),
      }),
      { params: Promise.resolve({ id: occurrenceId }) },
    );

    expect(response.status).toBe(404);
    expect(mocks.getBillingOccurrence).not.toHaveBeenCalled();
    expect(mocks.updateBillingOccurrence).not.toHaveBeenCalled();
  });

  it('returns a safe not-found response when lifecycle permission is denied', async () => {
    mocks.requirePermission.mockRejectedValueOnce(new Error('Permission denied for company'));

    const response = await detailPATCH(
      new NextRequest(`http://localhost/api/billing-occurrences/${occurrenceId}`, {
        method: 'PATCH',
        body: JSON.stringify({ expectedUpdatedAt: occurrence.updatedAt, status: 'BILLED', billedDate: null, updateScope: 'THIS_OCCURRENCE', reason: null }),
      }),
      { params: Promise.resolve({ id: occurrenceId }) },
    );

    expect(response.status).toBe(404);
    expect(mocks.updateBillingOccurrence).not.toHaveBeenCalled();
  });

  it('checks company:update for override reset', async () => {
    const response = await resetPOST(
      new NextRequest(`http://localhost/api/billing-occurrences/${occurrenceId}/reset-override`, {
        method: 'POST',
        body: JSON.stringify({ expectedUpdatedAt: occurrence.updatedAt, target: 'ALL', reason: 'Revert manual values' }),
      }),
      { params: Promise.resolve({ id: occurrenceId }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.requirePermission).toHaveBeenCalledWith(session, 'company', 'update', companyId);
    expect(mocks.resetBillingOverride).toHaveBeenCalledWith(occurrenceId, expect.objectContaining({ target: 'ALL' }), { tenantId, userId: session.id, companyIds: [companyId] });
  });

  it('blocks override reset when the Services workspace is disabled', async () => {
    mocks.requireServicesWorkspaceEnabled.mockRejectedValueOnce(new NotFoundError('Services workspace is disabled'));

    const response = await resetPOST(
      new NextRequest(`http://localhost/api/billing-occurrences/${occurrenceId}/reset-override`, {
        method: 'POST',
        body: JSON.stringify({ expectedUpdatedAt: occurrence.updatedAt, target: 'ALL', reason: 'Revert manual values' }),
      }),
      { params: Promise.resolve({ id: occurrenceId }) },
    );

    expect(response.status).toBe(404);
    expect(mocks.getBillingOccurrence).not.toHaveBeenCalled();
    expect(mocks.resetBillingOverride).not.toHaveBeenCalled();
  });

  it('returns a safe not-found response when override reset permission is denied', async () => {
    mocks.requirePermission.mockRejectedValueOnce(new Error('Permission denied for company'));

    const response = await resetPOST(
      new NextRequest(`http://localhost/api/billing-occurrences/${occurrenceId}/reset-override`, {
        method: 'POST',
        body: JSON.stringify({ expectedUpdatedAt: occurrence.updatedAt, target: 'ALL', reason: 'Revert manual values' }),
      }),
      { params: Promise.resolve({ id: occurrenceId }) },
    );

    expect(response.status).toBe(404);
    expect(mocks.resetBillingOverride).not.toHaveBeenCalled();
  });

  it('returns tenant-scoped detail only after company:read', async () => {
    const response = await detailGET(new NextRequest(`http://localhost/api/billing-occurrences/${occurrenceId}`), {
      params: Promise.resolve({ id: occurrenceId }),
    });

    expect(response.status).toBe(200);
    expect(mocks.requirePermission).toHaveBeenCalledWith(session, 'company', 'read', companyId);
  });

  it('uses the same 404 for an inaccessible existing detail and a missing detail', async () => {
    mocks.getBillingOccurrence.mockResolvedValueOnce({ ...occurrence, companyId: '44444444-4444-4444-8444-444444444444' });
    mocks.requirePermission.mockRejectedValueOnce(new Error('Permission denied for company'));
    const inaccessible = await detailGET(new NextRequest(`http://localhost/api/billing-occurrences/${occurrenceId}`), { params: Promise.resolve({ id: occurrenceId }) });
    mocks.getBillingOccurrence.mockRejectedValueOnce(new NotFoundError('Billing occurrence not found'));
    const missing = await detailGET(new NextRequest(`http://localhost/api/billing-occurrences/${occurrenceId}`), { params: Promise.resolve({ id: occurrenceId }) });

    expect(inaccessible.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await inaccessible.json()).toEqual(await missing.json());
  });
});
