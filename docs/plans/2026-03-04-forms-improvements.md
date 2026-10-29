# Forms Feature Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all security vulnerabilities, eliminate code duplication, and improve UX across the Forms feature.

**Architecture:** Extract shared utilities from duplicated code across API routes and components. Fix security issues (XSS, MIME spoofing, orphan cleanup). Add UX improvements (confirmation dialogs, better shortcuts, structured response viewer, full CSV export).

**Tech Stack:** Next.js App Router, Prisma, React Query, DOMPurify (already installed), file-type v16 (already installed), Zod, @dnd-kit

---

### Task 1: Extract shared form utilities into `src/lib/form-utils.ts`

**Files:**
- Create: `src/lib/form-utils.ts`
- Modify: `src/services/form-builder.service.ts`
- Modify: `src/components/forms/builder-utils.ts`
- Modify: `src/app/forms/f/[slug]/page.tsx`

**Step 1: Create `src/lib/form-utils.ts`**

Extract duplicated functions and types into a single shared module:

```ts
import type { Prisma } from '@/generated/prisma';

// ============================================================================
// Shared Types
// ============================================================================

export interface PublicFormField {
  id: string;
  type: string;
  label: string | null;
  key: string;
  placeholder: string | null;
  subtext: string | null;
  helpText: string | null;
  inputType: string | null;
  options: unknown;
  validation: unknown;
  condition: unknown;
  isRequired: boolean;
  hideLabel: boolean;
  isReadOnly: boolean;
  layoutWidth: number;
  position: number;
}

export interface PublicFormDefinition {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  settings?: unknown;
  fields: PublicFormField[];
  status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
}

// ============================================================================
// Shared Constants
// ============================================================================

export const WIDTH_CLASS: Record<number, string> = {
  25: 'col-span-12 md:col-span-3',
  33: 'col-span-12 md:col-span-4',
  50: 'col-span-12 md:col-span-6',
  66: 'col-span-12 md:col-span-8',
  75: 'col-span-12 md:col-span-9',
  100: 'col-span-12',
};

// ============================================================================
// Shared Utility Functions
// ============================================================================

export function normalizeKey(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!cleaned) return 'field';
  if (/^[a-z]/.test(cleaned)) return cleaned;
  return `field_${cleaned}`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function parseObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function parseOptions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

export function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

export function evaluateCondition(
  condition: unknown,
  answers: Record<string, unknown>
): boolean {
  const cond = isRecord(condition) ? condition : parseObject(condition as Prisma.JsonValue | null);
  if (!cond) return true;

  const fieldKey = typeof cond.fieldKey === 'string' ? cond.fieldKey : null;
  const operator = typeof cond.operator === 'string' ? cond.operator : null;

  if (!fieldKey || !operator) return true;

  const actual = answers[fieldKey];
  const expected = cond.value;

  switch (operator) {
    case 'equals':
      return actual === expected;
    case 'not_equals':
      return actual !== expected;
    case 'contains':
      if (Array.isArray(actual)) return actual.includes(expected);
      if (typeof actual === 'string' && typeof expected === 'string') {
        return actual.toLowerCase().includes(expected.toLowerCase());
      }
      return false;
    case 'is_empty':
      return isEmptyValue(actual);
    case 'not_empty':
      return !isEmptyValue(actual);
    default:
      return true;
  }
}
```

**Step 2: Update `src/services/form-builder.service.ts`**

- Remove the local `normalizeKey`, `parseObject`, `isEmptyValue`, `evaluateCondition` functions
- Remove the local `PublicFormField` and `PublicFormDefinition` interfaces
- Add import: `import { normalizeKey, parseObject, isEmptyValue, evaluateCondition, type PublicFormField, type PublicFormDefinition } from '@/lib/form-utils';`

**Step 3: Update `src/components/forms/builder-utils.ts`**

- Remove the local `normalizeKey`, `isRecord`, `WIDTH_CLASS` definitions
- Add import: `import { normalizeKey, isRecord, WIDTH_CLASS } from '@/lib/form-utils';`
- Re-export `WIDTH_CLASS` for existing consumers: `export { WIDTH_CLASS } from '@/lib/form-utils';`

**Step 4: Update `src/app/forms/f/[slug]/page.tsx`**

