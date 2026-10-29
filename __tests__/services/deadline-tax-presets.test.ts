import { describe, expect, it } from 'vitest';
import { DeadlineApiError, ErrorCodes } from '@/lib/errors';
import {
  addMonthsClamped,
  addMonthsPreservingMonthEnd,
  evaluateDeadlineRule,
  milestoneExpressionSchema,
  obligationPeriodBasisForExpressions,
  obligationPeriodFromCycle,
  planFinancialPeriods,
  planObligationPeriods,
  type BusinessCalendarSnapshot,
  type DateOnly,
  type DeadlineRuleEvaluationInput,
} from '@/services/service-schedule';
import { SG_AGM_PRESET, SG_ANNUAL_RETURN_PRESET, SG_ECI_PRESET, SG_FORM_C_PRESET } from '@/services/deadline-rule/presets';
import { projectDeadlineRule } from '@/services/schedule-reconciliation/projection';
import type { DeadlineRuleProjectionInput } from '@/services/schedule-reconciliation/types';

const calendar: BusinessCalendarSnapshot = {
  id: 'sg',
  timeZone: 'Asia/Singapore',
  revision: 1,
  weekendDays: new Set([0, 6]),
  holidays: new Set<DateOnly>(),
};

function presetInput(
  preset: typeof SG_ECI_PRESET,
  obligationPeriod: DeadlineRuleEvaluationInput['obligationPeriod'],
): DeadlineRuleEvaluationInput {
  return {
    ruleId: `rule-${preset.code}`,
    ruleVersionId: `version-${preset.code}`,
    recurrence: preset.definition.recurrence,
    applicability: preset.definition.applicability,
    parameters: {},
    scheduleEntries: [],
    milestones: preset.definition.milestones,
    company: {},
    period: { key: 'p', start: obligationPeriod!.start, end: obligationPeriod!.end },
    obligationPeriod,
    calendar,
  };
}

function projectionInput(
  preset: typeof SG_ECI_PRESET,
  overrides: Partial<DeadlineRuleProjectionInput> = {},
): DeadlineRuleProjectionInput {
  return {
    ruleId: `rule-${preset.code}`,
    ruleCode: preset.code,
    ruleVersionId: `version-${preset.code}`,
    recurrence: preset.definition.recurrence,
    applicability: preset.definition.applicability,
    parameters: {},
    scheduleEntries: [],
    milestones: preset.definition.milestones,
    company: {},
    periodFacts: { financialYearEndMonth: 3, financialYearEndDay: 31, incorporationDate: '2015-01-05' },
    calendar,
    today: '2026-09-27',
    horizonEnd: '2027-09-27',
    ...overrides,
  };
}

describe('month-end ECI arithmetic', () => {
  const monthEnds: Array<[DateOnly, DateOnly]> = [
    ['2026-01-31', '2026-04-30'],
    ['2026-02-28', '2026-05-31'],
    ['2026-03-31', '2026-06-30'],
    ['2026-04-30', '2026-07-31'],
    ['2026-05-31', '2026-08-31'],
    ['2026-06-30', '2026-09-30'],
    ['2026-07-31', '2026-10-31'],
    ['2026-08-31', '2026-11-30'],
    ['2026-09-30', '2026-12-31'],
    ['2026-10-31', '2027-01-31'],
    ['2026-11-30', '2027-02-28'],
    ['2026-12-31', '2027-03-31'],
  ];

  it.each(monthEnds)('maps month-end FYE %s to the third following month end %s', (fye, due) => {
    expect(addMonthsPreservingMonthEnd(fye, 3)).toBe(due);
  });

  it('handles leap years and cross-year month ends', () => {
    expect(addMonthsPreservingMonthEnd('2027-11-30', 3)).toBe('2028-02-29');
    expect(addMonthsPreservingMonthEnd('2028-02-29', 3)).toBe('2028-05-31');
    expect(addMonthsPreservingMonthEnd('2025-11-30', 3)).toBe('2026-02-28');
  });

  it('keeps the September regression and leaves generic month arithmetic alone', () => {
    expect(addMonthsPreservingMonthEnd('2026-09-30', 3)).toBe('2026-12-31');
    expect(addMonthsClamped('2026-09-30', 3)).toBe('2026-12-30');
  });

  it('clamps a non-month-end FYE exactly like ordinary month arithmetic', () => {
    expect(addMonthsPreservingMonthEnd('2026-06-15', 3)).toBe('2026-09-15');
    expect(addMonthsPreservingMonthEnd('2026-11-29', 3)).toBe('2027-02-28');
  });
});

