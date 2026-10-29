# Public Form Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign the public form page (`/forms/f/[slug]`) with a "Conversational Card" visual style — modern, friendly, approachable.

**Architecture:** Pure styling refactor of the existing `page.tsx`. No new components needed — custom radio/checkbox via Tailwind CSS, field cards via wrapper divs. Header blocks added as new PARAGRAPH inputType variant. All changes stay within the existing rendering logic.

**Tech Stack:** Tailwind CSS (existing tokens), React, Next.js

**Design Doc:** `docs/plans/2026-03-04-public-form-redesign-design.md`

---

### Task 1: Page Background & Container

**Files:**
- Modify: `src/app/forms/f/[slug]/page.tsx:459-461`

**Step 1: Update the outer page wrapper**

Change the main return's outer `<div>` and container from:

```tsx
<div className={cn('min-h-screen', isEmbed ? 'bg-transparent p-0' : 'bg-background-primary p-4 sm:p-8')}>
  <div className={cn('mx-auto max-w-4xl rounded-xl border border-border-primary bg-background-elevated', isEmbed ? 'rounded-none border-none' : 'p-4 sm:p-8')}>
```

To:

```tsx
<div className={cn('min-h-screen', isEmbed ? 'bg-transparent p-0' : 'bg-gradient-to-br from-slate-50 to-stone-100 p-4 sm:p-8')}>
  <div className={cn('mx-auto max-w-4xl', isEmbed ? '' : 'py-2')}>
```

This removes the outer card border and applies the warm gradient background. The container now has no border/shadow — fields float directly.

**Step 2: Verify locally**

Run: `npm run dev`
Open: `http://localhost:3000/forms/f/<your-test-slug>`
Expected: Warm gradient background, no outer card border

**Step 3: Commit**

```bash
git add src/app/forms/f/\[slug\]/page.tsx
git commit -m "feat(forms): update public form background to warm gradient"
```

---

### Task 2: Header Area Redesign

**Files:**
- Modify: `src/app/forms/f/[slug]/page.tsx:462-472`

**Step 1: Update header section**

Replace the header block (title, description, preview notice):

```tsx
{!isEmbed && (
  <>
    <h1 className="text-xl sm:text-2xl font-semibold text-text-primary">{form.title}</h1>
    {form.description && <p className="mt-1 text-sm text-text-secondary">{form.description}</p>}
    {isPreview && (
      <p className="mt-2 text-xs text-text-muted">
        Preview mode. Publish the form to accept uploads and submissions.
      </p>
    )}
  </>
)}
```

With:

```tsx
{!isEmbed && (
  <div className="mb-8">
    <h1 className="text-2xl font-bold text-text-primary">{form.title}</h1>
    {form.description && <p className="mt-2 text-base text-text-secondary leading-relaxed">{form.description}</p>}
    {isPreview && (
      <p className="mt-2 text-xs text-text-muted">
        Preview mode. Publish the form to accept uploads and submissions.
      </p>
    )}
    <div className="mt-4 h-[3px] w-12 rounded-full bg-oak-primary" />
  </div>
)}
```

**Step 2: Verify locally**

Expected: Bold title, relaxed description, small green accent bar below

**Step 3: Commit**

```bash
git add src/app/forms/f/\[slug\]/page.tsx
git commit -m "feat(forms): redesign public form header with accent bar"
```

---

### Task 3: Progress Bar for Multi-Page Forms

**Files:**
- Modify: `src/app/forms/f/[slug]/page.tsx` (insert after header, before grid)

**Step 1: Add progress bar**

After the header `</div>` and before the `<div className="grid grid-cols-12 ...">`, add:

```tsx
{pages.length > 1 && (
  <div className="mb-6 h-[3px] w-full overflow-hidden rounded-full bg-border-primary/40">
    <div
      className="h-full rounded-full bg-oak-primary transition-all duration-300 ease-out"
      style={{ width: `${((currentPage + 1) / pages.length) * 100}%` }}
    />
  </div>
)}
```

