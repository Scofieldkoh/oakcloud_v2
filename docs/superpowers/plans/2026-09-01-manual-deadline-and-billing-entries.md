# Manual Deadline And Billing Entries Implementation Plan

> **For implementers:** Execute this plan task-by-task using test-first changes. Keep the existing rule-driven deadline cycle and scheduled billing flows intact while adding a separate one-off manual-entry path.

**Status:** Draft for product confirmation

**Goal:** Let an authorized user add a one-off deadline or billing tracking item from the Deadlines page, Billing page, or a selected service modal. Every item must be linked to one Company and one Client Service. When no suitable service exists, the same flow can atomically create a named ad-hoc Client Service that then appears in Services.

**Architecture:** Manual entries are first-class occurrences, not synthetic schedule rules, cycles, fee schedules, agreements, or global catalog variants. A shared target contract selects either an existing Client Service or a new company-scoped ad-hoc Client Service. The API creates the target service and occurrence in one serializable transaction, records both audit events, and uses a client-generated request key for retry idempotency. Rule reconciliation and billing reconciliation explicitly ignore manual occurrences.

**Tech stack:** Next.js 15 App Router, React 19, TypeScript, Prisma/PostgreSQL, TanStack Query, Tailwind CSS, Vitest, Testing Library, Vitest Browser/Playwright

**Related context:**

- `docs/superpowers/specs/2026-08-03-manual-client-service-creation-design.md`
- `docs/superpowers/specs/2026-08-17-services-administration-deadlines-billing-design.md`
- `docs/superpowers/plans/2026-08-17-deadline-engine-and-services-workspace.md`
- `docs/superpowers/plans/2026-08-17-billing-tracking-and-reconciliation.md`

**Compatibility note:** Approval of this plan narrowly supersedes the earlier manual-service design's non-goal of creating a Client Service without a Service Catalog variant. The exception applies only to `serviceKind = AD_HOC`; existing and future catalog-backed manual services retain their required, immutable catalog identity and all existing behavior.

## Recommended Product Decisions

This plan recommends the following defaults. Confirm these before implementation if the intended behavior differs.

1. **Manual means one-off.** An added deadline is one independently managed due item. An added billing item is one tracking record. Recurring deadlines still belong in deadline rules, and recurring billing still belongs in a service fee schedule.
2. **Ad-hoc is a real Client Service, not a catch-all catalog service.** It is company-scoped, named by the user, visible in Services, editable and archivable like other operational services, and does not appear in the tenant-wide Service Catalog.
3. **Do not silently reuse a generic “Ad hoc service.”** Users should select an existing service, including an existing ad-hoc service, or give a new ad-hoc service a meaningful name. This keeps reporting and history understandable.
4. **Keep manual entry distinct from “Trigger cycle.”** The existing action evaluates a published deadline rule for a historical period and remains available. The new **Add deadline** action does not need a rule, cycle, parameters, or preview.
5. **Add `MANUAL_ONLY` billing disposition.** A service with only directly entered billing items should not be marked `NOT_REQUIRED` and should not produce missing-fee-schedule coverage warnings. Adding a manual billing item to an `UNREVIEWED` or `NOT_REQUIRED` service changes it to `MANUAL_ONLY`; a `CONFIGURED` service remains configured and may contain both scheduled and one-off billing items.
6. **No hard-delete action in the first release.** Incorrect manual entries use the existing Waive/Reopen lifecycle with a reason. Permanent Client Service deletion continues to remove dependent history through the existing guarded service-deletion flow.
7. **Service archive cancels; permanent deletion erases.** Archiving a Client Service preserves every occurrence record but changes eligible manual items dated on or after the Singapore archive date from Open to Cancelled. Permanent deletion removes all linked scheduled and manual deadlines/billing items, regardless of date or status, through the existing destructive confirmation flow.

## User Experience

### Entry points

- **Deadlines page:** show **Add deadline** beside the filter/column controls when the user can update a company and deadline occurrence writes are enabled.
- **Billing page:** show **Add billing item** beside the filter/column controls when the user can update a company.
- **Selected service modal:** show **Add deadline** in the Deadlines panel and **Add billing item** in the Billing panel. The Company and Client Service are preselected and read-only.
- **Services page Add service flow:** add a **From catalog / Ad hoc** choice so users can also create an ad-hoc service intentionally without first creating an occurrence.

### Page-level target flow

The first section of both dialogs is shared:

