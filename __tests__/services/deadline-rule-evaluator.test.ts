import { describe, expect, it } from 'vitest';
import { DeadlineApiError, ErrorCodes, ValidationError } from '@/lib/errors';
import {
  evaluateApplicability,
  evaluateDeadlineRule,
  type RuleDateExpression,
  type ApplicabilityResult,
  type DeadlineRuleEvaluationInput,
} from '@/services/service-schedule';
import type {
  ApplicabilityDefinition,
  BusinessCalendarSnapshot,
  DateOnly,
  MilestoneDefinition,
  ScheduleEntry,
} from '@/services/service-schedule';

const calendar: BusinessCalendarSnapshot = {
  id: 'sg-calendar',
  timeZone: 'Asia/Singapore',
  revision: 1,
  holidays: new Set<DateOnly>(['2026-08-10', '2026-08-31']),
  weekendDays: new Set([0, 6]),
};

const applicable: ApplicabilityDefinition = {
  schemaVersion: 1,
  kind: 'ALL',
  conditions: [],
};

function milestone(
  key: string,
  expression: RuleDateExpression | Partial<MilestoneDefinition>,
  overrides: Partial<MilestoneDefinition> = {},
): MilestoneDefinition {
  const supplied = typeof expression === 'object' && expression !== null && 'expression' in expression
    ? expression as Partial<MilestoneDefinition>
    : { expression };
  return {
    key,
    name: key,
    description: null,
    type: 'CLIENT',
    generationMode: 'ONCE_PER_CYCLE',
    expression: supplied.expression as MilestoneDefinition['expression'],
    businessDayAdjustment: 'NONE',
    displayOrder: 0,
    isActive: true,
    ...supplied,
    ...overrides,
  } as MilestoneDefinition;
}

function entry(
  key: string,
  expression: ScheduleEntry['expression'],
  businessDayAdjustment: ScheduleEntry['businessDayAdjustment'] = 'NONE',
): ScheduleEntry {
  return { key, label: key, expression, businessDayAdjustment };
}

function input(overrides: Partial<DeadlineRuleEvaluationInput> = {}): DeadlineRuleEvaluationInput {
  return {
    ruleId: 'rule-1',
    ruleVersionId: 'version-1',
    recurrence: { schemaVersion: 1, kind: 'MONTHLY', interval: 1 },
    applicability: applicable,
    parameters: {},
    scheduleEntries: [],
    milestones: [milestone('due', { kind: 'DAY_OF_MONTH', day: 15 })],
    company: {},
    period: { key: '2026-08', start: '2026-08-01', end: '2026-08-31' },
    calendar,
    ...overrides,
  };
}

function missingInput(error: unknown): boolean {
  return error instanceof DeadlineApiError && error.code === ErrorCodes.MISSING_RULE_INPUT;
}

function expectMissingInput(call: () => unknown): void {
  try {
    call();
    throw new Error('Expected a typed missing-input error');
  } catch (error) {
    expect(missingInput(error)).toBe(true);
    expect((error as DeadlineApiError).statusCode).toBe(422);
  }
}

