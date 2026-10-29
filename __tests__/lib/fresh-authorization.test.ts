import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  evaluateFreshAuthorization,
  resolveFreshActor,
  lockFreshAuthorizationScope,
  type FreshAuthorizationClient,
  type FreshAuthorizationTransactionClient,
} from '@/lib/fresh-authorization';

type FakeDb = {
  user: { findUnique: ReturnType<typeof vi.fn> };
  workspace: { findUnique: ReturnType<typeof vi.fn> };
  company: { findUnique: ReturnType<typeof vi.fn> };
  contact: { findUnique: ReturnType<typeof vi.fn> };
  document: { findUnique: ReturnType<typeof vi.fn> };
  processingDocument: { findUnique: ReturnType<typeof vi.fn> };
  generatedDocument: { findUnique: ReturnType<typeof vi.fn> };
  task: { findUnique: ReturnType<typeof vi.fn> };
  $queryRaw: ReturnType<typeof vi.fn>;
};

function createDb(): FakeDb {
  return {
    user: { findUnique: vi.fn() },
    workspace: { findUnique: vi.fn() },
    company: { findUnique: vi.fn() },
    contact: { findUnique: vi.fn() },
    document: { findUnique: vi.fn() },
    processingDocument: { findUnique: vi.fn() },
    generatedDocument: { findUnique: vi.fn() },
    task: { findUnique: vi.fn() },
    $queryRaw: vi.fn(),
  };
}

function role(
  systemRoleType: string,
  tenantId: string | null,
  permissions: Array<[string, string]>,
  companyId: string | null = null,
) {
  return {
    companyId,
    role: {
      id: `${systemRoleType}-${tenantId || 'global'}`,
      tenantId,
      systemRoleType,
      permissions: permissions.map(([resource, action]) => ({ permission: { resource, action } })),
    },
  };
}

function user(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    email: 'user@example.test',
    firstName: 'Test',
    lastName: 'User',
    tenantId: 'workspace-1',
    isActive: true,
    deletedAt: null,
    roleAssignments: [
      role('STAFF', 'workspace-1', [['company', 'read']], null),
    ],
    ...overrides,
  };
}

function workspace(overrides: Record<string, unknown> = {}) {
  return {
    id: 'workspace-1',
    name: 'Workspace',
    slug: 'workspace',
    status: 'ACTIVE',
    deletedAt: null,
    ...overrides,
  };
}

function document(overrides: Record<string, unknown> = {}) {
  return {
    id: 'document-1',
    tenantId: 'workspace-1',
    companyId: null,
    deletedAt: null,
    ...overrides,
  };
}

