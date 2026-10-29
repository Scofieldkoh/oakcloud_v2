'use client';

import type { Dispatch, SetStateAction } from 'react';
import { Button } from '@/components/ui/button';
import { FormInput } from '@/components/ui/form-input';
import { CompanySearchableSelect } from '@/components/ui/company-searchable-select';
import {
  ENVELOPE_STATUS_LABELS,
  RECIPIENT_STATUS_LABELS,
  SIGNING_ORDER_FILTER_LABELS,
  type EnvelopeAdvancedFilters,
  type RecipientStatusFilter,
  type SigningOrderFilter,
  type StatusFilter,
} from './esigning-list-config';

interface EnvelopeFilterPanelProps {
  companyOptions: Array<{ id: string; name: string }>;
  draftCompanyId: string;
  onDraftCompanyChange: (companyId: string) => void;
  draftFilters: EnvelopeAdvancedFilters;
  setDraftFilters: Dispatch<SetStateAction<EnvelopeAdvancedFilters>>;
  onReset: () => void;
  onApply: () => void;
}

/** The Filters popover on the envelope list. Edits a draft that only takes effect on Apply. */
export function EnvelopeFilterPanel({
  companyOptions,
  draftCompanyId,
  onDraftCompanyChange,
  draftFilters,
  setDraftFilters,
  onReset,
  onApply,
}: EnvelopeFilterPanelProps) {
  return (
        <div
          role="dialog"
          aria-label="Envelope filters"
          className="absolute left-0 top-[calc(100%+8px)] z-40 w-[min(420px,calc(100vw-2rem))] rounded-xl border border-border-primary bg-background-secondary shadow-elevation-2 sm:left-auto sm:right-0"
        >
          <div className="border-b border-border-primary px-5 py-4">
            <div className="text-sm font-semibold text-text-primary">Filter envelopes</div>
            <div className="mt-0.5 text-xs text-text-muted">
              Filters combine with the selected status tab and search.
            </div>
          </div>
          <div className="max-h-[60vh] space-y-4 overflow-y-auto p-5">
            <CompanySearchableSelect
              companies={companyOptions}
              value={draftCompanyId}
              onChange={onDraftCompanyChange}
              placeholder="All companies"
              label="Company"
              clearable
              size="lg"
              containerClassName="h-10"
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-text-secondary">Status</span>
                <select
                  aria-label="Filter by envelope status"
                  value={draftFilters.status}
                  onChange={(event) => setDraftFilters((current) => ({
                    ...current,
                    status: event.target.value as StatusFilter | '',
                  }))}
                  className="h-10 w-full rounded-lg border border-border-primary bg-background-primary px-3 text-sm text-text-primary focus:border-oak-primary focus:outline-none focus:ring-2 focus:ring-oak-primary/30"
                >
                  <option value="">Use status tab</option>
                  {(Object.keys(ENVELOPE_STATUS_LABELS) as StatusFilter[]).map((status) => (
                    <option key={status} value={status}>{ENVELOPE_STATUS_LABELS[status]}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-text-secondary">Signing mode</span>
                <select
                  aria-label="Filter by signing mode"
                  value={draftFilters.signingOrder}
                  onChange={(event) => setDraftFilters((current) => ({
                    ...current,
                    signingOrder: event.target.value as SigningOrderFilter | '',
                  }))}
                  className="h-10 w-full rounded-lg border border-border-primary bg-background-primary px-3 text-sm text-text-primary focus:border-oak-primary focus:outline-none focus:ring-2 focus:ring-oak-primary/30"
                >
                  <option value="">Any mode</option>
                  {(Object.keys(SIGNING_ORDER_FILTER_LABELS) as SigningOrderFilter[]).map((mode) => (
                    <option key={mode} value={mode}>{SIGNING_ORDER_FILTER_LABELS[mode]}</option>
                  ))}
                </select>
              </label>
            </div>

            <FormInput
              inputSize="md"
              label="Document name"
              placeholder="Filename contains..."
              value={draftFilters.documentName}
              onChange={(event) => setDraftFilters((current) => ({
                ...current,
                documentName: event.target.value,
              }))}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <FormInput
                inputSize="md"
                label="Recipient"
                placeholder="Name or email..."
                value={draftFilters.recipientQuery}
                onChange={(event) => setDraftFilters((current) => ({
                  ...current,
                  recipientQuery: event.target.value,
                }))}
              />
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-text-secondary">Recipient status</span>
                <select
                  aria-label="Filter by recipient signing status"
                  value={draftFilters.recipientStatus}
                  onChange={(event) => setDraftFilters((current) => ({
                    ...current,
                    recipientStatus: event.target.value as RecipientStatusFilter | '',
                  }))}
                  className="h-9 w-full rounded-lg border border-border-primary bg-background-primary px-3 text-sm text-text-primary focus:border-oak-primary focus:outline-none focus:ring-2 focus:ring-oak-primary/30"
                >
                  <option value="">Any status</option>
                  {(Object.keys(RECIPIENT_STATUS_LABELS) as RecipientStatusFilter[]).map((status) => (
                    <option key={status} value={status}>{RECIPIENT_STATUS_LABELS[status]}</option>
                  ))}
                </select>
              </label>
            </div>

            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-text-secondary">Created by</span>
              <select
                aria-label="Filter by envelope creator"
                value={draftFilters.createdBy}
                onChange={(event) => setDraftFilters((current) => ({
                  ...current,
                  createdBy: event.target.value as 'all' | 'me',
                }))}
                className="h-10 w-full rounded-lg border border-border-primary bg-background-primary px-3 text-sm text-text-primary focus:border-oak-primary focus:outline-none focus:ring-2 focus:ring-oak-primary/30"
              >
                <option value="all">All senders</option>
                <option value="me">Created by me</option>
              </select>
            </label>

            {([
              ['Created date', 'createdFrom', 'createdTo'],
              ['Sent date', 'sentFrom', 'sentTo'],
              ['Completed date', 'completedFrom', 'completedTo'],
            ] as const).map(([label, fromKey, toKey]) => (
              <fieldset key={label}>
                <legend className="mb-1.5 text-xs font-medium text-text-secondary">{label}</legend>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="date"
                    aria-label={`${label} from`}
                    value={draftFilters[fromKey]}
                    onChange={(event) => setDraftFilters((current) => ({
                      ...current,
                      [fromKey]: event.target.value,
                    }))}
                    className="h-10 min-w-0 rounded-lg border border-border-primary bg-background-primary px-2.5 text-sm text-text-primary focus:border-oak-primary focus:outline-none focus:ring-2 focus:ring-oak-primary/30"
                  />
                  <input
                    type="date"
                    aria-label={`${label} to`}
                    value={draftFilters[toKey]}
                    onChange={(event) => setDraftFilters((current) => ({
                      ...current,
                      [toKey]: event.target.value,
                    }))}
                    className="h-10 min-w-0 rounded-lg border border-border-primary bg-background-primary px-2.5 text-sm text-text-primary focus:border-oak-primary focus:outline-none focus:ring-2 focus:ring-oak-primary/30"
                  />
                </div>
              </fieldset>
            ))}
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-border-primary px-5 py-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={onReset}
            >
              Reset
            </Button>
            <Button size="sm" onClick={onApply}>Apply</Button>
          </div>
        </div>
  );
}
