# WORKFLOW agent plan: persistence, routes, generation and output

Status: **not started**. Owner: W. Read [README](README.md), [contracts](contracts.md), review A4E-005, 013–024, 027–029 and the end-to-end flow. W is the sole writer of the template/partial and generated-document route pages and all generation-batch components.

## Context and objective

Template save currently reads delayed form content. Generated-document save clears dirty state after an in-flight request without checking for newer edits. Standalone draft autosave is declared but unused. Batch review drops edited contentJson and reuses an editor across items without session identity. Preview contracts differ, and output strips structures that the editor supports. A failed PDF pagination pass can fall through to clipped fixed-height sections.

Make every route save, preview and export the same complete canonical snapshot. Protect concurrent edits with server revisions, preserve per-item metadata and drafts, and keep old/new document formats readable throughout rollout. Reuse canonical document/template/partial/batch services and existing authentication, tenant, audit and integration boundaries.

## Owned scope and dependencies

Own W files in README: template/partial and generated-document route pages; generation-batch directory; document template/partial/generator/export services, batch services, related APIs and validation schemas, Prisma/migration changes, server font adapter, bundle script and generated pagination bundle. I owns package/config/lockfile integration. Request leases for shared hooks/helpers outside this scope.

Consume C01 session snapshots from CORE; C02/C03 positions/break parsing and C09 layout/engine from S; C05/C06 parser, definitions, typed fields and policy from F. Produce C07 revision/save/draft API, C08 route/preview behavior and C09 output implementation. W must not recreate parser, sanitizer policy, field identity or editor history in its own modules.

Read especially:

- `src/app/(dashboard)/template-partials/editor/page.tsx`: mutation callbacks, field changes, preview/save, editor props.
- `src/app/(dashboard)/generated-documents/[id]/{page.tsx,edit/page.tsx}`: read-only view, draft recovery, save/export.
- `generation-batch/{use-document-generation-batch,batch-review-workspace,document-generation-batch-workspace,batch-custom-field-form}.tsx/ts` and API client/reducer.
- `src/services/{document-template,template-partial,document-generator,document-export}.service.ts` and `src/services/document-generation-batch/*`.
- Related API routes and `src/lib/validations/{document-template,generated-document,document-generation-batch}.ts`; `prisma/schema.prisma` models in review B.
- `scripts/build-pagination-bundle.mts`, `scripts/run-a4-editor-smoke.mjs`, export-layout and generation/batch PostgreSQL tests.

## W0 — Writer, reader and deployment inventory

Entry: this plan; runs beside C0/S0/F0. No migration applied or deployment performed merely for inventory.

- [ ] Search all `documentTemplate`, `templatePartial` and `generatedDocument` create/update/upsert/updateMany paths in application/services/scripts. Classify each by content/layout/title/letterhead/status mutations, version behavior, auth/tenant scope, audit and external side effects.
- [ ] List every consumer of template/partial/document read/write APIs, including batch materialization, service-agreement flows and task/e-signing integrations. Identify consumers that will not immediately send expectedRevision.
- [ ] Inventory every document reader: editor, read-only view, resolver/partial expansion, test preview, batch preview, local print, HTML/PDF export, server workers/static bundle and any downstream stored-content consumers.
- [ ] Confirm how deployment configuration/capabilities are propagated today. Propose one central writer-level/revision-enforcement mechanism; do not scatter hard-coded flags in each component.
- [ ] Capture a real two-page synthetic PDF/HTML baseline with heading, start5 nested list, quote, caption/footer table, field and hard break. Save text/order and rendered images outside source or in approved synthetic test artifacts.
- [ ] Reproduce save during delayed onChange/response, two-client conflict and per-item layout loss as new tests. Verify draft API read returns required metadata; currently `getLatestDraft` selects content/contentJson/createdAt but not its metadata.
- [ ] Define the additive GeneratedDocument revision migration and all writer updates. Avoid a generic schema cleanup or index-name drift migration.

**W0 output:** concrete writer/consumer matrix, capability design, exact proposed API response/input shapes, migration/rollback notes and failing workflow/output tests. Publish requests to F for schema metadata preservation and S for all output break representations.

## W1 — Reader expansion, safe export and revision plumbing

Entry: G0. Revision/failure-path work can proceed while S1/F1 modules are being completed; reader integration consumes their merged exports. New v2 writers and changed field escaping remain disabled.

### W1a: content compatibility and export containment

1. Replace independent sanitizer allowlists with C06 adapters at route/service/output boundaries; preserve approved structures and unknown supported metadata. F owns policy definitions, S owns structural break/CSS semantics.
2. Teach all read/render/export paths both legacy top-level and v2 nested break formats. Do not merely allow the marker attribute while ignoring its pagination meaning. Partial content must be detected without contentJson.
3. Make PDF pagination failure explicit. Remove clipped fixed-height success fallback; return a typed retryable export error without losing stored content. A genuinely complete natural-flow fallback is allowed only if proven with tall-content sentinels and layout tests.
4. Await font readiness before measurement and propagate explicit failure/timeout. Keep bounded server resource cleanup in finally blocks. Do not log document HTML or supplied values when export fails.
5. Regenerate the pagination bundle after S1 integration through the existing script; give I a freshness-check command/change for build integration. The bundle and the server consumer must be from compatible commits.
6. Implement additive capability information and reject unsupported new-format writes server-side. An older writer must not sanitize away a nested marker and save a silently changed document.

