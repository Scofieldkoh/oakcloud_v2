# Tasks and Pipelines UI Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the Tasks and Pipelines interfaces with Oakcloud's established Companies and Contacts page spacing, hierarchy, list surfaces, and responsive behavior.

**Architecture:** Preserve all feature state, hooks, mutations, routes, and component ownership. Apply the approved presentation changes inside the existing task and pipeline components, extracting only small local presentation helpers where they make grouping clearer.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS, Lucide React, dnd-kit.

## Global Constraints

- Use existing Oakcloud tokens and shared controls.
- Use responsive page gutters of `p-4 sm:p-6`.
- Use a 24px rhythm between primary page sections.
- Preserve Tasks desktop columns exactly as Company, Task, Stages, Owner, Due, Actions.
- Preserve all current workflows, query hooks, mutations, permissions, validation, and responsive behavior.
- Prevent page-level horizontal overflow; only the desktop Tasks table may scroll horizontally.
- Preserve light and dark themes.
- Do not add statistics, API changes, database changes, or new functionality.
- Per user instruction, do not run automated tests or browser tests for this change.

---

### Task 1: Normalize the Tasks page shell and filters

**Files:**
- Modify: `src/components/tasks/task-workspace.tsx`
- Modify: `src/components/tasks/task-filters.tsx`

**Interfaces:**
- Consumes: Existing `TaskListParams`, pipeline/company/owner options, and `onChange`.
- Produces: The same `TaskWorkspace` and `TaskFilters` exports with unchanged props and behavior.

- [x] **Step 1: Apply the standard page shell**

Wrap `TaskWorkspace` in `p-4 sm:p-6`, change the primary content rhythm to 24px, and use the Companies/Contacts responsive header/action pattern.

- [x] **Step 2: Create a coherent filter surface**

Place search and selects inside one subtle bordered toolbar, normalize control heights and wrapping, and keep every existing filter option.

- [x] **Step 3: Add active filter chips**

Render compact removable chips for active pipeline, company, owner, status, and due filters with a clear-all action. Keep filter state in the existing `TaskListParams` object.

- [x] **Step 4: Align feedback and pagination**

Keep alerts and dialogs unchanged while making loading, empty, and pagination surfaces follow the page rhythm and shared pagination placement.

### Task 2: Normalize Tasks table and mobile cards

**Files:**
- Modify: `src/components/tasks/task-list.tsx`
- Modify: `src/components/tasks/task-stage-pipeline.tsx`

**Interfaces:**
- Consumes: Existing `TaskListItem`, `TaskStageSummary`, and task action callbacks.
- Produces: The same `TaskList` and `TaskStagePipeline` exports with unchanged interaction behavior.

- [x] **Step 1: Align desktop table anatomy**

Use the established Oakcloud table container, header, row, border, and hover treatments while preserving the exact column order and table-only horizontal overflow.

- [x] **Step 2: Normalize cell alignment**

Make company/task metadata, owner, due date, stage sequence, and actions share consistent horizontal and vertical padding.

- [x] **Step 3: Refine the stage sequence**

Preserve all stage icons and accessible labels while normalizing icon button size, connector alignment, and state treatment.

- [x] **Step 4: Align mobile cards**

Keep the existing `MobileCard` structure while matching shared card padding, metadata gaps, and action target sizing.

### Task 3: Normalize the Pipelines list page

**Files:**
- Modify: `src/components/tasks/pipelines/pipeline-workspace.tsx`
- Modify: `src/components/tasks/pipelines/pipeline-list.tsx`

**Interfaces:**
- Consumes: Existing pipeline query and mutation hooks plus list callbacks.
- Produces: The same list workspace and `PipelineList` exports with unchanged duplicate, edit, create, and archive behavior.

- [x] **Step 1: Apply the standard page shell**

Move the Pipelines list page to `p-4 sm:p-6` with the established responsive header and 24px primary section rhythm.

- [x] **Step 2: Refine pipeline entries**

