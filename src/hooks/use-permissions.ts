'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

interface PermissionsResponse {
  permissions: string[];
  isSuperAdmin: boolean;
  isWorkspaceAdmin: boolean;
}

interface SessionWithPermissionsCache extends PermissionsResponse {
  user: unknown;
}

async function fetchSessionPermissions(): Promise<SessionWithPermissionsCache | null> {
  const response = await fetch('/api/auth/session');
  if (!response.ok) {
    if (response.status === 401) {
      return null;
    }
    throw new Error('Failed to fetch permissions');
  }
  return response.json();
}

async function fetchPermissions(companyId: string): Promise<PermissionsResponse> {
  const response = await fetch(`/api/auth/session?companyId=${companyId}`);
  if (!response.ok) {
    if (response.status === 401) {
      return { permissions: [], isSuperAdmin: false, isWorkspaceAdmin: false };
    }
    throw new Error('Failed to fetch permissions');
  }
  return response.json();
}

function toPermissionsResponse(
  data: PermissionsResponse | SessionWithPermissionsCache | null | undefined
): PermissionsResponse {
  return {
    permissions: data?.permissions ?? [],
    isSuperAdmin: data?.isSuperAdmin ?? false,
    isWorkspaceAdmin: data?.isWorkspaceAdmin ?? false,
  };
}

/**
 * Hook to get current user's permissions
 *
 * @param companyId - Optional company ID to check permissions for a specific company
 * @returns Object with permissions array and helper functions
 */
export function usePermissions(companyId?: string) {
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: companyId ? ['permissions', companyId] : ['session-with-permissions'],
    queryFn: () => companyId ? fetchPermissions(companyId) : fetchSessionPermissions(),
    initialData: () => {
      if (companyId) return undefined;

      const session = queryClient.getQueryData<SessionWithPermissionsCache | null>(
        ['session-with-permissions']
      );

      return session ?? undefined;
    },
    select: toPermissionsResponse,
    staleTime: 15 * 60 * 1000, // 15 minutes - permissions rarely change
    gcTime: 30 * 60 * 1000, // 30 minutes
    retry: false,
  });

  const permissions = data?.permissions || [];
  const isSuperAdmin = data?.isSuperAdmin || false;
  const isWorkspaceAdmin = data?.isWorkspaceAdmin || false;

  /**
   * Check if user has a specific permission
   * Format: "resource:action" (e.g., "company:create", "document:delete")
   */
  const hasPermission = (resource: string, action: string): boolean => {
    if (isSuperAdmin || isWorkspaceAdmin) return true;
    return permissions.includes(`${resource}:${action}`) || permissions.includes(`${resource}:manage`);
  };

  /**
   * Check if user has any of the specified permissions
   */
  const hasAnyPermission = (checks: Array<{ resource: string; action: string }>): boolean => {
    if (isSuperAdmin || isWorkspaceAdmin) return true;
    return checks.some(({ resource, action }) => hasPermission(resource, action));
  };

  /**
   * Check if user has all of the specified permissions
   */
  const hasAllPermissions = (checks: Array<{ resource: string; action: string }>): boolean => {
    if (isSuperAdmin || isWorkspaceAdmin) return true;
    return checks.every(({ resource, action }) => hasPermission(resource, action));
  };

  // Convenience permission checks for common operations
  const can = {
    // Company permissions
    createCompany: hasPermission('company', 'create'),
    readCompany: hasPermission('company', 'read'),
    updateCompany: hasPermission('company', 'update'),
    deleteCompany: hasPermission('company', 'delete'),
    exportCompany: hasPermission('company', 'export'),
    importCompany: hasPermission('company', 'import'),

    // Document permissions
    createDocument: hasPermission('document', 'create'),
    readDocument: hasPermission('document', 'read'),
    updateDocument: hasPermission('document', 'update'),
    deleteDocument: hasPermission('document', 'delete'),
    exportDocument: hasPermission('document', 'export'),

    // E-signing permissions
    createEsigning: hasPermission('esigning', 'create'),
    readEsigning: hasPermission('esigning', 'read'),
    updateEsigning: hasPermission('esigning', 'update'),
    deleteEsigning: hasPermission('esigning', 'delete'),
    manageEsigning: hasPermission('esigning', 'manage'),

    // Contact permissions
    createContact: hasPermission('contact', 'create'),
    readContact: hasPermission('contact', 'read'),
    updateContact: hasPermission('contact', 'update'),
    deleteContact: hasPermission('contact', 'delete'),

    // Officer permissions
    createOfficer: hasPermission('officer', 'create'),
    readOfficer: hasPermission('officer', 'read'),
    updateOfficer: hasPermission('officer', 'update'),
    deleteOfficer: hasPermission('officer', 'delete'),

    // Shareholder permissions
    createShareholder: hasPermission('shareholder', 'create'),
    readShareholder: hasPermission('shareholder', 'read'),
    updateShareholder: hasPermission('shareholder', 'update'),
    deleteShareholder: hasPermission('shareholder', 'delete'),

    // User permissions
    createUser: hasPermission('user', 'create'),
    readUser: hasPermission('user', 'read'),
    updateUser: hasPermission('user', 'update'),
    deleteUser: hasPermission('user', 'delete'),

    // Role permissions
    createRole: hasPermission('role', 'create'),
    readRole: hasPermission('role', 'read'),
    updateRole: hasPermission('role', 'update'),
    deleteRole: hasPermission('role', 'delete'),

    // Tenant permissions
    readTenant: hasPermission('tenant', 'read'),
    updateWorkspace: hasPermission('tenant', 'update'),

    // Audit log permissions
    readAuditLog: hasPermission('audit_log', 'read'),
    exportAuditLog: hasPermission('audit_log', 'export'),
  };

  return {
    permissions,
    isSuperAdmin,
    isWorkspaceAdmin,
    isLoading,
    error,
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
    can,
  };
}

