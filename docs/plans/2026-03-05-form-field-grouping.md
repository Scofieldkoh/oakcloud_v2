# Form Field Grouping Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace per-field cards with grouped section cards so related fields feel cohesive rather than disconnected floating tiles.

**Architecture:** A `buildRenderGroups` pure function runs over `visibleFields[]` before the render loop and produces a flat list of typed render items (`group` or `standalone`). The render loop maps over these items instead of raw fields. Group cards wrap consecutive card-eligible fields with a shared outer border/shadow; standalone items render between cards unchanged.

**Tech Stack:** React, TypeScript, Tailwind CSS — all changes in one file: `src/app/forms/f/[slug]/page.tsx`

---

## Background: current structure

Each field today is wrapped in its own card (lines 1157–1482):

```tsx
<div key={field.id} className={widthClass}>          // col-span-N
  <div className="rounded-xl border bg-white p-5 shadow-sm ...">
    {/* label + input + error */}
  </div>
</div>
```

After this change, card-eligible fields will share a group card; only the label+input+error remains per-field (no inner card div).

---

## Task 1: Add `buildRenderGroups` pure function

**Files:**
- Modify: `src/app/forms/f/[slug]/page.tsx` — add function just above the component export (around line 730)

**Step 1: Understand the field types**

Card-eligible types (go inside group cards):
`SHORT_TEXT`, `LONG_TEXT`, `DROPDOWN`, `SINGLE_CHOICE`, `MULTIPLE_CHOICE`, `FILE_UPLOAD`, `SIGNATURE`

Standalone types (render between cards, unchanged):
- `PARAGRAPH` (info_text, info_url, info_image, heading blocks)
- `HTML`
- `HIDDEN` (renders null)
- `PAGE_BREAK` (renders null)
- Repeat section start marker (a SHORT_TEXT field whose `key` starts with `__repeat_start__`)

Heading subtypes (`info_heading_1/2/3`) are PARAGRAPH fields that act as group boundary triggers AND become the group's title.

**Step 2: Add types and function**

Add these types and function directly above the component function (`export default function PublicFormPage`):

```tsx
type RenderGroup = {
  kind: 'group';
  heading: PublicField | null;
  fields: PublicField[];
};

type RenderStandalone = {
  kind: 'standalone';
  field: PublicField;
};

type RenderItem = RenderGroup | RenderStandalone;

const CARD_ELIGIBLE_TYPES = new Set([
  'SHORT_TEXT',
  'LONG_TEXT',
  'DROPDOWN',
  'SINGLE_CHOICE',
  'MULTIPLE_CHOICE',
  'FILE_UPLOAD',
  'SIGNATURE',
]);

function buildRenderGroups(fields: PublicField[]): RenderItem[] {
  const items: RenderItem[] = [];
  let currentGroup: RenderGroup | null = null;

  function flushGroup() {
    if (currentGroup && currentGroup.fields.length > 0) {
      items.push(currentGroup);
    }
    currentGroup = null;
  }

  for (const field of fields) {
    // Always-null renders
    if (field.type === 'HIDDEN' || field.type === 'PAGE_BREAK') {
      items.push({ kind: 'standalone', field });
      continue;
    }

    // Repeat markers are standalone
    if (field.key?.startsWith('__repeat_start__') || field.key?.startsWith('__repeat_end__')) {
      flushGroup();
      items.push({ kind: 'standalone', field });
      continue;
    }

    // Heading blocks: flush current group, become next group's heading
    if (
      field.type === 'PARAGRAPH' &&
      (field.inputType === 'info_heading_1' ||
        field.inputType === 'info_heading_2' ||
        field.inputType === 'info_heading_3')
    ) {
      flushGroup();
      currentGroup = { kind: 'group', heading: field, fields: [] };
      continue;
    }

    // Other PARAGRAPH variants and HTML: standalone
    if (field.type === 'PARAGRAPH' || field.type === 'HTML') {
      flushGroup();
      items.push({ kind: 'standalone', field });
      continue;
    }

    // Card-eligible: add to current group (start one if needed)
    if (CARD_ELIGIBLE_TYPES.has(field.type)) {
      if (!currentGroup) {
        currentGroup = { kind: 'group', heading: null, fields: [] };
      }
      currentGroup.fields.push(field);
      continue;
    }

    // Anything else: standalone
    flushGroup();
    items.push({ kind: 'standalone', field });
  }

  flushGroup();
  return items;
}
```

