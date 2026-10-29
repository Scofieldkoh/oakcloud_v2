# Audit Logging Guide

> **Last Updated**: 2025-01-12
> **Audience**: Developers

Comprehensive audit logging tracks all changes, user actions, and system events in Oakcloud.

## Related Documents

- [Service Patterns](./SERVICE_PATTERNS.md) - Service layer conventions
- [RBAC Guideline](./RBAC_GUIDELINE.md) - Authentication and permissions
- [Database Schema](../reference/DATABASE_SCHEMA.md) - AuditLog table

---

## Overview

All data modifications and significant actions are tracked in the `AuditLog` table with full context about who, what, when, and why.

---

## Tracked Actions

| Category | Actions |
|----------|---------|
| **CRUD** | CREATE, UPDATE, DELETE, RESTORE |
| **Documents** | UPLOAD, DOWNLOAD, EXTRACT |
| **Authentication** | LOGIN, LOGOUT, LOGIN_FAILED, PASSWORD_CHANGED, PASSWORD_RESET_REQUESTED, PASSWORD_RESET_COMPLETED |
| **Access Control** | PERMISSION_GRANTED, PERMISSION_REVOKED, ROLE_CHANGED |
| **Tenant** | TENANT_CREATED, TENANT_UPDATED, TENANT_SUSPENDED, TENANT_ACTIVATED, USER_INVITED, USER_REMOVED |
| **Data** | EXPORT, IMPORT, BULK_UPDATE |

---

## Request Context

Each audit log automatically captures:

| Field | Description |
|-------|-------------|
| `ipAddress` | Client IP (supports proxy headers) |
| `userAgent` | Browser/client information |
| `requestId` | Correlates related operations |
| `timestamp` | Immutable creation time |

---

## Change Tracking

For UPDATE actions, the system records field-level changes:

```json
{
  "changes": {
    "name": { "old": "Old Company Name", "new": "New Company Name" },
    "status": { "old": "LIVE", "new": "STRUCK_OFF" }
  }
}
```

---

## Usage in Services

### Creating Audit Context

```typescript
import { createAuditContext, logCreate, logUpdate, logDelete } from '@/lib/audit';

// Create audit context at the start of a request
const auditContext = await createAuditContext({
  tenantId: session.tenantId,
  userId: session.id,
  changeSource: 'MANUAL',  // or 'BIZFILE_UPLOAD', 'API', 'SYSTEM'
});
```

### Logging Operations

```typescript
// Log a creation (with entity name for human-readable summary)
await logCreate(auditContext, 'Company', company.id, company.name, { uen: company.uen });

// Log an update with changes
await logUpdate(auditContext, 'Company', company.id, company.name, changes, 'Updated by user request');

// Log a deletion with reason
await logDelete(auditContext, 'Company', company.id, company.name, 'No longer a client');
```

---

## Human-Readable Summaries

All audit log entries include automatically generated summaries:

```typescript
// Example summaries generated:
"Created company 'Acme Pte Ltd'"
"Updated company 'Acme Pte Ltd'"
"Deleted tenant 'Demo Corp' (cascade: 5 users, 3 companies)"
"Invited user 'John Doe' with role Company Admin"
"User 'admin@example.com' logged in"
```

---

## Specialized Logging Functions

### User Membership Changes

```typescript
await logUserMembership(context, 'USER_INVITED', userId, {
  email: 'user@example.com',
  firstName: 'John',
  lastName: 'Doe',
  roleAssignments: [{ roleName: 'Company Admin', companyName: 'Acme Pte Ltd' }]
});
```

### Tenant Operations

```typescript
await logTenantOperation('TENANT_DELETED', tenantId, 'Acme Corp', userId, undefined, 'Account closure');
```

---

## Computing Changes

Use `computeChanges` to calculate field-level differences:

```typescript
import { computeChanges } from '@/lib/audit';

const TRACKED_FIELDS = ['name', 'status', 'email'];

const changes = computeChanges(existingRecord, newData, TRACKED_FIELDS);
// Returns: { name: { old: 'Old', new: 'New' }, ... }
```

---

## AuditLog Table Schema

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `tenantId` | UUID | Tenant scope (nullable for system events) |
| `userId` | UUID | User who performed the action |
| `action` | Enum | Action type (CREATE, UPDATE, etc.) |
| `entityType` | String | Table/model name |
| `entityId` | String | Record ID |
| `entityName` | String | Human-readable name |
| `summary` | String | Human-readable description |
| `changes` | JSON | Old/new value pairs |
| `reason` | String | User-provided reason |
| `changeSource` | Enum | MANUAL, BIZFILE_UPLOAD, API, SYSTEM |
| `requestId` | String | Request correlation ID |
| `ipAddress` | String | Client IP address |
| `userAgent` | String | Client browser info |
| `createdAt` | DateTime | Immutable timestamp |

---

## Best Practices

1. **Always create audit context** at the start of service operations
2. **Include entity names** for human-readable summaries
3. **Track field changes** using `computeChanges` for UPDATE actions
4. **Provide reasons** for DELETE operations
5. **Use appropriate changeSource** to distinguish data entry method
6. **Don't expose sensitive data** in changes (passwords, tokens, etc.)
