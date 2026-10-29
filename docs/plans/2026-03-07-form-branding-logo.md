# Form Branding — Tenant Logo Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upload a logo at the tenant level and display it inline beside the form title on the public-facing form view, with a per-form opt-out toggle.

**Architecture:** Logo files are stored in the existing storage service (local/S3) under `{tenantId}/branding/logo{ext}`. The `tenant.logoUrl` column (already in the DB schema) holds the resulting URL. The public form service joins tenant to expose `tenantLogoUrl` in `PublicFormDefinition`. A `hideLogo` boolean in the form's settings JSON suppresses display per form.

**Tech Stack:** Next.js App Router API routes, Prisma, existing storage abstraction (`src/lib/storage`), React (form builder page + public form page), TanStack Query hooks.

---

### Task 1: Add `StorageKeys.tenantLogo()` helper

**Files:**
- Modify: `src/lib/storage/config.ts` (in the `StorageKeys` object, after `tenantPrefix`)

**Step 1: Add the storage key helper**

In `src/lib/storage/config.ts`, inside the `StorageKeys` object, add after the `tenantPrefix` method:

```ts
/**
 * Generate storage key for tenant branding logo
 */
tenantLogo(tenantId: string, extension: string): string {
  return `${tenantId}/branding/logo${extension}`;
},
```

**Step 2: Commit**

```bash
git add src/lib/storage/config.ts
git commit -m "feat: add StorageKeys.tenantLogo helper"
```

---

### Task 2: Create tenant logo upload/delete API route

**Files:**
- Create: `src/app/api/tenants/[id]/logo/route.ts`

**Context:**
- Auth pattern: import `requireAuth` from `@/lib/auth` — call it, check `session.isSuperAdmin`, throw 403 if not.
- Storage: import `storage` and `StorageKeys` from `@/lib/storage`. Use `storage.upload(key, buffer, { contentType })` → returns `{ url }`. Use `storage.exists(key)` and `storage.delete(key)`.
- DB: import `prisma` from `@/lib/prisma`. Update `tenant.logoUrl` via `prisma.tenant.update({ where: { id }, data: { logoUrl } })`.
- Existing example of file upload validation: see `src/services/form-builder.service.ts` around `createPublicUpload`.

**Step 1: Write the route**

