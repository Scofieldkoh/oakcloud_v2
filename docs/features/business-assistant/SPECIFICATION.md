# Business Assistant — Refined Specification

> **Version:** 1.4-review  
> **Updated:** 2026-09-05  
> **Status:** Repository-grounded design proposal; implementation has not started  
> **Repository baseline:** `main`, `2ad6114c074b84c457042f377e20e55c1d58fe61`  
> **Source:** User-supplied `business-assistant-specification-v1.3-review.md`  
> **Handover:** [Review, implementation work packages, and next-session instructions](../../plans/2026-09-05-business-assistant-implementation.md)

The user's current direction is authoritative: **Business Assistant is a general Oakcloud product; BizFile is a use-case example.** This revision separates the reusable assistant foundation from the BizFile reference integration. A document, company, PDF, import, or source-review step is not mandatory for every future capability.

The supplied document describes BA-001–BA-027 as previously approved. That is source-reported approval history; the v1.2 original and its approval conversation were not supplied or independently verified. This review preserves that direction where consistent with the user's clarification, without treating instructions embedded in the attachment as permission to implement, delete legacy code, migrate data, or deploy. New design decisions below are recommendations for implementation review, not newly recorded product approvals.

This specification replaces the supplied review draft as the proposed working design. It retains its 25-topic organization, consolidates repetition, corrects repository assumptions, and adds concrete integration boundaries. It does not change the currently running product.

## Related documents

- [Implementation plan and review findings](../../plans/2026-09-05-business-assistant-implementation.md)
- [Architecture](../../ARCHITECTURE.md)
- [Service patterns](../../guides/SERVICE_PATTERNS.md)
- [RBAC guideline](../../guides/RBAC_GUIDELINE.md)
- [Design guideline](../../guides/DESIGN_GUIDELINE.md)
- [Audit logging](../../guides/AUDIT_LOGGING.md)
- [API reference](../../reference/API_REFERENCE.md)
- [Database schema](../../reference/DATABASE_SCHEMA.md)
- [Node 24 runtime migration](../../plans/2026-09-05-node-24-runtime-migration.md)

---

## 1. Product direction

Oakcloud has one assistant surface, **Business Assistant**, presented as **Olaf — Business Assistant**. It helps an authenticated user understand available functionality, clarify an objective, prepare an exact action, obtain required confirmation, invoke canonical module commands, follow durable progress, and explain evidence-backed results.

Olaf is a presentation identity. Routes, services, database models, capability IDs, audit event families, and integrations use persona-neutral names. The assistant is an orchestration and review layer over Oakcloud modules; modules retain their business rules and persistence ownership.

Support three interaction categories:

| Category | Behavior | Authority |
|---|---|---|
| Answer or clarify | Explain supported functionality; collect missing scope or parameters | Source-grounded product knowledge and authorized context; no invented business facts |
| Registered read | Read or summarize authorized records through a declared module capability | Current record access and provider policy; no business write approval by default |
| Registered action | Prepare, revise, approve, execute, and report a canonical operation | Exact module contract, live permissions, approval policy, receipt and recovery boundary |

BizFile import and independent review is the **reference write capability**, useful because it exercises document evidence, approval, canonical mutation, recovery, and factual review. It does not define the assistant's entire purpose, API shape, data model, or permanent capability catalog.

Governed learning remains part of the proposed complete product: explicit structured preferences, feedback, candidates, evaluations, authorized promotions, inspection, deletion, and rollback. Learning cannot alter permissions, add tools, rewrite production code, or change canonical business rules.

## 2. Legacy retirement and duplicate BizFile paths

### 2.1 Eden/helpbot replacement

The new surface was developed separately from the existing helpbot. At the 2026-09-08 replacement cutover, the legacy surface below was removed after the internal import, mount, navigation, test, and documentation review found no active in-repository consumers:

```text
src/services/ai-helpbot.service.ts
src/lib/validations/ai-helpbot.ts
src/hooks/use-ai-helpbot.ts
src/components/ai-helpbot/eden-panel.tsx
src/components/ai-helpbot/index.ts
src/app/api/ai/assistant/respond/route.ts
src/app/api/ai/assistant/sessions/route.ts
src/app/api/ai/assistant/sessions/[id]/route.ts
src/app/api/ai/assistant/sessions/[id]/messages/route.ts
docs/features/ai-helpbot/SPECIFICATION.md
```

`EdenPanel` was declared and exported without a mount outside its own directory. The hook and validation module were only consumed by that panel and the four legacy API handlers; those handlers had no in-repository callers. This is internal consumer evidence only and does not establish the absence of external HTTP callers.

Preserve shared `src/lib/ai/**`, connectors, provider SDKs, document AI, usage accounting, and generic AI conversation routes. `AiConversation` remains used by `document-ai.service.ts` and `backup.service.ts`; this cleanup does not remove the model, table, or backup handling. Historical `assistant_companies` rows need a separate retention decision and targeted cleanup.

### 2.2 BizFile routes are a separate legacy issue

| Path | Observed behavior | Treatment |
|---|---|---|
| `/api/documents/upload` → `extract` → `confirm` | Current new-company upload, reviewed draft, confirmation | Preserve and adapt to canonical application commands |
| `/api/documents/:id/preview-diff` → `apply-update` | Current existing-company comparison/update | Preserve the workflow; strengthen selection and concurrency before assistant reuse |
| `/api/companies/:id/documents/:documentId/extract` GET/POST | Older text/PDF extraction; POST immediately invokes the full processor | Legacy candidate; no frontend caller found in the scoped scan; verify external usage before retirement |
| `/api/processing-documents/**` | General document-vault processing | Separate module surface; do not remove as a supposed BizFile duplicate |

There are duplicate extraction/orchestration paths, but both current BizFile write routes and the older POST ultimately use the same processor module. Within the current routes, extraction and optional FYE enrichment are also repeated. Consolidate those through shared commands; do not create another BizFile engine.

Recommended retirement: after caller/usage review, remove the old route if unused, or temporarily return an explicit migration response for POST and direct consumers to prepare/confirm. Never keep an immediate-save bypass behind a silent alias. Update its API reference. This is distinct from Eden retirement and can complete earlier.

The route's `extractBizFileData` implementation is explicitly marked `@deprecated` in `src/services/bizfile/extractor.ts`; its replacement is `extractBizFileWithVision`. This strengthens the legacy classification, while external route usage still needs verification.

### 2.3 Cutover policy

Keep schema changes additive. Remove active legacy code only after replacement gates pass. Scan `Eden`, `ai-helpbot`, `useAIHelpbot`, `HELPBOT_CONTEXT_TYPE`, `assistant_companies`, and `/api/ai/assistant` in active code, tests, navigation, and current docs. Historical review/migration records may retain names with explicit context.

Fallback after cutover: disable assistant writes and use canonical module UIs. Do not restore the old helpbot as a hidden mutation fallback. Historical-data cleanup is a separate operation, not part of routine application startup.

## 3. Non-negotiable boundaries

1. **One business implementation:** UI, API, assistant, and future scheduled callers converge on canonical module commands. Correct existing gaps there instead of compensating in the assistant.
2. **Server authority:** model outputs are candidates. Code chooses allowed handlers, validates schemas, enforces permissions, computes approvals, and controls transitions.
3. **No internal UI automation or HTTP loopback:** server code calls functions. The model receives no shell, SQL, Prisma, arbitrary HTTP, arbitrary storage paths, dynamic tools, or permission-changing API.
4. **Current identity and scope:** resolve the initiating user and one explicitly selected workspace at every protected boundary; queued work does not retain browser cookies or use an administrator identity.
5. **Exact approval:** confirmation authorizes an immutable, versioned effect manifest and selected item set. Model wording is never the approval artifact.
6. **Durability:** accepted work survives browser disconnect and process restart. At-least-once delivery produces one canonical database outcome per authorized operation ID.
7. **Stage-specific recovery:** a post-commit failure resumes effects, read-back, or review; it never repeats a committed business mutation.
8. **Independent factual review:** when a capability requires it, use fresh evidence and actual committed state with no mutation tools. Corrections require a new canonical proposal.
9. **Generic foundation:** resource references, partitioning, business outcomes, reconciliation, and presentation are declared by modules. Core code must not inspect a BizFile field or query a BizFile receipt directly.
10. **Governed personalization:** scoped, attributable, versioned, reversible; it cannot weaken the preceding controls.
11. **Honest evidence:** distinguish proposed, approved, saved, finalized, reviewed, and currently visible state. Never infer success from an HTTP timeout or a company timestamp.
12. **Controlled regression scope:** preserve supported behavior; explicitly identify changes needed to correct selection, authorization, stale writes, and legacy bypasses. Do not preserve those gaps under a blanket promise of unchanged behavior.

