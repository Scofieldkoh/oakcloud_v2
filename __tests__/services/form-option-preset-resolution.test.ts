import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  formFindFirst: vi.fn(),
  presetFindMany: vi.fn(),
  transaction: vi.fn(),
  incrementViewCount: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    form: { findFirst: mocks.formFindFirst },
    formOptionPreset: { findMany: mocks.presetFindMany },
    $transaction: mocks.transaction,
  },
}));
vi.mock('@/lib/view-count-buffer', () => ({ incrementViewCount: mocks.incrementViewCount }));
vi.mock('@/lib/storage', () => ({ storage: {}, StorageKeys: {} }));
vi.mock('@/lib/audit', () => ({ createAuditLog: vi.fn() }));

import { ValidationError } from '@/lib/errors';
import { saveFormFields } from '@/services/form-crud.service';
import { getPublicFormBySlug } from '@/services/form-submission.service';

const linkedField = {
  id: 'field-1', formId: 'form-1', tenantId: 'tenant-1', optionPresetId: 'preset-1',
  type: 'DROPDOWN', label: 'SSIC', key: 'ssic', placeholder: null, subtext: null,
  helpText: null, inputType: null, options: null, validation: null, condition: null,
  isRequired: false, hideLabel: false, isReadOnly: false, layoutWidth: 100, position: 0,
  createdAt: new Date(), updatedAt: new Date(),
};

describe('form option preset resolution', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resolves current preset options on public form reads', async () => {
    mocks.formFindFirst.mockResolvedValue({
      id: 'form-1', tenantId: 'tenant-1', slug: 'annual-return', title: 'Annual return',
      description: null, settings: null, fields: [linkedField], tenant: { logoUrl: null, name: 'Workspace' },
    });
    mocks.presetFindMany.mockResolvedValue([{
      id: 'preset-1',
      options: [{ value: '01111', label: '01111 - Updated growing vegetables' }],
    }]);

    const form = await getPublicFormBySlug('annual-return');

    expect(form?.fields[0].options).toEqual([
      { value: '01111', label: '01111 - Updated growing vegetables' },
    ]);
    expect(mocks.presetFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 'tenant-1', id: { in: ['preset-1'] } },
    }));
  });

  it('rejects a linked preset outside the form tenant before replacing fields', async () => {
    mocks.formFindFirst.mockResolvedValue({ id: 'form-1', title: 'Form' });
    mocks.presetFindMany.mockResolvedValue([]);

    await expect(saveFormFields('form-1', [{
      type: 'DROPDOWN', label: 'SSIC', key: 'ssic', position: 0,
      optionPresetId: '11111111-1111-4111-8111-111111111111', options: null,
      isRequired: false, hideLabel: false, isReadOnly: false, layoutWidth: 100,
    }], { tenantId: 'tenant-1', userId: 'user-1' })).rejects.toBeInstanceOf(ValidationError);

    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
