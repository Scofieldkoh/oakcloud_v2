import { z } from 'zod';
import {
  billingFrequencySchema,
  billingTimingSchema,
  postpaidTriggerSchema,
  refineBillingTiming,
  serviceCadenceSchema,
  tieredPricingSchema,
} from '@/lib/validations/service-catalog';
import { billingScheduleConfigSchema, postpaidQuantitiesSchema } from '@/lib/validations/billing';
import { scheduleEntriesSchema } from '@/lib/validations/service-schedule';
import { canonicalizeBillingSchedule } from '@/services/billing/schedule';

const dateOrderIssue = (ctx: z.RefinementCtx) => ctx.addIssue({
  code: z.ZodIssueCode.custom,
  path: ['endDate'],
  message: 'End date must be on or after start date',
});

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(jsonValueSchema),
  z.record(jsonValueSchema),
]));
const jsonObjectSchema = z.record(jsonValueSchema);
const billingDispositionSchema = z.enum(['CONFIGURED', 'NOT_REQUIRED', 'UNREVIEWED']);
const manualBillingDispositionSchema = z.enum(['CONFIGURED', 'NOT_REQUIRED']);

type BillingLineLike = {
  isActive?: boolean;
  billingFrequency?: string;
  billingStartDate?: string | Date | null;
  customFrequencyLabel?: string | null;
  scheduleConfig?: unknown;
  billingTiming?: string;
};

function validateBillingConfiguration(
  value: {
    billingDisposition?: z.infer<typeof billingDispositionSchema>;
    billingNotRequiredReason?: string | null;
    feeLines?: BillingLineLike[];
  },
  ctx: z.RefinementCtx,
  options: { legacyEmptyFeeLinesAreInvalid?: boolean } = {},
) {
  const activeFeeLines = value.feeLines?.filter((line) => line.isActive !== false) ?? [];
  if (value.billingDisposition === 'CONFIGURED' && value.feeLines !== undefined && activeFeeLines.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['feeLines'], message: 'Configured billing requires at least one fee line' });
  }
  if (value.billingDisposition === 'NOT_REQUIRED' && (value.feeLines?.length ?? 0) > 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['feeLines'], message: 'Not-required billing must not include fee lines' });
  }
  if (value.billingDisposition !== 'NOT_REQUIRED' && value.billingNotRequiredReason != null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['billingNotRequiredReason'], message: 'A not-required reason is only valid when billing is not required' });
  }
  if (value.feeLines) {
    value.feeLines.forEach((fee, index) => {
      if (value.billingDisposition === 'NOT_REQUIRED') return;
      // Postpaid lines bill on a filing, not on a schedule.
      if (fee.billingTiming === 'POSTPAID') return;
      try {
        canonicalizeBillingSchedule({
          billingFrequency: fee.billingFrequency ?? '',
          billingStartDate: fee.billingStartDate,
          customFrequencyLabel: fee.customFrequencyLabel,
          scheduleConfig: fee.scheduleConfig,
        }, { requireMaterializable: value.billingDisposition === 'CONFIGURED' });
      } catch (error) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['feeLines', index, 'scheduleConfig'],
          message: error instanceof Error ? error.message : 'Billing schedule is invalid',
        });
      }
    });
  }
  if (options.legacyEmptyFeeLinesAreInvalid && value.billingDisposition === undefined && activeFeeLines.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['feeLines'], message: 'At least one fee line is required' });
  }
}

function validateCadenceAndDates(
  value: { serviceCadence?: string; customCadenceLabel?: string | null; startDate?: string; endDate?: string | null },
  ctx: z.RefinementCtx,
) {
  if (value.serviceCadence === 'CUSTOM' && !value.customCadenceLabel?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['customCadenceLabel'], message: 'Custom cadence label is required' });
  }
  if (value.startDate && value.endDate && value.endDate < value.startDate) dateOrderIssue(ctx);
}

export const clientServiceFeeLineInputSchema = z.object({
  id: z.string().uuid().optional(),
  description: z.string().trim().min(1).max(500),
  amount: z.string().regex(/^\d{1,16}(\.\d{1,2})?$/),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  billingFrequency: billingFrequencySchema,
  customFrequencyLabel: z.string().trim().min(1).max(100).nullable().optional(),
  billingStartDate: z.string().date().nullable().optional(),
  scheduleConfig: billingScheduleConfigSchema.nullable().optional(),
  billingTiming: billingTimingSchema.optional(),
  postpaidTrigger: postpaidTriggerSchema.nullable().optional(),
  tieredPricing: tieredPricingSchema.nullable().optional(),
  isActive: z.boolean().optional(),
  displayOrder: z.number().int().min(0),
}).superRefine((value, ctx) => {
  refineBillingTiming(value, ctx);
  if (value.billingFrequency === 'CUSTOM' && !value.customFrequencyLabel?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['customFrequencyLabel'], message: 'Custom frequency label is required' });
  }
});

