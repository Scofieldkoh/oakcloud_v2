import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BillingFilters, type BillingFilterState } from '@/components/services/billing/billing-filters';

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

const filteredValue: BillingFilterState = {
  query: '',
  statuses: [],
  timing: [],
  from: '2026-08-01',
  to: '2026-08-31',
  familyIds: [],
};

describe('BillingFilters', () => {
  it('places one Date Range picker beside Families and removes split date inputs', () => {
    render(
      <BillingFilters
        value={filteredValue}
        families={[{ id: 'family-1', name: 'Accounting', displayColor: '#3F6DA8' }]}
        onChange={vi.fn()}
        dateRangeActive
      />,
    );

    const toolbar = screen.getByRole('group', { name: 'Billing quick filters' });
    expect(within(toolbar).getByRole('button', { name: 'Families' })).toBeVisible();
    expect(within(toolbar).getByRole('button', { name: 'Date Range' })).toBeVisible();
    expect(screen.queryByLabelText('Billing date from')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Billing date to')).not.toBeInTheDocument();
  });

  it('maps complete ranges, ignores incomplete ranges, and clears both date values', () => {
    const onChange = vi.fn();
    render(<BillingFilters value={filteredValue} families={[]} onChange={onChange} dateRangeActive />);

    fireEvent.click(screen.getByRole('button', { name: 'Apply complete date range' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ from: '2026-08-10', to: '2026-08-20' }));

    const callsAfterComplete = onChange.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Apply incomplete date range' }));
    expect(onChange).toHaveBeenCalledTimes(callsAfterComplete);

    fireEvent.click(screen.getByRole('button', { name: 'Clear date range' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ from: '', to: '' }));
  });

  it('shows a removable date filter badge and clears the selected range when removed', () => {
    const onChange = vi.fn();
    render(<BillingFilters value={filteredValue} families={[]} onChange={onChange} dateRangeActive />);

    expect(screen.getByText('Date:')).toBeVisible();
    const removeDate = screen.getByRole('button', { name: 'Remove Date filter' });
    expect(removeDate).toBeVisible();

    fireEvent.click(removeDate);

    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ from: '', to: '' }));
  });

  it('clears every filter at once from the active filter row', () => {
    const onChange = vi.fn();
    render(
      <BillingFilters
        value={{ ...filteredValue, query: 'acme', statuses: ['OPEN'], familyIds: ['family-1'] }}
        families={[{ id: 'family-1', name: 'Accounting', displayColor: '#3F6DA8' }]}
        onChange={onChange}
        dateRangeActive
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));

    expect(onChange).toHaveBeenLastCalledWith({ query: '', statuses: [], timing: [], from: '', to: '', familyIds: [] });
  });

  it('matches the Vault toolbar and keeps zero selected statuses unfiltered', () => {
    render(<BillingFilters value={{ ...filteredValue, from: '', to: '' }} families={[]} onChange={vi.fn()} dateRangeActive={false} />);

    const toolbar = screen.getByRole('group', { name: 'Billing quick filters' });
    expect(toolbar).toHaveClass('border', 'rounded-lg', 'p-4');
    expect(screen.getByRole('button', { name: 'Open' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByLabelText('Active filters')).not.toBeInTheDocument();
  });

  it('does not render a Reset filters action', () => {
    render(
      <BillingFilters
        value={{ ...filteredValue, statuses: ['OPEN'] }}
        families={[]}
        onChange={vi.fn()}
        dateRangeActive
      />,
    );

    expect(screen.queryByRole('button', { name: 'Reset filters' })).not.toBeInTheDocument();
  });
});
