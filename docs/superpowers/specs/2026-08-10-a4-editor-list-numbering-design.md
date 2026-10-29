# A4 Editor List Numbering and Layout Design

**Date:** 2026-08-10

**Status:** Approved by user (design reviewed in conversation)

## Goal

Improve numbered/bulleted list behavior in the A4 editor (document generation and template editing):

1. Remove the slight left indent so list text is flush with normal paragraph text.
2. Support sub numbered lists rendered as 1.1, 1.2.
3. Support alphabetical lists rendered as a), b), c).
4. Plain indent must move the number together with the item content.
5. Support setting a custom starting number per list (e.g., start from 2, Word-style).
6. Fix the Enter-twice flow so a fast second Enter exits the list instead of creating extra numbered items.

## Approach

Replace native browser list markers with CSS counters for ordered lists. This gives one consistent mechanism for decimal numbering, custom start values, alpha numbering, and nested 1.1-style numbering.

### Numbering model

- `ol` gets `list-style: none` and a `counter-reset: item var(--list-start, 0)`.
- Each `ol > li::before` increments `item` and renders `counter(item) ". "`.
- `ol.list-alpha > li::before` renders `counter(item, lower-alpha) ") "` instead.
- Nested `ol ol` resets `item` and renders `counters(item, ".") " "` for 1.1 / 1.2.
- Custom start values persist as `start="N"` on the `ol`, plus an inline `--list-start: N-1` style. `start` is added to every sanitizer allowlist so it survives save, paste, and export.
- The Start-at field is always visible in the toolbar (enabled only when the caret is inside an ordered or alpha list).
- `ul` renders its bullet via `::before` (`content: "•"`) with zero left padding for flush alignment.
- Markers use a hanging indent: each `li` is `position: relative` with the `::before` marker absolutely positioned at `left: 0`. The marker and the first content line share the same line, and wrapped continuation lines align under the content (not under the marker). Marker columns: bullets `2ch`, top-level numbers `5ch`, two-digit sub-numbers `6ch` (covers `XX.XX`), deeper nesting `8ch`.
- Nested lists have no default padding (`padding-left: 0`), so sub-item markers align with the parent item's content.
- Plain indent applies `margin-left` to only the innermost `li`, so indenting a sub-item never shifts the parent list.
- A **Bold list numbers** toolbar toggle adds `list-bold-numbers` to the `ol`, rendering markers with `font-weight: 700`.

The same rules are applied to both A4 CSS sources so edit, preview, print, HTML export, and PDF export stay consistent: the inline `<style>` block in `a4-page-editor.tsx` and `buildA4PrintCss()` in `a4-print-styles.ts`.

### Toolbar

- Keep Bulleted and Numbered list toggles.
- Add an **Alphabetical list** toggle producing `ol.list-alpha`.
- Add a **Nested list** toggle that sinks the selected item under the previous item (creating `li > ol`/`li > ul` of the same type); clicking again on a nested item lifts it back to the parent list. Disabled/no-op on the first item.
- Add a **Start at** number input (always visible, enabled inside ordered/alpha lists). Committing a value sets the list's `start` attribute.
- Add a **Bold list numbers** toggle for ordered-list markers.
- Plain indent/outdent now applies `margin-left` to the `li` (not the inner `p`) so the marker moves with the content.

### Enter-twice exit fix

Root cause: a fast second Enter can fire before the first transaction's repagination and caret restore complete, so the caret still points at the old item text and the second Enter splits it again, producing extra empty numbered items.

Fix: when Enter lands at the very end of a non-empty list item whose list already ends with an empty item, treat it as the exit press — remove the empty item and place a plain paragraph after the list. This keeps the Word-style "type, Enter, Enter → out" flow even when typing fast.

Deliberate divergence from Word: if a list already ends with an empty item and the caret is at the end of the item above it, Enter exits the list rather than inserting another item. This is rare and was flagged to the user during design.

### Format state

`EditorFormatState` gains:

- `list: 'none' | 'ordered' | 'unordered' | 'alpha'` — alpha is an ordered list carrying `list-alpha`.
- `listStart: number` — the current `start` value of the enclosing ordered list (default 1), used by the Start-at control.

## Scope notes

- Numbering continues across printed pages: the pagination engine splits lists at item boundaries and records the running counter (`--flow-list-start`) on continuation fragments so CSS counters keep counting. When a single oversized item must split mid-item, its continuation half renders without a new marker (`data-flow-continuation-item`) and the following items keep their original numbers.
- Mid-item continuation marking is recursive: when an oversized nested item (e.g., 3.1) splits across pages, the continuation halves at every nesting level render without repeated markers, and each nested list records its own `--flow-list-start` so subsequent sub-items keep their numbers (3.2, not 3.1 again).
- Sink/lift and Start-at operate on the selected items/lists only; no document-wide numbering settings.

## Testing

- Unit tests for each transaction: alpha creation/switch/toggle, sink/lift, indent-on-li, list start.
- Unit tests for Enter forwarding and the existing empty-item exit.
- CSS assertions for the counter rules in `a4-print-styles.test.ts`.
- Browser tests: rapid double-Enter exit, toolbar alpha/nested/start interactions, rendered `::before` content (e.g., `"2. "`, `"1.1 "`, `"b) "`), and indent moving the marker.
- Existing list tests that asserted margin on `li > p` are updated to assert margin on `li`.
