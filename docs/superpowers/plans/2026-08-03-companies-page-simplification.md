# Companies Page Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the established left-arrow treatment to the company detail back link and remove the Companies main-page Statistics cards.

**Architecture:** Make localized presentation-only edits in the two existing Companies page components. Reuse the already imported Lucide `ArrowLeft` icon and remove only the Statistics render block plus imports made unused by that removal; preserve navigation state, queries, list rendering, and API contracts.

**Tech Stack:** Next.js App Router, React, TypeScript, Tailwind CSS, Lucide React

## Global Constraints

- Preserve the existing `backHref` navigation behavior.
- Preserve filters, active filter chips, table, mobile company result cards, pagination, actions, permissions, loading states, and error states.
- Do not change company data fetching or API behavior.
- Do not add or run automated tests, per user direction.
- Follow `docs/guides/DESIGN_GUIDELINE.md` and the existing Contacts back-link pattern.

---

## File Structure

- Modify `src/app/(dashboard)/companies/[id]/page.tsx`: render the arrow in the primary company-detail back link and align its presentation with the Contacts detail page.
- Modify `src/app/(dashboard)/companies/page.tsx`: remove the Statistics section and imports used only by that section.

### Task 1: Align the Company Detail Back Link

**Files:**
- Modify: `src/app/(dashboard)/companies/[id]/page.tsx:226-237`

**Interfaces:**
- Consumes: existing `backHref: string` and Lucide `ArrowLeft` import.
- Produces: the existing "Back to Companies" link with an inline decorative arrow; no new exported interface.

- [ ] **Step 1: Update the primary back link styling**

Replace the link contents and spacing classes with the established Contacts detail-page pattern:

```tsx
<Link
  href={backHref}
  className="mb-3 inline-flex items-center gap-2 text-sm text-text-secondary transition-colors hover:text-text-primary"
>
  <ArrowLeft className="h-4 w-4" />
  Back to Companies
</Link>
```

- [ ] **Step 2: Review navigation preservation**

Confirm the edited link still uses `href={backHref}` and that the company-not-found link remains unchanged.

### Task 2: Remove the Companies Statistics Section

**Files:**
- Modify: `src/app/(dashboard)/companies/page.tsx:6-8`
- Modify: `src/app/(dashboard)/companies/page.tsx:642-701`

**Interfaces:**
- Consumes: existing Companies page render tree.
- Produces: a Companies list page whose header is followed by filters, without the four-card Statistics section; no new exported interface.

- [ ] **Step 1: Delete the Statistics render block**

Remove the complete block beginning with `{/* Stats Cards */}` and ending after its `MobileCollapsibleSection`, including the conditional `{stats && (...)}` wrapper.

- [ ] **Step 2: Remove imports made unused by the deletion**

Delete `MobileCollapsibleSection` and `Building2` from the page imports while retaining `AlertCircle`, which is still used by error states.

- [ ] **Step 3: Preserve functional list content**

Confirm `CompanyFilters`, active filter chips, `CompanyTable`, mobile company results rendered by that table component, pagination, and action controls remain present and unchanged.

### Task 3: Static Verification

**Files:**
- Verify: `src/app/(dashboard)/companies/[id]/page.tsx`
- Verify: `src/app/(dashboard)/companies/page.tsx`

**Interfaces:**
- Consumes: the two modified page components.
- Produces: evidence that the source is syntactically and stylistically valid without running automated tests.

- [ ] **Step 1: Inspect the focused diff**

Run:

```powershell
git diff --check -- 'src/app/(dashboard)/companies/[id]/page.tsx' 'src/app/(dashboard)/companies/page.tsx'
git diff -- 'src/app/(dashboard)/companies/[id]/page.tsx' 'src/app/(dashboard)/companies/page.tsx'
```

Expected: no whitespace errors; the diff contains only the arrow/link styling change, Statistics deletion, and unused-import cleanup.

- [ ] **Step 2: Run the project lint command against the edited files if supported**

Read `package.json` to identify the existing lint script. If it accepts file arguments, run it for the two edited pages; otherwise run the project's normal lint command. This is a static check, not an automated test.

- [ ] **Step 3: Confirm no stale Statistics UI references remain**

Run:

```powershell
rg -n -S "Stats Cards|MobileCollapsibleSection|stats\.total|stats\.byStatus|stats\.recentlyAdded|stats\.withOverdueFilings" 'src/app/(dashboard)/companies/page.tsx'
```

Expected: no matches.

