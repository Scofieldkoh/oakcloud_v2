'use client';

import { useEffect, useMemo } from 'react';
import { RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  DocumentContactChoiceList,
  type DocumentContact,
} from '@/components/documents/document-contact-choice-list';
import {
  DocumentPartyChoiceList,
} from '@/components/documents/document-party-choice-list';
import { SingleDateInput } from '@/components/ui/single-date-input';
import { SearchableSelect } from '@/components/ui/searchable-select';
import type { DocumentParty } from '@/lib/document-party';
import {
  formatOakDocOfficerRoles,
  parseOakDocContactListSlug,
} from '@/lib/document-editor/oakdoc-repeater-definitions';
import type { OakDocRepeaterSectionSummary } from '@/lib/document-editor/oakdoc-custom-fields';
import type {
  BatchItemConfiguration,
  MasterFieldCatalogue,
} from '@/types/document-generation-batch';
import type { CustomPlaceholderDefinition } from '@/types/placeholders';
import type {
  EditableBatchItem,
} from './batch-workspace-state';
import { oneOfficerPerPerson, soleOfficerDefault } from '@/lib/officer-identity';
import type { DocumentPersonChoice } from '@/lib/document-generation-per-person';
import { BatchCustomFieldForm } from './batch-custom-field-form';
import { PerPersonDocumentsSection } from './per-person-documents-section';
import { PersonFieldsSection } from './person-fields-section';
import { OfficerChoiceList } from './officer-choice-list';
import { BatchSection } from './batch-section';
import { ApplyToOthersMenu, type ApplyScope } from './apply-to-others-menu';
import type { ItemCompleteness } from './batch-completeness';
import {
  officersOfRoles,
  partyConfigurationKeys,
  pickerTitle,
  repeaterSectionTitle,
  templateContactLists,
  templateOfficerRoles,
  templatePartyNeeds,
} from './template-party-needs';

/** Party and contact pickers take one column of this grid, so every section lines up. */
const PICKER_GRID = 'grid gap-4 lg:grid-cols-2 xl:grid-cols-3';

export interface StandardDocumentConfigProps {
  item: EditableBatchItem;
  templateFields: CustomPlaceholderDefinition[];
  templateContent?: string;
  /** Tags in a Word (OakDoc) template; its repeaters add party pickers. */
  templateFieldTags?: readonly string[];
  /**
   * Contacts the template's contacts repeater may list (set by the template
   * author); Configure then offers only these. Null or absent: any contact.
   */
  contactShortlist?: ReadonlyArray<{ id: string; name: string }> | null;
  /**
   * Names the author gave the template's repeating sections (each named one
   * gets a card titled with it) and its named contacts lists.
   */
  repeaterSections?: OakDocRepeaterSectionSummary | null;
  /**
   * The template's section that makes a separate document for each person:
   * its people are picked on their own card, not with the other parties.
   */
  perPersonTag?: string | null;
  /** Everyone with a document of this template in the batch, in order. */
  documentPeople?: DocumentPersonChoice[];
  onDocumentPeopleChange?: (people: DocumentPersonChoice[]) => void;
  masterFields: MasterFieldCatalogue;
  effectiveMasterValues: Record<string, string>;
  directors: DocumentParty[];
  shareholders: DocumentParty[];
  /** Current officers of every role; narrowed to the officers repeaters' roles. */
  officers?: DocumentParty[];
  /** Current contact result page. */
  contacts: DocumentContact[];
  /** Every contact seen so far, so existing selections stay resolvable. */
  contactsById?: Map<string, DocumentContact>;
  companyContacts: DocumentContact[];
  partyLoading?: boolean;
  partyError?: string | null;
  onPartyRetry?: () => void;
  onContactSearch?: (query: string) => void;
  contactsLoading?: boolean;
  onPatch: (patch: Partial<BatchItemConfiguration>) => void;
  disabled?: boolean;
  completeness?: ItemCompleteness;
  otherItemCount?: number;
  otherIncompleteCount?: number;
  onApplyToOthers?: (scope: ApplyScope, patch: Partial<BatchItemConfiguration>) => void;
}

