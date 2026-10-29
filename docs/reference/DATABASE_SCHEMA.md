# Oakcloud Database Schema

> **Last Updated**: 2026-03-11
> **Audience**: Developers

This document provides a detailed reference for the Oakcloud database schema.

## Related Documents

- [Architecture](../ARCHITECTURE.md) - System design overview
- [Service Patterns](../guides/SERVICE_PATTERNS.md) - Service layer conventions
- [API Reference](./API_REFERENCE.md) - REST API endpoints

## Multi-Tenancy Architecture

Oakcloud implements a multi-tenant architecture where data is isolated by tenant. The following entities are tenant-scoped:

- **Companies** - `tenantId` (required)
- **Contacts** - `tenantId` (required)
- **Contracts** - `tenantId` (required)
- **ContractServices** - `tenantId` (required)
- **DeadlineTemplates** - `tenantId` (optional, null for system templates)
- **Deadlines** - `tenantId` (required)
- **Documents** - `tenantId` (required)
- **Forms** - `tenantId` (required)
- **FormFields** - `tenantId` (required)
- **FormSubmissions** - `tenantId` (required)
- **FormDrafts** - `tenantId` (required)
- **FormUploads** - `tenantId` (required)
- **AuditLogs** - `tenantId` (optional, for system-level events)
- **Roles** - `tenantId` (optional, null for global SUPER_ADMIN role)

Users are linked to tenants via `tenantId`. SUPER_ADMIN users have `tenantId = null` and are identified by having a role assignment with `systemRoleType = 'SUPER_ADMIN'`.

## Entity Relationship Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           MULTI-TENANCY LAYER                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────┐                                                              │
│  │   Tenant   │◄────────────────────────────────────────────────────┐       │
│  ├────────────┤                                                      │       │
│  │ id (PK)    │        ┌────────────┐     ┌────────────┐            │       │
│  │ name       │        │    Role    │     │ Permission │            │       │
│  │ slug       │◄───────┤ tenantId   │────▶│ resource   │            │       │
│  │ status     │        │ name       │     │ action     │            │       │
│  │ maxUsers   │        │ isSystem   │     └────────────┘            │       │
│  │ maxCompanies│       └────────────┘                               │       │
│  └──────┬─────┘                                                      │       │
│         │                                                            │       │
│         │ 1:N                                                        │       │
│         ▼                                                            │       │
│  ┌────────────┐                                                      │       │
│  │    User    │                                                      │       │
│  ├────────────┤                                                      │       │
│  │ id         │◄─────────────────────────────────────┐               │       │
│  │ email      │                                      │               │       │
│  │ tenantId   │  Company access via UserRoleAssignment               │       │
│  └────────────┘  (companyId on role assignments)     │               │       │
│                                                      │               │       │
├─────────────────────────────────────────────────────────────────────────────┤
│                              CORE ENTITIES                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │                            Company                                  │    │
│  ├─────────────┬──────────────┬────────────────┬───────────────────────┤    │
│  │ id (PK)     │ tenantId (FK)│ uen (UNIQUE)   │ name                  │    │
│  │ entityType  │ status       │ incorporation  │ primarySsic           │    │
│  │ paidUpCap   │ issuedCap    │ hasCharges     │ deleted_at            │    │
│  └──────┬──────┴──────────────┴────────────────┴───────────────────────┘    │
│         │                                                                    │
│         │ 1:N                                                                │
│         │                                                                    │
│  ┌──────┴─────────────────────────────────────────────────────────────┐    │
│  │                                                                     │    │
│  ▼                                                                     │    │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐           │    │
│  │CompanyAddress  │  │CompanyOfficer  │  │CompanyShareholder│          │    │
│  ├────────────────┤  ├────────────────┤  ├────────────────┤           │    │
│  │ addressType    │  │ role           │  │ shareholderType│           │    │
│  │ fullAddress    │  │ name           │  │ numberOfShares │           │    │
│  │ isCurrent      │  │ isCurrent      │  │ percentageHeld │           │    │
│  │ effectiveFrom  │  │ appointmentDate│  │ isCurrent      │           │    │
│  └────────────────┘  └───────┬────────┘  └───────┬────────┘           │    │
│                              │                    │                    │    │
│         ┌────────────────────┴────────────────────┘                    │    │
│         │                                                              │    │
│         ▼ N:1                                                          │    │
│  ┌────────────────┐                                                    │    │
│  │    Contact     │                                                    │    │
│  ├────────────────┤                                                    │    │
│  │ tenantId (FK)  │  Required for tenant isolation                     │    │
│  │ contactType    │  INDIVIDUAL | CORPORATE                            │    │
│  │ fullName       │                                                    │    │
│  │ idType         │  NRIC | FIN | PASSPORT | UEN                      │    │
│  │ idNumber       │                                                    │    │
│  └────────────────┘                                                    │    │
│                                                                        │    │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐           │    │
│  │CompanyCharge   │  │  ShareCapital  │  │CompanyFormerName│          │    │
│  ├────────────────┤  ├────────────────┤  ├────────────────┤           │    │
│  │ chargeNumber   │  │ shareClass     │  │ formerName     │           │    │
│  │ chargeHolder   │  │ numberOfShares │  │ effectiveFrom  │           │    │
│  │ amountSecured  │  │ parValue       │  │ effectiveTo    │           │    │
│  │ isDischarge    │  │ totalValue     │  │                │           │    │
│  └────────────────┘  └────────────────┘  └────────────────┘           │    │
│                                                                        │    │
│  ┌────────────────┐  ┌────────────────┐                               │    │
│  │   Document     │  │   AuditLog     │◄──────────────────────────────┘    │
│  ├────────────────┤  ├────────────────┤                                    │
│  │ tenantId (FK)  │  │ tenantId (FK)  │  Optional for system events        │
│  │ documentType   │  │ action         │  CREATE | UPDATE | DELETE          │
│  │ fileName       │  │ entityType     │                                    │
│  │ extractStatus  │  │ entityId       │                                    │
│  │ extractedData  │  │ changes (JSON) │                                    │
│  │ version        │  │ changeSource   │  MANUAL | BIZFILE | API            │
│  └────────────────┘  │ reason         │                                    │
│                      └────────────────┘                                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Tables Reference

### tenants

Multi-tenancy support for data isolation.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | UUID | No | Primary key |
| name | VARCHAR | No | Tenant display name |
| slug | VARCHAR | No | URL-friendly identifier (unique) |
| status | ENUM | No | ACTIVE, SUSPENDED, PENDING_SETUP, DEACTIVATED |
| contact_email | VARCHAR | Yes | Primary contact email |
| contact_phone | VARCHAR | Yes | Primary contact phone |
| settings | JSONB | Yes | Tenant-specific configuration |
| max_users | INT | No | Maximum allowed users (default: 50) |
| max_companies | INT | No | Maximum allowed companies (default: 100) |
| max_storage_mb | INT | No | Storage limit in MB (default: 10GB) |
| logo_url | VARCHAR | Yes | Custom logo URL |
| primary_color | VARCHAR | Yes | Brand color (default: #294d44) |
| created_at | TIMESTAMP | No | Record creation time |
| updated_at | TIMESTAMP | No | Last update time |
| deleted_at | TIMESTAMP | Yes | Soft delete timestamp |

Incomplete document-generation sessions reuse this table rather than creating
a separate draft table. An active session has `status = DRAFT` and a versioned
`metadata.generationSession` payload containing the wizard step, selected
record IDs, title, custom values, letterhead choice, and preview/editor state.
The list uses this marker to offer **Resume** and **Discard**. Successful
generation replaces the session metadata with normal generated-document
metadata on the same record; discard sets `deleted_at` through the existing
soft-delete workflow.
| activated_at | TIMESTAMP | Yes | When tenant was activated |
| suspended_at | TIMESTAMP | Yes | When tenant was suspended |
| suspend_reason | TEXT | Yes | Reason for suspension |

**Indexes:**
- `tenants_slug_key` UNIQUE on slug
- `tenants_status_idx` on status
- `tenants_deleted_at_idx` on deleted_at

**Tenant Lifecycle:**

1. **Creation** (`PENDING_SETUP`): SUPER_ADMIN creates tenant via `/admin/tenants`
2. **Setup Wizard**: After creation, a setup wizard guides through:
   - Review/update tenant information
   - Create first TENANT_ADMIN user
   - Optionally create first company
3. **Activation** (`ACTIVE`): Setup completion activates the tenant
4. **Suspension** (`SUSPENDED`): SUPER_ADMIN can suspend for compliance/billing
5. **Deactivation** (`DEACTIVATED`): Soft-delete marks tenant as deactivated

**Setup API Endpoint:**
- `POST /api/tenants/:id/setup` - Complete tenant setup wizard

---

### users

User accounts for authentication and authorization. Permissions and company access are managed via `user_role_assignments`.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | UUID | No | Primary key |
| email | VARCHAR | No | Unique email address |
| password_hash | VARCHAR | No | Bcrypt hashed password |
| first_name | VARCHAR | No | First name |
| last_name | VARCHAR | No | Last name |
| is_active | BOOLEAN | No | Account active status |
| last_login_at | TIMESTAMP | Yes | Last login timestamp |
| must_change_password | BOOLEAN | No | Force password change on next login |
| password_reset_token | VARCHAR | Yes | Hashed password reset token (unique) |
| password_reset_expires | TIMESTAMP | Yes | Token expiration time |
| password_changed_at | TIMESTAMP | Yes | Last password change time |
| tenant_id | UUID | Yes | FK to tenants (null for SUPER_ADMIN) |
| created_at | TIMESTAMP | No | Record creation time |
| updated_at | TIMESTAMP | No | Last update time |
| deleted_at | TIMESTAMP | Yes | Soft delete timestamp |

**Note:** User roles and company access are determined by `user_role_assignments`. System roles (SUPER_ADMIN, TENANT_ADMIN) are identified by the role's `system_role_type` field. Company access is derived from role assignments with non-null `company_id`.

**Indexes:**
- `users_email_key` UNIQUE on email
- `users_password_reset_token_key` UNIQUE on password_reset_token
- `users_tenant_id_idx` on tenant_id

---

### user_preferences

Per-user UI/application preferences persisted across devices (e.g., table column widths/visibility).

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | UUID | No | Primary key |
| user_id | UUID | No | FK to users |
| key | VARCHAR | No | Preference key (namespaced string) |
| value | JSONB | No | Preference value (JSON) |
| created_at | TIMESTAMP | No | Record creation time |
| updated_at | TIMESTAMP | No | Last update time |

**Indexes:**
- `user_preferences_user_id_key_key` UNIQUE on (user_id, key)
- `user_preferences_user_id_idx` on user_id

---

### companies

Main company records with ACRA information. Each company belongs to a tenant.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | UUID | No | Primary key |
| tenant_id | UUID | No | FK to tenants (required) |
| uen | VARCHAR(10) | No | Unique Entity Number (unique per tenant) |
| name | VARCHAR(200) | No | Current company name |
| former_name | VARCHAR(200) | Yes | Previous company name (if changed) |
| date_of_name_change | DATE | Yes | Date when name was changed |
| entity_type | ENUM | No | Company type (see EntityType enum) |
| status | ENUM | No | Company status (see CompanyStatus enum) |
| status_date | DATE | Yes | Date when status became effective |
| incorporation_date | DATE | Yes | Date of incorporation |
| registration_date | DATE | Yes | Date of registration |
| date_of_address | DATE | Yes | Date when registered address became effective |
| primary_ssic_code | VARCHAR(10) | Yes | Primary SSIC code |
| primary_ssic_description | VARCHAR(500) | Yes | Primary business activity |
| secondary_ssic_code | VARCHAR(10) | Yes | Secondary SSIC code |
| secondary_ssic_description | VARCHAR(500) | Yes | Secondary business activity |
| financial_year_end_day | INT | Yes | FYE day (1-31) |
| financial_year_end_month | INT | Yes | FYE month (1-12) |
| fye_as_at_last_ar | DATE | Yes | Financial year end as at last AR |
| home_currency | VARCHAR(3) | Yes | Company's home currency (default: SGD) |
| last_agm_date | DATE | Yes | Last AGM date |
| last_ar_filed_date | DATE | Yes | Last annual return filed |
| next_agm_due_date | DATE | Yes | Next AGM due date |
| next_ar_due_date | DATE | Yes | Next AR due date |
| accounts_due_date | DATE | Yes | Accounts due date |
| paid_up_capital_currency | VARCHAR(3) | Yes | Currency (default: SGD) |
| paid_up_capital_amount | DECIMAL(18,2) | Yes | Paid up capital amount |
| issued_capital_currency | VARCHAR(3) | Yes | Currency (default: SGD) |
| issued_capital_amount | DECIMAL(18,2) | Yes | Issued capital amount |
| has_charges | BOOLEAN | No | Has outstanding charges |
| is_gst_registered | BOOLEAN | No | GST registration status |
| gst_registration_number | VARCHAR(20) | Yes | GST number |
| gst_registration_date | DATE | Yes | GST registration date |
| gst_filing_frequency | ENUM | Yes | GST filing frequency (MONTHLY, QUARTERLY) |
| agm_dispensed | BOOLEAN | No | AGM dispensed (for private cos) |
| is_dormant | BOOLEAN | No | Company is dormant |
| dormant_tax_exemption_approved | BOOLEAN | No | Dormant tax exemption approved |
| is_registered_charity | BOOLEAN | No | Registered charity status |
| charity_registration_date | DATE | Yes | Charity registration date |
| charity_registration_number | VARCHAR(50) | Yes | Charity registration number |
| ipc_approval_date | DATE | Yes | IPC (Institution of Public Character) approval date |
| ipc_expiry_date | DATE | Yes | IPC expiry date |
| created_at | TIMESTAMP | No | Record creation time |
| updated_at | TIMESTAMP | No | Last update time |
| deleted_at | TIMESTAMP | Yes | Soft delete timestamp |
| deleted_reason | TEXT | Yes | Reason for deletion |

**Notes:**
- UEN is unique within a tenant, not globally. Companies in different tenants may share the same UEN.
- `agmDispensed` - Private companies can dispense with AGM if all shareholders agree
- `isDormant` - Dormant companies have different compliance requirements
- `isRegisteredCharity` - Registered charities have additional filing requirements with Commissioner of Charities
- `ipcApprovalDate/ipcExpiryDate` - IPC status allows donors to claim tax deductions

**Indexes:**
- `companies_tenant_id_uen_key` UNIQUE on (tenant_id, uen)
- `companies_tenant_id_idx` on tenant_id
- `companies_name_idx` on name
- `companies_status_idx` on status
- `companies_entity_type_idx` on entity_type
- `companies_tenant_id_deleted_at_idx` on (tenant_id, deleted_at)
- `companies_deleted_at_idx` on deleted_at

---

### company_former_names

Historical company names.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | UUID | No | Primary key |
| company_id | UUID | No | FK to companies |
| former_name | VARCHAR(200) | No | Previous company name |
| effective_from | DATE | No | Name effective from date |
| effective_to | DATE | Yes | Name effective until date |
| source_document_id | UUID | Yes | FK to documents |
| created_at | TIMESTAMP | No | Record creation time |

---

### company_addresses

Company address records with history.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | UUID | No | Primary key |
| company_id | UUID | No | FK to companies |
| address_type | ENUM | No | REGISTERED_OFFICE, MAILING, etc. |
| block | VARCHAR(10) | Yes | Block number |
| street_name | VARCHAR(200) | No | Street name |
| level | VARCHAR(10) | Yes | Floor level |
| unit | VARCHAR(10) | Yes | Unit number |
| building_name | VARCHAR(200) | Yes | Building name |
| postal_code | VARCHAR(10) | No | Postal code |
| country | VARCHAR(100) | No | Country (default: SINGAPORE) |
| full_address | TEXT | No | Complete formatted address |
| effective_from | DATE | Yes | Address effective from |
| effective_to | DATE | Yes | Address effective until |
| is_current | BOOLEAN | No | Current address flag |
| source_document_id | UUID | Yes | FK to documents |
| created_at | TIMESTAMP | No | Record creation time |
| updated_at | TIMESTAMP | No | Last update time |

---

### contacts

Unified contact management for individuals and corporates. Each contact belongs to a tenant.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | UUID | No | Primary key |
| tenant_id | UUID | No | FK to tenants (required) |
| contact_type | ENUM | No | INDIVIDUAL or CORPORATE |
| first_name | VARCHAR(100) | Yes | First name (individuals) |
| last_name | VARCHAR(100) | Yes | Last name (individuals) |
| full_name | VARCHAR(200) | No | Computed full name |
| canonical_name | TEXT | Yes | Unicode NFKC/case-folded, punctuation-free match key |
| alias | VARCHAR(100) | Yes | Optional alternate display/match name |
| identification_type | ENUM | Yes | NRIC, FIN, PASSPORT, UEN, OTHER |
| identification_number | VARCHAR(50) | Yes | ID number |
| nationality | VARCHAR(100) | Yes | Nationality |
| date_of_birth | DATE | Yes | Date of birth |
| corporate_name | VARCHAR(200) | Yes | Corporate name |
| corporate_uen | VARCHAR(10) | Yes | Corporate UEN |
| full_address | VARCHAR(500) | Yes | Complete address |
| is_active | BOOLEAN | No | Active status |
| created_at | TIMESTAMP | No | Record creation time |
| updated_at | TIMESTAMP | No | Last update time |
| deleted_at | TIMESTAMP | Yes | Soft delete timestamp |

**Notes:**
- Email and phone are stored in the `contact_details` table, not directly on contacts
- Use `contact_details` with `companyId = null` for default email/phone
- Canonical names are derived by the shared application canonicalizer. They are not locale-specific transliterations.
- Canonical aliases use the same pinned application normalizer. Identity traffic is deployment-gated until active `canonicalName` and `canonicalAlias` backfill is complete; SQL does not approximate Unicode folding.
- Identifier normalization is used for lookup only. Masked, placeholder, or low-confidence IDs/UENs are not deterministic keys.

**Indexes:**
- `contacts_tenant_id_id_type_number_key` UNIQUE on (tenant_id, identification_type, identification_number)
- `contacts_tenant_id_idx` on tenant_id
- `contacts_full_name_idx` on full_name
- `contacts_identification_number_idx` on identification_number
- `contacts_corporate_uen_idx` on corporate_uen
- `contacts_tenant_id_deleted_at_idx` on (tenant_id, deleted_at)
- `contacts_tenantId_contactType_deletedAt_canonicalName_idx` for tenant/type exact-name lookup
- `contacts_tenantId_contactType_deletedAt_canonicalAlias_idx` for Unicode-safe exact alias lookup
- `contacts_canonicalName_active_trgm_idx` partial GIN trigram index for active fuzzy candidates
- Partial expression indexes for active normalized identification numbers and corporate UENs

#### Contact identity and merge controls

`contact_duplicate_decisions` stores the ordered contact pair, both reviewed SHA-256 identity fingerprints, a `REJECTED` or `CREATE_SEPARATE` decision, reason, actor, and timestamps. Its tenant/pair unique key makes the decision upsertable. A rejection or explicit separate-contact override suppresses a suggestion only while both current fingerprints match.

`contact_merge_operations` is an append-only merge ledger keyed by tenant and idempotency key. It records the master/source snapshots, fingerprints, field decisions, moved-record counts, matching reasons, approver, and approval time. A database trigger rejects ledger updates or deletes. The normal audit log also records `MERGE`.

Merge runs in one transaction: lock and revalidate the contacts, update selected master fields, move/deduplicate all supported references, assert that no references remain on sources, write ledger and audit rows, and only then hard-delete the approved source contacts. Hard deletion is intentionally limited to this reviewed merge path; ordinary contact deletion remains soft deletion.

---

### note_tabs

Multi-tab internal notes with rich text support for companies and contacts.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | UUID | No | Primary key |
| title | VARCHAR | No | Tab title (default: "General") |
| content | TEXT | Yes | Rich text HTML content |
| order | INT | No | Tab display order (default: 0) |
| company_id | UUID | Yes | FK to companies (one of company_id/contact_id set) |
| contact_id | UUID | Yes | FK to contacts (one of company_id/contact_id set) |
| created_at | TIMESTAMP | No | Record creation time |
| updated_at | TIMESTAMP | No | Last update time |

**Notes:**
- Each tab belongs to either a company OR a contact (never both)
- Supports rich text with TipTap editor (bold, italic, underline, lists, links)
- Cascade delete when parent company/contact is deleted
- User can create multiple tabs, rename, reorder, and delete any tab

**Indexes:**
- `note_tabs_company_id_idx` on company_id
- `note_tabs_contact_id_idx` on contact_id
- `note_tabs_order_idx` on order

---

### contact_details

Additional contact methods (email, phone, fax, etc.) that can be linked to a Contact, Company, or both.
Supports multiple contact details per entity with labels for function/purpose.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | UUID | No | Primary key |
| tenant_id | UUID | No | FK to tenants (required) |
| contact_id | UUID | Yes | FK to contacts (CASCADE on delete) |
| company_id | UUID | Yes | FK to companies (CASCADE on delete) |
| detail_type | ENUM | No | EMAIL, PHONE, FAX, MOBILE, WEBSITE, OTHER |
| value | VARCHAR(500) | No | The actual contact value |
| label | VARCHAR(100) | Yes | Purpose/function label (e.g., "Account Receivable") |
| description | VARCHAR(500) | Yes | Additional notes |
| display_order | INT | No | Display ordering (default: 0) |
| is_primary | BOOLEAN | No | Primary detail of this type (default: false) |
| created_at | TIMESTAMP | No | Record creation time |
| updated_at | TIMESTAMP | No | Last update time |
| deleted_at | TIMESTAMP | Yes | Soft delete timestamp |

**Use Cases:**
- Company-level: Direct contact info for the company (e.g., "Account Receivable email")
- Contact-level: Personal contact details for linked individuals
- Both: A contact's specific role at a company (e.g., director's work email)

