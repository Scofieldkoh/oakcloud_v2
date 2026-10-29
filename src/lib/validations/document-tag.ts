/**
 * Document Tag Validation Schemas
 *
 * Zod schemas for document tag operations and color configuration for UI.
 */

import { z } from 'zod';

// Tag color enum matching Prisma schema
export const tagColorEnum = z.enum([
  'GRAY',
  'RED',
  'ORANGE',
  'AMBER',
  'GREEN',
  'TEAL',
  'BLUE',
  'INDIGO',
  'PURPLE',
  'PINK',
]);

export type TagColor = z.infer<typeof tagColorEnum>;

// Color configuration for UI styling
export const TAG_COLORS: Record<
  TagColor,
  { bg: string; text: string; border: string; hex: string }
> = {
  GRAY: {
    bg: 'bg-gray-100 dark:bg-gray-800',
    text: 'text-gray-700 dark:text-gray-300',
    border: 'border-gray-200 dark:border-gray-700',
    hex: '#6B7280',
  },
  RED: {
    bg: 'bg-red-100 dark:bg-red-900/30',
    text: 'text-red-700 dark:text-red-400',
    border: 'border-red-200 dark:border-red-800',
    hex: '#EF4444',
  },
  ORANGE: {
    bg: 'bg-orange-100 dark:bg-orange-900/30',
    text: 'text-orange-700 dark:text-orange-400',
    border: 'border-orange-200 dark:border-orange-800',
    hex: '#F97316',
  },
  AMBER: {
    bg: 'bg-amber-100 dark:bg-amber-900/30',
    text: 'text-amber-700 dark:text-amber-400',
    border: 'border-amber-200 dark:border-amber-800',
    hex: '#F59E0B',
  },
  GREEN: {
    bg: 'bg-green-100 dark:bg-green-900/30',
    text: 'text-green-700 dark:text-green-400',
    border: 'border-green-200 dark:border-green-800',
    hex: '#22C55E',
  },
  TEAL: {
    bg: 'bg-teal-100 dark:bg-teal-900/30',
    text: 'text-teal-700 dark:text-teal-400',
    border: 'border-teal-200 dark:border-teal-800',
    hex: '#14B8A6',
  },
  BLUE: {
    bg: 'bg-blue-100 dark:bg-blue-900/30',
    text: 'text-blue-700 dark:text-blue-400',
    border: 'border-blue-200 dark:border-blue-800',
    hex: '#3B82F6',
  },
  INDIGO: {
    bg: 'bg-indigo-100 dark:bg-indigo-900/30',
    text: 'text-indigo-700 dark:text-indigo-400',
    border: 'border-indigo-200 dark:border-indigo-800',
    hex: '#6366F1',
  },
  PURPLE: {
    bg: 'bg-purple-100 dark:bg-purple-900/30',
    text: 'text-purple-700 dark:text-purple-400',
    border: 'border-purple-200 dark:border-purple-800',
    hex: '#A855F7',
  },
  PINK: {
    bg: 'bg-pink-100 dark:bg-pink-900/30',
    text: 'text-pink-700 dark:text-pink-400',
    border: 'border-pink-200 dark:border-pink-800',
    hex: '#EC4899',
  },
};

// Create tag schema
export const createTagSchema = z.object({
  name: z
    .string()
    .min(1, 'Tag name is required')
    .max(50, 'Tag name must be 50 characters or less')
    .trim(),
  color: tagColorEnum.default('GRAY'),
  description: z.string().max(200, 'Description must be 200 characters or less').optional(),
});

// Update tag schema
export const updateTagSchema = z.object({
  name: z
    .string()
    .min(1, 'Tag name is required')
    .max(50, 'Tag name must be 50 characters or less')
    .trim()
    .optional(),
  color: tagColorEnum.optional(),
  description: z.string().max(200, 'Description must be 200 characters or less').optional().nullable(),
});

// Search tags schema
export const searchTagsSchema = z.object({
  query: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

// Add tag to document schema
export const addTagToDocumentSchema = z.object({
  tagId: z.string().uuid('Invalid tag ID'),
});

// Create and add tag schema (for quick tagging with new tag names)
export const createAndAddTagSchema = z.object({
  name: z
    .string()
    .min(1, 'Tag name is required')
    .max(50, 'Tag name must be 50 characters or less')
    .trim(),
  color: tagColorEnum.default('GRAY'),
});

export type CreateTagInput = z.infer<typeof createTagSchema>;
export type UpdateTagInput = z.infer<typeof updateTagSchema>;
export type SearchTagsInput = z.infer<typeof searchTagsSchema>;
export type AddTagToDocumentInput = z.infer<typeof addTagToDocumentSchema>;
export type CreateAndAddTagInput = z.infer<typeof createAndAddTagSchema>;
