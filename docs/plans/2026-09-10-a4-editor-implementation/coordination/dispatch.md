# A4Editor manual coordination dispatch

Coordinator: CORE
Shared checkout: `C:\Users\Scofieldkoh\Documents\oakcloud`
Integration branch (remote preparation): `codex/a4-editor-g1-corrected-integration-20260912`
Starting baseline: `bfdc4f95594b73ce4d20bff45f320bdb53837c37`
Contract: **v1 frozen at G0**; see `coordination/g0.md`
G0 integration base before freeze-record commit: `f5a103c85399a3e20d624140a963e19a79ced55a`
G0 freeze-record commit: `475e54ea4ea4a7218bc0565fb337298c04190afa`
Deployment: not authorized
Stage 1: **G1 FROZEN/PASSED**
Stage-1 corrected integration / Stage-2 common baseline: `ad7285ace280f0b4002f119f923a8e2166b9475f`
Wave 2: **INTEGRATED — CORRECTED G2 CANDIDATE FROZEN FOR Q1**

## Shared resource reservations — Stage 1

These reservations apply to the four released Stage-1 assignments below. They do not authorize Stage 2 or deployment.

- Git branch/index/commits, dependency installation, package/configuration changes and shared generated-output commands: **CORE only** in the shared checkout.
- Shared full build / `.next` output: **CORE only**. Workers may run only their assigned focused checks against isolated output/cache resources.
- Browser/server reservations: CORE port `3420` / `.tmp/a4-c1-core`; SEMANTICS `3421` / `.tmp/a4-s1-semantics`; FIELDS `3422` / `.tmp/a4-f1-fields`; WORKFLOW `3423` / `.tmp/a4-w1-workflow`. Use isolated browser contexts and no shared authenticated fixture.
- Database: CORE/SEMANTICS/FIELDS have no mutation lease. WORKFLOW may use only an explicitly disposable synthetic test database/schema for W1 persistence/concurrency work. No production or existing business data may be mutated.
- Prisma client and checked-in pagination bundle generation are reserved to CORE integration windows. WORKFLOW may author its owned schema/migration/bundle-source changes and record the exact generation commands; CORE executes shared generation after producer integration.
- Existing business records, credentials and document contents are never test fixtures. Use synthetic fixtures only.
- Commands that write shared caches/output or depend on an integrated producer must wait for the relevant integration window rather than racing another active owner.

## CORE-C1-20260911-01

Dispatch ID: `CORE-C1-20260911-01`
Role and packet: CORE / C1 — canonical session, native input and per-document history
State: **READY FOR INTEGRATION**
Working directory: `C:\Users\Scofieldkoh\Documents\oakcloud`
Baseline commit: `bfdc4f95594b73ce4d20bff45f320bdb53837c37`
Contract version and status: **v1 frozen at G0**; `coordination/g0.md` is authoritative.
Integrated prerequisites and published consumer APIs: C0/S0/F0/W0 and G0 freeze are integrated. Consume C01/C04 from `editor-session.ts`; consume the frozen C02 structural-selection and C04 projection-map contracts from SEMANTICS; preserve C05/C06 field/policy boundaries without implementing F-owned grammar or policy.
Exclusive writable production/test/document paths:
- `src/components/documents/a4-page-editor.tsx`
- `src/components/documents/a4-editor-toolbar.tsx` only where C1 compatibility/integration requires it
- `src/components/documents/a4-pagination/editor-session.ts` (CORE-owned exception)
- CORE-owned new editor session/native-input/history modules under `src/components/documents/`
- `__tests__/components/a4-editor-session.test.ts`
- `__tests__/browser/a4-input-sequences.browser.test.tsx`
- existing CORE-owned A4 page-editor/toolbar/SSR/selection-scroll tests when a C1 regression requires an edit
- `docs/plans/2026-09-10-a4-editor-implementation/coordination/core.md`
- `docs/plans/2026-09-10-a4-editor-implementation/coordination/dispatch.md`
Allowed new files: CORE-owned editor session/native-input/history helpers and narrowly scoped CORE regressions within the ownership above. No S/F/W production module may be created or copied.
Reserved validation resources: Node 24; port `3420`; browser/cache `.tmp/a4-c1-core`; no database mutation. CORE alone may use the shared build/config/generated-output window.
Required acceptance evidence: canonical snapshot before projection completion; Enter -> immediate typing; delete/format -> immediate typing; stale-pointer rejection/mapping without caret substitution; exactly-once input/paste; bounded composition; stale projection publication rejection; untouched later canonical nodes preserved; A -> B -> Undo isolation; controlled-value acknowledgement; relevant existing CORE regressions. Record exact commands and pass/fail counts, and record blocked browser/IME evidence explicitly.
Allowed independent work if a producer is not yet available: implement the complete C1 authority/input/history boundary against frozen S0/F0 contracts and compatibility adapters. Do not reproduce S1 structural algorithms or F1 parser/policy behavior. C2 wiring that requires S1 production commands is not authorized.
Handoff path: `docs/plans/2026-09-10-a4-editor-implementation/coordination/core.md`
Completion boundary and next dependency: stop at **READY FOR INTEGRATION — C1 only**. Do not begin C2. G1 requires C1 + integrated S1 evidence.

## SEMANTICS-S1-20260911-01

