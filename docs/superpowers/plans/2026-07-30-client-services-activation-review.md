# Stage 3 Client Services and Signed Activation - Implementation Review

**Review date:** 2026-08-01

**Reviewed plans:**

- `docs/superpowers/plans/2026-07-30-service-agreement-roadmap.md`
- `docs/superpowers/plans/2026-07-30-client-services-activation.md`

**Reviewed implementation:** Current working tree on `main` at `01ed054`,
including all tracked and untracked Stage 3 changes

**Review scope:** Prisma schema and migration, Client Service validation/DTOs,
tenant-scoped operational queries and mutations, activation state machine,
e-sign completion integration, scheduler retry processing, APIs and RBAC,
company Services UI, backup/restore/deletion ordering, documentation, and
automated verification

**Initial disposition:** **Not ready to accept as the Stage 3 implementation**

## Third Review Update - All Review Fixes

**Re-review date:** 2026-08-01

**Re-reviewed implementation:** Current working tree on `main` at `01ed054`,
including all tracked and untracked Stage 3 files and the fixes from Tasks
10-15

**Current disposition:** **Ready to accept as the Stage 3 implementation.**

All implementation findings from the first and second reviews are resolved.
The stale-write workflow now requires the user to reload the authoritative
service before saving, the activation worker and its audit records are covered
by real PostgreSQL race and rollback tests, the migration is the single source
of truth for its partial queue indexes, e-sign completion is covered through a
behavioral transaction boundary, and the full repository test gate passes.

One release-environment validation remains outside this code review: the
authenticated Task 9 smoke workflow could not be driven through the running
local app because the available browser session has no review credentials and
is redirected to `/login`. This is recorded as a manual deployment check, not
an open code finding. The same editor conflict/reload/retry and archive/retry
interactions pass in headless Chromium against the real React components and
HTTP hooks.

### Third-Review Finding Count

| Priority | Open | Resolved |
|---|---:|---:|
| P0 - release blocker | 0 | 3 |
| P1 - must fix before release | 0 | 10 |
| P2 - follow-up quality issue | 0 | 4 |

### Final Verification Evidence

| Check | Result | Evidence |
|---|---|---|
| Prisma generation | **Pass** | Prisma Client 7.2 generated and the normalization script exited 0. |
| Focused Stage 3 gate | **Pass** | 12 files passed with 83 tests; the 8 PostgreSQL tests were separately executed against the disposable database below. |
| Real PostgreSQL activation gate | **Pass** | A disposable PostgreSQL 16 database received all 34 migrations; 8/8 overlap, rollback, lease, cancellation, stale-worker, idempotency, retry-race, and `EXPLAIN` cases passed. The container was stopped and removed after the run. |
| Missing-CI-database preflight | **Pass** | With `CI=true` and no `TEST_DATABASE_URL`, the suite fails with the required isolated-database configuration message instead of skipping. |
| Chromium interaction regression | **Pass** | 1/1 test passed, covering all fee fields, repeated stale-token 409s, explicit authoritative reload, successful fresh-token save, archive confirmation, and retry through HTTP hooks. |
| Production build | **Pass** | Next.js compilation and type checking completed and all 134 pages were generated. |
| Full repository Vitest gate | **Pass** | 192 files and 1,481 tests passed; 2 files and 11 tests requiring an external database were skipped in the ordinary no-database run. The 8 Stage 3 skips passed in the dedicated PostgreSQL gate. |
| Full-suite stability fix | **Pass** | Vitest is capped at four workers to prevent random 5-second CPU-starvation timeouts. The URL-tab test also uses a static module import; its body fell from 4.45 seconds to about 0.4-0.7 seconds. |
| Diff whitespace validation | **Pass** | `git diff --check` exited 0 after final focused verification. |
| Authenticated rendered QA | **Environment-blocked** | The running app renders its login screen without a framework error, but no authenticated review session or credentials are available. |
| Manual Task 9 activation exercise | **Release smoke check outstanding** | E-sign, manual activation, failure/retry, immutability, and concurrent-edit behavior are covered automatically; the equivalent authenticated development-tenant walkthrough remains for release validation. |

### Final Per-Finding Status