/** Checked parties for a repeater: every party until the user narrows the list. */
function selectedPartyIds(parties: DocumentParty[], ids: string[] | undefined): string[] {
  if (ids === undefined) return parties.map((party) => party.id);
  const availableIds = new Set(parties.map((party) => party.id));
  return ids.filter((id) => availableIds.has(id));
}

/** Contacts of a shortlist, with what Configure already knows about each. */
function shortlistAsContacts(
  shortlist: ReadonlyArray<{ id: string; name: string }> | null | undefined,
  contacts: DocumentContact[],
  contactsById: Map<string, DocumentContact> | undefined,
): DocumentContact[] | null {
  if (!shortlist || shortlist.length === 0) return null;
  return shortlist.map((entry) => contactsById?.get(entry.id)
    ?? contacts.find((contact) => contact.id === entry.id)
    ?? { id: entry.id, fullName: entry.name });
}

/** Ticked contacts in order: only shortlisted ones when there is a shortlist. */
function pickedContacts(
  ids: readonly string[],
  shortlist: DocumentContact[] | null,
  contacts: DocumentContact[],
  contactsById: Map<string, DocumentContact> | undefined,
): DocumentContact[] {
  if (shortlist) {
    const byId = new Map(shortlist.map((contact) => [contact.id, contact]));
    return ids.flatMap((id) => byId.get(id) ?? []);
  }
  const pool = new Map<string, DocumentContact>(contactsById ?? []);
  for (const contact of contacts) pool.set(contact.id, contact);
  return ids.map((id) => pool.get(id) ?? { id, fullName: 'Contact unavailable' });
}

function missingCount(completeness: ItemCompleteness | undefined, prefix: string): number {
  if (!completeness) return 0;
  return completeness.missing.filter((entry) => entry.id.startsWith(prefix)).length;
}

