import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ListEmptyState } from '@/components/ui/empty-state';

describe('ListEmptyState', () => {
  it('offers Clear filters when a search or filter narrows the list', () => {
    const onClearFilters = vi.fn();
    render(
      <ListEmptyState
        noun="companies"
        filtered
        onClearFilters={onClearFilters}
        createAction={<button type="button">Add Company</button>}
        emptyDescription="Add a company to get started."
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('No matching companies');
    expect(screen.getByText('No companies match your current search and filters.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add Company' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  it('offers the create action when nothing exists yet', () => {
    render(
      <ListEmptyState
        noun="companies"
        filtered={false}
        onClearFilters={vi.fn()}
        createAction={<button type="button">Add Company</button>}
        emptyDescription="Add a company to get started."
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('No companies yet');
    expect(screen.getByText('Add a company to get started.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Company' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
  });
});
