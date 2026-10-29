# Bizfile Company Profile Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Normalize every approved Bizfile review datum into company records, render the approved Company profile, and make every displayed source field editable through a section-based Edit workspace.

**Architecture:** A shared transaction-aware Bizfile synchronizer becomes the only new/existing-company persistence path. Company profile reads and manual edits use typed section DTOs with deterministic version tokens, while the detail and Edit UIs consume the same normalized section shapes so visibility and editability cannot drift.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Prisma/PostgreSQL, Zod, TanStack Query, React Hook Form, Tailwind CSS, Vitest, Testing Library.

## Global Constraints

- Bizfile receipt metadata remains document-only and must not appear in the Company profile.
- Do not backfill or preserve existing company data; create schema changes only.
- Use the approved neutral OakCloud page/card backgrounds and dark Oak-green section headers.
- Use Inter and the typography, spacing, button, badge, and theme rules in `docs/guides/DESIGN_GUIDELINE.md`.
- Every displayed source field must have an editing path; attributed shareholder capital is the sole read-only derived value.
- New and existing-company Bizfile applications must write every normalized section atomically.
- Manual Edit workspace saves are independent and transactional per section.
- Preserve tenant isolation, RBAC, company access checks, source-document links, and audit logging.
- Run only directly affected tests; do not run the full repository or broad browser suites.

---

## File Structure

### Create

- `prisma/migrations/20260801010000_company_auditor_normalization/migration.sql` — auditor table and relations only; no data migration.
- `src/lib/company-profile-sections.ts` — section identifiers, deterministic canonical serialization, version hashing, badge palettes, and attributed-capital calculation.
- `src/lib/validations/company-profile.ts` — section-specific mutation schemas and payload types.
- `src/services/company/profile-sections.ts` — section readers, versioned section saves, relation synchronization, and audit creation.
- `src/services/bizfile/company-sync.ts` — shared all-section Bizfile synchronization used by create and update flows.
- `src/app/api/companies/[id]/profile/[section]/route.ts` — section GET/PATCH API boundary.
- `src/hooks/use-company-profile-sections.ts` — typed section queries/mutations with 409 handling.
- `src/components/companies/company-detail/company-profile-header.tsx` — approved identity line, status, and permission/document-gated actions.
- `src/components/companies/company-detail/company-profile-sections.tsx` — approved read-only profile composition.
- `src/components/companies/company-detail/company-profile-badges.tsx` — accessible role/type/status badge mapping.
- `src/components/companies/company-edit/company-edit-workspace.tsx` — section-based Edit workspace shell.
- `src/components/companies/company-edit/company-edit-section.tsx` — shared section state, save controls, errors, and conflict UI.
- `src/components/companies/company-edit/editors/*.tsx` — focused editors for identity, addresses, activities, officers, shareholders, compliance, capital, charges, history, and auditor.
- `__tests__/lib/company-profile-sections.test.ts` — canonical version and attributed-capital tests.
- `__tests__/services/bizfile-company-sync.test.ts` — exhaustive new/existing normalization tests.
- `__tests__/services/company-profile-sections.test.ts` — section save/transaction/conflict tests.
- `__tests__/api/company-profile-section-route.test.ts` — permission, validation, and 409 API tests.
- `__tests__/components/company-profile-sections.test.tsx` — approved visibility/filter/format tests.
- `__tests__/components/company-edit-workspace.test.tsx` — section save and error-retention tests.

### Modify

- `prisma/schema.prisma` — add `CompanyAuditor` and relations.
- `src/services/bizfile/types.ts` — remove the duplicate FYE alias from the canonical review contract.
- `src/lib/validations/bizfile-review.ts` — consolidate FYE review validation.
- `src/components/companies/bizfile-review/bizfile-review-sections.tsx` — render one FYE-as-at-last-AR field.
- `src/services/bizfile/processor.ts` — delegate full persistence to the shared synchronizer.
- `src/services/bizfile/diff.ts` — compare all normalized sections or delegate diff construction to the synchronizer contract.
- `src/services/company.service.ts` — return the complete normalized profile read model and stop hiding normalized data.
- `src/services/company/types.ts` — add former names, share capital, auditor, structured identities, and section DTO types.
- `src/app/(dashboard)/companies/[id]/page.tsx` — approved header/actions and new profile component.
- `src/components/companies/company-detail/company-profile-tab.tsx` — reduce to composition/export or replace with the focused profile sections.
- `src/app/(dashboard)/companies/[id]/edit/page.tsx` — replace the monolithic partial form with the section workspace.
- `src/hooks/use-companies.ts` — keep company-detail invalidation compatible with section mutations.
- Existing focused Bizfile review, confirm-route, and company service tests where their fixtures need the canonical FYE shape.

---

### Task 1: Add the normalized auditor schema and generated types

**Files:**
- Modify: `prisma/schema.prisma:235-330`
- Create: `prisma/migrations/20260801010000_company_auditor_normalization/migration.sql`
- Test: `__tests__/services/company.service.test.ts`

**Interfaces:**
- Produces: Prisma `CompanyAuditor` model and `Company.auditor` relation used by Tasks 3–7.
- Consumes: Existing `Company`, `Document`, and cascade/source-document relation patterns.

- [ ] **Step 1: Write a failing schema contract test**

Add a focused test that imports the generated Prisma types and compiles a complete auditor payload:

