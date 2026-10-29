import { formatOakDocDate, oakDocIsoDate } from '@/lib/document-editor/oakdoc-context';
import type { PlaceholderValueType } from '@/types/placeholders';
import {
  OAKDOC_CONTACTS_REPEATER_TAG,
  OAKDOC_REPEATER_NAME_MAX,
  canOakDocRepeaterSplitDocuments,
  isOakDocContactsRepeaterTag,
  isOakDocRepeaterTag,
  oakDocContactListNameFromSlug,
  parseOakDocContactListSlug,
} from '@/lib/document-editor/oakdoc-repeater-definitions';

/**
 * Custom fields on Word (OakDoc) templates and partials.
 *
 * A custom field is defined on the template or partial (label, type,
 * required, dropdown choices) and stored in its `placeholders` as a
 * `custom.<key>` definition, the same shape Configure already prompts for.
 * The document carries a `custom.<key>` content control; generation fills
 * it with the value entered on Configure (or Shared setup when several
 * documents in a batch use the same field).
 */

export const OAKDOC_CUSTOM_FIELD_PREFIX = 'custom.';

const CUSTOM_KEY = /^[A-Za-z][A-Za-z0-9_]*$/;

/** Details a Contact custom field can print, as `custom.<key>.<path>`. */
export const OAKDOC_CUSTOM_CONTACT_SUBFIELDS: ReadonlyArray<{ path: string; label: string }> = [
  { path: 'name', label: 'Name' },
  { path: 'identificationNumber', label: 'ID number' },
  { path: 'nationality', label: 'Nationality' },
  { path: 'address.full', label: 'Full address' },
  { path: 'address.letter', label: 'Letter address' },
  { path: 'email', label: 'Email' },
  { path: 'phone', label: 'Phone' },
];

const CONTACT_SUBFIELD_PATHS = new Set(OAKDOC_CUSTOM_CONTACT_SUBFIELDS.map((field) => field.path));

/** The field key and, for a Contact field detail, its path: `custom.sec.name` -> sec, name. */
export function parseOakDocCustomFieldTag(tag: string): { key: string; path: string | null } | null {
  if (!tag.startsWith(OAKDOC_CUSTOM_FIELD_PREFIX)) return null;
  const rest = tag.slice(OAKDOC_CUSTOM_FIELD_PREFIX.length);
  const dot = rest.indexOf('.');
  const key = dot < 0 ? rest : rest.slice(0, dot);
  const path = dot < 0 ? null : rest.slice(dot + 1);
  if (!CUSTOM_KEY.test(key) || (path !== null && !CONTACT_SUBFIELD_PATHS.has(path))) return null;
  return { key, path };
}

export function isOakDocCustomFieldTag(tag: string): boolean {
  return parseOakDocCustomFieldTag(tag) !== null;
}

export function oakDocCustomFieldTag(key: string): string {
  return `${OAKDOC_CUSTOM_FIELD_PREFIX}${key}`;
}

/**
 * Types offered when defining a custom field. A dropdown is stored as text
 * with choices; a contact as text holding the chosen contact's id, with the
 * shortlist of contacts as its choices.
 */
export type OakDocCustomFieldType =
  | 'text'
  | 'textarea'
  | 'date'
  | 'number'
  | 'currency'
  | 'dropdown'
  | 'contact';

export const OAKDOC_CUSTOM_FIELD_TYPES: ReadonlyArray<{ value: OakDocCustomFieldType; label: string }> = [
  { value: 'text', label: 'Text' },
  { value: 'textarea', label: 'Multi-line text' },
  { value: 'date', label: 'Date' },
  { value: 'number', label: 'Number' },
  { value: 'currency', label: 'Amount' },
  { value: 'dropdown', label: 'Dropdown' },
  { value: 'contact', label: 'Contact' },
];

export interface OakDocCustomFieldContact {
  id: string;
  name: string;
}

export interface OakDocCustomField {
  key: string;
  label: string;
  type: OakDocCustomFieldType;
  required: boolean;
  /** Dropdown choices, in display order. */
  options?: string[];
  /** Contact shortlist offered on Configure, in display order. */
  contacts?: OakDocCustomFieldContact[];
}

/** Marks a definition copied from an inserted partial; recomputed on every template save. */
export const OAKDOC_PARTIAL_FIELD_MARKER = 'oakDocPartialId';

type StoredDefinition = Record<string, unknown>;

