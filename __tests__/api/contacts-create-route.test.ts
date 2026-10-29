import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requirePermission: vi.fn(),
  canAccessCompany: vi.fn(),
  requireWorkspaceContext: vi.fn(),
  previewContactIdentity: vi.fn(),
  resolveOrCreateContact: vi.fn(),
  createContactDetail: vi.fn(),
  linkContactToCompany: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  requireAuth: mocks.requireAuth,
  canAccessCompany: mocks.canAccessCompany,
}));
vi.mock('@/lib/rbac', () => ({ requirePermission: mocks.requirePermission }));
vi.mock('@/lib/api-helpers', () => ({ requireWorkspaceContext: mocks.requireWorkspaceContext }));
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock('@/services/contact-identity.service', () => ({
  previewContactIdentity: mocks.previewContactIdentity,
  resolveOrCreateContact: mocks.resolveOrCreateContact,
}));
vi.mock('@/services/contact-detail.service', () => ({ createContactDetail: mocks.createContactDetail }));
vi.mock('@/services/contact.service', () => ({
  searchContactsWithCounts: vi.fn(),
  linkContactToCompany: mocks.linkContactToCompany,
}));

const contactId = '11111111-1111-4111-8111-111111111111';
const exactChineseMatch = {
  contactId,
  score: 100,
  automatic: true,
  blockedByIdentifierConflict: false,
  reasons: ['EXACT_CANONICAL_NAME'],
  conflicts: [],
};
const createdContact = { id: contactId, fullName: '王小明' };
const session = { id: 'user-1', tenantId: 'tenant-1', isSuperAdmin: false };

