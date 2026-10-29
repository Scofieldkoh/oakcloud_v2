import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { ServiceRosterTable, type ServiceRosterColumnId } from '@/components/services/roster/service-roster-table';
import type { ServiceRosterItem } from '@/services/service-roster';
import '@/app/globals.css';

const item = {
  id: 'service-1',
  companyId: 'company-1',
  company: { id: 'company-1', name: 'Oakcloud', displayAlias: null, displayLabel: 'Oakcloud', uen: null },
  family: { id: 'family-1', name: 'Accounting', displayColor: '#294d44' },
  serviceName: 'Monthly accounting',
  status: 'ACTIVE',
  cadence: 'MONTHLY',
  customCadenceLabel: null,
  startDate: '2026-01-01',
  endDate: null,
  hasRuleWarning: false,
  warning: { reasons: [] },
  nextDeadline: null,
  billingDisposition: null,
  billingCoverageIssue: null,
  nextBilling: null,
} as unknown as ServiceRosterItem;

const columns = ['company', 'actions'] as ServiceRosterColumnId[];
const columnVisibility = Object.fromEntries(
  ['company', 'family', 'service', 'status', 'cadence', 'nextDeadline', 'startEnd', 'warnings', 'billing', 'actions']
    .map((column) => [column, column === 'company' || column === 'actions']),
) as Record<ServiceRosterColumnId, boolean>;

function visibleCheckbox(input: HTMLInputElement): HTMLElement {
  const visualBox = input.nextElementSibling;
  if (!(visualBox instanceof HTMLElement)) throw new Error('Checkbox visual box missing');
  return visualBox;
}

describe('Services roster table browser surface', () => {
  afterEach(() => cleanup());

  it('aligns the row checkbox with the select-all checkbox column', async () => {
    await page.viewport(1024, 768);
    render(
      <ServiceRosterTable
        items={[item]}
        canEdit={false}
        canSelect
        selectedIds={new Set()}
        selectionState="none"
        onToggleSelectAll={() => undefined}
        onToggleSelect={() => undefined}
        sortBy="company"
        sortOrder="asc"
        onSort={() => undefined}
        inlineFilters={{}}
        onInlineFilterChange={() => undefined}
        columnWidths={{ company: 220, actions: 100 }}
        columnOrder={columns}
        columnVisibility={columnVisibility}
        onColumnWidthChange={() => undefined}
        onColumnResizeEnd={() => undefined}
        onEdit={() => undefined}
        onOpen={() => undefined}
      />,
    );

    const table = screen.getByRole('table', { name: 'Services roster table' });
    const headerInput = table.querySelector('thead input[aria-label="Select all services"]');
    const rowInput = table.querySelector('tbody input[aria-label^="Select Monthly accounting"]');
    if (!(headerInput instanceof HTMLInputElement) || !(rowInput instanceof HTMLInputElement)) {
      throw new Error('Roster selection checkboxes missing');
    }

    const headerBox = visibleCheckbox(headerInput).getBoundingClientRect();
    const rowBox = visibleCheckbox(rowInput).getBoundingClientRect();
    const headerCell = headerInput.closest('th');
    const rowCell = rowInput.closest('td');
    if (!(headerCell instanceof HTMLTableCellElement) || !(rowCell instanceof HTMLTableCellElement)) {
      throw new Error('Roster selection cells missing');
    }

    const centerX = (rect: DOMRect) => rect.left + rect.width / 2;
    expect(Math.abs(headerBox.left - rowBox.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(centerX(headerBox) - centerX(headerCell.getBoundingClientRect()))).toBeLessThanOrEqual(1);
    expect(Math.abs(centerX(rowBox) - centerX(rowCell.getBoundingClientRect()))).toBeLessThanOrEqual(1);
  });

  it('renders the empty state inside the desktop table body', async () => {
    await page.viewport(1024, 768);
    render(
      <ServiceRosterTable
        items={[]}
        canEdit={false}
        canSelect
        selectedIds={new Set()}
        selectionState="none"
        onToggleSelectAll={() => undefined}
        onToggleSelect={() => undefined}
        sortBy="company"
        sortOrder="asc"
        onSort={() => undefined}
        inlineFilters={{}}
        onInlineFilterChange={() => undefined}
        columnWidths={{ company: 220, actions: 100 }}
        columnOrder={columns}
        columnVisibility={columnVisibility}
        onColumnWidthChange={() => undefined}
        onColumnResizeEnd={() => undefined}
        onEdit={() => undefined}
        onOpen={() => undefined}
      />,
    );

    const table = screen.getByRole('table', { name: 'Services roster table' });
    const emptyMessage = within(table).getByText('No services found');
    const scrollContainer = table.parentElement;
    if (!scrollContainer) throw new Error('Roster table scroll container missing');
    expect(emptyMessage.closest('tbody')).not.toBeNull();
    expect(getComputedStyle(emptyMessage.closest('td')!).textAlign).toBe('center');
    expect(getComputedStyle(table).tableLayout).toBe('auto');
    const companyHeader = within(table).getByRole('columnheader', { name: 'Company' });
    const actionsHeader = within(table).getByRole('columnheader', { name: 'Actions' });
    expect(Math.abs(companyHeader.getBoundingClientRect().width - 220)).toBeLessThanOrEqual(1);
    expect(actionsHeader.getBoundingClientRect().width).toBeGreaterThan(500);
    expect(Math.abs(table.getBoundingClientRect().width - scrollContainer.getBoundingClientRect().width))
      .toBeLessThanOrEqual(1);
  });
});
