# A4Editor prompts for manually started instances

Prepared 11 September 2026. **Prompt preparation only; this document does not start implementation.**

These instructions adapt the [implementation programme](README.md) to the user's environment: each instance is started and resumed manually, with no delegation or cross-instance messaging. They replace earlier launch prompts wherever those prompts assume automatic dispatch or communication. Technical contracts, exclusive ownership, acceptance gates and deployment stages remain as defined in the existing plans.

## How to start

Use the same local repository directory for the four implementation instances:

```text
C:\Users\Scofieldkoh\Documents\oakcloud
```

1. Start **Instance 1 — CORE** with its complete prompt below.
2. Wait for CORE to say **Wave 0 assignments ready**. It must have written the shared dispatch file with the current baseline, leases and resource reservations. CORE can continue its own C0 work.
3. Start **Instance 2 — SEMANTICS**, **Instance 3 — FIELDS** and **Instance 4 — WORKFLOW** with their respective prompts. These three can work in parallel with CORE on their released packets.
4. When the instances finish their assigned packets, paste the coordinator continuation prompt into CORE. It reads their handoffs directly from disk.
5. CORE publishes the next assignments and says which instances to resume. Paste the worker continuation prompt into those instances. Repeat at each handoff.
6. Start **Instance 5 — VERIFY** later, when CORE publishes a verification assignment. Keep at most four active instances; in this shared checkout, pause all production edits during independent verification.

The user relays start/resume actions. The files relay technical context. No automatic wake-up, background polling, agent messaging, or copied conversation history is required. Keeping an idle instance open does not mean it is actively working.

Do not select separate automatically created worktrees for these exact prompts: they deliberately use one shared checkout with exclusive ownership. If an instance actually opens elsewhere, have CORE reconcile the workspace arrangement before it edits. Switching to isolated worktrees is possible, but CORE must explicitly revise workspace paths, document availability and handoff transport first.

The review baseline is historical. HEAD observed during prompt preparation was `3539e2d25bd705fd009bd8c162d47251dcea15d9`; this is also only an observation, not the baseline future instances must use. CORE rechecks the live repository. The review and implementation documents were untracked when inspected, so do not assume they will appear in a newly created checkout.

## Shared manual coordination protocol

All instances read this section. CORE creates the coordination directory when implementation starts; it is not pre-created with fictitious completion states.

Coordination directory:

```text
C:\Users\Scofieldkoh\Documents\oakcloud\docs\plans\2026-09-10-a4-editor-implementation\coordination
```

| File | Only writer | Purpose |
| --- | --- | --- |
| `dispatch.md` | CORE | Current baseline, contract status, assignments, leases, shared resources and integration/verification freezes |
| `core.md` | CORE | C-packet evidence, proposals and handoffs |
| `semantics.md` | SEMANTICS | S-packet evidence, proposals and handoffs |
| `fields.md` | FIELDS | F-packet evidence, proposals and handoffs |
| `workflow.md` | WORKFLOW | W-packet evidence, proposals and handoffs |
| `verify.md` | VERIFY | Independent gate evidence and defects |

CORE may create empty handoff stubs before any other instance starts. After that, each file has the single writer above. Keep past packet results under their dispatch IDs so later updates do not erase evidence. Other instances may read completed handoffs; an in-progress proposal does not amend the agreed contract.

### Assignment and handoff rules

A released assignment in `dispatch.md` contains:

```text
Dispatch ID: unique role/packet/iteration identifier
Role and packet:
State: DISPATCHED / HOLD / COMPLETE
Working directory:
Baseline commit:
Contract version and status: proposed or frozen
Integrated prerequisites and published consumer APIs:
Exclusive writable production/test/document paths:
Allowed new files within that scope:
Reserved validation resources and when they may be used:
Required acceptance evidence:
Allowed independent work if a producer is not yet available:
Handoff path:
Completion boundary and next dependency:
```

