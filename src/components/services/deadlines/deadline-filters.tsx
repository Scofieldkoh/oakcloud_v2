'use client';

import { Search, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { FamilyFilterChips, type ServiceFamilyFilter } from '@/components/services/shared/family-filter-chips';
import { ServiceFilterToolbar, quickFilterClass } from '@/components/services/shared/service-filter-toolbar';
import { Button } from '@/components/ui/button';
import { DatePicker, type DatePickerValue } from '@/components/ui/date-picker';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { TableSelectFilter, TableTextFilter } from '@/components/ui/data-table';
import type { DeadlineTimingBucket } from '@/lib/validations/deadline';
import { DEADLINE_TIMING_BUCKET_LABELS } from './deadline-event';

export type DeadlineFilterType = 'STATUTORY' | 'CLIENT' | 'INTERNAL';
export type DeadlineFilterStatus = 'OPEN' | 'COMPLETED' | 'WAIVED' | 'CANCELLED';
export type DeadlineFilterOrigin = 'RULE' | 'MANUAL_TRIGGER';
type DeadlineSelectableStatus = Exclude<DeadlineFilterStatus, 'OPEN'>;

interface DeadlineFiltersProps {
  families: ServiceFamilyFilter[];
  companyQuery: string;
  serviceQuery: string;
  milestoneQuery: string;
  selectedTypes: readonly DeadlineFilterType[];
  selectedStatuses: readonly DeadlineFilterStatus[];
  selectedOrigin?: DeadlineFilterOrigin;
  selectedFamilyIds: readonly string[];
  openOnly: boolean;
  onCompanyQueryChange: (value: string) => void;
  onServiceQueryChange: (value: string) => void;
  onMilestoneQueryChange: (value: string) => void;
  onTypeChange: (type?: DeadlineFilterType) => void;
  onToggleStatus: (status: DeadlineFilterStatus) => void;
  onToggleOrigin: (origin: DeadlineFilterOrigin) => void;
  onToggleFamily: (familyId: string) => void;
  onToggleOpenOnly: () => void;
  dateFrom: string;
  dateTo: string;
  onDateRangeChange: (from: string, to: string) => void;
  onAdjustColumns?: () => void;
  hiddenColumnCount?: number;
  className?: string;
}

const typeLabels: Record<DeadlineFilterType, string> = {
  STATUTORY: 'Statutory',
  CLIENT: 'Client',
  INTERNAL: 'Internal',
};

const statusLabels: Record<DeadlineSelectableStatus, string> = {
  COMPLETED: 'Completed',
  WAIVED: 'Waived',
  CANCELLED: 'Cancelled',
};

const originLabels: Record<DeadlineFilterOrigin, string> = {
  RULE: 'Rule',
  MANUAL_TRIGGER: 'Manual trigger',
};

const typeOptions = (Object.keys(typeLabels) as DeadlineFilterType[]).map((value) => ({ value, label: typeLabels[value] }));
const statusOptions = (Object.keys(statusLabels) as DeadlineSelectableStatus[]).map((value) => ({ value, label: statusLabels[value] }));
const originOptions = (Object.keys(originLabels) as DeadlineFilterOrigin[]).map((value) => ({ value, label: originLabels[value] }));
const timingOptions = (Object.keys(DEADLINE_TIMING_BUCKET_LABELS) as DeadlineTimingBucket[]).map((value) => ({ value, label: DEADLINE_TIMING_BUCKET_LABELS[value] }));

function toLocalDate(value: string): Date | undefined {
  if (!value) return undefined;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function toLocalDateString(value?: Date): string {
  if (!value || Number.isNaN(value.getTime())) return '';
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function FilterOption({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`flex min-h-11 w-full items-center justify-between rounded-lg border px-3 text-left text-sm transition-colors ${selected ? 'border-oak-primary bg-oak-primary/10 text-text-primary' : 'border-border-primary text-text-secondary hover:bg-background-tertiary'}`}
    >
      <span>{label}</span>
      <span aria-hidden="true" className="text-xs">{selected ? '✓' : ''}</span>
    </button>
  );
}

export function FilterModalButton({
  label,
  selected,
  count,
  title,
  description,
  children,
}: {
  label: string;
  selected: boolean;
  count?: number;
  title: string;
  description: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" aria-pressed={selected} onClick={() => setOpen(true)} className={quickFilterClass(selected)}>
        <span>{label}</span>
        {count ? <span aria-hidden="true" className="min-w-[18px] rounded-full bg-background-tertiary/80 px-1.5 py-0.5 text-center text-2xs">{count}</span> : null}
      </button>
      <Modal isOpen={open} onClose={() => setOpen(false)} title={title} description={description} size="sm">
        <ModalBody className="space-y-2">{children}</ModalBody>
        <ModalFooter><Button type="button" size="sm" onClick={() => setOpen(false)}>Done</Button></ModalFooter>
      </Modal>
    </>
  );
}

function TextFilterButton({
  label,
  value,
  onChange,
  title,
  description,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  title: string;
  description: string;
  placeholder: string;
}) {
  return (
    <FilterModalButton label={label} selected={Boolean(value)} title={title} description={description}>
      <label className="space-y-1 text-xs font-medium text-text-secondary">
        <span>{label}</span>
        <input
          autoFocus
          type="search"
          aria-label={`Filter ${label}`}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          className="input input-sm min-h-11 w-full"
        />
      </label>
    </FilterModalButton>
  );
}

function CompanySearchInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [queryDraft, setQueryDraft] = useState(value);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  valueRef.current = value;
  onChangeRef.current = onChange;

  useEffect(() => {
    setQueryDraft(value);
  }, [value]);

  useEffect(() => {
    if (queryDraft === valueRef.current) return undefined;
    const timer = window.setTimeout(() => onChangeRef.current(queryDraft), 300);
    return () => window.clearTimeout(timer);
  }, [queryDraft]);

  return (
    <label className="relative flex min-h-11 min-w-[220px] flex-1 items-center rounded-lg border border-border-primary bg-background-primary focus-within:border-oak-primary focus-within:ring-2 focus-within:ring-oak-primary/20 sm:min-h-8">
      <Search className="ml-3 h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
      <span className="sr-only">Company</span>
      <input
        type="search"
        role="searchbox"
        aria-label="Company"
        value={queryDraft}
        onChange={(event) => setQueryDraft(event.target.value)}
        placeholder="Search companies"
        className="h-11 min-w-0 flex-1 bg-transparent px-2 text-sm text-text-primary outline-none placeholder:text-text-muted sm:h-8"
      />
      {queryDraft ? <button type="button" aria-label="Clear company filter" onClick={() => { setQueryDraft(''); onChangeRef.current(''); }} className="mr-2 flex min-h-11 min-w-11 items-center justify-center rounded text-text-muted hover:bg-background-tertiary sm:min-h-8 sm:min-w-8"><X className="h-4 w-4" aria-hidden="true" /></button> : null}
    </label>
  );
}

export interface DeadlineInlineFilterValues {
  companyQuery: string;
  serviceQuery: string;
  milestoneQuery: string;
  familyId: string;
  type: DeadlineFilterType | '';
  status: DeadlineSelectableStatus | '';
  origin: DeadlineFilterOrigin | '';
  timingBucket: DeadlineTimingBucket | '';
  dateFrom: string;
  dateTo: string;
}

export interface DeadlineInlineFilterColumn {
  id: string;
  width: number;
}

interface DeadlineInlineFiltersProps {
  families: ServiceFamilyFilter[];
  values: DeadlineInlineFilterValues;
  onChange: (next: Partial<DeadlineInlineFilterValues>) => void;
  tableColumns: readonly DeadlineInlineFilterColumn[];
  className?: string;
}

function InlineTextFilter({ label, value, onChange, placeholder = 'All' }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <div className="min-w-0 px-2 py-2">
      <TableTextFilter
        ariaLabel={`Filter ${label}`}
        value={value || undefined}
        onChange={(nextValue) => onChange(nextValue ?? '')}
        placeholder={placeholder}
      />
    </div>
  );
}

