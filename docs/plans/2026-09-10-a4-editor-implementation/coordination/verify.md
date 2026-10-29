# VERIFY handoff log

## Q1 independent verification packet — VERIFY-Q1-20260912-01 — FINAL

### Scope and immutable target

- Assignment: `VERIFY-Q1-20260912-01`
- Role: independent VERIFY / G2-Q1 only
- Frozen production candidate: `6e8d4426c0d57043d85a830045dee465f6ff9a47`
- Integration PR: `#47 — codex/a4-editor-wave2-g2-integration-20260912`
- Q1 evidence PR: `#48 — verify/a4-editor-q1-20260912`
- Frozen contract: `v1 frozen at G0 — unchanged`
- Product files modified by VERIFY: **none**
- Temporary VERIFY-only GitHub Actions workflows were removed after evidence capture.

All decisive jobs checked out the frozen candidate by exact SHA, proved `git rev-parse HEAD` matched it, and overlaid only VERIFY-owned acceptance files. No application source, contract, schema, production data, package/version file, or deployment configuration was changed to obtain the result.

### Environment

- GitHub-hosted Ubuntu 24.04 runners
- Node 24
- Real Chromium installed through Playwright; production Puppeteer was bound to the installed Chromium for output verification
- Preferred Browser plugin was unavailable in this environment; the permitted real-Playwright/Chromium fallback was used
- Disposable PostgreSQL 16 container for persistence verification
- Synthetic Q1 content only; no production business records

### Decisive execution evidence

#### Browser / repeatability

Run `34691284098`, browser job `103546894711`: **SUCCESS**.

- exact frozen candidate proved before verifier overlay;
- Q1-01 native `Enter` followed immediately by typing executed in **20 consecutive fresh-process runs: 20/20 passed**;
- VERIFY boundary packet passed;
- complete frozen Q1-relevant browser baseline and delayed/fault variants passed.

Run `34693602507`, browser job `103553139068`: **SUCCESS** and independently repeated the same 20x critical sequence, boundary packet, and frozen baseline/fault variants.

#### PostgreSQL / save-reopen / batch / readers

Run `34693602507`, PostgreSQL job `103553138970`: **SUCCESS**.

The job used a disposable PostgreSQL database, applied migrations, and passed the Q1 persistence acceptance plus the frozen W1 baseline. Evidence covered save/reopen, A/B isolation, two-item batch identity/layout separation, canonical stored-document reading, old/new reader compatibility boundaries, and absence of soft-pagination metadata in persisted canonical state.

#### Q1-08 empty nested-list caret

The first combined verifier used a helper that required a `Text` node and therefore could not place a caret in the deliberate empty fixture `<p><br /></p>`. That was a verifier defect, not a product defect.

A focused verifier used a real collapsed DOM range inside the empty paragraph and executed the required native `Enter` + immediate typing sequence against the exact frozen candidate.

Run `34697297249`, browser job `103562865846`: **SUCCESS**.

Observed result: the empty nested item lifted to the parent list level, hierarchy remained valid, `Parent` was retained, and immediate typed content `LIFTED` was retained. **Q1-08 passes.**

### Q1-11 real HTML/PDF rendering — PRODUCT DEFECT

Run `34697297249`, output job `103562865715`: **FAILURE on the intended numbering assertion after real rendering**.

The verifier called the production `buildPDFHtml` and `generatePDF` paths with real Chromium. It produced and retained:

- `a4-q1-11-real-html.png`
- `a4-q1-11-real-output.pdf`
- `a4-q1-11-real-output.txt`

GitHub Actions artifact:

- name: `a4-q1-11-real-render`
- artifact id: `10298668552`
- artifact size: `95,745` bytes
- artifact digest: `sha256:d08199ea08546d2c856cd6ce22e9b1dccfcc800e1613ee5ec1973e287313974e`
- retained from run: `34697297249`

Generated PDF facts:

- actual PDF bytes: `42,061`
- pages: `4`
- first sentinel: `Q1-REAL-START-7F4A` present
- final sentinel: `Q1-REAL-END-9C2D` present on page 4
- sentinel/order and filler content remained intact across pagination

The actual output is wrong for ordered-list start/continuation semantics:

| Fixture | Required | Actual rendered HTML/PDF |
| --- | --- | --- |
| `<ol start="5">` first item | `5.` | `1.` |
| same list second item | `6.` | `2.` |
| alpha list | `a)`, `b)` | `a)`, `b)` — correct |
| bold-number list | bold marker retained | bold `1.` retained |
| continuation `<ol start="8">` | `8.` | `1.` |
| explicit restart `<ol start="1">` | `1.` | `1.` — correct |

