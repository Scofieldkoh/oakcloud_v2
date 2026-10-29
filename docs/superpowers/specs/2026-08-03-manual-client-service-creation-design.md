# Manual Client Service Creation Design

**Date:** 2026-08-03

**Last reviewed:** 2026-08-09

**Status:** Approved for implementation planning

## Context

Operational Client Services currently originate only from signed Service
Agreement activation. Authorized company editors also need to record a service
that is already being delivered when generating an agreement first would add no
value. Manual creation must retain a Service Catalog identity without inventing
an agreement or weakening the existing agreement activation contract.

## Goals

- Add a catalog-backed operational service from a company's Services tab.
- Require only `company:update` for the target company.
- Keep manual and agreement-created services visibly and structurally distinct.
- Preserve the flexible operational editor after creation.
- Warn about likely duplicates while allowing an explicit override.
- Reuse existing list, detail, edit, archive, search, status-filter, pagination,
  optimistic-concurrency, audit, backup, restore, and cleanup behavior.
- Preserve workspace isolation, server-owned catalog identity, and atomic writes.

## Non-Goals

- Creating a service without a Service Catalog variant.
- Generating a synthetic, hidden, or retrospective Service Agreement.
- Converting, merging, or linking a manual service when a later agreement
  activates a matching service.
- Enforcing SOW-required service fields on a manual operational record.
- Refreshing an existing Client Service automatically when its catalog variant
  changes.
- Adding a source filter to the Services tab.
- Preventing a duplicate after an authorized user explicitly confirms it.
- Changing agreement activation, signed content, or pinned SOW snapshots.

## Domain Model And Invariants

### Source

Add a required `ClientServiceSource` enum and `ClientService.source` field:

- `AGREEMENT` identifies a service created by signed agreement activation.
- `MANUAL` identifies a service created from the company Services tab.

`source` is immutable after creation. The update schema must not accept
`source`, `serviceVariantId`, `agreementId`, or `agreementItemId`.

`serviceVariantId` remains required and immutable for both sources. It is the
stable catalog identity used for traceability and duplicate detection.
`familyName` and `serviceName` are creation-time snapshots, not immutable
catalog projections, and remain editable through the common operational editor.

### Agreement Relationships

Make `agreementId`, `agreementItemId`, and their Prisma relations nullable.
Application logic and a migration-managed PostgreSQL check constraint must both
enforce:

```text
source = AGREEMENT -> agreement_id IS NOT NULL AND agreement_item_id IS NOT NULL
source = MANUAL    -> agreement_id IS NULL     AND agreement_item_id IS NULL
```

The constraint prevents scripts, restores, and future code paths from creating
an impossible source/reference combination. Prisma cannot declare this check,
so the migration and database reference documentation are authoritative for it.

Agreement activation must set `source: AGREEMENT` explicitly even though the
schema default is `AGREEMENT`. Manual creation must set `source: MANUAL`
explicitly. Neither flow may rely only on the default for domain correctness.

### Migration

The migration must:

1. Add the enum and `source` with a temporary/default value of `AGREEMENT`.
2. Backfill every existing Client Service as `AGREEMENT`.
3. Make both agreement foreign-key columns nullable.
4. Add the source/reference check constraint.
5. Retain the default for backward-compatible agreement writes.
6. Add the duplicate lookup index.

The existing unique constraint on `(agreementItemId, companyId)` remains the
agreement-activation idempotency boundary. PostgreSQL permits multiple rows
whose nullable `agreementItemId` is null, so confirmed manual duplicates remain
valid.

Add a non-unique lookup index covering:

```text
(tenantId, companyId, serviceVariantId, startDate, deletedAt)
```

`ClientServiceFeeLine.sourceAgreementFeeLineId` is already nullable. Every fee
row created manually leaves it null.

A later agreement activation that matches a manual service still creates a
separate `AGREEMENT` service. This preserves legal lineage and agreement-item
idempotency; there is no conversion or reconciliation flow.

## Authorization And Catalog Options

### Company-Scoped Options Endpoint

Add:

```http
GET /api/companies/{companyId}/services/catalog-options
```

