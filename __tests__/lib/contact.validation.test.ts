import { describe, it, expect } from 'vitest';
import { createContactSchema, createContactWithDetailsSchema, updateContactSchema } from '@/lib/validations/contact';

describe('contact validation', () => {
  it('allows blank identificationType when creating a contact', () => {
    const parsed = createContactSchema.parse({
      contactType: 'INDIVIDUAL',
      firstName: 'John',
      identificationType: '',
    });

    expect(parsed.identificationType).toBeNull();
  });

  it('allows blank identificationType when updating a contact', () => {
    const parsed = updateContactSchema.parse({
      id: '11111111-1111-1111-1111-111111111111',
      identificationType: '',
    });

    expect(parsed.identificationType).toBeNull();
  });

  it('accepts an explicit reuse decision with a selected contact', () => {
    const parsed = createContactWithDetailsSchema.parse({
      contactType: 'INDIVIDUAL',
      firstName: '王小明',
      resolution: { action: 'REUSE', contactId: '11111111-1111-4111-8111-111111111111' },
    });

    expect(parsed.resolution).toEqual({
      action: 'REUSE',
      contactId: '11111111-1111-4111-8111-111111111111',
    });
  });

  it('requires a selected contact for reuse', () => {
    const result = createContactWithDetailsSchema.safeParse({
      contactType: 'INDIVIDUAL',
      firstName: '王小明',
      resolution: { action: 'REUSE' },
    });

    expect(result.success).toBe(false);
  });

  it('requires a meaningful reason for separate creation', () => {
    const result = createContactWithDetailsSchema.safeParse({
      contactType: 'INDIVIDUAL',
      firstName: '王小明',
      resolution: { action: 'CREATE_SEPARATE', reason: 'short' },
    });

    expect(result.success).toBe(false);
  });
});
