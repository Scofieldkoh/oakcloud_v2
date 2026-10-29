import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TableTextFilter } from '@/components/ui/data-table';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { CompanySelect } from '@/components/ui/company-select';
import { DatePicker } from '@/components/ui/date-picker';
import { SingleDateInput } from '@/components/ui/single-date-input';
import { AmountFilter } from '@/components/ui/amount-filter';
import { CountFilter } from '@/components/ui/count-filter';

vi.mock('@/hooks/use-company-search', () => ({
  useCompanySearch: () => ({
    searchQuery: '',
    setSearchQuery: vi.fn(),
    options: [],
    isLoading: false,
    page: 0,
    setPage: vi.fn(),
    hasMore: false,
    hasPreviousPage: false,
  }),
}));

function expectCanonicalSurface(element: HTMLElement | null) {
  expect(element).not.toBeNull();
  expect(element).toHaveClass(
    'h-9',
    'min-h-9',
    'w-full',
    'min-w-0',
    'rounded-lg',
    'border-border-primary',
    'bg-background-secondary/30',
  );
}

describe('table filter widget visual contract', () => {
  it('standardizes native text filters', () => {
    render(
      <TableTextFilter
        ariaLabel="Filter name"
        value={undefined}
        onChange={() => undefined}
      />,
    );

    const input = screen.getByRole('searchbox', { name: 'Filter name' });
    expectCanonicalSurface(input);
    expect(input).toHaveClass(
      'px-3',
      'text-xs',
      'font-normal',
      'text-text-primary',
      'placeholder:text-text-muted',
      'placeholder:font-normal',
    );
  });

  it('standardizes searchable select filters', () => {
    render(
      <SearchableSelect
        variant="table-filter"
        options={[{ value: '', label: 'All' }]}
        value=""
        onChange={() => undefined}
        placeholder="All"
        ariaLabel="Filter status"
      />,
    );

    const input = screen.getByRole('combobox', { name: 'Filter status' });
    expectCanonicalSurface(input.parentElement);
    expect(input).toHaveValue('All');
    expect(input).toHaveClass(
      'px-3',
      'text-xs',
      'font-normal',
      'text-text-muted',
      'placeholder:text-text-muted',
      'placeholder:font-normal',
    );
    expect(input).not.toHaveClass('text-text-primary');
  });

  it('standardizes company search filters', () => {
    render(
      <CompanySelect
        variant="table-filter"
        value=""
        onChange={() => undefined}
        placeholder="All companies"
      />,
    );

    const input = screen.getByRole('combobox', { name: 'All companies' });
    expectCanonicalSurface(input.parentElement);
    expect(input).toHaveClass(
      'px-3',
      'text-xs',
      'font-normal',
      'text-text-primary',
      'placeholder:text-text-muted',
      'placeholder:font-normal',
    );
  });

  it('standardizes date picker filters', () => {
    render(
      <DatePicker
        variant="table-filter"
        value={undefined}
        onChange={() => undefined}
        placeholder="All dates"
      />,
    );

    const placeholder = screen.getByText('All dates');
    expectCanonicalSurface(placeholder.parentElement);
    expect(placeholder).toHaveClass('text-xs', 'font-normal', 'text-text-muted');
  });

  it('standardizes single date input filters', () => {
    render(
      <SingleDateInput
        variant="table-filter"
        value=""
        onChange={() => undefined}
        ariaLabel="Filter billed date"
        placeholder="All dates"
      />,
    );

    const input = screen.getByRole('textbox', { name: 'Filter billed date' });
    expectCanonicalSurface(input.parentElement);
    expect(input).toHaveClass(
      'px-3',
      'text-xs',
      'font-normal',
      'text-text-primary',
      'placeholder:text-text-muted',
      'placeholder:font-normal',
    );
  });

  it('standardizes amount filter triggers', () => {
    render(
      <AmountFilter
        variant="table-filter"
        value={undefined}
        onChange={() => undefined}
        placeholder="All amounts"
      />,
    );

    const trigger = screen.getByRole('button', { name: /All amounts/i });
    expectCanonicalSurface(trigger);
    const placeholder = screen.getByText('All amounts');
    expect(placeholder).toHaveClass('text-xs', 'font-normal', 'text-text-muted');
  });

  it('standardizes count filter triggers', () => {
    render(
      <CountFilter
        variant="table-filter"
        value={{}}
        onChange={() => undefined}
        placeholder="All"
      />,
    );

    const trigger = screen.getByRole('button', { name: /All/i });
    expectCanonicalSurface(trigger);
    const placeholder = screen.getByText('All');
    expect(placeholder).toHaveClass('text-xs', 'font-normal', 'text-text-muted');
  });
});
