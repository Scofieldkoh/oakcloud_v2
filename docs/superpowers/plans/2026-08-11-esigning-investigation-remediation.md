# E-Signing Investigation Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve all 15 confirmed E-signing findings, add durable completion and delivery processing, and isolate the remaining hydration observation without speculative product changes.

**Architecture:** Keep signer interactions client-driven but gate every state transition on a confirmed server response. Replace envelope-level email-health metadata with a durable, per-target delivery ledger, separate PDF generation from auto-filing and email delivery, and let the existing E-signing scheduler registration process each incomplete stage independently. Preserve the current three-step preparation flow while making server filtering, mobile overlays, scroll/focus management, and keyboard ownership explicit.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, TanStack Query, Zod, Prisma 7/PostgreSQL, Vitest, Testing Library, Vitest Browser Mode with Playwright, Tailwind CSS

## Global Constraints

- Treat `docs/features/esigning/INVESTIGATIVE_ANALYSIS.md` as the source of truth for finding scope and acceptance criteria.
- Preserve all current public and authenticated E-signing route URLs.
- Keep email and storage providers mocked in automated tests; verification must not send real envelopes or external email.
- Completion processing is at-least-once and idempotent by stable delivery/stage keys; a crash may retry work but must never skip it permanently.
- Every worker query and mutation must remain tenant- and envelope-scoped, use bounded batches, and reclaim expired processing leases.
- Existing completed envelopes must not receive surprise duplicate completion email after migration. Absence of a historical delivery record is displayed as `NOT_TRACKED`, not inferred as success.
- Mobile preparation must remain usable from 320 px upward, with at least 44 x 44 px touch targets, visible focus, and no body-level horizontal overflow.
- Follow `docs/guides/DESIGN_GUIDELINE.md` for status colors, focus rings, spacing, semantic HTML, and mobile behavior.
- Preserve the unrelated worktree changes listed at plan-writing time; each implementation task stages only its own paths.
- Run `npm.cmd run db:generate` after Prisma changes. The repository-wide TypeScript command may still report the pre-existing `tmp/verify-renderer.ts` errors; no new E-signing errors are acceptable.

---

## Finding Coverage and Dependency Map

| Finding | Implemented by | Depends on |
| --- | --- | --- |
| ESIGN-01 consent transition | Task 1 | None |
| ESIGN-02 completion polling/copy | Tasks 7-8 | Tasks 3-6 |
| ESIGN-03 durable artifact/auto-file/delivery | Tasks 3, 5-7 | None |
| ESIGN-04 unrelated email failure clearing | Tasks 3-4, 8 | Task 3 |
| ESIGN-05 empty initial autosave | Task 2 | None |
| ESIGN-06 placeholder used as value | Task 2 | None |
| ESIGN-07 clearing saved message | Task 9 | None |
| ESIGN-08 company filter pagination | Task 11 | None |
| ESIGN-09 orphan draft after upload failure | Task 10 | None |
| ESIGN-10 retained mobile scroll | Tasks 12, 15 | None |
| ESIGN-11 mobile palette width | Tasks 13, 15 | None |
| ESIGN-12 inaccessible first upload | Tasks 12, 15 | None |
| ESIGN-13 global arrow suppression | Tasks 14-15 | None |
| ESIGN-14 CC shown as queued | Tasks 3, 6, 8 | Task 3 |
| ESIGN-15 unhandled Upload save errors | Task 9 | None |
| OBS-01 hydration error | Task 16 | Tasks 12-14 should be complete before final reproduction |

The P1 signing-integrity tasks can ship before the durable completion migration. Tasks 3-8 form one database-backed workstream and should ship together. Tasks 9-11 are independent draft/list fixes. Tasks 12-15 form the preparation accessibility workstream.

## File Responsibility Map

### New files

- `prisma/migrations/20260811010000_esigning_completion_delivery_state/migration.sql` — adds post-completion state, delivery ledger, immutable attempts, indexes, and safe legacy backfill.
- `src/services/esigning-completion.service.ts` — queues and claims auto-file and completion-delivery work, calculates retry delays, and derives completion summaries.
- `__tests__/services/esigning-completion-schema.test.ts` — locks the Prisma relations, unique keys, indexes, and non-resend legacy policy.
- `__tests__/services/esigning-completion.service.test.ts` — covers durable queue creation, stage recovery, leases, retry limits, and recipient/sender delivery isolation.
- `__tests__/services/esigning-signing.service.test.ts` — covers atomic completion queueing and lightweight completion status serialization.
- `__tests__/components/esigning-sign-page.test.tsx` — covers consent failures, dirty autosave, placeholder separation, and completion polling.
- `__tests__/components/esigning-field-canvas.test.tsx` — covers keyboard ownership and selection reconciliation.
- `__tests__/browser/esigning-preparation.browser.test.tsx` — covers 320/390/768 px preparation layout, step focus/scroll, upload keyboard operation, and mobile palette overlay behavior.
- `__tests__/components/esigning-detail-hydration.test.tsx` — added only after Task 16 captures the mismatched render boundary; permanently reproduces the exact server/client divergence.

### Existing files with changed responsibilities

- `src/components/esigning/esigning-sign-page.tsx` — owns confirmed consent transitions, dirty revisions, and completed-view polling.
- `src/components/esigning/signing/esigning-completion-screen.tsx` — renders envelope, artifact, and current-recipient delivery states without claiming unproven delivery.
- `src/components/esigning/signing/esigning-field-input-modal.tsx` — displays instructions through `placeholder` while keeping the actual value empty.
- `src/lib/validations/esigning.ts` — remains the shared draft validation contract and accepts explicit `message: null`.
- `src/types/esigning.ts` — exposes delivery, post-completion, CC copy, company-option, and status-poll DTOs.
- `src/services/esigning-email-delivery.service.ts` — records one stable target at a time and derives aggregate health without clearing unrelated failures.
- `src/services/esigning-signing.service.ts` — atomically queues downstream completion work and returns polling state.
- `src/services/esigning-pdf.service.ts` — generates artifacts only; it no longer auto-files or sends completion mail inside artifact generation.
- `src/services/esigning-envelope.service.ts` — decorates immediate email results with stable targets, returns server company options, and retries failed completion stages.
- `src/services/esigning-envelope.lib.ts` — serializes delivery ledger state and CC copy outcomes.
- `src/lib/scheduler/tasks/esigning-pdf-generation.task.ts` — keeps its registered task ID but invokes the full post-completion orchestrator.
- `src/hooks/use-esigning.ts` — sends `companyId` and exposes returned company filter options.
- `src/components/esigning/esigning-list-page.tsx` — compensates failed first uploads and consumes server-side company filtering.
- `src/components/esigning/esigning-detail-page.tsx` — centralizes wizard transitions and scroll/focus reset.
- `src/components/esigning/prepare/esigning-step-upload.tsx` — handles nullable message persistence, validation, server errors, and keyboard upload.
- `src/components/esigning/prepare/esigning-step-fields.tsx` — uses overlay panels below 768 px and desktop widths only at tablet/desktop breakpoints.
- `src/components/esigning/prepare/esigning-field-palette.tsx` — reports a selected placement type so the mobile overlay can close.
- `src/components/esigning/prepare/esigning-field-canvas.tsx` — scopes shortcuts to focused, visible canvas selections.
- `src/components/esigning/prepare/esigning-recipient-card.tsx` and `src/components/esigning/esigning-shared.tsx` — render signer routing and CC copy delivery as separate concepts.
- `src/components/ui/modal.tsx` — adds a reusable bottom placement while preserving its focus trap and center placement default.

---

### Task 1: Gate entry to signing on confirmed consent (ESIGN-01)

**Files:**
- Create: `__tests__/components/esigning-sign-page.test.tsx`
- Modify: `src/components/esigning/esigning-sign-page.tsx:855-1010`

**Interfaces:**
- Produces: `recordConsent(): Promise<boolean>`; `true` means the returned session contains `recipient.consentedAt`, and only that result may transition to `signing`.
- Preserves: `bootstrapSigning()` remains the retry path for network/session failures.

- [ ] **Step 1: Write the consent failure matrix**

Mock the bootstrap exchange and session load so the consent screen renders. Parameterize consent responses for network rejection, HTTP 400, expired envelope, expired session, and generic HTTP 500. The central assertion is:

```tsx
await user.click(screen.getByRole('checkbox', { name: /I agree/i }));
await user.click(screen.getByRole('button', { name: /Continue to Document/i }));

expect(screen.queryByTestId('signing-document')).not.toBeInTheDocument();
expect(consentRequestCount()).toBe(1);
```

For network and session errors, assert the existing error screen and `Resume signing` action. For a generic server error, assert the consent screen remains mounted, the error is announced, and the same button can retry.

- [ ] **Step 2: Run RED**

```powershell
npm.cmd run test:run -- __tests__/components/esigning-sign-page.test.tsx -t "does not enter signing when consent"
```

Expected: FAIL because the `onConsent` callback sets `flowState` to `signing` after `recordConsent()` returns from its catch branch.

- [ ] **Step 3: Return an explicit success result**

Implement the contract:

```tsx
async function recordConsent(): Promise<boolean> {
  setIsConsenting(true);
  try {
    const result = await postConsent();
    if (!result.recipient.consentedAt) {
      throw new Error('Consent was not confirmed by the server');
    }
    setSession(result);
    setErrorState(null);
    return true;
  } catch (error) {
    handleConsentError(error);
    return false;
  } finally {
    setIsConsenting(false);
  }
}
```

Change the callback to `if (await recordConsent()) setFlowState('signing')`. Keep the error transition selected by `normalizeSigningError`; never overwrite it after the awaited call.

- [ ] **Step 4: Run GREEN and focused lint**

```powershell
npm.cmd run test:run -- __tests__/components/esigning-sign-page.test.tsx -t "consent"
npx.cmd eslint src/components/esigning/esigning-sign-page.tsx __tests__/components/esigning-sign-page.test.tsx
```

Expected: all consent cases pass and no lint errors are emitted.

- [ ] **Step 5: Commit the isolated control fix**

```powershell
git add src/components/esigning/esigning-sign-page.tsx __tests__/components/esigning-sign-page.test.tsx
git commit -m "fix(esigning): require confirmed consent before signing"
```

---

### Task 2: Make signer autosave dirty-aware and separate instructions from values (ESIGN-05, ESIGN-06)

**Files:**
- Modify: `__tests__/components/esigning-sign-page.test.tsx`
- Modify: `src/components/esigning/esigning-sign-page.tsx:100-155, 274-520, 700-790`
- Modify: `src/components/esigning/signing/esigning-field-input-modal.tsx:55-105`

**Interfaces:**
- Produces: `dirtyRevisionRef` and `savedRevisionRef`; a save is eligible only when `dirtyRevisionRef.current > savedRevisionRef.current`.
- Produces: `getSuggestedFieldValue()` returns automatic data only for `NAME`, `COMPANY`, and `DATE_SIGNED`; `TEXT` and `TITLE` return `null`.

- [ ] **Step 1: Add failing autosave and placeholder tests**

Cover these cases:

```tsx
it('does not save an untouched signature-only envelope', async () => {
  renderSigningSession(signatureOnlySession());
  await advanceTimersByTimeAsync(600);
  expect(fieldSaveRequests()).toHaveLength(0);
});

it.each(['TEXT', 'TITLE'] as const)('does not adopt %s placeholder as a value', async (type) => {
  renderSigningSession(sessionWithField({ type, placeholder: 'Enter job title' }));
  await user.click(screen.getByRole('button', { name: /Fill/i }));
  expect(screen.getByRole('textbox')).toHaveValue('');
  expect(screen.getByRole('textbox')).toHaveAttribute('placeholder', 'Enter job title');
});
```

Also assert a `DATE_SIGNED` automatic value is dirty and saved once, and a signer edit that occurs during an in-flight save schedules a second save instead of being marked clean by the older response.

- [ ] **Step 2: Run RED**

```powershell
npm.cmd run test:run -- __tests__/components/esigning-sign-page.test.tsx -t "autosave|placeholder|in-flight"
```

Expected: the untouched session issues `PUT .../fields` with `values: []`, and Text/Title starts with the placeholder as its value.

- [ ] **Step 3: Track dirty revisions without coupling them to server hydration**

Use monotonic refs:

```tsx
const dirtyRevisionRef = useRef(0);
const savedRevisionRef = useRef(0);

function markDraftDirty() {
  dirtyRevisionRef.current += 1;
}
```

Call `markDraftDirty()` from user-driven `setDraft()` and only when automatic date insertion actually changes state. Do not mark values dirty in `loadSession()` or `mergeDraftState()`. In `saveProgress()`, return immediately when revisions match or `serializeValues(...)` is empty. Capture `savingRevision`; after success, advance `savedRevisionRef` only to that captured revision so a concurrent edit remains dirty.

- [ ] **Step 4: Remove placeholder fallback from actual value initialization**

Change the default branch of `getSuggestedFieldValue()` to `return null`. Pass `field.placeholder ?? undefined` to the modal input's `placeholder` prop, while initializing its `value` from the explicit suggestion only.

- [ ] **Step 5: Run GREEN and the route schema regression**

```powershell
npm.cmd run test:run -- __tests__/components/esigning-sign-page.test.tsx __tests__/components/esigning-step-upload.test.tsx
npx.cmd eslint src/components/esigning/esigning-sign-page.tsx src/components/esigning/signing/esigning-field-input-modal.tsx __tests__/components/esigning-sign-page.test.tsx
```

Expected: no initial empty save, automatic dates still persist, concurrent edits remain dirty, and instructional text never satisfies a required field.

- [ ] **Step 6: Commit signer-value integrity**

```powershell
git add src/components/esigning/esigning-sign-page.tsx src/components/esigning/signing/esigning-field-input-modal.tsx __tests__/components/esigning-sign-page.test.tsx
git commit -m "fix(esigning): save only changed signer values"
```

---

### Task 3: Add durable post-completion and per-target delivery state (ESIGN-03, ESIGN-04, ESIGN-14)

**Files:**
- Create: `prisma/migrations/20260811010000_esigning_completion_delivery_state/migration.sql`
- Create: `__tests__/services/esigning-completion-schema.test.ts`
- Modify: `prisma/schema.prisma:1255-1435, 3321-3370`
- Modify generated output: `src/generated/prisma/**`
- Modify: `src/types/esigning.ts:1-190`

**Interfaces:**
- Produces: `EsigningPostCompletionStatus`, `EsigningEmailDeliveryKind`, `EsigningEmailDeliveryAudience`, and `EsigningEmailDeliveryStatus` Prisma enums.
- Produces: one `EsigningEmailDelivery` row per `{envelopeId, kind, targetKey}` and immutable `EsigningEmailDeliveryAttempt` rows.
- Produces DTOs: `EsigningPostCompletionDto`, `EsigningEmailDeliveryHealthDto`, and `EsigningCopyDeliveryStatusDto`.

- [ ] **Step 1: Lock the schema contract with a failing source test**

Assert that the schema contains the following unique key, queue indexes, and relations:

```ts
expect(schema).toMatch(/@@unique\(\[envelopeId, kind, targetKey\]\)/);
expect(schema).toMatch(/@@index\(\[status, availableAt\]\)/);
expect(schema).toMatch(/emailDeliveries\s+EsigningEmailDelivery\[\]/);
expect(schema).toMatch(/deliveryAttempts\s+EsigningEmailDeliveryAttempt\[\]/);
```

Read the migration and assert it does not insert completion deliveries for envelopes whose PDF status is already `COMPLETED`.

- [ ] **Step 2: Run RED**

```powershell
npm.cmd run test:run -- __tests__/services/esigning-completion-schema.test.ts
```

Expected: FAIL because none of the durable stage or delivery records exist.

- [ ] **Step 3: Add the Prisma models and stage fields**

Use these exact state shapes:

```prisma
enum EsigningPostCompletionStatus {
  NOT_REQUIRED
  PENDING
  PROCESSING
  COMPLETED
  FAILED_RETRYABLE
  FAILED_PERMANENT
}

enum EsigningEmailDeliveryKind {
  REQUEST
  REMINDER
  COMPLETION
  DECLINED
  PDF_FAILURE
  EXPIRY_WARNING
  EXPIRED
  VOIDED
}

enum EsigningEmailDeliveryAudience {
  RECIPIENT
  SENDER
}

enum EsigningEmailDeliveryStatus {
  PENDING
  PROCESSING
  SUCCEEDED
  FAILED_RETRYABLE
  FAILED_PERMANENT
}
```