**Step 2: Verify locally**

Open a multi-page form. Expected: Thin progress bar that fills as you advance pages.

**Step 3: Commit**

```bash
git add src/app/forms/f/\[slug\]/page.tsx
git commit -m "feat(forms): add progress bar for multi-page public forms"
```

---

### Task 4: Field Card Wrappers

**Files:**
- Modify: `src/app/forms/f/[slug]/page.tsx:561-784`

**Step 1: Wrap each field in a card**

Currently each field renders inside:
```tsx
<div key={field.id} className={widthClass}>
```

Change the standard field wrapper (the one at ~line 562 that wraps label + input + error) to:

```tsx
<div key={field.id} className={widthClass}>
  <div className="rounded-xl border border-border-primary/50 bg-white p-5 shadow-sm transition-shadow duration-150 hover:shadow-md">
```

And add the closing `</div>` before the outer `</div>`.

**Important:** Only wrap interactive field types (SHORT_TEXT, LONG_TEXT, DROPDOWN, SINGLE_CHOICE, MULTIPLE_CHOICE, FILE_UPLOAD, SIGNATURE). Do NOT wrap PARAGRAPH, HTML, or HIDDEN types — they already have their own styling or are invisible.

**Step 2: Update label styling**

Change labels from:
```tsx
className="mb-1.5 block text-base font-semibold text-text-primary"
```

To:
```tsx
className="mb-1.5 block text-sm font-medium text-text-secondary"
```

Apply to both the `<p>` (renderLabelAsText) and `<label>` variants.

**Step 3: Update required indicator**

Change from:
```tsx
<span className="text-status-error"> *</span>
```

To:
```tsx
<span className="text-oak-primary"> *</span>
```

**Step 4: Verify locally**

Expected: Each field in a soft white card with subtle border/shadow. Labels lighter. Required asterisk is green.

**Step 5: Commit**

```bash
git add src/app/forms/f/\[slug\]/page.tsx
git commit -m "feat(forms): add card wrappers to public form fields"
```

---

### Task 5: Input Styling Refresh

**Files:**
- Modify: `src/app/forms/f/[slug]/page.tsx`

**Step 1: Update SHORT_TEXT input**

Change (~line 612):
```tsx
className="w-full rounded-lg border border-border-primary bg-background-primary px-3 py-2 text-sm text-text-primary"
```

To:
```tsx
className={cn(
  "w-full rounded-lg border border-border-primary/60 bg-background-primary px-3.5 py-2.5 text-sm text-text-primary placeholder:text-text-muted/60",
  "focus:outline-none focus:ring-2 focus:ring-oak-primary/20 focus:border-oak-primary transition-all duration-150",
  field.isReadOnly && "bg-background-secondary cursor-not-allowed opacity-70"
)}
```

**Step 2: Update LONG_TEXT textarea**

Change (~line 640):
```tsx
className="w-full min-h-24 rounded-lg border border-border-primary bg-background-primary px-3 py-2 text-sm text-text-primary"
```

To:
```tsx
className={cn(
  "w-full min-h-24 rounded-lg border border-border-primary/60 bg-background-primary px-3.5 py-2.5 text-sm text-text-primary placeholder:text-text-muted/60",
  "focus:outline-none focus:ring-2 focus:ring-oak-primary/20 focus:border-oak-primary transition-all duration-150 resize-y",
  field.isReadOnly && "bg-background-secondary cursor-not-allowed opacity-70"
)}
```

**Step 3: Update DROPDOWN select**

Change (~line 653):
```tsx
className="w-full rounded-lg border border-border-primary bg-background-primary px-3 py-2 text-sm text-text-primary"
```

To:
```tsx
className="w-full rounded-lg border border-border-primary/60 bg-background-primary px-3.5 py-2.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-oak-primary/20 focus:border-oak-primary transition-all duration-150"
```

