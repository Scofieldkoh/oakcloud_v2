'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { CalendarClock } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { ListEmptyState } from '@/components/ui/empty-state';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useMoveEngagementStart } from '@/hooks/use-client-services';
import {
  fetchFilingBillingChecks,
  useDeadlines,
  useResetDeadlineDateOverride,
  useUpdateDeadlineOccurrence,
  type DeadlineSearchInput,
} from '@/hooks/use-deadlines';
import { useServiceRosterFamilies } from '@/hooks/use-service-roster-families';
import { useUpsertUserPreference, useUserPreference } from '@/hooks/use-user-preferences';
import {
  addCalendarDays,
  addMonthsClamped,
  compareDateOnly,
  currentDateInSingapore,
  parseDateOnly,
  type DateOnly,
} from '@/services/service-schedule';
import type { DeadlineOccurrenceDto } from '@/services/deadline';
import { deadlineTimingBucketSchema, type DeadlineTimingBucket, type ResetDeadlineDateOverrideInput, type UpdateDeadlineOccurrenceInput } from '@/lib/validations/deadline';
import { DEADLINE_TIMING_BUCKET_LABELS } from './deadline-event';
import {
  defaultDeadlineViewPreference,
  parseDeadlineViewPreference,
  type DeadlineViewPreference,
} from '@/lib/validations/services-preferences';
import { useIsLargeDesktop } from '@/hooks/use-media-query';
import {
  DeadlineFilters,
  DeadlineInlineFilters,
  type DeadlineFilterOrigin,
  type DeadlineFilterStatus,
  type DeadlineFilterType,
  type DeadlineInlineFilterColumn,
  type DeadlineInlineFilterValues,
} from './deadline-filters';
import {
  DEADLINE_TABLE_COLUMNS,
  defaultDeadlineColumnWidths,
  DeadlineTable,
  type DeadlineSortBy,
  type DeadlineTableColumnId,
} from './deadline-table';
import { DeadlineCalendar } from './deadline-calendar';
import { DeadlineBulkActions } from './deadline-bulk-actions';
import { ServiceColumnModal } from '@/components/services/shared/service-column-modal';
import { BillingQuantityDialog, type BillingQuantityPromptItem } from '@/components/services/shared/billing-quantity-fields';

const VIEW_PREFERENCE_KEY = 'services.deadlines.view.v1';
const TYPE_VALUES: DeadlineFilterType[] = ['STATUTORY', 'CLIENT', 'INTERNAL'];
const STATUS_FILTER_VALUES: DeadlineFilterStatus[] = ['COMPLETED', 'WAIVED', 'CANCELLED'];
const SORT_VALUES: DeadlineSortBy[] = ['dueDate', 'company', 'family', 'service', 'type', 'status'];
const PAGE_SIZE_VALUES = [10, 20, 50, 100] as const;
const DEADLINE_COLUMN_LABELS: Record<DeadlineTableColumnId, string> = { dueDate: 'Operative due date', timing: 'Timing', company: 'Company', family: 'Family', service: 'Service', milestone: 'Milestone', type: 'Type', status: 'Status', actions: 'Actions' };
type DeadlinePageSize = (typeof PAGE_SIZE_VALUES)[number];

export interface DeadlineUrlState {
  view: 'TABLE' | 'CALENDAR';
  from: DateOnly | null;
  to: DateOnly | null;
  types: DeadlineFilterType[];
  families: string[];
  companies: string[];
  companyQuery: string;
  serviceQuery: string;
  milestoneQuery: string;
  statuses: DeadlineFilterStatus[];
  openOnly: boolean;
  origin?: DeadlineFilterOrigin;
  timingBucket?: DeadlineTimingBucket;
  sortBy: DeadlineSortBy;
  sortOrder: 'asc' | 'desc';
  page: number;
  limit: DeadlinePageSize;
}

interface DeadlineWorkspaceProps {
  canEdit?: boolean;
  deadlineWritesEnabled?: boolean;
  workspaceId?: string;
}

function readDate(value: string | null): DateOnly | null {
  if (!value) return null;
  try {
    parseDateOnly(value as DateOnly);
    return value as DateOnly;
  } catch {
    return null;
  }
}

function readUuidList(value: string | null): string[] {
  return [...new Set((value ?? '').split(',').map((part) => part.trim()).filter((part) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(part)))];
}

function readList(value: string | null): string[] {
  return [...new Set((value ?? '').split(',').map((part) => part.trim()).filter(Boolean))];
}

function readTypes(value: string | null): DeadlineFilterType[] {
  const type = readList(value).find((candidate): candidate is DeadlineFilterType => TYPE_VALUES.includes(candidate as DeadlineFilterType));
  return type ? [type] : [];
}

function readStatuses(value: string | null): DeadlineFilterStatus[] {
  return readList(value).filter((status): status is DeadlineFilterStatus => STATUS_FILTER_VALUES.includes(status as DeadlineFilterStatus));
}

