import { z } from 'zod';

import {
  dateOnlySchema,
  scheduleEntriesSchema,
} from './service-schedule';
import { ValidationError } from '@/lib/errors';

const customIntervalSchema = z.object({
  unit: z.literal('MONTH'),
  count: z.number().int().min(1).max(120),
}).strict();

const billingCadenceSchema = z.enum([
  'MONTHLY', 'QUARTERLY', 'SEMI_ANNUALLY', 'ANNUALLY', 'ONE_TIME', 'CUSTOM',
]);

const FIXED_CADENCE_INTERVALS = {
  MONTHLY: 1,
  QUARTERLY: 3,
  SEMI_ANNUALLY: 6,
  ANNUALLY: 12,
} as const;

const billingScheduleEntriesSchema = scheduleEntriesSchema.superRefine((entries, ctx) => {
  for (const [index, entry] of entries.entries()) {
    if (entry.expression.kind !== 'RELATIVE_TO_SOURCE') continue;

    if (typeof entry.expression.offset !== 'number') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index, 'expression', 'offset'],
        message: 'Billing schedule offsets must be numeric literals',
      });
    }

    if (!['CYCLE_START', 'CYCLE_END', 'CURRENT_SCHEDULE_ENTRY'].includes(entry.expression.source.kind)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index, 'expression', 'source'],
        message: 'Billing schedule sources must be cycle or current-entry references',
      });
    }
  }
});

/** Versioned, generic fee-line recurrence configuration. */
export const billingScheduleConfigSchema = z.object({
  schemaVersion: z.literal(1),
  cadence: billingCadenceSchema,
  startDate: dateOnlySchema.nullable(),
  customInterval: customIntervalSchema.nullable(),
  scheduleEntries: billingScheduleEntriesSchema,
}).strict().superRefine((value, ctx) => {
  if (value.cadence === 'CUSTOM' && !value.customInterval) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['customInterval'],
      message: 'customInterval is required for a custom schedule',
    });
  }

  if (value.cadence === 'ONE_TIME' && value.customInterval !== null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['customInterval'],
      message: 'customInterval must be null for a one-time schedule',
    });
  }

  if (value.cadence in FIXED_CADENCE_INTERVALS) {
    const expectedCount = FIXED_CADENCE_INTERVALS[value.cadence as keyof typeof FIXED_CADENCE_INTERVALS];
    if (!value.customInterval || value.customInterval.count !== expectedCount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['customInterval'],
        message: `${value.cadence} schedules require a ${expectedCount}-month interval`,
      });
    }
  }
});

export { billingCadenceSchema };
export const billingCustomIntervalSchema = customIntervalSchema;

export type BillingScheduleConfigInput = z.input<typeof billingScheduleConfigSchema>;
export type BillingScheduleConfigOutput = z.output<typeof billingScheduleConfigSchema>;

export const billingOccurrenceStatusSchema = z.enum(['OPEN', 'BILLED', 'WAIVED', 'CANCELLED']);
export const billingOccurrenceMutationStatusSchema = z.enum(['OPEN', 'BILLED', 'WAIVED']);
export const billingOccurrenceTimingSchema = z.enum(['UPCOMING', 'DUE', 'OVERDUE']);
export const billingOccurrenceSortBySchema = z.enum([
  'expectedDate', 'company', 'family', 'service', 'status', 'amount',
]);
export const billingOccurrenceSortOrderSchema = z.enum(['asc', 'desc']);
export const billingOccurrenceUpdateScopeSchema = z.enum(['THIS_OCCURRENCE', 'THIS_AND_FUTURE']);

/** Strict, bounded filters for the paginated manual billing table. */
export const billingOccurrenceSearchSchema = z.object({
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
  expectedDate: dateOnlySchema.optional(),
  billedDate: dateOnlySchema.optional(),
  query: z.string().trim().max(120).default(''),
  companyQuery: z.string().trim().max(120).default(''),
  companyId: z.string().uuid().optional(),
  serviceQuery: z.string().trim().max(120).default(''),
  serviceNameQuery: z.string().trim().max(120).default(''),
  feeQuery: z.string().trim().max(120).default(''),
  feeLineQuery: z.string().trim().max(120).default(''),
  periodQuery: z.string().trim().max(120).default(''),
  referenceQuery: z.string().trim().max(120).default(''),
  amountMin: z.union([z.string().regex(/^\d{1,16}(\.\d{1,2})?$/), z.literal('')]).default(''),
  amountMax: z.union([z.string().regex(/^\d{1,16}(\.\d{1,2})?$/), z.literal('')]).default(''),
  familyId: z.string().uuid().optional(),
  companyIds: z.array(z.string().uuid()).max(100).default([]),
  familyIds: z.array(z.string().uuid()).max(50).default([]),
  statuses: z.array(billingOccurrenceStatusSchema).max(4).default([]),
  timing: z.array(billingOccurrenceTimingSchema).max(3).default([]),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  sortBy: billingOccurrenceSortBySchema.default('expectedDate'),
  sortOrder: billingOccurrenceSortOrderSchema.default('asc'),
}).strict().superRefine((value, ctx) => {
  if (!value.from && !value.to) return;
  if (!value.from || !value.to) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: 'Date range requires both a start and end date' });
    return;
  }
  const from = Date.parse(`${value.from}T00:00:00.000Z`);
  const to = Date.parse(`${value.to}T00:00:00.000Z`);
  const range = (to - from) / 86_400_000;
  if (range < 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: 'Date range end must be on or after the start date' });
  }
});

