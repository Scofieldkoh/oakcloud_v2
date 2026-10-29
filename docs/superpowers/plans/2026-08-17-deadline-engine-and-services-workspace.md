# Deadline Engine and Services Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared, versioned schedule engine and reconciliation pipeline, then expose cross-company Services and Deadline table/calendar workflows with manual historical triggering.

**Architecture:** A constrained schedule/date-expression package performs pure date and applicability evaluation for every service family. Immutable published rule versions feed durable, idempotent reconciliation requests that materialize `ServiceCycle` and `DeadlineOccurrence` records; operational APIs query only companies the session may access. React surfaces reuse the Company table and user-preference patterns, while Administration gains rule and business-calendar tabs.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Prisma 7/PostgreSQL, Zod, React Query, date-fns 4, React DayPicker 9, node-cron scheduler, Vitest, Testing Library, Vitest Browser/Playwright.

**Spec:** `docs/superpowers/specs/2026-08-17-services-administration-deadlines-billing-design.md`

**Mockups:** `docs/superpowers/mockups/2026-08-17-services-workspace-mockups.md` — implement views 1, 2, 3, 6, and 7.

## Global Constraints

- Complete `docs/superpowers/plans/2026-08-17-services-administration-foundation.md` first; this plan consumes `getCompanyDisplayLabel`, family colors, relocated catalog components, and `requireServiceAdministrator`.
- Read the approved specification and all three repository guides before editing.
- Preserve unrelated changes and use additive migrations only.
- Use one generic repeatable schedule language for every service family and later billing schedules. Never add payroll-only schedule code.
- A client-service rule accepts zero to 31 schedule entries with stable keys; reordering cannot change occurrence identity.
- Dates are date-only values evaluated against `Asia/Singapore`; browser/server local time zones must not alter a due date.
- Company stored AGM, Annual Return, and accounts due dates take precedence over fallback expressions.
- Rule edits, Company changes, and calendar changes affect only future, open, rule-generated, non-overridden occurrences.
- Historical, Completed, Waived, Cancelled, Manual Trigger, and overridden occurrences are preserved.
- Manual historical cycles never create billing occurrences.
- Deadline types are exactly `STATUTORY`, `CLIENT`, and `INTERNAL`.
- Stored deadline states are exactly `OPEN`, `COMPLETED`, `WAIVED`, and system-only `CANCELLED`; Upcoming/Due/Overdue are derived.
- Operational list queries apply accessible-company predicates in SQL, never after loading tenant-wide results.
- Administration requires Tenant Admin/Super Admin; operational writes require `company:update` for the affected Company.
- Materialize from the current Singapore date through a rolling 12-month horizon.
- Use test-driven steps and the listed commit after every task passes.

---

## File and responsibility map

### Shared schedule engine

- `src/lib/validations/service-schedule.ts` — schema-versioned schedule, recurrence, expression, and applicability Zod schemas.
- `src/services/service-schedule/types.ts` — inferred public engine contracts.
- `src/services/service-schedule/date-only.ts` — date-only parse/format/month arithmetic and Singapore current date.
- `src/services/service-schedule/business-days.ts` — holiday/weekend checks and business-day arithmetic.
- `src/services/service-schedule/applicability.ts` — bounded, whitelisted Company predicates.
- `src/services/service-schedule/evaluator.ts` — pure cycle/schedule/milestone evaluator and explanation output.
- `src/services/service-schedule/hash.ts` — canonical JSON/config/evaluation hashes.
- `src/services/service-schedule/index.ts` — public exports consumed by deadline and billing plans.

### Rule, calendar, and reconciliation services

- `src/lib/validations/deadline-rule.ts` — draft, association, preview, publish, and archive inputs.
- `src/lib/validations/deadline.ts` — operational list, mutation, and manual-cycle inputs.
- `src/services/deadline-rule/types.ts` — DTOs and impact result.
- `src/services/deadline-rule/service.ts` — rule draft/version/association persistence.
- `src/services/deadline-rule/impact.ts` — preview/publish/archive impact orchestration.
- `src/services/deadline-rule/index.ts` — exports.
- `src/services/business-calendar/service.ts` — calendar/holiday CRUD and impact.
- `src/services/business-calendar/index.ts` — exports.
- `src/services/schedule-reconciliation/types.ts` — queue/claim/result contracts.
- `src/services/schedule-reconciliation/queue.ts` — transactional deduplicated enqueue.
- `src/services/schedule-reconciliation/deadline-reconciler.ts` — occurrence diff/persist rules.
- `src/services/schedule-reconciliation/worker.ts` — lease, retry, batch, and rolling horizon.
- `src/services/schedule-reconciliation/settings.ts` — workspace/observation-mode flags from `Workspace.settings` and environment.
- `src/services/schedule-reconciliation/index.ts` — exports.
- `src/lib/scheduler/tasks/service-schedule-reconciliation.task.ts` — scheduler registration.

### Operational services and APIs

- `src/services/service-roster/types.ts` and `service.ts` — cross-company roster DTO/query.
- `src/services/deadline/types.ts`, `service.ts`, and `manual-cycle.ts` — deadline list/lifecycle/manual trigger.
- `src/app/api/client-services/route.ts` — cross-company roster GET.
- `src/app/api/client-services/[id]/deadline-configuration/impact/route.ts` — client-rule edit preview.
- `src/app/api/deadlines/route.ts` — deadline table/calendar GET.
- `src/app/api/deadlines/[id]/route.ts` — detail/PATCH.
- `src/app/api/deadlines/[id]/reset-date-override/route.ts` — reset override.
- `src/app/api/client-services/[id]/deadline-cycles/preview/route.ts` — manual preview.
- `src/app/api/client-services/[id]/deadline-cycles/route.ts` — manual apply.
- `src/app/api/services/settings/route.ts` — authenticated workspace feature state.

### Administration APIs

- `src/app/api/service-catalog/deadline-rules/route.ts`
- `src/app/api/service-catalog/deadline-rules/[id]/route.ts`
- `src/app/api/service-catalog/deadline-rules/[id]/impact/route.ts`
- `src/app/api/service-catalog/deadline-rules/[id]/publish/route.ts`
- `src/app/api/service-catalog/deadline-rules/[id]/archive/route.ts`
- `src/app/api/service-calendars/route.ts`
- `src/app/api/service-calendars/[id]/route.ts`
- `src/app/api/service-calendars/[id]/impact/route.ts`

### UI and hooks

- `src/app/(dashboard)/services/page.tsx` — operational route.
- `src/components/services/services-workspace.tsx` — URL-backed tabs.
- `src/components/services/shared/family-filter-chips.tsx` — color/text family filter shared by views.
- `src/components/services/shared/schedule-entry-editor.tsx` — generic repeatable-list editor.
- `src/components/services/roster/service-roster.tsx`, `service-roster-table.tsx`, and `service-roster-filters.tsx`.
- `src/components/services/deadlines/deadline-workspace.tsx`, `deadline-table.tsx`, `deadline-calendar.tsx`, `deadline-filters.tsx`, `deadline-event.tsx`, and `manual-cycle-dialog.tsx`.
- `src/components/services/admin/deadline-rules-panel.tsx`, `deadline-rule-form.tsx`, `business-calendar-panel.tsx`, and `rule-impact-dialog.tsx`.
- `src/hooks/use-service-roster.ts`, `use-deadlines.ts`, `use-deadline-rules.ts`, and `use-service-calendars.ts`.
- `src/hooks/use-services-workspace-settings.ts` — operational page/sidebar feature state.

### Database and tests

- `prisma/migrations/20260817100000_deadline_rule_engine/migration.sql` — deadline models, constraints, partial claim indexes, and default calendars.
- `prisma/migrations/20260817101000_deadline_rule_starter_drafts/migration.sql` — idempotent unpublished starter drafts for existing tenants.
- Focused tests under `__tests__/lib`, `__tests__/services`, `__tests__/api`, `__tests__/components`, `__tests__/browser`, and `__tests__/integration` named by each task.

## Public interfaces produced by this plan

```ts
export type DateOnly = `${number}-${number}-${number}`;

export type BusinessDayAdjustment = 'NONE' | 'PREVIOUS' | 'NEXT';

export type DateSource =
  | { kind: 'COMPANY_FIELD'; field: 'financialYearEnd' | 'accountsDueDate' | 'incorporationDate' }
  | { kind: 'CYCLE_START' | 'CYCLE_END' }
  | { kind: 'PARAMETER'; key: string }
  | { kind: 'SCHEDULE_ENTRY'; key: string }
  | { kind: 'MILESTONE'; key: string };

export type ScheduleEntry = {
  key: string;
  label: string;
  expression:
    | { kind: 'DAY_OF_MONTH'; day: number }
    | { kind: 'BUSINESS_DAY_FROM_START'; ordinal: number }
    | { kind: 'BUSINESS_DAY_FROM_END'; ordinal: number }
    | {
        kind: 'RELATIVE_TO_SOURCE';
        source: DateSource;
        offset: number;
        unit: 'CALENDAR_DAY' | 'BUSINESS_DAY';
      };
  businessDayAdjustment: BusinessDayAdjustment;
};

export type EnqueueScheduleReconciliationInput = {
  tenantId: string;
  scopeType: 'TENANT' | 'COMPANY' | 'CLIENT_SERVICE' | 'RULE' | 'BUSINESS_CALENDAR';
  scopeId: string;
  triggerType: string;
  correlationId: string;
  requestedById: string | null;
  notBefore?: Date;
};

export async function enqueueScheduleReconciliation(
  tx: Prisma.TransactionClient,
  input: EnqueueScheduleReconciliationInput,
): Promise<{ id: string; dedupeKey: string }>;

export async function reconcileClientServiceDeadlines(input: {
  tenantId: string;
  clientServiceId: string;
  today: DateOnly;
  horizonEnd: DateOnly;
  writeMode: 'OBSERVE' | 'APPLY';
  reconciliationRequestId: string;
}): Promise<DeadlineReconciliationResult>;
```

Plan 3 imports the `ScheduleEntry` schemas/date engine, reconciliation enqueue contract, and rolling-horizon helpers. It must not implement a second scheduler or date language.

---

### Task 1: Add the deadline-rule and occurrence schema

**Files:**
- Create: `prisma/migrations/20260817100000_deadline_rule_engine/migration.sql`
- Create: `__tests__/services/deadline-engine-schema.test.ts`
- Modify: `prisma/schema.prisma`
- Modify: `src/lib/errors.ts`

**Interfaces:**
- Consumes: existing Workspace, User, Company, ServiceVariant, and ClientService records.
- Produces: versioned rule, calendar, client-rule, cycle, occurrence, and reconciliation models.

