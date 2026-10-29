const LEGAL_SUFFIXES = new Set([
  'pte',
  'ltd',
  'limited',
  'private',
  'llp',
  'lp',
  'inc',
  'llc',
  'corp',
  'corporation',
]);

export const COMPANY_ALIAS_MAX_LENGTH = 10;

export function normalizeCompanyAlias(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized) return null;
  return Array.from(normalized).slice(0, COMPANY_ALIAS_MAX_LENGTH).join('') || null;
}

export function deriveCompanyInitials(legalName: string): string {
  const tokens = legalName
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter(Boolean);

  while (
    tokens.length > 0
    && LEGAL_SUFFIXES.has(tokens[tokens.length - 1]!.toLocaleLowerCase('en-SG'))
  ) {
    tokens.pop();
  }

  const initials = tokens
    .map((token) => Array.from(token)[0]?.toLocaleUpperCase('en-SG') ?? '')
    .join('');

  return initials || Array.from(legalName.trim())[0]?.toLocaleUpperCase('en-SG') || '?';
}

export function getCompanyDisplayLabel(company: { name: string; displayAlias?: string | null }): string {
  return normalizeCompanyAlias(company.displayAlias) ?? deriveCompanyInitials(company.name);
}