describe('reviewed tax presets', () => {
  it('validate under the shared expression schema with no months-after-FYE question', () => {
    for (const preset of [SG_ECI_PRESET, SG_FORM_C_PRESET, SG_AGM_PRESET, SG_ANNUAL_RETURN_PRESET]) {
      expect(preset.definition.parameters).toEqual([]);
      for (const milestone of preset.definition.milestones) {
        expect(milestoneExpressionSchema.safeParse(milestone.expression).success).toBe(true);
      }
    }
  });

  it.each(SG_ECI_PRESET.examples)('ECI example FYE $financialYearEnd is due $dueDate', (example) => {
    const result = evaluateDeadlineRule(presetInput(SG_ECI_PRESET, {
      start: addMonthsClamped(example.financialYearEnd, -12),
      end: example.financialYearEnd,
      yearOfAssessment: example.yearOfAssessment,
    }));
    expect(result.occurrences.map((occurrence) => occurrence.calculatedDueDate)).toEqual([example.dueDate]);
  });

  it.each(SG_FORM_C_PRESET.examples)('Form C example YA $yearOfAssessment is due $dueDate', (example) => {
    const result = evaluateDeadlineRule(presetInput(SG_FORM_C_PRESET, {
      start: addMonthsClamped(example.financialYearEnd, -12),
      end: example.financialYearEnd,
      yearOfAssessment: example.yearOfAssessment,
    }));
    expect(result.occurrences[0]?.calculatedDueDate).toBe(example.dueDate);
    expect(result.occurrences[0]?.explanation.join(' ')).toContain(`YA ${example.yearOfAssessment}`);
  });

  it.each([
    ...SG_AGM_PRESET.examples.map((example) => ['AGM', SG_AGM_PRESET, example] as const),
    ...SG_ANNUAL_RETURN_PRESET.examples.map((example) => ['Annual return', SG_ANNUAL_RETURN_PRESET, example] as const),
  ])('%s example FYE %o is due on its example date', (_label, preset, example) => {
    const result = evaluateDeadlineRule(presetInput(preset, {
      start: addMonthsClamped(example.financialYearEnd, -12),
      end: example.financialYearEnd,
      yearOfAssessment: example.yearOfAssessment,
    }));
    expect(result.occurrences.map((occurrence) => occurrence.calculatedDueDate)).toEqual([example.dueDate]);
  });

  it('projects ACRA presets per financial period even under the old backlog rule codes', () => {
    for (const [preset, dueDates] of [
      [SG_AGM_PRESET, ['2026-09-30', '2027-09-30']],
      [SG_ANNUAL_RETURN_PRESET, ['2026-10-31', '2027-10-31']],
    ] as const) {
      const result = projectDeadlineRule(projectionInput(preset, { company: { accountsDueDate: '2026-07-31' }, horizonEnd: '2027-12-31' }));
      expect(result.materializationPolicy).toBe('OBLIGATION_PERIOD');
      expect(result.occurrences.map((occurrence) => [occurrence.periodKey, occurrence.calculatedDueDate])).toEqual([
        ['FY2026-03-31', dueDates[0]],
        ['FY2027-03-31', dueDates[1]],
      ]);
    }
  });

  it('reports a typed missing input when no explicit period or YA is supplied', () => {
    const eci = presetInput(SG_ECI_PRESET, { start: '2025-04-01', end: '2026-03-31', yearOfAssessment: 2027 });
    delete eci.obligationPeriod;
    expect(() => evaluateDeadlineRule(eci)).toThrow(DeadlineApiError);
    const formC = presetInput(SG_FORM_C_PRESET, { start: '2025-04-01', end: '2026-03-31', yearOfAssessment: null });
    try {
      evaluateDeadlineRule(formC);
      throw new Error('expected missing input');
    } catch (error) {
      expect((error as DeadlineApiError).code).toBe(ErrorCodes.MISSING_RULE_INPUT);
    }
  });

  it('keeps legacy evaluation snapshots unchanged when no obligation period is given', () => {
    const legacy = evaluateDeadlineRule({
      ...presetInput(SG_ECI_PRESET, { start: '2026-01-01', end: '2026-12-31', yearOfAssessment: 2027 }),
      milestones: [{ ...SG_ECI_PRESET.definition.milestones[0]!, expression: { kind: 'SOURCE', source: { kind: 'CYCLE_END' } } }],
      obligationPeriod: undefined,
    });
    expect(legacy.sourceSnapshot).not.toHaveProperty('obligationPeriod');
  });
});

