# SharePoint Company Folder Mapping and Signed-Document Filing Implementation Plan

> **For agentic workers:** Execute this plan task-by-task in the listed order. Use checkbox (`- [ ]`) tracking, preserve unrelated worktree changes, and do not enable automatic SharePoint filing until the final gate passes.

**Goal:** Map Oakcloud companies to stable SharePoint folders and durably file each completed signed document into a template-defined relative subfolder, with duplicate protection and an administrator recovery queue.

**Architecture:** Keep Oakcloud storage authoritative. Require a workspace-owned SharePoint connector and store that workspace's roots in its typed connector settings. Store company mappings in a dedicated table, template-relative paths on `DocumentTemplate`, route snapshots on generated documents and filing rows, and per-document upload state in a separate leased filing ledger. Create ledger rows transactionally at envelope completion and claim them only when signed source files are ready. All Graph access remains server-side and workspace-scoped. A shared picker serves settings, company, BizFile, and recovery workflows.

**Tech stack:** Next.js 15, React 19, TypeScript, Prisma 7/PostgreSQL, Zod, Microsoft Graph client, TanStack Query, Tailwind CSS, Vitest, Testing Library, and browser-mode Playwright.

**Spec:** `docs/superpowers/specs/2026-09-01-sharepoint-signed-document-filing-design.md`

## Global constraints

- Deliver all tasks as one implementation phase. Task boundaries are dependency and review boundaries, not separate releases.
- Follow `docs/guides/DESIGN_GUIDELINE.md` for all UI work.
- Keep Oakcloud's internal signed PDF/package as the source of record.
- Never derive a permanent company mapping from fuzzy company-name matching.
- Never rely on Graph conflict behavior `rename` for automated signed-document filing. Oakcloud reserves the base filename and controlled ` (1)`, ` (2)`, and later suffixes itself, uploading each exact candidate with conflict behavior `fail`.
- Do not route a transient Graph failure to the orphan folder.
- Do not auto-file historical completed envelopes.
- Preserve existing connector settings while adding signed-document filing settings.
- Signed-document filing requires a connector with `workspaceId` equal to the authenticated workspace. Reject system/shared connectors and do not use connector fallback resolution.
- Require the Client Documents and orphan roots, every company mapping, and every recovery destination to use the connector's configured drive. Version one does not perform cross-drive copy/delete recovery.
- Enforce workspace isolation before decrypting connector credentials or calling Graph.
- Follow current Prisma conventions: UUID IDs and `Workspace` relations. The spec's `Tenant`/`cuid()` snippets are conceptual, not literal for this repository.
- Keep the existing internal envelope `autoFilingStatus` workflow independent from the new SharePoint filing ledger.
- Keep the deployment-level `SHAREPOINT_SIGNED_FILING_ENABLED` kill switch off until schema, configuration, mapping, template routing, worker, queue, and full verification are complete. Workspace enablement is a second independent gate.
- Create filing rows in the envelope-completion transaction, snapshot routing/configuration inputs, and gate claims on signed-source readiness.
- Use opaque server-issued pagination cursors; never accept a raw Graph continuation URL from the browser.

---

### Task 1: Add shared folder-reference and relative-path contracts

**Files:**

- Create: `src/lib/sharepoint/folder-reference.ts`
- Create: `src/lib/sharepoint/relative-folder-path.ts`
- Modify: `src/lib/validations/connector.ts`
- Test: `__tests__/lib/sharepoint-folder-reference.test.ts`
- Test: `__tests__/lib/sharepoint-relative-folder-path.test.ts`
- Test: `__tests__/lib/connector-validation.test.ts`

**Interfaces:**

- `sharePointFolderRefSchema` with `driveId`, `itemId`, `name`, and `webUrl`.
- `SharePointFolderRef` inferred from that schema.
- `parseSharePointRelativeFolderPath(value)` returning `{ normalized, segments }` or a typed validation error.
- Extend `sharepointSettingsSchema` with server-managed `signedDocumentFiling.enabled`, `enabledAt`, `lastVerifiedAt`, `configVersion`, `clientDocumentsRoot`, and `orphanDocumentsFolder`. An absent branch parses compatibly as disabled/version 1 without writing. Retain `rootFolder`, `syncEnabled`, `documentLibraryName`, legacy/current mailbox keys, email-ingestion settings, and unknown future settings.

