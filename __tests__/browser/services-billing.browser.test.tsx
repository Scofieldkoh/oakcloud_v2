import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import type { BillingOccurrenceDto } from '@/services/billing';
import '@/app/globals.css';

const hooks = vi.hoisted(() => ({
  useBillingOccurrences: vi.fn(),
  useUpdateBillingOccurrence: vi.fn(),
  useResetBillingOverride: vi.fn(),
  useMarkBillingOccurrencesAsBilled: vi.fn(),
  useBillingCoverage: vi.fn(),
  useUserPreference: vi.fn(),
  useUpsertUserPreference: vi.fn(),
  useServicesWorkspaceSettings: vi.fn(),
  useServiceRoster: vi.fn(),
  useServiceRosterFamilies: vi.fn(),
}));

const navigation = vi.hoisted(() => ({
  pathname: '/billing',
  searchParams: new URLSearchParams('from=2026-08-01&to=2026-09-30'),
  replace: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ replace: navigation.replace }),
  useSearchParams: () => navigation.searchParams,
}));

vi.mock('@/hooks/use-billing-occurrences', () => ({
  useBillingOccurrences: hooks.useBillingOccurrences,
  useUpdateBillingOccurrence: hooks.useUpdateBillingOccurrence,
  useResetBillingOverride: hooks.useResetBillingOverride,
  useMarkBillingOccurrencesAsBilled: hooks.useMarkBillingOccurrencesAsBilled,
}));
vi.mock('@/hooks/use-service-roster-families', () => ({ useServiceRosterFamilies: hooks.useServiceRosterFamilies }));
vi.mock('@/hooks/use-billing-coverage', () => ({ useBillingCoverage: hooks.useBillingCoverage }));
vi.mock('@/hooks/use-user-preferences', () => ({
  useUserPreference: hooks.useUserPreference,
  useUpsertUserPreference: hooks.useUpsertUserPreference,
}));
vi.mock('@/hooks/use-services-workspace-settings', () => ({ useServicesWorkspaceSettings: hooks.useServicesWorkspaceSettings }));
vi.mock('@/hooks/use-service-roster', () => ({ useServiceRoster: hooks.useServiceRoster }));
vi.mock('@/hooks/use-service-roster-families', () => ({ useServiceRosterFamilies: hooks.useServiceRosterFamilies }));
vi.mock('@/components/services/roster/add-client-service-dialog', () => ({ AddClientServiceDialog: () => null }));

import { ServicesWorkspace } from '@/components/services/services-workspace';
import { defaultBillingColumnWidths } from '@/components/services/billing/billing-table';

const occurrence: BillingOccurrenceDto = {
  id: '44444444-4444-4444-8444-444444444444',
  tenantId: '11111111-1111-4111-8111-111111111111',
  companyId: '22222222-2222-4222-8222-222222222222',
  clientServiceId: '55555555-5555-4555-8555-555555555555',
  feeLineId: '66666666-6666-4666-8666-666666666666',
  billingPeriodKey: '2026-08',
  scheduleEntryKey: 'entry-1',
  generationKey: 'billing-v1-1',
  calculatedExpectedDate: '2026-08-31',
  operativeExpectedDate: '2026-08-31',
  dateOverridden: false,
  dateOverrideReason: null,
  dateOverriddenAt: null,
  dateOverriddenById: null,
  baseAmount: '480.00',
  baseCurrency: 'SGD',
  operativeAmount: '480.00',
  operativeCurrency: 'SGD',
  valueOverridden: false,
  valueOverrideReason: null,
  valueOverriddenAt: null,
  valueOverriddenById: null,
  status: 'OPEN',
  timingState: 'UPCOMING',
  billedDate: null,
  markedBilledAt: null,
  markedBilledById: null,
  externalReference: null,
  notes: null,
  waivedAt: null,
  waivedById: null,
  waiverReason: null,
  cancelledAt: null,
  cancelledById: null,
  cancellationReason: null,
  cancellationReconciliationRequestId: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  company: {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Fieldstone Consulting Pte. Ltd.',
    displayAlias: null,
    displayLabel: 'Fieldstone',
    uen: null,
  },
  family: { id: '77777777-7777-4777-8777-777777777777', name: 'Payroll', displayColor: '#715DA8' },
  service: { id: '55555555-5555-4555-8555-555555555555', name: 'Monthly Payroll', familyName: 'Payroll', variantId: null, variantName: null },
  feeLine: { id: '66666666-6666-4666-8666-666666666666', description: 'Monthly payroll fee', amount: '480.00', currency: 'SGD' },
};

