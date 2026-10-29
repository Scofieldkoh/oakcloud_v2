import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requirePermission: vi.fn(),
  list: vi.fn(),
  reject: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: mocks.requireAuth }));
vi.mock('@/lib/rbac', () => ({ requirePermission: mocks.requirePermission }));
vi.mock('@/services/contact-duplicate.service', () => ({
  listContactDuplicateGroups: mocks.list,
  rejectContactDuplicatePair: mocks.reject,
}));

const session = {
  id: 'user-1', tenantId: 'tenant-1', isSuperAdmin: false,
  isWorkspaceAdmin: false, hasAllCompaniesAccess: true,
};

describe('contact duplicate routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue(session);
    mocks.list.mockResolvedValue({ groups: [], total: 0, page: 1, limit: 20, totalPages: 0 });
    mocks.reject.mockResolvedValue({ rejected: true });
  });

  it('lists tenant-scoped recommendations for users with read and all-company access', async () => {
    const { GET } = await import('@/app/api/contacts/duplicates/route');
    const response = await GET(new Request('http://localhost/api/contacts/duplicates?page=2&limit=10') as never);

    expect(response.status).toBe(200);
    expect(mocks.requirePermission).toHaveBeenCalledWith(session, 'contact', 'read');
    expect(mocks.list).toHaveBeenCalledWith({ tenantId: 'tenant-1', page: 2, limit: 10 });
  });

  it('returns 403 without invoking discovery for company-scoped users', async () => {
    mocks.requireAuth.mockResolvedValue({ ...session, hasAllCompaniesAccess: false });
    const { GET } = await import('@/app/api/contacts/duplicates/route');
    const response = await GET(new Request('http://localhost/api/contacts/duplicates') as never);

    expect(response.status).toBe(403);
    expect(mocks.list).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' });
  });

  it('rejects with update permission and workspace-wide access', async () => {
    const body = {
      leftContactId: '11111111-1111-4111-8111-111111111111',
      rightContactId: '22222222-2222-4222-8222-222222222222',
      leftFingerprint: 'a'.repeat(64),
      rightFingerprint: 'b'.repeat(64),
      reason: 'Confirmed distinct contacts',
    };
    const { POST } = await import('@/app/api/contacts/duplicates/reject/route');
    const response = await POST(new Request('http://localhost/api/contacts/duplicates/reject', {
      method: 'POST', body: JSON.stringify(body),
    }) as never);

    expect(response.status).toBe(200);
    expect(mocks.requirePermission).toHaveBeenCalledWith(session, 'contact', 'update');
    expect(mocks.reject).toHaveBeenCalledWith(body, { tenantId: 'tenant-1', userId: 'user-1' });
  });

  it('allows a workspace admin to reject but denies a company-scoped non-admin before parsing data', async () => {
    mocks.requireAuth.mockResolvedValue({ ...session, hasAllCompaniesAccess: false, isWorkspaceAdmin: true });
    const { POST } = await import('@/app/api/contacts/duplicates/reject/route');
    const adminResponse = await POST(new Request('http://localhost/api/contacts/duplicates/reject', {
      method: 'POST', body: JSON.stringify({
        leftContactId: '11111111-1111-4111-8111-111111111111',
        rightContactId: '22222222-2222-4222-8222-222222222222',
        leftFingerprint: 'a'.repeat(64), rightFingerprint: 'b'.repeat(64),
        reason: 'Confirmed distinct contacts',
      }),
    }) as never);
    expect(adminResponse.status).toBe(200);

    mocks.requireAuth.mockResolvedValue({ ...session, hasAllCompaniesAccess: false });
    mocks.reject.mockClear();
    const denied = await POST(new Request('http://localhost/api/contacts/duplicates/reject', {
      method: 'POST', body: '{not-json',
    }) as never);
    expect(denied.status).toBe(403);
    expect(mocks.reject).not.toHaveBeenCalled();
  });

  it('validates distinct sorted-pair inputs and maps stale fingerprints to 409', async () => {
    const { POST } = await import('@/app/api/contacts/duplicates/reject/route');
    const invalid = await POST(new Request('http://localhost/api/contacts/duplicates/reject', {
      method: 'POST', body: JSON.stringify({
        leftContactId: '11111111-1111-4111-8111-111111111111',
        rightContactId: '11111111-1111-4111-8111-111111111111',
        leftFingerprint: 'a'.repeat(64), rightFingerprint: 'a'.repeat(64), reason: 'too short',
      }),
    }) as never);
    expect(invalid.status).toBe(400);

    mocks.reject.mockRejectedValue(new Error('Duplicate recommendation is stale'));
    const stale = await POST(new Request('http://localhost/api/contacts/duplicates/reject', {
      method: 'POST', body: JSON.stringify({
        leftContactId: '11111111-1111-4111-8111-111111111111',
        rightContactId: '22222222-2222-4222-8222-222222222222',
        leftFingerprint: 'a'.repeat(64), rightFingerprint: 'b'.repeat(64),
        reason: 'Confirmed distinct contacts',
      }),
    }) as never);
    expect(stale.status).toBe(409);
  });
});