function InlineSelectFilter({ label, options, value, onChange, placeholder = 'All' }: { label: string; options: { value: string; label: string }[]; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <div className="min-w-0 px-2 py-2">
      <TableSelectFilter
        options={options}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        ariaLabel={`Filter ${label}`}
      />
    </div>
  );
}

function InlineFilterCell({ id, families, values, onChange }: { id: string; families: ServiceFamilyFilter[]; values: DeadlineInlineFilterValues; onChange: (next: Partial<DeadlineInlineFilterValues>) => void }) {
  const familyOptions = families.map((family) => ({ value: family.id, label: family.name }));
  switch (id) {
    case 'company':
      return <InlineTextFilter label="Company" value={values.companyQuery} onChange={(value) => onChange({ companyQuery: value })} />;
    case 'family':
      return <InlineSelectFilter label="Family" options={familyOptions} value={values.familyId} onChange={(value) => onChange({ familyId: value })} />;
    case 'service':
      return <InlineTextFilter label="Service" value={values.serviceQuery} onChange={(value) => onChange({ serviceQuery: value })} />;
    case 'milestone':
      return <InlineTextFilter label="Milestone" value={values.milestoneQuery} onChange={(value) => onChange({ milestoneQuery: value })} />;
    case 'type':
      return <InlineSelectFilter label="Deadline type" options={typeOptions} value={values.type} onChange={(value) => onChange({ type: value as DeadlineFilterType | '' })} />;
    case 'status':
      return <InlineSelectFilter label="Status" options={statusOptions} value={values.status} onChange={(value) => onChange({ status: value as DeadlineSelectableStatus | '' })} />;
    case 'dueDate':
      return (
        <div className="min-w-0 px-2 py-2">
          <DatePicker
            value={values.dateFrom && values.dateTo ? { mode: 'range', range: { from: toLocalDate(values.dateFrom), to: toLocalDate(values.dateTo) } } : undefined}
            onChange={(value: DatePickerValue | undefined) => {
              if (!value) {
                onChange({ dateFrom: '', dateTo: '' });
                return;
              }
              if (value.mode !== 'range' || !value.range?.from || !value.range.to) return;
              const from = toLocalDateString(value.range.from);
              const to = toLocalDateString(value.range.to);
              if (from && to) onChange({ dateFrom: from, dateTo: to });
            }}
            placeholder="All dates"
            size="sm"
            defaultTab="range"
            className="text-xs"
            variant="table-filter"
          />
        </div>
      );
    case 'timing':
      return <InlineSelectFilter label="Timing" options={timingOptions} value={values.timingBucket} onChange={(value) => onChange({ timingBucket: value as DeadlineTimingBucket | '' })} />;
    case 'origin':
      return <InlineSelectFilter label="Source" options={originOptions} value={values.origin} onChange={(value) => onChange({ origin: value as DeadlineFilterOrigin | '' })} />;
    default:
      return <div aria-hidden="true" className="min-w-0 px-2 py-2" />;
  }
}

