/**
 * Shared Zod schemas for query parameter validation
 * Use these to validate query parameters in API routes
 */

import { z } from 'zod';
import {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  MAX_QUERY_STRING_LENGTH,
} from '../constants/application';

// ============================================================================
// Primitive Validators
// ============================================================================

/**
 * Validates a string that should be parsed as a positive integer
 * Returns the parsed number or throws on invalid input
 */
export const positiveIntString = z
  .string()
  .regex(/^\d+$/, 'Must be a positive integer')
  .transform((val) => parseInt(val, 10))
  .refine((val) => val > 0, 'Must be greater than 0');

/**
 * Validates a string that should be parsed as a non-negative integer
 */
export const nonNegativeIntString = z
  .string()
  .regex(/^\d+$/, 'Must be a non-negative integer')
  .transform((val) => parseInt(val, 10));

/**
 * Validates a string boolean ('true' | 'false')
 */
export const booleanString = z
  .enum(['true', 'false'])
  .transform((val) => val === 'true');

/**
 * Validates optional boolean string
 */
export const optionalBooleanString = z
  .enum(['true', 'false'])
  .optional()
  .transform((val) => (val === undefined ? undefined : val === 'true'));

/**
 * Validates a UUID string
 */
export const uuidString = z.string().uuid('Invalid UUID format');

/**
 * Validates an ISO date string
 */
export const isoDateString = z.string().datetime({ message: 'Invalid ISO date format' });

/**
 * Validates a date string (YYYY-MM-DD or ISO format)
 */
export const dateString = z
  .string()
  .refine(
    (val) => !isNaN(Date.parse(val)),
    'Invalid date format'
  )
  .transform((val) => new Date(val));

// ============================================================================
// Pagination Schema
// ============================================================================

export const paginationSchema = z.object({
  page: positiveIntString.optional().default('1'),
  limit: z
    .string()
    .regex(/^\d+$/)
    .transform((val) => Math.min(parseInt(val, 10), MAX_PAGE_LIMIT))
    .optional()
    .default(String(DEFAULT_PAGE_LIMIT)),
});

export type PaginationParams = z.infer<typeof paginationSchema>;

// ============================================================================
// Sorting Schema
// ============================================================================

export const sortOrderSchema = z.enum(['asc', 'desc']).optional().default('desc');

export function createSortSchema<T extends readonly string[]>(allowedFields: T) {
  return z.object({
    sortBy: z.enum(allowedFields as unknown as [string, ...string[]]).optional(),
    sortOrder: sortOrderSchema,
  });
}

// ============================================================================
// Common Filter Schemas
// ============================================================================

export const tenantIdParamSchema = z.object({
  tenantId: uuidString.optional(),
});

export const querySearchSchema = z.object({
  query: z.string().max(MAX_QUERY_STRING_LENGTH).optional(),
});

export const dateRangeSchema = z.object({
  startDate: dateString.optional(),
  endDate: dateString.optional(),
});

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Parse and validate query parameters from URLSearchParams
 * Returns validated data or throws ZodError
 */
export function parseQueryParams<T extends z.ZodSchema>(
  searchParams: URLSearchParams,
  schema: T
): z.infer<T> {
  const params: Record<string, string> = {};
  searchParams.forEach((value, key) => {
    params[key] = value;
  });
  return schema.parse(params);
}

/**
 * Safely parse query parameters, returning null on validation failure
 * Use this when you want to handle validation errors gracefully
 */
export function safeParseQueryParams<T extends z.ZodSchema>(
  searchParams: URLSearchParams,
  schema: T
): { success: true; data: z.infer<T> } | { success: false; error: z.ZodError } {
  const params: Record<string, string> = {};
  searchParams.forEach((value, key) => {
    params[key] = value;
  });
  return schema.safeParse(params);
}

/**
 * Create a validation error response for invalid query parameters
 */
export function createValidationErrorResponse(error: z.ZodError) {
  return {
    error: 'Invalid query parameters',
    details: error.errors.map((e) => ({
      field: e.path.join('.'),
      message: e.message,
    })),
  };
}

