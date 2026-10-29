# Architecture

> **Last Updated**: 2026-09-29
> **Audience**: Developers

System architecture and runtime design overview for Oakcloud.

## Related Documents

- [Getting Started](./GETTING_STARTED.md) - Local setup and first run
- [Database Schema](./reference/DATABASE_SCHEMA.md) - Tables, relationships, and enums
- [Service Patterns](./guides/SERVICE_PATTERNS.md) - Backend implementation patterns

## Overview

Oakcloud is a multi-tenant Next.js application for accounting practice operations. It combines internal dashboards, authenticated API routes, public document and form flows, and an in-process task scheduler.

Core design principles:

- **Tenant isolation** across the app, API, and database
- **Service-oriented business logic** under `src/services/`
- **Public and internal workflows** in the same codebase, with explicit auth and rate-limit boundaries
- **Local-first infrastructure** for development with PostgreSQL and MinIO

## Tech Stack

### Frontend

| Technology | Purpose |
|------------|---------|
| Next.js 15 App Router | Routing, server rendering, API routes |
| React 19 | UI layer |
| TypeScript | Type safety |
| Tailwind CSS | Styling |
| TanStack Query | Server-state fetching and invalidation |
| Zustand | Lightweight local app state |
| React Hook Form + Zod | Form state and validation |

### Backend

| Technology | Purpose |
|------------|---------|
| Node.js 24 LTS | Runtime |
| Prisma 7 | Database access |
| PostgreSQL 16 | Primary relational database |
| `jose` | JWT-based auth/session tokens |
| `@noble/hashes` | Password hashing and crypto helpers |
| Nodemailer / Graph | Email delivery |
| OpenAI / Anthropic / Google AI / OpenRouter | AI-backed features |

### Documents And Forms

| Technology | Purpose |
|------------|---------|
| `@docx-editor.dev/react` | OakDoc, the Word (DOCX) editor for templates, partials and generated documents |
| Microsoft Graph | Word-to-PDF conversion for OakDoc documents |
| TipTap | Rich text inputs outside the document editor (`rich-text-editor.tsx`) |
| pdf-lib | PDF inspection and assembly in export paths |
| Puppeteer | Form response PDF rendering |
| System Chromium | Resolved by `src/lib/chrome-executable.ts`; Docker exposes the stable executable through `CHROME_PATH` |
| data.gov.sg ACRA datastore | Source for the locally mirrored `acra_entity` table powering company name availability checks for the form "Company name check" element (ACRA Information on Corporate Entities collection, updated monthly; mirrored by the daily ACRA sync task) |
| Microsoft Graph | Word-to-PDF conversion for e-signing uploads through usable SharePoint/OneDrive connectors; uploads remain PDF-only when no valid connector is configured |
| MinIO / S3 | Uploaded file storage |

### Runtime Services

| Service | Purpose |
|---------|---------|
| In-process scheduler | Backup, cleanup, exchange-rate sync, ACRA entity sync, form AI review, form count reconciliation, E-signing preparation |
| In-memory rate limiter | Public endpoint throttling |
| In-memory view counter buffer | Batches form view count writes every 30 seconds |

## High-Level Layout

```text
src/
|-- app/
|   |-- (dashboard)/           # Authenticated UI routes
|   |   |-- forms/             # Forms list, builder, responses, draft detail
|   |   |-- tasks/             # Tenant task workspace
|   |   |-- pipelines/         # Versioned pipeline list and builder
|   |-- api/                   # Authenticated and public API routes
|   |   |-- forms/             # Forms admin + public endpoints
|   |   |-- tasks/             # Task, status, stage, and transition endpoints
|   |   |-- task-pipelines/    # Pipeline CRUD, versioning, duplicate, archive
|   |-- forms/f/[slug]/        # Public form runtime
|-- components/
|   |-- forms/                 # Builder and form-specific UI pieces
|   |-- tasks/                 # Task list/cards, stage modal, pipeline builder
|   |-- ui/                    # Reusable shared components
|-- hooks/                     # Query and auth hooks
|-- lib/
|   |-- auth.ts                # Session and JWT helpers
|   |-- form-utils.ts          # Shared forms types, settings, helpers
|   |-- rate-limit.ts          # Public endpoint throttling
|   |-- scheduler/             # Background task framework
|   |-- storage/               # Object storage abstraction
|   |-- validations/           # Zod schemas
|-- services/
|   |-- tasks/                 # Pipeline, task, stage, registry, integrations
|   |-- form-crud.service.ts
|   |-- form-submission.service.ts
|   |-- form-draft.service.ts
|   |-- form-pdf.service.ts
|   |-- form-ai.task.service.ts
|   |-- ...other domain services
```

## Multi-Tenancy And Permissions

- Tenant-scoped entities are keyed by `tenantId`.
- `SUPER_ADMIN` users can switch tenants in the UI and pass `tenantId` to admin endpoints where supported.
- Forms currently reuse the existing `document:*` permission surface for CRUD, response review, exports, and AI review actions.
- Public form endpoints do not require auth, but are protected with slug scoping, token checks for PDF delivery, and IP-based rate limits.

## Request Flow

### Authenticated Dashboard Flow

