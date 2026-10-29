# E-Signing Implementation Session Notes

> Purpose: preserve the working context for the e-signing implementation so follow-up work can continue without repeating broad repo exploration.
>
> Last updated: 2026-03-13 (UX overhaul pass)

## 1. Goal

Implement the Phase 1 e-signing module described in [2026-03-12-esigning-design.md](/c:/Users/WIVF/OneDrive/Documents/Python%20Project/oaktcloud%20staging/docs/plans/2026-03-12-esigning-design.md) inside the existing Next.js + Prisma app.

The user explicitly allowed upstream enhancement of reusable components where needed.

## 2. Repo / Stack Facts Already Confirmed

- App stack: Next.js 15 App Router, React 19, Prisma, TanStack Query, Chakra-based shared UI wrappers.
- PDF libraries already installed:
  - `pdf-lib`
  - `pdfjs-dist`
- Existing reusable pieces:
  - PDF viewer: [src/components/processing/document-page-viewer.tsx](/c:/Users/WIVF/OneDrive/Documents/Python%20Project/oaktcloud%20staging/src/components/processing/document-page-viewer.tsx)
  - Signature pad: [src/components/forms/signature-pad.tsx](/c:/Users/WIVF/OneDrive/Documents/Python%20Project/oaktcloud%20staging/src/components/forms/signature-pad.tsx)
  - Shared UI primitives in [src/components/ui](/c:/Users/WIVF/OneDrive/Documents/Python%20Project/oaktcloud%20staging/src/components/ui)
- Existing infrastructure already suitable for reuse:
  - Auth/session: [src/lib/auth.ts](/c:/Users/WIVF/OneDrive/Documents/Python%20Project/oaktcloud%20staging/src/lib/auth.ts)
  - RBAC: [src/lib/rbac.ts](/c:/Users/WIVF/OneDrive/Documents/Python%20Project/oaktcloud%20staging/src/lib/rbac.ts)
  - Rate limiting: [src/lib/rate-limit.ts](/c:/Users/WIVF/OneDrive/Documents/Python%20Project/oaktcloud%20staging/src/lib/rate-limit.ts)
  - Storage: [src/lib/storage/config.ts](/c:/Users/WIVF/OneDrive/Documents/Python%20Project/oaktcloud%20staging/src/lib/storage/config.ts)
  - Email: [src/lib/email.ts](/c:/Users/WIVF/OneDrive/Documents/Python%20Project/oaktcloud%20staging/src/lib/email.ts)
  - Scheduler: [src/lib/scheduler](/c:/Users/WIVF/OneDrive/Documents/Python%20Project/oaktcloud%20staging/src/lib/scheduler)

## 3. Design / UX Sources

- Approved design doc:
  - [docs/plans/2026-03-12-esigning-design.md](/c:/Users/WIVF/OneDrive/Documents/Python%20Project/oaktcloud%20staging/docs/plans/2026-03-12-esigning-design.md)
- Visual references:
  - [docs/features/esigning](/c:/Users/WIVF/OneDrive/Documents/Python%20Project/oaktcloud%20staging/docs/features/esigning)
  - Confirmed screenshot patterns:
    - sender setup / review flow
    - field placement canvas
    - signer consent + document navigator + sticky CTA

## 4. Work Already Completed

### 4.1 Prisma schema

New models were added to [prisma/schema.prisma](/c:/Users/WIVF/OneDrive/Documents/Python%20Project/oaktcloud%20staging/prisma/schema.prisma):

- `EsigningEnvelope`
- `EsigningEnvelopeDocument`
- `EsigningEnvelopeRecipient`
- `EsigningDocumentFieldDefinition`
- `EsigningDocumentFieldValue`
- `EsigningEnvelopeEvent`

New enums were added:

- `EsigningEnvelopeStatus`
- `EsigningSigningOrder`
- `EsigningPdfGenerationStatus`
- `EsigningRecipientType`
- `EsigningRecipientStatus`
- `EsigningRecipientAccessMode`
- `EsigningFieldType`
- `EsigningEnvelopeEventAction`

Relations added:

- `Tenant.esigningEnvelopes`
- `User.createdEsigningEnvelopes`
- `Company.esigningEnvelopes`

Prisma generation already ran successfully.

### 4.2 Shared infra / domain support

Implemented or updated:

- [src/lib/rbac.ts](/c:/Users/WIVF/OneDrive/Documents/Python%20Project/oaktcloud%20staging/src/lib/rbac.ts)
  - added `esigning` resource and role permissions