**Step 4: Verify locally**

Expected: Inputs have softer borders, smooth focus glow in oak-primary, slightly more padding.

**Step 5: Commit**

```bash
git add src/app/forms/f/\[slug\]/page.tsx
git commit -m "feat(forms): refresh input styling with focus rings and transitions"
```

---

### Task 6: Custom Radio Buttons

**Files:**
- Modify: `src/app/forms/f/[slug]/page.tsx:662-686`

**Step 1: Replace native radio styling**

Replace the SINGLE_CHOICE fieldset content:

```tsx
{options.map((option, index) => {
  const optionId = `${fieldDomId}-option-${index}`;
  return (
    <label key={option} htmlFor={optionId} className="flex items-center gap-2 text-sm text-text-primary">
      <input
        id={optionId}
        type="radio"
        name={field.key}
        value={option}
        checked={value === option}
        onChange={() => setFieldValue(field.key, option)}
      />
      {option}
    </label>
  );
})}
```

With:

```tsx
{options.map((option, index) => {
  const optionId = `${fieldDomId}-option-${index}`;
  const isSelected = value === option;
  return (
    <label
      key={option}
      htmlFor={optionId}
      className={cn(
        "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-all duration-150",
        isSelected
          ? "border-oak-primary/40 bg-oak-primary/5 text-text-primary"
          : "border-transparent text-text-primary hover:bg-background-secondary/50"
      )}
    >
      <input
        id={optionId}
        type="radio"
        name={field.key}
        value={option}
        checked={isSelected}
        onChange={() => setFieldValue(field.key, option)}
        className="sr-only"
      />
      <span className={cn(
        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-all duration-150",
        isSelected ? "border-oak-primary" : "border-border-primary"
      )}>
        {isSelected && <span className="h-2.5 w-2.5 rounded-full bg-oak-primary" />}
      </span>
      {option}
    </label>
  );
})}
```

**Step 2: Verify locally**

Expected: Custom circular radio indicators, selected state has oak-primary fill with subtle background highlight on the row.

**Step 3: Commit**

```bash
git add src/app/forms/f/\[slug\]/page.tsx
git commit -m "feat(forms): custom styled radio buttons for public forms"
```

---

### Task 7: Custom Checkboxes

**Files:**
- Modify: `src/app/forms/f/[slug]/page.tsx:689-720`

**Step 1: Replace native checkbox styling**

Replace the MULTIPLE_CHOICE fieldset content:

```tsx
{options.map((option, index) => {
  const current = Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  const checked = current.includes(option);
  const optionId = `${fieldDomId}-option-${index}-${toDomSafeId(option)}`;
  return (
    <label key={option} htmlFor={optionId} className="flex items-center gap-2 text-sm text-text-primary">
      <input
        id={optionId}
        type="checkbox"
        checked={checked}
        onChange={(e) => {
          if (e.target.checked) {
            setFieldValue(field.key, [...current, option]);
          } else {
            setFieldValue(field.key, current.filter((item) => item !== option));
          }
        }}
      />
      {option}
    </label>
  );
})}
```

With:

```tsx
{options.map((option, index) => {
  const current = Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  const isChecked = current.includes(option);
  const optionId = `${fieldDomId}-option-${index}-${toDomSafeId(option)}`;
  return (
    <label
      key={option}
      htmlFor={optionId}
      className={cn(
        "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-all duration-150",
        isChecked
          ? "border-oak-primary/40 bg-oak-primary/5 text-text-primary"
          : "border-transparent text-text-primary hover:bg-background-secondary/50"
      )}
    >
      <input
        id={optionId}
        type="checkbox"
        checked={isChecked}
        onChange={(e) => {
          if (e.target.checked) {
            setFieldValue(field.key, [...current, option]);
          } else {
            setFieldValue(field.key, current.filter((item) => item !== option));
          }
        }}
        className="sr-only"
      />
      <span className={cn(
        "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition-all duration-150",
        isChecked ? "border-oak-primary bg-oak-primary" : "border-border-primary"
      )}>
        {isChecked && (
          <svg className="h-3 w-3 text-white" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 6l3 3 5-5" />
          </svg>
        )}
      </span>
      {option}
    </label>
  );
})}
```