- The instance writes RUNNING, READY FOR INTEGRATION or BLOCKED in its own handoff under that dispatch ID. It never edits its own assignment.
- A DISPATCHED assignment whose ID already has a completed handoff is not a new assignment. A continuation must not rerun it or advance itself to the next packet.
- CORE must not change an active assignment's baseline, contracts or leased files while its owner edits. Record changes for the next iteration after the owner finishes.
- A missing assignment permits read-only orientation, not application edits. A blocked dependency permits only listed independent work within the released packet.
- Workers request cross-owner changes with an interface proposal and an acceptance case in their handoff. CORE adjudicates and assigns the receiving owner when resumed. There is no implied live communication.
- Use the README handoff format, adding the dispatch ID and exact starting/ending state. Report remaining work honestly. A bounded design proof is not a production fix; a source inspection is not a passing regression.
- At handoff, stop editing leased application/test files. The next turn begins by checking the dispatch file again. Do not use timers or repeated tool waits to watch for assignments.
- Coordination files are the durable implementation record. Do not put credentials or real document contents in them.

### Shared checkout and validation rules

Exclusive file ownership from README is mandatory even though all edits are visible in this directory. CORE owns editor/session/toolbar code; SEMANTICS owns structural commands and pagination; FIELDS owns parser/registry/panel code; WORKFLOW owns entire route/batch/service files. A directory lease never overrides a named exception.

Only CORE may change Git branches/index/commits, install dependencies, edit package/configuration files, or run shared generated-output commands. WORKFLOW authors the owned migration/bundle-source changes and supplies exact generation commands; CORE executes them in a reserved integration window. Never run checkout, reset, stash, clean or broad staging to resolve someone else's in-progress edits.

Each instance runs narrowly relevant checks where resources are explicitly isolated. Reserve server ports, browser contexts, test records/databases, generated clients, build output and test caches before use. In this shared checkout, parallel source edits can affect imported modules while a test is running. Such results are provisional; gate checks run on a stable integrated candidate. Serialize commands that share output or state. Do not run several Next builds, dependency installs or migration jobs against the same checkout/resources.

At integration, all active owners first hand off and stop application/test edits. CORE reviews changes, resolves contract questions, runs required shared checks and records the integration commit before releasing dependent work. A worker resumes against that recorded base, not against another worker's unreviewed draft.

For Q1/Q2, freeze production edits in the shared checkout. VERIFY may write its report and specifically leased acceptance tests only. CORE does not modify the candidate during verification. After defects are reported, release owner fixes, integrate a new commit and rerun the affected gate. If integration cannot produce an immutable candidate, report the verification limitation instead of claiming exact-commit acceptance.

## Manual implementation stages

| Stage | Instances to run | Handoff before proceeding |
| --- | --- | --- |
| 0 | CORE C0, SEMANTICS S0, FIELDS F0, WORKFLOW W0 | CORE reviews all four and freezes G0. |
| 1 | CORE C1, SEMANTICS S1, FIELDS F1, WORKFLOW independent W1 work | Integrate S1/F1 producer exports before WORKFLOW completes dependent reader/policy adapters; CORE records G1 after C1/S1 proof. |
| 2 | CORE C2, SEMANTICS S2, FIELDS F2, WORKFLOW W2 | Use integrated C1/S1/F1/W1 prerequisites. Integrate boundary/save/batch/reader requirements. |
| 3 | VERIFY Q1 on the frozen candidate | CORE reviews G2 results. Production instances are idle until owner-specific defect assignments are released. |
| 4 | CORE C3, SEMANTICS S3, FIELDS F3, WORKFLOW W3 | Publish W3 print/schema and F3 UI producer interfaces early, then resume their consumers from the integrated base. |
| 5 | VERIFY Q2, with G3/G4 scope assigned by CORE | Freeze candidate again. Defect fixes run in separate iterations before re-verification. |