```ts
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { storage, StorageKeys } from '@/lib/storage';
import path from 'path';

const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
};
const MAX_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    if (!session.isSuperAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;

    const tenant = await prisma.tenant.findUnique({
      where: { id, deletedAt: null },
      select: { id: true, logoUrl: true },
    });
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    const formData = await request.formData();
    const file = formData.get('file');
    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const mimeType = file.type;
    const extension = ALLOWED_TYPES[mimeType];
    if (!extension) {
      return NextResponse.json(
        { error: 'Invalid file type. Allowed: JPEG, PNG, WebP, SVG' },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.byteLength > MAX_SIZE_BYTES) {
      return NextResponse.json(
        { error: 'File too large. Maximum size is 2 MB' },
        { status: 400 }
      );
    }

    // Delete existing logo (any extension) if present
    if (tenant.logoUrl) {
      for (const ext of Object.values(ALLOWED_TYPES)) {
        const oldKey = StorageKeys.tenantLogo(id, ext);
        const exists = await storage.exists(oldKey);
        if (exists) {
          await storage.delete(oldKey);
        }
      }
    }

    const key = StorageKeys.tenantLogo(id, extension);
    const result = await storage.upload(key, buffer, {
      contentType: mimeType,
      cacheControl: 'public, max-age=31536000',
    });

    await prisma.tenant.update({
      where: { id },
      data: { logoUrl: result.url },
    });

    return NextResponse.json({ logoUrl: result.url });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    if (!session.isSuperAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;

    const tenant = await prisma.tenant.findUnique({
      where: { id, deletedAt: null },
      select: { id: true, logoUrl: true },
    });
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    if (tenant.logoUrl) {
      for (const ext of Object.values(ALLOWED_TYPES)) {
        const key = StorageKeys.tenantLogo(id, ext);
        const exists = await storage.exists(key);
        if (exists) {
          await storage.delete(key);
        }
      }
    }

    await prisma.tenant.update({
      where: { id },
      data: { logoUrl: null },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

**Step 2: Commit**

```bash
git add src/app/api/tenants/\[id\]/logo/route.ts
git commit -m "feat: add tenant logo upload/delete API route"
```

---

### Task 3: Add `logoUrl` to Tenant type in `use-admin.ts`

**Files:**
- Modify: `src/hooks/use-admin.ts` (the `Tenant` interface, around line 63)

**Context:** The `Tenant` interface currently lacks `logoUrl`. The tenants list query already selects it from the DB — we just need to expose it in the TypeScript type.

**Step 1: Add `logoUrl` to the `Tenant` interface**

In `src/hooks/use-admin.ts`, in the `Tenant` interface, add:

```ts
logoUrl: string | null;
```

The interface should now look like:

```ts
export interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: string;
  contactEmail: string | null;
  contactPhone: string | null;
  logoUrl: string | null;           // ← add this
  settings?: Record<string, unknown> | null;
  maxUsers: number;
  maxCompanies: number;
  maxStorageMb: number;
  createdAt: string;
  _count?: {
    users: number;
    companies: number;
  };
}
```

**Step 2: Commit**

```bash
git add src/hooks/use-admin.ts
git commit -m "feat: expose logoUrl in Tenant hook type"
```

---

### Task 4: Add logo upload UI to the Edit Tenant modal

**Files:**
- Modify: `src/app/(dashboard)/admin/tenants/page.tsx`

**Context:**
- The Edit Tenant modal is opened by `openEditModal(tenant)` and rendered starting around line 751.
- The modal form calls `handleEdit` on submit via `useUpdateTenant`.
- Logo upload is a separate action (fires immediately on file select), NOT part of the main save flow.
- Pattern: use a hidden `<input type="file">` triggered by a button click via `useRef`.
- After a successful upload/delete, call `queryClient.invalidateQueries({ queryKey: ['tenants'] })` to refresh the logo in the list, and update local state with the new URL so the preview updates immediately.

**Step 1: Add state and ref at the top of the component (after existing useState declarations)**

```tsx
const logoInputRef = useRef<HTMLInputElement>(null);
const [isUploadingLogo, setIsUploadingLogo] = useState(false);
const [isDeletingLogo, setIsDeletingLogo] = useState(false);
const [editingLogoUrl, setEditingLogoUrl] = useState<string | null>(null);
```

**Step 2: Update `openEditModal` to populate `editingLogoUrl`**

In `openEditModal`, after the existing `setEditFormData({...})` call, add:

```tsx
setEditingLogoUrl(tenant.logoUrl ?? null);
```

In `closeEditModal`, after the existing `setEditFormData({...})` reset, add:

```tsx
setEditingLogoUrl(null);
```

**Step 3: Add upload and delete handlers**

```tsx
const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  if (!file || !editingTenant) return;

  setIsUploadingLogo(true);
  try {
    const data = new FormData();
    data.append('file', file);
    const res = await fetch(`/api/tenants/${editingTenant.id}/logo`, {
      method: 'POST',
      body: data,
    });
    if (!res.ok) {
      const json = await res.json();
      throw new Error(json.error || 'Upload failed');
    }
    const json = await res.json();
    setEditingLogoUrl(json.logoUrl);
    queryClient.invalidateQueries({ queryKey: ['tenants'] });
    success('Logo uploaded');
  } catch (err) {
    showError(err instanceof Error ? err.message : 'Failed to upload logo');
  } finally {
    setIsUploadingLogo(false);
    if (logoInputRef.current) logoInputRef.current.value = '';
  }
};