```ts
import type { Prisma } from '@/generated/prisma';

const auditorCreate: Prisma.CompanyAuditorUncheckedCreateInput = {
  companyId: 'company-1',
  name: 'Example Assurance LLP',
  address: '8 Marina View, Singapore 018960',
  appointmentDate: new Date('2024-04-10'),
  sourceDocumentId: 'document-1',
};

expect(auditorCreate.name).toBe('Example Assurance LLP');
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm run test:run -- __tests__/services/company.service.test.ts`

Expected: Type generation/test setup fails because `CompanyAuditor` does not exist.

- [ ] **Step 3: Add the Prisma model and relations**

Add this model and the corresponding `Company.auditor` and `Document.companyAuditors` relations:

```prisma
model CompanyAuditor {
  id               String    @id @default(uuid())
  companyId        String    @unique
  name             String
  address          String?
  appointmentDate  DateTime?
  sourceDocumentId String?
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt
  company          Company   @relation(fields: [companyId], references: [id], onDelete: Cascade)
  document         Document? @relation(fields: [sourceDocumentId], references: [id])

  @@index([sourceDocumentId])
  @@map("company_auditors")
}
```

The SQL migration creates the table, unique company constraint, source-document index, and foreign keys. It contains no INSERT/UPDATE/backfill statements.

- [ ] **Step 4: Regenerate Prisma artifacts**

Run: `npm run db:generate`

Expected: Prisma generation succeeds and exposes `CompanyAuditor` types/delegate.

- [ ] **Step 5: Run the focused schema/service test**

Run: `npm run test:run -- __tests__/services/company.service.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add prisma/schema.prisma prisma/migrations/20260801010000_company_auditor_normalization/migration.sql src/generated __tests__/services/company.service.test.ts
git commit -m "feat(companies): normalize company auditor records"
```

---

### Task 2: Canonicalize review data and profile calculations

**Files:**
- Create: `src/lib/company-profile-sections.ts`
- Modify: `src/services/bizfile/types.ts`
- Modify: `src/lib/validations/bizfile-review.ts`
- Modify: `src/components/companies/bizfile-review/bizfile-review-sections.tsx`
- Test: `__tests__/lib/company-profile-sections.test.ts`
- Test: `__tests__/lib/bizfile-review-validation.test.ts`
- Test: `__tests__/components/bizfile-review-sections.test.tsx`

**Interfaces:**
- Produces: `CompanyProfileSectionId`, `computeSectionVersion(value)`, `calculateAttributedCapital(input)`, `officerRoleBadge(role)`, and `shareholderTypeBadge(type)`.
- Produces: One canonical `compliance.fyeAsAtLastAr` review path; removes `financialYear.fyeAsAtLastAr`.
- Consumes: Prisma Decimal-compatible numeric strings and existing Bizfile canonicalizers.

- [ ] **Step 1: Write failing calculation/version tests**

```ts
expect(calculateAttributedCapital({
  shareholderShares: 60_000,
  classShares: 100_000,
  classTotalValue: '100000.00',
  currency: 'SGD',
})).toEqual({ currency: 'SGD', amount: '60000.00' });

expect(calculateAttributedCapital({
  shareholderShares: 1,
  classShares: 0,
  classTotalValue: '100.00',
  currency: 'SGD',
})).toBeNull();

expect(computeSectionVersion({ b: 2, a: 1 }))
  .toBe(computeSectionVersion({ a: 1, b: 2 }));
```

Also assert the review schema accepts `compliance.fyeAsAtLastAr` and strips/rejects the obsolete `financialYear.fyeAsAtLastAr` path.

- [ ] **Step 2: Run focused tests to verify failure**

Run: `npm run test:run -- __tests__/lib/company-profile-sections.test.ts __tests__/lib/bizfile-review-validation.test.ts __tests__/components/bizfile-review-sections.test.tsx`

Expected: FAIL because the helpers and canonical review shape do not exist.

- [ ] **Step 3: Implement canonical serialization and decimal-safe allocation**

Use sorted recursive object keys before SHA-256 hashing, preserve array order, convert Dates to ISO strings, and convert Prisma Decimal-like values to strings. Use `Prisma.Decimal` for the calculation:

```ts
export function calculateAttributedCapital(input: AttributedCapitalInput) {
  if (input.classShares <= 0 || !input.currency) return null;
  const amount = new Prisma.Decimal(input.classTotalValue)
    .mul(input.shareholderShares)
    .div(input.classShares)
    .toDecimalPlaces(2);
  return { currency: input.currency, amount: amount.toFixed(2) };
}
```

Define deterministic badge classes with readable light/dark variants: Director blue, Secretary amber, Individual purple, Corporate teal, status green. Always return a text label together with the class.

- [ ] **Step 4: Consolidate the duplicate FYE review field**

Remove `fyeAsAtLastAr` from `financialYear` in `ExtractedBizFileData`, validation, empty drafts, and review UI. Keep `compliance.fyeAsAtLastAr` as the sole canonical path and retain its section mapping to `compliance`.

- [ ] **Step 5: Run focused tests**

Run: `npm run test:run -- __tests__/lib/company-profile-sections.test.ts __tests__/lib/bizfile-review-validation.test.ts __tests__/components/bizfile-review-sections.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/lib/company-profile-sections.ts src/services/bizfile/types.ts src/lib/validations/bizfile-review.ts src/components/companies/bizfile-review/bizfile-review-sections.tsx __tests__/lib/company-profile-sections.test.ts __tests__/lib/bizfile-review-validation.test.ts __tests__/components/bizfile-review-sections.test.tsx
git commit -m "refactor(bizfile): canonicalize company profile review data"
```

