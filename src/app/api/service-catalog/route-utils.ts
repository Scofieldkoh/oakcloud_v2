import { ZodError } from 'zod';
import {
  createErrorResponse,
  handleApiError,
} from '@/lib/api-error-handler';
import { ApiError, ErrorCodes, ValidationError } from '@/lib/errors';
import { uuidSchema } from '@/lib/validations/params';

export type JsonRecord = Record<string, unknown>;

export async function readJsonRecord(request: Request): Promise<JsonRecord> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new ValidationError('Request body must be valid JSON');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ValidationError('Request body must be an object');
  }
  return value as JsonRecord;
}

export function parseRequestTenantId(body: JsonRecord): string | undefined {
  return uuidSchema.optional().parse(body.tenantId);
}

export function parseStrictTenantQuery(request: Request): string | undefined {
  const entries = [...new URL(request.url).searchParams.entries()];
  const allowed = new Set(['tenantId']);
  const values = new Map<string, string>();
  for (const [key, value] of entries) {
    if (!allowed.has(key)) throw new ValidationError(`Unknown query parameter: ${key}`);
    if (values.has(key)) throw new ValidationError(`Duplicate query parameter: ${key}`);
    values.set(key, value);
  }
  return uuidSchema.optional().parse(values.get('tenantId'));
}

export function selectRequestTenantId(
  queryTenantId: string | undefined,
  bodyTenantId: string | undefined,
): string | undefined {
  if (queryTenantId && bodyTenantId && queryTenantId.toLowerCase() !== bodyTenantId.toLowerCase()) {
    throw new ValidationError('Query and body tenantId values must match');
  }
  return queryTenantId ?? bodyTenantId;
}

export function serviceCatalogErrorResponse(error: unknown, context: string) {
  if (error instanceof ZodError) {
    return createErrorResponse(
      ErrorCodes.VALIDATION_ERROR,
      error.errors[0]?.message ?? 'Invalid service catalog request',
      400,
      error.flatten(),
    );
  }
  if (error instanceof ApiError) {
    return createErrorResponse(error.code, error.message, error.statusCode, error.details);
  }
  return handleApiError(error, context);
}
