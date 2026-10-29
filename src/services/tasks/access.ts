import type { SessionUser } from '@/lib/auth';
import { canAccessCompany } from '@/lib/auth';
import { ForbiddenError, NotFoundError } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { requirePermission, type Action } from '@/lib/rbac';
import {
  canReadEnvelope,
  resolveEsigningActorScope,
} from '@/services/esigning-envelope.lib';
import type { TaskStageOutcomeInput } from '@/lib/validations/task';

function hasTenantWideTaskAccess(session: SessionUser) {
  return (
    session.isSuperAdmin
    || session.isWorkspaceAdmin
    || session.hasAllCompaniesAccess
  );
}

export async function requireTaskCollectionAccess(
  session: SessionUser,
  action: Action,
) {
  await requirePermission(session, 'company', action);
  return hasTenantWideTaskAccess(session) ? undefined : session.companyIds;
}

export async function requireTenantWideTaskAccess(
  session: SessionUser,
  action: Action,
) {
  await requirePermission(session, 'company', action);
  if (!hasTenantWideTaskAccess(session)) {
    throw new ForbiddenError('Tenant-wide task pipeline access is required');
  }
}

export async function requireTaskCompanyAccess(
  session: SessionUser,
  companyId: string | null | undefined,
  action: Action,
) {
  if (!companyId) {
    await requireTenantWideTaskAccess(session, action);
    return;
  }
  await requirePermission(session, 'company', action, companyId);
  if (!(await canAccessCompany(session, companyId))) {
    throw new ForbiddenError('Company access denied');
  }
}

export async function requireTaskAccess(
  session: SessionUser,
  tenantId: string,
  taskId: string,
  action: Action,
) {
  const task = await prisma.task.findFirst({
    where: { id: taskId, tenantId, deletedAt: null },
    select: { companyId: true },
  });
  if (!task) throw new NotFoundError('Task not found');
  await requireTaskCompanyAccess(session, task.companyId, action);
  return task;
}

export async function requireTaskOutcomeAccess(
  session: SessionUser,
  tenantId: string,
  outcome: TaskStageOutcomeInput,
) {
  if (outcome.type === 'COMPANY' && outcome.companyId) {
    await requireTaskCompanyAccess(session, outcome.companyId, 'update');
    return;
  }
  if (outcome.type === 'GENERATED_DOCUMENT' && outcome.generatedDocumentId) {
    const document = await prisma.generatedDocument.findFirst({
      where: {
        id: outcome.generatedDocumentId,
        tenantId,
        deletedAt: null,
      },
      select: { companyId: true },
    });
    if (!document) throw new NotFoundError('Generated document not found');
    await requirePermission(
      session,
      'document',
      'read',
      document.companyId ?? undefined,
    );
    if (document.companyId && !(await canAccessCompany(session, document.companyId))) {
      throw new ForbiddenError('Document company access denied');
    }
    return;
  }
  if (outcome.type === 'ESIGNING_ENVELOPE' && outcome.esigningEnvelopeId) {
    const envelope = await prisma.esigningEnvelope.findFirst({
      where: {
        id: outcome.esigningEnvelopeId,
        tenantId,
        deletedAt: null,
      },
      select: { createdById: true, companyId: true },
    });
    if (!envelope) throw new NotFoundError('E-signing envelope not found');
    const scope = await resolveEsigningActorScope(session, tenantId);
    if (!canReadEnvelope(scope, session, envelope.createdById)) {
      throw new ForbiddenError('E-signing envelope access denied');
    }
    if (envelope.companyId && !(await canAccessCompany(session, envelope.companyId))) {
      throw new ForbiddenError('E-signing company access denied');
    }
    return;
  }
  throw new NotFoundError('Linked task outcome not found');
}
