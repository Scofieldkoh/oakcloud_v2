# Public Form Field Grouping — Design

> **Date**: 2026-03-05
> **Status**: Design
> **File**: `src/app/forms/f/[slug]/page.tsx`

## Goal

Replace individual per-field cards with grouped section cards so that related fields feel cohesive rather than detached floating tiles.

---

## Problem

Every input field is currently wrapped in its own `rounded-xl border bg-white p-5 shadow-sm` card. On a form with many fields, this produces a stack of independent floating boxes — visually noisy and disconnected.

---

## Solution: Grouped Section Cards

Fields are grouped into sections at render time. A section card wraps all consecutive "card-eligible" fields between structural boundaries. Heading blocks serve as section titles rendered above the card.

---

## 1. Grouping Algorithm

Build a flat list of **render items** before the JSX render loop:

```ts
type RenderItem =
  | { kind: 'group'; heading: PublicField | null; fields: PublicField[] }
  | { kind: 'standalone'; field: PublicField }  // info_text, info_url, info_image, HTML, repeat markers
```

**Group boundary triggers** (start a new group):
- First field on the page
- Any heading block (`info_heading_1 / 2 / 3`) — heading becomes the group's title, rendered outside/above the card
- `PAGE_BREAK` (already handled separately — renders null)

**Standalone items** (rendered between cards, not inside them):
- `PARAGRAPH` with `info_text`, `info_url`, `info_image`
- `HTML` blocks
- `HIDDEN` fields (render null as today)
- Repeat section start/end markers

**Card-eligible** (go inside group cards):
- `SHORT_TEXT`, `LONG_TEXT`, `DROPDOWN`, `SINGLE_CHOICE`, `MULTIPLE_CHOICE`, `FILE_UPLOAD`, `SIGNATURE`, `DATE` (all non-PARAGRAPH, non-HTML, non-PAGE_BREAK, non-HIDDEN types)

**Empty group pruning**: if a heading block is followed immediately by another heading (no card-eligible fields in between), skip rendering an empty card.

---

## 2. Group Card Visual Structure

```
[Heading block text — no card, rendered above, same heading styles as today]
┌────────────────────────────────────────────────────────────────────────┐  ← rounded-xl border border-border-primary/50 bg-white shadow-sm
│  p-5 outer padding                                                      │
│  ┌─ 12-col sub-grid ──────────────────────────────────────────────────┐ │
│  │  [Field row: label + input, full width or partial columns]         │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│  border-t border-border-primary/20 mt-4 pt-4                            │  ← divider between rows
│  ┌─ 12-col sub-grid ──────────────────────────────────────────────────┐ │
│  │  [Field 2 — col-span-4]  [Field 3 — col-span-4]  [Field 4 — ...]  │ │
│  └────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

**Group card styles:**
| Property | Value |
|---|---|
| Background | `bg-white` |
| Border | `border border-border-primary/50` |
| Border (error) | `border-status-error/40 ring-1 ring-status-error/20` |
| Shadow | `shadow-sm` |
| Radius | `rounded-xl` |
| Padding | `p-5` |
| Gap between groups | `gap-4` (same as today's field gap) |

**Fields inside the card:**
- No individual card wrapper — just label + input/control directly
- Between field rows: `border-t border-border-primary/20 mt-4 pt-4`
- Fields on the same layout row (consecutive fields with combined width ≤ 100) share a grid row — same 12-col grid as today

**Row grouping within a card**: consecutive fields whose `layoutWidth` values sum to ≤ 100 are placed in the same grid row. When adding the next field would exceed 100, start a new row. This preserves the existing column layout behaviour.

---

## 3. Field Rendering Inside the Card

Each field inside a card renders identically to today **except** no outer card div. The inner structure:

```tsx
<div className={widthClass}>                         // col-span-N (same as today)
  {/* label */}
  <label className="mb-1.5 block text-sm font-medium text-text-secondary">
    {label}{isRequired && <span className="text-oak-primary"> *</span>}
  </label>
  {/* input/control (unchanged) */}
  {/* error message */}
  {errorText && <p className="mt-1 text-xs text-status-error">...</p>}
</div>
```

---

## 4. Error State on Group Card

If **any field** in the group has a validation error, the group card gets:
```
border-status-error/40 ring-1 ring-status-error/20
```
Individual field error messages still appear inline below the input (unchanged).

---

## 5. Standalone Item Rendering

Items that render between cards (unchanged from today):
- `info_text` → rounded border text block
- `info_url` → rounded border link
- `info_image` → image block with `max-h-96 object-contain`
- `HTML` → sanitized HTML, no card
- Repeat section markers → existing nested card implementation

---

## 6. Edge Cases

| Situation | Behaviour |
|---|---|
| Form with no headings | All card-eligible fields go into a single unnamed group card |
| Heading with no following fields | Skip empty group card — heading still renders |
| Consecutive headings | Each starts a new group; empty groups are pruned |
| Single field in a group | Card still wraps it — consistent appearance |
| Repeat section inside a group | Repeat card renders as a full-width item inside the group card's grid |
| Mixed widths on one row | Same 12-col grid as today — if widths sum >12, Next.js/Tailwind wraps naturally |

---

## 7. Implementation Scope

- All changes in `src/app/forms/f/[slug]/page.tsx`
- No new files, no schema changes
- The grouping algorithm is a pure function over `visibleFields[]` → `RenderItem[]`
- Repeat section rendering is kept intact inside the group card

---

## Out of Scope

- Grouping in the form builder canvas (builder-side cards are separate)
- Changing the grouping logic for embed mode (same grouping applies)
- Animating the card expansion/collapse
