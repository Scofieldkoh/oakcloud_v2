'use client';

import { useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormInput } from '@/components/ui/form-input';
import type {
  BillingFrequency,
  CreateServiceVariantInput,
  ServiceCadence,
  ServiceVariantFeeTemplateInput,
  UpdateServiceVariantInput,
} from '@/lib/validations/service-catalog';
import type {
  ServiceVariantRuleAssociationInput,
} from '@/lib/validations/deadline-rule';
import type { ScheduleEntryInput } from '@/lib/validations/service-schedule';
import { ScheduleEntryEditor } from '@/components/services/shared/schedule-entry-editor';
import { BillingTimingFields } from '@/components/services/shared/billing-timing-fields';
import { TieredPricingFields } from '@/components/services/shared/tiered-pricing-fields';
import type {
  ServiceVariantDeadlineRuleDto,
  ServiceVariantDto,
} from '@/services/service-catalog/types';
import type { DeadlineRuleParameterDto } from '@/services/deadline-rule';
import {
  MONITORING_PROFILES,
  MONITORING_PROFILE_HINTS,
  MONITORING_PROFILE_LABELS,
  type MonitoringProfile,
} from '@/services/compliance-monitoring/catalog';

export interface ServicePartialOption {
  id: string;
  name: string;
  displayName: string | null;
}

export type ServiceVariantDeadlineRuleOption = {
  id: string;
  code: string;
  name: string;
  parameters: Array<Pick<DeadlineRuleParameterDto, 'key' | 'label' | 'type' | 'required' | 'validation' | 'defaultValue'>>;
};

interface ServiceVariantFormProps {
  familyId: string;
  initialValue?: ServiceVariantDto;
  partials: ServicePartialOption[];
  isLoadingPartials?: boolean;
  onCancel: () => void;
  onSubmit: (
    input: CreateServiceVariantInput | UpdateServiceVariantInput,
  ) => Promise<void>;
  isSubmitting?: boolean;
  isLoadingDeadlineRules?: boolean;
  availableDeadlineRules?: ServiceVariantDeadlineRuleOption[];
}

type ParameterDefaultType = 'STRING' | 'INTEGER' | 'DECIMAL' | 'BOOLEAN' | 'DATE' | 'ENUM';

type DeadlineRuleFormRow = ServiceVariantRuleAssociationInput & {
  parameterTypes: Record<string, ParameterDefaultType>;
};

function inferParameterType(value: unknown): ParameterDefaultType {
  if (typeof value === 'boolean') return 'BOOLEAN';
  if (typeof value === 'number') return Number.isInteger(value) ? 'INTEGER' : 'DECIMAL';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return 'DATE';
  return 'STRING';
}

function validationOptions(value: unknown): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
  const options = (value as { options?: unknown }).options;
  return Array.isArray(options) ? options.filter((option): option is string => typeof option === 'string') : [];
}

function isCompatibleParameterDefault(
  value: unknown,
  definition: ServiceVariantDeadlineRuleOption['parameters'][number],
): boolean {
  switch (definition.type) {
    case 'STRING':
      return typeof value === 'string';
    case 'INTEGER':
      return typeof value === 'number' && Number.isInteger(value) && Number.isFinite(value);
    case 'DECIMAL':
      return typeof value === 'number' && Number.isFinite(value);
    case 'BOOLEAN':
      return typeof value === 'boolean';
    case 'DATE':
      return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
    case 'ENUM':
      return typeof value === 'string' && validationOptions(definition.validation).includes(value);
    default:
      return false;
  }
}

function defaultsForRuleOption(option: ServiceVariantDeadlineRuleOption): Pick<DeadlineRuleFormRow, 'parameterDefaults' | 'parameterTypes'> {
  const parameterDefaults: Record<string, unknown> = {};
  const parameterTypes: Record<string, ParameterDefaultType> = {};
  option.parameters.forEach((definition) => {
    parameterTypes[definition.key] = definition.type;
    if (definition.defaultValue !== undefined && isCompatibleParameterDefault(definition.defaultValue, definition)) {
      parameterDefaults[definition.key] = definition.defaultValue;
    }
  });
  return { parameterDefaults, parameterTypes };
}

