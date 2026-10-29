import { describe, expect, it } from 'vitest';
import {
  projectCompanyObligations,
  type CompanyMonitoringProjectionInput,
  type CoverageInput,
  type DeliveryScopeInput,
} from '@/services/compliance-monitoring/projection';
import { obligationsForProfiles } from '@/services/compliance-monitoring/catalog';
import { SG_AGM_PRESET, SG_ANNUAL_RETURN_PRESET, SG_ECI_PRESET, SG_FORM_C_PRESET } from '@/services/deadline-rule/presets';
import type { BusinessCalendarSnapshot, DateOnly } from '@/services/service-schedule';

const calendar: BusinessCalendarSnapshot = {
  id: 'sg',
  timeZone: 'Asia/Singapore',
  revision: 1,
  weekendDays: new Set([0, 6]),
  holidays: new Set<DateOnly>(),
};

const rulesByCode = Object.fromEntries([SG_ECI_PRESET, SG_FORM_C_PRESET].map((preset) => [preset.code, {
  ruleId: `rule-${preset.code}`,
  ruleCode: preset.code,
  ruleVersionId: `version-${preset.code}`,
  recurrence: preset.definition.recurrence,
  applicability: preset.definition.applicability,
  milestones: preset.definition.milestones,
}]));

function taxCoverage(start: DateOnly, end: DateOnly | null = null): CoverageInput {
  return { id: 'coverage-tax', profile: 'CORPORATE_TAX', monitoringStart: start, monitoringEnd: end };
}

function contracted(obligationCode: string, periodKey: string, overrides: Partial<DeliveryScopeInput> = {}): DeliveryScopeInput {
  return {
    id: `scope-${obligationCode}-${periodKey}`,
    clientServiceId: 'service-tax',
    obligationCode,
    periodKey,
    confirmation: 'CONFIRMED',
    serviceActive: true,
    ...overrides,
  };
}

function input(overrides: Partial<CompanyMonitoringProjectionInput> = {}): CompanyMonitoringProjectionInput {
  return {
    companyId: 'company-1',
    today: '2026-09-27',
    company: {},
    isGstRegistered: false,
    periodFacts: { financialYearEndMonth: 3, financialYearEndDay: 31, incorporationDate: '2015-01-05' },
    coverages: [taxCoverage('2026-04-01')],
    deliveryScopes: [contracted('SG_ECI', 'FY2026-03-31'), contracted('SG_FORM_C', 'YA2027')],
    rulesByCode,
    calendar,
    ...overrides,
  };
}

function rows(result: ReturnType<typeof projectCompanyObligations>) {
  return result.obligations.map((obligation) => [
    obligation.dueDate,
    obligation.obligationCode,
    obligation.periodKey,
    obligation.filingResponsibility,
    obligation.coverageTiming,
  ]);
}

describe('company obligation projection: the March FYE example', () => {
  it('shows June ECI, the prior-FYE YA 2026 return and the YA 2027 return with correct responsibility', () => {
    // Tax returns due in the year before the agreement date enter takeover
    // review; an ECI only within the three months before it.
    const result = projectCompanyObligations(input());
    expect(rows(result)).toEqual([
      ['2025-11-30', 'SG_FORM_C', 'YA2025', 'UNCONFIRMED', 'BEFORE_START'],
      ['2026-06-30', 'SG_ECI', 'FY2026-03-31', 'OAKCLOUD', 'DURING'],
      ['2026-11-30', 'SG_FORM_C', 'YA2026', 'UNCONFIRMED', 'DURING'],
      ['2027-06-30', 'SG_ECI', 'FY2027-03-31', 'UNCONFIRMED', 'DURING'],
      ['2027-11-30', 'SG_FORM_C', 'YA2027', 'OAKCLOUD', 'DURING'],
      ['2028-06-30', 'SG_ECI', 'FY2028-03-31', 'UNCONFIRMED', 'DURING'],
    ]);
    const yaTwentySix = result.obligations.find((obligation) => obligation.periodKey === 'YA2026')!;
    expect(yaTwentySix.obligationPeriod).toMatchObject({ end: '2025-03-31', yearOfAssessment: 2026 });
    expect(yaTwentySix.reasons).toEqual([{ kind: 'MONITORING_INTERVAL', coverageId: 'coverage-tax' }]);
  });

  it('keeps the June filing after it passes without declaring it completed or overdue', () => {
    const june = projectCompanyObligations(input()).obligations.find((obligation) => obligation.periodKey === 'FY2026-03-31')!;
    expect(june.filingStatusUnconfirmed).toBe(true);
    expect(june.reasons).toEqual(expect.arrayContaining([
      { kind: 'MONITORING_INTERVAL', coverageId: 'coverage-tax' },
      { kind: 'CONTRACTED_DELIVERY', deliveryScopeId: 'scope-SG_ECI-FY2026-03-31', clientServiceId: 'service-tax' },
    ]));
  });

  it('shows November 2027 immediately for a March 2026 engagement', () => {
    const result = projectCompanyObligations(input({ today: '2026-03-15', coverages: [taxCoverage('2026-03-01')] }));
    expect(result.obligations.some((obligation) => obligation.periodKey === 'YA2027' && obligation.dueDate === '2027-11-30')).toBe(true);
  });

  it('includes a contracted period beyond the rolling horizon', () => {
    const result = projectCompanyObligations(input({
      deliveryScopes: [contracted('SG_FORM_C', 'YA2029')],
    }));
    const far = result.obligations.find((obligation) => obligation.periodKey === 'YA2029')!;
    expect(far).toMatchObject({ dueDate: '2029-11-30', filingResponsibility: 'OAKCLOUD', coverageTiming: 'DURING' });
    expect(far.reasons).toEqual([{ kind: 'CONTRACTED_DELIVERY', deliveryScopeId: 'scope-SG_FORM_C-YA2029', clientServiceId: 'service-tax' }]);
  });
});