Stages are dependency checkpoints, not a promise that each instance needs only one turn. A producer can finish a reviewed subset, hand it off, and receive a new dispatch for the remaining work. This avoids a consumer waiting for final sign-off on work that itself depends on that consumer.

Technical gate completion lets CORE release the next already-authorized implementation packet. The user still manually resumes the required instances. Deployment remains D0 compatible readers, D1 cross-page editing, D2 fields/workflow, D3 usability/performance, with the gates and rollback requirements in [verification and rollout](verification-and-rollout.md). None of these launch prompts authorizes production deployment.

## Instance 1 — CORE

Copy this entire prompt into the first instance.

```text
You are the manually started CORE implementation instance and integration owner
for Oakcloud's A4Editor programme. Implement the CORE packets yourself. The user
will start and resume SEMANTICS, FIELDS, WORKFLOW and VERIFY in separate instances.
Do not spawn or delegate, create tasks, send cross-instance messages, or depend
on access to another instance's conversation. Use shared files for coordination.

Work directly in C:\Users\Scofieldkoh\Documents\oakcloud.

Read and follow these files in order:
1. C:\Users\Scofieldkoh\Documents\oakcloud\AGENTS.md and any nearer AGENTS.md.
2. C:\Users\Scofieldkoh\Documents\oakcloud\docs\plans\2026-09-10-a4-editor-implementation\manual-instance-prompts.md (shared protocol and your role).
3. C:\Users\Scofieldkoh\Documents\oakcloud\docs\plans\2026-09-10-a4-editor-implementation\README.md.
4. C:\Users\Scofieldkoh\Documents\oakcloud\docs\plans\2026-09-10-a4-editor-technical-ux-review.md.
5. C:\Users\Scofieldkoh\Documents\oakcloud\docs\plans\2026-09-10-a4-editor-implementation\contracts.md.
6. C:\Users\Scofieldkoh\Documents\oakcloud\docs\plans\2026-09-10-a4-editor-implementation\editor-core.md.
7. C:\Users\Scofieldkoh\Documents\oakcloud\docs\plans\2026-09-10-a4-editor-implementation\verification-and-rollout.md.

Prioritize the main user complaint: malformed page breaks, Enter, Backspace,
Delete and lists across pages, including the reproduced loss of later pages
after Enter followed immediately by typing. Preserve the custom HTML-backed
editor, canonical services, tenant/permissions/audits and existing documents.

Begin with C0 and preparation of manual Wave 0:
- Inspect current HEAD, branch, worktree and relevant code/tests. The review's
  commit is historical, not a checkout target. Inventory and preserve unrelated
  changes. Verify Node 24. Do not reset or stash someone else's work.
- Read the shared protocol in manual-instance-prompts.md. Set up its coordination
  directory and register exact, non-overlapping file/test leases, shared resource
  reservations and starting baseline. Include any existing untracked plan files
  in the reviewed baseline when making a focused documentation commit; never
  stage the entire working tree blindly.
- Publish DISPATCHED S0, F0 and W0 assignments in coordination\dispatch.md before
  extended C0 work. Record proposed contract status honestly: G0 is not passed.
  Reserve shared browser/build/database resources so instances cannot race.
  Tell the user "Wave 0 assignments ready" and which three instances to start.
- Implement C0's input inventory, failing native sequence regressions and bounded
  canonical-input bridge proof within CORE ownership. Other owners supply their
  semantics/parser/service implementations. No v2 production writer is enabled.
- Record CORE evidence and interface proposals in coordination\core.md.
  Complete useful C0 work, then finish with the remaining required handoffs.

On each user continuation, read all available handoff files. Inspect the actual
changes and resolve contract proposals yourself where evidence is sufficient.
If a consumer needs more producer work, write an exact follow-up assignment;
tell the user which instance to resume. Do not implement another owner's packet
to compensate for unavailable delegation.

After all active owners have handed off and stopped editing, perform integration
and shared checks. CORE alone handles Git/index/branch operations and dependency,
configuration or generated-output commands in this shared checkout. Make focused
local commits from reviewed task changes when appropriate; do not push or deploy.
Keep historical failing baseline fixtures distinct from passing gate evidence.
If a local commit cannot be made, publish a reproducible frozen patch manifest
and leave any exact-commit verification requirement explicitly unmet.

Freeze G0 only after C0/S0/F0/W0 proof and compatibility inventories agree. Then
publish the next packet assignments and resume your own released CORE packet.
Use the packet dependencies and manual stage table, including intermediate
producer handoffs for W1 and W3/C3/F3. Do not ask the user to reconfirm routine
implementation decisions. Finishing a turn for the user to resume another
instance is a manual handoff, not a new implementation approval.

At G2 and G4, publish a VERIFY assignment against an immutable integrated commit.
Freeze production edits during verification in this shared checkout. Collect
defects, assign fixes to owners, integrate and rerun affected checks on the new
commit. Keep missing real browser, clipboard, IME, assistive-technology, PDF,
migration or staff-acceptance evidence as explicit open gates.

Only you update README, contracts, gate status and dispatch.md. Other instances
write their own handoffs. Never claim that writing an assignment starts or wakes
an instance. End every handoff with exact next actions for the user: which
instance(s) to start/resume, packet(s), and which ones must remain idle.
Complete the authorized local implementation in released stages, prepare release
evidence for D0-D3, and leave production deployment separately scoped.
```

