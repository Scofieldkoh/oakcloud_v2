import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CompanyProfileSections } from '@/components/companies/company-detail/company-profile-sections';

const company = {
  id: 'company-1', tenantId: 'tenant-1', uen: '202400001A', name: 'Example Pte. Ltd.',
  entityType: 'PRIVATE_LIMITED', status: 'LIVE', homeCurrency: 'SGD',
  financialYearEndDay: 31, financialYearEndMonth: 12,
  paidUpCapitalCurrency: 'SGD', paidUpCapitalAmount: 100000,
  issuedCapitalCurrency: 'SGD', issuedCapitalAmount: 100000,
  primarySsicCode: '69202', primarySsicDescription: 'Book-keeping services',
  secondarySsicCode: '70201', secondarySsicDescription: 'Management consultancy',
  addresses: [
    { id: 'a1', addressType: 'REGISTERED_OFFICE', streetName: 'Anson Road', postalCode: '079903', country: 'Singapore', fullAddress: '10 Anson Road, Singapore 079903', isCurrent: true, effectiveFrom: new Date('2024-03-18') },
    { id: 'a2', addressType: 'MAILING', streetName: 'Raffles Place', postalCode: '048616', country: 'Singapore', fullAddress: '1 Raffles Place, Singapore 048616', isCurrent: true },
  ],
  officers: [
    { id: 'o1', name: 'Tan Mei Ling', role: 'DIRECTOR', appointmentDate: new Date('2024-03-18'), isCurrent: true },
    { id: 'o2', name: 'Past Director', role: 'DIRECTOR', cessationDate: new Date('2023-01-01'), isCurrent: false },
  ],
  shareholders: [
    { id: 's1', name: 'Tan Mei Ling', shareholderType: 'INDIVIDUAL', shareClass: 'ORDINARY', numberOfShares: 60000, percentageHeld: 60, currency: 'SGD', isCurrent: true, isNominee: true },
    { id: 's2', name: 'Former Owner', shareholderType: 'CORPORATE', shareClass: 'ORDINARY', numberOfShares: 1000, percentageHeld: 1, currency: 'SGD', isCurrent: false },
  ],
  shareCapital: [{ id: 'c1', shareClass: 'ORDINARY', currency: 'SGD', numberOfShares: 100000, totalValue: 100000, isPaidUp: true, isTreasury: false }],
  charges: [
    { id: 'ch1', chargeHolderName: 'Oak Bank', isFullyDischarged: false },
    { id: 'ch2', chargeHolderName: 'Old Bank', isFullyDischarged: true, dischargeDate: new Date('2020-01-01') },
  ],
  formerNames: [{ id: 'f1', formerName: 'Old Example Pte. Ltd.', effectiveFrom: new Date('2020-01-01') }],
  auditor: { name: 'Oak Audit LLP', address: '3 Audit Street', appointmentDate: new Date('2021-01-01') },
} as never;