1. Search for an accessible Company.
2. Choose **Existing service** or **New ad-hoc service**.
3. Existing service mode searches all non-archived services for the selected Company and shows service status plus an Ad hoc/Catalog badge.
4. New ad-hoc mode requires a meaningful service name, defaults the service start date to the current Singapore date, sets cadence to `AD_HOC`, family label to `Ad hoc`, source to `MANUAL`, and status to `ACTIVE`.
5. Changing the Company clears the selected service and any unsaved ad-hoc target fields after confirmation.

Do not create the ad-hoc service until the whole dialog is submitted successfully. Validation or occurrence-write failure must leave no orphan Client Service.

### Manual deadline fields

- Title, required, 1–200 characters.
- Deadline type: Statutory, Client, or Internal; default `CLIENT`.
- Due date, required date-only value.
- Initial status: Open or Completed; default `OPEN`.
- Completion date, optional and available only for Completed.
- Notes, optional, maximum 5,000 characters.

The list, calendar, event popover, and selected-service summary show a **Manual** source badge and the authored title. Resetting a later date override returns to the originally authored due date.

### Manual billing fields

- Description, required, 1–500 characters.
- Expected date, required date-only value.
- Amount, required non-negative fixed-point string with at most two decimals.
- Currency, required three-letter uppercase code; default `SGD`.
- Initial status: Open or Billed; default `OPEN`.
- Billed date, optional and available only for Billed.
- External reference, optional, maximum 200 characters.
- Notes, optional, maximum 2,000 characters.

The table and edit dialog show a **Manual** source badge. Manual billing supports only **This occurrence** updates because there is no fee-line schedule to propagate to. Resetting an amount or date override returns to the values authored at creation.

### Selected-service modal and unsaved edits

Manual occurrence creation is independent of service-form edits. If the selected service modal has unsaved changes, disable both manual-entry buttons and show **Save or discard service changes before adding an item**. This prevents a new occurrence from being created against configuration that the user can still cancel.

After a successful create, keep the service modal open, refetch its open deadline/billing summaries, and show a compact success notice. From a workspace page, close the create dialog, retain current filters, invalidate the relevant list and roster queries, and reveal the new row even when the current date filter would otherwise hide it by offering **View item** rather than silently changing filters.

### View Service presentation

Yes, manual entries are part of the selected Client Service and must appear in **View Service**:

- The Deadlines panel shows all current Open manual and generated deadlines for the service. Manual rows use their authored title and a **Manual** badge.
- The Billing panel shows all current Open manual and scheduled billing items. Manual rows use their description snapshot and a **Manual** badge.
- Each panel provides **View all deadlines** or **View all billing** to open the corresponding workspace pre-filtered to the Client Service. This is the complete history view for Completed, Billed, Waived, and Cancelled items; the compact service modal remains focused on current Open work.
- A Cancelled manual item created by service archive no longer appears in the Open summary, but remains available through the filtered history view.

### Service archive and permanent deletion

Keep the existing distinction between the two service-removal actions:

- **Archive service** is non-destructive. Before confirmation, show impact counts for future Open scheduled and manual deadlines/billing items. On confirmation, directly cancel `MANUAL_ENTRY` rows whose operative due/expected date is on or after the current Singapore date, with reason `Client service archived`; scheduled rows continue through existing reconciliation. Preserve overdue Open rows, manually overridden protected rows, and every Completed, Billed, Waived, or already Cancelled row. Record cancelled manual counts in the service archive audit. Restoring/recreating configuration must not automatically reopen cancelled manual entries.
- **Permanently delete service** is destructive and irreversible. The existing reason, optimistic timestamp, explicit warning, and returned deletion counts remain mandatory. Delete all linked manual and scheduled deadline occurrences, billing occurrences, cycles, rules, fee lines, and coverage issues in the same transaction, regardless of whether they are past or future. The confirmation copy must explicitly say that manual history is included.

## Domain Model

### Client Service classification

Keep `ClientService.source` as creation provenance (`AGREEMENT` or `MANUAL`) and add a separate classification:

```prisma
enum ClientServiceKind {
  CATALOG
  AD_HOC
}

model ClientService {
  serviceKind     ClientServiceKind @default(CATALOG) @map("service_kind")
  serviceVariantId String?          @map("service_variant_id")
  serviceVariant   ServiceVariant?  @relation(...)
}
```

