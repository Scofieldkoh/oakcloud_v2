/**
 * Shared tenant-aware types
 *
 * This module provides common types used across services for multi-tenancy support.
 */

/**
 * Base parameters for tenant-aware operations.
 * All tenant-scoped service functions should accept these parameters.
 */
export interface TenantAwareParams {
  /** The tenant ID for scoping operations */
  tenantId: string;
  /** The user ID performing the operation */
  userId: string;
}

/**
 * Extended parameters for tenant-aware operations that may include company context.
 */
export interface TenantCompanyAwareParams extends TenantAwareParams {
  /** Optional company ID for company-scoped operations */
  companyId?: string;
}
