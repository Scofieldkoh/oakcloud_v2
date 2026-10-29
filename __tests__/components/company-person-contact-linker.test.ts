import { describe, expect, it } from 'vitest';
import type { Contact } from '@/generated/prisma';
import {
  applyContactToCompanyPerson,
  companyPersonToContactPayload,
  companyPersonToContactUpdate,
} from '@/components/companies/company-edit/company-person-contact-linker';

function contact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: 'c4dcc3fc-79e6-4c1d-925b-8cb6f6b7c2da',
    tenantId: '9e8078d5-e5ad-4a1c-8839-dccfb753ad84',
    contactType: 'INDIVIDUAL',
    firstName: 'Sample',
    lastName: 'Person',
    fullName: 'Sample Person',
    canonicalName: 'sample person',
    alias: null,
    canonicalAlias: null,
    identificationType: 'OTHER',
    identificationNumber: 'SYNTHETIC-ID',
    nationality: 'Example',
    dateOfBirth: null,
    corporateName: null,
    corporateUen: null,
    fullAddress: 'Synthetic address',
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  };
}

describe('company person contact mapping', () => {
  it('populates and links an officer without overwriting officer-specific fields', () => {
    const result = applyContactToCompanyPerson(
      { name: '', role: 'SECRETARY', appointmentDate: '2026-08-01', isCurrent: true },
      contact(),
      'officer',
    );
    expect(result).toMatchObject({
      contactId: 'c4dcc3fc-79e6-4c1d-925b-8cb6f6b7c2da',
      name: 'Sample Person', role: 'SECRETARY', appointmentDate: '2026-08-01',
      identificationType: 'OTHER', identificationNumber: 'SYNTHETIC-ID',
      nationality: 'Example', address: 'Synthetic address',
    });
  });

  it('maps a corporate Contact into shareholder identity fields', () => {
    const result = applyContactToCompanyPerson(
      { shareholderType: 'INDIVIDUAL', shareClass: 'ORDINARY', numberOfShares: 10 },
      contact({
        contactType: 'CORPORATE', firstName: null, lastName: null,
        fullName: 'Sample Holdings', corporateName: 'Sample Holdings', corporateUen: 'SYNTHETIC-UEN',
        identificationType: null, identificationNumber: null, nationality: null,
      }),
      'shareholder',
    );
    expect(result).toMatchObject({
      contactId: 'c4dcc3fc-79e6-4c1d-925b-8cb6f6b7c2da',
      name: 'Sample Holdings', shareholderType: 'CORPORATE', identificationType: 'UEN',
      identificationNumber: 'SYNTHETIC-UEN', shareClass: 'ORDINARY', numberOfShares: 10,
    });
  });

  it('creates lossless contact payloads from manually keyed profile data', () => {
    expect(companyPersonToContactPayload({
      name: 'Sample Person', identificationType: 'OTHER', identificationNumber: 'SYNTHETIC-ID',
      nationality: 'Example', address: 'Synthetic address',
    }, 'officer')).toMatchObject({
      contactType: 'INDIVIDUAL', firstName: 'Sample Person', lastName: null,
      identificationType: 'OTHER', identificationNumber: 'SYNTHETIC-ID',
      nationality: 'Example', fullAddress: 'Synthetic address',
    });
  });

  it('creates and updates corporate shareholder payloads using the UEN field', () => {
    const record = {
      name: 'Sample Holdings', shareholderType: 'CORPORATE', identificationType: 'UEN',
      identificationNumber: 'SYNTHETIC-UEN', address: 'Synthetic address',
    };
    expect(companyPersonToContactPayload(record, 'shareholder')).toMatchObject({
      contactType: 'CORPORATE', corporateName: 'Sample Holdings', corporateUen: 'SYNTHETIC-UEN',
    });
    expect(companyPersonToContactUpdate(record, 'shareholder')).toMatchObject({
      contactType: 'CORPORATE', corporateName: 'Sample Holdings', corporateUen: 'SYNTHETIC-UEN',
    });
  });

  it('drops unsupported profile identification values instead of sending an invalid Contact payload', () => {
    expect(companyPersonToContactPayload({
      name: 'Sample Person', identificationType: 'FOREIGN_ID', identificationNumber: 'SYNTHETIC-ID',
    }, 'officer')).toMatchObject({ identificationType: null, identificationNumber: 'SYNTHETIC-ID' });
  });
});