- [ ] **Step 1: Write the failing schema contract test**

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('deadline engine schema', () => {
  const schema = readFileSync(resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8');
  const migration = readFileSync(
    resolve(process.cwd(), 'prisma/migrations/20260817100000_deadline_rule_engine/migration.sql'),
    'utf8',
  );

  it.each([
    'DeadlineRule', 'DeadlineRuleVersion', 'DeadlineRuleParameterDefinition',
    'DeadlineMilestoneTemplate', 'ServiceVariantDeadlineRule',
    'ClientServiceDeadlineRule', 'BusinessCalendar', 'BusinessHoliday',
    'ServiceCycle', 'DeadlineOccurrence', 'ServiceScheduleReconciliationRequest',
  ])('defines model %s', (name) => expect(schema).toContain(`model ${name}`));

  it('uses partial indexes for one draft and queue claims', () => {
    expect(migration).toContain('deadline_rule_versions_one_draft_idx');
    expect(migration).toContain('service_schedule_reconciliation_claim_idx');
    expect(migration).toContain("WHERE \"state\" = 'DRAFT'");
    expect(migration).toContain("WHERE \"status\" IN ('PENDING', 'FAILED')");
  });
});
```

- [ ] **Step 2: Run the schema test and confirm missing-model failure**

Run: `npm.cmd run test:run -- __tests__/services/deadline-engine-schema.test.ts`

Expected: FAIL because the migration and models do not exist.

- [ ] **Step 3: Define the Prisma enums and models**

Use these enums exactly:

```prisma
enum DeadlineRuleVersionState { DRAFT PUBLISHED }
enum DeadlineParameterType { DATE INTEGER DECIMAL STRING BOOLEAN ENUM }
enum DeadlineMilestoneGenerationMode { ONCE_PER_CYCLE ONCE_PER_SCHEDULE_ENTRY }
enum BusinessDayAdjustment { NONE PREVIOUS NEXT }
enum DeadlineApplicabilityState { APPLICABLE NOT_APPLICABLE MISSING_INPUT }
enum ServiceCycleOrigin { RULE MANUAL_TRIGGER }
enum DeadlineType { STATUTORY CLIENT INTERNAL }
enum DeadlineOccurrenceStatus { OPEN COMPLETED WAIVED CANCELLED }
enum ScheduleReconciliationScopeType { TENANT COMPANY CLIENT_SERVICE RULE BUSINESS_CALENDAR }
enum ScheduleReconciliationStatus { PENDING PROCESSING COMPLETED FAILED }
```

Implement the models and fields from specification section 10. Required identity constraints are:

```prisma
model ServiceCycle {
  // IDs, tenant relations, dates, snapshots, hashes, and audit fields
  periodKey     String
  generationKey String
  origin        ServiceCycleOrigin
  @@unique([tenantId, clientServiceId, ruleId, periodKey, generationKey, origin])
  @@index([tenantId, companyId, periodStart, periodEnd])
}

model DeadlineOccurrence {
  // IDs, dates, status, override/completion/cancellation metadata
  milestoneKey    String
  scheduleEntryKey String @default("")
  calculatedDueDate DateTime @db.Date
  operativeDueDate  DateTime @db.Date
  status DeadlineOccurrenceStatus @default(OPEN)
  @@unique([tenantId, cycleId, milestoneKey, scheduleEntryKey])
  @@index([tenantId, operativeDueDate, status])
  @@index([tenantId, companyId, operativeDueDate, status])
  @@index([tenantId, clientServiceId, operativeDueDate])
}
```

`ServiceScheduleReconciliationRequest` includes `dedupeKey @unique`, `status`, `attemptCount`, `leaseOwner`, `leaseExpiresAt`, `nextAttemptAt`, `lastErrorCode`, `lastErrorMessage`, lifecycle timestamps, summary JSON, actor, and correlation ID.

Add all inverse relations to Workspace, User, Company, ServiceVariant, and ClientService. Use `Restrict` for historical source references and `Cascade` only for version-owned draft child rows whose parent cannot have materialized history.

- [ ] **Step 4: Add migration-managed constraints and indexes**

The migration must add:

```sql
CREATE UNIQUE INDEX "deadline_rule_versions_one_draft_idx"
ON "deadline_rule_versions" ("rule_id")
WHERE "state" = 'DRAFT';

CREATE INDEX "service_schedule_reconciliation_claim_idx"
ON "service_schedule_reconciliation_requests" ("next_attempt_at", "id")
WHERE "status" IN ('PENDING', 'FAILED');

CREATE INDEX "service_schedule_reconciliation_expired_lease_idx"
ON "service_schedule_reconciliation_requests" ("lease_expires_at", "id")
WHERE "status" = 'PROCESSING';
```

Add these consistency constraints; use the migration's actual snake-case column names:

```sql
ALTER TABLE "deadline_occurrences"
  ADD CONSTRAINT "deadline_occurrences_override_consistency"
  CHECK (
    ("date_overridden" = FALSE AND "date_override_reason" IS NULL AND "date_overridden_at" IS NULL AND "date_overridden_by_id" IS NULL)
    OR
    ("date_overridden" = TRUE AND "date_override_reason" IS NOT NULL AND "date_overridden_at" IS NOT NULL AND "date_overridden_by_id" IS NOT NULL)
  ),
  ADD CONSTRAINT "deadline_occurrences_completion_consistency"
  CHECK (("status" = 'COMPLETED') = ("completed_at" IS NOT NULL)),
  ADD CONSTRAINT "deadline_occurrences_waiver_consistency"
  CHECK (("status" = 'WAIVED') = ("waived_at" IS NOT NULL AND "waiver_reason" IS NOT NULL)),
  ADD CONSTRAINT "deadline_occurrences_cancellation_consistency"
  CHECK (("status" = 'CANCELLED') = ("cancelled_at" IS NOT NULL AND "cancellation_reason" IS NOT NULL)),
  ADD CONSTRAINT "deadline_occurrences_stable_keys_nonempty"
  CHECK (length("milestone_key") > 0);

ALTER TABLE "service_cycles"
  ADD CONSTRAINT "service_cycles_generation_key_nonempty"
  CHECK (length("generation_key") > 0);
```

Do not duplicate the partial indexes as Prisma `@@index` declarations. Seed one active Singapore calendar per existing tenant with `Asia/Singapore`, revision 1, and weekend days `[0, 6]`; holiday rows are maintained through Administration rather than guessed by the migration.

- [ ] **Step 5: Add structured application error codes**

Extend `ErrorCodes` with:

```ts
VERSION_CONFLICT: 'VERSION_CONFLICT',
IMPACT_CHANGED: 'IMPACT_CHANGED',
RULE_NOT_APPLICABLE: 'RULE_NOT_APPLICABLE',
MISSING_RULE_INPUT: 'MISSING_RULE_INPUT',
SCHEDULE_LIMIT_EXCEEDED: 'SCHEDULE_LIMIT_EXCEEDED',
DUPLICATE_SCHEDULE_ENTRY: 'DUPLICATE_SCHEDULE_ENTRY',
OCCURRENCE_IMMUTABLE: 'OCCURRENCE_IMMUTABLE',
RECONCILIATION_PENDING: 'RECONCILIATION_PENDING',
```

Add an `ApiError` subclass accepting one of these codes and an explicit 409 or 422 status so services return typed errors through `createErrorResponse`.

- [ ] **Step 6: Generate Prisma and run schema tests**

Run: `npm.cmd run db:generate`

Expected: PASS.

Run: `npm.cmd run test:run -- __tests__/services/deadline-engine-schema.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit the deadline schema**

```bash
git add prisma/schema.prisma prisma/migrations/20260817100000_deadline_rule_engine/migration.sql src/generated/prisma src/lib/errors.ts __tests__/services/deadline-engine-schema.test.ts
git commit -m "feat: add deadline rule and occurrence schema"
```

---

### Task 2: Implement the shared schedule schemas and date-only engine

**Files:**
- Create: `src/lib/validations/service-schedule.ts`
- Create: `src/services/service-schedule/types.ts`
- Create: `src/services/service-schedule/date-only.ts`
- Create: `src/services/service-schedule/business-days.ts`
- Create: `src/services/service-schedule/hash.ts`
- Create: `src/services/service-schedule/index.ts`
- Create: `__tests__/lib/service-schedule-validation.test.ts`
- Create: `__tests__/services/service-schedule-date-engine.test.ts`

**Interfaces:**
- Consumes: `DateOnly`, schedule, and adjustment concepts in the public contract.
- Produces: schemas/types plus deterministic date and business-day functions used by Tasks 3–15 and Plan 3.

- [ ] **Step 1: Write failing validation tests for generic repeatable lists**

```ts
import { describe, expect, it } from 'vitest';
import { scheduleEntriesSchema } from '@/lib/validations/service-schedule';

describe('generic service schedule entries', () => {
  it('accepts more than two dates for any family', () => {
    const entries = Array.from({ length: 4 }, (_, index) => ({
      key: `entry-${index + 1}`,
      label: `Run ${index + 1}`,
      expression: { kind: 'DAY_OF_MONTH', day: index + 1 },
      businessDayAdjustment: 'NONE',
    }));
    expect(scheduleEntriesSchema.parse(entries)).toHaveLength(4);
  });

  it('rejects duplicate keys and more than thirty-one entries', () => {
    const duplicate = { key: 'same', label: 'Same', expression: { kind: 'DAY_OF_MONTH', day: 1 }, businessDayAdjustment: 'NONE' };
    expect(() => scheduleEntriesSchema.parse([duplicate, duplicate])).toThrow('unique');
    expect(() => scheduleEntriesSchema.parse(Array.from({ length: 32 }, (_, i) => ({ ...duplicate, key: `k-${i}` })))).toThrow('31');
  });
});
```

- [ ] **Step 2: Write failing date/business-day tests**

```ts
it('clamps day 31 to February month end', () => {
  expect(dayOfMonth('2028-02-01', 31)).toBe('2028-02-29');
});

it('returns the second-last Singapore business day', () => {
  const calendar = {
    id: 'sg-calendar', timeZone: 'Asia/Singapore', revision: 1,
    holidays: new Set<DateOnly>(['2026-08-31']), weekendDays: new Set([0, 6]),
  };
  expect(businessDayFromEnd('2026-08-01', '2026-08-31', 2, calendar))
    .toBe('2026-08-27');
});
```

- [ ] **Step 3: Run tests and confirm missing modules**

Run: `npm.cmd run test:run -- __tests__/lib/service-schedule-validation.test.ts __tests__/services/service-schedule-date-engine.test.ts`

Expected: FAIL because the schedule package does not exist.

- [ ] **Step 4: Implement versioned Zod schemas**

Define discriminated unions for schedule entries, date sources, date operations, recurrence, milestone expressions, and bounded applicability groups. The stable schedule schema is:

```ts
const scheduleEntrySchema = z.object({
  key: z.string().trim().regex(/^[a-z][a-z0-9-]{0,63}$/),
  label: z.string().trim().min(1).max(100),
  expression: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('DAY_OF_MONTH'), day: z.number().int().min(1).max(31) }),
    z.object({ kind: z.literal('BUSINESS_DAY_FROM_START'), ordinal: z.number().int().min(1).max(31) }),
    z.object({ kind: z.literal('BUSINESS_DAY_FROM_END'), ordinal: z.number().int().min(1).max(31) }),
    z.object({
      kind: z.literal('RELATIVE_TO_SOURCE'),
      source: dateSourceSchema,
      offset: z.number().int().min(-3660).max(3660),
      unit: z.enum(['CALENDAR_DAY', 'BUSINESS_DAY']),
    }),
  ]),
  businessDayAdjustment: z.enum(['NONE', 'PREVIOUS', 'NEXT']),
}).strict();

export const scheduleEntriesSchema = z.array(scheduleEntrySchema).max(31).superRefine((entries, ctx) => {
  const seen = new Set<string>();
  for (const [index, entry] of entries.entries()) {
    if (seen.has(entry.key)) ctx.addIssue({ code: 'custom', path: [index, 'key'], message: 'Schedule entry keys must be unique' });
    seen.add(entry.key);
  }
});
```

Company date sources are whitelisted to `financialYearEnd`, `accountsDueDate`, `incorporationDate`, cycle boundaries, typed parameters, schedule-entry keys, and prior milestone keys.

- [ ] **Step 5: Implement UTC-backed date-only arithmetic**

Expose these exact functions:

```ts
export function parseDateOnly(value: DateOnly): Date;
export function formatDateOnly(value: Date): DateOnly;
export function currentDateInSingapore(now?: Date): DateOnly;
export function addCalendarDays(value: DateOnly, amount: number): DateOnly;
export function addMonthsClamped(value: DateOnly, amount: number): DateOnly;
export function dayOfMonth(periodMonth: DateOnly, day: number): DateOnly;
export function compareDateOnly(left: DateOnly, right: DateOnly): number;
```

Use `Date.UTC`, UTC getters/setters, and `Intl.DateTimeFormat(..., { timeZone: 'Asia/Singapore' }).formatToParts()` for the current business date. Never parse `YYYY-MM-DD` through a locale-dependent constructor.

- [ ] **Step 6: Implement business-day arithmetic**

```ts
export type BusinessCalendarSnapshot = {
  id: string;
  timeZone: 'Asia/Singapore' | string;
  weekendDays: ReadonlySet<number>;
  holidays: ReadonlySet<DateOnly>;
  revision: number;
};

export function isBusinessDay(value: DateOnly, calendar: BusinessCalendarSnapshot): boolean;
export function addBusinessDays(value: DateOnly, amount: number, calendar: BusinessCalendarSnapshot): DateOnly;
export function businessDayFromStart(periodStart: DateOnly, periodEnd: DateOnly, ordinal: number, calendar: BusinessCalendarSnapshot): DateOnly;
export function businessDayFromEnd(periodStart: DateOnly, periodEnd: DateOnly, ordinal: number, calendar: BusinessCalendarSnapshot): DateOnly;
export function adjustBusinessDay(value: DateOnly, adjustment: BusinessDayAdjustment, calendar: BusinessCalendarSnapshot): DateOnly;
```

Throw a typed validation error when an ordinal cannot be resolved inside its period.

- [ ] **Step 7: Add canonical hashes and run tests**

Canonicalize object keys recursively while preserving schedule-array order, then SHA-256 the JSON. Export `hashConfiguration(value: unknown): string`.

Run: `npm.cmd run test:run -- __tests__/lib/service-schedule-validation.test.ts __tests__/services/service-schedule-date-engine.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit the shared schedule engine foundation**

```bash
git add src/lib/validations/service-schedule.ts src/services/service-schedule __tests__/lib/service-schedule-validation.test.ts __tests__/services/service-schedule-date-engine.test.ts
git commit -m "feat: add generic service schedule date engine"
```

---

### Task 3: Implement applicability and pure rule evaluation

**Files:**
- Create: `src/services/service-schedule/applicability.ts`
- Create: `src/services/service-schedule/evaluator.ts`
- Modify: `src/services/service-schedule/index.ts`
- Create: `__tests__/services/deadline-rule-evaluator.test.ts`

**Interfaces:**
- Consumes: Task 2 schedule/date functions and validated rule definitions.
- Produces: `evaluateApplicability` and `evaluateDeadlineRule`, with no database writes.

- [ ] **Step 1: Write failing applicability and precedence tests**

```ts
it('marks XBRL inapplicable to an exempt private company', () => {
  expect(evaluateApplicability({
    kind: 'FIELD_NOT_IN', field: 'entityType', values: ['EXEMPTED_PRIVATE_LIMITED'],
  }, { entityType: 'EXEMPTED_PRIVATE_LIMITED' })).toEqual({
    state: 'NOT_APPLICABLE', reason: expect.stringContaining('entityType'),
  });
});

it('uses a stored AGM due date before its fallback expression', () => {
  const result = evaluateDeadlineRule(agmInput({
    company: { accountsDueDate: '2027-06-30', financialYearEnd: '2026-12-31' },
  }));
  expect(result.occurrences[0]).toMatchObject({
    calculatedDueDate: '2027-05-31',
    explanation: expect.arrayContaining([expect.stringContaining('Company.accountsDueDate')]),
  });
});
```

- [ ] **Step 2: Write failing multi-entry and dependency tests**

```ts
it.each(['PAYROLL', 'ACCOUNTING'])('evaluates four repeatable entries for %s', (familyCode) => {
  const result = evaluateDeadlineRule(multiEntryInput(familyCode));
  expect(result.occurrences.filter((item) => item.milestoneKey === 'service-run')).toHaveLength(4);
});

it('evaluates a client deadline three business days before a schedule anchor', () => {
  const result = evaluateDeadlineRule(relativeMilestoneInput());
  expect(result.byKey['funding-deadline:salary-payout']?.calculatedDueDate).toBe('2026-08-25');
});

it('rejects circular milestone dependencies', () => {
  expect(() => evaluateDeadlineRule(circularMilestoneInput())).toThrow('circular');
});
```

- [ ] **Step 3: Run evaluator tests and verify failure**

Run: `npm.cmd run test:run -- __tests__/services/deadline-rule-evaluator.test.ts`

Expected: FAIL because evaluator functions do not exist.

- [ ] **Step 4: Implement bounded applicability**

```ts
export type ApplicabilityResult =
  | { state: 'APPLICABLE'; reason: null }
  | { state: 'NOT_APPLICABLE'; reason: string }
  | { state: 'MISSING_INPUT'; reason: string; missingFields: string[] };

export function evaluateApplicability(
  definition: ApplicabilityDefinition,
  company: CompanyRuleSource,
): ApplicabilityResult;
```

Support the whitelisted predicates from specification section 11.5, with maximum nesting depth 5 and maximum 50 leaf predicates. Missing values return `MISSING_INPUT` only when the predicate requires that value; an explicit `FIELD_MISSING` predicate can evaluate normally.

- [ ] **Step 5: Implement the pure evaluator**

```ts
export type DeadlineRuleEvaluationInput = {
  ruleId: string;
  ruleVersionId: string;
  recurrence: RuleRecurrenceDefinition;
  applicability: ApplicabilityDefinition;
  parameters: Record<string, unknown>;
  scheduleEntries: ScheduleEntry[];
  milestones: MilestoneDefinition[];
  company: CompanyRuleSource;
  period: { key: string; start: DateOnly; end: DateOnly };
  calendar: BusinessCalendarSnapshot;
};

export type EvaluatedDeadline = {
  milestoneKey: string;
  scheduleEntryKey: string;
  type: 'STATUTORY' | 'CLIENT' | 'INTERNAL';
  calculatedDueDate: DateOnly;
  explanation: string[];
};

export function evaluateDeadlineRule(input: DeadlineRuleEvaluationInput): {
  applicability: ApplicabilityResult;
  occurrences: EvaluatedDeadline[];
  byKey: Record<string, EvaluatedDeadline>;
  sourceSnapshot: Record<string, unknown>;
  evaluationHash: string;
};
```

Evaluate milestones topologically. `ONCE_PER_SCHEDULE_ENTRY` produces one occurrence per stable schedule key; `ONCE_PER_CYCLE` uses an empty schedule key. Apply offsets before final business-day adjustment. Include source provenance in explanations.

- [ ] **Step 6: Run all schedule/evaluator tests**

Run: `npm.cmd run test:run -- __tests__/lib/service-schedule-validation.test.ts __tests__/services/service-schedule-date-engine.test.ts __tests__/services/deadline-rule-evaluator.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit applicability and rule evaluation**

```bash
git add src/services/service-schedule/applicability.ts src/services/service-schedule/evaluator.ts src/services/service-schedule/index.ts __tests__/services/deadline-rule-evaluator.test.ts
git commit -m "feat: evaluate service deadline rules"
```

---

### Task 4: Implement business-calendar persistence and APIs

**Files:**
- Create: `src/services/business-calendar/service.ts`
- Create: `src/services/business-calendar/index.ts`
- Create: `src/lib/validations/business-calendar.ts`
- Create: `src/app/api/service-calendars/route.ts`
- Create: `src/app/api/service-calendars/[id]/route.ts`
- Create: `src/app/api/service-calendars/[id]/impact/route.ts`
- Create: `__tests__/services/business-calendar.service.test.ts`
- Create: `__tests__/api/service-calendar-routes.test.ts`

**Interfaces:**
- Consumes: Task 2 `BusinessCalendarSnapshot`, Task 3 evaluator, and Plan 1 admin guard.
- Produces: tenant-scoped Singapore calendar CRUD, immutable revision snapshots, and impact preview contract.

- [ ] **Step 1: Write failing calendar service tests**

```ts
it('returns an Asia/Singapore calendar snapshot', async () => {
  prismaMock.businessCalendar.findFirst.mockResolvedValue(calendarRecord);
  expect(await getBusinessCalendarSnapshot('calendar-1', actor)).toEqual({
    id: 'calendar-1', timeZone: 'Asia/Singapore', revision: 3,
    weekendDays: new Set([0, 6]), holidays: new Set(['2026-08-09']),
  });
});

it('increments revision and audits a holiday change', async () => {
  await updateBusinessCalendar('calendar-1', input, actor);
  expect(prismaMock.businessCalendar.update).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ revision: { increment: 1 } }),
  }));
  expect(auditMock.createAuditLog).toHaveBeenCalled();
});

it('rejects a calendar update when its impact preview is stale', async () => {
  await expect(updateBusinessCalendar('calendar-1', {
    ...input, expectedRevision: 3, proposedHash: 'a'.repeat(64), previewFingerprint: 'stale',
  }, actor)).rejects.toMatchObject({ code: 'IMPACT_CHANGED' });
});
```

- [ ] **Step 2: Run service tests and confirm missing modules**

Run: `npm.cmd run test:run -- __tests__/services/business-calendar.service.test.ts`

Expected: FAIL because the service is absent.

- [ ] **Step 3: Implement schemas and service functions**

```ts
export const businessCalendarInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  jurisdictionCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2,10}$/),
  timeZone: z.string().trim().default('Asia/Singapore'),
  weekendDays: z.array(z.number().int().min(0).max(6)).min(1).max(6),
  holidays: z.array(z.object({
    date: z.string().date(), name: z.string().trim().min(1).max(100), description: z.string().trim().max(500).nullable(),
  })).max(500),
  isActive: z.boolean(),
}).strict();

export const businessCalendarUpdateSchema = businessCalendarInputSchema.extend({
  expectedRevision: z.number().int().min(1),
  proposedHash: z.string().regex(/^[a-f0-9]{64}$/),
  previewFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
});
```

Export `listBusinessCalendars`, `getBusinessCalendarSnapshot`, `createBusinessCalendar`, `updateBusinessCalendar`, and `previewBusinessCalendarImpact`. Validate tenant on calendar and holiday rows and audit changes. Update reloads the current revision, recomputes the full impact fingerprint with the production evaluator, and returns `IMPACT_CHANGED` before writing when it differs from the approved preview.

- [ ] **Step 4: Implement admin-only routes**

Every route calls `requireAuth`, `requireServiceAdministrator`, and `resolveWorkspaceId`. The impact route returns:

```ts
type BusinessCalendarImpact = {
  calendarId: string;
  expectedRevision: number;
  proposedHash: string;
  previewFingerprint: string;
  counts: { recalculated: number; preserved: number; warnings: number };
  samples: Array<{ deadlineId: string; oldDate: DateOnly; newDate: DateOnly }>;
};
```

Limit samples to 100 while counts cover the full tenant scope.

- [ ] **Step 5: Run calendar service/API tests**

Run: `npm.cmd run test:run -- __tests__/services/business-calendar.service.test.ts __tests__/api/service-calendar-routes.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit business-calendar APIs**

```bash
git add src/services/business-calendar src/lib/validations/business-calendar.ts src/app/api/service-calendars __tests__/services/business-calendar.service.test.ts __tests__/api/service-calendar-routes.test.ts
git commit -m "feat: manage service business calendars"
```

---

### Task 5: Implement rule drafts, versions, variant associations, and starter drafts

**Files:**
- Create: `src/lib/validations/deadline-rule.ts`
- Create: `src/services/deadline-rule/types.ts`
- Create: `src/services/deadline-rule/service.ts`
- Create: `src/services/deadline-rule/starter-drafts.ts`
- Create: `src/services/deadline-rule/index.ts`
- Create: `src/app/api/service-catalog/deadline-rules/route.ts`
- Create: `src/app/api/service-catalog/deadline-rules/[id]/route.ts`
- Modify: `src/services/service-catalog/types.ts`
- Modify: `src/services/service-catalog/service.ts`
- Modify: `src/lib/validations/service-catalog.ts`
- Create: `prisma/migrations/20260817101000_deadline_rule_starter_drafts/migration.sql`
- Modify: `src/services/workspace.service.ts`
- Create: `__tests__/services/deadline-rule.service.test.ts`
- Create: `__tests__/api/deadline-rule-routes.test.ts`
- Modify: `__tests__/services/workspace.service.test.ts`

**Interfaces:**
- Consumes: schema models, rule/schedule Zod schemas, admin guard.
- Produces: mutable single draft, immutable published versions, variant associations, and starter tenant drafts.

- [ ] **Step 1: Write failing draft/version tests**

```ts
it('creates one mutable draft with a canonical config hash', async () => {
  const result = await createDeadlineRule(ruleInput, actor);
  expect(prismaMock.deadlineRuleVersion.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ state: 'DRAFT', draftRevision: 1, configHash: expect.stringMatching(/^[a-f0-9]{64}$/) }),
  }));
  expect(result.draft.state).toBe('DRAFT');
});

