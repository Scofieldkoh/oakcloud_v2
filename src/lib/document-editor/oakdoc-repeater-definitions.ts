import type { OakDocFieldDefinition } from '@/lib/document-editor/oakdoc-fields';
import { OFFICER_ROLES } from '@/lib/constants';
import { oneOfficerPerPerson } from '@/lib/officer-identity';
import { contactIdentity, identificationLabel } from '@/lib/document-party';
import type {
  OakDocAgreementEntity,
  OakDocCompanyDetail,
  OakDocContact,
  OakDocOfficer,
  OakDocShareholder,
} from '@/lib/document-editor/oakdoc-context';

export type OakDocGenericRepeaterKind =
  | 'directors'
  | 'shareholders'
  | 'contacts'
  | 'officers'
  | 'signers'
  | 'authorisedRepresentatives'
  | 'agreementEntities';

export const OAKDOC_DIRECTORS_REPEATER_TAG = 'repeat.directors';
export const OAKDOC_SHAREHOLDERS_REPEATER_TAG = 'repeat.shareholders';
export const OAKDOC_CONTACTS_REPEATER_TAG = 'repeat.contacts';
export const OAKDOC_OFFICERS_REPEATER_TAG = 'repeat.officers';

export interface OakDocRepeaterGenerationData {
  company: OakDocCompanyDetail;
  /** Contacts chosen on Configure, in the order they were picked. */
  contacts?: readonly OakDocContact[];
  /**
   * Contacts of each named contacts list (`repeat.contacts.<slug>`), by slug,
   * in the order picked; a named section prints only its own list.
   */
  contactLists?: Readonly<Record<string, readonly OakDocContact[]>>;
  signers?: readonly OakDocContact[];
  authorisedRepresentatives?: readonly OakDocContact[];
  agreementEntities?: readonly OakDocAgreementEntity[];
  /** Directors to repeat, by officer id; absent means every current director. */
  selectedDirectorIds?: readonly string[];
  /** Shareholders to repeat, by shareholder id; absent means every current shareholder. */
  selectedShareholderIds?: readonly string[];
  /**
   * Officers to repeat, by officer id, in that order; absent means none. An
   * officers repeater limited to roles prints only those of its roles, and
   * each person once (Configure stores the record of the role chosen).
   */
  selectedOfficerIds?: readonly string[];
  /**
   * The dividend per share entered on Configure (the `custom.dividend_per_share`
   * field), from which each shareholder's Dividend Amount is worked out.
   */
  dividendPerShare?: number | null;
  /**
   * Values of each section's per-person fields (`item.<key>`), ready to
   * print: by repeater tag, then person id, then field tag.
   */
  personValues?: Readonly<Record<string, Readonly<Record<string, Readonly<Record<string, string>>>>>>;
}

/**
 * The id of the person (officer, shareholder or contact) a repeated item is
 * for, carried with its values so per-person values can be added; not a tag.
 */
export const OAKDOC_REPEATER_ITEM_ID = '@id';

/** Custom field key whose amount each shareholder's Dividend Amount multiplies. */
export const OAKDOC_DIVIDEND_PER_SHARE_KEY = 'dividend_per_share';

/** A typed amount ("0.05", "SGD 1,000.50") as a number; null when it is not one. */
export function parseOakDocAmount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.replace(/[^0-9.-]/g, '');
  if (!/^-?\d*\.?\d+$/.test(text)) return null;
  const amount = Number(text);
  return Number.isFinite(amount) ? amount : null;
}

/** Roles an officers repeater can be limited to, with the slug its tag carries. */
export const OAKDOC_OFFICER_ROLE_FILTERS: ReadonlyArray<{ role: string; slug: string; label: string }> =
  OFFICER_ROLES.map(({ value, label }) => ({
    role: value,
    slug: value.toLowerCase().replace(/_/g, '-'),
    label,
  }));