function isRecord(value: unknown): value is StoredDefinition {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function storedKey(definition: StoredDefinition): string | null {
  const key = typeof definition.key === 'string' ? definition.key.trim() : '';
  const bare = key.startsWith(OAKDOC_CUSTOM_FIELD_PREFIX)
    ? key.slice(OAKDOC_CUSTOM_FIELD_PREFIX.length)
    : definition.source === 'custom' || definition.category === 'custom'
      ? key
      : '';
  return CUSTOM_KEY.test(bare) ? bare : null;
}

/** Stored choices with their display labels; a plain string is its own label. */
export function readPlaceholderChoices(options: unknown): Array<{ value: string; label: string }> {
  if (!Array.isArray(options)) return [];
  const seen = new Set<string>();
  const result: Array<{ value: string; label: string }> = [];
  for (const option of options) {
    const value = typeof option === 'string'
      ? option.trim()
      : isRecord(option) && typeof option.value === 'string'
        ? option.value.trim()
        : '';
    if (!value || seen.has(value)) continue;
    seen.add(value);
    const label = isRecord(option) && typeof option.label === 'string' && option.label.trim()
      ? option.label.trim()
      : value;
    result.push({ value, label });
  }
  return result;
}

/** Dropdown choices stored on a definition, trimmed and without duplicates. */
export function readPlaceholderOptions(options: unknown): string[] {
  if (!Array.isArray(options)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const option of options) {
    const text = typeof option === 'string'
      ? option.trim()
      : isRecord(option) && typeof option.value === 'string'
        ? option.value.trim()
        : '';
    if (text && !seen.has(text)) {
      seen.add(text);
      result.push(text);
    }
  }
  return result;
}

const CONTACT_FIELD_KIND = 'contact';

function fieldType(definition: StoredDefinition): OakDocCustomFieldType {
  if (definition.fieldKind === CONTACT_FIELD_KIND) return 'contact';
  const options = readPlaceholderOptions(definition.options);
  const type = definition.type;
  if (options.length > 0 && (type === 'text' || type === 'dropdown' || type === 'select')) return 'dropdown';
  if (type === 'textarea' || type === 'date' || type === 'number' || type === 'currency') return type;
  return 'text';
}

function isPartialCopy(definition: StoredDefinition): boolean {
  return typeof definition[OAKDOC_PARTIAL_FIELD_MARKER] === 'string';
}

/** Custom fields a template or partial defines itself (not copies from its partials). */
export function readOakDocCustomFields(placeholders: unknown): OakDocCustomField[] {
  if (!Array.isArray(placeholders)) return [];
  const seen = new Set<string>();
  const fields: OakDocCustomField[] = [];
  for (const definition of placeholders) {
    if (!isRecord(definition) || isPartialCopy(definition)) continue;
    const key = storedKey(definition);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const type = fieldType(definition);
    fields.push({
      key,
      label: typeof definition.label === 'string' && definition.label.trim() ? definition.label.trim() : key,
      type,
      required: definition.required === true,
      ...(type === 'dropdown' ? { options: readPlaceholderOptions(definition.options) } : {}),
      ...(type === 'contact'
        ? {
            contacts: readPlaceholderChoices(definition.options)
              .map((choice) => ({ id: choice.value, name: choice.label })),
          }
        : {}),
    });
  }
  return fields;
}

/** Custom fields copied onto a template from the partials it inserts. */
export function readOakDocPartialCustomFields(placeholders: unknown): Array<OakDocCustomField & { partialId: string }> {
  if (!Array.isArray(placeholders)) return [];
  return placeholders.flatMap((definition) => {
    if (!isRecord(definition) || !isPartialCopy(definition)) return [];
    const [field] = readOakDocCustomFields([{ ...definition, [OAKDOC_PARTIAL_FIELD_MARKER]: undefined }]);
    return field ? [{ ...field, partialId: String(definition[OAKDOC_PARTIAL_FIELD_MARKER]) }] : [];
  });
}

function storedType(type: OakDocCustomFieldType): PlaceholderValueType {
  return type === 'dropdown' || type === 'contact' ? 'text' : type;
}

function toStoredDefinition(
  field: OakDocCustomField,
  previous: StoredDefinition | undefined,
): StoredDefinition {
  const tag = oakDocCustomFieldTag(field.key);
  const next: StoredDefinition = {
    ...(previous ?? {}),
    key: tag,
    path: tag,
    label: field.label.trim() || field.key,
    type: storedType(field.type),
    source: 'custom',
    category: 'custom',
    required: field.required,
  };
  const options = field.type === 'dropdown'
    ? readPlaceholderOptions(field.options)
    : field.type === 'contact'
      ? (field.contacts ?? []).map((contact) => ({ value: contact.id, label: contact.name }))
      : [];
  if (options.length > 0) next.options = options;
  else delete next.options;
  if (field.type === 'contact') next.fieldKind = CONTACT_FIELD_KIND;
  else delete next.fieldKind;
  return next;
}

/**
 * Replace the own custom fields in a stored placeholder list. Other stored
 * definitions (and copies from partials) are kept as they are, and an
 * edited field keeps its stored identity and any extra metadata.
 */
export function writeOakDocCustomFields(
  placeholders: unknown,
  fields: readonly OakDocCustomField[],
): StoredDefinition[] {
  const existing = Array.isArray(placeholders) ? placeholders.filter(isRecord) : [];
  const ownByKey = new Map<string, StoredDefinition>();
  const kept: StoredDefinition[] = [];
  for (const definition of existing) {
    const key = storedKey(definition);
    if (key && !isPartialCopy(definition)) {
      if (!ownByKey.has(key)) ownByKey.set(key, definition);
    } else {
      kept.push(definition);
    }
  }
  return [
    ...fields.map((field) => toStoredDefinition(field, ownByKey.get(field.key))),
    ...kept,
  ];
}

/*
 * Contact shortlist of the Word contacts repeater (`repeat.contacts`).
 *
 * A template or partial can limit the contacts Configure offers for its
 * contacts repeater. The shortlist is stored in its placeholders as one
 * definition keyed `repeat.contacts` (not a custom field, so Configure does
 * not prompt for it as a value), with the contacts as { value: id, label:
 * name } options. A template carries copies of its partials' shortlists,
 * marked like copied custom fields, and Configure offers all of them
 * together; with no shortlist anywhere any workspace contact can be picked.
 */
export const OAKDOC_CONTACT_SHORTLIST_KEY = 'repeat.contacts';
const CONTACT_SHORTLIST_KIND = 'contactShortlist';

function isContactShortlist(definition: StoredDefinition): boolean {
  return definition.fieldKind === CONTACT_SHORTLIST_KIND && definition.key === OAKDOC_CONTACT_SHORTLIST_KEY;
}

function shortlistContacts(definitions: readonly StoredDefinition[]): OakDocCustomFieldContact[] {
  const seen = new Set<string>();
  const contacts: OakDocCustomFieldContact[] = [];
  for (const definition of definitions) {
    for (const choice of readPlaceholderChoices(definition.options)) {
      if (seen.has(choice.value)) continue;
      seen.add(choice.value);
      contacts.push({ id: choice.value, name: choice.label });
    }
  }
  return contacts;
}

function shortlistDefinition(contacts: readonly OakDocCustomFieldContact[]): StoredDefinition {
  return {
    key: OAKDOC_CONTACT_SHORTLIST_KEY,
    path: OAKDOC_CONTACT_SHORTLIST_KEY,
    label: 'Contacts shortlist',
    type: 'text',
    source: 'repeater',
    category: 'repeater',
    fieldKind: CONTACT_SHORTLIST_KIND,
    required: false,
    options: contacts.map((contact) => ({ value: contact.id, label: contact.name })),
  };
}

/** The contacts shortlist a template or partial sets itself (not copies from its partials). */
export function readOakDocContactShortlist(placeholders: unknown): OakDocCustomFieldContact[] {
  if (!Array.isArray(placeholders)) return [];
  return shortlistContacts(placeholders.filter(
    (definition): definition is StoredDefinition => isRecord(definition)
      && isContactShortlist(definition)
      && !isPartialCopy(definition),
  ));
}

/** Replace the own contacts shortlist in a stored placeholder list; none removes it. */
export function writeOakDocContactShortlist(
  placeholders: unknown,
  contacts: readonly OakDocCustomFieldContact[],
): StoredDefinition[] {
  const existing = Array.isArray(placeholders) ? placeholders.filter(isRecord) : [];
  const kept = existing.filter((definition) => !isContactShortlist(definition) || isPartialCopy(definition));
  const own = shortlistContacts([shortlistDefinition(contacts)]);
  return own.length > 0 ? [...kept, shortlistDefinition(own)] : kept;
}

/**
 * The contacts Configure offers for the contacts repeater: the template's
 * shortlist and those copied from its partials, together. Null when none
 * is set, meaning any workspace contact.
 */
export function oakDocContactShortlist(placeholders: unknown): OakDocCustomFieldContact[] | null {
  if (!Array.isArray(placeholders)) return null;
  const definitions = placeholders.filter(
    (definition): definition is StoredDefinition => isRecord(definition) && isContactShortlist(definition),
  );
  const contacts = shortlistContacts(definitions);
  return contacts.length > 0 ? contacts : null;
}

/*
 * Names of repeating sections, and named contacts lists.
 *
 * The author can name any repeating section ("Signers for the
 * resolution(s)"); Configure and Shared setup then title its picker with the
 * name. The name is a label only: it is stored as a placeholders definition
 * keyed by the repeater tag (`repeat.directors`, `repeat.officers.secretary`)
 * with `fieldKind: "repeaterName"` and the name as its label, one per tag.
 *
 * A named Contacts section is its own list: its tag is
 * `repeat.contacts.<slug>` and its definition is a contacts shortlist keyed by
 * that tag, labelled with the name. Configure keeps a separate selection for it
 * (`selectedContactListIds[slug]`). Plain `repeat.contacts` is the unnamed list.
 *
 * A single-person picker (the selected director, shareholder or contact) can
 * be named the same way, keyed by its field root (`selectedDirector`), so
 * Configure titles it "Signer of the resolution(s)" instead of "Director".
 *
 * Like custom fields, partials' definitions are copied onto the template on
 * save (marked with the partial id), and added per document for a
 * resolution's chosen partials.
 *
 * One section of a template (directors, shareholders, officers or a contacts
 * list) can make a separate document for each person: Configure then makes
 * one document per person picked, and the section prints only that person.
 * It is stored as a definition keyed by the section's tag with
 * `fieldKind: "documentPerPerson"`, one per template, and is never copied
 * from partials.
 */
const REPEATER_NAME_KIND = 'repeaterName';
const DOCUMENT_PER_PERSON_KIND = 'documentPerPerson';

/*
 * Per-person fields. A repeating section of people (directors,
 * shareholders, officers or a contacts list) can ask Configure for a value
 * for each person ticked: the shares each transferor transfers, each
 * applicant's subscription, each certificate's number. The section's text
 * holds an `item.<key>` field, which prints that person's value in their
 * copy. A number or amount field can be checked against a custom field
 * (`totalOf`, the custom field's key): the values of the people ticked must
 * add up to it, and a single person's value defaults to it.
 *
 * Each is stored as a placeholders definition keyed `item.<key>` with
 * `fieldKind: "personField"` and the section's tag as `repeaterTag`, so
 * the same key can be asked separately in two sections (transferors and
 * transferees). Partials' definitions are copied like section names.
 */
const PERSON_FIELD_KIND = 'personField';
export const OAKDOC_PERSON_FIELD_PREFIX = 'item.';

export type OakDocPersonFieldType = 'text' | 'number' | 'currency' | 'date';

export const OAKDOC_PERSON_FIELD_TYPES: ReadonlyArray<{ value: OakDocPersonFieldType; label: string }> = [
  { value: 'number', label: 'Number' },
  { value: 'currency', label: 'Amount' },
  { value: 'text', label: 'Text' },
  { value: 'date', label: 'Date' },
];

export interface OakDocPersonField {
  key: string;
  label: string;
  type: OakDocPersonFieldType;
  required: boolean;
  /** Custom field key the values of the people ticked must add up to (number and amount only). */
  totalOf?: string | null;
}

export function oakDocPersonFieldTag(key: string): string {
  return `${OAKDOC_PERSON_FIELD_PREFIX}${key}`;
}

/** The key of an `item.<key>` field; null for any other tag. */
export function parseOakDocPersonFieldTag(tag: string): string | null {
  if (!tag.startsWith(OAKDOC_PERSON_FIELD_PREFIX)) return null;
  const key = tag.slice(OAKDOC_PERSON_FIELD_PREFIX.length);
  return CUSTOM_KEY.test(key) ? key : null;
}

export function isOakDocPersonFieldTag(tag: string): boolean {
  return parseOakDocPersonFieldTag(tag) !== null;
}

function isPersonFieldEntry(definition: StoredDefinition): boolean {
  return definition.fieldKind === PERSON_FIELD_KIND
    && typeof definition.key === 'string'
    && isOakDocPersonFieldTag(definition.key)
    && typeof definition.repeaterTag === 'string'
    && canOakDocRepeaterSplitDocuments(definition.repeaterTag);
}

function personFieldType(value: unknown): OakDocPersonFieldType {
  return value === 'number' || value === 'currency' || value === 'date' ? value : 'text';
}

function readPersonField(definition: StoredDefinition): OakDocPersonField {
  const key = parseOakDocPersonFieldTag(String(definition.key))!;
  const type = personFieldType(definition.type);
  const totalOf = typeof definition.totalOf === 'string' && CUSTOM_KEY.test(definition.totalOf)
    && (type === 'number' || type === 'currency')
    ? definition.totalOf
    : null;
  return {
    key,
    label: typeof definition.label === 'string' && definition.label.trim() ? definition.label.trim() : key,
    type,
    required: definition.required === true,
    ...(totalOf ? { totalOf } : {}),
  };
}

function personFieldEntry(tag: string, field: OakDocPersonField): StoredDefinition | null {
  if (!CUSTOM_KEY.test(field.key) || !canOakDocRepeaterSplitDocuments(tag)) return null;
  const fieldTag = oakDocPersonFieldTag(field.key);
  const totalOf = field.totalOf && CUSTOM_KEY.test(field.totalOf) && (field.type === 'number' || field.type === 'currency')
    ? field.totalOf
    : null;
  return {
    key: fieldTag,
    path: fieldTag,
    label: field.label.trim() || field.key,
    type: field.type,
    source: 'repeater',
    category: 'repeater',
    fieldKind: PERSON_FIELD_KIND,
    repeaterTag: tag,
    required: field.required,
    ...(totalOf ? { totalOf } : {}),
  };
}

function addPersonField(
  fields: Record<string, OakDocPersonField[]>,
  tag: string,
  field: OakDocPersonField,
): void {
  const list = fields[tag] ?? [];
  if (list.some((existing) => existing.key === field.key)) return;
  fields[tag] = [...list, field];
}

/** Field roots of the single-person pickers Configure shows, which an author can name. */
export const OAKDOC_PICKER_KEYS = ['selectedDirector', 'selectedShareholder', 'selectedContact'] as const;
export type OakDocPickerKey = typeof OAKDOC_PICKER_KEYS[number];

export function isOakDocPickerKey(key: string): key is OakDocPickerKey {
  return (OAKDOC_PICKER_KEYS as readonly string[]).includes(key);
}

/** The picker a field belongs to: `selectedDirector.name` is the selected director's. */
export function oakDocPickerKeyOfTag(tag: string): OakDocPickerKey | null {
  return OAKDOC_PICKER_KEYS.find((key) => tag.startsWith(`${key}.`)) ?? null;
}

/** Pickers whose fields are in a document, for keeping their names on save. */
export function oakDocPickerKeysInUse(fieldTags: readonly string[]): OakDocPickerKey[] {
  return OAKDOC_PICKER_KEYS.filter((key) => fieldTags.some((tag) => oakDocPickerKeyOfTag(tag) === key));
}

/** A template's or partial's own section names and contacts shortlists, by repeater tag. */
export interface OakDocRepeaterSections {
  /**
   * Section name by repeater tag, or picker name by picker key
   * (`selectedDirector`); a named contacts list always has one.
   */
  names: Record<string, string>;
  /** Contacts shortlist by contacts repeater tag (`repeat.contacts`, `repeat.contacts.<slug>`). */
  shortlists: Record<string, OakDocCustomFieldContact[]>;
  /** The section that makes a separate document for each person, if any (templates only). */
  perPersonTag?: string | null;
  /** Per-person fields by repeater tag, in the order they were defined. */
  personFields?: Record<string, OakDocPersonField[]>;
}

/** Section names and shortlists of a template together with its partials'. */
export interface OakDocRepeaterSectionSummary {
  /** Every distinct name given to sections with this tag, template's first. */
  names: Record<string, string[]>;
  shortlists: Record<string, OakDocCustomFieldContact[]>;
  /** The template's section that makes a separate document for each person, if any. */
  perPersonTag?: string | null;
  /** Per-person fields by repeater tag: the template's, then its partials' (first of a key wins). */
  personFields?: Record<string, OakDocPersonField[]>;
}

function isPerPersonEntry(definition: StoredDefinition): boolean {
  return definition.fieldKind === DOCUMENT_PER_PERSON_KIND
    && typeof definition.key === 'string'
    && canOakDocRepeaterSplitDocuments(definition.key);
}

function isRepeaterEntry(definition: StoredDefinition): boolean {
  const key = typeof definition.key === 'string' ? definition.key : '';
  if (isPerPersonEntry(definition) || isPersonFieldEntry(definition)) return true;
  if (definition.fieldKind === CONTACT_SHORTLIST_KIND) return isOakDocContactsRepeaterTag(key);
  if (definition.fieldKind !== REPEATER_NAME_KIND) return false;
  return isOakDocPickerKey(key) || (isOakDocRepeaterTag(key) && !isOakDocContactsRepeaterTag(key));
}

/** A section name as stored: single-spaced, trimmed, at most OAKDOC_REPEATER_NAME_MAX characters. */
export function normalizeOakDocRepeaterName(name: string | null | undefined): string {
  return (name ?? '').replace(/\s+/g, ' ').trim().slice(0, OAKDOC_REPEATER_NAME_MAX).trim();
}

function entryName(definition: StoredDefinition): string | null {
  const label = normalizeOakDocRepeaterName(typeof definition.label === 'string' ? definition.label : '');
  if (definition.fieldKind === REPEATER_NAME_KIND) return label || null;
  const slug = parseOakDocContactListSlug(String(definition.key));
  return slug ? label || oakDocContactListNameFromSlug(slug) : null;
}

function repeaterEntry(
  tag: string,
  name: string,
  listed: readonly OakDocCustomFieldContact[],
): StoredDefinition | null {
  const contacts = shortlistContacts([shortlistDefinition(listed)]);
  if (tag === OAKDOC_CONTACTS_REPEATER_TAG) return contacts.length > 0 ? shortlistDefinition(contacts) : null;
  const slug = parseOakDocContactListSlug(tag);
  if (slug) {
    return {
      ...shortlistDefinition(contacts),
      key: tag,
      path: tag,
      label: normalizeOakDocRepeaterName(name) || oakDocContactListNameFromSlug(slug),
    };
  }
  const label = normalizeOakDocRepeaterName(name);
  if (!label || !(isOakDocRepeaterTag(tag) || isOakDocPickerKey(tag))) return null;
  return {
    key: tag,
    path: tag,
    label,
    type: 'text',
    source: 'repeater',
    category: 'repeater',
    fieldKind: REPEATER_NAME_KIND,
    required: false,
  };
}

function perPersonEntry(tag: string): StoredDefinition {
  return {
    key: tag,
    path: tag,
    label: 'One document per person',
    type: 'text',
    source: 'repeater',
    category: 'repeater',
    fieldKind: DOCUMENT_PER_PERSON_KIND,
    required: false,
  };
}

function repeaterEntries(placeholders: unknown, ownOnly: boolean): StoredDefinition[] {
  if (!Array.isArray(placeholders)) return [];
  return placeholders.filter((definition): definition is StoredDefinition => isRecord(definition)
    && isRepeaterEntry(definition)
    && (!ownOnly || !isPartialCopy(definition)));
}

function addEntry(summary: OakDocRepeaterSectionSummary, definition: StoredDefinition): void {
  if (isPersonFieldEntry(definition)) {
    summary.personFields = summary.personFields ?? {};
    addPersonField(summary.personFields, String(definition.repeaterTag), readPersonField(definition));
    return;
  }
  const tag = String(definition.key);
  if (isPerPersonEntry(definition)) {
    // Only the template's own setting splits its documents.
    if (!isPartialCopy(definition) && !summary.perPersonTag) summary.perPersonTag = tag;
    return;
  }
  const name = entryName(definition);
  if (name && !(summary.names[tag] ?? []).includes(name)) summary.names[tag] = [...(summary.names[tag] ?? []), name];
  if (definition.fieldKind === CONTACT_SHORTLIST_KIND) {
    summary.shortlists[tag] = shortlistContacts([shortlistDefinition(summary.shortlists[tag] ?? []), definition]);
  }
}

/** The section names and contacts shortlists a template or partial sets itself. */
export function readOakDocRepeaterSections(placeholders: unknown): OakDocRepeaterSections {
  const summary: OakDocRepeaterSectionSummary = { names: {}, shortlists: {} };
  for (const definition of repeaterEntries(placeholders, true)) addEntry(summary, definition);
  const names: Record<string, string> = {};
  for (const [tag, list] of Object.entries(summary.names)) names[tag] = list[0];
  return {
    names,
    shortlists: summary.shortlists,
    ...(summary.perPersonTag ? { perPersonTag: summary.perPersonTag } : {}),
    ...(summary.personFields ? { personFields: summary.personFields } : {}),
  };
}

/**
 * Replace a template's or partial's own section names and shortlists with
 * these, keeping only sections (and pickers) still in the document
 * (`presentTags`: repeater tags and picker keys). A named contacts list is
 * kept with no shortlist too, for its name.
 */
export function writeOakDocRepeaterSections(
  placeholders: unknown,
  sections: OakDocRepeaterSections,
  presentTags: readonly string[],
): StoredDefinition[] {
  const existing = Array.isArray(placeholders) ? placeholders.filter(isRecord) : [];
  const kept = existing.filter((definition) => !isRepeaterEntry(definition) || isPartialCopy(definition));
  const present = Array.from(new Set(presentTags));
  const written = present.flatMap((tag) => {
    const entry = repeaterEntry(tag, sections.names[tag] ?? '', sections.shortlists[tag] ?? []);
    return entry ? [entry] : [];
  });
  const perPerson = sections.perPersonTag
    && present.includes(sections.perPersonTag)
    && canOakDocRepeaterSplitDocuments(sections.perPersonTag)
    ? [perPersonEntry(sections.perPersonTag)]
    : [];
  const personFields = present.flatMap((tag) => (sections.personFields?.[tag] ?? []).flatMap((field) => {
    const entry = personFieldEntry(tag, field);
    return entry ? [entry] : [];
  }));
  return [...kept, ...written, ...perPerson, ...personFields];
}

/**
 * Section names and shortlists of a template together with the copies of
 * its partials': every distinct name per tag, shortlists merged per tag.
 */
export function oakDocRepeaterSectionSummary(placeholders: unknown): OakDocRepeaterSectionSummary {
  const summary: OakDocRepeaterSectionSummary = { names: {}, shortlists: {} };
  const entries = repeaterEntries(placeholders, false);
  for (const definition of entries.filter((entry) => !isPartialCopy(entry))) addEntry(summary, definition);
  for (const definition of entries.filter(isPartialCopy)) addEntry(summary, definition);
  return summary;
}

/** Two summaries together: a template's, then its chosen partials'. */
export function mergeOakDocRepeaterSectionSummaries(
  first: OakDocRepeaterSectionSummary | null | undefined,
  second: OakDocRepeaterSectionSummary | null | undefined,
): OakDocRepeaterSectionSummary {
  const merged: OakDocRepeaterSectionSummary = {
    names: { ...(first?.names ?? {}) },
    shortlists: { ...(first?.shortlists ?? {}) },
    ...(first?.perPersonTag ? { perPersonTag: first.perPersonTag } : {}),
  };
  for (const [tag, names] of Object.entries(second?.names ?? {})) {
    merged.names[tag] = Array.from(new Set([...(merged.names[tag] ?? []), ...names]));
  }
  for (const [tag, contacts] of Object.entries(second?.shortlists ?? {})) {
    const current = merged.shortlists[tag] ?? [];
    const seen = new Set(current.map((contact) => contact.id));
    merged.shortlists[tag] = [...current, ...contacts.filter((contact) => !seen.has(contact.id))];
  }
  for (const summary of [first, second]) {
    for (const [tag, fields] of Object.entries(summary?.personFields ?? {})) {
      merged.personFields = merged.personFields ?? {};
      for (const field of fields) addPersonField(merged.personFields, tag, field);
    }
  }
  return merged;
}

/** A partial's section names and shortlists (its own and its partials'), marked as copies from it. */
function partialRepeaterCopies(partial: { id: string; placeholders: unknown }): StoredDefinition[] {
  return repeaterEntries(partial.placeholders, false)
    .filter((definition) => !isPerPersonEntry(definition))
    .map((definition) => ({ ...definition, [OAKDOC_PARTIAL_FIELD_MARKER]: partial.id }));
}

function partialFieldCopies(
  partials: ReadonlyArray<{ id: string; placeholders: unknown }>,
  taken: Set<string>,
): StoredDefinition[] {
  const copies: StoredDefinition[] = [];
  for (const partial of partials) {
    copies.push(...partialRepeaterCopies(partial));
    const fields = [
      ...readOakDocCustomFields(partial.placeholders),
      ...readOakDocPartialCustomFields(partial.placeholders),
    ];
    for (const field of fields) {
      if (taken.has(field.key)) continue;
      taken.add(field.key);
      copies.push({
        ...toStoredDefinition(field, undefined),
        [OAKDOC_PARTIAL_FIELD_MARKER]: partial.id,
      });
    }
  }
  return copies;
}

/**
 * Copy the custom fields (and section names and contacts shortlists) of
 * inserted partials onto a template's placeholders, so Configure prompts for
 * them. Fields the template defines itself win; copies from partials no
 * longer inserted are dropped.
 */
export function mergeOakDocPartialCustomFields(
  placeholders: unknown,
  partials: ReadonlyArray<{ id: string; placeholders: unknown }>,
): StoredDefinition[] {
  const existing = Array.isArray(placeholders) ? placeholders.filter(isRecord) : [];
  const own = existing.filter((definition) => !isPartialCopy(definition));
  const taken = new Set(readOakDocCustomFields(own).map((field) => field.key));
  return [...own, ...partialFieldCopies(partials, taken)];
}

/**
 * Add the custom fields of partials chosen for one document (numbered
 * resolutions) to its template's placeholders. Everything the template
 * already carries is kept and wins on a shared key.
 */
export function appendOakDocPartialCustomFields(
  placeholders: unknown,
  partials: ReadonlyArray<{ id: string; placeholders: unknown }>,
): StoredDefinition[] {
  const existing = Array.isArray(placeholders) ? placeholders.filter(isRecord) : [];
  const taken = new Set([
    ...readOakDocCustomFields(existing).map((field) => field.key),
    ...readOakDocPartialCustomFields(existing).map((field) => field.key),
  ]);
  return [...existing, ...partialFieldCopies(partials, taken)];
}

/** A key for a new field from its label: "Fee amount" -> fee_amount. */
export function oakDocCustomFieldKeyFromLabel(label: string, taken: ReadonlySet<string>): string {
  const base = label
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  const stem = (!base ? 'field' : CUSTOM_KEY.test(base) ? base : `field_${base}`).slice(0, 60);
  let key = stem;
  for (let counter = 2; taken.has(key); counter += 1) key = `${stem}_${counter}`;
  return key;
}

const EXACT_DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

function groupDigits(value: string, minimumDecimals: number): string {
  const text = value.trim().replace(/,/g, '');
  if (!EXACT_DECIMAL.test(text)) return value.trim();
  const negative = text.startsWith('-');
  const unsigned = text.replace(/^[+-]/, '');
  const [whole = '0', fraction = ''] = unsigned.split('.');
  const grouped = (whole.replace(/^0+(?=\d)/, '') || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const decimals = fraction.length >= minimumDecimals ? fraction : fraction.padEnd(minimumDecimals, '0');
  return `${negative ? '-' : ''}${grouped}${decimals ? `.${decimals}` : ''}`;
}

/** The text a custom field prints, from the value entered on Configure. */
export function formatOakDocCustomFieldValue(value: unknown, type: PlaceholderValueType | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (value instanceof Date) return formatOakDocDate(value) ?? '';
  const text = String(value);
  if (!text.trim()) return '';
  switch (type) {
    case 'date':
      return formatOakDocDate(text.trim()) ?? text;
    case 'number':
      return groupDigits(text, 0);
    case 'currency':
      return groupDigits(text, 2);
    case 'boolean':
      return text === 'true' || text === '1' ? 'Yes' : text === 'false' || text === '0' ? 'No' : text;
    default:
      return text;
  }
}

function textAtPath(source: unknown, path: string): string {
  let value: unknown = source;
  for (const part of path.split('.')) {
    value = isRecord(value) ? value[part] : undefined;
  }
  return typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
}

/**
 * Values and calendar dates for the custom field controls in a document.
 * `contacts` holds, by key, the details of the contact chosen for each
 * Contact field: the bare field prints the name, `custom.<key>.<path>` the
 * detail at that path.
 */
export function buildOakDocCustomFieldValues(input: {
  tags: readonly string[];
  data: Readonly<Record<string, unknown>>;
  types: Readonly<Record<string, PlaceholderValueType>>;
  contacts?: Readonly<Record<string, unknown>>;
}): { values: Record<string, string>; dates: Record<string, string> } {
  const values: Record<string, string> = {};
  const dates: Record<string, string> = {};
  for (const tag of new Set(input.tags)) {
    const parsed = parseOakDocCustomFieldTag(tag);
    if (!parsed) continue;
    const { key, path } = parsed;
    if (path !== null || (input.contacts && key in input.contacts)) {
      values[tag] = textAtPath(input.contacts?.[key], path ?? 'name');
      continue;
    }
    const raw = input.data[key];
    const type = input.types[key];
    values[tag] = formatOakDocCustomFieldValue(raw, type);
    if (type === 'date') {
      const iso = oakDocIsoDate(raw);
      if (iso) dates[tag] = iso;
    }
  }
  return { values, dates };
}

/** The contact shortlist of every Contact field a template defines or copies, by key. */
export function oakDocCustomContactFields(placeholders: unknown): Record<string, string[]> {
  const fields: Record<string, string[]> = {};
  if (!Array.isArray(placeholders)) return fields;
  for (const definition of placeholders) {
    if (!isRecord(definition) || fieldType(definition) !== 'contact') continue;
    const key = storedKey(definition);
    if (key && !(key in fields)) fields[key] = readPlaceholderOptions(definition.options);
  }
  return fields;
}

/** Stored value type of every custom field a template defines or copies from its partials. */
export function oakDocCustomFieldTypes(placeholders: unknown): Record<string, PlaceholderValueType> {
  const types: Record<string, PlaceholderValueType> = {};
  if (!Array.isArray(placeholders)) return types;
  for (const definition of placeholders) {
    if (!isRecord(definition)) continue;
    const key = storedKey(definition);
    if (key && !(key in types)) types[key] = storedType(fieldType(definition));
  }
  return types;
}