Enforce these invariants with migration-owned PostgreSQL checks as well as service-layer validation:

```text
source = AGREEMENT
  -> service_kind = CATALOG
  -> agreement_id, agreement_item_id, service_variant_id are all present

source = MANUAL and service_kind = CATALOG
  -> agreement_id and agreement_item_id are null
  -> service_variant_id is present

source = MANUAL and service_kind = AD_HOC
  -> agreement_id, agreement_item_id, service_variant_id are all null
  -> service_cadence = AD_HOC
```

Backfill all existing Client Services to `CATALOG`. Existing manual catalog-backed services remain valid and unchanged. Ad-hoc records use the server-owned family snapshot `Ad hoc`; their user-authored `serviceName` remains editable through the operational editor.

Extend `BillingDisposition` with `MANUAL_ONLY`:

- `CONFIGURED`: one or more active valid fee schedules and scheduled occurrences.
- `MANUAL_ONLY`: zero active fee schedules; direct one-off billing items are allowed and billing coverage is satisfied.
- `NOT_REQUIRED`: no billing expected; a reason remains required.
- `UNREVIEWED`: migration/review state.

Do not create a hidden Service Agreement, Service Variant, SOW partial, or catalog family for an ad-hoc Client Service.

### Deadline occurrence origin

Separate occurrence origin from `ServiceCycleOrigin`:

```prisma
enum DeadlineOccurrenceOrigin {
  RULE
  MANUAL_TRIGGER
  MANUAL_ENTRY
}

model DeadlineOccurrence {
  cycleId        String?                    @map("cycle_id")
  ruleVersionId  String?                    @map("rule_version_id")
  origin         DeadlineOccurrenceOrigin   @default(RULE)
  manualTitle    String?                    @map("manual_title") @db.VarChar(200)
  manualEntryKey String?                    @map("manual_entry_key") @db.Uuid
  cycle          ServiceCycle?              @relation(...)
  ruleVersion    DeadlineRuleVersion?       @relation(...)

  @@unique([tenantId, manualEntryKey])
}
```

Database checks enforce:

```text
origin in (RULE, MANUAL_TRIGGER)
  -> cycle_id and rule_version_id are present
  -> manual_title and manual_entry_key are null

origin = MANUAL_ENTRY
  -> cycle_id and rule_version_id are null
  -> manual_title and manual_entry_key are present
```

For a manual deadline, `calculatedDueDate` and `operativeDueDate` initially equal the authored due date, `milestoneKey` is a stable internal `manual-<request-id>` key, and `scheduleEntryKey` is empty. Existing lifecycle/date override behavior remains shared.

### Billing occurrence origin

Make a manually entered billing item independent of fee-schedule configuration:

```prisma
enum BillingOccurrenceOrigin {
  SCHEDULED
  MANUAL_ENTRY
}

model BillingOccurrence {
  feeLineId          String?                  @map("fee_line_id")
  feeLine            ClientServiceFeeLine?    @relation(...)
  origin             BillingOccurrenceOrigin  @default(SCHEDULED)
  descriptionSnapshot String                  @map("description_snapshot") @db.VarChar(500)
  manualEntryKey     String?                  @map("manual_entry_key") @db.Uuid

  @@unique([tenantId, manualEntryKey])
}
```

Backfill `descriptionSnapshot` from the linked fee line and set all existing rows to `SCHEDULED`. Database checks enforce a fee line for scheduled rows and prohibit a fee line for manual rows. Keep the existing schedule identity fields non-null for compatibility; manual rows receive internal `manual:<date>` period and `manual:<request-id>` generation values.

The billing reconciler must query and mutate only `origin = SCHEDULED`. Coverage calculations count only configured fee schedules and scheduled occurrence gaps. Manual occurrences remain visible in normal billing totals but cannot fill or create a schedule-coverage gap.

### Shared create target

Use one strict discriminated union in both create payloads:

```ts
type ManualEntryTarget =
  | {
      mode: 'EXISTING_SERVICE';
      companyId: string;
      clientServiceId: string;
    }
  | {
      mode: 'NEW_AD_HOC_SERVICE';
      companyId: string;
      serviceName: string;
      serviceStartDate: string;
    };
```

The server reloads and validates every target inside the write transaction. It never trusts submitted tenant, Company name, service family, source, kind, status, or cadence values.

## API Contracts

### Company service options

Add a lightweight picker endpoint:

```http
GET /api/companies/{companyId}/services/options?query=&page=1&limit=20
```

It requires `company:update` for the target Company and returns non-archived Client Services with only ID, name, family label, status, source, kind, and pagination. Sort Active, Paused, then Ended, followed by service name. Tenant and accessible-company constraints must be applied in SQL.

### Create manual deadline

Extend the existing collection route:

```http
POST /api/deadlines
```

```ts
interface CreateManualDeadlineInput {
  requestId: string; // client-generated UUID, stable across retries
  target: ManualEntryTarget;
  title: string;
  deadlineType: 'STATUTORY' | 'CLIENT' | 'INTERNAL';
  dueDate: string;
  status: 'OPEN' | 'COMPLETED';
  completionDate?: string | null;
  notes?: string | null;
}
```

Return HTTP `201` with:

```ts
interface CreateManualDeadlineResponse {
  occurrence: DeadlineOccurrenceDto;
  service: ClientServiceDto;
  serviceCreated: boolean;
}
```

An idempotent replay returns the existing response without creating another audit event. The route requires `company:update`, Services workspace enablement, and deadline writes enablement.

### Create manual billing item

Extend the existing collection route:

```http
POST /api/billing-occurrences
```

```ts
interface CreateManualBillingInput {
  requestId: string; // client-generated UUID, stable across retries
  target: ManualEntryTarget;
  description: string;
  expectedDate: string;
  amount: string;
  currency: string;
  status: 'OPEN' | 'BILLED';
  billedDate?: string | null;
  externalReference?: string | null;
  notes?: string | null;
}
```

Return the same response envelope shape with a `BillingOccurrenceDto`. The route requires `company:update` and Services workspace enablement. If the target service is `NOT_REQUIRED` or `UNREVIEWED`, change its disposition to `MANUAL_ONLY` in the same transaction and include that change in the Client Service audit event.

### Error and idempotency behavior

- `400 VALIDATION_ERROR`: field-addressable validation details.
- `403`: the actor cannot update the selected Company.
- `404`: non-revealing response for cross-tenant, inaccessible, archived, or mismatched Company/service targets.
- `409 MANUAL_ENTRY_WRITE_CONFLICT`: serializable retries were exhausted.
- Reusing one `requestId` with an identical normalized payload returns the original result.
- Reusing one `requestId` with a different payload returns `409 IDEMPOTENCY_KEY_REUSED`.
- The UI keeps the same `requestId` for retries and generates a new one only after success or an explicit full-form reset.

## Transaction And Audit Contract

Both create services use `runSerializableTransaction`. Within one transaction:

1. Resolve the authenticated tenant and validate the Company.
2. Require Company update permission at the route boundary and re-check target integrity in the service layer.
3. Look up `manualEntryKey`; return the prior identical result or reject a conflicting reuse.
4. Resolve the existing Client Service, or create a `MANUAL` + `AD_HOC` Client Service through a shared transaction-aware helper.
5. Apply any required billing-disposition transition.
6. Create the manual occurrence.
7. Write a Client Service audit event when a service was created or its billing disposition changed.
8. Write the occurrence `CREATE` audit event.
9. Reload and return the full DTO.

Any service, occurrence, or audit failure rolls back everything. Do not enqueue deadline or billing reconciliation for a manual occurrence. Logs and reconciliation metrics must never include titles, descriptions, notes, or external references.

## Implementation Tasks

### Task 1: Define strict contracts and validation

**Files:**

- Create: `src/lib/validations/manual-entry.ts`
- Create: `__tests__/lib/manual-entry-validation.test.ts`
- Modify: `src/lib/validations/client-service.ts`
- Modify: `src/lib/validations/deadline.ts`
- Modify: `src/lib/validations/billing.ts`
- Modify: `src/services/client-service/types.ts`
- Modify: `src/services/deadline/types.ts`
- Modify: `src/services/billing/types.ts`

- [ ] Add the shared `ManualEntryTarget` discriminated union and bounded field schemas.
- [ ] Add create request/response types and the new service/billing/deadline origin types.
- [ ] Add an exact optional `clientServiceId` list filter to deadline and billing search contracts so View Service history links do not rely on a non-unique service-name search.
- [ ] Preserve backward compatibility for catalog-backed manual service creation by treating an omitted `serviceKind` as `CATALOG`.
- [ ] Validate status-specific completion/billed dates without requiring a date when the status is Open.
- [ ] Reject unknown keys, tenant IDs, source/kind overrides, relationship IDs outside the target union, negative/blank amounts, invalid currency, and invalid date-only values.
- [ ] Test normalized idempotency payloads so omitted/null optional fields compare consistently.

