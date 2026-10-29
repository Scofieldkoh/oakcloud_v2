/**
 * Audit Log Validation Schemas
 *
 * Zod schemas for validating audit log query parameters.
 */

import { z } from 'zod';

// ============================================================================
// Audit Action Enum
// ============================================================================

export const auditActionEnum = z.enum([
  'CREATE',
  'UPDATE',
  'DELETE',
  'RESTORE',
  'UPLOAD',
  'DOWNLOAD',
  'EXTRACT',
  'LOGIN',
  'LOGOUT',
  'LOGIN_FAILED',
  'PASSWORD_CHANGED',
  'PASSWORD_RESET',
  'PERMISSION_GRANTED',
  'PERMISSION_REVOKED',
  'ROLE_CHANGED',
  'TENANT_CREATED',
  'TENANT_UPDATED',
  'TENANT_SUSPENDED',
  'TENANT_ACTIVATED',
  'USER_INVITED',
  'USER_REMOVED',
  'EXPORT',
  'IMPORT',
  'BULK_UPDATE',
]);

// ============================================================================
// Audit Log Query Schema
// ============================================================================

export const auditLogQuerySchema = z.object({
  // Pagination
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),

  // Filters
  action: auditActionEnum.optional(),
  actions: z
    .string()
    .optional()
    .transform((val) => val?.split(',').filter(Boolean)),
  entityType: z.string().optional(),
  entityTypes: z
    .string()
    .optional()
    .transform((val) => val?.split(',').filter(Boolean)),
  userId: z.string().uuid().optional(),
  companyId: z.string().uuid().optional(),

  // Date range
  startDate: z
    .string()
    .optional()
    .transform((val) => (val ? new Date(val) : undefined)),
  endDate: z
    .string()
    .optional()
    .transform((val) => (val ? new Date(val) : undefined)),

  // Sorting
  sortBy: z.enum(['createdAt', 'action', 'entityType']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type AuditLogQueryInput = z.infer<typeof auditLogQuerySchema>;

// ============================================================================
// Audit Stats Query Schema
// ============================================================================

export const auditStatsQuerySchema = z.object({
  startDate: z
    .string()
    .transform((val) => new Date(val))
    .refine((date) => !isNaN(date.getTime()), 'Invalid start date'),
  endDate: z
    .string()
    .transform((val) => new Date(val))
    .refine((date) => !isNaN(date.getTime()), 'Invalid end date'),
});

export type AuditStatsQueryInput = z.infer<typeof auditStatsQuerySchema>;

// ============================================================================
// Entity Types
// ============================================================================

export const ENTITY_TYPES = [
  'Tenant',
  'User',
  'Company',
  'Contact',
  'CompanyOfficer',
  'CompanyShareholder',
  'CompanyAddress',
  'CompanyCharge',
  'Document',
  'TenantSettings',
] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];
