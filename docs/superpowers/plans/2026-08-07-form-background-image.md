# Form Background Image Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let form creators upload a per-form background image with adjustable opacity, rendered over the existing gradient on the public form page.

**Architecture:** Store `backgroundImageUrl` + `backgroundImageOpacity` in the existing `Form.settings` JSON. Uploads go through a new authenticated `POST /api/forms/[id]/background` route that writes to the existing storage layer; files are served by extending the existing `/api/storage/[...key]` allowlist. The builder gets a new `FormBackgroundUploader` component; the public page keeps its gradient and layers the image at the saved opacity.

**Tech Stack:** Next.js (App Router, TS), Prisma, Zod, Tailwind CSS, Vitest + Testing Library.

## Global Constraints

- TDD iron law: no production code without a failing test first; watch each test fail for the expected reason before implementing.
- Follow the existing patterns: `src/lib/workspace-logo-url.ts`, `src/app/api/workspace/settings/logo/route.ts`, `src/app/api/forms/[id]/route.ts`.
- No new dependencies; no DB migration (settings live in `Form.settings` JSON).
- Public form stays light-mode only; keep existing Tailwind tokens/classes.
- Settings keys are exactly `backgroundImageUrl` (string URL or null) and `backgroundImageOpacity` (integer 0–100, default 40).
- Allowed upload MIME types: `image/png`, `image/jpeg`, `image/jpg`, `image/webp`, `image/gif`; max size 5MB.
- Test command: `npm.cmd run test:run -- <path>` (approved prefix). Git add/commit requires escalation (`sandbox_permissions: "require_escalated"`) because the sandbox blocks writes inside `.git`.

---

### Task 1: Storage key + URL helper

**Files:**
- Modify: `src/lib/storage/config.ts` (add `formBackground` to `StorageKeys`)
- Create: `src/lib/form-background-url.ts`
- Test: `__tests__/lib/storage.test.ts` (extend), `__tests__/lib/form-background-url.test.ts` (create)

**Interfaces:**
- Produces: `StorageKeys.formBackground(tenantId: string, formId: string, extension: string): string` returning `` `${tenantId}/forms/${formId}/branding/background${extension}` ``
- Produces: `isFormBackgroundStorageKey(value: string): boolean`
- Produces: `getFormBackgroundPublicUrl(storageKey: string): string`
- Produces: `normalizeFormBackgroundUrl(value: string | null | undefined): string | null`

- [ ] **Step 1: Write the failing tests**

Extend `__tests__/lib/storage.test.ts` inside the existing `describe('StorageKeys', ...)` block:

```ts
describe('formBackground', () => {
  it('should generate correct key for form backgrounds', () => {
    expect(StorageKeys.formBackground(tenantId, 'form-1', '.png'))
      .toBe(`${tenantId}/forms/form-1/branding/background.png`);
  });

  it('should handle different extensions', () => {
    expect(StorageKeys.formBackground(tenantId, 'form-1', '.webp'))
      .toBe(`${tenantId}/forms/form-1/branding/background.webp`);
  });
});
```

Create `__tests__/lib/form-background-url.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/storage/config', () => ({
  getStorageConfig: () => ({ s3Bucket: 'bucket' }),
}));

import {
  getFormBackgroundPublicUrl,
  isFormBackgroundStorageKey,
  normalizeFormBackgroundUrl,
} from '@/lib/form-background-url';

describe('form background URL helpers', () => {
  it('accepts valid form background storage keys', () => {
    expect(isFormBackgroundStorageKey('tenant-1/forms/form-1/branding/background.png')).toBe(true);
    expect(isFormBackgroundStorageKey('tenant-1/forms/form-1/branding/background.jpeg')).toBe(true);
    expect(isFormBackgroundStorageKey('tenant-1/forms/form-1/branding/background.WEBP')).toBe(true);
  });

  it('rejects non-background and malformed keys', () => {
    expect(isFormBackgroundStorageKey('tenant-1/branding/logo.png')).toBe(false);
    expect(isFormBackgroundStorageKey('tenant-1/forms/form-1/branding/background.svg')).toBe(false);
    expect(isFormBackgroundStorageKey('tenant-1/forms/form-1/background.png')).toBe(false);
    expect(isFormBackgroundStorageKey('tenant-1/forms/form-1/branding/background.png/extra')).toBe(false);
  });

  it('builds a public URL from a storage key', () => {
    expect(getFormBackgroundPublicUrl('tenant-1/forms/form-1/branding/background.png'))
      .toBe('/api/storage/tenant-1%2Fforms%2Fform-1%2Fbranding%2Fbackground.png');
  });

  it('normalizes a raw storage key to the app URL', () => {
    expect(normalizeFormBackgroundUrl('tenant-1/forms/form-1/branding/background.png'))
      .toBe('/api/storage/tenant-1%2Fforms%2Fform-1%2Fbranding%2Fbackground.png');
  });

  it('normalizes an app storage URL to itself', () => {
    expect(normalizeFormBackgroundUrl('/api/storage/tenant-1%2Fforms%2Fform-1%2Fbranding%2Fbackground.png'))
      .toBe('/api/storage/tenant-1%2Fforms%2Fform-1%2Fbranding%2Fbackground.png');
  });

  it('normalizes an S3 URL to the app URL', () => {
    expect(normalizeFormBackgroundUrl('https://s3.amazonaws.com/bucket/tenant-1/forms/form-1/branding/background.png'))
      .toBe('/api/storage/tenant-1%2Fforms%2Fform-1%2Fbranding%2Fbackground.png');
  });

  it('passes arbitrary URLs through unchanged', () => {
    expect(normalizeFormBackgroundUrl('https://example.com/bg.png')).toBe('https://example.com/bg.png');
    expect(normalizeFormBackgroundUrl('tenant-1/other/file.png')).toBe('tenant-1/other/file.png');
  });

  it('returns null for empty values', () => {
    expect(normalizeFormBackgroundUrl(null)).toBeNull();
    expect(normalizeFormBackgroundUrl(undefined)).toBeNull();
    expect(normalizeFormBackgroundUrl('   ')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm.cmd run test:run -- __tests__/lib/form-background-url.test.ts __tests__/lib/storage.test.ts`

