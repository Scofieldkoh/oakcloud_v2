# Services Administration Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move service catalog management into Administration and add the company display-alias and service-family color foundations used by all later service views.

**Architecture:** Extend the existing `Company` and `ServiceFamily` models additively, keep the current catalog service as the single write path, and replace document permissions on catalog mutations with a shared workspace-admin guard. Relocate the existing catalog components without duplicating them, add a dedicated Administration page, and preserve the former Document Generation URL with a redirect.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Prisma 7/PostgreSQL, Zod, React Query, Vitest, Testing Library, existing Oakcloud UI components.

**Spec:** `docs/superpowers/specs/2026-08-17-services-administration-deadlines-billing-design.md`

**Mockups:** `docs/superpowers/mockups/2026-08-17-services-workspace-mockups.md` — implement view 5 and the alias/color portions shared by views 1–7.

## Global Constraints

- Read the approved specification, mockup index, `docs/guides/DESIGN_GUIDELINE.md`, `docs/guides/SERVICE_PATTERNS.md`, and `docs/guides/RBAC_GUIDELINE.md` before editing.
- Treat existing uncommitted work as user-owned; stage only files named by the current task.
- Keep migrations additive. Do not remove the existing service catalog, client-service, SOW partial, or document-template data.
- Administration mutations require `session.isSuperAdmin || session.isWorkspaceAdmin` and an explicitly resolved workspace.
- Company alias is optional, at most 40 characters, and must never be overwritten by BizFile when the review did not supply it.
- Missing alias display uses meaningful legal-name initials; `Oaktree Accounting & Corporate Solution Pte. Ltd.` must produce `OACS`.
- Family color is stored as uppercase `#RRGGBB`; UI meaning must also be available in text.
- Do not add deadline-rule, occurrence, reconciliation, or billing models in this plan.
- Use test-driven development and make the listed commit after every task passes.

---

## File and responsibility map

### New files

- `prisma/migrations/20260817090000_services_admin_foundation/migration.sql` — additive alias/color columns, constraint, and deterministic color backfill.
- `src/lib/company-display-label.ts` — alias normalization and legal-name initial generation.
- `src/lib/service-administration-auth.ts` — reusable Tenant Admin/Super Admin guard.
- `src/app/(dashboard)/admin/services/page.tsx` — Administration route entry.
- `src/components/services/admin/services-admin-page.tsx` — administration page header and catalog surface.
- `src/components/services/admin/catalog/service-catalog-panel.tsx` — relocated catalog panel.
- `src/components/services/admin/catalog/service-family-form.tsx` — relocated family form with color input.
- `src/components/services/admin/catalog/service-variant-form.tsx` — relocated variant form.
- `__tests__/lib/company-display-label.test.ts` — alias/fallback behavior.
- `__tests__/services/services-admin-foundation-schema.test.ts` — Prisma/migration contract.
- `__tests__/lib/service-administration-auth.test.ts` — role guard.
- `__tests__/components/services-admin-page.test.tsx` — page permissions and composition.
- `__tests__/browser/services-admin.browser.test.tsx` — visual-structure and responsive behavior.

### Modified files

- `prisma/schema.prisma` — `Company.displayAlias` and `ServiceFamily.displayColor`.
- `src/lib/validations/company.ts` — alias on create/update.
- `src/lib/validations/company-profile.ts` — alias in the identity section.
- `src/services/company/profile-sections.ts` — identity mapping and update.
- `src/services/company.service.ts` — create/search/detail serialization.
- `src/services/company/types.ts` — Company DTO alias.
- `src/components/companies/company-edit/company-create-workspace.tsx` — empty alias field.
- `src/components/companies/company-edit/company-edit-section.tsx` — generic identity editor label behavior.
- `src/components/companies/company-detail/company-profile-sections.tsx` — alias display.
- `src/services/bizfile/types.ts` — review-only optional alias.
- `src/lib/validations/bizfile-review.ts` — optional alias validation.
- `src/components/companies/bizfile-review/bizfile-review-sections.tsx` — alias prompt.
- `src/services/bizfile/company-sync.ts` — persist supplied alias and preserve omitted alias.
- `src/lib/validations/service-catalog.ts` — family color validation/default.
- `src/services/service-catalog/types.ts` — family color DTO.
- `src/services/service-catalog/service.ts` — color mapping and audited writes.
- `src/app/api/service-catalog/route.ts` — admin list authorization while retaining company-scoped selectable reads elsewhere.
- `src/app/api/service-catalog/families/route.ts` — admin guard.
- `src/app/api/service-catalog/families/[id]/route.ts` — admin guard.
- `src/app/api/service-catalog/variants/route.ts` — admin guard.
- `src/app/api/service-catalog/variants/[id]/route.ts` — admin guard.
- `src/hooks/use-service-catalog.ts` — relocated DTO/color payloads.
- `src/components/ui/sidebar.tsx` — Administration → Services navigation.
- `src/app/(dashboard)/template-partials/page.tsx` — remove Services tab and redirect legacy tab URLs.
- Existing service-catalog, company, and BizFile tests — extend fixtures with alias/color.
- `docs/guides/SERVICE_PATTERNS.md` — new administration location and family-color contract.