**Indexes:**
- `contact_details_tenant_id_idx` on tenant_id
- `contact_details_contact_id_idx` on contact_id
- `contact_details_company_id_idx` on company_id
- `contact_details_detail_type_idx` on detail_type
- `contact_details_tenant_id_contact_id_idx` on (tenant_id, contact_id)
- `contact_details_tenant_id_company_id_idx` on (tenant_id, company_id)
- `contact_details_tenant_id_deleted_at_idx` on (tenant_id, deleted_at)

---

### company_contacts

Many-to-many relationship between companies and contacts.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | UUID | No | Primary key |
| company_id | UUID | No | FK to companies (CASCADE on delete) |
| contact_id | UUID | No | FK to contacts (CASCADE on delete) |
| relationship | VARCHAR(50) | No | Role (Director, Shareholder, etc.) |
| is_primary | BOOLEAN | No | Primary contact flag |
| created_at | TIMESTAMP | No | Record creation time |
| deleted_at | TIMESTAMP | Yes | Soft delete timestamp |

**Indexes:**
- `company_contacts_unique` UNIQUE on (company_id, contact_id, relationship)
- `company_contacts_deleted_at_idx` on deleted_at

---

### contracts

Master contract/agreement records. Each contract belongs to a company and tenant.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | UUID | No | Primary key |
| tenant_id | UUID | No | FK to tenants (required) |
| company_id | UUID | No | FK to companies (CASCADE on delete) |
| title | VARCHAR(200) | No | Contract title (e.g., "Annual Engagement 2024") |
| contract_type | ENUM | No | Contract type (see ContractType enum, default: OTHER) |
| status | ENUM | No | Contract status (see ContractStatus enum, default: DRAFT) |
| start_date | DATE | No | Contract effective start date |
| signed_date | DATE | Yes | Date when contract was signed |
| document_id | UUID | Yes | FK to documents (optional attachment, UNIQUE, SET NULL on delete) |
| internal_notes | TEXT | Yes | Internal notes for the contract |
| created_at | TIMESTAMP | No | Record creation time |
| updated_at | TIMESTAMP | No | Last update time |
| deleted_at | TIMESTAMP | Yes | Soft delete timestamp |
| deleted_reason | TEXT | Yes | Reason for deletion |

**Notes:**
- A contract has no end date - it's a master agreement shell
- Services under the contract have their own start/end dates
- Document attachment is optional and doesn't trigger processing pipeline

**Indexes:**
- `contracts_tenant_id_idx` on tenant_id
- `contracts_company_id_idx` on company_id
- `contracts_status_idx` on status
- `contracts_tenant_id_deleted_at_idx` on (tenant_id, deleted_at)
- `contracts_tenant_id_company_id_idx` on (tenant_id, company_id)

---

### contract_services

Billable service line items under a contract. Each service has its own dates, rates, and scope.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | UUID | No | Primary key |
| tenant_id | UUID | No | FK to tenants (required) |
| contract_id | UUID | No | FK to contracts (CASCADE on delete) |
| name | VARCHAR(200) | No | Service name (e.g., "Monthly Bookkeeping") |
| service_type | ENUM | No | Service type (see ServiceType enum, default: RECURRING) |
| status | ENUM | No | Service status (see ServiceStatus enum, default: ACTIVE) |
| rate | DECIMAL(18,2) | Yes | Service rate amount |
| currency | VARCHAR(3) | No | Currency code (default: SGD) |
| frequency | ENUM | No | Billing frequency (see BillingFrequency enum, default: MONTHLY) |
| start_date | DATE | No | Service start date |
| end_date | DATE | Yes | Service end date (null for ongoing) |
| next_billing_date | DATE | Yes | Next billing date |
| scope | TEXT | Yes | Scope of work / statement of work (rich text) |
| auto_renewal | BOOLEAN | No | Auto-renewal enabled (default: false) |
| renewal_period_months | INT | Yes | Renewal period in months |
| display_order | INT | No | Display ordering (default: 0) |
| created_at | TIMESTAMP | No | Record creation time |
| updated_at | TIMESTAMP | No | Last update time |
| deleted_at | TIMESTAMP | Yes | Soft delete timestamp |

**Notes:**
- Services inherit tenant from parent contract
- Scope field supports rich text (TipTap HTML)
- Display order controls order within a contract

**Indexes:**
- `contract_services_tenant_id_idx` on tenant_id
- `contract_services_contract_id_idx` on contract_id
- `contract_services_status_idx` on status
- `contract_services_end_date_idx` on end_date
- `contract_services_tenant_id_deleted_at_idx` on (tenant_id, deleted_at)
- `contract_services_tenant_id_contract_id_idx` on (tenant_id, contract_id)

---

### deadline_templates

Deadline template definitions for auto-generating compliance deadlines. Supports both system-level templates (Singapore compliance rules) and tenant-specific custom templates.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | UUID | No | Primary key |
| tenant_id | UUID | Yes | FK to tenants (null = system template) |
| code | VARCHAR(50) | No | Template code (e.g., "AGM", "ECI", "GST_RETURN_Q") |
| name | VARCHAR(200) | No | Template display name |
| description | TEXT | Yes | Detailed description |
| category | ENUM | No | DeadlineCategory (see enums) |
| jurisdiction | VARCHAR(10) | No | Jurisdiction code (default: "SG") |
| anchor_type | ENUM | No | DeadlineAnchorType (see enums) |
| offset_months | INT | No | Months offset from anchor (default: 0) |
| offset_days | INT | No | Days offset from anchor (default: 0) |
| frequency | ENUM | No | DeadlineFrequency (see enums) |
| generation_type | ENUM | No | DeadlineGenerationType (default: AUTO) |
| statutory_reference | VARCHAR(200) | Yes | Legal reference (e.g., "Companies Act s175") |
| penalty_info | TEXT | Yes | Penalty information for non-compliance |
| applicable_entity_types | TEXT[] | Yes | Entity types this template applies to |
| requires_gst_registration | BOOLEAN | Yes | Only for GST-registered companies |
| requires_audit | BOOLEAN | Yes | Only for audit-required companies |
| requires_charity_status | BOOLEAN | Yes | Only for registered charities |
| requires_ipc_status | BOOLEAN | Yes | Only for IPC-approved charities |
| service_template_code | VARCHAR(50) | Yes | Service code that triggers this deadline |
| is_billable | BOOLEAN | No | Whether deadline work is billable (default: true) |
| default_rate | DECIMAL(18,2) | Yes | Default billing rate |
| default_currency | VARCHAR(3) | No | Currency (default: "SGD") |
| is_active | BOOLEAN | No | Active status (default: true) |
| created_at | TIMESTAMP | No | Record creation time |
| updated_at | TIMESTAMP | No | Last update time |
| deleted_at | TIMESTAMP | Yes | Soft delete timestamp |

**Template Applicability:**
Templates include rules for when they should apply:
- **applicable_entity_types**: Array of EntityType values (e.g., ["PRIVATE_LIMITED", "EXEMPTED_PRIVATE_LIMITED"])
- **requires_gst_registration**: Only generate if company.isGstRegistered = true
- **requires_audit**: Only generate if company requires audit
- **requires_charity_status**: Only generate if company.isRegisteredCharity = true
- **requires_ipc_status**: Only generate if company.ipcApprovalDate is set

**Indexes:**
- `deadline_templates_tenant_id_code_key` UNIQUE on (tenant_id, code)
- `deadline_templates_tenant_id_idx` on tenant_id
- `deadline_templates_category_idx` on category
- `deadline_templates_is_active_idx` on is_active
- `deadline_templates_tenant_id_deleted_at_idx` on (tenant_id, deleted_at)

---

### deadlines

