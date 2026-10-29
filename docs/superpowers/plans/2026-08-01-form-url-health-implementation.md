# Form URL Styling and Health Monitoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add plain styling for URL information blocks and daily backend-only warnings after two consecutive definite link failures.

**Architecture:** Store URL health independently from recreated form-field rows using `(tenantId, formId, fieldKey)`. A safe network helper pins validated public DNS addresses, follows validated redirects manually, and returns neutral classifications to a tenant-aware reconciliation service. The existing scheduler runs that service daily, while authenticated form APIs expose summaries and field detail.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Node `dns`/`http`/`https`, Prisma 7/PostgreSQL, TanStack Query, Vitest.

## Global Constraints

- Public links remain clickable and show no health warning.
- Backend warnings activate only after two consecutive definite daily failures.
- `401`, `403`, and `429` are unable to verify and do not increment failures.
- HTTP/HTTPS only; all resolved and redirected destinations must be public IP addresses.
- Allow at most five redirects, use a 10-second attempt timeout, and read at most 64 KB for GET fallback.
- Use GET fallback only after HEAD returns `405` or `501`.
- Process at most 500 URLs per scheduler run with concurrency five.
- Default scheduler cron is `0 2 * * *` and remains environment-overridable.
- Plain URL style removes the inner visual box in public HTML and PDF output.

---

## File Map

- `prisma/schema.prisma` and migration: stable URL health records.
- `src/lib/public-url-checker.ts`: DNS/IP validation and bounded HTTP checks.
- `src/services/form-url-health.service.ts`: classification transitions and reconciliation.
- `src/lib/scheduler/tasks/form-url-health.task.ts` plus scheduler indexes: daily execution.
- `src/app/api/forms/url-health/route.ts` and per-form route: authenticated warning data.
- `src/hooks/use-form-url-health.ts`: warning queries.
- Forms list and builder components: warning badges and details.
- Field editor, public form, and PDF service: URL plain style.
- Existing docs: scheduler configuration and warning semantics.

### Task 1: Add Stable URL Health Persistence

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260801_form_url_health/migration.sql`
- Test: `__tests__/services/form-url-health-schema.test.ts`

**Interfaces:**
- Produces: `FormUrlHealth` keyed by form and field key, with cascade deletion from Form.

- [ ] **Step 1: Write the failing schema test**

```ts
expect(source('prisma/schema.prisma')).toContain('model FormUrlHealth');
expect(source('prisma/schema.prisma')).toContain('@@unique([tenantId, formId, fieldKey])');
expect(source('prisma/schema.prisma')).toContain('consecutiveFailures Int');
expect(source('prisma/schema.prisma')).toContain('warningActivatedAt DateTime?');
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- --run __tests__/services/form-url-health-schema.test.ts`
Expected: FAIL because the model is absent.

- [ ] **Step 3: Add schema and migration**

```prisma
model FormUrlHealth {
  id                    String    @id @default(uuid())
  tenantId              String    @map("tenant_id")
  formId                String    @map("form_id")
  fieldKey              String    @map("field_key")
  checkedUrl            String    @map("checked_url")
  urlFingerprint        String    @map("url_fingerprint")
  classification        String
  lastHttpStatus        Int?      @map("last_http_status")
  lastErrorCode         String?   @map("last_error_code")
  lastErrorMessage      String?   @map("last_error_message")
  consecutiveFailures   Int       @default(0) @map("consecutive_failures")
  lastCheckedAt         DateTime  @map("last_checked_at")
  lastSucceededAt       DateTime? @map("last_succeeded_at")
  warningActivatedAt    DateTime? @map("warning_activated_at")
  createdAt             DateTime  @default(now()) @map("created_at")
  updatedAt             DateTime  @updatedAt @map("updated_at")
  tenant                Workspace @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  form                  Form      @relation(fields: [formId], references: [id], onDelete: Cascade)

  @@unique([tenantId, formId, fieldKey])
  @@index([tenantId, warningActivatedAt])
  @@index([lastCheckedAt])
  @@map("form_url_health")
}
```

- [ ] **Step 4: Generate and verify GREEN**

Run: `npm run db:generate && npm test -- --run __tests__/services/form-url-health-schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```text
git add prisma/schema.prisma prisma/migrations/20260801_form_url_health src/generated/prisma __tests__/services/form-url-health-schema.test.ts
git commit -m "feat(forms): add URL health persistence"
```

### Task 2: Implement a Safe Bounded URL Checker

**Files:**
- Create: `src/lib/public-url-checker.ts`
- Test: `__tests__/lib/public-url-checker.test.ts`