| Finding | Status | Final evidence |
|---|---|---|
| `CSA-REV-001` | **Resolved** | The activation task inherits `SCHEDULER_ENABLED`; environment documentation and the registration test cover the one-minute schedule. |
| `CSA-REV-002` | **Resolved** | Mutation, activation, retry, and audit writes share transaction clients. A forced audit-insert failure in PostgreSQL rolls back operational rows and success audits. |
| `CSA-REV-003` | **Resolved** | Compare-and-set transitions, claim tokens, serializable retry handling, expired-lease reclaim, cancellation exclusion, stale-worker rejection, duplicate completion, and overlapping retries all pass against PostgreSQL. |
| `CSA-REV-004` | **Resolved** | Automatic activation preserves an explicit effective date or derives the Singapore calendar date from envelope completion; boundary tests pass. |
| `CSA-REV-005` | **Resolved** | HTTP errors preserve status, 409 enters a conflict state, Save remains blocked, and `Reload latest service` replaces the complete draft plus `updatedAt`. Repeated stale tokens remain 409 in Chromium. |
| `CSA-REV-006` | **Resolved** | Activation and document finalization share `metadataHasUnresolvedTemplateData()` and cover every diagnostic array. |
| `CSA-REV-007` | **Resolved** | Manual activation audits include old/new signed date, effective date, activation status, and source; success-path assertions pass. |
| `CSA-REV-008` | **Resolved** | All operational fee fields, stable row identity, shared form controls, associated field errors, recoverable mutation failures, conflict reload, and reasoned archive confirmation are covered. |
| `CSA-REV-009` | **Resolved** | Retry capability requires document and every-company update permission and is enforced in both API and UI coverage. |
| `CSA-REV-010` | **Resolved** | Pagination, filter reset, page clamping, and shared controls are implemented and tested. |
| `CSA-REV-011` | **Resolved** | Client responses retain stable public messages and correlation references while detailed exceptions remain server-side. |
| `CSA-REV-012` | **Resolved for automated release gates** | Behavioral e-sign completion, 403/404 API boundaries, backup dry-run and legacy restore, real PostgreSQL lifecycle cases, component tests, and Chromium interaction coverage all pass. The authenticated Task 9 walkthrough is retained only as the release smoke check above. |
| `CSA-REV-013` | **Resolved** | Contradictory Prisma full-index declarations were removed. The schema test asserts the exact migration-managed partial index SQL and PostgreSQL `EXPLAIN` uses both indexes. |
| `CSA-REV-014` | **Resolved** | Fixed-point decimal strings are formatted without conversion through JavaScript `Number`. |
| `CSA-REV-015` | **Resolved** | Empty PATCHes are rejected and semantic no-op updates do not write or audit. |
| `CSA-REV-016` | **Resolved** | Service rows show the first fee and an explicit additional-fee count. |
| `CSA-REV-017` | **Resolved in implementation** | The editor uses the shared `FormInput` pattern with field-level associations; company tabs expose tab semantics, horizontal mobile overflow, and minimum touch height. Component and Chromium checks pass; authenticated visual smoke testing remains documented above. |

### Third-Review Acceptance Recommendation

Accept Stage 3. The implementation defects and automated release-gate gaps
identified by both prior reviews are closed, including real-database proof and
the previously failing full repository suite. Perform the authenticated Task 9
walkthrough in a credentialed development tenant as the final deployment smoke
check.

## Second Review Update - First Fix Round

**Re-review date:** 2026-08-01

**Re-reviewed implementation:** Current working tree on `main` at `de394c2`,
including the first-round fixes and all tracked and untracked Stage 3 files

**Current disposition:** **Not ready to accept as the Stage 3 implementation**

The first fix round materially improves the implementation. The scheduler now
inherits the documented master switch, mutation and audit writes share their
transactions, activation transitions use compare-and-set predicates and claim
tokens, automatic effective dates come from envelope completion in Singapore,
the shared document-finalization guard is reused, optimistic PATCH conflicts
return HTTP 409, and the Services UI now includes the missing fee controls,
archive confirmation, permission-aware retry, pagination, exact decimal
formatting, and multi-fee summaries. No original P0 implementation defect was
found still present in the reviewed code.

Stage 3 is not yet acceptable. The remaining release-relevant issues map to the
original findings rather than requiring new finding IDs:

1. The editor displays a stale-version conflict but cannot recover from it. It
   resubmits the same `service.updatedAt` value on every retry, while the browser
   test incorrectly makes the second identical PATCH succeed.
2. The migration creates the intended PostgreSQL partial queue indexes, but the
   Prisma schema separately declares two full indexes that the migration does
   not create. The schema contract test asserts those unmatched declarations
   instead of the deployed partial indexes.
3. The PostgreSQL concurrency suite is opt-in, is omitted from the Stage 3
   release command, and skipped all three tests in this review because no
   `TEST_DATABASE_URL` is configured. Several concurrency and rollback
   scenarios required by the first review are still absent.
4. The full repository test gate still fails, the authenticated manual Task 9
   workflow has not been exercised, and authenticated rendered QA could not
   proceed past the local login page without test credentials.

### Second-Review Finding Count

| Priority | Remaining | Notes |
|---|---:|---|
| P0 - release blocker | 0 code defects | `CSA-REV-003` has a materially safer implementation, but its required real-PostgreSQL proof remains incomplete under `CSA-REV-012`. |
| P1 - must fix before release | 5 | `CSA-REV-005`, `CSA-REV-007`, `CSA-REV-008`, `CSA-REV-012`, and `CSA-REV-013` remain partial or open. |
| P2 - follow-up quality issue | 1 | `CSA-REV-017` remains partial. |

### Fresh Verification Evidence

| Check | Result | Evidence |
|---|---|---|
| Prisma generation | **Pass** | Prisma Client 7.2 generated successfully and normalization exited 0. |
| Focused Stage 3 gate | **Pass** | 9 files and 48 tests passed. |
| Combined roadmap service-agreement gate | **Pass** | 12 files and 115 tests passed. |
| Browser regressions | **Pass** | 2 Chromium files and 3 tests passed. |
| PostgreSQL activation suite | **Skipped** | 1 file and all 3 tests skipped because `TEST_DATABASE_URL` is not configured. |
| Production build | **Pass** | Compilation, lint/type checking, 134 static pages, and build traces completed. |
| Diff whitespace validation | **Pass** | `git diff --check HEAD` exited 0. |
| Full repository Vitest gate | **Fail** | 187 files passed, 4 failed, and 2 skipped; 1,455 tests passed, 9 failed, and 6 skipped. |
| Authenticated rendered QA | **Blocked** | The local app loaded without a framework overlay or console error but redirected to `/login`; no review credentials were available. |
| Manual Task 9 activation exercise | **Not performed** | No authenticated development-tenant e-sign, manual activation, forced retry, or immutability workflow was available. |

