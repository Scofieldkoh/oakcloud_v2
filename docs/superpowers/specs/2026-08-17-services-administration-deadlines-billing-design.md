# Services Administration, Deadline Monitoring, and Billing Tracking

**Status:** Approved

**Date:** 2026-08-17

**Audience:** Product, design, engineering, QA, and a future AI implementation session

**Repository:** Oakcloud

## 1. Purpose and source of truth

This document is the master product and technical design for moving service
administration out of Document Generation and introducing an operational
Services workspace for cross-company service, deadline, and billing tracking.
It is intentionally self-contained so that another engineer or AI session can
continue without access to the preceding design conversation.

The approved mockups are indexed in
[Services Workspace Mockup Reference](../mockups/2026-08-17-services-workspace-mockups.md).
The saved visual companion gallery is:

```text
.superpowers/brainstorm/1582-1786930476/content/services-complete-view-gallery-v2.html
```

The mockup index and this specification are complementary. This specification
controls behavior, data, permissions, and edge cases. The mockups control the
approved visual composition and filter placement. If the implementation needs
to depart from either, the design must be amended before implementation.

No unresolved product decision is intentionally left as a placeholder in this
document.

## 2. Executive summary

Oakcloud will gain two related surfaces:

1. An operational `/services` workspace with **Services**, **Deadlines**, and
   **Billing** tabs.
2. An Administration → Services page for catalog families and variants,
   deadline rules, applicability, family colors, and business calendars.

The existing service catalog remains the canonical definition of what the firm
offers. `ClientService` remains the canonical record of a service provided to a
company. New rule, cycle, deadline-occurrence, billing-occurrence, business-day,
and reconciliation records extend those models rather than replacing them.

Deadline rules use a constrained, versioned date-expression system. They can
use Company dates such as FYE, AGM, and Annual Return; apply entity-structure
conditions such as XBRL not applying to an exempt private company; create
multiple Statutory, Client, and Internal milestones; and use tenant-managed
holidays and business-day adjustment.

Repeatable schedule entries are a generic capability available to every service
family and variant. Payroll is only one example. Any rule can define multiple
anchors such as the 15th, last business day, second-last business day, or a date
relative to another source or milestone. Entries can be added, removed, and
reordered while retaining stable identities.

Deadline and billing occurrences are materialized through an idempotent rolling
12-month reconciliation process. Billing is tracking only: Oakcloud does not
issue invoices or collect payment.

## 3. Current repository baseline

The design assumes the following existing implementation:

- Next.js 15, React 19, TypeScript, Prisma 7, and PostgreSQL.
- React Query for server state, Zod for validation, Vitest for unit/integration
  tests, and Playwright for browser tests.
- `date-fns` and `react-day-picker` are installed; there is no existing
  full-featured calendar dependency that must be adopted.
- A database-backed scheduler and claim/lease patterns already exist under
  `src/lib/scheduler` and in activation/ACRA workflows.
- `ServiceFamily`, `ServiceVariant`, `ServiceVariantFeeTemplate`,
  `ClientService`, and `ClientServiceFeeLine` already exist.
- The service catalog is currently exposed as a Services tab inside
  `src/app/(dashboard)/template-partials/page.tsx`, with components under
  `src/components/documents/service-catalog/`.
- Company-specific client services are managed through
  `src/components/companies/company-detail/company-services-tab.tsx` and the
  existing company/client-service APIs.
- `Company` already contains entity type, FYE, next AGM due date, next Annual
  Return due date, and accounts due date fields.
- `UserPreference` already provides generic per-user JSON preferences.
- Company list/table patterns already provide inline filters, alternating rows,
  active filter chips, column resizing, user preferences, pagination, and
  responsive mobile cards. New tables must reuse those patterns.

Relevant existing design and behavior references include:

- `docs/guides/DESIGN_GUIDELINE.md`
- `docs/guides/SERVICE_PATTERNS.md`
- `docs/guides/RBAC_GUIDELINE.md`
- `docs/superpowers/specs/2026-08-03-manual-client-service-creation-design.md`
- `docs/superpowers/specs/2026-08-03-companies-page-simplification-design.md`

## 4. Terminology

| Term | Meaning |
| --- | --- |
| Service family | A catalog grouping such as Corporate Secretarial, Tax, Accounting, or Payroll. |
| Service variant | A specific catalog service offered within a family. |
| Client service | A `ServiceVariant` provided to a specific Company, either from an agreement or added manually. |
| Deadline rule | Stable catalog-level identity for a configured schedule and its milestones. |
| Rule version | Immutable published configuration of a deadline rule. |
| Rule parameter | A typed value supplied by the client service when the Company record does not provide it. |
| Schedule entry | A stable, repeatable anchor definition usable by any service rule or fee schedule. |
| Service cycle | One evaluated service period, such as a month, quarter, financial year, or manually selected historical period. |
| Milestone | A configured Statutory, Client, or Internal due-date definition within a rule. |
| Deadline occurrence | A materialized milestone for a client service and cycle. |
| Billing occurrence | A materialized expected billing-tracking item for a fee line and billing period. |
| Operative value | The value displayed and acted on after applying an individual override to a calculated value. |
| Reconciliation | Idempotent recalculation that creates, updates, preserves, or cancels eligible future occurrences. |
| Historical | An occurrence whose operative due date is before the current Singapore date. |
| Future | An occurrence whose operative due date is on or after the current Singapore date. |

## 5. Goals

The release must:

1. Move service catalog/rule administration out of Document Generation.
2. Provide a cross-company roster of all client services.
3. Provide consistent table and calendar views of deadline occurrences.
4. Let users independently toggle Statutory, Client, and Internal deadlines.
5. Support configurable, versioned rules whose edits affect eligible future
   deadlines after an explicit impact preview.
6. Support Company dates, FYE-derived dates, company-structure applicability,
   user parameters, repeatable anchors, and business-day rules.
7. Permit manual historical cycle triggering for inherited, partially completed,
   or long-outstanding work.
8. Track expected billing and manual billed status without performing billing.
9. Identify active services whose billing disposition or schedule is incomplete.
10. Preserve auditability, tenant isolation, idempotency, and historical records.
11. Persist calendar and table preferences per user.

## 6. Explicit non-goals

The initial release does not include:

