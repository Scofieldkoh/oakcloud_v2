# Verification and staged rollout plan

Status: **not started; no release gate has passed under this implementation plan**. Owner: I, with Q in a freed worker slot. Read [README](README.md), [contracts](contracts.md), and review sections H/J/K. The implementation contract and acceptance evidence must refer to the same integrated commit.

## Objective and verification independence

Prove that ordinary actions preserve the intended document across editor, save/reload, generation and actual output. A successful build, correct screenshot or page count alone cannot establish content integrity.

Q verifies an immutable integration commit or isolated worktree with no concurrent production edits. Q may add focused acceptance tests under a named lease; application fixes return to CORE/S/F/W. After a fix, record the new commit and repeat the affected gate plus its dependent checks. Do not keep testing an old running server after source integration.

This plan uses no more than four active agents. Q1 replaces W after the boundary prerequisites integrate; Q2 uses S's freed slot after semantics/performance stabilize. If a production owner must resume, free a later-work slot first.

## Baseline and environment

The review baseline was `c660b47f1731a9262cf722197907e21f8e3e98fe`: 307 targeted non-browser tests passed; browser tests had 52 passes and one unresolved blank-page add/delete failure. Those historical results are not tests of the planned implementation. The review's temporary template/document/batch were cleaned up and their API reads returned404; do not reuse those IDs.

- Use Node24 (`>=24 <25`); verify the executable instead of relying on the shell default.
- Use the browser integration available in the implementation environment and the frontend testing skill's routing rules. The review used ordinary Playwright because its preferred browser plugin was unavailable; recheck availability rather than assuming that is still true.
- Give each worktree its own dev-server port, build/cache outputs and disposable test database/schema where supported. One agent owns the authenticated browser context/live-app fixture at a time. Parallel service/unit tests can run independently; never have two agents edit the same test document.
- Validate the target application build/commit, font readiness, viewport and configuration before recording browser results. Keep credentials out of fixtures, scripts, console output and reports.
- Establish supported browser/device/IME/accessibility targets at G0 using product/deployment context. Unknown or unavailable targets remain explicit gates; do not infer support from Chromium passing alone.
- Test environments with mutations use synthetic records named for the run and track created IDs. Cleanup uses canonical APIs only for those IDs, with readback. Do not finalize, send, sign or file a real document as an editor smoke test.

## Gate definitions

| Gate | Prerequisites | Required proof | Blocks |
| --- | --- | --- | --- |
| G0 — design/fixtures | C0/S0/F0/W0 | Frozen APIs/ownership; semantic v2 break proof; field compatibility and writer/reader inventory; failing baseline regressions | Production implementations that depend on unagreed contracts |
| G1 — canonical integrity | C1 + S1 integrated | No stale-DOM overwrite; structural positions; per-session history; current snapshot while projection lags | C2/W2 feature completion |
| G2 — boundary and reader compatibility / Q1 | C2 + S2 + W1 + required W2 adapters | Native page-boundary sequences, save/reopen, two-item batch identity, old/new readers and actual PDF/list continuation | D1 new-format writers and cross-page release |
| G3 — fields/workflow | F2/F3 + W2/W3 + C02/C05 integration | Complete typed/scoped field lifecycle, plain-text/rich compatibility, revisions/drafts/preview and actual output | D2 behavior activation |
| G4 — full acceptance / Q2 | C3/S3 plus G2/G3 | Required repository checks, supported browsers/IME/AT, real clipboard, staff journeys, rollback rehearsal and rollout evidence | D3/full programme completion |

G0 is a proof-and-contract gate, not a user-permission gate. Later deployment authorization is separate from technical readiness. Preparing or passing a plan/test gate does not itself execute a production deployment.

## Q1: primary cross-page acceptance

Use review J's 30-item list and two-hard-section variant. Stabilize initial fonts/layout; record observed page distribution. At the review geometry it was items1–13,14–26,27–30. On a different supported environment, locate the first item on the second page by projection rather than relying on that exact distribution.

For each sequence, run native keyboard actions with no synthetic wait between consecutive user actions. Wait only for initial readiness and final assertions. Also test explicit delayed rendering/measurement and the fast first keystroke after a command. The review's 0/10/40ms delays were between characters, not a guaranteed delay between Enter and the first character.