Add `autoFilingStatus`, `autoFilingAttempts`, `autoFilingAvailableAt`, `autoFilingClaimedAt`, `autoFilingLeaseExpiresAt`, and `autoFilingError` to `EsigningEnvelope`. Add the ledger with these exact fields and indexes:

```prisma
model EsigningEmailDelivery {
  id              String                       @id @default(uuid())
  tenantId        String
  envelopeId      String
  recipientId     String?
  audience        EsigningEmailDeliveryAudience
  kind            EsigningEmailDeliveryKind
  targetKey       String
  toEmail         String
  subject         String
  status          EsigningEmailDeliveryStatus  @default(PENDING)
  attemptCount    Int                          @default(0)
  availableAt     DateTime                     @default(now())
  claimedAt       DateTime?
  leaseExpiresAt  DateTime?
  lastAttemptedAt DateTime?
  sentAt          DateTime?
  lastError       String?
  createdAt       DateTime                     @default(now())
  updatedAt       DateTime                     @updatedAt
  tenant          Workspace                    @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  envelope        EsigningEnvelope             @relation(fields: [envelopeId], references: [id], onDelete: Cascade)
  recipient       EsigningEnvelopeRecipient?   @relation(fields: [recipientId], references: [id], onDelete: SetNull)
  deliveryAttempts EsigningEmailDeliveryAttempt[]

  @@unique([envelopeId, kind, targetKey])
  @@index([status, availableAt])
  @@index([status, leaseExpiresAt])
  @@index([tenantId, envelopeId])
}

model EsigningEmailDeliveryAttempt {
  id                String                 @id @default(uuid())
  deliveryId        String
  toEmail           String
  subject           String
  succeeded         Boolean
  providerMessageId String?
  error             String?
  attemptedAt       DateTime               @default(now())
  delivery          EsigningEmailDelivery @relation(fields: [deliveryId], references: [id], onDelete: Cascade)

  @@index([deliveryId, attemptedAt])
}
```

Add reverse `emailDeliveries` relations to `Workspace`, `EsigningEnvelope`, and `EsigningEnvelopeRecipient`. Map table/column names consistently with the existing E-signing migration style.

- [ ] **Step 4: Write a safe migration/backfill**

The migration must:

- Set `autoFilingStatus = NOT_REQUIRED` for envelopes without a company.
- Set company-linked completed envelopes to `PENDING`; deterministic document IDs make auto-filing safe to reconcile.
- Create pending completion deliveries only for already-completed envelopes whose PDF is not yet `COMPLETED` at migration time.
- Leave already artifact-complete historical envelopes without completion delivery rows so serialization returns `NOT_TRACKED` and does not resend them.
- Leave existing `metadata.emailDelivery` unchanged and read it as a legacy fallback; this avoids guessing recipient/sender identity during migration.

- [ ] **Step 5: Define the DTO contract**

```ts
export type EsigningCopyDeliveryStatusDto =
  | 'AWAITING_COMPLETION'
  | 'PENDING'
  | 'RETRYING'
  | 'SENT'
  | 'FAILED'
  | 'NOT_TRACKED';

export interface EsigningPostCompletionDto {
  artifactStatus: EsigningPdfGenerationStatus | null;
  autoFilingStatus: EsigningPostCompletionStatus;
  completionDeliveryStatus: 'PENDING' | 'RETRYING' | 'COMPLETED' | 'FAILED' | 'NOT_TRACKED';
  failedCompletionDeliveryCount: number;
}
```

Map `PENDING`/`PROCESSING` ledger rows to `PENDING`, `FAILED_RETRYABLE` to `RETRYING`, `SUCCEEDED` to `SENT`, and `FAILED_PERMANENT` to `FAILED`. `NOT_TRACKED` is derived only when a historical, artifact-complete envelope has no completion row. Add `postCompletion` to list/detail DTOs, `copyDeliveryStatus` to recipient DTOs, and the current recipient's completion delivery status to signing session/status DTOs. Add `targetKey` to `EsigningEmailDeliveryFailureDto`. Prisma kinds remain uppercase; the existing lower-case API labels are produced only at the DTO boundary with `kind.toLowerCase()`.

- [ ] **Step 6: Generate and validate**

```powershell
npm.cmd run db:generate
npx.cmd prisma validate
npm.cmd run test:run -- __tests__/services/esigning-completion-schema.test.ts
```

Expected: Prisma validates, generated clients include both models, and the schema contract passes.

- [ ] **Step 7: Commit the persistence foundation**

```powershell
git add prisma/schema.prisma prisma/migrations/20260811010000_esigning_completion_delivery_state src/generated/prisma src/types/esigning.ts __tests__/services/esigning-completion-schema.test.ts
git commit -m "feat(esigning): persist completion and delivery state"
```

---

### Task 4: Record email health by stable target without clearing unrelated failures (ESIGN-04)

**Files:**
- Modify: `__tests__/services/esigning-email-delivery.test.ts`
- Modify: `src/services/esigning-email-delivery.service.ts:1-155`
- Modify: `src/services/esigning-notification.service.ts:155-180`
- Modify: `src/services/esigning-envelope.service.ts:154-252, 2145-2860`
- Modify: `src/services/esigning-signing.service.ts:910-940`

**Interfaces:**
- Produces: `RecordedEsigningEmailDeliveryResult`, which extends the provider result with `tenantId`, `targetKey`, `audience`, and optional `recipientId`.
- Produces: `recordEsigningEmailDeliveryResults(envelopeId, results)` upserts only matching ledger rows and appends attempts in one transaction.
- Produces: `getEsigningEmailDeliveryHealth(deliveries, legacyMetadata)` as a pure serializer helper.

- [ ] **Step 1: Replace the old clearing test with target-isolation tests**

Keep the matching-retry case and add the unrelated-success case:

```ts
it('does not clear a request failure when a reminder succeeds', async () => {
  const health = getEsigningEmailDeliveryHealth([
    delivery({ kind: 'REQUEST', targetKey: 'recipient:signer-1', status: 'FAILED_RETRYABLE' }),
    delivery({ kind: 'REMINDER', targetKey: 'recipient:signer-1', status: 'SUCCEEDED' }),
  ], null);

  expect(health.failures).toEqual([
    expect.objectContaining({ kind: 'request', targetKey: 'recipient:signer-1' }),
  ]);
});
```

Define the test-local `delivery()` factory with every required ledger field and explicit defaults. Also assert a successful `REQUEST` retry clears only the same target, a second recipient's request failure remains, and every recorder call creates an immutable attempt containing `providerMessageId` when present.

- [ ] **Step 2: Run RED**

```powershell
npm.cmd run test:run -- __tests__/services/esigning-email-delivery.test.ts
```

Expected: the current metadata merge reports `ok` after any all-success batch and loses the earlier request failure.

- [ ] **Step 3: Implement per-target upsert and attempt recording**

For each result, upsert with the compound key and update only that row. `RecordedEsigningEmailDeliveryResult.kind` uses the uppercase Prisma enum; `safeSendEmail()` returns the provider message ID so the recorder can retain it:

```ts
where: {
  envelopeId_kind_targetKey: {
    envelopeId,
    kind: result.kind,
    targetKey: result.targetKey,
  },
}
```

Map success to `SUCCEEDED`, set `sentAt`, clear only that row's `lastError`, and append a successful attempt. Map failure to `FAILED_RETRYABLE`, retain the error, and append a failed attempt. Aggregate health is failed when any ledger row is `FAILED_RETRYABLE` or `FAILED_PERMANENT`.

- [ ] **Step 4: Decorate every immediate delivery call site**

Use `recipient:<recipientId>` for one-time recipient request/voided results and `sender:<createdById>` for declined, PDF-failure, expiry-warning, and expired results. A reminder is a repeatable delivery event, so key it as `recipient:<recipientId>:reminder:<scheduledOccurrenceIso>`; retrying that occurrence reuses the same key while a later scheduled reminder gets a new row. Keep the kind in the compound key rather than duplicating it in other target keys. Manual-link recipients produce no email ledger attempt.

- [ ] **Step 5: Preserve legacy reads during rollout**