1. A dashboard page or hook calls an authenticated API route under `src/app/api/`.
2. The route calls `requireAuth()` and, where applicable, `requirePermission()`.
3. The route resolves tenant scope via `resolveTenantId(...)`.
4. The route delegates business logic to `src/services/...`.
5. Services read and write through Prisma and, when needed, storage/email/AI helpers.

### Public Form Flow

1. The public page loads at `/forms/f/[slug]`.
2. It fetches `/api/forms/public/[slug]` to load the published form definition.
3. Uploads are sent to `/api/forms/public/[slug]/uploads`.
4. Draft saves and resumes go through `/api/forms/public/[slug]/drafts...`.
5. Submission goes through `/api/forms/public/[slug]/submit`.
6. The success state may expose token-guarded PDF download and email actions.

## Forms Module Architecture

The Forms module is split into focused services:

- `form-crud.service.ts`: form creation, listing, duplication, updates, soft delete, and field persistence
- `form-submission.service.ts`: public definition loading, public uploads, submissions, response listing/detail, CSV export, attachment download/delete
- `form-draft.service.ts`: save/resume/email draft flows and draft cleanup
- `form-pdf.service.ts`: HTML rendering, PDF generation, and filename templating
- `form-ai.task.service.ts`: queued AI review processing, warning resolution, and warning summaries

### Forms Routes

Authenticated dashboard routes:

- `/forms`
- `/forms/[id]/builder`
- `/forms/[id]/responses`
- `/forms/[id]/responses/[submissionId]`
- `/forms/[id]/responses/drafts/[draftId]`

Public runtime route:

- `/forms/f/[slug]`

### Form Settings Model

Most builder configuration beyond title, slug, tags, and status lives in `Form.settings`:

- Response table configuration (`summaryFieldKeys`, column order, widths)
- Completion notification recipients
- Draft enablement and retention window
- Internal AI review settings and custom context
- Response PDF filename template
- I18n defaults, enabled locales, and translations
- Branding toggles such as `hideLogo` and `hideFooter`; per-form background images (`backgroundImageUrl` + `backgroundImageOpacity`) uploaded through `POST /api/forms/[id]/background` and served via `/api/storage/[...key]`

### Public Form Security And Delivery

- `FORM_VIEW`, `FORM_SUBMIT`, `FORM_UPLOAD`, `FORM_DRAFT_SAVE`, and `FORM_DRAFT_RESUME` rate limits are enforced in memory per IP and slug.
- Public draft resumption requires both a draft code and an access token.
- Public PDF delivery uses signed tokens with separate scopes for direct download and email-request authorization.
- Uploaded files are stored under `{tenantId}/forms/{formId}/uploads/{uploadId}{ext}`.

### Background Processing

The scheduler registers these form-related tasks:

- `form-ai-review`: processes queued submission AI reviews
- `form-count-reconciliation`: corrects denormalized `submissions_count`
- `cleanup`: also removes expired form drafts and orphaned uploads

Form view counts are buffered in-process and flushed to the database every 30 seconds to reduce write contention on public forms.

## Storage Architecture

Oakcloud uses the shared storage abstraction for documents and forms.

Examples:

```text
{tenantId}/companies/{companyId}/documents/{docId}/...
{tenantId}/forms/{formId}/uploads/{uploadId}.{ext}
```

MinIO is used in local development; S3-compatible providers can be used in production.

## Document Editor (OakDoc)

OakDoc is the only document editor. Templates, partials and generated documents are Word (DOCX) packages stored as immutable assets in object storage; database records hold each asset's storage key, size, SHA-256 and revision. The browser edits them with `@docx-editor.dev/react` (`src/components/documents/oakdoc-editor.tsx` for templates, `oakdoc-generated-document-editor.tsx` and `generation-batch/oakdoc-review-editor.tsx` for generated documents).

- Shared contracts live in `src/types/oakdoc.ts`. Field, condition, repeater, partial and signature semantics live in `src/lib/document-editor/oakdoc-*.ts`.
- Every uploaded or saved package passes the bounded inspection in `oakdoc-package-policy.ts` before any transform.
- Saves carry the base revision they were edited from; `revision-concurrency.ts` rejects stale writes, and the client clears its dirty state only when the server's receipt matches its current local revision.
- Generation (`src/services/oakdoc-generation.service.ts`, batch generation under `src/services/document-generation-batch/`) fills a copy of the template package and records the template version and hash it used.
- PDF output (`src/services/oakdoc-output.service.ts`) converts the DOCX through Microsoft Graph and validates the result.
- The Fields panel and template validation share one standard-field catalog in `src/components/documents/template-editor/template-field-catalog.ts`.
- `src/lib/document-editor/document-engine.ts` decides which engine owns a record. Metadata that claims OakDoc but cannot be trusted is `INVALID` and never falls back to A4 handling.

### Old A4 records

The A4 HTML editor has been removed, along with its viewer, HTML and PDF export, and draft conversion. `src/lib/document-editor/a4-retirement.ts` rejects every operation that would create, change or export A4 content, from the UI, scripts or direct API calls. Any record that is not OakDoc shows a notice instead of its content: `isUngeneratedDocumentDraft` in `document-engine.ts` tells a batch placeholder or saved generation session (not generated yet) apart from an old A4 record, which can only be archived or deleted. The workspace letterhead table remains in the schema but nothing reads it; OakDoc letterheads live in the Word document.