- Invoice creation, payment collection, or accounting-ledger integration.
- A representation that configured statutory rules constitute legal advice.
- Arbitrary user-authored code, SQL, or general-purpose formulas.
- An automatically maintained multi-jurisdiction statutory-rule library.
- Email, SMS, push, or in-app reminder campaigns.
- External Google, Outlook, or iCalendar synchronization.
- Workflow task generation from deadlines.
- Unlimited automatic historical backfill.
- Bulk deadline editing or bulk client-service creation.
- Automatic billing occurrences from manually triggered historical cycles.

## 7. Information architecture and navigation

### 7.1 Operational workspace

Add **Services** as a primary navigation destination at `/services`.

The page contains three URL-addressable tabs:

- `/services?tab=services`
- `/services?tab=deadlines`
- `/services?tab=billing`

The selected tab, deadline table/calendar mode, active filters, sorting, page,
calendar focus date, and visible date range are URL-addressable so a view can be
refreshed or shared. Personal presentation preferences remain in
`UserPreference`.

### 7.2 Administration

Add **Services** under the Administration navigation group. The page contains:

- Service catalog
- Deadline rules
- Business calendar

The old service-catalog tab under Document Generation is removed from normal
navigation. Requests to the old `template-partials` service-tab URL redirect to
Administration → Services. Statement-of-work and document-template concerns
remain under Document Generation.

### 7.3 Company detail

The Company detail Services tab remains available. It is the company-scoped
entry point for adding and configuring client services. It uses the same forms,
validations, and service-layer operations as the cross-company roster.

Company detail also exposes the optional company display alias.

## 8. Permissions and tenant isolation

### 8.1 Operational permissions

- `company:read` permits viewing services, deadlines, billing tracking, and
  calendar entries for companies the user may access.
- `company:update` permits adding, editing, pausing, ending, or archiving client
  services; triggering cycles; changing deadline state or overrides; and
  changing billing tracking.
- `CANCELLED` deadline and billing states are system-controlled.

No dedicated first-release services permission is introduced.

### 8.2 Administrative permissions

Service family, variant, color, rule, applicability, and business-calendar
administration is restricted to Tenant Admins and appropriately scoped Super
Admins. Super Admin operations use the selected workspace.

### 8.3 Isolation requirements

Every new operational table carries `tenantId`. Every database read and write:

1. Derives the workspace from the authenticated session.
2. Includes `tenantId` in the predicate.
3. Validates that referenced records belong to the same tenant.
4. Applies accessible-company predicates inside list queries.
5. Returns `404` rather than exposing another tenant's record.

Background jobs repeat the same relationship validation. APIs never trust a
client-supplied tenant ID or a client-computed access scope.

## 9. User experience specification

The implementation must follow `docs/guides/DESIGN_GUIDELINE.md` and approved
mockup views 1–7. Controls must have clear separation from page headings, data
surfaces, and pagination. The compact Oakcloud visual language must not result
in crowded toolbars or cards.

### 9.1 Company display alias

Add an optional `displayAlias` on Company detail. Company creation and BizFile
upload prompt for it, but it is not mandatory.

When absent, derive a display label from the first letter of every meaningful
word in the legal name:

1. Split on whitespace and punctuation.
2. Ignore conjunction symbols such as `&`.
3. Remove trailing legal-form tokens such as `Pte`, `Ltd`, `Limited`, `Private`,
   `LLP`, `LP`, `Inc`, `LLC`, `Corp`, and `Corporation`, case-insensitively.
4. Uppercase the first letter of each remaining word and concatenate them.
5. If no meaningful token remains, fall back to the first non-whitespace
   character of the full name.

Example: `Oaktree Accounting & Corporate Solution Pte. Ltd.` becomes `OACS`.
The full legal name remains available in tables, tooltips, popovers, and
accessible labels. Long aliases or derived labels may be visually truncated;
the stored alias is never silently rewritten.

### 9.2 Family colors

Tenant Admins configure one `#RRGGBB` display color per service family. The
color is used consistently for:

- Family filter chips and clickable legends
- Table row accents and family badges
- Calendar events
- Administration previews

Color is never the sole carrier of information. Text labels, icons, or patterns
must preserve meaning, and foreground contrast must meet the repository design
guideline.

### 9.3 Services roster — mockup view 1

The roster displays one row per client service across accessible companies.
Expected columns are:

- Company
- Service family
- Service
- Status
- Cadence
- Next deadline
- Billing disposition or next billing state
- Start and end dates
- Warning indicator
- Row actions

It reuses Company-table behaviors: server pagination, inline filters,
alternating rows, active filter badges, resizable columns, saved column
preferences, and responsive mobile cards.

The service-family filters sit immediately beside `Active`, `Paused`, and
`Ended`. Archived is an explicit filter and is not mixed into the default view.

Users with `company:update` may add a service, edit it, pause/resume it, end it,
archive it, permanently delete it with explicit destructive confirmation, or
open its deadline/billing configuration. Permanent deletion removes all related
deadline, billing, fee-line, cycle, coverage, and rule-configuration records in
one transaction while retaining a standalone audit record. No bulk actions are
in the first release.

### 9.4 Shared client-service form

The cross-company roster and Company detail use one reusable form supporting:

- Catalog family and variant selection
- Status, cadence, start date, and optional end date
- Existing catalog-defined field values
- Billing disposition: Configured, Not required, or Unreviewed
- Required explanation when billing is Not required
- Fee lines and generic fee schedule configuration
- Enabled deadline rules
- Rule parameters and Company-source provenance
- Generic repeatable schedule entries
- Applicability and missing-input feedback
- Impact preview before a schedule-affecting edit is committed

### 9.5 Generic repeatable schedule editor

The repeatable list is not payroll-specific. It is rendered from the rule's
configuration for any service family or variant. Users can add, remove, edit,
and reorder entries. Each entry has a stable key unaffected by reordering.

Supported entry expressions include:

- Fixed day of month
- Nth business day from period start
- Nth-last business day from period end, including second-last working day
- Relative to a Company date, cycle boundary, another schedule entry, or an
  earlier milestone
- Positive or negative calendar-day offsets
- Positive or negative business-day offsets
- Previous- or next-business-day adjustment

A client-service rule accepts at most 31 schedule entries. The UI explains the
limit before submission and prevents duplicate keys.