### Task 2: Add the schema migration and database invariants

**Files:**

- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260901120000_manual_deadline_billing_entries/migration.sql`
- Modify: `__tests__/services/client-service-schema.test.ts`
- Modify: `__tests__/services/deadline-engine-schema.test.ts`
- Modify: `__tests__/services/billing-tracking-schema.test.ts`
- Create: `__tests__/integration/manual-entry-migration.postgres.test.ts`

- [ ] Add `ClientServiceKind`, nullable catalog relation, and `MANUAL_ONLY` billing disposition.
- [ ] Add independent deadline and billing occurrence origins, nullable generator relations, manual entry keys, deadline title, and billing description snapshot.
- [ ] Backfill existing Client Services and occurrences before adding non-null defaults or constraints.
- [ ] Backfill scheduled billing descriptions from their fee lines without changing amounts, dates, statuses, overrides, or identity keys.
- [ ] Add source/kind/reference, deadline-origin, billing-origin, and billing-disposition check constraints.
- [ ] Retain scheduled uniqueness and add tenant-scoped manual-key uniqueness.
- [ ] Verify the migration on representative agreement, manual catalog, deadline cycle, scheduled billing, override, Billed, Waived, and Cancelled rows.

### Task 3: Make projections and lifecycle operations relation-optional

**Files:**

- Modify: `src/services/client-service/mapper.ts`
- Modify: `src/services/client-service/service.ts`
- Modify: `src/services/service-roster/service.ts`
- Modify: `src/services/service-roster/types.ts`
- Modify: `src/services/deadline/service.ts`
- Modify: `src/services/billing/service.ts`
- Modify: `src/services/client-service/fee-summary.ts`
- Modify: backup, restore, cleanup, and permanent Client Service deletion code that assumes a catalog variant or fee line
- Modify: associated service and integration tests

- [ ] Derive display family/name from Client Service snapshots when the catalog relation is null.
- [ ] Replace mandatory nested `serviceVariant` predicates with an origin-aware integrity predicate that still enforces tenant ownership.
- [ ] Return `serviceKind`, nullable variant details, manual origins, manual deadline title, and billing description in DTOs.
- [ ] Keep family filtering deterministic: normal family IDs match catalog services; an explicit `AD_HOC` filter token matches non-catalog services. Do not invent a UUID for the pseudo-family.
- [ ] Update search, sorting, exports, backup/restore, tenant cleanup, archive, and permanent-delete behavior for ad-hoc/manual rows.
- [ ] Make service archive cancel eligible future Open manual rows without deleting them, and include manual deadline/billing impact counts in confirmation and audit data.
- [ ] Keep permanent deletion exhaustive: deletion counts and confirmation copy include both scheduled and manual occurrence rows.
- [ ] Show a neutral fallback color for the Ad hoc pseudo-family.

### Task 4: Build atomic ad-hoc Client Service creation

**Files:**

- Create: `src/services/client-service/ad-hoc.ts`
- Modify: `src/services/client-service/index.ts`
- Modify: `src/services/client-service/manual-create.ts`
- Modify: `src/app/api/companies/[id]/services/route.ts`
- Create: `__tests__/services/client-service-ad-hoc.test.ts`
- Modify: `__tests__/api/manual-client-services-routes.test.ts`
- Modify: `__tests__/integration/client-service-manual-creation.postgres.test.ts`

- [ ] Implement a transaction-aware helper that can be called by the service route or either manual occurrence service without nesting transactions.
- [ ] Use server-owned `source=MANUAL`, `serviceKind=AD_HOC`, `familyName=Ad hoc`, `serviceCadence=AD_HOC`, null agreement/catalog references, and normalized status/start date.
- [ ] For direct Services-page creation, require the user to choose `MANUAL_ONLY` or `NOT_REQUIRED`; retain the existing reason requirement for Not required.
- [ ] Warn about likely duplicate ad-hoc services using Company + normalized service name + exact start date, while preserving the existing catalog duplicate rule.
- [ ] Keep duplicate override, audit, serializable concurrency, and rollback behavior aligned with existing manual catalog service creation.

### Task 5: Add company-scoped service options

**Files:**

- Create: `src/services/client-service/options.ts`
- Modify: `src/services/client-service/index.ts`
- Create: `src/app/api/companies/[id]/services/options/route.ts`
- Modify: `src/hooks/use-client-services.ts`
- Create: `__tests__/services/client-service-options.test.ts`
- Create: `__tests__/api/client-service-options-route.test.ts`
- Modify: `__tests__/hooks/use-client-services.test.ts`

- [ ] Implement paginated, search-as-you-type minimal options with tenant and Company constraints in SQL.
- [ ] Include active, paused, and ended non-archived services, ordered by operational status then name.
- [ ] Require Company update permission and return non-revealing not-found behavior.
- [ ] Do not return fee lines, field values, agreement contents, deadline configuration, notes, or occurrences.

### Task 6: Implement one-off manual deadline creation

**Files:**

- Create: `src/services/deadline/manual-entry.ts`
- Modify: `src/services/deadline/index.ts`
- Modify: `src/services/deadline/service.ts`
- Modify: `src/app/api/deadlines/route.ts`
- Modify: `src/hooks/use-deadlines.ts`
- Create: `__tests__/services/manual-deadline-entry.test.ts`
- Modify: `__tests__/api/deadline-routes.test.ts`
- Modify: `__tests__/hooks/use-deadlines.test.ts`

- [ ] Implement idempotent create for existing and new ad-hoc targets in one serializable transaction.
- [ ] Persist authored due date as both base/calculated and operative date, and preserve existing completion timestamp semantics.
- [ ] Write a redacted occurrence audit with actor, Company, Client Service, type, status, and request key; exclude notes.
- [ ] Update list, calendar, origin filter, event labels, integrity checks, updates, reset override, and bulk actions for nullable cycle/rule relations.
- [ ] Keep the existing manual historical cycle code and `MANUAL_TRIGGER` semantics unchanged.
- [ ] Require `deadlineWritesEnabled`; observe-only workspaces must not accept direct manual writes.

### Task 7: Implement one-off manual billing creation

**Files:**

- Create: `src/services/billing/manual-entry.ts`
- Modify: `src/services/billing/index.ts`
- Modify: `src/services/billing/service.ts`
- Modify: `src/services/billing/reconciler.ts`
- Modify: `src/services/billing/coverage.ts`
- Modify: `src/app/api/billing-occurrences/route.ts`
- Modify: `src/hooks/use-billing-occurrences.ts`
- Create: `__tests__/services/manual-billing-entry.test.ts`
- Modify: `__tests__/services/billing-reconciler.test.ts`
- Modify: `__tests__/services/billing-coverage.test.ts`
- Modify: `__tests__/api/billing-occurrence-routes.test.ts`
- Modify: `__tests__/hooks/use-billing-occurrences.test.ts`

- [ ] Implement idempotent create for existing and new ad-hoc targets in one serializable transaction.
- [ ] Persist authored date/amount/currency as both base and operative values with no override flags.
- [ ] Apply Billed actor/timestamp fields at creation when initial status is Billed.
- [ ] Transition `NOT_REQUIRED`/`UNREVIEWED` targets to `MANUAL_ONLY`; leave `CONFIGURED` and `MANUAL_ONLY` targets unchanged.
- [ ] Disable `THIS_AND_FUTURE` and schedule-reset assumptions for manual rows while retaining normal single-occurrence editing.
- [ ] Make every reconcile, cancellation, propagation, and gap query explicitly scheduled-only. Add regression tests proving manual rows survive service reconciliation unchanged.

### Task 8: Build shared target and create-dialog UI

**Files:**

- Create: `src/components/services/manual-entry/manual-entry-target-fields.tsx`
- Create: `src/components/services/manual-entry/manual-deadline-dialog.tsx`
- Create: `src/components/services/manual-entry/manual-billing-dialog.tsx`
- Create: `src/components/services/manual-entry/manual-entry-success.tsx`
- Create: `__tests__/components/manual-entry-target-fields.test.tsx`
- Create: `__tests__/components/manual-deadline-dialog.test.tsx`
- Create: `__tests__/components/manual-billing-dialog.test.tsx`

- [ ] Reuse `AsyncSearchSelect`, shared Company options, `Modal`, `Button`, `Alert`, `ConfirmDialog`, and date/input controls.
- [ ] Support a locked existing-service target for the selected service modal and the full target chooser for workspace pages.
- [ ] Preserve form values and `requestId` after API errors; prevent duplicate submit while pending.
- [ ] Confirm dirty close, Company switch, and target-mode switch before discarding entered values.
- [ ] Provide field-addressable accessible errors, initial focus, Escape handling, focus restoration, compact desktop sizing, and 44px mobile targets per the design guideline.
- [ ] Do not nest a second full Add Service modal inside either entry dialog; render only the minimal ad-hoc fields inline.

### Task 9: Add workspace entry points and source presentation

**Files:**

- Modify: `src/components/services/deadlines/deadline-workspace.tsx`
- Modify: `src/components/services/deadlines/deadline-filters.tsx`
- Modify: `src/components/services/deadlines/deadline-table.tsx`
- Modify: `src/components/services/deadlines/deadline-calendar.tsx`
- Modify: `src/components/services/deadlines/deadline-event.tsx`
- Modify: `src/components/services/billing/billing-workspace.tsx`
- Modify: `src/components/services/billing/billing-filters.tsx`
- Modify: `src/components/services/billing/billing-table.tsx`
- Modify: `src/components/services/billing/billing-occurrence-dialog.tsx`
- Modify: existing workspace component and browser tests

- [ ] Add permission/feature-gated primary actions near page controls and in true empty states only.
- [ ] Add Manual Entry to the deadline origin filter and an equivalent billing origin filter.
- [ ] Parse, serialize, authorize, and apply the exact `clientServiceId` URL filter in both workspaces.
- [ ] Use authored deadline titles and billing description snapshots for display/search instead of technical generation keys or required fee-line joins.
- [ ] Label Automated, Triggered cycle, and Manual sources consistently without relying on color alone.
- [ ] After success, invalidate deadlines/billing, service roster, coverage where applicable, and the target Client Service query.
- [ ] Keep URL filters, column preferences, selection state, and pagination stable.

### Task 10: Add selected-service and Services-page flows

**Files:**

- Modify: `src/components/companies/company-detail/client-service-editor.tsx`
- Modify: `src/components/companies/company-detail/operational-service-form.tsx`
- Modify: `src/components/companies/company-detail/client-service-creator.tsx`
- Modify: `src/components/companies/company-detail/client-service-form-state.ts`
- Modify: `src/components/companies/company-detail/company-services-tab.tsx`
- Modify: `src/components/services/roster/add-client-service-dialog.tsx`
- Modify: `src/components/services/roster/service-roster.tsx`
- Modify: `__tests__/components/client-service-editor.test.tsx`
- Modify: `__tests__/components/client-service-creator.test.tsx`
- Modify: `__tests__/components/operational-service-form.test.tsx`
- Modify: `__tests__/components/service-roster.test.tsx`

- [ ] Add manual-entry action slots to Deadline and Billing panels without coupling create-dialog state to the reusable operational form body.
- [ ] Detect unsaved service name/form changes and disable occurrence creation until changes are saved or discarded.
- [ ] Refetch and display Open manual occurrences beside scheduled/generated occurrences after creation, with a visible Manual badge.
- [ ] Add View all deadlines and View all billing links that deep-link to the corresponding workspace with the Client Service filter applied and history available.
- [ ] Add an Ad hoc mode to the shared Add Service flow, while preserving the current catalog-backed default and duplicate handling.
- [ ] Show `Ad hoc` and `Added manually` metadata in Company Services and the tenant roster; never show a missing agreement/catalog link as an error.
- [ ] Extend the billing disposition UI with **Manual billing only**, and ensure switching away from Configured archives schedules through the existing confirmation behavior without touching manual occurrences.

### Task 11: Verify isolation, atomicity, reconciliation safety, and UI behavior

**Files:**

- Create: `__tests__/integration/manual-entry-integrity.postgres.test.ts`
- Modify: `__tests__/integration/deadline-tenant-isolation.postgres.test.ts`
- Modify: `__tests__/integration/billing-tenant-isolation.postgres.test.ts`
- Modify: `__tests__/integration/manual-deadline-no-billing.postgres.test.ts`
- Create: `__tests__/browser/manual-deadline-billing-entry.browser.test.tsx`

- [ ] Prove cross-tenant and inaccessible Company/service IDs are never exposed or mutated.
- [ ] Prove an occurrence failure or audit failure rolls back a newly created ad-hoc Client Service.
- [ ] Prove identical request replay creates one service, one occurrence, and one set of audit events; conflicting reuse is rejected.
- [ ] Prove concurrent identical submissions converge on one result under PostgreSQL.
- [ ] Prove deadline reconciliation never adopts, recalculates, or cancels `MANUAL_ENTRY` deadlines.
- [ ] Prove billing reconciliation, fee-line archival, coverage repair, and This-and-future propagation never mutate manual billing rows.
- [ ] Prove scheduled occurrence behavior and historical manual cycle behavior remain unchanged.
- [ ] Prove service archive cancels but does not delete eligible future Open manual items, preserves protected/history rows, reports impact counts, and does not reopen manual rows later.
- [ ] Prove permanent service deletion removes all scheduled and manual occurrence history and reports the combined deletion counts.
- [ ] Browser-test page entry, preselected service entry, inline ad-hoc creation, permission gating, mobile layout, dirty close, retry retention, success refresh, source badges, and keyboard/focus behavior.

### Task 12: Update operational documentation and run the verification matrix

**Files:**

- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/guides/SERVICE_PATTERNS.md`
- Modify: `docs/guides/DESIGN_GUIDELINE.md`
- Modify: `docs/reference/DATABASE_SCHEMA.md`
- Modify: `docs/reference/API_REFERENCE.md`
- Modify: `docs/README.md`