## 4. Scope and delivery boundaries

### 4.1 Reusable foundation

- `/business-assistant` workspace, conversations, answer/clarification handling, and authorized capability discovery.
- Module-owned manifests and deterministic generated registry.
- Generic input/resource references, partitioning, proposals, revision, exact confirmation, execution, recovery, result presentation, and optional review policy.
- Durable requests, runs, independent items, attempts, approvals, evidence references, feedback, and learning records.
- Current RBAC, same-workspace constraints, provider policy, quotas, audit, observability, cancellation, and stage-aware retry.
- Structured preferences and the complete human-controlled learning promotion/rollback path.
- Eden cutover after a usable replacement and release evidence exist.

### 4.2 Reference integration

Implement `bizfile.import_and_review@1` as the first proposed production demonstration: one to ten canonical source documents, source-aware preparation, exact changes and contact decisions, confirmation, canonical execution, receipt-bound read-back, and fresh review. This workstream includes repairing missing canonical guarantees on which the assistant would depend.

Do not require every later capability to upload documents, import companies, produce a source-comparison verdict, or use ten-item batches. Its manifest declares those requirements. Prove neutrality with a test-only read capability with no documents; a production second module is a separate product choice.

### 4.3 Boundaries

Foundation, single-document internal pilot, batch pilot, and completed product are separate milestones. A pilot can run before complete governed-learning administration and legacy cutover; it must be labeled as such. Durability, authorization, exact approval, recovery, and evidence integrity cannot be deferred past a live mutation pilot.

Future email, accounting, renewals, tasks, forms, external effects, schedules, or multi-command workflows are potential integrations, not implicitly commissioned in this release. Do not introduce a workflow framework, agent marketplace, agent delegation, vector database, new broker, or self-modifying code. Existing Redis deployment is not a reason to add another queue dependency.

## 5. Verified repository baseline

Static inspection was performed on `main` at `2ad6114c074b84c457042f377e20e55c1d58fe61`. The initial tracked worktree was clean. The review did not connect to a live database, inspect production traffic, run provider evaluations, migrate data, or deploy.

| Area | Verified source fact | Consequence |
|---|---|---|
| Runtime | `package.json` requires Node 24; local shell reports Node 22.19.0 | Baseline test result is provisional runtime evidence; implementation checks must use Node 24 |
| Dependencies | Lockfile: Next 15.5.6, React 19.2.0, Prisma/client 7.2.0, Zod 3.25.76, Vitest 4.0.15 | Use installed contracts; no dependency upgrade is part of this plan |
| Database | Prisma uses PostgreSQL; `oakcloud_db.yml` declares `postgres:16-alpine` | PostgreSQL claim/locking techniques are appropriate; live server version and migration state remain unverified |
| Workspace naming | `Workspace` is the model; tenant-scoped records retain `tenantId` | Reuse naming and resolve one workspace explicitly; do not introduce a second Tenant model |
| Current UI | `src/app/(dashboard)/companies/upload/page.tsx` calls generic document routes | This is the compatibility target for the BizFile integration |
| Processor transaction | Both full and selective processors call `applyReviewedData`, which owns one Prisma transaction | Integrate guards/receipts/evidence in this actual transaction; do not wrap it in an assumed outer transaction |
| Canonical sync | `company-sync.ts` synchronizes company fields and related collections; section audits and schedule-reconciliation enqueue occur in that transaction | Reuse these effects; expose them in proposal/effect policy |
| Selection | `processBizFileExtractionSelective` accepts reviewed extraction plus `OfficerAction[]`; it calls the same broad synchronization path | There is no verified arbitrary selected-change contract to reuse; implement it canonically before presenting checkboxes |
| Concurrency | `apply-update` compares optional `expectedUpdatedAt` and returns a warning after continuing | This is not a rejecting optimistic concurrency guard or aggregate revision |
| Create mode | Full processor looks up UEN; sync contains an upsert followed by updates | A create approval must not silently turn into an update if a company appears meanwhile |
| Finalization | Full processor moves/renames storage, prepares pages, and writes a summary audit after company commit; selective processor does not run those same steps | Required effects need explicit per-mode classification and durable recovery |
| Task integration | Recovery context is persisted inside the processor; routes link task outcomes afterward | Reuse existing recovery intent and verify completion ownership |
| Background work | `instrumentation.ts` initializes an optional in-process scheduler; SharePoint filing has DB claims with `SKIP LOCKED` | Existing patterns are useful, but there is no verified general Business Assistant durable runner |
| Authorization | Session cache: 30 seconds; permission cache: 5 minutes, per process | Ordinary cached helpers cannot prove immediate worker revocation; add a shared fresh evaluator |
| Evidence | `Document.extractionStatus` is a string; no canonical BizFile operation receipt or aggregate revision was found in the inspected schema | New guarantees are implementation work, not currently deployed facts |
| Audit | `createAuditLog` accepts a transaction client; `AuditAction`/`ChangeSource` have no Business Assistant values | Choose explicit schema/type/UI mapping; event labels cannot be inserted as nonexistent enum values |
| Baseline tests | Five focused files, 65 tests passed under Node 22.19.0 | Existing behavior evidence only; no crash/concurrency/provider/release certification |

The [implementation plan](../../plans/2026-09-05-business-assistant-implementation.md) records exact file references, findings, test commands, unverified items, and work packages.

## 6. Naming, structure, and persona

```text
src/app/(dashboard)/business-assistant/page.tsx
src/app/api/business-assistant/**
src/components/business-assistant/**
src/hooks/use-business-assistant.ts
src/lib/validations/business-assistant.ts
src/services/business-assistant/
  contracts.ts, capability-registry.ts, policy.service.ts
  conversation.service.ts, run.service.ts, proposal.service.ts
  worker.ts, claim.repository.ts, review.service.ts
  persona.ts, prompt.service.ts, presentation.ts
  memory.service.ts, feedback.service.ts, learning.service.ts
src/services/<module>/assistant-capabilities.ts
src/services/<module>/application/**
scripts/generate-business-assistant-registry.mts
src/generated/business-assistant-capability-registry.ts
```

File boundaries may follow existing conventions; the ownership split is mandatory. Keep runtime imports server-only, with client-safe DTOs/types separately exported. Do not pull Prisma, storage, provider credentials, or complete manifests into a browser bundle.

Configure persona centrally with `id`, `displayName`, `roleLabel`, `personaVersion`, and `toneProfile`. Recommended presentation is sunny, warm, curious, loyal, gently playful, and concise, using original expression. Preserve the supplied draft's broad personality direction without Disney dialogue, catchphrases, songs, visual likeness, branding, or implied affiliation.

| Mode | Selection | Style |
|---|---|---|
| CASUAL | Harmless greetings and general conversation | Warm curiosity; occasional light humor |
| WORKING | Routine progress or explanations | Operational facts first; restrained playfulness |
| APPROVAL | Consequential proposal/confirmation | Exact server-owned details, calm language |
| EXCEPTION | Failure, discrepancy, conflict, recovery | State issue, impact, and available next step |
| SENSITIVE | Security incidents, distress, sensitive personnel/compliance contexts | Professional compassion; no humor or celebration |

The server chooses the most restrictive applicable mode. The model may reduce personality further. A current user style instruction overrides their stored style preference for the turn; neither can change facts, permissions, selected effects, or review severity. Avoid childish language, emotional/sentience claims, excessive emojis/exclamations, and jokes about failures or sensitive matters. Show the status before any flourish. Use at most one light aside in routine work.

## 7. Target architecture and execution ownership

```text
Authenticated workspace request
  -> durable conversation message
  -> answer / clarify / authorized registered capability
  -> module partitions candidate input into immutable items
  -> module prepares authoritative proposal and effects
  -> server validates and stores immutable revision
  -> exact confirmation when policy requires it
  -> durable worker claims eligible stage
  -> adapter invokes canonical module command under live guard
  -> module returns read outcome or durable write receipt
  -> reconcile required effects -> read actual result
  -> independent review only when capability policy requires it
  -> validated generic result presentation
```

HTTP acceptance does not own execution lifetime. Persist input and deduplication metadata before returning 202. The worker checkpoints classification, preparation, execution, effects, read-back, and review separately. Poll persisted state; SSE is optional later.

Recommended runner: one supervised same-repository worker entry point, using the existing PostgreSQL database and reusable claim patterns. Package it in the existing Node 24 image with only its own loop enabled. Reuse the in-process scheduler only if restart, replica, claim, fairness, and latency tests demonstrate the same contract; cron invocation alone is not durability.