const handleLogoDelete = async () => {
  if (!editingTenant) return;
  setIsDeletingLogo(true);
  try {
    const res = await fetch(`/api/tenants/${editingTenant.id}/logo`, { method: 'DELETE' });
    if (!res.ok) {
      const json = await res.json();
      throw new Error(json.error || 'Delete failed');
    }
    setEditingLogoUrl(null);
    queryClient.invalidateQueries({ queryKey: ['tenants'] });
    success('Logo removed');
  } catch (err) {
    showError(err instanceof Error ? err.message : 'Failed to remove logo');
  } finally {
    setIsDeletingLogo(false);
  }
};
```

**Step 4: Add logo section to the Edit Tenant modal's `<ModalBody>`**

Insert this block as the **first** child inside the `<div className="space-y-4">` inside the Edit modal's `<ModalBody>`:

```tsx
{/* Logo */}
<div>
  <label className="mb-1.5 block text-xs font-medium text-text-secondary">Tenant Logo</label>
  <div className="flex items-center gap-3">
    {editingLogoUrl ? (
      <img
        src={editingLogoUrl}
        alt="Tenant logo"
        className="h-10 w-auto max-w-[120px] rounded border border-border-primary object-contain bg-background-secondary p-1"
      />
    ) : (
      <div className="h-10 w-20 rounded border border-dashed border-border-primary bg-background-secondary flex items-center justify-center">
        <span className="text-2xs text-text-muted">No logo</span>
      </div>
    )}
    <input
      ref={logoInputRef}
      type="file"
      accept="image/jpeg,image/png,image/webp,image/svg+xml"
      className="hidden"
      onChange={handleLogoUpload}
    />
    <Button
      type="button"
      variant="secondary"
      size="sm"
      isLoading={isUploadingLogo}
      onClick={() => logoInputRef.current?.click()}
    >
      {editingLogoUrl ? 'Replace' : 'Upload Logo'}
    </Button>
    {editingLogoUrl && (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        isLoading={isDeletingLogo}
        onClick={handleLogoDelete}
      >
        Remove
      </Button>
    )}
  </div>
  <p className="mt-1 text-2xs text-text-muted">JPEG, PNG, WebP or SVG. Max 2 MB.</p>
</div>
```

**Step 5: Manual test**
1. Open Edit modal for any tenant
2. Upload a PNG — verify preview appears, toast fires, list refreshes
3. Click Remove — verify preview clears, toast fires
4. Try uploading a >2MB file or a non-image — verify error toast

**Step 6: Commit**

```bash
git add src/app/\(dashboard\)/admin/tenants/page.tsx
git commit -m "feat: add tenant logo upload UI in edit modal"
```

---

### Task 5: Add `tenantLogoUrl` to `PublicFormDefinition` and `getPublicFormBySlug`

**Files:**
- Modify: `src/lib/form-utils.ts` (the `PublicFormDefinition` interface, around line 20)
- Modify: `src/services/form-builder.service.ts` (`getPublicFormBySlug`, around line 1658)

**Step 1: Update `PublicFormDefinition` in `src/lib/form-utils.ts`**

Find the interface (around line 20):

```ts
export interface PublicFormDefinition {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  settings?: unknown;
  fields: PublicFormField[];
  status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
}
```

Add `tenantLogoUrl`:

```ts
export interface PublicFormDefinition {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  settings?: unknown;
  fields: PublicFormField[];
  status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  tenantLogoUrl: string | null;
}
```

**Step 2: Update `getPublicFormBySlug` in `src/services/form-builder.service.ts`**

Find the function (around line 1658). Change the Prisma query to include the tenant's `logoUrl`:

```ts
export async function getPublicFormBySlug(slug: string): Promise<PublicFormDefinition | null> {
  const form = await prisma.form.findFirst({
    where: {
      slug,
      status: 'PUBLISHED',
      deletedAt: null,
    },
    include: {
      fields: {
        orderBy: { position: 'asc' },
      },
      tenant: {
        select: { logoUrl: true },
      },
    },
  });

  if (!form) {
    return null;
  }

  await prisma.form.update({
    where: { id: form.id },
    data: { viewsCount: { increment: 1 } },
  });

  return {
    id: form.id,
    slug: form.slug,
    title: form.title,
    description: form.description,
    settings: form.settings,
    fields: form.fields,
    tenantLogoUrl: form.tenant?.logoUrl ?? null,
  };
}
```

**Step 3: Commit**

```bash
git add src/lib/form-utils.ts src/services/form-builder.service.ts
git commit -m "feat: expose tenantLogoUrl in public form definition"
```

---

### Task 6: Add `hideLogo` state and toggle to the form builder settings tab

**Files:**
- Modify: `src/app/(dashboard)/forms/[id]/builder/page.tsx`
- Modify: `src/components/forms/builder-utils.ts`

**Context:**
- `hideLogo` is stored in `form.settings` JSON, same as `notificationRecipientEmails`, `pdfFileNameTemplate`, etc.
- Look at how `notificationRecipientEmails` is read in `parseFormNotificationSettings` and written in `serializeBuilderState` — follow the same pattern for `hideLogo`.
- The settings tab starts around line 1248. Add the toggle at the end of the settings section, just before the `<p>` hint about publishing.

**Step 1: Add `hideLogo` to `serializeBuilderState` input type and output in `src/components/forms/builder-utils.ts`**

In the `serializeBuilderState` function signature, add:

```ts
hideLogo?: boolean;
```

In the JSON.stringify object body, add:

```ts
hideLogo: input.hideLogo === true,
```

**Step 2: Add `hideLogo` state in the builder page**

After the existing `useState` declarations (around line 229), add:

```tsx
const [hideLogo, setHideLogo] = useState(false);
```

**Step 3: Initialise `hideLogo` from `form.settings` in the `useEffect`**

In the `useEffect` that populates state from `form` (around line 252), after the existing `parseForm*` calls, add:

```tsx
const settingsObj = (form.settings && typeof form.settings === 'object' && !Array.isArray(form.settings))
  ? form.settings as Record<string, unknown>
  : {};
