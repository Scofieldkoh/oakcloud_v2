import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useWorkspaceListReset } from '@/hooks/use-workspace-list-reset';

describe('useWorkspaceListReset', () => {
  it('does not reset on mount or delayed initial workspace resolution', () => {
    const reset = vi.fn();
    const { rerender } = renderHook(
      ({ workspaceId }) => useWorkspaceListReset(workspaceId, reset),
      { initialProps: { workspaceId: undefined as string | undefined } },
    );

    rerender({ workspaceId: 'workspace-1' });

    expect(reset).not.toHaveBeenCalled();
  });

  it('resets once when one resolved workspace changes to another', () => {
    const reset = vi.fn();
    const { rerender } = renderHook(
      ({ workspaceId }) => useWorkspaceListReset(workspaceId, reset),
      { initialProps: { workspaceId: 'workspace-1' as string | undefined } },
    );

    rerender({ workspaceId: 'workspace-2' });

    expect(reset).toHaveBeenCalledTimes(1);
  });
});