Individual deadline instances generated from templates or created manually.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | UUID | No | Primary key |
| tenant_id | UUID | No | FK to tenants (required) |
| company_id | UUID | No | FK to companies (CASCADE on delete) |
| deadline_template_id | UUID | Yes | FK to deadline_templates (SET NULL on delete) |
| contract_service_id | UUID | Yes | FK to contract_services (SET NULL on delete) |
| title | VARCHAR(300) | No | Deadline title |
| description | TEXT | Yes | Detailed description |
| category | ENUM | No | DeadlineCategory (see enums) |
| reference_code | VARCHAR(100) | Yes | External reference (e.g., filing number) |
| period_label | VARCHAR(50) | No | Period label (e.g., "FY2024", "Q1 2024", "YA2025") |
| statutory_due_date | DATE | No | Original statutory deadline |
| extended_due_date | DATE | Yes | Extended deadline (if EOT granted) |
| eot_reference | VARCHAR(100) | Yes | Extension of time reference number |
| eot_reason | TEXT | Yes | Reason for extension |
| completed_date | DATE | Yes | Actual completion date |
| status | ENUM | No | DeadlineStatus (default: UPCOMING) |
| priority | INT | No | Priority level 1-5 (default: 3) |
| reminder_days | INT[] | No | Days before due to send reminders (default: [30, 14, 7, 1]) |
| last_reminder_sent_at | TIMESTAMP | Yes | Last reminder timestamp |
| assignee_id | UUID | Yes | FK to users (assigned staff) |
| billing_status | ENUM | No | DeadlineBillingStatus (default: NOT_BILLABLE) |
| billed_amount | DECIMAL(18,2) | Yes | Amount billed |
| billed_at | TIMESTAMP | Yes | When billed |
| invoice_reference | VARCHAR(100) | Yes | Invoice reference |
| notes | TEXT | Yes | Internal notes |
| metadata | JSONB | Yes | Additional data |
| created_by_id | UUID | Yes | FK to users who created |
| completed_by_id | UUID | Yes | FK to users who completed |
| created_at | TIMESTAMP | No | Record creation time |
| updated_at | TIMESTAMP | No | Last update time |
| deleted_at | TIMESTAMP | Yes | Soft delete timestamp |

**Deadline Status Flow:**
1. **UPCOMING** - Future deadline, not yet due
2. **DUE_SOON** - Due within 30 days
3. **OVERDUE** - Past due date without completion
4. **IN_PROGRESS** - Work has started
5. **COMPLETED** - Deadline met
6. **WAIVED** - Deadline waived (not applicable)
7. **CANCELLED** - Deadline cancelled

**Period Label Format:**
- Financial Year End: "FY2024" (for deadlines anchored to FYE)
- Year of Assessment: "YA2025" (for tax deadlines)
- Calendar Quarter: "Q1 2024", "Q2 2024"
- Calendar Month: "Jan 2024", "Feb 2024"
- One-time: "2024" or specific description

**Indexes:**
- `deadlines_tenant_id_company_id_template_id_period_key` UNIQUE on (tenant_id, company_id, deadline_template_id, period_label)
- `deadlines_tenant_id_idx` on tenant_id
- `deadlines_company_id_idx` on company_id
- `deadlines_deadline_template_id_idx` on deadline_template_id
- `deadlines_contract_service_id_idx` on contract_service_id
- `deadlines_status_idx` on status
- `deadlines_statutory_due_date_idx` on statutory_due_date
- `deadlines_assignee_id_idx` on assignee_id
- `deadlines_tenant_id_deleted_at_idx` on (tenant_id, deleted_at)
- `deadlines_tenant_id_company_id_idx` on (tenant_id, company_id)
- `deadlines_tenant_id_status_idx` on (tenant_id, status)
- `deadlines_tenant_id_statutory_due_date_idx` on (tenant_id, statutory_due_date)

---

### company_officers

Officer records with appointment history.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | UUID | No | Primary key |
| company_id | UUID | No | FK to companies (CASCADE on delete) |
| contact_id | UUID | Yes | FK to contacts (SET NULL on delete) |
| role | ENUM | No | DIRECTOR, SECRETARY, CEO, etc. |
| name | VARCHAR(200) | No | Officer name (denormalized) |
| identification_type | ENUM | Yes | ID type |
| identification_number | VARCHAR(50) | Yes | ID number |
| nationality | VARCHAR(100) | Yes | Nationality |
| address | TEXT | Yes | Address |
| appointment_date | DATE | Yes | Appointment date |
| cessation_date | DATE | Yes | Cessation date (null if current) |
| is_current | BOOLEAN | No | Current officer flag |
| source_document_id | UUID | Yes | FK to documents |
| created_at | TIMESTAMP | No | Record creation time |
| updated_at | TIMESTAMP | No | Last update time |

---

### company_shareholders

Shareholder records with shareholding details.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | UUID | No | Primary key |
| company_id | UUID | No | FK to companies (CASCADE on delete) |
| contact_id | UUID | Yes | FK to contacts (SET NULL on delete) |
| name | VARCHAR(200) | No | Shareholder name (denormalized) |
| shareholder_type | ENUM | No | INDIVIDUAL or CORPORATE |
| identification_type | ENUM | Yes | ID type |
| identification_number | VARCHAR(50) | Yes | ID number |
| nationality | VARCHAR(100) | Yes | Nationality |
| place_of_origin | VARCHAR(100) | Yes | Place of origin (for corporate shareholders) |
| address | TEXT | Yes | Address |
| share_class | VARCHAR(50) | No | Share class (default: ORDINARY) |
| number_of_shares | INT | No | Number of shares held |
| percentage_held | DECIMAL(5,2) | Yes | Percentage ownership |
| currency | VARCHAR(3) | No | Currency (default: SGD) |
| allotment_date | DATE | Yes | Date shares allotted |
| transfer_date | DATE | Yes | Date shares transferred |
| is_current | BOOLEAN | No | Current shareholder flag |
| source_document_id | UUID | Yes | FK to documents |
| created_at | TIMESTAMP | No | Record creation time |
| updated_at | TIMESTAMP | No | Last update time |

---

### share_capital

Share capital structure.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | UUID | No | Primary key |
| company_id | UUID | No | FK to companies |
| share_class | VARCHAR(50) | No | Share class (default: ORDINARY) |
| currency | VARCHAR(3) | No | Currency (default: SGD) |
| number_of_shares | INT | No | Total shares in class |
| par_value | DECIMAL(18,4) | Yes | Par value per share |
| total_value | DECIMAL(18,2) | No | Total value |
| is_paid_up | BOOLEAN | No | Fully paid up flag |
| is_treasury | BOOLEAN | No | Treasury shares flag (default: false) |
| effective_date | DATE | Yes | Effective date |
| source_document_id | UUID | Yes | FK to documents |
| created_at | TIMESTAMP | No | Record creation time |
| updated_at | TIMESTAMP | No | Last update time |

---

### company_charges

Charges and encumbrances.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | UUID | No | Primary key |
| company_id | UUID | No | FK to companies |
| charge_holder_id | UUID | Yes | FK to contacts |
| charge_number | VARCHAR(50) | Yes | Charge reference number |
| charge_type | VARCHAR(100) | Yes | Type of charge |
| description | TEXT | Yes | Charge description |
| charge_holder_name | VARCHAR(200) | No | Charge holder name |
| amount_secured | DECIMAL(18,2) | Yes | Amount secured (numeric) |
| amount_secured_text | VARCHAR(100) | Yes | Amount secured as text (e.g., "All Monies") |
| currency | VARCHAR(3) | Yes | Currency (default: SGD) |
| registration_date | DATE | Yes | Registration date |
| discharge_date | DATE | Yes | Discharge date |
| is_fully_discharged | BOOLEAN | No | Fully discharged flag |
| source_document_id | UUID | Yes | FK to documents |
| created_at | TIMESTAMP | No | Record creation time |
| updated_at | TIMESTAMP | No | Last update time |

---

### documents

Document storage and extraction tracking. Each document belongs to a tenant.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | UUID | No | Primary key |
| tenant_id | UUID | No | FK to tenants (required) |
| company_id | UUID | No | FK to companies |
| uploaded_by_id | UUID | No | FK to users |
| document_type | VARCHAR(50) | No | BIZFILE, CONSTITUTION, etc. |
| file_name | VARCHAR(255) | No | Stored filename |
| original_file_name | VARCHAR(255) | No | Original filename |
| file_path | VARCHAR(500) | No | File storage path |
| file_size | INT | No | File size in bytes |
| mime_type | VARCHAR(100) | No | MIME type |
| extracted_at | TIMESTAMP | Yes | Extraction timestamp |
| extraction_status | VARCHAR(20) | Yes | PENDING, PROCESSING, COMPLETED, FAILED |
| extraction_error | TEXT | Yes | Error message if failed |
| extracted_data | JSONB | Yes | Raw extracted JSON data |
| version | INT | No | Document version (default: 1) |
| is_latest | BOOLEAN | No | Latest version flag |
| previous_version_id | UUID | Yes | FK to previous version |
| created_at | TIMESTAMP | No | Record creation time |
| updated_at | TIMESTAMP | No | Last update time |

---

### audit_logs

Complete audit trail. Tenant ID is optional for system-level events.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | UUID | No | Primary key |
| tenant_id | UUID | Yes | FK to tenants (optional for system events) |
| user_id | UUID | Yes | FK to users |
| company_id | UUID | Yes | FK to companies |
| action | ENUM | No | See AuditAction enum below |
| entity_type | VARCHAR(50) | No | Table/model name |
| entity_id | VARCHAR(50) | No | Record ID |
| change_source | ENUM | No | MANUAL, BIZFILE_UPLOAD, API, SYSTEM |
| changes | JSONB | Yes | Field changes {field: {old, new}} |
| reason | TEXT | Yes | Reason (required for DELETE) |
| metadata | JSONB | Yes | Additional context |
| ip_address | VARCHAR(45) | Yes | Client IP address |
| user_agent | TEXT | Yes | Browser user agent |
| request_id | VARCHAR | Yes | For correlating related operations |
| session_id | VARCHAR | Yes | For tracking user sessions |
| created_at | TIMESTAMP | No | Record creation time |

**Indexes:**
- `audit_logs_tenant_id_idx` on tenant_id
- `audit_logs_user_id_idx` on user_id
- `audit_logs_company_id_idx` on company_id
- `audit_logs_entity_idx` on (entity_type, entity_id)
- `audit_logs_action_idx` on action
- `audit_logs_created_at_idx` on created_at
- `audit_logs_tenant_id_created_at_idx` on (tenant_id, created_at)
- `audit_logs_tenant_id_entity_type_idx` on (tenant_id, entity_type)
- `audit_logs_request_id_idx` on request_id

---

## Enums

### TenantStatus
```sql
ACTIVE
SUSPENDED
PENDING_SETUP
DEACTIVATED
```

### EntityType
```sql
PRIVATE_LIMITED                       -- Private Company Limited by Shares
EXEMPTED_PRIVATE_LIMITED              -- Exempt Private Company Limited by Shares
PUBLIC_LIMITED                        -- Public Company Limited by Shares
PUBLIC_COMPANY_LIMITED_BY_GUARANTEE   -- Public Company Limited by Guarantee (non-profit)
SOLE_PROPRIETORSHIP
PARTNERSHIP
LIMITED_PARTNERSHIP
LIMITED_LIABILITY_PARTNERSHIP
FOREIGN_COMPANY
VARIABLE_CAPITAL_COMPANY
OTHER
```

### CompanyStatus
```sql
LIVE
STRUCK_OFF
WINDING_UP
DISSOLVED
IN_LIQUIDATION
IN_RECEIVERSHIP
AMALGAMATED
CONVERTED
OTHER
```

### OfficerRole
```sql
DIRECTOR
MANAGING_DIRECTOR
ALTERNATE_DIRECTOR
SECRETARY
CEO
CFO
AUDITOR
LIQUIDATOR
RECEIVER
JUDICIAL_MANAGER
```

### ContactType
```sql
INDIVIDUAL
CORPORATE
```

### IdentificationType
```sql
NRIC
FIN
PASSPORT
UEN
OTHER
```

### AddressType
```sql
REGISTERED_OFFICE
MAILING
RESIDENTIAL
BUSINESS
```

### ContactDetailType
```sql
EMAIL
PHONE
FAX
MOBILE
WEBSITE
OTHER
```

### ContractType
```sql
ENGAGEMENT_LETTER    -- Engagement letters for professional services
SERVICE_AGREEMENT    -- General service agreements
RETAINER_CONTRACT    -- Retainer arrangements
NDA                  -- Non-disclosure agreements
VENDOR_AGREEMENT     -- Agreements with vendors
OTHER                -- Other contract types
```

### ContractStatus
```sql
DRAFT                -- Contract in draft, not yet active
ACTIVE               -- Active contract
TERMINATED           -- Contract has been terminated
```

### ServiceType
```sql
RECURRING            -- Recurring service (monthly, quarterly, annually)
ONE_TIME             -- One-time service
```

### ServiceStatus
```sql
ACTIVE               -- Service is currently active
COMPLETED            -- Service has been completed
CANCELLED            -- Service was cancelled
PENDING              -- Service is pending activation
```

### BillingFrequency
```sql
MONTHLY              -- Monthly billing
QUARTERLY            -- Quarterly billing
SEMI_ANNUALLY        -- Semi-annual billing
ANNUALLY             -- Annual billing
ONE_TIME             -- One-time billing (for one-time services)
```

### GstFilingFrequency
```sql
MONTHLY              -- Monthly GST filing (for higher revenue companies)
QUARTERLY            -- Quarterly GST filing (default)
```

### DeadlineCategory
```sql
CORPORATE_SECRETARY  -- Corporate secretarial deadlines (AGM, AR, etc.)
TAX                  -- Tax-related deadlines (ECI, Corporate Tax, etc.)
ACCOUNTING           -- Accounting deadlines (accounts preparation)
AUDIT                -- Audit deadlines
COMPLIANCE           -- General compliance deadlines
OTHER                -- Other deadlines
```

### DeadlineStatus
```sql
UPCOMING             -- Future deadline, not yet due
DUE_SOON             -- Due within 30 days (system-calculated)
OVERDUE              -- Past due date without completion
IN_PROGRESS          -- Work has started
COMPLETED            -- Deadline met
WAIVED               -- Deadline waived (not applicable)
CANCELLED            -- Deadline cancelled
```

### DeadlineBillingStatus
```sql
NOT_BILLABLE         -- Not billable work
PENDING              -- Billable, not yet invoiced
INVOICED             -- Invoice sent
PAID                 -- Payment received
WRITTEN_OFF          -- Written off (bad debt)
```

### DeadlineAnchorType
```sql
FYE                  -- Anchored to Financial Year End
SERVICE_START        -- Anchored to service start date
FIXED_CALENDAR       -- Fixed calendar date (e.g., Nov 30 for ECI)
QUARTER_END          -- Quarter end date
MONTH_END            -- Month end date
INCORPORATION        -- Company incorporation date
IPC_EXPIRY           -- IPC approval expiry date
```

### DeadlineFrequency
```sql
ANNUALLY             -- Annual deadline
QUARTERLY            -- Quarterly deadline
MONTHLY              -- Monthly deadline
ONE_TIME             -- One-time deadline
```

### DeadlineGenerationType
```sql
AUTO                 -- Auto-generated based on company attributes
SERVICE_LINKED       -- Generated when service is added to contract
MANUAL               -- Manually created
```