- [prisma/seed.ts](/c:/Users/WIVF/OneDrive/Documents/Python%20Project/oaktcloud%20staging/prisma/seed.ts)
  - seeded `esigning` resource + permission descriptions
- [src/lib/rate-limit.ts](/c:/Users/WIVF/OneDrive/Documents/Python%20Project/oaktcloud%20staging/src/lib/rate-limit.ts)
  - added e-signing public route rate-limit configs
- [src/lib/storage/config.ts](/c:/Users/WIVF/OneDrive/Documents/Python%20Project/oaktcloud%20staging/src/lib/storage/config.ts)
  - added e-signing storage key helpers
- [src/hooks/use-permissions.ts](/c:/Users/WIVF/OneDrive/Documents/Python%20Project/oaktcloud%20staging/src/hooks/use-permissions.ts)
  - added `createEsigning`, `readEsigning`, `updateEsigning`, `deleteEsigning`, `manageEsigning`
- [src/lib/esigning-session.ts](/c:/Users/WIVF/OneDrive/Documents/Python%20Project/oaktcloud%20staging/src/lib/esigning-session.ts)
  - link/session/challenge/download token helpers
  - cookie helpers
  - same-origin checker
- [src/lib/validations/esigning.ts](/c:/Users/WIVF/OneDrive/Documents/Python%20Project/oaktcloud%20staging/src/lib/validations/esigning.ts)
  - zod schemas and limits
- [src/types/esigning.ts](/c:/Users/WIVF/OneDrive/Documents/Python%20Project/oaktcloud%20staging/src/types/esigning.ts)
  - dashboard/session DTOs
- [src/types/index.ts](/c:/Users/WIVF/OneDrive/Documents/Python%20Project/oaktcloud%20staging/src/types/index.ts)
  - re-exported e-signing types

### 4.3 Service layer partials

Existing completed files:

- [src/services/esigning-envelope.lib.ts](/c:/Users/WIVF/OneDrive/Documents/Python%20Project/oaktcloud%20staging/src/services/esigning-envelope.lib.ts)
  - actor scope resolution
  - aggregate loading
  - envelope serialization
  - send-readiness validation
  - signing-order helpers
  - event creation helper
- [src/services/esigning-envelope.service.ts](/c:/Users/WIVF/OneDrive/Documents/Python%20Project/oaktcloud%20staging/src/services/esigning-envelope.service.ts)
  - currently implemented:
    - `listEsigningEnvelopes`
    - `getEsigningEnvelopeDetail`
    - `createEsigningEnvelope`
    - `updateDraftEsigningEnvelope`
    - `deleteDraftEsigningEnvelope`
- [src/services/esigning-field.service.ts](/c:/Users/WIVF/OneDrive/Documents/Python%20Project/oaktcloud%20staging/src/services/esigning-field.service.ts)
  - field definition save
  - signer field value save
- [src/services/esigning-notification.service.ts](/c:/Users/WIVF/OneDrive/Documents/Python%20Project/oaktcloud%20staging/src/services/esigning-notification.service.ts)
  - signing/completion/decline/failure emails
- [src/services/esigning-certificate.service.ts](/c:/Users/WIVF/OneDrive/Documents/Python%20Project/oaktcloud%20staging/src/services/esigning-certificate.service.ts)
  - certificate ID generation
  - verification lookup

### 4.4 Fixes already applied during this session

Applied after the initial scaffolding:

- Added page limits to [src/lib/validations/esigning.ts](/c:/Users/WIVF/OneDrive/Documents/Python%20Project/oaktcloud%20staging/src/lib/validations/esigning.ts)
  - `MAX_PAGES_PER_DOCUMENT`
  - `MAX_TOTAL_PAGES`
- Fixed `randomUUID` usage in:
  - [src/services/esigning-certificate.service.ts](/c:/Users/WIVF/OneDrive/Documents/Python%20Project/oaktcloud%20staging/src/services/esigning-certificate.service.ts)
  - [src/services/esigning-field.service.ts](/c:/Users/WIVF/OneDrive/Documents/Python%20Project/oaktcloud%20staging/src/services/esigning-field.service.ts)
- Improved field persistence semantics in [src/services/esigning-field.service.ts](/c:/Users/WIVF/OneDrive/Documents/Python%20Project/oaktcloud%20staging/src/services/esigning-field.service.ts)
  - optional external transaction support added
  - existing values/signature storage now preserved when a payload omits them
  - avoids accidental clearing during completion/finalization