This was confirmed three ways:

1. PDF text extraction from the real four-page PDF reported `Q1-NUMBER-FIVE 1.`, `Q1-NUMBER-SIX 2.`, and `Q1-CONTINUATION-EIGHT 1.`.
2. Visual inspection of the retained production HTML screenshot showed the same `1., 2., 1.` markers.
3. The PDF was rendered to images at 200 DPI; visual inspection of page 1 again showed `Q1-NUMBER-FIVE` as `1.`, `Q1-NUMBER-SIX` as `2.`, and `Q1-CONTINUATION-EIGHT` as `1.`. Page 4 confirmed the final sentinel and ordering.

This is therefore **not** a PDF text-extraction artifact and **not** a verifier-only failure.

The frozen print stylesheet uses a custom counter reset based on `--list-start` with a default of zero while generated HTML preserves the native `start` attribute. The observed rendering demonstrates that the native `start` value is not reaching the custom output counter for these lists. VERIFY did not change production code to correct it.

### Q1-01 through Q1-12 result map

| Check | Result | Evidence |
| --- | --- | --- |
| Q1-01 | **PASS** | 20/20 fresh-process native Enter/immediate-type repetitions; browser runs `34691284098` and `34693602507`. |
| Q1-02 | **PASS** | VERIFY browser boundary packet passed. |
| Q1-03 | **PASS** | VERIFY forward/reverse cross-page selection packet passed. |
| Q1-04 | **PASS** | Complete frozen Q1-relevant browser baseline and break-removal fault variants passed. |
| Q1-05 | **PASS** | VERIFY selected logical-position break packet passed. |
| Q1-06 | **PASS** | Complete frozen list/boundary baseline and fault variants passed. |
| Q1-07 | **PASS** | Native Tab/Shift+Tab/toolbar equivalence packet passed. |
| Q1-08 | **PASS** | Focused real-Chromium empty nested-list caret test passed, run `34697297249`. |
| Q1-09 | **PASS** | Undo/blank-page boundary packet passed. |
| Q1-10 | **PASS** | Disposable-PostgreSQL save/reopen A/B isolation acceptance passed, run `34693602507`. |
| Q1-11 | **FAIL — PRODUCT DEFECT** | Durable persistence portion passed, but actual HTML/PDF renders `start=5` as `1,2` and continuation `start=8` as `1`. |
| Q1-12 | **PASS** | Native blank-page pointer/keyboard packet passed. |

### Verifier-only false starts kept separate from the product defect

The following did not count as product failures:

- initial Q1 environment/channel setup before the temporary VERIFY workflow exception was authorized;
- early persistence verifier assumptions about canonical storage shape, corrected without production changes;
- early output-verifier class/style assumptions, corrected without production changes;
- Q1-08 helper assumption that every caret target contains a text node;
- one focused Q1-11 workflow shell-quoting error while binding Chromium;
- one focused Q1-11 default 5-second test timeout;
- one hidden artifact-directory upload configuration issue.

After those verifier-only issues were removed, Q1-08 passed and Q1-11 still failed on visible production output, establishing the product defect above.

### Defect requiring owner correction

`Q1-11-LIST-OUTPUT-01` — ordered-list native start/continuation value is lost by the custom HTML/PDF output counter path.

- Severity for gate: blocking
- Affected requirement: Q1-11 durable numbering through actual output
- Reproduction: production HTML and production PDF from exact frozen candidate
- Data/content loss: no text loss observed in this fixture; numbering semantics are wrong
- Correct cases in same fixture: alpha numbering, bold marker styling, explicit restart-at-1, sentinels/order/pagination
- Production correction by VERIFY: **none**
- Required next action: return to the appropriate implementation owner, correct the output numbering bridge/counter semantics, freeze a new candidate, then rerun Q1-11 and dependent G2/Q1 acceptance before promotion

### Cleanup / promotion boundary

- Temporary `.github/workflows/a4-q1-focused.yml`: removed after evidence capture.
- Temporary `.github/workflows/a4-q1-verify.yml`: removed after evidence capture.
- PR #47: not merged by VERIFY.
- PR #48: evidence only; not merged by VERIFY.
- No deployment or next implementation wave was started.

### Promotion decision

G2 / Q1 BLOCKED — CORRECTION REQUIRED

---

## Q1 corrective verification rerun — VERIFY-Q1-20260912-01 — FINAL PASS

### Corrected integrated target and scope

