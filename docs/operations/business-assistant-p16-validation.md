# Business Assistant P16 integrated validation runbook

## Purpose

P16 is the final integrated validation and rollout-evidence phase for the Business Assistant. It is **not** permission to enable production dispatch, providers, canonical mutations, learning promotion, deployment secrets, or production migrations.

This runbook turns the P16 requirements in `docs/plans/2026-09-05-business-assistant-implementation.md` and the main-reconciliation addendum into repeatable staging evidence. A green repository build is necessary but is not sufficient release evidence.

## Safety boundary

Run P16 from the exact main-derived candidate SHA that will be reviewed. Use staging identities, staging tenant data, staging provider credentials, and the configured staging object-storage provider. Do not copy production secrets into evidence files.

The following must remain disabled in production throughout P16:

- `BUSINESS_ASSISTANT_ENABLED`;
- `BUSINESS_ASSISTANT_PROVIDER_ENABLED`;
- `BUSINESS_ASSISTANT_MUTATIONS_ENABLED`;
- learning/promotion activation controls;
- any deployment-specific production gate not explicitly approved in a separate change.

P16 evidence can make a candidate eligible for a **separate production-gate review** only. It cannot enable a gate itself.

## Evidence manifest

Create one evidence manifest for one exact staged application SHA:

```bash
npm run business-assistant:p16:evidence -- init \
  --app-sha "$APP_SHA" \
  --operator "$OPERATOR" \
  --run-id "$RUN_ID" \
  --out "artifacts/p16/$RUN_ID/manifest.json"
```

Evidence references are arrays of objects with:

- `source`: `CI`, `STAGING`, or `OPERATOR` as permitted by the gate;
- `uri`: durable artifact/log/run reference; never an expiring signed URL;
- `sha256`: SHA-256 of the referenced immutable evidence payload;
- `observedAt`: timestamp of the observation;
- optional `description`: concise explanation of what was captured.

Do not place credentials, bearer tokens, session cookies, signed object-storage URLs, customer PII, document contents, prompts containing customer data, or database dumps directly in the manifest. Store protected evidence in the approved evidence location and reference its immutable digest.

A `PASS` or `FAIL` always requires immutable evidence. `BLOCKED` requires a reason. `NOT_RUN`, `BLOCKED`, or `FAIL` prevents readiness.

## Baseline repository validation

On the exact candidate SHA, capture immutable logs for:

```bash
npm ci
npm run check:assistant-capabilities
npm run db:generate
npm run lint
npm run typecheck
npm run test:p16:evidence
npm run test:run -- __tests__/services/business-assistant __tests__/api/business-assistant __tests__/services/bizfile __tests__/api/bizfile __tests__/lib/fresh-authorization.test.ts __tests__/middleware.test.ts --reporter=dot
npm run build
npm run test:business-assistant:postgres
```

The disposable PostgreSQL database must have migrations applied before the PostgreSQL suite. The production-image/Chromium workflow must also be green for the same candidate SHA.

Record this as `baseline.repository-validation` using `CI` evidence.

## Mandatory staging gates and scenario coverage

A top-level gate is PASS only when **all** scenarios listed under it were exercised on the same candidate SHA or are represented by immutable evidence demonstrably equivalent to that candidate.

### `auth.tenant-rls`

Exercise real authentication and cross-tenant isolation through the application boundary. Verify protected reads, resource access, preparation, confirmation, execution, review-provider invocation, and correction prefetch/revalidation cannot cross tenants. Confirm authorization revocation is observed at the fresh-authorization boundary, not from stale cached permission state.

### `review.full-state-evidence`

Use held-out source documents. Verify the real full-state evidence producer and final combiner. Demonstrate that selected-change evidence alone cannot produce factual PASS. Capture source identity, source SHA-256, source revision, before/after digests, section/path coverage, page references, evidence bindings, and explicit insufficient/unreadable/unsupported outcomes.

### `correction.retained-source-e2e`

Using the configured staging object-storage provider, exercise:

1. correction preparation;
2. fresh confirmation/approval;
3. new operation identity allocation only after confirmation;
4. canonical mutation;
5. required effects;
6. canonical read-back;
7. independent review;
8. source-operation history/receipt/approval/review/evidence preservation;
9. rollback / `NO_COMMIT` with no phantom mutation;
10. committed reconciliation using the original operation identity;
11. worker restart/recovery without duplicate canonical mutation;
12. source pointer, revision, version, and hash drift rejection;
13. concurrent canonical baseline change rejection;
14. race between retained-source prefetch and transactional revalidation.

Capture lock acquisition wait, serializable transaction duration, timeout result, retry count, effect continuation, and operation/receipt identity.

### `transport.listen-notify`

Exercise the normal staging PostgreSQL `LISTEN/NOTIFY` wake-up path with measurable enqueue-to-claim/wake timing. Prove notifications are an optimization, not the durable source of truth.

### `transport.degraded-polling`

Disable or interrupt notification delivery in staging. Verify the durable polling fallback continues bounded processing, then verify clean recovery to the normal wake-up path without duplicate work.

### `provider.throttling`

Use the real staging provider boundary. Exercise provider throttling/transient errors and prove retry count/backoff/budget are bounded. Capture the explicit budget-exhaustion terminal/disposition outcome and prove unrelated items continue to make fair progress.

