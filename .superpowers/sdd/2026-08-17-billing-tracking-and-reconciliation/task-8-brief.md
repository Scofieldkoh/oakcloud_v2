### Task 8: Verify isolation, manual-trigger separation, performance, migrations, and operations

**Files from the approved plan:**
- Create: `__tests__/integration/billing-tenant-isolation.postgres.test.ts`
- Create: `__tests__/integration/manual-deadline-no-billing.postgres.test.ts`
- Create: `__tests__/integration/billing-performance.postgres.test.ts`
- Modify: `src/services/schedule-reconciliation/worker.ts`
- Modify: `docs/guides/SERVICE_PATTERNS.md`
- Modify: `package.json`

**Permitted deferred-contract files:**
- Modify the smallest billing schedule evaluator/schema/test set necessary to close the recorded Task 2 `ONE_TIME` repeatable-entry Minor.

**Interfaces:**
- Consumes: the complete Plan 3 billing feature and its two migrations.
- Produces: final acceptance evidence, safe structured metrics, PostgreSQL isolation/performance coverage, operational documentation, and release scripts.

**Execution rules:**
- Use strict TDD for every code change. Prove focused RED before implementation and record RED/GREEN evidence.
- This is the final implementation task, so the previously deferred repository-wide baseline, full lint/build, live isolated PostgreSQL, migration, and performance gates are now authorized and required.
- Never point destructive setup or migrations at an unverified/shared database. Resolve the exact isolated test database first; create/use a disposable local PostgreSQL database or container if needed. Do not expose credentials in logs/reports.
- Preserve tenant/access predicates in SQL and measure production service paths, not test-only substitutes.
- Do not weaken, delete, or skip existing tests to make the matrix pass. Fix feature-caused failures; report unrelated pre-existing failures with evidence.

- [ ] **Step 1: Close the deferred repeatable `ONE_TIME` contract**

The approved product contract allows repeatable schedule-entry lists for every service family. A `ONE_TIME` billing schedule may therefore contain more than one stable entry; each entry must materialize exactly once from the effective start/canonical formula. It must not silently choose only the lexically first entry. Add focused RED coverage for multiple stable entries, determinism/idempotence, and bounded range behavior, then make the smallest evaluator/schema change. Preserve the billing evaluator's supported-source restriction and all existing cadence behavior.

- [ ] **Step 2: Write PostgreSQL tenant-isolation and manual-trigger separation tests**

Add isolated PostgreSQL tests proving:

- occurrence list/detail, coverage summary/issues, and mutations cannot expose or change another tenant's rows;
- company-access scope remains enforced in SQL, not post-pagination filtering;
- creating a manual historical deadline cycle does not enqueue a billing reconciliation request and creates/recalculates/cancels no billing occurrences after the worker runs;
- both positive same-tenant control cases and negative cross-tenant cases are present.

Use the repository's existing PostgreSQL harness and production services/routes/worker paths. Tests may guard on `TEST_DATABASE_URL`, but the final verification in this task must supply an isolated live database and actually execute them.

- [ ] **Step 3: Add representative performance fixtures and query-plan assertions**

With `RUN_PERFORMANCE_TESTS=true`, seed the approved representative dataset in an isolated tenant: 1,000 Companies, 10,000 ClientServices, 100,000 BillingOccurrences, and unresolved coverage across 10% of services. Exercise the production paginated Billing list and coverage summary services.

Assert each representative call completes within 1.5 seconds on the isolated staging-grade PostgreSQL setup and inspect `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` for tenant/date/status and unresolved-issue index usage. Keep fixtures deterministic, bounded, tenant-isolated, and cleanly recoverable. When the flag is absent, the suite may be explicitly skipped; the final Task 8 run must enable it once and record environment/timing/plan evidence without credentials.

- [ ] **Step 4: Extend the worker's single structured reconciliation event**

For every processed request, emit one bounded structured event containing billing created/recalculated/cancelled/preserved counts; coverage opened/resolved counts; services missing disposition; invalid schedule count; occurrence gaps; duration; attempt; tenant; request/correlation ID; and Observe/Apply write mode. Never log notes, external references, company-upload data, or other free-form customer content. Add focused tests for exact allowlisted keys, counts, one-event cardinality, and forbidden-field absence on success/retry/failure paths as applicable.

- [ ] **Step 5: Document lifecycle, recovery, migration, and runbooks**

Update `docs/guides/SERVICE_PATTERNS.md` in place (do not create a competing guide) to cover:

- tracking-only semantics: no invoices or payment processing;
- `UNREVIEWED`, Configured, and Not required migration/coverage behavior;
- optional billed date and immutable audit timestamps;
- amount/currency scope behavior and Open-only future propagation;
- archived fee-line lineage and future-Open cancellation rules;
- repeatable schedules for every family, including multiple/relative dates;
- manual deadline cycles never create billing;
- collapsed reconciliation/cards-only-for-issues behavior;
- reconciliation recovery, idempotent backfill, metrics, and safe rerun steps.

Add the approved `test:billing:postgres` and `test:billing:performance` scripts to `package.json`, including all required Plan 3 PostgreSQL suites.

- [ ] **Step 6: Run the complete final verification matrix**

Run and record exact outcomes for:

1. `npm.cmd run db:generate`
2. the complete Plan 3 focused billing matrix from the approved plan;
3. `npm.cmd run test:browser -- __tests__/browser/services-billing.browser.test.tsx` at the covered viewports;
4. `npm.cmd run test:billing:postgres` with an isolated `TEST_DATABASE_URL` (no guarded skips);
5. `npm.cmd run test:billing:performance` with `RUN_PERFORMANCE_TESTS=true` (no guarded skip);
6. the repository-wide baseline `npm.cmd run test:run`;
7. `npx.cmd tsc --noEmit`;
8. `npm.cmd run lint`;
9. `npm.cmd run build`;
10. `git diff --check` and a clean scoped worktree audit.

If a command is unavailable or fails for an environment reason, exhaust safe in-scope setup and alternatives, record exact evidence, and do not claim that gate passed.

- [ ] **Step 7: Apply and inspect both billing migrations in isolation**

Against the verified disposable PostgreSQL database, apply the full migration chain including both billing migrations. Prove migrations apply from a clean schema and upgrade a representative pre-billing fixture. Inspect that existing fee amounts/currencies remain intact, deterministic frequencies backfill without invented dates, custom gaps become explicit issues, and exactly one deduplicated billing backfill request exists per tenant. Record the exact isolated target identity in redacted form and the observed row/constraint/index checks.

- [ ] **Step 8: Commit acceptance coverage and report**

Commit implementation/tests/docs as `test: verify billing tracking acceptance`. Write `task-8-report.md` with focused RED/GREEN evidence, full matrix results, live PostgreSQL/migration/performance evidence, any environment limitations, and a clean-worktree statement. Do not commit secrets, generated browser artifacts, database volumes, review packages, or disposable fixtures.

---
