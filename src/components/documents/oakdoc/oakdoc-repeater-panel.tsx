'use client';

import { useId, useState } from 'react';
import { Repeat, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CollapsibleSection } from '@/components/ui/collapsible-section';
import { InfoTip } from '@/components/ui/info-tip';
import { Toggle } from '@/components/ui/toggle';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { OakDocContactShortlistPicker } from '@/components/documents/oakdoc/oakdoc-contact-shortlist-picker';
import {
  OAKDOC_REPEATER_DEFINITIONS,
  type OakDocRepeaterDefinition,
} from '@/lib/document-editor/oakdoc-repeaters';
import {
  OAKDOC_CONTACTS_REPEATER_TAG,
  OAKDOC_OFFICERS_REPEATER_TAG,
  OAKDOC_OFFICER_ROLE_FILTERS,
  canOakDocRepeaterSplitDocuments,
  formatOakDocOfficerRoles,
  isOakDocContactsRepeaterTag,
  oakDocContactListNameFromSlug,
  oakDocContactListSlug,
  oakDocContactsRepeaterDefinition,
  oakDocOfficersRepeaterDefinition,
  oakDocRepeaterDefinitionForTag,
  parseOakDocContactListSlug,
  parseOakDocOfficerRepeaterRoles,
  type OakDocGenericRepeaterKind,
} from '@/lib/document-editor/oakdoc-repeater-definitions';
import type { OakDocFieldDefinition } from '@/lib/document-editor/oakdoc-fields';
import {
  normalizeOakDocRepeaterName,
  type OakDocCustomFieldContact,
  type OakDocPersonField,
  type OakDocRepeaterSections,
} from '@/lib/document-editor/oakdoc-custom-fields';
import { cn } from '@/lib/utils';
import { OakDocConfigureName, OakDocFieldRow, keepEditorCaret } from './oakdoc-field-row';
import { matchesOakDocFieldQuery } from './oakdoc-field-search';
import { OakDocPersonFieldsEditor } from './oakdoc-person-fields-editor';

export interface OakDocRepeaterPanelProps {
  /** Repeater tags in the document, one per repeating section. */
  repeaterTags: readonly string[];
  /** Repeating sections in the document; defaults to the number of distinct tags. */
  count?: number;
  /** Field tags in the document; each shows a dot. */
  fieldTags: readonly string[];
  disabled?: boolean;
  onAdd: (definition: OakDocRepeaterDefinition) => void;
  onRemoveAtCaret: () => void;
  onAssignField: (field: OakDocFieldDefinition) => void;
  /** Tags of sections lettered (a), (b); with onLetteredChange the author can switch it. */
  letteredTags?: readonly string[];
  onLetteredChange?: (tag: string, lettered: boolean) => void;
  /**
   * Names of the document's sections and shortlists of its contacts lists;
   * with onSectionsChange the author can name sections and edit shortlists.
   */
  sections?: OakDocRepeaterSections;
  onSectionsChange?: (sections: OakDocRepeaterSections) => void;
  /**
   * Templates: with onSectionsChange, a directors, shareholders, officers or
   * contacts section can be switched to make a separate document per person.
   */
  allowPerPerson?: boolean;
  /**
   * The document's custom fields, which a per-person number or amount can be
   * required to add up to (per-person fields need onSectionsChange).
   */
  customFields?: ReadonlyArray<{ key: string; label: string; type: string }>;
  /** Panel search; matching section fields show while it is set. */
  query?: string;
  /**
   * The open row's key in the panel: `section:<tag>` for a section in the
   * document, `kind:<tag>` for a new one, `item:<tag>:<field>` for a field.
   * Uncontrolled when absent.
   */
  selectedKey?: string | null;
  onSelect?: (key: string | null) => void;
}

const NO_SECTIONS: OakDocRepeaterSections = { names: {}, shortlists: {} };

/** Who each kind of section repeats for, shown when a new one is opened. */
const KIND_HINTS: Record<OakDocGenericRepeaterKind, string> = {
  directors: 'Repeats for each director ticked on Configure.',
  shareholders: 'Repeats for each shareholder ticked on Configure.',
  contacts: 'Repeats for each contact picked on Configure. Name it to keep it a separate list with its own shortlist.',
  officers: 'Repeats for each officer ticked on Configure, of any role or only the roles chosen here.',
  signers: 'Service agreements: repeats for each signer.',
  authorisedRepresentatives: 'Service agreements: repeats for each authorised representative.',
  agreementEntities: 'Service agreements: repeats for each entity in the agreement.',
};