**Interfaces:**
- Produces: `checkPublicHttpUrl(url: string, deps?: UrlCheckerDependencies): Promise<RawUrlCheckResult>`.

- [ ] **Step 1: Write failing checker tests**

```ts
expect(isPublicIpAddress('127.0.0.1')).toBe(false);
expect(isPublicIpAddress('10.0.0.1')).toBe(false);
expect(isPublicIpAddress('169.254.169.254')).toBe(false);
expect(isPublicIpAddress('::1')).toBe(false);
expect(isPublicIpAddress('fc00::1')).toBe(false);
expect(isPublicIpAddress('2606:4700:4700::1111')).toBe(true);
```

With injected DNS and request functions, cover non-HTTP schemes, any private DNS answer, DNS errors, pinned public address requests, Host/TLS server name, redirect revalidation, sixth redirect rejection, 10-second abort, HEAD success, GET fallback only for `405`/`501`, and 64 KB read termination.

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- --run __tests__/lib/public-url-checker.test.ts`
Expected: FAIL because the checker is missing.

- [ ] **Step 3: Implement the checker**

```ts
export type RawUrlCheckResult = {
  status: number | null;
  finalUrl: string;
  errorCode: string | null;
  errorMessage: string | null;
};
export type UrlCheckerDependencies = {
  resolve: typeof import('node:dns/promises').lookup;
  request: typeof import('node:http').request;
  secureRequest: typeof import('node:https').request;
};
export async function checkPublicHttpUrl(
  input: string,
  deps?: Partial<UrlCheckerDependencies>,
): Promise<RawUrlCheckResult>;
```

Resolve with `{ all: true, verbatim: true }`, reject the URL if any answer is non-public, select and pin one public address in the request `hostname`, preserve the original `Host` header and HTTPS `servername`, and repeat the process for every redirect.

- [ ] **Step 4: Run and verify GREEN**

Run: `npm test -- --run __tests__/lib/public-url-checker.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```text
git add src/lib/public-url-checker.ts __tests__/lib/public-url-checker.test.ts
git commit -m "feat(forms): safely check public URLs"
```

### Task 3: Implement Health Classification and Reconciliation

**Files:**
- Create: `src/services/form-url-health.service.ts`
- Test: `__tests__/services/form-url-health.service.test.ts`

**Interfaces:**
- Consumes: `checkPublicHttpUrl`.
- Produces: `classifyUrlCheck`, `reconcileFormUrlHealth`, `listFormUrlWarningSummaries`, and `getFormUrlHealthDetails`.

- [ ] **Step 1: Write failing state-transition tests**

```ts
expect(classifyUrlCheck({ status: 403, errorCode: null, errorMessage: null })).toBe('UNVERIFIABLE');
expect(classifyUrlCheck({ status: 404, errorCode: null, errorMessage: null })).toBe('FAILED');
expect(nextHealthState(previousFailure(1), failedCheck).warningActivatedAt).toEqual(now);
expect(nextHealthState(previousFailure(2), healthyCheck)).toMatchObject({
  consecutiveFailures: 0, warningActivatedAt: null, classification: 'HEALTHY',
});
```

Also test URL fingerprint changes reset state, stale fields are deleted, only DRAFT/PUBLISHED non-deleted forms are selected, at most 500 are checked, concurrency never exceeds five, and one thrown check does not abort remaining URLs.

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- --run __tests__/services/form-url-health.service.test.ts`
Expected: FAIL because the service is missing.

- [ ] **Step 3: Implement classification and reconciliation**

```ts
export type UrlHealthClassification = 'HEALTHY' | 'UNVERIFIABLE' | 'FAILED';
export function classifyUrlCheck(result: RawUrlCheckResult): UrlHealthClassification;
export async function reconcileFormUrlHealth(): Promise<{
  checked: number; healthy: number; unverifiable: number; failed: number; warnings: number;
}>;
```

Hash normalized URLs with SHA-256. Upsert by `(tenantId, formId, fieldKey)`, activate the warning when the new definite-failure count reaches two, preserve the last-success timestamp on failure, and delete records no longer matched by a URL field.

- [ ] **Step 4: Run and verify GREEN**

Run: `npm test -- --run __tests__/services/form-url-health.service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```text
git add src/services/form-url-health.service.ts __tests__/services/form-url-health.service.test.ts
git commit -m "feat(forms): reconcile URL health warnings"
```

### Task 4: Register Daily Scheduling

