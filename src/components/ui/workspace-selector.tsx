'use client';

/**
 * Hook to get the active internal workspace ID.
 *
 * Workspace switching has been removed from the dashboard shell. Internal pages
 * now use the authenticated session workspace only.
 */
export function useActiveWorkspaceId(
  _isSuperAdmin: boolean,
  sessionWorkspaceId: string | null | undefined
): string | undefined {
  return sessionWorkspaceId || undefined;
}