it('rejects a stale draft revision', async () => {
  prismaMock.deadlineRuleVersion.updateMany.mockResolvedValue({ count: 0 });
  await expect(updateDeadlineRuleDraft('rule-1', { ...ruleInput, expectedDraftRevision: 2 }, actor))
    .rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
});
```

- [ ] **Step 2: Run rule service tests and verify missing service**

Run: `npm.cmd run test:run -- __tests__/services/deadline-rule.service.test.ts`

Expected: FAIL because the rule service is absent.

- [ ] **Step 3: Define exact draft and association schemas**

```ts
export const deadlineRuleDraftSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{1,63}$/),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).nullable(),
  recurrence: ruleRecurrenceSchema,
  applicability: applicabilityDefinitionSchema,
  parameters: z.array(deadlineParameterDefinitionSchema).max(100),
  milestones: z.array(deadlineMilestoneSchema).min(1).max(100),
  expectedDraftRevision: z.number().int().min(1).optional(),
}).strict();

export const serviceVariantRuleAssociationSchema = z.object({
  ruleId: z.string().uuid(),
  enabledByDefault: z.boolean(),
  parameterDefaults: z.record(z.string(), z.unknown()).default({}),
  scheduleDefaults: scheduleEntriesSchema.default([]),
  displayOrder: z.number().int().min(0),
}).strict();
```

Validate stable parameter/milestone keys, dependency DAG, `ONCE_PER_SCHEDULE_ENTRY` requiring at least one schedule source, and all expression references.

- [ ] **Step 4: Implement tenant-scoped rule service and routes**

Export:

```ts
export async function listDeadlineRules(input: SearchDeadlineRulesInput, actor: TenantAwareParams): Promise<DeadlineRuleListDto>;
export async function getDeadlineRule(id: string, actor: TenantAwareParams): Promise<DeadlineRuleDto>;
export async function createDeadlineRule(input: DeadlineRuleDraftInput, actor: TenantAwareParams): Promise<DeadlineRuleDto>;
export async function updateDeadlineRuleDraft(id: string, input: DeadlineRuleDraftInput, actor: TenantAwareParams): Promise<DeadlineRuleDto>;
export async function replaceVariantRuleAssociations(variantId: string, input: ServiceVariantRuleAssociationInput[], actor: TenantAwareParams): Promise<ServiceVariantDto>;
```

All writes and audit events share a serializable transaction. Published version rows are never updated or deleted.

- [ ] **Step 5: Seed four unpublished starter drafts per tenant**

Create the follow-up seed migration with tenant-scoped stable codes and no variant association:

```text
SG_AGM_DUE       — once-per-cycle statutory milestone one calendar month before Company.accountsDueDate
SG_ANNUAL_RETURN — once-per-cycle statutory milestone sourced from Company.accountsDueDate
SG_ECI           — annual FYE source plus required integer parameter monthsAfterFye, with no default
SG_FORM_C        — annual FYE source plus required integer parameter monthsAfterFye, with no default
```

Use `INSERT ... SELECT` from active `tenants`, `ON CONFLICT DO NOTHING`, DRAFT versions, schema version 1, and relational parameter/milestone rows. The drafts generate nothing until an administrator attaches and publishes them.

In `starter-drafts.ts`, export this idempotent provisioning function for newly created workspaces:

```ts
export async function createServiceScheduleStarterData(
  tx: Prisma.TransactionClient,
  tenantId: string,
): Promise<void>;
```

It creates the default Singapore business calendar and the same four DRAFT rules by stable code. Call it inside the existing `createWorkspace` transaction immediately after the Workspace row is created. Existing tenants are covered by the two migrations; future tenants are covered by this function.

Add a workspace-service assertion:

```ts
expect(starterDataMock.createServiceScheduleStarterData).toHaveBeenCalledWith(
  prismaMock,
  createdWorkspace.id,
);
```

- [ ] **Step 6: Run rule service/API/catalog tests**

Run: `npm.cmd run test:run -- __tests__/services/deadline-rule.service.test.ts __tests__/api/deadline-rule-routes.test.ts __tests__/services/service-catalog.service.test.ts __tests__/api/service-catalog-routes.test.ts __tests__/services/workspace.service.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit rule drafts and associations**

