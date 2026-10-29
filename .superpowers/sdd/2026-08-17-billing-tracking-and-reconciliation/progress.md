# SDD ledger — plan: docs/superpowers/plans/2026-08-17-billing-tracking-and-reconciliation.md

## Execution context

- Worktree: `C:\Users\Scotfield\OneDrive\Documents\Python Project\oakcloud_development\oakcloud\.worktrees\services-administration`
- Branch: `codex/services-administration`
- Task scope: Tasks 1–6 complete — billing persistence, schedules/backfill, occurrence/coverage reconciliation, client-service configuration, and occurrence lifecycle APIs.
- Implementation model: `gpt-5.6-luna`, reasoning `max`.
- Review model: `gpt-5.6-sol`, reasoning `medium`.
- Final branch review: `gpt-5.6-sol`, reasoning `xhigh`.
- Repository baseline/full build/full lint/live migration/performance gates remain deferred until all Plan 3 tasks, per the accepted Plan 2 handoff. Focused RED/GREEN tests, TypeScript, scoped lint, Prisma generation/validation/format, and diff checks remain required.

## Authority and dependency audit

- Approved specification: `docs/superpowers/specs/2026-08-17-services-administration-deadlines-billing-design.md` (read in full).
- Plan 3: `docs/superpowers/plans/2026-08-17-billing-tracking-and-reconciliation.md` (Global Constraints, public interfaces, and Task 1 read in full).
- Plan 2 handoff: `docs/superpowers/plans/2026-08-17-deadline-engine-and-services-workspace.md` (schema/migration conventions and accepted shared schedule/reconciliation contracts read).
- Repository guidance read: `AGENTS.md`, `docs/guides/SERVICE_PATTERNS.md`, `docs/guides/RBAC_GUIDELINE.md`; `docs/guides/DESIGN_GUIDELINE.md` was reviewed for scope and is UI-only for this persistence task.

## Preflight contract scan

| Plan item | Produces / consumes | Finding and ruling |
|---|---|---|
| Task 1 self-consistency | `prisma/schema.prisma`, billing migration, schema contract test | Consistent: migration adds only new billing enums/tables and nullable/defaulted existing fields; the contract test observes mapped fields, relations, identity/partial indexes, and migration constraints. Ruling: use migration-managed partial uniqueness and checks rather than Prisma declarations where the plan requires it. |
| Task 1 → Task 2 | Billing disposition and active/archive fee-line fields | Task 2 consumes `UNREVIEWED`, `scheduleConfig`, `isActive`, `deletedAt`, and `deletedReason`; no conflicting ownership. Ruling: preserve legacy frequency/start/amount/currency columns. |
| Task 1 → Task 3 | Occurrence identity and lifecycle metadata | Task 3 consumes the five-part generation identity and Restrict source relations. Ruling: no invoice/payment semantics or extra generation path. |
| Task 1 → Task 4 | Coverage issue lineage and open uniqueness | Task 4 consumes nullable fee-line lineage and unresolved issue uniqueness. Ruling: retain rows and resolve by timestamp; do not hard-delete issue history. |
| Task 1 → Task 5 | Status/override/amount metadata | Task 5 consumes Open/Billed/Waived/Cancelled fields and optional billed date. Ruling: follow the explicit consistency checks in Task 1; billed date remains outside Billed equivalence. |
| Task 1 → Tasks 6–15 | Prisma relations and existing service/client forms/workspace | Later tasks consume generated client relations and fields; no Task 1 UI/API implementation is allowed. Ruling: keep this task persistence-only. |

## Shared invariants recorded for Task 1

- Billing remains manual tracking only; no invoice, payment, or ledger model is introduced.
- Every new billing row is tenant-scoped and carries company/client-service lineage; source references are restrictive to preserve history.
- Existing client services default to `UNREVIEWED`; existing fee lines remain compatible while becoming soft-archivable.
- Billing occurrence identity is tenant + fee line + period + schedule entry + generation key; the open coverage issue index is tenant + issue key where unresolved.
- `billedDate` is optional and is intentionally absent from the Billed consistency equivalence.

## Task status