| Test | Action | Required result |
| --- | --- | --- |
| Q1-01 | Caret after first item's label on page2; Enter→immediately type NEW | Exactly one new item; all original labels/order and NEW retained; canonical/ref/parent/server/reopened snapshot agree. |
| Q1-02 | Same sequence after Backspace, Delete, Bold, paste, field insertion and break removal | No overwritten canonical revision, lost later pages, duplicate operation or caret redirection. |
| Q1-03 | Select end of page1 through beginning of page2; Enter and Shift+Enter, forward/reverse selections | Selected content replaced with intended paragraph/line break; no no-op or untouched-edge loss. |
| Q1-04 | Manual break inside item on page2; Backspace from its new continuation; repeat Delete before break | One logical item/number retained; break removed first; no character removed from another page. |
| Q1-05 | Break across a selection spanning pages | Insert at logical selected position; never at the focus page's unrelated end. |
| Q1-06 | Long single item and nested list crossing soft and hard boundaries | No repeated marker, extra item, lost descendant, duplicate semantic ID or reset numbering. |
| Q1-07 | Tab/Shift+Tab and toolbar indent on selected items across pages | Same level change; selected items remain siblings in order; focus can leave the editor deliberately. |
| Q1-08 | Enter in centered/indented paragraph, end of heading, empty nested/top-level item | Contract inheritance/exit behavior; valid hierarchy; immediate typing safe. |
| Q1-09 | Remove break/delete blank page; deliberate section deletion if retained | One action per result; no silently deleted multi-page content; undo restores full state. |
| Q1-10 | Edit A, switch B, Undo, switch A, save/reload | No cross-document history/content/layout contamination; outgoing latest snapshot retained. |
| Q1-11 | `ol start=5`, alpha/bold/nested numbering through save/reopen/PDF | Correct durable numbering and all text exactly once; no soft metadata persisted. |
| Q1-12 | Repeat blank-page browser test using native pointer and keyboard activation | Stable add/delete behavior. Fix actual defect or demonstrated harness error; do not skip/relax the assertion. |

Run the critical deterministic fixture for at least20 consecutive native sequences per supported primary browser configuration, plus fault-delayed variants. This is a repeatability gate, not a statistical proof that all races are absent. A single unexplained content loss keeps G2 open. Preserve failure artifacts and exact sequence/revisions instead of rerunning until green.

## Q2: fields, persistence, output and staff acceptance

### Field and template contract

- [ ] Valid/simple/spaced/modifier/loop/partial syntax uses one grammar; split/dangling/unknown references are repairable diagnostics before invalid output is approved.
- [ ] Fields remain atomic in bold/headings/lists/tables/adjacency and around page boundaries. Chip labels/DOM attributes never leak into persisted expressions.
- [ ] Create label generates a complete key. Rename preserves identity; intentional key migration updates path/references/title-date/linkings. Delete-used explains scope; one undo restores definitions and content.
- [ ] Parent and two nested partials resolve distinct colliding keys correctly; declared linkings share intentionally. Missing/circular dependencies give actionable messages.
- [ ] Text containing ampersands/angle brackets stays literal; trusted rich fragments retain approved markup through the inventoried policy. False/zero/empty/missing/date/multiline values have consistent typed behavior and defaults.
- [ ] Legacy list/conditional/system/service definitions and unknown supported metadata survive no-change save through the API, not only local conversion.

### Persistence and preview

- [ ] Immediate Save captures latest edit; delayed success acknowledges only its revision; new edits remain dirty. Repeated Ctrl+S is serialized.
- [ ] Two clients from one server revision produce one success and one recoverable conflict. Test template, partial, generated draft and existing batch revision behavior.
- [ ] Every writer/status transition in W0's inventory participates. Wrong tenant/permission, deleted and locked status paths preserve current security/business rules.
- [ ] Draft autosave/reload/internal-navigation recovery retains the correct snapshot and base revision. Stale saves or cleanup cannot erase newer/other-user drafts.
- [ ] Current preview includes definitions/defaults/layout/composition; out-of-order results are ignored, diagnostics navigate to the right field and Retry preserves editing.
- [ ] Batch identity/layout, reviewed fingerprints, manual content and generation dependencies survive save/resume. Test a complete four-stage batch UI journey, which the review did not complete.

