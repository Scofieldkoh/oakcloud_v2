import { describe, expect, it } from 'vitest';
import {
  createServiceFamilySchema,
  createServiceVariantSchema,
  searchServiceCatalogSchema,
  updateServiceFamilySchema,
  updateServiceVariantSchema,
} from '@/lib/validations/service-catalog';

describe('service catalog validation', () => {
  it('normalizes family codes', () => {
    const result = createServiceFamilySchema.parse({
      code: ' corp-sec ',
      name: 'Corporate Secretarial',
    });

    expect(result.code).toBe('CORP-SEC');
  });

  it('normalizes family colors to uppercase six-digit hex', () => {
    expect(
      createServiceFamilySchema.parse({
        code: 'PAYROLL',
        name: 'Payroll',
        displayColor: ' #3f6da8 ',
      }).displayColor,
    ).toBe('#3F6DA8');
  });

  it('defaults new family colors and rejects non-hex updates', () => {
    expect(
      createServiceFamilySchema.parse({
        code: 'ACCOUNTING',
        name: 'Accounting',
      }).displayColor,
    ).toBe('#2F6F5E');

    expect(() =>
      updateServiceFamilySchema.parse({ displayColor: 'blue' }),
    ).toThrow(/six-digit hex/i);
  });

  it('requires custom cadence labels and clears them for standard cadences', () => {
    const base = {
      familyId: crypto.randomUUID(),
      sowPartialId: crypto.randomUUID(),
      code: 'CUSTOM',
      name: 'Custom',
      feeTemplates: [],
    };

    expect(() =>
      createServiceVariantSchema.parse({
        ...base,
        serviceCadence: 'CUSTOM',
      }),
    ).toThrow(/custom cadence label/i);

    expect(
      createServiceVariantSchema.parse({
        ...base,
        serviceCadence: 'MONTHLY',
        customCadenceLabel: 'Ignored',
      }).customCadenceLabel,
    ).toBeNull();
  });

  it('validates fee frequency labels, row limits, and unique display order', () => {
    const base = {
      familyId: crypto.randomUUID(),
      sowPartialId: crypto.randomUUID(),
      code: 'ACCOUNTING',
      name: 'Accounting',
      serviceCadence: 'MONTHLY' as const,
    };

    expect(() =>
      createServiceVariantSchema.parse({
        ...base,
        feeTemplates: [
          {
            description: 'Monthly fee',
            billingFrequency: 'CUSTOM',
            displayOrder: 0,
          },
        ],
      }),
    ).toThrow(/custom frequency label/i);

    expect(() =>
      createServiceVariantSchema.parse({
        ...base,
        feeTemplates: [
          {
            description: 'Monthly fee',
            billingFrequency: 'MONTHLY',
            displayOrder: 0,
          },
          {
            description: 'Bookkeeping',
            billingFrequency: 'MONTHLY',
            displayOrder: 0,
          },
        ],
      }),
    ).toThrow(/display order/i);

    expect(() =>
      createServiceVariantSchema.parse({
        ...base,
        feeTemplates: Array.from({ length: 51 }, (_, displayOrder) => ({
          description: `Fee ${displayOrder + 1}`,
          billingFrequency: 'MONTHLY',
          displayOrder,
        })),
      }),
    ).toThrow(/50/);
  });

  it('normalizes optional update fields and supplies stable search defaults', () => {
    expect(
      updateServiceVariantSchema.parse({
        code: ' annual-tax ',
        serviceCadence: 'ANNUALLY',
        customCadenceLabel: 'Ignored',
      }),
    ).toMatchObject({
      code: 'ANNUAL-TAX',
      customCadenceLabel: null,
    });

    expect(searchServiceCatalogSchema.parse({})).toMatchObject({
      page: 1,
      limit: 20,
      sortBy: 'displayOrder',
      sortOrder: 'asc',
    });
  });
});