Keep the responsive collection layout while aligning icon, title, description, stage/version metadata, and actions to a consistent internal grid.

- [x] **Step 3: Normalize states**

Match loading, empty, error, and confirmation placement to the Tasks and peer list modules.

### Task 4: Reorganize the Pipeline builder presentation

**Files:**
- Modify: `src/components/tasks/pipelines/pipeline-builder.tsx`
- Modify: `src/components/tasks/pipelines/pipeline-workspace.tsx`

**Interfaces:**
- Consumes: Existing `PipelineDraft`, `TemplateOption`, `TaskPipelineCreatePayload`, and save/cancel callbacks.
- Produces: The same `PipelineBuilder` export and payload shape with unchanged validation and ordering behavior.

- [x] **Step 1: Normalize the builder shell**

Apply the responsive page gutter at the workspace boundary and use a focused builder width with the standard responsive header/action layout.

- [x] **Step 2: Structure pipeline identity**

Present name and description in one restrained section with consistent labels, inputs, and padding.

- [x] **Step 3: Group stage controls**

Within each sortable stage, create explicit visual groups for stage identity, behavior, appearance, adapter configuration, and checklist using headings, dividers, and spacing rather than nested cards.

- [x] **Step 4: Refine stage actions**

Keep drag, move, remove, add, and icon selection behavior while aligning their sizes, accessible labels, and responsive wrapping.

- [x] **Step 5: Preserve validation visibility**

Keep the top validation summary and ensure grouped fields remain visible and readable when validation fails.

### Task 5: Inspect and document the resulting change

**Files:**
- Modify: `docs/superpowers/plans/2026-07-27-tasks-pipelines-ui-consistency.md`

**Interfaces:**
- Consumes: Completed UI diff.
- Produces: Checked task boxes and an implementation record.

- [x] **Step 1: Inspect the diff**

Run `git diff --check` and review the complete changed-file diff for accidental behavior, API, or copy changes. Do not execute test, lint, typecheck, build, or browser commands.

- [x] **Step 2: Record completion**

Mark completed plan steps and summarize the exact visual changes and the intentional absence of test execution.

## Implementation Record

- Added the established `p-4 sm:p-6` page gutter and 24px section rhythm to Tasks, Pipelines, and Pipeline builder workspaces.
- Consolidated Task filters into one bordered toolbar with responsive wrapping, active filter chips, and clear-all behavior.
- Reused shared Oakcloud table and pagination surfaces and normalized desktop and mobile Task spacing.
- Refined pipeline cards with consistent metadata and action alignment.
- Grouped Pipeline builder controls into pipeline details, stage details, behavior, appearance, action settings, and checklist sections.
- Replaced text movement glyphs with Lucide controls and retained drag, reorder, validation, save, and mutation behavior.
- Ran `git diff --check` and reviewed the changed-source diff.
- Per user instruction, did not run automated tests, browser tests, lint, typecheck, or build commands.

---

### Task 6: Expand and reorganize the Company Profile stage modal

**Files:**
- Modify: `src/components/tasks/task-stage-modal.tsx`
- Modify: `src/components/tasks/task-workspace.tsx`
- Modify: `src/components/tasks/__tests__/task-components.test.tsx`

**Interfaces:**
- Consumes: `TaskStageDetail`, the selected task due date, `CompanySearchableSelect`, the existing company-create launch context, and `/api/documents/upload`.
- Produces: The existing `TaskStageModal` with a two-column Company Profile action area, direct Bizfile upload handoff, reusable company search, and reordered metadata.

- [x] **Step 1: Add focused failing modal tests**

Cover the larger modal size, upload/create/link ordering, searchable company linking, selected-file replacement/removal, task due date, and upload handoff URL while retaining the task launch context.

- [x] **Step 2: Implement the Company Profile action area**

Use the existing Bizfile file rules (PDF, PNG, JPG, WebP, 10MB), show the selected file name and remove/re-upload controls, upload only after the explicit review button is clicked, and surface recoverable upload errors in the modal.

