import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeadlineOccurrenceDto } from '@/services/deadline';

const hooks = vi.hoisted(() => ({
  useDeadlines: vi.fn(),
  useUpdateDeadlineOccurrence: vi.fn(),
  useResetDeadlineDateOverride: vi.fn(),
  useServiceRosterFamilies: vi.fn(),
  useUserPreference: vi.fn(),
  useUpsertUserPreference: vi.fn(),
}));

const navigation = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
  replace: vi.fn(),
}));

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

import { DeadlineViewToggle, DeadlineWorkspace } from '@/components/services/deadlines/deadline-workspace';
import { deadlineStatusLabel } from '@/components/services/deadlines/deadline-event';

const familyId = '33333333-3333-4333-8333-333333333333';

const occurrence: DeadlineOccurrenceDto = {
  id: '44444444-4444-4444-8444-444444444444',
  tenantId: '11111111-1111-4111-8111-111111111111',
  companyId: '22222222-2222-4222-8222-222222222222',
  ownershipScope: 'SERVICE',
  clientServiceId: '55555555-5555-4555-8555-555555555555',
  cycleId: '66666666-6666-4666-8666-666666666666',
  ruleVersionId: '77777777-7777-4777-8777-777777777777',
  milestoneKey: 'annual-return',
  scheduleEntryKey: '',
  deadlineType: 'STATUTORY',
  calculatedDueDate: '2026-08-28',
  operativeDueDate: '2026-08-28',
  dueDate: '2026-08-28',
  dateOverridden: false,
  dateOverride: null,
  dateOverrideReason: null,
  dateOverriddenById: null,
  dateOverriddenAt: null,
  status: 'OPEN',
  timingState: 'UPCOMING',
  timingBucket: 'WITHIN_1_MONTH',
  completedAt: null,
  completedById: null,
  waivedAt: null,
  waivedById: null,
  waiverReason: null,
  cancelledAt: null,
  cancelledById: null,
  cancellationReason: null,
  notes: 'Bring signed accounts.',
  origin: 'RULE',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  company: {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Oaktree Accounting & Corporate Solution Pte. Ltd.',
    displayAlias: null,
    displayLabel: 'OACS',
    uen: null,
  },
  family: { id: familyId, name: 'Accounting', displayColor: '#3F6DA8' },
  service: {
    id: '55555555-5555-4555-8555-555555555555',
    name: 'Annual Return',
    familyName: 'Accounting',
    variantId: '55555555-5555-4555-8555-555555555555',
    variantName: 'Annual Return',
  },
  obligation: null,
  cycle: {
    id: '66666666-6666-4666-8666-666666666666',
    periodKey: '2026',
    periodStart: '2026-01-01',
    periodEnd: '2026-12-31',
  },
};

function setup() {
  navigation.searchParams = new URLSearchParams();
  navigation.replace.mockReset();
  hooks.useDeadlines.mockReturnValue({
    data: { mode: 'TABLE', items: [occurrence], total: 1, page: 1, limit: 20, totalPages: 1 },
    isLoading: false,
    isFetching: false,
    error: null,
  });
  hooks.useUpdateDeadlineOccurrence.mockReturnValue({ mutate: vi.fn(), isPending: false });
  hooks.useResetDeadlineDateOverride.mockReturnValue({ mutate: vi.fn(), isPending: false, error: null });
  hooks.useServiceRosterFamilies.mockReturnValue({
    data: [{ id: familyId, name: 'Accounting', displayColor: '#3F6DA8' }],
    isLoading: false,
    error: null,
  });
  hooks.useUserPreference.mockReturnValue({ data: { value: null }, isLoading: false });
  hooks.useUpsertUserPreference.mockReturnValue({ mutate: vi.fn(), isPending: false });
}