Start with two deployment-wide active item-stage slots, database-reserved and fenced. Classification/provider requests also count toward provider quotas. Claims reserve capacity before dispatch; heartbeat renews the matching generation. Scheduling must rotate ready tenants/users, prevent one batch from claiming all capacity indefinitely, and release capacity after settled work. A cancelled or lost worker may leave an already-sent remote call running; treat its budget reservation as consumed/uncertain until reconciled, not immediately reusable proof of remote capacity.

No model, storage request, or slow external call runs inside the business mutation transaction. Claim and mutation transactions remain short and bounded.

## 8. Module capability contract and generated registry

### 8.1 Required contract

Implement one typed, runtime-validated definition with common fields and discriminated read/write semantics. The following is a design contract, not compiled repository code:

| Contract member | Responsibility |
|---|---|
| `id`, `version`, `contractVersion`, `title`, `description` | Stable identity and semantic compatibility; base ID excludes `@version` |
| `executionKind` | `READ_ONLY` or `CANONICAL_WRITE` initially; external-effect execution is a future explicit extension |
| `riskLevel`, `confirmationPolicy`, `approvalPolicyVersion` | READ_ONLY/STANDARD_WRITE/SENSITIVE_WRITE risk initially; NONE/ALWAYS/CONDITIONAL confirmation under server policy. All initially enabled write capabilities use ALWAYS |
| `reviewPolicy` | `NONE` or `REQUIRED`; BizFile declares REQUIRED |
| `requiredPermissions` | Common prerequisites; mode/record-specific policy remains in canonical commands |
| `inputSchema`, `itemInputSchema`, `preparedSchema`, `outputSchema` | Versioned Zod schemas for common accepted and persisted artifacts; `revisionSchema` is required for editable proposals and `snapshotSchema` for declared read-back/review |
| `splitInput(input, actor)` | Deterministic item keys and candidate inputs; no domain mutation |
| `prepare(input, context)` | PREPARED artifact/proposal or BLOCKED safe reasons |
| `revise(prepared, revision, context)` | Required for editable proposals: schema-validated user correction/selection; fresh authoritative proposal |
| `execute(...)` | READ_ONLY signature is `(prepared, context)`; CANONICAL_WRITE signature is `(prepared, context, operationId)` and returns a receipt-referenced result |
| `readBack(output, context)` | Required for writes and declared evidence review: authorized actual result/evidence; no mutation |
| `reconcile(operationId, context)` | Required for writes: `COMMITTED`, `NO_COMMIT`, or `UNKNOWN`, with matching payload/receipt references |
| `finalize(output, context)` | Required for writes with effects: idempotent canonical reconciliation, never a new business command |
| `review(prepared, output, snapshot, context)` | Required when reviewPolicy is REQUIRED; fresh read-only evidence comparison |
| `present(validatedArtifacts)` | Module-owned generic sections; runtime supplies allowed actions |

Read-only capability definitions do not need fake operation approvals/receipts, effect handlers, or source-comparison reviews. Their canonical read returns observed-at data and authorized resource provenance; it need not requery that data through a ceremonial second read-back stage. After authorized preparation, policy NONE moves directly to READY. Attempt IDs trace repeated reads; they are not write operation IDs. Type and registry validation must reject a write capability without recovery semantics, a REQUIRED review without evidence/read-back and a handler, or a read-only definition that declares a business write. Unknown definitions fail closed.

`CanonicalActorContext` includes `tenantId`, `userId`, `requestId`, and invocation `source`. Worker invocation adds conversation/run/item IDs, attempt ID, and fenced lease token/generation. Canonical module commands are usable by UI/API callers without assistant IDs. `executionGuard` is a trusted code-only callback into the canonical transaction, not a serialized argument or model tool.

Core resource links use `{ resourceType, resourceId, role }`, where role is source, target, or context. Resource types resolve through source-controlled authorized readers/link builders. Do not hard-code DOCUMENT and COMPANY as the complete product vocabulary. Module schemas remain responsible for interpreting resources and enforcing limits.

### 8.2 Registry generation

Discover only `src/services/**/assistant-capabilities.ts`. Require a standard named export `assistantCapabilities`. Generate sorted static imports and a deterministic exported registry; no runtime filesystem discovery or model-authored import path. Manifests must have no import-time network/DB effects.

Add `generate:assistant-capabilities` and `check:assistant-capabilities`. The latter renders expected output in memory and fails if tracked output differs; it must not regenerate away a stale-file error. Reject duplicate `(id, version)` pairs, invalid definitions, unsafe module paths, and unavailable required handlers. Build/dev may regenerate; CI checks freshness before generation/build. Older supported versions may coexist under one base ID.

Persist capability, schema, policy, and prompt versions with work. Compatible internal changes need no assistant route change. Breaking input/effect/approval semantics require a new capability version. Retain old handlers until pending work drains, or mark uncommitted incompatible proposals stale and require new preparation/approval. Recovery of committed receipts remains supported even if new execution of that version is disabled.

### 8.3 Presentation

Support text fields, bounded tables, warnings, internal resource links, canonical change selection, and reviewed input forms. Shared sections render safe scalar values; exact decimals and dates are formatted strings. Modules may supply a specialized editor for complex fields/contact decisions through a code-owned renderer registry. A generic table alone cannot satisfy reviewed-data editing.

`allowedActions` is computed from current state and authorization, never taken from a model or module response. Action identifiers initially include REVISE, CONFIRM, CANCEL, and RETRY. Reject arbitrary HTML, embedded remote images, unapproved URLs, scripts, unsafe Markdown links, and invented resource references. Cap content size and rows without silently discarding consequential approval details.

### 8.4 Neutrality proof

Register a test-only read capability with no documents/company fields, no confirmation, and no review. Drive it through turn acceptance, partition, execution, access-controlled polling, presentation, and retries. The core source must not branch on `bizfile.*`, parse `documentIds`, know UEN rules, or read BizFile receipt tables. BizFile behavior belongs in its manifest, adapter, and module commands.

### 8.5 Adding another business use case

For illustration, a future deadline-summary capability would resolve authorized deadline records and return observed-at results, without a document upload or BizFile review. A future company-profile action would expose its own canonical proposal, permissions, receipt/effects and optional review policy. These examples are not a commitment to implement either production integration now.

Onboarding a module means: inventory its existing commands and approval/side-effect boundary; prove canonical readiness; add module schemas/manifest/adapters; register authorized resource readers/link builders; supply generic presentation or a registered specialized editor; add contract/access/retry/parity tests; regenerate and check the registry; then enable the version through deployment policy. Internal module changes behind a stable contract need no assistant route/core change. A genuinely new execution kind or presentation primitive is an explicit platform version change, not an excuse to promise zero integration work.

## 9. Shared canonical BizFile commands

The reference integration delegates to these proposed module-owned commands:

```ts
prepareBizFileImportCommand({ input, actor })
reviseBizFileImportCommand({ prepared, revision, actor })
executeBizFileImportCommand({ prepared, actor, operationId, executionGuard })
reconcileBizFileImportCommand({ operationId, actor })
finalizeBizFileImportCommand({ receiptId, recoveryAuthority })
readBizFileImportSnapshot({ receiptId, actor })
```

Prepare reuses extraction, normalization, enrichment, UEN conflicts, review validation, diff, and contact-preview services. It is company/contact-read-only, while canonical Document artifacts and provider usage may be persisted. Preserve raw source-derived values separately from enriched and user-edited values. Reusing a prepared artifact must not silently re-extract or substitute mutable `Document.extractedData`.

### 9.1 Selective update is a prerequisite, not an existing guarantee

The inspected sync writes broad fields, replaces share capital/former names/charges, and retires/recreates officers and shareholders. `OfficerAction[]` is not a general selected-field contract, and the supplied `CanonicalBizFileSelectedChanges` name does not exist in the inspected code.

Implement a **module-owned change plan** with stable field/relationship IDs, explicit keep/set/clear/add/update/cease/remove operations, dependency groups, target identities, and preconditions. Selection must control actual sync operations. Omitting a section means KEEP; explicit clear/delete needs supported canonical semantics and visible approval. Do not simulate selection by deleting fields from extraction JSON, because the current sync can interpret absence as null/empty replacement. Do not merge into a full replacement blob if that needlessly rewrites unselected records, IDs, provenance, or history.

Extend the existing `company-sync.ts` persistence path to honor the plan. Reuse mapping/normalization/contact resolution. UI and assistant call the same implementation. During transition, characterize legacy full-replacement behavior separately; do not claim it is fine-grained selection.