export type BillingOccurrenceSearch = z.infer<typeof billingOccurrenceSearchSchema>;
export type BillingOccurrenceSearchInput = Omit<Partial<BillingOccurrenceSearch>, 'companyIds' | 'familyIds' | 'statuses' | 'timing'> & {
  companyIds?: readonly string[];
  familyIds?: readonly string[];
  statuses?: readonly BillingOccurrenceSearch['statuses'][number][];
  timing?: readonly BillingOccurrenceSearch['timing'][number][];
};

/** A quantity for a tiered postpaid fee, up to two decimals. */
export const billingQuantitySchema = z.string().trim().regex(/^\d{1,12}(\.\d{1,2})?$/, 'Enter a quantity with at most two decimals');

/** Quantities staff enter for tiered postpaid fees when a filing is marked Filed. */
export const postpaidQuantitiesSchema = z.array(z.object({
  feeLineId: z.string().uuid(),
  quantity: billingQuantitySchema,
}).strict()).max(50);

export const updateBillingOccurrenceSchema = z.object({
  expectedUpdatedAt: z.string().datetime(),
  status: billingOccurrenceMutationStatusSchema.optional(),
  billedDate: dateOnlySchema.nullable().optional(),
  operativeExpectedDate: dateOnlySchema.optional(),
  amount: z.string().regex(/^\d{1,16}(\.\d{1,2})?$/).optional(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).optional(),
  /** Tiered postpaid entries only: the quantity billed; re-prices the entry. */
  quantity: billingQuantitySchema.optional(),
  externalReference: z.string().trim().max(200).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  updateScope: billingOccurrenceUpdateScopeSchema,
  reason: z.string().trim().min(3).max(1000).nullable(),
}).strict().superRefine((value, ctx) => {
  if (
    value.status === undefined
    && value.billedDate === undefined
    && value.operativeExpectedDate === undefined
    && value.amount === undefined
    && value.currency === undefined
    && value.quantity === undefined
    && value.externalReference === undefined
    && value.notes === undefined
  ) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'At least one billing occurrence field must be updated' });
  }
  if (value.operativeExpectedDate !== undefined && !value.reason) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['reason'], message: 'A reason is required when overriding an expected billing date' });
  }
  if ((value.amount !== undefined || value.currency !== undefined) && !value.reason) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['reason'], message: 'A reason is required when overriding billing values' });
  }
  if (value.status === 'WAIVED' && !value.reason) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['reason'], message: 'A reason is required when waiving a billing occurrence' });
  }
});

export type UpdateBillingOccurrenceInput = z.infer<typeof updateBillingOccurrenceSchema>;

export const resetBillingOverrideSchema = z.object({
  expectedUpdatedAt: z.string().datetime(),
  target: z.enum(['DATE', 'VALUE', 'ALL']),
  reason: z.string().trim().min(3).max(1000),
}).strict();

export type ResetBillingOverrideInput = z.infer<typeof resetBillingOverrideSchema>;

const billingOccurrenceAllowedQueryKeys = new Set([
  'from', 'to', 'expectedDate', 'billedDate', 'query', 'companyQuery', 'companyId', 'serviceQuery', 'serviceNameQuery', 'feeQuery', 'feeLineQuery', 'periodQuery', 'referenceQuery', 'amountMin', 'amountMax', 'familyId', 'companyIds', 'familyIds', 'statuses', 'timing', 'page', 'limit', 'sortBy', 'sortOrder',
]);

function searchParamsFrom(input: Request | URL | URLSearchParams): URLSearchParams {
  if (input instanceof URLSearchParams) return input;
  if (input instanceof URL) return input.searchParams;
  return new URL(input.url).searchParams;
}

function uniqueCommaValues(value: string): string[] {
  return [...new Set(value.split(',').map((part) => part.trim()).filter(Boolean))];
}

function strictPositiveInteger(value: string, key: string): number {
  if (!/^[1-9]\d*$/.test(value)) throw new ValidationError(`Invalid ${key}; expected a positive integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new ValidationError(`Invalid ${key}; expected a positive integer`);
  return parsed;
}

/** Parse query strings without silently dropping unknown or duplicate keys. */
export function parseBillingOccurrenceSearchParams(input: Request | URL | URLSearchParams): BillingOccurrenceSearch {
  const params = searchParamsFrom(input);
  const raw: Record<string, unknown> = {};
  for (const [key, value] of params.entries()) {
    if (!billingOccurrenceAllowedQueryKeys.has(key)) throw new ValidationError(`Unknown query parameter: ${key}`);
    if (Object.prototype.hasOwnProperty.call(raw, key)) throw new ValidationError(`Duplicate query parameter: ${key}`);
    switch (key) {
      case 'companyIds':
      case 'familyIds':
      case 'statuses':
      case 'timing':
        raw[key] = uniqueCommaValues(value);
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
  const parsed = billingOccurrenceSearchSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError('Invalid billing occurrence query', { issues: parsed.error.issues });
  return parsed.data;
}

export function emptyBillingOccurrenceResult(input: Pick<BillingOccurrenceSearch, 'page' | 'limit'>) {
  return { mode: 'TABLE' as const, items: [], total: 0, page: input.page, limit: input.limit, totalPages: 0 };
}