## Shared interfaces produced by this plan

```ts
// src/lib/company-display-label.ts
export function normalizeCompanyAlias(value: string | null | undefined): string | null;
export function deriveCompanyInitials(legalName: string): string;
export function getCompanyDisplayLabel(company: {
  name: string;
  displayAlias?: string | null;
}): string;

// src/lib/service-administration-auth.ts
import type { SessionUser } from '@/lib/auth';
export function requireServiceAdministrator(session: SessionUser): void;

// src/services/service-catalog/types.ts
export interface ServiceFamilyDto {
  id: string;
  code: string;
  name: string;
  description: string | null;
  displayColor: string;
  displayOrder: number;
  isActive: boolean;
  variants: ServiceVariantDto[];
}
```

Plan 2 consumes all three interfaces. Do not rename them without updating the approved specification and the later plans.

---

### Task 1: Add the alias and family-color schema contract

**Files:**
- Create: `prisma/migrations/20260817090000_services_admin_foundation/migration.sql`
- Create: `__tests__/services/services-admin-foundation-schema.test.ts`
- Modify: `prisma/schema.prisma` (`Company` and `ServiceFamily` models)

**Interfaces:**
- Consumes: Existing Prisma `Company` and `ServiceFamily` models.
- Produces: nullable `Company.displayAlias` and required `ServiceFamily.displayColor`.

- [ ] **Step 1: Write the failing schema test**

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('services administration foundation schema', () => {
  const schema = readFileSync(resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8');
  const migration = readFileSync(
    resolve(process.cwd(), 'prisma/migrations/20260817090000_services_admin_foundation/migration.sql'),
    'utf8',
  );

  it('adds optional company aliases and required family colors', () => {
    expect(schema).toContain('displayAlias');
    expect(schema).toContain('@map("display_alias") @db.VarChar(40)');
    expect(schema).toContain('displayColor');
    expect(schema).toContain('@default("#2F6F5E")');
    expect(migration).toContain('service_families_display_color_hex');
    expect(migration).toContain('UPDATE "service_families"');
  });
});
```

- [ ] **Step 2: Run the test and verify the missing migration failure**

Run: `npm.cmd run test:run -- __tests__/services/services-admin-foundation-schema.test.ts`

Expected: FAIL because the migration file and fields do not exist.

- [ ] **Step 3: Add the Prisma fields and migration**

Add these model fields:

```prisma
model Company {
  // existing fields
  displayAlias String? @map("display_alias") @db.VarChar(40)
}

model ServiceFamily {
  // existing fields
  displayColor String @default("#2F6F5E") @map("display_color") @db.VarChar(7)
}
```

Create the migration with additive SQL and a stable per-tenant palette assignment:

```sql
ALTER TABLE "companies" ADD COLUMN "display_alias" VARCHAR(40);

ALTER TABLE "service_families"
  ADD COLUMN "display_color" VARCHAR(7) NOT NULL DEFAULT '#2F6F5E';

WITH ranked AS (
  SELECT "id",
         row_number() OVER (
           PARTITION BY "tenant_id"
           ORDER BY "display_order", "name", "id"
         ) - 1 AS color_index
  FROM "service_families"
)
UPDATE "service_families" AS family
SET "display_color" = (ARRAY[
  '#2F6F5E', '#3F6DA8', '#8A5AA5', '#B0653C',
  '#467A43', '#9A6A18', '#9B4D67', '#4E7180'
])[1 + (ranked.color_index % 8)]
FROM ranked
WHERE ranked."id" = family."id";

ALTER TABLE "service_families"
  ADD CONSTRAINT "service_families_display_color_hex"
  CHECK ("display_color" ~ '^#[0-9A-F]{6}$');
```

- [ ] **Step 4: Generate Prisma and rerun the schema test**

Run: `npm.cmd run db:generate`

Expected: Prisma client generation succeeds.

Run: `npm.cmd run test:run -- __tests__/services/services-admin-foundation-schema.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the schema foundation**

```bash
git add prisma/schema.prisma prisma/migrations/20260817090000_services_admin_foundation/migration.sql __tests__/services/services-admin-foundation-schema.test.ts src/generated/prisma
git commit -m "feat: add services administration schema foundation"
```

---

### Task 2: Implement company display-label rules

**Files:**
- Create: `src/lib/company-display-label.ts`
- Create: `__tests__/lib/company-display-label.test.ts`
- Modify: `src/lib/validations/company.ts`
- Modify: `src/lib/validations/company-profile.ts`
- Modify: `src/services/company/types.ts`
- Modify: `src/services/company/profile-sections.ts`
- Modify: `src/services/company.service.ts`
- Test: `__tests__/services/company.service.test.ts`
- Test: `__tests__/services/company-profile-sections.test.ts`

**Interfaces:**
- Consumes: `Company.name` and optional stored alias.
- Produces: `normalizeCompanyAlias`, `deriveCompanyInitials`, and `getCompanyDisplayLabel` exactly as declared above.

- [ ] **Step 1: Write failing helper and validation tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  deriveCompanyInitials,
  getCompanyDisplayLabel,
  normalizeCompanyAlias,
} from '@/lib/company-display-label';
import { createCompanySchema } from '@/lib/validations/company';