```bash
git add src/lib/validations/deadline-rule.ts src/services/deadline-rule src/app/api/service-catalog/deadline-rules src/services/service-catalog/types.ts src/services/service-catalog/service.ts src/lib/validations/service-catalog.ts prisma/migrations/20260817101000_deadline_rule_starter_drafts/migration.sql src/services/workspace.service.ts __tests__/services/deadline-rule.service.test.ts __tests__/api/deadline-rule-routes.test.ts __tests__/services/service-catalog.service.test.ts __tests__/api/service-catalog-routes.test.ts __tests__/services/workspace.service.test.ts
git commit -m "feat: manage versioned deadline rule drafts"
```

---

### Task 6: Implement impact preview, publish, and archive

**Files:**
- Create: `src/services/deadline-rule/impact.ts`
- Modify: `src/services/deadline-rule/index.ts`
- Create: `src/services/schedule-reconciliation/types.ts`
- Create: `src/services/schedule-reconciliation/queue.ts`
- Create: `src/services/schedule-reconciliation/index.ts`
- Modify: `src/services/business-calendar/service.ts`
- Create: `src/app/api/service-catalog/deadline-rules/[id]/impact/route.ts`
- Create: `src/app/api/service-catalog/deadline-rules/[id]/publish/route.ts`
- Create: `src/app/api/service-catalog/deadline-rules/[id]/archive/route.ts`
- Create: `__tests__/services/deadline-rule-impact.test.ts`
- Modify: `__tests__/api/deadline-rule-routes.test.ts`

**Interfaces:**
- Consumes: pure evaluator and rule persistence.
- Produces: same-evaluator preview/apply contract with fingerprint and immutable publication.

- [ ] **Step 1: Write failing preview/publish tests**

```ts
it('groups complete impact without writing occurrences', async () => {
  const result = await previewDeadlineRuleImpact('rule-1', previewInput, actor);
  expect(result.counts).toEqual(expect.objectContaining({ created: 2, recalculated: 1, preserved: 3 }));
  expect(prismaMock.deadlineOccurrence.update).not.toHaveBeenCalled();
});

it('rejects publish when the preview fingerprint changed', async () => {
  await expect(publishDeadlineRule('rule-1', {
    expectedCurrentVersion: 2,
    expectedDraftRevision: 4,
    draftConfigHash: 'a'.repeat(64),
    previewFingerprint: 'stale',
  }, actor)).rejects.toMatchObject({ code: 'IMPACT_CHANGED', statusCode: 409 });
});
```

- [ ] **Step 2: Run impact tests and confirm missing functions**

Run: `npm.cmd run test:run -- __tests__/services/deadline-rule-impact.test.ts`

Expected: FAIL because impact orchestration is absent.

- [ ] **Step 3: Implement the impact DTO and deterministic fingerprint**

```ts
export type DeadlineRuleImpact = {
  ruleId: string;
  currentPublishedVersion: number | null;
  draftRevision: number;
  draftConfigHash: string;
  previewFingerprint: string;
  counts: {
    created: number; recalculated: number; cancelled: number; preserved: number;
    inapplicable: number; missingInput: number; conflicts: number; warnings: number;
  };
  samples: Array<{
    clientServiceId: string;
    deadlineOccurrenceId: string | null;
    action: 'CREATE' | 'RECALCULATE' | 'CANCEL' | 'PRESERVE' | 'WARN';
    oldDate: DateOnly | null;
    newDate: DateOnly | null;
    reason: string;
  }>;
};
```

Hash sorted full-impact identity/action/date tuples, not the 100-row sample, so truncation cannot make two impacts look equal.

- [ ] **Step 4: Implement transactional reconciliation enqueue**

Implement the public `enqueueScheduleReconciliation(tx, input)` contract declared at the top of this plan. Compute the SHA-256 dedupe key from tenant, scope type/ID, trigger type, and the minute containing `notBefore`; `upsert` a Pending request and retain the earliest `nextAttemptAt`. Export it from `schedule-reconciliation/index.ts`.

Call it from rule publish/archive and successful business-calendar updates inside the same transaction as the source write. Preview endpoints never enqueue.

- [ ] **Step 5: Implement publish and archive transactions**

Inside a serializable transaction, reload and lock the rule/draft, verify version/revision/hash, recompute the impact, compare its fingerprint, mark the draft `PUBLISHED`, allocate the next version number, set the current version, audit, and enqueue one deduplicated RULE reconciliation request.

Archive performs the same preview check, sets `deletedAt`/inactive, audits the reason, and enqueues cancellation reconciliation. It does not delete versions or occurrences.

- [ ] **Step 6: Implement admin routes and status codes**

All routes use `requireServiceAdministrator`. Preview is POST with proposed draft identity; publish and archive are POST. Return `409 IMPACT_CHANGED` and include the newly computed impact summary when stale.

- [ ] **Step 7: Run impact and route tests**

Run: `npm.cmd run test:run -- __tests__/services/deadline-rule-impact.test.ts __tests__/api/deadline-rule-routes.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit rule impact safety**

```bash
git add src/services/deadline-rule/impact.ts src/services/deadline-rule/index.ts src/services/schedule-reconciliation/types.ts src/services/schedule-reconciliation/queue.ts src/services/schedule-reconciliation/index.ts src/services/business-calendar/service.ts src/app/api/service-catalog/deadline-rules/[id]/impact src/app/api/service-catalog/deadline-rules/[id]/publish src/app/api/service-catalog/deadline-rules/[id]/archive __tests__/services/deadline-rule-impact.test.ts __tests__/api/deadline-rule-routes.test.ts
git commit -m "feat: preview and publish deadline rule impacts"
```

---

### Task 7: Implement durable reconciliation and source-change enqueueing

**Files:**
- Modify: `src/services/schedule-reconciliation/types.ts`
- Create: `src/services/schedule-reconciliation/settings.ts`
- Modify: `src/services/schedule-reconciliation/queue.ts`
- Create: `src/services/schedule-reconciliation/deadline-reconciler.ts`
- Create: `src/services/schedule-reconciliation/worker.ts`
- Modify: `src/services/schedule-reconciliation/index.ts`
- Create: `src/lib/scheduler/tasks/service-schedule-reconciliation.task.ts`
- Modify: `src/lib/scheduler/tasks/index.ts`
- Modify: `src/lib/scheduler/index.ts`
- Modify: `src/services/company.service.ts`
- Modify: `src/services/company/profile-sections.ts`
- Modify: `src/lib/validations/company.ts`
- Modify: `src/lib/validations/company-profile.ts`
- Modify: `src/components/companies/company-edit/company-create-workspace.tsx`
- Modify: `src/components/companies/company-detail/company-profile-sections.tsx`
- Modify: `src/services/bizfile/company-sync.ts`
- Modify: `src/services/client-service/service.ts`
- Modify: `src/services/client-service/manual-create.ts`
- Modify: `src/services/service-agreement/activation.service.ts`
- Create: `__tests__/services/schedule-reconciliation.test.ts`
- Create: `__tests__/services/schedule-reconciliation-scheduler.test.ts`
- Create: `__tests__/integration/deadline-reconciliation.postgres.test.ts`
- Modify: `__tests__/services/company-profile-sections.test.ts`
- Modify: `__tests__/components/company-profile-sections.test.tsx`

**Interfaces:**
- Consumes: evaluator, rule publication, Company and client-service transaction paths.
- Produces: the queue and reconciliation functions declared in the public interface section.

- [ ] **Step 1: Write failing queue deduplication and lifecycle tests**

```ts
it('upserts a deterministic pending request in the caller transaction', async () => {
  await enqueueScheduleReconciliation(prismaMock, {
    tenantId: 'tenant-1', scopeType: 'COMPANY', scopeId: 'company-1',
    triggerType: 'COMPANY_SOURCE_CHANGED', correlationId: 'request-1', requestedById: 'user-1',
  });
  expect(prismaMock.serviceScheduleReconciliationRequest.upsert).toHaveBeenCalledWith(expect.objectContaining({
    where: { dedupeKey: expect.stringMatching(/^[a-f0-9]{64}$/) },
    create: expect.objectContaining({ status: 'PENDING', tenantId: 'tenant-1' }),
  }));
});

