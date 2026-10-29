'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSession } from '@/hooks/use-auth';
import { useActiveWorkspaceId } from '@/components/ui/workspace-selector';

// ============================================================================
// Types
// ============================================================================

export type EntityType = 'company' | 'contact';

export interface NoteTab {
  id: string;
  title: string;
  content: string | null;
  order: number;
  createdAt: string;
  updatedAt: string;
}

interface CreateNoteTabInput {
  title?: string;
  content?: string;
}

interface UpdateNoteTabInput {
  title?: string;
  content?: string;
}

function withWorkspaceId(url: string, tenantId?: string): string {
  if (!tenantId) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}tenantId=${encodeURIComponent(tenantId)}`;
}

// ============================================================================
// API Functions
// ============================================================================

async function fetchNoteTabs(
  entityType: EntityType,
  entityId: string,
  tenantId?: string
): Promise<NoteTab[]> {
  const baseUrl = entityType === 'company' ? 'companies' : 'contacts';
  const response = await fetch(withWorkspaceId(`/api/${baseUrl}/${entityId}/notes`, tenantId));

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to fetch notes');
  }

  return response.json();
}

async function createNoteTab(
  entityType: EntityType,
  entityId: string,
  data: CreateNoteTabInput,
  tenantId?: string
): Promise<NoteTab> {
  const baseUrl = entityType === 'company' ? 'companies' : 'contacts';
  const response = await fetch(withWorkspaceId(`/api/${baseUrl}/${entityId}/notes`, tenantId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to create note tab');
  }

  return response.json();
}

async function updateNoteTab(
  entityType: EntityType,
  entityId: string,
  tabId: string,
  data: UpdateNoteTabInput,
  tenantId?: string
): Promise<NoteTab> {
  const baseUrl = entityType === 'company' ? 'companies' : 'contacts';
  const response = await fetch(withWorkspaceId(`/api/${baseUrl}/${entityId}/notes/${tabId}`, tenantId), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to update note tab');
  }

  return response.json();
}

async function deleteNoteTab(
  entityType: EntityType,
  entityId: string,
  tabId: string,
  tenantId?: string
): Promise<void> {
  const baseUrl = entityType === 'company' ? 'companies' : 'contacts';
  const response = await fetch(withWorkspaceId(`/api/${baseUrl}/${entityId}/notes/${tabId}`, tenantId), {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to delete note tab');
  }
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook to fetch note tabs for an entity
 */
export function useNoteTabs(entityType: EntityType, entityId: string) {
  const { data: session } = useSession();
  const activeTenantId = useActiveWorkspaceId(
    session?.isSuperAdmin ?? false,
    session?.tenantId
  );

  return useQuery({
    queryKey: ['notes', entityType, entityId, activeTenantId ?? null],
    queryFn: () => fetchNoteTabs(entityType, entityId, activeTenantId),
    enabled: !!entityId,
  });
}

/**
 * Hook to create a new note tab
 */
export function useCreateNoteTab(entityType: EntityType, entityId: string) {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const activeTenantId = useActiveWorkspaceId(
    session?.isSuperAdmin ?? false,
    session?.tenantId
  );

  return useMutation({
    mutationFn: (data: CreateNoteTabInput) =>
      createNoteTab(entityType, entityId, data, activeTenantId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['notes', entityType, entityId, activeTenantId ?? null],
      });
    },
  });
}

/**
 * Hook to update a note tab
 */
export function useUpdateNoteTab(entityType: EntityType, entityId: string) {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const activeTenantId = useActiveWorkspaceId(
    session?.isSuperAdmin ?? false,
    session?.tenantId
  );

  return useMutation({
    mutationFn: ({ tabId, data }: { tabId: string; data: UpdateNoteTabInput }) =>
      updateNoteTab(entityType, entityId, tabId, data, activeTenantId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['notes', entityType, entityId, activeTenantId ?? null],
      });
    },
  });
}

/**
 * Hook to delete a note tab
 */
export function useDeleteNoteTab(entityType: EntityType, entityId: string) {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const activeTenantId = useActiveWorkspaceId(
    session?.isSuperAdmin ?? false,
    session?.tenantId
  );

  return useMutation({
    mutationFn: (tabId: string) => deleteNoteTab(entityType, entityId, tabId, activeTenantId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['notes', entityType, entityId, activeTenantId ?? null],
      });
    },
  });
}
