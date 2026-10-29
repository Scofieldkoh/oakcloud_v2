'use client';

import { useState } from 'react';
import { useSession } from '@/hooks/use-auth';
import {
  useConnectors,
  useDeleteConnector,
  useTestConnector,
  type Connector,
  type ConnectorSearchParams,
} from '@/hooks/use-connectors';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Alert } from '@/components/ui/alert';
import { useToast } from '@/components/ui/toast';
import { useActiveWorkspaceId } from '@/components/ui/workspace-selector';
import { type DatePickerValue } from '@/components/ui/date-picker';
import { subDays } from 'date-fns';
import {
  Plus,
  Zap,
  Cloud,
  Brain,
} from 'lucide-react';
import {
  type ConnectorType,
  type ConnectorProvider,
} from '@/components/connectors/admin/connector-admin-config';
import { ConnectorCreateModal } from '@/components/connectors/admin/connector-create-modal';
import { ConnectorEditModal } from '@/components/connectors/admin/connector-edit-modal';
import { ConnectorGroup, type ConnectorListActions } from '@/components/connectors/admin/connector-list';
import { ConnectorUsageModal } from '@/components/connectors/admin/connector-usage-modal';
import { SetupGuideModal } from '@/components/connectors/admin/setup-guide-modal';
import { WorkspaceAccessModal } from '@/components/connectors/admin/workspace-access-modal';

