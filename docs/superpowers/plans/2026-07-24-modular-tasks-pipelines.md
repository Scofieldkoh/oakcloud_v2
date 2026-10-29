# Modular Tasks and Onboarding Pipelines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:test-driven-development` for every behavior change. Work only in the assigned worktree. Run focused tests for the assigned task; the controller will run the full suite after all tasks.

**Goal:** Replace the legacy Workflow/Projects module with tenant-scoped, versioned task pipelines that orchestrate the existing Company, Document Generation, and E-signing workspaces.

**Architecture:** Immutable pipeline versions are snapshotted into task stages. A stage-action registry owns validation, blockers, launch context, outcome summaries, and derived status while existing modules remain authoritative for their records.

**Tech Stack:** Next.js 15, React 19, TypeScript, Prisma 7/PostgreSQL, TanStack Query, Zod, Lucide React, Tailwind CSS, Vitest, Testing Library.

## Global Constraints

- Work only in `C:\Users\Scotfield\OneDrive\Documents\Python Project\oakcloud_development\oakcloud\.worktrees\modular-tasks-pipelines`.
- Delete the legacy Workflow/Projects module and all `workflow_*` data without migration, redirects, or compatibility behavior.
- Preserve all CRM, generated-document, and E-signing data and existing behavior outside the retired module.
- Desktop Tasks columns are exactly Company, Task, Stages, Owner, Due, Actions.
- The entire table container scrolls horizontally; the Stages cell never has a nested scrollbar and renders every stage icon.
- Task creation requires only title and pipeline. Company, owner, due date, and stage assignee are optional.
- Pipeline template edits affect future tasks only; existing task stage structure is immutable.
- Pipeline colours are system-controlled by status. Users choose from curated Lucide outline icons.
- Existing module permissions remain authoritative.
- Notifications, external document collection, branching, conditional automation, per-stage due dates, and live-task structural customization are out of scope.
- Update existing documentation under `docs/`; do not create documentation outside that directory.

---

