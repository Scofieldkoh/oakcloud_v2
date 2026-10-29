import type { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  isAdmin: vi.fn(),
  syncAcraDataIfUpdated: vi.fn(),
  after: vi.fn(),
}));

let afterPromise: Promise<unknown> | null = null;

vi.mock('@/lib/auth', () => ({
  requireAuth: mocks.requireAuth,
  isAdmin: mocks.isAdmin,
}));

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return {
    ...actual,
    after: mocks.after,
  };
});

vi.mock('@/services/acra-sync.service', () => ({
  syncAcraDataIfUpdated: mocks.syncAcraDataIfUpdated,
}));

const ADMIN_SESSION = {
  isSuperAdmin: true,
  isWorkspaceAdmin: false,
  tenantId: 'tenant-1',
};

async function callPost(): Promise<Response> {
  const { POST } = await import('@/app/api/admin/acra-records/sync/route');
  return POST(new Request('http://localhost/api/admin/acra-records/sync', { method: 'POST' }) as NextRequest);
}

describe('POST /api/admin/acra-records/sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue(ADMIN_SESSION);
    mocks.isAdmin.mockImplementation(
      (user: { isSuperAdmin?: boolean; isWorkspaceAdmin?: boolean }) =>
        !!user.isSuperAdmin || !!user.isWorkspaceAdmin
    );
    mocks.syncAcraDataIfUpdated.mockResolvedValue({ synced: true, skipped: false, entityCount: 1, dataAsOf: 'x' });
    afterPromise = null;
    mocks.after.mockImplementation((fn: () => unknown) => {
      afterPromise = Promise.resolve(fn());
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('starts a forced sync and acknowledges immediately', async () => {
    const response = await callPost();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      message: expect.stringContaining('ACRA sync started'),
    });

    await afterPromise;

    expect(mocks.syncAcraDataIfUpdated).toHaveBeenCalledWith({ force: true });
  });

  it('returns 403 for non-admin users', async () => {
    mocks.isAdmin.mockReturnValue(false);

    const response = await callPost();

    expect(response.status).toBe(403);
    expect(mocks.syncAcraDataIfUpdated).not.toHaveBeenCalled();
  });

  it('returns 401 when unauthenticated', async () => {
    mocks.requireAuth.mockRejectedValue(new Error('Unauthorized'));

    const response = await callPost();

    expect(response.status).toBe(401);
  });
});
