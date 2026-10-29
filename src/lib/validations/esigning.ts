import { z } from 'zod';
import {
  paginationSchema,
  sortOrderSchema,
  uuidString,
} from '@/lib/validations/query-params';

export const ESIGNING_LIMITS = {
  MAX_DOCUMENTS: 10,
  MAX_RECIPIENTS: 20,
  MAX_PAGES_PER_DOCUMENT: 100,
  MAX_TOTAL_PAGES: 200,
  MAX_TOTAL_FILE_SIZE_BYTES: 100 * 1024 * 1024,
  MAX_FILE_SIZE_BYTES: 25 * 1024 * 1024,
  MIN_FIELD_WIDTH: 0.02,
  MIN_FIELD_HEIGHT: 0.01,
  MAX_FIELD_COUNT: 500,
  MAX_TEXT_LENGTH: 2000,
  MAX_MESSAGE_LENGTH: 4000,
  MAX_DECLINE_REASON_LENGTH: 1000,
  MAX_ACCESS_CODE_LENGTH: 32,
  MIN_ACCESS_CODE_LENGTH: 4,
  MAX_COMPLETION_COPY_EMAILS: 20,
} as const;

export const ESIGNING_RECIPIENT_COLORS = [
  '#1d4ed8',
  '#9333ea',
  '#d97706',
  '#0f766e',
  '#be123c',
  '#4f46e5',
  '#0891b2',
  '#16a34a',
  '#b45309',
  '#7c3aed',
] as const;

export const esigningEnvelopeStatusSchema = z.enum([
  'DRAFT',
  'SENT',
  'IN_PROGRESS',
  'COMPLETED',
  'VOIDED',
  'DECLINED',
  'EXPIRED',
]);

export const esigningSigningOrderSchema = z.enum([
  'PARALLEL',
  'SEQUENTIAL',
  'MIXED',
]);

export const esigningRecipientTypeSchema = z.enum(['SIGNER', 'CC']);

export const esigningRecipientStatusSchema = z.enum([
  'QUEUED',
  'NOTIFIED',
  'VIEWED',
  'SIGNED',
  'DECLINED',
]);

export const esigningRecipientAccessModeSchema = z.enum([
  'EMAIL_LINK',
  'EMAIL_WITH_CODE',
  'MANUAL_LINK',
]);

export const esigningFieldTypeSchema = z.enum([
  'SIGNATURE',
  'INITIALS',
  'DATE_SIGNED',
  'NAME',
  'TEXT',
  'CHECKBOX',
  'COMPANY',
  'TITLE',
]);

const emptyStringToUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  }, schema);

const emptyStringToNull = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => {
    if (value === null) return null;
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  }, schema.nullable());

const dataUrlSchema = z
  .string()
  .regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/, 'Expected a PNG data URL');

const hexColorSchema = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{6})$/, 'Expected a 6-digit hex color');

const emailAddressSchema = z.string().trim().toLowerCase().email().max(320);
const optionalRecipientEmailSchema = emptyStringToNull(emailAddressSchema).optional();

export const ESIGNING_COMPLETION_BCC_PREFERENCE_KEY = 'esigning.completion-bcc.v1';

export const esigningCompletionBccPreferenceSchema = z.object({
  version: z.literal(1),
  emails: z.array(emailAddressSchema).max(ESIGNING_LIMITS.MAX_COMPLETION_COPY_EMAILS),
});

export type EsigningCompletionBccPreference = z.infer<typeof esigningCompletionBccPreferenceSchema>;

export function parseEsigningCompletionBccPreference(value: unknown): EsigningCompletionBccPreference {
  const parsed = esigningCompletionBccPreferenceSchema.safeParse(value);
  return parsed.success ? parsed.data : { version: 1, emails: [] };
}

export const esigningRecipientInputSchema = z
  .object({
    id: z.string().uuid().optional(),
    type: esigningRecipientTypeSchema,
    name: z.string().trim().min(1).max(160),
    email: optionalRecipientEmailSchema,
    signingOrder: z.number().int().min(1).max(ESIGNING_LIMITS.MAX_RECIPIENTS).optional().nullable(),
    accessMode: esigningRecipientAccessModeSchema.default('MANUAL_LINK'),
    accessCode: emptyStringToUndefined(
      z.string().min(ESIGNING_LIMITS.MIN_ACCESS_CODE_LENGTH).max(ESIGNING_LIMITS.MAX_ACCESS_CODE_LENGTH)
    ).optional(),
    colorTag: hexColorSchema.optional(),
  })
  .superRefine((recipient, ctx) => {
    if ((recipient.type === 'CC' || recipient.accessMode !== 'MANUAL_LINK') && !recipient.email) {
      ctx.addIssue({
        code: 'custom',
        path: ['email'],
        message: 'Email is required for this recipient method',
      });
    }

    if (recipient.type === 'CC' && recipient.signingOrder !== null && recipient.signingOrder !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['signingOrder'],
        message: 'CC recipients cannot participate in signing order',
      });
    }

    if (recipient.type === 'CC' && recipient.accessMode !== 'EMAIL_LINK') {
      ctx.addIssue({
        code: 'custom',
        path: ['accessMode'],
        message: 'Receives Copy recipients are delivered by email',
      });
    }

    if (recipient.accessMode === 'EMAIL_WITH_CODE' && !recipient.accessCode) {
      ctx.addIssue({
        code: 'custom',
        path: ['accessCode'],
        message: 'Access code is required for email + access code recipients',
      });
    }
  });