Dispatch ID: `SEMANTICS-S1-20260911-01`
Role and packet: SEMANTICS / S1 — structural positions, commands and versioned break readers/projection
State: **DISPATCHED**
Working directory: `C:\Users\Scofieldkoh\Documents\oakcloud`
Baseline commit: `bfdc4f95594b73ce4d20bff45f320bdb53837c37`
Contract version and status: **v1 frozen at G0**; C02/C03/C04 decisions in `coordination/g0.md` are fixed.
Integrated prerequisites and published consumer APIs: S0 proof and CORE C0 bridge are integrated. CORE remains the sole editor/session revision authority; S position/projection maps copy CORE `sessionKey` and `documentRevision`.
Exclusive writable production/test/document paths:
- SEMANTICS-owned `src/components/documents/a4-pagination/{model.ts,selection.ts,document-actions.ts,formatting.ts,engine.ts,measure.ts,layout.ts,a4-page-layout.ts,a4-page-content-css.ts,a4-font-faces.ts,structural-position.ts,semantic-page-breaks.ts}`
- `src/components/documents/a4-print-styles.ts`
- `src/lib/document-page-breaks.ts`
- SEMANTICS-owned new structural/change-map/projection modules within that domain
- `__tests__/components/a4-pagination/**`
- `__tests__/browser/a4-boundary-semantics.browser.test.tsx`
- `docs/plans/2026-09-10-a4-editor-implementation/coordination/semantics.md`
Allowed new files: S-owned structural position/change-map/command/projection helpers and S regressions only. `editor-session.ts`, `a4-page-editor.tsx`, F parser/policy files and W routes/services are excluded.
Reserved validation resources: Node 24; port `3421`; browser/cache `.tmp/a4-s1-semantics`; no database mutation; no shared build/generated-output commands.
Required acceptance evidence: C02 position validation/comparison/mapping; zero-text/affinity round trips; canonical C03 nested break insertion/removal preserving one logical item; legacy + v2 readers; tree-aware projection; deletion/Enter transaction results; Unicode/grapheme boundary proof; revision-qualified C04 maps with no S revision counter; explicit unsupported table-cell behavior.
Allowed independent work if a producer is not yet available: all S1 pure structural/command/projection implementation against the frozen C01 shape. Do not edit CORE to wire it and do not implement W output routes/bundle generation.
Handoff path: `docs/plans/2026-09-10-a4-editor-implementation/coordination/semantics.md`
Completion boundary and next dependency: stop at **READY FOR INTEGRATION — S1 only**. No S2. Publish exact producer exports for CORE/W consumers.

## FIELDS-F1-20260911-01

Dispatch ID: `FIELDS-F1-20260911-01`
Role and packet: FIELDS / F1 — one parser, registry, lossless definitions and content-policy contract
State: **DISPATCHED**
Working directory: `C:\Users\Scofieldkoh\Documents\oakcloud`
Baseline commit: `bfdc4f95594b73ce4d20bff45f320bdb53837c37`
Contract version and status: **v1 frozen at G0**; C05/C06 identity/trust decisions are fixed.
Integrated prerequisites and published consumer APIs: F0 grammar/definition/trust proofs are integrated. Consume frozen C01/C02 identities without editing CORE/S owners.
Exclusive writable production/test/document paths:
- `src/components/documents/template-editor/**` except route-level wrappers owned by WORKFLOW
- `src/types/placeholders.ts`
- `src/lib/template-placeholder-storage.ts`
- `src/lib/template-analysis.ts`
- `src/lib/placeholder-resolver.ts`
- `src/lib/document-generation-master-fields.ts`
- `src/lib/template-field-contract.ts`
- `src/lib/a4-content-policy.ts`
- FIELDS-owned new parser/registry/definition/content-policy domain modules
- corresponding F-owned template-editor/lib resolver/storage/parser/policy tests
- `docs/plans/2026-09-10-a4-editor-implementation/coordination/fields.md`
Allowed new files: F-owned HTML-aware parser, field registry/lossless adapters/content-policy modules and regressions. No W route/API/Zod/batch file and no CORE editor file.
Reserved validation resources: Node 24; port `3422`; browser/cache `.tmp/a4-f1-fields`; no database mutation; no shared build/generated-output commands.
Required acceptance evidence: shared parser grammar/source spans/diagnostics; scoped stable identities; lossless round-trip including legacy/unknown metadata; typed value/input descriptors; duplicate-scope handling; unsupported legacy preserve-only behavior; C06 declarative-text/trusted-rich authority separation; policy semantics including the exact C03 break attribute.
Allowed independent work if a producer is not yet available: complete F1 parser/registry/lossless/policy domain work and tests. Route/API preservation wiring remains a WORKFLOW responsibility; do not duplicate it.
Handoff path: `docs/plans/2026-09-10-a4-editor-implementation/coordination/fields.md`
Completion boundary and next dependency: stop at **READY FOR INTEGRATION — F1 only**. No F2/F3 and no changed production escaping writer activation.

## WORKFLOW-W1-20260911-01

