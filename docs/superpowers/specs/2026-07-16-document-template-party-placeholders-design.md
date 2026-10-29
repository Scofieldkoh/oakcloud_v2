# Document Template Party Placeholders Design

## Objective

Expand document templates so a document can bind to one explicitly selected
director, one explicitly selected shareholder, and one explicitly selected
company contact. Add email, phone, preparer-name, and letter-format address
placeholders without changing the existing director and shareholder loop
behavior.

## Scope

This work covers the template placeholder catalog, guided loop fields, document
generation wizard, preview and generation APIs, server-side context building,
placeholder resolution, validation, tests, and the existing document-generation
documentation.

It does not change the company, officer, shareholder, or contact data models.
It does not add multi-selection for singular party placeholders. Existing
director and shareholder loops remain the mechanism for rendering multiple
records.

## Placeholder Model

The resolver will expose three independent singular objects:

- `selectedDirector`
- `selectedShareholder`
- `selectedContact`

Each object supports these common fields:

- `name`
- `email`
- `phone`
- `address.full`
- `address.letter`

Role-specific fields already available to director and shareholder loops remain
available on their corresponding singular object, including director role and
appointment data and shareholder type, share class, number of shares, and
percentage held.

The company context gains `company.address.letter`. The system context gains
`system.preparerName`, populated from the authenticated user's display name.
`system.generatedBy` remains available and resolves to the same value for
backward compatibility.

The existing `directors`, `shareholders`, and `contacts` arrays and the legacy
`contact.*` binding remain supported. Director and shareholder loop records gain
`email`, `phone`, and `letterAddress`. Their existing scalar `address` field is
unchanged. Templates can therefore render the new contact fields for every
record as well as for a singular selection without breaking existing loop
syntax.

## Template Editor

The placeholder catalog adds separate Selected Director, Selected Shareholder,
and Selected Contact categories. It also adds Company Letter Address and
Preparer Name entries.

The director and shareholder guided loop builders add email, phone, full
address, and letter address fields. Inserted syntax continues to use the
existing balanced loop structures and safe allowlisted field names.

Template analysis recognizes all new keys. A template is considered to require
a selection when it references any key below `selectedDirector`,
`selectedShareholder`, or `selectedContact`, including references introduced by
partials.

## Generation Experience

The current Contacts step becomes a People step. After the user chooses a
company, the wizard loads the company's current directors, current
shareholders, and all people displayed in the company's Contacts section. The
contact list therefore includes contacts linked through general company
relationships, officer positions, or shareholdings, matching the existing
company Contacts behavior.

The People step conditionally displays a Director, Shareholder, or Company
Contact single-select control only when the selected template requires that
context. A template can require any combination of the three, and the choices
are independent. Each control supports search and displays enough identifying
information to distinguish similarly named records.

The wizard blocks preview until every required singular selection has been
made. Messages identify the missing choice directly, for example, `Select a
director for this template.` Templates that use only loops do not require a
singular selection.

Changing the selected company clears all selected party IDs. Wizard draft
persistence stores and restores the selected officer, shareholder, and contact
IDs only when they still belong to the restored company and remain eligible.

## API and Data Flow

Preview, validation, and final-generation requests add these optional IDs:

- `selectedDirectorId`
- `selectedShareholderId`
- `selectedContactId`

The server treats client selections only as identifiers. It reloads each record
inside the authenticated workspace and verifies that it belongs to the selected
company. Directors and shareholders must be current. The selected contact must
be part of the union used by the company's Contacts section. A missing,
cross-company, inactive, deleted, or cross-workspace record is rejected with a
clear validation error.

The server builds a single canonical party representation before invoking the
placeholder resolver. Preview, validation, test rendering, and final generation
share this context-building path so their output cannot drift.

No database migration is required. Generated-document metadata continues to
store the resolved placeholder snapshot and includes the three selected IDs
when present for traceability.

## Contact Detail Precedence

For a party linked to a contact, email and phone are selected independently
using this order:

1. A non-deleted detail for the selected company, preferring a primary detail
   and then display order.
2. A non-deleted general detail with no company, using the same preference.
3. No value.

Company-specific data therefore wins while general data prevents avoidable
blank output. Officer and shareholder role records retain their denormalized
names and addresses as the historical source of truth. Their address falls back
to the linked contact's full address only when the role record has no address.
The selected company contact uses the contact's full address.

## Letter Address Formatting

Address formatting is a pure shared function that returns both a plain full
address and a letter-format string. The letter-format string uses newline
characters that render as line breaks in generated HTML and exports.

For structured Singapore company addresses, the lines are:

1. Building name, when present.
2. Block and street, followed by `#level-unit` when present.
3. `Singapore  postalCode`, using two spaces before the postal code to match
   conventional letter formatting.

Missing components collapse without leaving blank lines, dangling punctuation,
or an orphaned unit marker. A building name produces the typical three-line
form; an address without one normally produces two lines.

Officer, shareholder, and contact addresses are currently stored primarily as
free text. The formatter trims lines and removes empty lines first. For a
single-line address, it splits comma-delimited segments and recognizes a
building segment, a block-and-street segment, a `#level-unit` segment, and a
trailing `Singapore postalCode` segment. It then applies the same three-line
ordering used for structured addresses. If those components cannot be
recognized confidently, it returns the trimmed source text unchanged rather
than reordering it. Structured company address fields always take precedence
for the company placeholder.

Example output:

```text
WCEGA Tower
21 Bukit Batok Crescent, #25-72
Singapore  658065
```

## Error Handling and Compatibility

Selection errors are request-validation errors and never silently fall back to
the first director, shareholder, or contact. This preserves the user's explicit
choice.

If an optional party field such as email or phone has no value, the existing
missing-placeholder policy applies. Preview highlights unresolved values and
finalization continues to use the existing blocking rules.

Existing templates remain compatible:

- `{{#each directors}}` and `{{#each shareholders}}` are unchanged.
- Existing `contact.*` and `contacts` bindings continue to work.
- `system.generatedBy` remains an alias of `system.preparerName`.
- Existing company address placeholders retain their current values.

## Testing

Unit tests will cover:

- singular director, shareholder, and contact placeholder resolution;
- new email, phone, and address fields inside existing loops;
- company-specific email and phone precedence;
- fallback to general contact details;
- role-address precedence and contact-address fallback;
- two-line and three-line Singapore letter addresses;
- safe preservation of free-text addresses;
- preparer-name and generated-by alias behavior;
- template analysis of singular fields introduced directly and through
  partials.

Component tests will cover:

- conditional visibility of the three selectors;
- independent single selection;
- required-selection messages;
- clearing selections when the company changes;
- draft persistence and eligibility checks;
- request payloads for preview, validation, and final generation;
- unchanged behavior for templates that use only loops.

API and service tests will cover tenant and company membership checks, current
record requirements, contact eligibility, invalid IDs, shared preview/final
context output, and backward compatibility with legacy payloads.

## Documentation

Update the existing document-generation documentation under `docs/` with the
new placeholder keys, selection behavior, contact-detail precedence, and letter
address examples. Do not create a separate user guide outside the existing
documentation structure.
