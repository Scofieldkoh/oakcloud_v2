'use client';

import { DocumentPartyChoiceList } from '@/components/documents/document-party-choice-list';
import type { DocumentParty } from '@/lib/document-party';
import { oneOfficerPerPerson } from '@/lib/officer-identity';
import type { BatchItemConfiguration } from '@/types/document-generation-batch';
import type { EditableBatchItem } from './batch-workspace-state';
import type { OakDocPickerKey, OakDocRepeaterSectionSummary } from '@/lib/document-editor/oakdoc-custom-fields';
import {
  PARTY_CONFIGURATION_KEYS,
  joinRepeaterSectionNames,
  officersOfRoles,
  repeaterSectionNames,
  templateContactLists,
  type TemplatePartyNeeds,
} from './template-party-needs';
import { OfficerChoiceList } from './officer-choice-list';

type PartyKey = (typeof PARTY_CONFIGURATION_KEYS)[number][1];

export interface BatchSharedPartiesProps {
  items: EditableBatchItem[];
  /** Party choices each item's template asks for, by item key. */
  needsByItemKey: Record<string, TemplatePartyNeeds>;
  /**
   * Roles each item's officers repeaters print (templateOfficerRoles), by
   * item key; null or absent means any role.
   */
  officerRolesByItemKey?: Record<string, readonly string[] | null>;
  /** Word field tags of each item's template (with chosen partials'), by item key. */
  fieldTagsByItemKey?: Record<string, readonly string[] | undefined>;
  /**
   * Names the author gave each item's repeating sections and its named
   * contacts lists, by item key. Named sections are titled with their names;
   * a named contacts list is shared only with lists of the same name.
   */
  repeaterSectionsByItemKey?: Record<string, OakDocRepeaterSectionSummary | null>;
  directors: DocumentParty[];
  shareholders: DocumentParty[];
  officers?: DocumentParty[];
  contacts: DocumentParty[];
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** Writes one party choice onto every listed document. */
  onApply: (itemKeys: string[], patch: Partial<BatchItemConfiguration>) => void;
  disabled?: boolean;
}

const LABELS: Record<PartyKey, string> = {
  selectedDirectorId: 'Director',
  selectedDirectorIds: 'Directors',
  selectedShareholderId: 'Shareholder',
  selectedShareholderIds: 'Shareholders',
  selectedOfficerIds: 'Officers',
  selectedContactId: 'Contact',
};

/** The single-person picker each key fills, whose name the author may set. */
const PICKER_KEYS: Partial<Record<PartyKey, OakDocPickerKey>> = {
  selectedDirectorId: 'selectedDirector',
  selectedShareholderId: 'selectedShareholder',
  selectedContactId: 'selectedContact',
};

const REPEATER_KINDS: Partial<Record<PartyKey, 'directors' | 'shareholders' | 'officers'>> = {
  selectedDirectorIds: 'directors',
  selectedShareholderIds: 'shareholders',
  selectedOfficerIds: 'officers',
};

/** Checked parties for a repeater: every party until the user narrows the list. */
function checkedIds(options: DocumentParty[], ids: string[] | undefined): string[] {
  if (ids === undefined) return options.map((party) => party.id);
  const available = new Set(options.map((party) => party.id));
  return ids.filter((id) => available.has(id));
}

/** A shortlisted contact Configure has no details for yet. */
function shortlistParty(contact: { id: string; name: string }): DocumentParty {
  return {
    id: contact.id,
    contactId: contact.id,
    name: contact.name,
    detail: null,
    email: null,
    phone: null,
    address: { full: null, letter: null },
  };
}

function sameIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

/**
 * Party choices used by more than one document, set once for all of them.
 * Each document can still be changed on Configure.
 */
