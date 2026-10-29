/**
 * Fresh authorization for durable/background work.
 *
 * Browser sessions deliberately cache a derived SessionUser. A worker cannot
 * use that cache (or a browser cookie), because the user, workspace, role, and
 * resource may have changed since the request was accepted. This module takes
 * explicit identifiers and reads the current rows from the supplied database
 * client.
 *
 * Consistency contract:
 * - With a Prisma transaction client, the evaluator first acquires the shared
 *   authorization gate and row locks for the user, workspace, memberships,
 *   roles, and role permissions. Authorization writers must acquire the same
 *   gate before changing those rows; this makes a concurrent revocation wait
 *   until the worker transaction finishes. Callers must invoke the evaluator
 *   inside the mutation transaction, after the backup barrier, and keep the
 *   mutation in that same transaction.
 * - Without a transaction client, the result is a read-committed preflight.
 *   It bypasses process-local caches but does not close the race with a
 *   concurrent revocation. The caller must still use coordinated authorization
 *   revision/lock semantics before enabling a durable writer. A transaction
 *   shaped client without `$queryRaw` fails closed because it cannot acquire
 *   the shared gate.
 */

import { Prisma, type PrismaClient, type WorkspaceStatus } from '@/generated/prisma';
import { prisma } from '@/lib/prisma';
import type { Action, PermissionString, Resource } from '@/lib/rbac';
import { AUTHORIZATION_GLOBAL_ADVISORY_KEY } from '@/lib/authorization-mutation-gate';

type AuthorizationClient = Pick<
  Prisma.TransactionClient,
  'user' | 'workspace' | 'company' | 'contact' | 'document' | 'processingDocument' | 'generatedDocument' | 'task'
> | Pick<
  PrismaClient,
  'user' | 'workspace' | 'company' | 'contact' | 'document' | 'processingDocument' | 'generatedDocument' | 'task'
>;

export type FreshAuthorizationClient = AuthorizationClient;

/**
 * The transaction client required by the authorization gate. Keeping the raw
 * query method in this type prevents a delegate-only mock/client from being
 * mistaken for a transaction that can establish the revocation boundary.
 */
export type FreshAuthorizationTransactionClient = FreshAuthorizationClient & Pick<
  Prisma.TransactionClient,
  '$queryRaw'
>;

export interface FreshAuthorizationScope {
  userId: string;
  workspaceId: string;
}

export class FreshAuthorizationGateUnavailableError extends Error {
  readonly code = 'AUTHORIZATION_GATE_UNAVAILABLE';

  constructor(message = 'Fresh authorization requires a Prisma transaction client with the shared authorization gate.') {
    super(message);
    this.name = 'FreshAuthorizationGateUnavailableError';
  }
}

export type FreshAuthorizationConsistency = 'transaction-scoped' | 'read-committed-preflight';

export type FreshAuthorizationDenialReason =
  | 'invalid_input'
  | 'actor_not_found'
  | 'actor_inactive'
  | 'actor_deleted'
  | 'workspace_not_found'
  | 'workspace_inactive'
  | 'workspace_deleted'
  | 'workspace_membership_denied'
  | 'resource_not_found'
  | 'resource_deleted'
  | 'resource_workspace_mismatch'
  | 'resource_company_denied'
  | 'permission_denied'
  | 'unsupported_resource'
  | 'authorization_gate_unavailable';

export type FreshResourceReference =
  | { kind: 'workspace'; id?: string }
  | { kind: 'company'; id: string }
  | { kind: 'contact'; id: string }
  | { kind: 'document'; id: string }
  | { kind: 'processingDocument'; id: string }
  | { kind: 'generatedDocument'; id: string }
  | { kind: 'task'; id: string };

export interface FreshAuthorizationInput {
  /** User ID from the durable request/approval. Never read from cookies here. */
  userId: string;
  /** Explicit Workspace ID (the repository's tenantId value). */
  workspaceId: string;
  permission: {
    resource: Resource;
    action: Action;
  };
  resource?: FreshResourceReference;
}

export interface FreshRoleAssignment {
  companyId: string | null;
  roleId: string;
  roleTenantId: string | null;
  systemRoleType: string | null;
  permissions: PermissionString[];
}

