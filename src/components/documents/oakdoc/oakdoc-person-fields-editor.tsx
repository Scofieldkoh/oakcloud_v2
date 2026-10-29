'use client';

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { FormInput } from '@/components/ui/form-input';
import { InfoTip } from '@/components/ui/info-tip';
import { SearchableSelect } from '@/components/ui/searchable-select';
import {
  OAKDOC_PERSON_FIELD_TYPES,
  oakDocCustomFieldKeyFromLabel,
  oakDocPersonFieldTag,
  type OakDocPersonField,
  type OakDocPersonFieldType,
} from '@/lib/document-editor/oakdoc-custom-fields';
import type { OakDocFieldDefinition } from '@/lib/document-editor/oakdoc-fields';
import { OakDocFieldRow, keepEditorCaret } from './oakdoc-field-row';

export interface OakDocPersonFieldsEditorProps {
  /** The section's repeater tag. */
  tag: string;
  /** "Transferor", "Director": whom each value is for. */
  itemLabel: string;
  fields: readonly OakDocPersonField[];
  onChange: (fields: OakDocPersonField[]) => void;
  /** Custom fields a number or amount can be required to add up to. */
  customFields: ReadonlyArray<{ key: string; label: string; type: string }>;
  fieldTags: readonly string[];
  onAssignField: (field: OakDocFieldDefinition) => void;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  disabled?: boolean;
}

const NO_TOTAL = '';

function fieldDefinition(field: OakDocPersonField, itemLabel: string): OakDocFieldDefinition {
  return {
    tag: oakDocPersonFieldTag(field.key),
    label: field.label,
    category: `Per ${itemLabel.toLowerCase()}`,
    ...(field.type === 'date' ? { valueType: 'date' as const } : {}),
  };
}

/**
 * A section's per-person fields: values Configure asks for each person the
 * section lists (each transferor's shares, each certificate's number), put
 * in the repeated text like any field. A number or amount can be required
 * to add up to one of the document's custom fields.
 */
export function OakDocPersonFieldsEditor({
  tag,
  itemLabel,
  fields,
  onChange,
  customFields,
  fieldTags,
  onAssignField,
  selectedKey,
  onSelect,
  disabled = false,
}: OakDocPersonFieldsEditorProps) {
  const [label, setLabel] = useState('');
  const [type, setType] = useState<OakDocPersonFieldType>('number');
  const [totalOf, setTotalOf] = useState(NO_TOTAL);
  const [required, setRequired] = useState(true);
  const numeric = type === 'number' || type === 'currency';
  const totalChoices = customFields.filter((field) => field.type === 'number' || field.type === 'currency');

  const add = () => {
    const trimmed = label.trim();
    if (!trimmed) return;
    const key = oakDocCustomFieldKeyFromLabel(trimmed, new Set(fields.map((field) => field.key)));
    onChange([...fields, {
      key,
      label: trimmed,
      type,
      required,
      ...(numeric && totalOf ? { totalOf } : {}),
    }]);
    setLabel('');
    setTotalOf(NO_TOTAL);
    onSelect(`person:${tag}:${key}`);
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1 text-text-muted">
        <div className="text-[11px] font-semibold uppercase tracking-wide">Per-person fields</div>
        <InfoTip
          label="About per-person fields"
          content={`Configure asks for a value for each ${itemLabel.toLowerCase()} listed, such as the shares each one transfers. Add the field inside the repeated paragraph or row.`}
        />
      </div>
      {fields.map((field) => {
        const rowKey = `person:${tag}:${field.key}`;
        const total = field.totalOf ? customFields.find((custom) => custom.key === field.totalOf)?.label ?? field.totalOf : null;
        return (
          <OakDocFieldRow
            key={field.key}
            field={fieldDefinition(field, itemLabel)}
            detail={`${OAKDOC_PERSON_FIELD_TYPES.find((entry) => entry.value === field.type)?.label ?? 'Text'}`
              + `${field.required ? ' · required' : ''}${total ? ` · adds up to ${total}` : ''}`}
            present={fieldTags.includes(oakDocPersonFieldTag(field.key))}
            selected={selectedKey === rowKey}
            onSelect={() => onSelect(selectedKey === rowKey ? null : rowKey)}
            onAdd={onAssignField}
            disabled={disabled}
            actions={(
              <Button
                variant="ghost"
                size="xs"
                disabled={disabled}
                onPointerDown={keepEditorCaret}
                onClick={() => onChange(fields.filter((entry) => entry.key !== field.key))}
                leftIcon={<Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
                aria-label={`Remove ${field.label}`}
              >
                Remove
              </Button>
            )}
          />
        );
      })}
      <div className="space-y-2 rounded-md border border-dashed border-border-primary p-2">
        <FormInput
          label="New per-person field"
          inputSize="xs"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="e.g. Number of shares"
          disabled={disabled}
        />
        <SearchableSelect
          label="Type"
          options={OAKDOC_PERSON_FIELD_TYPES.map((entry) => ({ value: entry.value, label: entry.label }))}
          value={type}
          onChange={(next) => setType((next || 'text') as OakDocPersonFieldType)}
          disabled={disabled}
          clearable={false}
          showKeyboardHints={false}
          size="sm"
        />
        {numeric ? (
          <SearchableSelect
            label="Must add up to"
            options={[
              { value: NO_TOTAL, label: 'No total' },
              ...totalChoices.map((field) => ({ value: field.key, label: field.label })),
            ]}
            value={totalOf}
            onChange={(next) => setTotalOf(next ?? NO_TOTAL)}
            disabled={disabled || totalChoices.length === 0}
            clearable={false}
            showKeyboardHints={false}
            size="sm"
          />
        ) : null}
        <Checkbox
          size="sm"
          label="Required"
          checked={required}
          onChange={(event) => setRequired(event.target.checked)}
          disabled={disabled}
        />
        <Button
          variant="secondary"
          size="xs"
          disabled={disabled || !label.trim()}
          onPointerDown={keepEditorCaret}
          onClick={add}
          leftIcon={<Plus className="h-3.5 w-3.5" aria-hidden="true" />}
        >
          Add per-person field
        </Button>
      </div>
    </div>
  );
}
