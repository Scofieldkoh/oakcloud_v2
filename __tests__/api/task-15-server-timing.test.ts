import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { ApiError, ErrorCodes } from '@/lib/errors';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requirePermission: vi.fn(),
  requireServicesWorkspaceEnabled: vi.fn(),
  getCompanyReadScope: vi.fn(),
  listServiceRoster: vi.fn(),
  listDeadlines: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: mocks.requireAuth }));
vi.mock('@/lib/rbac', () => ({ requirePermission: mocks.requirePermission }));
vi.mock('@/services/schedule-reconciliation', () => ({
  requireServicesWorkspaceEnabled: mocks.requireServicesWorkspaceEnabled,
}));
vi.mock('@/lib/api/company-query', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/company-query')>('@/lib/api/company-query');
  return { ...actual, getCompanyReadScope: mocks.getCompanyReadScope };
});
vi.mock('@/services/service-roster', () => ({ listServiceRoster: mocks.listServiceRoster }));
vi.mock('@/services/deadline', () => ({ listDeadlines: mocks.listDeadlines }));

import { GET as rosterGET } from '@/app/api/client-services/route';
import { GET as deadlineGET } from '@/app/api/deadlines/route';

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

describe('Task 15 list response timing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue(session);
    mocks.requirePermission.mockResolvedValue(undefined);
    mocks.requireServicesWorkspaceEnabled.mockResolvedValue(undefined);
    mocks.getCompanyReadScope.mockReturnValue({ tenantId, options: { companyIds: [companyId] } });
    mocks.listServiceRoster.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20, totalPages: 0 });
    mocks.listDeadlines.mockResolvedValue({ mode: 'TABLE', items: [], total: 0, page: 1, limit: 50, totalPages: 0 });
  });

  it('adds Server-Timing to the roster response without changing its body or status', async () => {
    const response = await rosterGET(new NextRequest('http://localhost/api/client-services'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [], total: 0, page: 1, limit: 20, totalPages: 0 });
    expect(String(response.headers.get('Server-Timing'))).toMatch(/^app;dur=\d+\.\d$/);
    expect(String(response.headers.get('X-Response-Time-Ms'))).toMatch(/^\d+\.\d$/);
  });

  it('adds Server-Timing to the deadline response without changing its body or status', async () => {
    const response = await deadlineGET(new NextRequest('http://localhost/api/deadlines?from=2026-08-01&to=2026-08-31'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ mode: 'TABLE', items: [], total: 0, page: 1, limit: 50, totalPages: 0 });
    expect(String(response.headers.get('Server-Timing'))).toMatch(/^app;dur=\d+\.\d$/);
    expect(String(response.headers.get('X-Response-Time-Ms'))).toMatch(/^\d+\.\d$/);
  });

  it.each([
    ['roster unauthorized', 'roster', 401],
    ['roster forbidden', 'roster', 403],
    ['roster disabled workspace', 'roster', 404],
    ['deadline validation', 'deadline', 400],
    ['deadline service failure', 'deadline', 500],
  ])('adds timing headers to the %s error response', async (_name, route, expectedStatus) => {
    if (route === 'roster' && expectedStatus === 401) {
      mocks.requireAuth.mockRejectedValueOnce(new Error('Unauthorized'));
    } else if (route === 'roster' && expectedStatus === 403) {
      mocks.requirePermission.mockRejectedValueOnce(new Error('Forbidden'));
    } else if (route === 'roster') {
      mocks.requireServicesWorkspaceEnabled.mockRejectedValueOnce(new ApiError(
        ErrorCodes.NOT_FOUND,
        'Services workspace is disabled for this workspace',
        404,
      ));
    } else if (expectedStatus === 400) {
      // Unknown query keys fail validation before any service query runs.
    } else {
      mocks.listDeadlines.mockRejectedValueOnce(new Error('database unavailable'));
    }

    const request = route === 'deadline'
      ? new NextRequest(expectedStatus === 400
        ? 'http://localhost/api/deadlines?unknown=value'
        : 'http://localhost/api/deadlines?from=2026-08-01&to=2026-08-31')
      : new NextRequest('http://localhost/api/client-services');
    const response = route === 'deadline' ? await deadlineGET(request) : await rosterGET(request);

    expect(response.status).toBe(expectedStatus);
    expect(String(response.headers.get('Server-Timing'))).toMatch(/^app;dur=\d+\.\d$/);
    expect(String(response.headers.get('X-Response-Time-Ms'))).toMatch(/^\d+\.\d$/);
  });

  it('adds timing headers to both empty-scope responses', async () => {
    mocks.getCompanyReadScope.mockReturnValue({ empty: true });

    const rosterResponse = await rosterGET(new NextRequest('http://localhost/api/client-services'));
    const deadlineResponse = await deadlineGET(new NextRequest('http://localhost/api/deadlines?from=2026-08-01&to=2026-08-31'));

    expect(rosterResponse.status).toBe(200);
    expect(deadlineResponse.status).toBe(200);
    expect(rosterResponse.headers.get('Server-Timing')).toMatch(/^app;dur=/);
    expect(deadlineResponse.headers.get('Server-Timing')).toMatch(/^app;dur=/);
  });
});
