# BizFile Conflict Detection & Deferred Save — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When uploading a BizFile to create a new company, detect if the UEN already exists (active or soft-deleted) and prompt the user before creating any records — and ensure cancellation leaves no orphan records.

**Architecture:** Split the extract endpoint into two phases: extract-only (no company writes, returns conflict info) and confirm (actually saves the company). Add a document DELETE endpoint for cleanup on cancel. Add a permanent-delete function for soft-deleted companies. Update the upload UI to handle conflict dialogs.

**Tech Stack:** Next.js App Router, Prisma, TypeScript, React (no new libraries needed)

---

## Task 1: Add `permanentDeleteCompany` to company service

The IN_RECYCLE_BIN flow requires hard-deleting a soft-deleted company and all its data before creating a new one. This mirrors what the admin purge does.

**Files:**
- Modify: `src/services/company.service.ts`

**Step 1: Read the file to find the end of `restoreCompany`**

Read `src/services/company.service.ts` around line 540 to find the end of `restoreCompany` and where to insert the new function.

**Step 2: Add `permanentDeleteCompany` after `restoreCompany`**

Insert after the closing brace of `restoreCompany`:

```typescript
// ============================================================================
// Permanent Delete Company (hard delete — only for soft-deleted companies)
// ============================================================================

export async function permanentDeleteCompany(
  id: string,
  params: TenantAwareParams
): Promise<void> {
  const { tenantId, userId } = params;

  const existing = await prisma.company.findFirst({
    where: { id, tenantId },
  });

  if (!existing) {
    throw new Error('Company not found');
  }

  if (!existing.deletedAt) {
    throw new Error('Company must be soft-deleted before permanent deletion');
  }

  await createAuditLog({
    tenantId,
    userId,
    companyId: existing.id,
    action: 'DELETE',
    entityType: 'Company',
    entityId: existing.id,
    entityName: existing.name,
    summary: `Permanently deleted company "${existing.name}" (UEN: ${existing.uen})`,
    changeSource: 'MANUAL',
    reason: 'Permanent deletion to allow re-creation via BizFile upload',
    metadata: { uen: existing.uen, name: existing.name, permanent: true },
  });

  await prisma.$transaction(async (tx) => {
    await tx.companyCharge.deleteMany({ where: { companyId: id } });
    await tx.companyShareholder.deleteMany({ where: { companyId: id } });
    await tx.shareCapital.deleteMany({ where: { companyId: id } });
    await tx.companyOfficer.deleteMany({ where: { companyId: id } });
    await tx.companyAddress.deleteMany({ where: { companyId: id } });
    await tx.companyFormerName.deleteMany({ where: { companyId: id } });
    await tx.companyContact.deleteMany({ where: { companyId: id } });
    await tx.userCompanyAssignment.deleteMany({ where: { companyId: id } });
    await tx.userRoleAssignment.deleteMany({ where: { companyId: id } });
    // Note: Documents linked to this company are left in place (they become unlinked)
    await tx.document.updateMany({
      where: { companyId: id },
      data: { companyId: null },
    });
    await tx.company.delete({ where: { id } });
  });
}
```

**Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```
Expected: no errors related to the new function.

**Step 4: Commit**

```bash
git add src/services/company.service.ts
git commit -m "feat: add permanentDeleteCompany for hard-deleting soft-deleted companies"
```

---

## Task 2: Add permanent delete API endpoint for companies

Expose `permanentDeleteCompany` via `DELETE /api/companies/:id?action=permanent`.

**Files:**
- Modify: `src/app/api/companies/[id]/route.ts`

**Step 1: Import the new service function**

In `src/app/api/companies/[id]/route.ts`, add `permanentDeleteCompany` to the import from `@/services/company.service`:

```typescript
import {
  getCompanyById,
  getCompanyFullDetails,
  updateCompany,
  deleteCompany,
  restoreCompany,
  permanentDeleteCompany,
} from '@/services/company.service';
```

**Step 2: Add permanent delete handling inside the existing `DELETE` handler**

Replace the current `DELETE` handler body with one that checks for `?action=permanent`:

```typescript
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    const { id } = await parseIdParams(params);
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');

    // Check permission - allows SUPER_ADMIN and TENANT_ADMIN
    await requirePermission(session, 'company', 'delete', id);

    const tenantResult = await requireTenantContext(
      session,
      searchParams.get('tenantId')
    );
    if ('error' in tenantResult) return tenantResult.error;
    const tenantId = tenantResult.tenantId;

    const existingCompany = await prisma.company.findUnique({
      where: { id, tenantId },
      select: { tenantId: true },
    });

    if (!existingCompany) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 });
    }

    if (action === 'permanent') {
      await permanentDeleteCompany(id, {
        tenantId: existingCompany.tenantId,
        userId: session.id,
      });
      return NextResponse.json({ success: true });
    }

    // Default: soft delete
    const body = await request.json();
    const data = deleteCompanySchema.parse({ id, reason: body.reason });

    const company = await deleteCompany(
      data.id,
      { tenantId: existingCompany.tenantId, userId: session.id },
      data.reason
    );

    return NextResponse.json(company);
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'Unauthorized') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      if (error.message === 'Forbidden' || error.message.startsWith('Permission denied')) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      if (error.message === 'Company not found') {
        return NextResponse.json({ error: 'Company not found' }, { status: 404 });
      }
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

**Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add src/app/api/companies/[id]/route.ts
git commit -m "feat: add permanent delete endpoint for companies (DELETE /api/companies/:id?action=permanent)"
```

---

## Task 3: Add DELETE endpoint for pending documents

Add `DELETE /api/documents/:documentId` to clean up a pending document record and its storage file when the user cancels.

**Files:**
- Create: `src/app/api/documents/[documentId]/route.ts`

**Step 1: Create the file**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { storage } from '@/lib/storage';

const CANCELLABLE_STATUSES = ['PENDING', 'PROCESSING', 'EXTRACTED', 'FAILED'];

/**
 * DELETE /api/documents/:documentId
 *
 * Cancel/clean up a pending document that has not yet been confirmed.
 * Deletes the storage file and the document record.
 * Only allowed for documents in PENDING, PROCESSING, EXTRACTED, or FAILED status.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> }
) {
  try {
    const session = await requireAuth();
    const { documentId } = await params;

    const document = await prisma.document.findUnique({
      where: { id: documentId },
    });

    if (!document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    // Check tenant access
    if (!session.isSuperAdmin && document.tenantId !== session.tenantId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Only allow uploader or admin to cancel
    if (
      document.uploadedById !== session.id &&
      !session.isSuperAdmin &&
      !session.isTenantAdmin
    ) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Only allow cancellation for pre-confirm statuses
    if (!CANCELLABLE_STATUSES.includes(document.extractionStatus || '')) {
      return NextResponse.json(
        { error: 'Document cannot be cancelled in its current status' },
        { status: 409 }
      );
    }

    // Delete storage file (best-effort)
    if (document.storageKey) {
      try {
        await storage.delete(document.storageKey);
      } catch {
        // Log but don't fail — record cleanup is more important
      }
    }

    // Delete the document record
    await prisma.document.delete({ where: { id: documentId } });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'Unauthorized') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

**Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/app/api/documents/[documentId]/route.ts
git commit -m "feat: add DELETE /api/documents/:id for cancelling pending document uploads"
```

---

## Task 4: Refactor extract endpoint — extract-only, no company writes

The extract endpoint currently calls `processBizFileExtraction` which saves the company immediately. Change it to:
1. Run AI extraction only
2. Check for UEN conflict
3. Store normalized data on the document (status = `EXTRACTED`)
4. Return extracted data + conflict info — no company writes

**Files:**
- Modify: `src/app/api/documents/[documentId]/extract/route.ts`

**Step 1: Read the current extract endpoint**

Read `src/app/api/documents/[documentId]/extract/route.ts` in full (already done — 203 lines).

**Step 2: Replace the handler**

The new endpoint removes the call to `processBizFileExtraction` and instead:
- Stores `extractedData` and sets `extractionStatus = 'EXTRACTED'` on the Document
- Queries for UEN conflicts

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { extractBizFileWithVision, normalizeExtractedData } from '@/services/bizfile';
import { mapEntityType } from '@/services/bizfile/types';
import { calculateCost, formatCost, getModelConfig } from '@/lib/ai';
import type { AIModel } from '@/lib/ai';
import { storage } from '@/lib/storage';
import { retrieveFYEFromACRA, isCompanyEntityType } from '@/lib/external/acra-fye';
import logger from '@/lib/logger';

