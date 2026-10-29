import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFormFindMany = vi.fn();
const mockFormCount = vi.fn();
const mockFormFindFirst = vi.fn();
const mockFormFindUnique = vi.fn();
const mockFormUpdate = vi.fn();
const mockFormUploadFindMany = vi.fn();
const mockFormDelete = vi.fn();
const mockStorageDelete = vi.fn();
const mockCreateAuditLog = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    form: {
      findMany: mockFormFindMany,
      count: mockFormCount,
      findFirst: mockFormFindFirst,
      findUnique: mockFormFindUnique,
      update: mockFormUpdate,
      delete: mockFormDelete,
    },
    formUpload: {
      findMany: mockFormUploadFindMany,
    },
  },
}));

vi.mock('@/lib/audit', () => ({
  createAuditLog: mockCreateAuditLog,
}));

vi.mock('@/lib/storage', () => ({
  storage: {
    delete: mockStorageDelete,
  },
}));

describe('form archive behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateAuditLog.mockResolvedValue({});
  });

  it('lists archived forms without excluding archived rows by deletedAt', async () => {
    const archivedForm = {
      id: 'form-1',
      tenantId: 'tenant-1',
      title: 'Archived Form',
      status: 'ARCHIVED',
      slug: 'archived-form',
      viewsCount: 0,
      submissionsCount: 0,
      _count: { fields: 2, submissions: 1 },
    };
    mockFormFindMany.mockResolvedValue([archivedForm]);
    mockFormCount.mockResolvedValue(1);

    const { listForms } = await import('@/services/form-crud.service');
    const result = await listForms(
      { status: 'ARCHIVED', page: 1, limit: 20, sortBy: 'updatedAt', sortOrder: 'desc' },
      { tenantId: 'tenant-1', userId: 'user-1' }
    );

    expect(mockFormFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 'tenant-1', status: 'ARCHIVED' },
    }));
    expect(result.forms).toHaveLength(1);
    expect(result.forms[0].responseCount).toBe(1);
  });

  it('archives a form without hiding it and releases the public slug', async () => {
    const existing = {
      id: 'form-1',
      tenantId: 'tenant-1',
      title: 'Client Intake',
      slug: 'client-intake',
      status: 'PUBLISHED',
      deletedAt: null,
    };
    mockFormFindFirst.mockResolvedValue(existing);
    mockFormUpdate.mockResolvedValue({
      ...existing,
      status: 'ARCHIVED',
      slug: 'archived-form-1',
      deletedAt: null,
    });

    const { deleteForm } = await import('@/services/form-crud.service');
    await deleteForm('form-1', { tenantId: 'tenant-1', userId: 'user-1' });

    expect(mockFormUpdate).toHaveBeenCalledWith({
      where: { id: 'form-1' },
      data: expect.objectContaining({
        deletedAt: null,
        status: 'ARCHIVED',
        slug: 'archived-form-1',
      }),
    });
  });

  it('loads archived form details even when older rows still have deletedAt set', async () => {
    const archivedAt = new Date('2026-01-01T00:00:00.000Z');
    mockFormFindFirst.mockResolvedValue({
      id: 'form-1',
      tenantId: 'tenant-1',
      title: 'Archived Form',
      status: 'ARCHIVED',
      slug: 'archived-form-1',
      deletedAt: archivedAt,
      fields: [],
      tenant: { logoUrl: null, name: 'Oak Workspace' },
    });

    const { getFormById } = await import('@/services/form-crud.service');
    const form = await getFormById('form-1', 'tenant-1');

    expect(mockFormFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'form-1',
        tenantId: 'tenant-1',
        OR: [{ deletedAt: null }, { status: 'ARCHIVED' }],
      },
    }));
    expect(form?.status).toBe('ARCHIVED');
  });

  it('releases archived slug conflicts before assigning a public slug to an active form', async () => {
    const activeForm = {
      id: 'form-active',
      tenantId: 'tenant-1',
      title: 'Active Form',
      slug: 'active-form',
      status: 'DRAFT',
      deletedAt: null,
    };
    mockFormFindFirst.mockResolvedValue(activeForm);
    mockFormFindUnique.mockResolvedValue({
      id: 'form-archived',
      slug: 'client-intake',
      status: 'ARCHIVED',
      deletedAt: null,
    });
    mockFormUpdate
      .mockResolvedValueOnce({
        id: 'form-archived',
        slug: 'archived-form-archived',
        status: 'ARCHIVED',
      })
      .mockResolvedValueOnce({
        ...activeForm,
        slug: 'client-intake',
      });

    const { updateForm } = await import('@/services/form-crud.service');
    await updateForm(
      'form-active',
      { slug: 'client-intake' },
      { tenantId: 'tenant-1', userId: 'user-1' }
    );

    expect(mockFormUpdate).toHaveBeenNthCalledWith(1, {
      where: { id: 'form-archived' },
      data: { slug: 'archived-form-archived' },
    });
    expect(mockFormUpdate).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { id: 'form-active' },
      data: expect.objectContaining({ slug: 'client-intake' }),
    }));
  });

  it('permanently deletes archived forms and their stored uploads', async () => {
    const archivedForm = {
      id: 'form-1',
      tenantId: 'tenant-1',
      title: 'Archived Form',
      slug: 'archived-form-1',
      status: 'ARCHIVED',
      deletedAt: null,
    };
    mockFormFindFirst.mockResolvedValue(archivedForm);
    mockFormUploadFindMany.mockResolvedValue([
      { id: 'upload-1', storageKey: 'tenant-1/forms/form-1/uploads/upload-1.pdf' },
      { id: 'upload-2', storageKey: 'tenant-1/forms/form-1/uploads/upload-2.pdf' },
    ]);
    mockStorageDelete.mockResolvedValue(undefined);
    mockFormDelete.mockResolvedValue(archivedForm);

    const { hardDeleteArchivedForm } = await import('@/services/form-crud.service');
    const deleted = await hardDeleteArchivedForm('form-1', { tenantId: 'tenant-1', userId: 'user-1' });

    expect(mockStorageDelete).toHaveBeenCalledWith('tenant-1/forms/form-1/uploads/upload-1.pdf');
    expect(mockStorageDelete).toHaveBeenCalledWith('tenant-1/forms/form-1/uploads/upload-2.pdf');
    expect(mockFormDelete).toHaveBeenCalledWith({ where: { id: 'form-1' } });
    expect(deleted.id).toBe('form-1');
  });

  it('rejects permanent deletion for non-archived forms', async () => {
    mockFormFindFirst.mockResolvedValue({
      id: 'form-1',
      tenantId: 'tenant-1',
      title: 'Published Form',
      slug: 'published-form',
      status: 'PUBLISHED',
      deletedAt: null,
    });

    const { hardDeleteArchivedForm } = await import('@/services/form-crud.service');

    await expect(hardDeleteArchivedForm('form-1', { tenantId: 'tenant-1', userId: 'user-1' }))
      .rejects.toThrow('Only archived forms can be permanently deleted');
    expect(mockFormDelete).not.toHaveBeenCalled();
  });
});
