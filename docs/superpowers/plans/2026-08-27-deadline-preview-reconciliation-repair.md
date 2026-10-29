# Deadline Preview and Reconciliation Consistency Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Services deadline previews and persisted deadline occurrences use one canonical calculation, correctly generate authoritative Annual Return/AGM backlog, repair annual company-date alignment, and safely remediate already-generated incorrect occurrences for explicitly selected client services.

**Architecture:** Introduce a pure deadline projection module that owns materialization-policy resolution, period planning, rule evaluation, boundary filtering, and duplicate suppression. The stable codes `SG_ANNUAL_RETURN` and `SG_AGM_DUE` use authoritative annual backlog from the company accounts-due source through the 12-month future horizon, capped to the most recent 20 cycles; every other rule uses the normal rolling horizon. Both the client-service impact preview and write-mode reconciler consume that projection, the editor renders the server projection, and a separate fingerprint-gated maintenance command corrects selected `OPEN`, `RULE`, non-overridden occurrences.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Prisma 7/PostgreSQL, Zod, React Query, Vitest, Testing Library, PostgreSQL integration tests, PowerShell/npm scripts.

**Spec:** `docs/superpowers/specs/2026-08-17-services-administration-deadlines-billing-design.md`

## Global Constraints

- Follow `AGENTS.md` and update supporting documentation under `docs/`.
- Preserve the default deadline-engine invariant: automatic materialization covers the current Singapore date through a rolling 12-month horizon.
- Add exactly two exceptions: `SG_ANNUAL_RETURN` and `SG_AGM_DUE` generate annual backlog from the authoritative monthly `Company.accountsDueDate` through the rolling 12-month future horizon.
- Do not enable authoritative backlog by rule name, milestone name, UI label, or arbitrary date expression. Resolve it only from the stable rule codes `SG_ANNUAL_RETURN` and `SG_AGM_DUE`.
- Generate at most the most recent 20 authoritative annual cycles, always retaining the current/future end of the range. If older cycles are excluded, return `AUTHORITATIVE_BACKLOG_TRUNCATED` with the excluded cycle count and oldest retained year.
- No other rule, including ECI, Form C, custom annual rules, or rules sourced from `financialYearEnd`, automatically generates historical backlog.
- Keep all calculations date-only and deterministic in `Asia/Singapore`; browser, server, and database time zones must not change a due date.
- Use the same period planner, source alignment, evaluator, horizon filter, and duplicate suppression for impact preview and reconciliation.
- Treat `Company.accountsDueDate` as the authoritative first Annual Return source date for the two backlog rules. Annual Return uses that date; AGM uses one month before each corresponding annual source anniversary.
- Treat annual company-date fields as recurring month/day landmarks for ordinary annual rolling evaluation. Preserve exact-date behavior for `ONE_TIME` and other recurrence kinds unless their existing DSL explicitly says otherwise.
- Normal reconciliation continues to preserve Historical, Completed, Waived, Cancelled, Manual Trigger, and overridden occurrences.
- Remediation may bypass the Historical preservation rule only for explicitly selected client-service IDs and only for `OPEN`, `RULE`, non-overridden occurrences.
- Remediation must never mutate `COMPLETED`, `WAIVED`, `CANCELLED`, `MANUAL_TRIGGER`, or date-overridden occurrences.
- Remediation defaults to dry-run, requires an exact preview fingerprint before apply, records an audit entry, and is repeat-idempotent.
- Do not delete deadline history. Incorrect unmatched occurrences are cancelled with a repair reason; matched incorrect occurrences are recalculated in place.
- Preserve tenant isolation in every query and mutation. A client-service ID is never sufficient without its tenant ID.
- Avoid unrelated UI or deadline-engine refactoring.
- Use TDD: every behavioral task starts with a failing test, proves the failure, implements the minimum repair, and reruns focused tests before commit.

---

## Confirmed production-development symptom

The investigation on 27 August 2026 established all of the following:

- Both client-service edit requests enqueued and completed reconciliation successfully.
- Layman Coffee had two `OPEN` historical occurrences and two future occurrences; two edit reconciliations preserved four historical decisions in total.
- Oaktree Accounting had six `OPEN` historical occurrences and two future occurrences; its edit reconciliation preserved two old occurrences while generating additional periods.
- Given a rolling period of `2026-08-01` through `2027-07-31` and `accountsDueDate = 2027-07-31`, the evaluator returned `2026-07-31`, a date before both the period and the current date.
- The editor preview, server impact preview, and write-mode reconciler currently use different planning inputs.
- The test named `materializes a fixed company-date milestone only once across rolling annual periods` permits multiple creations because it asserts `toBeGreaterThanOrEqual(1)` rather than exact identities and dates.

These facts are the regression baseline. The repair is not complete unless tests explicitly prevent each condition from recurring.

## Required behavioral invariants

1. For `today = 2026-08-27`, `horizonEnd = 2027-08-27`, and `accountsDueDate = 2027-07-31`, `SG_ANNUAL_RETURN` contains exactly one occurrence on `2027-07-31`.
2. For the same window and an AGM milestone defined as one month before that source, the projection contains exactly one AGM occurrence on `2027-06-30`.
3. Replacing the source year with the period start year must never move a July landmark to July 2026 when the period starts in August 2026.
4. With authoritative `accountsDueDate = 2024-07-31`, `SG_ANNUAL_RETURN` generates `2024-07-31`, `2025-07-31`, `2026-07-31`, and `2027-07-31`; `SG_AGM_DUE` generates `2024-06-30`, `2025-06-30`, `2026-06-30`, and `2027-06-30`.
5. A non-backlog annual rule with the same 2024 source date generates no pre-today occurrences and retains rolling-horizon-only behavior.
6. No projected occurrence may be later than `horizonEnd`. An occurrence may be earlier than `today` only when its policy is `AUTHORITATIVE_ANNUAL_BACKLOG`.
7. A source range of more than 20 annual cycles retains the most recent 20 cycles through the horizon and returns `AUTHORITATIVE_BACKLOG_TRUNCATED`; it never drops the current or future cycles in favor of older history.
8. Preview and apply return the same set of `(ruleId, periodKey, milestoneKey, scheduleEntryKey, dueDate)` tuples for the same immutable inputs.
9. Saving a service is not required to repair protected historical data. The dedicated remediation command is the only supported bypass.
10. The Services editor displays dates from the canonical server projection and never calls `calculateActualDeadlinesPreview`.

---

## File and responsibility map

### Pure date and projection logic

- `src/services/service-schedule/date-only.ts` — add or reuse safe year replacement and date comparison helpers; no JavaScript local-time arithmetic.
- `src/services/service-schedule/evaluator.ts` — resolve annual company-date landmarks to the first anniversary on or after the period start.
- `src/services/service-schedule/index.ts` — export any new public date-alignment helper used by tests or projection.
- `src/services/schedule-reconciliation/materialization-policy.ts` — map stable rule codes to `ROLLING_HORIZON` or `AUTHORITATIVE_ANNUAL_BACKLOG` and plan capped authoritative calendar-year cycles.
- `src/services/schedule-reconciliation/projection.ts` — pure orchestration boundary for policy resolution, period evaluation, policy-specific filtering, warnings, and duplicate suppression.
- `src/services/schedule-reconciliation/types.ts` — projection input/output contracts and stable projected-identity types.
- `src/services/schedule-reconciliation/index.ts` — export the canonical projector.

### Preview and reconciliation consumers

- `src/services/client-service/service.ts` — replace local preview planning/evaluation with the canonical projector; return projected deadlines in the impact result.
- `src/services/client-service/types.ts` — expose projected deadline DTOs used by the editor.
- `src/services/schedule-reconciliation/deadline-reconciler.ts` — remove the divergent `accountsDueDate` planner anchor and consume canonical projected periods/occurrences.
- `src/app/api/client-services/[id]/deadline-configuration/impact/route.ts` — retain the existing authorization and validation boundary while returning the expanded impact DTO.