it('preserves manual, historical, completed, waived, cancelled, and overridden deadlines', async () => {
  const result = await reconcileClientServiceDeadlines(reconcileInput);
  expect(result.preservedByReason).toMatchObject({
    MANUAL_TRIGGER: 1, HISTORICAL: 1, COMPLETED: 1, WAIVED: 1, CANCELLED: 1, OVERRIDDEN: 1,
  });
});
```

- [ ] **Step 2: Run reconciliation tests and confirm missing modules**

Run: `npm.cmd run test:run -- __tests__/services/schedule-reconciliation.test.ts __tests__/services/schedule-reconciliation-scheduler.test.ts`

Expected: FAIL because the queue/worker does not exist.

- [ ] **Step 3: Implement workspace flags and transactional enqueue**

Use these settings with safe defaults:

```ts
export type ServiceWorkspaceFlags = {
  workspaceEnabled: boolean;
  deadlineWritesEnabled: boolean;
};

export function getServiceWorkspaceFlags(settings: unknown): ServiceWorkspaceFlags {
  const workspaceSettingsSchema = z.object({
    servicesWorkspace: z.object({
      enabled: z.boolean().optional(),
      deadlineWritesEnabled: z.boolean().optional(),
    }).optional(),
  }).passthrough();
  const parsed = workspaceSettingsSchema.safeParse(settings);
  return {
    workspaceEnabled: parsed.success ? parsed.data.servicesWorkspace?.enabled ?? true : true,
    deadlineWritesEnabled: parsed.success
      ? parsed.data.servicesWorkspace?.deadlineWritesEnabled ?? process.env.DEADLINE_OCCURRENCE_WRITES_ENABLED === 'true'
      : process.env.DEADLINE_OCCURRENCE_WRITES_ENABLED === 'true',
  };
}
```

The UI feature defaults on; occurrence writes require the tenant setting or the explicit environment flag. `OBSERVE` mode computes and logs summary counts without mutating cycles/deadlines.

Also export `getServiceWorkspaceFlagsForTenant(tenantId)` and `requireServicesWorkspaceEnabled(tenantId)`. The latter throws a typed 404 when the tenant explicitly disables the operational workspace; operational roster/deadline APIs call it before querying.

Create dedupe keys from tenant, scope, trigger, and a normalized coalescing window. Upsert updates `nextAttemptAt` and leaves Processing requests untouched by using a transaction-safe fallback request when necessary.

- [ ] **Step 4: Implement occurrence diffing**

For each active rule and rolling period, evaluate and compare by stable occurrence identity. Apply this decision function:

```ts
export function classifyDeadlineChange(existing: StoredDeadline | null, proposed: EvaluatedDeadline, today: DateOnly):
  | { action: 'CREATE' }
  | { action: 'RECALCULATE' }
  | { action: 'NO_CHANGE' }
  | { action: 'PRESERVE'; reason: PreserveReason };
```

Existing manual origin, due date before today, non-Open state, or explicit override always yields Preserve. When a preserved override has a changed calculation, update only `calculatedDueDate` and its explanation snapshot, not `operativeDueDate`. Removed eligible future open occurrences become `CANCELLED` with system reason.

- [ ] **Step 5: Implement leasing, retry, and rolling-horizon worker**

Claim with `FOR UPDATE SKIP LOCKED`, a UUID lease owner, and five-minute expiry. Reclaim expired Processing requests. Use attempt-aware bounded delays of 1, 5, 15, 60, then 240 minutes; permanent validation/missing-input outcomes complete with warnings rather than retry forever.

Export:

```ts
export async function processScheduleReconciliationBatch(options: {
  limit: number;
  concurrency: number;
  now?: Date;
}): Promise<{ claimed: number; completed: number; failed: number; summaries: DeadlineReconciliationResult[] }>;
```

The scheduler task runs every minute with limit 20 and concurrency 4. A daily TENANT request extends the horizon to `addMonthsClamped(today, 12)`.

- [ ] **Step 6: Enqueue from source mutations in the same transaction**

Use exact trigger types:

```text
COMPANY_SOURCE_CHANGED
BIZFILE_SOURCE_CHANGED
CLIENT_SERVICE_CREATED
CLIENT_SERVICE_CONFIGURATION_CHANGED
CLIENT_SERVICE_ARCHIVED
SERVICE_AGREEMENT_ACTIVATED
RULE_PUBLISHED
RULE_ARCHIVED
BUSINESS_CALENDAR_CHANGED
ROLLING_HORIZON
```

Only Company changes to entity type, FYE, AGM, Annual Return, accounts due, or incorporation date enqueue. Client-service archive also cancels eligible future deadlines during reconciliation. Agreement activation and manual service creation attach enabled default rules before enqueueing.

Persist `accountsDueDate` as the sole authoritative annual filing date. Do not store duplicate next-AGM or next-annual-return fields. The company detail derives Next AGM as one clamped calendar month before Accounts due, and the statutory Annual Return rule reads Accounts due directly. Editing Accounts due enqueues `COMPANY_SOURCE_CHANGED`.

Add assertions:

```ts
expect(screen.getByLabelText('Next AGM due date')).toBeVisible();
expect(screen.getByLabelText('Next Annual Return due date')).toBeVisible();
expect(enqueueMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
  scopeType: 'COMPANY', triggerType: 'COMPANY_SOURCE_CHANGED',
}));
```

- [ ] **Step 7: Run unit, scheduler, and PostgreSQL concurrency tests**

Run: `npm.cmd run test:run -- __tests__/services/schedule-reconciliation.test.ts __tests__/services/schedule-reconciliation-scheduler.test.ts __tests__/services/company-profile-sections.test.ts __tests__/components/company-profile-sections.test.tsx`

Expected: PASS.

Run with isolated PostgreSQL: `npm.cmd run test:run -- __tests__/integration/deadline-reconciliation.postgres.test.ts`

Expected: PASS with one occurrence per identity under concurrent retries and one active lease per request.

- [ ] **Step 8: Commit durable reconciliation**

```bash
git add src/services/schedule-reconciliation src/lib/scheduler/tasks/service-schedule-reconciliation.task.ts src/lib/scheduler/tasks/index.ts src/lib/scheduler/index.ts src/services/company.service.ts src/services/company/profile-sections.ts src/lib/validations/company.ts src/lib/validations/company-profile.ts src/components/companies/company-edit/company-create-workspace.tsx src/components/companies/company-detail/company-profile-sections.tsx src/services/bizfile/company-sync.ts src/services/client-service/service.ts src/services/client-service/manual-create.ts src/services/service-agreement/activation.service.ts __tests__/services/schedule-reconciliation.test.ts __tests__/services/schedule-reconciliation-scheduler.test.ts __tests__/integration/deadline-reconciliation.postgres.test.ts __tests__/services/company-profile-sections.test.ts __tests__/components/company-profile-sections.test.tsx
git commit -m "feat: reconcile service deadline occurrences"
```

---

### Task 8: Add client-service rule configuration and the generic schedule editor

**Files:**
- Modify: `src/lib/validations/client-service.ts`
- Modify: `src/services/client-service/types.ts`
- Modify: `src/services/client-service/mapper.ts`
- Modify: `src/services/client-service/catalog-options.ts`
- Modify: `src/services/client-service/service.ts`
- Modify: `src/services/client-service/manual-create.ts`
- Modify: `src/components/companies/company-detail/client-service-form-state.ts`
- Modify: `src/components/companies/company-detail/operational-service-form.tsx`
- Modify: `src/components/companies/company-detail/client-service-creator.tsx`
- Modify: `src/components/companies/company-detail/client-service-editor.tsx`
- Create: `src/components/services/shared/schedule-entry-editor.tsx`
- Create: `src/app/api/client-services/[id]/deadline-configuration/impact/route.ts`
- Create: `__tests__/components/schedule-entry-editor.test.tsx`
- Modify: `__tests__/lib/client-service-validation.test.ts`
- Modify: `__tests__/services/client-service.service.test.ts`
- Modify: `__tests__/components/client-service-creator.test.tsx`

**Interfaces:**
- Consumes: variant associations, schedule schema, reconciliation enqueue.
- Produces: per-client enabled rules, parameters/provenance, generic repeatable entries, and edit impact preview.

- [ ] **Step 1: Write failing client-rule validation tests**

```ts
it('accepts four generic schedule entries for an accounting service', () => {
  const parsed = createManualClientServiceSchema.parse({
    ...baseInput,
    deadlineRules: [{
      ruleId: UUIDS.rule,
      enabled: true,
      parameterValues: {},
      parameterProvenance: {},
      scheduleEntries: fourMonthlyEntries,
    }],
  });
  expect(parsed.deadlineRules[0]?.scheduleEntries).toHaveLength(4);
});
```

- [ ] **Step 2: Write failing editor reorder test**

```tsx
it('reorders entries without changing stable keys', async () => {
  const onChange = vi.fn();
  render(<ScheduleEntryEditor value={entries} onChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: 'Move Salary payout down' }));
  expect(onChange).toHaveBeenCalledWith([
    expect.objectContaining({ key: 'client-funding' }),
    expect.objectContaining({ key: 'salary-payout' }),
  ]);
});
```

- [ ] **Step 3: Run validation/component tests and verify failure**

Run: `npm.cmd run test:run -- __tests__/lib/client-service-validation.test.ts __tests__/components/schedule-entry-editor.test.tsx`

Expected: FAIL because client-rule inputs/editor are absent.

- [ ] **Step 4: Extend client-service schemas and transactional persistence**

Add:

```ts
const clientServiceDeadlineRuleInputSchema = z.object({
  ruleId: z.string().uuid(),
  enabled: z.boolean(),
  parameterValues: z.record(z.string(), z.unknown()).default({}),
  parameterProvenance: z.record(z.string(), z.enum(['COMPANY', 'CATALOG_DEFAULT', 'CLIENT_OVERRIDE'])).default({}),
  scheduleEntries: scheduleEntriesSchema.default([]),
}).strict();
```

Both manual create and update accept `deadlineRules` up to 100. Persist them in the same serializable transaction as `ClientService`, validate association/tenant/rule version, evaluate applicability, and enqueue after persistence. Catalog options include associated current published rules, parameter definitions, defaults, and family color.

Make `expectedUpdatedAt` the canonical update field in this task. For compatibility, accept the existing `updatedAt` only when `expectedUpdatedAt` is absent and transform it into `expectedUpdatedAt`; reject a request containing conflicting values. Service functions receive only the canonical property, and existing callers/tests are migrated without a flag day.

- [ ] **Step 5: Build the generic editor and wire the shared form**

The editor renders add/remove/reorder controls and expression-specific inputs for all four schedule kinds. Labels and IDs use entry keys, not array indexes. Prevent a 32nd row and announce validation through `aria-live`.

The shared operational form groups `Deadline rules`, `Parameters`, and `Schedule entries`; it shows applicability/missing-input reasons and obtains a server impact preview before submitting a change to an existing service.

- [ ] **Step 6: Implement client configuration impact route**

POST body contains proposed `deadlineRules` and `expectedUpdatedAt`. The route loads the client service tenant-safely, requires `company:update`, runs the production evaluator/diff in observe mode, and returns counts, samples, proposed config hash, and preview fingerprint. The subsequent PATCH includes that fingerprint; the service recomputes and returns `IMPACT_CHANGED` if stale.

- [ ] **Step 7: Run client-service tests**

Run: `npm.cmd run test:run -- __tests__/lib/client-service-validation.test.ts __tests__/services/client-service.service.test.ts __tests__/components/schedule-entry-editor.test.tsx __tests__/components/client-service-creator.test.tsx __tests__/api/client-services-routes.test.ts __tests__/api/manual-client-services-routes.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit client rule configuration**