| Task | Status | Commit | Review |
|---|---|---|---|
| 1 | PASS / final-review-complete | `66197f3c`, `960d0778`, `e530c522` | `final review PASS (0 Critical / 0 Important / 0 Minor)` |
| 2 | PASS / task-review-complete | `fcad7bba`, `1e3829e4` | `5 Important addressed; no new breakage; 1 Minor deferred` |
| 3 | PASS / task-review-complete | `c36f141a`, `4f638b17`, `9a7df209`, `baa1e7e1` | `all findings addressed; no new breakage` |
| 4 | PASS / task-review-complete | `f6c5c0ac`, `7e1353e2` | `4 Important and 2 Minor addressed; final 0 / 0 / 0` |
| 5 | PASS / task-review-complete | `b809cbda`, `9c4ac9c3`, `c6e91916` | `8 Important and 1 Minor addressed across two rounds; final 0 / 0 / 0` |
| 6 | PASS / task-review-complete | `077e6876`, `97f6eb12` | `1 Important and 1 Minor addressed; final 0 / 0 / 0` |

## RED evidence

- `npm.cmd run test:run -- __tests__/services/billing-tracking-schema.test.ts` — FAIL, 1 file / 8 tests failed because billing enums/models/migration/indexes are absent. This is the expected missing-feature RED state.

## Review correction RED evidence

- Independent review `task-1-review.md` reported 5 Important and 2 Minor findings against `66197f3c`.
- After adding regression assertions for composite lineage, explicit disposition NULL rejection, actor retention, lifecycle metadata, override equivalence, and archive invariants, `npm.cmd run test:run -- __tests__/services/billing-tracking-schema.test.ts --reporter=dot` failed for the intended missing composite/check clauses (2 failed / 6 passed).

## Review correction decisions

- I1: Companies, client services, and fee lines now expose composite tenant/identity uniques in Prisma and SQL. Billing occurrence/coverage rows use composite FKs for tenant→company, tenant/company→client service, and tenant/client service→fee line; the existing company `tenantId` column mapping is preserved.
- I2: `NOT_REQUIRED` requires non-NULL `btrim` length ≥ 3; all other dispositions require a NULL reason.
- I3: Actor foreign keys use `ON DELETE RESTRICT` in Prisma and SQL, retaining immutable actor IDs required by active override/lifecycle checks.
- I4: Billed, waived, and cancelled checks require complete timestamp/actor/reason metadata and prohibit stray metadata in other statuses. `billed_date` is NULL unless status is BILLED, where it remains optional.
- I5: Unoverridden dates and values require calculated/operative equality; override metadata remains complete when flags are true.
- M1: Fee lines use one canonical state: active rows have no archive metadata; inactive rows require archive timestamp and a trimmed reason of at least three characters.
- M2: `__tests__/integration/billing-tracking-integrity.postgres.test.ts` applies the billing migration only inside a random isolated schema when `TEST_DATABASE_URL` is supplied; it intentionally skips locally without that variable and has a CI configuration guard.

## GREEN evidence and scope notes

- `npm.cmd run db:generate` — PASS; Prisma Client 7.2.0 generated and normalized (15 generated files changed, including `BillingOccurrence` and `BillingCoverageIssue` model outputs).
- `npm.cmd run test:run -- __tests__/services/billing-tracking-schema.test.ts --reporter=dot` — PASS, 1 file / 8 tests.
- `npm.cmd run test:run -- __tests__/services/deadline-engine-schema.test.ts --reporter=dot` — PASS, 1 file / 25 tests; `services-admin-foundation-schema.test.ts` — PASS, 1 file / 2 tests.
- `npx.cmd tsc --noEmit` — PASS, exit 0.
- `npx.cmd eslint __tests__/services/billing-tracking-schema.test.ts` — PASS, exit 0 with zero warnings/errors.
- `$env:DATABASE_URL='postgresql://test:test@localhost:5432/test'; npx.cmd prisma validate` — PASS; schema valid. `npx.cmd prisma format` was run during implementation and exited 0; untouched legacy field spacing was restored afterward to preserve existing exact-string schema tests.
- `git diff --check` — PASS.
- Final post-commit focused run `npm.cmd run test:run -- __tests__/services/billing-tracking-schema.test.ts __tests__/services/deadline-engine-schema.test.ts __tests__/services/services-admin-foundation-schema.test.ts --reporter=dot` — PASS, 3 files / 35 tests.
- Final post-commit `npx.cmd tsc --noEmit`, scoped ESLint, and Prisma validation — PASS (all exit 0).
- Review-correction focused run including billing/deadline/admin schema suites and PostgreSQL integrity suite — PASS, 3 files / 35 tests; PostgreSQL suite intentionally skipped 4 tests locally without `TEST_DATABASE_URL`.
- Review-correction `npm.cmd run db:generate` — PASS; Prisma Client 7.2.0 regenerated for composite relations and Restrict actor actions.
- Review-correction `npx.cmd tsc --noEmit`, scoped zero-warning ESLint, Prisma validate, and `git diff --check` — PASS.
- Final correction verification: `npm.cmd run test:run -- __tests__/services/billing-tracking-schema.test.ts __tests__/integration/billing-tracking-integrity.postgres.test.ts __tests__/services/deadline-engine-schema.test.ts __tests__/services/services-admin-foundation-schema.test.ts --reporter=dot` — PASS, 3 files / 35 tests; PostgreSQL suite 1 file / 4 tests intentionally skipped locally.
- Final correction `npx.cmd tsc --noEmit` — PASS, exit 0; scoped ESLint with `--max-warnings=0` — PASS; Prisma validate — PASS; `git diff --check` — PASS.
- Task 1 closeout added an explicit successful PostgreSQL assertion for a valid `BillingCoverageIssue` with `fee_line_id = NULL`; required tenant/company/client-service lineage remains populated. The closeout is committed as `e530c522` (`test: cover nullable billing issue lineage`). Local gated verification passed the billing schema (8/8) and intentionally skipped the PostgreSQL suite's 4 tests without `TEST_DATABASE_URL`.
- Task 1 final review `task-1-final-review.md` — PASS, 0 Critical / 0 Important / 0 Minor. The earlier correction commit is `960d0778` (`fix: enforce billing tracking integrity`).
- Known unrelated baseline exact-format failures remain isolated in `client-service-schema.test.ts`, `service-catalog-schema.test.ts`, and `service-agreement-schema.test.ts`; their expectations are absent at both base and corrected heads and are outside Task 1.
- The primary session staged and committed the closeout test after the implementation subagent's worktree index-lock attempt failed; no lock or ACL was deleted or changed.
- No migration apply, live Postgres, repository-wide build/lint, or performance gate was run; those remain deferred until all Plan 3 tasks.