### Editor preview

- `src/components/companies/company-detail/client-service-editor.tsx` — own debounced preview request state and stale-response protection.
- `src/components/companies/company-detail/operational-service-form.tsx` — render canonical projected deadlines supplied by the editor; remove the handwritten deadline calculator.
- `src/components/companies/company-detail/client-service-form-state.ts` — add `deadlineImpactPayload(values, expectedUpdatedAt)` so preview and save serialize the same normalized request object.
- `src/hooks/use-client-services.ts` — add a no-write deadline-impact preview function/hook without changing the save mutation contract.

### Controlled remediation

- `src/services/schedule-reconciliation/remediation.ts` — pure classification plus transactional dry-run/apply service.
- `scripts/remediate-deadline-occurrences.ts` — CLI parser and human-readable/JSON output; dry-run by default.
- `package.json` — add the maintenance script only after service tests exist.

### Tests and documentation

- `__tests__/services/deadline-rule-evaluator.test.ts` — annual source alignment unit coverage.
- `__tests__/services/schedule-reconciliation.test.ts` — exact projection/reconciliation counts, horizon boundaries, and lifecycle preservation.
- `__tests__/services/client-service.service.test.ts` — impact preview contract and preview/apply parity at the service boundary.
- `__tests__/components/operational-service-form.test.tsx` — canonical preview rendering with no local recomputation.
- `__tests__/components/client-service-editor.test.tsx` — debounce, stale response, save fingerprint, and preview error behavior. If this file does not yet exist, create it; do not overload unrelated component tests.
- `__tests__/services/deadline-occurrence-remediation.test.ts` — dry-run, apply, protected-state, audit, fingerprint, and idempotency tests.
- `__tests__/integration/deadline-reconciliation.postgres.test.ts` — database-backed preview/apply parity and exact occurrence identity tests.
- `__tests__/integration/deadline-remediation.postgres.test.ts` — isolated PostgreSQL remediation and rollback-safety coverage.
- `docs/superpowers/specs/2026-08-17-services-administration-deadlines-billing-design.md` — document the clarified rolling-horizon and maintenance-repair invariants.
- `docs/guides/SERVICE_PATTERNS.md` — add the operator runbook, dry-run/apply examples, verification queries, and rollback procedure.

## Public interfaces introduced by this plan

```ts
export type ProjectedDeadlineIdentity = {
  ruleId: string;
  ruleVersionId: string;
  periodKey: string;
  milestoneKey: string;
  scheduleEntryKey: string;
};

export type ProjectedDeadline = ProjectedDeadlineIdentity & {
  deadlineType: 'STATUTORY' | 'CLIENT' | 'INTERNAL';
  calculatedDueDate: DateOnly;
  explanation: string[];
};

export type DeadlineRuleProjectionInput = {
  ruleId: string;
  ruleCode: string;
  ruleVersionId: string;
  recurrence: RuleRecurrenceDefinition;
  applicability: ApplicabilityDefinition;
  parameters: Record<string, unknown>;
  scheduleEntries: ScheduleEntry[];
  milestones: MilestoneDefinition[];
  company: CompanyRuleSource;
  calendar: BusinessCalendarSnapshot;
  today: DateOnly;
  horizonEnd: DateOnly;
};

export type DeadlineRuleProjection = {
  materializationPolicy: DeadlineMaterializationPolicy;
  periods: RollingPeriod[];
  occurrences: ProjectedDeadline[];
  applicability: ApplicabilityResult;
  warnings: DeadlineReconciliationWarning[];
};

export type DeadlineMaterializationPolicy =
  | 'ROLLING_HORIZON'
  | 'AUTHORITATIVE_ANNUAL_BACKLOG';

export const AUTHORITATIVE_BACKLOG_RULE_CODES = new Set([
  'SG_AGM_DUE',
  'SG_ANNUAL_RETURN',
] as const);

export const MAX_AUTHORITATIVE_BACKLOG_CYCLES = 20;

export function deadlineMaterializationPolicyForRule(
  ruleCode: string,
): DeadlineMaterializationPolicy;

export function projectDeadlineRule(
  input: DeadlineRuleProjectionInput,
): DeadlineRuleProjection;
```

The projection function is pure: it performs no Prisma calls, logging, queueing, auditing, or writes. Consumers load data, call the projector, diff against stored state, and decide whether to observe or apply.

The impact API adds this stable response field:

```ts
export type ClientServiceProjectedDeadlineDto = {
  ruleId: string;
  ruleCode: string;
  ruleName: string;
  materializationPolicy: DeadlineMaterializationPolicy;
  periodKey: string;
  milestoneKey: string;
  milestoneName: string;
  scheduleEntryKey: string;
  deadlineType: 'STATUTORY' | 'CLIENT' | 'INTERNAL';
  calculatedDueDate: DateOnly;
  explanation: string[];
};

export type ClientServiceDeadlineImpact = {
  // Existing fingerprint, counts, samples, and warnings remain.
  projectedDeadlines: ClientServiceProjectedDeadlineDto[];
};
```

---

### Task 1: Freeze the regression with exact executable contracts

**Files:**
- Modify: `__tests__/services/deadline-rule-evaluator.test.ts`
- Modify: `__tests__/services/schedule-reconciliation.test.ts`
- Modify: `__tests__/services/client-service.service.test.ts`

**Interfaces:**
- Consumes: existing `evaluateDeadlineRule`, `planRollingPeriods`, `previewClientServiceDeadlineConfiguration`, and `reconcileClientServiceDeadlines` behavior.
- Produces: failing regression tests that define the exact dates, counts, horizon behavior, and preview/apply parity required by Tasks 2–5.

- [ ] **Step 1: Replace the weak fixed-date assertion with exact identities**

Rename the existing test to describe the intended behavior and assert the complete output rather than “one or more” creations:

```ts
it('materializes one in-window anniversary for an annual company-date source', async () => {
  const dbMock = reconciliationDb([], annualAccountsDueRule('2027-07-31'));

  const result = await reconcileClientServiceDeadlines({
    tenantId: 'tenant-1',
    clientServiceId: 'cs-1',
    today: '2026-08-27',
    horizonEnd: '2027-08-27',
    writeMode: 'APPLY',
    reconciliationRequestId: 'req-annual-anniversary',
  }, dbMock as never);

  expect(result.counts).toMatchObject({ created: 1, recalculated: 0 });
  expect(dbMock.serviceCycle.upsert).toHaveBeenCalledTimes(1);
  expect(dbMock.serviceCycle.upsert).toHaveBeenCalledWith(expect.objectContaining({
    create: expect.objectContaining({ periodKey: '2026' }),
  }));
  expect(dbMock.deadlineOccurrence.upsert).toHaveBeenCalledTimes(1);
  expect(dbMock.deadlineOccurrence.upsert.mock.calls[0][0].create.calculatedDueDate)
    .toEqual(new Date('2027-07-31T00:00:00.000Z'));
});
```

- [ ] **Step 2: Add evaluator cases for a month/day before the period start month**

```ts
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
```

- [ ] **Step 3: Add exact AGM/Annual Return authoritative-backlog cases**

Cover `ADD_MONTHS(-1, accountsDueDate)` and assert:

```ts
expect(projectedDates).toEqual([
  { ruleCode: 'SG_AGM_DUE', periodKey: '2024', milestoneKey: 'agm-due', dueDate: '2024-06-30' },
  { ruleCode: 'SG_ANNUAL_RETURN', periodKey: '2024', milestoneKey: 'annual-return-due', dueDate: '2024-07-31' },
  { ruleCode: 'SG_AGM_DUE', periodKey: '2025', milestoneKey: 'agm-due', dueDate: '2025-06-30' },
  { ruleCode: 'SG_ANNUAL_RETURN', periodKey: '2025', milestoneKey: 'annual-return-due', dueDate: '2025-07-31' },
  { ruleCode: 'SG_AGM_DUE', periodKey: '2026', milestoneKey: 'agm-due', dueDate: '2026-06-30' },
  { ruleCode: 'SG_ANNUAL_RETURN', periodKey: '2026', milestoneKey: 'annual-return-due', dueDate: '2026-07-31' },
  { ruleCode: 'SG_AGM_DUE', periodKey: '2027', milestoneKey: 'agm-due', dueDate: '2027-06-30' },
  { ruleCode: 'SG_ANNUAL_RETURN', periodKey: '2027', milestoneKey: 'annual-return-due', dueDate: '2027-07-31' },
]);
expect(projectedDates.every(({ dueDate }) => dueDate <= '2027-08-27')).toBe(true);
```

Run the single-cycle expectation with source year 2027 and the four-cycle expectation with source year 2024. Add a control rule `SG_ECI` using the same source month/day and assert that it produces only its rolling-window occurrence; stable rule code, not expression shape, enables backlog.

- [ ] **Step 4: Add the 20-cycle cap contract**

For `accountsDueDate = 2000-07-31`, `today = 2026-08-27`, and `horizonEnd = 2027-08-27`, assert that each authoritative rule returns the most recent 20 cycle years ending in 2027, excludes the oldest years, and returns:

```ts
expect(projection.warnings).toContainEqual(expect.objectContaining({
  code: 'AUTHORITATIVE_BACKLOG_TRUNCATED',
  ruleId: 'annual-return-rule',
  excludedCycleCount: 8,
  oldestRetainedYear: 2008,
}));
expect(projection.occurrences.at(-1)?.calculatedDueDate).toBe('2027-07-31');
```

The inclusive range 2000–2027 contains 28 cycles, so the exact excluded count is 8 and the retained years are 2008–2027.

- [ ] **Step 5: Add a failing preview/apply parity contract**

Build one fixture shared by `previewClientServiceDeadlineConfiguration` and `reconcileClientServiceDeadlines`. Normalize both outputs to:

```ts
type ComparableOccurrence = {
  ruleId: string;
  periodKey: string;
  milestoneKey: string;
  scheduleEntryKey: string;
  dueDate: string;
};
```

Assert exact set equality, not just equal counts:

```ts
expect(sortComparable(preview.projectedDeadlines)).toEqual(sortComparable(appliedOccurrences));
```

- [ ] **Step 6: Run the focused tests and capture the intended failures**

Run:

```powershell
npm.cmd run test:run -- __tests__/services/deadline-rule-evaluator.test.ts __tests__/services/schedule-reconciliation.test.ts __tests__/services/client-service.service.test.ts --reporter=dot
```

Expected before repair:

- The annual source case returns `2026-07-31` instead of `2027-07-31`.
- The authoritative 2024 source does not produce the exact 2024–2027 AGM/Annual Return backlog in both preview and apply.
- A control annual rule incorrectly gains backlog if policy is inferred from its expression rather than stable code.
- More than 20 source cycles are not capped with a truncation warning.
- Preview/apply tuples differ because preview omits the anchor passed by reconciliation.

- [ ] **Step 7: Commit the red regression contracts**

```powershell
git add -- __tests__/services/deadline-rule-evaluator.test.ts __tests__/services/schedule-reconciliation.test.ts __tests__/services/client-service.service.test.ts
git commit -m "test: reproduce deadline preview reconciliation drift"
```

The commit is intentionally red only when the team workflow permits red commits. If the branch policy requires green commits, retain the tests unstaged and commit them with Task 2.

---

### Task 2: Correct annual company-date alignment in the pure evaluator

**Files:**
- Modify: `src/services/service-schedule/date-only.ts`
- Modify: `src/services/service-schedule/evaluator.ts`
- Modify: `src/services/service-schedule/index.ts`
- Modify: `__tests__/services/service-schedule-date-engine.test.ts`
- Modify: `__tests__/services/deadline-rule-evaluator.test.ts`

**Interfaces:**
- Consumes: `DateOnly`, `RuleRecurrenceDefinition`, and evaluator `period` input.
- Produces: `alignAnnualLandmarkToPeriod(value, periodStart): DateOnly`, used only for annual recurring company landmarks.

- [ ] **Step 1: Add failing date-only alignment tests**

```ts
describe('alignAnnualLandmarkToPeriod', () => {
  it.each([
    ['2027-07-31', '2026-08-01', '2027-07-31'],
    ['2024-07-31', '2026-08-01', '2027-07-31'],
    ['2024-12-31', '2026-08-01', '2026-12-31'],
    ['2024-02-29', '2025-03-01', '2026-02-28'],
  ] as const)('%s from %s becomes %s', (source, periodStart, expected) => {
    expect(alignAnnualLandmarkToPeriod(source, periodStart)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run the date-only tests and verify the missing-export failure**

```powershell
npm.cmd run test:run -- __tests__/services/service-schedule-date-engine.test.ts --reporter=dot
```

Expected: FAIL because `alignAnnualLandmarkToPeriod` is not exported.

- [ ] **Step 3: Implement date-only annual alignment without JavaScript `Date` local-time conversion**

The implementation must:

1. Parse both inputs with `parseDateOnly`.
2. Construct the source month/day in the period-start year using the existing clamped month arithmetic or a new internal `dateOnlyWithYearClamped` helper.
3. If that candidate is before the period start, add 12 months with `addMonthsClamped`.
4. Return a `DateOnly` string.

Target contract:

```ts
export function alignAnnualLandmarkToPeriod(
  sourceDate: DateOnly,
  periodStart: DateOnly,
): DateOnly {
  const candidate = dateOnlyWithYearClamped(sourceDate, Number(periodStart.slice(0, 4)));
  return compareDateOnly(candidate, periodStart) < 0
    ? addMonthsClamped(candidate, 12)
    : candidate;
}
```

Do not copy this code if existing date-only helpers require a different internal shape; preserve their validation and leap-year behavior.

- [ ] **Step 4: Restrict evaluator alignment to annual recurring landmarks**

Replace the current unconditional period-year rewrite with:

```ts
const recurringAnnualCompanyField =
  input.recurrence.kind === 'ANNUALLY'
  && (source.field === 'accountsDueDate' || source.field === 'financialYearEnd');

const resolvedDate = recurringAnnualCompanyField
  ? alignAnnualLandmarkToPeriod(value as DateOnly, input.period.start)
  : value as DateOnly;
