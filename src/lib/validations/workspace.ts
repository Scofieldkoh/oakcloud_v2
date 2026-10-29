/**
 * Workspace Validation Schemas
 *
 * Zod schemas for validating workspace-related API inputs.
 */

import { z } from 'zod';

// ============================================================================
// Enums
// ============================================================================

export const workspaceStatusEnum = z.enum([
  'ACTIVE',
  'SUSPENDED',
  'PENDING_SETUP',
  'DEACTIVATED',
]);

// ============================================================================
// Create Workspace
// ============================================================================

export const createWorkspaceSchema = z.object({
  name: z
    .string()
    .min(2, 'Name must be at least 2 characters')
    .max(100, 'Name must be at most 100 characters'),
  slug: z
    .string()
    .min(2, 'Slug must be at least 2 characters')
    .max(50, 'Slug must be at most 50 characters')
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      'Slug must be lowercase alphanumeric with hyphens'
    )
    .optional(),
  contactEmail: z.string().email('Invalid email').optional(),
  contactPhone: z
    .string()
    .max(20, 'Phone must be at most 20 characters')
    .optional(),
  maxUsers: z.number().int().min(1).max(10000).optional(),
  maxCompanies: z.number().int().min(1).max(10000).optional(),
  maxStorageMb: z.number().int().min(100).max(1000000).optional(),
  logoUrl: z.string().url('Invalid logo URL').optional(),
  primaryColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid hex color')
    .optional(),
  settings: z.record(z.unknown()).optional(),
});

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;

// ============================================================================
// Update Workspace
// ============================================================================

export const updateWorkspaceSchema = createWorkspaceSchema.partial().extend({
  id: z.string().uuid('Invalid workspace ID'),
});

export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceSchema>;

// ============================================================================
// Workspace Status Update
// ============================================================================

export const updateWorkspaceStatusSchema = z.object({
  id: z.string().uuid('Invalid workspace ID'),
  status: workspaceStatusEnum,
  reason: z.string().min(10, 'Reason must be at least 10 characters').optional(),
});

export type UpdateWorkspaceStatusInput = z.infer<typeof updateWorkspaceStatusSchema>;

// ============================================================================
// Workspace Search
// ============================================================================

export const workspaceSearchSchema = z.object({
  query: z.string().optional(),
  status: workspaceStatusEnum.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(20),
  sortBy: z.enum(['name', 'createdAt', 'status']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type WorkspaceSearchInput = z.infer<typeof workspaceSearchSchema>;

// ============================================================================
// Workspace User Invite
// ============================================================================

// Company assignment - just links user to company (permissions via role assignments)
export const companyAssignmentSchema = z.object({
  companyId: z.string().uuid('Invalid company ID'),
  isPrimary: z.boolean().optional(),
});

// Role assignment - can be workspace-wide (companyId = null) or company-specific
export const roleAssignmentSchema = z.object({
  roleId: z.string().uuid('Invalid role ID'),
  companyId: z.string().uuid('Invalid company ID').nullable().optional(), // null = "All Companies"
});

export const inviteUserSchema = z.object({
  email: z.string().email('Invalid email'),
  firstName: z.string().min(1, 'First name is required').max(100),
  lastName: z.string().min(1, 'Last name is required').max(100),
  // Multi-company assignments (which companies user can access)
  companyAssignments: z.array(companyAssignmentSchema).optional(),
  // Role assignments (required - at least one role assignment needed)
  roleAssignments: z.array(roleAssignmentSchema).min(1, 'At least one role assignment is required'),
});

export type CompanyAssignmentInput = z.infer<typeof companyAssignmentSchema>;
export type RoleAssignmentInput = z.infer<typeof roleAssignmentSchema>;
export type InviteUserInput = z.infer<typeof inviteUserSchema>;

// ============================================================================
// Workspace Settings
// ============================================================================

export const workspaceSettingsSchema = z.object({
  // Localization settings
  timezone: z.string().min(1).max(100).optional(),

  // Feature flags
  enableDocumentExtraction: z.boolean().optional(),
  enableAuditExport: z.boolean().optional(),
  enableApiAccess: z.boolean().optional(),

  // Notification settings
  emailNotifications: z.boolean().optional(),
  notifyOnNewCompany: z.boolean().optional(),
  notifyOnDocumentUpload: z.boolean().optional(),

  // Compliance settings
  requireDeleteReason: z.boolean().optional(),
  retentionDays: z.number().int().min(30).max(3650).optional(),

  // Custom settings (extensible)
  custom: z.record(z.unknown()).optional(),
});

export type WorkspaceSettingsInput = z.infer<typeof workspaceSettingsSchema>;