The endpoint requires `company:update` for the target company. It must not reuse
the existing selectable Service Catalog route because that route requires
`document:read`, which is intentionally not required for manual service
creation.

The server derives the workspace from the authenticated session and returns only
active, non-archived variants whose family is active and non-archived and whose
linked SOW partial is non-archived. Cross-workspace or unavailable companies use
the repository's non-revealing not-found behavior.

The response contains only the data needed by the operational form:

- variant ID and name;
- family ID and name;
- service cadence and optional custom cadence label;
- merged `service.fields.*` definitions from the current SOW partial graph;
- fee templates in display order.

Use this response contract:

```ts
interface ManualClientServiceCatalogOptionsResponse {
  variants: Array<{
    id: string;
    name: string;
    family: { id: string; name: string };
    serviceCadence: ServiceCadence;
    customCadenceLabel: string | null;
    fields: Array<{
      key: string;
      label: string;
      type: 'text' | 'date' | 'number' | 'currency' | 'boolean' | 'textarea';
      defaultValue: string | null;
    }>;
    feeTemplates: Array<{
      description: string;
      defaultAmount: string | null;
      currency: string;
      billingFrequency: BillingFrequency;
      customFrequencyLabel: string | null;
      displayOrder: number;
    }>;
  }>;
}
```

For service fields, return the unprefixed operational key, display label, input
type, and optional default value. SOW `required` metadata has no effect on manual
creation and should not be presented as an operational requirement. Do not
return SOW content, legal wording, document placeholders outside
`service.fields.*`, or unrelated catalog administration fields.

Merging service-field definitions must reuse the existing SOW snapshot/partial
composition semantics so definitions in nested partial dependencies are not
lost. Duplicate definitions resolve deterministically through the existing
composition rules.

## Manual Creation API

Add:

```http
POST /api/companies/{companyId}/services
```

The route requires `company:update`, derives the actor and workspace from the
session, and returns HTTP `201` with the created `ClientServiceDto`.

### Request Contract

The request accepts:

- `serviceVariantId`;
- `status`, defaulting on the server to `ACTIVE`;
- `serviceCadence` and an optional custom cadence label;
- required `startDate` and optional `endDate`;
- `fieldValues` as flexible operational key/value strings;
- one to 100 fee rows;
- `confirmDuplicate`, defaulting to `false`.

Use this request contract:

```ts
interface CreateManualClientServiceRequest {
  serviceVariantId: string;
  status?: 'ACTIVE' | 'PAUSED' | 'ENDED';
  serviceCadence: ServiceCadence;
  customCadenceLabel?: string | null;
  startDate: string;
  endDate?: string | null;
  fieldValues?: Record<string, string>;
  feeLines: Array<{
    description: string;
    amount: string;
    currency: string;
    billingFrequency: BillingFrequency;
    customFrequencyLabel?: string | null;
    billingStartDate?: string | null;
  }>;
  confirmDuplicate?: boolean;
}
```

The server normalizes omitted `fieldValues` to an empty object, omitted nullable
values to null, `status` to `ACTIVE`, and `confirmDuplicate` to false.

The request must not accept `source`, agreement references, `familyName`, or
`serviceName`. Manual fee-row IDs are generated by the server, display order is
normalized from request array order, and `sourceAgreementFeeLineId` is never
accepted from the client.

Apply the existing operational limits, including:

- date-only ISO values and `endDate >= startDate`;
- a non-empty custom cadence label only when cadence is `CUSTOM`;
- at most 100 operational field keys and 10,000 characters per value;
- non-empty fee descriptions;
- non-negative fixed-point amount strings with at most two decimal places;
- three-letter uppercase currency codes;
- a non-empty custom frequency label only for `CUSTOM` frequency;
- optional date-only billing start dates.

`0.00` is a valid explicit fee. Blank and negative amounts are invalid. Billing
frequency is always explicit; the server must not infer it from service cadence.

Catalog service fields are optional suggestions. The client may prefill catalog
definitions and their defaults, but the server does not enforce SOW `required`
flags, reject additional operational fields, or require catalog-defined fields
to remain present. This flexibility continues on later edits.

### Server-Owned Catalog Identity

Inside the creation transaction, reload the catalog variant using all of:

- the selected variant ID;
- the authenticated workspace;
- `deletedAt = null` and `isActive = true` for the variant;
- an active, non-archived family in the same workspace;
- a non-archived linked SOW partial in the same workspace.

Snapshot the current server-side variant and family names into `serviceName` and
`familyName`. If the active variant changed while the modal was open, accept the
submitted operational cadence, dates, fields, and fees and use the latest names.
No variant-version precondition is required. If any required catalog parent was
archived or deactivated, reject creation and ask the user to select another
service.

## Duplicate Warning Contract

A likely duplicate is any non-archived Client Service in the same workspace and
company with the same `serviceVariantId` and exact date-only `startDate`.
`ACTIVE`, `PAUSED`, and `ENDED` records all participate, regardless of source.
Archived records do not.

Run the lookup inside the same retryable serializable transaction as creation.
This predicate read ensures that simultaneous unconfirmed requests cannot both
silently create a service: a serialization loser retries, sees the committed
match, and receives the duplicate warning.

When `confirmDuplicate` is false and one or more matches exist, return HTTP `409`
without creating a service, fee row, or audit event:

```json
{
  "error": "A matching client service already exists.",
  "code": "DUPLICATE_CLIENT_SERVICE",
  "duplicates": {
    "total": 2,
    "items": [
      {
        "id": "existing-service-id",
        "serviceName": "Corporate Secretarial",
        "startDate": "2026-08-03",
        "status": "ACTIVE",
        "source": "MANUAL"
      }
    ]
  }
}
```

Return at most five summaries, ordered by `createdAt DESC` with a stable ID
tie-breaker. `total` reports every match. The summaries expose only the existing
service ID, displayed name, start date, status, and source.

Choosing **Add anyway** resubmits the unchanged request with
`confirmDuplicate: true`. The server repeats authorization, catalog, validation,
and transaction checks and bypasses only the duplicate warning. No reason is
required. The creation audit records that the duplicate override was confirmed.

Direct API clients with `company:update` may submit `confirmDuplicate: true`
without first obtaining a warning. This is an authorized business override, not
a security boundary.

## Transaction And Audit Contract

Use the repository's bounded `runSerializableTransaction` helper. Within one
transaction:

1. Validate the company and current catalog identity in the workspace.
2. Perform the duplicate predicate read unless confirmation is true.
3. Create the `MANUAL` Client Service.
4. Create its normalized fee rows.
5. Create the `CREATE` audit event.
6. Reload and return the complete DTO.

Database, fee, or audit failure rolls back every write. Exhausted serialization
retries return a retriable concurrency conflict rather than a validation error.

The audit event records the actor, company, manual source, catalog variant ID,
fee count and totals, and whether a duplicate override was used. It must not
record operational field values. No duplicate audit is written when an
unconfirmed request is rejected.

## User Interface

### Entry Points And Catalog Selection

The Services tab displays **Add service** beside the list controls and in the
true empty state when the user has edit permission. Read-only users do not see
either action. Filtered-empty states retain the primary action near the controls
without duplicating it in the filter result message.

The action opens a single scrollable Add Service modal using the existing
compact modal, responsive grid, mobile touch-target, focus-management, and
accessible error patterns.

The catalog selector is searchable and grouped by family. Until a service is
selected, dependent cadence, field, and fee sections are unavailable. An empty
catalog-options response explains that no active services are available; it does
not show a document-administration link to a user who may lack `document:read`.

### Defaults And Editable Values

Selecting a variant:

- sets status to `ACTIVE` for a new untouched form;
- copies service cadence and its custom label;
- adds merged catalog service fields and their optional defaults;
- copies catalog fee templates in display order;
- leaves required start date and optional end date blank.

All copied operational values remain editable. Service-field definitions are
optional, may be removed or replaced, and do not prevent adding arbitrary
fields.

For each catalog fee template, use its description, currency, frequency, custom
frequency label, display order, and default amount when present. A missing
default amount remains blank and blocks submission until the user explicitly
enters a valid amount.

If the selected variant has no fee templates, create one required fee row with:

- description set to the service name;
- currency set to `SGD`;
- blank amount;
- blank billing frequency;
- blank custom frequency and billing start date.

This avoids inventing commercial terms. The last remaining fee row cannot be
removed.