When no ledger failures are present, parse historical metadata failures. Once a matching ledger record exists, prefer it over the legacy entry for the same `{kind, normalized address}` so a confirmed retry can resolve migrated health without erasing a different target.

- [ ] **Step 6: Run GREEN and focused notification tests**

```powershell
npm.cmd run test:run -- __tests__/services/esigning-email-delivery.test.ts __tests__/services/esigning-service-agreement-activation.test.ts
npx.cmd eslint src/services/esigning-email-delivery.service.ts src/services/esigning-notification.service.ts src/services/esigning-envelope.service.ts src/services/esigning-signing.service.ts
```

- [ ] **Step 7: Commit delivery isolation**

```powershell
git add src/services/esigning-email-delivery.service.ts src/services/esigning-notification.service.ts src/services/esigning-envelope.service.ts src/services/esigning-signing.service.ts __tests__/services/esigning-email-delivery.test.ts
git commit -m "fix(esigning): isolate email delivery failures by target"
```

---

### Task 5: Queue every required completion stage atomically (ESIGN-03, ESIGN-14)

**Files:**
- Create: `__tests__/services/esigning-signing.service.test.ts`
- Create: `src/services/esigning-completion.service.ts`
- Modify: `src/services/esigning-signing.service.ts:35-85, 800-855`

**Interfaces:**
- Produces: `queueEsigningCompletionWork(tx, { tenantId, envelopeId, completedAt }): Promise<void>`.
- Consumes: the new delivery unique key and post-completion fields from Task 3.
- Guarantees: envelope `COMPLETED`, PDF `PENDING`, auto-file state, event creation, service-agreement queueing, and recipient/sender completion-delivery rows commit or roll back together.

- [ ] **Step 1: Write the atomic queue tests**

Mock a transaction client and assert the final signer creates exactly one delivery for every recipient plus the sender:

```ts
expect(tx.esigningEmailDelivery.createMany).toHaveBeenCalledWith({
  data: expect.arrayContaining([
    expect.objectContaining({ kind: 'COMPLETION', targetKey: 'recipient:recipient-1', status: 'PENDING' }),
    expect.objectContaining({ kind: 'COMPLETION', targetKey: 'sender:user-1', status: 'PENDING' }),
  ]),
  skipDuplicates: true,
});
```

Assert company-linked envelopes set auto-file to `PENDING`, unlinked envelopes use `NOT_REQUIRED`, and a repeated completion call creates no duplicate work.

- [ ] **Step 2: Run RED**

```powershell
npm.cmd run test:run -- __tests__/services/esigning-signing.service.test.ts -t "queues completion"
```

- [ ] **Step 3: Implement queue construction inside the completion transaction**

Load recipient IDs/emails and sender identity through `tx`, snapshot the address/subject, use `createMany(... skipDuplicates: true)`, and initialize `availableAt` to `completedAt`. Invoke the helper from `finalizeEsigningEnvelopeCompletion()` before returning `true`.

- [ ] **Step 4: Verify rollback behavior**

Add a test in which delivery creation rejects and assert the mocked transaction rejects before any after-transaction activation/reconciliation function runs. This proves downstream work cannot be silently absent from a committed completion.

- [ ] **Step 5: Run GREEN**

```powershell
npm.cmd run test:run -- __tests__/services/esigning-signing.service.test.ts __tests__/services/esigning-service-agreement-activation.test.ts
```

- [ ] **Step 6: Commit atomic completion queueing**

```powershell
git add src/services/esigning-completion.service.ts src/services/esigning-signing.service.ts __tests__/services/esigning-signing.service.test.ts
git commit -m "feat(esigning): queue completion work atomically"
```

---

### Task 6: Split artifact generation, auto-filing, and delivery into retryable workers (ESIGN-03)

**Files:**
- Create: `__tests__/services/esigning-completion.service.test.ts`
- Modify: `src/services/esigning-pdf.service.ts:503-1215`
- Modify: `src/services/esigning-completion.service.ts`
- Modify: `src/lib/scheduler/tasks/esigning-pdf-generation.task.ts`

**Interfaces:**
- Produces: `generateEnvelopeArtifacts(envelopeId): Promise<void>` that updates only PDF/document artifact state.
- Produces: `processQueuedEsigningCompletionWork({ limit, concurrency, leaseMs })` returning per-stage counts.
- Produces: `processEsigningAutoFileJob(envelopeId)` and `processEsigningCompletionDelivery(deliveryId)` as independently retryable operations.

- [ ] **Step 1: Write crash, repair-race, and idempotency regressions**

Cover these state transitions:

```ts
it('continues downstream work when the artifact is already complete', async () => {
  seedEnvelope({ pdf: 'COMPLETED', autoFile: 'PENDING' });
  seedCompletionDelivery({ status: 'PENDING' });
  await processQueuedEsigningCompletionWork();
  expect(autoFile).toHaveBeenCalledOnce();
  expect(sendCompletion).toHaveBeenCalledOnce();
});

it('artifact repair never marks delivery complete or sends email', async () => {
  await ensureEsigningEnvelopeArtifacts({ envelopeId: 'envelope-1', requireCertificates: true });
  expect(sendCompletion).not.toHaveBeenCalled();
  expect(deliveryStatus()).toBe('PENDING');
});
```

Also test stale `PROCESSING` leases are reclaimed, fresh leases are not, deterministic auto-file reruns do not create a second company document, and attempt exhaustion changes a stage to `FAILED_PERMANENT`.

- [ ] **Step 2: Run RED**

```powershell
npm.cmd run test:run -- __tests__/services/esigning-completion.service.test.ts
```

Expected: the current generator marks PDF complete before downstream calls and the scheduler ignores completed PDFs with unfinished work.

- [ ] **Step 3: Make PDF generation artifact-only**

Remove `sendNotifications` and the auto-file/completion-email block from `generateEnvelopeArtifacts`. Mark `pdfGenerationStatus = COMPLETED` only after every signed document and certificate upload plus document-row update succeeds. `ensureEsigningEnvelopeArtifacts()` may repair artifacts but cannot mutate auto-file or delivery rows.

- [ ] **Step 4: Make auto-filing independently idempotent**

Load signed buffers from `signedStoragePath`, retain the deterministic UUIDv5 company-document ID, and claim envelopes where artifact status is `COMPLETED` and auto-file state is pending/retryable or has an expired lease. Mark `COMPLETED` only after all company documents are durable. On failure, increment attempts, apply exponential backoff, and choose retryable/permanent state using the same bounded policy as task E-signing preparation.

- [ ] **Step 5: Deliver one queued target per claimed job**

Claim delivery rows with `FOR UPDATE SKIP LOCKED`, a lease expiry, and a bounded batch. Build links and attachments after artifact completion, send to only the claimed recipient or sender, append an attempt, and mark only that row `SUCCEEDED` or failed. A completed row is never selected again.

- [ ] **Step 6: Orchestrate stages without a single-status early return**

`processQueuedEsigningCompletionWork()` runs artifact candidates, then eligible auto-file candidates, then eligible delivery candidates. Keep scheduler registration ID `esigning-pdf-generation` so existing scheduler configuration continues to work, but update its name/description and returned counts to cover all stages.

- [ ] **Step 7: Run GREEN and scheduler regressions**

```powershell
npm.cmd run test:run -- __tests__/services/esigning-completion.service.test.ts __tests__/services/esigning-preparation-scheduler.test.ts
npx.cmd eslint src/services/esigning-pdf.service.ts src/services/esigning-completion.service.ts src/lib/scheduler/tasks/esigning-pdf-generation.task.ts
```

- [ ] **Step 8: Commit the durable worker**

```powershell
git add src/services/esigning-pdf.service.ts src/services/esigning-completion.service.ts src/lib/scheduler/tasks/esigning-pdf-generation.task.ts __tests__/services/esigning-completion.service.test.ts
git commit -m "fix(esigning): resume every incomplete completion stage"
```

---

### Task 7: Expose completion progress and retry failed stages (ESIGN-02, ESIGN-03)

**Files:**
- Modify: `__tests__/services/esigning-signing.service.test.ts`
- Modify: `src/services/esigning-completion.service.ts`
- Modify: `src/services/esigning-signing.service.ts:240-350, 578-622`
- Modify: `src/services/esigning-envelope.lib.ts:125-350`
- Modify: `src/services/esigning-envelope.service.ts:2562-2613`
- Modify: `src/app/api/esigning/envelopes/[id]/retry-processing/route.ts`
- Modify: `src/types/esigning.ts:140-190`