### Task 1: Replace the legacy database model

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260724090000_modular_tasks_reset/migration.sql`
- Modify: `src/services/contact-merge.service.ts`
- Modify: `src/services/contact-duplicate.service.ts`
- Delete: `src/generated/prisma/models/workflow_*.ts` through Prisma regeneration, not manual generated-file editing
- Test: `__tests__/services/task-schema-reset.test.ts`

**Requirements:**

- First add a failing schema/source contract test proving no `model workflow_*`, workflow relations, workflow service references, or legacy workflow counters remain and all new task models/enums exist.
- Remove every legacy `workflow_*` Prisma model, enum, and relation from Tenant, User, Company, Contact, Document, GeneratedDocument, DocumentTemplate, and E-signing models.
- Add `TaskPipeline`, `TaskPipelineVersion`, `TaskPipelineStage`, `Task`, `TaskStage`, `TaskStageChecklistItem`, and `TaskStageOutcome`.
- Add enums `TaskStatus`, `TaskStageStatus`, `TaskStageActionType`, and `TaskStageOutcomeType`.
- Use tenant-scoped indexes, immutable pipeline version numbers, ordered stages, optional task company/owner/due date, optional stage assignee, soft deletion for tasks/pipelines, and `onDelete: SetNull` outcome links.
- `TaskStageOutcome` has nullable foreign keys for Company, GeneratedDocument, and EsigningEnvelope; the service layer will enforce exactly one matching link.
- Migration drops every legacy `workflow_*` table and creates all new enums, tables, constraints, and indexes.
- Remove legacy workflow counts and updates from contact merge/duplicate services without changing non-workflow behavior.
- Regenerate Prisma and run only focused schema/contact tests.

### Task 2: Implement domain services and the stage-action registry

**Files:**
- Create: `src/services/tasks/types.ts`
- Create: `src/services/tasks/status.ts`
- Create: `src/services/tasks/pipeline.service.ts`
- Create: `src/services/tasks/task.service.ts`
- Create: `src/services/tasks/stage.service.ts`
- Create: `src/services/tasks/action-registry.ts`
- Create: `src/services/tasks/index.ts`
- Create: `src/lib/validations/task-pipeline.ts`
- Create: `src/lib/validations/task.ts`
- Test: `__tests__/services/task-status.test.ts`
- Test: `__tests__/services/task-pipeline.service.test.ts`
- Test: `__tests__/services/task-stage-registry.test.ts`

**Requirements:**

- Write failing tests first for status derivation, fixed snapshots, optional fields, versioned pipeline edits, required/optional skip rules, and registry blockers.
- Implement tenant-aware pipeline list/create/get/versioned-update/duplicate/archive services.
- Creating a task transactionally copies the selected immutable pipeline version and checklist definitions into live task stages/items.
- Derive overall status as NOT_STARTED, IN_PROGRESS, or COMPLETED unless PAUSED/CANCELLED is an explicit override.
- Support task metadata updates, soft deletion with reason, pause/resume/cancel, stage notes/assignee/checklist edits, manual completion/reopen, optional skip with mandatory reason, and outcome reconciliation.
- Registry adapters: MANUAL, COMPANY_PROFILE, DOCUMENT_GENERATION, ESIGNING.
- Registry returns configuration parsing, curated/default icon, blockers, launch href/context, outcome summary, and derived status.
- Company completes when linked; generated document is IN_PROGRESS until FINALIZED; E-signing is IN_PROGRESS until all required signatures complete and FAILED for declined/expired/cancelled terminal outcomes.
- Enforce tenant isolation, adapter/action match, exactly one outcome entity, and underlying record existence.
- Use OakCloud audit helpers for every mutation and safe logger/error patterns.

### Task 3: Add HTTP APIs, shared client types, and query hooks

**Files:**
- Create: `src/app/api/task-pipelines/route.ts`
- Create: `src/app/api/task-pipelines/[id]/route.ts`
- Create: `src/app/api/task-pipelines/[id]/duplicate/route.ts`
- Create: `src/app/api/tasks/route.ts`
- Create: `src/app/api/tasks/[id]/route.ts`
- Create: `src/app/api/tasks/[id]/status/route.ts`
- Create: `src/app/api/tasks/[taskId]/stages/[stageId]/route.ts`
- Create: `src/app/api/tasks/[taskId]/stages/[stageId]/transition/route.ts`
- Create: `src/hooks/use-task-pipelines.ts`
- Create: `src/hooks/use-tasks.ts`
- Test: `__tests__/api/tasks-api.test.ts`

**Requirements:**

- Add failing route/validation tests before implementation.
- Implement the exact APIs from the approved plan with `requireAuth`, workspace resolution, Zod parsing, tenant-aware services, safe error responses, and existing task/module permission conventions.
- Task list supports query, pipeline, company, owner, status, due bucket, pagination, and sorting. Missing due dates never count as overdue or within due buckets.
- Export shared public types for statuses, action types, launch context, blockers, outcome summaries, pipeline payloads, task list responses, and stage detail.
- TanStack Query hooks provide list/detail/create/update/duplicate/archive/status/transition mutations with narrow invalidation.
- No legacy `/workflow/*` API remains.

### Task 4: Connect authoritative Company, Document, and E-signing workspaces

**Files:**
- Modify existing Company creation/BizFile entry points and services that finalize a created/selected Company.
- Modify existing generated-document creation/finalization entry points and services.
- Modify existing E-signing envelope creation/status lifecycle services.
- Create: `src/services/tasks/integration.service.ts`
- Test: `__tests__/services/task-module-integrations.test.ts`

**Requirements:**

- Define validated optional `TaskLaunchContext { taskId, taskStageId, returnTo }`; requests without it retain current behavior.
- Company stage modal can link an existing company. Manual Company creation and BizFile flows preserve task context and link the authoritative Company after success.
- Document Generation preserves context; creating/linking a draft marks the stage IN_PROGRESS and finalizing it marks COMPLETED.
- E-signing preserves context; envelope creation/sending marks IN_PROGRESS, all required signatures mark COMPLETED, and declined/expired/cancelled mark FAILED.
- E-signing defaults to the finalized contract linked by the document stage but permits another eligible finalized document.
- Reconciliation runs after relevant service mutations and on stage/task detail reads so missed callbacks self-heal.
- Never duplicate Company, GeneratedDocument, or EsigningEnvelope business data in Tasks.

### Task 5: Build the Pipelines workspace

**Files:**
- Create: `src/app/(dashboard)/pipelines/page.tsx`
- Create: `src/app/(dashboard)/pipelines/new/page.tsx`
- Create: `src/app/(dashboard)/pipelines/[id]/page.tsx`
- Create focused components under `src/components/tasks/pipelines/`
- Test: `__tests__/components/task-pipeline-builder.test.tsx`

**Requirements:**

- Write failing component tests before UI implementation.
- Build responsive pipeline list with create, duplicate, edit, and archive actions.
- Builder edits name/description and ordered stage cards using existing `@dnd-kit` dependencies.
- Add/edit/remove/reorder stages; configure action type, curated searchable Lucide icon, required/optional, description, checklist, and adapter-specific configuration.
- Document Generation supports an optional default template changeable at runtime.
- Validate before save; saving an edit creates a new version for future tasks.
- Follow `docs/guides/DESIGN_GUIDELINE.md`, existing OakCloud controls, keyboard access, dark theme, mobile touch targets, and React performance guidelines.

### Task 6: Build the Tasks workspace and stage modal

**Files:**
- Create: `src/app/(dashboard)/tasks/page.tsx`
- Create focused components under `src/components/tasks/`
- Modify: `src/components/ui/Sidebar.tsx`
- Delete: `src/app/(dashboard)/workflow/`
- Delete: `src/app/api/workflow/`
- Delete: `src/components/workflow/`
- Delete: `src/hooks/use-workflow-projects.ts`
- Delete: `src/hooks/use-workflow-project-detail.ts`
- Delete: `src/services/workflow-project.service.ts`
- Test: `__tests__/components/tasks-workspace.test.tsx`
- Test: `__tests__/components/task-stage-modal.test.tsx`

**Requirements:**

- Write failing tests for the exact column order, whole-table horizontal scroll, stage icon accessibility, modal states, optional task fields, and mobile cards.
- Desktop table columns are Company, Task, Stages, Owner, Due, Actions.
- All icons render inline; horizontal overflow belongs only to the table container.
- Task create modal requires title and pipeline only. Company, owner, and due date are optional.
- Add filters for query, pipeline, company, owner, derived status, and due bucket.
- Stage icons use curated Lucide outline icons plus non-colour markers and fixed pastel grey/blue/amber/green/muted/red status treatments.
- Centered modal shows description/status, optional assignee, checklist, notes, outcome, activity timestamps, blockers, and exactly one primary action.
- Row actions: edit metadata, pause/resume, cancel, and soft-delete with reason.
- Mobile uses existing responsive card conventions.
- Sidebar contains top-level Tasks and Pipelines destinations and no Workflow/Projects group.
- Do not add legacy redirects or compatibility routes.

### Task 7: Seed onboarding, document, and verify the assembled feature

**Files:**
- Modify: `prisma/seed.ts`
- Modify existing relevant files under `docs/`, including `docs/INDEX.md`, `docs/reference/API_REFERENCE.md`, and `docs/reference/DATABASE_SCHEMA.md`
- Test: add or update focused onboarding and browser tests in existing test locations

**Requirements:**

- Seed a versioned Client Onboarding pipeline with required Company Profile, Generate Contract, and E-signing stages.
- Use system status colours and curated Lucide icons; do not persist user-defined colours.
- Remove remaining legacy workflow references from source, tests, generated client, and docs.
- Update documentation for routes, APIs, schema, status rules, module reuse, and the complete reset.
- Run Prisma generation and migration validation.
- Run all focused tests, then the full Vitest suite, browser suite, TypeScript, ESLint, and production build.
- Use the accepted visual companion concept as the fidelity reference: compact table, Company-first columns, centered stage modal, pastel semantic status surfaces, and Lucide outline icons.
- Verify desktop and mobile core flows in the browser and record any intentional deviation.