## Historical resume checkpoint after Task 1

- Pause point: Plan 3 Task 1 is complete and independently accepted at `e530c522`.
- Next work: begin Plan 3 Task 2, `Define fee schedules and migrate existing billing frequencies`.
- At that checkpoint, Task 2 and all later Plan 3 tasks had not started. The current status is recorded below.
- Continue using `gpt-5.6-luna` at `max` for implementation, `gpt-5.6-sol` at `medium` for each task review, and `gpt-5.6-sol` at `xhigh` for the final whole-branch review.
- Keep the repository-wide baseline, full build/full lint, live migrations/PostgreSQL, and wall-clock performance gates deferred until all Plan 3 tasks are implemented.

## Task 2 — fee schedules and billing-frequency backfill

### Status

- PASS / task review complete.
- Implementation commit `fcad7bba`; fix-round commit `1e3829e4`.
- Task 1 history above is unchanged.

### Implemented

- Added the version-1 billing schedule schema, legacy-frequency conversion, shared date-only/business-day evaluation, and public billing exports.
- Added the mapped SQL migration for deterministic schedule snapshots, CUSTOM/missing-start coverage issues, and one idempotent pending tenant-scoped `BILLING_BACKFILL` request per active non-deleted tenant.
- Preserved legacy amount/currency fields, composite tenant lineage, fee-line archive/status constraints, `UNREVIEWED`, and manual-only billing semantics.
- Added unit/contract tests plus a `TEST_DATABASE_URL`-guarded isolated PostgreSQL migration/idempotency/tenant-isolation test.

### Evidence

- Initial equivalent collected RED: 3 new Task 2 suites failed collection because the billing contracts/migration were absent.
- Equivalent focused GREEN: 3 files / 18 tests passed.
- PostgreSQL migration suite: 1 file / 1 test skipped locally without `TEST_DATABASE_URL`.
- Shared schema/date/schedule compatibility: 3 files / 40 tests passed.
- TypeScript (`npx.cmd tsc --noEmit`): exit 0.
- Scoped zero-warning ESLint: exit 0.
- Prisma validation: schema valid, exit 0.
- Diff/whitespace checks: no findings.
- Restricted subagent execution encountered `Cannot read directory "../../../../../../..": Access is denied`. A fresh primary-session run of the exact focused worktree command with the required permission passed 23 tests; the PostgreSQL suite remained one intentional skip.

### Commit and deferred gates

- The primary session staged and committed the verified implementation and fix after the subagent's worktree index-lock attempts failed; no lock or ACL was changed.
- Repository-wide build/full lint, live migration/PostgreSQL, and performance gates remain deferred until all Plan 3 tasks are complete.

### Task 2 review and rulings

