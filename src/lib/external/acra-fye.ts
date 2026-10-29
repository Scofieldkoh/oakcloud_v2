/**
 * ACRA Financial Year End Calculation Utility
 *
 * Pure helpers for ACRA compliance data: entity-type eligibility checks and
 * the FYE calculation from the account due date. Database access for the
 * locally synced ACRA records lives in `./acra-records` (server-only).
 *
 * Usage:
 *   import { calculateFYEFromAccountDueDate, isCompanyEntityType } from '@/lib/external/acra-fye';
 */

import logger from '@/lib/logger';

// Entity types that are considered "company" structures
export const COMPANY_ENTITY_TYPES = [
  'PRIVATE_LIMITED',
  'EXEMPTED_PRIVATE_LIMITED',
  'PUBLIC_LIMITED',
  'FOREIGN_COMPANY',
  'VARIABLE_CAPITAL_COMPANY',
] as const;

export type CompanyEntityType = (typeof COMPANY_ENTITY_TYPES)[number];

export interface FYEResult {
  day: number;
  month: number;
}

/**
 * Check if an entity type is a company structure (eligible for FYE retrieval)
 */
export function isCompanyEntityType(entityType: string): boolean {
  return COMPANY_ENTITY_TYPES.includes(entityType as CompanyEntityType);
}

/**
 * Check if entity type is a public company (uses 6 months for FYE calculation)
 */
export function isPublicCompany(entityType: string): boolean {
  return entityType === 'PUBLIC_LIMITED';
}

/**
 * Get the last day of a given month
 */
export function getLastDayOfMonth(year: number, month: number): number {
  // Month is 1-indexed (1 = January, 12 = December)
  // Create date for first day of next month, then go back one day
  return new Date(year, month, 0).getDate();
}

/**
 * Calculate FYE from account_due_date based on entity type
 *
 * - Public companies: 6 months before account_due_date
 * - All other company types: 7 months before account_due_date
 *
 * FYE is set to the last day of the calculated month.
 *
 * Example: account_due_date = 31 July 2026 for private company
 * → 7 months before = December 2025
 * → FYE = 31 December (day: 31, month: 12)
 */
export function calculateFYEFromAccountDueDate(
  accountDueDate: string,
  entityType: string
): FYEResult {
  const dueDate = new Date(accountDueDate);

  if (isNaN(dueDate.getTime())) {
    throw new Error(`Invalid account_due_date: ${accountDueDate}`);
  }

  // Determine months to subtract based on company type
  const monthsToSubtract = isPublicCompany(entityType) ? 6 : 7;

  // Calculate the FYE month
  const fyeDate = new Date(dueDate);
  fyeDate.setMonth(fyeDate.getMonth() - monthsToSubtract);

  const fyeMonth = fyeDate.getMonth() + 1; // Convert to 1-indexed
  const fyeYear = fyeDate.getFullYear();
  const fyeDay = getLastDayOfMonth(fyeYear, fyeMonth);

  logger.info('Calculated FYE', {
    accountDueDate,
    entityType,
    monthsToSubtract,
    fyeDay,
    fyeMonth,
  });

  return { day: fyeDay, month: fyeMonth };
}
