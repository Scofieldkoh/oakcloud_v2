# Document Vault and Document Generation Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebrand Document Processing as Document Vault and make Templates a permission-aware top-level tab within Document Generation at `/template-partials`.

**Architecture:** Keep `/processing` and `/generated-documents` intact, move the Templates page to a non-admin route, and retain a redirect at the old route. A small shared linked-tab component provides consistent Document Generation navigation on both destination pages.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Tailwind CSS, Vitest, Testing Library

## Global Constraints

- Preserve the `/processing` route and internal Document Processing identifiers.
- Use `/template-partials` as the canonical Templates URL.
- Preserve query parameters when redirecting from `/admin/template-partials`.
- Use document permissions for template actions; do not gate the page by workspace-admin role.
- Preserve unrelated working-tree changes.

---

### Task 1: Shared Document Generation Tabs

**Files:**
- Create: `src/components/documents/document-generation-tabs.tsx`
- Create: `__tests__/components/document-generation-tabs.test.tsx`

**Interfaces:**
- Consumes: Next.js `usePathname()` and `Link`.
- Produces: `DocumentGenerationTabs(): JSX.Element`, with links to `/generated-documents` and `/template-partials`.

- [ ] **Step 1: Write the failing component test**

Mock `next/navigation` so each route can be exercised, render `DocumentGenerationTabs`, and assert both accessible links, destinations, and `aria-current="page"` on only the active link.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- --run __tests__/components/document-generation-tabs.test.tsx`

Expected: FAIL because `@/components/documents/document-generation-tabs` does not exist.

- [ ] **Step 3: Implement the minimal shared tab component**

Create a client component with a `tabs` constant containing `{ label, href }`, derive active state using exact-or-descendant route matching, and render an accessible `nav aria-label="Document Generation"` with linked tab styling and `aria-current`.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm test -- --run __tests__/components/document-generation-tabs.test.tsx`

Expected: PASS with two tests covering both active destinations.

### Task 2: Templates Route and Permission Model

**Files:**
- Move: `src/app/(dashboard)/admin/template-partials/page.tsx` to `src/app/(dashboard)/template-partials/page.tsx`
- Create: `src/app/(dashboard)/admin/template-partials/page.tsx`
- Modify: `src/app/(dashboard)/template-partials/page.tsx`
- Create: `__tests__/app/template-partials-access.test.tsx`

**Interfaces:**
- Consumes: `usePermissions()` from `@/hooks/use-permissions`.
- Produces: canonical `/template-partials` page and legacy redirect page.

- [ ] **Step 1: Write failing access and redirect tests**

Assert the canonical page uses `can.createDocument || can.updateDocument || can.deleteDocument` for management controls instead of session admin flags. Assert the legacy server page calls `redirect('/template-partials?...')` with supplied search parameters encoded through `URLSearchParams`.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npm test -- --run __tests__/app/template-partials-access.test.tsx`

Expected: FAIL because the canonical route and redirect do not exist.

- [ ] **Step 3: Move the page and implement document-permission actions**

Move the existing page without rewriting its content. Import `usePermissions`, derive `canManage` from document create/update/delete permissions, retain `useSession` only for workspace selection, and render `DocumentGenerationTabs` above the page header.

- [ ] **Step 4: Add the legacy redirect**

Implement the old route as an async server page that accepts `searchParams`, appends string and string-array values to `URLSearchParams`, and redirects to `/template-partials` plus the serialized query string.

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run: `npm test -- --run __tests__/app/template-partials-access.test.tsx __tests__/components/document-generation-tabs.test.tsx`

Expected: PASS.

### Task 3: Sidebar and Page Integration

**Files:**
- Modify: `src/components/ui/sidebar.tsx`
- Modify: `src/app/(dashboard)/generated-documents/page.tsx`
- Modify: `src/app/(dashboard)/processing/page.tsx`
- Create: `__tests__/components/document-navigation-source.test.ts`

**Interfaces:**
- Consumes: `DocumentGenerationTabs` from Task 1.
- Produces: user-facing `Document Vault` label and tabs on Generated Documents.

- [ ] **Step 1: Write the failing navigation regression test**

Read the three source files and assert: sidebar contains `{ name: 'Document Vault', href: '/processing' }`; sidebar does not contain the admin Templates item; Generated Documents imports/renders `DocumentGenerationTabs`; processing heading contains `Document Vault` and no user-facing `Document Processing` heading remains.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- --run __tests__/components/document-navigation-source.test.ts`

Expected: FAIL on the old sidebar label and missing tab component.

- [ ] **Step 3: Apply the minimal UI changes**

Rename the sidebar entry, remove its ungrouped admin Templates entry, render `DocumentGenerationTabs` before the Generated Documents header, and change the processing page heading to `Document Vault`.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm test -- --run __tests__/components/document-navigation-source.test.ts __tests__/components/document-generation-tabs.test.tsx`

Expected: PASS.

### Task 4: Documentation and Full Verification

**Files:**
- Modify: `docs/README.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: relevant current feature/debug documentation returned by `rg -n "Document Processing" docs`

**Interfaces:**
- Produces: current user-facing documentation using `Document Vault` while retaining explicit internal technical identifiers where required.

- [ ] **Step 1: Update existing documentation**

Change current module listings and user-facing headings to `Document Vault`. Keep historical changelog entries, internal filenames, and phrases explicitly describing a `DocumentProcessing` code identifier unchanged.

- [ ] **Step 2: Scan for stale canonical links and unintended labels**

Run: `rg -n -S "/admin/template-partials|Document Processing" src docs --glob '!docs/superpowers/**'`

Expected: no live UI link targets the old Templates URL; remaining Document Processing matches are internal or historical and individually justified.

- [ ] **Step 3: Run focused and broader verification**

Run: `npm test -- --run __tests__/components/document-generation-tabs.test.tsx __tests__/app/template-partials-access.test.tsx __tests__/components/document-navigation-source.test.ts`

Run: `npx eslint src/components/documents/document-generation-tabs.tsx src/components/ui/sidebar.tsx "src/app/(dashboard)/generated-documents/page.tsx" "src/app/(dashboard)/processing/page.tsx" "src/app/(dashboard)/template-partials/page.tsx" "src/app/(dashboard)/admin/template-partials/page.tsx"`

Run: `npx tsc --noEmit`

Expected: all commands exit 0 without new warnings or errors.

- [ ] **Step 4: Review the final diff**

Run: `git diff --check` and `git status --short`.

Expected: no whitespace errors; only intended files plus the user's pre-existing changes are present.