const OFFICER_ROLE_BY_SLUG = new Map(OAKDOC_OFFICER_ROLE_FILTERS.map((entry) => [entry.slug, entry]));
const OFFICER_ROLE_SEPARATOR = '+';

/** A stored role ("SECRETARY", "Managing Director") as its registry value. */
export function normalizeOakDocOfficerRole(role: string | null | undefined): string {
  return (role ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');
}

/**
 * The roles an officers repeater tag is limited to: `repeat.officers` is
 * any role (an empty list), `repeat.officers.secretary+ceo` those roles.
 * Null when the tag is not an officers repeater or names an unknown role.
 */
export function parseOakDocOfficerRepeaterRoles(tag: string): string[] | null {
  if (tag === OAKDOC_OFFICERS_REPEATER_TAG) return [];
  const prefix = OAKDOC_OFFICERS_REPEATER_TAG + '.';
  if (!tag.startsWith(prefix)) return null;
  const slugs = tag.slice(prefix.length).split(OFFICER_ROLE_SEPARATOR);
  const roles: string[] = [];
  for (const slug of slugs) {
    const entry = OFFICER_ROLE_BY_SLUG.get(slug);
    if (!entry) return null;
    roles.push(entry.role);
  }
  // Only the canonical spelling (registry order, no repeats) is a repeater tag.
  return oakDocOfficersRepeaterTag(roles) === tag ? roles : null;
}

/** The officers repeater tag for these roles, in registry order; none means any role. */
export function oakDocOfficersRepeaterTag(roles: readonly string[]): string {
  const wanted = new Set(roles.map(normalizeOakDocOfficerRole));
  const slugs = OAKDOC_OFFICER_ROLE_FILTERS
    .filter((entry) => wanted.has(entry.role))
    .map((entry) => entry.slug);
  return slugs.length === 0
    ? OAKDOC_OFFICERS_REPEATER_TAG
    : OAKDOC_OFFICERS_REPEATER_TAG + '.' + slugs.join(OFFICER_ROLE_SEPARATOR);
}

/** "Secretary, CEO" for a role list; empty for any role. */
export function formatOakDocOfficerRoles(roles: readonly string[]): string {
  const wanted = new Set(roles.map(normalizeOakDocOfficerRole));
  return OAKDOC_OFFICER_ROLE_FILTERS
    .filter((entry) => wanted.has(entry.role))
    .map((entry) => entry.label)
    .join(', ');
}

/**
 * Roles the officers repeaters among these tags print, together: null when
 * any of them takes any role (or none is present), else the union.
 */
export function oakDocOfficerRepeaterRoleUnion(tags: Iterable<string>): string[] | null {
  const roles = new Set<string>();
  let found = false;
  for (const tag of tags) {
    const limited = parseOakDocOfficerRepeaterRoles(tag);
    if (limited === null) continue;
    if (limited.length === 0) return null;
    found = true;
    for (const role of limited) roles.add(role);
  }
  return found ? OAKDOC_OFFICER_ROLE_FILTERS.filter((entry) => roles.has(entry.role)).map((entry) => entry.role) : null;
}

/*
 * Named contacts lists. A Contacts section given a name ("Corporate secretary
 * to be appointed") gets its own tag, `repeat.contacts.<slug>`, so Configure
 * keeps a separate list for it. The slug is the name in lower case, letters
 * and digits only, joined by single hyphens, at most 60 characters. Plain
 * `repeat.contacts` stays the document's unnamed list.
 */
export const OAKDOC_CONTACT_LIST_SLUG_MAX = 60;
/** Longest name a repeating section can be given. */
export const OAKDOC_REPEATER_NAME_MAX = 80;
const CONTACT_LIST_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CONTACT_LIST_PREFIX = OAKDOC_CONTACTS_REPEATER_TAG + '.';

export function isOakDocContactListSlug(slug: string): boolean {
  return slug.length <= OAKDOC_CONTACT_LIST_SLUG_MAX && CONTACT_LIST_SLUG.test(slug);
}

/** "Corporate secretary to be appointed" -> corporate-secretary-to-be-appointed; '' when it has no letters or digits. */
export function oakDocContactListSlug(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, OAKDOC_CONTACT_LIST_SLUG_MAX)
    .replace(/-+$/, '');
}