### W1b: persistence revision

- [ ] Reuse template/partial `version`; add explicit GeneratedDocument `revision` with an additive forward migration/default, preserving `templateVersion` as provenance. No new index is needed without a query-plan reason; primary ID plus scoped predicate is the basic access path.
- [ ] Add expectedRevision inputs and additive acknowledged revision outputs using C07. During reader expansion, document the transitional behavior for missing preconditions; it is not equivalent to safe concurrency.
- [ ] Use an atomic tenant/deleted/status/revision predicate and increment. Do not fetch, compare in JavaScript, then update by ID alone. Zero affected rows become scoped not-found, lock or conflict according to existing error conventions, without leaking another tenant's existence.
- [ ] Update every canonical writer identified in W0 to increment/check revisions appropriately. Content-changing batch materialization and status transitions must not evade the same concurrency protection. Keep existing server-authoritative batch fingerprints/revisions.
- [ ] Keep auditability with the existing audit helper and established transaction pattern. If audit persistence cannot share the write transaction, document and test the existing recoverable/idempotent behavior; do not invent a separate agent audit pipeline. Request a narrow helper lease if needed.
- [ ] Preserve existing side-effect ordering: external service/task/e-signing actions remain on canonical paths after validation/commit, with their existing idempotency safeguards. Do not trigger external actions from a generic editor-save adapter.
- [ ] Generate Prisma through the repository workflow and test migration from the existing baseline plus full migration replay on a disposable database. Never reset the user's database.

**W1 acceptance:** all readers preserve v1/v2 synthetic content; the two-page list/quote/caption fixture retains structure and explicit breaks; forced pagination failure cannot return a clipped success. Concurrency tests show one of two writes from revisionR succeeds and the other conflicts; locked/other-tenant/deleted records cannot be written. Older clients remain readable and the enforcement transition is explicit.

## W2 — Route snapshots, save acknowledgement, batch state and drafts

Entry: C1 + F1 + W1. CORE supplies the editor API; W changes the route and batch callers. Preserve existing component public behavior while migrating each route. W2 can implement complete-snapshot adapters and contract tests before F2 lifecycle operations are finished; actual new lifecycle behavior waits for F2/F3 and W3 integration. Do not fill that dependency with a duplicate field implementation.

### Template and partial editing

- [ ] Initialize session identity, complete contentJson and field definitions once per loaded entity. Preserve unknown metadata and partial/source definitions. Controlled query refresh must not overwrite dirty local edits.
- [ ] Save from `prepareSnapshot/getSnapshot`, not delayed form HTML. Snapshot includes content, layout and definitions; merge non-editor form fields into that same save request.
- [ ] Keep one in-flight save per entity; Ctrl+S observes the same state. Capture local revisionN and server revisionR. On success acknowledge only N, retain any newer edits and use returned server revision for the next save.
- [ ] Navigate back only when the acknowledged revision is still current or the user explicitly chooses to leave. A late successful response cannot discard newer work or clear its dirty flag.
- [ ] Apply F lifecycle transactions via the editor/session complete snapshot hook. Do not remove references by an independent form setter while the definition change is absent from history.

### Batch review

- [ ] Pass stable per-item sessionKey and preserve each item's current snapshot before switching. Server echoes/reordered queue positions are not new document identities.
- [ ] Derive layout from editedContentJson first, then template/defaults. Content-only edits preserve metadata instead of passing null; layout changes call the existing merge helper and preserve other keys.
- [ ] Make reducer/persist acknowledgement revision-aware: if newer local edits arrive during a save, rebase them on the acknowledged server revision rather than replacing all local state with the response.
- [ ] Preserve batch reviewedFingerprint behavior. Any content/layout/value change clears review as appropriate; new client snapshot IDs do not replace server fingerprints.
- [ ] Test conflict/reload/overwrite behavior without automatic data loss. An overwrite option must be explicit and based on a current server revision; preserve the local copy before replacement.

### Standalone document save and draft recovery

- [ ] Use the same C01/C07 snapshot/acknowledgement rules and shared unsaved navigation guard for SPA links/back as well as browser unload.
- [ ] Wire the existing draft API to debounced settled snapshots. Distinguish Draft saved from Document saved. No active composition or unreconciled native edit is falsely acknowledged.
- [ ] Persist/retrieve base server revision, session identity and local revision in existing draft metadata; extend canonical draft read DTO as necessary. Preserve metadata when restoring via the editor snapshot replacement contract.
- [ ] Make saveDraft's existing delete-old/create-latest operation atomic and safe for overlapping requests. It currently deletes this user's document drafts then creates one; do not let stale requests delete a newer snapshot. Define a sequence/session predicate or serialize with a tested database transaction strategy.
- [ ] A successful document save discards only drafts covered by the acknowledged snapshot, not newer drafts or another user's drafts. No blanket delete-all-drafts cleanup.
- [ ] Test restore against a newer server revision and finalized/archived status. Preserve local content with clear recovery choices; do not silently overwrite current document state.

