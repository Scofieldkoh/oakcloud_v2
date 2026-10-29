'use client';

import { useState, type FormEvent } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { FormInput } from '@/components/ui/form-input';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { OakDocContactShortlistPicker } from '@/components/documents/oakdoc/oakdoc-contact-shortlist-picker';
import {
  OAKDOC_CUSTOM_CONTACT_SUBFIELDS,
  OAKDOC_CUSTOM_FIELD_TYPES,
  oakDocCustomFieldKeyFromLabel,
  oakDocCustomFieldTag,
  readPlaceholderOptions,
  type OakDocCustomField,
  type OakDocCustomFieldContact,
  type OakDocCustomFieldType,
} from '@/lib/document-editor/oakdoc-custom-fields';
import type { OakDocFieldDefinition } from '@/lib/document-editor/oakdoc-fields';
import { OAKDOC_FIELD_DRAG_TYPE } from '@/lib/document-editor/oakdoc-field-blocks';
import { cn } from '@/lib/utils';
import { CollapsibleSection } from '@/components/ui/collapsible-section';
import { OakDocFieldRow, keepEditorCaret } from './oakdoc-field-row';
import { matchesOakDocFieldQuery } from './oakdoc-field-search';

export interface OakDocCustomFieldsPanelProps {
  fields: OakDocCustomField[];
  onChange: (fields: OakDocCustomField[]) => void;
  /** Insert a field's control at the caret or around the selection. */
  onInsert: (field: OakDocFieldDefinition) => void;
  /** Tags already in the document. */
  presentTags: readonly string[];
  /** Fields copied from inserted partials; shown so they can be inserted too. */
  partialFields?: OakDocCustomField[];
  disabled?: boolean;
  /** Where the fields are defined, for the help text. */
  ownerLabel?: 'template' | 'partial';
  /** Panel search; only matching fields show while it is set. */
  query?: string;
  /** The open row's key in the panel, `custom:<key>`; uncontrolled when absent. */
  selectedKey?: string | null;
  onSelect?: (key: string | null) => void;
}

const TYPE_LABELS = Object.fromEntries(
  OAKDOC_CUSTOM_FIELD_TYPES.map((type) => [type.value, type.label]),
) as Record<OakDocCustomFieldType, string>;

interface Draft {
  label: string;
  type: OakDocCustomFieldType;
  required: boolean;
  options: string;
  contacts: OakDocCustomFieldContact[];
}

const EMPTY_DRAFT: Draft = { label: '', type: 'text', required: true, options: '', contacts: [] };

function definitionOf(field: OakDocCustomField): OakDocFieldDefinition {
  return {
    tag: oakDocCustomFieldTag(field.key),
    label: field.label,
    category: 'Custom fields',
    ...(field.type === 'date' ? { valueType: 'date' as const } : {}),
  };
}

/** The detail fields a Contact field offers, e.g. `custom.secretary.identificationNumber`. */
function contactDetailDefinitions(field: OakDocCustomField): OakDocFieldDefinition[] {
  return OAKDOC_CUSTOM_CONTACT_SUBFIELDS.map((detail) => ({
    tag: `${oakDocCustomFieldTag(field.key)}.${detail.path}`,
    label: `${field.label} ${detail.label}`,
    category: 'Custom fields',
  }));
}

/**
 * Custom fields of a Word template or partial, as a group of the OakDoc
 * field panel: define them (label, type, required, dropdown choices) and
 * add them to the document. Configure asks for their values when a
 * document is generated.
 */
