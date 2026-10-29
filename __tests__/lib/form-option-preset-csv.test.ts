import { describe, expect, it } from 'vitest';
import { parsePresetCsv } from '@/lib/form-option-preset-csv';
import {
  FORM_PRESET_MAX_FILE_BYTES,
  FORM_PRESET_MAX_OPTIONS,
  createFormOptionPresetSchema,
  updateFormOptionPresetSchema,
} from '@/lib/validations/form-option-preset';

describe('form option preset CSV', () => {
  it('uses labels as values for a one-column file', () => {
    expect(parsePresetCsv('label\nSingapore\nMalaysia')).toEqual({
      detectedColumns: ['label'],
      options: [
        { value: 'Singapore', label: 'Singapore' },
        { value: 'Malaysia', label: 'Malaysia' },
      ],
      errors: [],
      totalRows: 2,
      rejectedRows: 0,
    });
  });

  it('preserves distinct values and quoted labels', () => {
    const result = parsePresetCsv('\uFEFFValue,Label\r\n01111,"Growing of leafy, fruit and root vegetables"');
    expect(result.options).toEqual([
      { value: '01111', label: 'Growing of leafy, fruit and root vegetables' },
    ]);
    expect(result.detectedColumns).toEqual(['value', 'label']);
    expect(result.errors).toEqual([]);
  });

  it('supports escaped quotes and quoted newlines', () => {
    const result = parsePresetCsv('value,label\nA,"Say ""hello"""\nB,"Line one\nLine two"');
    expect(result.options).toEqual([
      { value: 'A', label: 'Say "hello"' },
      { value: 'B', label: 'Line one\nLine two' },
    ]);
  });

  it('reports duplicate values with source row numbers', () => {
    const result = parsePresetCsv('value,label\n01,A\n01,B');
    expect(result.options).toEqual([{ value: '01', label: 'A' }]);
    expect(result.errors[0]).toMatchObject({ row: 3, column: 'value', code: 'duplicate_value' });
    expect(result.rejectedRows).toBe(1);
  });

  it('rejects missing headers and blank required cells while ignoring blank rows', () => {
    expect(parsePresetCsv('code,name\n1,A').errors[0]).toMatchObject({ row: 1, code: 'invalid_headers' });

    const result = parsePresetCsv('value,label\n,Missing value\n2,\n  ,  \n3,Valid');
    expect(result.options).toEqual([{ value: '3', label: 'Valid' }]);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ row: 2, column: 'value', code: 'required' }),
      expect.objectContaining({ row: 3, column: 'label', code: 'required' }),
    ]));
    expect(result.totalRows).toBe(3);
    expect(result.rejectedRows).toBe(2);
  });

  it('rejects malformed quoting', () => {
    expect(parsePresetCsv('label\n"unterminated').errors[0]).toMatchObject({ code: 'malformed_csv' });
  });

  it('enforces row and byte limits', () => {
    const rows = Array.from({ length: FORM_PRESET_MAX_OPTIONS + 1 }, (_, index) => `V${index},Label ${index}`);
    expect(parsePresetCsv(`value,label\n${rows.join('\n')}`).errors).toContainEqual(
      expect.objectContaining({ code: 'too_many_options' }),
    );

    const oversized = `label\n${'x'.repeat(FORM_PRESET_MAX_FILE_BYTES)}`;
    expect(parsePresetCsv(oversized).errors[0]).toMatchObject({ code: 'file_too_large' });
  });
});

describe('form option preset request validation', () => {
  it('normalizes names and requires update content', () => {
    expect(createFormOptionPresetSchema.parse({ name: '  Industries  ', csv: 'label\nA' }).name).toBe('Industries');
    expect(updateFormOptionPresetSchema.safeParse({}).success).toBe(false);
    expect(updateFormOptionPresetSchema.safeParse({ name: 'Renamed' }).success).toBe(true);
    expect(updateFormOptionPresetSchema.safeParse({ csv: 'label\nA' }).success).toBe(true);
  });
});