The full-suite failures were:

| Test file | Failures | Stage 3 assessment |
|---|---:|---|
| `__tests__/api/bizfile-confirm-route.test.ts` | 5 | Outside the Stage 3 fix set; four timed out and the later assertion observed calls left by earlier timeouts. |
| `__tests__/api/generated-documents-preview-route.test.ts` | 1 | Outside the Stage 3 fix set; expected call arguments do not include newer generation context. |
| `__tests__/api/generated-documents-validation-route.test.ts` | 2 | Outside the Stage 3 fix set; expected call arguments do not include newer generation context. |
| `__tests__/components/service-catalog.test.tsx` | 1 | Stage 1 test timed out only in the full run; the same file passed in the focused combined gate. |

### Per-Finding Re-review Status

| Finding | Status | Second-review evidence |
|---|---|---|
| `CSA-REV-001` | **Closed** | `serviceAgreementActivationTask.enabledEnvVar` is `SCHEDULER_ENABLED`; `.env.example` and the environment reference document the inherited switch and one-minute cron. The registration-level test passed. |
| `CSA-REV-002` | **Closed in code** | Client Service update/archive, manual request/retry, and activation audits now receive the active transaction client. The PostgreSQL audit-rollback regression exists but did not run in this environment. |
| `CSA-REV-003` | **Code addressed; verification incomplete** | Manual queue and retry use conditional `updateMany`; claims carry tenant ID and a unique token; success/failure compare `DRAFT + PROCESSING + claimToken`; stale workers exit. Real lease-expiry/reclaim, retry-versus-completion, cancellation-after-queue, and stale-result races are not all exercised. |
| `CSA-REV-004` | **Closed** | Automatic queueing preserves an existing date or derives the Singapore calendar date from envelope completion. The focused timezone-boundary regression passed. |
| `CSA-REV-005` | **Partial** | The backend checks `updatedAt` before fee replacement and returns `ConflictError`/HTTP 409. `ClientServiceEditor` always submits the immutable prop value at `client-service-editor.tsx:50`; after 409 it neither refetches nor adopts a fresh version, so another Save sends the same stale token and will conflict again. The browser test masks this by accepting its second PATCH regardless of the unchanged token (`company-services.browser.test.tsx:51-54`, `:93-95`). |
| `CSA-REV-006` | **Closed** | Activation and normal finalization reuse `metadataHasUnresolvedTemplateData()`. Parameterized activation tests cover all five diagnostic arrays. |
| `CSA-REV-007` | **Partial** | CREATE audits are emitted only for newly created Services, manual activation propagates the requester, and operational edits record scalar changes plus safe fee summaries. The successful manual-queue audit still records only a summary/reason, not the submitted signed/effective date changes, and no success-path audit test covers those fields. |
| `CSA-REV-008` | **Partial** | Currency, billing date, custom frequency, stable row IDs, accessible form-level errors, recoverable generic mutation failures, and reason-enabled archive confirmation are implemented. Stale-conflict recovery remains non-functional as described in `CSA-REV-005`. |
| `CSA-REV-009` | **Closed** | The list route derives `canRetry` from `document:update` plus `company:update` for every agreement entity; the UI renders Retry only when that capability is true. |
| `CSA-REV-010` | **Closed** | Page/page-size state, reset/clamping behavior, and the shared `Pagination` component are present; the pagination regression passed. |
| `CSA-REV-011` | **Closed for agreement exposure** | Agreements persist stable public messages and unexpected failures use a correlation reference; detailed exceptions remain in server logs. |
| `CSA-REV-012` | **Open** | The new PostgreSQL file skipped all tests and is absent from the plan's focused command. Its three scenarios do not cover the full required race matrix. E-sign queue coverage still uses a source-code regex instead of executing signing completion, the Chromium workflow stubs `fetch` rather than crossing real Next routes, API 403/404 coverage remains incomplete, and backup tests do not cover dry-run/older-backup compatibility. |
| `CSA-REV-013` | **Partial** | The migration adds useful partial indexes for available and expired-lease branches, and an opt-in `EXPLAIN` test exists. However, `prisma/schema.prisma:1059-1060` declares two different full indexes that `migration.sql:62-63` does not create, leaving migration/schema drift. The schema test checks the unmatched full-index declarations rather than the migration's partial-index contract. |
| `CSA-REV-014` | **Closed** | The list formats fixed-point decimal strings without converting them through JavaScript `Number`. |
| `CSA-REV-015` | **Closed** | Validation rejects a PATCH containing only `updatedAt`, and the service also suppresses semantically unchanged updates/audits. |
| `CSA-REV-016` | **Closed** | Rows show the first fee plus an explicit additional-fee count. |
| `CSA-REV-017` | **Partial** | New compact buttons have mobile-height overrides and form-level errors are accessible. Editor labels still use `text-sm` raw input patterns rather than the documented `text-xs` shared form pattern, validation is not associated at field level, and the three-tab mobile layout was not authenticated/render-verified. |

### Required Actions After the First Fix Round

1. Make a 409 recoverable: refetch the current Service/version, provide an
   explicit reload/reconcile action, and verify that an unchanged stale token
   continues to receive 409 until fresh state is adopted.
