import type { BillingFrequency, ClientServiceStatus, ServiceCadence } from '@/generated/prisma';
import type { ClientServiceDeadlineRuleDto, ClientServiceDto, ClientServiceProjectedDeadlineDto, ManualClientServiceCatalogDeadlineRule, ManualClientServiceCatalogField, ManualClientServiceCatalogParameterDefinition, ManualClientServiceCatalogVariantOption } from '@/services/client-service';
import type { ClientServiceDeadlineRuleInput } from '@/lib/validations/client-service';
import type { ScheduleEntryInput } from '@/lib/validations/service-schedule';
import type { BillingScheduleConfigV1 } from '@/services/billing/types';
import { canonicalizeBillingSchedule } from '@/services/billing/schedule';
import type { BillingTiming, PostpaidTrigger } from '@/services/billing/postpaid-triggers';
import { tieredPricingErrors, type TieredPricing } from '@/services/billing/tiered-pricing';

export type DeadlinePreviewState =
  | { state: 'IDLE'; items: ClientServiceProjectedDeadlineDto[]; warnings: string[] }
  | { state: 'LOADING'; items: ClientServiceProjectedDeadlineDto[]; warnings: string[] }
  | { state: 'SUCCESS'; items: ClientServiceProjectedDeadlineDto[]; warnings: string[]; fingerprint: string; payloadHash: string }
  | { state: 'ERROR'; items: []; warnings: []; message: string };

export interface OperationalFieldRow {
  uiId: string;
  key: string;
  label: string;
  type: ManualClientServiceCatalogField['type'];
  value: string;
  catalogDerived: boolean;
}

export interface OperationalFeeRow {
  uiId: string;
  id?: string;
  description: string;
  amount: string;
  currency: string;
  billingFrequency: BillingFrequency | '';
  customFrequencyLabel: string;
  billingStartDate: string;
  scheduleConfig?: BillingScheduleConfigV1 | null;
  /** Prepaid follows the schedule; postpaid bills when its trigger filing is Filed. */
  billingTiming?: BillingTiming;
  postpaidTrigger?: PostpaidTrigger | null;
  /** Postpaid only: quantity tiers; null or absent for a fixed amount. */
  tieredPricing?: TieredPricing | null;
  catalogDerived: boolean;
}

export interface OperationalDeadlineRuleRow {
  uiId: string;
  ruleId: string;
  code: string;
  name: string;
  enabled: boolean;
  parameterValues: Record<string, unknown>;
  parameterProvenance: Record<string, 'COMPANY' | 'CATALOG_DEFAULT' | 'CLIENT_OVERRIDE'>;
  scheduleEntries: ScheduleEntryInput[];
  parameters: ManualClientServiceCatalogParameterDefinition[];
  applicabilityState?: 'PENDING_EVALUATION' | 'APPLICABLE' | 'NOT_APPLICABLE' | 'MISSING_INPUT';
  applicabilityReason?: string | null;
  catalogDerived: boolean;
}

export interface OperationalServiceValues {
  status: ClientServiceStatus;
  serviceCadence: ServiceCadence;
  customCadenceLabel: string;
  startDate: string;
  endDate: string;
  billingDisposition: 'CONFIGURED' | 'NOT_REQUIRED' | 'UNREVIEWED' | '';
  billingNotRequiredReason: string;
  fields: OperationalFieldRow[];
  fees: OperationalFeeRow[];
  deadlineRules: OperationalDeadlineRuleRow[];
}

export type OperationalFieldErrors = Record<string, string | undefined>;

