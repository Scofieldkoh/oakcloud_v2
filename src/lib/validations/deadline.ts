import { z } from 'zod';
import { ValidationError } from '@/lib/errors';
import { dateOnlySchema } from './date-only';
import { postpaidQuantitiesSchema } from './billing';

const UUID = z.string().uuid();

export const deadlineModeSchema = z.enum(['TABLE', 'CALENDAR']);
export const deadlineTypeSchema = z.enum(['STATUTORY', 'CLIENT', 'INTERNAL']);
export const deadlineStatusSchema = z.enum(['OPEN', 'COMPLETED', 'WAIVED', 'CANCELLED']);
export const deadlineTimingSchema = z.enum(['UPCOMING', 'DUE', 'OVERDUE']);
/** How far away an open deadline is; buckets do not overlap. */
export const deadlineTimingBucketSchema = z.enum([
  'OVERDUE',
  'DUE_TODAY',
  'WITHIN_1_MONTH',
  'WITHIN_3_MONTHS',
  'WITHIN_6_MONTHS',
  'WITHIN_12_MONTHS',
  'OVER_12_MONTHS',
  'TAKEOVER_REVIEW',
]);
export type DeadlineTimingBucket = z.infer<typeof deadlineTimingBucketSchema>;
export const deadlineOriginSchema = z.enum(['RULE', 'MANUAL_TRIGGER']);
export const deadlineSortBySchema = z.enum(['dueDate', 'company', 'family', 'service', 'type', 'status']);
export const deadlineSortOrderSchema = z.enum(['asc', 'desc']);
const deadlineQueryTextSchema = z.string().trim().max(200).default('');

/**
 * Typed deadline filters after transport parsing. Query strings are parsed by
 * parseDeadlineSearchParams below so duplicate and unknown keys cannot be
 * silently discarded.
 */
export const deadlineSearchSchema = z.object({
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
  mode: deadlineModeSchema.default('TABLE'),
  types: z.array(deadlineTypeSchema).max(3).default([]),
  familyIds: z.array(UUID).max(50).default([]),
  companyIds: z.array(UUID).max(100).default([]),
  statuses: z.array(deadlineStatusSchema).max(4).default([]),
  timing: z.array(deadlineTimingSchema).max(3).default([]),
  timingBucket: deadlineTimingBucketSchema.optional(),
  openOnly: z.boolean().default(true),
  origin: deadlineOriginSchema.optional(),
  companyQuery: deadlineQueryTextSchema,
  serviceQuery: deadlineQueryTextSchema,
  milestoneQuery: deadlineQueryTextSchema,
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  sortBy: deadlineSortBySchema.default('dueDate'),
  sortOrder: deadlineSortOrderSchema.default('asc'),
}).strict().superRefine((value, ctx) => {
  if ((value.from && !value.to) || (!value.from && value.to)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: 'Date range requires both a start and end date' });
    return;
  }
  if (value.mode === 'CALENDAR' && (!value.from || !value.to)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['from'], message: 'Calendar requests require a date range' });
    return;
  }
  if (!value.from || !value.to) return;
  const from = Date.parse(`${value.from}T00:00:00.000Z`);
  const to = Date.parse(`${value.to}T00:00:00.000Z`);
  const range = (to - from) / 86_400_000;
  if (range < 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: 'Date range end must be on or after the start date' });
  } else if (range > 366) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: 'Date range cannot exceed 366 days' });
  }
});
export const deadlineListSchema = deadlineSearchSchema;

export type DeadlineSearch = z.infer<typeof deadlineSearchSchema>;
export type DeadlineSearchInput = Omit<Partial<DeadlineSearch>, 'types' | 'familyIds' | 'companyIds' | 'statuses' | 'timing'> & {
  types?: readonly DeadlineSearch['types'][number][];
  familyIds?: readonly string[];
  companyIds?: readonly string[];
  statuses?: readonly DeadlineSearch['statuses'][number][];
  timing?: readonly DeadlineSearch['timing'][number][];
};

const deadlineMutationStatusSchema = z.enum(['OPEN', 'COMPLETED', 'WAIVED']);

