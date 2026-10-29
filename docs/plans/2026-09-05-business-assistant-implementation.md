# Business Assistant — Review and Implementation Handover

> **Updated:** 2026-09-10  
> **Status:** PRs #19–#23 are merged on `main`. P12 correction/review, P14 governed learning, and P13/P15 operational-hardening foundations have converged. PR #25 reconciles the integrated implementation, fixes cross-PR defects, closes the repository-level retained-source filesystem/effect gap, and prepares P16 validation. The Business Assistant remains **not production-enabled**; P16 staging/release evidence is still required before any production gate may be considered.  
> **Current integration PR:** [#25 — reconcile integrated Business Assistant and prepare P16](https://github.com/Scofieldkoh/oakcloud/pull/25) — **draft**  
> **Current branch:** `chatgpt/business-assistant-main-reconcile-p16-20260910`  
> **Baseline:** current `main` after merged PRs #19, #20, #21, #22, and #23  
> **P16 reconciliation addendum:** [2026-09-10-business-assistant-main-reconciliation-p16-readiness.md](./2026-09-10-business-assistant-main-reconciliation-p16-readiness.md)  
> **Design:** [Business Assistant specification v1.4-review](../features/business-assistant/SPECIFICATION.md)  
> **Correction workflow:** [Business Assistant BizFile Correction Workflow](../features/business-assistant/CORRECTION_WORKFLOW.md)

This is the authoritative implementation handover for the integrated Business Assistant. Business Assistant is the **general Oakcloud assistant product**. BizFile remains a registered reference capability behind its capability/application boundary; documents, companies, imports, extraction, source review, and BizFile-specific canonical mutation rules must not become generic-core requirements.

The earlier long-form review narrative remains available in Git history at the pre-consolidation plan blob `5ceeff0cd020daf736688224e3fac0e629905502`. Historical PR-specific sections below are retained only where they document implementation constraints or recovery behavior that still matter. Status/open-work statements in older commits are superseded by this version and the P16 reconciliation addendum.

No work in PR #25 authorizes production deployment, provider activation, mutation activation, learning-promotion activation, production migrations, production storage mutation, or secret changes.

## Start here next session

Read, in this order:

1. `AGENTS.md`
2. `docs/features/business-assistant/SPECIFICATION.md`
3. this handover
4. `docs/plans/2026-09-10-business-assistant-main-reconciliation-p16-readiness.md`
5. `docs/features/business-assistant/CORRECTION_WORKFLOW.md`
6. applicable RBAC, service, design, staging, API, database, storage, backup/restore, and environment references before changing those surfaces

Do not weaken exact approval, operation identity, immutable evidence, fresh authorization, recovery fencing, module-neutrality, reviewer independence, budget bounds, or production gates merely because CI passes.

## Integrated PR reconciliation

| PR | Scope | Integrated status |
|---|---|---|
| #19 | P12 independent source review, full-state evidence semantics, reviewer-quality evaluation | **Merged.** Deterministic full-state review contract, evidence integrity/provenance rules, final combiner, and held-out reviewer-quality foundations are present. PR #25 found that the registered BizFile runtime could still return the legacy selected-change reviewer directly; the registry now fails closed unless the full-state final contract is established. |
| #20 | P12 correction runtime, recovery, bounded transactions | **Merged.** Correction prefetch remains outside the serializable write transaction; fresh transactional revalidation, bounded wait/runtime/retry policy, committed/no-commit reconciliation, and operation-identity recovery are present. |
| #21 | P14 governed preference and learning lifecycle | **Merged.** Governed targets, behavioral-evaluation/promotion lifecycle foundations, lineage/versioning, authorization, and runtime-consumption controls are present. Production learning promotion remains intentionally disabled/gated. |
| #22 | P12 correction concurrency/race hardening | **Merged.** Adds transaction/race coverage complementary to #20. Some historical race fixtures are intentionally synthetic evidence for locking/fencing rather than substitutes for real storage execution. |
| #23 | P13/P15 batch fairness, partial outcomes, budgets, operational hardening, retention, backup/recovery, runbooks | **Merged.** Bounded workloads and operational/recovery foundations are integrated. Production rollout remains gated. |
| #25 | Integrated-main reconciliation and P16 preparation | **Draft.** Fixes runtime full-state review bypass, same-pointer correction source-revision finalization, required-effect dependency ordering, authoritative PostgreSQL-suite coverage, and adds retained-source PostgreSQL + filesystem execution coverage. No production gate is enabled. |

## Current integrated checkpoint

### P12 correction lifecycle — integrated

`POST /api/business-assistant/runs/:id/corrections` remains the generic correction-preparation endpoint. A correction creates a **new linked run/item/proposal** and never edits the historical operation, receipt, approval, review, or evidence. Normal confirmation is required before the correction item receives its new operation ID.

The durable flow remains:

1. identify the latest correctable committed review;
2. perform capability-owned retained-source prefetch outside the serializable write transaction;
3. verify source bytes/hash and perform fresh source/target authorization;
4. enter the bounded correction transaction;
5. reacquire restore/backup barrier and fresh actor/workspace authority;
6. re-read source identity, storage pointer, document version/source revision, receipt/evidence bindings, and company aggregate revision;
7. rebuild the correction plan against current canonical state;
8. persist a new unapproved proposal/item with explicit correction lineage;
9. require fresh confirmation/approval;
10. allocate a new operation identity only after confirmation;
11. execute the canonical BizFile mutation;
12. continue durable required effects;
13. perform canonical read-back;
14. hand off to independent review;
15. reconcile the original operation identity on uncertain outcomes rather than replaying a replacement write.

Collection-row corrections for officers, shareholders, charges, and other arrays remain intentionally unsupported until stable record identity semantics are designed. Do not introduce array-index correction semantics.

### Retained-source prefetch boundary — preserved from PR #17/#20

The module-neutral prefetch adapter is `src/services/business-assistant/correction-prefetch.ts`. `src/services/bizfile/application/prepare-correction.ts` keeps BizFile-specific source/evidence behavior behind the BizFile application boundary.

Retained-source external/storage I/O stays outside the serializable correction write transaction. Prefetched evidence is **evidence only**. Transaction-time state and authorization are authoritative. Source pointer/revision/version/hash, capability contract, authorization, restore state, receipt binding, or aggregate-revision drift fails closed.

### Bounded correction transaction policy — merged from PR #20

The correction-specific serializable policy remains:

- maximum transaction acquisition wait: **2,000 ms**;
- maximum interactive transaction runtime: **5,000 ms**;
- serializable conflict retry budget: **3 attempts**;
- only serialization conflicts are retried by the repository policy;
- timeout/non-serialization failures are not blindly retried as new operations.

This policy is correction-specific and must not be silently broadened to unrelated Business Assistant/BizFile transactions without separate review.

### Correction recovery and historical immutability — integrated

The following are now required invariants, not workstream aspirations:

- a linked correction remains unapproved until normal confirmation;
- the correction receives a new operation ID only after confirmation;
- the source item's original operation ID, receipt, approval, review, evidence, and lifecycle remain preserved;
- repeated reconciliation of a committed BizFile operation returns the original operation identity/receipt;
- an uncertain result does not authorize allocation of a replacement operation;
- required-effect continuation does not repeat the company mutation;
- rollback/`NO_COMMIT` recovery must not leave a phantom committed mutation;
- committed recovery must continue the same durable receipt/effect/read-back/review path.

## Independent source review — integrated foundations, P16 runtime evidence still required

PR #19 merged the independent full-state review contract and reviewer-quality foundations. The review model can distinguish and/or fail closed on:

- import-time defects;
- canonical mutation defects;
- unauthorized/unexplained unselected writes;
- later audited human edits;
- source drift;
- absent, unreadable, unsupported, or otherwise insufficient evidence.

Full-state evidence carries immutable source identity/reference, SHA-256, source revision, section coverage, page references, evidence bindings, and before/after digests. Reviewer-owned canonical path coverage prevents planner/mutation input from shrinking the review denominator.

### PR #25 integration fix: selected-change reviewer can no longer establish factual PASS alone

The merged BizFile capability still exposed the older `SELECTED_CHANGES_ONLY` runtime reviewer directly even though PR #19's final combiner requires independent full-state evidence. PR #25 adds a registration-time integration gate in the generated Business Assistant capability registry.

For `bizfile.import_and_review`, a review cannot remain factual `PASS` unless coverage establishes all final-combiner invariants:

- selected-change evidence established;
- full-state evidence established;
- non-zero complete full-state coverage;
- source binding valid;
- immutable before digest valid;
- immutable after digest valid;
- no full-state failure codes.

Until the runtime full-state evidence producer supplies that complete contract, the registered capability fails closed to `NEEDS_REVIEW` / `UNVERIFIABLE` / `INCOMPLETE`. Existing hard failures remain hard failures. The integration gate never upgrades a result.

P16 must exercise the actual full-state evidence producer/final combiner with held-out documents. Do not remove this fail-closed gate merely to obtain PASS results.

## PR #25 retained-source and required-effect integration fixes

### Same-pointer correction finalization

Corrections reuse immutable retained source bytes. If the source already points at its deterministic hash-addressed destination, `STORAGE_FINALIZE` assigns the same storage key. The previous document source-revision guard only incremented when a source field changed, while `PAGE_PREPARATION` expects `sourceRevision + 1` after finalization.

PR #25 adds a narrowly scoped database guard so a same-value storage assignment advances the source revision only while the exact receipt-bound `STORAGE_FINALIZE` effect is actively `PROCESSING` under a live claim/lease and matching tenant/receipt/document/target/payload/source revision. Ordinary same-value updates remain no-ops. Real storage-key changes continue to advance exactly once.

### Required-effect dependency order

`STORAGE_FINALIZE` and `PAGE_PREPARATION` are created in the same canonical operation, and PostgreSQL transaction timestamps can tie. Ordering only by retry time, creation time, then random UUID allowed page preparation to be claimed before storage finalization.

PR #25 moves the dependency guarantee to the canonical effect repository boundary:

- `PAGE_PREPARATION` requires the same-receipt/same-target `STORAGE_FINALIZE` predecessor;
- page preparation receives a strictly later durable creation timestamp;
- worker global fairness ordering is preserved;
- per-receipt `STORAGE_FINALIZE -> PAGE_PREPARATION` ordering is deterministic.

Do not replace this with insertion-order assumptions.

### Retained-source PostgreSQL + filesystem execution coverage

PR #25 adds a real filesystem-storage integration fixture using `LocalStorageAdapter` and a valid PDF. It verifies:

1. real workspace/user/company/document rows;
2. real PDF bytes written through the filesystem storage adapter;
3. retained source already at the deterministic hash-addressed key;
4. a real committed BizFile receipt and immutable SOURCE evidence;
5. required effects created through the canonical effect repository;
6. durable `STORAGE_FINALIZE -> PAGE_PREPARATION` ordering;
7. real effect claim/execution;
8. receipt effect completion;
9. same-pointer source revision advances exactly once;
10. page rows are prepared from retained bytes;
11. retained source bytes remain unchanged.

This closes the repository-level retained-source storage/effect gap that the prior synthetic race fixtures could not prove. It does **not** substitute for P16 staging validation against the configured production-class object-storage provider and real provider/network topology.

## P13/P15 — integrated operational foundations

PR #23 merged the batch/operational hardening workstream. The integrated implementation must preserve:

- bounded 1–10 item workloads;
- deterministic ordering where dependencies require it;
- fair progress across unrelated work;
- per-item isolation and partial outcomes;
- bounded provider/resource/retry budgets;
- explicit budget-exhaustion outcomes;
- cancellation, expiry, and authorization-revocation handling;
- no prompt/context leakage between documents/items;
- no duplicate canonical mutation from per-item failure/retry;
- immutable source retention rules;
- retention/legal-hold/purge controls where implemented;
- backup/restore pause and recovery coordination;
- operator runbooks and recovery boundaries.

P16 must re-exercise these behaviors on the fully integrated main-derived build under representative workloads and capture evidence/metrics. Do not infer integrated release readiness solely from isolated PR #23 tests.

## P14 — governed learning integrated, production promotion remains gated

PR #21 merged the governed preference/learning lifecycle foundations. Preserve the following rules:

- learnable candidates are restricted to explicit source-controlled allowed targets;
- arbitrary runtime/code/database targets are not learnable configuration;
- static schema validation is not behavioral evaluation;
- promotion requires authorized actor/workspace context and immutable candidate/version lineage;
- expected-version compare-and-swap rejects stale promotion;
- activation must be demonstrably consumed by the intended runtime behavior;
- rollback/deactivation/expiry/delete/cache cleanup must not resurrect deleted preference data;
- current-turn style instructions are not persistent-memory consent;
- inferred preferences remain candidates until governed activation.

Production learning promotion remains intentionally disabled/gated. P16 may validate behavior but must not enable the production promotion gate.

## Current outstanding work — P16 only, plus intentionally deferred product scope

The earlier parallel workstream ownership split is complete. Current release work should be treated as **P16 integrated validation/evidence**, not another round of disconnected P12/P13/P14/P15 implementation unless P16 finds a concrete defect.

### P16 — required integrated validation

Before any production-gate proposal:

1. Run the complete Business Assistant PostgreSQL suite on the final main-derived candidate after migrations.
2. Run registry freshness, Prisma generation, lint, typecheck, focused Business Assistant/BizFile contracts, application build, production image build, and runtime/Chromium verification.
3. Exercise the real full-state evidence producer and PR #19 final combiner with held-out documents; factual PASS must be impossible without complete full-state evidence.
4. Exercise correction preparation -> fresh confirmation/approval -> canonical mutation -> required effects -> canonical read-back -> independent review in staging using retained source bytes on the configured object-storage provider.
5. Exercise rollback/`NO_COMMIT`, committed reconciliation, worker restart/recovery, source pointer/revision/version drift, concurrent canonical baseline change, and races between prefetch and transactional revalidation.
6. Re-run 1–10 item ordering/fairness/isolation/partial-outcome scenarios on the integrated build.
7. Re-run provider/resource/retry budget exhaustion, cancellation, expiry, and authorization revocation.
8. Capture correction transaction lock-duration/timeout metrics and representative provider/resource budget metrics.
9. Exercise backup/restore pause, retention, recovery, purge/legal-hold behavior, and operator runbooks against the staging topology.
10. Validate real provider behavior, latency, errors, and authorization boundaries without production dispatch.
11. Validate production-class object-storage permissions/network behavior without production mutation traffic.
12. Record cutover scans, kill-switch behavior, rollback procedure, and release evidence before proposing any gate change.

### Intentionally deferred product scope

These are not P16 blockers unless explicitly promoted into release scope:

- collection-row correction contracts until stable record identity exists;
- any new arbitrary learning target class;
- new capabilities unrelated to the integrated Business Assistant release;
- production gate activation itself.

A successful BizFile demo, passing unit test, or local build does **not** establish full-product completion.

## Production gates — remain disabled by this work

PR #25 does not change production defaults/deployment values for:

- `BUSINESS_ASSISTANT_ENABLED`;
- `BUSINESS_ASSISTANT_PROVIDER_ENABLED`;
- `BUSINESS_ASSISTANT_MUTATIONS_ENABLED`;
- learning/promotion activation controls;
- deployment environments;
- production credentials/secrets.

Tests may set flags only inside isolated test processes where needed to exercise protected code paths. Any future production enablement must be a separate explicit, reviewed change after P16 evidence is complete.

## Architecture invariants to preserve

### Generic core

`src/services/business-assistant` remains module-neutral. BizFile parsing, source rules, BizFile table access, canonical mutation behavior, and source-specific review belong behind BizFile capability/application handlers.

Cross-capability integration gates may enforce generic safety invariants at registration/dispatch boundaries, but they must not move BizFile domain logic into the generic core.

### Exact approval

Canonical writes must bind the exact proposal revision, selected item set, prepared item hash, source/target identity, actor/workspace, capability/policy version, and applicable canonical revisions. A changed proposal requires fresh review and confirmation; never rewrite an old approval in place.

### Canonical mutation and recovery

- Canonical business tables change only through module-owned canonical commands.
- A committed operation keeps its original operation identity.
- Lost responses or worker restarts reconcile that identity instead of creating a replacement write.
- Required effects resume from durable intent; they do not rerun the company mutation.
- `OUTCOME_UNKNOWN` remains nonterminal until reconciliation establishes commit/no-commit.
- Retry/recovery must not allocate a replacement operation merely to bypass uncertainty.
- One item failure must not contaminate unrelated item state or duplicate another item's canonical mutation.

### Fresh authorization

Fresh authorization is required at protected request, provider, preparation, confirmation, resource-read, correction-prefetch, transactional-revalidation, review-provider, and promotion boundaries as designed. Cached UI visibility never substitutes for transaction-time authority.

Correction prefetch authorization is necessary but not authoritative; transaction-time authorization remains authoritative.

### Source, review, and correction evidence

- Preserve immutable source identity/hash/revision evidence.
- Keep original committed receipt evidence separate from current-state drift.
- Never rewrite an old receipt/review to make a later correction look like the original operation was correct.
- Correction always creates linked new proposal lineage.
- Prefetched evidence remains evidence-only.
- Retained-source external/storage I/O remains outside the serializable correction write transaction.
- Full-state reviewer coverage must be reviewer-owned and cannot be shrunk by planner/mutation input.
- Missing/unreadable/unsupported evidence must abstain/fail closed rather than fabricate PASS.
- Collection corrections require stable record identity semantics.

### Required effects

- Durable required effects are part of the committed operation receipt.
- Dependency ordering must be explicit/durable, not accidental insertion or UUID ordering.
- Storage finalization and page preparation are idempotent/recoverable under claim fencing.
- Effect retries never authorize a second canonical company mutation.
- Same-pointer storage finalization must preserve immutable bytes and advance only the logically required source revision.

### Batch isolation and budgets

- Workload size remains bounded.
- Provider/resource/retry budgets are explicit and bounded.
- Budget exhaustion has explicit outcomes.
- Per-item retries/cancellation/expiry/revocation cannot starve unrelated work indefinitely.
- Prompt/context state must not leak across items/documents/workspaces.

### Learning

- Current-turn style instructions are not persistent-memory consent.
- Inferred preferences remain candidates until governed activation.
- Static schema validation is not behavioral evaluation.
- Activation/promotion requires allowed targets, authorization, immutable lineage, and version fencing.
- Deleted preference data must not reappear through rollback, cache, active-target state, or derived candidates.

### Backup/restore and retention

- Backup/restore barriers coordinate with canonical writes and required effects.
- Dispatch stays paused while restore state requires it.
- Recovery reconciles durable operations/effects rather than replaying every restored pending action.
- Retention/legal-hold/purge behavior must preserve required immutable operational evidence according to its governing policy.

## Test/failure matrix to preserve

| Case | Expected invariant |
|---|---|
| Duplicate correction request | Existing action may suppress external prefetch; transaction returns replay/conflict without duplicate proposal/mutation |
| Source pointer/version/revision changes after prefetch | Transaction rejects stale evidence |
| Company baseline/aggregate revision changes | Transaction rejects stale correction baseline |
| Permission revoked after prefetch | Transaction rejects before proposal writes |
| Restore/pause starts after prefetch | Transaction rejects before proposal writes |
| Serializable conflict | Retry only within bounded correction retry budget |
| Transaction/lock timeout | Fail closed; do not blindly retry as a new operation |
| Worker dies before canonical commit | Retry only with same validated operation/approval context |
| DB commits but response/status write is lost | Reconcile original receipt/operation and continue effects/read/review without repeating mutation |
| Earlier writer rolls back | Reconciliation may prove `NO_COMMIT`; no phantom receipt |
| Committed reconciliation repeated | Same receipt and operation identity; no duplicate canonical mutation |
| Same-pointer retained-source finalization | Source revision advances exactly once only under matching live finalization effect |
| Page effect becomes runnable | Durable storage-finalize predecessor exists and orders before page preparation |
| Storage finalize/page failure | Idempotent required-effect recovery; no reimport/canonical remutation |
| Completed-source correction | New proposal/approval/operation; old operation/receipt/review/evidence preserved |
| Missing/unreadable/unsupported source coverage | `NEEDS_REVIEW`/review failure; never fabricate PASS |
| Selected-change reviewer reports PASS without full-state contract | Registry integration gate downgrades/fails closed |
| Unauthorized unselected write | Full-state reviewer detects/fails against immutable evidence |
| Later audited human edit | Reviewer distinguishes it from reviewed-operation mutation where provenance is sufficient |
| Ten items/two workspaces | Isolated contexts/outcomes, bounded fair progress, no prompt/context leakage |
| Provider/resource/retry budget exhausted | Explicit bounded exhaustion outcome; unrelated work can progress |
| Cancellation/expiry/revocation | Item stops/fails closed at authorized boundary without contaminating others |
| Restore in progress | New dispatch/effect work respects pause/barrier; recovery remains durable |

## CI and validation commands

Use Node 24 and an explicitly isolated disposable PostgreSQL/storage environment. Never point destructive or concurrency tests at the application database.

```bash
node --version
npm run check:assistant-capabilities
npm run db:generate
npm run lint
npm run typecheck
npm run test:run -- __tests__/services/business-assistant __tests__/api/business-assistant __tests__/services/bizfile __tests__/api/bizfile __tests__/lib/fresh-authorization.test.ts __tests__/middleware.test.ts --reporter=dot
npm run test:business-assistant:postgres
npx vitest run __tests__/integration/business-assistant-correction-concurrency.postgres.test.ts --maxWorkers=1
npx vitest run __tests__/integration/bizfile --maxWorkers=1
NODE_OPTIONS=--max-old-space-size=8192 npm run build
```

`npm run test:business-assistant:postgres` is now the authoritative Business Assistant PostgreSQL integration entry point and includes durable execution, authorization, learning, correction concurrency, retained-source filesystem effects, source/aggregate revision guards, operation reconciliation, required BizFile effects, and BizFile correction race coverage.

For production-image verification use `.github/workflows/node24-compatibility.yml` and verify the final image's Node major, configured Chromium path, executable Chromium binary, and Chromium smoke test.

The **final PR #25 head** must be green before merge. Do not rely on an earlier green head after subsequent commits.

## Historical PR #20 transaction/recovery record

PR #20's ten-cycle review record is retained as implementation history for the bounded correction transaction/recovery layer. It is no longer the current integration status.

| Cycle | Commit | Review finding / committed fix |
|---|---|---|
| 1 | `b83966ea31b5aa2a234397240692d5f0b647211c` | Added correction-specific bounded serializable wrapper plus unit coverage for explicit `maxWait`/`timeout`, serialization retry, and non-retry of timeout-class failures. |
| 2 | `a0cc732413029ccb5c04ad9d0f7f5cbe38bcc4c3` | Wired `createCorrectionProposal` to the bounded wrapper without changing unrelated transactions. |
| 3 | `6bf6230443c6d8ba63c8845f50ecf819597f0e5f` | Added fail-closed document-version and legitimate-pointer race tests. |
| 4 | `dcf7c87410cf6ee2f9324c78d70543af2b313a87` | Moved the correction service unit harness to the correction-specific transaction wrapper. |
| 5 | `b8a3f8ce80b4f4f4a37d9583d09e70415d2cf76d` | Added real PostgreSQL advisory-lock timing and timeout/aborted-transaction coverage. |
| 6 | `34c3af9e0003151c806c4a6e6ad15230eae917a2` | Proved serialization conflicts stop after the configured retry budget. |
| 7 | `f3fcea9ffc64723ec31813c76f82033f22bab2ec` | Added repeated committed reconciliation proving one receipt/original operation identity. |
| 8 | `b55e56fcffe6783f5851e71b6013a4eda6dd91db` | Replaced scheduler-sensitive waits with observed PostgreSQL advisory wait state and runtime-bound assertions. |
| 9 | `ac8e6de91097a3c4d514af2637830efa8efce338` | Added explicit Node 24 workflow execution for correction concurrency/timeout integration coverage. |
| 10 | PR #20 final head | Fixed test typing/narrowing discovered by the Node 24 gate and completed the PR #20 handover. |

No application/capability-contract version bump was required by PR #20 because the external correction request/response contract did not change; its behavior was internal transaction/recovery hardening plus tests/CI.

## Operator recovery rules to preserve

| Situation | Permitted action | Prohibited shortcut |
|---|---|---|
| `OUTCOME_UNKNOWN` | Reconcile original operation/receipt under canonical serialization | Allocate a new operation ID to bypass uncertainty |
| Storage/page finalization failed | Resume idempotent required effects from durable intent | Re-run the company mutation |
| Review failed/incomplete | Create/continue a new review attempt with retained evidence/findings | Manually mark PASS or omit coverage |
| Full-state evidence incomplete | Fail closed and obtain valid independent evidence | Treat selected-change PASS as factual PASS |
| Proposal stale/expired | Prepare linked fresh proposal and require confirmation | Extend/rewrite old approval |
| User revoked after commit | Finish only required committed recovery under audited authority | Administrator impersonation for a new assistant action |
| Worker deploy/restart | Drain/reconcile compatible claims and retain recovery handlers | Clear leases and blindly replay writes |
| Assistant disabled | Use ordinary module UI and preserve receipts/effects | Re-enable deprecated direct-save/helpbot fallback |
| Workspace restore | Keep dispatch off while reconciling receipts/effects/artifacts | Replay every restored pending approval |
| Budget exhausted | Persist explicit bounded outcome and allow unrelated work to proceed | Silently extend provider/resource/retry budget |

## Next-session objective

The next session should start **P16 integrated validation**, not resume one of the now-merged parallel workstreams by default.

Primary objective:

> Validate the final main-derived Business Assistant end to end in staging across real full-state reviewer evidence, retained-source correction execution, provider/object-storage topology, batch/budget/partial-outcome behavior, authorization revocation, backup/restore/recovery, and release/rollback controls. Capture evidence and fix only concrete defects found. Do **not** enable any production gate as part of P16 validation.

Keep collection-row correction semantics deferred until stable record identity is designed. Keep any production enablement in a separate explicit reviewed change after P16 evidence and operator sign-off are complete.