Dispatch ID: `WORKFLOW-W1-20260911-01`
Role and packet: WORKFLOW / W1 — reader expansion, output fail-safe and persistence revision plumbing
State: **DISPATCHED**
Working directory: `C:\Users\Scofieldkoh\Documents\oakcloud`
Baseline commit: `bfdc4f95594b73ce4d20bff45f320bdb53837c37`
Contract version and status: **v1 frozen at G0**; C07/C09/C10 and reader-before-writer ordering are fixed.
Integrated prerequisites and published consumer APIs: W0 writer/reader/capability/revision inventory is integrated. C01 is frozen; S1/F1 producer implementations are not yet integrated at dispatch time.
Exclusive writable production/test/document paths:
- template/partial and generated-document route pages owned by WORKFLOW
- `src/components/documents/generation-batch/**`
- document template/partial/generator/export services and document-generation-batch services
- related document APIs and validation schemas
- `prisma/schema.prisma` and W-owned forward migrations
- server font adapter
- pagination bundle build script and generated pagination bundle (generation itself waits for CORE integration window)
- W-owned persistence/route/batch/output tests
- W-owned capability module/page-bootstrap route introduced by the frozen W0 design
- `docs/plans/2026-09-10-a4-editor-implementation/coordination/workflow.md`
Allowed new files: W-owned capability/readers/revision migration/API/service/output files and tests inside the scopes above. Do not create a competing S break parser/change map or F field parser/content policy.
Reserved validation resources: Node 24; port `3423`; browser/cache `.tmp/a4-w1-workflow`; explicitly disposable synthetic database/schema only for persistence/concurrency/migration proof. Shared Prisma/bundle generation is reserved to a CORE integration window.
Required acceptance evidence: additive `expectedRevision` plumbing and GeneratedDocument revision migration; atomic scoped conflict behavior; reader/capability fallback; explicit non-clipping export failure; font/resource cleanup; writer inventory participation; old-client/read compatibility. After S1/F1 integration, add the required legacy/v2 break reader and C06 policy adapters and regenerate/check the pagination bundle through the coordinated integration window.
Allowed independent work if a producer is not yet available: **W1 may immediately implement its independent revision, export-failure, font/resource and capability work. It must not recreate S1 or F1 functionality. S1/F1-dependent break-reader, parser/policy and sanitizer integration must wait until those producer exports have been reviewed and integrated.**
Handoff path: `docs/plans/2026-09-10-a4-editor-implementation/coordination/workflow.md`
Completion boundary and next dependency: W1 may hand off an independent producer-complete subset while S1/F1 are pending, then finish only after CORE integrates the required exports. Stop at **READY FOR INTEGRATION — W1 only**. No W2.

## Shared resource reservations — Wave 0

Wave 0 is complete and integrated. Historical reservations below remain the record of the completed assignments; they do not authorize Stage 1 work.

- Git branch/index/commits, dependency installation, package/config changes, shared generated outputs: **CORE only**.
- Shared full build / `.next` output: **CORE only; workers must not run `next build` in the shared checkout during Wave 0**.
- Browser contexts and ports: CORE `3410`, SEMANTICS `3411`, FIELDS `3412`, WORKFLOW `3413`. Use isolated browser contexts and no shared authenticated fixture.
- Browser cache/output directories: `.tmp/a4-c0-core`, `.tmp/a4-s0-semantics`, `.tmp/a4-f0-fields`, `.tmp/a4-w0-workflow`; never reuse another role's directory.
- Database: Wave 0 production data is read-only. WORKFLOW may use only an explicitly disposable synthetic test database/schema for its own W0 tests; no other role has a database mutation lease.
- Generated pagination bundle and Prisma client: reserved to CORE integration windows; workers may inspect but must not regenerate in the shared checkout.
- Existing business records, credentials and document contents are never test fixtures.

## CORE-C0-20260911-01

Dispatch ID: CORE-C0-20260911-01
Role and packet: CORE / C0 — contract and input-routing proof
State: **INTEGRATED**
Working directory: `C:\Users\Scofieldkoh\Documents\oakcloud`
Baseline commit: `63aa75b6170766a3e3d1728feb5e5417f5632f20`
Merged PR: #30
Merge commit: `80056fb7ab6e410ef2d2ddc17a830b068d263671`
Contract version and status: v1 frozen at G0
Handoff path: `docs/plans/2026-09-10-a4-editor-implementation/coordination/core.md`
Completion boundary: C0 integrated; no C1 dispatch in this record.

## SEMANTICS-S0-20260911-01

Dispatch ID: SEMANTICS-S0-20260911-01
Role and packet: SEMANTICS / S0 — structural positions and nested break representation proof
State: **INTEGRATED**
Baseline commit: `63aa75b6170766a3e3d1728feb5e5417f5632f20`
Merged PR: #34
Merge commit: `f0238a954e7124819459266e19523419071d462a`
Contract version and status: v1 frozen at G0
Published interfaces: C02/C03/C04 structural positions, transaction result, nested break codec and revision-associated projection mapping.
Handoff path: `docs/plans/2026-09-10-a4-editor-implementation/coordination/semantics.md`
Completion boundary: S0 integrated; S1 remains undispatched historically.

## FIELDS-F0-20260911-01

Dispatch ID: FIELDS-F0-20260911-01
Role and packet: FIELDS / F0 — grammar, legacy and trust-boundary inventory
State: **INTEGRATED**
Baseline commit: `63aa75b6170766a3e3d1728feb5e5417f5632f20`
Merged PR: #32
Merge commit: `63028fe2f3479d469b7499e314aa0c1bbbbd63d9`
Contract version and status: v1 frozen at G0
Published interfaces: C05 scoped identity/lossless definitions/grammar and C06 content/trust policy.
Handoff path: `docs/plans/2026-09-10-a4-editor-implementation/coordination/fields.md`
Completion boundary: F0 integrated; F1 remains undispatched historically.

## WORKFLOW-W0-20260911-01

Dispatch ID: WORKFLOW-W0-20260911-01
Role and packet: WORKFLOW / W0 — writer, reader and deployment inventory
State: **INTEGRATED**
Baseline commit: `63aa75b6170766a3e3d1728feb5e5417f5632f20`
Merged PR: #33
Merge commit: `f5a103c85399a3e20d624140a963e19a79ced55a`
Contract version and status: v1 frozen at G0
Published interfaces/design: C07 `expectedRevision` mapping, GeneratedDocument dedicated revision design, C08 save/draft/preview semantics, C09 output compatibility, and C10 capability negotiation design.
Handoff path: `docs/plans/2026-09-10-a4-editor-implementation/coordination/workflow.md`
Completion boundary: W0 integrated; W1 remains undispatched historically.

## G0 contract freeze

