import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ContactTable } from '@/components/contacts/contact-table';
import { CompanyTable } from '@/components/companies/company-table';

const navigation = vi.hoisted(() => ({ push: vi.fn(), prefetch: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => navigation,
}));

function detailHrefs(container: HTMLElement, detailPath: string): string[] {
  return Array.from(container.querySelectorAll<HTMLAnchorElement>('a'))
    .map((link) => link.getAttribute('href'))
    .filter((href): href is string => (
      href !== null && (href === detailPath || href.startsWith(`${detailPath}?`))
    ));
}

describe('list table detail navigation', () => {
  it('carries complete Contacts list state through every detail link', () => {
    const { container } = render(
      <ContactTable
        contacts={[{
          id: 'contact-1',
          fullName: 'Jane Tan',
          alias: null,
          contactType: 'INDIVIDUAL',
          identificationType: 'NRIC',
          identificationNumber: 'S1234567A',
          corporateUen: null,
          nationality: 'Singaporean',
          defaultEmail: null,
          defaultPhone: null,
          _count: { companyRelations: 0 },
        } as never]}
        returnTo="/contacts?page=3&limit=50&q=Jane&sortOrder=desc"
      />,
    );

    const hrefs = detailHrefs(container, '/contacts/contact-1');
    expect(hrefs.length).toBeGreaterThan(0);
    expect(hrefs).toEqual([
      '/contacts/contact-1?returnTo=%2Fcontacts%3Fpage%3D3%26limit%3D50%26q%3DJane%26sortOrder%3Ddesc',
      '/contacts/contact-1?returnTo=%2Fcontacts%3Fpage%3D3%26limit%3D50%26q%3DJane%26sortOrder%3Ddesc',
      '/contacts/contact-1?returnTo=%2Fcontacts%3Fpage%3D3%26limit%3D50%26q%3DJane%26sortOrder%3Ddesc',
    ]);
  });

  it('carries complete Companies list state through every detail link', () => {
    const { container } = render(
      <CompanyTable
        companies={[{
          id: 'company-1',
          name: 'Example Pte. Ltd.',
          uen: '202400001A',
          entityType: 'PRIVATE_LIMITED',
          status: 'LIVE',
          addresses: [],
          homeCurrency: 'SGD',
          incorporationDate: null,
          financialYearEndDay: 31,
          financialYearEndMonth: 12,
          hasPoc: true,
          issuedCapitalAmount: null,
          issuedCapitalCurrency: null,
          paidUpCapitalAmount: null,
          paidUpCapitalCurrency: null,
          _count: { officers: 0, shareholders: 0, charges: 0 },
        } as never]}
        returnTo="/companies?page=4&limit=50&status=LIVE&sortOrder=desc"
      />,
    );

    const hrefs = detailHrefs(container, '/companies/company-1');
    expect(hrefs.length).toBeGreaterThan(0);
    expect(hrefs).toEqual([
      '/companies/company-1?returnTo=%2Fcompanies%3Fpage%3D4%26limit%3D50%26status%3DLIVE%26sortOrder%3Ddesc',
      '/companies/company-1?returnTo=%2Fcompanies%3Fpage%3D4%26limit%3D50%26status%3DLIVE%26sortOrder%3Ddesc',
      '/companies/company-1?returnTo=%2Fcompanies%3Fpage%3D4%26limit%3D50%26status%3DLIVE%26sortOrder%3Ddesc',
    ]);
  });

  it('navigates to a company detail page when a non-interactive row area is clicked', () => {
    const { container } = render(
      <CompanyTable
        companies={[{
          id: 'company-1',
          name: 'Example Pte. Ltd.',
          uen: '202400001A',
          entityType: 'PRIVATE_LIMITED',
          status: 'LIVE',
          addresses: [],
          homeCurrency: 'SGD',
          incorporationDate: null,
          financialYearEndDay: 31,
          financialYearEndMonth: 12,
          hasPoc: true,
          issuedCapitalAmount: null,
          issuedCapitalCurrency: null,
          paidUpCapitalAmount: null,
          paidUpCapitalCurrency: null,
          _count: { officers: 0, shareholders: 0, charges: 0 },
        } as never]}
        returnTo="/companies?page=4&limit=50"
      />,
    );

    fireEvent.click(container.querySelector('tbody tr')!);

    expect(navigation.push).toHaveBeenCalledWith(
      '/companies/company-1?returnTo=%2Fcompanies%3Fpage%3D4%26limit%3D50',
    );
  });

  it('navigates to a contact detail page when a non-interactive row area is clicked', () => {
    const { container } = render(
      <ContactTable
        contacts={[{
          id: 'contact-1',
          fullName: 'Jane Tan',
          alias: null,
          contactType: 'INDIVIDUAL',
          identificationType: 'NRIC',
          identificationNumber: 'S1234567A',
          corporateUen: null,
          nationality: 'Singaporean',
          defaultEmail: null,
          defaultPhone: null,
          _count: { companyRelations: 0 },
        } as never]}
        returnTo="/contacts?page=3&limit=50"
      />,
    );

    fireEvent.click(container.querySelector('tbody tr')!);

    expect(navigation.push).toHaveBeenCalledWith(
      '/contacts/contact-1?returnTo=%2Fcontacts%3Fpage%3D3%26limit%3D50',
    );
  });
});