describe('CompanyProfileSections', () => {
  it('renders the approved priority order and normalized current details', () => {
    render(<CompanyProfileSections company={company} companyId="company-1" />);
    const headings = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);
    expect(headings).toEqual([
      'Addresses', 'Business activities', 'Officers', 'Shareholders',
      'Additional company information', 'Compliance', 'Capital', 'Charges', 'Documents',
    ]);
    expect(screen.getByRole('link', { name: 'View All Documents' })).toHaveAttribute('href', '/processing?companyId=company-1');
    expect(screen.getByText(/10 Anson Road, Singapore 079903/)).toHaveTextContent('effective from: 18 March 2024');
    expect(screen.getByText('Tan Mei Ling (60% ownership)')).toBeInTheDocument();
    expect(screen.getByText('SGD 60,000.00 / 60,000 Ordinary Shares')).toBeInTheDocument();
    expect(screen.getByText('Individual')).toBeInTheDocument();
    expect(screen.getByText('Nominee')).toBeInTheDocument();
    expect(screen.getByText('Director')).toBeInTheDocument();
    expect(screen.queryByText('Past Director')).not.toBeInTheDocument();
    expect(screen.queryByText('Former Owner')).not.toBeInTheDocument();
    expect(screen.queryByText('Old Bank')).not.toBeInTheDocument();
  });

  it('reveals past records in their own segments', () => {
    render(<CompanyProfileSections company={company} companyId="company-1" />);
    fireEvent.click(screen.getByLabelText('Show ceased'));
    fireEvent.click(screen.getByLabelText('Show former'));
    fireEvent.click(screen.getByLabelText('Show discharged'));
    expect(screen.getByText('Past Director')).toBeInTheDocument();
    expect(screen.getByText('Former Owner (1% ownership)')).toBeInTheDocument();
    expect(screen.getByText('Old Bank')).toBeInTheDocument();
  });

  it('shows the share capital breakdown by default', () => {
    render(<CompanyProfileSections company={company} companyId="company-1" />);

    expect(screen.getByText('Show share capital breakdown').closest('details')).toHaveAttribute('open');
  });

  it('shows only the effective ALIAS', () => {
    const aliased = {
      ...(company as object),
      displayAlias: 'OAK',
    } as never;

    render(<CompanyProfileSections company={aliased} companyId="company-1" />);

    expect(screen.getByText('ALIAS')).toBeInTheDocument();
    expect(screen.queryByText('Service display alias')).not.toBeInTheDocument();
    expect(screen.queryByText('Service display label')).not.toBeInTheDocument();
    expect(screen.getAllByText('OAK')).toHaveLength(1);
  });

  it('falls back to meaningful company initials when no alias is stored', () => {
    const withoutAlias = {
      ...(company as object),
      name: 'Oaktree Accounting & Corporate Solution Pte. Ltd.',
      displayAlias: null,
    } as never;

    render(<CompanyProfileSections company={withoutAlias} companyId="company-1" />);

    expect(screen.getByText('ALIAS')).toBeInTheDocument();
    expect(screen.getByText('OACS')).toBeInTheDocument();
  });

  it('shows the ACRA badge when the stored dates match the ACRA record', () => {
    const withAcra = {
      ...(company as object),
      lastArFiledDate: new Date('2026-06-28'),
      accountsDueDate: new Date('2027-07-31'),
      acraRecord: {
        dataAsOf: '2026-08-14T14:07:42+08:00',
        accountDueDate: '2027-07-31',
        annualReturnDate: '2026-06-28',
      },
    } as never;

    render(<CompanyProfileSections company={withAcra} companyId="company-1" />);

    const badges = screen.getAllByText(/^ACRA /);
    expect(badges).toHaveLength(2);
    expect(badges[0]).toHaveTextContent('ACRA 14 August 2026');
  });

  it('hides the ACRA badge when the stored dates differ or the record has no date', () => {
    const mismatched = {
      ...(company as object),
      lastArFiledDate: new Date('2026-01-01'),
      accountsDueDate: new Date('2027-07-31'),
      acraRecord: {
        dataAsOf: '2026-08-14T14:07:42+08:00',
        accountDueDate: '2027-07-31',
        annualReturnDate: 'na',
      },
    } as never;

    render(<CompanyProfileSections company={mismatched} companyId="company-1" />);

    const badges = screen.getAllByText(/^ACRA /);
    expect(badges).toHaveLength(1);
    expect(badges[0]).toHaveTextContent('ACRA 14 August 2026');
  });

  it('derives the next AGM due date from Accounts due and omits the duplicate annual return field', () => {
    const withDueDates = {
      ...(company as object),
      accountsDueDate: new Date('2026-03-31'),
    } as never;

    render(<CompanyProfileSections company={withDueDates} companyId="company-1" />);

    expect(screen.getByText('Next AGM due date')).toBeInTheDocument();
    expect(screen.getByText('28 February 2026')).toBeInTheDocument();
    expect(screen.queryByText('Next Annual Return due date')).not.toBeInTheDocument();
    expect(screen.getByText('31 March 2026')).toBeInTheDocument();
  });

  it('shows the first financial year end under Compliance', () => {
    const { rerender } = render(<CompanyProfileSections company={company as never} companyId="company-1" />);
    expect(screen.getByText('First financial year end')).toBeInTheDocument();
    expect(screen.getByText('Incorporation date')).toBeInTheDocument();

    rerender(<CompanyProfileSections company={{
      ...(company as object),
      financialPeriods: [{ periodStart: new Date('2024-09-14'), periodEnd: new Date('2025-12-31'), yearsOfAssessment: [2026] }],
    } as never} companyId="company-1" />);
    expect(screen.getByText('31 December 2025')).toBeInTheDocument();
  });
});