- [ ] Write failing tests for valid folder references, invalid URLs/empty IDs, server-managed field rejection, and preservation of `rootFolder`, sync/library keys, `mailboxUserId`, `mailboxUserIds`, `ingestAllEmails`, and unknown future settings.
- [ ] Write table-driven failing path tests covering whitespace, backslash normalization, nested paths, URLs, drive/UNC paths, empty segments, `.`/`..`, control characters, invalid SharePoint characters, trailing periods, and length limits.
- [ ] Run: `npm.cmd run test:run -- __tests__/lib/sharepoint-folder-reference.test.ts __tests__/lib/sharepoint-relative-folder-path.test.ts __tests__/lib/connector-validation.test.ts --reporter=dot`
- [ ] Implement a non-stripping settings schema and the pure path parser. Return normalized text; never silently delete invalid characters.
- [ ] Re-run the focused tests and confirm PASS.
- [ ] Commit: `feat: add sharepoint filing contracts`

---

### Task 2: Add the mapping, template route, and filing-ledger schema

**Files:**

- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_sharepoint_signed_document_filing/migration.sql`
- Test: `__tests__/integration/sharepoint-filing-schema.postgres.test.ts`

**Interfaces:**

- Add `CompanySharePointFolder` with UUID ID, `tenantId`, unique `companyId`, `connectorId`, `driveId`, `folderItemId`, cached name/URL, verification fields, timestamps, and compound uniqueness for one remote folder per workspace.
- Add nullable `DocumentTemplate.sharePointRelativeFolderPath` and `GeneratedDocument.sharePointRelativeFolderPathSnapshot`, mapped with the repository's snake-case database convention.
- Add filing status, including `REVIEW_REQUIRED`, destination-kind, and routing-reason enums from the spec.
- Add `EsigningSharePointFiling` with unique `envelopeDocumentId`; connector/config/template/company/route/root snapshots; source hash/size; resolved and uploaded drive/item identities; reserved target and actual filenames; structured error code; attempts, availability, lease/claim fields; resolution note; filed/resolved metadata; and timestamps.
- Add database uniqueness for destination plus reserved target filename and for uploaded remote identity, allowing nulls before allocation/upload.
- Add required reverse relations to `Workspace`, `Company`, `Connector`, `DocumentTemplate` consumers where needed, `EsigningEnvelope`, `EsigningEnvelopeDocument`, and `User` only where a real foreign key is retained.

- [ ] Write a failing PostgreSQL migration test that applies the migration to the established migration-test baseline and verifies tables, snapshot columns, enum values, compound workspace foreign keys where supported, unique constraints, and queue indexes.
- [ ] Update Prisma models using existing UUID, `Workspace`, `@map`, and table mapping conventions.
- [ ] Write forward-only SQL; do not backfill mappings, template paths, generated-document snapshots, or historical filing jobs. Existing generated documents use the explicitly tested one-time legacy route fallback only if they complete after enablement.
- [ ] Run: `npm.cmd run db:generate`
- [ ] Run: `npm.cmd run test:run -- __tests__/integration/sharepoint-filing-schema.postgres.test.ts --reporter=dot`
- [ ] Inspect generated migration SQL and confirm deleting a company cascades its mapping without deleting historical filing evidence, connector deletion cannot silently orphan an active mapping, and cross-workspace relation mismatches are rejected where compound keys exist.
- [ ] Commit: `feat: add sharepoint filing schema`

---

### Task 3: Harden and extend the SharePoint service

**Files:**

- Modify: `src/services/sharepoint.service.ts`
- Create: `src/services/sharepoint-folder.service.ts`
- Create: `src/services/sharepoint-signed-upload.service.ts`
- Test: `__tests__/services/sharepoint-folder.service.test.ts`
- Test: `__tests__/services/sharepoint-signed-upload.service.test.ts`
- Modify/Test: existing SharePoint route/service tests if present

**Interfaces:**

- Workspace-owned connector resolver accepting `{ workspaceId, connectorId }` and rejecting `workspaceId = null` or another workspace before decryption.
- `verifyFolder`, `listChildFolders`, `findExactChildFolder`, `createChildFolder`, `isImmediateChildOfRoot`, `isDescendantOfRoot`, `resolveOrCreateRelativePath`, `uploadSignedDocument`, `findItemByName`, and same-drive `moveItemToFolder`.
- A safe `SharePointServiceError` classification carrying status category, retryability, and redacted message.
- Opaque cursor encode/decode bound to workspace, connector, drive, parent, query, and Graph continuation state.

- [ ] Write failing tests proving a system/shared connector and a connector outside the workspace are rejected before credentials are decrypted; do not call the existing system-connector fallback.
- [ ] Add Graph adapter fixtures for paginated children, folders-only filtering, exact case-insensitive matches, stale IDs, throttling, conflicts, and timeouts.
- [ ] Write concurrent nested-folder tests: a `409` create conflict must trigger re-read and reuse of the winning folder.
- [ ] Write signed-upload tests proving conflict behavior is `fail`, the caller controls the exact reserved filename, reconciliation returns canonical drive/item/size evidence, a bounded remote download supplies a compatible content hash when Graph cannot, and generic upload behavior remains unchanged for other callers.
- [ ] Refactor credential resolution so all new public operations require workspace context. Avoid breaking document-conversion and existing connector routes.
- [ ] Implement immediate-child pagination and a workspace-scoped short-lived cache keyed by connector/drive/parent; invalidate after mutation and explicit refresh.
- [ ] Implement immediate-child and descendant verification using canonical Graph parent identity; never trust a browser-supplied parent, name, URL, drive, or item ID without verification.
- [ ] Reject a folder outside the connector's configured drive. Validate every continuation URL host/path before attaching authorization and expose only an opaque cursor to clients.
- [ ] When credentials omit `driveId`, resolve the site's default drive to its canonical ID before validating or storing any folder reference; never persist `root` as the drive ID.
- [ ] Implement small upload and upload-session routing according to current Graph limits, with redacted errors and `Retry-After` propagation.
- [ ] Run: `npm.cmd run test:run -- __tests__/services/sharepoint-folder.service.test.ts __tests__/services/sharepoint-signed-upload.service.test.ts __tests__/services/microsoft-graph-document-conversion.service.test.ts --reporter=dot`
- [ ] Commit: `feat: add safe sharepoint folder operations`

---

### Task 4: Add filing-settings and folder-browser APIs

**Files:**

- Create: `src/services/sharepoint-filing-settings.service.ts`
- Create: `src/app/api/sharepoint/connection-status/route.ts`
- Create: `src/app/api/sharepoint/folders/route.ts`
- Create: `src/app/api/settings/sharepoint-filing/route.ts`
- Modify: `src/app/api/connectors/[id]/sharepoint/route.ts`
- Test: `__tests__/api/sharepoint-folders-route.test.ts`
- Test: `__tests__/api/sharepoint-filing-settings-route.test.ts`

**Interfaces:**

- GET connection status for an explicit workspace-owned `connectorId`, with safe connector metadata and verification timestamp.
- GET folders with `connectorId`, `parentItemId`, optional `query`, opaque cursor, and picker mode.
- POST folder with `connectorId`, `parentItemId`, and validated `name`.
- GET signed-document filing settings for an explicit `connectorId`; PUT includes `connectorId` plus only user-editable root/toggle fields.

- [ ] Write failing authentication, RBAC, system-connector, cross-workspace, cross-drive, out-of-root, disabled-connector, opaque-cursor tampering/host, pagination, full immediate-child substring filtering, concurrent settings update, and settings-merge tests.
- [ ] Require `connector:read` for browsing and `connector:update` for root configuration/folder creation; combine company-specific permission checks in company routes later.
- [ ] Require `connector.workspaceId === session workspaceId` for every route. Do not allow or fall back to system/shared connectors.
- [ ] In client-folder mode, ignore or reject a parent other than the configured Client Documents root; company mappings must be immediate children.
- [ ] Verify both root references through Graph before saving; require the connector's configured drive and reject identical `(driveId, itemId)` pairs.
- [ ] Treat `enabledAt`, `lastVerifiedAt`, and `configVersion` as server-managed. Changing roots increments the version and disables filing; enabling re-verifies both roots, records a fresh cutover, and also requires `SHAREPOINT_SIGNED_FILING_ENABLED`.
- [ ] Merge only `signedDocumentFiling` into parsed settings through a transaction or optimistic concurrency check, retaining current conversion/sync/mailbox/email-ingestion and unknown future keys.
- [ ] Return stable DTOs and safe error codes such as `CONNECTOR_UNAVAILABLE`, `WORKSPACE_CONNECTOR_REQUIRED`, `ROOT_NOT_CONFIGURED`, `FOLDER_NOT_FOUND`, `DRIVE_MISMATCH`, `OUTSIDE_ALLOWED_ROOT`, and `INVALID_CURSOR`.
- [ ] Run: `npm.cmd run test:run -- __tests__/api/sharepoint-folders-route.test.ts __tests__/api/sharepoint-filing-settings-route.test.ts --reporter=dot`
- [ ] Commit: `feat: add sharepoint filing configuration api`

---

### Task 5: Build the shared folder picker and connector settings UI

**Files:**

- Create: `src/components/connectors/sharepoint/sharepoint-folder-picker.tsx`
- Create: `src/components/connectors/sharepoint/sharepoint-folder-field.tsx`
- Create: `src/components/connectors/sharepoint/sharepoint-filing-settings.tsx`
- Create: `src/hooks/use-sharepoint-folders.ts`
- Modify: `src/app/(dashboard)/admin/connectors/page.tsx`
- Test: `__tests__/components/sharepoint-folder-picker.test.tsx`
- Test: `__tests__/components/sharepoint-filing-settings.test.tsx`
- Browser test: `__tests__/browser/sharepoint-folder-picker.browser.test.tsx`

**Interfaces:**

- Picker props include `connectorId`, `mode` (`browse`, `client-folder`, or `destination`), optional current value, optional fixed root, `allowCreate`, `allowRelativePath`, `suggestedFolderName`, `onConfirm`, and `onCancel`.
- Folder field displays name/link and select/change/clear actions without exposing editable IDs.

- [ ] Write failing tests for workspace-owned/system-ineligible connection states, loading/empty/error states, debounced full-set substring search, opaque pagination, keyboard selection, current selection, confirm/cancel, duplicate folder warning, create-then-select, and destination browsing/relative-path entry.
- [ ] Implement TanStack Query hooks with stable keys and mutation invalidation. Do not put Graph credentials or raw settings in client state.
- [ ] Follow the established modal, input, button, status, spacing, and mobile rules in `docs/guides/DESIGN_GUIDELINE.md`.
- [ ] Add the two root fields and `Check connection` within the selected SharePoint connector's settings surface on the existing admin connectors page.
- [ ] Add an `Enable automatic signed-document filing` switch that remains disabled until the deployment gate is on and both roots verify, clearly states the `enabledAt` cutover and historical exclusion, and requires confirmation before enabling.
- [ ] Ensure browser links use `target="_blank"` and `rel="noopener noreferrer"`.
- [ ] Run focused component tests, then: `npm.cmd run test:browser -- __tests__/browser/sharepoint-folder-picker.browser.test.tsx`
- [ ] Commit: `feat: add sharepoint folder picker`

---

### Task 6: Implement company folder mapping service and API

**Files:**

- Create: `src/services/company-sharepoint-folder.service.ts`
- Create: `src/app/api/companies/[id]/sharepoint-folder/route.ts`
- Create: `src/app/api/companies/[id]/sharepoint-folder/verify/route.ts`
- Test: `__tests__/services/company-sharepoint-folder.service.test.ts`
- Test: `__tests__/api/company-sharepoint-folder-route.test.ts`
- Integration test: `__tests__/integration/company-sharepoint-folder.postgres.test.ts`

**Interfaces:**

- `getCompanySharePointFolder`, `setCompanySharePointFolder`, `removeCompanySharePointFolder`, and `verifyCompanySharePointFolder`.
- Mapping DTO exposes folder name/URL, verification state, and safe IDs only where needed by the picker.

- [ ] Write failing tests for company/update permission, workspace-owned connector enforcement, workspace ownership, configured-drive equality, immediate-child enforcement, folder type, canonical Graph name/URL persistence, duplicate remote mapping, upsert, removal, stale verification, and audit creation.
- [ ] Use `company:update` scoped to the company plus connector read/use authorization. View uses `company:read`.
- [ ] In a transaction, enforce mapping uniqueness and write audits with old/new canonical folder references. Compare remote identity using connector, drive, and item ID.
- [ ] Treat definitive Graph not-found as stale; treat throttling/timeouts as verification errors without deleting the mapping.
- [ ] Run focused service/API tests and the PostgreSQL integration test.
- [ ] Commit: `feat: add company sharepoint folder mapping`

---

### Task 7: Integrate mapping into company profile, create, and edit

**Files:**

- Modify: `src/components/companies/company-detail/company-profile-sections.tsx`
- Modify: `src/components/companies/company-detail/company-profile-tab.tsx`
- Modify: `src/components/companies/company-edit/company-create-workspace.tsx`
- Modify: `src/components/companies/company-edit/company-edit-workspace.tsx`
- Modify: `src/app/(dashboard)/companies/new/page.tsx`
- Modify: `src/app/(dashboard)/companies/[id]/edit/page.tsx`
- Create: `src/components/companies/company-sharepoint-folder-field.tsx`
- Test: `__tests__/components/company-profile-sections.test.tsx`
- Test: `__tests__/components/company-sharepoint-folder-field.test.tsx`
- Test: `__tests__/components/company-create-sharepoint.test.tsx`

**Interfaces:**

- Pending selection union: unmapped, selected existing reference, or requested new folder name.
- Post-create orchestration returns company success independently from SharePoint setup success.

- [ ] Add failing tests for linked profile display, select/change/remove, stale repair, new-company pending selection, deferred folder creation, and mapping failure after successful company save.
- [ ] Keep SharePoint operational metadata outside generic company profile JSON/section payloads.
- [ ] Add the field visually under Additional company information while using focused mapping APIs.
- [ ] Save company first. Then create/map SharePoint. On failure, preserve company ID, show a persistent warning, and provide retry without resubmitting company creation.
- [ ] Confirm mapping changes affect future jobs only and do not move prior items.
- [ ] Run focused tests and existing company profile coverage tests.
- [ ] Commit: `feat: add sharepoint mapping to company workflows`

---

### Task 8: Integrate pending mapping into BizFile creation

**Files:**

- Modify: `src/components/companies/bizfile-review/bizfile-review-workspace.tsx`
- Modify: `src/app/(dashboard)/companies/upload/page.tsx`
- Modify: `src/lib/validations/bizfile-review.ts` only if the pending UI contract belongs in the validated review state
- Test: `__tests__/components/bizfile-review-workspace.test.tsx`
- Test: `__tests__/app/companies-upload-bizfile-review.test.tsx`
- Browser test: `__tests__/browser/bizfile-review.browser.test.tsx`

**Interfaces:**

- Add optional pending SharePoint selection and callback without mixing it into extracted BizFile company data.
- Add `Choose SharePoint folder` beside `Confirm & Save` and a removable selection summary.

- [ ] Write failing tests for existing selection, requested new folder, clear action, connector error, and successful company creation followed by failed mapping.
- [ ] Reuse the shared picker and the same post-create orchestration as ordinary company creation.
- [ ] Ensure SharePoint is optional and never blocks BizFile company save.
- [ ] Run focused unit/component/browser tests.
- [ ] Commit: `feat: add sharepoint mapping to bizfile creation`

---

### Task 9: Add template-relative SharePoint routing

**Files:**

- Modify: `src/lib/validations/document-template.ts`
- Modify: `src/services/document-template.service.ts`
- Modify: `src/services/document-generator.service.ts` and any batch-generation create path that writes `GeneratedDocument`
- Modify: `src/components/documents/template-editor/template-editor-state.ts`
- Modify: `src/components/documents/template-editor/template-details-panel.tsx`
- Modify: `src/components/documents/template-editor/template-validation.ts`
- Modify: template and generated-document backup/export/restore code in `src/services/backup.service.ts` where those records are serialized
- Test: `__tests__/services/document-template-sharepoint-path.test.ts`
- Test: `__tests__/components/template-editor/template-validation.test.ts`
- Test: `__tests__/components/template-editor/template-editor-panel.test.tsx`
- Modify relevant backup tests

**Interfaces:**

- Create/update DTOs include nullable `sharePointRelativeFolderPath`; generated-document creation copies it to `sharePointRelativeFolderPathSnapshot`.
- Editor shows `SharePoint subfolder`, helper text, and `<Company SharePoint folder>/<path>` preview.

- [ ] Write failing validation, create/update, audit, duplicate, template and generated-document backup/restore, editor hydration, preview, generated-document snapshot, template-changed-after-generation, legacy-null fallback, and error-message tests.
- [ ] Normalize through the shared parser at the server boundary. Store null for blank input.
- [ ] Add the field to `computeChanges`/audit snapshots and duplicate/template serialization paths.
- [ ] Copy the normalized route into every generated-document creation path. A later template update must not mutate existing generated-document snapshots.
- [ ] Leave existing generated-document snapshots null. Filing-job creation may read the current template once for a post-cutover legacy document, must persist the result into the job snapshot, and must audit that fallback.
- [ ] Keep it out of `contentJson`.
- [ ] Run all focused tests plus existing document-template composition/editor tests.
- [ ] Commit: `feat: add sharepoint routes to document templates`

---

### Task 10: Implement filing enqueue, routing snapshots, and collision-safe naming

**Files:**

- Create: `src/services/esigning-sharepoint-filing/repository.ts`
- Create: `src/services/esigning-sharepoint-filing/routing.ts`
- Create: `src/services/esigning-sharepoint-filing/filename.ts`
- Create: `src/services/esigning-sharepoint-filing/enqueue.ts`
- Create: `src/services/esigning-sharepoint-filing/types.ts`
- Test: `__tests__/services/esigning-sharepoint-routing.test.ts`
- Test: `__tests__/services/esigning-sharepoint-filename.test.ts`
- Integration test: `__tests__/integration/esigning-sharepoint-filing-repository.postgres.test.ts`

**Interfaces:**

- `ensureFilingJobsForCompletedEnvelope(tx, envelopeId, completedAt)` runs inside the completion transaction, applies both enablement gates and the `enabledAt` cutover, and upserts by envelope document.
- `snapshotFilingRoute(tx, envelopeDocumentId)` returns intended/orphan destination, routing reason, connector/config/root/company/template snapshots, and safe naming inputs without making a Graph call.
- `claimFilingJobs`, `completeClaim`, `failClaim`, and `releaseExpiredClaims` mirror established completion-worker lease semantics.
- Preferred filename preserves the source document filename and appends `_signed` before `.pdf`. `reserveTargetFileName` atomically reserves the preferred name or controlled ` (1)` through ` (99)` suffix.

- [ ] Write enqueue route-matrix tests for generated-document snapshot, legacy one-time fallback, missing mapping, blank path, manual document, invalid stored path, deployment/workspace disabled states, and cutover exclusion. Definitive remote not-found and transient verification belong to worker tests because enqueue performs no Graph call.
- [ ] Write repository concurrency tests for unique transactional upsert, source-readiness claim join, `SKIP LOCKED`, claim token, lease expiry, attempt increments, lost claim, cutover-bounded repair, destination/name reservation, uploaded-item uniqueness, and retry schedule.
- [ ] Write filename tests for invalid characters, length, stable base name, same-name ` (1)`/` (2)` allocation, concurrent reservation, 100-candidate exhaustion, and repeat determinism for an already reserved job.
- [ ] Snapshot connector/config version, both roots, company mapping/name, template/version/path, and document title at enqueue. Later mapping, root, company, or template changes must not alter automatic work.
- [ ] Persist bounded `lastErrorCode` and redacted `lastError`; after 10 automatic attempts transition retryable work to `REVIEW_REQUIRED`.
- [ ] Run focused tests and PostgreSQL integration tests.
- [ ] Commit: `feat: add sharepoint filing queue foundation`

---

### Task 11: Add the durable per-document filing worker

**Files:**

- Create: `src/services/esigning-sharepoint-filing/worker.ts`
- Modify: `src/services/esigning-completion.service.ts`
- Modify: `src/services/esigning-signing.service.ts` completion transaction integration
- Modify: `src/services/esigning-pdf.service.ts` terminal source-failure integration
- Modify: signed source retrieval code only through an existing storage abstraction
- Test: `__tests__/services/esigning-sharepoint-filing-worker.test.ts`
- Integration test: `__tests__/integration/esigning-sharepoint-filing-worker.postgres.test.ts`
- Modify: `__tests__/services/esigning-completion.service.test.ts`

**Interfaces:**

- `processSharePointFilingJob(claim)` and `processQueuedSharePointFilings({ limit })`.
- Envelope completion transaction upserts filing rows immediately when both enablement gates are active. Claims become eligible only when the envelope and per-document signed storage are ready.

- [ ] Write failing tests for transactional enqueue, crash after completion before source readiness, source-ready claim gating, terminal PDF-generation failure, intended upload, orphan upload, nested creation, mixed-template envelope, source temporarily missing, Graph throttling, timeout reconciliation, same-job collision adoption, genuine collision suffixing, ambiguous collision review, lost lease, snapshot stability, and duplicate completion webhook.
- [ ] Integrate job creation into the same database transaction that changes the envelope to `COMPLETED`; do not wait until signed PDFs are persisted and do not couple SharePoint status to internal `autoFilingStatus`.
- [ ] Read the signed document and certificate from Oakcloud storage, merge them in document-then-certificate order, validate the combined PDF/type/size, and upload through the signed-upload service.
- [ ] Populate the source package hash/size when ready. Resolve the snapshotted destination, reserve `targetFileName` before upload, and persist canonical remote drive/item/name/URL before final completion.
- [ ] On uncertain failure, inspect the persisted item ID or reserved target name and compare destination, signed hash, and size. Adopt the same job's item; allocate a numbered suffix only for a genuine different-file collision.
- [ ] Classify `429`, `5xx`, network, temporary token, and temporary storage failures as retryable; configuration/permission/source-invalid failures as permanent; and exhausted/ambiguous work as `REVIEW_REQUIRED`.
- [ ] Honor `Retry-After` and otherwise apply bounded exponential backoff with jitter.
- [ ] Stop automatic retries after 10 attempts. Audit intended completion, orphan completion, suffix allocation, permanent failure, and review escalation; emit queue/latency/error metrics through current logging conventions.
- [ ] Run focused unit and PostgreSQL worker tests plus existing e-signing completion tests.
- [ ] Commit: `feat: file signed documents to sharepoint`

---

### Task 12: Register scheduling and expose safe operational status

**Files:**

- Create: `src/lib/scheduler/tasks/esigning-sharepoint-filing.task.ts`
- Modify: `src/lib/scheduler/tasks/index.ts`
- Modify: `src/lib/scheduler/index.ts`
- Create: `src/app/api/settings/sharepoint-filing/status/route.ts`
- Test: `__tests__/services/esigning-sharepoint-filing-scheduler.test.ts`
- Test: `__tests__/api/sharepoint-filing-status-route.test.ts`

**Interfaces:**

- Scheduler task invokes a bounded batch and reports processed/completed/retryable/permanent/review-required counts plus paused or waiting-for-source observations where relevant.
- Status endpoint returns safe aggregate counts, review-required count, oldest source-ready pending age, waiting-for-source count, and current workspace cutover/config version, scoped to the workspace.

- [ ] Write failing deployment-kill-switch, scheduler registration, overlap-prevention, source-readiness, bounded-batch, cutover-bounded missing-row reconciliation, fair workspace batching, and tenant-scoped status tests.
- [ ] Register with the existing scheduler but return without enqueueing/claiming while `SHAREPOINT_SIGNED_FILING_ENABLED` is off. Skip claims for currently disabled workspaces without mutating their rows; after re-enable, resume existing rows regardless of the new discovery cutover. Per job, require the snapshotted workspace-owned connector/configuration and never resolve a system fallback.
- [ ] Ensure multiple application instances are safe because database claims, not in-memory flags, own jobs.
- [ ] Add a bounded reconciliation pass that can recreate missing rows only for envelopes completed during the workspace's current enabled interval; never scan earlier history.
- [ ] Run focused tests and existing scheduler health tests.
- [ ] Commit: `feat: schedule sharepoint filing work`

---

### Task 13: Build the unassigned and failed filing recovery queue

**Files:**

- Create: `src/services/esigning-sharepoint-filing/recovery.ts`
- Create: `src/app/api/settings/sharepoint-filing/unassigned/route.ts`
- Create: `src/app/api/settings/sharepoint-filing/jobs/[jobId]/retry/route.ts`
- Create: `src/app/api/settings/sharepoint-filing/jobs/[jobId]/resolve/route.ts`
- Create: `src/app/api/settings/sharepoint-filing/jobs/[jobId]/notes/route.ts`
- Create: `src/components/connectors/sharepoint/sharepoint-unassigned-queue.tsx`
- Modify: `src/components/connectors/sharepoint/sharepoint-filing-settings.tsx`
- Test: `__tests__/api/sharepoint-filing-recovery-route.test.ts`
- Test: `__tests__/components/sharepoint-unassigned-queue.test.tsx`
- Integration test: `__tests__/integration/esigning-sharepoint-recovery.postgres.test.ts`
- Browser test: `__tests__/browser/sharepoint-unassigned-queue.browser.test.tsx`

**Interfaces:**

- Paginated queue includes unresolved pending/retryable/completed orphan rows and permanent/review-required intended or orphan failures, with stable error codes.
- Retry resets a corrected job to `PENDING`, clears review state, resets the 10-attempt window, and makes it immediately available without changing its route snapshots unless the administrator explicitly supplies a verified recovery override.
- Resolve accepts a verified same-drive destination or validated relative path beneath the mapped company folder, moves an existing orphan item or uploads when none exists, then stores final remote identity, optional note, and resolution audit metadata.
- Notes append an audit entry without changing filing state.

- [ ] Write failing permission, system-connector, cross-workspace, cross-drive, pagination, retry/reset, mapping repair, destination relative path, same-drive move, database-failure-after-move reconciliation, note, and resolution-audit tests.
- [ ] Reuse the shared picker destination mode and mapping service; do not accept unchecked drive/item IDs, names, URLs, or paths.
- [ ] Make resolution idempotent: repeated requests return the already resolved outcome.
- [ ] For a retry after an uncertain same-drive move, fetch the existing uploaded item ID, verify its current parent, and complete the database state without creating a copy.
- [ ] Show internal document link, SharePoint link, reason, intended path, status, attempt count, stable error category, last safe error, notes, and available actions.
- [ ] Run focused API/component/integration/browser tests.
- [ ] Commit: `feat: add sharepoint filing recovery queue`

---

### Task 14: Complete integrated verification, documentation, and enablement

**Files:**

- Modify: `docs/reference/DATABASE_SCHEMA.md`
- Modify: `docs/reference/API_REFERENCE.md`
- Modify: `docs/guides/DESIGN_GUIDELINE.md` if reusable picker/queue rules need documenting
- Modify: relevant connector/e-signing operational documentation under `docs/`
- Modify: `docs/INDEX.md` if final document locations change
- Add/modify end-to-end fixtures and tests as required

- [ ] Run schema generation: `npm.cmd run db:generate`.
- [ ] Run all focused tests introduced by Tasks 1–13.
- [ ] Run existing regression suites for connectors, company profiles, BizFile, templates, backup, e-signing completion, and scheduler tasks.
- [ ] Run PostgreSQL suites serially where required, including existing `npm.cmd run test:esigning:postgres` and the new SharePoint migration/worker/recovery integration tests.
- [ ] Run: `npx.cmd tsc --noEmit`.
- [ ] Run: `npm.cmd run lint`.
- [ ] Run the relevant browser suites for picker, company mapping, BizFile, template editor, and recovery queue.
- [ ] With `SHAREPOINT_SIGNED_FILING_ENABLED` enabled only in the test environment, use a workspace-owned connector against a non-production SharePoint site to smoke-test root selection, system-connector rejection, same-drive enforcement, existing/new company folder mapping, nested route creation, intended filing, orphan filing, genuine filename suffixing, retry, timeout reconciliation, notes, and queue resolution.
- [ ] Verify least-privilege Graph permissions and document the required app registration permissions.
- [ ] Perform desktop/mobile rendered QA and inspect console/network errors, focus behavior, empty/error states, and external links.
- [ ] Run crash-boundary tests proving transactional job creation survives delayed/failed signed-artifact generation, and run snapshot tests proving later template/mapping/root edits do not change existing automatic jobs.
- [ ] Confirm no envelope completed before the current `enabledAt` was queued, existing null template and generated-document snapshot paths remain unchanged, and the legacy post-cutover fallback is audited.
- [ ] Verify feature enablement is blocked for system connectors, while the deployment kill switch is off, when roots are missing/unverified, or when drives differ; enable only after the full gate passes.
- [ ] Run: `git diff --check` and `git status --short`; review only planned changes and preserve unrelated modifications.
- [ ] Update reference documentation with final schema/API names and administrator recovery instructions.
- [ ] Commit: `docs: document sharepoint signed filing operations`

## Final completion gate

Do not consider the single implementation phase complete until:

- Both folder roots can be configured and verified.
- Only workspace-owned connectors are eligible; system/shared connectors are rejected before decryption or Graph access.
- The deployment kill switch and workspace `enabledAt` cutover prevent historical filing.
- Company mapping works in profile, ordinary create/edit, and BizFile creation.
- Template simple/nested routes persist, duplicate, audit, restore, and snapshot onto generated documents correctly.
- Per-document jobs are created transactionally at completion, wait safely for signed sources, and file mixed-template envelopes independently.
- Retries and repeated webhooks cannot overwrite or duplicate the same job; genuine filename collisions receive controlled numbered suffixes.
- Transient failures stay on the intended route.
- Unresolved routes reach the orphan folder and recovery queue.
- Retryable work escalates to review after 10 attempts, and administrators can add notes, retry, and resolve same-drive queue items idempotently.
- Cross-workspace, system-connector, cross-drive, tampered-cursor, non-immediate-child, and out-of-root references are rejected in tests.
- Existing automatic jobs retain their connector/configuration/company/template/root snapshots after later edits.
- Existing connector conversion and internal e-signing filing remain green.
- TypeScript, lint, focused tests, PostgreSQL tests, browser tests, and non-production Graph smoke tests pass.