**Interfaces:**
- Produces: `getEsigningPostCompletionSummary(envelope, deliveries)`.
- Produces lightweight status DTO fields `pdfGenerationStatus`, `autoFilingStatus`, `completionDeliveryStatus`, `currentRecipientDeliveryStatus`, `remainingSignerCount`, and `terminal`.
- Produces: `retryEsigningEnvelopeCompletionProcessing()` replacing PDF-only retry behavior.

- [ ] **Step 1: Add status serialization tests**

Assert an earlier signer sees `remainingSignerCount > 0` and `terminal: false`; a final signer with PDF pending sees non-terminal; PDF failed is terminal for public polling; and auto-file/delivery remains non-terminal while retryable work is scheduled. Cover the DTO mappings `FAILED_RETRYABLE -> RETRYING`, `FAILED_PERMANENT -> FAILED`, and missing historical completion row -> `NOT_TRACKED`.

- [ ] **Step 2: Run RED**

```powershell
npm.cmd run test:run -- __tests__/services/esigning-signing.service.test.ts -t "completion status"
```

- [ ] **Step 3: Extend the lightweight status query**

Select envelope PDF/auto-file fields, signer counts, and only the current recipient's completion-delivery row. Do not return other addresses or provider errors on the public route. Derive `terminal` from persisted worker states, not from the display labels:

```ts
const terminal = envelope.status === 'COMPLETED'
  && ['COMPLETED', 'FAILED'].includes(pdfGenerationStatus)
  && isTerminalPostCompletion(autoFilingStatus)
  && isTerminalDelivery(currentRecipientDelivery?.status ?? 'NOT_TRACKED');
```

`isTerminalPostCompletion()` returns true only for `NOT_REQUIRED`, `COMPLETED`, and `FAILED_PERMANENT`; `isTerminalDelivery()` returns true only for `SUCCEEDED`, `FAILED_PERMANENT`, and derived historical `NOT_TRACKED`. Therefore a retryable failure serializes as `RETRYING` and keeps polling. For an earlier signer, `terminal` remains false until the envelope completes.

- [ ] **Step 4: Generalize authenticated retry**

The existing retry route resets only failed stages: PDF `FAILED -> PENDING`, auto-file failed states `-> PENDING`, and failed completion delivery rows `-> PENDING` with `availableAt = now()`. It must not resend successful targets. Rename the service function and DTO capability to `canRetryCompletionProcessing`; retain the route URL.

- [ ] **Step 5: Run GREEN**

```powershell
npm.cmd run test:run -- __tests__/services/esigning-signing.service.test.ts __tests__/services/esigning-completion.service.test.ts
```

- [ ] **Step 6: Commit the status/retry contract**

```powershell
git add src/services/esigning-completion.service.ts src/services/esigning-signing.service.ts src/services/esigning-envelope.lib.ts src/services/esigning-envelope.service.ts src/app/api/esigning/envelopes/[id]/retry-processing/route.ts src/types/esigning.ts __tests__/services/esigning-signing.service.test.ts
git commit -m "feat(esigning): expose and retry completion progress"
```

---

### Task 8: Poll and render truthful completion and CC delivery states (ESIGN-02, ESIGN-04, ESIGN-14)

**Files:**
- Modify: `__tests__/components/esigning-sign-page.test.tsx`
- Modify: `__tests__/components/esigning-list-actions.test.tsx`
- Modify: `src/components/esigning/esigning-sign-page.tsx:385-555, 1015-1050`
- Modify: `src/components/esigning/signing/esigning-completion-screen.tsx`
- Modify: `src/components/esigning/esigning-shared.tsx:20-155`
- Modify: `src/components/esigning/prepare/esigning-recipient-card.tsx:35-95`
- Modify: `src/components/esigning/esigning-detail-page.tsx:880-1070`
- Modify: `src/components/esigning/esigning-list-page.tsx:790-830`

**Interfaces:**
- Consumes: Task 7 status DTO and `terminal` flag.
- Produces: `CopyDeliveryStatusBadge` for CC recipients and delivery-aware completion copy.

- [ ] **Step 1: Write completion polling tests**

Use fake timers and sequential status/session responses to cover:

- earlier signer: `IN_PROGRESS -> COMPLETED` without reload;
- final signer: PDF `PENDING -> COMPLETED`, making signed links appear;
- PDF `FAILED`, rendering an error rather than a spinner;
- completion delivery `PENDING -> SENT` and `PENDING -> RETRYING -> FAILED`;
- polling stops only after the returned `terminal` flag is true and refreshes immediately when the tab becomes visible.

- [ ] **Step 2: Run RED**

```powershell
npm.cmd run test:run -- __tests__/components/esigning-sign-page.test.tsx -t "completion"
```

- [ ] **Step 3: Poll in both signing and completed states**

Run the existing 30-second poller when `flowState` is `signing` or when it is `completed` and the latest status is non-terminal. On envelope, artifact, or current-delivery change, call `loadSession({ preserveDrafts: true })`; do not reload the full session on unchanged polls.

- [ ] **Step 4: Split completion rendering into explicit states**

Render separate branches for waiting signers, artifact pending, artifact failed, copy pending, copy retrying, copy sent, copy failed, and historical `NOT_TRACKED`. Replace “all parties received a copy” with evidence-based text. PDF failure guidance tells the recipient to contact the sender; authenticated detail exposes the retry action from Task 7.

- [ ] **Step 5: Render CC copy outcome instead of signer routing status**

For signers, keep `RecipientStatusBadge`. For CC recipients, render:

```tsx
<CopyDeliveryStatusBadge status={recipient.copyDeliveryStatus} />
```

Use labels `Copy after completion`, `Copy pending`, `Retrying copy`, `Copy sent`, `Copy failed`, and `Delivery not tracked`. Apply the same derived state to list icons so `QUEUED` is never presented as the CC's operational result.

- [ ] **Step 6: Prove unrelated delivery warnings remain visible**

Extend the list test fixture with one failed request and one successful reminder. Assert `Email failed` stays visible and the CC row shows its independent copy state.

- [ ] **Step 7: Run GREEN and focused lint**

```powershell
npm.cmd run test:run -- __tests__/components/esigning-sign-page.test.tsx __tests__/components/esigning-list-actions.test.tsx
npx.cmd eslint src/components/esigning/esigning-sign-page.tsx src/components/esigning/signing/esigning-completion-screen.tsx src/components/esigning/esigning-shared.tsx src/components/esigning/prepare/esigning-recipient-card.tsx src/components/esigning/esigning-detail-page.tsx src/components/esigning/esigning-list-page.tsx
```

- [ ] **Step 8: Commit truthful completion UI**

```powershell
git add src/components/esigning __tests__/components/esigning-sign-page.test.tsx __tests__/components/esigning-list-actions.test.tsx
git commit -m "fix(esigning): refresh and report completion outcomes"
```

---

### Task 9: Persist cleared messages and handle Upload validation/save failures (ESIGN-07, ESIGN-15)

**Files:**
- Modify: `__tests__/components/esigning-step-upload.test.tsx`
- Modify: `src/components/esigning/prepare/esigning-step-upload.tsx:51-95, 465-620, 1580-1740`
- Verify: `src/lib/validations/esigning.ts:33-105`
- Verify: `src/services/esigning-envelope.service.ts:603-650`

**Interfaces:**
- Produces: a settings payload that always sends `message: string | null`.
- Produces: `settingsErrors` keyed by `title`, `message`, `reminderFrequencyDays`, `reminderStartDays`, and `expiryWarningDays`, plus a persistent submit error.

- [ ] **Step 1: Add persistence and failure-path tests**

```tsx
it('sends null when a saved message is cleared', async () => {
  renderUpload({ message: 'Sensitive old text' });
  await user.clear(screen.getByRole('textbox', { name: 'Message' }));
  await user.click(nextButton());
  expect(onUpdateSettings).toHaveBeenCalledWith(expect.objectContaining({ message: null }));
});
```

Also test blank/overlong subject, overlong message, out-of-range and fractional reminder values, a rejected settings update, and a rejected recipient reorder. In every failure case `onNext` remains uncalled, the error is announced, and the first invalid control receives focus.