```bash
git add src/lib/validations/client-service.ts src/services/client-service src/components/companies/company-detail src/components/services/shared/schedule-entry-editor.tsx src/app/api/client-services/[id]/deadline-configuration/impact __tests__/lib/client-service-validation.test.ts __tests__/services/client-service.service.test.ts __tests__/components/schedule-entry-editor.test.tsx __tests__/components/client-service-creator.test.tsx __tests__/api/client-services-routes.test.ts __tests__/api/manual-client-services-routes.test.ts
git commit -m "feat: configure client service deadline rules"
```

---

### Task 9: Implement the accessible cross-company service roster API

**Files:**
- Create: `src/services/service-roster/types.ts`
- Create: `src/services/service-roster/service.ts`
- Create: `src/services/service-roster/index.ts`
- Create: `src/lib/validations/service-roster.ts`
- Create: `src/app/api/client-services/route.ts`
- Create: `src/hooks/use-service-roster.ts`
- Create: `__tests__/services/service-roster.service.test.ts`
- Create: `__tests__/api/service-roster-route.test.ts`
- Create: `__tests__/hooks/use-service-roster.test.ts`

**Interfaces:**
- Consumes: `getCompanyReadScope`, family colors, display labels, deadline occurrences.
- Produces: paginated `ServiceRosterResult` for mockup view 1.

- [ ] **Step 1: Write failing access-scope and DTO tests**

```ts
it('places accessible company IDs inside the Prisma predicate', async () => {
  await listServiceRoster(search, { tenantId: 'tenant-1', companyIds: ['company-1'] });
  expect(prismaMock.clientService.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({ tenantId: 'tenant-1', companyId: { in: ['company-1'] } }),
  }));
});

it('returns family color, display label, next deadline, and warning state', async () => {
  const result = await listServiceRoster(search, allCompanyScope);
  expect(result.items[0]).toMatchObject({
    company: { displayLabel: 'OACS' },
    family: { displayColor: '#2F6F5E' },
    nextDeadline: { operativeDueDate: '2026-09-01' },
  });
});
```

- [ ] **Step 2: Run service/API tests and confirm missing modules**

Run: `npm.cmd run test:run -- __tests__/services/service-roster.service.test.ts __tests__/api/service-roster-route.test.ts`

Expected: FAIL because roster service/route do not exist.

- [ ] **Step 3: Define search and result contracts**

```ts
export const serviceRosterSearchSchema = z.object({
  query: z.string().trim().max(200).optional(),
  companyId: z.string().uuid().optional(),
  familyIds: z.array(z.string().uuid()).max(50).default([]),
  variantId: z.string().uuid().optional(),
  statuses: z.array(z.enum(['ACTIVE', 'PAUSED', 'ENDED'])).default(['ACTIVE']),
  archived: z.boolean().default(false),
  applicability: z.enum(['APPLICABLE', 'NOT_APPLICABLE', 'MISSING_INPUT']).optional(),
  sortBy: z.enum(['company', 'family', 'service', 'status', 'nextDeadline', 'startDate']).default('company'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict();
```

`ServiceRosterItem` contains IDs, full Company name, display alias/label, family name/color, variant/service snapshot, status, cadence, start/end, next open deadline, rule warning summary, source, and `updatedAt`.

- [ ] **Step 4: Implement SQL-scoped list and route**

The route requires `company:read`, calls `requireServicesWorkspaceEnabled(tenantId)`, derives workspace and scope with `getCompanyReadScope`, and returns an empty page when the scope is empty. The service uses Prisma relation filters/subqueries for access, filters, and next deadline; it must not call `hasPermission` per row.

- [ ] **Step 5: Implement the React Query hook**

Use key `['service-roster', normalizedSearch]`, `keepPreviousData`, query-string arrays as comma-separated values, and structured API errors. Export `useServiceRoster(search)` and `serviceRosterKeys`.

- [ ] **Step 6: Run service/API/hook tests**

Run: `npm.cmd run test:run -- __tests__/services/service-roster.service.test.ts __tests__/api/service-roster-route.test.ts __tests__/hooks/use-service-roster.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit the roster API**

```bash
git add src/services/service-roster src/lib/validations/service-roster.ts src/app/api/client-services/route.ts src/hooks/use-service-roster.ts __tests__/services/service-roster.service.test.ts __tests__/api/service-roster-route.test.ts __tests__/hooks/use-service-roster.test.ts
git commit -m "feat: list client services across companies"
```

---

### Task 10: Build the operational Services roster and navigation

**Files:**
- Create: `src/app/(dashboard)/services/page.tsx`
- Create: `src/components/services/services-workspace.tsx`
- Create: `src/components/services/shared/family-filter-chips.tsx`
- Create: `src/components/services/roster/service-roster.tsx`
- Create: `src/components/services/roster/service-roster-table.tsx`
- Create: `src/components/services/roster/service-roster-filters.tsx`
- Create: `src/components/services/roster/add-client-service-dialog.tsx`
- Create: `src/app/api/services/settings/route.ts`
- Create: `src/hooks/use-services-workspace-settings.ts`
- Modify: `src/components/ui/sidebar.tsx`
- Create: `__tests__/components/service-roster.test.tsx`
- Create: `__tests__/components/services-workspace.test.tsx`
- Create: `__tests__/api/services-settings-route.test.ts`

**Interfaces:**
- Consumes: roster hook, existing Company table patterns, existing `ClientServiceCreator`.
- Produces: `/services?tab=services` and primary Services navigation.

- [ ] **Step 1: Write failing filter-placement and row tests**

```tsx
it('places family filters beside Active, Paused, and Ended', () => {
  render(<ServiceRoster />);
  const toolbar = screen.getByRole('group', { name: 'Service filters' });
  expect(within(toolbar).getByRole('button', { name: 'Active' })).toBeVisible();
  expect(within(toolbar).getByRole('button', { name: 'Paused' })).toBeVisible();
  expect(within(toolbar).getByRole('button', { name: 'Ended' })).toBeVisible();
  expect(within(toolbar).getByRole('button', { name: 'Accounting' })).toBeVisible();
});

it('uses alternating rows and full company names with display labels', () => {
  render(<ServiceRoster />);
  expect(screen.getByText('OACS')).toBeVisible();
  expect(screen.getByText('Oaktree Accounting & Corporate Solution Pte. Ltd.')).toBeVisible();
  expect(screen.getAllByRole('row')[2]).toHaveClass('bg-oak-row-alt');
});
```

- [ ] **Step 2: Run component tests and verify missing components**

Run: `npm.cmd run test:run -- __tests__/components/service-roster.test.tsx __tests__/components/services-workspace.test.tsx`

Expected: FAIL because the workspace is absent.

- [ ] **Step 3: Expose and consume workspace feature state**

`GET /api/services/settings` authenticates, resolves the session workspace, and returns:

```ts
{ workspaceEnabled: boolean; deadlineWritesEnabled: boolean }
```

`useServicesWorkspaceSettings()` caches it under `['services-workspace-settings']`. When `workspaceEnabled` is false, omit the primary Services sidebar item and render a compact unavailable message at `/services`; do not issue roster/deadline queries.

- [ ] **Step 4: Build the roster with existing Company-table patterns**

Columns are Company, Family, Service, Status, Cadence, Next deadline, Start/end, Warnings, and Actions. Reuse responsive cards, alternating row tokens, inline filters, resize behavior, active-filter badges, server pagination, and `UserPreference` key `services.roster.table.v1`.

Use `FamilyFilterChips` with visible text and family-color accent:

```tsx
<button
  type="button"
  aria-pressed={selected}
  style={{ '--family-color': family.displayColor } as React.CSSProperties}
  className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs"
>
  <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: family.displayColor }} />
  {family.name}
</button>
```

- [ ] **Step 5: Implement add/edit/archive actions**

The Add service dialog first selects an accessible Company through `useAllCompanyOptions`, then renders the existing shared `ClientServiceCreator` with that Company ID. Row actions deep-link to Company Services, edit through the shared editor, and use existing reason-required archive behavior.

- [ ] **Step 6: Add route shell and primary navigation**

The initial shell recognizes `tab=services` and renders the roster. Add this primary navigation item with `BriefcaseBusiness`:

```ts
{ name: 'Services', href: '/services?tab=services', icon: BriefcaseBusiness },
```

Tasks 12 and 13 expand the same shell to Deadlines without changing the roster URL.

- [ ] **Step 7: Run workspace/roster/sidebar/settings tests**

Run: `npm.cmd run test:run -- __tests__/components/service-roster.test.tsx __tests__/components/services-workspace.test.tsx __tests__/components/sidebar-task-destinations.test.tsx __tests__/api/services-settings-route.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit the operational roster**

```bash
git add src/app/(dashboard)/services/page.tsx src/app/api/services/settings/route.ts src/hooks/use-services-workspace-settings.ts src/components/services/services-workspace.tsx src/components/services/shared/family-filter-chips.tsx src/components/services/roster src/components/ui/sidebar.tsx __tests__/components/service-roster.test.tsx __tests__/components/services-workspace.test.tsx __tests__/components/sidebar-task-destinations.test.tsx __tests__/api/services-settings-route.test.ts
git commit -m "feat: add cross-company services roster"
```

---

### Task 11: Implement deadline query and lifecycle APIs

**Files:**
- Create: `src/lib/validations/deadline.ts`
- Create: `src/services/deadline/types.ts`
- Create: `src/services/deadline/service.ts`
- Create: `src/services/deadline/index.ts`
- Create: `src/app/api/deadlines/route.ts`
- Create: `src/app/api/deadlines/[id]/route.ts`
- Create: `src/app/api/deadlines/[id]/reset-date-override/route.ts`
- Create: `src/hooks/use-deadlines.ts`
- Create: `__tests__/services/deadline.service.test.ts`
- Create: `__tests__/api/deadline-routes.test.ts`
- Create: `__tests__/hooks/use-deadlines.test.ts`

**Interfaces:**
- Consumes: materialized occurrences, accessible-company scope, date-only engine.
- Produces: table/calendar list DTO and audited lifecycle/override mutations.

- [ ] **Step 1: Write failing timing-state and immutability tests**

```ts
it.each([
  ['2026-08-18', 'UPCOMING'], ['2026-08-17', 'DUE'], ['2026-08-16', 'OVERDUE'],
])('derives %s as %s', (dueDate, timingState) => {
  expect(deriveDeadlineTiming('OPEN', dueDate, '2026-08-17')).toBe(timingState);
});

it('rejects edits to a cancelled occurrence', async () => {
  prismaMock.deadlineOccurrence.findFirst.mockResolvedValue({ ...record, status: 'CANCELLED' });
  await expect(updateDeadlineOccurrence(record.id, patch, actor)).rejects.toMatchObject({ code: 'OCCURRENCE_IMMUTABLE' });
});
```

- [ ] **Step 2: Run service/API tests and confirm missing modules**

Run: `npm.cmd run test:run -- __tests__/services/deadline.service.test.ts __tests__/api/deadline-routes.test.ts`

Expected: FAIL because deadline services/routes are absent.

- [ ] **Step 3: Define bounded list and mutation schemas**

