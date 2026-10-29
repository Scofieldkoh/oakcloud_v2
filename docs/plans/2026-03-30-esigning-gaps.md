# E-Signing Implementation Gap Analysis (Excluding Security)

## Context

The e-signing module is ~90% complete for Phase 1. The core signing flow works end-to-end: envelope creation, field placement, signing session, PDF generation, and verification. This analysis identifies every spec-vs-implementation gap excluding security concerns.

---

## 1. Missing Background Tasks (3 of 4 scheduler tasks not implemented)

Only `esigning-pdf-generation.task.ts` exists. Three tasks from spec section 11 are entirely missing:

| Task | Spec Schedule | Gap |
|------|--------------|-----|
| **esigning-expiry-check** | Hourly | Transition SENT/IN_PROGRESS envelopes past `expiresAt` to EXPIRED, notify sender, log EXPIRED event |
| **esigning-reminders** | Daily | Send auto-reminders using `reminderFrequencyDays`, `reminderStartDays`, `lastReminderAt` fields (fields exist in schema but are never read) |
| **esigning-cleanup** | Daily | Remove orphaned uploads from soft-deleted draft envelopes |

**Impact**: Envelopes never expire automatically. Reminders never send. Orphaned files accumulate.

---

## 2. Missing Email Templates (2 of 6)

[esigning-notification.service.ts](src/services/esigning-notification.service.ts) implements 4 of 6 email types:

| Email | Status | Notes |
|-------|--------|-------|
| Signing request | Done | `sendEsigningRequestEmail()` |
| Completion | Done | `sendEsigningCompletionEmail()` |
| Declined | Done | `sendEsigningDeclinedEmailToSender()` |
| PDF failure | Done | `sendEsigningPdfFailureEmailToSender()` |
| **Expiry warning** | **Missing** | Spec 8.5 -- warn sender X days before expiry |
| **Reminder** | **Missing** | Spec implies re-use of request template with reminder variant |

---

## 3. Missing Download Options (2 of 3)

Per-document download works. Spec section 4.6 requires two additional options:

| Option | Status |
|--------|--------|
| Download Individual (per-document signed PDF) | Done |
| **Download All (Combined)** | **Missing** -- single PDF concatenating all documents + certificates |
| **Download Certificates Only** | **Missing** -- just the certificate pages |

No route exists at `GET /api/esigning/envelopes/[id]/download` as specified in section 10.1.

---

## 4. Missing: Auto-File to Company Folder

Spec section 4.1: "Auto-file to company folder if enabled." The `companyId` field exists on the envelope schema, and the review step shows a company selector, but no code copies signed documents to `{tenantId}/companies/{companyId}/documents/...` after PDF generation completes.

---

## 5. Missing: Email Attachment Logic

Spec section 8.3: "Attachments: signed PDFs with certificates (if total < 20 MB; otherwise download link only)." Current completion emails send links only -- no attachment logic exists.

Current status (2026-09-11): completion delivery now appends the tenant-scoped certificate PDF to each signed PDF attachment when the combined payload is under the 20 MB limit; larger payloads retain the signed-document and certificate download links.

---

## 6. Missing: Duplicate Envelope

Spec section 5.2 row actions include "Duplicate." No `duplicateEnvelope()` function or API route exists. Neither the list page nor detail page expose this action.

---

## 7. Field Placement Canvas -- Major UX Gaps

[esigning-field-canvas.tsx](src/components/esigning/prepare/esigning-field-canvas.tsx) and [esigning-step-fields.tsx](src/components/esigning/prepare/esigning-step-fields.tsx) implement click-to-place but are missing most of the interactive editing features from spec section 2.1-2.2:

| Feature | Spec Section | Status |
|---------|-------------|--------|
| Drag-to-reposition placed fields | 2.2 step 8 | Missing |
| Resize handles on selected fields | 2.2 step 7 | Missing |
| Undo/redo stack | 2.1 toolbar | Missing |
| Snap guides | 2.1 center | Missing |
| Multi-select (Shift+click / selection box) | 2.1 center | Missing |
| Copy/paste (Ctrl+C/V) | 2.1 center | Missing |
| Duplicate (Ctrl+D) | 2.1 center | Missing |
| Keyboard nudging (arrow keys) | 2.1 center | Missing |
| Zoom controls (50%-150%, Fit Width) | 2.1 toolbar | Missing |
| Auto-pan when dragging near edges | 2.1 center | Missing |
| "Preview as signer" mode | 2.1 toolbar | Missing |
| Page thumbnails panel | 2.1 right panel | Missing |
| Ghost cursor during placement mode | 2.2 step 3 | Missing |
| Stay in placement mode for multiples | 2.2 step 5 | Missing |
| First-time coachmarks | 2.4 | Missing |

---

## 8. Signing Experience -- Missing Features

### Error States (Spec 3.12)
[esigning-sign-page.tsx](src/components/esigning/signing/esigning-sign-page.tsx) lacks handling for:
- Envelope voided mid-signing (should show "cancelled by sender" message)
- Envelope expired mid-session
- PDF load failure with retry
- Network error on field save with exponential backoff retry
- Session expired with "Resume Signing" button

### Navigation & Layout
- No page thumbnails/navigator panel (spec 3.4)
- No "Needs Action" / "Review Only" labels on document tabs
- No signer reassurance text ("Next required action: Sign on page 2")
- No footer bar with page count, zoom controls, autosave status
- No pinch-to-zoom or mobile landscape orientation prompt (spec 3.11)

### Signature Modal (Spec 3.7, 9)
[esigning-signature-modal.tsx](src/components/esigning/signing/esigning-signature-modal.tsx) is missing:
- Upload tab (marked Phase 2, but spec section 3.7 includes it)
- Undo last stroke in draw mode (only has "Clear")
- SVG export (only PNG)
- Touch/palm rejection, pressure sensitivity

---

## 9. Review Step -- Missing Configuration

[esigning-step-review.tsx](src/components/esigning/prepare/esigning-step-review.tsx) shows title/message/company/expiration but is missing:
- Reminder frequency setting (`reminderFrequencyDays`)
- Reminder start delay (`reminderStartDays`)
- Expiry warning days (`expiryWarningDays`)
- "Preview as signer" per-recipient preview
- Signed artifact preview (what final PDF will look like)
- Auto-file toggle

---

## 10. Dashboard -- Minor Gaps

### Detail Page ([esigning-detail-page.tsx](src/components/esigning/esigning-detail-page.tsx))
- Activity timeline has no collapse/expand for older events
- No "Download All (Combined)" or "Certificates Only" buttons
- No explicit retry banner for `pdfGenerationStatus = FAILED`

### List Page ([esigning-list-page.tsx](src/components/esigning/esigning-list-page.tsx))
- No "Duplicate" row action
- No retry affordance for failed processing rows

---

## 11. Audit Logging -- Incomplete Coverage

Spec section 1.6 requires dual audit logging (EnvelopeEvent + AuditLog). `createAuditLog()` is called for send operations but appears missing for: void, delete, correction, and retry-processing actions.

---

## 12. PDF Generation Note

Spec says schedule is every 30 seconds; implementation runs every 1 minute (`*/1 * * * *`). Minor discrepancy.

---

## 13. Stale Field Layout on Send (Bug)

The draft sender flow can send stale field layouts. Step 2 keeps field edits only in local `fieldDrafts`, but Step 3 sends the envelope without persisting them first. The review screen validates against the server copy (`envelope.recipients[*].fieldsAssigned`), not the current local layout. The review can show "ready" or "not ready" based on outdated data, and Send can go out with the wrong field set.

