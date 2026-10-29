# Resume Draft UI/UX Redesign

**Date:** 2026-03-09
**Scope:** `src/app/forms/f/[slug]/page.tsx` — public form view, resume draft section
**Approach:** Option B — Stateful card redesign

---

## Overview

The resume draft card and related draft interactions are redesigned around a 3-state card model that maps to the user's mental model: either a draft is active or it isn't. The modal is tightened and gains an email option on first save only.

---

## Section 1: Draft Card State Machine

The card at the top of page 1 (only shown when `draftSettings.enabled && !isPreview && currentPage === 0`) becomes a proper state machine.

### State: Idle (no `draftSession`)

Shown when no draft is active. Visual improvements over current:

- Cleaner layout: title + description stacked left, input + button right
- `Enter` key in the code input triggers `resumeDraftByCode`
- Resume errors (`draftError`) displayed below the input in `text-status-error` red — not plain gray
- Input auto-focuses when the card mounts (optional, only on desktop)

### State: Active (draft loaded or saved)

Replaces the idle card entirely once `draftSession` is set. Collapses to a slim banner:

- Left side: small green dot indicator + "Draft active" label + expiry in muted text
- Right side: "Update draft" button + "Copy link" icon button (`Copy` icon, no label)
- After a successful update save: brief inline "Draft updated · expires [date]" message for 3 seconds, then reverts to normal expiry display
- Save errors shown below the banner in `text-status-error`

### State: Hidden

When `draftSettings.enabled` is false or `isPreview` is true — not rendered (same as today).

---

## Section 2: Button Label Logic

- The "Save draft" button in the bottom nav bar reads **"Update draft"** when `!!draftSession`
- Label is derived from `draftSession` existence — no new state needed
- Every save call returns a fresh `DraftSession` (including new `expiresAt`); `applyResolvedDraftPayload` already updates `draftSession` — expiry resets automatically

---

## Section 3: Draft Saved Modal

**Shown on first save only** (`isFirstSave` flag — set to `true` initially, cleared to `false` after first successful save).

Subsequent "Update draft" saves: modal never opens. Instead show the inline "Draft updated" feedback in the active banner.

### Modal layout improvements

- **Draft code block:** Prominent monospace chip with `bg-oak-primary/8` green-tinted background — easily scannable
- **Resume URL:** Read-only input with an inline "Copy" icon button on the right edge (replaces the separate footer copy button)
- **Expiry:** Single muted line below the URL field — not a separate card block
- **Footer:** Only "Continue editing" (primary button) — copy link is inline

### Email step (new)

- Collapsible section below the code/URL block: "Send to my email" with chevron toggle
- Collapsed by default
- When expanded: email input + "Send" button
  - Email pre-filled if `EMAIL_HINT_PATTERN` matches any currently-filled form field value, else blank
  - Uses same email-sending infrastructure as PDF email flow (`pdfRecipientEmail` pattern)
- On send success: brief inline "Sent to [email]" confirmation, section auto-collapses
- On send error: inline error below the input

---

## Section 4: Feedback & Error State Split

Replace the single `draftFeedback` state with two separate states:

| State | Type | Styling |
|---|---|---|
| `draftError` | string \| null | `text-status-error` — errors (resume failed, save failed) |
| `draftFeedback` | string \| null | `text-text-secondary` — success/neutral (link copied, draft updated) |

- Resume errors appear below the code input (idle card)
- Save errors appear below the active banner
- "Draft updated" feedback auto-clears after 3 seconds via `setTimeout`
- "Resume link copied" feedback shown inline in the active banner (replaces old `draftFeedback`)

---

## New UI Labels Needed

```
draft_active: 'Draft active'
update_draft: 'Update draft'
updating_draft: 'Updating...'
draft_updated: 'Draft updated'
send_to_email: 'Send to my email'
draft_email_sent: 'Sent to {email}'
draft_email_failed: 'Failed to send'
draft_email_placeholder: 'name@example.com'
```

---

## Files to Change

- `src/app/forms/f/[slug]/page.tsx` — all UI and logic changes contained here

No backend changes required.