describe('company display labels', () => {
  it('uses every meaningful initial and removes legal suffixes', () => {
    expect(deriveCompanyInitials('Oaktree Accounting & Corporate Solution Pte. Ltd.')).toBe('OACS');
  });

  it('prefers a trimmed stored alias', () => {
    expect(getCompanyDisplayLabel({ name: 'Long Legal Name Pte Ltd', displayAlias: ' LLN ' })).toBe('LLN');
  });

  it('normalizes blank aliases to null', () => {
    expect(normalizeCompanyAlias('   ')).toBeNull();
  });

  it('rejects aliases longer than forty characters', () => {
    expect(() => createCompanySchema.parse({
      uen: '202400001A',
      name: 'Example Pte Ltd',
      displayAlias: 'X'.repeat(41),
    })).toThrow();
  });
});
```

- [ ] **Step 2: Run the focused tests and confirm the missing module failure**

Run: `npm.cmd run test:run -- __tests__/lib/company-display-label.test.ts`

Expected: FAIL because `@/lib/company-display-label` does not exist.

- [ ] **Step 3: Implement normalization and initial derivation**

```ts
const LEGAL_SUFFIXES = new Set([
  'pte', 'ltd', 'limited', 'private', 'llp', 'lp', 'inc', 'llc', 'corp', 'corporation',
]);

export function normalizeCompanyAlias(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized || null;
}

export function deriveCompanyInitials(legalName: string): string {
  const tokens = legalName
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter(Boolean);
  while (tokens.length > 0 && LEGAL_SUFFIXES.has(tokens[tokens.length - 1]!.toLocaleLowerCase('en-SG'))) {
    tokens.pop();
  }
  const initials = tokens
    .filter((token) => token !== '&')
    .map((token) => Array.from(token)[0]?.toLocaleUpperCase('en-SG') ?? '')
    .join('');
  return initials || Array.from(legalName.trim())[0]?.toLocaleUpperCase('en-SG') || '?';
}

export function getCompanyDisplayLabel(company: { name: string; displayAlias?: string | null }): string {
  return normalizeCompanyAlias(company.displayAlias) ?? deriveCompanyInitials(company.name);
}
```

Add `displayAlias: z.string().trim().max(40).nullable().optional()` to company create/update and identity-section schemas. Include the value in Company DTO selects, identity-section hashes, mutations, create, detail, and search serializers. Do not derive and persist a value in these services.

- [ ] **Step 4: Add service assertions for create/detail/profile updates**

```ts
expect(prismaMock.company.create).toHaveBeenCalledWith(expect.objectContaining({
  data: expect.objectContaining({ displayAlias: 'OAK' }),
}));

expect(prismaMock.company.update).toHaveBeenCalledWith(expect.objectContaining({
  data: expect.objectContaining({ displayAlias: null }),
}));
```

- [ ] **Step 5: Run the company helper and service tests**

Run: `npm.cmd run test:run -- __tests__/lib/company-display-label.test.ts __tests__/services/company.service.test.ts __tests__/services/company-profile-sections.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the company display-label domain**