- [ ] **Step 2: Run RED**

```powershell
npm.cmd run test:run -- __tests__/components/esigning-step-upload.test.tsx -t "message|validation|failure"
```

- [ ] **Step 3: Build and validate one explicit payload**

Use `Number(trimmed)` rather than `parseInt` so fractional values reach Zod and fail `.int()`. Validate with `updateEsigningEnvelopeSchema.safeParse(payload)`, map issues to field errors, open Advanced settings when its field fails, and focus the first invalid ref on the next animation frame.

- [ ] **Step 4: Catch both asynchronous mutations**

Wrap settings update and reorder in one `try/catch`. Show the server message in a persistent `Alert variant="error"`; keep the current step and dirty state when any operation fails. Clear the alert on the next edit or successful submission. Use `message: message.trim() || null` so Prisma clears the column.

- [ ] **Step 5: Run GREEN**

```powershell
npm.cmd run test:run -- __tests__/components/esigning-step-upload.test.tsx
npx.cmd eslint src/components/esigning/prepare/esigning-step-upload.tsx __tests__/components/esigning-step-upload.test.tsx
```

- [ ] **Step 6: Commit draft settings reliability**

```powershell
git add src/components/esigning/prepare/esigning-step-upload.tsx __tests__/components/esigning-step-upload.test.tsx
git commit -m "fix(esigning): persist cleared messages and upload errors"
```

---

### Task 10: Compensate a failed initial upload without hiding an orphan draft (ESIGN-09)

**Files:**
- Modify: `__tests__/components/esigning-list-actions.test.tsx`
- Modify: `src/components/esigning/esigning-list-page.tsx:350-405`

**Interfaces:**
- Consumes: existing `useDeleteEsigningEnvelope()` and `uploadEsigningDocumentRequest()`.
- Guarantees: only the exact envelope created by the current Start attempt can be deleted as compensation.

- [ ] **Step 1: Add upload compensation tests**

Test three cases:

1. create succeeds, upload fails, delete succeeds: delete receives the new ID and navigation does not occur;
2. create succeeds, upload fails, delete fails: navigate to the new draft so it is visible/recoverable and report both failures;
3. creation fails: delete is never called.

```tsx
expect(mocks.deleteEnvelope).toHaveBeenCalledWith('new-envelope-id');
expect(mocks.deleteEnvelope).not.toHaveBeenCalledWith(expect.not.stringMatching(/^new-envelope-id$/));
```

- [ ] **Step 2: Run RED**

```powershell
npm.cmd run test:run -- __tests__/components/esigning-list-actions.test.tsx -t "initial upload"
```

- [ ] **Step 3: Track the created draft and compensate only upload failures**

Keep `createdEnvelope` outside the `try`, and isolate the upload catch. If upload fails, await `deleteEnvelope.mutateAsync(createdEnvelope.id)`. If compensation also fails, navigate to the draft and show a recovery-specific message before navigation where supported; never delete a pre-existing or task-prepared envelope.

- [ ] **Step 4: Run GREEN**

```powershell
npm.cmd run test:run -- __tests__/components/esigning-list-actions.test.tsx
```

- [ ] **Step 5: Commit upload compensation**

```powershell
git add src/components/esigning/esigning-list-page.tsx __tests__/components/esigning-list-actions.test.tsx
git commit -m "fix(esigning): clean up failed initial uploads"
```

---

### Task 11: Apply company filtering on the server and return page-independent options (ESIGN-08)

**Files:**
- Create: `__tests__/services/esigning-envelope-list.test.ts`
- Modify: `__tests__/components/esigning-list-actions.test.tsx`
- Modify: `src/services/esigning-envelope.service.ts:302-473`
- Modify: `src/hooks/use-esigning.ts:20-75`
- Modify: `src/components/esigning/esigning-list-page.tsx:260-355, 660-705`
- Modify: `src/types/esigning.ts:10-55`

**Interfaces:**
- Produces: `EsigningCompanyFilterOptionDto { id: string; name: string; count: number }` and `companyOptions` on `EsigningListResult`.
- Consumes: the existing `companyId` query schema and URL parameter support.

- [ ] **Step 1: Add service/query regressions for three pages**

Mock server results where a selected company has matches only after the first unfiltered page. Assert `where.companyId` is applied before `count`, `skip`, and `take`; `total` is the filtered total; and company options are built from all matching envelopes, not returned page rows.

- [ ] **Step 2: Add a component query test**

Click a company option with ID `company-2` and assert the next `useEsigningEnvelopes` call contains `{ companyId: 'company-2', page: 1 }`. Assert rendering uses `data.envelopes` directly and pagination uses `data.total`.

- [ ] **Step 3: Run RED**

```powershell
npm.cmd run test:run -- __tests__/services/esigning-envelope-list.test.ts __tests__/components/esigning-list-actions.test.tsx -t "company"
```

- [ ] **Step 4: Refactor list where-clauses by purpose**

Build:

- `scopeWhere`: tenant, deletion, search, and creator scope;
- `resultWhere`: `scopeWhere` plus selected statuses and `companyId`;
- `statusCountWhere`: `scopeWhere` plus `companyId`, excluding selected status;
- `companyOptionWhere`: `scopeWhere` plus selected statuses, excluding `companyId`.

Group `companyOptionWhere` by `companyId`, fetch names for non-null IDs, and return sorted `{id, name, count}` values.

- [ ] **Step 5: Remove client-side page filtering**

Store the selected company ID, pass it into the query, reset page to 1 in the company-change handler, render returned options/counts, and remove `uniqueCompanies` plus `displayedEnvelopes`. Keep the current behavior that tab/search changes clear the company selection.

- [ ] **Step 6: Run GREEN**

```powershell
npm.cmd run test:run -- __tests__/services/esigning-envelope-list.test.ts __tests__/components/esigning-list-actions.test.tsx
npx.cmd eslint src/services/esigning-envelope.service.ts src/hooks/use-esigning.ts src/components/esigning/esigning-list-page.tsx
```

- [ ] **Step 7: Commit server-side filtering**

```powershell
git add src/services/esigning-envelope.service.ts src/hooks/use-esigning.ts src/components/esigning/esigning-list-page.tsx src/types/esigning.ts __tests__/services/esigning-envelope-list.test.ts __tests__/components/esigning-list-actions.test.tsx
git commit -m "fix(esigning): filter companies before pagination"
```

---

### Task 12: Reset wizard scroll/focus and make initial upload a real control (ESIGN-10, ESIGN-12)

**Files:**
- Modify: `__tests__/components/esigning-step-upload.test.tsx`
- Modify: `src/components/esigning/esigning-detail-page.tsx:735-840`
- Modify: `src/components/esigning/prepare/esigning-step-upload.tsx:630-690, 1015-1070`

**Interfaces:**
- Produces: `goToDraftStep(step: 1 | 2 | 3)` as the only wizard transition function.
- Produces: semantic step headings with stable IDs and a focusable initial upload button.

- [ ] **Step 1: Add the keyboard upload test**

Tab to `Upload documents`, press Enter, then Space, and assert the hidden input's `click()` is invoked. Assert the control has an accessible name, is disabled while uploading, and has `min-h-[44px]` on mobile.

- [ ] **Step 2: Run the upload test RED**

```powershell
npm.cmd run test:run -- __tests__/components/esigning-step-upload.test.tsx -t "keyboard upload"
```

- [ ] **Step 3: Replace the clickable div with a button**

Use `<button type="button" aria-describedby="esigning-upload-help">`, retain drag/drop handlers, and express text with spans. Keep the file input hidden and the post-upload `Add more` action, but ensure both actions have mobile 44 px targets.

- [ ] **Step 4: Centralize step transitions**

Add `wizardContentRef` and a `goToDraftStep` callback used by the step indicator, Next, and Back actions. After the new step commits, reset both the owning scroll container and `window` to the top, then focus the new step heading:

```tsx
requestAnimationFrame(() => {
  wizardContentRef.current?.scrollTo({ top: 0, left: 0 });
  window.scrollTo({ top: 0, left: 0 });
  document.getElementById(`esigning-step-${step}-heading`)?.focus();
});
```

Use semantic `<main>`/`<h1 tabIndex={-1}>` markup and visible focus-ring utilities.

- [ ] **Step 5: Run focused component tests**

