import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createMany: vi.fn(),
  findMany: vi.fn(),
  findFirst: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  fieldCount: vi.fn(),
  transaction: vi.fn(),
  audit: vi.fn(),
}));

const tx = {
  formOptionPreset: {
    create: mocks.create,
    update: mocks.update,
    delete: mocks.delete,
    findFirst: mocks.findFirst,
  },
  formField: { count: mocks.fieldCount },
};

vi.mock('@/lib/prisma', () => ({
  prisma: {
    formOptionPreset: {
      createMany: mocks.createMany,
      findMany: mocks.findMany,
      findFirst: mocks.findFirst,
    },
    $transaction: mocks.transaction,
  },
}));
vi.mock('@/lib/audit', () => ({ createAuditLog: mocks.audit }));

import { ConflictError, ForbiddenError, NotFoundError } from '@/lib/errors';
import {
  createFormOptionPreset,
  deleteFormOptionPreset,
  ensureBuiltInFormOptionPresets,
  normalizePresetKey,
  replaceFormOptionPreset,
  resolvePresetOptionsForFields,
} from '@/services/form-option-preset.service';

describe('form option preset service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createMany.mockResolvedValue({ count: 3 });
    mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));
    mocks.audit.mockResolvedValue(undefined);
  });

  it('creates protected built-ins idempotently with the supplied SSIC dataset', async () => {
    await ensureBuiltInFormOptionPresets('tenant-1', 'user-1');

    expect(mocks.createMany).toHaveBeenCalledWith(expect.objectContaining({
      skipDuplicates: true,
      data: expect.arrayContaining([
        expect.objectContaining({
          tenantId: 'tenant-1',
          builtInKey: 'countries',
          isProtected: true,
          allowCsvReplace: false,
        }),
        expect.objectContaining({
          tenantId: 'tenant-1',
          builtInKey: 'ssic',
          isProtected: true,
          allowCsvReplace: true,
          options: expect.arrayContaining([
            { value: '01111', label: '01111 - Growing of leafy and fruit vegetables (non-hydroponics)' },
            { value: '99090', label: '99090 - Other extra-territorial organisations and bodies' },
          ]),
          optionCount: 988,
        }),
      ]),
    }));
  });

  it('normalizes names consistently and rejects tenant-local name conflicts', async () => {
    expect(normalizePresetKey('  My   Client_List ')).toBe('my client list');
    mocks.findFirst.mockResolvedValue({ id: 'existing' });

    await expect(createFormOptionPreset({
      tenantId: 'tenant-1',
      userId: 'user-1',
      name: 'My Client List',
      options: [{ value: 'A', label: 'Alpha' }],
    })).rejects.toBeInstanceOf(ConflictError);

    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 'tenant-1', normalizedKey: 'my client list' },
    }));
  });

  it('allows replacing SSIC while rejecting replacement of immutable built-ins', async () => {
    mocks.findFirst.mockResolvedValueOnce({
      id: 'ssic-1', tenantId: 'tenant-1', name: 'SSIC', normalizedKey: 'ssic',
      builtInKey: 'ssic', isProtected: true, allowCsvReplace: true, options: [], optionCount: 0,
    });
    mocks.update.mockResolvedValue({ id: 'ssic-1', optionCount: 1 });

    await replaceFormOptionPreset('ssic-1', {
      tenantId: 'tenant-1', userId: 'user-1',
      options: [{ value: '01111', label: '01111 - Growing vegetables' }],
    });

    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'ssic-1' },
      data: expect.objectContaining({ optionCount: 1 }),
    }));

    mocks.findFirst.mockResolvedValueOnce({
      id: 'countries-1', tenantId: 'tenant-1', name: 'Countries', normalizedKey: 'countries',
      builtInKey: 'countries', isProtected: true, allowCsvReplace: false, options: [], optionCount: 0,
    });
    await expect(replaceFormOptionPreset('countries-1', {
      tenantId: 'tenant-1', userId: 'user-1', options: [{ value: 'SG', label: 'Singapore' }],
    })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('resolves linked field options only from presets in the same tenant', async () => {
    mocks.findMany.mockResolvedValue([
      { id: 'preset-1', options: [{ value: '01111', label: '01111 - Growing vegetables' }] },
    ]);
    const fields = [
      { id: 'field-1', optionPresetId: 'preset-1', options: [{ value: 'old', label: 'Old' }] },
      { id: 'field-2', optionPresetId: null, options: [{ value: 'local', label: 'Local' }] },
    ];

    const resolved = await resolvePresetOptionsForFields('tenant-1', fields);

    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 'tenant-1', id: { in: ['preset-1'] } },
    }));
    expect(resolved[0].options).toEqual([{ value: '01111', label: '01111 - Growing vegetables' }]);
    expect(resolved[1].options).toEqual([{ value: 'local', label: 'Local' }]);
  });

  it('rejects missing linked presets instead of silently clearing fields', async () => {
    mocks.findMany.mockResolvedValue([]);
    await expect(resolvePresetOptionsForFields('tenant-1', [
      { id: 'field-1', optionPresetId: 'other-tenant-preset', options: [] },
    ])).rejects.toBeInstanceOf(NotFoundError);
  });

  it('blocks protected and in-use deletes but deletes unused custom presets', async () => {
    mocks.findFirst.mockResolvedValueOnce({ id: 'built-in', name: 'Countries', isProtected: true });
    await expect(deleteFormOptionPreset('built-in', { tenantId: 'tenant-1', userId: 'user-1' }))
      .rejects.toBeInstanceOf(ConflictError);

    mocks.findFirst.mockResolvedValueOnce({ id: 'custom-1', name: 'Clients', isProtected: false });
    mocks.fieldCount.mockResolvedValueOnce(2);
    await expect(deleteFormOptionPreset('custom-1', { tenantId: 'tenant-1', userId: 'user-1' }))
      .rejects.toBeInstanceOf(ConflictError);

    mocks.findFirst.mockResolvedValueOnce({ id: 'custom-2', name: 'Unused', isProtected: false });
    mocks.fieldCount.mockResolvedValueOnce(0);
    mocks.delete.mockResolvedValueOnce({ id: 'custom-2', name: 'Unused' });
    await deleteFormOptionPreset('custom-2', { tenantId: 'tenant-1', userId: 'user-1' });

    expect(mocks.fieldCount).toHaveBeenLastCalledWith({
      where: { tenantId: 'tenant-1', optionPresetId: 'custom-2' },
    });
    expect(mocks.delete).toHaveBeenCalledWith({ where: { id: 'custom-2' } });
  });
});
