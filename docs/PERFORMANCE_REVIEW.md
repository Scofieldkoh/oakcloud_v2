# Oakcloud Performance Review

Date: 2026-06-25

Scope: static codebase review focused on page/load performance and removable overhead. This revision assumes an aggressive internal-app cleanup strategy: logged-in users are internal staff, tenant switching and external customer login are not product requirements, and backward compatibility is less important than removing runtime overhead. I did not run production profiling, Lighthouse, database `EXPLAIN`, or a bundle analyzer in this pass, so impact estimates are based on code-path evidence.

## Executive Summary

The main performance issue is not one single slow function. The app has a lot of client-side bootstrapping and broad data fetching before pages become useful:

- The dashboard shell now resolves auth on the server, but many pages still perform their own secondary data, preference, stats, and list requests after the shell renders.
- Many pages then separately fetch permissions, session, user preferences, all company/contact options, list data, and stats.
- The current tenant/RBAC design adds repeated DB work and frontend branching that no longer matches the in-house-only product direction.
- Several list APIs load relation counts and related rows for every page row, and some read endpoints also perform maintenance/reconciliation work.
- Common dashboard code imports heavier UI/animation libraries globally.

Highest-return work should start with reducing request fan-out and removing tenant/super-admin pathways from the internal app shell. Public forms, signing, verification, and share pages should stay as controlled external-facing modules, but the logged-in app should be treated as a single internal workspace.

## Current Implementation Status

Status source: current git working tree on 2026-06-26. This is a code-diff review plus local verification. I ran TypeScript, the full Vitest suite, and a production build; I did not run Lighthouse, browser waterfall capture, bundle analyzer, production profiling, or database `EXPLAIN`.

### Completed or Mostly Completed

- Tenant selector removal from the sidebar: `SidebarTenantButton` and `src/components/ui/tenant-selector.tsx` are removed from the dashboard shell, and the `/admin/tenants` page plus `/api/tenants/*` routes are deleted.
- Tenant setup wizard removal: `src/components/admin/tenant-setup-wizard.tsx` and the wizard step components under `src/components/admin/wizard-steps/*` are deleted.
- Runtime tenant query plumbing reduction: many internal routes now use the session workspace context directly instead of accepting `tenantId` query/body overrides, and several `skipTenantFilter` paths were removed from list routes.
- Sidebar company selector async search: `CompanySelectorModal` now uses the capped `/api/companies/options` search path when opened, and the legacy `useAllCompanyOptions()` compatibility hook no longer paginates through the full company list.
- Option endpoint foundation: new `/api/companies/options` and `/api/contacts/options` endpoints return capped, narrow option DTOs with `q`/`query` and `limit` support.
- List/workflow option loading cleanup: processing upload and admin user role-assignment screens now use async searchable company options backed by `/api/companies/options` instead of paginating through the full `/api/companies` list.
- Document/template option loading cleanup: generated-document creation and template-editor test data now load company choices from capped `/api/companies/options` responses instead of broad `/api/companies?limit=100` list responses.
- Processing list read-side cleanup: `/api/processing-documents` no longer runs batch-extraction reconciliation during GET list requests, and `listProcessingDocumentsPaged()` no longer performs best-effort `currentRevisionId` backfill during list reads.
- Processing reconciliation is now explicit: a new `POST /api/processing-documents/[documentId]/reconcile` endpoint performs pending extraction reconciliation on demand.
- Processing timezone lookup removal: processing list date filters now use `Asia/Singapore` as the internal default instead of fetching tenant settings on every GET.
- Navigation loading bundle reduction: `NavigationProgress` no longer imports `motion/react` or `@lottiefiles/dotlottie-react`; it uses a lightweight CSS spinner overlay.
- Sidebar prefetch reduction: sidebar links now set `prefetch={false}`, including collapsed popover links.
- Server-side dashboard auth bootstrap: `src/app/(dashboard)/layout.tsx` is now a server component that resolves the combined session/permission payload, redirects unauthenticated requests before the dashboard client tree loads, and hydrates the `session-with-permissions` query cache for client hooks.
- Dashboard shell split: interactive sidebar/media-query/error-boundary behavior moved into `src/app/(dashboard)/dashboard-shell.tsx`, leaving auth resolution out of the client shell.
- Company-scoped permission fan-out removal on the companies page: `useCompanyPermissions()` now derives row action permissions from the already-hydrated base permission payload instead of issuing one company-scoped auth request per visible company row.
- Processing revision pointer repair path: `processing-revision-backfill` is registered as a scheduler task to backfill missing `currentRevisionId` pointers for processing documents with approved revisions, replacing the removed list-read side effect with explicit background maintenance.
- Company list relation count trimming: the `/api/companies` list path no longer counts related documents and charges for every row; the table path keeps only current officer/shareholder counts plus current address and POC presence.
- Global Chakra provider removal: `src/app/providers.tsx` no longer mounts `ChakraProvider`, and the local `Button`/`FormInput` wrappers were converted to native Tailwind-backed components.
- Default dashboard Lottie removal: dashboard loading no longer imports `LottieLoader`, the unused loader component was removed, and the unused direct `@chakra-ui/react`, `@lottiefiles/dotlottie-react`, and `motion` dependencies were uninstalled.
- Company endpoint split: explicit read endpoints now exist for `/api/companies/list`, `/api/companies/options`, `/api/companies/summary`, `/api/companies/stats`, and `/api/companies/[id]/detail`; the companies page reads through the lean list/bootstrap path while legacy collection/detail routes remain for compatibility and writes.
- Batched preferences and page bootstrap: `/api/user-preferences?keys=...` batches preference reads, `/api/page-bootstrap/companies` returns list data, stats, and preferences together, and `/api/page-bootstrap/processing` batches processing summary and table preferences.
- Summary count surfaces: `/api/companies/summary` and `/api/processing-documents/summary` provide explicit count surfaces for list/dashboard badges without loading broad row relations. Processing summary counts by pipeline, duplicate, and revision-review state.
- Internal/public provider split: public forms, public signing, share, and verification pages moved under `src/app/(public)` with no app provider/sidebar/navigation stack; login/password pages moved under `src/app/(auth)`; dashboard/auth layouts mount `Providers` explicitly while the root layout stays provider-free.
- Performance regression scaffolding: `src/lib/performance-budgets.ts` defines request-count, payload, server-timing, DB-timing, and first-load JS budgets for high-traffic routes, and `__tests__/performance/performance-budgets.test.ts` enforces budget coverage plus the provider/route-group split.
- Internal staff role migration: `ADMIN`, `MANAGER`, and `STAFF` are now the canonical system role types. The migration rewrites legacy `SUPER_ADMIN`, `TENANT_ADMIN`, `COMPANY_ADMIN`, and `COMPANY_USER` role rows, while the runtime recognizes old values as migration aliases.
- Physical summary data migration: `Company` now has denormalized `currentOfficerCount`, `currentShareholderCount`, `activeChargeCount`, `documentCount`, and `hasPoc` columns with a backfill migration, indexes, and a nightly `summary-count-refresh` scheduler task.
- Materialized summary views: the migration creates `company_summary_counts` and `processing_document_summary_counts` materialized views for high-traffic summary surfaces.
- Public startup bootstrap: public form, share, e-signing session, and certificate verification startup reads now have `/api/public-bootstrap/...` endpoints with timing headers; form, share, signing session load, and certificate verification clients use those compact paths.
- Live performance measurement collection: `/api/performance/measurements` persists request-count, payload-size, server-timing, DB-timing, and first-load-JS measurements to `performance_measurements`.
- Back/forward list restore: list pages persist their last-known response in sessionStorage and seed the query cache from it when the in-memory cache is cold. Browser Back after a refresh or direct page load therefore renders the previous rows instantly and refreshes in the background instead of waiting on the page-bootstrap request. Applied to Companies, Contacts, Processing, Forms, Generated Documents, E-signing, Communication, and Template Partials via the shared helpers in `src/hooks/use-session-query-restore.ts`.
- History API ownership restored: `useNavigationProgress` no longer monkey-patches `history.pushState`/`history.replaceState`, leaving Next.js's own history state (`__NA`) intact so back/forward stays a soft in-app navigation instead of falling back to a full page reload. The progress indicator is driven by link clicks only; browser Back/Forward restores are instant router-cache hits and do not trigger the spinner overlay.

