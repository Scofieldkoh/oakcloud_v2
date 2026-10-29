# Document Generation Step 3 Service Agreement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh the Configure-stage Service Agreement UI and synchronize its primary-company state with the shared Step 2 selection.

**Architecture:** Keep `EditableDocumentGenerationBatch.primaryCompanyId` as the single source of truth. Thread the existing shared-company dispatch into the Service Agreement configurator, make the reducer remap Service Agreement entity/service/fee IDs when the primary changes, and keep visual behavior in focused UI primitives: `BatchSection`, an additional-entity picker, a service-variant picker, and a fee table editor.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS, lucide-react, Testing Library, Vitest, and the existing browser Playwright/Vitest configuration.

**Spec:** `docs/superpowers/specs/2026-08-30-document-generation-step3-service-agreement-design.md`

## Global Constraints

- Preserve the unified four-stage document-generation workflow and existing API/server contracts.
- Apply the Companies-style deep oak-green header to every Configure-stage `BatchSection`, including standard-document sections.
- Keep the primary company implicit in Appendix 3 and persist entity IDs as primary plus additional entities.
- Use the exact copy “Appendix 3 - additional entities to add into the agreement”.
- Keep service-variant cards as the only nested card exception; do not add cards inside ordinary Configure sections.
- Make fees a collapsible, expanded-by-default subsection rendered as a table, not individual fee cards.
- Keep all interactive controls keyboard accessible and usable at mobile widths.
- Preserve unrelated existing worktree changes.

---

### Task 1: Synchronize primary-company changes through Service Agreement state

**Files:**
- Modify: `src/components/documents/generation-batch/batch-workspace-state.ts`
- Test: `__tests__/components/document-generation-batch-state.test.ts`

**Interfaces:**
- Produce `syncServiceAgreementPrimaryCompany(workspace, previousPrimaryCompanyId, nextPrimaryCompanyId)` as a local or exported pure helper with return type `ServiceAgreementWorkspaceState`.
- Update the `shared/company` reducer branch so every editable Service Agreement item is remapped from the previous primary ID to the next primary ID in its workspace `entityIds`, each service item’s `entityIds`, and each fee line’s `companyId`.

- [ ] **Step 1: Write the failing reducer tests**

Add a test fixture containing one Service Agreement item with entity IDs `[old-primary, additional]`, one service targeted to `[old-primary, additional]`, and fee lines owned by both companies. Dispatch `shared/company` with `old-primary` already in state and assert that the next batch uses `[new-primary, additional]`, the service targets `[new-primary, additional]`, and the fee ownership changes only from `old-primary` to `new-primary`. Add a second case proving a Service Agreement with `serviceAgreement: null` remains null and a case proving generated items are not changed.

- [ ] **Step 2: Run the focused state test and verify it fails**

Run: `npm.cmd run test:run -- __tests__/components/document-generation-batch-state.test.ts --reporter=dot`

Expected: FAIL because the `shared/company` reducer currently changes only `primaryCompanyId` and auto-generated titles.

- [ ] **Step 3: Implement the pure remapping helper and reducer integration**

Use immutable mapping. Replace the old primary in arrays while preserving order and de-duplicating if the new ID is already present. For a workspace with no entity IDs, add the new primary. Remap only IDs that equal the previous primary; leave additional entities and unrelated fee lines unchanged. Call the helper only for editable, non-generated items inside the existing `shared/company` branch, then run the existing title invalidation logic.

- [ ] **Step 4: Run the focused state test and verify it passes**

Run: `npm.cmd run test:run -- __tests__/components/document-generation-batch-state.test.ts --reporter=dot`

Expected: PASS, with the existing reducer tests remaining green.

- [ ] **Step 5: Commit the isolated state change**

Run: `git add -- src/components/documents/generation-batch/batch-workspace-state.ts __tests__/components/document-generation-batch-state.test.ts` then `git commit -m "fix: synchronize service agreement primary company"`.

---

### Task 2: Apply the Companies header style to Configure sections

**Files:**
- Modify: `src/components/documents/generation-batch/batch-section.tsx`
- Modify: `src/components/documents/generation-batch/apply-to-others-menu.tsx`
- Test: `__tests__/components/service-agreement-batch-config.test.tsx`
- Test: `__tests__/components/batch-item-configurator.test.tsx`