describe('fresh authorization', () => {
  let db: FakeDb;

  beforeEach(() => {
    db = createDb();
    db.user.findUnique.mockResolvedValue(user());
    db.workspace.findUnique.mockResolvedValue(workspace());
    db.$queryRaw.mockResolvedValue([]);
  });

  it('resolves the explicit actor and workspace without cookies or cached session flags', async () => {
    const actor = await resolveFreshActor(
      { userId: 'user-1', workspaceId: 'workspace-1' },
      db as unknown as FreshAuthorizationClient,
    );

    expect(actor).toMatchObject({
      id: 'user-1',
      tenantId: 'workspace-1',
      workspaceId: 'workspace-1',
      isSuperAdmin: false,
    });
    expect(db.user.findUnique).toHaveBeenCalledOnce();
    expect(db.workspace.findUnique).toHaveBeenCalledOnce();
  });

  it('locks the global authority gate before workspace and live authority rows', async () => {
    db.$queryRaw
      .mockResolvedValueOnce([]) // global statement gate
      .mockResolvedValueOnce([]) // advisory gate
      .mockResolvedValueOnce([{ tenantId: 'workspace-1' }])
      .mockResolvedValueOnce([]) // workspace rows
      .mockResolvedValueOnce([{ roleId: 'role-1' }])
      .mockResolvedValueOnce([]) // role rows
      .mockResolvedValueOnce([{ permissionId: 'permission-1' }])
      .mockResolvedValueOnce([]); // permission rows

    await lockFreshAuthorizationScope(
      db as unknown as FreshAuthorizationTransactionClient,
      { userId: 'user-1', workspaceId: 'workspace-1' },
    );

    const sql = db.$queryRaw.mock.calls.map(([query]) => (query as { sql: string }).sql);
    expect(sql[0]).toContain('pg_advisory_xact_lock');
    expect(db.$queryRaw.mock.calls[0][0].values).toEqual(['oakcloud:authorization:global']);
    expect(db.$queryRaw.mock.calls[1][0].values).toEqual(['oakcloud:authorization:workspace-1']);
    expect(sql.some((query) => query.includes('FROM "users"') && query.includes('FOR UPDATE'))).toBe(true);
    expect(sql.some((query) => query.includes('FROM "user_role_assignments"') && query.includes('FOR UPDATE'))).toBe(true);
    expect(sql.some((query) => query.includes('FROM "roles"') && query.includes('FOR UPDATE'))).toBe(true);
    expect(sql.some((query) => query.includes('FROM "role_permissions"') && query.includes('FOR UPDATE'))).toBe(true);
    expect(sql.some((query) => query.includes('FROM "permissions"') && query.includes('FOR UPDATE'))).toBe(true);
  });

  it('uses the supplied transaction client and reports its consistency scope', async () => {
    const decision = await evaluateFreshAuthorization(
      {
        userId: 'user-1',
        workspaceId: 'workspace-1',
        permission: { resource: 'company', action: 'read' },
      },
      db as unknown as FreshAuthorizationClient,
    );

    expect(decision.allowed).toBe(true);
    expect(decision.consistency).toBe('transaction-scoped');
    expect(decision.requiresAuthorizationGate).toBe(true);
  });

  it('fails closed when a transaction-shaped client cannot acquire the shared gate', async () => {
    const delegateOnlyDb = createDb();
    (delegateOnlyDb as { $queryRaw?: unknown }).$queryRaw = undefined;
    delegateOnlyDb.user.findUnique.mockResolvedValue(user());
    delegateOnlyDb.workspace.findUnique.mockResolvedValue(workspace());

    const decision = await evaluateFreshAuthorization(
      {
        userId: 'user-1',
        workspaceId: 'workspace-1',
        permission: { resource: 'company', action: 'read' },
      },
      delegateOnlyDb as unknown as FreshAuthorizationClient,
    );

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('authorization_gate_unavailable');
  });

  it('denies a disabled actor, even when the cached role would otherwise allow access', async () => {
    db.user.findUnique.mockResolvedValue(user({ isActive: false }));

    const decision = await evaluateFreshAuthorization(
      {
        userId: 'user-1',
        workspaceId: 'workspace-1',
        permission: { resource: 'company', action: 'read' },
      },
      db as unknown as FreshAuthorizationClient,
    );

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('actor_inactive');
  });

  it('does not treat a tenant-bound administrator role as global authority', async () => {
    db.user.findUnique.mockResolvedValue(user({
      tenantId: 'workspace-1',
      roleAssignments: [role('ADMIN', 'workspace-1', [['company', 'read']], null)],
    }));
    db.workspace.findUnique.mockResolvedValue(workspace({ id: 'workspace-2' }));

    const decision = await evaluateFreshAuthorization(
      {
        userId: 'user-1',
        workspaceId: 'workspace-2',
        permission: { resource: 'company', action: 'read' },
      },
      db as unknown as FreshAuthorizationClient,
    );

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('workspace_membership_denied');
  });

  it('checks the live company resource and assignment scope', async () => {
    db.user.findUnique.mockResolvedValue(user({
      roleAssignments: [role('STAFF', 'workspace-1', [['company', 'read']], 'company-1')],
    }));
    db.company.findUnique.mockResolvedValue({
      id: 'company-2',
      tenantId: 'workspace-1',
      deletedAt: null,
    });

    const decision = await evaluateFreshAuthorization(
      {
        userId: 'user-1',
        workspaceId: 'workspace-1',
        permission: { resource: 'company', action: 'read' },
        resource: { kind: 'company', id: 'company-2' },
      },
      db as unknown as FreshAuthorizationClient,
    );

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('permission_denied');
  });

  it('allows a workspace administrator to read an unlinked document without explicit permission rows', async () => {
    db.user.findUnique.mockResolvedValue(user({
      roleAssignments: [role('ADMIN', 'workspace-1', [], null)],
    }));
    db.document.findUnique.mockResolvedValue(document());

    const decision = await evaluateFreshAuthorization(
      {
        userId: 'user-1',
        workspaceId: 'workspace-1',
        permission: { resource: 'document', action: 'read' },
        resource: { kind: 'document', id: 'document-1' },
      },
      db as unknown as FreshAuthorizationClient,
    );

    expect(decision.allowed).toBe(true);
    expect(decision.actor?.isWorkspaceAdmin).toBe(true);
  });

  it('does not treat a company-scoped administrator as a workspace administrator for an unlinked document', async () => {
    db.user.findUnique.mockResolvedValue(user({
      roleAssignments: [role('ADMIN', 'workspace-1', [], 'company-1')],
    }));
    db.document.findUnique.mockResolvedValue(document());

    const decision = await evaluateFreshAuthorization(
      {
        userId: 'user-1',
        workspaceId: 'workspace-1',
        permission: { resource: 'document', action: 'read' },
        resource: { kind: 'document', id: 'document-1' },
      },
      db as unknown as FreshAuthorizationClient,
    );

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('permission_denied');
  });

  it('denies a non-administrator without document permission for an unlinked document', async () => {
    db.user.findUnique.mockResolvedValue(user({
      roleAssignments: [role('STAFF', 'workspace-1', [], null)],
    }));
    db.document.findUnique.mockResolvedValue(document());

    const decision = await evaluateFreshAuthorization(
      {
        userId: 'user-1',
        workspaceId: 'workspace-1',
        permission: { resource: 'document', action: 'read' },
        resource: { kind: 'document', id: 'document-1' },
      },
      db as unknown as FreshAuthorizationClient,
    );

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('permission_denied');
  });

  it('keeps an unlinked document from another workspace denied to a workspace administrator', async () => {
    db.user.findUnique.mockResolvedValue(user({
      roleAssignments: [role('ADMIN', 'workspace-1', [], null)],
    }));
    db.document.findUnique.mockResolvedValue(document({ tenantId: 'workspace-2' }));

    const decision = await evaluateFreshAuthorization(
      {
        userId: 'user-1',
        workspaceId: 'workspace-1',
        permission: { resource: 'document', action: 'read' },
        resource: { kind: 'document', id: 'document-1' },
      },
      db as unknown as FreshAuthorizationClient,
    );

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('resource_workspace_mismatch');
  });

  it('keeps a deleted unlinked document denied to a workspace administrator', async () => {
    db.user.findUnique.mockResolvedValue(user({
      roleAssignments: [role('ADMIN', 'workspace-1', [], null)],
    }));
    db.document.findUnique.mockResolvedValue(document({ deletedAt: new Date('2026-01-01T00:00:00.000Z') }));

    const decision = await evaluateFreshAuthorization(
      {
        userId: 'user-1',
        workspaceId: 'workspace-1',
        permission: { resource: 'document', action: 'read' },
        resource: { kind: 'document', id: 'document-1' },
      },
      db as unknown as FreshAuthorizationClient,
    );

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('resource_deleted');
  });

  it('rejects a deleted source before returning a resource decision', async () => {
    db.document.findUnique.mockResolvedValue({
      id: 'document-1',
      tenantId: 'workspace-1',
      companyId: null,
      deletedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const decision = await evaluateFreshAuthorization(
      {
        userId: 'user-1',
        workspaceId: 'workspace-1',
        permission: { resource: 'document', action: 'read' },
        resource: { kind: 'document', id: 'document-1' },
      },
      db as unknown as FreshAuthorizationClient,
    );

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('resource_deleted');
  });
});
