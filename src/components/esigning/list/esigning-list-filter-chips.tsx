'use client';

import { FilterChip } from '@/components/ui/filter-chip';
import {
  ENVELOPE_STATUS_LABELS,
  RECIPIENT_STATUS_LABELS,
  SIGNING_ORDER_FILTER_LABELS,
  formatFilterDateRange,
  isStatusDuplicatedByTab,
  type EnvelopeAdvancedFilters,
  type TabKey,
} from './esigning-list-config';

interface EnvelopeFilterChipsProps {
  companyId: string;
  selectedCompanyName: string;
  onClearCompany: () => void;
  appliedFilters: EnvelopeAdvancedFilters;
  activeTab: TabKey;
  /** Clears the given filter fields. */
  onRemove: (patch: Partial<EnvelopeAdvancedFilters>) => void;
  onClearAll: () => void;
}

/** One chip per applied envelope filter, with Clear all. */
export function EnvelopeFilterChips({
  companyId,
  selectedCompanyName,
  onClearCompany,
  appliedFilters,
  activeTab,
  onRemove,
  onClearAll,
}: EnvelopeFilterChipsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-3 pb-3 sm:px-4 sm:pb-4">
      {companyId && selectedCompanyName ? (
        <FilterChip label="Company" value={selectedCompanyName} onRemove={onClearCompany} />
      ) : null}
      {appliedFilters.status && !isStatusDuplicatedByTab(appliedFilters.status, activeTab) ? (
        <FilterChip
          label="Status"
          value={ENVELOPE_STATUS_LABELS[appliedFilters.status]}
          onRemove={() => onRemove({ status: '' })}
        />
      ) : null}
      {appliedFilters.documentName ? (
        <FilterChip
          label="Document"
          value={appliedFilters.documentName}
          onRemove={() => onRemove({ documentName: '' })}
        />
      ) : null}
      {appliedFilters.recipientQuery ? (
        <FilterChip
          label="Recipient"
          value={appliedFilters.recipientQuery}
          onRemove={() => onRemove({ recipientQuery: '' })}
        />
      ) : null}
      {appliedFilters.recipientStatus ? (
        <FilterChip
          label="Recipient status"
          value={RECIPIENT_STATUS_LABELS[appliedFilters.recipientStatus]}
          onRemove={() => onRemove({ recipientStatus: '' })}
        />
      ) : null}
      {appliedFilters.signingOrder ? (
        <FilterChip
          label="Signing mode"
          value={SIGNING_ORDER_FILTER_LABELS[appliedFilters.signingOrder]}
          onRemove={() => onRemove({ signingOrder: '' })}
        />
      ) : null}
      {appliedFilters.createdFrom || appliedFilters.createdTo ? (
        <FilterChip
          label="Created"
          value={formatFilterDateRange(appliedFilters.createdFrom, appliedFilters.createdTo)}
          onRemove={() => onRemove({ createdFrom: '', createdTo: '' })}
        />
      ) : null}
      {appliedFilters.sentFrom || appliedFilters.sentTo ? (
        <FilterChip
          label="Sent"
          value={formatFilterDateRange(appliedFilters.sentFrom, appliedFilters.sentTo)}
          onRemove={() => onRemove({ sentFrom: '', sentTo: '' })}
        />
      ) : null}
      {appliedFilters.completedFrom || appliedFilters.completedTo ? (
        <FilterChip
          label="Completed"
          value={formatFilterDateRange(appliedFilters.completedFrom, appliedFilters.completedTo)}
          onRemove={() => onRemove({ completedFrom: '', completedTo: '' })}
        />
      ) : null}
      {appliedFilters.createdBy === 'me' ? (
        <FilterChip
          label="Created by"
          value="Me"
          onRemove={() => onRemove({ createdBy: 'all' })}
        />
      ) : null}
      <button
        type="button"
        onClick={onClearAll}
        className="px-1 text-xs font-medium text-text-muted transition-colors hover:text-oak-primary"
      >
        Clear all
      </button>
    </div>
  );
}
