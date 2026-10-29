import { describe, expect, it } from 'vitest';
import type {
  ApplicabilityDefinition,
  ApplicabilityPredicate,
} from '@/services/service-schedule';
import {
  applicabilityDefinitionSchema,
  applicabilityPredicateSchema,
  dateOperationSchema,
  dateSourceSchema,
  deadlineParameterDefinitionSchema,
  deadlineMilestoneSchema,
  recurrenceSchema,
  scheduleEntriesSchema,
} from '@/lib/validations/service-schedule';

type Assert<T extends true> = T;
type IsEqual<Left, Right> =
  [Left] extends [Right] ? ([Right] extends [Left] ? true : false) : false;

type _PublicPredicateMatchesSchema = Assert<IsEqual<
  ApplicabilityPredicate,
  import('zod').infer<typeof applicabilityPredicateSchema>
>>;
type _PublicDefinitionMatchesSchema = Assert<IsEqual<
  ApplicabilityDefinition,
  import('zod').infer<typeof applicabilityDefinitionSchema>
>>;

const validTypedPredicates: ApplicabilityPredicate[] = [
  { kind: 'FIELD_TRUE', field: 'isGstRegistered' },
  { kind: 'FIELD_EQUALS', field: 'currentOfficerCount', value: 3 },
  { kind: 'FIELD_IN', field: 'entityType', values: ['EXEMPTED_PRIVATE_LIMITED'] },
  { kind: 'FIELD_COMPARE', field: 'accountsDueDate', operator: 'GTE', value: '2026-01-01' },
];
const validTypedDefinition: ApplicabilityDefinition = {
  schemaVersion: 1,
  kind: 'ALL',
  conditions: validTypedPredicates,
};
void validTypedPredicates;
void validTypedDefinition;

// @ts-expect-error Boolean predicates cannot target string fields.
const invalidBooleanPredicate: ApplicabilityPredicate = { kind: 'FIELD_TRUE', field: 'name' };
// @ts-expect-error Numeric/date comparisons cannot target boolean fields.
const invalidComparePredicate: ApplicabilityPredicate = {
  kind: 'FIELD_COMPARE', field: 'isGstRegistered', operator: 'GT', value: 1,
};
const invalidNumericEquality: ApplicabilityPredicate = {
  kind: 'FIELD_EQUALS', field: 'currentOfficerCount',
  // @ts-expect-error Numeric fields do not accept string equality values.
  value: '3',
};
void invalidBooleanPredicate;
void invalidComparePredicate;
void invalidNumericEquality;

