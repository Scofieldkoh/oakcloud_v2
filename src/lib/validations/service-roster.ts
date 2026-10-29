import { z } from 'zod';
import { ValidationError } from '@/lib/errors';

const uuidSchema = z.string().uuid();

export const serviceRosterStatusSchema = z.enum(['ACTIVE', 'PAUSED', 'ENDED']);
export const serviceRosterApplicabilitySchema = z.enum([
  'APPLICABLE',
  'NOT_APPLICABLE',
  'MISSING_INPUT',
]);
export const serviceRosterSortBySchema = z.enum([
  'company',
  'family',
  'service',
  'status',
  'nextDeadline',
  'startDate',
]);
export const serviceRosterSortOrderSchema = z.enum(['asc', 'desc']);

/**
 * Search values after transport parsing. Query-string arrays are converted to
 * arrays by `parseServiceRosterSearchParams`; this schema intentionally stays
 * useful to callers that already have typed values.
 */
export const serviceRosterSearchSchema = z.object({
  query: z.string().trim().max(200).optional(),
  companyQuery: z.string().trim().max(200).optional(),
  familyQuery: z.string().trim().max(200).optional(),
  serviceQuery: z.string().trim().max(200).optional(),
  statusQuery: z.string().trim().max(200).optional(),
  cadenceQuery: z.string().trim().max(200).optional(),
  nextDeadlineQuery: z.string().trim().max(200).optional(),
  startEndQuery: z.string().trim().max(200).optional(),
  warningQuery: z.string().trim().max(200).optional(),
  billingQuery: z.string().trim().max(200).optional(),
  companyId: uuidSchema.optional(),
  familyIds: z.array(uuidSchema).max(50).default([]),
  variantId: uuidSchema.optional(),
  statuses: z.array(serviceRosterStatusSchema).max(3).default([]),
  archived: z.boolean().default(false),
  applicability: serviceRosterApplicabilitySchema.optional(),
  sortBy: serviceRosterSortBySchema.default('company'),
  sortOrder: serviceRosterSortOrderSchema.default('asc'),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
}).strict();

export type ServiceRosterSearch = z.infer<typeof serviceRosterSearchSchema>;
export type SearchServiceRosterInput = ServiceRosterSearch;

const allowedQueryKeys = new Set([
  'query',
  'companyQuery',
  'familyQuery',
  'serviceQuery',
  'statusQuery',
  'cadenceQuery',
  'nextDeadlineQuery',
  'startEndQuery',
  'warningQuery',
  'billingQuery',
  'companyId',
  'familyIds',
  'variantId',
  'statuses',
  'archived',
  'applicability',
  'sortBy',
  'sortOrder',
  'page',
  'limit',
]);

function uniqueCommaValues(value: string): string[] {
  const values = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  return [...new Set(values)];
}

function strictInteger(value: string, key: string): number {
  // Do not accept exponent notation, decimals, signs, or whitespace. This
  // keeps page/limit transport values unambiguous and prevents coercion quirks.
  if (!/^[1-9]\d*$/.test(value)) {
    throw new ValidationError(`Invalid ${key}; expected a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new ValidationError(`Invalid ${key}; expected a positive integer`);
  }
  return parsed;
}

function toSearchParams(input: Request | URL | URLSearchParams): URLSearchParams {
  if (input instanceof URLSearchParams) return input;
  if (input instanceof URL) return input.searchParams;
  return new URL(input.url).searchParams;
}

/**
 * Parse the actual query entries rather than `Object.fromEntries`, since the
 * latter silently drops duplicate keys. Unknown and repeated keys are
 * rejected so a malformed request cannot have ambiguous meaning.
 */
export function parseServiceRosterSearchParams(
  input: Request | URL | URLSearchParams,
): ServiceRosterSearch {
  const searchParams = toSearchParams(input);
  const raw: Record<string, unknown> = {};

  for (const [key, value] of searchParams.entries()) {
    if (!allowedQueryKeys.has(key)) {
      throw new ValidationError(`Unknown query parameter: ${key}`);
    }
    if (Object.prototype.hasOwnProperty.call(raw, key)) {
      throw new ValidationError(`Duplicate query parameter: ${key}`);
    }

    switch (key) {
      case 'familyIds':
      case 'statuses':
        raw[key] = uniqueCommaValues(value);
        break;
      case 'archived':
        if (value !== 'true' && value !== 'false') {
          throw new ValidationError('Invalid archived; expected true or false');
        }
        raw[key] = value === 'true';
        break;
      case 'page':
      case 'limit':
        raw[key] = strictInteger(value, key);
        break;
      case 'query':
        raw[key] = value.trim();
        break;
      default:
        raw[key] = value;
        break;
    }
  }

  const parsed = serviceRosterSearchSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError('Invalid service roster query', {
      issues: parsed.error.issues,
    });
  }
  return parsed.data;
}

export function emptyServiceRosterResult(input: Pick<ServiceRosterSearch, 'page' | 'limit'>) {
  return {
    items: [],
    total: 0,
    page: input.page,
    limit: input.limit,
    totalPages: 0,
  };
}
