# Service Agreement Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a catalog-backed Service Agreement workflow that composes selectable SOWs, entity-specific fees, and entity appendices, then activates signed selections as operational company Services records.

**Architecture:** Extend the existing document-template, partial, draft-session, generated-document, company, and e-signing modules rather than introducing a second document engine. The work is split into three prerequisite-ordered implementation plans so each subsystem has a stable public contract and an independently testable release gate.

**Tech Stack:** Next.js 15, React 19, TypeScript 5.7, Prisma 7/PostgreSQL, Zod 3, TanStack Query 5, Tiptap 3, Vitest 4, Playwright 1.61, existing Oakcloud RBAC/audit/backup services.

## Global Constraints

- Preserve the unrelated working-tree changes in `src/components/documents/a4-page-editor.tsx` and its two test files.
- Follow `docs/guides/DESIGN_GUIDELINE.md`: compact 4px-grid UI, existing semantic colors, dark mode, keyboard access, and responsive layouts.
- All new records are tenant-scoped; every service query filters `tenantId` and soft-deleted rows.
- Reuse `document:*` permissions for catalog/template/agreement generation and `company:read`/`company:update` for operational Services.
- Service Agreement fee rows are always entity-specific; group-total fees are not supported.
- Service wording is pinned by snapshot and version; saved drafts never refresh wording implicitly.
- The assembled document remains fully editable, but edits never reverse-sync into structured service data.
- Signed document content is immutable; later operational Service edits are audited and never rewrite the agreement.
- Milestones 1-3 are the first release. Statutory deadline generation and billing monitoring remain separate follow-on projects.
- Update documentation under `docs/`; do not create documentation outside that directory.
- Run `npm.cmd run db:generate` after Prisma changes and use `npm.cmd run test:run -- <test paths>` for focused verification.

---

## Delivery Sequence

### Plan 1: Service Catalog and Template Foundation

**Plan:** `docs/superpowers/plans/2026-07-30-service-catalog-foundation.md`

**Produces:**

- Tenant-scoped `ServiceFamily`, `ServiceVariant`, and `ServiceVariantFeeTemplate` records.
- `ServiceCadence`, `BillingFrequency`, and `DocumentTemplateCompositionType` enums.
- Material versioning for service variants and template partials.
- Service-scoped placeholder definitions and three validated agreement composition slots.
- Catalog CRUD APIs and a third `Services` tab in `/template-partials`.
- Existing templates default to `STANDARD`; existing partials default to version 1.

**Release gate:**

```powershell
npm.cmd run db:generate
npx.cmd vitest run __tests__/services/service-catalog-schema.test.ts __tests__/services/service-catalog.service.test.ts __tests__/api/service-catalog-routes.test.ts __tests__/components/service-catalog.test.tsx __tests__/components/template-editor/template-validation.test.ts
```

Expected: Prisma generation exits 0 and all listed suites pass.

### Plan 2: Service Agreement Generation

**Plan:** `docs/superpowers/plans/2026-07-30-service-agreement-generation.md`

**Consumes:** Every interface and schema from Plan 1.

**Produces:**

- Relational Service Agreement draft state linked one-to-one to the existing generated-document draft.
- Generation-session version 2 with version 1 compatibility.
- Four-step Service Agreement wizard with multi-entity, repeated-service, per-entity-fee, and explicit wording-refresh flows.
- Deterministic server-side assembly of SOW sections, fee table, and Appendix 3.
- Full-editor divergence warning and metadata marker.
- Initial inactive Service Agreement template content based on the supplied 13-page PDF.

**Release gate:**

```powershell
npm.cmd run db:generate
npx.cmd vitest run __tests__/services/service-agreement-draft.service.test.ts __tests__/services/service-agreement-renderer.test.ts __tests__/services/document-generation-session.service.test.ts __tests__/services/document-generator.service.test.ts __tests__/api/service-agreement-generation-routes.test.ts __tests__/components/document-generation-wizard.test.tsx
npx.cmd vitest run --config vitest.browser.config.ts __tests__/browser/service-agreement-generation.browser.test.tsx
```

Expected: Prisma generation exits 0; unit/integration and browser suites pass.

### Plan 3: Client Services and Signed Activation

**Plan:** `docs/superpowers/plans/2026-07-30-client-services-activation.md`

**Consumes:** A generated document with its relational Service Agreement data from Plan 2.

**Produces:**

- One operational `ClientService` per agreement-item/entity pairing and copied entity-specific fee lines.
- Company `Services` tab with full audited operational editing.
- Retryable, idempotent activation triggered by completed Oakcloud e-signing envelopes.
- Audited manual activation for externally signed agreements.
- Backup/restore coverage for every catalog, agreement, and operational Service table.

