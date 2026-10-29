import { createHash } from 'node:crypto';
import { caseFold } from 'unicode-case-folding';
import type { ContactDetailType, IdentificationType } from '@/generated/prisma';
import type {
  ContactIdentityCandidate,
  ContactIdentityFingerprint,
} from '@/types/contact-identity';

const LEGAL_SUFFIXES = [
  'incorporated',
  'corporation',
  'private',
  'limited',
  'company',
  'corp',
  'pte',
  'ltd',
  'llp',
  'llc',
  'inc',
  'co',
] as const;
const MASK_OR_PLACEHOLDER = /[*•●]|\b(?:unknown|not available|n\/?a|redacted|masked)\b/iu;

export function canonicalizeContactName(value: string | null | undefined): string {
  return caseFold((value ?? '').normalize('NFKC')).replace(/[^\p{L}\p{M}\p{N}]/gu, '');
}

export function canonicalizeContactAlias(value: string | null | undefined): string | null {
  return value == null ? null : canonicalizeContactName(value);
}

export function canonicalizeCorporateComparisonName(
  value: string | null | undefined,
): string {
  const folded = caseFold((value ?? '').normalize('NFKC'));
  const tokens = folded
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/u)
    .filter(Boolean);

  while (
    tokens.length > 1 &&
    LEGAL_SUFFIXES.includes(tokens[tokens.length - 1] as (typeof LEGAL_SUFFIXES)[number])
  ) {
    tokens.pop();
  }

  return tokens.join('');
}

export function normalizeContactIdentifier(
  value: string | null | undefined,
  type: IdentificationType | null | undefined,
): string | null {
  const normalized = (value ?? '').normalize('NFKC').trim().toUpperCase();
  if (!normalized) return null;

  return type === 'NRIC' || type === 'FIN' || type === 'UEN'
    ? normalized.replace(/[\s-]+/g, '')
    : normalized.replace(/\s+/g, ' ');
}

export function isDeterministicIdentifier(
  value: string | null | undefined,
  type: IdentificationType | null | undefined,
): boolean {
  const normalized = normalizeContactIdentifier(value, type);
  return Boolean(
    normalized &&
      !MASK_OR_PLACEHOLDER.test(normalized) &&
      (normalized.match(/[A-Z0-9]/g)?.length ?? 0) >= 5,
  );
}

export function normalizeContactDetailValue(
  detailType: ContactDetailType,
  value: string | null | undefined,
): string {
  const normalized = (value ?? '').normalize('NFKC').trim();
  if (detailType === 'EMAIL') return caseFold(normalized);
  if (detailType === 'PHONE') {
    const hasInternationalPrefix = normalized.startsWith('+');
    const digits = normalized.replace(/\D/gu, '');
    return `${hasInternationalPrefix ? '+' : ''}${digits}`;
  }
  return caseFold(normalized).replace(/\s+/gu, ' ');
}

function identityName(candidate: ContactIdentityCandidate): string {
  return candidate.contactType === 'CORPORATE'
    ? canonicalizeContactName(candidate.corporateName)
    : canonicalizeContactName(`${candidate.firstName ?? ''}${candidate.lastName ?? ''}`);
}

export function buildContactIdentityFingerprint(
  candidate: ContactIdentityCandidate,
): ContactIdentityFingerprint {
  const details = (candidate.contactDetails ?? [])
    .map((detail) => ({
      companyId: detail.companyId ?? null,
      detailType: detail.detailType,
      value: normalizeContactDetailValue(detail.detailType, detail.value),
    }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  const payload = {
    contactType: candidate.contactType,
    canonicalName: identityName(candidate),
    identificationType: candidate.identificationType ?? null,
    identificationNumber: normalizeContactIdentifier(
      candidate.identificationNumber,
      candidate.identificationType,
    ),
    corporateUen: normalizeContactIdentifier(candidate.corporateUen, 'UEN'),
    dateOfBirth: candidate.dateOfBirth?.normalize('NFKC').trim() || null,
    fullAddress: canonicalizeContactName(candidate.fullAddress) || null,
    contactDetails: details,
  };

  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
