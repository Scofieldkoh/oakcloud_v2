import { describe, expect, it } from 'vitest';

import { placeholderDefinitionSchema } from '@/lib/validations/document-template';
import { batchItemConfigurationSchema } from '@/lib/validations/document-generation-batch';

describe('field schema preservation', () => {
  it('preserves stable IDs, legacy types, options, source/path and unknown JSON metadata', () => {
    const input = {
      id: 'stable-field-id',
      key: 'custom.future',
      label: 'Future field',
      type: 'legacy-future-widget',
      source: 'custom',
      path: 'custom.future',
      options: [{ label: 'A', value: 'a' }],
      required: false,
      xFutureMetadata: { nested: [1, true, 'x'] },
    };
    const parsed = placeholderDefinitionSchema.parse(input);
    expect(parsed).toEqual(input);
  });

  it('keeps false and zero-like exact strings distinct at the batch API boundary', () => {
    const parsed = batchItemConfigurationSchema.parse({
      version: 1,
      title: 'Typed values',
      contactIds: [],
      selectedDirectorId: null,
      selectedShareholderId: null,
      selectedContactId: null,
      itemValues: {
        approved: false,
        amount: '0',
        date: '2026-09-13',
        notes: 'line one\nline two',
      },
      masterOverrides: {},
      useLetterhead: true,
      serviceAgreement: null,
    });
    expect(parsed.itemValues).toEqual({
      approved: false,
      amount: '0',
      date: '2026-09-13',
      notes: 'line one\nline two',
    });
  });
});
