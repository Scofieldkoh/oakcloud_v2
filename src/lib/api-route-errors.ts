import { NextResponse } from 'next/server';
import { Prisma } from '@/generated/prisma';
import { HTTP_STATUS } from './constants/application';
import { ApiError, ErrorCodes } from './errors';
import { createLogger } from './logger';

const log = createLogger('api-route-errors');

/**
 * Error mapping shared by route handlers that throw plain `Error`s from
 * services. It keeps each route's `{ error: string }` response contract while
 * removing the copy-pasted auth/permission branches:
 *
 * - `ApiError` → its own status, message, code and details (an
 *   `INTERNAL_ERROR` keeps its message private);
 * - "Unauthorized" → 401, "Forbidden" or "Permission denied..." → 403;
 * - messages listed in `notFound` / `conflict` → 404 / 409 with the message
 *   (`notFound: 'any'` matches any message containing "not found");
 * - any other application `Error` → 400 with its message when `fallback` is
 *   'bad-request', otherwise 500 "Internal server error";
 * - database and runtime errors (Prisma, driver adapter, `TypeError` and
 *   the like) never reach the response: a few Prisma codes map to a fixed
 *   message, the rest are logged and become a 500;
 * - an unreadable JSON body (`SyntaxError`) → 400 "Invalid request body".
 *
 * Validation errors (Zod) keep their route-specific payloads and are handled
 * by the route before calling this.
 */
export interface RouteErrorOptions {
  notFound?: readonly string[] | 'any';
  conflict?: readonly string[];
  /** What an unrecognised application `Error` becomes. Defaults to 'server-error'. */
  fallback?: 'bad-request' | 'server-error';
  /** Logged with the error whenever the response is a 500. */
  logLabel?: string;
  /** Message of a 500 response. Defaults to "Internal server error". */
  serverErrorMessage?: string;
}

const INTERNAL_ERROR = 'Internal server error';

const RUNTIME_ERRORS: readonly (new (...args: never[]) => Error)[] = [
  TypeError,
  ReferenceError,
  RangeError,
  EvalError,
  URIError,
];

/**
 * True for errors whose message comes from the database, the Prisma client or
 * the JavaScript runtime rather than from our own code. Those messages can
 * carry queries, column names or stack details, so they are never shown.
 */
export function isInternalError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (
    error instanceof Prisma.PrismaClientKnownRequestError
    || error instanceof Prisma.PrismaClientUnknownRequestError
    || error instanceof Prisma.PrismaClientValidationError
    || error instanceof Prisma.PrismaClientInitializationError
    || error instanceof Prisma.PrismaClientRustPanicError
    || error.name === 'DriverAdapterError'
  ) return true;
  return RUNTIME_ERRORS.some((type) => error instanceof type);
}

/** The message of an application error, or `fallback` for a database or runtime error. */
export function clientErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && !isInternalError(error) ? error.message : fallback;
}

/**
 * 401 for "Unauthorized" and 403 for "Forbidden" / "Permission denied..."
 * thrown by `requireAuth` and `requirePermission`, or null for anything else.
 * For routes with their own error payloads that still need these statuses.
 */
export function authErrorResponse(error: unknown): NextResponse | null {
  if (!(error instanceof Error) || error instanceof ApiError || isInternalError(error)) return null;
  if (error.message === 'Unauthorized') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: HTTP_STATUS.UNAUTHORIZED });
  }
  if (error.message === 'Forbidden' || error.message.startsWith('Permission denied')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: HTTP_STATUS.FORBIDDEN });
  }
  return null;
}

function prismaErrorResponse(error: Prisma.PrismaClientKnownRequestError): NextResponse | null {
  switch (error.code) {
    case 'P2002':
      return NextResponse.json({ error: 'A record with these details already exists' }, { status: HTTP_STATUS.CONFLICT });
    case 'P2025':
      return NextResponse.json({ error: 'Record not found' }, { status: HTTP_STATUS.NOT_FOUND });
    case 'P2021':
    case 'P2022':
      log.error('Database schema is out of date', error);
      return NextResponse.json(
        { error: 'Database schema is out of date. Apply the latest database migrations.' },
        { status: HTTP_STATUS.SERVER_ERROR },
      );
    default:
      return null;
  }
}

export function routeErrorResponse(error: unknown, options: RouteErrorOptions = {}): NextResponse {
  const serverErrorMessage = options.serverErrorMessage ?? INTERNAL_ERROR;

  if (error instanceof ApiError && error.code !== ErrorCodes.INTERNAL_ERROR) {
    return NextResponse.json({
      error: error.message,
      code: error.code,
      ...(error.details === undefined ? {} : { details: error.details }),
    }, { status: error.statusCode });
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const mapped = prismaErrorResponse(error);
    if (mapped) return mapped;
  }

  if (error instanceof SyntaxError) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: HTTP_STATUS.BAD_REQUEST });
  }

  if (error instanceof Error && !(error instanceof ApiError) && !isInternalError(error)) {
    const { message } = error;
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;
    const notFound = options.notFound === 'any'
      ? message.includes('not found')
      : options.notFound?.includes(message) ?? false;
    if (notFound) {
      return NextResponse.json({ error: message }, { status: HTTP_STATUS.NOT_FOUND });
    }
    if (options.conflict?.includes(message)) {
      return NextResponse.json({ error: message }, { status: HTTP_STATUS.CONFLICT });
    }
    if (options.fallback === 'bad-request') {
      return NextResponse.json({ error: message }, { status: HTTP_STATUS.BAD_REQUEST });
    }
  }

  log.error(options.logLabel ?? 'Unhandled API route error', error);
  return NextResponse.json({ error: serverErrorMessage }, { status: HTTP_STATUS.SERVER_ERROR });
}
