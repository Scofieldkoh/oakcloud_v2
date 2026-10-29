'use client';

import { useEffect, useMemo, useState } from 'react';
import { addMonths, format, startOfMonth } from 'date-fns';
import { DayPicker, type DayProps } from 'react-day-picker';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useDeadlineHolidays, useDeadlines, type DeadlineSearchInput } from '@/hooks/use-deadlines';
import { useIsLargeDesktop } from '@/hooks/use-media-query';
import { addCalendarDays, addMonthsClamped, currentDateInSingapore, type DateOnly } from '@/services/service-schedule';
import type { DeadlineOccurrenceDto } from '@/services/deadline';
import type { UpdateDeadlineOccurrenceInput } from '@/lib/validations/deadline';
import { parseDeadlineViewPreference, type DeadlineViewPreference } from '@/lib/validations/services-preferences';
import { Toggle } from '@/components/ui/toggle';
import { cn } from '@/lib/utils';
import { DeadlineEvent } from './deadline-event';

interface DeadlineCalendarProps {
  items?: DeadlineOccurrenceDto[];
  focusMonth?: Date;
  monthCount?: 1 | 2 | 3 | null;
  search?: DeadlineSearchInput;
  preferenceValue?: DeadlineViewPreference;
  canEdit?: boolean;
  isPending?: boolean;
  mutationError?: unknown;
  onMonthChange?: (month: Date) => void;
  onMonthCountChange?: (monthCount: 1 | 2 | 3) => void;
  onShowHolidaysChange?: (showHolidays: boolean) => void;
  onUpdate?: (occurrence: DeadlineOccurrenceDto, data: UpdateDeadlineOccurrenceInput) => void;
  onResetOverride?: (occurrence: DeadlineOccurrenceDto, reason: string) => void;
}

function dateOnlyFromDate(value: Date): DateOnly {
  return `${String(value.getFullYear()).padStart(4, '0')}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}` as DateOnly;
}

function dateFromDateOnly(value: DateOnly): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}

function monthRange(month: Date, count: number): { from: DateOnly; to: DateOnly } {
  const from = dateOnlyFromDate(startOfMonth(month));
  const next = addMonthsClamped(from, count);
  return { from, to: addCalendarDays(next, -1) };
}

function occurrenceDate(occurrence: DeadlineOccurrenceDto): DateOnly {
  return occurrence.operativeDueDate.slice(0, 10) as DateOnly;
}

const DEFAULT_WEEKEND_DAYS = [0, 6];

