# E-Signing Implementation Review Remediation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining correctness, durability, authorization, and interaction gaps found after the 2026-08-11 E-Signing investigation remediation was implemented.

**Architecture:** Preserve the existing E-Signing service/API/component boundaries, but make background completion work an explicit lease-owned state machine. Treat the delivery ledger as the source of truth while reconciling legacy metadata during migration, keep UI capabilities aligned with route and service authorization, and make signing refresh/keyboard behavior recoverable and locally scoped.

**Tech Stack:** Next.js App Router, React, TypeScript, Prisma/PostgreSQL, Vitest, Vitest Browser Mode, Testing Library, and the existing storage, email, RBAC, audit, and logging abstractions.

---

## 1. Review scope and evidence

This review compares the implementation with:

- `docs/features/esigning/INVESTIGATIVE_ANALYSIS.md`
- `docs/superpowers/plans/2026-08-11-esigning-investigation-remediation.md`
- `docs/guides/DESIGN_GUIDELINE.md`
- `docs/guides/RBAC_GUIDELINE.md`

The working tree was clean at review time. The implementation was therefore reviewed as the 16 committed changes in `origin/main..HEAD` (`7359093..93d6cf6`), not as an uncommitted worktree diff. That range contains 53 changed files, 11,685 insertions, and 630 deletions.

### Verification performed during this review

| Check | Result | Interpretation |
|---|---|---|
| Focused E-Signing unit/service suite | 12 files, 80 tests passed | Existing covered behavior is green, but several worker mocks do not model persisted claim transitions. |
| E-Signing preparation browser suite | 1 file, 10 tests passed | The suite passes, but repeatedly logs thumbnail-fetch 404 errors and does not exercise `ArrowLeft`/`ArrowRight` against the real nested PDF viewer. |
| `npx.cmd prisma validate` | Passed | The current schema is valid. |
| ESLint over the changed E-Signing implementation | Passed | No lint findings in the reviewed files. |
| `npx.cmd tsc --noEmit --pretty false` | Failed only in `tmp/verify-renderer.ts` | The repository still has the pre-existing renderer verification type errors already recorded by the prior plan; no E-Signing diagnostic was emitted. |
| `git diff --check origin/main..HEAD` | Passed | No whitespace errors in the reviewed implementation range. |

Passing tests do not clear the findings below: the highest-risk defects occur at database state transitions and at boundaries hidden by permissive mocks.

---

## 2. Findings summary

| ID | Priority | Finding | User/operational impact |
|---|---:|---|---|
| ESG-F01 | P1 | The scheduler claims completion deliveries, then the per-delivery processor tries to claim them again and rejects the fresh lease. | Queued completion emails are not sent, while scheduler counters report them as sent. |
| ESG-F02 | P1 | A normal email-provider rejection (`ok: false`) is persisted as `SUCCEEDED`. | Recipients can miss completion copies permanently; the UI and ledger falsely report success. |
| ESG-F03 | P1 | Retry eligibility and artifact dependencies are not enforced consistently. | Future retries are reclaimed immediately and can exhaust permanently before signed artifacts become available. |
| ESG-F04 | P1 | List/detail serializers ignore ledger rows for delivery health, merge legacy failures incorrectly, and include non-completion mail in completion status. | Operators receive missing, stale, or unrelated warnings and incorrect completion-state summaries. |
| ESG-F05 | P1 | Terminal polling state is committed before the full signing session reload succeeds. | A transient reload failure can stop polling forever and leave the signer on stale content. |
| ESG-F06 | P2 | The nested PDF viewer still owns global left/right keyboard shortcuts. | Arrow keys outside the field canvas are intercepted; inside it, one key can both move a field and change page. |
| ESG-F07 | P2 | The UI/service expose retry to envelope mutators, but the API route requires `esigning:manage`. | A creator with update access sees an enabled retry action that returns 403. |
| ESG-F08 | P2 | Field-value persistence still does not enforce accepted consent on the server. | A direct request or stale tab can persist signing data before the recipient accepts the disclosure. |

### Priority definitions

- **P1:** correctness or durability defect that can prevent a core signing/completion workflow or present materially false state.
- **P2:** authorization, accessibility, or defense-in-depth gap with a narrower trigger or workaround.

---

## 3. Detailed findings

### ESG-F01 â€” completion delivery is claimed twice

**Evidence**

- `claimCompletionDeliveries()` in `src/services/esigning-completion.service.ts` selects eligible rows and changes them to `PROCESSING` with a fresh `claimedAt` and future `leaseExpiresAt`.
- `processQueuedEsigningCompletionWork()` passes those already-claimed IDs to `processEsigningCompletionDelivery()`.
- `processEsigningCompletionDelivery()` performs a second `updateMany()` claim. A `PROCESSING` row is accepted only when its lease is older than a second stale cutoff, so the fresh batch claim returns `count === 0` and the processor returns `not-claimed`.
- The scheduler counts every fulfilled promiseâ€”including `not-claimed`â€”as `deliveriesSent`.
- `__tests__/services/esigning-completion.service.test.ts` mocks every delivery `updateMany()` as `{ count: 1 }`, so it cannot reproduce the stored `PENDING -> PROCESSING -> rejected second claim` transition.

**Required outcome**

