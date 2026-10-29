# List Navigation State Design

## Scope

Preserve the originating Contacts or Companies list state when a user opens a record and returns with either the browser Back button or the detail page's “Back to Contacts/Companies” control. The preserved state includes pagination, page size, search, filters, and sorting.

## Root Cause

The Contacts and Companies pages initialize their state from the URL correctly. A workspace-reset effect then runs on the initial mount and changes the page to 1 even though the workspace did not change. On browser Back, this replaces the restored history URL and starts a second data request, causing both the refresh delay and pagination loss.

The detail-page back controls currently link to the bare list route, so they cannot restore the originating list state.

## Design

### List state restoration

Each list page will remember the active workspace value from its initial render. Its workspace effect will clear selection and reset pagination only when that value changes after mount. Initial navigation, including browser history restoration, will retain URL-derived state.

### Explicit return destination

Contacts and Companies list pages already produce a canonical URL from their current state. They will pass that URL to their table components. Every link from a table row or mobile card to a record detail page will include the canonical list URL in a `returnTo` query parameter.

Detail pages will read and validate `returnTo`. Contacts will accept only an internal Contacts list URL (`/contacts` with an optional query string), while Companies will accept only an internal Companies list URL (`/companies` with an optional query string). Missing, malformed, cross-section, or external values will fall back to `/contacts` or `/companies` respectively.

The validated destination will be used by the visible top-left back control and the corresponding keyboard shortcut. Error-state back controls will use the same destination when it is available.

### Browser history

Pagination and filter state continue to use the existing canonical list URL and `router.replace`; this change does not add a history entry for every table interaction. Opening a detail page still adds a normal navigation entry, so browser Back returns to the exact list URL that opened it.

## Error Handling and Safety

Return destinations are restricted to the expected local list route to prevent external navigation and unintended cross-feature redirects. Invalid values degrade to the existing page-1 list behavior.

## Testing

Regression tests will verify:

- a list mounted from `?page=3` does not replace the URL with page 1;
- a genuine workspace change resets pagination to page 1;
- Contacts and Companies table links include the complete canonical return URL;
- detail-page back controls and keyboard shortcuts use a valid return URL;
- missing or unsafe return values fall back to the bare list route.

Targeted Vitest tests will be run first, followed by lint/type-relevant checks and rendered browser validation of both navigation paths when the local application can be started with usable test data.

## Non-goals

- Changing the appearance or layout of tables, pagination, or back controls.
- Adding persisted list state outside the URL.
- Changing the history behavior of pagination controls.
- Applying the pattern to list/detail areas other than Contacts and Companies.