- Initial review against `fcad7bba`: spec FAIL / quality Needs fixes; 0 Critical, 5 Important, 1 Minor.
- Ruling: `BillingScheduleConfigV1` continues to reuse the shared `ScheduleEntry` schema and primitives, but its billing-specific validation must reject source and operand variants that cannot be resolved from the fee-schedule evaluator's declared input. The approved spec requires one shared language, not acceptance of configurations that can only fail at evaluation time. Cost if wrong: future Company-field, parameter, or milestone-based billing formulas will require an explicit evaluator-input and schema-version extension rather than becoming silently accepted now.
- Task 2: minor (deferred): ONE_TIME accepts multiple entries but deterministically emits only the lexical first entry. Final whole-branch review must reconcile the brief's "at most one item" wording with the approved generic repeatable-entry contract before merge.
- Fix round 1/5 implemented for: end-range look-ahead after business-day adjustment; canonical cadence/interval consistency; actual start-date lower bounds; billing-unresolvable shared expressions; non-destructive backfill reruns. Amended focused verification passed 3 files / 23 tests, compatibility passed 3 files / 40 tests, PostgreSQL remained an intentional local skip, and TypeScript/scoped lint/Prisma validation/diff checks passed.
- Fix round 1/5 scoped rereview: all 5 Important findings ADDRESSED, no new breakage; commit `1e3829e4`.
- Task 2: complete (commits `95275e4c..1e3829e4`, review clean; 1 Minor deferred to final whole-branch review).

## Task 3 — rolling billing occurrence reconciliation

### Initial implementation and review

- Initial implementation commit `c36f141a` (`feat: reconcile billing tracking occurrences`).
- Focused implementation evidence: 5 files / 67 tests passed; the isolated PostgreSQL suite remained one intentional local skip without `TEST_DATABASE_URL`. TypeScript, scoped zero-warning ESLint, Prisma validation, and diff checks passed.
- Independent Task 3 review: not spec compliant / needs fixes; 1 Critical, 3 Important, 1 Minor.
- Critical: read-then-write recalculation/cancellation did not reassert lifecycle and override eligibility, and APPLY counts were not based on affected-row counts.
- Important: actor-less rolling cancellations could not persist but were reported as cancelled; fee-only changes did not enqueue actor-backed reconciliation; archived fee lines leaked through the public DTO/edit flow.
- Minor: guarded PostgreSQL coverage exercised concurrent creation but not the production update/cancellation race paths.

### Task 3 cancellation-provenance ruling

- Ruling: automatic `BillingOccurrence` cancellation is attributed to the durable `ServiceScheduleReconciliationRequest`, never to a synthetic or arbitrarily selected user. A cancelled occurrence must retain `cancelledAt`, a trimmed reason, and at least one durable attribution source: a human `cancelledById` and/or a restrictive reconciliation-request reference. Worker cancellations always retain the request reference and additionally retain `requestedById` when present; later manual lifecycle APIs may use a human actor without a reconciliation request. Non-cancelled rows retain no cancellation metadata or provenance.
- Reason: daily `ROLLING_HORIZON` requests intentionally have no requesting user, while Task 3 must persist automatic cancellations and Task 1 correctly prohibited anonymous, unauditable lifecycle writes. Request provenance resolves both requirements without falsifying user attribution.
- Cost if wrong: this adds one persisted relation and forward migration to billing occurrences; downstream lifecycle APIs, serializers, exports, and retention policies must preserve or explicitly expose that provenance rather than assuming every cancellation has a human actor.
- Fix round 1/5 commit `4f638b17` addressed request provenance, fee-only enqueueing, archived fee-line visibility, generation lifecycle, destructive concurrent transitions, and affected-row counts.
- Scoped rereview: actor-less cancellation provenance, fee-only enqueue, and archived fee-line behavior ADDRESSED; concurrency/counts and PostgreSQL production-path coverage PARTIALLY ADDRESSED; no distinct new breakage.
- Remaining Critical gap: an unrelated optimistic collision reloads a still-eligible future Open row but misclassifies it as historical instead of retrying, so the worker can complete with stale state.
- Remaining Minor gap: PostgreSQL races cover the production reconciler directly but not the production per-service worker transaction/lease helper.
- Fix round 2/5 is assigned to the same `gpt-5.6-luna` max implementer for bounded eligible-row retry/transient exhaustion and guarded production worker-path coverage.
- Fix round 2/5 commit `9a7df209` added bounded retry/transient conflict handling and the production per-service worker transaction helper with guarded PostgreSQL coverage. Controller verification passed 89 focused tests with one guarded skip plus TypeScript/scoped lint/diff checks.
- Round-2 rereview: production worker-path coverage ADDRESSED; concurrency PARTIALLY ADDRESSED because an unrelated collision on a row already overridden at initial read skips the required hidden calculated/base refresh. New Minor: helper comment incorrectly said serializable although it uses the configured/default transaction isolation.
- Fix round 3/5 is assigned to the same `gpt-5.6-luna` max implementer for unchanged-pre-existing-override retry coverage and the transaction-comment correction.
- Fix round 3/5 commit `baa1e7e1` preserves pre-existing date/value overrides across unrelated optimistic collisions while refreshing hidden calculated/base values, and corrects the transaction-isolation comment.
- Controller final focused verification: 6 files passed plus 1 guarded skip; 91 tests passed plus 1 skipped. TypeScript, scoped zero-warning ESLint, and diff checks passed.
- Round-3 rereview: remaining Critical ADDRESSED; transaction-comment Minor ADDRESSED; no new breakage.
- Task 3: complete (commits `bbe8d119..baa1e7e1`; final verdict PASS — spec compliant and quality acceptable for integration). The isolated live-PostgreSQL execution remains deferred to the agreed whole-implementation/release gate.

