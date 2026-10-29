import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  defaultDeadlineViewPreference,
  parseDeadlineUrlState,
} from '@/components/services/deadlines/deadline-workspace';
import { parseDeadlineSearchParams } from '@/lib/validations/deadline';
import { parseDeadlineViewPreference } from '@/lib/validations/services-preferences';
import { addCalendarDays, addMonthsClamped, currentDateInSingapore, type DateOnly } from '@/services/service-schedule';

const hooks = vi.hoisted(() => ({
  useDeadlines: vi.fn(),
  useUpdateDeadlineOccurrence: vi.fn(),
  useResetDeadlineDateOverride: vi.fn(),
  useServiceRosterFamilies: vi.fn(),
  useUserPreference: vi.fn(),
  useUpsertUserPreference: vi.fn(),
  preferenceMutation: vi.fn(),
}));

const navigation = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
  replace: vi.fn(),
}));
const media = vi.hoisted(() => ({ isLargeDesktop: vi.fn(() => true) }));

vi.mock('next/navigation', () => ({
  usePathname: () => '/services',
  useRouter: () => ({ replace: navigation.replace }),
  useSearchParams: () => navigation.searchParams,
}));
vi.mock('@/hooks/use-client-services', () => ({
  useMoveEngagementStart: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
}));
vi.mock('@/hooks/use-deadlines', () => ({
  useDeadlines: hooks.useDeadlines,
  useDeadlineHolidays: () => ({ data: undefined }),
  useUpdateDeadlineOccurrence: hooks.useUpdateDeadlineOccurrence,
  useResetDeadlineDateOverride: hooks.useResetDeadlineDateOverride,
}));
vi.mock('@/hooks/use-service-roster-families', () => ({ useServiceRosterFamilies: hooks.useServiceRosterFamilies }));
vi.mock('@/hooks/use-user-preferences', () => ({
  useUserPreference: hooks.useUserPreference,
  useUpsertUserPreference: hooks.useUpsertUserPreference,
}));
vi.mock('@/hooks/use-media-query', () => ({ useIsLargeDesktop: media.isLargeDesktop }));
vi.mock('@/components/ui/date-picker', () => ({
  DatePicker: ({
    placeholder = 'Select date',
    onChange,
  }: {
    placeholder?: string;
    onChange: (value: unknown) => void;
  }) => (
    <div>
      <button type="button" aria-label={placeholder}>{placeholder}</button>
      <button
        type="button"
        onClick={() => onChange({
          mode: 'range',
          range: {
            from: new Date('2026-08-10T00:00:00'),
            to: new Date('2026-08-20T00:00:00'),
          },
        })}
      >
        Apply complete date range
      </button>
      <button
        type="button"
        onClick={() => onChange({ mode: 'range', range: { from: new Date('2026-08-10T00:00:00') } })}
      >
        Apply incomplete date range
      </button>
      <button type="button" onClick={() => onChange(undefined)}>Clear date range</button>
    </div>
  ),
}));

import { DeadlineWorkspace } from '@/components/services/deadlines/deadline-workspace';

const familyId = '33333333-3333-4333-8333-333333333333';

function setup() {
  navigation.searchParams = new URLSearchParams();
  navigation.replace.mockReset();
  hooks.useDeadlines.mockImplementation((query: { mode?: string }) => ({
    data: query.mode === 'CALENDAR'
      ? { mode: 'CALENDAR', items: [], truncated: false }
      : { mode: 'TABLE', items: [], total: 0, page: 1, limit: 20, totalPages: 0 },
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  }));
  hooks.useUpdateDeadlineOccurrence.mockReturnValue({ mutate: vi.fn(), isPending: false, error: null });
  hooks.useResetDeadlineDateOverride.mockReturnValue({ mutate: vi.fn(), isPending: false, error: null });
  hooks.useServiceRosterFamilies.mockReturnValue({
    data: [{ id: familyId, name: 'Accounting', displayColor: '#3F6DA8' }],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  });
  hooks.useUserPreference.mockReturnValue({ data: { value: null }, isLoading: false });
  hooks.preferenceMutation.mockReset();
  hooks.useUpsertUserPreference.mockReturnValue({ mutate: hooks.preferenceMutation, isPending: false });
}