---

### Task 3: Replace split persistence with one all-section Bizfile synchronizer

**Files:**
- Create: `src/services/bizfile/company-sync.ts`
- Modify: `src/services/bizfile/processor.ts`
- Modify: `src/services/bizfile/diff.ts`
- Modify: `src/services/bizfile/index.ts`
- Test: `__tests__/services/bizfile-company-sync.test.ts`
- Test: `__tests__/api/bizfile-confirm-route.test.ts`

**Interfaces:**
- Consumes: `ExtractedBizFileData`, `PrismaTransactionClient`, contact-resolution helpers, `documentId`, `tenantId`, and `userId`.
- Produces:

```ts
export interface SyncCompanyFromBizfileArgs {
  data: ExtractedBizFileData;
  documentId: string;
  tenantId: string;
  userId: string;
  existingCompanyId?: string;
}

export interface SyncCompanyFromBizfileResult {
  companyId: string;
  created: boolean;
  changedSections: CompanyProfileSectionId[];
}
```

- [ ] **Step 1: Write the exhaustive failing synchronization tests**

Build one reviewed fixture containing every canonical field: entity dates/history, two addresses, both SSIC activities, aggregate and class capital, treasury shares, officer identity/appointment/cessation, shareholder identity/type/origin/address/class/shares/percentage/currency, auditor, canonical compliance dates, charges, and document metadata.

For a new company, assert the transaction writes every normalized destination and keeps receipt metadata only in Document/DocumentRevision. For an existing company, seed differing values and assert the same destinations are replaced/upserted, including mailing address, auditor, current share classes, treasury, charges, and identity details previously omitted by selective update.

- [ ] **Step 2: Run the focused sync and confirm-route tests to verify failure**

Run: `npm run test:run -- __tests__/services/bizfile-company-sync.test.ts __tests__/api/bizfile-confirm-route.test.ts`

Expected: FAIL on currently omitted existing-company sections and missing auditor writes.

- [ ] **Step 3: Implement the shared transaction synchronizer**

Create focused internal functions invoked within the caller's one transaction:

```ts
syncCompanyScalars(tx, companyId, data)
syncFormerNames(tx, companyId, data.entityDetails.formerNames ?? [], documentId)
syncCanonicalAddresses(tx, companyId, data, documentId)
syncShareCapital(tx, companyId, data, documentId)
syncOfficers(tx, companyId, data.officers ?? [], context)
syncShareholders(tx, companyId, data.shareholders ?? [], context)
syncAuditor(tx, companyId, data.auditor, documentId)
syncCharges(tx, companyId, data.charges ?? [], documentId)
```

Canonical addresses upsert one row per `companyId + addressType` and update it in place. Current share capital replaces the company's class set after validating that shareholder class references remain resolvable. Former names/officers/shareholders/charges keep their approved history semantics. Every source-derived related record carries `sourceDocumentId`.

- [ ] **Step 4: Route both processor entry points through the synchronizer**

Make `processBizFileExtraction` and `processBizFileExtractionSelective` thin orchestration wrappers around `syncCompanyFromBizfile`. Preserve task recovery, document revision creation, contact decisions, and return-shape adapters, but remove the smaller selective allowlist as a persistence boundary.

- [ ] **Step 5: Extend diff generation to every normalized section**

Generate review differences from the same canonical section selectors used by synchronization. Ensure mailing address, history, registration date, home currency, share classes/treasury, auditor, full compliance, charges, and matched officer/shareholder editable fields appear when changed.

- [ ] **Step 6: Write section-level audit summaries inside the transaction**

Create one audit record per changed section with `sourceDocumentId`, normalized before/after values, and counts for repeating sections. Keep the existing processing-document/revision audit behavior.

- [ ] **Step 7: Run focused Bizfile tests**

Run: `npm run test:run -- __tests__/services/bizfile-company-sync.test.ts __tests__/services/bizfile.test.ts __tests__/services/bizfile-diff-source-path.test.ts __tests__/api/bizfile-confirm-route.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add src/services/bizfile/company-sync.ts src/services/bizfile/processor.ts src/services/bizfile/diff.ts src/services/bizfile/index.ts __tests__/services/bizfile-company-sync.test.ts __tests__/services/bizfile.test.ts __tests__/services/bizfile-diff-source-path.test.ts __tests__/api/bizfile-confirm-route.test.ts
git commit -m "feat(bizfile): synchronize every company profile section"
```

---

### Task 4: Add versioned Company profile section services and APIs

**Files:**
- Create: `src/lib/validations/company-profile.ts`
- Create: `src/services/company/profile-sections.ts`
- Create: `src/app/api/companies/[id]/profile/[section]/route.ts`
- Modify: `src/services/company/types.ts`
- Modify: `src/services/company/index.ts`
- Test: `__tests__/services/company-profile-sections.test.ts`
- Test: `__tests__/api/company-profile-section-route.test.ts`

**Interfaces:**
- Consumes: `CompanyProfileSectionId` and `computeSectionVersion` from Task 2.
- Produces:

```ts
export interface CompanyProfileSectionDto<T> {
  section: CompanyProfileSectionId;
  version: string;
  data: T;
}

export interface SaveCompanyProfileSectionArgs<T> {
  companyId: string;
  tenantId: string;
  userId: string;
  section: CompanyProfileSectionId;
  ifMatchVersion: string;
  data: T;
  reason?: string;
}
```

- [ ] **Step 1: Write failing service tests for all section saves**

Table-drive the section IDs and assert each accepted payload updates only its normalized destinations, returns a new version, and writes an audit entry. Add explicit cases for canonical address replacement, capital class replacement, auditor upsert, officer/shareholder/charge history actions, and derived-value inputs.

Add a stale-version test:

```ts
await expect(saveCompanyProfileSection({
  ...args,
  section: 'addresses',
  ifMatchVersion: 'stale',
  data: validAddresses,
})).rejects.toMatchObject({ code: 'COMPANY_PROFILE_CONFLICT' });
```

- [ ] **Step 2: Run focused service tests to verify failure**

Run: `npm run test:run -- __tests__/services/company-profile-sections.test.ts`

Expected: FAIL because section schemas/services do not exist.

- [ ] **Step 3: Implement discriminated section validation**

Define one schema per section and a route envelope:

```ts
export const sectionMutationEnvelopeSchema = z.object({
  ifMatchVersion: z.string().regex(/^[a-f0-9]{64}$/),
  reason: z.string().min(10).optional(),
  data: z.unknown(),
});

export const companyProfileSectionSchemas = {
  identity: identitySectionSchema,
  addresses: addressesSectionSchema,
  activities: activitiesSectionSchema,
  officers: officersSectionSchema,
  shareholders: shareholdersSectionSchema,
  compliance: complianceSectionSchema,
  capital: capitalSectionSchema,
  charges: chargesSectionSchema,
  additional: additionalSectionSchema,
} satisfies Record<CompanyProfileSectionId, z.ZodTypeAny>;
```

- [ ] **Step 4: Implement section selectors and deterministic conflict checks**

Read a normalized section, canonicalize Dates/Decimals/record order, compute its version, and return `{ section, version, data }`. Inside a transaction, reread and compare `ifMatchVersion` before any mutation. Throw a typed conflict carrying the latest DTO on mismatch.

- [ ] **Step 5: Implement section mutation transactions and audits**

Use one handler map keyed by `CompanyProfileSectionId`. Each handler validates company/child ownership, updates only its section, recomputes denormalized counts/capital totals when required, and writes its audit record before committing.

- [ ] **Step 6: Implement the dynamic API route**

GET and PATCH must call `requireAuth`, `parseIdParams`, `requireWorkspaceContext`, `requirePermission`, and `canAccessCompany`. Return `404` for unknown section/company, `400` with field paths for Zod failures, and `409` with `{ error, latest }` for version conflicts.

- [ ] **Step 7: Run focused service/API tests**

Run: `npm run test:run -- __tests__/services/company-profile-sections.test.ts __tests__/api/company-profile-section-route.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git --literal-pathspecs add -- src/lib/validations/company-profile.ts src/services/company/profile-sections.ts 'src/app/api/companies/[id]/profile/[section]/route.ts' src/services/company/types.ts src/services/company/index.ts __tests__/services/company-profile-sections.test.ts __tests__/api/company-profile-section-route.test.ts
git commit -m "feat(companies): add versioned profile section saves"
```

---

### Task 5: Build the complete profile read model and approved Company detail UI

**Files:**
- Create: `src/components/companies/company-detail/company-profile-sections.tsx`
- Create: `src/components/companies/company-detail/company-profile-header.tsx`
- Create: `src/components/companies/company-detail/company-profile-badges.tsx`
- Modify: `src/services/company.service.ts:1077-1218`
- Modify: `src/services/company/types.ts`
- Modify: `src/app/(dashboard)/companies/[id]/page.tsx:235-348`
- Modify: `src/components/companies/company-detail/company-profile-tab.tsx`
- Test: `__tests__/components/company-profile-sections.test.tsx`

**Interfaces:**
- Consumes: Complete `CompanyWithRelations`, `calculateAttributedCapital`, badge mappings, existing permissions, `useCompanyBizFile`.
- Produces: Approved profile layout and accessible filters/expansions.

- [ ] **Step 1: Write failing approved-layout component tests**

Assert:

```ts
expect(screen.getByRole('heading', { name: /Meridian Advisory Pte\. Ltd\./ })).toBeVisible();
expect(screen.getByText('(202412345N)')).toBeVisible();
expect(screen.getByText('Exempt Private Limited')).toBeVisible();
expect(screen.getByRole('heading', { name: 'Compliance' }))
  .toBeBefore(screen.getByRole('heading', { name: 'Capital' }));
expect(screen.getByText('SGD 60,000 / 60,000 Ordinary Shares')).toBeVisible();
expect(screen.queryByText('ACRA250807001467')).not.toBeInTheDocument();
```

Test **Show ceased**, **Show former**, **Show discharged**, capital expansion, `Value unavailable`, role/type badge labels, no address `Current` badge, and inline effective date.

- [ ] **Step 2: Run the focused component test to verify failure**

Run: `npm run test:run -- __tests__/components/company-profile-sections.test.tsx`

Expected: FAIL against the existing partial layout.

- [ ] **Step 3: Complete the profile read model**

Update `getCompanyFullDetails` to return all current canonical addresses, all visible former names, officers/shareholders including past records, current share capital, auditor, active/discharged charges, and document availability. Do not fetch receipt metadata for profile display.

