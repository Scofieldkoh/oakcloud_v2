import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requirePermission: vi.fn(),
  retryService: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  requireAuth: mocks.requireAuth,
}));

vi.mock('@/lib/rbac', () => ({
  requirePermission: mocks.requirePermission,
}));

vi.mock('@/services/esigning-envelope.service', () => ({
  retryEsigningEnvelopeCompletionProcessing: mocks.retryService,
}));

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    email: 'user@example.com',
    firstName: 'Test',
    lastName: 'User',
    tenantId: 'tenant-session',
    isSuperAdmin: false,
    isWorkspaceAdmin: false,
    hasAllCompaniesAccess: false,
    companyIds: [],
    ...overrides,
  };
}

function makeRequest(tenantId?: string): NextRequest {
  return new NextRequest(
    'http://localhost/api/esigning/envelopes/envelope-1/retry-processing',
    {
      method: 'POST',
      body: tenantId === undefined ? undefined : JSON.stringify({ tenantId }),
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

describe('POST /api/esigning/envelopes/[id]/retry-processing', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.requirePermission.mockResolvedValue(undefined);
    mocks.retryService.mockResolvedValue({ id: 'envelope-1' });
  });

  it('lets an update-scoped user retry and resolves the session tenant', async () => {
    mocks.requireAuth.mockResolvedValue(makeSession());
    const { POST } = await import(
      '@/app/api/esigning/envelopes/[id]/retry-processing/route'
    );

    const response = await POST(makeRequest('tenant-spoofed'), {
      params: Promise.resolve({ id: 'envelope-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ id: 'envelope-1' });
    expect(mocks.requirePermission).toHaveBeenCalledWith(expect.any(Object), 'esigning', 'update');
    expect(mocks.retryService).toHaveBeenCalledWith(
      expect.any(Object),
      'tenant-session',
      'envelope-1'
    );
  });

  it('lets a super admin supply an explicit tenant context', async () => {
    mocks.requireAuth.mockResolvedValue(makeSession({ isSuperAdmin: true }));
    const { POST } = await import(
      '@/app/api/esigning/envelopes/[id]/retry-processing/route'
    );

    const response = await POST(makeRequest('tenant-explicit'), {
      params: Promise.resolve({ id: 'envelope-1' }),
    });

    expect(response.status).toBe(200);
    expect(mocks.retryService).toHaveBeenCalledWith(
      expect.any(Object),
      'tenant-explicit',
      'envelope-1'
    );
  });

  it('returns 403 without invoking the service when update permission is missing', async () => {
    mocks.requireAuth.mockResolvedValue(makeSession());
    mocks.requirePermission.mockRejectedValue(new Error('Forbidden'));
    const { POST } = await import(
      '@/app/api/esigning/envelopes/[id]/retry-processing/route'
    );

    const response = await POST(makeRequest(), {
      params: Promise.resolve({ id: 'envelope-1' }),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Forbidden' });
    expect(mocks.retryService).not.toHaveBeenCalled();
  });

  it('returns 401 when authentication fails', async () => {
    mocks.requireAuth.mockRejectedValue(new Error('Unauthorized'));
    const { POST } = await import(
      '@/app/api/esigning/envelopes/[id]/retry-processing/route'
    );

    const response = await POST(makeRequest(), {
      params: Promise.resolve({ id: 'envelope-1' }),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
    expect(mocks.retryService).not.toHaveBeenCalled();
  });

  it('maps a service object/tenant denial to 403 without leaking details', async () => {
    mocks.requireAuth.mockResolvedValue(makeSession());
    mocks.retryService.mockRejectedValue(new Error('Forbidden'));
    const { POST } = await import(
      '@/app/api/esigning/envelopes/[id]/retry-processing/route'
    );

    const response = await POST(makeRequest(), {
      params: Promise.resolve({ id: 'envelope-1' }),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Forbidden' });
  });
});
