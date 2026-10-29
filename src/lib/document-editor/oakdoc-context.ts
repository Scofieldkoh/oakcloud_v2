import type { OakDocFieldDefinition } from '@/lib/document-editor/oakdoc-fields';
import { formatLetterAddress } from '@/lib/document-party';
import { listedOakDocDirectors, listedOakDocShareholders } from '@/lib/document-editor/oakdoc-repeater-definitions';

export interface OakDocCompanyAddress {
  addressType?: string | null;
  fullAddress?: string | null;
  block?: string | null;
  streetName?: string | null;
  level?: string | null;
  unit?: string | null;
  buildingName?: string | null;
  postalCode?: string | null;
  country?: string | null;
  isCurrent?: boolean;
}

export interface OakDocPartyAddress {
  full?: string | null;
  letter?: string | null;
}

export interface OakDocOfficer {
  id: string;
  /** The person's contact, when linked; tells two appointments of one person apart from namesakes. */
  contactId?: string | null;
  name: string;
  role?: string | null;
  identificationNumber?: string | null;
  /** NRIC, FIN, PASSPORT, UEN or OTHER, when known. */
  identificationType?: string | null;
  nationality?: string | null;
  address?: string | null;
  letterAddress?: string | null;
  email?: string | null;
  phone?: string | null;
  appointmentDate?: string | null;
  isCurrent?: boolean;
  /** The linked contact's identity, when the appointment's own is blank. */
  contact?: OakDocPartyIdentity | null;
}

/** Identity details of a party's linked contact. */
export interface OakDocPartyIdentity {
  contactType?: string | null;
  identificationType?: string | null;
  identificationNumber?: string | null;
  corporateUen?: string | null;
}

export interface OakDocShareholder {
  id: string;
  name: string;
  shareholderType?: string | null;
  isNominee?: boolean | null;
  identificationNumber?: string | null;
  identificationType?: string | null;
  nationality?: string | null;
  /** A corporate shareholder's place of incorporation. */
  placeOfOrigin?: string | null;
  contact?: OakDocPartyIdentity | null;
  address?: string | null;
  letterAddress?: string | null;
  email?: string | null;
  phone?: string | null;
  shareClass?: string | null;
  numberOfShares?: number | null;
  percentageHeld?: number | string | null;
  isCurrent?: boolean;
}

export interface OakDocContact {
  id: string;
  contactId?: string | null;
  name: string;
  detail?: string | null;
  appointments?: string[];
  role?: string | null;
  contactType?: string | null;
  email?: string | null;
  phone?: string | null;
  nationality?: string | null;
  identificationNumber?: string | null;
  identificationType?: string | null;
  address?: OakDocPartyAddress | string | null;
}

export interface OakDocAgreementEntity {
  id: string;
  name: string;
  uen?: string | null;
  entityType?: string | null;
  registeredAddress?: string | null;
}

export interface OakDocAgreementContext {
  agreementDate?: Date | string | null;
  effectiveDate?: Date | string | null;
  termMonths?: number | string | null;
}

export interface OakDocResolutionContext {
  date?: Date | string | null;
}

export interface OakDocCompanyDetail {
  id: string;
  name: string;
  uen: string;
  entityType?: string | null;
  incorporationDate?: string | null;
  primarySsicCode?: string | null;
  primarySsicDescription?: string | null;
  secondarySsicCode?: string | null;
  secondarySsicDescription?: string | null;
  financialYearEndDay?: number | null;
  financialYearEndMonth?: number | null;
  /** The first confirmed financial period (it may run over 12 months). */
  financialPeriods?: Array<{ periodEnd?: string | null }>;
  paidUpCapitalCurrency?: string | null;
  paidUpCapitalAmount?: number | string | null;
  issuedCapitalCurrency?: string | null;
  issuedCapitalAmount?: number | string | null;
  registeredAddress?: string | null;
  addresses?: OakDocCompanyAddress[];
  officers?: OakDocOfficer[];
  shareholders?: OakDocShareholder[];
  contacts?: OakDocContact[];
  /** The company's auditor on record, if any. */
  auditor?: { name?: string | null; address?: string | null } | null;
}

