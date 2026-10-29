# Forms Implementation Review

> **Date**: 2026-03-10
> **Status**: In Progress
> **Scope**: Comprehensive review of the forms module — security, performance, data integrity, logic, UX, and code quality

---

## Priority Legend

| Priority | Description |
|----------|-------------|
| **P0** | Critical / Blocking — must fix immediately |
| **P1** | High priority — should address soon |
| **P2** | Medium priority — standard backlog |
| **P3** | Low priority / nice to have |

## Status Legend

| Status | Description |
|--------|-------------|
| Open | Not started |
| In Progress | Currently being worked on |
| Done | Completed |
| Deferred | Acknowledged, will address later |

---

## 1. Security

### FORM-SEC-001 — Code Injection via `evaluateNumberFormula`

| Field | Value |
|-------|-------|
| **Priority** | P0 |
| **Status** | Open |
| **File** | `src/services/form-builder.service.ts:3028` |
| **Risk** | Remote code execution |

**Problem:**
`evaluateNumberFormula` uses `Function()` constructor (essentially `eval`) to compute number validation formulas at submission time:

```ts
const result = Function(`"use strict"; return (${referenced});`)();
```

While a regex check (`/[^0-9+\-*/().\s]/`) filters the resolved expression, this is fragile. If the regex regresses or an edge case is missed, it becomes full server-side code execution. The regex runs *after* field-key references `[fieldKey]` are resolved to numeric values, but a crafted formula string that passes the Zod pattern could exploit edge cases.

**Recommendation — Replace with safe math parser:**

Option A (preferred): Use a simple recursive-descent parser for basic arithmetic (`+`, `-`, `*`, `/`, parentheses). This is ~50 lines of code and handles the exact use case without any eval.

Option B: Use a library like `math.js` with sandboxed evaluation (`math.evaluate(expr, scope)`).

**Approach:**
1. Create `src/lib/safe-math.ts` with a `evaluateArithmeticExpression(expr: string): number | null` function
2. Support only: numbers, `+`, `-`, `*`, `/`, `(`, `)`, whitespace
3. Replace the `Function()` call in `evaluateNumberFormula`
4. Add unit tests covering edge cases (division by zero, deeply nested parens, empty expressions)
5. Verify all existing number formula validation still works

---

### FORM-SEC-002 — Content-Disposition Header Injection

| Field | Value |
|-------|-------|
| **Priority** | P2 |
| **Status** | Open |
| **File** | `src/app/api/forms/[id]/responses/[submissionId]/uploads/[uploadId]/route.ts:37` |
| **Risk** | HTTP header manipulation |