- Remove the local `PublicField`, `PublicFormDefinition`, `WIDTH_CLASS`, `isRecord`, `parseOptions`, `isEmptyValue`, `evaluateCondition` definitions (lines 10-103)
- Add import: `import { WIDTH_CLASS, isRecord, parseOptions, isEmptyValue, evaluateCondition, type PublicFormField, type PublicFormDefinition } from '@/lib/form-utils';`
- Replace `PublicField` usage with `PublicFormField`

**Step 5: Verify build**

Run: `npx next build` — should compile with no errors.

---

### Task 2: Extract shared `resolveTenantId` into `src/lib/api-helpers.ts` and refactor API routes to use `createErrorResponse`

**Files:**
- Modify: `src/lib/api-helpers.ts` (add synchronous resolveTenantId)
- Modify: `src/app/api/forms/route.ts`
- Modify: `src/app/api/forms/[id]/route.ts`
- Modify: `src/app/api/forms/[id]/duplicate/route.ts`
- Modify: `src/app/api/forms/[id]/responses/route.ts`
- Modify: `src/app/api/forms/[id]/responses/[submissionId]/uploads/[uploadId]/route.ts`
- Modify: `src/app/api/forms/recent-submissions/route.ts`

**Step 1: Add synchronous `resolveTenantId` to `src/lib/api-helpers.ts`**

Add after existing exports:

```ts
/**
 * Synchronous tenant ID resolver for API routes.
 * Throws on missing tenant context (handled by createErrorResponse).
 */
export function resolveTenantId(
  session: SessionUser,
  requestedTenantId?: string | null
): string {
  if (session.isSuperAdmin) {
    const tenantId = requestedTenantId || session.tenantId;
    if (!tenantId) {
      throw new Error('Tenant context required');
    }
    return tenantId;
  }

  if (!session.tenantId) {
    throw new Error('Tenant context required');
  }

  return session.tenantId;
}
```

**Step 2: Refactor all 6 authenticated API routes**

For each route file, replace the local `resolveTenantId` with the shared import and replace the catch block with `createErrorResponse`. Example for `src/app/api/forms/route.ts`:

```ts
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { resolveTenantId, createErrorResponse } from '@/lib/api-helpers';
import { createFormSchema, listFormsQuerySchema } from '@/lib/validations/form-builder';
import { createForm, listForms } from '@/services/form-builder.service';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    await requirePermission(session, 'document', 'read');

    const { searchParams } = new URL(request.url);
    const tenantId = resolveTenantId(session, searchParams.get('tenantId'));

    const query = listFormsQuerySchema.parse({
      query: searchParams.get('query') || undefined,
      page: searchParams.get('page') ? Number(searchParams.get('page')) : 1,
      limit: searchParams.get('limit') ? Number(searchParams.get('limit')) : 20,
      status: searchParams.get('status') || undefined,
      sortBy: searchParams.get('sortBy') || 'updatedAt',
      sortOrder: searchParams.get('sortOrder') || 'desc',
    });

    const result = await listForms(query, { tenantId, userId: session.id });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid query', details: error.errors }, { status: 400 });
    }
    return createErrorResponse(error);
  }
}
```

Apply the same pattern to all 6 route files — remove local `resolveTenantId`, import shared one, replace catch blocks with `createErrorResponse(error)`. Keep `z.ZodError` checks where present since those have custom detail formatting.

**Step 3: Verify build**

Run: `npx next build`

---

### Task 3: Deduplicate types between service and hooks

**Files:**
- Modify: `src/hooks/use-forms.ts`

**Step 1: Replace duplicated interfaces with imports**

Remove the local `FormListItem`, `FormListResult`, `FormDetail`, `FormResponsesResult` interfaces (lines 9-35 approx) and import from the service:

```ts
import type {
  FormListItem,
  FormListResult,
  FormDetail,
  FormResponsesResult,
  RecentFormSubmissionItem,
} from '@/services/form-builder.service';
```

Remove the local `RecentFormSubmission` interface and use `RecentFormSubmissionItem` instead. Update type references in the hooks. Keep `FormListParams` as it's hook-specific.

**Step 2: Verify build**

---

### Task 4: Sanitize HTML field output with DOMPurify

**Files:**
- Modify: `src/app/forms/f/[slug]/page.tsx`