```

Required safeguards:

- `ONE_TIME` retains the exact stored company date.
- Monthly, quarterly, semi-annual, and custom rules retain existing semantics until separately specified.
- Provenance continues to record the resolved date used by evaluation. Do not add the stored pre-alignment source date to the snapshot in this repair, because that would expand the persisted hash contract without serving preview/apply parity.

- [ ] **Step 5: Run evaluator and date-engine tests**

```powershell
npm.cmd run test:run -- __tests__/services/service-schedule-date-engine.test.ts __tests__/services/deadline-rule-evaluator.test.ts --reporter=dot
```

Expected: PASS, including the July-after-August boundary and leap-day cases.

- [ ] **Step 6: Commit the evaluator repair**

```powershell
git add -- src/services/service-schedule/date-only.ts src/services/service-schedule/evaluator.ts src/services/service-schedule/index.ts __tests__/services/service-schedule-date-engine.test.ts __tests__/services/deadline-rule-evaluator.test.ts
git commit -m "fix: align annual deadline sources to rolling periods"
```

---

### Task 3: Introduce canonical materialization policy and projection modules

**Files:**
- Create: `src/services/schedule-reconciliation/materialization-policy.ts`
- Create: `src/services/schedule-reconciliation/projection.ts`
- Modify: `src/services/schedule-reconciliation/types.ts`
- Modify: `src/services/schedule-reconciliation/index.ts`
- Modify: `__tests__/services/schedule-reconciliation.test.ts`

**Interfaces:**
- Consumes: `planRollingPeriods`, `evaluateDeadlineRule`, `DateOnly`, rule configuration, normalized company source, and business calendar snapshot.
- Produces: stable-code materialization policy plus `projectDeadlineRule(input): DeadlineRuleProjection` with policy-correct periods, occurrences, applicability, cap warnings, and deterministic ordering.

- [ ] **Step 1: Add failing pure projection tests**

Create tests for:

- Future base date (`2027-07-31`) produces one in-window Annual Return.
- Authoritative base date (`2024-07-31`) produces four Annual Return cycles through `2027-07-31`.
- Authoritative AGM minus one month produces `2024-06-30` through `2027-06-30`.
- `SG_ECI`, `SG_FORM_C`, and a custom rule code resolve to `ROLLING_HORIZON`, even when their expression reads `accountsDueDate`.
- Lowercase, display names, and near-match codes such as `SG_AGM_DUE_CUSTOM` do not enable backlog.
- A 28-cycle authoritative range retains years 2008–2027 and emits one exact truncation warning for the eight excluded cycles.
- The truncated second annual period does not leak a `2028-07-31` occurrence beyond the horizon.
- Duplicate occurrence tuples from adjacent periods are collapsed deterministically.
- Missing-input applicability returns a warning and no occurrences without throwing away other rules at the caller.

Core expectation:

```ts
const common = {
  today: '2026-08-27' as DateOnly,
  horizonEnd: '2027-08-27' as DateOnly,
  accountsDueDate: '2024-07-31' as DateOnly,
};
const occurrences = [
  ...projectDeadlineRule(authoritativeRuleFixture('SG_AGM_DUE', common)).occurrences,
  ...projectDeadlineRule(authoritativeRuleFixture('SG_ANNUAL_RETURN', common)).occurrences,
].sort((left, right) => left.calculatedDueDate.localeCompare(right.calculatedDueDate));

expect(occurrences.map(({ milestoneKey, calculatedDueDate }) => ({
  milestoneKey,
  calculatedDueDate,
}))).toEqual([
  { milestoneKey: 'agm-due', calculatedDueDate: '2024-06-30' },
  { milestoneKey: 'annual-return-due', calculatedDueDate: '2024-07-31' },
  { milestoneKey: 'agm-due', calculatedDueDate: '2025-06-30' },
  { milestoneKey: 'annual-return-due', calculatedDueDate: '2025-07-31' },
  { milestoneKey: 'agm-due', calculatedDueDate: '2026-06-30' },
  { milestoneKey: 'annual-return-due', calculatedDueDate: '2026-07-31' },
  { milestoneKey: 'agm-due', calculatedDueDate: '2027-06-30' },
  { milestoneKey: 'annual-return-due', calculatedDueDate: '2027-07-31' },
]);
```

- [ ] **Step 2: Run the projection tests and verify the missing-module failure**

```powershell
npm.cmd run test:run -- __tests__/services/schedule-reconciliation.test.ts --reporter=dot
```

Expected: FAIL because `projectDeadlineRule` does not exist.

- [ ] **Step 3: Implement stable-code policy resolution**

In `materialization-policy.ts`, implement exact, case-sensitive stable-code resolution:

```ts
export const AUTHORITATIVE_BACKLOG_RULE_CODES = new Set([
  'SG_AGM_DUE',
  'SG_ANNUAL_RETURN',
] as const);

export const MAX_AUTHORITATIVE_BACKLOG_CYCLES = 20;

export function deadlineMaterializationPolicyForRule(
  ruleCode: string,
): DeadlineMaterializationPolicy {
  return AUTHORITATIVE_BACKLOG_RULE_CODES.has(ruleCode as never)
    ? 'AUTHORITATIVE_ANNUAL_BACKLOG'
    : 'ROLLING_HORIZON';
}
```

Do not accept names or normalize arbitrary strings into a privileged code.

- [ ] **Step 4: Implement authoritative calendar-year period planning**

Add a pure planner used only by the authoritative policy:

```ts
export type AuthoritativeBacklogPlan = {
  periods: RollingPeriod[];
  excludedCycleCount: number;
  oldestRetainedYear: number | null;
};

export function planAuthoritativeAnnualBacklog(
  sourceDate: DateOnly,
  horizonEnd: DateOnly,
  maxCycles: number = MAX_AUTHORITATIVE_BACKLOG_CYCLES,
): AuthoritativeBacklogPlan;
```

Algorithm:

1. Use the source year as the first candidate year and the horizon year as the final candidate year.
2. Build inclusive calendar-year periods `YYYY-01-01` through `YYYY-12-31`, clamping only the final period end to `horizonEnd`.
3. If the inclusive count exceeds 20, discard the oldest periods and retain the most recent 20, including the horizon year.
4. Return the excluded count and oldest retained year for the warning.
5. Reject a source date after `horizonEnd` as an empty, non-warning backlog projection rather than fabricating history.

Calendar-year periods ensure both the June AGM and July Annual Return derived from the same July accounts-due source remain in the same statutory cycle year.

- [ ] **Step 5: Implement the pure projector**

Implementation sequence:

1. Validate `today <= horizonEnd` using date-only helpers.
2. Resolve policy from `ruleCode`.
3. For `ROLLING_HORIZON`, call `planRollingPeriods(recurrence, today, horizonEnd)` with no company-date anchor.
4. For `AUTHORITATIVE_ANNUAL_BACKLOG`, require annual recurrence and a valid `company.accountsDueDate`, then call `planAuthoritativeAnnualBacklog(accountsDueDate, horizonEnd, 20)`.
5. If an authoritative rule is non-annual or lacks `accountsDueDate`, return a typed missing-input warning and no occurrences; never fall back silently to rolling behavior.
6. Evaluate each period with the immutable rule/company/calendar inputs.
7. Flatten evaluated occurrences while retaining `periodKey` and `ruleId`.
8. Filter by policy:
   - `ROLLING_HORIZON`: `today <= calculatedDueDate <= horizonEnd`.
   - `AUTHORITATIVE_ANNUAL_BACKLOG`: `calculatedDueDate <= horizonEnd`; the first AGM may precede `accountsDueDate` by one month and is valid.
9. Dedupe using the full tuple:

```ts
const projectionKey = [
  ruleId,
  milestoneKey,
  scheduleEntryKey,
  calculatedDueDate,
].join('|');
```

10. Sort by `calculatedDueDate`, `ruleId`, `milestoneKey`, and `scheduleEntryKey` for deterministic fingerprints and UI rendering.
11. Return all planned periods, including periods with no included occurrence, so reconciliation can clean up obsolete stored cycles safely.
12. When authoritative periods were truncated, add exactly one `AUTHORITATIVE_BACKLOG_TRUNCATED` warning containing `excludedCycleCount` and `oldestRetainedYear`.

Do not include persistence decisions such as `PRESERVE` or `RECALCULATE` in this module.

- [ ] **Step 6: Add invariant assertions at the module boundary**

If an occurrence is later than the horizon, omit it and add a bounded warning only when it represents an unexpected evaluator result rather than a normal truncated final period. For rolling rules, also omit pre-today occurrences. For authoritative backlog rules, retain valid pre-today occurrences from the planned backlog periods.

Use a stable warning code such as:

```ts
{
  code: 'OCCURRENCE_OUTSIDE_ROLLING_HORIZON',
  message: 'Evaluated occurrence was excluded from the rolling horizon',
  ruleId,
  ruleVersionId,
}
```

Avoid including client names, notes, or arbitrary source JSON in warning messages.

- [ ] **Step 7: Run the focused projection suite**

```powershell
npm.cmd run test:run -- __tests__/services/schedule-reconciliation.test.ts __tests__/services/deadline-rule-evaluator.test.ts --reporter=dot
```

Expected: PASS with exact authoritative 2024–2027 backlog, exact rolling-only control output, and capped 20-cycle behavior.

- [ ] **Step 8: Commit the canonical projection boundary**

```powershell
git add -- src/services/schedule-reconciliation/materialization-policy.ts src/services/schedule-reconciliation/projection.ts src/services/schedule-reconciliation/types.ts src/services/schedule-reconciliation/index.ts __tests__/services/schedule-reconciliation.test.ts
git commit -m "refactor: centralize deadline rolling projection"
```

---

### Task 4: Make impact preview and reconciliation consume the same projection

**Files:**
- Modify: `src/services/client-service/service.ts`
- Modify: `src/services/client-service/types.ts`
- Modify: `src/services/schedule-reconciliation/deadline-reconciler.ts`
- Modify: `src/app/api/client-services/[id]/deadline-configuration/impact/route.ts`
- Modify: `__tests__/services/client-service.service.test.ts`
- Modify: `__tests__/services/schedule-reconciliation.test.ts`
- Modify: `__tests__/api/client-service-impact-route.test.ts`

**Interfaces:**
- Consumes: `projectDeadlineRule` from Task 3.
- Produces: identical projected tuples in preview and apply, plus `ClientServiceDeadlineImpact.projectedDeadlines`.

- [ ] **Step 1: Extend failing impact response tests**

Assert that the impact response includes sorted projected deadlines even when the diff action is `NO_CHANGE`:

```ts
expect(impact.projectedDeadlines).toEqual([
  expect.objectContaining({
    ruleId: 'annual-return-rule',
    periodKey: '2026',
    milestoneKey: 'annual-return-due',
    calculatedDueDate: '2027-07-31',
  }),
]);
```

Also assert that `previewFingerprint` changes when any projected identity/date changes and remains stable when only display labels change.

- [ ] **Step 2: Run service and route tests and verify missing response fields**

```powershell
npm.cmd run test:run -- __tests__/services/client-service.service.test.ts __tests__/api/client-service-impact-route.test.ts --reporter=dot
```

Expected: FAIL because `projectedDeadlines` is not returned.

- [ ] **Step 3: Replace preview-local period/evaluator orchestration**

In `previewClientServiceDeadlineConfiguration`:

- Keep tenant-safe loading, rule validation, calendar loading, existing-cycle loading, diff classification, samples, and fingerprint compare-and-swap behavior.
- Replace its direct `planRollingPeriods` and `evaluateDeadlineRule` loops with `projectDeadlineRule`.
- Pass the persisted `DeadlineRule.code` into the projector; never infer authoritative backlog from the rule name or milestone expression.
- Populate `projectedDeadlines` from every canonical projected occurrence, including `NO_CHANGE` occurrences.
- Include sorted projected identities in `previewFingerprint`.
- Preserve the existing limit of 100 diff samples. Return the complete validated 12-month `projectedDeadlines` set; do not reuse the diff-sample cap for the editor projection.

- [ ] **Step 4: Replace reconciler-local anchor planning**

In `reconcileClientServiceDeadlines`:

- Remove:

```ts
const anchorDate = safeDateOnly(companySource.accountsDueDate)
  ?? safeDateOnly(clientService.startDate);