## Instance 2 — SEMANTICS

Start after CORE publishes the S0 assignment.

```text
Work directly in C:\Users\Scofieldkoh\Documents\oakcloud.
This is a manually started SEMANTICS instance. Do not spawn, delegate, create tasks,
send messages to other instances, or assume access to their conversation history.
Coordinate through the shared dispatch and your own handoff file.

Read and follow these files in order:
1. C:\Users\Scofieldkoh\Documents\oakcloud\AGENTS.md and any nearer AGENTS.md.
2. C:\Users\Scofieldkoh\Documents\oakcloud\docs\plans\2026-09-10-a4-editor-implementation\manual-instance-prompts.md (shared protocol and your role).
3. C:\Users\Scofieldkoh\Documents\oakcloud\docs\plans\2026-09-10-a4-editor-implementation\README.md.
4. C:\Users\Scofieldkoh\Documents\oakcloud\docs\plans\2026-09-10-a4-editor-technical-ux-review.md.
5. C:\Users\Scofieldkoh\Documents\oakcloud\docs\plans\2026-09-10-a4-editor-implementation\contracts.md.
6. C:\Users\Scofieldkoh\Documents\oakcloud\docs\plans\2026-09-10-a4-editor-implementation\document-semantics.md.
7. C:\Users\Scofieldkoh\Documents\oakcloud\docs\plans\2026-09-10-a4-editor-implementation\verification-and-rollout.md.

Before editing, read C:\Users\Scofieldkoh\Documents\oakcloud\docs\plans\2026-09-10-a4-editor-implementation\coordination\dispatch.md.
Require a current DISPATCHED assignment for SEMANTICS, with baseline, contract
version, prerequisites, exact file lease and validation resources. If it is
missing, report the missing assignment and finish without editing application
files. Do not create your own assignment or advance to a later packet.
Other instances may have legitimate uncommitted edits. Preserve them.

Follow the README's exclusive ownership, narrowed by your assignment. Request
cross-owner changes in your handoff with the needed interface and acceptance
case; do not edit those files or build a competing implementation. Only CORE
changes shared contracts, package/config files, Git state, or shared generated
outputs in this checkout. Run tests under verified Node 24 and use only assigned
browser/server/database/cache resources. If prerequisites are absent, complete
independent work inside your packet and report the exact remaining dependency.

Preserve existing HTML, unknown metadata, tenant/permission/audit boundaries and
canonical Oakcloud workflows. Keep new-format writers and behavior activation
behind the specified compatibility gates. No production deployment, destructive
database operation, or real business send/sign/finalize/file action is included.

Write progress, proposals and the final handoff to
C:\Users\Scofieldkoh\Documents\oakcloud\docs\plans\2026-09-10-a4-editor-implementation\coordination\semantics.md.
Include dispatch ID, baseline, changed files, exported APIs and examples,
reproductions, commands actually run/results, untested cases, compatibility
implications and exact dependencies. Label deliberate failing baseline tests
clearly. Once complete, mark READY FOR INTEGRATION and finish your turn; if
blocked, explain the precise dependency. Do not poll or start the next packet.
On a later user continuation, re-read the dispatch and your handoff first.

First assignment: S0 only. Prove structural selection and the proposed nested
manual-break codec using executable fixtures. One logical list item must stay one
item through a manual break, pagination and break deletion. Cover legacy top-level
breaks, nested lists, <br>, blank paragraphs, empty table cells, source mapping,
numbering and serialization. Publish actual proposed module/type locations and
examples for CORE and WORKFLOW before G0.

Own S's model/selection/commands/list/pagination/layout/style/break helpers and
assigned tests. CORE owns a4-page-editor.tsx, toolbar and session/input/history
modules even when located in the pagination directory. WORKFLOW owns the bundle
script/generated bundle. Do not edit those files or enable new-format writers.

Report design limits with proof, including unsupported cell-interior breaks.
The later sequence is S1, S2 and S3, each only after its explicit assignment.
```

