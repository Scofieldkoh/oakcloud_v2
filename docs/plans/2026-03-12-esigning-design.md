# E-Signing Module Design

> **Created**: 2026-03-12
> **Status**: Approved
> **Phase**: 1 — Core E-Signing (Templates & Agreement Management planned for later phases)

## Overview

A standalone e-signing module for Oakcloud, enabling accounting firms to send documents to external clients for electronic signature. Inspired by DocuSign's envelope system and workflow, with Dropbox Sign's cleaner certificate design.

### Key Decisions

- **Standalone module** — documents are uploaded directly into the e-signing workflow, not coupled to Generated Documents
- **Envelope model** — multiple documents packaged into a single envelope with one link/email per signer
- **Client-side PDF rendering** — pdf.js (via react-pdf) with React overlay for field placement and signing
- **Coordinate-based field positioning** — percentage-based coordinates stored in DB, decoupled from rendering
- **Per-document certificates** — Dropbox Sign-style visual timeline appended to each signed PDF
- **Certificate ID watermark** — stamped on every page of every document
- **Field definition/value split** — placement schema (immutable after send) separate from signer-entered values
- **Cookie-based signing sessions** — link token mints short-lived HttpOnly browser sessions (plus a pre-auth challenge cookie for access-code flows); raw tokens never stored
- **Document hash chain** — SHA-256 hashes of original and signed PDFs stored for tamper verification
- **DB-backed completion queue** — uses existing Oakcloud status-column queue pattern, not a separate job system

---

## 1. Data Model

### 1.1 Envelope

The top-level transaction entity.

| Field | Type | Purpose |
|-------|------|---------|
| id | UUID | Primary key |
| tenantId | UUID | Multi-tenancy |
| createdById | UUID | Sender (FK to User) |
| title | String | Envelope name (defaults to first document name) |
| message | Text? | Message to all recipients |
| status | Enum | DRAFT, SENT, IN_PROGRESS, COMPLETED, VOIDED, DECLINED, EXPIRED |
| signingOrder | Enum | PARALLEL, SEQUENTIAL, MIXED |
| expiresAt | DateTime? | When the envelope expires |
| reminderFrequencyDays | Int? | Days between auto-reminders |
| reminderStartDays | Int? | Days after send before first reminder |
| expiryWarningDays | Int? | Days before expiry to warn sender |
| companyId | UUID? | Optional FK to Company for auto-filing signed docs |
| certificateId | String | Unique ID stamped on every page (format: `OAK-ES-YYYYMMDD-XXXXXXXX-XXXX`) |
| completedAt | DateTime? | When all signers finished |
| voidedAt | DateTime? | When voided |
| voidReason | Text? | Why it was voided |
| pdfGenerationStatus | Enum? | PENDING, PROCESSING, COMPLETED, FAILED (null while not yet completed) |
| pdfGenerationAttempts | Int | Retry count for failed generation (default 0) |
| pdfGenerationClaimedAt | DateTime? | When the queue worker last claimed this envelope for processing |
| pdfGenerationError | Text? | Error details on failure |
| consentVersion | String | Version of consent/disclosure text used (e.g., `1.0`) |
| consentDisclosureSnapshot | JSONB | Immutable snapshot of disclosure title/body/locale/privacy wording shown to signers |
| metadata | JSONB | Extensible data |
| createdAt | DateTime | Created timestamp |
| updatedAt | DateTime | Last modified |
| deletedAt | DateTime? | Soft delete |

### 1.2 EnvelopeDocument

| Field | Type | Purpose |
|-------|------|---------|
| id | UUID | Primary key |
| tenantId | UUID | Multi-tenancy (denormalized for direct query filtering) |
| envelopeId | UUID | FK to Envelope |
| fileName | String | Original file name |
| storagePath | String | MinIO/S3 path to original PDF |
| signedStoragePath | String? | Path to final signed PDF (populated after completion) |
| originalHash | String | SHA-256 hash of original uploaded PDF |
| signedHash | String? | SHA-256 hash of final signed PDF (populated after completion) |
| pageCount | Int | Number of pages |
| sortOrder | Int | Display order within envelope |
| fileSize | Int | File size in bytes |
| createdAt | DateTime | Created timestamp |
| updatedAt | DateTime | Last modified |

### 1.3 DocumentFieldDefinition

Immutable field placement schema — defines where fields go on the document. Locked after the envelope is sent. This separation from values enables template reuse in future phases and ensures the evidence record of what was asked of the signer is independent of what they entered.

| Field | Type | Purpose |
|-------|------|---------|
| id | UUID | Primary key |
| tenantId | UUID | Multi-tenancy (denormalized) |
| envelopeId | UUID | FK to Envelope (denormalized for direct queries) |
| documentId | UUID | FK to EnvelopeDocument |
| recipientId | UUID | FK to EnvelopeRecipient (who fills this field) |
| type | Enum | SIGNATURE, INITIALS, DATE_SIGNED, NAME, TEXT, CHECKBOX, COMPANY, TITLE |
| pageNumber | Int | Which page (1-indexed) |
| xPercent | Float | X position as % of page width (0-100) |
| yPercent | Float | Y position as % of page height (0-100) |
| widthPercent | Float | Width as % of page width |
| heightPercent | Float | Height as % of page height |
| required | Boolean | Must be filled before signing |
| label | String? | Optional label shown to signer |
| placeholder | String? | Placeholder text for text fields |
| sortOrder | Int | Tab order for guided signing navigation |
| createdAt | DateTime | Created timestamp |
| updatedAt | DateTime | Last modified |

**Extensibility note**: New field types (dropdown, radio, attachment, formula) can be added to the type enum and given a corresponding renderer without changing the schema.

**Validation constraints** (enforced via Zod schemas in `src/lib/validations/`):
- `0 <= xPercent <= 100`, `0 <= yPercent <= 100`
- `xPercent + widthPercent <= 100`, `yPercent + heightPercent <= 100`
- Each SIGNER recipient must have at least one field (validated at send time)
- Each SIGNER recipient must have at least one SIGNATURE or INITIALS field
- Minimum field dimensions: 2% width, 1% height
- `pageNumber` must be between 1 and the document's `pageCount`
- No two fields may overlap (bounding-box intersection check, warning-only — sender can dismiss)

### 1.4 DocumentFieldValue

Mutable signer-entered data — one working row per field definition per recipient within the envelope.

| Field | Type | Purpose |
|-------|------|---------|
| id | UUID | Primary key |
| tenantId | UUID | Multi-tenancy (denormalized) |
| fieldDefinitionId | UUID | FK to DocumentFieldDefinition |
| recipientId | UUID | FK to EnvelopeRecipient (who filled it) |
| value | Text? | Filled value (text, date string, "true"/"false" for checkbox) |
| signatureStoragePath | String? | For SIGNATURE/INITIALS: path to stored signature image |
| revision | Int | Incremented on each auto-save (default 1) |
| filledAt | DateTime? | When this field was filled |
| finalizedAt | DateTime? | Set when the signer clicks Finish; row becomes immutable |
| createdAt | DateTime | Created timestamp |
| updatedAt | DateTime | Last modified |

**Why the split matters:**
- Field definitions are immutable after send — the evidence record of what was requested cannot be altered
- Values can be partially saved (auto-save during signing) without modifying the definition
- Corrections (name/email changes) don't affect field placements
- Template reuse in future phases: copy definitions, create fresh value rows per signing instance
- Uniqueness constraint: one mutable row per `(fieldDefinitionId, recipientId)`; auto-save updates that row in place and increments `revision`
- On completion, all rows for that recipient are finalized (`finalizedAt` set) and cannot be mutated further

