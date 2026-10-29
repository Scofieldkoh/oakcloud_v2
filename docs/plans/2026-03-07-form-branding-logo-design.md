# Design: Form Branding — Tenant Logo

**Date:** 2026-03-07
**Status:** Approved

## Overview

Add tenant-level logo upload and display it beside the form title in the public (end-user) form view. Admins can suppress the logo per-form via a toggle in the form builder.

## Section 1 — Tenant Logo Upload

### Storage
- Key pattern: `{tenantId}/branding/logo{ext}` (ext = `.png`, `.jpg`, `.webp`, `.svg`)
- On new upload, delete the previous logo file from storage first (overwrite semantics)
- Resulting URL saved to `tenant.logoUrl` (field already exists in DB schema and validation)

### API
- `POST /api/tenants/[id]/logo` — multipart upload, SUPER_ADMIN only
  - Validates mime type: `image/jpeg`, `image/png`, `image/webp`, `image/svg+xml`
  - Max size: 2 MB
  - Deletes existing logo from storage if present
  - Uploads new file, saves URL to `tenant.logoUrl`
- `DELETE /api/tenants/[id]/logo` — SUPER_ADMIN only
  - Deletes file from storage
  - Clears `tenant.logoUrl` (sets to null)

### Admin UI — Edit Tenant Modal (`/admin/tenants`)
- Add a logo section above existing fields in the Edit Tenant modal
- Show current logo preview (`<img>`) if `tenant.logoUrl` is set
- "Upload Logo" button → native file picker filtered to images
- Upload fires immediately on file select (not deferred to form save)
- "Remove" button shown when logo exists — calls DELETE route
- `tenant.logoUrl` is already included in the tenants list query select

## Section 2 — Form Setting: Hide Logo

### Storage
- New optional boolean key in `Form.settings` JSON: `hideLogo`
- Absent or `false` = show logo (default on)
- `true` = hide logo for this form
- No DB migration needed — `settings` is already a freeform JSON column

### Form Builder UI
- Add a toggle in the form builder settings panel
- Label: "Show tenant logo"
- Default: on (checked) — reflects absent/false `hideLogo`
- Toggling off sets `settings.hideLogo = true` on save

## Section 3 — Public Form View

### Data Flow
- `getPublicFormBySlug` in `src/services/form-builder.service.ts` joins `Form` → `Tenant` to fetch `logoUrl`
- `PublicFormDefinition` interface in `src/lib/form-utils.ts` gets new field: `tenantLogoUrl: string | null`
- The public API route already returns the full `PublicFormDefinition` — no route changes needed

### Rendering
- In `src/app/forms/f/[slug]/page.tsx`, replace the standalone `<h1>` title with a flex row:
  - `flex items-center gap-3`
  - Logo: `<img>` with `h-8 w-auto max-w-[120px] object-contain rounded-sm`
  - Title `<h1>` unchanged in styling
- Logo rendered only when **both** conditions are true:
  1. `tenantLogoUrl` is a non-empty string
  2. `settings.hideLogo` is not `true`
- If either condition fails, render title alone — no error, no layout shift

## Files to Change

| File | Change |
|------|--------|
| `src/app/api/tenants/[id]/logo/route.ts` | New — POST + DELETE handlers |
| `src/lib/storage/config.ts` | Add `StorageKeys.tenantLogo()` |
| `src/app/(dashboard)/admin/tenants/page.tsx` | Logo upload UI in Edit modal |
| `src/hooks/use-admin.ts` | Expose `logoUrl` in Tenant type if not already |
| `src/lib/form-utils.ts` | Add `tenantLogoUrl` to `PublicFormDefinition` |
| `src/services/form-builder.service.ts` | Join tenant in `getPublicFormBySlug`, return `tenantLogoUrl` |
| `src/app/forms/f/[slug]/page.tsx` | Render logo + title flex row |
| `src/components/forms/` | Form builder settings panel — add hideLogo toggle |