const issueRows = [{
  id: 'issue-1',
  type: 'MISSING_START_DATE' as const,
  severity: 'ERROR' as const,
  company: { id: occurrence.companyId, name: occurrence.company.name, displayLabel: occurrence.company.displayLabel },
  service: { id: occurrence.clientServiceId, name: occurrence.service.name, familyName: occurrence.service.familyName, familyColor: '#715DA8' },
  feeLine: { id: occurrence.feeLineId, description: occurrence.feeLine.description },
  message: 'Set a billing start date',
}];

function setup({ withIssues = true, totalPages = 2 } = {}) {
  navigation.pathname = '/billing';
  navigation.searchParams = new URLSearchParams('from=2026-08-01&to=2026-09-30');
  navigation.replace.mockReset();
  hooks.useBillingOccurrences.mockReturnValue({ data: { mode: 'TABLE', items: [occurrence], total: 1, page: 1, limit: 20, totalPages: 1 }, isLoading: false, isFetching: false, error: null });
  const update = vi.fn();
  hooks.useUpdateBillingOccurrence.mockReturnValue({ mutate: update, isPending: false, error: null });
  hooks.useResetBillingOverride.mockReturnValue({ mutate: vi.fn(), isPending: false });
  const bulk = vi.fn().mockResolvedValue([]);
  hooks.useMarkBillingOccurrencesAsBilled.mockReturnValue({ mutateAsync: bulk, isPending: false, error: null });
  hooks.useServiceRosterFamilies.mockReturnValue({ data: [{ id: occurrence.family.id!, name: 'Payroll', displayColor: '#715DA8' }], isLoading: false, error: null });
  hooks.useBillingCoverage.mockReturnValue({ data: { openIssueCount: withIssues ? 1 : 0, affectedServiceCount: withIssues ? 1 : 0, healthyActiveServiceCount: withIssues ? 0 : 1, issues: withIssues ? issueRows : [] }, isLoading: false, error: null });
  hooks.useUserPreference.mockReturnValue({ data: { value: null }, isLoading: false });
  hooks.useUpsertUserPreference.mockReturnValue({ mutate: vi.fn(), isPending: false });
  hooks.useServicesWorkspaceSettings.mockReturnValue({ data: { workspaceEnabled: true, deadlineWritesEnabled: false }, isLoading: false, error: null });
  hooks.useServiceRoster.mockReturnValue({ data: { items: [], total: 0, page: 1, limit: 20, totalPages: 0 }, isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
  if (totalPages > 1) {
    hooks.useBillingOccurrences.mockReturnValue({ data: { mode: 'TABLE', items: [occurrence], total: 41, page: 1, limit: 20, totalPages }, isLoading: false, isFetching: false, error: null });
  }
  return { update, bulk };
}

describe('Services billing responsive browser surface', () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.clearAllMocks();
  });

  it('covers the Services Billing route, collapsed issues, filters, sort, resize, pagination, and scope dialog on desktop', async () => {
    const { bulk } = setup();
    await page.viewport(1440, 900);
    render(<ServicesWorkspace />);

    await expect.element(screen.getByRole('heading', { name: 'Billing' })).toBeVisible();
    expect(screen.queryByRole('tablist', { name: 'Services workspace sections' })).not.toBeInTheDocument();
    await expect.element(screen.getByRole('table', { name: 'Billing occurrences table' })).toBeVisible();
    const main = screen.getByRole('main');
    const header = screen.getByRole('heading', { name: 'Billing' }).closest('header');
    if (!header) throw new Error('Services header missing');
    const mainRect = main.getBoundingClientRect();
    const headerRect = header.getBoundingClientRect();
    expect(Math.round(headerRect.left - mainRect.left)).toBe(24);
    expect(screen.getByRole('button', { name: 'Remove Date filter' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Reset filters' })).not.toBeInTheDocument();
    const billingTable = screen.getByRole('table', { name: 'Billing occurrences table' });
    const tableScroller = billingTable.parentElement;
    if (!tableScroller) throw new Error('Billing table scroller missing');
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth);
    expect(tableScroller.scrollWidth).toBeGreaterThan(tableScroller.clientWidth);
    const serviceFilterRect = screen.getByRole('searchbox', { name: 'Filter Service' }).getBoundingClientRect();
    const feeLineFilterRect = screen.getByRole('searchbox', { name: 'Filter Fee line' }).getBoundingClientRect();
    expect(Math.round(feeLineFilterRect.left - serviceFilterRect.right)).toBeGreaterThanOrEqual(16);
    const inlineFilterInputs = [
      within(billingTable).getByRole('textbox', { name: 'Filter Expected date' }),
      within(billingTable).getByRole('combobox', { name: 'Filter Timing' }),
      within(billingTable).getByRole('combobox', { name: 'Filter Company' }),
      within(billingTable).getByRole('combobox', { name: 'Filter Family' }),
      within(billingTable).getByRole('searchbox', { name: 'Filter Service' }),
      within(billingTable).getByRole('searchbox', { name: 'Filter Fee line' }),
      within(billingTable).getByRole('searchbox', { name: 'Filter Period' }),
      within(billingTable).getByRole('spinbutton', { name: 'Filter Minimum amount' }),
      within(billingTable).getByRole('spinbutton', { name: 'Filter Maximum amount' }),
      within(billingTable).getByRole('textbox', { name: 'Filter Billed date' }),
    ];
    // Status and Reference are hidden by default (reference table layout).
    expect(within(billingTable).queryByRole('combobox', { name: 'Filter Status' })).toBeNull();
    const placeholderColors = inlineFilterInputs.map((input) => getComputedStyle(input, '::placeholder').color);
    expect(new Set(placeholderColors)).toEqual(new Set([placeholderColors[0]!]));
    for (const cell of billingTable.querySelectorAll('tbody td')) expect(getComputedStyle(cell).verticalAlign).toBe('middle');
    const selectAllRect = within(billingTable).getByRole('button', { name: 'Select all billing occurrences' }).getBoundingClientRect();
    const selectRowRect = within(billingTable).getByRole('button', { name: 'Select billing occurrence for Fieldstone Consulting Pte. Ltd.' }).getBoundingClientRect();
    expect(Math.abs((selectAllRect.left + selectAllRect.width / 2) - (selectRowRect.left + selectRowRect.width / 2))).toBeLessThanOrEqual(1);
    await expect.element(within(billingTable).getByText('Fieldstone Consulting Pte. Ltd.')).toBeVisible();
    const billingRow = billingTable.querySelector('tbody tr');
    if (!billingRow) throw new Error('Billing row missing');
    fireEvent.click(billingRow);
    await expect.element(screen.getByRole('dialog', { name: 'Edit billing tracking' })).toBeVisible();
    await screen.getByRole('button', { name: 'Cancel' }).click();
    await screen.getAllByRole('button', { name: 'Select billing occurrence for Fieldstone Consulting Pte. Ltd.' })[0]!.click();
    await screen.getByRole('button', { name: 'Mark as billed' }).click();
    expect(bulk).toHaveBeenCalledWith([expect.objectContaining({ id: occurrence.id, updatedAt: occurrence.updatedAt })]);
    const reconciliation = screen.getByRole('button', { name: /Billing reconciliation · 1 issue · 1 error/ });
    expect(reconciliation).toHaveAttribute('aria-expanded', 'false');
    await reconciliation.click();
    await expect.element(screen.getByRole('group', { name: 'Fieldstone · Monthly Payroll' })).toBeVisible();
    const billed = screen.getByRole('button', { name: 'Billed' });
    expect(billed).toHaveAttribute('aria-pressed', 'false');
    await billed.click();
    expect(billed).toHaveAttribute('aria-pressed', 'true');

    const sort = screen.getByRole('button', { name: /Sort by Expected date/ });
    await sort.click();
    expect(navigation.replace).toHaveBeenLastCalledWith(expect.stringContaining('sortBy=expectedDate'), { scroll: false });
    fireEvent.pointerDown(screen.getByRole('separator', { name: 'Resize Company column' }), { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 150 });
    fireEvent.pointerUp(window, { clientX: 150 });
    await screen.getByRole('button', { name: 'Next page' }).click();
    expect(navigation.replace).toHaveBeenLastCalledWith(expect.stringContaining('page=2'), { scroll: false });

    await screen.getAllByRole('button', { name: 'Edit tracking for Fieldstone Consulting Pte. Ltd.' })[0]!.click();
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '550.00' } });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Updated tracking amount' } });
    await screen.getByRole('button', { name: 'Save tracking update' }).click();
    await expect.element(screen.getByRole('dialog', { name: 'Apply amount change' })).toBeVisible();
    await screen.getByRole('button', { name: 'This occurrence' }).click();
  });

  it('keeps the Billing cards readable at tablet and mobile widths and preserves URL filter state', async () => {
    setup();
    navigation.pathname = '/billing';
    navigation.searchParams = new URLSearchParams('query=payroll&statuses=BILLED&from=2026-08-01&to=2026-09-30&page=2');
    await page.viewport(768, 900);
    render(<ServicesWorkspace />);

    await expect.element(screen.getByRole('table', { name: 'Billing occurrences table' })).toBeVisible();
    await expect.element(screen.getByRole('button', { name: 'Billed' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('searchbox', { name: 'Search company or fee line' })).toHaveValue('payroll');
    expect(navigation.searchParams.get('page')).toBe('2');

    await page.viewport(390, 844);
    document.body.replaceChildren();
    render(<ServicesWorkspace />);

    await expect.element(screen.getByRole('searchbox', { name: 'Search company or fee line' })).toBeVisible();
    await expect.element(screen.getByRole('region', { name: 'Billing occurrence cards' })).toBeVisible();
    const billingCards = screen.getByRole('region', { name: 'Billing occurrence cards' });
    await expect.element(within(billingCards).getByText(/Monthly payroll fee/)).toBeVisible();
    const mobileMain = screen.getByRole('main');
    const mobileHeader = screen.getByRole('heading', { name: 'Billing' }).closest('header');
    if (!mobileHeader) throw new Error('Services mobile header missing');
    expect(Math.round(mobileHeader.getBoundingClientRect().left - mobileMain.getBoundingClientRect().left)).toBe(16);
    expect(screen.getByRole('button', { name: 'Remove Date filter' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Reset filters' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Billing reconciliation/ })).toHaveAttribute('aria-expanded', 'false');
  });

  it('renders the empty state inside the desktop billing table body', async () => {
    setup({ totalPages: 1 });
    hooks.useBillingOccurrences.mockReturnValue({ data: { mode: 'TABLE', items: [], total: 0, page: 1, limit: 20, totalPages: 0 }, isLoading: false, isFetching: false, error: null });
    await page.viewport(2560, 900);
    render(<ServicesWorkspace />);

    const table = screen.getByRole('table', { name: 'Billing occurrences table' });
    const emptyMessage = within(table).getByText('No matching billing occurrences');
    const scrollContainer = table.parentElement;
    if (!scrollContainer) throw new Error('Billing table scroll container missing');
    await expect.element(within(table).getByRole('columnheader', { name: /^Company$/ })).toBeVisible();
    expect(emptyMessage.closest('tbody')).not.toBeNull();
    expect(getComputedStyle(emptyMessage.closest('td')!).textAlign).toBe('center');
    expect(getComputedStyle(table).tableLayout).toBe('auto');
    const companyHeader = within(table).getByRole('columnheader', { name: /^Company$/ });
    const actionsHeader = within(table).getByRole('columnheader', { name: 'Actions' });
    expect(Math.abs(companyHeader.getBoundingClientRect().width - defaultBillingColumnWidths.company)).toBeLessThanOrEqual(1);
    expect(actionsHeader.getBoundingClientRect().width).toBeGreaterThan(500);
    expect(Math.abs(table.getBoundingClientRect().width - scrollContainer.getBoundingClientRect().width))
      .toBeLessThanOrEqual(1);
  });

  it('keeps the Add service action touch-safe on mobile and compact on desktop', async () => {
    setup();
    navigation.pathname = '/services';
    navigation.searchParams = new URLSearchParams();

    await page.viewport(1440, 900);
    render(<ServicesWorkspace />);

    const addService = screen.getByRole('button', { name: 'Add service' });
    expect(addService.getBoundingClientRect().height).toBeGreaterThanOrEqual(32);
    expect(addService.getBoundingClientRect().height).toBeLessThanOrEqual(40);

    await page.viewport(390, 844);
    document.body.replaceChildren();
    render(<ServicesWorkspace />);

    expect(screen.getByRole('button', { name: 'Add service' }).getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  });
});