export function validateOperationalServiceValues(values: OperationalServiceValues): OperationalFieldErrors {
  const errors: OperationalFieldErrors = {};
  if (!values.startDate) errors.startDate = 'Start date is required.';
  if (values.serviceCadence === 'CUSTOM' && !values.customCadenceLabel.trim()) {
    errors.customCadenceLabel = 'Custom cadence is required.';
  }
  if (values.endDate && values.startDate && values.endDate < values.startDate) {
    errors.endDate = 'End date must be on or after start date.';
  }
  if (!values.billingDisposition || values.billingDisposition === 'UNREVIEWED') {
    errors.billingDisposition = 'Select Billing configured or No billing required before saving.';
  }
  const activeFees = values.fees.filter((fee) => fee.description.trim() || fee.amount.trim() || fee.billingFrequency);
  if (values.billingDisposition === 'CONFIGURED' && activeFees.length === 0) {
    errors.feeLines = 'Configured billing requires at least one fee line.';
  }
  for (const [index, fee] of (values.billingDisposition === 'NOT_REQUIRED' ? [] : values.fees).entries()) {
    const prefix = `fee-${fee.uiId}`;
    if (!fee.description.trim()) errors[`${prefix}-description`] = `Fee ${index + 1} description is required.`;
    const tiered = fee.billingTiming === 'POSTPAID' && fee.tieredPricing;
    if (!tiered && !/^\d{1,16}(?:\.\d{1,2})?$/.test(fee.amount)) errors[`${prefix}-amount`] = `Fee ${index + 1} amount is invalid.`;
    if (tiered) {
      const [tierError] = tieredPricingErrors(fee.tieredPricing!);
      if (tierError) errors[`${prefix}-tiers`] = `Fee ${index + 1}: ${tierError.message}.`;
    }
    if (!/^[A-Z]{3}$/.test(fee.currency.trim().toUpperCase())) errors[`${prefix}-currency`] = `Fee ${index + 1} currency must be a three-letter code.`;
    if (fee.billingTiming === 'POSTPAID') {
      if (!fee.postpaidTrigger) errors[`${prefix}-trigger`] = `Fee ${index + 1} needs the filing it bills on.`;
      continue;
    }
    if (!fee.billingFrequency) errors[`${prefix}-frequency`] = `Fee ${index + 1} frequency is required.`;
    if (fee.billingFrequency) {
      try {
        const schedule = canonicalizeBillingSchedule({
          billingFrequency: fee.billingFrequency,
          billingStartDate: fee.billingStartDate || values.startDate || null,
          customFrequencyLabel: fee.customFrequencyLabel || (fee.billingFrequency === 'CUSTOM' ? `Every ${fee.scheduleConfig?.customInterval?.count ?? 1} months` : null),
          scheduleConfig: fee.scheduleConfig,
        });
        if (!schedule?.startDate || schedule.scheduleEntries.length === 0) {
          errors.feeLines = 'Each configured fee requires a valid billing start date and at least one schedule entry.';
        }
      } catch (error) {
        errors.feeLines = error instanceof Error ? error.message : 'Billing schedule is invalid.';
      }
    }
  }
  const seenRules = new Set<string>();
  for (const rule of values.deadlineRules) {
    if (seenRules.has(rule.ruleId)) errors.deadlineRules = 'Each deadline rule can only be configured once.';
    seenRules.add(rule.ruleId);
    if (rule.scheduleEntries.length > 31) errors[`deadline-rule-${rule.uiId}-schedule`] = 'A schedule can contain at most 31 entries.';
  }
  return errors;
}

export function operationalErrorsFromServer(
  details: unknown,
  values: OperationalServiceValues,
): OperationalFieldErrors {
  if (!details || typeof details !== 'object' || !('fieldErrors' in details)) return {};
  const fieldErrors = (details as { fieldErrors?: unknown }).fieldErrors;
  if (!fieldErrors || typeof fieldErrors !== 'object') return {};

  const translated: OperationalFieldErrors = {};
  const feeSuffix: Record<string, string> = {
    description: 'description',
    amount: 'amount',
    currency: 'currency',
    billingFrequency: 'frequency',
    customFrequencyLabel: 'custom-frequency',
    billingStartDate: 'billing-start-date',
    postpaidTrigger: 'trigger',
    tieredPricing: 'tiers',
  };

  for (const [path, message] of Object.entries(fieldErrors)) {
    if (typeof message !== 'string') continue;
    const feeMatch = /^feeLines\.(\d+)\.([A-Za-z]+)$/.exec(path);
    if (feeMatch) {
      const fee = values.fees[Number(feeMatch[1])];
      const suffix = feeSuffix[feeMatch[2]];
      if (fee && suffix) translated[`fee-${fee.uiId}-${suffix}`] = message;
      else translated.feeLines = message;
      continue;
    }

    const fieldMatch = /^fieldValues\.([^.]*)$/.exec(path);
    if (fieldMatch) {
      const field = values.fields.find((row) => row.key === fieldMatch[1]);
      translated[field ? `field-${field.uiId}-value` : 'fieldValues'] = message;
      continue;
    }

    const ruleMatch = /^deadlineRules\.(\d+)(?:\.(.*))?$/.exec(path);
    if (ruleMatch) {
      const rule = values.deadlineRules[Number(ruleMatch[1])];
      translated[rule ? `deadline-rule-${rule.uiId}-${ruleMatch[2] ?? 'configuration'}` : 'deadlineRules'] = message;
      continue;
    }

    translated[path || 'body'] = message;
  }
  return translated;
}

