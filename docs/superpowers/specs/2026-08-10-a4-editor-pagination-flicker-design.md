# A4 Editor Pagination Flicker Design

## Problem

The A4 editor briefly renders a hard-section-only document after logical editing transactions such as Enter. Soft pagination runs two animation frames later. In a multi-page document this temporarily collapses the rendered page list, assigns new identities to continuation pages, and restores the selection against an intermediate layout. Page content is also synchronized in a passive effect, so remounted pages can paint before their HTML is installed.

## Design

Treat the React `pages` state as the last committed physical layout. Logical mutations may update the canonical reflow source held in refs, but they must not publish hard-section-only pages to React. The paginator will reuse page IDs from the currently rendered physical pages and publish the complete next layout once. Page HTML synchronization will run in a layout effect so the committed layout and its content reach the browser in the same paint.

The existing two-frame measurement schedule, canonical HTML model, selection bookmarks, history, sanitization, and hard-page semantics remain unchanged. The atomic path applies to Enter and the shared logical transaction path, including formatting and insertion commands that use it.

## Testing

A focused real-browser component regression will pause animation-frame callbacks after initial pagination, dispatch an `insertParagraph` transaction, and assert that the existing physical pages and DOM nodes remain mounted while the editor is busy. It will then release pagination, assert stable page identity for retained pages, and verify the split paragraph and caret restoration.

Verification is limited to the affected A4 browser test, the related DOM component test file, and the pagination engine/document-action tests. Live QA on `/template-partials/editor` will confirm page identity, meaningful rendering, console health, and Enter behavior in a multi-page draft. No full build or full test suite will run.

## Alternatives Rejected

- Synchronous pagination avoids the intermediate layout but can block keyboard input on long documents.
- Hiding or fading the editor while busy masks the flicker but leaves page remounts and selection timing incorrect.