### Partially Complete

- Auth request fan-out: dashboard first render now uses server-hydrated session/permission data, and client hooks share the combined `/api/auth/session` cache. The duplicate `/api/auth/me` and `/api/auth/permissions` routes were removed; scoped permission checks now use `/api/auth/session?companyId=...`.
- RBAC and tenant naming cleanup: code is moving from tenant terminology to workspace terminology (`Workspace`, workspace routes/services) and internal role terminology (`ADMIN`, `MANAGER`, `STAFF`). Deprecated admin booleans remain as compatibility aliases for existing callers.
- Tenant schema cleanup: Prisma models were renamed from `Tenant*` to `Workspace*`, but the database mappings and many foreign key fields still use tenant names such as `tenantId`, `tenant_id`, and mapped tenant table names. This is a compatibility rename, not a full removal of tenant persistence.
- Company/contact option loading: the remaining full-table company/contact option loaders have been removed or converted to capped `/options` endpoint wrappers instead of paginating full list APIs.
- Company list query slimming: `/api/companies/options` handles searchable selects, `/api/companies/list` is the explicit table-list read path, and the main company list service uses denormalized count columns for count filters and sort fields.
- Tenant management surface replacement: tenant routes and services were deleted, while new workspace routes/services were added. This is a product-language cleanup and admin-surface rewrite, but the remaining question is whether workspace management is still required for an internal single-workspace app.

### Still Incomplete

- No remaining implementation tasks from this review section. Deployment still needs the new migration applied, the summary refresh task enabled, and production measurements collected against real traffic/data volume.

### Review Comments

- The current diff is aggressive and directionally aligned with the review, but it is also high-risk because it touches auth, RBAC, Prisma model names, generated Prisma code, many API routes, and public-facing modules in one batch.
- Several database field names still preserve `tenantId` under the hood. That is acceptable as a compatibility layer, but it should not be confused with product-level tenant switching.
- The deletion of GET-time reconciliation is a clear performance improvement. Pending extraction reconciliation is explicit via endpoint, and stale `currentRevisionId` repair now has a scheduler task; operational deployment still needs the task enabled or manually triggered in environments that contain stale records.
- The new `/options` endpoints are the right pattern. The sidebar company selector, generated-document creation, and template-editor test data now follow that path; the next cleanup should continue replacing any remaining direct `/api/companies?limit=...` selector loads with capped option endpoints.
- Verification on 2026-06-26: `npx.cmd tsc --noEmit`, full `npx.cmd vitest run` (25 files, 380 tests), and `npm.cmd run build` pass. The build still reports pre-existing lint warnings in processing/forms/document/export areas and browser data freshness warnings.