export function OakDocCustomFieldsPanel({
  fields,
  onChange,
  onInsert,
  presentTags,
  partialFields = [],
  disabled = false,
  ownerLabel = 'template',
  query = '',
  selectedKey: controlledKey,
  onSelect: onSelectKey,
}: OakDocCustomFieldsPanelProps) {
  const [localKey, setLocalKey] = useState<string | null>(null);
  const selectedKey = controlledKey === undefined ? localKey : controlledKey;
  const onSelect = (key: string | null) => {
    if (controlledKey === undefined) setLocalKey(key);
    onSelectKey?.(key);
  };
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);

  const openNew = () => {
    setEditingKey(null);
    setDraft(EMPTY_DRAFT);
    setError(null);
    setDialogOpen(true);
    // The dialog lives in the group, and the new field shows there.
    setOpen(true);
  };

  const openEdit = (field: OakDocCustomField) => {
    setEditingKey(field.key);
    setDraft({
      label: field.label,
      type: field.type,
      required: field.required,
      options: (field.options ?? []).join('\n'),
      contacts: field.contacts ?? [],
    });
    setError(null);
    setDialogOpen(true);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const label = draft.label.trim();
    if (!label) {
      setError('Enter a label.');
      return;
    }
    const options = readPlaceholderOptions(draft.options.split('\n'));
    if (draft.type === 'dropdown' && options.length < 2) {
      setError('List at least two choices, one per line.');
      return;
    }
    if (draft.type === 'contact' && draft.contacts.length === 0) {
      setError('Add at least one contact to choose from.');
      return;
    }
    const taken = new Set([...fields, ...partialFields].map((field) => field.key));
    if (editingKey) taken.delete(editingKey);
    const next: OakDocCustomField = {
      key: editingKey ?? oakDocCustomFieldKeyFromLabel(label, taken),
      label,
      type: draft.type,
      required: draft.required,
      ...(draft.type === 'dropdown' ? { options } : {}),
      ...(draft.type === 'contact' ? { contacts: draft.contacts } : {}),
    };
    onChange(editingKey
      ? fields.map((field) => (field.key === editingKey ? next : field))
      : [...fields, next]);
    setDialogOpen(false);
    // Open the new field so it can be added straight away.
    onSelect(`custom:${next.key}`);
    setOpen(true);
  };

  const remove = (key: string) => {
    onChange(fields.filter((field) => field.key !== key));
  };

  const renderRow = (field: OakDocCustomField, editable: boolean) => {
    const definition = definitionOf(field);
    const rowKey = `custom:${field.key}`;
    return (
      <OakDocFieldRow
        key={field.key}
        field={definition}
        badge={field.required ? <span className="ml-0.5 text-status-error" aria-label="required">*</span> : null}
        detail={`${TYPE_LABELS[field.type]}${field.required ? ' · required' : ''}`
          + (field.type === 'contact' ? ` · ${field.contacts?.length ?? 0} to choose from` : '')
          + (editable ? '' : ' · from a partial')}
        present={presentTags.includes(definition.tag)}
        selected={selectedKey === rowKey}
        onSelect={() => onSelect(selectedKey === rowKey ? null : rowKey)}
        onAdd={onInsert}
        disabled={disabled}
        actions={editable ? (
          <>
            <Button
              variant="ghost"
              size="xs"
              iconOnly
              aria-label={`Edit ${field.label}`}
              disabled={disabled}
              onClick={() => openEdit(field)}
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="xs"
              iconOnly
              aria-label={`Remove ${field.label}`}
              disabled={disabled}
              onClick={() => remove(field.key)}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </>
        ) : null}
      >
        {field.type === 'dropdown' && field.options?.length ? (
          <div className="space-y-1">
            <div className="text-[11px] text-text-muted">Choices</div>
            <ol className="list-decimal space-y-0.5 pl-4 text-[11px] text-text-secondary">
              {field.options.map((option) => <li key={option}>{option}</li>)}
            </ol>
          </div>
        ) : null}
        {field.type === 'contact' ? (
          <div className="space-y-1">
            <div className="text-[11px] text-text-muted">Details of the chosen contact</div>
            <div className="flex flex-wrap gap-1">
              {contactDetailDefinitions(field).map((detail) => (
                <button
                  key={detail.tag}
                  type="button"
                  disabled={disabled}
                  draggable={!disabled}
                  onPointerDown={keepEditorCaret}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = 'copy';
                    event.dataTransfer.setData(OAKDOC_FIELD_DRAG_TYPE, JSON.stringify(detail));
                  }}
                  onClick={() => onInsert(detail)}
                  title={`Add ${detail.tag}`}
                  aria-label={`Add ${detail.label}`}
                  className={cn(
                    'inline-flex items-center gap-0.5 rounded border bg-background-primary px-1.5 py-0.5 text-[11px] text-text-secondary transition-colors hover:border-oak-primary/30 hover:bg-oak-primary/5 disabled:cursor-not-allowed disabled:opacity-40',
                    presentTags.includes(detail.tag) ? 'border-oak-primary/40' : 'border-border-primary',
                  )}
                >
                  <Plus className="h-2.5 w-2.5" aria-hidden="true" />
                  {detail.label.slice(field.label.length + 1)}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </OakDocFieldRow>
    );
  };

  const matches = (field: OakDocCustomField) => matchesOakDocFieldQuery(query, field.label, field.key, 'custom');
  const visibleFields = fields.filter(matches);
  const visiblePartialFields = partialFields.filter(matches);
  const searching = query.trim() !== '';
  if (searching && visibleFields.length === 0 && visiblePartialFields.length === 0) return null;
  const usedCount = [...fields, ...partialFields]
    .filter((field) => presentTags.includes(oakDocCustomFieldTag(field.key))).length;

  return (
    <CollapsibleSection
      variant="panel"
      title="Custom fields"
      count={fields.length + partialFields.length || undefined}
      collapsed={searching ? false : !open}
      onCollapsedChange={(collapsed) => setOpen(!collapsed)}
      action={(
        <Button
          variant="ghost"
          size="xs"
          leftIcon={<Plus className="h-3.5 w-3.5" aria-hidden="true" />}
          disabled={disabled}
          onClick={openNew}
          aria-label="New custom field"
          className="h-6 min-h-0 px-2 text-white hover:bg-white/15 hover:text-white sm:min-h-0"
        >
          New
        </Button>
      )}
      info={`Values typed in when a document is generated, such as a fee or a meeting date, or a contact picked from a shortlist. Save the ${ownerLabel} to keep them.`}
      contentClassName="space-y-0.5"
    >
      {fields.length === 0 && partialFields.length === 0 ? (
        <p className="px-1 text-[11px] text-text-muted">No custom fields yet. Use New to add one.</p>
      ) : null}
      {visibleFields.map((field) => renderRow(field, true))}
      {visiblePartialFields.length > 0 ? (
        <>
          <h3 className="px-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
            From inserted partials
          </h3>
          {visiblePartialFields.map((field) => renderRow(field, false))}
        </>
      ) : null}
      {usedCount === 0 && fields.length > 0 && !searching ? (
        <p className="px-1 pt-1 text-[11px] text-text-muted">None of these is in the document yet.</p>
      ) : null}

      <Modal
        isOpen={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={editingKey ? 'Edit custom field' : 'Add custom field'}
        size="sm"
      >
        <form onSubmit={submit}>
          <ModalBody className="space-y-4">
            <FormInput
              label="Label"
              value={draft.label}
              onChange={(event) => setDraft({ ...draft, label: event.target.value })}
              hint={editingKey
                ? `Field ${oakDocCustomFieldTag(editingKey)}; renaming the label keeps it.`
                : 'Shown on Configure when the document is generated.'}
              autoFocus
              required
            />
            <SearchableSelect
              label="Type"
              options={OAKDOC_CUSTOM_FIELD_TYPES.map((type) => ({ value: type.value, label: type.label }))}
              value={draft.type}
              onChange={(value) => {
                const type = OAKDOC_CUSTOM_FIELD_TYPES.find((option) => option.value === value);
                if (type) setDraft({ ...draft, type: type.value });
              }}
              clearable={false}
              size="md"
            />
            {draft.type === 'dropdown' ? (
              <label className="block">
                <span className="text-sm font-medium text-text-primary">Choices</span>
                <textarea
                  value={draft.options}
                  onChange={(event) => setDraft({ ...draft, options: event.target.value })}
                  rows={4}
                  placeholder={'One choice per line'}
                  className="mt-1 w-full rounded-lg border border-border-primary bg-background-primary px-3 py-2 text-sm text-text-primary focus:border-oak-primary focus:outline-none focus:ring-2 focus:ring-oak-primary/30"
                />
              </label>
            ) : null}
            {draft.type === 'contact' ? (
              <div className="space-y-2">
                <OakDocContactShortlistPicker
                  contacts={draft.contacts}
                  onChange={(contacts) => setDraft({ ...draft, contacts })}
                />
                <p className="text-xs text-text-secondary">
                  Configure asks to pick one of these. Insert the field for the name, or a detail
                  under it for the ID number, address and so on.
                </p>
              </div>
            ) : null}
            <Checkbox
              label="Required"
              description="Generation waits until a value is entered."
              checked={draft.required}
              onChange={(event) => setDraft({ ...draft, required: event.target.checked })}
              size="sm"
            />
            {error ? <p role="alert" className="text-sm text-status-error">{error}</p> : null}
          </ModalBody>
          <ModalFooter>
            <Button type="button" variant="secondary" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary">
              {editingKey ? 'Save field' : 'Add field'}
            </Button>
          </ModalFooter>
        </form>
      </Modal>
    </CollapsibleSection>
  );
}
