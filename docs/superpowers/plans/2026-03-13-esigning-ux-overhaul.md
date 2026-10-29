# E-Signing UI/UX Overhaul Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the e-signing module from a functional-but-rough UI into a polished, DocuSign-inspired experience for both senders (field placement) and signers (guided signing).

**Architecture:** The overhaul is split into three independent workstreams: (1) public signer experience with consent screen, interactive field overlays on PDF, post-it bookmark navigation, and completion flow; (2) sender detail page with 3-step wizard, click-to-place field interaction, and review summary; (3) verification page with timeline presentation and list page filter tabs. Each workstream produces self-contained, working UI.

**Tech Stack:** React 19, Next.js 15 App Router, Tailwind CSS, pdfjs-dist (already installed), existing DocumentPageViewer component, lucide-react icons, existing UI primitives (Button, Modal, Alert, FormInput, etc.).

**Reference Materials:**
- Design spec: `docs/plans/2026-03-12-esigning-design.md` (sections 2-5)
- DocuSign screenshots: `docs/features/esigning/Docusign - screenshot 1.png` through `3.png`
- Dropbox Sign screenshots: `docs/features/esigning/Dropbox sign - screenshot 1.png` and `2.png`
- Session notes: `docs/plans/2026-03-12-esigning-session-notes.md`

**Design System Reference:** `docs/guides/DESIGN_GUIDELINE.md` — follow compact/dense philosophy, 4px grid, existing color tokens, existing component patterns.

---

## Chunk 1: Public Signer Experience Overhaul

The signer page (`esigning-sign-page.tsx`) is the most critical public-facing surface. Currently it's a basic two-column layout with PDF on the left and a plain form list on the right. The design calls for an immersive, guided signing flow inspired by DocuSign.

