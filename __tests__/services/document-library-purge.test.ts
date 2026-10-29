// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  documentTemplate: { findFirst: vi.fn(), delete: vi.fn() },
  templatePartial: { findFirst: vi.fn(), findMany: vi.fn(), delete: vi.fn(), updateMany: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import {
  permanentlyDeleteDocumentTemplate,
  permanentlyDeleteTemplatePartial,
  restoreTemplatePartials,
} from '@/services/document-library-purge.service';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('document library purge', () => {
  it('purges only deleted templates that no generation batch uses', async () => {
    prismaMock.documentTemplate.findFirst.mockResolvedValueOnce({
      id: 't-1', name: 'Old letter', _count: { generationBatchItems: 0 },
    });
    await expect(permanentlyDeleteDocumentTemplate('t-1')).resolves.toEqual({ id: 't-1', name: 'Old letter' });
    expect(prismaMock.documentTemplate.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 't-1', deletedAt: { not: null } },
    }));
    expect(prismaMock.documentTemplate.delete).toHaveBeenCalledWith({ where: { id: 't-1' } });

    prismaMock.documentTemplate.findFirst.mockResolvedValueOnce({
      id: 't-2', name: 'Batch letter', _count: { generationBatchItems: 1 },
    });
    await expect(permanentlyDeleteDocumentTemplate('t-2')).rejects.toMatchObject({ statusCode: 409 });

    prismaMock.documentTemplate.findFirst.mockResolvedValueOnce(null);
    await expect(permanentlyDeleteDocumentTemplate('t-live')).rejects.toMatchObject({ statusCode: 404 });
    expect(prismaMock.documentTemplate.delete).toHaveBeenCalledOnce();
  });

  it('refuses to purge a partial used as a Statement of Work', async () => {
    prismaMock.templatePartial.findFirst.mockResolvedValueOnce({
      id: 'p-1', name: 'sow', _count: { serviceVariants: 1, serviceAgreementItems: 0 },
    });
    await expect(permanentlyDeleteTemplatePartial('p-1')).rejects.toMatchObject({ statusCode: 409 });

    prismaMock.templatePartial.findFirst.mockResolvedValueOnce({
      id: 'p-2', name: 'address', _count: { serviceVariants: 0, serviceAgreementItems: 0 },
    });
    await expect(permanentlyDeleteTemplatePartial('p-2')).resolves.toEqual({ id: 'p-2', name: 'address' });
    expect(prismaMock.templatePartial.delete).toHaveBeenCalledWith({ where: { id: 'p-2' } });
  });

  it('restores only partials that are deleted', async () => {
    prismaMock.templatePartial.findMany.mockResolvedValueOnce([{ id: 'p-3', name: 'footer' }]);
    await expect(restoreTemplatePartials(['p-3', 'p-live'])).resolves.toEqual([{ id: 'p-3', name: 'footer' }]);
    expect(prismaMock.templatePartial.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['p-3'] }, deletedAt: { not: null } },
      data: { deletedAt: null, version: { increment: 1 } },
    });
  });
});