G0 passed after CORE review of the actual merged C0/S0/F0/W0 evidence. The authoritative freeze record is:

`docs/plans/2026-09-10-a4-editor-implementation/coordination/g0.md`

Frozen high-level decisions include:

- CORE owns the only local editor revision authority and canonical session snapshot.
- SEMANTICS structural positions use text/children positions plus before/after affinity.
- Canonical nested page break is `<span data-a4-break="page"></span>`; legacy top-level hard breaks remain readable.
- Projection maps copy CORE `sessionKey`/`documentRevision`; they do not create another revision authority.
- Field identity is stable and owner-scoped; lossless definitions preserve legacy/unknown metadata.
- Client/stored field metadata cannot grant trusted-rich authority.
- Public persistence precondition is `expectedRevision`; Template/Partial map to existing `version`, GeneratedDocument gets a dedicated future `revision` while `templateVersion` remains provenance.
- Capability negotiation uses reader format level, allowed writer format level and revision-precondition mode, with conservative legacy fallback.
- No production v2 writer, strict revision enforcement, changed escaping behavior, migration, deployment or Stage 1 implementation was enabled by G0.

## Validation carried forward

Final Wave-0 PR heads passed the repository's Node-24 compatibility workflow. Worker environments did not execute every focused packet-specific Vitest command or actual Puppeteer PDF-byte/page-image validation. Those checks remain explicit later integration/output evidence and must not be claimed as passes merely because G0 is frozen.

## Integration freeze

**Wave 0 is complete. G0 PASSED. Stage 1 is dispatched from `bfdc4f95594b73ce4d20bff45f320bdb53837c37`.**


## Wave 2 assignments — released after G1 freeze

Common baseline for every assignment: `ad7285ace280f0b4002f119f923a8e2166b9475f`
Contract: **v1 frozen at G0 — unchanged**
Gate prerequisite: **G1 FROZEN/PASSED**; see `coordination/g1.md`.
Deployment: **not authorized**.
Application version bump: **not authorized**.
Scope rule: each owner implements only its named Wave-2 packet from the existing workstream plan and exclusive ownership table. No owner may start Wave 3/4/5 or silently change the frozen contract.

### CORE-C2-20260912-01

- Role / packet: **CORE — C2**.
- State: **DISPATCHED — implementation not started**.
- Start from: `ad7285ace280f0b4002f119f923a8e2166b9475f`.
- Objective: wire the already-integrated S1 semantic commands/structural mappings and F1 field hooks into the editor, remove remaining physical-page mutation authority, and satisfy native cross-page behavior under the frozen contracts.
- Prerequisites: C1 + S1 integrated and G1 frozen; consume F1/W1 interfaces without reimplementing their domains.
- Ownership: CORE production/tests only as defined in README/workstream ownership. Do not edit SEMANTICS/FIELDS/WORKFLOW production files.
- Required handoff: `coordination/core.md`; include exact commands/counts, compatibility impact, and any blocked dependency.
- Stop boundary: **C2 only**. Do not begin C3, deploy, or bump version.

### SEMANTICS-S2-20260912-01

- Role / packet: **SEMANTICS — S2**.
- State: **DISPATCHED — implementation not started**.
- Start from: `ad7285ace280f0b4002f119f923a8e2166b9475f`.
- Objective: implement list/Enter/indent/numbering and formatting correctness on top of S1 structural semantics, including required pure/native boundary/list regressions.
- Prerequisites: S1 integrated and G1 frozen. C1 remains the sole canonical revision/session authority.
- Ownership: SEMANTICS production/tests only as defined in README/workstream ownership. Do not edit CORE/FIELDS/WORKFLOW production files or create a second revision authority.
- Required handoff: `coordination/semantics.md`; include exact commands/counts, compatibility impact, and any blocked dependency.
- Stop boundary: **S2 only**. Do not begin S3, deploy, or bump version.

### FIELDS-F2-20260912-01

- Role / packet: **FIELDS — F2**.
- State: **DISPATCHED — implementation not started**.
- Start from: `ad7285ace280f0b4002f119f923a8e2166b9475f`.
- Objective: implement scoped field resolution, escaping, and atomic field lifecycle operations using the integrated F1 parser/registry/lossless/content-policy contracts; produce semantic field transactions and the renderer integration request owned by WORKFLOW.
- Prerequisites: F1 integrated and G1 frozen; preserve C05/C06 frozen identity/trust semantics.
- Ownership: FIELDS production/tests only as defined in README/workstream ownership. Do not edit CORE/W route files or activate W-owned persistence/output behavior.
- Required handoff: `coordination/fields.md`; include exact commands/counts, compatibility impact, and any blocked dependency.
- Stop boundary: **F2 only**. Do not begin F3, deploy, or bump version.

### WORKFLOW-W2-20260912-01

- Role / packet: **WORKFLOW — W2**.
- State: **DISPATCHED — implementation not started**.
- Start from: `ad7285ace280f0b4002f119f923a8e2166b9475f`.
- Objective: implement current-revision save, batch identity/layout, preview and draft integration so route adapters consume the existing C1 snapshot/concurrency contracts rather than reimplementing editor state.
- Prerequisites: C1 + F1 + W1 integrated and G1 frozen; consume S1 readers/mappings and the fresh `w1-s1-structural-v1` bundle as published.
- Ownership: WORKFLOW production/tests only as defined in README/workstream ownership. Do not edit CORE editor or F/S domain implementations.
- Required handoff: `coordination/workflow.md`; include exact commands/counts, compatibility/migration implications, and any blocked dependency.
- Stop boundary: **W2 only**. Do not begin W3, deploy, or bump version.

Wave-2 assignments are published by CORE/integrator only after the canonical G1 pass. Publication is not implementation; all four packets remain untouched at this dispatch commit.

