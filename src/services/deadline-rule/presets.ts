import type { DateOnly } from '@/services/service-schedule';
import type { CanonicalDeadlineRuleDefinition } from './canonical';

/**
 * Reviewed, ready-to-use statutory rule presets.
 *
 * A preset supplies the statutory constants and explicit period semantics so
 * staff never enter "months after FYE" for a client. Rule codes are stable:
 * applying a preset to an existing rule with the same code stages a normal
 * draft that still goes through the impact preview and publish flow.
 */

export type DeadlineRulePresetCode = 'SG_ECI' | 'SG_FORM_C' | 'SG_AGM_DUE' | 'SG_ANNUAL_RETURN';

export type DeadlineRulePresetAuthority = 'IRAS' | 'ACRA';

export type DeadlineRulePresetExample = {
  financialYearEnd: DateOnly;
  yearOfAssessment: number;
  dueDate: DateOnly;
};

export type DeadlineRulePreset = {
  code: DeadlineRulePresetCode;
  presetVersion: number;
  jurisdiction: 'SG';
  authority: DeadlineRulePresetAuthority;
  /** One line staff can read without knowing the expression language. */
  plainRule: string;
  sourceUrls: string[];
  reviewedOn: DateOnly;
  reviewStatus: 'PENDING_FIRM_SIGN_OFF' | 'APPROVED';
  /** Facts the rule needs per company and period. */
  requiredInputs: string[];
  periodSelection: 'FINANCIAL_PERIOD' | 'YEAR_OF_ASSESSMENT';
  /** How a later preset revision decides which periods it governs. */
  revisionAppliesBy: 'BASIS_PERIOD_END' | 'YEAR_OF_ASSESSMENT';
  notes: string[];
  definition: CanonicalDeadlineRuleDefinition;
  examples: DeadlineRulePresetExample[];
};

const annualRecurrence = { schemaVersion: 1, kind: 'ANNUALLY' } as const;
const allCompanies = { schemaVersion: 1 as const, kind: 'ALL' as const, conditions: [] };

export const SG_ECI_PRESET: DeadlineRulePreset = {
  code: 'SG_ECI',
  presetVersion: 1,
  jurisdiction: 'SG',
  authority: 'IRAS',
  plainRule: 'ECI: within three months after the financial year ends',
  sourceUrls: [
    'https://www.iras.gov.sg/taxes/corporate-income-tax/estimated-chargeable-income-%28eci%29-filing',
    'https://www.iras.gov.sg/due-dates',
  ],
  reviewedOn: '2026-09-27',
  reviewStatus: 'PENDING_FIRM_SIGN_OFF',
  requiredInputs: ['Financial period (from the FYE or a confirmed period)'],
  periodSelection: 'FINANCIAL_PERIOD',
  revisionAppliesBy: 'BASIS_PERIOD_END',
  notes: [
    'A month-end FYE is due on the last day of the third following month (30 September FYE is due 31 December).',
    'Waived only when the period meets the IRAS waiver (revenue of S$5 million or less and nil ECI); record that assessment per period.',
    'No weekend or public holiday shift.',
    'A non-month-end, changed or first FYE needs a reviewed period before its date is relied on.',
  ],
  definition: {
    schemaVersion: 1,
    code: 'SG_ECI',
    name: 'Estimated Chargeable Income (ECI)',
    description: 'IRAS: within three months after the financial year ends. A month-end FYE is due on the last day of the third following month.',
    recurrence: annualRecurrence,
    applicability: allCompanies,
    parameters: [],
    milestones: [{
      key: 'eci-due',
      name: 'ECI due date',
      description: 'Within three months after the financial year ends',
      type: 'STATUTORY',
      generationMode: 'ONCE_PER_CYCLE',
      expression: {
        kind: 'ADD_MONTHS_MONTH_END',
        source: { kind: 'OBLIGATION_PERIOD_END' },
        amount: 3,
      },
      businessDayAdjustment: 'NONE',
      displayOrder: 0,
      isActive: true,
    }],
  },
  examples: [
    { financialYearEnd: '2026-03-31', yearOfAssessment: 2027, dueDate: '2026-06-30' },
    { financialYearEnd: '2026-06-30', yearOfAssessment: 2027, dueDate: '2026-09-30' },
    { financialYearEnd: '2026-09-30', yearOfAssessment: 2027, dueDate: '2026-12-31' },
    { financialYearEnd: '2026-12-31', yearOfAssessment: 2027, dueDate: '2027-03-31' },
  ],
};