const clientServiceDeadlineRuleInputSchema = z.object({
  ruleId: z.string().uuid(),
  enabled: z.boolean(),
  parameterValues: jsonObjectSchema.default({}),
  parameterProvenance: z.record(z.string(), z.enum(['COMPANY', 'CATALOG_DEFAULT', 'CLIENT_OVERRIDE'])).default({}),
  scheduleEntries: scheduleEntriesSchema.default([]),
}).strict();

export const clientServiceDeadlineRulesSchema = z.array(clientServiceDeadlineRuleInputSchema)
  .max(100, 'At most 100 deadline rules are allowed')
  .superRefine((rules, ctx) => {
    const seen = new Set<string>();
    for (const [index, rule] of rules.entries()) {
      if (seen.has(rule.ruleId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, 'ruleId'],
          message: 'Deadline rules must be unique per client service',
        });
      }
      seen.add(rule.ruleId);
      for (const key of Object.keys(rule.parameterProvenance)) {
        if (!Object.prototype.hasOwnProperty.call(rule.parameterValues, key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index, 'parameterProvenance', key],
            message: 'Parameter provenance requires a matching parameter value',
          });
        }
      }
    }
  });

export type ClientServiceDeadlineRuleInput = z.infer<typeof clientServiceDeadlineRuleInputSchema>;

const updateClientServiceInputSchema = z.object({
  expectedUpdatedAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
  familyName: z.string().trim().min(1).max(200).optional(),
  serviceName: z.string().trim().min(1).max(200).optional(),
  status: z.enum(['ACTIVE', 'PAUSED', 'ENDED']).optional(),
  serviceCadence: serviceCadenceSchema.optional(),
  customCadenceLabel: z.string().trim().min(1).max(100).nullable().optional(),
  startDate: z.string().date().optional(),
  endDate: z.string().date().nullable().optional(),
  fieldValues: z.record(z.string(), z.string().max(10_000)).optional(),
  billingDisposition: billingDispositionSchema.optional(),
  billingNotRequiredReason: z.string().trim().min(3).max(500).nullable().optional(),
  feeLines: z.array(clientServiceFeeLineInputSchema).max(100).optional(),
  deadlineRules: clientServiceDeadlineRulesSchema.optional(),
  impactFingerprint: z.string().trim().min(1).optional(),
}).strict().superRefine((value, ctx) => {
  if (!value.expectedUpdatedAt && !value.updatedAt) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['expectedUpdatedAt'], message: 'An expected update timestamp is required' });
  }
  if (value.expectedUpdatedAt && value.updatedAt && value.expectedUpdatedAt !== value.updatedAt) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['expectedUpdatedAt'], message: 'expectedUpdatedAt conflicts with updatedAt' });
  }
  validateCadenceAndDates(value, ctx);
  validateBillingConfiguration(value, ctx);
  if (Object.keys(value).every((key) => ['updatedAt', 'expectedUpdatedAt', 'impactFingerprint'].includes(key))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'At least one service field must be updated' });
  }
}).transform(({ updatedAt: legacyUpdatedAt, ...value }) => ({
  ...value,
  expectedUpdatedAt: value.expectedUpdatedAt ?? legacyUpdatedAt!,
}));

export const updateClientServiceSchema = updateClientServiceInputSchema;

export const clientServiceDeadlineScheduleSnapshotSchema = z.object({
  status: z.enum(['ACTIVE', 'PAUSED', 'ENDED']),
  serviceCadence: serviceCadenceSchema,
  customCadenceLabel: z.string().trim().min(1).max(100).nullable(),
  startDate: z.string().date(),
  endDate: z.string().date().nullable(),
  fieldValues: z.record(z.string(), z.string().max(10_000)),
}).strict().superRefine((value, ctx) => {
  validateCadenceAndDates(value, ctx);
});

export const clientServiceDeadlineImpactSchema = z.object({
  expectedUpdatedAt: z.string().datetime(),
  deadlineRules: clientServiceDeadlineRulesSchema,
  scheduleSnapshot: clientServiceDeadlineScheduleSnapshotSchema,
}).strict();

export const clientServiceDeadlineDraftPreviewSchema = z.object({
  companyId: z.string().uuid(),
  serviceVariantId: z.string().uuid(),
  deadlineRules: clientServiceDeadlineRulesSchema,
  scheduleSnapshot: clientServiceDeadlineScheduleSnapshotSchema,
}).strict();

const manualFeeLineSchema = z.object({
  description: z.string().trim().min(1).max(500),
  amount: z.string().regex(/^\d{1,16}(?:\.\d{1,2})?$/, 'Enter a non-negative amount with at most two decimals.'),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  billingFrequency: billingFrequencySchema,
  customFrequencyLabel: z.string().trim().min(1).max(100).nullable().optional(),
  billingStartDate: z.string().date().nullable().optional(),
  scheduleConfig: billingScheduleConfigSchema.nullable().optional(),
  billingTiming: billingTimingSchema.optional(),
  postpaidTrigger: postpaidTriggerSchema.nullable().optional(),
  tieredPricing: tieredPricingSchema.nullable().optional(),
}).strict().superRefine((value, ctx) => {
  refineBillingTiming(value, ctx);
  if (value.billingFrequency === 'CUSTOM' && !value.customFrequencyLabel?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['customFrequencyLabel'], message: 'Custom frequency label is required' });
  }
});

