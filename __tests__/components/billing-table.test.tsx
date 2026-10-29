import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BillingOccurrenceDto } from '@/services/billing';
import { BillingTable } from '@/components/services/billing/billing-table';
import { BILLING_COLUMN_IDS, defaultBillingTablePreference } from '@/lib/validations/services-preferences';

const allVisibleBillingColumns = Object.fromEntries(
  BILLING_COLUMN_IDS.map((column) => [column, true]),
) as Record<(typeof BILLING_COLUMN_IDS)[number], boolean>;

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
  baseAmount: '100.00',
  baseCurrency: 'SGD',
  operativeAmount: '100.00',
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
  company: { id: 'company-1', name: 'Northstar Holdings', displayAlias: 'Northstar', displayLabel: 'Northstar', uen: null },
  family: { id: 'family-1', name: 'Payroll', displayColor: '#715DA8' },
  service: { id: 'service-1', name: 'Monthly payroll', familyName: 'Payroll', variantId: null, variantName: null },
  feeLine: { id: 'fee-1', description: 'Monthly fee', amount: '100.00', currency: 'SGD' },
} satisfies BillingOccurrenceDto;

describe('BillingTable', () => {
  it('renders split billing columns with the legal company name only', () => {
    render(
      <BillingTable
        items={[occurrence]}
        columnWidths={defaultBillingTablePreference.columnWidths}
        columnOrder={[...BILLING_COLUMN_IDS]}
        columnVisibility={allVisibleBillingColumns}
        sortBy="expectedDate"
        sortOrder="asc"
      />,
    );

    const table = screen.getByRole('table', { name: 'Billing occurrences table' });
    for (const label of ['Family', 'Service', 'Fee line', 'Period']) {
      expect(within(table).getByRole('columnheader', { name: new RegExp(`^${label}$`) })).toBeVisible();
    }
    expect(within(table).getByText('Northstar Holdings')).toBeVisible();
    expect(within(table).queryByText('Northstar', { selector: 'span' })).not.toBeInTheDocument();
    expect(within(table).getByText('Payroll')).toBeVisible();
    expect(within(table).getByText('Monthly payroll')).toBeVisible();
    expect(within(table).getByText('Monthly fee')).toBeVisible();
    expect(within(table).getByText('2026-08')).toBeVisible();
  });

  it('renders an inline filter control for every data column', () => {
    render(
      <BillingTable
        items={[occurrence]}
        families={[{ id: 'family-1', name: 'Payroll', displayColor: '#715DA8' }]}
        columnWidths={defaultBillingTablePreference.columnWidths}
        columnOrder={[...BILLING_COLUMN_IDS]}
        columnVisibility={allVisibleBillingColumns}
        sortBy="expectedDate"
        sortOrder="asc"
      />,
    );

    expect(screen.getByRole('textbox', { name: 'Filter Expected date' })).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Filter Timing' })).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Filter Company' })).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Filter Family' })).toBeVisible();
    expect(screen.getByRole('searchbox', { name: 'Filter Service' })).toBeVisible();
    expect(screen.getByRole('searchbox', { name: 'Filter Fee line' })).toBeVisible();
    expect(screen.getByRole('searchbox', { name: 'Filter Period' })).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Filter Status' })).toBeVisible();
    expect(screen.getByRole('spinbutton', { name: 'Filter Minimum amount' })).toBeVisible();
    expect(screen.getByRole('spinbutton', { name: 'Filter Maximum amount' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Filter Billed date' })).toBeVisible();
    expect(screen.getByRole('searchbox', { name: 'Filter Reference' })).toBeVisible();
  });

  it('matches the Deadlines inline filter spacing and placeholder treatment', () => {
    render(
      <BillingTable
        items={[occurrence]}
        families={[{ id: 'family-1', name: 'Payroll', displayColor: '#715DA8' }]}
        columnWidths={defaultBillingTablePreference.columnWidths}
        columnOrder={[...BILLING_COLUMN_IDS]}
        columnVisibility={allVisibleBillingColumns}
        sortBy="expectedDate"
        sortOrder="asc"
      />,
    );

    const table = screen.getByRole('table', { name: 'Billing occurrences table' });
    const filterRow = table.querySelector('[data-filter-row]');
    const headerRow = table.querySelectorAll('thead tr')[1];
    const serviceInput = screen.getByRole('searchbox', { name: 'Filter Service' });
    const expectedDateInput = screen.getByRole('textbox', { name: 'Filter Expected date' });
    const minimumAmountInput = screen.getByRole('spinbutton', { name: 'Filter Minimum amount' });
    const timingSelect = screen.getByRole('combobox', { name: 'Filter Timing' });

    expect(filterRow).toHaveClass('h-14', 'bg-background-secondary/50');
    expect(table.querySelector('thead')).toHaveClass('bg-background-tertiary', 'border-b', 'border-border-primary');
    expect(headerRow).toHaveClass('h-[38px]', 'border-t', 'border-border-primary');
    expect(serviceInput).toHaveClass(
      'h-9',
      'min-h-9',
      'w-full',
      'min-w-0',
      'rounded-lg',
      'border-border-primary',
      'bg-background-secondary/30',
      'px-3',
      'text-xs',
      'font-normal',
      'text-text-primary',
      'placeholder:text-text-muted',
      'placeholder:font-normal',
    );
    expect(serviceInput).not.toHaveClass('placeholder:text-text-secondary');
    expect(serviceInput.closest('th')).toHaveClass('px-2', 'py-2');
    expect(expectedDateInput.closest('th')).toHaveClass('px-2', 'py-2');
    expect(minimumAmountInput.closest('th')).toHaveClass('px-2', 'py-2');
    expect(timingSelect).toHaveAttribute('placeholder', 'All');
  });

  it('vertically centres every desktop data cell', () => {
    render(
      <BillingTable
        items={[occurrence]}
        columnWidths={defaultBillingTablePreference.columnWidths}
        columnOrder={[...BILLING_COLUMN_IDS]}
        columnVisibility={allVisibleBillingColumns}
        sortBy="expectedDate"
        sortOrder="asc"
      />,
    );

    const cells = screen.getByRole('table', { name: 'Billing occurrences table' }).querySelectorAll('tbody td');
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) expect(cell).toHaveClass('align-middle');
  });

  it('keeps the table columns visible when no billing occurrences are found', () => {
    render(
      <BillingTable
        items={[]}
        columnWidths={defaultBillingTablePreference.columnWidths}
        columnOrder={[...BILLING_COLUMN_IDS]}
        columnVisibility={allVisibleBillingColumns}
        sortBy="expectedDate"
        sortOrder="asc"
      />,
    );

    const table = screen.getByRole('table', { name: 'Billing occurrences table' });
    expect(within(table).getByRole('columnheader', { name: /^Company$/ })).toBeVisible();
    const emptyMessage = within(table).getByText('No billing occurrences found');
    expect(emptyMessage.closest('tbody')).not.toBeNull();
    expect(Number(emptyMessage.closest('td')?.getAttribute('colspan'))).toBeGreaterThan(1);
    expect(screen.queryByText('No billing occurrences match these filters.')).not.toBeInTheDocument();
  });

  it('centres row selection controls on the checkbox column header', () => {
    render(
      <BillingTable
        items={[occurrence]}
        canEdit
        selectedIds={new Set()}
        isAllSelected={false}
        isIndeterminate={false}
        onToggleOne={() => undefined}
        onToggleAll={() => undefined}
        columnWidths={defaultBillingTablePreference.columnWidths}
        columnOrder={[...BILLING_COLUMN_IDS]}
        columnVisibility={allVisibleBillingColumns}
        sortBy="expectedDate"
        sortOrder="asc"
      />,
    );

    const table = screen.getByRole('table', { name: 'Billing occurrences table' });
    const selectAll = within(table).getByRole('button', { name: 'Select all billing occurrences' });
    const selectRow = within(table).getByRole('button', { name: 'Select billing occurrence for Northstar Holdings' });
    expect(selectAll.closest('th')).toHaveClass('text-center');
    expect(selectRow.closest('td')).toHaveClass('text-center');
  });

  it('opens the edit callback when a data row is clicked', () => {
    const onEdit = vi.fn();
    render(
      <BillingTable
        items={[occurrence]}
        columnWidths={defaultBillingTablePreference.columnWidths}
        columnOrder={[...BILLING_COLUMN_IDS]}
        columnVisibility={allVisibleBillingColumns}
        sortBy="expectedDate"
        sortOrder="asc"
        onEdit={onEdit}
      />,
    );

    const row = screen.getByRole('table', { name: 'Billing occurrences table' }).querySelector('tbody tr');
    if (!row) throw new Error('Billing row missing');
    fireEvent.click(row);

    expect(onEdit).toHaveBeenCalledWith(occurrence);
  });

  it('uses the Document Vault selection pattern for selectable open rows', () => {
    const onToggleOne = vi.fn();
    const onToggleAll = vi.fn();
    render(
      <BillingTable
        items={[occurrence]}
        canEdit
        selectedIds={new Set()}
        isAllSelected={false}
        isIndeterminate={false}
        onToggleOne={onToggleOne}
        onToggleAll={onToggleAll}
        columnWidths={defaultBillingTablePreference.columnWidths}
        columnOrder={[...BILLING_COLUMN_IDS]}
        columnVisibility={allVisibleBillingColumns}
        sortBy="expectedDate"
        sortOrder="asc"
      />,
    );

    const table = screen.getByRole('table', { name: 'Billing occurrences table' });
    fireEvent.click(within(table).getByRole('button', { name: 'Select all billing occurrences' }));
    fireEvent.click(within(table).getByRole('button', { name: 'Select billing occurrence for Northstar Holdings' }));

    expect(onToggleAll).toHaveBeenCalledTimes(1);
    expect(onToggleOne).toHaveBeenCalledWith('occurrence-1');
  });

  it('exposes aria-sort on sortable owning headers', () => {
    render(
      <BillingTable
        items={[occurrence]}
        columnWidths={defaultBillingTablePreference.columnWidths}
        columnOrder={[...BILLING_COLUMN_IDS]}
        columnVisibility={allVisibleBillingColumns}
        sortBy="expectedDate"
        sortOrder="asc"
        onSort={() => undefined}
        onColumnWidthChange={() => undefined}
        onColumnResizeEnd={() => undefined}
      />,
    );

    expect(screen.getByRole('columnheader', { name: /Expected date/ })).toHaveAttribute('aria-sort', 'ascending');
    expect(screen.getByRole('columnheader', { name: /Company/ })).toHaveAttribute('aria-sort', 'none');
  });

  it('uses Vault-style separator handles for pointer and keyboard column resizing', () => {
    const onLiveResize = vi.fn();
    const onResizeEnd = vi.fn();
    render(
      <BillingTable
        items={[occurrence]}
        columnWidths={defaultBillingTablePreference.columnWidths}
        columnOrder={[...BILLING_COLUMN_IDS]}
        columnVisibility={allVisibleBillingColumns}
        sortBy="expectedDate"
        sortOrder="asc"
        onColumnWidthChange={onLiveResize}
        onColumnResizeEnd={onResizeEnd}
      />,
    );

    const table = screen.getByRole('table', { name: 'Billing occurrences table' });
    expect(table).toHaveClass('w-full', 'min-w-max');
    expect(table).not.toHaveClass('table-fixed');
    expect(table.style.width).toBe('');
    expect(table.style.minWidth).toBe('');
    expect((table.querySelectorAll('colgroup col').item(11) as HTMLElement).style.width).toBe('');
    expect(screen.queryByRole('separator', { name: 'Resize Actions column' })).not.toBeInTheDocument();
    const resize = screen.getByRole('separator', { name: 'Resize Company column' });
    expect(resize).toHaveAttribute('aria-orientation', 'vertical');
    expect(resize).toHaveAttribute('tabindex', '0');

    fireEvent.pointerDown(resize, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 140 });
    fireEvent.pointerUp(window, { clientX: 140 });
    expect(onLiveResize).toHaveBeenLastCalledWith('company', 343);
    expect(onResizeEnd).toHaveBeenLastCalledWith('company', 343);

    fireEvent.keyDown(resize, { key: 'ArrowLeft' });
    expect(onLiveResize).toHaveBeenLastCalledWith('company', 293);
    expect(onResizeEnd).toHaveBeenLastCalledWith('company', 293);
  });

  it('keeps the desktop edit action compact while preserving the mobile touch target', () => {
    render(
      <BillingTable
        items={[occurrence]}
        columnWidths={defaultBillingTablePreference.columnWidths}
        columnOrder={[...BILLING_COLUMN_IDS]}
        columnVisibility={allVisibleBillingColumns}
        sortBy="expectedDate"
        sortOrder="asc"
      />,
    );

    expect(within(screen.getByRole('table', { name: 'Billing occurrences table' })).getByRole('button', { name: 'Edit tracking for Northstar Holdings' }))
      .toHaveClass('min-h-11', 'min-w-11', 'sm:min-h-8', 'sm:min-w-8');
  });
});
