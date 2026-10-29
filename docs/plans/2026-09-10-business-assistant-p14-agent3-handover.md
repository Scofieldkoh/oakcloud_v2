# Business Assistant P14 — Parallel Agent 3 Handover

**Parent implementation plan:** `docs/plans/2026-09-05-business-assistant-implementation.md`  
**Workstream:** P14 — Governed preference and learning lifecycle  
**Agent:** Parallel Agent 3 of 4  
**Date:** 2026-09-10 (Singapore)  
**Repository:** `Scofieldkoh/oakcloud`  
**Branch:** `chatgpt/business-assistant-p14-learning-agent3-20260910`  
**Pull request:** #23 — https://github.com/Scofieldkoh/oakcloud/pull/23  
**Base commit:** `cde965ae0caad40c6553c67a164421be956167f0`  
**Cycle-10/final commit:** the commit containing this handover; use PR #23 head SHA as the authoritative immutable final SHA because a Git commit cannot self-reference its own SHA without changing that SHA.

This file is the P14 parallel-development handover extension to the parent implementation plan. It is intentionally separate from the shared plan so Parallel Agents 1, 2 and 4 can update their own work without all four branches rewriting the same shared handover file. P12 correction/full-state review, P13/P15 operational hardening, P16 final release verification, and collection-row correction design remain outside this workstream.

## Activation state

**Production learning promotion remains GATED / DISABLED.** The production gate is a source-controlled constant (`PRODUCTION_RELEASED = false`) and there is no production environment variable that can activate promotion. The only override is guarded to `NODE_ENV=test` plus Vitest and exists solely to exercise the promotion lifecycle in tests.

This gate must not be changed merely because P14 mechanics exist. As of this handover, Parallel Agent 2 PR #19 reports its own final verification as not green and does not establish the independent held-out reviewer-quality PASS required by the parent plan. P16 final release verification is also still outstanding. Both release dependencies must be resolved before a separate reviewed source change can enable production promotion.

Provider dispatch and mutation dispatch were not activated by P14.

## P14 implementation completed

### Source-controlled learnable targets

Learnable configuration is restricted to an explicit registry for `assistant.answer` capability version `1.0`:

- `assistant.language` — bounded preference
- `assistant.response_detail` — bounded preference
- `assistant.playfulness` — bounded preference
- `assistant.prompt_profile` — strict bounded object (`tone`, `maxSentences`, `includeCitations`)

Arbitrary runtime, provider, code, database and unknown target namespaces are rejected. Target kind, capability ID and capability version come from the registry, not the request.

Legacy aliases are enumerated explicitly. No prefix stripping or heuristic normalization is used. Unlisted aliases therefore fail closed instead of silently mapping into a new learnable namespace.

### Held-out behavioural evaluation

P14 replaces static schema-only evaluation with a server-owned held-out behavioural suite. Candidate-supplied evidence cannot supply cases, thresholds or expected outputs. The suite exercises the same deterministic learning projection/style-policy code consumed by `assistant.answer` and includes:

1. intended runtime behaviour;
2. bounded server-owned directive rendering;
3. other-capability isolation;
4. other-version isolation;
5. malformed-value rejection;
6. evidence-independent fixtures.

Evaluation provenance is bound to evaluator version, suite ID/version, fixture digest, target/capability binding and candidate digest. `APPROVE` requires the current trusted behavioural result. Schema validity or copied evaluation JSON is insufficient. A passing P14 behavioural result deliberately still reports `promotionEligible: false`; production release eligibility remains a separate gate.

### Candidate, authorization and promotion lifecycle

Learning list/create/actions are administrator-only. Mutations use the Business Assistant operation barrier, fresh in-transaction actor/workspace authorization, restore-pause checks and serializable transactions.

Candidate creation canonicalizes the target and stores server-owned governance evidence including capability scope and the active-target revision observed at creation. Caller evidence is nested as source evidence and cannot overwrite the governance fields.