**Step 3: Check it compiles**

Run: `npx tsc --noEmit`
Expected: No new errors introduced.

**Step 4: Commit**

```bash
git add src/app/forms/f/[slug]/page.tsx
git commit -m "feat: add buildRenderGroups function for field grouping"
```

---

## Task 2: Replace the render loop with grouped rendering

**Files:**
- Modify: `src/app/forms/f/[slug]/page.tsx` — the main render loop (lines ~759–1484)

**Step 1: Understand what changes**

The current loop is:
```tsx
<div className={cn('grid grid-cols-12 gap-4', !isEmbed && 'mt-4')}>
  {visibleFields.map((field, fieldIndex) => {
    // ... lots of field rendering logic
  })}
</div>
```

We replace it with a loop over `renderItems` (from `buildRenderGroups`). The outer grid becomes a `flex flex-col gap-4` since groups and standalones are block-level items. Inside each group card, we use the existing 12-col grid for the fields.

**Step 2: Compute renderItems**

Right before the `return` statement of the component, `visibleFields` is already computed via `useMemo`. Add this just before the `return`:

```tsx
const renderItems = buildRenderGroups(visibleFields.filter((f) => !hiddenFieldIds.has(f.id)));
```

Wait — `hiddenFieldIds` is a `Set` built *inside* the render loop today (for repeat section handling). We need to keep that logic. See Task 3 for repeat sections. For now, pass all visibleFields and handle hidden tracking inside the new loop.

Actually: keep the `hiddenFieldIds` `Set` as a `const` declared just before the `renderItems` line:

```tsx
const hiddenFieldIds = new Set<string>();
const renderItems = buildRenderGroups(
  visibleFields.filter((f) => {
    if (f.type === 'HIDDEN') return false;
    return true;
  })
);
```

Repeat section end markers use `hiddenFieldIds` to skip rendering — we'll handle that in Task 3.

**Step 3: Write the new outer container + loop**

Replace the entire block from the opening `<div className={cn('grid grid-cols-12 gap-4'...}>` to its closing `</div>` (currently lines 759–1484) with:

```tsx
<div className={cn('flex flex-col gap-4', !isEmbed && 'mt-4')}>
  {renderItems.map((item, itemIndex) => {
    if (item.kind === 'standalone') {
      return renderStandaloneField(item.field);
    }

    // Group card
    const { heading, fields: groupFields } = item;
    const groupHasError = groupFields.some((f) => fieldErrors[getFieldErrorKey(f.key)]);

    return (
      <div key={heading?.id ?? `group-${itemIndex}`}>
        {/* Heading rendered outside the card */}
        {heading && renderHeadingField(heading)}

        {/* Group card */}
        <div className={cn(
          'rounded-xl border bg-white shadow-sm',
          groupHasError
            ? 'border-status-error/40 ring-1 ring-status-error/20'
            : 'border-border-primary/50'
        )}>
          <div className="p-5">
            <div className="grid grid-cols-12 gap-x-4">
              {groupFields.map((field, fieldIndexInGroup) => renderCardField(field, fieldIndexInGroup, groupFields))}
            </div>
          </div>
        </div>
      </div>
    );
  })}
</div>
```

**Step 4: Commit placeholder** (before adding the helper functions — keep the app compiling at each step)

```bash
git add src/app/forms/f/[slug]/page.tsx
git commit -m "feat: wire grouped render loop (stubs to follow)"
```

---

## Task 3: Extract `renderStandaloneField` helper

**Files:**
- Modify: `src/app/forms/f/[slug]/page.tsx`

**Step 1: Create the helper**

This helper handles everything that was previously rendered via the `if (field.type === 'PARAGRAPH')`, `if (field.type === 'HTML')`, `if (field.type === 'HIDDEN')`, `if (isRepeatStartMarker)`, `if (isRepeatEndMarker)` branches — extracted verbatim from the old loop.

Add a `renderStandaloneField` function *inside* the component body (below the state declarations, before the `return`). It must be a regular function (not a component) since it needs closure access to state.

