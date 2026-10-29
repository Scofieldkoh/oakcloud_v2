'use client';

import { useQuery } from '@tanstack/react-query';

export interface ServicesWorkspaceSettings {
  workspaceEnabled: boolean;
  deadlineWritesEnabled: boolean;
}

export const servicesWorkspaceSettingsKey = ['services-workspace-settings'] as const;

async function fetchServicesWorkspaceSettings(signal: AbortSignal): Promise<ServicesWorkspaceSettings> {
  const response = await fetch('/api/services/settings', { signal });
  const body = await response.json().catch(() => ({})) as Partial<ServicesWorkspaceSettings> & { error?: string };
  if (!response.ok) {
    throw new Error(body.error ?? 'Unable to load Services workspace settings.');
  }

  return {
    workspaceEnabled: body.workspaceEnabled === true,
    deadlineWritesEnabled: body.deadlineWritesEnabled === true,
  };
}

/** Workspace feature flags are session-scoped; the key intentionally has no tenant input. */
export function useServicesWorkspaceSettings() {
  return useQuery<ServicesWorkspaceSettings>({
    queryKey: servicesWorkspaceSettingsKey,
    queryFn: ({ signal }) => fetchServicesWorkspaceSettings(signal),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: false,
  });
}