- [x] **Step 3: Resume the Bizfile review page from an uploaded document**

Pass the uploaded document ID, file metadata, and task context to `/companies/upload`; have that page load the stored source document, run its existing extraction path once, and open the existing review workspace.

- [x] **Step 4: Reorder and regroup the remaining modal content**

Place notes before metadata, then render Linked Outcome and Assignee together with Due Date, Started, and Completed in a second row. Pass the selected task's due date from `TaskWorkspace`.

- [x] **Step 5: Run focused verification**

Run only the Company Profile modal and Bizfile upload-page tests, focused ESLint on changed source files, and `git diff --check`. Do not run the full test suite.

## Company Profile Implementation Record

- Expanded only the Company Profile stage modal from `xl` to `6xl` and increased its internal header, body, and footer spacing.
- Added a two-column creation area with a BizFile drop zone and a separate manual-create path.
- Added selected-file removal and replacement, explicit upload initiation, inline upload errors, and task-context handoff to the existing BizFile review workspace.
- Replaced the native company select with the reusable searchable company selector.
- Moved Linked Outcome, Assignee, Due Date, Started, and Completed below Notes in the requested two-row grouping.
- Added authenticated pending-document streaming for the review handoff with uploader, workspace, status, and tenant checks.
- Verified 9 TaskStageModal tests, 10 BizFile upload-page tests, and 2 pending-document route tests; ran focused ESLint and `git diff --check`.

---

### Task 7: Add inline filtering, separate columns, compact actions, and persistent widths

**Files:**
- Modify: `src/components/tasks/task-workspace.tsx`
- Modify: `src/components/tasks/task-filters.tsx`
- Modify: `src/components/tasks/task-list.tsx`
- Modify: `src/components/tasks/__tests__/task-components.test.tsx`
- Modify: `src/components/tasks/__tests__/task-workspace.test.tsx`

**Interfaces:**
- Consumes: Existing `TaskListParams`, task list items, pipeline/company/owner
  options, task callbacks, `useUserPreferences`, and `useUpsertUserPreference`.
- Produces: A search-only `TaskFilters`, a filter-aware `TaskList`, and the same
  task mutation callbacks and query parameter shape.

- [x] **Step 1: Add focused failing component tests**

Assert that the global filter exposes only search, desktop columns are ordered
Company, Task, Pipeline, Stages, Owner, Due, Actions, the inline filter row is
above the header row, row actions use one ellipsis trigger, and a completed
resize saves `tasks:list:columns:v1`.

- [x] **Step 2: Run the focused tests and verify the expected failures**

Run:
`npm.cmd run test:run -- src/components/tasks/__tests__/task-components.test.tsx src/components/tasks/__tests__/task-workspace.test.tsx`

Expected: failures for the new column, inline-filter, action-menu, and resize
requirements while the existing task behavior tests continue to execute.

- [x] **Step 3: Reduce the global filter to text search**

Keep the debounced task query update contract in `TaskFilters`, remove its
selects and active-filter chip surface, and preserve page reset and current
limit when search changes.

- [x] **Step 4: Add inline desktop column filters**

Pass current filters and option collections from `TaskWorkspace` to `TaskList`.
Render the five selects in a first `<thead>` row above their matching Pipeline,
Company, Owner, Status, and Due headers. Each change updates the same
`TaskListParams` object and resets `page` to `1`.

- [x] **Step 5: Separate Task and Pipeline and consolidate row actions**

Render the pipeline name in its own column and leave the task title/status in
the Task column. Replace inline action buttons with the shared Dropdown and one
`MoreHorizontal` trigger while preserving disabled and status-dependent items.

- [x] **Step 6: Add per-user column width persistence**

Load `tasks:list:columns:v1`, apply restored widths through a `<colgroup>`, and
add resize handles for all desktop columns. During pointer movement update local
width state; on pointer release persist the final width through
`useUpsertUserPreference`.

