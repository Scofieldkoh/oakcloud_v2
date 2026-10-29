import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getServiceWorkspaceFlagsForTenant: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: mocks.requireAuth }));
vi.mock('@/services/schedule-reconciliation', () => ({
  getServiceWorkspaceFlagsForTenant: mocks.getServiceWorkspaceFlagsForTenant,
}));

import { GET } from '@/app/api/services/settings/route';

describe('GET /api/services/settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({ id: 'user-1', tenantId: 'workspace-1' });
    mocks.getServiceWorkspaceFlagsForTenant.mockResolvedValue({
      workspaceEnabled: true,
      deadlineWritesEnabled: false,
    });
  });

  it('returns workspace-safe service feature flags from the authenticated session workspace', async () => {
    const response = await GET(new Request('http://localhost/api/services/settings'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      workspaceEnabled: true,
      deadlineWritesEnabled: false,
    });
    expect(mocks.getServiceWorkspaceFlagsForTenant).toHaveBeenCalledWith('workspace-1');
  });

  it('does not accept a client-supplied workspace identifier', async () => {
    const response = await GET(new Request('http://localhost/api/services/settings?tenantId=other'));

    expect(response.status).toBe(200);
    expect(mocks.getServiceWorkspaceFlagsForTenant).toHaveBeenCalledWith('workspace-1');
    expect(mocks.getServiceWorkspaceFlagsForTenant).not.toHaveBeenCalledWith('other');
  });

  it('requires authenticated workspace context', async () => {
    mocks.requireAuth.mockResolvedValue({ id: 'user-1', tenantId: null });

    const response = await GET(new Request('http://localhost/api/services/settings'));

    expect(response.status).toBe(400);
    expect(mocks.getServiceWorkspaceFlagsForTenant).not.toHaveBeenCalled();
  });
});