`a4-server-dom.ts`, `a4-content-policy.ts` and `a4-content-sanitizer.service.ts` keep their names but serve OakDoc: field resolution, the scoped field renderer and `oakdoc-html-import.ts` use them.

Template test previews use the same placeholder resolver as document generation. When structured company address fields are present but `company.address.letter` is absent, the resolver derives the letter-format value through the shared address formatter before resolving placeholders.

Document-generation work can be paused as explicit, server-backed sessions. Each save creates or updates a `GeneratedDocument` in `DRAFT` status with versioned `metadata.generationSession` state. Opening `/generated-documents/generate` starts clean; only `/generated-documents/generate?draft=<id>` resumes a selected session. Successful generation converts that same record into a normal generated draft, while discard follows the existing soft-delete lifecycle.

Editable experiences can use the shared `useUnsavedNavigationGuard` hook for native `beforeunload`, same-origin link, and browser-back protection. Its default copy is page-neutral, and document generation, forms, e-signing, or other editors can supply experience-specific dialog text.

## Service Catalog And Agreement Template Foundation

The service catalog is tenant-scoped and managed at `/admin/services`.
Document templates and partials have separate pages, `/template-partials/documents`
and `/template-partials/partials`, grouped under Document Templates in the
Administration sidebar; `/template-partials` redirects there. `ServiceFamily` groups ordered `ServiceVariant` records.
Each variant links to one active, same-tenant `TemplatePartial` containing its
statement-of-work wording and owns ordered, entity-agnostic
`ServiceVariantFeeTemplate` defaults. Catalog reads and writes use
`document:read/create/update/delete`; every service query includes `tenantId`
and `deletedAt: null` at the family, variant, fee-template, and linked-partial
boundaries. Archives are soft deletes. A family cannot be archived until its
variants have been archived, and a partial cannot be deleted while a
same-tenant, non-deleted variant references it.

`DocumentTemplate.compositionType` distinguishes normal templates from
Service Agreement composition templates:

- `STANDARD` preserves the existing template-generation behavior.
- `SERVICE_AGREEMENT` requires exactly one
  `{{@agreement.serviceSections}}`, `{{@agreement.feeTable}}`, and
  `{{@agreement.entityAppendix}}` slot. These reserved tokens are insertable
  editor blocks, not editable custom placeholder definitions. The editor blocks
  invalid saves, and document-template service writes validate the merged
  persisted composition on create, update, and duplication.