### 9.6 Deadline table — mockup view 2

The deadline table displays one row per deadline occurrence. Columns include:

- Operative due date
- Timing: Overdue, Due today, Within 1 month, Within 3 months, Within 6
  months, Within 12 months or Over 12 months (buckets do not overlap), or
  Takeover review
- Company
- Service family and service; a company obligation shows the service that
  files it, else the service whose monitoring keeps it
- Milestone (acronyms such as ECI and AGM in capitals)
- Deadline type
- Stored lifecycle state
- Cycle/period
- Rule or manual origin
- Row actions

The top toolbar places `Statutory`, `Client`, `Internal`, `Open only`, and
service-family controls together. There is no `Filter families` label. Family
legend items are clickable filters. The same filters apply to table and
calendar modes. The table header also has an inline filter for each column
(due date range, timing, company, family, service, milestone, type, status).

### 9.7 Deadline calendar — mockup view 3

The calendar uses the same occurrence query and filter model as the table.
Events show:

- Company alias or computed initials
- Service/milestone identity
- Family color
- Deadline type
- Timing or lifecycle state without relying on color alone

The event popover shows the full company name, full service and milestone,
calculated and operative dates, source rule, cycle, notes, and actions permitted
to the user.

When a day contains more events than can be displayed, render a `+N more`
control. Mobile uses one month and a readable day/agenda interaction instead of
compressing event text beyond usability.

Day cells are coloured by kind: working days keep the plain background,
weekends are light blue and holidays light orange (a holiday on a weekend shows
as a holiday). Holidays come from the workspace's active business calendars
(manual and synced public holidays) through `/api/deadlines/holidays`, which
deadline readers can call without calendar administration rights. A Show
holidays switch (on by default, saved per user) hides holiday colours and names.

Default visible month count:

- One month below the large desktop breakpoint
- Two months at or above the large desktop breakpoint

Users may choose one, two, or three visible months. The choice persists in
`UserPreference` and overrides the responsive default until reset.

### 9.8 Manual historical trigger

From a client service, the user selects a rule and historical period. The
preview evaluates the complete cycle and lets the user:

- Include or exclude milestones
- Adjust individual dates
- Mark selected milestones completed immediately
- Add contextual notes

Applying creates a `MANUAL_TRIGGER` cycle and its selected deadlines. It does
not create billing occurrences. Manual occurrences are never changed by later
rule, Company, or business-calendar reconciliation.

### 9.9 Billing — mockup view 4

The Billing tab shows one row per billing occurrence with:

- Expected billing date
- Company
- Service and fee-line description
- Billing period
- Stored status
- Derived Upcoming, Due, or Overdue timing when open
- Amount and currency
- Optional billed date
- Optional external reference and notes
- Row actions

The system tracks billing only. No wording may imply that Oakcloud issued an
invoice or received payment.

Changing amount or currency prompts for:

- This occurrence
- This and future matching open occurrences

The reconciliation section sits inside the Billing tab and is collapsed by
default. Missing-configuration cards appear only when issues exist. A healthy
state remains compact and does not render one success card per company or
service.

### 9.10 Administration — mockup views 5–7

Service catalog administration supports family/variant creation, edit,
activation/archive, family colors, and associations between variants and rule
templates.

Deadline-rule administration supports draft editing, parameter definitions,
generic schedules, milestones, applicability, version history, preview,
publish, and archive.

Business-calendar administration supports jurisdiction/time-zone identity,
weekend days, holiday dates, holiday names, activation, impact preview, and
audited change.

## 10. Domain model

The names below are the intended domain boundaries. The implementation plan may
refine database column names to match repository conventions but must preserve
the stated semantics and invariants.

### 10.1 Existing model additions

#### Company

- `displayAlias String?`, maximum 40 characters.
- Alias is tenant-owned data and audited when changed.

#### ServiceFamily

- `displayColor String`, validated as `#RRGGBB`.
- Existing tenants receive deterministic colors from an accessible palette.

#### ClientService

- `billingDisposition`: `CONFIGURED`, `NOT_REQUIRED`, or `UNREVIEWED`.
- `billingNotRequiredReason String?`, required only for `NOT_REQUIRED`.
- Existing status remains `ACTIVE`, `PAUSED`, or `ENDED`; soft deletion remains
  the archive mechanism. A separate permanent-delete action is available when
  the complete service and its operational history must be removed.

#### ClientServiceFeeLine

- `scheduleConfig Json?` containing a schema-versioned fee recurrence and its
  schedule entries.
- Existing `billingFrequency`, custom label, start date, amount, and currency
  remain for compatibility and display.

### 10.2 Rule definition models

#### DeadlineRule

Stable tenant-scoped identity:

- Code, name, description
- Active/archive fields
- Current published version reference
- Audit timestamps

#### DeadlineRuleVersion

Versioned rule configuration:

- Rule ID and version number
- State: `DRAFT` or `PUBLISHED`
- Schema version
- Recurrence definition
- Applicability definition
- Definition/configuration hash
- Draft revision for optimistic concurrency
- Published timestamp and actor

There is at most one mutable draft per rule. Published versions are immutable.
Editing a published rule creates or updates its draft. Publication creates a
new immutable version and advances the rule's current-version reference.

#### DeadlineRuleParameterDefinition

Version-owned typed inputs:

- Stable parameter key and label
- Type: date, integer, decimal, string, boolean, or supported enum
- Required flag
- Optional default
- Validation constraints and help text
- Display order

#### DeadlineMilestoneTemplate

Version-owned milestone rows:

- Stable milestone key
- Name and description
- Type: `STATUTORY`, `CLIENT`, or `INTERNAL`
- Generation mode: once per cycle or once per schedule entry
- Date expression
- Business-day adjustment
- Display order and active flag

Milestone dependencies form a directed acyclic graph. Circular references are
rejected at validation.

#### ServiceVariantDeadlineRule

Associates a stable rule with a service variant:

- Enabled-by-default flag
- Display order
- Optional variant-level parameter defaults
- Optional variant-level schedule defaults
- Association/archive metadata

The same rule identity may be associated with multiple variants without copying
published versions.

### 10.3 Client configuration

#### ClientServiceDeadlineRule

Configures an associated rule for one client service:

- Enabled flag
- Parameter values
- Generic repeatable schedule entries
- Per-value provenance: Company, catalog default, or client override
- Last evaluated published version
- Applicability state: `APPLICABLE`, `NOT_APPLICABLE`, or `MISSING_INPUT`
- Applicability/missing-input reason
- Configuration hash and optimistic update timestamp

An individual client service may disable a catalog-default rule or supply
client-specific parameters/schedule entries. It may not modify the immutable
published rule grammar.

### 10.4 Evaluated operational models

#### ServiceCycle

Represents one evaluated rule period:

- Tenant, company, client service, rule, and rule-version IDs
- Period key, start, and end
- Generation key identifying the activation/configuration lifecycle
- Recurrence anchor data
- Origin: `RULE` or `MANUAL_TRIGGER`
- Source snapshot and evaluation hash
- Created actor/time

The source snapshot includes resolved Company values, parameters, schedule
entries, calendar version, and anchor instances needed to explain the result.

#### DeadlineOccurrence

Materialized milestone:

- Tenant, company, client service, cycle, rule version, and milestone identity
- Optional schedule-entry key
- Deadline type
- Calculated due date
- Operative due date
- Explicit override flag, date, reason, actor, and time
- Stored status: `OPEN`, `COMPLETED`, `WAIVED`, or `CANCELLED`
- Completion/waiver/cancellation metadata
- Origin and audit timestamps

Unique identity is based on tenant, client service, rule, cycle period,
generation key, milestone key, schedule-entry key, and origin identity.
Reordering a schedule entry cannot duplicate its occurrence. Reactivating a
previously archived configuration uses a new generation key and preserves the
cancelled generation.

#### BusinessCalendar and BusinessHoliday

The calendar contains:

- Tenant, name, jurisdiction code, and IANA time zone
- Weekend-day configuration
- Active/archive metadata
- Calendar revision/version

Holidays contain calendar ID, date, name, optional description, and active
state. The first release defaults to a Singapore calendar and
`Asia/Singapore`, but the model does not hard-code Singapore as the only future
jurisdiction.

#### BillingOccurrence

Materialized expected billing record:

- Tenant, company, client service, and fee-line IDs
- Billing period key, optional schedule-entry key, and generation key
- Calculated and operative expected billing dates
- Stored status: `OPEN`, `BILLED`, `WAIVED`, or `CANCELLED`
- Base and operative amount/currency
- Date, amount, and currency override metadata
- Optional billed date
- Optional external reference and notes
- Cancellation and audit metadata

The unique identity is tenant, fee line, billing period, schedule-entry key, and
generation key. Reactivation therefore creates a new tracked generation without
reopening a cancelled billing occurrence.

#### ServiceScheduleReconciliationRequest

Durable work request:

- Tenant and scope type/ID
- Trigger type and correlation ID
- Deterministic deduplication key
- State: Pending, Processing, Completed, or Failed
- Attempt count, lease owner, and lease expiry
- Next retry time and last safe error
- Created, started, and completed times
- Summary counts

The request is inserted in the same transaction as the source configuration
change, providing outbox-like durability.

#### BillingCoverageIssue

Materialized unresolved billing configuration problem:

- Tenant, company, client service, and optional fee-line ID
- Issue type and severity
- Deterministic issue key
- First/last detected timestamps
- Resolution timestamp
- Safe structured details

Issue types include:

- Missing billing disposition
- Missing fee lines
- Missing billing start date
- Invalid or incomplete custom schedule
- Missing required schedule parameters
- Expected rolling-horizon occurrence gap
- Invalid amount or currency

### 10.5 Core invariants

1. Published rule versions and their milestones/parameters are immutable.
2. A future rule-generated occurrence may be recalculated only while it is open
   and not individually overridden.
3. Historical, completed, waived, cancelled, manual, and overridden occurrences
   are preserved during normal lifecycle changes and reconciliation. Explicit
   permanent deletion of their client service is the audited exception.
4. An override changes the operative value, not the calculated value.
5. A removed milestone with an overridden future occurrence is preserved and
   flagged for review rather than silently cancelled.
6. Manual deadline cycles never generate billing occurrences.
7. Archiving a client service or rule preserves history, cancels eligible future
   open occurrences, and prevents new generation.
8. Reconciliation is idempotent and safe to retry.
9. Every active client service explicitly becomes Configured or Not required;
   Unreviewed remains an actionable coverage issue.
10. Derived timing status is not persisted as mutable state.

## 11. Rule and schedule language

### 11.1 Design constraints

The rule language is a validated JSON/relational domain-specific language, not
an arbitrary expression interpreter. Every definition includes a schema version
so migrations can upgrade old definitions deliberately.

### 11.2 Recurrence

Supported cycle recurrence includes:

- Monthly
- Quarterly
- Semi-annually
- Annually
- One-time
- A validated custom interval represented by structured fields, not source code

Cycle periods produce deterministic period keys. Date-only calculations use the
Singapore business date and do not depend on a browser's time zone.

### 11.3 Allowed date sources

Whitelisted sources include:

- Company FYE
- Company next AGM due date
- Company next Annual Return due date
- Company accounts due date
- Company incorporation/registration date when present
- Cycle start and end
- Fixed typed rule parameter
- A generic schedule entry
- An earlier milestone in the same acyclic rule graph

For AGM, Annual Return, accounts, or another directly represented Company due
date, the stored Company date is authoritative. A rule formula is a fallback
only when the Company value is absent and the published rule explicitly permits
the fallback.

### 11.4 Schedule entry contract

Conceptual API shape:

```ts
type ScheduleEntry = {
  key: string;
  label: string;
  expression:
    | { kind: 'DAY_OF_MONTH'; day: number }
    | { kind: 'BUSINESS_DAY_FROM_START'; ordinal: number }
    | { kind: 'BUSINESS_DAY_FROM_END'; ordinal: number }
    | {
        kind: 'RELATIVE_TO_SOURCE';
        source: string;
        offset: number;
        unit: 'CALENDAR_DAY' | 'BUSINESS_DAY';
      };
  businessDayAdjustment: 'NONE' | 'PREVIOUS' | 'NEXT';
};
```

`BUSINESS_DAY_FROM_END` with `ordinal: 2` means the second-last working day.
Month-day values clamp to the final calendar day when the requested day does not
exist. Schedule-entry keys must be unique within the client-rule configuration.

