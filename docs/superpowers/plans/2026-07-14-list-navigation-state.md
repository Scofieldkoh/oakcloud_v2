# List Navigation State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the complete originating Contacts or Companies list state when users return from a detail page with either browser Back or the in-app back control.

**Architecture:** Keep list state canonical in the URL. A small navigation utility will create and validate scoped `returnTo` destinations, while a focused workspace-change hook will distinguish initial session resolution from a real workspace ID change. List tables will add the canonical list URL to detail links, and detail pages will use the validated destination for visible and keyboard back navigation.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Vitest 4, Testing Library

## Global Constraints

- Preserve pagination, page size, search, filters, and sorting.
- Accept only local `/contacts` destinations from Contact detail pages and local `/companies` destinations from Company detail pages.
- Missing, malformed, external, or cross-section destinations fall back to the bare list route.
- Do not change pagination history semantics, visual styling, or unrelated list/detail areas.
- Follow `docs/guides/DESIGN_GUIDELINE.md`; this is a behavior-only change.

---

## File Structure

- Create `src/lib/list-navigation.ts`: pure helpers for scoped return URL validation and detail URL construction.
- Create `src/hooks/use-workspace-list-reset.ts`: mount-safe hook that invokes a reset only after one resolved workspace changes to another.
- Create `__tests__/lib/list-navigation.test.ts`: security and encoding coverage for return URLs.
- Create `__tests__/hooks/use-workspace-list-reset.test.tsx`: initial mount, delayed session resolution, and real workspace-change coverage.
- Create `__tests__/components/list-detail-navigation.test.tsx`: Contacts and Companies table-link coverage.
- Modify `src/app/(dashboard)/contacts/page.tsx` and `src/app/(dashboard)/companies/page.tsx`: use the workspace hook and pass canonical list URLs into tables.
- Modify `src/components/contacts/contact-table.tsx` and `src/components/companies/company-table.tsx`: attach `returnTo` to all detail links.
- Modify `src/app/(dashboard)/contacts/[id]/page.tsx` and `src/app/(dashboard)/companies/[id]/page.tsx`: validate and use return destinations for visible and keyboard navigation.
- Modify or create focused app tests under `__tests__/app/` for detail-page back controls.

---

### Task 1: Scoped List Navigation Utilities

**Files:**
- Create: `src/lib/list-navigation.ts`
- Create: `__tests__/lib/list-navigation.test.ts`

**Interfaces:**
- Produces: `type ListPath = '/contacts' | '/companies'`
- Produces: `buildDetailHref(detailPath: string, returnTo: string): string`
- Produces: `getSafeListReturnUrl(value: string | null | undefined, expectedPath: ListPath): string`

- [ ] **Step 1: Write the failing utility tests**

```ts
import { describe, expect, it } from 'vitest';
import { buildDetailHref, getSafeListReturnUrl } from '@/lib/list-navigation';

describe('list navigation', () => {
  it('encodes the complete list state in a detail URL', () => {
    expect(buildDetailHref('/contacts/contact-1', '/contacts?page=3&q=Jane Doe&sortOrder=desc'))
      .toBe('/contacts/contact-1?returnTo=%2Fcontacts%3Fpage%3D3%26q%3DJane+Doe%26sortOrder%3Ddesc');
  });

  it.each([
    ['/contacts?page=3&limit=50', '/contacts', '/contacts?page=3&limit=50'],
    ['/companies?page=4&status=LIVE', '/companies', '/companies?page=4&status=LIVE'],
    [null, '/contacts', '/contacts'],
    ['https://evil.example/contacts?page=3', '/contacts', '/contacts'],
    ['//evil.example/contacts?page=3', '/contacts', '/contacts'],
    ['/companies?page=3', '/contacts', '/contacts'],
    ['/contacts/contact-1', '/contacts', '/contacts'],
    ['/contacts?page=3#fragment', '/contacts', '/contacts'],
  ] as const)('validates %s for %s', (value, expectedPath, expected) => {
    expect(getSafeListReturnUrl(value, expectedPath)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `npm run test:run -- __tests__/lib/list-navigation.test.ts`

Expected: FAIL because `@/lib/list-navigation` does not exist.

- [ ] **Step 3: Implement the minimal pure helpers**

```ts
export type ListPath = '/contacts' | '/companies';