**Interfaces:**
- Keep the existing `BatchSectionProps` API so standard and Service Agreement configurators require no new section wrapper.
- Add only the styling/context needed for header actions to remain legible on the oak-green header.

- [ ] **Step 1: Add assertions for the shared header treatment**

Render a standard configurator and a Service Agreement configurator. Assert each Configure section heading is inside a header with the oak-green background class and white text. Assert the Service Agreement test fixture has no nested “Agreement parties” or “Services” heading.

- [ ] **Step 2: Run the focused component tests and verify the new assertions fail**

Run: `npm.cmd run test:run -- __tests__/components/service-agreement-batch-config.test.tsx __tests__/components/batch-item-configurator.test.tsx --reporter=dot`

Expected: FAIL for the new header assertions because `BatchSection` currently renders a plain background header.

- [ ] **Step 3: Update `BatchSection` and header actions**

Use the Companies detail pattern: an overflow-hidden bordered section with a compact `bg-oak-primary` header, white heading, white collapse icon, and header-safe status/action treatments. Keep the body border separator and current ARIA relationships. Update `ApplyToOthersMenu` so its trigger has a translucent white border/white text when placed in a header, while preserving its existing standalone appearance through a prop or class.

- [ ] **Step 4: Run focused tests and verify they pass**

Run: `npm.cmd run test:run -- __tests__/components/service-agreement-batch-config.test.tsx __tests__/components/batch-item-configurator.test.tsx --reporter=dot`

Expected: PASS with existing interaction assertions intact.

- [ ] **Step 5: Commit the shared section styling**

Run: `git add -- src/components/documents/generation-batch/batch-section.tsx src/components/documents/generation-batch/apply-to-others-menu.tsx __tests__/components/service-agreement-batch-config.test.tsx __tests__/components/batch-item-configurator.test.tsx` then `git commit -m "style: align document configuration section headers"`.

---

### Task 3: Add primary-company and additional-entity selection surfaces

**Files:**
- Modify: `src/components/documents/generation-batch/service-agreement-config.tsx`
- Modify: `src/components/documents/generation-batch/batch-item-configurator.tsx`
- Modify: `src/components/documents/generation-batch/document-generation-batch-workspace.tsx`
- Modify: `src/components/documents/service-agreement/service-agreement-setup.tsx`
- Test: `__tests__/components/service-agreement-batch-config.test.tsx`
- Test: `__tests__/components/document-generation-batch-workspace.test.tsx`

**Interfaces:**
- Extend Service Agreement configuration props with the current company-search result set, query/loading state, `onSearchCompanies`, and `onPrimaryCompanyChange(companyId, company)` callback.
- `ServiceAgreementSetup` renders the exact Appendix 3 label, adds entities through the async searchable company control, and renders selected additional companies as compact director-style tiles.
- `ServiceAgreementConfig` renders a Primary company async select in Agreement details and passes selection changes to the workspace callback.

- [ ] **Step 1: Write failing component tests**

Add tests that render a Service Agreement with a primary company and an additional company. Assert the primary company appears under Agreement details, Appendix 3 uses the exact requested text, only the additional company appears in the selected tile list, the removed “Agreement parties” copy is absent, and selecting a different primary invokes `onPrimaryCompanyChange` with the selected company. Add a workspace test that clicks the Step 3 primary-company control and asserts the shared-company reducer/API payload uses the new company ID.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `npm.cmd run test:run -- __tests__/components/service-agreement-batch-config.test.tsx __tests__/components/document-generation-batch-workspace.test.tsx --reporter=dot`

Expected: FAIL because the current setup lists every known company in a tile grid, has no primary-company control in Agreement details, and does not expose a Step 3 company callback.

- [ ] **Step 3: Implement the selector wiring and flattened setup**

Thread the existing workspace `companySearch` state into `BatchItemConfigurator` and `ServiceAgreementConfig`. Keep the primary ID in `batch.primaryCompanyId`; make the Agreement details selector dispatch `shared/company`. In `ServiceAgreementSetup`, remove its outer nested section and old explanatory copy, render an `AsyncSearchSelect` for adding additional companies, and show selected non-primary companies as compact bordered rows with a building icon, name/UEN, checked checkbox, and remove behavior. Keep the persisted workspace list as primary plus additional IDs.

