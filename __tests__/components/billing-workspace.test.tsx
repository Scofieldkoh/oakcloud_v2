import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BillingOccurrenceDto } from '@/services/billing';

const hooks = vi.hoisted(() => ({
  useBillingOccurrences: vi.fn(),
  useUpdateBillingOccurrence: vi.fn(),
  useResetBillingOverride: vi.fn(),
  useMarkBillingOccurrencesAsBilled: vi.fn(),
  useServiceRosterFamilies: vi.fn(),
  useBillingCoverage: vi.fn(),
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

import { BillingWorkspace } from '@/components/services/billing/billing-workspace';

const occurrence = {
  id: 'occurrence-1',
  tenantId: 'tenant-1',
  companyId: 'company-1',
  clientServiceId: 'service-1',
  feeLineId: 'fee-1',
  billingPeriodKey: '2026-08',
  scheduleEntryKey: 'entry-1',
  generationKey: 'generation-1',
  calculatedExpectedDate: '2026-08-31',
  operativeExpectedDate: '2026-08-31',
  dateOverridden: false,
  dateOverrideReason: null,
  dateOverriddenAt: null,
  dateOverriddenById: null,
  baseAmount: '1200.00',
  baseCurrency: 'SGD',
  operativeAmount: '1200.00',
  operativeCurrency: 'SGD',
  valueOverridden: false,
  valueOverrideReason: null,
  valueOverriddenAt: null,
  valueOverriddenById: null,
  status: 'BILLED',
  timingState: null,
  billedDate: '2026-08-31',
  markedBilledAt: '2026-08-31T00:00:00.000Z',
  markedBilledById: 'user-1',
  externalReference: 'REF-1',
  notes: 'Existing note',
  waivedAt: null,
  waivedById: null,
  waiverReason: null,
  cancelledAt: null,
  cancelledById: null,
  cancellationReason: null,
  cancellationReconciliationRequestId: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-31T00:00:00.000Z',
  company: { id: 'company-1', name: 'Example Pte. Ltd.', displayAlias: null, displayLabel: 'Example', uen: null },
  family: { id: 'family-1', name: 'Corporate', displayColor: '#3C7768' },
  service: { id: 'service-1', name: 'Annual Return', familyName: 'Corporate', variantId: null, variantName: null },
  feeLine: { id: 'fee-1', description: 'Annual filing', amount: '1200.00', currency: 'SGD' },
} satisfies BillingOccurrenceDto;

const secondOccurrence: BillingOccurrenceDto = {
  ...occurrence,
  id: 'occurrence-2',
  companyId: 'company-2',
  clientServiceId: 'service-2',
  feeLineId: 'fee-2',
  externalReference: 'REF-2',
  notes: 'Second row note',
  company: { id: 'company-2', name: 'Other Pte. Ltd.', displayAlias: null, displayLabel: 'Other', uen: null },
  service: { id: 'service-2', name: 'Monthly Payroll', familyName: 'Payroll', variantId: null, variantName: null },
  feeLine: { id: 'fee-2', description: 'Monthly payroll', amount: '1200.00', currency: 'SGD' },
};

describe('BillingWorkspace', () => {
  beforeEach(() => {
    navigation.searchParams = new URLSearchParams();
    navigation.replace.mockReset();
    hooks.useBillingOccurrences.mockReturnValue({ data: { mode: 'TABLE', items: [], total: 0, page: 1, limit: 20, totalPages: 0 }, isLoading: false, isFetching: false, error: null });
    hooks.useUpdateBillingOccurrence.mockReturnValue({ mutate: vi.fn(), isPending: false, reset: vi.fn() });
    hooks.useResetBillingOverride.mockReturnValue({ mutate: vi.fn(), isPending: false, reset: vi.fn() });
    hooks.useMarkBillingOccurrencesAsBilled.mockReturnValue({ mutateAsync: vi.fn(), isPending: false, error: null, reset: vi.fn() });
    hooks.useServiceRosterFamilies.mockReturnValue({ data: [], isLoading: false, error: null });
    hooks.useBillingCoverage.mockReturnValue({ data: { openIssueCount: 0, affectedServiceCount: 0, healthyActiveServiceCount: 0, issues: [] }, isLoading: false, error: null });
    hooks.useUserPreference.mockReturnValue({ data: { value: null }, isLoading: false });
    hooks.useUpsertUserPreference.mockReturnValue({ mutate: vi.fn(), isPending: false });
  });

  it('exposes the Billing workspace controls without the former subheader', () => {
    render(<BillingWorkspace />);

    expect(screen.getByRole('region', { name: 'Billing workspace' })).toHaveClass('min-w-0', 'max-w-full');
    expect(screen.queryByText(/manual billing tracking/i)).not.toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search company or fee line' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Open' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Billed' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Waived' })).toBeVisible();
    expect(screen.queryByText(/create invoice|collect payment/i)).not.toBeInTheDocument();
  });

  it('shows the default date range as an active removable filter', () => {
    render(<BillingWorkspace />);

    expect(screen.getByRole('button', { name: 'Remove Date filter' })).toBeVisible();
    expect(screen.getByText('Date:')).toBeVisible();
  });

  it('initializes filters, date range, sort, and page from URL state and writes changes back without dropping the Billing tab', () => {
    vi.useFakeTimers();
    try {
    navigation.searchParams = new URLSearchParams('tab=billing&query=annual&companyQuery=Example&serviceQuery=Return&feeQuery=filing&statuses=BILLED&timing=DUE&familyIds=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa&page=2&from=2026-08-01&to=2026-09-30&sortBy=amount&sortOrder=desc');
    render(<BillingWorkspace />);

    expect(screen.getByRole('searchbox', { name: 'Search company or fee line' })).toHaveValue('annual');
    expect(screen.getByRole('button', { name: 'Billed' })).toHaveAttribute('aria-pressed', 'true');
    expect(hooks.useBillingOccurrences).toHaveBeenCalledWith(expect.objectContaining({
      query: 'annual',
      companyQuery: 'Example',
      serviceQuery: 'Return',
      feeQuery: 'filing',
      statuses: ['BILLED'],
      timing: ['DUE'],
      familyIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
      page: 2,
      from: '2026-08-01',
      to: '2026-09-30',
      sortBy: 'amount',
      sortOrder: 'desc',
    }));

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search company or fee line' }), { target: { value: 'payroll' } });
    expect(navigation.replace).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(300); });
    expect(navigation.replace).toHaveBeenLastCalledWith(expect.stringContaining('tab=billing'), { scroll: false });
    expect(navigation.replace).toHaveBeenLastCalledWith(expect.stringContaining('query=payroll'), { scroll: false });

    const removeDate = screen.getByRole('button', { name: 'Remove Date filter' });
    fireEvent.click(removeDate);
    expect(navigation.replace).toHaveBeenLastCalledWith(expect.not.stringContaining('from='), { scroll: false });
    expect(navigation.replace).toHaveBeenLastCalledWith(expect.not.stringContaining('to='), { scroll: false });
    expect(navigation.replace).toHaveBeenLastCalledWith(expect.stringContaining('dateRange=none'), { scroll: false });
    const latestSearch = hooks.useBillingOccurrences.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(latestSearch).not.toHaveProperty('from');
    expect(latestSearch).not.toHaveProperty('to');
    expect(latestSearch).toMatchObject({ page: 1, limit: 20 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('debounces global and inline text filters while applying date filters immediately', () => {
    vi.useFakeTimers();
    try {
      hooks.useBillingOccurrences.mockReturnValue({ data: { mode: 'TABLE', items: [occurrence], total: 1, page: 1, limit: 20, totalPages: 1 }, isLoading: false, isFetching: false, error: null });
      render(<BillingWorkspace />);

      fireEvent.change(screen.getByRole('searchbox', { name: 'Search company or fee line' }), { target: { value: 'payroll' } });
      expect(navigation.replace).not.toHaveBeenCalled();
      act(() => { vi.advanceTimersByTime(299); });
      expect(navigation.replace).not.toHaveBeenCalled();
      act(() => { vi.advanceTimersByTime(1); });
      expect(navigation.replace).toHaveBeenLastCalledWith(expect.stringContaining('query=payroll'), { scroll: false });

      const callsAfterGlobal = navigation.replace.mock.calls.length;
      const companyFilter = screen.getByRole('combobox', { name: 'Filter Company' });
      fireEvent.change(companyFilter, { target: { value: 'Example' } });
      fireEvent.keyDown(companyFilter, { key: 'ArrowDown' });
      fireEvent.keyDown(companyFilter, { key: 'Enter' });
      expect(navigation.replace).toHaveBeenCalledTimes(callsAfterGlobal + 1);
      expect(navigation.replace).toHaveBeenLastCalledWith(expect.stringContaining('companyId=company-1'), { scroll: false });

      expect(screen.getByRole('button', { name: 'Remove Date filter' })).toBeVisible();
    } finally {
      vi.useRealTimers();
    }
  });

  it('hydrates text drafts from a changed URL without writing another URL update', () => {
    hooks.useBillingOccurrences.mockReturnValue({ data: { mode: 'TABLE', items: [occurrence], total: 1, page: 1, limit: 20, totalPages: 1 }, isLoading: false, isFetching: false, error: null });
    const view = render(<BillingWorkspace />);
    navigation.searchParams = new URLSearchParams('tab=billing&query=restored&companyId=company-1');
    view.rerender(<BillingWorkspace />);

    expect(screen.getByRole('searchbox', { name: 'Search company or fee line' })).toHaveValue('restored');
    expect(screen.getByRole('combobox', { name: 'Filter Company' })).toHaveValue('Example Pte. Ltd.');
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it('keeps the edit dialog open, input intact, and error visible after a failed update', () => {
    hooks.useBillingOccurrences.mockReturnValue({ data: { mode: 'TABLE', items: [occurrence], total: 1, page: 1, limit: 20, totalPages: 1 }, isLoading: false, isFetching: false, error: null });
    hooks.useUpdateBillingOccurrence.mockReturnValue({ mutate: vi.fn(), isPending: false, error: new Error('Unable to update billing tracking') });
    render(<BillingWorkspace />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit tracking for Example Pte. Ltd.' })[0]!);
    const notes = screen.getByLabelText('Notes');
    fireEvent.change(notes, { target: { value: 'Keep this after failure' } });

    expect(screen.getByRole('dialog', { name: 'Edit billing tracking' })).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to update billing tracking');
    expect(notes).toHaveValue('Keep this after failure');
  });

  it('resets mutation state when closing and opening a different occurrence', () => {
    let mutationError: Error | null = null;
    const resetMutation = vi.fn(() => {
      mutationError = null;
    });
    hooks.useBillingOccurrences.mockReturnValue({ data: { mode: 'TABLE', items: [occurrence, secondOccurrence], total: 2, page: 1, limit: 20, totalPages: 1 }, isLoading: false, isFetching: false, error: null });
    hooks.useUpdateBillingOccurrence.mockImplementation(() => ({ mutate: vi.fn(), isPending: false, error: mutationError, reset: resetMutation }));
    hooks.useResetBillingOverride.mockReturnValue({ mutate: vi.fn(), isPending: false, error: null, reset: resetMutation });
    const view = render(<BillingWorkspace />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit tracking for Example Pte. Ltd.' })[0]!);
    mutationError = new Error('Unable to update billing tracking');
    view.rerender(<BillingWorkspace />);
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Unsaved failed note' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to update billing tracking');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(resetMutation).toHaveBeenCalled();

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit tracking for Other Pte. Ltd.' })[0]!);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Notes')).toHaveValue('Second row note');
    expect(screen.getByLabelText('External reference')).toHaveValue('REF-2');
  });
});