### Current preview snapshot

Use a thin unsaved-template render adapter around `renderTemplateForGeneration` or the canonical shared boundary it already uses. Include complete unsaved definitions/defaults/layout/composition and explicitly selected sample/context data. Do not create a temporary persisted business template just to render a preview. Client results are applied only for the still-current session/snapshot/context; expose all relevant diagnostics and retain Retry after errors. F supplies parser locations/labels; CORE performs focus/selection.

**W2 acceptance:** immediate Save/reopen contains the last edit; newer in-flight edits stay dirty; batch A/B histories/layouts remain separate; stale preview responses cannot replace current ones; draft recovery works through a reload and internal navigation protection. Verify through UI + actual API persistence, not mocked success alone.

## W3 — Field, preview and output completion

Entry: W2 + F2 + S2; final acceptance consumes F3/S3/C3. Independent work may start before those last providers finish, but the final gate waits for all. Publish shared print/schema/input producer commits early for CORE C3 and F3 to consume; then verify their integrated route behavior. This avoids a circular wait on each packet's final acceptance.

- [ ] Apply F's typed input descriptors to `batch-custom-field-form` and template route callbacks. Preserve false/zero/date/multiline semantics and existing master/default precedence.
- [ ] Integrate F's scoped partial resolver/bindings through canonical generation and test preview. Verify duplicate note fields across parent/nested partials resolve their own values; linked fields intentionally share.
- [ ] Preserve stable IDs, legacy types/options/path/source and unknown supported metadata through API Zod schemas. Coordinate schema changes with F; do not allow local adapter tests to conceal server stripping.
- [ ] Enable plain-text escaping only for the rollout's explicit field policy. Preserve inventoried rich fragments through trusted canonical builders and sanitizer; never accept a client-provided “trusted” flag.
- [ ] Ensure templates, partials, generation snapshots and restored drafts carry supported schema features consistently. Do not regenerate finalized documents or overwrite historical placeholderData/dependency snapshots from current templates.
- [ ] Share page-assembly preparation for local print and server PDF/HTML with CORE. Remove broad break-CSS content deletion in CORE's integration; ensure HTML export retains valid caption/quote/footers/list-start semantics.
- [ ] Apply persisted page-number setting only after all output paths support it. Verify letterhead geometry and watermark under default/non-default margins, cold fonts and long dynamic values.
- [ ] Regenerate/check pagination bundle after final S changes. Verify deployment workers/static assets read the same format as server/API/frontend.
- [ ] Complete service-agreement and task-launched generation regressions through canonical services, including reviewed/manual content preservation and integration permissions. Use synthetic data; no real external signing/filing/messages during QA.

**Acceptance:** edited template→save/reopen→preview→batch configure/review→generated DRAFT→manual edit/save→PDF/HTML/local print preserves supported content, numbering, breaks, values and layout. Forced failures remain recoverable; old snapshots remain readable. Complete C07 strict-enforcement and C03/C05 writer capability rollout tests before enabling those behaviors.

## Validation commands and constraints

Use Node24. Start with the existing targeted service/lib/component suites for the modified subsystem; key existing files include:

- `__tests__/services/document-generator.service.test.ts`, `document-generator-party-loops.test.ts`, `document-generation-batch-preview.service.test.ts`, `document-generation-batch-lifecycle.service.test.ts`, `document-generation-batch-generation.service.test.ts`, `document-export-layout.test.ts`.
- `__tests__/lib/document-generation-{master-fields,fingerprint,batch-validation,batch-api}.test.ts`, and template/partial versioning/composition tests.
- `__tests__/integration/document-generation-batch.postgres.test.ts`; add a focused disposable-PostgreSQL concurrency suite for template/partial/generated revisions and drafts. I owns test-runner/environment configuration changes.
- `npm run test:a4:smoke` requires `A4_SMOKE_URL` and `A4_SMOKE_EXISTING_URL`. Inspect the smoke test's mutations first and point it only at explicitly disposable authorized fixtures; missing environment is a blocked check, not a skipped pass.

Run actual PDF creation and render both/all relevant pages; HTML-string snapshots alone do not validate export. For migration checks use the established forward workflow and record target database identity. Never use `db push` or reset to avoid designing/applying the migration correctly.

## Handoff and dispatch prompt

Return updated writer/reader matrix, C07/C08/C09 APIs/examples, migration files and checks, consumer changes, exact capability configuration, compatibility minimum deploy version, test results and the D0/D1/D2 rollout procedure. List unresolved external environments or real clipboard/AT/letterhead checks explicitly.

> Implement packet **W0** first using this plan and contracts v1. Inventory canonical writers/readers and API clients, create failing save/layout/export fixtures, and propose the additive revision/capability rollout. Coordinate F0 policy/definitions and S0 break readers. Stay within W-owned files; do not deploy, mutate real business data, enable new-format writers or change CORE-owned editor code. Return the concrete G0 API/migration/compatibility handoff before W1.
