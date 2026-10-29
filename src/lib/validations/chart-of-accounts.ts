/**
 * Chart of Accounts Validation Schemas
 *
 * Zod schemas and constants for chart of accounts operations.
 */

import { z } from 'zod';

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Account types matching the Prisma AccountType enum.
 */
export const ACCOUNT_TYPES = [
  'ASSET',
  'LIABILITY',
  'EQUITY',
  'REVENUE',
  'EXPENSE',
] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];

/**
 * Account status matching the Prisma AccountStatus enum.
 */
export const ACCOUNT_STATUSES = ['ACTIVE', 'INACTIVE', 'ARCHIVED'] as const;

export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/**
 * Human-readable account type names for display in UI.
 */
export const ACCOUNT_TYPE_NAMES: Record<AccountType, string> = {
  ASSET: 'Asset',
  LIABILITY: 'Liability',
  EQUITY: 'Equity',
  REVENUE: 'Revenue',
  EXPENSE: 'Expense',
};

/**
 * Account type descriptions for UI tooltips.
 */
export const ACCOUNT_TYPE_DESCRIPTIONS: Record<AccountType, string> = {
  ASSET: 'Resources owned by the business (e.g., cash, inventory, equipment)',
  LIABILITY: 'Debts and obligations owed by the business (e.g., loans, payables)',
  EQUITY: "Owner's stake in the business (e.g., capital, retained earnings)",
  REVENUE: 'Income earned from business activities (e.g., sales, service fees)',
  EXPENSE: 'Costs incurred in business operations (e.g., salaries, rent, utilities)',
};

/**
 * Account status names for display in UI.
 */
export const ACCOUNT_STATUS_NAMES: Record<AccountStatus, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  ARCHIVED: 'Archived',
};

/**
 * Accounting providers matching the Prisma AccountingProvider enum.
 */
export const ACCOUNTING_PROVIDERS = [
  'XERO',
  'QUICKBOOKS',
  'MYOB',
  'SAGE',
] as const;

export type AccountingProvider = (typeof ACCOUNTING_PROVIDERS)[number];

/**
 * Provider display names for UI.
 */
export const PROVIDER_NAMES: Record<AccountingProvider, string> = {
  XERO: 'Xero',
  QUICKBOOKS: 'QuickBooks',
  MYOB: 'MYOB',
  SAGE: 'Sage',
};

// ============================================================================
// ZOD SCHEMAS
// ============================================================================

export const accountTypeSchema = z.enum(ACCOUNT_TYPES);
export const accountStatusSchema = z.enum(ACCOUNT_STATUSES);
export const accountingProviderSchema = z.enum(ACCOUNTING_PROVIDERS);

/**
 * Schema for creating a new chart of accounts entry.
 */
export const createAccountSchema = z.object({
  code: z
    .string()
    .min(1, 'Account code is required')
    .max(20, 'Account code must not exceed 20 characters')
    .regex(/^[A-Z0-9\-_]+$/i, 'Account code must be alphanumeric (letters, numbers, hyphens, underscores only)'),
  name: z
    .string()
    .min(1, 'Account name is required')
    .max(200, 'Account name must not exceed 200 characters'),
  description: z
    .string()
    .max(500, 'Description must not exceed 500 characters')
    .optional()
    .nullable(),
  accountType: accountTypeSchema,
  parentId: z.string().uuid().optional().nullable(),
  sortOrder: z.coerce.number().int().min(0).optional().default(0),
  isTaxApplicable: z.coerce.boolean().optional().default(true),
  isHeader: z.coerce.boolean().optional().default(false),
  // Scope - at least tenantId should be set for tenant-level, both for company-level
  tenantId: z.string().uuid().optional().nullable(),
  companyId: z.string().uuid().optional().nullable(),
});

export type CreateAccountInput = z.infer<typeof createAccountSchema>;

/**
 * Schema for updating an existing chart of accounts entry.
 */
export const updateAccountSchema = z.object({
  code: z
    .string()
    .min(1, 'Account code is required')
    .max(20, 'Account code must not exceed 20 characters')
    .regex(/^[A-Z0-9\-_]+$/i, 'Account code must be alphanumeric')
    .optional(),
  name: z
    .string()
    .min(1, 'Account name is required')
    .max(200, 'Account name must not exceed 200 characters')
    .optional(),
  description: z
    .string()
    .max(500, 'Description must not exceed 500 characters')
    .optional()
    .nullable(),
  accountType: accountTypeSchema.optional(),
  status: accountStatusSchema.optional(),
  parentId: z.string().uuid().optional().nullable(),
  sortOrder: z.coerce.number().int().min(0).optional(),
  isTaxApplicable: z.coerce.boolean().optional(),
  isHeader: z.coerce.boolean().optional(),
});

