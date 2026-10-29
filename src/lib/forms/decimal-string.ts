/**
 * Exact decimal arithmetic for form answers (percentages, money) kept as strings.
 *
 * Values are scaled to integers with a fixed number of fraction digits so sums and
 * comparisons never go through JavaScript floating point.
 */

export const DECIMAL_STRING_SCALE = 6;
const SCALE_FACTOR = BigInt(10) ** BigInt(DECIMAL_STRING_SCALE);
const DECIMAL_PATTERN = /^(\d+)(?:\.(\d+))?$/;

/**
 * Parse a non-negative decimal string such as "60", "33.3333" or "1,000.50".
 * Returns scaled integer units, or null when the text is not a plain decimal
 * or has more fraction digits than the supported scale.
 */
export function parseDecimalString(value: unknown): bigint | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return null;
    return parseDecimalString(String(value));
  }
  if (typeof value !== 'string') return null;

  const normalized = value.trim().replace(/,/g, '');
  const match = normalized.match(DECIMAL_PATTERN);
  if (!match) return null;

  const whole = match[1];
  const fraction = match[2] ?? '';
  if (fraction.length > DECIMAL_STRING_SCALE) return null;

  return BigInt(whole) * SCALE_FACTOR + BigInt(fraction.padEnd(DECIMAL_STRING_SCALE, '0') || '0');
}

export function decimalUnits(whole: number): bigint {
  return BigInt(whole) * SCALE_FACTOR;
}

export function formatDecimalUnits(units: bigint): string {
  const negative = units < BigInt(0);
  const absolute = negative ? -units : units;
  const whole = absolute / SCALE_FACTOR;
  const fraction = (absolute % SCALE_FACTOR).toString().padStart(DECIMAL_STRING_SCALE, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole.toString()}${fraction ? `.${fraction}` : ''}`;
}
