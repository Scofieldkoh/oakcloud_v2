# SharePoint Company Folder Mapping and Signed-Document Filing

**Date:** 2026-09-01

**Status:** Proposed implementation specification

**Implementation model:** One delivery phase, completed as ordered workstreams

## 1. Objective

File completed signed documents directly into the correct SharePoint client folder and document-type subfolder while retaining Oakcloud's internal signed copy as the source of record.

The current SharePoint structure is approximately:

```text
Oaktree Accounting & Corporate Solutions Pte. Ltd
└── Operation - Documents
    └── 0. Client Documents
        └── <client folder>
            ├── 0. Quotation, Agreement, Engagement Letter
            ├── 0a. KYCCDD
            ├── 1b. Bizfiles & Constitution
            ├── 1c. Resolutions
            ├── 2. Accounting
            │   └── Signed records
            └── ...
```

Client folder names do not always exactly match a company's legal name. They may omit punctuation, use an alias, contain annotations, or retain a historical name. Oakcloud must therefore store an explicit company-to-folder mapping rather than derive the destination from the legal name.

Each document-generation template supplies a relative path, for example:

- Service agreement: `0. Quotation, Agreement, Engagement Letter`
- Resolution: `1c. Resolutions`
- Accounting record: `2. Accounting/Signed records`

## 2. Goals

1. Configure a workspace-level Client Documents root and unassigned/orphan folder.
2. Map each company explicitly to a SharePoint client folder.
3. Search existing client folders by substring or create a new folder.
4. Expose a clickable SharePoint folder link in the company profile.
5. Support the same mapping workflow in ordinary and BizFile company creation.
6. Let templates store validated relative destination paths.
7. Create missing destination subfolders safely.
8. File every signed envelope document with durable retries and idempotency.
9. Route unresolved documents to an orphan folder and provide a recovery queue.
10. Enforce tenant isolation, RBAC, and auditing.
11. Use only workspace-owned SharePoint connectors for filing configuration and execution.

## 3. Non-goals

- Automatically renaming or reorganizing existing SharePoint folders.
- Permanently assigning a fuzzy company-name match without user confirmation.
- Replacing Oakcloud's internal signed-document storage.
- Automatically backfilling historical completed envelopes in this delivery.
- Storing absolute SharePoint paths or URLs on document templates.
- Synchronizing the complete SharePoint tree into Oakcloud.
- Supporting a different site or library per template in version one.
- Using a shared/system SharePoint connector for signed-document filing.
- Moving orphaned items across drives or document libraries in version one.

## 4. Authoritative design decisions

### 4.1 Folder identity

Every persisted folder selection contains or is unambiguously scoped by:

- SharePoint connector ID
- Drive ID
- Drive item ID
- Folder display name
- Browser URL (`webUrl`)

The drive item ID is authoritative for API operations. The name and URL are cached presentation data. Never parse the browser URL later to recover the item ID, and never use a stored text path as the permanent identifier.

### 4.2 Explicit company mapping

Search narrows the folder list, but a user confirms the mapping. Similarity matching may be offered as a visual suggestion in the future, but must not save automatically.

### 4.3 Relative template routing

Templates store only a relative folder path beneath the mapped company folder. A blank value means no destination has been configured; the system must not guess from the template name or category.

### 4.4 Per-document filing

An envelope can contain documents created from different templates. Filing status, destination, and idempotency are tracked for each `EsigningEnvelopeDocument`, not only for the envelope.

### 4.5 Internal source of record

Oakcloud's existing internally stored signed PDF/package remains authoritative. A SharePoint error must not change a completed envelope back to an incomplete state.

### 4.6 Orphan fallback

Use the orphan folder only when routing cannot be resolved: no company mapping, blank template route, a manual document without a route, an invalid stored path, or a definitively deleted company folder.

Do not fall back to orphan on a timeout, throttling, temporary authentication issue, or Graph `5xx`. Retry the intended destination first; an uncertain upload may already have succeeded.

### 4.7 Workspace-owned connector and configuration

Signed-document filing uses a SharePoint connector whose `workspaceId` is the authenticated workspace. Shared/system connectors with `workspaceId = null` are not eligible for root configuration, company mapping, filing, or recovery.

This constraint lets the workspace-specific root folders remain in that connector's typed settings without leaking or overwriting configuration across workspaces. Every filing entry point must resolve the connector by both connector ID and workspace ID and must not use the existing system-connector fallback.

The filing configuration has two independent gates:

- A deployment-level `SHAREPOINT_SIGNED_FILING_ENABLED` kill switch, off by default until the complete delivery gate passes.
- A workspace setting enabled only after both roots verify successfully.