- [esigning-detail-page.tsx:294](src/components/esigning/esigning-detail-page.tsx#L294) -- field drafts state
- [esigning-detail-page.tsx:626](src/components/esigning/esigning-detail-page.tsx#L626) -- send without flush
- [esigning-step-review.tsx:35](src/components/esigning/prepare/esigning-step-review.tsx#L35), [:82](src/components/esigning/prepare/esigning-step-review.tsx#L82) -- validates server copy

---

## 14. Text-Style Signer Fields Not Implemented End-to-End (Bug)

In the signer page, field clicks only handle SIGNATURE, INITIALS, CHECKBOX, and DATE_SIGNED. TEXT, NAME, COMPANY, and TITLE are explicitly left as no-op. The completion helper only backfills NAME, COMPANY, and DATE_SIGNED, so a required TEXT or TITLE field blocks completion entirely with no way for the signer to fill it.

- [esigning-sign-page.tsx:295](src/components/esigning/signing/esigning-sign-page.tsx#L295) -- no-op for text fields
- [esigning-signing.service.ts:239](src/services/esigning-signing.service.ts#L239) -- backfill logic

---

## 15. Header CTA Does Not Advance Through Fields

The signer header's primary CTA shows "Continue" but is disabled whenever `canFinish` is false. It cannot advance the user through remaining fields -- it only works as a "Finish" button. The guided "Continue" behavior described in the spec (scroll to next required field) is not wired up.

- [esigning-signing-header.tsx:157](src/components/esigning/signing/esigning-signing-header.tsx#L157)

---

## 16. Parallel Completion Missing Atomic Guard (Bug)

The completion flow marks the recipient signed, counts remaining signers, then updates the envelope to COMPLETED by id only. There is no compare-and-set on current envelope status (`WHERE status = 'IN_PROGRESS'`), so simultaneous last-signers can race and produce duplicate completion triggers or inconsistent state.

- [esigning-signing.service.ts:509](src/services/esigning-signing.service.ts#L509)

---

## 17. Field Overlap Warning Not Implemented

The spec requires a bounding-box intersection check with a dismissable warning when fields overlap. No overlap detection logic exists in the save path or the canvas UI.

- [esigning-field.service.ts:52](src/services/esigning-field.service.ts#L52)
- [esigning-envelope.lib.ts:407](src/services/esigning-envelope.lib.ts#L407)

---

## 18. Completion Email Missing Document Links/Attachments

The completion email only sends a certificate verification link. It does not include signed document download links or attachments, leaving the post-sign delivery short of a "completed package" experience per spec section 8.3.

Current status (2026-09-11): completion emails include per-document signed and certificate links and attach each signed document with its certificate appended when the attachment size limit allows.

- [esigning-notification.service.ts:56](src/services/esigning-notification.service.ts#L56)

---

## 19. Signature Resume UX Broken

Persisted field values carry `signatureStoragePath`, but the client rebuilds draft state with `signatureDataUrl: null`. The field overlay only renders signature images from `signatureDataUrl`, not from the storage path. Reopened sessions cannot rehydrate previously signed/initialed fields visually -- they appear blank.

- [esigning-sign-page.tsx:44](src/components/esigning/signing/esigning-sign-page.tsx#L44) -- null initialization
- [esigning-field-overlay.tsx:93](src/components/esigning/signing/esigning-field-overlay.tsx#L93) -- renders from dataUrl only

---

## 20. Delete Envelope Has No UI

The delete draft API and hook (`useDeleteEsigningEnvelope`) work, and `canDelete` is computed on the detail page, but no button or menu item is wired to it anywhere -- not on the detail page, not on the list page. Users cannot delete draft envelopes without hitting the API directly.

---

## 21. Void Envelope Does Not Notify Signers

Voiding works end-to-end in the UI (detail page button with confirmation dialog), but the void operation sends no email to affected signers. They only discover the envelope was cancelled if they revisit the signing link. The spec section 3.12 describes a "This envelope has been cancelled by the sender" screen, but there is also no active polling or push mechanism to surface a void during an open signing session.

---

## 22. Sequential Order Toggle Does Nothing (Bug)

The "Sequential signing order" checkbox in Step 1 ([esigning-step-upload.tsx:342](src/components/esigning/prepare/esigning-step-upload.tsx#L342)) only updates local `sequentialOrder` state. It never calls the update envelope mutation to set `envelope.signingOrder`. The toggle is purely cosmetic -- the envelope always stays on whatever signing order it was created with.

---

## 23. List Page Has No Pagination

[esigning-list-page.tsx:51](src/components/esigning/esigning-list-page.tsx#L51) fetches page 1 with `limit: 200` hardcoded. No pagination controls exist. Envelopes beyond 200 are invisible. Filtering is also done entirely client-side -- all statuses fetched, then filtered in `useMemo`.

---

## 24. List Page Has No Row Actions

Envelope rows on the list page are plain links -- click goes to detail. No dropdown menu, context menu, or action buttons exist for resend, void, duplicate, or delete. Users must navigate into every envelope to take action.

- [esigning-list-page.tsx:216](src/components/esigning/esigning-list-page.tsx#L216)

---

## 25. No Real-Time or Polling Refresh on Dashboard

Both list and detail queries use only `staleTime` (30s list, 15s detail) with no `refetchInterval`. Status transitions (SENT -> IN_PROGRESS -> COMPLETED) don't surface until the user manually navigates away and back or refreshes the page.

- [use-esigning.ts:322](src/hooks/use-esigning.ts#L322) -- list staleTime: 30_000
- [use-esigning.ts:333](src/hooks/use-esigning.ts#L333) -- detail staleTime: 15_000

---

## 26. Recipient Edit Hardcoded to Disabled in Read-Only View

In the detail page's read-only recipient cards, `canEdit` is hardcoded to `false` ([esigning-detail-page.tsx:759](src/components/esigning/esigning-detail-page.tsx#L759)). The spec allows name/email correction for SENT/IN_PROGRESS envelopes (and the API supports it), but the UI makes it impossible -- the edit icon never appears outside DRAFT mode.

---

## 27. Auto-Save Can Race With Completion (Data Loss Risk)

The signing page debounces field saves at 500ms ([esigning-sign-page.tsx:240](src/components/esigning/signing/esigning-sign-page.tsx#L240)). If the signer fills the last field and clicks Finish before the debounce fires, the final field values may not be persisted. There's no flush-before-complete guard -- `saveProgress()` and the completion handler are independent code paths with no coordination.

---

## 28. DATE_SIGNED Field Hardcoded to Today, Not Editable

When a signer clicks a DATE_SIGNED field, it auto-fills with `new Date().toLocaleDateString()` ([esigning-sign-page.tsx:315](src/components/esigning/signing/esigning-sign-page.tsx#L315)). The signer cannot review, change, or clear the date. If the signing session spans midnight or the signer is in a different timezone, the date could be wrong.

---

## 29. Field Overlay Lacks Keyboard Interaction

Field overlay chips use `onClick` with `role="button"` but have no `onKeyDown` handler ([esigning-field-overlay.tsx:145](src/components/esigning/signing/esigning-field-overlay.tsx#L145)). Keyboard users can Tab to fields but Enter/Space won't trigger the action. Pulse animation on required fields also doesn't respect `prefers-reduced-motion`.

---

## 30. Signature Modal Font Selection Not Implemented

The Type tab in the signature modal renders typed text using a single hardcoded font (`'italic 48px cursive'` in [esigning-signature-modal.tsx:28](src/components/esigning/signing/esigning-signature-modal.tsx#L28)). The spec (section 3.7) requires 3 font choices (Dancing Script, Pinyon Script, Caveat) with a style selector. No font selection UI exists.

---

## 31. "Finish Later" Has No Save Confirmation

Clicking "Finish Later" in the Other Options menu calls `void saveProgress()` silently ([esigning-sign-page.tsx:583](src/components/esigning/signing/esigning-sign-page.tsx#L583)). No toast, no modal, no feedback that progress was saved. The signer has no confirmation they can safely close the page.

---

## 32. Form State Resets on Envelope Refetch

Step 1 initializes form fields from the envelope via `useEffect` ([esigning-step-upload.tsx:206](src/components/esigning/prepare/esigning-step-upload.tsx#L206)). If a background refetch occurs (e.g., another mutation invalidates the cache), the effect re-runs and overwrites any in-progress edits to title, message, or expiration. No dirty-state tracking prevents this.

---

## 33. Access Code Minimum Length Not Validated Client-Side

When adding a recipient with EMAIL_WITH_CODE access mode, the UI shows a hint "at least 4 characters" but `handleConfirmNewRecipient` ([esigning-step-upload.tsx:255](src/components/esigning/prepare/esigning-step-upload.tsx#L255)) doesn't enforce minimum length. An empty or 1-char code is submitted to the backend, which rejects it -- but the user gets no inline validation error.

---

## 34. Self-Sign Has No Duplicate Email Check

The "I'm signing this document" shortcut ([esigning-step-upload.tsx:268](src/components/esigning/prepare/esigning-step-upload.tsx#L268)) adds the current user as a signer without checking if they're already a recipient. This can create duplicate signer entries that the backend rejects at send time.

---

## 35. Canvas Click Target Not Keyboard Accessible

The field placement canvas uses a `<div>` with `onClick` for placing fields ([esigning-field-canvas.tsx:226](src/components/esigning/prepare/esigning-field-canvas.tsx#L226)). No `role`, `tabIndex`, or keyboard handler is attached. The entire Step 2 field placement workflow is mouse-only.

---

## 36. Completion Screen Missing Expiry/Deadline Info for Sequential Envelopes

When a signer completes their part of a sequential envelope, the completion screen shows "Your part is complete" but doesn't mention when the envelope expires or how many signers remain ([esigning-completion-screen.tsx:97](src/components/esigning/signing/esigning-completion-screen.tsx#L97)). The signer has no way to know if the overall process is at risk of expiring.

---

## Priority Summary

**P0 -- Bugs and broken flows:**
1. Stale field layout on send -- Step 3 doesn't flush local field drafts before sending (#13)
2. Text-style fields not implemented end-to-end -- TEXT/TITLE block completion with no input (#14)
3. Parallel completion missing atomic guard -- race condition on simultaneous last-signers (#16)
4. Signature resume broken -- reopened sessions show blank signatures (#19)
5. Sequential order toggle does nothing -- checkbox is cosmetic only (#22)
6. Auto-save can race with completion -- last field values may be lost (#27)
7. Form state resets on envelope refetch -- overwrites in-progress edits (#32)
8. Self-sign shortcut has no duplicate email check (#34)

**P1 -- Blocks core workflows:**
9. Expiry check task (envelopes never expire) (#1)
10. Reminder task (reminders never send) (#1)
11. Reminder/expiry email templates (#2)
12. Reminder configuration UI (fields exist but can't be set) (#9)
13. Header CTA doesn't advance through fields (#15)
14. Completion email missing document links/attachments (#18)
15. Recipient edit hardcoded to disabled in read-only view -- can't correct after send (#26)
16. List page has no pagination -- envelopes beyond 200 invisible (#23)

**P2 -- Missing expected functionality:**
17. Field drag-to-reposition and resize (#7, #17)
18. Undo/redo for field placement (#7)
19. Field overlap warning (#17)
20. Download All (Combined) and Certificates Only (#3)
21. Auto-file to company folder (#4)
22. Signing error states (voided/expired/network) (#8)
23. Duplicate envelope action (#6)
24. Delete draft envelope UI -- no button wired despite working API (#20)
25. Void envelope signer notification -- no email sent, no mid-session alert (#21)
26. List page row actions missing -- no resend/void/delete from list (#24)
27. No real-time or polling refresh on dashboard (#25)
28. DATE_SIGNED hardcoded to today, not editable (#28)
29. Signature modal font selection not implemented (#30)

**P3 -- UX polish (spec completeness):**
30. Snap guides, multi-select, copy/paste, keyboard nudging (#7)
31. Zoom controls in preparation view (#7)
32. Page thumbnails panel (#7)
33. Ghost cursor and persistent placement mode (#7)
34. Preview as signer (#9)
35. Coachmarks (#7)
36. Email attachment logic < 20MB (#5)
37. Cleanup task (#1)
38. Signature pad upgrades (undo stroke, SVG, upload tab) (#8)
39. Mobile signing enhancements (#8)
40. Audit log coverage for all operations (#11)
41. Activity timeline collapse/expand (#10)
42. Field overlay lacks keyboard interaction (#29)
43. Canvas click target not keyboard accessible (#35)
44. "Finish Later" has no save confirmation (#31)
45. Access code minimum length not validated client-side (#33)
46. Completion screen missing expiry info for sequential envelopes (#36)