## Task 4 — materialized billing coverage reconciliation

### Implementation and evidence

- Initial implementation commit `f6c5c0ac` (`feat: reconcile billing configuration coverage`) added the seven approved coverage issue checks, deterministic SHA-256 issue keys, Observe/Apply modes, access-scoped summary and manual-reconcile APIs, normalized coverage hooks, and coverage execution inside the shared per-service worker transaction.
- Initial focused verification passed 4 files / 28 tests, TypeScript, scoped zero-warning ESLint, and diff checks.
- Initial independent review reported 0 Critical, 4 Important, and 2 Minor findings: incomplete CUSTOM schedules were misclassified; Cancelled occurrences hid genuine gaps; issue creation was not concurrency-safe; inactive-service handling synthesized a permanent false gap and diverged between Observe/Apply; structured details were lost; and exact classification/access-query coverage was incomplete.
- Fix commit `7e1353e2` (`fix: harden billing coverage reconciliation`) addressed every finding. Task 4 focused verification passed 4 files / 45 tests; prior billing reconciler/schedule reconciliation compatibility passed 2 files / 45 tests; TypeScript, scoped zero-warning ESLint, and diff checks passed.
- Final rereview `task-4-rereview.md`: PASS, 0 Critical / 0 Important / 0 Minor; all original findings ADDRESSED and no new breakage.

### Task 4 rulings

- Ruling: billing coverage treats `OPEN`, `BILLED`, and `WAIVED` occurrence identities as satisfying the expected rolling horizon. `CANCELLED` is retained as lifecycle history but does not satisfy coverage and therefore cannot hide an `OCCURRENCE_GAP`.
- Ruling: ended/deleted services do not receive an invented coverage issue for unresolved Open billing occurrences. Those occurrences remain visible through the billing-occurrence projection; only genuine pre-existing unresolved coverage issues remain in the coverage result. The obsolete synthetic Task 4 issue key, if present from an intermediate build, is resolved with Observe/Apply count parity.
- Ruling: production issue materialization uses PostgreSQL `INSERT ... ON CONFLICT` against the migration-managed partial open-issue index, preserving resolved history and returning truthful opened/refreshed outcomes. Delegate-only test clients use bounded unique-collision reload/update recovery. The raw PostgreSQL execution remains part of the deferred whole-implementation live-database gate.
- Ruling: missing required CUSTOM interval/entry data is `MISSING_SCHEDULE_PARAMETER`; structurally present but malformed custom schedules are `INVALID_CUSTOM_SCHEDULE`. Safe bounded diagnostic details retain the stable schedule key and rolling-gap context.

## Task 5 — client-service billing configuration forms and persistence

### Implementation and review evidence

- Initial implementation commit `b809cbda` (`feat: configure client service billing tracking`) added explicit Configured/Not-required/Unreviewed handling, structured fee schedules, transactional create/update/activation persistence, audit and enqueue integration, and the shared company-service form controls. Initial focused verification passed 9 files / 168 tests plus TypeScript, scoped lint, and diff checks.
- Initial review reported 0 Critical, 6 Important, and 1 Minor findings. Fix commit `9c4ac9c3` (`fix: harden client service billing configuration`) constrained billing editor capabilities, required materializable schedules, added configurable CUSTOM intervals, enforced create lifecycle invariants, canonicalized structured/legacy schedules, added bounded audit snapshots, strengthened activation/reconciliation/state-transition tests, and removed React `act(...)` warnings.
- First rereview accepted five original Important findings and the Minor, but retained one audit-lineage Important and found one new schedule-state Important. Fix commit `c6e91916` (`fix: preserve billing schedule and audit lineage`) made persistence and audit share exact fee IDs/immutable agreement lineage and preserved every authored entry/key across cadence/start edits.
- Final Task 5 verification: 10 files / 185 tests; directly affected billing/worker compatibility 7 files / 106 tests; TypeScript, scoped zero-warning ESLint, and diff checks passed. Final rereview `task-5-rereview-2.md`: PASS, 0 Critical / 0 Important / 0 Minor.

