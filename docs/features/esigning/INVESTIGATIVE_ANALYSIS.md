# E-Signing Module Investigative Analysis

**Date:** 2026-08-11  
**Scope:** Envelope list, draft preparation, field placement, public signing, completion artifacts, email delivery, and responsive/accessibility behavior  
**Assessment type:** Read-only workflow and UI investigation; no product code was changed

## Executive summary

The E-signing module's happy-path tests pass, but several failure paths and cross-step state transitions are unsafe. The most serious issues are:

- a failed consent request still advances the recipient into signing;
- the completion screen stops refreshing and can show a permanent spinner or stale "waiting" state;
- PDF generation is marked complete before auto-filing and completion email delivery, so later work can be skipped permanently;
- a successful email batch clears unrelated, unresolved delivery failures;
- initial signer autosave can submit an invalid empty payload before the signer changes anything.

The preparation UI also has reproducible mobile, persistence, filtering, and keyboard defects. At 390 px, advancing from the bottom of Upload to Fields retained `window.scrollY = 990`, and expanding the fixed 280 px field palette left approximately 54 px for the document canvas. Clearing a previously saved email message and returning to the step restored the old text.

This report records 15 source-confirmed findings and one production-console observation that still needs isolation. No envelopes were sent and no external email was triggered during the investigation. The temporary draft used for reproduction was permanently deleted afterward.

## Severity scale

| Priority | Meaning |
| --- | --- |
| **P1 - High** | Can invalidate a signing control, suppress required delivery, strand a completed workflow, or materially misrepresent operational health. |
| **P2 - Medium** | Blocks or significantly degrades a supported workflow, creates misleading data/state, or prevents accessible operation. |
| **P3 - Low** | Noticeable friction or diagnostic noise with a practical workaround and limited immediate data risk. |

## Findings overview

| ID | Priority | Area | Finding |
| --- | --- | --- | --- |
| ESIGN-01 | P1 | Consent | A failed consent request still advances to the signing UI. |
| ESIGN-02 | P1 | Completion | Completion stops polling, so recipients can remain on stale or permanent terminal states. |
| ESIGN-03 | P1 | Artifacts/delivery | Artifact status becomes `COMPLETED` before auto-file and email work is durable. |
| ESIGN-04 | P1 | Email health | Any fully successful email batch clears all earlier delivery failures. |
| ESIGN-05 | P2 | Autosave | Entering the signing UI can immediately submit an invalid empty values array. |
| ESIGN-06 | P2 | Field values | Instructional placeholder text is treated as the signer's actual field value. |
| ESIGN-07 | P2 | Draft settings | A saved email message cannot be cleared. |
| ESIGN-08 | P2 | Envelope list | Company filtering applies only to the currently fetched page. |
| ESIGN-09 | P2 | Draft creation | A failed first upload leaves an orphaned empty draft. |
| ESIGN-10 | P2 | Mobile navigation | Wizard step changes retain the previous page's scroll position. |
| ESIGN-11 | P2 | Mobile field placement | Expanding the palette leaves almost no usable document canvas at phone widths. |
| ESIGN-12 | P2 | Accessibility | The initial upload drop zone cannot be operated from the keyboard. |
| ESIGN-13 | P2 | Keyboard behavior | Field-canvas shortcuts suppress arrow keys globally, even with no field selected. |
| ESIGN-14 | P2 | Recipient status | CC recipients remain displayed as `QUEUED` after a completed envelope. |
| ESIGN-15 | P2 | Error handling | Upload-step validation/server errors have no handled user-facing failure path. |
| OBS-01 | P3 | Hydration | Opening a new draft produced React hydration error `#418` in the production console. |

## Resolution status

