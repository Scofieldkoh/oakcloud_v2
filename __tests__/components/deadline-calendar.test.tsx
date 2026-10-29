import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DeadlineOccurrenceDto } from '@/services/deadline';

const hooks = vi.hoisted(() => ({
  useDeadlines: vi.fn(),
  useDeadlineHolidays: vi.fn((): { data?: { weekendDays: number[]; holidays: Array<{ date: string; name: string }> } } => ({ data: undefined })),
  useUserPreference: vi.fn(),
  useUpsertUserPreference: vi.fn(),
}));
const media = vi.hoisted(() => ({ isLargeDesktop: vi.fn(() => true) }));

vi.mock('@/hooks/use-deadlines', () => ({ useDeadlines: hooks.useDeadlines, useDeadlineHolidays: hooks.useDeadlineHolidays }));
vi.mock('@/hooks/use-user-preferences', () => ({
  useUserPreference: hooks.useUserPreference,
  useUpsertUserPreference: hooks.useUpsertUserPreference,
}));
vi.mock('@/hooks/use-media-query', () => ({ useIsLargeDesktop: media.isLargeDesktop }));

import { DeadlineCalendar } from '@/components/services/deadlines/deadline-calendar';
import { DeadlineEvent } from '@/components/services/deadlines/deadline-event';
import { DeadlineTable } from '@/components/services/deadlines/deadline-table';
import { defaultDeadlineViewPreference } from '@/lib/validations/services-preferences';

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
  family: { id: '33333333-3333-4333-8333-333333333333', name: 'Accounting', displayColor: '#3F6DA8' },
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