/** Native column-style filters for the table view. Changes are reflected by the shared active badges and quick controls. */
export function DeadlineInlineFilters({
  families,
  values,
  onChange,
  tableColumns,
  className,
}: DeadlineInlineFiltersProps) {
  return (
    <div role="group" aria-label="Deadline inline filters" className={`overflow-hidden ${className ?? ''}`}>
      <div className="grid min-w-0 bg-background-primary" style={{ gridTemplateColumns: tableColumns.map((column) => `${column.width}px`).join(' ') }}>
        {tableColumns.map((column) => <InlineFilterCell key={column.id} id={column.id} families={families} values={values} onChange={onChange} />)}
      </div>
    </div>
  );
}

/** Quick filters for the deadline list. Detailed options open from their individual buttons. */
export function DeadlineFilters({
  families,
  companyQuery,
  serviceQuery,
  milestoneQuery,
  selectedTypes,
  selectedStatuses,
  selectedOrigin,
  selectedFamilyIds,
  openOnly,
  onCompanyQueryChange,
  onServiceQueryChange,
  onMilestoneQueryChange,
  onTypeChange,
  onToggleStatus,
  onToggleOrigin,
  onToggleFamily,
  onToggleOpenOnly,
  dateFrom,
  dateTo,
  onDateRangeChange,
  onAdjustColumns,
  hiddenColumnCount,
  className,
}: DeadlineFiltersProps) {
  return (
    <ServiceFilterToolbar label="Deadline filters" onAdjustColumns={onAdjustColumns} hiddenColumnCount={hiddenColumnCount} className={className}>
      <CompanySearchInput value={companyQuery} onChange={onCompanyQueryChange} />
      <button type="button" aria-pressed={openOnly && selectedStatuses.length === 0} onClick={onToggleOpenOnly} className={quickFilterClass(openOnly && selectedStatuses.length === 0)}>Status: Open</button>
      {families.length > 0 ? <FamilyFilterChips families={families} selectedIds={selectedFamilyIds} onToggle={onToggleFamily} /> : null}
      <TextFilterButton label="Service" value={serviceQuery} onChange={onServiceQueryChange} title="Filter service" description="Search by the service assigned to a deadline." placeholder="Search services" />
      <TextFilterButton label="Milestone" value={milestoneQuery} onChange={onMilestoneQueryChange} title="Filter milestone" description="Search by the deadline milestone." placeholder="Search milestones" />
      <FilterModalButton label="Deadline type" selected={selectedTypes.length > 0} title="Filter deadline types" description="Select one deadline type.">
        {typeOptions.map((option) => <FilterOption key={option.value} label={option.label} selected={selectedTypes.includes(option.value)} onClick={() => onTypeChange(selectedTypes.includes(option.value) ? undefined : option.value)} />)}
      </FilterModalButton>
      <FilterModalButton label="Status" selected={selectedStatuses.length > 0} count={selectedStatuses.length} title="Filter statuses" description="Select one or more deadline statuses.">
        {statusOptions.map((option) => <FilterOption key={option.value} label={option.label} selected={selectedStatuses.includes(option.value)} onClick={() => onToggleStatus(option.value)} />)}
      </FilterModalButton>
      <FilterModalButton label="Source" selected={Boolean(selectedOrigin)} count={selectedOrigin ? 1 : undefined} title="Filter source" description="Select the source of the deadline cycle.">
        {originOptions.map((option) => <FilterOption key={option.value} label={option.label} selected={selectedOrigin === option.value} onClick={() => onToggleOrigin(option.value)} />)}
      </FilterModalButton>
      <DatePicker
        value={dateFrom && dateTo ? { mode: 'range', range: { from: toLocalDate(dateFrom), to: toLocalDate(dateTo) } } : undefined}
        onChange={(value: DatePickerValue | undefined) => {
          if (!value) {
            onDateRangeChange('', '');
            return;
          }
          if (value.mode !== 'range' || !value.range?.from || !value.range.to) return;
          const from = toLocalDateString(value.range.from);
          const to = toLocalDateString(value.range.to);
          if (from && to) onDateRangeChange(from, to);
        }}
        placeholder="Date Range"
        defaultTab="range"
        size="sm"
        className="min-w-[160px] text-xs"
      />
    </ServiceFilterToolbar>
  );
}
