/**
 * Governed catalog of company statutory obligations.
 *
 * `obligationCode` is canonical metadata, separate from a tenant's editable
 * rule name. Coverage profiles select obligation families from this catalog;
 * service names are never parsed to decide what Oakcloud monitors.
 */

export type MonitoringProfile = 'CORPORATE_TAX' | 'CORPORATE_SECRETARIAL' | 'NOMINEE_DIRECTOR';

export const MONITORING_PROFILES: readonly MonitoringProfile[] = ['CORPORATE_TAX', 'CORPORATE_SECRETARIAL', 'NOMINEE_DIRECTOR'];

export type ObligationFamily =
  | 'CORPORATE_TAX'
  | 'ANNUAL_RETURN_AGM'
  | 'GST'
  | 'EMPLOYER'
  | 'REGISTERS_AND_EVENTS'
  | 'OTHER_COMPANY_SPECIFIC';

/**
 * PRESET_RULE obligations are calculated from a reviewed published rule.
 * The others stay visible as review items until a reviewed template or an
 * explicit-date entry exists; they are never silently omitted.
 */
export type ObligationAutomation = 'PRESET_RULE' | 'REVIEW_UNTIL_TEMPLATE';

export type ObligationApplicability = 'ALWAYS' | 'GST_REGISTERED';

export type ObligationDefinition = {
  code: string;
  family: ObligationFamily;
  displayName: string;
  authority: 'IRAS' | 'ACRA' | 'CPF' | 'OTHER';
  automation: ObligationAutomation;
  /** Tenant rule code carrying the published rule for PRESET_RULE entries. */
  ruleCode: string | null;
  applicability: ObligationApplicability;
  plainRule: string;
  /** Shown on the review item while the family is not automated. */
  reviewAction: string | null;
  /** Months before the service start a filing still enters takeover review; defaults to the 12-month lookback. */
  takeoverReviewMonths?: number;
  /**
   * False when the engagement start YA does not reach back to filings due
   * before the service started (ECI: only the takeover window applies).
   */
  engagementReachBack?: boolean;
};

export const OBLIGATION_CATALOG: readonly ObligationDefinition[] = [
  {
    code: 'SG_ECI',
    family: 'CORPORATE_TAX',
    displayName: 'Estimated Chargeable Income (ECI)',
    authority: 'IRAS',
    automation: 'PRESET_RULE',
    ruleCode: 'SG_ECI',
    applicability: 'ALWAYS',
    plainRule: 'Within three months after the financial year ends',
    reviewAction: null,
    takeoverReviewMonths: 3,
    engagementReachBack: false,
  },
  {
    code: 'SG_FORM_C',
    family: 'CORPORATE_TAX',
    displayName: 'Corporate income tax return',
    authority: 'IRAS',
    automation: 'PRESET_RULE',
    ruleCode: 'SG_FORM_C',
    applicability: 'ALWAYS',
    plainRule: '30 November of the Year of Assessment',
    reviewAction: null,
  },
  {
    code: 'SG_AGM_DUE',
    family: 'ANNUAL_RETURN_AGM',
    displayName: 'Annual general meeting (AGM)',
    authority: 'ACRA',
    automation: 'PRESET_RULE',
    ruleCode: 'SG_AGM_DUE',
    applicability: 'ALWAYS',
    plainRule: 'Within six months after the financial year ends',
    reviewAction: null,
  },
  {
    code: 'SG_ANNUAL_RETURN',
    family: 'ANNUAL_RETURN_AGM',
    displayName: 'Annual return (AR)',
    authority: 'ACRA',
    automation: 'PRESET_RULE',
    ruleCode: 'SG_ANNUAL_RETURN',
    applicability: 'ALWAYS',
    plainRule: 'Within seven months after the financial year ends',
    reviewAction: null,
  },
  {
    code: 'SG_GST_RETURN',
    family: 'GST',
    displayName: 'GST returns',
    authority: 'IRAS',
    automation: 'REVIEW_UNTIL_TEMPLATE',
    ruleCode: null,
    applicability: 'GST_REGISTERED',
    plainRule: 'One month after each prescribed accounting period',
    reviewAction: 'Record the prescribed GST accounting periods so each return can be tracked.',
  },
  {
    code: 'SG_EMPLOYER_OBLIGATIONS',
    family: 'EMPLOYER',
    displayName: 'Employer and payroll filings',
    authority: 'IRAS',
    automation: 'REVIEW_UNTIL_TEMPLATE',
    ruleCode: null,
    applicability: 'ALWAYS',
    plainRule: 'Depends on employer status (for example employment income and CPF filings)',
    reviewAction: 'Confirm whether the company is an employer and which payroll filings apply.',
  },
  {
    code: 'SG_REGISTERS_AND_EVENTS',
    family: 'REGISTERS_AND_EVENTS',
    displayName: 'Registers and event-driven filings',
    authority: 'ACRA',
    automation: 'REVIEW_UNTIL_TEMPLATE',
    ruleCode: null,
    applicability: 'ALWAYS',
    plainRule: 'Triggered by company changes such as officer, controller or nominee changes',
    reviewAction: 'Confirm with the client whether any company changes, register updates or nominee disclosures are pending.',
  },
  {
    code: 'SG_OTHER_COMPANY_OBLIGATIONS',
    family: 'OTHER_COMPANY_SPECIFIC',
    displayName: 'Licences and other company-specific obligations',
    authority: 'OTHER',
    automation: 'REVIEW_UNTIL_TEMPLATE',
    ruleCode: null,
    applicability: 'ALWAYS',
    plainRule: 'Identified at onboarding (licence renewals, sector notices)',
    reviewAction: 'Record any licence renewals or regulatory obligations identified at onboarding.',
  },
];

