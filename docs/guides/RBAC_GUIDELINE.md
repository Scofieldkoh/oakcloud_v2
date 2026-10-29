# RBAC, Authentication & Multi-Tenancy Implementation Guidelines

> **Last Updated**: 2025-01-12
> **Audience**: Developers

This document provides comprehensive guidelines for implementing Role-Based Access Control (RBAC), authentication, and multi-tenancy in Oakcloud. Follow these patterns to ensure consistent security across all features.

## Related Documents

- [Architecture](../ARCHITECTURE.md) - System design overview
- [Service Patterns](./SERVICE_PATTERNS.md) - Service layer conventions
- [API Reference](../reference/API_REFERENCE.md) - API endpoints

## Table of Contents

- [Overview](#overview)
- [Authentication](#authentication)
  - [JWT Token Flow](#jwt-token-flow)
  - [Session Management](#session-management)
  - [Authentication Functions](#authentication-functions)
- [Multi-Tenancy](#multi-tenancy)
  - [Tenant Isolation](#tenant-isolation)
  - [Tenant Context](#tenant-context)
  - [Tenant Limits](#tenant-limits)
  - [Data Scoping Patterns](#data-scoping-patterns)
- [Permission Model](#permission-model)
  - [Resources and Actions](#resources-and-actions)
  - [Permission String Format](#permission-string-format)
- [Role System](#role-system)
  - [Role Hierarchy](#role-hierarchy)
  - [System Roles](#system-roles)
  - [Default Custom Roles](#default-custom-roles)
  - [Company-Scoped Roles](#company-scoped-roles)
- [Permission Resolution Flow](#permission-resolution-flow)
- [Implementation Patterns](#implementation-patterns)
  - [API Route Protection](#api-route-protection)
  - [Service Layer Patterns](#service-layer-patterns)
  - [UI Permission Checks](#ui-permission-checks)
- [Audit Logging Integration](#audit-logging-integration)
- [Adding New Features](#adding-new-features)
- [Testing & Debugging](#testing--debugging)
- [Best Practices](#best-practices)
- [Quick Reference](#quick-reference)

---

## Overview

Oakcloud implements a comprehensive security model with three interconnected layers:

1. **Authentication** - JWT-based authentication with secure HTTP-only cookies
2. **Multi-Tenancy** - Complete data isolation between tenants
3. **RBAC** - Fine-grained role-based access control

**Key Principles:**
- All data access must be authorized through RBAC
- All data must be scoped to the appropriate tenant
- Company-specific roles override tenant-wide roles (specificity priority)
- System roles (SUPER_ADMIN, TENANT_ADMIN) have implicit permissions
- Every state change must be audit logged

---

## Authentication

### JWT Token Flow

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│    Client    │     │  API Route   │     │   Database   │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │
       │  POST /api/auth/login                   │
       │  {email, password} │                    │
       │───────────────────▶│                    │
       │                    │  Verify user       │
       │                    │───────────────────▶│
       │                    │◀───────────────────│
       │                    │                    │
       │                    │  Create JWT        │
       │                    │  (userId, email,   │
       │                    │   tenantId)        │
       │                    │                    │
       │  Set-Cookie:       │                    │
       │  auth-token=JWT    │                    │
       │◀───────────────────│                    │
       │                    │                    │
       │  Subsequent requests include cookie     │
       │───────────────────▶│                    │
       │                    │  Verify JWT        │
       │                    │  Load session      │
       │                    │───────────────────▶│
```

### Session Management

The session object (`SessionUser`) contains:

```typescript
interface SessionUser {
  id: string;           // User ID
  email: string;        // User email
  firstName: string;    // User first name
  lastName: string;     // User last name
  tenantId: string | null;  // Tenant ID (null for SUPER_ADMIN)

  // Computed from role assignments (authoritative source)
  isSuperAdmin: boolean;        // Has SUPER_ADMIN role
  isTenantAdmin: boolean;       // Has TENANT_ADMIN role
  hasAllCompaniesAccess: boolean; // Has any role with "All Companies" scope (null companyId)

  // Company IDs from role assignments
  companyIds: string[];     // Specific companies user has access to
}
```

**Important:** The `isSuperAdmin`, `isTenantAdmin`, `hasAllCompaniesAccess`, and `companyIds` fields are computed from the user's role assignments at session load time. Never store these values in the database on the User model.

**Access Level Hierarchy:**
1. `isSuperAdmin` - Full system access across all tenants
2. `isTenantAdmin` - Full access within their tenant
3. `hasAllCompaniesAccess` - Access to all companies within their tenant (via "All Companies" role)
4. `companyIds` - Access to specific assigned companies only

### Authentication Functions

| Function | Purpose | Throws |
|----------|---------|--------|
| `getSession()` | Get current session (null if not authenticated) | Never |
| `getSessionWithTenant()` | Get session with full tenant info | Never |
| `requireAuth()` | Require authentication | `'Unauthorized'` |
| `requireAuthWithTenant()` | Require auth with tenant info | `'Unauthorized'` |
| `requireTenant()` | Require user has tenant association | `'Unauthorized'`, `'No tenant association'` |

**Usage Example:**

```typescript
// In API route
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();

    // User is authenticated, proceed...

  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    throw error;
  }
}
```

---

## Multi-Tenancy

### Tenant Isolation

All tenant-scoped entities must include `tenantId` and filter queries accordingly:

| Entity | Tenant Scope | Notes |
|--------|--------------|-------|
| User | Required | Users belong to exactly one tenant (or null for SUPER_ADMIN) |
| Company | Required | Companies are always tenant-scoped |
| Contact | Required | Contacts are always tenant-scoped |
| Document | Required | Documents are always tenant-scoped |
| Role | Required* | System SUPER_ADMIN role has tenantId=null |
| AuditLog | Optional | System-level events may have null tenantId |

### Tenant Context

Use `resolveTenantContext()` to get the current tenant context:

```typescript
import { resolveTenantContext } from '@/lib/tenant';

export async function GET(request: NextRequest) {
  const session = await requireAuth();
  const tenantContext = await resolveTenantContext(session);

  // tenantContext is null for SUPER_ADMIN (cross-tenant access)
  if (tenantContext) {
    // Regular user - scope queries to their tenant
    const companies = await prisma.company.findMany({
      where: { tenantId: tenantContext.tenantId, deletedAt: null },
    });
  } else {
    // SUPER_ADMIN - can access all tenants
    const companies = await prisma.company.findMany({
      where: { deletedAt: null },
    });
  }
}
```

### Tenant Limits

Tenants have configurable limits that must be checked before creating resources:

```typescript
import { canAddUser, canAddCompany, hasStorageCapacity } from '@/lib/tenant';

// Before creating a user
if (!(await canAddUser(tenantId))) {
  throw new Error('Tenant has reached maximum user limit');
}

// Before creating a company
if (!(await canAddCompany(tenantId))) {
  throw new Error('Tenant has reached maximum company limit');
}

// Before uploading a file
if (!(await hasStorageCapacity(tenantId, fileSize))) {
  throw new Error('Tenant has insufficient storage capacity');
}
```

### Data Scoping Patterns

**Pattern 1: Using Tenant Context Helpers**

```typescript
import { withTenantScope, tenantFilter } from '@/lib/tenant';

// Add tenant filter to queries
const companies = await prisma.company.findMany({
  where: withTenantScope(tenantContext, { deletedAt: null }),
});

// Or use tenantFilter directly
const where = {
  ...tenantFilter(tenantContext),
  deletedAt: null,
};
```

**Pattern 2: Explicit Tenant Scoping in Services**

```typescript
// In service functions, always accept tenantId as parameter
export async function createCompany(
  tenantId: string,  // Always require tenant ID
  userId: string,
  data: CreateCompanyInput
) {
  return prisma.company.create({
    data: {
      ...data,
      tenantId,  // Always set tenant ID
    },
  });
}
```

**Pattern 3: Validating Cross-Entity Tenant Consistency**

```typescript
// When referencing entities across tables, verify tenant consistency
const contact = await prisma.contact.findFirst({
  where: {
    id: contactId,
    tenantId,  // Must match the operation's tenant
  },
});

if (!contact) {
  throw new Error('Contact not found');  // Don't reveal if it exists in another tenant
}
```

**Pattern 4: Company-Scoped Contact Filtering**

For company-scoped users (COMPANY_ADMIN, COMPANY_USER), contacts are filtered to only show those linked to their assigned companies:

```typescript
// In API route
const companyIds = (!session.isSuperAdmin && !session.isTenantAdmin && !session.hasAllCompaniesAccess)
  ? session.companyIds
  : undefined;

// In service function
if (companyIds && companyIds.length > 0) {
  where.OR = [
    // Contacts linked via company relations
    { companyRelations: { some: { companyId: { in: companyIds } } } },
    // Contacts linked as officers
    { officerPositions: { some: { companyId: { in: companyIds } } } },
    // Contacts linked as shareholders
    { shareholdings: { some: { companyId: { in: companyIds } } } },
  ];
} else if (companyIds && companyIds.length === 0) {
  // User has no company assignments - return empty result
  return { contacts: [], total: 0, ... };
}
```

**Access Levels for Contacts:**
| User Type | Sees |
|-----------|------|
| SUPER_ADMIN | All contacts across all tenants |
| TENANT_ADMIN | All contacts in their tenant |
| User with "All Companies" role | All contacts in their tenant |
| COMPANY_ADMIN/USER | Only contacts linked to their assigned companies |

---

## Permission Model

### Resources and Actions

**Resources:**

| Resource | Description |
|----------|-------------|
| `tenant` | Tenant settings and configuration |
| `user` | User management |
| `role` | Role management |
| `company` | Company data |
| `contact` | Contact records |
| `document` | Documents |
| `officer` | Company officers |
| `shareholder` | Shareholders |
| `audit_log` | Audit logs |
| `connector` | External service connectors (AI providers, storage) |
| `chart_of_accounts` | Chart of accounts and mappings |

**Actions:**

| Action | Description |
|--------|-------------|
| `create` | Create new records |
| `read` | View records |
| `update` | Modify records |
| `delete` | Remove records |
| `export` | Export data |
| `import` | Import data |
| `manage` | Full control (implies all actions) |

### Permission String Format

Permissions are defined as `resource:action` combinations:

```typescript
type PermissionString = `${Resource}:${Action}`;
// Examples: 'company:create', 'document:read', 'user:manage'
```

---

## Role System

### Role Hierarchy

| systemRoleType | Scope | Description |
|----------------|-------|-------------|
| `SUPER_ADMIN` | System-wide | Global role (tenantId = null), bypasses all permission checks |
| `TENANT_ADMIN` | Tenant | Full access within tenant, auto-access to all companies |
| `COMPANY_ADMIN` | Company | Manage assigned company and its data |
| `COMPANY_USER` | Company | View-only access to assigned company |
| `null` | Configurable | Custom role with fine-grained permissions |

### System Roles

When a tenant is created, three system roles are automatically provisioned:

#### Tenant Admin
- Full access to all tenant resources
- Manage users, roles, companies
- Access all company data automatically (no explicit assignment needed)
- View audit logs and export data

#### Company Admin
- Read/update company information
- Manage contacts, officers, shareholders
- Upload and manage documents
- View audit logs
- **Requires explicit company assignment**

#### Company User
- View-only access to assigned company
- Read company information
- View contacts, officers, shareholders, documents
- **Requires explicit company assignment**

### Default Custom Roles

These custom roles are automatically seeded:

| Role | Permissions | Use Case |
|------|-------------|----------|
| **Auditor** | 7 (read + export audit logs) | Compliance review |
| **Data Entry Clerk** | 15 (create/read/update) | Data input staff |
| **Report Viewer** | 12 (read + export) | Reporting users |
| **Document Manager** | 10 (full document control) | Document specialists |
| **Manager** | 27 (full data access) | Team leads |

### Company-Scoped Roles

Roles can be assigned at two levels:

**Tenant-wide** (companyId = null):
```typescript
// User gets this role for ALL companies in tenant
await assignRoleToUser(userId, roleId, null);
```

**Company-specific** (companyId = specific ID):
```typescript
// User gets this role ONLY for this company
await assignRoleToUser(userId, roleId, companyId);
```

**Specificity Priority:**
- Company-specific roles **override** tenant-wide roles
- When accessing Company A, only Company A's specific roles apply (if any)
- If no company-specific role exists, tenant-wide role applies

---

## Permission Resolution Flow

```
                    ┌─────────────────────┐
                    │ Permission Request  │
                    │ (resource, action,  │
                    │  companyId?)        │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │ Is SUPER_ADMIN?     │───Yes──▶ ALLOWED
                    └──────────┬──────────┘
                               │ No
                    ┌──────────▼──────────┐
                    │ Is TENANT_ADMIN?    │───Yes──▶ ALLOWED (within tenant)
                    └──────────┬──────────┘
                               │ No
                    ┌──────────▼──────────┐
                    │ companyId provided? │
                    └──────────┬──────────┘
                    Yes        │         No
               ┌───────────────┴───────────────┐
               │                               │
    ┌──────────▼──────────┐         ┌──────────▼──────────┐
    │ Has company-specific│         │ Check ALL role      │
    │ role for this       │         │ assignments         │
    │ company?            │         └──────────┬──────────┘
    └──────────┬──────────┘                    │
    Yes        │         No                    │
    │          │                               │
    │    ┌─────▼─────────────┐                 │
    │    │ Fall back to      │                 │
    │    │ tenant-wide roles │                 │
    │    └─────┬─────────────┘                 │
    │          │                               │
    ▼          ▼                               ▼
┌──────────────────────────────────────────────────┐
│        Check role permissions for                │
│        resource:action match                     │
│        (including 'manage' action)               │
└──────────────────────────────────────────────────┘
```

---

## Implementation Patterns

### API Route Protection

**Standard Pattern:**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, canAccessCompany } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Step 1: Require authentication
    const session = await requireAuth();
    const { id: companyId } = await params;

    // Step 2: Check company access (tenant isolation)
    if (!(await canAccessCompany(session, companyId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Step 3: Check specific permission
    await requirePermission(session, 'document', 'create', companyId);

    // Step 4: Proceed with business logic
    const result = await createDocument(companyId, session.id, data);

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'Unauthorized') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      if (error.message === 'Forbidden' || error.message.startsWith('Permission denied')) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

**Tenant Management Routes (SUPER_ADMIN/TENANT_ADMIN only):**

```typescript
import { canManageTenant } from '@/lib/auth';

export async function PATCH(request: NextRequest, { params }) {
  const session = await requireAuth();
  const { id: tenantId } = await params;

  // Check tenant management permission
  if (!canManageTenant(session, tenantId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Proceed...
}
```

### Service Layer Patterns

**Always include tenantId and userId in service functions:**

```typescript
// Good: Explicit tenant and user context
export async function createCompany(
  tenantId: string,
  userId: string,
  data: CreateCompanyInput
): Promise<Company> {
  // Validate tenant can add more companies
  if (!(await canAddCompany(tenantId))) {
    throw new Error('Tenant has reached maximum company limit');
  }

  const company = await prisma.company.create({
    data: {
      ...data,
      tenantId,
    },
  });

  // Audit log with human-readable summary
  await createAuditLog({
    tenantId,
    userId,
    companyId: company.id,
    action: 'CREATE',
    entityType: 'Company',
    entityId: company.id,
    entityName: company.name,
    summary: `Created company "${company.name}" (UEN: ${company.uen})`,
    changeSource: 'MANUAL',
  });

  return company;
}
```

**Cross-entity operations must validate tenant consistency:**

```typescript
export async function assignContactToCompany(
  tenantId: string,
  companyId: string,
  contactId: string
) {
  // Verify both entities belong to the same tenant
  const [company, contact] = await Promise.all([
    prisma.company.findFirst({ where: { id: companyId, tenantId } }),
    prisma.contact.findFirst({ where: { id: contactId, tenantId } }),
  ]);

  if (!company) throw new Error('Company not found');
  if (!contact) throw new Error('Contact not found');

  // Now safe to create relationship
}
```

### UI Permission Checks

**Using Session Hook:**

```typescript
'use client';
import { useAuth } from '@/hooks/useAuth';

export function CompanyActions({ companyId }: { companyId: string }) {
  const { session } = useAuth();

  // Admin-only actions
  const canDelete = session?.isSuperAdmin || session?.isTenantAdmin;

  // Company access check
  const hasAccess = session?.isSuperAdmin ||
                    session?.isTenantAdmin ||
                    session?.companyIds?.includes(companyId);

  if (!hasAccess) return null;

  return (
    <div>
      <Button>Edit</Button>
      {canDelete && <Button variant="destructive">Delete</Button>}
    </div>
  );
}
```

**AuthGuard Component:**

```typescript
// Wrap protected routes in AuthGuard
<AuthGuard requireAdmin={true}>
  <AdminDashboard />
</AuthGuard>
```

---

## Audit Logging Integration

Every state-changing operation should include an audit log with a human-readable summary:

```typescript
await createAuditLog({
  tenantId,                    // Required for tenant-scoped operations
  userId,                      // Who performed the action
  companyId,                   // Optional: if company-scoped
  action: 'CREATE',            // Action type
  entityType: 'Company',       // What type of entity
  entityId: company.id,        // Entity identifier
  entityName: company.name,    // Human-readable entity name
  summary: `Created company "${company.name}" (UEN: ${company.uen})`,  // Human-readable summary
  changeSource: 'MANUAL',      // MANUAL, BIZFILE_UPLOAD, SYSTEM, etc.
  changes: { ... },            // Optional: for UPDATE actions
  reason: '...',               // Optional: for DELETE actions
  metadata: { ... },           // Optional: additional context
});
```

**Summary Format Guidelines:**
- Start with past-tense verb: "Created", "Updated", "Deleted", "Restored"
- Include entity name in quotes: `"Company Name"`
- Add relevant identifiers: `(UEN: 123456)`
- For updates, list changed fields: `(name, status, address)`
- Keep it concise but informative

---

## Bulk Operations

Bulk operations (e.g., bulk delete contacts) require the same permissions as individual operations but apply at the tenant level:

### Bulk Delete Pattern

```typescript
// API Route: DELETE /api/contacts/bulk
export async function DELETE(request: NextRequest) {
  const session = await requireAuth();
  const { ids, reason } = await request.json();

  // 1. Validate all records belong to user's tenant
  const contacts = await prisma.contact.findMany({
    where: { id: { in: ids }, deletedAt: null },
  });

  if (!session.isSuperAdmin) {
    const wrongTenant = contacts.filter(c => c.tenantId !== session.tenantId);
    if (wrongTenant.length > 0) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  // 2. Check delete permission at tenant level (not per-company)
  await requirePermission(session, 'contact', 'delete');

  // 3. Perform bulk operation with individual audit logs
  await prisma.$transaction(async (tx) => {
    await tx.contact.updateMany({
      where: { id: { in: ids } },
      data: { deletedAt: new Date() },
    });

    // Create audit log for EACH record
    for (const contact of contacts) {
      await createAuditLog({
        tenantId: contact.tenantId,
        userId: session.id,
        action: 'DELETE',
        entityType: 'Contact',
        entityId: contact.id,
        entityName: contact.fullName,
        summary: `Bulk deleted contact "${contact.fullName}"`,
        changeSource: 'MANUAL',
        metadata: { bulkOperation: true, reason },
      });
    }
  });
}
```

### Key Points for Bulk Operations

1. **Permission Check**: For bulk operations, check permission at tenant level (without companyId) since records may span multiple companies
2. **Tenant Validation**: Always verify ALL records belong to the user's tenant
3. **Individual Audit Logs**: Create separate audit log entries for each affected record
4. **Limits**: Enforce reasonable limits (e.g., max 100 records per request)
5. **Reason Tracking**: Require a reason for bulk deletes to maintain compliance

---

## Adding New Features

### Step 1: Define Permissions

If the feature requires new resources or actions, update `src/lib/rbac.ts`:

```typescript
export const RESOURCES = [
  // ...existing
  'new_resource',
] as const;
```

### Step 2: Update System Roles

Add permissions to system roles if appropriate:

```typescript
export const SYSTEM_ROLES = {
  TENANT_ADMIN: {
    permissions: [
      // ...existing
      'new_resource:create',
      'new_resource:read',
    ],
  },
};
```

### Step 3: Run Database Seed

```bash
npm run db:seed
```

### Step 4: Implement API Route

Follow the standard pattern with authentication, tenant isolation, and permission checks.

### Step 5: Add Audit Logging

Include human-readable audit logs for all state changes.

### Step 6: Update Documentation

Update this document and `docs/README.md` with new permissions.

---

## Testing & Debugging

### Debug Permissions

```typescript
import { getUserPermissions, hasPermission } from '@/lib/rbac';

// Get all effective permissions
const permissions = await getUserPermissions(userId, companyId);
console.log(permissions);

// Check specific permission
const canEdit = await hasPermission(userId, 'company', 'update', companyId);
```

### Test Different Role Scenarios

```typescript
// Test cases to cover:
// 1. SUPER_ADMIN - should have all access
// 2. TENANT_ADMIN - should have full tenant access
// 3. COMPANY_ADMIN with company assignment - should access that company
// 4. COMPANY_USER with company assignment - should have read-only access
// 5. User with no assignment - should be denied
// 6. User accessing different tenant's data - should be denied
```

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| "Unauthorized" | No valid JWT token | Check login, cookie settings |
| "Forbidden" | Missing permission | Check role assignments |
| "Permission denied" | Specific permission missing | Check RBAC configuration |
| Data from other tenant visible | Missing tenant filter | Add `tenantId` to query |

---

## Best Practices

### DO:

1. **Always use `requireAuth()` in API routes** - Every API must verify authentication
2. **Always scope data by tenant** - Use `tenantId` in all queries
3. **Pass companyId for company-scoped checks** - Enables specificity resolution
4. **Include human-readable audit summaries** - Makes logs useful for admins
5. **Validate tenant limits before creation** - Respect tenant quotas
6. **Test with multiple role types** - Ensure all role types work correctly
7. **Use session flags for quick checks** - `isSuperAdmin`, `isTenantAdmin`

### DON'T:

1. **Don't skip permission checks for "internal" APIs** - All APIs need protection
2. **Don't hardcode tenant IDs** - Always derive from session or parameters
3. **Don't expose data across tenants** - Always filter by tenant
4. **Don't modify system roles** - They're protected for consistency
5. **Don't store computed flags in database** - `isSuperAdmin` etc. are computed
6. **Don't forget audit logging** - Every state change needs a log

---

## Quick Reference

### Import Cheatsheet

```typescript
// Authentication
import { requireAuth, getSession, canAccessCompany, canManageTenant } from '@/lib/auth';

// RBAC
import { requirePermission, hasPermission, getUserPermissions } from '@/lib/rbac';

// Multi-tenancy
import { resolveTenantContext, canAddUser, canAddCompany } from '@/lib/tenant';

// Audit logging
import { createAuditLog } from '@/lib/audit';
```

### Common Permission Checks

```typescript
// Is user authenticated?
const session = await requireAuth();

// Can user access this company?
await canAccessCompany(session, companyId);

// Does user have specific permission?
await requirePermission(session, 'document', 'create', companyId);

// Is user a super admin?
if (session.isSuperAdmin) { ... }

// Is user a tenant admin?
if (session.isTenantAdmin) { ... }

// Does user have "All Companies" access?
if (session.hasAllCompaniesAccess) { ... }

// Can user manage this tenant?
if (canManageTenant(session, tenantId)) { ... }

// Is user company-scoped (needs filtering by companyIds)?
const isCompanyScoped = !session.isSuperAdmin && !session.isTenantAdmin && !session.hasAllCompaniesAccess;
```

### Audit Log Actions

| Category | Actions |
|----------|---------|
| CRUD | CREATE, UPDATE, DELETE, RESTORE |
| Documents | UPLOAD, DOWNLOAD, EXTRACT |
| Auth | LOGIN, LOGOUT, LOGIN_FAILED, PASSWORD_CHANGED |
| Access | PERMISSION_GRANTED, PERMISSION_REVOKED, ROLE_CHANGED |
| Tenant | TENANT_CREATED, TENANT_UPDATED, USER_INVITED, USER_REMOVED |
| Connectors | CONNECTOR_CREATED, CONNECTOR_UPDATED, CONNECTOR_DELETED, CONNECTOR_TESTED, CONNECTOR_ENABLED, CONNECTOR_DISABLED, CONNECTOR_ACCESS_UPDATED |
| Doc Generation | DOCUMENT_TEMPLATE_CREATED, DOCUMENT_TEMPLATE_UPDATED, DOCUMENT_TEMPLATE_DELETED, DOCUMENT_TEMPLATE_DUPLICATED, DOCUMENT_GENERATED, DOCUMENT_FINALIZED, DOCUMENT_UNFINALIZED, DOCUMENT_ARCHIVED, DOCUMENT_CLONED, SHARE_LINK_CREATED, SHARE_LINK_REVOKED, LETTERHEAD_UPDATED, COMMENT_CREATED, COMMENT_RESOLVED, COMMENT_HIDDEN |
| Bulk | BULK_UPDATE, BULK_DELETE (creates individual audit logs per record) |

---

## Document Generation Module Permissions

The Document Generation Module (templates, generated documents, comments) uses the existing `document` resource permissions:

| Permission | Allows |
|------------|--------|
| `document:read` | View templates, generated documents, comments |
| `document:create` | Create templates and generate documents |
| `document:update` | Edit templates/documents, finalize/unfinalize, create comments, manage comments (resolve/hide) |
| `document:delete` | Delete templates and delete/archive generated documents |

### Access Resolution for Document Generation

```
┌─────────────────────────────────────────────────────────────────┐
│                   Document Generation Access                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  SUPER_ADMIN                                                     │
│  └── Full access to all tenants' templates and documents        │
│                                                                  │
│  TENANT_ADMIN                                                    │
│  └── Full access to all templates/documents in tenant           │
│                                                                  │
│  Users with document:* permissions                               │
│  └── Access based on assigned permissions                       │
│  └── Templates: tenant-wide access                              │
│  └── Documents: can be scoped to companies (optional)           │
│                                                                  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Related Documents

- [Database Schema](../reference/DATABASE_SCHEMA.md) - Entity relationships and tables
- [Document Generation](../features/document-generation/OVERVIEW.md) - Module design and implementation
- [README](../README.md) - System overview
- [Service Patterns](./SERVICE_PATTERNS.md) - Service layer conventions