- [ ] **Step 4: Implement reusable section and badge primitives**

Create a semantic section shell using existing neutral background tokens and dark Oak header classes. Keep classification badges text-labelled and theme-safe. Give status badges a shared `min-w`, height, padding, font size, and centered alignment.

```tsx
export function CompanyProfileSection({ title, actions, children }: Props) {
  return <section className="overflow-hidden rounded-lg border border-border-primary bg-background-secondary">
    <header className="flex min-h-9 items-center justify-between gap-2 border-b border-oak-dark bg-oak-primary px-3 py-2 text-white">
      <h2 className="text-sm font-semibold">{title}</h2>
      {actions}
    </header>
    {children}
  </section>;
}
```

- [ ] **Step 5: Implement the approved profile composition**

Match the approved order, two-column responsive layout, typography, labels, action visibility, filters, Capital expansion, Additional company information collapse, and exact header structure. Keep **View BizFile**, **Update via BizFile**, **Edit**, and **Delete** permission/document gated.

```tsx
<CompanyProfileHeader company={company} bizFile={bizFileInfo} can={can} />
<div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
  <div className="space-y-4 lg:col-span-2">
    <AddressesSection />
    <ActivitiesSection />
    <OfficersSection />
    <ShareholdersSection />
    <AdditionalInformationSection />
  </div>
  <aside className="space-y-4">
    <ComplianceSection />
    <CapitalSection />
    <ChargesSection />
  </aside>
</div>
```

- [ ] **Step 6: Run focused component and existing company service tests**

Run: `npm run test:run -- __tests__/components/company-profile-sections.test.tsx __tests__/services/company.service.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git --literal-pathspecs add -- src/components/companies/company-detail/company-profile-header.tsx src/components/companies/company-detail/company-profile-sections.tsx src/components/companies/company-detail/company-profile-badges.tsx src/components/companies/company-detail/company-profile-tab.tsx src/services/company.service.ts src/services/company/types.ts 'src/app/(dashboard)/companies/[id]/page.tsx' __tests__/components/company-profile-sections.test.tsx __tests__/services/company.service.test.ts
git commit -m "feat(companies): render complete normalized company profiles"
```

---

### Task 6: Replace the partial Edit page with section-based saves

**Files:**
- Create: `src/hooks/use-company-profile-sections.ts`
- Create: `src/components/companies/company-edit/company-edit-workspace.tsx`
- Create: `src/components/companies/company-edit/company-edit-section.tsx`
- Create: `src/components/companies/company-edit/editors/identity-editor.tsx`
- Create: `src/components/companies/company-edit/editors/addresses-editor.tsx`
- Create: `src/components/companies/company-edit/editors/activities-editor.tsx`
- Create: `src/components/companies/company-edit/editors/officers-editor.tsx`
- Create: `src/components/companies/company-edit/editors/shareholders-editor.tsx`
- Create: `src/components/companies/company-edit/editors/compliance-editor.tsx`
- Create: `src/components/companies/company-edit/editors/capital-editor.tsx`
- Create: `src/components/companies/company-edit/editors/charges-editor.tsx`
- Create: `src/components/companies/company-edit/editors/additional-editor.tsx`
- Modify: `src/app/(dashboard)/companies/[id]/edit/page.tsx`
- Modify: `src/hooks/use-companies.ts`
- Test: `__tests__/components/company-edit-workspace.test.tsx`

**Interfaces:**
- Consumes: Task 4 section GET/PATCH DTOs and Task 5 labels/order.
- Produces: One Edit workspace with independently saved sections, preserved unsaved input, conflict reload, and full field coverage.

- [ ] **Step 1: Write failing workspace behavior tests**

Render all section DTOs and assert every approved displayed source field has an enabled input/action under the appropriate section. Verify changing an address and saving calls only `/profile/addresses`, while invalid charge input does not block it. Verify a server validation error retains typed input and a 409 shows **Reload latest section** without overwriting local state.

- [ ] **Step 2: Run the focused Edit workspace test to verify failure**

Run: `npm run test:run -- __tests__/components/company-edit-workspace.test.tsx`

Expected: FAIL because the section workspace does not exist.

- [ ] **Step 3: Implement typed section hooks**

Expose:

```ts
useCompanyProfileSection<T>(companyId, section)
useSaveCompanyProfileSection<T>(companyId, section)
```

PATCH sends `{ ifMatchVersion, data, reason }`. On success, update the section cache and invalidate the full company detail. On `409`, retain local input and expose `latest` for explicit reload.

```ts
export class CompanyProfileConflictError<T> extends Error {
  constructor(public readonly latest: CompanyProfileSectionDto<T>) {
    super('This section changed after you opened it');
  }
}

export class CompanyProfileSectionError extends Error {
  constructor(message: string, public readonly issues: Array<{ path: string; message: string }> = []) {
    super(message);
  }
}

async function patchCompanyProfileSection<T>(url: string, input: SaveSectionInput<T>) {
  const response = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = await response.json();
  if (response.status === 409) throw new CompanyProfileConflictError(body.latest);
  if (!response.ok) throw new CompanyProfileSectionError(body.error, body.issues);
  return body as CompanyProfileSectionDto<T>;
}

return useMutation({
  mutationFn: (input: SaveSectionInput<T>) => patchCompanyProfileSection(
    `/api/companies/${companyId}/profile/${section}`,
    input,
  ),
  onSuccess: (dto) => {
    queryClient.setQueryData(sectionKey(companyId, section), dto);
    queryClient.invalidateQueries({ queryKey: ['company', companyId] });
  },
});
```