- [ ] **Step 4: Run focused tests and verify they pass**

Run: `npm.cmd run test:run -- __tests__/components/service-agreement-batch-config.test.tsx __tests__/components/document-generation-batch-workspace.test.tsx --reporter=dot`

Expected: PASS, including the existing four-stage workspace assertions.

- [ ] **Step 5: Commit the company-selection change**

Run: `git add -- src/components/documents/generation-batch/service-agreement-config.tsx src/components/documents/generation-batch/batch-item-configurator.tsx src/components/documents/generation-batch/document-generation-batch-workspace.tsx src/components/documents/service-agreement/service-agreement-setup.tsx __tests__/components/service-agreement-batch-config.test.tsx __tests__/components/document-generation-batch-workspace.test.tsx` then `git commit -m "feat: sync service agreement company selection"`.

---

### Task 4: Replace the service variant select with an accessible info-popover picker

**Files:**
- Create: `src/components/documents/service-agreement/service-variant-picker.tsx`
- Modify: `src/components/documents/service-agreement/service-selection-step.tsx`
- Test: `__tests__/components/service-agreement-batch-config.test.tsx`

**Interfaces:**
- Produce `ServiceVariantPickerProps` with `variants`, `value`, `onChange`, and `disabled` fields.
- The picker exposes a combobox/listbox contract, displays variant names, and provides an information button per option. The info button toggles a description popout without selecting the option; hover/focus on the info button also opens it for pointer users.

- [ ] **Step 1: Write failing picker tests**

Render the picker with two variants, one with a description. Open the combobox, click the variant information button, assert the description popout is visible while the value remains empty, click the option itself, and assert the selected value changes. Repeat with keyboard focus/Enter on the information button and Escape to close the popout. Assert the old native select is no longer rendered.

- [ ] **Step 2: Run the picker test and verify it fails**

Run: `npm.cmd run test:run -- __tests__/components/service-agreement-batch-config.test.tsx --reporter=dot`

Expected: FAIL because `ServiceSelectionStep` currently renders a native `<select>` with no independent information control.

- [ ] **Step 3: Implement the picker**

Use a button/input combobox with an absolutely positioned or portal-rendered listbox, keyboard navigation, outside-click and Escape handling, and touch-safe minimum targets. Render an `Info` button per option with `aria-label="Show description for …"`; stop propagation so it does not select the option. Keep the popout positioned relative to the option and readable at mobile widths.

- [ ] **Step 4: Integrate it and remove the redundant Services heading**

Replace the native select in `ServiceSelectionStep` with `ServiceVariantPicker`, keep the Add service button, and return the picker/list without the nested “Services” section/card. Preserve variant loading, item creation, and validation behavior.

- [ ] **Step 5: Run focused tests and verify they pass**

Run: `npm.cmd run test:run -- __tests__/components/service-agreement-batch-config.test.tsx --reporter=dot`

Expected: PASS, including service item creation and existing no-stepper assertions.

- [ ] **Step 6: Commit the picker change**

Run: `git add -- src/components/documents/service-agreement/service-variant-picker.tsx src/components/documents/service-agreement/service-selection-step.tsx __tests__/components/service-agreement-batch-config.test.tsx` then `git commit -m "feat: add service variant descriptions"`.

---

### Task 5: Flatten service-item layout and render fees as a compact table

**Files:**
- Modify: `src/components/documents/service-agreement/service-item-editor.tsx`
- Modify: `src/components/documents/service-agreement/service-fee-editor.tsx`
- Modify: `src/components/documents/generation-batch/service-agreement-config.tsx`
- Test: `__tests__/components/service-agreement-batch-config.test.tsx`

**Interfaces:**
- Keep `ServiceItemEditor` and `ServiceFeeEditor` value/onChange contracts unchanged so service-agreement validation and persistence remain stable.
- Fees render under an expanded-by-default collapsible Fees subsection inside each allowed service-variant card.

- [ ] **Step 1: Write failing layout/behavior tests**

Add a fixture with one service item and two fee lines. Assert version metadata is absent, Applies-to entries use the compact bordered-row treatment, date inputs have a constrained width class, a Fees heading and expanded table are present, table headers are Description/Amount/Currency/Frequency/Billing start date, both fee rows render, editing a fee updates `onChange`, and removing a fee removes only that row. Assert the Service Agreement config does not render a Document fields heading.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `npm.cmd run test:run -- __tests__/components/service-agreement-batch-config.test.tsx --reporter=dot`

