import { describe, expect, it } from 'vitest';
import {
  ALLOWED_ENTITY_TYPES,
  deriveAddress,
  isAllowedEntityType,
  isDeadEntityStatus,
  mapCsvRow,
  normalizeCsvDate,
} from '@/services/acra-sync.helpers';

function csvRow(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    uen: '201904999E',
    entity_name: 'ACME HOLDINGS PTE. LTD.',
    entity_status_description: 'Live Company',
    entity_type_description: 'Local Company',
    company_type_description: 'EXEMPT PRIVATE COMPANY LIMITED BY SHARES',
    registration_incorporate_date: '04/05/2019',
    block: '123',
    street_name: 'MAIN STREET',
    level_no: '05',
    unit_no: '01',
    building_name: 'ACME BUILDING',
    postal_code: '123456',
    account_due_date: '04/11/2026',
    annual_return_date: '04/05/2026',
    primary_ssic_code: '69201',
    primary_ssic_description: 'ACCOUNTING AND AUDITING SERVICES',
    secondary_ssic_code: '70201',
    secondary_ssic_description: 'MANAGEMENT CONSULTANCY SERVICES',
    no_of_officers: '3',
    former_entity_name1: 'OLD ACME PTE. LTD.',
    uen_of_audit_firm1: 'T08LL0001A',
    ...overrides,
  };
}

describe('mapCsvRow', () => {
  it('maps a CSV object row to the entity shape', () => {
    const result = mapCsvRow(csvRow());

    expect(result).toMatchObject({
      uen: '201904999E',
      entityName: 'ACME HOLDINGS PTE. LTD.',
      entityStatus: 'Live Company',
      entityType: 'Local Company',
      companyTypeDescription: 'EXEMPT PRIVATE COMPANY LIMITED BY SHARES',
      registrationIncorporateDate: '2019-05-04',
      block: '123',
      streetName: 'MAIN STREET',
      levelNo: '05',
      unitNo: '01',
      buildingName: 'ACME BUILDING',
      postalCode: '123456',
      accountDueDate: '2026-11-04',
      annualReturnDate: '2026-05-04',
      primarySsicCode: '69201',
      primarySsicDescription: 'ACCOUNTING AND AUDITING SERVICES',
      secondarySsicCode: '70201',
      secondarySsicDescription: 'MANAGEMENT CONSULTANCY SERVICES',
      noOfOfficers: '3',
      formerEntityName1: 'OLD ACME PTE. LTD.',
      uenOfAuditFirm1: 'T08LL0001A',
    });
  });

  it('derives the address from the address parts', () => {
    const result = mapCsvRow(csvRow());

    expect(result?.address).toBe(
      '123 MAIN STREET ACME BUILDING #05-01 SINGAPORE 123456'
    );
  });

  it('derives a partial address when some parts are missing', () => {
    const result = mapCsvRow(
      csvRow({ level_no: '', unit_no: '', building_name: '', postal_code: '' })
    );

    expect(result?.address).toBe('123 MAIN STREET SINGAPORE');
  });

  it('derives an empty address when no address parts exist', () => {
    const result = mapCsvRow(
      csvRow({
        block: '',
        street_name: '',
        level_no: '',
        unit_no: '',
        building_name: '',
        postal_code: '',
      })
    );

    expect(result?.address).toBe('');
  });

  it('trims whitespace and slices overlong fields', () => {
    const result = mapCsvRow(csvRow({
      uen: `  ${'X'.repeat(60)}  `,
      entity_name: `  ${'Y'.repeat(800)}  `,
      entity_status_description: `  ${'Z'.repeat(400)}  `,
      entity_type_description: '  Local Company  ',
    }));

    expect(result?.uen).toHaveLength(32);
    expect(result?.entityName).toHaveLength(500);
    expect(result?.entityStatus).toHaveLength(200);
    expect(result?.entityType).toBe('Local Company');
  });

  it.each([
    'Business',
    'Limited Liability Partnership',
    'Sole Proprietorship',
    'Limited Partnership',
    'Public Accounting Firm',
    'na',
  ])('returns null for entity type "%s"', (entityType) => {
    expect(mapCsvRow(csvRow({ entity_type_description: entityType }))).toBeNull();
  });

  it('returns null for an empty entity type', () => {
    expect(mapCsvRow(csvRow({ entity_type_description: '   ' }))).toBeNull();
  });

  it.each([
    'Struck Off',
    'Deregistered',
    "Dissolved - Creditors' Voluntary Winding Up",
    'Amalgamated',
    'na',
    '',
  ])('returns null for dead entity status "%s"', (entityStatus) => {
    expect(mapCsvRow(csvRow({ entity_status_description: entityStatus }))).toBeNull();
  });

  it('keeps live, foreign, and in-liquidation entities', () => {
    expect(mapCsvRow(csvRow({ entity_status_description: 'Live Company' }))).not.toBeNull();
    expect(mapCsvRow(csvRow({ entity_status_description: 'In Liquidation - Creditors' }))).not.toBeNull();
    expect(mapCsvRow(csvRow({ entity_type_description: 'Foreign Company' }))).not.toBeNull();
  });

  it('returns null when uen is missing', () => {
    expect(mapCsvRow(csvRow({ uen: '' }))).toBeNull();
  });

  it('returns null when entity_name is missing or empty', () => {
    expect(mapCsvRow(csvRow({ entity_name: undefined as unknown as string }))).toBeNull();
    expect(mapCsvRow(csvRow({ entity_name: '   ' }))).toBeNull();
  });
});