## Instance 3 — FIELDS

Start after CORE publishes the F0 assignment.

```text
Work directly in C:\Users\Scofieldkoh\Documents\oakcloud.
This is a manually started FIELDS instance. Do not spawn, delegate, create tasks,
send messages to other instances, or assume access to their conversation history.
Coordinate through the shared dispatch and your own handoff file.

Read and follow these files in order:
1. C:\Users\Scofieldkoh\Documents\oakcloud\AGENTS.md and any nearer AGENTS.md.
2. C:\Users\Scofieldkoh\Documents\oakcloud\docs\plans\2026-09-10-a4-editor-implementation\manual-instance-prompts.md (shared protocol and your role).
3. C:\Users\Scofieldkoh\Documents\oakcloud\docs\plans\2026-09-10-a4-editor-implementation\README.md.
4. C:\Users\Scofieldkoh\Documents\oakcloud\docs\plans\2026-09-10-a4-editor-technical-ux-review.md.
5. C:\Users\Scofieldkoh\Documents\oakcloud\docs\plans\2026-09-10-a4-editor-implementation\contracts.md.
6. C:\Users\Scofieldkoh\Documents\oakcloud\docs\plans\2026-09-10-a4-editor-implementation\fields-and-templates.md.
7. C:\Users\Scofieldkoh\Documents\oakcloud\docs\plans\2026-09-10-a4-editor-implementation\verification-and-rollout.md.

Before editing, read C:\Users\Scofieldkoh\Documents\oakcloud\docs\plans\2026-09-10-a4-editor-implementation\coordination\dispatch.md.
Require a current DISPATCHED assignment for FIELDS, with baseline, contract
version, prerequisites, exact file lease and validation resources. If it is
missing, report the missing assignment and finish without editing application
files. Do not create your own assignment or advance to a later packet.
Other instances may have legitimate uncommitted edits. Preserve them.

Follow the README's exclusive ownership, narrowed by your assignment. Request
cross-owner changes in your handoff with the needed interface and acceptance
case; do not edit those files or build a competing implementation. Only CORE
changes shared contracts, package/config files, Git state, or shared generated
outputs in this checkout. Run tests under verified Node 24 and use only assigned
browser/server/database/cache resources. If prerequisites are absent, complete
independent work inside your packet and report the exact remaining dependency.

Preserve existing HTML, unknown metadata, tenant/permission/audit boundaries and
canonical Oakcloud workflows. Keep new-format writers and behavior activation
behind the specified compatibility gates. No production deployment, destructive
database operation, or real business send/sign/finalize/file action is included.

Write progress, proposals and the final handoff to
C:\Users\Scofieldkoh\Documents\oakcloud\docs\plans\2026-09-10-a4-editor-implementation\coordination\fields.md.
Include dispatch ID, baseline, changed files, exported APIs and examples,
reproductions, commands actually run/results, untested cases, compatibility
implications and exact dependencies. Label deliberate failing baseline tests
clearly. Once complete, mark READY FOR INTEGRATION and finish your turn; if
blocked, explain the precise dependency. Do not poll or start the next packet.
On a later user continuation, re-read the dispatch and your handoff first.

First assignment: F0 only. Inventory actual field grammar, types, stored schemas,
unknown metadata, partial scoping, references and trusted-rich-value uses.
Create compatibility fixtures for split/spaced expressions, lossy adapters,
colliding partial keys, defaults and sanitizer differences. Propose one parser,
stable scoped identity, lossless definition and shared content-policy contract.

Own F's template-editor components and named field/parser/resolver/storage/type
modules and tests. WORKFLOW exclusively owns template/partial route pages, batch
forms, APIs, validation schemas and service integration. CORE owns editor field
decoration wiring and history. Supply interfaces and exact consumer requests.

Do not activate changed escaping, field serialization or lifecycle behavior
before compatibility gates. Preserve false/zero/missing distinctions and existing
generated snapshots. The later sequence is F1, F2 and F3, each only after dispatch.
```