**Step 2: Verify locally**

Expected: Custom square checkboxes with rounded corners, oak-primary fill when checked with white checkmark.

**Step 3: Commit**

```bash
git add src/app/forms/f/\[slug\]/page.tsx
git commit -m "feat(forms): custom styled checkboxes for public forms"
```

---

### Task 8: Error State Styling

**Files:**
- Modify: `src/app/forms/f/[slug]/page.tsx`

**Step 1: Add error ring to field cards**

In the card wrapper div added in Task 4, make the border conditional on error state:

```tsx
<div className={cn(
  "rounded-xl border bg-white p-5 shadow-sm transition-shadow duration-150 hover:shadow-md",
  errorText ? "border-status-error/40 ring-1 ring-status-error/20" : "border-border-primary/50"
)}>
```

**Step 2: Verify locally**

Expected: Fields with errors have a red-tinted border and subtle red ring.

**Step 3: Commit**

```bash
git add src/app/forms/f/\[slug\]/page.tsx
git commit -m "feat(forms): add error ring styling to field cards"
```

---

### Task 9: Navigation Buttons Redesign

**Files:**
- Modify: `src/app/forms/f/[slug]/page.tsx:789-812`

**Step 1: Update navigation section**

Replace the footer navigation:

```tsx
<div className="mt-6 flex items-center justify-between">
  {currentPage > 0 ? (
    <Button variant="secondary" size="sm" leftIcon={<ArrowLeft className="w-4 h-4" />} onClick={() => setCurrentPage((prev) => prev - 1)}>
      Back
    </Button>
  ) : <div />}

  {currentPage < pages.length - 1 ? (
    <Button
      variant="primary"
      size="sm"
      onClick={() => {
        if (!validateCurrentPage()) return;
        setCurrentPage((prev) => prev + 1);
      }}
    >
      Continue
    </Button>
  ) : (
    <Button variant="primary" size="sm" onClick={submitForm} isLoading={isSubmitting} disabled={isPreview}>
      {isPreview ? 'Preview mode' : 'Submit'}
    </Button>
  )}
</div>
```

With:

```tsx
<div className="mt-8 flex items-center justify-between">
  {currentPage > 0 ? (
    <button
      type="button"
      onClick={() => setCurrentPage((prev) => prev - 1)}
      className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors duration-150"
    >
      <ArrowLeft className="h-4 w-4" />
      Back
    </button>
  ) : <div />}

  <div className="flex items-center gap-3">
    {pages.length > 1 && (
      <span className="text-xs text-text-muted">
        {currentPage + 1} of {pages.length}
      </span>
    )}
    {currentPage < pages.length - 1 ? (
      <Button
        variant="primary"
        size="sm"
        className="rounded-xl px-6 py-2.5 transition-transform duration-150 hover:scale-[1.02]"
        onClick={() => {
          if (!validateCurrentPage()) return;
          setCurrentPage((prev) => prev + 1);
        }}
      >
        Continue
      </Button>
    ) : (
      <Button
        variant="primary"
        size="sm"
        className="rounded-xl px-6 py-2.5 transition-transform duration-150 hover:scale-[1.02]"
        onClick={submitForm}
        isLoading={isSubmitting}
        disabled={isPreview}
      >
        {isPreview ? 'Preview mode' : 'Submit'}
      </Button>
    )}
  </div>
</div>
```

**Step 2: Verify locally**

Expected: Back button is ghost text, page counter visible, Continue/Submit has rounded-xl and subtle scale on hover.

**Step 3: Commit**

