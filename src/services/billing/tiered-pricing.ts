import { formatCurrency } from '@/lib/utils';

/**
 * Quantity-tiered pricing for postpaid fee lines. Kept free of server imports
 * so client components can price a quantity as staff type it.
 *
 * Tiers are ordered by their "up to" quantity; the last tier has no limit.
 * Each tier has a flat fee and a per-unit price, either of which may be zero.
 * - VOLUME: the whole quantity is priced at the tier it falls in.
 * - GRADUATED: each tier prices only the units inside it; the first tier's
 *   flat fee always applies, a later tier's once the quantity reaches it.
 */

export const TIERED_PRICING_MODES = ['VOLUME', 'GRADUATED'] as const;

export type TieredPricingMode = typeof TIERED_PRICING_MODES[number];

export const TIERED_PRICING_MODE_LABELS: Record<TieredPricingMode, string> = {
  VOLUME: 'Whole quantity at its tier',
  GRADUATED: 'Each tier priced separately',
};

export const TIERED_PRICING_MODE_HINTS: Record<TieredPricingMode, string> = {
  VOLUME: 'The tier the quantity falls in prices all of it.',
  GRADUATED: 'Units in each tier are priced at that tier, then added up.',
};

export type TieredPricingTier = {
  /** Highest quantity in this tier; null on the last tier. */
  upTo: string | null;
  flatAmount: string;
  unitAmount: string;
};

export type TieredPricing = {
  mode: TieredPricingMode;
  /** What is counted, singular, e.g. "transaction". */
  unitLabel: string;
  tiers: TieredPricingTier[];
};

export const MAX_PRICING_TIERS = 20;

const ZERO = BigInt(0);
const HUNDRED = BigInt(100);
const HALF = BigInt(50);

const AMOUNT_PATTERN = /^\d{1,16}(\.\d{1,2})?$/;
const QUANTITY_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;

export function isValidQuantity(value: string): boolean {
  return QUANTITY_PATTERN.test(value.trim());
}

/** Hundredths (of a unit or a currency) as an exact integer. */
function hundredths(value: string): bigint {
  const [whole, fraction = ''] = value.trim().split('.');
  return BigInt(whole || '0') * HUNDRED + BigInt(fraction.padEnd(2, '0').slice(0, 2) || '0');
}

function fromCents(cents: bigint): string {
  const whole = cents / HUNDRED;
  const fraction = (cents % HUNDRED).toString().padStart(2, '0');
  return `${whole}.${fraction}`;
}

/** Cents for a number of units (in hundredths) at a unit price (in cents), half up. */
function unitsCost(unitHundredths: bigint, unitCents: bigint): bigint {
  return (unitHundredths * unitCents + HALF) / HUNDRED;
}

/** Problems with a tier table, keyed for form fields; empty when valid. */
export function tieredPricingErrors(pricing: TieredPricing): Array<{ path: Array<string | number>; message: string }> {
  const errors: Array<{ path: Array<string | number>; message: string }> = [];
  if (!TIERED_PRICING_MODES.includes(pricing.mode)) errors.push({ path: ['mode'], message: 'Choose how tiers are priced' });
  if (!pricing.unitLabel.trim()) errors.push({ path: ['unitLabel'], message: 'Name what is counted, e.g. transaction' });
  if (pricing.tiers.length === 0) errors.push({ path: ['tiers'], message: 'Add at least one tier' });
  if (pricing.tiers.length > MAX_PRICING_TIERS) errors.push({ path: ['tiers'], message: `At most ${MAX_PRICING_TIERS} tiers` });
  let previous: bigint | null = null;
  pricing.tiers.forEach((tier, index) => {
    const last = index === pricing.tiers.length - 1;
    if (!AMOUNT_PATTERN.test(tier.flatAmount)) errors.push({ path: ['tiers', index, 'flatAmount'], message: 'Enter a flat fee (0 for none)' });
    if (!AMOUNT_PATTERN.test(tier.unitAmount)) errors.push({ path: ['tiers', index, 'unitAmount'], message: 'Enter a unit price (0 for none)' });
    if (last) {
      if (tier.upTo != null) errors.push({ path: ['tiers', index, 'upTo'], message: 'The last tier has no limit' });
      return;
    }
    if (tier.upTo == null || !QUANTITY_PATTERN.test(tier.upTo)) {
      errors.push({ path: ['tiers', index, 'upTo'], message: 'Enter the highest quantity in this tier' });
      return;
    }
    const upTo = hundredths(tier.upTo);
    if (upTo <= ZERO || (previous != null && upTo <= previous)) {
      errors.push({ path: ['tiers', index, 'upTo'], message: 'Each tier must go higher than the one before' });
    }
    previous = upTo;
  });
  return errors;
}