export const companyObligationStatusEntrySchema = z.object({
  obligationCode: z.string().trim().min(1).max(100),
  periodKey: z.string().trim().min(1).max(40),
  status: z.enum(['TO_BE_CONFIRMED', 'PENDING_FILING', 'FILED', 'MANAGED_EXTERNALLY', 'NOT_REQUIRED']),
  /** With Filed: quantities for tiered postpaid fees this filing bills. */
  billingQuantities: postpaidQuantitiesSchema.optional(),
}).strict();

const yearOfAssessmentSchema = z.number().int().min(2000).max(2100);

export const engagementStartYearOfAssessmentSchema = z.object({
  serviceId: z.string().uuid(),
  yearOfAssessment: yearOfAssessmentSchema.nullable(),
}).strict();

export const createManualClientServiceSchema = z.object({
  serviceVariantId: z.string().uuid(),
  status: z.enum(['ACTIVE', 'PAUSED', 'ENDED']).default('ACTIVE'),
  serviceCadence: serviceCadenceSchema,
  customCadenceLabel: z.string().trim().min(1).max(100).nullable().optional(),
  startDate: z.string().date(),
  endDate: z.string().date().nullable().optional(),
  fieldValues: z.record(z.string(), z.string().max(10_000)).default({}),
  billingDisposition: manualBillingDispositionSchema.optional(),
  billingNotRequiredReason: z.string().trim().min(3).max(500).nullable().optional(),
  feeLines: z.array(manualFeeLineSchema).max(100),
  deadlineRules: clientServiceDeadlineRulesSchema.optional(),
  /** Filing statuses staff record for company obligations while adding. */
  companyObligationStatuses: z.array(companyObligationStatusEntrySchema).max(60).default([]),
  /** First Year of Assessment this engagement files. */
  engagementStartYearOfAssessment: yearOfAssessmentSchema.nullable().optional(),
  confirmDuplicate: z.boolean().default(false),
}).strict().superRefine((value, ctx) => {
  validateCadenceAndDates(value, ctx);
  validateBillingConfiguration(value, ctx, { legacyEmptyFeeLinesAreInvalid: true });
  if (Object.keys(value.fieldValues).length > 100) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['fieldValues'], message: 'At most 100 service fields are allowed' });
  }
}).transform((value) => ({
  ...value,
  billingDisposition: value.billingDisposition ?? 'UNREVIEWED',
  billingNotRequiredReason: value.billingDisposition === 'NOT_REQUIRED' ? value.billingNotRequiredReason ?? null : null,
  customCadenceLabel: value.serviceCadence === 'CUSTOM' ? value.customCadenceLabel ?? null : null,
  endDate: value.endDate ?? null,
  feeLines: value.feeLines.map((fee) => ({
    ...fee,
    customFrequencyLabel: fee.billingFrequency === 'CUSTOM' ? fee.customFrequencyLabel ?? null : null,
    billingStartDate: fee.billingStartDate ?? fee.scheduleConfig?.startDate ?? null,
  })),
}));

export type CreateManualClientServiceRequest = z.input<typeof createManualClientServiceSchema>;
export type CreateManualClientServiceInput = z.output<typeof createManualClientServiceSchema>;

export const archiveClientServiceSchema = z.object({
  deletionMode: z.literal('ARCHIVE').optional(),
  reason: z.string().trim().min(10).max(1000),
}).strict();

export const permanentDeleteClientServiceSchema = z.object({
  deletionMode: z.literal('PERMANENT'),
  expectedUpdatedAt: z.string().datetime(),
  reason: z.string().trim().min(10).max(1000),
}).strict();

export const deleteClientServiceSchema = z.union([
  permanentDeleteClientServiceSchema,
  archiveClientServiceSchema,
]);
export const markServiceAgreementEffectiveSchema = z.object({
  signedAt: z.string().datetime(),
  effectiveDate: z.string().date(),
  reason: z.string().trim().min(10).max(1000),
});
export const searchClientServicesSchema = z.object({
  status: z.enum(['ACTIVE', 'PAUSED', 'ENDED']).optional(),
  query: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type UpdateClientServiceInput = z.output<typeof updateClientServiceSchema>;
export type UpdateClientServiceRequest = z.input<typeof updateClientServiceSchema>;
export type ClientServiceDeadlineImpactInput = z.infer<typeof clientServiceDeadlineImpactSchema>;
export type ClientServiceDeadlineDraftPreviewInput = z.infer<typeof clientServiceDeadlineDraftPreviewSchema>;
export type ClientServiceDeadlineScheduleSnapshot = z.infer<typeof clientServiceDeadlineScheduleSnapshotSchema>;
export type SearchClientServicesInput = z.infer<typeof searchClientServicesSchema>;
export type MarkServiceAgreementEffectiveInput = z.infer<typeof markServiceAgreementEffectiveSchema>;
