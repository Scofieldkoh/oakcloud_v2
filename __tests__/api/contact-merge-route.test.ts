import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ requireAuth: vi.fn(), requirePermission: vi.fn(), merge: vi.fn() }));
vi.mock('@/lib/auth', () => ({ requireAuth: mocks.requireAuth }));
vi.mock('@/lib/rbac', () => ({ requirePermission: mocks.requirePermission }));
vi.mock('@/services/contact-merge.service', () => ({
  mergeContacts: mocks.merge,
  ContactMergeConflictError: class ContactMergeConflictError extends Error {},
}));

const session = { id: 'user-1', tenantId: 'tenant-1', isWorkspaceAdmin: false, hasAllCompaniesAccess: true };
const body = {
  idempotencyKey: '6f718b4c-b9ef-4ff0-a28a-c78d8df3d893',
  masterContactId: '11111111-1111-4111-8111-111111111111',
  sourceContactIds: ['22222222-2222-4222-8222-222222222222'],
  expectedUpdatedAt: { '11111111-1111-4111-8111-111111111111': '2026-07-14T01:00:00.000Z', '22222222-2222-4222-8222-222222222222': '2026-07-14T01:00:00.000Z' },
  expectedFingerprints: { '11111111-1111-4111-8111-111111111111': 'a'.repeat(64), '22222222-2222-4222-8222-222222222222': 'b'.repeat(64) },
  fieldDecisions: {},
};

describe('contact merge route', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.requireAuth.mockResolvedValue(session); mocks.merge.mockResolvedValue({ ledgerId: 'ledger-1', survivingContactId: body.masterContactId, movedCounts: {}, alreadyCompleted: false }); });

  it('requires update permission and workspace-wide access before merging', async () => {
    const { POST } = await import('@/app/api/contacts/merge/route');
    const response = await POST(new Request('http://localhost/api/contacts/merge', { method: 'POST', body: JSON.stringify(body) }) as never);
    expect(response.status).toBe(200);
    expect(mocks.requirePermission).toHaveBeenCalledWith(session, 'contact', 'update');
    expect(mocks.merge).toHaveBeenCalledWith(body, { tenantId: 'tenant-1', userId: 'user-1' });
  });

  it('denies company-scoped users and accepts workspace administrators', async () => {
    const { POST } = await import('@/app/api/contacts/merge/route');
    mocks.requireAuth.mockResolvedValue({ ...session, hasAllCompaniesAccess: false });
    expect((await POST(new Request('http://localhost/api/contacts/merge', { method: 'POST', body: JSON.stringify(body) }) as never)).status).toBe(403);
    expect(mocks.merge).not.toHaveBeenCalled();
    mocks.requireAuth.mockResolvedValue({ ...session, hasAllCompaniesAccess: false, isWorkspaceAdmin: true });
    expect((await POST(new Request('http://localhost/api/contacts/merge', { method: 'POST', body: JSON.stringify(body) }) as never)).status).toBe(200);
  });

  it('maps invalid input to 400 and stale/conflict errors to 409', async () => {
    const { POST } = await import('@/app/api/contacts/merge/route');
    expect((await POST(new Request('http://localhost/api/contacts/merge', { method: 'POST', body: '{}' }) as never)).status).toBe(400);
    const { ContactMergeConflictError } = await import('@/services/contact-merge.service');
    mocks.merge.mockRejectedValue(new ContactMergeConflictError('Duplicate recommendation is stale'));
    const conflict = await POST(new Request('http://localhost/api/contacts/merge', { method: 'POST', body: JSON.stringify(body) }) as never);
    expect(conflict.status).toBe(409);
  });

  it('returns a repeated completed merge as 200', async () => {
    mocks.merge.mockResolvedValue({ ledgerId: 'ledger-1', survivingContactId: body.masterContactId, movedCounts: {}, alreadyCompleted: true });
    const { POST } = await import('@/app/api/contacts/merge/route');
    const response = await POST(new Request('http://localhost/api/contacts/merge', { method: 'POST', body: JSON.stringify(body) }) as never);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ alreadyCompleted: true });
  });
});
