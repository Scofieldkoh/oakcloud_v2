'use client';

import { useState } from 'react';
import { Search } from 'lucide-react';
import { FormInput } from '@/components/ui/form-input';
import { InfoTip } from '@/components/ui/info-tip';
import type { OakDocFieldDefinition } from '@/lib/document-editor/oakdoc-fields';
import type { OakDocRepeaterDefinition } from '@/lib/document-editor/oakdoc-repeaters';
import type { OakDocCustomField, OakDocRepeaterSections } from '@/lib/document-editor/oakdoc-custom-fields';
import { OakDocCustomFieldsPanel } from './oakdoc-custom-fields-panel';
import { OakDocFieldList } from './oakdoc-field-list';
import { OakDocRepeaterPanel } from './oakdoc-repeater-panel';

export interface OakDocFieldPanelProps {
  /** Field tags in the document; each shows a dot. */
  presentTags: readonly string[];
  /** Field controls in the document; defaults to the number of distinct tags. */
  fieldCount?: number;
  /** Wrap the selection in, or insert at the caret, a field. */
  onInsert: (field: OakDocFieldDefinition) => void;
  disabled?: boolean;
  customFields: OakDocCustomField[];
  /** Custom fields copied from inserted partials. */
  partialCustomFields?: OakDocCustomField[];
  onCustomFieldsChange: (fields: OakDocCustomField[]) => void;
  /** Where the custom fields are defined, for the help text. */
  ownerLabel?: 'template' | 'partial';
  repeaterTags: readonly string[];
  repeaterCount?: number;
  onAddRepeater: (definition: OakDocRepeaterDefinition) => void;
  onRemoveRepeaterAtCaret: () => void;
  /** Repeater tags lettered (a), (b); with onRepeaterLetteringChange the author can switch it. */
  letteredRepeaterTags?: readonly string[];
  onRepeaterLetteringChange?: (tag: string, lettered: boolean) => void;
  /** Names of sections and pickers on Configure, and contacts shortlists. */
  sections: OakDocRepeaterSections;
  onSectionsChange: (sections: OakDocRepeaterSections) => void;
  /** Templates: a section can make a separate document for each person. */
  allowPerPersonDocuments?: boolean;
}

/**
 * The OakDoc field panel shared by the template and Word partial editors:
 * one search over every field, then custom fields, repeating sections and
 * Oakcloud fields in collapsible groups. Clicking a field opens it with an
 * Add button and its settings; one field is open at a time.
 */
export function OakDocFieldPanel({
  presentTags,
  fieldCount = presentTags.length,
  onInsert,
  disabled = false,
  customFields,
  partialCustomFields = [],
  onCustomFieldsChange,
  ownerLabel = 'template',
  repeaterTags,
  repeaterCount,
  onAddRepeater,
  onRemoveRepeaterAtCaret,
  letteredRepeaterTags,
  onRepeaterLetteringChange,
  sections,
  onSectionsChange,
  allowPerPersonDocuments = false,
}: OakDocFieldPanelProps) {
  const [query, setQuery] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      <div className="space-y-2">
        <div className="flex items-center gap-1 text-text-muted">
          <h2 className="text-xs font-semibold uppercase tracking-wide">Fields</h2>
          <InfoTip
            label="About Fields"
            content="Click a field, then Add to put it at the caret or around the selected text. Double-click adds it at once; drag drops it on the page."
          />
          <span className="ml-auto shrink-0 text-[11px]">{fieldCount} in document</span>
        </div>
        <FormInput
          type="search"
          inputSize="xs"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search fields..."
          aria-label="Search fields"
          leftIcon={<Search className="h-3.5 w-3.5" aria-hidden="true" />}
          className="focus:ring-offset-0"
        />
      </div>

      <OakDocCustomFieldsPanel
        fields={customFields}
        partialFields={partialCustomFields}
        onChange={onCustomFieldsChange}
        onInsert={onInsert}
        presentTags={presentTags}
        disabled={disabled}
        ownerLabel={ownerLabel}
        query={query}
        selectedKey={selectedKey}
        onSelect={setSelectedKey}
      />

      <OakDocRepeaterPanel
        repeaterTags={repeaterTags}
        count={repeaterCount}
        fieldTags={presentTags}
        disabled={disabled}
        onAdd={onAddRepeater}
        onRemoveAtCaret={onRemoveRepeaterAtCaret}
        letteredTags={letteredRepeaterTags}
        onLetteredChange={onRepeaterLetteringChange}
        onAssignField={onInsert}
        sections={sections}
        onSectionsChange={onSectionsChange}
        allowPerPerson={allowPerPersonDocuments}
        customFields={[...customFields, ...partialCustomFields]}
        query={query}
        selectedKey={selectedKey}
        onSelect={setSelectedKey}
      />

      <OakDocFieldList
        presentTags={presentTags}
        onInsert={onInsert}
        disabled={disabled}
        query={query}
        selectedKey={selectedKey}
        onSelect={setSelectedKey}
        sections={sections}
        onSectionsChange={onSectionsChange}
      />
    </div>
  );
}