**Files:**
- Create: `src/lib/scheduler/tasks/form-url-health.task.ts`
- Modify: `src/lib/scheduler/tasks/index.ts`
- Modify: `src/lib/scheduler/index.ts`
- Test: `__tests__/services/form-url-health-scheduler.test.ts`

**Interfaces:**
- Consumes: `reconcileFormUrlHealth`.
- Produces: scheduler task ID `form-url-health`, default cron `0 2 * * *`.

- [ ] **Step 1: Write the failing registration test**

```ts
expect(formUrlHealthTask).toMatchObject({ id: 'form-url-health', defaultCronPattern: '0 2 * * *' });
scheduler.registerTask(formUrlHealthTask);
expect(scheduler.getTask('form-url-health')?.cronPattern).toBe('0 2 * * *');
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- --run __tests__/services/form-url-health-scheduler.test.ts`
Expected: FAIL because the task is absent.

- [ ] **Step 3: Add task export and registration**

Return a successful `TaskResult` with reconciliation counts; convert thrown errors to a failed result and log through `createLogger('form-url-health-task')`. Register it alongside other form tasks so `SCHEDULER_FORM_URL_HEALTH_ENABLED` and `SCHEDULER_FORM_URL_HEALTH_CRON` work through existing scheduler conventions.

- [ ] **Step 4: Run and verify GREEN**

Run: `npm test -- --run __tests__/services/form-url-health-scheduler.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```text
git add src/lib/scheduler/tasks/form-url-health.task.ts src/lib/scheduler/tasks/index.ts src/lib/scheduler/index.ts __tests__/services/form-url-health-scheduler.test.ts
git commit -m "feat(forms): schedule URL health checks"
```

### Task 5: Expose Authenticated Warning APIs and Hooks

**Files:**
- Create: `src/app/api/forms/url-health/route.ts`
- Create: `src/app/api/forms/[id]/url-health/route.ts`
- Create: `src/hooks/use-form-url-health.ts`
- Test: `__tests__/api/form-url-health-routes.test.ts`

**Interfaces:**
- Produces: `GET /api/forms/url-health` warning summaries and `GET /api/forms/:id/url-health` field details.

- [ ] **Step 1: Write failing authorization and tenant tests**

```ts
expect(await GET(summaryRequest('tenant-1'))).toMatchResponse(200);
expect(listFormUrlWarningSummaries).toHaveBeenCalledWith('tenant-1');
expect(await GET_FORM(detailRequest('tenant-1'), params('form-2'))).toMatchResponse(200);
```

Assert unauthenticated/unauthorized responses follow existing helpers and cross-tenant records are absent.

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- --run __tests__/api/form-url-health-routes.test.ts`
Expected: FAIL because routes are absent.

- [ ] **Step 3: Implement routes and hooks**

Use `requireAuth`, document read permission, and `resolveWorkspaceId`. Hooks use keys `['form-url-health', tenantId]` and `['form-url-health', tenantId, formId]`, and remain disabled without a workspace/form ID.

- [ ] **Step 4: Run and verify GREEN**

Run: `npm test -- --run __tests__/api/form-url-health-routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```text
git add src/app/api/forms/url-health 'src/app/api/forms/[id]/url-health' src/hooks/use-form-url-health.ts __tests__/api/form-url-health-routes.test.ts
git commit -m "feat(forms): expose URL health warnings"
```

### Task 6: Show Backend-Only Warning Surfaces

**Files:**
- Modify: `src/app/(dashboard)/forms/page.tsx`
- Modify: `src/app/(dashboard)/forms/[id]/builder/page.tsx`
- Modify: `src/components/forms/field-general-tab.tsx`
- Test: `__tests__/app/forms-url-health-warnings.test.tsx`
- Test: `__tests__/components/form-url-health-field-warning.test.tsx`

**Interfaces:**
- Consumes: hooks from Task 5.
- Produces: form warning badges/counts and inline URL field warning detail.

- [ ] **Step 1: Write failing warning UI tests**

```tsx
expect(screen.getByLabelText('2 broken links')).toBeVisible();
expect(screen.getByText('Last checked 1 Aug 2026, 2:00 am')).toBeVisible();
expect(screen.getByText('HTTP 404')).toBeVisible();
```

Assert no warning renders for healthy, unverifiable, or single-failure records and that public-form tests contain no health-warning copy.

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- --run __tests__/app/forms-url-health-warnings.test.tsx __tests__/components/form-url-health-field-warning.test.tsx`
Expected: FAIL because warnings are not rendered.

- [ ] **Step 3: Implement compact warning UI**