### Dirty State And Catalog Switching

Changing the selected variant replaces only catalog-derived cadence, service
fields, and fees. Status and dates remain intact. If any values that would be
replaced have been modified, require confirmation before discarding them.

The form is dirty whenever it differs from its initial empty state, including
after catalog selection. Cancel, the modal close button, Escape, and backdrop
close all require discard confirmation for a dirty form. An untouched form
closes immediately.

### Duplicate Confirmation

Keep the form open and retain every entered value after a duplicate response.
Show the total match count and up to five returned summaries in an accessible
warning. **Cancel** dismisses only the warning and returns to the unchanged form.
**Add anyway** resubmits the same values with confirmation and requires no
reason.

Disable repeated submit actions while a request is pending. Network and server
failures leave the form open and preserve its draft.

### Success And List Behavior

After creation:

1. Close the modal.
2. Invalidate the company service list and created service detail queries.
3. Preserve the user's current search, status, page-size, and pagination state.
4. Show a success notice with **View service**.

**View service** opens the returned DTO directly. If search or status filters
exclude it, clear only those excluding filters and reset pagination as needed;
the action must not depend on the new record already being present on the
current sorted page.

Agreement-created cards retain their Service Agreement link. Manual cards show
**Added manually** in the same metadata area. No source filter is added. Both
sources retain the same edit action and archive flow.

Existing empty-state and edit/archive descriptions must become source-aware.
Manual records must never claim that an edit or archive leaves a nonexistent
signed agreement unchanged.

## Component Boundaries

Share the operational form body rather than combining all create and edit state
in one component:

- A controlled operational-service form owns common status, cadence, date,
  field, fee, and client-validation controls.
- The create wrapper owns catalog loading, default application, catalog-switch
  confirmation, dirty-close confirmation, duplicate state, and creation.
- The edit wrapper retains optimistic `updatedAt` conflict recovery, reload,
  archive, and source-aware explanatory copy.
- Dedicated hooks load company-scoped catalog options and create a service.
- Shared request handling retains structured error codes and details.

Create-only catalog state and edit-only archive/conflict state must not leak into
the common form. Avoid unrelated refactoring of the existing Services tab.

## DTO And Query Behavior

`ClientServiceDto` exposes:

```ts
source: 'AGREEMENT' | 'MANUAL';
agreementId: string | null;
agreementItemId: string | null;
agreement: AgreementSummary | null;
```

Agreement services retain the current document title, agreement status,
activation status, generated document ID, and link. Manual services return null
for both IDs and the summary.

List and detail queries use an optional agreement include and map both sources
without per-service secondary queries. List, detail, update, archive, search,
status filtering, pagination, optimistic editing, fixed-point fee
serialization, and audit behavior remain common.

## Error Contract

- Authentication failures use the existing unauthorized response.
- Missing permission uses the existing permission response before mutation.
- Unavailable or cross-workspace company/catalog records use non-revealing
  not-found responses.
- Input failures return HTTP `400`, code `VALIDATION_ERROR`, and field-addressable
  details such as `feeLines.0.amount`.
- Likely duplicates use HTTP `409` and `DUPLICATE_CLIENT_SERVICE`.
- Exhausted transaction retries use HTTP `409`, code
  `CLIENT_SERVICE_WRITE_CONFLICT`, and `retriable: true`.
- Database and audit failures return the existing safe server error after full
  rollback.

Validation and retry-exhaustion responses use these shapes:

```json
{
  "error": "The service could not be created.",
  "code": "VALIDATION_ERROR",
  "details": {
    "fieldErrors": {
      "feeLines.0.amount": "Enter a non-negative amount with at most two decimals."
    }
  }
}
```

```json
{
  "error": "Service creation conflicted with another write. Try again.",
  "code": "CLIENT_SERVICE_WRITE_CONFLICT",
  "details": { "retriable": true }
}
```

The current generic API helper serializes `ApiError` as only `{ error }` and the
current client `HttpRequestError` retains only a message and status. The
implementation must extend or route around those boundaries so stable codes and
structured details reach the create form. Do not infer a duplicate from message
text.

