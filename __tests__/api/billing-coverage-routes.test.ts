import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requirePermission: vi.fn(),
  requireServicesWorkspaceEnabled: vi.fn(),
  getCompanyReadScope: vi.fn(),
  listBillingCoverage: vi.fn(),
  getClientService: vi.fn(),
  enqueueScheduleReconciliation: vi.fn(),
  processScheduleReconciliationBatch: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: mocks.requireAuth }));
vi.mock('@/lib/rbac', () => ({ requirePermission: mocks.requirePermission }));
vi.mock('@/services/schedule-reconciliation', () => ({
  requireServicesWorkspaceEnabled: mocks.requireServicesWorkspaceEnabled,
  enqueueScheduleReconciliation: mocks.enqueueScheduleReconciliation,
  processScheduleReconciliationBatch: mocks.processScheduleReconciliationBatch,
}));
vi.mock('@/lib/api/company-query', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/company-query')>('@/lib/api/company-query');
  return { ...actual, getCompanyReadScope: mocks.getCompanyReadScope };
});
vi.mock('@/services/billing', () => ({ listBillingCoverage: mocks.listBillingCoverage }));
vi.mock('@/services/client-service', () => ({ getClientService: mocks.getClientService }));
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: mocks.transaction } }));

import { GET } from '@/app/api/billing-coverage/route';
import { POST } from '@/app/api/client-services/[id]/billing/reconcile/route';

const tenantId = '11111111-1111-4111-8111-111111111111';
const companyId = '22222222-2222-4222-8222-222222222222';
const serviceId = '33333333-3333-4333-8333-333333333333';
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

describe('billing coverage routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue(session);
    mocks.requirePermission.mockResolvedValue(undefined);
    mocks.requireServicesWorkspaceEnabled.mockResolvedValue(undefined);
    mocks.getCompanyReadScope.mockReturnValue({ tenantId, options: { companyIds: [companyId] } });
    mocks.listBillingCoverage.mockResolvedValue({
      openIssueCount: 0,
      affectedServiceCount: 0,
      healthyActiveServiceCount: 1,
      issues: [],
    });
    mocks.getClientService.mockResolvedValue({ id: serviceId, companyId });
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({}));
    mocks.enqueueScheduleReconciliation.mockResolvedValue({ id: 'request-1', dedupeKey: 'dedupe-1' });
    mocks.processScheduleReconciliationBatch.mockResolvedValue({ claimed: 1, completed: 1, failed: 0, leaseLost: 0, summaries: [] });
  });

  it('requires company:read and passes the SQL access scope to the summary query', async () => {
    const response = await GET(new NextRequest('http://localhost/api/billing-coverage?severity=ERROR'));

    expect(response.status).toBe(200);
    expect(mocks.requirePermission).toHaveBeenCalledWith(session, 'company', 'read');
    expect(mocks.getCompanyReadScope).toHaveBeenCalledWith(session);
    expect(mocks.listBillingCoverage).toHaveBeenCalledWith(expect.objectContaining({
      tenantId,
      companyIds: [companyId],
      severities: ['ERROR'],
    }));
  });

  it('intersects requested company filters with the caller access scope', async () => {
    const response = await GET(new NextRequest(
      'http://localhost/api/billing-coverage?companyIds=44444444-4444-4444-8444-444444444444',
    ));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      openIssueCount: 0,
      affectedServiceCount: 0,
      healthyActiveServiceCount: 0,
      issues: [],
    });
    expect(mocks.listBillingCoverage).not.toHaveBeenCalled();
  });

  it('enqueues a tenant-scoped client-service manual reconcile after company:update', async () => {
    const response = await POST(
      new NextRequest(`http://localhost/api/client-services/${serviceId}/billing/reconcile`, { method: 'POST' }),
      { params: Promise.resolve({ id: serviceId }) },
    );

    expect(response.status).toBe(202);
    expect(mocks.requirePermission).toHaveBeenCalledWith(session, 'company', 'update', companyId);
    expect(mocks.enqueueScheduleReconciliation).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      tenantId,
      scopeType: 'CLIENT_SERVICE',
      scopeId: serviceId,
      triggerType: 'BILLING_MANUAL_RECONCILE',
      requestedById: session.id,
    }));
    expect(mocks.processScheduleReconciliationBatch).toHaveBeenCalledTimes(1);
    expect(await response.json()).toEqual(expect.objectContaining({ status: 'PENDING', requestId: 'request-1' }));
  });
});
