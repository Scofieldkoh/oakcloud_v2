# Business Assistant main reconciliation and P16 readiness

Date: 2026-09-10
Branch: `chatgpt/business-assistant-main-reconcile-p16-20260910`
Baseline: current `main` after PRs #19, #20, #21, #22, and #23

## Purpose

This addendum reconciles `docs/plans/2026-09-05-business-assistant-implementation.md` against the fully merged Business Assistant implementation. The older implementation plan remains useful as historical design context, but its PR-status/open-work statements before this addendum are no longer authoritative.

This work prepares the integrated system for P16 validation. It does **not** enable Business Assistant, provider, mutation, learning-promotion, or any other production gate.

## PR reconciliation

| PR | Integrated scope | Reconciled status on main |
| --- | --- | --- |
| #19 | P12 independent source review, full-state evidence semantics, reviewer-quality evaluation | Merged. Deterministic full-state contract and final combiner are present. Integration defect found: the registered BizFile capability still returned the legacy selected-change reviewer directly, so selected-change evidence could bypass the intended mandatory second gate. |
| #20 | P12 correction runtime, recovery and transaction hardening | Merged. Correction preparation, prefetch outside the serializable transaction, fresh revalidation, new-operation confirmation and recovery foundations are present. |
| #21 | P14 governed preference/learning lifecycle | Merged. Production promotion remains intentionally compile-time/runtime gated; no gate is enabled by this reconciliation. |
| #22 | P12 correction concurrency/race hardening | Merged. Complements #20 with race/concurrency fixtures. Existing PostgreSQL fixture remains partly synthetic and is therefore evidence for locking/fencing, not a substitute for retained-source storage execution. |
| #23 | P13/P15 fairness, partial outcomes, operational hardening, retention/backup/recovery/runbooks | Merged. No production rollout switch is changed here. |

## Integration defects identified and fixes

### 1. Full-state reviewer was not authoritative at runtime

The PR #19 final combiner correctly requires both selected-change conformance and independent full-state evidence for factual PASS, but the generated runtime registry still exposed the older BizFile `review` handler directly. That handler is scoped to `SELECTED_CHANGES_ONLY` and cannot establish complete before/source/after coverage.

Fix: add a registration-time Business Assistant integration review gate. For `bizfile.import_and_review`, a review cannot remain PASS unless its coverage proves all of the following final-combiner invariants:

- selected-change evidence established;
- full-state evidence established;
- complete non-zero full-state path coverage;
- source binding valid;
- immutable before digest valid;
- immutable after digest valid;
- no full-state failure codes.

Until the runtime full-state evidence producer emits that final contract, the registered capability fails closed to `NEEDS_REVIEW` / `UNVERIFIABLE` / `INCOMPLETE`. Existing hard failures are preserved. The gate never upgrades a result.

This is deliberately a safety reconciliation, not a substitute for P16 real-provider/full-state evaluation. P16 should exercise the actual evidence producer and final combiner end to end; it must not remove the fail-closed invariant merely to obtain PASS results.

### 2. Same-pointer retained-source correction could dead-end required effects

A BizFile correction reuses the immutable source bytes from the original committed receipt. If the source operation already finalized the document to its deterministic hash-addressed storage key, correction `STORAGE_FINALIZE` assigns the same key again.

The existing document source-revision trigger increments only when a source field is factually different. The correction effect contract, however, binds `PAGE_PREPARATION` to `sourceRevision + 1`. Therefore a same-pointer correction could leave the revision unchanged and make the next required effect fail with a source-revision mismatch.

Fix: split storage-key revision handling from the general source-state guard. A same-value storage-key assignment advances the source revision only while an exact, live, receipt-bound `STORAGE_FINALIZE` effect is `PROCESSING`, with matching tenant, receipt, document, target, storage key, source revision, claim token and unexpired lease. Ordinary same-value updates remain no-ops. Actual storage-key changes continue to advance exactly once.

### 3. Required-effect dependency order was not durable

The BizFile effect worker orders runnable work by retry time, creation time, then effect ID. `STORAGE_FINALIZE` and `PAGE_PREPARATION` are created in the same canonical transaction; PostgreSQL transaction timestamps can therefore tie, leaving a random UUID to decide which required effect is claimed first. `PAGE_PREPARATION` is not safe to run before finalization because it expects the finalized source revision.

