# Blur Validation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Validate form fields on blur (required + email format + choice detail errors) so users see errors field-by-field rather than only on submit.

**Architecture:** Extract a `validateField(field, value, localizedField)` helper from the duplicated inline logic in `validateCurrentPage`. Add `handleFieldBlur(field, value, errorKey)` that calls it and writes/clears the error. Wire `onBlur` to `<input>`, `<textarea>`, `<SingleDateInput>`, `<SearchableSelect>`, and choice `<fieldset>` elements in both `renderCardField` and the repeat-section renderer. Change handler continues to clear errors immediately on change.

**Tech Stack:** React, TypeScript, Next.js — single file: `src/app/forms/f/[slug]/page.tsx`

---

### Task 1: Extract `validateField` helper and refactor `validateCurrentPage`

**Files:**
- Modify: `src/app/forms/f/[slug]/page.tsx`

The current `validateCurrentPage` (lines 886–1000) contains two duplicate blocks of field validation logic — one for regular fields (lines 964–995) and one for repeat-section fields (lines 921–958). Both check the same three rules:
1. Required check
2. Email format check
3. Choice detail error check

**Step 1: Add `validateField` immediately before `validateCurrentPage` (after `hasRequiredValue`, around line 885)**

```ts
function validateField(
  field: PublicField,
  value: unknown,
  localizedField: PublicField
): string | null {
  const NON_VALIDATABLE = ['PARAGRAPH', 'HTML', 'HIDDEN'];
  if (NON_VALIDATABLE.includes(field.type)) return null;

  if (field.isRequired && !hasRequiredValue(field, value)) {
    return `${field.label || field.key} is required`;
  }

  if (
    field.type === 'SHORT_TEXT' &&
    field.inputType === 'email' &&
    typeof value === 'string' &&
    value.trim().length > 0 &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
  ) {
    return `${field.label || field.key} must be a valid email`;
  }

  if (field.type === 'SINGLE_CHOICE' || field.type === 'MULTIPLE_CHOICE') {
    const detailError = getChoiceDetailValidationError(
      field.label || field.key,
      parseChoiceOptions(localizedField.options),
      value
    );
    if (detailError) return detailError;
  }

  return null;
}
```

**Step 2: Refactor `validateCurrentPage` to use `validateField`**

Replace the regular-field validation block (lines 970–995, inside `validateCurrentPage`) with:

```ts
const error = validateField(field, value, getLocalizedField(field));
if (error) {
  nextErrors[errorKey] = error;
}
```

Replace the repeat-section field validation block (lines 927–958) with:

```ts
const error = validateField(sectionField, value, getLocalizedField(sectionField));
if (error) {
  nextErrors[errorKey] = error;
}
```

The `continue` after each error assignment should be kept — `validateField` already returns the first error found, so once the error is assigned, there's nothing more to check for that field.

**Step 3: Run tests**

```bash
cd c:/Users/Scofieldkoh/Documents/oakcloud && npm test
```
Expected: 320/320 pass. Behaviour of `validateCurrentPage` is identical — just refactored.

**Step 4: Commit**

```bash
git add "src/app/forms/f/[slug]/page.tsx"
git commit -m "refactor: extract validateField helper from validateCurrentPage"
```

---

### Task 2: Add `handleFieldBlur` and wire `onBlur` to regular card fields

**Files:**
- Modify: `src/app/forms/f/[slug]/page.tsx`

**Step 1: Add `handleFieldBlur` after `validateField` (before `validateCurrentPage`)**

```ts
function handleFieldBlur(field: PublicField, value: unknown, errorKey: string) {
  const error = validateField(field, value, getLocalizedField(field));
  setFieldErrors((prev) => {
    const next = { ...prev };
    if (error) {
      next[errorKey] = error;
    } else {
      delete next[errorKey];
    }
    return next;
  });
}
```

**Step 2: Wire `onBlur` to `<input>` for SHORT_TEXT (around line 1837)**

Find:
```tsx
onChange={(e) => setFieldValue(field.key, e.target.value)}
placeholder={localizedField.placeholder || ''}
readOnly={field.isReadOnly}
```
Add after `onChange`:
```tsx
onBlur={() => handleFieldBlur(field, answers[field.key], getFieldErrorKey(field.key))}
```

**Step 3: Wire `onBlur` to `<textarea>` for LONG_TEXT (around line 1871)**

Find:
```tsx
onChange={(e) => setFieldValue(field.key, e.target.value)}
placeholder={localizedField.placeholder || ''}
readOnly={field.isReadOnly}
```
Add after `onChange`:
```tsx
onBlur={() => handleFieldBlur(field, answers[field.key], getFieldErrorKey(field.key))}
```

**Step 4: Wire `onBlur` to `<SearchableSelect>` for DROPDOWN (around line 1891)**

