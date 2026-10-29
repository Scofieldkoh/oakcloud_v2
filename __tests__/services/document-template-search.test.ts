import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  documentTemplate: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/audit', () => ({
  createAuditLog: vi.fn(),
  computeChanges: vi.fn(() => null),
}));

import { searchDocumentTemplates } from '@/services/document-template.service';

describe('document-template search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.documentTemplate.findMany.mockResolvedValue([]);
    prismaMock.documentTemplate.count.mockResolvedValue(0);
  });

  it('filters OakDoc manager searches by OakDoc metadata', async () => {
    await searchDocumentTemplates(
      {
        editor: 'oakdoc',
        page: 1,
        limit: 20,
        sortBy: 'name',
        sortOrder: 'asc',
      },
      'tenant-1',
    );

    expect(prismaMock.documentTemplate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'tenant-1',
          deletedAt: null,
          contentJson: {
            path: ['oakDoc', 'schemaVersion'],
            equals: 1,
          },
        }),
      }),
    );
    expect(prismaMock.documentTemplate.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        contentJson: {
          path: ['oakDoc', 'schemaVersion'],
          equals: 1,
        },
      }),
    });
  });

  it('keeps legacy template searches unfiltered by editor type', async () => {
    await searchDocumentTemplates(
      {
        page: 1,
        limit: 20,
        sortBy: 'name',
        sortOrder: 'asc',
      },
      'tenant-1',
    );

    const firstCall = prismaMock.documentTemplate.findMany.mock.calls[0]?.[0];
    expect(firstCall.where).not.toHaveProperty('contentJson');
  });

  it('applies the table column filters and sorts by usage with a stable name order', async () => {
    await searchDocumentTemplates(
      {
        editor: 'oakdoc',
        name: ' Board ',
        createdBy: 'Tan',
        updatedFrom: '2026-10-01',
        updatedTo: '2026-10-05',
        page: 2,
        limit: 50,
        sortBy: 'usage',
        sortOrder: 'desc',
      },
      'tenant-1',
    );

    const listCall = prismaMock.documentTemplate.findMany.mock.calls[0]?.[0];
    expect(listCall.where).toMatchObject({
      name: { contains: 'Board', mode: 'insensitive' },
      createdBy: {
        OR: [
          { firstName: { contains: 'Tan', mode: 'insensitive' } },
          { lastName: { contains: 'Tan', mode: 'insensitive' } },
        ],
      },
      updatedAt: {
        gte: new Date('2026-10-01T00:00:00.000'),
        lte: new Date('2026-10-05T23:59:59.999'),
      },
    });
    expect(listCall.orderBy).toEqual([{ generatedDocuments: { _count: 'desc' } }, { name: 'asc' }]);
    expect(listCall.skip).toBe(50);
  });

  it('sorts by status and creator name', async () => {
    await searchDocumentTemplates({ page: 1, limit: 20, sortBy: 'isActive', sortOrder: 'asc' }, 'tenant-1');
    await searchDocumentTemplates({ page: 1, limit: 20, sortBy: 'createdBy', sortOrder: 'desc' }, 'tenant-1');

    expect(prismaMock.documentTemplate.findMany.mock.calls[0]?.[0].orderBy).toEqual([{ isActive: 'asc' }, { name: 'asc' }]);
    expect(prismaMock.documentTemplate.findMany.mock.calls[1]?.[0].orderBy).toEqual([{ createdBy: { firstName: 'desc' } }, { name: 'asc' }]);
  });

  it('filters by description, exact version and whether documents were generated', async () => {
    await searchDocumentTemplates({ page: 1, limit: 20, sortBy: 'name', sortOrder: 'asc', description: 'board', version: 3, usage: 'used' }, 'tenant-1');
    await searchDocumentTemplates({ page: 1, limit: 20, sortBy: 'name', sortOrder: 'asc', usage: 'unused' }, 'tenant-1');

    expect(prismaMock.documentTemplate.findMany.mock.calls[0]?.[0].where).toMatchObject({
      description: { contains: 'board', mode: 'insensitive' },
      version: 3,
      generatedDocuments: { some: {} },
    });
    expect(prismaMock.documentTemplate.findMany.mock.calls[1]?.[0].where).toMatchObject({
      generatedDocuments: { none: {} },
    });
  });
});