### Task 5 rulings

- Ruling: the repeatable shared schedule-entry editor remains available to every service family, but billing mode exposes only expression sources and operands the billing evaluator supports. Deadline mode retains the full expression language. This applies the accepted Task 2 evaluator-input constraint at authoring time instead of allowing save-time surprises.
- Ruling: `CONFIGURED` is a materializable state: it requires at least one active fee, an effective start date, and at least one stable schedule entry. CUSTOM recurrence exposes a validated 1–120 month interval. Default entry synthesis is limited to genuinely absent legacy configuration; ordinary cadence/start edits preserve all authored entries and keys.
- Ruling: structured `scheduleConfig` is canonical and must agree with compatibility `billingFrequency` and `billingStartDate`. One helper is shared by create, update, agreement activation, coverage, and occurrence reconciliation. Omitted legacy create disposition remains `UNREVIEWED`; explicit manual create accepts only Configured or Not required, and Not required accepts no fee rows.
- Ruling: fee/schedule audits use bounded allowlisted snapshots (up to 100 fee rows and 31 entries per row, bounded text) and must retain exact persisted fee identity and immutable agreement lineage. Switching to Not required archives active fee rows with the user's reason and queues reconciliation in the same Serializable transaction; future Open occurrences are cancelled while historical Open, Billed, and Waived rows are preserved under the existing reconciliation rules.

## Task 6 — billing occurrence list and lifecycle APIs

### Implementation and evidence

- Initial implementation commit `077e6876` (`feat: track billing occurrence status`) added strict search/mutation/reset schemas, tenant/access-scoped table and detail services, Singapore timing derivation, audited optimistic lifecycle/override mutations, enabled-workspace/RBAC routes, and normalized abortable hooks. Focused verification passed 3 files / 22 tests; directly affected compatibility passed 12 files / 153 tests; TypeScript, scoped lint, and diff checks passed.
- Initial review reported 0 Critical, 1 Important, and 1 Minor. The Important found that a historical selected occurrence used its own date as the only propagation lower bound, allowing other overdue Open rows to change. The Minor requested deeper lifecycle/filter/reset/permission/count-mismatch coverage.
- Fix commit `97f6eb12` (`fix: protect historical billing occurrences`) captured one Singapore date and used `max(selected operative date, today)` for matching future Open rows while retaining an independent optimistic update of the selected row. Expanded focused verification passed 3 files / 37 tests and the 12-file compatibility matrix / 168 tests; TypeScript, scoped zero-warning ESLint, and diff checks passed.
- Final rereview `task-6-rereview.md`: PASS, 0 Critical / 0 Important / 0 Minor; both findings ADDRESSED and no new breakage.

### Task 6 rulings

- Ruling: `THIS_AND_FUTURE` always updates the selected non-Cancelled occurrence through its own `id + tenant + expectedUpdatedAt` claim, even when the selected row is historical or Billed. Additional rows must match tenant/company/service/fee line/schedule entry/generation, remain Open, and be on or after both the selected operative date and one captured current Singapore date. Historical matching rows are never propagated.
- Ruling: user lifecycle mutations cannot set or modify Cancelled. Billed accepts an optional/null billed date; Waived and reopen transitions require reasons and maintain their exact lifecycle metadata. Date/value overrides require reasons, and reset actions restore only the requested calculated/base dimensions.
- Ruling: current-and-future selection, update, count validation, and one affected-ID/count audit occur inside the same Serializable transaction. A future count mismatch throws before audit and rolls back the selected and partial future writes together.

## Task 7 — Billing workspace and reconciliation panel

### Implementation and evidence