Diff and results must describe actual changes. Current `changedSections` is a constant section list, and some result counts derive from input array lengths. Replace those estimates with transaction-selected change evidence before exposing assistant success counts or NO_CHANGE.

### 9.2 Contacts and hidden downstream effects

Preparation shows match candidates and obtains explicit REUSE/CREATE/RESTORE decisions where existing contact review requires them. Bind candidate identity/version, selected resolution, identifier conflicts, shared-contact effects, and officer actions to approval. Recheck current contact state inside execution; new ambiguity or changed identity requires a new proposal. Do not let the adapter quietly choose a different contact.

Existing sync can enqueue schedule reconciliation when source dates/entity data change. The proposal discloses that existing deadline/billing recalculation may follow; it does not invent a separate assistant scheduling capability. Include task launch context where present, and preserve task outcome recovery. Company creation limits and storage capacity remain canonical preconditions.

### 9.3 Atomic commit boundary

Modify `applyReviewedData` or its extracted transaction-owning equivalent so that one transaction:

1. Acquires the documented operation/authorization/approval/aggregate guards.
2. Returns an existing matching receipt if already committed, without reapplying.
3. Verifies exact CREATE versus UPDATE mode, workspace/document/target membership, UEN, source version, approved change plan, contact decisions, and aggregate revision.
4. Selects the actual bounded before-state.
5. Applies the canonical plan through existing domain services.
6. Persists Document approval/linkage, task recovery context, section/summary audit, and canonical downstream enqueue intents.
7. Selects actual after-state, checks deterministic approved-scope conformance, and persists immutable operation receipt/evidence plus required-effect intent.

A failing precommit deterministic conformance check rolls back the transaction. The independent model review remains post-commit and read-only.

Use `(tenantId, operationId)` uniqueness and bind `commandPayloadHash`. Do not prepublish a success receipt outside the transaction. CREATE uses a rejecting uniqueness precondition; an intervening active or recycled UEN cannot turn an approved create into an update. Receipt data includes outcome, canonical changes/counts, source identity, target before/after revision, evidence versions/hashes, and effect references.

### 9.4 Effects and correction sources

Inventory mode-specific naming/storage movement, page preparation, task linkage, and schedule enqueue/reconciliation. Reuse existing task and schedule recovery records. Add a small module-owned durable effect record only where no equivalent exists. Distinguish required completion from independently queued downstream work: durable schedule enqueue can complete the BizFile obligation while later schedule execution reports through its existing module.

For storage, persist source/destination/version/checksum intent before dispatch. Copy or move recovery must verify the expected bytes at the destination, repair the DB pointer safely, and only then clean the prior object. Hash equality, not object existence alone, settles a lost response. A caught/logged storage exception is not COMPLETE.

Corrections using an already processed Document must use a fresh operation and selective plan without resetting Document lifecycle or overwriting prior operation evidence. The current `apply-update` route has no EXTRACTED-only restriction, but this is not proof of a complete correction contract. Validate source linkage, retained original bytes, prior revisions, and task effects before exposing correction actions.

## 10. BizFile reference use case

### 10.1 Input and preparation

The module input may contain `documentIds`, requested CREATE/UPDATE/AUTO mode, per-document target IDs, bounded extraction hints, an allowed model profile, per-item task context, and an optional `correctionOfReviewId`. These belong inside the capability schema; the generic turn API uses authorized resource references.

Use canonical upload controls: PDF/PNG/JPEG/WebP, validated actual content, configured file size (current default 10 MiB), tenant and uploader access, and canonical storage. Uploaded documents may have no company yet. A partial batch upload presents accepted documents and failed uploads before the user submits a run; do not assume all ten uploads succeeded or create duplicate runs while retrying a file.

Prepared items contain document ID/version/hash, immutable source-evidence reference and page manifest, mode/target, aggregate revision/baseline, validated extraction/review draft, enrichment and user-edit provenance, canonical change plan and selection, contact decisions, task/effect scope, schema version, warnings, and blockers. Sensitive evidence is referenced, not copied into conversation messages.

### 10.2 Conflict policy

| Condition | Outcome |
|---|---|
| Valid new UEN, no active/recycled conflict | CREATE proposal |
| Same active UEN | UPDATE proposal with canonical selection |
| Recycled company | BLOCKED; existing recovery UI, no automatic restore |
| Missing/invalid UEN, explicit target mismatch, unreadable essential identity | BLOCKED; correction needed before mutation |
| Repeated Document ID in request | Reject input before partition |
| Different Documents with identical bytes | Show duplicate warning; keep each provenance; require explicit item selection |
| Multiple documents target one UEN in batch | Block conflicting group until user explicitly chooses one; do not pick a winner based on worker completion order |
| Concurrent company/contact/source change | Stale proposal; fresh preparation/approval |
| Older source than accepted evidence | Show conflict and provenance; no invented automatic precedence |
| No selected company changes | Explicit NO_CHANGE plan, including any Document/task effects; no fabricated company update |
| Required contact decision incomplete | Await user revision; cannot confirm |

Do not imply no data changed if Document, task, or canonical audit effects occurred. NO_CHANGE refers to the declared business aggregate comparison, while effects remain separately visible.

### 10.3 Proposal and confirmation

Show every submitted item, selection, mode, company/UEN, reviewed fields, canonical changes, contact choices, source warnings, downstream effects, review requirement, and remaining approval validity. Changes not representable in the current renderer block confirmation with an actionable supported editor/navigation path.

Each REVISE produces a new immutable proposal revision and fresh canonical validation/diff. The hash binds workspace/requester, capability/policy/schema versions, source IDs/hashes, expected resource revisions, prepared data, selected changes/contact decisions, task/effect context, and eligible item membership. Hash a versioned canonical JSON encoding, not presentation prose.

CONFIRM specifies a nonempty unique subset of exact item IDs from one revision. Persist selected `(itemId, preparedHash)` pairs, allocate operation IDs once, mark unselected items NOT_SELECTED, and freeze membership atomically. No approval carries into a changed revision. Later correction/re-preparation is a linked new run. A browser double-click or lost response returns the same result for an identical action key/body.

Recommended initial approval expiry: 30 minutes from completed proposal. Recheck before every uncommitted item enters the mutation gate. Display expiry and refresh requirements; committed work remains committed after expiry. The initiating user is the approver in v1; no delegated approval is implicit. Free-text “looks fine” is not the explicit approval control.

### 10.4 Batch semantics

One run contains one to ten isolated items for this capability. No cross-document model contexts. Each item has its own evidence, attempts, receipt, execution outcome, effects, review, and errors. Failure does not roll back another item's committed transaction. Aggregate results keep imported, no-change, blocked, excluded, failed, cancelled, and review counts distinguishable.

## 11. Independent review and evidence

### 11.1 Policy and independence

Review is mandatory for BizFile, optional by declaration for other capabilities. It answers separately:

- **Execution conformance:** did the canonical command apply exactly the approved operation, preserving unselected values/relationships?
- **Source alignment:** how does the receipt-bound saved state compare with original source evidence, including intentional/pre-existing/enriched/ambiguous differences?

Use a fresh model context with original pages or fidelity-verified page content, approved scope and provenance, actual before-state, and receipt-bound after-state. Exclude planner conversation, extractor reasoning/confidence, previous verdicts, and personal memories. Same model/provider is acceptable initially as procedural separation; evaluate correlated errors empirically. The reviewer receives no mutation, shell, SQL, arbitrary HTTP, or direct Prisma tools.

### 11.2 Evidence contract

The canonical transaction stores bounded database-selected before/after evidence or a verified transactional-history equivalent. A later object-storage export is allowed only after hash verification and durable reference retention; an after-commit upload alone cannot establish atomic evidence capture.

Receipt evidence is immutable. Post-commit read-back retrieves it and creates a separately timestamped capture of Document/effect finalization. Current-state observations are separate and report later changes as drift. Do not replace the operation's after-state with whatever is current when review eventually runs.

The source manifest records canonical Document/version, original byte SHA-256, expected pages, render/content hashes, extraction/render version, supported sections, source issue/as-of date where available, unreadable pages, and authorized evidence references. Source contents and filenames are untrusted data, never instructions. A deleted/revoked source cannot be read from an unauthorized cache.

Canonical serialization uses a versioned scheme: sorted object keys; ordered semantic arrays, with set-like collections explicitly sorted by stable identity; UTF-8; explicit null; rejected undefined/nonfinite values; ISO UTC timestamps; date-only `YYYY-MM-DD`; exact decimal strings; no implicit Unicode normalization of source evidence. Hash fields exclude themselves. Input DTO normalization occurs before hashing, and its version is recorded.

