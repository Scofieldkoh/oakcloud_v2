import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import {
  getDocumentPartyOptions,
  resolveDocumentPartySelections,
} from '@/services/document-party.service';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    company: { findFirst: vi.fn() },
    contact: { findMany: vi.fn() },
  },
}));

describe('document party service', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns current directors, shareholders, and the company Contacts union', async () => {
    vi.mocked(prisma.company.findFirst).mockResolvedValue({
      id: 'company-1',
      officers: [
        { id: 'officer-1', name: 'Alice', role: 'DIRECTOR', contact: null },
      ],
      shareholders: [
        {
          id: 'shareholder-1',
          name: 'Ben',
          shareClass: 'ORDINARY',
          contact: null,
        },
      ],
      contacts: [
        {
          contactId: 'contact-1',
          contact: {
            id: 'contact-1',
            fullName: 'Cara',
            fullAddress: null,
            contactDetails: [],
          },
          relationship: 'Representative',
        },
      ],
    } as never);
    vi.mocked(prisma.contact.findMany).mockResolvedValue([
      {
        id: 'contact-1',
        fullName: 'Cara',
        contactType: 'INDIVIDUAL',
        fullAddress: null,
        contactDetails: [],
      },
    ] as never);

    const result = await getDocumentPartyOptions('company-1', 'tenant-1');

    expect(result.directors.map((party) => party.id)).toEqual(['officer-1']);
    expect(result.shareholders.map((party) => party.id)).toEqual([
      'shareholder-1',
    ]);
    expect(result.contacts.map((party) => party.id)).toEqual(['contact-1']);
  });

  it('aggregates and authority-ranks every appointment for one company contact', async () => {
    vi.mocked(prisma.company.findFirst).mockResolvedValue({
      id: 'company-1',
      officers: [
        { id: 'officer-director', contactId: 'contact-1', name: 'Alex', role: 'DIRECTOR' },
        { id: 'officer-ceo', contactId: 'contact-1', name: 'Alex', role: 'CEO' },
        { id: 'officer-md', contactId: 'contact-1', name: 'Alex', role: 'MANAGING_DIRECTOR' },
      ],
      shareholders: [
        {
          id: 'shareholder-1',
          contactId: 'contact-1',
          name: 'Alex',
          shareClass: 'ORDINARY',
        },
      ],
      contacts: [
        { contactId: 'contact-1', relationship: 'COO' },
        // Positions come from the officer register, not free-text relationships.
        { contactId: 'contact-1', relationship: 'Company Secretary' },
        { contactId: 'contact-1', relationship: 'Advisor' },
      ],
    } as never);
    vi.mocked(prisma.contact.findMany).mockResolvedValue([
      {
        id: 'contact-1',
        fullName: 'Alex',
        contactType: 'INDIVIDUAL',
        fullAddress: null,
        contactDetails: [],
      },
    ] as never);

    const result = await getDocumentPartyOptions('company-1', 'tenant-1');

    // Every director appointment is listed, as the Word directors repeater prints them.
    expect(result.directors.map((party) => party.id)).toEqual(['officer-director', 'officer-md']);
    expect(result.contacts).toHaveLength(1);
    expect(result.contacts[0]).toMatchObject({
      id: 'contact-1',
      detail: 'Director',
      appointments: [
        'Director',
        'Managing Director',
        'CEO',
        'COO',
        'Advisor',
        'Shareholder',
      ],
    });
  });

  it('rejects a director outside the selected company', async () => {
    vi.mocked(prisma.company.findFirst).mockResolvedValue({
      id: 'company-1',
      officers: [],
      shareholders: [],
      contacts: [],
    } as never);

    await expect(
      resolveDocumentPartySelections({
        companyId: 'company-1',
        tenantId: 'tenant-1',
        selectedDirectorId: 'officer-2',
      }),
    ).rejects.toThrow(
      'Selected director is not a current director of this company',
    );
  });

  it('resolves a selected director collection and rejects stale members', async () => {
    vi.mocked(prisma.company.findFirst).mockResolvedValue({
      id: 'company-1',
      officers: [
        { id: 'officer-1', name: 'Alice', role: 'DIRECTOR', contact: null },
        { id: 'officer-2', name: 'Ben', role: 'DIRECTOR', contact: null },
      ],
      shareholders: [],
      contacts: [],
    } as never);

    const result = await resolveDocumentPartySelections({
      companyId: 'company-1',
      tenantId: 'tenant-1',
      selectedDirectorIds: ['officer-2', 'officer-1'],
    });

    expect(result.selectedDirectors?.map((party) => party.id)).toEqual([
      'officer-2',
      'officer-1',
    ]);

    await expect(resolveDocumentPartySelections({
      companyId: 'company-1',
      tenantId: 'tenant-1',
      selectedDirectorIds: ['officer-stale'],
    })).rejects.toThrow('Selected director is not a current director of this company');
  });

  it('rejects a stale shareholder selection', async () => {
    vi.mocked(prisma.company.findFirst).mockResolvedValue({
      id: 'company-1',
      officers: [],
      shareholders: [],
      contacts: [],
    } as never);

    await expect(
      resolveDocumentPartySelections({
        companyId: 'company-1',
        tenantId: 'tenant-1',
        selectedShareholderId: 'shareholder-stale',
      }),
    ).rejects.toThrow(
      'Selected shareholder is not a current shareholder of this company',
    );
  });

  it('rejects a stale contact selection', async () => {
    vi.mocked(prisma.company.findFirst).mockResolvedValue({
      id: 'company-1',
      officers: [],
      shareholders: [],
      contacts: [],
    } as never);

    await expect(
      resolveDocumentPartySelections({
        companyId: 'company-1',
        tenantId: 'tenant-1',
        selectedContactId: 'contact-stale',
      }),
    ).rejects.toThrow('Selected contact is not linked to this company');
  });

  it('preserves a director role but excludes its deleted linked contact', async () => {
    vi.mocked(prisma.company.findFirst).mockResolvedValue({
      id: 'company-1',
      officers: [
        {
          id: 'officer-1',
          contactId: 'contact-deleted',
          name: 'Alice',
          role: 'DIRECTOR',
          contact: {
            id: 'contact-deleted',
            fullName: 'Deleted Alice',
            contactType: 'INDIVIDUAL',
            fullAddress: 'Secret address',
            contactDetails: [
              {
                detailType: 'EMAIL',
                value: 'deleted@example.com',
                companyId: null,
              },
            ],
          },
        },
      ],
      shareholders: [],
      contacts: [],
    } as never);
    vi.mocked(prisma.contact.findMany).mockResolvedValue([]);

    const result = await getDocumentPartyOptions('company-1', 'tenant-1');

    expect(result.directors).toHaveLength(1);
    expect(result.directors[0]).toMatchObject({
      id: 'officer-1',
      contactId: 'contact-deleted',
      contactType: null,
      email: null,
      phone: null,
    });
    expect(result.contacts).toEqual([]);
  });

  it('excludes an inactive direct company contact', async () => {
    vi.mocked(prisma.company.findFirst).mockResolvedValue({
      id: 'company-1',
      officers: [],
      shareholders: [],
      contacts: [
        {
          contactId: 'contact-inactive',
          relationship: 'Representative',
          contact: {
            id: 'contact-inactive',
            fullName: 'Inactive Contact',
            contactType: 'INDIVIDUAL',
            fullAddress: null,
            contactDetails: [],
          },
        },
      ],
    } as never);
    vi.mocked(prisma.contact.findMany).mockResolvedValue([]);

    const result = await getDocumentPartyOptions('company-1', 'tenant-1');

    expect(result.contacts).toEqual([]);
  });

  it('excludes a cross-workspace direct company contact', async () => {
    vi.mocked(prisma.company.findFirst).mockResolvedValue({
      id: 'company-1',
      officers: [],
      shareholders: [],
      contacts: [
        {
          contactId: 'contact-other-tenant',
          relationship: 'Representative',
          contact: {
            id: 'contact-other-tenant',
            fullName: 'Other Workspace Contact',
            contactType: 'INDIVIDUAL',
            fullAddress: null,
            contactDetails: [],
          },
        },
      ],
    } as never);
    vi.mocked(prisma.contact.findMany).mockResolvedValue([]);

    const result = await getDocumentPartyOptions('company-1', 'tenant-1');

    expect(result.contacts).toEqual([]);
  });

  it('uses a company-specific contact detail from eligible contacts', async () => {
    vi.mocked(prisma.company.findFirst).mockResolvedValue({
      id: 'company-1',
      officers: [],
      shareholders: [],
      contacts: [
        {
          contactId: 'contact-1',
          relationship: 'Representative',
          contact: {
            id: 'contact-1',
            fullName: 'Cara',
            contactType: 'INDIVIDUAL',
            fullAddress: null,
            contactDetails: [
              {
                detailType: 'EMAIL',
                value: 'general@example.com',
                companyId: null,
                isPrimary: true,
                displayOrder: 0,
                createdAt: new Date('2026-01-01'),
              },
              {
                detailType: 'EMAIL',
                value: 'company@example.com',
                companyId: 'company-1',
                isPrimary: false,
                displayOrder: 1,
                createdAt: new Date('2026-01-02'),
              },
            ],
          },
        },
      ],
    } as never);
    vi.mocked(prisma.contact.findMany).mockResolvedValue([
      {
        id: 'contact-1',
        fullName: 'Cara',
        contactType: 'INDIVIDUAL',
        fullAddress: null,
        contactDetails: [
          {
            detailType: 'EMAIL',
            value: 'general@example.com',
            companyId: null,
            isPrimary: true,
            displayOrder: 0,
            createdAt: new Date('2026-01-01'),
          },
          {
            detailType: 'EMAIL',
            value: 'company@example.com',
            companyId: 'company-1',
            isPrimary: false,
            displayOrder: 1,
            createdAt: new Date('2026-01-02'),
          },
        ],
      },
    ] as never);

    const result = await getDocumentPartyOptions('company-1', 'tenant-1');

    expect(prisma.contact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { in: ['contact-1'] },
          tenantId: 'tenant-1',
          deletedAt: null,
          isActive: true,
        },
      }),
    );
    expect(result.contacts[0]?.email).toBe('company@example.com');
  });
});