- `RESOLUTION` (Word templates only) holds exactly one block content control
  tagged `resolution.items`, inserted from the OakDoc editor's "Numbered
  resolutions" panel once the template type is set to Resolution; saving a
  resolution template without it is refused. On Configure each batch item
  lists its resolutions (`configuration.resolution`: an optional bold subject
  heading plus sections, each a Word partial or custom text with its own
  heading). Generation replaces the slot with "1.<tab>HEADING" paragraphs in
  list order, each followed by its partial reference or custom paragraphs,
  using the slot paragraph's formatting (the slot is locked against deletion
  only, so its placeholder can be restyled; older content-locked slots are
  unlocked when the editor opens them); the partials are pinned at their
  current version and expanded with the master's own partials before fields
  resolve (`src/lib/document-editor/oakdoc-resolutions.ts`). Partial items
  start collapsed and show the partial's wording as plain text
  (`GET /api/template-partials/[id]/text`); "Edit text" copies that wording
  into the section's `body`, which then prints as plain paragraphs instead of
  the partial ("Use saved partial" clears it). The partial picker groups
  partials by their category (Resolutions, Agreement, Others), set on the
  Partials page or the partial's details. A batch can hold the same template
  more than once, so several resolutions can be generated together; saved
  items are matched by id, and new copies by the next unclaimed item of the
  same template. Custom and edited text can use `{tag}` tokens for fields
  that resolve from the company, the resolution date or the system (for
  example `{company.name}`); generation turns them into field controls, and a
  partial's text reads its fields back as tokens. `scripts/seed-resolution-template.ts`
  also creates "Members Resolution (Numbered)" (Section 184A written
  resolution signed by every shareholder). A resolution template can carry preset resolutions
  (`document_templates.resolution_preset`), which new batch items start with
  (fresh section ids) and can still change. Presets are edited from the
  OakDoc editor ("Preset resolutions") or saved from Configure ("Save as
  preset for this template", or "Save as new template", which duplicates the
  template with that preset) through `PUT
  /api/document-templates/[id]/resolution-preset`; saving a preset does not
  bump the template version. Each partial item on Configure links to the
  partial editor. A Resolutions partial can carry a Header
  (`template_partials.header`), used as the item's default numbered heading
  instead of its display name. The OakDoc editor shows a template's preset
  resolutions inside the slot (numbered headings and each partial's current
  wording) as a display-only preview; the slot's first paragraph keeps the
  formatting and generation replaces the whole slot. The editor preview uses sample resolutions. `scripts/seed-resolution-template.ts --email
  <login> [--replace]` creates the starter "Board Resolution (Numbered)"
  template from the firm's reference directors' resolution, and "First Board
  Resolution" (`src/content/resolution/first-board-resolution-oakdoc.ts`):
  a fixed "NOTED THAT" part (incorporation date, a Notice of Incorporation
  No. custom field, primary and secondary SSIC activities, first directors)
  and seven Resolutions partials (constitution, registered address,
  financial year end, secretary, corporate secretarial agent, subscribers'
  shares table, lodgement) preset in that order. The partials are named
  "First Resolution - ..." and, like the rest of that template, print in Arial 10 pt, each ending with an
  empty line; the constitution partial asks which constitution is adopted
  (a `custom.constitution` dropdown). A master whose styles define
  the character style `OakDocResolutionHeading` gets it on each numbered
  heading's text (the First Board Resolution underlines). Company fields
  `company.primaryActivity`, `company.secondaryActivity` ("code |
  description"), `company.financialYearEnd` ("31 December"),
  `company.firstFinancialYearEnd` (the confirmed first period's end, else the
  first year end on or after incorporation) and `company.paidUpCapital`
  ("SGD 10,000.00") serve these resolutions. The registered address and
  secretary name fields use the UPPERCASE text case (below), not Word's All
  caps formatting.

Field text case (`src/lib/document-editor/oakdoc-field-case.ts`): opening a
field in the OakDoc field panel offers Text case (As stored, UPPERCASE, Title
Case) before Add or a drag. The choice is kept in that field's Word title
(`w:alias`, e.g. "Full Address · UPPERCASE"), so it travels with the one field
into partials and repeating sections and shows on hover;
`writeOakDocControlValue` prints the value in that case. To change a field's
case, remove it and add it again with the new case. Date fields (custom date
fields and scalar fields such as Incorporation Date, Resolution Date and First
Financial Year End; not the FYE or fields inside repeating sections) also offer
Date format: Default, common formats such as dd/mm/yyyy, d mmm yyyy and
d mmmm yyyy, or a custom pattern of d, m and y, where `do` prints the day as
an ordinal ("3rd") (`normalizeOakDocDateFormat`
turns "dd/mm/yyyy" into Word's "dd/MM/yyyy"). It is kept in the same title
("Resolution Date · dd/MM/yyyy") and applied at generation when the field
has a calendar date; a date control's own `w:date/w:dateFormat` wins.

Repeating section lettering (`src/lib/document-editor/oakdoc-repeater-lettering.ts`):
opening a section in the Repeating sections panel offers "Letter each one (a),
(b)". The choice is kept in the section's Word title (`w:alias`, e.g. "Officers
(Secretary) repeater · Lettered (a), (b)") and applies to every section with that
tag. At generation, when two or more items are listed, each copy's first
paragraph with text opens with "(a)" and a tab at its old left indent, and every
paragraph of the copy moves one OakDoc indent (720 twips) in. One item prints
unlettered; copies holding tables are left as they are.

One document per person (`src/lib/document-generation-per-person.ts`): in the
template editor, a directors, shareholders, officers or contacts section can be
switched to "Separate document for each person" (one section per template;
stored in the template's placeholders as a `documentPerPerson` definition keyed
by the section's tag, never copied from partials). On Configure that section's
people are picked on their own card instead of with the other parties, and each
person ticked gets a separate batch item of the template, titled
"<template> - <person>", whose usual selection (`selectedDirectorIds`,
`contactIds`, `selectedContactListIds[slug]`...) holds only that person and
whose `documentPerson` records whom it is for; preview and generation need
nothing else. Directors and shareholders start all ticked; a change of company
returns those documents to one, for nobody yet. Shared parties leave the
section out. Starter templates "F45" (consent to act as director, per director)
and "F45B" (consent to act as secretary, per contact on the "Corporate
secretary to be appointed" list) are in `src/content/secretarial/` and are
seeded with `scripts/seed-consent-form-templates.ts --email <login>`.

The corporate secretarial starters (`src/content/secretarial/corp-sec-*.ts`)
are seeded separately with `scripts/seed-corp-sec-templates.ts --email <login>
[--replace]`: 36 resolution partials (display names grouped "AGM - ",
"Officers - ", "Auditor - ", "Shares - ", "Company - ", "Bank - ",
"Dividend - ", "Striking Off - ", "General - "), 22 "Board Resolution - ..." and
"Members Resolution - ..." templates presetting them (Arial 10, underlined
headings), 19 standard documents (AGM notice, short notice consent, attendance
list, minutes, proxy and corporate representative forms, director and auditor
letters, nominee director agreement and indemnity, application for shares,
share certificate, instrument of transfer, solvency statement, dividend
voucher, striking off declaration, onboarding letters) and a draft
"Customer Due Diligence (Corporate Client)" form
(`src/lib/form-templates/sg-customer-due-diligence.ts`). The documents are
written with a small sentence kit (`corp-sec-oakdoc-kit.ts`) that collects
each one's custom fields and section names into its placeholders; custom keys
are shared across documents (`corp-sec-fields.ts`) so Shared setup asks once
per batch. People come from named contacts lists ("Applicant", "Transferor",
"Transferee", "Director to be appointed", "Authorised signatories",
"Nominator", "Nominee director"), the officers record, or the shareholders
record. `company.auditorName` and `company.auditorAddress` print the auditor
on record, and `shareholder.dividendAmount` is the holder's shares times the
`custom.dividend_per_share` amount entered on Configure. Parties print their
identification with its label (`contact.idLabel`, "NRIC No.", "UEN"), a
company's UEN standing in for a blank number, and wording that differs for a
company (signature blocks, "I/We") is a condition on `contact.isCorporate` or
`shareholder.isCorporate`. Share documents ask each party their own shares,
consideration and certificate number, checked against the document's totals.

The resolutions for a year without an AGM
(`src/content/secretarial/agm-resolutions.ts`) are seeded on their own with
`scripts/seed-agm-resolution-templates.ts --email <login> [--replace]`:
"Members Resolution - Dispense with AGM" (s.175A(1)(a)), "- Financial
Statements Sent (No AGM)" (s.175A(1)(b)) and "- Dormant Company" (s.175A,
s.201A, s.205B), and "Board Resolution - Dormant Company", the Directors'
confirmations (dormancy, relevant company status, declarations, exemptions,
approval of the declarations and annual return) under a preset "DORMANT
RELEVANT COMPANY" subject heading, with their own "AGM - " partials. The
directors' version asks on Configure since when the company has been dormant,
whether the group assets test applies (a parent company not itself a
subsidiary) and the annual return solvency answer for an exempt private
company ("Not applicable" leaves item (e) out); each choice is a condition
that keeps the lettered items' "; and" in the right place. A condition built
from a custom field registers that field, so a field only tested (the parent
company question) is still asked. They also preset the corporate
secretarial "Adoption of Financial Statements" and "Audit Exemption" partials,
found by name; only the first is refreshed, and only with `--replace`, which
also refreshes the default heading of each partial it replaces. The
re-election partial says "Director" or "Directors" by a condition on
`directors.isPlural` ("Yes" when the directors section lists more than one;
`shareholders.isPlural` likewise), set from the people ticked on Configure. Both seeds share
`scripts/lib/corp-sec-seed.ts`.

Per-person fields (`src/lib/document-editor/oakdoc-custom-fields.ts`,
`oakdoc-person-values.ts`): opening a directors, shareholders, officers or
contacts section in the Repeating sections panel offers per-person fields,
values Configure asks for each person the section lists (each transferor's
shares, each certificate's number). They are placed in the repeated text as
`item.<key>` controls and kept in the template's placeholders as `personField`
definitions keyed by the section's tag. A number or amount can be required to
"add up to" one of the document's custom fields: Configure shows a card per
section with a row per person, a running total and what is wrong, batch
completeness counts the issues, and `resolveOakDocGenerationInput` rejects a
generation whose values are missing, not numbers or do not tally. One person's
empty value takes the whole total.

Conditions inside a repeating section (`resolveOakDocItemConditions`) test the
printed person rather than the document: the condition picker offers each
section's item fields, among them Contact/Shareholder Is a Company, and
per-person fields. The global condition pass defers these (`deferField`), the
repeater resolves them per item against that person's values, and a leftover
pass removes any left in a section that printed nobody. A partial's conditions
are carried into the template when its body is placed
(`importOakDocConditionBlocks`), renumbered when an id clashes.

Service-specific input definitions use the `service` placeholder source, for
example `service.fields.software`, and may use the `textarea` type. The editor
keeps these separate from custom fields and preserves source, path, category,
type, and forward-compatible metadata on save. Stage 2
resolves those paths for a selected service and copies catalog fee defaults
into entity-specific agreement fee rows before rendering the reserved slots.

Material versioning provides the Stage 2 snapshot boundary.
`TemplatePartial.version` increments only when normalized `content` or
serialized `placeholders` changes. `ServiceVariant.version` increments once
per update when its name, linked partial, cadence/custom cadence label, or fee
template set changes. Labels, descriptions, display order, and active-state
maintenance do not independently create new material versions.

### Service Agreement generation

A Service Agreement generation draft has one tenant-scoped
`ServiceAgreement` record linked one-to-one to its `GeneratedDocument`.
Agreement entities, service items, item/entity assignments, and fee lines are
normalized relational data. This structured draft is the authority used by
the later Client Services activation workflow.

Representatives are item-specific multi-selections. The draft pins an ordered
snapshot for every authorised representative and stores a signer-ID subset;
at least one representative and signer are required, and every signer must be
one of the representatives. Rendering exposes `authorizedRepresentatives` for
the instructions table and `signers` for repeated keep-together client signing
blocks. Missing both email and phone is a non-blocking configuration warning.

Generation session metadata is versioned. Version 1 sessions remain readable
and are normalized to the three-stage version 2 model in memory; the next save
writes version 2. A version 2 Service Agreement session also returns its
relational agreement DTO. The document-session write and agreement upsert use
one interactive transaction.

For `SERVICE_AGREEMENT` templates, server rendering first replaces the three
reserved agreement slots. Each pinned SOW snapshot is resolved in an isolated
`service` context, followed by the entity-specific fee table and Appendix 3.
Normal master-template partial expansion and placeholder resolution run only
after that deterministic assembly. Saved wording never refreshes implicitly;
the explicit refresh endpoint replaces snapshot/version fields only.

The generated HTML remains editable. Its metadata records the agreement ID, a
canonical structured-data hash, and whether the user-edited HTML diverged from
the server render. HTML edits never reverse-sync to the relational agreement,
and later operational Services must consume the structured rows rather than
parse document content.

### Multi-template document generation batches

Document generation is orchestrated by a first-class `DocumentGenerationBatch`
aggregate with ordered `DocumentGenerationBatchItem` rows. Every item owns one
hidden `GeneratedDocument` child that becomes a normal document only when the
item reaches `GENERATED`; incomplete children are excluded from ordinary
document search and direct document access.

Rendering, preview fingerprints, review approval, and generation remain
server-authoritative. The server derives shared master fields from the
normalized custom placeholder keys and canonical types of all selected
templates (Word templates use their stored placeholders); a field is shared
once at least two documents use it, including two copies of one template.
Item overrides win over batch master values, which win over template
defaults. Shared setup also offers each party choice (directors, shareholders,
single director, shareholder or contact) used by two or more documents; a
change there is written onto each of those documents' configuration. Service Agreement services, fees, terms, representative, and entities
stay item-specific and persist transactionally through the existing
`ServiceAgreement` lifecycle.

Configure warns when a Word template prints a company value that is blank for
the primary company ("Missing company information"). The values come from
`GET /api/companies/[id]/document-fields?tags=…`, resolved exactly as
generation resolves them. `src/lib/document-editor/oakdoc-company-field-homes.ts`
maps each fillable value to where the company keeps it, with its input type:
UEN and incorporation date (profile identity), financial year end (compliance
data), first financial year end (the first confirmed financial period, as the
Compliance card saves it), registered office address (`company.registeredAddress`
and `company.address.*`) and paid-up capital (`company.paidUpCapital`,
`company.capital`). After the user enters a value they confirm where it goes:
**Save to company** (`POST /api/companies/[id]/document-fields`, which needs
`company:update`, only fills a blank value, and saves through
`saveCompanyProfileSection` or `confirmFirstFinancialYearEnd`, so validation,
schedule reconciliation and the audit log apply), or **Use for this document
only**, stored in the item's `configuration.companyFieldValues` and applied to
the company details before rendering (derived fields such as the first FYE and
the letter address follow). Blank derived fields with no editable home (for
example `company.secondaryActivity`) are listed without a save option. The
warning is advisory and does not block Review & generate. Add a home to the
mapping (and its section merge in `document-field-values.service.ts`) to cover
another field.

Generation claims items with conditional `READY -> GENERATING` updates carrying
an attempt ID and claim time. Claims older than 15 minutes are reclaimable.
Preflight is all-or-nothing, execution commits each item independently, and
retry never regenerates successful items. Task context is copied into every
child; because `TaskStageOutcome.taskStageId` is unique, the first successful
item by display order is the authoritative task-stage outcome.

### Signed agreement activation and operational Services

Signing activates the relational agreement data, never the rendered HTML. One
`ClientService` is created for every unique agreement-item/company pairing and
owns copies of only that entity's fee rows. Identity, cadence, dates, and field
values are operational and remain fully editable; pinned SOW wording and signed
document content remain immutable and are not exposed as Client Service fields.

Operational services have two origins. `source = AGREEMENT` rows come from
activation and keep their agreement/item lineage and generated-document link;
`source = MANUAL` rows are created by an authorized company editor from the
company Services tab and store null agreement lineage. Manual creation is
catalog-backed: the company-scoped options endpoint requires only
`company:update` (never `document:read`) and projects active variants, families,
linked SOW partials, operational `service.fields.*` definitions, and fee
templates. The create route snapshots current server-side family/variant names,
normalizes fee display order from request order, and keeps `source`, catalog
identity, and agreement lineage immutable.

The Services tab exposes permission-gated **Add service** actions, a shared
controlled operational form used by both create and edit, a duplicate warning
with an explicit override, and a success notice whose **View service** action
opens the returned DTO directly without waiting for a list refetch. List,
detail, update, archive and cleanup stay common through one
nullable-agreement DTO mapper with no per-service agreement lookups.

Envelope completion queues activation without depending on the post-commit
worker. The same authoritative completion transaction records
`GeneratedDocument.signedAt` for each linked generated document only when it is
still null, preserving the first successfully completed envelope timestamp.
Generated-document detail reads expose every live linked envelope with its
completion date and E-signing detail link. The scheduler claims pending or
retryable agreements with
`FOR UPDATE SKIP LOCKED`, a unique claim token, a five-minute lease, partial
queue indexes, and 1/5/15/60 minute backoff. Compare-and-set transitions keep
stale workers, retries, and repeated manual requests from overwriting newer
state. The task inherits the master scheduler switch and polls every minute.
Five failed attempts become `FAILED_PERMANENT`; an authorized retry resets the
agreement to `PENDING`. External agreements use Mark effective, which records
the actor, signed/effective dates, and audit reason. Automatic activation uses
the system change source; manual activation preserves its actor.
Automatic activation preserves an existing effective date or derives the
Singapore calendar date from envelope completion. It never uses delayed worker
execution time. Client Service edits use `updatedAt` optimistic preconditions;
domain writes and their audit entries commit or roll back together.
Manual creation runs the duplicate predicate, service/fee writes, audit
creation, and DTO reload inside one bounded serializable transaction; exhausted
serialization retries map to a retriable conflict, and simultaneous unconfirmed
creates cannot both silently succeed.

### Full Backups

`src/services/backup/full/` backs up the whole install, not one workspace.
The table list comes from the live database catalog, so a new table is covered
without code changes; only `_prisma_migrations`, `system_backups` and
`tenant_backups` (records about this machine; `tenant_backups` and
`backup_schedules` hold the retired per-workspace backups, whose code is gone) and the ACRA register
(`acra_entity`, `acra_sync_state`, re-downloaded by the ACRA sync) are left out,
and a restore leaves them as they are. Rows are exported with `row_to_json`
through one cursor per table inside one repeatable-read transaction that holds
every workspace's business-operation and contact-merge barriers, and every
stored file except `backups/` and `system-backups/` is copied.

A backup being made can be stopped (`stopFullBackup`): it is marked `FAILED`
with step `Stopped` at once, and the job, which re-checks its status between
tables, every 50,000 rows and every 100 archived files, rolls back its snapshot,
removes its work folder and keeps no file. Stop also clears a backup left
running by an app restart.

The result is one `.oakbackup` file: gzip inside AES-256-GCM, keyed by scrypt
from the backup password (Backup page; stored locked with `ENCRYPTION_KEY` so
schedules run unattended). Columns locked with `ENCRYPTION_KEY`
(`secret-columns.ts`: connector credentials, the stored backup password) are
unlocked into the archive and locked again with the restoring install's key,
so a restore on a new machine does not need the old key.

A full restore unpacks and verifies the whole file before touching anything,
refuses backups that carry migrations this install lacks, then, in one
transaction, drops every foreign key, pauses user triggers, truncates and loads
all tables with `json_populate_recordset`, and re-creates the foreign keys,
which re-checks every link. Stored files are written after the commit and
checked against their SHA-256. Uploads arrive in 8 MB chunks to stay under the
API middleware's request limit.

Restore can also be limited to modules (`modules.ts` groups every table;
a test fails if a table lands in "Other", and `backup_settings` is never
touched). `module-restore.ts` loads the chosen modules' backup rows into
temporary tables, counts rows added back, replaced, removed and unchanged by
primary key, and follows every foreign key crossing the edge of the selection.
A link that would break (restored rows pointing at records this machine no
longer has, or live rows pointing at records the restore would remove) blocks
the restore and names the module to add. The restore re-runs that check in the
same transaction, then drops only the foreign keys touching those tables,
truncates and reloads them, and re-creates the keys. Stored files missing from
this machine can be put back; files already here are never overwritten.

`sharepoint-target.ts` keeps a cloud copy. The Backup page picks a folder
through a workspace-owned SharePoint connector (the folder picker browses via
`/api/admin/backup/sharepoint/folders`, scoped to the connector's workspace).
Each finished full backup is uploaded there; the result is recorded on the
backup (`sharepoint_status`) and can be retried. After each upload only files
Oakcloud named (`oakcloud-YYYYMMDD-HHMM.oakbackup`) beyond the newest N are
deleted. Restore from SharePoint lists the folder's `.oakbackup` files and
copies one down as an uploaded backup, which is then checked and restored as
usual. Deleting a local backup leaves its SharePoint copy.

## Tasks And Pipelines Architecture

`/pipelines` manages tenant-scoped templates and `/tasks` runs work from them. Creating or editing a pipeline publishes a new immutable pipeline version. Creating a task copies that version's ordered stage definitions and checklist items into a locked live-task snapshot. Later template edits therefore affect future tasks only; an existing task never changes its stage structure or pipeline version.

The `src/services/tasks/` stage-action registry owns action configuration parsing, blockers, launch context, outcome summaries, and derived stage status:

| Adapter | Curated default icon | Authoritative module | Completion rule |
|---------|----------------------|----------------------|-----------------|
| `MANUAL` | `CircleCheckBig` | Tasks | Explicit manual completion |
| `COMPANY_PROFILE` | `Building2` | Company | A tenant-owned Company is linked |
| `DOCUMENT_GENERATION` | `FileText` | Document Generation | The linked `GeneratedDocument` is `FINALIZED` |
| `ESIGNING` | `PenLine` | E-signing | All required signatures are complete |

Tasks retain only links and immutable stage snapshots. Company, Generated Document, and E-signing Envelope records remain authoritative in their own modules. Optional `TaskLaunchContext` (`taskId`, `taskStageId`, `returnTo`) follows the user into those workspaces; creation/status callbacks link or reconcile the stage outcome. Detail reads also reconcile so missed callbacks self-heal. Declined, expired, voided, or cancelled envelopes derive a failed stage.

E-signing task stages use a durable preparation record rather than creating an envelope during navigation. Preparation selects the nearest preceding Document Generation stage and becomes eligible only after its generated document is finalized and every intervening stage, such as Review, is `COMPLETED` or `SKIPPED`. The worker creates or reuses one draft envelope, links it to the E-signing stage, and attaches one managed PDF without adding recipients, fields, or sending the envelope. Opening the task stage ensures legacy preparation state, polls `QUEUED` or `PROCESSING` work, and opens the prepared envelope when it reaches `READY`.

New e-signing recipients, including the current user added through “Add myself,” default to `MANUAL_LINK`. A user may save a private signature specimen in their user preferences. Public signing bootstrap data includes that specimen only when a valid authenticated account email exactly matches the active recipient email; clicking a signature field then requires explicit confirmation before applying it.

Completion delivery is independent of the request access mode: any signer or CC recipient with a stored email address receives a completion copy, including `MANUAL_LINK` signers. The completion worker reads the tenant-scoped signed artifact and its certificate, appends the certificate to each attached PDF, and falls back to the signed-document and certificate links when the combined attachments exceed the 20 MB email limit. Delivery rows remain idempotent and retryable per recipient.

Public signing sessions keep the editable field definitions scoped to the active signer. They separately expose `signedSignatures`, a read-only projection of finalized signature and initials placements from other signed signer recipients in the same tenant and envelope, with short-lived storage preview URLs for rendering earlier marks.

Outside tasks, "Send for e-signing" on a generated document (and "Send all for e-signing" on batch results) calls `POST /api/esigning/envelopes/from-documents`. After a confirmation it finalizes any drafts, creates one draft envelope for the documents' company, attaches them, and adds signers: everyone a directors or shareholders repeater prints (the ones ticked on Configure, or all), otherwise the selected director, shareholder and contacts. Signers with an email get `EMAIL_LINK`, others `MANUAL_LINK`. The user then places the signature fields and sends from the envelope page. Documents for different companies cannot share an envelope.

When E-signing is launched from a task, the stage modal can explicitly select any preceding finalized task-generated documents. The selected documents are attached to the new draft envelope as separate envelope documents; automatic preparation continues to use the nearest preceding finalized document.

Unfinalizing the generated document queues removal of only its managed envelope document; document-bound fields cascade away while recipients, manual documents, and envelope settings remain. Refinalizing queues a fresh PDF attachment to the same draft. Unfinalization is rejected after the related envelope leaves `DRAFT` unless it has been voided.

Preparation jobs are claimed in bounded batches with PostgreSQL `FOR UPDATE SKIP LOCKED`, so one worker can process unrelated tenants and pipelines concurrently and multiple application instances claim disjoint jobs. Claim leases recover abandoned `PROCESSING` work. Lifecycle callbacks request immediate processing after authoritative mutations commit, while the one-minute scheduler is the durable fallback. States are `WAITING`, `QUEUED`, `PROCESSING`, `READY`, `FAILED_RETRYABLE`, and `FAILED_PERMANENT`.

Task status is derived from all live stages as `NOT_STARTED`, `IN_PROGRESS`, or `COMPLETED`: every required stage must be completed, and every optional stage must be completed or explicitly skipped. `PAUSED` and `CANCELLED` are explicit task overrides. Optional stages may be skipped with a reason; required stages cannot be skipped. A skipped integrated stage remains a durable user override until it is reopened. Stage status includes `NOT_STARTED`, `IN_PROGRESS`, `WAITING`, `COMPLETED`, `SKIPPED`, and `FAILED`. The UI assigns fixed semantic surfaces and non-colour markers; pipelines store curated Lucide icon names but no user-defined colours.

The default tenant-aware seed reconciles the active `DR_Appointment of Corp Sec` Resolution and `Oaktree Master Services Agreement` Contract templates to canonical snapshots exported from the reference Docker workspace. The snapshots preserve exact HTML, placeholders, typography, line spacing, paragraph spacing, and A4 margins; a changed existing template receives one version increment while an exact rerun remains unchanged. The seed also soft-deletes legacy inactive Service Agreement names and publishes Client Onboarding with Company Profile, Generate Resolution, Generate Contract, and E-signing stages. Generate Resolution precedes Generate Contract so E-signing continues to target the contract. New installations publish version 1; an older three-stage version is upgraded to a new immutable version when it does not match the seeded stages. Deterministic IDs and a transaction keep reruns repeatable. The `--client-onboarding-only` flag applies only this template and pipeline seed without running unrelated setup steps.

### Legacy Module Reset

The 2026-07-24 migration is a complete reset of the retired Workflow/Projects data model: all `workflow_*` tables are dropped and the Task/Pipeline tables are created. There are no compatibility routes, redirects, or data migration. Company, Document Generation, E-signing, Contact, and other non-retired module records are preserved.

## Implemented Modules

| Module | Notes |
|--------|-------|
| Companies | Core company data, BizFile ingestion, compliance metadata |
| Contacts | Individual and corporate contacts |
| Document Generation | Templates, sharing, comments, exports |
| Document Vault | Extraction, revisions, duplicate detection; workspace-managed extraction prompts and quick context buttons |
| Forms | Builder, public forms, drafts, attachments, PDF export, AI review |
| Tasks | Versioned pipeline execution with responsive list and stage modal |
| Pipelines | Tenant-scoped reusable stage templates and immutable published versions |
| Exchange Rates | MAS sync and overrides |
| ACRA Entity Sync | Local mirror of the ACRA corporate entities collection (27 CSVs), daily date-comparison sync task, DB-backed company name availability checks |
| Chart Of Accounts | Hierarchical accounts and external code mapping |

## Planned Modules

| Module | Notes |
|--------|-------|
| Bank Reconciliation | Transaction matching and review |
| Client Portal | Client-facing access and requests |
| Accounting Integration | Xero, QuickBooks, MYOB |
