/**
 * Admin hooks for user, workspace role, and audit log management
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSession } from './use-auth';

// ============================================================================
// Types
// ============================================================================

export interface UserRoleAssignment {
  id: string;
  roleId: string;
  companyId: string | null;
  role: {
    id: string;
    name: string;
    systemRoleType: string | null;
  };
  company: {
    id: string;
    name: string;
  } | null;
}

export interface UserCompanyAssignment {
  id: string;
  companyId: string;
  isPrimary: boolean;
  company: {
    id: string;
    name: string;
    uen: string;
  };
}

export interface WorkspaceUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  companyId: string | null;
  company?: {
    id: string;
    name: string;
  } | null;
  roleAssignments?: UserRoleAssignment[];
  companyAssignments?: UserCompanyAssignment[];
}

export interface WorkspaceUsersResponse {
  users: WorkspaceUser[];
  totalCount: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface AuditLog {
  id: string;
  tenantId: string | null;
  userId: string | null;
  companyId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  changeSource: string;
  changes: Record<string, { old: unknown; new: unknown }> | null;
  reason: string | null;
  summary: string | null;
  entityName: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
  createdAt: string;
  user?: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  } | null;
  company?: {
    id: string;
    name: string;
    uen: string;
  } | null;
}

export interface AuditLogsResponse {
  logs: AuditLog[];
  totalCount: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface AuditLogsParams {
  action?: string;
  actions?: string;
  entityType?: string;
  entityTypes?: string;
  userId?: string;
  companyId?: string;
  tenantId?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface Role {
  id: string;
  tenantId: string | null;
  name: string;
  description: string | null;
  isSystem: boolean;
  systemRoleType: string | null; // 'SUPER_ADMIN', 'TENANT_ADMIN', or null for custom roles
  createdAt: string;
  permissions: Array<{
    permission: {
      id: string;
      resource: string;
      action: string;
    };
  }>;
  _count: {
    users: number;
  };
}

export interface CreateUserData {
  email: string;
  firstName: string;
  lastName: string;
  companyId?: string;
  companyAssignments?: Array<{
    companyId: string;
    isPrimary?: boolean;
  }>;
  roleAssignments: Array<{
    roleId: string;
    companyId: string | null; // null = "All Companies"
  }>;
}

export interface UpdateUserData {
  firstName?: string;
  lastName?: string;
  email?: string;
  isActive?: boolean;
  companyId?: string | null;
  sendPasswordReset?: boolean;
}

// ============================================================================
// User Management Hooks
// ============================================================================

export function useWorkspaceUsers(
  workspaceId: string | undefined,
  params?: { query?: string; role?: string; company?: string; page?: number; limit?: number; sortBy?: string; sortOrder?: 'asc' | 'desc' }
) {
  return useQuery<WorkspaceUsersResponse>({
    queryKey: ['workspace-users', workspaceId, params],
    queryFn: async () => {
      if (!workspaceId) throw new Error('Workspace context required');

      const searchParams = new URLSearchParams();
      if (params?.query) searchParams.set('query', params.query);
      if (params?.role) searchParams.set('role', params.role);
      if (params?.company) searchParams.set('company', params.company);
      if (params?.page) searchParams.set('page', params.page.toString());
      if (params?.limit) searchParams.set('limit', params.limit.toString());
      if (params?.sortBy) searchParams.set('sortBy', params.sortBy);
      if (params?.sortOrder) searchParams.set('sortOrder', params.sortOrder);

      const res = await fetch(`/api/workspace/users?${searchParams}`);
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to fetch users');
      }
      return res.json();
    },
    enabled: !!workspaceId,
  });
}

export function useCurrentWorkspaceUsers(params?: { query?: string; role?: string; company?: string; page?: number; limit?: number; sortBy?: string; sortOrder?: 'asc' | 'desc' }) {
  const { data: session } = useSession();
  return useWorkspaceUsers(session?.tenantId || undefined, params);
}

export function useInviteUser(workspaceId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateUserData) => {
      if (!workspaceId) throw new Error('Workspace context required');

      const res = await fetch('/api/workspace/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to invite user');
      }

      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-users', workspaceId] });
    },
  });
}

export function useUpdateUser(workspaceId: string | undefined, userId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: UpdateUserData) => {
      if (!workspaceId || !userId) throw new Error('Workspace context and User ID required');

      const res = await fetch(`/api/workspace/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to update user');
      }

      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-users', workspaceId] });
      queryClient.invalidateQueries({ queryKey: ['workspace-user', workspaceId, userId] });
    },
  });
}

export function useDeleteUser(workspaceId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ userId, reason }: { userId: string; reason?: string }) => {
      if (!workspaceId) throw new Error('Workspace context required');

      const res = await fetch(`/api/workspace/users/${userId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to remove user');
      }

      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-users', workspaceId] });
    },
  });
}

export function useSendPasswordReset(workspaceId: string | undefined, userId: string | undefined) {
  return useMutation({
    mutationFn: async () => {
      if (!workspaceId || !userId) throw new Error('Workspace context and User ID required');

      const res = await fetch(`/api/workspace/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sendPasswordReset: true }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to send password reset');
      }

      return res.json();
    },
  });
}

// ============================================================================
// Audit Log Hooks
// ============================================================================

export function useAuditLogs(params?: AuditLogsParams) {
  return useQuery<AuditLogsResponse>({
    queryKey: ['audit-logs', params],
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      if (params?.action) searchParams.set('action', params.action);
      if (params?.actions) searchParams.set('actions', params.actions);
      if (params?.entityType) searchParams.set('entityType', params.entityType);
      if (params?.entityTypes) searchParams.set('entityTypes', params.entityTypes);
      if (params?.userId) searchParams.set('userId', params.userId);
      if (params?.companyId) searchParams.set('companyId', params.companyId);
      if (params?.tenantId) searchParams.set('tenantId', params.tenantId);
      if (params?.startDate) searchParams.set('startDate', params.startDate);
      if (params?.endDate) searchParams.set('endDate', params.endDate);
      if (params?.page) searchParams.set('page', params.page.toString());
      if (params?.limit) searchParams.set('limit', params.limit.toString());
      if (params?.sortBy) searchParams.set('sortBy', params.sortBy);
      if (params?.sortOrder) searchParams.set('sortOrder', params.sortOrder);

      const res = await fetch(`/api/audit-logs?${searchParams}`);
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to fetch audit logs');
      }
      return res.json();
    },
  });
}

export function useAuditLogStats(params?: { startDate?: string; endDate?: string; tenantId?: string }) {
  return useQuery({
    queryKey: ['audit-log-stats', params],
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      if (params?.startDate) searchParams.set('startDate', params.startDate);
      if (params?.endDate) searchParams.set('endDate', params.endDate);
      if (params?.tenantId) searchParams.set('tenantId', params.tenantId);

      const res = await fetch(`/api/audit-logs/stats?${searchParams}`);
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to fetch audit stats');
      }
      return res.json();
    },
  });
}

// ============================================================================
// Role Management Hooks
// ============================================================================

export function useWorkspaceRoles(workspaceId: string | undefined) {
  return useQuery<Role[]>({
    queryKey: ['workspace-roles', workspaceId],
    queryFn: async () => {
      if (!workspaceId) throw new Error('Workspace context required');
      const res = await fetch('/api/workspace/roles');
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to fetch roles');
      }
      return res.json();
    },
    enabled: !!workspaceId,
  });
}

export function useCurrentWorkspaceRoles() {
  const { data: session } = useSession();
  return useWorkspaceRoles(session?.tenantId || undefined);
}

export interface Permission {
  id: string;
  resource: string;
  action: string;
  description: string | null;
}

export interface PermissionsResponse {
  resources: string[];
  actions: string[];
  grouped: Record<string, Array<{ id: string; action: string; description: string | null }>>;
  permissions: Permission[];
}

export function usePermissions() {
  return useQuery<PermissionsResponse>({
    queryKey: ['permissions'],
    queryFn: async () => {
      const res = await fetch('/api/permissions');
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to fetch permissions');
      }
      return res.json();
    },
  });
}

export interface CreateRoleData {
  name: string;
  description?: string;
  permissions?: string[];
}

export interface UpdateRoleData {
  name?: string;
  description?: string;
  permissions?: string[];
}

export function useCreateRole(workspaceId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateRoleData) => {
      if (!workspaceId) throw new Error('Workspace context required');
      const res = await fetch('/api/workspace/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to create role');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-roles', workspaceId] });
    },
  });
}

export function useUpdateRole(workspaceId: string | undefined, roleId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: UpdateRoleData) => {
      if (!workspaceId || !roleId) throw new Error('Workspace context and Role ID required');
      const res = await fetch(`/api/workspace/roles/${roleId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to update role');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-roles', workspaceId] });
    },
  });
}

export function useDeleteRole(workspaceId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (roleId: string) => {
      if (!workspaceId) throw new Error('Workspace context required');
      const res = await fetch(`/api/workspace/roles/${roleId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to delete role');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-roles', workspaceId] });
    },
  });
}

export function useDuplicateRole(workspaceId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ roleId, name }: { roleId: string; name: string }) => {
      if (!workspaceId) throw new Error('Workspace context required');
      const res = await fetch(`/api/workspace/roles/${roleId}/duplicate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to duplicate role');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-roles', workspaceId] });
    },
  });
}

export interface RoleUser {
  id: string;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    isActive: boolean;
  };
  company: {
    id: string;
    name: string;
    uen: string;
  } | null;
}

export function useRoleUsers(workspaceId: string | undefined, roleId: string | undefined) {
  return useQuery<{ users: RoleUser[] }>({
    queryKey: ['role-users', workspaceId, roleId],
    queryFn: async () => {
      if (!workspaceId || !roleId) throw new Error('Workspace context and Role ID required');
      const res = await fetch(`/api/workspace/roles/${roleId}/users`);
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to fetch role users');
      }
      return res.json();
    },
    enabled: !!workspaceId && !!roleId,
  });
}

export function useAssignRoleToUser(workspaceId: string | undefined, roleId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { userId: string; companyId?: string }) => {
      if (!workspaceId || !roleId) throw new Error('Workspace context and Role ID required');
      const res = await fetch(`/api/workspace/roles/${roleId}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to assign role to user');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['role-users', workspaceId, roleId] });
      queryClient.invalidateQueries({ queryKey: ['workspace-roles', workspaceId] });
    },
  });
}

export function useRemoveRoleFromUser(workspaceId: string | undefined, roleId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { userId: string; companyId?: string }) => {
      if (!workspaceId || !roleId) throw new Error('Workspace context and Role ID required');
      const res = await fetch(`/api/workspace/roles/${roleId}/users`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to remove role from user');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['role-users', workspaceId, roleId] });
      queryClient.invalidateQueries({ queryKey: ['workspace-roles', workspaceId] });
    },
  });
}

// Hook to remove a role assignment from user (works from user management context)
export function useRemoveUserRoleAssignment(workspaceId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { userId: string; roleId: string; companyId: string | null }) => {
      if (!workspaceId) throw new Error('Workspace context required');
      const res = await fetch(`/api/workspace/roles/${data.roleId}/users`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: data.userId, companyId: data.companyId }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to remove role assignment');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-users', workspaceId] });
      queryClient.invalidateQueries({ queryKey: ['workspace-roles', workspaceId] });
    },
  });
}

// ============================================================================
// User Company Assignment Hooks
// ============================================================================

export interface UserCompanyAssignment {
  id: string;
  userId: string;
  companyId: string;
  isPrimary: boolean;
  createdAt: string;
  company: {
    id: string;
    name: string;
    uen: string;
  };
}

export function useUserCompanyAssignments(userId: string | undefined) {
  return useQuery<{ assignments: UserCompanyAssignment[] }>({
    queryKey: ['user-company-assignments', userId],
    queryFn: async () => {
      if (!userId) throw new Error('User ID required');
      const res = await fetch(`/api/users/${userId}/companies`);
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to fetch company assignments');
      }
      return res.json();
    },
    enabled: !!userId,
  });
}

export function useAssignUserToCompany(userId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      companyId: string | null; // null = "All Companies"
      roleId?: string; // Role to assign for this company
      isPrimary?: boolean;
      workspaceId?: string; // Required for SUPER_ADMIN
    }) => {
      if (!userId) throw new Error('User ID required');
      const { workspaceId, ...requestData } = data;
      const res = await fetch(`/api/users/${userId}/companies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...requestData,
          tenantId: workspaceId,
        }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to assign company');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-company-assignments', userId] });
      queryClient.invalidateQueries({ queryKey: ['workspace-users'] });
    },
  });
}

export function useUpdateCompanyAssignment(userId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      assignmentId: string;
      isPrimary?: boolean;
    }) => {
      if (!userId) throw new Error('User ID required');
      const res = await fetch(`/api/users/${userId}/companies`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to update assignment');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-company-assignments', userId] });
    },
  });
}

export function useRemoveCompanyAssignment(userId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (assignmentId: string) => {
      if (!userId) throw new Error('User ID required');
      const res = await fetch(`/api/users/${userId}/companies`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignmentId }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to remove assignment');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-company-assignments', userId] });
      queryClient.invalidateQueries({ queryKey: ['workspace-users'] });
    },
  });
}

// ============================================================================
// Data Purge Hooks (Permanent Deletion)
// ============================================================================

export type PurgeableEntity =
  | 'user'
  | 'company'
  | 'contact'
  | 'generatedDocument'
  | 'processingDocument'
  | 'documentTemplate'
  | 'templatePartial';

export interface PurgeStats {
  users: number;
  companies: number;
  contacts: number;
  generatedDocuments: number;
  processingDocuments: number;
  documentTemplates: number;
  templatePartials: number;
}

export interface PurgeableUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  deletedAt: string;
  tenant: { name: string } | null;
}

export interface PurgeableCompany {
  id: string;
  name: string;
  uen: string;
  deletedAt: string;
  deletedReason: string | null;
  tenant: { name: string } | null;
  _count: {
    documents: number;
    officers: number;
    shareholders: number;
  };
}

export interface PurgeableContact {
  id: string;
  fullName: string;
  email: string | null;
  deletedAt: string;
  tenant: { name: string } | null;
}

export interface PurgeableGeneratedDocument {
  id: string;
  title: string;
  status: string;
  deletedAt: string;
  tenant: { name: string } | null;
  template: { name: string } | null;
  company: { name: string } | null;
  createdBy: { firstName: string; lastName: string };
}

export interface PurgeableProcessingDocument {
  id: string;
  deletedAt: string;
  deletedReason: string | null;
  pipelineStatus: string;
  createdAt: string;
  document: {
    fileName: string;
    tenant: { name: string } | null;
    company: { name: string } | null;
  } | null;
  currentRevision: {
    vendorName: string | null;
    documentNumber: string | null;
    documentCategory: string | null;
  } | null;
}

export interface PurgeableDocumentTemplate {
  id: string;
  name: string;
  deletedAt: string;
  documentEngine: 'A4' | 'OAKDOC';
  tenant: { name: string } | null;
  _count: { generatedDocuments: number };
}

export interface PurgeableTemplatePartial {
  id: string;
  name: string;
  displayName: string | null;
  deletedAt: string;
  documentEngine: 'A4' | 'OAKDOC';
  tenant: { name: string } | null;
}

export interface PurgeDataResponse {
  stats: PurgeStats;
  records: {
    users: PurgeableUser[];
    companies: PurgeableCompany[];
    contacts: PurgeableContact[];
    generatedDocuments: PurgeableGeneratedDocument[];
    processingDocuments: PurgeableProcessingDocument[];
    documentTemplates: PurgeableDocumentTemplate[];
    templatePartials: PurgeableTemplatePartial[];
  };
}

export function usePurgeData() {
  return useQuery<PurgeDataResponse>({
    queryKey: ['purge-data'],
    queryFn: async () => {
      const res = await fetch('/api/admin/purge');
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to fetch purge data');
      }
      return res.json();
    },
  });
}

export function usePurgeRecords() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      entityType: PurgeableEntity;
      entityIds: string[];
      reason: string;
    }) => {
      const res = await fetch('/api/admin/purge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        // A purge where every record was refused carries the reasons in failedRecords.
        throw new Error(error.error || error.failedRecords?.[0]?.error || error.message || 'Failed to purge records');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purge-data'] });
      queryClient.invalidateQueries({ queryKey: ['workspace-users'] });
      queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
      queryClient.invalidateQueries({ queryKey: ['generated-documents'] });
    },
  });
}

export function useRestoreRecords() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      entityType: PurgeableEntity;
      entityIds: string[];
    }) => {
      const res = await fetch('/api/admin/purge', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to restore records');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purge-data'] });
      queryClient.invalidateQueries({ queryKey: ['workspace-users'] });
      queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
      queryClient.invalidateQueries({ queryKey: ['generated-documents'] });
    },
  });
}
