'use client';

import { X } from 'lucide-react';
import { ContactSearchSelect } from '@/components/ui/contact-search-select';
import type { OakDocCustomFieldContact } from '@/lib/document-editor/oakdoc-custom-fields';

export interface OakDocContactShortlistPickerProps {
  contacts: readonly OakDocCustomFieldContact[];
  onChange: (contacts: OakDocCustomFieldContact[]) => void;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
}

/**
 * A shortlist of workspace contacts picked by search and shown as removable
 * chips, in the order added. Used for a Contact custom field's choices and
 * for the contacts repeater's shortlist.
 */
export function OakDocContactShortlistPicker({
  contacts,
  onChange,
  label = 'Contacts to choose from',
  placeholder = 'Search contacts to add...',
  disabled = false,
}: OakDocContactShortlistPickerProps) {
  return (
    <div className="space-y-2">
      <ContactSearchSelect
        label={label}
        value=""
        placeholder={placeholder}
        disabled={disabled}
        onChange={(id, contact) => {
          if (!id || contacts.some((entry) => entry.id === id)) return;
          onChange([...contacts, { id, name: contact?.fullName ?? id }]);
        }}
      />
      {contacts.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Contact shortlist">
          {contacts.map((contact) => (
            <li
              key={contact.id}
              className="inline-flex items-center gap-1 rounded-full border border-border-primary bg-background-secondary py-0.5 pl-2.5 pr-1 text-xs text-text-primary"
            >
              {contact.name}
              <button
                type="button"
                aria-label={`Remove ${contact.name}`}
                disabled={disabled}
                onClick={() => onChange(contacts.filter((entry) => entry.id !== contact.id))}
                className="rounded-full p-0.5 text-text-muted hover:bg-background-tertiary hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