### File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/components/esigning/signing/esigning-consent-screen.tsx` | Full-page consent & disclosure screen shown before signing |
| Create | `src/components/esigning/signing/esigning-signing-header.tsx` | Sticky header with progress, sender info, Other Options menu |
| Create | `src/components/esigning/signing/esigning-field-overlay.tsx` | Interactive field overlays rendered on top of PDF pages |
| Create | `src/components/esigning/signing/esigning-post-it-tab.tsx` | Post-it bookmark tab that navigates between fields |
| Create | `src/components/esigning/signing/esigning-signature-modal.tsx` | "Adopt Your Signature" modal with Draw/Type tabs |
| Create | `src/components/esigning/signing/esigning-completion-screen.tsx` | Post-sign summary with timeline and download actions |
| Create | `src/components/esigning/signing/esigning-decline-modal.tsx` | Decline reason modal (extracted from inline form) |
| Rewrite | `src/components/esigning/esigning-sign-page.tsx` | Orchestrator — manages signing flow state machine. **Document tab bar is inlined here** as a simple pill-tab row (not a separate file — it's 15-20 lines and only used in one place). |
| Modify | `src/components/processing/document-page-viewer.tsx:977-1010` | Add `onHighlightClick` callback prop for interactive highlights |

### Task 1: Add interactive highlight support to DocumentPageViewer

The existing DocumentPageViewer renders field highlights as SVG rects with `pointer-events-none`. We need a minimal, backward-compatible enhancement to support click interactions on highlights.

**Files:**
- Modify: `src/components/processing/document-page-viewer.tsx`

- [ ] **Step 1: Add callback props to DocumentPageViewerProps interface**

At `src/components/processing/document-page-viewer.tsx:80-100`, add two new optional props to the interface:

```typescript
/** Callback when a highlight overlay is clicked (makes highlights interactive) */
onHighlightClick?: (index: number, highlight: BoundingBox) => void;
/** Render custom content inside each highlight rect (receives highlight + pixel dimensions) */
renderHighlightContent?: (highlight: BoundingBox, pixelRect: { x: number; y: number; width: number; height: number }, index: number) => React.ReactNode;
```

- [ ] **Step 2: Destructure the new props in the component**

In the component body where other props are destructured (around line 295-315), add:

```typescript
onHighlightClick,
renderHighlightContent,
```

- [ ] **Step 3: Update the SVG highlight overlay to support interaction**

Replace the SVG overlay section (lines ~977-1010) to:
1. When `onHighlightClick` is provided, set `pointer-events: auto` on highlight rects and add click handlers
2. When `renderHighlightContent` is provided, render a `foreignObject` inside the SVG for each highlight that contains the custom React content

The SVG rects should get `cursor-pointer` and `onClick={() => onHighlightClick(idx, highlight)}` when the callback is set. The `renderHighlightContent` output goes inside a `<foreignObject>` at the same position.

- [ ] **Step 4: Verify type check passes**

Run: `npx tsc --noEmit --pretty false 2>&1 | grep -v safe-math`
Expected: No new errors from the e-signing or document-page-viewer files.

- [ ] **Step 5: Commit**

```
feat(esigning): add interactive highlight support to DocumentPageViewer
```

---

### Task 2: Create consent & disclosure screen

Before signing, the signer must consent to electronic records. Currently this is just an Alert banner. The design calls for a full dedicated screen with document list, consent text, and checkbox.

**Files:**
- Create: `src/components/esigning/signing/esigning-consent-screen.tsx`

**Reference:** Design spec section 3.3, DocuSign screenshot 2 (consent bar at top).

- [ ] **Step 1: Create the consent screen component**

```typescript
interface EsigningConsentScreenProps {
  envelopeTitle: string;
  senderName: string;
  tenantName: string;
  documents: Array<{ id: string; fileName: string }>;
  onConsent: () => void;
  onDecline: () => void;
  isSubmitting: boolean;
}
```

Layout (full-page centered card, max-w-2xl):
- Oakcloud logo / "Secure E-Sign" badge at top
- Title: "Electronic Signature Disclosure"
- Body: "[senderName] from [tenantName] has sent you the following documents for electronic signature:"
- Document list as bullet points
- Consent text: By clicking "I Agree", you consent to: using electronic records and signatures, the collection of your name/email/IP/browser info for audit purposes, receiving signed documents by email
- "You may decline to sign at any time."
- Checkbox: "I agree to use electronic records and signatures for this transaction"
- Two buttons: "Decline to Sign" (secondary/danger), "Continue" (primary, disabled until checkbox checked)

Style: Use existing design system tokens — `bg-background-primary`, `rounded-3xl`, `border-border-primary`, etc.

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit --pretty false 2>&1 | grep esigning-consent`
Expected: No errors.

- [ ] **Step 3: Commit**

```
feat(esigning): add consent & disclosure screen component
```

---

### Task 3: Create signing header with progress

The sticky header shows envelope title, sender info, field completion progress, and an "Other Options" dropdown + primary CTA.

**Files:**
- Create: `src/components/esigning/signing/esigning-signing-header.tsx`

**Reference:** Design spec section 3.4, DocuSign screenshot 2 (top bar with Continue button).

- [ ] **Step 1: Create the signing header component**

```typescript
interface EsigningSigningHeaderProps {
  envelopeTitle: string;
  senderName: string;
  tenantName: string;
  completedCount: number;
  requiredCount: number;
  canFinish: boolean;
  onFinish: () => void;
  onDecline: () => void;
  onFinishLater: () => void;
  onDownloadOriginal: () => void;
  recipientName: string;
  recipientEmail: string;
  envelopeId: string;
  isFinishing: boolean;
}
```

Layout (sticky top, full-width, z-50):
- Left: "Secure E-Sign" micro-badge, envelope title, "Sent by [senderName] · [tenantName]"
- Center: Progress bar + text "`3 of 7` required fields completed"
- Right: "Other Options" dropdown menu (using a simple popover) → Finish Later, Decline to Sign, Download Original, Session Information. Then primary CTA button: "Continue" when fields remain, "Finish" when all required done.

The "Other Options" dropdown is a button that toggles a positioned menu (no need for a library — a simple `useState` toggle with click-outside close).

Session Information shows: recipient name, email, envelope ID in a small popover.

- [ ] **Step 2: Verify it compiles**

- [ ] **Step 3: Commit**

```
feat(esigning): add signing header with progress and options menu
```

---

### Task 4: Create interactive field overlay component

Fields are rendered as absolutely-positioned elements on top of the PDF. Each field shows its type, label, and responds to clicks. This is the core of the in-document signing experience.

**Files:**
- Create: `src/components/esigning/signing/esigning-field-overlay.tsx`

**Reference:** Design spec section 3.6 (field states), DocuSign screenshot 3 (fields on document).

- [ ] **Step 1: Create the field overlay component**

This component renders inside the DocumentPageViewer's `renderHighlightContent` callback. It receives the field definition, current value state, and interaction callbacks.

```typescript
type FieldOverlayState = 'unfilled-required' | 'unfilled-optional' | 'active' | 'filled';

interface EsigningFieldOverlayProps {
  field: EsigningFieldDefinitionDto;
  state: FieldOverlayState;
  value?: string | null;
  signatureDataUrl?: string | null;
  isActive: boolean;
  recipientColor: string;
  onClick: () => void;
  pixelRect: { x: number; y: number; width: number; height: number };
}
```

Visual states (per design spec section 3.6):
- **Unfilled required**: Pulsing border in recipient color, type icon + action label text, semi-transparent background
- **Unfilled optional**: Dashed border, "optional" text, muted
- **Active/focused**: Solid border, elevated shadow (ring-2), slightly brighter background
- **Filled**: Show content (signature image, text value, checkmark), subtle checkmark badge in corner, muted border

For signature/initials fields: when filled, render the signature data URL as a small image. When unfilled, show "Sign" / "Initial" label.
For text/name/title/company: show the value text or placeholder.
For checkbox: show a checkmark or empty box.
For date_signed: show the date or "Date" placeholder.

Use Tailwind `animate-pulse` for the pulsing effect on unfilled required fields.

- [ ] **Step 2: Verify it compiles**

- [ ] **Step 3: Commit**

```
feat(esigning): add interactive field overlay component for signing
```

---

### Task 5: Create post-it bookmark tab

The "Sign Here" / "Initial Here" tab that sticks out from the left edge of the active field, scrolls between fields, and transforms to "Finish" when all required fields are done.

**Files:**
- Create: `src/components/esigning/signing/esigning-post-it-tab.tsx`

**Reference:** Design spec section 3.5, DocuSign screenshot 3 (Sign tab on left).

- [ ] **Step 1: Create the post-it tab component**

```typescript
interface EsigningPostItTabProps {
  /** Label based on field type: "Sign", "Initial", "Fill", "Check", "Date" */
  label: string;
  /** Whether all required fields are complete (shows "Finish" instead) */
  isComplete: boolean;
  /** Position relative to the active field — top offset in pixels */
  topOffset: number;
  onClick: () => void;
  onNext: () => void;
  onPrevious: () => void;
  currentIndex: number;
  totalCount: number;
}
```

Visual design:
- Shaped like a folded tab sticking out from the left edge (negative left margin, ~120px wide)
- Background: `#294d44` (Oakcloud teal) with white text
- Small icon (Pen for signature, Type for text, Check for checkbox, Calendar for date)
- Shadow for depth
- Arrow indicators for next/previous field
- When `isComplete`: transform label to "Finish" with green background
- Compact nav: "Field 3 of 7" text + previous/next arrows

Positioning: The tab is absolutely positioned relative to the PDF container. The `topOffset` is calculated by the parent based on the active field's y-coordinate.

- [ ] **Step 2: Verify it compiles**

- [ ] **Step 3: Commit**

```
feat(esigning): add post-it bookmark tab navigation component
```

---

### Task 6: Create "Adopt Your Signature" modal

Replaces the inline SignaturePad with a proper modal that has Draw/Type tabs, name/initials fields, and "Apply to all" checkbox.

**Files:**
- Create: `src/components/esigning/signing/esigning-signature-modal.tsx`

**Reference:** Design spec section 3.7, DocuSign screenshot 3 (Adopt Your Signature modal).

- [ ] **Step 1: Create the signature modal component**

```typescript
interface EsigningSignatureModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdopt: (result: { dataUrl: string; applyToAll: boolean }) => void;
  mode: 'SIGNATURE' | 'INITIALS';
  recipientName: string;
  existingSignature?: string | null;
}
```

Layout (Modal, size 2xl):
- Title: "Adopt Your Signature" / "Adopt Your Initials"
- Full Name field (pre-filled with recipientName, editable)
- Initials field (auto-derived from name initials)
- Two tabs: **Draw** | **Type**
  - Draw: Existing `SignaturePad` component wrapped in a larger canvas area
  - Type: Text input rendered in a handwriting-style font. Use system cursive as a practical fallback (`font-family: 'Segoe Script', 'Bradley Hand', cursive`). Show a preview of the typed name in the handwriting font.
- "Apply to all [Signature/Initials] fields" checkbox
- Footer: Cancel (secondary), "Adopt and Sign" (primary, disabled until signature exists)
- Legal text: "By selecting Adopt and Sign, I agree that the signature and initials will be the electronic representation..."

- [ ] **Step 2: Verify it compiles**

- [ ] **Step 3: Commit**

```
feat(esigning): add Adopt Your Signature modal with Draw/Type tabs
```

---

### Task 7: Create completion screen

After the signer clicks Finish, they land on a summary screen with timeline, download actions, and success messaging.

**Files:**
- Create: `src/components/esigning/signing/esigning-completion-screen.tsx`

**Reference:** Design spec section 3.8-3.9, DocuSign screenshot 3 (completion timeline + Finish menu).

- [ ] **Step 1: Create the completion screen component**

```typescript
interface EsigningCompletionScreenProps {
  envelopeTitle: string;
  recipientName: string;
  signedAt: string;
  isAllPartiesDone: boolean; // true if envelope status is COMPLETED
  documents: Array<{ id: string; fileName: string; signedPdfUrl: string | null }>;
  downloadToken: string | null;
  certificateId: string;
  onClose: () => void;
}
```

Layout (full-page centered, max-w-2xl):
- Large green checkmark icon
- Title: "Completed" if all parties done, "Your part is complete" if sequential with remaining signers
- Subtitle: "All parties will receive a completed copy" / "Sender has been notified"
- Timeline snippet (3 steps with connecting line):
  1. "You received a request to sign" (green dot)
  2. "You signed" (green dot) + timestamp
  3. "Sender has been notified" / "Completed — all parties received a completed copy" (green/gray dot)
- Action buttons:
  - "Save a Copy" (if download available — links to download URL with token)
  - "View Certificate" (links to `/verify/[certificateId]`)
  - "Close" (secondary)
- If documents are still processing: "Your signed documents are being prepared. You'll receive them by email shortly."

- [ ] **Step 2: Verify it compiles**

- [ ] **Step 3: Commit**

```
feat(esigning): add post-sign completion screen with timeline
```

---

### Task 8: Create decline modal

Extract the inline decline form into a proper modal.

**Files:**
- Create: `src/components/esigning/signing/esigning-decline-modal.tsx`

- [ ] **Step 1: Create the decline modal**

```typescript
interface EsigningDeclineModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDecline: (reason: string) => void;
  isSubmitting: boolean;
}
```

Layout (Modal):
- Title: "Decline to Sign"
- Warning text: "Are you sure you want to decline? The sender will be notified and the envelope will be cancelled for all parties."
- Textarea for reason (required, min 3 chars)
- Footer: Cancel, "Decline" (danger variant)

- [ ] **Step 2: Commit**

```
feat(esigning): add decline modal component
```

---

### Task 9: Rewrite the signer page orchestrator

Rewrite `esigning-sign-page.tsx` to orchestrate the new components in a proper flow state machine.

**Files:**
- Rewrite: `src/components/esigning/esigning-sign-page.tsx`

- [ ] **Step 1: Design the flow state machine**

States:
```typescript
type SigningFlowState =
  | 'loading'           // Initial token exchange
  | 'requires-code'     // Access code entry
  | 'consent'           // Consent & disclosure screen
  | 'signing'           // Main signing view
  | 'completed'         // Post-sign summary
  | 'declined'          // Decline confirmation
  | 'error';            // Error state
```

Transitions:
- `loading` → `requires-code` | `consent` | `signing` | `error`
- `requires-code` → `consent` | `signing` | `error`
- `consent` → `signing` | `declined`
- `signing` → `completed` | `declined`
- `completed` → (terminal)
- `declined` → (terminal)

If `session.recipient.consentedAt` exists, skip `consent` → go to `signing`.
If `session.recipient.signedAt` exists, go to `completed`.

- [ ] **Step 2: Implement the signing view layout**

The `signing` state renders:
1. `EsigningSigningHeader` (sticky top)
2. Document tab bar (pill-style tabs for each document, with "Needs Action" / "Review Only" labels)
3. PDF viewer (DocumentPageViewer) with interactive field overlays
4. `EsigningPostItTab` positioned at the active field
5. `EsigningSignatureModal` (opens when signature/initials field clicked)
6. `EsigningDeclineModal` (opens from header Other Options)

Field navigation logic:
- Track `activeFieldIndex` — the index into the sorted fields array for the current unfilled required field
- When a field overlay is clicked → if it's a signature/initials field, open the signature modal; if it's a text field, show an inline input; if it's a checkbox, toggle it
- After filling a field → auto-advance to the next unfilled required field (across pages/documents if needed)
- When all required fields filled → post-it transforms to "Finish"
- Finish button → call `completeSigning()` → transition to `completed` state

Auto-save: debounce field value saves (500ms after last change).

- [ ] **Step 3: Wire up all state transitions**

Each screen component gets appropriate callbacks:
- Consent screen `onConsent` → calls `recordConsent()` API → sets flow to `signing`
- Consent screen `onDecline` → opens decline modal
- Header `onFinish` → calls `completeSigning()` → sets flow to `completed`
- Header `onDecline` → opens decline modal
- Header `onFinishLater` → saves progress, shows toast "Progress saved. Return via the same link."
- Decline modal `onDecline` → calls `declineSigning()` API → sets flow to `declined`

- [ ] **Step 4: Handle document switching with field awareness**

State management:
- `selectedDocumentId: string` — starts as `session.documents[0]?.id`
- `viewerPage: number` — resets to `1` whenever `selectedDocumentId` changes (use `useEffect` watching `selectedDocumentId`)
- The active field index (`activeFieldIndex`) is a global index into the sorted all-document fields array. When advancing, if the next unfilled field is on a different document, auto-set `selectedDocumentId` to that document's id (the `useEffect` above then resets the page)

Document tab bar (inline in this file — not a separate component):
```tsx
<div className="flex gap-2 border-b border-border-primary px-4 py-2">
  {session.documents.map((doc) => {
    const docFields = fields.filter(f => f.documentId === doc.id && f.required);
    const filled = docFields.filter(f => draftValues[f.id]?.value || draftValues[f.id]?.signatureDataUrl).length;
    const isActive = selectedDocumentId === doc.id;
    const needsAction = filled < docFields.length;
    return (
      <button key={doc.id} onClick={() => setSelectedDocumentId(doc.id)}
        className={isActive ? 'rounded-full border border-oak-primary bg-oak-primary/10 px-3 py-1.5 text-xs font-medium text-oak-primary'
          : 'rounded-full border border-border-primary bg-background-primary px-3 py-1.5 text-xs text-text-secondary'}>
        {doc.fileName}
        {needsAction
          ? <span className="ml-1.5 text-amber-500">{filled}/{docFields.length}</span>
          : <span className="ml-1.5 text-emerald-500">✓</span>}
      </button>
    );
  })}
</div>
```

- [ ] **Step 5: Verify type check**

Run: `npx tsc --noEmit --pretty false 2>&1 | grep -v safe-math`

- [ ] **Step 6: Commit**

```
feat(esigning): rewrite signer page with guided signing flow
```

---

## Chunk 2: Sender Detail Page — Step Wizard + Click-to-Place

The sender detail page (`esigning-detail-page.tsx`) currently shows everything on one flat page with numeric coordinate entry for fields. The design calls for a 3-step wizard: Upload & Recipients → Place Fields → Review & Send.

### File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/components/esigning/prepare/esigning-step-indicator.tsx` | Step progress indicator (1-2-3 bar) |
| Create | `src/components/esigning/prepare/esigning-step-upload.tsx` | Step 1: Documents + recipients |
| Create | `src/components/esigning/prepare/esigning-step-fields.tsx` | Step 2: Click-to-place fields on PDF |
| Create | `src/components/esigning/prepare/esigning-field-palette.tsx` | Left sidebar: recipient selector + field type buttons |
| Create | `src/components/esigning/prepare/esigning-field-canvas.tsx` | PDF viewer wrapper with draggable/clickable field placement |
| Create | `src/components/esigning/prepare/esigning-step-review.tsx` | Step 3: Summary + send |
| Create | `src/components/esigning/prepare/esigning-recipient-card.tsx` | Recipient row card with color rail + inline actions |
| Rewrite | `src/components/esigning/esigning-detail-page.tsx` | Orchestrator — manages wizard steps |

### Task 10: Create step indicator

**Files:**
- Create: `src/components/esigning/prepare/esigning-step-indicator.tsx`

**Reference:** Dropbox Sign screenshot 1 (step bar: Select documents → Add signers → Place fields → Review and send).

- [ ] **Step 1: Create the step indicator component**

```typescript
interface EsigningStepIndicatorProps {
  currentStep: 1 | 2 | 3;
  canProceedToStep2: boolean; // has docs + signers
  canProceedToStep3: boolean; // has fields placed
}
```

Layout (horizontal bar with 3 connected circles/segments):
- Step 1: "Upload & Recipients" — numbered circle + label
- Step 2: "Place Fields" — numbered circle + label
- Step 3: "Review & Send" — numbered circle + label
- Active step: filled circle in oak-primary, bold label
- Completed steps: checkmark in circle, green
- Future steps: gray circle, muted label
- Connecting lines between circles (colored when step complete)
- Disabled future steps are not clickable

- [ ] **Step 2: Commit**

```
feat(esigning): add step indicator component for envelope wizard
```

---

### Task 11: Create recipient card component

**Files:**
- Create: `src/components/esigning/prepare/esigning-recipient-card.tsx`

**Reference:** DocuSign screenshot 1 (recipient rows with color, role chip, actions), Design spec section 2.1 step 1.

- [ ] **Step 1: Create the recipient card**

```typescript
interface EsigningRecipientCardProps {
  recipient: EsigningEnvelopeRecipientDto;
  /** Envelope-level signing strategy (PARALLEL/SEQUENTIAL/MIXED) — controls whether per-recipient signingOrder number is shown */
  envelopeSigningOrder: EsigningSigningOrder;
  canEdit: boolean;
  onEdit: () => void;
  onRemove: () => void;
  onResend?: () => void;
  /** Validation warnings like "No signature field assigned" */
  warnings: string[];
}
```

Note: `recipient.signingOrder` (from `EsigningEnvelopeRecipientDto`) is `number | null` — the recipient's position in the signing queue. `envelopeSigningOrder` (from the envelope) is the `EsigningSigningOrder` enum (PARALLEL/SEQUENTIAL/MIXED) used to decide whether to show the position number at all.

Layout (bordered card with left color rail):
- Left edge: 4px color rail using `recipient.colorTag`
- Row content:
  - Signing order badge (circle with number, or "CC" for copy recipients) — only shown for sequential/mixed
  - Name (bold) + email (muted, below)
  - Role chip: "Needs to Sign" (primary color) or "Receives a Copy" (muted)
  - Access mode badge: small text showing "Email Link" / "Email + Code" / "Manual Link"
  - Status badge (for sent envelopes): using existing `RecipientStatusBadge`
- Right side: Edit button, Resend button (if applicable), Remove button (trash icon)
- Bottom: Warning strip if `warnings.length > 0` — amber background, warning icon, warning text
  - Example: "Signature field missing" / "No fields assigned"

- [ ] **Step 2: Commit**

```
feat(esigning): add recipient card with color rail and validation warnings
```

---

### Task 12: Create Step 1 — Upload & Recipients

**Files:**
- Create: `src/components/esigning/prepare/esigning-step-upload.tsx`

**Reference:** DocuSign screenshot 1 (upload area + recipient list), Dropbox Sign screenshot 1 (document selection + add signers).

- [ ] **Step 1: Create the upload & recipients step**

```typescript
interface EsigningStepUploadProps {
  envelope: EsigningEnvelopeDetailDto;
  // Envelope settings handlers
  onUpdateSettings: (settings: UpdateEsigningEnvelopeInput) => Promise<void>;
  isUpdating: boolean;
  // Document handlers
  onUploadDocuments: (files: FileList) => Promise<void>;
  isUploading: boolean;
  onDeleteDocument: (documentId: string) => void;
  // Recipient handlers
  onAddRecipient: () => void; // opens modal
  onEditRecipient: (recipientId: string) => void;
  onRemoveRecipient: (recipientId: string) => void;
  // Company search data
  companies: Array<{ id: string; name: string; uen: string }>;
  companiesLoading: boolean;
}
```

Layout (two-column on desktop, stacked on mobile):

**Left column — Documents:**
- Drag-and-drop zone (dashed border, upload icon, "Drop PDFs here or click to browse")
- Uploaded document list: cards with filename, page count, file size, delete button
- File size limit note

**Right column — Settings + Recipients:**
- Envelope settings form (title, message, signing order, expiration, company) — compact version of current settings form
- Recipient list using `EsigningRecipientCard` components
- "Add recipient" button at bottom
- Validation summary at bottom: count of documents, count of signers, any blocking issues

Primary CTA at bottom: "Next: Place Fields" — disabled until at least 1 document and 1 signer exist.

- [ ] **Step 2: Verify it compiles**

- [ ] **Step 3: Commit**

```
feat(esigning): add Step 1 upload & recipients component
```

---

### Task 13: Create field palette sidebar

**Files:**
- Create: `src/components/esigning/prepare/esigning-field-palette.tsx`

**Reference:** Dropbox Sign screenshot 2 (Fields panel: Signature, Initials, Date signed, Full name, etc.), Design spec section 2.1 step 2.

- [ ] **Step 1: Create the field palette**

```typescript
interface EsigningFieldPaletteProps {
  recipients: EsigningEnvelopeRecipientDto[];
  selectedRecipientId: string;
  onRecipientChange: (recipientId: string) => void;
  activeFieldType: EsigningFieldType | null;
  onFieldTypeSelect: (type: EsigningFieldType | null) => void;
  /** Per-recipient field summary */
  recipientFieldCounts: Map<string, { required: number; optional: number; hasSignature: boolean }>;
}
```

Layout (vertical sidebar, ~240px wide):
- **Recipient selector:** Dropdown with color dot next to each name. Selected recipient shown with their color.
- **Recipient summary:** Below selector, one line: "Ray Client — 3 required, 1 optional" with warning icon if no signature field.
- **Signature fields section:**
  - Signature button (large, with pen icon)
  - Initials button (with "Au" icon)
- **Auto-fill fields section:**
  - Date Signed
  - Name
  - Company
  - Title
- **Standard fields section:**
  - Text
  - Checkbox

Each field type button:
- Icon + label
- Highlighted when active (selected for placement)
- Click toggles placement mode on/off
- Active state: primary color background, tooltip "Click on document to place"

- [ ] **Step 2: Commit**

```
feat(esigning): add field palette sidebar for sender field placement
```

---

### Task 14: Create field canvas (PDF viewer with click-to-place)

**Files:**
- Create: `src/components/esigning/prepare/esigning-field-canvas.tsx`

**Reference:** DocuSign screenshot 2 (document view with fields), Dropbox Sign screenshot 2 (field placement on PDF), Design spec section 2.2.

- [ ] **Step 1: Create the field canvas wrapper**

```typescript
interface PlacedField extends EsigningFieldDefinitionInput {
  localId: string;
}

interface EsigningFieldCanvasProps {
  documents: EsigningEnvelopeDocumentDto[];
  selectedDocumentId: string;
  onDocumentChange: (documentId: string) => void;
  fields: PlacedField[];
  onFieldsChange: (fields: PlacedField[]) => void;
  selectedFieldId: string | null;
  onFieldSelect: (fieldId: string | null) => void;
  /** Currently active placement mode (null = select mode) */
  placementType: EsigningFieldType | null;
  placementRecipientId: string;
  recipients: EsigningEnvelopeRecipientDto[];
  viewerPage: number;
  onPageChange: (page: number) => void;
}
```

Layout:
- **Document tab bar** at top: pills for each document with filename
- **PDF viewer area:** Uses `DocumentPageViewer` with custom highlight rendering
- **Field overlays** rendered via the `renderHighlightContent` callback on DocumentPageViewer

Click-to-place interaction:
1. When `placementType` is set, the cursor area over the PDF shows a crosshair cursor (via CSS `cursor: crosshair`)
2. On click: calculate the normalized x/y coordinates from the click position relative to the canvas
3. Create a new field at that position with default dimensions based on field type:
   - SIGNATURE: 24% × 8%
   - INITIALS: 12% × 6%
   - DATE_SIGNED: 18% × 4%
   - NAME/TEXT/COMPANY/TITLE: 20% × 4%
   - CHECKBOX: 3% × 3%
4. Add the field to the fields array
5. Stay in placement mode (can place multiple)
6. Escape key or re-clicking the palette button exits placement mode

Field selection:
- Click an existing field overlay → select it (shows selection ring)
- Selected field shows: resize handles (corner squares), delete button (X icon in top-right corner)

Field dragging:
- Mousedown on a placed field → start drag
- Track mouse delta, update field x/y percentages
- Constrain to page bounds (0-1 range minus field dimensions)
- On mouseup → commit new position

Field property panel (shown when a field is selected):
- Appears below the palette or in a right sidebar
- Shows: assigned recipient (dropdown to reassign), field type (read-only), required toggle, label input, delete button

**Approach for click-to-place (no DocumentPageViewer changes needed for click):**

The `EsigningFieldCanvas` wraps `DocumentPageViewer` inside a relative-positioned container. A transparent `<div>` overlay sits on top of the DocumentPageViewer at `position: absolute; inset: 0; z-index: 10`. This overlay:
- Only receives pointer events when `placementType !== null` (otherwise `pointer-events-none`)
- Has `cursor: crosshair` when active
- On `onClick(event)`: gets `event.nativeEvent.offsetX / event.currentTarget.offsetWidth` = normalized x, same for y — these are the field coordinates
- The overlay dimensions match the DocumentPageViewer's rendered size (they share the same parent container)

Placed field overlays are rendered as absolutely-positioned HTML elements (not via `renderHighlightContent` which is for Task 1's signer view) on the same parent container, using the same normalized coordinates × container size. Use a `ref` on the container div + `useState` for container dimensions (updated via ResizeObserver) to convert percentages to pixels for positioning.

This approach does **not** require modifying `DocumentPageViewer` for the placement use case — the placement overlay div sits alongside it, not inside it.

- [ ] **Step 2: Verify it compiles**

- [ ] **Step 3: Commit**

```
feat(esigning): add click-to-place field canvas for sender preparation
```

---

### Task 15: Create Step 2 — Place Fields

**Files:**
- Create: `src/components/esigning/prepare/esigning-step-fields.tsx`

- [ ] **Step 1: Create the place fields step**

```typescript
interface EsigningStepFieldsProps {
  envelope: EsigningEnvelopeDetailDto;
  fields: PlacedField[];
  onFieldsChange: (fields: PlacedField[]) => void;
  onSaveFields: () => Promise<void>;
  isSaving: boolean;
}
```

Layout (three-column on desktop):
- **Left:** `EsigningFieldPalette` (~240px)
- **Center:** `EsigningFieldCanvas` (flex-1)
- **Right:** Field properties panel when a field is selected, or page thumbnail hints when not (~240px, collapsible)

Bottom bar: "Back" button (returns to step 1), "Save field layout" button, "Next: Review & Send" button (disabled until at least one field placed per signer).

Validation checks shown as warnings:
- Signer with no fields assigned
- Signer with no signature field
- Document with no fields (labeled "Review Only")

- [ ] **Step 2: Commit**

```
feat(esigning): add Step 2 field placement layout
```

---

### Task 16: Create Step 3 — Review & Send

**Files:**
- Create: `src/components/esigning/prepare/esigning-step-review.tsx`

**Reference:** Dropbox Sign screenshot 1 (Review and send page), Design spec section 2.1 step 3.

- [ ] **Step 1: Create the review & send step**

```typescript
interface EsigningStepReviewProps {
  envelope: EsigningEnvelopeDetailDto;
  onSend: () => Promise<void>;
  isSending: boolean;
  onBack: () => void;
  /** Manual links returned after send */
  manualLinks: EsigningManualLinkDto[];
}
```

Layout (single column, max-w-4xl centered):
- **Envelope summary card:**
  - Title, signing order badge, expiration date, company link
  - Message preview (if set)
- **Recipient summary cards:** For each recipient:
  - Name, email, role, access mode
  - Field count: "3 required fields, 1 signature"
  - Status badge: "Ready" (green) or "Missing signature field" (amber warning)
- **Document summary cards:** For each document:
  - Filename, page count
  - "Requires action" or "Review Only" badge
  - Field count per document
- **Pre-send validation panel:**
  - If there are blocking issues → list them with red X icons
  - If all clear → green checkmark "Ready to send"
- **Sticky footer:**
  - "Back" button
  - Total summary text: "2 documents, 3 signers, Parallel signing"
  - "Send Envelope" button (disabled if blocking validations exist) / "Get Link" if all recipients are manual-link mode

- [ ] **Step 2: Commit**

```
feat(esigning): add Step 3 review & send summary
```

---

### Task 17: Rewrite sender detail page orchestrator

**Files:**
- Rewrite: `src/components/esigning/esigning-detail-page.tsx`

- [ ] **Step 1: Design the wizard state**

```typescript
type WizardStep = 1 | 2 | 3;
```

The page maintains:
- `currentStep: WizardStep` — which step is shown
- `fields: PlacedField[]` — local field drafts (same as existing `fieldDrafts`)
- All existing mutation hooks (upload, add recipient, save fields, send, etc.)

For **draft envelopes**: show the 3-step wizard.
For **non-draft envelopes** (sent, in-progress, completed, etc.): show a read-only detail view with:
- Envelope info header (status, certificate ID, dates)
- Recipient list with status badges and resend/void actions
- Document list with download links
- Activity timeline (from `envelope.events`)
- For completed: download links for signed PDFs

- [ ] **Step 2: Implement wizard rendering**

```typescript
if (envelope.status === 'DRAFT') {
  return (
    <div>
      <EsigningStepIndicator currentStep={currentStep} ... />
      {currentStep === 1 && <EsigningStepUpload ... />}
      {currentStep === 2 && <EsigningStepFields ... />}
      {currentStep === 3 && <EsigningStepReview ... />}
    </div>
  );
}

// Non-draft: read-only detail view
return <EsigningDetailReadView envelope={envelope} ... />;
```

- [ ] **Step 3: Extract read-only detail view**

For non-draft envelopes, extract the current detail view into a clean read-only presentation. Reuse most of the existing sections (recipients, documents, events) but remove the edit controls and field placement form.

Add an **activity timeline** section using `envelope.events`:
- Chronological list with event icons
- "Created" → "Sent" → "Viewed by X" → "Signed by X" → "Completed"
- Collapse older events behind "Show more" if > 5

- [ ] **Step 4: Wire up wizard navigation**

- Step 1 → Step 2: Save envelope settings first, validate docs + recipients exist
- Step 2 → Step 3: Save field layout first, validate fields exist
- Step 2 → Step 1: No save needed (fields kept in local state)
- Step 3 → Step 2: No save needed
- Step 3 Send: calls `sendEnvelope.mutateAsync()`
- Back button at top always returns to envelope list

- [ ] **Step 5: Preserve existing modal infrastructure**

Keep the existing recipient add/edit modal, manual links modal, void confirmation, and delete confirmations. They just get triggered from the new step components instead of the old flat layout.

- [ ] **Step 6: Verify type check**

Run: `npx tsc --noEmit --pretty false 2>&1 | grep -v safe-math`

- [ ] **Step 7: Commit**

```
feat(esigning): rewrite sender detail page with 3-step wizard
```

---

## Chunk 3: Verification Page + List Page Polish

### File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Rewrite | `src/components/esigning/esigning-verify-page.tsx` | Enhanced timeline + certificate presentation |
| Modify | `src/components/esigning/esigning-list-page.tsx` | Add filter tabs, table layout improvements |

### Task 18: Enhance verification page

**Files:**
- Rewrite: `src/components/esigning/esigning-verify-page.tsx`

**Reference:** Dropbox Sign screenshot 2 (Audit trail page), Design spec section 4.4-4.5.

- [ ] **Step 1: Add timeline-style audit trail**

Replace the flat recipient list with a vertical timeline:
- Left: vertical line connecting event dots
- Each event: colored dot (green for positive, gray for neutral), timestamp, description
- Events derived from the recipients array:
  - "Sent for signature to [name]" (inferred from recipient existence)
  - "Viewed by [name]" (if viewedAt exists)
  - "Signed by [name]" (if signedAt exists)
  - "Completed" (if completedAt exists)
- Timeline events sorted chronologically

- [ ] **Step 2: Improve certificate header**

Replace the plain header with a certificate-style presentation:
- Oakcloud logo/badge
- "Certificate of Completion" heading
- Certificate ID in monospace font
- Status with large colored dot
- Completion date prominent

- [ ] **Step 3: Improve document cards**

Each document card shows:
- Filename + file icon
- Hash (truncated with copy button)
- "Signed artifact stored" / "Original hash only" badge
- Visual: use a card with subtle green border if signed

- [ ] **Step 4: Improve verification upload section**

- Clearer instructions
- Drag-and-drop zone (not just plain file input)
- Result shows larger success/failure indicator
- Match result shows which document matched

- [ ] **Step 5: Verify type check and commit**

```
feat(esigning): enhance verification page with timeline and certificate design
```

---

### Task 19: Improve list page with filter tabs

**Files:**
- Modify: `src/components/esigning/esigning-list-page.tsx`

**Reference:** DocuSign screenshot 3 (bottom: list with status tabs), Design spec section 5.2.

- [ ] **Step 1: Add filter tab bar**

Replace the status dropdown with clickable tab pills:
- "All" | "Needs Attention" | "Waiting" | "Completed" | "Voided/Expired"
- Each tab shows a count badge
- Active tab: primary color underline/fill
- "Needs Attention" = DRAFT + DECLINED + pdfGenerationStatus=FAILED
- "Waiting" = SENT + IN_PROGRESS
- "Completed" = COMPLETED
- "Voided/Expired" = VOIDED + EXPIRED

The tabs map to the existing `status` filter parameter but with grouped logic.

- [ ] **Step 2: Improve envelope cards with recipient status indicators**

Add status icons next to recipient names in the card:
- Checkmark (green) for signed
- Circle (blue) for current/viewing
- Square (gray) for queued
- X (red) for declined
- Use a compact inline layout

- [ ] **Step 3: Add "last activity" info to cards**

Show the most recent event description on each card: "Ray signed 2h ago" / "Waiting for Sarah" / "Draft — 2 documents ready"

- [ ] **Step 4: Verify type check and commit**

```
feat(esigning): add filter tabs and improved cards to list page
```

---

### Task 20: Final verification pass

- [ ] **Step 1: Run full type check**

```bash
npx tsc --noEmit --pretty false 2>&1 | grep -v safe-math
```

Expected: No new errors from e-signing files.

- [ ] **Step 2: Run ESLint on all new/modified files**

```bash
npx eslint src/components/esigning src/hooks/use-esigning.ts "src/app/(dashboard)/esigning" src/app/esigning src/app/verify --max-warnings=0
```

- [ ] **Step 3: Visual smoke test**

Open the app and verify:
1. `/esigning` — list page loads with filter tabs
2. `/esigning/[id]` — draft shows wizard, non-draft shows read-only detail
3. `/esigning/sign/[token]` — consent → signing → completion flow works
4. `/verify/[certificateId]` — timeline and certificate render

- [ ] **Step 4: Commit any fixes**

```
fix(esigning): address type/lint issues from UX overhaul
```