Fix: enforce the dependency at the canonical effect repository boundary. `PAGE_PREPARATION` now requires a durable same-receipt/same-target `STORAGE_FINALIZE` predecessor and receives a strictly later durable creation timestamp. This preserves the worker's global fairness ordering while making the required per-receipt sequence deterministic.

### 4. Correction PostgreSQL coverage was fragmented outside the authoritative command

`test:business-assistant:postgres` previously omitted the correction-concurrency fixture and the BizFile correction-race fixture even though CI ran them separately. This made it possible to run the advertised Business Assistant PostgreSQL suite without correction hardening evidence.

Fix: the Business Assistant PostgreSQL command now includes:

- durable Business Assistant execution;
- fresh authorization;
- learning lifecycle;
- correction concurrency;
- retained-source filesystem correction effects;
- source-revision and aggregate-revision guards;
- operation reconciliation;
- required BizFile effect execution;
- BizFile correction race coverage.

This command is the local/CI integration entry point for P16 preparation.

## Real-storage E2E closure

A new PostgreSQL + `LocalStorageAdapter` integration fixture covers the storage condition that was missing from the merged tests:

1. create real workspace/user/company/document rows;
2. write a valid PDF through the real filesystem storage adapter;
3. model the retained source at its already-finalized deterministic key;
4. persist a real committed BizFile receipt and immutable SOURCE evidence;
5. create required effects through the canonical effect repository and verify durable `STORAGE_FINALIZE` -> `PAGE_PREPARATION` ordering;
6. claim and execute the real required-effect handlers;
7. verify receipt effect completion;
8. verify same-pointer source revision advances exactly once;
9. verify page rows are prepared from the retained PDF;
10. verify retained source bytes are unchanged.

The existing SQL correction-proposal/confirmation fixture remains responsible for new-operation identity, immutable source lifecycle preservation and approval semantics. The new filesystem fixture closes the storage/effect half that the previous synthetic race tests could not prove. P16 staging should additionally exercise the configured production object-storage provider; that is environment validation, not a reason to enable production dispatch.

## P16 entry criteria after this reconciliation

P16 may begin when this reconciliation PR is green. P16 should be an evidence/rollout-readiness phase, not a gate-enablement phase.

Required P16 validation:

1. Run `npm run test:business-assistant:postgres` against the disposable PostgreSQL fixture after migrations.
2. Run the complete non-PostgreSQL Business Assistant/BizFile test suites and registry freshness/type checks.
3. Exercise the real full-state evidence producer and PR #19 final combiner with held-out documents; factual PASS must be impossible without the complete contract.
4. Exercise correction preparation -> confirmation -> canonical mutation -> required effects -> read-back -> independent review in staging with retained source bytes on the configured object-storage provider.
5. Re-run cancellation, expiry, authorization revocation, backup/restore pause, retry-budget and partial-outcome scenarios on the integrated main-derived build.
6. Capture lock-duration/timeout/resource-budget metrics under representative 1-10 item workloads.
7. Confirm backup/restore drills and retention evidence against the P13/P15 runbooks.
8. Record all evidence before proposing any production-gate change in a separate, explicitly reviewed change.

## Production gates

No production gate is enabled by this reconciliation. In particular, this branch does not change production defaults or deployment values for:

- `BUSINESS_ASSISTANT_ENABLED`;
- `BUSINESS_ASSISTANT_PROVIDER_ENABLED`;
- `BUSINESS_ASSISTANT_MUTATIONS_ENABLED`;
- learning/promotion activation controls;
- any deployment environment or secret.

Tests may set flags only inside their isolated process where required to exercise protected code paths. A future production enablement must be a separate reviewed decision after P16 evidence is complete.

## Remaining external evidence, not code-completion claims

The following cannot be established by repository-only CI and remain P16/staging evidence:

- real configured external provider behavior and latency;
- real production-class object-storage permissions/network behavior;
- deployment-specific backup destination and restore drill timings;
- production traffic/resource budgets;
- operator sign-off on runbooks and rollback drills.

These are intentionally not represented as completed merely because unit/PostgreSQL/filesystem CI is green.