describe('evaluateApplicability', () => {
  it('marks XBRL inapplicable to an exempt private company', () => {
    expect(evaluateApplicability({
      kind: 'FIELD_NOT_IN', field: 'entityType', values: ['EXEMPTED_PRIVATE_LIMITED'],
    }, { entityType: 'EXEMPTED_PRIVATE_LIMITED' })).toEqual({
      state: 'NOT_APPLICABLE',
      reason: expect.stringContaining('entityType'),
    });
  });

  it('supports every field-compatible predicate and ALL/ANY semantics', () => {
    const definition: ApplicabilityDefinition = {
      schemaVersion: 1,
      kind: 'ALL',
      conditions: [
        { kind: 'FIELD_EQUALS', field: 'entityType', value: 'PRIVATE_COMPANY' },
        { kind: 'FIELD_NOT_EQUALS', field: 'status', value: 'STRUCK_OFF' },
        { kind: 'FIELD_IN', field: 'currentOfficerCount', values: [2, 3] },
        { kind: 'FIELD_NOT_IN', field: 'currentShareholderCount', values: [0] },
        { kind: 'FIELD_TRUE', field: 'isGstRegistered' },
        { kind: 'FIELD_FALSE', field: 'isRegisteredCharity' },
        { kind: 'FIELD_PRESENT', field: 'accountsDueDate' },
        { kind: 'FIELD_COMPARE', field: 'currentOfficerCount', operator: 'GTE', value: 2 },
        { kind: 'FIELD_COMPARE', field: 'accountsDueDate', operator: 'GT', value: '2026-01-01' },
        {
          kind: 'ANY',
          conditions: [
            { kind: 'FIELD_EQUALS', field: 'primarySsicCode', value: '62010' },
            { kind: 'FIELD_EQUALS', field: 'secondarySsicCode', value: '62010' },
          ],
        },
      ],
    };

    expect(evaluateApplicability(definition, {
      entityType: 'PRIVATE_COMPANY',
      status: 'LIVE',
      currentOfficerCount: 2,
      currentShareholderCount: 1,
      isGstRegistered: true,
      isRegisteredCharity: false,
      accountsDueDate: '2027-05-31',
      primarySsicCode: '62010',
    })).toEqual({ state: 'APPLICABLE', reason: null });
  });

  it('propagates missing required values deterministically while presence predicates evaluate absence', () => {
    const result = evaluateApplicability({
      schemaVersion: 1,
      kind: 'ALL',
      conditions: [
        { kind: 'FIELD_EQUALS', field: 'entityType', value: 'PRIVATE_COMPANY' },
        { kind: 'FIELD_EQUALS', field: 'entityType', value: 'PRIVATE_COMPANY' },
      ],
    }, {});

    expect(result).toEqual({
      state: 'MISSING_INPUT',
      reason: expect.stringContaining('entityType'),
      missingFields: ['entityType'],
    });
    expect(evaluateApplicability({ kind: 'FIELD_MISSING', field: 'accountsDueDate' }, {}))
      .toEqual({ state: 'APPLICABLE', reason: null });
    expect(evaluateApplicability({ kind: 'FIELD_PRESENT', field: 'accountsDueDate' }, {}))
      .toMatchObject({ state: 'NOT_APPLICABLE' });
  });

  it('uses three-state ANY semantics when no branch is applicable', () => {
    const result = evaluateApplicability({
      schemaVersion: 1,
      kind: 'ANY',
      conditions: [
        { kind: 'FIELD_EQUALS', field: 'entityType', value: 'PRIVATE_COMPANY' },
        { kind: 'FIELD_EQUALS', field: 'status', value: 'LIVE' },
      ],
    }, { entityType: 'PUBLIC_COMPANY' });

    expect(result.state).toBe('MISSING_INPUT');
    expect((result as Extract<ApplicabilityResult, { state: 'MISSING_INPUT' }>).missingFields)
      .toEqual(['status']);
  });

  it('defensively rejects typed definitions beyond depth and leaf bounds', () => {
    let nested: Record<string, unknown> = { kind: 'ALL', conditions: [] };
    for (let index = 0; index < 6; index += 1) nested = { kind: 'ALL', conditions: [nested] };
    expect(() => evaluateApplicability(nested as never, {})).toThrow(ValidationError);

    expect(() => evaluateApplicability({
      schemaVersion: 1,
      kind: 'ALL',
      conditions: Array.from({ length: 51 }, () => ({ kind: 'FIELD_PRESENT', field: 'entityType' })),
    } as never, {})).toThrow(ValidationError);
  });
});