```

- Stop passing `anchorDate` into `planRollingPeriods`.
- Call `projectDeadlineRule` with the same normalized company, calendar, recurrence, configuration, `today`, and `horizonEnd` shape used by preview.
- Pass the same persisted stable rule code used by preview so policy resolution is identical.
- Preserve existing storage diff rules and lifecycle classification.
- Use projected `periodKey` to find/create cycles and projected occurrence tuples to create/recalculate/no-change/preserve.
- When a planned period contains no canonical occurrence, run existing eligible cleanup logic without touching protected states.

- [ ] **Step 5: Correct the `NO_CHANGE` preview action mapping**

The current impact mapping falls through to `PRESERVE` for `NO_CHANGE`. Introduce an impact action union that represents `NO_CHANGE` explicitly, or omit no-change rows from diff samples while retaining them in `projectedDeadlines`. Keep counts truthful:

```ts
if (decision.action === 'NO_CHANGE') counts.noChange += 1;
```

Do not report unchanged occurrences as preserved lifecycle records.

- [ ] **Step 6: Run exact preview/apply parity tests**

```powershell
npm.cmd run test:run -- __tests__/services/client-service.service.test.ts __tests__/services/schedule-reconciliation.test.ts __tests__/api/client-service-impact-route.test.ts --reporter=dot
```

Expected: PASS. The normalized preview tuples must exactly equal the apply tuples for future-source, authoritative-backlog, 20-cycle-cap, and rolling-only control fixtures.

- [ ] **Step 7: Commit the shared-consumer integration**

```powershell
git add -- src/services/client-service/service.ts src/services/client-service/types.ts src/services/schedule-reconciliation/deadline-reconciler.ts src/app/api/client-services/[id]/deadline-configuration/impact/route.ts __tests__/services/client-service.service.test.ts __tests__/services/schedule-reconciliation.test.ts __tests__/api/client-service-impact-route.test.ts
git commit -m "fix: keep deadline preview and reconciliation in parity"
```

---

### Task 5: Replace the handwritten editor calculator with canonical server preview

**Files:**
- Modify: `src/components/companies/company-detail/client-service-editor.tsx`
- Modify: `src/components/companies/company-detail/operational-service-form.tsx`
- Modify: `src/components/companies/company-detail/client-service-form-state.ts`
- Modify: `src/hooks/use-client-services.ts`
- Modify: `__tests__/components/operational-service-form.test.tsx`
- Create: `__tests__/components/client-service-editor.test.tsx`

**Interfaces:**
- Consumes: impact endpoint and `ClientServiceProjectedDeadlineDto` from Task 4.
- Produces: one debounced, stale-safe editor preview state passed into the presentational form.

- [ ] **Step 1: Write failing presentational preview tests**

Render `OperationalServiceForm` with supplied canonical items and assert that it displays the supplied dates verbatim:

```tsx
render(<OperationalServiceForm
  {...baseProps}
  deadlinePreview={{
    state: 'SUCCESS',
    items: [
      projected('agm-due', 'AGM due', '2027-06-30'),
      projected('annual-return-due', 'Annual Return', '2027-07-31'),
    ],
    warnings: [],
  }}
/>);

expect(screen.getByText('30 Jun 2027')).toBeVisible();
expect(screen.getByText('31 Jul 2027')).toBeVisible();
```

Add loading, empty, stale, and error-state expectations. An error must say the preview is unavailable and must not silently fall back to guessed local dates.

For canonical items earlier than the current Singapore date, assert the form renders an `Authoritative backlog` badge. Do not label pre-today items from any other policy as backlog; rolling policy must never return them.

- [ ] **Step 2: Write failing editor orchestration tests**

Use fake timers and mocked `fetch`/hook transport to prove:

- Opening the editor requests a preview for the current values.
- Relevant schedule/rule/company-dependent edits debounce into one request after 300 ms.
- A slower earlier response cannot overwrite a newer response.
- Closing the editor aborts the request.
- Save reuses the latest fingerprint only when it matches the exact submitted payload; otherwise it performs a fresh preview before PATCH.
- Display-name-only edits do not invalidate a still-current deadline fingerprint.

- [ ] **Step 3: Run component tests and confirm they fail against local calculation**

```powershell
npm.cmd run test:run -- __tests__/components/operational-service-form.test.tsx __tests__/components/client-service-editor.test.tsx --reporter=dot
```

Expected: FAIL because the form computes preview dates locally and the editor does not maintain canonical preview state.

- [ ] **Step 4: Add the no-write impact preview transport**

In `use-client-services.ts`, expose a function with an abort signal rather than a mutation that globally invalidates queries:

```ts
export async function previewClientServiceDeadlineImpact(
  id: string,
  input: ClientServiceDeadlineImpactInput,
  signal?: AbortSignal,
): Promise<ClientServiceDeadlineImpact>;
```

Reuse the existing HTTP error normalization. Do not invalidate service, deadline, or roster queries because preview has no writes.

- [ ] **Step 5: Implement editor preview state and payload identity**

Define a discriminated state:

```ts
type DeadlinePreviewState =
  | { state: 'IDLE'; items: []; warnings: [] }
  | { state: 'LOADING'; items: ClientServiceProjectedDeadlineDto[]; warnings: string[] }
  | { state: 'SUCCESS'; items: ClientServiceProjectedDeadlineDto[]; warnings: string[]; fingerprint: string; payloadHash: string }
  | { state: 'ERROR'; items: []; warnings: []; message: string };