### `approval.expiry-race`

Race confirmation/execution against approval expiry. Verify expiry is rechecked at the protected boundary and no canonical mutation is accepted after expiry.

### `authorization.action-kind-least-privilege`

Exercise least privilege for each protected action kind represented by P16: provider use, resource read, preparation, confirmation, canonical mutation, review, correction prefetch/revalidation, and learning evaluation/promotion where applicable. Revoke authority mid-flow and verify fail-closed behavior.

### `draft.stale-rejected`

Create an approved/prepared draft, change its bound proposal/canonical/source/version state, and verify execution rejects the stale draft rather than silently rebuilding or reusing approval.

### `draft.policy-invalidated-rejected`

Change an approval-policy input/version after preparation. Verify the old approval is not rewritten or reused and fresh review/confirmation is required.

### `workload.one-to-ten`

Exercise representative workloads from 1 through 10 items. Capture ordering, fairness, isolation, partial outcomes, per-item failure, retries, cancellation, expiry, authorization revocation, provider/resource/retry budgets, and explicit exhaustion. Verify one item cannot contaminate another, leak prompt/context, starve unrelated work, or cause duplicate canonical mutation.

### `timezone.singapore-month-boundary`

Exercise calendar/month-boundary behavior using `Asia/Singapore`, including the boundary immediately before and after local midnight and any monthly/rolling-budget logic used by the assistant.

### `timezone.new-york-dst`

Exercise `America/New_York` DST gap and fold cases. Prove scheduling/window calculations use an explicit timezone and do not double-run or skip durable work because of ambiguous/nonexistent local times.

### `capacity.rolling-24h-cap`

Exercise the rolling 24-hour action/resource cap at just-below, exactly-at, and above-limit boundaries. Capture the explicit exhaustion outcome and recovery when usage ages out of the rolling window.

### `summary.weekly-delivery`

Exercise the weekly summary against a staging recipient/sink. Verify exactly one email and one in-app delivery are produced for the durable summary operation, including retry/restart behavior. Do not use a real customer recipient.

### `operations.retention-backup-restore`

Follow the P13/P15 runbooks on staging. Exercise retention, backup/restore pause/barrier coordination, restore recovery, retry continuation, immutable-source retention, and recovery after worker restart. Capture restore timings and any deployment-specific backup destination behavior.

### `rollout.kill-switch-rollback`

Exercise the staged-cohort kill switch and rollback procedure without enabling production. Verify defaults return to disabled, queued/in-flight behavior follows the documented recovery contract, no replacement canonical operation is created for uncertain committed work, and operator rollback steps are reproducible.

## Recording results

Prepare an evidence-reference array in a protected temporary JSON file, then record it:

```bash
npm run business-assistant:p16:evidence -- record \
  --manifest "artifacts/p16/$RUN_ID/manifest.json" \
  --check provider.throttling \
  --status PASS \
  --evidence "artifacts/p16/$RUN_ID/provider-throttling.refs.json"
```

For a blocker:

```bash
npm run business-assistant:p16:evidence -- record \
  --manifest "artifacts/p16/$RUN_ID/manifest.json" \
  --check provider.throttling \
  --status BLOCKED \
  --note "Staging provider throttling control is unavailable"
```

Never convert a blocker into PASS merely because repository tests cover a similar path.

## Safety assertions

After the staging drill, explicitly verify and record all four safety conditions:

```bash
npm run business-assistant:p16:evidence -- safety \
  --manifest "artifacts/p16/$RUN_ID/manifest.json" \
  --production-gates-unchanged true \
  --production-defaults-disabled true \
  --kill-switch-restored true \
  --rollback-rehearsed true
```

These are assertions to be backed by deployment/operator evidence. They do not mutate deployment configuration.

## Seal and review

Inspect status first:

```bash
npm run business-assistant:p16:evidence -- status \
  --manifest "artifacts/p16/$RUN_ID/manifest.json" \
  --expected-app-sha "$APP_SHA"
```

Seal only after every gate is PASS and the safety assertions are true:

```bash
npm run business-assistant:p16:evidence -- seal \
  --manifest "artifacts/p16/$RUN_ID/manifest.json"
```

`seal` deliberately exits non-zero unless the sealed manifest is eligible for separate production-gate review. Once sealed, the manifest cannot be changed with the P16 CLI. If any evidence must change, create a new run and new manifest.

## Stop conditions

Stop P16 and leave the candidate not-ready when any of the following occurs:

- any required gate is `FAIL`, `BLOCKED`, or `NOT_RUN`;
- evidence belongs to a different application SHA without a documented, immutable equivalence justification;
- a canonical mutation is duplicated or its outcome cannot be reconciled;
- source/evidence identity or checksum cannot be established;
- cross-tenant access is observed;
- a production gate or production credential was changed as part of validation;
- rollback cannot restore the safe disabled state;
- provider/resource/retry budgets are unbounded;
- backup/restore or retention behavior cannot be reproduced;
- operator evidence contains secrets or customer data that cannot be safely retained.

A stopped/incomplete run must remain unsealed because sealing is reserved for a fully passing readiness record. Preserve the incomplete manifest and referenced evidence in the approved archival location with its own immutable storage/versioning controls, then start a fresh P16 evidence run after the defect or environmental blocker is resolved. Never mark missing work PASS merely to obtain a seal.
