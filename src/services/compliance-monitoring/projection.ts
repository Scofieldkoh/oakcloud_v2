import { projectDeadlineRule } from '@/services/schedule-reconciliation/projection';
import type { ProjectedObligationPeriod } from '@/services/schedule-reconciliation/types';
import {
  addMonthsClamped,
  compareDateOnly,
  parseDateOnly,
} from '@/services/service-schedule/date-only';
import type {
  ApplicabilityDefinition,
  BusinessCalendarSnapshot,
  CompanyPeriodFacts,
  CompanyRuleSource,
  DateOnly,
  MilestoneDefinition,
  RuleRecurrenceDefinition,
} from '@/services/service-schedule';
import {
  obligationsForProfiles,
  profileCoversObligation,
  type MonitoringProfile,
  type ObligationDefinition,
} from './catalog';

/**
 * Pure company-obligation projection shared by preview and the monitoring
 * writer. It decides which statutory obligations exist for one company,
 * why Oakcloud tracks each one, and who is expected to file it. It never
 * reads or writes the database and has no billing side effects.
 */

/** Forward visibility for company statutory monitoring. */
export const COMPANY_MONITORING_HORIZON_MONTHS = 24;
/** How far before monitoring starts earlier filings enter takeover review. */
export const TAKEOVER_REVIEW_LOOKBACK_MONTHS = 12;

export type CoverageInput = {
  id: string;
  profile: MonitoringProfile;
  monitoringStart: DateOnly;
  /** Inclusive explicit end/handover date; null while monitoring continues. */
  monitoringEnd: DateOnly | null;
  /** The service that started this coverage. */
  clientServiceId?: string | null;
  /**
   * First Year of Assessment that service files. Obligations from this YA are
   * projected as filed by Oakcloud; earlier ones stay unconfirmed.
   */
  engagementStartYearOfAssessment?: number | null;
};

export type DeliveryScopeInput = {
  id: string;
  clientServiceId: string;
  obligationCode: string;
  periodKey: string;
  confirmation: 'CONFIRMED' | 'UNCONFIRMED';
  /** False once the delivery service ended or was deleted. */
  serviceActive: boolean;
};

export type PublishedRuleInput = {
  ruleId: string;
  ruleCode: string;
  ruleVersionId: string;
  recurrence: RuleRecurrenceDefinition;
  applicability: ApplicabilityDefinition;
  milestones: MilestoneDefinition[];
};

export type CompanyMonitoringProjectionInput = {
  companyId: string;
  today: DateOnly;
  company: CompanyRuleSource;
  isGstRegistered: boolean;
  periodFacts: CompanyPeriodFacts;
  coverages: CoverageInput[];
  deliveryScopes: DeliveryScopeInput[];
  /** Published rule per tenant rule code (SG_ECI, SG_FORM_C, SG_AGM_DUE, SG_ANNUAL_RETURN). */
  rulesByCode: Record<string, PublishedRuleInput | undefined>;
  calendar: BusinessCalendarSnapshot;
};

export type InclusionReason =
  | { kind: 'MONITORING_INTERVAL'; coverageId: string }
  | { kind: 'CONTRACTED_DELIVERY'; deliveryScopeId: string; clientServiceId: string }
  | { kind: 'TAKEOVER_REVIEW'; coverageId: string };

export type CoverageTiming = 'DURING' | 'BEFORE_START' | 'AFTER_END' | 'NO_COVERAGE';

export type FilingResponsibility = 'OAKCLOUD' | 'CLIENT' | 'EXTERNAL_PROVIDER' | 'UNCONFIRMED';

export type ProjectedCompanyObligation = {
  obligationCode: string;
  obligationName: string;
  periodKey: string;
  milestoneKey: string;
  scheduleEntryKey: string;
  deadlineType: 'STATUTORY' | 'CLIENT' | 'INTERNAL';
  ruleId: string;
  ruleVersionId: string;
  dueDate: DateOnly;
  explanation: string[];
  obligationPeriod: ProjectedObligationPeriod;
  /** Evaluator snapshot and hash for the obligation's period (cycle provenance). */
  sourceSnapshot: Record<string, unknown>;
  evaluationHash: string;
  reasons: InclusionReason[];
  coverageTiming: CoverageTiming;
  filingResponsibility: FilingResponsibility;
  /** The Oakcloud service contracted to file it (confirmed or proposed). */
  deliveryClientServiceId: string | null;
  /** Due before today: filing status is unknown until evidence is recorded. */
  filingStatusUnconfirmed: boolean;
};

