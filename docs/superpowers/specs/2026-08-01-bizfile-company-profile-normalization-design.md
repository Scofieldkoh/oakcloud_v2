# Bizfile Company Profile Normalization and Editing

## Goal

Make the reviewed Bizfile data and the Companies module one consistent system:

1. Every company datum shown in Bizfile Upload Review has a normalized company record.
2. Every normalized current company datum is visible on the Company detail page.
3. Every displayed source datum is editable from the Company **Edit** workspace.
4. High-priority operational information is expanded by default; lower-frequency information is collapsed without becoming inaccessible.

Bizfile receipt metadata is the one explicit exception. It remains document metadata and is not part of the Company profile.

## Approved Profile Design

The approved Company detail layout has a two-column desktop composition that stacks on narrower screens.

### Header

- Show the company name and UEN on the same line: `Meridian Advisory Pte. Ltd. (202412345N)`.
- Give the company name the Oak accent colour while keeping the UEN in the standard heading colour.
- Show company structure as secondary text below the name and UEN.
- Show the company status in a consistently sized light-green badge.
- Preserve permission-gated actions for **View BizFile**, **Update via BizFile**, **Edit**, and **Delete**.
- Show **View BizFile** only when a Bizfile document exists.

### Expanded operational sections

The main column contains:

1. Addresses
2. Business activities
3. Officers
4. Shareholders
5. Additional company information

The secondary column contains:

1. Compliance
2. Capital
3. Charges

All section headers use an OakCloud dark-green background with high-contrast text. The page and card backgrounds continue using the existing neutral OakCloud background tokens; the page must not receive a green tint.

### Typography and labels

- Use the existing Inter font throughout.
- Use uppercase styling only for field labels such as `REGISTERED OFFICE` and `PAID-UP CAPITAL`.
- Keep names, values, record titles, section titles, and descriptions in normal title or sentence case.
- Supporting record details use the normal secondary-text size and a contrast level that remains comfortably readable; do not use faint microcopy for substantive information.

### Addresses

- Display one registered office and one mailing address when present.
- Do not show a `Current` badge because the profile exposes only the canonical current address of each type.
- Display the registered-address effective date on the address line: `[address] (effective from: [date])` using the same font and size.

### Officers

- Show current officers by default.
- Keep the existing **Show ceased** checkbox in the Officers section.
- Display the officer role as a badge immediately beside the name.
- Use distinct accessible badge colours for different roles while always retaining the text label. The initial mapping uses blue for Director and amber for Secretary; other roles receive deterministic mappings from a limited reusable palette.
- Keep the status badge light green and consistently sized.
- Display appointment date and other identity details on the supporting line.

### Shareholders

- Show current shareholders by default.
- Keep the existing **Show former** checkbox in the Shareholders section.
- Place ownership beside the name: `Tan Mei Ling (60% ownership)`.
- Show an `Individual` or `Corporate` badge beside the shareholder heading. Individual uses purple and Corporate uses teal, with the type always written in the badge.
- Format shareholding details as `[currency] [attributed capital value] / [number] [share class] Shares`, for example `SGD 60,000 / 60,000 Ordinary Shares`.

The attributed capital value is derived from the matching current share class:

`shareholder class shares / total current shares in class × current class total value`

The calculation must use decimal-safe arithmetic and the class currency. It is not a separately editable or persisted shareholder field. Users edit the underlying shareholder holding or share-class capital values. When the class, class total, currency, or denominator is missing or zero, display `Value unavailable` rather than inventing an amount.

### Compliance, capital, and charges

- Show Compliance above Capital.
- Compliance shows financial year end, home currency, last annual return, accounts due date, and the other normalized compliance dates where present.
- Capital shows paid-up and issued totals by default.
- Expand the current share-capital class breakdown inside the Capital section. Include class, currency, number of shares, par value when present, total value, paid-up state, and treasury state.
- Charges show active charges by default and retain a **Show discharged** checkbox for past records.

### Additional company information

Keep lower-frequency data collapsed under **Additional company information**:

- Company history: former names, effective dates, date of name change, incorporation date, and registration date.
- Auditor: name, address, and appointment date.

Do not show the phrase `Collapsed by default`. Do not show Bizfile receipt number or receipt date in this section.

## Normalized Data Model

### Company scalar fields

Continue using `Company` for:

- UEN and company name
- Current former-name summary and date of name change
- Entity type, status, and status date
- Incorporation and registration dates
- Registered-address effective-date summary where still required by existing consumers
- Primary and secondary SSIC codes and descriptions
- Financial year-end day and month
- FYE as at last annual return
- Home currency
- Last AGM date, last annual-return filing date, and accounts due date
- Paid-up and issued capital totals and currencies
- Charge summary flags and denormalized counts

The two review paths `financialYear.fyeAsAtLastAr` and `compliance.fyeAsAtLastAr` represent the same business datum. Consolidate the review into one **FYE as at last AR** field and normalize it to `Company.fyeAsAtLastAr`.

### Existing related records

Use the existing normalized relations for:

- `CompanyFormerName`: complete former-name history and effective dates
- `CompanyAddress`: structured registered and mailing addresses
- `ShareCapital`: current share-class and treasury-share breakdown
- `CompanyOfficer`: officer identity, role, nationality, address, appointment, cessation, current state, linked contact, and source document
- `CompanyShareholder`: holder identity and type, nationality or origin, address, class, share count, percentage, currency, current state, linked contact, and source document
- `CompanyCharge`: charge number, type, description, holder, secured amount/text, currency, registration/discharge dates, discharge state, and source document