describe('DeadlineCalendar', () => {
  it('shows two desktop months and persists a three-month choice', () => {
    media.isLargeDesktop.mockReturnValue(true);
    const monthCountChange = vi.fn();
    hooks.useDeadlines.mockReturnValue({
      data: { mode: 'CALENDAR', items: [occurrence], truncated: false },
      isLoading: false,
      isFetching: false,
      error: null,
    });
    hooks.useUserPreference.mockReturnValue({ data: { value: null }, isLoading: false });
    hooks.useUpsertUserPreference.mockReturnValue({ mutate: vi.fn(), isPending: false });

    render(<DeadlineCalendar items={[occurrence]} onMonthCountChange={monthCountChange} />);

    expect(screen.getAllByRole('grid', { name: /calendar/i })).toHaveLength(2);
    const firstVisibleGridCell = screen.getAllByRole('gridcell').find((cell) => cell.querySelector('button'))!;
    expect(firstVisibleGridCell.querySelector('button')).toHaveClass('min-h-11');
    fireEvent.change(screen.getByLabelText('Visible months'), { target: { value: '3' } });
    expect(monthCountChange).toHaveBeenCalledWith(3);
  });

  it('keeps the rendered months controlled by updated focus and count props', () => {
    media.isLargeDesktop.mockReturnValue(true);
    hooks.useDeadlines.mockReturnValue({ data: { mode: 'CALENDAR', items: [], truncated: false }, isLoading: false, isFetching: false, error: null });
    const view = render(<DeadlineCalendar items={[]} focusMonth={new Date(2026, 7, 1)} monthCount={2} />);
    expect(screen.getAllByRole('grid', { name: /calendar/i })).toHaveLength(2);

    view.rerender(<DeadlineCalendar items={[]} focusMonth={new Date(2026, 8, 1)} monthCount={3} />);

    expect(screen.getAllByRole('grid', { name: /calendar/i })).toHaveLength(3);
    expect(screen.getByRole('grid', { name: /September 2026/i })).toBeVisible();
  });

  it('colours weekends and holidays and hides holidays when the toggle is off', () => {
    media.isLargeDesktop.mockReturnValue(false);
    hooks.useDeadlines.mockReturnValue({ data: { mode: 'CALENDAR', items: [], truncated: false }, isLoading: false, isFetching: false, error: null });
    hooks.useDeadlineHolidays.mockReturnValue({ data: { weekendDays: [0, 6], holidays: [{ date: '2026-08-10', name: 'National Day' }] } });
    const toggle = vi.fn();
    const view = render(<DeadlineCalendar items={[]} focusMonth={new Date(2026, 7, 1)} onShowHolidaysChange={toggle} />);

    const cell = (date: string) => document.querySelector(`[data-calendar-day="${date}"]`)!;
    expect(cell('2026-08-10')).toHaveAttribute('data-day-kind', 'holiday');
    expect(cell('2026-08-10')).toHaveClass('bg-orange-100/70');
    expect(within(cell('2026-08-10') as HTMLElement).getByText('National Day')).toBeVisible();
    expect(cell('2026-08-08')).toHaveAttribute('data-day-kind', 'weekend');
    expect(cell('2026-08-08')).toHaveClass('bg-sky-100/70');
    expect(cell('2026-08-11')).toHaveAttribute('data-day-kind', 'working');
    expect(hooks.useDeadlineHolidays).toHaveBeenCalledWith({ from: '2026-08-01', to: '2026-08-31' });

    fireEvent.click(screen.getByRole('switch', { name: 'Show holidays' }));
    expect(toggle).toHaveBeenCalledWith(false);

    view.rerender(<DeadlineCalendar items={[]} focusMonth={new Date(2026, 7, 1)} preferenceValue={{ ...defaultDeadlineViewPreference, showHolidays: false }} />);
    expect(screen.getByRole('switch', { name: 'Show holidays' })).toHaveAttribute('aria-checked', 'false');
    expect(cell('2026-08-10')).toHaveAttribute('data-day-kind', 'working');
    expect(screen.queryByText('National Day')).toBeNull();
    hooks.useDeadlineHolidays.mockReturnValue({ data: undefined });
  });

  it('shows company label and full name in an event popover', () => {
    media.isLargeDesktop.mockReturnValue(true);
    hooks.useDeadlines.mockReturnValue({
      data: { mode: 'CALENDAR', items: [occurrence], truncated: false },
      isLoading: false,
      isFetching: false,
      error: null,
    });
    hooks.useUserPreference.mockReturnValue({ data: { value: null }, isLoading: false });
    hooks.useUpsertUserPreference.mockReturnValue({ mutate: vi.fn(), isPending: false });

    render(<DeadlineCalendar items={[occurrence]} focusMonth={new Date(2026, 7, 1)} />);

    const eventButton = screen.getByRole('button', { name: /OACS Annual Return/ });
    expect(eventButton).toBeVisible();
    fireEvent.click(eventButton);
    expect(screen.getByText('Oaktree Accounting & Corporate Solution Pte. Ltd.')).toBeVisible();
  });

  it('renders the deadline table with plain company, family, and service columns', () => {
    render(<DeadlineTable items={[occurrence]} page={1} total={1} totalPages={1} limit={20} />);

    const table = screen.getByRole('table', { name: 'Deadline occurrences table' });
    expect(within(table).getByRole('columnheader', { name: /Company/ })).toBeVisible();
    expect(within(table).getByRole('columnheader', { name: /Family/ })).toBeVisible();
    expect(within(table).getByRole('columnheader', { name: /Service/ })).toBeVisible();
    expect(within(table).queryByRole('columnheader', { name: /Family \/ service/ })).not.toBeInTheDocument();
    expect(within(table).queryByRole('columnheader', { name: /Cycle \/ origin/ })).not.toBeInTheDocument();
    expect(within(table).getByText(occurrence.company.name)).toBeVisible();
    expect(within(table).queryByText('OACS')).not.toBeInTheDocument();
    expect(within(table).getByText('Accounting')).not.toHaveClass('badge');
    expect(within(table).getAllByText('Annual Return').some((element) => !element.classList.contains('badge'))).toBe(true);
  });

  it('opens the action modal when a table row is clicked', () => {
    render(<DeadlineTable items={[occurrence]} page={1} total={1} totalPages={1} limit={20} />);

    const table = screen.getByRole('table', { name: 'Deadline occurrences table' });
    const row = within(table).getAllByRole('row')[1]!;
    expect(row).not.toHaveClass('border-l-4');
    expect(row).not.toHaveStyle({ borderLeftColor: occurrence.family.displayColor });
    fireEvent.click(within(row).getByText(occurrence.company.name), { clientX: 240, clientY: 200 });

    const actionDialog = screen.getByRole('dialog', { name: 'Deadline actions' });
    expect(actionDialog).toBeVisible();
    expect(actionDialog).toHaveStyle({ left: '240px', top: '208px' });
  });

  it('renders row checkboxes and a visible-page select-all checkbox', () => {
    const onToggleSelection = vi.fn();
    const onToggleSelectAll = vi.fn();
    render(
      <DeadlineTable
        items={[occurrence]}
        page={1}
        total={1}
        totalPages={1}
        limit={20}
        selectedIds={new Set()}
        onToggleSelection={onToggleSelection}
        onToggleSelectAll={onToggleSelectAll}
      />,
    );

    const selectAll = screen.getByRole('checkbox', { name: 'Select all visible deadlines' });
    const rowCheckbox = screen.getByRole('checkbox', { name: /Select deadline/ });
    fireEvent.click(rowCheckbox);
    expect(screen.queryByRole('dialog', { name: 'Deadline actions' })).not.toBeInTheDocument();
    fireEvent.click(selectAll);

    expect(onToggleSelection).toHaveBeenCalledWith(occurrence);
    expect(onToggleSelectAll).toHaveBeenCalledTimes(1);
  });

  it('centers the header and row checkboxes in the same selection column', () => {
    render(
      <DeadlineTable
        items={[occurrence]}
        page={1}
        total={1}
        totalPages={1}
        limit={20}
        selectedIds={new Set()}
        onToggleSelection={vi.fn()}
        onToggleSelectAll={vi.fn()}
      />,
    );

    const table = screen.getByRole('table', { name: 'Deadline occurrences table' });
    const headerCell = screen.getByRole('checkbox', { name: 'Select all visible deadlines' }).closest('th');
    const rowCell = screen.getByRole('checkbox', { name: /Select deadline/ }).closest('td');

    expect(headerCell).toHaveClass('w-12', 'px-2', 'text-center');
    expect(rowCell).toHaveClass('w-12', 'px-2', 'text-center', 'align-middle');
    expect(headerCell?.querySelector('div.flex.justify-center')).toBeInTheDocument();
    expect(rowCell?.querySelector('div.flex.justify-center')).toBeInTheDocument();
    expect(table.querySelectorAll('th.w-12, td.w-12')).toHaveLength(2);
  });

  it('does not render dates from adjacent months in a calendar month view', () => {
    render(<DeadlineCalendar items={[]} focusMonth={new Date(2026, 7, 1)} monthCount={1} />);

    const grid = screen.getByRole('grid', { name: /August 2026/i });
    expect(grid.querySelector('[data-calendar-day^="2026-07"] button')).not.toBeInTheDocument();
    expect(grid.querySelector('[data-calendar-day^="2026-09"] button')).not.toBeInTheDocument();
  });

  it('supports lifecycle actions with required reasons and date inputs', () => {
    const onUpdate = vi.fn();
    const onResetOverride = vi.fn();
    const { unmount } = render(<DeadlineEvent occurrence={occurrence} canEdit onUpdate={onUpdate} onResetOverride={onResetOverride} />);

    fireEvent.click(screen.getByRole('button', { name: /OACS Annual Return/ }));
    expect(screen.getByRole('button', { name: 'Mark complete' })).toHaveClass('min-h-11');
    fireEvent.click(screen.getByRole('button', { name: 'Mark complete' }));
    expect(onUpdate).toHaveBeenCalledWith(occurrence, expect.objectContaining({ status: 'COMPLETED' }));

    fireEvent.click(screen.getByRole('button', { name: 'Waive' }));
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Client requested waiver' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onUpdate).toHaveBeenCalledWith(occurrence, expect.objectContaining({ status: 'WAIVED', reason: 'Client requested waiver' }));

    fireEvent.click(screen.getByRole('button', { name: 'Override date' }));
    fireEvent.change(screen.getByLabelText('New operative date'), { target: { value: '2026-09-01' } });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Approved extension' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onUpdate).toHaveBeenCalledWith(occurrence, expect.objectContaining({ operativeDueDate: '2026-09-01', reason: 'Approved extension' }));

    fireEvent.click(screen.getByRole('button', { name: 'Edit notes' }));
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Updated client note' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onUpdate).toHaveBeenCalledWith(occurrence, expect.objectContaining({ notes: 'Updated client note' }));

    unmount();
    const overridden = { ...occurrence, dateOverridden: true };
    const { unmount: unmountOverridden } = render(<DeadlineEvent occurrence={overridden} canEdit onUpdate={onUpdate} onResetOverride={onResetOverride} />);
    fireEvent.click(screen.getByRole('button', { name: /OACS Annual Return/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset date' }));
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Revert to calculated date' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onResetOverride).toHaveBeenCalledWith(overridden, 'Revert to calculated date');

    unmountOverridden();
    const completed = { ...occurrence, status: 'COMPLETED' as const };
    render(<DeadlineEvent occurrence={completed} canEdit onUpdate={onUpdate} />);
    fireEvent.click(screen.getByRole('button', { name: /OACS Annual Return/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Correction required' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onUpdate).toHaveBeenCalledWith(completed, expect.objectContaining({ status: 'OPEN', reason: 'Correction required' }));
  });

  it('keeps cancelled occurrences read-only even for editable users', () => {
    const onUpdate = vi.fn();
    const cancelled = { ...occurrence, status: 'CANCELLED' as const, dateOverridden: true };
    render(<DeadlineEvent occurrence={cancelled} canEdit onUpdate={onUpdate} onResetOverride={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /OACS Annual Return/ }));

    expect(screen.queryByRole('button', { name: 'Mark complete' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Waive' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reopen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Override date' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reset date' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit notes' })).not.toBeInTheDocument();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('reports live column resize and persists the final width on pointer release', () => {
    const onLiveResize = vi.fn();
    const onResizeEnd = vi.fn();
    const { unmount } = render(
      <DeadlineTable
        items={[occurrence]}
        page={1}
        total={1}
        totalPages={1}
        limit={20}
        onPageChange={vi.fn()}
        onColumnWidthChange={onLiveResize}
        onColumnResizeEnd={onResizeEnd}
      />,
    );

    fireEvent.pointerDown(screen.getByRole('separator', { name: 'Resize Operative due date column' }), { clientX: 100 });
    fireEvent.pointerMove(window, { clientX: 130 });
    fireEvent.pointerUp(window, { clientX: 130 });

    expect(onLiveResize).toHaveBeenCalledWith('dueDate', 238);
    expect(onResizeEnd).toHaveBeenCalledWith('dueDate', 238);
    expect(screen.getByRole('columnheader', { name: 'Operative due date' })).toHaveAttribute('aria-sort', 'ascending');
    fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize Operative due date column' }), { key: 'ArrowRight' });
    expect(onLiveResize).toHaveBeenLastCalledWith('dueDate', 218);
    expect(onResizeEnd).toHaveBeenLastCalledWith('dueDate', 218);

    onLiveResize.mockClear();
    onResizeEnd.mockClear();
    const resizeHandle = screen.getByRole('separator', { name: 'Resize Operative due date column' });
    fireEvent.pointerDown(resizeHandle, { clientX: 100 });
    fireEvent.pointerMove(window, { clientX: 1_000 });
    expect(onLiveResize).toHaveBeenLastCalledWith('dueDate', 800);
    fireEvent.pointerCancel(window);
    expect(onResizeEnd).not.toHaveBeenCalled();
    fireEvent.pointerMove(window, { clientX: 1_200 });
    expect(onLiveResize).toHaveBeenCalledTimes(1);

    unmount();
    const boundedLiveResize = vi.fn();
    const boundedResizeEnd = vi.fn();
    render(
      <DeadlineTable
        items={[occurrence]}
        columnWidths={{ dueDate: 800 }}
        onColumnWidthChange={boundedLiveResize}
        onColumnResizeEnd={boundedResizeEnd}
      />,
    );
    fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize Operative due date column' }), { key: 'ArrowRight' });
    expect(boundedLiveResize).toHaveBeenLastCalledWith('dueDate', 800);
    expect(boundedResizeEnd).toHaveBeenLastCalledWith('dueDate', 800);

    const unmountLiveResize = vi.fn();
    const activeView = render(<DeadlineTable items={[occurrence]} onColumnWidthChange={unmountLiveResize} />);
    fireEvent.pointerDown(within(activeView.container).getByRole('separator', { name: 'Resize Operative due date column' }), { clientX: 100 });
    activeView.unmount();
    fireEvent.pointerMove(window, { clientX: 300 });
    expect(unmountLiveResize).not.toHaveBeenCalled();
  });

  it('disables the next page control for an empty result set', () => {
    render(<DeadlineTable items={[]} page={1} total={0} totalPages={0} limit={20} onPageChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
  });

  it('transfers focus and dismisses event and table action dialogs accessibly', () => {
    const { unmount } = render(<DeadlineEvent occurrence={occurrence} canEdit onUpdate={vi.fn()} />);
    const eventTrigger = screen.getByRole('button', { name: /OACS Annual Return/ });
    fireEvent.click(eventTrigger);
    expect(screen.getByRole('button', { name: 'Close deadline details' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: /OACS deadline details/i })).not.toBeInTheDocument();
    expect(eventTrigger).toHaveFocus();
    fireEvent.click(eventTrigger);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('dialog', { name: /OACS deadline details/i })).not.toBeInTheDocument();
    expect(eventTrigger).toHaveFocus();

    unmount();
    let backgroundActivations = 0;
    render(
      <>
        <button type="button" onClick={() => { backgroundActivations += 1; }}>Background action</button>
        <DeadlineTable items={[occurrence]} page={1} total={1} totalPages={1} limit={20} canEdit onUpdate={vi.fn()} onPageChange={vi.fn()} onLimitChange={vi.fn()} />
      </>,
    );
    const actionTrigger = screen.getAllByRole('button', { name: /Actions for OACS Annual Return/ })[0]!;
    fireEvent.click(actionTrigger);
    const actionDialog = screen.getByRole('dialog', { name: 'Deadline actions' });
    expect(actionDialog).toBeVisible();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(within(actionDialog).getByText('Oaktree Accounting & Corporate Solution Pte. Ltd.')).toBeVisible();
    expect(within(actionDialog).getByRole('button', { name: 'Close deadline details' })).toHaveFocus();
    const backdrop = screen.getByTestId('deadline-actions-backdrop');
    fireEvent.mouseDown(backdrop);
    fireEvent.click(backdrop);
    expect(backgroundActivations).toBe(0);
    expect(screen.queryByRole('dialog', { name: 'Deadline actions' })).not.toBeInTheDocument();
    expect(actionTrigger).toHaveFocus();

    fireEvent.click(actionTrigger);
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    const reopenedDialog = screen.getByRole('dialog', { name: 'Deadline actions' });
    fireEvent.keyDown(reopenedDialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Deadline actions' })).not.toBeInTheDocument();
    expect(actionTrigger).toHaveFocus();
    expect(screen.getByRole('combobox')).toHaveClass('min-h-11');
    expect(screen.getByRole('button', { name: 'Previous page' })).toHaveClass('min-h-11', 'min-w-11');
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
  });

  it('contains focus within the single table action layer without nested modal semantics', () => {
    render(<DeadlineTable items={[occurrence]} page={1} total={1} totalPages={1} limit={20} canEdit onUpdate={vi.fn()} onPageChange={vi.fn()} />);
    fireEvent.click(screen.getAllByRole('button', { name: /Actions for OACS Annual Return/ })[0]!);
    const actionDialog = screen.getByRole('dialog', { name: 'Deadline actions' });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(actionDialog).toHaveAttribute('aria-modal', 'true');
    const focusables = within(actionDialog).getAllByRole('button');
    const first = screen.getByRole('button', { name: 'Close deadline details' });
    const last = focusables[focusables.length - 1]!;
    first.focus();
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(first).toHaveFocus();
    expect(screen.getAllByRole('dialog').filter((dialog) => dialog.getAttribute('aria-modal') === 'true')).toHaveLength(1);
  });

  it('uses a compact event cap and exposes the remaining agenda on smaller viewports', () => {
    media.isLargeDesktop.mockReturnValue(false);
    const denseItems = [1, 2, 3, 4].map((index) => ({ ...occurrence, id: `44444444-4444-4444-8444-44444444444${index}`, milestoneKey: `annual-return-${index}` }));
    hooks.useDeadlines.mockReturnValue({ data: { mode: 'CALENDAR', items: denseItems, truncated: false }, isLoading: false, isFetching: false, error: null });
    hooks.useUserPreference.mockReturnValue({ data: { value: null }, isLoading: false });
    hooks.useUpsertUserPreference.mockReturnValue({ mutate: vi.fn(), isPending: false });

    render(<DeadlineCalendar items={denseItems} focusMonth={new Date(2026, 7, 1)} />);

    expect(screen.getByRole('button', { name: /Show 3 more deadlines on 28 August 2026/ })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /Show 3 more deadlines on 28 August 2026/ }));
    expect(screen.getByRole('region', { name: 'Selected day agenda' })).toHaveTextContent('4 deadlines');
  });

  it('shows retryable loading and error states without a misleading empty calendar', () => {
    media.isLargeDesktop.mockReturnValue(true);
    const refetch = vi.fn();
    hooks.useDeadlines.mockReturnValue({ data: undefined, isLoading: false, isFetching: false, error: new Error('network'), refetch });
    render(<DeadlineCalendar />);
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to load deadlines');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalled();
    expect(screen.queryByRole('grid', { name: /calendar/i })).not.toBeInTheDocument();
  });
});