export type CompanyReviewIssueType =
  | 'MISSING_FINANCIAL_YEAR_END'
  | 'PERIOD_REVIEW'
  | 'RULE_NOT_PUBLISHED'
  | 'RULE_INPUT_MISSING'
  | 'FAMILY_NOT_AUTOMATED'
  | 'RESPONSIBILITY_CONFLICT'
  | 'DELIVERY_ENDED'
  | 'DELIVERY_SCOPE_UNMATCHED';

export type CompanyReviewIssue = {
  type: CompanyReviewIssueType;
  dedupeKey: string;
  message: string;
  obligationCode: string | null;
  periodKey: string | null;
  coverageId: string | null;
};

export type CompanyMonitoringProjection = {
  companyId: string;
  today: DateOnly;
  horizonEnd: DateOnly;
  obligations: ProjectedCompanyObligation[];
  issues: CompanyReviewIssue[];
  /** False while any applicable obligation, date or family is unreviewed. */
  fullyCovered: boolean;
};

function maxDate(left: DateOnly, right: DateOnly): DateOnly {
  return compareDateOnly(left, right) >= 0 ? left : right;
}

function minDate(left: DateOnly, right: DateOnly): DateOnly {
  return compareDateOnly(left, right) <= 0 ? left : right;
}

function withinCoverage(date: DateOnly, coverage: CoverageInput): boolean {
  return compareDateOnly(date, coverage.monitoringStart) >= 0
    && (coverage.monitoringEnd === null || compareDateOnly(date, coverage.monitoringEnd) <= 0);
}

/** Latest due date a contracted period can plausibly have, for horizon sizing. */
function contractedHorizon(periodKey: string): DateOnly | null {
  const assessment = /^YA(\d{4})$/.exec(periodKey);
  if (assessment) return `${assessment[1]}-12-31` as DateOnly;
  const financial = /^FY(\d{4}-\d{2}-\d{2})$/.exec(periodKey);
  if (financial) {
    try {
      return addMonthsClamped(financial[1] as DateOnly, 24);
    } catch {
      return null;
    }
  }
  return null;
}

function issue(
  type: CompanyReviewIssueType,
  message: string,
  scope: { obligationCode?: string | null; periodKey?: string | null; coverageId?: string | null; key?: string } = {},
): CompanyReviewIssue {
  const obligationCode = scope.obligationCode ?? null;
  const periodKey = scope.periodKey ?? null;
  const coverageId = scope.coverageId ?? null;
  return {
    type,
    dedupeKey: [type, obligationCode ?? '', periodKey ?? '', scope.key ?? ''].join('|'),
    message,
    obligationCode,
    periodKey,
    coverageId,
  };
}

const PERIOD_REVIEW_MESSAGES: Record<string, string> = {
  FIRST_FINANCIAL_PERIOD_UNCONFIRMED: 'Confirm the first financial year end after incorporation.',
  FINANCIAL_PERIOD_GAP_AFTER_FYE_CHANGE: 'The financial year end changed. Confirm the period between the old and new year ends.',
  YEAR_OF_ASSESSMENT_UNCONFIRMED: 'Confirm the Year of Assessment for this period.',
  MULTIPLE_YEARS_OF_ASSESSMENT: 'This financial period spans more than one Year of Assessment. Confirm the filing dates.',
};

function applicableObligations(
  profiles: Set<MonitoringProfile>,
  isGstRegistered: boolean,
): ObligationDefinition[] {
  return obligationsForProfiles(profiles).filter((definition) => (
    definition.applicability === 'ALWAYS'
    || (definition.applicability === 'GST_REGISTERED' && isGstRegistered)
  ));
}

