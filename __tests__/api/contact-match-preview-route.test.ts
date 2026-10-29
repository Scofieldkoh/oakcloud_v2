import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requirePermission: vi.fn(),
  previewContactIdentity: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: mocks.requireAuth }));
vi.mock('@/lib/rbac', () => ({ requirePermission: mocks.requirePermission }));
vi.mock('@/services/contact-identity.service', () => ({
  previewContactIdentity: mocks.previewContactIdentity,
}));
vi.mock('@/lib/prisma', () => ({
  prisma: { contact: { findMany: mocks.findMany } },
}));

const candidate = {
  source: 'BIZFILE',
  sourceRecordId: 'officers.0',
  contactType: 'INDIVIDUAL',
  firstName: '王小明',
};

async function post(body: unknown) {
  const { POST } = await import('@/app/api/contacts/match-preview/route');
  return POST(new Request('http://localhost/api/contacts/match-preview', {
    method: 'POST',
    body: JSON.stringify(body),
  }) as never);
}

describe('POST /api/contacts/match-preview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({ id: 'user-1', tenantId: 'tenant-1' });
    mocks.previewContactIdentity.mockResolvedValue({
      contactId: 'contact-1', score: 100, automatic: true,
      blockedByIdentifierConflict: false, reasons: ['EXACT_CANONICAL_NAME'], conflicts: [],
    });
    mocks.findMany.mockResolvedValue([{
      id: 'contact-1', fullName: '王小明', identificationType: 'NRIC',
      identificationNumber: 'S1234567A', corporateUen: null,
      companyRelations: [{ company: { id: 'company-1', name: 'Example Pte. Ltd.', uen: '202400001A' } }],
    }]);
  });

  it('requires contact read permission and returns tenant-scoped matches keyed by source path', async () => {
    const response = await post({ candidates: [candidate] });

    expect(response.status).toBe(200);
    expect(mocks.requirePermission).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }), 'contact', 'read',
    );
    expect(mocks.previewContactIdentity).toHaveBeenCalledWith(candidate, 'tenant-1');
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ['contact-1'] }, tenantId: 'tenant-1', deletedAt: null, isActive: true },
    }));
    await expect(response.json()).resolves.toEqual({
      matches: {
        'officers.0': expect.objectContaining({
          contactId: 'contact-1', reasons: ['EXACT_CANONICAL_NAME'],
          contact: expect.objectContaining({
            fullName: '王小明', identificationNumber: 'S1234567A',
            companies: [{ id: 'company-1', name: 'Example Pte. Ltd.', uen: '202400001A' }],
          }),
        }),
      },
    });
  });

  it('rejects batches over 100 before previewing', async () => {
    const candidates = Array.from({ length: 101 }, (_, index) => ({
      ...candidate, sourceRecordId: `officers.${index}`,
    }));
    const response = await post({ candidates });
    expect(response.status).toBe(400);
    expect(mocks.previewContactIdentity).not.toHaveBeenCalled();
  });

  it('rejects missing tenant context', async () => {
    mocks.requireAuth.mockResolvedValue({ id: 'super-1', tenantId: null, isSuperAdmin: true });
    const response = await post({ candidates: [candidate] });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Tenant context required' });
    expect(mocks.previewContactIdentity).not.toHaveBeenCalled();
  });

  it('uses a super admin selected tenant for BizFile previews', async () => {
    mocks.requireAuth.mockResolvedValue({ id: 'super-1', tenantId: null, isSuperAdmin: true });
    const response = await post({ candidates: [candidate], tenantId: '00000000-0000-4000-8000-000000000002' });

    expect(response.status).toBe(200);
    expect(mocks.previewContactIdentity).toHaveBeenCalledWith(
      candidate, '00000000-0000-4000-8000-000000000002',
    );
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenantId: '00000000-0000-4000-8000-000000000002' }),
    }));
  });
});
