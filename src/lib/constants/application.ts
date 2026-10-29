/**
 * Application Constants
 *
 * Centralized constants for application-wide configuration values.
 * Using these constants ensures consistency and easy maintenance.
 */

// ============================================================================
// Authentication Constants
// ============================================================================

/** Cookie name for storing authentication token */
export const AUTH_COOKIE_NAME = 'auth-token';

/** Default JWT expiration time */
export const DEFAULT_JWT_EXPIRES_IN = '7d';

/** Cookie max age in seconds (7 days) */
export const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

/** Cookie configuration options */
export const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'strict' as const, // SECURITY: Use strict to prevent CSRF attacks
  path: '/',
};

// ============================================================================
// Security Constants
// ============================================================================

/** Minimum password length requirement */
export const MIN_PASSWORD_LENGTH = 8;

/** Password reset token expiry in hours */
export const PASSWORD_RESET_EXPIRY_HOURS = 24;

/** Bcrypt salt rounds for password hashing (legacy, for migration) */
export const BCRYPT_SALT_ROUNDS = 10;

/**
 * Argon2id configuration (OWASP recommended for password hashing)
 * See: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
 *
 * These parameters balance security with performance:
 * - t (iterations): 3 - time cost
 * - m (memory): 65536 KB (64 MB) - memory cost
 * - p (parallelism): 4 - thread count
 */
export const ARGON2_CONFIG = {
  /** Time cost (iterations) */
  t: 3,
  /** Memory cost in KB (64 MB) */
  m: 65536,
  /** Parallelism (threads) */
  p: 4,
  /** Output hash length in bytes */
  dkLen: 32,
  /** Salt length in bytes */
  saltLen: 16,
};

/** Enumeration protection delay range in milliseconds */
export const ENUMERATION_PROTECTION_DELAY = {
  min: 50,
  max: 150,
};

/** Minimum JWT secret length */
export const MIN_JWT_SECRET_LENGTH = 32;

// ============================================================================
// Encryption Constants
// ============================================================================

/** AES encryption algorithm */
export const ENCRYPTION_ALGORITHM = 'aes-256-gcm';

/** Initialization vector length in bytes */
export const ENCRYPTION_IV_LENGTH = 16;

/** Authentication tag length in bytes */
export const ENCRYPTION_TAG_LENGTH = 16;

// ============================================================================
// Pagination Constants
// ============================================================================

/** Default number of items per page */
export const DEFAULT_PAGE_LIMIT = 20;

/** Default limit for audit log queries */
export const DEFAULT_AUDIT_LOG_LIMIT = 50;

/** Maximum items per page */
export const MAX_PAGE_LIMIT = 100;

/** Maximum query string length */
export const MAX_QUERY_STRING_LENGTH = 200;

// ============================================================================
// File Upload Constants
// ============================================================================

/** Maximum file size in bytes (10MB) */
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

/** Maximum file size in MB */
export const MAX_FILE_SIZE_MB = 10;

// ============================================================================
// Tenant Default Constants
// ============================================================================

/** Default maximum users per tenant */
export const DEFAULT_TENANT_MAX_USERS = 50;

/** Default maximum companies per tenant */
export const DEFAULT_TENANT_MAX_COMPANIES = 100;

/** Default maximum storage in MB per tenant (10GB) */
export const DEFAULT_TENANT_MAX_STORAGE_MB = 10240;

/** Default primary color for tenant branding */
export const DEFAULT_TENANT_PRIMARY_COLOR = '#294d44';

/** Maximum tenant users allowed */
export const MAX_TENANT_USERS = 10000;

/** Maximum tenant storage in MB */
export const MAX_TENANT_STORAGE_MB = 1000000;

// ============================================================================
// Comment Constants
// ============================================================================

/** Maximum comment length in characters */
export const MAX_COMMENT_LENGTH = 1000;

// ============================================================================
// Validation Limits
// ============================================================================

/** Minimum string length for names */
export const MIN_STRING_LENGTH = 1;

/** Maximum name length */
export const MAX_NAME_LENGTH = 100;

/** Maximum description length */
export const MAX_DESCRIPTION_LENGTH = 200;

/** Maximum email length */
export const MAX_EMAIL_LENGTH = 255;

/** Maximum title length */
export const MAX_TITLE_LENGTH = 300;

/** Maximum field description length */
export const MAX_FIELD_DESCRIPTION_LENGTH = 500;

/** Maximum content preview length */
export const MAX_CONTENT_PREVIEW_LENGTH = 1000;

/** Maximum template description length */
export const MAX_TEMPLATE_DESCRIPTION_LENGTH = 5000;

/** Maximum content size in bytes for template partials */
export const MAX_CONTENT_SIZE_BYTES = 500000;

/** Minimum postal code length */
export const MIN_POSTAL_CODE_LENGTH = 5;

/** Maximum postal code length */
export const MAX_POSTAL_CODE_LENGTH = 10;

/** Months in a year (for financial year calculations) */
export const MONTHS_IN_YEAR = 12;

/** Maximum day of month */
export const MAX_DAY_OF_MONTH = 31;

// ============================================================================
// Editor/Panel Constants
// ============================================================================

/** Minimum panel width in pixels */
export const MIN_PANEL_WIDTH = 320;

/** Maximum panel width in pixels */
export const MAX_PANEL_WIDTH = 600;

/** Default panel width in pixels */
export const DEFAULT_PANEL_WIDTH = 380;

/** Default zoom level percentage */
export const DEFAULT_ZOOM_LEVEL = 100;

// ============================================================================
// HTTP Status Codes
// ============================================================================

export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  SERVER_ERROR: 500,
} as const;

// ============================================================================
// Error Messages
// ============================================================================

export const ERROR_MESSAGES = {
  UNAUTHORIZED: 'Unauthorized',
  FORBIDDEN: 'Forbidden',
  NOT_FOUND: 'Not found',
  SERVER_ERROR: 'Internal server error',
  INVALID_CREDENTIALS: 'Invalid credentials',
  USER_NOT_FOUND: 'User not found',
  TENANT_NOT_FOUND: 'Tenant not found',
  COMPANY_NOT_FOUND: 'Company not found',
  NO_TENANT_ASSOCIATION: 'No tenant association',
  ACCOUNT_ACCESS_RESTRICTED: 'Account access restricted',
} as const;

// ============================================================================
// Tenant Status Constants
// ============================================================================

export const TENANT_STATUSES = {
  ACTIVE: 'ACTIVE',
  PENDING_SETUP: 'PENDING_SETUP',
  SUSPENDED: 'SUSPENDED',
  DEACTIVATED: 'DEACTIVATED',
} as const;

// ============================================================================
// Document Status Constants
// ============================================================================

export const DOCUMENT_STATUSES = {
  DRAFT: 'DRAFT',
  FINALIZED: 'FINALIZED',
  ARCHIVED: 'ARCHIVED',
} as const;

// ============================================================================
// Extraction Status Constants
// ============================================================================

export const EXTRACTION_STATUSES = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const;

// ============================================================================
// Type Exports
// ============================================================================

export type TenantStatusType = (typeof TENANT_STATUSES)[keyof typeof TENANT_STATUSES];
export type DocumentStatusType = (typeof DOCUMENT_STATUSES)[keyof typeof DOCUMENT_STATUSES];
export type ExtractionStatusType = (typeof EXTRACTION_STATUSES)[keyof typeof EXTRACTION_STATUSES];
export type HttpStatusCode = (typeof HTTP_STATUS)[keyof typeof HTTP_STATUS];
