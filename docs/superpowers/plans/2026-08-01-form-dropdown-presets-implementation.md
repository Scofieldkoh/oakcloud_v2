# Form Dropdown Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add workspace-managed CSV dropdown presets, ship protected Countries/Nationalities/SSIC presets, support linked live updates and large embedded lists, and let respondents clear form dropdowns.

**Architecture:** Store each workspace preset as one JSON-backed Prisma record and reference it from dropdown fields through `optionPresetId`. Resolve linked options at authenticated and public form-read boundaries so existing forms receive preset updates without copying options into form-save payloads. Keep embedded custom options backward-compatible and bounded at 5,000 entries.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Prisma 7/PostgreSQL, Zod, TanStack Query, Vitest, Testing Library.

## Global Constraints

- Presets and APIs are workspace-scoped and use existing document read/update permissions.
- Countries, Nationalities, and SSIC cannot be deleted; only SSIC can be replaced by CSV.
- CSV files are UTF-8, at most 5 MB, and contain at most 5,000 valid options.
- CSV supports `label` or `value,label`; header matching is case-insensitive.
- Preset updates propagate to linked form fields immediately without rewriting historical submissions.
- Embedded dropdowns accept at most 5,000 options.
- Custom presets in use by active or archived forms cannot be deleted.
- Dropdown clearability changes only form fields of type `DROPDOWN`; timezone and phone selectors stay non-clearable.

---

## File Map

- `prisma/schema.prisma` and a new migration: preset persistence and dropdown relation.
- `src/lib/validations/form-option-preset.ts`: API payload schemas and shared limits.
- `src/lib/form-option-preset-csv.ts`: deterministic CSV parsing and validation.
- `src/lib/data/ssic-2025.json`: reviewed built-in SSIC `{ value, label }` data.
- `src/services/form-option-preset.service.ts`: tenant-aware CRUD, bootstrap, usage protection, and linked-option resolution.
- `src/app/api/forms/presets/route.ts` and `src/app/api/forms/presets/[id]/route.ts`: preset endpoints.
- `src/hooks/use-form-option-presets.ts`: query/mutation hooks and cache invalidation.
- `src/components/forms/preset-list-manager.tsx`: compact create/update/delete/import modal.
- `src/app/(dashboard)/forms/page.tsx`: Preset lists entry point.
- `src/components/forms/builder-utils.ts`, `field-general-tab.tsx`, and builder page: preset linkage in editor state and payloads.
- `src/lib/validations/form-builder.ts`, form services, and public page: larger limits, distinct option values/labels, resolution, and clearing.
- Existing files under `docs/reference/` and `docs/guides/`: API and user-facing behavior.