const INTERNAL_ORIGIN = 'https://oakcloud.local';

export function buildDetailHref(detailPath: string, returnTo: string): string {
  const search = new URLSearchParams({ returnTo });
  return `${detailPath}?${search.toString()}`;
}

export function getSafeListReturnUrl(
  value: string | null | undefined,
  expectedPath: ListPath,
): string {
  if (!value) return expectedPath;

  try {
    const parsed = new URL(value, INTERNAL_ORIGIN);
    if (
      parsed.origin !== INTERNAL_ORIGIN ||
      parsed.pathname !== expectedPath ||
      parsed.hash
    ) {
      return expectedPath;
    }
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return expectedPath;
  }
}
```

- [ ] **Step 4: Run the tests and verify GREEN**

Run: `npm run test:run -- __tests__/lib/list-navigation.test.ts`

Expected: PASS with all return URL cases covered.

- [ ] **Step 5: Commit the utility**

```powershell
git add -- src/lib/list-navigation.ts __tests__/lib/list-navigation.test.ts
git commit -m "feat(navigation): add scoped list return URLs"
```

---

### Task 2: Reset Pagination Only for a Real Workspace Change

**Files:**
- Create: `src/hooks/use-workspace-list-reset.ts`
- Create: `__tests__/hooks/use-workspace-list-reset.test.tsx`
- Modify: `src/app/(dashboard)/contacts/page.tsx:3,176-180,520-610`
- Modify: `src/app/(dashboard)/companies/page.tsx:3,149-153,740-800`

**Interfaces:**
- Produces: `useWorkspaceListReset(workspaceId: string | undefined, reset: () => void): void`
- Consumes in each list page: the existing `activeTenantId`, `setParams`, `clearSelection`, and canonical `targetUrl`.

- [ ] **Step 1: Write failing hook tests**

```tsx
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useWorkspaceListReset } from '@/hooks/use-workspace-list-reset';