function resolveResponsibility(
  scopes: DeliveryScopeInput[],
  obligationCode: string,
  periodKey: string,
  dueDate: DateOnly,
  today: DateOnly,
  issues: CompanyReviewIssue[],
  engagedCoverage: CoverageInput | null = null,
): { responsibility: FilingResponsibility; deliveryClientServiceId: string | null } {
  const active = scopes.filter((scope) => scope.serviceActive);
  const confirmedServices = [...new Set(active
    .filter((scope) => scope.confirmation === 'CONFIRMED')
    .map((scope) => scope.clientServiceId))];
  if (confirmedServices.length > 1) {
    // Never pick one silently or infer the filer from monitoring precedence.
    issues.push(issue(
      'RESPONSIBILITY_CONFLICT',
      'More than one service is contracted to file this obligation. Confirm which one files it.',
      { obligationCode, periodKey },
    ));
    return { responsibility: 'UNCONFIRMED', deliveryClientServiceId: null };
  }
  if (confirmedServices.length === 1) {
    return { responsibility: 'OAKCLOUD', deliveryClientServiceId: confirmedServices[0]! };
  }
  if (engagedCoverage) {
    return { responsibility: 'OAKCLOUD', deliveryClientServiceId: engagedCoverage.clientServiceId ?? null };
  }
  const ended = scopes.filter((scope) => !scope.serviceActive);
  if (ended.length > 0 && active.length === 0 && compareDateOnly(dueDate, today) >= 0) {
    issues.push(issue(
      'DELIVERY_ENDED',
      'The service contracted to file this obligation has ended. Confirm who files it now.',
      { obligationCode, periodKey },
    ));
  }
  const proposed = active[0]?.clientServiceId ?? null;
  return { responsibility: 'UNCONFIRMED', deliveryClientServiceId: proposed };
}

/**
 * Project every monitored obligation for one company. Inclusion follows the
 * plan: a candidate is kept when its due date falls inside a monitoring
 * interval (inclusive, within the 24-month forward horizon), when a delivery
 * scope contracts it, or when it fell due in the year before monitoring
 * started (takeover review). Each kept row lists every reason.
 */
