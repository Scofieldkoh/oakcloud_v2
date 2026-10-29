# Public Form Redesign — Conversational Card

> **Date**: 2026-03-04
> **Status**: Design
> **File**: `src/app/forms/f/[slug]/page.tsx`

## Goal

Redesign the public-facing form page to be visually modern, friendly, and approachable. Single default theme, no customization controls. Target audience: general public / casual users.

## Design Direction

"Conversational Card" — each field lives in a soft card with generous padding. Clean, modern, warm.

---

## 1. Page Layout & Background

- **Background**: Subtle warm gradient `bg-gradient-to-br from-slate-50 to-stone-100`
- **Container**: `max-w-4xl` (keep current width), centered, no outer border
- **No outer card wrapper** — fields float on the gradient background

## 2. Header Area

- **Title**: `text-2xl font-bold text-text-primary`
- **Description**: `text-base text-text-secondary` with relaxed line height
- **Accent**: 3px rounded bar in `oak-primary` below description (decorative separator)
- **Spacing**: `mb-8` below header

## 3. Progress Bar (multi-page only)

- **Position**: Top of form area, below header
- **Style**: Thin 3px bar, `bg-border-primary` track, `bg-oak-primary` fill
- **Width**: `(currentPage + 1) / totalPages * 100%`
- **Animation**: `transition-all duration-300 ease-out`
- **Hidden** for single-page forms

## 4. Field Cards

Each field wrapped in a card:

| Property | Value |
|----------|-------|
| Background | `bg-white` / `bg-background-elevated` |
| Border | `border border-border-primary/50` |
| Shadow | `shadow-sm`, hover: `shadow-md` |
| Radius | `rounded-xl` (16px) |
| Padding | `p-5` |
| Gap | `gap-4` between cards |
| Transition | `transition-shadow duration-150` |

- **Labels**: `text-sm font-medium text-text-secondary` (lighter than current bold)
- **Required indicator**: `*` in `oak-primary` color (not red)
- Fields on the same grid row share a card when grouped

## 5. Input Styling

| Property | Value |
|----------|-------|
| Border | `border-border-primary/60 rounded-lg` |
| Focus | `focus:ring-2 focus:ring-oak-primary/20 focus:border-oak-primary` |
| Padding | `px-3.5 py-2.5` |
| Transition | `transition-all duration-150` |
| Placeholder | `placeholder:text-text-muted/60` |
| Read-only | `bg-background-secondary cursor-not-allowed opacity-70` |

## 6. Custom Radio & Checkbox

**Radio buttons:**
- Circle: `w-5 h-5 rounded-full border-2 border-border-primary`
- Selected: `border-oak-primary` with `bg-oak-primary` inner dot (scale animation)
- Each option: clickable row with `rounded-lg hover:bg-background-secondary/50 px-3 py-2.5`

**Checkboxes:**
- Box: `w-5 h-5 rounded-md border-2 border-border-primary`
- Checked: `bg-oak-primary border-oak-primary` with white checkmark
- Same clickable row styling as radio

## 7. Dropdown

- `appearance-none` with custom chevron icon
- Same input styling (border, focus, padding)

## 8. Information Blocks

### Paragraph (info_text)
- Same as current: rounded card, `bg-background-primary`, subtle border

### Header Block (NEW)
- Support H1, H2, H3 variants as section dividers
- **No card wrapper** — renders directly on the background
- H1: `text-xl font-bold text-text-primary mt-6 mb-2`
- H2: `text-lg font-semibold text-text-primary mt-4 mb-1.5`
- H3: `text-base font-semibold text-text-primary mt-3 mb-1`
- Optional subtext below in `text-sm text-text-secondary`

### Image Block (info_image)
- Same as current but with `rounded-xl` and `shadow-sm`

### URL Block (info_url)
- Same as current styling

## 9. Navigation / Buttons

- **Continue/Submit**: `rounded-xl px-6 py-2.5`, hover: `hover:scale-[1.02] hover:shadow-md`
- **Back**: Ghost/text style — no border, just text + arrow
- **Layout**: Right-aligned button, page indicator centered ("Page 1 of 3")

## 10. Error States

- Field border: `border-status-error/60`
- Error message: Small warning icon + `text-status-error text-xs`
- Card: `ring-1 ring-status-error/20` highlight

## 11. Success Page

Clean and professional — no animations, no celebration:

- Centered card, `max-w-xl`
- Small green `CheckCircle2` icon (24px), `text-status-success`
- Title: "Response submitted" — `text-lg font-semibold`
- Subtitle: "Your response has been recorded." — `text-sm text-text-secondary`
- PDF download button and email section as compact sub-sections
- No confetti, no animated checkmarks, no "Thank you!"

## 12. File Upload

- Dashed border card with `rounded-xl`
- Upload icon + "Choose a file" link
- On upload: green accent border, file name + size in compact row
- Same hover shadow as field cards

## 13. Signature Pad

- Wrapped in card with same styling
- Clear button as ghost text link

---

## Out of Scope

- Theming / customization by form creators
- One-at-a-time field display mode
- Dark mode for public forms (keep light only)
- New field types beyond header blocks

## Implementation Notes

- All changes in `src/app/forms/f/[slug]/page.tsx`
- Header block support may need `form-utils.ts` updates (new inputType or field type)
- Use existing Tailwind tokens — no new CSS files needed
- Custom radio/checkbox are pure CSS (no new component files needed)