2. Align the Prisma schema and migration index contracts. Prefer testing the
   partial-index SQL actually deployed rather than declaring unmatched full
   indexes solely to satisfy a schema-string test.
3. Make the PostgreSQL activation suite a required CI/release command with a
   dedicated `TEST_DATABASE_URL`; add the missing lease, reclaim, cancellation,
   stale-success/failure, duplicate-completion, retry overlap, and rollback
   cases.
4. Execute the actual e-sign completion service in integration coverage and
   exercise Services mutations/retry through the real request boundary.
5. Include signed/effective date changes in the manual activation audit and add
   a successful manual-request audit regression.
6. Finish the remaining form-label, field-level validation, and authenticated
   mobile visual checks.
7. Resolve or formally baseline the full-suite failures and complete the Task 9
   manual activation/immutability exercise.

### Second-Review Acceptance Recommendation

Do not accept or merge Stage 3 yet. The first-round fixes close the original P0
implementation defects and substantially improve the normal path, but the
stale-edit recovery path is still broken, schema and migration index contracts
are inconsistent, and the concurrency evidence required for this activation
workflow did not execute. Re-review after the five remaining P1 findings are
closed, the dedicated PostgreSQL gate passes, and the manual/full-suite release
gates are completed or formally baselined.

The original first-review report is retained below as the historical basis for
the finding IDs and required actions.

## Executive Summary

The implementation establishes the right overall shape. The planned operational
tables and activation enums exist, activation copies relational agreement data
rather than rendered HTML, entity-specific fees are preserved, Client Service
DTOs omit legal SOW wording, the primary API permission boundaries are present,
and backup/restore support covers every Plan 1-3 service table. The focused
Stage 3 tests, combined roadmap suite, Chromium suites, Prisma generation, and
production build all pass.

The green focused gates do not establish the release's core recovery and audit
guarantees. Three P0 defects remain:

1. The durable activation scheduler task is disabled unless an undocumented
   per-task environment variable is set.
2. Domain audit records are written outside the transactions they describe and
   can survive rolled-back mutations.
3. Manual request, retry, lease recovery, and worker completion use unsafe
   state transitions that can overwrite newer state, requeue completed work,
   or activate a cancelled agreement.

The implementation also lacks the planned optimistic conflict contract,
finalizes draft documents with incomplete diagnostic checks, invents automatic
effective dates from worker execution time, and provides only partial
operational fee editing. Most of the plan-mandated concurrency, rollback,
e-sign transition, API error, and browser workflows are absent from the tests.

### Open Finding Count

| Priority | Count |
|---|---:|
| P0 - release blocker | 3 |
| P1 - must fix before release | 10 |
| P2 - follow-up quality issue | 4 |

## Strengths

- `ClientService` and `ClientServiceFeeLine` match the planned operational
  ownership model, including the unique agreement-item/company key and source
  agreement-fee relation.
- Client Service list/detail queries filter by `tenantId` and `deletedAt`, and
  operational mutation routes enforce `company:read` or `company:update`.
- Manual activation and retry routes require `document:update` and check every
  included company before invoking the domain operation.
- Activation uses agreement item/entity relations and snapshot fields. It does
  not parse document HTML or expose legal clause content in Client Service DTOs.
- E-sign completion queues activation in the envelope completion transaction,
  while the post-commit helper catches worker failure so signing can still
  return successfully.
- Backup export, restore, and deletion ordering include all catalog, agreement,
  operational Service, and fee tables in dependency-safe order.
- The Services tab includes search, status filters, source-agreement links,
  read-only behavior, activation banners, and an explicit signed-content
  disclaimer.
- Documentation was updated in the required existing `docs/` files.

## Verification Evidence

| Check | Result | Evidence |
|---|---|---|
| Focused Stage 3 gate | **Pass** | 9 files and 23 tests passed. |
| Combined roadmap service-agreement gate | **Pass** | 12 files and 94 tests passed. |
| Browser regressions | **Pass** | 2 Chromium files and 3 tests passed. |
| Backup contact-merge safety regression | **Pass** | 1 file and 6 tests passed. |
| Prisma generation and production build | **Pass** | Prisma 7.2 generation, compilation, type checking, 134 static pages, and build traces completed. |
| Changed Stage 3 source lint | **Pass** | Independent review linted the changed Stage 3 source paths successfully. |
| Diff whitespace validation | **Pass** | `git diff --check HEAD` exited 0. |
| Full repository Vitest gate | **Fail** | 187 files passed, 4 failed, and 1 skipped; 1,433 tests passed, 6 failed, and 3 skipped. |
| Real PostgreSQL activation concurrency | **Not run / not implemented** | Current activation tests mock Prisma and cannot prove `SKIP LOCKED`, lease, unique-key, or Serializable behavior. |
| Manual Task 9 activation exercise | **Not performed** | No development-tenant e-sign, manual activation, forced retry, or immutable-edit exercise was available to inspect. |

### Full-Suite Failures Outside the Stage 3 Diff

None of the following failing files is modified by the Stage 3 working-tree
diff. They remain repository release-gate failures and should be resolved or
formally recorded as pre-existing before acceptance.

| Test file | Failures |
|---|---:|
| `__tests__/api/bizfile-confirm-route.test.ts` | 2 |
| `__tests__/api/generated-documents-preview-route.test.ts` | 1 |
| `__tests__/api/generated-documents-validation-route.test.ts` | 2 |
| `__tests__/components/a4-page-editor.test.tsx` | 1 |

