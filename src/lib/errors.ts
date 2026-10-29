/**
 * Shared application error types.
 *
 * These stay framework-agnostic so services can throw typed errors without
 * depending on Next.js response utilities.
 */

export const ErrorCodes = {
  AUTHENTICATION_REQUIRED: 'AUTHENTICATION_REQUIRED',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  CONFLICT: 'CONFLICT',
  DUPLICATE_CLIENT_SERVICE: 'DUPLICATE_CLIENT_SERVICE',
  CLIENT_SERVICE_WRITE_CONFLICT: 'CLIENT_SERVICE_WRITE_CONFLICT',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  BAD_REQUEST: 'BAD_REQUEST',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  VERSION_CONFLICT: 'VERSION_CONFLICT',
  REVISION_PRECONDITION_REQUIRED: 'REVISION_PRECONDITION_REQUIRED',
  UNSUPPORTED_EDITOR_FORMAT: 'UNSUPPORTED_EDITOR_FORMAT',
  IMPACT_CHANGED: 'IMPACT_CHANGED',
  RULE_NOT_APPLICABLE: 'RULE_NOT_APPLICABLE',
  MISSING_RULE_INPUT: 'MISSING_RULE_INPUT',
  SCHEDULE_LIMIT_EXCEEDED: 'SCHEDULE_LIMIT_EXCEEDED',
  DUPLICATE_SCHEDULE_ENTRY: 'DUPLICATE_SCHEDULE_ENTRY',
  OCCURRENCE_IMMUTABLE: 'OCCURRENCE_IMMUTABLE',
  RECONCILIATION_PENDING: 'RECONCILIATION_PENDING',
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];

export type DeadlineErrorCode =
  | typeof ErrorCodes.VERSION_CONFLICT
  | typeof ErrorCodes.IMPACT_CHANGED
  | typeof ErrorCodes.RULE_NOT_APPLICABLE
  | typeof ErrorCodes.MISSING_RULE_INPUT
  | typeof ErrorCodes.SCHEDULE_LIMIT_EXCEEDED
  | typeof ErrorCodes.DUPLICATE_SCHEDULE_ENTRY
  | typeof ErrorCodes.OCCURRENCE_IMMUTABLE
  | typeof ErrorCodes.RECONCILIATION_PENDING;

export class ApiError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public statusCode: number = 500,
    public details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Typed errors emitted by the deadline/schedule domain.
 *
 * Deadline conflicts are client-resolvable (409), while invalid rule input
 * and applicability failures are semantically invalid requests (422).
 */
export class DeadlineApiError extends ApiError {
  constructor(
    code: DeadlineErrorCode,
    message: string,
    statusCode: 409 | 422,
    details?: unknown,
  ) {
    if (statusCode !== 409 && statusCode !== 422) {
      throw new RangeError('Deadline errors must use HTTP 409 or 422');
    }
    super(code, message, statusCode, details);
    this.name = 'DeadlineApiError';
  }
}

export class NotFoundError extends ApiError {
  constructor(message: string, details?: unknown) {
    super(ErrorCodes.NOT_FOUND, message, 404, details);
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends ApiError {
  constructor(message: string, details?: unknown) {
    super(ErrorCodes.VALIDATION_ERROR, message, 400, details);
    this.name = 'ValidationError';
  }
}

export class ForbiddenError extends ApiError {
  constructor(message: string = 'You do not have permission to perform this action', details?: unknown) {
    super(ErrorCodes.PERMISSION_DENIED, message, 403, details);
    this.name = 'ForbiddenError';
  }
}

export class UnauthorizedError extends ApiError {
  constructor(message: string = 'Authentication required', details?: unknown) {
    super(ErrorCodes.AUTHENTICATION_REQUIRED, message, 401, details);
    this.name = 'UnauthorizedError';
  }
}

export class ConflictError extends ApiError {
  constructor(message: string, details?: unknown) {
    super(ErrorCodes.CONFLICT, message, 409, details);
    this.name = 'ConflictError';
  }
}

export class BadRequestError extends ApiError {
  constructor(message: string, details?: unknown) {
    super(ErrorCodes.BAD_REQUEST, message, 400, details);
    this.name = 'BadRequestError';
  }
}

export class UnprocessableEntityError extends ApiError {
  constructor(message: string, details?: unknown) {
    super(ErrorCodes.VALIDATION_ERROR, message, 422, details);
    this.name = 'UnprocessableEntityError';
  }
}