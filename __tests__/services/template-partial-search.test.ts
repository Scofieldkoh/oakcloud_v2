import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  documentTemplate: {
    findMany: vi.fn(),
  },
  templatePartial: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/audit', () => ({
  createAuditLog: vi.fn(),
  computeChanges: vi.fn(() => null),
}));

import { searchTemplatePartials } from '@/services/template-partial.service';

const actor = { tenantId: 'tenant-1', userId: 'user-1' };
const wordFilter = { path: ['oakDoc', 'schemaVersion'], equals: 1 };

describe('template partial search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.templatePartial.findMany.mockResolvedValue([]);
    prismaMock.templatePartial.count.mockResolvedValue(0);
    prismaMock.documentTemplate.findMany.mockResolvedValue([]);
  });

  it('lists Word partials by their OakDoc metadata', async () => {
    await searchTemplatePartials({ editor: 'oakdoc' }, actor);

    const listCall = prismaMock.templatePartial.findMany.mock.calls[0]?.[0];
    expect(listCall.where).toMatchObject({ tenantId: 'tenant-1', deletedAt: null, contentJson: wordFilter });
  });

  it('keeps unfiltered searches for other callers', async () => {
    await searchTemplatePartials({}, actor);

    const listCall = prismaMock.templatePartial.findMany.mock.calls[0]?.[0];
    expect(listCall.where).not.toHaveProperty('contentJson');
    expect(listCall.where).not.toHaveProperty('id');
  });

  it('applies the table column filters, matching the name or display name', async () => {
    await searchTemplatePartials(
      { editor: 'oakdoc', name: 'Director', createdBy: 'Lim', updatedFrom: '2026-10-05', updatedTo: '2026-10-05', category: 'RESOLUTION' },
      actor,
    );

    const listCall = prismaMock.templatePartial.findMany.mock.calls[0]?.[0];
    expect(listCall.where).toMatchObject({
      category: 'RESOLUTION',
      AND: [{
        OR: [
          { name: { contains: 'Director', mode: 'insensitive' } },
          { displayName: { contains: 'Director', mode: 'insensitive' } },
        ],
      }],
      createdBy: {
        OR: [
          { firstName: { contains: 'Lim', mode: 'insensitive' } },
          { lastName: { contains: 'Lim', mode: 'insensitive' } },
        ],
      },
      updatedAt: {
        gte: new Date('2026-10-05T00:00:00.000'),
        lte: new Date('2026-10-05T23:59:59.999'),
      },
    });
  });

  it('sorts by category or creator with a stable name order', async () => {
    await searchTemplatePartials({ sortBy: 'category', sortOrder: 'desc' }, actor);
    await searchTemplatePartials({ sortBy: 'createdBy', sortOrder: 'asc' }, actor);
    await searchTemplatePartials({}, actor);

    expect(prismaMock.templatePartial.findMany.mock.calls[0]?.[0].orderBy).toEqual([{ category: 'desc' }, { name: 'asc' }]);
    expect(prismaMock.templatePartial.findMany.mock.calls[1]?.[0].orderBy).toEqual([{ createdBy: { firstName: 'asc' } }, { name: 'asc' }]);
    expect(prismaMock.templatePartial.findMany.mock.calls[2]?.[0].orderBy).toEqual([{ name: 'asc' }]);
  });

  it('filters by reference key and description', async () => {
    await searchTemplatePartials({ reference: ' director ', description: 'resign' }, actor);

    const listCall = prismaMock.templatePartial.findMany.mock.calls[0]?.[0];
    expect(listCall.where).toMatchObject({
      AND: [{ name: { contains: 'director', mode: 'insensitive' } }],
      description: { contains: 'resign', mode: 'insensitive' },
    });
  });

  it('counts template usage once per template from one template read', async () => {
    prismaMock.templatePartial.findMany.mockResolvedValue([
      { id: 'p1', name: 'header' },
      { id: 'p2', name: 'footer' },
    ]);
    prismaMock.templatePartial.count.mockResolvedValue(2);
    prismaMock.documentTemplate.findMany.mockResolvedValue([
      { content: '{{> header }} {{> header }}' },
      { content: '{{> header }}' },
    ]);

    const result = await searchTemplatePartials({}, actor);

    expect(prismaMock.documentTemplate.findMany).toHaveBeenCalledTimes(1);
    expect(result.partials.map((partial) => partial._count?.usedInTemplates)).toEqual([2, 0]);
  });

  it('filters by usage and pages the filtered list', async () => {
    prismaMock.templatePartial.findMany.mockResolvedValue([
      { id: 'p1', name: 'a' },
      { id: 'p2', name: 'b' },
      { id: 'p3', name: 'c' },
    ]);
    prismaMock.documentTemplate.findMany.mockResolvedValue([{ content: '{{> a }} {{> c }}' }]);

    const used = await searchTemplatePartials({ usage: 'used', page: 2, limit: 1 }, actor);
    const unused = await searchTemplatePartials({ usage: 'unused' }, actor);

    expect(prismaMock.templatePartial.findMany.mock.calls[0]?.[0]).not.toHaveProperty('skip');
    expect(used).toMatchObject({ total: 2, totalPages: 2, page: 2 });
    expect(used.partials.map((partial) => partial.id)).toEqual(['p3']);
    expect(unused.partials.map((partial) => partial.id)).toEqual(['p2']);
    expect(prismaMock.templatePartial.count).not.toHaveBeenCalled();
  });
});