- [x] **Step 7: Run focused verification**

Run only the two Tasks component test files, ESLint for the three changed source
files, and `git diff --check`. Inspect the changed Tasks diff and avoid the full
suite, production build, or unrelated browser flows.

## Tasks Table Follow-up Implementation Record

- Reduced the page-level Tasks filter to the global text search field.
- Moved Company, Status, Pipeline, Owner, and Due controls into a desktop
  filter row immediately above the table headers.
- Split Task and Pipeline into independent columns.
- Consolidated the existing row mutations into one ellipsis dropdown.
- Added pointer and keyboard resizing for every desktop column and persisted
  widths through `tasks:list:columns:v1`.
- Verified 29 focused Tasks component/workspace tests, focused ESLint, and
  `git diff --check`.
- Rendered `/tasks` from the current workspace, selected the Client Onboarding
  inline Pipeline filter, and confirmed the separate Pipeline header and
  ellipsis actions. The only console warning was an existing slow-query log.

---

### Task 8: Match Document Vault filter controls and overflow resizing

**Files:**
- Modify: `src/components/tasks/task-list.tsx`
- Modify: `src/components/tasks/__tests__/task-components.test.tsx`

**Interfaces:**
- Consumes: Shared `SearchableSelect`, current `TaskListParams`, option
  collections, and persisted task column widths.
- Produces: Searchable inline filters and an explicitly sized desktop table that
  can grow beyond its scroll container.

- [x] **Step 1: Add focused failing tests**

Assert that every inline filter is rendered as the shared searchable input
instead of a native select, and that the table width equals the sum of current
column widths before and after resizing.

- [x] **Step 2: Run the focused test and verify expected failures**

Run:
`npx.cmd vitest run src/components/tasks/__tests__/task-components.test.tsx --exclude ".worktrees/**" --maxWorkers=1 --fileParallelism=false`

Expected: failures because the filters are native selects and the table lacks an
explicit summed width.

- [x] **Step 3: Reuse the Document Vault searchable filter pattern**

Replace Company, Status, Pipeline, Owner, and Due native selects with
`SearchableSelect` using `variant="table-filter"`, no chevron, no keyboard-hint
footer, and an empty `All` option.

- [x] **Step 4: Make resized columns grow the scrollable table**

Derive the total table width from persisted/default widths and apply it as both
`width` and `minWidth`. Keep horizontal overflow on `task-table-scroll`.

- [x] **Step 5: Run focused verification**

Run the Tasks component test, focused ESLint for the changed source/test files,
and `git diff --check`. Do not run the full suite or production build.

**Implementation record:** All five inline filters now reuse
`SearchableSelect` with the Document Vault table-filter presentation. The task
table width is the sum of the current persisted/default column widths, so
dragging a column wider expands the table past the viewport and uses the
existing horizontal scroll container.

---

### Task 9: Preserve the Tasks data grid in empty states and restore filter badges

**Files:**
- Modify: `src/components/tasks/task-workspace.tsx`
- Modify: `src/components/tasks/task-list.tsx`
- Modify: `src/components/tasks/__tests__/task-workspace.test.tsx`

**Interfaces:**
- Consumes: Current `TaskListParams`, task option collections, shared
  `FilterChip`, and the existing `TaskList` empty `tasks` array.
- Produces: A persistent empty desktop data grid and removable active-filter
  badges with one clear-all action.

- [x] **Step 1: Add focused failing workspace tests**

Assert that a zero-result response still renders the Tasks table, searchable
inline filters, column headers, and a seven-column empty row. Assert that global
search and Pipeline filters produce labeled removable chips and that clear-all
returns the query to `{ page: 1, limit: 20 }`.

- [x] **Step 2: Verify both regressions fail**

Run:
`npx.cmd vitest run src/components/tasks/__tests__/task-workspace.test.tsx --exclude ".worktrees/**" --maxWorkers=1 --fileParallelism=false`

