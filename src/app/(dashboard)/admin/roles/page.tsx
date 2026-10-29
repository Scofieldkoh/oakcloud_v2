'use client';

import { useState, useEffect } from 'react';
import { useSession } from '@/hooks/use-auth';
import {
  useWorkspaceRoles,
  usePermissions,
  useCreateRole,
  useUpdateRole,
  useDeleteRole,
  useDuplicateRole,
  type Role,
} from '@/hooks/use-admin';
import { Button } from '@/components/ui/button';
import { FormInput } from '@/components/ui/form-input';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Alert } from '@/components/ui/alert';
import { Dropdown, DropdownTrigger, DropdownMenu, DropdownItem } from '@/components/ui/dropdown';
import { useToast } from '@/components/ui/toast';
import { useActiveWorkspaceId } from '@/components/ui/workspace-selector';
import {
  Shield,
  Users,
  Check,
  ChevronDown,
  ChevronUp,
  Lock,
  Plus,
  MoreVertical,
  Pencil,
  Trash2,
  Copy,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ============================================================================
// Constants
// ============================================================================

const RESOURCE_LABELS: Record<string, string> = {
  tenant: 'Workspace Settings',
  user: 'User Management',
  role: 'Role Management',
  company: 'Companies',
  contact: 'Contacts',
  document: 'Documents',
  officer: 'Officers',
  shareholder: 'Shareholders',
  audit_log: 'Audit Logs',
};

const ACTION_LABELS: Record<string, string> = {
  create: 'Create',
  read: 'Read',
  update: 'Update',
  delete: 'Delete',
  export: 'Export',
  import: 'Import',
  manage: 'Manage',
};

// ============================================================================
// Helper Functions
// ============================================================================

function groupPermissionsByResource(permissions: Array<{ permission: { resource: string; action: string } }>) {
  const grouped: Record<string, string[]> = {};

  for (const { permission } of permissions) {
    if (!grouped[permission.resource]) {
      grouped[permission.resource] = [];
    }
    grouped[permission.resource].push(permission.action);
  }

  return grouped;
}

// ============================================================================
// Permission Selector Component
// ============================================================================

interface PermissionSelectorProps {
  selectedPermissionIds: string[];
  onChange: (permissionIds: string[]) => void;
  groupedPermissions: Record<string, Array<{ id: string; action: string; description: string | null }>>;
}

function PermissionSelector({ selectedPermissionIds, onChange, groupedPermissions }: PermissionSelectorProps) {
  const togglePermission = (permissionId: string) => {
    if (selectedPermissionIds.includes(permissionId)) {
      onChange(selectedPermissionIds.filter((id) => id !== permissionId));
    } else {
      onChange([...selectedPermissionIds, permissionId]);
    }
  };

  const toggleResource = (resource: string) => {
    const resourcePermissions = groupedPermissions[resource] || [];
    const resourcePermissionIds = resourcePermissions.map((p) => p.id);
    const allSelected = resourcePermissionIds.every((id) => selectedPermissionIds.includes(id));

    if (allSelected) {
      // Deselect all permissions for this resource
      onChange(selectedPermissionIds.filter((id) => !resourcePermissionIds.includes(id)));
    } else {
      // Select all permissions for this resource
      const newSelection = new Set([...selectedPermissionIds, ...resourcePermissionIds]);
      onChange(Array.from(newSelection));
    }
  };

  const selectAll = () => {
    const allPermissionIds = Object.values(groupedPermissions)
      .flat()
      .map((p) => p.id);
    onChange(allPermissionIds);
  };

  const deselectAll = () => {
    onChange([]);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-text-secondary">
          {selectedPermissionIds.length} permissions selected
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={selectAll}
            className="text-xs text-oak-light hover:text-oak-primary"
          >
            Select All
          </button>
          <button
            type="button"
            onClick={deselectAll}
            className="text-xs text-text-muted hover:text-text-secondary"
          >
            Clear All
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[400px] overflow-y-auto">
        {Object.entries(groupedPermissions).map(([resource, permissions]) => {
          const resourcePermissionIds = permissions.map((p) => p.id);
          const selectedCount = resourcePermissionIds.filter((id) =>
            selectedPermissionIds.includes(id)
          ).length;
          const allSelected = selectedCount === permissions.length;
          const someSelected = selectedCount > 0 && !allSelected;

          return (
            <div
              key={resource}
              className="bg-background-tertiary rounded-lg p-3 border border-border-primary"
            >
              <div className="flex items-center gap-2 mb-2">
                <button
                  type="button"
                  onClick={() => toggleResource(resource)}
                  className={cn(
                    'w-4 h-4 rounded border flex items-center justify-center transition-colors',
                    allSelected
                      ? 'bg-oak-primary border-oak-primary text-white'
                      : someSelected
                        ? 'bg-oak-primary/50 border-oak-primary text-white'
                        : 'border-border-primary hover:border-oak-light'
                  )}
                >
                  {(allSelected || someSelected) && <Check className="w-3 h-3" />}
                </button>
                <span className="font-medium text-sm text-text-primary">
                  {RESOURCE_LABELS[resource] || resource}
                </span>
                <span className="text-xs text-text-muted">
                  ({selectedCount}/{permissions.length})
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5 ml-6">
                {permissions.map((permission) => {
                  const isSelected = selectedPermissionIds.includes(permission.id);
                  return (
                    <button
                      key={permission.id}
                      type="button"
                      onClick={() => togglePermission(permission.id)}
                      className={cn(
                        'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-colors',
                        isSelected
                          ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                          : 'bg-background-secondary text-text-muted hover:bg-background-primary hover:text-text-secondary'
                      )}
                    >
                      {isSelected && <Check className="w-3 h-3" />}
                      {ACTION_LABELS[permission.action] || permission.action}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// Role Card Component
// ============================================================================

interface RoleCardProps {
  role: Role;
  onEdit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
}

function RoleCard({ role, onEdit, onDelete, onDuplicate }: RoleCardProps) {
  const [expanded, setExpanded] = useState(false);
  const groupedPermissions = groupPermissionsByResource(role.permissions);
  const resourceCount = Object.keys(groupedPermissions).length;
  const permissionCount = role.permissions.length;

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <div className="p-4">
        <div className="flex items-start justify-between">
          <div
            className="flex items-start gap-3 flex-1 cursor-pointer"
            onClick={() => setExpanded(!expanded)}
          >
            <div className="w-10 h-10 rounded-lg bg-oak-primary/10 flex items-center justify-center flex-shrink-0">
              <Shield className="w-5 h-5 text-oak-light" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-medium text-text-primary">{role.name}</h3>
                {role.isSystem && (
                  <span className="badge bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                    <Lock className="w-3 h-3 mr-1" />
                    System
                  </span>
                )}
              </div>
              {role.description && (
                <p className="text-sm text-text-secondary mt-0.5">{role.description}</p>
              )}
              <div className="flex items-center gap-4 mt-2 text-xs text-text-muted">
                <span className="flex items-center gap-1">
                  <Users className="w-3.5 h-3.5" />
                  {role._count.users} {role._count.users === 1 ? 'user' : 'users'}
                </span>
                <span>{permissionCount} permissions</span>
                <span>{resourceCount} resources</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              className="p-1.5 hover:bg-background-tertiary rounded transition-colors"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? (
                <ChevronUp className="w-5 h-5 text-text-muted" />
              ) : (
                <ChevronDown className="w-5 h-5 text-text-muted" />
              )}
            </button>

            <Dropdown>
              <DropdownTrigger asChild className="p-1.5 hover:bg-background-tertiary rounded">
                <MoreVertical className="w-4 h-4 text-text-muted" />
              </DropdownTrigger>
              <DropdownMenu>
                <DropdownItem icon={<Copy className="w-4 h-4" />} onClick={onDuplicate}>
                  Duplicate
                </DropdownItem>
                {!role.isSystem && (
                  <>
                    <DropdownItem icon={<Pencil className="w-4 h-4" />} onClick={onEdit}>
                      Edit
                    </DropdownItem>
                    <DropdownItem
                      icon={<Trash2 className="w-4 h-4" />}
                      onClick={onDelete}
                      className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                      disabled={role._count.users > 0}
                    >
                      Delete
                    </DropdownItem>
                  </>
                )}
              </DropdownMenu>
            </Dropdown>
          </div>
        </div>
      </div>

      {/* Expanded Permissions */}
      {expanded && (
        <div className="border-t border-border-primary p-4 bg-background-tertiary/20">
          <h4 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-3">
            Permissions
          </h4>
          {Object.keys(groupedPermissions).length === 0 ? (
            <p className="text-sm text-text-muted">No permissions assigned</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Object.entries(groupedPermissions).map(([resource, actions]) => (
                <div
                  key={resource}
                  className="bg-background-secondary rounded-lg p-3 border border-border-primary"
                >
                  <div className="font-medium text-sm text-text-primary mb-2">
                    {RESOURCE_LABELS[resource] || resource}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {actions.map((action) => (
                      <span
                        key={action}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                      >
                        <Check className="w-3 h-3" />
                        {ACTION_LABELS[action] || action}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main Page Component
// ============================================================================

export default function RolesPage() {
  const { data: session } = useSession();
  const { success, error: showError } = useToast();

  const isSuperAdmin = session?.isSuperAdmin ?? false;

  const activeWorkspaceId = useActiveWorkspaceId(isSuperAdmin, session?.tenantId);

  // Data fetching - use active workspace context
  const { data: roles, isLoading, error } = useWorkspaceRoles(activeWorkspaceId);
  const { data: permissionsData } = usePermissions();

  // Get active workspace ID for mutations
  const workspaceId = activeWorkspaceId;

  // Mutations
  const createRole = useCreateRole(workspaceId);
  const deleteRole = useDeleteRole(workspaceId);
  const duplicateRole = useDuplicateRole(workspaceId);

  // Modal state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [deletingRole, setDeletingRole] = useState<Role | null>(null);
  const [duplicatingRole, setDuplicatingRole] = useState<Role | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    permissions: [] as string[],
  });
  const [formError, setFormError] = useState('');
  const [duplicateName, setDuplicateName] = useState('');

  // Reset form when modals close
  useEffect(() => {
    if (!isCreateModalOpen && !editingRole) {
      setFormData({ name: '', description: '', permissions: [] });
      setFormError('');
    }
  }, [isCreateModalOpen, editingRole]);

  // Populate form when editing
  useEffect(() => {
    if (editingRole) {
      setFormData({
        name: editingRole.name,
        description: editingRole.description || '',
        permissions: editingRole.permissions.map((p) => p.permission.id),
      });
    }
  }, [editingRole]);

  // Update role mutation
  const updateRole = useUpdateRole(workspaceId, editingRole?.id);

  // Handlers
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!formData.name.trim()) {
      setFormError('Role name is required');
      return;
    }

    try {
      await createRole.mutateAsync({
        name: formData.name.trim(),
        description: formData.description.trim() || undefined,
        permissions: formData.permissions,
      });
      success('Role created successfully');
      setIsCreateModalOpen(false);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to create role');
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!formData.name.trim()) {
      setFormError('Role name is required');
      return;
    }

    try {
      await updateRole.mutateAsync({
        name: formData.name.trim(),
        description: formData.description.trim() || undefined,
        permissions: formData.permissions,
      });
      success('Role updated successfully');
      setEditingRole(null);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to update role');
    }
  };

  const handleDelete = async () => {
    if (!deletingRole) return;

    try {
      await deleteRole.mutateAsync(deletingRole.id);
      success('Role deleted successfully');
      setDeletingRole(null);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to delete role');
    }
  };

  const handleDuplicate = async () => {
    if (!duplicatingRole || !duplicateName.trim()) return;

    try {
      await duplicateRole.mutateAsync({
        roleId: duplicatingRole.id,
        name: duplicateName.trim(),
      });
      success('Role duplicated successfully');
      setDuplicatingRole(null);
      setDuplicateName('');
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to duplicate role');
    }
  };

  // Permission check
  const canManageRoles = session?.isSuperAdmin || session?.isWorkspaceAdmin;

  if (!canManageRoles) {
    return (
      <div className="p-4 sm:p-6">
        <Alert variant="error">You do not have permission to access this page.</Alert>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold text-text-primary">
            Roles & Permissions
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            Manage roles and their permissions in your organization
          </p>
        </div>
        <Button
          variant="primary"
          size="sm"
          leftIcon={<Plus className="w-4 h-4" />}
          onClick={() => setIsCreateModalOpen(true)}
        >
          Create Role
        </Button>
      </div>

      {/* Error State */}
      {error && (
        <Alert variant="error" className="mb-4">
          {error instanceof Error ? error.message : 'Failed to load roles'}
        </Alert>
      )}

      {isLoading && (
        <div className="text-center py-12 text-text-secondary">Loading roles...</div>
      )}

      {/* Roles List */}
      {roles && (
        <div className="space-y-4">
          {roles.length === 0 ? (
            <div className="text-center py-12 text-text-secondary">No roles found for this workspace</div>
          ) : (
            roles.map((role: Role) => (
              <RoleCard
                key={role.id}
                role={role}
                onEdit={() => setEditingRole(role)}
                onDelete={() => setDeletingRole(role)}
                onDuplicate={() => {
                  setDuplicatingRole(role);
                  setDuplicateName(`${role.name} (Copy)`);
                }}
              />
            ))
          )}
        </div>
      )}

      {/* Permission Legend */}
      {activeWorkspaceId && (
        <div className="mt-8 card">
          <h3 className="text-sm font-medium text-text-primary mb-3">Permission Actions</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div>
              <span className="font-medium text-text-primary">Create:</span>
              <span className="text-text-secondary ml-1">Add new records</span>
            </div>
            <div>
              <span className="font-medium text-text-primary">Read:</span>
              <span className="text-text-secondary ml-1">View records</span>
            </div>
            <div>
              <span className="font-medium text-text-primary">Update:</span>
              <span className="text-text-secondary ml-1">Modify records</span>
            </div>
            <div>
              <span className="font-medium text-text-primary">Delete:</span>
              <span className="text-text-secondary ml-1">Remove records</span>
            </div>
            <div>
              <span className="font-medium text-text-primary">Export:</span>
              <span className="text-text-secondary ml-1">Export data</span>
            </div>
            <div>
              <span className="font-medium text-text-primary">Import:</span>
              <span className="text-text-secondary ml-1">Import data</span>
            </div>
            <div>
              <span className="font-medium text-text-primary">Manage:</span>
              <span className="text-text-secondary ml-1">Full control</span>
            </div>
          </div>
        </div>
      )}

      {/* Create Role Modal */}
      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        title="Create Role"
        size="lg"
      >
        <form onSubmit={handleCreate}>
          <ModalBody>
            {formError && (
              <Alert variant="error" className="mb-4">
                {formError}
              </Alert>
            )}

            <div className="space-y-4">
              <FormInput
                label="Role Name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Manager, Reviewer, Analyst"
                required
                inputSize="sm"
              />

              <div>
                <label className="label">Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Brief description of this role's purpose..."
                  className="input input-sm w-full min-h-[80px]"
                />
              </div>

              <div>
                <label className="label">Permissions</label>
                {permissionsData ? (
                  <PermissionSelector
                    selectedPermissionIds={formData.permissions}
                    onChange={(permissions) => setFormData({ ...formData, permissions })}
                    groupedPermissions={permissionsData.grouped}
                  />
                ) : (
                  <div className="text-sm text-text-muted">Loading permissions...</div>
                )}
              </div>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setIsCreateModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              isLoading={createRole.isPending}
              leftIcon={<Plus className="w-4 h-4" />}
            >
              Create Role
            </Button>
          </ModalFooter>
        </form>
      </Modal>

      {/* Edit Role Modal */}
      <Modal
        isOpen={!!editingRole}
        onClose={() => setEditingRole(null)}
        title="Edit Role"
        size="lg"
      >
        <form onSubmit={handleUpdate}>
          <ModalBody>
            {formError && (
              <Alert variant="error" className="mb-4">
                {formError}
              </Alert>
            )}

            <div className="space-y-4">
              <FormInput
                label="Role Name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Manager, Reviewer, Analyst"
                required
                inputSize="sm"
              />

              <div>
                <label className="label">Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Brief description of this role's purpose..."
                  className="input input-sm w-full min-h-[80px]"
                />
              </div>

              <div>
                <label className="label">Permissions</label>
                {permissionsData ? (
                  <PermissionSelector
                    selectedPermissionIds={formData.permissions}
                    onChange={(permissions) => setFormData({ ...formData, permissions })}
                    groupedPermissions={permissionsData.grouped}
                  />
                ) : (
                  <div className="text-sm text-text-muted">Loading permissions...</div>
                )}
              </div>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button type="button" variant="secondary" size="sm" onClick={() => setEditingRole(null)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              isLoading={updateRole.isPending}
              leftIcon={<Pencil className="w-4 h-4" />}
            >
              Update Role
            </Button>
          </ModalFooter>
        </form>
      </Modal>

      {/* Duplicate Role Modal */}
      <Modal
        isOpen={!!duplicatingRole}
        onClose={() => {
          setDuplicatingRole(null);
          setDuplicateName('');
        }}
        title="Duplicate Role"
        size="sm"
      >
        <ModalBody>
          <p className="text-sm text-text-secondary mb-4">
            Create a copy of <strong>{duplicatingRole?.name}</strong> with all its permissions.
          </p>
          <FormInput
            label="New Role Name"
            value={duplicateName}
            onChange={(e) => setDuplicateName(e.target.value)}
            placeholder="Enter new role name"
            required
            inputSize="sm"
          />
        </ModalBody>
        <ModalFooter>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setDuplicatingRole(null);
              setDuplicateName('');
            }}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleDuplicate}
            isLoading={duplicateRole.isPending}
            disabled={!duplicateName.trim()}
            leftIcon={<Copy className="w-4 h-4" />}
          >
            Duplicate
          </Button>
        </ModalFooter>
      </Modal>

      {/* Delete Confirmation */}
      {deletingRole && deletingRole._count.users === 0 && (
        <ConfirmDialog
          isOpen={!!deletingRole}
          onClose={() => setDeletingRole(null)}
          onConfirm={handleDelete}
          title="Delete Role"
          description={`Are you sure you want to delete the role "${deletingRole.name}"? This action cannot be undone.`}
          confirmLabel="Delete"
          variant="danger"
          isLoading={deleteRole.isPending}
        />
      )}

      {/* Cannot Delete Modal */}
      {deletingRole && deletingRole._count.users > 0 && (
        <Modal
          isOpen={true}
          onClose={() => setDeletingRole(null)}
          title="Cannot Delete Role"
          size="sm"
        >
          <ModalBody>
            <p className="text-sm text-text-secondary">
              Cannot delete role &quot;{deletingRole.name}&quot; because it is assigned to {deletingRole._count.users} user(s). Remove all user assignments first.
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" size="sm" onClick={() => setDeletingRole(null)}>
              Close
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </div>
  );
}