/** Read stored JSON as a tier table, or null when it is not one. */
export function parseTieredPricing(value: unknown): TieredPricing | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.tiers) || typeof record.unitLabel !== 'string') return null;
  const mode = TIERED_PRICING_MODES.includes(record.mode as TieredPricingMode) ? record.mode as TieredPricingMode : 'VOLUME';
  const tiers = record.tiers.map((tier) => {
    const row = (tier ?? {}) as Record<string, unknown>;
    return {
      upTo: typeof row.upTo === 'string' ? row.upTo : null,
      flatAmount: typeof row.flatAmount === 'string' ? row.flatAmount : '0',
      unitAmount: typeof row.unitAmount === 'string' ? row.unitAmount : '0',
    };
  });
  const pricing: TieredPricing = { mode, unitLabel: record.unitLabel, tiers };
  return tieredPricingErrors(pricing).length === 0 ? pricing : null;
}

/** The fee for a quantity, as a two-decimal string. */
export function priceTieredQuantity(pricing: TieredPricing, quantity: string): string {
  const units = hundredths(quantity);
  const tiers = pricing.tiers.map((tier) => ({
    upTo: tier.upTo == null ? null : hundredths(tier.upTo),
    flat: hundredths(tier.flatAmount),
    unit: hundredths(tier.unitAmount),
  }));
  if (pricing.mode === 'VOLUME') {
    const tier = tiers.find((candidate) => candidate.upTo == null || units <= candidate.upTo) ?? tiers[tiers.length - 1]!;
    return fromCents(tier.flat + unitsCost(units, tier.unit));
  }
  let total = ZERO;
  let floor = ZERO;
  for (const [index, tier] of tiers.entries()) {
    if (index > 0 && units <= floor) break;
    const ceiling = tier.upTo == null || units < tier.upTo ? units : tier.upTo;
    total += tier.flat + unitsCost(ceiling - floor, tier.unit);
    if (tier.upTo == null) break;
    floor = tier.upTo;
  }
  return fromCents(total);
}

function quantityText(value: string): string {
  const [whole, fraction = ''] = value.split('.');
  const trimmed = fraction.replace(/0+$/, '');
  return `${Number(whole).toLocaleString('en-SG')}${trimmed ? `.${trimmed}` : ''}`;
}

/** One line per tier, e.g. "Up to 100: S$800.00" or "Above 100: S$5.00 per transaction". */
export function describeTieredPricing(pricing: TieredPricing, currency: string): string[] {
  const unit = pricing.unitLabel.trim();
  return pricing.tiers.map((tier, index) => {
    const previous = index > 0 ? pricing.tiers[index - 1]!.upTo : null;
    const range = tier.upTo != null
      ? `Up to ${quantityText(tier.upTo)}`
      : previous != null ? `Above ${quantityText(previous)}` : 'Any quantity';
    const parts: string[] = [];
    if (hundredths(tier.flatAmount) > ZERO) parts.push(formatCurrency(tier.flatAmount, currency));
    if (hundredths(tier.unitAmount) > ZERO) parts.push(`${formatCurrency(tier.unitAmount, currency)} per ${unit}`);
    return `${range}: ${parts.length > 0 ? parts.join(' + ') : formatCurrency('0', currency)}`;
  });
}

/** A short label for a tiered fee line where an amount would show. */
export function tieredPricingSummary(pricing: TieredPricing): string {
  return `Tiered by ${pricing.unitLabel.trim() || 'quantity'}`;
}

export function defaultTieredPricing(): TieredPricing {
  return {
    mode: 'VOLUME',
    unitLabel: 'transaction',
    tiers: [
      { upTo: '100', flatAmount: '0', unitAmount: '0' },
      { upTo: null, flatAmount: '0', unitAmount: '0' },
    ],
  };
}