const VISION_SUPPORTED_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
];

/**
 * POST /api/documents/:documentId/extract
 *
 * Extract data from a pending document using AI vision.
 * Stores extracted data on the document but does NOT create/update any company records.
 * Returns extracted data + conflict info (if UEN already exists).
 *
 * Conflict types:
 *   - IN_RECYCLE_BIN: company exists but is soft-deleted
 *   - ALREADY_EXISTS: company exists and is active
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> }
) {
  try {
    const session = await requireAuth();
    const { documentId } = await params;

    let modelId: AIModel | undefined;
    let additionalContext: string | undefined;
    try {
      const body = await request.json();
      modelId = body.modelId as AIModel | undefined;
      additionalContext = body.additionalContext as string | undefined;
    } catch {
      // No body or invalid JSON - use defaults
    }

    const document = await prisma.document.findUnique({
      where: { id: documentId },
    });

    if (!document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    if (!session.isSuperAdmin && document.tenantId !== session.tenantId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (
      document.uploadedById !== session.id &&
      !session.isSuperAdmin &&
      !session.isTenantAdmin
    ) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (document.extractionStatus === 'PROCESSING') {
      return NextResponse.json({ error: 'Extraction already in progress' }, { status: 409 });
    }

    if (!VISION_SUPPORTED_TYPES.includes(document.mimeType)) {
      return NextResponse.json(
        { error: `Unsupported file type: ${document.mimeType}. Supported types: PDF, PNG, JPG, WebP` },
        { status: 400 }
      );
    }

    await prisma.document.update({
      where: { id: documentId },
      data: { extractionStatus: 'PROCESSING' },
    });

    try {
      if (!document.storageKey) {
        throw new Error('Document has no storage key');
      }
      const fileBuffer = await storage.download(document.storageKey);
      const base64Data = fileBuffer.toString('base64');

      const extractionResult = await extractBizFileWithVision(
        { base64: base64Data, mimeType: document.mimeType },
        {
          modelId,
          additionalContext,
          tenantId: document.tenantId,
        }
      );

      // Optionally retrieve FYE from ACRA if not in BizFile
      const extractedEntityType = mapEntityType(extractionResult.data.entityDetails?.entityType);
      const hasFYE =
        extractionResult.data.financialYear?.endDay &&
        extractionResult.data.financialYear?.endMonth;

      if (!hasFYE && isCompanyEntityType(extractedEntityType)) {
        const companyName = extractionResult.data.entityDetails?.name;
        const uen = extractionResult.data.entityDetails?.uen;
        if (companyName && uen) {
          try {
            logger.info('FYE not in BizFile, attempting ACRA retrieval', { companyName, uen });
            const fyeResult = await retrieveFYEFromACRA(companyName, uen, extractedEntityType);
            if (fyeResult) {
              extractionResult.data.financialYear = {
                ...extractionResult.data.financialYear,
                endDay: fyeResult.day,
                endMonth: fyeResult.month,
              };
            }
          } catch (fyeError) {
            logger.warn('Failed to retrieve FYE from ACRA', { error: fyeError });
          }
        }
      }

      const normalizedData = normalizeExtractedData(extractionResult.data);
      const uen = normalizedData.entityDetails?.uen;

      // Check for UEN conflict
      let conflict: {
        type: 'IN_RECYCLE_BIN' | 'ALREADY_EXISTS';
        companyId: string;
        companyName: string;
        uen: string;
      } | null = null;

      if (uen) {
        const existingCompany = await prisma.company.findFirst({
          where: { tenantId: document.tenantId, uen },
          select: { id: true, name: true, uen: true, deletedAt: true },
        });

        if (existingCompany) {
          conflict = {
            type: existingCompany.deletedAt ? 'IN_RECYCLE_BIN' : 'ALREADY_EXISTS',
            companyId: existingCompany.id,
            companyName: existingCompany.name,
            uen: existingCompany.uen,
          };
        }
      }

      // Store extracted data on document, mark as EXTRACTED (awaiting confirm)
      await prisma.document.update({
        where: { id: documentId },
        data: {
          extractionStatus: 'EXTRACTED',
          extractedAt: new Date(),
          extractedData: normalizedData as object,
        },
      });

      const modelConfig = getModelConfig(extractionResult.modelUsed);
      let estimatedCost: number | undefined;
      let formattedCost: string | undefined;
      if (extractionResult.usage) {
        estimatedCost = calculateCost(
          extractionResult.modelUsed,
          extractionResult.usage.inputTokens,
          extractionResult.usage.outputTokens
        );
        formattedCost = formatCost(estimatedCost);
      }

      return NextResponse.json({
        success: true,
        extractedData: normalizedData,
        conflict,
        aiMetadata: {
          modelUsed: extractionResult.modelUsed,
          modelName: modelConfig.name,
          providerUsed: extractionResult.providerUsed,
          usage: extractionResult.usage,
          estimatedCost,
          formattedCost,
        },
      });
    } catch (extractionError) {
      await prisma.document.update({
        where: { id: documentId },
        data: {
          extractionStatus: 'FAILED',
          extractionError:
            extractionError instanceof Error ? extractionError.message : 'Unknown error',
        },
      });
      throw extractionError;
    }
  } catch (error) {
    console.error('BizFile extraction error:', error);
    if (error instanceof Error) {
      if (error.message === 'Unauthorized') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      if (error.message === 'Forbidden') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

**Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add src/app/api/documents/[documentId]/extract/route.ts
git commit -m "refactor: extract endpoint now extract-only with conflict detection, no company writes"
```

---

## Task 5: Refactor confirm endpoint — actually save the company

The confirm endpoint is currently a no-op. Make it call `processBizFileExtraction` using the stored `extractedData` from the document.

**Files:**
- Modify: `src/app/api/documents/[documentId]/confirm/route.ts`

**Step 1: Read the current confirm endpoint**

Already read — 68 lines. Key: it validates `extractionStatus === 'COMPLETED'` and returns `document.companyId`. We need to change this to accept `EXTRACTED` status and actually run the save.

**Step 2: Replace the handler**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { processBizFileExtraction } from '@/services/bizfile';
import type { ExtractedBizFileData } from '@/services/bizfile/types';

/**
 * POST /api/documents/:documentId/confirm
 *
 * Save the previously extracted BizFile data.
 * Creates/updates the company and all related records.
 * Document must be in EXTRACTED status (set by the extract endpoint).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> }
) {
  try {
    const session = await requireAuth();
    const { documentId } = await params;

    const document = await prisma.document.findUnique({
      where: { id: documentId },
    });

    if (!document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    if (!session.isSuperAdmin && document.tenantId !== session.tenantId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (
      document.uploadedById !== session.id &&
      !session.isSuperAdmin &&
      !session.isTenantAdmin
    ) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (document.extractionStatus !== 'EXTRACTED') {
      // Also accept COMPLETED for backwards compatibility with any in-flight docs
      if (document.extractionStatus === 'COMPLETED' && document.companyId) {
        return NextResponse.json({
          success: true,
          companyId: document.companyId,
        });
      }
      return NextResponse.json(
        { error: 'Document extraction not ready for confirmation' },
        { status: 400 }
      );
    }

    if (!document.extractedData) {
      return NextResponse.json(
        { error: 'No extracted data found on document' },
        { status: 400 }
      );
    }

    const result = await processBizFileExtraction(
      documentId,
      document.extractedData as unknown as ExtractedBizFileData,
      session.id,
      document.tenantId,
      document.storageKey || undefined,
      document.mimeType
    );

    return NextResponse.json({
      success: true,
      companyId: result.companyId,
      created: result.created,
    });
  } catch (error) {
    console.error('Document confirm error:', error);
    if (error instanceof Error) {
      if (error.message === 'Unauthorized') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

**Step 3: Check what `processBizFileExtraction` returns**

The function in `processor.ts` returns `Promise<ProcessingResult>`. Read the `ProcessingResult` type to confirm it has `companyId` and `created` fields.

```bash
grep -n "ProcessingResult" src/services/bizfile/processor.ts | head -10
```

**Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

**Step 5: Commit**

```bash
git add src/app/api/documents/[documentId]/confirm/route.ts
git commit -m "refactor: confirm endpoint now actually saves company via processBizFileExtraction"
```

---

## Task 6: Update upload page — handle conflict response and add dialogs

The UI currently calls extract and immediately shows the preview. It needs to:
1. Check the `conflict` field in the extract response
2. Show the appropriate blocking dialog
3. Call document DELETE on cancel
4. Proceed correctly on user confirmation

**Files:**
- Modify: `src/app/(dashboard)/companies/upload/page.tsx`

**Step 1: Add conflict state variables**

After the existing state declarations (around line 164), add:

```typescript
const [conflict, setConflict] = useState<{
  type: 'IN_RECYCLE_BIN' | 'ALREADY_EXISTS';
  companyId: string;
  companyName: string;
  uen: string;
} | null>(null);
const [conflictDialogOpen, setConflictDialogOpen] = useState(false);
const [conflictLoading, setConflictLoading] = useState(false);
```

**Step 2: Add `cleanupDocument` helper**

Add after `handleReset`:

```typescript
const cleanupDocument = async (docId: string) => {
  try {
    await fetch(`/api/documents/${docId}`, { method: 'DELETE' });
  } catch {
    // Best-effort cleanup
  }
};
```

**Step 3: Update `handleReset` to include new state**

Add to the `handleReset` function body:

```typescript
setConflict(null);
setConflictDialogOpen(false);
setConflictLoading(false);
```

**Step 4: Update `handleUploadAndExtract` to handle conflict**

In the non-update-mode branch (after `const { extractedData: data, companyId: cId, aiMetadata: metadata } = ...`), replace the three `set` calls and `setStep('preview')` with:

```typescript
const { extractedData: data, conflict: conflictData, aiMetadata: metadata } = await extractResponse.json();
setExtractedData(data);
setAiMetadata(metadata);

if (conflictData) {
  setConflict(conflictData);
  setConflictDialogOpen(true);
  setStep('upload'); // Stay on upload step until user resolves conflict
} else {
  setStep('preview');
}
```

Note: `companyId` is no longer returned by extract — it comes from confirm. Remove `setCompanyId(cId)` from this branch.

**Step 5: Add `handleConflictCancel`**

```typescript
const handleConflictCancel = async () => {
  setConflictDialogOpen(false);
  if (documentId) {
    await cleanupDocument(documentId);
  }
  handleReset();
};
```

**Step 6: Add `handleConflictPermanentDelete` (for IN_RECYCLE_BIN)**

```typescript
const handleConflictPermanentDelete = async () => {
  if (!conflict || !documentId) return;
  setConflictLoading(true);
  try {
    const response = await fetch(
      `/api/companies/${conflict.companyId}?action=permanent`,
      { method: 'DELETE' }
    );
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Failed to permanently delete company');
    }
    setConflictDialogOpen(false);
    setConflict(null);
    setStep('preview');
  } catch (err) {
    setError(err instanceof Error ? err.message : 'Failed to permanently delete company');
    setConflictDialogOpen(false);
  } finally {
    setConflictLoading(false);
  }
};
```

**Step 7: Add `handleConflictViewDiff` (for ALREADY_EXISTS)**

```typescript
const handleConflictViewDiff = async () => {
  if (!conflict || !documentId) return;
  // Clean up current pending document before redirecting
  await cleanupDocument(documentId);
  setConflictDialogOpen(false);
  router.push(`/companies/upload?companyId=${conflict.companyId}`);
};
```

**Step 8: Add conflict dialogs in the JSX**

Find the section near the end of the JSX where other dialogs or modals are rendered (before the closing tag of the main return). Add:

```tsx
{/* Conflict: Company in recycle bin */}
{conflictDialogOpen && conflict?.type === 'IN_RECYCLE_BIN' && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
    <div className="bg-background-primary border border-border-primary rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
      <div className="flex items-start gap-3 mb-4">
        <AlertCircle className="w-5 h-5 text-warning mt-0.5 shrink-0" />
        <div>
          <h3 className="text-base font-semibold text-text-primary mb-1">
            Company in Recycle Bin
          </h3>
          <p className="text-sm text-text-secondary">
            <span className="font-medium">{conflict.companyName}</span>{' '}
            ({conflict.uen}) is in the recycle bin. You must permanently delete it
            before creating a new record. This action cannot be undone.
          </p>
        </div>
      </div>
      <div className="flex gap-3 justify-end">
        <button
          onClick={handleConflictCancel}
          disabled={conflictLoading}
          className="btn-secondary btn-sm"
        >
          Cancel
        </button>
        <button
          onClick={handleConflictPermanentDelete}
          disabled={conflictLoading}
          className="btn-danger btn-sm flex items-center gap-2"
        >
          {conflictLoading && <Loader2 className="w-3 h-3 animate-spin" />}
          Permanently Delete &amp; Continue
        </button>
      </div>
    </div>
  </div>
)}

