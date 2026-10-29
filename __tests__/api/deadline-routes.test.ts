import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { NotFoundError } from '@/lib/errors';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requirePermission: vi.fn(),
  requireServicesWorkspaceEnabled: vi.fn(),
  getCompanyReadScope: vi.fn(),
  listDeadlines: vi.fn(),
  getDeadlineOccurrence: vi.fn(),
  updateDeadlineOccurrence: vi.fn(),
  resetDeadlineDateOverride: vi.fn(),
  listWorkspaceHolidays: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: mocks.requireAuth }));
vi.mock('@/lib/rbac', () => ({ requirePermission: mocks.requirePermission }));
vi.mock('@/services/schedule-reconciliation', () => ({ requireServicesWorkspaceEnabled: mocks.requireServicesWorkspaceEnabled }));
vi.mock('@/lib/api/company-query', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/company-query')>('@/lib/api/company-query');
  return { ...actual, getCompanyReadScope: mocks.getCompanyReadScope };
});
vi.mock('@/services/deadline', () => ({
  listDeadlines: mocks.listDeadlines,
  getDeadlineOccurrence: mocks.getDeadlineOccurrence,
  updateDeadlineOccurrence: mocks.updateDeadlineOccurrence,
  resetDeadlineDateOverride: mocks.resetDeadlineDateOverride,
}));

vi.mock('@/services/business-calendar', () => ({ listWorkspaceHolidays: mocks.listWorkspaceHolidays }));

import { GET as listGET } from '@/app/api/deadlines/route';
import { GET as holidaysGET } from '@/app/api/deadlines/holidays/route';
import { GET as detailGET, PATCH as detailPATCH } from '@/app/api/deadlines/[id]/route';
import { POST as resetPOST } from '@/app/api/deadlines/[id]/reset-date-override/route';

const tenantId = '11111111-1111-4111-8111-111111111111';
const companyId = '22222222-2222-4222-8222-222222222222';
const deadlineId = '33333333-3333-4333-8333-333333333333';
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
const deadline = {
  id: deadlineId,
  tenantId,
  companyId,
  status: 'OPEN',
  updatedAt: '2026-08-10T00:00:00.000Z',
};