describe('financial period planning', () => {
  it('derives provisional annual periods and the normal YA mapping', () => {
    const plan = planFinancialPeriods(
      { financialYearEndMonth: 3, financialYearEndDay: 31, incorporationDate: '2015-01-05' },
      '2025-01-01',
      '2027-12-31',
    );
    expect(plan.periods.map((period) => [period.start, period.end, period.yearsOfAssessment])).toEqual([
      ['2024-04-01', '2025-03-31', [2026]],
      ['2025-04-01', '2026-03-31', [2027]],
      ['2026-04-01', '2027-03-31', [2028]],
    ]);
    expect(plan.periods.every((period) => period.reviewReasons.length === 0)).toBe(true);
  });

  it('does not fabricate a prior YA for a company incorporated in 2026', () => {
    const plan = planFinancialPeriods(
      { financialYearEndMonth: 3, financialYearEndDay: 31, incorporationDate: '2026-02-10' },
      '2025-01-01',
      '2027-12-31',
    );
    expect(plan.periods[0]).toMatchObject({
      start: '2026-02-10',
      end: '2026-03-31',
      yearsOfAssessment: [2027],
      reviewReasons: ['FIRST_FINANCIAL_PERIOD_UNCONFIRMED', 'YEAR_OF_ASSESSMENT_UNCONFIRMED'],
    });
    const years = planObligationPeriods('YEAR_OF_ASSESSMENT', plan.periods).map((period) => period.yearOfAssessment);
    expect(years).not.toContain(2026);
  });

  it('lets confirmed periods win and flags the gap after an FYE change', () => {
    const plan = planFinancialPeriods(
      {
        financialYearEndMonth: 3,
        financialYearEndDay: 31,
        confirmedPeriods: [{ start: '2025-01-01', end: '2025-12-31', source: 'CONFIRMED' }],
      },
      '2025-06-01',
      '2026-12-31',
    );
    expect(plan.periods.map((period) => [period.start, period.end, period.source, period.reviewReasons])).toEqual([
      ['2025-01-01', '2025-12-31', 'CONFIRMED', []],
      ['2026-01-01', '2026-03-31', 'DERIVED', ['FINANCIAL_PERIOD_GAP_AFTER_FYE_CHANGE', 'YEAR_OF_ASSESSMENT_UNCONFIRMED']],
    ]);
  });

  it('groups an explicit multi-YA basis allocation by assessment year', () => {
    const plan = planFinancialPeriods({
      confirmedPeriods: [{ start: '2024-06-01', end: '2025-12-31', source: 'CONFIRMED', yearsOfAssessment: [2025, 2026] }],
    }, '2025-01-01', '2026-12-31');
    const byYear = planObligationPeriods('YEAR_OF_ASSESSMENT', plan.periods);
    expect(byYear.map((period) => [period.periodKey, period.reviewReasons])).toEqual([
      ['YA2025', ['MULTIPLE_YEARS_OF_ASSESSMENT']],
      ['YA2026', ['MULTIPLE_YEARS_OF_ASSESSMENT']],
    ]);
  });

  it('reports a missing FYE instead of guessing', () => {
    expect(planFinancialPeriods({}, '2025-01-01', '2026-01-01')).toEqual({ periods: [], missingFinancialYearEnd: true });
  });

  it('keeps a 29 February FYE a month end in every year', () => {
    const plan = planFinancialPeriods({ financialYearEndMonth: 2, financialYearEndDay: 29 }, '2027-01-01', '2028-12-31');
    expect(plan.periods.map((period) => period.end)).toEqual(['2027-02-28', '2028-02-29']);
  });

  it('detects the period basis from rule expressions and restores stored cycles', () => {
    expect(obligationPeriodBasisForExpressions(SG_ECI_PRESET.definition.milestones.map((m) => m.expression))).toBe('FINANCIAL_PERIOD');
    expect(obligationPeriodBasisForExpressions(SG_FORM_C_PRESET.definition.milestones.map((m) => m.expression))).toBe('YEAR_OF_ASSESSMENT');
    expect(obligationPeriodBasisForExpressions([{ kind: 'SOURCE', source: { kind: 'CYCLE_END' } }])).toBeNull();
    expect(obligationPeriodFromCycle('YA2027', '2025-04-01', '2026-03-31')).toEqual({ start: '2025-04-01', end: '2026-03-31', yearOfAssessment: 2027 });
    expect(obligationPeriodFromCycle('FY2026-03-31', '2025-04-01', '2026-03-31')?.yearOfAssessment).toBe(2027);
    expect(obligationPeriodFromCycle('2026', '2026-01-01', '2026-12-31')).toBeNull();
  });
});