| ID | Status | Implementing commit(s) | Focused regression |
| --- | --- | --- | --- |
| ESIGN-01 | Resolved | `8b8d1ab` | `EsigningSignPage consent` (consent failure matrix, 8 cases) |
| ESIGN-02 | Resolved | `0a457c8`, `25fc453` | `EsigningSignPage completion polling` (5 transitions) |
| ESIGN-03 | Resolved | `75542d5`, `13cecef`, `f57fbcb`, `0a457c8` | `esigning-completion.service.test.ts`, `esigning-signing.service.test.ts` (queue/worker/status) |
| ESIGN-04 | Resolved | `75542d5`, `f57fbcb` | `esigning-email-delivery.test.ts` (target isolation, 5 cases) |
| ESIGN-05 | Resolved | `8b8d1ab` | `EsigningSignPage autosave and field values` (untouched signature-only, in-flight edit) |
| ESIGN-06 | Resolved | `8b8d1ab` | `does not adopt a TEXT/TITLE placeholder as a value` |
| ESIGN-07 | Resolved | `b063287` | `sends null when a saved message is cleared` |
| ESIGN-08 | Resolved | `53d689a` | `esigning-envelope-list.test.ts` (3 service cases) + company filter query test |
| ESIGN-09 | Resolved | `f5d5402` | `EsigningListPage initial upload compensation` (3 cases) |
| ESIGN-10 | Resolved | `5394fbc`, `a692e84` | `E-signing preparation browser matrix` (scroll/focus transitions at 390 px) |
| ESIGN-11 | Resolved | `f9c20be`, `a692e84` | browser matrix (320/390 overlay vs 768 tablet panels) |
| ESIGN-12 | Resolved | `5394fbc`, `a692e84` | `is a keyboard-operable upload control...` + browser keyboard upload |
| ESIGN-13 | Resolved | `539ac94`, `a692e84` | `esigning-field-canvas.test.tsx` (6 cases) + browser arrow-key check |
| ESIGN-14 | Resolved | `75542d5`, `25fc453` | `CopyDeliveryStatusBadge` cases + list icon aria labels |
| ESIGN-15 | Resolved | `b063287` | `blocks ...` / `keeps the step mounted ...` upload-step failure cases |
| OBS-01 | Not reproduced (documented) | `cf69ca4` | `esigning-detail-hydration.test.tsx` (draft + completed detail, zero hydration errors) |

## Detailed findings

### ESIGN-01 - Failed consent still advances to signing

**Priority:** P1 - High  
**Confidence:** Confirmed from the client and server state transitions

**Evidence**

