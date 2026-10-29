import type { TieredPricing } from './tiered-pricing';
import type {
  BusinessCalendarSnapshot,
  DateOnly,
  ScheduleEntry,
} from '@/services/service-schedule';
import type {
  BillingOccurrenceSearch,
  BillingOccurrenceSearchInput,
  ResetBillingOverrideInput,
  UpdateBillingOccurrenceInput,
} from '@/lib/validations/billing';

export type BillingCadence = 'MONTHLY' | 'QUARTERLY' | 'SEMI_ANNUALLY' | 'ANNUALLY' | 'ONE_TIME' | 'CUSTOM';

export type BillingScheduleConfigV1 = {
  schemaVersion: 1;
  cadence: BillingCadence;
  startDate: DateOnly | null;
  customInterval: { unit: 'MONTH'; count: number } | null;
  scheduleEntries: ScheduleEntry[];
};

export type BillingScheduleIssueType =
  | 'MISSING_START_DATE'
  | 'INVALID_CUSTOM_SCHEDULE'
  | 'INVALID_BILLING_FREQUENCY';

export type LegacyBillingFrequency = BillingCadence;

export type LegacyBillingScheduleInput = {
  billingFrequency: LegacyBillingFrequency;
  billingStartDate: DateOnly | Date | string | null;
  customFrequencyLabel: string | null;
};

export type BillingScheduleConversion = {
  config: BillingScheduleConfigV1 | null;
  issueType: BillingScheduleIssueType | null;
};

export type EvaluatedBillingOccurrence = {
  feeLineId: string;
  billingPeriodKey: string;
  scheduleEntryKey: string;
  generationKey: string;
  calculatedExpectedDate: DateOnly;
  operativeExpectedDate: DateOnly;
  amount: string;
  currency: string;
  periodStart: DateOnly;
  periodEnd: DateOnly;
};

export type BillingScheduleEvaluationInput = {
  config: BillingScheduleConfigV1;
  feeLine: { id: string; amount: string; currency: string };
  calendar: BusinessCalendarSnapshot;
  from: DateOnly;
  to: DateOnly;
  generationKey: string;
};

export type BillingReconciliationWarning = {
  code: string;
  message: string;
  feeLineId?: string;
  permanent?: boolean;
};

export type BillingReconciliationPreservedCounts = {
  MANUAL_TRIGGER: number;
  HISTORICAL: number;
  BILLED: number;
  WAIVED: number;
  CANCELLED: number;
  OVERRIDDEN: number;
};

export type BillingReconciliationResult = {
  clientServiceId: string;
  created: number;
  recalculated: number;
  cancelled: number;
  preserved: number;
  preservedByReason: BillingReconciliationPreservedCounts;
  warnings: BillingReconciliationWarning[];
};

export type ReconcileClientServiceBillingInput = {
  tenantId: string;
  clientServiceId: string;
  today: DateOnly;
  horizonEnd: DateOnly;
  writeMode: 'OBSERVE' | 'APPLY';
  reconciliationRequestId: string;
  /**
   * On creation/activation, include capped historical backfill even when the
   * configured start date is before the rolling window. Ordinary reconciliation
   * must leave this unset.
   */
  includeHistoricalStart?: boolean;
  /** Optional human actor; automatic APPLY cancellations retain request provenance. */
  cancellationActorId?: string | null;
  assertLease?: () => Promise<void>;
};

export type BillingOccurrenceTiming = 'UPCOMING' | 'DUE' | 'OVERDUE';

export type BillingOccurrenceActor = {
  tenantId: string;
  userId?: string;
  /** Undefined means all-company access; an empty array means no access. */
  companyIds?: readonly string[];
};