function readPage(value: string | null): number {
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

function readLimit(value: string | null, fallback: DeadlinePageSize): DeadlinePageSize {
  const limit = Number(value);
  return PAGE_SIZE_VALUES.includes(limit as DeadlinePageSize) ? limit as DeadlinePageSize : fallback;
}

function readSortBy(value: string | null, fallback: DeadlineSortBy): DeadlineSortBy {
  return value && SORT_VALUES.includes(value as DeadlineSortBy) ? value as DeadlineSortBy : fallback;
}

function readSortOrder(value: string | null, fallback: 'asc' | 'desc'): 'asc' | 'desc' {
  return value === 'asc' || value === 'desc' ? value : fallback;
}

function dateFromMonth(value: DateOnly): Date {
  const [year, month] = value.split('-').map(Number);
  const result = new Date(0);
  result.setHours(12, 0, 0, 0);
  result.setFullYear(year, month - 1, 1);
  return result;
}

function monthRange(month: Date, count: number): { from: DateOnly; to: DateOnly } {
  const from = `${String(month.getFullYear()).padStart(4, '0')}-${String(month.getMonth() + 1).padStart(2, '0')}-01` as DateOnly;
  const next = addMonthsClamped(from, count);
  return { from, to: addCalendarDays(next, -1) };
}

function currentRange(today: DateOnly): { from: DateOnly; to: DateOnly } {
  try {
    return { from: today, to: addCalendarDays(today, 30) };
  } catch {
    return { from: today, to: today };
  }
}

function safeCalendarRange(focusMonth: Date, count: 1 | 2 | 3, fallback: DateOnly): { from: DateOnly; to: DateOnly } {
  try {
    return monthRange(focusMonth, count);
  } catch {
    try {
      return monthRange(dateFromMonth(`${fallback.slice(0, 7)}-01` as DateOnly), count);
    } catch {
      return { from: fallback, to: fallback };
    }
  }
}

function hasValidRange(from: DateOnly | null, to: DateOnly | null): from is DateOnly {
  if (!from || !to || compareDateOnly(from, to) > 0) return false;
  return (parseDateOnly(to).getTime() - parseDateOnly(from).getTime()) / 86_400_000 <= 366;
}

function effectiveCalendarMonthCount(preference: DeadlineViewPreference, isLargeDesktop: boolean): 1 | 2 | 3 {
  if (!isLargeDesktop) return 1;
  return preference.monthCount ?? 2;
}

export function parseDeadlineUrlState(
  searchKey: string,
  preference: DeadlineViewPreference = defaultDeadlineViewPreference,
  isLargeDesktop = true,
  today: DateOnly = currentDateInSingapore(),
): DeadlineUrlState {
  const params = new URLSearchParams(searchKey);
  const hasView = params.has('deadlineView');
  const view = params.get('deadlineView') === 'CALENDAR' || (!hasView && preference.defaultView === 'CALENDAR') ? 'CALENDAR' : 'TABLE';
  const monthCount = effectiveCalendarMonthCount(preference, isLargeDesktop);
  const candidateFrom = readDate(params.get('from'));
  const candidateTo = readDate(params.get('to'));
  const focusMonth = dateFromMonth(candidateFrom ?? `${today.slice(0, 7)}-01` as DateOnly);
  const range = view === 'CALENDAR'
    ? safeCalendarRange(focusMonth, monthCount, today)
    : params.get('dateFilter') === 'none'
      ? { from: null, to: null }
      : hasValidRange(candidateFrom, candidateTo) ? { from: candidateFrom, to: candidateTo! } : currentRange(today);
  const hasTypes = params.has('types');
  const hasFamilies = params.has('families');
  const visibleTypes = preference.visibleTypes.slice(0, 1);
  const requestedTypes = hasTypes ? readTypes(params.get('types')) : [];
  const familyIds = preference.familyIds.filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id));
  const fallbackPageSize = PAGE_SIZE_VALUES.includes(preference.pageSize as (typeof PAGE_SIZE_VALUES)[number]) ? preference.pageSize : 20;
  return {
    view,
    from: range.from,
    to: range.to,
    types: hasTypes ? requestedTypes : visibleTypes,
    families: hasFamilies ? readUuidList(params.get('families')) : familyIds,
    companies: readUuidList(params.get('companies')),
    companyQuery: params.get('companyQuery')?.trim().slice(0, 200) ?? '',
    serviceQuery: params.get('serviceQuery')?.trim().slice(0, 200) ?? '',
    milestoneQuery: params.get('milestoneQuery')?.trim().slice(0, 200) ?? '',
    statuses: readStatuses(params.get('statuses')),
    openOnly: params.has('openOnly') ? params.get('openOnly') === 'true' : true,
    origin: params.get('origin') === 'RULE' || params.get('origin') === 'MANUAL_TRIGGER' ? params.get('origin') as DeadlineFilterOrigin : undefined,
    timingBucket: deadlineTimingBucketSchema.safeParse(params.get('timingBucket')).data,
    sortBy: readSortBy(params.get('sortBy'), preference.sortBy),
    sortOrder: readSortOrder(params.get('sortOrder'), preference.sortOrder),
    page: readPage(params.get('page')),
    limit: readLimit(params.get('limit'), fallbackPageSize),
  };
}

export { defaultDeadlineViewPreference } from '@/lib/validations/services-preferences';