{/* Conflict: Company already exists (active) */}
{conflictDialogOpen && conflict?.type === 'ALREADY_EXISTS' && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
    <div className="bg-background-primary border border-border-primary rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
      <div className="flex items-start gap-3 mb-4">
        <AlertCircle className="w-5 h-5 text-warning mt-0.5 shrink-0" />
        <div>
          <h3 className="text-base font-semibold text-text-primary mb-1">
            Company Already Exists
          </h3>
          <p className="text-sm text-text-secondary">
            <span className="font-medium">{conflict.companyName}</span>{' '}
            ({conflict.uen}) already exists. Would you like to update it instead?
          </p>
        </div>
      </div>
      <div className="flex gap-3 justify-end">
        <button
          onClick={handleConflictCancel}
          className="btn-secondary btn-sm"
        >
          Cancel
        </button>
        <button
          onClick={handleConflictViewDiff}
          className="btn-primary btn-sm"
        >
          View Diff &amp; Update
        </button>
      </div>
    </div>
  </div>
)}
```

**Step 9: Update `handleConfirm` to set companyId from confirm response**

The confirm endpoint now returns `companyId`. Verify `handleConfirm` sets it:

```typescript
const { companyId: cId } = await response.json();
setCompanyId(cId);
setStep('complete');
```

This should already be correct — confirm.

**Step 10: Update `handleCancel` to clean up document on cancel from preview step**

In `handleCancel`, when `step === 'preview'`, add document cleanup:

```typescript
if (step === 'preview' || step === 'diff-preview') {
  if (step === 'preview' && documentId) {
    cleanupDocument(documentId); // Fire and forget
  }
  handleReset();
  return;
}
```

**Step 11: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

**Step 12: Commit**

```bash
git add src/app/(dashboard)/companies/upload/page.tsx
git commit -m "feat: add conflict detection dialogs to BizFile upload — prompt before creating duplicate companies"
```

---

## Task 7: Manual smoke test

Verify the full flows work end-to-end.

**Test A — No conflict (happy path):**
1. Upload a BizFile for a UEN that does not exist in the system
2. Extraction should complete, preview should appear
3. Click "Confirm & Save"
4. Company should be created and you should be redirected to the company page

**Test B — Company in recycle bin:**
1. Soft-delete an existing company (move it to recycle bin)
2. Upload a BizFile for the same UEN
3. After extraction, a dialog should appear: "Company in Recycle Bin"
4. Click "Cancel" — verify no new company was created, no orphan document remains
5. Repeat, but click "Permanently Delete & Continue"
6. Verify the old company is gone, the preview appears, and confirm creates a new company record

**Test C — Company already exists (active):**
1. Upload a BizFile for a UEN that has an active company
2. After extraction, a dialog should appear: "Company Already Exists"
3. Click "Cancel" — verify no duplicate was created, no orphan document remains
4. Repeat, but click "View Diff & Update"
5. Verify you are redirected to the diff-preview flow for the existing company

**Test D — Cancel at preview step:**
1. Upload a BizFile for a new UEN (no conflict)
2. When the preview appears, click "Cancel" (or Ctrl+Backspace)
3. Verify you return to the upload step and no company was created

---

## Task 8: Check for remaining references to old `created` field from extract response

The old extract endpoint returned `created: boolean`. Search for any UI code that used this.

```bash
grep -rn "created.*extract\|extract.*created" src/app/\(dashboard\)/companies/upload/
```

If found, remove those references since `created` is now returned by confirm.

**Commit if any changes:**

```bash
git add src/app/(dashboard)/companies/upload/page.tsx
git commit -m "fix: remove stale reference to created field from old extract response"
```