## Wave-2 integration closeout / G2 candidate — 2026-09-12

**G2 CANDIDATE BLOCKED — CORRECTION REQUIRED**

- CORE integration branch: `codex/a4-editor-wave2-g2-integration-20260912`
- single integration PR: #47
- starting main: `6f1ab8d3cb90056c556771936f4c763d9596efdf`
- S2: PR #43 @ `4b025bec4f256169a32b2216b0fd54cd4a083349`
- F2: PR #45 @ `df56185328d20784ad870adf0750b0d0315996f8`
- W2: PR #44 @ `d5a98dd48d1b3196706cc41bd000b9f8f9f9b03f`
- C2: PR #46 @ `b154630a3227646a4cf8d562902566720c532fec`
- frozen contract: **v1 frozen at G0 — unchanged**
- G1: **FROZEN/PASSED**

Blocking corrections and exact ownership are recorded in `coordination/g2.md` and `coordination/core.md`.

**Q1 — G2 boundary and reader compatibility: WITHHELD.**

Do not start C3, S3, F3, W3, deployment or version bump.

## VERIFY-Q1-20260912-01 — released after corrected CORE matrix

Dispatch ID: `VERIFY-Q1-20260912-01`

Role / gate: **VERIFY / Q1 — G2 boundary and reader compatibility**

State: **DISPATCHED — independent verification not started**

Immutable production candidate: `6e8d4426c0d57043d85a830045dee465f6ff9a47`

Integration PR: **#47** on `codex/a4-editor-wave2-g2-integration-20260912`; PR remains open/unmerged. VERIFY must check out the exact candidate SHA above, not a later coordination-only PR head.

Contract: **v1 frozen at G0 — unchanged**.

Prerequisites: **G1 FROZEN/PASSED**; C2, S2, required W1/W2 adapters and the integrated Wave-2 candidate have passed the CORE-side immutable matrix. Production writers/production code are frozen at the candidate SHA while Q1 runs.

### VERIFY ownership and exact lease

VERIFY may write only independent acceptance evidence under these leases:

- `docs/plans/2026-09-10-a4-editor-implementation/coordination/verify.md`;
- new Q1-only acceptance tests, if needed, at `__tests__/browser/a4-q1-acceptance.browser.test.tsx`;
- new Q1-only persistence acceptance tests, if needed, at `__tests__/integration/a4-editor-q1-persistence.test.ts`;
- new Q1-only output acceptance tests, if needed, at `tests/document-output/a4-editor-q1-output.test.ts`.

VERIFY must not edit production code, frozen contracts, shared configuration, existing owner tests, migrations, package metadata, version files, or Git history. A production defect returns to CORE/owner for correction and a new candidate.

### Reserved verification resources

- Node: **24 (`>=24 <25`)**, executable verified in the report;
- primary browser: real Chromium using an isolated context; use `.tmp/a4-q1-verify` for Q1-only browser/cache artifacts;
- server port if a live synthetic app fixture is required: **3423**, released from WORKFLOW after Wave-2 handoff;
- database: only a disposable synthetic test database/schema; no production or existing business data;
- output fixtures: synthetic only; actual generated PDF/HTML may be produced for verification, but nothing may be sent, signed, finalized, filed, or deployed.

### Required Q1 evidence

Run the complete Q1 acceptance in `verification-and-rollout.md`, including Q1-01 through Q1-12. In particular:

- native Enter -> immediate typing, Backspace/Delete, formatting, paste, field insertion, break removal and cross-page selections with no synthetic inter-action waits;
- hard/soft break behavior, nested/long lists, numbering/restart/continuation, Tab/Shift+Tab, toolbar indent, list exit and undo;
- document A/B history isolation and save/reopen agreement across canonical/ref/parent/server/reopened content;
- `ol start=5`, alpha/bold/nested numbering through save/reopen and **actual PDF**, asserting every original item/text once and correct list continuation;
- two-item batch identity/layout preservation and required old/new reader compatibility;
- native blank-page add/delete proof without weakening or skipping assertions;
- the critical deterministic fixture for at least **20 consecutive native sequences** per supported primary browser configuration, plus fault/delayed variants;
- preserve failure artifacts/revisions; one unexplained content-loss event keeps G2 open.

VERIFY must confirm actual HEAD/build equals `6e8d4426c0d57043d85a830045dee465f6ff9a47` before recording results. If the candidate changes, stop and request a fresh immutable assignment.

### Completion boundary

Write the independent gate report to `coordination/verify.md` with environment, exact commands/counts, native sequence results, PDF/HTML evidence, compatibility/readers, blocked/untested checks, defects and technical promotion decision.

Stop after the Q1 report. Q1 verification is not deployment permission. Do not start Q2, D1, C3, S3, F3, W3, deployment or a version bump.

## CURRENT AUTHORITATIVE STATE — G2/Q1 PASSED; WAVE 4 RELEASED — 2026-09-13

This section supersedes earlier operational status lines above while preserving them as historical dispatch evidence.

- Corrected production tree independently verified for G2/Q1: `e232f998475f87248588c79cdc63988e942f0da2`.
- Independent Q1 evidence PR: **#48 — merged**.
- Current merged `main` and Wave-4 common baseline: `140cb7aa421c8856a6b5b6ef961618e8780fb1a9`.
- G2/Q1: **PASSED**. See `coordination/verify.md` for the historical blocked run, correction rerun, exact environment, artifacts and final technical decision.
- Contract: **v1 frozen at G0 — unchanged**.
- Deployment: **not authorized by this dispatch**. G2/Q1 is technically ready for separately authorized D1 promotion under `verification-and-rollout.md`.
- Application version bump: **not authorized merely by Wave-4 implementation**.
- Wave 4: **RELEASED — C3 / S3 / F3 / W3**.
- Q2/G4: **not released**. It starts only after Wave-4 integration produces an immutable candidate and the required G3 prerequisites are satisfied.