describe('Task 12 review remediations', () => {
  beforeEach(() => {
    media.isLargeDesktop.mockReturnValue(true);
    setup();
  });

  it('canonicalizes malformed, partial, reversed, and oversized URL ranges before querying', () => {
    const parsed = parseDeadlineUrlState(
      'deadlineView=CALENDAR&from=2026-02-31&to=2025-01-01&companies=bad&families=bad',
      defaultDeadlineViewPreference,
      true,
      '2026-08-19',
    );

    expect(parsed.from).toBe('2026-08-01');
    expect(parsed.to).toBe('2026-09-30');
    expect(parsed.companies).toEqual([]);
    expect(parsed.families).toEqual([]);

    const boundary = parseDeadlineUrlState(
      'deadlineView=CALENDAR&from=9999-12-31',
      defaultDeadlineViewPreference,
      true,
      '2026-08-19',
    );
    expect(boundary.from).toBe('2026-08-01');
    expect(boundary.to).toBe('2026-09-30');

    const partial = parseDeadlineUrlState(
      'deadlineView=CALENDAR&from=2026-08-15&to=2026-09-20&page=4',
      defaultDeadlineViewPreference,
      true,
      '2026-08-19',
    );
    expect(partial.from).toBe('2026-08-01');
    expect(partial.to).toBe('2026-09-30');
    expect(partial.page).toBe(4);
  });

  it('normalizes deadline type to one selection and keeps Open exclusive to the shortcut', () => {
    const parsed = parseDeadlineUrlState(
      'types=CLIENT,INTERNAL&statuses=OPEN,COMPLETED',
      defaultDeadlineViewPreference,
      true,
      '2026-08-19',
    );

    expect(parsed.types).toEqual(['CLIENT']);
    expect(parsed.statuses).toEqual(['COMPLETED']);
  });

  it('validates inline transport filters and repairs malformed saved columns', () => {
    expect(parseDeadlineSearchParams(new URLSearchParams({
      from: '2026-08-01',
      to: '2026-08-31',
      companyQuery: ' Oaktree ',
      serviceQuery: ' Annual Return ',
      milestoneQuery: ' annual-return ',
    }))).toEqual(expect.objectContaining({ companyQuery: 'Oaktree', serviceQuery: 'Annual Return', milestoneQuery: 'annual-return' }));

    const parsed = parseDeadlineViewPreference({
      version: 1,
      defaultView: 'TABLE',
      monthCount: 2,
      visibleTypes: ['CLIENT'],
      familyIds: [],
      tableColumnOrder: ['actions', 'unknown', 'company'],
      tableColumnWidths: { dueDate: 40, company: 901, unknown: 220, timing: 'wide' },
      tableColumnVisibility: { actions: false, company: false, unknown: false },
      sortBy: 'dueDate',
      sortOrder: 'asc',
      pageSize: 20,
    });
    expect(parsed.tableColumnOrder).toEqual(['actions', 'company', 'dueDate', 'timing', 'family', 'service', 'milestone', 'type', 'status']);
    expect(parsed.tableColumnWidths).toEqual({ dueDate: 96, company: 800 });
    expect(parsed.tableColumnVisibility).toEqual(expect.objectContaining({ actions: true, company: false }));
    expect(parsed.tableColumnVisibility).not.toHaveProperty('unknown');
    expect(parsed.showHolidays).toBe(true);
    expect(parseDeadlineViewPreference({ ...parsed, showHolidays: false }).showHolidays).toBe(false);
    expect(parseDeadlineViewPreference({ ...parsed, showHolidays: 'no' }).showHolidays).toBe(true);
  });

  it('canonicalizes calendar history after async preferences and viewport transitions without loops', () => {
    navigation.searchParams = new URLSearchParams('deadlineView=CALENDAR&from=2026-08-01&to=2026-09-30&page=4');
    const view = render(<DeadlineWorkspace />);
    const initialCalls = navigation.replace.mock.calls.length;
    expect(navigation.replace).toHaveBeenLastCalledWith(expect.stringContaining('page=1'), { scroll: false });

    hooks.useUserPreference.mockReturnValue({
      data: { value: { ...defaultDeadlineViewPreference, monthCount: 3 } },
      isLoading: false,
    });
    view.rerender(<DeadlineWorkspace />);
    expect(navigation.replace).toHaveBeenLastCalledWith(expect.stringContaining('from=2026-08-01'), { scroll: false });
    expect(navigation.replace).toHaveBeenLastCalledWith(expect.stringContaining('to=2026-10-31'), { scroll: false });
    expect(navigation.replace).toHaveBeenLastCalledWith(expect.stringContaining('page=1'), { scroll: false });

    media.isLargeDesktop.mockReturnValue(false);
    view.rerender(<DeadlineWorkspace />);
    expect(navigation.replace).toHaveBeenLastCalledWith(expect.stringContaining('from=2026-08-01'), { scroll: false });
    expect(navigation.replace).toHaveBeenLastCalledWith(expect.stringContaining('to=2026-08-31'), { scroll: false });
    const stableCalls = navigation.replace.mock.calls.length;
    view.rerender(<DeadlineWorkspace />);
    expect(navigation.replace.mock.calls.length).toBe(stableCalls);
    expect(hooks.useDeadlines).toHaveBeenLastCalledWith(expect.objectContaining({ from: '2026-08-01', to: '2026-08-31', mode: 'CALENDAR', page: 1 }));
    expect(initialCalls).toBeGreaterThan(0);
  });

  it('renders server-backed inline deadline filters and resets the page', () => {
    navigation.searchParams = new URLSearchParams('tab=deadlines&page=4&statuses=COMPLETED&origin=MANUAL_TRIGGER');
    render(<DeadlineWorkspace />);

    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter Company' }), { target: { value: 'Oaktree' } });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter Service' }), { target: { value: 'Annual' } });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter Milestone' }), { target: { value: 'return' } });

    expect(navigation.replace).toHaveBeenLastCalledWith(
      expect.stringContaining('page=1'),
      { scroll: false },
    );
    expect(hooks.useDeadlines).toHaveBeenLastCalledWith(expect.objectContaining({
      companyQuery: 'Oaktree',
      serviceQuery: 'Annual',
      milestoneQuery: 'return',
      statuses: ['COMPLETED'],
      origin: 'MANUAL_TRIGGER',
      page: 1,
    }));
    expect(screen.getByRole('button', { name: 'Remove Company: Oaktree' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Remove Service: Annual' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Remove Milestone: return' })).toBeVisible();

    fireEvent.click(within(screen.getByRole('group', { name: 'Deadline filters' })).getByRole('button', { name: 'Status' }));
    const statusDialog = screen.getByRole('dialog', { name: 'Filter statuses' });
    expect(within(statusDialog).getByRole('button', { name: 'Completed' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(screen.getByRole('group', { name: 'Deadline filters' })).getByRole('button', { name: 'Source' }));
    const sourceDialog = screen.getByRole('dialog', { name: 'Filter source' });
    expect(within(sourceDialog).getByRole('button', { name: 'Manual trigger' })).toHaveAttribute('aria-pressed', 'true');
    expect(hooks.useDeadlines).toHaveBeenLastCalledWith(expect.objectContaining({ statuses: ['COMPLETED'], origin: 'MANUAL_TRIGGER', page: 1 }));
  });

  it('uses synchronized quick buttons and a Date Range picker beside Families', () => {
    navigation.searchParams = new URLSearchParams('tab=deadlines');
    render(<DeadlineWorkspace />);

    const quickFilters = screen.getByRole('group', { name: 'Deadline filters' });
    expect(within(quickFilters).getByRole('button', { name: 'Deadline type' })).toBeVisible();
    expect(within(quickFilters).getByRole('button', { name: 'Status' })).toBeVisible();
    expect(within(quickFilters).getByRole('button', { name: 'Source' })).toBeVisible();
    expect(screen.getByRole('searchbox', { name: 'Filter Company' })).toBeVisible();
    expect(screen.getByRole('searchbox', { name: 'Filter Service' })).toBeVisible();
    expect(screen.getByRole('searchbox', { name: 'Filter Milestone' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Date Range' })).toBeVisible();
  });

  it('keeps native inline controls and shares their filter badges with the quick row', () => {
    navigation.searchParams = new URLSearchParams(`tab=deadlines&dateFilter=none&families=${familyId}&types=CLIENT&statuses=COMPLETED&origin=MANUAL_TRIGGER`);
    render(<DeadlineWorkspace />);

    const inlineFilters = screen.getByRole('group', { name: 'Deadline inline filters' });
    expect(within(inlineFilters).getByRole('searchbox', { name: 'Filter Company' })).toHaveValue('');
    expect(within(inlineFilters).getByRole('searchbox', { name: 'Filter Service' })).toHaveValue('');
    expect(within(inlineFilters).getByRole('searchbox', { name: 'Filter Milestone' })).toHaveValue('');
    expect(within(inlineFilters).getByRole('combobox', { name: 'Filter Family' })).toHaveValue('Accounting');
    expect(within(inlineFilters).getByRole('combobox', { name: 'Filter Deadline type' })).toHaveValue('Client');
    expect(within(inlineFilters).getByRole('combobox', { name: 'Filter Status' })).toHaveValue('Completed');
    expect(within(inlineFilters).queryByRole('button', { name: 'Deadline type' })).not.toBeInTheDocument();

    const quickFilters = screen.getByRole('group', { name: 'Deadline filters' });
    expect(within(quickFilters).getByRole('button', { name: 'Deadline type' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(quickFilters).getByRole('button', { name: 'Status' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(quickFilters).getByRole('button', { name: 'Source' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Remove Type: Client' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Remove Status: Completed' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Remove Family: Accounting' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Remove Source: Manual trigger' })).toBeVisible();
  });

  it('maps complete deadline ranges, ignores incomplete ranges, and sends both keys when clearing', () => {
    navigation.searchParams = new URLSearchParams('tab=deadlines');
    render(<DeadlineWorkspace />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Apply complete date range' })[0]!);
    expect(navigation.replace).toHaveBeenCalledWith(expect.stringContaining('from=2026-08-10'), { scroll: false });
    expect(navigation.replace).toHaveBeenCalledWith(expect.stringContaining('to=2026-08-20'), { scroll: false });

    const callsAfterComplete = navigation.replace.mock.calls.length;
    fireEvent.click(screen.getAllByRole('button', { name: 'Apply incomplete date range' })[0]!);
    expect(navigation.replace).toHaveBeenCalledTimes(callsAfterComplete);

    fireEvent.click(screen.getAllByRole('button', { name: 'Clear date range' })[0]!);
    expect(navigation.replace.mock.calls).toContainEqual([
      expect.not.stringContaining('from='),
      { scroll: false },
    ]);
    expect(navigation.replace.mock.calls).toContainEqual([
      expect.not.stringContaining('to='),
      { scroll: false },
    ]);
  });

  it('keeps calendar navigation, visible-month changes, and Today ranges canonical', () => {
    navigation.searchParams = new URLSearchParams('deadlineView=CALENDAR&from=2026-08-01&to=2026-09-30&page=4');
    render(<DeadlineWorkspace />);

    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(navigation.replace).toHaveBeenLastCalledWith(
      expect.stringContaining('from=2026-10-01'),
      { scroll: false },
    );
    expect(navigation.replace).toHaveBeenLastCalledWith(
      expect.stringContaining('to=2026-11-30'),
      { scroll: false },
    );
    expect(navigation.replace).toHaveBeenLastCalledWith(expect.stringContaining('page=1'), { scroll: false });

    fireEvent.change(screen.getByRole('combobox', { name: 'Visible months' }), { target: { value: '3' } });
    expect(navigation.replace).toHaveBeenLastCalledWith(expect.stringContaining('from=2026-10-01'), { scroll: false });
    expect(navigation.replace).toHaveBeenLastCalledWith(expect.stringContaining('to=2026-12-31'), { scroll: false });
    expect(hooks.preferenceMutation).toHaveBeenCalledWith(expect.objectContaining({ value: expect.objectContaining({ monthCount: 3 }) }));

    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    const today = currentDateInSingapore();
    const todayMonth = `${today.slice(0, 7)}-01` as DateOnly;
    const expectedTo = addCalendarDays(addMonthsClamped(todayMonth, 3), -1);
    expect(navigation.replace).toHaveBeenLastCalledWith(expect.stringContaining(`from=${todayMonth}`), { scroll: false });
    expect(navigation.replace).toHaveBeenLastCalledWith(expect.stringContaining(`to=${expectedTo}`), { scroll: false });
    expect(navigation.replace).toHaveBeenLastCalledWith(expect.stringContaining('page=1'), { scroll: false });
  });

  it('persists visible type/family defaults and selected page size', async () => {
    render(<DeadlineWorkspace />);

    fireEvent.click(within(screen.getByRole('group', { name: 'Deadline filters' })).getByRole('button', { name: 'Deadline type' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Filter deadline types' })).getByRole('button', { name: 'Internal' }));
    fireEvent.click(within(screen.getByRole('group', { name: 'Deadline filters' })).getByRole('button', { name: 'Families' }));
    fireEvent.click(screen.getByRole('button', { name: 'Accounting' }));
    fireEvent.change(screen.getByRole('combobox', { name: /per page/i }), { target: { value: '50' } });

    const mutations = hooks.preferenceMutation.mock.calls.map(([input]) => input.value);
    expect(mutations).toEqual(expect.arrayContaining([
      expect.objectContaining({ visibleTypes: ['INTERNAL'] }),
      expect.objectContaining({ familyIds: [familyId] }),
      expect.objectContaining({ pageSize: 50 }),
    ]));
    await waitFor(() => expect(hooks.useDeadlines).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 50 })));
  });

  it('allows clearing the last deadline type so the query becomes unfiltered', () => {
    navigation.searchParams = new URLSearchParams('types=CLIENT');
    hooks.useUserPreference.mockReturnValue({
      data: { value: { ...defaultDeadlineViewPreference, visibleTypes: ['STATUTORY'] } },
      isLoading: false,
    });
    render(<DeadlineWorkspace />);

    fireEvent.click(within(screen.getByRole('group', { name: 'Deadline filters' })).getByRole('button', { name: 'Deadline type' }));
    const typeDialog = screen.getByRole('dialog', { name: 'Filter deadline types' });
    const client = within(typeDialog).getByRole('button', { name: 'Client' });
    expect(client).toHaveAttribute('aria-pressed', 'true');
    navigation.replace.mockReset();
    hooks.preferenceMutation.mockReset();
    fireEvent.click(client);
    expect(navigation.replace).toHaveBeenCalledWith(expect.not.stringContaining('types='), { scroll: false });
    expect(hooks.preferenceMutation).toHaveBeenCalledWith(expect.objectContaining({ value: expect.objectContaining({ visibleTypes: [] }) }));
  });

  it('shows actionable company-id and due-range deviation badges', () => {
    navigation.searchParams = new URLSearchParams('companies=22222222-2222-4222-8222-222222222222&from=2026-09-01&to=2026-09-30');
    const view = render(<DeadlineWorkspace />);

    expect(screen.getByRole('button', { name: /Remove Companies:/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /Remove Date:/ })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: /Remove Date:/ }));
    expect(navigation.replace).toHaveBeenLastCalledWith(expect.stringContaining('dateFilter=none'), { scroll: false });

    navigation.searchParams = new URLSearchParams('dateFilter=none');
    view.rerender(<DeadlineWorkspace />);
    expect(screen.queryByRole('button', { name: /Remove Date:/ })).not.toBeInTheDocument();
  });

  it('clears every active filter at once', () => {
    navigation.searchParams = new URLSearchParams('companies=22222222-2222-4222-8222-222222222222&companyQuery=Oaktree&origin=RULE&from=2026-09-01&to=2026-09-30');
    render(<DeadlineWorkspace />);

    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));

    const url = navigation.replace.mock.calls.at(-1)![0] as string;
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('companies')).toBeNull();
    expect(params.get('companyQuery')).toBeNull();
    expect(params.get('origin')).toBeNull();
    expect(params.get('from')).toBeNull();
    expect(params.get('dateFilter')).toBe('none');
    expect(params.get('openOnly')).toBe('false');
  });

  it('exposes a saved table column chooser', () => {
    render(<DeadlineWorkspace />);
    fireEvent.click(screen.getByRole('button', { name: 'Columns' }));
    const chooser = screen.getByRole('dialog', { name: 'Adjust columns' });
    const milestoneCheckbox = within(chooser).getByRole('checkbox', { name: 'Show Milestone column' });
    expect(milestoneCheckbox).toBeVisible();
    expect(milestoneCheckbox.closest('label')?.parentElement).toHaveClass('min-h-11', 'sm:min-h-9');
    fireEvent.click(within(chooser).getByRole('checkbox', { name: 'Show Milestone column' }));
    expect(hooks.preferenceMutation).toHaveBeenCalledWith(expect.objectContaining({
      value: expect.objectContaining({ tableColumnVisibility: expect.objectContaining({ milestone: false }) }),
    }));
  });
});