Existing BizFile schemas use JS numbers for several amounts/share quantities. Serializing those numbers to strings afterward does not recover lost precision. Characterize representable ranges and migrate affected canonical boundaries to exact strings/Decimal or reject unsafe values before approval. Dates/decimals need end-to-end tests, not snapshot-only formatting.

### 11.3 Coverage and deterministic checks

Check receipt commit identity/hash, exact approved scope, tenant/target/document linkage, required effects, snapshot completeness, known identities/duplicate constraints, and source integrity before model comparison. Deterministic failures cannot be overwritten by model reassurance.

For BizFile, enumerate importer-supported entity identity/type/status/dates, addresses, SSIC/activities, FYE/compliance, share capital/classes, officers, shareholders/holdings, auditor, former names, and charges. Distinguish NOT_PRESENT from UNREADABLE, NOT_SUPPLIED, and UNSUPPORTED. Missing sections do not imply permission to delete existing values.

Page references are one-based. Validate returned pages against supplied evidence and expected coverage; never trust a model's claim of attention as proof. Bounded deterministic page chunks within one item are allowed, followed by cross-section reconciliation. Missing/truncated/unreadable required evidence cannot PASS. If a provider or budget cannot cover it, report incomplete review rather than quietly shrinking coverage.

### 11.4 Findings and verdicts

Each finding has stable ID; type; severity INFO/WARNING/MATERIAL/BLOCKER; disposition; canonical field/relationship path; before/source/persisted values where known; source page/section/evidence reference; explanation; and text-only suggested next step. Optional confidence is an uncalibrated model signal, not an accuracy score.

Finding types include source/database mismatch, missing source field, unexpected/duplicate record, invariant failure, unapproved change, ambiguous/unreadable source, incomplete review, concurrent change, and unverifiable snapshot. Dispositions distinguish unexplained, intentionally unselected, approved override, enrichment difference, pre-existing, concurrent, out of scope, and unverifiable.

The server derives verdict:

| Condition | Review verdict |
|---|---|
| Complete supported evidence, conformance passes, no detected unexplained difference | PASS |
| Complete review, only explained/approved differences or nonmaterial warnings | PASS_WITH_WARNINGS |
| Unapproved change, material unexplained mismatch, missing required coverage, unverifiable evidence | NEEDS_REVIEW |
| Technical review failure without a usable validated result | REVIEW_FAILED |

Store executionConformance PASS/FAIL/UNVERIFIABLE and sourceAlignment NO_UNEXPLAINED_DIFFERENCE/DIFFERENCES_PRESENT/INCOMPLETE separately. PASS means no issue detected within declared coverage; it is not a correctness warranty. Required effects pending/failed prevent an overall all-clear even if factual review passed.

Corrections use immutable original findings, a linked new run, current resource revision, new canonical selection, and fresh explicit approval. Disputing a finding records feedback without deleting evidence. Review reruns retain all prior versions and cannot silently erase unfavorable results.

## 12. Run state and deterministic aggregation

Run states: DRAFT, PREPARING, WAITING_CONFIRMATION, READY, RUNNING, REVIEWING, RECOVERING, CANCEL_REQUESTED, COMPLETED, COMPLETED_WITH_EXCEPTIONS, FAILED, CANCELLED, EXPIRED.

Item lifecycle states: PENDING, PREPARING, BLOCKED, WAITING_CONFIRMATION, READY, EXECUTING, RECOVERING, READING_BACK, REVIEWING, SUCCEEDED, PASSED, PASSED_WITH_WARNINGS, NEEDS_REVIEW, FAILED, CANCELLED, EXPIRED. SUCCEEDED permits a capability that does not require source review.

Authoritative outcome dimensions:

- `executionOutcome`: NOT_STARTED, SUCCEEDED_READ, COMMITTED, NO_CHANGE, FAILED_NO_COMMIT, OUTCOME_UNKNOWN.
- `reviewOutcome`: NOT_REQUIRED, NOT_STARTED, RUNNING, PASS, PASS_WITH_WARNINGS, NEEDS_REVIEW, REVIEW_FAILED, NOT_RUN.
- `requiredEffectStatus`: NOT_REQUIRED, PENDING, COMPLETE, FAILED.
- `dispositionReason`: e.g. NOT_SELECTED, BLOCKED_CONFLICT, STALE_PROPOSAL, CANCEL_REQUESTED, APPROVAL_EXPIRED, RECONCILIATION_REQUIRED.

For a read-only capability with policy NONE, server authorization makes items eligible without fabricating a user approval. REQUIRED review cannot become NOT_REQUIRED after a failure. A committed item with a review timeout is never FAILED_NO_COMMIT.

Each stage attempt transitions PENDING → RUNNING → SUCCEEDED/FAILED/SKIPPED, with immutable terminal record, attempt number, authoritative input revision, fence, retry class/time, safe error, provider call reference, and timing. Retries add attempts. Transitions use conditional writes matching expected state and fence.

Aggregation is derived, not independently editable. Priority: unresolved/in-flight work first; then successful/committed partial outcomes; then settled cancellation; then actual failure; then expiry. RUNNING takes precedence while execution remains; REVIEWING when only review remains. All blocked settles with exceptions and zero successful operations. Empty confirmation is rejected; choosing none uses CANCEL.

COMPLETED requires every selected item to succeed under its declared contract, all required effects complete, and required reviews PASS. Explained warnings, excluded/blocked items, partial cancellation, skipped/failed review, or source exceptions result in COMPLETED_WITH_EXCEPTIONS once settled. FAILED means no successful read, commit, or no-change outcome and at least one real failure, with no unknown transaction. CANCELLED means cancellation settled before any success/commit; EXPIRED means all eligible work expired without another terminal cause.

Present primary item buckets that partition submitted items exactly once. Selected/imported and review totals are additional dimensions, not extra mutually exclusive buckets. Never add overlapping counts together. Explicit review-only retry may visibly reopen settled review work with a new attempt; duplicate HTTP requests cannot reopen a terminal run.

## 13. Persistence, integrity, and retention

Use dedicated Business Assistant records:

| Logical entity | Required information |
|---|---|
| Conversation | Workspace, owner, title/status, timestamps, deletion/retention state |
| Message | Conversation, role/type, safe content/resources, accepted request key/body hash, processing claim state |
| Run | Owner/conversation, capability+versions, validated input, status, active proposal, timestamps, cancellation state |
| RunItem | Immutable partition key/input, resource refs, outcome dimensions, operation/receipt refs, active stage/fence/retry schedule |
| RunStep | Stage attempt identity, input/output artifacts, lease generation, errors, timing, provider/usage refs |
| Proposal | Immutable revision, exact prepared artifacts/hashes, effect manifest, eligible membership, expiry, schema/serializer versions |
| Approval | Immutable selected manifest, approver/requester, policy/revision, decision and expiry, action dedup key/hash |
| Review | Item/attempt, immutable evidence refs, schema/prompt/provider versions, validated findings/coverage/verdict |
| Feedback | Authorized target, event type, bounded comment, independent provenance and adjudication status |
| Memory | Owner scope, capability relevance, allowlisted key/value, provenance/version, approval, expiry, state, supersession |
| LearningChange | Evidence, target/risk, baseline/candidate versions, evaluation record, authorized promotion, rollout and rollback |

These are logical requirements, not a demand for one table per concern. A bounded artifact can live in its parent row; immutable versions cannot be overwritten in mutable JSON. Prefer relational constraints for ownership, request keys, status, claims, and important references. Add a small durable action-request record if approvals/messages alone cannot deduplicate REVISE/CANCEL/RETRY and feedback consistently.

Enforce tenant-safe composite relationships (e.g. `(tenantId, runId)`), unique item keys, proposal revisions, request keys, and attempt numbers. Nullable document/company references are module conveniences, not universal required foreign keys. Core receipt references carry module/type/id; the adapter authorizes and resolves them. Canonical receipt/effect records remain module-owned.

Index claim predicates, availability/lease expiry, workspace/owner/conversation lists, and related keys. Bound artifact bytes, item counts, source pages, review findings, message lengths, and backlog before expensive work. Do not introduce speculative JSON/vector indexes.

Conversations/runs are private to the initiator by default; explicit audited administrative read authority is required for broader inspection. Recheck underlying resource access even when the conversation is owned. If access is lost, redact cached summaries, titles, counts, findings, and previews that reveal protected resource content; do not protect only the final download route.

