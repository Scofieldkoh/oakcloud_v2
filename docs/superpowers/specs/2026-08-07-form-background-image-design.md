# Form Background Image — Design

> **Date**: 2026-08-07
> **Status**: Approved (pending written review)
> **Scope**: Public form appearance settings

## Goal

Let a form creator upload a background image for a public form and control how strongly it shows. The default warm gradient remains the page base; the uploaded image is layered over it at a per-form adjustable opacity so text and field cards stay readable.

## Context

- Public form page: `src/app/(public)/forms/f/[slug]/page.tsx` renders a warm gradient background (`bg-gradient-to-b from-[#FDFCFA] to-[#EDE8E3]`) with floating field cards.
- Appearance flags such as `hideLogo` and `hideFooter` already live in `Form.settings` (JSON) and are parsed by `buildPublicFormSettings` in `src/lib/form-utils.ts`.
- Workspace logo uploads already follow an established pattern: `POST /api/workspace/settings/logo` validates and uploads a file, stores the public URL, and serves it through `GET /api/storage/[...key]` (see `src/lib/workspace-logo-url.ts`).
- The form builder (`src/app/(dashboard)/forms/[id]/builder/page.tsx`) persists all settings as one bundle through `PATCH /api/forms/[id]` on Save.

## Requirements

1. A form creator can upload a background image from the form builder (Appearance & PDF settings section).
2. The upload is validated (image MIME types only, 5MB max, content sniffed) and served through the existing app storage route.
3. The background setting is stored per form in `Form.settings` as `backgroundImageUrl` (string URL or null) and `backgroundImageOpacity` (integer 0–100, default 40).
4. The public form keeps the default gradient as its base. When an image is set, it renders as a full-page, non-interactive layer on top of the gradient at the saved opacity, blended so the gradient remains visible.
5. The background applies to the form page and the response-success screen once the form is loaded. It does not apply in embed mode. Loading and error screens keep the default gradient (the form is not loaded yet, so the setting is unavailable).
6. Removing the image and adjusting opacity are part of the normal builder Save flow (no immediate DB writes on upload).

## Design

### Settings storage

No database migration. Two new keys in `Form.settings`:

| Key | Type | Default | Notes |
| --- | --- | --- | --- |
| `backgroundImageUrl` | `string \| null` | `null` | Public app storage URL (e.g. `/api/storage/<key>`); null means no image. |
| `backgroundImageOpacity` | `number` | `40` | Integer 0–100. `0` is effectively invisible; stored values are clamped on read. |

### Storage key and URL helper

New file `src/lib/form-background-url.ts`, mirroring `src/lib/workspace-logo-url.ts`:

- `StorageKeys.formBackground(tenantId, formId, extension)` → `` `${tenantId}/forms/${formId}/branding/background${extension}` `` (added to `src/lib/storage/config.ts`).
- `FORM_BACKGROUND_KEY_PATTERN` matches `^[^/]+\/forms\/[^/]+\/branding\/background\.(png|jpg|jpeg|webp|gif)$` (case-insensitive).
- `isFormBackgroundStorageKey(value: string): boolean`
- `getFormBackgroundPublicUrl(storageKey: string): string` → `/api/storage/<encodeURIComponent(key)>`
- `normalizeFormBackgroundUrl(value: string | null | undefined): string | null` — accepts a raw storage key, an app storage URL, or an S3 URL and returns the app public URL; arbitrary URLs pass through unchanged (same behavior as `normalizeWorkspaceLogoUrl`).

### Storage serving route

`src/app/api/storage/[...key]/route.ts` currently rejects everything that is not a workspace logo key. Extend the allow check to `isWorkspaceLogoStorageKey(storageKey) || isFormBackgroundStorageKey(storageKey)`. No other behavior changes.

### Upload API

New route `src/app/api/forms/[id]/background/route.ts`:

- `POST` only.
- Auth: `requireAuth()`; permission: `requirePermission(session, 'document', 'update')`; workspace resolution via `resolveWorkspaceId(session, searchParams.get('tenantId'))` (same as `src/app/api/forms/[id]/route.ts`).
- Verify the form exists and belongs to the workspace (`prisma.form.findFirst({ where: { id, tenantId, deletedAt: null } })`); 404 otherwise.
- Accept a single `file` from `FormData`. Reject missing file (400), MIME not in `['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif']` (400), and size > 5MB (400).
- Validate content with `validateFileContent(buffer, ALLOWED_FILE_TYPES.IMAGE, file.type)` from `@/lib/file-validation`; reject invalid content (400).
- Upload via `storage.upload` to `StorageKeys.formBackground(tenantId, formId, extension)` with `contentType`, `cacheControl: 'public, max-age=31536000, immutable'`, and metadata (`originalFileName`, `uploadedBy`, `tenantId`, `formId`).
- Respond `201 { backgroundImageUrl: getFormBackgroundPublicUrl(storageKey) }`.
- Does not write to the database and does not create an audit log itself; the builder's normal `PATCH /api/forms/[id]` save persists the URL and produces the existing audit trail.
- Error shape follows existing routes: `{ error: string }` with appropriate status codes.

