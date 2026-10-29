# PR #18–#23 Main Integration Handover

**Integration date:** 2026-09-10 (Singapore)  
**Repository:** `Scofieldkoh/oakcloud`  
**Target:** `main`

## Purpose

This document records the integration of PRs #18 through #23 and is the authoritative post-merge status note for this integration batch. The individual parallel-agent handovers remain useful for workstream detail, but any pre-merge status statements in those files should be read in light of this integrated state.

## Integrated pull requests

- **#18 — Enhance e-sign preparation with linked company signer shortcuts.** Added linked-company contact shortcuts and supporting e-sign preparation/UI coverage.
- **#19 — Complete P12 independent source review and held-out evaluation.** Added full-state/unselected source-review semantics, evidence integrity/provenance checks, reviewer independence controls, annotated/held-out fixtures, quality metrics, and the final review combiner.
- **#20 — Harden Business Assistant correction runtime and recovery.** Added bounded correction serializable transaction behavior, source/version/pointer race coverage, PostgreSQL lock/timeout coverage, reconciliation identity coverage, and Node 24 workflow coverage.
- **#21 — Harden Business Assistant P13/P15 operations and recovery.** Added batch fairness/partial-outcome hardening, operational budgets, bounded retries, retention classification/purge ordering, and the Business Assistant operations runbook.
- **#22 — Complementary P12 correction hardening.** The production correction service and bounded transaction implementation were identical to #20. Integration therefore retained the already-merged production sources and combined #22's complementary authority, lifecycle-preservation, race, reconciliation, and retry-budget tests without overwriting the newer shared implementation plan.
- **#23 — Govern Business Assistant P14 preference learning lifecycle.** Added source-controlled learnable targets, held-out behavioural evaluation, versioned/CAS promotion lifecycle, runtime consumption, deactivation/expiry/rollback/delete semantics, derived-learning cleanup, API surfaces, and PostgreSQL/concurrency coverage.

## Integration and deconfliction decisions

### Shared P12 correction implementation (#20 / #22)

The two P12 correction branches contained the same production blobs for:

- `src/services/business-assistant/correction.service.ts`
- `src/services/business-assistant/correction-transaction.ts`

The differences were primarily complementary tests, CI coverage, and parallel handover edits. The integration kept the production implementation already merged from #20 and merged the stronger/unique test coverage from #22. The older competing copy of the shared implementation-plan text was not allowed to replace the newer integrated plan.

### Shared implementation plan (#20 / #21 / #22)

Parallel agents had independently edited `docs/plans/2026-09-05-business-assistant-implementation.md`. During integration, the newer P12 plan already present on `main` was preserved instead of resolving conflicts by wholesale replacement from an older parallel branch. P13/P15 operational details remain available in `docs/runbooks/business-assistant-operations.md`, the individual handovers remain historical workstream evidence, and this file records the converged integration state.

### CI fixes made during verification

Two failing PR checks were found to be test-harness defects rather than production defects:

1. **#22 correction authority test:** the contract-version test changed the mocked registry before prefetch, preventing the intended prefetch path from running. The test was corrected so the old contract is observed during prefetch and the changed contract is observed during transactional revalidation.
2. **#23 learning lifecycle tests:** the fixture activation timestamp was January 2026 while several tests implicitly used the wall clock. By September 2026 the target correctly appeared expired. The affected tests now use an explicit deterministic clock within the active TTL.

The corrected #23 Node 24 compatibility workflow completed successfully across PostgreSQL recovery/authorization, lint, registry freshness, Prisma generation, typecheck, Chromium path tests, Business Assistant/BizFile contract tests, application build, production image build, and final runtime/Chromium verification.

For #22, the corrected branch completed PostgreSQL recovery tests, lint, registry freshness, Prisma generation, typecheck, Chromium tests, Business Assistant/BizFile contract tests, and application build successfully. GitHub cancelled the superseded workflow while its production-image job was running after the branch was updated for integration; the production runtime implementation itself was unchanged from already-green #20, and #22's integrated delta consisted of complementary tests.

## Current safety/release state

Merging these PRs does **not** enable production provider dispatch, production mutation dispatch, or production learning promotion.

P14 learning promotion remains compile-time gated with `PRODUCTION_RELEASED = false`. There is no production environment variable that can activate it; the only override is test-only and guarded to Vitest.

## Remaining work / decisions

The integration does not claim the overall Business Assistant product is production-release complete. Remaining release work includes, where still applicable:

- P16 final release verification and representative real-topology/staging evidence;
- final cutover/rollback/kill-switch and deployment verification;
- retention duration and legal-hold decisions before destructive purge can be enabled;
- representative multi-worker fairness/contention and operational latency evidence;
- any still-required real-storage/real-provider end-to-end release evidence;
- collection-row correction semantics with stable record identity before array/collection corrections are enabled.

Existing safety invariants remain authoritative: exact approval binding, fresh authorization, immutable source/review/receipt evidence, stable operation identity, idempotent recovery/effects, source-controlled learning targets, and fail-closed behavior when evidence or authorization becomes stale.

## Next-session reading order

1. `AGENTS.md`
2. `docs/features/business-assistant/SPECIFICATION.md`
3. `docs/plans/2026-09-05-business-assistant-implementation.md`
4. **this integration handover**
5. `docs/runbooks/business-assistant-operations.md`
6. `docs/plans/2026-09-10-business-assistant-p12-reviewer-agent2-handover.md`
7. `docs/plans/2026-09-10-business-assistant-p14-agent3-handover.md`
8. `docs/features/business-assistant/CORRECTION_WORKFLOW.md`

When older handovers say a peer PR is still unmerged, red, or awaiting owner approval, this integration handover supersedes that status statement; retain the older text as historical evidence of the state at the time that parallel agent finished.