`SearchableSelect` supports an `onBlur` prop. Add:
```tsx
onBlur={() => handleFieldBlur(field, answers[field.key], getFieldErrorKey(field.key))}
```

**Step 5: Wire `onBlur` to choice fieldsets (SINGLE_CHOICE and MULTIPLE_CHOICE)**

For `SINGLE_CHOICE` (around line 1901) and `MULTIPLE_CHOICE` (around line 2015), add to the outer `<fieldset>`:
```tsx
onBlur={() => handleFieldBlur(field, answers[field.key], getFieldErrorKey(field.key))}
```

Note: `onBlur` on a `<fieldset>` fires when focus leaves the fieldset entirely (i.e. when the user tabs away after making a selection). This is the correct behaviour for choice groups.

**Step 6: Wire `onBlur` to `<SingleDateInput>` for DATE (around line 1854)**

`SingleDateInput` supports an `onBlur` prop. Add:
```tsx
onBlur={() => handleFieldBlur(field, answers[field.key], getFieldErrorKey(field.key))}
```

**Step 7: Run tests**

```bash
cd c:/Users/Scofieldkoh/Documents/oakcloud && npm test
```
Expected: 320/320 pass.

**Step 8: Commit**

```bash
git add "src/app/forms/f/[slug]/page.tsx"
git commit -m "feat: add blur validation to regular card fields"
```

---

### Task 3: Wire `onBlur` to repeat-section fields

**Files:**
- Modify: `src/app/forms/f/[slug]/page.tsx`

The repeat-section renderer (starting around line 1381) renders the same field types inline. Wire blur validation using `getFieldErrorKey(sectionField.key, rowIndex)`.

**Step 1: Add a repeat-section blur handler inline**

For each input type below, add an `onBlur` that calls `handleFieldBlur` with the section field, the row-indexed value, and the row-indexed error key. Since `handleFieldBlur` takes `(field, value, errorKey)`, the call looks like:

```tsx
onBlur={() => handleFieldBlur(
  sectionField,
  getRepeatFieldValue(sectionField.key, rowIndex),
  getFieldErrorKey(sectionField.key, rowIndex)
)}
```

**Step 2: Wire to SHORT_TEXT `<input>` in repeat section (around line 1386)**

After `onChange={(e) => setRepeatFieldValue(sectionField.key, rowIndex, e.target.value)}` add:
```tsx
onBlur={() => handleFieldBlur(sectionField, getRepeatFieldValue(sectionField.key, rowIndex), getFieldErrorKey(sectionField.key, rowIndex))}
```

**Step 3: Wire to LONG_TEXT `<textarea>` in repeat section (around line 1412)**

After `onChange={(e) => setRepeatFieldValue(sectionField.key, rowIndex, e.target.value)}` add:
```tsx
onBlur={() => handleFieldBlur(sectionField, getRepeatFieldValue(sectionField.key, rowIndex), getFieldErrorKey(sectionField.key, rowIndex))}
```

**Step 4: Wire to DROPDOWN `<SearchableSelect>` in repeat section (around line 1425)**

Add:
```tsx
onBlur={() => handleFieldBlur(sectionField, getRepeatFieldValue(sectionField.key, rowIndex), getFieldErrorKey(sectionField.key, rowIndex))}
```

**Step 5: Wire to `<SingleDateInput>` in repeat section (around line 1398)**

Add:
```tsx
onBlur={() => handleFieldBlur(sectionField, getRepeatFieldValue(sectionField.key, rowIndex), getFieldErrorKey(sectionField.key, rowIndex))}
```

**Step 6: Wire to choice `<fieldset>` elements in repeat section**

Add `onBlur` to the outer `<fieldset>` for both `SINGLE_CHOICE` (around line 1434) and `MULTIPLE_CHOICE` (if present in repeat section), same as Task 2 Step 5.

**Step 7: Run tests**

```bash
cd c:/Users/Scofieldkoh/Documents/oakcloud && npm test
```
Expected: 320/320 pass.

**Step 8: Commit**

```bash
git add "src/app/forms/f/[slug]/page.tsx"
git commit -m "feat: add blur validation to repeat-section fields"
```

---

### Task 4: Verify end-to-end

**Step 1: Start the dev server**

```bash
npm run dev
```

**Step 2: Open a published form with required fields and an email field**

- Tab away from a required field without filling it → error appears immediately
- Start typing in the field → error clears immediately
- Tab away again with a valid value → no error
- Enter an invalid email and tab away → email format error appears
- Correct the email and tab away → error clears
- Click Next/Submit with empty required fields → all errors show (existing behaviour preserved)

**Step 3: Test repeat sections**

Open a form with repeat sections. Verify blur validation works per-row (errors are row-specific, not shared across rows).
