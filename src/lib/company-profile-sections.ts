import { createHash } from 'node:crypto';
import { Decimal } from '@prisma/client/runtime/client';

export const COMPANY_PROFILE_SECTIONS = [
  'identity',
  'addresses',
  'activities',
  'officers',
  'shareholders',
  'compliance',
  'capital',
  'charges',
  'additional',
] as const;

export type CompanyProfileSectionId = typeof COMPANY_PROFILE_SECTIONS[number];

type DecimalInput = string | number | { toString(): string };

export interface AttributedCapitalInput {
  currency: string;
  shareholderShares: DecimalInput;
  classShares: DecimalInput;
  classValue: DecimalInput;
}

export interface AttributedCapital {
  currency: string;
  amount: string;
}

/**
 * Derive a shareholder's capital value from its proportion of a share class.
 * This is display data only; the source share and capital records remain canonical.
 */
export function calculateAttributedCapital(
  input: AttributedCapitalInput,
): AttributedCapital | null {
  try {
    const classShares = new Decimal(input.classShares.toString());
    if (!classShares.isFinite() || classShares.lte(0)) return null;

    const shareholderShares = new Decimal(input.shareholderShares.toString());
    const classValue = new Decimal(input.classValue.toString());
    if (!shareholderShares.isFinite() || !classValue.isFinite()) return null;

    return {
      currency: input.currency,
      amount: shareholderShares.div(classShares).mul(classValue).toFixed(2),
    };
  } catch {
    return null;
  }
}

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

/** Stable optimistic-concurrency token for one independently editable section. */
export function computeSectionVersion(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}
