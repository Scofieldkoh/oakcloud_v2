'use client';

import { useMemo, useState } from 'react';
import type { TemplateFieldCategory } from '@/components/documents/template-editor/template-field-catalog';
import { CollapsibleSection } from '@/components/ui/collapsible-section';
import { OAKDOC_EDITOR_FIELD_CATEGORIES } from '@/lib/document-editor/oakdoc-field-registry';
import type { OakDocFieldDefinition } from '@/lib/document-editor/oakdoc-fields';
import {
  oakDocPickerKeyOfTag,
  type OakDocPickerKey,
  type OakDocRepeaterSections,
} from '@/lib/document-editor/oakdoc-custom-fields';
import { OakDocConfigureName, OakDocFieldRow } from './oakdoc-field-row';
import { matchesOakDocFieldQuery } from './oakdoc-field-search';

export interface OakDocFieldListProps {
  /** Tags already in the document; each shows a dot. */
  presentTags: readonly string[];
  onInsert: (field: OakDocFieldDefinition) => void;
  disabled?: boolean;
  categories?: readonly Pick<TemplateFieldCategory, 'key' | 'label' | 'fields'>[];
  /** Panel search; a non-empty query opens every group with a match. */
  query?: string;
  /** The open row's key in the panel, `field:<tag>`. */
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  /** Picker names (by picker key); with onSectionsChange the author can name them. */
  sections?: OakDocRepeaterSections;
  onSectionsChange?: (sections: OakDocRepeaterSections) => void;
}

/** What Configure calls each picker when the author gives no name. */
const PICKER_DEFAULT_NAMES: Record<OakDocPickerKey, string> = {
  selectedDirector: 'Director',
  selectedShareholder: 'Shareholder',
  selectedContact: 'Contact',
};

/**
 * Oakcloud fields (company, selected director, shareholder, contact,
 * system) in collapsible groups. Open a field to add it at the caret; a
 * selected-person field also takes the name Configure shows for its picker.
 */
export function OakDocFieldList({
  presentTags,
  onInsert,
  disabled = false,
  categories = OAKDOC_EDITOR_FIELD_CATEGORIES,
  query = '',
  selectedKey,
  onSelect,
  sections,
  onSectionsChange,
}: OakDocFieldListProps) {
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const searching = query.trim() !== '';
  const visible = useMemo(() => categories
    .map((category) => ({
      ...category,
      fields: category.fields.filter((field) => matchesOakDocFieldQuery(query, field.label, field.key, category.label)),
    }))
    .filter((category) => category.fields.length > 0), [categories, query]);

  const setPickerName = (key: OakDocPickerKey, name: string) => {
    if (!sections || !onSectionsChange) return;
    onSectionsChange({ ...sections, names: { ...sections.names, [key]: name } });
  };

  if (visible.length === 0) {
    return <p className="px-1 text-[11px] text-text-muted">No Oakcloud fields match.</p>;
  }

  return (
    <div className="space-y-2">
      {visible.map((category) => {
        const used = category.fields.filter((field) => presentTags.includes(field.key)).length;
        const picker = category.fields.map((field) => oakDocPickerKeyOfTag(field.key)).find(Boolean) ?? null;
        const pickerName = picker ? sections?.names[picker] ?? '' : '';
        const open = searching || (openGroups[category.key] ?? false);
        return (
          <CollapsibleSection
            key={category.key}
            variant="panel"
            title={pickerName ? `${category.label} · ${pickerName}` : category.label}
            count={used > 0 ? used : undefined}
            collapsed={!open}
            onCollapsedChange={(collapsed) => setOpenGroups((current) => ({ ...current, [category.key]: !collapsed }))}
            contentClassName="space-y-0.5"
          >
            {category.fields.map((field) => {
              const definition = { tag: field.key, label: field.label, category: category.label };
              const rowKey = `field:${field.key}`;
              return (
                <OakDocFieldRow
                  key={field.key}
                  field={definition}
                  detail={field.example ? `e.g. ${field.example}` : undefined}
                  present={presentTags.includes(field.key)}
                  selected={selectedKey === rowKey}
                  onSelect={() => onSelect(selectedKey === rowKey ? null : rowKey)}
                  onAdd={onInsert}
                  disabled={disabled}
                >
                  {picker && onSectionsChange ? (
                    <OakDocConfigureName
                      value={pickerName}
                      onChange={(name) => setPickerName(picker, name)}
                      placeholder={PICKER_DEFAULT_NAMES[picker]}
                      hint={`Configure asks for one ${PICKER_DEFAULT_NAMES[picker].toLowerCase()} under this name, for every ${category.label.toLowerCase()} field.`}
                      disabled={disabled}
                    />
                  ) : null}
                </OakDocFieldRow>
              );
            })}
          </CollapsibleSection>
        );
      })}
    </div>
  );
}