export const OAKDOC_AGREEMENT_FIELD_DEFINITIONS: ReadonlyArray<
  OakDocFieldDefinition & { example: string }
> = [
  {
    tag: 'agreement.agreementDate',
    label: 'Agreement Date',
    category: 'Agreement Context',
    example: '25 Sep 2026',
  },
  {
    tag: 'agreement.effectiveDate',
    label: 'Effective Date',
    category: 'Agreement Context',
    example: '1 Oct 2026',
  },
  {
    tag: 'agreement.termMonths',
    label: 'Term (Months)',
    category: 'Agreement Context',
    example: '12',
  },
  {
    tag: 'agreement.term',
    label: 'Term',
    category: 'Agreement Context',
    example: '1 year',
  },
];

export const OAKDOC_AGREEMENT_FIELD_TAGS = new Set(
  OAKDOC_AGREEMENT_FIELD_DEFINITIONS.map((field) => field.tag),
);

export const OAKDOC_SELECTED_CONTACT_FIELD_DEFINITIONS: ReadonlyArray<
  OakDocFieldDefinition & { example: string }
> = [
  { tag: 'selectedContact.name', label: 'Contact Name', category: 'Selected Contact', example: 'Alex Lim' },
  { tag: 'selectedContact.detail', label: 'Contact Detail', category: 'Selected Contact', example: 'Director' },
  { tag: 'selectedContact.role', label: 'Contact Role', category: 'Selected Contact', example: 'Director' },
  { tag: 'selectedContact.email', label: 'Contact Email', category: 'Selected Contact', example: 'alex@example.com' },
  { tag: 'selectedContact.phone', label: 'Contact Phone', category: 'Selected Contact', example: '+65 6123 4567' },
  { tag: 'selectedContact.address.full', label: 'Contact Full Address', category: 'Selected Contact', example: '123 Sample Street, Singapore 123456' },
  { tag: 'selectedContact.address.letter', label: 'Contact Letter Address', category: 'Selected Contact', example: '123 Sample Street, Singapore 123456' },
  { tag: 'selectedContact.nationality', label: 'Contact Nationality', category: 'Selected Contact', example: 'Singaporean' },
  { tag: 'selectedContact.identificationNumber', label: 'Contact Identification Number', category: 'Selected Contact', example: 'S1234567A' },
  { tag: 'selectedContact.contactType', label: 'Contact Type', category: 'Selected Contact', example: 'INDIVIDUAL' },
] as const;

export const OAKDOC_RESOLUTION_FIELD_DEFINITIONS: ReadonlyArray<
  OakDocFieldDefinition & { example: string }
> = [
  {
    tag: 'resolution.date',
    label: 'Resolution Date',
    category: 'Resolution Context',
    example: '25 Sep 2026',
  },
];

/**
 * Whether the directors or shareholders sections list more than one person,
 * for wording such as "Director" or "Directors" in a condition. "Yes" when
 * they do, blank for one or none, like `shareholder.isCorporate`.
 */
export const OAKDOC_SECTION_COUNT_FIELD_DEFINITIONS: ReadonlyArray<
  OakDocFieldDefinition & { example: string }
> = [
  {
    tag: 'directors.isPlural',
    label: 'More Than One Director Listed (Yes or blank)',
    category: 'Repeating Section Counts',
    example: 'Yes',
  },
  {
    tag: 'shareholders.isPlural',
    label: 'More Than One Shareholder Listed (Yes or blank)',
    category: 'Repeating Section Counts',
    example: 'Yes',
  },
];

export const OAKDOC_RESOLUTION_FIELD_TAGS = new Set(
  OAKDOC_RESOLUTION_FIELD_DEFINITIONS.map((field) => field.tag),
);

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})(?:T00:00:00(?:\.000)?Z)?$/;

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

/**
 * Read a value as a calendar date. Date-only values (`YYYY-MM-DD`, or the
 * UTC midnight Prisma returns for `@db.Date`) keep their calendar day in
 * every timezone; other timestamps use the local day.
 */
