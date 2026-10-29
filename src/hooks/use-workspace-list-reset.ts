'use client';

import { useEffect, useRef } from 'react';

export function useWorkspaceListReset(
  workspaceId: string | undefined,
  reset: () => void,
): void {
  const resolvedWorkspaceRef = useRef<string | undefined>(workspaceId);

  useEffect(() => {
    if (!workspaceId) return;

    if (!resolvedWorkspaceRef.current) {
      resolvedWorkspaceRef.current = workspaceId;
      return;
    }

    if (resolvedWorkspaceRef.current === workspaceId) return;

    resolvedWorkspaceRef.current = workspaceId;
    reset();
  }, [reset, workspaceId]);
}