The same expression primitives are reused by fee-line billing schedules, but
deadline and billing occurrence generation remain independent.

### 11.5 Applicability

Applicability uses whitelisted Company fields and typed predicates such as:

- Equals / does not equal
- In / not in a configured enum set
- Boolean true/false
- Field present/missing
- Numeric or date comparison when the field type permits it
- All/any nested groups with bounded depth

Example: an XBRL rule can be not applicable when
`Company.entityType == EXEMPTED_PRIVATE_LIMITED`.

If a predicate is definitively false, the client rule is `NOT_APPLICABLE`. If a
required source is missing and no valid fallback exists, it is `MISSING_INPUT`.
Neither state generates new occurrences.

### 11.6 Business-day handling

A business day excludes configured weekend days and active holidays from the
selected tenant calendar. Expressions may count business days or adjust a final
calendar date to the previous or next business day.

Business-calendar changes require impact preview because they may affect many
future deadlines and billing dates.

### 11.7 Evaluation order

For each client-service rule and period:

1. Load the current published rule version and association defaults.
2. Resolve tenant calendar and current Singapore date.
3. Load Company source fields and client parameters with provenance.
4. Evaluate applicability.
5. Validate required inputs and schedule-entry count/identity.
6. Resolve cycle boundaries and schedule anchor instances.
7. Topologically evaluate milestone expressions.
8. Apply business-day operations and month-end clamping.
9. Compare proposed occurrences with materialized records.
10. Create, recalculate, preserve, cancel, or flag each occurrence according to
    the invariants.

Calculation returns structured explanations so previews, audits, and UI
popovers can show why a date exists.

## 12. Recalculation and reconciliation

### 12.1 Rolling horizon

Automatic generation materializes occurrences from the current Singapore date
through 12 months ahead. A daily maintenance job extends the horizon. It does
not automatically fabricate deadlines before activation.

An occurrence created while future may later become overdue; overdue is derived
from its open state and operative due date.

### 12.2 Eligible updates

Rule, Company, calendar, and client configuration changes affect only
rule-generated occurrences whose operative due date is on or after today and
whose stored state is open.

They preserve:

- Occurrences already in the past
- Completed, waived, or cancelled occurrences
- Manual-trigger occurrences
- Individually overridden occurrences

For an override, the engine refreshes the hidden calculated date for explanation
while leaving the operative date unchanged.

### 12.3 Rule publication

Publication is always preview then apply:

1. The preview runs the production evaluator without writing occurrences.
2. Results are grouped into Created, Recalculated, Cancelled, Preserved,
   Inapplicable, Missing input, Conflict, and Warning.
3. Apply includes expected current version, draft hash, and preview fingerprint.
4. The server recalculates inside the publish workflow.
5. If the result differs, return `409 IMPACT_CHANGED` and require a new preview.
6. If it matches, publish the immutable version and insert deduplicated
   reconciliation requests transactionally.

Rule archive and business-calendar update use the same preview discipline.

### 12.4 Company and service changes

Changes to relevant Company fields—including BizFile/ACRA updates—enqueue
company-scoped reconciliation. The service layer detects whether a field is
referenced by an active rule to avoid unnecessary work.

Activation or configuration of a client service evaluates its rules and creates
eligible future occurrences. Missing inputs create visible warnings rather than
partially guessed dates.

Pausing preserves existing occurrences but suspends rolling-horizon extension.
Ending stops generation after the end date. Archiving cancels future open
deadline and billing occurrences and preserves all history.

### 12.5 Worker behavior

Workers claim reconciliation requests through database leases. Processing uses
deterministic occurrence identities and may be retried safely. Transient errors
use bounded exponential backoff. Invalid configuration or missing input becomes
an actionable issue and does not retry forever.

Per-client-service work is transactional so one invalid service cannot roll
back a tenant-wide request. A request is complete only after occurrence and
billing-coverage reconciliation succeeds for its scope.

## 13. Lifecycle rules

### 13.1 Deadline states

Stored states:

- `OPEN`
- `COMPLETED`
- `WAIVED`
- `CANCELLED`

Derived presentation states:

- `UPCOMING`: open and operative due date is after today
- `DUE`: open and operative due date is today
- `OVERDUE`: open and operative due date is before today

Allowed user transitions are Open → Completed, Open → Waived, and reopening a
Completed/Waived occurrence to Open with an audit reason. Only the system
cancels. Cancelled is terminal. Restoring an archived source configuration
creates a new cycle generation and eligible new occurrences; it never reopens
the cancelled generation.

### 13.2 Billing states

Stored states:

- `OPEN`
- `BILLED`
- `WAIVED`
- `CANCELLED`

Users may mark Open as Billed or Waived and may reopen Billed/Waived with an
audit reason. Billed date is optional. Amount and currency remain editable after
Billed, with a complete audit trail.

`BILLED` means a user recorded external billing; it does not assert an Oakcloud
invoice exists.

Open billing occurrences also have derived presentation timing:

- `UPCOMING` when the operative expected billing date is after today
- `DUE` when it is today
- `OVERDUE` when it is before today

This timing value is calculated and is not stored as an independently mutable
state.

### 13.3 Current-and-future billing edits

When a user changes amount or currency, the system asks:

- `THIS_OCCURRENCE`
- `THIS_AND_FUTURE`

The second option updates the selected occurrence and matching future open
occurrences for the same fee line/schedule identity. It does not change billed,
waived, cancelled, historical, or unrelated fee-line occurrences.

## 14. Billing coverage reconciliation

Every active client service must explicitly be:

- `CONFIGURED`, with valid fee lines and schedules; or
- `NOT_REQUIRED`, with a reason.

`UNREVIEWED` is the safe migration default and creates an issue.

Coverage reconciliation checks:

1. Billing disposition exists and is internally consistent.
2. Configured services have at least one active fee line.
3. Required start dates and schedule parameters exist.
4. Custom/repeatable schedule definitions are valid.
5. Amount and ISO currency values are valid.
6. Expected billing occurrences exist throughout the rolling horizon.

Paused services retain their existing issues but do not generate new rolling
occurrences until resumed. Ended/archived services remain visible if unresolved
open billing occurrences exist, but they do not receive new future coverage
requirements.

