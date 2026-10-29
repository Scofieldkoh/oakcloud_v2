/**
 * Where each company value a Word (OakDoc) template prints is kept, so a
 * value missing for the selected company can be filled from Configure:
 * saved back to the company, or used for one document only.
 *
 * Client-safe: no server modules. Each home names the profile section it is
 * saved to, the input it needs and how its value encodes as a string (the
 * form it takes in a batch item's `companyFieldValues` and on the wire).
 */

import { buildFullAddress } from '@/services/bizfile/normalizer';
import {
  buildOakDocResolutionValues,
  formatOakDocDate,
  type OakDocCompanyAddress,
  type OakDocCompanyDetail,
} from '@/lib/document-editor/oakdoc-context';
import { oakDocFieldContext } from '@/lib/document-editor/oakdoc-field-registry';
import {
  COMPANY_FIELD_HOME_IDS,
  isCompanyFieldHomeId,
  type CompanyFieldHomeId,
} from '@/lib/document-editor/oakdoc-company-field-ids';

/** The input a value needs: a date, free text, a day and month, an address or an amount. */
export type CompanyFieldInputKind = 'date' | 'text' | 'yearEnd' | 'address' | 'money';

export { COMPANY_FIELD_HOME_IDS, isCompanyFieldHomeId, type CompanyFieldHomeId };

/** Company profile section a value is saved to (`/api/companies/[id]/profile/[section]`). */
export type CompanyFieldSection = 'identity' | 'addresses' | 'compliance' | 'capital';

export interface CompanyFieldHome {
  id: CompanyFieldHomeId;
  label: string;
  input: CompanyFieldInputKind;
  /** Tags that print from this value. */
  tags: readonly string[];
  /** The tag whose blank value means the company has no value on record. */
  probeTag: string;
  section: CompanyFieldSection;
  /** How the confirmation names the place it is saved, e.g. "compliance data". */
  sectionLabel: string;
}

const ADDRESS_TAGS = [
  'company.registeredAddress',
  'company.address.block',
  'company.address.street',
  'company.address.level',
  'company.address.unit',
  'company.address.building',
  'company.address.postalCode',
  'company.address.letter',
] as const;

export const COMPANY_FIELD_HOMES: readonly CompanyFieldHome[] = [
  {
    id: 'uen',
    label: 'UEN',
    input: 'text',
    tags: ['company.uen'],
    probeTag: 'company.uen',
    section: 'identity',
    sectionLabel: 'company profile',
  },
  {
    id: 'incorporationDate',
    label: 'Incorporation date',
    input: 'date',
    tags: ['company.incorporationDate'],
    probeTag: 'company.incorporationDate',
    section: 'identity',
    sectionLabel: 'company profile',
  },
  {
    id: 'financialYearEnd',
    label: 'Financial year end',
    input: 'yearEnd',
    tags: ['company.financialYearEnd'],
    probeTag: 'company.financialYearEnd',
    section: 'compliance',
    sectionLabel: 'compliance data',
  },
  {
    id: 'firstFinancialYearEnd',
    label: 'First financial year end',
    input: 'date',
    tags: ['company.firstFinancialYearEnd'],
    probeTag: 'company.firstFinancialYearEnd',
    section: 'compliance',
    sectionLabel: 'compliance data',
  },
  {
    id: 'registeredAddress',
    label: 'Registered office address',
    input: 'address',
    tags: ADDRESS_TAGS,
    probeTag: 'company.registeredAddress',
    section: 'addresses',
    sectionLabel: 'registered address',
  },
  {
    id: 'paidUpCapital',
    label: 'Paid-up capital',
    input: 'money',
    tags: ['company.paidUpCapital', 'company.capital'],
    probeTag: 'company.paidUpCapital',
    section: 'capital',
    sectionLabel: 'share capital',
  },
];

const HOME_BY_ID = new Map(COMPANY_FIELD_HOMES.map((home) => [home.id, home]));
const HOME_BY_TAG = new Map(COMPANY_FIELD_HOMES.flatMap((home) => home.tags.map((tag) => [tag, home] as const)));

export function companyFieldHome(id: CompanyFieldHomeId): CompanyFieldHome {
  return HOME_BY_ID.get(id)!;
}

/** The home a tag prints from, if it has one. */
export function companyFieldHomeForTag(tag: string): CompanyFieldHome | null {
  return HOME_BY_TAG.get(tag) ?? null;
}

// ---------------------------------------------------------------------------
// Value encodings
// ---------------------------------------------------------------------------

export interface CompanyFieldAddressValue {
  block?: string | null;
  streetName: string;
  level?: string | null;
  unit?: string | null;
  buildingName?: string | null;
  postalCode: string;
  country: string;
}

export interface CompanyFieldMoneyValue {
  currency: string;
  amount: number;
}

export type CompanyFieldParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;
const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