- Initial implementation commit `855c3752` (`feat: add billing tracking workspace`) added the Billing workspace, server-backed occurrence table/mobile cards, filters, collapsed reconciliation summary, lifecycle/reset dialogs, persisted table preferences, the third Services workspace tab, and roster billing indicators. Initial focused verification passed 14 files / 111 tests plus 2 Chromium flows, TypeScript, scoped lint, and diff checks.
- Initial independent review reported 0 Critical, 6 Important, and 2 Minor findings. Fix commit `f8ec5aad` (`fix: address Task 7 billing review findings`) omitted unchanged value fields, constrained lifecycle choices, retained mutation errors in-place, moved search/company filtering before pagination, synchronized URL state, added a dedicated roster Billing column and next-state projection, grouped reconciliation issues, exposed `aria-sort`, and expanded responsive browser coverage.
- First rereview accepted the original query, roster, coverage, accessibility, and browser findings but retained one lifecycle Important and one stale-error Minor. Fix commit `d2a78803` (`fix: preserve billing lifecycle metadata`) omitted unchanged status/billed-date fields and reset mutation state between dialog sessions.
- Final Task 7 focused verification passed 14 files / 126 tests plus 2 Chromium desktop/tablet/mobile flows, TypeScript, scoped zero-warning ESLint, and diff checks. The in-app Browser attempt was blocked by the worktree's missing `DATABASE_URL`; the exact `net::ERR_CONNECTION_REFUSED`/startup failure is retained in `task-7-report.md`, and the approved repository Chromium fallback passed.
- Final independent rereview: PASS, 0 Critical / 0 Important / 0 Minor. Task 7 is complete through `efadec0b`.

### Task 7 rulings

- Ruling: the Billing workspace is URL-addressable under `/services?tab=billing`; server-side company/service/fee/general predicates run before count and pagination, while status/timing/date/family/sort/page state round-trips through URL parameters.
- Ruling: edit payloads include only changed lifecycle/value fields. Notes or reference edits must not manufacture value overrides, re-run a Waived/Billed transition, or rewrite original audit metadata. Failed mutations remain visible without closing the dialog, and mutation/input state resets before another occurrence is opened.
- Ruling: reconciliation stays collapsed by default, its header carries count and severity, issue cards are grouped by Company/service and render only when unresolved issues exist, and healthy coverage remains one compact summary.
- Ruling: the roster exposes Billing as its own column and projects the next Open/Billed tracking state rather than treating historical Waived/Billed rows as the next occurrence. Desktop/tablet retain the table; mobile uses non-duplicated cards.

## Task 8 — final acceptance, performance, and operations

### Implementation and evidence

- Initial acceptance commits `5d3f5b59` and `7b820586` closed the deferred repeatable `ONE_TIME` contract, added tenant/manual-trigger/performance PostgreSQL suites, added structured reconciliation metrics, added billing acceptance scripts, and documented the lifecycle/recovery/migration runbook.
- Initial Task 8 review reported 0 Critical, 4 Important, and 0 Minor findings: forced/simplified query-plan evidence; no true same-tenant restricted-company negative; acceptance scripts that could pass with every database suite skipped; and warning/event cardinality plus permanent-failure coverage gaps.
- Fix commits `1f081801` and `4757e4b3` captured the actual production Prisma query shapes without planner forcing, added same-tenant allowed/denied company controls, made PostgreSQL/performance scripts fail closed, bounded every variable event/warning field, expanded success/retry/failure tests, and corrected local-versus-staging evidence. First rereview accepted three findings but retained one permanent-error-path test gap.
- Final fix commits `d0e7a018` and `97455acc` added a true thrown `MISSING_RULE_INPUT` path with a valid lease and verified one complete bounded/redacted event plus safe permanent completion. Final independent Task 8 rereview: PASS, 0 Critical / 0 Important / 0 Minor.
- Final focused evidence: Plan 3 billing matrix 16 files / 158 tests; worker and schedule matrix 4 files / 57 tests; final worker/preflight matrix 2 files / 24 tests; Chromium Billing browser 1 file / 2 tests. Billing PostgreSQL acceptance passed 5 files / 9 tests with no skips. Performance passed 1 file / 2 tests with no skips after seeding 1,000 companies, 10,000 client services/fee lines, 100,000 occurrences, and 1,000 unresolved issues.
- A disposable local PostgreSQL 17 cluster received all 54 migrations and reported the schema current. Natural plans captured from the production services selected the intended occurrence and unresolved-coverage index families. Local representative timings were 473.05 ms for occurrence list and 83.46 ms for coverage summary, both below 1,500 ms. The disposable cluster and data directory were stopped and removed.
- Repository-wide baseline was run once at the agreed end gate: 343 passed / 8 failed / 19 skipped files and 2,866 passed / 33 failed / 54 skipped tests. The failures are in unchanged company/BizFile/schema/task UI suites and are recorded in `task-8-report.md`; no billing acceptance test failed or was weakened. Build compiled the application successfully but failed generated route validation at unchanged `.next/types/app/api/services/settings/route.ts:38`; lint passed with 0 errors and 4 existing warnings. Staging performance was not available and remains an explicit external release gate rather than fabricated evidence.