```ts
export const deadlineSearchSchema = z.object({
  from: z.string().date(),
  to: z.string().date(),
  mode: z.enum(['TABLE', 'CALENDAR']).default('TABLE'),
  types: z.array(z.enum(['STATUTORY', 'CLIENT', 'INTERNAL'])).default(['STATUTORY', 'CLIENT', 'INTERNAL']),
  familyIds: z.array(z.string().uuid()).max(50).default([]),
  companyIds: z.array(z.string().uuid()).max(100).default([]),
  statuses: z.array(z.enum(['OPEN', 'COMPLETED', 'WAIVED', 'CANCELLED'])).default([]),
  timing: z.array(z.enum(['UPCOMING', 'DUE', 'OVERDUE'])).default([]),
  openOnly: z.boolean().default(true),
  origin: z.enum(['RULE', 'MANUAL_TRIGGER']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  sortBy: z.enum(['dueDate', 'company', 'family', 'service', 'type', 'status']).default('dueDate'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
}).refine((value) => differenceInCalendarDays(parseISO(value.to), parseISO(value.from)) <= 366, 'Date range cannot exceed 366 days');
```

PATCH requires `expectedUpdatedAt`, target status excluding Cancelled, optional operative date, notes, completion date, and reason for override/waive/reopen.

- [ ] **Step 4: Implement SQL-scoped list and lifecycle service**

Calendar mode has no page semantics but enforces the range cap and a 5,000-row response cap; return `truncated: true` with a warning when reached. Table mode returns total/page/limit. Translate timing filters into Open-status operative-date predicates relative to the current Singapore date rather than storing timing values.

Update by `updateMany({ where: { id, tenantId, updatedAt, status: { not: 'CANCELLED' } } })`; a zero count returns `VERSION_CONFLICT`. Audit before/after/status/reason. Reset override copies current calculated due date into operative due date and clears override metadata.

- [ ] **Step 5: Implement routes and React Query hooks**

Routes require `company:read` and `requireServicesWorkspaceEnabled(tenantId)` for list scope and load the occurrence's Company before `company:update` mutations. `useDeadlines(search)` uses a stable normalized key. Mutation hooks invalidate deadlines, roster next-deadline summaries, and the specific occurrence.

- [ ] **Step 6: Run deadline service/API/hook tests**

Run: `npm.cmd run test:run -- __tests__/services/deadline.service.test.ts __tests__/api/deadline-routes.test.ts __tests__/hooks/use-deadlines.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit deadline APIs**

```bash
git add src/lib/validations/deadline.ts src/services/deadline src/app/api/deadlines src/hooks/use-deadlines.ts __tests__/services/deadline.service.test.ts __tests__/api/deadline-routes.test.ts __tests__/hooks/use-deadlines.test.ts
git commit -m "feat: query and update service deadlines"
```

---

### Task 12: Build Deadline table/calendar views and preferences

**Files:**
- Create: `src/components/services/deadlines/deadline-workspace.tsx`
- Create: `src/components/services/deadlines/deadline-filters.tsx`
- Create: `src/components/services/deadlines/deadline-table.tsx`
- Create: `src/components/services/deadlines/deadline-calendar.tsx`
- Create: `src/components/services/deadlines/deadline-event.tsx`
- Modify: `src/components/services/services-workspace.tsx`
- Create: `src/lib/validations/services-preferences.ts`
- Create: `__tests__/components/deadline-workspace.test.tsx`
- Create: `__tests__/components/deadline-calendar.test.tsx`
- Create: `__tests__/browser/services-deadlines.browser.test.tsx`

**Interfaces:**
- Consumes: deadline hooks, family chips, user-preference hooks.
- Produces: mockup views 2 and 3 with identical filters and persisted presentation settings.

- [ ] **Step 1: Write failing toolbar and toggle tests**

```tsx
it('keeps type, open-only, and family filters in one unlabeled toolbar', () => {
  render(<DeadlineWorkspace />);
  const toolbar = screen.getByRole('group', { name: 'Deadline filters' });
  for (const name of ['Statutory', 'Client', 'Internal', 'Open only', 'Accounting']) {
    expect(within(toolbar).getByRole('button', { name })).toBeVisible();
  }
  expect(screen.queryByText('Filter families')).not.toBeInTheDocument();
});

it('uses the same filters after switching calendar mode', () => {
  render(<DeadlineWorkspace />);
  fireEvent.click(screen.getByRole('button', { name: 'Calendar view' }));
  expect(screen.getByRole('button', { name: 'Statutory' })).toHaveAttribute('aria-pressed', 'true');
});
```

- [ ] **Step 2: Write failing month-count and event tests**

```tsx
it('shows two desktop months and persists a three-month choice', async () => {
  mediaQueryMock.mockReturnValue(true);
  render(<DeadlineCalendar />);
  expect(screen.getAllByRole('grid', { name: /calendar/i })).toHaveLength(2);
  fireEvent.change(screen.getByLabelText('Visible months'), { target: { value: '3' } });
  expect(preferenceMutation).toHaveBeenCalledWith(expect.objectContaining({
    key: 'services.deadlines.view.v1', value: expect.objectContaining({ monthCount: 3 }),
  }));
});

it('shows company label and full name in an event popover', () => {
  render(<DeadlineEvent occurrence={occurrence} />);
  expect(screen.getByText('OACS')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: /OACS Annual Return/ }));
  expect(screen.getByText('Oaktree Accounting & Corporate Solution Pte. Ltd.')).toBeVisible();
});
```

- [ ] **Step 3: Run component tests and verify missing views**

Run: `npm.cmd run test:run -- __tests__/components/deadline-workspace.test.tsx __tests__/components/deadline-calendar.test.tsx`

Expected: FAIL because the views are absent.

- [ ] **Step 4: Implement URL-backed filters and preferences**

URL keys are `tab`, `deadlineView`, `from`, `to`, `types`, `families`, `companies`, `openOnly`, `origin`, `sortBy`, `sortOrder`, and `page`. Preference payloads are versioned:

```ts
export const deadlineViewPreferenceSchema = z.object({
  version: z.literal(1),
  defaultView: z.enum(['TABLE', 'CALENDAR']),
  monthCount: z.union([z.literal(1), z.literal(2), z.literal(3)]).nullable(),
  visibleTypes: z.array(z.enum(['STATUTORY', 'CLIENT', 'INTERNAL'])),
  familyIds: z.array(z.string().uuid()).max(50),
});
```

URL values override preferences. A null month count means responsive default: one below large desktop, two at/above it. The focus month comes from URL and defaults to current Singapore month.

- [ ] **Step 5: Implement table and calendar**

The table uses columns/date/status/company/service/milestone/type/cycle/origin/actions, alternate rows, inline filters, active badges, resizable saved columns, responsive cards, and server pagination.

Build the calendar with date-fns month grids and DayPicker primitives already installed; do not add a calendar dependency. Limit visible day events based on viewport and render a keyboard-accessible `+N more`. Use family color plus text/icon state. Mobile shows one month and a selected-day agenda.

- [ ] **Step 6: Expand the workspace tabs**

`ServicesWorkspace` now renders `Services` and `Deadlines`; tab selection is URL-backed. Deadline table/calendar toggles stay within `tab=deadlines`.

- [ ] **Step 7: Run component and browser tests**

Run: `npm.cmd run test:run -- __tests__/components/deadline-workspace.test.tsx __tests__/components/deadline-calendar.test.tsx __tests__/components/services-workspace.test.tsx`

Expected: PASS.

Run: `npm.cmd run test:browser -- __tests__/browser/services-deadlines.browser.test.tsx`

Expected: PASS at desktop, tablet, and mobile viewport fixtures.

- [ ] **Step 8: Commit deadline views**

```bash
git add src/components/services/deadlines src/components/services/services-workspace.tsx src/lib/validations/services-preferences.ts __tests__/components/deadline-workspace.test.tsx __tests__/components/deadline-calendar.test.tsx __tests__/components/services-workspace.test.tsx __tests__/browser/services-deadlines.browser.test.tsx
git commit -m "feat: add deadline table and calendar views"
```

---

### Task 13: Implement manual historical-cycle preview and apply

**Files:**
- Create: `src/services/deadline/manual-cycle.ts`
- Modify: `src/services/deadline/index.ts`
- Create: `src/app/api/client-services/[id]/deadline-cycles/preview/route.ts`
- Create: `src/app/api/client-services/[id]/deadline-cycles/route.ts`
- Create: `src/components/services/deadlines/manual-cycle-dialog.tsx`
- Modify: `src/components/services/roster/service-roster.tsx`
- Modify: `src/components/companies/company-detail/company-services-tab.tsx`
- Create: `__tests__/services/manual-deadline-cycle.test.ts`
- Create: `__tests__/api/manual-deadline-cycle-routes.test.ts`
- Create: `__tests__/components/manual-cycle-dialog.test.tsx`

**Interfaces:**
- Consumes: pure evaluator, client-rule config, deadline service.
- Produces: preview/apply `MANUAL_TRIGGER` cycles with selected adjustments and no billing side effect.

- [ ] **Step 1: Write failing no-write preview and no-billing apply tests**

```ts
it('previews a complete historical cycle without writes', async () => {
  const preview = await previewManualDeadlineCycle(input, actor);
  expect(preview.milestones).toHaveLength(3);
  expect(prismaMock.serviceCycle.create).not.toHaveBeenCalled();
});

it('creates only selected manual deadlines and never billing occurrences', async () => {
  await createManualDeadlineCycle({
    ...input,
    selections: [
      { milestoneKey: 'client-records', scheduleEntryKey: '', include: true, operativeDueDate: '2024-02-01', status: 'COMPLETED' },
      { milestoneKey: 'statutory-filing', scheduleEntryKey: '', include: false },
    ],
  }, actor);
  expect(prismaMock.serviceCycle.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ origin: 'MANUAL_TRIGGER' }) }));
  expect(prismaMock.serviceScheduleReconciliationRequest.upsert).not.toHaveBeenCalled();
  expect(prismaMock.clientServiceFeeLine.updateMany).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run manual-cycle tests and verify failure**

Run: `npm.cmd run test:run -- __tests__/services/manual-deadline-cycle.test.ts __tests__/api/manual-deadline-cycle-routes.test.ts`

Expected: FAIL because manual-cycle services/routes are absent.

- [ ] **Step 3: Define preview/apply schemas**

Preview requires client service ID from route, rule version ID, historical period start/end/key, parameter overrides, schedule entries, and optional source values. Apply additionally requires preview fingerprint, notes, and one selection per evaluated identity with include, operative date, target Open/Completed state, and optional completion date.

- [ ] **Step 4: Implement preview and serializable apply**

Preview calls the same pure evaluator with the requested published version and returns all milestones plus explanations. Apply reloads the same sources, recomputes and verifies the fingerprint, creates a new generation key and `MANUAL_TRIGGER` cycle, inserts selected occurrences with explicit override metadata for adjusted dates, and audits excluded/completed choices.

Do not call billing reconciliation or create a schedule reconciliation request from this operation.

- [ ] **Step 5: Implement routes and dialog**

Both routes load the client service tenant-safely and require `company:update`. The dialog has period/rule inputs, Preview, selectable milestone rows, date/status edits, notes, and an Apply button disabled until a current preview exists.

- [ ] **Step 6: Run service/API/component tests**

Run: `npm.cmd run test:run -- __tests__/services/manual-deadline-cycle.test.ts __tests__/api/manual-deadline-cycle-routes.test.ts __tests__/components/manual-cycle-dialog.test.tsx`

Expected: PASS.

- [ ] **Step 7: Commit manual historical cycles**

```bash
git add src/services/deadline/manual-cycle.ts src/services/deadline/index.ts src/app/api/client-services/[id]/deadline-cycles src/components/services/deadlines/manual-cycle-dialog.tsx src/components/services/roster/service-roster.tsx src/components/companies/company-detail/company-services-tab.tsx __tests__/services/manual-deadline-cycle.test.ts __tests__/api/manual-deadline-cycle-routes.test.ts __tests__/components/manual-cycle-dialog.test.tsx
git commit -m "feat: trigger manual historical deadline cycles"
```

---

### Task 14: Build Deadline Rules and Business Calendar administration

