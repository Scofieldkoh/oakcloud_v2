'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Loader2, Search, UsersRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export interface DocumentContact {
  id: string;
  fullName: string;
  email?: string | null;
  phone?: string | null;
  designation?: string | null;
}

export interface DocumentContactChoiceListProps {
  contacts: DocumentContact[];
  selected: DocumentContact[];
  onChange: (contacts: DocumentContact[]) => void;
  onSearch?: (query: string) => void | Promise<void>;
  isLoading?: boolean;
  /**
   * Set when `contacts` is already the result of a server-side query. Local
   * filtering is then skipped so matches on fields the server searches but the
   * client does not (identification number, UEN) stay visible.
   */
  serverFiltered?: boolean;
  /** Pick one contact (radio buttons) instead of several. */
  single?: boolean;
  /** Heading; defaults to "Contacts". */
  label?: string;
  /** Unique id prefix when several lists share a page. */
  id?: string;
}

function contactMeta(contact: DocumentContact): string[] {
  return [contact.designation, contact.email, contact.phone].filter(
    (item): item is string => Boolean(item),
  );
}

export function DocumentContactChoiceList({
  contacts,
  selected,
  onChange,
  onSearch,
  isLoading = false,
  serverFiltered = false,
  single = false,
  label = 'Contacts',
  id = 'document-contacts',
}: DocumentContactChoiceListProps) {
  const [query, setQuery] = useState('');
  const selectedIds = useMemo(() => new Set(selected.map((contact) => contact.id)), [selected]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleContacts = useMemo(() => {
    if (!normalizedQuery || serverFiltered) return contacts;

    const matching = contacts.filter((contact) =>
      [contact.fullName, ...contactMeta(contact)]
        .some((item) => item.toLocaleLowerCase().includes(normalizedQuery)),
    );
    const selectedOutsideQuery = selected.filter(
      (contact) => !matching.some((item) => item.id === contact.id),
    );
    return [...selectedOutsideQuery, ...matching];
  }, [contacts, normalizedQuery, selected, serverFiltered]);

  const toggleContact = (contact: DocumentContact) => {
    if (single) {
      onChange(selectedIds.has(contact.id) ? [] : [contact]);
      return;
    }
    onChange(
      selectedIds.has(contact.id)
        ? selected.filter((item) => item.id !== contact.id)
        : [...selected, contact],
    );
  };
  const headingId = `${id}-label`;

  return (
    <section className="space-y-2" aria-labelledby={headingId}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 id={headingId} className="text-xs font-medium text-text-secondary">
            {label}
          </h3>
          <p className="text-xs text-text-muted">
            {selected.length === 0
              ? single ? 'No contact selected' : 'No contacts selected'
              : single ? selected[0].fullName : `${selected.length} selected`}
          </p>
        </div>
        {selected.length > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChange([])}
            aria-label={single ? 'Clear the contact' : 'Clear all contacts'}
          >
            {single ? 'Clear' : 'Clear all'}
          </Button>
        ) : null}
      </div>

      <div className="relative max-w-xl">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
        <input
          type="search"
          value={query}
          onChange={(event) => {
            const value = event.target.value;
            setQuery(value);
            void onSearch?.(value);
          }}
          aria-label={`Search ${label.toLocaleLowerCase()}`}
          placeholder="Search contacts..."
          className="min-h-11 w-full rounded-lg border border-border-primary bg-background-elevated py-2 pl-9 pr-4 text-sm text-text-primary placeholder:text-text-muted focus:border-oak-primary focus:outline-none focus:ring-2 focus:ring-oak-primary/30"
        />
      </div>

      {isLoading ? (
        <div className="flex min-h-24 items-center justify-center gap-2 text-sm text-text-muted" role="status">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading contacts...
        </div>
      ) : contacts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border-primary p-4 text-sm text-text-muted">
          {normalizedQuery ? 'No contacts match your search.' : 'No contacts are available.'}
        </div>
      ) : (
        <div className="max-h-[360px] overflow-y-auto rounded-lg border border-border-primary bg-background-primary">
          {visibleContacts.map((contact) => {
            const isSelected = selectedIds.has(contact.id);
            const metadata = contactMeta(contact);
            return (
              <label
                key={contact.id}
                className={cn(
                  'flex min-h-11 cursor-pointer items-start gap-3 border-b border-border-secondary p-3 transition-colors last:border-b-0',
                  'hover:bg-background-secondary focus-within:ring-2 focus-within:ring-inset focus-within:ring-oak-primary/30',
                  isSelected && 'bg-oak-primary/5',
                )}
              >
                <input
                  type={single ? 'radio' : 'checkbox'}
                  name={single ? `${id}-choice` : undefined}
                  checked={isSelected}
                  onChange={() => toggleContact(contact)}
                  aria-label={`Select ${contact.fullName}`}
                  className="mt-1 h-4 w-4 shrink-0 rounded accent-oak-primary"
                />
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-oak-primary/10 text-oak-primary">
                  <UsersRound className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <Link
                    href={`/contacts/${encodeURIComponent(contact.id)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(event) => event.stopPropagation()}
                    aria-label={`Open ${contact.fullName} contact details in a new tab`}
                    className="inline-flex max-w-full items-center gap-1 text-sm font-medium text-oak-primary hover:underline"
                  >
                    <span className="truncate">{contact.fullName}</span>
                    <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  </Link>
                  {metadata.length > 0 ? (
                    <span className="mt-0.5 block truncate text-xs text-text-muted">
                      {metadata.join(' · ')}
                    </span>
                  ) : null}
                </span>
              </label>
            );
          })}
          {visibleContacts.length === 0 ? (
            <div className="p-5 text-center text-sm text-text-muted">
              No contacts match your search.
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