```powershell
npm.cmd run test:run -- __tests__/components/esigning-step-upload.test.tsx
npx.cmd eslint src/components/esigning/esigning-detail-page.tsx src/components/esigning/prepare/esigning-step-upload.tsx
```

- [ ] **Step 6: Commit navigation/accessibility foundation**

```powershell
git add src/components/esigning/esigning-detail-page.tsx src/components/esigning/prepare/esigning-step-upload.tsx __tests__/components/esigning-step-upload.test.tsx
git commit -m "fix(esigning): reset wizard focus and expose upload control"
```

---

### Task 13: Use mobile overlays instead of desktop panel widths (ESIGN-11)

**Files:**
- Modify: `src/components/ui/modal.tsx:7-170`
- Modify: `src/components/esigning/prepare/esigning-step-fields.tsx:30-110, 500-700`
- Modify: `src/components/esigning/prepare/esigning-field-palette.tsx:15-95`

**Interfaces:**
- Produces: `ModalProps.placement?: 'center' | 'bottom'`, defaulting to `center`.
- Produces: `mobilePanel: 'palette' | 'details' | null` below 768 px.

- [ ] **Step 1: Add a reusable bottom-modal unit assertion to the browser suite scaffold**

Assert bottom placement retains `role="dialog"`, `aria-modal="true"`, focus trapping, Escape close, focus restoration, and body scroll lock. Center placement snapshots/classes remain unchanged.

- [ ] **Step 2: Add the mobile panel behavior test**

At 390 px, open `Field palette`, select `Signature`, assert the dialog closes automatically, the active placement type is visible in the canvas controls, and the canvas width does not change while the dialog is open or closed.

- [ ] **Step 3: Run RED in browser mode**

```powershell
npm.cmd run test:browser -- __tests__/browser/esigning-preparation.browser.test.tsx -t "field palette"
```

- [ ] **Step 4: Add bottom placement to the shared Modal**

Only the overlay alignment and content corners/max-height vary by placement. Reuse the existing portal, stack, focus trap, Escape handler, overlay click, and focus restoration; do not create a second dialog implementation.

- [ ] **Step 5: Branch mobile and desktop field layouts**

Below 768 px, render the canvas at full available width and expose two labelled 44 x 44 px controls: `Open field palette` and `Open field details`. Render palette/details in bottom modals with `max-h-[80vh]` and internal vertical scrolling. Do not render inline panel widths or resizers on mobile. At 768 px and above, retain the tablet/desktop panel rules.

- [ ] **Step 6: Auto-close after choosing a field type**

Wrap `onPlacementTypeSelect` so a non-null selection updates `activePlacementType` and sets `mobilePanel` to `null`. Keep recipient selection inside the same overlay and keep the reopen control visible.

- [ ] **Step 7: Run GREEN**

```powershell
npm.cmd run test:browser -- __tests__/browser/esigning-preparation.browser.test.tsx -t "field palette"
npx.cmd eslint src/components/ui/modal.tsx src/components/esigning/prepare/esigning-step-fields.tsx src/components/esigning/prepare/esigning-field-palette.tsx
```

- [ ] **Step 8: Commit the mobile field layout**

```powershell
git add src/components/ui/modal.tsx src/components/esigning/prepare/esigning-step-fields.tsx src/components/esigning/prepare/esigning-field-palette.tsx __tests__/browser/esigning-preparation.browser.test.tsx
git commit -m "fix(esigning): overlay field panels on mobile"
```

---

### Task 14: Scope field-canvas shortcuts to focused visible selections (ESIGN-13)

**Files:**
- Create: `__tests__/components/esigning-field-canvas.test.tsx`
- Modify: `src/components/esigning/prepare/esigning-field-canvas.tsx:407-450, 720-865, 995-1070`

**Interfaces:**
- Produces: `canvasOwnsKeyboard(): boolean` based on `containerRef.current.contains(document.activeElement)`.
- Guarantees: nudge/delete/copy/duplicate shortcuts act only on selected fields visible on the current document/page.

- [ ] **Step 1: Write keyboard ownership tests**

Dispatch `ArrowDown` from `document.body` with no selection and with an off-page selection; assert `defaultPrevented === false` and `onFieldsChange` is untouched. Focus the canvas, select a visible field, dispatch the key, and assert it is prevented and the field moves by `NUDGE_STEP`. Repeat for Shift+Arrow and Delete.

- [ ] **Step 2: Add document/page reconciliation tests**

Select a field on document 1/page 1, switch to document 2 or page 2, and assert both internal multi-selection and parent `selectedFieldId` clear. Returning to page 1 must not resurrect the old selection.

- [ ] **Step 3: Run RED**

```powershell
npm.cmd run test:run -- __tests__/components/esigning-field-canvas.test.tsx
```

- [ ] **Step 4: Guard all mutating shortcuts**

Before `preventDefault()`, require canvas focus and a visible selected field for arrow/delete/copy/duplicate. Paste requires canvas focus and a selected document but not an existing selection. Inputs, textareas, selects, and contenteditable elements remain ignored.

- [ ] **Step 5: Reconcile selection on visibility changes**

On `selectedDocumentId`, `viewerPage`, or `fieldsOnPage` change, filter internal IDs to visible fields. If the externally selected field is no longer visible, call `onFieldSelect(null)`. Keep the focusable canvas surface labelled for keyboard field editing.

- [ ] **Step 6: Run GREEN**

```powershell
npm.cmd run test:run -- __tests__/components/esigning-field-canvas.test.tsx __tests__/services/esigning-field-overlap.test.ts
npx.cmd eslint src/components/esigning/prepare/esigning-field-canvas.tsx __tests__/components/esigning-field-canvas.test.tsx
```

- [ ] **Step 7: Commit keyboard ownership**

```powershell
git add src/components/esigning/prepare/esigning-field-canvas.tsx __tests__/components/esigning-field-canvas.test.tsx
git commit -m "fix(esigning): scope canvas keyboard shortcuts"
```

---

### Task 15: Add the mobile and keyboard browser regression matrix (ESIGN-10 through ESIGN-13)

**Files:**
- Modify: `__tests__/browser/esigning-preparation.browser.test.tsx`

**Interfaces:**
- Consumes: the real Upload, Fields, palette, canvas, Modal, and centralized step transition behavior.
- Produces: screenshots and geometry assertions at 320, 390, and 768 px.

- [ ] **Step 1: Build a deterministic draft fixture**

Mock network/query hooks only. Render one PDF document, one signer, one CC, and enough Upload content to exceed 844 px. Stub the PDF viewer canvas with stable dimensions and the same `data-main-pdf-canvas`/`data-document-scroll-container` hooks used by production.

- [ ] **Step 2: Test scroll and focus at 390 x 844**

Scroll the owning container and window to the bottom, activate `Next: Place Fields`, and assert:

```ts
expect(window.scrollY).toBe(0);
expect(wizardMain.scrollTop).toBe(0);
await expect.element(screen.getByRole('heading', { name: 'Place fields' })).toHaveFocus();
```

Repeat Fields -> Review and indicator navigation.

- [ ] **Step 3: Test layout widths at 320, 390, and 768 px**

At 320/390, assert the palette is a dialog overlay and the document canvas retains at least viewport width minus the page's fixed padding; no inline 280 px panel or resizer exists. At 768, assert the tablet panel path is used and the central canvas retains at least `PANEL_MIN_CENTER_WIDTH`.

- [ ] **Step 4: Test keyboard-only operation**

Use Tab plus Enter/Space for the initial upload, Tab to open the mobile palette, choose a field, focus the canvas, place via Enter, and nudge with arrows. Then focus outside the canvas and prove ArrowDown scrolls normally and is not prevented.

- [ ] **Step 5: Assert accessibility and overflow invariants**

Check every mobile panel opener/closer is at least 44 x 44 px, all dialogs have names, focus is trapped/restored, and `document.documentElement.scrollWidth <= clientWidth`. Capture screenshots for 320, 390, and 768 widths.

- [ ] **Step 6: Run the complete browser file**

```powershell
npm.cmd run test:browser -- __tests__/browser/esigning-preparation.browser.test.tsx
```

Expected: all viewport, focus, keyboard, and overflow assertions pass with no relevant console errors.

- [ ] **Step 7: Commit regression coverage**