## P0 Findings - Release Blockers

### CSA-REV-001 - Durable Activation Retries Are Disabled by Default

| Field | Value |
|---|---|
| **Priority** | **P0** |
| **Task registration** | `src/lib/scheduler/tasks/service-agreement-activation.task.ts:7` |
| **Scheduler enablement** | `src/lib/scheduler/scheduler.ts:60` |
| **Registration point** | `src/lib/scheduler/index.ts:90` |
| **Missing configuration** | `.env.example`, `docs/reference/ENVIRONMENT_VARIABLES.md` |
| **Misleading test** | `__tests__/services/service-agreement-activation-scheduler.test.ts:7` |

#### Evidence

The scheduler derives a per-task variable and enables a task only when that
variable is exactly `true`:

```ts
const enabledEnvVar = registration.enabledEnvVar
  || `SCHEDULER_${taskIdUpper}_ENABLED`;
const enabled = process.env[enabledEnvVar] === 'true';
```

The new task has no `enabledEnvVar` override. Consequently it requires
`SCHEDULER_SERVICE_AGREEMENT_ACTIVATION_ENABLED=true`, but that variable is not
present in `.env.example`, the environment reference, or the Stage 3 docs.
The scheduler test calls `serviceAgreementActivationTask.execute()` directly;
it never registers the task and therefore cannot detect that it is disabled.

#### Impact

When immediate post-commit activation fails, an agreement can remain
`PENDING` indefinitely. A later unrelated signing request may happen to process
the global batch, but the promised durable one-minute retry path is absent.
This breaks the core recovery guarantee in the roadmap and Task 5.

#### Required Action

1. Decide and encode the intended policy:
   - make activation inherit the global scheduler switch, or
   - require a per-task switch and add it to checked-in environment/deployment
     documentation with the production value enabled.
2. Add an initialization-level test that registers the task and verifies its
   enabled state under the documented production environment.
3. Add a test proving a failed immediate attempt is later claimed by the
   scheduled task without another signing request.

---

### CSA-REV-002 - Audit Records Escape the Transactions They Describe

| Field | Value |
|---|---|
| **Priority** | **P0** |
| **Operational update** | `src/services/client-service/service.ts:102`, `src/services/client-service/service.ts:143` |
| **Operational archive** | `src/services/client-service/service.ts:158`, `src/services/client-service/service.ts:162` |
| **Activation transaction** | `src/services/service-agreement/activation.service.ts:96`, `src/services/service-agreement/activation.service.ts:122`, `src/services/service-agreement/activation.service.ts:130` |
| **Supported transaction API** | `src/lib/audit.ts:66` |

#### Evidence

`createAuditLog(params, tx?)` explicitly supports a Prisma transaction client,
but every new audit call inside an interactive transaction omits `tx`. The
audit insert therefore uses the global Prisma client and commits independently.
Activation emits Client Service CREATE audits before generated-document and
agreement finalization. A later failure or Serializable conflict can roll back
all operational rows while leaving those audits committed.

Manual queue and retry operations have the inverse failure mode: the state
update commits first and an audit failure makes the API return 500 even though
the activation request has already been persisted.

#### Impact

The audit trail can claim that a Service was created, updated, archived, or
activated when the corresponding domain mutation never committed. This is a
release blocker for a workflow whose plan explicitly requires audited legal-to-
operational activation and audited edits.

#### Required Action

1. Pass the active `tx` to every audit written inside an existing transaction.
2. Wrap manual request and retry state changes with their audits in interactive
   transactions.
3. Detect whether an activation upsert actually created a Client Service and
   emit CREATE only for a real creation.
4. For manual activation, propagate `activationRequestedById` into the
   activation and Client Service creation audits.
5. Add rollback regressions that force failures after mutation and after audit,
   then assert that neither side commits alone.

---

### CSA-REV-003 - Activation State Transitions Are Not Concurrency Safe

| Field | Value |
|---|---|
| **Priority** | **P0** |
| **Manual request** | `src/services/service-agreement/activation.service.ts:56` |
| **Retry request** | `src/services/service-agreement/activation.service.ts:72` |
| **Activation guard** | `src/services/service-agreement/activation.service.ts:97` |
| **Success transition** | `src/services/service-agreement/activation.service.ts:129` |
| **Failure transition** | `src/services/service-agreement/activation.service.ts:136` |
| **Claim query** | `src/services/service-agreement/activation.service.ts:151` |

#### Evidence

- Manual activation checks only `agreement.status === 'DRAFT'`. It accepts any
  activation status and then updates by ID, so a repeated request can overwrite
  an existing e-sign/manual source, dates, requester, and reason.
- Retry reads a failed status and then updates by ID only. If a worker completes
  between those operations, retry can move `COMPLETED` back to `PENDING`.
- `processServiceAgreementActivation()` does not require the agreement itself
  to remain `DRAFT`. A queued agreement changed to `CANCELLED` can still be
  marked `EFFECTIVE`.
- Claimed work has no unique claim token. A stale worker whose lease expired
  cannot distinguish its claim from a newer worker's reclaim.
- Success and failure writes do not compare the observed status/claim. A stale
  worker can report a retryable failure after another worker completed, and
  `updateMany()` result counts are ignored.
- Internal activation and failure queries use only the agreement ID despite the
  roadmap's explicit tenant-filtering constraint.