## Aggressive Revamp Position

Use this as the target architecture for performance work:

- Internal app has one organization/workspace context. No tenant selector, no super-admin tenant switching, no tenant setup wizard, no tenant invite semantics.
- Logged-in staff access is role based, but not tenant based. Prefer `ADMIN`, `MANAGER`, `STAFF`, and module-specific permissions over `SUPER_ADMIN`, `TENANT_ADMIN`, and company-scoped tenant roles.
- Public/client-facing modules are explicit exceptions: public forms, e-signing links, and certificate verification remain token/slug based and do not imply external users can log in.
- Compatibility paths that only exist to preserve old multi-tenant behavior should be removed, not hidden.
- Database cleanup can happen in phases, but runtime code should stop carrying tenant-switching complexity early.

## Optimization Principles

These rules should guide the revamp:

- Delete dead or obsolete paths instead of wrapping them in more feature flags.
- Prefer one clear data path per workflow over generic services that handle every historic mode.
- Make public routes and internal routes separate by architecture, not just by conditional checks.
- Fetch only what the current screen needs. Add detail, summary, options, and export endpoints instead of one broad endpoint.
- Move work out of page-load GET requests unless the result is required for first render.
- Treat bundle size as a performance budget. Heavy packages should not enter shared layouts by default.
- Make expensive work explicit: jobs, queues, workers, scheduled reconciliation, or manual refresh.
- Remove compatibility code after one migration pass. Do not leave permanent dual-read/dual-write paths unless there is an active rollout window.
- Keep code understandable. A simpler implementation that is slightly less abstract is preferred over a generic helper that hides performance cost.
- Every major optimization should include a before/after measurement: request count, payload size, server time, DB time, and client bundle size.

## Highest Priority Findings

### 1. Dashboard boot is client-only and session-gated

Evidence:

- `src/app/(dashboard)/layout.tsx` is now a server component and redirects unauthenticated users before rendering the dashboard client shell.
- `src/app/(dashboard)/dashboard-shell.tsx` owns the interactive sidebar/media-query layout work.
- `src/hooks/use-auth.ts` and `src/hooks/use-permissions.ts` share the hydrated `session-with-permissions` cache for base session and permission reads.

Impact:

- First protected page auth no longer waits for a client fetch.
- Route transitions no longer depend on the old client-only auth guard path.
- Page-specific data, preference, stats, and feature queries can still create request fan-out after the dashboard shell is available.

Recommendation:

- Continue replacing page-level bootstrap request groups with page-specific server-composed payloads where the page repeatedly needs the same preference/stats/list data.
- Keep auth and permission reads on the hydrated `session-with-permissions` cache; do not reintroduce separate auth endpoints.

Expected gain: fewer network round trips on every protected page load and less loading spinner time.

### 2. Tenant and RBAC are now overbuilt for the product direction

Evidence:

- `src/lib/auth.ts` computes `isSuperAdmin`, `isWorkspaceAdmin`, `hasAllCompaniesAccess`, and `companyIds` from `roleAssignments` on every session lookup.
- `src/lib/rbac.ts` stores permission cache entries per user and optional company scope, then fetches role assignments and nested role permissions on cache miss.
- Many routes branch on `session.isSuperAdmin`, `session.isWorkspaceAdmin`, `tenantId`, `tenantIdParam`, and `skipTenantFilter`.
- The sidebar still includes tenant selection UI for super admins.

Impact:

- Internal staff page loads pay for multi-tenant and cross-tenant authorization logic even if there is only one internal organization.
- Permission checks for company-scoped users can fan out per company through `useCompanyPermissions(companyIds)`.
- The product has extra UI state, query keys, route parameters, and database lookups for tenant switching that no longer provides value.

Recommendation:

- Remove tenant selection from the logged-in app, including sidebar tenant selector, tenant admin pages, tenant setup flows, and super-admin cross-tenant query parameters.
- Replace super-admin/tenant-admin branching with internal roles such as `ADMIN`, `MANAGER`, `STAFF`, plus explicit public-token access for forms/signing/share pages.
- Keep `/api/auth/session` as the single auth/permission payload endpoint.
- Remove company-scoped role fan-out unless the business still needs per-company restrictions for internal staff.
- In route code, delete `tenantIdParam`, `skipTenantFilter`, tenant validation lookups, and cross-tenant fallback paths once internal workspace scoping is in place.

Expected gain: fewer permission/session queries, less route branching, simpler query keys, smaller client UI state.

### 3. Eager "load all companies/contacts" hooks cause avoidable page-load work

Evidence:

- `src/hooks/use-all-company-options.ts` paginates through every `/api/companies` page with `PAGE_LIMIT = 200` until all pages are fetched.
- `src/hooks/use-all-contact-options.ts` does the same for contacts.
- `src/components/ui/company-selector.tsx` renders `CompanySelectorModal` from the sidebar at all times; the modal calls `useAllCompanyOptions(activeTenantId)` even while closed.
- `src/app/(dashboard)/companies/page.tsx`, `src/app/(dashboard)/processing/page.tsx`, `src/app/(dashboard)/contacts/page.tsx`, and `src/app/(dashboard)/admin/users/page.tsx` also call all-option hooks.

Impact:

- Opening any dashboard page can trigger full-table option loading unrelated to the primary page task.
- This scales linearly with company/contact count and becomes expensive as data grows.
- Each option page currently goes through the full list API path rather than a lightweight `id/name` option endpoint.

Recommendation:

- Add an `enabled` option to `useAllCompanyOptions` and `useAllContactOptions`.
- In the sidebar company selector, enable the query only when the modal is open.
- Replace full option loading on list pages with async searchable selectors backed by `/api/companies/options?q=&limit=50` and `/api/contacts/options?q=&limit=50`.
- For filters, use current page values plus server search instead of requiring all records in memory.

Expected gain: removes one of the largest avoidable first-load costs on core pages.

### 4. Company list query is too broad for a list page

Evidence:

- `src/services/company.service.ts` `searchCompanies()` builds `OR` searches across company fields, officers, shareholders, and addresses.
- The same function includes current address, POC contact existence, and `_count` for documents, officers, shareholders, and charges for every row.
- Officer/shareholder count range filters are applied after pagination, which is both expensive and inaccurate for totals.
- `getCompanyStats()` performs five aggregate queries.

Impact:

- The list endpoint combines search, table display, filter metadata, and relation summaries in one query.
- Relation counts and nested filters can become the dominant cost as data grows.
- Post-query filtering means the database can return a page of rows that are then discarded, creating slow and confusing pagination.

Recommendation:

- Split company list DTO from detail DTO. List pages should fetch only fields displayed in the table.
- Denormalize frequently displayed counts (`currentOfficerCount`, `currentShareholderCount`, `activeChargeCount`, `documentCount`, `hasPoc`) onto `Company` and update them from write paths or a reconciliation job.
- Replace `contains` search on relational fields with a dedicated search endpoint or Postgres full-text/trigram indexes.
- Move count-range filtering into SQL/raw query or remove it until it can be implemented accurately.
- Cache stats or return stats together with the main list only when needed.

Expected gain: lower DB time and payload size on `/companies`, especially for large tenants/internal datasets.

### 5. Processing document list does work that should not happen during page load

Evidence:

- `src/app/api/processing-documents/route.ts` fetches tenant settings for timezone on every GET.
- The same GET checks pending queued/processing docs and calls `reconcilePendingBatchExtraction()` for each pending document in the current page.
- `src/services/document-processing.service.ts` `listProcessingDocumentsPaged()` includes document, company, current revision, and latest revision for every row.
- `listProcessingDocumentsPaged()` also contains best-effort backfill for `currentRevisionId`.

Impact:

- A read-only list page can trigger reconciliation and possibly a second list query.
- User-facing list latency is coupled to background extraction state.
- Repeated tenant settings/timezone lookup is unnecessary in an in-house single-tenant app.

Recommendation:

- Move batch extraction reconciliation into a scheduler/worker or explicit refresh action, not list GET.
- Move `currentRevisionId` backfill into a migration or background maintenance task.
- Cache tenant timezone or replace it with the internal default timezone.
- Consider a list-specific materialized view or summary table for processing documents if this page remains central.

Expected gain: more predictable processing page latency and fewer surprise DB/external operations during reads.

### 6. Global dashboard bundle includes heavy UI/animation code

Evidence:

- `src/app/providers.tsx` no longer globally imports Chakra or mounts `ChakraProvider`.
- `src/components/ui/navigation-progress.tsx` no longer imports `motion/react` or `@lottiefiles/dotlottie-react`.
- `src/app/(dashboard)/layout.tsx` renders `NavigationProgress` for all dashboard pages.
- The former Chakra-backed `Button` and `FormInput` common components now use native elements and Tailwind classes.

Impact:

- The default dashboard shell no longer pays the direct Chakra/Lottie/motion cost.
- Other feature-heavy client libraries can still enter route chunks through rich editors, PDF viewers, import/export flows, and e-signing UI.

Recommendation:

- Keep Chakra, Lottie, and motion out of the shared provider/layout path unless a route explicitly needs them.
- Use `next/dynamic` for rich editors, PDF viewers, and other rarely used heavy widgets.

Expected gain: smaller initial JS and faster client hydration.

### 7. Sidebar prefetch and common page hooks may overload navigation

Evidence:

- `src/components/ui/sidebar.tsx` uses `Link prefetch={!isDisabled}` for every nav item.
- Common list pages independently request auth, permissions, preferences, options, list data, and stats.

Impact:

- Prefetch can compete with the current page on slower devices or when many dashboard routes exist.
- The app can spend bandwidth preparing routes the user may not visit.

Recommendation:

- Disable default sidebar prefetch or only prefetch high-frequency routes on hover/focus.
- Create page bootstrap endpoints for high-traffic pages that return list data plus user page preferences in one call.
- Batch user preferences instead of one `/api/user-preferences?key=...` request per preference.

