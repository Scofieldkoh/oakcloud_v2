/**
 * Per-person fields on Configure: who each section lists, and what is still
 * wrong with the values entered for them (see `checkOakDocPersonFields`).
 */

import {
  normalizeOakDocOfficerRole,
  oakDocContactListNameFromSlug,
  oakDocRepeaterDefinitionForTag,
  parseOakDocContactListSlug,
  parseOakDocOfficerRepeaterRoles,
} from '@/lib/document-editor/oakdoc-repeater-definitions';
import type {
  OakDocPersonField,
  OakDocRepeaterSectionSummary,
} from '@/lib/document-editor/oakdoc-custom-fields';
import {
  checkOakDocPersonFields,
  type OakDocPersonFieldIssue,
  type OakDocPersonFieldPerson,
} from '@/lib/document-editor/oakdoc-person-values';
import { perPersonSelectedIds } from '@/lib/document-generation-per-person';
import type { BatchItemConfiguration } from '@/types/document-generation-batch';

export interface PersonFieldParty {
  id: string;
  name: string;
  role?: string | null;
}

/** The people a section prints for this document, in order. */
export function personFieldPeople(input: {
  tag: string;
  configuration: BatchItemConfiguration;
  directors: readonly PersonFieldParty[];
  shareholders: readonly PersonFieldParty[];
  officers: readonly PersonFieldParty[];
  /** A contact's name; contacts are picked from anywhere in the workspace. */
  contactName: (id: string) => string;
}): OakDocPersonFieldPerson[] {
  const { tag, configuration } = input;
  const person = configuration.documentPerson;
  if (person?.tag === tag) return [{ id: person.id, name: person.name }];
  const named = (parties: readonly PersonFieldParty[], ids: readonly string[] | undefined) => {
    const byId = new Map(parties.map((party) => [party.id, party]));
    return (ids ?? parties.map((party) => party.id)).flatMap((id) => {
      const party = byId.get(id);
      return party ? [{ id, name: party.name }] : [];
    });
  };
  switch (oakDocRepeaterDefinitionForTag(tag)?.kind) {
    case 'directors':
      return named(input.directors, configuration.selectedDirectorIds);
    case 'shareholders':
      return named(input.shareholders, configuration.selectedShareholderIds);
    case 'officers': {
      const roles = new Set(parseOakDocOfficerRepeaterRoles(tag) ?? []);
      const officers = input.officers.filter((officer) => roles.size === 0
        || roles.has(normalizeOakDocOfficerRole(officer.role)));
      return named(officers, configuration.selectedOfficerIds ?? []);
    }
    case 'contacts':
      return (perPersonSelectedIds(tag, configuration) ?? []).map((id) => ({ id, name: input.contactName(id) }));
    default:
      return [];
  }
}

/** A section's title on Configure: the name its author gave it, else its kind. */
export function personFieldSectionName(
  tag: string,
  sections: OakDocRepeaterSectionSummary | null | undefined,
): string {
  const named = sections?.names[tag]?.[0];
  if (named) return named;
  const slug = parseOakDocContactListSlug(tag);
  return slug ? oakDocContactListNameFromSlug(slug) : oakDocRepeaterDefinitionForTag(tag)?.label ?? tag;
}

/** Per-person fields of the sections a document prints, by tag. */
export function documentPersonFields(
  sections: OakDocRepeaterSectionSummary | null | undefined,
  fieldTags: readonly string[] | undefined,
): Record<string, OakDocPersonField[]> {
  const present = new Set(fieldTags ?? []);
  return Object.fromEntries(Object.entries(sections?.personFields ?? {})
    .filter(([tag, fields]) => present.has(tag) && fields.length > 0));
}

/** What is still missing or wrong in a document's per-person values. */
export function personFieldIssues(input: {
  sections: OakDocRepeaterSectionSummary | null | undefined;
  fieldTags: readonly string[] | undefined;
  configuration: BatchItemConfiguration;
  customValue: (key: string) => string;
  customLabel?: (key: string) => string;
  directors: readonly PersonFieldParty[];
  shareholders: readonly PersonFieldParty[];
  officers: readonly PersonFieldParty[];
  contactName: (id: string) => string;
}): OakDocPersonFieldIssue[] {
  const personFields = documentPersonFields(input.sections, input.fieldTags);
  const tags = Object.keys(personFields);
  if (tags.length === 0) return [];
  const people = Object.fromEntries(tags.map((tag) => [tag, personFieldPeople({ ...input, tag })]));
  const totals = new Set(Object.values(personFields).flat().flatMap((field) => field.totalOf ?? []));
  return checkOakDocPersonFields({
    personFields,
    people,
    values: input.configuration.personValues,
    customData: Object.fromEntries([...totals].map((key) => [key, input.customValue(key)])),
    sectionName: (tag) => personFieldSectionName(tag, input.sections),
    customLabel: input.customLabel,
  }).issues;
}
