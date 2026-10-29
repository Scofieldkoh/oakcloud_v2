import type { Prisma } from '@/generated/prisma';
import type {
  ApplicabilityDefinition,
  ApplicabilityResult,
  BusinessCalendarSnapshot,
  CompanyPeriodFacts,
  CompanyRuleSource,
  DateOnly,
  MilestoneDefinition,
  ObligationPeriodBasis,
  PeriodReviewReason,
  RuleRecurrenceDefinition,
  ScheduleEntry,
} from '@/services/service-schedule';
import type { BillingCoverageResult, BillingReconciliationResult } from '@/services/billing';
import type { RollingPeriod } from './planner';

export type ScheduleReconciliationScopeType =
  | 'TENANT'
  | 'COMPANY'
  | 'CLIENT_SERVICE'
  | 'RULE'
  | 'BUSINESS_CALENDAR';

export type EnqueueScheduleReconciliationInput = {
  tenantId: string;
  scopeType: ScheduleReconciliationScopeType;
  scopeId: string;
  triggerType: string;
  correlationId: string;
  requestedById: string | null;
  notBefore?: Date;
};

export type ScheduleReconciliationRequestRef = {
  id: string;
  dedupeKey: string;
};

export type ScheduleReconciliationDb = Pick<
  Prisma.TransactionClient,
  'serviceScheduleReconciliationRequest'
>;

export type PreserveReason =
  | 'MANUAL_TRIGGER'
  | 'HISTORICAL'
  | 'COMPLETED'
  | 'WAIVED'
  | 'CANCELLED'
  | 'OVERRIDDEN';

export type DeadlineReconciliationAction =
  | 'CREATE'
  | 'RECALCULATE'
  | 'CANCEL'
  | 'PRESERVE'
  | 'NO_CHANGE';

export type DeadlineReconciliationPreservedCounts = {
  MANUAL_TRIGGER: number;
  HISTORICAL: number;
  COMPLETED: number;
  WAIVED: number;
  CANCELLED: number;
  OVERRIDDEN: number;
};

export type DeadlineReconciliationCounts = {
  created: number;
  recalculated: number;
  cancelled: number;
  preserved: number;
  noChange: number;
};

export type DeadlineReconciliationOperation = 'PUBLISH' | 'ARCHIVE';

export type DeadlineReconciliationWarning = {
  code: string;
  message: string;
  ruleId?: string;
  ruleVersionId?: string;
  missingFields?: string[];
  permanent?: boolean;
  excludedCycleCount?: number;
  oldestRetainedYear?: number;
};

export type DeadlineReconciliationResult = {
  tenantId: string;
  clientServiceId: string;
  reconciliationRequestId: string;
  writeMode: 'OBSERVE' | 'APPLY';
  counts: DeadlineReconciliationCounts;
  preservedByReason: DeadlineReconciliationPreservedCounts;
  warnings: DeadlineReconciliationWarning[];
};

export type ServiceScheduleReconciliationSummary = {
  deadlines: DeadlineReconciliationResult;
  billing: BillingReconciliationResult;
  coverage: BillingCoverageResult;
};

export type ReconcileClientServiceDeadlinesInput = {
  tenantId: string;
  clientServiceId: string;
  ruleId?: string;
  operation?: DeadlineReconciliationOperation;
  today: DateOnly;
  horizonEnd: DateOnly;
  writeMode: 'OBSERVE' | 'APPLY';
  reconciliationRequestId: string;
  assertLease?: () => Promise<void>;
  /**
   * The company obligation writer is live for this tenant. Statutory preset
   * rules of a monitored company are then left to it, so a service
   * association never creates a second copy of the same company obligation.
   */
  companyMonitoringEnabled?: boolean;
};

export type StoredDeadline = {
  id: string;
  cycleId: string;
  milestoneKey: string;
  scheduleEntryKey: string;
  deadlineType: string;
  calculatedDueDate: DateOnly;
  operativeDueDate: DateOnly;
  dateOverridden: boolean;
  status: string;
  origin: string;
  ruleVersionId: string;
};

export type EvaluatedDeadlineForDiff = {
  milestoneKey: string;
  scheduleEntryKey: string;
  deadlineType: 'STATUTORY' | 'CLIENT' | 'INTERNAL';
  dueDate: DateOnly;
  ruleVersionId: string;
  explanation?: string | string[];
};