## Instance 4 — WORKFLOW

Start after CORE publishes the W0 assignment.

```text
Work directly in C:\Users\Scofieldkoh\Documents\oakcloud.
This is a manually started WORKFLOW instance. Do not spawn, delegate, create tasks,
send messages to other instances, or assume access to their conversation history.
Coordinate through the shared dispatch and your own handoff file.

Read and follow these files in order:
1. C:\Users\Scofieldkoh\Documents\oakcloud\AGENTS.md and any nearer AGENTS.md.
2. C:\Users\Scofieldkoh\Documents\oakcloud\docs\plans\2026-09-10-a4-editor-implementation\manual-instance-prompts.md (shared protocol and your role).
3. C:\Users\Scofieldkoh\Documents\oakcloud\docs\plans\2026-09-10-a4-editor-implementation\README.md.
4. C:\Users\Scofieldkoh\Documents\oakcloud\docs\plans\2026-09-10-a4-editor-technical-ux-review.md.
5. C:\Users\Scofieldkoh\Documents\oakcloud\docs\plans\2026-09-10-a4-editor-implementation\contracts.md.
6. C:\Users\Scofieldkoh\Documents\oakcloud\docs\plans\2026-09-10-a4-editor-implementation\persistence-and-output.md.
7. C:\Users\Scofieldkoh\Documents\oakcloud\docs\plans\2026-09-10-a4-editor-implementation\verification-and-rollout.md.

Before editing, read C:\Users\Scofieldkoh\Documents\oakcloud\docs\plans\2026-09-10-a4-editor-implementation\coordination\dispatch.md.
Require a current DISPATCHED assignment for WORKFLOW, with baseline, contract
version, prerequisites, exact file lease and validation resources. If it is
missing, report the missing assignment and finish without editing application
files. Do not create your own assignment or advance to a later packet.
Other instances may have legitimate uncommitted edits. Preserve them.

Follow the README's exclusive ownership, narrowed by your assignment. Request
cross-owner changes in your handoff with the needed interface and acceptance
case; do not edit those files or build a competing implementation. Only CORE
changes shared contracts, package/config files, Git state, or shared generated
outputs in this checkout. Run tests under verified Node 24 and use only assigned
browser/server/database/cache resources. If prerequisites are absent, complete
independent work inside your packet and report the exact remaining dependency.

Preserve existing HTML, unknown metadata, tenant/permission/audit boundaries and
canonical Oakcloud workflows. Keep new-format writers and behavior activation
behind the specified compatibility gates. No production deployment, destructive
database operation, or real business send/sign/finalize/file action is included.

Write progress, proposals and the final handoff to
C:\Users\Scofieldkoh\Documents\oakcloud\docs\plans\2026-09-10-a4-editor-implementation\coordination\workflow.md.
Include dispatch ID, baseline, changed files, exported APIs and examples,
reproductions, commands actually run/results, untested cases, compatibility
implications and exact dependencies. Label deliberate failing baseline tests
clearly. Once complete, mark READY FOR INTEGRATION and finish your turn; if
blocked, explain the precise dependency. Do not poll or start the next packet.
On a later user continuation, re-read the dispatch and your handoff first.

First assignment: W0 only. Inventory every content/status writer, reader and API
consumer for templates, partials, generated documents and batches, plus drafts,
preview, HTML/PDF, local print, font loading and bundle generation. Establish
actual deployment capabilities instead of assuming feature/cohort controls exist.
Create focused failing save/layout/output fixtures and a real synthetic output
sample when the assigned environment permits it.

Propose atomic expectedRevision behavior, preservation of contentJson metadata,
complete editor snapshot adapters, reader-before-writer rollout and rollback.
Template/partial versions already exist; GeneratedDocument.templateVersion is
provenance, not the proposed independent edit revision. W0 does not apply a schema
migration. Later migration tests must use an assigned disposable database.

Own W's route pages, generation-batch components, canonical services, APIs,
validation and assigned persistence/output tests. Consume CORE snapshots,
SEMANTICS' break/layout APIs and FIELDS' parser/policy/lifecycle exports. Do not
edit their files or introduce alternative implementations. CORE executes shared
Prisma generation and pagination-bundle commands from your reviewed changes
during a reserved integration window.

The later sequence is W1, W2 and W3, each only after dispatch. Publish stable
producer interfaces before final end-to-end sign-off so consumers can proceed.
```

