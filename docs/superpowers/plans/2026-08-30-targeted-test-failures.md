# Targeted Test Failures Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the targeted 10-file Vitest suite by fixing three genuine UI contract gaps and bringing stale test fixtures/assertions in line with current application contracts.

**Architecture:** Keep production behavior unchanged where the report proves the application contract is intentional: transactional reconciliation remains mandatory, service-impact previews continue through the exported request helper, company selection retains metadata, and mapped Prisma fields remain mapped. Add missing shared-editor behavior at the shared component boundary so both the editor test and manual-cycle dialog benefit without duplication, and restore the officer field at the generic profile editor boundary.

**Tech Stack:** TypeScript, React 19, Vitest, Testing Library, Prisma schema text fixtures.

**Spec:** `C:/Users/Scotfield/.codex/attachments/f088dcbc-ea1a-4ed7-a306-329f155ff81c/pasted-text.txt`

## Global Constraints

- Preserve unrelated working-tree changes, especially the existing `prisma/schema.prisma` edits.
- Update existing tests and components only; do not introduce new documentation outside `docs/`.
- Follow `docs/guides/DESIGN_GUIDELINE.md` for UI behavior and retain existing 44px touch-target conventions.
- Use each existing failing test as the RED state before the minimal fix.

---

### Task 1: Repair integration-shaped test fixtures

**Files:**
- Modify: `__tests__/services/bizfile-contact-resolution.test.ts`
- Modify: `__tests__/components/company-services-tab.test.tsx`

**Interfaces:**
- Consumes: `enqueueScheduleReconciliation(tx, input)` and `previewClientServiceDeadlineImpact(id, payload, signal)`.
- Produces: transaction doubles with `serviceScheduleReconciliationRequest.findUnique/upsert`, and a partial module mock that retains the real preview request helper.

- [ ] Add the queue delegate to the BizFile transaction double and default `findUnique` to no existing request.
- [ ] Run the BizFile test and confirm all queue-reached scenarios pass without weakening production validation.
- [ ] Change the client-service module mock to spread the real exports before overriding hooks.
- [ ] Run the company-services test and confirm the preview request, save lock, and immutable snapshot assertions pass.

### Task 2: Complete the shared schedule-entry contract

**Files:**
- Modify: `src/components/services/shared/schedule-entry-editor.tsx`
- Test: `__tests__/components/schedule-entry-editor.test.tsx`
- Verify: `__tests__/components/manual-cycle-dialog.test.tsx`

**Interfaces:**
- Consumes: `ScheduleEntryInput['expression']`, including numeric offsets and `{ kind: 'INTEGER_PARAMETER'; key: string }` operands.
- Produces: an `aria-live="polite"` count status and operand-specific controls that respect `allowParameterizedOffsets`.

- [ ] Use the existing failing status and parameterized-offset tests as RED evidence.
- [ ] Render `${value.length} of 31 schedule entries configured` in a polite status element.
- [ ] Add an `Offset operand` select with `LITERAL` and conditionally available `INTEGER_PARAMETER` choices.
- [ ] Render either the numeric `Offset` input or `Offset parameter key` input and update the expression without losing its source/unit.
- [ ] Preserve `min-h-[44px]` on the tested entry label and offset-unit controls.
- [ ] Run the shared editor and manual-cycle tests together.

### Task 3: Restore officer current-state editing

**Files:**
- Modify: `src/components/companies/company-edit/company-edit-section.tsx`
- Test: `__tests__/components/company-create-workspace.test.tsx`

**Interfaces:**
- Consumes: officer records whose database model includes `isCurrent: boolean`.
- Produces: new officers defaulting to `isCurrent: true`, rendered through the existing accessible `Toggle` branch.

- [ ] Use the existing missing-switch test as RED evidence.
- [ ] Add `isCurrent: true` to the officer array default.
- [ ] Remove the officer-only filter that suppresses `isCurrent` while retaining the `id` filter.
- [ ] Run the company-create workspace test.

### Task 4: Make stale assertions semantic

**Files:**
- Modify: `__tests__/components/batch-shared-setup.test.tsx`
- Modify: `__tests__/services/client-service-schema.test.ts`
- Modify: `__tests__/services/service-agreement-schema.test.ts`
- Modify: `__tests__/services/form-option-preset-schema.test.ts`
- Modify: `__tests__/services/service-catalog-schema.test.ts`

**Interfaces:**
- Consumes: the selected company DTO and Prisma field declarations with arbitrary alignment plus valid trailing annotations.
- Produces: callback assertions for both arguments and regular-expression schema assertions for field name/type/required annotations.

- [ ] Assert the company callback receives the selected ID and full company metadata.
- [ ] Replace exact-space Prisma substrings with line-anchored semantic regular expressions, retaining required type/default/unique constraints and rejecting optional `Json?` for preset options.
- [ ] Run the five affected test files.

### Task 5: Verify the complete repair

**Files:**
- Verify all files listed above.

**Interfaces:**
- Consumes: the exact 10-file reproduction command.
- Produces: zero failures for the 63 targeted tests plus a clean TypeScript check for touched production code.

- [ ] Run the exact 10-file Vitest suite with the dot reporter.
- [ ] Run `npx.cmd tsc --noEmit` and distinguish pre-existing failures from changes introduced here.
- [ ] Review `git diff --` for only the targeted files and confirm unrelated edits were preserved.