describe('company obligation projection: agreement timing', () => {
  it('a 1 September agreement covers both returns and puts June ECI in takeover review', () => {
    const result = projectCompanyObligations(input({
      coverages: [taxCoverage('2026-09-01')],
      deliveryScopes: [contracted('SG_ECI', 'FY2026-03-31')],
    }));
    const june = result.obligations.find((obligation) => obligation.periodKey === 'FY2026-03-31')!;
    expect(june.coverageTiming).toBe('BEFORE_START');
    expect(june.reasons.map((reason) => reason.kind).sort()).toEqual(['CONTRACTED_DELIVERY', 'TAKEOVER_REVIEW']);
    expect(june.filingResponsibility).toBe('OAKCLOUD');
    expect(result.obligations.filter((obligation) => obligation.obligationCode === 'SG_FORM_C').map((obligation) => [obligation.periodKey, obligation.coverageTiming])).toEqual([
      ['YA2025', 'BEFORE_START'],
      ['YA2026', 'DURING'],
      ['YA2027', 'DURING'],
    ]);
  });

  it('a late activation of an April agreement still covers June from the agreement date', () => {
    const june = projectCompanyObligations(input({ today: '2026-09-10' })).obligations.find((obligation) => obligation.periodKey === 'FY2026-03-31')!;
    expect(june.coverageTiming).toBe('DURING');
    expect(june.filingStatusUnconfirmed).toBe(true);
  });

  it('keeps an ECI due more than three months before the start out of takeover review', () => {
    const result = projectCompanyObligations(input({ coverages: [taxCoverage('2026-10-01')], deliveryScopes: [] }));
    expect(result.obligations.some((obligation) => obligation.periodKey === 'FY2026-03-31')).toBe(false);
  });

  it('treats tax returns from the engagement start YA as engaged work, even beyond the lookback', () => {
    const result = projectCompanyObligations(input({
      coverages: [{ ...taxCoverage('2026-04-01'), engagementStartYearOfAssessment: 2024 }],
      deliveryScopes: [],
    }));
    const ya2024 = result.obligations.find((obligation) => obligation.obligationCode === 'SG_FORM_C' && obligation.periodKey === 'YA2024')!;
    expect(ya2024).toMatchObject({ dueDate: '2024-11-30', coverageTiming: 'DURING', filingResponsibility: 'OAKCLOUD' });
    expect(ya2024.reasons).toEqual([{ kind: 'MONITORING_INTERVAL', coverageId: 'coverage-tax' }]);
    expect(result.obligations.some((obligation) => (obligation.obligationPeriod.yearOfAssessment ?? 0) < 2024)).toBe(false);
    // ECI does not reach back: the June 2025 ECI is nine months before the start.
    expect(result.obligations.filter((obligation) => obligation.obligationCode === 'SG_ECI' && obligation.dueDate < '2026-04-01')).toEqual([]);
  });

  it('a 1 December agreement moves the November 2026 return to earlier-obligation review', () => {
    const result = projectCompanyObligations(input({
      today: '2026-12-05',
      coverages: [taxCoverage('2026-12-01')],
      deliveryScopes: [],
    }));
    const november = result.obligations.find((obligation) => obligation.periodKey === 'YA2026')!;
    expect(november.coverageTiming).toBe('BEFORE_START');
    expect(november.reasons).toEqual([{ kind: 'TAKEOVER_REVIEW', coverageId: 'coverage-tax' }]);
  });

  it('does not create a YA 2026 obligation for a company incorporated in 2026', () => {
    const result = projectCompanyObligations(input({
      periodFacts: { financialYearEndMonth: 3, financialYearEndDay: 31, incorporationDate: '2026-02-10' },
    }));
    expect(result.obligations.map((obligation) => obligation.periodKey)).not.toContain('YA2026');
    expect(result.issues.some((entry) => entry.type === 'PERIOD_REVIEW' && entry.periodKey === 'YA2027')).toBe(true);
    expect(result.fullyCovered).toBe(false);
  });

  it('stops routine coverage at an explicit end date but keeps contracted work', () => {
    const result = projectCompanyObligations(input({ coverages: [taxCoverage('2026-04-01', '2026-12-31')] }));
    expect(result.obligations.find((obligation) => obligation.periodKey === 'FY2027-03-31')).toBeUndefined();
    expect(result.obligations.find((obligation) => obligation.periodKey === 'YA2027')).toMatchObject({
      coverageTiming: 'AFTER_END',
      filingResponsibility: 'OAKCLOUD',
    });
  });
});

