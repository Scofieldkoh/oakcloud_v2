import { act, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  useCompanyOptionsPage: vi.fn(),
  asyncProps: undefined as Record<string, unknown> | undefined,
}));

vi.mock('@/hooks/use-all-company-options', () => ({ useCompanyOptionsPage: mocks.useCompanyOptionsPage }));
vi.mock('@/components/companies/company-detail/client-service-creator', () => ({ ClientServiceCreator: () => null }));
vi.mock('@/components/ui/async-search-select', () => ({
  AsyncSearchSelect: (props: Record<string, unknown>) => {
    mocks.asyncProps = props;
    return createElement('input', {
      role: 'combobox',
      'aria-label': props.label,
      value: props.searchQuery,
      onChange: (event: { target: { value: string } }) => (props.onSearchChange as (value: string) => void)(event.target.value),
    });
  },
}));

import { AddClientServiceDialog } from '@/components/services/roster/add-client-service-dialog';

describe('AddClientServiceDialog', () => {
  it('keeps company search and next-page loading server scoped', () => {
    mocks.useCompanyOptionsPage.mockReturnValue({
      data: {
        options: [{ id: 'company-21', name: 'Acme Twenty One', uen: 'UEN-21' }],
        hasMore: true,
        page: 0,
      },
      isLoading: false,
      error: null,
    });

    render(<AddClientServiceDialog isOpen onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Company' }), { target: { value: 'Acme' } });

    expect(mocks.useCompanyOptionsPage).toHaveBeenLastCalledWith(undefined, expect.objectContaining({
      query: 'Acme',
      page: 0,
      limit: 20,
    }));
    expect(mocks.asyncProps?.pagination).toEqual(expect.objectContaining({ page: 0, hasNextPage: true }));

    act(() => {
      (mocks.asyncProps?.pagination as { onNextPage: () => void }).onNextPage();
    });
    expect(mocks.useCompanyOptionsPage).toHaveBeenLastCalledWith(undefined, expect.objectContaining({
      query: 'Acme',
      page: 1,
    }));
  });
});
