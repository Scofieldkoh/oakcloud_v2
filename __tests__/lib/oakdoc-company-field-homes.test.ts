import { describe, expect, it } from 'vitest';
import {
  COMPANY_FIELD_HOMES,
  COMPANY_FIELD_HOME_IDS,
  applyCompanyFieldValues,
  companyFieldHomeForTag,
  companyFieldTagsToResolve,
  detectMissingCompanyFields,
  formatCompanyFieldValue,
  normalizeCompanyFieldValue,
} from '@/lib/document-editor/oakdoc-company-field-homes';
import { buildOakDocResolutionValues, type OakDocCompanyDetail } from '@/lib/document-editor/oakdoc-context';
import { OAKDOC_FIELD_BY_TAG } from '@/lib/document-editor/oakdoc-field-registry';
import { companyProfileSectionSchemas } from '@/lib/validations/company-profile';

const company: OakDocCompanyDetail = {
  id: 'company-1',
  name: 'ABC Pte. Ltd.',
  uen: '202400001A',
  incorporationDate: null,
  financialYearEndDay: null,
  financialYearEndMonth: null,
  financialPeriods: [],
  addresses: [],
};

describe('company field homes', () => {
  it('maps every tag to a registered company field and every id to one home', () => {
    expect(COMPANY_FIELD_HOMES.map((home) => home.id)).toEqual([...COMPANY_FIELD_HOME_IDS]);
    for (const home of COMPANY_FIELD_HOMES) {
      expect(home.tags).toContain(home.probeTag);
      for (const tag of home.tags) {
        expect(OAKDOC_FIELD_BY_TAG.has(tag), tag).toBe(true);
        expect(companyFieldHomeForTag(tag)?.id).toBe(home.id);
      }
      expect(Object.keys(companyProfileSectionSchemas)).toContain(home.section);
    }
  });

  it('keeps the first FYE in the compliance data', () => {
    const home = companyFieldHomeForTag('company.firstFinancialYearEnd');
    expect(home).toMatchObject({ id: 'firstFinancialYearEnd', input: 'date', section: 'compliance', sectionLabel: 'compliance data' });
    expect(companyFieldHomeForTag('company.address.postalCode')?.id).toBe('registeredAddress');
    expect(companyFieldHomeForTag('company.primaryActivity')).toBeNull();
  });

  it('resolves company tags and the probe tag of each home they belong to', () => {
    expect(companyFieldTagsToResolve([
      'company.address.postalCode',
      'selectedDirector.name',
      'custom.fee',
      'company.name',
    ])).toEqual(['company.address.postalCode', 'company.name', 'company.registeredAddress']);
    expect(companyFieldTagsToResolve(undefined)).toEqual([]);
  });
});

describe('normalizeCompanyFieldValue', () => {
  it('checks dates, year ends, text, addresses and amounts', () => {
    expect(normalizeCompanyFieldValue('firstFinancialYearEnd', '2026-12-31')).toEqual({ ok: true, value: '2026-12-31' });
    expect(normalizeCompanyFieldValue('incorporationDate', '2026-02-30').ok).toBe(false);
    expect(normalizeCompanyFieldValue('financialYearEnd', '12-31')).toEqual({ ok: true, value: '12-31' });
    expect(normalizeCompanyFieldValue('financialYearEnd', '02-30')).toEqual({ ok: false, error: 'February has no day 30.' });
    expect(normalizeCompanyFieldValue('uen', '  ')).toEqual({ ok: false, error: 'Enter the UEN.' });
    expect(normalizeCompanyFieldValue('registeredAddress', JSON.stringify({ streetName: 'Oak Road' })))
      .toEqual({ ok: false, error: 'Enter the postal code.' });
    const address = normalizeCompanyFieldValue('registeredAddress', JSON.stringify({
      block: '1', streetName: 'Oak Road', postalCode: '123456',
    }));
    expect(address.ok && JSON.parse(address.value)).toMatchObject({ country: 'Singapore', block: '1' });
    expect(normalizeCompanyFieldValue('paidUpCapital', JSON.stringify({ currency: 'sgd', amount: 100 })))
      .toEqual({ ok: true, value: JSON.stringify({ currency: 'SGD', amount: 100 }) });
    expect(normalizeCompanyFieldValue('paidUpCapital', JSON.stringify({ amount: -1 })).ok).toBe(false);
  });

  it('formats values for people to read', () => {
    expect(formatCompanyFieldValue('firstFinancialYearEnd', '2026-12-31')).toBe('31 Dec 2026');
    expect(formatCompanyFieldValue('financialYearEnd', '06-30')).toBe('30 June');
    expect(formatCompanyFieldValue('paidUpCapital', JSON.stringify({ currency: 'SGD', amount: 10000 }))).toBe('SGD 10,000.00');
  });
});