Retention is separately configured for conversations, operational evidence/receipts, audits, feedback, and memories. Production requires an owner-approved policy; this spec invents no legal retention duration. Deleting a conversation never deletes a business Company/Document or necessary receipt/audit. Minimal tombstones preserve replay safety without retaining erased sensitive values. Memory deletion removes retrieval, caches, and derived candidate payloads; version history retained for rollback cannot become a back door to deleted personal data. Backup/restore and tenant export/purge must include the new records in dependency-safe order. Temporary evidence holds for active work must be bounded and audited.

## 14. Module-neutral HTTP API

```text
POST   /api/business-assistant/turns
GET    /api/business-assistant/conversations
GET    /api/business-assistant/conversations/:id
GET    /api/business-assistant/runs/:id
POST   /api/business-assistant/runs/:id/actions
POST   /api/business-assistant/feedback
GET    /api/business-assistant/memories
POST   /api/business-assistant/memories/:id/actions
GET    /api/business-assistant/learning-changes
POST   /api/business-assistant/learning-changes/:id/actions
```

The final two routes make evaluation, promotion, and rollback actionable; an equivalent existing authorized settings/server-action contract is acceptable. Conversation detail includes pending messages and currently authorized capability descriptors; do not invent a BizFile endpoint for discovery. Polling is sufficient; optional future SSE needs durable event sequences/resumable cursors.

Example turn:

```json
{
  "clientRequestId": "client-generated-uuid",
  "conversationId": null,
  "message": "Import these records and review the result",
  "resources": [
    { "resourceType": "DOCUMENT", "resourceId": "document-id", "role": "source" }
  ],
  "context": { "route": "/business-assistant" }
}
```

An explicit workspace selector is validated through the existing workspace context mechanism, including administrative users; never derive workspace from a submitted resource or an admin fallback. All resources in a run belong to that frozen workspace. Normal users cannot override their scope. Conversation workspace cannot change midstream.

POST turns validates and transactionally persists the request before returning 202 with `type: accepted`, conversation/message IDs, and run reference when already available. Classification later yields message, question, proposal, result, or safe error through polling. Those are lifecycle DTO types, not competing synchronous guarantees. Unsupported intent explains supported options without inventing an executable tool. Model suggestions never directly become a stored prepared command.

Deduplication scope: `(tenantId, userId, operationKind, clientRequestId)` plus canonical request-body hash. Identical replay returns original references; changed body returns 409. The first conversation, accepted message, and dedup record must commit together. Authorize access before returning a replay result. Dedup retention must cover retry/deployment windows; expired keys cannot be silently treated as safe retry of old writes.

Actions are a discriminated schema:

| Action | Candidate fields | Server behavior |
|---|---|---|
| REVISE | Request ID, proposal revision, item ID, module revision patch | Authorize, validate, recompute; persist new immutable revision |
| CONFIRM | Request ID, exact revision, unique nonempty item IDs | Validate all selected hashes/preconditions, freeze membership, create approval/operation IDs atomically |
| CANCEL | Request ID, optional bounded reason | Serialize stop request with mutation gate; return actual current state |
| RETRY | Request ID, eligible item IDs, optional requested failed stage | Resolve safe resume point from receipt/attempts; never reset committed mutation |

Return 202 for newly queued work and current state for idempotent replay; 400 invalid input, 401 unauthenticated, 404 inaccessible/missing record where enumeration would leak, 409 stale/conflicting action, and 429 quotas with retry guidance. Safe errors include VALIDATION_FAILED, FORBIDDEN, NOT_FOUND, PROPOSAL_STALE, APPROVAL_EXPIRED, ACTION_CONFLICT, RATE_LIMITED, OUTCOME_UNKNOWN, EVIDENCE_UNAVAILABLE, and CAPABILITY_VERSION_UNAVAILABLE. Map repository HTTP conventions consistently; stage failure appears in persisted state after durable acceptance.

Lists require bounded cursor pagination. Use private/no-store responses and cache keys including workspace, user, and relevant access version. Validate cookies/session and same-origin/CSRF on every mutation. The current middleware's permissive origin-prefix check is not sufficient evidence for exact origin matching; test and use URL-origin equality for the new surface.

Feedback identifies an authorized target/type and explicit event. Memory actions CONFIRM/REVISE/DEACTIVATE/DELETE include expected version. Learning actions EVALUATE/APPROVE/PROMOTE/ROLLBACK/REJECT include expected version and permitted target; promotion never accepts arbitrary prompts, code, or capability definitions from a browser.

## 15. Workspace and interaction design

Follow the existing compact Oakcloud layout, semantic tokens, 4px spacing, light/dark themes, and shared controls in the [design guideline](../../guides/DESIGN_GUIDELINE.md). Do not rebuild the application visual system for the persona.

Provide conversation history, request composer, relevant resource picker/upload, authorized capability affordances, proposal, durable progress, result details, findings, and preferences. A document attachment area appears when applicable; the empty state is about Oakcloud assistance, not only BizFile import.

Approval UI shows exact canonical values/effects, editable fields/contact choices, selected versus excluded items, revision status and expiry. Disable confirmation during revision recomputation or stale/blocked state. Model summary is supplementary. Never truncate consequential details without a way to inspect them before confirmation.

Preserve draft input on validation failures; restore accepted runs after reload/lost responses; show upload failures before submission. Cancel copy explains saved data stays saved. Review retry explicitly means review only. Keep operational and factual errors separate. Findings link to authorized source pages and canonical correction surfaces.

Use keyboard-accessible selection/edit/confirm controls, visible focus, labeled status beyond color, appropriate live announcements, stable focus during polling, responsive cards/tables, and reduced-motion behavior. Test narrow/wide layouts, both themes, selection changes, validation errors, reconnect, revocation, cancellation, and incomplete evidence. Keep internal leases, hashes, and operation IDs in operator detail, not ordinary approval copy.

## 16. Identity, permission, and trust controls

Reuse existing role/permission semantics and `Workspace` context; do not introduce an assistant superuser. Extract a cookie-free fresh actor/permission evaluator from shared auth/RBAC code so workers use live user active/deleted state, workspace state, memberships/assignments, resource access, and action permissions. A cached five-minute permission result is not a fresh mutation decision.

Preparation requires appropriate source read, preparation/write-to-Document, target read, and mode-specific command permissions. Execution rechecks create/update, contact effects, limits, target access, task context, source version, and workspace equality for every identity including admins. Common manifest requirements are not the union of create and update permissions.

At the mutation gate, serialize authorization evaluation with relevant revocation changes using transaction-visible authorization revision/locks shared by role/user/workspace/assignment writers. Define and test the exact ordering: a revocation committed before the gate wins must block mutation; a gate that won first may commit and must be reported. A before-transaction cache bypass alone does not close the race. Verify the writer coverage before live use; the plan includes this prerequisite rather than assuming it exists.

Normal session expiry/browser closure does not revoke a queued operation; disabled user, revoked membership/record access, cancelled/expired approval, inactive workspace, or mutation kill switch blocks new writes. Recheck before provider dispatch and every result/evidence/memory read. A provider request already transmitted cannot be recalled by local revocation; stop further dispatch and suppress unauthorized result access.

After commit, minimal module recovery authority may finalize already-authorized effect intent even if the user loses access. It cannot prepare new business changes or send source data for a new optional review. Record recovery authority separately from initiating attribution.

Resolve providers/models only through approved connectors and workspace policy. Extraction hints, documents, filenames, retrieved text, memory candidates, feedback, model output, and generated links remain untrusted. Deterministic schemas, record authorization, registered destinations, rendering controls, and approval gates enforce safety. Log no credentials, source bytes, raw prompts, or unnecessary identifiers/PII.

## 17. Idempotency, concurrency, and recovery

### 17.1 Separate identities

Transport IDs deduplicate request delivery. Server operation IDs bind one authorized canonical intent through all retries. Semantic fingerprints warn about equivalent evidence/targets; they are not proof of commit and do not prohibit a later legitimate correction.

Use the same receipt boundary for all active canonical write callers, with stable operation identity for a confirmed UI/API request. A completed Document shortcut cannot stand in for a receipt of a new operation, changed draft, or different task context. Do not allocate a new operation ID to escape uncertainty.

### 17.2 Fencing and lock order

Persist claim token, increasing generation, expiry, heartbeat, stage/attempt, and next availability. Renew and settle only with the current token/generation. Proposed tuning: 90-second lease, 15-second heartbeat, three total attempts per stage; validate under actual provider and transaction timeouts.