export interface FreshActor {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  tenantId: string | null;
  workspaceId: string;
  internalRole: 'ADMIN' | 'MANAGER' | 'STAFF';
  isSuperAdmin: boolean;
  isWorkspaceAdmin: boolean;
  hasAllCompaniesAccess: boolean;
  companyIds: string[];
  roleAssignments: FreshRoleAssignment[];
}

export interface FreshResource {
  kind: FreshResourceReference['kind'];
  id: string;
  workspaceId: string;
  companyId?: string | null;
}

export interface FreshAuthorizationDecision {
  allowed: boolean;
  actor: FreshActor | null;
  resource: FreshResource | null;
  reason: FreshAuthorizationDenialReason | null;
  permission: `${Resource}:${Action}`;
  consistency: FreshAuthorizationConsistency;
  /**
   * Always true for mutation-capable callers until all authorization writers
   * participate in the same gate/lock protocol.
   */
  requiresAuthorizationGate: true;
}

type UserWithAuthorizationRows = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  tenantId: string | null;
  isActive: boolean;
  deletedAt: Date | null;
  roleAssignments: Array<{
    companyId: string | null;
    role: {
      id: string;
      tenantId: string | null;
      systemRoleType: string | null;
      permissions: Array<{
        permission: {
          resource: string;
          action: string;
        };
      }>;
    };
  }>;
};

type WorkspaceRow = {
  id: string;
  name?: string;
  slug?: string;
  status: WorkspaceStatus;
  deletedAt: Date | null;
};

type ResourceRow = {
  id: string;
  tenantId: string;
  deletedAt?: Date | null;
  companyId?: string | null;
  companyRelations?: Array<{ companyId: string; deletedAt: Date | null }>;
};

const ACTIVE_WORKSPACE_STATUS: WorkspaceStatus = 'ACTIVE';