Enabling records a server-generated `enabledAt` cutover. Disabling and later re-enabling establishes a new cutover. Completed envelopes before the current cutover are never discovered or queued automatically.

Disabling pauses claims for existing filing rows but does not delete or rewrite them. Re-enabling resumes already-created rows from earlier enabled intervals using their stored snapshots; the new `enabledAt` bounds only new completion enqueueing and missing-row reconciliation.

### 4.8 Routing snapshots

The template route is copied onto each `GeneratedDocument` when that document is created. Editing the template later does not change the generated document's route.

When an eligible envelope becomes complete, the filing row snapshots the current company mapping, connector, root configuration, template route, and safe naming inputs. Worker retries use those snapshots and do not re-resolve current company or template settings. A manual administrator recovery may choose a new verified destination and records that override explicitly.

## 5. User experience

### 5.1 Workspace settings

Add a signed-document filing section under:

```text
Settings > Connectors > SharePoint
```

It contains:

**Client Documents root folder**

- Available only for a workspace-owned SharePoint connector; shared/system connectors display an explanatory ineligible state.
- Required before company mappings can be selected or created.
- Selected with the shared SharePoint folder picker.
- Displays folder name, `Open in SharePoint`, `Change`, and `Clear`.

**Unassigned signed documents folder**

- Used for documents whose intended route cannot be determined.
- Selected with the same picker.
- Must use the same drive as the Client Documents root and must not be the same `(driveId, itemId)`.
- Displays a warning when missing.

**Connection status**

- Displays connector name and last successful verification time.
- Uses `Check connection`; authentication is already managed under Connectors.
- Displays safe, actionable errors without exposing Graph credentials or raw tokens.

**Enablement**

- The workspace toggle is unavailable while the deployment kill switch is off or either root is unverified.
- Enabling verifies both roots again and records `enabledAt`, `lastVerifiedAt`, and the current configuration version server-side.
- Changing a root increments the configuration version, clears the verification state, and disables filing until both roots verify again.

Folder IDs are selected and verified, not entered as ordinary free text. Administrators may have a read-only diagnostics view of drive and item IDs.

### 5.2 Shared SharePoint folder picker

Build one reusable picker for settings, company forms, BizFile review, and orphan recovery.

Modes:

- **Browse mode:** workspace administrators navigate the configured drive to choose root folders.
- **Client-folder mode:** users see only immediate child folders of the configured Client Documents root.
- **Destination mode:** recovery users browse beneath the mapped company folder or enter a validated relative path to an existing or newly created destination.

Controls and states:

- Connection state and `Check connection`.
- Current root and `Open root in SharePoint`.
- Debounced search bar.
- Paginated or virtualized folder-only result list.
- Selected-folder preview and browser link.
- `Create folder` when permitted.
- `Cancel` and `Confirm selection`.
- Loading, empty, stale, permission, and connection-error states.
- Keyboard navigation and accessible focus management.

Search is case-insensitive substring matching against immediate child folder names. Do not use whole-drive Graph search for company mapping because that can return files and descendants from unrelated locations. Enumerate all paginated immediate children, cache folder metadata briefly, and filter the complete immediate-child set. Invalidate the cache after creation or explicit refresh.

Pagination cursors are opaque server-issued values. Never accept a raw Graph `@odata.nextLink` from the browser, and never send a bearer token to an unvalidated absolute URL. The server must constrain continuation requests to Microsoft Graph and to the original connector, drive, parent, and query scope.

Creating a client folder:

1. Default the name to the company's legal name, but allow editing.
2. Trim and validate the name.
3. Check for an exact case-insensitive sibling match.
4. If one exists, select or offer the existing folder.
5. Otherwise create with conflict behavior set to fail, not auto-rename.
6. Select the returned folder and require final confirmation.

The server ignores client-supplied cached names and browser URLs when saving a reference. It verifies the folder and persists the canonical `name`, `webUrl`, drive ID, and item ID returned by Graph.

### 5.3 Company profile

Under **Additional company information**, show:

```text
SHAREPOINT FOLDER    Abzon Pte Ltd ↗    [Change]
```

- The name opens `folderWebUrl` in a new tab.
- Show `Select folder` when unmapped.
- `Change` opens the picker with the current item selected.
- `Remove` requires confirmation.
- A deleted or inaccessible item displays `Folder unavailable` and `Repair mapping`.
- Mapping changes affect future filing jobs only; previously filed items are not moved automatically.

The label is **SharePoint folder**, not merely **SharePoint path**, because the browser path is not the routing authority.