Expected gain: lower background network activity and more predictable current-page load time.

## Tenant Removal Roadmap

### Phase 1: Remove tenant switching from runtime

- Delete `SidebarTenantButton`, tenant selection state, and tenant selector modal from the sidebar.
- Replace `useActiveTenantId()` usage in internal pages with no-op internal workspace scoping.
- Keep public forms, signing, verification, and shared document pages token/slug based.
- Remove `tenantId` URL/query plumbing from logged-in routes.
- Remove tenant picker empty states such as "Select a tenant from the sidebar".

### Phase 2: Collapse auth and permission bootstrapping

- Use one server-side auth loader for dashboard layout.
- Return role/permission claims once.
- Replace company-scoped permission fan-out with simple internal roles unless company-level restrictions are explicitly retained.
- Remove `SUPER_ADMIN` vs `TENANT_ADMIN` branching from internal pages.

### Phase 3: Delete tenant management surface

- Delete or archive `/admin/tenants`, tenant setup routes, tenant service flows, tenant invitations, tenant limits, tenant backup schedules by tenant, and tenant-specific connector access if they are no longer operationally needed.
- Remove tenant invitation/setup email language.
- Convert tenant branding/settings used by public forms/signatures to organization/workspace settings.

### Phase 4: Schema cleanup

- Replace `Tenant` with `OrganizationSettings` or `WorkspaceSettings` for branding, timezone, connector defaults, and public page configuration.
- Remove tenant FK requirements from internal tables after migration scripts are ready.
- Keep only the public boundary fields needed to resolve form/signature/share branding and access.

## Deletion Candidates

These areas should be removed or heavily rewritten during the aggressive cleanup:

- `src/stores/tenant-store.ts`
- `src/components/ui/tenant-selector.tsx`
- `/admin/tenants` page and `/api/tenants/*` routes
- `src/services/tenant.service.ts` except settings that become organization/workspace settings
- tenant setup, tenant limits, tenant status, tenant suspension, tenant activation, tenant invitation language
- `SUPER_ADMIN`, `TENANT_ADMIN`, tenant-scoped role branching, and company-scoped role fan-out if internal per-company restrictions are dropped
- `tenantId` query parameters in logged-in API routes
- `skipTenantFilter` and cross-tenant list/stat branches
- full-table option loaders used only to support tenant/company switching UX

Also audit and remove:

- Tenant setup wizard components under `src/components/admin/wizard-steps/*` and `src/components/admin/tenant-setup-wizard.tsx` if tenant onboarding is no longer used.
- Tenant backup/schedule code that exists only for per-tenant backup management.
- Tenant connector access tables and services if connector access is now organization-wide.
- Any route comments or code paths labelled `legacy`, `backward compatibility`, `deprecated`, `temporary`, `placeholder`, or `stub` after confirming the current product path does not need them.
- Dual password-hash or legacy auth support after a one-time password migration/reset campaign.
- Deprecated CSS/component paths if the current design system has replacements.

## Recommended Optimization Backlog

### Quick Wins

- [Done] Gate `useAllCompanyOptions()` in `CompanySelectorModal` behind `isOpen`.
- [Done] Stop loading all company/contact options on list pages by default. Processing upload and admin user role assignment now use async `/api/companies/options`; the remaining full company load is gated behind the sidebar selector modal.
- [Done] Use the combined session+permissions hook and hydrated auth context for the dashboard shell. `src/app/(dashboard)/layout.tsx` now resolves the combined payload on the server and hydrates `session-with-permissions`.
- [Done] Disable sidebar prefetch for lower-priority routes. Current diff disables sidebar link prefetch globally.
- [Done] Replace global Lottie navigation overlay with CSS or dynamic import. Current diff replaces Lottie/motion imports with a CSS spinner.
- [Done] Cache tenant timezone/settings in memory or use the internal default. Processing list now uses `Asia/Singapore` without a per-request tenant settings lookup.
- Ensure public-facing pages do not mount dashboard-only providers, sidebar logic, tenant selectors, admin auth hooks, or global navigation progress UI.
- Lazy-load public page PDF viewers, signature pads, upload widgets, rich text/render helpers, and AI helpers only when the user reaches that step.

### Medium Effort

- [Done] Split `/api/companies` into list, detail, options, summary, and stats read endpoints. Legacy collection/detail routes remain for compatibility and writes.
- [Done] Add server-side batched user preferences and page bootstrap endpoints. Companies startup now uses `/api/page-bootstrap/companies`; processing has a summary/preference bootstrap route.
- [Done] Move processing-list reconciliation and revision backfill out of GET handlers. GET-time work was removed, explicit per-document reconcile was added, and `processing-revision-backfill` is registered as a scheduler task.
- [Done] Add summary count endpoints for company and processing list/dashboard surfaces. Physical denormalized columns/materialized views remain a production-scale follow-up if endpoint timings require them.
- Add database-level search support for frequent `contains` searches.
- Split public form/signing APIs from internal APIs so they do not run internal auth, tenant/RBAC, admin permission, or broad relation-loading code.
- Add lean public config endpoints that return only the fields required to render public forms, signing sessions, and verification pages.
- Cache public form schema, branding, static form assets, signing envelope metadata, and verification certificate metadata with short, explicit cache windows.

### Larger Refactors

