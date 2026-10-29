import { prisma } from '@/lib/prisma';
import { resolveFreshActor } from '@/lib/fresh-authorization';
import type { BusinessAssistantCapability, CapabilityDescriptor, ResourceRef, SafeAssistantError } from './contracts';

export interface AssistantPolicyDecision {
  allowed: boolean;
  reason?: SafeAssistantError;
  isAdmin: boolean;
  permissionKeys: ReadonlySet<string>;
}

function denied(code: SafeAssistantError['code'], message: string, details?: unknown): AssistantPolicyDecision {
  return {
    allowed: false,
    isAdmin: false,
    permissionKeys: new Set(),
    reason: { code, message, details: details as never },
  };
}

/**
 * Fresh authorization lookup for queued assistant work. This deliberately
 * bypasses session/permission caches and can be used by a worker as well as an
 * HTTP route. Resource-specific checks remain module-owned resolvers.
 */
export async function evaluateAssistantActor(userId: string, tenantId: string): Promise<AssistantPolicyDecision> {
  const actor = await resolveFreshActor({ userId, workspaceId: tenantId });
  if (!actor) return denied('FORBIDDEN', 'The current user or workspace is unavailable.');
  const roleAssignments = actor.roleAssignments;
  const isAdmin = actor.isWorkspaceAdmin || actor.isSuperAdmin || actor.internalRole === 'ADMIN';
  const permissionKeys = new Set<string>();
  for (const assignment of roleAssignments) for (const permission of assignment.permissions) permissionKeys.add(permission);
  return { allowed: true, isAdmin, permissionKeys };
}

export async function assertAssistantActor(userId: string, tenantId: string): Promise<AssistantPolicyDecision> {
  const decision = await evaluateAssistantActor(userId, tenantId);
  if (!decision.allowed) throw new AssistantPolicyError(decision.reason ?? { code: 'FORBIDDEN', message: 'Assistant access denied.' });
  return decision;
}

export class AssistantPolicyError extends Error {
  readonly safeError: SafeAssistantError;

  constructor(safeError: SafeAssistantError) {
    super(safeError.message);
    this.name = 'AssistantPolicyError';
    this.safeError = safeError;
  }
}

export async function assertAssistantReadAccess(userId: string, tenantId: string): Promise<AssistantPolicyDecision> {
  return assertAssistantActor(userId, tenantId);
}

/**
 * Check the workspace pause barrier for every durable assistant operation.
 * Restore failures are represented on a completed backup row so operators can
 * retry the file/completion phase; that state must pause new dispatch too.
 */
export async function assertAssistantWorkspaceOperational(userId: string, tenantId: string): Promise<AssistantPolicyDecision> {
  const decision = await assertAssistantActor(userId, tenantId);
  const backups = await prisma.workspaceBackup.findMany({
    where: { tenantId, status: { in: ['RESTORING', 'COMPLETED'] } },
    select: { status: true, errorDetails: true },
  });
  const paused = backups.some((backup) => {
    if (backup.status === 'RESTORING') return true;
    const details = backup.errorDetails;
    return Boolean(details && typeof details === 'object' && !Array.isArray(details) && (details as Record<string, unknown>).businessAssistantDispatchPaused === true);
  });
  if (paused) throw new AssistantPolicyError({ code: 'WORKSPACE_PAUSED', message: 'The workspace is restoring and cannot accept new assistant work.' });
  return decision;
}

/** Preferences, feedback, and governance changes do not dispatch a provider
 * and therefore must remain usable while the release gate is disabled. */
export async function assertAssistantAdministrativeAccess(userId: string, tenantId: string): Promise<AssistantPolicyDecision> {
  return assertAssistantWorkspaceOperational(userId, tenantId);
}

export async function assertAssistantMutationAccess(userId: string, tenantId: string): Promise<AssistantPolicyDecision> {
  const decision = await assertAssistantWorkspaceOperational(userId, tenantId);
  if (process.env.BUSINESS_ASSISTANT_MUTATIONS_ENABLED !== 'true') {
    throw new AssistantPolicyError({ code: 'FORBIDDEN', message: 'Assistant mutations are disabled until the release gates pass.' });
  }
  if (process.env.BUSINESS_ASSISTANT_PROVIDER_ENABLED !== 'true') {
    throw new AssistantPolicyError({ code: 'FORBIDDEN', message: 'Assistant provider dispatch is disabled until workspace policy is configured.' });
  }
  return decision;
}

export function hasCapabilityPermissions(decision: AssistantPolicyDecision, capability: BusinessAssistantCapability): boolean {
  if (decision.isAdmin || capability.requiredPermissions.length === 0) return true;
  return capability.requiredPermissions.every((required) => {
    const [resource, action] = required.split(':', 2);
    return decision.permissionKeys.has(required) || decision.permissionKeys.has(`${resource}:manage`) || decision.permissionKeys.has(`${resource}:${action}`);
  });
}

export function filterCapabilityDescriptors(decision: AssistantPolicyDecision, capabilities: readonly BusinessAssistantCapability[]): readonly CapabilityDescriptor[] {
  return capabilities.filter((capability) => hasCapabilityPermissions(decision, capability)).map((capability) => ({
    id: capability.id,
    version: capability.version,
    title: capability.title,
    description: capability.description,
    executionKind: capability.executionKind,
    riskLevel: capability.riskLevel,
    confirmationPolicy: capability.confirmationPolicy,
    reviewPolicy: capability.reviewPolicy,
    requiredPermissions: [...capability.requiredPermissions],
  }));
}

/** Resource reference shape check. Resolution is performed by a module-owned reader. */
export function normalizeResourceRefs(resources: readonly ResourceRef[]): ResourceRef[] {
  const seen = new Set<string>();
  const normalized: ResourceRef[] = [];
  for (const resource of resources) {
    const type = resource.resourceType.trim();
    const id = resource.resourceId.trim();
    if (!type || !id) throw new AssistantPolicyError({ code: 'VALIDATION_FAILED', message: 'Resource references must include a type and ID.' });
    const key = `${type}\u0000${id}\u0000${resource.role}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({ resourceType: type, resourceId: id, role: resource.role });
  }
  return normalized;
}
