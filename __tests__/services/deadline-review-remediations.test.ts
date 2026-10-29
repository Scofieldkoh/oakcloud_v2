import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  deadlineOccurrence: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { listDeadlines } from '@/services/deadline';

const actor = { tenantId: 'tenant-1', userId: 'user-1' };
const search = {
  from: '2026-08-01',
  to: '2026-08-31',
  mode: 'TABLE' as const,
  types: ['STATUTORY', 'CLIENT', 'INTERNAL'] as const,
  familyIds: [],
  companyIds: [],
  statuses: [],
  timing: [],
  openOnly: true,
  page: 1,
  limit: 50,
  sortBy: 'dueDate' as const,
  sortOrder: 'asc' as const,
};

describe('deadline service review remediations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.deadlineOccurrence.findMany.mockResolvedValue([]);
    prismaMock.deadlineOccurrence.count.mockResolvedValue(0);
  });

  it('matches company aliases and UENs and normalizes displayed milestone labels', async () => {
    await listDeadlines({ ...search, companyQuery: 'Oaktree', serviceQuery: 'Annual Return', milestoneQuery: 'Annual Return' }, actor);

    expect(prismaMock.deadlineOccurrence.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        company: expect.objectContaining({
          OR: [
            { name: { contains: 'Oaktree', mode: 'insensitive' } },
            { displayAlias: { contains: 'Oaktree', mode: 'insensitive' } },
            { uen: { contains: 'Oaktree', mode: 'insensitive' } },
          ],
        }),
        milestoneKey: { contains: 'annual-return', mode: 'insensitive' },
      }),
    }));
  });
});
