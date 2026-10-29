import { z } from 'zod';
import {
  canOakDocRepeaterSplitDocuments,
  isOakDocContactListSlug,
} from '@/lib/document-editor/oakdoc-repeater-definitions';
import { isCompanyFieldHomeId } from '@/lib/document-editor/oakdoc-company-field-ids';
import {
  serviceAgreementDateString,
  serviceAgreementItemSchema,
} from '@/lib/validations/service-agreement';

const uuid = z.string().uuid();
const nullableUuid = uuid.nullable();
const stringFieldValues = z
  .record(z.string().max(10_000))
  .refine((value) => Object.keys(value).length <= 200, {
    message: 'At most 200 custom field values are allowed',
  });
const itemFieldValues = z
  .record(z.union([z.string().max(10_000), z.boolean()]))
  .refine((value) => Object.keys(value).length <= 200, {
    message: 'At most 200 custom field values are allowed',
  });

export const serviceAgreementWorkspaceSchema = z.object({
  authorizedContactIds: z.array(uuid).max(100),
  authorizedRepresentativeRoles: z
    .record(uuid, z.string().trim().min(1).max(200))
    .refine((value) => Object.keys(value).length <= 100, {
      message: 'At most 100 representative appointments are allowed',
    })
    .optional(),
  signerContactIds: z.array(uuid).max(100),
  entityIds: z.array(uuid).max(100),
  agreementDate: serviceAgreementDateString,
  effectiveDate: serviceAgreementDateString.nullable(),
  termMonths: z.number().int().min(1).max(1200),
  items: z.array(serviceAgreementItemSchema).max(50),
}).strict().superRefine((value, context) => {
  const representativeIds = new Set(value.authorizedContactIds);
  if (representativeIds.size !== value.authorizedContactIds.length) {
    context.addIssue({
      code: 'custom',
      path: ['authorizedContactIds'],
      message: 'Authorised representatives must be unique',
    });
  }
  const signerIds = new Set(value.signerContactIds);
  if (signerIds.size !== value.signerContactIds.length) {
    context.addIssue({
      code: 'custom',
      path: ['signerContactIds'],
      message: 'Signers must be unique',
    });
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
  for (const contactId of Object.keys(value.authorizedRepresentativeRoles ?? {})) {
    if (!representativeIds.has(contactId)) {
      context.addIssue({
        code: 'custom',
        path: ['authorizedRepresentativeRoles', contactId],
        message: 'Appointments may only be selected for authorised representatives',
      });
    }
  }
});

const resolutionHeading = z.string().max(300);

export const resolutionWorkspaceSchema = z.object({
  subject: z.string().max(300),
  sections: z.array(z.discriminatedUnion('kind', [
    z.object({
      id: z.string().min(1).max(100),
      kind: z.literal('PARTIAL'),
      heading: resolutionHeading,
      partialId: uuid,
      body: z.string().max(20000).nullable().optional(),
    }).strict(),
    z.object({
      id: z.string().min(1).max(100),
      kind: z.literal('CUSTOM'),
      heading: resolutionHeading,
      body: z.string().max(20000),
    }).strict(),
  ])).max(50),
}).strict();

export const batchItemConfigurationSchema = z.object({
  version: z.literal(1),
  title: z.string().max(300),
  contactIds: z.array(uuid).max(100),
  selectedDirectorId: nullableUuid,
  selectedDirectorIds: z.array(uuid).max(100).optional(),
  selectedShareholderId: nullableUuid,
  selectedShareholderIds: z.array(uuid).max(100).optional(),
  selectedOfficerIds: z.array(uuid).max(100).optional(),
  selectedContactListIds: z.record(
    z.string().refine(isOakDocContactListSlug, 'Invalid contacts list'),
    z.array(uuid).max(100),
  ).refine((lists) => Object.keys(lists).length <= 50, 'Too many contacts lists').optional(),
  personValues: z.record(
    z.string().max(200).refine(canOakDocRepeaterSplitDocuments, 'Invalid section'),
    z.record(uuid, z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/).max(100), z.string().max(2000))),
  ).refine((sections) => Object.keys(sections).length <= 50, 'Too many sections').optional(),
  selectedContactId: nullableUuid,
  itemValues: itemFieldValues,
  masterOverrides: stringFieldValues,
  useLetterhead: z.boolean(),
  serviceAgreement: serviceAgreementWorkspaceSchema.nullable(),
  resolution: resolutionWorkspaceSchema.nullable().optional(),
  companyFieldValues: z.record(
    z.string().refine(isCompanyFieldHomeId, 'Unknown company field'),
    z.string().max(2000),
  ).optional(),
  documentPerson: z.object({
    tag: z.string().max(200).refine(canOakDocRepeaterSplitDocuments, 'Invalid section'),
    id: uuid,
    name: z.string().max(300),
  }).strict().nullable().optional(),
}).strict();