### Shared resource reservations — Wave 4

- Git branch/index/commits, shared dependency installation, package/configuration changes, shared Prisma generation, pagination-bundle integration generation, integration documentation and final merge operations: **CORE only** in the shared checkout.
- Shared full build / `.next` output: **CORE only**. Worker checks must use isolated caches/output and narrowly relevant commands.
- Browser/server reservations: CORE `3430` / `.tmp/a4-c3-core`; SEMANTICS `3431` / `.tmp/a4-s3-semantics`; FIELDS `3432` / `.tmp/a4-f3-fields`; WORKFLOW `3433` / `.tmp/a4-w3-workflow`.
- Database: CORE/SEMANTICS/FIELDS have no mutation lease. WORKFLOW may use only an explicitly disposable synthetic test database/schema for W3 persistence/schema/concurrency/output proof. Never mutate production or existing business data.
- Existing business records, credentials and document contents are never test fixtures. Use synthetic fixtures only.
- W3 publishes stable print/schema/input producer interfaces early. F3 publishes stable field-panel/typed-input producer interfaces early. CORE consumes reviewed producer interfaces in C3; agents must not duplicate another owner's implementation while waiting.
- S3 owns measurement/font/pagination source changes. WORKFLOW owns pagination-bundle generation/output consumers; S3 reports bundle-regeneration requirements rather than editing W-owned generated artifacts.
- No production deployment, real signing, filing, messaging or finalization is included in Wave 4.

### CORE-C3-20260913-01

Dispatch ID: `CORE-C3-20260913-01`
Role and packet: **CORE / C3 — controls, accessible editing, local print and Wave-4 integration**
State: **DISPATCHED — implementation not started**
Working directory: `C:\Users\Scofieldkoh\Documents\oakcloud`
Baseline commit: `140cb7aa421c8856a6b5b6ef961618e8780fb1a9`
Contract version and status: **v1 frozen at G0 — unchanged**.
Integrated prerequisites and published consumer APIs: C2/S2/F2/W2 are integrated into the G2/Q1-passed production tree; Q1 evidence is merged. Consume W3 shared print/schema/input producers and F3 stable field-panel/typed-input producers when published; consume S3 geometry/font capability outputs without reimplementing them.
Exclusive writable production/test/document paths:
- `src/components/documents/a4-page-editor.tsx`
- `src/components/documents/a4-editor-toolbar.tsx`
- CORE-owned editor/session/native-input/history modules and public session types under `src/components/documents/`, including the CORE-owned `a4-pagination/editor-session.ts` exception
- CORE-owned A4 page-editor/toolbar/SSR/selection-scroll/print/browser tests
- `docs/plans/2026-09-10-a4-editor-implementation/coordination/core.md`
- `docs/plans/2026-09-10-a4-editor-implementation/coordination/dispatch.md`
Allowed new files: narrowly scoped CORE C3 helpers/tests only. No S/F/W production module may be copied or recreated.
Reserved validation resources: Node 24; port `3430`; browser/cache `.tmp/a4-c3-core`; no database mutation; CORE owns shared build/config/generated-output integration windows.
Required acceptance evidence: primary control grouping; single clear Page break/Insert field entry points; accessible editor/toolbar semantics and keyboard/focus behavior; exactly-once pointer/keyboard/assistive activation; command applicability separate from reflow busy state; real W revision/save/error state; local print through W3 shared preparation with readiness and cleanup; persisted page-number control only when output support exists; preserve all G2/Q1 behaviours.
Allowed independent work if a producer is not yet available: toolbar organization, accessibility and activation correctness may proceed inside CORE ownership. Final field/print wiring must wait for reviewed F3/W3 producer interfaces; do not reproduce them locally.
Handoff path: `coordination/core.md`.
Completion boundary and next dependency: stop at **C3 + Wave-4 integration only**. After all owners hand off, integrate in dependency order, run shared checks, establish the immutable Wave-4 candidate, assess G3, and publish a separate VERIFY/Q2 assignment if ready. Do not perform Q2, deploy, or bump version.

### SEMANTICS-S3-20260913-01

Dispatch ID: `SEMANTICS-S3-20260913-01`
Role and packet: **SEMANTICS / S3 — geometry, font readiness and measured performance**
State: **DISPATCHED — implementation not started**
Working directory: `C:\Users\Scofieldkoh\Documents\oakcloud`
Baseline commit: `140cb7aa421c8856a6b5b6ef961618e8780fb1a9`
Contract version and status: **v1 frozen at G0 — unchanged**.
Integrated prerequisites and published consumer APIs: C2 + S2 + W1/W2 boundary/output foundations are integrated and G2/Q1 passed. Coordinate final output parity with W3; CORE remains sole editor/session authority.
Exclusive writable production/test/document paths:
- SEMANTICS-owned `src/components/documents/a4-pagination/{model.ts,selection.ts,document-actions.ts,formatting.ts,engine.ts,measure.ts,layout.ts,a4-page-layout.ts,a4-page-content-css.ts,a4-font-faces.ts,structural-position.ts,semantic-page-breaks.ts}`
- `src/components/documents/a4-print-styles.ts`
- `src/lib/document-page-breaks.ts`
- S-owned measurement/font/pagination helpers
- `__tests__/components/a4-pagination/**`
- S-owned pagination/font/performance regressions
- `docs/plans/2026-09-10-a4-editor-implementation/coordination/semantics.md`
Allowed new files: S3 measurement/font/performance helpers and focused S regressions only. No CORE editor/session file, F parser/field file, W route/service or W-generated bundle file.
Reserved validation resources: Node 24; port `3431`; browser/cache `.tmp/a4-s3-semantics`; no database mutation; no shared build/generated-output commands.
Required acceptance evidence: one coherent measurement/layout/font setup; explicit versioned font readiness; cold/warm convergence; preserved A4/legacy-v1 geometry; no clipping of oversized content; representative 1/10/30-page input-to-paint and pagination measurements; cache keys cover content/width/layout/font revision; optimized/full pagination equivalence; editor/PDF break and numbering parity; exact W3 bundle-regeneration requirements.
Allowed independent work if a producer is not yet available: all S3 source/equivalence/performance work inside S ownership. Final output parity records may wait for W3 consumers, but do not edit W-owned bundle/output code.
Handoff path: `coordination/semantics.md`.
Completion boundary and next dependency: stop at **S3 only**. Do not perform W3, Q2, deployment or version bump.

