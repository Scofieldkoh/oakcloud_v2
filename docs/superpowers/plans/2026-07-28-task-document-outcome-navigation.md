# Task Document Outcome Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make task document-generation stages resume or open their linked document instead of starting a duplicate generation session.

**Architecture:** Keep the routing decision in the existing `DOCUMENT_GENERATION` action adapter. The adapter uses the stage status plus `outcome.generatedDocumentId`; the task UI continues appending task and return context to the adapter's returned URL.

**Tech Stack:** TypeScript, Prisma enums, Vitest

## Global Constraints

- Preserve the existing fresh-generation URL and its optional `templateId` and `companyId` parameters for stages without a usable linked document.
- Resume an `IN_PROGRESS` linked generation session with the `draft` query parameter.
- Open a `COMPLETED` linked generated document through its detail route.
- Preserve unrelated working-tree edits already present in both target files.
- Update existing documentation under `docs/`; do not create documentation outside that directory.

---

### Task 1: Route Generate Document stages to their linked outcome

**Files:**
- Modify: `__tests__/services/task-stage-registry.test.ts`
- Modify: `src/services/tasks/action-registry.ts`

**Interfaces:**
- Consumes: `StageActionAdapter.launch(context: StageActionAdapterContext): StageActionLaunch`
- Produces: state-aware `href` values for `TaskStageActionType.DOCUMENT_GENERATION`; no new public interface

- [x] **Step 1: Write failing registry tests**

Add focused cases after the existing test named `passes the linked task company into the document generation workspace`:

```ts
it.each([
  {
    status: TaskStageStatus.IN_PROGRESS,
    expectedHref:
      '/generated-documents/generate?draft=33333333-3333-4333-8333-333333333333',
  },
  {
    status: TaskStageStatus.COMPLETED,
    expectedHref:
      '/generated-documents/33333333-3333-4333-8333-333333333333',
  },
])('opens the linked document when a generation stage is $status', ({
  status,
  expectedHref,
}) => {
  const adapter = getStageActionAdapter(TaskStageActionType.DOCUMENT_GENERATION);

  expect(adapter.launch({
    tenantId: 'tenant-a',
    stage: {
      id: 'stage-2',
      tenantId: 'tenant-a',
      taskId: 'task-1',
      actionType: TaskStageActionType.DOCUMENT_GENERATION,
      actionConfig: {},
      status,
      outcome: {
        type: 'GENERATED_DOCUMENT',
        generatedDocumentId: '33333333-3333-4333-8333-333333333333',
      },
    },
  })).toEqual({
    href: expectedHref,
    context: { taskId: 'task-1', taskStageId: 'stage-2' },
  });
});

it('falls back to a fresh generator when an active stage has no linked document', () => {
  const adapter = getStageActionAdapter(TaskStageActionType.DOCUMENT_GENERATION);

  expect(adapter.launch({
    tenantId: 'tenant-a',
    stage: {
      id: 'stage-2',
      tenantId: 'tenant-a',
      taskId: 'task-1',
      actionType: TaskStageActionType.DOCUMENT_GENERATION,
      actionConfig: {
        templateId: '11111111-1111-4111-8111-111111111111',
      },
      status: TaskStageStatus.IN_PROGRESS,
      task: {
        companyId: '22222222-2222-4222-8222-222222222222',
      },
      outcome: null,
    },
  })).toEqual({
    href: '/generated-documents/generate?templateId=11111111-1111-4111-8111-111111111111&companyId=22222222-2222-4222-8222-222222222222',
    context: { taskId: 'task-1', taskStageId: 'stage-2' },
  });
});
```

These tests catch the regression where every stage status enters the fresh-generation branch, as well as the inverse bug where a missing outcome produces an invalid `draft` or document URL.

- [x] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
npm.cmd run test:run -- __tests__/services/task-stage-registry.test.ts
```

Expected: the `IN_PROGRESS` and `COMPLETED` cases fail because both receive `/generated-documents/generate`; the fallback and existing not-started cases pass.

- [x] **Step 3: Implement the minimal state-aware launch routing**

At the beginning of `documentAdapter.launch`, before parsing the new-document config, add:

```ts
const generatedDocumentId = (
  context.stage.outcome?.type === TaskStageOutcomeType.GENERATED_DOCUMENT
    ? context.stage.outcome.generatedDocumentId
    : null
);
if (generatedDocumentId && context.stage.status === TaskStageStatus.COMPLETED) {
  return launch(`/generated-documents/${generatedDocumentId}`, context);
}
if (generatedDocumentId && context.stage.status === TaskStageStatus.IN_PROGRESS) {
  return launch(configQuery('/generated-documents/generate', {
    draft: generatedDocumentId,
  }), context);
}
```

Leave the existing config parsing and new-document URL unchanged after these branches.

- [x] **Step 4: Run the focused registry regression test**

Run:

```powershell
npm.cmd run test:run -- __tests__/services/task-stage-registry.test.ts --exclude ".worktrees/**"
```

Expected: all registry tests in the active workspace pass with no new warnings or errors. The implementation does not change a UI component; component suites are intentionally omitted under the requested focused-testing constraint.

- [x] **Step 5: Check the exact patch**

Run:

```powershell
git diff --check -- src/services/tasks/action-registry.ts __tests__/services/task-stage-registry.test.ts
git diff -- src/services/tasks/action-registry.ts __tests__/services/task-stage-registry.test.ts
```

Confirm the new routing branches and tests are present without removing or rewriting pre-existing uncommitted edits in either file.

- [x] **Step 6: Commit only the new routing changes when they can be isolated safely**

Because both target files already contain unrelated uncommitted work, stage only the newly added test and implementation hunks. If those hunks cannot be isolated without staging another person's edits, leave the implementation unstaged and report that explicitly rather than committing unrelated changes.

Decision: leave the implementation unstaged so the existing edits in both files are not included in an unrelated commit.

Suggested commit:

```powershell
git commit -m "fix(tasks): reopen linked generated documents"
```