function toScheduleEntries(value: unknown): ScheduleEntryInput[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is ScheduleEntryInput => (
    typeof entry === 'object'
    && entry !== null
    && typeof (entry as Record<string, unknown>).key === 'string'
    && typeof (entry as Record<string, unknown>).label === 'string'
    && typeof (entry as Record<string, unknown>).expression === 'object'
    && (entry as Record<string, unknown>).expression !== null
    && typeof (entry as Record<string, unknown>).businessDayAdjustment === 'string'
  ));
}

function ruleRowFromDto(rule: ServiceVariantDeadlineRuleDto): DeadlineRuleFormRow {
  const parameterDefaults = rule.parameterDefaults ?? {};
  return {
    ruleId: rule.ruleId,
    enabledByDefault: rule.enabledByDefault,
    parameterDefaults,
    scheduleDefaults: toScheduleEntries(rule.scheduleDefaults),
    displayOrder: rule.displayOrder,
    parameterTypes: Object.fromEntries(
      Object.entries(parameterDefaults).map(([key, value]) => [key, inferParameterType(value)]),
    ),
  };
}

function emptyRuleRow(displayOrder: number): DeadlineRuleFormRow {
  return {
    ruleId: '',
    enabledByDefault: true,
    parameterDefaults: {},
    scheduleDefaults: [],
    displayOrder,
    parameterTypes: {},
  };
}

function parseParameterValue(value: string, type: ParameterDefaultType): unknown {
  if (type === 'BOOLEAN') return value === 'true';
  if (type === 'INTEGER') return Number.parseInt(value, 10);
  if (type === 'DECIMAL') return Number.parseFloat(value);
  return value;
}

const CADENCES: Array<{ value: ServiceCadence; label: string }> = [
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'QUARTERLY', label: 'Quarterly' },
  { value: 'SEMI_ANNUALLY', label: 'Semi-annually' },
  { value: 'ANNUALLY', label: 'Annually' },
  { value: 'ONE_TIME', label: 'One time' },
  { value: 'AD_HOC', label: 'Ad hoc' },
  { value: 'CUSTOM', label: 'Custom' },
];

const BILLING_FREQUENCIES: Array<{
  value: BillingFrequency;
  label: string;
}> = CADENCES.filter(
  (cadence): cadence is { value: BillingFrequency; label: string } =>
    cadence.value !== 'AD_HOC',
);

function emptyFee(displayOrder: number): ServiceVariantFeeTemplateInput {
  return {
    description: '',
    defaultAmount: null,
    currency: 'SGD',
    billingFrequency: 'MONTHLY',
    customFrequencyLabel: null,
    billingTiming: 'PREPAID',
    postpaidTrigger: null,
    tieredPricing: null,
    displayOrder,
  };
}