export function operationalFieldValues(values: OperationalServiceValues): Record<string, string> {
  return Object.fromEntries(
    values.fields
      .filter((field) => field.key.trim())
      .map((field) => [field.key.trim(), field.value]),
  );
}

/**
 * Postpaid lines carry no schedule; the stored frequency is a placeholder.
 * A tiered line is priced by its tiers, so its stored amount is 0.00.
 */
function postpaidFeeFields(fee: OperationalFeeRow) {
  return {
    ...(fee.tieredPricing ? { amount: '0.00' } : {}),
    billingFrequency: 'ONE_TIME' as const,
    customFrequencyLabel: null,
    billingStartDate: null,
    scheduleConfig: null,
    billingTiming: 'POSTPAID' as const,
    postpaidTrigger: fee.postpaidTrigger ?? null,
    tieredPricing: fee.tieredPricing ?? null,
  };
}

export function manualCreateFeeLines(values: OperationalServiceValues) {
  if (values.billingDisposition === 'NOT_REQUIRED') return [];
  return values.fees.map((fee) => {
    if (fee.billingTiming === 'POSTPAID') {
      return {
        description: fee.description,
        amount: fee.amount,
        currency: fee.currency.trim().toUpperCase(),
        ...postpaidFeeFields(fee),
      };
    }
    if (!fee.billingFrequency) throw new Error('Fee frequency is required');
    return {
      description: fee.description,
      amount: fee.amount,
      currency: fee.currency.trim().toUpperCase(),
      billingFrequency: fee.billingFrequency,
      customFrequencyLabel: fee.billingFrequency === 'CUSTOM'
        ? (fee.customFrequencyLabel?.trim() || `Every ${fee.scheduleConfig?.customInterval?.count ?? 1} months`)
        : null,
      billingStartDate: fee.billingStartDate || values.startDate || null,
      scheduleConfig: fee.scheduleConfig,
      billingTiming: 'PREPAID' as const,
      postpaidTrigger: null,
      tieredPricing: null,
    };
  });
}

export function updateFeeLines(values: OperationalServiceValues) {
  if (values.billingDisposition === 'NOT_REQUIRED') return [];
  return values.fees.map((fee, displayOrder) => {
    if (fee.billingTiming === 'POSTPAID') {
      return {
        ...(fee.id ? { id: fee.id } : {}),
        description: fee.description,
        amount: fee.amount,
        currency: fee.currency.trim().toUpperCase(),
        ...postpaidFeeFields(fee),
        displayOrder,
      };
    }
    if (!fee.billingFrequency) throw new Error('Fee frequency is required');
    return {
      ...(fee.id ? { id: fee.id } : {}),
      description: fee.description,
      amount: fee.amount,
      currency: fee.currency.trim().toUpperCase(),
      billingFrequency: fee.billingFrequency,
      customFrequencyLabel: fee.billingFrequency === 'CUSTOM'
        ? (fee.customFrequencyLabel?.trim() || `Every ${fee.scheduleConfig?.customInterval?.count ?? 1} months`)
        : null,
      billingStartDate: fee.billingStartDate || values.startDate || null,
      scheduleConfig: fee.scheduleConfig,
      billingTiming: 'PREPAID' as const,
      postpaidTrigger: null,
      tieredPricing: null,
      displayOrder,
    };
  });
}

export function deadlineRuleInputs(values: OperationalServiceValues): ClientServiceDeadlineRuleInput[] {
  return values.deadlineRules.map((rule) => ({
    ruleId: rule.ruleId,
    enabled: rule.enabled,
    parameterValues: rule.parameterValues as ClientServiceDeadlineRuleInput['parameterValues'],
    parameterProvenance: rule.parameterProvenance,
    scheduleEntries: rule.scheduleEntries,
  }));
}

export type ClientServiceDeadlineImpactPayload = {
  expectedUpdatedAt: string;
  deadlineRules: ClientServiceDeadlineRuleInput[];
  scheduleSnapshot: {
    status: ClientServiceStatus;
    serviceCadence: ServiceCadence;
    customCadenceLabel: string | null;
    startDate: string;
    endDate: string | null;
    fieldValues: Record<string, string>;
  };
};