/** Lifecycle/date mutation payload. CANCELLED is system-controlled. */
export const updateDeadlineOccurrenceSchema = z.object({
  expectedUpdatedAt: z.string().datetime(),
  status: deadlineMutationStatusSchema.optional(),
  operativeDueDate: dateOnlySchema.optional(),
  completionDate: dateOnlySchema.nullable().optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
  reason: z.string().trim().min(1).max(1000).optional(),
  /** With status COMPLETED: quantities for tiered postpaid fees this filing bills. */
  billingQuantities: postpaidQuantitiesSchema.optional(),
}).strict().superRefine((value, ctx) => {
  if (value.billingQuantities?.length && value.status !== 'COMPLETED') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['billingQuantities'], message: 'Billing quantities are only entered when marking a deadline complete' });
  }
  if (value.status === 'WAIVED' && !value.reason) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['reason'], message: 'A reason is required when waiving a deadline' });
  }
  if (value.status === 'OPEN' && !value.reason) {
    // The service only requires a reason when reopening a terminal user state;
    // this branch is intentionally left permissive for idempotent OPEN patches.
  }
  if (value.operativeDueDate !== undefined && !value.reason) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['reason'], message: 'A reason is required when overriding a due date' });
  }
  if (value.status === undefined && value.operativeDueDate === undefined && value.notes === undefined && value.completionDate === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'At least one deadline field must be updated' });
  }
});
export const deadlineUpdateSchema = updateDeadlineOccurrenceSchema;

export type UpdateDeadlineOccurrenceInput = z.infer<typeof updateDeadlineOccurrenceSchema>;

export const resetDeadlineDateOverrideSchema = z.object({
  expectedUpdatedAt: z.string().datetime(),
  reason: z.string().trim().min(1).max(1000),
}).strict();
export const resetDateOverrideSchema = resetDeadlineDateOverrideSchema;

export type ResetDeadlineDateOverrideInput = z.infer<typeof resetDeadlineDateOverrideSchema>;

const allowedQueryKeys = new Set([
  'from', 'to', 'mode', 'types', 'familyIds', 'companyIds', 'statuses', 'timing', 'timingBucket',
  'openOnly', 'origin', 'companyQuery', 'serviceQuery', 'milestoneQuery', 'page', 'limit', 'sortBy', 'sortOrder',
]);

function toSearchParams(input: Request | URL | URLSearchParams): URLSearchParams {
  if (input instanceof URLSearchParams) return input;
  if (input instanceof URL) return input.searchParams;
  return new URL(input.url).searchParams;
}

function uniqueCommaValues(value: string): string[] {
  return [...new Set(value.split(',').map((part) => part.trim()).filter(Boolean))];
}

function strictPositiveInteger(value: string, key: string): number {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new ValidationError(`Invalid ${key}; expected a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new ValidationError(`Invalid ${key}; expected a positive integer`);
  }
  return parsed;
}

/** Parse a deadline query string without coercion ambiguity. */
export function parseDeadlineSearchParams(input: Request | URL | URLSearchParams): DeadlineSearch {
  const params = toSearchParams(input);
  const raw: Record<string, unknown> = {};

  for (const [key, value] of params.entries()) {
    if (!allowedQueryKeys.has(key)) throw new ValidationError(`Unknown query parameter: ${key}`);
    if (Object.prototype.hasOwnProperty.call(raw, key)) throw new ValidationError(`Duplicate query parameter: ${key}`);

    switch (key) {
      case 'types':
      case 'familyIds':
      case 'companyIds':
      case 'statuses':
      case 'timing':
        raw[key] = uniqueCommaValues(value);
        break;
      case 'openOnly':
        if (value !== 'true' && value !== 'false') throw new ValidationError('Invalid openOnly; expected true or false');
        raw[key] = value === 'true';
        break;
      case 'page':
      case 'limit':
        raw[key] = strictPositiveInteger(value, key);
        break;
      default:
        raw[key] = value;
        break;
    }
  }

  const parsed = deadlineSearchSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError('Invalid deadline query', { issues: parsed.error.issues });
  return parsed.data;
}

export function emptyDeadlineResult(input: Pick<DeadlineSearch, 'mode' | 'page' | 'limit'>) {
  if (input.mode === 'CALENDAR') return { mode: 'CALENDAR' as const, items: [], awarenessItems: [], truncated: false };
  return { mode: 'TABLE' as const, items: [], awarenessItems: [], total: 0, page: input.page, limit: input.limit, totalPages: 0 };
}

/** The calendar never shows more than three months, so a year bounds holiday reads. */
export const DEADLINE_HOLIDAY_MAX_DAYS = 400;

export const deadlineHolidaySearchSchema = z.object({
  from: dateOnlySchema,
  to: dateOnlySchema,
}).strict().refine(
  ({ from, to }) => from <= to && (Date.parse(to) - Date.parse(from)) / 86_400_000 <= DEADLINE_HOLIDAY_MAX_DAYS,
  { message: `to must be on or after from and at most ${DEADLINE_HOLIDAY_MAX_DAYS} days later` },
);