export const createEsigningEnvelopeSchema = z.object({
  title: z.string().trim().min(1).max(160),
  emailSubject: z.string().trim().min(1).max(160).optional(),
  message: emptyStringToNull(z.string().max(ESIGNING_LIMITS.MAX_MESSAGE_LENGTH)).optional(),
  companyId: emptyStringToNull(z.string().uuid()).optional(),
  signingOrder: esigningSigningOrderSchema.default('PARALLEL'),
  expiresAt: emptyStringToNull(z.string().datetime()).optional(),
  reminderFrequencyDays: z.number().int().min(1).max(30).optional().nullable(),
  reminderStartDays: z.number().int().min(0).max(90).optional().nullable(),
  expiryWarningDays: z.number().int().min(0).max(30).optional().nullable(),
  completionCopyEmails: z.array(emailAddressSchema).max(ESIGNING_LIMITS.MAX_COMPLETION_COPY_EMAILS).default([]),
});

export const updateEsigningEnvelopeSchema = createEsigningEnvelopeSchema.partial();

export const esigningDocumentFieldDefinitionInputSchema = z
  .object({
    id: z.string().uuid().optional(),
    documentId: z.string().uuid(),
    recipientId: z.string().uuid(),
    type: esigningFieldTypeSchema,
    pageNumber: z.number().int().min(1),
    xPercent: z.number().min(0).max(1),
    yPercent: z.number().min(0).max(1),
    widthPercent: z.number().min(0).max(1),
    heightPercent: z.number().min(0).max(1),
    required: z.boolean().default(true),
    label: emptyStringToNull(z.string().max(200)).optional(),
    placeholder: emptyStringToNull(z.string().max(200)).optional(),
    sortOrder: z.number().int().min(0).max(9999),
  })
  .superRefine((field, ctx) => {
    if (field.widthPercent < ESIGNING_LIMITS.MIN_FIELD_WIDTH) {
      ctx.addIssue({
        code: 'custom',
        path: ['widthPercent'],
        message: `Field width must be at least ${(ESIGNING_LIMITS.MIN_FIELD_WIDTH * 100).toFixed(0)}%`,
      });
    }

    if (field.heightPercent < ESIGNING_LIMITS.MIN_FIELD_HEIGHT) {
      ctx.addIssue({
        code: 'custom',
        path: ['heightPercent'],
        message: `Field height must be at least ${(ESIGNING_LIMITS.MIN_FIELD_HEIGHT * 100).toFixed(0)}%`,
      });
    }

    if (field.xPercent + field.widthPercent > 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['widthPercent'],
        message: 'Field extends beyond the right edge of the page',
      });
    }

    if (field.yPercent + field.heightPercent > 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['heightPercent'],
        message: 'Field extends beyond the bottom edge of the page',
      });
    }
  });

export const saveEsigningFieldDefinitionsSchema = z.object({
  fields: z.array(esigningDocumentFieldDefinitionInputSchema).max(ESIGNING_LIMITS.MAX_FIELD_COUNT),
});

export const updateEsigningRecipientSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  email: optionalRecipientEmailSchema,
  type: esigningRecipientTypeSchema.optional(),
  signingOrder: z.number().int().min(1).max(ESIGNING_LIMITS.MAX_RECIPIENTS).optional().nullable(),
  accessMode: esigningRecipientAccessModeSchema.optional(),
  accessCode: emptyStringToUndefined(
    z.string().min(ESIGNING_LIMITS.MIN_ACCESS_CODE_LENGTH).max(ESIGNING_LIMITS.MAX_ACCESS_CODE_LENGTH)
  ).optional(),
  colorTag: hexColorSchema.optional(),
});