/** Families each coverage profile makes Oakcloud responsible for monitoring. */
export const PROFILE_FAMILIES: Record<MonitoringProfile, readonly ObligationFamily[]> = {
  CORPORATE_TAX: ['CORPORATE_TAX'],
  CORPORATE_SECRETARIAL: ['ANNUAL_RETURN_AGM'],
  NOMINEE_DIRECTOR: [
    'CORPORATE_TAX',
    'ANNUAL_RETURN_AGM',
    'GST',
    'EMPLOYER',
    'REGISTERS_AND_EVENTS',
    'OTHER_COMPANY_SPECIFIC',
  ],
};

export const MONITORING_PROFILE_LABELS: Record<MonitoringProfile, string> = {
  CORPORATE_TAX: 'Tax engagement',
  CORPORATE_SECRETARIAL: 'Corporate secretarial',
  NOMINEE_DIRECTOR: 'Nominee director',
};

export const MONITORING_PROFILE_HINTS: Record<MonitoringProfile, string> = {
  CORPORATE_TAX: 'ECI and the corporate income tax return',
  CORPORATE_SECRETARIAL: 'AGM and annual return',
  NOMINEE_DIRECTOR: 'All statutory obligations of the company',
};

export function obligationDefinition(code: string): ObligationDefinition | null {
  return OBLIGATION_CATALOG.find((definition) => definition.code === code) ?? null;
}

export function obligationDefinitionForRuleCode(ruleCode: string): ObligationDefinition | null {
  return OBLIGATION_CATALOG.find((definition) => definition.ruleCode === ruleCode) ?? null;
}

export function profileCoversObligation(profile: MonitoringProfile, obligation: ObligationDefinition): boolean {
  return PROFILE_FAMILIES[profile].includes(obligation.family);
}

/** The catalog entries monitored under any of the given profiles, in catalog order. */
export function obligationsForProfiles(profiles: Iterable<MonitoringProfile>): ObligationDefinition[] {
  const families = new Set<ObligationFamily>();
  for (const profile of profiles) {
    for (const family of PROFILE_FAMILIES[profile]) families.add(family);
  }
  return OBLIGATION_CATALOG.filter((definition) => families.has(definition.family));
}

export function isMonitoringProfile(value: unknown): value is MonitoringProfile {
  return typeof value === 'string' && (MONITORING_PROFILES as readonly string[]).includes(value);
}

/** True for ACRA obligations, which are labelled by financial year rather than YA. */
export function isAcraObligation(code: string): boolean {
  return obligationDefinition(code)?.authority === 'ACRA';
}

/**
 * The period badge for a company obligation: "FY 2026" (year of the FYE) for
 * ACRA filings, "YA 2027" for tax filings, or null when neither is known.
 */
export function obligationPeriodLabel(item: {
  obligationCode?: string | null;
  periodKey?: string | null;
  yearOfAssessment?: number | null;
}): string | null {
  const financialYear = /^FY(\d{4})-\d{2}-\d{2}$/.exec(item.periodKey ?? '');
  if (item.obligationCode && isAcraObligation(item.obligationCode) && financialYear) return `FY ${financialYear[1]}`;
  return item.yearOfAssessment ? `YA ${item.yearOfAssessment}` : null;
}