### AuditAction
```sql
-- CRUD Operations
CREATE
UPDATE
DELETE
RESTORE

-- Document Operations
UPLOAD
DOWNLOAD
EXTRACT

-- Authentication Events
LOGIN
LOGOUT
LOGIN_FAILED
PASSWORD_CHANGED
PASSWORD_RESET_REQUESTED
PASSWORD_RESET_COMPLETED
PASSWORD_CHANGE_REQUIRED
PASSWORD_CHANGE_CLEARED

-- Access Control
PERMISSION_GRANTED
PERMISSION_REVOKED
ROLE_CHANGED

-- Tenant Operations
TENANT_CREATED
TENANT_UPDATED
TENANT_SUSPENDED
TENANT_ACTIVATED
USER_INVITED
USER_REMOVED

-- User Company Assignment
USER_COMPANY_ASSIGNED
USER_COMPANY_UPDATED
USER_COMPANY_REMOVED

-- Data Operations
EXPORT
IMPORT
BULK_UPDATE

-- Connector Operations
CONNECTOR_CREATED
CONNECTOR_UPDATED
CONNECTOR_DELETED
CONNECTOR_TESTED
CONNECTOR_ENABLED
CONNECTOR_DISABLED
CONNECTOR_ACCESS_UPDATED

-- Deadline Operations
DEADLINE_CREATED
DEADLINE_UPDATED
DEADLINE_COMPLETED
DEADLINE_REOPENED
DEADLINE_DELETED
DEADLINE_BULK_ASSIGNED
DEADLINE_BULK_STATUS_UPDATED
DEADLINES_GENERATED
```

### ChangeSource
```sql
MANUAL
BIZFILE_UPLOAD
API
SYSTEM
```

### ConnectorType
```sql
AI_PROVIDER
STORAGE
```

### ConnectorProvider
```sql
OPENAI
ANTHROPIC
GOOGLE
ONEDRIVE
```

---

## RBAC Tables

### roles

Role definitions for fine-grained access control.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | UUID | No | Primary key |
| tenant_id | UUID | Yes | FK to tenants (null for global SUPER_ADMIN role) |
| name | VARCHAR | No | Role name (unique per tenant) |
| description | TEXT | Yes | Role description |
| is_system | BOOLEAN | No | System role (cannot be deleted) |
| system_role_type | VARCHAR | Yes | System role identifier: `SUPER_ADMIN`, `TENANT_ADMIN`, or null |
| created_at | TIMESTAMP | No | Record creation time |
| updated_at | TIMESTAMP | No | Last update time |

**System Role Types:**
- `SUPER_ADMIN` - Global role with `tenant_id = null`, full system access
- `TENANT_ADMIN` - Tenant-scoped role, full access within tenant (Users, Roles, Audit Logs, all Companies)
- `COMPANY_ADMIN` - Company-scoped role, manage assigned company and its data
- `COMPANY_USER` - Company-scoped role, view-only access to assigned company
- `null` - Custom role with configurable permissions

**Indexes:**
- `roles_tenant_id_name_key` UNIQUE on (tenant_id, name)
- `roles_tenant_id_idx` on tenant_id
- `roles_system_role_type_idx` on system_role_type

---

### permissions

Permission definitions for RBAC.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | UUID | No | Primary key |
| resource | VARCHAR | No | Resource name (company, document, user, etc.) |
| action | VARCHAR | No | Action type (create, read, update, delete, export) |
| description | TEXT | Yes | Permission description |

**Indexes:**
- `permissions_resource_action_key` UNIQUE on (resource, action)
- `permissions_resource_idx` on resource

---

### role_permissions

Links roles to permissions.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | UUID | No | Primary key |
| role_id | UUID | No | FK to roles |
| permission_id | UUID | No | FK to permissions |
| created_at | TIMESTAMP | No | Record creation time |

**Indexes:**
- `role_permissions_role_id_permission_id_key` UNIQUE on (role_id, permission_id)
- `role_permissions_role_id_idx` on role_id
- `role_permissions_permission_id_idx` on permission_id

---

### user_role_assignments

Links users to roles with optional company scope. This table is the authoritative source for user permissions and company access.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | UUID | No | Primary key |
| user_id | UUID | No | FK to users |
| role_id | UUID | No | FK to roles |
| company_id | UUID | Yes | Optional company scope (null = tenant-wide) |
| created_at | TIMESTAMP | No | Record creation time |

**Multi-Company Access:**
- Users can have multiple role assignments, each scoped to a different company
- The session's `companyIds` array is computed from all role assignments with non-null `company_id`
- When checking permissions for a specific company, company-specific roles override tenant-wide roles
- If no company-specific role exists, the system falls back to tenant-wide roles (company_id = null)

**Permission Resolution Priority:**
1. Company-specific role assignments (most specific)
2. Tenant-wide role assignments (company_id = null)
3. System role types (SUPER_ADMIN, TENANT_ADMIN) bypass individual permissions

**Indexes:**
- `user_role_assignments_user_id_role_id_company_id_key` UNIQUE on (user_id, role_id, company_id)
- `user_role_assignments_user_id_idx` on user_id
- `user_role_assignments_role_id_idx` on role_id
- `user_role_assignments_company_id_idx` on company_id

---

### user_company_assignments

Multi-company user assignments. Tracks which companies a user can access. Permissions are controlled separately through `user_role_assignments` with company-specific role scoping.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | UUID | No | Primary key |
| user_id | UUID | No | FK to users |
| company_id | UUID | No | FK to companies |
| is_primary | BOOLEAN | No | Whether this is the user's primary company |
| created_at | TIMESTAMP | No | Record creation time |
| updated_at | TIMESTAMP | No | Last update time |

**Note:** Permissions are NOT stored here. Use `user_role_assignments` with `company_id` to assign company-specific roles. A role assignment with `company_id = NULL` applies to all companies.

**Indexes:**
- `user_company_assignments_user_id_company_id_key` UNIQUE on (user_id, company_id)
- `user_company_assignments_user_id_idx` on user_id
- `user_company_assignments_company_id_idx` on company_id

---

## Connectors Tables

### connectors

External service connector configuration with encrypted credentials.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | UUID | No | Primary key |
| tenant_id | UUID | Yes | FK to tenants (null = system connector) |
| name | VARCHAR | No | Display name |
| type | ENUM | No | ConnectorType (AI_PROVIDER, STORAGE) |
| provider | ENUM | No | ConnectorProvider (OPENAI, ANTHROPIC, GOOGLE, ONEDRIVE) |
| credentials | TEXT | No | AES-256-GCM encrypted JSON credentials |
| settings | JSONB | Yes | Provider-specific configuration |
| is_enabled | BOOLEAN | No | Connector enabled status (default: true) |
| is_default | BOOLEAN | No | Default connector for type (default: false) |
| call_count | INT | No | Usage counter (default: 0) |
| last_used_at | TIMESTAMP | Yes | Last successful call |
| last_tested_at | TIMESTAMP | Yes | Last connection test time |
| last_test_result | VARCHAR | Yes | "success" or "error:message" |
| created_at | TIMESTAMP | No | Record creation time |
| updated_at | TIMESTAMP | No | Last update time |
| deleted_at | TIMESTAMP | Yes | Soft delete timestamp |

**AI Provider Settings (Recommended Structure):**
```json
{
  "defaultModel": "gpt-4.1-mini",
  "costControl": {
    "enabled": true,
    "currency": "USD",
    "period": "MONTHLY",
    "timezone": "UTC",
    "hardLimitMicrosUsd": 50000000,
    "softLimitMicrosUsd": 40000000,
    "perRequestMaxMicrosUsd": 250000,
    "reserveBeforeCall": true,
    "failMode": "BLOCK",
    "fallbackConnectorId": "optional-uuid",
    "allowReadOnlyFallback": true
  }
}
```

**Hard Cost Control (Connector-Level):**
1. Budget checks execute before provider call at connector middleware layer
2. Request is blocked when projected cost exceeds `perRequestMaxMicrosUsd`
3. Request is blocked when period usage + reservation exceeds `hardLimitMicrosUsd`
4. Cost controls are enforced per tenant connector (or system connector with tenant access scope)

**System vs Tenant Connectors:**
- `tenant_id = NULL` - System connector, managed by SUPER_ADMIN only
- `tenant_id = <id>` - Tenant connector, managed by TENANT_ADMIN

**Resolution Logic:**
1. Check tenant-specific connector → use if exists & enabled
2. Check TenantConnectorAccess for system connector → skip if disabled
3. Check system connector → use if exists & enabled
4. Feature unavailable

**Indexes:**
- `connectors_tenant_id_provider_deleted_at_key` UNIQUE on (tenant_id, provider, deleted_at)
- `connectors_tenant_id_idx` on tenant_id
- `connectors_type_provider_idx` on (type, provider)
- `connectors_deleted_at_idx` on deleted_at

---

### tenant_connector_access

Per-tenant access control for system connectors (SUPER_ADMIN only).

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | UUID | No | Primary key |
| tenant_id | UUID | No | FK to tenants |
| connector_id | UUID | No | FK to connectors |
| is_enabled | BOOLEAN | No | Access enabled (default: true, false = blocked) |
| created_at | TIMESTAMP | No | Record creation time |
| updated_at | TIMESTAMP | No | Last update time |

**Use Case:** Allows SUPER_ADMIN to enable/disable system connectors per tenant. For example, enable AI features for Tenant A but not Tenant B.

**Indexes:**
- `tenant_connector_access_tenant_id_connector_id_key` UNIQUE on (tenant_id, connector_id)
- `tenant_connector_access_tenant_id_idx` on tenant_id
- `tenant_connector_access_connector_id_idx` on connector_id

---

### connector_usage_logs

Detailed usage logging for connectors with cost tracking.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | UUID | No | Primary key |
| connector_id | UUID | No | FK to connectors (CASCADE on delete) |
| tenant_id | UUID | Yes | FK to tenants - tenant that made the call |
| user_id | UUID | Yes | FK to users - user who triggered the call |
| model | VARCHAR | No | AI model ID (e.g., "gpt-4.1") |
| provider | VARCHAR | No | Provider name (openai, anthropic, google) |
| input_tokens | INT | No | Number of input tokens (default: 0) |
| output_tokens | INT | No | Number of output tokens (default: 0) |
| total_tokens | INT | No | Total tokens (default: 0) |
| cost_cents | INT | No | Cost in micro-dollars (1/10000 USD) for 4 decimal precision (default: 0) |
| latency_ms | INT | Yes | Response time in milliseconds |
| operation | VARCHAR | Yes | Operation type (e.g., "bizfile_extraction") |
| success | BOOLEAN | No | Whether call succeeded (default: true) |
| error_message | TEXT | Yes | Error details if failed |
| metadata | JSONB | Yes | Additional context (document ID, etc.) |
| created_at | TIMESTAMP | No | Record creation time |

**Use Case:** Provides detailed usage tracking for billing, analytics, and auditing. Includes token usage, cost calculation, latency metrics, and operation context.

**Budget Enforcement Dependency:**
- This table is the source of truth for period spend aggregation used by connector hard cost controls.

**Indexes:**
- `connector_usage_logs_connector_id_idx` on connector_id
- `connector_usage_logs_tenant_id_idx` on tenant_id
- `connector_usage_logs_user_id_idx` on user_id
- `connector_usage_logs_created_at_idx` on created_at
- `connector_usage_logs_connector_id_created_at_idx` on (connector_id, created_at)
- `connector_usage_logs_tenant_id_created_at_idx` on (tenant_id, created_at)

---

## Document Generation Module Tables

### document_templates

Reusable document templates with placeholder support.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | UUID | No | Primary key |
| tenant_id | UUID | No | FK to tenants (required) |
| name | VARCHAR(200) | No | Template name (unique per tenant) |
| description | TEXT | Yes | Template description |
| category | ENUM | No | Template category (see DocumentTemplateCategory) |
| composition_type | ENUM | No | `STANDARD`, `SERVICE_AGREEMENT` or `RESOLUTION` (default: `STANDARD`) |
| resolution_preset | JSONB | Yes | `RESOLUTION` only: `{ subject, sections }` new documents start with |
| content | TEXT | No | HTML content with placeholders |
| content_json | JSONB | Yes | TipTap JSON format (for editor state) |
| placeholders | JSONB | No | Array of placeholder definitions (default: []) |
| is_active | BOOLEAN | No | Active status (default: true) |
| version | INT | No | Template version (increments on update) |
| created_by_id | UUID | No | FK to users |
| created_at | TIMESTAMP | No | Record creation time |
| updated_at | TIMESTAMP | No | Last update time |
| deleted_at | TIMESTAMP | Yes | Soft delete timestamp |

**Placeholder Definition Schema:**
```json
{
  "key": "company.name",
  "label": "Company Name",
  "type": "text|textarea|date|number|currency|list|conditional",
  "source": "company|contact|officer|shareholder|service|custom|system",
  "path": "name",
  "defaultValue": "",
  "format": "dd MMMM yyyy",
  "required": true
}
```

**Indexes:**
- `document_templates_tenant_id_idx` on tenant_id
- `document_templates_category_idx` on category
- `document_templates_is_active_idx` on is_active
- `document_templates_tenant_id_deleted_at_idx` on (tenant_id, deleted_at)

---

### generated_documents

Documents created from templates or blank.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | UUID | No | Primary key |
| tenant_id | UUID | No | FK to tenants (required) |
| template_id | UUID | Yes | FK to document_templates (null for blank docs) |
| template_version | INT | Yes | Snapshot of template version used |
| company_id | UUID | Yes | FK to companies (optional) |
| title | VARCHAR(300) | No | Document title |
| content | TEXT | No | Resolved HTML content |
| content_json | JSONB | Yes | TipTap JSON format |
| status | ENUM | No | Document status (see GeneratedDocumentStatus) |
| finalized_at | TIMESTAMP | Yes | When document was finalized |
| finalized_by_id | UUID | Yes | FK to users who finalized |
| unfinalized_at | TIMESTAMP | Yes | Last time un-finalized |
| signed_at | TIMESTAMP | Yes | Completion time of the first successfully completed linked E-signing envelope |
| use_letterhead | BOOLEAN | No | Include letterhead in PDF (default: true) |
| placeholder_data | JSONB | Yes | Snapshot of data used for placeholders |
| metadata | JSONB | Yes | Additional metadata |
| created_by_id | UUID | No | FK to users |
| created_at | TIMESTAMP | No | Record creation time |
| updated_at | TIMESTAMP | No | Last update time |
| deleted_at | TIMESTAMP | Yes | Soft delete timestamp |

**Computed placeholder context and selected-party snapshot:**

The generator computes the following values at render time and stores the
resolved context in `placeholder_data`. When a generated document is created,
the selected record IDs are also stored under `metadata.selectedParties`:

```json
{
  "placeholder_data": {
    "company": {
      "address": {
        "block": "1",
        "street": "Example Street",
        "level": "02",
        "unit": "03",
        "building": "Oakcloud Tower",
        "postalCode": "123456",
        "letter": "Oakcloud Tower\n1 Example Street, #02-03\nSingapore  123456"
      }
    },
    "selectedDirector": {
      "id": "66666666-6666-4666-8666-666666666666",
      "name": "Alex Director",
      "email": "alex@example.com",
      "phone": "+65 6123 4567",
      "address": {
        "full": "10 Director Road\nSingapore  123456",
        "letter": "10 Director Road\nSingapore  123456"
      }
    },
    "selectedShareholder": {
      "id": "77777777-7777-4777-8777-777777777777",
      "name": "Sam Shareholder",
      "email": "sam@example.com",
      "phone": "+65 6234 5678",
      "address": {
        "full": "20 Shareholder Avenue\nSingapore  234567",
        "letter": "20 Shareholder Avenue\nSingapore  234567"
      }
    },
    "selectedContact": {
      "id": "88888888-8888-4888-8888-888888888888",
      "name": "Casey Contact",
      "email": "casey@example.com",
      "phone": "+65 6345 6789",
      "address": {
        "full": "30 Contact Lane\nSingapore  345678",
        "letter": "30 Contact Lane\nSingapore  345678"
      }
    },
    "system": {
      "preparerName": "Taylor User",
      "generatedBy": "Taylor User"
    }
  },
  "metadata": {
    "selectedParties": {
      "directorId": "66666666-6666-4666-8666-666666666666",
      "directorIds": ["66666666-6666-4666-8666-666666666666"],
      "shareholderId": "77777777-7777-4777-8777-777777777777",
      "contactId": "88888888-8888-4888-8888-888888888888"
    }
  }
}
```