### 1.5 EnvelopeRecipient

| Field | Type | Purpose |
|-------|------|---------|
| id | UUID | Primary key |
| tenantId | UUID | Multi-tenancy (denormalized for direct query filtering) |
| envelopeId | UUID | FK to Envelope |
| type | Enum | SIGNER, CC |
| name | String | Recipient name |
| email | String | Recipient email |
| signingOrder | Int? | Position in sequence (null = parallel with others at same position) |
| status | Enum | QUEUED, NOTIFIED, VIEWED, SIGNED, DECLINED |
| accessMode | Enum | EMAIL_LINK, EMAIL_WITH_CODE, MANUAL_LINK |
| accessTokenHash | String | SHA-256 hash of the access token (raw token never stored) |
| sessionVersion | Int | Incremented when links are regenerated or access is revoked; used to invalidate issued session cookies |
| accessCode | String? | Hashed PIN for this recipient (required when accessMode = EMAIL_WITH_CODE) |
| consentedAt | DateTime? | When signer accepted the e-signature consent disclosure |
| consentIp | String? | IP at consent time |
| consentUserAgent | String? | Browser at consent time |
| signedAt | DateTime? | When they completed signing |
| viewedAt | DateTime? | First view timestamp |
| declinedAt | DateTime? | When declined |
| declineReason | Text? | Why they declined |
| signedIp | String? | IP address at signing (audit) |
| signedUserAgent | String? | Browser info at signing (audit) |
| lastReminderAt | DateTime? | When last reminder was sent |
| colorTag | String | Assigned color for field placement UI |
| createdAt | DateTime | Created timestamp |
| updatedAt | DateTime | Last modified |

**Access mode and code are per-recipient** — the UI provides a default access mode when adding recipients, but each recipient stores their own `accessMode` and `accessCode`. This allows mixed access modes within a single envelope.

**Recipient status semantics:**

| Status | Meaning |
|--------|---------|
| QUEUED | Waiting for a prior signing group to complete (sequential/mixed only) |
| NOTIFIED | Email sent (or manual link generated); awaiting signer action |
| VIEWED | Signer has loaded the signing page |
| SIGNED | Signer has completed all required fields and clicked Finish |
| DECLINED | Signer declined to sign |

For CC recipients: status stays QUEUED until envelope completes, then transitions directly to NOTIFIED when the completion email is sent.

**Duplicate signers**: The same email address cannot appear twice as separate SIGNER recipients on the same envelope. Validated at send time. (A signer and a CC with the same email is allowed.)

### 1.6 EnvelopeEvent (Audit Trail)

| Field | Type | Purpose |
|-------|------|---------|
| id | UUID | Primary key |
| tenantId | UUID | Multi-tenancy (denormalized for direct query filtering) |
| envelopeId | UUID | FK to Envelope |
| recipientId | UUID? | FK to EnvelopeRecipient (null for sender actions) |
| action | Enum | CREATED, SENT, VIEWED, CONSENTED, SIGNED, DECLINED, VOIDED, CORRECTED, COMPLETED, REMINDER_SENT, EXPIRED, PDF_GENERATION_FAILED |
| ipAddress | String? | Actor's IP |
| userAgent | String? | Actor's browser |
| metadata | JSONB | Additional context (correction details, decline reason, consent version, etc.) |
| createdAt | DateTime | When event occurred |

**Dual audit logging**: `EnvelopeEvent` records the signer-facing timeline (appears on certificates). Sender-side operations (create, send, void, delete, correct) additionally write to the existing `AuditLog` system via `createAuditLog()` for RBAC-auditable admin logs.

### 1.7 Envelope Lifecycle State Machine

**Valid transitions:**

| From | To | Trigger |
|------|----|---------|
| DRAFT | SENT | Sender clicks Send (after pre-send validation passes) |
| DRAFT | *(deleted)* | Sender deletes draft |
| SENT | IN_PROGRESS | First signer views or signs |
| SENT | VOIDED | Sender voids |
| SENT | EXPIRED | Past expiration date (background task) |
| IN_PROGRESS | COMPLETED | Last signer completes |
| IN_PROGRESS | DECLINED | A signer declines |
| IN_PROGRESS | VOIDED | Sender voids |
| IN_PROGRESS | EXPIRED | Past expiration date (background task) |

Terminal states: **COMPLETED**, **DECLINED**, **VOIDED**, **EXPIRED**

- **DRAFT**: Created, documents uploaded, fields placed, not yet sent
- **SENT**: All recipients notified (or queued for sequential), awaiting first action
- **IN_PROGRESS**: At least one signer has viewed or signed
- **COMPLETED**: All signers signed; signed PDFs generated (or queued for generation)
- **DECLINED**: A signer declined (stops the entire envelope)
- **VOIDED**: Sender cancelled the envelope
- **EXPIRED**: Past expiration date with incomplete signatures

### 1.8 Signing Order Rules

| Envelope `signingOrder` | Recipient `signingOrder` field | Behavior |
|-------------------------|-------------------------------|----------|
| PARALLEL | Ignored | All signers receive the envelope simultaneously; all start as NOTIFIED |
| SEQUENTIAL | Must be unique integers (1, 2, 3...) | Each signer must complete before the next is notified; later signers start as QUEUED |
| MIXED | Integer groups (1, 1, 2, 3, 3...) | Same number = parallel group; groups proceed sequentially; later groups start as QUEUED |

The notification service determines whom to notify next: for SEQUENTIAL/MIXED, after a signer completes, check if all recipients at the current `signingOrder` value have signed, then transition the next group from QUEUED → NOTIFIED and send emails.

**Sequential group UI for sender**: The envelope detail view shows signing groups visually: "Group 1 (current) — Ray Client ✓, Sarah Director ●" / "Group 2 (waiting) — CFO Signer ◻". CC recipients are shown in a separate "Copies" section because they do not participate in signing order.

### 1.9 Concurrency Control

With parallel signing, multiple signers may complete simultaneously. The completion flow must be safe:

- **Atomic status transition**: The `complete` endpoint uses `UPDATE Envelope SET status = 'COMPLETED' WHERE id = ? AND status = 'IN_PROGRESS'` and checks affected rows. If 0 rows affected, the transition was already handled by another concurrent request.
- **Prisma transaction**: The complete endpoint wraps field value saves + recipient status update + envelope status check in a single `prisma.$transaction()`.
- **Idempotent completion**: If a signer's `complete` request arrives after the envelope is already COMPLETED, return success (their fields were already saved) without re-triggering PDF generation or emails.
- **DB-backed completion queue**: PDF generation uses the same status-column queue pattern as `form-ai.task.service.ts`, but with stale-claim recovery. The scheduler claims envelopes by setting `pdfGenerationStatus = PROCESSING` and `pdfGenerationClaimedAt = now`, and it may reclaim envelopes stuck in PROCESSING past the lease timeout (for example, 15 minutes) after a crash.

### 1.10 Certificate ID Format

```
OAK-ES-20260310-8F3A2B4D-C7E1
```

- `OAK-ES` — prefix (ES = e-signing)
- `YYYYMMDD` — date created
- `8-char hex` — random (~4.3 billion combinations per day)
- `4-char hex` — additional random entropy (total 48 bits randomness per day)
- **Unique constraint** on `certificateId` in the database; retry with new random on collision

### 1.11 Document Limits