export const SG_FORM_C_PRESET: DeadlineRulePreset = {
  code: 'SG_FORM_C',
  presetVersion: 1,
  jurisdiction: 'SG',
  authority: 'IRAS',
  plainRule: 'Corporate income tax return: 30 November of the Year of Assessment',
  sourceUrls: [
    'https://www.iras.gov.sg/taxes/corporate-income-tax/basics-of-corporate-income-tax/basic-guide-to-corporate-income-tax-for-companies',
    'https://www.iras.gov.sg/taxes/corporate-income-tax/basics-of-corporate-income-tax/corporate-income-tax-filing-season-2026',
  ],
  reviewedOn: '2026-09-27',
  reviewStatus: 'PENDING_FIRM_SIGN_OFF',
  requiredInputs: ['Year of Assessment (suggested as FYE year + 1)'],
  periodSelection: 'YEAR_OF_ASSESSMENT',
  revisionAppliesBy: 'YEAR_OF_ASSESSMENT',
  notes: [
    'Form C, C-S and C-S (Lite) are one annual filing; the form is an attribute, not a separate deadline.',
    'An ECI waiver does not waive this return. Dormancy does not remove it either.',
    'First accounts spanning more than one YA need an explicit basis allocation.',
  ],
  definition: {
    schemaVersion: 1,
    code: 'SG_FORM_C',
    name: 'Corporate income tax return (Form C / C-S / C-S Lite)',
    description: 'IRAS: 30 November of the Year of Assessment. The normal YA is the year after the financial year ends.',
    recurrence: annualRecurrence,
    applicability: allCompanies,
    parameters: [],
    milestones: [{
      key: 'form-c-due',
      name: 'Corporate income tax return due date',
      description: '30 November of the Year of Assessment',
      type: 'STATUTORY',
      generationMode: 'ONCE_PER_CYCLE',
      expression: {
        kind: 'FIXED_DATE_IN_ASSESSMENT_YEAR',
        month: 11,
        day: 30,
      },
      businessDayAdjustment: 'NONE',
      displayOrder: 0,
      isActive: true,
    }],
  },
  examples: [
    { financialYearEnd: '2025-03-31', yearOfAssessment: 2026, dueDate: '2026-11-30' },
    { financialYearEnd: '2026-03-31', yearOfAssessment: 2027, dueDate: '2027-11-30' },
    { financialYearEnd: '2025-12-31', yearOfAssessment: 2026, dueDate: '2026-11-30' },
  ],
};

/*
 * ACRA presets reuse the SG_AGM_DUE / SG_ANNUAL_RETURN codes of the older
 * starter drafts (sourced from Company.accountsDueDate), so applying them
 * stages the FYE-based rule over that draft instead of adding a second rule.
 */
export const SG_AGM_PRESET: DeadlineRulePreset = {
  code: 'SG_AGM_DUE',
  presetVersion: 1,
  jurisdiction: 'SG',
  authority: 'ACRA',
  plainRule: 'AGM: within six months after the financial year ends (non-listed company)',
  sourceUrls: [
    'https://www.acra.gov.sg/manage/companies/legal-requirements-common-offences/holding-annual-general-meetings/due-dates-requirements/',
  ],
  reviewedOn: '2026-10-01',
  reviewStatus: 'PENDING_FIRM_SIGN_OFF',
  requiredInputs: ['Financial period (from the FYE or a confirmed period)'],
  periodSelection: 'FINANCIAL_PERIOD',
  revisionAppliesBy: 'BASIS_PERIOD_END',
  notes: [
    'A month-end FYE is due on the last day of the sixth following month (31 December FYE is due 30 June).',
    'Listed companies hold the AGM within four months instead; this preset covers non-listed companies.',
    'A private company that sends its financial statements to members within five months, has dispensed with AGMs, or is a dormant exempt company need not hold one; record that period as Not required.',
    'No weekend or public holiday shift.',
  ],
  definition: {
    schemaVersion: 1,
    code: 'SG_AGM_DUE',
    name: 'Annual general meeting (AGM)',
    description: 'ACRA: a non-listed company holds its AGM within six months after the financial year ends. A month-end FYE is due on the last day of the sixth following month.',
    recurrence: annualRecurrence,
    applicability: allCompanies,
    parameters: [],
    milestones: [{
      key: 'agm-due',
      name: 'AGM due date',
      description: 'Within six months after the financial year ends',
      type: 'STATUTORY',
      generationMode: 'ONCE_PER_CYCLE',
      expression: {
        kind: 'ADD_MONTHS_MONTH_END',
        source: { kind: 'OBLIGATION_PERIOD_END' },
        amount: 6,
      },
      businessDayAdjustment: 'NONE',
      displayOrder: 0,
      isActive: true,
    }],
  },
  examples: [
    { financialYearEnd: '2026-03-31', yearOfAssessment: 2027, dueDate: '2026-09-30' },
    { financialYearEnd: '2026-06-30', yearOfAssessment: 2027, dueDate: '2026-12-31' },
    { financialYearEnd: '2026-08-31', yearOfAssessment: 2027, dueDate: '2027-02-28' },
    { financialYearEnd: '2026-12-31', yearOfAssessment: 2027, dueDate: '2027-06-30' },
  ],
};