```bash
git add src/lib/company-display-label.ts src/lib/validations/company.ts src/lib/validations/company-profile.ts src/services/company/types.ts src/services/company/profile-sections.ts src/services/company.service.ts __tests__/lib/company-display-label.test.ts __tests__/services/company.service.test.ts __tests__/services/company-profile-sections.test.ts
git commit -m "feat: add company service display aliases"
```

---

### Task 3: Add alias prompts to company creation, detail, and BizFile review

**Files:**
- Modify: `src/components/companies/company-edit/company-create-workspace.tsx`
- Modify: `src/components/companies/company-edit/company-edit-section.tsx`
- Modify: `src/components/companies/company-detail/company-profile-sections.tsx`
- Modify: `src/services/bizfile/types.ts`
- Modify: `src/lib/validations/bizfile-review.ts`
- Modify: `src/components/companies/bizfile-review/bizfile-review-sections.tsx`
- Modify: `src/services/bizfile/company-sync.ts`
- Test: `__tests__/components/company-create-workspace.test.tsx`
- Test: `__tests__/components/company-profile-sections.test.tsx`
- Test: `__tests__/services/bizfile-company-sync.test.ts`

**Interfaces:**
- Consumes: alias validation and helper from Task 2.
- Produces: optional alias entry in all three company workflows; omitted BizFile aliases preserve the stored value.

- [ ] **Step 1: Write failing UI and BizFile preservation tests**

```tsx
it('prompts for an optional service display alias during company creation', () => {
  render(<CompanyCreateWorkspace onSubmit={vi.fn()} />);
  expect(screen.getByLabelText('Service display alias')).toHaveAttribute('maxlength', '40');
});
```

```ts
it('does not clear an existing alias when BizFile omits it', async () => {
  await syncCompanyFromBizfileInTransaction({
    data: { ...data, entityDetails: { ...data.entityDetails, displayAlias: undefined } },
    documentId: 'doc-1', tenantId: 'tenant-1', userId: 'user-1', existingCompanyId: 'company-1',
  }, tx as never);
  expect(tx.company.update).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.not.objectContaining({ displayAlias: expect.anything() }),
  }));
});
```

- [ ] **Step 2: Run the UI/BizFile tests and verify failure**

Run: `npm.cmd run test:run -- __tests__/components/company-create-workspace.test.tsx __tests__/components/company-profile-sections.test.tsx __tests__/services/bizfile-company-sync.test.ts`

Expected: FAIL because the field is not rendered or mapped.

- [ ] **Step 3: Add the optional alias to the identity editors**

Extend the empty identity value:

```ts
identity: {
  uen: '',
  name: '',
  displayAlias: null,
  entityType: 'PRIVATE_LIMITED',
  status: 'LIVE',
  statusDate: null,
  incorporationDate: null,
},
```

Map the `displayAlias` field label to `Service display alias`, helper text to `Shown on service calendars; leave blank to use company initials`, and `maxLength` to 40 in the generic company profile editor. Display both the alias and `getCompanyDisplayLabel(company)` in Company detail without adding an alias-behavior callout card.

- [ ] **Step 4: Extend BizFile review data without changing extraction prompts**

Add the optional review-only property:

```ts
export interface ExtractedBizFileData {
  entityDetails: {
    uen: string;
    name: string;
    displayAlias?: string | null;
    // existing fields remain unchanged
  };
}
```

Render a text field in the BizFile Identity section after Company Name. Do not add `displayAlias` to the OCR/vision extraction prompt; it is user-maintained data.

Use omission-aware persistence:

```ts
const aliasUpdate = entityDetails.displayAlias === undefined
  ? {}
  : { displayAlias: normalizeCompanyAlias(entityDetails.displayAlias) };

const createAlias = normalizeCompanyAlias(entityDetails.displayAlias);
```

Use `createAlias` on new Company creation and spread `aliasUpdate` only into updates.

- [ ] **Step 5: Rerun UI and BizFile tests**