export type ClassifyDeadlineChangeResult =
  | { action: 'CREATE' }
  | { action: 'RECALCULATE' }
  | { action: 'NO_CHANGE' }
  | { action: 'PRESERVE'; reason: PreserveReason };

export type DeadlineMaterializationPolicy =
  | 'ROLLING_HORIZON'
  | 'AUTHORITATIVE_ANNUAL_BACKLOG'
  /** Period-based statutory rules planned by financial period or YA. */
  | 'OBLIGATION_PERIOD';

export type ProjectedObligationPeriod = {
  basis: ObligationPeriodBasis;
  start: DateOnly;
  end: DateOnly;
  yearOfAssessment: number | null;
  provisional: boolean;
  reviewReasons: PeriodReviewReason[];
};

export type ProjectedDeadlineIdentity = {
  ruleId: string;
  ruleVersionId: string;
  periodKey: string;
  milestoneKey: string;
  scheduleEntryKey: string;
};

export type ProjectedDeadline = ProjectedDeadlineIdentity & {
  deadlineType: 'STATUTORY' | 'CLIENT' | 'INTERNAL';
  calculatedDueDate: DateOnly;
  explanation: string[];
  /** Present only for OBLIGATION_PERIOD rules. */
  obligationPeriod?: ProjectedObligationPeriod;
};

export type DeadlineRuleProjectionInput = {
  ruleId: string;
  ruleCode: string;
  ruleVersionId: string;
  recurrence: RuleRecurrenceDefinition;
  applicability: ApplicabilityDefinition;
  parameters: Record<string, unknown>;
  scheduleEntries: ScheduleEntry[];
  milestones: MilestoneDefinition[];
  company: CompanyRuleSource;
  calendar: BusinessCalendarSnapshot;
  today: DateOnly;
  horizonEnd: DateOnly;
  /** FYE preference, incorporation and confirmed periods for OBLIGATION_PERIOD rules. */
  periodFacts?: CompanyPeriodFacts;
  /**
   * Earliest due date an OBLIGATION_PERIOD rule may return. Defaults to today;
   * company monitoring passes its coverage start to include earlier filings.
   */
  windowStart?: DateOnly;
};

export type DeadlineRulePeriodEvaluation = {
  periodKey: string;
  sourceSnapshot: Record<string, unknown>;
  evaluationHash: string;
};

export type DeadlineRuleProjection = {
  materializationPolicy: DeadlineMaterializationPolicy;
  periods: RollingPeriod[];
  occurrences: ProjectedDeadline[];
  applicability: ApplicabilityResult;
  warnings: DeadlineReconciliationWarning[];
  periodEvaluations: DeadlineRulePeriodEvaluation[];
};

export type DeadlineOccurrenceRemediationInput = {
  tenantId: string;
  clientServiceIds: string[];
  today: DateOnly;
  horizonEnd: DateOnly;
  reason: string;
};

export type DeadlineOccurrenceRemediationAction =
  | { action: 'RECALCULATE'; occurrenceId: string; oldDate: DateOnly; newDate: DateOnly }
  | { action: 'CANCEL'; occurrenceId: string; oldDate: DateOnly; reason: string }
  | { action: 'CREATE'; identity: ProjectedDeadlineIdentity; newDate: DateOnly }
  | { action: 'PRESERVE'; occurrenceId: string; reason: PreserveReason | 'NOT_SELECTED' };

export type DeadlineOccurrenceRemediationCounts = Record<
  DeadlineOccurrenceRemediationAction['action'],
  number
>;

export type DeadlineOccurrenceRemediationPreview = {
  tenantId: string;
  clientServiceIds: string[];
  today: DateOnly;
  horizonEnd: DateOnly;
  fingerprint: string;
  counts: DeadlineOccurrenceRemediationCounts;
  actions: DeadlineOccurrenceRemediationAction[];
};

export type DeadlineOccurrenceRemediationApplyInput = DeadlineOccurrenceRemediationInput & {
  expectedFingerprint: string;
  actorId: string;
};

export type DeadlineOccurrenceRemediationApplyResult = {
  tenantId: string;
  fingerprint: string;
  results: Array<{
    clientServiceId: string;
    fingerprint: string;
    counts: DeadlineOccurrenceRemediationCounts;
  }>;
};
