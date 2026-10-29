/**
 * API Error Handler Utility
 *
 * Centralized error handling for Next.js API routes
 * Provides consistent error responses and logging
 */

import { NextResponse } from 'next/server';
import { Prisma } from '@/generated/prisma';
import { createLogger } from './logger';
import { isInternalError } from './api-route-errors';
import { ApiError, ErrorCodes } from './errors';
import type { ErrorCode } from './errors';

const log = createLogger('api-error-handler');

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface ApiSuccessResponse<T = unknown> {
  success: true;
  data: T;
  meta?: {
    requestId?: string;
    timestamp?: string;
    [key: string]: unknown;
  };
}

/**
 * Handle API errors and return consistent error responses
 *
 * @param error - The error to handle
 * @param context - Optional context for logging (e.g., endpoint name)
 * @returns NextResponse with error details
 */
export function handleApiError(
  error: unknown,
  context?: string
): NextResponse<ApiErrorResponse> {
  const contextPrefix = context ? `[${context}]` : '[API]';

  // Handle ApiError instances
  if (error instanceof ApiError) {
    log.warn(`${contextPrefix} ${error.code}: ${error.message}`, error.details);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      },
      { status: error.statusCode }
    );
  }

  // Handle standard Error instances with specific messages
  if (error instanceof Error && !isInternalError(error)) {
    // Authentication errors
    if (error.message === 'Unauthorized' || error.message.includes('Authentication required')) {
      log.warn(`${contextPrefix} Unauthorized access attempt`);
      return NextResponse.json(
        {
          success: false,
          error: {
            code: ErrorCodes.AUTHENTICATION_REQUIRED,
            message: 'Authentication required',
          },
        },
        { status: 401 }
      );
    }

    // Permission errors
    if (error.message === 'Forbidden' || error.message.includes('Permission denied')) {
      log.warn(`${contextPrefix} Permission denied: ${error.message}`);
      return NextResponse.json(
        {
          success: false,
          error: {
            code: ErrorCodes.PERMISSION_DENIED,
            message: 'You do not have permission to perform this action',
          },
        },
        { status: 403 }
      );
    }

    // Not found errors
    if (error.message.includes('not found') || error.message.includes('Not found')) {
      log.info(`${contextPrefix} Resource not found: ${error.message}`);
      return NextResponse.json(
        {
          success: false,
          error: {
            code: ErrorCodes.NOT_FOUND,
            message: error.message,
          },
        },
        { status: 404 }
      );
    }

    // Validation errors
    if (
      error.message.includes('Invalid') ||
      error.message.includes('required') ||
      error.message.includes('must be')
    ) {
      log.info(`${contextPrefix} Validation error: ${error.message}`);
      return NextResponse.json(
        {
          success: false,
          error: {
            code: ErrorCodes.VALIDATION_ERROR,
            message: error.message,
          },
        },
        { status: 400 }
      );
    }
  }

  // Handle Prisma errors
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return handlePrismaError(error, contextPrefix);
  }

  // Handle Prisma validation errors
  if (error instanceof Prisma.PrismaClientValidationError) {
    log.warn(`${contextPrefix} Prisma validation error`, error.message);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: ErrorCodes.VALIDATION_ERROR,
          message: 'Invalid data provided',
        },
      },
      { status: 400 }
    );
  }

  // Generic error fallback
  log.error(`${contextPrefix} Unhandled error:`, error);
  return NextResponse.json(
    {
      success: false,
      error: {
        code: ErrorCodes.INTERNAL_ERROR,
        message: 'An unexpected error occurred',
      },
    },
    { status: 500 }
  );
}

/**
 * Handle Prisma-specific errors
 */
function handlePrismaError(
  error: Prisma.PrismaClientKnownRequestError,
  contextPrefix: string
): NextResponse<ApiErrorResponse> {
  switch (error.code) {
    // Unique constraint violation
    case 'P2002': {
      const field = (error.meta?.target as string[])?.join(', ') ?? 'field';
      log.info(`${contextPrefix} Unique constraint violation on ${field}`);
      return NextResponse.json(
        {
          success: false,
          error: {
            code: ErrorCodes.CONFLICT,
            message: `A record with this ${field} already exists`,
            details: { field },
          },
        },
        { status: 409 }
      );
    }

    // Foreign key constraint violation
    case 'P2003': {
      log.warn(`${contextPrefix} Foreign key constraint violation`, error.meta);
      return NextResponse.json(
        {
          success: false,
          error: {
            code: ErrorCodes.VALIDATION_ERROR,
            message: 'Referenced record does not exist',
          },
        },
        { status: 400 }
      );
    }

    // Record not found
    case 'P2025': {
      log.info(`${contextPrefix} Record not found for operation`);
      return NextResponse.json(
        {
          success: false,
          error: {
            code: ErrorCodes.NOT_FOUND,
            message: 'Record not found',
          },
        },
        { status: 404 }
      );
    }

    // Record to delete does not exist
    case 'P2016': {
      log.info(`${contextPrefix} Record to delete not found`);
      return NextResponse.json(
        {
          success: false,
          error: {
            code: ErrorCodes.NOT_FOUND,
            message: 'Record not found',
          },
        },
        { status: 404 }
      );
    }

    // Default Prisma error
    default: {
      log.error(`${contextPrefix} Prisma error ${error.code}:`, error.message);
      return NextResponse.json(
        {
          success: false,
          error: {
            code: ErrorCodes.INTERNAL_ERROR,
            message: 'A database error occurred',
          },
        },
        { status: 500 }
      );
    }
  }
}

/**
 * Create a success response
 */
export function createSuccessResponse<T>(
  data: T,
  meta?: ApiSuccessResponse<T>['meta']
): NextResponse<ApiSuccessResponse<T>> {
  return NextResponse.json({
    success: true,
    data,
    meta: meta ?? {
      timestamp: new Date().toISOString(),
    },
  });
}

/**
 * Create an error response
 */
export function createErrorResponse(
  code: ErrorCode,
  message: string,
  statusCode: number = 500,
  details?: unknown
): NextResponse<ApiErrorResponse> {
  return NextResponse.json(
    {
      success: false,
      error: {
        code,
        message,
        details,
      },
    },
    { status: statusCode }
  );
}

export { ApiError, ErrorCodes } from './errors';
export type { ErrorCode } from './errors';
export {
  NotFoundError,
  ValidationError,
  ForbiddenError,
  UnauthorizedError,
  ConflictError,
  BadRequestError,
} from './errors';