- [ ] **Step 4: Implement the shared Edit section shell**

The shell owns loading/error/conflict banners, dirty tracking, section-level Save/Cancel, keyboard-safe submit behavior, and unsaved-change warnings. Use standard `.card`, `.input`, `Button`, `Checkbox`, and 4px-grid spacing patterns.

```tsx
<form onSubmit={form.handleSubmit(save)} className="card overflow-hidden">
  <header className="flex items-center justify-between border-b border-border-primary bg-oak-primary px-4 py-3 text-white">
    <h2 className="text-sm font-semibold">{title}</h2>
    <Button type="submit" size="sm" isLoading={mutation.isPending}>Save section</Button>
  </header>
  {conflict ? <ConflictBanner onReload={reloadLatest} /> : null}
  <div className="p-4">{children}</div>
</form>
```

- [ ] **Step 5: Implement focused editors for scalar sections**

Identity, Addresses, Activities, Compliance, and Additional use React Hook Form plus their Task 4 Zod schemas. Addresses include both registered and mailing structured fields and registered effective date. Additional includes complete former names and auditor.

```ts
type ScalarSectionId = Extract<CompanyProfileSectionId,
  'identity' | 'addresses' | 'activities' | 'compliance' | 'additional'>;

const scalarEditors = {
  identity: IdentityEditor,
  addresses: AddressesEditor,
  activities: ActivitiesEditor,
  compliance: ComplianceEditor,
  additional: AdditionalEditor,
} satisfies Record<ScalarSectionId, ComponentType<SectionEditorProps>>;
```

- [ ] **Step 6: Implement repeating-record editors**

Officers, Shareholders, Capital, and Charges reuse existing record actions where possible and add missing fields. Officer/shareholder identity fields, dates, addresses, classifications, currency, and history actions must all be editable. Capital edits aggregate totals plus current class/treasury rows; attributed shareholder value remains read-only preview text.

```tsx
<RepeatingRecordEditor
  items={fields}
  createItem={createEmptyShareholder}
  renderItem={(field, index) => <ShareholderFields
    index={index}
    control={control}
    attributedCapital={calculateAttributedCapitalForDraft(field, shareCapital)}
  />}
/>
```

- [ ] **Step 7: Replace the existing Edit page composition**

Keep the route-level permission/loading/not-found behavior and keyboard navigation, then render `CompanyEditWorkspace`. Preserve **Update via BizFile** navigation as a separate action rather than mixing document upload into manual section forms.

```tsx
return <CompanyEditWorkspace
  companyId={id}
  sectionOrder={[
    'identity', 'addresses', 'activities', 'officers', 'shareholders',
    'compliance', 'capital', 'charges', 'additional',
  ]}
/>;
```

- [ ] **Step 8: Run focused Edit and API tests**

