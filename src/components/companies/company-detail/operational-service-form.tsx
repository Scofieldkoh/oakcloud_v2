'use client';

import { useState, type Dispatch, type ReactNode, type SelectHTMLAttributes, type SetStateAction } from 'react';
import { AlertCircle, Calendar, CheckCircle2, ChevronDown, ChevronRight, Clock, HelpCircle } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { FormInput } from '@/components/ui/form-input';
import { SingleDateInput } from '@/components/ui/single-date-input';
import { Toggle } from '@/components/ui/toggle';
import { Tooltip } from '@/components/ui/tooltip';
import { ScheduleEntryEditor } from '@/components/services/shared/schedule-entry-editor';
import { BillingTimingFields } from '@/components/services/shared/billing-timing-fields';
import { filingBeforeEngagementStart, POSTPAID_TRIGGER_LABELS } from '@/services/billing/postpaid-triggers';
import { tieredPricingSummary } from '@/services/billing/tiered-pricing';
import { TieredPricingFields } from '@/components/services/shared/tiered-pricing-fields';
import { cn } from '@/lib/utils';
import type { ScheduleEntryInput } from '@/lib/validations/service-schedule';
import { currentDateInSingapore } from '@/services/service-schedule';
import type { ClientServiceOpenBillingOccurrenceDto, ClientServiceOpenDeadlineOccurrenceDto, ClientServiceProjectedDeadlineDto } from '@/services/client-service';
import type { OperationalServiceValues, DeadlinePreviewState } from './client-service-form-state';
import type { BillingScheduleConfigV1 } from '@/services/billing/types';
import { canonicalizeBillingSchedule } from '@/services/billing/schedule';
import { MONITORING_PROFILE_HINTS, MONITORING_PROFILE_LABELS, obligationPeriodLabel, type MonitoringProfile } from '@/services/compliance-monitoring/catalog';
import type { CompanyObligationPreviewItem } from '@/services/compliance-monitoring/writer';
import { COMPANY_OBLIGATION_STATUSES, COMPANY_OBLIGATION_STATUS_LABELS, type CompanyObligationStatus } from '@/services/compliance-monitoring/obligation-status-labels';

const uuid = () => crypto.randomUUID();

export const CADENCE_OPTIONS: Array<{ value: OperationalServiceValues['serviceCadence']; label: string }> = [
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'QUARTERLY', label: 'Quarterly' },
  { value: 'SEMI_ANNUALLY', label: 'Semi-annually' },
  { value: 'ANNUALLY', label: 'Annually' },
  { value: 'ONE_TIME', label: 'One-time' },
  { value: 'AD_HOC', label: 'Ad-hoc' },
  { value: 'CUSTOM', label: 'Custom' },
];

export const FEE_FREQUENCY_OPTIONS: Array<{ value: OperationalServiceValues['fees'][number]['billingFrequency']; label: string }> = [
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'QUARTERLY', label: 'Quarterly' },
  { value: 'SEMI_ANNUALLY', label: 'Semi-annually' },
  { value: 'ANNUALLY', label: 'Annually' },
  { value: 'ONE_TIME', label: 'One-time' },
  { value: 'CUSTOM', label: 'Custom' },
];

const BILLING_INTERVALS: Record<string, number | null> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  SEMI_ANNUALLY: 6,
  ANNUALLY: 12,
  ONE_TIME: null,
  CUSTOM: null,
};

function formatProjectedDate(dateOnly: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOnly);
  if (!match) return dateOnly;
  const [, year, month, day] = match;
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthName = monthNames[Number(month) - 1] ?? month;
  return `${Number(day)} ${monthName} ${year}`;
}

export interface ProjectedBillingItem {
  key: string;
  feeUiId: string;
  description: string;
  amount: string;
  currency: string;
  frequency: string;
  billingDate: string;
  isoDate: string;
  timingExplanation: string;
  /** Shown in place of the amount, e.g. for a fee priced by quantity. */
  amountLabel?: string;
}

interface DeadlineDisplayItem {
  key: string;
  ruleId: string;
  periodKey: string;
  milestoneKey: string;
  scheduleEntryKey: string;
  milestoneName: string;
  ruleName: string;
  calculatedDueDate: string;
  explanation: string;
  isAuthoritativeBacklog: boolean;
}

function billingFrequencyLabel(frequency: ClientServiceOpenBillingOccurrenceDto['billingFrequency'], customFrequencyLabel: string | null): string {
  return customFrequencyLabel?.trim()
    || FEE_FREQUENCY_OPTIONS.find((option) => option.value === frequency)?.label
    || frequency;
}

