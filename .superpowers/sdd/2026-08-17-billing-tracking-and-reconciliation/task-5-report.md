# Task 5 handoff: configure client-service billing tracking

## Scope

Implemented Plan 3 Task 5 only. Client-service create/update and agreement activation now persist explicit billing disposition, structured fee schedules, and archive metadata; service writes audit before/after changes and enqueue reconciliation transactionally. The shared operational form exposes the required Configured/No billing required choice, repeatable schedule entries, migrated-record warnings, and confirmation before hiding active billing schedules.

## RED evidence

The review-fix RED run used the focused Task 5 suites and produced genuine failures (16 failed, 143 passed, 159 total). The failures covered the unrestricted billing schedule editor, incomplete configured schedule materialization, custom interval authoring, NOT_REQUIRED/manual lifecycle invariants, structured/legacy conflicts, audit snapshots, activation handoff assertions, and the warning-bearing confirmation interaction. The earlier sandboxed invocation only failed to resolve the linked-worktree Vitest configuration and was not treated as test evidence.

## GREEN evidence

Final focused command:

    npm.cmd run test:run -- __tests__/lib/client-service-validation.test.ts __tests__/services/client-service-manual-create.test.ts __tests__/services/client-service.service.test.ts __tests__/components/client-service-creator.test.tsx __tests__/components/company-services-tab.test.tsx __tests__/api/client-services-routes.test.ts __tests__/api/manual-client-services-routes.test.ts __tests__/components/operational-service-form.test.tsx __tests__/services/service-agreement-activation.service.test.ts --reporter=dot

Result: 10 test files passed, 184 tests passed, with no React act warnings.

Directly affected billing and worker suites:

    npm.cmd run test:run -- __tests__/lib/billing-validation.test.ts __tests__/services/billing-schedule.test.ts __tests__/services/billing-coverage.test.ts __tests__/services/billing-reconciler.test.ts __tests__/services/schedule-reconciliation.test.ts __tests__/services/schedule-reconciliation-worker.test.ts __tests__/services/schedule-reconciliation-observability.test.ts --reporter=dot

Result: 7 test files passed, 106 tests passed.

Additional scoped gates passed:

    npx.cmd tsc --noEmit
    npx.cmd eslint src/lib/validations/client-service.ts src/components/companies/company-detail/client-service-form-state.ts src/components/companies/company-detail/operational-service-form.tsx src/components/services/shared/schedule-entry-editor.tsx src/services/billing/coverage.ts src/services/billing/reconciler.ts src/services/billing/schedule.ts src/services/client-service/fee-summary.ts src/services/client-service/manual-create.ts src/services/client-service/service.ts src/services/service-agreement/activation.service.ts __tests__/components/client-service-creator.test.tsx __tests__/components/operational-service-form.test.tsx __tests__/components/schedule-entry-editor.test.tsx __tests__/lib/client-service-validation.test.ts __tests__/services/billing-reconciler.test.ts __tests__/services/client-service-manual-create.test.ts __tests__/services/client-service.service.test.ts __tests__/services/service-agreement-activation.service.test.ts --max-warnings=0
    git diff --check

All scoped gates passed. Repository-wide build/lint, live migrations, PostgreSQL integration, browser/performance checks, and unrelated test suites were intentionally not run.

## Re-review round 2 evidence

RED blocker command:

    npm.cmd run test:run -- __tests__/services/client-service.service.test.ts __tests__/components/operational-service-form.test.tsx --reporter=dot

Result: 2 failed, 36 passed, 38 total. The new tests reproduced the false `sourceAgreementFeeLineId: null` audit snapshot and the loss of a two-entry schedule after a start-date edit.

GREEN blocker command:

    npm.cmd run test:run -- __tests__/services/client-service.service.test.ts __tests__/components/operational-service-form.test.tsx --reporter=dot

Result: 2 test files passed, 38 tests passed.

The complete focused Task 5 suite passed with 10 files / 185 tests, and directly affected billing/worker compatibility passed with 7 files / 106 tests. TypeScript, scoped zero-warning ESLint, and `git diff --check` passed after the final correction. No act warnings were emitted.

Round-2 decisions: update after-snapshots now use the exact existing fee ID and immutable agreement lineage, while new rows receive the same generated ID/lineage used by persistence. The operational form treats an existing structured schedule as authoritative during frequency/start edits, cloning only cadence, interval, or start fields and preserving every authored entry/key; default entry synthesis remains limited to absent legacy configuration.

## Files and implementation decisions

- `src/lib/validations/client-service.ts`, `src/services/billing/schedule.ts`: add one canonical structured/legacy schedule resolver, materialization checks, cadence/start conflict validation, deterministic legacy conversion, and preserve the canonical `expectedUpdatedAt` transform. Manual create accepts only Configured/Not required explicitly; omitted legacy input normalizes to Unreviewed.
- `src/services/client-service/types.ts`, `src/services/client-service/mapper.ts`: expose disposition/reason and structured fee schedules while filtering archived fee rows from the public DTO.
- `src/services/client-service/fee-summary.ts`, `manual-create.ts`, `service.ts`: persist billing state/schedules transactionally, enforce manual NOT_REQUIRED/lifecycle invariants at schema and service boundaries, retain fee lineage, generate stable fee IDs, and audit bounded canonical before/after snapshots containing identity, description, lifecycle/reason, amount/currency, legacy recurrence/start, structured schedule, and schedule hash.
- `src/services/service-agreement/activation.service.ts`: sets activation disposition from fee presence, materializes deterministic agreement fee schedules using the item start date, persists schedule config, snapshots billing audit data, and keeps enqueue in the activation transaction.
- `src/services/billing/coverage.ts`, `reconciler.ts`: consume the canonical schedule helper while preserving coverage issue classifications and future-OPEN-only NOT_REQUIRED cancellation semantics.
- `src/components/companies/company-detail/client-service-form-state.ts`, `operational-service-form.tsx`, `src/components/services/shared/schedule-entry-editor.tsx`: add controlled billing choice/reason state, warning and select-before-save validation, deterministic legacy/default schedule entries, configurable validated CUSTOM month intervals, billing-safe source/offset capabilities, responsive accessible controls, functional state updates, and confirmation before hiding active schedules. Deadline editors retain the full shared capability set.
- Focused tests cover capability serialization, materializable creator/editor schedules including non-1-month CUSTOM intervals, schema/service lifecycle and conflict validation, bounded audit snapshots, activation dispositions/enqueue, lineage transitions, future OPEN cancellation preservation, company/API compatibility, and awaited confirmation interactions.

## Commit

Commit: `c6e91916 fix: preserve billing schedule and audit lineage`.

## Self-review

- Only Task 5 production/test/report files were changed; `progress.md` and review artifacts were not edited.
- Legacy manual callers remain accepted at the service boundary without re-validating test-only fake identifiers; API routes still parse the full schema before calling the service.
- Structured schedules are canonicalized once against compatibility cadence/start fields; configured writes require a valid start date and at least one stable entry, while UNREVIEWED compatibility paths retain actionable missing-configuration behavior.
- Audit snapshots are explicitly bounded to 100 fee lines, 31 schedule entries, and 500-character text fields; manual-created fee rows receive stable IDs before the audit is written.
- Prisma nullable JSON fields use `Prisma.JsonNull`, and archived fee rows retain lineage while disappearing from public DTOs.
- The implementation does not issue invoices or payments; it only stores expected billing configuration and queues reconciliation.