/** Day of week (0 = Sunday) of a calendar date, independent of the browser's time zone. */
function weekdayOf(value: string): number {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function eventsForDate(items: DeadlineOccurrenceDto[], date: Date): DeadlineOccurrenceDto[] {
  const key = dateOnlyFromDate(date);
  return items.filter((item) => occurrenceDate(item) === key);
}

interface CalendarDayProps extends DayProps {
  events: Map<string, DeadlineOccurrenceDto[]>;
  holidays: Map<string, string>;
  weekendDays: number[];
  eventsPerDay: number;
  onMore?: (date: Date) => void;
  canEdit?: boolean;
  isPending?: boolean;
  mutationError?: unknown;
  onUpdate?: DeadlineCalendarProps['onUpdate'];
  onResetOverride?: DeadlineCalendarProps['onResetOverride'];
}

function CalendarDay({ day, modifiers, children, events, holidays, weekendDays, eventsPerDay, onMore, canEdit, isPending, mutationError, onUpdate, onResetOverride, ...props }: CalendarDayProps) {
  const eventItems = events.get(day.isoDate) ?? [];
  const visible = eventItems.slice(0, eventsPerDay);
  const remaining = eventItems.length - visible.length;
  const inMonth = !modifiers.outside && !modifiers.hidden;
  const holidayName = inMonth ? holidays.get(day.isoDate) : undefined;
  const dayKind = !inMonth ? undefined : holidayName ? 'holiday' : weekendDays.includes(weekdayOf(day.isoDate)) ? 'weekend' : 'working';
  return (
    <td
      {...props}
      className={cn(
        'min-h-[6.5rem] border-t border-border-primary p-1 align-top',
        props.className,
        // The selected day tints its date button so the day colour stays visible.
        dayKind === 'weekend' && 'bg-sky-100/70 dark:bg-sky-500/10',
        dayKind === 'holiday' && 'bg-orange-100/70 dark:bg-orange-500/15',
      )}
      data-calendar-day={day.isoDate}
      data-day-kind={dayKind}
    >
      {children}
      {holidayName ? <p className="truncate px-1 text-[10px] font-medium leading-4 text-orange-700 dark:text-orange-300" title={holidayName}>{holidayName}</p> : null}
      {eventItems.length > 0 ? (
        <div className="mt-1 space-y-1">
          {visible.map((occurrence) => <DeadlineEvent key={occurrence.id} occurrence={occurrence} compact canEdit={canEdit} isPending={isPending} mutationError={mutationError} onUpdate={onUpdate} onResetOverride={onResetOverride} />)}
          {remaining > 0 ? <button type="button" className="flex min-h-11 w-full items-center rounded-md px-2 text-xs font-medium text-oak-light hover:bg-background-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-oak-primary/30" aria-label={`Show ${remaining} more deadlines on ${format(day.date, 'd MMMM yyyy')}`} onClick={(event) => { event.stopPropagation(); onMore?.(day.date); }}>+{remaining} more</button> : null}
        </div>
      ) : null}
    </td>
  );
}

export function DeadlineCalendar({
  items: providedItems,
  focusMonth: providedFocusMonth,
  monthCount: providedMonthCount,
  search,
  preferenceValue,
  canEdit = false,
  isPending = false,
  mutationError,
  onMonthChange,
  onMonthCountChange,
  onShowHolidaysChange,
  onUpdate,
  onResetOverride,
}: DeadlineCalendarProps) {
  const isLargeDesktop = useIsLargeDesktop();
  const parsedPreference = preferenceValue ?? parseDeadlineViewPreference(undefined);
  const defaultMonth = dateFromDateOnly(currentDateInSingapore());
  const focusMonth = startOfMonth(providedFocusMonth ?? defaultMonth);
  const focusMonthTime = focusMonth.getTime();
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(focusMonth);
  const [selectedAgendaDate, setSelectedAgendaDate] = useState<Date | undefined>(focusMonth);

  const visibleMonthCount = !isLargeDesktop ? 1 : (providedMonthCount ?? parsedPreference.monthCount ?? 2);
  const range = search?.from && search?.to ? { from: search.from as DateOnly, to: search.to as DateOnly } : monthRange(focusMonth, visibleMonthCount);
  const query = useDeadlines({ ...search, ...range, mode: 'CALENDAR' });
  const showHolidays = parsedPreference.showHolidays;
  const holidayQuery = useDeadlineHolidays(range);
  const weekendDays = holidayQuery.data?.weekendDays ?? DEFAULT_WEEKEND_DAYS;
  const holidays = useMemo(
    () => new Map(showHolidays ? (holidayQuery.data?.holidays ?? []).map((holiday) => [holiday.date, holiday.name]) : []),
    [holidayQuery.data, showHolidays],
  );
  const items = useMemo(() => providedItems ?? (query.data?.mode === 'CALENDAR' ? query.data.items : []), [providedItems, query.data]);
  const truncated = query.data?.mode === 'CALENDAR' && query.data.truncated;
  const groupedItems = useMemo(() => {
    const groups = new Map<string, DeadlineOccurrenceDto[]>();
    for (const item of items) {
      const key = occurrenceDate(item);
      const existing = groups.get(key) ?? [];
      existing.push(item);
      groups.set(key, existing);
    }
    return groups;
  }, [items]);
  useEffect(() => {
    const nextMonth = new Date(focusMonthTime);
    setSelectedDate(nextMonth);
    setSelectedAgendaDate(nextMonth);
  }, [focusMonthTime]);

  const agendaItems = selectedAgendaDate ? eventsForDate(items, selectedAgendaDate) : [];
  const agendaHoliday = selectedAgendaDate ? holidays.get(dateOnlyFromDate(selectedAgendaDate)) : undefined;
  const eventsPerDay = isLargeDesktop ? 3 : 1;
  const showCalendarSurface = providedItems !== undefined || (!query.error && (!query.isLoading || Boolean(query.data)));

  const changeMonthCount = (value: string) => {
    const parsed = Number(value);
    if (parsed !== 1 && parsed !== 2 && parsed !== 3) return;
    const next = parsed as 1 | 2 | 3;
    onMonthCountChange?.(next);
  };

  const navigateMonth = (nextMonth: Date) => {
    const normalized = startOfMonth(nextMonth);
    setSelectedDate(normalized);
    setSelectedAgendaDate(normalized);
    onMonthChange?.(normalized);
  };

  const handleSelect = (value: Date | undefined) => {
    setSelectedDate(value);
    setSelectedAgendaDate(value);
  };

  const dayComponent = useMemo(() => {
    const Component = (props: DayProps) => <CalendarDay {...props} events={groupedItems} holidays={holidays} weekendDays={weekendDays} eventsPerDay={eventsPerDay} canEdit={canEdit} isPending={isPending} mutationError={mutationError} onUpdate={onUpdate} onResetOverride={onResetOverride} onMore={(date) => { setSelectedDate(date); setSelectedAgendaDate(date); }} />;
    return Component;
  }, [canEdit, eventsPerDay, groupedItems, holidays, weekendDays, isPending, mutationError, onResetOverride, onUpdate]);

  return (
    <section aria-label="Deadline calendar" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => navigateMonth(dateFromDateOnly(currentDateInSingapore()))} className="min-h-11 rounded-lg border border-border-primary px-3 text-xs font-medium text-text-primary hover:bg-background-tertiary">Today</button>
          <button type="button" aria-label="Previous month" onClick={() => navigateMonth(addMonths(focusMonth, -visibleMonthCount))} className="flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-border-primary text-text-primary hover:bg-background-tertiary"><ChevronLeft className="h-4 w-4" aria-hidden="true" /></button>
          <button type="button" aria-label="Next month" onClick={() => navigateMonth(addMonths(focusMonth, visibleMonthCount))} className="flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-border-primary text-text-primary hover:bg-background-tertiary"><ChevronRight className="h-4 w-4" aria-hidden="true" /></button>
        </div>
        <div className="flex flex-wrap items-center gap-4">
        <Toggle size="sm" label="Show holidays" checked={showHolidays} onChange={(checked) => onShowHolidaysChange?.(checked)} className="min-h-11 gap-2" />
        <label className="flex min-h-11 items-center gap-2 text-xs text-text-secondary"><span>Visible months</span><select aria-label="Visible months" disabled={!isLargeDesktop} value={visibleMonthCount} onChange={(event) => changeMonthCount(event.target.value)} className="min-h-11 rounded-lg border border-border-primary bg-background-secondary px-3 text-sm text-text-primary"><option value="1">1 month</option><option value="2">2 months</option><option value="3">3 months</option></select></label>
        </div>
      </div>

      {query.error && !providedItems ? <div role="alert" className="rounded-xl border border-status-error/30 bg-status-error/5 p-3 text-sm text-status-error"><div className="flex flex-wrap items-center gap-2"><span>Unable to load deadlines.</span><button type="button" onClick={() => query.refetch()} className="min-h-11 rounded-md border border-current px-3 font-medium">Retry</button></div></div> : null}
      {query.isLoading && !providedItems ? <p role="status" className="rounded-xl border border-border-primary bg-background-secondary p-6 text-center text-sm text-text-secondary">Loading calendar…</p> : null}
      {truncated ? <div role="status" className="rounded-xl border border-status-warning/30 bg-status-warning/5 p-3 text-sm text-status-warning">{(query.data?.mode === 'CALENDAR' ? query.data.warning : undefined) ?? 'Calendar results are truncated. Narrow the date range or filters to see every occurrence.'}</div> : null}
      {items.length === 0 && !query.isLoading && !query.error ? <p role="status" className="rounded-xl border border-dashed border-border-primary bg-background-secondary p-6 text-center text-sm text-text-secondary">No deadlines found for this visible range.</p> : null}
      {showCalendarSurface ? (
        <>
          <div className={cn('rounded-xl border border-border-primary bg-background-secondary p-2 sm:p-3', query.isFetching && 'opacity-70')}>
            <DayPicker
              month={focusMonth}
              onMonthChange={navigateMonth}
              mode="single"
              selected={selectedDate}
              onSelect={handleSelect}
              numberOfMonths={visibleMonthCount}
              weekStartsOn={1}
              showOutsideDays={false}
              fixedWeeks
              timeZone="Asia/Singapore"
              noonSafe
              aria-label="Deadline calendar"
              labels={{ labelGrid: (value) => `Calendar ${format(value, 'MMMM yyyy')}` }}
              classNames={{
                root: 'w-full', months: 'flex flex-wrap gap-3', month: 'min-w-0 flex-1 rounded-lg border border-border-primary bg-background-primary p-2', month_caption: 'flex items-center justify-center py-2 text-sm font-semibold text-text-primary', month_grid: 'w-full border-collapse', weekdays: 'grid grid-cols-7', weekday: 'py-1 text-center text-[10px] font-semibold uppercase tracking-wide text-text-muted', weeks: 'w-full', week: 'grid grid-cols-7', day: 'align-top', day_button: 'flex min-h-11 w-full items-start justify-center rounded-md px-1 py-1 text-xs text-text-primary hover:bg-background-tertiary [[aria-selected=true]_&]:bg-oak-primary/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-oak-primary/30', outside: 'text-text-muted/60', today: 'font-bold text-oak-light', selected: '', nav: 'hidden',
              }}
              components={{ Day: dayComponent }}
            />
          </div>

          <section aria-label="Selected day agenda" className="rounded-xl border border-border-primary bg-background-secondary p-3 sm:p-4">
            <div className="mb-3 flex items-center justify-between gap-2"><h3 className="text-sm font-semibold text-text-primary">{selectedAgendaDate ? format(selectedAgendaDate, 'EEEE, d MMMM yyyy') : 'Select a day'}{agendaHoliday ? <span className="ml-2 rounded-md bg-orange-100 px-1.5 py-0.5 text-xs font-medium text-orange-700 dark:bg-orange-500/15 dark:text-orange-300">{agendaHoliday}</span> : null}</h3><span className="text-xs text-text-secondary">{agendaItems.length} deadline{agendaItems.length === 1 ? '' : 's'}</span></div>
            {agendaItems.length > 0 ? <div className="space-y-2">{agendaItems.map((occurrence) => <DeadlineEvent key={occurrence.id} occurrence={occurrence} canEdit={canEdit} isPending={isPending} mutationError={mutationError} onUpdate={onUpdate} onResetOverride={onResetOverride} />)}</div> : <p className="text-sm text-text-secondary">No deadlines selected for this day.</p>}
          </section>
        </>
      ) : null}
    </section>
  );
}