```

Compute `payloadHash` from the exact immutable payload already captured for save: expected update timestamp, normalized deadline rules, and schedule snapshot. Abort superseded requests and compare a monotonically increasing request token before setting state.

- [ ] **Step 6: Remove the handwritten deadline calculator**

Delete `calculateActualDeadlinesPreview`, deadline-specific `addMonthsSafe` usage, rule-name heuristics, local accounts-due/FYE fallback branches, and automatic “Overdue Backlog” projection from `operational-service-form.tsx`.

Keep billing preview logic separate; this task does not change billing.

The form should only:

- Sort supplied projected items by `calculatedDueDate` and stable identity.
- Format `DateOnly` with a date-only-safe formatter.
- Render server explanations and warning states.
- Render `Authoritative backlog` for pre-today items whose DTO policy is `AUTHORITATIVE_ANNUAL_BACKLOG`.
- Render the 20-cycle truncation warning prominently rather than hiding it in console output.
- Label the section “Canonical deadline preview” or equivalent copy that does not imply historical remediation.

- [ ] **Step 7: Ensure save uses a fingerprint for the exact submitted payload**

If `deadlinePreview.state === 'SUCCESS'` and its `payloadHash` equals the submit payload hash, reuse its fingerprint. Otherwise, issue one immediate preview request, verify the response, and then PATCH with that fingerprint. Preserve the current conflict and abort handling.

- [ ] **Step 8: Run component and hook tests**

```powershell
npm.cmd run test:run -- __tests__/components/operational-service-form.test.tsx __tests__/components/client-service-editor.test.tsx __tests__/hooks/use-client-services.test.ts --reporter=dot
```

Expected: PASS with no test importing `calculateActualDeadlinesPreview`.

- [ ] **Step 9: Prove the handwritten calculator is gone**

```powershell
rg -n "calculateActualDeadlinesPreview|Overdue Backlog|nameLower.includes\('agm'\)|nameLower.includes\('annual return'\)" src/components/companies/company-detail
```

Expected: no deadline-preview heuristic matches. If “Overdue Backlog” is used elsewhere for persisted deadline status, scope the check to `operational-service-form.tsx`.

- [ ] **Step 10: Commit the canonical editor preview**

```powershell
git add -- src/components/companies/company-detail/client-service-editor.tsx src/components/companies/company-detail/operational-service-form.tsx src/components/companies/company-detail/client-service-form-state.ts src/hooks/use-client-services.ts __tests__/components/operational-service-form.test.tsx __tests__/components/client-service-editor.test.tsx __tests__/hooks/use-client-services.test.ts
git commit -m "fix: render canonical service deadline previews"
```

---

### Task 6: Build fingerprint-gated remediation for existing incorrect occurrences

**Files:**
- Create: `src/services/schedule-reconciliation/remediation.ts`
- Modify: `src/services/schedule-reconciliation/types.ts`
- Modify: `src/services/schedule-reconciliation/index.ts`
- Create: `scripts/remediate-deadline-occurrences.ts`
- Modify: `package.json`
- Create: `__tests__/services/deadline-occurrence-remediation.test.ts`
- Create: `__tests__/integration/deadline-remediation.postgres.test.ts`

**Interfaces:**
- Consumes: canonical projection, stored cycles/occurrences, `createAuditLog`, Prisma serializable transactions.
- Produces: `previewDeadlineOccurrenceRemediation` and `applyDeadlineOccurrenceRemediation` plus a dry-run-first CLI.

```ts
export type DeadlineOccurrenceRemediationInput = {
  tenantId: string;
  clientServiceIds: string[];
  today: DateOnly;
  horizonEnd: DateOnly;
  reason: string;
};

export type DeadlineOccurrenceRemediationAction =
  | { action: 'RECALCULATE'; occurrenceId: string; oldDate: DateOnly; newDate: DateOnly }
  | { action: 'CANCEL'; occurrenceId: string; oldDate: DateOnly; reason: string }
  | { action: 'CREATE'; identity: ProjectedDeadlineIdentity; newDate: DateOnly }
  | { action: 'PRESERVE'; occurrenceId: string; reason: PreserveReason | 'NOT_SELECTED' };

export type DeadlineOccurrenceRemediationPreview = {
  tenantId: string;
  clientServiceIds: string[];
  today: DateOnly;
  horizonEnd: DateOnly;
  fingerprint: string;
  counts: Record<DeadlineOccurrenceRemediationAction['action'], number>;
  actions: DeadlineOccurrenceRemediationAction[];
};
```

- [ ] **Step 1: Write failing dry-run classification tests**

Fixtures must include:

- A matching period/milestone occurrence with an incorrect historical date: classify `RECALCULATE`.
- An extra bug-generated cycle outside canonical projection: classify `CANCEL`.
- A canonical projected occurrence with no stored identity: classify `CREATE`.
- A correct historical authoritative occurrence present in canonical projection: retain it unchanged and do not classify it as an error.
- Completed, Waived, Cancelled, Manual Trigger, and overridden rows: classify `PRESERVE` with no update.
- A row belonging to another tenant or unselected service: never load or mutate it.

Assert dry-run makes no Prisma update/create calls and produces a deterministic fingerprint independent of database return order.

- [ ] **Step 2: Write failing apply safety tests**

Assert:

- Missing `expectedFingerprint` is rejected.
- A mismatched fingerprint returns the existing typed impact-changed conflict.
- Apply reruns preview inside the same serializable transaction before writes.
- Recalculation updates `calculatedDueDate`, `operativeDueDate`, `ruleVersionId`, and `updatedAt` only for eligible rows.
- Cancellation sets `status = CANCELLED`, cancellation timestamp, and a reason beginning `Deadline projection repair:`.
- Creation uses normal occurrence identity constraints and skips duplicates safely.
- One audit log is written per client service with before/after dates and the operator-supplied reason.
- Running apply twice produces zero additional mutations on the second run.

- [ ] **Step 3: Run remediation unit tests and verify missing-module failure**

```powershell
npm.cmd run test:run -- __tests__/services/deadline-occurrence-remediation.test.ts --reporter=dot
```

Expected: FAIL because remediation services do not exist.

- [ ] **Step 4: Implement conservative candidate loading**

Every query includes `tenantId` and `clientServiceId IN selectedIds`. Load only the relations needed by canonical projection and diffing.

Hard eligibility predicate for bypassing Historical preservation:

```ts
const repairable =
  occurrence.origin === 'RULE'
  && occurrence.status === 'OPEN'
  && occurrence.dateOverridden === false;
