import { describe, expect, it } from 'vitest';
import {
  buildPartyContactFields,
  chooseContactDetail,
  contactIdentity,
  formatLetterAddress,
  identificationLabel,
  type ContactDetailInput,
} from '@/lib/document-party';

describe('formatLetterAddress', () => {
  it('formats a structured Singapore address on three letter lines', () => {
    expect(
      formatLetterAddress({
        building: 'WCEGA Tower',
        block: '21',
        street: 'Bukit Batok Crescent',
        level: '25',
        unit: '72',
        postalCode: '658065',
        country: 'Singapore',
      }),
    ).toEqual({
      full: 'WCEGA Tower, 21 Bukit Batok Crescent, #25-72, Singapore 658065',
      letter: 'WCEGA Tower\n21 Bukit Batok Crescent, #25-72\nSingapore  658065',
    });
  });

  it('uses structured fields for the letter while preserving a conflicting source full address', () => {
    expect(
      formatLetterAddress({
        fullAddress: '99 Stale Road, Singapore 999999',
        building: 'WCEGA Tower',
        block: '21',
        street: 'Bukit Batok Crescent',
        level: '25',
        unit: '72',
        postalCode: '658065',
        country: 'Singapore',
      }),
    ).toEqual({
      full: '99 Stale Road, Singapore 999999',
      letter: 'WCEGA Tower\n21 Bukit Batok Crescent, #25-72\nSingapore  658065',
    });
  });

  it('omits the building line without leaving a blank line', () => {
    expect(
      formatLetterAddress({
        block: '21',
        street: 'Bukit Batok Crescent',
        level: '25',
        unit: '72',
        postalCode: '658065',
      }).letter,
    ).toBe('21 Bukit Batok Crescent, #25-72\nSingapore  658065');
  });

  it('trims existing lines and removes blank lines', () => {
    expect(
      formatLetterAddress({
        fullAddress: '  WCEGA Tower \r\n\r\n 21 Bukit Batok Crescent, #25-72 \n Singapore  658065  ',
      }),
    ).toEqual({
      full: 'WCEGA Tower\n21 Bukit Batok Crescent, #25-72\nSingapore  658065',
      letter: 'WCEGA Tower\n21 Bukit Batok Crescent, #25-72\nSingapore  658065',
    });
  });

  it('converts a recognized single-line Singapore address deterministically', () => {
    expect(
      formatLetterAddress({
        fullAddress:
          '21 Bukit Batok Crescent, #25-72, WCEGA Tower, Singapore 658065',
      }).letter,
    ).toBe('WCEGA Tower\n21 Bukit Batok Crescent, #25-72\nSingapore  658065');
  });

  it('preserves unrecognized free text without reordering it', () => {
    expect(formatLetterAddress({ fullAddress: '  PO Box 123, Johor Bahru  ' })).toEqual({
      full: 'PO Box 123, Johor Bahru',
      letter: 'PO Box 123, Johor Bahru',
    });
  });

  it('preserves a Singapore address when structured parsing leaves a segment unconsumed', () => {
    const fullAddress =
      '21 Bukit Batok Crescent, #25-72, WCEGA Tower, Attn: Accounts, Singapore 658065';

    expect(formatLetterAddress({ fullAddress })).toEqual({
      full: fullAddress,
      letter: fullAddress,
    });
  });

  it('returns null fields for blank address input', () => {
    expect(formatLetterAddress({ fullAddress: ' \n ', street: '  ' })).toEqual({
      full: null,
      letter: null,
    });
  });
});