`selectedDirector`, `selectedShareholder`, and `selectedContact` are singular
computed contexts. The root-level `directors` loop contains all current
directors unless an explicit `selectedDirectorIds` subset was supplied;
`selectedContactId` populates only `selectedContact`. The
backward-compatible `contact`, `contacts`, and `custom.contacts` contexts come
only from the legacy `contactIds` multi-contact input or an explicit server-side
context override. The singular selected-contact and legacy multi-contact
contracts remain independent even when both IDs are supplied in one request.

For generated documents, `system.generatedBy` is persisted as the
backward-compatible alias of `system.preparerName`. Placeholder resolution uses
bidirectional fallback: if `preparerName` is absent it uses `generatedBy`, and
if `generatedBy` is absent it uses `preparerName`.

`company.address.letter`, the selected-party address values,
`system.preparerName`, `system.generatedBy`, and the `selectedParties` metadata
snapshot are computed values; they require no database migration or new
columns. For recognized single-line Singapore addresses, `formatLetterAddress`
preserves a selected party's normalized source as `address.full` and derives
its multi-line `address.letter`. The company context instead stores the
structured `block`, `street`, `level`, `unit`, `building`, and `postalCode`
components plus the computed `letter`; it does not add `company.address.full`.
Meaningful structured company columns always determine
`company.address.letter`, even when the source `full_address` is present but
stale.

**Indexes:**
- `generated_documents_tenant_id_idx` on tenant_id
- `generated_documents_template_id_idx` on template_id
- `generated_documents_company_id_idx` on company_id
- `generated_documents_status_idx` on status
- `generated_documents_created_by_id_idx` on created_by_id
- `generated_documents_tenant_id_deleted_at_idx` on (tenant_id, deleted_at)
- `generated_documents_tenant_id_signed_at_idx` on (tenant_id, signed_at)

---

### document_generation_batches

One aggregate per resumable multi-template generation workspace.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | UUID | No | Primary key |
| tenant_id | UUID | No | FK to tenants (CASCADE) |
| primary_company_id | UUID | Yes | FK to companies (RESTRICT) |
| created_by_id | UUID | No | FK to users (RESTRICT) |
| active_item_id | UUID | Yes | FK to document_generation_batch_items (SET NULL) |
| current_stage | INT | No | 0..3 stage index |
| revision | INT | No | Optimistic-lock revision, incremented per mutation |
| status | ENUM | No | DRAFT, PARTIAL, or COMPLETED |
| master_field_values | JSONB | No | Values keyed by master-field ID |
| task_context | JSONB | Yes | Task launch context |
| created_at / updated_at / deleted_at | TIMESTAMP | — | Lifecycle timestamps |

### document_generation_batch_items

One ordered item per selected template, owning one hidden generated document.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | UUID | No | Primary key |
| tenant_id | UUID | No | FK to tenants (CASCADE) |
| batch_id | UUID | No | FK to document_generation_batches (CASCADE) |
| template_id | UUID | No | FK to document_templates (RESTRICT) |
| generated_document_id | UUID | No | Unique FK to generated_documents (CASCADE) |
| template_version | INT | No | Configured template version |
| display_order | INT | No | Order within the batch |
| status | ENUM | No | NOT_STARTED, NEEDS_INPUT, READY, GENERATING, GENERATED, FAILED, BLOCKED |
| configuration | JSONB | No | Versioned item configuration |
| preview_content / edited_content | TEXT | Yes | Rendered and edited HTML |
| edited_content_json | JSONB | Yes | Structured editor content |
| preview_fingerprint / reviewed_fingerprint | VARCHAR(64) | Yes | Content-bound hashes |
| validation_diagnostics / last_error | JSONB | Yes | Safe structured diagnostics |
| generation_attempt_id | VARCHAR(36) | Yes | Claim token |
| generation_claimed_at | TIMESTAMP | Yes | Claim time (15-minute staleness) |

Unique constraints: `(batch_id, display_order)` and `generated_document_id`. A
template can appear more than once in a batch; `(batch_id, template_id)` is a
plain index. Indexes also cover `(tenant_id, batch_id, display_order)` and
`(tenant_id, status, generation_claimed_at)`.

### DocumentGenerationBatchStatus
```sql
DRAFT
PARTIAL
COMPLETED
```

### DocumentGenerationBatchItemStatus
```sql
NOT_STARTED
NEEDS_INPUT
READY
GENERATING
GENERATED
FAILED
BLOCKED
```

---

### document_sections

Navigation sections for generated documents.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | UUID | No | Primary key |
| document_id | UUID | No | FK to generated_documents (CASCADE) |
| title | VARCHAR(200) | No | Section title |
| anchor | VARCHAR(100) | No | HTML anchor ID for navigation |
| order | INT | No | Display order |
| level | INT | No | Heading level 1-3 (default: 1) |
| page_break_before | BOOLEAN | No | Insert page break (default: false) |
| created_at | TIMESTAMP | No | Record creation time |

**Indexes:**
- `document_sections_document_id_idx` on document_id
- `document_sections_document_id_order_idx` on (document_id, order)

---

### document_shares

Shareable links for documents with access control.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | UUID | No | Primary key |
| document_id | UUID | No | FK to generated_documents (CASCADE) |
| share_token | VARCHAR(64) | No | Unique share token (UNIQUE) |
| expires_at | TIMESTAMP | Yes | Link expiration time |
| password_hash | VARCHAR(255) | Yes | Bcrypt password hash |
| is_active | BOOLEAN | No | Active status (default: true) |
| view_count | INT | No | Number of views (default: 0) |
| last_viewed_at | TIMESTAMP | Yes | Last view timestamp |
| allowed_actions | TEXT[] | No | Allowed actions (default: ["view"]) |
| allow_comments | BOOLEAN | No | Allow external comments (default: false) |
| comment_rate_limit | INT | No | Max comments/hour/IP (default: 20) |
| notify_on_comment | BOOLEAN | No | Notify on new comment (default: false) |
| notify_on_view | BOOLEAN | No | Notify on view (default: false) |
| created_by_id | UUID | No | FK to users |
| created_at | TIMESTAMP | No | Record creation time |
| revoked_at | TIMESTAMP | Yes | When link was revoked |

**Indexes:**
- `document_shares_document_id_idx` on document_id
- `document_shares_share_token_key` UNIQUE on share_token
- `document_shares_expires_at_idx` on expires_at

---

### tenant_letterheads

Tenant letterhead configuration for PDF export.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | UUID | No | Primary key |
| tenant_id | UUID | No | FK to tenants (UNIQUE, one per tenant) |
| header_html | TEXT | Yes | HTML header content |
| footer_html | TEXT | Yes | HTML footer content |
| header_image_url | VARCHAR(500) | Yes | Header image URL |
| footer_image_url | VARCHAR(500) | Yes | Footer image URL |
| logo_url | VARCHAR(500) | Yes | Logo URL |
| page_margins | JSONB | No | Margins in mm (default: top:25, right:20, bottom:25, left:20) |
| is_enabled | BOOLEAN | No | Letterhead enabled (default: true) |
| created_at | TIMESTAMP | No | Record creation time |
| updated_at | TIMESTAMP | No | Last update time |

**Indexes:**
- `tenant_letterheads_tenant_id_key` UNIQUE on tenant_id

---

### document_comments

Comments on documents.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | UUID | No | Primary key |
| document_id | UUID | No | FK to generated_documents (CASCADE) |
| user_id | UUID | Yes | FK to users |
| guest_name | VARCHAR(100) | Yes | Guest commenter name |
| guest_email | VARCHAR(255) | Yes | Guest commenter email |
| content | VARCHAR(1000) | No | Comment content (max 1000 chars) |
| selection_start | INT | Yes | Text selection start position |
| selection_end | INT | Yes | Text selection end position |
| selected_text | TEXT | Yes | Selected text snippet |
| parent_id | UUID | Yes | FK to document_comments (for replies) |
| status | ENUM | No | Comment status (OPEN/RESOLVED) |
| resolved_by_id | UUID | Yes | FK to users who resolved |
| resolved_at | TIMESTAMP | Yes | Resolution timestamp |
| hidden_at | TIMESTAMP | Yes | When comment was hidden (moderation) |
| hidden_by_id | UUID | Yes | FK to users who hid |
| hidden_reason | VARCHAR(255) | Yes | Reason for hiding |
| ip_address | VARCHAR(45) | Yes | Commenter IP |
| created_at | TIMESTAMP | No | Record creation time |
| updated_at | TIMESTAMP | No | Last update time |
| deleted_at | TIMESTAMP | Yes | Soft delete timestamp |

**Indexes:**
- `document_comments_document_id_idx` on document_id
- `document_comments_user_id_idx` on user_id
- `document_comments_parent_id_idx` on parent_id
- `document_comments_status_idx` on status
- `document_comments_ip_address_created_at_idx` on (ip_address, created_at)

---

### document_drafts

Auto-save storage for document editing.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | UUID | No | Primary key |
| document_id | UUID | No | FK to generated_documents (CASCADE) |
| user_id | UUID | No | FK to users |
| content | TEXT | No | Draft content |
| content_json | JSONB | Yes | TipTap JSON format |
| metadata | JSONB | Yes | Additional metadata |
| created_at | TIMESTAMP | No | Record creation time |

**Notes:**
- Only latest draft per user per document is kept
- Old drafts are deleted when new one is saved

**Indexes:**
- `document_drafts_document_id_idx` on document_id
- `document_drafts_user_id_created_at_idx` on (user_id, created_at)

---

### forms

Top-level form definitions for the Forms module.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | UUID | No | Primary key |
| tenant_id | UUID | No | FK to tenants |
| title | VARCHAR | No | Form title |
| description | TEXT | Yes | Public/internal description |
| slug | VARCHAR | No | Public slug (unique) |
| status | ENUM | No | `DRAFT`, `PUBLISHED`, `ARCHIVED` |
| tags | TEXT[] | No | Freeform tags |
| settings | JSONB | Yes | Builder settings payload |
| views_count | INT | No | Denormalized public view counter |
| submissions_count | INT | No | Denormalized completed submission counter |
| created_by_id | UUID | Yes | FK to users |
| updated_by_id | UUID | Yes | FK to users |
| created_at | TIMESTAMP | No | Record creation time |
| updated_at | TIMESTAMP | No | Last update time |
| deleted_at | TIMESTAMP | Yes | Soft delete timestamp |

**Notes:**

- `settings` stores response-table configuration, notification recipients, draft settings, AI settings, PDF filename template, i18n configuration, and branding toggles such as `hideLogo` and `hideFooter`.
- Public forms are served only when `status = PUBLISHED` and `deleted_at IS NULL`.

**Indexes:**

- `forms_tenant_id_status_deleted_at_idx` on (tenant_id, status, deleted_at)
- `forms_tenant_id_created_at_idx` on (tenant_id, created_at)
- `forms_slug_key` UNIQUE on slug
- `forms_slug_idx` on slug

---

### form_fields

Field definitions belonging to a form.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | UUID | No | Primary key |
| form_id | UUID | No | FK to forms |
| tenant_id | UUID | No | FK to tenants |
| type | ENUM | No | Field type (`SHORT_TEXT`, `FILE_UPLOAD`, `PAGE_BREAK`, etc.) |
| label | VARCHAR | Yes | Field label |
| field_key | VARCHAR | No | Stable answer key unique within a form |
| placeholder | VARCHAR | Yes | Placeholder text |
| subtext | TEXT | Yes | Supporting text shown under the field |
| help_text | TEXT | Yes | Optional help / tooltip content |
| input_type | VARCHAR | Yes | Subtype such as `email`, `date`, `info_image`, `repeat_start` |
| options | JSONB | Yes | Choice options for select/radio/checkbox fields |
| validation | JSONB | Yes | Validation settings, upload settings, repeat config, info-block config |
| condition | JSONB | Yes | Conditional visibility rule |
| is_required | BOOLEAN | No | Required flag |
| hide_label | BOOLEAN | No | Hide visible label in the renderer |
| is_read_only | BOOLEAN | No | Read-only field flag |
| layout_width | INT | No | Grid width token (`25`, `33`, `50`, `66`, `75`, `100`) |
| position | INT | No | Order within the form |
| created_at | TIMESTAMP | No | Record creation time |
| updated_at | TIMESTAMP | No | Last update time |

**Indexes:**

- `form_fields_form_id_field_key_key` UNIQUE on (form_id, field_key)
- `form_fields_form_id_position_idx` on (form_id, position)
- `form_fields_tenant_id_form_id_idx` on (tenant_id, form_id)

---

### form_submissions

Completed or flagged form responses.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | UUID | No | Primary key |
| form_id | UUID | No | FK to forms |
| tenant_id | UUID | No | FK to tenants |
| status | ENUM | No | `COMPLETED`, `PARTIAL`, `SPAM` |
| respondent_name | VARCHAR | Yes | Optional captured respondent name |
| respondent_email | VARCHAR | Yes | Optional captured respondent email |
| answers | JSONB | No | Submitted answer payload keyed by field key |
| metadata | JSONB | Yes | Submission metadata, including AI review payload when present |
| ai_review_status | VARCHAR | Yes | Queue / processing status mirror for internal review |
| has_unresolved_ai_warning | BOOLEAN | No | Fast filter for unresolved AI warning state |
| submitted_at | TIMESTAMP | No | Submission timestamp |
| created_at | TIMESTAMP | No | Record creation time |
| updated_at | TIMESTAMP | No | Last update time |
| deleted_at | TIMESTAMP | Yes | Soft delete timestamp |

**Indexes:**

- `form_submissions_form_id_submitted_at_idx` on (form_id, submitted_at)
- `form_submissions_tenant_id_submitted_at_idx` on (tenant_id, submitted_at)
- `idx_form_submissions_ai_review_status` on (ai_review_status)
- `idx_form_submissions_unresolved_warning` on (tenant_id, has_unresolved_ai_warning)
- `idx_form_submissions_deleted_at` partial index on (deleted_at) where `deleted_at IS NULL`

---

### form_drafts

