# Business Assistant P16 implementation and validation handover

Date: 2026-09-10
Branch: `feat/p16-integrated-validation-20260910`
Baseline: reconciled `main` after PR #25
Status: implementation tooling complete through review cycle 18; production gates remain disabled

## Purpose

P16 is the final integrated validation/evidence phase described by `2026-09-05-business-assistant-implementation.md` and the P16 reconciliation addendum. This change makes P16 release evidence deterministic, reviewable, SHA-bound, tamper-evident, and fail-closed. It does not claim that repository CI can prove real provider, object-storage, backup/restore, staging-topology, or operator evidence.

No production Business Assistant, provider, mutation, learning-promotion, deployment, credential, or secret gate is enabled by this branch.

## Implementation summary

### Immutable P16 evidence contract

`scripts/lib/business-assistant-p16-evidence.mjs` defines the release-evidence contract. A manifest is bound to one exact staged Git commit SHA and one staging run. It starts with every required gate `NOT_RUN` and all rollout safety assertions false.

A gate can be recorded only as `PASS`, `FAIL`, or `BLOCKED`. PASS and FAIL require an immutable evidence reference containing an approved source class, durable URI, SHA-256, and observation timestamp. A staging-only gate cannot be satisfied by CI evidence. BLOCKED requires an explanatory note.

Readiness is fail-closed. The manifest is eligible only for **separate production-gate review** when every required gate is PASS, all safety assertions are true, the manifest has a completion timestamp, and the integrity checksum is valid. This signal never changes a deployment flag.

### Tamper-evident sealing

Evidence is canonicalized before SHA-256 calculation. The integrity envelope is excluded from its own checksum; every other manifest field is covered. Once sealed, the evidence API refuses subsequent mutation. Any post-seal payload edit invalidates the checksum.

The library and CLI both refuse to seal a manifest unless every P16 gate is PASS and all safety assertions are true. This prevents a direct library caller from bypassing CLI readiness rules and avoids turning an incomplete manifest into an immutable dead end.

### Typed module contract

`scripts/lib/business-assistant-p16-evidence.d.mts` supplies the TypeScript contract for the JavaScript evidence implementation. It deliberately types run identifiers as general strings and evidence collections as `P16EvidenceRef[]`, avoiding TypeScript's over-narrow inference from `randomUUID()` defaults and empty array literals while preserving the runtime validation rules in the implementation.

### Operator CLI

`scripts/business-assistant-p16-evidence.mjs` supports:

- `init` — start a manifest for an exact app SHA;
- `record` — record PASS/FAIL/BLOCKED with immutable evidence references;
- `safety` — record explicit rollout safety assertions;
- `status` — validate structure, SHA binding, gate status, safety and integrity;
- `seal` — complete and checksum the manifest only after all readiness prerequisites are satisfied;
- `checks` — print the authoritative top-level gate inventory.

Writes use an atomic temporary-file/rename sequence and create evidence files with owner-only permissions where supported.

### P16 evidence tests

`__tests__/scripts/business-assistant-p16-evidence.test.ts` covers:

- fail-closed initial state;
- mandatory evidence for PASS;
- staging-vs-CI source restrictions;
- mandatory blocker notes;
- rejection of incomplete sealing;
- rejection of sealing while any safety assertion is false;
- incomplete/unsealed non-readiness;
- all-gates-plus-safety-plus-seal readiness;
- checksum tamper detection;
- exact application-SHA binding;
- sealed-manifest immutability;
- deterministic checksum behavior across object key ordering.

`npm run test:p16:evidence` exposes the suite and Node 24 CI executes it.

### Production-gate diff guard

`scripts/check-business-assistant-p16-production-gates.mjs` inspects the PR three-dot diff. It fails if P16 changes protected deployment/configuration paths such as environment, compose, deployment, infrastructure, Kubernetes, or Helm surfaces. It also fails on executable-code additions that appear to set known Business Assistant production gates to enabled values.

The Node 24 workflow checks out full history and passes the exact pull-request base/head SHAs to the guard. The guard is scoped to `feat/p16-*` pull requests so it cannot accidentally block unrelated future deployment/configuration PRs. Documentation/tests and the guard's own pattern definitions are excluded from assignment scanning so explanatory text cannot create false positives.

### Integrated staging runbook

`docs/operations/business-assistant-p16-validation.md` maps the grouped evidence gates to the complete P16 scenario set. In particular, the retained-source correction gate requires preparation, fresh confirmation, canonical mutation, effects, read-back, independent review, historical preservation, rollback/NO_COMMIT, committed reconciliation, worker restart, source drift, concurrent baseline changes, and prefetch/revalidation races before PASS is allowed.

The workload gate similarly requires 1–10 item ordering, fairness, isolation, partial outcomes, per-item failure, retries, cancellation, expiry, authorization revocation, bounded provider/resource/retry budgets, explicit exhaustion, no context leakage, no starvation, and no duplicate canonical mutation.