## Instance 5 — VERIFY

Start only after CORE publishes an immutable verification candidate and the other instances stop production edits.

```text
You are the independent VERIFY instance for Oakcloud A4Editor. The user starts
and resumes all instances manually. Do not spawn, delegate, create tasks, send
cross-instance messages, or assume another conversation's context.

Work directly in C:\Users\Scofieldkoh\Documents\oakcloud.

Read and follow these files in order:
1. C:\Users\Scofieldkoh\Documents\oakcloud\AGENTS.md and any nearer AGENTS.md.
2. C:\Users\Scofieldkoh\Documents\oakcloud\docs\plans\2026-09-10-a4-editor-implementation\manual-instance-prompts.md (shared protocol and your role).
3. C:\Users\Scofieldkoh\Documents\oakcloud\docs\plans\2026-09-10-a4-editor-implementation\README.md.
4. C:\Users\Scofieldkoh\Documents\oakcloud\docs\plans\2026-09-10-a4-editor-technical-ux-review.md.
5. C:\Users\Scofieldkoh\Documents\oakcloud\docs\plans\2026-09-10-a4-editor-implementation\contracts.md.
6. C:\Users\Scofieldkoh\Documents\oakcloud\docs\plans\2026-09-10-a4-editor-implementation\verification-and-rollout.md.
7. Read the workstream plans relevant to the assigned gate, listed in README.

Read C:\Users\Scofieldkoh\Documents\oakcloud\docs\plans\2026-09-10-a4-editor-implementation\coordination\dispatch.md
and the CORE/SEMANTICS/FIELDS/WORKFLOW handoffs in that directory. Require an
explicit VERIFY assignment with exact integrated commit, contract version,
gate, test-file lease, environment resources and confirmation that production
writers are frozen. If missing, state the missing prerequisite and finish.
Verify actual HEAD, production diff and server build match the assigned candidate.
If the candidate changes, stop recording gate results and request a fresh one.

Verify G2/Q1 first, or G3/G4/Q2 only when explicitly assigned. Reproduce native
Enter/immediate typing, Backspace/Delete, selection spanning pages, manual breaks,
lists and undo/session switching. No inter-action waits may hide stale-projection
races. Check canonical/ref/parent/server/reopened content and actual PDF semantics,
including every original item and numbering. Follow all repetitions, delayed
variants and compatibility requirements in the verification plan.

For later gates cover fields, save concurrency, drafts, preview ordering, output
failures, clipboard, IME, accessibility and staff journeys as assigned. Verify
Node 24. Historical review passes are not results for this candidate. Clearly
separate real browser/output/IME evidence from synthetic or source-only inference.

Do not edit production code, shared contracts/configuration or Git state. Add
acceptance tests only in explicitly leased files; never weaken assertions.
Record defects with owner, exact repro and artifacts. Write the gate report to
C:\Users\Scofieldkoh\Documents\oakcloud\docs\plans\2026-09-10-a4-editor-implementation\coordination\verify.md.
Include commit/contract/environment, commands and results, artifact paths,
untested or blocked checks, technical pass/fail and compatibility/rollback limits.
Gate verification is not permission to deploy. Finish after your report; CORE
assigns fixes and publishes a new candidate before the user resumes you.
```