```tsx
function renderStandaloneField(field: PublicField): React.ReactNode {
  if (field.type === 'HIDDEN') return null;
  if (field.type === 'PAGE_BREAK') return null;

  const widthClass = WIDTH_CLASS[field.layoutWidth] || WIDTH_CLASS[100];

  // Heading blocks
  if (
    field.type === 'PARAGRAPH' &&
    (field.inputType === 'info_heading_1' ||
      field.inputType === 'info_heading_2' ||
      field.inputType === 'info_heading_3')
  ) {
    return renderHeadingField(field);
  }

  // info_image
  if (field.type === 'PARAGRAPH' && field.inputType === 'info_image') {
    const imageUrl = isValidHttpUrl(field.placeholder?.trim() || null) ? field.placeholder!.trim() : null;
    return (
      <div key={field.id} className={widthClass}>
        <div className="overflow-hidden rounded-lg border border-border-primary bg-background-primary">
          {imageUrl ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageUrl} alt={field.subtext || field.label || 'Information image'} className="max-h-96 w-full object-contain" />
              {field.subtext && (
                <p className="border-t border-border-primary px-3 py-2 text-xs text-text-secondary">{field.subtext}</p>
              )}
            </>
          ) : (
            <div className="px-3 py-4 text-sm text-text-secondary">Add a valid image URL in field settings.</div>
          )}
        </div>
      </div>
    );
  }

  // info_url
  if (field.type === 'PARAGRAPH' && field.inputType === 'info_url') {
    const href = isValidHttpUrl(field.placeholder?.trim() || null) ? field.placeholder!.trim() : null;
    return (
      <div key={field.id} className={widthClass}>
        <div className="rounded-lg border border-border-primary bg-background-primary px-3 py-2 text-sm">
          {href ? (
            <a href={href} target="_blank" rel="noopener noreferrer" className="break-all text-text-primary underline hover:text-text-secondary">
              {field.subtext || field.label || href}
            </a>
          ) : (
            <span className="text-text-secondary">Add a valid URL in field settings.</span>
          )}
        </div>
      </div>
    );
  }

  // info_text
  if (field.type === 'PARAGRAPH') {
    return (
      <div key={field.id} className={widthClass}>
        <div className="rounded-lg border border-border-primary bg-background-primary px-3 py-2 text-sm text-text-primary whitespace-pre-wrap">
          {field.subtext || field.label}
        </div>
      </div>
    );
  }

  // HTML
  if (field.type === 'HTML') {
    return (
      <div key={field.id} className={widthClass}>
        <div className="text-sm text-text-primary" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(field.subtext || '') }} />
      </div>
    );
  }

  return null;
}
```

Note: Repeat section handling was inside the old loop; for now it's excluded from `buildRenderGroups` (repeat markers are passed through as standalones). We'll add repeat section rendering in Task 4.

**Step 2: Add `renderHeadingField` helper**

```tsx
function renderHeadingField(field: PublicField): React.ReactNode {
  const headingType = field.inputType === 'info_heading_1' ? 'h1'
    : field.inputType === 'info_heading_2' ? 'h2'
    : 'h3';
  const headingClasses = {
    h1: 'text-xl font-bold text-text-primary mt-6 mb-2',
    h2: 'text-lg font-semibold text-text-primary mt-4 mb-1.5',
    h3: 'text-base font-semibold text-text-primary mt-3 mb-1',
  };
  const Tag = headingType as 'h1' | 'h2' | 'h3';
  return (
    <div key={field.id}>
      <Tag className={headingClasses[headingType]}>{field.label || field.subtext}</Tag>
      {field.subtext && field.label && (
        <p className="text-sm text-text-secondary">{field.subtext}</p>
      )}
    </div>
  );
}
```

**Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: No errors.

**Step 4: Commit**

```bash
git add src/app/forms/f/[slug]/page.tsx
git commit -m "feat: extract renderStandaloneField and renderHeadingField helpers"
```

---

## Task 4: Extract `renderCardField` helper

**Files:**
- Modify: `src/app/forms/f/[slug]/page.tsx`

**Step 1: Understand the divider logic**

