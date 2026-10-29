# Form Branding — Copyright Footer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an optional `© [Tenant Name]` footer to the public form view, toggleable per form via a `hideFooter` setting (default shown).

**Architecture:** Same pattern as the existing `hideLogo` / `tenantLogoUrl` implementation — extend `PublicFormDefinition` and `FormDetail` with `tenantName`, add `hideFooter` to the freeform `Form.settings` JSON, wire a toggle into the builder settings tab, and render the footer in the public form page.

**Tech Stack:** Next.js App Router, Prisma, React, Tailwind CSS, TypeScript

---

### Task 1: Add `tenantName` to `PublicFormDefinition` and `FormDetail`

**Files:**
- Modify: `src/lib/form-utils.ts`
- Modify: `src/services/form-builder.service.ts`

**Step 1: Add `tenantName` to `PublicFormDefinition` in form-utils.ts**

Find the interface (around line 26-29) and add one field after `tenantLogoUrl`:

```ts
tenantName: string | null;
```

**Step 2: Add `tenantName` to `FormDetail` in form-builder.service.ts**

Find the `FormDetail` interface (around line 45-48) and add after `tenantLogoUrl`:

```ts
tenantName: string | null;
```

**Step 3: Extend tenant select in `getPublicFormBySlug`**

Find the tenant select (around line 1203-1205) and add `name`:

```ts
tenant: {
  select: { logoUrl: true, name: true },
},
```

Find the return object (around line 1213-1216) and add:

```ts
tenantName: form.tenant?.name ?? null,
```

**Step 4: Extend tenant select in `getFormById`**

Find the tenant select (around line 1676-1678) and add `name`:

```ts
tenant: {
  select: { logoUrl: true, name: true },
},
```

Find the return object (around line 1695-1699) and add:

```ts
tenantName: form.tenant?.name ?? null,
```

**Step 5: Run tests**

```bash
npm test
```
Expected: all 320 tests pass (no test covers these fields directly, but TypeScript will catch mismatches at build time).

**Step 6: Commit**

```bash
git add src/lib/form-utils.ts src/services/form-builder.service.ts
git commit -m "feat: add tenantName to PublicFormDefinition and FormDetail"
```

---

### Task 2: Add `hideFooter` to `serializeBuilderState`

**Files:**
- Modify: `src/components/forms/builder-utils.ts`

**Step 1: Add `hideFooter` to the input type (around line 273)**

After `hideLogo?: boolean;` add:

```ts
hideFooter?: boolean;
```

**Step 2: Add `hideFooter` to the JSON.stringify body (around line 288)**

After `hideLogo: input.hideLogo === true,` add:

```ts
hideFooter: input.hideFooter === true,
```

**Step 3: Run tests**

```bash
npm test
```
Expected: all pass.

**Step 4: Commit**

```bash
git add src/components/forms/builder-utils.ts
git commit -m "feat: add hideFooter to serializeBuilderState"
```

---

### Task 3: Wire `hideFooter` state into the builder page

**Files:**
- Modify: `src/app/(dashboard)/forms/[id]/builder/page.tsx`

**Step 1: Add state (around line 231, after `hideLogo` state)**

```ts
const [hideFooter, setHideFooter] = useState(false);
```

**Step 2: Read from settings on load (around line 295, after `setHideLogo`)**

```ts
setHideFooter(settingsObj.hideFooter === true);
```

**Step 3: Pass `hideFooter` to all three `serializeBuilderState` calls**

There are three calls — the baseline snapshot on load (around line 299), the `stateSnapshot` useMemo (around line 431), and the post-save baseline (around line 1083). Add `hideFooter` to each, following the `hideLogo` pattern.

**Step 4: Write `hideFooter` into the `persistForm` settings payload (around line 1060)**

After `nextSettings = { ...settingsRecord, hideLogo: hideLogo === true };` add:

```ts
nextSettings = { ...(nextSettings as Record<string, unknown>), hideFooter: hideFooter === true };
```

**Step 5: Add the toggle UI in the settings tab**

Find the hideLogo toggle block in the settings tab JSX (around line 1328-1340). Add a sibling block immediately after it (after the closing `</div>` of the hideLogo row) following the exact same structure:

- Label: "Show copyright footer"
- Sublabel: "Display © [Tenant Name] at the bottom of the form"
- `aria-checked={!hideFooter}`
- `onClick={() => setHideFooter((v) => !v)}`
- Active colour when `!hideFooter`

**Step 6: Run tests**

```bash
npm test
```
Expected: all pass.

**Step 7: Commit**

```bash
git add src/app/\(dashboard\)/forms/\[id\]/builder/page.tsx
git commit -m "feat: add hideFooter toggle to form builder settings"
```

---

### Task 4: Render the footer in the public form page

**Files:**
- Modify: `src/app/forms/f/[slug]/page.tsx`

**Step 1: Add `shouldShowFooter` useMemo (after `shouldShowLogo`, around line 470)**

```ts
const shouldShowFooter = useMemo(() => {
  if (!form?.tenantName) return false;
  const settingsObj = (form.settings && typeof form.settings === 'object' && !Array.isArray(form.settings))
    ? form.settings as Record<string, unknown>
    : {};
  return settingsObj.hideFooter !== true;
}, [form?.tenantName, form?.settings]);
```

**Step 2: Add `tenantName` to the preview object literal (around line 531, after `tenantLogoUrl`)**

```ts
tenantName: data.tenantName ?? null,
```

**Step 3: Render the footer**

Find the closing area of the form card (after the `!isEmbed` header block, around line 2374). Add a footer below the main form content — outside the card, at the very bottom of the page container:

```tsx
{shouldShowFooter && (
  <div className="mt-6 text-center text-sm text-text-tertiary">
    © {form.tenantName}
  </div>
)}
```

Place it just before the closing tag of the outermost page wrapper so it sits below the card.

**Step 4: Run tests**

```bash
npm test
```
Expected: all pass.

**Step 5: Commit**

```bash
git add src/app/forms/f/\[slug\]/page.tsx
git commit -m "feat: display copyright footer in public form view"
```

---

### Task 5: Verify end-to-end

**Step 1: Start the dev server**

```bash
npm run dev
```

**Step 2: Open a published form in the browser**

Check that `© [Tenant Name]` appears at the bottom.

**Step 3: Toggle `hideFooter` in the builder settings and save**

Confirm the footer disappears on the public form after toggling.

**Step 4: Check the preview mode**

Open the form preview in the builder — footer should respect the toggle there too.