function calendarDate(value: unknown): CalendarDate | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const utcMidnight = value.getUTCHours() === 0
      && value.getUTCMinutes() === 0
      && value.getUTCSeconds() === 0
      && value.getUTCMilliseconds() === 0;
    return utcMidnight
      ? { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate() }
      : { year: value.getFullYear(), month: value.getMonth() + 1, day: value.getDate() };
  }
  if (typeof value !== 'string') return null;
  const dateOnly = DATE_ONLY.exec(value);
  if (dateOnly) {
    return { year: Number(dateOnly[1]), month: Number(dateOnly[2]), day: Number(dateOnly[3]) };
  }
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  return calendarDate(new Date(value));
}

/**
 * Format a date with a Word date pattern (`d`, `dd`, `M`, `MM`, `MMM`,
 * `MMMM`, `yy`, `yyyy`). The default keeps OakDoc's short style.
 */
/** 1st, 2nd, 3rd, 4th... 11th, 12th, 13th, 21st. */
function ordinalDay(day: number): string {
  const teen = day % 100 >= 11 && day % 100 <= 13;
  const suffix = teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[day % 10] ?? 'th';
  return `${day}${suffix}`;
}

/** A date in a Word-style pattern; `do` is the day as an ordinal ("3rd"). */
export function formatOakDocDate(value: unknown, pattern = 'd MMM yyyy'): string | undefined {
  const date = calendarDate(value);
  if (!date) return undefined;
  const month = MONTHS[date.month - 1];
  return pattern.replace(/yyyy|yy|MMMM|MMM|MM|M|do|dd|d/g, (token) => {
    switch (token) {
      case 'yyyy': return String(date.year);
      case 'yy': return String(date.year).slice(-2);
      case 'MMMM': return month;
      case 'MMM': return month.slice(0, 3);
      case 'MM': return String(date.month).padStart(2, '0');
      case 'M': return String(date.month);
      case 'do': return ordinalDay(date.day);
      case 'dd': return String(date.day).padStart(2, '0');
      default: return String(date.day);
    }
  });
}

/** The ISO calendar date (`YYYY-MM-DD`) of a date-valued field, if any. */
export function oakDocIsoDate(value: unknown): string | undefined {
  const date = calendarDate(value);
  if (!date) return undefined;
  return [
    String(date.year).padStart(4, '0'),
    String(date.month).padStart(2, '0'),
    String(date.day).padStart(2, '0'),
  ].join('-');
}

/** Agreement term in words: 12 → 1 year, 24 → 2 years, 18 → 18 months. */
export function formatAgreementTerm(months: unknown): string | undefined {
  const value = Number(months);
  if (!Number.isInteger(value) || value <= 0) return undefined;
  if (value % 12 === 0) {
    const years = value / 12;
    return `${years} year${years === 1 ? '' : 's'}`;
  }
  return `${value} month${value === 1 ? '' : 's'}`;
}

function formatDate(value: unknown): string | undefined {
  if (!value) return undefined;
  return formatOakDocDate(value) ?? String(value);
}

function formatValue(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (value instanceof Date) return formatDate(value);
  if (typeof value === 'number') return value.toLocaleString('en-SG');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';

  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) {
      return formatDate(value);
    }
    return value;
  }

  return String(value);
}