/** The contacts repeater tag of a named list; plain `repeat.contacts` without one. */
export function oakDocContactsRepeaterTag(slug?: string | null): string {
  return slug ? CONTACT_LIST_PREFIX + slug : OAKDOC_CONTACTS_REPEATER_TAG;
}

/** The slug of a named contacts list tag; null for any other tag (including plain `repeat.contacts`). */
export function parseOakDocContactListSlug(tag: string): string | null {
  if (!tag.startsWith(CONTACT_LIST_PREFIX)) return null;
  const slug = tag.slice(CONTACT_LIST_PREFIX.length);
  return isOakDocContactListSlug(slug) ? slug : null;
}

/** True for `repeat.contacts` and every named contacts list tag. */
export function isOakDocContactsRepeaterTag(tag: string): boolean {
  return tag === OAKDOC_CONTACTS_REPEATER_TAG || parseOakDocContactListSlug(tag) !== null;
}

/** A readable name from a slug, for a named list whose name was not stored. */
export function oakDocContactListNameFromSlug(slug: string): string {
  const words = slug.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function isSelected(ids: readonly string[] | undefined, id: string): boolean {
  return ids === undefined || ids.includes(id);
}

/** The directors a directors section lists: current ones, those ticked on Configure. */
export function listedOakDocDirectors(company: OakDocCompanyDetail, selectedIds?: readonly string[]): OakDocOfficer[] {
  return (company.officers ?? []).filter((officer) => officer.isCurrent !== false
    && String(officer.role || '').toUpperCase().includes('DIRECTOR')
    && isSelected(selectedIds, officer.id));
}

/** The shareholders a shareholders section lists: current ones, those ticked on Configure. */
export function listedOakDocShareholders(company: OakDocCompanyDetail, selectedIds?: readonly string[]): OakDocShareholder[] {
  return (company.shareholders ?? []).filter((shareholder) => shareholder.isCurrent !== false
    && isSelected(selectedIds, shareholder.id));
}

export interface OakDocGenericRepeaterDefinition {
  kind: OakDocGenericRepeaterKind;
  tag: string;
  label: string;
  itemLabel: string;
  itemTagNamespace: string;
  fields: ReadonlyArray<OakDocFieldDefinition & { example: string }>;
  /** Item values to repeat; `tag` is the repeater's own tag, which may narrow it. */
  generationDataAdapter: (
    data: OakDocRepeaterGenerationData,
    tag: string,
  ) => Array<Record<string, string>>;
}

function formatDate(value: unknown): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-SG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function formatNumber(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toLocaleString('en-SG') : String(value);
}

function formatPercentage(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  const text = String(value).trim();
  return text.endsWith('%') ? text : text + '%';
}

function contactAddress(contact: OakDocContact): string {
  if (typeof contact.address === 'string') return contact.address;
  return contact.address?.full ?? '';
}

/** The phone as it follows the email in "email / mobile", without a dangling slash. */
function phoneAfterEmail(contact: OakDocContact): string {
  const email = contact.email?.trim() ?? '';
  const phone = contact.phone?.trim() ?? '';
  if (!phone) return '';
  return email ? ` / ${phone}` : phone;
}

function isCorporate(type: string | null | undefined): boolean {
  return (type ?? '').toUpperCase() === 'CORPORATE';
}

function contactValues(namespace: string, contact: OakDocContact): Record<string, string> {
  const corporate = isCorporate(contact.contactType);
  return {
    [OAKDOC_REPEATER_ITEM_ID]: contact.id,
    [namespace + '.name']: contact.name || '',
    [namespace + '.role']:
      formatOakDocRole(contact.role || contact.detail || contact.appointments?.[0]),
    [namespace + '.email']: contact.email || '',
    [namespace + '.phone']: contact.phone || '',
    [namespace + '.phoneAfterEmail']: phoneAfterEmail(contact),
    [namespace + '.address']: contactAddress(contact),
    [namespace + '.identificationNumber']: contact.identificationNumber || '',
    [namespace + '.idLabel']: identificationLabel(contact.identificationType, corporate, contact.identificationNumber),
    [namespace + '.isCorporate']: corporate ? 'Yes' : '',
    [namespace + '.nationality']: contact.nationality || '',
  };
}

// Titles that stay in capitals when a role is put into proper case.
const ROLE_ACRONYMS = new Set(['CEO', 'CFO', 'COO', 'CTO', 'CIO', 'CMO', 'MD', 'GM', 'VP', 'SVP', 'EVP']);
const ROLE_SMALL_WORDS = new Set(['and', 'of', 'the', 'for', 'to', 'in', 'on', 'or']);

/**
 * Registry roles arrive in capitals ("MANAGING DIRECTOR"); documents want
 * "Managing Director". Titles such as CEO or CFO stay as they are, and a
 * role already typed in mixed case is left untouched.
 */
export function formatOakDocRole(value: string | null | undefined): string {
  const stored = (value ?? '').trim();
  if (!stored || stored !== stored.toUpperCase()) return stored;
  // Registry keys ("NOMINEE_DIRECTOR") read as words.
  const role = stored.replace(/_/g, ' ');
  let first = true;
  return role.replace(/[A-Za-z]+/g, (word) => {
    const isFirst = first;
    first = false;
    if (ROLE_ACRONYMS.has(word)) return word;
    const lower = word.toLowerCase();
    if (!isFirst && ROLE_SMALL_WORDS.has(lower)) return lower;
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  });
}

/** An officer's or shareholder's own number, else their linked contact's. */
function partyIdentity(party: OakDocOfficer | OakDocShareholder): { number: string; type: string | null } {
  const own = party.identificationNumber?.trim();
  if (own) return { number: own, type: party.identificationType ?? null };
  const linked = party.contact ? contactIdentity(party.contact) : null;
  return { number: linked?.identificationNumber ?? '', type: linked?.identificationType ?? null };
}

function directorValues(officer: OakDocOfficer): Record<string, string> {
  const identity = partyIdentity(officer);
  return {
    [OAKDOC_REPEATER_ITEM_ID]: officer.id,
    'director.name': officer.name || '',
    'director.role': formatOakDocRole(officer.role),
    'director.identificationNumber': identity.number,
    'director.idLabel': identificationLabel(identity.type, false, identity.number),
    'director.nationality': officer.nationality || '',
    'director.appointmentDate': formatDate(officer.appointmentDate),
    'director.address': officer.address || '',
  };
}

function officerValues(officer: OakDocOfficer): Record<string, string> {
  const identity = partyIdentity(officer);
  return {
    [OAKDOC_REPEATER_ITEM_ID]: officer.id,
    'officer.name': officer.name || '',
    'officer.role': formatOakDocRole(officer.role),
    'officer.identificationNumber': identity.number,
    'officer.idLabel': identificationLabel(identity.type, false, identity.number),
    'officer.nationality': officer.nationality || '',
    'officer.appointmentDate': formatDate(officer.appointmentDate),
    'officer.address': officer.address || '',
  };
}

/** Shares times the dividend per share, to the cent; blank without either. */
function dividendAmount(shares: number | null | undefined, perShare: number | null | undefined): string {
  if (perShare === null || perShare === undefined || shares === null || shares === undefined) return '';
  const amount = Math.round(Number(shares) * perShare * 100) / 100;
  if (!Number.isFinite(amount)) return '';
  return amount.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function shareholderValues(shareholder: OakDocShareholder, dividendPerShare?: number | null): Record<string, string> {
  const corporate = isCorporate(shareholder.shareholderType);
  const identity = partyIdentity(shareholder);
  const nationality = shareholder.nationality?.trim() ?? '';
  return {
    [OAKDOC_REPEATER_ITEM_ID]: shareholder.id,
    'shareholder.name': shareholder.name || '',
    'shareholder.shareholderType': formatOakDocRole(shareholder.shareholderType),
    'shareholder.identificationNumber': identity.number,
    'shareholder.idLabel': identificationLabel(identity.type, corporate, identity.number),
    'shareholder.isCorporate': corporate ? 'Yes' : '',
    'shareholder.nationality': nationality,
    'shareholder.nationalityOrPlace': corporate ? shareholder.placeOfOrigin?.trim() || nationality : nationality,
    'shareholder.address': shareholder.address || '',
    'shareholder.shareClass': shareholder.shareClass || '',
    'shareholder.numberOfShares': formatNumber(shareholder.numberOfShares),
    'shareholder.percentageHeld': formatPercentage(shareholder.percentageHeld),
    'shareholder.isNominee': shareholder.isNominee ? 'Yes' : 'No',
    'shareholder.dividendAmount': dividendAmount(shareholder.numberOfShares, dividendPerShare),
  };
}

function agreementEntityValues(entity: OakDocAgreementEntity): Record<string, string> {
  return {
    'agreementEntity.name': entity.name || '',
    'agreementEntity.uen': entity.uen || '',
    'agreementEntity.entityType': entity.entityType || '',
    'agreementEntity.registeredAddress': entity.registeredAddress || '',
  };
}

export const OAKDOC_GENERIC_REPEATER_DEFINITIONS:
readonly OakDocGenericRepeaterDefinition[] = [
  {
    kind: 'directors',
    tag: OAKDOC_DIRECTORS_REPEATER_TAG,
    label: 'Directors',
    itemLabel: 'Director',
    itemTagNamespace: 'director',
    fields: [
      { tag: 'director.name', label: 'Director Name', category: 'Repeating Director', example: 'John Tan' },
      { tag: 'director.role', label: 'Director Role', category: 'Repeating Director', example: 'Director' },
      { tag: 'director.identificationNumber', label: 'Director Identification Number', category: 'Repeating Director', example: 'S1234567A' },
      { tag: 'director.idLabel', label: 'Director ID Type (NRIC No., Passport No.)', category: 'Repeating Director', example: 'NRIC No.' },
      { tag: 'director.nationality', label: 'Director Nationality', category: 'Repeating Director', example: 'Singaporean' },
      { tag: 'director.appointmentDate', label: 'Director Appointment Date', category: 'Repeating Director', example: '15 Jan 2023' },
      { tag: 'director.address', label: 'Director Address', category: 'Repeating Director', example: '123 Sample Street' },
    ],
    generationDataAdapter: (data) => listedOakDocDirectors(data.company, data.selectedDirectorIds).map(directorValues),
  },
  {
    kind: 'shareholders',
    tag: OAKDOC_SHAREHOLDERS_REPEATER_TAG,
    label: 'Shareholders',
    itemLabel: 'Shareholder',
    itemTagNamespace: 'shareholder',
    fields: [
      { tag: 'shareholder.name', label: 'Shareholder Name', category: 'Repeating Shareholder', example: 'Mary Lee' },
      { tag: 'shareholder.shareholderType', label: 'Shareholder Type', category: 'Repeating Shareholder', example: 'Individual' },
      { tag: 'shareholder.identificationNumber', label: 'Shareholder Identification Number (UEN for a company)', category: 'Repeating Shareholder', example: 'S7654321B' },
      { tag: 'shareholder.idLabel', label: 'Shareholder ID Type (NRIC No., UEN)', category: 'Repeating Shareholder', example: 'NRIC No.' },
      { tag: 'shareholder.isCorporate', label: 'Shareholder Is a Company (Yes or blank)', category: 'Repeating Shareholder', example: '' },
      { tag: 'shareholder.nationality', label: 'Shareholder Nationality', category: 'Repeating Shareholder', example: 'Singaporean' },
      { tag: 'shareholder.nationalityOrPlace', label: 'Shareholder Nationality or Place of Incorporation', category: 'Repeating Shareholder', example: 'Singaporean' },
      { tag: 'shareholder.address', label: 'Shareholder Address', category: 'Repeating Shareholder', example: '456 Sample Road' },
      { tag: 'shareholder.shareClass', label: 'Share Class', category: 'Repeating Shareholder', example: 'Ordinary' },
      { tag: 'shareholder.numberOfShares', label: 'Number of Shares', category: 'Repeating Shareholder', example: '50,000' },
      { tag: 'shareholder.percentageHeld', label: 'Percentage Held', category: 'Repeating Shareholder', example: '50%' },
      { tag: 'shareholder.isNominee', label: 'Nominee Shareholder', category: 'Repeating Shareholder', example: 'No' },
      { tag: 'shareholder.dividendAmount', label: 'Dividend Amount (shares x Dividend per share)', category: 'Repeating Shareholder', example: '350.00' },
    ],
    generationDataAdapter: (data) => listedOakDocShareholders(data.company, data.selectedShareholderIds)
      .map((shareholder) => shareholderValues(shareholder, data.dividendPerShare)),
  },
  {
    kind: 'contacts',
    tag: OAKDOC_CONTACTS_REPEATER_TAG,
    label: 'Contacts',
    itemLabel: 'Contact',
    itemTagNamespace: 'contact',
    fields: [
      { tag: 'contact.name', label: 'Contact Name', category: 'Repeating Contact', example: 'Alex Lim' },
      { tag: 'contact.role', label: 'Contact Role', category: 'Repeating Contact', example: 'Director' },
      { tag: 'contact.email', label: 'Contact Email', category: 'Repeating Contact', example: 'alex@example.com' },
      { tag: 'contact.phone', label: 'Contact Phone', category: 'Repeating Contact', example: '+65 6123 4567' },
      { tag: 'contact.phoneAfterEmail', label: 'Contact Phone (after email)', category: 'Repeating Contact', example: ' / +65 6123 4567' },
      { tag: 'contact.address', label: 'Contact Address', category: 'Repeating Contact', example: '123 Sample Street' },
      { tag: 'contact.identificationNumber', label: 'Contact Identification Number (UEN for a company)', category: 'Repeating Contact', example: 'S1234567A' },
      { tag: 'contact.idLabel', label: 'Contact ID Type (NRIC No., UEN)', category: 'Repeating Contact', example: 'NRIC No.' },
      { tag: 'contact.isCorporate', label: 'Contact Is a Company (Yes or blank)', category: 'Repeating Contact', example: '' },
      { tag: 'contact.nationality', label: 'Contact Nationality', category: 'Repeating Contact', example: 'Singaporean' },
    ],
    // A named list (`repeat.contacts.<slug>`) prints only its own contacts.
    generationDataAdapter: (data, tag) => {
      const slug = parseOakDocContactListSlug(tag);
      const contacts = slug ? data.contactLists?.[slug] ?? [] : data.contacts ?? [];
      return contacts.map((contact) => contactValues('contact', contact));
    },
  },
  {
    kind: 'officers',
    tag: OAKDOC_OFFICERS_REPEATER_TAG,
    label: 'Officers',
    itemLabel: 'Officer',
    itemTagNamespace: 'officer',
    fields: [
      { tag: 'officer.name', label: 'Officer Name', category: 'Repeating Officer', example: 'Jane Ng' },
      { tag: 'officer.role', label: 'Officer Role', category: 'Repeating Officer', example: 'Secretary' },
      { tag: 'officer.identificationNumber', label: 'Officer Identification Number', category: 'Repeating Officer', example: 'S2345678C' },
      { tag: 'officer.idLabel', label: 'Officer ID Type (NRIC No., Passport No.)', category: 'Repeating Officer', example: 'NRIC No.' },
      { tag: 'officer.nationality', label: 'Officer Nationality', category: 'Repeating Officer', example: 'Singaporean' },
      { tag: 'officer.appointmentDate', label: 'Officer Appointment Date', category: 'Repeating Officer', example: '1 Mar 2024' },
      { tag: 'officer.address', label: 'Officer Address', category: 'Repeating Officer', example: '789 Sample Avenue' },
    ],
    // Officers ticked on Configure, of the repeater's roles (any role when
    // its tag names none: secretary, CEO, auditor, director...).
    generationDataAdapter: (data, tag) => {
      const roles = new Set(parseOakDocOfficerRepeaterRoles(tag) ?? []);
      const officers = new Map((data.company.officers ?? [])
        .filter((officer) => officer.isCurrent !== false
          && (roles.size === 0 || roles.has(normalizeOakDocOfficerRole(officer.role))))
        .map((officer) => [officer.id, officer]));
      // One paragraph per person: a saved choice with two appointments of
      // one person (from before Configure listed people once) keeps the first.
      return oneOfficerPerPerson(data.selectedOfficerIds ?? [], [...officers.values()])
        .flatMap((id) => {
          const officer = officers.get(id);
          return officer ? [officerValues(officer)] : [];
        });
    },
  },
  {
    kind: 'signers',
    tag: 'repeat.signers',
    label: 'Signers',
    itemLabel: 'Signer',
    itemTagNamespace: 'signer',
    fields: [
      { tag: 'signer.name', label: 'Signer Name', category: 'Repeating Signer', example: 'Alex Lim' },
      { tag: 'signer.role', label: 'Signer Role', category: 'Repeating Signer', example: 'Director' },
      { tag: 'signer.email', label: 'Signer Email', category: 'Repeating Signer', example: 'alex@example.com' },
      { tag: 'signer.phone', label: 'Signer Phone', category: 'Repeating Signer', example: '+65 6123 4567' },
      { tag: 'signer.phoneAfterEmail', label: 'Signer Phone (after email)', category: 'Repeating Signer', example: ' / +65 6123 4567' },
      { tag: 'signer.address', label: 'Signer Address', category: 'Repeating Signer', example: '123 Sample Street' },
    ],
    generationDataAdapter: (data) => (data.signers ?? [])
      .map((contact) => contactValues('signer', contact)),
  },
  {
    kind: 'authorisedRepresentatives',
    tag: 'repeat.authorisedRepresentatives',
    label: 'Authorised Representatives',
    itemLabel: 'Authorised Representative',
    itemTagNamespace: 'authorisedRepresentative',
    fields: [
      { tag: 'authorisedRepresentative.name', label: 'Representative Name', category: 'Repeating Authorised Representative', example: 'Alex Lim' },
      { tag: 'authorisedRepresentative.role', label: 'Representative Role', category: 'Repeating Authorised Representative', example: 'Director' },
      { tag: 'authorisedRepresentative.email', label: 'Representative Email', category: 'Repeating Authorised Representative', example: 'alex@example.com' },
      { tag: 'authorisedRepresentative.phone', label: 'Representative Phone', category: 'Repeating Authorised Representative', example: '+65 6123 4567' },
      { tag: 'authorisedRepresentative.phoneAfterEmail', label: 'Representative Phone (after email)', category: 'Repeating Authorised Representative', example: ' / +65 6123 4567' },
      { tag: 'authorisedRepresentative.address', label: 'Representative Address', category: 'Repeating Authorised Representative', example: '123 Sample Street' },
    ],
    generationDataAdapter: (data) => (data.authorisedRepresentatives ?? [])
      .map((contact) => contactValues('authorisedRepresentative', contact)),
  },
  {
    kind: 'agreementEntities',
    tag: 'repeat.agreementEntities',
    label: 'Agreement Entities',
    itemLabel: 'Agreement Entity',
    itemTagNamespace: 'agreementEntity',
    fields: [
      { tag: 'agreementEntity.name', label: 'Entity Name', category: 'Repeating Agreement Entity', example: 'Example Pte. Ltd.' },
      { tag: 'agreementEntity.uen', label: 'Entity UEN', category: 'Repeating Agreement Entity', example: '202600001A' },
      { tag: 'agreementEntity.entityType', label: 'Entity Type', category: 'Repeating Agreement Entity', example: 'Private Limited Company' },
      { tag: 'agreementEntity.registeredAddress', label: 'Registered Address', category: 'Repeating Agreement Entity', example: '123 Sample Street' },
    ],
    generationDataAdapter: (data) => (data.agreementEntities ?? [])
      .map(agreementEntityValues),
  },
] as const;

export const OAKDOC_GENERIC_REPEATER_BY_TAG = new Map(
  OAKDOC_GENERIC_REPEATER_DEFINITIONS.map((definition) => [definition.tag, definition]),
);

export const OAKDOC_GENERIC_REPEATER_TAGS = new Set(
  OAKDOC_GENERIC_REPEATER_DEFINITIONS.map((definition) => definition.tag),
);

/**
 * The definition behind a repeater tag, including an officers repeater
 * limited to roles (`repeat.officers.secretary`) and a named contacts list
 * (`repeat.contacts.<slug>`).
 */
export function oakDocRepeaterDefinitionForTag(tag: string): OakDocGenericRepeaterDefinition | undefined {
  const exact = OAKDOC_GENERIC_REPEATER_BY_TAG.get(tag);
  if (exact) return exact;
  if (parseOakDocContactListSlug(tag) !== null) return OAKDOC_GENERIC_REPEATER_BY_TAG.get(OAKDOC_CONTACTS_REPEATER_TAG);
  return parseOakDocOfficerRepeaterRoles(tag) !== null
    ? OAKDOC_GENERIC_REPEATER_BY_TAG.get(OAKDOC_OFFICERS_REPEATER_TAG)
    : undefined;
}

export function isOakDocRepeaterTag(tag: string): boolean {
  return oakDocRepeaterDefinitionForTag(tag) !== undefined;
}

/** Sections that can make a separate document for each person: people picked on Configure. */
const PER_PERSON_KINDS: ReadonlySet<OakDocGenericRepeaterKind> = new Set(['directors', 'shareholders', 'officers', 'contacts']);

/** True when a section with this tag can make a separate document for each person. */
export function canOakDocRepeaterSplitDocuments(tag: string): boolean {
  const kind = oakDocRepeaterDefinitionForTag(tag)?.kind;
  return kind !== undefined && PER_PERSON_KINDS.has(kind);
}

/** The officers repeater definition inserting a section limited to these roles. */
export function oakDocOfficersRepeaterDefinition(roles: readonly string[]): OakDocGenericRepeaterDefinition {
  const base = OAKDOC_GENERIC_REPEATER_BY_TAG.get(OAKDOC_OFFICERS_REPEATER_TAG)!;
  const tag = oakDocOfficersRepeaterTag(roles);
  if (tag === base.tag) return base;
  return { ...base, tag, label: `${base.label} (${formatOakDocOfficerRoles(roles)})` };
}

/** The contacts repeater definition inserting a named list's section; plain contacts without a name. */
export function oakDocContactsRepeaterDefinition(name?: string | null): OakDocGenericRepeaterDefinition {
  const base = OAKDOC_GENERIC_REPEATER_BY_TAG.get(OAKDOC_CONTACTS_REPEATER_TAG)!;
  const slug = oakDocContactListSlug(name ?? '');
  if (!slug) return base;
  return { ...base, tag: oakDocContactsRepeaterTag(slug), label: `${base.label} (${name!.trim()})` };
}

export const OAKDOC_GENERIC_REPEATER_ITEM_TAGS = new Set(
  OAKDOC_GENERIC_REPEATER_DEFINITIONS.flatMap(
    (definition) => definition.fields.map((field) => field.tag),
  ),
);
