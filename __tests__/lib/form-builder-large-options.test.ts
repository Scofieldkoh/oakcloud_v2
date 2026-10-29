import { describe, expect, it } from 'vitest';
import { formFieldSchema } from '@/lib/validations/form-builder';

function dropdownWithOptions(count: number) {
  return {
    type: 'DROPDOWN',
    label: 'Industry',
    key: 'industry',
    position: 0,
    options: Array.from({ length: count }, (_, index) => ({
      value: `code-${index}`,
      label: `Industry ${index}`,
    })),
  };
}

describe('large form dropdown validation', () => {
  it('accepts embedded dropdowns through 5,000 options and rejects 5,001', () => {
    expect(formFieldSchema.safeParse(dropdownWithOptions(501)).success).toBe(true);
    expect(formFieldSchema.safeParse(dropdownWithOptions(5_000)).success).toBe(true);
    expect(formFieldSchema.safeParse(dropdownWithOptions(5_001)).success).toBe(false);
  });
});