**Files:**
- Create: `src/hooks/use-deadline-rules.ts`
- Create: `src/hooks/use-service-calendars.ts`
- Create: `src/components/services/admin/deadline-rules-panel.tsx`
- Create: `src/components/services/admin/deadline-rule-form.tsx`
- Create: `src/components/services/admin/business-calendar-panel.tsx`
- Create: `src/components/services/admin/rule-impact-dialog.tsx`
- Modify: `src/components/services/admin/services-admin-page.tsx`
- Modify: `src/components/services/admin/catalog/service-variant-form.tsx`
- Create: `__tests__/components/deadline-rules-admin.test.tsx`
- Create: `__tests__/components/business-calendar-admin.test.tsx`

**Interfaces:**
- Consumes: rule/calendar APIs, generic schedule editor, variant associations.
- Produces: mockup views 6 and 7 and final three-tab Administration page.

- [ ] **Step 1: Write failing administration-tab and publish-preview tests**

```tsx
it('renders all three administration tabs', () => {
  render(<ServicesAdminPage />);
  for (const name of ['Service catalog', 'Deadline rules', 'Business calendar']) {
    expect(screen.getByRole('tab', { name })).toBeVisible();
  }
});

it('requires a current impact preview before publishing', async () => {
  render(<DeadlineRulesPanel />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit Annual Return' }));
  expect(screen.getByRole('button', { name: 'Publish rule' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Preview impact' }));
  await screen.findByText('Recalculated');
  expect(screen.getByRole('button', { name: 'Publish rule' })).toBeEnabled();
});
```

- [ ] **Step 2: Run admin component tests and verify missing panels**

Run: `npm.cmd run test:run -- __tests__/components/deadline-rules-admin.test.tsx __tests__/components/business-calendar-admin.test.tsx`

Expected: FAIL because panels/hooks do not exist.

- [ ] **Step 3: Implement React Query hooks**

Use separate rule list/detail/impact keys. Rule create/update/publish/archive invalidates rule list/detail/impact plus service-catalog associations; calendar update invalidates calendar list/detail/impact; both publish and calendar update invalidate pending reconciliation summaries. Publish payload includes current version, draft revision/hash, and preview fingerprint returned by the current preview call.

- [ ] **Step 4: Build rule administration**

The form edits identity, recurrence, applicability groups, typed parameters, generic schedule defaults, and milestone rows. Milestones select type and once-per-cycle/entry behavior and build only validated expression operations. Show current published version and immutable version history.

The impact dialog lists all eight count groups and up to 100 samples. Archive also requires reason and current impact preview.

- [ ] **Step 5: Build calendar administration and catalog associations**

Calendar UI edits weekend days and named holidays, previews date changes, and submits expected revision/fingerprint. Variant form gains a Deadline rules section with enabled-by-default, parameter defaults, schedule defaults, and display order.

- [ ] **Step 6: Run admin UI tests**

Run: `npm.cmd run test:run -- __tests__/components/deadline-rules-admin.test.tsx __tests__/components/business-calendar-admin.test.tsx __tests__/components/services-admin-page.test.tsx __tests__/components/service-catalog.test.tsx`

Expected: PASS.

- [ ] **Step 7: Commit administration rule/calendar UI**

```bash
git add src/hooks/use-deadline-rules.ts src/hooks/use-service-calendars.ts src/components/services/admin __tests__/components/deadline-rules-admin.test.tsx __tests__/components/business-calendar-admin.test.tsx __tests__/components/services-admin-page.test.tsx __tests__/components/service-catalog.test.tsx
git commit -m "feat: administer deadline rules and calendars"
```

---

### Task 15: Verify rollout, observability, isolation, performance, and documentation

**Files:**
- Create: `__tests__/integration/deadline-tenant-isolation.postgres.test.ts`
- Create: `__tests__/integration/deadline-performance.postgres.test.ts`
- Modify: `src/app/api/client-services/route.ts`
- Modify: `src/app/api/deadlines/route.ts`
- Modify: `src/services/schedule-reconciliation/worker.ts`
- Modify: `docs/guides/SERVICE_PATTERNS.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: complete Plan 2 behavior.
- Produces: timing headers, structured scheduler summaries, rollout documentation, and acceptance evidence.

- [ ] **Step 1: Write tenant-isolation and idempotency PostgreSQL tests**

```ts
it('cannot list or mutate another tenant deadline', async () => {
  const list = await listDeadlines(search, tenantOneRestrictedScope);
  expect(list.items).not.toContainEqual(expect.objectContaining({ tenantId: tenantTwo.id }));
  await expect(updateDeadlineOccurrence(tenantTwoDeadline.id, patch, tenantOneActor)).rejects.toMatchObject({ statusCode: 404 });
});

it('produces one occurrence identity after three retries', async () => {
  await Promise.all([
    reconcileClientServiceDeadlines(input),
    reconcileClientServiceDeadlines(input),
    reconcileClientServiceDeadlines(input),
  ]);
  expect(await prisma.deadlineOccurrence.count({ where: identityWhere })).toBe(1);
});
```

- [ ] **Step 2: Add representative performance fixtures and assertions**

Seed 1,000 Companies, 10,000 ClientServices, and 100,000 DeadlineOccurrences in one isolated test tenant with bulk `createMany`. Run the roster and two-month deadline calendar service queries and assert:

```ts
expect(rosterDurationMs).toBeLessThanOrEqual(1500);
expect(calendarDurationMs).toBeLessThanOrEqual(1500);
expect(calendarResult.items.length).toBeLessThanOrEqual(5000);
```

Gate wall-clock assertions behind `RUN_PERFORMANCE_TESTS=true`; always run `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` assertions that the tenant/date/status indexes are used.

- [ ] **Step 3: Add request timing and structured reconciliation summaries**

Use `jsonWithServerTiming` for roster and deadline list routes. Log one structured event per reconciliation request with tenant ID, request/correlation ID, duration, created/recalculated/cancelled/preserved counts, warnings, attempt, and write mode. Do not log Company document content or free-text notes.

- [ ] **Step 4: Document flags, jobs, and operational recovery**

Add to `SERVICE_PATTERNS.md`:

```markdown
## Deadline reconciliation operations

- `Workspace.settings.servicesWorkspace.enabled` controls the operational page.
- `Workspace.settings.servicesWorkspace.deadlineWritesEnabled` or `DEADLINE_OCCURRENCE_WRITES_ENABLED=true` enables materialization.
- Observation mode computes impact summaries without writing cycles or deadlines.
- The scheduler task ID is `service-schedule-reconciliation` and runs each minute.
- Failed requests retain safe errors and retry according to the 1/5/15/60/240-minute schedule.
- A daily `ROLLING_HORIZON` request extends materialization to 12 months from the Singapore date.
```

Add package scripts:

```json
"test:deadlines:postgres": "vitest run __tests__/integration/deadline-reconciliation.postgres.test.ts __tests__/integration/deadline-tenant-isolation.postgres.test.ts",
"test:deadlines:performance": "vitest run __tests__/integration/deadline-performance.postgres.test.ts"
```

- [ ] **Step 5: Run the complete verification matrix**

Run: `npm.cmd run db:generate`

Expected: PASS.

Run: `npm.cmd run test:run -- __tests__/lib/service-schedule-validation.test.ts __tests__/services/service-schedule-date-engine.test.ts __tests__/services/deadline-rule-evaluator.test.ts __tests__/services/business-calendar.service.test.ts __tests__/services/deadline-rule.service.test.ts __tests__/services/deadline-rule-impact.test.ts __tests__/services/schedule-reconciliation.test.ts __tests__/services/schedule-reconciliation-scheduler.test.ts __tests__/services/service-roster.service.test.ts __tests__/services/deadline.service.test.ts __tests__/services/manual-deadline-cycle.test.ts __tests__/api/service-calendar-routes.test.ts __tests__/api/deadline-rule-routes.test.ts __tests__/api/service-roster-route.test.ts __tests__/api/deadline-routes.test.ts __tests__/api/manual-deadline-cycle-routes.test.ts __tests__/components/schedule-entry-editor.test.tsx __tests__/components/service-roster.test.tsx __tests__/components/services-workspace.test.tsx __tests__/components/deadline-workspace.test.tsx __tests__/components/deadline-calendar.test.tsx __tests__/components/manual-cycle-dialog.test.tsx __tests__/components/deadline-rules-admin.test.tsx __tests__/components/business-calendar-admin.test.tsx`

Expected: PASS.

Run: `npm.cmd run test:deadlines:postgres`

Expected: PASS with `TEST_DATABASE_URL` set to an isolated PostgreSQL database.

Run: `npm.cmd run test:browser -- __tests__/browser/services-deadlines.browser.test.tsx`

Expected: PASS.

Run: `npm.cmd run lint`

Expected: PASS with no new warnings in changed files.

Run: `npm.cmd run build`

Expected: PASS.

- [ ] **Step 6: Apply and inspect the additive migration in isolation**

Run: `npm.cmd run db:migrate`

Expected: new models, starter drafts, constraints, and partial indexes apply without modifying existing service/client-service rows.

Run: `rg -n "payroll" src/services/service-schedule src/lib/validations/service-schedule.ts src/components/services/shared/schedule-entry-editor.tsx`

Expected: no payroll-specific branch or type in the shared engine/editor.

- [ ] **Step 7: Commit acceptance coverage and operations documentation**

```bash
git add __tests__/integration/deadline-tenant-isolation.postgres.test.ts __tests__/integration/deadline-performance.postgres.test.ts src/app/api/client-services/route.ts src/app/api/deadlines/route.ts src/services/schedule-reconciliation/worker.ts docs/guides/SERVICE_PATTERNS.md package.json
git commit -m "test: verify deadline workspace acceptance"
```

## Plan 2 completion gate

Before starting Plan 3, verify:

- The shared engine handles any family and four-or-more repeatable entries without special cases.
- Second-last working day and relative business/calendar offsets pass unit tests.
- Company stored dates win over configured fallbacks.
- XBRL-style entity-type applicability produces Not applicable with a reason.
- Preview/publish fingerprints prevent stale rule or calendar impact application.
- Reconciliation preserves every protected history/override category and is idempotent under retry.
- `/services` provides the roster and matching Deadline table/calendar results.
- Family filters have the exact approved placement and clickable behavior.
- Calendar month count defaults responsively and persists one/two/three choices.
- Manual historical cycles create no billing occurrence or billing reconciliation request.
- Admin rule/calendar views, isolation, audit, migration, test, lint, and build gates pass.
- Plan 3 can import `src/services/service-schedule` and `src/services/schedule-reconciliation` without changing their public contracts.

## Repair addendum (2026-08-27)

The 27 August 2026 investigation found that deadline preview and write-mode
reconciliation diverged: an annual company-date source inside a rolling period
could be shifted into the wrong year, the editor used a handwritten local
calculator, and several services persisted incorrect historical occurrences.

The dated repair plan
[\docs/superpowers/plans/2026-08-27-deadline-preview-reconciliation-repair.md\](../plans/2026-08-27-deadline-preview-reconciliation-repair.md)
supersedes the weak "one or more" fixed-date acceptance language above with
exact occurrence identity and date requirements:

- For \	oday = 2026-08-27\, \horizonEnd = 2027-08-27\, and
  \ccountsDueDate = 2027-07-31\, \SG_ANNUAL_RETURN\ contains exactly one
  occurrence on \2027-07-31\ and AGM exactly one on \2027-06-30\ � never
  \2026-07-31\.
- Authoritative backlog (codes \SG_AGM_DUE\/\SG_ANNUAL_RETURN\ only)
  generates annual cycles from \Company.accountsDueDate\ through the rolling
  horizon, capped at the most recent 20 cycles with an
  \AUTHORITATIVE_BACKLOG_TRUNCATED\ warning. No other rule gains historical
  backlog.
- Client-service impact preview and write reconciliation produce identical
  normalized tuples; the editor renders the server projection only.
- Normal reconciliation still preserves every protected lifecycle category.
- Incorrect existing occurrences are repaired only through the audited,
  dry-run-first, fingerprint-gated \
pm run repair:deadlines\ command.