Saved in-progress public form responses.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | UUID | No | Primary key |
| code | VARCHAR | No | Short public draft code |
| access_token_hash | VARCHAR | No | SHA-256 hash of the draft access token |
| form_id | UUID | No | FK to forms |
| tenant_id | UUID | No | FK to tenants |
| answers | JSONB | No | Saved answer payload |
| metadata | JSONB | Yes | Draft metadata such as locale and repeat-section counts |
| expires_at | TIMESTAMP | No | Expiry timestamp |
| last_saved_at | TIMESTAMP | No | Last save time |
| created_at | TIMESTAMP | No | Record creation time |
| updated_at | TIMESTAMP | No | Last update time |

**Notes:**

- Public resume requires both `code` and the unhashed access token.
- Expired drafts are cleaned up by the general cleanup task.

**Indexes:**

- `form_drafts_code_key` UNIQUE on code
- `form_drafts_access_token_hash_key` UNIQUE on access_token_hash
- `form_drafts_form_id_expires_at_idx` on (form_id, expires_at)
- `form_drafts_tenant_id_expires_at_idx` on (tenant_id, expires_at)
- `form_drafts_last_saved_at_idx` on (last_saved_at)

---

### form_uploads

Files uploaded during public form save or submission flows.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | UUID | No | Primary key |
| tenant_id | UUID | No | FK to tenants |
| form_id | UUID | No | FK to forms |
| draft_id | UUID | Yes | FK to form_drafts |
| submission_id | UUID | Yes | FK to form_submissions |
| field_id | UUID | Yes | FK to form_fields |
| storage_key | VARCHAR | No | Object storage key |
| file_name | VARCHAR | No | Stored or rendered file name |
| original_file_name | VARCHAR | Yes | Original client-side file name |
| mime_type | VARCHAR | No | MIME type |
| size_bytes | INT | No | File size in bytes |
| created_at | TIMESTAMP | No | Record creation time |

**Notes:**

- Uploads are stored under `{tenantId}/forms/{formId}/uploads/{uploadId}{ext}`.
- Draft uploads can later be linked to a submission when the form is submitted.

**Indexes:**

- `form_uploads_draft_id_idx` on (draft_id)
- `form_uploads_form_id_created_at_idx` on (form_id, created_at)
- `form_uploads_form_id_submission_id_idx` on (form_id, submission_id)
- `form_uploads_submission_id_idx` on (submission_id)
- `form_uploads_tenant_id_form_id_idx` on (tenant_id, form_id)

---

### template_partials

Reusable template blocks (Phase 7 feature).

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | UUID | No | Primary key |
| tenant_id | UUID | No | FK to tenants (required) |
| name | VARCHAR(100) | No | Partial name (unique per tenant) |
| display_name | VARCHAR(200) | Yes | Name shown in pickers |
| header | VARCHAR(200) | Yes | Resolution partials: numbered heading used in resolutions; falls back to the display name |
| description | TEXT | Yes | Partial description |
| content | TEXT | No | HTML content |
| placeholders | JSONB | No | Placeholder definitions (default: []) |
| category | ENUM | No | `AGREEMENT`, `RESOLUTION` or `OTHER` (default `OTHER`); groups partial pickers. Partials used as a service variant's SOW were set to `AGREEMENT` by the migration |
| version | INT | No | Material version, incremented only for content or placeholder changes |
| created_by_id | UUID | No | FK to users |
| created_at | TIMESTAMP | No | Record creation time |
| updated_at | TIMESTAMP | No | Last update time |
| deleted_at | TIMESTAMP | Yes | Soft delete timestamp |

**Indexes:**
- `template_partials_tenant_id_name_key` UNIQUE on (tenant_id, name)
- `template_partials_tenant_id_idx` on tenant_id

---

### service_families

Tenant-owned catalog group for ordered service offerings.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | UUID | No | Primary key |
| tenant_id | UUID | No | FK to tenants |
| code | VARCHAR(100) | No | Normalized tenant-unique code |
| name | VARCHAR(200) | No | Display name |
| description | TEXT | Yes | Family description |
| display_order | INT | No | Stable list order |
| is_active | BOOLEAN | No | Whether the family is selectable |
| created_at | TIMESTAMP | No | Record creation time |
| updated_at | TIMESTAMP | No | Last update time |
| deleted_at | TIMESTAMP | Yes | Soft-delete timestamp |

Codes are unique by `(tenant_id, code)`. Catalog reads exclude rows with a
non-null `deleted_at`. A family is archived only after all of its variants are
archived.

### service_variants

Concrete catalog offering linked to one same-tenant SOW partial.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | UUID | No | Primary key |
| tenant_id | UUID | No | FK to tenants |
| family_id | UUID | No | FK to service_families |
| sow_partial_id | UUID | No | FK to template_partials |
| code | VARCHAR(100) | No | Normalized tenant-unique code |
| name | VARCHAR(200) | No | Offering name |
| description | TEXT | Yes | Offering description |
| service_cadence | ENUM | No | ServiceCadence |
| custom_cadence_label | VARCHAR(100) | Yes | Required only for CUSTOM cadence |
| display_order | INT | No | Order within the family |
| version | INT | No | Material version, default 1 |
| is_active | BOOLEAN | No | Whether the variant is selectable |
| created_at | TIMESTAMP | No | Record creation time |
| updated_at | TIMESTAMP | No | Last update time |
| deleted_at | TIMESTAMP | Yes | Soft-delete timestamp |

The material version increments once when name, SOW partial link, cadence,
custom cadence label, or any default fee template changes.

### service_variant_fee_templates

Entity-agnostic default fee rows owned by a service variant. Stage 2 copies
these defaults into entity-specific agreement fee rows.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | UUID | No | Primary key |
| tenant_id | UUID | No | FK to tenants |
| variant_id | UUID | No | FK to service_variants |
| description | VARCHAR(500) | No | Fee description |
| default_amount | DECIMAL(18,2) | Yes | Optional default amount |
| currency | VARCHAR(3) | No | ISO currency code, default SGD |
| billing_frequency | ENUM | No | BillingFrequency |
| custom_frequency_label | VARCHAR(100) | Yes | Required only for CUSTOM frequency |
| billing_timing | ENUM | No | BillingTiming (default: PREPAID); copied to service fee lines |
| postpaid_trigger | VARCHAR(60) | Yes | Postpaid only: SG_ECI_FILED, SG_FORM_C_FILED or SG_ECI_OR_FORM_C_FILED |
| tiered_pricing | JSONB | Yes | Postpaid only: quantity tiers `{ mode: VOLUME \| GRADUATED, unitLabel, tiers: [{ upTo, flatAmount, unitAmount }] }`; null for a fixed amount. Also on client_service_fee_lines; billing_occurrences.quantity keeps the quantity billed |
| display_order | INT | No | Row order |
| created_at | TIMESTAMP | No | Record creation time |
| updated_at | TIMESTAMP | No | Last update time |

---

### ai_conversations

Chat history for AI assistant (Phase 7 feature).

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | UUID | No | Primary key |
| tenant_id | UUID | No | FK to tenants (required) |
| user_id | UUID | No | FK to users |
| context_type | VARCHAR(20) | No | 'template' or 'document' |
| context_id | UUID | Yes | Template or Document ID |
| messages | JSONB | No | Array of {role, content, timestamp} |
| created_at | TIMESTAMP | No | Record creation time |
| updated_at | TIMESTAMP | No | Last update time |

**Indexes:**
- `ai_conversations_tenant_id_user_id_idx` on (tenant_id, user_id)
- `ai_conversations_context_type_context_id_idx` on (context_type, context_id)

---

## Forms Module Enums

### FormStatus
```sql
DRAFT           -- Builder draft, not public
PUBLISHED       -- Public form is available
ARCHIVED        -- No longer active
```

### FormFieldType
```sql
SHORT_TEXT
LONG_TEXT
SINGLE_CHOICE
MULTIPLE_CHOICE
DROPDOWN
FILE_UPLOAD
SIGNATURE
PARAGRAPH
HTML
PAGE_BREAK
HIDDEN
COMPANY_NAME_CHECK  -- Text input with a mandatory live company name availability check
```

### FormSubmissionStatus
```sql
COMPLETED
PARTIAL
SPAM
```

## Document Generation Module Enums

### DocumentTemplateCategory
```sql
RESOLUTION      -- Board/shareholder resolutions
CONTRACT        -- Contracts and agreements
LETTER          -- Official letters
MINUTES         -- Meeting minutes
NOTICE          -- Notices (AGM, EGM, etc.)
CERTIFICATE     -- Certificates
OTHER           -- Other documents
```

### DocumentTemplateCompositionType
```sql
STANDARD             -- Existing direct template behavior
SERVICE_AGREEMENT    -- Requires the three reserved agreement slots
RESOLUTION           -- Word master with one `resolution.items` slot for numbered resolutions
```

Service Agreement templates contain exactly one each of:
`{{@agreement.serviceSections}}`, `{{@agreement.feeTable}}`, and
`{{@agreement.entityAppendix}}`. The editor and document-template service
enforce the invariant; document-template updates merge omitted fields with the
existing row before validating the persisted composition.

### ServiceCadence
```sql
MONTHLY
QUARTERLY
SEMI_ANNUALLY
ANNUALLY
ONE_TIME
AD_HOC
CUSTOM
```

### BillingFrequency (service catalog)
```sql
MONTHLY
QUARTERLY
SEMI_ANNUALLY
ANNUALLY
ONE_TIME
CUSTOM
```

### BillingTiming (fee lines)
```sql
PREPAID   -- billed on the fee line's schedule
POSTPAID  -- billed once per YA when the trigger filing is set to Filed
```

### GeneratedDocumentStatus
```sql
DRAFT           -- Work in progress, editable
FINALIZED       -- Locked, ready for sharing/export
ARCHIVED        -- Historical, no longer active
```

### DocumentCommentStatus
```sql
OPEN            -- Active comment
RESOLVED        -- Comment addressed
```

---

## Document Generation Audit Actions

The following audit actions are specific to the Document Generation Module:

```sql
-- Template Operations
DOCUMENT_TEMPLATE_CREATED
DOCUMENT_TEMPLATE_UPDATED
DOCUMENT_TEMPLATE_DELETED
DOCUMENT_TEMPLATE_DUPLICATED

-- Document Operations
DOCUMENT_GENERATED
DOCUMENT_FINALIZED
DOCUMENT_UNFINALIZED
DOCUMENT_ARCHIVED
DOCUMENT_CLONED

-- Sharing Operations
SHARE_LINK_CREATED
SHARE_LINK_REVOKED

-- Letterhead Operations
LETTERHEAD_UPDATED

-- Comment Operations
COMMENT_CREATED
COMMENT_RESOLVED
COMMENT_HIDDEN
```

---

## Document Processing Module Tables

### ProcessingDocument

Extended document model for the processing pipeline.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| documentId | UUID | Reference to base Document |
| isContainer | Boolean | Whether this is a container document |
| parentProcessingDocId | UUID? | Parent container (for child documents) |
| pageFrom | Int? | Starting page (inclusive) |
| pageTo | Int? | Ending page (inclusive) |
| pageCount | Int? | Total page count |
| fileHash | String? | SHA-256 for duplicate detection |
| pipelineStatus | PipelineStatus | Current processing status |
| processingPriority | ProcessingPriority | Processing priority |
| duplicateStatus | DuplicateStatus | Duplicate detection status |
| currentRevisionId | UUID? | Current approved revision |
| lockVersion | Int | Optimistic locking version |
| lockedById | UUID? | User holding edit lock |
| uploadSource | UploadSource | WEB, EMAIL, API, CLIENT_PORTAL |

### DocumentPage

Rendered pages for UI highlights.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| processingDocumentId | UUID | Parent processing document |
| pageNumber | Int | Page number (1-indexed) |
| renderDpi | Int | Render resolution (default 200) |
| imagePath | String | Path to rendered image |
| widthPx | Int | Image width in pixels |
| heightPx | Int | Image height in pixels |
| ocrJson | JSON? | OCR word boxes and confidence |

### DocumentRevision

