import { describe, expect, it } from 'vitest';
import { taskListUrl } from '@/hooks/use-tasks';
import { taskListQuerySchema } from '@/lib/validations/task-api';
import { buildTaskWhere } from '@/services/tasks/task.service';

describe('task list filter contract', () => {
  it('validates and serializes column text and due-date range filters', () => {
    const parsed = taskListQuerySchema.parse({
      title: '  annual return  ',
      ownerQuery: '  sam@example.com  ',
      dueDateFrom: '2026-07-01',
      dueDateTo: '2026-07-31',
    });

    expect(parsed).toMatchObject({
      title: 'annual return',
      ownerQuery: 'sam@example.com',
      dueDateFrom: '2026-07-01',
      dueDateTo: '2026-07-31',
    });
    expect(taskListUrl(parsed)).toBe(
      '/api/tasks?title=annual+return&ownerQuery=sam%40example.com'
      + '&dueDateFrom=2026-07-01&dueDateTo=2026-07-31&page=1&limit=20'
      + '&sortBy=dueDate&sortOrder=asc',
    );
  });

  it('builds title, owner, and inclusive due-date filters together', () => {
    expect(buildTaskWhere('tenant-1', {
      title: 'annual',
      ownerQuery: 'sam',
      dueDateFrom: '2026-07-01',
      dueDateTo: '2026-07-31',
    })).toEqual({
      tenantId: 'tenant-1',
      deletedAt: null,
      title: { contains: 'annual', mode: 'insensitive' },
      dueDate: {
        gte: new Date('2026-07-01T00:00:00.000Z'),
        lt: new Date('2026-08-01T00:00:00.000Z'),
      },
      AND: [{
        OR: [
          { owner: { firstName: { contains: 'sam', mode: 'insensitive' } } },
          { owner: { lastName: { contains: 'sam', mode: 'insensitive' } } },
          { owner: { email: { contains: 'sam', mode: 'insensitive' } } },
        ],
      }],
    });
  });
});