### 4.5 UI surface now in place

New pages/components have been added:

- [src/app/(dashboard)/esigning/page.tsx](/c:/Users/WIVF/OneDrive/Documents/Python%20Project/oaktcloud%20staging/src/app/(dashboard)/esigning/page.tsx)
  - dashboard envelope list
  - create-envelope modal
- [src/app/(dashboard)/esigning/[id]/page.tsx](/c:/Users/WIVF/OneDrive/Documents/Python%20Project/oaktcloud%20staging/src/app/(dashboard)/esigning/[id]/page.tsx)
  - dashboard detail editor shell
- [src/app/esigning/sign/[token]/page.tsx](/c:/Users/WIVF/OneDrive/Documents/Python%20Project/oaktcloud%20staging/src/app/esigning/sign/[token]/page.tsx)
  - public signer experience
- [src/app/verify/[certificateId]/page.tsx](/c:/Users/WIVF/OneDrive/Documents/Python%20Project/oaktcloud%20staging/src/app/verify/[certificateId]/page.tsx)
  - public certificate verification page
- [src/components/esigning/esigning-list-page.tsx](/c:/Users/WIVF/OneDrive/Documents/Python%20Project/oaktcloud%20staging/src/components/esigning/esigning-list-page.tsx)
- [src/components/esigning/esigning-detail-page.tsx](/c:/Users/WIVF/OneDrive/Documents/Python%20Project/oaktcloud%20staging/src/components/esigning/esigning-detail-page.tsx)
- [src/components/esigning/esigning-sign-page.tsx](/c:/Users/WIVF/OneDrive/Documents/Python%20Project/oaktcloud%20staging/src/components/esigning/esigning-sign-page.tsx)
- [src/components/esigning/esigning-verify-page.tsx](/c:/Users/WIVF/OneDrive/Documents/Python%20Project/oaktcloud%20staging/src/components/esigning/esigning-verify-page.tsx)
- [src/components/esigning/esigning-shared.tsx](/c:/Users/WIVF/OneDrive/Documents/Python%20Project/oaktcloud%20staging/src/components/esigning/esigning-shared.tsx)
  - shared badge/label/format helpers

Sidebar wiring:

- [src/components/ui/sidebar.tsx](/c:/Users/WIVF/OneDrive/Documents/Python%20Project/oaktcloud%20staging/src/components/ui/sidebar.tsx)
  - added `E-Signing` navigation entry

Additional compile fixes made while landing the UI:

- [src/hooks/use-esigning.ts](/c:/Users/WIVF/OneDrive/Documents/Python%20Project/oaktcloud%20staging/src/hooks/use-esigning.ts)
  - fixed recursive list result typing
- PDF streaming routes now return `Uint8Array` bodies instead of raw `Buffer` for Next/TypeScript compatibility:
  - [src/app/api/esigning/envelopes/[id]/documents/[docId]/pdf/route.ts](/c:/Users/WIVF/OneDrive/Documents/Python%20Project/oaktcloud%20staging/src/app/api/esigning/envelopes/[id]/documents/[docId]/pdf/route.ts)
  - [src/app/api/esigning/envelopes/[id]/documents/[docId]/signed-pdf/route.ts](/c:/Users/WIVF/OneDrive/Documents/Python%20Project/oaktcloud%20staging/src/app/api/esigning/envelopes/[id]/documents/[docId]/signed-pdf/route.ts)
  - [src/app/api/esigning/sign/session/download/route.ts](/c:/Users/WIVF/OneDrive/Documents/Python%20Project/oaktcloud%20staging/src/app/api/esigning/sign/session/download/route.ts)

Verification status after these changes:

- `npx eslint src/components/esigning src/hooks/use-esigning.ts src/app/'(dashboard)'/esigning src/app/esigning src/app/verify ...` passed
- `npx tsc --noEmit --pretty false` now only fails on the pre-existing test-runner-global issue in `__tests__/lib/safe-math.test.ts`

### 4.6 UX overhaul (2026-03-13)

A full UI/UX and logic-flow overhaul was applied on top of the working functional layer. Plan at [docs/superpowers/plans/2026-03-13-esigning-ux-overhaul.md](/c:/Users/WIVF/OneDrive/Documents/Python%20Project/oaktcloud%20staging/docs/superpowers/plans/2026-03-13-esigning-ux-overhaul.md).