Expected: FAIL — `formBackground` is not a function / module not found.

- [ ] **Step 3: Implement the storage key**

In `src/lib/storage/config.ts`, directly after the `tenantLogo` method inside `StorageKeys`:

```ts
  /**
   * Generate storage key for a form background image
   */
  formBackground(tenantId: string, formId: string, extension: string): string {
    return `${tenantId}/forms/${formId}/branding/background${extension}`;
  },
```

- [ ] **Step 4: Implement the URL helper**

Create `src/lib/form-background-url.ts`:

```ts
import { getStorageConfig } from '@/lib/storage/config';

const FORM_BACKGROUND_KEY_PATTERN = /^[^/]+\/forms\/[^/]+\/branding\/background\.(png|jpg|jpeg|webp|gif)$/i;

export function isFormBackgroundStorageKey(value: string): boolean {
  return FORM_BACKGROUND_KEY_PATTERN.test(value);
}

export function getFormBackgroundPublicUrl(storageKey: string): string {
  return `/api/storage/${encodeURIComponent(storageKey)}`;
}

function storageKeyFromAppStorageUrl(pathname: string): string | null {
  if (!pathname.startsWith('/api/storage/')) return null;

  try {
    const key = decodeURIComponent(pathname.slice('/api/storage/'.length));
    return isFormBackgroundStorageKey(key) ? key : null;
  } catch {
    return null;
  }
}

function storageKeyFromS3Url(pathname: string): string | null {
  const bucket = getStorageConfig().s3Bucket;
  if (!bucket) return null;

  const bucketPrefix = `/${bucket}/`;
  if (!pathname.startsWith(bucketPrefix)) return null;

  try {
    const key = decodeURIComponent(pathname.slice(bucketPrefix.length));
    return isFormBackgroundStorageKey(key) ? key : null;
  } catch {
    return null;
  }
}

export function normalizeFormBackgroundUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  if (isFormBackgroundStorageKey(trimmed)) {
    return getFormBackgroundPublicUrl(trimmed);
  }

  try {
    const parsed = new URL(trimmed, 'http://app.local');
    const storageKey = storageKeyFromAppStorageUrl(parsed.pathname) ?? storageKeyFromS3Url(parsed.pathname);
    return storageKey ? getFormBackgroundPublicUrl(storageKey) : trimmed;
  } catch {
    return trimmed;
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm.cmd run test:run -- __tests__/lib/form-background-url.test.ts __tests__/lib/storage.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add __tests__/lib/form-background-url.test.ts __tests__/lib/storage.test.ts src/lib/form-background-url.ts src/lib/storage/config.ts
git commit -m "feat(forms): add form background storage key and URL helper"
```

Run with `sandbox_permissions: "require_escalated"`.

---

### Task 2: Parse background settings for the public form

**Files:**
- Modify: `src/lib/form-utils.ts` (import + `buildPublicFormSettings`)
- Test: `__tests__/lib/form-utils-background.test.ts` (create)

**Interfaces:**
- Consumes: `normalizeFormBackgroundUrl` from `@/lib/form-background-url`
- Produces: `buildPublicFormSettings(settings)` now also returns `backgroundImageUrl` (normalized app URL or absent) and `backgroundImageOpacity` (clamped integer; `40` when an image exists but no opacity is stored)
- Behavior: when settings are empty/missing, `buildPublicFormSettings` still returns `null` (background keys are only added when relevant)

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/form-utils-background.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildPublicFormSettings } from '@/lib/form-utils';