```bash
git add src/app/forms/f/\[slug\]/page.tsx
git commit -m "feat(forms): redesign navigation with ghost back button and page counter"
```

---

### Task 10: Success Page Redesign

**Files:**
- Modify: `src/app/forms/f/[slug]/page.tsx:402-457`

**Step 1: Update success page**

Replace the entire success page return block with:

```tsx
return (
  <div className="min-h-screen bg-gradient-to-br from-slate-50 to-stone-100 p-4 sm:p-8 flex items-center justify-center">
    <div className="w-full max-w-xl rounded-xl bg-white p-6 sm:p-8 shadow-sm">
      <div className="flex items-center gap-3">
        <CheckCircle2 className="h-6 w-6 text-status-success shrink-0" />
        <div>
          <h1 className="text-lg font-semibold text-text-primary">Response submitted</h1>
          <p className="text-sm text-text-secondary">Your response has been recorded.</p>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          size="sm"
          leftIcon={<Download className="h-4 w-4" />}
          onClick={() => {
            if (!downloadHref) return;
            window.open(downloadHref, '_blank', 'noopener,noreferrer');
          }}
          disabled={!downloadHref}
        >
          Download PDF
        </Button>
      </div>
      {!downloadHref && (
        <p className="mt-2 text-xs text-text-muted">Download link expired. Submit the form again to generate a new link.</p>
      )}

      <div className="mt-6 rounded-lg border border-border-primary/50 bg-background-primary p-3">
        <label className="mb-1.5 block text-xs font-medium text-text-secondary">Email a PDF copy</label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="email"
            value={pdfRecipientEmail}
            onChange={(e) => {
              setPdfRecipientEmail(e.target.value);
              if (emailFeedback) setEmailFeedback(null);
            }}
            placeholder="name@example.com"
            className="w-full rounded-lg border border-border-primary/60 bg-background-primary px-3.5 py-2.5 text-sm text-text-primary placeholder:text-text-muted/60 focus:outline-none focus:ring-2 focus:ring-oak-primary/20 focus:border-oak-primary transition-all duration-150"
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            leftIcon={<Mail className="h-4 w-4" />}
            onClick={sendSubmissionPdfEmail}
            isLoading={isSendingEmail}
          >
            Send
          </Button>
        </div>
        {emailFeedback && (
          <p className="mt-2 text-xs text-text-secondary">{emailFeedback}</p>
        )}
      </div>
    </div>
  </div>
);
```

**Step 2: Verify locally**

Expected: Clean, professional success page. Green check icon inline with text, no animation, no "Thank you".

**Step 3: Commit**

```bash
git add src/app/forms/f/\[slug\]/page.tsx
git commit -m "feat(forms): redesign success page with clean professional layout"
```

---

### Task 11: Header Information Blocks

**Files:**
- Modify: `src/components/forms/builder-utils.ts:28-36` (add new inputTypes)
- Modify: `src/components/forms/field-editor-drawer.tsx` (add header options to PARAGRAPH type selector)
- Modify: `src/app/forms/f/[slug]/page.tsx:496-549` (render header blocks)

**Step 1: Add header inputTypes to ShortInputType**

In `src/components/forms/builder-utils.ts`, update the type:

```typescript
export type ShortInputType =
  | 'text'
  | 'email'
  | 'phone'
  | 'number'
  | 'date'
  | 'info_text'
  | 'info_image'
  | 'info_url'
  | 'info_heading_1'
  | 'info_heading_2'
  | 'info_heading_3';
```

**Step 2: Add header options to field editor**

In `src/components/forms/field-editor-drawer.tsx`, find the PARAGRAPH type selector `<select>` and add new options:

```tsx
<option value="info_text">Text block</option>
<option value="info_image">Image</option>
<option value="info_url">URL / Link</option>
<option value="info_heading_1">Heading 1</option>
<option value="info_heading_2">Heading 2</option>
<option value="info_heading_3">Heading 3</option>
```