Current detail UI: `src/components/companies/company-detail/company-profile-sections.tsx`.

### 5.4 Ordinary company create/edit

Add an optional SharePoint folder field in Additional company information. The user can select an existing folder, request a new folder, or continue unmapped.

For a new company, retain the selection in local form state until a company ID exists.

Existing folder flow:

1. Save the company.
2. Save the selected folder reference against the returned company ID.

New folder flow:

1. Save the company.
2. Create the external folder under the configured root.
3. Save the returned folder reference.

If SharePoint steps fail, keep the company. Show a persistent warning and `Retry SharePoint setup`; do not roll back or recreate the company.

### 5.5 BizFile company creation

Add `Choose SharePoint folder` beside `Confirm & Save` in the BizFile review footer. Show the selected existing folder or `New folder: <name>` as a removable compact summary.

SharePoint selection is optional and connection failure cannot block company creation. Defer new-folder creation until after the company save succeeds.

Current touchpoints:

- `src/components/companies/bizfile-review/bizfile-review-workspace.tsx`
- `src/app/(dashboard)/companies/upload/page.tsx`

### 5.6 Document-template editor

Add an optional field:

```text
SharePoint subfolder
[ 0. Quotation, Agreement, Engagement Letter ]
```

Helper text:

> Relative to the company's SharePoint folder. Missing folders will be created after signing. Use `/` for nested folders, for example `2. Accounting/Signed records`.

Show a preview:

```text
<Company SharePoint folder>/2. Accounting/Signed records
```

Template duplication, audit/version history, backup, export, and import must preserve this value.

### 5.7 Unassigned signed documents queue

Add under:

```text
Settings > Connectors > SharePoint > Unassigned signed documents
```

Each row shows document name, known company, envelope/certificate reference, completion date, orphan reason, intended relative path, filing status, last error, and SharePoint link when uploaded.

Authorized actions:

- Open the internal signed document.
- Open the orphan SharePoint item.
- Choose or repair the company mapping.
- Choose the final destination subfolder.
- Move the existing remote orphan item and mark resolved.
- Retry an upload when no remote item exists.
- Add an audit note.

Version one requires the orphan folder and all company folders to use the configured roots' drive. Resolution therefore moves the existing item within the same drive, where its item ID remains the reconciliation identity. If the database update fails after a successful move, a retry verifies the item's current parent and completes the same resolution rather than moving or uploading another copy.

## 6. Data model

Names may be aligned with current Prisma conventions, but the stored semantics must remain.

### 6.1 Connector settings

Extend the existing typed `Connector.settings` JSON without overwriting unrelated settings:

```ts
type SharePointFolderRef = {
  driveId: string;
  itemId: string;
  name: string;
  webUrl: string;
};

type SharePointConnectorSettings = {
  // Existing settings remain.
  mailboxUserId?: string; // Legacy key retained on merge.
  mailboxUserIds?: string[];
  ingestAllEmails?: boolean;
  rootFolder?: string; // Existing Graph-conversion setting.
  syncEnabled?: boolean;
  documentLibraryName?: string;
  signedDocumentFiling?: {
    enabled: boolean;
    enabledAt?: string;
    lastVerifiedAt?: string;
    configVersion: number;
    clientDocumentsRoot?: SharePointFolderRef;
    orphanDocumentsFolder?: SharePointFolderRef;
  };
};
```

Parse settings through a non-stripping schema on every read/write, preserve all unrelated and future settings, and verify folder references before saving. Update only the `signedDocumentFiling` branch through a transaction or optimistic `updatedAt` check so concurrent mailbox, conversion, or sync changes cannot be lost.

An absent `signedDocumentFiling` branch parses as disabled with configuration version 1 and no roots. This compatibility default does not rewrite the connector until an administrator saves filing settings.

The selected connector must be workspace-owned. Settings APIs reject system connectors even if the workspace otherwise has access to them. `enabledAt`, `lastVerifiedAt`, and `configVersion` are server-managed and cannot be supplied by the browser.

If the connector credentials omit `driveId` and rely on the site's default drive, resolve that drive through Graph and persist/compare its canonical drive ID. The string `root` is never stored as a drive identity.

### 6.2 Company mapping

Use a separate table instead of SharePoint-specific fields on `Company`:

```prisma
model CompanySharePointFolder {
  id             String   @id @default(cuid())
  tenantId       String
  companyId      String   @unique
  connectorId    String
  driveId        String
  folderItemId   String
  folderName     String
  folderWebUrl   String
  lastVerifiedAt DateTime?
  verifiedById   String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  tenant         Tenant    @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  company        Company   @relation(fields: [companyId], references: [id], onDelete: Cascade)
  connector      Connector @relation(fields: [connectorId], references: [id], onDelete: Restrict)

  @@unique([tenantId, connectorId, driveId, folderItemId])
  @@index([tenantId, companyId])
}
```