function getValueByPath(source: unknown, path: string): unknown {
  if (!source || typeof source !== 'object') return undefined;
  let current: unknown = source;

  for (const segment of path.split('.')) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

function registeredAddress(company: OakDocCompanyDetail): OakDocCompanyAddress | undefined {
  return company.addresses?.find(
    (address) => address.isCurrent !== false && address.addressType === 'REGISTERED_OFFICE',
  ) ?? company.addresses?.find((address) => address.isCurrent !== false);
}

/** "46900 | Wholesale trade ..." from an SSIC code and its description. */
function ssicActivity(code: string | null | undefined, description: string | null | undefined): string {
  return [code?.trim(), description?.trim()].filter(Boolean).join(' | ');
}

function validMonthDay(day: number | null | undefined, month: number | null | undefined): boolean {
  return Number.isInteger(day) && Number.isInteger(month) && month! >= 1 && month! <= 12 && day! >= 1 && day! <= 31;
}

/** "31 December" from the company's financial year end day and month. */
function financialYearEnd(company: OakDocCompanyDetail): string {
  const { financialYearEndDay: day, financialYearEndMonth: month } = company;
  return validMonthDay(day, month) ? `${day} ${MONTHS[month! - 1]}` : '';
}

/**
 * The first financial year end as a date-only value: the confirmed first
 * period's end, else the first year end date on or after incorporation.
 */
function firstFinancialYearEnd(company: OakDocCompanyDetail): string {
  const confirmed = oakDocIsoDate(company.financialPeriods?.[0]?.periodEnd);
  if (confirmed) return confirmed;
  const incorporated = calendarDate(company.incorporationDate);
  const { financialYearEndDay: day, financialYearEndMonth: month } = company;
  if (!incorporated || !validMonthDay(day, month)) return '';
  const afterIncorporation = month! > incorporated.month
    || (month === incorporated.month && day! >= incorporated.day);
  const year = afterIncorporation ? incorporated.year : incorporated.year + 1;
  // A 29 or 31 year end in a shorter month falls on that month's last day.
  const lastDay = new Date(Date.UTC(year, month!, 0)).getUTCDate();
  return [
    String(year).padStart(4, '0'),
    String(month).padStart(2, '0'),
    String(Math.min(day!, lastDay)).padStart(2, '0'),
  ].join('-');
}

/** "SGD 10,000.00" from the paid-up (else issued) capital. */
function paidUpCapital(company: OakDocCompanyDetail): string {
  const paid = company.paidUpCapitalAmount;
  const [amount, currency] = paid !== null && paid !== undefined && paid !== ''
    ? [paid, company.paidUpCapitalCurrency]
    : [company.issuedCapitalAmount, company.issuedCapitalCurrency];
  if (amount === null || amount === undefined || amount === '' || !Number.isFinite(Number(amount))) return '';
  const formatted = Number(amount).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${currency?.trim() || 'SGD'} ${formatted}`;
}

function buildCompanyContext(company: OakDocCompanyDetail) {
  const address = registeredAddress(company);
  const fullAddress = company.registeredAddress ?? address?.fullAddress ?? '';
  // The letter form is multi-line; field replacement writes each line break.
  const letter = formatLetterAddress({
    fullAddress: address?.fullAddress ?? company.registeredAddress,
    block: address?.block,
    street: address?.streetName,
    level: address?.level,
    unit: address?.unit,
    building: address?.buildingName,
    postalCode: address?.postalCode,
    country: address?.country,
  }).letter ?? fullAddress;
  return {
    ...company,
    registeredAddress: fullAddress,
    address: {
      block: address?.block ?? '',
      street: address?.streetName ?? '',
      level: address?.level ?? '',
      unit: address?.unit ?? '',
      building: address?.buildingName ?? '',
      postalCode: address?.postalCode ?? '',
      letter,
    },
    capital: company.paidUpCapitalAmount ?? company.issuedCapitalAmount ?? '',
    paidUpCapital: paidUpCapital(company),
    primaryActivity: ssicActivity(company.primarySsicCode, company.primarySsicDescription),
    secondaryActivity: ssicActivity(company.secondarySsicCode, company.secondarySsicDescription),
    financialYearEnd: financialYearEnd(company),
    firstFinancialYearEnd: firstFinancialYearEnd(company),
    auditorName: company.auditor?.name?.trim() ?? '',
    auditorAddress: company.auditor?.address?.trim() ?? '',
  };
}

function buildSelectedDirector(officer: OakDocOfficer | undefined) {
  if (!officer) return undefined;
  return {
    name: officer.name,
    detail: officer.role || 'Director',
    email: officer.email,
    phone: officer.phone,
    nationality: officer.nationality,
    identificationNumber: officer.identificationNumber,
    role: officer.role,
    appointmentDate: officer.appointmentDate,
    address: {
      full: officer.address ?? '',
      letter: officer.letterAddress ?? officer.address ?? '',
    },
  };
}

function buildSelectedShareholder(shareholder: OakDocShareholder | undefined) {
  if (!shareholder) return undefined;
  return {
    name: shareholder.name,
    detail: shareholder.shareholderType || shareholder.shareClass || 'Shareholder',
    email: shareholder.email,
    phone: shareholder.phone,
    nationality: shareholder.nationality,
    identificationNumber: shareholder.identificationNumber,
    shareholderType: shareholder.shareholderType,
    shareClass: shareholder.shareClass,
    numberOfShares: shareholder.numberOfShares,
    percentageHeld: shareholder.percentageHeld,
    address: {
      full: shareholder.address ?? '',
      letter: shareholder.letterAddress ?? shareholder.address ?? '',
    },
  };
}

function contactAddress(contact: OakDocContact): OakDocPartyAddress {
  if (typeof contact.address === 'string') {
    return { full: contact.address, letter: contact.address };
  }
  return {
    full: contact.address?.full ?? '',
    letter: contact.address?.letter ?? contact.address?.full ?? '',
  };
}

/** The fields a contact prints, as `selectedContact.*` and Contact custom fields use them. */
export function buildSelectedContact(contact: OakDocContact | undefined) {
  if (!contact) return undefined;
  return {
    name: contact.name,
    detail:
      contact.detail
      || contact.role
      || contact.appointments?.[0]
      || contact.contactType
      || 'Contact',
    role: contact.role ?? contact.appointments?.[0] ?? contact.detail,
    email: contact.email,
    phone: contact.phone,
    nationality: contact.nationality,
    identificationNumber: contact.identificationNumber,
    contactType: contact.contactType,
    address: contactAddress(contact),
  };
}

export interface OakDocResolutionInput {
  company: OakDocCompanyDetail;
  fieldTags: readonly string[];
  selectedDirectorId?: string;
  selectedShareholderId?: string;
  /** Directors and shareholders ticked on Configure; absent means every current one. */
  selectedDirectorIds?: readonly string[];
  selectedShareholderIds?: readonly string[];
  selectedContactId?: string;
  selectedContact?: OakDocContact;
  agreement?: OakDocAgreementContext;
  resolution?: OakDocResolutionContext;
  generatedBy?: string;
}

function buildResolutionContext(input: OakDocResolutionInput) {
  const selectedDirector = input.company.officers?.find(
    (officer) => officer.id === input.selectedDirectorId,
  );
  const selectedShareholder = input.company.shareholders?.find(
    (shareholder) => shareholder.id === input.selectedShareholderId,
  );
  const selectedContact = input.selectedContact ?? input.company.contacts?.find(
    (contact) => contact.id === input.selectedContactId,
  );

  return {
    company: buildCompanyContext(input.company),
    selectedDirector: buildSelectedDirector(selectedDirector),
    selectedShareholder: buildSelectedShareholder(selectedShareholder),
    selectedContact: buildSelectedContact(selectedContact),
    agreement: {
      agreementDate: input.agreement?.agreementDate,
      // An agreement without its own effective date takes effect on the
      // agreement date, whichever caller supplied the dates.
      effectiveDate: input.agreement?.effectiveDate || input.agreement?.agreementDate,
      termMonths: input.agreement?.termMonths,
      term: formatAgreementTerm(input.agreement?.termMonths),
    },
    resolution: {
      date: input.resolution?.date,
    },
    directors: {
      isPlural: listedOakDocDirectors(input.company, input.selectedDirectorIds).length > 1 ? 'Yes' : '',
    },
    shareholders: {
      isPlural: listedOakDocShareholders(input.company, input.selectedShareholderIds).length > 1 ? 'Yes' : '',
    },
    system: {
      currentDate: new Date(),
      generatedBy: input.generatedBy,
      preparerName: input.generatedBy,
    },
  };
}

export function buildOakDocResolutionValues(input: OakDocResolutionInput): Record<string, string> {
  const context = buildResolutionContext(input);
  const values: Record<string, string> = {};
  for (const tag of input.fieldTags) {
    const value = formatValue(getValueByPath(context, tag));
    if (value !== undefined) values[tag] = value;
  }
  return values;
}

/**
 * The calendar dates behind date-valued fields, so a field control that
 * asks for its own Word date pattern can be formatted per occurrence.
 */
export function buildOakDocResolutionDates(input: OakDocResolutionInput): Record<string, string> {
  const context = buildResolutionContext(input);
  const dates: Record<string, string> = {};
  for (const tag of input.fieldTags) {
    const date = oakDocIsoDate(getValueByPath(context, tag));
    if (date) dates[tag] = date;
  }
  return dates;
}