Unique constraints reduce duplicate Client Service rows, but they do not make
the lifecycle, provenance, audit output, or worker result idempotent.

#### Impact

Scheduler overlap, manual retry, lease expiry, or a cancellation race can
overwrite newer state, change activation provenance, create duplicate/false
audits, report completed work as failed, or activate an agreement that is no
longer eligible. These are exactly the failure modes Stage 3 promises to handle.

#### Required Action

Implement compare-and-set lifecycle transitions:

1. Manual queue: atomically require `DRAFT + NOT_READY` and queue once.
2. Retry: condition the write on the same failed status observed and on
   `DRAFT` agreement status.
3. Claim: return `(id, tenantId, claimToken)` and persist a unique claim token
   or equivalent monotonically changing claim identity.
4. Worker success/failure: require `PROCESSING` plus the exact current claim;
   treat a lost claim as a stale-worker exit, not a failure.
5. Lock or compare the agreement row before activation and return
   `already-completed` after a competing worker wins.
6. Scope all reads/writes to both `id` and `tenantId`.
7. Add real concurrent tests for duplicate completion, retry-versus-completion,
   repeated manual requests, lease expiry/reclaim, cancellation after queueing,
   stale-worker success, and stale-worker failure.

## P1 Findings - Must Fix Before Release

### CSA-REV-004 - Automatic Activation Invents an Effective Date

| Field | Value |
|---|---|
| **Priority** | **P1** |
| **Implementation** | `src/services/service-agreement/activation.service.ts:129` |
| **Plan contract** | `docs/superpowers/plans/2026-07-30-client-services-activation.md:485` |

The success update uses `agreement.effectiveDate ?? new Date()`. An outage or
retry can therefore move the effective date from signing day to worker day,
and UTC conversion can produce the wrong Singapore calendar date. The plan
only instructs Stage 3 to set a supplied manual effective date.

**Required action:** Preserve an existing effective date for automatic
activation. If the business rule should use envelope completion, document that
rule explicitly and derive a date-only value from `signedAt` in the agreed
business timezone. Add delayed-retry and timezone-boundary tests.

---

### CSA-REV-005 - Optimistic Editing and HTTP 409 Are Missing

| Field | Value |
|---|---|
| **Priority** | **P1** |
| **Validation** | `src/lib/validations/client-service.ts:35` |
| **Service mutation** | `src/services/client-service/service.ts:102` |
| **PATCH route** | `src/app/api/client-services/[id]/route.ts:21` |

`ClientServiceDto` returns `updatedAt`, but PATCH accepts no version or timestamp
precondition and performs an unconditional update. Two editors can silently
overwrite scalar values and the entire fee collection. The Stage 3 plan
explicitly requires optimistic-conflict coverage and a 409 response.

**Required action:** Add an `updatedAt`/version precondition or `If-Match`
contract. Lock and compare the row before replacing fees, throw `ConflictError`
when stale, return 409, and add competing-editor service/route tests.

---

### CSA-REV-006 - Activation Bypasses the Full Document Finalization Guard

| Field | Value |
|---|---|
| **Priority** | **P1** |
| **Activation predicate** | `src/services/service-agreement/activation.service.ts:34` |
| **Authoritative predicate** | `src/services/document-generator.service.ts:256` |
| **Activation finalization** | `src/services/service-agreement/activation.service.ts:126` |

Generated documents store `missingPlaceholders`, `missingPartials`,
`circularPartials`, `syntaxErrors`, and `unknownPlaceholders`. Activation checks
`missingPlaceholders` but looks for the nonexistent `unresolvedPartials` key and
ignores the remaining diagnostics. It can therefore set a DRAFT document to
`FINALIZED` when the normal finalization service would reject it.

**Required action:** Extract and reuse one shared finalization diagnostic
predicate. Add activation tests for every metadata key and verify that an
ineligible document is neither finalized nor partially activated.

---

### CSA-REV-007 - Audit Detail and Actor Attribution Are Incomplete

| Field | Value |
|---|---|
| **Priority** | **P1** |
| **Operational update audit** | `src/services/client-service/service.ts:143` |
| **Activation create audit** | `src/services/service-agreement/activation.service.ts:122` |
| **Activation summary audit** | `src/services/service-agreement/activation.service.ts:130` |

Every activation upsert emits a CREATE audit even when the row already existed.
Manual activation records use change source `MANUAL` but omit the saved actor.
Operational updates emit only a generic summary and do not include the planned
old/new scalar changes or safe fee summary.

**Required action:** Audit only real changes, include the manual requester,
record old/new scalar values and fee counts/totals, and continue excluding
`fieldValues` contents and signed wording.

---

### CSA-REV-008 - The Operational Editor Is Incomplete and Failure-Unfriendly

| Field | Value |
|---|---|
| **Priority** | **P1** |
| **Mutation handling** | `src/components/companies/company-detail/client-service-editor.tsx:23` |
| **Field-row key** | `src/components/companies/company-detail/client-service-editor.tsx:49` |
| **Fee controls** | `src/components/companies/company-detail/client-service-editor.tsx:50` |
| **Archive action** | `src/components/companies/company-detail/client-service-editor.tsx:56` |

The editor cannot change fee currency, billing start date, or custom-frequency
label. Selecting `CUSTOM` on a non-custom fee sends a missing custom label and
is rejected by the API. Mutation rejections have no accessible form error or
toast. Archive is a direct button inside the edit modal rather than the planned
reason-enabled confirmation.