```powershell
git add __tests__/browser/esigning-preparation.browser.test.tsx
git commit -m "test(esigning): cover responsive preparation workflows"
```

---

### Task 16: Isolate and resolve the first-open hydration mismatch (OBS-01)

**Files:**
- Create after isolation: `__tests__/components/esigning-detail-hydration.test.tsx`
- Modify only after evidence: the exact E-signing component that produces the mismatched node
- Update: `docs/features/esigning/INVESTIGATIVE_ANALYSIS.md` under `OBS-01`

**Interfaces:**
- Produces: one captured development-mode server/client node diff and one permanent `hydrateRoot` regression using `onRecoverableError`.
- Constraint: no production code is changed until the mismatched component and values are captured.

- [ ] **Step 1: Reproduce in the development build**

Run the existing app in development, create a draft without sending it, open it from the E-signing list at desktop and 390 px, and capture the full React hydration message, component stack, first differing node, route, viewport, and whether the draft contains a document/recipient.

- [ ] **Step 2: Reduce the boundary without editing production behavior**

Render the route component with deterministic mocked session/query data. Bisect by replacing one child at a time—header/indicator, Upload, Fields, modals—until `renderToString()` plus `hydrateRoot()` identifies the smallest component that reproduces the same node diff. Remove diagnostic mocks once the boundary is known.

- [ ] **Step 3: Write the exact failing hydration regression**

```tsx
const serverHtml = renderToString(<IsolatedMismatchFixture />);
container.innerHTML = serverHtml;
const recoverableErrors: Error[] = [];
hydrateRoot(container, <IsolatedMismatchFixture />, {
  onRecoverableError: (error) => recoverableErrors.push(error as Error),
});
await waitFor(() => expect(recoverableErrors).toHaveLength(0));
```

Before the fix, assert the test fails with the same boundary/message seen in development, not merely any warning.

- [ ] **Step 4: Apply the smallest evidence-backed correction**

Make the server render and first client snapshot use the same value/branch. Client-only media, local storage, random IDs, locale time, or browser dimensions must update only after hydration through an effect or hydration-safe external-store snapshot. Do not suppress the warning and do not use `suppressHydrationWarning` unless the captured node is intentionally nondeterministic user content.

- [ ] **Step 5: Verify repeat opens and the permanent test**

Open five newly created drafts and five existing drafts at desktop and 390 px. Assert no hydration message, no overlay, and no visual regression. Run:

```powershell
npm.cmd run test:run -- __tests__/components/esigning-detail-hydration.test.tsx
```

- [ ] **Step 6: Record the evidence and outcome**

Update `OBS-01` with the exact component, differing server/client values, reproduction test, and fix. If ten development opens do not reproduce and the isolated hydration test stays clean, record the observation as non-reproducible with the tested matrix instead of making a speculative change.

- [ ] **Step 7: Commit the evidence-backed hydration result**

Stage the test, the single proven production boundary if changed, and the existing investigative report update. Use commit message `fix(esigning): stabilize draft hydration` when code changes, or `docs(esigning): record hydration isolation result` when the evidence closes without a code change.

---

### Task 17: Run integrated E-signing verification and close the report loop

**Files:**
- Update: `docs/features/esigning/INVESTIGATIVE_ANALYSIS.md`
- Review: every file changed by Tasks 1-16

**Interfaces:**
- Produces: a verification table beside each finding containing the implementing commit and focused test command.

- [ ] **Step 1: Run the focused unit/service suite**

```powershell
npm.cmd run test:run -- __tests__/components/esigning-sign-page.test.tsx __tests__/components/esigning-step-upload.test.tsx __tests__/components/esigning-list-actions.test.tsx __tests__/components/esigning-field-canvas.test.tsx __tests__/services/esigning-email-delivery.test.ts __tests__/services/esigning-completion-schema.test.ts __tests__/services/esigning-completion.service.test.ts __tests__/services/esigning-signing.service.test.ts __tests__/services/esigning-envelope-list.test.ts __tests__/services/esigning-field-overlap.test.ts __tests__/services/esigning-preparation-scheduler.test.ts __tests__/services/esigning-service-agreement-activation.test.ts
```

Expected: every selected test passes.

- [ ] **Step 2: Run the E-signing browser suite**

```powershell
npm.cmd run test:browser -- __tests__/browser/esigning-preparation.browser.test.tsx
```

Expected: 320/390/768 layout, scroll/focus, upload, palette, and arrow-key cases pass.

- [ ] **Step 3: Validate schema, lint, and types**

```powershell
npx.cmd prisma validate
npx.cmd eslint src/components/esigning src/services/esigning-completion.service.ts src/services/esigning-email-delivery.service.ts src/services/esigning-envelope.service.ts src/services/esigning-pdf.service.ts src/services/esigning-signing.service.ts src/hooks/use-esigning.ts src/lib/validations/esigning.ts src/lib/scheduler/tasks/esigning-pdf-generation.task.ts __tests__/components/esigning-sign-page.test.tsx __tests__/components/esigning-step-upload.test.tsx __tests__/components/esigning-list-actions.test.tsx __tests__/components/esigning-field-canvas.test.tsx __tests__/services/esigning-email-delivery.test.ts __tests__/services/esigning-completion-schema.test.ts __tests__/services/esigning-completion.service.test.ts __tests__/services/esigning-signing.service.test.ts __tests__/services/esigning-envelope-list.test.ts __tests__/browser/esigning-preparation.browser.test.tsx
npx.cmd tsc --noEmit --pretty false
```

Expected: Prisma and ESLint pass. TypeScript has no new E-signing diagnostics; separately identify the already documented `tmp/verify-renderer.ts` baseline if it remains.

- [ ] **Step 4: Perform a safe local workflow check**

With email mocked/disabled, create a draft, exercise Upload -> Fields -> Review at desktop and 390 px, clear/reload the message, simulate an upload failure, complete a test signing session, advance mocked completion stages, and verify CC/delivery/PDF states. Delete only the exact test draft afterward.

- [ ] **Step 5: Review migration and operational behavior**

Confirm the scheduler still registers ID `esigning-pdf-generation`, historical artifact-complete envelopes have no queued completion resend, stage queries are bounded/indexed, expired leases are reclaimable, successful jobs are ineligible, and retry actions select only failed work.

- [ ] **Step 6: Update the existing investigative report**

For ESIGN-01 through ESIGN-15, add `Resolved`, the implementing commit, and the focused regression name. For OBS-01, record Task 16's evidence and outcome. Do not create a separate status report.

- [ ] **Step 7: Review the final diff**

```powershell
git diff --check
git status --short
```

Inspect only E-signing, migration, generated Prisma, shared Modal, tests, and the two existing documentation paths. Confirm no unrelated worktree edits were staged or modified.

---

## Release and Rollback Notes

1. Deploy the migration before application workers begin using the delivery ledger.
2. Stop or drain the old E-signing PDF worker during the migration/application cutover so migration-created pending jobs cannot race the pre-ledger completion sender.
3. After deploy, inspect counts grouped by PDF, auto-file, and delivery status; a growing retryable backlog blocks rollout completion.
4. Rollback application code may read the retained legacy metadata, but it cannot understand the new ledger. Do not drop the new tables or columns during rollback; pause the completion worker and roll forward with a corrective release.
5. Historical delivery rows with `NOT_TRACKED` are intentionally honest. Do not bulk-mark them successful or send completion email without an explicit operational decision.

## Definition of Done

- Every confirmed finding maps to a passing focused regression and a product change.
- Consent failure never exposes signing fields.
- Untouched signature-only sessions issue no empty save, and placeholder instructions remain non-values.
- PDF, auto-file, and each completion email have independent durable terminal state and retry history.
- A successful delivery clears only its matching failure.
- Completed recipients see refreshed artifact/delivery state without reload; failed PDFs do not spin forever.
- CC recipients show copy delivery outcome rather than signer routing status.
- Cleared messages remain empty after reload; Upload errors are visible, focused, and handled.
- Failed first uploads do not leave invisible drafts.
- Company filters operate before pagination and return correct totals/options.
- Step transitions reset scroll/focus, mobile panels overlay the canvas, initial upload is keyboard operable, and arrow keys remain native outside a focused selection.
- OBS-01 has either an evidence-backed fix plus regression or a documented non-reproduction matrix with no speculative code change.