export type BillingOccurrenceRecord = {
  id: string;
  tenantId: string;
  companyId: string;
  clientServiceId: string;
  feeLineId: string;
  billingPeriodKey: string;
  scheduleEntryKey: string;
  generationKey: string;
  calculatedExpectedDate: Date | string;
  operativeExpectedDate: Date | string;
  dateOverridden: boolean;
  dateOverrideReason: string | null;
  dateOverriddenAt: Date | string | null;
  dateOverriddenById: string | null;
  baseAmount: unknown;
  baseCurrency: string;
  operativeAmount: unknown;
  operativeCurrency: string;
  quantity?: unknown;
  valueOverridden: boolean;
  valueOverrideReason: string | null;
  valueOverriddenAt: Date | string | null;
  valueOverriddenById: string | null;
  status: 'OPEN' | 'BILLED' | 'WAIVED' | 'CANCELLED';
  billedDate: Date | string | null;
  markedBilledAt: Date | string | null;
  markedBilledById: string | null;
  externalReference: string | null;
  notes: string | null;
  waivedAt: Date | string | null;
  waivedById: string | null;
  waiverReason: string | null;
  cancelledAt: Date | string | null;
  cancelledById: string | null;
  cancellationReason: string | null;
  cancellationReconciliationRequestId: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  company?: {
    id?: string;
    tenantId?: string;
    name?: string;
    displayAlias?: string | null;
    uen?: string | null;
  } | null;
  clientService?: {
    id?: string;
    tenantId?: string;
    companyId?: string;
    serviceName?: string;
    familyName?: string;
    serviceVariant?: {
      id?: string;
      tenantId?: string;
      name?: string;
      family?: { id?: string; tenantId?: string; name?: string; displayColor?: string | null } | null;
    } | null;
  } | null;
  feeLine?: {
    id?: string;
    tenantId?: string;
    clientServiceId?: string;
    description?: string;
    amount?: unknown;
    currency?: string;
    tieredPricing?: unknown;
  } | null;
};

export type BillingOccurrenceDto = {
  id: string;
  tenantId: string;
  companyId: string;
  clientServiceId: string;
  feeLineId: string;
  billingPeriodKey: string;
  scheduleEntryKey: string;
  generationKey: string;
  calculatedExpectedDate: DateOnly;
  operativeExpectedDate: DateOnly;
  dateOverridden: boolean;
  dateOverrideReason: string | null;
  dateOverriddenAt: string | null;
  dateOverriddenById: string | null;
  baseAmount: string;
  baseCurrency: string;
  operativeAmount: string;
  operativeCurrency: string;
  /** Tiered postpaid entries: the quantity billed, null until entered. */
  quantity?: string | null;
  valueOverridden: boolean;
  valueOverrideReason: string | null;
  valueOverriddenAt: string | null;
  valueOverriddenById: string | null;
  status: BillingOccurrenceRecord['status'];
  timingState: BillingOccurrenceTiming | null;
  billedDate: DateOnly | null;
  markedBilledAt: string | null;
  markedBilledById: string | null;
  externalReference: string | null;
  notes: string | null;
  waivedAt: string | null;
  waivedById: string | null;
  waiverReason: string | null;
  cancelledAt: string | null;
  cancelledById: string | null;
  cancellationReason: string | null;
  cancellationReconciliationRequestId: string | null;
  createdAt: string;
  updatedAt: string;
  company: {
    id: string;
    name: string;
    displayAlias: string | null;
    displayLabel: string;
    uen: string | null;
  };
  family: { id: string | null; name: string; displayColor: string | null };
  service: { id: string; name: string; familyName: string; variantId: string | null; variantName: string | null };
  feeLine: { id: string; description: string; amount: string | null; currency: string | null; tieredPricing?: TieredPricing | null };
};

export type BillingOccurrenceListResult = {
  mode: 'TABLE';
  items: BillingOccurrenceDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

export type BillingOccurrenceSearchOptions = { today?: DateOnly };
export type BillingOccurrenceDb = {
  billingOccurrence: {
    findMany: (args: unknown) => Promise<unknown[]>;
    count: (args: unknown) => Promise<number>;
    findFirst: (args: unknown) => Promise<unknown | null>;
    updateMany: (args: unknown) => Promise<{ count: number }>;
  };
  $transaction?: <T>(fn: (tx: BillingOccurrenceDb) => Promise<T>, options?: unknown) => Promise<T>;
};

export type { BillingOccurrenceSearch, BillingOccurrenceSearchInput, ResetBillingOverrideInput, UpdateBillingOccurrenceInput };