describe('generic service schedule validation', () => {
  it('accepts zero, four, and thirty-one entries for every service family', () => {
    const entryExpressions = [
      { kind: 'DAY_OF_MONTH', day: 15 },
      { kind: 'BUSINESS_DAY_FROM_START', ordinal: 3 },
      { kind: 'BUSINESS_DAY_FROM_END', ordinal: 2 },
      {
        kind: 'RELATIVE_TO_SOURCE',
        source: { kind: 'CYCLE_END' },
        offset: -3,
        unit: 'BUSINESS_DAY',
      },
    ] as const;

    expect(scheduleEntriesSchema.parse([])).toEqual([]);
    for (const [index, expression] of entryExpressions.entries()) {
      const entries = Array.from({ length: 4 }, (_, entryIndex) => ({
        key: `${['accounting', 'payroll', 'tax', 'corporate'][index]}-${entryIndex + 1}`,
        label: `Run ${entryIndex + 1}`,
        expression,
        businessDayAdjustment: 'NONE' as const,
      }));
      expect(scheduleEntriesSchema.parse(entries)).toHaveLength(4);
    }

    expect(scheduleEntriesSchema.parse(Array.from({ length: 31 }, (_, index) => ({
      key: `entry-${index + 1}`,
      label: `Run ${index + 1}`,
      expression: { kind: 'DAY_OF_MONTH', day: (index % 31) + 1 },
      businessDayAdjustment: 'NONE',
    })))).toHaveLength(31);
  });

  it('normalizes labels and keys while retaining stable identity', () => {
    expect(scheduleEntriesSchema.parse([{
      key: '  filing-date  ',
      label: '  Filing date  ',
      expression: { kind: 'DAY_OF_MONTH', day: 1 },
      businessDayAdjustment: 'NONE',
    }])).toEqual([{
      key: 'filing-date',
      label: 'Filing date',
      expression: { kind: 'DAY_OF_MONTH', day: 1 },
      businessDayAdjustment: 'NONE',
    }]);
  });

  it('rejects duplicate keys and more than thirty-one entries', () => {
    const duplicate = {
      key: 'same',
      label: 'Same',
      expression: { kind: 'DAY_OF_MONTH', day: 1 },
      businessDayAdjustment: 'NONE',
    };
    expect(() => scheduleEntriesSchema.parse([duplicate, duplicate])).toThrow('unique');
    expect(() => scheduleEntriesSchema.parse(Array.from({ length: 32 }, (_, index) => ({
      ...duplicate,
      key: `key-${index}`,
    })))).toThrow('31');
  });

  it('rejects unknown fields, malformed keys, and invalid expression ranges', () => {
    const base = {
      key: 'filing-date',
      label: 'Filing date',
      expression: { kind: 'DAY_OF_MONTH', day: 1 },
      businessDayAdjustment: 'NONE',
    };
    expect(() => scheduleEntriesSchema.parse({ ...base, extra: true })).toThrow();
    expect(() => scheduleEntriesSchema.parse([{ ...base, key: '1-not-a-key' }])).toThrow();
    expect(() => scheduleEntriesSchema.parse([{ ...base, expression: { kind: 'DAY_OF_MONTH', day: 32 } }])).toThrow();
    expect(() => scheduleEntriesSchema.parse([{ ...base, expression: { kind: 'BUSINESS_DAY_FROM_START', ordinal: 0 } }])).toThrow();
    expect(() => scheduleEntriesSchema.parse([{ ...base, expression: {
      kind: 'RELATIVE_TO_SOURCE', source: { kind: 'COMPANY_FIELD', field: 'unknownCompanyField' }, offset: 0, unit: 'CALENDAR_DAY',
    } }])).toThrow();
  });

  it('accepts only whitelisted date sources and strict date operations', () => {
    const allowedSources = [
      { kind: 'COMPANY_FIELD', field: 'financialYearEnd' },
      { kind: 'COMPANY_FIELD', field: 'accountsDueDate' },
      { kind: 'COMPANY_FIELD', field: 'incorporationDate' },
      { kind: 'CYCLE_START' },
      { kind: 'CYCLE_END' },
      { kind: 'PARAMETER', key: 'monthsAfterFye' },
      { kind: 'SCHEDULE_ENTRY', key: 'filing-date' },
      { kind: 'MILESTONE', key: 'previous-filing' },
      { kind: 'CURRENT_SCHEDULE_ENTRY' },
    ];
    for (const source of allowedSources) {
      expect(dateSourceSchema.parse(source)).toEqual(source);
    }
    expect(() => dateSourceSchema.parse({ kind: 'COMPANY_FIELD', field: 'secretField' })).toThrow();
    expect(() => dateSourceSchema.parse({ kind: 'COMPANY_FIELD', field: 'nextAgmDueDate' })).toThrow();
    expect(() => dateSourceSchema.parse({ kind: 'COMPANY_FIELD', field: 'nextArDueDate' })).toThrow();
    expect(() => dateSourceSchema.parse({ kind: 'COMPANY_FIELD', field: 'entityType' })).toThrow();
    expect(() => dateSourceSchema.parse({ kind: 'SCHEDULE_ENTRY', key: 'not valid' })).toThrow();
    expect(() => dateSourceSchema.parse({ kind: 'CYCLE_START', extra: true })).toThrow();

    expect(dateOperationSchema.parse({ kind: 'ADD', offset: 0, unit: 'CALENDAR_DAY' })).toEqual({
      kind: 'ADD', offset: 0, unit: 'CALENDAR_DAY',
    });
    expect(dateOperationSchema.parse({ kind: 'ADD', offset: -3660, unit: 'BUSINESS_DAY' })).toBeTruthy();
    expect(() => dateOperationSchema.parse({ kind: 'ADD', offset: 3661, unit: 'CALENDAR_DAY' })).toThrow();
    expect(() => dateOperationSchema.parse({ kind: 'ADD', offset: 1, unit: 'CALENDAR_DAY', extra: true })).toThrow();
  });

  it('validates versioned recurrence, milestone expressions, and generation modes', () => {
    expect(recurrenceSchema.parse({ schemaVersion: 1, kind: 'MONTHLY', interval: 1 })).toEqual({
      schemaVersion: 1, kind: 'MONTHLY', interval: 1,
    });
    expect(recurrenceSchema.parse({ schemaVersion: 1, kind: 'CUSTOM', interval: 2, unit: 'MONTH' })).toEqual({
      schemaVersion: 1, kind: 'CUSTOM', interval: 2, unit: 'MONTH',
    });
    expect(() => recurrenceSchema.parse({ schemaVersion: 2, kind: 'MONTHLY', interval: 1 })).toThrow();
    expect(() => recurrenceSchema.parse({ schemaVersion: 1, kind: 'CUSTOM', interval: 0, unit: 'MONTH' })).toThrow();
    expect(() => recurrenceSchema.parse({ schemaVersion: 1, kind: 'MONTHLY', interval: 1, unknown: true })).toThrow();
    const unknownKind = recurrenceSchema.safeParse({ schemaVersion: 1, kind: 'UNKNOWN', interval: 1 });
    expect(unknownKind.success).toBe(false);
    if (!unknownKind.success) expect(unknownKind.error.issues[0]?.path).toEqual(['kind']);

    const milestone = {
      key: 'annual-return',
      name: 'Annual return',
      description: null,
      type: 'STATUTORY',
      generationMode: 'ONCE_PER_SCHEDULE_ENTRY',
      expression: {
        kind: 'RELATIVE_TO_SOURCE',
        source: { kind: 'SCHEDULE_ENTRY', key: 'filing-date' },
        offset: -2,
        unit: 'BUSINESS_DAY',
      },
      businessDayAdjustment: 'PREVIOUS',
      displayOrder: 0,
      isActive: true,
    };
    expect(deadlineMilestoneSchema.parse(milestone)).toEqual(milestone);
    expect(() => deadlineMilestoneSchema.parse({ ...milestone, unexpected: true })).toThrow();
    expect(() => deadlineMilestoneSchema.parse({
      ...milestone,
      generationMode: 'ONCE_PER_SCHEDULE_ENTRY',
      expression: { kind: 'DAY_OF_MONTH', day: 1 },
    })).toThrow('schedule');

    const cyclicExpression: Record<string, unknown> = { kind: 'COALESCE', candidates: [] };
    cyclicExpression.candidates = [cyclicExpression];
    const cyclicMilestone = { ...milestone, generationMode: 'ONCE_PER_CYCLE', expression: cyclicExpression };
    let cyclicResult: ReturnType<typeof deadlineMilestoneSchema.safeParse>;
    expect(() => { cyclicResult = deadlineMilestoneSchema.safeParse(cyclicMilestone); }).not.toThrow();
    expect(cyclicResult!.success).toBe(false);
  });

  it('bounds applicability groups, rejects unknown company fields, and preserves strict nesting', () => {
    const definition = {
      schemaVersion: 1,
      kind: 'ALL',
      conditions: [
        { kind: 'FIELD_EQUALS', field: 'entityType', value: 'EXEMPTED_PRIVATE_LIMITED' },
        { kind: 'FIELD_PRESENT', field: 'accountsDueDate' },
      ],
    };
    expect(applicabilityDefinitionSchema.parse(definition)).toEqual(definition);
    expect(() => applicabilityDefinitionSchema.parse({
      ...definition,
      conditions: [{ kind: 'FIELD_EQUALS', field: 'notACompanyField', value: 'x' }],
    })).toThrow();
    expect(() => applicabilityDefinitionSchema.parse({
      ...definition,
      conditions: Array.from({ length: 51 }, () => definition.conditions[0]),
    })).toThrow('50');

    let nested: Record<string, unknown> = { kind: 'ALL', conditions: [] };
    for (let index = 0; index < 6; index += 1) nested = { kind: 'ALL', conditions: [nested] };
    expect(() => applicabilityDefinitionSchema.parse({ schemaVersion: 1, ...nested })).toThrow();
    expect(() => applicabilityDefinitionSchema.parse({ ...definition, unknown: true })).toThrow();
  });

  it('accepts fifty FIELD_PRESENT predicates at the leaf boundary', () => {
    const definition = {
      schemaVersion: 1,
      kind: 'ALL',
      conditions: Array.from({ length: 50 }, () => ({ kind: 'FIELD_PRESENT', field: 'entityType' })),
    };
    expect(applicabilityDefinitionSchema.parse(definition).conditions).toHaveLength(50);
  });

  it('accepts one FIELD_IN predicate with fifty correctly typed values', () => {
    const definition = {
      schemaVersion: 1,
      kind: 'ALL',
      conditions: [{
        kind: 'FIELD_IN',
        field: 'entityType',
        values: Array.from({ length: 50 }, (_, index) => `ENTITY_${index}`),
      }],
    };
    expect(applicabilityDefinitionSchema.parse(definition).conditions[0]).toEqual(definition.conditions[0]);
  });

  it('accepts fifty FIELD_IN predicates with one correctly typed value each', () => {
    const definition = {
      schemaVersion: 1,
      kind: 'ALL',
      conditions: Array.from({ length: 50 }, (_, index) => ({
        kind: 'FIELD_IN',
        field: 'entityType',
        values: [`ENTITY_${index}`],
      })),
    };
    expect(applicabilityDefinitionSchema.parse(definition).conditions).toHaveLength(50);
  });

  it('uses one canonical reference-key contract for parameters and milestones', () => {
    const parameter = {
      key: 'monthsAfterFye',
      label: 'Months after FYE',
      description: null,
      type: 'INTEGER',
      required: true,
    } as const;
    expect(deadlineParameterDefinitionSchema.parse(parameter)).toEqual(parameter);
    expect(dateSourceSchema.parse({ kind: 'PARAMETER', key: parameter.key })).toEqual({
      kind: 'PARAMETER', key: parameter.key,
    });

    const milestone = {
      key: 'annualReturnDue',
      name: 'Annual Return due',
      description: null,
      type: 'STATUTORY',
      generationMode: 'ONCE_PER_CYCLE',
      expression: { kind: 'DAY_OF_MONTH', day: 1 },
      businessDayAdjustment: 'NONE',
      displayOrder: 0,
      isActive: true,
    } as const;
    expect(deadlineMilestoneSchema.parse(milestone)).toEqual(milestone);
    expect(dateSourceSchema.parse({ kind: 'MILESTONE', key: milestone.key })).toEqual({
      kind: 'MILESTONE', key: milestone.key,
    });
  });

  it('rejects applicability predicates whose operators and values do not fit field types', () => {
    expect(applicabilityPredicateSchema.safeParse({ kind: 'FIELD_TRUE', field: 'name' }).success).toBe(false);
    expect(applicabilityPredicateSchema.safeParse({ kind: 'FIELD_COMPARE', field: 'isGstRegistered', operator: 'GT', value: 1 }).success).toBe(false);
    expect(applicabilityPredicateSchema.safeParse({ kind: 'FIELD_EQUALS', field: 'currentOfficerCount', value: '3' }).success).toBe(false);
    expect(applicabilityPredicateSchema.safeParse({ kind: 'FIELD_EQUALS', field: 'currentOfficerCount', value: 3 }).success).toBe(true);
    expect(applicabilityPredicateSchema.safeParse({ kind: 'FIELD_COMPARE', field: 'accountsDueDate', operator: 'GTE', value: 'not-a-date' }).success).toBe(false);
    expect(applicabilityPredicateSchema.safeParse({ kind: 'FIELD_EQUALS', field: 'entityType', value: 'EXEMPTED_PRIVATE_LIMITED' }).success).toBe(true);
  });

  it('rejects extreme raw applicability depth with a controlled Zod validation result', () => {
    let nested: Record<string, unknown> = { kind: 'ALL', conditions: [] };
    for (let index = 0; index < 5000; index += 1) nested = { kind: 'ALL', conditions: [nested] };

    let result: ReturnType<typeof applicabilityDefinitionSchema.safeParse>;
    expect(() => { result = applicabilityDefinitionSchema.safeParse({ schemaVersion: 1, ...nested }); }).not.toThrow();
    expect(result!.success).toBe(false);
    if (!result!.success) expect(result!.error.issues[0]?.message).toMatch(/nested|depth|levels/i);
  });

  it('rejects unknown-root deep groups without entering recursive parsing', () => {
    let nested: Record<string, unknown> = { kind: 'UNKNOWN_ROOT', conditions: [] };
    for (let index = 0; index < 5000; index += 1) {
      nested = { kind: 'UNKNOWN_ROOT', conditions: [nested] };
    }

    let result: ReturnType<typeof applicabilityDefinitionSchema.safeParse>;
    expect(() => {
      result = applicabilityDefinitionSchema.safeParse({ schemaVersion: 1, ...nested });
    }).not.toThrow();
    expect(result!.success).toBe(false);
  });

  it('rejects unknown-child deep groups before recursive parsing', () => {
    let nested: Record<string, unknown> = { kind: 'UNKNOWN_CHILD', conditions: [] };
    for (let index = 0; index < 5000; index += 1) {
      nested = { kind: 'UNKNOWN_CHILD', conditions: [nested] };
    }

    let result: ReturnType<typeof applicabilityDefinitionSchema.safeParse>;
    expect(() => {
      result = applicabilityDefinitionSchema.safeParse({
        schemaVersion: 1,
        kind: 'ALL',
        conditions: [nested],
      });
    }).not.toThrow();
    expect(result!.success).toBe(false);
  });

  it('rejects huge condition widths before visiting every element', () => {
    const input = {
      schemaVersion: 1,
      kind: 'UNKNOWN_ROOT',
      conditions: Array.from({ length: 200_000 }, () => ({ kind: 'UNKNOWN_CHILD' })),
    };
    const started = performance.now();
    let result: ReturnType<typeof applicabilityDefinitionSchema.safeParse>;
    expect(() => {
      result = applicabilityDefinitionSchema.safeParse(input);
    }).not.toThrow();
    expect(performance.now() - started).toBeLessThan(1000);
    expect(result!.success).toBe(false);
  });

  it('rejects huge unknown-property arrays before traversing their contents', () => {
    const input = {
      schemaVersion: 1,
      kind: 'UNKNOWN_ROOT',
      unknownProperty: { payload: Array.from({ length: 200_000 }, () => ({ nested: true })) },
    };
    let result: ReturnType<typeof applicabilityDefinitionSchema.safeParse>;
    expect(() => {
      result = applicabilityDefinitionSchema.safeParse(input);
    }).not.toThrow();
    expect(result!.success).toBe(false);
  });

  it('rejects cyclic applicability structures with a controlled Zod error', () => {
    const cyclic: Record<string, unknown> = {
      schemaVersion: 1,
      kind: 'UNKNOWN_ROOT',
      conditions: [],
    };
    (cyclic.conditions as unknown[]).push(cyclic);

    let result: ReturnType<typeof applicabilityDefinitionSchema.safeParse>;
    expect(() => {
      result = applicabilityDefinitionSchema.safeParse(cyclic);
    }).not.toThrow();
    expect(result!.success).toBe(false);
    if (!result!.success) expect(result!.error.issues[0]?.message).toMatch(/cycle|cyclic/i);
  });
});
