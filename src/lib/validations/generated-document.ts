import { z } from 'zod';
import { serviceAgreementDraftSchema } from '@/lib/validations/service-agreement';

export const generatedDocumentStatusEnum = z.enum(['DRAFT', 'FINALIZED', 'ARCHIVED']);
export const GENERATION_SESSION_VERSION = 2 as const;
const nullableUuid = z.string().uuid().nullable();

const generationSessionFields = {
  currentStep: z.number().int().min(0).max(4),
  templateId: nullableUuid,
  companyId: nullableUuid,
  contactIds: z.array(z.string().uuid()),
  selectedDirectorId: nullableUuid,
  selectedShareholderId: nullableUuid,
  selectedContactId: nullableUuid,
  title: z.string().max(300),
  customData: z.record(z.string()),
  useLetterhead: z.boolean(),
  previewContent: z.string().nullable(),
  editedContent: z.string().nullable(),
  editedContentJson: z.unknown().nullable(),
};

export const generationSessionStateV1Schema = z.object({
  version: z.literal(1),
  ...generationSessionFields,
});

export const generationSessionStateV2Schema = z.object({
  version: z.literal(GENERATION_SESSION_VERSION),
  ...generationSessionFields,
  currentStep: z.number().int().min(0).max(3),
  serviceAgreementId: nullableUuid,
});

export const generationSessionStateSchema = generationSessionStateV2Schema;
export const saveGenerationSessionSchema = generationSessionStateV2Schema.extend({
  serviceAgreement: serviceAgreementDraftSchema.nullable().optional(),
  discardServiceAgreement: z.boolean().optional(),
});

export type GenerationSessionState = z.infer<typeof generationSessionStateSchema>;
export type SaveGenerationSessionInput = z.infer<typeof saveGenerationSessionSchema>;

export const createDocumentFromTemplateSchema = z.object({
  draftId: z.string().uuid().optional(),
  expectedRevision: z.number().int().nonnegative().optional(),
  serviceAgreementId: z.string().uuid().optional(),
  discardServiceAgreement: z.boolean().optional(),
  templateId: z.string().uuid(),
  companyId: z.string().uuid().optional().nullable(),
  contactIds: z.array(z.string().uuid()).optional().default([]),
  selectedDirectorId: z.string().uuid().optional(),
  selectedDirectorIds: z.array(z.string().uuid()).max(100).optional(),
  selectedShareholderId: z.string().uuid().optional(),
  selectedContactId: z.string().uuid().optional(),
  title: z.string().min(1, 'Title is required').max(300),
  customData: z.record(z.unknown()).optional(),
  useLetterhead: z.boolean().default(true),
  editedContent: z.string().optional(),
  editedContentJson: z.any().optional().nullable(),
});

export type CreateDocumentFromTemplateInput = z.input<typeof createDocumentFromTemplateSchema>;

export const createBlankDocumentSchema = z.object({
  companyId: z.string().uuid().optional().nullable(),
  title: z.string().min(1, 'Title is required').max(300),
  content: z.string().optional().default(''),
  contentJson: z.any().optional().nullable(),
  useLetterhead: z.boolean().default(true),
});

export type CreateBlankDocumentInput = z.infer<typeof createBlankDocumentSchema>;

export const updateGeneratedDocumentSchema = z.object({
  id: z.string().uuid(),
  expectedRevision: z.number().int().nonnegative().optional(),
  title: z.string().min(1).max(300).optional(),
  content: z.string().optional(),
  contentJson: z.any().optional().nullable(),
  useLetterhead: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional().nullable(),
});

export type UpdateGeneratedDocumentInput = z.infer<typeof updateGeneratedDocumentSchema>;

export const searchGeneratedDocumentsSchema = z.object({
  query: z.string().optional(),
  title: z.string().optional(),
  companyId: z.string().uuid().optional(),
  companyName: z.string().optional(),
  templateId: z.string().uuid().optional(),
  templateName: z.string().optional(),
  createdBy: z.string().optional(),
  signedFrom: z.string().optional(),
  signedTo: z.string().optional(),
  updatedFrom: z.string().optional(),
  updatedTo: z.string().optional(),
  status: generatedDocumentStatusEnum.optional(),
  page: z.number().min(1).default(1),
  limit: z.number().min(1).max(100).default(20),
  sortBy: z.enum([
    'title',
    'companyName',
    'templateName',
    'status',
    'signedAt',
    'createdByName',
    'createdAt',
    'updatedAt',
    'finalizedAt',
  ]).default('updatedAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type SearchGeneratedDocumentsInput = z.infer<typeof searchGeneratedDocumentsSchema>;

export const cloneDocumentSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(300).optional(),
});

export type CloneDocumentInput = z.infer<typeof cloneDocumentSchema>;

export const createDocumentCommentSchema = z.object({
  documentId: z.string().uuid(),
  content: z.string().min(1).max(1000),
  guestName: z.string().min(1).max(100).optional().nullable(),
  guestEmail: z.string().email().max(255).optional().nullable(),
  selectionStart: z.number().int().optional().nullable(),
  selectionEnd: z.number().int().optional().nullable(),
  selectedText: z.string().optional().nullable(),
  parentId: z.string().uuid().optional().nullable(),
});

export type CreateDocumentCommentInput = z.infer<typeof createDocumentCommentSchema>;

/**
 * Drafts are not a second canonical revision stream. `baseRevision` records the
 * GeneratedDocument revision the draft was derived from so later reconciliation
 * can detect drift without incrementing canonical revision on autosave.
 */
export const saveDraftSchema = z.object({
  documentId: z.string().uuid(),
  baseRevision: z.number().int().nonnegative().optional(),
  content: z.string(),
  contentJson: z.any().optional().nullable(),
  metadata: z.record(z.unknown()).optional().nullable(),
});

export type SaveDraftInput = z.infer<typeof saveDraftSchema>;
