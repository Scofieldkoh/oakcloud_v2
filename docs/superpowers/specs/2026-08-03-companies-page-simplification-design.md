# Companies Page Simplification Design

## Goal

Simplify the Companies interface by matching the detail-page back link to the established Contacts pattern and removing the unnecessary Statistics section from the Companies main page.

## Scope

- Add the existing `ArrowLeft` icon to the primary "Back to Companies" link on the company detail page.
- Match the icon size, spacing, text styling, and hover behavior used by the "Back to Contacts" link.
- Remove the Companies main page Statistics section containing Total, Live, New (30d), and Overdue cards.
- Remove imports that become unused as a direct result of deleting the Statistics section.

## Preserved Behavior

- The back link continues to use the existing `backHref`, including originating list-state restoration.
- The company filters, active filter chips, table, mobile company result cards, pagination, actions, permissions, loading states, and error states remain unchanged.
- Company data fetching and API behavior remain unchanged.
- The company-not-found action retains its existing arrow icon and button styling.

## Implementation Approach

Make localized edits in the two existing page components. Do not introduce a shared back-link component or hide the Statistics section with CSS, because neither is needed for this focused change.

## Error Handling and Data Flow

No error-handling or data-flow changes are required. The detail link keeps its current destination logic, and removing the rendered statistics does not alter the company-list query or response contract.

## Verification

Per user direction, no automated tests will be added or run for this change. Verification will consist of static checks for unused imports and a focused review of the rendered component structure.