describe('normalizeCsvDate', () => {
  it('converts DD/MM/YYYY to ISO', () => {
    expect(normalizeCsvDate('04/05/2019')).toBe('2019-05-04');
    expect(normalizeCsvDate('31/12/2026')).toBe('2026-12-31');
  });

  it('passes through non-date values', () => {
    expect(normalizeCsvDate('')).toBe('');
    expect(normalizeCsvDate('N/A')).toBe('N/A');
    expect(normalizeCsvDate('2019-05-04')).toBe('2019-05-04');
  });
});

describe('deriveAddress', () => {
  it('joins all parts in the Singapore address format', () => {
    expect(
      deriveAddress({
        block: '9',
        streetName: 'RAFFLES PLACE',
        buildingName: 'REPUBLIC PLAZA',
        levelNo: '30',
        unitNo: '01',
        postalCode: '048619',
      })
    ).toBe('9 RAFFLES PLACE REPUBLIC PLAZA #30-01 SINGAPORE 048619');
  });

  it('returns an empty string when nothing is provided', () => {
    expect(
      deriveAddress({
        block: '',
        streetName: '',
        buildingName: '',
        levelNo: '',
        unitNo: '',
        postalCode: '',
      })
    ).toBe('');
  });
});

describe('isDeadEntityStatus', () => {
  it('matches dead statuses case-insensitively', () => {
    expect(isDeadEntityStatus('STRUCK OFF')).toBe(true);
    expect(isDeadEntityStatus('  Deregistered  ')).toBe(true);
    expect(isDeadEntityStatus('Live Company')).toBe(false);
    expect(isDeadEntityStatus('In Liquidation - Creditors')).toBe(false);
  });
});

describe('isAllowedEntityType', () => {
  it('allows only local and foreign companies', () => {
    expect(isAllowedEntityType('Local Company')).toBe(true);
    expect(isAllowedEntityType('foreign company')).toBe(true);
    expect(isAllowedEntityType('Business')).toBe(false);
    expect(isAllowedEntityType('')).toBe(false);
  });
});

describe('ALLOWED_ENTITY_TYPES', () => {
  it('contains the two allowed types', () => {
    expect(ALLOWED_ENTITY_TYPES).toEqual(new Set(['local company', 'foreign company']));
  });
});
