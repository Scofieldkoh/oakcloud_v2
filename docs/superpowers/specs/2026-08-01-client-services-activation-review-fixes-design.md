# Client Services Activation Review Fixes Design

**Date:** 2026-08-01

**Scope:** Resolve every remaining finding in the Stage 3 Client Services Activation review and every failure exposed by the full repository test suite, without expanding the product beyond the approved service-agreement roadmap.

## Goals

- Make concurrent Client Service edits recoverable without silently overwriting newer data.
- Preserve a complete, useful audit trail for manual activation.
- Align the Prisma schema contract with the partial indexes actually deployed by the migration.
- Complete the editor's accessibility and responsive behavior.
- Replace shallow activation checks with realistic lifecycle, authorization, backup, and concurrency coverage.
- Fix all unrelated full-suite failures uncovered by release verification.
- Make the PostgreSQL integration gate mandatory in CI while keeping local execution safe when no dedicated test database is configured.

## Conflict Recovery

The editor continues to use optimistic concurrency through `updatedAt`. HTTP request failures retain their status so the UI can distinguish a `409 Conflict` from ordinary validation or server failures.

On a conflict, the dialog remains open and explains that the service changed elsewhere. The user must explicitly reload the latest service. Reloading fetches the current detail, replaces the displayed form values, and installs the new concurrency token. The user's stale values are never resubmitted with a fresh token, because that would turn conflict recovery into an undetected last-write-wins overwrite. After reviewing or editing the reloaded values, the user can save normally.

Tests must prove that repeatedly submitting the stale token remains a conflict, that reload uses the detail endpoint, and that only the refreshed token can produce a successful update.

## Activation Correctness and Auditability

Manual activation records the actor, reason, signing date, effective date, activation source, and activation-status transition in the audit entry. Transactional activation and audit behavior remains atomic.

The activation test matrix covers claim ownership, overlapping workers, expired-lease reclamation, cancellation after queueing, stale-worker success and failure, duplicate completion, retry overlap, retry backoff, maximum attempts, and rollback on audit failure. Signing-completion coverage exercises the callable completion flow rather than checking source text with regular expressions.

Authorization and not-found API cases are verified alongside success, validation, and conflict responses. Backup tests cover dry-run behavior and restoration of backups created before the new activation tables existed.

## Database Index Contract

The migration's partial PostgreSQL indexes are authoritative:

- pending/retryable work is indexed by availability and ID;
- processing work is indexed by lease expiry and ID.

Because Prisma schema index declarations cannot express the predicates, the misleading full indexes are removed from `schema.prisma`. Contract tests inspect the migration SQL for the names, columns, and predicates and assert that contradictory full indexes are absent from the schema. Documentation explains why these indexes are migration-managed.

## Editor and Responsive UI

Editor labels, spacing, and controls follow the repository design guide and existing form primitives where those primitives fit the field type. Validation messages are associated with their fields through stable IDs and ARIA attributes. Dynamic fee-line controls preserve stable client keys and provide accessible labels and errors.

The company-detail tabs remain usable on narrow screens through horizontal overflow and non-shrinking touch targets. Component and browser tests verify accessibility state, compact layout behavior, conflict reload, archive confirmation, pagination, and mobile tab behavior.

## Release-Suite Repairs

The generated-preview and generated-validation tests are updated to assert the current service interfaces rather than obsolete call signatures. BizFile-confirm and service-catalog timeouts are diagnosed in isolation and under the full suite. Production behavior or test setup is corrected at the cause; timeouts are increased only when measured initialization cost is legitimate and assertions remain strict.

No test will be disabled, diluted, or rewritten to accept incorrect behavior merely to make the suite green.

## Verification Gates

The work is complete only when all applicable gates pass:

1. Prisma client generation and schema/migration contract tests.
2. Focused Stage 3 unit, component, API, scheduler, backup, and activation suites.
3. Browser-mode Client Services tests.
4. PostgreSQL activation integration tests against `TEST_DATABASE_URL`.
5. Production build.
6. Full repository test suite.
7. `git diff --check`.

CI fails clearly if the dedicated PostgreSQL test URL is absent. A local run without that URL may report the integration suite as skipped, but it cannot be presented as satisfying the PostgreSQL gate.

## Documentation and Review Closure

Existing Stage 3 plan, architecture, schema, service-pattern, environment-variable, and review documents are updated in place. The review report records each finding's final disposition and the exact verification results, including any external gate that cannot be executed locally.

## Non-Goals

- Redesigning the wider company workspace or service-agreement workflow.
- Replacing optimistic concurrency with automatic merging.
- Pointing destructive integration tests at the ordinary development `DATABASE_URL`.
- Refactoring unrelated modules unless required to correct a demonstrated full-suite failure.