**Step 1: Add DOMPurify sanitization**

Replace the HTML field rendering block (around line 430-435):

```tsx
// Before:
<div className="text-sm text-text-primary" dangerouslySetInnerHTML={{ __html: field.subtext || '' }} />

// After:
import DOMPurify from 'dompurify';
// ... in the render:
<div
  className="text-sm text-text-primary"
  dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(field.subtext || '') }}
/>
```

Add `import DOMPurify from 'dompurify';` near the top imports.

**Step 2: Verify build**

---

### Task 5: Add server-side MIME type verification

**Files:**
- Modify: `src/services/form-builder.service.ts`

**Step 1: Add magic-byte MIME verification in `createPublicUpload`**

After reading the file buffer (line ~763), add MIME type verification:

```ts
import { fromBuffer } from 'file-type';

// Inside createPublicUpload, after: const content = Buffer.from(await file.arrayBuffer());
const detected = await fromBuffer(content);
const actualMime = detected?.mime || file.type || 'application/octet-stream';

if (allowedMimeTypes.length > 0 && !allowedMimeTypes.includes(actualMime)) {
  throw new Error('File type is not allowed');
}
```

Replace the existing client-reported MIME check (line ~756) with the above. Also use `actualMime` for the storage upload `contentType` and database record `mimeType`.

**Step 2: Verify build**

---

### Task 6: Increase slug entropy

**Files:**
- Modify: `src/services/form-builder.service.ts`

**Step 1: Change from 4 bytes to 8 bytes**

In `generateUniqueFormSlug` (line ~184):

```ts
// Before:
const slug = randomBytes(4).toString('hex');

// After:
const slug = randomBytes(8).toString('hex');
```

This increases slugs from 8 to 16 hex characters, making enumeration impractical.

**Step 2: Verify build**

---

### Task 7: Memoize `serializeBuilderState`

**Files:**
- Modify: `src/app/(dashboard)/forms/[id]/builder/page.tsx`

**Step 1: Wrap in useMemo**

Replace lines ~113-119:

```tsx
// Before:
const stateSnapshot = serializeBuilderState({
  title, description, status, tags, fields,
});

// After:
const stateSnapshot = useMemo(
  () => serializeBuilderState({ title, description, status, tags, fields }),
  [title, description, status, tags, fields]
);
```

Make sure `useMemo` is imported from React (it likely already is).

**Step 2: Verify build**

---

### Task 8: Fix keyboard shortcut conflicts

**Files:**
- Modify: `src/app/(dashboard)/forms/[id]/builder/page.tsx`

**Step 1: Change conflicting shortcuts**

Replace the keyboard shortcuts (lines ~362-397):

- `Ctrl+P` (print) → `Ctrl+Shift+B` (add page break)
- `Ctrl+E` (address bar) → `Ctrl+Shift+E` (add element)
- Keep `Ctrl+S` (save) — universally expected
- Keep `Ctrl+Shift+P` (publish) — no browser conflict

```tsx
useKeyboardShortcuts(
  [
    {
      key: 's',
      ctrl: true,
      handler: () => { void handleSave(); },
      description: 'Save form',
    },
    {
      key: 'e',
      ctrl: true,
      shift: true,
      handler: () => addField('SHORT_TEXT'),
      description: 'Add element',
    },
    {
      key: 'b',
      ctrl: true,
      shift: true,
      handler: () => addField('PAGE_BREAK'),
      description: 'Add page break',
    },
    {
      key: 'p',
      ctrl: true,
      shift: true,
      handler: () => {
        if (status !== 'PUBLISHED') { void handlePublish(); }
      },
      description: 'Publish form',
    },
  ],
  !!form
);
```

**Step 2: Update any UI text that displays the shortcut hints** — search the builder page for references to "Ctrl+P" or "Ctrl+E" in tooltip/hint text and update to the new shortcuts.

---

### Task 9: Add confirmation dialogs for destructive actions

**Files:**
- Modify: `src/app/(dashboard)/forms/page.tsx`
- Modify: `src/app/(dashboard)/forms/[id]/builder/page.tsx`

**Step 1: Add confirmation to form delete on the forms list page**

Wrap `handleDelete` with `window.confirm`:

