'use client';

import { useState, useEffect } from 'react';
import {
  useWorkspaceAccess,
  useUpdateWorkspaceAccess,
  type Connector,
} from '@/hooks/use-connectors';
import { Button } from '@/components/ui/button';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/components/ui/toast';

// ============================================================================
// Workspace Access Modal Component
// ============================================================================

interface WorkspaceAccessModalProps {
  connector: Connector;
  onClose: () => void;
}

export function WorkspaceAccessModal({ connector, onClose }: WorkspaceAccessModalProps) {
  const { success, error: showError } = useToast();
  const { data: accessData, isLoading } = useWorkspaceAccess(connector.id);
  const updateMutation = useUpdateWorkspaceAccess(connector.id);

  const [localAccess, setLocalAccess] = useState<
    Array<{ workspaceId: string; workspaceName: string; isEnabled: boolean }>
  >([]);

  useEffect(() => {
    if (accessData?.workspaceAccess) {
      setLocalAccess(accessData.workspaceAccess);
    }
  }, [accessData]);

  const handleToggle = (workspaceId: string) => {
    setLocalAccess((prev) =>
      prev.map((a) =>
        a.workspaceId === workspaceId ? { ...a, isEnabled: !a.isEnabled } : a
      )
    );
  };

  const handleSave = async () => {
    try {
      await updateMutation.mutateAsync(
        localAccess.map(({ workspaceId, isEnabled }) => ({ workspaceId, isEnabled }))
      );
      success('Workspace access updated');
      onClose();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to update access');
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={`Workspace Access: ${connector.name}`} size="md">
      <ModalBody>
        {isLoading ? (
          <div className="text-center py-8 text-text-muted">Loading workspaces...</div>
        ) : !localAccess.length ? (
          <div className="text-center py-8 text-text-muted">
            No active workspaces found
          </div>
        ) : (
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            <p className="text-sm text-text-secondary mb-4">
              Control which workspaces can use this system connector. Disabled workspaces
              will not have access to this integration.
            </p>
            {localAccess.map((access) => (
              <div
                key={access.workspaceId}
                className="flex items-center justify-between p-3 rounded-lg bg-bg-tertiary"
              >
                <span className="text-sm text-text-primary">{access.workspaceName}</span>
                <Checkbox
                  checked={access.isEnabled}
                  onChange={() => handleToggle(access.workspaceId)}
                  size="sm"
                />
              </div>
            ))}
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={handleSave}
          isLoading={updateMutation.isPending}
          disabled={isLoading}
        >
          Save Changes
        </Button>
      </ModalFooter>
    </Modal>
  );
}
