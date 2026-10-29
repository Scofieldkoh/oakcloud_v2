// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import {
  buildOakDocResolutionValues,
  OAKDOC_AGREEMENT_FIELD_TAGS,
} from '@/lib/document-editor/oakdoc-context';

describe('OakDoc Stage 4 generation context', () => {
  const company = {
    id: 'company-1',
    name: 'Example Pte. Ltd.',
    uen: '202600001A',
    contacts: [
      {
        id: 'contact-1',
        name: 'Alex Lim',
        detail: 'Authorised Representative',
        role: 'Director',
        email: 'alex@example.com',
        phone: '+65 6123 4567',
        contactType: 'INDIVIDUAL',
        nationality: 'Singaporean',
        identificationNumber: 'S1234567A',
        address: {
          full: '123 Sample Street, Singapore 123456',
          letter: '123 Sample Street\nSingapore 123456',
        },
      },
    ],
  };

  it('resolves an explicitly selected company contact by selectedContactId', () => {
    const values = buildOakDocResolutionValues({
      company,
      selectedContactId: 'contact-1',
      fieldTags: [
        'selectedContact.name',
        'selectedContact.detail',
        'selectedContact.role',
        'selectedContact.email',
        'selectedContact.phone',
        'selectedContact.address.full',
        'selectedContact.address.letter',
        'selectedContact.contactType',
      ],
    });

    expect(values).toMatchObject({
      'selectedContact.name': 'Alex Lim',
      'selectedContact.detail': 'Authorised Representative',
      'selectedContact.role': 'Director',
      'selectedContact.email': 'alex@example.com',
      'selectedContact.phone': '+65 6123 4567',
      'selectedContact.address.full': '123 Sample Street, Singapore 123456',
      'selectedContact.address.letter': '123 Sample Street\nSingapore 123456',
      'selectedContact.contactType': 'INDIVIDUAL',
    });
  });

  it('resolves only explicit agreement-context tags and does not reopen custom.* parsing', () => {
    const values = buildOakDocResolutionValues({
      company,
      fieldTags: [
        'agreement.agreementDate',
        'agreement.effectiveDate',
        'agreement.termMonths',
        'agreement.term',
        'custom.agreementDate',
        'custom.foo',
      ],
      agreement: {
        agreementDate: '2026-09-25',
        effectiveDate: '2026-10-01',
        termMonths: 12,
      },
    });

    expect(OAKDOC_AGREEMENT_FIELD_TAGS).toEqual(new Set([
      'agreement.agreementDate',
      'agreement.effectiveDate',
      'agreement.termMonths',
      'agreement.term',
    ]));
    expect(values).toMatchObject({
      'agreement.agreementDate': '25 Sep 2026',
      'agreement.effectiveDate': '1 Oct 2026',
      'agreement.termMonths': '12',
      'agreement.term': '1 year',
    });
    expect(values).not.toHaveProperty('custom.agreementDate');
    expect(values).not.toHaveProperty('custom.foo');
  });
});
