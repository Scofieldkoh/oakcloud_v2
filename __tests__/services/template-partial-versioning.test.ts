import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@/generated/prisma';

const prismaMock = vi.hoisted(() => ({
  templatePartial: {
    findFirst: vi.fn(),
    findFirstOrThrow: vi.fn(),
    updateMany: vi.fn(),
  },
  $transaction: vi.fn(),
}));
const auditMock = vi.hoisted(() => ({
  createAuditLog: vi.fn(),
  computeChanges: vi.fn(
    (): Record<string, { old: unknown; new: unknown }> => ({
      displayName: { old: 'Old name', new: 'Renamed' },
    }),
  ),
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/audit', () => auditMock);

import { updateTemplatePartial } from '@/services/template-partial.service';
import {
  editorPlaceholdersToStorage,
  storagePlaceholdersToEditor,
} from '@/lib/template-placeholder-storage';

const actor = { tenantId: 'tenant-1', userId: 'user-1' };
const partial = {
  id: 'partial-1',
  tenantId: actor.tenantId,
  name: 'accounting-sow',
  displayName: 'Old name',
  description: null,
  content: '<p>Scope</p>',
  placeholders: [{ key: 'service.fields.software' }],
  version: 3,
  deletedAt: null,
};

describe('template partial material versioning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (callback) => callback(prismaMock));
    prismaMock.templatePartial.findFirst.mockResolvedValue(partial);
    prismaMock.templatePartial.updateMany.mockResolvedValue({ count: 1 });
  });

  it('bumps the revision but records no material change for metadata-only edits', async () => {
    prismaMock.templatePartial.findFirstOrThrow.mockResolvedValue({
      ...partial,
      displayName: 'Renamed',
      version: 4,
    });

    await updateTemplatePartial(
      { id: partial.id, displayName: 'Renamed' },
      actor,
    );

    expect(prismaMock.templatePartial.updateMany).toHaveBeenCalledWith({
      where: { id: partial.id, tenantId: actor.tenantId, deletedAt: null },
      data: { displayName: 'Renamed', version: { increment: 1 } },
    });
    expect(auditMock.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { oldVersion: 3, newVersion: 4, materialChanged: false },
      }),
      prismaMock,
    );
  });

  it('refuses content changes to A4 partials now that the editor is retired', async () => {
    await expect(updateTemplatePartial(
      { id: partial.id, content: '<p>Updated scope</p>' },
      actor,
    )).rejects.toMatchObject({ details: { reason: 'A4_EDITOR_RETIRED', operation: 'partial-edit' } });
    expect(prismaMock.templatePartial.updateMany).not.toHaveBeenCalled();
  });

  it('records no material change when a display-name edit resubmits unchanged service placeholders', async () => {
    const stored = [{
      key: 'service.fields.software',
      label: 'Accounting software',
      type: 'textarea',
      source: 'service',
      category: 'service-input',
      path: 'service.fields.software',
      required: true,
    }];
    prismaMock.templatePartial.findFirst.mockResolvedValue({
      ...partial,
      placeholders: stored,
    });
    prismaMock.templatePartial.findFirstOrThrow.mockResolvedValue({
      ...partial,
      displayName: 'Renamed',
      placeholders: stored,
      version: 4,
    });

    await updateTemplatePartial(
      {
        id: partial.id,
        displayName: 'Renamed',
        placeholders: editorPlaceholdersToStorage(
          storagePlaceholdersToEditor(stored),
        ) as Prisma.InputJsonValue,
      },
      actor,
    );

    expect(prismaMock.templatePartial.updateMany).toHaveBeenCalledWith({
      where: { id: partial.id, tenantId: actor.tenantId, deletedAt: null },
      data: {
        displayName: 'Renamed',
        placeholders: stored,
        version: { increment: 1 },
      },
    });
    expect(auditMock.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ materialChanged: false }),
      }),
      prismaMock,
    );
  });

  it('increments exactly once and records a material change when a service placeholder definition changes', async () => {
    const changed = [{
      key: 'service.fields.software',
      label: 'Preferred accounting software',
      type: 'text',
      source: 'service',
      required: true,
    }];
    prismaMock.templatePartial.findFirstOrThrow.mockResolvedValue({
      ...partial,
      placeholders: changed,
      version: 4,
    });

    await updateTemplatePartial(
      { id: partial.id, placeholders: changed },
      actor,
    );

    expect(prismaMock.templatePartial.updateMany).toHaveBeenCalledWith({
      where: { id: partial.id, tenantId: actor.tenantId, deletedAt: null },
      data: {
        placeholders: changed,
        version: { increment: 1 },
      },
    });
    expect(prismaMock.templatePartial.updateMany).toHaveBeenCalledOnce();
    expect(auditMock.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { oldVersion: 3, newVersion: 4, materialChanged: true },
      }),
      prismaMock,
    );
  });
});