### Real output and failures

- [ ] Export actual PDF and HTML from generated snapshots; render PDF pages to images and inspect them. Assert every unique fixture sentinel once and in logical order with text extraction.
- [ ] Compare numbering, quotes, caption/footer rows, supported legacy images/sup/sub, margins, line/paragraph spacing, letterhead, page numbers and watermark. A superficial page count match does not pass.
- [ ] Font cold/warm cache and slow loading converge to the same final projection. Oversized rows/blocks remain present and have clear editing guidance.
- [ ] Force pagination throw, missing/stale bundle, font failure and export timeout. No clipped success; resource cleanup works; stored content remains recoverable.
- [ ] Local print removes only structural markers, retains content-bearing break-CSS elements, respects the shared output contract and handles cancellation.
- [ ] Confirm bundle freshness and frontend/API/export-worker versions/capabilities on the actual deployment candidate.

### Real user interactions

Capture real synthetic clipboard content from Word, Google Docs, Outlook/email, a website and plain text. Cover lists, headings, fonts/colors, links and tables; compare supported retained/normalized/discarded formatting and one-step undo. Label synthetic HTML-only tests separately.

Test keyboard, mouse drag, cut/copy/paste, select-all, arrows/Home/End, actual IME composition, emoji/grapheme deletion, screen reader, focus order and supported narrow desktop/tablet views. Observe representative staff completing review Journeys A–D without developer coaching. Record misunderstandings, repair actions and success; target at least4/5 for core everyday/list/keyboard/recovery/confidence areas. Do not relabel the review's heuristic score as user-study evidence.

## Repository checks and reproducible reporting

Use the exact focused baseline commands in review J plus the new packet suites. Run the appropriate integrated `npm run lint`, `npm run typecheck`, `npm run test:run`, `npm run test:browser` and `npm run build` under Node24. Environment-bound suites must use their configured test environment; record blocked checks explicitly. Run migrations and concurrency/integration suites on a disposable PostgreSQL database. Do not broaden/repeat unrelated checks once passing unless new changes or failures justify it.

Route smoke requires `A4_SMOKE_URL` and `A4_SMOKE_EXISTING_URL`; inspect the mutation behavior and use disposable authorized records. A missing smoke environment cannot be counted as a pass. Browser/source test failures must be differentiated from stale server processes, incorrect runtime, missing fonts or test-harness focus mistakes.

Use this evidence record for each gate:

```text
Gate and date:
Integration commit / contract version / app build:
Node/browser/device/font environment:
Database schema/revision and test-data scope:
Packets and A4E acceptance criteria covered:
Commands actually run with pass/fail counts:
Native sequences and observed semantic results:
PDF/HTML/visual evidence locations (synthetic content only):
Compatibility/capability/writer-reader versions:
Blocked or untested checks; exact limitation:
Defects requiring owner action:
Technical promotion decision and rollback minimum version:
```

## Deployment stages and promotion rules

### D0 — Expand readers and contain known damage

Candidate: W1 plus S1/F1 reader/policy exports and CORE's required reader adapters. Include only independently tested containment changes. A capability flag in code is not evidence that the platform supports safe per-tenant rollout; W0 must verify that.

1. Deploy additive GeneratedDocument revision schema before code requires it. Keep old columns/metadata/layout versions intact.
2. Deploy readers that understand old/new breaks/metadata and safe export failure behavior. Include API, editor/read-only view, preview, static pagination bundle, export workers and local-print adapters. Keep writer level at legacy/1 and field behavior unchanged.
3. Verify old clients/records still read correctly; verify unsupported future writes are rejected without deleting source content. Record the lowest application version that can read the new format.
4. Verify every active writer increments/checks revisions as designed before strict enforcement. Drain or update old background/service writers; an old worker that still writes unchecked can defeat the new client's concurrency contract.

**Rollback:** reader-only code may roll back while no new-format content exists and old behavior can read all stored data. Prefer reverting a feature/consumer change without removing the additive revision column. Do not drop a populated revision column during an application rollback.

### D1 — Cross-page editing and list correctness

Candidate: C1/C2/S1/S2 + W1/W2 boundary/snapshot/identity adapters, with G2/Q1 passed. This is the first release addressing the user's principal complaint.