### FIELDS-F3-20260913-01

Dispatch ID: `FIELDS-F3-20260913-01`
Role and packet: **FIELDS / F3 — field authoring and discovery UX**
State: **DISPATCHED — implementation not started**
Working directory: `C:\Users\Scofieldkoh\Documents\oakcloud`
Baseline commit: `140cb7aa421c8856a6b5b6ef961618e8780fb1a9`
Contract version and status: **v1 frozen at G0 — unchanged**.
Integrated prerequisites and published consumer APIs: C2 + F2 are integrated and G2/Q1 passed. Preserve F1/F2 scoped identity, parser, escaping, content-policy and lifecycle semantics. Publish stable field-panel/typed-input producers early for W3/CORE.
Exclusive writable production/test/document paths:
- `src/components/documents/template-editor/**` except W-owned route-level wrappers
- `src/types/placeholders.ts`
- `src/lib/template-placeholder-storage.ts`
- `src/lib/template-analysis.ts`
- `src/lib/placeholder-resolver.ts`
- `src/lib/document-generation-master-fields.ts`
- `src/lib/template-field-contract.ts`
- `src/lib/a4-content-policy.ts`
- F-owned field registry/parser/lifecycle/content-policy helpers
- corresponding F-owned template-editor/lib resolver/storage/parser/policy tests
- `docs/plans/2026-09-10-a4-editor-implementation/coordination/fields.md`
Allowed new files: F3 field UX/search/typed-input helpers and focused F regressions within F ownership. No W route/API/Zod/batch file and no CORE editor/toolbar file.
Reserved validation resources: Node 24; port `3432`; browser/cache `.tmp/a4-f3-fields`; no database mutation; no shared build/generated-output commands.
Required acceptance evidence: atomic recognizable inline-field presentation using canonical expressions underneath; source/type/description/default/value details; whole-token format/delete/copy/paste; anti-spoofed pasted chip attributes; complete key generation and clear Create vs Create-and-insert semantics; typed input descriptors; contextual registry/search/applicability; stable recents; usage/location deletion UX; diagnostic occurrence navigation contract; keyboard/focus/long-label/narrow-panel accessibility; bold/heading/list/table/adjacent/page-boundary field cases.
Allowed independent work if a producer is not yet available: complete F3 panel/catalog/typed-descriptor work and publish the interfaces. W applies route/batch integration and CORE applies editor focus/decoration integration; do not duplicate those consumers.
Handoff path: `coordination/fields.md`.
Completion boundary and next dependency: stop at **F3 only**. Do not perform W3, Q2, deployment or version bump.

### WORKFLOW-W3-20260913-01

Dispatch ID: `WORKFLOW-W3-20260913-01`
Role and packet: **WORKFLOW / W3 — field, preview and output completion**
State: **DISPATCHED — implementation not started**
Working directory: `C:\Users\Scofieldkoh\Documents\oakcloud`
Baseline commit: `140cb7aa421c8856a6b5b6ef961618e8780fb1a9`
Contract version and status: **v1 frozen at G0 — unchanged**.
Integrated prerequisites and published consumer APIs: W2 + F2 + S2 are integrated and G2/Q1 passed. Publish shared print/schema/input producer commits/interfaces early for CORE C3 and F3 consumers; final acceptance consumes integrated F3/S3/C3.
Exclusive writable production/test/document paths:
- template/partial and generated-document route pages owned by WORKFLOW
- `src/components/documents/generation-batch/**`
- document template/partial/generator/export services and document-generation-batch services
- related document APIs and validation schemas
- `prisma/schema.prisma` and W-owned forward migrations where W3 actually requires them
- server font adapter
- pagination bundle build script and generated pagination bundle
- W-owned persistence/route/batch/output/component/service/integration tests
- W-owned capability/page-bootstrap routes/modules
- `docs/plans/2026-09-10-a4-editor-implementation/coordination/workflow.md`
Allowed new files: W3 route/service/schema/output/print-preparation helpers and focused W regressions within W ownership. Do not create competing S pagination logic, F parser/policy/identity logic or CORE editor/session logic.
Reserved validation resources: Node 24; port `3433`; browser/cache `.tmp/a4-w3-workflow`; explicitly disposable synthetic database/schema only; shared Prisma/bundle generation that can affect the shared checkout is coordinated through CORE's integration window.
Required acceptance evidence: F typed descriptors applied without false/zero/date/multiline/precision loss; scoped partial collisions and intentional linkings through canonical preview/generation; stable IDs/legacy types/options/path/source/unknown metadata survive API/Zod; policy-gated plain-text escaping and trusted-rich authority; schemas carried consistently through templates/partials/snapshots/drafts without historical rewrite; shared page assembly for local print/PDF/HTML; captions/quotes/footers/list starts/breaks/layout preserved; page numbers only when all outputs support them; letterhead/watermark/margins/cold-font/long-value proof; final S3 bundle freshness; synthetic service-agreement/task-launched generation regressions; recoverable failures and old-snapshot readability; strict C07/C03/C05 rollout-readiness tests.
Allowed independent work if a producer is not yet available: publish W3 print/schema/input producers and complete W-owned canonical service/output work against integrated F2/S2. Consume F3/S3 final producers when reviewed; do not duplicate them.
Handoff path: `coordination/workflow.md`.
Completion boundary and next dependency: stop at **W3 only**. Do not deploy, activate a production rollout, perform Q2 or bump version.