function parseJson(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function validDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** A year end encoded as `MM-DD`. */
export function parseYearEnd(value: string): CompanyFieldParseResult<{ day: number; month: number }> {
  const match = /^(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return { ok: false, error: 'Choose the day and month.' };
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (month < 1 || month > 12) return { ok: false, error: 'Choose a month.' };
  if (day < 1 || day > MONTH_DAYS[month - 1]) return { ok: false, error: `${MONTHS[month - 1]} has no day ${day}.` };
  return { ok: true, value: { day, month } };
}

export function encodeYearEnd(day: number, month: number): string {
  return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The financial year end (day and month) a first FYE date falls on: 2026-12-31 -> 31 December. */
export function yearEndOfDate(value: string): { day: number; month: number } | null {
  const match = /^\d{4}-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return null;
  const parsed = parseYearEnd(`${match[1]}-${match[2]}`);
  return parsed.ok ? parsed.value : null;
}

export function parseAddressValue(value: string): CompanyFieldParseResult<CompanyFieldAddressValue> {
  const record = parseJson(value);
  if (!record) return { ok: false, error: 'Enter the address.' };
  const address: CompanyFieldAddressValue = {
    block: text(record.block) || null,
    streetName: text(record.streetName),
    level: text(record.level) || null,
    unit: text(record.unit) || null,
    buildingName: text(record.buildingName) || null,
    postalCode: text(record.postalCode),
    country: text(record.country) || 'Singapore',
  };
  if (!address.streetName) return { ok: false, error: 'Enter the street name.' };
  if (!address.postalCode) return { ok: false, error: 'Enter the postal code.' };
  return { ok: true, value: address };
}

export function parseMoneyValue(value: string): CompanyFieldParseResult<CompanyFieldMoneyValue> {
  const record = parseJson(value);
  const amount = record ? Number(record.amount) : Number.NaN;
  if (!record || record.amount === '' || record.amount === null || !Number.isFinite(amount) || amount < 0) {
    return { ok: false, error: 'Enter an amount of zero or more.' };
  }
  const currency = text(record.currency).toUpperCase() || 'SGD';
  if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, error: 'Enter a three-letter currency code.' };
  return { ok: true, value: { currency, amount } };
}

/**
 * Check and normalise a value for a home. The normalised string is what is
 * stored per document and sent when saving to the company.
 */
export function normalizeCompanyFieldValue(
  id: CompanyFieldHomeId,
  raw: string,
): CompanyFieldParseResult<string> {
  const home = companyFieldHome(id);
  const value = raw.trim();
  switch (home.input) {
    case 'date':
      return validDate(value) ? { ok: true, value } : { ok: false, error: 'Enter a valid date.' };
    case 'text':
      if (!value) return { ok: false, error: `Enter the ${home.label}.` };
      if (value.length > 200) return { ok: false, error: 'Keep it under 200 characters.' };
      return { ok: true, value };
    case 'yearEnd': {
      const parsed = parseYearEnd(value);
      return parsed.ok ? { ok: true, value: encodeYearEnd(parsed.value.day, parsed.value.month) } : parsed;
    }
    case 'address': {
      const parsed = parseAddressValue(value);
      return parsed.ok ? { ok: true, value: JSON.stringify(parsed.value) } : parsed;
    }
    case 'money': {
      const parsed = parseMoneyValue(value);
      return parsed.ok ? { ok: true, value: JSON.stringify(parsed.value) } : parsed;
    }
  }
}

function formatMoney({ currency, amount }: CompanyFieldMoneyValue): string {
  return `${currency} ${amount.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function addressLine(address: CompanyFieldAddressValue): string {
  return buildFullAddress({
    block: address.block ?? undefined,
    streetName: address.streetName,
    level: address.level ?? undefined,
    unit: address.unit ?? undefined,
    buildingName: address.buildingName ?? undefined,
    postalCode: address.postalCode,
  });
}

/** How a value reads to the user, e.g. "31 Dec 2026" or "31 December". */
export function formatCompanyFieldValue(id: CompanyFieldHomeId, value: string): string {
  const home = companyFieldHome(id);
  switch (home.input) {
    case 'date': return formatOakDocDate(value) ?? value;
    case 'text': return value;
    case 'yearEnd': {
      const parsed = parseYearEnd(value);
      return parsed.ok ? `${parsed.value.day} ${MONTHS[parsed.value.month - 1]}` : value;
    }
    case 'address': {
      const parsed = parseAddressValue(value);
      return parsed.ok ? addressLine(parsed.value) : value;
    }
    case 'money': {
      const parsed = parseMoneyValue(value);
      return parsed.ok ? formatMoney(parsed.value) : value;
    }
  }
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/** `company.*` tags a template prints, plus the probe tag of each home they belong to. */
export function companyFieldTagsToResolve(tags: readonly string[] | undefined): string[] {
  const resolved = new Set<string>();
  for (const tag of tags ?? []) {
    if (oakDocFieldContext(tag) !== 'company') continue;
    resolved.add(tag);
    const home = companyFieldHomeForTag(tag);
    if (home) resolved.add(home.probeTag);
  }
  return Array.from(resolved).sort();
}

export interface MissingCompanyField {
  home: CompanyFieldHome;
  /** Tags in this template that print from it. */
  tags: string[];
  /** The value set for this document only, if any. */
  documentValue: string | null;
}

export interface MissingCompanyFields {
  /** Missing values with a home they can be saved to. */
  fillable: MissingCompanyField[];
}

function blank(value: string | undefined): boolean {
  return !value || value.trim().length === 0;
}

/**
 * Company values the template prints that resolve blank for the company.
 * Only values with an editable home are listed; worked-out values such as the
 * secondary activity are often legitimately blank, so they are not flagged.
 * `values` are the resolved values by tag (see `companyFieldTagsToResolve`).
 * A home with a value for this document only stays listed so it can be
 * changed or saved, with `documentValue` set.
 */
export function detectMissingCompanyFields(params: {
  tags: readonly string[] | undefined;
  values: Readonly<Record<string, string>>;
  documentValues?: Readonly<Record<string, string>> | null;
}): MissingCompanyFields {
  const fillable = new Map<CompanyFieldHomeId, MissingCompanyField>();
  const seen = new Set<string>();
  for (const tag of params.tags ?? []) {
    if (seen.has(tag) || oakDocFieldContext(tag) !== 'company') continue;
    seen.add(tag);
    const home = companyFieldHomeForTag(tag);
    if (!home || !blank(params.values[home.probeTag])) continue;
    const entry = fillable.get(home.id);
    if (entry) entry.tags.push(tag);
    else fillable.set(home.id, { home, tags: [tag], documentValue: params.documentValues?.[home.id] ?? null });
  }
  // With both missing, only the first FYE is asked: the year end is its day and month.
  const firstFye = fillable.get('firstFinancialYearEnd');
  const yearEnd = fillable.get('financialYearEnd');
  if (firstFye && yearEnd && !yearEnd.documentValue) {
    firstFye.tags.push(...yearEnd.tags);
    fillable.delete('financialYearEnd');
  }
  const order = new Map(COMPANY_FIELD_HOMES.map((home, index) => [home.id, index]));
  return {
    fillable: Array.from(fillable.values()).sort((a, b) => order.get(a.home.id)! - order.get(b.home.id)!),
  };
}

// ---------------------------------------------------------------------------
// Values for one document
// ---------------------------------------------------------------------------

/**
 * Apply the values set for one document to the company details a document
 * is generated from. Derived fields (the letter address, the first FYE from
 * the incorporation date and year end) then follow from them. A value only
 * fills a blank: once the company has its own value (recorded later, or a
 * different company chosen), the company's value prints. Invalid or unknown
 * entries are ignored.
 */
export function applyCompanyFieldValues(
  company: OakDocCompanyDetail,
  values: Readonly<Record<string, string>> | null | undefined,
): OakDocCompanyDetail {
  if (!values || Object.keys(values).length === 0) return company;
  const onRecord = buildOakDocResolutionValues({
    company,
    fieldTags: COMPANY_FIELD_HOMES.map((home) => home.probeTag),
  });
  let next = company;
  for (const [id, raw] of Object.entries(values)) {
    if (!isCompanyFieldHomeId(id)) continue;
    if (!blank(onRecord[companyFieldHome(id).probeTag])) continue;
    const normalized = normalizeCompanyFieldValue(id, raw);
    if (!normalized.ok) continue;
    const value = normalized.value;
    switch (id) {
      case 'uen':
        next = { ...next, uen: value };
        break;
      case 'incorporationDate':
        next = { ...next, incorporationDate: value };
        break;
      case 'financialYearEnd': {
        const parsed = parseYearEnd(value);
        if (parsed.ok) {
          next = { ...next, financialYearEndDay: parsed.value.day, financialYearEndMonth: parsed.value.month };
        }
        break;
      }
      case 'firstFinancialYearEnd': {
        next = { ...next, financialPeriods: [{ periodEnd: value }] };
        // A company with no year end on record takes it from the first FYE.
        const yearEnd = yearEndOfDate(value);
        if (yearEnd && (next.financialYearEndDay == null || next.financialYearEndMonth == null)) {
          next = { ...next, financialYearEndDay: yearEnd.day, financialYearEndMonth: yearEnd.month };
        }
        break;
      }
      case 'registeredAddress': {
        const parsed = parseAddressValue(value);
        if (!parsed.ok) break;
        const address = parsed.value;
        const fullAddress = addressLine(address);
        const registered: OakDocCompanyAddress = {
          addressType: 'REGISTERED_OFFICE',
          fullAddress,
          block: address.block,
          streetName: address.streetName,
          level: address.level,
          unit: address.unit,
          buildingName: address.buildingName,
          postalCode: address.postalCode,
          country: address.country,
          isCurrent: true,
        };
        next = {
          ...next,
          registeredAddress: fullAddress,
          addresses: [
            registered,
            ...(next.addresses ?? []).filter((entry) => entry.addressType !== 'REGISTERED_OFFICE'),
          ],
        };
        break;
      }
      case 'paidUpCapital': {
        const parsed = parseMoneyValue(value);
        if (parsed.ok) {
          next = { ...next, paidUpCapitalAmount: parsed.value.amount, paidUpCapitalCurrency: parsed.value.currency };
        }
        break;
      }
    }
  }
  return next;
}