function BillingPreviewPanel({ items, readOnly = false }: { items: ProjectedBillingItem[]; readOnly?: boolean }) {
  return (
    <div className="space-y-3 rounded-xl border border-blue-200/80 bg-blue-50/50 p-4 shadow-sm dark:border-blue-900/40 dark:bg-blue-950/20">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-blue-700 dark:text-blue-400" />
          <h4 className="text-sm font-semibold text-text-primary">{readOnly ? 'Open billing items' : 'Billing Preview'}</h4>
        </div>
        <span className="rounded-full border border-blue-200 bg-blue-100/80 px-2.5 py-0.5 text-xs font-semibold text-blue-800 dark:border-blue-800 dark:bg-blue-900/40 dark:text-blue-300">
          {items.length} {readOnly ? `open billing item${items.length === 1 ? '' : 's'}` : `billing item${items.length === 1 ? '' : 's'}`}
        </span>
      </div>
      <p className="text-xs text-text-secondary">
        {readOnly ? 'All billing occurrences currently open for this service:' : 'Projected billing occurrences and schedule cycles:'}
      </p>
      {items.length === 0 ? (
        <p className="text-xs text-text-muted italic">{readOnly ? 'No open billing items for this service.' : 'No active fee schedules configured to preview.'}</p>
      ) : (
        <div className="divide-y divide-blue-100/80 rounded-lg border border-blue-200/70 overflow-hidden bg-background-primary/80 dark:divide-blue-900/30 dark:border-blue-900/40 dark:bg-background-secondary/60">
          {items.map((item) => (
            <div key={item.key} className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 hover:bg-blue-50/70 dark:hover:bg-blue-950/40 transition-colors">
              <div className="flex flex-col min-w-[180px] flex-1">
                <span className="font-semibold text-xs text-text-primary">{item.description}</span>
                <span className="text-[11px] text-text-muted">{item.timingExplanation} · {item.amountLabel ?? `${item.currency} ${item.amount}`}</span>
              </div>
              <div className="flex items-center gap-2.5">
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-2.5 py-1 text-xs font-semibold text-blue-800 dark:border-blue-800 dark:bg-background-elevated dark:text-blue-300 shadow-2xs">
                  <Clock className="h-3 w-3 text-blue-600 dark:text-blue-400" />
                  {item.billingDate}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                  <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                  {item.frequency}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function calculateActualBillingPreview(
  fees: OperationalServiceValues['fees'],
  serviceStartDate: string,
): ProjectedBillingItem[] {
  const start = serviceStartDate ? new Date(serviceStartDate) : new Date();
  const startYear = !Number.isNaN(start.getFullYear()) ? start.getFullYear() : 2026;
  const startMonth = !Number.isNaN(start.getMonth()) ? start.getMonth() : 7;
  const startDay = !Number.isNaN(start.getDate()) ? start.getDate() : 1;

  const results: ProjectedBillingItem[] = [];

  for (const [idx, fee] of fees.entries()) {
    if (!fee.description.trim() && Number(fee.amount) <= 0 && !fee.billingStartDate) continue;

    const feeStartStr = fee.billingStartDate || serviceStartDate || '';
    const feeStart = feeStartStr ? new Date(feeStartStr) : new Date(startYear, startMonth, startDay);
    const fYear = !Number.isNaN(feeStart.getFullYear()) ? feeStart.getFullYear() : startYear;
    const fMonth = !Number.isNaN(feeStart.getMonth()) ? feeStart.getMonth() : startMonth;
    const fDay = !Number.isNaN(feeStart.getDate()) ? feeStart.getDate() : startDay;

    if (fee.billingTiming === 'POSTPAID') {
      results.push({
        key: `${fee.uiId}-postpaid`,
        feeUiId: fee.uiId,
        description: fee.description.trim() || `Fee ${idx + 1}`,
        amount: fee.amount.trim() || '0.00',
        currency: fee.currency || 'SGD',
        frequency: 'Postpaid',
        billingDate: 'When filed',
        isoDate: '',
        timingExplanation: fee.postpaidTrigger
          ? `Once per YA · ${POSTPAID_TRIGGER_LABELS[fee.postpaidTrigger]}`
          : 'Choose the filing it bills on',
        ...(fee.tieredPricing ? { amountLabel: tieredPricingSummary(fee.tieredPricing) } : {}),
      });
      continue;
    }

    const freq = fee.billingFrequency || 'ONE_TIME';
    const freqLabel = FEE_FREQUENCY_OPTIONS.find((o) => o.value === freq)?.label ?? freq;
    const desc = fee.description.trim() || `Fee ${idx + 1}`;
    const amt = fee.amount.trim() || '0.00';
    const curr = fee.currency || 'SGD';

    if (freq === 'MONTHLY') {
      // Show next 12 monthly occurrences
      for (let i = 0; i < 12; i++) {
        const occDate = new Date(fYear, fMonth + i, fDay);
        const formatted = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(occDate);
        const iso = occDate.toISOString().slice(0, 10);
        results.push({
          key: `${fee.uiId}-occ-${i}`,
          feeUiId: fee.uiId,
          description: desc,
          amount: amt,
          currency: curr,
          frequency: 'Monthly',
          billingDate: formatted,
          isoDate: iso,
          timingExplanation: `Month ${i + 1} of 12`,
        });
      }
    } else if (freq === 'QUARTERLY') {
      // Show 4 quarterly occurrences
      for (let i = 0; i < 4; i++) {
        const occDate = new Date(fYear, fMonth + i * 3, fDay);
        const formatted = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(occDate);
        const iso = occDate.toISOString().slice(0, 10);
        results.push({
          key: `${fee.uiId}-occ-${i}`,
          feeUiId: fee.uiId,
          description: desc,
          amount: amt,
          currency: curr,
          frequency: 'Quarterly',
          billingDate: formatted,
          isoDate: iso,
          timingExplanation: `Quarter ${i + 1} of 4`,
        });
      }
    } else if (freq === 'SEMI_ANNUALLY') {
      // Show 2 semi-annual occurrences
      for (let i = 0; i < 2; i++) {
        const occDate = new Date(fYear, fMonth + i * 6, fDay);
        const formatted = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(occDate);
        const iso = occDate.toISOString().slice(0, 10);
        results.push({
          key: `${fee.uiId}-occ-${i}`,
          feeUiId: fee.uiId,
          description: desc,
          amount: amt,
          currency: curr,
          frequency: 'Semi-annually',
          billingDate: formatted,
          isoDate: iso,
          timingExplanation: `Semi-annual #${i + 1}`,
        });
      }
    } else if (freq === 'ANNUALLY') {
      // Show 2 annual occurrences
      for (let i = 0; i < 2; i++) {
        const occDate = new Date(fYear + i, fMonth, fDay);
        const formatted = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(occDate);
        const iso = occDate.toISOString().slice(0, 10);
        results.push({
          key: `${fee.uiId}-occ-${i}`,
          feeUiId: fee.uiId,
          description: desc,
          amount: amt,
          currency: curr,
          frequency: 'Annually',
          billingDate: formatted,
          isoDate: iso,
          timingExplanation: i === 0 ? 'Annual billing (Year 1)' : 'Annual billing (Year 2)',
        });
      }
    } else if (freq === 'CUSTOM') {
      const interval = fee.scheduleConfig?.customInterval?.count ?? 1;
      const count = Math.max(1, Math.min(12, Math.floor(12 / interval) || 1));
      for (let i = 0; i < count; i++) {
        const occDate = new Date(fYear, fMonth + i * interval, fDay);
        const formatted = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(occDate);
        const iso = occDate.toISOString().slice(0, 10);
        results.push({
          key: `${fee.uiId}-occ-${i}`,
          feeUiId: fee.uiId,
          description: desc,
          amount: amt,
          currency: curr,
          frequency: 'Custom',
          billingDate: formatted,
          isoDate: iso,
          timingExplanation: `Every ${interval} month${interval === 1 ? '' : 's'} (#${i + 1})`,
        });
      }
    } else {
      // ONE_TIME
      const occDate = new Date(fYear, fMonth, fDay);
      const formatted = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(occDate);
      const iso = occDate.toISOString().slice(0, 10);
      results.push({
        key: `${fee.uiId}-occ-0`,
        feeUiId: fee.uiId,
        description: desc,
        amount: amt,
        currency: curr,
        frequency: freqLabel,
        billingDate: formatted,
        isoDate: iso,
        timingExplanation: 'One-time fee',
      });
    }
  }

  return results;
}

function scheduleConfigForFee(fee: OperationalServiceValues['fees'][number], fallbackStartDate = ''): BillingScheduleConfigV1 {
  const cadence = fee.billingFrequency || 'CUSTOM';
  const interval = BILLING_INTERVALS[cadence];
  const existingScheduleConfig = fee.scheduleConfig;
  const existingCustomIntervalCount = existingScheduleConfig?.customInterval?.count ?? 1;
  if (existingScheduleConfig) return existingScheduleConfig;
  try {
    const canonical = canonicalizeBillingSchedule({
      billingFrequency: cadence,
      billingStartDate: fee.billingStartDate || fallbackStartDate || null,
      customFrequencyLabel: fee.customFrequencyLabel || null,
      scheduleConfig: fee.scheduleConfig,
    });
    if (canonical) return canonical;
  } catch {
    // Keep an invalid migrated value editable; save validation reports the
    // precise compatibility/materialization issue to the form.
  }
  return {
    schemaVersion: 1,
    cadence: cadence as BillingScheduleConfigV1['cadence'],
    startDate: /^\d{4}-\d{2}-\d{2}$/.test(fee.billingStartDate || fallbackStartDate)
      ? (fee.billingStartDate || fallbackStartDate) as BillingScheduleConfigV1['startDate']
      : null,
    customInterval: interval === null ? (cadence === 'CUSTOM' ? { unit: 'MONTH', count: existingCustomIntervalCount } : null) : { unit: 'MONTH', count: interval },
    scheduleEntries: /^\d{4}-\d{2}-\d{2}$/.test(fee.billingStartDate || fallbackStartDate)
      ? [{
        key: 'default',
        label: 'Billing date',
        expression: { kind: 'DAY_OF_MONTH', day: Number((fee.billingStartDate || fallbackStartDate).slice(8, 10)) },
        businessDayAdjustment: 'NONE',
      }]
      : [],
  };
}

function SelectField({
  id,
  label,
  error,
  tooltip,
  children,
  className = '',
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  id: string;
  label: string;
  error?: string;
  tooltip?: ReactNode;
  children: ReactNode;
}) {
  const errorId = `${id}-error`;
  return (
    <div className={className}>
      <div className="flex items-center gap-1">
        <label htmlFor={id} className="label">
          {label}
        </label>
        {tooltip ? (
          <Tooltip content={tooltip}>
            <span className="inline-flex cursor-help text-text-muted hover:text-text-secondary">
              <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="sr-only">{label} help</span>
            </span>
          </Tooltip>
        ) : null}
      </div>
      <select
        id={id}
        className={`input input-sm w-full ${error ? 'border-status-error' : ''}`}
        aria-invalid={error ? 'true' : 'false'}
        aria-describedby={error ? errorId : undefined}
        {...props}
      >
        {children}
      </select>
      {error ? <p id={errorId} className="mt-1.5 text-xs text-status-error">{error}</p> : null}
    </div>
  );
}

function OperationalFieldValue({
  field,
  disabled,
  error,
  onChange,
}: {
  field: OperationalServiceValues['fields'][number];
  disabled: boolean;
  error?: string;
  onChange: (value: string) => void;
}) {
  const id = `field-${field.uiId}-value`;
  const errorId = `${id}-error`;
  const label = field.label.trim() || field.key.trim() || 'Field value';
  const accessibility = {
    id,
    'aria-invalid': error ? 'true' : 'false',
    'aria-describedby': error ? errorId : undefined,
  } as const;

  if (field.type === 'date') {
    return (
      <SingleDateInput
        id={id}
        label={label}
        disabled={disabled}
        value={field.value}
        error={error}
        onChange={onChange}
      />
    );
  }

  let control: ReactNode;
  if (field.type === 'textarea') {
    control = <textarea {...accessibility} className="input input-sm min-h-24 px-3 py-2" disabled={disabled} value={field.value} onChange={(event) => onChange(event.target.value)} />;
  } else if (field.type === 'boolean') {
    control = (
      <select {...accessibility} className="input input-sm" disabled={disabled} value={field.value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Not set</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  } else {
    control = (
      <input
        {...accessibility}
        className="input input-sm"
        type="text"
        inputMode={field.type === 'number' || field.type === 'currency' ? 'decimal' : undefined}
        disabled={disabled}
        value={field.value}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  return (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      {control}
      {error ? <p id={errorId} className="mt-1.5 text-xs text-status-error">{error}</p> : null}
    </div>
  );
}

function DeadlineParameterValue({
  rule,
  parameter,
  disabled,
  onChange,
}: {
  rule: OperationalServiceValues['deadlineRules'][number];
  parameter: OperationalServiceValues['deadlineRules'][number]['parameters'][number];
  disabled: boolean;
  onChange: (value: unknown) => void;
}) {
  const id = `deadline-${rule.uiId}-${parameter.key}`;
  const value = rule.parameterValues[parameter.key];
  const options = parameter.validation && typeof parameter.validation === 'object' && !Array.isArray(parameter.validation) && 'options' in parameter.validation && Array.isArray(parameter.validation.options)
    ? parameter.validation.options.filter((option): option is string => typeof option === 'string')
    : [];
  if (parameter.type === 'BOOLEAN') {
    return <div><label htmlFor={id} className="label">{parameter.label}</label><select id={id} className="input input-sm w-full" disabled={disabled} value={typeof value === 'boolean' ? String(value) : ''} onChange={(event) => onChange(event.target.value === '' ? undefined : event.target.value === 'true')}><option value="">Not set</option><option value="true">Yes</option><option value="false">No</option></select></div>;
  }
  if (parameter.type === 'ENUM') {
    return <div><label htmlFor={id} className="label">{parameter.label}</label><select id={id} className="input input-sm w-full" disabled={disabled} value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value || undefined)}><option value="">Select {parameter.label.toLowerCase()}</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></div>;
  }
  if (parameter.type === 'DATE') {
    return (
      <SingleDateInput
        id={id}
        label={parameter.label}
        disabled={disabled}
        value={typeof value === 'string' ? value : ''}
        hint={parameter.helpText ?? undefined}
        onChange={(next) => onChange(next || undefined)}
      />
    );
  }
  const isNumber = parameter.type === 'INTEGER' || parameter.type === 'DECIMAL';
  const inputValue = value === undefined || value === null ? '' : String(value);
  return <div><label htmlFor={id} className="label">{parameter.label}</label><input id={id} className="input input-sm" type="text" inputMode={isNumber ? 'decimal' : undefined} disabled={disabled} value={inputValue} onChange={(event) => {
    const next = event.target.value;
    if (!next) onChange(undefined);
    else if (parameter.type === 'INTEGER') onChange(Number.parseInt(next, 10));
    else if (parameter.type === 'DECIMAL') onChange(Number.parseFloat(next));
    else onChange(next);
  }} />{parameter.helpText ? <p className="mt-1 text-xs text-text-secondary">{parameter.helpText}</p> : null}</div>;
}

export interface OperationalServiceFormProps {
  mode?: 'create' | 'edit';
  values: OperationalServiceValues;
  onChange: Dispatch<SetStateAction<OperationalServiceValues>>;
  errors: Record<string, string | undefined>;
  disabled?: boolean;
  readOnly?: boolean;
  sectionsDisabled?: boolean;
  serviceSelector?: ReactNode;
  serviceHeader?: ReactNode;
  deadlinePreview?: DeadlinePreviewState;
  openDeadlineOccurrences?: ClientServiceOpenDeadlineOccurrenceDto[];
  openBillingOccurrences?: ClientServiceOpenBillingOccurrenceDto[];
  /** The selected catalog service's company monitoring profiles. */
  monitoringProfiles?: MonitoringProfile[];
  /** The company's statutory obligations (ECI, Form C) this service monitors. */
  companyObligations?: CompanyObligationsState;
  /** Filing statuses chosen in this form, keyed by companyObligationKey. */
  companyObligationStatuses?: Record<string, CompanyObligationStatus>;
  onCompanyObligationStatusChange?: (item: CompanyObligationPreviewItem, status: CompanyObligationStatus) => void | Promise<void>;
  onConfirmFirstPeriod?: () => void;
  /** First YA the engagement files; later obligations default to Pending filing. */
  engagementStartYearOfAssessment?: number | null;
  /** May return a promise so a filing saved next sees the new start. */
  onEngagementStartChange?: (yearOfAssessment: number | null) => void | Promise<void>;
}

export type CompanyObligationsState = {
  items: CompanyObligationPreviewItem[];
  notices: string[];
  isLoading: boolean;
  error: string | null;
  firstPeriodUnconfirmed: boolean;
  statusEditable: boolean;
  /** The company's first YA, the earliest engagement start offered. */
  firstYearOfAssessment: number | null;
};

/** Today's date (YYYY-MM-DD) in the browser's time zone. */
function todayDateKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Row tint per filing status. */
const COMPANY_OBLIGATION_ROW_TONE: Record<CompanyObligationStatus, string> = {
  FILED: 'bg-status-success/10',
  PENDING_FILING: 'bg-background-elevated',
  TO_BE_CONFIRMED: 'bg-status-error/10',
  MANAGED_EXTERNALLY: 'bg-gray-200 dark:bg-gray-700/60',
  NOT_REQUIRED: 'bg-gray-200 text-text-muted dark:bg-gray-700/60',
};

/** The status a row shows: this form's choice, then a staff record, then the projection. */
export function displayedCompanyObligationStatus(
  item: Pick<CompanyObligationPreviewItem, 'recordedStatus' | 'projectedStatus'> & { obligationCode: string; periodKey: string },
  statuses: Record<string, CompanyObligationStatus>,
): CompanyObligationStatus {
  return statuses[companyObligationKey(item)] ?? item.recordedStatus ?? item.projectedStatus ?? 'TO_BE_CONFIRMED';
}

/** Key of one company obligation period, used for recorded statuses. */
export function companyObligationKey(item: { obligationCode: string; periodKey: string }): string {
  return `${item.obligationCode}|${item.periodKey}`;
}

/** Adapt a company-obligations query result for the Deadline tab. */
export function toCompanyObligationsState(query: {
  data?: { items: CompanyObligationPreviewItem[]; notices: string[]; firstPeriodUnconfirmed?: boolean; statusEditable?: boolean; firstYearOfAssessment?: number | null };
  isLoading: boolean;
  error: unknown;
}): CompanyObligationsState {
  return {
    items: query.data?.items ?? [],
    notices: query.data?.notices ?? [],
    isLoading: query.isLoading,
    error: query.error ? (query.error instanceof Error ? query.error.message : 'Request failed') : null,
    firstPeriodUnconfirmed: query.data?.firstPeriodUnconfirmed ?? false,
    statusEditable: query.data?.statusEditable ?? false,
    firstYearOfAssessment: query.data?.firstYearOfAssessment ?? null,
  };
}

const FIRST_PERIOD_NOTICES = new Set([
  'Confirm the first financial year end after incorporation.',
  'Confirm the Year of Assessment for this period.',
]);

function CompanyObligationsPanel({
  state,
  monitoringProfiles,
  isNewService,
  statuses,
  onStatusChange,
  onConfirmFirstPeriod,
  engagementStart,
  onEngagementStartChange,
  disabled,
}: {
  state: CompanyObligationsState | undefined;
  monitoringProfiles: MonitoringProfile[];
  isNewService: boolean;
  statuses: Record<string, CompanyObligationStatus>;
  onStatusChange?: (item: CompanyObligationPreviewItem, status: CompanyObligationStatus) => void;
  onConfirmFirstPeriod?: () => void;
  engagementStart: number | null;
  onEngagementStartChange?: (yearOfAssessment: number | null) => void;
  disabled: boolean;
}) {
  const items = state?.items ?? [];
  const profileLabel = monitoringProfiles.map((profile) => MONITORING_PROFILE_LABELS[profile]).join(', ');
  const firstPeriodUnconfirmed = state?.firstPeriodUnconfirmed ?? false;
  const otherNotices = (state?.notices ?? []).filter((notice) => !(firstPeriodUnconfirmed && FIRST_PERIOD_NOTICES.has(notice)));
  const canSetStatus = Boolean(state?.statusEditable && onStatusChange);
  // Newest first, back to the company's first YA so an earlier engagement can be picked.
  const years = items.flatMap((item) => (item.yearOfAssessment ? [item.yearOfAssessment] : []));
  if (engagementStart) years.push(engagementStart);
  if (state?.firstYearOfAssessment) years.push(state.firstYearOfAssessment);
  const yearOptions: number[] = [];
  if (years.length > 0) {
    for (let year = Math.max(...years); year >= Math.min(...years); year -= 1) yearOptions.push(year);
  }
  // A corporate secretarial service only tracks ACRA filings, which read by
  // financial year: YA n covers the financial year ending in n - 1.
  const financialYearOptions = monitoringProfiles.length > 0 && monitoringProfiles.every((profile) => profile === 'CORPORATE_SECRETARIAL');
  const today = todayDateKey();
  return (
    <section aria-labelledby="company-obligations-heading" className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h4 id="company-obligations-heading" className="text-sm font-semibold text-text-primary">Company obligations</h4>
          <p className="text-xs text-text-secondary">
            {profileLabel ? `${profileLabel}: ` : ''}
            {monitoringProfiles.length > 0 ? monitoringProfiles.map((profile) => MONITORING_PROFILE_HINTS[profile]).join('; ') : 'Statutory deadlines this company is monitored for'}
            {isNewService ? ', tracked from the service start date once saved.' : '.'}
          </p>
        </div>
        <span className="text-xs text-text-muted">{items.length} deadline{items.length === 1 ? '' : 's'}</span>
      </div>
      {onEngagementStartChange && yearOptions.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="engagement-start-ya" className="text-xs font-medium text-text-secondary">Our engagement starts from</label>
          <select
            id="engagement-start-ya"
            className="input input-sm w-auto py-1 text-xs"
            disabled={disabled}
            value={engagementStart ?? ''}
            onChange={(event) => onEngagementStartChange(event.target.value ? Number(event.target.value) : null)}
          >
            <option value="">Not set</option>
            {yearOptions.map((year) => <option key={year} value={year}>{financialYearOptions ? `FY ${year - 1}` : `YA ${year}`}</option>)}
          </select>
        </div>
      ) : null}
      {state?.isLoading ? <p role="status" className="text-xs italic text-text-muted">Loading company deadlines…</p> : null}
      {state?.error ? <Alert variant="error" compact>Company deadlines are unavailable: {state.error}</Alert> : null}
      {firstPeriodUnconfirmed ? (
        <Alert variant="warning" compact>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span role="status">The first financial year end after incorporation is not confirmed. Confirming it may drop incomplete early YAs.</span>
            {onConfirmFirstPeriod ? (
              <Button type="button" variant="secondary" size="xs" onClick={onConfirmFirstPeriod} disabled={disabled}>Confirm first FYE</Button>
            ) : null}
          </div>
        </Alert>
      ) : null}
      {otherNotices.map((notice) => (
        <Alert key={notice} variant="warning" compact><span role="status">{notice}</span></Alert>
      ))}
      {!state ? (
        <Alert variant="info" compact>Once saved, the company&apos;s statutory deadlines are tracked in Deadlines as company obligations.</Alert>
      ) : items.length === 0 && !state.isLoading && !state.error && state.notices.length === 0 && !firstPeriodUnconfirmed ? (
        <p className="text-xs italic text-text-muted">No company deadlines fall in the next 24 months.</p>
      ) : null}
      {state && items.length > 0 && !state.statusEditable ? (
        <p className="text-xs text-text-muted">Filing statuses can be recorded once company monitoring is switched on.</p>
      ) : null}
      {items.length > 0 ? (
        <div className="divide-y divide-border-primary overflow-hidden rounded-lg border border-border-primary bg-background-primary">
          {items.map((item) => {
            const key = companyObligationKey(item);
            const status = displayedCompanyObligationStatus(item, statuses);
            const periodLabel = obligationPeriodLabel(item);
            return (
              <div
                key={`${key}|${item.milestoneName}`}
                data-status={status}
                className={cn('flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5', COMPANY_OBLIGATION_ROW_TONE[status])}
              >
                <div className="flex min-w-[180px] flex-1 flex-col">
                  <span className="text-xs font-semibold text-text-primary">{item.obligationName}</span>
                  {item.coverageTiming === 'BEFORE_START' ? (
                    <span className="text-[11px] text-amber-700 dark:text-amber-300">Before the service start: takeover review</span>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {/* Fixed widths keep the period, date and status columns aligned across rows. */}
                  {periodLabel ? (
                    <span className="inline-flex w-[4.75rem] items-center justify-center rounded-lg border border-border-primary bg-background-elevated py-1 text-xs font-semibold text-text-primary">
                      {periodLabel}
                    </span>
                  ) : <span aria-hidden className="w-[4.75rem]" />}
                  <span
                    data-upcoming={item.dueDate > today ? 'true' : undefined}
                    className={cn(
                      'inline-flex w-[7.5rem] items-center justify-center gap-1.5 rounded-lg border py-1 text-xs font-semibold',
                      item.dueDate > today
                        ? 'border-status-success/40 bg-status-success/15 text-status-success'
                        : 'border-border-primary bg-background-elevated text-text-primary',
                    )}
                  >
                    <Clock className={cn('h-3 w-3', item.dueDate > today ? 'text-status-success' : 'text-text-muted')} />
                    {formatProjectedDate(item.dueDate)}
                  </span>
                  {canSetStatus ? (
                    <select
                      aria-label={`Filing status for ${item.obligationName} ${periodLabel ?? item.periodKey}`}
                      className="input input-sm w-[9.5rem] py-1 text-xs"
                      disabled={disabled}
                      value={status}
                      onChange={(event) => onStatusChange?.(item, event.target.value as CompanyObligationStatus)}
                    >
                      {COMPANY_OBLIGATION_STATUSES.map((option) => (
                        <option key={option} value={option}>{COMPANY_OBLIGATION_STATUS_LABELS[option]}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-background-secondary px-2 py-0.5 text-[11px] font-medium text-text-secondary">
                      {COMPANY_OBLIGATION_STATUS_LABELS[status]}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

export function OperationalServiceForm({
  mode = 'edit',
  values,
  onChange,
  errors,
  disabled = false,
  readOnly = false,
  sectionsDisabled = false,
  serviceSelector,
  serviceHeader,
  deadlinePreview,
  openDeadlineOccurrences,
  openBillingOccurrences,
  monitoringProfiles = [],
  companyObligations,
  companyObligationStatuses = {},
  onCompanyObligationStatusChange,
  onConfirmFirstPeriod,
  engagementStartYearOfAssessment = null,
  onEngagementStartChange,
}: OperationalServiceFormProps) {
  const [billingHideConfirmationOpen, setBillingHideConfirmationOpen] = useState(false);
  const [engagementStartPrompt, setEngagementStartPrompt] = useState<{
    item: CompanyObligationPreviewItem;
    status: CompanyObligationStatus;
  } | null>(null);

  // Filing a YA before the engagement start would bill nothing, so offer to
  // move the engagement start back to that YA first.
  const handleCompanyObligationStatusChange = onCompanyObligationStatusChange
    ? (item: CompanyObligationPreviewItem, status: CompanyObligationStatus) => {
      const postpaidTriggers = values.billingDisposition === 'NOT_REQUIRED'
        ? []
        : values.fees.filter((fee) => fee.billingTiming === 'POSTPAID').map((fee) => fee.postpaidTrigger);
      if (status === 'FILED' && onEngagementStartChange && filingBeforeEngagementStart({
        obligationCode: item.obligationCode,
        yearOfAssessment: item.yearOfAssessment,
        engagementStartYearOfAssessment,
        postpaidTriggers,
      })) {
        setEngagementStartPrompt({ item, status });
        return;
      }
      onCompanyObligationStatusChange(item, status);
    }
    : undefined;
  const [userSelectedTab, setUserSelectedTab] = useState<'deadlines' | 'billing' | null>(null);
  const [expandedRuleIds, setExpandedRuleIds] = useState<Set<string>>(new Set());

  const activeTab = userSelectedTab ?? (values.deadlineRules.length > 0 || monitoringProfiles.length > 0 || (companyObligations?.items.length ?? 0) > 0 ? 'deadlines' : 'billing');

  const today = currentDateInSingapore();
  const projectedDeadlines: ClientServiceProjectedDeadlineDto[] = (deadlinePreview?.items ?? [])
    .map((item) => ({ ...item }))
    .sort((a, b) => (
      a.calculatedDueDate.localeCompare(b.calculatedDueDate)
      || a.ruleId.localeCompare(b.ruleId)
      || a.milestoneKey.localeCompare(b.milestoneKey)
      || a.scheduleEntryKey.localeCompare(b.scheduleEntryKey)
    ));

  // Projected billing items sorted chronologically by date
  const projectedBillingItems = calculateActualBillingPreview(values.fees, values.startDate).sort((a, b) => {
    if (!a.isoDate) return 1;
    if (!b.isoDate) return -1;
    return a.isoDate.localeCompare(b.isoDate);
  });

  const deadlineItems: DeadlineDisplayItem[] = readOnly
    ? (openDeadlineOccurrences ?? []).map((item) => ({
      key: item.id,
      ruleId: item.ruleId,
      periodKey: item.periodKey,
      milestoneKey: item.milestoneKey,
      scheduleEntryKey: item.scheduleEntryKey,
      milestoneName: item.milestoneName,
      ruleName: item.ruleName,
      calculatedDueDate: item.operativeDueDate,
      explanation: item.notes?.trim() || 'Open stored deadline',
      isAuthoritativeBacklog: false,
    }))
    : projectedDeadlines.map((item) => ({
      key: `${item.ruleId}|${item.periodKey}|${item.milestoneKey}|${item.scheduleEntryKey}`,
      ruleId: item.ruleId,
      periodKey: item.periodKey,
      milestoneKey: item.milestoneKey,
      scheduleEntryKey: item.scheduleEntryKey,
      milestoneName: item.milestoneName,
      ruleName: item.ruleName,
      calculatedDueDate: item.calculatedDueDate,
      explanation: item.explanation.length > 0 ? item.explanation[item.explanation.length - 1] : 'Scheduled by the deadline rule',
      isAuthoritativeBacklog: item.materializationPolicy === 'AUTHORITATIVE_ANNUAL_BACKLOG' && item.calculatedDueDate < today,
    }));

  const billingItems: ProjectedBillingItem[] = readOnly
    ? (openBillingOccurrences ?? []).map((item) => ({
      key: item.id,
      feeUiId: item.feeLineId,
      description: item.description,
      amount: item.amount,
      currency: item.currency,
      frequency: item.postpaidTrigger ? 'Postpaid' : billingFrequencyLabel(item.billingFrequency, item.customFrequencyLabel),
      billingDate: formatProjectedDate(item.operativeExpectedDate),
      isoDate: item.operativeExpectedDate,
      timingExplanation: item.postpaidTrigger
        ? `Open · ${item.billingPeriodKey.replace(/^YA/, 'YA ')} · ${POSTPAID_TRIGGER_LABELS[item.postpaidTrigger]}`
        : `Open · ${item.billingPeriodKey}`,
      ...(item.tieredPricing ? {
        amountLabel: item.quantity == null
          ? 'Quantity needed'
          : `${item.quantity.replace(/\.00$/, '')} × ${item.tieredPricing.unitLabel} · ${item.currency} ${item.amount}`,
      } : {}),
    }))
    : values.billingDisposition === 'NOT_REQUIRED'
      ? []
      : projectedBillingItems;

  const showDeadlinePanel = readOnly
    ? openDeadlineOccurrences !== undefined
    : values.deadlineRules.some((rule) => rule.enabled);

  const toggleExpandRule = (uiId: string) => {
    setExpandedRuleIds((prev) => {
      const next = new Set(prev);
      if (next.has(uiId)) next.delete(uiId);
      else next.add(uiId);
      return next;
    });
  };

  const updateValue = <K extends keyof OperationalServiceValues>(key: K, value: OperationalServiceValues[K]) => {
    onChange((current) => ({ ...current, [key]: value }));
  };

  const requestBillingDisposition = (next: 'CONFIGURED' | 'NOT_REQUIRED') => {
    if (mode !== 'create' && next === 'NOT_REQUIRED' && values.fees.length > 0) {
      setBillingHideConfirmationOpen(true);
      return;
    }
    onChange((current) => ({
      ...current,
      billingDisposition: next,
      billingNotRequiredReason: next === 'CONFIGURED' ? '' : current.billingNotRequiredReason,
    }));
  };

  const confirmBillingHide = () => {
    setBillingHideConfirmationOpen(false);
    onChange((current) => ({ ...current, billingDisposition: 'NOT_REQUIRED' }));
  };

  return (
    <>
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12 min-h-[520px]">
        {/* Left Panel: Service Details, Dates, Billing Disposition, and Service Fields */}
        <div className="space-y-4 lg:col-span-6">
          {/* Top Service tab header to align baseline with right panel */}
          <div className="flex border-b border-border-primary" role="tablist" aria-label="Service details header">
            <div className="flex items-center gap-2 border-b-2 border-oak-primary px-4 py-2.5 text-sm font-semibold text-oak-primary">
              <span>Service</span>
            </div>
          </div>

          {serviceHeader}
          {serviceSelector}

          <div className="space-y-4 rounded-xl border border-border-primary bg-background-primary p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-text-primary">Service Details</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <SelectField
                id="client-service-status"
                label="Status"
                disabled={disabled}
                value={values.status}
                onChange={(event) => updateValue('status', event.target.value as OperationalServiceValues['status'])}
              >
                <option value="ACTIVE">Active</option>
                <option value="PAUSED">Paused</option>
                <option value="ENDED">Ended</option>
              </SelectField>
              <SelectField
                id="client-service-cadence"
                label="Cadence"
                tooltip="Choose how frequently this service recurs. Select 'Custom' to define a non-standard recurrence (e.g. Every 18 months)."
                disabled={disabled || sectionsDisabled}
                value={values.serviceCadence}
                onChange={(event) => updateValue('serviceCadence', event.target.value as OperationalServiceValues['serviceCadence'])}
              >
                {CADENCE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </SelectField>
              {values.serviceCadence === 'CUSTOM' ? (
                <div className="sm:col-span-2">
                  <div className="flex items-center gap-1 mb-1">
                    <label htmlFor="client-service-custom-cadence" className="block text-xs font-medium text-text-secondary">
                      Custom cadence
                    </label>
                    <Tooltip content="Enter a descriptive cadence label for this service (e.g. 'Every 18 months' or 'Bi-monthly').">
                      <span className="inline-flex cursor-help text-text-muted hover:text-text-secondary">
                        <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
                        <span className="sr-only">Custom cadence help</span>
                      </span>
                    </Tooltip>
                  </div>
                  <FormInput
                    id="client-service-custom-cadence"
                    placeholder="e.g. Every 18 months"
                    disabled={disabled || sectionsDisabled}
                    value={values.customCadenceLabel}
                    error={errors.customCadenceLabel}
                    hint="Describe how frequently this service repeats (e.g. Every 18 months, Bi-monthly)."
                    onChange={(event) => updateValue('customCadenceLabel', event.target.value)}
                  />
                </div>
              ) : null}
              <SingleDateInput id="client-service-start-date" label="Start date" required disabled={disabled} value={values.startDate} error={errors.startDate} onChange={(next) => updateValue('startDate', next)} />
              <SingleDateInput id="client-service-end-date" label="End date" disabled={disabled} value={values.endDate} error={errors.endDate} onChange={(next) => updateValue('endDate', next)} />
            </div>
          </div>

          {/* Billing Tracker Section */}
          <div className="space-y-3 rounded-xl border border-border-primary bg-background-primary p-4 shadow-sm" aria-labelledby="billing-disposition-heading">
            <div>
              <h3 id="billing-disposition-heading" className="text-sm font-semibold text-text-primary">Billing Tracking</h3>
              <p className="mt-0.5 text-xs text-text-secondary">Choose how billing should be tracked for this service.</p>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="group" aria-label="Billing disposition">
              <button
                type="button"
                className={`min-h-11 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${values.billingDisposition === 'CONFIGURED' ? 'border-oak-primary bg-oak-primary/10 text-text-primary' : 'border-border-primary bg-background-secondary text-text-secondary'}`}
                aria-label="Billing configured"
                aria-pressed={values.billingDisposition === 'CONFIGURED'}
                disabled={disabled || sectionsDisabled}
                onClick={() => requestBillingDisposition('CONFIGURED')}
              >
                <span className="font-medium">Billing configured</span>
                <span className="mt-0.5 block text-xs text-text-secondary">Track expected billing schedules.</span>
              </button>
              <button
                type="button"
                className={`min-h-11 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${values.billingDisposition === 'NOT_REQUIRED' ? 'border-oak-primary bg-oak-primary/10 text-text-primary' : 'border-border-primary bg-background-secondary text-text-secondary'}`}
                aria-label="No billing required"
                aria-pressed={values.billingDisposition === 'NOT_REQUIRED'}
                disabled={disabled || sectionsDisabled}
                onClick={() => requestBillingDisposition('NOT_REQUIRED')}
              >
                <span className="font-medium">No billing required</span>
                <span className="mt-0.5 block text-xs text-text-secondary">No fee schedules required.</span>
              </button>
            </div>
            {values.billingDisposition === 'UNREVIEWED' ? <Alert variant="warning" compact>Billing disposition needs review. Select Billing configured or No billing required before saving.</Alert> : null}
            {errors.billingDisposition ? <p role="alert" className="text-xs text-status-error">{errors.billingDisposition}</p> : null}
          </div>

          {/* Service Fields Section */}
          <div className="space-y-3 rounded-xl border border-border-primary bg-background-primary p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-text-primary">Service Fields</h3>
                <p className="text-xs text-text-secondary">Custom fields for operational tracking</p>
              </div>
              <Button size="xs" variant="secondary" disabled={disabled || sectionsDisabled} onClick={() => updateValue('fields', [...values.fields, { uiId: uuid(), key: '', label: '', type: 'text', value: '', catalogDerived: false }])}>Add field</Button>
            </div>
            {values.fields.length === 0 ? <p className="text-xs text-text-secondary">No custom fields added.</p> : null}
            {values.fields.map((field, index) => (
              <div key={field.uiId} className="grid grid-cols-1 gap-2.5 rounded-lg border border-border-secondary bg-background-secondary/40 p-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
                <div>
                  <label htmlFor={`field-${field.uiId}-name`} className="label">Field name</label>
                  <input id={`field-${field.uiId}-name`} aria-label={`Field ${index + 1} name`} className="input input-sm" disabled={disabled || sectionsDisabled} value={field.key} onChange={(event) => updateValue('fields', values.fields.map((item) => item.uiId === field.uiId ? { ...item, key: event.target.value, label: item.catalogDerived ? item.label : event.target.value } : item))} />
                </div>
                <OperationalFieldValue field={field} disabled={disabled || sectionsDisabled} error={errors[`field-${field.uiId}-value`]} onChange={(value) => updateValue('fields', values.fields.map((item) => item.uiId === field.uiId ? { ...item, value } : item))} />
                <Button size="xs" variant="ghost" className="self-end" disabled={disabled || sectionsDisabled} onClick={() => updateValue('fields', values.fields.filter((item) => item.uiId !== field.uiId))}>Remove</Button>
              </div>
            ))}
            {errors.fieldValues ? <p role="alert" className="text-xs text-status-error">{errors.fieldValues}</p> : null}
          </div>
        </div>

        {/* Right Panel: Tabs for Deadlines and Billing */}
        <div className="space-y-4 lg:col-span-6 min-h-[520px]">
          {/* Tab Navigation */}
          <div className="flex border-b border-border-primary" role="tablist" aria-label="Service configuration tabs">
            <button
              type="button"
              role="tab"
              id="tab-deadlines"
              aria-controls="panel-deadlines"
              aria-selected={activeTab === 'deadlines'}
              onClick={() => setUserSelectedTab('deadlines')}
              className={cn(
                'flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-oak-primary/30',
                activeTab === 'deadlines'
                  ? 'border-oak-primary font-semibold text-oak-primary'
                  : 'border-transparent text-text-secondary hover:border-border-secondary hover:text-text-primary'
              )}
            >
              <span>Deadline</span>
              <span className={cn(
                'inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold',
                activeTab === 'deadlines' ? 'bg-oak-primary text-white' : 'border border-border-primary bg-background-elevated text-text-secondary'
              )}>
                  {deadlineItems.length + (companyObligations?.items.length ?? 0)}
              </span>
            </button>
            <button
              type="button"
              role="tab"
              id="tab-billing"
              aria-controls="panel-billing"
              aria-selected={activeTab === 'billing'}
              onClick={() => setUserSelectedTab('billing')}
              className={cn(
                'flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-oak-primary/30',
                activeTab === 'billing'
                  ? 'border-oak-primary font-semibold text-oak-primary'
                  : 'border-transparent text-text-secondary hover:border-border-secondary hover:text-text-primary'
              )}
            >
              <span>Billing</span>
              <span className={cn(
                'inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold',
                activeTab === 'billing' ? 'bg-oak-primary text-white' : 'border border-border-primary bg-background-elevated text-text-secondary'
              )}>
                  {billingItems.length}
              </span>
            </button>
          </div>

          {/* Deadlines Tab */}
          {activeTab === 'deadlines' ? (
            <div id="panel-deadlines" role="tabpanel" aria-labelledby="tab-deadlines" className="space-y-4">
              {errors.deadlineRules ? <p role="alert" className="text-xs text-status-error">{errors.deadlineRules}</p> : null}

              {/* Top Section: Configured Rules List (Collapsed by default, expand on click) */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-semibold text-text-primary">Configured Rules</h4>
                    <p className="text-xs text-text-secondary">Toggle rules on/off or click a rule to customize parameters and schedule</p>
                  </div>
                  <span className="text-xs text-text-muted">{values.deadlineRules.length} rule{values.deadlineRules.length === 1 ? '' : 's'}</span>
                </div>

                {values.deadlineRules.length === 0 && !companyObligations ? (
                  <div className="rounded-xl border border-dashed border-border-primary p-8 text-center text-text-secondary">
                    <p className="text-sm">No deadline rules are associated with this service.</p>
                  </div>
                ) : null}

                {values.deadlineRules.map((rule) => {
                  const hasCustomSchedule = (rule.scheduleEntries?.length ?? 0) > 0;
                  const hasParameters = rule.parameters.length > 0;
                  const isExpandable = hasCustomSchedule || hasParameters;
                  const isExpanded = isExpandable && expandedRuleIds.has(rule.uiId);
                  const updateRule = (changes: Partial<typeof rule>) => updateValue('deadlineRules', values.deadlineRules.map((item) => item.uiId === rule.uiId ? { ...item, ...changes } : item));
                  const updateParameters = (key: string, value: unknown) => updateRule({ parameterValues: value === undefined ? Object.fromEntries(Object.entries(rule.parameterValues).filter(([k]) => k !== key)) : { ...rule.parameterValues, [key]: value }, parameterProvenance: value === undefined ? Object.fromEntries(Object.entries(rule.parameterProvenance).filter(([k]) => k !== key)) as typeof rule.parameterProvenance : { ...rule.parameterProvenance, [key]: rule.parameterProvenance[key] ?? 'CLIENT_OVERRIDE' } });

                  return (
                    <article
                      key={rule.uiId}
                      className={cn(
                        'rounded-xl border transition-colors overflow-hidden',
                        rule.enabled
                          ? 'border-border-primary bg-background-primary shadow-sm'
                          : 'border-border-primary/60 bg-background-secondary/40 opacity-75'
                      )}
                    >
                      {/* Header Row: Only expandable if parameters or custom schedule exist */}
                      <div
                        onClick={isExpandable ? () => toggleExpandRule(rule.uiId) : undefined}
                        className={cn(
                          'flex select-none items-center justify-between gap-3 p-3.5 transition-colors',
                          isExpandable ? 'cursor-pointer hover:bg-background-secondary/40' : 'cursor-default'
                        )}
                        role={isExpandable ? 'button' : undefined}
                        tabIndex={isExpandable ? 0 : undefined}
                        aria-expanded={isExpandable ? isExpanded : undefined}
                        onKeyDown={isExpandable ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            toggleExpandRule(rule.uiId);
                          }
                        } : undefined}
                      >
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          {isExpandable ? (
                            <span className="text-text-muted hover:text-text-primary transition-colors">
                              {isExpanded ? (
                                <ChevronDown className="h-4 w-4 shrink-0 transition-transform" />
                              ) : (
                                <ChevronRight className="h-4 w-4 shrink-0 transition-transform" />
                              )}
                            </span>
                          ) : null}
                          <h4 className="truncate text-sm font-semibold text-text-primary">{rule.name}</h4>
                          {rule.enabled ? (
                            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                              Active
                            </span>
                          ) : (
                            <span className="shrink-0 rounded-full bg-background-elevated px-2 py-0.5 text-xs font-medium text-text-muted">
                              Disabled
                            </span>
                          )}
                        </div>

                        {/* Shift Add custom schedule button left of the active/inactive toggle */}
                        <div className="flex items-center gap-2.5" onClick={(e) => e.stopPropagation()}>
                          <Button
                            type="button"
                            size="xs"
                            variant="secondary"
                            disabled={disabled || sectionsDisabled || !rule.enabled}
                            aria-label={`Add custom schedule for ${rule.name}`}
                            onClick={() => {
                              if (!expandedRuleIds.has(rule.uiId)) {
                                setExpandedRuleIds((prev) => new Set(prev).add(rule.uiId));
                              }
                              const key = `entry-${crypto.randomUUID().slice(0, 8)}`;
                              const newEntry: ScheduleEntryInput = {
                                key,
                                label: rule.name || 'Custom deadline entry',
                                expression: { kind: 'DAY_OF_MONTH' as const, day: 1 },
                                businessDayAdjustment: 'NONE' as const,
                              };
                              updateRule({
                                scheduleEntries: [...(rule.scheduleEntries ?? []), newEntry],
                              });
                            }}
                          >
                            Add custom schedule
                          </Button>
                          <Toggle
                            size="sm"
                            ariaLabel={`Enable ${rule.name}`}
                            checked={rule.enabled}
                            disabled={disabled || sectionsDisabled}
                            onChange={(checked) => updateRule({ enabled: checked })}
                          />
                        </div>
                      </div>

                      {rule.applicabilityState && !['PENDING_EVALUATION', 'APPLICABLE'].includes(rule.applicabilityState) ? (
                        <div className="px-3.5 pb-2">
                          <p role="status" className="text-xs text-status-warning">{rule.applicabilityReason ?? (rule.applicabilityState === 'MISSING_INPUT' ? 'Required inputs are missing.' : 'This rule does not apply to the company.')}</p>
                        </div>
                      ) : null}

                      {/* Expanded Section (Parameters & Schedule Entries) */}
                      {isExpanded && (
                        <div className="border-t border-border-secondary p-4 space-y-4 bg-background-secondary/20 animate-fade-in">
                          {rule.parameters.length > 0 ? (
                            <div className="space-y-2">
                              <h5 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">Rule Parameters</h5>
                              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                {rule.parameters.map((parameter) => (
                                  <div key={parameter.key} className="space-y-1">
                                    <DeadlineParameterValue rule={rule} parameter={parameter} disabled={disabled || sectionsDisabled} onChange={(value) => updateParameters(parameter.key, value)} />
                                    <label htmlFor={`deadline-${rule.uiId}-${parameter.key}-source`} className="sr-only">{parameter.label} provenance</label>
                                    <select id={`deadline-${rule.uiId}-${parameter.key}-source`} className="input input-sm w-full" disabled={disabled || sectionsDisabled || !(parameter.key in rule.parameterValues)} value={rule.parameterProvenance[parameter.key] ?? 'CLIENT_OVERRIDE'} onChange={(event) => updateRule({ parameterProvenance: { ...rule.parameterProvenance, [parameter.key]: event.target.value as typeof rule.parameterProvenance[typeof parameter.key] } })}>
                                      <option value="CLIENT_OVERRIDE">Client override</option>
                                      <option value="CATALOG_DEFAULT">Catalog default</option>
                                      <option value="COMPANY">Company source</option>
                                    </select>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}

                          <ScheduleEntryEditor
                            value={rule.scheduleEntries}
                            disabled={disabled || sectionsDisabled}
                            hideHeader
                            hideAddButton
                            onChange={(scheduleEntries) => updateRule({ scheduleEntries })}
                          />
                        </div>
                      )}
                      {errors[`deadline-rule-${rule.uiId}-schedule`] ? <div className="px-3.5 pb-3"><p role="alert" className="text-xs text-status-error">{errors[`deadline-rule-${rule.uiId}-schedule`]}</p></div> : null}
                    </article>
                  );
                })}
              </div>

              {companyObligations || monitoringProfiles.length > 0 ? (
                <CompanyObligationsPanel
                  state={companyObligations}
                  monitoringProfiles={monitoringProfiles}
                  isNewService={mode === 'create'}
                  statuses={companyObligationStatuses}
                  onStatusChange={readOnly ? undefined : handleCompanyObligationStatusChange}
                  onConfirmFirstPeriod={readOnly ? undefined : onConfirmFirstPeriod}
                  engagementStart={engagementStartYearOfAssessment ?? null}
                  onEngagementStartChange={readOnly ? undefined : onEngagementStartChange}
                  disabled={disabled}
                />
              ) : null}

              {/* Bottom Section: Canonical server-projected deadline preview */}
              {showDeadlinePanel ? (readOnly || deadlinePreview ? (
                <div className="space-y-3 rounded-xl border border-blue-200/80 bg-blue-50/50 p-4 shadow-sm dark:border-blue-900/40 dark:bg-blue-950/20">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-blue-700 dark:text-blue-400" />
                      <h4 className="text-sm font-semibold text-text-primary">{readOnly ? 'Open deadline items' : 'Canonical deadline preview'}</h4>
                    </div>
                    <span className="rounded-full border border-blue-200 bg-blue-100/80 px-2.5 py-0.5 text-xs font-semibold text-blue-800 dark:border-blue-800 dark:bg-blue-900/40 dark:text-blue-300">
                      {deadlineItems.length} {readOnly ? `open item${deadlineItems.length === 1 ? '' : 's'}` : `scheduled milestone${deadlineItems.length === 1 ? '' : 's'}`}
                    </span>
                  </div>
                  <p className="text-xs text-text-secondary">
                    {readOnly ? 'All deadline occurrences currently open for this service:' : 'Projected statutory deadlines and filing milestones computed by the deadline engine:'}
                  </p>
                  {!readOnly && deadlinePreview?.state === 'LOADING' ? (
                    <p role="status" className="text-xs text-text-muted italic">Refreshing deadline preview…</p>
                  ) : null}
                  {!readOnly && deadlinePreview?.state === 'ERROR' ? (
                    <Alert variant="error" compact>
                      <span>Deadline preview is unavailable{deadlinePreview.message ? `: ${deadlinePreview.message}` : '.'}</span>
                    </Alert>
                  ) : null}
                  {!readOnly && (deadlinePreview?.warnings ?? []).length > 0 ? (
                    <div className="space-y-1.5">
                      {deadlinePreview?.warnings.map((warning, index) => (
                        <Alert key={`${warning}-${index}`} variant="warning" compact>
                          <span role="status">{warning}</span>
                        </Alert>
                      ))}
                    </div>
                  ) : null}
                  {deadlineItems.length === 0 && (readOnly || deadlinePreview?.state !== 'LOADING') ? (
                    <p className="text-xs text-text-muted italic">{readOnly ? 'No open deadline items for this service.' : 'No canonical deadlines projected for the active rules.'}</p>
                  ) : (
                    <div className="divide-y divide-blue-100/80 rounded-lg border border-blue-200/70 overflow-hidden bg-background-primary/80 dark:divide-blue-900/30 dark:border-blue-900/40 dark:bg-background-secondary/60">
                      {deadlineItems.map((item) => {
                        const isAuthoritativeBacklog = item.isAuthoritativeBacklog;
                        const explanation = item.explanation;
                        return (
                          <div
                            key={item.key}
                            className={cn(
                              'flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 transition-colors',
                              isAuthoritativeBacklog
                                ? 'bg-amber-50/90 border-l-4 border-l-amber-500 border-b border-amber-100 hover:bg-amber-100/80 dark:bg-amber-950/30 dark:border-amber-900/40 dark:border-l-amber-500'
                                : 'hover:bg-blue-50/70 dark:hover:bg-blue-950/40'
                            )}
                          >
                            <div className="flex flex-col min-w-[200px] flex-1">
                              <span className={cn('font-semibold text-xs', isAuthoritativeBacklog ? 'text-amber-900 dark:text-amber-200' : 'text-text-primary')}>
                                {item.milestoneName}
                              </span>
                              <span className={cn('text-[11px]', isAuthoritativeBacklog ? 'text-amber-700 font-medium dark:text-amber-300' : 'text-text-muted')}>
                                {item.ruleName} · {explanation}
                              </span>
                            </div>
                            <div className="flex items-center gap-2.5">
                              <span
                                className={cn(
                                  'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold shadow-2xs',
                                  isAuthoritativeBacklog
                                    ? 'border-amber-300 bg-amber-100/90 text-amber-800 dark:border-amber-800 dark:bg-amber-950/80 dark:text-amber-300'
                                    : 'border-blue-200 bg-white text-blue-800 dark:border-blue-800 dark:bg-background-elevated dark:text-blue-300'
                                )}
                              >
                                <Clock className="h-3 w-3 text-blue-600 dark:text-blue-400" />
                                {formatProjectedDate(item.calculatedDueDate)}
                              </span>
                              {isAuthoritativeBacklog ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100/90 border border-amber-200 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-900/40 dark:border-amber-800 dark:text-amber-300">
                                  <AlertCircle className="h-3 w-3 text-amber-500" />
                                  Authoritative backlog
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                                  <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                                  Scheduled
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : mode === 'create' ? (
                <div className="rounded-xl border border-dashed border-blue-200/80 bg-blue-50/50 p-4 text-xs text-text-secondary dark:border-blue-900/40 dark:bg-blue-950/20">
                  Deadlines are generated by the deadline engine when this service is saved. You can review them in the service editor afterwards.
                </div>
              ) : null) : null}
            </div>
          ) : null}

          {/* Billing Tab */}
          {activeTab === 'billing' ? (
            <div id="panel-billing" role="tabpanel" aria-labelledby="tab-billing" className="space-y-4">
              {errors.feeLines ? <p role="alert" className="text-xs text-status-error">{errors.feeLines}</p> : null}
              {readOnly ? (
                <BillingPreviewPanel items={billingItems} readOnly />
              ) : values.billingDisposition === 'NOT_REQUIRED' ? (
                <div className="rounded-xl border border-dashed border-border-primary p-8 text-center text-text-secondary">
                  <p className="font-medium text-text-primary">No billing required</p>
                  <p className="mt-1 text-xs text-text-secondary">Billing tracking is set to not required for this service. Active billing schedules are hidden.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="text-sm font-semibold text-text-primary">Fee Schedules</h4>
                        <p className="text-xs text-text-secondary">Define recurring or one-time fees for this client service</p>
                      </div>
                      <Button size="xs" variant="secondary" disabled={disabled || sectionsDisabled} onClick={() => updateValue('fees', [...values.fees, { uiId: uuid(), id: uuid(), description: '', amount: '0.00', currency: 'SGD', billingFrequency: 'ANNUALLY', customFrequencyLabel: '', billingStartDate: '', scheduleConfig: null, billingTiming: 'PREPAID', postpaidTrigger: null, catalogDerived: false }])}>Add fee</Button>
                    </div>
                    {values.fees.map((fee, index) => {
                      const prefix = `fee-${fee.uiId}`;
                      const updateFee = (changes: Partial<typeof fee>) => updateValue('fees', values.fees.map((item) => item.uiId === fee.uiId ? { ...item, ...changes } : item));
                      const scheduleConfig = scheduleConfigForFee(fee, values.startDate);
                      const postpaid = fee.billingTiming === 'POSTPAID';
                      const tiered = postpaid && Boolean(fee.tieredPricing);
                      return (
                        <div key={fee.uiId} className="space-y-3 rounded-xl border border-border-primary bg-background-primary p-4 shadow-sm">
                          {/* Row 1: Description (70%) and Billing Start Date (30%) */}
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
                            <div className={postpaid ? 'sm:col-span-12' : 'sm:col-span-8'}>
                              <FormInput
                                id={`${prefix}-description`}
                                label="Description"
                                aria-label={`Fee ${index + 1} description`}
                                className="h-10 text-sm"
                                disabled={disabled || sectionsDisabled}
                                value={fee.description}
                                error={errors[`${prefix}-description`]}
                                onChange={(event) => updateFee({ description: event.target.value })}
                              />
                            </div>
                            {postpaid ? null : <div className="sm:col-span-4">
                              <SingleDateInput
                                id={`${prefix}-billing-start-date`}
                                label="Billing start date"
                                ariaLabel={`Fee ${index + 1} billing start date`}
                                disabled={disabled || sectionsDisabled}
                                value={fee.billingStartDate}
                                error={errors[`${prefix}-billing-start-date`]}
                                onChange={(billingStartDate) => {
                                  const nextSchedule = scheduleConfigForFee({ ...fee, billingStartDate }, values.startDate);
                                  const effectiveStartDate = billingStartDate || values.startDate || null;
                                  updateFee({ billingStartDate, scheduleConfig: { ...nextSchedule, startDate: effectiveStartDate as BillingScheduleConfigV1['startDate'] | null } });
                                }}
                              />
                            </div>}
                          </div>

                          <BillingTimingFields
                            idPrefix={prefix}
                            label={`Fee ${index + 1}`}
                            disabled={disabled || sectionsDisabled}
                            value={{ billingTiming: fee.billingTiming ?? 'PREPAID', postpaidTrigger: fee.postpaidTrigger ?? null, tieredPricing: fee.tieredPricing ?? null }}
                            error={errors[`${prefix}-trigger`]}
                            onChange={(timing) => updateFee(timing)}
                          />

                          {/* Row 2: Currency (smallest), Amount, Frequency (+ Custom interval months if custom), Remove button */}
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-12 sm:items-end">
                            <div className="sm:col-span-2">
                              <FormInput
                                id={`${prefix}-currency`}
                                label="Currency"
                                aria-label={`Fee ${index + 1} currency`}
                                className="uppercase"
                                maxLength={3}
                                disabled={disabled || sectionsDisabled}
                                value={fee.currency}
                                error={errors[`${prefix}-currency`]}
                                onChange={(event) => updateFee({ currency: event.target.value.toUpperCase() })}
                              />
                            </div>
                            {tiered ? <div className="sm:col-span-8" /> : <div className={postpaid ? 'sm:col-span-8' : fee.billingFrequency === 'CUSTOM' ? 'sm:col-span-3' : 'sm:col-span-4'}>
                              <FormInput
                                id={`${prefix}-amount`}
                                label="Amount"
                                aria-label={`Fee ${index + 1} amount`}
                                inputMode="decimal"
                                disabled={disabled || sectionsDisabled}
                                value={fee.amount}
                                error={errors[`${prefix}-amount`]}
                                onChange={(event) => updateFee({ amount: event.target.value })}
                              />
                            </div>}
                            {postpaid ? null : <div className={fee.billingFrequency === 'CUSTOM' ? 'sm:col-span-3' : 'sm:col-span-4'}>
                              <SelectField
                                id={`${prefix}-frequency`}
                                label="Frequency"
                                aria-label={`Fee ${index + 1} frequency`}
                                tooltip="Select the billing cycle for this fee. Choose 'Custom' to define a non-standard month interval."
                                disabled={disabled || sectionsDisabled}
                                value={fee.billingFrequency}
                                error={errors[`${prefix}-frequency`]}
                                onChange={(event) => {
                                  const billingFrequency = event.target.value as typeof fee.billingFrequency;
                                  const nextFee = { ...fee, billingFrequency };
                                  const nextSchedule = scheduleConfigForFee(nextFee, values.startDate);
                                  const customIntervalCount = fee.billingFrequency === 'CUSTOM'
                                    ? fee.scheduleConfig?.customInterval?.count ?? 1
                                    : 1;
                                  updateFee({
                                    billingFrequency,
                                    scheduleConfig: {
                                      ...nextSchedule,
                                      cadence: billingFrequency === '' ? 'CUSTOM' : billingFrequency as BillingScheduleConfigV1['cadence'],
                                      customInterval: billingFrequency === '' || billingFrequency === 'CUSTOM'
                                        ? { unit: 'MONTH', count: customIntervalCount }
                                        : BILLING_INTERVALS[billingFrequency] === null ? null : { unit: 'MONTH', count: BILLING_INTERVALS[billingFrequency]! },
                                    },
                                  });
                                }}
                              >
                                <option value="">Select frequency</option>
                                {FEE_FREQUENCY_OPTIONS.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </SelectField>
                            </div>}
                            {!postpaid && fee.billingFrequency === 'CUSTOM' ? (
                              <div className="sm:col-span-2">
                                <FormInput
                                  id={`${prefix}-custom-interval-months`}
                                  label="Interval (months)"
                                  aria-label={`Fee ${index + 1} custom interval months`}
                                  type="number"
                                  min={1}
                                  max={120}
                                  disabled={disabled || sectionsDisabled}
                                  value={scheduleConfig.customInterval?.count ?? 1}
                                  hint="Months"
                                  onChange={(event) => updateFee({ scheduleConfig: { ...scheduleConfig, customInterval: { unit: 'MONTH', count: Number(event.target.value) } } })}
                                />
                              </div>
                            ) : null}
                            <div className={fee.billingFrequency === 'CUSTOM' ? 'sm:col-span-2 flex justify-end' : 'sm:col-span-2 flex justify-end'}>
                              <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                className="w-full sm:w-auto text-status-error hover:bg-status-error/10 border-status-error/30 hover:border-status-error/50 min-h-[38px]"
                                disabled={disabled || sectionsDisabled || values.fees.length === 1}
                                onClick={() => updateValue('fees', values.fees.filter((item) => item.uiId !== fee.uiId))}
                              >
                                Remove fee
                              </Button>
                            </div>
                          </div>

                          {tiered ? (
                            <TieredPricingFields
                              idPrefix={prefix}
                              label={`Fee ${index + 1}`}
                              currency={fee.currency || 'SGD'}
                              disabled={disabled || sectionsDisabled}
                              value={fee.tieredPricing!}
                              error={errors[`${prefix}-tiers`]}
                              onChange={(tieredPricing) => updateFee({ tieredPricing })}
                            />
                          ) : null}
                        </div>
                      );
                    })}
                  </div>

                  <BillingPreviewPanel items={billingItems} />
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
      <ConfirmDialog
        isOpen={billingHideConfirmationOpen}
        onClose={() => setBillingHideConfirmationOpen(false)}
        onConfirm={confirmBillingHide}
        title="Hide billing schedules?"
        description="This will archive the active billing schedules when you save this service. Existing billing history is preserved."
        confirmLabel="Hide schedules"
        variant="danger"
      />
      <ConfirmDialog
        isOpen={engagementStartPrompt !== null}
        onClose={() => {
          // Keep the filing either way; only the engagement start is optional.
          if (engagementStartPrompt) onCompanyObligationStatusChange?.(engagementStartPrompt.item, engagementStartPrompt.status);
          setEngagementStartPrompt(null);
        }}
        onConfirm={async () => {
          if (!engagementStartPrompt) return;
          const { item, status } = engagementStartPrompt;
          setEngagementStartPrompt(null);
          // Save the new start first so the filing bills against it.
          await onEngagementStartChange?.(item.yearOfAssessment);
          await onCompanyObligationStatusChange?.(item, status);
        }}
        title={`Start engagement from YA ${engagementStartPrompt?.item.yearOfAssessment ?? ''}?`}
        description={engagementStartPrompt
          ? `YA ${engagementStartPrompt.item.yearOfAssessment} is before this service's engagement start (YA ${engagementStartYearOfAssessment}), so filing it won't raise a postpaid bill. Move the engagement start to YA ${engagementStartPrompt.item.yearOfAssessment} so it bills?`
          : undefined}
        confirmLabel={`Start from YA ${engagementStartPrompt?.item.yearOfAssessment ?? ''}`}
        cancelLabel="Keep current start"
        variant="info"
      />
    </>
  );
}
