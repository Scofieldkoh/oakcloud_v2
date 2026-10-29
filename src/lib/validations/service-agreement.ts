import { z } from 'zod';
import { billingFrequencySchema } from '@/lib/validations/service-catalog';

const uuid = z.string().uuid();
const clientKey = z.string().trim().min(1).max(100);
/** A real calendar date in YYYY-MM-DD form (2026-02-30 is rejected). */
export const serviceAgreementDateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}, 'Enter a valid date.');
const dateString = serviceAgreementDateString;
const nullableDate = dateString.nullable().optional();

const uniqueValues = (
  values: readonly (string | number)[],
  context: z.RefinementCtx,
  path: (string | number)[],
  message: string,
) => {
  if (new Set(values).size !== values.length) {
    context.addIssue({ code: 'custom', path, message });
  }
};

export const serviceAgreementFeeLineSchema = z
  .object({
    id: uuid.optional(),
    clientKey,
    companyId: uuid,
    description: z.string().trim().min(1).max(500),
    amount: z.string().regex(/^\d{1,16}(\.\d{1,2})?$/),
    currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
    billingFrequency: billingFrequencySchema,
    customFrequencyLabel: z.string().trim().min(1).max(100).nullable().optional(),
    billingStartDate: nullableDate,
    billingStartDateOverridden: z.boolean().optional(),
    displayOrder: z.number().int().min(0),
  })
  .superRefine((value, context) => {
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
      value.billingFrequency === 'CUSTOM' ? value.customFrequencyLabel ?? null : null,
  }));

export const serviceAgreementItemSchema = z
  .object({
    id: uuid.optional(),
    clientKey,
    variantId: uuid,
    entityIds: z.array(uuid).min(1).max(100),
    startDate: dateString,
    startDateOverridden: z.boolean().optional(),
    endDate: nullableDate,
    fieldValues: z
      .record(z.string().max(10_000))
      .refine((value) => Object.keys(value).length <= 100, {
        message: 'At most 100 service fields are allowed',
      }),
    displayOrder: z.number().int().min(0),
    feeLines: z.array(serviceAgreementFeeLineSchema).min(1).max(100),
  })
  .superRefine((value, context) => {
    uniqueValues(value.entityIds, context, ['entityIds'], 'Service entities must be unique');
    if (value.endDate && value.endDate < value.startDate) {
      context.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: 'End date cannot precede start date',
      });
    }

    const targetedEntities = new Set(value.entityIds);
    value.feeLines.forEach((fee, index) => {
      if (!targetedEntities.has(fee.companyId)) {
        context.addIssue({
          code: 'custom',
          path: ['feeLines', index, 'companyId'],
          message: 'Fee company must be targeted by the service item',
        });
      }
    });

    const feeKeys = value.feeLines.map((fee) => fee.clientKey);
    uniqueValues(feeKeys, context, ['feeLines'], 'Fee client keys must be unique');
    for (const companyId of targetedEntities) {
      uniqueValues(
        value.feeLines
          .filter((fee) => fee.companyId === companyId)
          .map((fee) => fee.displayOrder),
        context,
        ['feeLines'],
        'Fee display order must be unique per company',
      );
    }
  });

export const serviceAgreementDraftSchema = z
  .object({
    primaryCompanyId: uuid,
    authorizedContactIds: z.array(uuid).min(1).max(100),
    authorizedRepresentativeRoles: z
      .record(uuid, z.string().trim().min(1).max(200))
      .refine((value) => Object.keys(value).length <= 100, {
        message: 'At most 100 representative appointments are allowed',
      })
      .optional(),
    signerContactIds: z.array(uuid).min(1).max(100),
    entityIds: z.array(uuid).min(1).max(100),
    agreementDate: dateString,
    effectiveDate: nullableDate,
    termMonths: z.number().int().min(1).max(1200),
    items: z.array(serviceAgreementItemSchema).min(1).max(50),
  })
  .superRefine((value, context) => {
    uniqueValues(
      value.authorizedContactIds,
      context,
      ['authorizedContactIds'],
      'Authorised representatives must be unique',
    );
    uniqueValues(
      value.signerContactIds,
      context,
      ['signerContactIds'],
      'Signers must be unique',
    );
    const representativeIds = new Set(value.authorizedContactIds);
    for (const contactId of Object.keys(value.authorizedRepresentativeRoles ?? {})) {
      if (!representativeIds.has(contactId)) {
        context.addIssue({
          code: 'custom',
          path: ['authorizedRepresentativeRoles', contactId],
          message: 'Appointments may only be selected for authorised representatives',
        });
      }
    }
    value.signerContactIds.forEach((contactId, index) => {
      if (!representativeIds.has(contactId)) {
        context.addIssue({
          code: 'custom',
          path: ['signerContactIds', index],
          message: 'Every signer must be an authorised representative',
        });
      }
    });
    uniqueValues(value.entityIds, context, ['entityIds'], 'Agreement entities must be unique');
    if (!value.entityIds.includes(value.primaryCompanyId)) {
      context.addIssue({
        code: 'custom',
        path: ['entityIds'],
        message: 'Agreement entities must include the primary company',
      });
    } else if (value.entityIds[0] !== value.primaryCompanyId) {
      context.addIssue({
        code: 'custom',
        path: ['entityIds', 0],
        message: 'The primary company must be the first agreement entity',
      });
    }

    const agreementEntities = new Set(value.entityIds);
    value.items.forEach((item, itemIndex) => {
      item.entityIds.forEach((companyId, entityIndex) => {
        if (!agreementEntities.has(companyId)) {
          context.addIssue({
            code: 'custom',
            path: ['items', itemIndex, 'entityIds', entityIndex],
            message: 'Service entity must be included in the agreement',
          });
        }
      });
    });
    uniqueValues(
      value.items.map((item) => item.clientKey),
      context,
      ['items'],
      'Item client keys must be unique',
    );
    uniqueValues(
      value.items.map((item) => item.displayOrder),
      context,
      ['items'],
      'Item display order values must be unique',
    );
  });

export type ParsedServiceAgreementDraftInput = z.infer<
  typeof serviceAgreementDraftSchema
>;
