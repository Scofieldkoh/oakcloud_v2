# Business Assistant operations runbook

Status: staging-compatible operational guidance for P13/P15. This runbook does not authorize production destructive testing or define legal retention periods.

## Safety invariants

- Do not enable `BUSINESS_ASSISTANT_PROVIDER_ENABLED` or `BUSINESS_ASSISTANT_MUTATIONS_ENABLED` globally as part of testing.
- New canonical mutations require the mutation and provider release gates at the execution boundary. Existing committed receipts and module-owned required effects remain recoverable; a kill switch must not erase or fabricate a canonical outcome.
- `OUTCOME_UNKNOWN` is never treated as `NO_COMMIT`. Reconcile by stable operation identity before any re-execution.
- A worker lease, claim token, and claim generation are execution fences, not business authority. Fresh authorization remains required by capability/policy boundaries.
- Follow-up task creation is unsupported by the current BizFile plan. Do not create tasks through an assistant-only side channel.
- Destructive assistant purge is disabled until owner-approved retention periods, legal-hold semantics, and referenced-source reachability rules are versioned and approved.

## Workload and fairness checks

Exercise 1 through 10 items. Verify each item retains its own input, resources, operation identity, stage attempts, output, receipt, review evidence, and disposition. For mixed outcomes, one item may fail, block, cancel, expire, or recover without changing a sibling item's operation identity or outcome.

The durable worker has two global capacity slots. Claim ordering uses `availableAt`, then lower retry count, then creation/id ordering. Retry failures are delayed and bounded, so a repeatedly failing item yields to runnable unrelated work and becomes terminal at the retry ceiling. Record claim latency and serializable-transaction duration in staging when representative concurrent workers are available.

Correction-specific transaction timings owned by the P12 correction workstream must be re-measured after that PR integrates; this workstream must not duplicate or redesign those transactions.

## Budget exhaustion

Operational bounds are source-controlled in `src/services/business-assistant/operational-policy.ts`:

- run size: 1-10 items;
- resource references: bounded by the assistant contract;
- stage attempts: bounded per stage and in aggregate per item;
- worker failures: bounded per item and terminal as `RETRY_BUDGET_EXHAUSTED`;
- provider dispatch: bounded to the provider-backed execution stage attempt ceiling;
- retry delay: deterministic exponential delay capped at 30 seconds.

Budget exhaustion is an explicit failure outcome. Do not silently extend a budget after worker restart, manual retry, or restore.

## Cancellation, expiry, and revocation

Cancellation marks not-yet-executing items cancelled. Work already executing remains fenced by its current claim and canonical operation identity; committed or uncertain outcomes are reconciled rather than overwritten as cancelled.

Proposal approval expiry is authoritative for new execution. Re-execution after a proven `NO_COMMIT` requires a still-valid frozen approval. A committed operation may be recovered without pretending the original approval is still live.

For authorization revocation tests, revoke access between queue/approval and dispatch and verify the next fresh authorization/resource check denies new work. Do not use cached session permission as the worker authority. Restore pause is a workspace-wide dispatch barrier.

## Worker restart simulation

1. Use a disposable/staging database and keep provider/mutation gates disabled unless a test-specific capability is fully stubbed.
2. Claim an item and record claim token/generation and stage attempt.
3. Terminate the worker without settlement.
4. Advance beyond the lease or use the existing disposable recovery fixture.
5. Start a new worker and verify the old claim cannot update or settle the item.
6. Verify a prior `RUNNING` step is marked retryable with `LEASE_EXPIRED` before a new bounded attempt is created.
7. Verify no duplicate user-visible result or canonical operation identity is produced.

## Committed-effect recovery

1. Seed or produce a committed canonical receipt with a pending required effect in disposable/staging storage.
2. Disable new provider/mutation dispatch.
3. Run the module-owned effect drain.
4. Verify the committed effect is recovered idempotently and no new canonical mutation is dispatched.
5. Re-run the drain and verify it is a no-op or observes the already-complete effect.

This distinction is intentional: a release kill switch blocks new dispatch; it must not strand already committed durable effects whose recovery contract is idempotent.

## `OUTCOME_UNKNOWN` reconciliation

1. Preserve the original operation identity, prepared artifact binding, receipt reference, and evidence.
2. Run reconciliation first.
3. If `COMMITTED`, reconstruct/read back the committed output and continue required effects/review without re-executing the mutation.
4. If `NO_COMMIT`, re-execution is allowed only through the existing fresh approval checks.
5. If still `UNKNOWN`, remain in `RECOVERING`; do not guess.

## Restore sequence

Before restore, hold the workspace restore barrier. A snapshot that predates a committed canonical receipt is unsafe and must be rejected by the backup barrier.

After data restore and while the barrier is still held:

1. invalidate durable capacity slots and increment their generations;
2. invalidate message/item claims and leases;
3. expire active/confirmed proposals and uncommitted approvals by making their associated work non-dispatchable;
4. place uncertain/executing writes into `RECOVERING` with `OUTCOME_UNKNOWN` and the original operation identity intact;
5. leave `COMMITTED` execution outcomes committed while clearing stale dispatch claims;
6. validate retained source/evidence reachability and canonical receipt/effect consistency;
7. clear the restore pause only after recovery validation passes.

## Backup and retention dependencies

Backup/restore must preserve assistant rows and canonical operation history without allowing an older snapshot to overwrite newer immutable records. The safe classes are:

- immutable operation: canonical receipts, effect intents, operation evidence;
- audit history: approvals, reviews, stage attempts, action requests, governed learning lineage;
- user context: conversations, messages, feedback, memory/preferences, runs/items/proposals;
- referenced source: documents and retained source artifacts owned by the document/storage subsystem.

Referenced documents are not deleted by the assistant. A future purge workflow must prove there are no legal holds and that source reachability rules permit deletion before touching document storage.

## Purge ordering (future, policy-gated only)

The code exposes a dependency order in `BUSINESS_ASSISTANT_PURGE_ORDER`, with dependent assistant rows before canonical effects/evidence/receipts. This is not executable authorization to purge. Operators must not implement or run destructive purge until `assertAssistantDestructivePurgeAllowed` can be supplied an owner-approved, legal-hold-checked, referenced-source-checked policy version.

## Measurements to capture in staging

Record at minimum: item count, runnable runs, worker count, claim p50/p95/max latency, serializable claim transaction p50/p95/max duration, authorization lookup p50/p95/max duration, aggregate update p50/p95/max duration, retry count, stage-attempt count, duplicate-operation count, and effect-recovery count. A duplicate canonical operation count greater than zero is a release blocker.

For P12 correction lock contention, retain the same instrumentation but rerun after the correction PR integrates. Report that measurement separately rather than extrapolating from generic claims.

## Release evidence checklist

- static lint/typecheck/registry/Prisma/build checks pass on Node 24;
- durable worker and PostgreSQL authorization/recovery suites pass;
- 1-10 workload and partial-outcome tests pass;
- retry/stage/resource/provider budget tests pass;
- cancellation/expiry/revocation checks pass;
- backup/restore retention tests pass;
- effect recovery and reconciliation suites pass;
- staging-compatible restart and kill-switch simulations are recorded;
- unresolved retention/legal-hold decisions remain fail-closed and documented.