/**
 * Build the exact immutable request object used by both the editor preview
 * and the save flow so a matching payload can reuse a preview fingerprint.
 */
export function deadlineImpactPayload(
  values: OperationalServiceValues,
  expectedUpdatedAt: string,
): ClientServiceDeadlineImpactPayload {
  return {
    expectedUpdatedAt,
    deadlineRules: deadlineRuleInputs(values),
    scheduleSnapshot: {
      status: values.status,
      serviceCadence: values.serviceCadence,
      customCadenceLabel: values.serviceCadence === 'CUSTOM' ? values.customCadenceLabel : null,
      startDate: values.startDate,
      endDate: values.endDate || null,
      fieldValues: operationalFieldValues(values),
    },
  };
}

export function deadlineImpactPayloadHash(payload: ClientServiceDeadlineImpactPayload): string {
  return JSON.stringify(payload);
}

export type ClientServiceDeadlineDraftPayload = {
  companyId: string;
  serviceVariantId: string;
  deadlineRules: ClientServiceDeadlineRuleInput[];
  scheduleSnapshot: {
    status: ClientServiceStatus;
    serviceCadence: ServiceCadence;
    customCadenceLabel: string | null;
    startDate: string;
    endDate: string | null;
    fieldValues: Record<string, string>;
  };
};

/**
 * Build the draft projection request used by the add-service flow so the
 * dialog shows exactly what the deadline engine will materialize on save.
 */
export function deadlineDraftPreviewPayload(
  companyId: string,
  serviceVariantId: string,
  values: OperationalServiceValues,
): ClientServiceDeadlineDraftPayload {
  return {
    companyId,
    serviceVariantId,
    deadlineRules: deadlineRuleInputs(values),
    scheduleSnapshot: {
      status: values.status,
      serviceCadence: values.serviceCadence,
      customCadenceLabel: values.serviceCadence === 'CUSTOM' ? values.customCadenceLabel : null,
      startDate: values.startDate,
      endDate: values.endDate || null,
      fieldValues: operationalFieldValues(values),
    },
  };
}

export function impactWarningsToStrings(warnings: Array<{
  ruleId?: string;
  state?: string;
  reason?: string | null;
  code?: string;
  message?: string;
  excludedCycleCount?: number;
  oldestRetainedYear?: number;
}>): string[] {
  return warnings.map((warning) => {
    if (typeof warning.code === 'string') {
      if (warning.code === 'AUTHORITATIVE_BACKLOG_TRUNCATED') {
        const excluded = warning.excludedCycleCount ?? 0;
        const oldest = warning.oldestRetainedYear ?? 'unknown';
        return `Annual deadline backlog was truncated: ${excluded} older cycle${excluded === 1 ? '' : 's'} excluded; oldest retained year is ${oldest}.`;
      }
      return warning.message ?? warning.code;
    }
    return warning.reason ?? warning.state ?? 'Deadline preview warning';
  });
}

function catalogDeadlineRuleRow(rule: ManualClientServiceCatalogDeadlineRule): OperationalDeadlineRuleRow {
  const parameterValues = { ...rule.parameterDefaults };
  for (const parameter of rule.parameters) {
    if (!(parameter.key in parameterValues) && parameter.defaultValue !== null && parameter.defaultValue !== undefined) parameterValues[parameter.key] = parameter.defaultValue;
  }
  return {
    uiId: crypto.randomUUID(),
    ruleId: rule.ruleId,
    code: rule.code,
    name: rule.name,
    enabled: rule.enabledByDefault,
    parameterValues,
    parameterProvenance: Object.fromEntries(Object.keys(parameterValues).map((key) => [key, 'CATALOG_DEFAULT'])) as OperationalDeadlineRuleRow['parameterProvenance'],
    scheduleEntries: rule.scheduleDefaults.map((entry) => ({ ...entry })),
    parameters: rule.parameters,
    applicabilityState: 'PENDING_EVALUATION',
    applicabilityReason: null,
    catalogDerived: true,
  };
}