- [ ] Document catalog versus ad-hoc Client Services, database constraints, manual occurrence origins, idempotency, permission boundaries, and reconciliation exclusions.
- [ ] Document that billing remains tracking-only and that manual billing does not issue invoices or create accounting entries.
- [ ] Document the difference between Add deadline, Trigger cycle, Add billing item, and configured recurring schedules.
- [ ] Refresh generated Prisma artifacts.
- [ ] Run focused validation, service, route, hook, component, integration, and browser tests from Tasks 1–11.
- [ ] Run `npm.cmd run lint`, `npx.cmd tsc --noEmit`, `npm.cmd run build`, and `git diff --check`.
- [ ] Apply the migration to a clean database and a representative upgraded database; inspect constraints, backfills, query plans, and reconciliation metrics.

## Acceptance Criteria

- An authorized user can add a manual deadline from the Deadlines page or selected service modal.
- An authorized user can add a manual billing item from the Billing page or selected service modal.
- Every manual item is linked to exactly one tenant-scoped Company and one Client Service.
- The page-level dialogs can select an existing service or atomically create a named ad-hoc service.
- A created ad-hoc service appears in Company Services and the tenant Services roster, but not in the global Service Catalog.
- View Service shows Open manual deadlines and billing items alongside generated/scheduled items, and provides filtered links to complete occurrence history.
- Ad-hoc service creation never invents an agreement, catalog variant, SOW partial, rule, cycle, or recurring fee schedule.
- Manual deadlines are visibly different from rule-generated deadlines and manually triggered historical cycles.
- Manual billing is visibly different from scheduled billing and never implies an Oakcloud invoice or payment.
- A failed create leaves no orphan service, occurrence, audit event, disposition change, or reconciliation request.
- Request retries are idempotent and conflicting idempotency-key reuse is rejected.
- Rule and billing reconciliation never recalculate, duplicate, cancel, or adopt a manual occurrence.
- Archiving a Client Service cancels eligible future Open manual items without deleting their history; permanent deletion removes all linked manual and scheduled history only after explicit destructive confirmation.
- Manual billing does not falsely satisfy scheduled billing coverage; `MANUAL_ONLY` is treated as an intentionally resolved no-schedule state.
- Existing service filters, pagination, table preferences, lifecycle edits, overrides, bulk actions, backup/restore, cleanup, archive, permanent delete, agreement activation, and scheduled reconciliation continue to work.
- Tenant isolation and Company-scoped permissions are enforced in SQL and service-layer target validation.
- Desktop, tablet, mobile, keyboard, focus, loading, empty, error, dirty-close, and success states pass automated coverage.

## Out Of Scope

- Recurring rules or schedules authored from the quick-add dialogs.
- Bulk import of manual deadlines or billing items.
- Invoice generation, payment collection, accounting-ledger posting, or external accounting synchronization.
- Converting an ad-hoc Client Service into a catalog-backed service or merging it with a later agreement-created service.
- Adding ad-hoc services to the tenant-wide Service Catalog automatically.
- Automatically moving existing occurrences between Client Services.
- Hard-deleting an individual occurrence from these dialogs.