| Limit | Value | Rationale |
|-------|-------|-----------|
| Max file size per document | 25 MB | Practical upload limit |
| Max pages per document | 100 | Client-side rendering performance |
| Max total pages per envelope | 200 | Combined rendering + PDF assembly performance |
| Max total envelope size | 100 MB | Storage + email attachment constraints |
| Max documents per envelope | 20 | UX manageability |
| Max recipients per envelope | 20 | UX manageability |

Validated at upload time (per-document) and at send time (envelope totals).

---

## 2. Preparation UX (Field Placement)

### 2.1 Envelope Creation Wizard

Three-step flow:

**Step 1 — Upload & Recipients**

- Drag-and-drop zone + file picker for PDF uploads
- Document list with reorder (drag handles), thumbnail preview, remove button
- Supported formats: PDF only (Phase 1)
- **Upload validation**: check magic bytes (PDF header), parse with pdf-lib to extract page count, reject encrypted/password-protected PDFs, reject PDFs that fail to parse, enforce per-document size and page limits
- Recipient form: name, email, type (Signer / CC)
- **Duplicate email blocking**: same email cannot be added twice as SIGNER; UI shows inline error
- Signing order toggle: Parallel (default) / Sequential / Mixed
- For sequential/mixed: drag-to-reorder or number assignment; same number = parallel group
- Each signer auto-assigned a distinct color (used in field placement UI)
- Per-recipient access mode selector: Email Link / Email + Access Code / Manual Link (default applies to all, overridable per recipient)
- Subject line + message body fields
- Draft auto-saves after every meaningful change; header shows `Saved just now` / `Saving...`
- Step progress indicator at top: `1. Upload & Recipients` → `2. Place Fields` → `3. Review & Send`
- Primary CTA remains disabled until there is at least one document and one SIGNER recipient

**Recipient row/card model:**
- Each recipient is rendered as a bordered row/card with:
  - left color rail
  - signing-order badge (`1`, `2`, or `CC`)
  - name/email inputs
  - action chip (`Needs to Sign` / `Receives a Copy`)
  - access-mode control
  - inline validation/warning state
  - quick remove action
- Dragging the row changes signing order visually in sequential/mixed mode
- Current validation state is visible without opening another panel, for example `Signature field missing`

**Step 2 — Place Fields**

Full-width layout with three zones:

```
┌─────────────┬──────────────────────────────┬──────────────┐
│  Field       │                              │  Page        │
│  Palette     │    PDF Document View         │  Thumbnails  │
│             │    (pdf.js canvas +           │  & Field     │
│  ─────────  │     field overlay layer)      │  Properties  │
│  [Signer ▼] │                              │              │
│  color dot  │                              │  Thumbnails  │
│             │                              │  (click to   │
│  Signature  │                              │   jump,      │
│  Initials   │                              │   icons show │
│  Date       │                              │   pages with │
│  Name       │                              │   fields)    │
│  Text       │                              │              │
│  Checkbox   │                              │  ── or ──    │
│  Company    │                              │              │
│  Title      │                              │  Field Props │
│             │                              │  when field  │
│             │                              │  selected    │
└─────────────┴──────────────────────────────┴──────────────┘
│  Toolbar: Zoom | Undo/Redo | Document tabs (multi-doc)     │
└────────────────────────────────────────────────────────────┘
```

**Left panel — Field Palette:**
- Recipient selector dropdown with color indicator
- Switching recipient changes field color for subsequent placements
- Field type buttons: click a type to enter placement mode
- Recipient summary below the selector: `Ray Client — 3 required, 1 optional, signature missing`
- Inline warning badge on recipients who still have no signature field or no fields at all

**Center — Document View:**
- pdf.js renders each page to canvas
- Overlay div layer holds placed fields as absolutely-positioned React components
- Fields show recipient color, type icon, and label
- Click field to select (shows resize handles for resizable types)
- Drag to reposition
- Default field sizes are opinionated by field type (for example: signature larger than date); sender can resize after placement
- Snap guides appear when edges align with nearby fields or page margins; snapping threshold is subtle, not magnetic-by-default
- Auto-pan scrolls the document when dragging a field near the top/bottom edge of the viewport
- Keyboard nudging: arrow keys move selected fields by 1 unit; `Shift` + arrow moves by 10 units
- Multi-select: Shift+click or draw selection box → bulk move, bulk delete, alignment tools (align left/right/top/bottom, distribute evenly)
- Copy/paste: Ctrl+C/V for selected fields (pastes at offset position)
- Duplicate shortcut: `Ctrl+D` duplicates the selected field(s) for the same recipient on the current page
- Multi-document: tab bar to switch between documents
- Zoom: 50%, 75%, 100% (default), 125%, 150%, Fit Width
- Lazy page rendering: only visible pages + 1 buffer page

**Right panel — Context-Sensitive:**
- Default: page thumbnails with field indicator icons
- When field selected: property panel (recipient, required toggle, label, placeholder, font size)
- When multiple fields selected: bulk actions panel (assign recipient, required/optional, alignment, delete)
- Page thumbnails show badges for `Review Only`, field counts, and current page focus

**Toolbar:**
- Undo/Redo stack (field add, move, resize, delete, property changes)
- Document tabs for multi-document envelopes
- Zoom level selector
- Secondary controls: `Preview as signer`, `Desktop / Tablet / Mobile` preview modes, and `Show review-only documents`

### 2.2 Click-to-Place Interaction Model

Following DocuSign's pattern:

1. Sender clicks a field type in palette → enters placement mode
2. Cursor changes (crosshair + field type icon)
3. Field "ghost" follows cursor over the document
4. Click on document → field placed at default size
5. Stays in placement mode (place multiple of same type)
6. `Escape` or re-click palette → exits placement mode
7. Click existing field → select (resize handles + properties panel)
8. Drag selected field → reposition
9. `Delete` key or trash icon → remove selected field
10. `Enter` on a selected field opens its property panel; `Esc` exits placement or clears selection

### 2.3 Coordinate System

All field positions stored as percentages relative to page dimensions:

- `xPercent`, `yPercent` = top-left corner of the field
- `widthPercent`, `heightPercent` = field dimensions
- Conversion to screen: `xPercent / 100 * renderedPageWidth = pixelX`
- Conversion to PDF points: `xPercent / 100 * pdfPageWidthInPoints = absoluteX`
- Ensures fields render correctly at any zoom level, screen size, or DPI

**Step 3 — Review & Send**

- Summary: document list, recipient list with field count per signer
- Preview button: renders document as signer would see it (per-recipient preview)
- **Signed artifact preview**: shows what the final signed PDF will look like — watermark position, certificate page layout (rendered with placeholder data)
- Documents with no fields are allowed and shown as **Review Only** in sender and signer preview
- Envelope settings: expiration days, reminder frequency, reminder start delay, expiry warning days
- Auto-file toggle with company selector (optional)
- **Send** button (or **Get Link** for manual link mode)
- Recipient summary cards explicitly call out `Ready`, `Missing signature field`, or `No fields assigned`
- Document summary cards explicitly call out `Requires action` or `Review Only`
- Sticky footer summary: total documents, total signers, signing order mode, and any blocking issues

**Pre-send blocking validations:**

| Check | Error |
|-------|-------|
| Every SIGNER has at least one SIGNATURE or INITIALS field | "Signer [name] has no signature fields assigned" |
| Every SIGNER has at least one field of any type | "Signer [name] has no fields assigned" |
| No recipients without email | "Recipient [name] is missing an email address" |
| No duplicate signer emails | "[email] appears as a signer more than once" |
| Sequential order has no gaps | "Signing order has a gap: group 1, 3 (missing 2)" |
| Envelope contains at least one actionable field somewhere | "This envelope has no signer fields — add at least one field before sending" |
| Envelope is within limits | "Envelope exceeds [limit] — reduce documents or pages" |
| Access code set for EMAIL_WITH_CODE recipients | "[name] requires an access code" |