```tsx
async function handleDelete(formId: string) {
  if (!window.confirm('Are you sure you want to archive this form? It will no longer be accessible.')) return;
  try {
    await deleteForm.mutateAsync({ id: formId, reason: 'Removed from forms list' });
    success('Form archived');
  } catch (err) {
    showError(err instanceof Error ? err.message : 'Failed to archive form');
  }
}
```

**Step 2: Add confirmation to field delete in the builder**

In the builder page, find the `deleteField` function (~line 271) and add confirmation:

```tsx
function deleteField(clientId: string) {
  if (!window.confirm('Delete this field?')) return;
  setFields((prev) => {
    const updated = prev.filter((f) => f.clientId !== clientId);
    return resequence(updated);
  });
  if (selectedFieldId === clientId) {
    setSelectedFieldId(null);
  }
}
```

**Step 3: Verify build**

---

### Task 10: Add server-side CSV export endpoint

**Files:**
- Modify: `src/services/form-builder.service.ts` (add `exportFormResponsesCsv` function)
- Create: `src/app/api/forms/[id]/responses/export/route.ts`
- Modify: `src/app/(dashboard)/forms/[id]/responses/page.tsx` (use server export)

**Step 1: Add export function in service**

Add to `form-builder.service.ts`:

```ts
export async function exportFormResponsesCsv(
  formId: string,
  tenantId: string
): Promise<{ csv: string; fileName: string }> {
  const form = await prisma.form.findFirst({
    where: { id: formId, tenantId, deletedAt: null },
    include: { fields: { orderBy: { position: 'asc' } } },
  });

  if (!form) throw new Error('Form not found');

  const submissions = await prisma.formSubmission.findMany({
    where: { formId, tenantId },
    orderBy: { submittedAt: 'desc' },
  });

  const fieldKeys = form.fields
    .filter((f) => !['PAGE_BREAK', 'PARAGRAPH', 'HTML'].includes(f.type))
    .map((f) => f.key);

  const fieldLabels = form.fields
    .filter((f) => !['PAGE_BREAK', 'PARAGRAPH', 'HTML'].includes(f.type))
    .map((f) => f.label || f.key);

  const header = ['submission_id', 'submitted_at', 'respondent_name', 'respondent_email', ...fieldLabels];

  const safeCell = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.join(', ');
    return String(value);
  };

  const rows = submissions.map((sub) => {
    const answers = (sub.answers || {}) as Record<string, unknown>;
    return [
      sub.id,
      new Date(sub.submittedAt).toISOString(),
      sub.respondentName || '',
      sub.respondentEmail || '',
      ...fieldKeys.map((key) => safeCell(answers[key])),
    ];
  });

  const csv = [header, ...rows]
    .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','))
    .join('\n');

  const fileName = `${form.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'form'}-responses.csv`;

  return { csv, fileName };
}
```

**Step 2: Create API route**

Create `src/app/api/forms/[id]/responses/export/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { resolveTenantId, createErrorResponse } from '@/lib/api-helpers';
import { exportFormResponsesCsv } from '@/services/form-builder.service';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const session = await requireAuth();
    await requirePermission(session, 'document', 'read');

    const { searchParams } = new URL(request.url);
    const tenantId = resolveTenantId(session, searchParams.get('tenantId'));

    const { csv, fileName } = await exportFormResponsesCsv(id, tenantId);

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}
```

**Step 3: Update responses page to use server-side export**

In `src/app/(dashboard)/forms/[id]/responses/page.tsx`, replace the `exportCsv` function:

```tsx
async function exportCsv() {
  if (!form) return;
  try {
    const res = await fetch(`/api/forms/${formId}/responses/export`);
    if (!res.ok) throw new Error('Export failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] || 'responses.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch {
    // Fallback gracefully — user sees no download
  }
}
```

Remove the old `safeCell` function if it was only used by `exportCsv`. If `safeCell` is used in the table rendering too, keep it.

**Step 4: Verify build**

---

### Task 11: Render structured submission detail view

**Files:**
- Modify: `src/app/(dashboard)/forms/[id]/responses/page.tsx`

**Step 1: Replace raw JSON with structured rendering**

Replace the `<pre>` block in the submission detail modal (~lines 256-258):

