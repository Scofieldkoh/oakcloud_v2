export interface PartyAddress {
  full: string | null;
  letter: string | null;
}

export interface DocumentParty {
  id: string;
  contactId: string | null;
  name: string;
  detail: string | null;
  appointments?: string[];
  contactType?: string | null;
  email: string | null;
  phone: string | null;
  address: PartyAddress;
  nationality?: string | null;
  identificationNumber?: string | null;
  /** NRIC, FIN, PASSPORT, UEN or OTHER, when known. */
  identificationType?: string | null;
  role?: string | null;
  appointmentDate?: Date | string | null;
  shareholderType?: string | null;
  shareClass?: string | null;
  numberOfShares?: number | null;
  percentageHeld?: number | string | null;
}

/**
 * The number a contact is identified by: a company's UEN (its registration
 * number when no UEN is recorded), a person's NRIC, FIN or passport number.
 */
export function contactIdentity(contact: {
  contactType?: string | null;
  identificationType?: string | null;
  identificationNumber?: string | null;
  corporateUen?: string | null;
}): { identificationNumber: string | null; identificationType: string | null } {
  if (contact.contactType === 'CORPORATE') {
    const uen = contact.corporateUen?.trim();
    if (uen) return { identificationNumber: uen, identificationType: 'UEN' };
  }
  return {
    identificationNumber: contact.identificationNumber?.trim() || null,
    identificationType: contact.identificationType ?? null,
  };
}

const NRIC = /^[ST]\d{7}[A-Z]$/i;
const FIN = /^[FGM]\d{7}[A-Z]$/i;
// Business (8 digits), local company (9 digits) or other entity (T08LL1234A) UENs.
const UEN = /^(?:\d{8,9}[A-Z]|[TRS]\d{2}[A-Z]{2}\d{4}[A-Z])$/i;

/**
 * "NRIC No.", "Passport No.", "UEN": what the identification number is, for
 * "(UEN 202400001A)". A number stored without its type is recognised from
 * its shape (an NRIC, FIN or UEN) where it can be.
 */
export function identificationLabel(
  type: string | null | undefined,
  corporate = false,
  number?: string | null,
): string {
  switch ((type ?? '').toUpperCase()) {
    case 'NRIC': return 'NRIC No.';
    case 'FIN': return 'FIN';
    case 'PASSPORT': return 'Passport No.';
    case 'UEN': return 'UEN';
  }
  const value = (number ?? '').trim();
  if (corporate) return UEN.test(value) ? 'UEN' : 'Registration No.';
  if (NRIC.test(value)) return 'NRIC No.';
  if (FIN.test(value)) return 'FIN';
  return 'ID No.';
}

export interface AddressInput {
  fullAddress?: string | null;
  block?: string | null;
  street?: string | null;
  level?: string | null;
  unit?: string | null;
  building?: string | null;
  postalCode?: string | null;
  country?: string | null;
}

