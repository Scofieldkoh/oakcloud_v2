import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requirePermission: vi.fn(),
  resolveWorkspaceId: vi.fn(),
  summaries: vi.fn(),
  details: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: mocks.requireAuth }));
vi.mock('@/lib/rbac', () => ({ requirePermission: mocks.requirePermission }));
vi.mock('@/lib/api-helpers', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-helpers')>('@/lib/api-helpers');
  return { ...actual, resolveWorkspaceId: mocks.resolveWorkspaceId };
});
vi.mock('@/services/form-url-health.service', () => ({
  listFormUrlWarningSummaries: mocks.summaries,
  getFormUrlHealthDetails: mocks.details,
}));

describe('form URL health routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({ id: 'user-1', tenantId: 'tenant-1', isSuperAdmin: false });
    mocks.requirePermission.mockResolvedValue(undefined);
    mocks.resolveWorkspaceId.mockReturnValue('tenant-1');
    mocks.summaries.mockResolvedValue([{ formId: 'form-1', warningCount: 2 }]);
    mocks.details.mockResolvedValue([{ formId: 'form-1', fieldKey: 'resource-link' }]);
  });

  it('returns warning summaries for the resolved workspace', async () => {
    const { GET } = await import('@/app/api/forms/url-health/route');
    const response = await GET(new Request('http://localhost/api/forms/url-health?tenantId=tenant-2') as NextRequest);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ formId: 'form-1', warningCount: 2 }]);
    expect(mocks.requirePermission).toHaveBeenCalledWith(expect.any(Object), 'document', 'read');
    expect(mocks.resolveWorkspaceId).toHaveBeenCalledWith(expect.any(Object), 'tenant-2');
    expect(mocks.summaries).toHaveBeenCalledWith('tenant-1');
  });

  it('returns field detail within the resolved workspace', async () => {
    const { GET } = await import('@/app/api/forms/[id]/url-health/route');
    const response = await GET(
      new Request('http://localhost/api/forms/form-1/url-health?tenantId=tenant-2') as NextRequest,
      { params: Promise.resolve({ id: 'form-1' }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ formId: 'form-1', fieldKey: 'resource-link' }]);
    expect(mocks.details).toHaveBeenCalledWith('tenant-1', 'form-1');
  });

  it('does not query health data when authentication fails', async () => {
    mocks.requireAuth.mockRejectedValue(new Error('Unauthorized'));
    const { GET } = await import('@/app/api/forms/url-health/route');
    const response = await GET(new Request('http://localhost/api/forms/url-health') as NextRequest);

    expect(response.status).toBe(401);
    expect(mocks.summaries).not.toHaveBeenCalled();
  });
});