There must be exactly one claim boundary. A processor may mutate or finalize a row only while it owns the current claim token. Scheduler metrics must count actual outcomes, not promise fulfillment.

### ESG-F02 â€” provider rejection is treated as delivery success

**Evidence**

- `safeSendEmail()` in `src/services/esigning-notification.service.ts` converts a provider response into `EsigningEmailDeliveryResult`, including `ok: false`, without throwing.
- `processEsigningCompletionDelivery()` awaits `sendEsigningCompletionEmail()` and then unconditionally writes delivery status `SUCCEEDED`, `sentAt`, and a successful attempt.
- Only thrown exceptions enter retry handling.
- Current completion-worker tests mock only `ok: true`.

**Required outcome**

Both provider rejection and thrown transport errors must record a failed attempt, advance the retry state, and leave `sentAt` unset. Only `ok: true` may transition the delivery to `SUCCEEDED`.

### ESG-F03 â€” due time, dependency, and lease rules are inconsistent

**Evidence**

- `claimCompletionDeliveries()` selects `PENDING` and `FAILED_RETRYABLE` rows without requiring `availableAt <= now`.
- Completion delivery rows are queued in the same transaction that marks an envelope completed, before signed artifacts are guaranteed to exist.
- The delivery claim query does not join the envelope to require `status = COMPLETED` and `pdfGenerationStatus = COMPLETED`.
- A missing `signedStoragePath` consumes an attempt and schedules a later `availableAt`, but the next scheduler tick ignores that time and can exhaust all attempts immediately.
- Auto-file candidate selection and `processEsigningAutoFileJob()` do not require `autoFilingAvailableAt <= now`.
- Auto-file reclaim checks `autoFilingClaimedAt` against a fixed stale cutoff instead of the explicit `autoFilingLeaseExpiresAt`.
- Scheduler selection uses the fixed module lease duration for artifact/auto-file staleness while accepting a caller-provided `leaseMs` for delivery claims.
- Scheduler counters treat any fulfilled `already-processing`/`not-claimed` result as completed work.

**Required outcome**

Every stage must have one documented eligibility predicate, honor due times, reclaim only expired leases, wait for its prerequisites, and report outcomes truthfully. Dependency waiting must not consume a delivery attempt.

### ESG-F04 â€” delivery health and completion summary are derived from the wrong rows

**Evidence**

- `getEnvelopeAggregate()` and the list query fetch only `status`, `kind`, and `targetKey` from `emailDeliveries`.
- `serializeEnvelopeDetail()` and the list serializer call `getEsigningEmailDeliveryHealth([], envelope.metadata)`, explicitly discarding the fetched ledger.
- `getEsigningEmailDeliveryHealth()` returns ledger failures alone when any exist, otherwise it returns all legacy failures. It does not replace matching legacy entries with the current ledger state.
- A successful ledger retry therefore cannot clear a matching legacy failure when no other ledger failure exists. Conversely, one unrelated ledger failure hides every unmatched legacy failure.
- `getEsigningPostCompletionSummary()` accepts only `{ status }` rows and never filters `kind === 'COMPLETION'`.
- A successful request/reminder row can make an old completed envelope appear to have completed-copy delivery; a failed non-completion notification can make post-completion status fail.

**Required outcome**

List and detail must pass real ledger snapshots. Ledger state replaces legacy state only for the same `{kind, normalized recipient address}`; unmatched legacy failures remain visible until migrated or resolved. Post-completion aggregation must inspect `COMPLETION` rows only.

### ESG-F05 â€” terminal refresh is not recoverable

**Evidence**

- `refreshSigningStatus()` in `src/components/esigning/esigning-sign-page.tsx` updates `latestStatusRef` and `isCompletionTerminal` before awaiting `loadSession({ preserveDrafts: true })`.
- If the lightweight endpoint reports a terminal transition and the full session request fails, the polling stop condition has already been committed.
- A later refresh sees no status change because `latestStatusRef` was also advanced, so the full session may never be retried.
- Existing tests cover successful session hydration but not a failed first hydration followed by recovery.

**Required outcome**

Terminal status becomes authoritative in the component only after the corresponding full session was hydrated successfully. A failed hydration must retain a pending-refresh marker and keep polling/visibility recovery active.

### ESG-F06 â€” nested keyboard owners conflict

**Evidence**

- `EsigningFieldCanvas` correctly checks whether focus is in its container before applying field nudge/resize shortcuts.
- It renders `DocumentPageViewer`, whose window-level keydown handler still prevents default for `ArrowLeft`, `ArrowRight`, `PageUp`, and `PageDown` everywhere except text inputs.
- With a selected field, both handlers can run: the field moves and the PDF page changes.
- Outside the canvas, left/right navigation is still intercepted by the viewer.
- The unit test mocks `DocumentPageViewer`; the browser test exercises `ArrowDown`, the one arrow not captured by the viewer.
- The focusable field overlay has no stable accessible label when placement mode is inactive.

**Required outcome**

The viewer and field canvas must have explicit, non-overlapping shortcut ownership. No E-Signing shortcut may affect an event outside the relevant focused surface, and one event must trigger at most one action.

### ESG-F07 â€” retry capability and route permission disagree

**Evidence**

