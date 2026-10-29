'use client';

import { Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ActiveFilterBar } from '@/components/ui/active-filter-bar';
import { DatePicker, type DatePickerValue } from '@/components/ui/date-picker';
import { FamilyFilterChips, type ServiceFamilyFilter } from '@/components/services/shared/family-filter-chips';
import { ServiceFilterToolbar, quickFilterClass } from '@/components/services/shared/service-filter-toolbar';
import type { BillingOccurrenceSearch } from '@/lib/validations/billing';

const STATUS_OPTIONS: Array<{ value: BillingOccurrenceSearch['statuses'][number]; label: string }> = [
  { value: 'OPEN', label: 'Open' },
  { value: 'BILLED', label: 'Billed' },
  { value: 'WAIVED', label: 'Waived' },
];

const TIMING_OPTIONS: Array<{ value: BillingOccurrenceSearch['timing'][number]; label: string }> = [
  { value: 'UPCOMING', label: 'Upcoming' },
  { value: 'DUE', label: 'Due' },
  { value: 'OVERDUE', label: 'Overdue' },
];

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

export interface BillingFilterState {
  query: string;
  statuses: BillingOccurrenceSearch['statuses'];
  timing: BillingOccurrenceSearch['timing'];
  from: string;
  to: string;
  familyIds: string[];
}

interface BillingFiltersProps {
  value: BillingFilterState;
  families: ServiceFamilyFilter[];
  onChange: (value: BillingFilterState) => void;
  dateRangeActive: boolean;
  onAdjustColumns?: () => void;
  hiddenColumnCount?: number;
}

function toggle<T extends string>(values: readonly T[], value: T): T[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

export function BillingFilters({ value, families, onChange, dateRangeActive, onAdjustColumns, hiddenColumnCount }: BillingFiltersProps) {
  const [queryDraft, setQueryDraft] = useState(value.query);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  valueRef.current = value;
  onChangeRef.current = onChange;

  useEffect(() => {
    setQueryDraft(value.query);
  }, [value.query]);

  useEffect(() => {
    if (queryDraft === value.query) return undefined;
    const timeout = window.setTimeout(() => {
      onChangeRef.current({ ...valueRef.current, query: queryDraft });
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [queryDraft, value.query]);

  const activeFilters = [
    ...value.statuses.map((status) => ({ key: `status-${status}`, label: 'Status', value: STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status, onRemove: () => onChange({ ...value, statuses: value.statuses.filter((item) => item !== status) }) })),
    ...value.timing.map((timing) => ({ key: `timing-${timing}`, label: 'Timing', value: TIMING_OPTIONS.find((option) => option.value === timing)?.label ?? timing, onRemove: () => onChange({ ...value, timing: value.timing.filter((item) => item !== timing) }) })),
    ...families.filter((family) => value.familyIds.includes(family.id)).map((family) => ({ key: `family-${family.id}`, label: 'Family', value: family.name, onRemove: () => onChange({ ...value, familyIds: value.familyIds.filter((id) => id !== family.id) }) })),
    ...(queryDraft ? [{ key: 'query', label: 'Search', value: queryDraft, onRemove: () => { setQueryDraft(''); onChange({ ...value, query: '' }); } }] : []),
    ...(dateRangeActive && value.from && value.to ? [{ key: 'date-range', label: 'Date', value: `${value.from} – ${value.to}`, onRemove: () => onChange({ ...value, from: '', to: '' }) }] : []),
  ];

  return (
    <section aria-label="Billing filters" className="space-y-3">
      <ServiceFilterToolbar label="Billing quick filters" onAdjustColumns={onAdjustColumns} hiddenColumnCount={hiddenColumnCount}>
          <label className="relative min-w-[220px] flex-1">
            <span className="sr-only">Search company or fee line</span>
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <input
              type="search"
              aria-label="Search company or fee line"
              value={queryDraft}
              onChange={(event) => setQueryDraft(event.target.value)}
              placeholder="Search company or fee line"
              className="input input-sm min-h-11 w-full bg-background-primary py-2 pl-9 pr-3 sm:min-h-8"
            />
          </label>
          <div role="group" aria-label="Billing status filters" className="flex flex-wrap items-center gap-2">
            {STATUS_OPTIONS.map((option) => {
              const selected = value.statuses.includes(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onChange({ ...value, statuses: toggle(value.statuses, option.value) })}
                  className={quickFilterClass(selected)}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
          <div role="group" aria-label="Billing timing filters" className="flex flex-wrap gap-2">
            {TIMING_OPTIONS.map((option) => {
              const selected = value.timing.includes(option.value);
              return <button key={option.value} type="button" aria-pressed={selected} onClick={() => onChange({ ...value, timing: toggle(value.timing, option.value) })} className={quickFilterClass(selected)}>{option.label}</button>;
            })}
          </div>
          <FamilyFilterChips families={families} selectedIds={value.familyIds} onToggle={(familyId) => onChange({ ...value, familyIds: toggle(value.familyIds, familyId) })} />
          <DatePicker
            value={value.from && value.to ? { mode: 'range', range: { from: toLocalDate(value.from), to: toLocalDate(value.to) } } : undefined}
            onChange={(next: DatePickerValue | undefined) => {
              if (!next) {
                onChange({ ...value, from: '', to: '' });
                return;
              }
              if (next.mode !== 'range' || !next.range?.from || !next.range.to) return;
              const from = toLocalDateString(next.range.from);
              const to = toLocalDateString(next.range.to);
              if (from && to) onChange({ ...value, from, to });
            }}
            placeholder="Date Range"
            defaultTab="range"
            size="sm"
            className="min-w-[160px] text-xs"
          />
      </ServiceFilterToolbar>

      <ActiveFilterBar
        filters={activeFilters}
        onClearAll={() => {
          setQueryDraft('');
          onChange({ ...value, query: '', statuses: [], timing: [], familyIds: [], ...(dateRangeActive ? { from: '', to: '' } : {}) });
        }}
      />
    </section>
  );
}

export { STATUS_OPTIONS, TIMING_OPTIONS };