export function projectCompanyObligations(input: CompanyMonitoringProjectionInput): CompanyMonitoringProjection {
  parseDateOnly(input.today);
  const issues: CompanyReviewIssue[] = [];
  const obligations: ProjectedCompanyObligation[] = [];
  const forwardHorizon = addMonthsClamped(input.today, COMPANY_MONITORING_HORIZON_MONTHS);

  const coverages = input.coverages.filter((coverage) => (
    coverage.monitoringEnd === null || compareDateOnly(coverage.monitoringStart, coverage.monitoringEnd) <= 0
  ));
  const profiles = new Set(coverages.map((coverage) => coverage.profile));
  const scopedCodes = new Set(input.deliveryScopes.map((scope) => scope.obligationCode));
  const definitions = applicableObligations(profiles, input.isGstRegistered);
  // Contracted filings are tracked even without a monitoring profile.
  for (const code of scopedCodes) {
    if (definitions.some((definition) => definition.code === code)) continue;
    const contracted = obligationsForProfiles(['NOMINEE_DIRECTOR']).find((definition) => definition.code === code);
    if (contracted) definitions.push(contracted);
  }

  if (coverages.length === 0 && input.deliveryScopes.length === 0) {
    return { companyId: input.companyId, today: input.today, horizonEnd: forwardHorizon, obligations, issues, fullyCovered: true };
  }

  const earliestStart = coverages.reduce<DateOnly | null>(
    (earliest, coverage) => (earliest === null ? coverage.monitoringStart : minDate(earliest, coverage.monitoringStart)),
    null,
  );
  // An engagement start YA reaches back past the takeover lookback: every
  // filing from that YA is ours, so evaluate from two years before it.
  const engagementYears = coverages.flatMap((coverage) => (
    typeof coverage.engagementStartYearOfAssessment === 'number' ? [coverage.engagementStartYearOfAssessment] : []
  ));
  const lookbackStart = addMonthsClamped(
    minDate(earliestStart ?? input.today, input.today),
    -TAKEOVER_REVIEW_LOOKBACK_MONTHS,
  );
  const windowStart = engagementYears.length > 0
    ? minDate(lookbackStart, `${Math.min(...engagementYears) - 2}-01-01` as DateOnly)
    : lookbackStart;
  let projectionHorizon = forwardHorizon;
  for (const scope of input.deliveryScopes) {
    const contractedEnd = contractedHorizon(scope.periodKey);
    if (contractedEnd) projectionHorizon = maxDate(projectionHorizon, contractedEnd);
  }

  let missingFye = false;
  const reviewedPeriods = new Set<string>();
  const matchedScopeIds = new Set<string>();

  for (const definition of definitions) {
    const relevantCoverages = coverages.filter((coverage) => profileCoversObligation(coverage.profile, definition));
    if (definition.automation !== 'PRESET_RULE' || !definition.ruleCode) {
      for (const coverage of relevantCoverages) {
        issues.push(issue(
          'FAMILY_NOT_AUTOMATED',
          `${definition.displayName}: ${definition.reviewAction ?? 'Review this obligation family.'}`,
          { obligationCode: definition.code, coverageId: coverage.id, key: coverage.id },
        ));
      }
      continue;
    }

    const rule = input.rulesByCode[definition.ruleCode];
    if (!rule) {
      issues.push(issue(
        'RULE_NOT_PUBLISHED',
        `${definition.displayName} is monitored but its ${definition.ruleCode} rule is not published yet.`,
        { obligationCode: definition.code },
      ));
      continue;
    }

    const projection = projectDeadlineRule({
      ruleId: rule.ruleId,
      ruleCode: rule.ruleCode,
      ruleVersionId: rule.ruleVersionId,
      recurrence: rule.recurrence,
      applicability: rule.applicability,
      parameters: {},
      scheduleEntries: [],
      milestones: rule.milestones,
      company: input.company,
      periodFacts: input.periodFacts,
      calendar: input.calendar,
      today: minDate(windowStart, input.today),
      windowStart,
      horizonEnd: projectionHorizon,
    });

    if (projection.materializationPolicy !== 'OBLIGATION_PERIOD') {
      issues.push(issue(
        'RULE_NOT_PUBLISHED',
        `${definition.displayName} needs the reviewed period-based preset published before it can be monitored.`,
        { obligationCode: definition.code },
      ));
      continue;
    }
    if (projection.applicability.state === 'MISSING_INPUT') {
      if ((projection.applicability.missingFields ?? []).includes('financialYearEnd')) missingFye = true;
      else {
        issues.push(issue(
          'RULE_INPUT_MISSING',
          `${definition.displayName}: ${projection.applicability.reason}`,
          { obligationCode: definition.code },
        ));
      }
      continue;
    }
    for (const warning of projection.warnings) {
      if (warning.code !== 'MISSING_INPUT') continue;
      issues.push(issue('RULE_INPUT_MISSING', `${definition.displayName}: ${warning.message}`, {
        obligationCode: definition.code,
        key: warning.message,
      }));
    }

    const evaluations = new Map(projection.periodEvaluations.map((evaluation) => [evaluation.periodKey, evaluation]));
    for (const occurrence of projection.occurrences) {
      const period = occurrence.obligationPeriod;
      if (!period) continue;
      const dueDate = occurrence.calculatedDueDate;
      const reasons: InclusionReason[] = [];
      for (const coverage of relevantCoverages) {
        if (withinCoverage(dueDate, coverage) && compareDateOnly(dueDate, forwardHorizon) <= 0) {
          reasons.push({ kind: 'MONITORING_INTERVAL', coverageId: coverage.id });
        }
      }
      const scopes = input.deliveryScopes.filter((scope) => (
        scope.obligationCode === definition.code && scope.periodKey === occurrence.periodKey
      ));
      for (const scope of scopes) {
        matchedScopeIds.add(scope.id);
        reasons.push({ kind: 'CONTRACTED_DELIVERY', deliveryScopeId: scope.id, clientServiceId: scope.clientServiceId });
      }
      const yearOfAssessment = period.yearOfAssessment;
      const engagedCoverage = yearOfAssessment === null ? null : relevantCoverages.find((coverage) => (
        typeof coverage.engagementStartYearOfAssessment === 'number'
        && yearOfAssessment >= coverage.engagementStartYearOfAssessment
        && (coverage.monitoringEnd === null || compareDateOnly(dueDate, coverage.monitoringEnd) <= 0)
      )) ?? null;
      // A tax return from the engagement start YA that fell due before the
      // service started is engaged work, not takeover review. ECI does not
      // reach back; only its takeover window applies.
      const engagedBeforeStart = definition.engagementReachBack !== false
        && engagedCoverage !== null
        && compareDateOnly(dueDate, engagedCoverage.monitoringStart) < 0;
      if (engagedBeforeStart) reasons.push({ kind: 'MONITORING_INTERVAL', coverageId: engagedCoverage.id });
      const inAnyCoverage = engagedBeforeStart || relevantCoverages.some((coverage) => withinCoverage(dueDate, coverage));
      if (!inAnyCoverage) {
        // Earlier filings due shortly before monitoring started (12 months,
        // or 3 for ECI) go to takeover review rather than being described as
        // due during coverage.
        const lookbackMonths = definition.takeoverReviewMonths ?? TAKEOVER_REVIEW_LOOKBACK_MONTHS;
        const takeover = relevantCoverages
          .filter((coverage) => compareDateOnly(dueDate, coverage.monitoringStart) < 0
            && compareDateOnly(dueDate, addMonthsClamped(coverage.monitoringStart, -lookbackMonths)) >= 0)
          .sort((left, right) => compareDateOnly(left.monitoringStart, right.monitoringStart))[0];
        if (takeover) reasons.push({ kind: 'TAKEOVER_REVIEW', coverageId: takeover.id });
      }
      if (reasons.length === 0) continue;

      const coverageTiming: CoverageTiming = inAnyCoverage
        ? 'DURING'
        : relevantCoverages.some((coverage) => compareDateOnly(dueDate, coverage.monitoringStart) < 0)
          ? 'BEFORE_START'
          : relevantCoverages.length > 0 ? 'AFTER_END' : 'NO_COVERAGE';
      const { responsibility, deliveryClientServiceId } = resolveResponsibility(
        scopes,
        definition.code,
        occurrence.periodKey,
        dueDate,
        input.today,
        issues,
        engagedCoverage,
      );

      if (period.provisional && !reviewedPeriods.has(occurrence.periodKey)) {
        reviewedPeriods.add(occurrence.periodKey);
        for (const reason of period.reviewReasons) {
          issues.push(issue('PERIOD_REVIEW', PERIOD_REVIEW_MESSAGES[reason] ?? 'Confirm this financial period.', {
            periodKey: occurrence.periodKey,
            key: reason,
          }));
        }
      }

      obligations.push({
        obligationCode: definition.code,
        obligationName: definition.displayName,
        periodKey: occurrence.periodKey,
        milestoneKey: occurrence.milestoneKey,
        scheduleEntryKey: occurrence.scheduleEntryKey,
        deadlineType: occurrence.deadlineType,
        ruleId: rule.ruleId,
        ruleVersionId: rule.ruleVersionId,
        dueDate,
        explanation: occurrence.explanation,
        obligationPeriod: period,
        sourceSnapshot: evaluations.get(occurrence.periodKey)?.sourceSnapshot ?? {},
        evaluationHash: evaluations.get(occurrence.periodKey)?.evaluationHash ?? '',
        reasons,
        coverageTiming,
        filingResponsibility: responsibility,
        deliveryClientServiceId,
        filingStatusUnconfirmed: compareDateOnly(dueDate, input.today) < 0,
      });
    }
  }

  if (missingFye) {
    issues.push(issue(
      'MISSING_FINANCIAL_YEAR_END',
      'Record the financial year end (or a confirmed financial period) so statutory deadlines can be calculated.',
    ));
  }
  for (const scope of input.deliveryScopes) {
    // Without an FYE nothing can match; the FYE issue already says why.
    if (missingFye || matchedScopeIds.has(scope.id)) continue;
    if (!input.rulesByCode[scope.obligationCode] && scope.obligationCode.startsWith('SG_')) continue;
    issues.push(issue(
      'DELIVERY_SCOPE_UNMATCHED',
      `Contracted period ${scope.periodKey} for ${scope.obligationCode} does not match a known financial period. Confirm the period.`,
      { obligationCode: scope.obligationCode, periodKey: scope.periodKey, key: scope.id },
    ));
  }

  const uniqueIssues = [...new Map(issues.map((entry) => [entry.dedupeKey, entry])).values()];
  obligations.sort((left, right) => (
    left.dueDate.localeCompare(right.dueDate)
    || left.obligationCode.localeCompare(right.obligationCode)
    || left.periodKey.localeCompare(right.periodKey)
  ));
  return {
    companyId: input.companyId,
    today: input.today,
    horizonEnd: forwardHorizon,
    obligations,
    issues: uniqueIssues,
    fullyCovered: uniqueIssues.length === 0,
  };
}