The Billing tab returns a compact healthy summary and only materializes issue
cards when gaps exist.

## 15. API contract

All dates are `YYYY-MM-DD`. Monetary amounts are decimal strings. Mutation
requests use Zod validation and optimistic concurrency.

### 15.1 Existing routes retained and extended

- `GET/POST /api/companies/:companyId/services`
- `GET /api/companies/:companyId/services/catalog-options`
- `GET/PATCH/DELETE /api/client-services/:id`
- Existing `/api/service-catalog/*` routes

Company-specific POST remains the canonical client-service creation route.
Schedule-affecting mutations insert reconciliation requests in their database
transaction. `DELETE` without a mode continues to mean audited soft archive;
`deletionMode: PERMANENT` requires `expectedUpdatedAt` and a reason, then deletes
the service and all of its deadline/billing dependencies transactionally.

### 15.2 Cross-company roster

`GET /api/client-services` supports search, company, family, variant, service
state, archive state, billing disposition, rule warning, sorting, page, and page
size.

The database query includes the accessible-company scope; results are never
loaded tenant-wide and filtered in application memory.

### 15.3 Deadlines

- `GET /api/deadlines`
- `GET /api/deadlines/:id`
- `PATCH /api/deadlines/:id`
- `POST /api/deadlines/:id/reset-date-override`
- `POST /api/client-services/:id/deadline-cycles/preview`
- `POST /api/client-services/:id/deadline-cycles`

Deadline list filters include date range, type, family, company, stored/derived
state, open-only, and origin. Table mode uses server pagination. Calendar mode
requires a bounded visible range.

Deadline PATCH supports lifecycle changes, operative date override, completion
date, optional notes, reason, and `expectedUpdatedAt`.

Manual preview does not write. Apply includes the selected rule version, period,
source/parameter values, schedule entries, included/excluded milestones,
individual adjustments, completion choices, and preview fingerprint.

### 15.4 Billing

- `GET /api/billing-occurrences`
- `GET/PATCH /api/billing-occurrences/:id`
- `POST /api/billing-occurrences/:id/reset-override`
- `GET /api/billing-coverage`
- `POST /api/client-services/:id/billing/reconcile`

Billing PATCH supports lifecycle state, billed date, amount, currency, external
reference, notes, reason, update scope, and `expectedUpdatedAt`.

### 15.5 Administration

- Existing service-family and variant catalog routes, with mutation authorization
  changed to Tenant Admin/Super Admin
- `/api/service-catalog/deadline-rules`
- `/api/service-catalog/deadline-rules/:id`
- `/api/service-catalog/deadline-rules/:id/impact`
- `/api/service-catalog/deadline-rules/:id/publish`
- `/api/service-catalog/deadline-rules/:id/archive`
- `/api/service-calendars`
- `/api/service-calendars/:id`
- `/api/service-calendars/:id/impact`
- `/api/deadlines/holidays` (read-only holidays and weekend days for a range)

Publish/archive requests never trust client impact totals. The server rechecks
current version, definition hash, preview fingerprint, and authorization.

### 15.6 Structured errors

Required error codes:

- `VALIDATION_ERROR`
- `FORBIDDEN`
- `NOT_FOUND`
- `VERSION_CONFLICT`
- `IMPACT_CHANGED`
- `RULE_NOT_APPLICABLE`
- `MISSING_RULE_INPUT`
- `SCHEDULE_LIMIT_EXCEEDED`
- `DUPLICATE_SCHEDULE_ENTRY`
- `OCCURRENCE_IMMUTABLE`
- `RECONCILIATION_PENDING`

## 16. Transaction, concurrency, and audit contract

### 16.1 Configuration-changing transaction

Each source mutation:

1. Authenticates and validates tenant/record relationships.
2. Locks or version-checks the mutable source.
3. Saves the configuration or immutable rule publication.
4. Writes an audit event.
5. Inserts a deduplicated reconciliation request.
6. Commits all of the above together.

### 16.2 Audit fields

Audit events record:

- Tenant, actor, action, time, and correlation ID
- Relevant Company, client service, rule, cycle, occurrence, or fee line
- Before and after values
- Current-only versus current-and-future scope
- Origin: UI, API, BizFile, ACRA, scheduler, rule publication, or manual trigger
- Source rule version and configuration hash
- Archive, waiver, reopening, cancellation, or override reason
- Reconciliation request responsible for calculated changes

Large impact operations store a summary and affected record IDs instead of one
unbounded JSON payload.

### 16.3 Idempotency and conflicts

- User edits use `expectedUpdatedAt`.
- Draft rules use a revision/hash.
- Publish/archive uses transaction-level locking and expected version.
- Reconciliation uses deterministic deduplication keys.
- Occurrence uniqueness prevents retry duplicates.
- Stale impact previews fail rather than applying silently.

## 17. User preferences

Use existing `UserPreference` keys rather than a new preferences table.
Versioned JSON payloads cover:

- Services roster columns, order, widths, sorting, and page size
- Deadline table columns and sorting
- Default deadline mode: table or calendar
- Visible deadline types and family filters
- Calendar month count: one, two, or three
- Show holidays on the calendar (default on)
- The calendar focus date is not stored in preferences; it comes from the URL
  and defaults to the current Singapore month

Preference parsing must tolerate missing or older versions and fall back to
responsive defaults.

## 18. Migration and rollout

### 18.1 Additive migration defaults

- `Company.displayAlias` is nullable; no alias is fabricated in storage.
- Missing labels are derived at read time.
- Existing families receive deterministic accessible colors.
- Existing client services receive `UNREVIEWED` billing disposition.
- Deterministic existing billing frequencies are converted to schedule configs.
- Incomplete `CUSTOM` billing frequencies create issues; dates are not guessed.
- No historical deadline or billing occurrence is fabricated.

The migration seeds starter Singapore AGM, Annual Return, ECI, and Form C
templates as unpublished drafts. They generate nothing until an administrator
validates, attaches, and publishes them. Stored Company due dates remain
authoritative when the published rule references them. The seed contains no
tenant-specific attachment and does not activate a rule automatically.

### 18.2 Phases

