# Task 1 review — billing tracking schema

## Verdict

**FAIL** — 0 Critical, 5 Important, 2 Minor. PASS requires 0 Critical and 0 Important.

Review target: base `41e7beb93880ca2c96b4f52db9a64b9077599eb7`, head `66197f3c399d693e9e8816c8c251115e8bb3cf88`.

The additive ordering/defaults, requested enums and mapped fields, partial open-issue uniqueness, required query indexes, restrictive source deletion actions, optional `billedDate`, generated client surface, and absence of new invoice/payment/ledger models are otherwise consistent with Task 1.

## Critical

None.

## Important

### I1. Billing rows have no database-enforced tenant/company/client-service/fee-line lineage

`prisma/migrations/20260817110000_billing_tracking/migration.sql:99-127` adds independent foreign keys for `tenant_id`, `company_id`, `client_service_id`, and `fee_line_id`. Each ID only has to exist; the referenced rows do not have to belong to the supplied tenant, the company does not have to own the client service, and the fee line does not have to belong to that client service. The Prisma relations at `prisma/schema.prisma:1501-1504` and `prisma/schema.prisma:1533-1536` mirror those independent single-column references, and generated unchecked inputs expose the raw IDs.

Consequently, both `BillingOccurrence` and `BillingCoverageIssue` can persist tenant A beside a company/client service/fee line from tenant B, or internally mismatched same-tenant lineage. Tenant-filtered reads can then surface another tenant's source data through included relations and reconciliation can mutate/cancel the wrong lineage. This violates the approved isolation rule that referenced records belong to the same tenant and the Task 1 tenant/company/client-service/fee-line integrity contract.

Add composite guards (or equivalent constraint triggers) that prove the full chain: tenant/company/client service, tenant/client service/fee line, and occurrence/issue lineage. Add the required parent composite unique keys and a migration test that attempts cross-tenant and cross-client inserts.

### I2. `NOT_REQUIRED` with a null reason passes the disposition check

The constraint at `prisma/migrations/20260817110000_billing_tracking/migration.sql:129-135` evaluates the `NOT_REQUIRED` branch as `length(trim(NULL)) >= 3`, which is SQL `UNKNOWN`. PostgreSQL accepts a CHECK result that is `TRUE` or `NULL`, so a row with `billing_disposition = 'NOT_REQUIRED'` and `billing_not_required_reason = NULL` is accepted.

This breaks the approved invariant that every `NOT_REQUIRED` service has a reason. Make null rejection explicit, e.g. include `billing_not_required_reason IS NOT NULL` in the `NOT_REQUIRED` branch, and cover null, whitespace, short, and valid reasons behaviorally.

### I3. `ON DELETE SET NULL` conflicts with actor-required consistency checks

The date/value override and billed checks require actor IDs whenever their state is active (`migration.sql:138-151`), while their user foreign keys declare `ON DELETE SET NULL` (`migration.sql:107-114`; Prisma relations at `schema.prisma:1505-1507`). Deleting a referenced user asks PostgreSQL to null the actor ID, then the CHECK rejects the resulting row. The declared referential action therefore cannot complete for overridden or billed history.

This undermines historical retention and makes the schema's advertised actor deletion behavior false. Preserve an immutable actor identifier/snapshot independent of the optional user relation, relax only the user FK while retaining auditable actor data, or use a deletion strategy consistent with the checks. Add a migration-level actor-deletion case.

### I4. Lifecycle checks permit partial and actorless state metadata

The billed biconditional at `migration.sql:150-151` permits a non-BILLED row with exactly one of `marked_billed_at` or `marked_billed_by_id` populated. The waiver/cancellation biconditionals at `migration.sql:152-155` do not mention `waived_by_id`/`cancelled_by_id` at all: a WAIVED row may have no waiver actor, and OPEN/BILLED rows may retain stray actor IDs or partial waiver/cancellation metadata.

These are impossible/audit-incomplete lifecycle states and are weaker than the adjacent Plan 2 deadline pattern, which uses explicit status and non-status branches with all relevant fields. Replace these with explicit branches that require the complete metadata set for the active status and require every status-specific field to be null otherwise, subject to the chosen historical actor-retention design.

### I5. Override flags do not protect base/operative equivalence

The checks at `migration.sql:138-149` validate only override metadata. They allow `date_overridden = FALSE` while calculated and operative dates differ, and `value_overridden = FALSE` while base and operative amount/currency differ. That makes the flags unreliable for the reconciliation rule that only non-overridden open occurrences may be recalculated, and lets a later worker overwrite an unmarked operative edit.