### Task 8 rulings

- Ruling: `ONE_TIME` describes the recurrence cycle, not a one-row limit. Every stable schedule entry in its generic repeatable list materializes exactly once, in deterministic key order, and participates in the existing occurrence identity/idempotence/range rules.
- Ruling: release acceptance scripts fail closed unless `TEST_DATABASE_URL` is provided; performance additionally requires `RUN_PERFORMANCE_TESTS=true`. PostgreSQL billing suites run serially to prevent shared-schema fixture races and must report no guarded skips in the acceptance run.
- Ruling: tenant isolation includes same-tenant Company access boundaries as well as cross-tenant boundaries. Allowed same-tenant controls and denied same-tenant list/detail/mutation/coverage cases exercise the production SQL predicates before pagination.
- Ruling: the worker emits exactly one bounded allowlisted reconciliation event per request. Counts are clamped; warning count, missing-field count, and variable strings are bounded/redacted; customer notes, references, uploads, and free-form error content never enter the event. Success, retry, exhausted, and true permanent-error paths retain the required zero/nonzero metrics and request identifiers.
- Ruling: query-plan acceptance captures and explains the actual production Prisma query shapes with natural planner selection; `enable_seqscan` is not forced. Local representative results are useful implementation evidence but do not replace the explicitly recorded staging performance release gate.

## Final whole-branch review

- The requested `gpt-5.6-sol` xhigh review covered the complete 35-plus-commit Plan 3 diff from base `41e7beb9`, all plan/spec requirements, and every recorded ruling. The initial whole-branch verdict was FAIL with 0 Critical / 3 Important / 3 Minor findings.
- Correction commits `04c7a45a` and `06bb3bf6` fixed relative-date lookaround/reconciliation preservation, final-state Configured materializability, no-op fee comparison, migration/runtime issue identity, ended-service cancellation provenance, and 300 ms text-filter debounce.
- The first xhigh rereview retained a dense-calendar business-day bound Important and canonical fee comparison Minor. Correction commits `3c715904` and `782614aa` added safe capped displacement, dense/six-weekend calendar coverage, normalized decimal equality, and display-order change detection.
- The second xhigh rereview found a maximum-valid-calendar performance Important. Correction commits `76658574` and `5e29dd3d` introduced one validated immutable calendar engine with O(1) membership; the deterministic maximum-shape regression improved from 64.86 seconds and more than 20,000 holiday traversals to 23 ms and exactly 500 traversals.
- The third xhigh rereview found one fail-closed regression for plain calendar-day entries. Correction commits `7fdf84c8` and `589e1484` made every nonempty evaluation validate one engine while preserving empty/missing-start behavior; evaluator, reconciliation, and coverage malformed-calendar cases now reject/classify without writes.
- Final xhigh verdict at `589e1484`: PASS, 0 Critical / 0 Important / 0 Minor. Targeted final verification passed 6 files / 154 tests; maximum-shape coverage remained single-pass and performant; `git diff --check` passed; worktree was clean.

### Final integration rulings

- Ruling: billing evaluation searches a mathematically bounded originating-cycle window for each relative entry, then filters operative dates to the requested range. Calendar/business-day displacement, dense holidays, up to six weekend days, and NEXT/PREVIOUS adjustment cannot cause a valid row to be omitted and cancelled.
- Ruling: every nonempty schedule evaluation validates and snapshots its business calendar exactly once into an immutable O(1)-membership engine. Empty or missing-start schedules retain the established empty-result behavior; malformed persisted calendars fail closed in evaluator, reconciliation, and coverage paths.
- Ruling: `CONFIGURED` is enforced against the final effective active fee state, not only request-supplied fee rows. Non-materializable legacy agreement fees remain `UNREVIEWED`; disposition-only promotion cannot bypass schedule materialization.
- Ruling: fee equality uses identical canonical stored/incoming projections, including `displayOrder`, stable schedule JSON, and normalized decimals. Representational amount differences such as `500` versus `500.00` are no-ops; semantic ordering/schedule/value changes persist, audit, version, and reconcile.
- Ruling: migration backfill and runtime coverage use the same SHA-256 issue identity including schedule key, so first APPLY refreshes migration rows instead of creating duplicate logical history. Ended/expired services retain an explicit ended-service cancellation reason.
- Ruling: Billing global and inline text filters debounce URL/server updates by 300 ms while non-text filters remain immediate and URL hydration/back-forward refreshes local drafts without loops.