1. Add schema, indexes, service foundations, audit events, and feature flags.
2. Move catalog administration and add aliases/family colors.
3. Add rule drafts, applicability, calendars, and preview evaluator.
4. Run reconciliation in observation mode and compare proposed changes.
5. Enable occurrence writes for selected tenants/families.
6. Enable roster and deadline table.
7. Enable calendar and persisted preferences.
8. Enable billing occurrences and coverage reconciliation.
9. Redirect the old Document Generation service tab.
10. Remove compatibility code only through a later explicit cleanup change.

Disabling the feature flag hides the new workspace and stops new materialization
without deleting created records. Migrations remain additive so the prior app
version can operate while new tables remain unused.

## 19. Observability and failure handling

Reconciliation requests track attempts, leases, retry time, safe error code,
and lifecycle timestamps. Transient failures retry with bounded exponential
backoff. Permanent invalid-input failures create actionable warnings.

Metrics include:

- Pending count and oldest request age
- Processing duration and retry rate
- Failures by code
- Occurrences created, changed, cancelled, and preserved
- Impact-preview conflicts
- Missing-input services
- Billing coverage issue totals
- Duplicate-prevention conflicts
- API response times and calendar result sizes
- Lease expiry and recovery

Logs include tenant, request, and correlation identifiers but do not record
confidential free-text notes or uploaded company documents.

While relevant reconciliation is pending, the UI displays a non-blocking
schedule-update state. Persistent failures surface an administrator warning.

## 20. Testing strategy

### 20.1 Unit tests

Cover:

- Alias derivation, including the required `OACS` example
- Leap years and month-end clamping
- Calendar/business offsets and previous/next adjustment
- Singapore holidays
- First, nth, last, and second-last business day
- Generic repeatable schedules across multiple service families
- Stable identity after schedule-entry reorder
- Applicability by Company entity type
- Company stored-date precedence
- Derived deadline/billing timing state
- Rule version, history, and override preservation
- Billing current-only/current-and-future behavior

### 20.2 Integration tests

Cover:

- Tenant and accessible-company isolation
- Administrative and operational authorization
- Client-service lifecycle
- Preview, publish, stale preview, archive, and retry
- Company/BizFile/ACRA source-field change
- Calendar change
- Idempotent generation and concurrent claim
- Manual historical preview/apply with no billing
- Coverage issue creation/resolution
- Future cancellation and historical preservation

### 20.3 Browser tests

Cover approved mockup behaviors:

- Roster filters and family-filter placement
- Deadline table/calendar parity
- Deadline-type, open-only, and clickable family filters
- Responsive one/two-month default and persisted one/two/three choice
- Alias/fallback display and family colors
- Manual trigger flow
- Billing edit-scope prompt
- Collapsed reconciliation behavior
- Admin impact preview
- Desktop, tablet, and mobile spacing/layout
- Keyboard, focus, accessible labels, and non-color cues

## 21. Performance acceptance

Test with at least:

- 1,000 companies
- 10,000 client services
- 100,000 deadline occurrences
- 100,000 billing occurrences

Acceptance targets:

- Paginated roster/deadline API p95 at or below 1.5 seconds.
- Two-month calendar API p95 at or below 1.5 seconds.
- No unbounded occurrence query.
- No per-row permission query.
- No tenant-wide database lock during reconciliation.
- Calendar uses visible-event limits and `+N more`.
- Query plans use tenant, company, date, family, status, and origin indexes.

These targets are measured on the project's representative staging environment,
not a developer laptop.

## 22. Product acceptance criteria

The release is accepted when:

1. Catalog/rule administration no longer requires Document Generation.
2. All accessible client services are discoverable from one roster.
3. Roster family filters sit beside Active/Paused/Ended.
4. Deadline family filters sit beside Statutory/Client/Internal/Open only and
   have no `Filter families` label.
5. Deadline table/calendar results match for identical filters/date ranges.
6. Deadline types can be toggled independently.
7. Events show alias/initials, service identity, type, state, and family color.
8. Family color is consistent and not the sole information carrier.
9. Company structure can make a rule inapplicable.
10. Any service rule can use up to 31 generic repeatable entries, including
    relative and second-last-working-day definitions.
11. Rule edits preview impact and change only eligible future occurrences.
12. Company source changes reconcile eligible future occurrences automatically.
13. Historical manual cycles can be created without billing generation.
14. Billing tracking supports state, optional billed date, amount, currency,
    external reference, and notes.
15. Missing billing configuration appears only as actionable Billing-tab cards.
16. Archive preserves history and stops future generation.
17. User view preferences persist.
18. Tenant isolation, auditability, concurrency, retry, and idempotency tests pass.
19. Spacing and responsive behavior match the approved mockups and design guide.

## 23. Implementation-plan boundaries

After approval of this written specification, create three detailed,
independently executable plans. Every plan must link this specification and the
[mockup index](../mockups/2026-08-17-services-workspace-mockups.md), restate
cross-cutting constraints, name exact files/interfaces, and use test-first steps.

### Plan 1 — Administration foundation

Service catalog relocation, Administration navigation/page, Company alias,
family color, catalog authorization, client-service form foundations, and
compatibility redirect.

### Plan 2 — Rule engine and deadline workspace

Rule/version/configuration models, generic schedule language, applicability,
business calendars, evaluator, impact preview, reconciliation worker, service
cycles/deadlines, cross-company roster, deadline table/calendar, preferences,
and manual historical trigger.

### Plan 3 — Billing tracking and reconciliation

Billing disposition, fee schedule configuration, billing occurrences, manual
tracking, current/future edit behavior, coverage issues, Billing-tab UI, and
rolling-horizon reconciliation.

Plans must respect dependencies: Plan 1 provides the administration/client-form
foundation; Plan 2 provides shared schedule and reconciliation primitives; Plan
3 reuses those primitives and must not fork a second rule engine.

## 24. Handoff checklist

A future session should begin by:

1. Reading this document completely.
2. Opening the mockup index and gallery.
3. Reading the repository design, service-pattern, and RBAC guidelines.
4. Checking the current Prisma schema and dirty worktree before editing.
5. Executing only one approved implementation plan at a time.
6. Preserving unrelated user changes.
7. Treating the generic repeatable schedule as a platform capability, never a
   payroll-only special case.

## 25. Deadline projection repair addendum (2026-08-27)