Expected: FAIL because fees are currently individual grid cards, dates use full available width, metadata is rendered, and Document fields is always included.

- [ ] **Step 3: Implement the Service Agreement section order and copy rules**

Keep Details first, followed by Entities and representative, Services and fees, Agreement details, and Shared values when applicable. Remove Document fields from Service Agreement only. Keep Agreement details with Agreement date and Primary company, remove Effective date and Term, and constrain date controls with a reusable width class.

- [ ] **Step 4: Implement compact Applies-to rows and service-item card content**

Remove the “Pinned from version … · SOW version …” paragraph. Render each available entity as a full-width bordered row with a checkbox, building icon, company name, and muted UEN in the visual style of the supplied fifth screenshot. Keep the service variant card as the permitted outer card and preserve stale-wording actions.

- [ ] **Step 5: Implement the collapsible fee table**

Use a native `<details open>` or equivalent controlled disclosure labelled Fees. Render a semantic `<table>` inside an overflow-x wrapper. On large screens use a description column that absorbs remaining width and bounded columns for amount, currency, frequency, billing start date, and removal. Use the same compact height class on every input/select/date control, including the billing start date reference. Keep custom-frequency editing within the frequency cell and preserve display-order updates after removal.

- [ ] **Step 6: Run focused tests and verify they pass**

Run: `npm.cmd run test:run -- __tests__/components/service-agreement-batch-config.test.tsx __tests__/components/batch-item-configurator.test.tsx --reporter=dot`

Expected: PASS with no regressions in standard configuration.

- [ ] **Step 7: Commit the service layout change**

Run: `git add -- src/components/documents/service-agreement/service-item-editor.tsx src/components/documents/service-agreement/service-fee-editor.tsx src/components/documents/generation-batch/service-agreement-config.tsx __tests__/components/service-agreement-batch-config.test.tsx` then `git commit -m "style: simplify service agreement fees"`.

---

### Task 6: Run integrated verification and rendered QA

**Files:**
- Modify: `__tests__/browser/document-generation-batch.browser.test.tsx`
- Modify: `__tests__/browser/service-agreement-generation.browser.test.tsx`

**Interfaces:**
- No production interfaces are added. Browser fixtures must cover the same Service Agreement workspace shape used by the component tests.

- [ ] **Step 1: Extend browser coverage**

Add a browser assertion for the oak-green Configure section headers, the Appendix 3 text, compact additional-entity rows, the primary-company field, the Fees table, and the absence of Document fields. Exercise changing the primary company from Step 3 and assert the displayed Applies-to company changes to the new primary.

- [ ] **Step 2: Run targeted unit/component tests**

Run: `npm.cmd run test:run -- __tests__/components/document-generation-batch-state.test.ts __tests__/components/service-agreement-batch-config.test.tsx __tests__/components/document-generation-batch-workspace.test.tsx __tests__/components/batch-item-configurator.test.tsx --reporter=dot`

Expected: PASS.

- [ ] **Step 3: Run TypeScript and lint checks**

Run: `npx.cmd tsc --noEmit` and `npm.cmd run lint`.

Expected: PASS with no new TypeScript or ESLint diagnostics.

- [ ] **Step 4: Run browser tests**

Run: `npm.cmd run test:browser -- __tests__/browser/document-generation-batch.browser.test.tsx __tests__/browser/service-agreement-generation.browser.test.tsx`.

Expected: PASS with the existing four-stage workflow and the new Configure interactions.

- [ ] **Step 5: Perform rendered desktop/mobile QA**

Use the in-app Browser skill against the project’s local route when available. Verify the flow: document-generation entry -> Configure -> Service Agreement item -> change primary company / open variant info / expand Fees. Capture desktop and mobile screenshots, inspect page identity, DOM non-blank state, framework overlays, console warnings/errors, and actual control state changes.

- [ ] **Step 6: Review the final diff without touching unrelated work**

Run: `git status --short` and `git diff --check`.

Expected: only the planned production/docs/test files are changed by this work, unrelated pre-existing modifications remain present, and whitespace validation passes.