/**
 * Hook to get permissions for multiple companies at once
 * Returns a map of companyId -> permissions check functions
 *
 * @param companyIds - Array of company IDs to check permissions for
 * @returns Object with permission check functions per company
 */
export function useCompanyPermissions(companyIds: string[]) {
  const { permissions, isSuperAdmin, isWorkspaceAdmin, isLoading } = usePermissions();

  const canEdit = isSuperAdmin || isWorkspaceAdmin ||
    permissions.includes('company:update') ||
    permissions.includes('company:manage');
  const canDelete = isSuperAdmin || isWorkspaceAdmin ||
    permissions.includes('company:delete') ||
    permissions.includes('company:manage');
  const canRead = isSuperAdmin || isWorkspaceAdmin ||
    permissions.includes('company:read') ||
    permissions.includes('company:manage');
  const canExport = isSuperAdmin || isWorkspaceAdmin ||
    permissions.includes('company:export') ||
    permissions.includes('company:manage');

  const permissionsByCompany = useMemo(() => {
    const map: Record<string, {
      canEdit: boolean;
      canDelete: boolean;
      canRead: boolean;
      canExport: boolean;
    }> = {};

    companyIds.forEach((companyId) => {
      map[companyId] = {
        canEdit,
        canDelete,
        canRead,
        canExport,
      };
    });

    return map;
  }, [canDelete, canEdit, canExport, canRead, companyIds]);

  /**
   * Check if user can perform an action on a specific company
   */
  const canEditCompany = (companyId: string): boolean => {
    return permissionsByCompany[companyId]?.canEdit ?? false;
  };

  const canDeleteCompany = (companyId: string): boolean => {
    return permissionsByCompany[companyId]?.canDelete ?? false;
  };

  return {
    isLoading,
    isSuperAdmin,
    isWorkspaceAdmin,
    permissionsByCompany,
    canEditCompany,
    canDeleteCompany,
  };
}