---

### 2.4 Guided States & Empty States

**Sender empty states:**
- No documents yet: illustration + text `Upload one or more PDFs to start an envelope`
- No recipients yet: helper panel `Add at least one signer before placing fields`
- No fields on current document: centered callout `Pick a recipient, then click a field type to place it`
- No signature field for a signer: non-dismissable warning until fixed or recipient removed

**First-time guidance:**
- On the first visit to Step 2, show a lightweight coachmark sequence:
  1. Choose a recipient
  2. Click a field type
  3. Click anywhere on the PDF to place it
  4. Use preview before sending
- Coachmarks can be dismissed and do not return after first completion

**Review-only document UX:**
- Review-only documents are labeled with a muted `Review Only` chip in sender summary, signer document tabs, and completion downloads
- In signer view, review-only documents show `No action required on this document` near the first page
- Review-only documents are included in the envelope progress count, but not in the required-field count

### 2.5 Preparation Accessibility & Responsiveness

- The sender workspace is fully usable at 1280px width and degrades to a stacked layout on tablets
- At narrower widths, the field palette becomes a collapsible drawer and page thumbnails move below the document view
- Every field in the placement editor can be selected from a keyboard-accessible field list, not only by clicking the PDF overlay
- Selected fields have both color and shape/state cues so recipient assignment is not color-dependent
- Drag interactions always have an equivalent keyboard path: move, resize, duplicate, delete, change recipient, toggle required
- Tooltips and coachmarks are dismissable and never the only source of critical information

## 3. Signing Experience (Public Signer View)

### 3.1 Token & Session Model

The link token in the email/URL is **not stored directly** on the recipient row. Instead:

1. On send, a crypto-random 64-char token is generated
2. `accessTokenHash` = SHA-256(token) is stored on `EnvelopeRecipient`
3. The raw token is included in the email link / manual link URL
4. When the public signing page loads, it calls `POST /api/esigning/sign/[token]`:
   - Hash the incoming token and look up the recipient by `accessTokenHash`
   - If `accessMode = EMAIL_WITH_CODE`, issue a short-lived **challenge JWT** cookie (`esigning_challenge`, 5 min TTL, scope: `esigning_challenge`) with payload `{ recipientId, envelopeId, sessionVersion }` and return `requiresAccessCode: true`
   - Otherwise issue a short-lived **signing session JWT** cookie (`esigning_session`, 30 min TTL, renewable on activity) with payload `{ recipientId, envelopeId, sessionVersion, scope: 'esigning_session' }`
5. `POST /api/esigning/sign/session/verify` consumes the challenge cookie, verifies the access code, clears the challenge cookie, and upgrades the browser to a full `esigning_session` cookie
6. All subsequent signing API calls use the `esigning_session` cookie only; bearer headers are **not** supported in Phase 1
7. Download endpoints for signed PDFs use separate short-lived JWTs (15 min TTL, scope: `esigning_download`)

**Benefits**: The link token is a reusable entry credential for resume flows, but it is never used as the active session. Interactive signing is always bound to short-lived, HttpOnly cookies. Existing sessions can be revoked by incrementing `sessionVersion` on the recipient row.

### 3.2 Entry Flow

```
Email link / manual link clicked
  → Public signing page loads
  → Token exchange API call
      → EMAIL_LINK / MANUAL_LINK: full session cookie issued
      → EMAIL_WITH_CODE: challenge cookie issued
          → "Enter your access code"
          → Verify code
          → full session cookie issued
  → Consent & disclosure screen
  → Signing view
```

### 3.3 Consent & Disclosure Screen

Before signing, the signer must affirmatively consent to electronic records and signatures:

```
┌───────────────────────────────────────────────┐
│  Electronic Signature Disclosure               │
│                                                │
│  [Sender Name] from [Tenant Name] has sent     │
│  you the following documents for electronic     │
│  signature:                                    │
│                                                │
│  • Individual Declaration Form.pdf              │
│  • Engagement Letter.pdf                        │
│                                                │
│  By clicking "I Agree", you consent to:         │
│  • Using electronic records and signatures      │
│  • The collection of your name, email, IP       │
│    address, and browser information for          │
│    audit and verification purposes              │
│  • Receiving the signed documents by email      │
│                                                │
│  You may decline to sign at any time.           │
│  View full disclosure [link]                    │
│                                                │
│  ☐ I agree to use electronic records and        │
│    signatures for this transaction               │
│                                                │
│              [Continue]                         │
└───────────────────────────────────────────────┘
```

On "Continue":
- `consentedAt`, `consentIp`, `consentUserAgent` recorded on the recipient
- `CONSENTED` event logged to `EnvelopeEvent` with `metadata: { consentVersion: "1.0", disclosureLocale: "en-SG" }`
- The envelope stores both `consentVersion` and `consentDisclosureSnapshot` so the exact disclosure shown at send time remains available even if the template text changes later

**Privacy disclosure**: IP addresses, browser information, and signature images will appear on the completion certificate. This is stated explicitly in the consent screen so signers are informed before proceeding.

### 3.4 Signing View Layout

**Desktop:**

```
┌──────────────────────────────────────────────────────────────────────┐
│ Header: Title | Sender info | Progress | Other Options ▼ | Continue │
├──────┬───────────────────────────────────────────────┬──────────────┤
│ POST │                                               │ Thumbnails / │
│  IT  │   PDF Document View                           │ Doc Navigator│
│ TAB  │   (pdf.js canvas, interactive fields)         │              │
│      │                                               │ Page 1       │
│ Sign │──►┌──────────────────┐                        │ Page 2       │
│      │   │ [Signature field] │  ← pulsing border     │ Page 3       │
│      │   └──────────────────┘                        │              │
├──────┴───────────────────────────────────────────────┴──────────────┤
│ Footer: Page X of Y | Zoom controls | Autosave status               │
└──────────────────────────────────────────────────────────────────────┘
```

**Header behavior:**
- Left: envelope title, sender/tenant identity, trust marker (`Secure signing session`)
- Center: progress summary such as `3 of 7 required fields completed`
- Right: `Other Options`, then the primary sticky action button (`Continue` until all required actions are done, then `Finish`)
- The primary action remains visible while scrolling and mirrors the current state of the post-it/bookmark navigation

**Document navigation:**
- Top document switcher shows each document as a pill/tab with `Needs Action` or `Review Only`
- Current document pill also shows per-document completion, for example `Tax Declaration — 2/3`
- If a document has no required fields for the signer, the tab is muted and marked `Review Only`
- On desktop, a collapsible right-side thumbnail rail shows page previews for the current document with field markers and current page highlight
- Clicking a page thumbnail scrolls directly to that page; pages with required fields get stronger markers
- If multiple documents exist, the thumbnail rail can switch between `Current Document` and `All Documents`

**Signer reassurance:**
- A short line above the document explains the next action, for example `Next required action: Sign on page 2`
- When all required fields on the current document are done but the envelope has more actions elsewhere, the UI says `Document complete — continue to the next required document`
- A lightweight activity hint near the top can say `You have received a request to sign` until the first required field is completed

### 3.5 "Post-It" Bookmark Navigation

Inspired by DocuSign's "Sign Here" tab — a physical post-it metaphor:

- **Shaped like a folded tab** sticking out from the left edge of the active field (slight shadow for depth)
- **Oakcloud teal** (`#294d44`) background with white text
- **Label changes by field type**: "Sign", "Initial", "Fill", "Check", "Date"
- Small icon matching the action (pen for signature, text cursor for fill, etc.)
- Subtle tooltip on hover: "Required - Sign Here"
- **On click**: performs the field action (opens signature pad, focuses input, toggles checkbox) then animates to the next unfilled required field
- Auto-scrolls across pages if needed
- Field completion order follows `sortOrder` set by sender during preparation
- When all required fields completed: post-it transforms into a **"Finish"** tab

**Keyboard accessibility**: Tab/Shift+Tab cycles through fields in `sortOrder`. Enter activates the current field. Each field has an `aria-label` describing the action (e.g., "Signature field 1 of 3, required"). Screen readers announce the post-it label.

**Alternative navigation controls**:
- A compact `Next Field` / `Previous Field` control appears beside the progress summary for users who prefer button navigation over the floating post-it
- The controls skip review-only documents automatically

**Mobile**: same post-it concept, slightly smaller; tapping scrolls + zooms to center the target field on screen. The post-it also serves as a floating action button (bottom-right) when the active field is not in view.

### 3.6 Field States During Signing

| State | Visual |
|-------|--------|
| Unfilled required | Pulsing border in signer color, type icon + action label |
| Unfilled optional | Subtle dashed border, "optional" label |
| Active / focused | Solid border, elevated shadow |
| Filled | Content shown, subtle checkmark badge, border fades to muted |

### 3.7 Signature Capture Modal

Opens when signer clicks a Signature or Initials field:

```
┌───────────────────────────────────────┐
│  Adopt Your Signature                 │
│                                       │
│  Full Name: [___________________]     │
│  Initials:  [____]                    │
│                                       │
│  ┌── Draw ──┬── Type ──┬── Upload ──┐ │
│  │  Canvas   │ Preview  │  Drop zone │ │
│  │  area     │ in font  │  for image │ │
│  └───────────┴──────────┴───────────┘ │
│                                       │
│  Style: ○ Script  ○ Formal  ○ Clean   │
│  (for Type mode — 3-4 font choices)   │
│                                       │
│  □ Apply to all Signature fields      │
│  □ Apply to all Initials fields       │
│                                       │
│         [Cancel]    [Adopt and Sign]   │
└───────────────────────────────────────┘
```

Three input methods:
- **Draw**: Canvas with smooth bezier interpolation, touch support, undo last stroke
- **Type**: Name rendered in handwriting font (Dancing Script, Pinyon Script, Caveat)
- **Upload**: Image upload with crop/resize

After first adoption, signature is cached for the session — subsequent Signature fields auto-fill with one click.

**Modal ergonomics:**
- The primary action button is disabled until a valid signature/initials exists
- The last selected tab (Draw / Type / Upload) is remembered for the session
- Validation errors are inline, not modal alerts

### 3.8 Completion Flow

```
All required fields filled
  → "Post-it" bookmark transforms to "Finish" tab
  → Signer clicks Finish
  → Confirmation: "You've signed [document names]. A copy will be sent to your email."
  → Options: [Download] [Close]
  → If sequential: next signer group notified
  → If all signers done: envelope → COMPLETED
```

**Completion confirmation details:**
- Show a compact checklist: `Consent recorded`, `Signature applied`, `Audit trail saved`
- Show whether documents are immediately downloadable or still processing
- If there were review-only documents in the envelope, confirm they are included in the final package
- Include a visible `Save a Copy` action and a `View History` action
- If PDFs are still processing, show a timeline-style state: `Request completed` → `Documents being prepared` → `Copy will be emailed`

### 3.9 Post-Sign Summary Screen

After Finish, the signer lands on a lightweight summary state rather than only a modal confirmation:

- Large success state: `Completed`
- Secondary line: `All parties will receive a completed copy`
- Timeline snippet:
  - `You received a request to sign`
  - `You signed`
  - `Sender has been notified`
- Actions:
  - `Save a Copy`
  - `View History`
  - `View Certificate`
  - `Close`
- If the envelope is sequential and other signers remain, the screen avoids implying the entire envelope is complete; it instead says `Your part is complete`

### 3.10 "Other Options" Menu

| Option | Action |
|--------|--------|
| Finish Later | Saves progress; signer returns via same link (new session issued) |
| Decline to Sign | Reason modal → envelope status → DECLINED; sender notified |
| Download Original | Download unsigned PDFs for review |
| Session Information | Signer name, email, envelope ID |

**Copywriting rule**: Avoid jargon like "envelope" in primary signer messaging unless needed; default phrasing should say `documents`, with technical identifiers only under Session Information.

### 3.11 Mobile Signing

- Full-width document view, no side panels
- Post-it bookmark as floating action button (bottom-right) with arrow icon
- Pinch-to-zoom on document
- Signature modal goes full-screen
- Native mobile keyboards for text inputs
- Landscape orientation prompt for signature drawing
- Sticky bottom action bar shows `Next required field` or `Finish`, plus autosave state
- Double-tap zoom centers the active field
- When a text field is focused, the action bar collapses to avoid fighting the on-screen keyboard
- On small screens, page thumbnails are replaced by a bottom sheet document navigator
- Review-only documents show a compact banner: `No action needed on this document`

### 3.12 Error States

| Scenario | What the signer sees |
|----------|---------------------|
| Envelope voided mid-signing | "This envelope has been cancelled by the sender." with sender contact info |
| Envelope expired mid-session | "This signing request has expired. Please contact the sender for a new request." |
| PDF fails to load | Retry button + "Having trouble? Try refreshing the page." fallback message |
| Signature upload fails | Inline error with retry, fallback to Draw or Type modes |
| Network error on field save | Auto-retry with exponential backoff (3 attempts), then "Changes could not be saved" banner with manual retry |
| Access code lockout | "Too many attempts. Please try again in 15 minutes." |
| Already completed | "You have already signed this envelope." with download link |
| Signing session expired | "Your session has expired." with "Resume Signing" button (re-exchanges link token for a new session cookie) |

**Loading states:**
- Initial page load uses skeleton placeholders for header, progress, and first document page
- Switching documents keeps the previous page visible until the next page is ready to reduce visual flashing
- Previewing large envelopes shows `Preparing document...` with document/page context instead of a generic spinner

---

## 4. Completion, Certificate & Post-Signing

### 4.1 Completion Trigger

When the last signer clicks Finish:

1. **Synchronous** (in the API response):
   - Envelope status → `COMPLETED`, `completedAt` set
   - `pdfGenerationStatus` → `PENDING`
   - Return success to the signer immediately
2. **Asynchronous** (DB-backed queue, processed by scheduler):
   - Scheduler picks up envelopes with `pdfGenerationStatus = PENDING` or stale `PROCESSING` claims older than the lease timeout
   - Transitions to `PROCESSING` and sets `pdfGenerationClaimedAt = now` (atomic claim via `UPDATE ... WHERE pdfGenerationStatus = 'PENDING'` or stale-claim recovery query)
   - **Signed PDF generation** per document:
      - Load original PDF via pdf-lib
      - Validate PDF integrity before processing
      - Embed all field values (signatures as images, text as overlays, checkboxes as check marks, dates as text)
      - Add footer strip to each page for certificate ID watermark (see 4.3)
      - Append completion certificate page(s) — rendered via existing HTML-to-PDF path (`document-export.service.ts`)
      - Compute SHA-256 hash of the signed PDF → store in `EnvelopeDocument.signedHash`
      - Save to `{tenantId}/esigning/{envelopeId}/signed/{documentId}.pdf`
    - Email signed PDFs to all parties (signers + CC + sender)
    - Auto-file to company folder if enabled
    - `pdfGenerationStatus` → `COMPLETED`, `pdfGenerationClaimedAt` cleared
    - On failure: increment `pdfGenerationAttempts`, retry up to 3 times, then mark `FAILED` with error in `pdfGenerationError`, clear `pdfGenerationClaimedAt`, log `PDF_GENERATION_FAILED` event, notify sender