Run: `npm run test:run -- __tests__/components/company-edit-workspace.test.tsx __tests__/api/company-profile-section-route.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit**

```powershell
git --literal-pathspecs add -- src/hooks/use-company-profile-sections.ts src/components/companies/company-edit 'src/app/(dashboard)/companies/[id]/edit/page.tsx' src/hooks/use-companies.ts __tests__/components/company-edit-workspace.test.tsx
git commit -m "feat(companies): add section-based company profile editing"
```

---

### Task 7: Run focused cross-path verification and close coverage gaps

**Files:**
- Modify only files already listed when a focused test exposes a defect.
- Test: `__tests__/services/bizfile-company-sync.test.ts`
- Test: `__tests__/services/company-profile-sections.test.ts`
- Test: `__tests__/api/company-profile-section-route.test.ts`
- Test: `__tests__/components/company-profile-sections.test.tsx`
- Test: `__tests__/components/company-edit-workspace.test.tsx`
- Test: Existing directly affected Bizfile review/confirm tests.

**Interfaces:**
- Consumes: All prior tasks.
- Produces: Evidence that upload review → normalized record → visible profile → Edit workspace is complete for every canonical field.

- [ ] **Step 1: Add one field-coverage matrix test**

Define an explicit canonical mapping in the test with no wildcard entries:

```ts
const coverage = {
  'entityDetails.uen': ['Company.uen', 'profile header', 'identity editor'],
  'entityDetails.name': ['Company.name', 'profile header', 'identity editor'],
  'entityDetails.formerName': ['Company.formerName', 'Company history', 'additional editor'],
  'entityDetails.dateOfNameChange': ['Company.dateOfNameChange', 'Company history', 'additional editor'],
  'entityDetails.formerNames[].name': ['CompanyFormerName.formerName', 'Company history', 'additional editor'],
  'entityDetails.formerNames[].effectiveFrom': ['CompanyFormerName.effectiveFrom', 'Company history', 'additional editor'],
  'entityDetails.formerNames[].effectiveTo': ['CompanyFormerName.effectiveTo', 'Company history', 'additional editor'],
  'entityDetails.entityType': ['Company.entityType', 'profile header', 'identity editor'],
  'entityDetails.status': ['Company.status', 'profile header', 'identity editor'],
  'entityDetails.statusDate': ['Company.statusDate', 'profile header status', 'identity editor'],
  'entityDetails.incorporationDate': ['Company.incorporationDate', 'Company history', 'identity editor'],
  'entityDetails.registrationDate': ['Company.registrationDate', 'Company history', 'additional editor'],
  'ssicActivities.primary.code': ['Company.primarySsicCode', 'Business activities', 'activities editor'],
  'ssicActivities.primary.description': ['Company.primarySsicDescription', 'Business activities', 'activities editor'],
  'ssicActivities.secondary.code': ['Company.secondarySsicCode', 'Business activities', 'activities editor'],
  'ssicActivities.secondary.description': ['Company.secondarySsicDescription', 'Business activities', 'activities editor'],
  'registeredAddress.block': ['CompanyAddress.block', 'Addresses', 'addresses editor'],
  'registeredAddress.streetName': ['CompanyAddress.streetName', 'Addresses', 'addresses editor'],
  'registeredAddress.level': ['CompanyAddress.level', 'Addresses', 'addresses editor'],
  'registeredAddress.unit': ['CompanyAddress.unit', 'Addresses', 'addresses editor'],
  'registeredAddress.buildingName': ['CompanyAddress.buildingName', 'Addresses', 'addresses editor'],
  'registeredAddress.postalCode': ['CompanyAddress.postalCode', 'Addresses', 'addresses editor'],
  'registeredAddress.country': ['CompanyAddress.country', 'Addresses', 'addresses editor'],
  'registeredAddress.effectiveFrom': ['CompanyAddress.effectiveFrom', 'Addresses', 'addresses editor'],
  'mailingAddress.block': ['CompanyAddress.block', 'Addresses', 'addresses editor'],
  'mailingAddress.streetName': ['CompanyAddress.streetName', 'Addresses', 'addresses editor'],
  'mailingAddress.level': ['CompanyAddress.level', 'Addresses', 'addresses editor'],
  'mailingAddress.unit': ['CompanyAddress.unit', 'Addresses', 'addresses editor'],
  'mailingAddress.buildingName': ['CompanyAddress.buildingName', 'Addresses', 'addresses editor'],
  'mailingAddress.postalCode': ['CompanyAddress.postalCode', 'Addresses', 'addresses editor'],
  'mailingAddress.country': ['CompanyAddress.country', 'Addresses', 'addresses editor'],
  'paidUpCapital.amount': ['Company.paidUpCapitalAmount', 'Capital', 'capital editor'],
  'paidUpCapital.currency': ['Company.paidUpCapitalCurrency', 'Capital', 'capital editor'],
  'issuedCapital.amount': ['Company.issuedCapitalAmount', 'Capital', 'capital editor'],
  'issuedCapital.currency': ['Company.issuedCapitalCurrency', 'Capital', 'capital editor'],
  'shareCapital[].shareClass': ['ShareCapital.shareClass', 'Capital breakdown', 'capital editor'],
  'shareCapital[].currency': ['ShareCapital.currency', 'Capital breakdown', 'capital editor'],
  'shareCapital[].numberOfShares': ['ShareCapital.numberOfShares', 'Capital breakdown', 'capital editor'],
  'shareCapital[].parValue': ['ShareCapital.parValue', 'Capital breakdown', 'capital editor'],
  'shareCapital[].totalValue': ['ShareCapital.totalValue', 'Capital breakdown', 'capital editor'],
  'shareCapital[].isPaidUp': ['ShareCapital.isPaidUp', 'Capital breakdown', 'capital editor'],
  'shareCapital[].isTreasury': ['ShareCapital.isTreasury', 'Capital breakdown', 'capital editor'],
  'treasuryShares.numberOfShares': ['ShareCapital.numberOfShares', 'Capital breakdown', 'capital editor'],
  'treasuryShares.currency': ['ShareCapital.currency', 'Capital breakdown', 'capital editor'],
  homeCurrency: ['Company.homeCurrency', 'Compliance', 'compliance editor'],
  'officers[].name': ['CompanyOfficer.name', 'Officers', 'officers editor'],
  'officers[].role': ['CompanyOfficer.role', 'Officers badge', 'officers editor'],
  'officers[].identificationType': ['CompanyOfficer.identificationType', 'Officers details', 'officers editor'],
  'officers[].identificationNumber': ['CompanyOfficer.identificationNumber', 'Officers details', 'officers editor'],
  'officers[].nationality': ['CompanyOfficer.nationality', 'Officers details', 'officers editor'],
  'officers[].address': ['CompanyOfficer.address', 'Officers details', 'officers editor'],
  'officers[].appointmentDate': ['CompanyOfficer.appointmentDate', 'Officers details', 'officers editor'],
  'officers[].cessationDate': ['CompanyOfficer.cessationDate', 'Show ceased', 'officers editor'],
  'shareholders[].name': ['CompanyShareholder.name', 'Shareholders', 'shareholders editor'],
  'shareholders[].type': ['CompanyShareholder.shareholderType', 'Shareholder type badge', 'shareholders editor'],
  'shareholders[].identificationType': ['CompanyShareholder.identificationType', 'Shareholder details', 'shareholders editor'],
  'shareholders[].identificationNumber': ['CompanyShareholder.identificationNumber', 'Shareholder details', 'shareholders editor'],
  'shareholders[].nationality': ['CompanyShareholder.nationality', 'Shareholder details', 'shareholders editor'],
  'shareholders[].placeOfOrigin': ['CompanyShareholder.placeOfOrigin', 'Shareholder details', 'shareholders editor'],
  'shareholders[].address': ['CompanyShareholder.address', 'Shareholder details', 'shareholders editor'],
  'shareholders[].shareClass': ['CompanyShareholder.shareClass', 'Shareholding summary', 'shareholders editor'],
  'shareholders[].numberOfShares': ['CompanyShareholder.numberOfShares', 'Shareholding summary', 'shareholders editor'],
  'shareholders[].percentageHeld': ['CompanyShareholder.percentageHeld', 'Shareholder heading', 'shareholders editor'],
  'shareholders[].currency': ['CompanyShareholder.currency', 'Shareholding summary', 'shareholders editor'],
  'auditor.name': ['CompanyAuditor.name', 'Auditor details', 'additional editor'],
  'auditor.address': ['CompanyAuditor.address', 'Auditor details', 'additional editor'],
  'auditor.appointmentDate': ['CompanyAuditor.appointmentDate', 'Auditor details', 'additional editor'],
  'financialYear.endDay': ['Company.financialYearEndDay', 'Compliance', 'compliance editor'],
  'financialYear.endMonth': ['Company.financialYearEndMonth', 'Compliance', 'compliance editor'],
  'compliance.lastAgmDate': ['Company.lastAgmDate', 'Compliance', 'compliance editor'],
  'compliance.lastArFiledDate': ['Company.lastArFiledDate', 'Compliance', 'compliance editor'],
  'compliance.accountsDueDate': ['Company.accountsDueDate', 'Compliance', 'compliance editor'],
  'compliance.fyeAsAtLastAr': ['Company.fyeAsAtLastAr', 'Compliance', 'compliance editor'],
  'charges[].chargeNumber': ['CompanyCharge.chargeNumber', 'Charges', 'charges editor'],
  'charges[].chargeType': ['CompanyCharge.chargeType', 'Charges', 'charges editor'],
  'charges[].description': ['CompanyCharge.description', 'Charges', 'charges editor'],
  'charges[].chargeHolderName': ['CompanyCharge.chargeHolderName', 'Charges', 'charges editor'],
  'charges[].amountSecured': ['CompanyCharge.amountSecured', 'Charges', 'charges editor'],
  'charges[].amountSecuredText': ['CompanyCharge.amountSecuredText', 'Charges', 'charges editor'],
  'charges[].currency': ['CompanyCharge.currency', 'Charges', 'charges editor'],
  'charges[].registrationDate': ['CompanyCharge.registrationDate', 'Charges', 'charges editor'],
  'charges[].dischargeDate': ['CompanyCharge.dischargeDate', 'Show discharged', 'charges editor'],
} as const;