```

Anything else is returned as `PRESERVE`. Do not add command flags that weaken this predicate.

- [ ] **Step 5: Implement canonical repair classification**

For each selected service:

1. Recompute canonical projections with the fixed engine.
2. Match projected and stored rows first by `ruleId + periodKey + milestoneKey + scheduleEntryKey`.
3. If matched and dates/version differ, emit `RECALCULATE` even when the old operative date is historical.
4. If a canonical projected identity has no stored row, emit `CREATE`.
5. If an eligible stored row has no canonical projected identity, emit `CANCEL`.
6. Emit `PRESERVE` for protected states and include them in the fingerprint.
7. Sort actions by client-service ID, rule ID, period key, milestone key, schedule-entry key, and occurrence ID before hashing.

- [ ] **Step 6: Implement serializable apply and audit**

Apply takes the dry-run fingerprint and actor ID. Inside one serializable transaction per client service:

- Reload and recompute the preview.
- Abort with `IMPACT_CHANGED` if fingerprints differ.
- Apply only the computed actions.
- Write an audit entry with entity type `ClientService`, action `UPDATE`, correlation ID, reason, counts, and exact occurrence before/after snapshots.
- Return the committed fingerprint and counts.

Process selected services independently so one failure does not partially commit another service, and report per-service results.

- [ ] **Step 7: Implement the CLI with safe argument rules**

Add:

```json
"repair:deadlines": "tsx scripts/remediate-deadline-occurrences.ts"
```

Supported usage:

```powershell
npm.cmd run repair:deadlines -- --tenant-id <uuid> --client-service-id <uuid> --client-service-id <uuid> --reason "Correct 2026 annual source alignment"
npm.cmd run repair:deadlines -- --tenant-id <uuid> --client-service-id <uuid> --apply --expected-fingerprint <sha256> --actor-id <uuid> --reason "Correct 2026 annual source alignment"
```

Rules:

- Default mode is dry-run.
- `--tenant-id`, at least one `--client-service-id`, and a reason of at least 10 characters are mandatory.
- `--apply` additionally requires `--expected-fingerprint` and `--actor-id`.
- Reject unknown flags, duplicate IDs after normalization, and more than 25 service IDs per invocation.
- Print JSON containing exact actions and fingerprint in dry-run mode.
- Never print database credentials, full company source snapshots, or unrelated tenant records.
- Exit non-zero on validation, fingerprint conflict, or any failed service.

- [ ] **Step 8: Add isolated PostgreSQL remediation coverage**

Seed the two observed shapes in a disposable schema:

- Future company source with incorrectly shifted 2026 occurrences plus correct duplicate 2027 occurrences; canonical repair leaves only the 2027 source-year AGM and Annual Return open.
- Authoritative 2024 company source with duplicate/misaligned 2024/2025/2026/2027 cycles; canonical repair leaves one open occurrence per rule and statutory year.

Run dry-run, apply, then dry-run again. For the 2024 authoritative source, assert final open rule-generated occurrences are exactly:

```ts
[
  { milestoneKey: 'agm-due', operativeDueDate: '2024-06-30', status: 'OPEN' },
  { milestoneKey: 'annual-return-due', operativeDueDate: '2024-07-31', status: 'OPEN' },
  { milestoneKey: 'agm-due', operativeDueDate: '2025-06-30', status: 'OPEN' },
  { milestoneKey: 'annual-return-due', operativeDueDate: '2025-07-31', status: 'OPEN' },
  { milestoneKey: 'agm-due', operativeDueDate: '2026-06-30', status: 'OPEN' },
  { milestoneKey: 'annual-return-due', operativeDueDate: '2026-07-31', status: 'OPEN' },
  { milestoneKey: 'agm-due', operativeDueDate: '2027-06-30', status: 'OPEN' },
  { milestoneKey: 'annual-return-due', operativeDueDate: '2027-07-31', status: 'OPEN' },
]
```

Assert extra eligible rows are `CANCELLED`, all protected rows are byte-for-byte unchanged, audit rows exist, and the second dry-run has zero `CREATE`, `RECALCULATE`, or `CANCEL` actions.

- [ ] **Step 9: Run remediation tests**

```powershell
npm.cmd run test:run -- __tests__/services/deadline-occurrence-remediation.test.ts --reporter=dot
```

Expected: PASS.

With an isolated `TEST_DATABASE_URL`:

```powershell
npx.cmd vitest run __tests__/integration/deadline-remediation.postgres.test.ts --reporter=dot --maxWorkers=1
```

Expected: PASS without touching the development database.

- [ ] **Step 10: Commit remediation tooling**

```powershell
git add -- src/services/schedule-reconciliation/remediation.ts src/services/schedule-reconciliation/types.ts src/services/schedule-reconciliation/index.ts scripts/remediate-deadline-occurrences.ts package.json __tests__/services/deadline-occurrence-remediation.test.ts __tests__/integration/deadline-remediation.postgres.test.ts
git commit -m "feat: remediate incorrect deadline projections safely"
```

---

### Task 7: Add database-backed parity and concurrency regression coverage

**Files:**
- Modify: `__tests__/integration/deadline-reconciliation.postgres.test.ts`
- Modify: `__tests__/integration/schedule-reconciliation-concurrency.postgres.test.ts`
- Modify: `__tests__/integration/deadline-tenant-isolation.postgres.test.ts`

**Interfaces:**
- Consumes: canonical projection, preview, reconciler, queue worker, and remediation from Tasks 3–6.
- Produces: database evidence that preview/apply parity, identity uniqueness, tenant isolation, and concurrency remain correct.

- [ ] **Step 1: Add the observed future-source PostgreSQL fixture**

Use `today = 2026-08-27`, service start `2026-08-27`, FYE `31 December`, and accounts due `2027-07-31`. Preview, enqueue, process, and query occurrences.

Assert:

```ts
expect(reconciledTuples).toEqual(previewTuples);
expect(reconciledTuples).toEqual([
  ['agm-due', '', '2027-06-30'],
  ['annual-return-due', '', '2027-07-31'],
]);
```

- [ ] **Step 2: Add the authoritative-backlog fixture**

Repeat with accounts due `2024-07-31` for `SG_AGM_DUE` and `SG_ANNUAL_RETURN`. Assert exact preview/apply parity for all eight 2024–2027 tuples listed in Task 6. Add `SG_ECI` as a control and assert it creates no pre-`2026-08-27` occurrence.

- [ ] **Step 3: Add repeat and concurrent execution checks**

Process the same request twice and run two worker claims concurrently. Assert:

- One open occurrence per canonical identity.
- No duplicate service cycles for the same unique key.
- Second run counts are `NO_CHANGE`, not additional `CREATE`.
- Historical backlog is generated only for the two authoritative stable codes; the control rule generates none.
- A 28-cycle source range retains exactly 20 cycles, including 2027, and reports the same truncation warning in preview and apply summaries.

- [ ] **Step 4: Add tenant-isolation assertions for impact projection**

Attempt to preview tenant B's client-service ID with tenant A context. Expect 404 and ensure no rule/company names or projected dates leak in error details.

- [ ] **Step 5: Run PostgreSQL reconciliation matrix**

```powershell
npx.cmd vitest run __tests__/integration/deadline-reconciliation.postgres.test.ts __tests__/integration/schedule-reconciliation-concurrency.postgres.test.ts __tests__/integration/deadline-tenant-isolation.postgres.test.ts --reporter=dot --maxWorkers=1
```

Expected: PASS against an isolated test database.

- [ ] **Step 6: Commit integration coverage**

```powershell
git add -- __tests__/integration/deadline-reconciliation.postgres.test.ts __tests__/integration/schedule-reconciliation-concurrency.postgres.test.ts __tests__/integration/deadline-tenant-isolation.postgres.test.ts
git commit -m "test: verify deadline projection parity in postgres"
```

---

### Task 8: Document operations, rollout, verification, and rollback

**Files:**
- Modify: `docs/superpowers/specs/2026-08-17-services-administration-deadlines-billing-design.md`
- Modify: `docs/guides/SERVICE_PATTERNS.md`
- Modify: `docs/superpowers/plans/2026-08-17-deadline-engine-and-services-workspace.md`

**Interfaces:**
- Consumes: final behavior and maintenance command from Tasks 1–7.
- Produces: durable architectural clarification and an executable operator runbook.

- [ ] **Step 1: Add the clarified architecture decision to the specification**

Document these exact points:

- Default automatic deadline projection is bounded to `[current Singapore date, current Singapore date + 12 months]`.
- `SG_AGM_DUE` and `SG_ANNUAL_RETURN` are the only authoritative backlog exceptions and derive annual cycles from the monthly `Company.accountsDueDate` source.
- Authoritative backlog retains the most recent 20 cycles through the future horizon and emits `AUTHORITATIVE_BACKLOG_TRUNCATED` when older cycles are excluded.
- Company date fields used by annual rules are recurring month/day landmarks aligned to the active rolling period.
- Preview and apply share `projectDeadlineRule` and must be tuple-identical.
- No other rule infers backlog from company fields; use manual historical cycles for all non-authoritative historical deadlines.
- Normal lifecycle preservation remains strict; repair bypass is a separate audited maintenance operation.

- [ ] **Step 2: Amend the original implementation-plan acceptance criteria**

Replace the weak “one or more” fixed-date acceptance language with exact occurrence identity/date requirements and reference this repair plan. Do not rewrite completed historical task checklists; add a dated repair addendum so the record remains understandable.

- [ ] **Step 3: Add the remediation runbook**

The runbook must include:

1. Confirm the application version contains the projection fix before repairing data.
2. Take a database backup using the repository's existing backup procedure.
3. Identify exact tenant and client-service IDs with read-only queries.
4. Run dry-run and archive the JSON output securely.
5. Review every `RECALCULATE`, `CANCEL`, `CREATE`, and `PRESERVE` action.
6. Apply using the exact dry-run fingerprint and an authorized actor ID.
7. Verify open occurrence tuples and audit entries.
8. Rerun dry-run and require zero mutations.
9. Roll back by restoring the database backup if verification fails; do not hand-edit protected lifecycle rows.

Include parameterized query templates rather than hard-coded tenant/service UUIDs.

- [ ] **Step 4: Add rollout gates**

Rollout order:

1. Deploy code with canonical projection and editor preview.
2. Keep deadline worker enabled; no data repair yet.
3. Verify new/edited test service produces exact preview/apply parity.
4. Run remediation dry-run for the two selected affected services.
5. Obtain human review of dry-run actions.
6. Apply one service first as a canary.
7. Verify UI, database tuples, audit, and idempotent second dry-run.
8. Apply the remaining selected service.
9. Monitor reconciliation errors and unexpected preserve/cancel counts for at least one scheduler interval.

- [ ] **Step 5: Commit documentation**

```powershell
git add -- docs/superpowers/specs/2026-08-17-services-administration-deadlines-billing-design.md docs/guides/SERVICE_PATTERNS.md docs/superpowers/plans/2026-08-17-deadline-engine-and-services-workspace.md
git commit -m "docs: clarify deadline projection repair operations"
```

---

### Task 9: Run the final verification matrix before any development-data repair

**Files:**
- No source changes expected.
- Inspect: all files changed by Tasks 1–8.

**Interfaces:**
- Consumes: complete implementation.
- Produces: evidence required to authorize a canary remediation run.

- [ ] **Step 1: Run focused unit and component tests**

```powershell
npm.cmd run test:run -- __tests__/services/service-schedule-date-engine.test.ts __tests__/services/deadline-rule-evaluator.test.ts __tests__/services/schedule-reconciliation.test.ts __tests__/services/client-service.service.test.ts __tests__/services/deadline-occurrence-remediation.test.ts __tests__/api/client-service-impact-route.test.ts __tests__/components/operational-service-form.test.tsx __tests__/components/client-service-editor.test.tsx __tests__/hooks/use-client-services.test.ts --reporter=dot
```

Expected: all listed files pass with zero failures.

- [ ] **Step 2: Run database-backed tests against an isolated database**

```powershell
npx.cmd vitest run __tests__/integration/deadline-reconciliation.postgres.test.ts __tests__/integration/schedule-reconciliation-concurrency.postgres.test.ts __tests__/integration/deadline-tenant-isolation.postgres.test.ts __tests__/integration/deadline-remediation.postgres.test.ts --reporter=dot --maxWorkers=1
```

Expected: all files pass; development and production databases are not used.

- [ ] **Step 3: Run type, lint, and build gates**

```powershell
npx.cmd tsc --noEmit
npm.cmd run lint
npm.cmd run build
```

Expected: exit code 0 for each command, with no new warnings in changed files.

- [ ] **Step 4: Run focused source invariants**

```powershell
rg -n "calculateActualDeadlinesPreview|toBeGreaterThanOrEqual\(1\)" src/components/companies/company-detail __tests__/services/schedule-reconciliation.test.ts
rg -n "planRollingPeriods\(" src/services/client-service/service.ts src/services/schedule-reconciliation/deadline-reconciler.ts
rg -n "projectDeadlineRule" src/services/client-service/service.ts src/services/schedule-reconciliation/deadline-reconciler.ts
```

Expected:

- No handwritten deadline preview calculator.
- No weak exact-once regression assertion.
- No direct divergent planner use in preview/reconciler orchestration.
- Both consumers call `projectDeadlineRule`.

- [ ] **Step 5: Review the final diff for scope and data safety**

```powershell
git status --short
git diff --check
git diff --stat
git diff -- src/services/service-schedule src/services/schedule-reconciliation src/services/client-service src/components/companies/company-detail scripts/remediate-deadline-occurrences.ts package.json docs __tests__
```

Verify manually:

- No unrelated files changed.
- No database credentials or real tenant/service IDs were committed.
- No destructive SQL migration was added.
- Normal Historical preservation still exists and is covered.
- Remediation is dry-run by default and apply requires fingerprint plus actor.

- [ ] **Step 6: Produce the canary dry-run without applying**

Only after Steps 1–5 pass, run the maintenance command against the intended environment with exact selected IDs and no `--apply`. Save the JSON output outside the repository or in the approved operational evidence store.

Expected for each affected Corporate Secretarial service:

- One open AGM occurrence at `2027-06-30` after proposed actions.
- One open Annual Return occurrence at `2027-07-31` after proposed actions.
- Incorrect unmatched eligible occurrences proposed for cancellation.
- Protected records proposed only as `PRESERVE`.
- No write occurs.

- [ ] **Step 7: Stop for human approval before data mutation**

Present the dry-run fingerprint, action counts, selected service IDs, and protected-record counts. Do not run `--apply` until the user explicitly approves the exact dry-run.

---

## Completion criteria

Implementation is complete only when all of the following are evidenced:

- The July-after-August reproduction returns `2027-07-31`, never `2026-07-31`.
- Future and stale source years project to the same correct in-window anniversary.
- AGM and Annual Return each produce exactly one canonical occurrence in the test window.
- No automatic occurrence is created before `today` or after `horizonEnd`.
- Client-service impact preview and write reconciliation produce identical normalized tuples.
- The editor renders server-projected dates and has no deadline rule-name/date heuristics.
- Normal reconciliation still preserves every protected lifecycle category.
- Remediation is tenant-scoped, selected-service-scoped, dry-run-first, fingerprint-gated, audited, and idempotent.
- PostgreSQL concurrency and tenant-isolation tests pass.
- Typecheck, lint, build, focused tests, and integration tests pass.
- The operator runbook contains backup, dry-run, canary, verification, idempotency, and rollback steps.
- No remediation apply has occurred without a separately reviewed dry-run and explicit user approval.

## Recommended execution order

Tasks 1–5 form the code repair and user-visible consistency release. Task 6 adds the controlled data-repair mechanism. Task 7 provides database confidence, Task 8 updates durable documentation, and Task 9 is the release/remediation gate. Do not remediate existing records before Tasks 1–5 are deployed; otherwise the still-divergent worker can recreate or preserve the same incorrect state.