This addendum records the clarified rolling-horizon and maintenance-repair
invariants introduced by the 27 August 2026 repair plan
(\docs/superpowers/plans/2026-08-27-deadline-preview-reconciliation-repair.md\)
and overrides any earlier acceptance language that permitted weaker behavior.

### 25.1 Canonical projection

- Default automatic deadline projection is bounded to
  \[current Singapore date, current Singapore date + 12 months]\.
- \SG_AGM_DUE\ and \SG_ANNUAL_RETURN\ are the only authoritative backlog
  exceptions. They derive annual cycles from the monthly
  \Company.accountsDueDate\ source and are resolved from the stable rule
  codes only � never from rule names, milestone names, UI labels, or
  expression shape.
- Authoritative backlog retains the most recent 20 cycles through the future
  horizon and emits \AUTHORITATIVE_BACKLOG_TRUNCATED\ (with the excluded
  cycle count and oldest retained year) when older cycles are excluded. The
  current and future cycles are never dropped in favor of older history.
- Annual company-date fields (\ccountsDueDate\, \inancialYearEnd\) used
  by \ANNUALLY\ rules are recurring month/day landmarks aligned to the first
  anniversary on or after the active period start. \ONE_TIME\ and other
  recurrence kinds preserve their exact stored dates unless their expression
  explicitly says otherwise.
- No other rule, including ECI, Form C, custom annual rules, or rules sourced
  from \inancialYearEnd\, automatically generates historical backlog. Use
  manual historical cycles for all non-authoritative historical deadlines.

> **Superseded for company statutory coverage (2026-09-27).** The limits above
> still govern service-owned rules. ECI and the corporate income tax return
> under company monitoring follow section 26 instead: they are planned by
> financial period or Year of Assessment, backfilled from the agreement date,
> and include contracted periods beyond the horizon.

### 25.2 Preview/apply parity

- The client-service impact preview and the write-mode reconciler both call
  \projectDeadlineRule\ with the same normalized inputs and must return
  tuple-identical \(ruleId, periodKey, milestoneKey, scheduleEntryKey,
  dueDate)\ sets for the same immutable inputs.
- The Services editor renders dates from the canonical server projection
  (\projectedDeadlines\) and never recomputes deadlines client-side.
- \NO_CHANGE\ diffs are counted truthfully and are not reported as
  preserved lifecycle records.

### 25.3 Maintenance repair

- Normal lifecycle preservation remains strict: Historical, Completed,
  Waived, Cancelled, Manual Trigger, and date-overridden occurrences are
  never mutated by reconciliation.
- The dedicated audited maintenance command
  (\
pm run repair:deadlines\) is the only supported bypass, and only for
  explicitly selected client-service IDs and only for \OPEN\, \RULE\,
  non-overridden occurrences.
- Remediation is dry-run by default, requires the exact dry-run fingerprint
  before \--apply\, writes one audit entry per service, and is
  repeat-idempotent. Incorrect unmatched occurrences are cancelled with a
  repair reason; matched incorrect occurrences are recalculated in place.
  Deadline history is never deleted.

## 26. Company statutory monitoring addendum (2026-09-27)

Plan: `docs/plans/2026-09-27-deadline-rules-and-compliance-monitoring.md`.
Packages 1–4 (a correct tracker) are implemented; guided setup, evidence,
reminders and migration of existing service-owned rows (packages 5–7) are not.

### 26.1 Period-based tax presets

- `SG_ECI` and `SG_FORM_C` keep their codes. Their reviewed presets use
  `OBLIGATION_PERIOD_END` with `ADD_MONTHS_MONTH_END` (+3 months; a month-end
  FYE maps to the target month end) and `FIXED_DATE_IN_ASSESSMENT_YEAR`
  (30 November of the YA). Presets are staged as drafts and still go through
  impact preview and publish.
- Rules using these parts materialize with the `OBLIGATION_PERIOD` policy:
  periods come from confirmed `CompanyFinancialPeriod` rows, otherwise from
  the FYE preference; the normal YA is the FYE year + 1. First periods, FYE
  changes and multi-YA periods are provisional and raise period review items.

### 26.2 Ownership, coverage and responsibility

- `ServiceCycle` / `DeadlineOccurrence.ownershipScope` is `SERVICE` or
  `COMPANY`. Company rows have no `clientServiceId`, are identified by
  `(tenant, company, obligationCode, obligationPeriodKey, milestone)` and are
  enforced by CHECK constraints and a partial unique index.
- `CompanyMonitoringCoverage` records why and from when a company is
  monitored (profiles `CORPORATE_TAX`, `NOMINEE_DIRECTOR`, set on the
  service variant). Activation starts coverage at the agreement date; without
  one, coverage starts provisionally at the service start with a
  `MONITORING_START_REVIEW` item.
- `ClientServiceObligationScope` is the contracted filing scope. An explicit
  `filingScope` field value is confirmed; a legacy YA field only proposes an
  unconfirmed scope. Filing responsibility is `OAKCLOUD` only for a confirmed
  scope on an active service; history is kept in
  `DeadlineResponsibilityChange`, and staff-set responsibility is never
  overwritten.
- An obligation is included when its due date falls in coverage, when a
  scope contracts it (even beyond the 24-month horizon), or when it fell due
  in the 12 months before coverage started (takeover review). Each reason is
  a `DeadlineOccurrenceCoverageLink`; removed reasons are released, not
  deleted. Items created after their due date carry
  `filingStatusUnconfirmed` and show as “Takeover review”, not overdue.

### 26.3 Lifecycle and worker boundary

- The worker reconciles monitored companies after the service loop, one
  transaction per company, and writes no fee lines, billing occurrences or
  billing-coverage issues. Writes need
  `servicesWorkspace.companyMonitoringWritesEnabled` (or
  `COMPANY_MONITORING_WRITES_ENABLED=true`); otherwise it observes.
- While that flag is on, a monitored company's `SG_ECI` / `SG_FORM_C`
  service associations are skipped by the service reconciler (warning
  `COMPANY_MONITORING_OWNS_RULE`) and their existing service-owned rows are
  left untouched until a reviewed migration links them.
- Ending, archiving or deleting a service never cancels company obligations.
  Coverage ends at the service end; obligations that lose every reason
  become `HANDOVER_REVIEW` items. Missing rules or FYE raise review issues
  rather than erasing obligations.