- [Done] Server-render the dashboard shell with session data.
- [Done] Simplify RBAC for internal-only staff access. `ADMIN`, `MANAGER`, and `STAFF` are canonical system roles; legacy role strings are migration aliases only.
- [Partial] Remove tenant setup/management paths from the internal app. Tenant pages/routes/wizard were deleted, but replacement workspace management routes/services were added and should be evaluated against the single-workspace target.
- [Done] Create list summary tables/materialized views for processing and company dashboards. Company summary columns and company/processing materialized views are created by migration.
- [Done] Create separate internal/auth/public route groups with separate provider stacks:
  - Internal routes: authenticated app shell, internal roles, dashboard data caches.
  - Public routes: no dashboard shell, no internal auth provider, minimal CSS/JS, token/slug validation only.
- [Done] Introduce public-page specific route groups for forms, signing, and verification instead of inheriting the dashboard provider stack.
- Replace runtime tenant branding with organization/public-page settings that can be cached and served cheaply.

## Full-App Lightweighting Opportunities

The aggressive revamp should target both internal staff workflows and external client-facing pages. Performance work should avoid only optimizing the dashboard while leaving public forms/signing inside heavy shared code paths.

### Internal Dashboard

- Server-resolve auth in the dashboard layout and hydrate a single lightweight auth context.
- Remove tenant switching, tenant route params, tenant selector state, and cross-tenant query branches.
- Replace permission fan-out with simple internal role claims.
- Remove full-table company/contact option loading from page startup.
- Build small list APIs that return only visible table fields.
- Move counts, stats, and badges to denormalized summary fields or deferred secondary endpoints.
- Batch page preferences, filters, and user settings.
- Remove heavy libraries from global providers unless used on most pages.
- Use route-level dynamic imports for editors, PDF tools, AI panels, upload tools, and advanced table tools.
- Replace large animated loading overlays with lightweight CSS progress indicators.
- Avoid doing maintenance/reconciliation/backfill inside GET list requests.
- Use background workers/schedulers for extraction reconciliation, status refreshes, cleanup, and derived count updates.
- Measure every high-traffic page with request count, payload size, server timing, and bundle size.

### Public Forms

- Serve public form pages from a minimal public route group without dashboard providers.
- Fetch one compact form-render payload: form title, active fields, validation rules, branding, upload limits, and submission settings.
- Exclude builder-only data, audit data, admin metadata, translations not needed for the current locale, and internal form analytics from initial render.
- Cache public form schema and branding. Invalidate on form publish/update.
- Lazy-load file upload components only when the form contains upload fields.
- Lazy-load AI review/helper code only after submission or when explicitly needed.
- Use direct-to-storage upload flows for large attachments where possible.
- Compress and resize logo/branding assets.
- Avoid loading every field option set globally if conditional sections hide most fields.
- For long forms, render sections progressively and avoid recalculating the entire form on every keystroke.

### Public E-Signing

- Serve signing pages from a minimal public route group.
- Fetch a compact signing-session payload: recipient state, document list, required fields, consent status, and signed/declined state.
- Lazy-load PDF rendering only after consent/session validation succeeds.
- Lazy-load signature pad code only when a signature/initial field is activated.
- Preload only the first document/page needed for signing, then load nearby pages on demand.
- Cache immutable document page images/PDF assets with signed URLs or token-scoped access.
- Avoid repeatedly fetching envelope detail, recipients, documents, and fields as separate startup calls.
- Move reminder/expiry/status reconciliation out of page-load GET handlers.
- Keep completion certificate generation asynchronous when possible and show completion immediately after required writes finish.

### Public Verification

- Verification pages should be static-light: certificate ID, status, signer metadata, document fingerprint, and download link only when authorized.
- Avoid importing dashboard document editor/commenting tools into public read-only pages.
- Keep audit trails deferred unless the user opens them.

### Assets and Bundles

- Run a bundle analyzer and remove global dependencies from shared layouts.
- Convert Chakra-backed common UI components to the existing Tailwind/component system or dynamically import the few Chakra-only widgets.
- Remove Lottie from the default app shell; reserve it for pages that explicitly need it.
- Keep `pdfjs-dist`, Tiptap, ExcelJS, PDF-lib, AI SDKs, and storage SDKs out of client bundles unless a specific client component needs them.
- Use dynamic imports for PDF viewers, document editors, rich-text editors, AI panels, import/export flows, and e-sign preparation tools.
- Audit `public/pets/sprites` and other decorative assets. Keep them out of initial app loads and only load when the feature is enabled.
- Optimize SVG/logo/image dimensions and caching headers.

### API and Data Shape

- Prefer endpoint-specific DTOs over returning service objects with relations.
- Add `/options` endpoints for searchable selects instead of loading all records.
- Add `/summary` endpoints for counts and cards, backed by summary tables where possible.
- Use cursor pagination for large datasets or deep navigation.
- Avoid `contains` search across multiple related tables for normal list loads; use dedicated search indexes.
- Use DB `EXPLAIN ANALYZE` to choose indexes based on real slow queries.
- Add `Cache-Control` where responses are public-safe or user-stable.
- Add ETags or version keys for public form/signing config.
- Keep public token validation cheap: indexed token hash lookup, narrow select, no broad includes.
- Avoid returning unused nested relation fields.

### Background Work