export function ServiceVariantForm({
  familyId,
  initialValue,
  partials,
  isLoadingPartials = false,
  onCancel,
  onSubmit,
  isSubmitting = false,
  isLoadingDeadlineRules = false,
  availableDeadlineRules = [],
}: ServiceVariantFormProps) {
  const [code, setCode] = useState(initialValue?.code ?? '');
  const [name, setName] = useState(initialValue?.name ?? '');
  const [description, setDescription] = useState(initialValue?.description ?? '');
  const [sowPartialId, setSowPartialId] = useState(
    initialValue?.sowPartial.id ?? partials[0]?.id ?? '',
  );
  const [serviceCadence, setServiceCadence] = useState<ServiceCadence>(
    initialValue?.serviceCadence ?? 'MONTHLY',
  );
  const [customCadenceLabel, setCustomCadenceLabel] = useState(
    initialValue?.customCadenceLabel ?? '',
  );
  const [displayOrder, setDisplayOrder] = useState(
    String(initialValue?.displayOrder ?? 0),
  );
  const [isActive, setIsActive] = useState(initialValue?.isActive ?? true);
  const [monitoringProfiles, setMonitoringProfiles] = useState<MonitoringProfile[]>(
    initialValue?.monitoringProfiles ?? [],
  );
  const [feeTemplates, setFeeTemplates] = useState<
    ServiceVariantFeeTemplateInput[]
  >(
    initialValue?.feeTemplates.map((fee) => ({
      ...fee,
      defaultAmount: fee.defaultAmount,
    })) ?? [],
  );
  const [deadlineRules, setDeadlineRules] = useState<DeadlineRuleFormRow[]>(
    initialValue?.deadlineRules?.map(ruleRowFromDto) ?? [],
  );

  const updateFee = (
    index: number,
    values: Partial<ServiceVariantFeeTemplateInput>,
  ) => {
    setFeeTemplates((current) =>
      current.map((fee, feeIndex) =>
        feeIndex === index ? { ...fee, ...values } : fee,
      ),
    );
  };

  const moveFee = (index: number, direction: -1 | 1) => {
    setFeeTemplates((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((fee, displayOrderValue) => ({
        ...fee,
        displayOrder: displayOrderValue,
      }));
    });
  };

  const removeFee = (index: number) => {
    setFeeTemplates((current) =>
      current
        .filter((_, feeIndex) => feeIndex !== index)
        .map((fee, displayOrderValue) => ({
          ...fee,
          displayOrder: displayOrderValue,
        })),
    );
  };

  const updateDeadlineRule = (
    index: number,
    values: Partial<DeadlineRuleFormRow>,
  ) => {
    setDeadlineRules((current) => current.map((rule, ruleIndex) => (
      ruleIndex === index ? { ...rule, ...values } : rule
    )));
  };

  const moveDeadlineRule = (index: number, direction: -1 | 1) => {
    setDeadlineRules((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((rule, displayOrderValue) => ({
        ...rule,
        displayOrder: displayOrderValue,
      }));
    });
  };

  const removeDeadlineRule = (index: number) => {
    setDeadlineRules((current) => current
      .filter((_, ruleIndex) => ruleIndex !== index)
      .map((rule, displayOrderValue) => ({ ...rule, displayOrder: displayOrderValue })));
  };

  const addParameterDefault = (ruleIndex: number) => {
    const row = deadlineRules[ruleIndex];
    if (!row) return;
    let key = 'parameter';
    let suffix = 2;
    while (Object.prototype.hasOwnProperty.call(row.parameterDefaults, key)) {
      key = `parameter${suffix}`;
      suffix += 1;
    }
    updateDeadlineRule(ruleIndex, {
      parameterDefaults: { ...row.parameterDefaults, [key]: '' },
      parameterTypes: { ...row.parameterTypes, [key]: 'STRING' },
    });
  };

  const updateParameterDefault = (
    ruleIndex: number,
    key: string,
    value: string,
    type: ParameterDefaultType,
  ) => {
    const row = deadlineRules[ruleIndex];
    if (!row) return;
    updateDeadlineRule(ruleIndex, {
      parameterDefaults: {
        ...row.parameterDefaults,
        [key]: parseParameterValue(value, type),
      },
      parameterTypes: { ...row.parameterTypes, [key]: type },
    });
  };

  const renameParameterDefault = (ruleIndex: number, oldKey: string, newKey: string) => {
    const row = deadlineRules[ruleIndex];
    if (!row || !newKey || oldKey === newKey || Object.prototype.hasOwnProperty.call(row.parameterDefaults, newKey)) return;
    const parameterDefaults = { ...row.parameterDefaults };
    const parameterTypes = { ...row.parameterTypes };
    parameterDefaults[newKey] = parameterDefaults[oldKey];
    parameterTypes[newKey] = parameterTypes[oldKey] ?? inferParameterType(parameterDefaults[oldKey]);
    delete parameterDefaults[oldKey];
    delete parameterTypes[oldKey];
    updateDeadlineRule(ruleIndex, { parameterDefaults, parameterTypes });
  };

  const removeParameterDefault = (ruleIndex: number, key: string) => {
    const row = deadlineRules[ruleIndex];
    if (!row) return;
    const parameterDefaults = { ...row.parameterDefaults };
    const parameterTypes = { ...row.parameterTypes };
    delete parameterDefaults[key];
    delete parameterTypes[key];
    updateDeadlineRule(ruleIndex, { parameterDefaults, parameterTypes });
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    await onSubmit({
      familyId,
      sowPartialId,
      code,
      name,
      description: description || null,
      serviceCadence,
      customCadenceLabel:
        serviceCadence === 'CUSTOM' ? customCadenceLabel : null,
      displayOrder: Number.parseInt(displayOrder, 10) || 0,
      isActive,
      monitoringProfiles,
      feeTemplates: feeTemplates.map((fee, index) => ({
        ...fee,
        defaultAmount: fee.defaultAmount || null,
        customFrequencyLabel:
          fee.billingFrequency === 'CUSTOM' && fee.billingTiming !== 'POSTPAID'
            ? fee.customFrequencyLabel
            : null,
        billingTiming: fee.billingTiming ?? 'PREPAID',
        postpaidTrigger: fee.billingTiming === 'POSTPAID' ? fee.postpaidTrigger ?? null : null,
        tieredPricing: fee.billingTiming === 'POSTPAID' ? fee.tieredPricing ?? null : null,
        // A tiered fee is priced by its tiers, not a default amount.
        ...(fee.billingTiming === 'POSTPAID' && fee.tieredPricing ? { defaultAmount: null } : {}),
        displayOrder: index,
      })),
      deadlineRules: deadlineRules.map(({ parameterTypes: _parameterTypes, ...rule }) => ({
        ...rule,
        displayOrder: rule.displayOrder,
      })),
    });
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="max-h-[70vh] space-y-5 overflow-y-auto p-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormInput
            label="Variant code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="MONTHLY-ACCOUNTING"
            required
          />
          <FormInput
            label="Variant name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Monthly accounting"
            required
          />
        </div>

        <label className="block text-xs font-medium text-text-secondary">
          Description
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={2}
            className="mt-2 w-full rounded-lg border border-border-primary bg-background-primary px-3.5 py-2 text-sm text-text-primary focus:border-oak-primary focus:outline-none focus:ring-2 focus:ring-oak-primary/30"
          />
        </label>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block text-xs font-medium text-text-secondary">
            SOW partial
            <select
              aria-label="SOW partial"
              value={sowPartialId}
              onChange={(event) => setSowPartialId(event.target.value)}
              disabled={isLoadingPartials}
              required
              className="mt-2 h-9 w-full rounded-lg border border-border-primary bg-background-primary px-3 text-sm text-text-primary"
            >
              <option value="">
                {isLoadingPartials ? 'Loading partials…' : 'Select a partial'}
              </option>
              {partials.map((partial) => (
                <option key={partial.id} value={partial.id}>
                  {partial.displayName || partial.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-medium text-text-secondary">
            Service cadence
            <select
              value={serviceCadence}
              onChange={(event) =>
                setServiceCadence(event.target.value as ServiceCadence)
              }
              className="mt-2 h-9 w-full rounded-lg border border-border-primary bg-background-primary px-3 text-sm text-text-primary"
            >
              {CADENCES.map((cadence) => (
                <option key={cadence.value} value={cadence.value}>
                  {cadence.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {serviceCadence === 'CUSTOM' ? (
          <FormInput
            label="Custom cadence label"
            value={customCadenceLabel}
            onChange={(event) => setCustomCadenceLabel(event.target.value)}
            required
          />
        ) : null}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormInput
            label="Display order"
            type="number"
            min={0}
            value={displayOrder}
            onChange={(event) => setDisplayOrder(event.target.value)}
          />
          <label className="flex min-h-11 items-center gap-2 self-end text-sm text-text-secondary">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(event) => setIsActive(event.target.checked)}
            />
            Active
          </label>
        </div>

        <section className="border-t border-border-primary pt-4">
          <h3 className="text-sm font-semibold text-text-primary">Compliance monitoring</h3>
          <p className="mb-2 text-xs text-text-muted">
            Once an agreement for this service is activated, Oakcloud tracks the company&apos;s statutory deadlines from the agreement date.
          </p>
          <div className="flex flex-col gap-1">
            {MONITORING_PROFILES.map((profile) => (
              <label key={profile} className="flex min-h-11 items-center gap-2 text-sm text-text-secondary">
                <input
                  type="checkbox"
                  checked={monitoringProfiles.includes(profile)}
                  onChange={(event) => setMonitoringProfiles((current) => (
                    event.target.checked
                      ? [...current.filter((value) => value !== profile), profile]
                      : current.filter((value) => value !== profile)
                  ))}
                />
                {MONITORING_PROFILE_LABELS[profile]}
                <span className="text-xs text-text-muted">· {MONITORING_PROFILE_HINTS[profile]}</span>
              </label>
            ))}
          </div>
        </section>

        <section className="border-t border-border-primary pt-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-text-primary">
                Default fee templates
              </h3>
              <p className="text-xs text-text-muted">
                Entity-agnostic defaults copied into agreements.
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              leftIcon={<Plus className="h-4 w-4" />}
              onClick={() =>
                setFeeTemplates((current) => [
                  ...current,
                  emptyFee(current.length),
                ])
              }
            >
              Add fee row
            </Button>
          </div>

          {feeTemplates.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border-primary p-4 text-center text-xs text-text-muted">
              No default fee rows.
            </p>
          ) : (
            <div className="space-y-3">
              {feeTemplates.map((fee, index) => (
                <div
                  key={fee.id ?? `new-fee-${index}`}
                  className="rounded-lg border border-border-primary bg-background-primary p-3"
                >
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <FormInput
                      label="Fee description"
                      value={fee.description}
                      onChange={(event) =>
                        updateFee(index, { description: event.target.value })
                      }
                      required
                    />
                    {fee.billingTiming === 'POSTPAID' && fee.tieredPricing ? null : <FormInput
                      label="Default amount"
                      inputMode="decimal"
                      value={fee.defaultAmount ?? ''}
                      onChange={(event) =>
                        updateFee(index, {
                          defaultAmount: event.target.value || null,
                        })
                      }
                      placeholder="0.00"
                    />}
                    <FormInput
                      label="Currency"
                      value={fee.currency}
                      maxLength={3}
                      onChange={(event) =>
                        updateFee(index, {
                          currency: event.target.value.toUpperCase(),
                        })
                      }
                      required
                    />
                    {fee.billingTiming === 'POSTPAID' ? null : <label className="block text-xs font-medium text-text-secondary">
                      Billing frequency
                      <select
                        value={fee.billingFrequency}
                        onChange={(event) =>
                          updateFee(index, {
                            billingFrequency: event.target
                              .value as BillingFrequency,
                          })
                        }
                        className="mt-2 h-8 w-full rounded-lg border border-border-primary bg-background-secondary px-3 text-sm text-text-primary"
                      >
                        {BILLING_FREQUENCIES.map((frequency) => (
                          <option key={frequency.value} value={frequency.value}>
                            {frequency.label}
                          </option>
                        ))}
                      </select>
                    </label>}
                  </div>
                  <div className="mt-3">
                    <BillingTimingFields
                      idPrefix={`fee-template-${index}`}
                      label={`Fee row ${index + 1}`}
                      value={{
                        billingTiming: fee.billingTiming ?? 'PREPAID',
                        postpaidTrigger: fee.postpaidTrigger ?? null,
                        tieredPricing: fee.tieredPricing ?? null,
                      }}
                      onChange={(timing) => updateFee(index, timing)}
                    />
                  </div>
                  {fee.billingTiming === 'POSTPAID' && fee.tieredPricing ? (
                    <div className="mt-3">
                      <TieredPricingFields
                        idPrefix={`fee-template-${index}`}
                        label={`Fee row ${index + 1}`}
                        currency={fee.currency || 'SGD'}
                        value={fee.tieredPricing}
                        onChange={(tieredPricing) => updateFee(index, { tieredPricing })}
                      />
                    </div>
                  ) : null}
                  {fee.billingFrequency === 'CUSTOM' && fee.billingTiming !== 'POSTPAID' ? (
                    <div className="mt-3">
                      <FormInput
                        label="Custom frequency label"
                        value={fee.customFrequencyLabel ?? ''}
                        onChange={(event) =>
                          updateFee(index, {
                            customFrequencyLabel: event.target.value,
                          })
                        }
                        required
                      />
                    </div>
                  ) : null}
                  <div className="mt-3 flex justify-end gap-1">
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      iconOnly
                      aria-label={`Move fee row ${index + 1} up`}
                      disabled={index === 0}
                      onClick={() => moveFee(index, -1)}
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      iconOnly
                      aria-label={`Move fee row ${index + 1} down`}
                      disabled={index === feeTemplates.length - 1}
                      onClick={() => moveFee(index, 1)}
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      iconOnly
                      aria-label={`Remove fee row ${index + 1}`}
                      onClick={() => removeFee(index)}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-status-error" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="border-t border-border-primary pt-4" aria-labelledby="deadline-rules-heading">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 id="deadline-rules-heading" className="text-sm font-semibold text-text-primary">
                Deadline rules
              </h3>
              <p className="text-xs text-text-muted">
                Configure associations, typed parameter defaults, and repeatable schedule entries (0–31 per rule).
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="min-h-[44px]"
              leftIcon={<Plus className="h-4 w-4" />}
              onClick={() => setDeadlineRules((current) => [...current, emptyRuleRow(current.length)])}
              disabled={deadlineRules.length >= 100}
            >
              Add deadline rule
            </Button>
          </div>

          {deadlineRules.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border-primary p-4 text-center text-xs text-text-muted">
              No deadline rules associated with this variant.
            </p>
          ) : (
            <div className="space-y-4">
              {deadlineRules.map((rule, index) => {
                const selectedRule = availableDeadlineRules.find((option) => option.id === rule.ruleId);
                const parameterDefinitions = selectedRule?.parameters ?? [];
                const parameterKeys = [...new Set([
                  ...parameterDefinitions.map((parameter) => parameter.key),
                  ...Object.keys(rule.parameterDefaults),
                ])];
                return (
                <div
                  key={`${rule.ruleId || 'new-rule'}-${index}`}
                  className="space-y-4 rounded-lg border border-border-primary bg-background-primary p-3"
                >
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
                    <label className="block text-xs font-medium text-text-secondary">
                      Deadline rule
                      <select
                        aria-label={`Deadline rule ${index + 1}`}
                        value={rule.ruleId}
                        onChange={(event) => {
                          const ruleId = event.target.value;
                          const selectedOption = availableDeadlineRules.find((option) => option.id === ruleId);
                          const rebuilt = selectedOption ? defaultsForRuleOption(selectedOption) : { parameterDefaults: {}, parameterTypes: {} };
                          updateDeadlineRule(index, {
                            ruleId,
                            ...rebuilt,
                            // Schedule defaults belong to the association, not
                            // the previous rule. Reset them on reassignment so
                            // entries from rule A cannot be sent to rule B.
                            scheduleDefaults: [],
                          });
                        }}
                        disabled={isLoadingDeadlineRules || availableDeadlineRules.length === 0}
                        className="mt-2 min-h-[44px] w-full rounded-lg border border-border-primary bg-background-secondary px-3 text-sm text-text-primary"
                        required
                      >
                        <option value="">{isLoadingDeadlineRules ? 'Loading active deadline rules…' : availableDeadlineRules.length > 0 ? 'Select a rule' : 'No active deadline rules available'}</option>
                        {rule.ruleId && !availableDeadlineRules.some((option) => option.id === rule.ruleId) ? <option value={rule.ruleId}>Current associated rule</option> : null}
                        {availableDeadlineRules.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.code} · {option.name}
                          </option>
                        ))}
                      </select>
                      <span className="mt-1 block text-[11px] text-text-muted">Changing the rule resets typed defaults and schedule entries for the new rule.</span>
                    </label>
                    <label className="flex min-h-[44px] items-center gap-2 text-sm text-text-secondary">
                      <input
                        type="checkbox"
                        checked={rule.enabledByDefault}
                        onChange={(event) => updateDeadlineRule(index, { enabledByDefault: event.target.checked })}
                      />
                      Enabled by default
                    </label>
                    <p className="text-xs text-text-muted">Position {rule.displayOrder + 1}; use the move controls below to reorder.</p>
                  </div>

                  <section aria-labelledby={`deadline-parameters-${index}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h4 id={`deadline-parameters-${index}`} className="text-xs font-semibold text-text-primary">Parameter defaults</h4>
                        <p className="mt-1 text-xs text-text-muted">Values are sent as typed JSON defaults.</p>
                      </div>
                      <Button type="button" size="xs" variant="secondary" className="min-h-[44px]" onClick={() => addParameterDefault(index)} disabled={parameterDefinitions.length > 0}>Add parameter</Button>
                    </div>
                    {parameterKeys.length === 0 ? (
                      <p className="mt-2 text-xs text-text-muted">No parameter defaults.</p>
                    ) : (
                      <div className="mt-2 space-y-2">
                        {parameterKeys.map((key) => {
                          const definition = parameterDefinitions.find((parameter) => parameter.key === key);
                          const value = Object.prototype.hasOwnProperty.call(rule.parameterDefaults, key) ? rule.parameterDefaults[key] : definition?.defaultValue;
                          const type = definition?.type ?? rule.parameterTypes[key] ?? inferParameterType(value);
                          const stringValue = type === 'BOOLEAN' ? String(value ?? false) : String(value ?? '');
                          const enumOptions = validationOptions(definition?.validation);
                          return (
                            <div key={key} className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_140px_minmax(0,1fr)_auto] sm:items-end">
                              {definition ? <div className="min-h-[44px] rounded-lg border border-border-secondary px-3 py-2"><span className="block text-xs font-medium text-text-secondary">{definition.label || 'Parameter'}</span><span className="font-mono text-xs text-text-muted">{key}</span></div> : <FormInput label="Parameter key" value={key} onChange={(event) => renameParameterDefault(index, key, event.target.value.trim())} className="min-h-[44px]" />}
                              {definition ? <p className="min-h-[44px] rounded-lg border border-border-secondary px-3 py-3 text-xs text-text-secondary">{type}</p> : <label className="block text-xs font-medium text-text-secondary">Type<select aria-label={`Parameter type ${key}`} value={type} onChange={(event) => updateParameterDefault(index, key, stringValue, event.target.value as ParameterDefaultType)} className="mt-2 min-h-[44px] w-full rounded-lg border border-border-primary bg-background-secondary px-2 text-sm text-text-primary"><option value="STRING">Text</option><option value="INTEGER">Integer</option><option value="DECIMAL">Decimal</option><option value="BOOLEAN">Boolean</option><option value="DATE">Date</option><option value="ENUM">Enum</option></select></label>}
                              {type === 'BOOLEAN' ? <label className="block text-xs font-medium text-text-secondary">Value<select aria-label={`Parameter value ${key}`} value={stringValue} onChange={(event) => updateParameterDefault(index, key, event.target.value, type)} className="mt-2 min-h-[44px] w-full rounded-lg border border-border-primary bg-background-secondary px-2 text-sm text-text-primary"><option value="true">True</option><option value="false">False</option></select></label> : type === 'ENUM' && enumOptions.length > 0 ? <label className="block text-xs font-medium text-text-secondary">Value<select aria-label={`Parameter value ${key}`} value={stringValue} onChange={(event) => updateParameterDefault(index, key, event.target.value, type)} className="mt-2 min-h-[44px] w-full rounded-lg border border-border-primary bg-background-secondary px-2 text-sm text-text-primary"><option value="">Select an option</option>{enumOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select></label> : <FormInput label="Value" type={type === 'DATE' ? 'date' : type === 'INTEGER' || type === 'DECIMAL' ? 'number' : 'text'} value={stringValue} onChange={(event) => updateParameterDefault(index, key, event.target.value, type)} className="min-h-[44px]" />}
                              <Button type="button" size="xs" variant="ghost" iconOnly className="min-h-[44px] min-w-[44px]" aria-label={`Remove parameter ${key}`} onClick={() => removeParameterDefault(index, key)} disabled={Boolean(definition)}><Trash2 className="h-4 w-4 text-status-error" /></Button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>

                  <ScheduleEntryEditor
                    value={rule.scheduleDefaults}
                    onChange={(scheduleDefaults) => updateDeadlineRule(index, { scheduleDefaults })}
                  />

                  <div className="flex flex-wrap justify-end gap-1 border-t border-border-secondary pt-2">
                    <Button type="button" size="xs" variant="ghost" className="min-h-[44px]" aria-label={`Move deadline rule ${index + 1} up`} disabled={index === 0} onClick={() => moveDeadlineRule(index, -1)}><ArrowUp className="h-3.5 w-3.5" /></Button>
                    <Button type="button" size="xs" variant="ghost" className="min-h-[44px]" aria-label={`Move deadline rule ${index + 1} down`} disabled={index === deadlineRules.length - 1} onClick={() => moveDeadlineRule(index, 1)}><ArrowDown className="h-3.5 w-3.5" /></Button>
                    <Button type="button" size="xs" variant="ghost" className="min-h-[44px]" aria-label={`Remove deadline rule ${index + 1}`} onClick={() => removeDeadlineRule(index)}><Trash2 className="h-3.5 w-3.5 text-status-error" /></Button>
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border-primary p-4">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" isLoading={isSubmitting}>
          {initialValue ? 'Save variant' : 'Create variant'}
        </Button>
      </div>
    </form>
  );
}
