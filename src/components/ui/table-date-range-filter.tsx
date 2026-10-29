'use client';

import { DatePicker, type DatePickerValue } from '@/components/ui/date-picker';

/** A Date as the local calendar day, YYYY-MM-DD. */
export function toLocalDateString(date?: Date): string | undefined {
  if (!date) return undefined;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseLocalDate(value?: string): Date | undefined {
  return value ? new Date(`${value}T00:00:00`) : undefined;
}

/**
 * Inline table filter for a date column: a from/to day range kept as
 * YYYY-MM-DD strings. Picking a single day filters on that day.
 */
export function TableDateRangeFilter({
  from,
  to,
  onChange,
  placeholder = 'All dates',
}: {
  from?: string;
  to?: string;
  onChange: (range: { from?: string; to?: string }) => void;
  placeholder?: string;
}) {
  return (
    <DatePicker
      value={from || to ? { mode: 'range', range: { from: parseLocalDate(from), to: parseLocalDate(to) } } : undefined}
      onChange={(value: DatePickerValue | undefined) => {
        if (value?.mode === 'single') {
          const day = toLocalDateString(value.date);
          onChange({ from: day, to: day });
          return;
        }
        onChange({ from: toLocalDateString(value?.range?.from), to: toLocalDateString(value?.range?.to) });
      }}
      placeholder={placeholder}
      size="sm"
      defaultTab="range"
      className="text-xs"
      variant="table-filter"
    />
  );
}
