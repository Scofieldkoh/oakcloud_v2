import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import type { DeadlineOccurrenceDto } from '@/services/deadline';
import '@/app/globals.css';

const hooks = vi.hoisted(() => ({
  useDeadlines: vi.fn(),
  useUserPreference: vi.fn(),
  useUpsertUserPreference: vi.fn(),
}));

vi.mock('@/hooks/use-deadlines', () => ({ useDeadlines: hooks.useDeadlines, useDeadlineHolidays: () => ({ data: undefined }) }));
vi.mock('@/hooks/use-user-preferences', () => ({
  useUserPreference: hooks.useUserPreference,
  useUpsertUserPreference: hooks.useUpsertUserPreference,
}));

import { DeadlineCalendar } from '@/components/services/deadlines/deadline-calendar';
import { DeadlineTable, defaultDeadlineColumnWidths } from '@/components/services/deadlines/deadline-table';

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
  notes: null,
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

function setup() {
  hooks.useDeadlines.mockReturnValue({
    data: { mode: 'CALENDAR', items: [occurrence], truncated: false },
    isLoading: false,
    isFetching: false,
    error: null,
  });
  hooks.useUserPreference.mockReturnValue({ data: { value: null }, isLoading: false });
  hooks.useUpsertUserPreference.mockReturnValue({ mutate: vi.fn(), isPending: false });
}

describe('Services deadlines responsive browser surface', () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.clearAllMocks();
  });

  it('keeps the desktop calendar readable with two months and visible event identity', async () => {
    setup();
    await page.viewport(2200, 900);
    // Pin the month so the fixture's due date stays on screen whatever today is.
    render(<DeadlineCalendar focusMonth={new Date(2026, 7, 1)} />);

    await expect.element(screen.getByRole('region', { name: /selected day agenda/i })).toBeVisible();
    expect(screen.getAllByRole('grid', { name: /calendar/i })).toHaveLength(2);
    await expect.element(screen.getByRole('button', { name: /OACS Annual Return/i })).toBeVisible();
  });

  it('uses one month on tablet and mobile without dropping the selected-day agenda', async () => {
    setup();
    await page.viewport(900, 900);
    render(<DeadlineCalendar />);
    expect(screen.getAllByRole('grid', { name: /calendar/i })).toHaveLength(1);

    await page.viewport(390, 844);
    expect(screen.getAllByRole('grid', { name: /calendar/i })).toHaveLength(1);
    await expect.element(screen.getByRole('region', { name: /selected day agenda/i })).toBeVisible();
  });

  it('renders the empty state inside the desktop deadline table body', async () => {
    // Wide enough for the default column widths, so Actions takes the spare space.
    await page.viewport(2200, 900);
    render(<DeadlineTable items={[]} inlineFilters={<div>Deadline filters</div>} />);

    const table = screen.getByRole('table', { name: 'Deadline occurrences table' });
    const emptyMessage = within(table).getByText('No deadlines found');
    const scrollContainer = table.parentElement;
    if (!scrollContainer) throw new Error('Deadline table scroll container missing');
    await expect.element(within(table).getByRole('columnheader', { name: /Company/ })).toBeVisible();
    expect(emptyMessage.closest('tbody')).not.toBeNull();
    expect(getComputedStyle(emptyMessage.closest('td')!).textAlign).toBe('center');
    expect(getComputedStyle(table).tableLayout).toBe('auto');
    const companyHeader = within(table).getByRole('columnheader', { name: /Company/ });
    const actionsHeader = within(table).getByRole('columnheader', { name: 'Actions' });
    expect(Math.abs(companyHeader.getBoundingClientRect().width - defaultDeadlineColumnWidths.company)).toBeLessThanOrEqual(1);
    expect(actionsHeader.getBoundingClientRect().width).toBeGreaterThan(90);
    expect(Math.abs(table.getBoundingClientRect().width - scrollContainer.getBoundingClientRect().width))
      .toBeLessThanOrEqual(1);
  });
});
