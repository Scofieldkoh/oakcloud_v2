# OakDoc P1: imported DOCX normal-delete layout corruption

## Reproduction fixture

Affected file: `Board Resolution - CoSec Appointment 11 Feb 2026.docx`.

The fixture has zero OakDoc fields, repeaters, and conditional sections in the reported reproduction.
The failure is therefore independent of OakDoc content-control cleanup.

## Structural baseline

The main document contains no Word tables, so the failure is not a `w:tc` / `w:tcW` /
`w:tblGrid` collapse.

The important structure is paragraph-level section properties:

- `w14:paraId=2C869079`: continuous, single-column section.
- `w14:paraId=181E47F4`: later section boundary.
- `w14:paraId=1EBF6618`: continuous two-column section with unequal columns:
  - first column width: 4184 twips, space: 820 twips
  - second column width: 4926 twips

The document also contains one anchored drawing / legacy picture representation for a horizontal
line. It has no text box and is not involved in the reproduced collapse.

## Exact destructive mutation

The delete path reaches `@docx-editor.dev/core`'s paragraph join implementation.

When a multi-paragraph deletion joins a surviving earlier paragraph to a later paragraph,
`joinParagraphs` copies the second paragraph's `w:sectPr` onto the first paragraph. If the
survivor already has `w:sectPr`, that section definition is replaced.

The exact caret/range from the original interactive report was not retained. The deterministic
reproducer uses the same uploaded DOCX and deletes across the later section-bearing paragraph
`1EBF6618`. In the editor transaction, that paragraph is removed and its two-column
`w:sectPr` is transferred onto the surviving earlier paragraph. When the survivor already
carries a single-column `w:sectPr`, that definition is replaced; when it carries none, the
two-column definition is newly attached there.

The result is that content which was previously in a single-column section is laid out using
the later unequal two-column definition. Existing paragraph indents then leave extremely narrow
usable widths, producing the reported one-character-per-line rendering and squeezed neighbouring
content.

Reconstructing only this exact section-property transfer in the uploaded DOCX reproduces the
reported visual corruption.

## Before save vs serialization

The reported normal and corrupted screenshots were captured before export/reload, and the
corrupted layout is already visible immediately after the delete transaction.

Therefore the primary failure is the editor transaction/model mutation, not `handle.save()`.
Serialization preserves the already-mutated section model.

## Ownership

OakDoc integration is not feeding the field cleanup path for this case. The destructive
structural mutation originates in the `@docx-editor.dev/core` delete/join behaviour.

OakDoc applies a compatibility guard only around confirmed paragraph-level Word section
boundaries. A non-collapsed Delete/Backspace range that crosses one of those boundaries is
handled through the editor's normal delete command and immediately checked before the damaged
model can be retained. For a collapsed caret, the public editor snapshot does not expose a
character offset; OakDoc therefore leaves the native one-key Backspace/Delete untouched and
performs a post-transaction check only when the caret paragraph is the section paragraph or an
immediate neighbour. All other deletes remain entirely on the editor's native path.

The repair is deliberately narrow: if the editor transfers a deleted section's exact properties
onto a surviving paragraph, restore that survivor's original section definition, or remove only
the transferred definition when the survivor previously had none. Do not recreate deleted
section paragraphs and do not rewrite unrelated section formatting.