Expected: the empty test cannot find a table, and the badge test cannot find
`Active filters:`.

- [x] **Step 3: Keep TaskList mounted for zero results**

Remove the `tasks.length === 0` replacement branch from `TaskWorkspace`.
Render the empty message inside `TaskList` as a full-width desktop table row
and as a compact mobile empty card.

- [x] **Step 4: Derive and render active filter chips**

Build chips for Search, Company, Status, Pipeline, Owner, and Due using their
human-readable option labels. Use shared `FilterChip` removal controls, reset
the page to `1` after individual removal, and preserve `limit` when clearing
all filters.

- [x] **Step 5: Run focused verification**

Run only the two Tasks component test files, focused ESLint for changed files,
and `git diff --check`. Do not run the full suite or production build.

---

### Task 10: Separate task status and simplify undated Due cells

**Files:**
- Modify: `src/components/tasks/task-list.tsx`
- Modify: `src/components/tasks/__tests__/task-components.test.tsx`
- Modify: `src/components/tasks/__tests__/task-workspace.test.tsx`

**Interfaces:**
- Consumes: Existing `TaskStatus`, Status filter, persisted Tasks column-width
  map, and `dueDateLabel`.
- Produces: An independent resizable Status column and a single-line undated
  Due cell.

- [x] **Step 1: Add focused failing component tests**

Assert the desktop header order is Company, Task, Status, Pipeline, Stages,
Owner, Due, Actions; the status filter occupies the Status column; the Task
cell does not contain the status badge; the Status cell does; and an undated
task does not render `Unscheduled`.

- [x] **Step 2: Verify the focused tests fail for the expected structure**

Run:
`npx.cmd vitest run src/components/tasks/__tests__/task-components.test.tsx --exclude ".worktrees/**" --maxWorkers=1 --fileParallelism=false`

Expected: header order, status-cell ownership, total width, and undated Due
expectations fail against the seven-column table.

- [x] **Step 3: Add Status to the persisted column model**

Insert `status` after `task` in `TASK_COLUMN_IDS`, add label and width entries,
leave the Task filter header empty, and render the existing Status
`SearchableSelect` in the new Status filter header.

- [x] **Step 4: Move the badge and suppress redundant Due detail**

Render the task title alone in the Task cell, render the existing status badge
in the new Status cell, and omit the secondary Due paragraph only when
`due.detail === 'Unscheduled'`.

- [x] **Step 5: Run focused verification**

Run the two Tasks component test files, focused ESLint for changed files, and
`git diff --check`. Do not run the full suite or production build.

**Implementation record:** Status is now an independent 130px default-width
column in the persisted Tasks column model, with its own inline filter and
resize handle. Desktop Task cells contain the title only. Undated Due cells
display `No due date` without `Unscheduled`; dated due-state subtext remains.
An isolated TaskList test file verifies these behaviors because concurrent
unrelated JSX edits in `task-stage-modal.tsx` prevent the combined Tasks test
files from transforming.

---

### Task 11: Extend header bands without stretching the table

**Files:**
- Modify: `src/components/tasks/task-list.tsx`
- Modify: `src/components/tasks/__tests__/task-list.test.tsx`

**Interfaces:**
- Consumes: The existing summed `tableWidth`, 56px filter row, 38px column
  header row, and horizontal table container.
- Produces: Fixed-width columns with decorative filter/header bands extending
  across unused container space.

- [x] **Step 1: Add a focused failing width assertion**

Assert the table uses the exact summed `width: 1422px` and `min-width: 1422px`
without `w-full`. Assert two absolutely positioned, full-container background
bands exist behind the table and the scroll container is positioned.

- [x] **Step 2: Verify the isolated TaskList test fails**

Run:
`npx.cmd vitest run src/components/tasks/__tests__/task-list.test.tsx --exclude ".worktrees/**" --maxWorkers=1 --fileParallelism=false`