- Detail/list DTOs expose `canRetryCompletionProcessing` to `scope.canManage || canMutateEnvelope(scope, session, envelope.createdById)`.
- The service also allows manage scope or an authorized envelope mutator.
- `src/app/api/esigning/envelopes/[id]/retry-processing/route.ts` requires `esigning:manage` before the service runs.
- The RBAC guideline requires route and service authorization and defines `update` as modifying records, while `manage` is full control.

**Required outcome**

Use `esigning:update` at the route boundary and retain the service's tenant/object authorization, matching other envelope mutations. If product policy instead reserves retries for managers, change the DTO and service to manage-only in the same change; do not leave the layers inconsistent. The preferred behavior in this plan is update-plus-object-authorization because that matches the current UI and service contract.

### ESG-F08 â€” consent is not enforced on field saves

**Evidence**

- `saveEsigningSigningFieldValues()` rejects signed or declined recipients but does not check `recipient.consentedAt`.
- `completeEsigningSigningSession()` does enforce consent.
- Client gating reduces normal UI exposure but is not an authorization boundary and does not cover direct calls or stale tabs.

**Required outcome**

The save service must reject all field persistence until the current recipient has a stored consent timestamp. Rejection must occur before any field-value write or signature asset mutation.

---

## 4. File responsibility map

| Area | Files |
|---|---|
| Worker schema and migration | `prisma/schema.prisma`, `prisma/migrations/20260811020000_esigning_completion_claim_ownership/migration.sql`, `src/generated/prisma/**` |
| Completion scheduler/state machine | `src/services/esigning-completion.service.ts`, `src/services/esigning-pdf.service.ts` |
| Email result/health aggregation | `src/services/esigning-notification.service.ts`, `src/services/esigning-email-delivery.service.ts` |
| Envelope serialization | `src/services/esigning-envelope.lib.ts`, `src/services/esigning-envelope.service.ts` |
| Signer refresh and consent | `src/components/esigning/esigning-sign-page.tsx`, `src/services/esigning-signing.service.ts` |
| Keyboard ownership | `src/components/esigning/prepare/esigning-field-canvas.tsx`, `src/components/processing/document-page-viewer.tsx` |
| Retry authorization | `src/app/api/esigning/envelopes/[id]/retry-processing/route.ts`, `src/services/esigning-envelope.service.ts` |
| Tests | Existing E-Signing test files plus the new route and PostgreSQL integration tests named below |
| Documentation | This plan and `docs/features/esigning/INVESTIGATIVE_ANALYSIS.md` after remediation is verified |

Do not add a second scheduler, delivery table, email abstraction, or keyboard event bus. Extend the current boundaries.

---

## 5. Detailed implementation plan

### Task 1: Make post-completion work lease-owned, due-aware, and dependency-aware

**Resolves:** ESG-F01 and ESG-F03.

**Files:**

- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260811020000_esigning_completion_claim_ownership/migration.sql`
- Regenerate: `src/generated/prisma/**`
- Modify: `src/services/esigning-completion.service.ts`
- Modify: `src/services/esigning-pdf.service.ts`
- Modify: `__tests__/services/esigning-completion.service.test.ts`
- Create: `__tests__/integration/esigning-completion-worker.postgres.test.ts`
- Modify: `package.json`

#### 1.1 Write failing state-machine tests

- [x] Replace the unconditional delivery `updateMany: { count: 1 }` behavior in the relevant tests with stateful rows or explicit sequential outcomes.
- [x] Add unit tests proving:
  - a row returned by the batch claim is processed without a second claim;
  - a future `availableAt` is not eligible;
  - a due `FAILED_RETRYABLE` row is eligible;
  - a fresh `PROCESSING` lease is not reclaimed;
  - an expired lease is reclaimed with a new token;
  - completion delivery is not claimed until the envelope and PDF artifacts are completed;
  - auto-file work honors `autoFilingAvailableAt` and `autoFilingLeaseExpiresAt`;
  - `not-claimed`, `already-processing`, and `stale-worker` do not increment completed/sent counters.

Run the red tests:

```powershell
npm.cmd run test:run -- __tests__/services/esigning-completion.service.test.ts
```

Expected before implementation: the fresh-claim processing, due-time, dependency, and truthful-counter cases fail.

#### 1.2 Add claim ownership fields

- [x] Add nullable UUID-sized tokens to the existing models:

```prisma
model EsigningEnvelope {
  autoFilingClaimToken String? @db.VarChar(36)
}

model EsigningEmailDelivery {
  claimToken String? @db.VarChar(36)
}
```

- [x] Create a forward-only migration that adds `autoFilingClaimToken` to `esigning_envelopes` and `claimToken` to `esigning_email_deliveries` as nullable `VARCHAR(36)` columns.
- [x] Do not backfill tokens: existing `PROCESSING` rows are reclaimed only after their lease expires and receive a new token.
- [x] Run `npx.cmd prisma generate` and include only expected generated-client changes.

#### 1.3 Define explicit claim and result contracts

- [x] Replace ID-only claims and stringly counted fulfillment with typed contracts:

```typescript
type ClaimedCompletionDelivery = {
  id: string;
  tenantId: string;
  envelopeId: string;
  claimToken: string;
};

type ClaimedAutoFileJob = {
  envelopeId: string;
  tenantId: string;
  claimToken: string;
};

type CompletionDeliveryOutcome =
  | { status: 'sent' }
  | { status: 'retryable-failure'; error: string }
  | { status: 'permanent-failure'; error: string }
  | { status: 'stale-worker' };

type AutoFileOutcome =
  | { status: 'completed' }
  | { status: 'retryable-failure'; error: string }
  | { status: 'permanent-failure'; error: string }
  | { status: 'stale-worker' }
  | { status: 'not-required' };
```

- [x] Pass the claim token into `processEsigningCompletionDelivery()` and `processEsigningAutoFileJob()`; those functions must not attempt a second claim.
- [x] Guard every terminal/failure state write with the current status and token. If the guarded write affects zero rows, return `stale-worker` and do not overwrite the newer worker's state.

#### 1.4 Claim only eligible completion deliveries

- [x] Use one transaction and a `FOR UPDATE SKIP LOCKED` candidate query followed by a tokened update/return. The predicate must be equivalent to:

```sql
d.kind = 'COMPLETION'
AND e.status = 'COMPLETED'
AND e."pdfGenerationStatus" = 'COMPLETED'
AND (
  (
    d.status IN ('PENDING', 'FAILED_RETRYABLE')
    AND d."availableAt" <= :now
  )
  OR (
    d.status = 'PROCESSING'
    AND d."leaseExpiresAt" <= :now
  )
)
```

- [x] Join `esigning_envelopes` in the candidate query; do not discover missing artifact prerequisites after consuming a delivery attempt.
- [x] Set `PROCESSING`, `claimedAt`, `leaseExpiresAt`, and a fresh claim token in the claim transaction.
- [x] Return the claimed row identity and token directly from the update. Do not loop through unguarded per-ID updates after selection.

#### 1.5 Apply the same eligibility model to auto-file work

- [x] Claim auto-file rows atomically with:

```typescript
const eligible =
  envelope.status === 'COMPLETED' &&
  envelope.pdfGenerationStatus === 'COMPLETED' &&
  (
    (['PENDING', 'FAILED_RETRYABLE'].includes(envelope.autoFilingStatus) &&
      envelope.autoFilingAvailableAt !== null &&
      envelope.autoFilingAvailableAt <= now) ||
    (envelope.autoFilingStatus === 'PROCESSING' &&
      envelope.autoFilingLeaseExpiresAt !== null &&
      envelope.autoFilingLeaseExpiresAt <= now)
  );
```

- [x] Store a fresh `autoFilingClaimToken` on claim and clear it only through a token-guarded completion/failure update.
- [x] Before storage upload and before each database/audit mutation, verify the token is still current. Return `stale-worker` before side effects when ownership has changed.
- [x] Make the auto-file audit idempotent for the deterministic `companyDocumentId`. Derive a separate audit ID with UUID v5 from `envelope.id`, `document.id`, and an audit-specific namespace, then `upsert` the audit by that ID in the same Prisma transaction as the document upsert. A pre-read followed by create is not sufficient because two workers can race.
- [x] Continue using deterministic `companyDocumentId` and storage keys so document/storage writes remain replay-safe.

#### 1.6 Make scheduler metrics reflect outcomes

- [x] Count `sent`, `completed`, retryable failure, permanent failure, stale worker, and skipped/not-required separately.
- [x] Define `processed` as the number of jobs for which this invocation owned and attempted work. Do not count a lost claim as successful work.
- [x] Use `leaseMs` consistently for newly claimed completion and auto-file leases. Artifact generation may retain its existing lease constant in this task, but its `already-processing`/`already-completed` outcomes must not be counted as newly generated.
- [x] Keep the returned object backward compatible where API/monitoring callers depend on current keys; add counters instead of silently changing a key's meaning when necessary.

#### 1.7 Add PostgreSQL concurrency coverage

- [x] Follow the opt-in `TEST_DATABASE_URL` setup/cleanup pattern from `__tests__/integration/service-agreement-activation.postgres.test.ts`.
- [x] Add real-database tests for:
  - two overlapping schedulers claiming a single delivery exactly once;
  - a freshly claimed row being processed by its owner;
  - an obsolete token being unable to finalize after lease takeover;
  - a future retry remaining untouched;
  - an expired lease being reclaimed;
  - a completed envelope with pending PDF generation leaving delivery attempts at zero;
  - two overlapping auto-file schedulers creating one document and one success audit.
- [x] Add a script with an unambiguous name:

```json
{
  "scripts": {
    "test:esigning:postgres": "vitest run __tests__/integration/esigning-completion-worker.postgres.test.ts"
  }
}
```

Run green verification:

```powershell
npm.cmd run test:run -- __tests__/services/esigning-completion.service.test.ts
if (-not $env:TEST_DATABASE_URL) { throw 'Set TEST_DATABASE_URL to an isolated disposable PostgreSQL database before running this test.' }
npm.cmd run test:esigning:postgres
npx.cmd prisma validate
```

The PostgreSQL database must be disposable and must not point at development, staging, or production data.

---

### Task 2: Persist real email-provider outcomes

**Resolves:** ESG-F02 and the delivery outcome portion of ESG-F01.

**Files:**

- Modify: `src/services/esigning-completion.service.ts`
- Modify: `src/services/esigning-notification.service.ts` only if a clearer result type is required
- Modify: `__tests__/services/esigning-completion.service.test.ts`
- Modify: `__tests__/services/esigning-email-delivery.test.ts`

#### 2.1 Write failing provider-outcome tests

- [x] Add tests for `sendEsigningCompletionEmail()` returning:
  - `{ ok: true, providerMessageId }`;
  - `{ ok: false, error }`;
  - a rejected promise/transport exception.
- [x] Assert for `ok: false` and thrown errors:
  - the row is not `SUCCEEDED`;
  - `sentAt` remains null;
  - `attemptCount` increments once;
  - one failed attempt is recorded with the same error;
  - retryable/permanent status follows the maximum-attempt rule;
  - `availableAt` advances only for a retryable result.
- [x] Assert the success path writes one successful attempt and clears the claim.

Run the red tests:

```powershell
npm.cmd run test:run -- __tests__/services/esigning-completion.service.test.ts __tests__/services/esigning-email-delivery.test.ts
```

#### 2.2 Treat `ok` as authoritative

- [x] Branch on the returned result before writing success:

```typescript
const result = await sendEsigningCompletionEmail(message);

if (!result.ok) {
  return recordCompletionDeliveryFailure({
    delivery,
    claimToken,
    attemptedAt,
    error: result.error ?? 'Email provider did not accept the message',
  });
}

return recordCompletionDeliverySuccess({
  delivery,
  claimToken,
  attemptedAt,
  providerMessageId: result.providerMessageId ?? null,
});
```

- [x] Route thrown exceptions through the same failure persistence helper so provider rejections and transport failures cannot diverge.
- [x] In a Prisma transaction, token-guard the delivery update and create the corresponding attempt only after the guarded update succeeds.
- [x] If ownership is stale, do not create an attempt and return `stale-worker`.
- [x] Keep `toEmail`, `subject`, `attemptedAt`, provider message ID, and error consistent between the delivery row and attempt row.

#### 2.3 Document delivery semantics

- [x] Add a concise code comment at the provider/state boundary explaining that this is an at-least-once worker. A provider success followed by a database outage can still cause a retry unless the provider supports an idempotency key.
- [x] When supported by the configured provider abstraction, pass a stable idempotency key derived from `envelopeId`, delivery kind, and `targetKey`. Do not claim exactly-once delivery without provider support.

Run green verification:

```powershell
npm.cmd run test:run -- __tests__/services/esigning-completion.service.test.ts __tests__/services/esigning-email-delivery.test.ts
```

---

### Task 3: Reconcile ledger health and scope completion aggregation

**Resolves:** ESG-F04.

**Files:**

- Modify: `src/services/esigning-email-delivery.service.ts`
- Modify: `src/services/esigning-completion.service.ts`
- Modify: `src/services/esigning-envelope.lib.ts`
- Modify: `src/services/esigning-envelope.service.ts`
- Modify: `src/services/esigning-signing.service.ts`
- Modify: `__tests__/services/esigning-email-delivery.test.ts`
- Modify: `__tests__/services/esigning-envelope-list.test.ts`
- Modify or create: `__tests__/services/esigning-envelope-detail.test.ts`
- Modify: `__tests__/services/esigning-signing.service.test.ts`

#### 3.1 Write failing aggregation and serializer tests

- [x] Add helper-level cases proving:
  - a failed ledger request is visible even when legacy metadata is empty;
  - a successful matching ledger row clears only the matching legacy failure;
  - an unrelated legacy failure survives another row's ledger success;
  - an unrelated ledger failure does not hide legacy failures;
  - merged failures are sorted newest-first and limited to 10;
  - `lastFailureAt` is the newest retained failure.
- [x] Add list/detail serialization cases proving:
  - serializers pass ledger rows instead of an empty array;
  - a non-completion success does not produce `completionDeliveryStatus: 'COMPLETED'`;
  - a non-completion failure does not produce a post-completion failure;
  - a historical completed envelope with no completion rows reports `NOT_TRACKED`.

Run the red tests:

```powershell
npm.cmd run test:run -- __tests__/services/esigning-email-delivery.test.ts __tests__/services/esigning-envelope-list.test.ts __tests__/services/esigning-envelope-detail.test.ts __tests__/services/esigning-signing.service.test.ts
```

If `esigning-envelope-detail.test.ts` does not exist yet, create it and keep detail-serialization tests there rather than overloading the list suite.

#### 3.2 Fetch the complete ledger snapshot needed by the serializer

- [x] In both aggregate queries select:

```typescript
emailDeliveries: {
  select: {
    kind: true,
    targetKey: true,
    toEmail: true,
    subject: true,
    status: true,
    lastError: true,
    lastAttemptedAt: true,
  },
},
```

- [x] Pass `envelope.emailDeliveries` to `getEsigningEmailDeliveryHealth()` in both list and detail serializers.
- [x] Keep metadata during the compatibility window solely for unmatched legacy failures.

#### 3.3 Implement deterministic legacy reconciliation

- [x] Use this matching identity for migration reconciliation:

```typescript
function deliveryIdentity(input: { kind: string; to: string }): string {
  return `${input.kind.toLowerCase()}:${normalizeEsigningEmailAddress(input.to)}`;
}
```

- [x] Build a set of identities for every ledger row, including successful rows.
- [x] Remove only legacy failures whose identity has a ledger row; the ledger is authoritative for that target regardless of its current status.
- [x] Convert failed/retrying ledger rows to failures, retain unmatched legacy failures, combine, sort by parsed `attemptedAt` descending, and take the newest 10.
- [x] Derive `status` and `lastFailureAt` from the final combined array.
- [x] Preserve `targetKey` for display/actions, but do not use it as the legacy match key because older metadata may have synthesized target keys.

#### 3.4 Scope post-completion status by kind

- [x] Tighten the input type and filter first:

```typescript
export function getEsigningPostCompletionSummary(
  envelope: PostCompletionEnvelopeSnapshot,
  deliveries: Array<{ kind: string; status: string }>
): EsigningPostCompletionDto {
  const completionDeliveries = deliveries.filter(
    (delivery) => delivery.kind === 'COMPLETION'
  );

  return summarizeCompletionDeliveries(envelope, completionDeliveries);
}
```

- [x] Keep current DTO mappings for pending, retrying, failed, completed, and not-tracked after the kind filter.
- [x] Ensure `canRetryCompletionProcessing` also considers failed `COMPLETION` rows only; request/reminder failures must use their own retry affordance.
- [x] Update signing-session queries and helper tests to include `kind`; even queries already constrained by `where: { kind: 'COMPLETION' }` must return the field required by the stricter summary input type.

Run green verification:

```powershell
npm.cmd run test:run -- __tests__/services/esigning-email-delivery.test.ts __tests__/services/esigning-envelope-list.test.ts __tests__/services/esigning-envelope-detail.test.ts __tests__/services/esigning-signing.service.test.ts
```

---

### Task 4: Make terminal signing refresh recoverable

**Resolves:** ESG-F05.

**Files:**

- Modify: `src/components/esigning/esigning-sign-page.tsx`
- Modify: `__tests__/components/esigning-sign-page.test.tsx`

#### 4.1 Write the failed-hydration recovery test

- [x] Add a fake-timer test with this exact sequence:
  1. the initial session is non-terminal;
  2. the lightweight status endpoint changes to terminal;
  3. the first full session reload returns 500/rejects;
  4. the next poll runs rather than stopping;
  5. the second full session reload succeeds;
  6. drafts remain preserved;
  7. only then does terminal polling stop and the completion screen render.
- [x] Assert a transient, non-destructive error is available between attempts without clearing entered field drafts.

Run the red test:

```powershell
npm.cmd run test:run -- __tests__/components/esigning-sign-page.test.tsx
```

#### 4.2 Commit status only after hydration

- [x] Use a sticky pending-refresh flag or commit-on-success ordering. The control flow must be equivalent to:

```typescript
const changed = hasSigningStatusChanged(latestStatusRef.current, result);
const mustHydrate = changed || needsSessionRefreshRef.current;

if (mustHydrate) {
  needsSessionRefreshRef.current = true;
  await loadSession({ preserveDrafts: true });
  latestStatusRef.current = result;
  needsSessionRefreshRef.current = false;
  setIsCompletionTerminal(result.terminal);
  return;
}

latestStatusRef.current = result;
setIsCompletionTerminal(result.terminal);
```

- [x] On full-session failure, keep the previous status ref, leave `needsSessionRefreshRef` true, and do not set the terminal stop condition.
- [x] Let interval and visibility-change refreshes retry the hydration.
- [x] Avoid parallel full-session reloads with the component's existing in-flight guard.
- [x] Keep signature/date/text draft preservation unchanged.

Run green verification:

```powershell
npm.cmd run test:run -- __tests__/components/esigning-sign-page.test.tsx
```

---

### Task 5: Give field canvas and PDF viewer non-overlapping keyboard scope

**Resolves:** ESG-F06.

**Files:**

- Modify: `src/components/processing/document-page-viewer.tsx`
- Modify: `src/components/esigning/prepare/esigning-field-canvas.tsx`
- Modify: `__tests__/components/esigning-field-canvas.test.tsx`
- Modify: `__tests__/browser/esigning-preparation.browser.test.tsx`
- Create: `__tests__/components/document-page-viewer.test.tsx`

#### 5.1 Write failing ownership tests

- [x] Add component/browser cases for:
  - `ArrowLeft` and `ArrowRight` on `document.body` are not prevented and cause no page/field change;
  - a focused selected field receives one nudge and does not change page;
  - a focused viewer with no selected field may use viewer page shortcuts when configured for focused ownership;
  - an event already marked `defaultPrevented` is ignored by the second owner;
  - the focusable canvas/field surface has a stable accessible name outside placement mode.
- [x] Ensure at least one test renders the real `DocumentPageViewer`; the current E-Signing unit mock is insufficient for integration ownership.

Run the red tests:

```powershell
npm.cmd run test:run -- __tests__/components/esigning-field-canvas.test.tsx
npm.cmd run test:run -- __tests__/components/document-page-viewer.test.tsx
npm.cmd run test:browser -- __tests__/browser/esigning-preparation.browser.test.tsx
```

#### 5.2 Add an explicit viewer shortcut policy

- [x] Add a backward-compatible prop:

```typescript
type DocumentPageViewerProps = {
  keyboardShortcutScope?: 'global' | 'focused' | 'disabled';
};
```

- [x] Retain `global` as the default only if existing non-E-Signing consumers depend on it.
- [x] In `focused` mode, handle page keys only when focus is within the viewer scroll container.
- [x] In every mode, return when `event.defaultPrevented` is true or the target is editable.
- [x] Configure the E-Signing canvas so field movement owns arrows while a field is selected. Do not let the viewer also consume the event.
- [x] Add a stable label such as `Document field canvas. Select a field to use arrow keys.` to the focusable surface. Preserve the more specific placement instruction when placement mode is active.

#### 5.3 Remove expected-error noise from browser verification

- [x] Stub the PDF thumbnail source used by the browser fixture, or supply a valid in-memory fixture response.
- [x] Capture unexpected console errors and fail the browser test when new relevant errors occur.
- [x] Do not globally suppress `console.error`; whitelist only a deliberately asserted error path.

Run green verification:

```powershell
npm.cmd run test:run -- __tests__/components/esigning-field-canvas.test.tsx
npm.cmd run test:run -- __tests__/components/document-page-viewer.test.tsx
npm.cmd run test:browser -- __tests__/browser/esigning-preparation.browser.test.tsx
```

---

### Task 6: Align completion-retry authorization across UI, API, and service

**Resolves:** ESG-F07.

**Files:**

- Modify: `src/app/api/esigning/envelopes/[id]/retry-processing/route.ts`
- Modify only if needed: `src/services/esigning-envelope.service.ts`
- Create: `__tests__/api/esigning-retry-processing-route.test.ts`
- Modify: `__tests__/services/esigning-envelope-list.test.ts`

#### 6.1 Write failing authorization tests

- [x] Add route tests proving:
  - an authenticated user with `esigning:update` reaches the service;
  - the resolved tenant and envelope ID are passed to the service;
  - a non-super-admin request-body tenant cannot override the session tenant;
  - a super admin can supply the explicit tenant context required by `resolveWorkspaceId()`;
  - missing update permission returns 403 and does not invoke the service;
  - authentication failure returns 401;
  - a service-level object/tenant denial maps to 403 without leaking cross-tenant existence.
- [x] Add service/serializer coverage proving:
  - an envelope creator with update scope can retry their own failed completion work;
  - an update-scoped non-creator without broader object access cannot retry another user's envelope;
  - `canRetryCompletionProcessing` matches those results.

Run the red tests:

```powershell
npm.cmd run test:run -- __tests__/api/esigning-retry-processing-route.test.ts __tests__/services/esigning-envelope-list.test.ts
```

#### 6.2 Apply the RBAC guideline consistently

- [x] Change the route permission boundary to:

```typescript
await requirePermission(session, 'esigning', 'update');
```

- [x] Resolve `tenantId` through `resolveWorkspaceId(session, body.tenantId)`, matching the other E-Signing mutation routes. Prove that a non-super-admin cannot override their session tenant; retain explicit requested-tenant support for a super admin and keep the service query scoped by the resolved value.
- [x] Retain the service's envelope-level creator/manage and tenant checks as the authoritative object authorization.
- [x] Keep the DTO capability computed from the same policy helper used by the service so the layers cannot drift again.
- [x] Preserve audit logging for the state-changing retry request.

Run green verification:

```powershell
npm.cmd run test:run -- __tests__/api/esigning-retry-processing-route.test.ts __tests__/services/esigning-envelope-list.test.ts
```

---

### Task 7: Enforce consent before every field-value save

**Resolves:** ESG-F08.

**Files:**

- Modify: `src/services/esigning-signing.service.ts`
- Modify: `__tests__/services/esigning-signing.service.test.ts`

#### 7.1 Write failing service tests

- [x] Add a no-consent case that calls `saveEsigningSigningFieldValues()` with otherwise valid fields.
- [x] Assert the call rejects with `Consent is required before saving signing fields`.
- [x] Assert no field upsert/update and no signature storage mutation occurs.
- [x] Add/retain a consented case proving normal autosave succeeds.

Run the red test:

```powershell
npm.cmd run test:run -- __tests__/services/esigning-signing.service.test.ts
```

#### 7.2 Add the server-side precondition

- [x] After loading and validating the signing context, and before parsing or persisting field mutations, add:

```typescript
if (!context.recipient.consentedAt) {
  throw new Error('Consent is required before saving signing fields');
}
```

- [x] Keep the existing signed/declined/finalized checks.
- [x] Do not infer consent from a client flag or request payload; only the stored recipient timestamp is authoritative.
- [x] Confirm the accept-consent transaction commits before the client begins autosave.

Run green verification:

```powershell
npm.cmd run test:run -- __tests__/services/esigning-signing.service.test.ts
```

---

### Task 8: Run integrated verification and reconcile documentation

**Files:**

- Modify: `docs/features/esigning/INVESTIGATIVE_ANALYSIS.md`
- Modify: `docs/superpowers/plans/2026-08-11-esigning-implementation-review-remediation.md`

#### 8.1 Run the focused regression set

- [x] Run:

```powershell
npm.cmd run test:run -- __tests__/components/esigning-sign-page.test.tsx __tests__/components/esigning-step-upload.test.tsx __tests__/components/esigning-list-actions.test.tsx __tests__/components/esigning-field-canvas.test.tsx __tests__/services/esigning-email-delivery.test.ts __tests__/services/esigning-completion-schema.test.ts __tests__/services/esigning-completion.service.test.ts __tests__/services/esigning-signing.service.test.ts __tests__/services/esigning-envelope-list.test.ts __tests__/services/esigning-field-overlap.test.ts __tests__/services/esigning-preparation-scheduler.test.ts __tests__/services/esigning-service-agreement-activation.test.ts __tests__/api/esigning-retry-processing-route.test.ts
npm.cmd run test:browser -- __tests__/browser/esigning-preparation.browser.test.tsx
npx.cmd prisma validate
```

- [x] Run the PostgreSQL worker test against an isolated disposable database:

```powershell
if (-not $env:TEST_DATABASE_URL) { throw 'Set TEST_DATABASE_URL to an isolated disposable PostgreSQL database before running this test.' }
npm.cmd run test:esigning:postgres
```

- [x] Run targeted lint over every modified TypeScript/TSX file.
- [x] Run `npx.cmd tsc --noEmit --pretty false`. Do not report a clean typecheck until all diagnostics are resolved. If only the known `tmp/verify-renderer.ts` baseline remains, record that fact verbatim and keep it outside the E-Signing completion claim.
- [x] Run `git diff --check`.

#### 8.2 Perform manual behavior checks

- [ ] Complete an envelope while the artifact worker is delayed. Confirm delivery attempts remain zero until PDF status is completed.
- [ ] Return a mocked provider `ok: false`. Confirm the UI shows retrying/failed rather than sent.
- [ ] Run two scheduler invocations concurrently. Confirm one completion email attempt and one auto-file audit.
- [ ] Fail the first terminal session reload, then recover the endpoint. Confirm polling resumes and the completion screen eventually hydrates.
- [ ] Focus outside the E-Signing canvas and press left/right. Confirm normal browser/page behavior is not prevented.
- [ ] Sign in as an update-scoped envelope creator. Confirm the visible retry action succeeds; confirm another user's inaccessible envelope remains forbidden.
- [ ] Submit a direct field-save request before consent. Confirm rejection and no data mutation.

#### 8.3 Update documentation only after evidence is green

- [x] Add a dated follow-up section to `docs/features/esigning/INVESTIGATIVE_ANALYSIS.md` linking to this plan and recording the final verified resolution of ESG-F01 through ESG-F08.
- [x] Mark checklist items in this plan as completed only after their commands and assertions pass.
- [x] Preserve the original investigation history; append the follow-up rather than rewriting the earlier evidence.

---

## 6. Deployment and rollback notes

- Apply the nullable claim-token migration before deploying code that writes tokens.
- Avoid mixed old/new worker binaries: drain or pause existing completion workers during application rollout, then resume after all instances use token ownership.
- Existing pending/retryable rows are safe to pick up after deployment. Existing processing rows without a token should wait for lease expiry and then be reclaimed.
- Monitor counts of `PENDING`, `FAILED_RETRYABLE`, `FAILED_PERMANENT`, and expired `PROCESSING` rows by stage. Alert on growing expired leases or a mismatch between provider attempts and scheduler `deliveriesSent`.
- A code rollback remains compatible with nullable token columns, but old code must not be allowed to run concurrently with token-aware workers because it does not honor ownership.
- Do not roll back the database migration merely to roll back application code; the added nullable columns are backward compatible.

---

## 7. Definition of done

The follow-up is complete only when all of the following are true:

- A batch-claimed completion delivery is processed by its owner without a second claim.
- Two concurrent workers cannot both finalize the same delivery or auto-file job.
- Due times, lease expiry, and PDF prerequisites are enforced in database candidate selection.
- Provider `ok: false` is stored and displayed as failure/retry, never success.
- Scheduler counters distinguish real success, failure, stale ownership, and skips.
- Ledger health is visible in list/detail, successful ledger rows supersede only matching legacy failures, and completion status uses completion rows only.
- Terminal signing polling survives a failed full-session hydration.
- Left/right keys have one focused owner and are not globally intercepted in E-Signing.
- Retry capability, route permission, service authorization, and tenant isolation agree.
- No signing field value can be persisted before stored consent.
- Unit, browser, Prisma, lint, PostgreSQL concurrency, typecheck-status, and diff checks are recorded with their actual outputs.
- `INVESTIGATIVE_ANALYSIS.md` links this follow-up and reflects only verified outcomes.

---

## 8. Explicit non-goals and residual risks

- This plan does not replace the project email provider or background scheduler infrastructure.
- This plan does not promise exactly-once email at the external-provider boundary. Without provider idempotency, a crash after provider acceptance and before the database success write can still duplicate delivery; the implementation must be honest about at-least-once semantics.
- This plan does not redesign the signing UX, document renderer, or generated PDF layout.
- The existing `tmp/verify-renderer.ts` type errors are not part of this E-Signing remediation unless implementation work changes that file or introduces new diagnostics.
- Legacy metadata remains read-only compatibility data during reconciliation; new delivery outcomes continue to be written to the durable ledger.
