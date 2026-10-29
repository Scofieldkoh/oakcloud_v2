# Form Submission PDF Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the plain pdf-lib text-drawing PDF with a polished HTML→PDF report rendered via Puppeteer, including tenant logo, form title/description, all fields as a continuous flow, and a copyright footer.

**Architecture:** Add `buildSubmissionPdfHtml()` that produces a self-contained HTML string, then replace `buildSubmissionPdfBuffer()`'s pdf-lib internals with a Puppeteer call. Export `generatePDF`/`findChromePath` from `document-export.service.ts` for reuse. Thread branding data (`tenantLogoUrl`, `tenantName`, `formSettings`) into the buffer builder and its three call sites.

**Tech Stack:** `puppeteer-core` (already installed), existing `generatePDF` helper in `document-export.service.ts`, `pdf-lib` import can be removed from `form-builder.service.ts` once complete, `getAppBaseUrl` from `@/lib/email`.

**Design doc:** `docs/plans/2026-03-09-form-submission-pdf-redesign.md`

---

### Task 1: Export `generatePDF` and `findChromePath` from document-export.service.ts

Currently both functions are private. We need them accessible from `form-builder.service.ts`.

**Files:**
- Modify: `src/services/document-export.service.ts` — change `async function generatePDF` and `async function findChromePath` from private to exported

**Step 1: Make `findChromePath` exported**

In `src/services/document-export.service.ts`, find the line (around line 385):
```ts
async function findChromePath(): Promise<string> {
```
Change to:
```ts
export async function findChromePath(): Promise<string> {
```

**Step 2: Make `generatePDF` exported**

Find the line (around line 324):
```ts
async function generatePDF(
```
Change to:
```ts
export async function generatePDF(
```

**Step 3: Verify no TypeScript errors**

```bash
npx tsc --noEmit
```
Expected: no new errors related to these functions.

**Step 4: Commit**

```bash
git add src/services/document-export.service.ts
git commit -m "feat: export generatePDF and findChromePath from document-export service"
```

---

### Task 2: Add branding fields to `buildSubmissionPdfBuffer` input type

**Files:**
- Modify: `src/services/form-builder.service.ts` — extend the input type, read settings

**Step 1: Locate the `buildSubmissionPdfBuffer` function signature** (around line 394)

The current input type is:
```ts
async function buildSubmissionPdfBuffer(input: {
  formTitle: string;
  submittedAt: Date;
  respondentName: string | null;
  respondentEmail: string | null;
  status: FormSubmissionStatus;
  fields: FormField[];
  answers: Record<string, unknown>;
  uploads: FormUpload[];
}): Promise<Buffer> {
```

**Step 2: Extend the input type with branding fields**

Replace with:
```ts
async function buildSubmissionPdfBuffer(input: {
  formTitle: string;
  formDescription?: string | null;
  submittedAt: Date;
  respondentName: string | null;
  respondentEmail: string | null;
  status: FormSubmissionStatus;
  fields: FormField[];
  answers: Record<string, unknown>;
  uploads: FormUpload[];
  tenantLogoUrl?: string | null;
  tenantName?: string | null;
  formSettings?: unknown;
}): Promise<Buffer> {
```

**Step 3: Verify TypeScript**