**`document-page-viewer.tsx`** enhanced with two backward-compatible optional props:
- `onHighlightClick?: (index, highlight) => void`
- `renderHighlightContent?: (highlight, pixelRect, index) => ReactNode`

SVG overlay updated: rects wrapped in `<g>`, conditional `onClick`/`pointerEvents`, `<foreignObject>` for custom overlay content.

**Signer experience** — `src/components/esigning/signing/`:
- `esigning-consent-screen.tsx` — full-page consent & disclosure screen before signing
- `esigning-signing-header.tsx` — sticky header with progress bar, sender info, and Other Options dropdown (Finish Later / Decline / Download / Session Info)
- `esigning-field-overlay.tsx` — interactive field chips rendered inside `<foreignObject>` on top of PDF pages; states: unfilled-required (pulse), unfilled-optional (dashed), active (ring), filled (green check)
- `esigning-post-it-tab.tsx` — fixed left-edge post-it bookmark tab with prev/next field arrows and "X of Y" counter
- `esigning-signature-modal.tsx` — "Adopt Your Signature" modal with Draw and Type tabs; apply-to-all checkbox; session-caches adopted signature/initials
- `esigning-completion-screen.tsx` — post-sign summary: CheckCircle hero, 3-step timeline, download / view certificate CTAs
- `esigning-decline-modal.tsx` — Decline reason modal with required textarea
- `esigning-sign-page.tsx` — fully rewritten orchestrator with `SigningFlowState` machine (`loading → requires-code → consent → signing → completed / declined / error`), `advanceToNextField()`, `handleFieldClick()`, autosave debounce, inline document tab bar

**Sender 3-step wizard** — `src/components/esigning/prepare/`:
- `esigning-step-indicator.tsx` — step progress indicator
- `esigning-recipient-card.tsx` — recipient row with signing order, access mode, status badge, and action buttons
- `esigning-step-upload.tsx` — Step 1: envelope settings + document upload + recipient management
- `esigning-field-palette.tsx` — field type palette (Signature, Initials, Date, Text, Checkbox)
- `esigning-field-canvas.tsx` — Step 2: transparent click overlay on top of PDF for click-to-place fields; ResizeObserver for normalized coordinate capture; selected field properties panel
- `esigning-step-fields.tsx` — Step 2 shell: document tab + field canvas + palette + field list
- `esigning-step-review.tsx` — Step 3: read-only summary of recipients, documents, fields per recipient, envelope settings, Send button
- `esigning-detail-page.tsx` — rewritten to use 3-step wizard for DRAFT envelopes; read-only view for sent/completed/voided

**List page** — `esigning-list-page.tsx`:
- filter tab bar: All · Needs Attention · Waiting · Completed · Voided/Expired (client-side, with live count badges)
- recipient chips now show status icons (CheckCircle2 signed, XCircle declined, Clock notified/viewed, Circle queued)
- last-activity line on each card

**Verification page** — `esigning-verify-page.tsx`:
- vertical audit timeline with connector lines and colored dots
- certificate-style header with monospace certificate ID
- document cards with green border for signed artifacts and copy-to-clipboard hash button
- drag-and-drop file upload zone; inline success/failure result panels

## 5. Current Status

### 5.1 What is working now

The current branch now has the main Phase 1 vertical slice in place:

- Prisma models/enums/relations are added
- RBAC, tenant handling, rate limits, storage keys, validation, DTOs, and session token helpers are added
- envelope lifecycle services are implemented, including recipient/document CRUD, send, resend, void, retry-processing, and next-queued activation
- signer session service is implemented
- signed PDF/certificate generation service is implemented
- authenticated and public API routes under `src/app/api/esigning` are implemented
- scheduler registration for PDF generation is implemented
- dashboard list/detail pages exist
- public signer page exists
- public verification page exists
- sidebar navigation entry exists

### 5.2 What remains incomplete or weak

The remaining gaps after the UX overhaul are Phase 1 background tasks and minor convenience routes:

- background automation is still incomplete beyond PDF generation
  - expiry processing task not added
  - reminder task not added
- there is still no authenticated combined envelope download route
  - per-document original/signed routes do exist

### 5.3 Known repo-level verification issue

- `npx tsc --noEmit --pretty false` still fails because of the pre-existing test environment issue in `__tests__/lib/safe-math.test.ts`
- after the latest fixes, there are no known TypeScript errors in the newly added e-signing app code itself

## 6. Concrete Implementation Decisions Already Made