Version one permits one mapping per company and prevents mapping one SharePoint folder to multiple companies in the same tenant. Cached name/URL are refreshed after successful verification.

A company folder must be an immediate child of the configured Client Documents root, must use the same drive, and must be returned canonically by Graph. Merely being a deeper descendant is not sufficient.

### 6.3 Template field

Add to `DocumentTemplate`:

```prisma
sharePointRelativeFolderPath String?
```

Do not put operational routing metadata in `contentJson`.

Add the route snapshot used by generated documents:

```prisma
model GeneratedDocument {
  // Existing fields remain.
  sharePointRelativeFolderPathSnapshot String?
}
```

Copy the normalized template value when the generated document is created. Existing generated documents retain null. If an existing generated document without a snapshot completes after enablement, read its current template route once while creating the filing row, persist that value as a legacy fallback snapshot, and never re-read it on worker retries. Record this fallback in audit metadata.

### 6.4 Per-document filing ledger

Do not reuse the existing envelope-wide `autoFilingStatus`, which represents Oakcloud's internal filing workflow.

```prisma
enum EsigningSharePointFilingStatus {
  PENDING
  PROCESSING
  COMPLETED
  FAILED_RETRYABLE
  FAILED_PERMANENT
  REVIEW_REQUIRED
}

enum EsigningSharePointDestinationKind {
  INTENDED
  ORPHAN
}

enum EsigningSharePointRoutingReason {
  TEMPLATE_ROUTE
  NO_COMPANY_MAPPING
  NO_TEMPLATE_PATH
  MANUAL_DOCUMENT
  COMPANY_FOLDER_UNAVAILABLE
  DESTINATION_PATH_INVALID
}

model EsigningSharePointFiling {
  id                      String   @id @default(cuid())
  tenantId                String
  envelopeId              String
  envelopeDocumentId      String   @unique
  companyId               String?
  connectorId             String
  destinationKind         EsigningSharePointDestinationKind
  routingReason           EsigningSharePointRoutingReason
  templateId              String?
  templateVersion         Int?
  configVersion           Int
  companyNameSnapshot     String?
  documentTitleSnapshot   String
  intendedCompanyDriveId  String?
  intendedCompanyFolderId String?
  intendedRelativePath    String?
  orphanDriveId           String
  orphanFolderItemId      String
  resolvedDestinationDriveId String?
  resolvedDestinationId   String?
  sourceSignedHash        String?
  sourceSize              Int?
  targetFileName          String?
  uploadedDriveId         String?
  uploadedItemId          String?
  uploadedWebUrl          String?
  uploadedFileName        String?
  status                  EsigningSharePointFilingStatus @default(PENDING)
  attempts                Int      @default(0)
  availableAt             DateTime @default(now())
  claimedAt               DateTime?
  leaseExpiresAt          DateTime?
  claimToken              String?
  lastErrorCode           String?
  lastError               String?
  filedAt                 DateTime?
  resolvedAt              DateTime?
  resolvedById            String?
  resolutionNote          String?
  createdAt               DateTime @default(now())
  updatedAt               DateTime @updatedAt

  @@index([status, availableAt])
  @@index([tenantId, destinationKind, status])
  @@index([envelopeId])
  @@unique([connectorId, resolvedDestinationDriveId, resolvedDestinationId, targetFileName])
  @@unique([connectorId, uploadedDriveId, uploadedItemId])
}
```

Add relations using project naming conventions and use compound workspace foreign keys wherever supported so a mismatched `tenantId` cannot reference another workspace's company, envelope, document, connector, or user. The unique envelope-document key is the database job-idempotency guard. The destination/name unique key coordinates concurrent suffix allocation, and the uploaded-item key prevents two jobs from adopting the same remote item. `destinationKind = ORPHAN` and `status = COMPLETED` means the remote orphan upload succeeded but remains in the queue until `resolvedAt` is set.

Missing connector/root configuration is `FAILED_PERMANENT` with a safe message, but administrators can retry after configuration is corrected.

## 7. Relative path validation

Use one parser in form validation, previews, APIs, and the worker.

Normalization:

1. Trim the full value.
2. Convert backslashes to `/`.
3. Remove leading/trailing `/`.
4. Split on `/` and trim each segment.
5. Preserve display capitalization.

Reject:

- URLs, drive-letter paths, UNC paths, and other absolute paths.
- Empty segments such as `Accounting//Signed`.
- `.` and `..`.
- Control characters and SharePoint-invalid characters.
- Segments ending in a period or containing only whitespace.
- Segments or complete paths exceeding supported limits.

Return normalized text and parsed segments. Never silently remove invalid characters because that can alter the intended destination.

## 8. SharePoint service behavior

Extend `src/services/sharepoint.service.ts` through reusable server-side operations:

```ts
verifyFolder(connectorId, driveId, itemId)
listChildFolders(connectorId, driveId, parentItemId, options)
findExactChildFolder(connectorId, driveId, parentItemId, name)
createChildFolder(connectorId, driveId, parentItemId, name)
resolveOrCreateRelativePath(connectorId, rootFolder, segments)
uploadSignedDocument(connectorId, destination, file)
moveItem(connectorId, item, destination)
```

Every public entry point resolves the connector inside the authenticated tenant and checks permissions before decrypting credentials or calling Graph.

### 8.1 Nested folder creation

Resolve one segment at a time beneath the company folder ID:

1. Find an exact case-insensitive child-folder match.
2. Reuse it if found.
3. Otherwise create with conflict behavior `fail`.
4. If a concurrent creation causes conflict, re-read and reuse the winner.
5. Continue using the returned item ID.

Never construct an API path by concatenating unvalidated user text.

### 8.2 Duplicate-safe upload

Automated filing may deconflict genuine filename collisions with ` (1)`, ` (2)`, and so on, but Oakcloud—not Graph—allocates and persists the suffix. Do not use Graph conflict behavior `rename`, because a timeout would leave Oakcloud unable to know which remote name Graph chose.

- Generate the preferred base filename.
- Resolve the destination folder, reserve `targetFileName` in the ledger, and use the database destination/name uniqueness constraint to coordinate concurrent jobs.
- Upload that exact name with conflict behavior `fail`.
- On a remote collision, reconcile the item against the same job's persisted target name, signed hash, and size. If Graph does not expose a compatible content hash, download the bounded candidate and compute Oakcloud's existing signed-document hash. If it is not the same document, atomically reserve the next available numbered suffix and retry.
- Persist returned drive ID, item ID, URL, actual filename, hash/size evidence, and filing time immediately.
- Cap automatic suffix allocation at 100 candidates; an exhausted or ambiguous reconciliation becomes `REVIEW_REQUIRED`.
- Use the small-file API or upload sessions according to Graph limits.

The uploaded PDF is the signed document followed by its certificate of completion. The persisted source hash and size refer to this combined filing package, so retries and collision reconciliation compare the complete SharePoint payload.

Recommended filename:

```text
<source document filename>_signed.pdf
```

Sanitize display components while retaining the stable short identifier.

For example, a genuine collision becomes:

```text
Resolution_signed.pdf
Resolution_signed (1).pdf
```

## 9. API responsibilities

Exact file placement may follow existing route conventions.

```text
GET  /api/sharepoint/connection-status?connectorId=
GET  /api/sharepoint/folders?connectorId=&parentItemId=&query=&cursor=
POST /api/sharepoint/folders

GET  /api/settings/sharepoint-filing?connectorId=
PUT  /api/settings/sharepoint-filing

GET    /api/companies/:companyId/sharepoint-folder
PUT    /api/companies/:companyId/sharepoint-folder
DELETE /api/companies/:companyId/sharepoint-folder
POST   /api/companies/:companyId/sharepoint-folder/verify

GET  /api/settings/sharepoint-filing/unassigned
POST /api/settings/sharepoint-filing/jobs/:jobId/retry
POST /api/settings/sharepoint-filing/jobs/:jobId/resolve
POST /api/settings/sharepoint-filing/jobs/:jobId/notes
```

Folder and mapping mutations must derive tenant from session, verify RBAC and workspace ownership of the connector, verify the item is a folder, and ensure client mappings are immediate children of the configured Client Documents root. Drive and folder comparisons use `(driveId, itemId)`. Settings updates merge rather than replace connector settings, and client-supplied names, URLs, continuation links, verification timestamps, and configuration versions are never authoritative.

The settings PUT body includes the workspace-owned `connectorId` plus user-editable root/toggle fields. The connector is always explicit; no endpoint chooses a system fallback or silently switches connectors.

## 10. Filing lifecycle

### 10.1 Job creation

When an eligible envelope transitions to complete, upsert one job per envelope document in the same database transaction as the completion state change. Snapshot the enabled workspace-owned connector configuration, company mapping, generated-document route, and naming inputs at that point. Webhook and completion-worker retries must converge on the unique ledger row.