Fields within a group card are separated by a top border divider. The first field in the group gets no top divider; every subsequent field does.

The layout within the card uses the existing 12-col grid, but we need row-level dividers — not just column gaps. The cleanest approach: wrap each field's `widthClass` div in the same way as before, but add a `col-span-12 border-t border-border-primary/20` divider row between logical rows.

A "logical row" break happens when the running column sum would exceed 12. Detect this in `renderCardField` by passing `fieldIndexInGroup` and `groupFields` so the helper can look back at the previous field's width.

**Step 2: Add helper**

```tsx
function renderCardField(
  field: PublicField,
  fieldIndexInGroup: number,
  groupFields: PublicField[]
): React.ReactNode {
  const widthClass = WIDTH_CLASS[field.layoutWidth] || WIDTH_CLASS[100];
  const value = answers[field.key];
  const errorText = fieldErrors[getFieldErrorKey(field.key)];
  const fieldDomId = `form-field-${toDomSafeId(field.id || field.key)}`;
  const controlId = `${fieldDomId}-control`;
  const labelId = `${fieldDomId}-label`;
  const hintId = field.subtext ? `${fieldDomId}-hint` : undefined;
  const errorId = errorText ? `${fieldDomId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  const accessibleLabel = field.label || field.key;
  const renderLabelAsText = ['SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'SIGNATURE'].includes(field.type);
  const useDateSelector = field.type === 'SHORT_TEXT' && field.inputType === 'date';
  const showTooltip = isTooltipEnabled(field);
  const tooltipText = showTooltip ? field.helpText!.trim() : null;
  const uploadStatus = uploadedByFieldKey[field.key];

  // Determine if we need a row divider before this field
  // A new row starts when: first field, OR previous fields on current row sum >= 12
  let needsDivider = false;
  if (fieldIndexInGroup > 0) {
    // Sum widths of fields since the last row break
    let colSum = 0;
    for (let i = fieldIndexInGroup - 1; i >= 0; i--) {
      const w = groupFields[i].layoutWidth || 100;
      const cols = Math.round(w / 100 * 12);
      colSum += cols;
      if (colSum >= 12) {
        // The previous field was at the start of a row (or we hit the row limit)
        // Check if adding field i would have started a new row
        break;
      }
    }
    // Simpler: track running sum across group
    let runningCols = 0;
    for (let i = 0; i < fieldIndexInGroup; i++) {
      const w = groupFields[i].layoutWidth || 100;
      const cols = Math.round(w / 100 * 12);
      if (runningCols + cols > 12) runningCols = cols;
      else runningCols += cols;
    }
    const thisFieldCols = Math.round((field.layoutWidth || 100) / 100 * 12);
    needsDivider = runningCols === 0 || runningCols >= 12;
    // Simpler approach: add divider whenever this field starts at column 0 of a new row
    // We recalculate running sum from scratch
    let sum = 0;
    for (let i = 0; i < fieldIndexInGroup; i++) {
      const w = groupFields[i].layoutWidth || 100;
      sum += Math.round(w / 100 * 12);
      if (sum >= 12) sum = 0;
    }
    needsDivider = sum === 0;
  }

  return (
    <React.Fragment key={field.id}>
      {needsDivider && (
        <div className="col-span-12 border-t border-border-primary/20 mt-4 pt-0" />
      )}
      <div className={cn(widthClass, needsDivider && 'mt-4')}>
        {/* Label */}
        {!field.hideLabel && (
          renderLabelAsText ? (
            <p id={labelId} className="mb-1.5 block text-sm font-medium text-text-secondary">
              <span className="inline-flex items-center gap-1.5">
                <span>
                  {accessibleLabel}
                  {field.isRequired && <span className="text-oak-primary"> *</span>}
                </span>
                {tooltipText && (
                  <Tooltip content={<span className="block max-w-xs whitespace-pre-wrap break-words">{tooltipText}</span>}>
                    <span className="inline-flex h-4 w-4 cursor-help items-center justify-center text-text-muted hover:text-text-secondary">
                      <Info className="h-3.5 w-3.5" />
                    </span>
                  </Tooltip>
                )}
              </span>
            </p>
          ) : (
            <label htmlFor={controlId} id={labelId} className="mb-1.5 block text-sm font-medium text-text-secondary">
              <span className="inline-flex items-center gap-1.5">
                <span>
                  {accessibleLabel}
                  {field.isRequired && <span className="text-oak-primary"> *</span>}
                </span>
                {tooltipText && (
                  <Tooltip content={<span className="block max-w-xs whitespace-pre-wrap break-words">{tooltipText}</span>}>
                    <span className="inline-flex h-4 w-4 cursor-help items-center justify-center text-text-muted hover:text-text-secondary">
                      <Info className="h-3.5 w-3.5" />
                    </span>
                  </Tooltip>
                )}
              </span>
            </label>
          )
        )}

        {field.subtext && <p id={hintId} className="mb-2 text-sm text-text-secondary">{field.subtext}</p>}

        {/* SHORT_TEXT */}
        {field.type === 'SHORT_TEXT' && !useDateSelector && (
          <input
            id={controlId}
            type={field.inputType === 'phone' ? 'tel' : field.inputType || 'text'}
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => setFieldValue(field.key, e.target.value)}
            placeholder={field.placeholder || ''}
            readOnly={field.isReadOnly}
            required={field.isRequired}
            aria-label={field.hideLabel ? accessibleLabel : undefined}
            aria-invalid={errorText ? 'true' : undefined}
            aria-describedby={describedBy}
            className={cn(
              'w-full rounded-lg border border-border-primary/60 bg-background-primary px-3.5 py-2.5 text-sm text-text-primary placeholder:text-text-muted/60',
              'focus:outline-none focus:ring-2 focus:ring-oak-primary/20 focus:border-oak-primary transition-all duration-150',
              field.isReadOnly && 'bg-background-secondary cursor-not-allowed opacity-70'
            )}
          />
        )}

        {/* DATE */}
        {useDateSelector && (
          <SingleDateInput
            value={typeof value === 'string' ? value : ''}
            onChange={(next) => setFieldValue(field.key, next)}
            placeholder={field.placeholder || 'dd/mm/yyyy'}
            disabled={field.isReadOnly}
            required={field.isRequired}
            error={errorText}
            ariaLabel={field.hideLabel ? accessibleLabel : undefined}
            className="w-full"
          />
        )}

        {/* LONG_TEXT */}
        {field.type === 'LONG_TEXT' && (
          <textarea
            id={controlId}
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => setFieldValue(field.key, e.target.value)}
            placeholder={field.placeholder || ''}
            readOnly={field.isReadOnly}
            required={field.isRequired}
            aria-label={field.hideLabel ? accessibleLabel : undefined}
            aria-invalid={errorText ? 'true' : undefined}
            aria-describedby={describedBy}
            className={cn(
              'w-full min-h-24 rounded-lg border border-border-primary/60 bg-background-primary px-3.5 py-2.5 text-sm text-text-primary placeholder:text-text-muted/60',
              'focus:outline-none focus:ring-2 focus:ring-oak-primary/20 focus:border-oak-primary transition-all duration-150 resize-y',
              field.isReadOnly && 'bg-background-secondary cursor-not-allowed opacity-70'
            )}
          />
        )}

        {/* DROPDOWN */}
        {field.type === 'DROPDOWN' && (
          <SearchableSelect
            options={parseOptions(field.options).map((opt) => ({ value: opt, label: opt }))}
            value={typeof value === 'string' ? value : ''}
            onChange={(val) => setFieldValue(field.key, val)}
            placeholder="Select an option"
            clearable={false}
            showKeyboardHints={false}
            containerClassName="h-10"
          />
        )}

        {/* SINGLE_CHOICE */}
        {field.type === 'SINGLE_CHOICE' && (
          <fieldset
            className="space-y-2"
            aria-label={field.hideLabel ? accessibleLabel : undefined}
            aria-labelledby={field.hideLabel ? undefined : labelId}
            aria-describedby={describedBy}
            aria-invalid={errorText ? 'true' : undefined}
          >
            {parseChoiceOptions(field.options).map((option, index) => {
              const selectedEntry = parseChoiceAnswerEntry(value);
              const isSelected = selectedEntry?.value === option.value;
              const optionId = `${fieldDomId}-option-${index}`;
              return (
                <div key={`${option.value}-${index}`} className="space-y-1.5">
                  <label
                    htmlFor={optionId}
                    className={cn(
                      'flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-all duration-150',
                      isSelected
                        ? 'border-oak-primary/40 bg-oak-primary/5 text-text-primary'
                        : 'border-border-primary/25 bg-background-secondary/30 text-text-primary hover:border-border-primary/50 hover:bg-background-secondary/60'
                    )}
                  >
                    <input id={optionId} type="radio" name={field.key} value={option.value} checked={isSelected}
                      onChange={() => setFieldValue(field.key, option.allowTextInput ? { value: option.value, detailText: selectedEntry?.value === option.value ? selectedEntry.detailText : '' } : option.value)}
                      className="sr-only"
                    />
                    <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-all duration-150', isSelected ? 'border-oak-primary' : 'border-border-primary')}>
                      {isSelected && <span className="h-2.5 w-2.5 rounded-full bg-oak-primary" />}
                    </span>
                    {option.label}
                  </label>
                  {option.allowTextInput && isSelected && (
                    <input type="text" value={selectedEntry?.detailText || ''}
                      onChange={(e) => setFieldValue(field.key, { value: option.value, detailText: e.target.value })}
                      placeholder={option.textInputPlaceholder || option.textInputLabel || 'Please specify'}
                      className="w-full rounded-lg border border-border-primary/60 bg-background-primary px-3.5 py-2.5 text-sm text-text-primary"
                    />
                  )}
                </div>
              );
            })}
          </fieldset>
        )}

        {/* MULTIPLE_CHOICE */}
        {field.type === 'MULTIPLE_CHOICE' && (
          <fieldset
            className="space-y-2"
            aria-label={field.hideLabel ? accessibleLabel : undefined}
            aria-labelledby={field.hideLabel ? undefined : labelId}
            aria-describedby={describedBy}
            aria-invalid={errorText ? 'true' : undefined}
          >
            {parseChoiceOptions(field.options).map((option, index) => {
              const entries = parseChoiceAnswerEntries(value);
              const values = entries.map((e) => e.value);
              const isChecked = values.includes(option.value);
              const optionId = `${fieldDomId}-option-${index}-${toDomSafeId(option.value)}`;
              const optionEntry = entries.find((e) => e.value === option.value);
              return (
                <div key={`${option.value}-${index}`} className="space-y-1.5">
                  <label
                    htmlFor={optionId}
                    className={cn(
                      'flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-all duration-150',
                      isChecked
                        ? 'border-oak-primary/40 bg-oak-primary/5 text-text-primary'
                        : 'border-border-primary/25 bg-background-secondary/30 text-text-primary hover:border-border-primary/50 hover:bg-background-secondary/60'
                    )}
                  >
                    <input id={optionId} type="checkbox" checked={isChecked}
                      onChange={(e) => {
                        if (e.target.checked) {
                          const nextEntries = [...entries.filter((en) => en.value !== option.value), { value: option.value, detailText: '' }];
                          setFieldValue(field.key, nextEntries.map((en) => (en.detailText || (option.allowTextInput && en.value === option.value) ? { value: en.value, detailText: en.detailText } : en.value)));
                        } else {
                          const nextEntries = entries.filter((en) => en.value !== option.value);
                          setFieldValue(field.key, nextEntries.map((en) => (en.detailText ? { value: en.value, detailText: en.detailText } : en.value)));
                        }
                      }}
                      className="sr-only"
                    />
                    <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition-all duration-150', isChecked ? 'border-oak-primary bg-oak-primary' : 'border-border-primary')}>
                      {isChecked && (
                        <svg className="h-3 w-3 text-white" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M2 6l3 3 5-5" />
                        </svg>
                      )}
                    </span>
                    {option.label}
                  </label>
                  {option.allowTextInput && isChecked && (
                    <input type="text" value={optionEntry?.detailText || ''}
                      onChange={(e) => {
                        const nextEntries = entries.map((en) => (en.value === option.value ? { ...en, detailText: e.target.value } : en));
                        setFieldValue(field.key, nextEntries.map((en) => (en.detailText ? { value: en.value, detailText: en.detailText } : en.value)));
                      }}
                      placeholder={option.textInputPlaceholder || option.textInputLabel || 'Please specify'}
                      className="w-full rounded-lg border border-border-primary/60 bg-background-primary px-3.5 py-2.5 text-sm text-text-primary"
                    />
                  )}
                </div>
              );
            })}
          </fieldset>
        )}

        {/* FILE_UPLOAD */}
        {field.type === 'FILE_UPLOAD' && (
          <div className={cn(
            'rounded-xl border border-dashed bg-background-primary/50 p-6 text-center transition-colors duration-150',
            uploadStatus ? 'border-status-success/40' : 'border-border-primary/60 hover:border-oak-primary/40'
          )}>
            <UploadCloud className="mx-auto mb-2 h-8 w-8 text-text-muted" />
            <label htmlFor={controlId} className="cursor-pointer text-sm text-text-primary underline">
              {uploadStatus ? 'Replace file' : 'Upload a file'}
            </label>
            <input id={controlId} type="file" className="sr-only"
              aria-label={field.hideLabel ? accessibleLabel : undefined}
              aria-invalid={errorText ? 'true' : undefined}
              aria-describedby={describedBy}
              onChange={(e) => { const file = e.target.files?.[0]; if (file) uploadFile(field.key, file); }}
            />
            <p className="mt-1 text-xs text-text-muted">
              {uploadingField === field.key ? 'Uploading...' : uploadStatus ? 'File uploaded successfully' : 'Select a file to upload'}
            </p>
            {uploadStatus && (
              <div className="mt-3 rounded-md border border-status-success/30 bg-status-success/5 px-2.5 py-2 text-left">
                <div className="flex items-start gap-2 text-sm text-text-primary">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 text-status-success" />
                  <div className="min-w-0">
                    <p className="truncate font-medium">{uploadStatus.fileName}</p>
                    <p className="text-xs text-text-secondary">{formatFileSize(uploadStatus.sizeBytes)}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* SIGNATURE */}
        {field.type === 'SIGNATURE' && (
          <div role="group" aria-label={field.hideLabel ? accessibleLabel : undefined} aria-labelledby={field.hideLabel ? undefined : labelId} aria-describedby={describedBy}>
            <SignaturePad
              value={typeof value === 'string' ? value : ''}
              onChange={(next) => setFieldValue(field.key, next)}
              ariaLabel={accessibleLabel}
            />
          </div>
        )}

        {/* Error */}
        {errorText && !useDateSelector && (
          <p id={errorId} className="mt-1 text-xs text-status-error">{errorText}</p>
        )}
      </div>
    </React.Fragment>
  );
}
```

**Step 2: Add `React` import** (needed for `React.Fragment`)

The file already uses JSX but may not import React explicitly (Next.js auto-imports). Check line 1 — if it's `'use client';` with no React import, add:
```tsx
import React from 'react';
```
at the top.

**Step 3: Verify**

Run: `npx tsc --noEmit`

Also run the dev server and open a form in the browser:
```bash
npm run dev
```
Visit `http://localhost:3000/forms/f/<any-slug>?preview=true`

Expected: Fields appear grouped under section cards. No console errors.

**Step 4: Commit**

```bash
git add src/app/forms/f/[slug]/page.tsx
git commit -m "feat: extract renderCardField helper with divider logic"
```

---

## Task 5: Handle repeat sections in the new loop

**Files:**
- Modify: `src/app/forms/f/[slug]/page.tsx`

**Step 1: Understand repeat section logic**

Repeat sections use a `__repeat_start__<id>` SHORT_TEXT field as a marker. Today the loop:
1. Detects `isRepeatStartMarker(field)`
2. Scans forward to collect `sectionFields` until the end marker
3. Adds those field IDs to `hiddenFieldIds` so they don't render again
4. Renders a nested card

In `buildRenderGroups`, repeat start markers are currently passed as `standalone` items. We need to re-add the same scan-forward logic in `renderStandaloneField`.

**Step 2: Update `renderStandaloneField` to handle repeat markers**

Add at the top of `renderStandaloneField`, before the HIDDEN/PAGE_BREAK checks:

```tsx
// This requires access to visibleFields and hiddenFieldIds from the outer scope
if (isRepeatStartMarker(field)) {
  const sectionFields: PublicField[] = [];
  const fieldIndex = visibleFields.findIndex((f) => f.id === field.id);
  let cursor = fieldIndex + 1;

  while (cursor < visibleFields.length) {
    const candidate = visibleFields[cursor];
    if (isRepeatEndMarker(candidate)) {
      hiddenFieldIds.add(candidate.id);
      break;
    }
    if (isRepeatStartMarker(candidate)) break;
    hiddenFieldIds.add(candidate.id);
    if (candidate.type !== 'PAGE_BREAK') sectionFields.push(candidate);
    cursor += 1;
  }

  const sectionConfig = getRepeatSectionConfig(field);
  const sectionId = sectionConfig.id;
  const rowCount = repeatSectionCounts[sectionId] || sectionConfig.minItems;
  const canAddRow = sectionConfig.maxItems === null || rowCount < sectionConfig.maxItems;
  const sectionTitle = field.label?.trim() || 'Dynamic section';

  return (
    <div key={field.id} className="col-span-12">
      {/* ... exact same repeat section JSX as before ... */}
    </div>
  );
}
```

Copy the full repeat section JSX from the old render loop verbatim (it's a large block from line ~811 to ~1063 in the original file — transfer it wholesale into this branch).

Also update `buildRenderGroups` so that when it encounters a repeat start marker, it flushes the current group and passes the marker as standalone *but also skips the fields until the end marker*:

```tsx
// In buildRenderGroups: after the repeat marker check
if (field.key?.startsWith('__repeat_start__')) {
  flushGroup();
  items.push({ kind: 'standalone', field });
  continue;
}
// Skip repeat end markers entirely (handled in renderStandaloneField's scan-forward)
if (field.key?.startsWith('__repeat_end__')) {
  continue;
}
```

Wait — `buildRenderGroups` doesn't have access to scanning logic. The simpler approach: keep `buildRenderGroups` passing ALL fields as-is and let `renderStandaloneField` do the scan-forward + `hiddenFieldIds` tracking. The `renderItems` loop in the outer container must skip items where `hiddenFieldIds.has(field.id)` (for standalone) or filter group fields.

Add a guard at the top of the render loop:

```tsx
{renderItems.map((item, itemIndex) => {
  if (item.kind === 'standalone') {
    if (hiddenFieldIds.has(item.field.id)) return null;
    return renderStandaloneField(item.field);
  }
  // For groups, filter out any fields that ended up hidden
  const groupFields = item.fields.filter((f) => !hiddenFieldIds.has(f.id));
  if (groupFields.length === 0) return null;
  // ... rest of group rendering
})}
```

**Step 3: Verify**

Open a form with a dynamic/repeat section in preview mode. Confirm it renders correctly with add/remove row buttons.

**Step 4: Commit**

```bash
git add src/app/forms/f/[slug]/page.tsx
git commit -m "feat: handle repeat sections in grouped render loop"
```

---

## Task 6: Remove old render loop dead code

**Files:**
- Modify: `src/app/forms/f/[slug]/page.tsx`

**Step 1: Delete the old `visibleFields.map(...)` block**

After Tasks 1–5, the old `{visibleFields.map((field, fieldIndex) => { ... })}` block inside the `<div className="grid grid-cols-12...">` should be fully replaced. Confirm the old block is gone.

**Step 2: Clean up unused variables**

Check for any variables that were computed inside the old loop that are now unused at the top-level scope. The TypeScript compiler will flag these — fix them.

**Step 3: Final verification**

Run: `npx tsc --noEmit`
Expected: Clean compile.

Run dev server and test:
- Single-page form: all fields grouped under section cards
- Multi-page form: page navigation works
- Form with heading blocks: headings appear above the card
- Form with repeat section: add/remove rows works
- Form with errors: group card gets error ring, field shows inline error
- Form with info blocks (image, text, URL): render between cards

**Step 4: Commit**

```bash
git add src/app/forms/f/[slug]/page.tsx
git commit -m "feat: complete form field grouping — remove old per-field card loop"
```

---

## Done

All 6 tasks complete. The public form now renders groups of fields in shared section cards, with headings above each card and dividers between field rows.