export const SG_ANNUAL_RETURN_PRESET: DeadlineRulePreset = {
  code: 'SG_ANNUAL_RETURN',
  presetVersion: 1,
  jurisdiction: 'SG',
  authority: 'ACRA',
  plainRule: 'Annual return: within seven months after the financial year ends (non-listed company)',
  sourceUrls: [
    'https://www.acra.gov.sg/manage/companies/legal-requirements-common-offences/filing-annual-returns-companies/deadline-requirements/',
  ],
  reviewedOn: '2026-10-01',
  reviewStatus: 'PENDING_FIRM_SIGN_OFF',
  requiredInputs: ['Financial period (from the FYE or a confirmed period)'],
  periodSelection: 'FINANCIAL_PERIOD',
  revisionAppliesBy: 'BASIS_PERIOD_END',
  notes: [
    'A month-end FYE is due on the last day of the seventh following month (31 December FYE is due 31 July).',
    'Listed companies file within five months; a company keeping a branch register outside Singapore gets one more month.',
    'Due even when the company is dormant, exempt from holding an AGM, or has a tax waiver.',
    'No weekend or public holiday shift.',
  ],
  definition: {
    schemaVersion: 1,
    code: 'SG_ANNUAL_RETURN',
    name: 'Annual return (AR)',
    description: 'ACRA: a non-listed company files its annual return within seven months after the financial year ends. A month-end FYE is due on the last day of the seventh following month.',
    recurrence: annualRecurrence,
    applicability: allCompanies,
    parameters: [],
    milestones: [{
      key: 'annual-return-due',
      name: 'Annual return due date',
      description: 'Within seven months after the financial year ends',
      type: 'STATUTORY',
      generationMode: 'ONCE_PER_CYCLE',
      expression: {
        kind: 'ADD_MONTHS_MONTH_END',
        source: { kind: 'OBLIGATION_PERIOD_END' },
        amount: 7,
      },
      businessDayAdjustment: 'NONE',
      displayOrder: 0,
      isActive: true,
    }],
  },
  examples: [
    { financialYearEnd: '2026-03-31', yearOfAssessment: 2027, dueDate: '2026-10-31' },
    { financialYearEnd: '2026-06-30', yearOfAssessment: 2027, dueDate: '2027-01-31' },
    { financialYearEnd: '2026-07-31', yearOfAssessment: 2027, dueDate: '2027-02-28' },
    { financialYearEnd: '2026-12-31', yearOfAssessment: 2027, dueDate: '2027-07-31' },
  ],
};

export const DEADLINE_RULE_PRESETS: Record<DeadlineRulePresetCode, DeadlineRulePreset> = {
  SG_ECI: SG_ECI_PRESET,
  SG_FORM_C: SG_FORM_C_PRESET,
  SG_AGM_DUE: SG_AGM_PRESET,
  SG_ANNUAL_RETURN: SG_ANNUAL_RETURN_PRESET,
};

export const DEADLINE_RULE_PRESET_CODES = Object.keys(DEADLINE_RULE_PRESETS) as [DeadlineRulePresetCode, ...DeadlineRulePresetCode[]];

export function deadlineRulePresetFor(code: string): DeadlineRulePreset | null {
  return Object.prototype.hasOwnProperty.call(DEADLINE_RULE_PRESETS, code)
    ? DEADLINE_RULE_PRESETS[code as DeadlineRulePresetCode]
    : null;
}