**Problem:**
Filename sanitization only strips double quotes:
```ts
'Content-Disposition': `${disposition}; filename="${upload.fileName.replace(/"/g, '')}"`,
```
Filenames with newlines, semicolons, or non-ASCII characters could cause header injection or display issues.

**Recommendation — Use RFC 5987 encoding:**

**Approach:**
1. Create a shared `sanitizeContentDispositionFilename(name: string): string` helper
2. Strip control characters (`\x00-\x1f`), backslashes, and quotes
3. Add `filename*=UTF-8''...` header for non-ASCII names (percent-encoded)
4. Apply to all routes that serve file downloads (uploads, PDF exports, CSV export)

---

### FORM-SEC-003 — Signature Base64 Data Bloat

| Field | Value |
|-------|-------|
| **Priority** | P1 |
| **Status** | Open |
| **File** | `src/services/form-builder.service.ts:3300-3306` |
| **Risk** | Storage/memory abuse |

**Problem:**
Signature fields accept base64 data URIs up to 500KB per entry, with up to 100 array entries (repeat sections). A single signature field in a repeat section could store ~50MB in the JSON `answers` column.

**Recommendation — Cap signature size:**

**Approach:**
1. In `sanitizePublicAnswers`, reduce signature cap from `500_000` to `100_000` chars (~75KB decoded)
2. Consider storing signatures as `FormUpload` records instead of inline base64 (bigger refactor, can defer)
3. Add a total answers payload size check (e.g., 5MB max across all fields)

---

### FORM-SEC-004 — Unconstrained `settings` JSON Field

| Field | Value |
|-------|-------|
| **Priority** | P2 |
| **Status** | Open |
| **File** | `src/lib/validations/form-builder.ts:187` |
| **Risk** | Storage abuse via arbitrarily large JSON |

**Problem:**
```ts
settings: z.record(z.unknown()).optional().nullable(),
```
Any arbitrary JSON can be stored in form settings. While the service layer parses specific sub-keys, an attacker could store megabytes of junk in unrecognized keys.

**Recommendation — Add size guard:**

**Approach:**
1. Add a Zod `.refine()` that checks `JSON.stringify(settings).length <= 50_000`
2. Alternatively, define a stricter schema with known top-level keys only (notifications, drafts, aiParsing, fileNaming, i18n, responseTable, hideLogo, hideFooter)

---

## 2. Performance & Scalability

### FORM-PERF-001 — `getFormResponses` Loads ALL Submissions into Memory

| Field | Value |
|-------|-------|
| **Priority** | P0 |
| **Status** | Open |
| **File** | `src/services/form-builder.service.ts:1829-1900` |
| **Risk** | OOM errors, slow responses at scale |

**Problem:**
```ts
const [allSubmissions, ...] = await Promise.all([
  prisma.formSubmission.findMany({
    where: { formId, tenantId },
    include: { _count: { select: { uploads: true } } },
  }),
  ...
]);
// Then filters and sorts in JavaScript
```
Every call to the responses list page loads ALL submissions for that form into Node.js memory. For forms with thousands of responses, this will cause OOM and timeouts.

**Recommendation — Move filtering/sorting to database:**

**Approach (phased):**

**Phase 1 — Quick win (handle most cases):**
1. For the default sort (`__submitted` column, desc), use Prisma `orderBy: { submittedAt }` + `skip`/`take` directly
2. For status column sorting, add a computed/virtual sort field or sort by `submittedAt` as secondary
3. For text-based column filtering, use Prisma JSON path filtering where possible

**Phase 2 — Full solution:**
1. For sorting by answer field values, evaluate options:
   - a) Materialize commonly filtered fields into indexed columns (if patterns emerge)
   - b) Use raw SQL with `->>'fieldKey'` JSON extraction for PostgreSQL
   - c) Keep in-memory approach but add a scan limit (e.g., 5000 rows max) with a warning
2. Add a `totalUnfiltered` count alongside `total` so the UI can show "showing X of Y (filtered)"

**Phase 3 — Long term:**
1. Consider a dedicated `form_submission_search` table with denormalized/indexed answer columns for high-volume forms

---

### FORM-PERF-002 — `listFormsWithWarnings` In-Memory Scan

| Field | Value |
|-------|-------|
| **Priority** | P2 |
| **Status** | Open |
| **File** | `src/services/form-builder.service.ts:2785-2843` |
| **Risk** | Slow dashboard for tenants with many submissions |

**Problem:**
Loads up to 200 submissions and parses each one's AI review metadata in JavaScript to find unresolved warnings.

**Recommendation — Add DB-level flag:**

**Approach:**
1. Add a `hasUnresolvedAiWarning: Boolean` column to `FormSubmission` (default false)
2. Set it during AI review completion and clear it on resolve
3. Query directly: `where: { hasUnresolvedAiWarning: true }`
4. Alternatively, use PostgreSQL JSON path query: `metadata->'aiReview'->>'status' = 'completed'` + additional conditions

---

### FORM-PERF-003 — View Count Increment on Every Public Load

| Field | Value |
|-------|-------|
| **Priority** | P3 |
| **Status** | Open |
| **File** | `src/services/form-builder.service.ts:2866-2869` |
| **Risk** | Write contention under high traffic |

**Problem:**
Every public form view triggers a DB `UPDATE` to increment `viewsCount`.

**Recommendation:**
Defer to later. Acceptable for current scale. If traffic grows:
- Batch increments in memory, flush every N seconds
- Or use Redis `INCR` and sync periodically

---

## 3. Data Integrity

### FORM-DATA-001 — Missing `updatedAt` on `FormSubmission`

| Field | Value |
|-------|-------|
| **Priority** | P2 |
| **Status** | Open |
| **File** | `prisma/schema.prisma:1610-1628` |
| **Risk** | Cannot track when submission metadata was last modified |

**Problem:**
`FormSubmission` has `createdAt` and `submittedAt` but no `updatedAt`. AI review updates, warning resolutions, and metadata changes modify the row silently.

**Recommendation:**

**Approach:**
1. Add `updatedAt DateTime @updatedAt @map("updated_at")` to `FormSubmission` model
2. Create migration
3. No code changes needed — Prisma auto-manages `@updatedAt`

---

### FORM-DATA-002 — Missing Foreign Key on `FormUpload.fieldId`

| Field | Value |
|-------|-------|
| **Priority** | P3 |
| **Status** | Open |
| **File** | `prisma/schema.prisma:1658` |
| **Risk** | Stale field references after field deletion |

**Problem:**
`fieldId` exists on `FormUpload` but has no FK constraint to `FormField`. When fields are deleted (via the delete-all-recreate pattern in `saveFormFields`), upload `fieldId` references become stale.

**Recommendation:**
Defer for now. The application handles this gracefully (null checks on field lookups). Adding a FK would require changing the field save strategy to preserve field IDs, which is a larger refactor.

---

### FORM-DATA-003 — Hard Delete for Submissions vs Soft Delete for Forms

| Field | Value |
|-------|-------|
| **Priority** | P3 |
| **Status** | Open |
| **File** | `src/services/form-builder.service.ts:2453-2472` |
| **Risk** | Deleted submissions cannot be recovered |

**Problem:**
Forms use soft delete (`deletedAt`), but submissions use hard delete. Inconsistent and unrecoverable.

**Recommendation:**
Acceptable for now given development stage. Consider adding `deletedAt` to `FormSubmission` if recovery becomes a requirement.

---

### FORM-DATA-004 — `submissionsCount` Denormalization Drift Risk

| Field | Value |
|-------|-------|
| **Priority** | P2 |
| **Status** | Open |
| **File** | `src/services/form-builder.service.ts` |
| **Risk** | Counter drifts out of sync over time |

**Problem:**
`submissionsCount` on `Form` is incremented on submission creation and decremented on deletion. If either operation fails mid-transaction or the counter is already wrong, it drifts.

**Recommendation:**

**Approach:**
1. Add a periodic reconciliation task (e.g., weekly scheduler job) that recalculates counts:
   ```sql
   UPDATE forms SET submissions_count = (SELECT COUNT(*) FROM form_submissions WHERE form_id = forms.id)
   ```
2. Or replace with a query-time count (slower but always accurate) — only if performance is acceptable

---

## 4. Logic & Edge Cases

### FORM-LOGIC-001 — Draft Resumption Without Access Token

| Field | Value |
|-------|-------|
| **Priority** | P1 |
| **Status** | Open |
| **File** | `src/services/form-builder.service.ts:3804-3812` |
| **Risk** | Draft takeover — anyone with the 5-char code can steal the draft |

**Problem:**
`getPublicDraftByCode` allows loading a draft by code alone (without access token) and then generates+writes a new access token, locking out the original user.

The draft code is only 5 alphanumeric characters (~916M combinations). While rate limiting exists, this is weaker than it should be for access control.

**Recommendation — Always require access token:**

**Approach:**
1. In `getPublicDraftByCode`, make `accessToken` required (not optional)
2. Remove the code path that generates a new token when none is provided
3. If the use case for "resume by code only" is needed (e.g., email link), add a separate "request resume" flow that sends a new token via email
4. Update the public draft routes accordingly

---

### FORM-LOGIC-002 — `fieldValidationSchema.refine` Early Returns

| Field | Value |
|-------|-------|
| **Priority** | P3 |
| **Status** | Open |
| **File** | `src/lib/validations/form-builder.ts:79-107` |
| **Risk** | Invalid validation configs pass silently |

**Problem:**
The refinement checks `minLength`/`maxLength`, then `min`/`max`, then formulas, then dates, then repeat items — but uses early returns. If `minLength`/`maxLength` passes, `min`/`max` range isn't validated.

**Recommendation:**
Check all constraint pairs independently. Use `.superRefine()` with multiple `ctx.addIssue()` calls instead of a single `.refine()`.

---

### FORM-LOGIC-003 — Orphaned Uploads from Abandoned Submissions

| Field | Value |
|-------|-------|
| **Priority** | P2 |
| **Status** | Open |
| **File** | `src/app/api/forms/cleanup-uploads/route.ts` |
| **Risk** | Storage bloat from uploaded-but-never-submitted files |

**Problem:**
Public uploads are created before submission. If a user uploads files but never submits (and doesn't save a draft), those uploads remain with `submissionId: null` and `draftId: null`.

**Recommendation:**

**Approach:**
1. Verify the cleanup task runs on schedule and covers orphaned uploads (no draft, no submission, older than X hours)
2. Consider adding a `createdAt` TTL check — uploads older than 24h with no draft/submission association are deleted
3. Add monitoring/metrics for orphaned upload count

---

## 5. Database Schema

### FORM-DB-001 — Missing Index for AI Review Status Queries

| Field | Value |
|-------|-------|
| **Priority** | P1 |
| **Status** | Open |
| **File** | `prisma/schema.prisma:1610-1628` |
| **Risk** | Sequential scan on large tables for AI queue processing |

**Problem:**
The AI review queue processor queries:
```ts
prisma.formSubmission.findMany({
  where: {
    metadata: { path: ['aiReview', 'status'], equals: 'queued' },
    form: { deletedAt: null, settings: { path: ['aiParsing', 'enabled'], equals: true } },
  },
});
```
Without a GIN index on the `metadata` JSON column, this is a sequential scan.

**Recommendation:**

**Approach:**
1. Add a GIN index on `FormSubmission.metadata`:
   ```sql
   CREATE INDEX idx_form_submissions_metadata ON form_submissions USING GIN (metadata jsonb_path_ops);
   ```
2. Or (better) add a dedicated `aiReviewStatus` column (enum: null/queued/processing/completed/failed) with a partial index:
   ```sql
   CREATE INDEX idx_form_submissions_ai_queued ON form_submissions (id) WHERE ai_review_status = 'queued';
   ```
3. Option 2 is cleaner but requires migrating existing metadata status into the new column

---

### FORM-DB-002 — Missing Composite Index on `FormUpload(formId, submissionId)`

| Field | Value |
|-------|-------|
| **Priority** | P3 |
| **Status** | Open |
| **File** | `prisma/schema.prisma:1670-1674` |

**Problem:**
Multiple queries filter by `formId + submissionId`, but only single-column indexes exist.

**Recommendation:**
Add `@@index([formId, submissionId])` to `FormUpload` model. Low urgency — current indexes work, just less efficiently.

---

## 6. Frontend / UX

### FORM-UX-001 — Overly Broad Query Invalidation

| Field | Value |
|-------|-------|
| **Priority** | P2 |
| **Status** | Open |
| **File** | `src/hooks/use-forms.ts` |
| **Risk** | Unnecessary refetches across the entire dashboard |

**Problem:**
Nearly every mutation calls `invalidateQueries({ queryKey: formKeys.all })`, which refetches all form lists, details, responses, and warnings.

**Recommendation:**

**Approach:**
1. For `useUpdateForm`: invalidate `formKeys.detail(id)` + `formKeys.lists()` only
2. For `useDeleteFormResponse`: invalidate `formKeys.responses(id)` + `formKeys.detail(id)` only
3. For `useCreateForm` / `useDeleteForm`: invalidate `formKeys.lists()` only
4. Keep `formKeys.all` invalidation only for operations that truly affect everything

---

### FORM-UX-002 — Large Monolithic Components

| Field | Value |
|-------|-------|
| **Priority** | P3 |
| **Status** | Open |
| **Files** | `src/components/forms/field-editor-drawer.tsx` (~1245 lines), `src/app/(dashboard)/forms/[id]/builder/page.tsx` (~800 lines) |
| **Risk** | Maintainability, developer experience |

**Problem:**
`FieldEditorDrawer` and `FormBuilderPage` are very large components with many useState hooks and mixed concerns.

**Recommendation:**
Defer for now. When next modifying these files:
1. Extract `FieldGeneralTab`, `FieldValidationTab`, `FieldConditionTab` from the drawer
2. Extract drag-and-drop logic from builder into a custom hook
3. Extract settings sections into individual components

---

### FORM-UX-003 — No Debouncing on Save Operations

| Field | Value |
|-------|-------|
| **Priority** | P3 |
| **Status** | Open |
| **Files** | Various builder components |
| **Risk** | Rapid clicking triggers multiple API calls |

**Recommendation:**
Add `useMutation` with a debounced wrapper or disable the save button during mutation pending state (if not already done).

---

## 7. Code Quality

### FORM-CODE-001 — Duplicated Helper Functions

| Field | Value |
|-------|-------|
| **Priority** | P3 |
| **Status** | Open |
| **Files** | `src/services/form-builder.service.ts`, `src/services/form-ai.service.ts` |

**Problem:**
`toAnswerRecord()` and `toUploadIds()` are defined in both service files.

**Recommendation:**
Move to `src/lib/form-utils.ts` and import from there. Do this when next touching either file.

---

### FORM-CODE-002 — Service File Too Large (~3900 lines)

| Field | Value |
|-------|-------|
| **Priority** | P3 |
| **Status** | Open |
| **File** | `src/services/form-builder.service.ts` |

**Problem:**
Single file handles forms, fields, submissions, drafts, uploads, PDF generation, email notifications, AI review orchestration, and file naming.

**Recommendation:**
Split when next doing major work in this area:
- `form-crud.service.ts` — form + field CRUD
- `form-submission.service.ts` — public submission, validation, sanitization
- `form-draft.service.ts` — draft management
- `form-pdf.service.ts` — PDF generation, file naming, templates
- `form-notification.service.ts` — email notifications

---

### FORM-CODE-003 — `NUMBER_FORMULA_PATTERN` Overly Permissive

| Field | Value |
|-------|-------|
| **Priority** | P3 |
| **Status** | Open |
| **File** | `src/lib/validations/form-builder.ts:8` |

**Problem:**
```ts
const NUMBER_FORMULA_PATTERN = /^(?:(?:>=|<=|>|<|=)\s*)?[\d\s+\-*/().[\]_a-zA-Z]+$/;
```
Doesn't validate balanced brackets, structural validity, or prevent nonsensical formulas. Invalid formulas fail silently at runtime.

**Recommendation:**
Tighten the regex or add a structural validator. Will be partially addressed by FORM-SEC-001 (safe math parser can reject invalid expressions at save time too).

---

## Work Order

Suggested order for addressing these items:

### Sprint 1 — Critical Security & Performance
1. **FORM-SEC-001** — Replace `Function()` with safe math parser
2. **FORM-PERF-001 Phase 1** — DB-level pagination for default sort
3. **FORM-LOGIC-001** — Require access token for draft resume

### Sprint 2 — Data Integrity & Indexing
4. **FORM-DB-001** — Add GIN index or dedicated column for AI review status
5. **FORM-DATA-001** — Add `updatedAt` to FormSubmission
6. **FORM-SEC-003** — Cap signature base64 size
7. **FORM-DATA-004** — Add submissions count reconciliation

### Sprint 3 — Hardening
8. **FORM-SEC-002** — RFC 5987 Content-Disposition encoding
9. **FORM-SEC-004** — Constrain settings JSON size
10. **FORM-PERF-002** — DB flag for unresolved AI warnings
11. **FORM-UX-001** — Targeted query invalidation

### Backlog
12. **FORM-LOGIC-002** — Fix validation schema refine logic
13. **FORM-LOGIC-003** — Verify orphaned upload cleanup
14. **FORM-CODE-001** — Deduplicate helpers
15. **FORM-CODE-002** — Split service file
16. **FORM-UX-002** — Split large components
17. **FORM-UX-003** — Debounce save operations
18. **FORM-DATA-002** — Missing FK on fieldId
19. **FORM-DATA-003** — Soft delete for submissions
20. **FORM-DB-002** — Composite index on FormUpload
21. **FORM-PERF-003** — Batch view count increments
22. **FORM-CODE-003** — Tighten formula regex