Specify one lock order for submission/actions, claims, mutation, cancellation, and recovery. Keep capacity reservation in a short claim transaction; never wait for business locks while retaining capacity-table locks. Inside mutation, acquire authorization guard, run/action/item/operation guards, then sorted domain aggregate/contact/source guards before domain writes; canonical non-assistant callers acquire the same applicable domain locks. Confirm exact order after the writer inventory, including triggers, to prevent inconsistent orders.

Aggregate revision must cover company fields and relevant related rows, including source linkage, contact identity dependencies, soft deletion/restoration, and manual section edits. `Company.updatedAt` alone is inadequate. Recommended design is a module aggregate revision plus a complete writer inventory; use database-enforced revision invalidation where direct write paths cannot reliably participate. A parent lock or digest alone does not stop an uncoordinated child insert. Prove ordering with real PostgreSQL transactions, including shared-contact changes and create-UEN races.

### 17.3 Outcome reconciliation

1. Acquire a fenced recovery claim and resolve permitted authority.
2. Invoke the module's reconcile handler with the same operation ID/hash.
3. Matching committed receipt: record COMMITTED/NO_CHANGE, complete required effects, read back and review as allowed; never invoke mutation again.
4. No receipt: acquire the same operation serialization boundary and establish the earlier transaction settled without commit. During database outage or unresolved locks this is UNKNOWN, not NO_COMMIT.
5. Retry only known-no-commit transient failures with unchanged payload, valid unexpired approval, live permission, and current fence.
6. Otherwise retain OUTCOME_UNKNOWN/RECONCILIATION_REQUIRED and expose operator action; no all-clear or blind replay.

The module recovery contract makes this usable beyond BizFile. A generic worker must not decide commit status by reading `Company`, `Document.extractionStatus`, or module-private timestamps.

### 17.4 Retry and cancellation

Retry bounded transient failures with capped exponential backoff/jitter and total elapsed/cost ceilings. Do not auto-retry validation, stale revisions, permission loss, expiry, deterministic conformance failures, material findings, or ambiguous writes. New prepared intent means a new proposal/approval. Read-only retry can create another observed-at result; retain prior attempts and charge usage honestly.

CANCEL becomes CANCEL_REQUESTED until in-flight mutations settle. If cancellation wins the serialized gate, a claimed item cannot mutate. If mutation wins, reconcile and report commit. Stop new extraction/review provider calls; in-flight calls may still cost money. Required committed-effect completion continues. Committed items without a completed required review report NOT_RUN or their settled failure, never PASS.

Expiry blocks new mutation, not completion of already committed effects. No terminal run can hide an unresolved transaction. A kill switch follows the same rules and has separate controls for new writes and new provider dispatch.

### 17.5 Operator view

Show run/item/operation IDs, capability/version, last successful stage, receipt/effect state, lease/attempts, expected/current revision, safe error, and legal next action. Operators may reconcile, resume a proved-safe stage, or initiate a new proposal; they may not manually label PASS, rewrite evidence, or reset a committed operation. Restore/deploy runbooks must preserve receipt/handler compatibility and disable dispatch while recovery state is assessed.

## 18. Model profiles and prompt composition

Use existing connector infrastructure and central default/high_accuracy profile resolution. Record actual provider/model, resolved profile, template hash/version, policy/capability/persona versions, parameters, usage/cost, and evidence references for every call. Profile hints never override workspace restrictions.

Planner/presentation prompt layers: immutable execution policy; original persona/mode; module instructions; approved scoped preferences; authoritative runtime context; delimited untrusted input/evidence. Server enforcement, not layer order alone, defines authority. Factual reviewer excludes persona and preference layers; personality is applied only to validated presentation.

Do not ask models to implement hashing, permission checks, transitions, concurrency, idempotency, or business mapping. Malformed outputs fail schema validation with a safe classified error. Cap corrective model attempts and cost. Context truncation cannot remove relevant warnings, source pages, approval effects, or security boundaries silently.

## 19. Governed learning

Start with allowlisted structured preferences such as language, response detail, and playfulness. A clear request to remember an exact preference with visible scope/retention is confirmation; no redundant second confirmation is needed. Inferred preferences remain candidates until explicitly confirmed. Approving an import is not permission to store client facts or future instructions.

Separate **ownership** from **applicability**: owner scope SESSION (conversation+expiry), USER (workspace+user), or TENANT (workspace+authorized administrator); optional capability ID/version compatibility narrows relevance. The source draft's CAPABILITY scope maps to a tenant-owned capability-scoped candidate, not a cross-user/global authority. Global/product learning goes through a separately reviewed maintainer release process with redacted evidence.

Memory states: CANDIDATE, ACTIVE, REJECTED, DEACTIVATED, SUPERSEDED, EXPIRED, DELETED/tombstoned as retention permits. Versioned records include exact value, provenance, evidence count/strength, risk, approval, effective/expiry dates, and rollback/supersession reference. A memory delete must remain deleted during rollback.

Pipeline: authorized feedback/outcome → deduplicated candidate → scope/risk classification → fixed baseline/candidate evaluation → authorized approval → versioned promotion → monitoring → rollback/supersession. Recommended three distinct consistent events create an inferred preference candidate, never automatic confirmation. Contradicting evidence pauses it. Feedback, operational success, model findings, and adjudicated correctness labels are separate evidence categories.

| Change | Activation |
|---|---|
| Temporary session context | Automatic, expires, no reusable client profiling |
| Explicit low-risk user preference | Automatic after exact user confirmation |
| Inferred preference | User confirmation |
| Tenant style/default | Authorized tenant administrator |
| Prompt wording/model recommendation | Evaluation and authorized versioned configuration promotion |
| Tool/schema/permissions/security/business rules/code | Normal maintainer review and release; never memory-driven execution |

Precedence: security and canonical rules, then approved tenant policy, current user instruction, then that user's stored style preference. Candidate/free-text feedback is never an active prompt rule. Relevant retrieval is bounded, owner-filtered, capability-compatible, and permission-checked. No sensitive source-document facts become general memories by default.

Full-product release demonstrates feedback → candidate → fixed held-out evaluation → authorized activation → visible use → rollback. A manual evaluation job and simple admin page are sufficient. Preserve baseline/candidate versions, predefined quality/safety metrics, adjudicated cases, approver, rollout state, and rollback target. Never promote solely because a model says its change is better or because training examples also served as the entire evaluation set.

## 20. Audit and observability

Use existing `AuditLog` with explicit schema/type changes or a documented compatible metadata mapping. Recommended mapping retains canonical business `BIZFILE_UPLOAD` provenance while adding `invocationSource: BUSINESS_ASSISTANT`, run/item/operation references, and a namespaced `eventType` in metadata; assistant-only lifecycle records use SYSTEM source and appropriate existing actions. If dedicated enum members are chosen instead, update Prisma, shared TS types, labels, filters, and migration together. Do not pass an unregistered event string as `AuditAction`.

Record conversation acceptance, request dedup conflicts, preparation/revision, approval decision, item start, canonical receipt, effect completion/failure, read-back, review version, cancellation/expiry, retry/reconciliation, access denial/revocation, feedback, memory changes, learning evaluation/promotion/rollback, and kill-switch changes. Consequential decisions/receipt audits are transactionally recorded. `createAuditLog` supports a transaction client; do not use its upsert-update path to rewrite immutable approval history.

Metrics distinguish queue age, prepare/execute/effect/review latency and failures, known commits, unknown outcomes, review coverage/misses/false alarms, retries, stale fences, per-workspace usage/budget, and capacity starvation. Keep sensitive findings in authorized review records, not broad logs. Alerts route to named operational roles for stuck recovery, exhausted retries, missing evidence, and disabled controls; assign actual people and measured thresholds before production.

## 21. Verification and measurable gates

Tests are split by purpose:

1. Characterization of existing UI/routes, mapping, contact review, absence/null behavior, task/schedule/audit/storage effects.
2. Canonical contract parity: UI/API/assistant reach the same commands; selected changes actually preserve unselected records and reject mode changes/staleness.
3. Pure platform tests: neutral read capability, registry generation, schemas, immutable revisions/subsets, transitions/aggregation, resource authorization, prompt/memory policy.
4. Real PostgreSQL integration: commit receipt/evidence atomicity, competing claims, revocation, cancellation, stale fences, child/contact writes, duplicate operations, rollback and crash recovery.
5. Storage/provider fault simulation: lost acknowledgements, page/effect failure, malformed review, budget exhaustion, no mutation replay.
6. Browser behavior: editing/selection/contact decisions, confirmation, polling/reconnect, cancellation, result links, memory management, responsiveness and accessibility.
7. Separate model evaluation: annotated source cases, seeded errors, false alarms/misses, unreadable coverage, enrichment/unselected fields, persona modes, and prompt-injection evidence handling.

