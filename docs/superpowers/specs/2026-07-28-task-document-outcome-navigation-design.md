# Task Document Outcome Navigation Design

## Goal

Make the **Generate Document** action in a task stage reopen the document already linked to that stage once generation has started, rather than launching another new document-generation session.

## Behavior

Navigation is determined by the document-generation stage status and its linked generated-document outcome:

- A `NOT_STARTED` stage, or a stage without a linked generated document, opens the existing new-document route. Its configured template and task company remain preselected.
- An `IN_PROGRESS` stage with a linked generated document resumes that generation session at `/generated-documents/generate?draft=<documentId>`.
- A `COMPLETED` stage with a linked generated document opens the finalized document at `/generated-documents/<documentId>`.

The task launch context continues to be appended by the existing task UI so the destination receives `taskId`, `taskStageId`, and the `/tasks` return URL.

## Architecture

The routing decision belongs in the document-generation adapter in `src/services/tasks/action-registry.ts`. The registry is already the authoritative source for integrated task-stage launch destinations, and both task-stage displays consume its result.

The adapter will inspect the stage status and `outcome.generatedDocumentId` before building a new-document URL:

1. If a linked document ID exists and the stage is `COMPLETED`, return the document detail route.
2. If a linked document ID exists and the stage is `IN_PROGRESS`, return the generation route with that ID as the `draft` parameter.
3. Otherwise, retain the current new-document URL with optional `templateId` and `companyId`.

No document lookup is added to the client, and no routing logic is duplicated in the task modal.

## Fallback and Error Handling

A status without a usable linked generated-document ID falls back to the current new-document route. This keeps malformed or partially recovered task data navigable while existing outcome reconciliation remains responsible for repairing authoritative links.

Statuses outside `IN_PROGRESS` and `COMPLETED` also retain the existing new-document behavior unless their lifecycle is defined separately in a future change.

## Testing

Registry-level tests will verify:

- `NOT_STARTED` launches a fresh generator with configured template and linked task company.
- `IN_PROGRESS` with a generated-document outcome resumes that exact draft.
- `COMPLETED` with a generated-document outcome opens that exact document.
- An in-progress or completed stage missing a linked document ID safely falls back to a fresh generator.

The focused registry test suite and relevant task component tests will be run after implementation.
