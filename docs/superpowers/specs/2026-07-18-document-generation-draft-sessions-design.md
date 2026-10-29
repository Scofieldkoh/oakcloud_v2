# Document Generation Draft Sessions Design

## Scope

Replace the document-generation wizard's single automatically restored browser draft with explicit, server-backed draft sessions. Users can save multiple incomplete document-generation sessions, find them in the existing Generated Documents list, resume or discard each draft, and start a clean session whenever they click **Generate Document**.

This change uses the existing `GeneratedDocument` lifecycle and `DRAFT` status. It does not introduce a parallel draft entity or a separate draft list.

## Current Problem

The generation wizard currently writes one draft to `localStorage` and restores it whenever the generation route opens. Consequently, **Generate Document** can unexpectedly resume a prior session, only one session can be retained, and the saved state is tied to one browser rather than the authenticated workspace.

The existing `GeneratedDocument` model already supports multiple records with `DRAFT` status, workspace permissions, list filtering, audit history, and soft deletion. Reusing that model avoids duplicating document lifecycle behavior.

## Session Lifecycle

- **Generate Document** always opens a clean wizard and does not restore any previous state.
- **Save Draft** is available at every wizard step, including the untouched initial step.
- The first successful save creates a `GeneratedDocument` with `status: DRAFT` and generation-session metadata.
- Subsequent saves update the same record rather than creating more records.
- Starting another clean wizard and saving it creates another independent draft.
- Resuming a saved draft restores its exact wizard step and all still-valid inputs.
- Completing document generation updates the resumed draft record with rendered document content instead of creating a duplicate.
- Discarding a draft uses the existing soft-delete lifecycle and removes it from the normal list.

An incomplete draft without a user-supplied title uses `Untitled - [Template Name]` when a template is selected and `Untitled Document` otherwise. The fallback title can be replaced by the user later.

## Persistence Model

Each saved session is a normal `GeneratedDocument` record. Its `metadata` contains a versioned `generationSession` object with the incomplete wizard state, including:

- schema version;
- current wizard step;
- selected template, company, contacts, director, shareholder, and contact party;
- user-supplied title and whether the persisted title is only a fallback;
- custom placeholder values;
- letterhead choice;
- edited preview content and any corresponding structured content required by the editor;
- any other wizard input required to reproduce the session faithfully.

The session metadata is authoritative for wizard resumption. Generated document content remains authoritative after generation completes. Completion removes the active session marker or records the session as complete so the list no longer presents **Resume** for that record.

The metadata shape is versioned so the loader can reject or deliberately migrate incompatible future formats instead of silently restoring corrupt state.

## API and Service Boundaries

Dedicated generation-session operations will create, load, and update incomplete wizard drafts. They must not reuse `/api/generated-documents/[id]/draft`, which serves the separate generated-document editor auto-save flow.

The generation-session operations must:

- require authenticated workspace access and the corresponding document permission;
- enforce tenant isolation on every lookup and mutation;
- only resume or update records with `status: DRAFT` and active generation-session metadata;
- validate the versioned session payload at the API boundary;
- create an audit entry when a session is first saved and preserve the existing audit behavior for deletion and completed generation;
- update one existing record atomically when a resumed session is generated.

The existing generation service remains responsible for template validation, placeholder resolution, rendering, and generation diagnostics. It gains a path that writes the rendered result into an existing authorized draft record. A failed render must not partially convert or duplicate the saved session.

## Wizard UX

The wizard header includes a secondary **Save Draft** button on every step.

- Before the first save, the button reads **Save Draft**.
- During a request, it reads **Saving...** and cannot submit twice.
- After success, a compact last-saved indicator is shown.
- Save errors leave the session dirty, retain navigation protection, and display an error toast.
- The UI never reports a successful save before the server confirms it.

Once a draft has been saved, further changes mark it dirty again. Saving successfully resets the dirty baseline. A generation success also disables the warning before redirecting to the generated document.

## Generated Documents List

Saved wizard sessions appear in the existing Generated Documents list and participate in its current search, company, status, sorting, pagination, responsive table, and mobile card behavior.

Draft records with active generation-session metadata expose:

- **Resume**, which opens `/generated-documents/generate?draft=<id>`;
- **Discard**, which requires destructive-action confirmation and soft-deletes the record;
- the existing updated timestamp, allowing users to distinguish multiple drafts.

Generated `DRAFT` documents without active generation-session metadata continue to use the existing **Edit** action. **Resume** is reserved for incomplete wizard sessions, while **Edit** is reserved for already-generated document content.

Both list-level and empty-state **Generate Document** actions continue to open `/generated-documents/generate` without a draft identifier and therefore always start clean.

## Unsaved-Change Protection

Protection activates only after wizard state differs from the last successful server save, or from the clean initial state for a new session.

- Browser close, refresh, and external navigation use the native `beforeunload` warning.
- In-app navigation, including Back and sidebar navigation, uses the application's confirmation dialog with **Stay** and **Leave without saving** actions.
- Internal wizard step changes do not trigger a leave warning.
- A failed save does not clear the dirty state.
- A successful save, discard, or generation clears the dirty state at the appropriate point.

The implementation should use the established unsaved-change patterns already present in the application and extend them only where necessary to cover client-side navigation.

## Resume Validation and Error Handling

When a saved reference is no longer valid, the loader preserves all unaffected session state and clears only the invalid selection:

- unavailable or inactive template;
- deleted or inaccessible company;
- deleted or ineligible contact or selected party;
- unavailable letterhead or partial dependency.

The wizard shows a specific warning describing what must be selected again. It must not silently substitute a different record.

If the draft does not exist, was discarded, belongs to another workspace, is no longer `DRAFT`, or lacks compatible generation-session metadata, the route shows an explanatory error and offers a clean start. Authorization failures must not reveal whether an inaccessible draft exists.

## Legacy Browser Draft

The key `oakcloud:document-generation-wizard-draft` is no longer read or automatically restored. It is cleared when the new generation wizard initializes. No migration is attempted because the legacy value has no durable identity, workspace ownership proof, or support for multiple sessions.

## Focused Verification

Verification is intentionally limited to the changed behavior. The baseline or broad test suite must not be run unless the user explicitly requests it.

Focused component coverage will verify:

- `/generated-documents/generate` always starts clean;
- Save Draft is available and works at every step;
- multiple saved sessions retain independent state;
- resume restores the intended session only;
- a successful save resets the dirty baseline;
- later edits reactivate in-app and browser warnings;
- list rows and mobile cards distinguish **Resume**, **Edit**, and **Discard** correctly.

Focused API and service coverage will verify:

- session creation and same-record updates;
- workspace isolation and permission enforcement;
- versioned payload validation;
- soft deletion of a selected draft;
- generation updates the resumed record without creating a duplicate;
- generation failure leaves the saved session recoverable.

Run only the directly relevant test files plus type or lint checks scoped to touched files where the project tooling supports that scope.

## Documentation Updates

Update the existing document-generation sections under `docs/`, including the architecture, API reference, database metadata description if applicable, and the `GEN-001` entry in `docs/TODO.md`. The documentation must no longer describe automatic local restoration as the supported draft workflow.

## Non-goals

- A separate draft dashboard or data model.
- Automatic creation of a server record merely by opening the wizard.
- Automatic periodic server saves without an explicit **Save Draft** action.
- Migrating the legacy local browser draft.
- Changing the generated-document editor's existing auto-save draft mechanism.
- Running baseline or broad regression suites without an explicit user request.