The historical result above remains the authoritative record for the originally frozen candidate `6e8d4426c0d57043d85a830045dee465f6ff9a47`; it is not rewritten or reinterpreted. The blocking `Q1-11-LIST-OUTPUT-01` defect was corrected by implementation-owner PR #49 and independently reverified afterward.

- Corrective PR: `#49 — Q1-11: preserve ordered-list starts in production output`
- Corrective implementation candidate: `76d97078c90ef3e01b335bc0b86d1faef8f2062e`
- Integration-branch merge containing the correction: `11b535ed1d4286437124aaca3e160685a6eec647`
- Corrected integrated/main verification target: `e232f998475f87248588c79cdc63988e942f0da2`
- Frozen contract: `v1 frozen at G0 — unchanged`
- Product files modified by VERIFY during the corrective rerun: **none**

Repository comparison proved that `76d97078... -> 11b535ed...` and `11b535ed... -> e232f998...` each add only their merge commit with **no file-tree delta**. The exact production tree independently verified is therefore the corrected tree that was integrated to `main`.

PR #49's production change is restricted to `src/components/documents/a4-print-styles.ts`; its other two changed paths are Q1-11 regression tests. The correction replaces the output-only custom `item` counter reset with native `list-item` counter semantics and semantic `::marker`, while retaining the projection-only pagination continuation override. No editor-session, native-input, persistence, reader, schema, field, workflow, contract, version, or deployment production path was changed by this corrective PR.

Under `verification-and-rollout.md`, after a production correction VERIFY repeats the affected gate plus dependent checks. Because the correction is output-stylesheet-only, Q1-01 through Q1-10 and Q1-12 retain their previously recorded passing browser/persistence evidence; the corrective rerun repeats Q1-11 itself plus the directly dependent print, pagination/list, and HTML/PDF compatibility suites.

### Environment

- GitHub-hosted Ubuntu 24.04
- Node `24.20.0`, npm `11.19.0`
- Playwright Chromium / Chrome for Testing `149.0.7827.55`
- production Puppeteer bound to the installed Chromium executable
- synthetic Q1 fixture content only; no production business data

### Verifier-only tokenization false start

Corrective rerun `34732373700` checked out exact integrated target `e232f998475f87248588c79cdc63988e942f0da2`. Its dependent output/pagination job passed, while the original independent Q1-11 verifier failed only because its PDF-text regex required `5.` with no whitespace between marker glyphs.

The real PDF generated in that run already showed the corrected production semantics as PDF.js tokenized glyphs:

- `5 .   Q1-NUMBER-FIVE`
- `6 .   Q1-NUMBER-SIX`
- `8 .   Q1-CONTINUATION-EIGHT`
- `1 .   Q1-RESTART-ONE`
- `a )   Q1-ALPHA-FIRST`

This differs materially from the historical product defect, where the rendered values themselves were `1, 2, 1`. The first corrective rerun therefore exposed a verifier-tokenization mismatch, not a product failure. VERIFY changed only its acceptance regex to tolerate extractor-inserted whitespace between the exact marker value and its punctuation; required value, punctuation, label, and order remain strict. No production code or product assertion meaning was weakened.

Verifier-only correction commit: `d0dac964f55ac035cc20457bd823808f5425dccf`.

### Final independent corrective execution

Run `34732493983`: **SUCCESS — both jobs passed against exact target `e232f998475f87248588c79cdc63988e942f0da2`.**

#### Q1-11 independent real HTML/PDF rerun

Job `103657739369`: **SUCCESS**.

1. Independent historical Q1-11 real-render verifier, overlaid onto the exact product target:
   - test files: **1 passed / 0 failed**
   - tests: **1 passed / 0 failed**
   - generated PDF: **4 pages / 42,895 bytes**
   - extracted contexts: `5 . Q1-NUMBER-FIVE`, `6 . Q1-NUMBER-SIX`, `8 . Q1-CONTINUATION-EIGHT`, `1 . Q1-RESTART-ONE`, `a ) Q1-ALPHA-FIRST`
   - first/final sentinel and content-order assertions passed.

2. Corrected production Q1-11 regression from PR #49:
   - test files: **1 passed / 0 failed**
   - tests: **1 passed / 0 failed**
   - generated PDF: **6 pages / 43,649 bytes**
   - verified default ordered numbering, `start=5` => `5,6`, alpha `a,b`, bold marker styling, nested `3.4`, continuation `start=8`, deliberate restart at `1`, and long-list pagination continuity beginning at `20` without canonical soft metadata.