Run: `npm.cmd run test:run -- __tests__/components/company-create-workspace.test.tsx __tests__/components/company-profile-sections.test.tsx __tests__/services/bizfile-company-sync.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the alias user workflows**

```bash
git add src/components/companies/company-edit/company-create-workspace.tsx src/components/companies/company-edit/company-edit-section.tsx src/components/companies/company-detail/company-profile-sections.tsx src/services/bizfile/types.ts src/lib/validations/bizfile-review.ts src/components/companies/bizfile-review/bizfile-review-sections.tsx src/services/bizfile/company-sync.ts __tests__/components/company-create-workspace.test.tsx __tests__/components/company-profile-sections.test.tsx __tests__/services/bizfile-company-sync.test.ts
git commit -m "feat: collect company display aliases"
```

---

### Task 4: Add family colors to catalog validation, services, hooks, and forms

**Files:**
- Modify: `src/lib/validations/service-catalog.ts`
- Modify: `src/services/service-catalog/types.ts`
- Modify: `src/services/service-catalog/service.ts`
- Modify: `src/hooks/use-service-catalog.ts`
- Modify: `src/components/documents/service-catalog/service-family-form.tsx`
- Test: `__tests__/lib/service-catalog-validation.test.ts`
- Test: `__tests__/services/service-catalog.service.test.ts`
- Test: `__tests__/components/service-catalog.test.tsx`

**Interfaces:**
- Consumes: required `ServiceFamily.displayColor` from Task 1.
- Produces: uppercase color in `ServiceFamilyDto` and create/update payloads.

- [ ] **Step 1: Write failing color validation and mapping tests**

```ts
it('normalizes family colors to uppercase hex', () => {
  expect(createServiceFamilySchema.parse({
    code: 'PAYROLL',
    name: 'Payroll',
    displayColor: '#3f6da8',
  }).displayColor).toBe('#3F6DA8');
});

