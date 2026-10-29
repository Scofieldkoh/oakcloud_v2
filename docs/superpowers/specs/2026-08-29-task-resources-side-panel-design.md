# Task Resources Side Panel Design

Date: 2026-08-29

## Goal

Add a right-hand resources panel to the task-stage modal. The panel gives the operator a complete, up-to-date view of the task, every stage, and the records produced or linked by those stages.

The existing stage workflow remains the primary content area. The new panel is supporting context and must not change the current stage action behavior.

## Scope

In scope:

- A task-scoped aggregated read endpoint for task metadata, all stages, and linked resources.
- Company name, UEN, and an internal company link.
- Generated-document name/status, internal document link, and PDF download link.
- E-signing envelope status, attached-document filenames/links, and signer details.
- A permissioned action to generate and copy an active signer’s manual signing link.
- Loading, pending, unavailable, and partial-error states as records become available.
- Responsive two-column modal layout that stacks on small screens.
- Refreshing resources after task mutations and while external processing is pending.

Out of scope:

- Editing company, document, or e-signing records from the panel.
- Showing the complete e-signing event log, field definitions, or field values.
- Automatically generating signer links when the modal is opened.
- Discovering unrelated documents or envelopes that are not linked to the task’s stage outcomes.

## Recommended architecture

Add an authenticated endpoint:

`GET /api/tasks/:taskId/resources`

The endpoint is task-specific rather than part of the task list response. It verifies task access, loads the task and its stages in one tenant-scoped query, and returns a deliberately small presentation contract. Resource records are projected by type so future resource types can be added without expanding the task list DTO.

The response must contain:

```ts
interface TaskResourcesResponse {
  task: {
    id: string;
    title: string;
    status: TaskStatus;
    dueDate: string | null;
    company: {
      id: string;
      name: string;
      uen: string;
      href: string;
    } | null;
    owner: { id: string; name: string; email: string } | null;
    pipelineName: string;
  };
  stages: TaskResourceStage[];
}

interface TaskResourceStage {
  id: string;
  name: string;
  position: number;
  actionType: string;
  status: string;
  description: string | null;
  notes: string | null;
  startedAt: string | null;
  completedAt: string | null;
  assignee: { id: string; name: string; email: string } | null;
  checklist: { label: string; isCompleted: boolean }[];
  blockers: { code: string; message: string }[];
  resources: TaskResource[];
}
```

Each `TaskResource` must include a stable `kind`, `state` (`available`, `pending`, or `unavailable`), a display label, and only the fields needed by the panel. It also includes an optional human-readable `reason` for pending/unavailable states and a `capabilities` object for actions that depend on resource permissions.

The service should be isolated in `src/services/tasks/resources.service.ts`, with the route adapter in `src/app/api/tasks/[taskId]/resources/route.ts`. The client contract belongs in the task service types and is consumed through `src/hooks/use-task-resources.ts`.

The resource projections are:

- `company`: `id`, `name`, `uen`, and `/companies/:id`.
- `generatedDocument`: `id`, `title`, `status`, `/generated-documents/:id`, and `/api/generated-documents/:id/export/pdf`.
- `esigningEnvelope`: `id`, `title`, `status`, signature counts, expiry, `/esigning/:id`, attached documents containing filename plus original/signed PDF links, and signer summaries containing recipient ID, name, email, signing status, and signing-order information.

Envelope document links use the existing authenticated routes: `/api/esigning/envelopes/:envelopeId/documents/:documentId/pdf` for the original file and `/api/esigning/envelopes/:envelopeId/documents/:documentId/signed-pdf` when the signed artifact exists.

Generated documents do not persist a separate PDF filename. The persisted document title is the panel’s document name. The API will also return `downloadFileName`, calculated by a shared filename helper using the same title/date rules as the existing PDF export route. The panel displays both the document title and the download filename, and the export route uses that same helper so the label and downloaded file stay consistent.

## Signer-link security

The aggregate read response must never create or return raw signer URLs. Existing signer-link creation is a permissioned POST action and writes an audit record, so the panel will use that existing route through the existing hook when the operator chooses “Get signing link”.