```bash
npx tsc --noEmit
```
Expected: no errors (new fields are optional, callers don't need updating yet).

**Step 4: Commit**

```bash
git add src/services/form-builder.service.ts
git commit -m "feat: extend buildSubmissionPdfBuffer input with branding fields"
```

---

### Task 3: Add `buildSubmissionPdfHtml` — the HTML template function

This is the core task. Add a new function `buildSubmissionPdfHtml` in `form-builder.service.ts` that builds the full HTML string for the PDF.

**Files:**
- Modify: `src/services/form-builder.service.ts` — insert new function before `buildSubmissionPdfBuffer`

**Step 1: Understand what field types need special treatment**

From the existing `formatResponseFieldValue` function:
- `PARAGRAPH` / `HTML` — display-only info blocks, **skip** in PDF (not user-submitted data)
- `SIGNATURE` — value is a base64 data URL string; render as `<img>`
- `FILE_UPLOAD` — render filenames as text (no download links)
- `SINGLE_CHOICE` / `MULTIPLE_CHOICE` — use `formatChoiceAnswer(value)`
- `HIDDEN` — skip
- All others — render value as text

For repeat sections: same logic as `buildSubmissionPdfBuffer` — collect fields between `repeat_start` and `repeat_end` PAGE_BREAK markers, render each row as a card.

**Step 2: Add the import for `getAppBaseUrl`**

`getAppBaseUrl` is already imported at line 30:
```ts
import { getAppBaseUrl, sendEmail, type EmailAttachment } from '@/lib/email';
```
No change needed.

**Step 3: Insert `buildSubmissionPdfHtml` before `buildSubmissionPdfBuffer` (around line 394)**

Add this complete function:

```ts
function buildSubmissionPdfHtml(input: {
  formTitle: string;
  formDescription?: string | null;
  submittedAt: Date;
  respondentName: string | null;
  respondentEmail: string | null;
  status: FormSubmissionStatus;
  fields: FormField[];
  answers: Record<string, unknown>;
  uploads: FormUpload[];
  tenantLogoUrl?: string | null;
  tenantName?: string | null;
  formSettings?: unknown;
}): string {
  const settings = parseObject(input.formSettings);
  const hideLogo = settings?.hideLogo === true;
  const hideFooter = settings?.hideFooter === true;

  const uploadsById = new Map(input.uploads.map((u) => [u.id, u]));

  const appBase = getAppBaseUrl();
  const logoUrl = !hideLogo && input.tenantLogoUrl
    ? (input.tenantLogoUrl.startsWith('http') ? input.tenantLogoUrl : `${appBase}${input.tenantLogoUrl}`)
    : null;
  const footerText = !hideFooter && input.tenantName ? `© ${input.tenantName}` : null;

  const submittedAt = new Date(input.submittedAt).toLocaleString('en-SG', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  // ── helpers ──────────────────────────────────────────────────────────────

  function esc(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderFieldValue(field: FormField, value: unknown): string {
    // Signature: render as image
    if (field.type === 'SIGNATURE') {
      if (typeof value === 'string' && value.trim().length > 0) {
        return `<img src="${esc(value)}" alt="Signature" style="max-height:80px;max-width:240px;object-fit:contain;display:block;" />`;
      }
      return `<span class="empty">—</span>`;
    }

    // File upload: list filenames
    if (field.type === 'FILE_UPLOAD') {
      const ids = toUploadIds(value);
      if (ids.length === 0) return `<span class="empty">—</span>`;
      const names = ids.map((id) => esc(uploadsById.get(id)?.fileName || id));
      return names.map((n) => `<div class="file-name">${n}</div>`).join('');
    }

    // Choices
    if (field.type === 'SINGLE_CHOICE' || field.type === 'MULTIPLE_CHOICE' || field.type === 'DROPDOWN') {
      const text = formatChoiceAnswer(value);
      return text ? esc(text) : `<span class="empty">—</span>`;
    }

    if (value === null || value === undefined || value === '') {
      return `<span class="empty">—</span>`;
    }

    if (Array.isArray(value)) {
      const text = value.map((item) => String(item)).join(', ').trim();
      return text ? esc(text) : `<span class="empty">—</span>`;
    }

    const text = String(value).trim();
    return text ? `<span style="white-space:pre-wrap">${esc(text)}</span>` : `<span class="empty">—</span>`;
  }

  function renderField(field: FormField, value: unknown, keyPrefix: string): string {
    // Skip display-only fields
    if (field.type === 'PARAGRAPH' || field.type === 'HTML' || field.type === 'HIDDEN') return '';

    const label = esc(field.label?.trim() || field.key);
    const valueHtml = renderFieldValue(field, value);

    return `
      <div class="field" data-key="${esc(keyPrefix)}">
        <div class="field-label">${label}</div>
        <div class="field-value">${valueHtml}</div>
      </div>`;
  }

  // ── build field items (flat, no page splits) ──────────────────────────────

  type PdfItem =
    | { kind: 'field'; field: FormField }
    | { kind: 'repeat'; title: string; hint: string | null; fields: FormField[]; rowCount: number };

  const items: PdfItem[] = [];

  for (let i = 0; i < input.fields.length; i++) {
    const field = input.fields[i];

    if (field.type === 'PAGE_BREAK') {
      if (field.inputType === 'repeat_start') {
        const sectionFields: FormField[] = [];
        let cursor = i + 1;
        while (cursor < input.fields.length) {
          const candidate = input.fields[cursor];
          if (candidate.type === 'PAGE_BREAK' && candidate.inputType === 'repeat_end') break;
          if (candidate.type === 'PAGE_BREAK') { cursor -= 1; break; }
          if (candidate.type !== 'HIDDEN') sectionFields.push(candidate);
          cursor++;
        }
        const validation = parseObject(field.validation);
        const minItemsRaw = typeof validation?.repeatMinItems === 'number' ? Math.trunc(validation.repeatMinItems) : 1;
        const minItems = Math.max(1, Math.min(50, minItemsRaw));

        let rowCount = 0;
        for (const sf of sectionFields) {
          const v = input.answers[sf.key];
          if (Array.isArray(v)) rowCount = Math.max(rowCount, v.length);
          else if (!isEmptyValue(v)) rowCount = Math.max(rowCount, 1);
        }
        rowCount = Math.max(minItems, rowCount);

        const hasData = sectionFields.some((sf) => {
          const v = input.answers[sf.key];
          return Array.isArray(v) ? v.some((item) => !isEmptyValue(item)) : !isEmptyValue(v);
        });
        const show = evaluateCondition(field.condition, input.answers) || hasData;

        if (show && sectionFields.length > 0 && rowCount > 0) {
          items.push({
            kind: 'repeat',
            title: field.label?.trim() || 'Section',
            hint: field.subtext?.trim() || null,
            fields: sectionFields,
            rowCount,
          });
        }
        i = cursor;
        continue;
      }
      if (field.inputType === 'repeat_end') continue;
      // Regular page break — skip (we render flat)
      continue;
    }

    if (field.type === 'HIDDEN') continue;
    if (!evaluateCondition(field.condition, input.answers)) continue;

    items.push({ kind: 'field', field });
  }

  // ── render items to HTML ──────────────────────────────────────────────────

  const fieldsHtml = items.map((item) => {
    if (item.kind === 'field') {
      return renderField(item.field, input.answers[item.field.key], item.field.id);
    }

    // Repeat section
    const rowsHtml = Array.from({ length: item.rowCount }, (_, rowIndex) => {
      const rowAnswers: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(input.answers)) {
        rowAnswers[k] = Array.isArray(v) ? v[rowIndex] : (rowIndex === 0 ? v : undefined);
      }
      const rowFields = item.fields.filter(
        (f) => f.type !== 'HIDDEN' && evaluateCondition(f.condition, rowAnswers)
      );
      if (rowFields.length === 0) return '';

      const subFields = rowFields.map((f) =>
        renderField(f, rowAnswers[f.key], `${f.id}-${rowIndex}`)
      ).join('');

      return `
        <div class="repeat-card">
          <div class="repeat-card-label">Entry ${rowIndex + 1}</div>
          <div class="repeat-card-fields">${subFields}</div>
        </div>`;
    }).join('');

    return `
      <div class="repeat-section">
        <div class="repeat-title">${esc(item.title)}</div>
        ${item.hint ? `<div class="repeat-hint">${esc(item.hint)}</div>` : ''}
        ${rowsHtml}
      </div>`;
  }).join('');

  // ── compose full HTML ─────────────────────────────────────────────────────

  const footerHtml = footerText
    ? `<div style="font-size:9px;color:#9ca3af;text-align:center;width:100%;padding:0 40px;">${esc(footerText)}</div>`
    : '<div></div>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', sans-serif;
    font-size: 13px;
    line-height: 1.5;
    color: #111827;
    background: #fff;
    padding: 48px 52px 32px;
  }

  /* Header */
  .header { margin-bottom: 24px; }
  .header-top { display: flex; align-items: center; gap: 16px; margin-bottom: 6px; }
  .logo { max-height: 48px; max-width: 160px; object-fit: contain; }
  .form-title { font-size: 22px; font-weight: 700; color: #111827; }
  .form-description { font-size: 13px; color: #6b7280; margin-top: 4px; }
  .accent-bar { height: 3px; width: 40px; background: #4f46e5; border-radius: 9999px; margin-top: 12px; }

  /* Metadata */
  .meta {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px 24px;
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    padding: 12px 16px;
    margin-bottom: 28px;
    font-size: 12px;
  }
  .meta-item {}
  .meta-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: #9ca3af; font-weight: 600; margin-bottom: 2px; }
  .meta-value { color: #374151; font-weight: 500; }

  /* Fields */
  .field {
    margin-bottom: 16px;
    page-break-inside: avoid;
  }
  .field-label {
    font-size: 11px;
    font-weight: 600;
    color: #6b7280;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 4px;
  }
  .field-value {
    font-size: 13px;
    color: #111827;
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    padding: 8px 12px;
    min-height: 36px;
  }
  .empty { color: #d1d5db; }
  .file-name { color: #374151; }

  /* Repeat sections */
  .repeat-section {
    margin-bottom: 20px;
    page-break-inside: avoid;
  }
  .repeat-title {
    font-size: 13px;
    font-weight: 700;
    color: #111827;
    margin-bottom: 4px;
    padding-bottom: 6px;
    border-bottom: 2px solid #e5e7eb;
  }
  .repeat-hint { font-size: 12px; color: #9ca3af; margin-bottom: 10px; }
  .repeat-card {
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    padding: 12px;
    margin-bottom: 10px;
    background: #fff;
    page-break-inside: avoid;
  }
  .repeat-card-label {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #9ca3af;
    margin-bottom: 10px;
  }
  .repeat-card-fields .field { margin-bottom: 10px; }
  .repeat-card-fields .field:last-child { margin-bottom: 0; }
</style>
</head>
<body>

  <div class="header">
    <div class="header-top">
      ${logoUrl ? `<img class="logo" src="${esc(logoUrl)}" alt="Logo" />` : ''}
      <h1 class="form-title">${esc(input.formTitle || 'Form Response')}</h1>
    </div>
    ${input.formDescription ? `<p class="form-description">${esc(input.formDescription)}</p>` : ''}
    <div class="accent-bar"></div>
  </div>

  <div class="meta">
    <div class="meta-item">
      <div class="meta-label">Submitted</div>
      <div class="meta-value">${esc(submittedAt)}</div>
    </div>
    <div class="meta-item">
      <div class="meta-label">Status</div>
      <div class="meta-value">${esc(String(input.status))}</div>
    </div>
    <div class="meta-item">
      <div class="meta-label">Respondent</div>
      <div class="meta-value">${esc(input.respondentName || '—')}</div>
    </div>
    <div class="meta-item">
      <div class="meta-label">Email</div>
      <div class="meta-value">${esc(input.respondentEmail || '—')}</div>
    </div>
  </div>

  ${fieldsHtml}

</body>
</html>`;

  // Return footer HTML separately (used by Puppeteer displayHeaderFooter)
  // We return a tuple but callers use index 0 for content, 1 for footer
  // Actually we return the content HTML only; footer is handled via Puppeteer template.
  // Reassign: return as object with both pieces.
  // NOTE: The function returns a plain string; footer is passed separately by the caller.
  // The footerHtml variable is captured in closure — see buildSubmissionPdfBuffer below.
  void footerHtml; // suppress lint; caller reads it via buildSubmissionPdfHtmlResult
  return ''; // placeholder — see Step 4
}
```

Wait — the simplest approach is to return both pieces together. **Revise the function to return `{ contentHtml, footerHtml }`** instead of a plain string.

**Step 4: Correct design — return `{ contentHtml, footerHtml }`**

Replace the entire function body's return at the end with:

```ts
  return { contentHtml: /* the big HTML string */, footerHtml };