// ============================================================================
// Specific Route Schemas
// ============================================================================

/**
 * Common list endpoints pagination + search
 */
export const listQuerySchema = paginationSchema.merge(querySearchSchema);

/**
 * Workspace users list
 */
export const workspaceUsersQuerySchema = paginationSchema.merge(querySearchSchema).extend({
  role: z.string().optional(),
  company: z.string().optional(),
  sortBy: z.enum(['firstName', 'lastName', 'email', 'isActive', 'lastLoginAt', 'createdAt']).optional().default('createdAt'),
  sortOrder: sortOrderSchema,
});

/**
 * Audit logs query
 */
export const auditLogsQuerySchema = paginationSchema.merge(dateRangeSchema).extend({
  action: z.string().optional(),
  actions: z.string().optional(), // comma-separated
  entityType: z.string().optional(),
  entityTypes: z.string().optional(), // comma-separated
  userId: uuidString.optional(),
  companyId: uuidString.optional(),
  sortBy: z.enum(['createdAt', 'action', 'entityType']).optional().default('createdAt'),
  sortOrder: sortOrderSchema,
});

/**
 * Companies list query
 */
export const companiesQuerySchema = paginationSchema.extend({
  query: z.string().max(MAX_QUERY_STRING_LENGTH).optional(),
  entityType: z.string().optional(),
  status: z.string().optional(),
  incorporationDateFrom: dateString.optional(),
  incorporationDateTo: dateString.optional(),
  hasCharges: optionalBooleanString,
  financialYearEndMonth: z
    .string()
    .regex(/^\d+$/)
    .transform((val) => parseInt(val, 10))
    .refine((val) => val >= 1 && val <= 12, 'Month must be between 1 and 12')
    .optional(),
  sortBy: z.enum(['name', 'createdAt', 'uen', 'status']).optional(),
  sortOrder: sortOrderSchema,
});

/**
 * Document templates query
 */
export const documentTemplatesQuerySchema = paginationSchema.extend({
  query: z.string().max(MAX_QUERY_STRING_LENGTH).optional(),
  category: z.string().optional(),
  isActive: optionalBooleanString,
  sortBy: z.enum(['name', 'createdAt', 'category']).optional(),
  sortOrder: sortOrderSchema,
});

/**
 * Generated documents query
 */
export const generatedDocumentsQuerySchema = paginationSchema.extend({
  query: z.string().max(MAX_QUERY_STRING_LENGTH).optional(),
  companyId: uuidString.optional(),
  companyName: z.string().optional(),
  templateId: uuidString.optional(),
  status: z.enum(['draft', 'finalized', 'all']).optional(),
  sortBy: z.enum(['title', 'createdAt', 'status']).optional(),
  sortOrder: sortOrderSchema,
});

/**
 * Contacts query
 */
export const contactsQuerySchema = paginationSchema.extend({
  query: z.string().max(MAX_QUERY_STRING_LENGTH).optional(),
  contactType: z.string().optional(),
  companyId: uuidString.optional(),
  sortBy: z.enum(['firstName', 'lastName', 'email', 'createdAt']).optional(),
  sortOrder: sortOrderSchema,
});

/**
 * Connector usage query
 */
export const connectorUsageQuerySchema = paginationSchema.merge(dateRangeSchema).extend({
  export: z.enum(['csv', 'json']).optional(),
  model: z.string().optional(),
  operation: z.string().optional(),
  success: optionalBooleanString,
  sortBy: z.enum(['createdAt', 'costCents', 'totalTokens', 'latencyMs']).optional().default('createdAt'),
  sortOrder: sortOrderSchema,
});

/**
 * PDF export options
 */
export const pdfExportQuerySchema = z.object({
  format: z.enum(['A4', 'Letter']).optional().default('A4'),
  orientation: z.enum(['portrait', 'landscape']).optional().default('portrait'),
  letterhead: booleanString.optional().default('true'),
  filename: z.string().max(MAX_QUERY_STRING_LENGTH).optional(),
});
