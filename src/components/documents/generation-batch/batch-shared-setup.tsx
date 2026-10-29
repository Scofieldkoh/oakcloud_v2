'use client';

import { useMemo, type ReactNode } from 'react';
import { AlertCircle, Building2, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  AsyncSearchSelect,
  type AsyncSearchSelectOption,
} from '@/components/ui/async-search-select';
import { SingleDateInput } from '@/components/ui/single-date-input';
import { SearchableSelect } from '@/components/ui/searchable-select';
import type {
  MasterFieldCatalogue,
} from '@/types/document-generation-batch';
import type {
  Company,
} from '@/types/document-generation';

export interface BatchSharedSetupProps {
  /** Current server result page, already including the pinned selection. */
  companyOptions: Company[];
  /** Resolved selection, so it renders even when absent from the result page. */
  selectedCompany: Company | null;
  primaryCompanyId: string | null;
  companyQuery: string;
  onCompanyQueryChange: (query: string) => void;
  companyLoading?: boolean;
  companyError?: string | null;
  masterFields: MasterFieldCatalogue;
  masterFieldValues: Record<string, string>;
  onCompanyChange: (companyId: string | null, company: Company | null) => void;
  onMasterValueChange: (fieldId: string, value: string) => void;
  disabled?: boolean;
  overriddenCountByField?: Record<string, number>;
  onSelectOverridden?: (fieldId: string) => void;
  /** Party choices shared by several documents, shown above the shared fields. */
  sharedParties?: ReactNode;
}

function formatDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function BatchSharedSetup({
  companyOptions,
  selectedCompany,
  primaryCompanyId,
  companyQuery,
  onCompanyQueryChange,
  companyLoading = false,
  companyError = null,
  masterFields,
  masterFieldValues,
  onCompanyChange,
  onMasterValueChange,
  disabled = false,
  overriddenCountByField = {},
  onSelectOverridden,
  sharedParties,
}: BatchSharedSetupProps) {
  const options = useMemo<AsyncSearchSelectOption[]>(() => {
    const byId = new Map<string, AsyncSearchSelectOption>();
    if (selectedCompany) {
      byId.set(selectedCompany.id, {
        id: selectedCompany.id,
        label: selectedCompany.name,
        description: selectedCompany.uen || undefined,
      });
    }
    for (const company of companyOptions) {
      if (byId.has(company.id)) continue;
      byId.set(company.id, {
        id: company.id,
        label: company.name,
        description: company.uen || undefined,
      });
    }
    return [...byId.values()];
  }, [companyOptions, selectedCompany]);

  const requiredFields = masterFields.fields.filter(
    (field) => field.requiredTemplateIds.length > 0,
  );
  const filledRequired = requiredFields.filter(
    (field) => (masterFieldValues[field.id] ?? '').trim().length > 0,
  ).length;
  const summaryRows = selectedCompany
    ? ([
        ['UEN', selectedCompany.uen || '—'],
        ['Status', selectedCompany.status || '—'],
        ['Registered address', selectedCompany.registeredAddress || '—'],
        ['Incorporated', formatDate(selectedCompany.incorporationDate) ?? '—'],
      ] as const)
    : [];

  return (
    <div className="space-y-6">
      <section aria-labelledby="primary-company-heading" className="max-w-3xl">
        <h2 id="primary-company-heading" className="text-sm font-medium text-text-primary">
          Primary company
          <span className="ml-1 text-status-error" aria-hidden="true">*</span>
        </h2>
        <p className="mt-1 text-xs text-text-muted">
          One company applies to every document in this batch. Service Agreements
          may add related entities later.
        </p>

        <div className="mt-3 max-w-xl">
          <AsyncSearchSelect
            value={primaryCompanyId ?? ''}
            onChange={(id) => {
              const nextId = id || null;
              const nextCompany = nextId
                ? companyOptions.find((company) => company.id === nextId)
                  ?? (selectedCompany?.id === nextId ? selectedCompany : null)
                : null;
              onCompanyChange(nextId, nextCompany);
            }}
            options={options}
            isLoading={companyLoading}
            searchQuery={companyQuery}
            onSearchChange={onCompanyQueryChange}
            disabled={disabled}
            placeholder="Search companies by name or UEN..."
            icon={<Building2 className="h-4 w-4" aria-hidden="true" />}
            emptySearchText="Start typing to search companies"
            noResultsText="No companies match that search"
          />
        </div>

        {companyError && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-status-error" role="alert">
            <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
            {companyError}
          </p>
        )}

        {selectedCompany ? (
          <dl className="mt-3 grid gap-x-6 gap-y-2 rounded-lg border border-border-primary bg-background-secondary p-3 sm:grid-cols-2">
            {summaryRows.map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="text-xs font-medium text-text-secondary">{label}</dt>
                <dd className="truncate text-sm text-text-primary" title={value}>
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="mt-3 rounded-lg border border-dashed border-border-primary p-3 text-sm text-text-muted">
            Choose a company to see the details that will be merged into every document.
          </p>
        )}
      </section>

      {sharedParties}

      <section aria-labelledby="shared-fields-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="shared-fields-heading" className="text-sm font-medium text-text-primary">
            Shared fields
          </h2>
          {requiredFields.length > 0 && (
            <p
              className={cn(
                'flex items-center gap-1.5 text-xs font-medium',
                filledRequired === requiredFields.length
                  ? 'text-status-success'
                  : 'text-status-warning',
              )}
              aria-live="polite"
            >
              {filledRequired === requiredFields.length && (
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {filledRequired} of {requiredFields.length} required complete
            </p>
          )}
        </div>
        <p className="mt-1 text-xs text-text-muted">
          Values reused by more than one document. A document-level override always
          wins over the shared value, which in turn wins over the template default.
        </p>

        {masterFields.fields.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-border-primary p-4 text-sm text-text-muted">
            No shared custom fields were found across the selected templates.
          </p>
        ) : (
          <div className="mt-3 grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {masterFields.fields.map((field) => {
              const overrideCount = overriddenCountByField[field.id] ?? 0;
              const isRequired = field.requiredTemplateIds.length > 0;
              const value = masterFieldValues[field.id] ?? '';
              const missing = isRequired && !value.trim();
              const inputId = `shared-field-${field.id}`;
              const helpId = `${inputId}-help`;
              return (
                <div
                  key={field.id}
                  className={cn(
                    'rounded-lg border bg-background-primary p-3',
                    missing ? 'border-status-error/50' : 'border-border-primary',
                  )}
                >
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <label htmlFor={inputId} className="text-sm font-medium text-text-primary">
                      {field.label}
                    </label>
                    {isRequired ? (
                      <span className="-ml-1 text-status-error" aria-hidden="true">*</span>
                    ) : null}
                    <span className="rounded bg-background-tertiary px-1.5 py-0.5 text-xs text-text-muted">
                      {field.type}
                    </span>
                  </div>
                  {field.type === 'date' ? (
                    <SingleDateInput
                      value={value}
                      onChange={(next) => onMasterValueChange(field.id, next)}
                      disabled={disabled}
                      ariaLabel={field.label}
                      showTodayButton
                      error={missing ? 'Required' : undefined}
                      className="mt-2 w-full"
                    />
                  ) : field.options?.length ? (
                    <SearchableSelect
                      options={field.options.map((option) => ({
                        value: option,
                        label: field.optionLabels?.[option] ?? option,
                      }))}
                      value={value}
                      onChange={(next) => onMasterValueChange(field.id, next)}
                      disabled={disabled}
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
                      onChange={(event) => onMasterValueChange(field.id, event.target.value)}
                      disabled={disabled}
                      aria-required={isRequired || undefined}
                      aria-invalid={missing || undefined}
                      aria-describedby={helpId}
                      className={cn(
                        'mt-2 min-h-11 w-full rounded-lg border bg-background-primary px-3 text-sm text-text-primary focus:border-oak-primary focus:outline-none focus:ring-2 focus:ring-oak-primary/30 lg:min-h-10',
                        missing ? 'border-status-error/60' : 'border-border-primary',
                      )}
                    />
                  )}
                  <p
                    id={helpId}
                    className={cn('mt-1 text-xs', missing ? 'text-status-error' : 'text-text-muted')}
                  >
                    {missing ? 'Required — ' : ''}
                    Used by {field.templateIds.length} document
                    {field.templateIds.length === 1 ? '' : 's'}
                    {isRequired
                      ? `, required by ${field.requiredTemplateIds.length} document${field.requiredTemplateIds.length === 1 ? '' : 's'}`
                      : ''}
                  </p>
                  {overrideCount > 0 && onSelectOverridden && (
                    <button
                      type="button"
                      onClick={() => onSelectOverridden(field.id)}
                      className="mt-2 inline-flex min-h-9 items-center rounded-lg text-xs font-medium text-oak-primary transition-colors hover:text-oak-dark"
                    >
                      {overrideCount} document{overrideCount === 1 ? '' : 's'} override this
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {masterFields.conflicts.length > 0 && (
        <section
          aria-label="Field type conflicts"
          className="rounded-lg border border-status-warning/30 bg-status-warning/5 p-3"
        >
          <h2 className="flex items-center gap-1.5 text-sm font-medium text-status-warning">
            <AlertCircle className="h-4 w-4" aria-hidden="true" />
            Type conflicts
          </h2>
          {masterFields.conflicts.map((conflict) => (
            <p key={conflict.key} className="mt-1 text-sm text-text-secondary">
              “{conflict.key}” appears with incompatible types
              ({conflict.types.join(', ')}). Those fields stay document-specific.
            </p>
          ))}
        </section>
      )}
    </div>
  );
}
