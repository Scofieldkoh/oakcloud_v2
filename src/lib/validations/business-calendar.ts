import { z } from 'zod';
import { dateOnlySchema } from './service-schedule';

/**
 * V1 calendars are evaluated by the Singapore date engine.  Keep the
 * persistence/API contract explicit until the evaluator supports additional
 * jurisdictions and time-zone semantics.
 */
export const BUSINESS_CALENDAR_TIME_ZONE = 'Asia/Singapore' as const;
export const BUSINESS_CALENDAR_JURISDICTION = 'SG' as const;

const weekendDaysSchema = z.array(
  z.number().int().min(0).max(6),
).min(1).max(6);

const holidaySchema = z.object({
  date: dateOnlySchema,
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).nullable(),
  /**
   * Ownership of the row. Omit to keep the current owner; MANUAL converts an
   * official (EXTERNAL) holiday into a manually maintained one.
   */
  sourceType: z.enum(['MANUAL', 'EXTERNAL']).optional(),
}).strict();

const calendarFieldsSchema = z.object({
  name: z.string().trim().min(1).max(100),
  jurisdictionCode: z.string().trim().toUpperCase().refine(
    (value) => value === BUSINESS_CALENDAR_JURISDICTION,
    `V1 business calendars must use jurisdiction ${BUSINESS_CALENDAR_JURISDICTION}`,
  ),
  timeZone: z.string().trim().refine(
    (value) => value === BUSINESS_CALENDAR_TIME_ZONE,
    `V1 business calendars must use time zone ${BUSINESS_CALENDAR_TIME_ZONE}`,
  ).default(BUSINESS_CALENDAR_TIME_ZONE),
  weekendDays: weekendDaysSchema,
  holidays: z.array(holidaySchema).max(500),
  isActive: z.boolean(),
}).strict();

function canonicalizeCalendarFields<T extends z.infer<typeof calendarFieldsSchema>>(
  value: T,
): T {
  return {
    ...value,
    weekendDays: [...value.weekendDays].sort((left, right) => left - right),
    holidays: [...value.holidays].sort((left, right) => left.date.localeCompare(right.date)),
  };
}

function addUniquenessChecks(
  value: z.infer<typeof calendarFieldsSchema>,
  ctx: z.RefinementCtx,
): void {
  const weekendDays = new Set<number>();
  value.weekendDays.forEach((day, index) => {
    if (weekendDays.has(day)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['weekendDays', index],
        message: 'Weekend days must be unique',
      });
    }
    weekendDays.add(day);
  });

  const holidayDates = new Set<string>();
  value.holidays.forEach((holiday, index) => {
    if (holidayDates.has(holiday.date)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['holidays', index, 'date'],
        message: 'Holiday dates must be unique',
      });
    }
    holidayDates.add(holiday.date);
  });
}

const validatedCalendarFieldsSchema = calendarFieldsSchema
  .superRefine(addUniquenessChecks)
  .transform(canonicalizeCalendarFields);

export const businessCalendarInputSchema = validatedCalendarFieldsSchema;

const updateFieldsSchema = calendarFieldsSchema.extend({
  expectedRevision: z.number().int().min(1),
  proposedHash: z.string().regex(/^[a-f0-9]{64}$/),
  previewFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export const businessCalendarUpdateSchema = updateFieldsSchema
  .superRefine((value, ctx) => addUniquenessChecks(value, ctx))
  .transform((value) => ({
    ...canonicalizeCalendarFields(value),
    expectedRevision: value.expectedRevision,
    proposedHash: value.proposedHash,
    previewFingerprint: value.previewFingerprint,
  }));

export type BusinessCalendarInput = z.input<typeof businessCalendarInputSchema>;
export type NormalizedBusinessCalendarInput = z.output<typeof businessCalendarInputSchema>;
export type BusinessCalendarUpdateInput = z.input<typeof businessCalendarUpdateSchema>;
export type NormalizedBusinessCalendarUpdateInput = z.output<typeof businessCalendarUpdateSchema>;
