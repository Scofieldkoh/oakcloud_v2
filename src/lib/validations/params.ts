/**
 * Route Parameter Validation
 *
 * Provides validation utilities for route parameters (IDs, tokens, etc.)
 * to prevent invalid data from reaching the database layer.
 */

import { z } from 'zod';

// ============================================================================
// UUID Validation
// ============================================================================

/**
 * UUID v4 regex pattern
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Zod schema for UUID validation
 */
export const uuidSchema = z.string().regex(UUID_REGEX, 'Invalid ID format');

/**
 * Validate a string is a valid UUID v4
 */
export function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

/**
 * Parse and validate a UUID, throwing if invalid
 */
export function parseUuid(value: string, fieldName: string = 'ID'): string {
  if (!isValidUuid(value)) {
    throw new Error(`Invalid ${fieldName} format`);
  }
  return value;
}

/**
 * Safely parse a UUID, returning null if invalid
 */
export function safeParseUuid(value: string | undefined | null): string | null {
  if (!value) return null;
  return isValidUuid(value) ? value : null;
}

// ============================================================================
// Common Route Parameter Schemas
// ============================================================================

/**
 * Schema for ID route parameter
 */
export const idParamSchema = z.object({
  id: uuidSchema,
});

/**
 * Schema for company and related entity route parameters
 */
export const companyIdParamSchema = z.object({
  id: uuidSchema.describe('Company ID'),
});

export const officerIdParamSchema = z.object({
  id: uuidSchema.describe('Company ID'),
  officerId: uuidSchema.describe('Officer ID'),
});

export const shareholderIdParamSchema = z.object({
  id: uuidSchema.describe('Company ID'),
  shareholderId: uuidSchema.describe('Shareholder ID'),
});

export const documentIdParamSchema = z.object({
  id: uuidSchema.describe('Document ID'),
});

export const contactIdParamSchema = z.object({
  id: uuidSchema.describe('Contact ID'),
});

export const tenantIdParamSchema = z.object({
  id: uuidSchema.describe('Tenant ID'),
});

export const userIdParamSchema = z.object({
  id: uuidSchema.describe('User ID'),
});

export const roleIdParamSchema = z.object({
  id: uuidSchema.describe('Role ID'),
});

// ============================================================================
// Validation Helper
// ============================================================================

/**
 * Validate route parameters against a schema
 * Returns validated params or throws error with helpful message
 */
export function validateParams<T>(
  params: Record<string, string>,
  schema: z.ZodSchema<T>
): T {
  const result = schema.safeParse(params);

  if (!result.success) {
    const firstError = result.error.errors[0];
    const field = firstError.path.join('.');
    throw new Error(`Invalid ${field}: ${firstError.message}`);
  }

  return result.data;
}

/**
 * Parse route params with UUID validation
 * A simpler helper for the common case of validating ID params
 */
export async function parseIdParams<T extends Record<string, string>>(
  params: Promise<T>
): Promise<T> {
  const resolvedParams = await params;
  const validated: Record<string, string> = {};

  for (const [key, value] of Object.entries(resolvedParams)) {
    // Check if the param looks like it should be a UUID (ends with 'id' or 'Id')
    if (key === 'id' || key.endsWith('Id') || key.endsWith('_id')) {
      if (!isValidUuid(value)) {
        throw new Error(`Invalid ${key} format`);
      }
    }
    validated[key] = value;
  }

  return validated as T;
}

// ============================================================================
// Token Validation
// ============================================================================

/**
 * Share token format (base64url safe characters)
 */
const TOKEN_REGEX = /^[a-zA-Z0-9_-]+$/;

/**
 * Validate a share/reset token format
 */
export function isValidToken(value: string, minLength: number = 16, maxLength: number = 256): boolean {
  if (value.length < minLength || value.length > maxLength) {
    return false;
  }
  return TOKEN_REGEX.test(value);
}

/**
 * Zod schema for token validation
 */
export const tokenSchema = z.string()
  .min(16, 'Token too short')
  .max(256, 'Token too long')
  .regex(TOKEN_REGEX, 'Invalid token format');

// ============================================================================
// Slug Validation
// ============================================================================

/**
 * Slug format (lowercase letters, numbers, hyphens)
 */
const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Validate a slug format
 */
export function isValidSlug(value: string): boolean {
  return SLUG_REGEX.test(value) && value.length >= 2 && value.length <= 100;
}

export const slugSchema = z.string()
  .min(2, 'Slug too short')
  .max(100, 'Slug too long')
  .regex(SLUG_REGEX, 'Invalid slug format (use lowercase letters, numbers, and hyphens)');