Fetch one summary map on the Forms page and show a warning icon/count on affected cards. Fetch form detail once in the builder and pass the current field-key record into `FieldGeneralTab`; render an `Alert` with last checked time, status/error, and failure count only when `warningActivatedAt` is non-null.

- [ ] **Step 4: Run and verify GREEN**

Run: `npm test -- --run __tests__/app/forms-url-health-warnings.test.tsx __tests__/components/form-url-health-field-warning.test.tsx __tests__/app/public-form-page.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```text
git add 'src/app/(dashboard)/forms/page.tsx' 'src/app/(dashboard)/forms/[id]/builder/page.tsx' src/components/forms/field-general-tab.tsx __tests__/app/forms-url-health-warnings.test.tsx __tests__/components/form-url-health-field-warning.test.tsx
git commit -m "feat(forms): display URL health warnings"
```

### Task 7: Add Plain URL Style to Web and PDF

**Files:**
- Modify: `src/components/forms/field-general-tab.tsx`
- Modify: `src/app/(public)/forms/f/[slug]/page.tsx`
- Modify: `src/services/form-pdf.service.ts`
- Test: `__tests__/components/form-url-plain-style.test.tsx`
- Test: `__tests__/services/form-pdf-url-style.test.ts`

**Interfaces:**
- Consumes: existing `validation.infoBareStyle`.
- Produces: Plain text style toggle for `info_url` and wrapper-free link rendering.

- [ ] **Step 1: Write failing style tests**

```tsx
expect(screen.getByRole('switch', { name: 'Plain text style' })).toBeVisible();
expect(screen.getByRole('link', { name: 'Open resource' }).parentElement).not.toHaveClass('border');
```

For PDF HTML, assert an `info_url` with `infoBareStyle: true` contains `class="info-link"` but no `class="info-box"`; assert the default URL retains `info-box`.

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- --run __tests__/components/form-url-plain-style.test.tsx __tests__/services/form-pdf-url-style.test.ts`
Expected: FAIL because URL fields cannot select or render the bare style.

- [ ] **Step 3: Implement minimal rendering changes**

Include `info_url` in the field-editor toggle condition. In public rendering, apply the existing bare-info branch to URL blocks while preserving anchor classes and outer width container. In `form-pdf.service.ts`, conditionally omit only `<div class="info-box">` when `validation.infoBareStyle === true`.

- [ ] **Step 4: Run and verify GREEN**

Run: `npm test -- --run __tests__/components/form-url-plain-style.test.tsx __tests__/services/form-pdf-url-style.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```text
git add src/components/forms/field-general-tab.tsx 'src/app/(public)/forms/f/[slug]/page.tsx' src/services/form-pdf.service.ts __tests__/components/form-url-plain-style.test.tsx __tests__/services/form-pdf-url-style.test.ts
git commit -m "feat(forms): add plain URL block style"
```

### Task 8: Document and Verify URL Health Monitoring

**Files:**
- Modify: `docs/reference/API_REFERENCE.md`
- Modify: `docs/reference/ENVIRONMENT_VARIABLES.md`
- Modify: `docs/guides/DESIGN_GUIDELINE.md`
- Modify: `docs/INDEX.md`

- [ ] **Step 1: Update existing documentation**

Document warning-only behavior, two-failure threshold, status classification, safe-fetch limits, `SCHEDULER_FORM_URL_HEALTH_ENABLED`, `SCHEDULER_FORM_URL_HEALTH_CRON`, default `0 2 * * *`, API responses, and plain URL styling. Link updates through `docs/INDEX.md` without adding a separate guide.

- [ ] **Step 2: Run complete verification**

Run:

```text
npm test -- --run __tests__/services/form-url-health-schema.test.ts __tests__/lib/public-url-checker.test.ts __tests__/services/form-url-health.service.test.ts __tests__/services/form-url-health-scheduler.test.ts __tests__/api/form-url-health-routes.test.ts __tests__/app/forms-url-health-warnings.test.tsx __tests__/components/form-url-health-field-warning.test.tsx __tests__/components/form-url-plain-style.test.tsx __tests__/services/form-pdf-url-style.test.ts __tests__/app/public-form-page.test.tsx
npx tsc --noEmit
npm run lint
git diff --check
```

Expected: all commands exit 0 with no test failures, type errors, lint errors, or whitespace errors.

- [ ] **Step 3: Commit**

```text
git add docs/reference/API_REFERENCE.md docs/reference/ENVIRONMENT_VARIABLES.md docs/guides/DESIGN_GUIDELINE.md docs/INDEX.md
git commit -m "docs(forms): document URL health monitoring"
```