Expected: the table still has `w-full` and the decorative bands are absent.

- [x] **Step 3: Restore fixed width and add decorative bands**

Restore `${tableWidth}px` as both `width` and `minWidth`. Add a 56px
filter-row band and a 38px column-header band as absolute inset layers inside
the positioned scroll container. Place the table above the bands and give both
header rows matching explicit heights. Do not add a filler column.

- [x] **Step 4: Run focused verification**

Run the isolated TaskList test, focused ESLint for the source and test, and a
scoped `git diff --check`. Do not run the full suite or production build.

**Implementation record:** The rejected `w-full` behavior was removed. The
table again uses exact summed pixel widths. A 56px filter band and 38px column
header band now extend across the positioned scroll container behind the
table; both are absolute, pointer-inert, and excluded from layout and scroll
width.

---

### Task 12: Match the filter-band colour composition

**Files:**
- Modify: `src/components/tasks/task-list.tsx`
- Modify: `src/components/tasks/__tests__/task-list.test.tsx`

**Interfaces:**
- Consumes: The existing 94px two-row header area and the table's tertiary
  `thead` background.
- Produces: A complete filter/header design across unused container space
  without changing column or scroll width.

- [x] **Step 1: Add a focused failing layer assertion**

Assert that the full 94px extension uses the tertiary header background and
that the 56px translucent filter surface is painted after it.

- [x] **Step 2: Verify the isolated TaskList test fails**

Run:
`npx.cmd vitest run src/components/tasks/__tests__/task-list.test.tsx --exclude ".worktrees/**" --maxWorkers=1 --fileParallelism=false`

Expected: the two separate bands do not reproduce the filter row's layered
background in the unused space.

- [x] **Step 3: Correct the decorative layer stack**

Use a 94px tertiary base behind both rows and place the 56px translucent
secondary filter band over its top portion. Keep the table above both bands
and retain its exact summed pixel width.

- [x] **Step 4: Run focused verification**

Run the isolated TaskList test, focused ESLint, and a scoped
`git diff --check`. Do not run the full suite or production build.

**Implementation record:** The header extension now uses a 94px tertiary base
matching the table's `thead`, with the translucent 56px filter surface layered
over it. The fixed-width table remains above both pointer-inert layers, so the
decoration neither changes column widths nor contributes to horizontal
overflow.

---

### Task 13: Extend the task-list filter contract

**Files:**
- Modify: `src/hooks/use-tasks.ts`
- Modify: `src/lib/validations/task-api.ts`
- Modify: `src/app/api/tasks/route.ts`
- Modify: `src/services/tasks/task.service.ts`
- Test: `src/services/tasks/__tests__/task-list-filters.test.ts`

**Interfaces:**
- Consumes: Existing `TaskListParams`, `taskListQuerySchema`, and
  `searchTasks(tenantId, options)`.
- Produces: Optional `title`, `ownerQuery`, `dueDateFrom`, and `dueDateTo`
  list parameters carried from the browser to Prisma filtering.

- [x] **Step 1: Write failing query-contract tests**

Cover schema acceptance of trimmed title/owner text and ISO dates, URL
serialization under `title`, `ownerQuery`, `dueDateFrom`, and `dueDateTo`, and
service filtering of task title, owner name/email, and an inclusive date range.

- [x] **Step 2: Run the focused contract tests and verify RED**

Run the new task-list filter test plus the existing Tasks route/component
contracts. Expected: new fields are absent from the types, route parser, and
Prisma `where` input.

- [x] **Step 3: Implement the minimal query contract**

Add the four optional fields to `TaskListParams`, `taskListUrl`,
`taskListQuerySchema`, the Tasks GET route, and `SearchTasksOptions`. Compose
title and owner matching as additional `AND` clauses so they remain compatible
with the global `OR` search. Build an inclusive due range using `gte` at the
start date and `lt` at the day after the selected end date.

- [x] **Step 4: Verify GREEN**