```tsx
<ModalBody>
  {selectedSubmission && (() => {
    const answers = (selectedSubmission.answers || {}) as Record<string, unknown>;
    const fields = form?.fields.filter(
      (f) => !['PAGE_BREAK', 'PARAGRAPH', 'HTML', 'HIDDEN'].includes(f.type)
    ) || [];

    return (
      <div className="space-y-4 max-h-[60vh] overflow-auto">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <span className="text-text-secondary">Submitted</span>
            <p className="text-text-primary">{formatDate(selectedSubmission.submittedAt)}</p>
          </div>
          {selectedSubmission.respondentName && (
            <div>
              <span className="text-text-secondary">Name</span>
              <p className="text-text-primary">{selectedSubmission.respondentName}</p>
            </div>
          )}
          {selectedSubmission.respondentEmail && (
            <div>
              <span className="text-text-secondary">Email</span>
              <p className="text-text-primary">{selectedSubmission.respondentEmail}</p>
            </div>
          )}
        </div>

        <hr className="border-border-primary" />

        <div className="space-y-3">
          {fields.map((field) => {
            const value = answers[field.key];
            if (value === undefined || value === null) return null;

            return (
              <div key={field.id}>
                <span className="text-xs font-medium text-text-secondary uppercase tracking-wide">
                  {field.label || field.key}
                </span>
                {field.type === 'SIGNATURE' && typeof value === 'string' && value.startsWith('data:image') ? (
                  <img src={value} alt="Signature" className="mt-1 max-h-20 rounded border border-border-primary bg-white p-1" />
                ) : field.type === 'FILE_UPLOAD' ? (
                  <p className="text-sm text-text-primary mt-0.5 italic">File uploaded</p>
                ) : Array.isArray(value) ? (
                  <p className="text-sm text-text-primary mt-0.5">{value.join(', ')}</p>
                ) : (
                  <p className="text-sm text-text-primary mt-0.5 whitespace-pre-wrap">{String(value)}</p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  })()}
</ModalBody>
```

**Step 2: Verify build**

---

### Task 12: Remove tenantId from preview URL

**Files:**
- Modify: `src/app/(dashboard)/forms/[id]/builder/page.tsx`
- Modify: `src/app/forms/f/[slug]/page.tsx`

**Step 1: Simplify preview URL in builder**

In the builder page (~line 419-421), remove tenantId from the preview URL:

```tsx
// Before:
const viewHref = isPublished
  ? `/forms/f/${form.slug}`
  : `/forms/f/${form.slug}?preview=1&formId=${form.id}&tenantId=${form.tenantId}`;

// After:
const viewHref = isPublished
  ? `/forms/f/${form.slug}`
  : `/forms/f/${form.slug}?preview=1&formId=${form.id}`;
```

**Step 2: Update public form page to not pass tenantId**

In `src/app/forms/f/[slug]/page.tsx`, update the preview endpoint construction (~line 145-148):

```tsx
// Before:
const endpoint = isPreview && previewFormId
  ? `/api/forms/${previewFormId}${previewTenantId ? `?tenantId=${encodeURIComponent(previewTenantId)}` : ''}`
  : `/api/forms/public/${slug}`;

// After:
const endpoint = isPreview && previewFormId
  ? `/api/forms/${previewFormId}`
  : `/api/forms/public/${slug}`;
```

Remove the `previewTenantId` variable/searchParam parsing if it was only used here.

**Step 3: Verify build**

---

### Task 13: Add orphan upload cleanup API endpoint

**Files:**
- Modify: `src/services/form-builder.service.ts` (add `cleanupOrphanedUploads`)
- Create: `src/app/api/forms/cleanup-uploads/route.ts`

**Step 1: Add cleanup function in service**

```ts
export async function cleanupOrphanedUploads(maxAgeHours: number = 24): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);

  const orphans = await prisma.formUpload.findMany({
    where: {
      submissionId: null,
      createdAt: { lt: cutoff },
    },
    select: { id: true, storageKey: true },
  });

  if (orphans.length === 0) return 0;

  // Delete from storage (best-effort, don't fail on individual errors)
  await Promise.allSettled(
    orphans.map((orphan) => storage.delete(orphan.storageKey))
  );

  // Delete from database
  await prisma.formUpload.deleteMany({
    where: {
      id: { in: orphans.map((o) => o.id) },
      submissionId: null,
    },
  });

  return orphans.length;
}
```

