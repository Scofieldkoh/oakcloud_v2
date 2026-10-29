# Template Editor Enter and Address Preview Fixes

## Goal

Fix four regressions in the document template editor:

- Enter must retain the caret at the insertion point instead of moving it to the document start.
- A newline inserted near the bottom of a page must persist through pagination.
- `{{company.address.letter}}` must resolve in template test preview.
- Long and multiline placeholder examples must wrap within the placeholder panel.

## Root Causes

Chromium copies a block's internal `data-flow-id` when Enter splits the block. The pagination model currently treats adjacent blocks with the same flow ID as physical fragments of one logical block and merges them during reassembly. This removes the inserted paragraph break and leaves selection restoration without a distinct destination.

The template test context supplies structured company address fields but does not populate `company.address.letter`. The resolver therefore correctly reports the missing nested value.

The placeholder catalog applies `truncate` to examples, so the multiline letter-address sample is clipped rather than wrapped.

## Design

Before serializing browser-edited page contents, normalize flow metadata so adjacent same-ID blocks remain merged only when they are genuine pagination continuations. A browser-created sibling from Enter receives a fresh flow ID. Existing continuation fragments across physical pages keep their shared ID and pagination semantics.

Build the mock company letter address from the structured address data used by preview. Use the shared letter-address formatter so preview formatting matches generated documents, including HTML line-break conversion by the resolver. Apply the same enrichment after a real company is chosen as test data.

Render placeholder examples with preserved newline whitespace and normal word wrapping. Keep the syntax line compact and unchanged.

## Testing

- Chromium-backed editor tests press Enter within an ordinary paragraph and near the bottom of a page, then assert that the newline persists, the caret remains at the logical insertion point, and scroll position does not jump.
- Preview/resolver tests assert that structured company mock address data resolves `company.address.letter` into the expected multiline HTML.
- Placeholder panel tests assert that the letter-address example uses wrapping rather than truncation.
- Run focused tests, then the related editor, resolver, API, and component suites plus type checking.

## Scope

No custom Enter handler or general editing-engine rewrite is introduced. Existing unrelated working-tree changes are preserved, and no unrelated editor, layout, or placeholder behavior is changed.