- Move these out of page requests:
  - extraction reconciliation
  - revision backfill
  - derived count updates
  - duplicate refreshes
  - reminder/expiry checks
  - cleanup jobs
  - heavy PDF/export generation
- Use job state polling with small status endpoints rather than reloading full page data.
- Keep upload/extraction user flows responsive by returning quickly after durable writes and queueing expensive processing.

### UX Perception

- Render page skeletons from known layout immediately while data loads.
- Keep previous table data visible during filter/page changes.
- Use optimistic updates for simple mutations.
- Avoid blocking a whole page for stats, preferences, or secondary filters.
- Use small targeted refreshes instead of invalidating entire feature query trees.
- Make public form/signing steps feel instant by validating locally first, then doing server validation on submit/step transition.

## Code Cleanliness and Best Practices

Performance work should leave the codebase cleaner, not just faster. These standards should apply during implementation.

### Architecture

- Separate route groups by audience:
  - `(dashboard)` for authenticated internal staff.
  - public routes for forms, signing, and verification.
- Avoid importing internal dashboard modules from public routes.
- Avoid generic "tenant-aware" helpers in internal-only code after tenant removal.
- Keep public route helpers small: token validation, narrow data loading, response DTO mapping.
- Keep service functions aligned to use cases. A `listCompaniesForTable` service should not return detail-page relations.
- Delete old abstractions when their only consumer is removed.
- Prefer clear module boundaries:
  - `features/internal/*` for logged-in workflows.
  - `features/public-forms/*`
  - `features/public-signing/*`
  - `features/background-jobs/*`

### API Design

- Use purpose-built endpoints:
  - `/api/companies/list`
  - `/api/companies/options`
  - `/api/companies/summary`
  - `/api/companies/:id/detail`
  - `/api/public/forms/:slug/render`
  - `/api/public/signing/session/load`
- Keep list responses flat and small. Do not return nested relation objects unless the table renders them.
- Return stable DTOs from route handlers instead of raw Prisma/service entities.
- Validate query parameters once at the route boundary.
- Avoid multiple internal `fetch()` calls from the browser when one server endpoint can compose the needed first-render payload.
- Batch preference reads and writes.
- Use consistent error envelopes for internal APIs and compact error envelopes for public APIs.
- Add explicit `Cache-Control` headers for public-safe or user-stable responses.
- Add `ETag`, version numbers, or `updatedAt` revision keys for public form/signing config.
- Avoid route handlers that both read and mutate state unless the route is explicitly a mutation.

### Database and Prisma

- Prefer `select` over `include` by default.
- Do not use broad relation includes in list endpoints.
- Avoid `count()` plus `findMany()` on every request if the UI can tolerate approximate totals, "has more", or cursor pagination.
- Use cursor pagination for large and frequently filtered datasets.
- Use summary tables or denormalized fields for counts shown on every row.
- Use materialized views or maintained summary tables for dashboards.
- Add indexes based on real `EXPLAIN ANALYZE`, not guesswork.
- Add search indexes for frequent text search:
  - trigram indexes for partial name/UEN searches.
  - full-text indexes for multi-field document/company search.
  - narrow btree indexes for status/date/company filters.
- Avoid `contains` searches across related tables in normal list endpoints.
- Avoid post-query filtering after pagination. It creates incorrect totals and wastes DB work.
- Keep transactions short. Do not run external API calls, PDF generation, email sending, or AI calls inside DB transactions.
- Use bulk operations (`createMany`, `updateMany`, raw SQL where appropriate) for reconciliation and backfills.
- Move one-time data fixes into migrations/scripts instead of best-effort runtime code.

### Frontend Rendering

- Prefer server components for static shells, authenticated layout bootstrapping, and initial data that does not need browser APIs.
- Keep client components small and interactive only.
- Do not put global providers around public pages unless required.
- Avoid storing server data in Zustand/local storage when TanStack Query or server props already own it.
- Keep query keys stable and primitive. Avoid passing large objects directly when they change identity frequently.
- Gate queries with `enabled` when data is hidden behind a modal/tab/step.
- Debounce search inputs before hitting APIs.
- Use virtualization for long tables or lists.
- Use memoization for expensive derived data, but do not use `useMemo`/`useCallback` as a substitute for smaller components and smaller props.
- Avoid effects that mirror props into state unless editing/draft behavior requires it.
- Use local state for UI-only state; use URL state only for shareable filters.
- Avoid full page re-renders on keystrokes in large forms. Isolate field components and use field-level state subscriptions.

### Bundles and Dependencies

- Keep dashboard shared layout free of:
  - PDF rendering libraries
  - rich text editors
  - spreadsheet/export libraries
  - AI SDKs
  - storage/cloud SDKs
  - Lottie/large animation libraries
  - rarely used design-system providers
- Use dynamic imports for feature-heavy widgets.
- Remove duplicate UI libraries where possible. Prefer the existing Tailwind/component system over mixing Chakra and custom components.
- Run bundle analysis after each major route split.
- Create budgets:
  - dashboard shell JS budget
  - public form first-load JS budget
  - public signing first-load JS budget
  - largest route chunk budget
- Prefer CSS animations over JS animation libraries for loading/progress indicators.
- Optimize static assets with appropriate dimensions, compression, and cache headers.

### Background Jobs