If the catalog selection becomes inactive or archived while the modal is open,
keep the form open, attach the error to the selector, and explain that another
catalog service must be chosen.

## Testing Strategy

Implement test-first coverage for:

1. **Schema and migration:** source enum/default, nullable relations, source
   check constraint, preserved agreement uniqueness, and duplicate index.
2. **Validation:** server defaults, required variant/start date, date order,
   cadence rules, flexible catalog/custom fields, field limits, one-to-100 fee
   rows, explicit frequency, blank/negative rejection, and accepted `0.00`.
3. **Catalog options:** `company:update` without `document:read`, workspace
   isolation, active-parent filtering, nested service-field composition,
   metadata minimization, defaults, and empty results.
4. **Creation service:** current server-owned names, editable operational values,
   catalog changes during an open form, manual source/null references, fee order,
   null source fee IDs, audit contents, and rollback.
5. **Duplicates:** exact matching key, all non-archived statuses and sources,
   archived exclusion, deterministic five-item cap, total count, no rejected
   mutation/audit, confirmed creation, and later independent agreement
   activation.
6. **Concurrency:** database-backed simultaneous unconfirmed creates proving one
   succeeds and the other returns a duplicate after serializable retry.
7. **Routes:** endpoint permissions, non-revealing not-found behavior, HTTP
   `201`, field-addressable `400`, structured `409`, and retry exhaustion.
8. **Components:** permission-gated actions, selector grouping/search, defaults,
   no-template fee behavior, `0.00`, variant-switch confirmation, dirty-close
   confirmation through every exit, duplicate-state retention, pending-state
   controls, success notice, **View service**, source labels, nullable agreement
   rendering, and accessible errors.
9. **Regression:** agreement activation still creates explicit `AGREEMENT`
   services idempotently, and existing list/edit/archive/backup/restore/cleanup
   behavior works for both sources.

## Documentation And Operational Compatibility

Implementation updates existing documentation rather than adding unrelated
files:

- `docs/ARCHITECTURE.md` describes both operational-service origins.
- `docs/guides/SERVICE_PATTERNS.md` documents source invariants, manual creation,
  duplicate handling, and common editing behavior.
- `docs/reference/DATABASE_SCHEMA.md` documents the nullable relationships,
  source check constraint, retained unique constraint, and duplicate index.

Backup export, restore, and tenant cleanup continue to use the existing Client
Service tables. Their fixtures and tests must support nullable agreement
references and the new source field. Refresh generated Prisma artifacts using
the repository's existing generation command.

## Acceptance Criteria

- A user with `company:update`, but not necessarily `document:read`, can load the
  minimal active catalog options and add a manual service.
- The service is linked to an active catalog variant without creating an
  agreement and is persisted with `source = MANUAL` and null agreement
  references.
- Status initially defaults to `ACTIVE`; start date has no default and is
  required.
- Catalog cadence, optional service-field defaults, and fee templates populate
  an editable form. SOW-required fields do not block manual creation.
- A catalog service without fee templates produces one incomplete fee row with
  the service name and `SGD`; amount and frequency require explicit input.
- `0.00` is accepted, while blank or negative fee amounts are rejected.
- Dirty variant changes and every dirty modal exit require confirmation before
  discarding affected values.
- A matching company, catalog variant, and exact start date returns a structured
  warning with the total and at most five newest matches.
- Cancelling the warning creates nothing and preserves the form. **Add anyway**
  creates and audits the duplicate without requiring a reason.
- Concurrent unconfirmed requests cannot both create a service silently.
- Active catalog edits do not invalidate an open draft; inactive or archived
  catalog selections do.
- Creation closes the modal, refetches data, preserves filters, and offers a
  reliable **View service** action.
- Manual cards show **Added manually**; agreement cards retain their agreement
  link; no source filter is introduced.
- Names remain editable, while source, catalog identity, and agreement lineage
  remain immutable.
- Manual and agreement-created services share the existing edit, archive, list,
  search, status-filter, pagination, audit, backup, restore, and cleanup flows.
- A later matching agreement activation creates an independent agreement-backed
  service without modifying the manual record.
- Unauthorized, cross-workspace, inactive, archived, invalid, concurrent, or
  failed writes never leave partial service, fee, or audit records.