const workflowOrDocumentOnly = {
  'officers[].contactResolution': ['CompanyOfficer.contactId', 'Document.extractedData'],
  'shareholders[].contactResolution': ['CompanyShareholder.contactId', 'Document.extractedData'],
  'documentMetadata.receiptNo': ['DocumentRevision.documentNumber'],
  'documentMetadata.receiptDate': ['DocumentRevision.documentDate'],
} as const;
```

The test imports the canonical review path list and fails if a path is missing from the mapping. Receipt metadata and contact-resolution decisions are asserted as documented exceptions with their document/link outcomes.

- [ ] **Step 2: Run the exact focused test set**

Run:

```powershell
npm run test:run -- __tests__/lib/company-profile-sections.test.ts __tests__/lib/bizfile-review-validation.test.ts __tests__/services/bizfile-company-sync.test.ts __tests__/services/company-profile-sections.test.ts __tests__/api/bizfile-confirm-route.test.ts __tests__/api/company-profile-section-route.test.ts __tests__/components/bizfile-review-sections.test.tsx __tests__/components/company-profile-sections.test.tsx __tests__/components/company-edit-workspace.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run focused static verification**

Run: `npx eslint src/services/bizfile src/services/company src/lib/company-profile-sections.ts src/lib/validations/company-profile.ts src/components/companies/company-detail src/components/companies/company-edit 'src/app/api/companies/[id]/profile' 'src/app/(dashboard)/companies/[id]'`

Run: `npx tsc --noEmit --pretty false`

Expected: both exit 0. TypeScript is repository-wide because the project has no scoped type-check command; do not run `npm run build` or the full test suite.

- [ ] **Step 4: Review the final diff against the approved specification**

Confirm all field mappings, approved visual order/copy, exception handling, no-backfill migration, tenant/RBAC boundaries, audit/source links, and absence of unrelated refactors. Run `git diff --check`.

- [ ] **Step 5: Commit any verification-only corrections**

```powershell
git --literal-pathspecs add -- src/services/bizfile/company-sync.ts src/services/bizfile/processor.ts src/services/bizfile/diff.ts src/services/company/profile-sections.ts src/services/company.service.ts src/lib/company-profile-sections.ts src/lib/validations/company-profile.ts src/components/companies/company-detail src/components/companies/company-edit 'src/app/api/companies/[id]/profile' __tests__/lib/company-profile-sections.test.ts __tests__/services/bizfile-company-sync.test.ts __tests__/services/company-profile-sections.test.ts __tests__/api/company-profile-section-route.test.ts __tests__/components/company-profile-sections.test.tsx __tests__/components/company-edit-workspace.test.tsx
git commit -m "test(companies): verify complete Bizfile profile coverage"
```

If verification required no corrections, do not create an empty commit.