describe('company obligation projection: responsibility', () => {
  it('flags conflicting delivery assignments instead of picking one', () => {
    const result = projectCompanyObligations(input({
      deliveryScopes: [
        contracted('SG_FORM_C', 'YA2027'),
        contracted('SG_FORM_C', 'YA2027', { id: 'scope-other', clientServiceId: 'service-other' }),
      ],
    }));
    expect(result.obligations.find((obligation) => obligation.periodKey === 'YA2027')?.filingResponsibility).toBe('UNCONFIRMED');
    expect(result.issues.map((entry) => entry.type)).toContain('RESPONSIBILITY_CONFLICT');
  });

  it('keeps legacy unconfirmed scope unconfirmed and proposes the service', () => {
    const result = projectCompanyObligations(input({
      deliveryScopes: [contracted('SG_FORM_C', 'YA2027', { confirmation: 'UNCONFIRMED' })],
    }));
    expect(result.obligations.find((obligation) => obligation.periodKey === 'YA2027')).toMatchObject({
      filingResponsibility: 'UNCONFIRMED',
      deliveryClientServiceId: 'service-tax',
    });
  });

  it('keeps the obligation and asks for handover review when the filing service ends', () => {
    const result = projectCompanyObligations(input({
      deliveryScopes: [contracted('SG_FORM_C', 'YA2027', { serviceActive: false })],
    }));
    expect(result.obligations.find((obligation) => obligation.periodKey === 'YA2027')?.filingResponsibility).toBe('UNCONFIRMED');
    expect(result.issues.map((entry) => entry.type)).toContain('DELIVERY_ENDED');
  });
});

describe('company obligation projection: nominee director inventory', () => {
  const nominee: CoverageInput = { id: 'coverage-nominee', profile: 'NOMINEE_DIRECTOR', monitoringStart: '2026-04-01', monitoringEnd: null };

  it('monitors tax deadlines and keeps every other family visible for review', () => {
    const result = projectCompanyObligations(input({ coverages: [nominee], deliveryScopes: [] }));
    expect(result.obligations.every((obligation) => obligation.filingResponsibility === 'UNCONFIRMED')).toBe(true);
    expect(result.obligations.map((obligation) => obligation.obligationCode)).toEqual(expect.arrayContaining(['SG_ECI', 'SG_FORM_C']));
    const families = result.issues.filter((entry) => entry.type === 'FAMILY_NOT_AUTOMATED').map((entry) => entry.obligationCode);
    expect(families).toEqual([
      'SG_EMPLOYER_OBLIGATIONS',
      'SG_REGISTERS_AND_EVENTS',
      'SG_OTHER_COMPANY_OBLIGATIONS',
    ]);
    expect(result.fullyCovered).toBe(false);
  });

  it('adds GST to the inventory only for a GST-registered company', () => {
    const result = projectCompanyObligations(input({ coverages: [nominee], deliveryScopes: [], isGstRegistered: true }));
    expect(result.issues.map((entry) => entry.obligationCode)).toContain('SG_GST_RETURN');
  });

  it('tax plus nominee coverage produces one row per obligation with both reasons', () => {
    const result = projectCompanyObligations(input({ coverages: [taxCoverage('2026-04-01'), nominee] }));
    const yaTwentySix = result.obligations.filter((obligation) => obligation.periodKey === 'YA2026');
    expect(yaTwentySix).toHaveLength(1);
    expect(yaTwentySix[0]!.reasons).toEqual([
      { kind: 'MONITORING_INTERVAL', coverageId: 'coverage-tax' },
      { kind: 'MONITORING_INTERVAL', coverageId: 'coverage-nominee' },
    ]);
  });

  it('includes every catalog family for nominee coverage', () => {
    expect(obligationsForProfiles(['NOMINEE_DIRECTOR']).map((definition) => definition.family)).toEqual([
      'CORPORATE_TAX',
      'CORPORATE_TAX',
      'ANNUAL_RETURN_AGM',
      'ANNUAL_RETURN_AGM',
      'GST',
      'EMPLOYER',
      'REGISTERS_AND_EVENTS',
      'OTHER_COMPANY_SPECIFIC',
    ]);
  });
});