Rendered evidence artifact retained from the final successful run:

- name: `a4-q1-11-corrective-independent-render`
- artifact id: `10310078073`
- final artifact size: `177,290` bytes
- digest: `sha256:c02abfa498b648df922c9e3e6b83c9c508a3ffd393cc518623272e68f86fa37f`
- source run: `34732493983`

#### Dependent output / pagination checks

Job `103657739426`: **SUCCESS**.

- `npx vitest run __tests__/components/a4-print-styles.test.ts --reporter=verbose`
  - **1 file / 14 tests passed**
- `npx vitest run __tests__/components/a4-pagination --reporter=verbose`
  - **10 files / 200 tests passed**
- `npx vitest run tests/document-output/document-template-editor-output.test.ts --reporter=verbose`
  - **1 file / 10 tests passed**

Final corrective rerun total: **14 test files / 226 tests passed / 0 failed** across the two independent jobs.

### Final Q1-01 through Q1-12 disposition

| Check | Final result | Evidence disposition |
| --- | --- | --- |
| Q1-01 | **PASS** | Historical independent 20/20 fresh-process native Enter/immediate-type repetitions remain valid; corrective production scope does not touch editor input/session behavior. |
| Q1-02 | **PASS** | Historical VERIFY boundary packet remains valid; corrective production scope is output stylesheet only. |
| Q1-03 | **PASS** | Historical forward/reverse cross-page selection packet remains valid. |
| Q1-04 | **PASS** | Historical break-removal/boundary evidence remains valid. |
| Q1-05 | **PASS** | Historical selected logical-position break evidence remains valid. |
| Q1-06 | **PASS** | Historical list/boundary browser evidence remains valid; dependent pagination/list suite additionally passed 200/200 on the corrected integrated target. |
| Q1-07 | **PASS** | Historical native Tab/Shift+Tab/toolbar equivalence remains valid. |
| Q1-08 | **PASS** | Historical focused real-Chromium empty nested-list test remains valid. |
| Q1-09 | **PASS** | Historical undo/blank-page packet remains valid. |
| Q1-10 | **PASS** | Historical disposable-PostgreSQL save/reopen A/B isolation remains valid; corrective PR does not touch persistence. |
| Q1-11 | **PASS — CORRECTED AND INDEPENDENTLY REVERIFIED** | Final run `34732493983`: historical real-render verifier 1/1 plus strengthened production real-render regression 1/1; dependent print/pagination/output checks all pass. |
| Q1-12 | **PASS** | Historical native blank-page pointer/keyboard packet remains valid. |

### Cleanup and promotion boundary

- Temporary `.github/workflows/a4-q1-corrective-verify.yml`: removed after successful evidence capture.
- Historical Q1 evidence and the original blocked verdict are preserved above.
- No production file was edited by VERIFY.
- No deployment, application version bump, C3/S3/F3/W3, Q2, or later implementation wave was started by this verification.
- PR #48 remains the VERIFY evidence branch/PR and is not a deployment authorization.

### Final promotion decision

**G2 / Q1 PASSED — TECHNICALLY READY FOR D1 PROMOTION, SUBJECT TO SEPARATE DEPLOYMENT AUTHORIZATION AND THE ROLLBACK/COMPATIBILITY RULES IN `verification-and-rollout.md`.**

## VERIFY-Q2-G4-20260913-01 — assignment published; NOT EXECUTED

- Immutable product candidate: `b522cf50f61f18b75f2cae62b42cd142bef4cf2d`.
- Integration branch: `codex/a4-editor-wave4-integration-20260913`.
- Frozen contract: **v1 frozen at G0 — unchanged**.
- G2/Q1: **PASSED** and remains frozen.
- CORE assessment: Wave-4 implementation is integrated and ready for independent remaining-G3 then G4/Q2 acceptance.
- Q2/G4 result in this record: **NOT STARTED / NOT PASSED / NOT FAILED**.

The verifier must use the exact immutable candidate above and the full Q2/G4 acceptance in `verification-and-rollout.md`. Required evidence includes actual PDF/HTML/local-print output, persistence/concurrency/drafts/preview/batch paths, real clipboard and IME/accessibility interaction, representative staff journeys, failure/cleanup behavior, repository checks, rollback rehearsal and explicit blocked-environment reporting.

VERIFY may add acceptance-only tests/evidence under its dispatch lease, but may not fix product source. Any product defect returns to the owning implementation packet and invalidates the candidate for affected dependent checks. No main merge, deployment, version bump or production business-data mutation is authorized by this assignment.