describe('detectMissingCompanyFields', () => {
  const tags = [
    'company.name',
    'company.firstFinancialYearEnd',
    'company.address.postalCode',
    'company.registeredAddress',
    'company.secondaryActivity',
    'selectedDirector.name',
  ];

  it('lists blank values by home, and blank derived values with no home separately', () => {
    const result = detectMissingCompanyFields({
      tags,
      values: {
        'company.name': 'ABC Pte. Ltd.',
        'company.firstFinancialYearEnd': '',
        'company.registeredAddress': '',
        'company.address.postalCode': '',
        'company.secondaryActivity': '',
      },
    });
    expect(result.fillable.map((field) => [field.home.id, field.tags])).toEqual([
      ['firstFinancialYearEnd', ['company.firstFinancialYearEnd']],
      ['registeredAddress', ['company.address.postalCode', 'company.registeredAddress']],
    ]);
    // Worked-out values such as the secondary activity are not flagged.
  });

  it('asks only for the first FYE when the year end is missing too', () => {
    const result = detectMissingCompanyFields({
      tags: ['company.financialYearEnd', 'company.firstFinancialYearEnd'],
      values: { 'company.financialYearEnd': '', 'company.firstFinancialYearEnd': '' },
    });
    expect(result.fillable.map((field) => [field.home.id, field.tags])).toEqual([
      ['firstFinancialYearEnd', ['company.firstFinancialYearEnd', 'company.financialYearEnd']],
    ]);
    // A template printing only the year end still asks for its day and month.
    expect(detectMissingCompanyFields({
      tags: ['company.financialYearEnd'],
      values: { 'company.financialYearEnd': '' },
    }).fillable.map((field) => field.home.id)).toEqual(['financialYearEnd']);
  });

  it('does not flag an optional address part when the address is on record', () => {
    const result = detectMissingCompanyFields({
      tags: ['company.address.level'],
      values: { 'company.address.level': '', 'company.registeredAddress': '1 Oak Road Singapore 123456' },
    });
    expect(result).toEqual({ fillable: [] });
  });

  it('keeps a value set for this document only on its entry', () => {
    const result = detectMissingCompanyFields({
      tags,
      values: { 'company.firstFinancialYearEnd': '', 'company.registeredAddress': 'x', 'company.secondaryActivity': 'y' },
      documentValues: { firstFinancialYearEnd: '2026-12-31' },
    });
    expect(result.fillable).toHaveLength(1);
    expect(result.fillable[0].documentValue).toBe('2026-12-31');
  });
});

describe('applyCompanyFieldValues', () => {
  const fieldTags = [
    'company.firstFinancialYearEnd',
    'company.financialYearEnd',
    'company.incorporationDate',
    'company.registeredAddress',
    'company.address.postalCode',
    'company.paidUpCapital',
  ];

  it('prints document-only values, with derived fields following from them', () => {
    const detail = applyCompanyFieldValues(company, {
      incorporationDate: '2025-03-15',
      financialYearEnd: '12-31',
      registeredAddress: JSON.stringify({ block: '1', streetName: 'Oak Road', postalCode: '123456' }),
      paidUpCapital: JSON.stringify({ currency: 'SGD', amount: 1000 }),
    });
    const values = buildOakDocResolutionValues({ company: detail, fieldTags });
    expect(values['company.incorporationDate']).toBe('15 Mar 2025');
    expect(values['company.financialYearEnd']).toBe('31 December');
    // Derived from the incorporation date and year end.
    expect(values['company.firstFinancialYearEnd']).toBe('31 Dec 2025');
    expect(values['company.registeredAddress']).toMatch(/Oak Road/);
    expect(values['company.address.postalCode']).toBe('123456');
    expect(values['company.paidUpCapital']).toBe('SGD 1,000.00');
  });

  it('fills only blanks, so a value the company has prints, and ignores invalid entries', () => {
    const recorded = { ...company, incorporationDate: '2025-03-15', financialYearEndDay: 31, financialYearEndMonth: 12 };
    const detail = applyCompanyFieldValues(recorded, { firstFinancialYearEnd: '2026-06-30', uen: '', bogus: 'x' });
    expect(detail.uen).toBe('202400001A');
    // The company's own (derived) first FYE wins over the document value.
    expect(buildOakDocResolutionValues({ company: detail, fieldTags })['company.firstFinancialYearEnd']).toBe('31 Dec 2025');
    const blankFirst = applyCompanyFieldValues(company, { firstFinancialYearEnd: '2026-06-30' });
    expect(buildOakDocResolutionValues({ company: blankFirst, fieldTags })['company.firstFinancialYearEnd']).toBe('30 Jun 2026');
    expect(applyCompanyFieldValues(company, undefined)).toBe(company);
    // With no year end on record, it is taken from the first FYE.
    expect(buildOakDocResolutionValues({ company: blankFirst, fieldTags })['company.financialYearEnd']).toBe('30 June');
  });
});