function formatBadgeValue(value: string): string {
  const normalized = value.toLowerCase().replaceAll(/[-_]+/g, ' ');
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

export function DeadlineViewToggle() {
  const isLargeDesktop = useIsLargeDesktop();
  const preference = useUserPreference<DeadlineViewPreference>(VIEW_PREFERENCE_KEY);
  const savePreference = useUpsertUserPreference<DeadlineViewPreference>();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const canonicalSearchKey = searchParams.toString();
  const [optimisticSearchKey, setOptimisticSearchKey] = useState<string | null>(null);
  const effectiveSearchKey = optimisticSearchKey ?? canonicalSearchKey;
  const parsedPreference = useMemo(
    () => parseDeadlineViewPreference(preference.data?.value),
    [preference.data?.value],
  );
  const urlState = useMemo(
    () => parseDeadlineUrlState(effectiveSearchKey, parsedPreference, isLargeDesktop),
    [effectiveSearchKey, isLargeDesktop, parsedPreference],
  );
  const calendarMonthCount = effectiveCalendarMonthCount(parsedPreference, isLargeDesktop);

  useEffect(() => setOptimisticSearchKey(null), [canonicalSearchKey]);

  const replaceUrl = useCallback((next: Partial<Record<string, string | undefined>>) => {
    const params = new URLSearchParams(effectiveSearchKey);
    for (const [key, value] of Object.entries(next)) {
      if (value === undefined || value === '') params.delete(key);
      else params.set(key, value);
    }
    const nextKey = params.toString();
    setOptimisticSearchKey(nextKey);
    router.replace(nextKey ? `${pathname}?${nextKey}` : pathname, { scroll: false });
  }, [effectiveSearchKey, pathname, router]);

  const switchView = useCallback((view: 'TABLE' | 'CALENDAR') => {
    const range = view === 'CALENDAR'
      ? monthRange(dateFromMonth(urlState.from ?? currentDateInSingapore()), calendarMonthCount)
      : { from: urlState.from, to: urlState.to };
    replaceUrl({ deadlineView: view, from: range.from ?? undefined, to: range.to ?? undefined, dateFilter: view === 'TABLE' && (!range.from || !range.to) ? 'none' : undefined, page: '1' });
    savePreference.mutate({ key: VIEW_PREFERENCE_KEY, value: { ...parsedPreference, defaultView: view, version: 1 } });
  }, [calendarMonthCount, parsedPreference, replaceUrl, savePreference, urlState.from, urlState.to]);

  return (
    <div role="group" aria-label="Deadline view" className="inline-flex min-h-11 items-center rounded-xl border border-border-primary bg-background-secondary p-1 sm:min-h-8">
      <button type="button" aria-pressed={urlState.view === 'TABLE'} onClick={() => switchView('TABLE')} className={urlState.view === 'TABLE' ? 'min-h-11 rounded-lg bg-oak-primary px-3 text-xs font-medium text-white sm:min-h-8' : 'min-h-11 rounded-lg px-3 text-xs font-medium text-text-secondary hover:text-text-primary sm:min-h-8'}>Table view</button>
      <button type="button" aria-pressed={urlState.view === 'CALENDAR'} onClick={() => switchView('CALENDAR')} className={urlState.view === 'CALENDAR' ? 'min-h-11 rounded-lg bg-oak-primary px-3 text-xs font-medium text-white sm:min-h-8' : 'min-h-11 rounded-lg px-3 text-xs font-medium text-text-secondary hover:text-text-primary sm:min-h-8'}>Calendar view</button>
    </div>
  );
}

export function DeadlineWorkspace({ canEdit = false, deadlineWritesEnabled = false }: DeadlineWorkspaceProps) {
  const isLargeDesktop = useIsLargeDesktop();
  const preference = useUserPreference<DeadlineViewPreference>(VIEW_PREFERENCE_KEY);
  const savePreference = useUpsertUserPreference<DeadlineViewPreference>();
  const familyFacets = useServiceRosterFamilies();
  const parsedPreference = useMemo(
    () => parseDeadlineViewPreference(preference.data?.value),
    [preference.data?.value],
  );
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const canonicalSearchKey = searchParams.toString();
  const [optimisticSearchKey, setOptimisticSearchKey] = useState<string | null>(null);
  const effectiveSearchKey = optimisticSearchKey ?? canonicalSearchKey;
  const preferenceReady = useRef(false);
  const resizeSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPreferencePatch = useRef<Partial<DeadlineViewPreference>>({});
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [columnOrder, setColumnOrder] = useState<DeadlineTableColumnId[]>([...DEADLINE_TABLE_COLUMNS]);
  const [columnVisibility, setColumnVisibility] = useState<Record<DeadlineTableColumnId, boolean>>(
    Object.fromEntries(DEADLINE_TABLE_COLUMNS.map((column) => [column, true])) as Record<DeadlineTableColumnId, boolean>,
  );
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [savedTypes, setSavedTypes] = useState<DeadlineFilterType[]>(defaultDeadlineViewPreference.visibleTypes);
  const [savedFamilies, setSavedFamilies] = useState<string[]>(defaultDeadlineViewPreference.familyIds);
  const [calendarMonthCountOverride, setCalendarMonthCountOverride] = useState<1 | 2 | 3 | null>(null);
  const [showHolidaysOverride, setShowHolidaysOverride] = useState<boolean | null>(null);
  const [selectedDeadlineIds, setSelectedDeadlineIds] = useState<Set<string>>(new Set());

  useEffect(() => setOptimisticSearchKey(null), [canonicalSearchKey]);
  useEffect(() => {
    if (preference.isLoading || preferenceReady.current) return;
    setColumnWidths(parsedPreference.tableColumnWidths);
    setColumnOrder(parsedPreference.tableColumnOrder.length > 0 ? parsedPreference.tableColumnOrder as DeadlineTableColumnId[] : [...DEADLINE_TABLE_COLUMNS]);
    setColumnVisibility(Object.fromEntries(DEADLINE_TABLE_COLUMNS.map((column) => [column, parsedPreference.tableColumnVisibility[column] !== false])) as Record<DeadlineTableColumnId, boolean>);
    setSavedTypes(parsedPreference.visibleTypes);
    setSavedFamilies(parsedPreference.familyIds);
    preferenceReady.current = true;
  }, [parsedPreference, preference.isLoading]);

  const urlState = useMemo(
    () => parseDeadlineUrlState(effectiveSearchKey, calendarMonthCountOverride === null ? parsedPreference : { ...parsedPreference, monthCount: calendarMonthCountOverride }, isLargeDesktop),
    [calendarMonthCountOverride, effectiveSearchKey, isLargeDesktop, parsedPreference],
  );

  const replaceUrl = useCallback((next: Partial<Record<string, string | undefined>>) => {
    const params = new URLSearchParams(effectiveSearchKey);
    for (const [key, value] of Object.entries(next)) {
      if (value === undefined || value === '') params.delete(key);
      else params.set(key, value);
    }
    const nextKey = params.toString();
    setOptimisticSearchKey(nextKey);
    router.replace(nextKey ? `${pathname}?${nextKey}` : pathname, { scroll: false });
  }, [effectiveSearchKey, pathname, router]);

  const currentPreference = useMemo<DeadlineViewPreference>(() => ({
    ...parsedPreference,
    version: 1,
    visibleTypes: savedTypes,
    familyIds: savedFamilies,
    tableColumnWidths: columnWidths,
    tableColumnOrder: columnOrder,
    tableColumnVisibility: columnVisibility,
    pageSize: urlState.limit,
    monthCount: calendarMonthCountOverride ?? parsedPreference.monthCount,
    showHolidays: showHolidaysOverride ?? parsedPreference.showHolidays,
  }), [calendarMonthCountOverride, showHolidaysOverride, columnOrder, columnVisibility, columnWidths, parsedPreference, savedFamilies, savedTypes, urlState.limit]);
  const currentPreferenceRef = useRef(currentPreference);
  currentPreferenceRef.current = currentPreference;

  const persistPreference = useCallback((patch: Partial<DeadlineViewPreference>, debounce = false) => {
    if (!preferenceReady.current) return;
    if (debounce) {
      pendingPreferencePatch.current = { ...pendingPreferencePatch.current, ...patch };
      if (resizeSaveTimer.current) clearTimeout(resizeSaveTimer.current);
      resizeSaveTimer.current = setTimeout(() => {
        const value = { ...currentPreferenceRef.current, ...pendingPreferencePatch.current, version: 1 as const };
        pendingPreferencePatch.current = {};
        savePreference.mutate({ key: VIEW_PREFERENCE_KEY, value });
        resizeSaveTimer.current = null;
      }, 250);
      return;
    }
    if (resizeSaveTimer.current) {
      clearTimeout(resizeSaveTimer.current);
      resizeSaveTimer.current = null;
    }
    const value = { ...currentPreferenceRef.current, ...pendingPreferencePatch.current, ...patch, version: 1 as const };
    pendingPreferencePatch.current = {};
    currentPreferenceRef.current = value;
    savePreference.mutate({ key: VIEW_PREFERENCE_KEY, value });
  }, [savePreference]);

  useEffect(() => () => {
    if (resizeSaveTimer.current) clearTimeout(resizeSaveTimer.current);
    resizeSaveTimer.current = null;
    pendingPreferencePatch.current = {};
  }, []);

  const paramsForRange = useMemo(() => {
    const params = new URLSearchParams(effectiveSearchKey);
    return { from: readDate(params.get('from')), to: readDate(params.get('to')), rawFrom: params.get('from'), rawTo: params.get('to'), rawPage: params.get('page') };
  }, [effectiveSearchKey]);

  useEffect(() => {
    const calendarRangeChanged = urlState.view === 'CALENDAR' && (paramsForRange.rawFrom !== urlState.from || paramsForRange.rawTo !== urlState.to || paramsForRange.rawPage !== '1');
    const tableRangeInvalid = urlState.view === 'TABLE'
      && new URLSearchParams(effectiveSearchKey).get('dateFilter') !== 'none'
      && !hasValidRange(paramsForRange.from, paramsForRange.to);
    if (!calendarRangeChanged && !tableRangeInvalid) return;
    replaceUrl({ from: urlState.from ?? undefined, to: urlState.to ?? undefined, dateFilter: urlState.from && urlState.to ? undefined : 'none', page: '1' });
  }, [effectiveSearchKey, paramsForRange.from, paramsForRange.rawFrom, paramsForRange.rawPage, paramsForRange.rawTo, paramsForRange.to, replaceUrl, urlState.from, urlState.to, urlState.view]);

  const query: DeadlineSearchInput = {
    from: urlState.from ?? undefined,
    to: urlState.to ?? undefined,
    mode: urlState.view,
    types: urlState.types,
    familyIds: urlState.families,
    companyIds: urlState.companies,
    companyQuery: urlState.companyQuery,
    serviceQuery: urlState.serviceQuery,
    milestoneQuery: urlState.milestoneQuery,
    statuses: urlState.statuses,
    openOnly: urlState.openOnly,
    origin: urlState.origin,
    timingBucket: urlState.timingBucket,
    page: urlState.page,
    limit: urlState.limit,
    sortBy: urlState.sortBy,
    sortOrder: urlState.sortOrder,
  };
  const deadlines = useDeadlines(query);
  const updateDeadline = useUpdateDeadlineOccurrence();
  const moveEngagementStart = useMoveEngagementStart();
  const [engagementStartPrompt, setEngagementStartPrompt] = useState<{
    companyId: string;
    yearOfAssessment: number;
    services: NonNullable<DeadlineOccurrenceDto['postpaidEngagementStartConflicts']>;
  } | null>(null);
  const [quantityPrompt, setQuantityPrompt] = useState<{
    occurrence: DeadlineOccurrenceDto;
    data: UpdateDeadlineOccurrenceInput;
    prompts: BillingQuantityPromptItem[];
  } | null>(null);
  const resetDeadline = useResetDeadlineDateOverride();
  const families = familyFacets.data ?? [];
  const allFamiliesSelected = urlState.families.length === 0;
  const canWrite = canEdit && deadlineWritesEnabled;
  const calendarMonthCount = !isLargeDesktop ? 1 : (calendarMonthCountOverride ?? parsedPreference.monthCount ?? 2);
  const deadlineItems = deadlines.data?.items;
  const items = useMemo(() => deadlineItems ?? [], [deadlineItems]);

  useEffect(() => {
    const visibleIds = new Set(items.map((occurrence) => occurrence.id));
    setSelectedDeadlineIds((current) => {
      const next = new Set([...current].filter((id) => visibleIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [items]);

  const toggleDeadlineSelection = useCallback((occurrence: DeadlineOccurrenceDto) => {
    setSelectedDeadlineIds((current) => {
      const next = new Set(current);
      if (next.has(occurrence.id)) next.delete(occurrence.id);
      else next.add(occurrence.id);
      return next;
    });
  }, []);

  const toggleAllDeadlineSelection = useCallback(() => {
    setSelectedDeadlineIds((current) => {
      const allVisibleSelected = items.length > 0 && items.every((occurrence) => current.has(occurrence.id));
      const next = new Set(current);
      for (const occurrence of items) {
        if (allVisibleSelected) next.delete(occurrence.id);
        else next.add(occurrence.id);
      }
      return next;
    });
  }, [items]);

  const clearDeadlineSelection = useCallback(() => setSelectedDeadlineIds(new Set()), []);
  const selectedDeadlines = useMemo(
    () => items.filter((occurrence) => selectedDeadlineIds.has(occurrence.id)),
    [items, selectedDeadlineIds],
  );

  const updateTypes = (type?: DeadlineFilterType) => {
    const nextTypes = type && TYPE_VALUES.includes(type) ? [type] : [];
    setSavedTypes(nextTypes);
    replaceUrl({ types: nextTypes.length > 0 ? nextTypes.join(',') : undefined, page: '1' });
    persistPreference({ visibleTypes: nextTypes });
  };

  const updateFamily = (familyId: string) => {
    const allIds = families.map((family) => family.id);
    const selected = new Set(urlState.families);
    if (selected.has(familyId)) selected.delete(familyId);
    else selected.add(familyId);
    const next = [...selected].filter((id) => allIds.includes(id));
    setSavedFamilies(next);
    replaceUrl({ families: next.length > 0 ? next.join(',') : undefined, page: '1' });
    persistPreference({ familyIds: next });
  };

  const updateInlineFamily = (familyId: string) => {
    const next = familyId && families.some((family) => family.id === familyId) ? [familyId] : [];
    setSavedFamilies(next);
    replaceUrl({ families: next.length > 0 ? next.join(',') : undefined, page: '1' });
    persistPreference({ familyIds: next });
  };

  const updateTextFilter = (key: 'companyQuery' | 'serviceQuery' | 'milestoneQuery', value: string) => {
    replaceUrl({
      [key]: value.trim() || undefined,
      page: '1',
    });
  };

  const updateStatuses = (nextStatuses: readonly DeadlineFilterStatus[]) => {
    const statuses = [...new Set(nextStatuses)].filter((status): status is DeadlineFilterStatus => STATUS_FILTER_VALUES.includes(status));
    replaceUrl({
      statuses: statuses.length > 0 ? statuses.join(',') : undefined,
      openOnly: statuses.length > 0 ? 'false' : undefined,
      page: '1',
    });
  };

  const toggleStatus = (status: DeadlineFilterStatus) => {
    const selected = new Set(urlState.statuses);
    if (selected.has(status)) selected.delete(status);
    else selected.add(status);
    updateStatuses([...selected]);
  };

  const toggleOrigin = (origin: DeadlineFilterOrigin) => {
    replaceUrl({ origin: urlState.origin === origin ? undefined : origin, page: '1' });
  };

  const updateInlineOrigin = (origin?: DeadlineFilterOrigin) => {
    replaceUrl({ origin: origin || undefined, page: '1' });
  };

  const updateInlineFilters = (next: Partial<DeadlineInlineFilterValues>) => {
    if ('companyQuery' in next) updateTextFilter('companyQuery', next.companyQuery ?? '');
    if ('serviceQuery' in next) updateTextFilter('serviceQuery', next.serviceQuery ?? '');
    if ('milestoneQuery' in next) updateTextFilter('milestoneQuery', next.milestoneQuery ?? '');
    if ('familyId' in next) updateInlineFamily(next.familyId ?? '');
    if ('type' in next) updateTypes(next.type || undefined);
    if ('status' in next) updateStatuses(next.status ? [next.status] : []);
    if ('origin' in next) updateInlineOrigin(next.origin || undefined);
    if ('timingBucket' in next) replaceUrl({ timingBucket: next.timingBucket || undefined, page: '1' });
    if ('dateFrom' in next || 'dateTo' in next) {
      const from = next.dateFrom ?? '';
      const to = next.dateTo ?? '';
      replaceUrl({ from: from || undefined, to: to || undefined, dateFilter: from && to ? undefined : 'none', page: '1' });
    }
  };

  const inlineFilters: DeadlineInlineFilterValues = {
    companyQuery: urlState.companyQuery,
    serviceQuery: urlState.serviceQuery,
    milestoneQuery: urlState.milestoneQuery,
    familyId: urlState.families.length === 1 ? urlState.families[0]! : '',
    type: urlState.types.length === 1 ? urlState.types[0]! : '',
    status: urlState.statuses.length === 1 ? urlState.statuses[0] as Exclude<DeadlineFilterStatus, 'OPEN'> : '',
    origin: urlState.origin ?? '',
    timingBucket: urlState.timingBucket ?? '',
    dateFrom: urlState.from ?? '',
    dateTo: urlState.to ?? '',
  };

  const toggleOpenOnly = () => {
    const isOpenShortcutActive = urlState.openOnly && urlState.statuses.length === 0;
    replaceUrl(isOpenShortcutActive
      ? { openOnly: 'false', page: '1' }
      : { openOnly: undefined, statuses: undefined, page: '1' });
  };

  const handleCalendarMonthChange = (month: Date) => {
    const range = monthRange(month, calendarMonthCount);
    replaceUrl({ from: range.from, to: range.to, page: '1' });
  };

  const handleCalendarMonthCountChange = (monthCount: 1 | 2 | 3) => {
    setCalendarMonthCountOverride(monthCount);
    persistPreference({ monthCount });
    const visibleCount = isLargeDesktop ? monthCount : 1;
    const range = monthRange(dateFromMonth(urlState.from ?? currentDateInSingapore()), visibleCount);
    replaceUrl({ from: range.from, to: range.to, page: '1' });
  };

  const handleShowHolidaysChange = (showHolidays: boolean) => {
    setShowHolidaysOverride(showHolidays);
    persistPreference({ showHolidays });
  };

  const submitUpdate = useCallback((occurrence: DeadlineOccurrenceDto, data: UpdateDeadlineOccurrenceInput) => {
    updateDeadline.mutate({ id: occurrence.id, data }, {
      onSuccess: (saved) => {
        // Filed before a postpaid service's engagement start bills nothing,
        // so offer to move the start back to this YA.
        const conflicts = saved.postpaidEngagementStartConflicts ?? [];
        const yearOfAssessment = saved.obligation?.yearOfAssessment;
        if (conflicts.length > 0 && yearOfAssessment != null) {
          setEngagementStartPrompt({ companyId: saved.companyId, yearOfAssessment, services: conflicts });
        }
      },
    });
  }, [updateDeadline]);
  const markUpdate = useCallback(async (occurrence: DeadlineOccurrenceDto, data: UpdateDeadlineOccurrenceInput) => {
    if (!canWrite) return;
    // Marking a filing complete asks for the quantity of any tiered postpaid
    // fee it bills. If the check fails, the entry is still raised and flagged.
    if (data.status === 'COMPLETED' && occurrence.ownershipScope === 'COMPANY' && occurrence.obligation?.yearOfAssessment != null) {
      const prompts = await fetchFilingBillingChecks([occurrence.id])
        .then((checks) => checks.quantityPrompts.find((item) => item.occurrenceId === occurrence.id)?.prompts ?? [])
        .catch(() => []);
      if (prompts.length > 0) {
        setQuantityPrompt({ occurrence, data, prompts: prompts.map((prompt) => ({ ...prompt, key: prompt.feeLineId })) });
        return;
      }
    }
    submitUpdate(occurrence, data);
  }, [canWrite, submitUpdate]);
  const resetOverride = useCallback((occurrence: DeadlineOccurrenceDto, reason: string) => {
    if (!canWrite) return;
    const data: ResetDeadlineDateOverrideInput = { expectedUpdatedAt: occurrence.updatedAt, reason };
    resetDeadline.mutate({ id: occurrence.id, data });
  }, [canWrite, resetDeadline]);
  const bulkUpdate = useCallback((occurrence: DeadlineOccurrenceDto, data: UpdateDeadlineOccurrenceInput) => {
    if (!canWrite) return Promise.reject(new Error('Deadline updates are unavailable'));
    return updateDeadline.mutateAsync({ id: occurrence.id, data });
  }, [canWrite, updateDeadline]);

  const activeBadges: Array<{ key: string; label: string; onRemove: () => void }> = [];
  for (const type of urlState.types) {
    activeBadges.push({ key: `type-${type}`, label: `Type: ${formatBadgeValue(type)}`, onRemove: () => updateTypes(undefined) });
  }
  if (urlState.statuses.length > 0) activeBadges.push({ key: 'statuses', label: `Status: ${urlState.statuses.map(formatBadgeValue).join(', ')}`, onRemove: () => updateStatuses([]) });
  else if (urlState.openOnly) activeBadges.push({ key: 'openOnly', label: 'Status: Open', onRemove: () => replaceUrl({ openOnly: 'false', page: '1' }) });
  if (!allFamiliesSelected) {
    for (const family of families.filter((item) => urlState.families.includes(item.id))) activeBadges.push({ key: `family-${family.id}`, label: `Family: ${family.name}`, onRemove: () => updateFamily(family.id) });
  }
  if (urlState.companyQuery) activeBadges.push({ key: 'companyQuery', label: `Company: ${urlState.companyQuery}`, onRemove: () => updateTextFilter('companyQuery', '') });
  if (urlState.serviceQuery) activeBadges.push({ key: 'serviceQuery', label: `Service: ${urlState.serviceQuery}`, onRemove: () => updateTextFilter('serviceQuery', '') });
  if (urlState.milestoneQuery) activeBadges.push({ key: 'milestoneQuery', label: `Milestone: ${urlState.milestoneQuery}`, onRemove: () => updateTextFilter('milestoneQuery', '') });
  if (urlState.timingBucket) activeBadges.push({ key: 'timingBucket', label: `Timing: ${DEADLINE_TIMING_BUCKET_LABELS[urlState.timingBucket]}`, onRemove: () => replaceUrl({ timingBucket: undefined, page: '1' }) });
  if (urlState.origin) activeBadges.push({ key: 'origin', label: `Source: ${formatBadgeValue(urlState.origin)}`, onRemove: () => toggleOrigin(urlState.origin!) });
  if (urlState.companies.length > 0) activeBadges.push({ key: 'companies', label: `Companies: ${urlState.companies.length} selected`, onRemove: () => replaceUrl({ companies: undefined, page: '1' }) });
  if (urlState.view === 'TABLE' && urlState.from && urlState.to) {
    activeBadges.push({ key: 'dueRange', label: `Date: ${urlState.from} – ${urlState.to}`, onRemove: () => replaceUrl({ from: undefined, to: undefined, dateFilter: 'none', page: '1' }) });
  }

  const clearAllFilters = () => {
    setSavedTypes([]);
    setSavedFamilies([]);
    persistPreference({ visibleTypes: [], familyIds: [] });
    replaceUrl({
      types: undefined,
      families: undefined,
      statuses: undefined,
      openOnly: 'false',
      companyQuery: undefined,
      serviceQuery: undefined,
      milestoneQuery: undefined,
      timingBucket: undefined,
      origin: undefined,
      companies: undefined,
      ...(urlState.view === 'TABLE' ? { from: undefined, to: undefined, dateFilter: 'none' } : {}),
      page: '1',
    });
  };

  const total = deadlines.data?.mode === 'TABLE' ? deadlines.data.total : 0;
  const totalPages = deadlines.data?.mode === 'TABLE' ? deadlines.data.totalPages : 0;
  const visibleColumns = useMemo(() => {
    const columns = columnOrder.filter((column) => columnVisibility[column]);
    return columns.length > 0 ? columns : ['actions' as DeadlineTableColumnId];
  }, [columnOrder, columnVisibility]);
  const inlineFilterColumns = useMemo<DeadlineInlineFilterColumn[]>(
    () => [
      { id: 'selection', width: 48 },
      ...visibleColumns.map((column) => ({ id: column, width: columnWidths[column] ?? defaultDeadlineColumnWidths[column] })),
    ],
    [columnWidths, visibleColumns],
  );
  const showTableSurface = !deadlines.error && !deadlines.isLoading && deadlines.data?.mode === 'TABLE';
  const showCalendarSurface = !deadlines.error && (!deadlines.isLoading || Boolean(deadlines.data));

  return (
    <section aria-label="Deadline workspace" className="space-y-4">
      <DeadlineFilters
        families={families}
        selectedFamilyIds={urlState.families}
        companyQuery={urlState.companyQuery}
        serviceQuery={urlState.serviceQuery}
        milestoneQuery={urlState.milestoneQuery}
        selectedTypes={urlState.types}
        selectedStatuses={urlState.statuses}
        selectedOrigin={urlState.origin}
        openOnly={urlState.openOnly}
        onCompanyQueryChange={(value) => updateTextFilter('companyQuery', value)}
        onServiceQueryChange={(value) => updateTextFilter('serviceQuery', value)}
        onMilestoneQueryChange={(value) => updateTextFilter('milestoneQuery', value)}
        onTypeChange={updateTypes}
        onToggleStatus={toggleStatus}
        onToggleOrigin={toggleOrigin}
        onToggleFamily={updateFamily}
        onToggleOpenOnly={toggleOpenOnly}
        dateFrom={urlState.from ?? ''}
        dateTo={urlState.to ?? ''}
        onDateRangeChange={(from, to) => replaceUrl({ from: from || undefined, to: to || undefined, dateFilter: from && to ? undefined : 'none', page: '1' })}
        onAdjustColumns={urlState.view === 'TABLE' ? () => setColumnsOpen(true) : undefined}
        hiddenColumnCount={DEADLINE_TABLE_COLUMNS.filter((column) => column !== 'actions' && !columnVisibility[column]).length}
      />
      {familyFacets.error ? (
        <Alert variant="error" title="Family filters unavailable">
          <div className="flex flex-wrap items-center gap-2">
            <span>{familyFacets.error instanceof Error ? familyFacets.error.message : 'Unable to load family filters.'}</span>
            <button type="button" aria-label="Retry family filters" onClick={() => familyFacets.refetch()} className="min-h-11 rounded-md border border-current px-3 text-sm font-medium sm:min-h-8">Retry</button>
          </div>
        </Alert>
      ) : null}

      {activeBadges.length > 0 ? (
        <div aria-label="Active deadline filters" className="flex flex-wrap items-center gap-2">
          {activeBadges.map((badge) => <button key={badge.key} type="button" onClick={badge.onRemove} className="inline-flex min-h-11 items-center rounded-full bg-oak-primary/10 px-3 text-xs text-oak-light hover:bg-oak-primary/20 sm:min-h-8" aria-label={`Remove ${badge.label}`}>{badge.label}<span aria-hidden="true" className="ml-1">×</span></button>)}
          <button type="button" onClick={clearAllFilters} className="ml-2 text-sm font-medium text-oak-primary transition-colors hover:text-oak-primary/80">Clear all</button>
        </div>
      ) : null}

      {(deadlines.data?.awarenessItems?.length ?? 0) > 0 ? (
        <Alert variant="warning" title="Compliance attention">
          <div className="space-y-2">
            {deadlines.data!.awarenessItems.map((item) => (
              <div key={item.id} className="text-sm">
                <span className="font-medium">{item.company.displayAlias || item.company.name}</span>
                {' · '}
                <span>{item.milestoneName}</span>
                {' · '}
                <span>{item.dueDate}</span>
                {' — '}
                <span>{item.message}</span>
              </div>
            ))}
          </div>
        </Alert>
      ) : null}

      {deadlines.error ? (
        <Alert variant="error" title="Unable to load deadlines">
          <div className="flex flex-wrap items-center gap-2">
            <span>{deadlines.error instanceof Error ? deadlines.error.message : 'Please retry the deadline query.'}</span>
            <button type="button" onClick={() => deadlines.refetch()} className="min-h-11 rounded-md border border-current px-3 text-sm font-medium sm:min-h-8">Retry</button>
          </div>
        </Alert>
      ) : null}
      {deadlines.isLoading && !deadlines.data ? <div role="status" className="rounded-xl border border-border-primary bg-background-secondary p-8 text-center text-sm text-text-secondary">Loading deadlines…</div> : null}
      {(updateDeadline.isPending || resetDeadline.isPending) ? <div role="status" className="rounded-xl border border-border-primary bg-background-secondary p-3 text-sm text-text-secondary">Saving deadline changes…</div> : null}
      {updateDeadline.error || resetDeadline.error ? <Alert variant="error">Unable to save deadline changes. Please retry.</Alert> : null}
      {moveEngagementStart.error ? <Alert variant="error">Unable to move the engagement start. Please change it on the service.</Alert> : null}
      <BillingQuantityDialog
        isOpen={quantityPrompt !== null}
        title={quantityPrompt ? `Mark complete: ${quantityPrompt.occurrence.company.displayLabel || quantityPrompt.occurrence.company.name} YA ${quantityPrompt.occurrence.obligation?.yearOfAssessment ?? ''}` : 'Mark complete'}
        prompts={quantityPrompt?.prompts ?? []}
        confirmLabel="Mark complete"
        onClose={() => setQuantityPrompt(null)}
        onConfirm={(billingQuantities) => {
          if (!quantityPrompt) return;
          const { occurrence, data } = quantityPrompt;
          setQuantityPrompt(null);
          submitUpdate(occurrence, billingQuantities.length > 0 ? { ...data, billingQuantities } : data);
        }}
      />
      <ConfirmDialog
        isOpen={engagementStartPrompt !== null}
        onClose={() => setEngagementStartPrompt(null)}
        onConfirm={async () => {
          if (!engagementStartPrompt) return;
          const { companyId, yearOfAssessment, services } = engagementStartPrompt;
          setEngagementStartPrompt(null);
          await moveEngagementStart.mutateAsync({
            companyId,
            yearOfAssessment,
            serviceIds: services.map((service) => service.clientServiceId),
          });
        }}
        title={`Start engagement from YA ${engagementStartPrompt?.yearOfAssessment ?? ''}?`}
        description={engagementStartPrompt ? (
          <>
            YA {engagementStartPrompt.yearOfAssessment} is before the engagement start of{' '}
            {engagementStartPrompt.services.map((service) => `${service.serviceName} (YA ${service.engagementStartYearOfAssessment})`).join(', ')},
            {' '}so this filing won&apos;t raise a postpaid bill. Move the engagement start to YA {engagementStartPrompt.yearOfAssessment} so it bills?
          </>
        ) : undefined}
        confirmLabel={`Start from YA ${engagementStartPrompt?.yearOfAssessment ?? ''}`}
        cancelLabel="Keep current start"
        variant="info"
        isLoading={moveEngagementStart.isPending}
      />

      {urlState.view === 'TABLE' ? (
        <>
          <ServiceColumnModal
            isOpen={columnsOpen}
            onClose={() => setColumnsOpen(false)}
            columns={columnOrder.map((id) => ({ id, label: DEADLINE_COLUMN_LABELS[id], locked: id === 'actions' }))}
            visibility={columnVisibility}
            onToggle={(column) => { if (column === 'actions') return; const next = { ...columnVisibility, [column]: !columnVisibility[column] }; setColumnVisibility(next); persistPreference({ tableColumnVisibility: next }); }}
            onMove={(column, direction) => { const index = columnOrder.indexOf(column); const nextIndex = index + direction; if (index < 0 || nextIndex < 0 || nextIndex >= columnOrder.length) return; const next = [...columnOrder]; [next[index], next[nextIndex]] = [next[nextIndex]!, next[index]!]; setColumnOrder(next); persistPreference({ tableColumnOrder: next }); }}
            onShowAll={() => { const next = Object.fromEntries(DEADLINE_TABLE_COLUMNS.map((column) => [column, true])) as Record<DeadlineTableColumnId, boolean>; setColumnVisibility(next); persistPreference({ tableColumnVisibility: next }); }}
            onResetWidths={() => { setColumnWidths({}); persistPreference({ tableColumnWidths: {} }); }}
          />
          {showTableSurface ? (
              <DeadlineTable
              items={items}
              emptyState={(
                <ListEmptyState
                  icon={CalendarClock}
                  noun="deadlines"
                  filtered={activeBadges.length > 0}
                  onClearFilters={clearAllFilters}
                  emptyDescription="Deadlines appear here when a published deadline rule covers a client service."
                />
              )}
              isFetching={deadlines.isFetching}
              page={deadlines.data?.mode === 'TABLE' ? deadlines.data.page : urlState.page}
              total={total}
              limit={deadlines.data?.mode === 'TABLE' ? deadlines.data.limit : urlState.limit}
              totalPages={totalPages}
              sortBy={urlState.sortBy}
              sortOrder={urlState.sortOrder}
              columnWidths={columnWidths}
              columnOrder={visibleColumns}
              columnVisibility={columnVisibility}
              canEdit={canWrite}
              isPending={updateDeadline.isPending || resetDeadline.isPending}
              mutationError={updateDeadline.error ?? resetDeadline.error}
              onUpdate={markUpdate}
              onResetOverride={resetOverride}
              inlineFilters={(
                <DeadlineInlineFilters
                  families={families}
                  values={inlineFilters}
                  tableColumns={inlineFilterColumns}
                  onChange={updateInlineFilters}
                />
              )}
              selectedIds={selectedDeadlineIds}
              onToggleSelection={toggleDeadlineSelection}
              onToggleSelectAll={toggleAllDeadlineSelection}
              onSort={(sortBy) => { const sortOrder = urlState.sortBy === sortBy && urlState.sortOrder === 'asc' ? 'desc' : 'asc'; replaceUrl({ sortBy, sortOrder, page: '1' }); persistPreference({ sortBy, sortOrder }); }}
              onPageChange={(page) => replaceUrl({ page: String(page) })}
              onLimitChange={(limit) => { const safeLimit: DeadlinePageSize = PAGE_SIZE_VALUES.includes(limit as DeadlinePageSize) ? limit as DeadlinePageSize : 20; replaceUrl({ limit: String(safeLimit), page: '1' }); persistPreference({ pageSize: safeLimit }); }}
              onColumnWidthChange={(columnId, width) => setColumnWidths((current) => ({ ...current, [columnId]: Math.round(width) }))}
              onColumnResizeEnd={(columnId, width) => { const next = { ...columnWidths, [columnId]: Math.round(width) }; setColumnWidths(next); persistPreference({ tableColumnWidths: next }, true); }}
            />
          ) : null}
          {canWrite ? <DeadlineBulkActions selected={selectedDeadlines} onClearSelection={clearDeadlineSelection} onUpdate={bulkUpdate} /> : null}
        </>
      ) : showCalendarSurface ? (
        <DeadlineCalendar
          items={undefined}
          focusMonth={dateFromMonth(urlState.from ?? currentDateInSingapore())}
          monthCount={calendarMonthCount}
          preferenceValue={currentPreference}
          search={query}
          canEdit={canWrite}
          isPending={updateDeadline.isPending || resetDeadline.isPending}
          mutationError={updateDeadline.error ?? resetDeadline.error}
          onMonthChange={handleCalendarMonthChange}
          onMonthCountChange={handleCalendarMonthCountChange}
          onShowHolidaysChange={handleShowHolidaysChange}
          onUpdate={markUpdate}
          onResetOverride={resetOverride}
        />
      ) : null}
    </section>
  );
}