Zero tolerance in the deterministic test suite for cross-workspace access, unapproved writes, duplicate committed effects, stale-fence commits, mutation replay after commit, or PASS with missing required evidence. Reviewer quality requires an adjudicated corpus and preset acceptance thresholds before model comparison; no invented production accuracy percentage. Include all supported source sections and each failure class, with counts and denominators reported.

After implementation, run registry freshness/generation, Prisma generation, typecheck, lint, focused tests, isolated PostgreSQL integration, browser tests, full unit suite, production build, worker image/startup/restart smoke, and representative model evaluation. A skipped integration suite is not a passing gate. Existing Node 24 CI currently runs a Chromium resolver test, not the full BizFile/assistant coverage; extend it explicitly.

This review ran five existing focused files: **65 tests passed**, under local **Node 22.19.0**. The first sandboxed attempt failed to load Vitest configuration due to filesystem access; an approved unsandboxed retry passed. No application code was changed. No database, concurrency, storage, model, browser, full-suite, lint, typecheck, or production-build release gate was executed for this documentation task. See the plan for exact commands and document QA.

## 22. Implementation sequence

The [implementation plan](../../plans/2026-09-05-business-assistant-implementation.md) contains file-level work packages, dependency order, tests, migrations, review checkpoints, and next-session scope.

| Milestone | Work | Exit |
|---|---|---|
| M0: baseline and decisions | Confirm repository/callers/runtime, capture contracts, resolve safety-critical implementation choices | Evidence and compatibility matrix; no assumed selective-update/durability guarantees |
| M1: assistant foundation | Generic contracts/registry, persistence, durable requests/worker, auth/approval/recovery interfaces | Test-only non-document read capability works end to end; no BizFile branches in core |
| M2: canonical reference readiness | BizFile selection, reviewed contacts, stale/create guards, transaction receipts/effects/evidence, caller convergence | Real DB parity, concurrency and failure evidence; legacy direct-save path retired or explicitly blocked |
| M3: reference vertical slice | BizFile manifest, generic workspace/API, exact proposal, one-item execution/read-back/review | Controlled live-pilot gates pass with complete coverage and restart safety |
| M4: batch and governed learning | Isolated ten-item runs, fairness, partial outcomes; full learning promotion/rollback/management | Batch isolation and full learning demonstration |
| M5: release/cutover | Operations, backup/retention, compatible deployment, Eden removal, docs and full checks | Replacement usable, active legacy absent, fallback exercised, release evidence recorded |

M1 can be implemented without repairing BizFile first. M2 is a prerequisite to enabling the reference writer. Broader future capabilities reuse M1 and their own canonical readiness gates; they do not inherit BizFile prerequisites unnecessarily. This order is a dependency plan, not a request to launch parallel agents or implement all milestones in one session.

## 23. Acceptance criteria and traceability

| ID | Acceptance criterion | Gate |
|---|---|---|
| BA-AC01 | Olaf branding, persona-neutral technical names; no active Eden after cutover | M5 |
| BA-AC02 | Answer/clarify and registered capability interactions share a general workspace | M1/M3 |
| BA-AC03 | Test-only non-document read capability succeeds without fake approval/review/receipt | M1 |
| BA-AC04 | Module manifests generate deterministic registry; duplicates/staleness fail CI | M1 |
| BA-AC05 | Versioned generic schemas/resources/presentation; no module-specific assistant routes | M1 |
| BA-AC06 | Durable accepted work, request dedup and private authorized polling survive reconnect/restart | M1/M3 |
| BA-AC07 | Exact immutable revision/subset approval; edits, expiry, conflicts cannot reuse approval | M1/M3 |
| BA-AC08 | Fresh workspace/user/resource authorization and revocation ordering proven | M1/M2 |
| BA-AC09 | Canonical UI/API/assistant command parity; no adapter business-table mutation | M2 |
| BA-AC10 | BizFile genuine selection, contact decisions, CREATE invariance, stale aggregate guard | M2 |
| BA-AC11 | Receipt, domain commit, selected before/after evidence and effect intent atomic | M2 |
| BA-AC12 | Fenced recovery and cancellation; committed effects/review failure cannot repeat import | M2/M3 |
| BA-AC13 | Actual read-back, drift separated, exact numbers/date-only fields retained | M2/M3 |
| BA-AC14 | Fresh read-only review; coverage enforced; conformance/source differences distinguished | M3 |
| BA-AC15 | Findings immutable and traceable; correction creates a new approved canonical operation | M3 |
| BA-AC16 | One-to-ten BizFile items isolated; same-UEN conflicts deterministic; totals partition correctly | M4 |
| BA-AC17 | Current UI and generic document AI remain supported; old BizFile route usage disposition recorded | M2/M5 |
| BA-AC18 | Structured preference works; candidate isolation, precedence, inspection/deletion/expiry proven | M4 |
| BA-AC19 | Feedback/evaluation/promotion/rollback path demonstrated; no permission/tool/rule/code expansion | M4 |
| BA-AC20 | Persona modes/adaptation evaluated; exact approvals/findings unaffected | M3/M4 |
| BA-AC21 | Provider/resource quotas, audit, alerts, private caches, retention/backup restore configured and exercised | M5 |
| BA-AC22 | Mutation/provider kill switches, compatible pending versions and normal module UI fallback work | M5 |
| BA-AC23 | Registry, generation, typecheck, lint, unit/integration/browser/build/worker/model gates recorded honestly | M5 |

BA-AC01–23 reorganize, rather than claim completion of, the source draft's 44 criteria. Generic read success and optional review policy are additions required by the user's product clarification. The implementation plan maps work packages to these criteria and retains any unresolved product/operational decisions.

## 24. Decision register

| ID | Decision / recommendation | Status |
|---|---|---|
| BA-U001 | General Business Assistant; BizFile is a use-case example | Explicit user clarification, 2026-09-05 |
| BA-S001 | Single Olaf surface; persona-neutral names; canonical module commands; exact approval; read-only review; governed learning; generated registry; eventual Eden removal | Direction retained from source-reported BA-001–BA-027; no independent approval history checked |
| BA-D001 | Separate generic foundation and canonical BizFile reference workstreams | Proposed refinement implementing BA-U001 |
| BA-D002 | Discriminated read/write contracts, optional review policy, module reconciliation/effects, generic resources | Proposed |
| BA-D003 | Implement real selection in canonical sync; do not treat existing selective function name as proof | Required integration gap; proposed implementation approach |
| BA-D004 | Older company-scoped extract route is a legacy candidate; verify consumers, then retire or explicitly block direct-save | Proposed; no runtime usage evidence |
| BA-D005 | Same-repo supervised DB worker; no new queue framework | Recommended; scheduler alternative must prove equivalent behavior |
| BA-D006 | Transactional receipts/evidence, fenced claims, aggregate and authorization writer coordination | Proposed; exact migration/lock design must be proven before pilot |
| BA-D007 | Generic memory ownership plus capability relevance; explicit learning admin API/workflow | Proposed |
| BA-D008 | Preserve canonical audit source and add invocation/event metadata unless enum migration chosen explicitly | Recommended |
| BA-D009 | Two active stages, 30-minute approval, 90-second lease/15-second heartbeat, three total stage attempts | Proposed starting values; measure before enabling |
| BA-D010 | Full learning/cutover follows pilot; no silent reduction of complete product | Proposed delivery packaging |

Open release inputs: actual live topology/PostgreSQL version; provider/data policy; retention and backup scope; bounded page/artifact/provider budgets; reviewer dataset/quality thresholds; named operations owner; exact authorization/aggregate guard migration; external usage of old BizFile route. These block only dependent release work, not documentation or safe foundation implementation.

## 25. Fresh-session handover

Start with the [implementation plan](../../plans/2026-09-05-business-assistant-implementation.md), then this specification, `AGENTS.md`, and linked repository guides. Recheck branch/commit/worktree and Node version; this is a static baseline, not permanent environment truth.

The next implementation session should complete the bounded M0/P01–P02 work packages: characterize duplicate/current callers and canonical write semantics, resolve the generic contract/data ownership design, and record the migration/guard choices. Continue into foundation implementation only after that evidence is recorded. Do not implement a BizFile-specific assistant runtime or enable the existing broad sync behind fine-grained approval controls.

At each session end, update the existing plan with completed package IDs, exact changed/deleted files, migrations, tests/commands/results/environment, remaining decisions, active feature flags, failure/recovery evidence, and the next bounded package. Keep acceptance criteria unchecked until their evidence exists. Do not create disconnected handover files or repeat the source draft's unverified baseline as fact.