function serviceDeadlineRuleRow(rule: ClientServiceDeadlineRuleDto): OperationalDeadlineRuleRow {
  const currentVersion = rule.rule?.currentVersion;
  return {
    uiId: crypto.randomUUID(),
    ruleId: rule.ruleId,
    code: rule.rule?.code ?? rule.ruleId,
    name: rule.rule?.name ?? rule.ruleId,
    enabled: rule.enabled,
    parameterValues: { ...rule.parameterValues },
    parameterProvenance: { ...rule.parameterProvenance },
    scheduleEntries: rule.scheduleEntries.map((entry) => ({ ...entry })),
    parameters: currentVersion?.parameters ?? [],
    applicabilityState: rule.applicabilityState,
    applicabilityReason: rule.applicabilityReason,
    catalogDerived: false,
  };
}

function serviceFeeScheduleConfig(
  fee: ClientServiceDto['feeLines'][number],
  fallbackStartDate: string,
): BillingScheduleConfigV1 | null {
  if (fee.scheduleConfig) return fee.scheduleConfig;
  try {
    return canonicalizeBillingSchedule({
      billingFrequency: fee.billingFrequency,
      billingStartDate: fee.billingStartDate ?? fallbackStartDate,
      customFrequencyLabel: fee.customFrequencyLabel,
    });
  } catch {
    // Legacy CUSTOM rows without a structured configuration remain editable;
    // validation will require the user to supply a materializable schedule.
    return null;
  }
}

export function valuesFromClientService(service: ClientServiceDto): OperationalServiceValues {
  return {
    status: service.status,
    serviceCadence: service.serviceCadence,
    customCadenceLabel: service.customCadenceLabel ?? '',
    startDate: service.startDate,
    endDate: service.endDate ?? '',
    billingDisposition: service.billingDisposition ?? 'UNREVIEWED',
    billingNotRequiredReason: service.billingNotRequiredReason ?? '',
    fields: Object.entries(service.fieldValues).map(([key, value]) => ({
      uiId: crypto.randomUUID(),
      key,
      label: key,
      type: 'text' as const,
      value,
      catalogDerived: false,
    })),
    fees: service.feeLines.map((fee) => ({
      uiId: crypto.randomUUID(),
      id: fee.id,
      description: fee.description,
      amount: fee.amount,
      currency: fee.currency,
      billingFrequency: fee.billingFrequency,
      customFrequencyLabel: fee.customFrequencyLabel ?? '',
      billingStartDate: fee.billingStartDate ?? '',
      scheduleConfig: fee.billingTiming === 'POSTPAID' ? null : serviceFeeScheduleConfig(fee, service.startDate),
      billingTiming: fee.billingTiming ?? 'PREPAID',
      postpaidTrigger: fee.postpaidTrigger ?? null,
      tieredPricing: fee.tieredPricing ?? null,
      catalogDerived: false,
    })),
    deadlineRules: (service.deadlineRules ?? []).map(serviceDeadlineRuleRow),
  };
}

export function emptyManualOperationalValues(): OperationalServiceValues {
  return {
    status: 'ACTIVE',
    serviceCadence: 'MONTHLY',
    customCadenceLabel: '',
    startDate: '',
    endDate: '',
    billingDisposition: '',
    billingNotRequiredReason: '',
    fields: [],
    fees: [],
    deadlineRules: [],
  };
}

export function catalogReplacementForVariant(variant: ManualClientServiceCatalogVariantOption): OperationalServiceValues {
  return {
    status: 'ACTIVE',
    serviceCadence: variant.serviceCadence,
    customCadenceLabel: variant.customCadenceLabel ?? '',
    startDate: '',
    endDate: '',
    billingDisposition: variant.feeTemplates.length > 0 ? 'CONFIGURED' : '',
    billingNotRequiredReason: '',
    fields: variant.fields.map((field) => ({
      uiId: crypto.randomUUID(),
      key: field.key,
      label: field.label,
      type: field.type,
      value: field.defaultValue ?? '',
      catalogDerived: true,
    })),
    fees: variant.feeTemplates.length > 0
      ? variant.feeTemplates.map((fee) => ({
        uiId: crypto.randomUUID(),
        description: fee.description,
        amount: fee.defaultAmount ?? '',
        currency: fee.currency,
        billingFrequency: fee.billingFrequency,
         customFrequencyLabel: fee.customFrequencyLabel ?? '',
         billingStartDate: '',
         scheduleConfig: null,
         billingTiming: fee.billingTiming ?? 'PREPAID',
         postpaidTrigger: fee.postpaidTrigger ?? null,
         tieredPricing: fee.tieredPricing ?? null,
         catalogDerived: true,
      }))
      : [{
        uiId: crypto.randomUUID(),
        description: variant.name,
        amount: '',
        currency: 'SGD',
        billingFrequency: '',
         customFrequencyLabel: '',
         billingStartDate: '',
         scheduleConfig: null,
         catalogDerived: true,
      }],
    deadlineRules: (variant.deadlineRules ?? []).map(catalogDeadlineRuleRow),
  };
}