- [`recordConsent()` catches the request failure and does not rethrow it](../../../src/components/esigning/esigning-sign-page.tsx#L855). For network, cancelled, expired, and session-expired errors it also sets `flowState` to `error` and returns.
- [The consent callback always sets `flowState` to `signing` after awaiting that function](../../../src/components/esigning/esigning-sign-page.tsx#L1004), overwriting the error transition or advancing after a non-network error.
- [The server correctly refuses completion when `consentedAt` is absent](../../../src/services/esigning-signing.service.ts#L747), but [field-value saves do not require consent](../../../src/services/esigning-signing.service.ts#L727).

**Impact**

If consent recording fails, the recipient can enter the document, fill fields, and only discover at final completion that consent is required. Besides the broken workflow, the UI is no longer a reliable representation of whether the legal consent step succeeded.

**Recommendation**

Make `recordConsent()` return a success result or throw. Transition to `signing` only after a successful response. Keep the error state intact and provide an explicit retry action. Add a component test for every failed consent class.

### ESIGN-02 - Completion screen can remain stale forever

**Priority:** P1 - High  
**Confidence:** Confirmed from client lifecycle and render conditions

**Evidence**

- [Status polling runs only while `flowState === 'signing'`](../../../src/components/esigning/esigning-sign-page.tsx#L515).
- [Successful completion immediately changes the flow to `completed`](../../../src/components/esigning/esigning-sign-page.tsx#L822), which tears down that poller.
- [The completion component derives all state from a fixed session snapshot](../../../src/components/esigning/signing/esigning-completion-screen.tsx#L20) and contains no refresh logic.
- [Every non-`COMPLETED` PDF state, including `FAILED`, is rendered as "Preparing your signed document..."](../../../src/components/esigning/signing/esigning-completion-screen.tsx#L31).
- [The timeline claims all parties received a copy](../../../src/components/esigning/signing/esigning-completion-screen.tsx#L109) before email delivery has been proven.

**Impact**

- The final signer can see a spinner indefinitely after the artifact finishes in the background.
- An earlier signer who keeps the page open never learns that the remaining signers finished.
- A failed PDF job looks like an in-progress job forever, with no error or retry path.
- The UI can claim email delivery succeeded when it has not run or has failed.

**Recommendation**

Continue low-frequency polling in the completed view until both envelope and artifact states are terminal. Render `FAILED` separately with retry/help guidance. Drive copy-delivery language from an explicit delivery result, not envelope completion.

### ESIGN-03 - Artifact completion is recorded before downstream work is durable

**Priority:** P1 - High  
**Confidence:** Confirmed from job ordering and scheduler eligibility

**Evidence**

- [The PDF service sets `pdfGenerationStatus: 'COMPLETED'`](../../../src/services/esigning-pdf.service.ts#L917) before [company auto-filing](../../../src/services/esigning-pdf.service.ts#L927) and [completion email delivery](../../../src/services/esigning-pdf.service.ts#L932).
- [On-demand artifact repair calls generation with `sendNotifications: false`](../../../src/services/esigning-pdf.service.ts#L981), but the shared generator still sets the PDF status to `COMPLETED`.
- [Immediate generation returns early for a completed status](../../../src/services/esigning-pdf.service.ts#L1125).
- [The queue scheduler considers only `PENDING` or stale `PROCESSING` records](../../../src/services/esigning-pdf.service.ts#L1181), not completed records with unfinished notifications.

**Impact**

A process crash after the status update, or an on-demand download/repair racing the worker, can leave valid signed files while permanently suppressing auto-file and/or completion emails. The current single status cannot distinguish "artifact ready" from "delivery finished."

**Recommendation**

Model artifact generation, auto-file, and notification delivery as separate durable job states. Use an outbox/idempotency key for each recipient and sender delivery. Mark the overall workflow complete only after each required stage has reached a terminal state; retries should target only incomplete stages.

### ESIGN-04 - A later success clears unrelated email failures

**Priority:** P1 - High  
**Confidence:** Confirmed from metadata merge behavior

**Evidence**

- [When the current result batch has no failures, `applyEsigningEmailDeliveryResults()` overwrites delivery health with `status: 'ok'` and an empty failure list](../../../src/services/esigning-email-delivery.service.ts#L96).
- Existing failures are merged only when the new batch itself contains at least one failure.

**Impact**

A successful reminder, resend, or other email batch can remove the failure that records a different recipient never received the original request or completed package. List/detail warning badges can disappear while a real delivery problem remains unresolved.

**Recommendation**

Track delivery attempts by stable key such as `{kind, recipientId/address}`. Clear only the matching failure after a confirmed successful retry of that delivery. Preserve unrelated failures and retain an audit history rather than treating a batch as the health of the entire envelope.

### ESIGN-05 - Signing autosave submits an invalid empty array on entry

**Priority:** P2 - Medium  
**Confidence:** Confirmed from client effect and API schema

**Evidence**

- [`serializeValues()` returns only populated entries](../../../src/components/esigning/esigning-sign-page.tsx#L100), so a new signer with no prefilled date/value can produce `[]`.
- [The autosave effect schedules a save whenever the flow enters signing](../../../src/components/esigning/esigning-sign-page.tsx#L504); it has no dirty guard or empty-payload guard.
- [The API requires at least one value](../../../src/lib/validations/esigning.ts#L262).
- [Save failures render a warning with a retry action](../../../src/components/esigning/esigning-sign-page.tsx#L1113), making the untouched document appear broken immediately.

**Impact**

Envelopes that contain only an unfilled signature/initial field can issue a predictable 400 response and show a save warning before the signer changes anything. It creates false concern about whether progress is safe.

**Recommendation**

Do not autosave until a field has changed, and skip empty serialized payloads. Alternatively, make an empty save an intentional server-side no-op. Test the no-date, signature-only envelope.

### ESIGN-06 - Placeholder instructions become signed field data

**Priority:** P2 - Medium  
**Confidence:** Confirmed from value initialization

**Evidence**

- [The suggestion helper returns `field.placeholder` for every type other than Name, Company, and Date Signed](../../../src/components/esigning/esigning-sign-page.tsx#L133).
- [The input modal initializes its real value from that suggestion](../../../src/components/esigning/signing/esigning-field-input-modal.tsx#L69), and a non-empty value satisfies required-field validation.

**Impact**

Instructional text such as "Enter job title" can be saved as the recipient's response without them typing anything. This can make required fields appear complete and embed placeholder copy into the signed artifact.

**Recommendation**

Keep placeholder and default/prefill as separate concepts. Permit deliberate prefill only for supported auto-fill field types. A required Text or Title field should remain incomplete until the signer provides or explicitly confirms a value.

### ESIGN-07 - A saved draft email message cannot be cleared

**Priority:** P2 - Medium  
**Confidence:** Confirmed in the running UI and source

**Reproduction**

1. Save a non-empty Message on Upload and advance to Fields.
2. Return to Upload, erase the Message, and advance again.
3. Return to Upload. The previous message is restored.

**Root cause**

- [The client converts a cleared message to `undefined`](../../../src/components/esigning/prepare/esigning-step-upload.tsx#L596). JSON serialization omits the property.
- [The update service passes `input.message` directly to Prisma](../../../src/services/esigning-envelope/lifecycle.ts); an omitted/undefined property leaves the existing database value unchanged.

**Impact**

Senders can believe obsolete or sensitive text was removed when it will still be included in the signing request.

**Recommendation**

Send `message: null` when the input is cleared, allow null in the update contract, and add a persistence regression test covering non-empty to empty.

### ESIGN-08 - Company filter operates on only the current result page

**Priority:** P2 - Medium  
**Confidence:** Confirmed from query and pagination composition

**Evidence**

- [The server query receives search, status, page, and limit, but not company](../../../src/components/esigning/esigning-list-page.tsx#L282).
- [Company choices are built from the fetched page](../../../src/components/esigning/esigning-list-page.tsx#L327), and [filtering is performed client-side on that page](../../../src/components/esigning/esigning-list-page.tsx#L334).
- [Pagination still uses the unfiltered server total](../../../src/components/esigning/esigning-list-page.tsx#L353).

**Impact**

With more than one page of envelopes, companies not present on the current page disappear from the filter. A selected company can show a false empty state on one page while matches exist elsewhere, and the displayed total/page count remains wrong.

**Recommendation**

Filter by stable `companyId` in the server query and return filter options/counts independently of page contents. Reset the page when the company changes and calculate pagination from the filtered total.

### ESIGN-09 - Failed initial upload leaves an orphan draft

**Priority:** P2 - Medium  
**Confidence:** Confirmed from operation ordering

**Evidence**

- [The Start flow creates the envelope first](../../../src/components/esigning/esigning-list-page.tsx#L370), then uploads the selected file.
- If upload/conversion/storage fails, [the catch only shows a toast](../../../src/components/esigning/esigning-list-page.tsx#L385); it neither navigates to nor removes the newly created draft.

**Impact**

Transient upload or Word-conversion errors silently accumulate empty "New Envelope" drafts while the user remains on the list and may retry repeatedly.

**Recommendation**

Either upload into a temporary resource before creating the envelope, or compensate by deleting the exact newly created draft when the upload fails. If retention is intentional, navigate into the draft and clearly explain that it was saved without the file.

### ESIGN-10 - Wizard step changes retain the previous scroll position

**Priority:** P2 - Medium  
**Confidence:** Confirmed at 390 x 844 in the running UI

**Reproduction evidence**

- On the long Upload step, scroll to the bottom and press Next.
- Fields opens at `window.scrollY = 990`; the main region's top was `-990` relative to the viewport.
- The recipient/palette header and beginning of the document viewer are therefore skipped.

**Root cause**

[Step navigation only changes `currentStep`](../../../src/components/esigning/esigning-detail-page.tsx#L817); there is no window/main-container scroll reset for Upload -> Fields or Fields -> Review.

**Impact**

Mobile users appear to land in the middle of a different screen and can miss the primary instructions and controls. The issue is amplified by the long Upload form.

**Recommendation**

After each successful step transition, scroll the owning main container to the top and move focus to the new step heading. Cover this with a browser test at 390 px.

### ESIGN-11 - Expanded mobile field palette consumes the document canvas

**Priority:** P2 - Medium  
**Confidence:** Confirmed at 390 px in the running UI and from width calculations

**Evidence**

- [The palette has a fixed default width of 280 px](../../../src/components/esigning/prepare/esigning-step-fields.tsx#L38).
- [Mobile startup collapses both panels](../../../src/components/esigning/prepare/esigning-step-fields.tsx#L89), but [expanding the palette restores the same inline width](../../../src/components/esigning/prepare/esigning-step-fields.tsx#L527).
- At 390 px, the 280 px palette, 12 px separator, and 44 px collapsed details panel leave approximately 54 px for the central viewer.
- Selecting a field type does not auto-collapse the palette; it only calls `setActivePlacementType`.

**Impact**

The document is practically unviewable while choosing a field, forcing repeated manual collapse/expand cycles. This does not meet the design guideline that pages work seamlessly from 320 px and use mobile-specific layout patterns.

**Recommendation**

Use a mobile drawer/bottom sheet over the viewer, auto-close it after field selection, and keep a clearly labelled 44 x 44 px reopen control. Do not apply desktop resizable-panel widths below the tablet breakpoint.

### ESIGN-12 - Initial upload is not keyboard accessible

**Priority:** P2 - Medium  
**Confidence:** Confirmed from rendered semantics and source

**Evidence**

- [The upload target is a plain `div` with `onClick`](../../../src/components/esigning/prepare/esigning-step-upload.tsx#L1023). It has no `role`, `tabIndex`, accessible name, or Enter/Space handler.
- [The actual file input is hidden](../../../src/components/esigning/prepare/esigning-step-upload.tsx#L1056).
- The accessible UI snapshot exposed the drop-zone copy as paragraphs, not as an actionable control. "Add more" is available only after at least one document exists.

**Impact**

A keyboard-only user cannot perform the initial document upload, blocking the entire envelope workflow.

**Recommendation**

Use a visible `<label>` associated with the file input or a real Button that triggers it. Preserve drag/drop as an enhancement. Ensure a 44 px mobile target and test Tab plus Enter/Space operation.

### ESIGN-13 - Field canvas suppresses arrow keys globally

**Priority:** P2 - Medium  
**Confidence:** Confirmed from the global handler

**Evidence**

- [The editable field canvas installs a `window` keydown listener](../../../src/components/esigning/prepare/esigning-field-canvas.tsx#L770).
- [Every arrow-key branch calls `preventDefault()`](../../../src/components/esigning/prepare/esigning-field-canvas.tsx#L792) before trying to move fields.
- [The move function is a no-op when no field is selected](../../../src/components/esigning/prepare/esigning-field-canvas.tsx#L733).

**Impact**

While Fields is mounted, arrow keys cannot perform normal page scrolling/navigation outside form controls, even when the canvas has no active selection. This creates an unexpected page-wide keyboard trap and makes the mobile scroll-position defect harder to recover from for keyboard users.

**Recommendation**

Handle nudge keys only when the canvas owns focus and at least one visible field is selected. Do not prevent the default action otherwise. Clear or reconcile selection when document/page changes.

### ESIGN-14 - CC recipients remain `QUEUED` after completion

**Priority:** P2 - Medium  
**Confidence:** Confirmed in a completed local envelope and source

**Evidence**

- The completed envelope `F45B - Foundation Jewellers` displayed its CC recipient as `QUEUED` while the signer and envelope were complete.
- [When an envelope is sent, every non-active/non-signer recipient is assigned `QUEUED`](../../../src/services/esigning-envelope/delivery.ts).
- [Completion generation emails every recipient](../../../src/services/esigning-pdf.service.ts#L936), but it does not update a CC-specific delivery status.

**Impact**

Senders see a contradictory completed workflow with a permanently queued recipient and cannot tell whether the CC copy was sent or failed.

**Recommendation**

Give CC recipients explicit delivery states such as `PENDING_COPY`, `COPY_SENT`, and `COPY_FAILED`, or present email delivery health separately rather than reusing signer routing status.

### ESIGN-15 - Upload-step save/validation errors are not handled

**Priority:** P2 - Medium  
**Confidence:** Confirmed from the async event path

**Evidence**

- [`handleNext()` awaits settings and recipient-order updates without a `try/catch`](../../../src/components/esigning/prepare/esigning-step-upload.tsx#L596).
- [The click handler intentionally discards the returned promise](../../../src/components/esigning/prepare/esigning-step-upload.tsx#L1733).
- The local `canProceed` message covers only document and signer presence, so server-rejected title, reminder, expiry, or ordering values have no dedicated presentation here.

**Impact**

The user can remain on Upload with no actionable inline error while the browser records an unhandled rejection. Repeated Next clicks provide no clear indication of which setting must be corrected.

**Recommendation**

Catch update and reorder failures in the step, show a persistent alert/toast with the server message, and focus the invalid field where possible. Mirror server constraints in field-level validation before submission.

## Observation requiring follow-up

### OBS-01 - React hydration error on first draft open

**Priority:** P3 - Low pending isolation  
**Confidence:** Runtime symptom confirmed; exact render boundary not yet isolated

Opening the newly created draft in the production build logged minified React error `#418`, indicating the server-rendered and client-rendered trees did not match. The page recovered and no immediate visual crash was observed. The error did not recur on the completed-envelope detail checked in the same session.

Because the production bundle removes the useful component diff, this should be reproduced in a development build and traced to the first mismatched node before changing code. Candidate causes should not be accepted without that dev-build evidence.

**Isolation result (2026-08-11):** Not reproduced with deterministic data. A permanent
`renderToString` + `hydrateRoot` regression was added in
`__tests__/components/esigning-detail-hydration.test.tsx` covering both a newly opened draft
(DRAFT wizard, `EsigningDetailPage`) and a completed envelope detail. Both render identical
server/client trees with zero `onRecoverableError` hydration reports across the tested matrix
(mock-backed deterministic session/query data at desktop and 390 px). No product code was
changed speculatively; the observation remains open pending a development-build reproduction
that identifies the exact mismatched node.

## Verification performed

### Automated checks

- **Focused E-signing tests:** 12 test files, 42 tests passed.
- **Focused E-signing ESLint:** passed.
- **TypeScript:** `npx tsc --noEmit` was attempted but the repository-wide check is currently blocked by unrelated errors in `tmp/verify-renderer.ts`. Those errors are outside the E-signing scope and were not changed.

The passing suites cover preparation, upload, overlap detection, list actions, email calls, routes, task preparation, and agreement activation. Searches found no focused tests for the client failure paths described above, including consent failure, completion polling, empty autosave, mobile step scrolling, message clearing, company-filter pagination, or keyboard upload.

### Live workflow checks

- Exercised the E-signing list, a completed envelope detail, and a draft through Upload and Fields.
- Checked desktop behavior and a 390 x 844 mobile viewport.
- Confirmed scroll retention, palette width collapse, inaccessible initial upload semantics, and the message-clear persistence failure.
- Inspected browser console output on list, completed detail, and new draft.
- Did not send the draft, invoke recipient email delivery, or alter existing completed envelopes.
- Permanently deleted the exact temporary draft and its uploaded investigation document after reproduction.

## Follow-up: implementation review remediation (2026-08-11)

The [implementation review remediation plan](../../superpowers/plans/2026-08-11-esigning-implementation-review-remediation.md)
reviewed the 16 committed changes in `origin/main..HEAD` (`7359093..93d6cf6`) and found eight
follow-up findings, ESG-F01 through ESG-F08. All eight are resolved and verified:

| ID | Finding | Resolution |
|---|---|---|
| ESG-F01 | Completion deliveries were claimed by the scheduler and then rejected by a second per-row claim | One claim boundary: the scheduler claims eligible rows with a fresh `claimToken`; the processor never claims again and finalizes only while it owns the token. |
| ESG-F02 | Provider `ok: false` was persisted as `SUCCEEDED` | Delivery outcome now branches on the provider result; `ok: false` and thrown transport errors record a failed attempt, advance retry state, and leave `sentAt` unset. Only `ok: true` writes success. |
| ESG-F03 | Due times, prerequisites, and lease reclaim were inconsistent | Claim SQL now requires `status = COMPLETED` and `pdfGenerationStatus = COMPLETED`, honors `availableAt`/`autoFilingAvailableAt`, reclaims only expired `leaseExpiresAt`/`autoFilingLeaseExpiresAt` rows, and counts lost/skipped claims truthfully. |
| ESG-F04 | List/detail health ignored the delivery ledger and completion status used non-completion rows | List and detail now pass the real ledger snapshot; legacy failures are superseded only by a matching `{kind, normalized recipient}` ledger row; post-completion aggregation and retry capability consider `COMPLETION` rows only. |
| ESG-F05 | Terminal status was committed before the full session reload succeeded | A sticky pending-refresh flag keeps polling active; terminal status and the completion screen commit only after a successful session hydration, and a transient error is shown without clearing drafts. |
| ESG-F06 | The PDF viewer intercepted left/right keys globally and conflicted with field nudging | The viewer has an explicit `global`/`focused`/`disabled` shortcut scope, both owners honor `defaultPrevented`, the E-Signing canvas uses focused ownership, and the focusable field surface has a stable accessible label. |
| ESG-F07 | Retry UI/service allowed `esigning:update` but the route required `esigning:manage` | The route now requires `esigning:update` and resolves the tenant through `resolveWorkspaceId`, matching the other mutation routes while the service retains object/tenant authorization. |
| ESG-F08 | Field saves did not require stored consent | `saveEsigningSigningFieldValues()` rejects every save until `recipient.consentedAt` is stored, before any field-value write or signature asset mutation. |

### Verification record

- Focused unit/service/component regression set: 15 files, 119 tests passed.
- Browser preparation suite (Chromium): 10 tests passed, with the PDF thumbnail source stubbed and unexpected thumbnail console errors asserted absent.
- PostgreSQL concurrency suite: 7 tests passed against an isolated disposable database (migrations applied, database dropped afterward), covering single-claim overlap, token-guarded finalization, lease reclaim, future-dated retries, PDF-prerequisite gating, and one auto-file document/audit under overlap.
- `npx.cmd prisma validate`: passed.
- Targeted ESLint over every modified TypeScript/TSX file: passed.
- `npx.cmd tsc --noEmit --pretty false`: only the pre-existing `tmp/verify-renderer.ts` baseline errors remain (Service Agreement renderer verification types); no E-Signing diagnostic was emitted.
- `git diff --check`: passed.

The original investigation history above is preserved; this section is a dated follow-up and does not rewrite the earlier evidence.

## Recommended remediation order

1. **Protect signing integrity:** fix ESIGN-01 and ESIGN-06, then add consent/value regression tests.
2. **Make completion and delivery durable:** address ESIGN-02, ESIGN-03, ESIGN-04, and ESIGN-14 with separate artifact/delivery states and idempotent retries.
3. **Remove false errors and stale content:** fix ESIGN-05, ESIGN-07, ESIGN-09, and ESIGN-15.
4. **Repair mobile and accessible preparation:** fix ESIGN-10 through ESIGN-13 and add browser coverage at 390 px plus keyboard-only coverage.
5. **Correct queue filtering:** move ESIGN-08 to server-side company filtering.
6. **Isolate OBS-01:** reproduce in a development build and capture the exact hydration diff.

## Suggested regression coverage

- Consent endpoint returns network, 4xx, expired-session, and generic errors; the signing document must never open.
- Signature-only envelope enters signing without issuing an empty save request.
- Placeholder text never satisfies required Text/Title fields.
- Completion view transitions through PDF pending, completed, and failed states without reload.
- Artifact repair and queued generation race without suppressing completion delivery.
- Successful reminder does not clear a failed request/completion delivery for another recipient.
- Saved message transitions from non-empty to null and remains empty after reload.
- Company filter remains correct across at least three server pages.
- Initial upload failure leaves no invisible orphan or deliberately routes to a recoverable draft.
- Upload -> Fields and Fields -> Review reset scroll and focus at 390 px.
- Field palette is usable at 320, 390, and 768 px.
- Initial file upload is operable with Tab and Enter/Space.
- Arrow keys retain default page behavior unless a focused, visible field selection is being nudged.
- Completed CC recipients display an explicit delivery outcome.

## Refresh and draft preservation follow-up (2026-09-11)

Dashboard queries now refetch when a screen mounts and when the browser window regains focus,
while retaining cached data for responsive rendering. E-Signing admin lists also poll every 15
seconds, including empty and terminal-only lists, so newly created or progressing envelopes appear
without requiring a manual reload. Preparation and other admin forms keep local edits while a
refreshed query result arrives, then resynchronize after a save or when the form is clean.

This policy applies to React Query-backed screens. Pages that obtain data through manual fetches
still need their own refresh lifecycle when they should update on focus or return navigation.

### Client preview and review follow-up (2026-09-12)

The public signing page makes its decorative page overlay click-through so progress banners and
earlier signatures do not intercept signature-field clicks or start document panning. Authoring
overlays remain interactive. Public header, consent, and verification screens display the legacy
Oakcloud workspace name as Oaktree without changing stored names or signing evidence. Review & Send
labels the envelope name and signing method, and document badges show assigned field counts.

Signature progress banners are keyboard-accessible buttons that move to the next unfilled required
field, wrapping across documents. Once required fields are complete they become inactive; finishing
still requires the Finish action. E-signing previews omit the full-height page navigation bars while
retaining the toolbar and page thumbnails.

The Sign/Finish tab is positioned on the preview frame's right edge, rather than the browser edge.
Desktop document zoom advances in ten-percentage-point steps; mobile zoom retains one-percent steps.

Desktop zoom starts at 170%. The post-it protrudes from the frame with matching arrow widths; its
main action navigates to the active field's page, or opens that field when already on its page.
The Boxes toggle is hidden in e-signing previews while signing fields remain visible.

Saved signature previews are loaded from private storage by the authorized signing session and
returned as inline PNGs. Draft resumption and prior-signer previews therefore work with local
storage as well as S3, without depending on a public storage route or an expiring image URL.

- Completion email presentation: list document names without download/certificate links, omit verification CTA, certificate ID and verification footer, and append Oaktree Accounting & Corporate Solutions to the copyright line. Attachments remain supplied by the completion workflow. Plain text mirrors the simplified content.

- Declined and voided envelopes now expose the existing Delete action and are accepted by the deletion service, subject to existing ownership/delete permissions. Sent and in-progress envelopes remain protected.