export const reorderEsigningDocumentSchema = z.object({
  sortOrder: z.number().int().min(0).max(9999).optional(),
  visibility: z.enum(['SIGNER_ONLY', 'EVERYONE']).optional(),
  fileName: z.string()
    .trim()
    .min(1)
    .max(255)
    .refine((value) => !/[\\/\\\\\x00-\x1F]/.test(value), {
      message: 'File name contains invalid characters',
    })
    .optional(),
}).refine(
  (value) =>
    value.sortOrder !== undefined ||
    value.visibility !== undefined ||
    value.fileName !== undefined,
  {
    message: 'Provide sortOrder, visibility, or fileName',
  }
);

export const reorderEsigningRecipientsSchema = z.object({
  recipientIds: z.array(uuidString).min(1).max(ESIGNING_LIMITS.MAX_RECIPIENTS).optional(),
  recipients: z.array(
    z.object({
      recipientId: uuidString,
      signingOrder: z.number().int().min(1).max(ESIGNING_LIMITS.MAX_RECIPIENTS),
    })
  ).min(1).max(ESIGNING_LIMITS.MAX_RECIPIENTS).optional(),
}).refine(
  (value) => Boolean(value.recipientIds?.length || value.recipients?.length),
  {
    message: 'Provide recipientIds or recipients',
    path: ['recipientIds'],
  }
);

const esigningListDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected date in YYYY-MM-DD format');

export const esigningListQuerySchema = paginationSchema.extend({
  query: z.string().trim().max(200).optional(),
  status: esigningEnvelopeStatusSchema.optional(),
  statuses: z.preprocess(
    (value) => {
      if (typeof value !== 'string') {
        return undefined;
      }

      const values = value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);

      return values.length > 0 ? values : undefined;
    },
    z.array(esigningEnvelopeStatusSchema).min(1).optional()
  ),
  companyId: uuidString.optional(),
  documentName: z.string().trim().max(255).optional(),
  recipientQuery: z.string().trim().max(320).optional(),
  recipientStatus: esigningRecipientStatusSchema.optional(),
  signingOrder: esigningSigningOrderSchema.optional(),
  createdFrom: esigningListDateSchema.optional(),
  createdTo: esigningListDateSchema.optional(),
  sentFrom: esigningListDateSchema.optional(),
  sentTo: esigningListDateSchema.optional(),
  completedFrom: esigningListDateSchema.optional(),
  completedTo: esigningListDateSchema.optional(),
  createdBy: z.enum(['me', 'all']).optional().default('all'),
  sortBy: z
    .enum(['createdAt', 'updatedAt', 'completedAt', 'title', 'status', 'companyName', 'details'])
    .optional()
    .default('updatedAt'),
  sortOrder: sortOrderSchema,
});

export const verifyEsigningAccessCodeSchema = z.object({
  accessCode: z.string().trim().min(ESIGNING_LIMITS.MIN_ACCESS_CODE_LENGTH).max(ESIGNING_LIMITS.MAX_ACCESS_CODE_LENGTH),
});

export const saveEsigningFieldValuesSchema = z.object({
  values: z.array(
    z.object({
      fieldDefinitionId: z.string().uuid(),
      value: emptyStringToNull(z.string().max(10_000)).optional(),
      signatureDataUrl: dataUrlSchema.optional().nullable(),
    })
  ).min(1).max(ESIGNING_LIMITS.MAX_FIELD_COUNT),
});

export const recordEsigningConsentSchema = z.object({
  consented: z.literal(true),
});

export const declineEsigningEnvelopeSchema = z.object({
  reason: z.string().trim().min(1).max(ESIGNING_LIMITS.MAX_DECLINE_REASON_LENGTH),
});

export const verifyCertificatePayloadSchema = z.object({
  fileHash: z.string().trim().min(32).max(128),
});

export function getEsigningRecipientColor(index: number): string {
  return ESIGNING_RECIPIENT_COLORS[index % ESIGNING_RECIPIENT_COLORS.length];
}

export type CreateEsigningEnvelopeInput = z.infer<typeof createEsigningEnvelopeSchema>;
export type UpdateEsigningEnvelopeInput = z.infer<typeof updateEsigningEnvelopeSchema>;
export type EsigningRecipientInput = z.infer<typeof esigningRecipientInputSchema>;
export type UpdateEsigningRecipientInput = z.infer<typeof updateEsigningRecipientSchema>;
export type EsigningFieldDefinitionInput = z.infer<typeof esigningDocumentFieldDefinitionInputSchema>;
export type SaveEsigningFieldDefinitionsInput = z.infer<typeof saveEsigningFieldDefinitionsSchema>;
export type EsigningListQueryInput = z.infer<typeof esigningListQuerySchema>;
export type SaveEsigningFieldValuesInput = z.infer<typeof saveEsigningFieldValuesSchema>;
