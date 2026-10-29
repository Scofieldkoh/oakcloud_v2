import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CompanyEditWorkspace } from '@/components/companies/company-edit/company-edit-workspace';
import type { CompanyProfileSectionDto } from '@/services/company/profile-sections';
import { CompanyProfileSectionError, companyProfileSectionKey } from '@/hooks/use-company-profile-sections';

const sections = {
  identity: { uen: '202400001A', name: 'Example Pte. Ltd.', entityType: 'PRIVATE_LIMITED', status: 'LIVE', statusDate: null, incorporationDate: null },
  addresses: { registered: { block: null, streetName: 'Old Street', level: null, unit: null, buildingName: null, postalCode: '123456', country: 'Singapore', effectiveFrom: null }, mailing: null },
  activities: { primary: null, secondary: null },
  officers: { officers: [] },
  shareholders: { shareholders: [] },
  compliance: { financialYearEndDay: 31, financialYearEndMonth: 12, fyeAsAtLastAr: null, homeCurrency: 'SGD', lastAgmDate: null, lastArFiledDate: null, accountsDueDate: null },
  capital: { paidUpCapitalCurrency: 'SGD', paidUpCapitalAmount: 0, issuedCapitalCurrency: 'SGD', issuedCapitalAmount: 0, shareCapital: [] },
  charges: { charges: [] },
  additional: { formerName: null, dateOfNameChange: null, registrationDate: null, formerNames: [], auditor: null },
} as const;

const initialSections = Object.fromEntries(Object.entries(sections).map(([section, data]) => [section, {
  section, version: 'a'.repeat(64), data,
}])) as Record<string, CompanyProfileSectionDto>;

function view(onSave = vi.fn().mockImplementation(async (section, data) => ({ section, version: 'b'.repeat(64), data }))) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return { client, onSave, ...render(<QueryClientProvider client={client}><CompanyEditWorkspace companyId="company-1" initialSections={initialSections} onSave={onSave} /></QueryClientProvider>) };
}

describe('CompanyEditWorkspace', () => {
  it('renders enum-backed profile fields as searchable dropdowns', () => {
    view();
    expect(screen.getByRole('combobox', { name: 'Entity type' })).toHaveValue('Private Limited');
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveValue('Live');
  });

  it('saves only the changed section while other section drafts remain independent', async () => {
    const { onSave } = view();
    fireEvent.change(screen.getByLabelText('Registered street name'), { target: { value: 'New Street' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Addresses' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('addresses', expect.objectContaining({ registered: expect.objectContaining({ streetName: 'New Street' }) }), 'a'.repeat(64)));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('retains local input and offers an explicit reload when the section conflicts', async () => {
    const conflict = Object.assign(new Error('This section changed after you opened it'), {
      latest: { section: 'addresses', version: 'c'.repeat(64), data: sections.addresses },
    });
    const { onSave } = view(vi.fn().mockRejectedValue(conflict));
    const input = screen.getByLabelText('Registered street name');
    fireEvent.change(input, { target: { value: 'My unsaved street' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Addresses' }));
    expect(await screen.findByRole('button', { name: 'Reload latest section' })).toBeInTheDocument();
    expect(input).toHaveValue('My unsaved street');
    expect(onSave).toHaveBeenCalledOnce();
  });

  it('keeps a dirty section draft when refreshed query data arrives', async () => {
    const { client } = view();
    const input = screen.getByLabelText('Registered street name');
    fireEvent.change(input, { target: { value: 'My unsaved street' } });

    client.setQueryData(companyProfileSectionKey('company-1', 'addresses'), {
      section: 'addresses',
      version: 'c'.repeat(64),
      data: {
        ...sections.addresses,
        registered: { ...sections.addresses.registered, streetName: 'Server refresh' },
      },
    });

    await waitFor(() => expect(input).toHaveValue('My unsaved street'));
  });
  it('sends a blank year end typed in as numbers', async () => {
    const blank = {
      ...initialSections,
      compliance: { ...initialSections.compliance, data: { ...sections.compliance, financialYearEndDay: null, financialYearEndMonth: null } },
    } as Record<string, CompanyProfileSectionDto>;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const onSave = vi.fn().mockImplementation(async (section, data) => ({ section, version: 'b'.repeat(64), data }));
    render(<QueryClientProvider client={client}><CompanyEditWorkspace companyId="company-1" initialSections={blank} onSave={onSave} /></QueryClientProvider>);
    const day = screen.getByLabelText('Financial year end day');
    expect(day).toHaveAttribute('type', 'number');
    fireEvent.change(day, { target: { value: '31' } });
    fireEvent.change(screen.getByLabelText('Financial year end month'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Compliance' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(
      'compliance',
      expect.objectContaining({ financialYearEndDay: 31, financialYearEndMonth: 12 }),
      'a'.repeat(64),
    ));
  });

  it('names the fields a save was refused for', async () => {
    view(vi.fn().mockRejectedValue(new CompanyProfileSectionError('Please correct the highlighted fields', [
      { path: 'financialYearEndDay', message: 'Expected number, received string' },
    ])));
    fireEvent.change(screen.getByLabelText('Home currency'), { target: { value: 'USD' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Compliance' }));
    expect(await screen.findByText(
      'Please correct these fields: Financial year end day (Expected number, received string)',
    )).toBeInTheDocument();
  });
});