- Use workers/schedulers for:
  - extraction reconciliation
  - reminders
  - expiry checks
  - PDF generation
  - backup/cleanup
  - count denormalization
  - duplicate analysis
  - slow exports
- Job endpoints should return job IDs and small status payloads.
- UI should poll lightweight status endpoints or subscribe to updates, not reload full records.
- Make jobs idempotent and retry-safe.
- Store progress and failure reasons for user-visible workflows.

### Security While Simplifying

- Removing tenant overhead should not weaken public access controls.
- Public routes must validate token/slug access with indexed token hashes and narrow selects.
- Public links should have expiry, revocation, rate limits, and audit events where appropriate.
- Internal routes can be simpler, but should still require authenticated staff and role checks for destructive/admin actions.
- Avoid leaking internal IDs or metadata in public DTOs.
- Keep CSRF protection for state-changing internal routes and public submit routes where browser-origin risk exists.

### Testing and Verification

- Add tests around public access boundaries before deleting tenant/RBAC code.
- Add route-level tests for compact DTOs so broad relations do not creep back in.
- Add performance regression checks for:
  - number of startup requests
  - public page bundle size
  - dashboard shell bundle size
  - slow API query count
- Add smoke tests for public form submit, draft resume, signing session load, signature submit, share view, and certificate verification.
- Add database migration tests or scripts for removing tenant dependencies.
- Keep a deletion checklist for each removed subsystem: routes, hooks, stores, services, tests, docs, generated types, env vars.

## Additional Feature-Specific Opportunities

### Forms Builder and Responses

- Split builder-only code from public-render code. Public forms should not import builder utilities or admin settings components.
- Store a published form snapshot optimized for rendering, separate from editable draft configuration.
- Precompute conditional-logic dependency maps at publish time.
- Precompute localized labels at publish time where possible.
- For response tables, fetch visible columns only and defer attachment/AI review details until expanded.
- Generate response PDFs asynchronously and cache final artifacts.

### Generated Documents and Templates

- Dynamic import rich text editors and template builders.
- Split preview/test endpoints from list/detail endpoints.
- Cache template partial lists and placeholder definitions.
- Avoid loading full company/contact detail graphs for preview unless the template actually references those fields.
- Precompute placeholder dependency lists for each template.
- Move PDF export to background jobs for large documents.

### Processing Detail and PDF Review

- Load the document shell first, then pages, revisions, line items, tags, links, and AI data separately.
- Load only visible PDF pages and nearby pages.
- Cache rendered page images and thumbnails.
- Avoid loading all line items until the line-item tab/editor is visible.
- Keep document navigation lightweight: IDs and labels only.
- Prefer optimistic UI for tag/link edits instead of invalidating full document detail.

### Tasks And Pipelines

- Keep the Tasks list response limited to task metadata, its immutable pipeline snapshot summary, and ordered stage status/icons.
- Fetch full stage detail, blockers, launch context, checklist, and authoritative outcome only when the centered stage modal opens.
- Keep pipeline list payloads compact and load the current version detail only in the builder.
- Preserve narrow TanStack Query invalidation so metadata, status, and stage mutations do not reload unrelated workspaces.

### Admin and Maintenance

- Remove tenant admin pages if tenant removal is accepted.
- Keep backup/restore, purge, connector management, roles, and audit logs out of the common dashboard bundle.
- Admin pages can tolerate lazy loading and secondary fetches more than daily workflow pages.
- Audit logs should use cursor pagination and narrow selects.
- Backup/export operations should always be background jobs.

## Implementation Discipline

For each optimization task:

1. Identify the user-visible workflow and current bottleneck.
2. Record baseline metrics.
3. Delete obsolete code first when safe.
4. Make the smallest clean architectural change that removes the bottleneck.
5. Add or update focused tests.
6. Re-measure and record the result.
7. Remove migration shims and temporary code once the data transition is complete.

Avoid these outcomes:

- A new abstraction that preserves all old tenant modes under a new name.
- A "fast path" added beside the old slow path without deleting the slow path.
- A public route that imports dashboard providers or internal hooks.
- A list endpoint that slowly grows into another detail endpoint.
- A background job that still runs inside a GET request.
- Permanent compatibility code after the product decision has changed.

## Suggested Measurement Plan

Before and after each optimization, measure:

- Browser network waterfall for `/companies`, `/processing`, `/contacts`, `/forms`, `/esigning`.
- Number of requests before first useful render.
- JS bundle size for the dashboard layout and top pages.
- Server timing per API endpoint.
- Database query timings with Prisma slow query logging and Postgres `EXPLAIN ANALYZE` on slow endpoints.

The most useful first metric is request count on a cold visit to `/companies` and `/processing`. Those pages currently show the clearest request fan-out patterns.

## Files Most Worth Editing First

- `src/app/(dashboard)/layout.tsx`
- `src/hooks/use-auth.ts`
- `src/hooks/use-permissions.ts`
- `src/components/ui/company-selector.tsx`
- `src/hooks/use-all-company-options.ts`
- `src/hooks/use-all-contact-options.ts`
- `src/services/company.service.ts`
- `src/app/api/processing-documents/route.ts`
- `src/services/document-processing.service.ts`
- `src/components/ui/navigation-progress.tsx`
- `src/app/providers.tsx`