### 4.2 PDF Generation Failure UX

**For senders** when `pdfGenerationStatus = FAILED`:
- Envelope detail view shows a warning banner: "Document processing failed. [Retry] [Contact Support]"
- Retry button resets `pdfGenerationStatus` to `PENDING` and `pdfGenerationAttempts` to 0
- Sender receives an email: "Document processing failed for [Envelope Title]. You can retry from the dashboard."
- Stuck `PROCESSING` claims older than the lease timeout are reclaimed automatically by the scheduler; manual retry is only needed after the envelope reaches `FAILED`

**For signers**: The signing experience is unaffected — they see the normal "completed" confirmation. If they try to download signed PDFs before generation completes, they see "Your signed documents are being prepared. You'll receive them by email shortly."

### 4.3 Per-Page Certificate ID Watermark

Every page of every document gets a watermark. Since arbitrary PDFs may not have safe bottom margins, the watermark is applied by **adding a narrow footer strip** (12pt height) to the bottom of each page during final assembly, rather than hoping for margin space:

- pdf-lib extends the visible page box by 12pt and translates existing content into the expanded page while preserving page rotation and crop geometry
- Existing annotations/links remain in the original content area; the watermark text is rendered only in the added strip
- Format: `OAK-ES-20260310-8F3A2B4D-C7E1 │ Page 1 of 3`
- Style: light gray (#a0a5b0), 7pt font
- This guarantees no content overlap regardless of the original PDF's margins

### 4.4 Certificate Page Design (Dropbox Sign-Inspired)

Each document gets its own certificate appended. Visual, clean, timeline-based. Rendered using the existing HTML-to-PDF pipeline (`document-export.service.ts`) rather than hand-drawing with pdf-lib.

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│  ┌─── Oakcloud ───────────────────────────────────┐ │
│  │  Certificate of Completion                     │ │
│  │  Certificate ID: OAK-ES-20260310-8F3A2B4D-C7E1│ │
│  └────────────────────────────────────────────────┘ │
│                                                     │
│  Envelope Title:    Q1 Tax Declaration Package      │
│  Document:          Individual Declaration Form.pdf │
│  Document Hash:     sha256:a1b2c3d4...              │
│  Envelope ID:       env_8f3a2b...                   │
│  Status:            ● Completed                     │
│                                                     │
│  Verify: https://app.oakcloud.sg/verify/OAK-ES-... │
│                                                     │
│  ─── Timeline ───────────────────────────────────── │
│                                                     │
│   ● Created                                         │
│   │  Mar 10, 2026  2:30 PM SGT                     │
│   │  By: Jane Accountant (jane@firm.com)           │
│   │                                                 │
│   ● Sent for Signing                                │
│   │  Mar 10, 2026  2:31 PM SGT                     │
│   │                                                 │
│   ● Consent given by Ray Client                     │
│   │  Mar 10, 2026  3:14 PM SGT                     │
│   │  IP: 203.0.113.42                              │
│   │                                                 │
│   ● Viewed by Ray Client                            │
│   │  Mar 10, 2026  3:15 PM SGT                     │
│   │  IP: 203.0.113.42                              │
│   │                                                 │
│   ● Signed by Ray Client (ray@client.com)          │
│   │  Mar 10, 2026  3:18 PM SGT                     │
│   │  IP: 203.0.113.42                              │
│   │                                                 │
│   ● Completed                                       │
│     Mar 10, 2026  3:18 PM SGT                      │
│                                                     │
│  ─── Signers ────────────────────────────────────── │
│                                                     │
│   ┌────────────────────────────────────────┐       │
│   │  Ray Client                            │       │
│   │  ray@client.com                        │       │
│   │  Status: Signed                        │       │
│   │  Signed: Mar 10, 2026  3:18 PM SGT    │       │
│   │  IP: 203.0.113.42                      │       │
│   │  Signature:  [signature image]         │       │
│   └────────────────────────────────────────┘       │
│                                                     │
│  ───────────────────────────────────────────────── │
│  This document was signed electronically via       │
│  Oakcloud E-Signing.                               │
│  Certificate ID: OAK-ES-20260310-8F3A2B4D-C7E1    │
│  Document hash (SHA-256): a1b2c3d4e5f6...          │
│  Verify at: https://app.oakcloud.sg/verify/OAK-.. │
│  Powered by Oakcloud.                              │
└─────────────────────────────────────────────────────┘
```

### 4.5 Verification Endpoint

A public endpoint that allows anyone with a certificate ID to verify document integrity:

`GET /verify/[certificateId]` → public page showing:
- Envelope title, status, completion date
- Per-document: file name, original hash, signed hash
- Signer names and signed timestamps (emails redacted to `r***@client.com`)
- **Upload and verify**: user can upload a PDF → system computes SHA-256 and checks against stored `signedHash`. Shows "Match — this document has not been tampered with" or "Mismatch — this document may have been altered."

This is not a cryptographic digital signature (deferred to future phase) but provides a server-verifiable proof chain.

### 4.6 Download Options

| Option | Description |
|--------|-------------|
| Download All (Combined) | Single PDF: all documents + certificates concatenated |
| Download Individual | Per-document signed PDF with its certificate appended |
| Download Certificates Only | Just the certificate pages |

---

## 5. Envelope Management Dashboard

### 5.1 Navigation

New sidebar item: **E-Signing** → `/esigning`

### 5.2 List View

**Filter tabs:**

| Tab | Shows |
|-----|-------|
| All | Everything |
| Needs My Attention | Drafts, declined, failed processing |
| Waiting for Others | Sent / In Progress |
| Completed | All completed |
| Voided / Expired | Cancelled or timed-out |

**Table columns:**

| Column | Content |
|--------|---------|
| Title | Envelope title (click → detail) |
| Status | Badge with semantic colors (+ "Processing Failed" badge for pdfGenerationStatus = FAILED) |
| Recipients | Signer names with status icons (✓ signed, ● current, ◻ queued, ✗ declined) |
| Documents | Count + first document name |
| Created | Relative timestamp |
| Last Activity | Most recent event |

**Row actions:** View, Resend, Void, Duplicate, Delete (drafts only)

**Dashboard states:**
- Empty state: `No envelopes yet` with CTA `Create your first envelope`
- No results state: preserves filters and offers `Clear filters`
- Loading state: table skeleton rows with status-pill placeholders
- Failed processing rows surface a clear retry affordance without requiring the detail page

### 5.3 Envelope Detail View

```
┌─────────────────────────────────────────────────────────┐
│  ← Back to E-Signing                                    │
│                                                         │
│  Q1 Tax Declaration Package          [Resend] [Void]    │
│  Status: ● In Progress                                  │
│  Sent: Mar 10, 2026 · Expires: Apr 9, 2026             │
├──────────┬──────────────────────────────────────────────┤
│Recipients│  Documents                                   │
│          │  Document cards with page count, field count, │
│ Group 1  │  [Preview] and [Download] buttons            │
│ (current)│                                              │
│ ✓ Ray    │  Activity Timeline                           │
│ ● Sarah  │  Chronological event list                    │
│          │                                              │
│ Group 2  │                                              │
│ (waiting)│                                              │
│ ◻ CFO    │                                              │
│          │                                              │
│ Copies   │                                              │
│ • Admin  │                                              │
└──────────┴──────────────────────────────────────────────┘
```

**Correct action** (per recipient): modal to edit name and/or email only. **Cannot** change documents, field placements, or signing order after send. Invalidates old access token hash, generates new token, resends.

Correction requests submit only name and email, including when adding an email to a manual-link recipient. Draft-only fields (recipient type, signing order, access mode, and access code) are omitted so the existing routing and access settings remain unchanged.

Manual-link recipients display **LINK READY** for the internal `NOTIFIED` state: their signing link is active, but no notification email was sent. Other recipient statuses retain their usual labels.

**Completed detail** additionally shows: download options, auto-filed location link, certificate ID, document hashes.

**Failed processing** shows: warning banner with [Retry] button and error details.

**Detail view UX notes:**
- Action buttons are permission-aware and disabled with explanation tooltips when unavailable
- The activity timeline highlights the latest event and collapses older routine events behind `Show more`
- Recipient cards show `Current`, `Waiting`, `Signed`, `Declined`, and `Copy recipient` labels in plain text, not icon-only

---

## 6. Permissions (RBAC)

New resource `esigning` added to the RBAC system, using existing action conventions:

| Permission | Maps to | Description |
|------------|---------|-------------|
| `esigning:create` | Create envelopes, upload documents, place fields | Standard sender |
| `esigning:read` | View all envelopes in tenant (not just own) | Managers, oversight |
| `esigning:update` | Send, resend, correct recipients on envelopes | Covers send + correct operations |
| `esigning:delete` | Delete draft envelopes | Cleanup |
| `esigning:manage` | Void any in-progress envelope in tenant | Admin-level control |

**Scoping:**
- Users with `esigning:create` always see and manage their own envelopes (implicit `read` on own)
- `esigning:read` extends visibility to all tenant envelopes
- `esigning:manage` grants void access to any tenant envelope
- `SUPER_ADMIN` has full access across tenants
- `esigning` is added to the `RESOURCES` array in `src/lib/rbac.ts`

---

## 7. Storage Layout

```
{tenantId}/esigning/
├── {envelopeId}/
│   ├── original/
│   │   ├── {documentId}_filename.pdf
│   │   └── {documentId}_filename.pdf
│   ├── signed/
│   │   ├── {documentId}_filename_signed.pdf
│   │   └── {documentId}_filename_signed.pdf
│   └── signatures/
│       ├── {recipientId}_signature.png
│       └── {recipientId}_initials.png
```

- Original PDFs preserved immutably (never modified)
- Signed PDFs generated at completion
- Signature images stored per recipient per envelope (not reused across envelopes)
- Auto-filed copies are actual copies to `{tenantId}/companies/{companyId}/documents/...`

---

## 8. Email Templates

### 8.1 Signing Request

**To:** Each signer (on send or resend)

```
Subject: [Sender Name] has sent you "[Envelope Title]" for signing

[Sender Name] from [Tenant Name] has sent you documents to sign.

[Envelope message if provided]

Documents:
• Document 1.pdf
• Document 2.pdf

[Review and Sign]

This request expires on [expiry date].
```

### 8.2 CC Notification

**To:** CC recipients (when envelope is **completed**, not on initial send — CC recipients only receive the final signed documents)

```
Subject: Completed: "[Envelope Title]" — you're copied

All parties have signed the following documents. You've been
included as a copy recipient.

[Download Documents]
```

### 8.3 Completion

**To:** All signers + sender

```
Subject: Completed: "[Envelope Title]"

All parties have signed. Signed documents are attached.

Certificate ID: OAK-ES-20260310-8F3A2B4D-C7E1

[View in Oakcloud]  — for sender
[Download Documents] — for external parties (token-guarded)

Attachments: signed PDFs with certificates (if total < 20 MB; otherwise download link only)
```

### 8.4 Declined

**To:** Sender

```
Subject: Declined: "[Envelope Title]"

[Signer Name] has declined to sign.

Reason: "[decline reason]"

[View Envelope]
```

### 8.5 Expiry Warning

**To:** Sender

```
Subject: Expiring soon: "[Envelope Title]" — [X] days remaining

The following signers have not yet signed:
• [Signer Name] — [status]

Expires: [expiry date]

[View Envelope]
```

### 8.6 PDF Generation Failed

**To:** Sender

```
Subject: Processing failed: "[Envelope Title]"

Document processing failed for your completed envelope.
All signatures were captured successfully — only the final
PDF generation needs to be retried.

[Retry from Dashboard]
```

---

## 9. Signature Pad Component Upgrades

The existing `signature-pad.tsx` needs enhancement:

| Current | Upgrade |
|---------|---------|
| Basic pointer events | Smooth stroke interpolation (quadratic bezier curves) |
| Fixed canvas size | Responsive canvas with aspect ratio preservation |
| PNG export only | PNG + SVG export (SVG scales better in PDFs) |
| No touch optimization | Touch handling with palm rejection, pressure sensitivity |
| Simple clear/reset | Undo last stroke |
| No typed signatures | Typed mode: text → rendered in handwriting fonts (Dancing Script, Pinyon Script, Caveat) |
| No upload option | Image upload with crop/resize |
| No session caching | Cache adopted signature for signing session |

**Font loading strategy**: Handwriting fonts for typed signatures (Dancing Script, Pinyon Script, Caveat) are self-hosted (not loaded from Google Fonts CDN) to avoid third-party dependencies in the public signing flow. Fonts are loaded on-demand with `font-display: swap` when the signer opens the Type tab.

---

## 10. API Routes

### 10.1 Authenticated (Sender / Dashboard)

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/api/esigning/envelopes` | Create draft envelope |
| GET | `/api/esigning/envelopes` | List envelopes (paginated, with filters — uses existing `paginationSchema`) |
| GET | `/api/esigning/envelopes/[id]` | Get envelope detail |
| PATCH | `/api/esigning/envelopes/[id]` | Update draft |
| DELETE | `/api/esigning/envelopes/[id]` | Delete draft |
| POST | `/api/esigning/envelopes/[id]/documents` | Upload document |
| DELETE | `/api/esigning/envelopes/[id]/documents/[docId]` | Remove document |
| PATCH | `/api/esigning/envelopes/[id]/documents/[docId]` | Reorder document |
| PUT | `/api/esigning/envelopes/[id]/fields` | Save all field definitions (bulk upsert) |
| POST | `/api/esigning/envelopes/[id]/recipients` | Add recipient |
| PATCH | `/api/esigning/envelopes/[id]/recipients/[recipientId]` | Update / correct recipient (name/email only after send) |
| DELETE | `/api/esigning/envelopes/[id]/recipients/[recipientId]` | Remove recipient |
| POST | `/api/esigning/envelopes/[id]/send` | Send envelope (runs pre-send validations) |
| POST | `/api/esigning/envelopes/[id]/void` | Void envelope |
| POST | `/api/esigning/envelopes/[id]/resend/[recipientId]` | Resend to recipient |
| POST | `/api/esigning/envelopes/[id]/retry-processing` | Retry failed PDF generation |
| GET | `/api/esigning/envelopes/[id]/download` | Download signed PDFs |
| GET | `/api/esigning/envelopes/[id]/events` | Get audit trail |

### 10.2 Public (Signer-Facing)

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/api/esigning/sign/[token]` | Exchange link token and issue either a challenge cookie or signing session cookie |
| POST | `/api/esigning/sign/session/verify` | Verify access code using the challenge cookie and issue signing session cookie |
| POST | `/api/esigning/sign/session/consent` | Record consent (requires signing session cookie) |
| GET | `/api/esigning/sign/session/load` | Load envelope data for signing (requires signing session cookie) |
| POST | `/api/esigning/sign/session/view` | Record "viewed" event |
| PUT | `/api/esigning/sign/session/fields` | Save field values (auto-save) |
| POST | `/api/esigning/sign/session/complete` | Signer clicks Finish |
| POST | `/api/esigning/sign/session/decline` | Signer declines |
| GET | `/api/esigning/sign/session/download` | Download original PDFs |

### 10.3 Public Verification

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/esigning/verify/[certificateId]` | Get certificate verification data |
| POST | `/api/esigning/verify/[certificateId]/check` | Upload PDF and verify hash match |

### 10.4 Public Route Security

**Token & session security:**
- Link token: crypto random 64 chars, only the SHA-256 hash stored in DB
- Challenge JWT: 5 min TTL, `HttpOnly`, `Secure`, `SameSite=Lax`, path-scoped cookie used only for access-code verification
- Session JWT: 30 min TTL, issued via `jose` (same pattern as `form-response-token.ts`), `HttpOnly`, `Secure`, `SameSite=Lax`, path-scoped cookie
- Download JWTs: 15 min TTL, separate scope
- State-changing signing routes accept cookie auth only; bearer `Authorization` headers are not supported in Phase 1
- Every signing request reloads the recipient/envelope and validates `sessionVersion`, terminal state, and current recipient status before applying changes
- State-changing public routes enforce same-origin `Origin` / `Referer` checks to prevent cross-site request forgery
- Access tokens must never be logged in server request logs
- Link tokens are regenerated on resend/correct and existing signing sessions are revoked by incrementing `sessionVersion`

**Rate limits** (added to `src/lib/rate-limit.ts`, using the existing in-memory rate limiter for Phase 1):

| Config | Limit | Purpose |
|--------|-------|---------|
| `ESIGNING_SIGN_LOAD` | 30 req/min per IP | Loading signing session |
| `ESIGNING_SIGN_VERIFY` | 5 attempts/15 min per IP+token, then lockout | Access code verification (brute-force protection) |
| `ESIGNING_SIGN_SAVE` | 20 req/min per IP | Auto-save field values |
| `ESIGNING_SIGN_COMPLETE` | 5 req/min per IP | Completing signing |
| `ESIGNING_SIGN_DECLINE` | 5 req/min per IP | Declining |
| `ESIGNING_SIGN_DOWNLOAD` | 10 req/min per IP | Downloading documents |
| `ESIGNING_VERIFY` | 20 req/min per IP | Certificate verification |

**Infrastructure note**: Phase 1 assumes a single-instance deployment. In-memory limits are acceptable for initial rollout, but access-code lockout state remains instance-local and reset-on-restart. If Oakcloud scales beyond one instance or if public abuse becomes material, Redis-backed rate limiting becomes a requirement, not an optional optimization.

---

## 11. Service Layer

| Service | Responsibility |
|---------|---------------|
| `esigning-envelope.service.ts` | CRUD, status transitions, validation, sending, voiding, correction |
| `esigning-field.service.ts` | Field definition CRUD, coordinate validation, bulk upsert; field value saves |
| `esigning-signing.service.ts` | Public signing: token exchange, challenge verification, cookie session management, consent, field saves, complete, decline |
| `esigning-pdf.service.ts` | Signed PDF assembly: embed field values, footer strip + watermark, hash computation |
| `esigning-certificate.service.ts` | Certificate ID generation, certificate page HTML rendering (via `document-export.service.ts` HTML-to-PDF pipeline), verification logic |
| `esigning-notification.service.ts` | All email dispatch: signing requests, completions, declines, reminders, expiry warnings, failures |

### Background Tasks (Scheduler)

| Task | Schedule | Purpose |
|------|----------|---------|
| `esigning-pdf-generation` | Every 30 seconds | Pick up envelopes with `pdfGenerationStatus = PENDING` or stale `PROCESSING` claims, claim/reclaim, and process |
| `esigning-expiry-check` | Hourly | Transition expired envelopes, notify sender |
| `esigning-reminders` | Daily | Send auto-reminders to pending signers per envelope settings |
| `esigning-cleanup` | Daily | Remove orphaned uploads from deleted draft envelopes |

---

## 12. Compliance Baseline

Phase 1 is designed to support baseline electronic-signature workflows under:

**Singapore Electronic Transactions Act (ETA)**:
- Electronic signatures are valid unless specifically excluded (e.g., wills, powers of attorney)
- The consent screen, disclosure snapshot, audit trail, and certificate are intended to support evidence of intent to sign and association of the signer with the record
- IP and timestamp logging contribute to a reliable identification method, but excluded document classes and workflow-specific legal requirements still require review with counsel

**U.S. E-SIGN Act / UETA**:
- Requires: intent to sign, consent to electronic records, association of signature with record, record retention
- Consent screen captures affirmative consent and the exact disclosure text is retained via `consentDisclosureSnapshot`
- Signature images are embedded in the document and linked to specific fields
- Stored signed PDFs, download access, and audit certificates are intended to support record-retention needs
- The consent disclosure includes the right to withdraw (decline to sign)

**What Phase 1 does NOT provide** (deferred to future phases):
- Qualified electronic signatures (QES) or advanced electronic signatures (AdES)
- Cryptographic digital signatures (P12/PFX certificate-based)
- Compliance with regulations that require specific signature standards (e.g., EU eIDAS qualified)

The consent text version is tracked so that if disclosure language changes, existing signed documents retain their original consent context.

**Legal scope note**: This module is intended to support common commercial e-signing use cases. It does not by itself guarantee compliance for excluded document categories, regulated workflows, or jurisdiction-specific formalities outside the scope above.

---

## 13. Technical Stack Additions

| Library | Purpose |
|---------|---------|
| `react-pdf` (wraps pdf.js) | Client-side PDF rendering for preparation and signing views |
| `pdf-lib` (existing) | Server-side signed PDF assembly, signature embedding, watermark stamping |
| `document-export.service.ts` (existing) | HTML-to-PDF pipeline reused for certificate page rendering |
| `form-response-token.ts` pattern (existing) | JWT session tokens for signing sessions and downloads |
| Signature pad upgrades | Draw/type/upload signature capture |
| Self-hosted handwriting fonts (Dancing Script, Pinyon Script, Caveat) | Typed signature rendering (no external CDN dependency) |

---

## 14. Future Phases (Out of Scope)

Designed for but not implemented in Phase 1:

- **Templates**: Save envelope configurations (recipients, field placements) for reuse — the field definition/value split enables this cleanly
- **Agreement management**: Track signed agreements, renewal dates, compliance status
- **Bulk/batch sending**: Send same document to many recipients
- **Additional field types**: Dropdowns, radio buttons, attachments, formulae
- **Digital certificates**: P12/PFX-based tamper-evident PDF signing via @signpdf/signpdf
- **Anchor text placement**: Auto-detect "Sign Here" text and suggest field positions
- **Reassign**: Signer forwards signing responsibility to someone else
- **Distributed infrastructure**: Redis rate limiting, dedicated worker processes, leader election for scheduler