Candidate actions use `expectedVersion` compare-and-swap. Promotion additionally requires the active target to match both the candidate baseline version and baseline target revision. This prevents stale promotion and version ABA (target changes away and later returns to the same version). Existing-target activation uses revision CAS; a CAS loser is rejected. Promotion creates a typed active-value envelope carrying capability/version, candidate lineage, SHA-256 value digest, activation time and governed expiry.

Promotion/rollback/evaluate/approve/reject create auditable lifecycle records with actor/workspace, state transition, version lineage, candidate digest, expected/result versions, evaluation digest, target revision and release-gate/test-only state.

### Runtime consumption and cache invalidation

`assistant.answer` reads all four governed learning targets fresh at execution time, after fresh execution authorization and immediately before provider dispatch. No cross-request learning cache was introduced. Activated configuration is projected through the same bounded runtime transformer exercised by held-out evaluation and produces fixed server-owned prompt directives.

Confirmed user/session response preferences remain more specific than tenant learning and overlay the tenant policy for the same bounded target. Current-turn user text remains untrusted input and is not converted into persistence consent by the answer capability.

Tests exercise a promoted `response_detail`/`prompt_profile` value becoming visible in the provider prompt, then a later execution observing default/deactivated values without reusing stale configuration.

### Deactivation, expiry, rollback and deletion

Active target values use a typed envelope with states `ACTIVE`, `DEACTIVATED`, `EXPIRED` and `DELETED`.

- Deactivation is revision-CAS protected and removes the active mutation pointer/value from runtime consumption.
- Expiry is governed by source-controlled TTL (90 days for the preference targets, 30 days for prompt profile). Runtime decoding is lazy-fail-safe: an expired value falls back to source-controlled defaults even before an explicit expiry transition persists the marker.
- Rollback is allowed only while the exact promoted envelope/change/version is still active, and itself uses target revision CAS. Deactivation, expiry and deletion therefore block stale rollback.
- Deletion persists a target tombstone even when no active target row previously existed, scrubs current/previous target values and all tenant candidate payload/evaluation/approval/rollback data for that target, while retaining minimal ID/version/state lineage in audit records.
- Direct and feedback-derived candidate creation and promotion reject deleted target tombstones, preventing retained/superseded data from recreating deleted preferences.

### Feedback-derived learning and source deletion

Feedback can derive a learning candidate only when it targets an already-confirmed, active, unexpired USER/TENANT preference memory. The candidate target is derived from the confirmed memory key; callers cannot choose a runtime/database target. Capability/version are checked. The candidate value comes only from the confirmed memory, never from free-form feedback text or current-turn style instructions, and remains `CANDIDATE` until governed evaluation/approval/activation.

Deleting a confirmed source memory atomically cleans descendants in the same transaction. Derived candidates are scrubbed and rejected. Any currently active derived target is deactivated by CAS. Cycle 10 additionally closes the supersession resurrection case: cleanup inspects both `activeValue` and `previousValue`, so a deleted preference cannot survive in an unrelated active configuration's rollback slot or in an envelope previously restored with `activeChangeId = null`. Hidden rollback payloads are removed/replaced with source-controlled defaults before descendant scrubbing completes.

## Exact ten-cycle record