The Service fields row uses ``key={`${index}-${field.key}`}``. Typing changes
the React key on every keystroke, remounts the row, and commonly drops focus.

**Required action:**

1. Add currency, billing date, and conditional custom-frequency controls.
2. Give local field/fee rows stable immutable UI IDs.
3. Add client-side validation and accessible form-level error feedback.
4. Keep failed save/archive state recoverable without closing or clearing data.
5. Use `ConfirmDialog` with a required archive reason.
6. Test all fee fields, focus stability, validation failures, mutation failures,
   and archive confirmation/cancellation.

---

### CSA-REV-009 - Retry Visibility Does Not Match Route Authorization

| Field | Value |
|---|---|
| **Priority** | **P1** |
| **UI capability** | `src/app/(dashboard)/companies/[id]/page.tsx:362` |
| **Retry button** | `src/components/companies/company-detail/company-services-tab.tsx:28` |
| **Route requirements** | `src/app/api/service-agreements/[id]/retry-activation/route.ts:12` |

The tab shows Retry when the user can update only the company currently being
viewed. The route additionally requires `document:update` and update access to
every company in the agreement. Users can therefore see an action they cannot
perform, and the missing mutation-error UI makes the failure effectively
silent.

**Required action:** Return or calculate a per-activation `canRetry` capability
using the complete permission set, render Retry only when true, and test mixed
multi-company permissions.

---

### CSA-REV-010 - The UI Hides Services Beyond the First 50

| Field | Value |
|---|---|
| **Priority** | **P1** |
| **Hook pagination** | `src/hooks/use-client-services.ts:16` |
| **Hard-coded page** | `src/components/companies/company-detail/company-services-tab.tsx:19` |

The API returns `total` and accepts page/limit, but the tab always requests page
1 with limit 50 and renders no pagination controls. Any later Services are
unreachable.

**Required action:** Add page/page-size state and the shared `Pagination`
component, clamp after data shrinks, reset page on search/status changes, and
add a multi-page component/browser regression.

---

### CSA-REV-011 - Activation Errors Are Persisted and Exposed Too Literally

| Field | Value |
|---|---|
| **Priority** | **P1** |
| **Error conversion** | `src/services/service-agreement/activation.service.ts:29` |
| **Persistence** | `src/services/service-agreement/activation.service.ts:135` |
| **Company DTO exposure** | `src/services/client-service/service.ts:89` |
| **E-sign logging** | `src/services/esigning-signing.service.ts:35` |

The current sanitizer only removes whitespace and truncates the raw exception
message. Database messages, schema details, identifiers, or other internal
context can be persisted in `activationLastError`, displayed to company readers,
and logged by the e-sign helper.

**Required action:** Map expected failures to stable user-safe codes/messages,
store only those public messages on the agreement, and keep detailed diagnostics
in restricted logs keyed by a correlation ID.

---

### CSA-REV-012 - Release Tests Do Not Exercise the Promised Contracts

| Field | Value |
|---|---|
| **Priority** | **P1** |
| **Activation tests** | `__tests__/services/service-agreement-activation.service.test.ts:45` |
| **E-sign test** | `__tests__/services/esigning-service-agreement-activation.test.ts:9` |
| **API tests** | `__tests__/api/client-services-routes.test.ts:20` |
| **Component tests** | `__tests__/components/company-services-tab.test.tsx:27` |
| **Browser test** | `__tests__/browser/company-services.browser.test.tsx:38` |
| **Backup tests** | `__tests__/services/backup-service-agreement-data.test.ts:12` |

The activation suite tests only happy-path creation, already-completed return,
basic queueing, and explicit retry with a mocked transaction. It does not test
claiming, stale leases, backoff, max attempts, concurrency, manual metadata,
audit rollback, full diagnostic blocking, or transaction rollback.

The e-sign test calls only `safelyProcessServiceAgreementActivations()` and
never calls the signing-completion flow or proves queueing occurs only on the
authoritative transition. The plan-referenced
`__tests__/services/esigning-signing.service.test.ts` does not exist. API tests
omit GET detail, retry, 403, 404, and 409 paths. The Chromium test mounts the
component with mocked hooks; it does not exercise real routes or mutations.

**Required action:** Implement every named Task 4-8 scenario and add at least
one isolated PostgreSQL suite for `FOR UPDATE SKIP LOCKED`, unique constraints,
Serializable overlap, claim loss, and audit rollback. Replace nominal browser
coverage with a workflow that edits all operational fields, handles a failed
mutation, archives with confirmation, and retries an activation through the
real request boundary.

---

### CSA-REV-013 - The Queue Has No Supporting Index

| Field | Value |
|---|---|
| **Priority** | **P1** |
| **Current indexes** | `prisma/schema.prisma:1056` |
| **Claim query** | `src/services/service-agreement/activation.service.ts:152` |
| **Migration indexes** | `prisma/migrations/20260730110000_client_services_activation/migration.sql:55` |
| **Classification** | Plan and implementation defect |

The every-minute global claim query filters/sorts by activation status,
availability, and lease expiry. Neither the plan nor implementation adds an
index for either claim branch, so the scheduler will scan and sort the Service
Agreement table as it grows.

**Required action:** Add indexes appropriate to pending/retryable availability
and expired processing leases, preferably PostgreSQL partial indexes. Add the
index contract to the plan/schema test and validate the claim with `EXPLAIN` on
representative data.