1. Verify all reader instances/assets/workers are compatible; deploy the editor/command consumers and required snapshot adapters.
2. Enable v2 writers only for the validated deployment scope. Server validation enforces the writer capability, not merely a hidden button. An old tab must not strip and overwrite new-format content; missing revision/format capability receives a recoverable save rejection.
3. Test a full create/edit/save/reopen/generate/export synthetic list/break journey on the deployed candidate before expanding scope.
4. Observe meaningful integrity/error signals without document text: rejected stale writes, unsupported-format writes, projection/reconciliation failures and export errors. A single confirmed new content-loss event stops expansion and disables affected writers while preserving recovery snapshots.

**Known remainder:** D1 does not automatically close raw field/definition/escaping defects scheduled for D2. Treat it as a bounded pilot or an explicitly scoped release, not full programme completion. If cohort controls do not exist, use staging for the pilot and only make a complete gated deployment to the supported population.

**Rollback:** once nested v2 markers exist, the minimum rollback target is the compatible D0 reader build. Disable v2 writing first; do not downgrade records by stripping markers or restoring a pre-reader build. Already-created v2 content remains readable/exportable. G0 proof must include this read-after-disable case.

### D2 — Fields, current saves, drafts and complete workflow

Candidate: F2/F3 + W2/W3 integrations, G3 passed and the relevant CORE hooks stable.

1. Verify API schemas preserve new field IDs/metadata and all field/render consumers share parser/type/scoping rules.
2. Complete the rich-value compatibility inventory before activating escaped text semantics. Keep existing generated snapshots untouched; new generation follows the declared policy.
3. Enable protected field authoring/lifecycle and typed inputs as one coordinated frontend/service capability. Test partials and service/composition templates, not only standard templates.
4. Enable strict expectedRevision requirements after supported clients/workers use them. Missing old-client preconditions produce a clear recovery response; no silent last-write-wins fallback for supposedly protected routes.
5. Validate draft recovery, stale preview/save handling and all output paths on the deployed candidate.

**Rollback:** turn off new authoring features if necessary but retain parsers/readers for saved definitions/markers and revision-aware writes. Do not silently revert ordinary text escaping for new-policy templates into raw HTML interpolation. Roll back to a compatible renderer or disable affected new generation with a recoverable error until corrected. Retain migrations and stored snapshots.

### D3 — Usability, performance and full acceptance

Candidate: C3/S3 plus completed W3/F3 integration and G4/Q2. Ship only performance changes with measured benefit and equivalence tests. Retain compact familiar controls and accessibility; do not add a new visual system or unrequested features.

Before declaring complete, all reproduced content-loss and malformed cross-page defects are fixed, remaining source-confirmed P0 risks have targeted proof/remediation, real output and required browser/clipboard/IME/AT gates are recorded, and staff journeys show dependable operation. Any deferred P2/P3 is named with rationale. A missing required environment is an outstanding gate, not a documentation footnote that permits a false completion claim.

## Coordinator launch prompt

For manually started instances, use [the CORE and VERIFY prompts and manual coordination protocol](manual-instance-prompts.md). The user starts/resumes each instance; shared files carry assignments and evidence. In a shared checkout, production edits stop during independent verification of the recorded candidate.

> Start the A4Editor implementation programme from README and contracts v1. Use at most four concurrent agents including yourself: CORE/integrator, SEMANTICS, FIELDS and WORKFLOW. Dispatch only C0/S0/F0/W0 first, each with an isolated worktree or explicit file lease. Establish current baseline, failing reproductions and G0 contracts before Wave1. Keep new writers/field behavior disabled until reader compatibility gates pass. Integrate producers before consumers and use a freed slot for independent Q1/Q2 verification. Do not deploy as part of a planning or local implementation gate; prepare a concrete release candidate and evidence for the separately authorized deployment scope.

## Independent verifier prompt

> Verify gate **G2/Q1** (or explicitly assigned G3/G4) against the integrator's recorded commit and contracts version. Read this plan and the matching review tickets. Reproduce with native input without inter-action layout waits, assert canonical/server/reopened content and real PDF where required, and report actual checks/failures/untested targets. Do not edit production files or weaken failing assertions. Return defects to their owners and provide a technical promotion decision with compatibility/rollback limits.
