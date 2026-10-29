import { getSession } from '@/lib/auth';
import { getUserPermissions } from '@/lib/rbac';

export interface AuthSessionPayload {
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    tenantId: string | null;
    workspaceId?: string | null;
    internalRole: 'ADMIN' | 'MANAGER' | 'STAFF';
    isAdmin: boolean;
    isManager: boolean;
    isStaff: boolean;
    isSuperAdmin: boolean;
    isWorkspaceAdmin: boolean;
    companyIds: string[];
  };
  permissions: string[];
  internalRole: 'ADMIN' | 'MANAGER' | 'STAFF';
  isAdmin: boolean;
  isManager: boolean;
  isStaff: boolean;
  isSuperAdmin: boolean;
  isWorkspaceAdmin: boolean;
}

export async function getAuthSessionPayload(
  companyId?: string
): Promise<AuthSessionPayload | null> {
  const session = await getSession();

  if (!session) {
    return null;
  }

  const permissions = await getUserPermissions(session.id, companyId);
  const internalRole = session.internalRole ?? (session.isSuperAdmin || session.isWorkspaceAdmin ? 'ADMIN' : 'STAFF');
  const isAdmin = session.isAdmin ?? (session.isSuperAdmin || session.isWorkspaceAdmin);
  const isManager = session.isManager ?? internalRole === 'MANAGER';
  const isStaff = session.isStaff ?? internalRole === 'STAFF';

  return {
    user: {
      id: session.id,
      email: session.email,
      firstName: session.firstName,
      lastName: session.lastName,
      tenantId: session.tenantId,
      workspaceId: session.workspaceId,
      internalRole,
      isAdmin,
      isManager,
      isStaff,
      isSuperAdmin: session.isSuperAdmin,
      isWorkspaceAdmin: session.isWorkspaceAdmin,
      companyIds: session.companyIds,
    },
    permissions,
    internalRole,
    isAdmin,
    isManager,
    isStaff,
    isSuperAdmin: session.isSuperAdmin,
    isWorkspaceAdmin: session.isWorkspaceAdmin,
  };
}
