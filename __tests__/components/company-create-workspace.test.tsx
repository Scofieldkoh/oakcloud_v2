import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render as renderUi, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CompanyCreateWorkspace } from '@/components/companies/company-edit/company-create-workspace';

// Officer and shareholder rows link contacts through React Query.
function render(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return renderUi(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('CompanyCreateWorkspace', () => {
  it('prompts for an optional ALIAS during company creation', () => {
    render(<CompanyCreateWorkspace onSubmit={vi.fn()} />);

    expect(screen.getByLabelText('ALIAS')).toHaveAttribute('maxlength', '10');
    expect(screen.getByText('Short company alias; maximum 10 characters')).toBeInTheDocument();
  });

  it('renders enum-backed profile fields as searchable dropdowns', () => {
    render(<CompanyCreateWorkspace onSubmit={vi.fn()} />);

    expect(screen.getByRole('combobox', { name: 'Entity type' })).toHaveValue('Private Limited');
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveValue('Live');

    fireEvent.click(screen.getByRole('button', { name: 'Add officer' }));
    expect(screen.getByRole('combobox', { name: 'Role' })).toHaveValue('Director');
    expect(screen.getAllByRole('combobox', { name: 'Identification type' }).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Add shareholder' }));
    expect(screen.getByRole('combobox', { name: 'Shareholder type' })).toHaveValue('Individual');
  });

  it('renders boolean flags as pill switches instead of checkboxes', () => {
    render(<CompanyCreateWorkspace onSubmit={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add officer' }));
    expect(screen.getAllByRole('switch', { name: 'Is current' })).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Add shareholder' }));
    expect(screen.getAllByRole('switch', { name: 'Is current' })).toHaveLength(2);
    expect(screen.getByRole('switch', { name: 'Is nominee' })).not.toBeChecked();
    expect(screen.queryByRole('checkbox', { name: 'Is current' })).not.toBeInTheDocument();
  });

  it('mirrors every Edit Company profile section and submits the complete profile', () => {
    const onSubmit = vi.fn();

    render(<CompanyCreateWorkspace onSubmit={onSubmit} />);

    for (const heading of [
      'Identity',
      'Addresses',
      'Business activities',
      'Officers',
      'Shareholders',
      'Compliance',
      'Capital',
      'Charges',
      'Additional company information',
    ]) {
      expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
    }

    fireEvent.change(screen.getByLabelText('Uen'), { target: { value: '202400001A' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Example Pte. Ltd.' } });
    fireEvent.change(screen.getByLabelText('ALIAS'), { target: { value: 'OAK' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Add company' }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      identity: expect.objectContaining({
        uen: '202400001A',
        name: 'Example Pte. Ltd.',
        displayAlias: 'OAK',
      }),
      officers: { officers: [] },
      shareholders: { shareholders: [] },
      charges: { charges: [] },
    }));
  });
});