export default function ConnectorsPage() {
  const { data: session } = useSession();
  const { success, error: showError } = useToast();
  const isSuperAdmin = session?.isSuperAdmin ?? false;
  const isWorkspaceAdmin = session?.isWorkspaceAdmin ?? false;

  const [typeFilter, setTypeFilter] = useState<ConnectorType | ''>('');
  const [providerFilter, setProviderFilter] = useState<ConnectorProvider | ''>('');
  const [page, setPage] = useState(1);

  // Modals
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingConnector, setEditingConnector] = useState<Connector | null>(null);
  const [deletingConnector, setDeletingConnector] = useState<Connector | null>(null);
  const [accessConnector, setAccessConnector] = useState<Connector | null>(null);
  const [usageConnector, setUsageConnector] = useState<Connector | null>(null);
  // Kept here so the chosen usage dates survive closing and reopening the usage modal.
  const [usageDateFilter, setUsageDateFilter] = useState<DatePickerValue | undefined>({
    mode: 'range',
    range: {
      from: subDays(new Date(), 30), // 30 days ago
      to: new Date(), // today
    },
  });
  const [showSetupGuide, setShowSetupGuide] = useState<'SHAREPOINT' | 'ONEDRIVE' | null>(null);

  // Active tenant - using centralized hook
  const activeWorkspaceId = useActiveWorkspaceId(isSuperAdmin, session?.tenantId);

  // Build search params
  const searchParams: ConnectorSearchParams = {
    ...(activeWorkspaceId ? { tenantId: activeWorkspaceId } : {}),
    ...(typeFilter ? { type: typeFilter } : {}),
    ...(providerFilter ? { provider: providerFilter } : {}),
    includeSystem: true,
    page,
    limit: 50,
  };

  // Queries
  const { data: connectorsData, isLoading } = useConnectors(searchParams);

  // Mutations
  const deleteMutation = useDeleteConnector();
  const testMutation = useTestConnector();

  // Access control
  if (!isSuperAdmin && !isWorkspaceAdmin) {
    return (
      <div className="p-6">
        <Alert variant="error">You do not have permission to access this page.</Alert>
      </div>
    );
  }

  // Group connectors by type
  const connectorsByType: Partial<Record<ConnectorType, Connector[]>> = connectorsData?.connectors.reduce(
    (acc, connector) => {
      if (!acc[connector.type]) {
        acc[connector.type] = [];
      }
      acc[connector.type]!.push(connector);
      return acc;
    },
    {} as Partial<Record<ConnectorType, Connector[]>>
  ) || {};

  // Handlers
  const handleDelete = async (reason?: string) => {
    if (!deletingConnector) return;

    try {
      await deleteMutation.mutateAsync({ id: deletingConnector.id, reason: reason || 'No reason provided' });
      success('Connector deleted successfully');
      setDeletingConnector(null);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to delete connector');
    }
  };

  const handleTest = async (connector: Connector) => {
    try {
      const result = await testMutation.mutateAsync(connector.id);
      if (result.success) {
        success(`Connection test passed (${result.latencyMs}ms)`);
      } else {
        showError(`Connection test failed: ${result.error}`);
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to test connection');
    }
  };

  const handleToggle = async (connector: Connector) => {
    try {
      const res = await fetch(`/api/connectors/${connector.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isEnabled: !connector.isEnabled }),
      });
      if (!res.ok) throw new Error('Failed to toggle');
      success(`Connector ${connector.isEnabled ? 'disabled' : 'enabled'}`);
      // Refetch handled by mutation invalidation
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to toggle connector');
    }
  };

  const groupProps = {
    isSuperAdmin,
    tenantId: session?.tenantId,
    testingConnectorId: testMutation.isPending ? testMutation.variables : undefined,
    actions: {
      onTest: handleTest,
      onEdit: setEditingConnector,
      onToggle: handleToggle,
      onViewUsage: setUsageConnector,
      onManageAccess: setAccessConnector,
      onDelete: setDeletingConnector,
    } satisfies ConnectorListActions,
  };

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold text-text-primary">
            Connectors Hub
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            Manage external service integrations for AI and storage/email
          </p>
        </div>
        <Button variant="primary" size="sm" onClick={() => setIsCreateModalOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Add Connector
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select
          value={typeFilter}
          onChange={(e) => {
            setTypeFilter(e.target.value as ConnectorType | '');
            setPage(1);
          }}
          className="input input-sm w-40"
        >
          <option value="">All Types</option>
          <option value="AI_PROVIDER">AI Provider</option>
          <option value="STORAGE">Storage/ Email</option>
        </select>
        <select
          value={providerFilter}
          onChange={(e) => {
            setProviderFilter(e.target.value as ConnectorProvider | '');
            setPage(1);
          }}
          className="input input-sm w-40"
        >
          <option value="">All Providers</option>
          <option value="OPENAI">OpenAI</option>
          <option value="ANTHROPIC">Anthropic</option>
          <option value="GOOGLE">Google AI</option>
          <option value="OPENROUTER">OpenRouter</option>
          <option value="MISTRAL">Mistral OCR</option>
          <option value="ONEDRIVE">OneDrive</option>
          <option value="SHAREPOINT">SharePoint</option>
        </select>
      </div>

      {/* Connectors List */}
      {isLoading ? (
        <div className="text-center py-12 text-text-muted">Loading connectors...</div>
      ) : !connectorsData?.connectors.length ? (
        <div className="text-center py-12">
          <Zap className="w-12 h-12 mx-auto text-text-muted mb-4" />
          <p className="text-text-secondary">No connectors configured yet</p>
          <p className="text-sm text-text-muted mt-1">
            Add a connector to enable AI features and storage/email integrations
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          <ConnectorGroup
            title="AI Providers"
            icon={Brain}
            iconClassName="text-oak-light"
            connectors={connectorsByType['AI_PROVIDER'] ?? []}
            {...groupProps}
          />
          <ConnectorGroup
            title="Storage/ Email"
            icon={Cloud}
            iconClassName="text-sky-500"
            connectors={connectorsByType['STORAGE'] ?? []}
            {...groupProps}
          />
        </div>
      )}

      <ConnectorCreateModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        isSuperAdmin={isSuperAdmin}
        tenantId={session?.tenantId}
        activeWorkspaceId={activeWorkspaceId}
        onShowSetupGuide={setShowSetupGuide}
      />

      {editingConnector && (
        <ConnectorEditModal
          key={editingConnector.id}
          connector={editingConnector}
          onClose={() => setEditingConnector(null)}
          tenantId={session?.tenantId}
          onShowSetupGuide={setShowSetupGuide}
        />
      )}

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={!!deletingConnector}
        onClose={() => setDeletingConnector(null)}
        onConfirm={handleDelete}
        title="Delete Connector"
        description={`Are you sure you want to delete "${deletingConnector?.name}"? This will disable the integration and cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        requireReason
        reasonLabel="Reason for deletion"
        reasonMinLength={10}
        isLoading={deleteMutation.isPending}
      />

      {/* Workspace Access Modal */}
      {accessConnector && (
        <WorkspaceAccessModal
          connector={accessConnector}
          onClose={() => setAccessConnector(null)}
        />
      )}

      {/* Setup Guide Modal */}
      {showSetupGuide && (
        <SetupGuideModal
          provider={showSetupGuide}
          onClose={() => setShowSetupGuide(null)}
        />
      )}

      {usageConnector && (
        <ConnectorUsageModal
          connector={usageConnector}
          dateFilter={usageDateFilter}
          onDateFilterChange={setUsageDateFilter}
          onClose={() => setUsageConnector(null)}
        />
      )}
    </div>
  );
}
