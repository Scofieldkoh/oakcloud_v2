import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requirePermission: vi.fn(),
  getContactDetails: vi.fn(),
  getContactDetailsGrouped: vi.fn(),
  createContactDetail: vi.fn(),
  getContactDetailById: vi.fn(),
  updateContactDetail: vi.fn(),
  deleteContactDetail: vi.fn(),
  findContact: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: mocks.requireAuth }));
vi.mock('@/lib/rbac', () => ({ requirePermission: mocks.requirePermission }));
vi.mock('@/lib/prisma', () => ({
  prisma: { contact: { findFirst: mocks.findContact } },
}));
vi.mock('@/services/contact-detail.service', () => ({
  getContactDetails: mocks.getContactDetails,
  getContactDetailsGrouped: mocks.getContactDetailsGrouped,
  createContactDetail: mocks.createContactDetail,
  getContactDetailById: mocks.getContactDetailById,
  updateContactDetail: mocks.updateContactDetail,
  deleteContactDetail: mocks.deleteContactDetail,
}));

const contactId = '11111111-1111-4111-8111-111111111111';
const detailId = '22222222-2222-4222-8222-222222222222';
const session = {
  id: 'user-1',
  tenantId: 'tenant-1',
  isSuperAdmin: false,
};

describe('contact details route permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue(session);
    mocks.requirePermission.mockResolvedValue(undefined);
    mocks.getContactDetails.mockResolvedValue([]);
    mocks.getContactDetailById.mockResolvedValue({ id: detailId, contactId });
    mocks.findContact.mockResolvedValue({ id: contactId });
    mocks.createContactDetail.mockResolvedValue({ id: detailId, contactId });
    mocks.updateContactDetail.mockResolvedValue({ id: detailId, contactId });
    mocks.deleteContactDetail.mockResolvedValue(undefined);
  });

  it('uses the workspace-level contact read permission when listing details', async () => {
    const { GET } = await import('@/app/api/contacts/[id]/contact-details/route');
    const response = await GET(
      new NextRequest(`http://localhost/api/contacts/${contactId}/contact-details`),
      { params: Promise.resolve({ id: contactId }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.requirePermission).toHaveBeenCalledWith(session, 'contact', 'read');
  });

  it('uses the workspace-level contact update permission when editing a detail', async () => {
    const { PATCH } = await import('@/app/api/contacts/[id]/contact-details/[detailId]/route');
    const response = await PATCH(
      new NextRequest(
        `http://localhost/api/contacts/${contactId}/contact-details/${detailId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label: 'Work' }),
        },
      ),
      { params: Promise.resolve({ id: contactId, detailId }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.requirePermission).toHaveBeenCalledWith(session, 'contact', 'update');
  });

  it('uses the same standardized permission checks for create, item read, and delete', async () => {
    const collectionRoute = await import('@/app/api/contacts/[id]/contact-details/route');
    const itemRoute = await import('@/app/api/contacts/[id]/contact-details/[detailId]/route');
    const params = { params: Promise.resolve({ id: contactId, detailId }) };

    const createResponse = await collectionRoute.POST(
      new NextRequest(`http://localhost/api/contacts/${contactId}/contact-details`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ detailType: 'EMAIL', value: 'person@example.com' }),
      }),
      { params: Promise.resolve({ id: contactId }) },
    );
    const readResponse = await itemRoute.GET(
      new NextRequest(`http://localhost/api/contacts/${contactId}/contact-details/${detailId}`),
      params,
    );
    const deleteResponse = await itemRoute.DELETE(
      new NextRequest(`http://localhost/api/contacts/${contactId}/contact-details/${detailId}`, {
        method: 'DELETE',
      }),
      params,
    );

    expect(createResponse.status).toBe(201);
    expect(readResponse.status).toBe(200);
    expect(deleteResponse.status).toBe(200);
    expect(mocks.requirePermission.mock.calls).toEqual([
      [session, 'contact', 'update'],
      [session, 'contact', 'read'],
      [session, 'contact', 'update'],
    ]);
  });

  it('returns the standard forbidden response when contact permission is missing', async () => {
    mocks.requirePermission.mockRejectedValue(new Error('Permission denied: contact:read'));
    const { GET } = await import('@/app/api/contacts/[id]/contact-details/route');

    const response = await GET(
      new NextRequest(`http://localhost/api/contacts/${contactId}/contact-details`),
      { params: Promise.resolve({ id: contactId }) },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' });
    expect(mocks.getContactDetails).not.toHaveBeenCalled();
  });
});