| Cycle | Commit | Review focus and material result |
|---|---|---|
| 1 | `a36463217876b565b8f55521f01e13bd1fe92020` | Implemented source-controlled target registry, server-owned held-out behavioural evaluator, candidate binding, explicit aliases, admin enforcement and compile-time release gate. Review rejected heuristic alias normalization and schema-only evaluation. |
| 2 | `2243f1a9b41f436b9fd86bf0ffd122858a61ce1f` | Reviewed stale promotion, authorization and audit lineage. Added typed active envelopes, target revision CAS, test-only activation path, TTL metadata and lifecycle audit foundation. |
| 3 | `7b36a51c0ff758017211f3f85f7a4d9016f1a2ea` | Reviewed runtime-consumption failure/stale cache. Wired fresh governed learning reads into `assistant.answer`, fixed server-owned directives, and preserved confirmed user/session preference precedence. |
| 4 | `009dcc95a843369316a490a35c053af7c88be009` | Reviewed rollback/expiry/delete bypass. Added deactivation, expiry, deletion tombstones, candidate scrubbing, revision CAS and lifecycle tests. |
| 5 | `b9b750ed772f20596fd10988d8a4b48142dc46ac` | Reviewed derived-data resurrection and persistence consent. Restricted feedback derivation to confirmed memories, added atomic source-memory descendant cleanup, and prevented session/current-turn style data from deriving tenant learning. |
| 6 | `942d8b9b68b9272204bb2afeab1e7ff8fbf1bd1f` | Reviewed version ABA and action races. Bound candidates to baseline target revision, added candidate expected-version CAS, expanded action audit lineage, and rejected pre-governance candidates for promotion. |
| 7 | `9c7b3f1e674ddd352e0ea4b4b7597f5dfc15d940` | Reviewed HTTP boundary, cacheability and read authorization. Added strict no-store lifecycle/derivation routes; tenant learning status is administrator-only. |
| 8 | `133cca768a88f46609d8ace1284ef71c697dcd92` | Reviewed database CAS assumptions. Added PostgreSQL concurrency coverage for competing promotion, delete-vs-stale-rollback and tenant isolation; added the test to the BA PostgreSQL suite. An unrelated dependency drift was caught and removed before commit. |
| 9 | `9994f19d454eeaae96a6847b51f81b8300aa8223` | Reviewed evaluation gaming, cross-capability/workspace leakage and stale runtime cache. Added adversarial held-out invariants and repeated-execution cache-refresh tests. Rechecked parallel PRs; Agent 2 release dependency remains unsatisfied. |
| 10 | **this commit / PR #23 head** | Final review found a hidden deleted-data resurrection path through `previousValue` after supersession. Fixed descendant cleanup to inspect active and rollback envelopes, scrub hidden rollback payloads under CAS, and added dedicated regression coverage. Added this P14 handover. |

Exactly ten workstream commits exist after the pinned branch base. No merge to `main` is part of this handover.

## Verification state

Static connector review was performed against the PR diff, generated Prisma model surface, package-script diff and Node 24 workflow definition. The branch changes introduce no Prisma schema migration and no provider/mutation enablement.

The following executable verification is **not claimed as run in this agent environment** because no GitHub Actions workflow/status run was present for the branch head and the available shell environment could not reach GitHub to materialize the repository. These commands remain mandatory before release/merge:

- lint;
- typecheck;
- Prisma generation;
- Business Assistant registry freshness;
- Business Assistant preference/learning tests;
- authorization tests;
- PostgreSQL concurrency/lifecycle tests with `BUSINESS_ASSISTANT_TEST_DATABASE_URL`;
- build;
- Node 24 compatibility workflow.

The new test coverage is written to exercise the required chain: confirmed preference/feedback -> candidate -> held-out evaluation -> authorized approval -> **test-only** activation -> visible `assistant.answer` runtime consumption -> rollback/deactivation/expiry/delete, including cache and derived-data cleanup. Production activation is intentionally not exercised or enabled.

## Remaining dependencies / known limitations

1. Parallel Agent 2 independent reviewer-quality evaluation must reach the release standard required by the parent plan. PR #19 currently does not establish that green held-out reviewer PASS.
2. P16 final release verification remains required.
3. Executable CI/test-database verification above must be green before this work can be considered merge/release ready. Keep PR #23 draft while those gates are unresolved.
4. Expiry is immediately enforced on runtime read, but this P14 scope does not add a scheduler to persist expiry markers proactively; explicit expiry lifecycle service/API can persist the marker.
5. Deleted learning-target tombstones intentionally prevent recreation from retained/direct/derived candidates. Any future product requirement to allow a genuinely new preference after deletion needs an explicit, separately governed reset operation rather than alias/rollback reuse.
6. Collection-row correction design, P12 correction/runtime review, P13/P15 operational hardening and P16 are intentionally untouched.

## Release instruction

Do not merge this PR and do not change `PRODUCTION_RELEASED` until the independent reviewer-quality evaluation, executable verification and P16 release requirements are genuinely satisfied. A source-controlled release change should be separately reviewed so activation cannot occur through configuration drift or an environment toggle.