These should be treated as the current working decisions unless a stronger repo constraint appears.

### 6.1 Tenant handling

- Authenticated e-signing routes should follow the app’s existing pattern:
  - normal users use `session.tenantId`
  - super admins can pass `tenantId` via query string

### 6.2 Storage / hashing

- Original upload storage key:
  - `StorageKeys.esigningOriginalDocument(tenantId, envelopeId, documentId, '.pdf')`
- Signed output storage key:
  - `StorageKeys.esigningSignedDocument(tenantId, envelopeId, documentId)`
- Signature asset storage key:
  - `StorageKeys.esigningSignatureAsset(...)`
- Current implementation direction uses existing project hash utilities (`hashBlake3`) for document hashes to stay consistent with the repo.

### 6.3 Send flow

At send time:

- validate draft readiness using helper logic in `esigning-envelope.lib.ts`
- enforce:
  - at least one document
  - at least one signer
  - each signer has fields
  - each signer has a signature/initials field
  - no duplicate signer emails
  - access code present for `EMAIL_WITH_CODE`
  - total size and total page limits
- set initial signer group to `NOTIFIED`
- keep future sequential/mixed signers `QUEUED`
- generate raw access tokens only for currently active recipients
- precreate `EsigningDocumentFieldValue` rows
- snapshot consent disclosure on envelope

### 6.4 Resend / correction behavior

- if recipient is active (`NOTIFIED` / `VIEWED`), regenerate token and resend or regenerate manual link
- if recipient is future queued signer, increment `sessionVersion`, clear `accessTokenHash`, but do not generate/send a token yet
- post-send correction is intended to be name/email focused

### 6.5 Completion behavior

- signer completion should be transaction-safe
- when the last signer completes:
  - mark envelope `COMPLETED`
  - set `completedAt`
  - queue PDF generation with `pdfGenerationStatus = PENDING`
- next sequential group activation should happen after current active group is fully signed

### 6.6 Public security model

- link token is only an entry credential
- interactive signing uses `esigning_session` cookie
- access-code flows use `esigning_challenge` cookie first, then upgrade to session cookie
- public state-changing routes should enforce same-origin checks
- public routes should use the new rate-limit configs already added in `src/lib/rate-limit.ts`

## 7. Files Most Likely To Be Touched Next

The UX overhaul is complete. Remaining work is background tasks and minor convenience routes:

- [src/lib/scheduler/tasks](/c:/Users/WIVF/OneDrive/Documents/Python%20Project/oaktcloud%20staging/src/lib/scheduler/tasks)
  - add expiry processing task
  - add reminder task
- [src/services/esigning-envelope.service.ts](/c:/Users/WIVF/OneDrive/Documents/Python%20Project/oaktcloud%20staging/src/services/esigning-envelope.service.ts)
  - add combined envelope download route if needed
- [src/services/esigning-pdf.service.ts](/c:/Users/WIVF/OneDrive/Documents/Python%20Project/oaktcloud%20staging/src/services/esigning-pdf.service.ts)
  - if certificate output or watermarking needs refinement

## 8. Recommended Build Order From Here

1. ~~Upgrade the dashboard detail page into a closer match for the reference sender flow.~~ ✅ Done
2. ~~Add a better field placement interaction model on top of the PDF viewer.~~ ✅ Done
3. ~~Improve the public signer experience with guided in-document signing.~~ ✅ Done
4. ~~Refine the verification/certificate presentation.~~ ✅ Done
5. Add reminder and expiry background scheduler tasks.
6. Add authenticated combined envelope download route if still needed.

## 9. Things To Avoid Re-Exploring

These are already known and do not need another broad scan unless something breaks:

- the design doc is the product source of truth
- the repo already has the required primitives for auth, rate limits, storage, scheduler, email, and tenant selection
- the Prisma schema and generated client already include the e-signing models/enums
- all UI components under `src/components/esigning/` are now fully built (signing/, prepare/, list, detail, verify)
- `document-page-viewer.tsx` now has `onHighlightClick` and `renderHighlightContent` props — no further modification needed for current use cases
- `signature-pad.tsx` is used inside `esigning-signature-modal.tsx` and does not need changes

## 10. Current Dirty-Tree Awareness

There are pre-existing dirty/untracked items in the repo, including:

- local design doc edits
- Prisma schema and generated client changes
- the new e-signing service/type/helper files

Do not revert unrelated user changes. Continue working with the current tree state.
