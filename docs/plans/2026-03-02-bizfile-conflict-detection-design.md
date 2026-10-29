# BizFile Upload — Conflict Detection & Deferred Save

**Date:** 2026-03-02
**Status:** Approved

## Problem

When uploading a BizFile to create a new company, the system does not detect if the company already exists (active or soft-deleted). The `/extract` endpoint currently both extracts data AND immediately saves the company record — meaning the "Confirm & Save" button in the UI is a no-op and cancellation does not prevent record creation.

**Expected behavior:**
1. If company UEN is in the recycle bin → prompt user to permanently delete before creating new
2. If company UEN already exists (active) → prompt user to update instead, or cancel
3. If user cancels at any point → no company or document processing record is created

## Approach: Extract-Only First, Save on Confirm

Split the current extract endpoint into two distinct phases:

1. **Extract phase** — AI extraction only, conflict check, no company writes
2. **Confirm phase** — actual company creation and all related record writes

## Data Flow

```
POST /api/documents/upload
  Creates Document record (status=PENDING)

POST /api/documents/:id/extract
  AI extraction only
  Check UEN: active company? soft-deleted company?
  Store extractedData on Document, set status=EXTRACTED
  Return: extractedData + conflict (null | {type, companyId, name, uen})
  NO company writes

UI checks conflict field:
  null             -> show preview (no change to current flow)
  IN_RECYCLE_BIN   -> blocking dialog: permanently delete & continue, or cancel
  ALREADY_EXISTS   -> blocking dialog: view diff & update, or cancel

POST /api/documents/:id/confirm
  Reads extractedData from Document record
  Calls processBizFileExtraction (all company writes happen here)
  Returns companyId

DELETE /api/documents/:id  (new endpoint)
  Called on cancel at any point before confirm
  Deletes pending Document record and storage file
```

## Conflict Response Shape

```ts
conflict: null | {
  type: 'IN_RECYCLE_BIN' | 'ALREADY_EXISTS',
  companyId: string,
  companyName: string,
  uen: string,
}
```

## UI Dialog Behavior

### IN_RECYCLE_BIN
> "[Company Name] (UEN) is in the recycle bin. You must permanently delete it before creating a new record."

- **Permanently Delete & Continue** -> call permanent delete API -> call confirm -> proceed to preview
- **Cancel** -> call DELETE /api/documents/:id -> reset to upload step

### ALREADY_EXISTS
> "[Company Name] (UEN) already exists. Would you like to update it instead?"

- **View Diff & Update** -> redirect to `/companies/upload?companyId=<id>` (reuses existing diff-preview flow), call DELETE /api/documents/:id to clean up current pending doc
- **Cancel** -> call DELETE /api/documents/:id -> reset to upload step

## Backend Changes

### New extraction status: `EXTRACTED`
Add `EXTRACTED` to the `DocumentExtractionStatus` enum. Represents "data extracted and stored, awaiting user confirmation."

Transition path: `PENDING -> PROCESSING -> EXTRACTED -> COMPLETED`

### `/api/documents/:id/extract` (modified)
- Run AI extraction (unchanged)
- Check for UEN conflict (active: deletedAt IS NULL, soft-deleted: deletedAt IS NOT NULL)
- Update Document: extractionStatus = EXTRACTED, extractedData = normalized data
- Return extracted data + conflict object
- No company upsert

### `/api/documents/:id/confirm` (modified from no-op)
- Validate document has status EXTRACTED
- Read extractedData from Document record
- Call processBizFileExtraction(documentId, extractedData, ...) -- unchanged
- Return companyId

### `DELETE /api/documents/:id` (new)
- Validate ownership/access
- Only allow deletion if status is PENDING, PROCESSING, EXTRACTED, or FAILED
- Delete storage file
- Delete Document record

### `processBizFileExtraction` in `processor.ts`
- No changes needed -- it remains the source of truth for all company writes
- Called from confirm endpoint instead of extract endpoint

## Files to Change

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add EXTRACTED to DocumentExtractionStatus enum |
| `src/app/api/documents/[documentId]/extract/route.ts` | Remove company writes, add conflict check, set status=EXTRACTED |
| `src/app/api/documents/[documentId]/confirm/route.ts` | Make it actually call processBizFileExtraction |
| `src/app/api/documents/[documentId]/route.ts` (new) | DELETE endpoint for cleanup |
| `src/app/(dashboard)/companies/upload/page.tsx` | Handle conflict response, show dialogs, call cleanup on cancel |

## Out of Scope

- Changes to the update (diff-preview) flow -- not affected
- Document processing pipeline for already-linked documents -- not affected