describe('period-based projection', () => {
  it('keeps the prior-FYE YA 2026 return that falls due after today', () => {
    const projection = projectDeadlineRule(projectionInput(SG_FORM_C_PRESET, { horizonEnd: '2028-09-27' }));
    expect(projection.materializationPolicy).toBe('OBLIGATION_PERIOD');
    expect(projection.occurrences.map((occurrence) => [occurrence.periodKey, occurrence.calculatedDueDate])).toEqual([
      ['YA2026', '2026-11-30'],
      ['YA2027', '2027-11-30'],
    ]);
    expect(projection.occurrences[0]?.obligationPeriod).toMatchObject({ start: '2024-04-01', end: '2025-03-31', yearOfAssessment: 2026 });
  });

  it('plans ECI by financial period and excludes due dates before the window', () => {
    const projection = projectDeadlineRule(projectionInput(SG_ECI_PRESET));
    expect(projection.occurrences.map((occurrence) => [occurrence.periodKey, occurrence.calculatedDueDate])).toEqual([
      ['FY2027-03-31', '2027-06-30'],
    ]);
    const withBackfill = projectDeadlineRule(projectionInput(SG_ECI_PRESET, { windowStart: '2026-04-01' }));
    expect(withBackfill.occurrences.map((occurrence) => occurrence.calculatedDueDate)).toEqual(['2026-06-30', '2027-06-30']);
  });

  it('returns a visible missing-input state without an FYE', () => {
    const projection = projectDeadlineRule(projectionInput(SG_ECI_PRESET, { periodFacts: {} }));
    expect(projection.applicability).toMatchObject({ state: 'MISSING_INPUT', missingFields: ['financialYearEnd'] });
    expect(projection.occurrences).toEqual([]);
  });

  it('leaves legacy rolling rules on their existing policy', () => {
    const projection = projectDeadlineRule({
      ...projectionInput(SG_ECI_PRESET),
      ruleCode: 'CUSTOM',
      recurrence: { schemaVersion: 1, kind: 'MONTHLY' },
      milestones: [{ ...SG_ECI_PRESET.definition.milestones[0]!, expression: { kind: 'DAY_OF_MONTH', day: 15 } }],
    });
    expect(projection.materializationPolicy).toBe('ROLLING_HORIZON');
  });
});