**Step 2: Create API route**

Create `src/app/api/forms/cleanup-uploads/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createErrorResponse } from '@/lib/api-helpers';
import { cleanupOrphanedUploads } from '@/services/form-builder.service';

export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();
    if (!session.isSuperAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const maxAgeHours = typeof body?.maxAgeHours === 'number' ? body.maxAgeHours : 24;

    const deleted = await cleanupOrphanedUploads(maxAgeHours);

    return NextResponse.json({ deleted });
  } catch (error) {
    return createErrorResponse(error);
  }
}
```

**Step 3: Verify build**

---

### Task 14: Add rate limiting to public form endpoints

**Files:**
- Create: `src/lib/rate-limit.ts`
- Modify: `src/app/api/forms/public/[slug]/route.ts`
- Modify: `src/app/api/forms/public/[slug]/submit/route.ts`
- Modify: `src/app/api/forms/public/[slug]/uploads/route.ts`

**Step 1: Create simple in-memory rate limiter**

```ts
const buckets = new Map<string, { count: number; resetAt: number }>();

// Clean up expired entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
}, 60_000);

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxRequests - 1, resetAt: now + windowMs };
  }

  bucket.count += 1;

  if (bucket.count > maxRequests) {
    return { allowed: false, remaining: 0, resetAt: bucket.resetAt };
  }

  return { allowed: true, remaining: maxRequests - bucket.count, resetAt: bucket.resetAt };
}

export function getRateLimitKey(request: Request, prefix: string): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || 'unknown';
  return `${prefix}:${ip}`;
}
```

**Step 2: Add rate limiting to each public endpoint**

For the public form GET (`/api/forms/public/[slug]/route.ts`), add:

```ts
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';

// At start of GET handler:
const rl = checkRateLimit(getRateLimitKey(request, `form-view:${slug}`), 60, 60_000);
if (!rl.allowed) {
  return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
}
```

For submissions: 10 per minute per IP per slug.
For uploads: 20 per minute per IP per slug.

**Step 3: Verify build**

---

### Task 15: Validate answer values against field definitions

**Files:**
- Modify: `src/services/form-builder.service.ts`

**Step 1: Add answer validation in `createPublicSubmission`**

After the required-field validation loop (~line 836), add:

```ts
// Strip unknown keys and validate value types
const validKeys = new Set(form.fields.map((f) => f.key));
const sanitizedAnswers: Record<string, unknown> = {};

for (const [key, value] of Object.entries(answers)) {
  if (!validKeys.has(key)) continue; // strip unknown keys

  const field = form.fields.find((f) => f.key === key);
  if (!field) continue;

  // Validate value types based on field type
  switch (field.type) {
    case 'SHORT_TEXT':
    case 'LONG_TEXT':
    case 'DROPDOWN':
    case 'SINGLE_CHOICE':
      if (typeof value === 'string') {
        sanitizedAnswers[key] = value.slice(0, 10_000); // cap at 10K chars
      }
      break;
    case 'MULTIPLE_CHOICE':
      if (Array.isArray(value)) {
        sanitizedAnswers[key] = value
          .filter((v): v is string => typeof v === 'string')
          .slice(0, 100)
          .map((v) => v.slice(0, 10_000));
      }
      break;
    case 'FILE_UPLOAD':
    case 'SIGNATURE':
      if (typeof value === 'string') {
        sanitizedAnswers[key] = value.slice(0, 500_000); // signatures can be large base64
      }
      break;
    case 'HIDDEN':
      if (typeof value === 'string') {
        sanitizedAnswers[key] = value.slice(0, 10_000);
      }
      break;
    default:
      break;
  }
}
```

Then use `sanitizedAnswers` instead of `answers` for the `formSubmission.create` call and the required-field validation. Make sure the required-field check still works by running it against the original `answers` (before sanitization) so users get proper error messages, then persist only `sanitizedAnswers`.

**Step 2: Verify build**

---

### Task 16: Verify everything compiles and works

**Step 1: Run build**

```bash
npx next build
```

**Step 2: Run lint**

```bash
npm run lint
```

**Step 3: Fix any errors**

---