```

And change the function signature return type to:
```ts
function buildSubmissionPdfHtml(input: { ... }): { contentHtml: string; footerHtml: string }
```

The complete, correct function to insert (replacing any placeholder above):

```ts
function buildSubmissionPdfHtml(input: {
  formTitle: string;
  formDescription?: string | null;
  submittedAt: Date;
  respondentName: string | null;
  respondentEmail: string | null;
  status: FormSubmissionStatus;
  fields: FormField[];
  answers: Record<string, unknown>;
  uploads: FormUpload[];
  tenantLogoUrl?: string | null;
  tenantName?: string | null;
  formSettings?: unknown;
}): { contentHtml: string; footerHtml: string } {
  const settings = parseObject(input.formSettings);
  const hideLogo = settings?.hideLogo === true;
  const hideFooter = settings?.hideFooter === true;

  const uploadsById = new Map(input.uploads.map((u) => [u.id, u]));

  const appBase = getAppBaseUrl();
  const logoUrl = !hideLogo && input.tenantLogoUrl
    ? (input.tenantLogoUrl.startsWith('http') ? input.tenantLogoUrl : `${appBase}${input.tenantLogoUrl}`)
    : null;
  const footerText = !hideFooter && input.tenantName ? `\u00a9 ${input.tenantName}` : null;

  const submittedAt = new Date(input.submittedAt).toLocaleString('en-SG', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  function esc(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderFieldValue(field: FormField, value: unknown): string {
    if (field.type === 'SIGNATURE') {
      if (typeof value === 'string' && value.trim().length > 0) {
        return `<img src="${esc(value)}" alt="Signature" style="max-height:80px;max-width:240px;object-fit:contain;display:block;" />`;
      }
      return `<span class="empty">\u2014</span>`;
    }
    if (field.type === 'FILE_UPLOAD') {
      const ids = toUploadIds(value);
      if (ids.length === 0) return `<span class="empty">\u2014</span>`;
      return ids.map((id) => `<div class="file-name">${esc(uploadsById.get(id)?.fileName || id)}</div>`).join('');
    }
    if (field.type === 'SINGLE_CHOICE' || field.type === 'MULTIPLE_CHOICE' || field.type === 'DROPDOWN') {
      const text = formatChoiceAnswer(value);
      return text ? esc(text) : `<span class="empty">\u2014</span>`;
    }
    if (value === null || value === undefined || value === '') {
      return `<span class="empty">\u2014</span>`;
    }
    if (Array.isArray(value)) {
      const text = value.map((item) => String(item)).join(', ').trim();
      return text ? esc(text) : `<span class="empty">\u2014</span>`;
    }
    const text = String(value).trim();
    return text ? `<span style="white-space:pre-wrap">${esc(text)}</span>` : `<span class="empty">\u2014</span>`;
  }

  function renderField(field: FormField, value: unknown): string {
    if (field.type === 'PARAGRAPH' || field.type === 'HTML' || field.type === 'HIDDEN') return '';
    const label = esc(field.label?.trim() || field.key);
    return `
      <div class="field">
        <div class="field-label">${label}</div>
        <div class="field-value">${renderFieldValue(field, value)}</div>
      </div>`;
  }

  type PdfItem =
    | { kind: 'field'; field: FormField }
    | { kind: 'repeat'; title: string; hint: string | null; fields: FormField[]; rowCount: number };

  const items: PdfItem[] = [];

  for (let i = 0; i < input.fields.length; i++) {
    const field = input.fields[i];

    if (field.type === 'PAGE_BREAK') {
      if (field.inputType === 'repeat_start') {
        const sectionFields: FormField[] = [];
        let cursor = i + 1;
        while (cursor < input.fields.length) {
          const candidate = input.fields[cursor];
          if (candidate.type === 'PAGE_BREAK' && candidate.inputType === 'repeat_end') break;
          if (candidate.type === 'PAGE_BREAK') { cursor -= 1; break; }
          if (candidate.type !== 'HIDDEN') sectionFields.push(candidate);
          cursor++;
        }
        const validation = parseObject(field.validation);
        const minItemsRaw = typeof validation?.repeatMinItems === 'number' ? Math.trunc(validation.repeatMinItems) : 1;
        const minItems = Math.max(1, Math.min(50, minItemsRaw));
        let rowCount = 0;
        for (const sf of sectionFields) {
          const v = input.answers[sf.key];
          if (Array.isArray(v)) rowCount = Math.max(rowCount, v.length);
          else if (!isEmptyValue(v)) rowCount = Math.max(rowCount, 1);
        }
        rowCount = Math.max(minItems, rowCount);
        const hasData = sectionFields.some((sf) => {
          const v = input.answers[sf.key];
          return Array.isArray(v) ? v.some((item) => !isEmptyValue(item)) : !isEmptyValue(v);
        });
        if ((evaluateCondition(field.condition, input.answers) || hasData) && sectionFields.length > 0 && rowCount > 0) {
          items.push({ kind: 'repeat', title: field.label?.trim() || 'Section', hint: field.subtext?.trim() || null, fields: sectionFields, rowCount });
        }
        i = cursor;
        continue;
      }
      continue; // repeat_end and regular page breaks — skip
    }

    if (field.type === 'HIDDEN') continue;
    if (!evaluateCondition(field.condition, input.answers)) continue;
    items.push({ kind: 'field', field });
  }

  const fieldsHtml = items.map((item) => {
    if (item.kind === 'field') {
      return renderField(item.field, input.answers[item.field.key]);
    }
    const rowsHtml = Array.from({ length: item.rowCount }, (_, rowIndex) => {
      const rowAnswers: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(input.answers)) {
        rowAnswers[k] = Array.isArray(v) ? v[rowIndex] : (rowIndex === 0 ? v : undefined);
      }
      const rowFields = item.fields.filter(
        (f) => f.type !== 'HIDDEN' && evaluateCondition(f.condition, rowAnswers)
      );
      if (rowFields.length === 0) return '';
      return `
        <div class="repeat-card">
          <div class="repeat-card-label">Entry ${rowIndex + 1}</div>
          <div class="repeat-card-fields">${rowFields.map((f) => renderField(f, rowAnswers[f.key])).join('')}</div>
        </div>`;
    }).join('');

    return `
      <div class="repeat-section">
        <div class="repeat-title">${esc(item.title)}</div>
        ${item.hint ? `<div class="repeat-hint">${esc(item.hint)}</div>` : ''}
        ${rowsHtml}
      </div>`;
  }).join('');

  const contentHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', sans-serif;
    font-size: 13px; line-height: 1.5; color: #111827; background: #fff;
    padding: 48px 52px 32px;
  }
  .header { margin-bottom: 24px; }
  .header-top { display: flex; align-items: center; gap: 16px; margin-bottom: 6px; }
  .logo { max-height: 48px; max-width: 160px; object-fit: contain; }
  .form-title { font-size: 22px; font-weight: 700; color: #111827; }
  .form-description { font-size: 13px; color: #6b7280; margin-top: 4px; }
  .accent-bar { height: 3px; width: 40px; background: #4f46e5; border-radius: 9999px; margin-top: 12px; }
  .meta {
    display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px;
    background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px;
    padding: 12px 16px; margin-bottom: 28px; font-size: 12px;
  }
  .meta-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: #9ca3af; font-weight: 600; margin-bottom: 2px; }
  .meta-value { color: #374151; font-weight: 500; }
  .field { margin-bottom: 16px; page-break-inside: avoid; }
  .field-label { font-size: 11px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
  .field-value { font-size: 13px; color: #111827; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px 12px; min-height: 36px; }
  .empty { color: #d1d5db; }
  .file-name { color: #374151; }
  .repeat-section { margin-bottom: 20px; page-break-inside: avoid; }
  .repeat-title { font-size: 13px; font-weight: 700; color: #111827; margin-bottom: 4px; padding-bottom: 6px; border-bottom: 2px solid #e5e7eb; }
  .repeat-hint { font-size: 12px; color: #9ca3af; margin-bottom: 10px; }
  .repeat-card { border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px; margin-bottom: 10px; background: #fff; page-break-inside: avoid; }
  .repeat-card-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #9ca3af; margin-bottom: 10px; }
  .repeat-card-fields .field { margin-bottom: 10px; }
  .repeat-card-fields .field:last-child { margin-bottom: 0; }
</style>
</head>
<body>
  <div class="header">
    <div class="header-top">
      ${logoUrl ? `<img class="logo" src="${esc(logoUrl)}" alt="Logo" />` : ''}
      <h1 class="form-title">${esc(input.formTitle || 'Form Response')}</h1>
    </div>
    ${input.formDescription ? `<p class="form-description">${esc(input.formDescription)}</p>` : ''}
    <div class="accent-bar"></div>
  </div>
  <div class="meta">
    <div class="meta-item"><div class="meta-label">Submitted</div><div class="meta-value">${esc(submittedAt)}</div></div>
    <div class="meta-item"><div class="meta-label">Status</div><div class="meta-value">${esc(String(input.status))}</div></div>
    <div class="meta-item"><div class="meta-label">Respondent</div><div class="meta-value">${esc(input.respondentName || '\u2014')}</div></div>
    <div class="meta-item"><div class="meta-label">Email</div><div class="meta-value">${esc(input.respondentEmail || '\u2014')}</div></div>
  </div>
  ${fieldsHtml}
</body>
</html>`;

  const footerHtml = footerText
    ? `<div style="font-size:9px;color:#9ca3af;text-align:center;width:100%;padding:0 40px;font-family:sans-serif;">${esc(footerText)}</div>`
    : '<div></div>';

  return { contentHtml, footerHtml };
}
```

**Step 5: Verify TypeScript**

```bash
npx tsc --noEmit
```
Expected: no errors.

**Step 6: Commit**

```bash
git add src/services/form-builder.service.ts
git commit -m "feat: add buildSubmissionPdfHtml for polished PDF report"
```

---

### Task 4: Replace `buildSubmissionPdfBuffer` internals with Puppeteer

**Files:**
- Modify: `src/services/form-builder.service.ts`

**Step 1: Add import of the exported `generatePDF` and `findChromePath`**

At the top of `form-builder.service.ts`, add:
```ts
import { generatePDF, findChromePath } from '@/services/document-export.service';
```

**Step 2: Replace the entire body of `buildSubmissionPdfBuffer`**

The current body (lines ~404–591) uses `pdf-lib` drawing. Replace the body with:

```ts
async function buildSubmissionPdfBuffer(input: {
  formTitle: string;
  formDescription?: string | null;
  submittedAt: Date;
  respondentName: string | null;
  respondentEmail: string | null;
  status: FormSubmissionStatus;
  fields: FormField[];
  answers: Record<string, unknown>;
  uploads: FormUpload[];
  tenantLogoUrl?: string | null;
  tenantName?: string | null;
  formSettings?: unknown;
}): Promise<Buffer> {
  const { contentHtml, footerHtml } = buildSubmissionPdfHtml(input);
  return generatePDF(contentHtml, {
    format: 'A4',
    orientation: 'portrait',
    margins: { top: 0, right: 0, bottom: footerHtml !== '<div></div>' ? 28 : 0, left: 0 },
    headerHtml: '<div></div>',
    footerHtml,
  });
}
```

**Step 3: Remove unused pdf-lib imports**

The top of the file has:
```ts
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
```

Remove this line. Also remove the constants that are now dead code:
- `PDF_PAGE_WIDTH`, `PDF_PAGE_HEIGHT`, `PDF_MARGIN_X`, `PDF_MARGIN_Y` (around lines 129–132)
- `safePdfText`, `stripHtmlForPdf`, `wrapPdfText` functions (around lines 252–329) — but only if they're not used anywhere else

**Step 4: Check for other uses of those now-dead utilities**

```bash
grep -n "safePdfText\|stripHtmlForPdf\|wrapPdfText\|PDF_PAGE_WIDTH\|PDF_PAGE_HEIGHT\|PDF_MARGIN_X\|PDF_MARGIN_Y\|PDFDocument\|StandardFonts\|pdf-lib" src/services/form-builder.service.ts
```

Remove any that are only referenced inside the old pdf-lib code. Keep any still used elsewhere.

**Step 5: Check `formatResponseFieldValue` usage**

```bash
grep -n "formatResponseFieldValue" src/services/form-builder.service.ts
```

This function was used only by the old pdf-lib rendering. If it's now unused, remove it too.

**Step 6: Verify TypeScript**

```bash
npx tsc --noEmit
```
Expected: no errors.

**Step 7: Commit**

```bash
git add src/services/form-builder.service.ts
git commit -m "feat: switch submission PDF rendering to Puppeteer HTML"
```

---

### Task 5: Thread branding data into all 3 call sites

**Files:**
- Modify: `src/services/form-builder.service.ts` — 3 call sites

**Site 1: `exportFormResponsePdf` (~line 1663)**

**Step 1: Add tenant join to the form query**

Find:
```ts
  const form = await prisma.form.findFirst({
    where: { id: formId, tenantId, deletedAt: null },
    include: {
      fields: {
        orderBy: { position: 'asc' },
      },
    },
  });
```

Replace with:
```ts
  const form = await prisma.form.findFirst({
    where: { id: formId, tenantId, deletedAt: null },
    include: {
      fields: {
        orderBy: { position: 'asc' },
      },
      tenant: {
        select: { logoUrl: true, name: true },
      },
    },
  });
```

**Step 2: Pass branding fields to `buildSubmissionPdfBuffer`**

Find the call:
```ts
  const buffer = await buildSubmissionPdfBuffer({
    formTitle: form.title,
    submittedAt: submission.submittedAt,
    respondentName: submission.respondentName,
    respondentEmail: submission.respondentEmail,
    status: submission.status,
    fields: form.fields,
    answers,
    uploads,
  });
```

Replace with:
```ts
  const buffer = await buildSubmissionPdfBuffer({
    formTitle: form.title,
    submittedAt: submission.submittedAt,
    respondentName: submission.respondentName,
    respondentEmail: submission.respondentEmail,
    status: submission.status,
    fields: form.fields,
    answers,
    uploads,
    tenantLogoUrl: form.tenant?.logoUrl ?? null,
    tenantName: form.tenant?.name ?? null,
    formSettings: form.settings,
  });
```

**Site 2: `exportPublicFormResponsePdf` (~line 3013)**

**Step 3: Add tenant join to `getPublishedFormSubmissionContext`**

Find `getPublishedFormSubmissionContext` (~line 2972). Its form query:
```ts
    include: {
      fields: {
        orderBy: { position: 'asc' },
      },
    },
```
Replace with:
```ts
    include: {
      fields: {
        orderBy: { position: 'asc' },
      },
      tenant: {
        select: { logoUrl: true, name: true },
      },
    },
```

Also update the function's return type signature to include the tenant:
```ts
async function getPublishedFormSubmissionContext(slug: string, submissionId: string): Promise<{
  form: Form & { fields: FormField[]; tenant: { logoUrl: string | null; name: string } | null };
  submission: FormSubmission;
  uploads: FormUpload[];
}>
```

**Step 4: Pass branding fields in `exportPublicFormResponsePdf`**

Find the call to `buildSubmissionPdfBuffer` in this function and add:
```ts
    tenantLogoUrl: form.tenant?.logoUrl ?? null,
    tenantName: form.tenant?.name ?? null,
    formSettings: form.settings,
```

**Site 3: `sendCompletionNotificationEmail` (~line 992)**

**Step 5: Add tenant select to the function's form parameter or query**

The function receives `form: Form & { fields: FormField[] }`. The form's tenant data isn't currently included. Two options:
- Option A: Change the caller to also pass `tenant` — but the caller is inside the submission flow, which already has the form object without tenant. Simpler:
- Option B: Do a quick tenant lookup inside `sendCompletionNotificationEmail`.

Use Option B — add a tenant fetch inside the function:

After the `const answers = toAnswerRecord(...)` line, add:
```ts
    const tenant = await prisma.tenant.findUnique({
      where: { id: input.form.tenantId },
      select: { logoUrl: true, name: true },
    });
```

Then add to the `buildSubmissionPdfBuffer` call:
```ts
      tenantLogoUrl: tenant?.logoUrl ?? null,
      tenantName: tenant?.name ?? null,
      formSettings: input.form.settings,
```

**Step 6: Verify TypeScript**

```bash
npx tsc --noEmit
```
Expected: no errors.

**Step 7: Commit**

```bash
git add src/services/form-builder.service.ts
git commit -m "feat: pass branding data to PDF builder in all call sites"
```

---

### Task 6: Manual smoke test

**Step 1: Start the dev server**

```bash
npm run dev
```

**Step 2: Navigate to a form submission**

Go to `/forms/[id]/responses/[submissionId]` in the browser.

**Step 3: Click "Export PDF"**

The button triggers `GET /api/forms/[id]/responses/[submissionId]/export/pdf`.

**Step 4: Verify the downloaded PDF**

- [ ] Has logo (if tenant has one and `hideLogo` is false)
- [ ] Has form title as large heading
- [ ] Has metadata grid (Submitted, Status, Respondent, Email)
- [ ] All fields render with label above value in gray card
- [ ] Signature renders as an image
- [ ] File upload fields show filename text
- [ ] Repeat sections render with "Entry N" cards
- [ ] Footer shows `© TenantName` (if `hideFooter` is false)
- [ ] No fields are cut off mid-page

**Step 5: Test the public download flow**

Submit a public form, download the PDF from the success screen. Verify same quality.

**Step 6: Test with `hideLogo: true` and `hideFooter: true`**

In the form builder settings, enable both toggles and re-export. Verify no logo or footer appears.

---

### Task 7: Update docs

**Step 1: Note the change in the debug doc if relevant**

```bash
# Check if AI_DEBUG.md needs updating
cat docs/debug/AI_DEBUG.md | head -30
```

No doc update is required unless the debug doc tracks PDF-related known issues.

**Step 2: Final commit if any doc changes**

```bash
git add docs/
git commit -m "docs: update after PDF redesign"
```