The job may exist before its signed PDF is available. Claims join the completed envelope and require `pdfGenerationStatus = COMPLETED`, a non-null `signedStoragePath`, and internal storage readiness. This removes the crash window between signed-artifact completion and job creation. A terminal signed-artifact failure marks the corresponding filing rows `FAILED_PERMANENT` with a safe source error.

Only completions occurring while both deployment and workspace gates are enabled create jobs. A bounded reconciliation pass may recreate missing rows only for envelopes completed at or after the current `enabledAt`; it must never scan or enqueue earlier completed envelopes.

Do not automatically enqueue existing completed envelopes. Historical backfill requires a separate explicit administrator feature.

### 10.2 Route selection

| Condition | Destination | Reason |
|---|---|---|
| Mapping and valid template path exist | Company subfolder | `TEMPLATE_ROUTE` |
| Mapping missing | Orphan | `NO_COMPANY_MAPPING` |
| Template path blank | Orphan | `NO_TEMPLATE_PATH` |
| Manual document has no template route | Orphan | `MANUAL_DOCUMENT` |
| Company folder definitively not found | Orphan | `COMPANY_FOLDER_UNAVAILABLE` |
| Stored path is invalid | Orphan | `DESTINATION_PATH_INVALID` |

A transient verification error is retryable and does not prove a folder is unavailable.

### 10.3 Worker algorithm

1. While both deployment and current workspace gates are enabled, claim source-ready eligible rows transactionally using the existing durable-worker pattern, row locking such as `FOR UPDATE SKIP LOCKED`, a claim token, and lease expiry. Re-enabled workspaces may resume their existing rows regardless of the new discovery cutover.
2. Increment attempts and use the stored route/configuration snapshots; verify remote folder availability without substituting current mappings or template routes.
3. Resolve/create destination subfolders.
4. Read the signed PDF from internal storage.
5. Reserve the preferred filename or next controlled numbered suffix.
6. Upload the reserved filename with conflict behavior `fail`.
7. Persist item ID, URL, filename, destination ID, and filing time.
8. Mark complete only if the worker still owns the claim.

Expired leases are reclaimable.

### 10.4 Retry classification

Retryable errors include Graph `429` (honor `Retry-After`), `5xx`, network timeouts/resets, temporary token acquisition problems, temporary source-storage failures, and reconcilable uncertain outcomes.

Permanent/configuration errors include deleted or disabled connector, missing required root, persistent permission denial after credential verification, invalid stored metadata, or permanently missing source PDF.

Use exponential backoff with jitter. A corrected permanent job can be manually retried.

Retry automatically at most 10 times. Exhausted retryable work becomes `REVIEW_REQUIRED` and remains visible to administrators; a manual retry resets the automatic-attempt window. Persist a bounded, stable `lastErrorCode` separately from the redacted human-readable `lastError`.

### 10.5 Uncertain upload reconciliation

Before retrying after a timeout:

1. Fetch `uploadedItemId` if already persisted.
2. Otherwise inspect the persisted `targetFileName`; if allocation was interrupted, inspect the base and Oakcloud-reserved numbered candidates.
3. If one item matches the job's persisted destination, signed hash, and size evidence, adopt it and complete the job.
4. If conflicting items exist, stop automatic work and expose the job for administrator review.

## 11. Security and permissions

Prefer the least-privileged Microsoft Graph access compatible with deployment, ideally site-scoped access where practical.

Recommended Oakcloud policy:

| Action | Authorization |
|---|---|
| View company folder link | Company/profile read |
| Select/change/remove mapping | Company/profile update plus connector use |
| Create client folder | Company create/update plus connector use |
| Configure roots | Workspace connector/settings administration |
| Edit template route | Document-template create/update |
| Resolve unassigned queue | Workspace connector/settings administration |
| Run filing worker | Internal service context |

Requirements:

- All Graph calls are server-side.
- Never return credentials or tokens to the client.
- Reject shared/system connectors for every signed-document filing operation; never fall back to one during connector resolution.
- Scope connector, company, envelope, template, and filing records to the authenticated tenant.
- Reject arbitrary drive/parent IDs outside the connector's configured drive and permitted root.
- Require company mappings to be immediate children of the configured Client Documents root.
- Use opaque server-issued cursors and validate all Graph continuation URLs before attaching authorization headers.
- Persist canonical folder names and URLs returned by Graph rather than browser-supplied presentation data.
- Redact remote errors before persistence or display.
- Validate source type and size before upload.
- Apply existing session and mutation protections.

## 12. Auditing and operations