Also update the `INFO_INPUT_TYPES` array to include the new types:

```typescript
const INFO_INPUT_TYPES: ReadonlyArray<ShortInputType> = ['info_text', 'info_image', 'info_url', 'info_heading_1', 'info_heading_2', 'info_heading_3'];
```

**Step 3: Render header blocks in public form**

In `src/app/forms/f/[slug]/page.tsx`, inside the PARAGRAPH rendering section (before the `info_image` check), add:

```tsx
if (field.type === 'PARAGRAPH') {
  const headingType = field.inputType === 'info_heading_1' ? 'h1'
    : field.inputType === 'info_heading_2' ? 'h2'
    : field.inputType === 'info_heading_3' ? 'h3'
    : null;

  if (headingType) {
    const headingClasses = {
      h1: 'text-xl font-bold text-text-primary mt-6 mb-2',
      h2: 'text-lg font-semibold text-text-primary mt-4 mb-1.5',
      h3: 'text-base font-semibold text-text-primary mt-3 mb-1',
    };
    const Tag = headingType;
    return (
      <div key={field.id} className={widthClass}>
        <Tag className={headingClasses[headingType]}>
          {field.label || field.subtext}
        </Tag>
        {field.subtext && field.label && (
          <p className="text-sm text-text-secondary">{field.subtext}</p>
        )}
      </div>
    );
  }

  if (infoType === 'info_image') {
    // ... existing code
```

**Step 4: Verify locally**

Add a PARAGRAPH field with each heading type in the form builder. Confirm they render as section dividers without card wrappers.

**Step 5: Commit**

```bash
git add src/components/forms/builder-utils.ts src/components/forms/field-editor-drawer.tsx src/app/forms/f/\[slug\]/page.tsx
git commit -m "feat(forms): add H1/H2/H3 heading blocks for section dividers"
```

---

### Task 12: File Upload Card Polish

**Files:**
- Modify: `src/app/forms/f/[slug]/page.tsx:722-763`

**Step 1: Update file upload styling**

Update the FILE_UPLOAD section to use `rounded-xl` and match the card styling:

Change:
```tsx
<div className={cn(
  'rounded-lg border border-dashed bg-background-primary p-4 text-center',
  uploadStatus ? 'border-status-success/40' : 'border-border-primary'
)}>
```

To:
```tsx
<div className={cn(
  'rounded-xl border border-dashed bg-background-primary/50 p-6 text-center transition-colors duration-150',
  uploadStatus ? 'border-status-success/40' : 'border-border-primary/60 hover:border-oak-primary/40'
)}>
```

**Step 2: Commit**

```bash
git add src/app/forms/f/\[slug\]/page.tsx
git commit -m "feat(forms): polish file upload card styling"
```

---

### Task 13: Loading & Error State Polish

**Files:**
- Modify: `src/app/forms/f/[slug]/page.tsx` (loading and error return blocks, before the main form return)

**Step 1: Update loading state**

Find the loading state return and update it to use the gradient background:

Replace `bg-background-primary` with `bg-gradient-to-br from-slate-50 to-stone-100` in the loading spinner wrapper.

**Step 2: Update error state**

Find the error state return and apply the same gradient background.

**Step 3: Commit**

```bash
git add src/app/forms/f/\[slug\]/page.tsx
git commit -m "feat(forms): apply gradient background to loading and error states"
```

---

### Task 14: Visual QA & Final Adjustments

**Step 1: Full visual review**

Test the following in the browser:
- Single-page form with all field types
- Multi-page form with progress bar
- Form with validation errors
- File upload flow
- Success page after submission
- Mobile viewport (resize to 375px width)
- Embed mode (`?embed=1`)

**Step 2: Fix any spacing/alignment issues found**

**Step 3: Final commit**

```bash
git add src/app/forms/f/\[slug\]/page.tsx
git commit -m "feat(forms): final visual adjustments for public form redesign"
```