### Auditor

Add a normalized `CompanyAuditor` relation rather than placing auditor details in document JSON or unrelated officer records. It contains:

- `id`
- `companyId`
- `name`
- `address`
- `appointmentDate`
- `sourceDocumentId`
- `createdAt`
- `updatedAt`

The Company profile maintains one canonical auditor record. Auditor changes are preserved through audit logs and source Bizfiles rather than hidden historical auditor rows.
Enforce one auditor per company with a unique `companyId` relation and index `sourceDocumentId` for traceability.

### Document-only information

Keep Bizfile receipt number, receipt date, extraction payload, source file, extraction status, and processing revision metadata on the Document/ProcessingDocument records. They remain available for document processing and traceability but are excluded from Company profile normalization and display.

Contact-resolution choices are workflow input, not Company profile data. Their normalized outcome is the linked contact on the officer or shareholder; the original decision remains on the source document.

## Bizfile Synchronization

### Shared synchronization path

New-company confirmation and existing-company update must call one transaction-aware Bizfile-to-company synchronization service. The current selective-update path must not maintain a smaller field allowlist that omits reviewed sections.

The synchronizer receives:

- Validated and canonicalized review data
- Company identity or creation context
- Tenant and user identity
- Source document identity
- Required officer/shareholder contact-resolution decisions

It writes all normalized sections in one database transaction. Failure in any section rolls back the entire Bizfile application.

### Current-set semantics

- Addresses maintain one canonical record per address type. Bizfile/manual replacement updates the canonical record. Audit logs and source documents retain prior values; hidden address history is not accumulated as invisible profile data.
- Share capital maintains the current class/treasury set. Synchronization upserts matching current class rows and removes obsolete rows from the current set. Audit logs and source documents retain the change history.
- Former names remain an explicit historical collection and are visible under Company history.
- Officers and shareholders retain current and past records because the profile provides **Show ceased** and **Show former** controls.
- Charges retain active and discharged records because the profile provides **Show discharged**.
- Auditor maintains one canonical current record.

### Source traceability and audit

Every relation created or changed from a Bizfile keeps `sourceDocumentId` where the model supports it. The synchronizer writes section-level audit summaries identifying the source Bizfile and changed records. The validated review payload remains on `Document.extractedData`, but no Company profile datum may exist only in that JSON.

## Edit Workspace

The Company **Edit** action opens one workspace whose section order and terminology mirror the approved detail page. Every displayed source field is editable there. Derived attributed capital value is read-only and changes through its underlying capital/shareholding inputs.

Each section saves independently:

1. Company identity and dates
2. Addresses
3. Business activities
4. Officers
5. Shareholders
6. Compliance
7. Capital and share classes
8. Charges
9. Company history and auditor

Each save uses a section-specific validation schema and a transaction scoped to that section. An invalid charge cannot block an address correction. Repeating sections support add, edit, cease/restore, or discharge/reactivate actions appropriate to their record type.

Existing permission checks remain authoritative. The server revalidates tenant ownership, record ownership, and update permission for every section request.

## APIs and Service Boundaries

- Keep normalization and persistence rules in Company/Bizfile services, not React components or route handlers.
- Expose section-specific Company profile mutation endpoints or equivalent typed service operations.
- Reuse existing officer and shareholder endpoints when their behavior already matches the section contract; extend rather than duplicate them.
- Return the freshly normalized section DTO after each save so the query cache can update without reconstructing records client-side.
- Include a deterministic section version token in each section DTO. Derive it from a canonical serialization of that section's normalized scalar and related-record values. Mutations send the token as `ifMatchVersion`; the service recomputes it inside the save transaction and rejects a mismatch with HTTP `409`, returning the latest section data for reload. This avoids false conflicts between independent sections without adding a cross-section version counter.

## Validation and Error Handling

- Bizfile confirmation uses the canonical review schema before beginning synchronization.
- Required contact-resolution decisions remain blocking for officers and shareholders.
- Section saves return field-path errors that the Edit workspace renders beside the relevant control.
- Failed requests preserve local unsaved input.
- Database constraint, contact-resolution, or stale-update failures must not produce partial section changes.
- Calculated shareholder value failures degrade to `Value unavailable`; they do not block profile rendering.

## Migration Strategy

Create only the schema migration required by the normalized design, including `CompanyAuditor` and its indexes/relations. Do not backfill existing companies or parse historical `Document.extractedData`. Existing company data will be deleted and recreated by the user during a later migration stage.

## Focused Verification

Do not run the full repository or broad browser suites for this change. Use targeted tests only:

- Bizfile processor/service tests proving every review field reaches its normalized destination for new and existing-company flows.
- Focused Company service/API tests for section saves, validation, tenant/permission checks, source linkage, transactions, and stale-write conflicts.
- Component tests for expanded/collapsed visibility, past-record filters, role/type badges, share-capital expansion, and unavailable/calculated shareholder values.
- Focused Edit workspace tests proving every displayed source field has an editing path and section failures retain user input.
- Run only the directly affected test files plus type checking or linting scoped as narrowly as the tooling permits.

## Non-goals

- Backfilling or preserving existing company data
- Displaying Bizfile receipt metadata in the Company profile
- Persisting attributed shareholder capital as an independent editable value
- Redesigning Contact Details or Services tabs
- Broad unrelated refactoring of the Companies module