describe('deadline routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue(session);
    mocks.requirePermission.mockResolvedValue(undefined);
    mocks.requireServicesWorkspaceEnabled.mockResolvedValue(undefined);
    mocks.getCompanyReadScope.mockReturnValue({ tenantId, options: { companyIds: [companyId] } });
    mocks.listDeadlines.mockResolvedValue({ mode: 'TABLE', items: [], total: 0, page: 1, limit: 50, totalPages: 0 });
    mocks.getDeadlineOccurrence.mockResolvedValue(deadline);
    mocks.updateDeadlineOccurrence.mockResolvedValue(deadline);
    mocks.resetDeadlineDateOverride.mockResolvedValue(deadline);
  });

  it('scopes list access to company:read and the derived accessible companies', async () => {
    const response = await listGET(new NextRequest(`http://localhost/api/deadlines?from=2026-08-01&to=2026-08-31`));

    expect(response.status).toBe(200);
    expect(mocks.requirePermission).toHaveBeenCalledWith(session, 'company', 'read');
    expect(mocks.requireServicesWorkspaceEnabled).toHaveBeenCalledWith(tenantId);
    expect(mocks.getCompanyReadScope).toHaveBeenCalledWith(session);
    expect(mocks.listDeadlines).toHaveBeenCalledWith(expect.objectContaining({ from: '2026-08-01', to: '2026-08-31' }), {
      tenantId,
      companyIds: [companyId],
    });
  });

  it('rejects unknown and duplicate query keys before querying', async () => {
    const response = await listGET(new NextRequest('http://localhost/api/deadlines?from=2026-08-01&to=2026-08-31&unknown=value'));
    expect(response.status).toBe(400);
    expect(mocks.listDeadlines).not.toHaveBeenCalled();

    const duplicate = await listGET(new NextRequest('http://localhost/api/deadlines?from=2026-08-01&from=2026-08-02&to=2026-08-31'));
    expect(duplicate.status).toBe(400);
    expect(mocks.listDeadlines).not.toHaveBeenCalled();
  });

  it('reads workspace holidays for deadline readers and bounds the range', async () => {
    mocks.listWorkspaceHolidays.mockResolvedValue({ weekendDays: [0, 6], holidays: [{ date: '2026-08-10', name: 'National Day' }] });
    const response = await holidaysGET(new NextRequest('http://localhost/api/deadlines/holidays?from=2026-08-01&to=2026-10-31'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ weekendDays: [0, 6], holidays: [{ date: '2026-08-10', name: 'National Day' }] });
    expect(mocks.requirePermission).toHaveBeenCalledWith(session, 'company', 'read');
    expect(mocks.requireServicesWorkspaceEnabled).toHaveBeenCalledWith(tenantId);
    expect(mocks.listWorkspaceHolidays).toHaveBeenCalledWith({ tenantId, from: '2026-08-01', to: '2026-10-31' });

    for (const query of ['from=2026-08-01', 'from=2026-08-31&to=2026-08-01', 'from=2026-01-01&to=2027-12-31', 'from=2026-08-01&to=2026-08-31&tenantId=x']) {
      expect((await holidaysGET(new NextRequest(`http://localhost/api/deadlines/holidays?${query}`))).status).toBe(400);
    }
    expect(mocks.listWorkspaceHolidays).toHaveBeenCalledTimes(1);
  });

  it('loads the occurrence before checking company:update for lifecycle mutation', async () => {
    const response = await detailPATCH(
      new NextRequest(`http://localhost/api/deadlines/${deadlineId}`, {
        method: 'PATCH',
        body: JSON.stringify({ expectedUpdatedAt: deadline.updatedAt, status: 'COMPLETED', reason: 'Filed' }),
      }),
      { params: Promise.resolve({ id: deadlineId }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.getDeadlineOccurrence).toHaveBeenCalledWith(deadlineId, { tenantId, userId: session.id });
    expect(mocks.requirePermission).toHaveBeenCalledWith(session, 'company', 'update', companyId);
    expect(mocks.updateDeadlineOccurrence).toHaveBeenCalledWith(deadlineId, expect.objectContaining({ status: 'COMPLETED' }), { tenantId, userId: session.id });
  });

  it('checks company:update for reset override after loading the occurrence', async () => {
    const response = await resetPOST(
      new NextRequest(`http://localhost/api/deadlines/${deadlineId}/reset-date-override`, {
        method: 'POST',
        body: JSON.stringify({ expectedUpdatedAt: deadline.updatedAt, reason: 'Reset after review' }),
      }),
      { params: Promise.resolve({ id: deadlineId }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.requirePermission).toHaveBeenCalledWith(session, 'company', 'update', companyId);
    expect(mocks.resetDeadlineDateOverride).toHaveBeenCalledWith(deadlineId, expect.objectContaining({ expectedUpdatedAt: deadline.updatedAt }), { tenantId, userId: session.id });
  });

  it('returns tenant-scoped detail only after company:read', async () => {
    const response = await detailGET(new NextRequest(`http://localhost/api/deadlines/${deadlineId}`), {
      params: Promise.resolve({ id: deadlineId }),
    });

    expect(response.status).toBe(200);
    expect(mocks.requirePermission).toHaveBeenCalledWith(session, 'company', 'read', companyId);
    expect(mocks.getDeadlineOccurrence).toHaveBeenCalledWith(deadlineId, { tenantId, userId: session.id });
  });

  it('returns a validation error for an invalid occurrence id', async () => {
    const response = await detailGET(new NextRequest('http://localhost/api/deadlines/not-a-uuid'), {
      params: Promise.resolve({ id: 'not-a-uuid' }),
    });

    expect(response.status).toBe(400);
    expect(mocks.getDeadlineOccurrence).not.toHaveBeenCalled();
  });

  it('returns the same 404 for an inaccessible existing GET and a missing GET', async () => {
    mocks.getDeadlineOccurrence.mockResolvedValueOnce({ ...deadline, companyId: '44444444-4444-4444-8444-444444444444' });
    mocks.requirePermission.mockRejectedValueOnce(new Error('Permission denied for company'));
    const inaccessible = await detailGET(new NextRequest(`http://localhost/api/deadlines/${deadlineId}`), {
      params: Promise.resolve({ id: deadlineId }),
    });
    mocks.getDeadlineOccurrence.mockRejectedValueOnce(new NotFoundError('Deadline occurrence not found'));
    const missing = await detailGET(new NextRequest(`http://localhost/api/deadlines/${deadlineId}`), {
      params: Promise.resolve({ id: deadlineId }),
    });

    expect(inaccessible.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await inaccessible.json()).toEqual(await missing.json());
  });

  it('returns the same 404 for an inaccessible existing PATCH and a missing PATCH', async () => {
    mocks.getDeadlineOccurrence.mockResolvedValueOnce({ ...deadline, companyId: '44444444-4444-4444-8444-444444444444' });
    mocks.requirePermission.mockRejectedValueOnce(new Error('Permission denied for company'));
    const inaccessible = await detailPATCH(
      new NextRequest(`http://localhost/api/deadlines/${deadlineId}`, { method: 'PATCH', body: JSON.stringify({ expectedUpdatedAt: deadline.updatedAt, status: 'COMPLETED', reason: 'Filed' }) }),
      { params: Promise.resolve({ id: deadlineId }) },
    );
    mocks.getDeadlineOccurrence.mockRejectedValueOnce(new NotFoundError('Deadline occurrence not found'));
    const missing = await detailPATCH(
      new NextRequest(`http://localhost/api/deadlines/${deadlineId}`, { method: 'PATCH', body: JSON.stringify({ expectedUpdatedAt: deadline.updatedAt, status: 'COMPLETED', reason: 'Filed' }) }),
      { params: Promise.resolve({ id: deadlineId }) },
    );

    expect(inaccessible.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await inaccessible.json()).toEqual(await missing.json());
  });

  it('returns the same 404 for an inaccessible existing reset and a missing reset', async () => {
    mocks.getDeadlineOccurrence.mockResolvedValueOnce({ ...deadline, companyId: '44444444-4444-4444-8444-444444444444' });
    mocks.requirePermission.mockRejectedValueOnce(new Error('Permission denied for company'));
    const inaccessible = await resetPOST(
      new NextRequest(`http://localhost/api/deadlines/${deadlineId}/reset-date-override`, { method: 'POST', body: JSON.stringify({ expectedUpdatedAt: deadline.updatedAt, reason: 'Reset' }) }),
      { params: Promise.resolve({ id: deadlineId }) },
    );
    mocks.getDeadlineOccurrence.mockRejectedValueOnce(new NotFoundError('Deadline occurrence not found'));
    const missing = await resetPOST(
      new NextRequest(`http://localhost/api/deadlines/${deadlineId}/reset-date-override`, { method: 'POST', body: JSON.stringify({ expectedUpdatedAt: deadline.updatedAt, reason: 'Reset' }) }),
      { params: Promise.resolve({ id: deadlineId }) },
    );

    expect(inaccessible.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await inaccessible.json()).toEqual(await missing.json());
  });

  it('returns a structured 400 for malformed JSON mutations', async () => {
    const response = await detailPATCH(
      new NextRequest(`http://localhost/api/deadlines/${deadlineId}`, { method: 'PATCH', body: '{' }),
      { params: Promise.resolve({ id: deadlineId }) },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('returns a structured 400 for malformed reset JSON', async () => {
    const response = await resetPOST(
      new NextRequest(`http://localhost/api/deadlines/${deadlineId}/reset-date-override`, { method: 'POST', body: '{' }),
      { params: Promise.resolve({ id: deadlineId }) },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
