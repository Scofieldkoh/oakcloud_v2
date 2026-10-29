import { z } from 'zod';
import { serviceVariantRuleAssociationsSchema } from './deadline-rule';
import { BILLING_TIMINGS, POSTPAID_TRIGGERS } from '@/services/billing/postpaid-triggers';
import { MAX_PRICING_TIERS, TIERED_PRICING_MODES, tieredPricingErrors } from '@/services/billing/tiered-pricing';

const codeSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z][A-Za-z0-9_-]*$/, {
    message: 'Code must start with a letter and contain only letters, numbers, underscores, or hyphens',
  })
  .transform((value) => value.toUpperCase());

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((value) => value || null)
    .optional();

export const serviceCadenceSchema = z.enum([
  'MONTHLY',
  'QUARTERLY',
  'SEMI_ANNUALLY',
  'ANNUALLY',
  'ONE_TIME',
  'AD_HOC',
  'CUSTOM',
]);

export const billingFrequencySchema = z.enum([
  'MONTHLY',
  'QUARTERLY',
  'SEMI_ANNUALLY',
  'ANNUALLY',
  'ONE_TIME',
  'CUSTOM',
]);

export const billingTimingSchema = z.enum(BILLING_TIMINGS);
export const postpaidTriggerSchema = z.enum(POSTPAID_TRIGGERS);

/** Quantity tiers of a postpaid fee line (see billing/tiered-pricing). */
export const tieredPricingSchema = z.object({
  mode: z.enum(TIERED_PRICING_MODES),
  unitLabel: z.string().trim().min(1).max(60),
  tiers: z.array(z.object({
    upTo: z.string().trim().nullable(),
    flatAmount: z.string().trim(),
    unitAmount: z.string().trim(),
  }).strict()).min(1).max(MAX_PRICING_TIERS),
}).strict().superRefine((value, ctx) => {
  for (const issue of tieredPricingErrors(value)) ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
});

/**
 * Postpaid lines need a trigger filing; prepaid lines never carry one, nor
 * quantity tiers.
 */
export function refineBillingTiming(
  value: { billingTiming?: string; postpaidTrigger?: string | null; tieredPricing?: unknown },
  ctx: z.RefinementCtx,
): void {
  if (value.billingTiming === 'POSTPAID' && !value.postpaidTrigger) {
    ctx.addIssue({ code: 'custom', path: ['postpaidTrigger'], message: 'Choose the filing a postpaid fee bills on' });
  }
  if (value.billingTiming !== 'POSTPAID' && value.tieredPricing != null) {
    ctx.addIssue({ code: 'custom', path: ['tieredPricing'], message: 'Only postpaid fees can be priced by quantity' });
  }
}

export const serviceFamilyColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9A-Fa-f]{6}$/, 'Choose a six-digit hex color')
  .transform((value) => value.toUpperCase());

export const serviceVariantFeeTemplateSchema = z
  .object({
    id: z.string().uuid().optional(),
    description: z.string().trim().min(1).max(500),
    defaultAmount: z
      .string()
      .regex(/^\d{1,16}(\.\d{1,2})?$/)
      .nullable()
      .optional(),
    currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).default('SGD'),
    billingFrequency: billingFrequencySchema,
    customFrequencyLabel: nullableText(100),
    billingTiming: billingTimingSchema.optional(),
    postpaidTrigger: postpaidTriggerSchema.nullable().optional(),
    tieredPricing: tieredPricingSchema.nullable().optional(),
    displayOrder: z.number().int().min(0),
  })
  .superRefine((value, context) => {
    refineBillingTiming(value, context);
    if (value.billingFrequency === 'CUSTOM' && !value.customFrequencyLabel) {
      context.addIssue({
        code: 'custom',
        path: ['customFrequencyLabel'],
        message: 'Custom frequency label is required',
      });
    }
  })
  .transform((value) => ({
    ...value,
    customFrequencyLabel:
      value.billingFrequency === 'CUSTOM' ? value.customFrequencyLabel : null,
  }));

const familyFields = {
  code: codeSchema,
  name: z.string().trim().min(1).max(200),
  description: nullableText(5000),
  displayColor: serviceFamilyColorSchema,
  displayOrder: z.number().int().min(0),
  isActive: z.boolean(),
};

export const createServiceFamilySchema = z.object({
  code: familyFields.code,
  name: familyFields.name,
  description: familyFields.description,
  displayColor: familyFields.displayColor.default('#2F6F5E'),
  displayOrder: familyFields.displayOrder.default(0),
  isActive: familyFields.isActive.default(true),
});

export const updateServiceFamilySchema = z.object({
  code: familyFields.code.optional(),
  name: familyFields.name.optional(),
  description: familyFields.description,
  displayColor: familyFields.displayColor.optional(),
  displayOrder: familyFields.displayOrder.optional(),
  isActive: familyFields.isActive.optional(),
});