Enforce calculated/operative equality when the corresponding override flag is false (or otherwise introduce an equally strong invariant). Add behavioral cases for unflagged date, amount, and currency divergence.

## Minor

### M1. Fee-line archive fields can contradict each other

`is_active`, `deleted_at`, and `deleted_reason` are added at `migration.sql:18-23` / `schema.prisma:1446-1449` without an archive consistency constraint. Rows can be active and deleted, inactive without archive metadata, or carry a deletion reason without a deletion timestamp. If inactive-but-not-archived is intentional, document its separate meaning; otherwise enforce one canonical soft-archive state and reason policy.

### M2. The new test is structural only and cannot catch the blocking SQL semantics

`__tests__/services/billing-tracking-schema.test.ts` checks strings/regexes but does not execute the constraints. It passes while I1-I5 remain possible. Add a focused isolated PostgreSQL migration test for lineage, disposition-null behavior, lifecycle metadata, actor deletion, override equivalence, partial uniqueness, and restrictive deletion. This review did not run or apply a live migration, as explicitly prohibited.

## Verification evidence

### Passed

```text
npm.cmd run test:run -- __tests__/services/billing-tracking-schema.test.ts __tests__/services/deadline-engine-schema.test.ts __tests__/services/services-admin-foundation-schema.test.ts --reporter=dot
PASS — 3 files, 35 tests (billing 8, deadline 25, services-admin 2)

npx.cmd tsc --noEmit
PASS — exit 0

npx.cmd eslint __tests__/services/billing-tracking-schema.test.ts --max-warnings=0
PASS — exit 0, zero warnings

$env:DATABASE_URL='postgresql://test:test@localhost:5432/test'; npx.cmd prisma validate
PASS — schema valid

git diff --check 41e7beb9..66197f3c
PASS — exit 0

git diff --exit-code
PASS — clean tracked worktree before this review artifact

git status --short
PASS — clean worktree before this review artifact

git rev-parse HEAD
66197f3c399d693e9e8816c8c251115e8bb3cf88

git merge-base 41e7beb9 66197f3c
41e7beb93880ca2c96b4f52db9a64b9077599eb7
```

Generated-client inspection covered `browser.ts`, `client.ts`, `enums.ts`, `models.ts`, the new `BillingOccurrence.ts` and `BillingCoverageIssue.ts`, and changed `ClientService`, `ClientServiceFeeLine`, `Company`, `User`, and `Workspace` model outputs. Required enums, fields, inverse relations, delegates, filters, creates/updates, and relation payloads are present; TypeScript passes.

### Pre-existing exact-format failures (not Task 1 regressions)

```text
npm.cmd run test:run -- __tests__/services/client-service-schema.test.ts __tests__/services/service-catalog-schema.test.ts __tests__/services/service-agreement-schema.test.ts --reporter=verbose
FAIL — 3 files; 3 failed, 4 passed
```

The failures are exact-string expectations for:

- `source               ClientServiceSource  @default(AGREEMENT)`
- `compositionType DocumentTemplateCompositionType @default(STANDARD)`
- `generatedDocumentId String @unique`

The following base/head comparison confirmed all three strings are absent at both base and head, so Task 1 did not introduce these failures:

```text
$base = git show 41e7beb9:prisma/schema.prisma | Out-String; $head = Get-Content -Raw prisma/schema.prisma; $checks = @('source               ClientServiceSource  @default(AGREEMENT)','compositionType DocumentTemplateCompositionType @default(STANDARD)','generatedDocumentId String @unique'); foreach ($check in $checks) { Write-Output "EXPECTATION=$check"; Write-Output "BASE_CONTAINS=$($base.Contains($check))"; Write-Output "HEAD_CONTAINS=$($head.Contains($check))" }
BASE_CONTAINS=False and HEAD_CONTAINS=False for all three expectations
```

## Scope compliance

- Reviewed the actual base/head diff and clean worktree, not only the implementation report.
- Read `AGENTS.md`, the full approved specification, Plan 3 global constraints/public interfaces/Task 1, current Prisma schema, new migration/test, generated-client diff, Task 1 report/progress ledger, and relevant Plan 2 deadline schema/migration patterns.
- Did not run repository baseline, full build, full lint, live database tests, migration application, or performance tests.
- Did not modify implementation files.
