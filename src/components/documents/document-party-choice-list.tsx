'use client';

import { useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ExternalLink, Loader2, RefreshCw, Search, UserRound } from 'lucide-react';
import type { DocumentParty } from '@/lib/document-party';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface DocumentPartyChoiceListBaseProps {
  id: string;
  label: string;
  options: DocumentParty[];
  isLoading: boolean;
  error?: string | null;
  onRetry?: () => void;
  required?: boolean;
  /**
   * Content at the end of an option's row, outside its label so using it
   * never ticks the option (an officer's role, for one). It sits within the
   * row's height, so every row stays the same height.
   */
  renderOptionAction?: (option: DocumentParty, selected: boolean) => ReactNode;
}

interface SinglePartyChoiceListProps extends DocumentPartyChoiceListBaseProps {
  multiple?: false;
  value: string;
  onChange: (value: string) => void;
}

interface MultiplePartyChoiceListProps extends DocumentPartyChoiceListBaseProps {
  multiple: true;
  values: string[];
  onChange: (values: string[]) => void;
}

export type DocumentPartyChoiceListProps =
  | SinglePartyChoiceListProps
  | MultiplePartyChoiceListProps;

function partyMeta(option: DocumentParty): string[] {
  return [option.detail, option.email, option.phone].filter(
    (item): item is string => Boolean(item),
  );
}

export function DocumentPartyChoiceList(props: DocumentPartyChoiceListProps) {
  const {
    id,
    label,
    options,
    isLoading,
    error,
    onRetry,
    required = false,
    renderOptionAction,
  } = props;
  const multiple = props.multiple === true;
  const selectedValueList = multiple ? props.values : undefined;
  const selectedValue = multiple ? undefined : props.value;
  const selectedValues = useMemo(
    () => selectedValueList ?? (selectedValue === undefined ? [] : [selectedValue]),
    [selectedValueList, selectedValue],
  );
  const selectedValueSet = useMemo(() => new Set(selectedValues), [selectedValues]);
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleOptions = useMemo(() => {
    if (!normalizedQuery) return options;

    const matching = options.filter((option) =>
      [option.name, ...partyMeta(option)]
        .some((item) => item.toLocaleLowerCase().includes(normalizedQuery)),
    );
    const selected = options.filter((option) => selectedValueSet.has(option.id));
    const matchingIds = new Set(matching.map((option) => option.id));

    return [
      ...selected.filter((option) => !matchingIds.has(option.id)),
      ...matching,
    ];
  }, [normalizedQuery, options, selectedValueSet]);

  return (
    <fieldset className="space-y-2">
      <legend className="text-xs font-medium text-text-secondary">
        {label}
        {required ? <span className="ml-1 text-status-error" aria-hidden="true">*</span> : null}
      </legend>

      {isLoading ? (
        <div className="flex min-h-11 items-center gap-2 text-sm text-text-muted" role="status">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading {label.toLocaleLowerCase()} options...
        </div>
      ) : error ? (
        <div className="flex min-h-11 flex-wrap items-center gap-3 rounded-lg border border-status-error/25 bg-status-error/5 p-3" role="alert">
          <p className="text-sm text-status-error">{error}</p>
          {onRetry ? (
            <Button variant="secondary" size="sm" onClick={onRetry} aria-label="Retry party options">
              <RefreshCw className="h-4 w-4" />
              Retry
            </Button>
          ) : null}
        </div>
      ) : options.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border-primary p-4 text-sm text-text-muted">
          No {label.toLocaleLowerCase()} options are available for this company.
        </div>
      ) : (
        <>
          <div className="relative max-w-xl">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <input
              id={`${id}-search`}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label={`Search ${label.toLocaleLowerCase()}`}
              placeholder={`Search ${label.toLocaleLowerCase()}...`}
              className="min-h-11 w-full rounded-lg border border-border-primary bg-background-elevated py-2 pl-9 pr-4 text-sm text-text-primary placeholder:text-text-muted focus:border-oak-primary focus:outline-none focus:ring-2 focus:ring-oak-primary/30"
            />
          </div>

          <div className="max-h-[360px] overflow-y-auto rounded-lg border border-border-primary bg-background-primary">
            {visibleOptions.map((option) => {
              const selected = selectedValueSet.has(option.id);
              const metadata = partyMeta(option);
              const action = renderOptionAction?.(option, selected);
              return (
                <div
                  key={option.id}
                  className={cn(
                    'flex items-stretch border-b border-border-secondary transition-colors last:border-b-0',
                    'hover:bg-background-secondary',
                    selected && 'bg-oak-primary/5',
                  )}
                >
                  <label
                    className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-start gap-3 p-3 focus-within:ring-2 focus-within:ring-inset focus-within:ring-oak-primary/30"
                  >
                    <input
                      type={multiple ? 'checkbox' : 'radio'}
                      name={id}
                      value={option.id}
                      checked={selected}
                      onChange={() => {
                        if (!multiple) {
                          props.onChange(option.id);
                          return;
                        }
                        const next = selected
                          ? selectedValues.filter((idValue) => idValue !== option.id)
                          : [...selectedValues, option.id];
                        props.onChange(next);
                      }}
                      required={multiple ? undefined : required}
                      aria-label={`Select ${option.name}`}
                      className="mt-1 h-4 w-4 shrink-0 accent-oak-primary"
                    />
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-oak-primary/10 text-oak-primary">
                      <UserRound className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      {option.contactId ? (
                        <Link
                          href={`/contacts/${encodeURIComponent(option.contactId)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(event) => event.stopPropagation()}
                          aria-label={`Open ${option.name} contact details in a new tab`}
                          className="inline-flex max-w-full items-center gap-1 text-sm font-medium text-oak-primary hover:underline"
                        >
                          <span className="truncate">{option.name}</span>
                          <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        </Link>
                      ) : (
                        <span className="block truncate text-sm font-medium text-text-primary">{option.name}</span>
                      )}
                      {/* The line is kept when empty so every row is the same height. */}
                      <span
                        className="mt-0.5 block truncate text-xs text-text-muted"
                        aria-hidden={metadata.length > 0 ? undefined : true}
                      >
                        {metadata.length > 0 ? metadata.join(' · ') : '\u00a0'}
                      </span>
                    </span>
                  </label>
                  {action ? (
                    <div className="flex shrink-0 items-center pr-3">{action}</div>
                  ) : null}
                </div>
              );
            })}
            {visibleOptions.length === 0 ? (
              <div className="p-5 text-center text-sm text-text-muted">
                No {label.toLocaleLowerCase()} options match your search.
              </div>
            ) : null}
          </div>
        </>
      )}
    </fieldset>
  );
}