describe('evaluateDeadlineRule', () => {
  it('uses a stored AGM due date before its fallback expression', () => {
    const result = evaluateDeadlineRule(input({
      company: { accountsDueDate: '2027-05-31', financialYearEnd: '2026-12-31' },
      milestones: [milestone('agm-due', {
        kind: 'RELATIVE_TO_SOURCE',
        source: { kind: 'COMPANY_FIELD', field: 'accountsDueDate' },
        offset: 0,
        unit: 'CALENDAR_DAY',
      })],
    }));

    expect(result.occurrences[0]).toMatchObject({
      calculatedDueDate: '2027-05-31',
      explanation: expect.arrayContaining([expect.stringContaining('Company.accountsDueDate')]),
    });
  });

  it.each([
    ['2027-07-31', '2026-08-01', '2027-07-31', '2027-07-31'],
    ['2024-07-31', '2026-08-01', '2027-07-31', '2027-07-31'],
  ] as const)(
    'aligns annual company date %s into period %s..%s',
    (accountsDueDate, start, end, expected) => {
      const result = evaluateDeadlineRule(input({
        recurrence: { schemaVersion: 1, kind: 'ANNUALLY' },
        company: { accountsDueDate },
        period: { key: 'annual', start, end },
        milestones: [milestone('annual-return-due', {
          kind: 'SOURCE',
          source: { kind: 'COMPANY_FIELD', field: 'accountsDueDate' },
        })],
      }));

      expect(result.occurrences[0]?.calculatedDueDate).toBe(expected);
    },
  );

  it('aligns an annual FYE landmark to the first anniversary on or after the period start', () => {
    const result = evaluateDeadlineRule(input({
      recurrence: { schemaVersion: 1, kind: 'ANNUALLY' },
      company: { financialYearEnd: '2024-12-31' },
      period: { key: '2026', start: '2026-08-01', end: '2027-07-31' },
      milestones: [milestone('fye', {
        kind: 'SOURCE',
        source: { kind: 'COMPANY_FIELD', field: 'financialYearEnd' },
      })],
    }));

    expect(result.occurrences[0]?.calculatedDueDate).toBe('2026-12-31');
  });


  it.each([
    ['2026-12-31', '2026-08-01', '2027-07-31', '2027-11-30'],
    ['2027-01-31', '2026-08-01', '2027-07-31', '2028-11-30'],
    ['2027-02-28', '2026-08-01', '2027-07-31', '2028-11-30'],
    ['2027-06-30', '2026-08-01', '2027-07-31', '2028-11-30'],
    ['2027-09-30', '2027-08-01', '2028-07-31', '2028-11-30'],
    ['2027-12-31', '2027-08-01', '2028-07-31', '2028-11-30'],
  ] as const)(
    'calculates Form C for FYE %s as 30 November in the following FYE year',
    (financialYearEnd, start, end, expected) => {
      const result = evaluateDeadlineRule(input({
        recurrence: { schemaVersion: 1, kind: 'ANNUALLY' },
        company: { financialYearEnd },
        period: { key: 'annual', start, end },
        milestones: [milestone('form-c-due', {
          type: 'STATUTORY',
          expression: {
            kind: 'FIXED_DATE_FROM_SOURCE_YEAR',
            source: { kind: 'COMPANY_FIELD', field: 'financialYearEnd' },
            yearOffset: 1,
            month: 11,
            day: 30,
          },
          businessDayAdjustment: 'NONE',
        })],
      }));

      expect(result.occurrences[0]?.calculatedDueDate).toBe(expected);
    },
  );

  it('keeps the exact stored company date for non-annual recurrence kinds', () => {
    const result = evaluateDeadlineRule(input({
      recurrence: { schemaVersion: 1, kind: 'MONTHLY', interval: 1 },
      company: { accountsDueDate: '2027-07-31' },
      period: { key: '2026-08', start: '2026-08-01', end: '2026-08-31' },
      milestones: [milestone('due', {
        kind: 'SOURCE',
        source: { kind: 'COMPANY_FIELD', field: 'accountsDueDate' },
      })],
    }));

    expect(result.occurrences[0]?.calculatedDueDate).toBe('2027-07-31');
  });

  it('keeps the exact stored company date for ONE_TIME recurrence', () => {
    const result = evaluateDeadlineRule(input({
      recurrence: { schemaVersion: 1, kind: 'ONE_TIME' },
      company: { accountsDueDate: '2027-07-31' },
      period: { key: 'ONE_TIME:2026-08-01', start: '2026-08-01', end: '2027-08-01' },
      milestones: [milestone('due', {
        kind: 'SOURCE',
        source: { kind: 'COMPANY_FIELD', field: 'accountsDueDate' },
      })],
    }));

    expect(result.occurrences[0]?.calculatedDueDate).toBe('2027-07-31');
  });

  it.each(['PAYROLL', 'ACCOUNTING'])('evaluates four repeatable entries for %s', (familyCode) => {    const scheduleEntries = [1, 8, 15, 22].map((day) => entry(`run-${day}`, {
      kind: 'DAY_OF_MONTH', day,
    }));
    const result = evaluateDeadlineRule(input({
      ruleId: familyCode,
      scheduleEntries,
      milestones: [milestone('service-run', {
        generationMode: 'ONCE_PER_SCHEDULE_ENTRY',
        expression: {
          kind: 'RELATIVE_TO_SOURCE',
          source: { kind: 'CURRENT_SCHEDULE_ENTRY' },
          offset: 0,
          unit: 'CALENDAR_DAY',
        },
      })],
    }));

    expect(result.occurrences.filter((item) => item.milestoneKey === 'service-run'))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ scheduleEntryKey: 'run-1', calculatedDueDate: '2026-08-01' }),
        expect.objectContaining({ scheduleEntryKey: 'run-8', calculatedDueDate: '2026-08-08' }),
        expect.objectContaining({ scheduleEntryKey: 'run-15', calculatedDueDate: '2026-08-15' }),
        expect.objectContaining({ scheduleEntryKey: 'run-22', calculatedDueDate: '2026-08-22' }),
      ]));
    expect(Object.keys(result.byKey)).toEqual([
      'service-run:run-1', 'service-run:run-8', 'service-run:run-15', 'service-run:run-22',
    ]);
  });

  it('evaluates a client deadline three business days before a schedule anchor', () => {
    const result = evaluateDeadlineRule(input({
      scheduleEntries: [entry('salary-payout', { kind: 'DAY_OF_MONTH', day: 28 })],
      milestones: [milestone('funding-deadline', {
        generationMode: 'ONCE_PER_SCHEDULE_ENTRY',
        expression: {
          kind: 'RELATIVE_TO_SOURCE',
          source: { kind: 'SCHEDULE_ENTRY', key: 'salary-payout' },
          offset: -3,
          unit: 'BUSINESS_DAY',
        },
      })],
    }));

    expect(result.byKey['funding-deadline:salary-payout']?.calculatedDueDate).toBe('2026-08-25');
  });

  it('evaluates schedule-entry dependencies before milestone expressions', () => {
    const result = evaluateDeadlineRule(input({
      scheduleEntries: [
        entry('salary-payout', { kind: 'DAY_OF_MONTH', day: 28 }),
        entry('funding-anchor', {
          kind: 'RELATIVE_TO_SOURCE',
          source: { kind: 'SCHEDULE_ENTRY', key: 'salary-payout' },
          offset: -3,
          unit: 'CALENDAR_DAY',
        }),
      ],
      milestones: [milestone('funding-deadline', {
        generationMode: 'ONCE_PER_SCHEDULE_ENTRY',
        expression: {
          kind: 'RELATIVE_TO_SOURCE',
          source: { kind: 'SCHEDULE_ENTRY', key: 'funding-anchor' },
          offset: 0,
          unit: 'CALENDAR_DAY',
        },
      })],
    }));

    expect(result.byKey['funding-deadline:funding-anchor']?.calculatedDueDate).toBe('2026-08-25');
  });

  it('applies offsets before the final business-day adjustment', () => {
    const result = evaluateDeadlineRule(input({
      scheduleEntries: [entry('weekend-anchor', { kind: 'DAY_OF_MONTH', day: 8 })],
      milestones: [milestone('adjusted', {
        generationMode: 'ONCE_PER_SCHEDULE_ENTRY',
        businessDayAdjustment: 'NEXT',
        expression: {
          kind: 'RELATIVE_TO_SOURCE',
          source: { kind: 'SCHEDULE_ENTRY', key: 'weekend-anchor' },
          offset: 0,
          unit: 'CALENDAR_DAY',
        },
      })],
    }));

    expect(result.byKey['adjusted:weekend-anchor']?.calculatedDueDate).toBe('2026-08-11');
  });

  it('supports all Task 2 date operations with deterministic cycle defaults', () => {
    const result = evaluateDeadlineRule(input({
      period: { key: '2026-01', start: '2026-01-31', end: '2026-02-28' },
      milestones: [
        milestone('months', { kind: 'ADD_MONTHS', amount: 1 }),
        milestone('calendar', { kind: 'ADD_CALENDAR_DAYS', amount: 2 }),
        milestone('business', { kind: 'ADD_BUSINESS_DAYS', amount: 1 }),
        milestone('added', { kind: 'ADD', offset: -1, unit: 'CALENDAR_DAY' }),
        milestone('adjust', { kind: 'ADJUST_BUSINESS_DAY', adjustment: 'NEXT' }),
      ],
    }));

    expect(result.byKey['months:']?.calculatedDueDate).toBe('2026-02-28');
    expect(result.byKey['calendar:']?.calculatedDueDate).toBe('2026-02-02');
    expect(result.byKey['business:']?.calculatedDueDate).toBe('2026-02-02');
    expect(result.byKey['added:']?.calculatedDueDate).toBe('2026-01-30');
    expect(result.byKey['adjust:']?.calculatedDueDate).toBe('2026-02-02');
  });

  it('binds a repeated milestone to the current schedule entry and preserves each date', () => {
    const result = evaluateDeadlineRule(input({
      scheduleEntries: [
        entry('one', { kind: 'DAY_OF_MONTH', day: 1 }),
        entry('two', { kind: 'DAY_OF_MONTH', day: 2 }),
      ],
      milestones: [milestone('per-entry', {
        generationMode: 'ONCE_PER_SCHEDULE_ENTRY',
        expression: {
          kind: 'RELATIVE_TO_SOURCE',
          source: { kind: 'CURRENT_SCHEDULE_ENTRY' },
          offset: 0,
          unit: 'CALENDAR_DAY',
        },
      })],
    }));

    expect(result.byKey['per-entry:one']?.calculatedDueDate).toBe('2026-08-01');
    expect(result.byKey['per-entry:two']?.calculatedDueDate).toBe('2026-08-02');
  });

  it('uses a stored company date before an explicitly configured coalesce fallback', () => {
    const expression: RuleDateExpression = {
      kind: 'COALESCE',
      candidates: [
        { kind: 'SOURCE', source: { kind: 'COMPANY_FIELD', field: 'accountsDueDate' } },
        {
          kind: 'ADD_MONTHS',
          source: { kind: 'COMPANY_FIELD', field: 'financialYearEnd' },
          amount: { kind: 'INTEGER_PARAMETER', key: 'monthsAfterFye' },
        },
      ],
    };
    const result = evaluateDeadlineRule(input({
      company: { accountsDueDate: '2027-05-31', financialYearEnd: '2026-12-31' },
      parameters: { monthsAfterFye: 5 },
      milestones: [milestone('agm-due', expression)],
    }));

    expect(result.byKey['agm-due:']?.calculatedDueDate).toBe('2027-05-31');
    expect(result.sourceSnapshot).toEqual(expect.objectContaining({
      company: { accountsDueDate: '2027-05-31' },
      parameters: {},
    }));
    expect(result.occurrences[0]?.explanation.join(' ')).toContain('Company.accountsDueDate');
  });

  it('uses a configured fallback when the stored company date is absent and records its inputs', () => {
    const result = evaluateDeadlineRule(input({
      company: { financialYearEnd: '2026-12-31' },
      parameters: { monthsAfterFye: 5 },
      milestones: [milestone('agm-due', {
        kind: 'COALESCE',
        candidates: [
          { kind: 'SOURCE', source: { kind: 'COMPANY_FIELD', field: 'accountsDueDate' } },
          {
            kind: 'ADD_MONTHS',
            source: { kind: 'COMPANY_FIELD', field: 'financialYearEnd' },
            amount: { kind: 'INTEGER_PARAMETER', key: 'monthsAfterFye' },
          },
        ],
      })],
    }));

    expect(result.byKey['agm-due:']?.calculatedDueDate).toBe('2027-05-31');
    expect(result.sourceSnapshot).toEqual(expect.objectContaining({
      company: { financialYearEnd: '2026-12-31' },
      parameters: { monthsAfterFye: 5 },
    }));
    expect(result.occurrences[0]?.explanation.join(' ')).toEqual(expect.stringContaining('Company.financialYearEnd'));
  });

  it('returns typed missing input when every coalesce candidate is unavailable', () => {
    expectMissingInput(() => evaluateDeadlineRule(input({
      milestones: [milestone('agm-due', {
        kind: 'COALESCE',
        candidates: [
          { kind: 'SOURCE', source: { kind: 'COMPANY_FIELD', field: 'accountsDueDate' } },
          {
            kind: 'ADD_MONTHS',
            source: { kind: 'COMPANY_FIELD', field: 'financialYearEnd' },
            amount: { kind: 'INTEGER_PARAMETER', key: 'monthsAfterFye' },
          },
        ],
      })],
    })));
  });

  it('evaluates FYE plus a typed integer months-after-FYE parameter', () => {
    const result = evaluateDeadlineRule(input({
      company: { financialYearEnd: '2026-12-31' },
      parameters: { monthsAfterFye: 3 },
      milestones: [milestone('accounts-due', {
        kind: 'ADD_MONTHS',
        source: { kind: 'COMPANY_FIELD', field: 'financialYearEnd' },
        amount: { kind: 'INTEGER_PARAMETER', key: 'monthsAfterFye' },
      })],
    }));

    expect(result.byKey['accounts-due:']?.calculatedDueDate).toBe('2027-03-31');
    expect(result.occurrences[0]?.explanation.join(' ')).toContain('Parameter.monthsAfterFye');
    expect(result.evaluationHash).not.toBe(evaluateDeadlineRule(input({
      company: { financialYearEnd: '2026-12-31' },
      parameters: { monthsAfterFye: 4 },
      milestones: [milestone('accounts-due', {
        kind: 'ADD_MONTHS',
        source: { kind: 'COMPANY_FIELD', field: 'financialYearEnd' },
        amount: { kind: 'INTEGER_PARAMETER', key: 'monthsAfterFye' },
      })],
    })).evaluationHash);
  });

  it('rejects missing, wrong-type, and out-of-range integer operands with typed errors', () => {
    expectMissingInput(() => evaluateDeadlineRule(input({
      company: { financialYearEnd: '2026-12-31' },
      parameters: {},
      milestones: [milestone('accounts-due', {
        kind: 'ADD_MONTHS',
        source: { kind: 'COMPANY_FIELD', field: 'financialYearEnd' },
        amount: { kind: 'INTEGER_PARAMETER', key: 'monthsAfterFye' },
      })],
    })));
    expect(() => evaluateDeadlineRule(input({
      company: { financialYearEnd: '2026-12-31' },
      parameters: { monthsAfterFye: '3' },
      milestones: [milestone('accounts-due', {
        kind: 'ADD_MONTHS',
        source: { kind: 'COMPANY_FIELD', field: 'financialYearEnd' },
        amount: { kind: 'INTEGER_PARAMETER', key: 'monthsAfterFye' },
      })],
    }))).toThrow(ValidationError);
    expect(() => evaluateDeadlineRule(input({
      company: { financialYearEnd: '2026-12-31' },
      parameters: { monthsAfterFye: 3661 },
      milestones: [milestone('accounts-due', {
        kind: 'ADD_MONTHS',
        source: { kind: 'COMPANY_FIELD', field: 'financialYearEnd' },
        amount: { kind: 'INTEGER_PARAMETER', key: 'monthsAfterFye' },
      })],
    }))).toThrow(ValidationError);
  });

  it.each(['constructor', 'toString'])('treats a missing prototype-named date parameter (%s) as missing input', (key) => {
    expectMissingInput(() => evaluateDeadlineRule(input({
      parameters: {},
      milestones: [milestone('date-parameter', {
        kind: 'RELATIVE_TO_SOURCE',
        source: { kind: 'PARAMETER', key },
        offset: 0,
        unit: 'CALENDAR_DAY',
      })],
    })));
  });

  it.each(['constructor', 'toString'])('treats a missing prototype-named integer parameter (%s) as missing input', (key) => {
    expectMissingInput(() => evaluateDeadlineRule(input({
      parameters: {},
      milestones: [milestone('integer-parameter', {
        kind: 'ADD_MONTHS',
        amount: { kind: 'INTEGER_PARAMETER', key },
      })],
    })));
  });

  it('resolves own prototype-named parameters, snapshots them, and hashes their values', () => {
    const dateParameters = { constructor: '2026-08-15' };
    const dateResult = evaluateDeadlineRule(input({
      parameters: dateParameters,
      milestones: [milestone('date-parameter', {
        kind: 'RELATIVE_TO_SOURCE',
        source: { kind: 'PARAMETER', key: 'constructor' },
        offset: 0,
        unit: 'CALENDAR_DAY',
      })],
    }));
    expect(dateResult.byKey['date-parameter:']?.calculatedDueDate).toBe('2026-08-15');
    expect(dateResult.sourceSnapshot).toEqual(expect.objectContaining({
      parameters: { constructor: '2026-08-15' },
    }));

    const integerResult = evaluateDeadlineRule(input({
      parameters: { toString: 2 },
      milestones: [milestone('integer-parameter', {
        kind: 'ADD_MONTHS',
        amount: { kind: 'INTEGER_PARAMETER', key: 'toString' },
      })],
    }));
    expect(integerResult.byKey['integer-parameter:']?.calculatedDueDate).toBe('2026-10-01');
    expect(integerResult.sourceSnapshot).toEqual(expect.objectContaining({
      parameters: { toString: 2 },
    }));
    const changedIntegerResult = evaluateDeadlineRule(input({
      parameters: { toString: 3 },
      milestones: [milestone('integer-parameter', {
        kind: 'ADD_MONTHS',
        amount: { kind: 'INTEGER_PARAMETER', key: 'toString' },
      })],
    }));
    expect(changedIntegerResult.evaluationHash).not.toBe(integerResult.evaluationHash);
  });

  it('supports null-prototype parameter records without inheriting prototype values', () => {
    const parameters = Object.create(null) as Record<string, unknown>;
    parameters['toString'] = '2026-08-19';
    const result = evaluateDeadlineRule(input({
      parameters,
      milestones: [milestone('date-parameter', {
        kind: 'RELATIVE_TO_SOURCE',
        source: { kind: 'PARAMETER', key: 'toString' },
        offset: 0,
        unit: 'CALENDAR_DAY',
      })],
    }));
    expect(result.byKey['date-parameter:']?.calculatedDueDate).toBe('2026-08-19');
    expect(result.sourceSnapshot).toEqual(expect.objectContaining({
      parameters: { toString: '2026-08-19' },
    }));
  });

  it('accepts operation milestones through the persisted strict schema', async () => {
    const { deadlineMilestoneSchema } = await import('@/lib/validations/service-schedule');
    expect(deadlineMilestoneSchema.parse({
      key: 'accounts-due',
      name: 'Accounts due',
      description: null,
      type: 'STATUTORY',
      generationMode: 'ONCE_PER_CYCLE',
      expression: { kind: 'ADD_MONTHS', amount: { kind: 'INTEGER_PARAMETER', key: 'monthsAfterFye' } },
      businessDayAdjustment: 'NONE',
      displayOrder: 0,
      isActive: true,
    }).expression.kind).toBe('ADD_MONTHS');
  });

  it('rejects CURRENT_SCHEDULE_ENTRY outside a repeated milestone context', () => {
    expect(() => evaluateDeadlineRule(input({
      milestones: [milestone('invalid-current', {
        kind: 'RELATIVE_TO_SOURCE',
        source: { kind: 'CURRENT_SCHEDULE_ENTRY' },
        offset: 0,
        unit: 'CALENDAR_DAY',
      })],
    }))).toThrow(ValidationError);
  });

  it('rejects an invalid coalesce candidate even when a stored primary exists', () => {
    expect(() => evaluateDeadlineRule(input({
      company: { accountsDueDate: '2027-05-31' },
      milestones: [milestone('invalid-fallback', {
        kind: 'COALESCE',
        candidates: [
          { kind: 'SOURCE', source: { kind: 'COMPANY_FIELD', field: 'accountsDueDate' } },
          { kind: 'UNSUPPORTED' },
        ],
      } as never)],
    }))).toThrow(ValidationError);
  });

  it('rejects circular, missing, ambiguous, self, and duplicate dependencies deterministically', () => {
    expect(() => evaluateDeadlineRule(input({
      milestones: [
        milestone('a', { kind: 'RELATIVE_TO_SOURCE', source: { kind: 'MILESTONE', key: 'b' }, offset: 0, unit: 'CALENDAR_DAY' }),
        milestone('b', { kind: 'RELATIVE_TO_SOURCE', source: { kind: 'MILESTONE', key: 'a' }, offset: 0, unit: 'CALENDAR_DAY' }),
      ],
    }))).toThrow(/circular/i);

    expect(() => evaluateDeadlineRule(input({
      milestones: [milestone('a', { kind: 'RELATIVE_TO_SOURCE', source: { kind: 'SCHEDULE_ENTRY', key: 'missing' }, offset: 0, unit: 'CALENDAR_DAY' })],
    }))).toThrow(/missing/i);

    expect(() => evaluateDeadlineRule(input({
      milestones: [
        milestone('cycle', {
          expression: {
            kind: 'RELATIVE_TO_SOURCE',
            source: { kind: 'MILESTONE', key: 'per-entry' },
            offset: 0,
            unit: 'CALENDAR_DAY',
          },
        }),
        milestone('per-entry', {
          generationMode: 'ONCE_PER_SCHEDULE_ENTRY',
          expression: {
            kind: 'RELATIVE_TO_SOURCE',
            source: { kind: 'CURRENT_SCHEDULE_ENTRY' },
            offset: 0,
            unit: 'CALENDAR_DAY',
          },
        }),
      ],
    }))).toThrow(/ambiguous/i);

    expect(() => evaluateDeadlineRule(input({
      milestones: [milestone('self', { kind: 'RELATIVE_TO_SOURCE', source: { kind: 'MILESTONE', key: 'self' }, offset: 0, unit: 'CALENDAR_DAY' })],
    }))).toThrow(/self|circular/i);

    expect(() => evaluateDeadlineRule(input({
      milestones: [
        milestone('duplicate', { kind: 'DAY_OF_MONTH', day: 1 }),
        milestone('duplicate', { kind: 'DAY_OF_MONTH', day: 2 }),
      ],
    }))).toThrow(/duplicate/i);
  });

  it('returns no occurrences for inapplicable or missing-applicability rules', () => {
    const notApplicable = evaluateDeadlineRule(input({
      applicability: {
        schemaVersion: 1,
        kind: 'ALL',
        conditions: [{ kind: 'FIELD_EQUALS', field: 'entityType', value: 'PRIVATE_COMPANY' }],
      },
      company: { entityType: 'PUBLIC_COMPANY' },
    }));
    expect(notApplicable.applicability.state).toBe('NOT_APPLICABLE');
    expect(notApplicable.occurrences).toEqual([]);

    const missing = evaluateDeadlineRule(input({
      applicability: {
        schemaVersion: 1,
        kind: 'ALL',
        conditions: [{ kind: 'FIELD_EQUALS', field: 'entityType', value: 'PRIVATE_COMPANY' }],
      },
    }));
    expect(missing.applicability.state).toBe('MISSING_INPUT');
    expect(missing.occurrences).toEqual([]);
  });

  it('uses typed missing-input errors for required date sources', () => {
    expect(() => evaluateDeadlineRule(input({
      parameters: {},
      milestones: [milestone('parameter', {
        kind: 'RELATIVE_TO_SOURCE',
        source: { kind: 'PARAMETER', key: 'daysAfter' },
        offset: 0,
        unit: 'CALENDAR_DAY',
      })],
    })));

    expectMissingInput(() => evaluateDeadlineRule(input({
      scheduleEntries: [],
      milestones: [milestone('schedule', {
        kind: 'RELATIVE_TO_SOURCE',
        source: { kind: 'SCHEDULE_ENTRY', key: 'missing' },
        offset: 0,
        unit: 'CALENDAR_DAY',
      })],
    })));
  });

  it('rejects malformed duplicate schedules and unsupported source types with typed errors', () => {
    expect(() => evaluateDeadlineRule(input({
      scheduleEntries: [
        entry('same', { kind: 'DAY_OF_MONTH', day: 1 }),
        entry('same', { kind: 'DAY_OF_MONTH', day: 2 }),
      ],
    }))).toThrow(DeadlineApiError);

    expect(() => evaluateDeadlineRule(input({
      milestones: [milestone('bad', {
        expression: { kind: 'RELATIVE_TO_SOURCE', source: { kind: 'UNKNOWN' } as never, offset: 0, unit: 'CALENDAR_DAY' },
      })],
    }))).toThrow(ValidationError);
  });

  it.each([true, false])('rejects cyclic schedule extras before %s applicability snapshotting', (isApplicable) => {
    const cyclicEntry = entry('cycle', { kind: 'DAY_OF_MONTH', day: 1 }) as ScheduleEntry & Record<string, unknown>;
    cyclicEntry.extra = cyclicEntry;
    expect(() => evaluateDeadlineRule(input({
      applicability: isApplicable ? applicable : {
        schemaVersion: 1,
        kind: 'ALL',
        conditions: [{ kind: 'FIELD_EQUALS', field: 'entityType', value: 'PRIVATE_COMPANY' }],
      },
      company: isApplicable ? {} : { entityType: 'PUBLIC_COMPANY' },
      scheduleEntries: [cyclicEntry],
    }))).toThrow(ValidationError);
  });

  it('returns a JSON-safe consumed-input snapshot and a stable relevant-input hash', () => {
    const first = evaluateDeadlineRule(input({
      parameters: { answer: '2026-08-15', unused: 'ignored' },
      scheduleEntries: [entry('anchor', { kind: 'DAY_OF_MONTH', day: 15 })],
      milestones: [milestone('due', {
        expression: { kind: 'RELATIVE_TO_SOURCE', source: { kind: 'PARAMETER', key: 'answer' }, offset: 0, unit: 'CALENDAR_DAY' },
      })],
    }));
    const reordered = evaluateDeadlineRule({
      ...input({
        parameters: { unused: 'ignored', answer: '2026-08-15' },
        scheduleEntries: [entry('anchor', { kind: 'DAY_OF_MONTH', day: 15 })],
        milestones: [milestone('due', {
          expression: { kind: 'RELATIVE_TO_SOURCE', source: { kind: 'PARAMETER', key: 'answer' }, offset: 0, unit: 'CALENDAR_DAY' },
        })],
      }),
    });

    expect(first.evaluationHash).toBe(reordered.evaluationHash);
    expect(JSON.stringify(first.sourceSnapshot)).not.toContain('Set');
    expect(first.sourceSnapshot).toEqual(expect.objectContaining({
      ruleId: 'rule-1',
      ruleVersionId: 'version-1',
      calendar: expect.objectContaining({ id: 'sg-calendar', revision: 1 }),
      company: {},
      parameters: expect.objectContaining({ answer: '2026-08-15' }),
    }));

    const changed = evaluateDeadlineRule(input({
      parameters: { answer: '2026-08-16' },
      scheduleEntries: [entry('anchor', { kind: 'DAY_OF_MONTH', day: 15 })],
      milestones: [milestone('due', {
        expression: { kind: 'RELATIVE_TO_SOURCE', source: { kind: 'PARAMETER', key: 'answer' }, offset: 0, unit: 'CALENDAR_DAY' },
      })],
    }));
    expect(changed.evaluationHash).not.toBe(first.evaluationHash);
  });
});