setHideLogo(settingsObj.hideLogo === true);
```

**Step 4: Pass `hideLogo` to `serializeBuilderState`**

Find every call to `serializeBuilderState(...)` in the file (there are 2: one in the save handler, one in the unsaved-changes check). Add `hideLogo` to both:

```tsx
hideLogo,
```

**Step 5: Add the toggle UI at the end of the settings tab, just before the CircleHelp hint**

```tsx
<div className="flex items-center justify-between">
  <div>
    <p className="text-xs font-medium text-text-secondary">Show tenant logo</p>
    <p className="text-2xs text-text-muted">Display your organization logo beside the form title.</p>
  </div>
  <button
    type="button"
    role="switch"
    aria-checked={!hideLogo}
    onClick={() => setHideLogo((v) => !v)}
    className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
      !hideLogo ? 'bg-oak-primary' : 'bg-border-primary'
    }`}
  >
    <span
      className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
        !hideLogo ? 'translate-x-4' : 'translate-x-0'
      }`}
    />
  </button>
</div>
```

**Step 6: Manual test**
1. Open a form in the builder → Settings tab
2. Toggle "Show tenant logo" off → save → verify `form.settings.hideLogo === true` in the DB (check via network response or Prisma Studio)
3. Toggle back on → save → verify `hideLogo` is `false`

**Step 7: Commit**

```bash
git add src/app/\(dashboard\)/forms/\[id\]/builder/page.tsx src/components/forms/builder-utils.ts
git commit -m "feat: add hideLogo toggle to form builder settings"
```

---

### Task 7: Render logo + title in the public form view

**Files:**
- Modify: `src/app/forms/f/[slug]/page.tsx` (around line 2367 where the title `<h1>` is rendered)

**Context:**
- The form data arrives via the `useForm` hook which calls the public API. After Task 5, `form.tenantLogoUrl` is now available.
- `form.settings` is already parsed by `parseFormI18nSettings` in this file. The raw settings object is available as `form?.settings`.
- The condition to show the logo: `tenantLogoUrl` is a non-empty string **and** `settings.hideLogo` is not `true`.
- Only render the logo when NOT in embed mode (`!isEmbed`).

**Step 1: Compute `shouldShowLogo` with a `useMemo`**

Add near the other `useMemo` declarations (around line 429):

```tsx
const shouldShowLogo = useMemo(() => {
  if (!form?.tenantLogoUrl) return false;
  const settingsObj = (form.settings && typeof form.settings === 'object' && !Array.isArray(form.settings))
    ? form.settings as Record<string, unknown>
    : {};
  return settingsObj.hideLogo !== true;
}, [form?.tenantLogoUrl, form?.settings]);
```

**Step 2: Update the title section (around line 2364)**

Find:

```tsx
{!isEmbed && (
  <div className="mb-6">
    <h1 className="text-2xl font-bold text-text-primary">{localizedFormTitle || form.title}</h1>
```

Replace the `<h1>` line with a flex row that conditionally shows the logo:

```tsx
{!isEmbed && (
  <div className="mb-6">
    <div className="flex items-center gap-3">
      {shouldShowLogo && (
        <img
          src={form.tenantLogoUrl!}
          alt="Organization logo"
          className="h-8 w-auto max-w-[120px] object-contain rounded-sm flex-shrink-0"
        />
      )}
      <h1 className="text-2xl font-bold text-text-primary">{localizedFormTitle || form.title}</h1>
    </div>
```

Keep all the lines after the `<h1>` (description, preview notice, divider) unchanged.

**Step 3: Manual test**
1. Set a logo for a tenant
2. Open a published form for that tenant — logo appears beside the title
3. In the builder, turn "Show tenant logo" off, save, reload public form — logo is gone, no errors
4. Remove the logo from the tenant — reload public form — title renders alone, no errors
5. Test embed mode (`?embed=1`) — logo does not appear

**Step 4: Commit**

```bash
git add src/app/forms/f/\[slug\]/page.tsx
git commit -m "feat: display tenant logo beside form title in public view"
```

---

### Task 8: Update `PublicFormDefinition` in the preview route (if applicable)

**Files:**
- Check: `src/app/api/forms/[id]/route.ts` — the preview endpoint used by the builder's preview mode

**Context:**
The builder preview uses a different endpoint than the public slug route. If `getFormById` returns a form used as `PublicFormDefinition` in preview mode, it needs `tenantLogoUrl` too. If the preview just shows a structural preview without logo, skip this task.

**Step 1: Check preview data flow**

In the builder page around line 504:

```
`/api/forms/${previewFormId}${previewTenantId ? `?tenantId=...` : ''}`
```

Open `src/app/api/forms/[id]/route.ts` and check what it returns. If it doesn't return `tenantLogoUrl`, add a tenant join similar to Task 5. If preview mode doesn't show logo (it's a builder preview, not end-user), skip.

**Step 2: If needed, add tenant join in `getFormById`**

In `src/services/form-builder.service.ts`, find `getFormById` (around line 1191) and add:

```ts
include: {
  fields: { orderBy: { position: 'asc' } },
  tenant: { select: { logoUrl: true } },
},
```

Then in the return object add `tenantLogoUrl: form.tenant?.logoUrl ?? null`.

**Step 3: Commit if changed**

```bash
git add src/services/form-builder.service.ts src/app/api/forms/\[id\]/route.ts
git commit -m "feat: expose tenantLogoUrl in form detail for preview"
```

---

## Summary of all changed files

| File | Change |
|------|--------|
| `src/lib/storage/config.ts` | Add `StorageKeys.tenantLogo()` |
| `src/app/api/tenants/[id]/logo/route.ts` | New — POST upload + DELETE handlers |
| `src/hooks/use-admin.ts` | Add `logoUrl: string \| null` to `Tenant` interface |
| `src/app/(dashboard)/admin/tenants/page.tsx` | Logo upload/preview/remove UI in Edit modal |
| `src/lib/form-utils.ts` | Add `tenantLogoUrl` to `PublicFormDefinition` |
| `src/services/form-builder.service.ts` | Join tenant in `getPublicFormBySlug`, return `tenantLogoUrl` |
| `src/components/forms/builder-utils.ts` | Add `hideLogo` to `serializeBuilderState` |
| `src/app/(dashboard)/forms/[id]/builder/page.tsx` | `hideLogo` state + toggle UI in Settings tab |
| `src/app/forms/f/[slug]/page.tsx` | `shouldShowLogo` computed value + flex logo+title row |