**Release gate:**

```powershell
npm.cmd run db:generate
npx.cmd vitest run __tests__/services/client-service.service.test.ts __tests__/services/service-agreement-activation.service.test.ts __tests__/services/esigning-service-agreement-activation.test.ts __tests__/services/backup-service-agreement-data.test.ts __tests__/api/client-services-routes.test.ts __tests__/components/company-services-tab.test.tsx
npx.cmd vitest run --config vitest.browser.config.ts __tests__/browser/company-services.browser.test.tsx
npm.cmd run build
```

Expected: Prisma generation, all focused suites, browser tests, and production build exit 0.

## Cross-Plan Interfaces

The following names are fixed across the three plans:

```ts
export const SERVICE_AGREEMENT_SLOTS = {
  serviceSections: '{{@agreement.serviceSections}}',
  feeTable: '{{@agreement.feeTable}}',
  entityAppendix: '{{@agreement.entityAppendix}}',
} as const;

export type ServiceCadence =
  | 'MONTHLY'
  | 'QUARTERLY'
  | 'SEMI_ANNUALLY'
  | 'ANNUALLY'
  | 'ONE_TIME'
  | 'AD_HOC'
  | 'CUSTOM';

export type BillingFrequency =
  | 'MONTHLY'
  | 'QUARTERLY'
  | 'SEMI_ANNUALLY'
  | 'ANNUALLY'
  | 'ONE_TIME'
  | 'CUSTOM';

export interface ServiceAgreementFeeLineInput {
  id?: string;
  clientKey: string;
  companyId: string;
  description: string;
  amount: string;
  currency: string;
  billingFrequency: BillingFrequency;
  customFrequencyLabel?: string | null;
  billingStartDate?: string | null;
  displayOrder: number;
}
```

Plan 2 owns agreement-draft interfaces. Plan 3 consumes those persisted records and must not duplicate or parse rendered HTML.

## Initial Content Boundary

The initial tenant content uses the supplied PDF only as a controlled source:

- Master cover and acceptance wording.
- Terms of Business.
- Shared Statement of Work introduction.
- Corporate Secretarial Services SOW.
- Unaudited Financial Statement Compilation and Corporate Tax SOW.
- Fees, instructions, signatures, and Appendix 3 structure.

Do not import handwritten signatures, hyperlinks from the signed copy, or `OpenSign` document identifiers. Store the first template, partials, service families, and variants as inactive records until a human content owner reviews the wording and rendered PDF. Do not invent Accounting, Payroll, or additional Tax wording.

## Follow-On Projects

### Statutory Deadline Monitoring

Create a separate design and implementation plan after Plan 3. That project will attach tenant-authored deadline rules to service variants, preview calculations from verified company/service anchors, and create idempotent Tasks from published Task Pipeline versions. It must not restore the removed `deadlines`, `deadline_rules`, or `contracts` subsystem.

### Billing Monitoring

Create a separate design and implementation plan after deadline monitoring. It may derive billing dates from `ClientServiceFeeLine.billingStartDate` and `billingFrequency`, but invoice creation and accounting-platform integration remain out of scope until a billing target is selected.

## Final First-Release Verification

- [ ] **Run the combined service-agreement suite**

```powershell
npx.cmd vitest run __tests__/services/service-catalog-schema.test.ts __tests__/services/service-catalog.service.test.ts __tests__/services/service-agreement-draft.service.test.ts __tests__/services/service-agreement-renderer.test.ts __tests__/services/client-service.service.test.ts __tests__/services/service-agreement-activation.service.test.ts __tests__/api/service-catalog-routes.test.ts __tests__/api/service-agreement-generation-routes.test.ts __tests__/api/client-services-routes.test.ts __tests__/components/service-catalog.test.tsx __tests__/components/document-generation-wizard.test.tsx __tests__/components/company-services-tab.test.tsx
```

Expected: all listed suites pass.

- [ ] **Run browser regressions**

```powershell
npx.cmd vitest run --config vitest.browser.config.ts __tests__/browser/service-agreement-generation.browser.test.tsx __tests__/browser/company-services.browser.test.tsx
```

Expected: both browser suites pass in Chromium.

- [ ] **Run repository verification**

```powershell
npm.cmd run test:run
npm.cmd run build
```

Expected: the full test command and production build exit 0. If unrelated pre-existing failures remain, record their exact test names and preserve the focused green evidence above.

- [ ] **Perform rendered-document inspection**

Generate a service agreement with two entities and at least two services, including repeated variants and different per-entity fees. Export PDF and verify cover/PIC, Terms of Business, SOW order, entity-labelled fee rows, instructions/signatures, Appendix 3 numbering/UENs, headers/footers, and page breaks.