/** True when a tag in the document is this definition's repeater (an officers one with any roles). */
function usesDefinition(tags: readonly string[], definition: OakDocRepeaterDefinition): boolean {
  return tags.some((tag) => oakDocRepeaterDefinitionForTag(tag)?.tag === definition.tag);
}

/** What a section is, from its tag: "Officers (Secretary)", "Contacts list". */
function sectionKindLabel(tag: string, definition: OakDocRepeaterDefinition): string {
  if (parseOakDocContactListSlug(tag)) return `${definition.label} list`;
  const roles = parseOakDocOfficerRepeaterRoles(tag);
  if (roles !== null) return `${definition.label} (${formatOakDocOfficerRoles(roles) || 'any role'})`;
  return definition.label;
}

/**
 * Repeating sections (directors, officers, shareholders, contacts...) as a
 * group of the OakDoc field panel. Open a section in the document for its
 * Configure name, shortlist and fields, or open a kind to name a new
 * section and make the paragraph or table row at the caret repeat.
 * Shared by the template editor and the Word partial editor.
 */
export function OakDocRepeaterPanel({
  repeaterTags,
  count = repeaterTags.length,
  fieldTags,
  disabled = false,
  onAdd,
  onRemoveAtCaret,
  onAssignField,
  letteredTags = [],
  onLetteredChange,
  sections = NO_SECTIONS,
  onSectionsChange,
  allowPerPerson = false,
  customFields = [],
  query = '',
  selectedKey: controlledKey,
  onSelect,
}: OakDocRepeaterPanelProps) {
  const [localKey, setLocalKey] = useState<string | null>(null);
  const selectedKey = controlledKey === undefined ? localKey : controlledKey;
  const select = (key: string | null) => {
    if (controlledKey === undefined) setLocalKey(key);
    onSelect?.(key);
  };
  const toggle = (key: string) => select(selectedKey === key ? null : key);
  const [open, setOpen] = useState(false);
  // Roles the next Officers section is limited to; none means any role.
  const [officerRoles, setOfficerRoles] = useState<string[]>([]);
  // Name of the next section inserted; a named Contacts section is its own list.
  const [newName, setNewName] = useState('');
  // Contacts the next Contacts section offers on Configure; none means any contact.
  const [newShortlist, setNewShortlist] = useState<OakDocCustomFieldContact[]>([]);
  const [shortlistTag, setShortlistTag] = useState<string | null>(null);
  const rolesLabelId = useId();
  const toggleOfficerRole = (role: string) => setOfficerRoles((current) => (
    current.includes(role) ? current.filter((entry) => entry !== role) : [...current, role]
  ));
  const canName = Boolean(onSectionsChange);
  const pendingName = canName ? normalizeOakDocRepeaterName(newName) : '';
  const contactListUnnamed = pendingName !== '' && oakDocContactListSlug(pendingName) === '';
  const usedTags = Array.from(new Set(repeaterTags));
  const searching = query.trim() !== '';

  const nameOf = (tag: string): string => {
    const slug = parseOakDocContactListSlug(tag);
    return sections.names[tag] ?? (slug ? oakDocContactListNameFromSlug(slug) : '');
  };
  const setName = (tag: string, name: string) => onSectionsChange?.({
    ...sections,
    names: { ...sections.names, [tag]: name },
  });
  const setPerPerson = (tag: string, perPerson: boolean) => onSectionsChange?.({
    ...sections,
    perPersonTag: perPerson ? tag : sections.perPersonTag === tag ? null : sections.perPersonTag ?? null,
  });
  const setPersonFields = (tag: string, fields: OakDocPersonField[]) => onSectionsChange?.({
    ...sections,
    personFields: { ...(sections.personFields ?? {}), [tag]: fields },
  });
  const setShortlist = (tag: string, contacts: OakDocCustomFieldContact[]) => onSectionsChange?.({
    ...sections,
    shortlists: { ...sections.shortlists, [tag]: contacts },
  });
  const definitionToInsert = (base: OakDocRepeaterDefinition): OakDocRepeaterDefinition => (
    base.tag === OAKDOC_OFFICERS_REPEATER_TAG
      ? oakDocOfficersRepeaterDefinition(officerRoles)
      : base.tag === OAKDOC_CONTACTS_REPEATER_TAG
        ? oakDocContactsRepeaterDefinition(pendingName)
        : base
  );
  const insert = (definition: OakDocRepeaterDefinition) => {
    // A named list keeps its first name when the same name is inserted again.
    const keepName = parseOakDocContactListSlug(definition.tag) && sections.names[definition.tag];
    const name = pendingName && !keepName ? pendingName : null;
    const contacts = isOakDocContactsRepeaterTag(definition.tag) && newShortlist.length > 0 ? newShortlist : null;
    if (name !== null || contacts !== null) {
      onSectionsChange?.({
        ...sections,
        names: name !== null ? { ...sections.names, [definition.tag]: name } : sections.names,
        shortlists: contacts !== null ? { ...sections.shortlists, [definition.tag]: contacts } : sections.shortlists,
      });
    }
    setNewName('');
    if (contacts !== null) setNewShortlist([]);
    onAdd(definition);
    // Open the new section, for its fields and shortlist.
    select(`section:${definition.tag}`);
  };
  const shortlist = shortlistTag ? sections.shortlists[shortlistTag] ?? [] : [];
  const shortlistName = shortlistTag ? nameOf(shortlistTag) : '';

  const itemFieldRows = (sectionKey: string, definition: OakDocRepeaterDefinition, fields = definition.fields) => fields.map((field) => {
    const rowKey = `item:${sectionKey}:${field.tag}`;
    return (
      <OakDocFieldRow
        key={field.tag}
        field={field}
        detail={`Inside the ${definition.label.toLowerCase()} section · e.g. ${field.example}`}
        present={fieldTags.includes(field.tag)}
        selected={selectedKey === rowKey}
        onSelect={() => toggle(rowKey)}
        onAdd={onAssignField}
        disabled={disabled}
      />
    );
  });

  // While searching, list the matching fields of the sections in the document.
  const searchResults = searching
    ? OAKDOC_REPEATER_DEFINITIONS
      .filter((definition) => usesDefinition(repeaterTags, definition))
      .map((definition) => ({
        definition,
        fields: definition.fields.filter((field) => matchesOakDocFieldQuery(
          query, field.label, field.tag, definition.label, definition.itemLabel,
        )),
      }))
      .filter((entry) => entry.fields.length > 0)
    : [];
  if (searching && searchResults.length === 0) return null;

  return (
    <CollapsibleSection
      variant="panel"
      title="Repeating sections"
      count={count || undefined}
      collapsed={searching ? false : !open}
      onCollapsedChange={(collapsed) => setOpen(!collapsed)}
      info="A paragraph or table row printed once for each director, shareholder, contact or officer chosen on Configure."
      contentClassName="space-y-3"
    >
      {searching ? (
        <div className="space-y-0.5">
          {searchResults.map(({ definition, fields }) => itemFieldRows(definition.tag, definition, fields))}
        </div>
      ) : (
        <>
          {usedTags.length > 0 ? (
            <div className="space-y-1">
              <h3 className="px-1 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                In this document
              </h3>
              {OAKDOC_REPEATER_DEFINITIONS
                .filter((definition) => usesDefinition(repeaterTags, definition))
                .map((definition) => (
                  <ul key={definition.tag} className="space-y-1" aria-label={`${definition.label} sections`}>
                    {usedTags
                      .filter((tag) => oakDocRepeaterDefinitionForTag(tag)?.tag === definition.tag)
                      .map((tag) => {
                        const kindLabel = sectionKindLabel(tag, definition);
                        const name = nameOf(tag);
                        const rowKey = `section:${tag}`;
                        const selected = selectedKey === rowKey
                          || Boolean(selectedKey?.startsWith(`item:${tag}:`))
                          || Boolean(selectedKey?.startsWith(`person:${tag}:`));
                        const listShortlist = sections.shortlists[tag] ?? [];
                        return (
                          <li
                            key={tag}
                            className={cn(
                              'rounded-md border transition-colors',
                              selected ? 'border-oak-primary/40 bg-oak-primary/5' : 'border-border-primary bg-background-primary',
                            )}
                          >
                            <button
                              type="button"
                              aria-expanded={selected}
                              onPointerDown={keepEditorCaret}
                              onClick={() => toggle(rowKey)}
                              className="flex w-full items-start gap-2 px-2.5 py-1.5 text-left [&>svg]:mt-0.5"
                            >
                              <Repeat className="h-3.5 w-3.5 shrink-0 text-oak-primary" aria-hidden="true" />
                              <span className="min-w-0 text-xs font-medium text-text-primary">
                                {name ? `${name} · ${kindLabel}` : kindLabel}
                                {sections.perPersonTag === tag ? ' · one document each' : ''}
                              </span>
                            </button>
                            {selected ? (
                              <div className="space-y-2 px-2.5 pb-2.5">
                                <code className="block break-all text-[11px] text-text-muted">{tag}</code>
                                {canName && tag !== OAKDOC_CONTACTS_REPEATER_TAG ? (
                                  <OakDocConfigureName
                                    value={sections.names[tag] ?? ''}
                                    onChange={(value) => setName(tag, value)}
                                    placeholder={parseOakDocContactListSlug(tag) ? name : kindLabel}
                                    disabled={disabled}
                                  />
                                ) : null}
                                {canName && isOakDocContactsRepeaterTag(tag) ? (
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-[11px] leading-relaxed text-text-secondary">
                                      {listShortlist.length === 0
                                        ? 'Configure offers any contact.'
                                        : `Configure offers ${listShortlist.length} shortlisted contact${listShortlist.length === 1 ? '' : 's'}.`}
                                    </span>
                                    <Button
                                      variant="secondary"
                                      size="xs"
                                      disabled={disabled}
                                      aria-label={tag === OAKDOC_CONTACTS_REPEATER_TAG ? undefined : `Shortlist for ${name}`}
                                      onClick={() => setShortlistTag(tag)}
                                    >
                                      Shortlist
                                    </Button>
                                  </div>
                                ) : null}
                                {canName && allowPerPerson && canOakDocRepeaterSplitDocuments(tag) ? (
                                  <div className="flex items-center gap-1 text-text-muted">
                                    <Toggle
                                      size="sm"
                                      label="Separate document for each person"
                                      checked={sections.perPersonTag === tag}
                                      onChange={(perPerson) => setPerPerson(tag, perPerson)}
                                      disabled={disabled}
                                      className="min-w-0 flex-1"
                                    />
                                    <InfoTip
                                      label="About separate documents"
                                      content="Configure makes one document for each person picked, and this section prints only that person. One section per template can do this; turning it on here turns it off elsewhere."
                                    />
                                  </div>
                                ) : null}
                                {onLetteredChange ? (
                                  <div className="flex items-center gap-1 text-text-muted">
                                    <Toggle
                                      size="sm"
                                      label="Letter each one (a), (b)"
                                      checked={letteredTags.includes(tag)}
                                      onChange={(lettered) => onLetteredChange(tag, lettered)}
                                      disabled={disabled}
                                      className="min-w-0 flex-1"
                                    />
                                    <InfoTip
                                      label="About lettering"
                                      content="When two or more are listed, each copy opens with (a), (b)... and its text moves one indent in. One alone prints without a letter."
                                    />
                                  </div>
                                ) : null}
                                <div className="space-y-0.5">
                                  <div className="flex items-center gap-1 text-text-muted">
                                    <div className="text-[11px] font-semibold uppercase tracking-wide">
                                      {definition.itemLabel} fields
                                    </div>
                                    <InfoTip
                                      label={`About ${definition.itemLabel} fields`}
                                      content="Add them inside the repeated paragraph or row."
                                    />
                                  </div>
                                  {itemFieldRows(tag, definition)}
                                </div>
                                {canName && canOakDocRepeaterSplitDocuments(tag) ? (
                                  <OakDocPersonFieldsEditor
                                    tag={tag}
                                    itemLabel={name || definition.itemLabel}
                                    fields={sections.personFields?.[tag] ?? []}
                                    onChange={(fields) => setPersonFields(tag, fields)}
                                    customFields={customFields}
                                    fieldTags={fieldTags}
                                    onAssignField={onAssignField}
                                    selectedKey={selectedKey}
                                    onSelect={(key) => select(key ?? rowKey)}
                                    disabled={disabled}
                                  />
                                ) : null}
                              </div>
                            ) : null}
                          </li>
                        );
                      })}
                  </ul>
                ))}
              <Button
                variant="ghost"
                size="xs"
                disabled={disabled}
                onPointerDown={keepEditorCaret}
                onClick={onRemoveAtCaret}
                leftIcon={<Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
              >
                Remove section at caret
              </Button>
            </div>
          ) : null}

          <div className="space-y-1">
            <div className="flex items-center gap-1 px-1 text-text-muted">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide">New section</h3>
              <InfoTip
                label="About New section"
                content="Put the caret in the paragraph or table row to repeat, then choose who it repeats for."
              />
            </div>
            {OAKDOC_REPEATER_DEFINITIONS.map((base) => {
              const rowKey = `kind:${base.tag}`;
              const selected = selectedKey === rowKey;
              const definition = definitionToInsert(base);
              const isContacts = base.tag === OAKDOC_CONTACTS_REPEATER_TAG;
              return (
                <div
                  key={base.tag}
                  className={cn(
                    'rounded-md border transition-colors',
                    selected ? 'border-oak-primary/40 bg-oak-primary/5' : 'border-transparent hover:bg-oak-primary/5',
                  )}
                >
                  {/* Clicks on the row's empty space open it too; the label button is the keyboard control. */}
                  <div
                    onPointerDown={keepEditorCaret}
                    onClick={(event) => {
                      if (!disabled && event.target === event.currentTarget) toggle(rowKey);
                    }}
                    className="flex cursor-pointer items-center gap-1 pr-2.5 text-text-muted"
                  >
                    <button
                      type="button"
                      aria-expanded={selected}
                      disabled={disabled}
                      onPointerDown={keepEditorCaret}
                      onClick={() => toggle(rowKey)}
                      className="min-w-0 py-1.5 pl-2.5 text-left text-xs font-medium text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {base.label}
                    </button>
                    <InfoTip label={`About ${base.label}`} content={KIND_HINTS[base.kind]} />
                    {usesDefinition(repeaterTags, base) ? (
                      <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-oak-primary" title="Used in this document" />
                    ) : null}
                  </div>
                  {selected ? (
                    <div className="space-y-2 px-2.5 pb-2.5">
                      {canName ? (
                        <OakDocConfigureName
                          label={isContacts ? 'List name on Configure' : 'Name on Configure'}
                          value={newName}
                          onChange={setNewName}
                          placeholder={isContacts ? 'e.g. Corporate secretary to be appointed' : 'e.g. Signers for the resolution(s)'}
                          error={isContacts && contactListUnnamed ? 'A Contacts list name needs letters or numbers.' : undefined}
                          disabled={disabled}
                        />
                      ) : null}
                      {base.tag === OAKDOC_OFFICERS_REPEATER_TAG ? (
                        <div role="group" aria-labelledby={rolesLabelId} className="space-y-1">
                          <div className="flex items-center gap-1 text-text-muted">
                            <div id={rolesLabelId} className="text-xs font-medium text-text-secondary">
                              Officer roles
                            </div>
                            <InfoTip label="About Officer roles" content="None ticked lists officers of any role." />
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {OAKDOC_OFFICER_ROLE_FILTERS.map((entry) => {
                              const pressed = officerRoles.includes(entry.role);
                              return (
                                <button
                                  key={entry.role}
                                  type="button"
                                  aria-pressed={pressed}
                                  disabled={disabled}
                                  onPointerDown={keepEditorCaret}
                                  onClick={() => toggleOfficerRole(entry.role)}
                                  className={cn(
                                    'rounded border px-1.5 py-0.5 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                                    pressed
                                      ? 'border-oak-primary bg-oak-primary/10 text-oak-primary'
                                      : 'border-border-primary bg-background-primary text-text-secondary hover:border-oak-primary/30 hover:bg-oak-primary/5',
                                  )}
                                >
                                  {entry.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}
                      {isContacts && canName ? (
                        <div className="space-y-1">
                          <OakDocContactShortlistPicker
                            contacts={newShortlist}
                            onChange={setNewShortlist}
                            label="Shortlist (optional)"
                            disabled={disabled}
                          />
                          <p className="text-[11px] leading-relaxed text-text-muted">
                            {newShortlist.length === 0
                              ? 'Empty: Configure searches every contact. Add contacts to offer only them.'
                              : `Configure offers only these ${newShortlist.length} contact${newShortlist.length === 1 ? '' : 's'}.`}
                          </p>
                        </div>
                      ) : null}
                      <code className="block break-all text-[11px] text-text-muted">{definition.tag}</code>
                      <Button
                        variant="primary"
                        size="xs"
                        disabled={disabled || (isContacts && contactListUnnamed)}
                        onPointerDown={keepEditorCaret}
                        onClick={() => insert(definition)}
                        leftIcon={<Repeat className="h-3.5 w-3.5" aria-hidden="true" />}
                        aria-label={`Add ${definition.label} section`}
                      >
                        Repeat at caret
                      </Button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </>
      )}

      {onSectionsChange ? (
        <Modal
          isOpen={shortlistTag !== null}
          onClose={() => setShortlistTag(null)}
          title={shortlistName ? `${shortlistName} shortlist` : 'Contacts shortlist'}
          size="sm"
        >
          <ModalBody className="space-y-3">
            <OakDocContactShortlistPicker
              contacts={shortlist}
              onChange={(contacts) => {
                if (shortlistTag) setShortlist(shortlistTag, contacts);
              }}
              label="Contacts Configure offers"
            />
            <p className="text-xs text-text-secondary">
              Configure lists only these contacts for this Contacts section, to tick the ones
              the document names. Leave it empty to search every contact.
            </p>
          </ModalBody>
          <ModalFooter>
            <Button type="button" variant="primary" onClick={() => setShortlistTag(null)}>Done</Button>
          </ModalFooter>
        </Modal>
      ) : null}
    </CollapsibleSection>
  );
}
