import { describe, expect, it } from 'vitest';
import { proposedDeliveryScopes } from '@/services/compliance-monitoring/coverage';

const decemberFye = { financialYearEndMonth: 12, financialYearEndDay: 31 };

describe('proposed delivery scopes', () => {
  it('confirms an explicit filing scope and drops unknown codes or malformed periods', () => {
    expect(proposedDeliveryScopes({
      filingScope: [
        { obligationCode: 'SG_FORM_C', periodKey: 'ya2026' },
        { obligationCode: 'SG_ECI', periodKey: 'FY2025-12-31' },
        { obligationCode: 'SG_ECI', periodKey: 'FY2025-12-31' },
        { obligationCode: 'UNKNOWN', periodKey: 'YA2026' },
        { obligationCode: 'SG_FORM_C', periodKey: '2026' },
      ],
    }, ['CORPORATE_TAX'], decemberFye)).toEqual([
      { obligationCode: 'SG_FORM_C', periodKey: 'YA2026', confirmation: 'CONFIRMED', source: 'AGREEMENT_FIELD' },
      { obligationCode: 'SG_ECI', periodKey: 'FY2025-12-31', confirmation: 'CONFIRMED', source: 'AGREEMENT_FIELD' },
    ]);
  });

  it('turns a legacy YA field into unconfirmed Form C and ECI scopes for a tax engagement', () => {
    expect(proposedDeliveryScopes({ 'Year of Assessment': 'YA 2026' }, ['CORPORATE_TAX'], { financialYearEndMonth: 3, financialYearEndDay: 31 })).toEqual([
      { obligationCode: 'SG_FORM_C', periodKey: 'YA2026', confirmation: 'UNCONFIRMED', source: 'LEGACY_YA_FIELD' },
      { obligationCode: 'SG_ECI', periodKey: 'FY2025-03-31', confirmation: 'UNCONFIRMED', source: 'LEGACY_YA_FIELD' },
    ]);
  });

  it('proposes only the return when the FYE is unknown, and nothing without a tax profile', () => {
    expect(proposedDeliveryScopes({ ya: 2027 }, ['CORPORATE_TAX'], {})).toEqual([
      { obligationCode: 'SG_FORM_C', periodKey: 'YA2027', confirmation: 'UNCONFIRMED', source: 'LEGACY_YA_FIELD' },
    ]);
    expect(proposedDeliveryScopes({ ya: 2027 }, ['NOMINEE_DIRECTOR'], decemberFye)).toEqual([]);
    expect(proposedDeliveryScopes({}, ['CORPORATE_TAX'], decemberFye)).toEqual([]);
  });
});
