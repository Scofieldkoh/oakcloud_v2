# Task 6 review — `4c850219..077e6876`

## Spec Compliance

- ❌ **FAIL — issues found.** The list/detail routes, strict schemas, SQL tenant/access scope, lifecycle matrix, nullable billed date, system-only Cancelled handling, optimistic selected-row claim, reset metadata, audits, DTO/pagination/sort surface, and normalized abortable React Query hooks are substantially present. However, `THIS_AND_FUTURE` does not preserve historical Open occurrences as the approved specification requires (`src/services/billing/service.ts:492-503`).
- Requirements checked: Plan 3 Global Constraints and Task 6; approved spec sections 2, 9.9, 13.2, 13.3, 15.4, 16, and 20; Task 6 brief/report/review package; service/RBAC patterns; React query-key, abort, and invalidation behavior.
- Focused external checks: `src/services/service-schedule/date-only.ts:48-78` confirms UTC-backed date-only parsing plus Singapore civil-date calculation; `prisma/schema.prisma:1467-1520` confirms composite tenant lineage, Decimal(18,2), nullable `billedDate`, lifecycle/override fields, and occurrence identity; existing hook key definitions confirm the invalidation prefixes used by `src/hooks/use-billing-occurrences.ts:108-118` match their consumers.

## Strengths

- `src/lib/validations/billing.ts:98-117,127-167,171-217` supplies strict bounded schemas, rejects unknown/duplicate query keys, validates real date-only values, and keeps Cancelled out of user mutation input.
- `src/services/billing/service.ts:220-250,298-327,330-361` applies tenant and accessible-company restrictions in the Prisma list/count/detail queries and repeats tenant integrity through Company, client service, family, and fee-line relations.
- `src/services/billing/service.ts:365-446,483-490,514-570` implements the allowed Open/Billed/Waived transition shape, optional billed date, immutable Cancelled rows, an `id + tenantId + updatedAt` optimistic claim, Serializable mutation transaction, and affected-ID/count audit summary.
- `src/services/billing/service.ts:573-628` resets only the requested override dimensions, restores calculated/base values, clears the matching metadata, and audits the reset reason.
- `src/app/api/billing-occurrences/route.ts:33-50`, `src/app/api/billing-occurrences/[id]/route.ts:53-90`, and `src/app/api/billing-occurrences/[id]/reset-override/route.ts:23-46` consistently require authentication, the enabled Services workspace, company scope, and company read/update permission without exposing inaccessible detail existence.
- `src/hooks/use-billing-occurrences.ts:38-97,99-159` canonicalizes set-like filters into stable keys, forwards query AbortSignals, preserves structured HTTP errors, and invalidates occurrence list/detail, coverage, roster, and affected client-service consumers.

## Issues

### Critical (Must Fix)

- None.

### Important (Should Fix)

1. **Historical Open rows are included in `THIS_AND_FUTURE` bulk value edits.** `src/services/billing/service.ts:492-503` defines future rows as `operativeExpectedDate >= selected.operativeExpectedDate`. The approved spec explicitly defines historical as before the current Singapore date and future as on/after it (`docs/superpowers/specs/2026-08-17-services-administration-deadlines-billing-design.md:114-117`), and requires current-and-future edits not to change historical rows (`:904-913`; Plan Global Constraint at `docs/superpowers/plans/2026-08-17-billing-tracking-and-reconciliation.md:24`). If a user edits a selected historical occurrence—especially a Billed occurrence, which Task 6 explicitly permits—the query will update every matching Open row from that old selected date onward, including overdue historical rows. The affected IDs/count and audit will be internally truthful, but they will describe impermissible data changes. Fix the future predicate to enforce the Singapore boundary as well as selected-row ordering (capture one Singapore `today` and use a lower bound equivalent to `max(selected operative date, today)`), while still always updating the selected row. Add a focused test with a historical selected row and matching Open rows yesterday/today/tomorrow, asserting only today/tomorrow are selected, updated, counted, and audited.

### Minor (Nice to Have)

1. **Core lifecycle/filter/reset behavior is substantially under-tested relative to the handoff claim.** `__tests__/services/billing.service.test.ts:107-257` verifies timing derivation, a coarse list scope, Open→Billed, one future-value happy path, Cancelled rejection, one claim miss, and DATE reset, but it does not exercise family/status/timing query predicates, pagination/sort DTOs, Open→Waived, Billed/Waived→Open metadata clearing and reason enforcement, forbidden Billed↔Waived transitions, billed-date rejection outside Billed, VALUE/ALL reset isolation, future update count mismatch rollback, or the Singapore historical boundary above. Route tests similarly omit feature-disabled and permission-denied mutations, and hook tests do not assert detail invalidation after reset (`__tests__/api/billing-occurrence-routes.test.ts:69-140`; `__tests__/hooks/use-billing-occurrences.test.ts:72-100`). Add focused cases for those contract branches; at minimum the historical-boundary regression belongs in the Important fix.

## Assessment

**Task quality:** Needs fixes

**Verdict:** **FAIL** — 0 Critical, 1 Important, 1 Minor.

**Reasoning:** The access, lifecycle, audit, route, and hook foundations are generally well-structured, but current-and-future edits can mutate records the approved design classifies as protected history. Task 6 should not pass until that predicate and its regression coverage are corrected.