Wave-4 assignments are now published from the merged Q1 evidence baseline. Publication authorizes only the named implementation packets under their ownership boundaries; it does not itself deploy D1/D2/D3 or release Q2.

## WAVE-4 INTEGRATION CLOSEOUT / VERIFY-Q2-G4-20260913-01 — 2026-09-13

Dispatch ID: `VERIFY-Q2-G4-20260913-01`

Role / gate: **independent VERIFY — remaining G3 acceptance, then G4 / Q2 full acceptance**

State: **DISPATCHED — independent verification not started**

Immutable product candidate: `b522cf50f61f18b75f2cae62b42cd142bef4cf2d`

Integration branch: `codex/a4-editor-wave4-integration-20260913`. The final integration PR targets `main` and must remain unmerged until the user separately authorizes merge after independent verification. VERIFY must check out the exact candidate SHA above, not a later coordination-only branch head.

Contract: **v1 frozen at G0 — unchanged**.

Prerequisites: G2/Q1 remains **PASSED**; C3/S3/F3/W3 are integrated on the Wave-4 branch. CORE integration evidence is green, but CORE does not self-certify independent Q2/G4.

### CORE G3 assessment

CORE assesses the integrated implementation as **G3 implementation-complete / ready for independent acceptance**: typed/scoped field lifecycle, lossless definitions and metadata, plain-text/trusted-rich policy, revision/draft/preview behavior and common output preparation are integrated. Because `verification-and-rollout.md` requires actual output and real user-interaction evidence, G3 is not promoted by CORE to an independently accepted release gate. VERIFY must close the remaining G3 evidence first; if it passes on this same immutable target, continue immediately into G4/Q2.

### VERIFY ownership and exact lease

VERIFY may add only independent acceptance evidence under named verification paths, for example:

- `docs/plans/2026-09-10-a4-editor-implementation/coordination/verify.md`;
- `__tests__/browser/a4-q2-acceptance.browser.test.tsx`;
- `__tests__/integration/a4-editor-q2-persistence.test.ts`;
- `tests/document-output/a4-editor-q2-output.test.ts`;
- narrowly scoped Q2-only fixture/evidence files required by those tests.

VERIFY must not edit production code, frozen contracts, owner tests, migrations, package/version files, deployment configuration or existing business data. Product defects return to CORE/SEMANTICS/FIELDS/WORKFLOW and require a new frozen candidate.

### Required independent Q2 / G4 evidence

Follow the complete Q2 and G4 sections of `verification-and-rollout.md`, including at minimum:

- one field grammar across simple/spaced/modifier/loop/partial syntax and repairable diagnostics;
- atomic fields through bold/headings/lists/tables/adjacency/page boundaries, identity-preserving rename/migration/delete/undo, colliding nested partial scopes and intentional linkings;
- literal ampersand/angle-bracket text, trusted-rich policy, false/zero/empty/missing/date/multiline/default behavior and legacy/unknown metadata no-change API round-trip;
- immediate/repeated save ordering, two-client expected-revision conflicts, template/partial/generated-draft/batch revisions, wrong-tenant/permission/locked/deleted behavior, draft recovery and stale preview suppression;
- complete four-stage batch UI journey with identity/layout/reviewed fingerprint/manual content/dependency preservation;
- **actual PDF and HTML** from generated snapshots, PDF page rendering/inspection, unique sentinels exactly once/in order, numbering/quotes/captions/footer rows/images/sup/sub/margins/spacing/letterhead/page numbers/watermark parity;
- cold/warm/slow-font convergence, oversized-content presence and guidance;
- forced pagination failure, stale/missing bundle, font failure and export timeout with fail-closed output and resource cleanup;
- local print through the shared output contract including cancellation;
- real synthetic clipboard content from Word, Google Docs, Outlook/email, a website and plain text;
- keyboard/mouse/cut-copy-paste/select-all/navigation, real IME composition, emoji/grapheme deletion, screen-reader/focus order and supported narrow desktop/tablet views;
- representative staff Journeys A-D with recorded observations and the programme's stated success target;
- repository checks under Node 24, browser suites, production build, disposable PostgreSQL migration/concurrency suites and capability/bundle-version checks on the actual candidate;
- rollback rehearsal/minimum compatible reader and explicit blocked status for any unavailable required environment. Missing smoke URLs or device/AT environments do not count as passes.

VERIFY must confirm `git rev-parse HEAD` equals `b522cf50f61f18b75f2cae62b42cd142bef4cf2d` before decisive product checks. If source changes, stop and request a new immutable dispatch.

### Completion boundary

Write the independent report to `coordination/verify.md` with environment, exact commands/counts, native/real-user results, PDF/HTML/visual evidence, compatibility/capability versions, blocked checks, defects, rollback minimum and technical promotion decision.

Do **not** merge the final Wave-4 PR to `main`, deploy D1/D2/D3, activate strict rollout behavior, finalize/send/sign/file real documents, or bump the application version from this assignment. Q2/G4 technical acceptance is not deployment permission.
