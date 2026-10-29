# Form Submission PDF Redesign

**Date**: 2026-03-09
**Status**: Approved

## Goal

Replace the plain pdf-lib text-drawing PDF with a polished HTML→PDF report rendered via Puppeteer. The PDF should mirror what the end-user sees on the public form: logo (respecting `hideLogo`), form title, description, all fields as a continuous flow (no form-page splits), and a copyright footer (respecting `hideFooter`).

## Layout

```
┌─────────────────────────────────────────┐
│  [Logo]  Form Title                     │  header, white bg
│          Form description (if any)      │
├─────────────────────────────────────────┤  thin accent line
│  Submitted: ...  │  Status: ...         │  metadata row, gray bg
│  Respondent: ...  │  Email: ...         │
├─────────────────────────────────────────┤
│  Field Label                            │
│  Value (in card)                        │
│                                         │
│  [Repeat Section Title]                 │
│    Card 1:  Label → Value               │
│    Card 2:  Label → Value               │
├─────────────────────────────────────────┤
│              © TenantName               │  footer, every page
└─────────────────────────────────────────┘
```

Key rules:
- Fields flow continuously — no page breaks mirroring the form's page structure
- `page-break-inside: avoid` on each field block so values are never cut mid-field
- Signature rendered as inline `<img>` from data URL
- File uploads rendered as plain filename text (no download links)
- PARAGRAPH/HTML/info fields skipped (display-only, not submission data)
- Repeat sections rendered as labeled cards with sub-fields inside

## Branding

- Logo: `<img src="{appBaseUrl}{tenantLogoUrl}">` — Puppeteer fetches it. Skip if `hideLogo: true` or no URL.
- Footer: `© {tenantName}` — rendered via Puppeteer's `footerTemplate`. Skip if `hideFooter: true` or no tenant name.

## Architecture

### New: `buildSubmissionPdfHtml(input)`
Pure function in `form-builder.service.ts`. Returns a self-contained HTML string with inline CSS (system-ui / Inter font stack, no external dependencies). Handles the same conditional logic and field types as the old pdf-lib renderer.

### Updated: `buildSubmissionPdfBuffer(input)`
Calls `buildSubmissionPdfHtml` then passes the result to Puppeteer's `generatePDF`. Signature gains three new optional fields:
- `tenantLogoUrl: string | null`
- `tenantName: string | null`
- `formSettings: unknown` (parsed for `hideLogo`, `hideFooter`)

### Updated: call sites (3 places)
All pass the new branding fields:
1. `exportFormResponsePdf` — add `tenant: { select: { logoUrl, name } }` to the form query
2. `exportPublicFormResponsePdf` — add same join to `getPublishedFormSubmissionContext`
3. `sendCompletionNotificationEmail` — form already joined; add tenant select

### Reused: `generatePDF` + `findChromePath`
Currently private in `document-export.service.ts`. Extract to module-level exports (or duplicate minimally in form-builder.service.ts if coupling is undesirable).

## Files Changed

| File | Change |
|------|--------|
| `src/services/form-builder.service.ts` | Add `buildSubmissionPdfHtml`, update `buildSubmissionPdfBuffer`, update 3 call sites + queries |
| `src/services/document-export.service.ts` | Export `generatePDF` and `findChromePath` |
