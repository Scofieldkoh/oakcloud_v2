# A4 Template Editor Workflow Redesign

## Status

Approved for implementation planning on 2026-07-10.

## Objective

Make the A4 template editor behave like one continuous document while retaining
separate A4 page visuals. Correct the remaining pagination interactions, persist
document layout, and redesign the toolbar and side panel around the tasks a
template author performs most often.

## Scope

This redesign covers:

- Forward Delete, Backspace, and range deletion across physical pages.
- Native mouse selection across page boundaries.
- Atomic creation and deletion of explicit pages.
- Persistent line spacing, paragraph spacing, and four independent margins.
- A clearer, task-oriented formatting and page toolbar.
- A collapsible and resizable template side panel.
- Searchable placeholders and guided loop and condition builders.
- Validation and preview feedback for template constructs.
- Matching layout behavior in template editing, generated-document editing,
  preview, print, and export.

The redesign does not introduce a new rich-text framework, change the public
meaning of hard page breaks, or require a database migration.

## Experience Principles

1. The document behaves continuously even though it is displayed as pages.
2. Common formatting and insertion actions are immediately understandable.
3. Template syntax is generated safely by default and remains inspectable by
   advanced users.
4. Page and layout actions are atomic, predictable, and undoable.
5. The interface follows Oakcloud's compact, dense, four-pixel-grid design
   system and works in light and dark themes.

## Document Interaction Architecture

### One editable surface

The editor will render one `contenteditable` document root. Physical A4 page
containers are children of that root and remain derived pagination fragments.
Page chrome, controls, and page numbers are non-editable descendants or sibling
overlays.

This replaces the current set of independent page-level editable roots. A
single editable root gives the browser one native selection tree, allowing
dragging, Shift-selection, copying, and deleting across pages without a custom
selection overlay.

The canonical document remains the authority for content, selection, and
history. Pagination fragments remain an internal layout representation and are
never serialized as soft page boundaries.

### Logical keyboard behavior

- Backspace at a soft page boundary deletes the preceding logical character.
- Delete at a soft page boundary deletes the following logical character.
- A selection spanning physical pages is replaced or removed once using its
  canonical logical range.
- Backspace immediately after a hard break removes the break and reflows the
  joined sections.
- Delete immediately before a hard break removes the break and reflows the
  joined sections.
- Editing a hard-break-delimited section cannot silently remove its break.
- Clipboard operations use the same logical document range and preserve valid
  block structure.

### Atomic page actions

"Add blank page" appends or inserts a hard page break followed by one empty
paragraph. "Insert page break" splits the current valid block at the caret.
"Delete current page" removes the selected hard-break section and its adjacent
break according to its position.

Each action updates the canonical document once, schedules one reflow frame,
and creates one history entry. A monotonic reflow generation prevents an older
measurement result from replacing the newer page action. The empty paragraph
makes an intentionally blank hard page persistent.

## Layout Model and Persistence

### Settings

The editor will use a versioned document layout model:

```ts
interface A4DocumentLayout {
  version: 1;
  lineHeight: number;
  paragraphSpacing: string;
  marginsMm: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
}
```

Defaults preserve current behavior for templates without saved settings.
Margin values are validated against a safe range that leaves a usable content
area. Invalid stored values fall back to defaults rather than breaking layout.

### Storage

Layout metadata is stored under the existing `DocumentTemplate.contentJson`
JSON field:

```json
{
  "version": 1,
  "layout": {
    "lineHeight": 1.5,
    "paragraphSpacing": "0.5em",
    "marginsMm": {
      "top": 20,
      "right": 20,
      "bottom": 20,
      "left": 20
    }
  }
}
```

Reads and writes preserve unrelated keys in `contentJson`. Template create and
update requests save content and layout in the same request. External content
updates do not echo an editor change, while user layout changes mark the
template form dirty without emitting a content mutation.

Generated-document and preview paths consume the template layout when it is
available. Existing documents without layout metadata continue to use default
settings.

### Public component compatibility

Existing `A4PageEditorProps` and `A4PageEditorRef` members retain their current
meaning. `A4PageEditorProps` gains optional `layout` and `onLayoutChange`
members for controlled template layout. Existing callers that do not pass them
continue to work with defaults.

## Toolbar Redesign

The toolbar remains compact and sticky, but actions are grouped by purpose:

1. History: Undo and Redo.
2. Text: style, bold, italic, underline, and clear formatting.
3. Paragraph: alignment, lists, indent, and line spacing.
4. Insert: table, placeholder insertion entry point, and page break.
5. Page: add blank page, delete current page, and margins.
6. View: page numbers and preview/edit mode.

Groups use subtle separators, consistent 32-pixel controls, visible active
states, keyboard shortcut hints, and accessible tooltips. Commands with several
settings use a labeled popover rather than another row of unexplained icons.
Uncommon actions move into a compact overflow menu on narrower screens.

The page menu explicitly distinguishes "Insert page break", "Add blank page",
and "Delete current page" and explains their effects. Destructive actions use
the existing error color only at the point of action.

