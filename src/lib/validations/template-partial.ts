import { z } from 'zod';
import { listDateSchema, placeholderDefinitionSchema } from './document-template';

// ============================================================================
// Partial Name Validation
// ============================================================================

/**
 * Partial names must:
 * - Start with a letter
 * - Contain only letters, numbers, hyphens, and underscores
 * - Be between 1-100 characters
 */
const partialNameSchema = z
  .string()
  .min(1, 'Name is required')
  .max(100, 'Name must be 100 characters or less')
  .regex(
    /^[a-zA-Z][a-zA-Z0-9_-]*$/,
    'Name must start with a letter and contain only letters, numbers, hyphens, and underscores'
  );

// ============================================================================
// Category
// ============================================================================

/** Grouping shown in partial pickers: agreement wording, resolutions, or anything else. */
export const templatePartialCategoryEnum = z.enum(['AGREEMENT', 'RESOLUTION', 'OTHER']);
export type TemplatePartialCategoryValue = z.infer<typeof templatePartialCategoryEnum>;

export const TEMPLATE_PARTIAL_CATEGORY_OPTIONS: Array<{ value: TemplatePartialCategoryValue; label: string }> = [
  { value: 'AGREEMENT', label: 'Agreement' },
  { value: 'RESOLUTION', label: 'Resolutions' },
  { value: 'OTHER', label: 'Others' },
];

export function templatePartialCategoryLabel(category: string | null | undefined): string {
  return TEMPLATE_PARTIAL_CATEGORY_OPTIONS.find((option) => option.value === category)?.label ?? 'Others';
}

// ============================================================================
// Create Partial
// ============================================================================

export const createTemplatePartialSchema = z.object({
  name: partialNameSchema,
  displayName: z.string().min(1, 'Display name is required').max(200, 'Display name must be 200 characters or less'),
  header: z.string().max(200, 'Header must be 200 characters or less').optional().nullable(),
  description: z.string().max(1000).optional().nullable(),
  content: z.string().min(1, 'Content is required').max(500000, 'Content is too large'),
  placeholders: z.array(placeholderDefinitionSchema).default([]),
  category: templatePartialCategoryEnum.optional(),
});

export type CreateTemplatePartialInput = z.infer<typeof createTemplatePartialSchema>;

// ============================================================================
// Update Partial
// ============================================================================

export const updateTemplatePartialSchema = z.object({
  id: z.string().uuid(),
  expectedRevision: z.number().int().nonnegative().optional(),
  name: partialNameSchema.optional(),
  displayName: z.string().min(1).max(200).optional(),
  header: z.string().max(200, 'Header must be 200 characters or less').optional().nullable(),
  description: z.string().max(1000).optional().nullable(),
  content: z.string().min(1).max(500000).optional(),
  placeholders: z.array(placeholderDefinitionSchema).optional(),
  category: templatePartialCategoryEnum.optional(),
});

export type UpdateTemplatePartialInput = z.infer<typeof updateTemplatePartialSchema>;

// ============================================================================
// Search Partials
// ============================================================================

export const searchTemplatePartialsSchema = z.object({
  search: z.string().optional(),
  page: z.number().min(1).default(1),
  limit: z.number().min(1).max(100).default(20),
  sortBy: z.enum(['name', 'category', 'createdBy', 'createdAt', 'updatedAt']).default('name'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
  editor: z.enum(['oakdoc']).optional(),
  category: templatePartialCategoryEnum.optional(),
  /** Column filters from the partial list. */
  name: z.string().optional(),
  /** The partial's reference key (`{{> key}}`). */
  reference: z.string().optional(),
  description: z.string().optional(),
  /** `used`: referenced by at least one template; `unused`: by none. */
  usage: z.enum(['used', 'unused']).optional(),
  createdBy: z.string().optional(),
  updatedFrom: listDateSchema.optional(),
  updatedTo: listDateSchema.optional(),
});

export type SearchTemplatePartialsInput = z.infer<typeof searchTemplatePartialsSchema>;

// ============================================================================
// Duplicate Partial
// ============================================================================

export const duplicateTemplatePartialSchema = z.object({
  id: z.string().uuid(),
  name: partialNameSchema,
});

export type DuplicateTemplatePartialInput = z.infer<typeof duplicateTemplatePartialSchema>;
