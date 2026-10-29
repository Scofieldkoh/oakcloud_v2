# Blur Validation Design

**Date:** 2026-03-07

## Overview

Validate form fields on blur (required check + email format + choice detail errors), in addition to the existing full-page validation on next/submit. Errors clear immediately on change (existing behaviour preserved).

## Approach

Extract a `validateField(field, value, localizedField): string | null` function from the duplicated inline logic in `validateCurrentPage`. The function encodes the three existing rules:

1. **Required** — `field.isRequired && !hasRequiredValue(field, value)` → `"[label] is required"` (skips PARAGRAPH, HTML, HIDDEN)
2. **Email format** — `SHORT_TEXT + inputType === 'email'` + non-empty + invalid → `"[label] must be a valid email"`
3. **Choice detail** — delegates to existing `getChoiceDetailValidationError`

Returns the first error string, or `null`.

## Changes

**`validateCurrentPage` refactor**

Replace the two duplicate inline validation blocks (regular fields and repeat-section fields) with calls to `validateField`. Behaviour is identical — just DRY.

**`handleFieldBlur(field, value, errorKey)`**

New function that calls `validateField` and writes or clears the error for the given key via `setFieldErrors`.

**`onBlur` wiring in `renderCardField`**

Add `onBlur` to each input type that supports it:
- `<input>` (SHORT_TEXT, NUMBER, etc.)
- `<textarea>` (LONG_TEXT)
- `<SingleDateInput>`
- Dropdowns / select

Skipped: FILE_UPLOAD (async errors), PARAGRAPH, HTML, HIDDEN, SIGNATURE (no meaningful blur).

Repeat-section fields get the same treatment with row-indexed error keys via `getFieldErrorKey(field.key, rowIndex)`.

## What does NOT change

- `setFieldValue` continues to immediately clear the error key on change
- Full `validateCurrentPage` still runs on next/submit
- No new state introduced