Immutable snapshots of structured accounting data.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| processingDocumentId | UUID | Parent processing document |
| revisionNumber | Int | Revision number (1, 2, 3...) |
| revisionType | RevisionType | EXTRACTION, USER_EDIT, REPROCESS |
| status | RevisionStatus | DRAFT, APPROVED, SUPERSEDED |
| documentCategory | DocumentCategory | ACCOUNTS_PAYABLE, TREASURY, etc. |
| documentSubCategory | DocumentSubCategory? | VENDOR_INVOICE, BANK_STATEMENT, etc. |
| vendorName | String? | Extracted vendor name |
| documentNumber | String? | Invoice/receipt number |
| documentDate | Date? | Document date |
| currency | String | ISO 4217 currency code |
| subtotal | Decimal(18,4)? | Subtotal amount |
| taxAmount | Decimal(18,4)? | Tax amount |
| totalAmount | Decimal(18,4) | Total amount |
| homeCurrency | String? | Home currency (company's currency) |
| homeExchangeRate | Decimal(18,6)? | Exchange rate used for conversion |
| homeExchangeRateSource | ExchangeRateSource? | MAS_DAILY, IRAS_MONTHLY_AVG, MANUAL, DOCUMENT |
| exchangeRateDate | Date? | Date of the exchange rate |
| homeSubtotal | Decimal(18,4)? | Subtotal in home currency |
| homeTaxAmount | Decimal(18,4)? | Tax in home currency |
| homeEquivalent | Decimal(18,4)? | Total in home currency |
| isHomeExchangeRateOverride | Boolean | User overrode exchange rate (default: false) |
| validationStatus | ValidationStatus | PENDING, VALID, WARNINGS, INVALID |
| createdById | UUID | User who created |
| approvedById | UUID? | User who approved |
| counterpartyIdentity | JSON? | Captured reviewed vendor/customer identity decision |

**Document Vault approval timing:** Draft/reprocessed revisions retain the reviewed counterparty identity without creating or enriching a contact. Approval resolves or creates the vendor/customer inside the approval transaction, links the approved revision, and enriches only empty trusted fields. This prevents abandoned drafts from mutating the contact book and lets concurrent approvals converge through transactional identity resolution.

**BizFile capture:** The reviewed BizFile confirmation passes officer/shareholder names, identification type/number, nationality, birth date, address, and confidence into the same preview/resolve path. Masked and low-confidence identifiers are retained as review context but are not deterministic match keys. Explicit `CREATE_SEPARATE` decisions preserve legitimate same-name people.

### DocumentRevisionLineItem

Line items within a revision.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| revisionId | UUID | Parent revision |
| lineNo | Int | Line number |
| description | String | Line description |
| quantity | Decimal(18,4)? | Quantity |
| unitPrice | Decimal(18,4)? | Unit price |
| amount | Decimal(18,4) | Line amount |
| gstAmount | Decimal(18,4)? | GST amount |
| taxCode | String? | Tax code |
| homeAmount | Decimal(18,4)? | Line amount in home currency |
| homeGstAmount | Decimal(18,4)? | Line GST in home currency |
| isHomeAmountOverride | Boolean | User overrode home amount (default: false) |
| isHomeGstOverride | Boolean | User overrode home GST (default: false) |

### DocumentExtraction

Immutable AI/OCR outputs.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| processingDocumentId | UUID | Parent processing document |
| extractionType | ExtractionType | SPLIT or FIELDS |
| provider | String | AI provider (openai, anthropic) |
| model | String | Model used |
| rawJson | JSON | Raw extraction output |
| confidenceJson | JSON | Confidence scores |
| evidenceJson | JSON? | Bounding box evidence |
| tokensUsed | Int? | Token consumption |

### BankAccount

Bank accounts for reconciliation.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| tenantId | UUID | Tenant reference |
| companyId | UUID | Company reference |
| name | String | Account name |
| accountNumber | String | Account number (encrypted) |
| currency | String | Account currency |

### BankTransaction

Bank transactions for matching.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| bankAccountId | UUID | Parent bank account |
| transactionDate | Date | Transaction date |
| description | String | Transaction description |
| amount | Decimal(18,4) | Transaction amount |
| transactionType | BankTransactionType | CREDIT, DEBIT, etc. |
| reconciliationStatus | ReconciliationStatus | UNMATCHED, MATCHED, etc. |

## Document Processing Module Enums

```typescript
enum PipelineStatus {
  UPLOADED
  QUEUED
  PROCESSING
  SPLIT_PENDING
  SPLIT_DONE
  EXTRACTION_DONE
  FAILED_RETRYABLE
  FAILED_PERMANENT
  DEAD_LETTER
}

enum RevisionStatus {
  DRAFT
  APPROVED
  SUPERSEDED
}

enum DocumentCategory {
  ACCOUNTS_PAYABLE      // Vendor/Purchase documents
  ACCOUNTS_RECEIVABLE   // Customer/Sales documents
  TREASURY              // Banking & Cash management
  TAX_COMPLIANCE        // Tax & Regulatory
  PAYROLL               // HR & Payroll
  CORPORATE_SECRETARIAL // Corporate governance
  CONTRACTS             // Legal agreements
  FINANCIAL_REPORTS     // Reporting & Analysis
  INSURANCE             // Risk management
  CORRESPONDENCE        // General communications
  OTHER                 // Uncategorized
}

enum DocumentSubCategory {
  // See src/lib/document-categories.ts for full mapping
  // Each category has 2-6 sub-categories, e.g.:
  // ACCOUNTS_PAYABLE: VENDOR_INVOICE, VENDOR_CREDIT_NOTE, PURCHASE_ORDER, etc.
  // TREASURY: BANK_STATEMENT, BANK_ADVICE, PAYMENT_VOUCHER, etc.
}

enum DuplicateStatus {
  NONE
  SUSPECTED
  CONFIRMED
  REJECTED
}

enum DuplicateAction {
  CONFIRM_DUPLICATE
  REJECT_DUPLICATE
  MARK_AS_NEW_VERSION
}
```

---

## Document Tagging Tables

### document_tags

Custom tags for organizing and categorizing processing documents. Supports a hybrid scope system with tenant-level (shared) tags and company-level tags.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | UUID | No | Primary key |
| tenant_id | UUID | No | FK to tenants (required) |
| company_id | UUID | Yes | FK to companies (NULL = tenant-level shared tag, UUID = company-specific tag) |
| name | VARCHAR | No | Tag name (e.g., "Quarterly", "Urgent", "Tax Filing") |
| color | TagColor | No | Tag color (default: GRAY) |
| description | TEXT | Yes | Optional description |
| usage_count | INT | No | Number of times used (default: 0) |
| last_used_at | TIMESTAMP | Yes | Last time tag was used |
| created_by_id | UUID | No | FK to users who created the tag |
| created_at | TIMESTAMP | No | Record creation time |
| updated_at | TIMESTAMP | No | Last update time |
| deleted_at | TIMESTAMP | Yes | Soft delete timestamp |

**Tag Scope System:**
- `company_id = NULL` - **Tenant Tag** (shared across all companies in the tenant)
- `company_id = UUID` - **Company Tag** (specific to one company only)

**Permissions:**
- **Tenant Tags**: Only SUPER_ADMIN or TENANT_ADMIN can create/edit/delete
- **Company Tags**: Any user with access to the company can create/edit/delete

**Visual Differentiation:** Tenant tags display a globe icon in the UI to indicate they're shared across companies.

**Indexes:**
- `document_tags_tenant_id_company_id_name_deleted_at_key` UNIQUE on (tenant_id, company_id, name, deleted_at)
- `document_tags_tenant_id_deleted_at_idx` on (tenant_id, deleted_at) - For fetching tenant tags

---

### processing_document_tags

Many-to-many relationship linking processing documents to tags.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | UUID | No | Primary key |
| processing_document_id | UUID | No | FK to processing_documents (CASCADE) |
| tag_id | UUID | No | FK to document_tags (CASCADE) |
| added_by_id | UUID | No | FK to users who added the tag |
| added_at | TIMESTAMP | No | When tag was added (default: now) |

**Indexes:**
- `processing_document_tags_processing_document_id_tag_id_key` UNIQUE on (processing_document_id, tag_id)
- `processing_document_tags_processing_document_id_idx` on processing_document_id
- `processing_document_tags_tag_id_idx` on tag_id

---

### TagColor Enum

```sql
GRAY        -- Default neutral color
RED         -- High priority / Urgent
ORANGE      -- Warning / Attention
YELLOW      -- Highlight
GREEN       -- Success / Approved
BLUE        -- Information
PURPLE      -- Special / Premium
PINK        -- Personal / Custom
```

---

## Chart of Accounts Module Tables

### chart_of_accounts

Hierarchical chart of accounts with support for system defaults, tenant-level customization, and company-level overrides.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | UUID | No | Primary key |
| tenant_id | UUID | Yes | FK to tenants (null = system-level default) |
| company_id | UUID | Yes | FK to companies (null = tenant-level, not company-specific) |
| code | VARCHAR(20) | No | Account code (e.g., "6100") |
| name | VARCHAR(200) | No | Account name (e.g., "Advertising & Marketing") |
| description | VARCHAR(500) | Yes | Optional description |
| account_type | AccountType | No | ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE |
| status | AccountStatus | No | ACTIVE, INACTIVE, ARCHIVED (default: ACTIVE) |
| parent_id | UUID | Yes | Self-reference for hierarchy |
| sort_order | INTEGER | No | Display order (default: 0) |
| is_system | BOOLEAN | No | Whether this is a system-defined account (default: false) |
| is_tax_applicable | BOOLEAN | No | Whether tax calculations apply (default: true) |
| created_at | TIMESTAMP | No | Creation timestamp |
| updated_at | TIMESTAMP | No | Last update timestamp |
| deleted_at | TIMESTAMP | Yes | Soft delete timestamp |

**Unique Constraint:** `(tenant_id, company_id, code)` - Account codes are unique within a scope.

**Account Resolution:** When resolving accounts for a document, the system looks up in order:
1. Company-level accounts (matching tenantId and companyId)
2. Tenant-level accounts (matching tenantId, null companyId)
3. System-level accounts (null tenantId, null companyId)

### chart_of_accounts_mappings

Maps Oakcloud accounts to external accounting platform codes (Xero, Odoo, etc.). Mappings are company-specific.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | UUID | No | Primary key |
| account_id | UUID | No | FK to chart_of_accounts |
| company_id | UUID | No | FK to companies (mappings are per-company) |
| provider | AccountingProvider | No | XERO, QUICKBOOKS, MYOB, SAGE |
| external_code | VARCHAR(50) | Yes | External platform's account code |
| external_id | VARCHAR(100) | Yes | External platform's account ID |
| external_name | VARCHAR(200) | Yes | External platform's account name |
| last_synced_at | TIMESTAMP | Yes | Last sync timestamp |
| sync_status | VARCHAR | Yes | Sync status (PENDING, SYNCED, ERROR) |
| created_at | TIMESTAMP | No | Creation timestamp |
| updated_at | TIMESTAMP | No | Last update timestamp |

**Unique Constraint:** `(account_id, company_id, provider)` - One mapping per account/company/provider.

## Chart of Accounts Module Enums

### AccountType

```sql
ASSET       -- Resources owned (cash, inventory, equipment)
LIABILITY   -- Debts and obligations (loans, payables)
EQUITY      -- Owner's stake (capital, retained earnings)
REVENUE     -- Income (sales, service fees)
EXPENSE     -- Costs (salaries, rent, utilities)
```

### AccountStatus

```sql
ACTIVE      -- Active and available for use
INACTIVE    -- Temporarily disabled
ARCHIVED    -- No longer in use
```

## Chart of Accounts Audit Actions

```sql
CHART_OF_ACCOUNTS_CREATED    -- Account created
CHART_OF_ACCOUNTS_UPDATED    -- Account updated
CHART_OF_ACCOUNTS_DELETED    -- Account deleted (soft)
CHART_OF_ACCOUNTS_MAPPING_CREATED  -- Mapping created
CHART_OF_ACCOUNTS_MAPPING_UPDATED  -- Mapping updated
CHART_OF_ACCOUNTS_MAPPING_DELETED  -- Mapping deleted
```

## Chart of Accounts Seed Data

The system seeds 53 standard Singapore chart of accounts (SFRS-aligned) as system-level defaults:

- **Assets (1xxx)**: Current Assets, Cash, AR, Inventory, Fixed Assets, etc.
- **Liabilities (2xxx)**: AP, Accrued Expenses, GST Payable, Long-term Loans, etc.
- **Equity (3xxx)**: Share Capital, Retained Earnings, Reserves, Dividends
- **Revenue (4xxx)**: Sales, Service Revenue, Interest Income, Other Income
- **COGS (5xxx)**: Cost of Goods Sold, Direct Labor, Direct Materials
- **Operating Expenses (6xxx-7xxx)**: Advertising, Bank Charges, Rent, Utilities, etc.
- **Tax Expenses (8xxx)**: Income Tax, Deferred Tax

---

## Exchange Rate Module Tables

### exchange_rates

Exchange rates for multi-currency document processing. Supports MAS (Monetary Authority of Singapore) daily rates and manual tenant overrides.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | UUID | No | Primary key |
| tenant_id | UUID | Yes | FK to tenants (null = system-wide rate, non-null = tenant override) |
| source_currency | VARCHAR | No | Source currency ISO 4217 code (e.g., USD, EUR) |
| target_currency | VARCHAR | No | Target currency (default: SGD) |
| rate | DECIMAL(18,8) | No | Exchange rate (source → target) |
| inverse_rate | DECIMAL(18,8) | Yes | Inverse rate (1/rate) for convenience |
| rate_date | DATE | No | Effective date of the rate |
| rate_type | ENUM | No | Rate source type (see ExchangeRateType enum) |
| is_manual_override | BOOLEAN | No | Whether this is a manual override |
| manual_reason | TEXT | Yes | Reason for manual rate (required for overrides) |
| created_by_id | UUID | Yes | FK to users who created (for manual rates) |
| fetched_at | TIMESTAMP | No | When rate was fetched/created |
| source_ref | VARCHAR | Yes | Source URL or dataset identifier |
| source_hash | VARCHAR | Yes | Checksum for audit |
| created_at | TIMESTAMP | No | Record creation time |
| updated_at | TIMESTAMP | No | Last update time |

**Rate Lookup Priority:**
1. Tenant-specific override (if tenantId matches)
2. System rate for exact date
3. Fallback to most recent system rate

**Indexes:**
- `exchange_rates_tenant_id_source_currency_target_currency_rate_date_rate_type_key` UNIQUE
- `exchange_rates_tenant_id_idx` on tenant_id
- `exchange_rates_source_currency_target_currency_rate_date_idx`
- `exchange_rates_rate_date_idx` on rate_date
- `exchange_rates_source_currency_rate_date_idx`

---

## Exchange Rate Module Enums

### ExchangeRateSource
```sql
MAS_DAILY            -- MAS (Monetary Authority of Singapore) daily end-of-day rates
IRAS_MONTHLY_AVG     -- IRAS monthly average rates from Data.gov.sg
MANUAL               -- Manually entered rates
PROVIDER_DEFAULT     -- Default rate from AI provider
DOCUMENT             -- Extracted from the document itself (e.g., invoice shows SGD equivalent)
```

### Rate Preference (Tenant Settings)

Tenants can choose their preferred rate type for currency conversion. This is stored in the `Tenant.settings` JSON field:

```json
{
  "exchangeRate": {
    "preferredRateType": "MONTHLY"  // "MONTHLY" or "DAILY"
  }
}
```

- **MONTHLY** (default): Uses MAS monthly end-of-period rates
- **DAILY**: Uses MAS daily rates for more precise day-to-day conversion

**Rate Lookup Priority with Preferences:**
1. Tenant-specific manual override for exact date
2. Tenant's preferred rate type:
   - **MONTHLY**: Looks up `MAS_MONTHLY_RATE` for the **first day of the document's month** (e.g., doc dated Nov 19 → Nov 1 rate)
   - **DAILY**: Looks up `MAS_DAILY_RATE` for the **exact document date**
3. System rate of preferred type
4. Fallback to most recent available system rate

---

## Exchange Rate Audit Actions

```sql
EXCHANGE_RATE_SYNCED     -- Batch sync from external source (MAS API)
EXCHANGE_RATE_CREATED    -- Manual rate created
EXCHANGE_RATE_UPDATED    -- Rate updated
EXCHANGE_RATE_DELETED    -- Rate deleted
```

## Exchange Rate Data Sources

### MAS APIMG Gateway API

The system uses MAS's (Monetary Authority of Singapore) APIMG Gateway API which requires API key authentication. Both daily and monthly rates are sourced from MAS.

**Monthly End-of-Period Rates:**
- **Endpoint**: `https://eservices.mas.gov.sg/apimg-gw/server/monthly_statistical_bulletin_non610ora/exchange_rates_end_of_period_monthly/views/exchange_rates_end_of_period_monthly`
- **Authentication**: API Key via `KeyId` header
- **Update Frequency**: Monthly (end-of-month rates)
- **Currencies**: USD, EUR, GBP, JPY, AUD, CAD, CNY, HKD, INR, IDR, KRW, MYR, NZD, PHP, QAR, SAR, CHF, TWD, THB, AED, VND (21 currencies)
- **Date Storage**: MAS returns rates for the last day of the month (e.g., Nov 30). These are stored with `rateDate` as the **first day of the following month** (e.g., Dec 1). This simplifies lookup: a document dated Nov 19 uses the Nov 1 rate (which represents October's end-of-month rate).

**Daily End-of-Period Rates:**
- **Endpoint**: `https://eservices.mas.gov.sg/apimg-gw/server/monthly_statistical_bulletin_non610ora/exchange_rates_end_of_period_daily/views/exchange_rates_end_of_period_daily`
- **Authentication**: API Key via `KeyId` header
- **Update Frequency**: Daily (end-of-day rates, typically updated around 6 PM SGT)
- **Currencies**: Same as monthly

**API Key Management:**
- API keys expire annually and must be renewed
- Current expiry: December 26, 2026
- System warns SUPER_ADMIN 30 days before expiry
- Keys configured via environment variables: `MAS_MONTHLY_API_KEY`, `MAS_DAILY_API_KEY`

### Scheduled Sync
The system automatically syncs exchange rates daily at 6 AM SGT:
1. **MAS Daily Rates**: Always synced (if enabled via `SCHEDULER_EXCHANGE_RATE_MAS_DAILY_ENABLED`)
2. **MAS Monthly Rates**: Synced on days 1-5 of each month for previous month's data (if enabled via `SCHEDULER_EXCHANGE_RATE_MAS_MONTHLY_ENABLED`)

### Environment Variables
```bash
# Enable/disable scheduled sync (both default to true)
SCHEDULER_EXCHANGE_RATE_SYNC_ENABLED=true
SCHEDULER_EXCHANGE_RATE_MAS_DAILY_ENABLED=true
SCHEDULER_EXCHANGE_RATE_MAS_MONTHLY_ENABLED=true

# API Keys (required for sync)
MAS_MONTHLY_API_KEY=your-monthly-api-key
MAS_DAILY_API_KEY=your-daily-api-key
MAS_API_KEY_EXPIRY=2026-12-26  # For expiry warnings
```

---

## Tasks And Pipelines Module Tables

All rows are tenant-scoped. Published pipeline versions and locked task snapshots are structurally immutable at both the service and PostgreSQL trigger layers.

| Table | Purpose | Key rules |
|-------|---------|-----------|
| `task_pipelines` | Reusable template identity and soft-delete metadata | Tenant/name indexes; archive instead of hard delete |
| `task_pipeline_versions` | Monotonic immutable versions | Unique `(pipeline_id, version)`; one-way `published_at` |
| `task_pipeline_stages` | Ordered definitions for one version | Unique `(version_id, position)`; action type, curated icon, required flag, JSON adapter config |
| `tasks` | Live work linked to one fixed version | Company, owner, and due date are nullable; one-way `snapshot_locked_at`; soft delete |
| `task_stages` | Ordered live snapshot copied at task creation | Structure is immutable after lock; assignee, notes, checklist progress, status, and timestamps remain operational |
| `task_stage_checklist_items` | Snapshotted checklist rows | Unique position within a stage; completion metadata is mutable |
| `task_stage_outcomes` | Link to an authoritative module record | Exactly one type-matching Company, Generated Document, or E-signing Envelope link; FKs use `SET NULL` |
| `task_company_recovery_contexts` | Durable per-stage Company/BizFile recovery context | Tenant/stage uniqueness prevents duplicate callback associations |

### Versions And Snapshots

A pipeline create/update transaction inserts an unpublished `task_pipeline_versions` row, writes every ordered `task_pipeline_stages` row, then publishes it. A task create transaction copies the selected published version and checklist definitions into `task_stages` and `task_stage_checklist_items`, then locks the snapshot. Pipeline edits publish another version and never rewrite existing tasks.

### Service Agreement generation tables

| Table | Purpose | Key constraints |
|---|---|---|
| `service_agreements` | Structured agreement header with ordered representative snapshots and a signer-ID subset beside a generated-document draft | Unique generated document; tenant/status and primary-company indexes |
| `service_agreement_entities` | Included company name/UEN snapshots | Unique company within an agreement |
| `service_agreement_items` | Repeated service selections and pinned SOW/version data | Tenant/agreement/display-order index |
| `service_agreement_item_entities` | Many-to-many item targeting | Unique item/entity pair |
| `service_agreement_fee_lines` | Entity-specific decimal fees | Item/display-order and entity indexes |

`ServiceAgreementStatus` is `DRAFT`, `EFFECTIVE`, or `CANCELLED`. Stage 2
creates and edits only `DRAFT` rows. Every relation is tenant-scoped and uses
additive foreign keys; deleting a generation draft cascades its structured
agreement, while company, variant, and partial references are restricted as
declared in the Prisma schema. Representative snapshots and signer IDs are
JSON because document rendering must remain stable after contact changes.

Agreement item snapshots store the material service-variant version, SOW
partial version, expanded legal wording, service placeholder definitions, and
nested dependency versions. Decimal fee amounts are returned by APIs as
fixed-point strings.

### Operational Client Services and activation

| Table | Purpose | Key constraints |
|---|---|---|
| `client_services` | Editable operational service from an agreement or the catalog | `ClientServiceSource`; source/reference check; nullable unique `(agreement_item_id, company_id)`; tenant/company/status/archive index |
| `client_service_fee_lines` | Entity-owned operational fee rows | Parent/source-fee uniqueness and tenant/parent/display-order index |

`ClientServiceStatus` is `ACTIVE`, `PAUSED`, or `ENDED`, and
`ClientServiceSource` is `AGREEMENT` or `MANUAL`. `source` defaults to
`AGREEMENT` for backward-compatible writes, but both flows set it explicitly.
`agreement_id` and `agreement_item_id` are nullable so manual rows can store
null lineage. Prisma relations for both columns are optional, and the migration
adds the authoritative PostgreSQL check
`client_services_source_reference_consistency`:

```text
AGREEMENT => agreement_id IS NOT NULL AND agreement_item_id IS NOT NULL
MANUAL    => agreement_id IS NULL AND agreement_item_id IS NULL
```

The unique constraint `(agreement_item_id, company_id)` is retained as the
agreement-activation idempotency boundary; PostgreSQL permits multiple manual
rows whose nullable `agreement_item_id` is null. A non-unique lookup index
covers `(tenant_id, company_id, service_variant_id, start_date, deleted_at)`
for duplicate warnings. `ClientServiceFeeLine.sourceAgreementFeeLineId` remains
nullable; manual fee rows leave it null.

Operational edits are audited and never update agreement snapshots or
generated/signed documents. Legal SOW content remains only on
`service_agreement_items`.

`ServiceAgreementActivationStatus` moves through `NOT_READY`, `PENDING`,
`PROCESSING`, `COMPLETED`, `FAILED_RETRYABLE`, and `FAILED_PERMANENT`.
Availability, a unique claim token, and claim/lease timestamps support
overlapping scheduler instances and stale-worker recovery. Partial PostgreSQL
indexes cover available pending/retryable rows and expired processing leases.
These predicate-specific indexes are migration-managed because Prisma schema
declarations cannot represent their `WHERE` clauses:
`service_agreements_activation_available_claim_idx` covers
`(activation_available_at, id)` for `PENDING`/`FAILED_RETRYABLE` rows, and
`service_agreements_activation_expired_lease_idx` covers
`(activation_lease_expires_at, id)` for `PROCESSING` rows. Do not add equivalent
full `@@index` declarations to `schema.prisma`.
Attempt count, public-safe last error with correlation reference,
source, requester, and reason retain recovery and audit context. E-signing uses
source `ESIGNING`; externally signed agreements use `MANUAL` with explicit
signed/effective dates.

Operational Service updates require the caller's last observed `updated_at`.
The service performs a compare-and-set before replacing fee rows and returns
HTTP 409 on a stale version. Service mutations and audit rows share the same
serializable transaction; audit summaries contain scalar old/new values and
fee counts/totals, while field values and signed wording remain redacted.

Backup restore order is partials, service families, variants, fee templates,
generated documents, agreement header/entities/items/item-entity links/fees,
Client Services, then Client Service fees. Tenant cleanup uses the reverse
child-first order.

### Status And Lifecycle Rules

- Derived task lifecycle: `NOT_STARTED → IN_PROGRESS → COMPLETED`.
- `PAUSED` and `CANCELLED` are explicit task overrides. A cancelled task cannot resume.
- Stage lifecycle uses `NOT_STARTED`, `IN_PROGRESS`, `WAITING`, `COMPLETED`, `SKIPPED`, and `FAILED`.
- Required stages cannot be skipped. Optional stages require a skip reason.
- Company stages complete when a Company is linked.
- Document Generation stages are in progress for a linked draft and complete when the generated document is `FINALIZED`.
- E-signing stages complete after all required signatures; declined, expired, voided, and cancelled envelopes fail the stage.
- Status colours are UI-owned semantic treatments. No pipeline or stage colour column is persisted.

### Default Client Onboarding Seed

The idempotent seed reconciles the active tenant-owned `DR_Appointment of Corp Sec` Resolution and `Oaktree Master Services Agreement` Contract templates to canonical reference-Docker snapshots, including exact HTML, placeholders, typography, line spacing, paragraph spacing, and A4 margins. A changed existing template receives one version increment; an exact rerun remains unchanged. The seed soft-deletes legacy inactive Service Agreement names and creates a Client Onboarding version for every non-deleted tenant with required Company Profile (`Building2`), Generate Resolution (`FileText`), Generate Contract (`FileText`), and E-signing (`PenLine`) stages. The document stages store the matching template IDs in their action configuration, and the contract remains immediately before E-signing. An older three-stage version is upgraded to a new immutable version when it does not match the seeded stages. Adapter configuration matches the stage-action registry and no user-defined colours are stored. The `--client-onboarding-only` flag applies only this template and pipeline seed.

### Legacy Workflow/Projects Reset

Migration `20260724090000_modular_tasks_reset` deliberately drops all retired `workflow_*` tables before creating the initial Task/Pipeline enums, tables, constraints, and indexes. Forward migration `20260727030000_task_snapshot_guards` renames the initial `BLOCKED` enum value to `WAITING`, adds publish/snapshot lock columns, and installs immutability triggers. The split preserves the checksum of the already-created reset migration. This is a complete reset: there is no compatibility data copy, redirect, or legacy API. Company, Generated Document, E-signing, Contact, and other module data remain intact.

---

## ACRA Entity Sync Module Tables

Local mirror of the data.gov.sg "ACRA Information on Corporate Entities" collection, used by the form builder's "Company name check". The daily `acra-sync` scheduled task compares `acra_sync_state.collection_last_updated_at` against the API's `lastUpdatedAt` and re-imports all 27 CSV datasets when they differ. Rows are stamped with `data_as_of`; stale rows are deleted only after a full import succeeds.

### acra_entity

One row per live local/foreign company (dead statuses and non-company entity types are filtered out at import time).

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | UUID | No | Primary key |
| uen | TEXT | No | Unique entity number from ACRA |
| entity_name | TEXT | No | Registered entity name |
| entity_status | TEXT | No | ACRA status (e.g., "Live Company", "In Liquidation - ...") |
| entity_type | TEXT | No | "Local Company" or "Foreign Company" |
| company_type_description | TEXT | Yes | Company type (e.g., "EXEMPT PRIVATE COMPANY LIMITED BY SHARES") |
| registration_incorporate_date | TEXT | Yes | Incorporation date as stored in the CSV |
| block | TEXT | Yes | Address part |
| street_name | TEXT | Yes | Address part |
| level_no | TEXT | Yes | Address part |
| unit_no | TEXT | Yes | Address part |
| building_name | TEXT | Yes | Address part |
| postal_code | TEXT | Yes | Address part |
| address | TEXT | Yes | Derived display address, e.g. "123 MAIN STREET ACME BUILDING #05-01 SINGAPORE 123456" |
| account_due_date | TEXT | Yes | Statutory account due date |
| annual_return_date | TEXT | Yes | Annual return due date |
| primary_ssic_code | TEXT | Yes | Primary SSIC code |
| primary_ssic_description | TEXT | Yes | Primary SSIC description |
| secondary_ssic_code | TEXT | Yes | Secondary SSIC code |
| secondary_ssic_description | TEXT | Yes | Secondary SSIC description |
| no_of_officers | TEXT | Yes | Number of officers |
| former_entity_name1 | TEXT | Yes | First former entity name |
| uen_of_audit_firm1 | TEXT | Yes | UEN of the first audit firm |
| data_as_of | TEXT | No | ISO timestamp of the ACRA collection snapshot the row came from |
| created_at | TIMESTAMP | No | Record creation time |
| updated_at | TIMESTAMP | No | Last update time |

**Indexes:**
- `acra_entity_uen_key` UNIQUE on uen
- `acra_entity_entity_name_trgm_idx` GIN trigram on `entity_name` (powers the insensitive substring name search used by `contains`/`mode: insensitive`, i.e. `ILIKE '%word%'`; requires the `pg_trgm` extension)

### acra_sync_state

Singleton row (`id = 'main'`) holding sync progress and doubling as the sync lock.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| id | TEXT | No | Always `'main'` |
| collection_last_updated_at | TEXT | Yes | Last imported ACRA collection `lastUpdatedAt` (ISO string) |
| entity_count | INTEGER | No | Row count after the last completed sync |
| last_started_at | TIMESTAMP | Yes | Non-null while a sync run holds the lock |
| last_completed_at | TIMESTAMP | Yes | When the last sync finished |
| last_error | TEXT | Yes | Error message of the last failed sync |
| updated_at | TIMESTAMP | No | Last update time |

---

## Migration Notes

### Multi-Tenancy

All tenant-scoped entities (Company, Contact, Document) require a `tenantId` field. When adding new rows to these tables:

1. Always include the `tenantId` when creating records
2. The seed script automatically creates a default tenant and assigns all sample data to it
3. Unique constraints that include tenant-scoped fields also include `tenantId` (e.g., company UEN is unique per tenant)

### Soft Delete Pattern

All major entities use soft delete with `deleted_at` timestamp. Queries should filter by `deleted_at IS NULL` by default.

### Historical Tracking

Entities that track history (addresses, officers, shareholders) use:
- `is_current` boolean flag for active records
- `effective_from` / `effective_to` date range
- `source_document_id` to track data source

### Denormalization

Officer and shareholder records denormalize contact information to preserve historical accuracy even if the contact record is updated.

### Database Initialization

To initialize a fresh database:

```bash
npm run db:generate   # Generate Prisma client
npm run db:push       # Push schema to database
npm run db:seed       # Seed with sample data (creates default tenant)
```

The seed script is idempotent and can be run multiple times safely.

### Contact identity rollout and operational verification

Apply migrations in timestamp order: `20260714090000_contact_identity_and_merge` first (extension, nullable canonical/counterparty fields, decision and ledger tables, indexes and trigger), then `20260714130000_contact_duplicate_normalized_identifier_indexes` (normalized active-identifier indexes), and finally `20260714140000_contact_canonical_alias` (nullable canonical alias plus its lookup index). Generate the Prisma client before running application code.

Backfill active contacts in stable ID batches after migrations:

```bash
npm run db:backfill-contact-canonical-names -- --batch-size=500
npm run db:backfill-contact-canonical-names -- --batch-size=500 --resume-after=<lastId>
```

The JSON result reports `processed`, `updated`, `skipped`, `failed`, and `lastId`. A failed batch is rolled back, leaves `lastId` at the prior committed batch, and exits nonzero so the operator can correct the cause and resume. A second complete run should report zero updates.

For a dry operational verification, use only an explicitly confirmed disposable/local PostgreSQL database: validate and migrate, run the backfill twice, approve two concurrent Chinese-name document revisions and confirm they resolve to one contact, then merge a disposable duplicate group. Verify source contacts are absent, the append-only ledger and audit rows exist, and all former source references point to the master. Exercise a forced transaction failure to confirm rollback and retry behavior, then remove the disposable tenant/data. Never run smoke fixtures against a shared or production URL.

### SharePoint signed-document filing

The `company_sharepoint_folders` table stores a workspace-owned, same-drive
mapping from a company to an immediate child of the configured Client Documents
root. `esigning_sharepoint_filings` is an independent per-envelope-document
ledger. It snapshots route/configuration inputs, waits for the signed source,
uses leased claims for worker concurrency, and retains remote identity, error,
retry, and recovery-resolution evidence. Existing `autoFilingStatus` fields on
`esigning_envelopes` remain the Oakcloud internal filing workflow.