it('rejects non-hex family colors', () => {
  expect(() => updateServiceFamilySchema.parse({ displayColor: 'blue' })).toThrow();
});
```

```ts
expect(result.families[0]).toMatchObject({ displayColor: '#3F6DA8' });
```

- [ ] **Step 2: Run catalog validation/service tests and verify failure**

Run: `npm.cmd run test:run -- __tests__/lib/service-catalog-validation.test.ts __tests__/services/service-catalog.service.test.ts`

Expected: FAIL because color is absent from schemas and DTOs.

- [ ] **Step 3: Implement the catalog color contract**

```ts
export const serviceFamilyColorSchema = z.string()
  .trim()
  .regex(/^#[0-9A-Fa-f]{6}$/, 'Choose a six-digit hex color')
  .transform((value) => value.toUpperCase());
```

Use `serviceFamilyColorSchema.default('#2F6F5E')` on create and optional on update. Include `displayColor` in `toFamilyDto`, create/update audit changes, hook payload types, and the `ServiceFamilyDto` interface.

- [ ] **Step 4: Add an accessible color input to the family form**

```tsx
<FormInput
  id="service-family-color"
  label="Display color"
  type="color"
  value={displayColor}
  onChange={(event) => setDisplayColor(event.target.value.toUpperCase())}
  helperText="Used for family badges, filters, table accents, and calendar events."
/>
```

Render the family name beside the swatch so the color is never the only label. Submit `displayColor` for both create and update.

- [ ] **Step 5: Run catalog unit and component tests**

Run: `npm.cmd run test:run -- __tests__/lib/service-catalog-validation.test.ts __tests__/services/service-catalog.service.test.ts __tests__/components/service-catalog.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit family colors**

```bash
git add src/lib/validations/service-catalog.ts src/services/service-catalog/types.ts src/services/service-catalog/service.ts src/hooks/use-service-catalog.ts src/components/documents/service-catalog/service-family-form.tsx __tests__/lib/service-catalog-validation.test.ts __tests__/services/service-catalog.service.test.ts __tests__/components/service-catalog.test.tsx
git commit -m "feat: configure service family colors"
```

---

### Task 5: Centralize service-administration authorization

**Files:**
- Create: `src/lib/service-administration-auth.ts`
- Create: `__tests__/lib/service-administration-auth.test.ts`
- Modify: `src/app/api/service-catalog/route.ts`
- Modify: `src/app/api/service-catalog/families/route.ts`
- Modify: `src/app/api/service-catalog/families/[id]/route.ts`
- Modify: `src/app/api/service-catalog/variants/route.ts`
- Modify: `src/app/api/service-catalog/variants/[id]/route.ts`
- Test: `__tests__/api/service-catalog-routes.test.ts`

**Interfaces:**
- Consumes: authenticated `SessionUser` and `resolveWorkspaceId`/`requireSessionWorkspaceId`.
- Produces: `requireServiceAdministrator(session): void` for Plans 2 and 3.

- [ ] **Step 1: Write the failing role-guard test**

```ts
import { describe, expect, it } from 'vitest';
import { requireServiceAdministrator } from '@/lib/service-administration-auth';

const session = { isSuperAdmin: false, isWorkspaceAdmin: false } as never;

describe('requireServiceAdministrator', () => {
  it('rejects non-admin users', () => {
    expect(() => requireServiceAdministrator(session)).toThrow('Service administration requires');
  });

  it.each([
    { isSuperAdmin: true, isWorkspaceAdmin: false },
    { isSuperAdmin: false, isWorkspaceAdmin: true },
  ])('accepts an administrative session', (roles) => {
    expect(() => requireServiceAdministrator({ ...session, ...roles })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the guard test and confirm the missing module failure**

Run: `npm.cmd run test:run -- __tests__/lib/service-administration-auth.test.ts`

Expected: FAIL because the guard does not exist.

- [ ] **Step 3: Implement the guard and use it in catalog administration routes**

```ts
import type { SessionUser } from '@/lib/auth';
import { ForbiddenError } from '@/lib/errors';

export function requireServiceAdministrator(session: SessionUser): void {
  if (!session.isSuperAdmin && !session.isWorkspaceAdmin) {
    throw new ForbiddenError('Service administration requires Tenant Admin access');
  }
}
```

For paginated catalog reads, family/variant create/update/archive, and direct variant reads, call the guard immediately after `requireAuth()`. Remove `document:create/update/delete` checks from those administration paths. Continue resolving the active workspace on the server. The existing `selectable=true` branch remains protected by `document:read` because Document Generation still consumes it; operational company forms continue to use the company-scoped catalog-options route.

Do not weaken `GET /api/companies/:companyId/services/catalog-options`; it continues to require `company:read` for the specified company and remains the operational selector API.

- [ ] **Step 4: Rewrite route assertions around the admin guard**

```ts
expect(mocks.requireServiceAdministrator).toHaveBeenCalledWith(session);
expect(mocks.requirePermission).not.toHaveBeenCalledWith(session, 'document', 'update');
```

Add a non-admin response test expecting HTTP 403 and no service call.

- [ ] **Step 5: Run authorization and route tests**

Run: `npm.cmd run test:run -- __tests__/lib/service-administration-auth.test.ts __tests__/api/service-catalog-routes.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the authorization boundary**

```bash
git add src/lib/service-administration-auth.ts src/app/api/service-catalog/route.ts src/app/api/service-catalog/families/route.ts src/app/api/service-catalog/families/[id]/route.ts src/app/api/service-catalog/variants/route.ts src/app/api/service-catalog/variants/[id]/route.ts __tests__/lib/service-administration-auth.test.ts __tests__/api/service-catalog-routes.test.ts
git commit -m "refactor: authorize service catalog as administration"
```

---

### Task 6: Relocate catalog components and build Administration → Services

**Files:**
- Move: `src/components/documents/service-catalog/service-catalog-panel.tsx` → `src/components/services/admin/catalog/service-catalog-panel.tsx`
- Move: `src/components/documents/service-catalog/service-family-form.tsx` → `src/components/services/admin/catalog/service-family-form.tsx`
- Move: `src/components/documents/service-catalog/service-variant-form.tsx` → `src/components/services/admin/catalog/service-variant-form.tsx`
- Create: `src/components/services/admin/services-admin-page.tsx`
- Create: `src/app/(dashboard)/admin/services/page.tsx`
- Create: `__tests__/components/services-admin-page.test.tsx`
- Modify: `__tests__/components/service-catalog.test.tsx`

**Interfaces:**
- Consumes: existing catalog hooks and Task 5 admin role behavior.
- Produces: `/admin/services` showing mockup view 5 with one active `Service catalog` tab; Plan 2 expands the tab set.

- [ ] **Step 1: Write the failing administration-page test**

```tsx
it('renders catalog administration for workspace admins', () => {
  sessionMock.mockReturnValue({
    data: { isSuperAdmin: false, isWorkspaceAdmin: true },
    isLoading: false,
  });
  render(<ServicesAdminPage />);
  expect(screen.getByRole('heading', { name: 'Services administration' })).toBeVisible();
  expect(screen.getByRole('tab', { name: 'Service catalog' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('heading', { name: 'Service catalog' })).toBeVisible();
});

it('does not render catalog controls for non-admin users', () => {
  sessionMock.mockReturnValue({
    data: { isSuperAdmin: false, isWorkspaceAdmin: false },
    isLoading: false,
  });
  render(<ServicesAdminPage />);
  expect(screen.getByText('Tenant Admin access is required')).toBeVisible();
});
```

- [ ] **Step 2: Run the component test and verify missing modules**

Run: `npm.cmd run test:run -- __tests__/components/services-admin-page.test.tsx`

Expected: FAIL because the page component does not exist.

- [ ] **Step 3: Move the catalog components and update imports**

Use `git mv` for the three files so history is retained. Change test and page imports to:

```ts
import { ServiceCatalogPanel } from '@/components/services/admin/catalog/service-catalog-panel';
```

No compatibility re-export remains under `components/documents`; a repository-wide `rg "documents/service-catalog" src __tests__` must return no results.

- [ ] **Step 4: Implement the page shell with approved spacing**

```tsx
export function ServicesAdminPage() {
  const { data: session, isLoading } = useSession();
  const workspaceId = useActiveWorkspaceId();
  const canAdminister = !!session && (session.isSuperAdmin || session.isWorkspaceAdmin);

  if (isLoading) {
    return <div role="status" className="p-6 text-sm text-text-secondary">Loading services administration…</div>;
  }
  if (!canAdminister) {
    return (
      <main className="p-4 sm:p-6">
        <div role="alert" className="rounded-lg border border-border-primary bg-background-secondary p-6">
          <h1 className="text-lg font-semibold text-text-primary">Services administration</h1>
          <p className="mt-2 text-sm text-text-secondary">Tenant Admin access is required.</p>
        </div>
      </main>
    );
  }
  if (!workspaceId) {
    return <div role="alert" className="p-6 text-sm text-text-secondary">Select a workspace to administer services.</div>;
  }

  return (
    <main className="p-4 sm:p-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl sm:text-2xl font-semibold text-text-primary">Services administration</h1>
        <p className="text-sm text-text-secondary">Manage service offerings and their presentation.</p>
      </header>
      <div role="tablist" aria-label="Services administration sections" className="flex gap-2 border-b border-border-primary">
        <button role="tab" aria-selected="true" className="px-3 py-2 text-sm border-b-2 border-oak-primary">Service catalog</button>
      </div>
      <section className="pt-1">
        <ServiceCatalogPanel workspaceId={workspaceId} canCreate canUpdate canDelete />
      </section>
    </main>
  );
}
```

The route entry only renders `<ServicesAdminPage />`.

- [ ] **Step 5: Run catalog and administration component tests**

Run: `npm.cmd run test:run -- __tests__/components/service-catalog.test.tsx __tests__/components/services-admin-page.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit the relocated administration page**

```bash
git add src/components/services/admin src/app/(dashboard)/admin/services/page.tsx __tests__/components/service-catalog.test.tsx __tests__/components/services-admin-page.test.tsx
git commit -m "feat: move service catalog into administration"
```

---

### Task 7: Add navigation and the legacy tab redirect

**Files:**
- Modify: `src/components/ui/sidebar.tsx`
- Modify: `src/app/(dashboard)/template-partials/page.tsx`
- Create: `__tests__/components/template-partials-services-redirect.test.tsx`
- Test: `__tests__/components/sidebar-task-destinations.test.tsx`

**Interfaces:**
- Consumes: `/admin/services` from Task 6.
- Produces: admin-only sidebar destination and `/template-partials?tab=services` redirect.

- [ ] **Step 1: Write failing navigation and redirect assertions**

```tsx
expect(screen.getByRole('link', { name: 'Services' })).toHaveAttribute('href', '/admin/services');
```

In `template-partials-services-redirect.test.tsx`, mock `useSearchParams()` with `tab=services`, expect `router.replace('/admin/services')`, and confirm there is no Services tab button.

- [ ] **Step 2: Run the focused navigation tests**

Run: `npm.cmd run test:run -- __tests__/components/sidebar-task-destinations.test.tsx __tests__/components/template-partials-services-redirect.test.tsx`

Expected: FAIL because the admin destination and redirect are absent.

- [ ] **Step 3: Add the admin navigation entry**

Add this item to `ungroupedAdminItems` and import `BriefcaseBusiness`:

```ts
{ name: 'Services', href: '/admin/services', icon: BriefcaseBusiness, adminOnly: true },
```

Do not add the operational primary Services link in this plan; Plan 2 adds it when the roster exists.

- [ ] **Step 4: Remove the Document Generation Services tab and redirect legacy URLs**

Narrow the tab type:

```ts
type TabType = 'templates' | 'partials';
```

At page initialization:

```ts
useEffect(() => {
  if (searchParams.get('tab') === 'services') {
    router.replace('/admin/services');
  }
}, [router, searchParams]);
```

Remove the `ServiceCatalogPanel` import, Services tab button, and Services panel branch. While the redirect effect is pending, render the existing loading treatment rather than the document tab content.

- [ ] **Step 5: Rerun navigation/template tests**

Run: `npm.cmd run test:run -- __tests__/components/sidebar-task-destinations.test.tsx __tests__/components/template-partials-services-redirect.test.tsx __tests__/components/service-catalog.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit navigation and compatibility behavior**

```bash
git add src/components/ui/sidebar.tsx src/app/(dashboard)/template-partials/page.tsx __tests__/components/sidebar-task-destinations.test.tsx __tests__/components/template-partials-services-redirect.test.tsx
git commit -m "feat: route service administration outside documents"
```

---

### Task 8: Verify responsive structure and document the new ownership

**Files:**
- Create: `__tests__/browser/services-admin.browser.test.tsx`
- Modify: `docs/guides/SERVICE_PATTERNS.md`
- Modify: `package.json` only if the repository requires a dedicated focused test script.

**Interfaces:**
- Consumes: completed Administration page and company/family contracts.
- Produces: browser-level regression coverage and updated repository guidance.

- [ ] **Step 1: Write the browser regression test**

```tsx
describe('Services administration browser surface', () => {
  it('separates the header, tab bar, and catalog surface and labels family colors', async () => {
    await render(<ServicesAdminPage />);
    const heading = page.getByRole('heading', { name: 'Services administration' });
    const tabs = page.getByRole('tablist', { name: 'Services administration sections' });
    const catalog = page.getByRole('heading', { name: 'Service catalog' });
    await expect.element(heading).toBeVisible();
    await expect.element(tabs).toBeVisible();
    await expect.element(catalog).toBeVisible();
    await expect.element(page.getByLabelText('Display color')).toBeVisible();
  });
});
```

- [ ] **Step 2: Run the browser test and fix only observed structural failures**

Run: `npm.cmd run test:browser -- __tests__/browser/services-admin.browser.test.tsx`

Expected: PASS after the Task 6 markup is wired to browser mocks.

- [ ] **Step 3: Update the service-pattern guide**

Document these exact ownership rules:

```markdown
## Service administration ownership

- Catalog mutations live at `/admin/services` and require Tenant Admin/Super Admin.
- Company-scoped client-service selection continues through the Company Services APIs.
- `ServiceFamily.displayColor` is the shared table/calendar/filter color.
- Company service labels use `getCompanyDisplayLabel`; callers must not reimplement initials.
- Deadline and billing schedules reuse the shared schedule engine introduced by the later plans.
```

- [ ] **Step 4: Run the plan-wide verification suite**

Run: `npm.cmd run db:generate`

Expected: PASS.

Run: `npm.cmd run test:run -- __tests__/services/services-admin-foundation-schema.test.ts __tests__/lib/company-display-label.test.ts __tests__/lib/service-administration-auth.test.ts __tests__/services/company.service.test.ts __tests__/services/company-profile-sections.test.ts __tests__/services/bizfile-company-sync.test.ts __tests__/services/service-catalog.service.test.ts __tests__/api/service-catalog-routes.test.ts __tests__/components/company-create-workspace.test.tsx __tests__/components/company-profile-sections.test.tsx __tests__/components/service-catalog.test.tsx __tests__/components/services-admin-page.test.tsx __tests__/components/sidebar-task-destinations.test.tsx __tests__/components/template-partials-services-redirect.test.tsx`

Expected: PASS.

Run: `npm.cmd run lint`

Expected: PASS with no new warnings in changed files.

Run: `npm.cmd run build`

Expected: PASS.

- [ ] **Step 5: Confirm repository references and migration safety**

Run: `rg -n "documents/service-catalog|tab=services" src __tests__ docs`

Expected: only the explicit legacy redirect/test and historical documentation references remain; there are no imports from the old component directory.

Run against an isolated database: `npm.cmd run db:migrate`

Expected: migration applies without dropping or rewriting existing service/client-service tables.

- [ ] **Step 6: Commit browser coverage and documentation**

```bash
git add __tests__/browser/services-admin.browser.test.tsx docs/guides/SERVICE_PATTERNS.md package.json
git commit -m "test: verify services administration foundation"
```

## Plan 1 completion gate

Before starting Plan 2, verify all of the following:

- `/admin/services` is usable by Tenant Admin/Super Admin and hidden from other roles.
- Catalog mutations no longer depend on document permissions.
- `/template-partials?tab=services` redirects to `/admin/services`.
- Company create, detail edit, and BizFile review collect the optional alias.
- Omitted BizFile aliases preserve existing values.
- Family colors round-trip through Prisma, API, hooks, and the admin form.
- The shared `getCompanyDisplayLabel` and `requireServiceAdministrator` interfaces exist exactly as specified.
- All focused tests, lint, build, and the additive migration pass.