function operationalSignature(values: OperationalServiceValues): string {
  return JSON.stringify({
    serviceCadence: values.serviceCadence,
    customCadenceLabel: values.customCadenceLabel,
    billingDisposition: values.billingDisposition,
    billingNotRequiredReason: values.billingNotRequiredReason,
    fields: values.fields.map(({ key, label, type, value }) => ({ key, label, type, value })),
    fees: values.fees.map(({ description, amount, currency, billingFrequency, customFrequencyLabel, billingStartDate, scheduleConfig, billingTiming, postpaidTrigger, tieredPricing }) => ({
      description,
      amount,
      currency,
      billingFrequency,
      customFrequencyLabel,
      billingStartDate,
      scheduleConfig,
      billingTiming: billingTiming ?? 'PREPAID',
      postpaidTrigger: postpaidTrigger ?? null,
      tieredPricing: tieredPricing ?? null,
    })),
    deadlineRules: values.deadlineRules.map(({ ruleId, enabled, parameterValues, parameterProvenance, scheduleEntries }) => ({ ruleId, enabled, parameterValues, parameterProvenance, scheduleEntries })),
  });
}

export function replacementValuesChanged(values: OperationalServiceValues, replacement: OperationalServiceValues): boolean {
  return operationalSignature(values) !== operationalSignature(replacement);
}

export function createManualPayload(variantId: string, values: OperationalServiceValues, confirmDuplicate: boolean) {
  return {
    serviceVariantId: variantId,
    status: values.status,
    serviceCadence: values.serviceCadence,
    customCadenceLabel: values.serviceCadence === 'CUSTOM' ? values.customCadenceLabel : null,
    startDate: values.startDate,
    endDate: values.endDate || null,
    fieldValues: operationalFieldValues(values),
    billingDisposition: values.billingDisposition === 'CONFIGURED' || values.billingDisposition === 'NOT_REQUIRED'
      ? values.billingDisposition
      : undefined,
    billingNotRequiredReason: values.billingDisposition === 'NOT_REQUIRED'
      ? values.billingNotRequiredReason.trim() || null
      : null,
    feeLines: manualCreateFeeLines(values),
    deadlineRules: deadlineRuleInputs(values),
    confirmDuplicate,
  };
}

function manualDirtySignature(values: OperationalServiceValues): string {
  return JSON.stringify({
    status: values.status,
    serviceCadence: values.serviceCadence,
    customCadenceLabel: values.customCadenceLabel,
    startDate: values.startDate,
    endDate: values.endDate,
    billingDisposition: values.billingDisposition,
    billingNotRequiredReason: values.billingNotRequiredReason,
    fields: values.fields.map(({ key, label, type, value, catalogDerived }) => ({ key, label, type, value, catalogDerived })),
    fees: values.fees.map((fee) => ({
      description: fee.description,
      amount: fee.amount,
      currency: fee.currency,
      billingFrequency: fee.billingFrequency,
      customFrequencyLabel: fee.customFrequencyLabel,
      billingStartDate: fee.billingStartDate,
      scheduleConfig: fee.scheduleConfig,
      billingTiming: fee.billingTiming ?? 'PREPAID',
      postpaidTrigger: fee.postpaidTrigger ?? null,
      tieredPricing: fee.tieredPricing ?? null,
      catalogDerived: fee.catalogDerived,
    })),
    deadlineRules: values.deadlineRules.map((rule) => ({
      ruleId: rule.ruleId,
      enabled: rule.enabled,
      parameterValues: rule.parameterValues,
      parameterProvenance: rule.parameterProvenance,
      scheduleEntries: rule.scheduleEntries,
      catalogDerived: rule.catalogDerived,
    })),
  });
}

export function manualFormIsDirty(
  selectedVariantId: string | null,
  values: OperationalServiceValues,
): boolean {
  return Boolean(selectedVariantId)
    || manualDirtySignature(values) !== manualDirtySignature(emptyManualOperationalValues());
}
