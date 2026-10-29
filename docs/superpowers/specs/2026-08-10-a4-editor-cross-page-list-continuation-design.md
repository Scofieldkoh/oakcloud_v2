# A4 Editor Cross-Page List Continuation Design

**Date:** 2026-08-10

**Status:** Approved by user (written spec reviewed in conversation)

## Goal

Make bulleted, numbered, and nested-numbered list items render reliably when
their content crosses one or more soft A4 page boundaries. A marker appears
only on the first fragment of a logical item, continuation text stays aligned
with the item body, and the next logical item advances normally (for example,
`3.2` after a multi-page `3.1`).

## Root Cause

The pagination engine correctly creates continuation fragments, but two pieces
of continuation state are lost across repeated splits:

1. `markListContinuationLevel` counts every fitting `li`, including an `li`
   already marked as a continuation. A single logical item spanning several
   pages therefore advances `--flow-list-start` once per physical fragment.
2. `reassemblePageFragments` merges the matching outer list item but appends
   each nested list fragment as a new sibling list. Repagination then treats
   those derived fragments as separate canonical lists, resetting nested
   counters and adding fragment-level structure to the saved document.

A diagnostic nested list with one item spanning nine pages reassembled into
nine nested lists instead of one. Existing tests detect text loss and repeated
markers, but they do not assert canonical nested-list structure, stable counter
state across three or more pages, or the number of the following item.

## Chosen Approach

Fix continuation handling at the pagination boundary without changing the
canonical document format or editor commands.

### Continuation-aware counting

`a4-pagination/engine.ts` will use one helper to count only direct list items
that do not carry `data-flow-continuation-item`. Both item-boundary splitting
and recursive mid-item splitting will use that helper when calculating the
overflow fragment's `--flow-list-start`.

For a nested `3.1` that spans multiple pages:

- the outer list remains positioned at `3` on every continuation page;
- the nested list remains positioned at `1` on every continuation page;
- continuation items increment neither counter and render no marker; and
- the next non-continuation nested item increments from `1` to `2`, rendering
  as `3.2`.

### Recursive structural reassembly

`a4-pagination/model.ts` will merge matching continuation structure at the
boundary between a target fragment and its source fragment. When two matching
list items contain boundary list containers of the same type, the containers
will be merged only when their boundary items share the same stable flow ID.
This proves they are fragments of one logical list item and avoids merging two
intentionally separate adjacent lists.

The merge remains recursive so a split `ol > li > ol > li` hierarchy becomes
one outer list, one outer item, one nested list, and the original nested items
after reassembly. Flow-only attributes and `--flow-list-start` remain derived
metadata and are stripped before persistence as they are today.

## Data Flow

1. Canonical sanitized HTML is hydrated with stable flow IDs.
2. Pagination splits a long list item and marks each overflow item as a
   continuation.
3. Counter start values advance only for complete logical items.
4. Physical page fragments render the continuation without another marker.
5. Before editing, saving, or repagination, fragment reassembly recursively
   restores the original list hierarchy.
6. Flow-only metadata is stripped, leaving the canonical saved HTML unchanged
   in shape and meaning.

## Error Handling and Safety

- Structural merging is conditional on matching list tags and boundary-item
  flow IDs; ambiguous adjacent lists are appended unchanged.
- The pagination loop keeps its existing oversized-element fallback, so an
  unsplittable block is still emitted once rather than requeued.
- No sanitizer allowlist, persisted schema, toolbar command, or export API is
  changed.
- The same derived fragment metadata continues to feed editor, preview, print,
  HTML export, and PDF export paths.

## Testing

Implementation will follow test-driven development:

1. Add a failing engine regression with a nested numbered item spanning at
   least three pages followed by another nested item.
2. Assert the continuation counter starts remain stable, the following item is
   non-continuation content in the same nested list, and reassembly restores
   exactly one canonical nested list with the original item count.
3. Assert paginate/reassemble/paginate is idempotent and does not proliferate
   lists or list items.
4. Add equivalent structural coverage for a multi-page bulleted item.
5. Add a real Chromium component regression using long wrapped content and
   verify continuation-marker suppression, stable list-start metadata, and the
   following item in the correct continued list.
6. Run the focused pagination model/engine tests, affected A4 component tests,
   the focused browser regression, and rendered visual QA.

## Alternatives Rejected

- **Post-reassembly HTML normalization:** simpler to add, but tag adjacency is
  insufficient evidence that two intentionally separate lists should merge.
- **Flatten lists into standalone pagination blocks:** could simplify future
  layout work, but would redesign selection, formatting, numbering, and
  canonical serialization far beyond this regression.

## Scope

This change is limited to derived soft-page continuation behavior for `ol` and
`ul`, including nested combinations. It does not alter explicit hard page
breaks, list creation or formatting commands, toolbar controls, page layout,
or persisted document HTML.