describe('form-utils public background settings', () => {
  it('returns null when no settings exist', () => {
    expect(buildPublicFormSettings(null)).toBeNull();
    expect(buildPublicFormSettings(undefined)).toBeNull();
  });

  it('normalizes a raw background storage key to the app URL', () => {
    const settings = buildPublicFormSettings({
      backgroundImageUrl: 'tenant-1/forms/form-1/branding/background.png',
    });
    expect(settings?.backgroundImageUrl)
      .toBe('/api/storage/tenant-1%2Fforms%2Fform-1%2Fbranding%2Fbackground.png');
  });

  it('defaults opacity to 40 when an image is set without opacity', () => {
    const settings = buildPublicFormSettings({
      backgroundImageUrl: '/api/storage/tenant-1%2Fforms%2Fform-1%2Fbranding%2Fbackground.png',
    });
    expect(settings?.backgroundImageOpacity).toBe(40);
  });

  it('clamps and rounds opacity to an integer between 0 and 100', () => {
    expect(buildPublicFormSettings({ backgroundImageUrl: 'x', backgroundImageOpacity: 150 })?.backgroundImageOpacity).toBe(100);
    expect(buildPublicFormSettings({ backgroundImageUrl: 'x', backgroundImageOpacity: -5 })?.backgroundImageOpacity).toBe(0);
    expect(buildPublicFormSettings({ backgroundImageUrl: 'x', backgroundImageOpacity: 12.6 })?.backgroundImageOpacity).toBe(13);
  });

  it('preserves an explicit opacity of 0', () => {
    const settings = buildPublicFormSettings({ backgroundImageUrl: 'x', backgroundImageOpacity: 0 });
    expect(settings?.backgroundImageOpacity).toBe(0);
  });

  it('omits background keys when neither image nor opacity is configured', () => {
    const settings = buildPublicFormSettings({ hideFooter: true });
    expect(settings).not.toHaveProperty('backgroundImageUrl');
    expect(settings).not.toHaveProperty('backgroundImageOpacity');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm.cmd run test:run -- __tests__/lib/form-utils-background.test.ts`

Expected: FAIL — `backgroundImageUrl` / `backgroundImageOpacity` undefined.

- [ ] **Step 3: Implement the parser**

In `src/lib/form-utils.ts`:

1. Add the import at the top with the other lib imports:

```ts
import { normalizeFormBackgroundUrl } from '@/lib/form-background-url';
```

2. Replace the tail of `buildPublicFormSettings`:

```ts
  const root = parseObject(settings);
  nextSettings.hideLogo = root?.hideLogo === true;
  nextSettings.hideFooter = root?.hideFooter === true;

  const backgroundImageUrl = normalizeFormBackgroundUrl(
    typeof root?.backgroundImageUrl === 'string' ? root.backgroundImageUrl : null
  );
  const rawOpacity = root?.backgroundImageOpacity;
  const opacityNumber = typeof rawOpacity === 'number' && Number.isFinite(rawOpacity)
    ? rawOpacity
    : null;
  if (backgroundImageUrl || opacityNumber !== null) {
    nextSettings.backgroundImageUrl = backgroundImageUrl;
    nextSettings.backgroundImageOpacity = opacityNumber !== null
      ? Math.min(100, Math.max(0, Math.round(opacityNumber)))
      : 40;
  }

  return Object.keys(nextSettings).length > 0 ? nextSettings : null;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm.cmd run test:run -- __tests__/lib/form-utils-background.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add __tests__/lib/form-utils-background.test.ts src/lib/form-utils.ts
git commit -m "feat(forms): parse form background image settings"
```

Run with `sandbox_permissions: "require_escalated"`.

---

### Task 3: Serve form background images

**Files:**
- Modify: `src/app/api/storage/[...key]/route.ts`
- Test: `__tests__/api/storage-asset-route.test.ts` (create)

**Interfaces:**
- Consumes: `isFormBackgroundStorageKey` from `@/lib/form-background-url`
- Produces: `GET /api/storage/[...key]` serves keys matching workspace-logo OR form-background patterns

- [ ] **Step 1: Write the failing test**

Create `__tests__/api/storage-asset-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  download: vi.fn(),
  getMetadata: vi.fn(),
}));

vi.mock('@/lib/storage', () => ({
  storage: {
    download: mocks.download,
    getMetadata: mocks.getMetadata,
  },
}));

import { GET } from '@/app/api/storage/[...key]/route';

describe('GET /api/storage/[...key]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.download.mockResolvedValue(new Uint8Array([1, 2, 3]));
    mocks.getMetadata.mockResolvedValue({ contentType: 'image/png' });
  });

  it('serves a form background image', async () => {
    const response = await GET(new Request('http://localhost/api/storage/tenant-1/forms/form-1/branding/background.png'), {
      params: Promise.resolve({ key: ['tenant-1', 'forms', 'form-1', 'branding', 'background.png'] }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(mocks.download).toHaveBeenCalledWith('tenant-1/forms/form-1/branding/background.png');
  });

  it('still serves workspace logos', async () => {
    const response = await GET(new Request('http://localhost/api/storage/tenant-1/branding/logo.png'), {
      params: Promise.resolve({ key: ['tenant-1', 'branding', 'logo.png'] }),
    });

    expect(response.status).toBe(200);
  });

  it('rejects unknown storage keys without downloading', async () => {
    const response = await GET(new Request('http://localhost/api/storage/tenant-1/other/file.png'), {
      params: Promise.resolve({ key: ['tenant-1', 'other', 'file.png'] }),
    });

    expect(response.status).toBe(404);
    expect(mocks.download).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm.cmd run test:run -- __tests__/api/storage-asset-route.test.ts`

Expected: FAIL — form background key returns 404.

- [ ] **Step 3: Implement the allowlist change**

In `src/app/api/storage/[...key]/route.ts`:

1. Update the import:

```ts
import { isWorkspaceLogoStorageKey } from '@/lib/workspace-logo-url';
import { isFormBackgroundStorageKey } from '@/lib/form-background-url';
```

2. Update the guard:

```ts
  if (!isWorkspaceLogoStorageKey(storageKey) && !isFormBackgroundStorageKey(storageKey)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm.cmd run test:run -- __tests__/api/storage-asset-route.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add __tests__/api/storage-asset-route.test.ts src/app/api/storage/[...key]/route.ts
git commit -m "feat(forms): serve form background images from storage"
```

Run with `sandbox_permissions: "require_escalated"`.

---

### Task 4: Background upload API

**Files:**
- Create: `src/app/api/forms/[id]/background/route.ts`
- Test: `__tests__/api/form-background-route.test.ts` (create)

**Interfaces:**
- Consumes: `requireAuth`, `requirePermission`, `resolveWorkspaceId`, `createErrorResponse`, `prisma`, `storage`, `StorageKeys.formBackground`, `validateFileContent`/`ALLOWED_FILE_TYPES`, `getFormBackgroundPublicUrl`
- Produces: `POST /api/forms/[id]/background` → `201 { backgroundImageUrl: string }`; does not write to the DB

- [ ] **Step 1: Write the failing test**

Create `__tests__/api/form-background-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requirePermission: vi.fn(),
  resolveWorkspaceId: vi.fn(),
  createErrorResponse: vi.fn(),
  findFirst: vi.fn(),
  upload: vi.fn(),
  validateFileContent: vi.fn(),
  formBackground: vi.fn(),
  getFormBackgroundPublicUrl: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: mocks.requireAuth }));
vi.mock('@/lib/rbac', () => ({ requirePermission: mocks.requirePermission }));
vi.mock('@/lib/api-helpers', () => ({
  resolveWorkspaceId: mocks.resolveWorkspaceId,
  createErrorResponse: mocks.createErrorResponse,
}));
vi.mock('@/lib/prisma', () => ({
  prisma: { form: { findFirst: mocks.findFirst } },
}));
vi.mock('@/lib/storage', () => ({
  storage: { upload: mocks.upload },
  StorageKeys: { formBackground: mocks.formBackground },
}));
vi.mock('@/lib/file-validation', () => ({
  ALLOWED_FILE_TYPES: { IMAGE: 'image' },
  validateFileContent: mocks.validateFileContent,
}));
vi.mock('@/lib/form-background-url', () => ({
  getFormBackgroundPublicUrl: mocks.getFormBackgroundPublicUrl,
}));

import type { NextRequest } from 'next/server';
import { POST } from '@/app/api/forms/[id]/background/route';

const storageKey = 'tenant-1/forms/form-1/branding/background.png';
const publicUrl = `/api/storage/${encodeURIComponent(storageKey)}`;

function pngFile(size = 8): File {
  return new File([new Uint8Array(size)], 'bg.png', { type: 'image/png' });
}

function makeRequest(file: File | null, tenantId = 'tenant-1') {
  const formData = new FormData();
  if (file) formData.set('file', file);
  const query = tenantId ? `?tenantId=${tenantId}` : '';
  return new Request(`http://localhost/api/forms/form-1/background${query}`, {
    method: 'POST',
    body: formData,
  });
}

describe('POST /api/forms/[id]/background', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({ id: 'user-1', tenantId: 'tenant-1' });
    mocks.requirePermission.mockResolvedValue(undefined);
    mocks.resolveWorkspaceId.mockReturnValue('tenant-1');
    mocks.findFirst.mockResolvedValue({ id: 'form-1', tenantId: 'tenant-1' });
    mocks.validateFileContent.mockReturnValue({ valid: true, ext: 'png', mime: 'image/png' });
    mocks.formBackground.mockReturnValue(storageKey);
    mocks.getFormBackgroundPublicUrl.mockReturnValue(publicUrl);
    mocks.upload.mockResolvedValue(undefined);
    mocks.createErrorResponse.mockImplementation((error: unknown) =>
      new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Internal server error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    );
  });

  it('uploads a valid image and returns the public URL', async () => {
    const response = await POST(makeRequest(pngFile()) as NextRequest, {
      params: Promise.resolve({ id: 'form-1' }),
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ backgroundImageUrl: publicUrl });
    expect(mocks.formBackground).toHaveBeenCalledWith('tenant-1', 'form-1', '.png');
    expect(mocks.upload).toHaveBeenCalledWith(
      storageKey,
      expect.any(Buffer),
      expect.objectContaining({
        contentType: 'image/png',
        cacheControl: 'public, max-age=31536000, immutable',
        metadata: expect.objectContaining({ formId: 'form-1', uploadedBy: 'user-1', tenantId: 'tenant-1' }),
      })
    );
  });

  it('returns 400 when the file is missing', async () => {
    const response = await POST(makeRequest(null) as NextRequest, {
      params: Promise.resolve({ id: 'form-1' }),
    });

    expect(response.status).toBe(400);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('returns 400 for a disallowed MIME type', async () => {
    const textFile = new File(['hello'], 'note.txt', { type: 'text/plain' });
    const response = await POST(makeRequest(textFile) as NextRequest, {
      params: Promise.resolve({ id: 'form-1' }),
    });

    expect(response.status).toBe(400);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('returns 400 for a file larger than 5MB', async () => {
    const bigFile = pngFile(5 * 1024 * 1024 + 1);
    const response = await POST(makeRequest(bigFile) as NextRequest, {
      params: Promise.resolve({ id: 'form-1' }),
    });

    expect(response.status).toBe(400);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('returns 400 when content validation fails', async () => {
    mocks.validateFileContent.mockReturnValue({ valid: false, error: 'Not an image' });
    const response = await POST(makeRequest(pngFile()) as NextRequest, {
      params: Promise.resolve({ id: 'form-1' }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Not an image' });
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('returns 404 when the form does not belong to the workspace', async () => {
    mocks.findFirst.mockResolvedValue(null);
    const response = await POST(makeRequest(pngFile()) as NextRequest, {
      params: Promise.resolve({ id: 'missing' }),
    });

    expect(response.status).toBe(404);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('returns 401 when authentication fails', async () => {
    mocks.requireAuth.mockRejectedValue(new Error('Unauthorized'));
    const response = await POST(makeRequest(pngFile()) as NextRequest, {
      params: Promise.resolve({ id: 'form-1' }),
    });

    expect(response.status).toBe(401);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
});
```

Note: if the test environment lacks `File`, replace `new File([...], name, { type })` with a minimal object `{ name, type, size, arrayBuffer: async () => new ArrayBuffer(size) }` appended to the `FormData` via `formData.set('file', file as unknown as File)`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm.cmd run test:run -- __tests__/api/form-background-route.test.ts`

Expected: FAIL — module `@/app/api/forms/[id]/background/route` not found.

- [ ] **Step 3: Implement the route**

Create `src/app/api/forms/[id]/background/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { resolveWorkspaceId, createErrorResponse } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';
import { storage, StorageKeys } from '@/lib/storage';
import { ALLOWED_FILE_TYPES, validateFileContent } from '@/lib/file-validation';
import { getFormBackgroundPublicUrl } from '@/lib/form-background-url';

const MAX_BACKGROUND_SIZE_BYTES = 5 * 1024 * 1024;
const CLIENT_ALLOWED_BACKGROUND_MIME_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];

interface UploadedBackgroundFile {
  name: string;
  type: string;
  size: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
}

function isUploadedBackgroundFile(value: FormDataEntryValue | null): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    'type' in value &&
    'size' in value &&
    'arrayBuffer' in value &&
    typeof value.name === 'string' &&
    typeof value.type === 'string' &&
    typeof value.size === 'number' &&
    typeof value.arrayBuffer === 'function'
  );
}

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    await requirePermission(session, 'document', 'update');

    const { searchParams } = new URL(request.url);
    const tenantId = resolveWorkspaceId(session, searchParams.get('tenantId'));
    const { id } = await params;

    const form = await prisma.form.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!form) {
      return NextResponse.json({ error: 'Form not found' }, { status: 404 });
    }

    const formData = await request.formData();
    const file = formData.get('file');

    if (!isUploadedBackgroundFile(file)) {
      return NextResponse.json({ error: 'Background image file is required' }, { status: 400 });
    }

    const backgroundFile = file as unknown as UploadedBackgroundFile;

    if (backgroundFile.size > MAX_BACKGROUND_SIZE_BYTES) {
      return NextResponse.json({ error: 'Background image must be 5MB or smaller' }, { status: 400 });
    }

    if (!CLIENT_ALLOWED_BACKGROUND_MIME_TYPES.includes(backgroundFile.type)) {
      return NextResponse.json({ error: 'Only image files (PNG, JPG, WebP, GIF) are allowed' }, { status: 400 });
    }

    const buffer = Buffer.from(await backgroundFile.arrayBuffer());
    const validation = validateFileContent(buffer, ALLOWED_FILE_TYPES.IMAGE, backgroundFile.type);

    if (!validation.valid || !validation.ext || !validation.mime) {
      return NextResponse.json(
        { error: validation.error || 'Only image files (PNG, JPG, WebP, GIF) are allowed' },
        { status: 400 }
      );
    }

    const extension = validation.ext === 'jpg' ? '.jpg' : `.${validation.ext}`;
    const storageKey = StorageKeys.formBackground(tenantId, id, extension);
    await storage.upload(storageKey, buffer, {
      contentType: validation.mime,
      cacheControl: 'public, max-age=31536000, immutable',
      metadata: {
        originalFileName: backgroundFile.name,
        uploadedBy: session.id,
        tenantId,
        formId: id,
      },
    });

    return NextResponse.json({ backgroundImageUrl: getFormBackgroundPublicUrl(storageKey) }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return createErrorResponse(error);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm.cmd run test:run -- __tests__/api/form-background-route.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add __tests__/api/form-background-route.test.ts src/app/api/forms/[id]/background/route.ts
git commit -m "feat(forms): add form background upload API"
```

Run with `sandbox_permissions: "require_escalated"`.

---

### Task 5: Builder uploader component

**Files:**
- Create: `src/components/forms/form-background-uploader.tsx`
- Test: `__tests__/components/form-background-uploader.test.tsx` (create)

**Interfaces:**
- Consumes: `formId: string`, `value: string | null`, `opacity: number`
- Produces: `onUrlChange(url: string | null): void`, `onOpacityChange(opacity: number): void`
- Produces: `FormBackgroundUploader` component (named export)

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/form-background-uploader.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FormBackgroundUploader } from '@/components/forms/form-background-uploader';

describe('FormBackgroundUploader', () => {
  const onUrlChange = vi.fn();
  const onOpacityChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ backgroundImageUrl: '/api/storage/tenant-1%2Fforms%2Fform-1%2Fbranding%2Fbackground.png' }),
        { status: 201, headers: { 'Content-Type': 'application/json' } }
      )
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uploads a selected file and reports the returned URL', async () => {
    render(
      <FormBackgroundUploader
        formId="form-1"
        value={null}
        opacity={40}
        onUrlChange={onUrlChange}
        onOpacityChange={onOpacityChange}
      />
    );

    const input = screen.getByLabelText('Upload background image') as HTMLInputElement;
    const file = new File([new Uint8Array([1])], 'bg.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(onUrlChange).toHaveBeenCalledWith(
      '/api/storage/tenant-1%2Fforms%2Fform-1%2Fbranding%2Fbackground.png'
    ));
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/forms/form-1/background',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('removes the background', () => {
    render(
      <FormBackgroundUploader
        formId="form-1"
        value="/api/storage/tenant-1%2Fforms%2Fform-1%2Fbranding%2Fbackground.png"
        opacity={40}
        onUrlChange={onUrlChange}
        onOpacityChange={onOpacityChange}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onUrlChange).toHaveBeenCalledWith(null);
  });

  it('reports opacity slider changes', () => {
    render(
      <FormBackgroundUploader
        formId="form-1"
        value="/api/storage/tenant-1%2Fforms%2Fform-1%2Fbranding%2Fbackground.png"
        opacity={40}
        onUrlChange={onUrlChange}
        onOpacityChange={onOpacityChange}
      />
    );

    fireEvent.change(screen.getByLabelText('Background opacity'), { target: { value: '65' } });
    expect(onOpacityChange).toHaveBeenCalledWith(65);
  });

  it('shows an error when the upload fails', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'Background image must be 5MB or smaller' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    render(
      <FormBackgroundUploader
        formId="form-1"
        value={null}
        opacity={40}
        onUrlChange={onUrlChange}
        onOpacityChange={onOpacityChange}
      />
    );

    const input = screen.getByLabelText('Upload background image') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([new Uint8Array([1])], 'bg.png', { type: 'image/png' })] } });

    expect(await screen.findByText('Background image must be 5MB or smaller')).toBeVisible();
    expect(onUrlChange).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm.cmd run test:run -- __tests__/components/form-background-uploader.test.tsx`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Create `src/components/forms/form-background-uploader.tsx`:

```tsx
'use client';

import { useRef, useState } from 'react';
import { UploadCloud } from 'lucide-react';
import { cn } from '@/lib/utils';

const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_SIZE_BYTES = 5 * 1024 * 1024;

export function FormBackgroundUploader({
  formId,
  value,
  opacity,
  onUrlChange,
  onOpacityChange,
}: {
  formId: string;
  value: string | null;
  opacity: number;
  onUrlChange: (url: string | null) => void;
  onOpacityChange: (opacity: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  async function handleFile(file: File) {
    setErrorText(null);

    if (!ACCEPTED_TYPES.includes(file.type)) {
      setErrorText('Only image files (PNG, JPG, WebP, GIF) are allowed');
      return;
    }

    if (file.size > MAX_SIZE_BYTES) {
      setErrorText('Background image must be 5MB or smaller');
      return;
    }

    setIsUploading(true);
    try {
      const body = new FormData();
      body.append('file', file);
      const response = await fetch(`/api/forms/${formId}/background`, {
        method: 'POST',
        body,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || 'Failed to upload background image');
      }
      onUrlChange(data.backgroundImageUrl as string);
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : 'Failed to upload background image');
    } finally {
      setIsUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'flex h-24 w-40 shrink-0 items-center justify-center overflow-hidden rounded-lg border',
            value
              ? 'border-border-primary bg-background-secondary'
              : 'border-dashed border-border-primary/60 bg-background-secondary'
          )}
        >
          {value ? (
            <img src={value} alt="" className="h-full w-full object-cover" />
          ) : (
            <UploadCloud className="h-6 w-6 text-text-muted" />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="sr-only"
            aria-label="Upload background image"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
          <button
            type="button"
            disabled={isUploading}
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center justify-center rounded-lg border border-border-primary bg-background-elevated px-3 py-1.5 text-sm font-medium text-text-primary transition-colors hover:bg-background-tertiary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isUploading ? 'Uploading...' : value ? 'Replace image' : 'Upload image'}
          </button>
          {value && (
            <button
              type="button"
              onClick={() => onUrlChange(null)}
              className="inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-sm text-status-error transition-colors hover:bg-status-error/5"
            >
              Remove
            </button>
          )}
        </div>
      </div>

      {value && (
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-text-secondary">Background opacity</span>
          <input
            type="range"
            min={0}
            max={100}
            value={opacity}
            onChange={(event) => onOpacityChange(Number(event.target.value))}
            className="w-full"
            aria-label="Background opacity"
          />
          <span className="mt-0.5 block text-2xs text-text-muted">{opacity}%</span>
        </label>
      )}

      {errorText && <p className="text-xs text-status-error">{errorText}</p>}
      {!value && !errorText && (
        <p className="text-2xs text-text-muted">
          Shown behind the form. The default gradient stays visible. PNG, JPG, WebP or GIF up to 5MB.
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm.cmd run test:run -- __tests__/components/form-background-uploader.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add __tests__/components/form-background-uploader.test.tsx src/components/forms/form-background-uploader.tsx
git commit -m "feat(forms): add background image uploader component"
```

Run with `sandbox_permissions: "require_escalated"`.

---

### Task 6: Wire the builder settings

**Files:**
- Modify: `src/components/forms/builder-utils.ts` (`serializeBuilderState`)
- Modify: `src/app/(dashboard)/forms/[id]/builder/page.tsx`
- Test: `__tests__/lib/builder-state-background.test.ts` (create)

**Interfaces:**
- Consumes: `FormBackgroundUploader`, `normalizeFormBackgroundUrl`
- Produces: `serializeBuilderState` accepts and emits `backgroundImageUrl?: string | null` (serialized as trimmed string or null) and `backgroundImageOpacity?: number` (serialized as clamped integer or 40)

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/builder-state-background.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { serializeBuilderState } from '@/components/forms/builder-utils';

const base = {
  title: 'Form',
  description: '',
  slug: 'my-form',
  status: 'DRAFT' as const,
  tags: [],
  fields: [],
};

describe('serializeBuilderState background fields', () => {
  it('includes background image settings', () => {
    const state = JSON.parse(serializeBuilderState({
      ...base,
      backgroundImageUrl: '/api/storage/tenant-1%2Fforms%2Fform-1%2Fbranding%2Fbackground.png',
      backgroundImageOpacity: 55,
    }));

    expect(state.backgroundImageUrl).toBe('/api/storage/tenant-1%2Fforms%2Fform-1%2Fbranding%2Fbackground.png');
    expect(state.backgroundImageOpacity).toBe(55);
  });

  it('defaults background fields when absent', () => {
    const state = JSON.parse(serializeBuilderState(base));

    expect(state.backgroundImageUrl).toBeNull();
    expect(state.backgroundImageOpacity).toBe(40);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm.cmd run test:run -- __tests__/lib/builder-state-background.test.ts`

Expected: FAIL — `backgroundImageUrl` / `backgroundImageOpacity` undefined.

- [ ] **Step 3: Extend `serializeBuilderState`**

In `src/components/forms/builder-utils.ts`:

1. Add to the input type after `hideFooter?: boolean;`:

```ts
  backgroundImageUrl?: string | null;
  backgroundImageOpacity?: number;
```

2. Add to the returned object after `hideFooter: input.hideFooter === true,`:

```ts
    backgroundImageUrl: typeof input.backgroundImageUrl === 'string' && input.backgroundImageUrl.trim()
      ? input.backgroundImageUrl.trim()
      : null,
    backgroundImageOpacity: typeof input.backgroundImageOpacity === 'number' && Number.isFinite(input.backgroundImageOpacity)
      ? Math.min(100, Math.max(0, Math.round(input.backgroundImageOpacity)))
      : 40,
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm.cmd run test:run -- __tests__/lib/builder-state-background.test.ts`

Expected: PASS.

- [ ] **Step 5: Wire the builder page**

In `src/app/(dashboard)/forms/[id]/builder/page.tsx`:

1. Add imports:

```ts
import { FormBackgroundUploader } from '@/components/forms/form-background-uploader';
import { normalizeFormBackgroundUrl } from '@/lib/form-background-url';
```

2. Add state after `const [hideFooter, setHideFooter] = useState(false);`:

```ts
  const [backgroundImageUrl, setBackgroundImageUrl] = useState<string | null>(null);
  const [backgroundImageOpacity, setBackgroundImageOpacity] = useState(40);
```

3. In the hydration `useEffect`, after `setHideFooter(settingsObj.hideFooter === true);`:

```ts
    setBackgroundImageUrl(normalizeFormBackgroundUrl(
      typeof settingsObj.backgroundImageUrl === 'string' ? settingsObj.backgroundImageUrl : null
    ));
    setBackgroundImageOpacity(
      typeof settingsObj.backgroundImageOpacity === 'number' && Number.isFinite(settingsObj.backgroundImageOpacity)
        ? Math.min(100, Math.max(0, Math.round(settingsObj.backgroundImageOpacity)))
        : 40
    );
```

4. In the first `baselineSnapshot.current = serializeBuilderState({ ... })` (after load), add both fields after `hideFooter:`:

```ts
      backgroundImageUrl,
      backgroundImageOpacity,
```

5. In the `stateSnapshot` useMemo (used for unsaved-changes warning), add both fields after `hideFooter,` and add `backgroundImageUrl, backgroundImageOpacity,` to its dependency array.

6. In `persistForm`, change the settings merge to:

```ts
      nextSettings = {
        ...settingsRecord,
        hideLogo: hideLogo === true,
        hideFooter: hideFooter === true,
        backgroundImageUrl: backgroundImageUrl || null,
        backgroundImageOpacity,
      };
```

7. In the second `baselineSnapshot.current = serializeBuilderState({ ... })` (after save), add both fields after `hideFooter,`.

8. In the "Appearance & PDF" `SettingsSection`, update `summary` and `configured`:

```tsx
                summary={[
                  ...(backgroundImageUrl ? ['Background image'] : []),
                  ...(!hideLogo ? ['Logo'] : []),
                  ...(!hideFooter ? ['Footer'] : []),
                  ...(pdfFileNameTemplate ? ['PDF template'] : []),
                ].join(' · ') || 'Default appearance'}
                configured={!!pdfFileNameTemplate || hideLogo || hideFooter || !!backgroundImageUrl}
```

9. Add the component at the top of the section body, before the `FormInput` for the PDF filename template:

```tsx
                <FormBackgroundUploader
                  formId={formId}
                  value={backgroundImageUrl}
                  opacity={backgroundImageOpacity}
                  onUrlChange={setBackgroundImageUrl}
                  onOpacityChange={setBackgroundImageOpacity}
                />
```

- [ ] **Step 6: Type-check and run the tests**

Run: `npm.cmd run test:run -- __tests__/lib/builder-state-background.test.ts __tests__/components/form-background-uploader.test.tsx`

Expected: PASS. Also run `npx.cmd tsc --noEmit` and fix any type errors in the changed files (existing `tsc-errors.txt` issues outside this feature can be ignored).

- [ ] **Step 7: Commit**

```bash
git add __tests__/lib/builder-state-background.test.ts src/components/forms/builder-utils.ts src/app/(dashboard)/forms/[id]/builder/page.tsx
git commit -m "feat(forms): wire background image settings into form builder"
```

Run with `sandbox_permissions: "require_escalated"`.

---

### Task 7: Render the background on the public page

**Files:**
- Modify: `src/app/(public)/forms/f/[slug]/page.tsx`
- Test: `__tests__/app/public-form-page.test.tsx` (extend)

**Interfaces:**
- Consumes: `form.settings.backgroundImageUrl` and `form.settings.backgroundImageOpacity` (already normalized/parsed by `buildPublicFormSettings`)
- Produces: decorative `fixed inset-0` image layer (object-cover, mix-blend-multiply, opacity = saved/100) on the form page and success screen; none in embed mode; gradient container classes unchanged

- [ ] **Step 1: Write the failing tests**

Extend `__tests__/app/public-form-page.test.tsx`:

1. Add a mutable value with `var` (not `let`) so the hoisted `vi.mock` factory can read it without a temporal-dead-zone error. Place it directly before the `vi.mock('next/navigation', ...)` block:

```ts
// eslint-disable-next-line no-var
var currentSearchParams = '';
```

Change the mock to:

```ts
  useSearchParams: () => new URLSearchParams(currentSearchParams),
```

2. In `beforeEach`, reset it:

```ts
    currentSearchParams = '';
```

3. Add a helper near the other form builders:

```tsx
function backgroundForm(url: string | null, opacity = 55) {
  return {
    ...publicForm,
    settings: {
      ...publicForm.settings,
      ...(url ? { backgroundImageUrl: url } : {}),
      backgroundImageOpacity: opacity,
    },
  };
}
```

4. Add tests inside the existing `describe('PublicFormPage', ...)`:

```tsx
  it('renders the configured background image at the saved opacity', async () => {
    currentPublicForm = backgroundForm('/api/storage/tenant-1%2Fforms%2Fform-1%2Fbranding%2Fbackground.png', 55);
    const { container } = render(<PublicFormPage />);

    await screen.findByRole('heading', { name: 'Annual Return Declaration' });

    const img = container.querySelector('img[src="/api/storage/tenant-1%2Fforms%2Fform-1%2Fbranding%2Fbackground.png"]') as HTMLImageElement | null;
    expect(img).not.toBeNull();
    expect(img?.style.opacity).toBe('0.55');
    expect(container.firstElementChild).toHaveClass('bg-gradient-to-b');
  });

  it('keeps the default gradient when no background is configured', async () => {
    const { container } = render(<PublicFormPage />);

    await screen.findByRole('heading', { name: 'Annual Return Declaration' });

    expect(container.querySelector('img[src^="/api/storage/"]')).toBeNull();
    expect(container.firstElementChild).toHaveClass('bg-gradient-to-b');
  });

  it('skips the background layer in embed mode', async () => {
    currentSearchParams = 'embed=1';
    currentPublicForm = backgroundForm('/api/storage/tenant-1%2Fforms%2Fform-1%2Fbranding%2Fbackground.png');
    const { container } = render(<PublicFormPage />);

    await screen.findByRole('heading', { name: 'Annual Return Declaration' });

    expect(container.querySelector('img[src^="/api/storage/"]')).toBeNull();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm.cmd run test:run -- __tests__/app/public-form-page.test.tsx`

Expected: FAIL — the new background tests find no image.

- [ ] **Step 3: Implement the rendering**

In `src/app/(public)/forms/f/[slug]/page.tsx`:

1. Add a memo after the `shouldShowFooter` memo:

```ts
  const backgroundSettings = useMemo(() => {
    const settingsObj = (form?.settings && typeof form.settings === 'object' && !Array.isArray(form.settings))
      ? form.settings as Record<string, unknown>
      : {};
    const url = typeof settingsObj.backgroundImageUrl === 'string' && settingsObj.backgroundImageUrl.trim().length > 0
      ? settingsObj.backgroundImageUrl.trim()
      : null;
    const rawOpacity = settingsObj.backgroundImageOpacity;
    const opacity = typeof rawOpacity === 'number' && Number.isFinite(rawOpacity)
      ? Math.min(100, Math.max(0, Math.round(rawOpacity)))
      : 40;
    return { url, opacity };
  }, [form?.settings]);
```

2. In the success-screen return, right after the opening container div:

```tsx
        {!isEmbed && backgroundSettings.url && (
          <div aria-hidden="true" className="pointer-events-none fixed inset-0">
            <img
              src={backgroundSettings.url}
              alt=""
              className="h-full w-full object-cover mix-blend-multiply"
              style={{ opacity: backgroundSettings.opacity / 100 }}
            />
          </div>
        )}
```

3. In the main form return, right after the opening container div and before `<div ref={formTopRef} ...>`:

```tsx
        {!isEmbed && backgroundSettings.url && (
          <div aria-hidden="true" className="pointer-events-none fixed inset-0">
            <img
              src={backgroundSettings.url}
              alt=""
              className="h-full w-full object-cover mix-blend-multiply"
              style={{ opacity: backgroundSettings.opacity / 100 }}
            />
          </div>
        )}
```

Note: the outer container keeps `bg-gradient-to-b from-[#FDFCFA] to-[#EDE8E3]` in non-embed mode; the image layer paints above the gradient and below the content that follows it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm.cmd run test:run -- __tests__/app/public-form-page.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add __tests__/app/public-form-page.test.tsx "src/app/(public)/forms/f/[slug]/page.tsx"
git commit -m "feat(forms): render form background image on public page"
```

Run with `sandbox_permissions: "require_escalated"`.

---

### Task 8: Documentation and final verification

**Files:**
- Modify: `docs/ARCHITECTURE.md`

- [ ] **Step 1: Update documentation**

In `docs/ARCHITECTURE.md`, under the branding section (currently: "Branding toggles such as `hideLogo` and `hideFooter`"), extend the sentence:

```md
- Branding toggles such as `hideLogo` and `hideFooter`; per-form background images (`backgroundImageUrl` + `backgroundImageOpacity`) uploaded through `POST /api/forms/[id]/background` and served via `/api/storage/[...key]`
```

- [ ] **Step 2: Run the full test suite**

Run: `npm.cmd run test:run`

Expected: all tests pass, including the new files and the modified `public-form-page.test.tsx`. If unrelated pre-existing failures appear, confirm they fail on `main` before this feature and report them rather than fixing out of scope.

- [ ] **Step 3: Commit**

```bash
git add docs/ARCHITECTURE.md
git commit -m "docs: document form background image branding settings"
```

Run with `sandbox_permissions: "require_escalated"`.

- [ ] **Step 4: Manual smoke check (optional, requires running app)**

Start the app with `npm.cmd run dev`, open a form's builder → Settings → Appearance & PDF, upload an image, set opacity, save, then open the public form URL and confirm the image layers over the gradient at the saved opacity.