### Builder UI

New component `src/components/forms/form-background-uploader.tsx`:

- Props: `formId: string`, `value: string | null`, `opacity: number`, `onUrlChange(url: string | null): void`, `onOpacityChange(opacity: number): void`.
- Renders an upload control (hidden `<input type="file">` accepting `image/png,image/jpeg,image/webp,image/gif`), a 16:9 preview thumbnail when `value` is set, a "Remove" button, and an opacity slider (`<input type="range" min={0} max={100}>`) shown only when `value` is set.
- On file select: client-side size check (5MB), `POST /api/forms/{formId}/background` with `FormData`, calls `onUrlChange` with the returned URL, shows inline loading/error text.
- The slider calls `onOpacityChange` with the raw number; the parent clamps/stores it.

Builder page changes (`src/app/(dashboard)/forms/[id]/builder/page.tsx`):

- New local state: `backgroundImageUrl: string | null` and `backgroundImageOpacity: number` (default 40).
- Hydrate from `settingsObj.backgroundImageUrl` (normalized via `normalizeFormBackgroundUrl`) and `settingsObj.backgroundImageOpacity` (clamped to 0–100 integer, default 40) in the existing `useEffect`.
- Include both fields in `serializeBuilderState` baseline snapshots and in the persisted settings payload: `nextSettings = { ...settingsRecord, hideLogo, hideFooter, backgroundImageUrl: backgroundImageUrl || null, backgroundImageOpacity }`.
- Add the component to the "Appearance & PDF" `SettingsSection`; update the section `summary` and `configured` flags so a set background is reflected.

### Public form page

`src/lib/form-utils.ts` — extend `buildPublicFormSettings`:

```ts
nextSettings.backgroundImageUrl = normalizeFormBackgroundUrl(root?.backgroundImageUrl);
nextSettings.backgroundImageOpacity =
  typeof root?.backgroundImageOpacity === 'number' && Number.isFinite(root.backgroundImageOpacity)
    ? Math.min(100, Math.max(0, Math.round(root.backgroundImageOpacity)))
    : 40;
```

`src/app/(public)/forms/f/[slug]/page.tsx`:

- Read `backgroundImageUrl` and `backgroundImageOpacity` from the form settings object already used for `hideLogo`/`hideFooter`.
- The outer container keeps the existing gradient classes in all cases (no `bg-transparent` replacement).
- When `!isEmbed && backgroundImageUrl`, render immediately after the opening container div:

```tsx
{!isEmbed && backgroundImageUrl && (
  <div aria-hidden="true" className="pointer-events-none fixed inset-0">
    <img
      src={backgroundImageUrl}
      alt=""
      className="h-full w-full object-cover mix-blend-multiply"
      style={{ opacity: backgroundImageOpacity / 100 }}
    />
  </div>
)}
```

- Apply the same layer in the `submissionId` (success) branch; keep loading and error branches on the default gradient only.
- `mix-blend-multiply` keeps the warm gradient visible through the image and preserves text contrast.

## Error Handling

- Upload: clear inline error messages for missing file, unsupported type, oversize, upload failure, and form-not-found.
- Public page: if the URL fails to load, the gradient remains visible (broken-image fallback is acceptable since the layer is decorative); the image layer is `aria-hidden` and `pointer-events-none`.
- Settings read: malformed opacity falls back to 40; non-string URL values are treated as absent.

## Testing (TDD)

Tests are written before implementation, one behavior at a time:

1. `__tests__/lib/form-background-url.test.ts` — key pattern acceptance/rejection, public URL encoding, normalization of raw key / app URL / S3 URL / arbitrary URL / null.
2. `__tests__/lib/form-utils-background.test.ts` — `buildPublicFormSettings` returns normalized URL, clamps opacity, defaults opacity to 40.
3. `__tests__/api/form-background-route.test.ts` — auth failure, missing form, missing file, disallowed MIME, oversize, content-validation failure, success returns 201 + URL, storage not called on validation failures (route-test pattern from `__tests__/api/form-name-check-route.test.ts`).
4. `__tests__/api/storage-asset-route.test.ts` — storage route serves form background keys and still rejects unknown keys.
5. `__tests__/components/form-background-uploader.test.tsx` — upload success calls `onUrlChange` with the returned URL; remove calls `onUrlChange(null)`; slider calls `onOpacityChange`; error text on failure.
6. `__tests__/app/public-form-page.test.tsx` (extend) — renders the background image with the saved opacity style when settings include it; renders nothing when absent; nothing in embed mode; gradient container remains present.

## Out of Scope

- Cleanup of orphaned uploaded background files (can be covered later by extending the existing upload-cleanup task).
- Applying the background to response PDFs.
- Gradient/color presets, per-field backgrounds, SVG uploads, dark mode for public forms.
- Exposing the opacity control on the public page.