Run only the new focused service/contract tests and existing Tasks component
tests affected by the type change.

### Task 14: Reuse Document Vault filter controls in Tasks

**Files:**
- Modify: `src/components/tasks/task-filters.tsx`
- Modify: `src/components/tasks/task-list.tsx`
- Modify: `src/components/tasks/task-workspace.tsx`
- Test: `src/components/tasks/__tests__/task-components.test.tsx`
- Test: `src/components/tasks/__tests__/task-list.test.tsx`
- Test: `src/components/tasks/__tests__/task-workspace.test.tsx`

**Interfaces:**
- Consumes: The Task 13 list parameters, current session user ID,
  `DatePicker`, and existing shared active-filter chips.
- Produces: Alternating rows, Task/Owner text inputs, Due range picker, and
  task quick-filter toggles.

- [x] **Step 1: Write failing component tests**

Assert alternating `bg-oak-row-alt` rows; Task and Owner textboxes placed in
their matching header cells; an `All dates` Due picker; and the three toolbar
buttons. Exercise text changes and quick toggles against `onFiltersChange` or
the mocked `useTasks` hook.

- [x] **Step 2: Run the isolated component tests and verify RED**

Run only the three Tasks component test files. Expected: Task/Owner cells are
empty or select-based, Due is a searchable select, quick buttons are absent,
and body rows lack the alternate-row class.

- [x] **Step 3: Implement Document Vault patterns**

Add a reusable compact inline text field inside `task-list.tsx`; mount it under
Task and Owner; replace Due's searchable select with `DatePicker` range mode;
and apply Document Vault's alternate-row classes by data-row index. Expand
`TaskFilters` into the bordered toolbar and add toggle buttons for current
user ownership, `thisWeek`, and `IN_PROGRESS`.

- [x] **Step 4: Keep badges and filters synchronized**

Add Task, Owner, and due-range badges. Ensure Due range selection clears
`dueBucket`, the due shortcut clears date range, and `Clear all` preserves only
page size.

- [x] **Step 5: Run focused verification**

Run the affected Tasks tests, focused ESLint, and scoped `git diff --check`.
Do not run the full suite or production build.

**Implementation record:** The task list now carries title, owner-text, and
inclusive due-range parameters through validation, URL serialization, and
Prisma filtering. The desktop table uses Document Vault's compact text/date
controls and alternate-row surface. The global toolbar exposes synchronized
ownership, due-week, and in-progress shortcuts, and all new filters participate
in active badges and `Clear all`.

---

### Task 15: Open the next incomplete stage from a task row

**Files:**
- Modify: `src/components/tasks/task-list.tsx`
- Test: `src/components/tasks/__tests__/task-components.test.tsx`

**Interfaces:**
- Consumes: `TaskListItem.stages`, `TaskStageSummary.position`,
  `TaskStageSummary.status`, and the existing
  `onSelectStage(task, stage): void` callback.
- Produces: Deferred desktop row navigation that selects the first ordered
  stage not in `COMPLETED` or `SKIPPED`.

- [x] **Step 1: Write the failing row-navigation tests**

Render a task whose stages are deliberately out of order and include completed,
skipped, and incomplete statuses. Click its desktop row, advance the deferred
click timer, and assert `onSelectStage` receives the lowest-position incomplete
stage. Render a fully complete task and assert no selection occurs. Click a
stage button and an Actions trigger and assert neither schedules row navigation.

- [x] **Step 2: Verify the isolated tests fail**

Run:
`npx.cmd vitest run src/components/tasks/__tests__/task-components.test.tsx --exclude ".worktrees/**" --maxWorkers=1 --fileParallelism=false`

Expected: desktop rows have no navigation handler.

- [x] **Step 3: Implement deferred row navigation**

Add a task-list helper that sorts stages by position and returns the first stage
whose status is not `COMPLETED` or `SKIPPED`. Store one timeout ref in
`TaskList`, schedule selection after approximately 500ms from a desktop row
click, and clear the timer on unmount. Ignore events whose target is inside a
button, input, select, link, menu trigger, resize separator, or inline editor.
Give navigable rows pointer treatment without changing alternate-row colours.

