import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    contact: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    companyContact: { findMany: vi.fn() },
    companyOfficer: { findMany: vi.fn() },
    companyShareholder: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/audit', () => ({
  createAuditLog: vi.fn(),
  computeChanges: vi.fn(() => []),
}));

import { prisma } from '@/lib/prisma';
import { searchContactsWithCounts } from '@/services/contact.service';

const makeContact = (id: string, fullName: string) => ({
  id,
  tenantId: 'tenant-1',
  fullName,
  contactDetails: [],
});

describe('searchContactsWithCounts company count filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.contact.count).mockResolvedValue(2);
    vi.mocked(prisma.companyOfficer.findMany).mockResolvedValue([]);
    vi.mocked(prisma.companyShareholder.findMany).mockResolvedValue([]);
    vi.mocked(prisma.companyContact.findMany).mockResolvedValue([
      {
        contactId: 'contact-2',
        companyId: 'company-1',
        relationship: 'Client',
      },
    ] as never);
  });

  it('includes matches from later unfiltered pages before paginating', async () => {
    const firstUnfilteredContact = makeContact('contact-1', 'Alpha');
    const laterMatchingContact = makeContact('contact-2', 'Beta');

    vi.mocked(prisma.contact.findMany).mockImplementation(((
      args: Parameters<typeof prisma.contact.findMany>[0],
    ) => {
      if (args?.select && 'id' in args.select) {
        return [{ id: 'contact-1' }, { id: 'contact-2' }];
      }

      const conditions = Array.isArray(args?.where?.AND) ? args.where.AND : [];
      const hasFilteredIds = conditions.some((condition) => (
        typeof condition === 'object' &&
        condition !== null &&
        'id' in condition
      ));

      return hasFilteredIds ? [laterMatchingContact] : [firstUnfilteredContact];
    }) as never);

    const result = await searchContactsWithCounts(
      {
        page: 1,
        limit: 1,
        sortBy: 'fullName',
        sortOrder: 'asc',
        companiesMin: 1,
      },
      'tenant-1',
    );

    expect(result.contacts.map((contact) => contact.id)).toEqual(['contact-2']);
    expect(result.total).toBe(1);
    expect(result.totalPages).toBe(1);
  });
});