describe('chooseContactDetail', () => {
  it('chooses a company-specific primary detail before a general primary detail', () => {
    const details: ContactDetailInput[] = [
      { detailType: 'EMAIL', value: 'general@example.com', companyId: null, isPrimary: true },
      { detailType: 'EMAIL', value: 'company@example.com', companyId: 'company-1', isPrimary: true },
    ];

    expect(chooseContactDetail(details, 'EMAIL', 'company-1')).toBe(
      'company@example.com',
    );
  });

  it('falls back to a general detail when the company has no detail of that type', () => {
    expect(
      chooseContactDetail(
        [{ detailType: 'PHONE', value: '+65 6123 4567', companyId: null }],
        'PHONE',
        'company-1',
      ),
    ).toBe('+65 6123 4567');
  });

  it('breaks ties by primary, display order, then creation date', () => {
    const details: ContactDetailInput[] = [
      {
        detailType: 'EMAIL',
        value: 'non-primary@example.com',
        companyId: 'company-1',
        isPrimary: false,
        displayOrder: 0,
        createdAt: '2020-01-01',
      },
      {
        detailType: 'EMAIL',
        value: 'later-order@example.com',
        companyId: 'company-1',
        isPrimary: true,
        displayOrder: 2,
        createdAt: '2019-01-01',
      },
      {
        detailType: 'EMAIL',
        value: 'newer@example.com',
        companyId: 'company-1',
        isPrimary: true,
        displayOrder: 1,
        createdAt: '2024-01-01',
      },
      {
        detailType: 'EMAIL',
        value: 'winner@example.com',
        companyId: 'company-1',
        isPrimary: true,
        displayOrder: 1,
        createdAt: '2023-01-01',
      },
    ];

    expect(chooseContactDetail(details, 'EMAIL', 'company-1')).toBe(
      'winner@example.com',
    );
  });

  it('uses creation date when display order is absent from both details', () => {
    expect(
      chooseContactDetail(
        [
          {
            detailType: 'EMAIL',
            value: 'newer@example.com',
            companyId: 'company-1',
            createdAt: '2024-01-01',
          },
          {
            detailType: 'EMAIL',
            value: 'older@example.com',
            companyId: 'company-1',
            createdAt: '2023-01-01',
          },
        ],
        'EMAIL',
        'company-1',
      ),
    ).toBe('older@example.com');
  });

  it('ignores blank values and returns null when no candidate remains', () => {
    expect(
      chooseContactDetail(
        [
          { detailType: 'EMAIL', value: '  ', companyId: 'company-1' },
          { detailType: 'PHONE', value: '+65 6123 4567', companyId: 'company-1' },
        ],
        'EMAIL',
        'company-1',
      ),
    ).toBeNull();
  });
});

describe('buildPartyContactFields', () => {
  it('falls back independently for email and phone', () => {
    expect(
      buildPartyContactFields({
        companyId: 'company-1',
        contactDetails: [
          { detailType: 'EMAIL', value: 'company@example.com', companyId: 'company-1' },
          { detailType: 'PHONE', value: '+65 6123 4567', companyId: null },
        ],
      }),
    ).toMatchObject({
      email: 'company@example.com',
      phone: '+65 6123 4567',
    });
  });

  it('prefers a nonblank role address and otherwise falls back to the contact address', () => {
    const roleAddress = buildPartyContactFields({
      companyId: 'company-1',
      roleAddress: '1 Role Street, Singapore 123456',
      contactAddress: '2 Contact Street, Singapore 654321',
    });
    const contactAddress = buildPartyContactFields({
      companyId: 'company-1',
      roleAddress: '  ',
      contactAddress: '2 Contact Street, Singapore 654321',
    });

    expect(roleAddress.address.full).toContain('1 Role Street');
    expect(roleAddress.address.full).not.toContain('2 Contact Street');
    expect(contactAddress.address.full).toContain('2 Contact Street');
  });

  it('returns blank contact fields when no usable values exist', () => {
    expect(
      buildPartyContactFields({
        companyId: 'company-1',
        roleAddress: ' ',
        contactAddress: '\n',
        contactDetails: [{ detailType: 'PHONE', value: '  ', companyId: null }],
      }),
    ).toEqual({
      email: null,
      phone: null,
      address: { full: null, letter: null },
    });
  });
});

describe('party identification', () => {
  it('uses a company’s UEN as its identification number', () => {
    expect(contactIdentity({ contactType: 'CORPORATE', corporateUen: ' 202624322D ', identificationNumber: null }))
      .toEqual({ identificationNumber: '202624322D', identificationType: 'UEN' });
    expect(contactIdentity({ contactType: 'INDIVIDUAL', identificationType: 'NRIC', identificationNumber: 'S1234567A', corporateUen: '1' }))
      .toEqual({ identificationNumber: 'S1234567A', identificationType: 'NRIC' });
  });

  it('labels the number by its type, or by its shape when no type is stored', () => {
    expect(identificationLabel('PASSPORT')).toBe('Passport No.');
    expect(identificationLabel('UEN', true)).toBe('UEN');
    expect(identificationLabel(null, false, 'S1234567A')).toBe('NRIC No.');
    expect(identificationLabel(null, false, 'G1234567X')).toBe('FIN');
    expect(identificationLabel(null, false, 'E1234567')).toBe('ID No.');
    expect(identificationLabel(null, true, '202624322D')).toBe('UEN');
    expect(identificationLabel(null, true, 'T08LL1234A')).toBe('UEN');
    expect(identificationLabel(null, true, 'C-12345')).toBe('Registration No.');
  });
});