const variantFields = {
  familyId: z.string().uuid(),
  sowPartialId: z.string().uuid(),
  code: codeSchema,
  name: z.string().trim().min(1).max(200),
  description: nullableText(5000),
  serviceCadence: serviceCadenceSchema,
  customCadenceLabel: nullableText(100),
  displayOrder: z.number().int().min(0),
  isActive: z.boolean(),
  feeTemplates: z.array(serviceVariantFeeTemplateSchema).max(50, 'At most 50 fee rows are allowed'),
  deadlineRules: serviceVariantRuleAssociationsSchema.optional(),
  /** Company statutory monitoring this service commits Oakcloud to. */
  monitoringProfiles: z.array(z.enum(['CORPORATE_TAX', 'CORPORATE_SECRETARIAL', 'NOMINEE_DIRECTOR'])).max(3)
    .transform((profiles) => [...new Set(profiles)]),
};

function validateVariant(
  value: {
    serviceCadence?: z.infer<typeof serviceCadenceSchema>;
    customCadenceLabel?: string | null;
    feeTemplates?: Array<{ displayOrder: number }>;
  },
  context: z.RefinementCtx,
) {
  if (value.serviceCadence === 'CUSTOM' && !value.customCadenceLabel) {
    context.addIssue({
      code: 'custom',
      path: ['customCadenceLabel'],
      message: 'Custom cadence label is required',
    });
  }

  if (value.feeTemplates) {
    const displayOrders = value.feeTemplates.map((fee) => fee.displayOrder);
    if (new Set(displayOrders).size !== displayOrders.length) {
      context.addIssue({
        code: 'custom',
        path: ['feeTemplates'],
        message: 'Fee display order values must be unique',
      });
    }
  }
}

export const createServiceVariantSchema = z
  .object({
    familyId: variantFields.familyId,
    sowPartialId: variantFields.sowPartialId,
    code: variantFields.code,
    name: variantFields.name,
    description: variantFields.description,
    serviceCadence: variantFields.serviceCadence,
    customCadenceLabel: variantFields.customCadenceLabel,
    displayOrder: variantFields.displayOrder.default(0),
    isActive: variantFields.isActive.default(true),
    feeTemplates: variantFields.feeTemplates.default([]),
    deadlineRules: variantFields.deadlineRules,
    monitoringProfiles: variantFields.monitoringProfiles.optional(),
  })
  .superRefine(validateVariant)
  .transform((value) => ({
    ...value,
    customCadenceLabel:
      value.serviceCadence === 'CUSTOM' ? value.customCadenceLabel : null,
  }));

export const updateServiceVariantSchema = z
  .object({
    familyId: variantFields.familyId.optional(),
    sowPartialId: variantFields.sowPartialId.optional(),
    code: variantFields.code.optional(),
    name: variantFields.name.optional(),
    description: variantFields.description,
    serviceCadence: variantFields.serviceCadence.optional(),
    customCadenceLabel: variantFields.customCadenceLabel,
    displayOrder: variantFields.displayOrder.optional(),
    isActive: variantFields.isActive.optional(),
    feeTemplates: variantFields.feeTemplates.optional(),
    deadlineRules: variantFields.deadlineRules,
    monitoringProfiles: variantFields.monitoringProfiles.optional(),
  })
  .superRefine(validateVariant)
  .transform((value) => ({
    ...value,
    customCadenceLabel:
      value.serviceCadence && value.serviceCadence !== 'CUSTOM'
        ? null
        : value.customCadenceLabel,
  }));

export const searchServiceCatalogSchema = z.object({
  query: z.string().trim().max(200).optional(),
  isActive: z.boolean().optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
  sortBy: z.enum(['displayOrder', 'name', 'createdAt', 'updatedAt']).default('displayOrder'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
});

export const searchServiceVariantsSchema = searchServiceCatalogSchema.extend({
  familyId: z.string().uuid().optional(),
});

export const archiveServiceCatalogItemSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

export type ServiceCadence = z.infer<typeof serviceCadenceSchema>;
export type BillingFrequency = z.infer<typeof billingFrequencySchema>;
export type ServiceVariantFeeTemplateInput = z.infer<
  typeof serviceVariantFeeTemplateSchema
>;
export type CreateServiceFamilyInput = z.infer<typeof createServiceFamilySchema>;
export type UpdateServiceFamilyInput = z.infer<typeof updateServiceFamilySchema>;
export type CreateServiceVariantInput = z.infer<typeof createServiceVariantSchema>;
export type UpdateServiceVariantInput = z.infer<typeof updateServiceVariantSchema>;
export type SearchServiceCatalogInput = z.infer<typeof searchServiceCatalogSchema>;
export type SearchServiceVariantsInput = z.infer<typeof searchServiceVariantsSchema>;