export const createDocumentGenerationBatchSchema = z.object({
  items: z.array(z.object({
    templateId: uuid,
  }).strict()).min(1).max(20),
  legacyDraftId: uuid.optional(),
}).strict().superRefine((value, context) => {
  if (value.legacyDraftId && value.items.length !== 1) {
    context.addIssue({
      code: 'custom',
      path: ['legacyDraftId'],
      message: 'Legacy draft adoption requires exactly one item',
    });
  }
});

export const updateDocumentGenerationBatchItemSchema = z.object({
  id: uuid.optional(),
  templateId: uuid,
  displayOrder: z.number().int().min(0).max(19).optional(),
  configuration: batchItemConfigurationSchema.optional(),
  editedContent: z.string().max(2_000_000).nullable().optional(),
  editedContentJson: z.unknown().nullable().optional(),
}).strict();

export const updateDocumentGenerationBatchSchema = z.object({
  expectedRevision: z.number().int().min(0),
  currentStage: z.number().int().min(0).max(3).optional(),
  primaryCompanyId: nullableUuid.optional(),
  activeItemId: nullableUuid.optional(),
  masterFieldValues: stringFieldValues.optional(),
  items: z.array(updateDocumentGenerationBatchItemSchema).min(1).max(20),
  taskContext: z.unknown().optional(),
}).strict().superRefine((value, context) => {
  const orders = value.items
    .map((item, index) => item.displayOrder ?? index);
  if (new Set(orders).size !== orders.length) {
    context.addIssue({
      code: 'custom',
      path: ['items'],
      message: 'Item display order values must be unique',
    });
  }
  if (value.activeItemId) {
    // The client may reference a local item that has not been assigned a
    // server id yet by its template id, so both identifiers are accepted.
    const identifiers = value.items.flatMap((item) => [item.id, item.templateId]);
    if (!identifiers.includes(value.activeItemId)) {
      context.addIssue({
        code: 'custom',
        path: ['activeItemId'],
        message: 'Active item must belong to the batch',
      });
    }
  }
});

export const batchItemMutationSchema = z.object({
  expectedRevision: z.number().int().min(0),
  replaceEditedContent: z.boolean().optional(),
}).strict();

export const batchPreviewSchema = batchItemMutationSchema;
export const batchReviewSchema = z.object({
  expectedRevision: z.number().int().min(0),
}).strict();

export const batchExecutionSchema = z.object({
  expectedRevision: z.number().int().min(0),
}).strict();

export const batchDiscardSchema = z.object({
  expectedRevision: z.number().int().min(0).optional(),
}).strict();

export const discardDocumentGenerationBatchSchema = batchDiscardSchema;

export type CreateDocumentGenerationBatchInput = z.infer<
  typeof createDocumentGenerationBatchSchema
>;
export type UpdateDocumentGenerationBatchInput = z.infer<
  typeof updateDocumentGenerationBatchSchema
>;
export type BatchItemMutationInput = z.infer<typeof batchItemMutationSchema>;
export type BatchReviewInput = z.infer<typeof batchReviewSchema>;
export type BatchExecutionInput = z.infer<typeof batchExecutionSchema>;