The e-signing projection includes `canGenerateSignerLink`, calculated from the current actor scope. The panel exposes the action only when that capability is true. For signers whose link is not active, it shows the reason (for example, not yet notified, signed, or declined). Once the action succeeds, the returned URL is held in the panel state for copying/opening and is not persisted in the task resource response.

If the operator can read tasks but lacks a resource-specific permission, the rest of the panel still renders. The affected resource is represented as unavailable without leaking cross-module data.

## Data flow and freshness

`TaskWorkspace` will load `useTaskResources(selectedTaskId, isModalOpen)`. The query is enabled only when a task-stage modal is open. It fetches on open, uses a short stale time, and is invalidated after metadata updates, stage transitions, and BizFile review actions.

When any stage resource is pending (document generation, e-sign preparation, or envelope processing), the query refetches every 10 seconds. Polling stops when all resources are terminal, the modal closes, or the request fails. The query uses a 15-second stale time, and a manual retry action is available for an aggregate request failure.

Resource links use the existing internal routes and include the task launch context. They open in a new tab with `rel="noreferrer"`, preserving the operator’s current modal state while retaining a return path to the task where the destination supports it.

## UI composition

Update `PipelineStageModalFrame` to provide a responsive grid:

- Left column: the current stage action content and existing footer controls.
- Right column: a bounded, independently scrollable `TaskResourcesPanel` exactly 22rem wide on large screens, with `max-height: calc(100dvh - 12rem)`.

The panel contains:

1. A compact task summary with status, due date, owner, and linked company/UEN.
2. An ordered stage timeline. Each stage shows status, assignee, timestamps, checklist progress, notes/blockers when present, and its resource cards.
3. Resource cards with type icon, name, status badge, available links, and pending/unavailable explanations. E-signing cards include their attached-document filenames and original/signed PDF actions.

The active stage is visually emphasized. Stage rows are informational and do not change the selected stage; existing footer Previous/Next controls remain the only stage-navigation controls in this modal.

On screens below the large breakpoint, the panel appears below the stage content as a full-width section with `max-height: 50dvh` and its own scroll area. The panel must retain keyboard focus visibility, accessible labels, touch-sized actions, and the compact spacing defined by the application design guide.

## Error handling

- A task-level authorization or not-found failure prevents the panel query from rendering and shows a retryable inline error.
- A missing or deleted linked record becomes an unavailable resource; it must not fail the entire task response.
- A document or e-signing service failure is isolated to that resource and displayed with a short retry/unavailable message.
- Signer-link creation errors remain local to the signer card and must not clear the other panel data.
- No raw backend error, access token, or tenant identifier is rendered to the user.

## Testing

Add or update tests for:

- The resources service returning all stages in position order with task, company, generated-document, envelope-document, and signer projections.
- Tenant isolation and task authorization.
- Partial resource availability and missing/deleted linked records.
- Permission-based suppression of resource data and signer-link actions.
- The signer-link action using the existing POST route and rendering copy/open behavior only after success.
- The modal layout rendering the panel, stage groups, generated-document links, e-signing document links, company UEN, signer summaries, pending states, and retry states.
- Query invalidation/refetch behavior after stage transitions and while resources are pending.

Verification should include the focused task component/API tests, TypeScript checking, linting for changed files, and a browser interaction check for the modal at desktop and narrow widths.

## Acceptance criteria

- Opening any task stage shows a right-side task resources panel in the modal.
- The panel lists every stage in pipeline order, including stage status and available stage information.
- A linked company shows its name, UEN, and an internal hyperlink.
- Generated documents show their persisted name/title, current status, an internal document hyperlink, and a PDF download action when readable.
- E-signing stages show envelope status, attached-document filenames and original/signed PDF links, and signer details as they become available.
- Active signer links can be generated and copied only by authorized users through the existing audited action.
- New or completed resources appear after refresh/refetch without requiring a full page reload.
- Missing or unauthorized resources do not blank the rest of the panel.
- The panel works at desktop and narrow viewport widths without breaking existing stage actions.