const USER_AUTHORIZATION_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  tenantId: true,
  isActive: true,
  deletedAt: true,
  roleAssignments: {
    select: {
      companyId: true,
      role: {
        select: {
          id: true,
          tenantId: true,
          systemRoleType: true,
          permissions: {
            select: {
              permission: {
                select: {
                  resource: true,
                  action: true,
                },
              },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.UserSelect;

const WORKSPACE_AUTHORIZATION_SELECT = {
  id: true,
  name: true,
  slug: true,
  status: true,
  deletedAt: true,
} satisfies Prisma.WorkspaceSelect;

function hasText(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

type AuthorizationUserLockRow = {
  tenantId: string | null;
};

type AuthorizationAssignmentLockRow = {
  roleId: string;
};

type AuthorizationRolePermissionLockRow = {
  permissionId: string;
};

function asTransactionClient(client: AuthorizationClient): FreshAuthorizationTransactionClient {
  if (client === prisma || typeof (client as Partial<FreshAuthorizationTransactionClient>).$queryRaw !== 'function') {
    throw new FreshAuthorizationGateUnavailableError();
  }

  return client as FreshAuthorizationTransactionClient;
}

/**
 * Acquire the authorization mutation gate and lock all authority rows used by
 * the evaluator. Every authorization writer that can revoke access must call
 * this helper in its own transaction before changing User, Workspace,
 * UserRoleAssignment, Role, RolePermission, or Permission rows.
 *
 * The advisory lock serializes writers that use this contract even when a
 * membership row does not exist yet. The row locks cover existing authority
 * rows and PostgreSQL foreign-key key-share conflicts cover inserts that refer
 * to a locked user or role. This helper intentionally has no Prisma schema
 * dependency beyond the existing mapped table/column names.
 */
export async function lockFreshAuthorizationScope(
  client: FreshAuthorizationTransactionClient,
  scope: FreshAuthorizationScope,
): Promise<void> {
  if (!hasText(scope.userId) || !hasText(scope.workspaceId)) {
    throw new FreshAuthorizationGateUnavailableError('Fresh authorization gate requires userId and workspaceId.');
  }

  // Statement-level database triggers acquire this key BEFORE an authority
  // writer locks rows. One global exclusive gate also avoids shared-to-exclusive
  // upgrades when a canonical write adds a role assignment. Keep transactions
  // short; provider/storage work must never run while this gate is held.
  await client.$queryRaw(
    Prisma.sql`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended(${AUTHORIZATION_GLOBAL_ADVISORY_KEY}, 0))) AS authorization_lock`,
  );
  // The workspace key is retained for compatibility with explicit callers.
  await client.$queryRaw(
    Prisma.sql`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended(${`oakcloud:authorization:${scope.workspaceId}`}, 0))) AS authorization_lock`,
  );

  const userRows = (await client.$queryRaw<AuthorizationUserLockRow[]>(
    Prisma.sql`
      SELECT "tenantId"
      FROM "users"
      WHERE "id" = ${scope.userId}
      FOR UPDATE
    `,
  )) ?? [];

  const workspaceIds = [
    scope.workspaceId,
    userRows[0]?.tenantId,
  ]
    .filter((workspaceId): workspaceId is string => hasText(workspaceId))
    .sort()
    .filter((workspaceId, index, values) => index === 0 || workspaceId !== values[index - 1]);

  if (workspaceIds.length > 0) {
    await client.$queryRaw(
      Prisma.sql`
        SELECT "id"
        FROM "tenants"
        WHERE "id" IN (${Prisma.join(workspaceIds)})
        ORDER BY "id"
        FOR UPDATE
      `,
    );
  }

  const assignmentRows = (await client.$queryRaw<AuthorizationAssignmentLockRow[]>(
    Prisma.sql`
      SELECT "roleId"
      FROM "user_role_assignments"
      WHERE "userId" = ${scope.userId}
      ORDER BY "roleId", "id"
      FOR UPDATE
    `,
  )) ?? [];
  const roleIds = [...new Set(
    assignmentRows
      .map((assignment) => assignment.roleId)
      .filter((roleId): roleId is string => hasText(roleId)),
  )].sort();

  if (roleIds.length === 0) return;

  await client.$queryRaw(
    Prisma.sql`
      SELECT "id"
      FROM "roles"
      WHERE "id" IN (${Prisma.join(roleIds)})
      ORDER BY "id"
      FOR UPDATE
    `,
  );

  const rolePermissionRows = (await client.$queryRaw<AuthorizationRolePermissionLockRow[]>(
    Prisma.sql`
      SELECT "permissionId"
      FROM "role_permissions"
      WHERE "roleId" IN (${Prisma.join(roleIds)})
      ORDER BY "roleId", "permissionId", "id"
      FOR UPDATE
    `,
  )) ?? [];
  const permissionIds = [...new Set(
    rolePermissionRows
      .map((rolePermission) => rolePermission.permissionId)
      .filter((permissionId): permissionId is string => hasText(permissionId)),
  )].sort();

  if (permissionIds.length > 0) {
    await client.$queryRaw(
      Prisma.sql`
        SELECT "id"
        FROM "permissions"
        WHERE "id" IN (${Prisma.join(permissionIds)})
        ORDER BY "id"
        FOR UPDATE
      `,
    );
  }
}

/** Run one authorization-sensitive mutation under the shared transaction gate. */
export async function withFreshAuthorizationGate<T>(
  client: FreshAuthorizationTransactionClient,
  scope: FreshAuthorizationScope,
  mutation: () => Promise<T>,
): Promise<T> {
  await lockFreshAuthorizationScope(client, scope);
  return mutation();
}

function normalizeSystemRole(systemRoleType: string | null | undefined): 'ADMIN' | 'MANAGER' | 'STAFF' | null {
  if (systemRoleType === 'ADMIN' || systemRoleType === 'SUPER_ADMIN' || systemRoleType === 'TENANT_ADMIN') {
    return 'ADMIN';
  }
  if (systemRoleType === 'MANAGER' || systemRoleType === 'COMPANY_ADMIN') {
    return 'MANAGER';
  }
  if (systemRoleType === 'STAFF' || systemRoleType === 'COMPANY_USER') {
    return 'STAFF';
  }
  return null;
}

function isGlobalRole(role: UserWithAuthorizationRows['roleAssignments'][number]['role'], userTenantId: string | null): boolean {
  // SUPER_ADMIN is the explicit global label used by the seed. The internal
  // role migration also converted an old global SUPER_ADMIN role to ADMIN; the
  // null role/user workspace pair preserves that scoped global behavior while
  // preventing a tenant-bound ADMIN from crossing workspaces.
  return role.tenantId === null
    && (role.systemRoleType === 'SUPER_ADMIN' || (role.systemRoleType === 'ADMIN' && userTenantId === null));
}

function roleBelongsToWorkspace(
  role: UserWithAuthorizationRows['roleAssignments'][number]['role'],
  workspaceId: string,
  userTenantId: string | null,
): boolean {
  return role.tenantId === workspaceId || isGlobalRole(role, userTenantId);
}

function permissionKey(resource: Resource, action: Action): `${Resource}:${Action}` {
  return `${resource}:${action}`;
}

function allowsPermission(
  assignments: FreshRoleAssignment[],
  permission: FreshAuthorizationInput['permission'],
  companyId?: string | null,
): boolean {
  const applicable = companyId
    ? (() => {
      const companySpecific = assignments.filter((assignment) => assignment.companyId === companyId);
      return companySpecific.length > 0
        ? companySpecific
        : assignments.filter((assignment) => assignment.companyId === null);
    })()
    : assignments.filter((assignment) => assignment.companyId === null);

  const required = permissionKey(permission.resource, permission.action);
  return applicable.some((assignment) =>
    assignment.permissions.includes(required) || assignment.permissions.includes(`${permission.resource}:manage` as PermissionString)
  );
}

function hasWorkspaceAdminAssignment(assignments: FreshRoleAssignment[], companyId?: string | null): boolean {
  const scoped = companyId
    ? assignments.filter((assignment) => assignment.companyId === null || assignment.companyId === companyId)
    : assignments.filter((assignment) => assignment.companyId === null);

  return scoped.some((assignment) => assignment.systemRoleType === 'ADMIN'
    || assignment.systemRoleType === 'SUPER_ADMIN'
    || assignment.systemRoleType === 'TENANT_ADMIN');
}

function toRoleAssignment(
  assignment: UserWithAuthorizationRows['roleAssignments'][number],
): FreshRoleAssignment {
  const permissions = assignment.role.permissions
    .map(({ permission }) => {
      const resource = permission.resource as Resource;
      const action = permission.action as Action;
      return `${resource}:${action}` as PermissionString;
    });

  return {
    companyId: assignment.companyId,
    roleId: assignment.role.id,
    roleTenantId: assignment.role.tenantId,
    systemRoleType: assignment.role.systemRoleType,
    permissions,
  };
}

function actorFromRows(
  user: UserWithAuthorizationRows,
  workspaceId: string,
): FreshActor {
  const workspaceAssignments = user.roleAssignments.filter((assignment) =>
    roleBelongsToWorkspace(assignment.role, workspaceId, user.tenantId)
  );
  const roleAssignments = workspaceAssignments.map(toRoleAssignment);
  const normalizedRoles = workspaceAssignments
    .map((assignment) => normalizeSystemRole(assignment.role.systemRoleType))
    .filter((role): role is 'ADMIN' | 'MANAGER' | 'STAFF' => role !== null);
  const internalRole = normalizedRoles.includes('ADMIN')
    ? 'ADMIN'
    : normalizedRoles.includes('MANAGER')
      ? 'MANAGER'
      : 'STAFF';
  const isSuperAdmin = workspaceAssignments.some((assignment) =>
    isGlobalRole(assignment.role, user.tenantId) && assignment.companyId === null
  );
  const isWorkspaceAdmin = hasWorkspaceAdminAssignment(
    workspaceAssignments.map(toRoleAssignment),
  );
  const allCompanyAssignments = workspaceAssignments.filter((assignment) => assignment.companyId === null);

  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    tenantId: user.tenantId,
    workspaceId,
    internalRole,
    isSuperAdmin,
    isWorkspaceAdmin,
    hasAllCompaniesAccess: allCompanyAssignments.length > 0,
    companyIds: [...new Set(
      workspaceAssignments
        .map((assignment) => assignment.companyId)
        .filter((companyId): companyId is string => companyId !== null)
    )],
    roleAssignments,
  };
}

async function findFreshUser(client: AuthorizationClient, userId: string): Promise<UserWithAuthorizationRows | null> {
  return client.user.findUnique({
    where: { id: userId },
    select: USER_AUTHORIZATION_SELECT,
  }) as Promise<UserWithAuthorizationRows | null>;
}

async function findFreshWorkspace(client: AuthorizationClient, workspaceId: string): Promise<WorkspaceRow | null> {
  return client.workspace.findUnique({
    where: { id: workspaceId },
    select: WORKSPACE_AUTHORIZATION_SELECT,
  }) as Promise<WorkspaceRow | null>;
}

interface FreshActorResolution {
  actor: FreshActor | null;
  reason: FreshAuthorizationDenialReason | null;
}

async function resolveFreshActorWithReason(
  input: { userId: string; workspaceId: string },
  db: AuthorizationClient,
): Promise<FreshActorResolution> {
  if (!hasText(input.userId) || !hasText(input.workspaceId)) {
    return { actor: null, reason: 'invalid_input' };
  }

  if (db !== prisma) {
    try {
      await lockFreshAuthorizationScope(asTransactionClient(db), input);
    } catch (error) {
      if (error instanceof FreshAuthorizationGateUnavailableError) {
        return { actor: null, reason: 'authorization_gate_unavailable' };
      }
      throw error;
    }
  }

  const [user, workspace] = await Promise.all([
    findFreshUser(db, input.userId),
    findFreshWorkspace(db, input.workspaceId),
  ]);

  if (!user) return { actor: null, reason: 'actor_not_found' };
  if (user.deletedAt) return { actor: null, reason: 'actor_deleted' };
  if (!user.isActive) return { actor: null, reason: 'actor_inactive' };
  if (!workspace) return { actor: null, reason: 'workspace_not_found' };
  if (workspace.deletedAt) return { actor: null, reason: 'workspace_deleted' };
  if (workspace.status !== ACTIVE_WORKSPACE_STATUS) return { actor: null, reason: 'workspace_inactive' };

  const isGlobalAdmin = user.roleAssignments.some((assignment) =>
    isGlobalRole(assignment.role, user.tenantId) && assignment.companyId === null
  );
  if (user.tenantId !== input.workspaceId && !isGlobalAdmin) {
    return { actor: null, reason: 'workspace_membership_denied' };
  }

  return { actor: actorFromRows(user, input.workspaceId), reason: null };
}

export async function resolveFreshActor(
  input: { userId: string; workspaceId: string },
  db?: AuthorizationClient,
): Promise<FreshActor | null>;
export async function resolveFreshActor(
  userId: string,
  workspaceId: string,
  db?: AuthorizationClient,
): Promise<FreshActor | null>;
export async function resolveFreshActor(
  inputOrUserId: { userId: string; workspaceId: string } | string,
  workspaceIdOrDb?: string | AuthorizationClient,
  maybeDb?: AuthorizationClient,
): Promise<FreshActor | null> {
  const input = typeof inputOrUserId === 'string'
    ? { userId: inputOrUserId, workspaceId: workspaceIdOrDb as string }
    : inputOrUserId;
  const db: AuthorizationClient = (typeof inputOrUserId === 'string'
    ? maybeDb
    : typeof workspaceIdOrDb === 'string'
      ? undefined
      : workspaceIdOrDb) || prisma;
  return (await resolveFreshActorWithReason(input, db)).actor;
}

export async function resolveFreshActorById(
  userId: string,
  workspaceId: string,
  db: AuthorizationClient = prisma,
): Promise<FreshActor | null> {
  return resolveFreshActor({ userId, workspaceId }, db);
}

function baseDecision(
  input: FreshAuthorizationInput,
  db: AuthorizationClient,
  actor: FreshActor | null,
  reason: FreshAuthorizationDenialReason | null,
  resource: FreshResource | null = null,
): FreshAuthorizationDecision {
  return {
    allowed: reason === null,
    actor,
    resource,
    reason,
    permission: permissionKey(input.permission.resource, input.permission.action),
    consistency: db === prisma ? 'read-committed-preflight' : 'transaction-scoped',
    requiresAuthorizationGate: true,
  };
}

async function findResource(
  client: AuthorizationClient,
  reference: FreshResourceReference,
  workspaceId: string,
): Promise<{ row: ResourceRow | null; resource: FreshResource | null; reason: FreshAuthorizationDenialReason | null }> {
  if (reference.kind === 'workspace') {
    const id = reference.id || workspaceId;
    const workspace = await findFreshWorkspace(client, id);
    if (!workspace) return { row: null, resource: null, reason: 'resource_not_found' };
    if (workspace.deletedAt) return { row: null, resource: null, reason: 'resource_deleted' };
    if (workspace.status !== ACTIVE_WORKSPACE_STATUS) return { row: null, resource: null, reason: 'workspace_inactive' };
    if (id !== workspaceId) return { row: null, resource: null, reason: 'resource_workspace_mismatch' };
    return {
      row: { id, tenantId: id },
      resource: { kind: 'workspace', id, workspaceId: id },
      reason: null,
    };
  }

  if (reference.kind === 'company') {
    const company = await client.company.findUnique({
      where: { id: reference.id },
      select: { id: true, tenantId: true, deletedAt: true },
    }) as ResourceRow | null;
    if (!company) return { row: null, resource: null, reason: 'resource_not_found' };
    if (company.deletedAt) return { row: null, resource: null, reason: 'resource_deleted' };
    if (company.tenantId !== workspaceId) return { row: null, resource: null, reason: 'resource_workspace_mismatch' };
    return {
      row: company,
      resource: { kind: reference.kind, id: company.id, workspaceId, companyId: company.id },
      reason: null,
    };
  }

  if (reference.kind === 'contact') {
    const contact = await client.contact.findUnique({
      where: { id: reference.id },
      select: {
        id: true,
        tenantId: true,
        deletedAt: true,
        companyRelations: { select: { companyId: true, deletedAt: true } },
      },
    }) as ResourceRow | null;
    if (!contact) return { row: null, resource: null, reason: 'resource_not_found' };
    if (contact.deletedAt) return { row: null, resource: null, reason: 'resource_deleted' };
    if (contact.tenantId !== workspaceId) return { row: null, resource: null, reason: 'resource_workspace_mismatch' };
    return {
      row: contact,
      resource: {
        kind: reference.kind,
        id: contact.id,
        workspaceId,
        companyId: contact.companyRelations?.find((relation) => relation.deletedAt === null)?.companyId,
      },
      reason: null,
    };
  }

  if (reference.kind === 'document') {
    const document = await client.document.findUnique({
      where: { id: reference.id },
      select: { id: true, tenantId: true, companyId: true, deletedAt: true },
    }) as ResourceRow | null;
    if (!document) return { row: null, resource: null, reason: 'resource_not_found' };
    if (document.deletedAt) return { row: null, resource: null, reason: 'resource_deleted' };
    if (document.tenantId !== workspaceId) return { row: null, resource: null, reason: 'resource_workspace_mismatch' };
    return {
      row: document,
      resource: { kind: reference.kind, id: document.id, workspaceId, companyId: document.companyId },
      reason: null,
    };
  }

  if (reference.kind === 'processingDocument') {
    const processingDocument = await client.processingDocument.findUnique({
      where: { id: reference.id },
      select: {
        id: true,
        tenantId: true,
        deletedAt: true,
        document: { select: { companyId: true } },
      },
    }) as (ResourceRow & { document?: { companyId: string | null } | null }) | null;
    if (!processingDocument) return { row: null, resource: null, reason: 'resource_not_found' };
    if (processingDocument.deletedAt) return { row: null, resource: null, reason: 'resource_deleted' };
    if (processingDocument.tenantId !== workspaceId) return { row: null, resource: null, reason: 'resource_workspace_mismatch' };
    return {
      row: processingDocument,
      resource: {
        kind: reference.kind,
        id: processingDocument.id,
        workspaceId,
        companyId: processingDocument.document?.companyId,
      },
      reason: null,
    };
  }

  if (reference.kind === 'generatedDocument') {
    const generatedDocument = await client.generatedDocument.findUnique({
      where: { id: reference.id },
      select: { id: true, tenantId: true, companyId: true, deletedAt: true },
    }) as ResourceRow | null;
    if (!generatedDocument) return { row: null, resource: null, reason: 'resource_not_found' };
    if (generatedDocument.deletedAt) return { row: null, resource: null, reason: 'resource_deleted' };
    if (generatedDocument.tenantId !== workspaceId) return { row: null, resource: null, reason: 'resource_workspace_mismatch' };
    return {
      row: generatedDocument,
      resource: { kind: reference.kind, id: generatedDocument.id, workspaceId, companyId: generatedDocument.companyId },
      reason: null,
    };
  }

  if (reference.kind === 'task') {
    const task = await client.task.findUnique({
      where: { id: reference.id },
      select: { id: true, tenantId: true, companyId: true, deletedAt: true },
    }) as ResourceRow | null;
    if (!task) return { row: null, resource: null, reason: 'resource_not_found' };
    if (task.deletedAt) return { row: null, resource: null, reason: 'resource_deleted' };
    if (task.tenantId !== workspaceId) return { row: null, resource: null, reason: 'resource_workspace_mismatch' };
    return {
      row: task,
      resource: { kind: reference.kind, id: task.id, workspaceId, companyId: task.companyId },
      reason: null,
    };
  }

  return { row: null, resource: null, reason: 'unsupported_resource' };
}

function hasCompanyAccess(
  actor: FreshActor,
  permission: FreshAuthorizationInput['permission'],
  companyId: string,
): boolean {
  const assignments = actor.roleAssignments;
  const companyAssignments = assignments.filter((assignment) =>
    assignment.companyId === null || assignment.companyId === companyId
  );
  const companySpecific = assignments.some((assignment) => assignment.companyId === companyId);
  const effective = companySpecific
    ? assignments.filter((assignment) => assignment.companyId === companyId)
    : assignments.filter((assignment) => assignment.companyId === null);

  if (hasWorkspaceAdminAssignment(companyAssignments, companyId)) return true;
  if (actor.isSuperAdmin && assignments.some((assignment) => assignment.companyId === null)) return true;
  if (actor.hasAllCompaniesAccess && allowsPermission(effective, permission, companyId)) return true;
  return actor.companyIds.includes(companyId) && allowsPermission(effective, permission, companyId);
}

export async function evaluateFreshAuthorization(
  input: FreshAuthorizationInput,
  db: AuthorizationClient = prisma,
): Promise<FreshAuthorizationDecision> {
  const emptyActor = null;
  if (!hasText(input.userId) || !hasText(input.workspaceId)) {
    return baseDecision(input, db, emptyActor, 'invalid_input');
  }

  const actorResolution = await resolveFreshActorWithReason(
    { userId: input.userId, workspaceId: input.workspaceId },
    db,
  );
  const actor = actorResolution.actor;
  if (!actor) {
    return baseDecision(input, db, emptyActor, actorResolution.reason || 'workspace_membership_denied');
  }

  if (!input.resource) {
    const allowed = hasWorkspaceAdminAssignment(actor.roleAssignments)
      || allowsPermission(actor.roleAssignments, input.permission);
    return baseDecision(input, db, actor, allowed ? null : 'permission_denied');
  }

  const resolved = await findResource(db, input.resource, input.workspaceId);
  if (resolved.reason || !resolved.resource) {
    return baseDecision(input, db, actor, resolved.reason || 'resource_not_found');
  }

  if (resolved.resource.kind === 'workspace') {
    const allowed = hasWorkspaceAdminAssignment(actor.roleAssignments)
      || allowsPermission(actor.roleAssignments, input.permission);
    return baseDecision(input, db, actor, allowed ? null : 'permission_denied', resolved.resource);
  }

  if (resolved.resource.kind === 'company') {
    const allowed = hasCompanyAccess(actor, input.permission, resolved.resource.id);
    return baseDecision(input, db, actor, allowed ? null : 'permission_denied', resolved.resource);
  }

  if (resolved.resource.kind === 'task' && !resolved.resource.companyId) {
    const allowed = actor.hasAllCompaniesAccess && allowsPermission(actor.roleAssignments, input.permission);
    return baseDecision(input, db, actor, allowed ? null : 'resource_company_denied', resolved.resource);
  }

  if (resolved.resource.companyId) {
    const allowed = hasCompanyAccess(actor, input.permission, resolved.resource.companyId);
    return baseDecision(input, db, actor, allowed ? null : 'resource_company_denied', resolved.resource);
  }

  // A newly uploaded BizFile source has no company scope yet. Workspace
  // administrators retain access to that document even when their role has no
  // explicit permission rows. Company-scoped assignments are excluded by
  // hasWorkspaceAdminAssignment when no company is present, so this does not
  // widen a company-specific administrator into workspace authority.
  const allowed = (resolved.resource.kind === 'document'
    && hasWorkspaceAdminAssignment(actor.roleAssignments))
    || allowsPermission(actor.roleAssignments, input.permission);
  return baseDecision(input, db, actor, allowed ? null : 'permission_denied', resolved.resource);
}

export async function hasFreshPermission(
  input: FreshAuthorizationInput,
  db: AuthorizationClient = prisma,
): Promise<boolean> {
  const decision = await evaluateFreshAuthorization(input, db);
  return decision.allowed;
}

/** Alias used by worker/policy callers that prefer a check-shaped name. */
export const checkFreshAuthorization = evaluateFreshAuthorization;

/** Alias used by callers that only need the boolean permission result. */
export const canFreshAccess = hasFreshPermission;