export function BatchSharedParties({
  items,
  needsByItemKey,
  officerRolesByItemKey = {},
  fieldTagsByItemKey = {},
  repeaterSectionsByItemKey = {},
  directors,
  shareholders,
  officers = [],
  contacts,
  isLoading = false,
  error = null,
  onRetry,
  onApply,
  disabled = false,
}: BatchSharedPartiesProps) {
  const apply = (itemKeys: string[], patch: Partial<BatchItemConfiguration>) => {
    if (!disabled) onApply(itemKeys, patch);
  };
  // Officers of every role any of the documents prints; any role when one takes any.
  const sharedOfficerRoles = (targets: EditableBatchItem[]): string[] | null => {
    const roles = new Set<string>();
    for (const item of targets) {
      const itemRoles = officerRolesByItemKey[item.key];
      if (!itemRoles) return null;
      for (const role of itemRoles) roles.add(role);
    }
    return [...roles];
  };
  const optionsFor = (key: PartyKey, targets: EditableBatchItem[]): DocumentParty[] => {
    if (key === 'selectedDirectorId' || key === 'selectedDirectorIds') return directors;
    if (key === 'selectedShareholderId' || key === 'selectedShareholderIds') return shareholders;
    if (key === 'selectedOfficerIds') return officersOfRoles(officers, sharedOfficerRoles(targets));
    return contacts;
  };

  // A picker shared by documents whose sections have different names shows them all.
  const labelFor = (key: PartyKey, targets: EditableBatchItem[]): string => {
    const names = Array.from(new Set(targets.flatMap((item) => {
      const sections = repeaterSectionsByItemKey[item.key];
      const picker = PICKER_KEYS[key];
      if (picker) return sections?.names[picker] ?? [];
      const kind = REPEATER_KINDS[key];
      return kind ? repeaterSectionNames(sections, kind) : [];
    })));
    return joinRepeaterSectionNames(names) ?? LABELS[key];
  };

  const shared = PARTY_CONFIGURATION_KEYS
    .map(([need, key]) => ({
      key,
      targets: items.filter((item) => item.status !== 'GENERATED' && needsByItemKey[item.key]?.[need]),
    }))
    .filter(({ targets }) => targets.length >= 2);

  // Named contacts lists: lists of the same name share one picker, never others.
  const sharedLists = new Map<string, {
    name: string;
    targets: EditableBatchItem[];
    shortlists: Array<Array<{ id: string; name: string }>>;
  }>();
  for (const item of items) {
    if (item.status === 'GENERATED') continue;
    for (const list of templateContactLists(fieldTagsByItemKey[item.key], repeaterSectionsByItemKey[item.key])) {
      const entry = sharedLists.get(list.slug) ?? { name: list.name, targets: [], shortlists: [] };
      entry.targets.push(item);
      entry.shortlists.push(list.shortlist);
      sharedLists.set(list.slug, entry);
    }
  }
  const sharedContactLists = [...sharedLists.entries()]
    .filter(([, entry]) => entry.targets.length >= 2)
    .map(([slug, entry]) => {
      // Shortlisted contacts of every document; any contact when one has no shortlist.
      const anyContact = entry.shortlists.some((shortlist) => shortlist.length === 0);
      const options = new Map<string, DocumentParty>(anyContact ? contacts.map((party) => [party.id, party]) : []);
      const known = new Map(contacts.map((party) => [party.id, party]));
      for (const shortlist of entry.shortlists) {
        for (const contact of shortlist) {
          if (!options.has(contact.id)) options.set(contact.id, known.get(contact.id) ?? shortlistParty(contact));
        }
      }
      return { slug, ...entry, options: [...options.values()] };
    });

  if (shared.length === 0 && sharedContactLists.length === 0) return null;

  return (
    <section aria-labelledby="shared-parties-heading">
      <h2 id="shared-parties-heading" className="text-sm font-medium text-text-primary">
        Shared parties
      </h2>
      <p className="mt-1 text-xs text-text-muted">
        Choices used by more than one document. Changing one here updates every document
        that uses it; you can still change a single document on Configure.
      </p>
      <div className="mt-3 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {shared.map(({ key, targets }) => {
          const options = optionsFor(key, targets);
          const targetKeys = targets.map((item) => item.key);
          const note = `Used by ${targets.length} documents`;
          if (key === 'selectedOfficerIds') {
            // Officers are listed once per person (oneOfficerPerPerson).
            const selections = targets.map((item) => oneOfficerPerPerson(item.configuration[key] ?? [], options));
            const differs = selections.some((ids) => !sameIds(ids, selections[0]));
            return (
              <div key={key}>
                <OfficerChoiceList
                  id={`shared-${key}`}
                  label={labelFor(key, targets)}
                  officers={options}
                  values={selections[0]}
                  onChange={(values) => apply(targetKeys, { [key]: values })}
                  isLoading={isLoading}
                  error={error}
                  onRetry={onRetry}
                />
                <p className="mt-1 text-xs text-text-muted">
                  {differs ? `${note}; they differ, so the first document is shown.` : note}
                </p>
              </div>
            );
          }
          if (key === 'selectedDirectorIds' || key === 'selectedShareholderIds') {
            const selections = targets.map((item) =>
              checkedIds(options, item.configuration[key]));
            const differs = selections.some((ids) => !sameIds(ids, selections[0]));
            return (
              <div key={key}>
                <DocumentPartyChoiceList
                  id={`shared-${key}`}
                  label={labelFor(key, targets)}
                  options={options}
                  values={selections[0]}
                  onChange={(values) => apply(targetKeys, { [key]: values })}
                  multiple
                  isLoading={isLoading}
                  error={error}
                  onRetry={onRetry}
                />
                <p className="mt-1 text-xs text-text-muted">
                  {differs ? `${note}; they differ, so the first document is shown.` : note}
                </p>
              </div>
            );
          }
          const values = targets.map((item) => item.configuration[key] ?? '');
          const differs = values.some((value) => value !== values[0]);
          return (
            <div key={key}>
              <DocumentPartyChoiceList
                id={`shared-${key}`}
                label={labelFor(key, targets)}
                options={options}
                value={values[0]}
                onChange={(value) => apply(targetKeys, { [key]: value || null })}
                isLoading={isLoading}
                error={error}
                onRetry={onRetry}
              />
              <p className="mt-1 text-xs text-text-muted">
                {differs ? `${note}; they differ, so the first document is shown.` : note}
              </p>
            </div>
          );
        })}
        {sharedContactLists.map((list) => {
          const available = new Set(list.options.map((party) => party.id));
          const selections = list.targets.map((item) =>
            (item.configuration.selectedContactListIds?.[list.slug] ?? []).filter((id) => available.has(id)));
          const differs = selections.some((ids) => !sameIds(ids, selections[0]));
          const note = `Used by ${list.targets.length} documents`;
          return (
            <div key={`contact-list-${list.slug}`}>
              <DocumentPartyChoiceList
                id={`shared-contact-list-${list.slug}`}
                label={list.name}
                options={list.options}
                values={selections[0]}
                onChange={(values) => {
                  // Each document keeps its other lists.
                  for (const item of list.targets) {
                    apply([item.key], {
                      selectedContactListIds: {
                        ...(item.configuration.selectedContactListIds ?? {}),
                        [list.slug]: values,
                      },
                    });
                  }
                }}
                multiple
                isLoading={isLoading}
                error={error}
                onRetry={onRetry}
              />
              <p className="mt-1 text-xs text-text-muted">
                {differs ? `${note}; they differ, so the first document is shown.` : note}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
