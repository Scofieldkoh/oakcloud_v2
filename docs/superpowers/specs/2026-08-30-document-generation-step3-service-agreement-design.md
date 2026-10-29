# Document Generation Step 3 Service Agreement Design

## Goal

Improve the Configure stage of document generation for Service Agreements while
making its section headers consistent with the Companies detail experience and
keeping the shared primary company synchronized across Step 2 and Step 3.

## Scope

The change covers all Configure-stage section headers, Service Agreement
configuration layout, agreement entity selection, service variant discovery,
service assignment, agreement dates, fee editing, and the reducer state that
connects the Step 2 primary company to Service Agreement item configuration.
It does not change the four-stage workflow, API contracts, relational draft
schema, document rendering semantics, or generated-document locking rules.

## Design

### Shared section treatment

`BatchSection` is the single visual primitive for Configure-stage sections.
Its header adopts the Companies detail styling: a deep oak-green background,
white title/action content, compact horizontal padding, and an optional
collapse affordance. The change applies to standard-document and
Service-Agreement configuration alike. Nested bordered containers are removed
where they only repeat the parent section treatment.

### Primary company and agreement entities

`batch.primaryCompanyId` remains the authoritative primary-company value. A
Service Agreement displays an editable Primary company field in Agreement
details, and changing it dispatches the same shared-company action used by
Step 2. The reducer replaces the old primary ID with the new ID in every
editable Service Agreement workspace, service assignment, and fee line so the
service “Applies to” state cannot remain stale.

The primary company is implicit in the agreement entity UI. Appendix 3 is
labelled exactly “Appendix 3 - additional entities to add into the agreement”.
A searchable company control adds additional entities, which are displayed as
compact selectable/removable tiles matching the Directors choice-list pattern.
Persisted workspace entity IDs continue to include the primary company plus
additional entities for compatibility with existing validation and server
serialization.

### Service variants and fees

The Services and fees section keeps service-variant cards as the only allowed
nested card exception. The redundant Services heading/container is removed.
The variant picker is an accessible searchable control. Each option includes
an information icon; hover/focus on desktop and click/tap on any device shows
the full variant description in a dismissible popout without selecting the
option.

Each service variant has an expanded-by-default Fees subsection. Fee lines use
a semantic table with one compact row per fee: description, amount, currency,
frequency, billing start date, and remove action. Desktop columns use bounded
widths for amount, currency, frequency, and dates; mobile uses horizontal
scrolling rather than converting rows into nested cards. All controls share
the billing-start-date height.

Service-item metadata such as “Pinned from version … · SOW version …” is
removed. Applies-to entries use compact bordered rows matching the supplied
company tile reference. Start and end dates use constrained widths. Agreement
details retains only Agreement date and appears immediately after Details;
Effective date and Term are removed. Service Agreement configuration does not
render Document fields.

Service start dates default to and remain pegged to the Agreement date until
explicitly overwritten. Billing start dates likewise default to and remain
pegged to their Service start date. Pegged date controls use the neutral grey
field background; overwritten controls use the current selected green tint.
Clearing either override restores the current pegged value and returns the
control to grey.

## State and data flow

The Step 3 primary-company callback is threaded through
`BatchItemConfigurator` to the workspace dispatch. The `shared/company`
reducer action synchronizes Service Agreement configuration using the previous
and next primary IDs, preserving additional entity IDs while remapping
service assignments and fee ownership. A Service Agreement with no existing
workspace is initialized from the current primary company when first edited.

## Verification

Component tests cover section structure, copy removal, entity selection,
primary-company synchronization, service variant description popouts, fee
table updates/removals, date widths, and the absence of Document fields.
Reducer tests cover primary-company replacement across Service Agreement
workspace, service items, and fees. The existing document-generation browser
workflow is extended to exercise Configure rendering and the primary-company
change path at desktop and mobile-sized viewports. Targeted Vitest, TypeScript,
ESLint, and rendered browser QA must pass before completion.