Audit root configuration changes, configuration enable/disable and cutover, company mapping select/change/remove/verify, remote client-folder creation, template route changes, legacy route fallback, intended/orphan filing, permanent/review-required failure, controlled filename suffix allocation, manual retry, administrator notes, and orphan resolution.

Record Oakcloud IDs and safe SharePoint item IDs, never credentials.

Monitor:

- Waiting-for-source, source-ready pending, retryable, permanent, review-required, paused-workspace, and orphan queue counts.
- Oldest source-ready pending age.
- Intended versus orphan completion rate.
- Filing latency.
- Graph throttling/error categories.
- Folder-create conflicts.
- Filename collision and suffix-allocation counts.
- Reconciliation outcomes.

## 13. Required edge-case behavior

- Company renamed: retain mapping by item ID.
- Folder renamed or moved in the same drive: retain mapping and refresh cached name/URL.
- Folder deleted: show stale state; route future documents to orphan only after definitive not-found.
- Same folder selected for two companies: reject and identify the existing mapping.
- Shared/system connector selected: reject and require a workspace-owned SharePoint connector.
- Company folder is a deeper descendant rather than an immediate child: reject.
- Root folders use different drives: reject.
- Concurrent folder creation: reuse the winning item after conflict.
- Blank template route: orphan, not company root.
- Manual document without template: orphan.
- Mixed-template envelope: independent destinations.
- Repeated webhook: one ledger row and one remote file.
- SharePoint failure during company creation: company remains saved.
- Connector replaced: existing mappings require explicit migration/repair.
- Orphan root missing: retain internal copy, show configuration failure, allow retry.
- Backslashes in template path: normalize after validation.
- Existing filename collision: reconcile the current job; if it is a different item, reserve and use ` (1)`, ` (2)`, and later suffixes deterministically.
- Template edited after document generation: the generated-document route snapshot remains unchanged.
- Mapping or roots changed after job creation: automatic retries retain the job snapshots; only an audited recovery action may override them.
- Crash after envelope completion but before signed artifacts are ready: the pre-created filing rows wait for source readiness and are not lost.

## 14. Single-phase implementation plan

Deliver this feature in one phase. The following workstreams are ordered for dependency management, not separate releases. Automatic filing is enabled only after all workstreams and acceptance tests are complete.

1. **Schema and shared contracts**
   - Add company mapping table, template field, generated-document route snapshot, filing ledger/snapshot/error fields, enums, migrations, typed settings schema, folder-reference type, and relative-path validator.

2. **SharePoint service hardening**
   - Add workspace-owned connector resolution, folder verification/list/create/path resolution, controlled filename allocation, duplicate-safe upload, same-drive move, reconciliation, opaque pagination, and short-lived child cache.

3. **Settings and shared picker**
   - Implement connection check, root configuration, shared browse/client modes, substring search, folder creation, and permission/error states.

4. **Company workflows**
   - Implement profile display and mapping actions, ordinary create/edit integration, BizFile review integration, deferred creation, failure warnings, uniqueness, and audits.

5. **Template routing**
   - Add editor field, preview, validation, service persistence, duplication, history, backup/export/import, and audits.

6. **Durable filing pipeline**
   - Transactionally create per-document jobs at completion, gate claims on signed-source readiness, implement snapshots/leases/retries/review escalation, resolve nested folders, reserve filenames, upload from internal storage, reconcile uncertain results, and emit metrics/audits.

7. **Recovery queue**
   - Implement orphan/permanent-failure listing, mapping repair, destination selection, move/upload resolution, retry, and audit notes.

8. **Integrated verification and enablement**
   - Complete unit, service, API, component, browser, security, concurrency, crash-recovery, and non-production Graph smoke tests; update operational/user documentation; then enable the deployment kill switch and workspace toggle.

Existing companies remain unmapped, existing template paths remain null, and historical envelopes remain untouched.

## 15. Likely code touchpoints

Database and validation:

- `prisma/schema.prisma`
- `prisma/migrations/`
- `src/lib/validations/document-template.ts`
- Company profile/request validation
- New SharePoint settings/path validators

SharePoint:

- `src/services/sharepoint.service.ts`
- `src/app/api/connectors/[id]/sharepoint/route.ts`
- New focused SharePoint/settings routes
- Connector settings UI

Companies:

- `src/components/companies/company-detail/company-profile-sections.tsx`
- Company create/edit forms
- `src/services/company/profile-sections.ts`
- `src/components/companies/bizfile-review/bizfile-review-workspace.tsx`
- `src/app/(dashboard)/companies/upload/page.tsx`
- New reusable picker and hooks

Templates and e-signing:

- Template editor/detail and service logic
- Template audit and import/export logic
- `src/services/esigning-completion.service.ts`
- Signed PDF/internal-storage service
- New SharePoint filing repository/service/worker
- Worker bootstrap and health reporting

Review the current SharePoint service's connector lookup so every new operation is tenant-scoped before credentials are decrypted. Keep SharePoint filing separate from existing internal `autoFilingStatus`.

## 16. Testing requirements

Unit tests:

- Path normalization/rejections.
- Filename sanitization, base-name determinism, numbered suffix allocation, and allocation exhaustion.
- Every routing reason.
- Retry classification.
- Settings merge/schema behavior, including legacy/current mailbox keys and unknown future keys.

Service/API tests:

- Child pagination and substring filtering.
- Exact case-insensitive matching.
- Nested and concurrent folder creation.
- Upload collision reconciliation without rename.
- Atomic destination/name reservation and same-title collision suffixing.
- Job claim, lease expiry, lost claim, and retry.
- Transactional completion enqueue, source-readiness gating, and cutover-bounded reconciliation.
- Mapping uniqueness, immediate-child enforcement, same-drive enforcement, and folder-root containment.
- Shared/system connector rejection before credential decryption.
- Opaque-cursor tamper and continuation-host rejection.
- RBAC and cross-tenant rejection for every route.
- Audit creation and settings preservation.

UI/browser tests:

- Picker loading/search/empty/error/create/select states.
- Company creation survives SharePoint failure.
- BizFile pending selection.
- Profile browser link and stale repair.
- Template preview and validation.
- Queue retry and resolve flows.
- Queue notes and destination-mode selection.

End-to-end tests:

- Service agreement to agreement folder.
- Resolution to `1c. Resolutions`.
- Nested missing folders created.
- Mixed-template envelope split correctly.
- Template route changed after document generation does not alter the generated-document snapshot.
- Mapping or roots changed after job creation do not alter automatic retry snapshots.
- Missing mapping/path/manual document to orphan.
- Repeated webhook creates no duplicate.
- Timeout after successful upload reconciles.
- Two documents that request the same destination filename receive the base and ` (1)` names without overwriting.
- Crash/failure between completion and signed-artifact readiness does not lose filing rows.
- Definitively deleted company folder routes to orphan.

Use a mocked Graph adapter for deterministic automation and a non-production SharePoint site for smoke tests.

## 17. Acceptance criteria

1. Administrators can select and verify both root folders.
2. Only workspace-owned SharePoint connectors are eligible, and system/shared connectors are rejected before credentials are decrypted.
3. Users can substring-search immediate client folders, select one, or create one.
4. Company mappings store stable IDs and an accessible browser URL and are limited to immediate children on the configured drive.
5. Company detail opens the correct SharePoint folder.
6. Ordinary and BizFile creation save mappings without SharePoint failure blocking company creation.
7. Templates save validated simple or nested relative paths and generated documents snapshot those routes.
8. Missing destination subfolders are safely created below the snapshotted company folder.
9. Each eligible completed envelope document has an independent filing row created transactionally before signed-source readiness.
10. Internal signed files remain available regardless of SharePoint state.
11. Retries and repeated webhooks cannot overwrite or duplicate the same job; genuine name collisions receive controlled numbered suffixes.
12. Unresolved routing reaches the orphan folder and queue.
13. Transient Graph failures retry the intended destination and escalate to review after bounded attempts.
14. Administrators can add notes, repair, retry, move, and resolve queue items idempotently.
15. Cross-tenant, system-connector, cross-drive, tampered-cursor, and out-of-root references are rejected.
16. Configuration, mapping, snapshots, filing, suffix allocation, failure, review, retry, notes, and resolution are audited.
17. The deployment kill switch and workspace enablement cutover prevent automatic historical filing.
18. All workstreams and required tests are complete before automatic filing is enabled.

## 18. Fresh-session handoff checklist

Before implementation, the next session should:

1. Read this specification and `guides/DESIGN_GUIDELINE.md`.
2. Inspect current Prisma naming, permission constants, audit helpers, connector settings validation, and durable-worker conventions.
3. Confirm how signed PDFs are represented per document in multi-document envelopes.
4. Confirm a workspace-owned SharePoint connector's site/library access in a non-production environment; do not use the system-connector fallback.
5. Add a short implementation plan covering all eight workstreams in one phase.
6. Preserve unrelated working-tree changes.
7. Implement with one folder-reference type and one shared path validator.
8. Keep `SHAREPOINT_SIGNED_FILING_ENABLED` off and do not enable workspace filing until the complete acceptance suite passes.