## P2 Findings - Follow-Up Quality Issues

### CSA-REV-014 - Large Fee Amounts Are Formatted Through a Lossy Number

| Field | Value |
|---|---|
| **Priority** | **P2** |
| **Implementation** | `src/components/companies/company-detail/company-services-tab.tsx:38` |

Validation permits sixteen integer digits, but the list converts the fixed-
point string with `Number(fee.amount)`. Values above JavaScript's safe integer
range can display a different amount.

**Required action:** Format the decimal string directly or use a decimal-aware
currency formatter.

---

### CSA-REV-015 - Empty PATCH Requests Produce False UPDATE Audits

| Field | Value |
|---|---|
| **Priority** | **P2** |
| **Validation** | `src/lib/validations/client-service.ts:35` |
| **Audit** | `src/services/client-service/service.ts:143` |

Every update property is optional, so `{}` is valid. The service still writes
an UPDATE audit even though nothing changed.

**Required action:** Require at least one mutation field or detect a no-op and
return without updating/auditing. Add a no-op route test.

---

### CSA-REV-016 - Multi-Fee Services Show Only the First Fee

| Field | Value |
|---|---|
| **Priority** | **P2** |
| **Implementation** | `src/components/companies/company-detail/company-services-tab.tsx:37` |

The compact row selects only `service.feeLines[0]`; users cannot tell that
additional operational fees exist without opening the editor.

**Required action:** Show a concise multi-fee summary or the first fee plus an
explicit additional-fee count.

---

### CSA-REV-017 - New Controls Do Not Fully Follow the UI Guidelines

| Field | Value |
|---|---|
| **Priority** | **P2** |
| **Editor controls** | `src/components/companies/company-detail/client-service-editor.tsx:41` |
| **Filter/retry/edit controls** | `src/components/companies/company-detail/company-services-tab.tsx:30` |
| **Guideline** | `docs/guides/DESIGN_GUIDELINE.md` - Form labels, validation states, and mobile touch targets |

Several new controls use raw inputs with `text-sm` labels instead of the shared
form/label pattern, provide no field-level error state, and use `xs` buttons on
mobile without the required 44-by-44-pixel touch target.

**Required action:** Use shared form components where practical, add accessible
error associations and focus states, and make compact buttons 44 pixels on
mobile while retaining desktop density.

## Stage 3 Requirements Coverage

| Stage 3 task | Assessment |
|---|---|
| 1. Operational schema and activation fields | **Mostly complete** - planned models/migration exist; queue indexes are missing. |
| 2. Validation and DTOs | **Mostly complete** - shapes and merged date/cadence validation exist; optimistic precondition and no-op rejection are missing. |
| 3. Client Service queries and editing | **Partial** - tenant-scoped CRUD exists; audit atomicity/detail and conflict safety do not. |
| 4. Idempotent agreement activation | **Blocked** - normal copying works, but state transitions, stale leases, audit rollback, date semantics, and finalization guards are unsafe. |
| 5. E-sign hook and scheduler retries | **Blocked** - queue hook exists, but the durable scheduler task is disabled under documented configuration. |
| 6. APIs | **Partial** - routes and primary RBAC checks exist; optimistic 409 and required error-path coverage are absent. |
| 7. Company Services tab | **Partial** - list/editor shell exists; fee editing, failure recovery, capability-aware retry, pagination, and several accessibility requirements are incomplete. |
| 8. Backup/restore/deletion ordering | **Mostly complete** - implementation ordering is sound; dry-run/compatibility coverage remains shallow. |
| 9. Documentation and verification | **Partial** - core docs exist but overstate retry/audit behavior, scheduler environment configuration is missing, full tests fail, and the manual exercise is unverified. |

## Recommended Remediation Order

1. Make manual, retry, claim, success, and failure transitions compare-and-set
   and claim-aware; reject cancelled/non-draft activation (`CSA-REV-003`).
2. Make every domain mutation and its audits atomic, then correct creation and
   actor attribution (`CSA-REV-002`, `CSA-REV-007`).
3. Guarantee documented scheduler enablement and add queue indexes
   (`CSA-REV-001`, `CSA-REV-013`).
4. Reuse the authoritative finalization guard and define stable effective-date
   semantics (`CSA-REV-004`, `CSA-REV-006`).
5. Add optimistic editing and complete the editor's fee, validation, error,
   archive, authorization, and pagination behavior (`CSA-REV-005`,
   `CSA-REV-008` through `CSA-REV-010`).
6. Replace raw persisted activation errors with stable public failure codes
   (`CSA-REV-011`).
7. Add real PostgreSQL concurrency/rollback tests and full route/browser
   workflows before trusting the release gate (`CSA-REV-012`).
8. Close the P2 precision, no-op, summary, and accessibility issues.
9. Rerun the focused, combined, browser, full repository, production build,
   and manual Task 9 activation gates.

## Acceptance Recommendation

Do not accept or merge Stage 3 yet. The implementation is structurally aligned
and its normal-path automated checks are green, but durable retry enablement,
transactionally correct audits, and concurrency-safe lifecycle transitions are
non-negotiable Stage 3 guarantees and are currently broken.

Re-review after all P0 and P1 findings are closed, the full release gate is
green or its unrelated failures are formally baselined, a real PostgreSQL
concurrency suite passes, and the manual e-sign/manual/retry/immutability
exercise from Task 9 has been completed.