Stopped or incomplete P16 runs remain unsealed; their manifests and referenced evidence are archived under external immutable storage/versioning controls. Sealing is reserved for a fully passing readiness record.

## Repository evidence versus staging evidence

Repository CI is authoritative for code-level checks on the candidate SHA, including registry freshness, Prisma generation, lint, typecheck, focused contracts, P16 evidence tests, build, PostgreSQL integration coverage, production-image build, Node 24 runtime, and Chromium validation.

Repository CI is **not** accepted as a substitute for:

- real authentication/RLS through the staging application boundary;
- real full-state evidence production with held-out documents;
- configured staging object-storage permissions/network behavior;
- real provider latency, throttling, error and authorization behavior;
- LISTEN/NOTIFY failure/recovery behavior in the staging topology;
- correction lock/resource metrics under representative load;
- backup destination/restore timings;
- retention, purge and legal-hold staging drills;
- operator cutover, kill-switch and rollback sign-off.

Those remain external P16 evidence and the manifest remains not-ready until they are recorded.

## Review-cycle audit trail

The first ten cycles satisfy the requested minimum. Additional review/fix/commit cycles were performed after the maintainer explicitly authorized going beyond ten when needed.

1. **Cycle 1 — evidence contract.** Implemented the immutable, SHA-bound manifest and fail-closed readiness evaluation. Review emphasized checksum coverage and post-seal immutability.
2. **Cycle 2 — integrity tests.** Added tests for missing evidence, wrong evidence source, blocked status, SHA mismatch, tampering, sealing, and deterministic checksums. Review reconciled top-level gates with grouped P16 sub-scenarios.
3. **Cycle 3 — operator CLI.** Added deterministic init/record/safety/status/seal/check commands and atomic writes. Review removed the need for manual JSON editing.
4. **Cycle 4 — package integration.** Added npm entry points without changing `0.1.0` or any runtime flag. Review kept P16 tooling separate from production execution.
5. **Cycle 5 — staging runbook.** Added the complete P16 staging scenario matrix, stop conditions, evidence hygiene, and safety assertions. Review ensured grouped gates cannot omit correction/recovery/fairness sub-scenarios operationally.
6. **Cycle 6 — Node 24 CI.** Added the P16 evidence-contract test to mandatory compatibility checks. Review ensured the new release contract cannot regress unnoticed.
7. **Cycle 7 — production-gate guard.** Added an automated PR diff guard for deployment surfaces and known gate enablement. Review kept documentation/tests from producing false positives.
8. **Cycle 8 — exact PR diff wiring.** Updated checkout depth and supplied exact PR base/head SHAs. Review fixed shallow-clone ambiguity for three-dot diff validation.
9. **Cycle 9 — integrated handover.** Recorded implementation boundaries, external evidence, and audit trail. Review kept P16 completion claims separate from staging evidence not available to repository CI.
10. **Cycle 10 — incomplete-seal CLI fix.** Final requested-cycle review found the CLI could seal an incomplete manifest before returning non-ready. Fixed it to refuse writing a sealed manifest until every gate and safety assertion is satisfied.
11. **Cycle 11 — P16-only gate guard.** Static PR review found the production-gate guard would run on every future PR. Scoped it to `feat/p16-*` pull requests so unrelated deployment work is not blocked.
12. **Cycle 12 — library seal invariant.** Review found direct library callers could still seal incomplete evidence. Moved the complete-evidence/safety prerequisite into the evidence library itself.
13. **Cycle 13 — seal regression coverage.** Added tests proving incomplete gates and false safety assertions cannot be sealed through the library.
14. **Cycle 14 — handover reconciliation.** Updated this implementation record to reflect the completed post-ten review cycles and their safety fixes.
15. **Cycle 15 — stopped-run archival consistency.** Review found the runbook still suggested sealing incomplete stopped runs. Corrected it so incomplete runs remain unsealed and are archived using external immutable storage/versioning controls.
16. **Cycle 16 — exact-SHA CI freeze.** Reconciled the handover and froze the branch for the authoritative workflow run.
17. **Cycle 17 — TypeScript module contract.** Exact-SHA CI exposed over-narrow TypeScript inference from the JavaScript evidence module (`randomUUID()` template type and `never[]` evidence arrays). Added an adjacent `.d.mts` declaration with the intended public contract rather than weakening tests or runtime validation.
18. **Cycle 18 — final handover reconciliation.** Updated this implementation record to include the CI-found type defect and its typed-contract fix before the final exact-SHA validation run.

## Completion semantics

This P16 implementation is complete when the branch tooling/tests/docs are green after the final review/fix cycle. That means Oakcloud has a controlled process to collect the final staging/release evidence. It does **not** mean the external evidence has already been executed in this repository session.

After staging operators execute the runbook against the exact candidate SHA, a sealed manifest whose `readyForSeparateProductionGateReview` value is true is the artifact to attach to a separate explicit production-gate proposal.

The current PR must not be merged as a production-enablement shortcut. Final merge to `main` remains an explicit maintainer decision.