export function StandardDocumentConfig({
  item,
  templateFields,
  templateContent,
  templateFieldTags,
  contactShortlist = null,
  repeaterSections = null,
  perPersonTag = null,
  documentPeople = [],
  onDocumentPeopleChange,
  masterFields,
  effectiveMasterValues,
  directors,
  shareholders,
  officers = [],
  contacts,
  contactsById,
  companyContacts,
  partyLoading = false,
  partyError = null,
  onPartyRetry,
  onContactSearch,
  contactsLoading = false,
  onPatch,
  disabled = false,
  completeness,
  otherItemCount = 0,
  otherIncompleteCount = 0,
  onApplyToOthers,
}: StandardDocumentConfigProps) {
  const configuration = item.configuration;
  // The other pickers leave out the section that splits documents per person.
  const pickerFieldTags = useMemo(
    () => (perPersonTag ? templateFieldTags?.filter((tag) => tag !== perPersonTag) : templateFieldTags),
    [perPersonTag, templateFieldTags],
  );

  const needs = useMemo(
    () => templatePartyNeeds(templateContent, pickerFieldTags),
    [templateContent, pickerFieldTags],
  );
  const partySelections = { director: needs.director, shareholder: needs.shareholder, contact: needs.contact };
  const partyCollections = { directors: needs.directors, shareholders: needs.shareholders };
  const showContacts = needs.contacts;
  const selectedDirectorIds = useMemo(
    () => selectedPartyIds(directors, configuration.selectedDirectorIds),
    [configuration.selectedDirectorIds, directors],
  );
  const selectedShareholderIds = useMemo(
    () => selectedPartyIds(shareholders, configuration.selectedShareholderIds),
    [configuration.selectedShareholderIds, shareholders],
  );
  // Only officers of the roles the template's officers repeaters print.
  const officerRoles = useMemo(() => templateOfficerRoles(pickerFieldTags), [pickerFieldTags]);
  const officerOptions = useMemo(() => officersOfRoles(officers, officerRoles), [officers, officerRoles]);
  // Officers start unticked: a resolution names the ones it is about. Each
  // person counts once (a saved choice with two of their roles keeps the first).
  const selectedOfficerIds = useMemo(
    () => oneOfficerPerPerson(configuration.selectedOfficerIds ?? [], officerOptions),
    [configuration.selectedOfficerIds, officerOptions],
  );
  // With only one person to choose, tick them until something is chosen.
  const officerDefault = needs.officers && !partyLoading && !disabled
    ? soleOfficerDefault(configuration.selectedOfficerIds, officerOptions)
    : null;
  const officerDefaultId = officerDefault?.[0];
  useEffect(() => {
    if (officerDefaultId) onPatch({ selectedOfficerIds: [officerDefaultId] });
  }, [officerDefaultId, onPatch]);
  const partyKeys = useMemo(() => partyConfigurationKeys(needs), [needs]);

  const selectedContact = useMemo<DocumentContact | null>(() => {
    const id = configuration.selectedContactId;
    if (!id) return null;
    return contacts.find((contact) => contact.id === id)
      ?? contactsById?.get(id)
      ?? companyContacts.find((contact) => contact.id === id)
      ?? { id, fullName: 'Contact unavailable' };
  }, [companyContacts, configuration.selectedContactId, contacts, contactsById]);

  // A shortlist set on the template replaces the workspace contact search.
  const shortlistContacts = useMemo(
    () => shortlistAsContacts(contactShortlist, contacts, contactsById),
    [contactShortlist, contacts, contactsById],
  );

  const selectedContacts = useMemo(
    () => pickedContacts(configuration.contactIds, shortlistContacts, contacts, contactsById),
    [configuration.contactIds, contacts, contactsById, shortlistContacts],
  );

  // Names the author gave sections: each named one gets its own card.
  const sectionTitles = useMemo(() => ({
    directors: repeaterSectionTitle(repeaterSections, 'directors'),
    shareholders: repeaterSectionTitle(repeaterSections, 'shareholders'),
    officers: repeaterSectionTitle(repeaterSections, 'officers'),
  }), [repeaterSections]);
  // Named contacts lists, each with its own shortlist and ticks.
  const contactLists = useMemo(() => templateContactLists(pickerFieldTags, repeaterSections).map((list) => {
    const shortlist = shortlistAsContacts(list.shortlist, contacts, contactsById);
    const ids = configuration.selectedContactListIds?.[list.slug] ?? [];
    return { ...list, shortlist, selected: pickedContacts(ids, shortlist, contacts, contactsById) };
  }).filter((list) => !perPersonTag || list.slug !== parseOakDocContactListSlug(perPersonTag)),
  [configuration.selectedContactListIds, contacts, contactsById, perPersonTag, repeaterSections, pickerFieldTags]);

  // Per-person values: names of the people listed, and the document values their totals check.
  const contactName = (id: string) => contactsById?.get(id)?.fullName
    ?? contacts.find((contact) => contact.id === id)?.fullName
    ?? 'Contact';
  const customValue = (key: string) => {
    const own = configuration.itemValues[key];
    if (typeof own === 'string' && own.trim()) return own;
    const shared = masterFields.fields.find((field) => field.key === key);
    if (!shared) return '';
    return configuration.masterOverrides[shared.id] ?? effectiveMasterValues[key] ?? '';
  };
  // A field is keyed `custom.<key>` on the template; callers pass the bare key.
  const customLabel = (key: string) => {
    const tag = key.startsWith('custom.') ? key : `custom.${key}`;
    return templateFields.find((field) => field.key === tag || field.key === key)?.label
      ?? masterFields.fields.find((field) => field.key === tag || field.key === key)?.label
      ?? key;
  };

  const titleMissing = configuration.title.trim().length === 0;
  const fieldMissing = missingCount(completeness, 'field:');
  const sharedMissing = missingCount(completeness, 'shared:');
  const requiredTemplateFields = templateFields.filter((field) => field.required).length;
  const requiredSharedFields = masterFields.fields.filter(
    (field) => field.requiredTemplateIds.includes(item.templateId),
  ).length;
  const namedDirectors = partyCollections.directors && sectionTitles.directors !== null;
  const namedShareholders = partyCollections.shareholders && sectionTitles.shareholders !== null;
  const namedOfficers = needs.officers && sectionTitles.officers !== null;
  const partyMissingCount = [
    partySelections.director && !configuration.selectedDirectorId,
    !namedDirectors && partyCollections.directors && selectedDirectorIds.length === 0,
    partySelections.shareholder && !configuration.selectedShareholderId,
    !namedShareholders && partyCollections.shareholders && selectedShareholderIds.length === 0,
    !namedOfficers && needs.officers && selectedOfficerIds.length === 0,
    partySelections.contact && !configuration.selectedContactId,
  ].filter(Boolean).length;
  // Keys under the generic Parties card; named sections have their own.
  const namedKeys = new Set<keyof BatchItemConfiguration>([
    ...(namedDirectors ? ['selectedDirectorIds' as const] : []),
    ...(namedShareholders ? ['selectedShareholderIds' as const] : []),
    ...(namedOfficers ? ['selectedOfficerIds' as const] : []),
  ]);
  const genericPartyKeys = partyKeys.filter((key) => !namedKeys.has(key));

  const applyMenu = (label: string, keys: Array<keyof BatchItemConfiguration>) =>
    onApplyToOthers ? (
      <ApplyToOthersMenu
        label={label}
        otherCount={otherItemCount}
        incompleteCount={otherIncompleteCount}
        disabled={disabled}
        header
        onApply={(scope) => {
          const patch: Partial<BatchItemConfiguration> = {};
          for (const key of keys) {
            // Structured values are copied so target items never share a
            // reference with the source item's configuration.
            const value = configuration[key];
            (patch as Record<string, unknown>)[key] = Array.isArray(value)
              ? [...value]
              : value;
          }
          onApplyToOthers(scope, patch);
        }}
      />
    ) : null;

  const directorsPicker = (
    <DocumentPartyChoiceList
      id="selected-directors"
      label="Directors"
      options={directors}
      values={selectedDirectorIds}
      onChange={(values) => onPatch({ selectedDirectorIds: values })}
      multiple
      isLoading={partyLoading}
      error={partyError}
      onRetry={onPartyRetry}
    />
  );
  const shareholdersPicker = (
    <DocumentPartyChoiceList
      id="selected-shareholders"
      label="Shareholders"
      options={shareholders}
      values={selectedShareholderIds}
      onChange={(values) => onPatch({ selectedShareholderIds: values })}
      multiple
      isLoading={partyLoading}
      error={partyError}
      onRetry={onPartyRetry}
    />
  );
  const officersPicker = (
    <OfficerChoiceList
      id="selected-officers"
      label={officerRoles ? `Officers (${formatOakDocOfficerRoles(officerRoles)})` : 'Officers'}
      officers={officerOptions}
      values={selectedOfficerIds}
      onChange={(values) => onPatch({ selectedOfficerIds: values })}
      isLoading={partyLoading}
      error={partyError}
      onRetry={onPartyRetry}
    />
  );
  // A section the author named gets a card titled with its name.
  const namedPartySections = [
    namedDirectors
      ? { key: 'selectedDirectorIds' as const, title: sectionTitles.directors!, count: selectedDirectorIds.length, picker: directorsPicker }
      : null,
    namedShareholders
      ? { key: 'selectedShareholderIds' as const, title: sectionTitles.shareholders!, count: selectedShareholderIds.length, picker: shareholdersPicker }
      : null,
    namedOfficers
      ? { key: 'selectedOfficerIds' as const, title: sectionTitles.officers!, count: selectedOfficerIds.length, picker: officersPicker }
      : null,
  ].flatMap((section) => section ?? []);

  return (
    <div className="space-y-3">
      <BatchSection
        title="Details"
        status={{
          complete: !titleMissing,
          label: titleMissing ? 'Title required' : 'Complete',
        }}
        collapsible={false}
      >
        <label className="block max-w-xl">
          <span className="text-sm font-medium text-text-primary">
            Document title
            <span className="ml-1 text-status-error" aria-hidden="true">*</span>
          </span>
          <input
            type="text"
            value={configuration.title}
            onChange={(event) => onPatch({ title: event.target.value })}
            disabled={disabled}
            aria-label="Document title"
            aria-invalid={titleMissing || undefined}
            aria-required="true"
            className={cn(
              'mt-1 min-h-11 w-full rounded-lg border bg-background-primary px-3 text-sm text-text-primary focus:border-oak-primary focus:outline-none focus:ring-2 focus:ring-oak-primary/30 lg:min-h-10',
              titleMissing ? 'border-status-error/60' : 'border-border-primary',
            )}
          />
          {titleMissing && (
            <span className="mt-1 block text-xs text-status-error">
              A title is required — it becomes the generated document name.
            </span>
          )}
          {!titleMissing && (
            <span className="mt-1 block text-xs text-text-muted">
              {'Keep {{template_name}}_{{company_name}}_{{date}} for an automatic title, or replace it with your own.'}
            </span>
          )}
        </label>
      </BatchSection>

      {perPersonTag && onDocumentPeopleChange ? (
        <PerPersonDocumentsSection
          tag={perPersonTag}
          person={configuration.documentPerson}
          people={documentPeople}
          onPeopleChange={onDocumentPeopleChange}
          repeaterSections={repeaterSections}
          contactShortlist={contactShortlist}
          directors={directors}
          shareholders={shareholders}
          officers={officers}
          contacts={contacts}
          contactsById={contactsById}
          partyLoading={partyLoading}
          partyError={partyError}
          onPartyRetry={onPartyRetry}
          onContactSearch={onContactSearch}
          contactsLoading={contactsLoading}
          disabled={disabled}
        />
      ) : null}

      {genericPartyKeys.length > 0 && (
        <BatchSection
          title="Parties"
          status={{
            complete: partyMissingCount === 0,
            label: partyMissingCount === 0 ? 'Complete' : `${partyMissingCount} required`,
          }}
          action={applyMenu('parties', genericPartyKeys)}
        >
          <div className={PICKER_GRID}>
            {partySelections.director && (
              <DocumentPartyChoiceList
                id="selected-director"
                label={pickerTitle(repeaterSections, 'selectedDirector') ?? 'Director'}
                options={directors}
                value={configuration.selectedDirectorId ?? ''}
                onChange={(value) => onPatch({ selectedDirectorId: value || null })}
                isLoading={partyLoading}
                error={partyError}
                onRetry={onPartyRetry}
              />
            )}
            {partyCollections.directors && !namedDirectors && directorsPicker}
            {partySelections.shareholder && (
              <DocumentPartyChoiceList
                id="selected-shareholder"
                label={pickerTitle(repeaterSections, 'selectedShareholder') ?? 'Shareholder'}
                options={shareholders}
                value={configuration.selectedShareholderId ?? ''}
                onChange={(value) => onPatch({ selectedShareholderId: value || null })}
                isLoading={partyLoading}
                error={partyError}
                onRetry={onPartyRetry}
              />
            )}
            {partyCollections.shareholders && !namedShareholders && shareholdersPicker}
            {needs.officers && !namedOfficers && officersPicker}
            {partySelections.contact && (
              <DocumentContactChoiceList
                id="selected-contact"
                label={pickerTitle(repeaterSections, 'selectedContact') ?? 'Contact'}
                single
                contacts={contacts}
                selected={selectedContact ? [selectedContact] : []}
                onChange={(selected) => onPatch({ selectedContactId: selected[0]?.id ?? null })}
                onSearch={onContactSearch}
                isLoading={contactsLoading}
                serverFiltered={Boolean(onContactSearch)}
              />
            )}
          </div>
        </BatchSection>
      )}

      {namedPartySections.map((section) => (
        <BatchSection
          key={section.key}
          title={section.title}
          status={{
            complete: section.count > 0,
            label: section.count > 0 ? `${section.count} selected` : '1 required',
          }}
          action={applyMenu(section.title, [section.key])}
        >
          <div className={PICKER_GRID}>{section.picker}</div>
        </BatchSection>
      ))}

      {showContacts && (
        <BatchSection
          title="Contacts"
          status={{
            complete: true,
            label: `${selectedContacts.length} selected`,
          }}
          action={applyMenu('contacts', ['contactIds'])}
        >
          <div className={PICKER_GRID}>
            {shortlistContacts ? (
              <DocumentContactChoiceList
                id="shortlist-contacts"
                contacts={shortlistContacts}
                selected={selectedContacts}
                onChange={(selected) => onPatch({
                  contactIds: selected.map((contact) => contact.id),
                })}
              />
            ) : (
              <DocumentContactChoiceList
                contacts={contacts}
                selected={selectedContacts}
                onChange={(selected) => onPatch({
                  contactIds: selected.map((contact) => contact.id),
                })}
                onSearch={onContactSearch}
                isLoading={contactsLoading}
                serverFiltered={Boolean(onContactSearch)}
              />
            )}
          </div>
        </BatchSection>
      )}

      {contactLists.map((list) => {
        const patchList = (selected: DocumentContact[]) => onPatch({
          selectedContactListIds: {
            ...(configuration.selectedContactListIds ?? {}),
            [list.slug]: selected.map((contact) => contact.id),
          },
        });
        return (
          <BatchSection
            key={list.slug}
            title={list.name}
            status={{ complete: true, label: `${list.selected.length} selected` }}
          >
            <div className={PICKER_GRID}>
              {list.shortlist ? (
                <DocumentContactChoiceList
                  id={`contact-list-${list.slug}`}
                  contacts={list.shortlist}
                  selected={list.selected}
                  onChange={patchList}
                />
              ) : (
                <DocumentContactChoiceList
                  id={`contact-list-${list.slug}`}
                  contacts={contacts}
                  selected={list.selected}
                  onChange={patchList}
                  onSearch={onContactSearch}
                  isLoading={contactsLoading}
                  serverFiltered={Boolean(onContactSearch)}
                />
              )}
            </div>
          </BatchSection>
        );
      })}

      <PersonFieldsSection
        configuration={configuration}
        repeaterSections={repeaterSections}
        fieldTags={templateFieldTags}
        directors={directors}
        shareholders={shareholders}
        officers={officers}
        contactName={contactName}
        customValue={customValue}
        customLabel={customLabel}
        onPatch={onPatch}
        disabled={disabled}
      />

      {masterFields.fields.length > 0 && (
        <BatchSection
          title="Shared values"
          status={requiredSharedFields > 0
            ? {
                complete: sharedMissing === 0,
                label: sharedMissing === 0
                  ? 'Complete'
                  : `${sharedMissing} missing`,
              }
            : null}
        >
          <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {masterFields.fields.map((field) => {
              const hasOverride = Object.prototype.hasOwnProperty.call(
                configuration.masterOverrides,
                field.id,
              );
              const sharedValue = effectiveMasterValues[field.key] ?? '';
              const value = hasOverride
                ? configuration.masterOverrides[field.id]
                : sharedValue;
              const isRequired = field.requiredTemplateIds.includes(item.templateId);
              const missing = isRequired && !value.trim();
              const inputId = `item-shared-${field.id}`;
              return (
                <div
                  key={field.id}
                  className={cn(
                    'rounded-lg border bg-background-primary p-3',
                    missing ? 'border-status-error/50' : 'border-border-primary',
                  )}
                >
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <label htmlFor={inputId} className="text-sm font-medium text-text-primary">
                      {field.label}
                    </label>
                    {isRequired ? (
                      <span className="-ml-1 text-status-error" aria-hidden="true">*</span>
                    ) : null}
                    <span
                      className={cn(
                        'rounded-full px-1.5 py-0.5 text-xs font-medium',
                        hasOverride
                          ? 'bg-oak-primary/10 text-oak-primary'
                          : 'bg-background-tertiary text-text-muted',
                      )}
                    >
                      {hasOverride ? 'Override' : 'Shared'}
                    </span>
                  </div>
                  {field.type === 'date' ? (
                    <SingleDateInput
                      value={value}
                      onChange={(next) => onPatch({
                        masterOverrides: {
                          ...configuration.masterOverrides,
                          [field.id]: next,
                        },
                      })}
                      disabled={disabled || !hasOverride}
                      ariaLabel={field.label}
                      showTodayButton
                      error={missing ? 'Required' : undefined}
                      className="mt-2 w-full"
                    />
                  ) : field.options?.length ? (
                    <SearchableSelect
                      options={field.options.map((option) => ({ value: option, label: option }))}
                      value={value}
                      onChange={(next) => onPatch({
                        masterOverrides: {
                          ...configuration.masterOverrides,
                          [field.id]: next,
                        },
                      })}
                      disabled={disabled || !hasOverride}
                      ariaLabel={field.label}
                      placeholder="Choose..."
                      clearable={!isRequired}
                      error={missing ? 'Required' : undefined}
                      size="md"
                      className="mt-2"
                    />
                  ) : (
                    <input
                      id={inputId}
                      type="text"
                      value={value}
                      readOnly={!hasOverride}
                      disabled={disabled}
                      aria-invalid={missing || undefined}
                      onChange={(event) => onPatch({
                        masterOverrides: {
                          ...configuration.masterOverrides,
                          [field.id]: event.target.value,
                        },
                      })}
                      className={cn(
                        'mt-2 min-h-11 w-full rounded-lg border px-3 text-sm focus:border-oak-primary focus:outline-none focus:ring-2 focus:ring-oak-primary/30 lg:min-h-10',
                        hasOverride
                          ? 'border-border-primary bg-background-primary text-text-primary'
                          : 'border-border-secondary bg-background-secondary text-text-secondary',
                        missing && 'border-status-error/60',
                      )}
                    />
                  )}
                  <div className="mt-2 flex items-center gap-3">
                    {hasOverride ? (
                      <button
                        type="button"
                        onClick={() => {
                          const next = { ...configuration.masterOverrides };
                          delete next[field.id];
                          onPatch({ masterOverrides: next });
                        }}
                        disabled={disabled}
                        className="inline-flex min-h-9 items-center gap-1 text-xs font-medium text-text-secondary transition-colors hover:text-text-primary"
                      >
                        <RotateCcw className="h-3 w-3" aria-hidden="true" />
                        Reset to shared
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onPatch({
                          masterOverrides: {
                            ...configuration.masterOverrides,
                            [field.id]: sharedValue,
                          },
                        })}
                        disabled={disabled}
                        className="inline-flex min-h-9 items-center text-xs font-medium text-oak-primary transition-colors hover:text-oak-dark"
                      >
                        Override for this document
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </BatchSection>
      )}

      <BatchSection
        title="Document fields"
        status={requiredTemplateFields > 0
          ? {
              complete: fieldMissing === 0,
              label: fieldMissing === 0 ? 'Complete' : `${fieldMissing} missing`,
            }
          : null}
      >
        <BatchCustomFieldForm
          item={item}
          fields={templateFields}
          onPatch={onPatch}
          disabled={disabled}
        />
      </BatchSection>

    </div>
  );
}