describe('useWorkspaceListReset', () => {
  it('does not reset on mount or delayed initial workspace resolution', () => {
    const reset = vi.fn();
    const { rerender } = renderHook(
      ({ workspaceId }) => useWorkspaceListReset(workspaceId, reset),
      { initialProps: { workspaceId: undefined as string | undefined } },
    );
    rerender({ workspaceId: 'workspace-1' });
    expect(reset).not.toHaveBeenCalled();
  });

  it('resets once when one resolved workspace changes to another', () => {
    const reset = vi.fn();
    const { rerender } = renderHook(
      ({ workspaceId }) => useWorkspaceListReset(workspaceId, reset),
      { initialProps: { workspaceId: 'workspace-1' as string | undefined } },
    );
    rerender({ workspaceId: 'workspace-2' });
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the hook tests and verify RED**

Run: `npm run test:run -- __tests__/hooks/use-workspace-list-reset.test.tsx`

Expected: FAIL because the hook module does not exist.

- [ ] **Step 3: Implement the hook**

```ts
'use client';

import { useEffect, useRef } from 'react';

export function useWorkspaceListReset(
  workspaceId: string | undefined,
  reset: () => void,
): void {
  const resolvedWorkspaceRef = useRef<string | undefined>(workspaceId);

  useEffect(() => {
    if (!workspaceId) return;
    if (!resolvedWorkspaceRef.current) {
      resolvedWorkspaceRef.current = workspaceId;
      return;
    }
    if (resolvedWorkspaceRef.current === workspaceId) return;

    resolvedWorkspaceRef.current = workspaceId;
    reset();
  }, [reset, workspaceId]);
}
```

- [ ] **Step 4: Replace both unconditional mount effects**

In each list page, memoize the reset callback and pass it to the hook:

```tsx
const resetForWorkspaceChange = useCallback(() => {
  setParams((previous) => ({ ...previous, page: 1 }));
  clearSelection();
}, [clearSelection]);

useWorkspaceListReset(activeTenantId, resetForWorkspaceChange);
```

Remove the old `useEffect` block whose dependency list is `[activeTenantId, clearSelection]`. Keep the URL synchronization effect unchanged. Pass `returnTo={targetUrl}` to the corresponding `ContactTable` or `CompanyTable`.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `npm run test:run -- __tests__/hooks/use-workspace-list-reset.test.tsx __tests__/app/contacts-page-duplicate-review.test.tsx`

Expected: PASS; initial state is not reset, a genuine resolved-ID change resets once, and the existing Contacts page behavior remains intact.

- [ ] **Step 6: Commit the mount-safe reset**

```powershell
git add -- src/hooks/use-workspace-list-reset.ts __tests__/hooks/use-workspace-list-reset.test.tsx 'src/app/(dashboard)/contacts/page.tsx' 'src/app/(dashboard)/companies/page.tsx'
git commit -m "fix(lists): preserve URL state on initial mount"
```

---

### Task 3: Carry Canonical List State Through Table Detail Links

**Files:**
- Create: `__tests__/components/list-detail-navigation.test.tsx`
- Modify: `src/components/contacts/contact-table.tsx:37-71,137-173,191-215,590-623,768-785,847-854`
- Modify: `src/components/companies/company-table.tsx:142-180,265-300,328-360,780-824,964-997,1049-1055`

**Interfaces:**
- Consumes: `buildDetailHref(detailPath, returnTo)` from Task 1.
- Adds required table prop: `returnTo: string`.
- Adds action-dropdown prop: `detailHref: string`.

- [ ] **Step 1: Write failing table-link tests**

Create one minimal Contact and Company fixture, render each table with `returnTo` containing pagination, filters, sorting, and page size, and assert every link whose accessible name opens or views that record has the encoded `returnTo` value. The key assertions are:

```tsx
expect(screen.getAllByRole('link', { name: /Jane Tan|open "Jane Tan"|view details/i }))
  .toEqual(expect.arrayContaining([
    expect.objectContaining({ href: expect.stringContaining('returnTo=%2Fcontacts%3Fpage%3D3') }),
  ]));

expect(screen.getAllByRole('link', { name: /Example Pte\. Ltd\.|open "Example Pte\. Ltd\."|view details/i }))
  .toEqual(expect.arrayContaining([
    expect.objectContaining({ href: expect.stringContaining('returnTo=%2Fcompanies%3Fpage%3D4') }),
  ]));
```

Use `getAttribute('href')` for exact assertions if DOM elements do not expose `href` as a plain property.

- [ ] **Step 2: Run the table tests and verify RED**

Run: `npm run test:run -- __tests__/components/list-detail-navigation.test.tsx`

Expected: FAIL because the table interfaces do not accept `returnTo` and links point to bare detail URLs.

- [ ] **Step 3: Build one detail URL per row and reuse it**

Add `returnTo` to both table prop interfaces and destructuring. Inside each row map:

```tsx
const detailHref = buildDetailHref(`/contacts/${contact.id}`, returnTo);
```

or:

```tsx
const detailHref = buildDetailHref(`/companies/${company.id}`, returnTo);
```

Use `detailHref` for mobile title links, desktop name links, new-tab links, and View Details action links. Pass `detailHref` into `ContactActionsDropdown` or `CompanyActionsDropdown`. Do not add it to edit, create, or delete actions.

- [ ] **Step 4: Run table and affected page tests**

Run: `npm run test:run -- __tests__/components/list-detail-navigation.test.tsx __tests__/app/contacts-page-duplicate-review.test.tsx`

Expected: PASS. Update the existing mocked `ContactTable` prop type only if TypeScript requires the new `returnTo` prop.

- [ ] **Step 5: Commit table state propagation**

```powershell
git add -- src/components/contacts/contact-table.tsx src/components/companies/company-table.tsx __tests__/components/list-detail-navigation.test.tsx __tests__/app/contacts-page-duplicate-review.test.tsx
git commit -m "feat(lists): carry list state into detail links"
```

---

### Task 4: Use the Validated Destination on Detail Pages

**Files:**
- Modify: `src/app/(dashboard)/contacts/[id]/page.tsx:3-5,68-85,178-185,300-325,343-379`
- Modify: `src/app/(dashboard)/companies/[id]/page.tsx:41-44,86-95,106-119,151-157,198-240`
- Create: `__tests__/app/list-detail-back-navigation.test.tsx`

**Interfaces:**
- Consumes: `getSafeListReturnUrl(value, expectedPath)` from Task 1.
- Contact page receives Next.js `searchParams: Promise<{ returnTo?: string | string[] }>` and resolves it with React `use`.
- Company page reads `returnTo` from its existing `useSearchParams()` value.

- [ ] **Step 1: Write failing back-navigation tests**

Cover both detail pages with focused mocks for data hooks, permissions, toast, keyboard shortcuts, and large child sections. Assert:

```tsx
expect(screen.getByRole('link', { name: 'Back to Contacts' }))
  .toHaveAttribute('href', '/contacts?page=3&limit=50&q=Jane');

expect(screen.getByRole('link', { name: 'Back to Companies' }))
  .toHaveAttribute('href', '/companies?page=4&status=LIVE');
```

Capture the shortcuts passed to `useKeyboardShortcuts`, invoke the Ctrl+Backspace handler, and assert `router.push` receives the same validated URL. Rerender with `returnTo=https://evil.example/contacts` and verify the Contact fallback is `/contacts`; verify a cross-section Company value falls back to `/companies`.

- [ ] **Step 2: Run detail tests and verify RED**

Run: `npm run test:run -- __tests__/app/list-detail-back-navigation.test.tsx`

Expected: FAIL because the current controls and shortcuts use bare list routes.

- [ ] **Step 3: Wire the Contact detail page**

Resolve the route search params and compute exactly one destination:

```tsx
const resolvedSearchParams = use(searchParams);
const rawReturnTo = Array.isArray(resolvedSearchParams.returnTo)
  ? resolvedSearchParams.returnTo[0]
  : resolvedSearchParams.returnTo;
const backHref = getSafeListReturnUrl(rawReturnTo, '/contacts');
```

Use `backHref` in both “Back to Contacts” links, the Ctrl+Backspace shortcut, and the successful-delete redirect. Keep all existing class names and copy.

- [ ] **Step 4: Wire the Company detail page**

After the existing `useSearchParams()` call:

```tsx
const backHref = getSafeListReturnUrl(searchParams.get('returnTo'), '/companies');
```

Use `backHref` in both “Back to Companies” links, the Ctrl+Backspace shortcut, and the successful-delete redirect. When removing the one-shot `refresh` query parameter, preserve `returnTo` because the existing `URLSearchParams` copy already retains unrelated parameters.

- [ ] **Step 5: Run all navigation tests**

Run: `npm run test:run -- __tests__/lib/list-navigation.test.ts __tests__/hooks/use-workspace-list-reset.test.tsx __tests__/components/list-detail-navigation.test.tsx __tests__/app/list-detail-back-navigation.test.tsx __tests__/app/contacts-page-duplicate-review.test.tsx`

Expected: PASS with no warnings or unhandled errors.

- [ ] **Step 6: Commit detail back navigation**

```powershell
git add -- 'src/app/(dashboard)/contacts/[id]/page.tsx' 'src/app/(dashboard)/companies/[id]/page.tsx' __tests__/app/list-detail-back-navigation.test.tsx
git commit -m "fix(navigation): restore originating list from details"
```

---

### Task 5: Full Verification and Rendered Navigation QA

**Files:**
- Modify only if verification reveals a defect in the scoped implementation.
- Do not commit screenshots, traces, or temporary browser scripts.

**Interfaces:**
- Verifies the completed behavior from Tasks 1-4.

- [ ] **Step 1: Run static checks**

Run: `npm run lint`

Expected: exit code 0 with no new errors.

Run: `npx tsc --noEmit`

Expected: exit code 0.

- [ ] **Step 2: Run the complete test suite**

Run: `npm run test:run`

Expected: all tests pass with no unhandled errors.

- [ ] **Step 3: Run a production build**

Run: `npm run build`

Expected: Next.js production build succeeds, including App Router prerender checks.

- [ ] **Step 4: Validate browser Back in the rendered app**

Using the in-app Browser workflow, test:

`/contacts?page=2` -> open a Contact -> browser Back -> URL and pagination remain on page 2 without a second page-1 transition.

Repeat for `/companies?page=2`. Check page identity, meaningful DOM content, absence of framework overlays, console health, and interaction state after Back.

- [ ] **Step 5: Validate in-app back controls**

From a list URL containing page, limit, filter, and sorting values, open a record and click “Back to Contacts” or “Back to Companies”. Verify the exact originating URL and rendered table state are restored. Also open a detail route directly without `returnTo` and verify the control safely navigates to the bare list.

- [ ] **Step 6: Review the final diff**

Run: `git diff --check HEAD~4..HEAD`

Run: `git status --short`

Expected: no whitespace errors and no unintended files.