function requestWith(body: unknown) {
  return new Request('http://localhost/api/contacts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function postManual(body: unknown) {
  const { POST } = await import('@/app/api/contacts/route');
  return POST(requestWith(body) as never);
}

async function postCompany(body: unknown) {
  const { POST } = await import('@/app/api/companies/[id]/contact-details/create-contact/route');
  return POST(requestWith(body) as never, {
    params: Promise.resolve({ id: '22222222-2222-4222-8222-222222222222' }),
  });
}

describe('contact creation identity decisions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue(session);
    mocks.requirePermission.mockResolvedValue(undefined);
    mocks.canAccessCompany.mockResolvedValue(true);
    mocks.requireWorkspaceContext.mockResolvedValue({ tenantId: 'tenant-1' });
    mocks.previewContactIdentity.mockResolvedValue(exactChineseMatch);
    mocks.resolveOrCreateContact.mockResolvedValue({ contact: createdContact, outcome: 'REUSED_NAME' });
    mocks.transaction.mockImplementation(async (callback: (tx: object) => unknown) => callback({ tx: true }));
  });

  it('returns a reviewable 409 before reusing a manual Chinese name-only match', async () => {
    const response = await postManual({ contactType: 'INDIVIDUAL', firstName: '王小明' });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'CONTACT_MATCH_REVIEW_REQUIRED',
      match: exactChineseMatch,
    });
    expect(mocks.previewContactIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'MANUAL', firstName: '王小明' }),
      'tenant-1',
    );
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.resolveOrCreateContact).not.toHaveBeenCalled();
  });

  it('resolves an explicit manual reuse and preserves submitted details in one transaction', async () => {
    const response = await postManual({
      contactType: 'INDIVIDUAL',
      firstName: '王小明',
      resolution: { action: 'REUSE', contactId },
      contactDetails: [{ detailType: 'EMAIL', value: 'wang@example.com' }],
    });

    expect(response.status).toBe(201);
    expect(mocks.resolveOrCreateContact).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'MANUAL', firstName: '王小明' }),
      { action: 'REUSE', contactId },
      expect.objectContaining({ tenantId: 'tenant-1', userId: 'user-1', tx: { tx: true } }),
    );
    expect(mocks.resolveOrCreateContact.mock.calls[0][0].contactDetails).toEqual([
      expect.objectContaining({ value: 'wang@example.com', displayOrder: 0 }),
    ]);
    expect(mocks.createContactDetail).not.toHaveBeenCalled();
  });

  it('creates separately with the reviewed match and audit reason', async () => {
    const reason = 'Different person with the same legal name';

    const response = await postManual({
      contactType: 'INDIVIDUAL',
      firstName: '王小明',
      resolution: { action: 'CREATE_SEPARATE', reason },
    });

    expect(response.status).toBe(201);
    expect(mocks.resolveOrCreateContact).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'MANUAL' }),
      { action: 'CREATE_SEPARATE', reason },
      expect.objectContaining({ tenantId: 'tenant-1', tx: { tx: true } }),
    );
  });

  it('rejects an unsafe reuse when the selected match has a strong identifier conflict', async () => {
    mocks.previewContactIdentity.mockResolvedValue({
      ...exactChineseMatch,
      blockedByIdentifierConflict: true,
      conflicts: [{ field: 'identificationNumber', incomingValue: 'S1', existingValue: 'S2' }],
    });

    const response = await postManual({
      contactType: 'INDIVIDUAL',
      firstName: '王小明',
      identificationType: 'NRIC',
      identificationNumber: 'S1',
      resolution: { action: 'REUSE', contactId },
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'CONTACT_MATCH_REVIEW_REQUIRED' });
    expect(mocks.resolveOrCreateContact).not.toHaveBeenCalled();
  });

  it('rejects reuse when the selected contact is not a current identity match', async () => {
    mocks.previewContactIdentity.mockResolvedValue(null);

    const response = await postManual({
      contactType: 'INDIVIDUAL',
      firstName: '王小明',
      resolution: { action: 'REUSE', contactId },
    });

    expect(response.status).toBe(400);
    expect(mocks.resolveOrCreateContact).not.toHaveBeenCalled();
  });

  it('validates the separate-contact reason before previewing or writing', async () => {
    const response = await postManual({
      contactType: 'INDIVIDUAL',
      firstName: '王小明',
      resolution: { action: 'CREATE_SEPARATE', reason: 'too short' },
    });

    expect(response.status).toBe(400);
    expect(mocks.previewContactIdentity).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('checks permission before previewing identity', async () => {
    mocks.requirePermission.mockRejectedValue(new Error('Forbidden'));

    const response = await postManual({ contactType: 'INDIVIDUAL', firstName: '王小明' });

    expect(response.status).toBe(403);
    expect(mocks.previewContactIdentity).not.toHaveBeenCalled();
  });

  it('requires tenant context before previewing identity', async () => {
    mocks.requireAuth.mockResolvedValue({ ...session, tenantId: null });

    const response = await postManual({ contactType: 'INDIVIDUAL', firstName: '王小明' });

    expect(response.status).toBe(400);
    expect(mocks.previewContactIdentity).not.toHaveBeenCalled();
  });

  it('previews company quick creation without opening a transaction', async () => {
    const response = await postCompany({
      relationship: 'Director',
      contact: { contactType: 'INDIVIDUAL', firstName: '王小明' },
    });

    expect(response.status).toBe(409);
    expect(mocks.previewContactIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'COMPANY_QUICK_CREATE', firstName: '王小明' }),
      'tenant-1',
    );
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('checks company access before parsing or previewing a quick creation', async () => {
    mocks.canAccessCompany.mockResolvedValue(false);

    const response = await postCompany({ malformed: true });

    expect(response.status).toBe(403);
    expect(mocks.requirePermission).not.toHaveBeenCalled();
    expect(mocks.previewContactIdentity).not.toHaveBeenCalled();
  });

  it('resolves, links, and adds company quick-create details atomically', async () => {
    const response = await postCompany({
      relationship: 'Director',
      contact: { contactType: 'INDIVIDUAL', firstName: '王小明' },
      contactDetails: [{ detailType: 'PHONE', value: '+65 8123 4567' }],
      resolution: { action: 'REUSE', contactId },
    });

    expect(response.status).toBe(201);
    expect(mocks.resolveOrCreateContact).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'COMPANY_QUICK_CREATE' }),
      { action: 'REUSE', contactId },
      expect.objectContaining({ tx: { tx: true } }),
    );
    expect(mocks.linkContactToCompany).toHaveBeenCalledWith(
      contactId,
      '22222222-2222-4222-8222-222222222222',
      'Director',
      expect.objectContaining({ tx: { tx: true } }),
    );
    expect(mocks.resolveOrCreateContact).toHaveBeenCalledWith(
      expect.objectContaining({
        contactDetails: [expect.objectContaining({
          detailType: 'PHONE',
          value: '+65 8123 4567',
          companyId: '22222222-2222-4222-8222-222222222222',
        })],
      }),
      { action: 'REUSE', contactId },
      expect.objectContaining({ tx: { tx: true } }),
    );
    expect(mocks.createContactDetail).not.toHaveBeenCalled();
  });

  it('passes top-level defaults and company-scoped purposes through reuse enrichment without duplicate route writes', async () => {
    const response = await postCompany({
      relationship: 'Director',
      contact: {
        contactType: 'INDIVIDUAL',
        firstName: 'çŽ‹å°æ˜Ž',
        email: 'default@example.com',
        phone: '+65 8123 4567',
      },
      contactDetails: [{
        detailType: 'EMAIL',
        value: 'director@example.com',
        label: 'Work',
        purposes: ['FINANCE', 'HR'],
        description: 'Company inbox',
        isPrimary: true,
      }],
      resolution: { action: 'REUSE', contactId },
    });

    expect(response.status).toBe(201);
    expect(mocks.resolveOrCreateContact).toHaveBeenCalledWith(
      expect.objectContaining({
        contactDetails: expect.arrayContaining([
          expect.objectContaining({ detailType: 'EMAIL', value: 'default@example.com' }),
          expect.objectContaining({ detailType: 'PHONE', value: '+65 8123 4567' }),
          expect.objectContaining({
            detailType: 'EMAIL',
            value: 'director@example.com',
            companyId: '22222222-2222-4222-8222-222222222222',
            purposes: ['FINANCE', 'HR'],
            label: 'Work',
            description: 'Company inbox',
          }),
        ]),
      }),
      { action: 'REUSE', contactId },
      expect.objectContaining({ tx: { tx: true } }),
    );
    expect(mocks.createContactDetail).not.toHaveBeenCalled();
  });

  it('passes all company quick-create details to identity resolution for a new contact', async () => {
    mocks.previewContactIdentity.mockResolvedValue(null);
    mocks.resolveOrCreateContact.mockResolvedValue({
      contact: { id: 'new-contact', fullName: 'New Person' },
      outcome: 'CREATED',
    });

    const response = await postCompany({
      relationship: 'Client Contact',
      contact: { contactType: 'INDIVIDUAL', firstName: 'New Person', email: 'new@example.com' },
      contactDetails: [{ detailType: 'PHONE', value: '+65 9000 0000', purposes: ['FINANCE'] }],
    });

    expect(response.status).toBe(201);
    expect(mocks.resolveOrCreateContact).toHaveBeenCalledWith(
      expect.objectContaining({
        contactDetails: [
          expect.objectContaining({ detailType: 'EMAIL', value: 'new@example.com' }),
          expect.objectContaining({
            detailType: 'PHONE',
            value: '+65 9000 0000',
            companyId: '22222222-2222-4222-8222-222222222222',
            purposes: ['FINANCE'],
          }),
        ],
      }),
      { action: 'AUTO' },
      expect.objectContaining({ tx: { tx: true } }),
    );
    expect(mocks.createContactDetail).not.toHaveBeenCalled();
  });
});
