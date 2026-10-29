import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(), canAccessCompany: vi.fn(), requirePermission: vi.fn(),
  getSection: vi.fn(), saveSection: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ requireAuth: mocks.requireAuth, canAccessCompany: mocks.canAccessCompany }));
vi.mock('@/lib/rbac', () => ({ requirePermission: mocks.requirePermission }));
vi.mock('@/services/company/profile-sections', () => ({
  getCompanyProfileSection: mocks.getSection,
  saveCompanyProfileSection: mocks.saveSection,
  CompanyProfileConflictError: class CompanyProfileConflictError extends Error {
    code = 'COMPANY_PROFILE_CONFLICT';
    constructor(public latest: unknown) { super('conflict'); }
  },
}));

import { GET, PATCH } from '@/app/api/companies/[id]/profile/[section]/route';

const context = { params: Promise.resolve({ id: 'company-1', section: 'addresses' }) };

describe('company profile section route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({ id: 'user-1', tenantId: 'tenant-1', isSuperAdmin: false });
    mocks.canAccessCompany.mockResolvedValue(true);
    mocks.getSection.mockResolvedValue({ section: 'addresses', version: 'a'.repeat(64), data: {} });
    mocks.saveSection.mockResolvedValue({ section: 'addresses', version: 'b'.repeat(64), data: {} });
  });

  it('returns a tenant-scoped section', async () => {
    const response = await GET(new Request('http://local') as never, context);
    expect(response.status).toBe(200);
    expect(mocks.getSection).toHaveBeenCalledWith('company-1', 'tenant-1', 'addresses');
  });

  it('requires company update permission before saving', async () => {
    const response = await PATCH(new Request('http://local', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ifMatchVersion: 'a'.repeat(64), data: { registered: null, mailing: null } }),
    }) as never, context);
    expect(response.status).toBe(200);
    expect(mocks.requirePermission).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-1' }), 'company', 'update', 'company-1',
    );
  });

  it('maps a section conflict to 409 with the latest data', async () => {
    const { CompanyProfileConflictError } = await import('@/services/company/profile-sections');
    const latest = { section: 'addresses' as const, version: 'b'.repeat(64), data: {} };
    mocks.saveSection.mockRejectedValue(new CompanyProfileConflictError(latest));
    const response = await PATCH(new Request('http://local', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ifMatchVersion: 'a'.repeat(64), data: { registered: null, mailing: null } }),
    }) as never, context);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'This section changed after you opened it', latest });
  });
});
