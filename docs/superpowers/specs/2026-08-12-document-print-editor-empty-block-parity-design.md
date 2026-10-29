# Document Print and Editor Empty-Block Parity

## Goal

Ensure generated-document print, HTML, and PDF output paginate list content the
same way as the A4 editor. Empty paragraphs and divs that collapse in the editor
must not acquire print-only height.

## Root Cause

The shared print stylesheet applies `min-height: 1em` to `p:empty` and
`div:empty`, while the editor stylesheet has no equivalent rule. Generated list
items can contain leading empty paragraphs. Those paragraphs collapse in the
editor but consume a line in print and PDF output, accumulating enough height to
move list text to another page and leave its marker behind.

## Design

Remove the print-only empty-block height rule from `buildA4PrintCss`. Preserve
the existing `<br>` behavior so intentional blank lines represented by editor
line breaks continue to render. Do not add a replacement list-specific rule or
change the editor layout; print and export should follow the editor's existing
collapsed-empty-block behavior everywhere.

The ordered-list counter, marker, hanging-indent, continuation, and nested-list
rules remain unchanged.

## Verification

- Add a print-styles regression test proving empty paragraphs and divs receive
  no print-only minimum height.
- Keep the existing ordered-list and continuation-style tests passing.
- Run the focused unit test suite for the shared print stylesheet.
- Run the relevant A4 browser pagination tests.
- Validate the generated-document editor-to-print flow in the rendered app,
  checking page identity, console health, list alignment, and page-break parity.

## Documentation

Update `docs/ARCHITECTURE.md` to make empty-block layout parity an explicit part
of the shared editor, preview, print, HTML, and PDF contract.