export interface ContactDetailInput {
  detailType: string;
  value: string;
  companyId?: string | null;
  isPrimary?: boolean;
  displayOrder?: number;
  createdAt?: Date | string;
}

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function cleanLines(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

function formatSingaporeFreeText(value: string): string | null {
  const parts = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const countryPart = parts.at(-1);
  const countryMatch = countryPart?.match(/^Singapore\s+(\d{6})$/i);

  if (!countryMatch || parts.length < 2) return null;

  const addressParts = parts.slice(0, -1);
  const streetIndex = addressParts.findIndex((part) => /^\d+[A-Za-z]?\s+/.test(part));
  if (streetIndex < 0) return null;

  const street = addressParts[streetIndex];
  const unitIndex = addressParts.findIndex(
    (part, index) => index !== streetIndex && /^#/.test(part),
  );
  const buildingIndex = addressParts.findIndex(
    (_, index) => index !== streetIndex && index !== unitIndex,
  );
  const consumedIndexes = new Set(
    [streetIndex, unitIndex, buildingIndex].filter((index) => index >= 0),
  );
  if (consumedIndexes.size !== addressParts.length) return null;

  const unit = unitIndex >= 0 ? addressParts[unitIndex] : null;
  const building = buildingIndex >= 0 ? addressParts[buildingIndex] : null;
  const streetLine = unit ? `${street}, ${unit}` : street;

  return [building, streetLine, `Singapore  ${countryMatch[1]}`]
    .filter(Boolean)
    .join('\n');
}

function formatStructuredAddress(input: AddressInput): string | null {
  const block = clean(input.block);
  const street = clean(input.street);
  const building = clean(input.building);
  const level = clean(input.level)?.replace(/^#/, '');
  const unit = clean(input.unit)?.replace(/^#/, '');
  const postalCode = clean(input.postalCode);
  const country = clean(input.country) ?? (postalCode ? 'Singapore' : null);
  const streetAddress = [block, street].filter(Boolean).join(' ');
  const unitAddress = [level, unit].filter(Boolean).join('-');
  const streetLine = [streetAddress || null, unitAddress ? `#${unitAddress}` : null]
    .filter(Boolean)
    .join(', ');
  const postalLine = [country, postalCode].filter(Boolean).join('  ');
  const formatted = [building, streetLine || null, postalLine || null]
    .filter(Boolean)
    .join('\n');

  return formatted || null;
}

function formatStructuredFullAddress(input: AddressInput): string | null {
  const block = clean(input.block);
  const street = clean(input.street);
  const building = clean(input.building);
  const level = clean(input.level)?.replace(/^#/, '');
  const unit = clean(input.unit)?.replace(/^#/, '');
  const postalCode = clean(input.postalCode);
  const country = clean(input.country) ?? (postalCode ? 'Singapore' : null);
  const streetAddress = [block, street].filter(Boolean).join(' ');
  const unitAddress = [level, unit].filter(Boolean).join('-');
  const streetPart = [streetAddress || null, unitAddress ? `#${unitAddress}` : null]
    .filter(Boolean)
    .join(', ');
  const postalPart = [country, postalCode].filter(Boolean).join(' ');
  const formatted = [building, streetPart || null, postalPart || null]
    .filter(Boolean)
    .join(', ');

  return formatted || null;
}

function hasStructuredAddress(input: AddressInput): boolean {
  return [
    input.block,
    input.street,
    input.level,
    input.unit,
    input.building,
    input.postalCode,
    input.country,
  ].some((value) => Boolean(clean(value)));
}

export function formatLetterAddress(input: AddressInput): PartyAddress {
  const freeText = clean(input.fullAddress);
  const normalizedSource = freeText ? cleanLines(freeText) : null;

  if (hasStructuredAddress(input)) {
    return {
      full: normalizedSource ?? formatStructuredFullAddress(input),
      letter: formatStructuredAddress(input),
    };
  }

  const letter = normalizedSource
    ? (normalizedSource.includes('\n')
        ? normalizedSource
        : (formatSingaporeFreeText(normalizedSource) ?? normalizedSource))
    : null;

  return { full: normalizedSource, letter };
}

function createdAtTime(value: Date | string | undefined): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
}

function compareContactDetails(
  left: ContactDetailInput,
  right: ContactDetailInput,
): number {
  if (Boolean(left.isPrimary) !== Boolean(right.isPrimary)) {
    return left.isPrimary ? -1 : 1;
  }

  const leftDisplayOrder = left.displayOrder ?? Number.POSITIVE_INFINITY;
  const rightDisplayOrder = right.displayOrder ?? Number.POSITIVE_INFINITY;
  if (leftDisplayOrder !== rightDisplayOrder) {
    return leftDisplayOrder - rightDisplayOrder;
  }

  return createdAtTime(left.createdAt) - createdAtTime(right.createdAt);
}

export function chooseContactDetail(
  details: ContactDetailInput[],
  detailType: 'EMAIL' | 'PHONE',
  companyId: string,
): string | null {
  const candidates = details.filter(
    (detail) => detail.detailType === detailType && clean(detail.value),
  );
  const companySpecific = candidates.filter(
    (detail) => detail.companyId === companyId,
  );
  const general = candidates.filter((detail) => detail.companyId == null);
  const selected = [...(companySpecific.length ? companySpecific : general)].sort(
    compareContactDetails,
  )[0];

  return clean(selected?.value);
}

export function buildPartyContactFields(input: {
  companyId: string;
  roleAddress?: string | null;
  contactAddress?: string | null;
  contactDetails?: ContactDetailInput[];
}): { email: string | null; phone: string | null; address: PartyAddress } {
  const details = input.contactDetails ?? [];
  const address = clean(input.roleAddress) ?? clean(input.contactAddress);

  return {
    email: chooseContactDetail(details, 'EMAIL', input.companyId),
    phone: chooseContactDetail(details, 'PHONE', input.companyId),
    address: formatLetterAddress({ fullAddress: address }),
  };
}
