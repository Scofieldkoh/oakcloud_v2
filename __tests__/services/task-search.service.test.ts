import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  taskFindMany,
  taskCount,
  transaction,
} = vi.hoisted(() => ({
  taskFindMany: vi.fn(),
  taskCount: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: {
      findMany: taskFindMany,
      count: taskCount,
    },
    $transaction: transaction,
  },
}));

vi.mock('@/lib/audit', () => ({ createAuditLog: vi.fn() }));

import { searchTasks } from '@/services/tasks/task.service';

const tenantId = '11111111-1111-4111-8111-111111111111';

describe('searchTasks query construction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 24, 12, 0, 0));
    taskFindMany.mockResolvedValue([]);
    taskCount.mockResolvedValue(0);
    transaction.mockImplementation((operations: Array<Promise<unknown>>) => (
      Promise.all(operations)
    ));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ['overdue', -Infinity, 0],
    ['today', 0, 1],
    ['thisWeek', 1, 8],
    ['nextWeek', 8, 15],
  ] as const)(
    'builds bounded %s due predicates that cannot match null due dates',
    async (dueBucket, startOffset, endOffset) => {
      await searchTasks(tenantId, { dueBucket });

      const call = taskFindMany.mock.calls.at(-1)?.[0];
      const dueDate = call.where.dueDate as { gte?: Date; lt?: Date };
      const midnight = new Date(Date.UTC(2026, 6, 24));

      if (Number.isFinite(startOffset)) {
        expect(dueDate.gte).toEqual(new Date(Date.UTC(
          midnight.getUTCFullYear(),
          midnight.getUTCMonth(),
          midnight.getUTCDate() + startOffset,
        )));
      } else {
        expect(dueDate).not.toHaveProperty('gte');
      }
      expect(dueDate.lt).toEqual(new Date(Date.UTC(
        midnight.getUTCFullYear(),
        midnight.getUTCMonth(),
        midnight.getUTCDate() + endOffset,
      )));
      expect(dueDate).not.toEqual({});
      expect(call.where).not.toHaveProperty('dueDate.equals', null);
    },
  );

  it('combines tenant, relation, status, and text filters in the Prisma where input', async () => {
    await searchTasks(tenantId, {
      query: 'annual',
      pipelineId: 'pipeline-1',
      companyId: 'company-1',
      ownerId: 'owner-1',
      status: 'IN_PROGRESS',
    });

    expect(taskFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        tenantId,
        deletedAt: null,
        companyId: 'company-1',
        ownerId: 'owner-1',
        status: 'IN_PROGRESS',
        pipelineVersion: { pipelineId: 'pipeline-1' },
        AND: expect.arrayContaining([
          expect.objectContaining({
            OR: expect.arrayContaining([
              { title: { contains: 'annual', mode: 'insensitive' } },
              { company: { name: { contains: 'annual', mode: 'insensitive' } } },
              {
                pipelineVersion: {
                  pipeline: { name: { contains: 'annual', mode: 'insensitive' } },
                },
              },
            ]),
          }),
        ]),
      }),
    }));
    expect(taskCount).toHaveBeenCalledWith({
      where: expect.objectContaining({ tenantId, companyId: 'company-1' }),
    });
  });

  it.each([
    [
      'dueDate',
      'asc',
      [
        { dueDate: { sort: 'asc', nulls: 'last' } },
        { createdAt: 'desc' },
      ],
    ],
    [
      'pipeline',
      'desc',
      [
        { pipelineVersion: { pipeline: { name: 'desc' } } },
        { createdAt: 'desc' },
      ],
    ],
    [
      'owner',
      'asc',
      [
        { owner: { firstName: 'asc' } },
        { owner: { lastName: 'asc' } },
        { createdAt: 'desc' },
      ],
    ],
  ] as const)(
    'builds %s sorting and pagination',
    async (sortBy, sortOrder, orderBy) => {
      await searchTasks(tenantId, {
        page: 3,
        limit: 10,
        sortBy,
        sortOrder,
      });

      expect(taskFindMany).toHaveBeenCalledWith(expect.objectContaining({
        orderBy,
        skip: 20,
        take: 10,
      }));
    },
  );
});
