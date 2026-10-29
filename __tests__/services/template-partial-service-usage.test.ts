import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  templatePartial: {
    findFirst: vi.fn(),
    updateMany: vi.fn(),
  },
  documentTemplate: {
    findMany: vi.fn(),
  },
  serviceVariant: {
    findMany: vi.fn(),
  },
  $transaction: vi.fn(),
}));
const auditMock = vi.hoisted(() => ({
  createAuditLog: vi.fn(),
  computeChanges: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/audit', () => auditMock);

import {
  deleteTemplatePartial,
  getPartialUsage,
} from '@/services/template-partial.service';

const actor = { tenantId: 'tenant-1', userId: 'user-1' };
const partial = {
  id: 'partial-1',
  tenantId: actor.tenantId,
  name: 'accounting-sow',
  displayName: 'Accounting SOW',
  description: null,
  content: '<p>Scope</p>',
  placeholders: [],
  version: 1,
  deletedAt: null,
};

describe('template partial service-variant usage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.templatePartial.findFirst.mockResolvedValue(partial);
    prismaMock.documentTemplate.findMany.mockResolvedValue([]);
    prismaMock.serviceVariant.findMany.mockResolvedValue([]);
    prismaMock.$transaction.mockImplementation(async (callback) => callback(prismaMock));
    prismaMock.templatePartial.updateMany.mockResolvedValue({ count: 1 });
  });

  it('rejects deletion while any same-tenant non-deleted variant references the partial', async () => {
    prismaMock.serviceVariant.findMany.mockResolvedValue([
      { id: 'variant-1', name: 'Monthly Accounting', isActive: false },
    ]);

    await expect(
      deleteTemplatePartial(partial.id, actor),
    ).rejects.toThrow(
      'Monthly Accounting',
    );

    expect(prismaMock.serviceVariant.findMany).toHaveBeenCalledWith({
      where: {
        tenantId: actor.tenantId,
        sowPartialId: partial.id,
        deletedAt: null,
      },
      select: { id: true, name: true, isActive: true },
      orderBy: { name: 'asc' },
    });
    expect(prismaMock.templatePartial.updateMany).not.toHaveBeenCalled();
  });

  it('includes service variants in the usage result without cross-tenant reads', async () => {
    prismaMock.serviceVariant.findMany.mockResolvedValue([
      { id: 'variant-1', name: 'Monthly Accounting', isActive: true },
    ]);

    const usage = await getPartialUsage(partial.id, actor);

    expect(usage.serviceVariants).toEqual([
      { id: 'variant-1', name: 'Monthly Accounting', isActive: true },
    ]);
    expect(usage.templates).toEqual([]);
  });

  it('allows deletion after every same-tenant variant has been archived', async () => {
    await deleteTemplatePartial(partial.id, actor);

    expect(prismaMock.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: 'Serializable' },
    );
    expect(prismaMock.templatePartial.updateMany).toHaveBeenCalledWith({
      where: { id: partial.id, tenantId: actor.tenantId, deletedAt: null },
      data: { deletedAt: expect.any(Date), version: { increment: 1 } },
    });
    expect(auditMock.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: partial.id, action: 'DELETE' }),
      prismaMock,
    );
  });

  it('keeps the delete mutation inside the transaction when its audit fails', async () => {
    auditMock.createAuditLog.mockRejectedValueOnce(new Error('Audit unavailable'));

    await expect(deleteTemplatePartial(partial.id, actor)).rejects.toThrow(
      'Audit unavailable',
    );

    expect(prismaMock.templatePartial.updateMany).toHaveBeenCalledOnce();
    expect(prismaMock.$transaction).toHaveBeenCalledOnce();
  });
});