The margin popover begins with "Same on all sides" enabled. Disabling it reveals
Top, Right, Bottom, and Left numeric fields. Changes preview and repaginate on
the next animation frame.

## Side Panel Redesign

The right panel is collapsible, resizable within sensible bounds, and organized
into three task-oriented tabs.

### Template

- Name, description, category, active state, and document layout.
- Clear required indicators and concise helper text.
- A compact saved/unsaved status near the panel header.
- Layout controls mirror toolbar settings and stay synchronized.

### Fields

- Search across keys, labels, categories, and examples.
- Recently used fields at the top when available.
- Categories for Company, Directors, Shareholders, Custom, Loops, Conditions,
  Partials, and Modifiers, each with a result count.
- A primary Insert action and secondary Copy action per field.
- Human-readable labels first, with template syntax shown as supporting text.
- Empty states explain how to create a custom field or clear a search.

Custom placeholder creation uses a focused form for label, generated/editable
key, type, required state, default value, and a live insertion preview. Duplicate
or invalid keys are explained inline.

### Guided loops and conditions

Collection entries open a guided builder instead of inserting an incomplete
opening tag. For a loop, the author selects a collection, output fields, and a
starter layout. The builder inserts a balanced opening tag, starter content,
and closing tag as one editor transaction.

Condition builders use sentence-style inputs for the field, comparison, and
value, then insert a balanced block. Both builders include a collapsed "View
syntax" section for advanced users. Generated syntax remains editable in the
document.

### Test and Preview

- Sample data inputs grouped by source.
- A validation summary for unmatched block tags, unknown placeholders, empty
  loops, and unresolved partial links.
- Selecting an issue focuses the corresponding document block when possible.
- Preview uses the same paginator and saved layout as editing and export.

## State and Data Flow

1. The template route loads canonical HTML, placeholders, partial linkings, and
   versioned layout metadata.
2. The editor hydrates one canonical flow document and derives physical pages.
3. A user input transaction captures a logical selection, mutates canonical
   content or layout, schedules one reflow, commits derived pages once, and
   restores the selection.
4. Content and layout independently update the parent form's dirty state.
5. Save serializes sanitized continuous HTML, placeholder definitions, partial
   linkings, and merged `contentJson` layout metadata in one request.
6. Reload restores layout before the first measured pagination pass.

## Error Handling and Accessibility

- Unsupported or oversized blocks render once with the existing overflow
  indicator and remain editable where possible.
- Invalid saved layout metadata falls back safely and produces no rendering
  exception.
- Toolbar buttons expose accessible names, pressed state, and shortcut text.
- Popovers support keyboard navigation, Escape dismissal, and focus return.
- The resizable panel retains a keyboard-accessible collapse control.
- Validation messages explain the problem and the corrective action without
  exposing internal parser terminology unnecessarily.

## Testing Strategy

### Deterministic unit tests

- Forward Delete and Backspace at soft and hard boundaries.
- Multi-page logical range deletion and replacement.
- Hard blank-page persistence and page-section deletion.
- Stale reflow cancellation after rapid page actions.
- Layout normalization, independent margin calculations, and fallback values.
- `contentJson` merging without loss of unrelated metadata.
- Guided loop and condition builders always produce balanced valid blocks.

### Component tests

- One `onChange` and one history entry per interaction.
- Native selection can span two physical page fragments in one editable root.
- Add and Delete Page persist after the first click.
- Undo and Redo restore page actions, content, layout, and selection.
- Saved line spacing and margins reload correctly.
- Toolbar active state, popover behavior, panel search, custom-field validation,
  and guided insertion behavior.
- Existing ref methods and uncontrolled callers remain compatible.

### Browser verification

Chromium-backed tests will exercise the actual template-editor workflow:

- Drag-select across pages, then Delete, copy, paste, and replace.
- Delete at the end of a page pulls following content backward.
- Add and delete an explicit blank page with one click each.
- Save, reload, and verify line spacing and four margins.
- Insert a guided directors loop and validate its preview.
- Resize and collapse the side panel and exercise toolbar overflow.
- Check desktop and a narrower viewport for clipping and scroll traps.
- Confirm no framework overlay or relevant console errors.

The existing A4 pagination, document generation, preview, export, TypeScript,
ESLint, production build, and Docker build checks remain required.

## Acceptance Criteria

- Forward Delete works everywhere Backspace has a corresponding behavior.
- Mouse selection crosses any number of soft physical pages naturally.
- Add Page and Delete Page persist after one action without flicker.
- Line spacing and independent margins survive save and reload.
- Editor, preview, print, and export use the same saved layout semantics.
- Common toolbar actions are grouped, labeled, accessible, and discoverable.
- Placeholders can be searched and inserted without knowing syntax.
- Loop and condition builders insert balanced blocks in one action.
- Pagination remains deterministic with no content loss, duplication,
  oscillation, stale commits, or extra undo entries.
- Existing templates load without migration and existing public editor callers
  remain compatible.
