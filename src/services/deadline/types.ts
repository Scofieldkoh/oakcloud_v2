import type {
  DeadlineSearch,
  DeadlineTimingBucket,
  ResetDeadlineDateOverrideInput,
  UpdateDeadlineOccurrenceInput,
} from '@/lib/validations/deadline';

export type {
  DeadlineSearch,
  DeadlineTimingBucket,
  ResetDeadlineDateOverrideInput,
  UpdateDeadlineOccurrenceInput,
};

/**
 * REVIEW marks a company obligation that was already due when monitoring took
 * it on: its filing status is unknown, so it is not described as overdue.
 */
export type DeadlineTiming = 'UPCOMING' | 'DUE' | 'OVERDUE' | 'REVIEW';

export interface DeadlineScope {
  tenantId: string;
  /** Undefined means all companies in the tenant; [] means no access. */
  companyIds?: string[];
}

export interface DeadlineActor {
  tenantId: string;
  userId: string;
  /** Optional accessible-company scope for record reads. Undefined means all. */
  companyIds?: string[];
}

export interface DeadlineCompanyDto {
  id: string;
  name: string;
  displayAlias: string | null;
  displayLabel: string;
  uen?: string | null;
}

export interface DeadlineFamilyDto {
  id: string | null;
  name: string;
  displayColor: string | null;
}

export interface DeadlineServiceDto {
  id: string;
  name: string;
  familyName: string;
  variantId: string | null;
  variantName: string | null;
}

/** Company statutory obligation details; null on service-owned rows. */
export interface DeadlineObligationDto {
  code: string;
  periodKey: string;
  financialPeriodStart: string | null;
  financialPeriodEnd: string | null;
  yearOfAssessment: number | null;
  periodProvisional: boolean;
  filingResponsibility: 'OAKCLOUD' | 'CLIENT' | 'EXTERNAL_PROVIDER' | 'UNCONFIRMED' | null;
  deliveryClientServiceId: string | null;
  coverageTiming: string | null;
  filingStatusUnconfirmed: boolean;
}

export interface DeadlineCycleDto {
  id: string;
  periodKey: string;
  periodStart: string;
  periodEnd: string;
}

export interface DeadlineAwarenessItem {
  id: string;
  kind: 'PRIOR_TAX_YA_CONFIRMATION' | 'NOMINEE_DIRECTOR_MONITORING';
  company: {
    id: string;
    name: string;
    displayAlias: string | null;
    uen: string | null;
  };
  dueDate: string;
  ruleCode: string;
  ruleName: string;
  milestoneName: string;
  coverageStatus: 'OUT_OF_SCOPE_REQUIRES_CONFIRMATION' | 'MONITORED_MANAGED' | 'MONITORING_ONLY';
  monitoringService: {
    id: string;
    name: string;
    familyName: string;
  };
  managedService: {
    id: string;
    name: string;
    familyName: string;
  } | null;
  assessmentYear: number | null;
  message: string;
}

export interface DeadlineOccurrenceDto {
  id: string;
  tenantId: string;
  companyId: string;
  /** SERVICE rows belong to a client service; COMPANY rows are company obligations. */
  ownershipScope: 'SERVICE' | 'COMPANY';
  clientServiceId: string | null;
  cycleId: string;
  ruleVersionId: string;
  milestoneKey: string;
  scheduleEntryKey: string;
  deadlineType: 'STATUTORY' | 'CLIENT' | 'INTERNAL';
  calculatedDueDate: string;
  operativeDueDate: string;
  dueDate: string;
  dateOverridden: boolean;
  dateOverride: string | null;
  dateOverrideReason: string | null;
  dateOverriddenById: string | null;
  dateOverriddenAt: string | null;
  status: 'OPEN' | 'COMPLETED' | 'WAIVED' | 'CANCELLED';
  /**
   * Set only in the response to filing a company obligation: services whose
   * postpaid fee won't bill because the YA is before their engagement start.
   */
  postpaidEngagementStartConflicts?: Array<{
    clientServiceId: string;
    serviceName: string;
    engagementStartYearOfAssessment: number;
  }>;
  timingState: DeadlineTiming | null;
  /** Open deadlines only: overdue, due today, or how many months away. */
  timingBucket: DeadlineTimingBucket | null;
  completedAt: string | null;
  completedById: string | null;
  waivedAt: string | null;
  waivedById: string | null;
  waiverReason: string | null;
  cancelledAt: string | null;
  cancelledById: string | null;
  cancellationReason: string | null;
  notes: string | null;
  origin: 'RULE' | 'MANUAL_TRIGGER';
  createdAt: string;
  updatedAt: string;
  company: DeadlineCompanyDto;
  family: DeadlineFamilyDto;
  /**
   * The service a deadline belongs to. Company obligations show the service
   * that files or monitors them, or null when no service covers them.
   */
  service: DeadlineServiceDto | null;
  obligation: DeadlineObligationDto | null;
  cycle: DeadlineCycleDto | null;
}

export interface DeadlineTableResult {
  mode: 'TABLE';
  awarenessItems: DeadlineAwarenessItem[];
  items: DeadlineOccurrenceDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface DeadlineCalendarResult {
  mode: 'CALENDAR';
  awarenessItems: DeadlineAwarenessItem[];
  items: DeadlineOccurrenceDto[];
  truncated: boolean;
  warning?: string;
}

export type DeadlineListResult = DeadlineTableResult | DeadlineCalendarResult;

export interface DeadlineDb {
  deadlineOccurrence: {
    findMany: (args: unknown) => Promise<unknown[]>;
    count: (args: unknown) => Promise<number>;
    findFirst: (args: unknown) => Promise<unknown | null>;
    updateMany: (args: unknown) => Promise<{ count: number }>;
  };
  $transaction?: <T>(callback: (tx: DeadlineDb) => Promise<T>) => Promise<T>;
}

export interface ListDeadlinesOptions {
  /** Injectable Singapore date for deterministic service and route tests. */
  today?: `${number}-${number}-${number}`;
}