describe('DeadlineWorkspace', () => {
  beforeEach(setup);

  it('uses a quick-filter toolbar with individual filter buttons and a compact family selector', () => {
    render(<DeadlineWorkspace />);

    const toolbar = screen.getByRole('group', { name: 'Deadline filters' });
    expect(toolbar).toHaveClass('border', 'rounded-lg', 'p-4');
    for (const name of ['Status: Open', 'Families', 'Service', 'Milestone', 'Deadline type', 'Status', 'Source', 'Columns']) {
      expect(within(toolbar).getByRole('button', { name })).toBeVisible();
    }
    expect(within(toolbar).queryByRole('button', { name: 'More filters' })).not.toBeInTheDocument();
  });

  it('places inline filters inside the table above the column headers', () => {
    render(<DeadlineWorkspace />);

    const table = screen.getByRole('table', { name: 'Deadline occurrences table' });
    const inlineFilters = within(table).getByRole('group', { name: 'Deadline inline filters' });
    const headerRows = within(table.querySelector('thead')!).getAllByRole('row');

    expect(table).toHaveClass('w-full', 'min-w-max');
    expect(table).not.toHaveClass('table-fixed');
    expect(table.style.width).toBe('');
    expect(table.style.minWidth).toBe('');
    expect((table.querySelectorAll('colgroup col').item(9) as HTMLElement).style.width).toBe('');
    expect(screen.queryByRole('separator', { name: 'Resize Actions column' })).not.toBeInTheDocument();
    expect(headerRows).toHaveLength(2);
    expect(headerRows[0]).toContainElement(inlineFilters);
    expect(headerRows[1]).toHaveTextContent('Company');
  });

  it('vertically centers every visible body cell', () => {
    render(<DeadlineWorkspace />);

    const cells = screen.getByRole('table', { name: 'Deadline occurrences table' }).querySelectorAll('tbody td');
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) expect(cell).toHaveClass('align-middle');
  });

  it('keeps the table columns visible when no deadlines are found', () => {
    hooks.useDeadlines.mockReturnValue({
      data: { mode: 'TABLE', items: [], total: 0, page: 1, limit: 20, totalPages: 0 },
      isLoading: false,
      isFetching: false,
      error: null,
    });
    render(<DeadlineWorkspace />);

    const table = screen.getByRole('table', { name: 'Deadline occurrences table' });
    expect(within(table).getByRole('columnheader', { name: /Company/ })).toBeVisible();
    const emptyMessage = within(table).getByText('No matching deadlines');
    expect(within(table).getByRole('button', { name: 'Clear filters' })).toBeVisible();
    expect(emptyMessage.closest('tbody')).not.toBeNull();
    expect(emptyMessage.closest('td')).toHaveAttribute('colspan', '10');
    expect(screen.queryByText(/No deadlines match the selected filters\./)).not.toBeInTheDocument();
  });

  it('defaults to Status: Open and sends the default constraint to the deadline query', () => {
    render(<DeadlineWorkspace />);

    expect(screen.getByRole('button', { name: 'Status: Open' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Remove Status: Open' })).toBeVisible();
    expect(hooks.useDeadlines).toHaveBeenLastCalledWith(expect.objectContaining({ openOnly: true }));
  });

  it('writes an explicit false value when the default Status: Open filter is cleared', () => {
    render(<DeadlineWorkspace />);

    fireEvent.click(screen.getByRole('button', { name: 'Status: Open' }));

    expect(navigation.replace).toHaveBeenCalledWith(expect.stringContaining('openOnly=false'), { scroll: false });
    expect(hooks.useDeadlines).toHaveBeenLastCalledWith(expect.objectContaining({ openOnly: false }));
  });

  it('keeps deadline type single-select and omits Open from the status options', () => {
    render(<DeadlineWorkspace />);

    fireEvent.click(within(screen.getByRole('group', { name: 'Deadline filters' })).getByRole('button', { name: 'Deadline type' }));

    const typeDialog = screen.getByRole('dialog', { name: 'Filter deadline types' });
    expect(typeDialog).toBeVisible();
    fireEvent.click(within(typeDialog).getByRole('button', { name: 'Client' }));
    fireEvent.click(within(typeDialog).getByRole('button', { name: 'Internal' }));
    expect(within(typeDialog).getByRole('button', { name: 'Client' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(typeDialog).getByRole('button', { name: 'Internal' })).toHaveAttribute('aria-pressed', 'true');
    expect(hooks.useDeadlines).toHaveBeenLastCalledWith(expect.objectContaining({ types: ['INTERNAL'] }));

    fireEvent.click(within(screen.getByRole('group', { name: 'Deadline filters' })).getByRole('button', { name: 'Status' }));
    const statusDialog = screen.getByRole('dialog', { name: 'Filter statuses' });
    expect(within(statusDialog).queryByRole('button', { name: 'Open' })).not.toBeInTheDocument();
    expect(within(statusDialog).getByRole('button', { name: 'Completed' })).toBeVisible();
  });

  it('shows the table date range as a removable filter badge and clears the server range', () => {
    render(<DeadlineWorkspace />);

    expect(screen.getByRole('button', { name: /Remove Date:/ })).toBeVisible();
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear selection' })[0]!);

    expect(navigation.replace).toHaveBeenCalledWith(expect.stringContaining('dateFilter=none'), { scroll: false });
    expect(hooks.useDeadlines).toHaveBeenLastCalledWith(expect.objectContaining({ from: undefined, to: undefined, mode: 'TABLE' }));
  });

  it('filters by timing bucket from the URL and shows it as a removable badge', () => {
    navigation.searchParams = new URLSearchParams('timingBucket=WITHIN_3_MONTHS');
    render(<DeadlineWorkspace />);

    expect(hooks.useDeadlines).toHaveBeenLastCalledWith(expect.objectContaining({ timingBucket: 'WITHIN_3_MONTHS' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Timing: Within 3 months' }));
    expect(navigation.replace).toHaveBeenLastCalledWith(expect.not.stringContaining('timingBucket='), { scroll: false });
  });

  it('normalizes legacy multi-type URLs to one removable deadline type badge', () => {
    navigation.searchParams = new URLSearchParams('types=STATUTORY,CLIENT,INTERNAL');
    render(<DeadlineWorkspace />);

    expect(screen.getByRole('button', { name: 'Remove Type: Statutory' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Remove Type: Client' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove Type: Internal' })).not.toBeInTheDocument();
  });

  it('uses the same filters after switching calendar mode', () => {
    render(<><DeadlineViewToggle /><DeadlineWorkspace /></>);

    fireEvent.click(screen.getByRole('button', { name: 'Calendar view' }));

    expect(screen.getByRole('button', { name: 'Status: Open' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(screen.getByRole('group', { name: 'Deadline filters' })).getByRole('button', { name: 'Deadline type' })).toHaveAttribute('aria-pressed', 'false');
    expect(navigation.replace).toHaveBeenCalledWith(
      expect.stringContaining('deadlineView=CALENDAR'),
      { scroll: false },
    );
  });

  it('gives explicit URL filters precedence over versioned preferences', () => {
    navigation.searchParams = new URLSearchParams(`types=CLIENT&families=${familyId}&openOnly=true`);
    hooks.useUserPreference.mockReturnValue({
      data: {
        value: {
          version: 1,
          defaultView: 'TABLE',
          monthCount: 3,
          visibleTypes: ['STATUTORY'],
          familyIds: [],
        },
      },
      isLoading: false,
    });

    render(<DeadlineWorkspace />);

    expect(hooks.useDeadlines).toHaveBeenLastCalledWith(expect.objectContaining({
      types: ['CLIENT'],
      familyIds: [familyId],
      openOnly: true,
      mode: 'TABLE',
    }));
    expect(within(screen.getByRole('group', { name: 'Deadline filters' })).getByRole('button', { name: 'Deadline type' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Status: Open' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('suppresses lifecycle writes when the deadline-write feature flag is disabled', () => {
    const update = vi.fn();
    hooks.useUpdateDeadlineOccurrence.mockReturnValue({ mutate: update, isPending: false });
    render(<DeadlineWorkspace canEdit deadlineWritesEnabled={false} />);

    fireEvent.click(screen.getAllByRole('button', { name: /Actions for OACS Annual Return/ })[0]!);
    expect(screen.getByText('Read-only access')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Mark complete' })).not.toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
  });

  it('marks selected visible deadlines complete from the bulk toolbar', async () => {
    const mutateAsync = vi.fn().mockResolvedValue(occurrence);
    hooks.useUpdateDeadlineOccurrence.mockReturnValue({ mutate: vi.fn(), mutateAsync, isPending: false, error: null });
    render(<DeadlineWorkspace canEdit deadlineWritesEnabled />);

    fireEvent.click(screen.getByRole('checkbox', { name: /Select deadline/ }));
    const toolbar = screen.getByRole('region', { name: 'Deadline bulk actions' });
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Mark complete' }));

    const dialog = screen.getByRole('dialog', { name: 'Mark 1 deadline complete' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mark complete' }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({
      id: occurrence.id,
      data: { expectedUpdatedAt: occurrence.updatedAt, status: 'COMPLETED' },
    }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Deadline bulk actions' })).not.toBeInTheDocument());
  });

  it('waives selected visible deadlines with a shared reason', async () => {
    const mutateAsync = vi.fn().mockResolvedValue(occurrence);
    hooks.useUpdateDeadlineOccurrence.mockReturnValue({ mutate: vi.fn(), mutateAsync, isPending: false, error: null });
    render(<DeadlineWorkspace canEdit deadlineWritesEnabled />);

    fireEvent.click(screen.getByRole('checkbox', { name: /Select deadline/ }));
    const toolbar = screen.getByRole('region', { name: 'Deadline bulk actions' });
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Waive' }));
    const dialog = screen.getByRole('dialog', { name: 'Waive 1 deadline' });
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'Client requested waiver' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Waive deadline' }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({
      id: occurrence.id,
      data: { expectedUpdatedAt: occurrence.updatedAt, status: 'WAIVED', reason: 'Client requested waiver' },
    }));
  });

  it('overrides the date for selected visible deadlines with shared data', async () => {
    const mutateAsync = vi.fn().mockResolvedValue(occurrence);
    hooks.useUpdateDeadlineOccurrence.mockReturnValue({ mutate: vi.fn(), mutateAsync, isPending: false, error: null });
    render(<DeadlineWorkspace canEdit deadlineWritesEnabled />);

    fireEvent.click(screen.getByRole('checkbox', { name: /Select deadline/ }));
    const toolbar = screen.getByRole('region', { name: 'Deadline bulk actions' });
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Override date' }));
    const dialog = screen.getByRole('dialog', { name: 'Override 1 deadline date' });
    fireEvent.change(within(dialog).getByLabelText('New operative date'), { target: { value: '2026-09-15' } });
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'Client confirmed a revised due date' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Override date' }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({
      id: occurrence.id,
      data: {
        expectedUpdatedAt: occurrence.updatedAt,
        operativeDueDate: '2026-09-15',
        reason: 'Client confirmed a revised due date',
      },
    }));
  });

  it('shows the company obligation filing status set in the service Deadline tab', () => {
    const obligation = {
      code: 'SG_ECI', periodKey: 'FY2025-12-31', financialPeriodStart: '2025-01-01', financialPeriodEnd: '2025-12-31',
      yearOfAssessment: 2026, periodProvisional: false, filingResponsibility: 'OAKCLOUD' as const,
      deliveryClientServiceId: null, coverageTiming: 'DURING', filingStatusUnconfirmed: false,
    };
    expect(deadlineStatusLabel({ status: 'OPEN', obligation } as never)).toBe('Pending filing');
    expect(deadlineStatusLabel({ status: 'OPEN', obligation: { ...obligation, filingResponsibility: 'EXTERNAL_PROVIDER' } } as never)).toBe('Managed externally');
    expect(deadlineStatusLabel({ status: 'OPEN', obligation: { ...obligation, filingResponsibility: 'UNCONFIRMED' } } as never)).toBe('To be confirmed');
    expect(deadlineStatusLabel({ status: 'COMPLETED', obligation } as never)).toBe('Filed');
    expect(deadlineStatusLabel({ status: 'WAIVED', obligation } as never)).toBe('Not required');
    expect(deadlineStatusLabel({ status: 'OPEN', obligation: null } as never)).toBe('Open');
  });
});
