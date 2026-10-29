import {
  OAKDOC_CONTACTS_REPEATER_TAG,
  OAKDOC_DIRECTORS_REPEATER_TAG,
  OAKDOC_SHAREHOLDERS_REPEATER_TAG,
  isOakDocContactsRepeaterTag,
  normalizeOakDocOfficerRole,
  oakDocContactListNameFromSlug,
  oakDocContactsRepeaterTag,
  oakDocOfficerRepeaterRoleUnion,
  oakDocRepeaterDefinitionForTag,
  parseOakDocContactListSlug,
  parseOakDocOfficerRepeaterRoles,
  type OakDocGenericRepeaterKind,
} from '@/lib/document-editor/oakdoc-repeater-definitions';
import type {
  OakDocCustomFieldContact,
  OakDocPickerKey,
  OakDocRepeaterSectionSummary,
} from '@/lib/document-editor/oakdoc-custom-fields';
import type { DocumentParty } from '@/lib/document-party';
import {
  getRequiredLegacyContactSelection,
  getRequiredPartySelections,
  getTemplatePartyCollections,
} from '@/lib/template-analysis';
import type { BatchItemConfiguration } from '@/types/document-generation-batch';

/** Party choices a template asks for on Configure. */
export interface TemplatePartyNeeds {
  director: boolean;
  directors: boolean;
  shareholder: boolean;
  shareholders: boolean;
  contact: boolean;
  /** Officers ticked on Configure, for the Word officers repeaters (see templateOfficerRoles). */
  officers: boolean;
  /** A contact list: the Word contacts repeater or legacy contact placeholders. */
  contacts: boolean;
}

function usesField(tags: ReadonlySet<string>, root: string): boolean {
  for (const tag of tags) if (tag.startsWith(`${root}.`)) return true;
  return false;
}

/**
 * A template without known content asks for every single party. A Word
 * template asks for the parties its fields and repeaters use.
 */
export function templatePartyNeeds(
  templateContent: string | undefined,
  templateFieldTags?: readonly string[],
): TemplatePartyNeeds {
  const selections = templateContent === undefined
    ? { director: true, shareholder: true, contact: true }
    : getRequiredPartySelections(templateContent);
  const legacy = templateContent === undefined
    ? { directors: false, shareholders: false }
    : getTemplatePartyCollections(templateContent);
  const tags = new Set(templateFieldTags ?? []);
  return {
    director: selections.director || usesField(tags, 'selectedDirector'),
    directors: legacy.directors || tags.has(OAKDOC_DIRECTORS_REPEATER_TAG),
    shareholder: selections.shareholder || usesField(tags, 'selectedShareholder'),
    shareholders: legacy.shareholders || tags.has(OAKDOC_SHAREHOLDERS_REPEATER_TAG),
    contact: selections.contact || usesField(tags, 'selectedContact'),
    officers: [...tags].some((tag) => parseOakDocOfficerRepeaterRoles(tag) !== null),
    contacts: templateContent === undefined
      || tags.has(OAKDOC_CONTACTS_REPEATER_TAG)
      || getRequiredLegacyContactSelection(templateContent),
  };
}

/**
 * Roles Configure offers officers of: null for any role, else the roles of
 * every officers repeater in the template together (`repeat.officers.secretary`).
 */
export function templateOfficerRoles(templateFieldTags?: readonly string[]): string[] | null {
  return oakDocOfficerRepeaterRoleUnion(templateFieldTags ?? []);
}

/** The officers of these roles; every officer when roles is null. */
export function officersOfRoles<T extends Pick<DocumentParty, 'role'>>(
  officers: readonly T[],
  roles: readonly string[] | null | undefined,
): T[] {
  if (!roles) return [...officers];
  const wanted = new Set(roles);
  return officers.filter((officer) => wanted.has(normalizeOakDocOfficerRole(officer.role)));
}

/**
 * The names the author gave the template's sections of one kind (its own
 * and its partials'), joined: "Signers for the resolution(s)". Null when
 * none is named, so the picker keeps its usual heading. Contacts lists are
 * separate lists (templateContactLists), not labels.
 */
export function repeaterSectionTitle(
  sections: OakDocRepeaterSectionSummary | null | undefined,
  kind: NamedRepeaterKind,
): string | null {
  return joinRepeaterSectionNames(repeaterSectionNames(sections, kind));
}

type NamedRepeaterKind = Exclude<OakDocGenericRepeaterKind, 'contacts'>;

/**
 * The names the author gave a single-person picker (the selected director,
 * shareholder or contact), joined: "Signer of the resolution(s)". Null when
 * none is named, so the picker keeps its usual label.
 */
export function pickerTitle(
  sections: OakDocRepeaterSectionSummary | null | undefined,
  key: OakDocPickerKey,
): string | null {
  return joinRepeaterSectionNames(sections?.names[key] ?? []);
}

/** The distinct names given to the template's sections of one kind. */
export function repeaterSectionNames(
  sections: OakDocRepeaterSectionSummary | null | undefined,
  kind: NamedRepeaterKind,
): string[] {
  const names: string[] = [];
  for (const [tag, tagNames] of Object.entries(sections?.names ?? {})) {
    if (isOakDocContactsRepeaterTag(tag) || oakDocRepeaterDefinitionForTag(tag)?.kind !== kind) continue;
    for (const name of tagNames) if (!names.includes(name)) names.push(name);
  }
  return names;
}

/** Several section names as one heading; null for none. */
export function joinRepeaterSectionNames(names: readonly string[]): string | null {
  return names.length > 0 ? names.join(' · ') : null;
}

export interface TemplateContactList {
  slug: string;
  name: string;
  /** Contacts Configure offers; empty means any contact. */
  shortlist: OakDocCustomFieldContact[];
}

/**
 * The template's named contacts lists (`repeat.contacts.<slug>`), each a
 * separate list with its own name and shortlist, in document order.
 */
export function templateContactLists(
  templateFieldTags: readonly string[] | undefined,
  sections: OakDocRepeaterSectionSummary | null | undefined,
): TemplateContactList[] {
  const slugs = new Set<string>();
  for (const tag of [...(templateFieldTags ?? []), ...Object.keys(sections?.names ?? {})]) {
    const slug = parseOakDocContactListSlug(tag);
    if (slug) slugs.add(slug);
  }
  return [...slugs].map((slug) => {
    const tag = oakDocContactsRepeaterTag(slug);
    return {
      slug,
      name: sections?.names[tag]?.[0] ?? oakDocContactListNameFromSlug(slug),
      shortlist: sections?.shortlists[tag] ?? [],
    };
  });
}

/** Configuration keys behind each party choice, in display order. */
export const PARTY_CONFIGURATION_KEYS = [
  ['director', 'selectedDirectorId'],
  ['directors', 'selectedDirectorIds'],
  ['shareholder', 'selectedShareholderId'],
  ['shareholders', 'selectedShareholderIds'],
  ['officers', 'selectedOfficerIds'],
  ['contact', 'selectedContactId'],
] as const satisfies ReadonlyArray<readonly [keyof TemplatePartyNeeds, keyof BatchItemConfiguration]>;

export function partyConfigurationKeys(needs: TemplatePartyNeeds): Array<keyof BatchItemConfiguration> {
  return PARTY_CONFIGURATION_KEYS.filter(([need]) => needs[need]).map(([, key]) => key);
}