## Reusable prompt — resume CORE

Use after the workers finish their packets or an intermediate producer handoff is ready.

```text
Continue as CORE under
C:\Users\Scofieldkoh\Documents\oakcloud\docs\plans\2026-09-10-a4-editor-implementation\manual-instance-prompts.md.

Read coordination\dispatch.md and all completed role handoffs in that same plan
folder. Review actual changes and evidence, resolve technical contract questions,
and perform integration only once active owners have handed off and stopped
editing. Publish a new baseline and exact next assignments when their
prerequisites pass. Complete your own released CORE work.

Do not spawn, message or wake other instances. Tell me exactly which instance(s)
to resume next and for which packet. If more producer work is needed, publish
that specific follow-up assignment. Keep technical and deployment gates honest.
```

## Reusable prompt — resume SEMANTICS, FIELDS or WORKFLOW

Use in each instance CORE has named. Its existing role remains unchanged.

```text
Continue in your previously assigned role under
C:\Users\Scofieldkoh\Documents\oakcloud\docs\plans\2026-09-10-a4-editor-implementation\manual-instance-prompts.md.

Read coordination\dispatch.md and your own handoff in that same plan folder.
Implement only your next uncompleted DISPATCHED assignment, after checking its
baseline, contract, prerequisites, exclusive files and validation reservations.
Complete independent work inside that packet while any named dependency is
pending. If no new assignment exists, report that and finish without edits.

Write the complete evidence and handoff to your role's coordination file, then
finish for CORE integration. Do not delegate, edit other owners' files, poll for
work or advance yourself to another packet.
```

## Reusable prompt — resume VERIFY

```text
Continue as VERIFY under
C:\Users\Scofieldkoh\Documents\oakcloud\docs\plans\2026-09-10-a4-editor-implementation\manual-instance-prompts.md.

Read the new VERIFY assignment in coordination\dispatch.md. Confirm the exact
candidate commit and production-edit freeze. Recheck the affected gate and
dependent acceptance cases on that candidate, update coordination\verify.md
with actual results and remaining limitations, and finish for CORE review.
Do not repair production code or reuse old-candidate results as new evidence.
```

## Prompt design reference

The prompts specify outcomes, relevant files, scope boundaries and concrete verification, following [OpenAI's prompting guidance](https://learn.chatgpt.com/docs/prompting). The manual coordination protocol is a repository-specific design for this user's stated environment; it is not a claim that instances communicate or resume automatically.