### Task 1: Add Preset Persistence and Field Linkage

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260801_form_option_presets/migration.sql`
- Test: `__tests__/services/form-option-preset-schema.test.ts`

**Interfaces:**
- Produces: Prisma model `FormOptionPreset`; nullable `FormField.optionPresetId`; workspace and form-field relations.

- [ ] **Step 1: Write the failing schema test**

```ts
it('stores workspace presets and links dropdown fields to them', () => {
  const schema = source('prisma/schema.prisma');
  expect(schema).toContain('model FormOptionPreset');
  expect(schema).toContain('optionPresetId String?');
  expect(schema).toContain('@@unique([tenantId, normalizedKey])');
  expect(schema).toContain('options Json');
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- --run __tests__/services/form-option-preset-schema.test.ts`
Expected: FAIL because `FormOptionPreset` and `optionPresetId` do not exist.

- [ ] **Step 3: Add the minimal schema and migration**

```prisma
model FormOptionPreset {
  id               String      @id @default(uuid())
  tenantId         String      @map("tenant_id")
  name             String
  normalizedKey    String      @map("normalized_key")
  builtInKey       String?     @map("built_in_key")
  isProtected      Boolean     @default(false) @map("is_protected")
  allowCsvReplace  Boolean     @default(true) @map("allow_csv_replace")
  options          Json
  optionCount      Int         @map("option_count")
  createdById      String?     @map("created_by_id")
  updatedById      String?     @map("updated_by_id")
  createdAt        DateTime    @default(now()) @map("created_at")
  updatedAt        DateTime    @updatedAt @map("updated_at")
  tenant           Workspace   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  fields           FormField[]

  @@unique([tenantId, normalizedKey])
  @@unique([tenantId, builtInKey])
  @@index([tenantId, updatedAt])
  @@map("form_option_presets")
}
```

Add `optionPresetId`, `optionPreset`, `formOptionPresets`, and matching SQL foreign keys/indexes. Use `ON DELETE RESTRICT` so data integrity backs the service usage check.

- [ ] **Step 4: Generate Prisma and run the schema test**

Run: `npm run db:generate && npm test -- --run __tests__/services/form-option-preset-schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```text
git add prisma/schema.prisma prisma/migrations/20260801_form_option_presets src/generated/prisma __tests__/services/form-option-preset-schema.test.ts
git commit -m "feat(forms): add option preset persistence"
```

### Task 2: Implement CSV Parsing and Preset Validation

**Files:**
- Create: `src/lib/validations/form-option-preset.ts`
- Create: `src/lib/form-option-preset-csv.ts`
- Test: `__tests__/lib/form-option-preset-csv.test.ts`

**Interfaces:**
- Produces: `FORM_PRESET_MAX_OPTIONS = 5000`, `FORM_PRESET_MAX_FILE_BYTES = 5_000_000`, `PresetOption`, `parsePresetCsv(csv: string): PresetCsvResult`, and Zod create/update schemas.

- [ ] **Step 1: Write failing parser tests**

```ts
expect(parsePresetCsv('label\nSingapore\nMalaysia')).toEqual({
  options: [{ value: 'Singapore', label: 'Singapore' }, { value: 'Malaysia', label: 'Malaysia' }],
  errors: [], totalRows: 2, rejectedRows: 0,
});
expect(parsePresetCsv('\uFEFFvalue,label\n01111,"Growing of leafy, fruit and root vegetables"').options).toEqual([
  { value: '01111', label: 'Growing of leafy, fruit and root vegetables' },
]);
expect(parsePresetCsv('value,label\n01,A\n01,B').errors[0]).toMatchObject({ row: 3, code: 'duplicate_value' });
```

Also cover escaped quotes, quoted newlines, missing headers, blank values/labels, more than 5,000 rows, and input larger than 5 MB.

- [ ] **Step 2: Run the parser test and verify RED**

Run: `npm test -- --run __tests__/lib/form-option-preset-csv.test.ts`
Expected: FAIL because the parser module is missing.

- [ ] **Step 3: Implement the parser and schemas**

```ts
export type PresetOption = { value: string; label: string };
export type PresetCsvError = { row: number; column?: string; code: string; message: string };
export type PresetCsvResult = {
  options: PresetOption[];
  errors: PresetCsvError[];
  totalRows: number;
  rejectedRows: number;
};
export function parsePresetCsv(csv: string): PresetCsvResult;
```

Implement a small RFC-4180 state machine that supports commas, CRLF/LF, escaped double quotes, and quoted newlines. Strip a leading BOM, normalize headers to lowercase, trim cell edges after parsing, and derive `value` from `label` only when the `value` header is absent.

- [ ] **Step 4: Run the parser tests and verify GREEN**

Run: `npm test -- --run __tests__/lib/form-option-preset-csv.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```text
git add src/lib/validations/form-option-preset.ts src/lib/form-option-preset-csv.ts __tests__/lib/form-option-preset-csv.test.ts
git commit -m "feat(forms): validate preset CSV imports"
```

### Task 3: Build Preset Services and Protected Built-ins

**Files:**
- Modify: `src/lib/constants/form-option-presets.ts`
- Create: `src/lib/data/ssic-2025.json`
- Create: `src/services/form-option-preset.service.ts`
- Test: `__tests__/services/form-option-preset.service.test.ts`

**Interfaces:**
- Consumes: `PresetOption`, Prisma `FormOptionPreset`.
- Produces: `ensureBuiltInFormOptionPresets`, `listFormOptionPresets`, `createFormOptionPreset`, `replaceFormOptionPreset`, `deleteFormOptionPreset`, and `resolvePresetOptionsForFields`.

- [ ] **Step 1: Add failing service tests**

```ts
await ensureBuiltInFormOptionPresets('tenant-1');
expect(prisma.formOptionPreset.createMany).toHaveBeenCalledWith(expect.objectContaining({
  data: expect.arrayContaining([
    expect.objectContaining({ builtInKey: 'countries', isProtected: true, allowCsvReplace: false }),
    expect.objectContaining({ builtInKey: 'ssic', isProtected: true, allowCsvReplace: true }),
  ]),
}));

const resolved = await resolvePresetOptionsForFields('tenant-1', [linkedDropdown]);
expect(resolved[0].options).toEqual([{ value: '01111', label: '01111 - Growing vegetables' }]);
```

Test tenant isolation, normalized-name conflict, SSIC replacement, Countries replacement rejection, historical value independence, in-use delete conflict, and unused custom delete.

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- --run __tests__/services/form-option-preset.service.test.ts`
Expected: FAIL because the service does not exist.

- [ ] **Step 3: Add built-in data and service implementation**

Expose Countries and Nationalities as `{ value, label }[]`. Obtain the current complete SSIC classification from the official Singapore Department of Statistics source, record its edition/source URL in the JSON metadata and existing documentation, and add the reviewed list to `ssic-2025.json` with codes as values and `code - description` labels. Implement idempotent built-in creation, tenant filters on every mutation, transaction-backed replacement, `FormField` usage counting, and audit logs.

```ts
export async function resolvePresetOptionsForFields<T extends { optionPresetId: string | null; options: unknown }>(
  tenantId: string,
  fields: T[],
): Promise<T[]>;
```

Reject missing linked presets instead of replacing them with an empty list.

- [ ] **Step 4: Run and verify GREEN**

Run: `npm test -- --run __tests__/services/form-option-preset.service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```text
git add src/lib/constants/form-option-presets.ts src/lib/data/ssic-2025.json src/services/form-option-preset.service.ts __tests__/services/form-option-preset.service.test.ts
git commit -m "feat(forms): manage protected and custom presets"
```

### Task 4: Add Preset APIs and Client Hooks

**Files:**
- Create: `src/app/api/forms/presets/route.ts`
- Create: `src/app/api/forms/presets/[id]/route.ts`
- Create: `src/hooks/use-form-option-presets.ts`
- Test: `__tests__/api/form-option-presets-routes.test.ts`

**Interfaces:**
- Produces: `GET/POST /api/forms/presets`, `PATCH/DELETE /api/forms/presets/:id`, and React Query hooks.

- [ ] **Step 1: Write failing route tests**

```ts
expect(await GET(requestFor('tenant-1'))).toMatchResponse(200);
expect(await POST(jsonRequest({ name: 'Industries', csv: 'value,label\nA,Agriculture' }))).toMatchResponse(201);
expect(await PATCH(jsonRequest({ csv: 'value,label\n01111,Updated' }), params('ssic-id'))).toMatchResponse(200);
expect(await DELETE(requestFor('tenant-1'), params('countries-id'))).toMatchResponse(409);
```

Use existing auth/RBAC mocks and assert tenant IDs passed into services.

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- --run __tests__/api/form-option-presets-routes.test.ts`
Expected: FAIL because routes are missing.

- [ ] **Step 3: Implement routes and hooks**

Return structured import fields `{ detectedColumns, totalRows, validRows, rejectedRows, errors, sample }` on validation failures and preview calls. Hooks use query key `['form-option-presets', activeTenantId]` and invalidate it after mutations.

- [ ] **Step 4: Run and verify GREEN**

Run: `npm test -- --run __tests__/api/form-option-presets-routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```text
git add src/app/api/forms/presets src/hooks/use-form-option-presets.ts __tests__/api/form-option-presets-routes.test.ts
git commit -m "feat(forms): expose option preset APIs"
```

### Task 5: Add the Compact Preset Management Modal

**Files:**
- Create: `src/components/forms/preset-list-manager.tsx`
- Modify: `src/app/(dashboard)/forms/page.tsx`
- Test: `__tests__/components/form-preset-list-manager.test.tsx`
- Test: `__tests__/app/forms-page-tabs.test.tsx`

**Interfaces:**
- Consumes: hooks from Task 4.
- Produces: `PresetListManager({ isOpen, onClose })`.

- [ ] **Step 1: Write failing UI tests**

```tsx
expect(screen.getByRole('button', { name: 'Preset lists' })).toBeVisible();
await user.click(screen.getByRole('button', { name: 'Preset lists' }));
expect(screen.getByRole('dialog', { name: 'Preset lists' })).toBeVisible();
expect(screen.getByText('SSIC')).toBeVisible();
expect(screen.getByRole('button', { name: 'Delete Countries' })).toBeDisabled();
```

Add import-preview tests asserting counts, sample rows, row-numbered errors, atomic replace confirmation, and disabled deletion with usage text.

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- --run __tests__/components/form-preset-list-manager.test.tsx __tests__/app/forms-page-tabs.test.tsx`
Expected: FAIL because the button and manager do not exist.

- [ ] **Step 3: Implement the modal**

Use existing `Modal`, `Button`, `FormInput`, `Alert`, and `ConfirmDialog`. Keep one list view and one import subview inside the same modal; use `<input type="file" accept=".csv,text/csv">`, read with `file.text()`, validate before enabling Save, and display name/type/count/updated/usage columns.

- [ ] **Step 4: Run and verify GREEN**

Run: `npm test -- --run __tests__/components/form-preset-list-manager.test.tsx __tests__/app/forms-page-tabs.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```text
git add src/components/forms/preset-list-manager.tsx 'src/app/(dashboard)/forms/page.tsx' __tests__/components/form-preset-list-manager.test.tsx __tests__/app/forms-page-tabs.test.tsx
git commit -m "feat(forms): add preset list manager"
```

### Task 6: Link Presets Through Builder and Form Read Paths

**Files:**
- Modify: `src/lib/validations/form-builder.ts`
- Modify: `src/components/forms/builder-utils.ts`
- Modify: `src/components/forms/field-general-tab.tsx`
- Modify: `src/app/(dashboard)/forms/[id]/builder/page.tsx`
- Modify: `src/services/form-crud.service.ts`
- Modify: `src/services/form-submission.service.ts`
- Test: `__tests__/components/form-dropdown-preset-editor.test.tsx`
- Test: `__tests__/services/form-option-preset-resolution.test.ts`

**Interfaces:**
- Consumes: `resolvePresetOptionsForFields`.
- Produces: `BuilderField.optionPresetId: string | null` and `FormFieldInput.optionPresetId`.

- [ ] **Step 1: Write failing linkage tests**

```ts
expect(toPayloadFields([{ ...field, optionPresetId: 'preset-1', options: [] }])[0]).toMatchObject({
  optionPresetId: 'preset-1', options: null,
});
expect((await getPublicFormBySlug('annual-return'))?.fields[0].options).toEqual(updatedPresetOptions);
```

UI coverage must assert that selecting a preset clears embedded payload options, and switching to Custom options copies the currently resolved `{ value, label }` list before clearing the reference.

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- --run __tests__/components/form-dropdown-preset-editor.test.tsx __tests__/services/form-option-preset-resolution.test.ts`
Expected: FAIL because field linkage is absent.

- [ ] **Step 3: Implement field linkage and resolution**

Extend field validation and persistence with `optionPresetId: z.string().uuid().optional().nullable()`. Preserve separate values and labels for dropdown object options instead of serializing every option to its label. Validate that referenced presets belong to the form tenant before the delete/create transaction. Resolve presets in `getFormById`, `getPublicFormBySlug`, duplication, PDF generation inputs, and submission validation reads.

- [ ] **Step 4: Run focused form tests**

Run: `npm test -- --run __tests__/components/form-dropdown-preset-editor.test.tsx __tests__/services/form-option-preset-resolution.test.ts __tests__/lib/form-utils.test.ts __tests__/services/form-public-access.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```text
git add src/lib/validations/form-builder.ts src/components/forms/builder-utils.ts src/components/forms/field-general-tab.tsx 'src/app/(dashboard)/forms/[id]/builder/page.tsx' src/services/form-crud.service.ts src/services/form-submission.service.ts __tests__/components/form-dropdown-preset-editor.test.tsx __tests__/services/form-option-preset-resolution.test.ts __tests__/lib/form-utils.test.ts __tests__/services/form-public-access.test.ts
git commit -m "feat(forms): link dropdown fields to presets"
```

### Task 7: Raise Embedded Limits and Enable Dropdown Clearing

**Files:**
- Modify: `src/lib/validations/form-builder.ts`
- Modify: `src/app/(public)/forms/f/[slug]/page.tsx`
- Test: `__tests__/lib/form-builder-large-options.test.ts`
- Test: `__tests__/app/public-form-page.test.tsx`

**Interfaces:**
- Consumes: `FORM_PRESET_MAX_OPTIONS`.
- Produces: embedded 5,000-option validation and clearable public dropdowns.

- [ ] **Step 1: Write failing boundary and clearing tests**

```ts
expect(formFieldSchema.safeParse(dropdownWithOptions(501)).success).toBe(true);
expect(formFieldSchema.safeParse(dropdownWithOptions(5000)).success).toBe(true);
expect(formFieldSchema.safeParse(dropdownWithOptions(5001)).success).toBe(false);
```

Render an optional dropdown, choose an option, click its accessible clear button, and assert the answer returns to `''`. Repeat with a required dropdown and assert page progression reports the existing required error.

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- --run __tests__/lib/form-builder-large-options.test.ts __tests__/app/public-form-page.test.tsx`
Expected: FAIL at 501 options and because the clear button is absent.

- [ ] **Step 3: Implement minimal changes**

Use the shared 5,000 constant in the field option schemas. Change only the public form `DROPDOWN` component from `clearable={false}` to `clearable={!field.isReadOnly}`. Leave timezone and phone selectors unchanged.

- [ ] **Step 4: Run focused and regression tests**

Run: `npm test -- --run __tests__/lib/form-builder-large-options.test.ts __tests__/app/public-form-page.test.tsx __tests__/lib/form-utils.test.ts __tests__/services/form-crud-archive.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```text
git add src/lib/validations/form-builder.ts 'src/app/(public)/forms/f/[slug]/page.tsx' __tests__/lib/form-builder-large-options.test.ts __tests__/app/public-form-page.test.tsx
git commit -m "fix(forms): support large clearable dropdowns"
```

### Task 8: Document and Verify Dropdown Presets

**Files:**
- Modify: `docs/reference/API_REFERENCE.md`
- Modify: `docs/guides/DESIGN_GUIDELINE.md`
- Modify: `docs/INDEX.md`

- [ ] **Step 1: Update existing documentation**

Document preset endpoints, `label` and `value,label` CSV examples, 5 MB/5,000-row limits, protected built-ins, live linkage, in-use deletion behavior, and clearable optional dropdowns. Add links through `docs/INDEX.md`; do not create another guide.

- [ ] **Step 2: Run complete verification**

Run:

```text
npm test -- --run __tests__/lib/form-option-preset-csv.test.ts __tests__/services/form-option-preset-schema.test.ts __tests__/services/form-option-preset.service.test.ts __tests__/api/form-option-presets-routes.test.ts __tests__/components/form-preset-list-manager.test.tsx __tests__/components/form-dropdown-preset-editor.test.tsx __tests__/services/form-option-preset-resolution.test.ts __tests__/lib/form-builder-large-options.test.ts __tests__/app/public-form-page.test.tsx
npx tsc --noEmit
npm run lint
git diff --check
```

Expected: all commands exit 0 with no test failures, type errors, lint errors, or whitespace errors.

- [ ] **Step 3: Commit**

```text
git add docs/reference/API_REFERENCE.md docs/guides/DESIGN_GUIDELINE.md docs/INDEX.md
git commit -m "docs(forms): document dropdown presets"
```
