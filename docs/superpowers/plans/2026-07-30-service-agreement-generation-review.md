# Stage 2 Service Agreement Generation - Implementation Review

**Initial review date:** 2026-07-30  
**Second-round review date:** 2026-08-01  
**Third-round fix verification date:** 2026-08-01

**Reviewed plans:**

- `docs/superpowers/plans/2026-07-30-service-agreement-roadmap.md`
- `docs/superpowers/plans/2026-07-30-service-agreement-generation.md`

**Reviewed implementation:** Current working tree on `main` at `051261f`,
including the first-round fixes present in the working tree

**Review scope:** Schema, migration, validation contracts, relational draft
persistence, snapshot expansion, generation-session compatibility, agreement
assembly, preview/validation/generation APIs, refresh API, four-step wizard,
controlled seed bundle, documentation, tests, and the supplied source PDF.

**Initial disposition:** **Not ready to accept as the Stage 2 implementation**  
**Latest disposition:** **Code findings closed; release acceptance remains gated by the approved two-entity PDF inspection**

The latest assessment is in [Third-Round Fix Verification](#third-round-fix-verification---2026-08-01).
The original review remains below it as the evidence trail for the first fix
round.

## Third-Round Fix Verification - 2026-08-01

### Executive Summary

All actionable third-round code findings are fixed. The saved authorised-
representative snapshot remains authoritative after its source contact is
deleted, Review is now failure-safe and resumable, and composition changes can
no longer silently detach or orphan a relational agreement. Primary-company
changes report their destructive impact before mutation, and canceling the
confirmation preserves the complete agreement state.

The automated Stage 2 gate is green. Release acceptance is still intentionally
held at the manual content boundary: the inactive controlled bundle has not
received explicit content approval, so no development activation or prescribed
two-entity/two-service PDF was created. Local database configuration, the PDF
export implementation, and Poppler are available; the required review artifact
does not yet exist. This is the only remaining Stage 2 release dependency.

### Third-Round Finding Status

| Finding | Status | Fix evidence |
|---|---|---|
| Deleted representative source blocks save/generation | **Closed** | Draft persistence preserves the pinned snapshot and nullable deleted-contact FK; the wizard resumes, saves, and generates with the historical representative ID. |
| Review save/preview failure leaves a blank step 3 | **Closed** | Agreement details persist at step 2, preview failures remain recoverable there, the populated preview is persisted in a second save, and blank interrupted step-3 sessions normalize back to details. |
| Service Agreement to standard transitions can orphan the relation | **Closed** | The client retains agreement state until a confirmed save/generation, cancellation by switching back loses nothing, and both server paths atomically delete only an attached `DRAFT` agreement while clearing the persisted ID. |
| Primary-company changes silently remove assignments and fees | **Closed** | The wizard calculates affected assignments/fees before mutation, requires confirmation, and preserves the selected company, entities, and fees when canceled. |
| Two-entity/two-service PDF release gate | **Pending explicit content approval** | Database configuration, export code, and `pdftoppm` are present; `output/pdf/service-agreement-two-entity-review.pdf` is absent and the inactive legal bundle was not activated without approval. |

### Fresh Verification Evidence

| Check | Result | Evidence |
|---|---|---|
| Focused Stage 2 unit/integration gate | **Pass** | 11 files and 126 tests passed. |
| Service Agreement Chromium workflow | **Pass** | 2 tests passed, including canceled primary-company destruction, failed-preview recovery, all four stages, and final generation. |
| Production build | **Pass** | `npm.cmd run build` completed Prisma 7.2 generation, compilation, type checking, 134 static pages, and build traces. |
| Diff whitespace gate | **Pass** | `git diff --check HEAD` returned exit code 0. |
| Sensitive source-render ignore gate | **Pass** | `tmp/pdfs/service-agreement-source/page-01.png` resolves to the scoped `tmp/pdfs/` ignore rule. |
| Two-entity generated PDF inspection | **Pending** | No approved artifact exists; no substitute content or synthetic approval was used. |

### Acceptance Recommendation

The Stage 2 implementation is code-complete against the third-round findings,
but should remain inactive and should not be declared release-accepted until an
authorised reviewer explicitly approves the controlled content and the
generated two-entity/two-service PDF passes the prescribed all-page visual
inspection. No P0 or P1 code defect remains open from the third-round review.

---

## Second-Round Review - 2026-08-01

### Executive Summary

The first fix round materially improves the Stage 2 implementation. It closes
the persisted-item duplication bug, most of the Services editor omissions, the
preview/generation blocking gap, the primary-entity server invariant, and the
repository-level Vitest/error/touch-target cleanup. Company access is now
rechecked on agreement reads, pinned inactive variants render from saved DTOs,
the browser suite traverses the complete wizard, and the exact focused and
browser gates pass.

Stage 2 nevertheless remains blocked. Two P0 defects still break the core
snapshot-authority and resumability guarantees:

1. The real wizard path still resolves the current selected contact before the
   saved authorised-representative snapshot is applied. A deleted or unlinked
   contact therefore blocks preview, validation, and generation.
2. Moving to Review saves step 3 before preview, but the resulting preview is
   never persisted. Newly created agreement IDs/client keys are also not
   reconciled into client state, leaving the session dirty and a resumed Review
   step blank or stale.

Seven P1 issues remain. They include stale agreement state after changing to a
standard template, structured-hash churn after semantically identical saves,
silent fee deletion during agreement-entity removal, incomplete hydration of
saved entities outside the first option page, non-idempotent fee-template seed
rows, sensitive source-PDF artifacts in an unignored directory, and an
incomplete signature/PDF inspection release gate.

#### Open Finding Count

| Priority | Count |
|---|---:|
| P0 | 2 |
| P1 | 7 |
| P2 | 0 |

### Second-Round Verification Evidence

| Check | Result | Evidence |
|---|---|---|
| Plan 2 focused unit/integration command | Pass | 9 files and 86 tests passed without an ad hoc worktree exclusion |
| Service Agreement browser command | Pass | 2 Chromium tests passed, including Setup through generated result |
| Supplemental validation/session suites | Pass | 2 files and 23 tests passed |
| Prisma generation and production build | Pass | `npm.cmd run build` completed Prisma generation, type checking, static generation, and build output |
| Diff whitespace validation | Pass | `git diff --check HEAD` returned no errors |
| Controlled source-PDF reinspection | Partial | Previously omitted clauses are restored; replacement signature placeholders remain incomplete |
| Two-entity generated PDF inspection | Not performed | No generated two-entity PDF artifact was available for inspection |

The green automated gates do not cover the remaining authority, identity,
composition-switch, and persisted-preview defects described below.

### Second-Round Findings

#### SAG-REV2-001 - Current Contact Resolution Still Precedes Snapshot Authority

| Field | Value |
|---|---|
| **Priority** | **P0** |
| **Related first-round finding** | `SAG-REV-002` |
| **Wizard state** | `src/components/documents/document-generation-wizard.tsx:1680` |
| **Rendering order** | `src/services/document-generator.service.ts:465`, `src/services/document-generator.service.ts:481` |
| **Validation order** | `src/services/document-validation.service.ts:623`, `src/services/document-validation.service.ts:645` |
| **Misleading regression** | `__tests__/services/document-generator.service.test.ts:759` |

##### Evidence

The generator now projects `authorizedRepresentativeSnapshot` into
`selectedContact`, but only after this branch has resolved every supplied
current party ID:

```ts
if (selectedDirectorId || selectedShareholderId || selectedContactId) {
  const selections = await resolveDocumentPartySelections({
    companyId,
    tenantId,
    selectedDirectorId,
    selectedShareholderId,
    selectedContactId,
  });
  // ...
}

if (agreement) {
  const representative = agreement.authorizedRepresentativeSnapshot;
  // override selectedContact
}
```

The wizard deliberately mirrors the authorised contact into
`state.selectedContactId`, and both preview and generation send it. The new
snapshot regression omits `selectedContactId`, so it does not exercise the real
request path. Validation likewise requires and resolves the current contact.

##### Impact

Editing a contact no longer changes rendered values after the override, but
unlinking, deactivating, or deleting it can still block validation, preview,
generation, and resume. The relational draft is therefore not yet the complete
rendering authority promised by the plan.

##### Required Action

For Service Agreement composition, skip current-contact resolution for the
authorised representative and satisfy contact requirements directly from the
saved snapshot. Apply the same rule in validation and resume eligibility.
Replace the current regression with the actual wizard-shaped request, including
the stale/deleted `selectedContactId`.

---

#### SAG-REV2-002 - Review Preview and Persisted Client Identity Are Not Resumable

| Field | Value |
|---|---|
| **Priority** | **P0** |
| **Related first-round finding** | `SAG-REV-004` |
| **Save-before-preview** | `src/components/documents/document-generation-wizard.tsx:1322` |
| **Local-only preview update** | `src/components/documents/document-generation-wizard.tsx:1459` |
| **Returned-ID handling** | `src/components/documents/document-generation-wizard.tsx:1221`, `src/components/documents/document-generation-wizard.tsx:1327` |
| **Snapshot comparison** | `src/components/documents/document-generation-wizard.tsx:205`, `src/components/documents/document-generation-wizard.tsx:1208` |

##### Evidence

The navigation branch saves `currentStep: 3` before calling
`generatePreview()`. The saved state therefore contains the old
`previewContent`, commonly `null`. `generatePreview()` writes the new content
only into React state and performs no follow-up save.

The save response also converts new item and fee client keys to database IDs in
`envelopeSaveSnapshot()`, but the editable `serviceAgreement.items` state keeps
its original temporary keys and missing IDs. The current input therefore
differs from the saved snapshot immediately after a successful save.

##### Impact

- Reloading the just-saved step-3 session can show a blank or stale Review
  editor.
- A successful fresh save can continue to display `Unsaved changes`.
- The next save can recreate rows or fail to target the records returned by the
  prior save.

##### Required Action

Hydrate editable agreement state from `saved.agreement` after every save so
persisted IDs become the client authority. After successful preview, either
persist the preview in a second atomic session update or regenerate it before
allowing a resumed step-3 editor to render. Add a fresh-draft regression that
saves, previews, reloads, and asserts both clean dirty state and populated
Review content.

---

#### SAG-REV2-003 - Changing Composition Leaves a Stale Agreement Attached

| Field | Value |
|---|---|
| **Priority** | **P1** |
| **Template change** | `src/components/documents/document-generation-wizard.tsx:1562` |
| **Persisted session ID** | `src/components/documents/document-generation-wizard.tsx:1157` |
| **Server validation gap** | `src/services/document-generation-session.service.ts:90` |
| **Generation mismatch** | `src/services/document-generator.service.ts:673` |

##### Evidence

Selecting another template clears preview/editor fields but not
`serviceAgreementId`, pinned agreement items, or the relational agreement.
`currentSessionState` always serializes the retained ID. Server-side standard
template validation rejects a non-null agreement payload but does not reject a
non-null `serviceAgreementId` or an already attached agreement relation.

Standard generation then receives the stale ID while loading no linked
agreement for standard composition and rejects the request as mismatched. If a
caller omits the ID, the database relation still remains attached to the
generated document.

##### Impact

The user can make a saved draft impossible to generate after switching to a
standard template. More seriously, Stage 3 could later mistake a standard
document with an orphaned agreement relation for an activatable Service
Agreement.

##### Required Action

Define an explicit composition-transition contract. Either prevent template
composition changes after relational draft creation, create a new generation
draft, or transactionally remove the DRAFT agreement after confirmation. Clear
all agreement state in the client and enforce composition/relation consistency
on the server.

---

#### SAG-REV2-004 - Replace-on-Save IDs Still Destabilize the Structured Hash

| Field | Value |
|---|---|
| **Priority** | **P1** |
| **Related first-round finding** | `SAG-REV-008` |
| **Entity replacement** | `src/services/service-agreement/draft.service.ts:253`, `src/services/service-agreement/draft.service.ts:265` |
| **Fee replacement** | `src/services/service-agreement/draft.service.ts:255`, `src/services/service-agreement/draft.service.ts:369` |
| **Canonical IDs** | `src/services/service-agreement/canonical.ts:20`, `src/services/service-agreement/canonical.ts:29`, `src/services/service-agreement/canonical.ts:67` |

##### Evidence

The new canonical projection correctly excludes timestamps and stale flags and
sorts arrays deterministically. However, every agreement save deletes and
recreates all entity and fee rows. The canonical projection hashes the newly
generated entity and fee IDs and fee `agreementEntityId` values.

The same semantic agreement saved twice therefore receives different canonical
input even when no user-authored structured value changed.

##### Impact

`serviceAgreementStructuredHash` cannot reliably distinguish a real structured
change from a no-op save. This undermines Stage 3 consistency checks, audit
comparison, and idempotency.

##### Required Action

Preserve entity rows by agreement/company identity and fee rows by supplied
persisted ID, or exclude replaceable surrogate IDs from the canonical semantic
projection. Add a two-save regression that proves an unchanged agreement
produces the same hash.

---

#### SAG-REV2-005 - Agreement-Entity Removal Silently Deletes Fee Data

| Field | Value |
|---|---|
| **Priority** | **P1** |
| **Related first-round finding** | `SAG-REV-003` |
| **Setup removal** | `src/components/documents/service-agreement/service-agreement-setup.tsx:74` |
| **Cross-item filtering** | `src/components/documents/document-generation-wizard.tsx:1657` |

##### Evidence

Item-level entity unassignment now prompts before removing that entity's fee
rows. Agreement-level entity removal does not. The Setup checkbox immediately
calls `onEntityIdsChange()`, after which the wizard filters the entity from
every item and removes all matching fee lines without confirmation.

##### Impact

A single Setup click can silently erase multiple customized fee schedules
across several service items. Returning the entity later recreates defaults,
not the deleted user-entered values.

##### Required Action

Apply a confirmation at the agreement boundary that reports the number of
affected services and fees before mutating state. Add component and browser
coverage for cancel and confirm paths.

---

#### SAG-REV2-006 - Resumed Entities Outside the Initial Option Page Are Hidden

| Field | Value |
|---|---|
| **Priority** | **P1** |
| **Related first-round finding** | `SAG-REV-005` |
| **Parallel initial load** | `src/app/(dashboard)/generated-documents/generate/page.tsx:145` |
| **Company state** | `src/app/(dashboard)/generated-documents/generate/page.tsx:185` |
| **Services entity filter** | `src/components/documents/document-generation-wizard.tsx:1694` |

##### Evidence

Company search now merges result pages and retains options selected during the
current browser session. On resume, however, the initial company-options and
generation-session requests run in parallel. The saved agreement's entity
snapshots are never merged into `companies`, nor are all saved company IDs
fetched explicitly.

The Services step renders entities only by filtering the current `companies`
array. A saved primary or additional entity outside the first 50 options is
therefore absent until the user searches for it manually.

##### Impact

Pinned fee rows can appear under a generic `Entity` label, saved entity
assignments cannot be reviewed reliably, and the wizard can incorrectly warn
that a valid saved primary company is unavailable.

##### Required Action

After loading the session, merge all saved entity snapshots into the available
company options or fetch the saved IDs through a scoped endpoint. Cover a
resumed agreement whose primary and additional entities are both outside the
initial option page.

---

#### SAG-REV2-007 - Seed Reruns Still Churn Fee-Template Rows

| Field | Value |
|---|---|
| **Priority** | **P1** |
| **Related first-round finding** | `SAG-REV-009` |
| **Material comparison** | `scripts/seed-service-agreement-template.ts:15`, `scripts/seed-service-agreement-template.ts:120` |
| **Unconditional replacement** | `scripts/seed-service-agreement-template.ts:155` |

##### Evidence

The seed now increments material versions and preserves reviewed activation by
default. Nevertheless, every invocation deletes and recreates all variant fee
templates, even when `materialChanged` is false. Row identity therefore changes
on an otherwise unchanged seed run.

The partial/template comparison also uses raw `JSON.stringify` rather than the
normalized content and stable object-key serialization used by the production
partial service. Semantically equal JSON with different key order can cause a
false material increment.

##### Impact

The seed is logically closer to idempotent but is not row-identity idempotent,
and it can still create false version churn. Any future references or audit
records involving fee-template IDs would become unstable.

##### Required Action

Replace fee templates only when their material fingerprint changes and reuse
the same normalization/stable-serialization helpers as the production catalog
and partial services. Expand the seed test to assert unchanged fee-template IDs
and key-order-insensitive placeholder comparison.

---

#### SAG-REV2-008 - Sensitive Source-PDF Artifacts Are Untracked and Unignored

| Field | Value |
|---|---|
| **Priority** | **P1** |
| **Artifacts** | `tmp/pdfs/service-agreement-source/page-01.png` through `page-13.png` |
| **Ignore configuration** | `.gitignore` does not exclude `tmp/pdfs/` |

##### Evidence

`git status --short` lists `tmp/pdfs/` as untracked. The rendered source pages
contain the sample client's name/address, personal email, OpenSign document ID,
and handwritten signatures. A broad `git add .` would stage those files.

##### Impact

This creates an avoidable privacy and source-control exposure and conflicts
with the plan's instruction not to import signatures, OpenSign identifiers, or
sample client data.

##### Required Action

Remove the temporary render directory from the repository workspace after
review or add an appropriately scoped ignore rule before staging. Do not commit
the source renders.

---

#### SAG-REV2-009 - Signature Structure and the Rendered-PDF Gate Remain Incomplete

| Field | Value |
|---|---|
| **Priority** | **P1** |
| **Related first-round finding** | `SAG-REV-007` |
| **Cover/acceptance structure** | `src/content/service-agreement/oaktree-service-agreement-v1.ts:131`, `src/content/service-agreement/oaktree-service-agreement-v1.ts:139` |
| **Instruction/signature structure** | `src/content/service-agreement/oaktree-service-agreement-v1.ts:158`, `src/content/service-agreement/oaktree-service-agreement-v1.ts:167` |
| **Content regression** | `__tests__/services/service-agreement-seed-content.test.ts:28` |

##### Evidence

The previously missing page 1, page 8, and page 11 clauses are restored, the
saved agreement date replaces `system.currentDate`, and the page 12 instruction
table has returned. The cover, acceptance, and closing signature sections still
contain signer names/titles but no explicit replacement signature placeholders
or blank signing structure. The representative table uses literal `Specimen
signature` text rather than a defined signing placeholder.

The content test asserts selected clause fingerprints and the literal specimen
text but cannot verify a usable signing structure. The prescribed generated
two-entity PDF has not been produced or visually inspected.

##### Impact

The inactive bundle is substantially closer to the controlled source but Task
8's signature-placeholder boundary and Task 9's manual release gate remain
incomplete.

##### Required Action

Define and test the intended non-signature placeholder/blank structure for each
signing location. Then seed a development tenant, complete the required human
content approval, generate the two-entity/two-service agreement, export it, and
inspect all pages before activation.

### First-Round Finding Status After Fix Round One

| First-round finding | Status | Second-round assessment |
|---|---|---|
| `SAG-REV-001` | **Closed** | Persisted variant changes now update the matched item instead of creating a ghost row. |
| `SAG-REV-002` | **Open** | Snapshot values are projected, but current contact resolution can still block the real request path. |
| `SAG-REV-003` | **Partial** | The editor is substantially complete; agreement-level entity removal remains destructive without confirmation. |
| `SAG-REV-004` | **Open** | Step normalization and pinned inactive items are fixed; preview persistence and returned-ID dirty state remain broken. |
| `SAG-REV-005` | **Partial** | Actor access and paginated search are fixed; saved out-of-page entities are not hydrated and deleted PICs still block. |
| `SAG-REV-006` | **Closed** | Preview continuation, server generation blocking, and validation diagnostics are enforced. |
| `SAG-REV-007` | **Partial** | Missing clauses/dates are corrected; signature placeholders and the generated-PDF gate remain incomplete. |
| `SAG-REV-008` | **Partial** | Canonical ordering/derived flags are corrected; replace-on-save surrogate IDs still change the hash. |
| `SAG-REV-009` | **Partial** | Version and activation behavior are improved; fee-template row churn and serializer mismatch remain. |
| `SAG-REV-010` | **Partial** | Coverage is materially improved, including a real wizard traversal, but the remaining P0/P1 contracts lack regressions. |
| `SAG-REV-011` | **Closed** | Primary-first ordering is enforced by the request schema. |
| `SAG-REV-012` | **Closed** | Worktree exclusion, structured validation errors, and mobile touch targets are corrected. |

### Updated Stage 2 Requirements Coverage

| Stage 2 task | Second-round assessment |
|---|---|
| 1. Relational draft schema | **Mostly complete** - schema and migration pass; database-backed relation coverage remains limited. |
| 2. Validation, DTOs, snapshot semantics | **Partial** - DTO/validation contracts are present; representative snapshot authority is incomplete in real render/validation paths. |
| 3. Snapshot expansion and draft persistence | **Mostly complete** - ghost items and nested definitions are fixed; replace-on-save identity destabilizes hashes. |
| 4. Generation session v2 compatibility | **Blocked** - stage selection and pinned items resume, but Review preview and fresh persisted IDs do not. |
| 5. Deterministic assembler | **Partial** - content assembly is deterministic; the structured metadata hash is not stable across no-op saves. |
| 6. Preview, validation, generation, refresh | **Partial** - blocking/access enforcement is improved; deleted-contact snapshot rendering remains blocked. |
| 7. Four-step wizard | **Partial** - planned controls and traversal exist; destructive entity removal and saved-entity hydration remain incomplete. |
| 8. Initial inactive content | **Partial** - clauses/versioning/activation are improved; signing structure, seed row idempotence, and sensitive temp artifacts remain. |
| 9. Verification and documentation | **Partial** - automated gates pass; the prescribed generated two-entity PDF inspection is pending. |

### Updated Remediation Order

1. Make the representative snapshot authoritative before any current-contact
   lookup in render, validation, and resume (`SAG-REV2-001`).
2. Persist or regenerate Review content and reconcile returned agreement IDs
   after every save (`SAG-REV2-002`).
3. Enforce composition/relation consistency when templates change
   (`SAG-REV2-003`).
4. Stabilize entity/fee identity or the canonical semantic projection
   (`SAG-REV2-004`).
5. Close destructive entity removal and resumed-option hydration
   (`SAG-REV2-005`, `SAG-REV2-006`).
6. Finish seed idempotence and remove sensitive temporary source renders
   (`SAG-REV2-007`, `SAG-REV2-008`).
7. Complete signing structure and the generated two-entity PDF inspection
   (`SAG-REV2-009`).
8. Add regressions for every remaining issue and rerun the exact Stage 2 gates.

### Second-Round Acceptance Recommendation

Do not accept Stage 2 or begin Stage 3 yet. The first fix round resolves a
substantial portion of the original review, but Stage 3 still cannot safely
treat the relational agreement as authoritative while representative snapshots
can be blocked by current contact state, Review sessions lose their generated
preview, and structured hashes change after no-op saves.

Re-review after both P0 issues and the composition/hash/data-loss findings are
closed, temporary source renders cannot be staged, and the two-entity generated
PDF completes human content and layout inspection.

---

## First-Round Executive Summary - 2026-07-30

The implementation establishes much of the intended Stage 2 shape:

- the five normalized agreement tables and migration exist;
- generation session version 1 compatibility and the version 2 envelope exist;
- SOW snapshots are expanded and stored;
- the three reserved slots are assembled server-side;
- an explicit wording-refresh endpoint exists;
- the document editor displays the structured-data divergence warning;
- the initial content is installed by an explicit inactive seed command; and
- the current-tree focused tests and production build complete successfully.

However, the release should remain blocked. Four P0 defects affect the core
authority and resumability guarantees:

1. Changing the variant of a persisted item creates a second item while
   retaining the old row.
2. The authorised-representative snapshot is stored but never used to render
   the agreement.
3. The wizard cannot collect required service fields or a valid custom fee
   frequency and omits several required item operations.
4. Service Agreement resume restores the wrong step and can hide pinned items
   when their current catalog variant is no longer selectable.

The controlled legal bundle also omits source wording and signature/instruction
structure, user-specific company access is not rechecked by later generation
and refresh paths, and the structured hash is not deterministic. The supplied
tests do not exercise these contracts: the nominal browser suite renders only
the warning banner, the draft suite never calls the draft upsert, and the
generation/API suites contain no Service Agreement generation case.

### Open Finding Count

| Priority | Count |
|---|---:|
| P0 | 4 |
| P1 | 6 |
| P2 | 2 |

## First-Round Verification Evidence

| Check | Result | Evidence |
|---|---|---|
| Prisma generation | Pass | `npm.cmd run db:generate` generated Prisma 7.2.0 successfully |
| Plan 2 focused command as written | Fail | 5 failures from stale duplicate suites under `.worktrees/modular-tasks-pipelines`; 117 tests passed |
| Current-tree focused tests | Pass | With `--exclude '.worktrees/**'`, 9 files and 71 tests passed |
| Browser command | Pass, insufficient coverage | 1 Chromium test passed; it renders only `ServiceAgreementWarning` |
| Production build | Pass | `npm.cmd run build` produced `.next/BUILD_ID`, route manifests, and server output |
| Controlled PDF inspection | Fail | Source pages 1, 8, 11, and 12 do not match the seeded content boundary |
| Two-entity generated PDF inspection | Not performed | No seeded development tenant or reviewed/activated content was available in this review |

The exact focused unit command is currently unreliable because
`vitest.config.ts` does not exclude `.worktrees/**`. The current-tree suites are
green only when that path is explicitly excluded.

## First-Round Findings

### SAG-REV-001 - Changing a Persisted Item's Variant Leaves a Ghost Item

| Field | Value |
|---|---|
| **Priority** | **P0** |
| **Plan requirement** | Match existing items by persisted ID; retain the item unless removed; refresh its snapshot when the variant changes |
| **Primary code** | `src/services/service-agreement/draft.service.ts:253`, `src/services/service-agreement/draft.service.ts:283`, `src/services/service-agreement/draft.service.ts:309` |
| **Missing regression** | `__tests__/services/service-agreement-draft.service.test.ts` never calls `upsertServiceAgreementDraft` |

#### Evidence

The upsert first treats every caller-supplied item ID as retained:

```ts
const retainedIds = new Set(
  parsed.items.flatMap((item) => (item.id ? [item.id] : [])),
);
```

When that retained item's `variantId` changes, `snapshot` is non-null. The
mutation then takes the `serviceAgreementItem.create()` branch rather than
updating the persisted row. Because the old ID was retained, it is not included
in `removedIds`. The transaction therefore commits both the old item and the
new item. The old row has already had its fee lines and entity links deleted,
but it is still returned and rendered as an additional SOW.

#### Impact

- Preview and generated content can contain both the old and new SOW.
- The old row has no entity assignments or fee rows, producing inconsistent
  structured state.
- Stage 3 activation can consume an unintended extra service item.
- Repeated saves cannot repair the state reliably because the new row's ID is
  not the ID supplied by the browser.

#### Required Action

Update the matched row in place when the variant changes, replacing only its
variant/partial snapshot fields plus the submitted structured fields. Do not
create a new row for an existing persisted ID. Add a real upsert regression
that:

1. creates one item;
2. saves the same item ID with another variant;
3. asserts exactly one database item remains;
4. asserts the item keeps its ID and has the new snapshot; and
5. asserts links and fee lines were replaced once.

---

### SAG-REV-002 - The Authorised-Representative Snapshot Is Not a Rendering Authority

| Field | Value |
|---|---|
| **Priority** | **P0** |
| **Plan requirement** | Store the selected primary-company contact snapshot so later contact edits do not rewrite the draft |
| **Snapshot code** | `src/services/service-agreement/draft.service.ts:98`, `src/services/service-agreement/draft.service.ts:136`, `src/services/service-agreement/draft.service.ts:229` |
| **Rendering code** | `src/services/document-generator.service.ts:456`, `src/services/document-generator.service.ts:465` |
| **Seed usage** | `src/content/service-agreement/oaktree-service-agreement-v1.ts:123`, `src/content/service-agreement/oaktree-service-agreement-v1.ts:140`, `src/content/service-agreement/oaktree-service-agreement-v1.ts:158` |

#### Evidence

`authorizedRepresentativeSnapshot` is persisted and returned in the DTO, but
the generator never maps it into the placeholder context. The master template
uses `selectedContact.*`, and `renderTemplateForGeneration()` resolves that
party from current company/contact records using `selectedContactId`.

The stored snapshot has no effect on cover attention, acceptance, instructions,
or signature-name output.

#### Impact

Editing, unlinking, deactivating, or deleting the contact after a draft save can
change or block a later preview/generation. This directly breaks the plan's
pinned PIC guarantee and means the relational draft is not the authority for
the signed document.

#### Required Action

Create a rendering projection from
`agreement.authorizedRepresentativeSnapshot` and use it for every PIC/
authorised-representative placeholder in Service Agreement templates. A clear
root such as `agreement.authorizedRepresentative.*` is preferable; alternatively
override `selectedContact` only for this composition type.

Add an integration test that saves a draft, changes the source contact, renders
again, and proves the saved name, role, email, and phone remain unchanged.
Also test a later-deleted contact: the saved DRAFT agreement must still render
from its snapshot.

---

### SAG-REV-003 - The Services Step Cannot Produce All Valid Planned Inputs

| Field | Value |
|---|---|
| **Priority** | **P0** |
| **Plan requirement** | Expose required service placeholders; add/reorder/copy/remove items; confirm entity removal; support editable entity-specific fee lines and stale-wording refresh |
| **Item creation** | `src/components/documents/service-agreement/service-selection-step.tsx:41` |
| **Item editor** | `src/components/documents/service-agreement/service-item-editor.tsx:27` |
| **Fee editor** | `src/components/documents/service-agreement/service-fee-editor.tsx:17` |
| **Snapshot definitions** | `src/services/service-agreement/snapshot.ts:95` |
| **Server validation** | `src/lib/validations/service-agreement.ts:34`, `src/services/service-agreement/draft.service.ts:168` |

#### Evidence

The implemented item editor exposes only entity checkboxes, start/end dates,
and three fee fields: description, amount, and frequency.

It does not provide:

- any control for `fieldValues`, even when the pinned SOW declares a required
  `service.fields.*` placeholder;
- custom frequency text, although selecting `CUSTOM` makes
  `customFrequencyLabel` mandatory on the server;
- currency or billing start date controls;
- fee-line add/remove controls;
- item copy or reorder controls;
- a confirmation before removing an entity and all of its fee lines;
- a stale version indicator or an action that calls the implemented refresh
  route; or
- handling for an active variant with zero fee templates, which creates an item
  with zero fee lines even though the request schema requires at least one.

Only Add and Remove are implemented for items. `fieldValues` is initialized to
an empty object and is never editable.

The snapshot service also copies placeholder definitions only from the root SOW
partial. It expands nested partial content but does not select or merge the
nested partials' placeholder definitions. A required field declared by a
nested dependency is therefore absent from persistence validation, renderer
diagnostics, and any future dynamic editor.

#### Impact

Any valid catalog partial with a required service field cannot be saved through
the wizard. Selecting a custom fee frequency always produces a server-invalid
payload. Several explicit Task 7 acceptance criteria are absent, so the
four-step UI is not a complete Stage 2 workflow.

#### Required Action

Implement the Services step from the pinned DTO rather than only the current
catalog DTO:

1. render controls for every pinned `service.fields.*` definition;
2. validate required fields before leaving Services;
3. support all fee-line fields plus add/remove;
4. show custom-frequency text conditionally;
5. implement copy/reorder/remove with stable `clientKey` behavior;
6. confirm destructive entity unassignment when fee lines exist;
7. reconcile item entities/fees when agreement entities change; and
8. show stale variant/partial versions with the optimistic refresh action.

Add component and browser coverage for each rule, including a no-default-fee
variant and a required nested partial field.

---

### SAG-REV-004 - Resume Does Not Preserve the Four-Step Pinned Workflow

| Field | Value |
|---|---|
| **Priority** | **P0** |
| **Plan requirement** | Resume hydrates from `GenerationSessionEnvelope.agreement`; saved wording does not refresh implicitly |
| **Wrong normalizer** | `src/components/documents/document-generation-wizard.tsx:976` |
| **Unused correct normalizer** | `src/components/documents/document-generation-stage.ts:23` |
| **Selectable-only load** | `src/components/documents/service-agreement/service-selection-step.tsx:29` |
| **Hidden saved item** | `src/components/documents/service-agreement/service-selection-step.tsx:94` |
| **Dirty-state mismatch** | `src/components/documents/document-generation-wizard.tsx:1174`, `src/components/documents/document-generation-wizard.tsx:1192` |

#### Evidence

- Resume always calls `normalizeDocumentGenerationStage()`. A saved Service
  Agreement `currentStep: 3` is therefore restored to standard step 1
  (`Services`) instead of Service Agreement step 3 (`Review & Generate`).
  `normalizeServiceAgreementGenerationStage()` exists but is never used here.
- Saved items are rendered only when their variant is present in
  `/api/service-catalog?selectable=true`. If a variant or family is later
  inactive/archived, the pinned item is silently rendered as `null`.
- Dirty detection compares `currentSaveInput`, which contains the relational
  `serviceAgreement` payload, with `saved.state`, which intentionally does not.
  A successful Service Agreement save therefore remains dirty. The
  save-before-review branch does not update `savedSnapshot` at all.

#### Impact

The stated Stage 2 goal is a resumable generator, but a valid saved draft can
resume at the wrong stage, hide its pinned services, and continually warn that
saved data is unsaved. Hiding an inactive catalog item also encourages users to
recreate it from current wording, contrary to snapshot pinning.

#### Required Action

- Choose the stage normalizer after identifying the selected template
  composition.
- Render saved items from `GenerationSessionEnvelope.agreement` even when the
  current catalog record is unavailable. Use current selectable variants only
  for adding new items and stale-version comparison.
- Store and compare one canonical client-side save snapshot that includes both
  state and agreement, or compare the envelope's `state` and `agreement`
  separately.
- Add resume tests for all four Service Agreement steps and for an
  inactive/deleted current variant.

---

### SAG-REV-005 - Company/PIC Scope Is Incomplete and Later Operations Do Not Recheck Access

| Field | Value |
|---|---|
| **Priority** | **P1** |
| **Plan requirement** | Current primary-company contacts; paginated company-access filtering; company access for every selected entity |
| **Initial option limits** | `src/app/(dashboard)/generated-documents/generate/page.tsx:97`, `src/app/(dashboard)/generated-documents/generate/page.tsx:108` |
| **Global option mapping** | `src/app/(dashboard)/generated-documents/generate/page.tsx:70` |
| **Setup props** | `src/components/documents/document-generation-wizard.tsx:1580` |
| **Refresh route** | `src/app/api/service-agreements/[id]/items/[itemId]/refresh-wording/route.ts:24` |
| **Agreement lookup** | `src/services/service-agreement/draft.service.ts:400` |

#### Evidence

The page initially loads 50 global company options and 50 global contact
options. Global contacts are mapped with name only; role, email, and phone are
set to null. `ServiceAgreementSetup` receives those global arrays directly
rather than the current primary company's party options. Its additional-entity
list has no paginated search callback.

Company access is checked during draft save, but later agreement lookups accept
only `tenantId`. Preview, validate, generation, resume, and refresh do not
recheck the current actor's company access for every agreement entity.

#### Impact

- A valid PIC beyond the first 50 global results can be unavailable.
- Contacts unrelated to the primary company are offered and then rejected only
  by the server.
- The promised role/email/phone summary is blank.
- Additional entities beyond the first 50 options cannot be selected from the
  Service Agreement control.
- A user whose company access is revoked after draft creation can continue to
  retrieve or operate on the tenant-owned agreement if they retain document
  permission and know the ID.

#### Required Action

Use the existing company-option search for additional entities and retain
selected options across result pages. Source PIC choices from the current
primary-company contact endpoint, including role/email/phone. Clear or
revalidate the PIC when the primary company changes.

Pass the actor to every agreement read/preview/validate/generate/refresh path
and enforce current company access for all agreement entities before returning
or rendering structured data.

---

### SAG-REV-006 - Preview and Generation Do Not Enforce the Intended Blocking Gate

| Field | Value |
|---|---|
| **Priority** | **P1** |
| **Plan requirement** | Merge item diagnostics into blocking errors; moving to Review saves and successfully previews the matching agreement |
| **Preview continuation** | `src/components/documents/document-generation-wizard.tsx:1282` |
| **Preview error swallowing** | `src/components/documents/document-generation-wizard.tsx:1426` |
| **Generate handler** | `src/components/documents/document-generation-wizard.tsx:1433` |
| **Server persistence** | `src/services/document-generator.service.ts:650` |
| **Validation diagnostic loss** | `src/services/document-validation.service.ts:538` |

#### Evidence

`generatePreview()` catches failures and returns normally. The Service
Agreement navigation branch then advances to Review regardless of preview
success. Neither `handleGenerate()` nor `createDocumentFromTemplate()` rejects
`blockingErrors`.

The validation service assembles the agreement but keeps only `.content`, so it
discards `itemDiagnostics` rather than returning required-service-field errors.

#### Impact

A failed preview can present a blank or stale Review editor. A direct API
caller can persist a document despite renderer blocking diagnostics. An
explicit wording refresh that introduces a new required field is not surfaced
by the validation endpoint as a structured error.

#### Required Action

Make preview return a success result or throw; advance to Review only after a
matching preview succeeds. Treat blocking diagnostics as a generation
precondition on both client and server. Merge assembler item diagnostics into
`validateForGeneration()` errors and test the refresh-adds-required-field
scenario end to end.

---

### SAG-REV-007 - The Controlled Content Bundle Is Not a Complete Transcription

| Field | Value |
|---|---|
| **Priority** | **P1** |
| **Plan requirement** | Controlled transcription of source pages 1-13, excluding signatures/OpenSign identifiers and replacing sample values |
| **Seed content** | `src/content/service-agreement/oaktree-service-agreement-v1.ts:117` |
| **Content test** | `__tests__/services/service-agreement-seed-content.test.ts:5` |

#### Evidence

Visual comparison with the supplied 13-page PDF found at least these material
differences:

- page 1's final conflict/order paragraph sentence about where and how services
  will be performed is absent;
- page 8 omits the final responsibility wording concerning supplied financial
  information and inaccurate resulting reports;
- page 11 omits the revised-fee paragraph from the Fees section;
- page 12's instruction/signature table and specimen-signature structure are
  replaced with abbreviated paragraphs and no signature placeholder structure;
  and
- cover and acceptance dates use `{{system.currentDate}}` instead of the saved
  agreement date, so they can change between draft save and generation.

The current content test checks only slot counts, banned identifiers/images,
inactive flags, and the number of variants. It cannot detect missing or changed
legal wording.

#### Impact

The bundle cannot be represented to the human reviewer as a controlled
transcription of the approved source. Its inactive status limits immediate
production risk, but Task 8 and the manual release gate remain incomplete.

#### Required Action

Perform a page-by-page controlled transcription review, restore the omitted
wording and intended non-signature structure, and use the saved agreement date.
Add content fixtures or normalized clause fingerprints for every controlled
section so omissions fail automatically. Then seed a development tenant,
activate only after human legal/content review, generate the prescribed
two-entity PDF, and inspect all pages.

---

### SAG-REV-008 - The Structured Agreement Hash Is Not Deterministic

| Field | Value |
|---|---|
| **Priority** | **P1** |
| **Plan requirement** | Stable canonical JSON that preserves defined item/fee order |
| **Hash code** | `src/services/document-generator.service.ts:174`, `src/services/document-generator.service.ts:690` |
| **Unordered entity links** | `src/services/service-agreement/draft.service.ts:21`, `src/services/service-agreement/draft.service.ts:69` |
| **Derived stale flags** | `src/services/service-agreement/draft.service.ts:83` |

#### Evidence

`canonicalJson()` sorts object keys but preserves every array's incoming order.
`entityLinks` is loaded without `orderBy`, and its IDs are mapped directly to
the DTO array. The hash also includes DTO-only stale-version flags derived from
the current catalog.

The same persisted agreement can therefore hash differently when the database
returns entity links in another order or when current catalog versions change,
even though the pinned structured agreement has not changed.

#### Impact

The metadata marker is unsafe for Stage 3 consistency checks, audit
comparisons, or idempotency. It can report false structured divergence.

#### Required Action

Build an explicit canonical persisted-data projection:

- exclude timestamps and derived stale flags;
- include stable agreement/entity/item/fee identifiers and pinned versions;
- order entities and items by `displayOrder`;
- order item/entity links by agreement entity `displayOrder`; and
- order fee lines by item, entity display order, and fee display order.

Export and unit-test the canonicalizer with permuted database relation order and
later catalog version changes.

---

### SAG-REV-009 - Seed Reruns Bypass Material Versioning and Undo the Human Activation Gate

| Field | Value |
|---|---|
| **Priority** | **P1** |
| **Plan requirement** | Material variant/partial versioning; inactive initial creation pending human review |
| **Partial upsert** | `scripts/seed-service-agreement-template.ts:42` |
| **Variant upsert** | `scripts/seed-service-agreement-template.ts:68` |
| **Forced inactive updates** | `scripts/seed-service-agreement-template.ts:33`, `scripts/seed-service-agreement-template.ts:82`, `scripts/seed-service-agreement-template.ts:112` |

#### Evidence

The seed script writes partial content, variant material fields/fee templates,
and template content directly. It does not use or reproduce the material
version-increment rules from Stage 1. A later controlled bundle correction can
therefore alter current catalog/template wording without advancing the
corresponding version.

Every rerun also sets existing families, variants, and the template to
`isActive: false`. After a content owner reviews and activates the records, an
idempotent maintenance rerun silently deactivates them.

#### Impact

Stale-version detection can miss seeded wording changes, and a maintenance seed
can unexpectedly remove an approved template/catalog from generation.

#### Required Action

Apply the same material comparison/version rules as the production services,
preferably by extracting shared transaction-safe helpers. Set inactive state on
create only; preserve the reviewer's active state on update unless an explicit
`--deactivate` option is supplied. Add a two-run test covering unchanged
idempotence, material version increments, and preserved activation.

---

### SAG-REV-010 - The Named Release Suites Do Not Exercise Their Stage 2 Contracts

| Field | Value |
|---|---|
| **Priority** | **P1** |
| **Plan requirement** | Persistence, generation/API, wizard, and browser tests covering the implemented workflow |
| **Draft tests** | `__tests__/services/service-agreement-draft.service.test.ts:1` |
| **API tests** | `__tests__/api/service-agreement-generation-routes.test.ts:22` |
| **Wizard Stage 2 test** | `__tests__/components/document-generation-wizard.test.tsx:106` |
| **Browser test** | `__tests__/browser/service-agreement-generation.browser.test.tsx:43` |

#### Evidence

- The draft service suite tests snapshot expansion and refresh, but never calls
  `upsertServiceAgreementDraft`.
- The file named `service-agreement-generation-routes.test.ts` tests only the
  refresh route; it does not test preview, validate, session save, or generate.
- `document-generator.service.test.ts` contains no Service Agreement case.
- The component suite checks only that the four stage labels appear.
- The browser suite mounts only `ServiceAgreementWarning`.
- The seed test has no clause-level or idempotent database assertions.

#### Impact

The release gate is green for the current tree while the main persistence and
workflow contracts remain broken. The tests provide misleading completion
evidence rather than regression protection.

#### Required Action

Implement the scenarios explicitly listed in Tasks 3, 4, 6, 7, and 8:

1. transactional create/update/delete and rollback for the relational draft;
2. variant-change update without duplication;
3. v1 resume plus every v2 Service Agreement step;
4. preview/validate/generate using only pinned wording;
5. mismatched draft/agreement rejection;
6. multi-entity repeated variants and entity-specific fee editing;
7. required fields, custom frequency, stale refresh, copy/reorder/remove;
8. editor divergence marker behavior; and
9. a real Chromium traversal from Setup through generated result.

---

### SAG-REV-011 - Primary-Entity Ordering Is a UI Convention, Not a Server Invariant

| Field | Value |
|---|---|
| **Priority** | **P2** |
| **Plan requirement** | The primary company is always first and cannot be removed from Appendix 3 |
| **Validation** | `src/lib/validations/service-agreement.ts:111` |
| **Persistence order** | `src/services/service-agreement/draft.service.ts:263` |

#### Evidence

The schema verifies only that `entityIds` includes `primaryCompanyId`. It does
not require `entityIds[0] === primaryCompanyId`. Persistence assigns
`displayOrder` from caller array order, so a direct API caller can place the
primary company later in Appendix 3.

#### Required Action

Reject or normalize any payload whose first entity is not the primary company.
Add a validation and service test; do not rely on the React effect as the
invariant boundary.

---

### SAG-REV-012 - Verification and Client-Error Handling Need Repository-Level Cleanup

| Field | Value |
|---|---|
| **Priority** | **P2** |
| **Verification config** | `vitest.config.ts:10` |
| **Plain client errors** | `src/services/document-generation-session.service.ts:91` |
| **Mobile form controls** | `src/components/documents/service-agreement/service-fee-editor.tsx:39`, `src/components/documents/service-agreement/service-item-editor.tsx:82` |

#### Evidence

- The exact Plan 2 unit command discovers Git-ignored tests under
  `.worktrees/**` because the central Vitest exclusion list omits that path.
- Invalid standard/Service Agreement session combinations throw plain `Error`,
  which is handled as a server failure rather than a structured 4xx validation
  response.
- Several new custom inputs use 32px or 36px heights on mobile, below the
  design guideline's 44px mobile touch target.

#### Required Action

Exclude `.worktrees/**` centrally, replace plain client-contract errors with
`ValidationError`, and bring the new mobile controls in line with the shared
form/touch-target patterns.

## First-Round Stage 2 Requirements Coverage

| Stage 2 task | Assessment |
|---|---|
| 1. Relational draft schema | **Mostly complete** - schema/migration exist; no database-backed relation/invariant test |
| 2. Validation, DTOs, snapshot semantics | **Partial** - public shapes exist; primary-first and canonical ordering are not enforced |
| 3. Snapshot expansion and draft persistence | **Blocked** - variant changes duplicate items; nested dependency placeholder definitions are not merged |
| 4. Generation session v2 compatibility | **Partial** - v1 normalization works server-side; four-step client resume and dirty snapshots are broken |
| 5. Deterministic assembler | **Partial** - slot assembly works; canonical hash/entity ordering are not deterministic |
| 6. Preview, validation, generation, refresh | **Partial** - routes exist; snapshot PIC, access checks, diagnostics, and integration tests are incomplete |
| 7. Four-step wizard | **Blocked** - only the shell and warning are complete; required input/refresh/item operations are absent |
| 8. Initial inactive content | **Blocked** - controlled source omissions and unsafe version/activation reruns remain |
| 9. Verification and documentation | **Partial** - docs exist but overstate behavior; exact unit gate fails and the required generated PDF inspection is pending |

## First-Round Recommended Remediation Order

1. Fix draft item identity and add transactional upsert tests
   (`SAG-REV-001`).
2. Make the representative snapshot and current company access authoritative in
   every read/render path (`SAG-REV-002`, `SAG-REV-005`).
3. Complete the pinned Services editor and four-step resume behavior
   (`SAG-REV-003`, `SAG-REV-004`).
4. Enforce preview/generation blocking diagnostics and stabilize the canonical
   structured hash (`SAG-REV-006`, `SAG-REV-008`).
5. Correct and re-review the controlled bundle, then repair seed version/
   activation semantics (`SAG-REV-007`, `SAG-REV-009`).
6. Replace the nominal tests with contract-level and real browser coverage
   (`SAG-REV-010`).
7. Close the server invariant, Vitest, error-response, and mobile-control
   cleanup (`SAG-REV-011`, `SAG-REV-012`).
8. Rerun the exact release gate without ad hoc exclusions, then complete the
   prescribed two-entity rendered PDF inspection.

## First-Round Acceptance Recommendation

Do not accept or begin Stage 3 against this implementation yet. Stage 3 treats
the relational agreement rows as authoritative operational inputs, so the
duplicate-item, snapshot-authority, access, resume, and hashing defects would
become harder to correct after activation logic is built.

Re-review after all P0 and P1 findings are closed, the exact Plan 2 commands
pass from the repository root, and the two-entity PDF has completed human
content/layout inspection.
