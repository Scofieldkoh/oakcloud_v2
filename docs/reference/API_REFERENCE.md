# API Reference

> **Last Updated**: 2026-09-29
> **Audience**: Developers

This document provides a comprehensive reference for all API endpoints in the Oakcloud application.

## Related Documents

- [RBAC Guideline](../guides/RBAC_GUIDELINE.md) - Authentication and permissions
- [Database Schema](./DATABASE_SCHEMA.md) - Tables and relationships
- [Service Patterns](../guides/SERVICE_PATTERNS.md) - Service layer conventions

## Base URL

All API endpoints are prefixed with `/api/`.

## Authentication

Most endpoints require authentication via JWT token stored in an `auth-token` httpOnly cookie. Endpoints are protected based on user roles:

- **Public** - No authentication required
- **Authenticated** - Any logged-in user
- **TENANT_ADMIN** - Tenant administrator role
- **SUPER_ADMIN** - Super administrator role (cross-tenant access)

---

## Table of Contents

1. [Authentication](#authentication-endpoints)
2. [Tenants](#tenant-endpoints)
3. [Companies](#company-endpoints)
4. [Forms](#forms-endpoints)
5. [Tasks and Pipelines](#tasks-and-pipelines-endpoints)
6. [Contacts](#contact-endpoints)
7. [Documents (Uploaded)](#uploaded-document-endpoints)
8. [Processing Documents](#processing-document-endpoints)
9. [Document Templates](#document-template-endpoints)
10. [Template Partials](#template-partial-endpoints)
11. [Generated Documents](#generated-document-endpoints)
12. [Document Sharing](#document-sharing-endpoints)
13. [Connectors (AI)](#connector-endpoints)
14. [AI Features](#ai-endpoints)
15. [Audit Logs](#audit-log-endpoints)
16. [Exchange Rates](#exchange-rate-endpoints)
17. [Admin](#admin-endpoints)
18. [User Preferences](#user-preference-endpoints)
19. [Document Tags](#document-tags-endpoints)
20. [Business Assistant](#business-assistant-endpoints)

---

## Authentication Endpoints

### POST /api/auth/login
Authenticate a user and create a session.

**Request Body:**
```json
{
  "email": "string",
  "password": "string"
}
```

**Response:** `200 OK`
```json
{
  "user": {
    "id": "string",
    "email": "string",
    "firstName": "string",
    "lastName": "string",
    "tenantId": "string | null",
    "isSuperAdmin": "boolean",
    "isWorkspaceAdmin": "boolean"
  },
  "requiresPasswordChange": "boolean"
}
```

---

### POST /api/auth/logout
Log out the current user and clear session.

**Response:** `200 OK`
```json
{
  "success": true
}
```

---

### GET /api/auth/session
Get the current authenticated user's session and effective permissions in one response. Pass `companyId` as a query parameter only when a company-scoped permission view is required.

**Response:** `200 OK`
```json
{
  "user": {
    "id": "string",
    "email": "string",
    "firstName": "string",
    "lastName": "string",
    "tenantId": "string | null",
    "isSuperAdmin": "boolean",
    "isWorkspaceAdmin": "boolean",
    "companyIds": ["string"]
  },
  "permissions": ["string"],
  "isSuperAdmin": "boolean",
  "isWorkspaceAdmin": "boolean"
}
```

---

### POST /api/auth/change-password
Change the authenticated user's password.

**Request Body:**
```json
{
  "currentPassword": "string",
  "newPassword": "string",
  "confirmPassword": "string"
}
```

**Response:** `200 OK`
```json
{
  "success": true,
  "message": "Password changed successfully"
}
```

---

### POST /api/auth/forgot-password
Request a password reset email.

**Request Body:**
```json
{
  "email": "string"
}
```

**Response:** `200 OK`
```json
{
  "success": true,
  "message": "If an account exists, a reset email has been sent"
}
```

---

### POST /api/auth/reset-password
Reset password using a token.

**Request Body:**
```json
{
  "token": "string",
  "password": "string",
  "confirmPassword": "string"
}
```

**Response:** `200 OK`
```json
{
  "success": true,
  "message": "Password reset successfully"
}
```

---

## Tenant Endpoints

### GET /api/tenants
List all tenants. **SUPER_ADMIN only.**

**Query Parameters:**
- `page` (number, default: 1)
- `limit` (number, default: 20)
- `query` (string, optional) - Search by name or slug

**Response:** `200 OK`
```json
{
  "tenants": [...],
  "total": "number",
  "page": "number",
  "limit": "number",
  "totalPages": "number"
}
```

---

### POST /api/tenants
Create a new tenant. **SUPER_ADMIN only.**

**Request Body:**
```json
{
  "name": "string",
  "slug": "string",
  "maxUsers": "number",
  "maxCompanies": "number"
}
```

---

### GET /api/tenants/[id]
Get a specific tenant.

---

### PUT /api/tenants/[id]
Update a tenant.

---

### DELETE /api/tenants/[id]
Soft-delete a tenant.

---

### GET /api/tenants/[id]/stats
Get tenant statistics (users, companies, documents count).

---

### POST /api/tenants/[id]/setup
Initial tenant setup (create admin user).

---

### GET /api/tenants/[id]/users
List users in a tenant. **TENANT_ADMIN or SUPER_ADMIN.**

**Query Parameters:**
- `page` (number, default: 1)
- `limit` (number, default: 20)
- `query` (string, optional)
- `role` (string, optional)
- `company` (string, optional)
- `sortBy` (string, optional) - One of: `firstName`, `lastName`, `email`, `isActive`, `lastLoginAt`, `createdAt` (default: `createdAt`)
- `sortOrder` ('asc' | 'desc', default: 'desc')

---

### GET /api/tenants/[id]/users/[userId]
Get a specific user.

---

### PUT /api/tenants/[id]/users/[userId]
Update a user.

---

### DELETE /api/tenants/[id]/users/[userId]
Deactivate/delete a user.

---

### GET /api/tenants/[id]/roles
List roles in a tenant.

---

### POST /api/tenants/[id]/roles
Create a new role.

---

### GET /api/tenants/[id]/roles/[roleId]
Get a specific role.

---

### PUT /api/tenants/[id]/roles/[roleId]
Update a role.

---

### DELETE /api/tenants/[id]/roles/[roleId]
Delete a role.

---

### POST /api/tenants/[id]/roles/[roleId]/duplicate
Duplicate a role.

---

### GET /api/tenants/[id]/roles/[roleId]/users
List users assigned to a role.

---

## Company Endpoints

### GET /api/companies
Compatibility list endpoint for companies accessible to the user. New list-page reads should use `/api/companies/list`.

**Query Parameters:**
- `page` (number, default: 1)
- `limit` (number, default: 20)
- `query` (string, optional) - Search by name, UEN, SSIC
- `entityType` (string, optional)
- `status` (string, optional)
- `sortBy` (string, default: 'name')
- `sortOrder` ('asc' | 'desc', default: 'asc')

---

### GET /api/companies/list
Lean paginated company table endpoint.

**Query Parameters:**
- `page` (number, default: 1)
- `limit` (number, default: 20)
- `query` / `q` (string, optional)
- `uen`, `address`, `entityType`, `status`, `hasCharges` (optional filters)
- `sortBy`, `sortOrder` (optional sorting)

---

### GET /api/companies/options
Searchable capped company option endpoint for selectors.

**Query Parameters:**
- `q` / `query` (string, optional)
- `limit` (number, max: 50)

---

### POST /api/companies
Create a new company.

**Request Body:**
```json
{
  "uen": "string",
  "name": "string",
  "entityType": "PRIVATE_LIMITED | PUBLIC_LIMITED | ...",
  "status": "LIVE | STRUCK_OFF | ...",
  "incorporationDate": "string (ISO date)",
  ...
}
```

---

### GET /api/companies/stats
Get company statistics for the tenant.

---

### GET /api/companies/summary
Get company summary counts for list/dashboard surfaces.

---

### GET /api/companies/[id]
Compatibility detail endpoint. New read callers should use `/api/companies/[id]/detail`.

---

### GET /api/companies/[id]/detail
Get a specific company. Pass `full=true` for full detail relations.

---

### PUT /api/companies/[id]
Update a company.

---

### DELETE /api/companies/[id]
Soft-delete a company.

**Request Body:**
```json
{
  "reason": "string"
}
```

---

### GET /api/companies/[id]/audit
Get audit logs for a company.

---

### GET /api/companies/[id]/links
Get link information (counts of officers, shareholders, etc.).

---

### GET /api/companies/[id]/documents
List documents uploaded for a company.

---

### GET /api/companies/[id]/document-parties
List the current directors, current shareholders, active linked contacts, and
current officers of every role (secretary, CEO, auditor...; `detail` is the role
in words) that can be selected while generating a document for the company.
Officers feed the Word `repeat.officers` repeater, which prints only the officers
ticked on Configure (`selectedOfficerIds`, in that order). An officers repeater
can be limited to roles in its tag: `repeat.officers.<role-slug>[+<role-slug>...]`,
where the slug is the `role` in lower case with hyphens (`secretary`,
`managing-director`, `ceo`), in registry order, e.g. `repeat.officers.secretary+ceo`.
Configure then lists only officers of those roles (all officers repeaters in a
document together; any role when one of them is `repeat.officers`), and each
repeater prints only the ticked officers of its own roles.
Each officer record is one appointment, so Configure and Shared setup list a
person once (records of one contact, else one identification number, else one
name; `src/lib/officer-identity.ts`). A person holding more than one of the
offered roles gets a role dropdown, and the others show their role as text; the
ticked id is the record of the chosen role, so changing the role swaps that id
in place and `officer.role` prints it. A person is never ticked twice: a saved
`selectedOfficerIds` with two records of one person keeps the first, on
Configure and when generating.

**Auth:** Authenticated with `document:read`

**Response:** `200 OK`
```json
{
  "directors": [{ "id": "uuid", "name": "string", "email": "string | null", "phone": "string | null", "address": { "full": "string | null", "letter": "string | null" } }],
  "shareholders": [{ "id": "uuid", "name": "string", "email": "string | null", "phone": "string | null", "address": { "full": "string | null", "letter": "string | null" } }],
  "contacts": [{ "id": "uuid", "name": "string", "email": "string | null", "phone": "string | null", "address": { "full": "string | null", "letter": "string | null" } }],
  "officers": [{ "id": "uuid", "name": "string", "detail": "Secretary", "role": "SECRETARY", "email": "string | null", "phone": "string | null", "address": { "full": "string | null", "letter": "string | null" } }]
}
```

---

### GET /api/companies/[id]/officers/[officerId]
Get/update an officer.

---

### PUT /api/companies/[id]/officers/[officerId]
Update officer details.

**Request Body:**
```json
{
  "appointmentDate": "string (ISO date) | null",
  "cessationDate": "string (ISO date) | null"
}
```

---

### DELETE /api/companies/[id]/officers/[officerId]
Remove an officer (mark as ceased).

---

### GET /api/companies/[id]/shareholders/[shareholderId]
Get/update a shareholder.

---

### PUT /api/companies/[id]/shareholders/[shareholderId]
Update shareholder details.

---

### DELETE /api/companies/[id]/shareholders/[shareholderId]
Remove a shareholder.

---

### GET /api/companies/[id]/notes
List internal notes for a company.

---

### POST /api/companies/[id]/notes
Create an internal note.

---

### GET /api/companies/[id]/notes/[tabId]
Get notes for a specific tab.

---

### PUT /api/companies/[id]/notes/[tabId]
Update a note.

---

### DELETE /api/companies/[id]/notes/[tabId]
Delete a note.

---

### POST /api/companies/bulk
Bulk operations on companies.

---

## Forms Endpoints

Forms admin routes reuse the existing `document:*` permission surface. Public form routes are unauthenticated, slug-scoped, rate-limited, and token-guarded where required.

### GET /api/forms
List forms for the active tenant.

**Auth:** Authenticated with `document:read`

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `query` | string | Optional title search |
| `status` | `DRAFT \| PUBLISHED \| ARCHIVED` | Optional status filter |
| `page` | number | Default `1` |
| `limit` | number | Default `20`, max `100` |
| `sortBy` | `createdAt \| updatedAt \| title` | Default `updatedAt` |
| `sortOrder` | `asc \| desc` | Default `desc` |
| `tenantId` | string | Optional SUPER_ADMIN tenant scope |

**Response:** `200 OK`

```json
{
  "forms": [
    {
      "id": "uuid",
      "title": "Client Intake Form",
      "slug": "6f4a1f6f7e51f3d0",
      "status": "PUBLISHED",
      "fieldCount": 14,
      "responseCount": 37,
      "conversionRate": 52.9
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 20,
  "totalPages": 1
}
```

---

### POST /api/forms
Create a blank form draft, or a draft from a guided template.

**Auth:** Authenticated with `document:create`

**Request Body:**

```json
{
  "title": "Client Intake Form",
  "description": "Optional description",
  "tags": ["intake", "client"],
  "status": "DRAFT",
  "tenantId": "uuid (optional for SUPER_ADMIN)"
}
```

The Singapore Company Incorporation form is not created here; it is seeded with `npx tsx scripts/seed-incorporation-form.ts --email <login>`, which also writes the server-owned `settings.template` binding.

**Response:** `201 Created`

---

### GET /api/forms/[id]
Get a form detail payload including fields and tenant branding data.

**Auth:** Authenticated with `document:read`

---

### PATCH /api/forms/[id]
Update form metadata, settings, and/or fields.

**Auth:** Authenticated with `document:update`

**Request Body Notes:**

- Metadata keys supported: `title`, `description`, `status`, `tags`, `slug`, `settings`
- Field updates are sent as `fields: FormFieldInput[]`
- A linked dropdown sends `optionPresetId` and may omit embedded `options`. Form reads resolve the preset's latest `{ value, label }` options, so replacing a preset updates every linked form without rewriting the form.
- Embedded custom dropdowns support at most 5,000 options.
- `reason` is optional and is recorded in audit logs
- `settings.template` is server-owned: a client value is ignored and the stored binding is kept. The first publish of a template form sets `lockedAt` and `definitionHash`; after that, `fields` updates are rejected with `400` (duplicate the form to change questions; the copy has no binding).
- `settings.notifications.attachmentMode` is `attachments` (default) or `link_only`. Link-only completion emails carry a link to the response and no PDF or uploads.

---

### GET /api/forms/presets
List option presets for the active tenant, including the protected Countries, Nationalities, and SSIC lists and each preset's current usage count.

**Auth:** Authenticated with `document:read`

**Query Parameters:**

- `tenantId` (optional SUPER_ADMIN tenant scope)

---

### POST /api/forms/presets
Preview a CSV import or create a tenant-scoped dropdown preset.

**Auth:** Authenticated with `document:update`

**Request Body:**

```json
{
  "name": "Industry codes",
  "csv": "value,label\n01111,Growing of leafy and fruit vegetables",
  "preview": false,
  "tenantId": "uuid (optional for SUPER_ADMIN)"
}
```

Set `preview` to `true` to validate without saving. Preview and validation responses report detected columns, total/valid/rejected rows, row-level errors, and a five-row sample.

CSV imports must be UTF-8, no larger than 5 MB, and contain at most 5,000 valid rows. Accepted headers are `label` or `value,label` (case-insensitive). A label-only import uses each label as its submitted value.

---

### PATCH /api/forms/presets/[id]
Rename a preset and/or replace its options with validated CSV content.

**Auth:** Authenticated with `document:update`

Countries and Nationalities are protected from replacement. SSIC is protected from deletion but can be replaced with a newer CSV. Replacing any allowed preset takes effect immediately for linked form fields.

---

### DELETE /api/forms/presets/[id]
Delete a custom preset.

**Auth:** Authenticated with `document:update`

Protected built-ins cannot be deleted. A custom preset referenced by any active or archived form must be unlinked before deletion.

---

### DELETE /api/forms/[id]
Archive a form.

**Auth:** Authenticated with `document:delete`

**Query Parameters:**

- `tenantId` (optional)
- `reason` (optional)

---

### POST /api/forms/[id]/duplicate
Duplicate an existing form.

**Auth:** Authenticated with `document:create`

**Request Body:**

```json
{
  "title": "Optional duplicate title",
  "tenantId": "uuid (optional for SUPER_ADMIN)"
}
```

**Response:** `201 Created`

---

### GET /api/forms/recent-submissions
Get the most recent completed submissions across the active tenant.

**Auth:** Authenticated with `document:read`

**Query Parameters:**

- `limit` (number, default `8`)
- `tenantId` (optional)

---

### GET /api/forms/warnings
Get forms that currently have unresolved AI review warnings.

**Auth:** Authenticated with `document:read`

**Query Parameters:**

- `limit` (number, default `8`)
- `tenantId` (optional)

---

### GET /api/forms/url-health
List forms in the active tenant that have one or more URL information fields with an active broken-link warning.

**Auth:** Authenticated with `document:read`

**Query Parameters:**

- `tenantId` (optional SUPER_ADMIN tenant scope)

Warnings are administrative only: they appear on authenticated Forms surfaces and are never included in public form payloads. A warning activates after two consecutive definite failures and clears after a healthy check. Unverifiable responses do not activate or advance a warning.

---

### GET /api/forms/[id]/url-health
Get the URL-check records for one form in the active tenant, including field key, checked URL, classification, last status/error, consecutive failures, check timestamps, and warning activation time.

**Auth:** Authenticated with `document:read`

**Query Parameters:**

- `tenantId` (optional SUPER_ADMIN tenant scope)

Classifications use these rules:

- `HEALTHY`: HTTP 2xx or a successfully followed redirect ending in 2xx.
- `FAILED`: DNS, connection, timeout, malformed redirect, redirect-limit, 404/410, or other definite 4xx/5xx failures.
- `UNVERIFIABLE`: 401, 403, or 429; these do not increase consecutive failures or activate a warning.

The checker accepts HTTP/HTTPS only, rejects credentials and non-public DNS/IP results, pins the resolved public address, follows at most five revalidated redirects, applies a 10-second timeout per request, uses `HEAD` with `GET` fallback only for 405/501, and reads at most 64 KB from fallback responses. Each scheduled run checks at most 500 URLs with concurrency limited to five.

---

### GET /api/forms/[id]/responses
Get paginated submissions, drafts, and chart data for one form.

**Auth:** Authenticated with `document:read`

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `page` | number | Submission page, default `1` |
| `limit` | number | Submission page size, default `20`, max `200` |
| `draftPage` | number | Draft page, default `1` |
| `draftLimit` | number | Draft page size, default `20`, max `200` |
| `submissionSortBy` | string | Optional summary/status/submitted sort key |
| `submissionSortOrder` | `asc \| desc` | Default `desc` |
| `submissionFilters` | JSON string | Optional per-column submission filters |
| `tenantId` | string | Optional SUPER_ADMIN tenant scope |

---

### GET /api/forms/[id]/responses/[submissionId]
Get one submission and its uploads.

**Auth:** Authenticated with `document:read`

---

### GET /api/forms/[id]/responses/[submissionId]/incorporation-review
Staff preparation checklist for a Singapore Company Incorporation response: the stored intake record, people (roster rows plus staff-added people), KYC links with staleness, checklist decisions and readiness.

**Auth:** Authenticated with `document:read`

**Query Parameters:**

- `tenantId` (optional for SUPER_ADMIN)
- `sourceQuery` (optional, 2+ characters): search other responses in the workspace by respondent name, email or form title to link as a KYC source

Returns `400` when the response is not a company incorporation submission.

---

### PATCH /api/forms/[id]/responses/[submissionId]/incorporation-review
Apply one checklist change. Every request carries `expectedRevision`; a stale revision returns `409`.

**Auth:** Authenticated with `document:update`

**Actions:**

- `set_decision`: `areaKey`, `state` (`pending`, `satisfied`, `not_applicable`), optional `note`. Only "Intake items resolved" may be not applicable.
- `link_kyc`: `subjectId`, `sourceKind` (`form_submission` with `sourceId`, or `manual` with `manualLocation`), `coverage` (particular keys to true/false), `reviewState` (`received`, `verified`, `needs_follow_up`), optional `notes`. A linked response must be in the same workspace; its `updatedAt` is stored, and a later change marks the link stale.
- `unlink_kyc`: `subjectId`
- `add_subject`: `name`, `kind` (`individual`, `organisation`), `roles` (secretary, ceo, controller, nominator, authorised_representative, other)
- `remove_subject`: `subjectId` (staff-added people only)

Readiness is internal: "Ready for filing preparation" means every area is confirmed and each person has a current, verified KYC source covering every particular. It is not ACRA approval and nothing is filed.

---

### DELETE /api/forms/[id]/responses/[submissionId]
Delete one submission and its linked uploads.

**Auth:** Authenticated with `document:delete`

**Query Parameters:**

- `tenantId` (optional)
- `reason` (optional)

---

### GET /api/forms/[id]/responses/[submissionId]/uploads/[uploadId]
Download or inline-preview a submission upload.

**Auth:** Authenticated with `document:read`

**Query Parameters:**

- `tenantId` (optional)
- `disposition` (`attachment` or `inline`, default `attachment`)

---

### DELETE /api/forms/[id]/responses/[submissionId]/uploads/[uploadId]
Delete a single submission upload.

**Auth:** Authenticated with `document:delete`

---

### GET /api/forms/[id]/responses/export
Export all form responses as CSV.

**Auth:** Authenticated with `document:read`

**Query Parameters:**

- `tenantId` (optional)

---

### GET /api/forms/[id]/responses/[submissionId]/export/pdf
Export an internal PDF copy of a submission.

**Auth:** Authenticated with `document:read`

**Query Parameters:**

- `tenantId` (optional)

---

### POST /api/forms/[id]/responses/[submissionId]/ai-review
Queue a submission for internal AI review.

**Auth:** Authenticated with `document:update`

**Request Body:**

```json
{
  "tenantId": "uuid (optional for SUPER_ADMIN)",
  "reason": "Manual AI review rerun"
}
```

---

### POST /api/forms/[id]/responses/[submissionId]/ai-review/resolve
Resolve the latest unresolved AI warning on a submission.

**Auth:** Authenticated with `document:update`

**Request Body:**

```json
{
  "tenantId": "uuid (optional for SUPER_ADMIN)",
  "reason": "Reviewed by compliance"
}
```

---

### POST /api/forms/[id]/responses/[submissionId]/ai-review/attachment-check
Run an attachment-only AI diagnostic using the same attachment pipeline as full review.

**Auth:** Authenticated with `document:update`

---

### GET /api/forms/[id]/drafts/[draftId]
Get a saved draft entry and its uploads.

**Auth:** Authenticated with `document:read`

---

### DELETE /api/forms/[id]/drafts/[draftId]
Delete a saved draft entry.

**Auth:** Authenticated with `document:delete`

---

### GET /api/forms/[id]/drafts/[draftId]/uploads/[uploadId]
Download or inline-preview a draft upload.

**Auth:** Authenticated with `document:read`

**Query Parameters:**

- `tenantId` (optional)
- `disposition` (`attachment` or `inline`, default `attachment`)

---

### POST /api/forms/[id]/ai-context-assist
Turn rough notes into a structured custom context for Forms AI review.

**Auth:** Authenticated with `document:update`

---

### POST /api/forms/[id]/translations/ai
Generate translated form text for a locale.

**Auth:** Authenticated with `document:update`

---

### POST /api/forms/cleanup-uploads
Delete orphaned form uploads and expired drafts.

**Auth:** SUPER_ADMIN only

**Request Body:**

```json
{
  "maxAgeHours": 24
}
```

---

### GET /api/forms/public/[slug]
Get the published public form definition.

**Auth:** Public

**Response Notes:**

- Returns public field definitions, branding (`tenantLogoUrl`, `tenantName`), and filtered settings used by the public runtime.
- Public form views are rate-limited with `FORM_VIEW`.

---

### POST /api/forms/public/[slug]/uploads
Upload a file for a public form field.

**Auth:** Public

**Request:** `multipart/form-data`

| Field | Type | Description |
|-------|------|-------------|
| `file` | File | File content |
| `fieldKey` | string | Form field key |

**Response:** `201 Created`

```json
{
  "id": "uuid",
  "fieldId": "uuid",
  "fileName": "passport.pdf",
  "mimeType": "application/pdf",
  "sizeBytes": 48213
}
```

---

### POST /api/forms/public/[slug]/drafts
Create or update a public draft save.

**Auth:** Public

**Request Body:**

```json
{
  "answers": {},
  "uploadIds": ["uuid"],
  "draftCode": "Ab123",
  "accessToken": "optional existing token",
  "metadata": {
    "locale": "en"
  }
}
```

**Response:** `201 Created`

```json
{
  "draftCode": "Ab123",
  "accessToken": "token",
  "resumeUrl": "https://app/forms/f/form-slug?draft=Ab123&resume=token",
  "expiresAt": "2026-03-25T12:00:00.000Z",
  "savedAt": "2026-03-11T12:00:00.000Z"
}
```

---

### GET /api/forms/public/[slug]/drafts/[draftCode]
Resume a public draft.

**Auth:** Public

**Query Parameters:**

- `token` (required) - draft access token

---

### POST /api/forms/public/[slug]/drafts/[draftCode]/email
Email a public draft resume link.

**Auth:** Public

**Request Body:**

```json
{
  "email": "user@example.com",
  "accessToken": "draft access token"
}
```

---

### POST /api/forms/public/[slug]/submit
Submit a public form response.

**Auth:** Public

**Request Body:**

```json
{
  "respondentName": "Jane Doe",
  "respondentEmail": "jane@example.com",
  "answers": {},
  "uploadIds": ["uuid"],
  "draftCode": "Ab123",
  "accessToken": "optional draft token",
  "metadata": {
    "locale": "en"
  }
}
```

**Response:** `201 Created`

```json
{
  "id": "uuid",
  "submittedAt": "2026-03-11T12:34:56.000Z",
  "pdfDownloadToken": "jwt",
  "pdfDownloadTokenTtlSeconds": 1800,
  "pdfEmailAccessToken": "jwt",
  "pdfEmailAccessTokenTtlSeconds": 1800
}
```

---

### GET /api/forms/public/[slug]/submissions/[submissionId]/pdf
Download the public response PDF.

**Auth:** Public

**Query Parameters:**

- `token` (required) - signed download token

---

### POST /api/forms/public/[slug]/submissions/[submissionId]/email
Email a tokenized public response PDF link.

**Auth:** Public

**Request Body:**

```json
{
  "email": "user@example.com",
  "accessToken": "pdf email access token"
}
```

---

## Tasks And Pipelines Endpoints

All routes require authentication and derive tenant scope from the current workspace session. A caller-supplied `tenantId` is ignored.

### GET /api/task-pipelines
List active pipeline templates. `includeArchived=true` includes archived templates.

### POST /api/task-pipelines
Create and publish pipeline version 1. The body contains `name`, optional `description`, and ordered `stages`. Each stage contains `name`, optional `description`, `actionType`, curated `icon`, `isRequired`, adapter-specific `actionConfig`, and optional checklist definitions.

### GET /api/task-pipelines/[id]
Get a tenant-owned pipeline and its versions/stages.

### PATCH /api/task-pipelines/[id]
Update pipeline metadata and publish a new immutable version for future tasks.

### DELETE /api/task-pipelines/[id]
Archive a pipeline with `{ "reason": "..." }`.

### POST /api/task-pipelines/[id]/duplicate
Duplicate the current published structure. The optional body field `name` overrides the generated copy name.

### GET /api/tasks
Search active tasks.

**Query Parameters:**
- `q` - title/description search
- `pipeline`, `company`, `owner` - relation UUID filters
- `status` - `NOT_STARTED`, `IN_PROGRESS`, `PAUSED`, `COMPLETED`, or `CANCELLED`
- `dueBucket` - `overdue`, `today`, `thisWeek`, or `nextWeek`; tasks without due dates never match
- `page`, `limit`, `sortBy`, `sortOrder` - validated pagination and sorting

### POST /api/tasks
Create a task from a published immutable pipeline version. Only `title` and `pipelineVersionId` are required; `description`, `companyId`, `ownerId`, and `dueDate` are optional.

### GET /api/tasks/[taskId]
Get task detail after authoritative stage reconciliation.

### PATCH /api/tasks/[taskId]
Update task metadata without altering its snapshotted stage structure.

### DELETE /api/tasks/[taskId]
Soft-delete a task with `{ "reason": "..." }`.

### POST /api/tasks/[taskId]/status
Apply `{ "action": "pause" | "resume" | "cancel" }`.

### GET /api/tasks/[taskId]/stages/[stageId]
Get stage detail, checklist, blockers, launch context, linked outcome summary, and reconciled status.

### PATCH /api/tasks/[taskId]/stages/[stageId]
Update optional assignee, notes, and other stage metadata.

### POST /api/tasks/[taskId]/stages/[stageId]/transition
Apply a validated `complete`, `reopen`, `skip`, `checklist`, `linkOutcome`, or `reconcile` transition. Manual completion is restricted to manual stages. Reopen is available for manual stages and for skipped integrated stages so the authoritative module can resume reconciliation. Required stages cannot be skipped.

---

## Contact Endpoints

### GET /api/contacts
List contacts.

---

### POST /api/contacts
Create a new contact.

**Auth:** `contact:create`. Manual and quick-create callers can preview identity first. A caller may explicitly choose `CREATE_SEPARATE` when two legitimate contacts share a name; deterministic identifier conflicts are still rejected.

---

### GET /api/contacts/[id]
Get a specific contact.

---

### PUT /api/contacts/[id]
Update a contact.

---

### DELETE /api/contacts/[id]
Soft-delete a contact.

---

### GET /api/contacts/[id]/audit
Get audit logs for a contact.

---

### GET /api/contacts/[id]/links
Get linked companies/officers/shareholders.

---

### GET /api/contacts/[id]/notes
List internal notes for a contact.

---

### POST /api/contacts/[id]/notes
Create an internal note.

---

### POST /api/contacts/bulk
Bulk operations on contacts.

---

### Contact Identity and Duplicate Controls

Identity operations are tenant-scoped. Names use Unicode NFKC normalization and case folding; deterministic matches use only validated, unmasked IDs/UENs. Low-confidence or masked values can inform review but never become deterministic match keys.

### POST /api/contacts/match-preview
Preview matches for up to 100 contact candidates before a write. Requires `contact:read`. Each candidate supplies a unique `sourceRecordId`, a `source` (`MANUAL`, `COMPANY_QUICK_CREATE`, `BIZFILE`, or `DOCUMENT_VAULT`), contact type, name fields, and optional identifiers, address, details, and per-field confidence. The response is `{ "matches": { "<sourceRecordId>": matchOrNull } }`; a match includes reasons and the tenant contact summary.

### GET /api/contacts/duplicates
List bounded duplicate groups, ordered and paginated with `page` (default `1`) and `limit` (default `20`, maximum `100`). Requires `contact:read` and all-companies access. Recommendations combine canonical-name, normalized deterministic-identifier, and bounded trigram candidates, exclude inactive/deleted contacts, and suppress a rejected pair only while its reviewed fingerprints remain current.

### POST /api/contacts/duplicates/reject
Dismiss a recommendation. Requires `contact:update` plus all-companies access or workspace-admin authority.

```json
{
  "leftContactId": "uuid",
  "rightContactId": "uuid",
  "leftFingerprint": "64-character SHA-256",
  "rightFingerprint": "64-character SHA-256",
  "reason": "At least 10 characters"
}
```

Returns `409` when the supplied fingerprints are stale. The decision remains auditable and automatically ceases to suppress the pair after either identity changes.

### POST /api/contacts/merge
Atomically merge one or more sources into a master. Requires `contact:update` plus all-companies access or workspace-admin authority. The body includes an `idempotencyKey`, distinct master/source UUIDs, `expectedUpdatedAt` and SHA-256 `expectedFingerprints` entries for every contact, and explicit `fieldDecisions`. Stale snapshots return `409`.

The transaction moves every supported reference to the master, verifies no source references remain, writes the immutable merge ledger and audit entry, then hard-deletes the approved source contacts. Retrying the same tenant/idempotency key returns the recorded result and does not repeat the merge.

---

## Uploaded Document Endpoints

### POST /api/documents/upload
Upload a document (BizFile, etc.).

**Request:** `multipart/form-data`
- `file`: The document file
- `companyId`: Target company ID
- `documentType`: Type of document

---

### GET /api/documents/[documentId]/confirm
Confirm document upload.

---

### POST /api/documents/[documentId]/extract
Extract data from document using AI.

---

### GET /api/documents/[documentId]/preview-diff
Preview differences between extracted data and current company data.

---

### POST /api/documents/[documentId]/apply-update
Apply extracted data to company.

---

## Processing Document Endpoints

### GET /api/processing-documents
List processing documents with filters and pagination.

**Query Parameters:**
- `page` (number, default: 1)
- `limit` (number, default: 20)
- `sortBy` (string, default: `createdAt`)
- `sortOrder` ('asc' | 'desc', default: 'desc')
- `pipelineStatus` (string, optional) - Filter by pipeline status
- `duplicateStatus` (string, optional) - Filter by duplicate status
- `revisionStatus` (string, optional) - Filter by revision status
- `needsReview` (boolean, optional) - Needs review (draft, suspected duplicate, or warnings/invalid)
- `isContainer` (boolean, optional) - Filter by container/child type
- `companyId` (string, optional) - Filter by company
- `tenantId` (string, optional) - SUPER_ADMIN: tenant scope
- `uploadDatePreset` ('TODAY', optional) - Uses tenant timezone
- `uploadDateFrom` (string, optional) - `YYYY-MM-DD` or ISO datetime
- `uploadDateTo` (string, optional) - `YYYY-MM-DD` or ISO datetime
- `documentDateFrom` (string, optional) - `YYYY-MM-DD` or ISO datetime
- `documentDateTo` (string, optional) - `YYYY-MM-DD` or ISO datetime
- `search` (string, optional) - General search (file name, vendor name, document number)
- `vendorName` (string, optional)
- `documentNumber` (string, optional)
- `fileName` (string, optional)
- `tagIds` (string, optional) - Comma-separated tag IDs

---

### GET /api/processing-documents/navigation
Get prev/next navigation within a filtered processing document set (used by “Review Next” and detail page navigation).

**Query Parameters:**
- `filter` ('needs-review' | 'all', default: 'needs-review')
- `start` (boolean, default: false) - When true, returns the first item in the set
- `currentDocumentId` (string, required unless `start=true`)
- `companyId` (string, optional) - Filter by company
- `tenantId` (string, required for SUPER_ADMIN)

**Response:** `200 OK`
```json
{
  "total": "number",
  "currentIndex": "number",
  "currentDocumentId": "string | null",
  "prevId": "string | null",
  "nextId": "string | null"
}
```

---

### POST /api/processing-documents
Upload document for processing.

**Request:** `multipart/form-data`
- `file`: The document file (PDF, images)
- `companyId`: Target company ID

---

### GET /api/processing-documents/[id]
Get a specific processing document with current revision.

---

### GET /api/processing-documents/[id]/download
Download the original document file.

**Response:** Binary file stream with appropriate Content-Type and Content-Disposition headers.

---

### GET /api/processing-documents/[id]/export
Export document details to Excel.

**Query Parameters:**
- `includeLinked` (boolean, default: false) - Include linked documents in export

**Response:** Excel file (.xlsx) with two worksheets:
- **Document Headers**: File name, status, category, vendor, amounts, dates, etc.
- **Line Items**: Line items with parent document reference

---

### POST /api/processing-documents/bulk-download-zip
Bulk download multiple documents as a ZIP file.

**Request Body:**
```json
{
  "documentIds": ["string"]
}
```

**Response:** Binary ZIP file stream.

**Limits:** Maximum 100 documents per request.

---

### POST /api/processing-documents/bulk-export
Bulk export multiple documents to Excel.

**Request Body:**
```json
{
  "documentIds": ["string"]
}
```

**Response:** Excel file (.xlsx) with two worksheets:
- **Document Headers**: All selected documents' header information
- **Line Items**: All line items from selected documents

**Limits:** Maximum 100 documents per request.

---

### POST /api/processing-documents/bulk
Bulk operations on multiple documents.

**Request Body:**
```json
{
  "operation": "APPROVE | TRIGGER_EXTRACTION | DELETE",
  "documentIds": ["string"]
}
```

**Response:**
```json
{
  "results": [
    { "documentId": "string", "success": true },
    { "documentId": "string", "success": false, "error": "string" }
  ],
  "summary": {
    "total": "number",
    "succeeded": "number",
    "failed": "number"
  }
}
```

---

### POST /api/processing-documents/[id]/extract
Trigger AI field extraction.

---

### POST /api/processing-documents/[id]/lock
Acquire document lock for editing.

---

### POST /api/processing-documents/[id]/unlock
Release document lock.

---

### GET /api/processing-documents/[id]/revisions
Get revision history.

---

### POST /api/processing-documents/[id]/revisions
Create a new revision (manual edit).

---

### POST /api/processing-documents/[id]/revisions/[revId]/approve
Approve a revision.

---

### POST /api/processing-documents/[id]/duplicate-decision
Record duplicate decision.

**Request Body:**
```json
{
  "decision": "CONFIRMED | REJECTED",
  "duplicateOfId": "string (optional)"
}
```

---

## Document Template Endpoints

### GET /api/document-templates
List document templates.

---

### POST /api/document-templates
Create a new template.

**Request Body:**
```json
{
  "name": "string",
  "category": "string",
  "content": "string (HTML)",
  "placeholders": [...],
  "isActive": "boolean"
}
```

A Word (OakDoc) template is uploaded as multipart form data instead: `file`
(the .docx), `name`, `category`, `compositionType`, `description`, `isActive`
and optional `placeholders` (JSON array). Custom fields are `placeholders`
entries keyed `custom.<key>` with a `label`, `type` (text, textarea, date,
number, currency), `required` and, for a dropdown, `options`; the document
holds a `custom.<key>` field. A Contact field is stored as `type: "text"` with
`fieldKind: "contact"` and its shortlist as `options` of `{ value: contactId,
label: name }`; Configure stores the chosen contact id, `custom.<key>` prints
the name and `custom.<key>.<detail>` (`identificationNumber`, `nationality`,
`address.full`, `address.letter`, `email`, `phone`, `name`) a detail. Only a
contact on the shortlist is printed. Custom fields of inserted Word partials are
copied in on save (marked `oakDocPartialId`) so Configure asks for them too.
For a resolution document, the custom fields of the partials picked as its
numbered resolutions are added per document, on Configure and at generation.

The contacts repeater (`repeat.contacts`) can carry a shortlist: a `placeholders`
entry keyed `repeat.contacts` with `fieldKind: "contactShortlist"`,
`source`/`category` `"repeater"` and the contacts as `options` of `{ value:
contactId, label: name }`. It is not a custom field, so Configure does not ask
for it as a value. Partials' shortlists are copied in like their custom fields
(and added per document for a resolution's chosen partials); Configure offers
the template's and its partials' shortlisted contacts together as tick boxes, and
generation prints only `contactIds` on a shortlist, dropping any other id. With
no shortlist Configure searches every workspace contact, as before. The editors
drop a shortlist on save when the document no longer has a contacts repeater.

Any repeating section can be given a name when it is inserted, and renamed from
the editor's repeating-sections panel (e.g. "Signers for the resolution(s)").
The name is a label: a `placeholders` entry keyed by the repeater tag
(`repeat.directors`, `repeat.officers.secretary`, `repeat.signers`...) with
`fieldKind: "repeaterName"`, `source`/`category` `"repeater"` and the name as
its `label` (one name per tag in a template or partial). Configure then shows a
named directors, shareholders or officers picker as its own card titled with
the name instead of under "Parties" (several names of one kind, e.g. two
officers sections, are joined with " · " on the one card, since they share one
selection); a Service Agreement titles its entities and representatives card
with the names of those sections. Shared setup titles a shared picker the same
way. Selection storage does not change.

A named Contacts section is a separate list. Its tag is
`repeat.contacts.<slug>`, where the slug is the name in lower case with every
run of other characters turned into one hyphen and accents dropped, trimmed of
hyphens, at most 60 characters (`^[a-z0-9]+(-[a-z0-9]+)*$`): "Corporate
secretary to be appointed" is `repeat.contacts.corporate-secretary-to-be-appointed`.
A name needs letters or digits; names are at most 80 characters. Its
`placeholders` entry is a contact shortlist keyed by that tag and labelled with
the name (kept with no contacts too, for the name); renaming changes the label,
not the slug. Configure shows each named list as its own card titled with its
name, offering only its own shortlist (any contact without one), and stores the
ticks per list in `configuration.selectedContactListIds[slug]`; generation
prints only that list's ticked contacts, in order, dropping ids not on its
shortlist. The same name in two documents of a batch shares one Shared setup
picker; lists with different names never do. Plain `repeat.contacts` stays the
unnamed list and keeps using `contactIds`. Names and lists come from partials
like shortlists do (copied on save, added per document for a resolution's
chosen partials), and the editors drop them on save when their section is gone.

---

### GET /api/document-templates/stats
Get template statistics.

---

### GET /api/document-templates/[id]
Get a specific template.

---

### PUT /api/document-templates/[id]
Update a template. A Word template takes the same multipart fields as create
plus `expectedRevision` and `refreshPartialPins=all`; leaving out
`placeholders` keeps the stored custom fields.

---

### DELETE /api/document-templates/[id]
Delete a template.

---

### POST /api/document-templates/[id]/duplicate
Duplicate a template.

---

### POST /api/document-templates/[id]/test
Test template with sample data.

---

## Template Partial Endpoints

### GET /api/template-partials
List template partials (reusable content blocks).

---

### POST /api/template-partials
Create a new partial.

---

### GET /api/template-partials/[id]
Get a specific partial.

---

### PUT /api/template-partials/[id]
Update a partial.

---

### DELETE /api/template-partials/[id]
Delete a partial.

---

### POST /api/template-partials/[id]/duplicate
Duplicate a partial.

---

### GET /api/template-partials/[id]/usage
Get templates using this partial.

---

### PUT /api/template-partials/[id]/oakdoc
Save a new version of a Word partial (multipart: `file`, `expectedRevision`,
optional `refreshPins=all` and `placeholders` as a JSON array holding the
partial's custom fields; leaving it out keeps them).

---

## Document Generation Batch Endpoints

Batch endpoints are tenant-scoped and require the existing
`document:read`, `document:create`, `document:update`, or `document:delete`
permissions. Client bodies never include tenant/user IDs, statuses,
fingerprints, generated-document IDs, claim IDs, or diagnostics; all mutation
endpoints accept `expectedRevision` and return `409 Conflict` with
`details.currentRevision` on stale writes.

### GET /api/document-generation-batches
List active (`DRAFT`/`PARTIAL`) resumable batches. Permission: `document:read`.

### POST /api/document-generation-batches
Create a persisted batch, ordered items, and hidden child drafts. Permission:
`document:create`. When the body contains `legacyDraftId`, exactly one item is
required and the request routes to idempotent legacy-session adoption.

**Request Body:**
```json
{
  "items": [
    { "templateId": "33333333-3333-4333-8333-333333333333" },
    { "templateId": "44444444-4444-4444-8444-444444444444" }
  ]
}
```

### GET /api/document-generation-batches/[id]
Resume one batch with its derived master-field catalogue. Permission:
`document:read`.

### PUT /api/document-generation-batches/[id]
Save full shared and item state. Permission: `document:update`.

`configuration.selectedContactListIds` (optional) holds the contacts ticked for
each named contacts list of a Word template, by list slug, in order, e.g.
`{ "corporate-secretary-to-be-appointed": ["<contactId>"] }`; at most 50 lists
of 100 contacts. See the contacts repeater under the template placeholders.

For a Service Agreement item, `configuration.serviceAgreement` carries
`authorizedContactIds` and `signerContactIds` arrays. Both may be empty while
the workspace is incomplete; preview and generation require both arrays to be
non-empty, unique, and every signer ID to occur in `authorizedContactIds`.

**Request Body:**
```json
{
  "expectedRevision": 3,
  "currentStage": 2,
  "primaryCompanyId": "55555555-5555-4555-8555-555555555555",
  "activeItemId": "66666666-6666-4666-8666-666666666666",
  "masterFieldValues": { "client_name::text": "Acme Pte. Ltd." },
  "items": [
    {
      "id": "66666666-6666-4666-8666-666666666666",
      "templateId": "33333333-3333-4333-8333-333333333333",
      "displayOrder": 0,
      "configuration": {
        "version": 1,
        "title": "Engagement Letter",
        "contactIds": [],
        "selectedDirectorId": null,
        "selectedShareholderId": null,
        "selectedContactId": null,
        "itemValues": {},
        "masterOverrides": {},
        "useLetterhead": true,
        "serviceAgreement": null
      }
    }
  ]
}
```

### DELETE /api/document-generation-batches/[id]
Discard the aggregate and incomplete children; generated outputs are kept.
Permission: `document:delete`.

### POST /api/document-generation-batches/[id]/preflight
Revalidate every remaining item without creating outputs. Permission:
`document:update`. Returns `422` with `details.items` diagnostics when any item
is not ready.

### POST /api/document-generation-batches/[id]/generate
Generate all ready, ungenerated items with concurrency at most three.
Permissions: `document:create` + `document:update`. Execution preserves
successes and returns per-item failures; retry never re-runs `GENERATED`
items.

### POST /api/document-generation-batches/[id]/items/[itemId]/preview
Render and persist one item's current preview and fingerprint. Permission:
`document:update`. Refreshing over manual edits requires
`replaceEditedContent: true`.

### POST /api/document-generation-batches/[id]/items/[itemId]/review
Approve the exact current preview and persisted editor content. Permission:
`document:update`. Stale previews return `409`.

### POST /api/document-generation-batches/[id]/items/[itemId]/retry
Revalidate and retry one failed or abandoned-claim item. Permissions:
`document:create` + `document:update`.

---

## Generated Document Endpoints

### GET /api/generated-documents
List generated documents.

---

### POST /api/generated-documents
Generate a new document from template.

**Request Body:**
```json
{
  "templateId": "33333333-3333-4333-8333-333333333333",
  "companyId": "55555555-5555-4555-8555-555555555555",
  "selectedDirectorId": "66666666-6666-4666-8666-666666666666",
  "selectedShareholderId": "77777777-7777-4777-8777-777777777777",
  "selectedContactId": "88888888-8888-4888-8888-888888888888",
  "draftId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "title": "Company Letter",
  "customData": {}
}
```

`draftId` is optional. When it identifies an authorized active generation
session, successful generation converts that same `DRAFT` record instead of
creating a duplicate. A render failure leaves the saved session unchanged.

`selectedDirectorId`, `selectedShareholderId`, and `selectedContactId` are
optional UUIDs accepted by the create, preview, and validate endpoints. A
selected party must be eligible for the supplied company. Templates that use
`selectedDirector.*`, `selectedShareholder.*`, or `selectedContact.*` require
the corresponding singular selection.

`selectedDirectorIds` is an optional UUID array for templates that use a
`{{#each directors}}` loop, including director signature blocks. When omitted,
all current directors are rendered. The generation workspace initially shows
all current directors checked and persists an explicit subset when the user
changes the checkboxes; an explicit empty array renders no directors.

`selectedContactId` resolves only the singular `selectedContact.*` namespace.
The backward-compatible `contact`, `contacts`, and `custom.contacts` contexts
are built independently from the legacy `contactIds` array (or an explicit
server-side context override). Supplying both inputs does not prepend, merge,
or deduplicate the selected contact into the legacy collection. Thus,
`contactIds` remains the legacy multi-contact input while `selectedContactId`
is an independent explicit singular selection.

---

### POST /api/generated-documents/generation-sessions
Create an incomplete generation session as a server-backed `DRAFT` document.
The request body is the versioned wizard session state. The response contains
the draft `id`, `savedAt`, and normalized `state`.

---

### GET /api/generated-documents/generation-sessions/[id]
Resume one active generation session. The record must belong to the current
workspace, remain in `DRAFT` status, and contain compatible session metadata.

---

### PUT /api/generated-documents/generation-sessions/[id]
Save the complete versioned wizard state back to the same active session.

---

### GET /api/generated-documents/stats
Get generated document statistics.

---

### POST /api/generated-documents/validate
Validate data before generation. Accepts the optional `selectedDirectorIds`,
`selectedDirectorId`, `selectedShareholderId`, and `selectedContactId` request
fields documented above. Availability of `system.preparerName` and its
`system.generatedBy` alias is determined only from the authenticated session's
non-empty user name; custom request data cannot supply preparer identity.

---

### POST /api/generated-documents/preview
Preview document without saving. Accepts the optional `selectedDirectorIds`,
`selectedDirectorId`, `selectedShareholderId`, and `selectedContactId` request
fields documented above.

---

### GET /api/generated-documents/[id]
Get a specific generated document.

---

### PUT /api/generated-documents/[id]
Update a generated document (draft only).

---

### DELETE /api/generated-documents/[id]
Soft-delete a generated document. The same operation, with a discard reason,
is used to discard an incomplete generation session.

---

### POST /api/generated-documents/[id]/finalize
Finalize a document (make immutable).

---

### POST /api/generated-documents/[id]/clone
Clone a document.

---

### GET /api/generated-documents/[id]/draft
Get draft data.

---

### PUT /api/generated-documents/[id]/draft
Save draft data (auto-save).

---

### GET /api/generated-documents/[id]/export/pdf
Export an OakDoc document as PDF (converted from its Word file by Microsoft 365). Old A4 records and documents not generated yet return 400.

---

### GET /api/generated-documents/[id]/comments
List comments on a document.

---

### POST /api/generated-documents/[id]/comments
Add a comment.

---

### PUT /api/generated-documents/comments/[commentId]
Update a comment.

---

### DELETE /api/generated-documents/comments/[commentId]
Delete a comment.

---

## Connector Endpoints

### GET /api/connectors
List AI connectors (OpenAI, Google, etc.).

---

### POST /api/connectors
Create a new connector.

**Request Body:**
```json
{
  "provider": "openai | google | anthropic",
  "name": "string",
  "apiKey": "string",
  "isActive": "boolean",
  "settings": {
    "defaultModel": "string",
    "costControl": {
      "enabled": true,
      "period": "MONTHLY",
      "timezone": "UTC",
      "hardLimitMicrosUsd": 50000000,
      "softLimitMicrosUsd": 40000000,
      "perRequestMaxMicrosUsd": 250000,
      "reserveBeforeCall": true,
      "failMode": "BLOCK",
      "fallbackConnectorId": "uuid (optional)",
      "allowReadOnlyFallback": true
    }
  }
}
```

---

### GET /api/connectors/[id]
Get a specific connector.

---

### PUT /api/connectors/[id]
Update a connector.

**Request Body (partial updates):**
```json
{
  "name": "string (optional)",
  "isEnabled": "boolean (optional)",
  "isDefault": "boolean (optional)",
  "settings": {
    "costControl": {
      "enabled": "boolean (optional)",
      "hardLimitMicrosUsd": "number (optional)",
      "softLimitMicrosUsd": "number (optional)",
      "perRequestMaxMicrosUsd": "number (optional)"
    }
  }
}
```

---

### DELETE /api/connectors/[id]
Delete a connector.

---

### POST /api/connectors/[id]/test
Test connector connection.

---

### GET /api/connectors/[id]/access
Check connector access permissions.

---

### GET /api/connectors/[id]/usage
Get usage statistics for a connector.

**Expected Usage Fields (AI providers):**
- `periodSpendMicrosUsd`
- `remainingBudgetMicrosUsd`
- `budgetUtilizationPct`
- `blockedByCostControlCount`
- `lastBudgetResetAt`

---

## AI Endpoints

### GET /api/ai/models
List available AI models.

---

### POST /api/ai/document-chat
Chat with AI about a document.

**Request Body:**
```json
{
  "documentId": "string",
  "message": "string",
  "conversationId": "string (optional)"
}
```

---

### GET /api/ai/conversations
List AI conversations.

---

## Audit Log Endpoints

### GET /api/audit-logs
List audit logs. **TENANT_ADMIN or SUPER_ADMIN.**

**Query Parameters:**
- `page` (number)
- `limit` (number)
- `entityType` (string, optional)
- `action` (string, optional)
- `userId` (string, optional)
- `companyId` (string, optional)
- `startDate` (string, optional)
- `endDate` (string, optional)

---

### GET /api/audit-logs/stats
Get audit log statistics.

---

## Exchange Rate Endpoints

### GET /api/admin/exchange-rates
List exchange rates with filters. **TENANT_ADMIN or SUPER_ADMIN.**

**Query Parameters:**
- `page` (number, default: 1)
- `limit` (number, default: 50)
- `tenantId` (string, optional) - Filter by tenant
- `sourceCurrency` (string, optional) - Filter by source currency code
- `startDate` (string, optional) - Filter from date (ISO format)
- `endDate` (string, optional) - Filter to date (ISO format)
- `source` (string, optional) - One of: `ALL`, `SYSTEM`, `MANUAL` (default: `ALL`)
- `includeSystem` (boolean, default: true) - Include system-level rates
- `sortBy` (string, optional) - One of: `sourceCurrency`, `rate`, `rateDate`, `rateType`, `createdAt` (default: `rateDate`)
- `sortOrder` ('asc' | 'desc', default: 'desc')

**Response:** `200 OK`
```json
{
  "rates": [...],
  "total": "number",
  "page": "number",
  "limit": "number",
  "totalPages": "number"
}
```

---

### POST /api/admin/exchange-rates
Create a manual rate override. **TENANT_ADMIN or SUPER_ADMIN.**

**Request Body:**
```json
{
  "sourceCurrency": "string",
  "targetCurrency": "string (default: SGD)",
  "rate": "number",
  "rateDate": "string (ISO date)",
  "tenantId": "string (optional, SUPER_ADMIN only)"
}
```

**Response:** `201 Created`

---

## Admin Endpoints

### POST /api/admin/purge
Purge soft-deleted data. **SUPER_ADMIN only.**
Generated documents are purged for good, whatever their status (including
FINALIZED): the row, its sections, comments, drafts and stored OakDoc files.
E-signing envelopes keep their own copies and are unlinked; a draft or
cancelled service agreement is removed with it. A document still out for
signature, or a service agreement in effect or with client services, is
refused and listed in `failedRecords` with the reason.

Deleted document templates (`documentTemplate`) and partials
(`templatePartial`) can be purged or restored (`PATCH`) too. Documents
generated from a purged template are kept and lose their template link. A
template still used by a generation batch, or a partial used as a service's
or agreement's Statement of Work, is refused. Stored Word assets are left in
object storage because they can be shared.

---

### GET /api/permissions
List all available permissions.

---

### GET /api/users/[id]/companies
List companies a user has access to.

---

### PUT /api/users/[id]/companies
Update user's company assignments.

---

## User Preference Endpoints

### GET /api/user-preferences
Get a single user preference value, or batch multiple values.

**Query Parameters:**
- `key` (string, required for single preference)
- `keys` (comma-separated string, optional for batch preference reads)

---

## Page Bootstrap Endpoints

### GET /api/page-bootstrap/companies
Return company list data, optional company stats, and requested user preferences in one startup payload.

**Query Parameters:**
- All `/api/companies/list` query parameters
- `preferenceKeys` (comma-separated string, optional)

---

### GET /api/page-bootstrap/processing
Return processing summary counts and requested user preferences in one startup payload.

**Query Parameters:**
- `companyId` (string, optional)
- `preferenceKeys` (comma-separated string, optional)

---

## Public Bootstrap Endpoints

### GET /api/public-bootstrap/forms/[slug]
Return the compact public form startup payload.

---

### GET /api/public-bootstrap/esigning/session
Return the compact public e-signing session startup payload.

---

### GET /api/public-bootstrap/verify/[certificateId]
Return the compact certificate verification startup payload.

---

## Performance Measurement Endpoints

### POST /api/performance/measurements
Persist a live performance measurement.

**Request Body:**
```json
{
  "route": "/companies",
  "metricType": "startup_request_count | response_payload_kb | server_timing_ms | database_timing_ms | first_load_js_kb",
  "value": 123,
  "unit": "count | kb | ms",
  "metadata": {}
}
```

---

### PUT /api/user-preferences
Upsert a user preference value.

**Request Body:**
```json
{
  "key": "string",
  "value": "any JSON"
}
```

---

## Error Responses

All endpoints return standard error responses:

### 400 Bad Request
```json
{
  "error": "Validation error message"
}
```

### 401 Unauthorized
```json
{
  "error": "Unauthorized"
}
```

### 403 Forbidden
```json
{
  "error": "Forbidden"
}
```

### 404 Not Found
```json
{
  "error": "Resource not found"
}
```

### 500 Internal Server Error
```json
{
  "error": "An error occurred. Please try again."
}
```

---

## Rate Limiting

Some endpoints have rate limiting:
- `/api/auth/login` - 5 attempts per minute
- `/api/auth/forgot-password` - 3 requests per hour

Rate limit headers:
- `X-RateLimit-Limit`: Maximum requests allowed
- `X-RateLimit-Remaining`: Requests remaining
- `X-RateLimit-Reset`: Time when limit resets (Unix timestamp)

---

## Pagination

Paginated endpoints return:

```json
{
  "data": [...],
  "total": 100,
  "page": 1,
  "limit": 20,
  "totalPages": 5
}
```

---

## Document Tags Endpoints

The Document Tags API supports a hybrid scope system with tenant-level (shared) tags and company-level tags.

### GET /api/tags
Get all tenant (shared) tags.

**Auth:** Authenticated

**Response:** `200 OK`
```json
{
  "tags": [{
    "id": "string",
    "name": "string",
    "color": "GRAY|RED|ORANGE|YELLOW|GREEN|BLUE|PURPLE|PINK",
    "description": "string|null",
    "usageCount": "number",
    "lastUsedAt": "string|null",
    "createdAt": "string",
    "companyId": "null",
    "scope": "tenant"
  }]
}
```

---

### POST /api/tags
Create a tenant (shared) tag.

**Auth:** TENANT_ADMIN or SUPER_ADMIN

**Request Body:**
```json
{
  "name": "string",
  "color": "GRAY|RED|ORANGE|YELLOW|GREEN|BLUE|PURPLE|PINK",
  "description": "string (optional)"
}
```

**Response:** `201 Created`

---

### PATCH /api/tags/:tagId
Update a tenant (shared) tag.

**Auth:** TENANT_ADMIN or SUPER_ADMIN

**Request Body:**
```json
{
  "name": "string (optional)",
  "color": "TagColor (optional)",
  "description": "string|null (optional)"
}
```

**Response:** `200 OK`

---

### DELETE /api/tags/:tagId
Delete a tenant (shared) tag.

**Auth:** TENANT_ADMIN or SUPER_ADMIN

**Response:** `200 OK`

---

### GET /api/tags/available
Get combined available tags (tenant tags + company tags if companyId provided).

**Auth:** Authenticated

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| companyId | string | Optional - include company-specific tags |
| query | string | Optional - search tags by name |
| recent | boolean | Optional - get recently used tags (limit 5) |
| limit | number | Optional - max results (default: 20, max: 100) |

**Response:** `200 OK`
```json
{
  "tags": [{
    "id": "string",
    "name": "string",
    "color": "TagColor",
    "companyId": "string|null",
    "scope": "tenant|company"
  }]
}
```

---

### GET /api/companies/:id/tags
Get company-specific tags (excludes tenant tags).

**Auth:** Authenticated with company access

**Response:** `200 OK`

---

### POST /api/companies/:id/tags
Create a company-specific tag.

**Auth:** Authenticated with company access

**Request Body:**
```json
{
  "name": "string",
  "color": "TagColor (optional)",
  "description": "string (optional)"
}
```

**Response:** `201 Created`

---

### POST /api/processing-documents/:documentId/tags
Add a tag to a processing document.

**Auth:** Authenticated with company access

**Request Body:**
```json
{
  "tagId": "string"
}
```
or create and add in one call:
```json
{
  "name": "string",
  "color": "TagColor (optional)"
}
```

**Response:** `201 Created`

---

### DELETE /api/processing-documents/:documentId/tags/:tagId
Remove a tag from a processing document.

**Auth:** Authenticated with company access

**Response:** `200 OK`

---

*Last updated: 2026-03-11*

### SharePoint signed-document filing

All filing endpoints require an authenticated workspace session and a
workspace-owned SharePoint connector. System/shared connectors and raw Graph
continuation URLs are rejected.

- `GET /api/sharepoint/connection-status?connectorId=<id>` checks the selected connector and canonical drive.
- `GET|PUT /api/settings/sharepoint-filing?connectorId=<id>` reads or updates verified filing roots and the workspace cutover toggle.
- `GET|POST /api/sharepoint/folders` lists immediate child folders or creates a validated child folder. Clients receive opaque cursors.
- `GET|PUT|DELETE /api/companies/:id/sharepoint-folder` reads, maps, or removes a company folder; `POST .../verify` refreshes its canonical name/URL.
- `GET /api/settings/sharepoint-filing/status` returns tenant-scoped safe queue aggregates.
- `GET /api/settings/sharepoint-filing/unassigned` lists orphan and failed jobs; the job `retry`, `resolve`, and `notes` endpoints provide recovery actions.

Automatic filing requires both `SHAREPOINT_SIGNED_FILING_ENABLED=true` and the
workspace toggle. Only envelopes completed at or after the current `enabledAt`
cutover are discovered automatically; Oakcloud's internal signed PDF remains
the source of record.

---

**Changelog:**
- Added the Business Assistant implementation-preview API and reviewed BizFile preparation flow.
- Added Document Tags endpoints with hybrid scope support (tenant + company tags)
- Added Processing Documents section with bulk download ZIP and Excel export endpoints
- Added single document export endpoint with linked documents option
- Added sorting parameters (`sortBy`, `sortOrder`) to Users endpoint
- Added Exchange Rates endpoints with sorting support
- Added Forms endpoints covering builder CRUD, public runtime, drafts, exports, uploads, and AI review routes

## Business Assistant Endpoints

**Implementation preview; not released.** Read [the specification](../features/business-assistant/SPECIFICATION.md) and [implementation checkpoint](../plans/2026-09-05-business-assistant-implementation.md) for remaining validation gates. BizFile is one registered capability of the general assistant.

Authenticated routes use explicit workspace context and owner-scoped assistant records. Pass `workspaceId` as a query parameter for reads/actions and in the body for turn acceptance. Responses are private and not cached. Workspace membership does not grant access to every company or document; module capabilities must enforce their own resource permissions.

| Method | Path | Purpose / response envelope |
|---|---|---|
| GET | `/api/business-assistant/conversations` | Conversation history and available capability descriptors: `{ conversations, capabilities, enabled, mutationsEnabled, nextCursor }` |
| POST | `/api/business-assistant/turns` | Persist a request for worker processing; `202` with `{ type: "accepted", conversationId, messageId, runId, duplicate }`, or `200` for an identical replay |
| GET | `/api/business-assistant/conversations/:id` | Owner-visible messages and run references: `{ conversation }` |
| POST | `/api/business-assistant/conversations/:id/actions` | `ARCHIVE` or `DELETE`; preserve required business-operation audit/recovery records |
| GET | `/api/business-assistant/runs/:id` | Items, proposal, allowed actions, execution/effect/review outcomes: `{ run }` |
| POST | `/api/business-assistant/runs/:id/actions` | `REVISE`, `CONFIRM`, `CANCEL`, or stage-specific `RETRY` |
| POST | `/api/business-assistant/runs/:id/corrections` | Prepare a linked correction proposal from review findings: `{ correction }` |
| GET | `/api/business-assistant/resources` | Search accessible resource attachments using `query`: `{ resources }` |
| POST | `/api/business-assistant/feedback` | Record feedback with `clientEventId`, target, event type, and optional comment |
| GET | `/api/business-assistant/memories` | Visible structured preference records: `{ memories }` |
| POST | `/api/business-assistant/memories/:id/actions` | `CONFIRM`, `REVISE`, `DEACTIVATE`, or `DELETE` with `expectedVersion` |
| GET | `/api/business-assistant/learning-changes` | Governed candidate changes and evaluation evidence: `{ changes }` |
| POST | `/api/business-assistant/learning-changes/:id/actions` | `EVALUATE`, `APPROVE`, `PROMOTE`, `ROLLBACK`, or `REJECT` with `expectedVersion` |

Turn requests include a stable `clientRequestId`, optional `conversationId`, `workspaceId`, `message`, optional typed `resources`, and optional `context`. Resource references contain `resourceType`, `resourceId`, and a `source`, `target`, or `context` role. Reuse the same request identity after an uncertain network response; changed content requires a new identity. An identity reused for different content returns a conflict.

Approval submits the exact server proposal and a nonempty selected item subset:

```json
{
  "action": "CONFIRM",
  "clientRequestId": "stable-client-request-id",
  "proposalId": "prepared-proposal-id",
  "revision": 2,
  "itemIds": ["selected-item-id"]
}
```

`REVISE` sends `proposalId`, `revision`, `itemId`, and a module-supported `patch`. The resulting proposal must be reviewed again. Do not treat a failed effect or review as permission to rerun a committed mutation. `OUTCOME_UNKNOWN` requires reconciliation using the original operation identity.

### Reviewed BizFile preparation

Correction preparation uses `POST /api/business-assistant/runs/:id/corrections` with the source run ID and this body:

```json
{
  "workspaceId": "current-workspace-id",
  "clientRequestId": "stable-correction-request-id",
  "reviewId": "latest-settled-review-id",
  "corrections": [{ "findingId": "factual-finding-id", "value": "reviewed correction value" }]
}
```

The general service delegates validation to the registered capability's optional correction handler. Unsupported capabilities are rejected. Requests must reference an owned, committed item and its latest settled review; a queued review retry makes the earlier finding stale. An identical request returns the same new proposal; changed content with the same request ID returns a conflict. The response includes `correctionOfReviewId`, `sourceRunId`, new `runId`, `runItemId`, `proposalId`, `revision`, and `duplicate`. There is no operation ID until the new proposal passes the existing `CONFIRM` action.

The BizFile handler supports a bounded allowlist of factual scalar and single-record fields. It validates the finding value, approval/receipt/source hashes, retained bytes, current source pointer, and current company revision. A legitimate finalized pointer is accepted. Collection-row corrections and stale findings are rejected. The prior approval, operation receipt and review remain unchanged. This is a preparation API; it does not apply a company update.

The existing upload UI uses `POST /api/documents/:documentId/prepare-import` before `confirm` or `apply-update`. Preparation accepts reviewed `extractedData`, explicit CREATE/UPDATE mode, an UPDATE `targetCompanyId`, and optional `selectedChangeIds` and contact decisions. It returns a canonical plan and signed preparation token for exact-change review. The token binds requester, workspace, document, plan hash, task context, and a 30-minute expiration. Save requests carry that plan, token, and stable `operationId`; local selection changes require fresh preparation before approval. Direct-save requests without a prepared plan are rejected. An expired token permits only recovery of an identical already-committed operation, never a new mutation.

Preparation signatures use `BUSINESS_ASSISTANT_PREPARATION_SECRET` (at least 32 characters), falling back to the configured `JWT_SECRET` with a separate signing purpose. Replicas must share the key. Rotating it invalidates outstanding preparations; users must prepare those proposals again.

The unused legacy `/api/companies/:id/documents/:documentId/extract` route and deprecated text extractor have been removed. Current `/api/documents/:documentId/extract` vision extraction remains available. See the implementation checkpoint for canonical transaction, migration, and independent-review validation still outstanding.
