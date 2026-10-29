import { describe, expect, it } from 'vitest';
import {
  describeTieredPricing,
  parseTieredPricing,
  priceTieredQuantity,
  tieredPricingErrors,
  type TieredPricing,
} from '@/services/billing/tiered-pricing';
import { postpaidEntryAmount } from '@/services/billing/postpaid';
import { clientServiceFeeLineInputSchema } from '@/lib/validations/client-service';
import { serviceVariantFeeTemplateSchema } from '@/lib/validations/service-catalog';
import { updateDeadlineOccurrenceSchema } from '@/lib/validations/deadline';

const bands: TieredPricing = {
  mode: 'VOLUME',
  unitLabel: 'transaction',
  tiers: [
    { upTo: '200', flatAmount: '1200', unitAmount: '0' },
    { upTo: '500', flatAmount: '1800', unitAmount: '0' },
    { upTo: null, flatAmount: '1800', unitAmount: '4.50' },
  ],
};

const graduated: TieredPricing = {
  mode: 'GRADUATED',
  unitLabel: 'transaction',
  tiers: [
    { upTo: '100', flatAmount: '800', unitAmount: '0' },
    { upTo: '300', flatAmount: '0', unitAmount: '5' },
    { upTo: null, flatAmount: '0', unitAmount: '3.25' },
  ],
};

describe('priceTieredQuantity', () => {
  it('prices the whole quantity at the tier it falls in', () => {
    expect(priceTieredQuantity(bands, '0')).toBe('1200.00');
    expect(priceTieredQuantity(bands, '200')).toBe('1200.00');
    expect(priceTieredQuantity(bands, '200.01')).toBe('1800.00');
    expect(priceTieredQuantity(bands, '500')).toBe('1800.00');
    // Above 500: flat 1,800 plus 4.50 for every unit.
    expect(priceTieredQuantity(bands, '600')).toBe('4500.00');
  });

  it('prices each graduated tier separately and adds them up', () => {
    expect(priceTieredQuantity(graduated, '0')).toBe('800.00');
    expect(priceTieredQuantity(graduated, '100')).toBe('800.00');
    expect(priceTieredQuantity(graduated, '150')).toBe('1050.00');
    expect(priceTieredQuantity(graduated, '300')).toBe('1800.00');
    expect(priceTieredQuantity(graduated, '310')).toBe('1832.50');
  });

  it('only adds a later tier flat fee once the quantity reaches that tier', () => {
    const pricing: TieredPricing = {
      mode: 'GRADUATED',
      unitLabel: 'employee',
      tiers: [
        { upTo: '10', flatAmount: '100', unitAmount: '0' },
        { upTo: null, flatAmount: '50', unitAmount: '10' },
      ],
    };
    expect(priceTieredQuantity(pricing, '10')).toBe('100.00');
    expect(priceTieredQuantity(pricing, '11')).toBe('160.00');
  });

  it('rounds fractional quantities to the cent, half up', () => {
    const pricing: TieredPricing = { mode: 'VOLUME', unitLabel: 'hour', tiers: [{ upTo: null, flatAmount: '0', unitAmount: '0.15' }] };
    // 2.5 × 0.15 = 0.375, billed as 0.38.
    expect(priceTieredQuantity(pricing, '2.5')).toBe('0.38');
  });
});

describe('tieredPricingErrors', () => {
  it('accepts a valid table', () => {
    expect(tieredPricingErrors(bands)).toEqual([]);
  });

  it('needs rising limits, no limit on the last tier and two-decimal amounts', () => {
    const errors = tieredPricingErrors({
      mode: 'VOLUME',
      unitLabel: ' ',
      tiers: [
        { upTo: '100', flatAmount: '1.234', unitAmount: '0' },
        { upTo: '100', flatAmount: '0', unitAmount: '0' },
        { upTo: '500', flatAmount: '0', unitAmount: 'x' },
      ],
    });
    expect(errors.map((error) => error.path.join('.'))).toEqual([
      'unitLabel',
      'tiers.0.flatAmount',
      'tiers.1.upTo',
      'tiers.2.unitAmount',
      'tiers.2.upTo',
    ]);
  });

  it('reads stored JSON and rejects anything else', () => {
    expect(parseTieredPricing(JSON.parse(JSON.stringify(bands)))).toEqual(bands);
    expect(parseTieredPricing(null)).toBeNull();
    expect(parseTieredPricing({ unitLabel: 'x', tiers: [] })).toBeNull();
  });
});

describe('describeTieredPricing', () => {
  it('writes one line per tier', () => {
    expect(describeTieredPricing(bands, 'SGD')).toEqual([
      'Up to 200: S$1,200.00',
      'Up to 500: S$1,800.00',
      'Above 500: S$1,800.00 + S$4.50 per transaction',
    ]);
  });
});

describe('postpaidEntryAmount', () => {
  it('bills the fixed amount, or the tier price of the quantity, or 0.00 until a quantity is entered', () => {
    expect(postpaidEntryAmount({ amount: '950', tieredPricing: null }, null)).toBe('950.00');
    expect(postpaidEntryAmount({ amount: '0', tieredPricing: bands }, null)).toBe('0.00');
    expect(postpaidEntryAmount({ amount: '0', tieredPricing: bands }, '250')).toBe('1800.00');
  });
});

describe('tiered pricing validation', () => {
  const feeLine = {
    description: 'Accounting',
    amount: '0.00',
    currency: 'SGD',
    billingFrequency: 'ONE_TIME' as const,
    billingTiming: 'POSTPAID' as const,
    postpaidTrigger: 'SG_FORM_C_FILED' as const,
    displayOrder: 0,
  };

  it('accepts tiers on postpaid fee lines and catalog fee templates', () => {
    expect(clientServiceFeeLineInputSchema.safeParse({ ...feeLine, tieredPricing: bands }).success).toBe(true);
    expect(serviceVariantFeeTemplateSchema.safeParse({
      description: 'Accounting',
      currency: 'SGD',
      billingFrequency: 'ONE_TIME',
      billingTiming: 'POSTPAID',
      postpaidTrigger: 'SG_FORM_C_FILED',
      tieredPricing: graduated,
      displayOrder: 0,
    }).success).toBe(true);
  });

  it('rejects tiers on prepaid lines and invalid tier tables', () => {
    expect(clientServiceFeeLineInputSchema.safeParse({
      ...feeLine,
      billingTiming: 'PREPAID',
      postpaidTrigger: null,
      billingFrequency: 'ANNUALLY',
      tieredPricing: bands,
    }).success).toBe(false);
    expect(clientServiceFeeLineInputSchema.safeParse({
      ...feeLine,
      tieredPricing: { ...bands, tiers: [{ upTo: '10', flatAmount: '0', unitAmount: '0' }] },
    }).success).toBe(false);
  });

  it('takes billing quantities only when marking a deadline complete', () => {
    const quantity = { feeLineId: '1d3c2b8a-8f5e-4f7a-9a7e-2f4a5b6c7d8e', quantity: '120' };
    expect(updateDeadlineOccurrenceSchema.safeParse({
      expectedUpdatedAt: '2026-10-03T00:00:00.000Z',
      status: 'COMPLETED',
      billingQuantities: [quantity],
    }).success).toBe(true);
    expect(updateDeadlineOccurrenceSchema.safeParse({
      expectedUpdatedAt: '2026-10-03T00:00:00.000Z',
      notes: 'x',
      billingQuantities: [quantity],
    }).success).toBe(false);
  });
});