describe('company obligation projection: missing configuration', () => {
  it('asks for the FYE instead of dropping the company', () => {
    const result = projectCompanyObligations(input({ periodFacts: {} }));
    expect(result.obligations).toEqual([]);
    expect(result.issues.map((entry) => entry.type)).toEqual(['MISSING_FINANCIAL_YEAR_END']);
  });

  it('asks for the preset to be published when a rule is missing', () => {
    const result = projectCompanyObligations(input({ rulesByCode: {} }));
    expect(result.issues.map((entry) => entry.type)).toEqual(['RULE_NOT_PUBLISHED', 'RULE_NOT_PUBLISHED']);
  });

  it('does nothing for a company without coverage or contracted scope', () => {
    const result = projectCompanyObligations(input({ coverages: [], deliveryScopes: [] }));
    expect(result).toMatchObject({ obligations: [], issues: [], fullyCovered: true });
  });
});

describe('company obligation projection: ACRA AGM and annual return', () => {
  const acraRules = Object.fromEntries([SG_AGM_PRESET, SG_ANNUAL_RETURN_PRESET].map((preset) => [preset.code, {
    ruleId: `rule-${preset.code}`,
    ruleCode: preset.code,
    ruleVersionId: `version-${preset.code}`,
    recurrence: preset.definition.recurrence,
    applicability: preset.definition.applicability,
    milestones: preset.definition.milestones,
  }]));
  const secretarial = (overrides: Partial<CoverageInput> = {}): CoverageInput => ({
    id: 'coverage-cosec',
    profile: 'CORPORATE_SECRETARIAL',
    monitoringStart: '2026-04-01',
    monitoringEnd: null,
    clientServiceId: 'service-cosec',
    ...overrides,
  });

  it('a corporate secretarial service monitors only the AGM and annual return, per financial year', () => {
    const result = projectCompanyObligations(input({
      coverages: [secretarial()],
      deliveryScopes: [],
      rulesByCode: { ...rulesByCode, ...acraRules },
    }));
    // Filings due in the year before the service started enter takeover review.
    expect(rows(result)).toEqual([
      ['2025-09-30', 'SG_AGM_DUE', 'FY2025-03-31', 'UNCONFIRMED', 'BEFORE_START'],
      ['2025-10-31', 'SG_ANNUAL_RETURN', 'FY2025-03-31', 'UNCONFIRMED', 'BEFORE_START'],
      ['2026-09-30', 'SG_AGM_DUE', 'FY2026-03-31', 'UNCONFIRMED', 'DURING'],
      ['2026-10-31', 'SG_ANNUAL_RETURN', 'FY2026-03-31', 'UNCONFIRMED', 'DURING'],
      ['2027-09-30', 'SG_AGM_DUE', 'FY2027-03-31', 'UNCONFIRMED', 'DURING'],
      ['2027-10-31', 'SG_ANNUAL_RETURN', 'FY2027-03-31', 'UNCONFIRMED', 'DURING'],
    ]);
    expect(result.issues).toEqual([]);
  });

  it('files from the engagement start: FY 2026 is YA 2027', () => {
    const result = projectCompanyObligations(input({
      coverages: [secretarial({ engagementStartYearOfAssessment: 2027 })],
      deliveryScopes: [],
      rulesByCode: { ...rulesByCode, ...acraRules },
    }));
    expect(result.obligations.map((obligation) => [obligation.obligationCode, obligation.periodKey, obligation.filingResponsibility, obligation.deliveryClientServiceId])).toEqual(
      expect.arrayContaining([
        ['SG_AGM_DUE', 'FY2026-03-31', 'OAKCLOUD', 'service-cosec'],
        ['SG_ANNUAL_RETURN', 'FY2026-03-31', 'OAKCLOUD', 'service-cosec'],
      ]),
    );
  });

  it('asks for the ACRA rules to be published before nominee monitoring can date them', () => {
    const result = projectCompanyObligations(input({
      coverages: [{ id: 'coverage-nominee', profile: 'NOMINEE_DIRECTOR', monitoringStart: '2026-04-01', monitoringEnd: null }],
      deliveryScopes: [],
    }));
    expect(result.issues.filter((entry) => entry.type === 'RULE_NOT_PUBLISHED').map((entry) => entry.obligationCode)).toEqual([
      'SG_AGM_DUE',
      'SG_ANNUAL_RETURN',
    ]);
  });
});
