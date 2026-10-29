import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const mockRequireAuth = vi.fn();
const mockRequirePermission = vi.fn();
const mockResolveWorkspaceId = vi.fn();
const mockHardDeleteArchivedForm = vi.fn();

vi.mock('@/lib/auth', () => ({
  requireAuth: mockRequireAuth,
}));

vi.mock('@/lib/rbac', () => ({
  requirePermission: mockRequirePermission,
}));

vi.mock('@/lib/api-helpers', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-helpers')>('@/lib/api-helpers');
  return {
    ...actual,
    resolveWorkspaceId: mockResolveWorkspaceId,
  };
});

vi.mock('@/services/form-builder.service', () => ({
  hardDeleteArchivedForm: mockHardDeleteArchivedForm,
}));

describe('/api/forms/[id]/hard-delete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ id: 'user-1', tenantId: 'tenant-1', isSuperAdmin: false });
    mockRequirePermission.mockResolvedValue(undefined);
    mockResolveWorkspaceId.mockReturnValue('tenant-1');
    mockHardDeleteArchivedForm.mockResolvedValue({ id: 'form-1', status: 'ARCHIVED' });
  });

  it('permanently deletes an archived form through a dedicated endpoint', async () => {
    const { DELETE } = await import('@/app/api/forms/[id]/hard-delete/route');
    const response = await DELETE(
      new Request('http://localhost/api/forms/form-1/hard-delete?tenantId=tenant-1') as NextRequest,
      { params: Promise.resolve({ id: 'form-1' }) }
    );

    expect(response.status).toBe(200);
    expect(mockRequirePermission).toHaveBeenCalledWith(expect.any(Object), 'document', 'delete');
    expect(mockHardDeleteArchivedForm).toHaveBeenCalledWith('form-1', {
      tenantId: 'tenant-1',
      userId: 'user-1',
    });
  });
});
