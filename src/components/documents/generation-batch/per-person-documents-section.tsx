'use client';

import { useMemo, type ReactNode } from 'react';
import {
  DocumentContactChoiceList,
  type DocumentContact,
} from '@/components/documents/document-contact-choice-list';
import { DocumentPartyChoiceList } from '@/components/documents/document-party-choice-list';
import type { DocumentParty } from '@/lib/document-party';
import type { DocumentPersonChoice } from '@/lib/document-generation-per-person';
import {
  formatOakDocOfficerRoles,
  oakDocRepeaterDefinitionForTag,
  parseOakDocContactListSlug,
  parseOakDocOfficerRepeaterRoles,
} from '@/lib/document-editor/oakdoc-repeater-definitions';
import type { OakDocRepeaterSectionSummary } from '@/lib/document-editor/oakdoc-custom-fields';
import { oneOfficerPerPerson } from '@/lib/officer-identity';
import type { BatchDocumentPerson } from '@/types/document-generation-batch';
import { BatchSection } from './batch-section';
import { OfficerChoiceList } from './officer-choice-list';
import { officersOfRoles } from './template-party-needs';

export interface PerPersonDocumentsSectionProps {
  /** The template's section that makes a separate document for each person. */
  tag: string;
  /** Whom this document is for. */
  person: BatchDocumentPerson | null | undefined;
  /** Everyone with a document of this template in the batch, in order. */
  people: DocumentPersonChoice[];
  onPeopleChange: (people: DocumentPersonChoice[]) => void;
  repeaterSections?: OakDocRepeaterSectionSummary | null;
  /** Contacts shortlist of the template's unnamed contacts list. */
  contactShortlist?: ReadonlyArray<{ id: string; name: string }> | null;
  directors: DocumentParty[];
  shareholders: DocumentParty[];
  officers: DocumentParty[];
  contacts: DocumentContact[];
  contactsById?: Map<string, DocumentContact>;
  partyLoading?: boolean;
  partyError?: string | null;
  onPartyRetry?: () => void;
  onContactSearch?: (query: string) => void;
  contactsLoading?: boolean;
  disabled?: boolean;
}

const GRID = 'grid gap-4 lg:grid-cols-2 xl:grid-cols-3';

/** The section's name on Configure, else what it lists. */
function sectionTitle(tag: string, sections: OakDocRepeaterSectionSummary | null | undefined): string {
  const named = sections?.names[tag]?.[0];
  if (named) return named;
  const definition = oakDocRepeaterDefinitionForTag(tag);
  const roles = parseOakDocOfficerRepeaterRoles(tag);
  if (roles && roles.length > 0) return formatOakDocOfficerRoles(roles);
  return definition?.label ?? 'People';
}

/**
 * The people of a one-document-per-person template: each one ticked gets a
 * separate document in the batch, titled with their name, and this card says
 * whom the open document is for. Uses the section's usual picker.
 */
export function PerPersonDocumentsSection({
  tag,
  person,
  people,
  onPeopleChange,
  repeaterSections,
  contactShortlist,
  directors,
  shareholders,
  officers,
  contacts,
  contactsById,
  partyLoading = false,
  partyError = null,
  onPartyRetry,
  onContactSearch,
  contactsLoading = false,
  disabled = false,
}: PerPersonDocumentsSectionProps) {
  const kind = oakDocRepeaterDefinitionForTag(tag)?.kind;
  const title = sectionTitle(tag, repeaterSections);
  const ids = people.map((entry) => entry.id);
  const shortlist = useMemo(() => {
    const slug = parseOakDocContactListSlug(tag);
    const listed = slug ? repeaterSections?.shortlists[tag] : contactShortlist;
    return listed && listed.length > 0 ? listed : null;
  }, [contactShortlist, repeaterSections, tag]);
  const officerOptions = useMemo(() => {
    const roles = parseOakDocOfficerRepeaterRoles(tag);
    return officersOfRoles(officers, roles && roles.length > 0 ? roles : null);
  }, [officers, tag]);

  const pickParties = (options: DocumentParty[]) => (values: string[]) => {
    const byId = new Map(options.map((option) => [option.id, option.name]));
    const known = new Map(people.map((entry) => [entry.id, entry.name]));
    onPeopleChange(values.map((id) => ({ id, name: byId.get(id) ?? known.get(id) ?? '' })));
  };
  const pickContacts = (selected: DocumentContact[]) => onPeopleChange(
    selected.map((contact) => ({ id: contact.id, name: contact.fullName })),
  );
  const contactOf = (entry: DocumentPersonChoice): DocumentContact => (
    contactsById?.get(entry.id) ?? contacts.find((contact) => contact.id === entry.id) ?? { id: entry.id, fullName: entry.name }
  );

  let picker: ReactNode = null;
  if (kind === 'directors' || kind === 'shareholders') {
    const options = kind === 'directors' ? directors : shareholders;
    picker = (
      <DocumentPartyChoiceList
        id={`document-people-${kind}`}
        label={title}
        options={options}
        values={ids}
        onChange={pickParties(options)}
        multiple
        isLoading={partyLoading}
        error={partyError}
        onRetry={onPartyRetry}
      />
    );
  } else if (kind === 'officers') {
    picker = (
      <OfficerChoiceList
        id="document-people-officers"
        label={title}
        officers={officerOptions}
        values={oneOfficerPerPerson(ids, officerOptions)}
        onChange={pickParties(officerOptions)}
        isLoading={partyLoading}
        error={partyError}
        onRetry={onPartyRetry}
      />
    );
  } else if (kind === 'contacts') {
    picker = shortlist ? (
      <DocumentContactChoiceList
        id="document-people-contacts"
        contacts={shortlist.map((entry) => contactsById?.get(entry.id) ?? { id: entry.id, fullName: entry.name })}
        selected={people.map(contactOf)}
        onChange={pickContacts}
      />
    ) : (
      <DocumentContactChoiceList
        id="document-people-contacts"
        contacts={contacts}
        selected={people.map(contactOf)}
        onChange={pickContacts}
        onSearch={onContactSearch}
        isLoading={contactsLoading}
        serverFiltered={Boolean(onContactSearch)}
      />
    );
  }

  return (
    <BatchSection
      title={`${title} · one document each`}
      status={{
        complete: Boolean(person),
        label: person ? 'Complete' : '1 required',
      }}
    >
      <p className="mb-3 text-sm text-text-secondary">
        {person
          ? `This document is for ${person.name}. Each person ticked gets a separate document.`
          : 'Tick everyone who needs this document; each gets a separate one.'}
      </p>
      <fieldset disabled={disabled} className={GRID}>{picker}</fieldset>
    </BatchSection>
  );
}