- [x] **Step 4: Verify GREEN**

Run the isolated TaskList/component test file and confirm row selection,
completed-row behavior, and interactive-target exclusions pass.

### Task 16: Edit task metadata inline on double-click

**Files:**
- Create: `src/components/tasks/task-inline-editor.tsx`
- Modify: `src/components/tasks/task-list.tsx`
- Modify: `src/components/tasks/task-workspace.tsx`
- Test: `src/components/tasks/__tests__/task-components.test.tsx`
- Test: `src/components/tasks/__tests__/task-workspace.test.tsx`

**Interfaces:**
- Consumes: Existing `TaskUpdatePayload`,
  `useUpdateTask().mutateAsync({ id, payload })`,
  `TaskStatusAction`, Company/Owner options, `SearchableSelect`, and
  `DatePicker`.
- Produces: `TaskInlineEditor` plus
  `onUpdateMetadata(task, payload): Promise<void>` on `TaskList`.

- [x] **Step 1: Write failing double-click and save tests**

Assert double-clicking Company, Task, Status, Owner, and Due cells opens the
matching editor and cancels pending row navigation. For Task, change the text,
blur, and assert one `{ title }` metadata save. Assert Escape cancels without a
save. For Company/Owner/Due, commit a value or clear it and assert the existing
payload shapes `{ companyId }`, `{ ownerId }`, and `{ dueDate }`. Assert Status
offers Pause/Cancel for active tasks and Resume/Cancel for paused tasks, but no
arbitrary completed option.

- [x] **Step 2: Verify the focused tests fail**

Run the two affected Tasks component test files. Expected: metadata cells do not
handle double-click and `TaskList` has no inline metadata callback.

- [x] **Step 3: Build the isolated editor**

Create `TaskInlineEditor` with field-specific renderers:

- Company and Owner: table-style `SearchableSelect` with null choices.
- Task: auto-focused required text input; blur commits, Enter blurs, Escape
  cancels.
- Due: shared `DatePicker` in single-date mode with clear support.
- Status: action buttons/select containing only Pause/Resume and Cancel.

Use an internal in-flight guard so blur/Enter cannot submit twice. If
`onSaveMetadata` rejects, keep the editor mounted, retain its value, and render
a concise `role="alert"` message.

- [x] **Step 4: Integrate editors with row click arbitration**

Track one `{ taskId, field }` editing cell in `TaskList`. Metadata-cell
double-click handlers stop propagation, cancel the pending single-click timer,
and open the editor. Successful saves close it. Status actions close the editor
and call the existing status handler so cancellation retains its confirmation
dialog. Mark editor roots with `data-task-inline-editor`.

- [x] **Step 5: Connect the existing mutation**

Pass `onUpdateMetadata` from `TaskWorkspace` to `TaskList` and implement it with
`updateTask.mutateAsync({ id: task.id, payload })`. Do not add or change an API
route.

- [x] **Step 6: Run focused verification**

Run the affected Tasks component tests, focused ESLint for changed source/test
files, and scoped `git diff --check`. Do not run the full suite or production
build.

**Implementation record:** Desktop row clicks now defer briefly and open the
first position-ordered stage that is neither completed nor skipped, while
interactive descendants are excluded. The deferral covers the normal desktop
double-click window so a slower valid double-click cannot open a stage first.
Double-clicking Company, Task, Status, Owner, or Due cancels pending navigation
and mounts an isolated inline editor.
Metadata uses the existing update mutation, status uses the existing guarded
actions and cancellation confirmation, and save failures retain the editor with
cell-level feedback. Escape cancels every editor; outside click or focus
dismisses non-text editors while portalled select and date-picker interactions
remain inside the editor. The shared date picker's clear control now has an
accessible name.