export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;

/**
 * Schema for creating/updating an account mapping to an external platform.
 */
export const accountMappingSchema = z.object({
  accountId: z.string().uuid(),
  companyId: z.string().uuid(),
  provider: accountingProviderSchema,
  externalCode: z.string().max(50).optional().nullable(),
  externalId: z.string().max(100).optional().nullable(),
  externalName: z.string().max(200).optional().nullable(),
});

export type AccountMappingInput = z.infer<typeof accountMappingSchema>;

/**
 * Schema for updating an existing account mapping.
 */
export const updateAccountMappingSchema = z.object({
  externalCode: z.string().max(50).optional().nullable(),
  externalId: z.string().max(100).optional().nullable(),
  externalName: z.string().max(200).optional().nullable(),
});

export type UpdateAccountMappingInput = z.infer<typeof updateAccountMappingSchema>;

/**
 * Schema for searching/filtering chart of accounts.
 */
export const accountSearchSchema = z.object({
  search: z.string().optional(),
  accountType: accountTypeSchema.optional(),
  status: accountStatusSchema.optional(),
  tenantId: z.string().uuid().optional().nullable(),
  companyId: z.string().uuid().optional().nullable(),
  includeSystem: z.coerce.boolean().optional().default(true),
  parentId: z.string().uuid().optional().nullable(),
  topLevelOnly: z.coerce.boolean().optional().default(false), // Only accounts without parents
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  sortBy: z.enum(['code', 'name', 'accountType', 'sortOrder', 'createdAt']).optional().default('sortOrder'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('asc'),
});

export type AccountSearchInput = z.infer<typeof accountSearchSchema>;

/**
 * Schema for fetching account hierarchy.
 */
export const accountHierarchySchema = z.object({
  tenantId: z.string().uuid().optional().nullable(),
  companyId: z.string().uuid().optional().nullable(),
  includeSystem: z.coerce.boolean().optional().default(true),
  accountType: accountTypeSchema.optional(),
  status: accountStatusSchema.optional().default('ACTIVE'),
});

export type AccountHierarchyInput = z.infer<typeof accountHierarchySchema>;

/**
 * Schema for fetching accounts for a select dropdown (simplified).
 */
export const accountSelectSchema = z.object({
  tenantId: z.string().uuid().optional().nullable(),
  companyId: z.string().uuid().optional().nullable(),
  accountType: accountTypeSchema.optional(),
  headersOnly: z.coerce.boolean().optional().default(false),
});

export type AccountSelectInput = z.infer<typeof accountSelectSchema>;

/**
 * Schema for bulk mapping operations.
 */
export const bulkMappingSchema = z.object({
  companyId: z.string().uuid(),
  provider: accountingProviderSchema,
  mappings: z.array(
    z.object({
      accountId: z.string().uuid(),
      externalCode: z.string().max(50).optional().nullable(),
      externalId: z.string().max(100).optional().nullable(),
      externalName: z.string().max(200).optional().nullable(),
    })
  ),
});

export type BulkMappingInput = z.infer<typeof bulkMappingSchema>;

/**
 * Schema for company mappings query.
 */
export const companyMappingsQuerySchema = z.object({
  companyId: z.string().uuid(),
  provider: accountingProviderSchema.optional(),
});

export type CompanyMappingsQueryInput = z.infer<typeof companyMappingsQuerySchema>;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Check if an account type is valid.
 */
export function isValidAccountType(type: string): type is AccountType {
  return ACCOUNT_TYPES.includes(type as AccountType);
}

/**
 * Check if an account status is valid.
 */
export function isValidAccountStatus(status: string): status is AccountStatus {
  return ACCOUNT_STATUSES.includes(status as AccountStatus);
}

/**
 * Get display label for account type.
 */
export function getAccountTypeLabel(type: AccountType): string {
  return ACCOUNT_TYPE_NAMES[type];
}

/**
 * Get display label for account status.
 */
export function getAccountStatusLabel(status: AccountStatus): string {
  return ACCOUNT_STATUS_NAMES[status];
}

/**
 * Get display label for provider.
 */
export function getProviderLabel(provider: AccountingProvider): string {
  return PROVIDER_NAMES[provider];
}

/**
 * Generate account scope label for display.
 */
export function getAccountScopeLabel(
  tenantId: string | null,
  companyId: string | null
): string {
  if (!tenantId && !companyId) {
    return 'System';
  }
  if (tenantId && !companyId) {
    return 'Tenant';
  }
  return 'Company';
}

/**
 * Validate account code format.
 */
export function isValidAccountCode(code: string): boolean {
  return /^[A-Z0-9\-_]+$/i.test(code) && code.length <= 20;
}
