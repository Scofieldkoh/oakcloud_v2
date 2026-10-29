'use client';

import type { ComponentType } from 'react';
import { BarChart3, Check, MoreVertical, Pencil, RefreshCw, Shield, Trash2, X } from 'lucide-react';
import { getProviderDisplayName, parseTestResult, type Connector } from '@/hooks/use-connectors';
import { Button } from '@/components/ui/button';
import { Dropdown, DropdownItem, DropdownMenu, DropdownTrigger } from '@/components/ui/dropdown';
import { StatusBadge } from '@/components/ui/status-badge';
import { ScopeBadge } from '@/components/ui/scope-badge';
import { ProviderIcon } from '@/components/ui/provider-icon';
import { MobileCard, CardDetailsGrid, CardDetailItem } from '@/components/ui/responsive-table';
import { cn } from '@/lib/utils';

export interface ConnectorListActions {
  onTest: (connector: Connector) => void;
  onEdit: (connector: Connector) => void;
  onToggle: (connector: Connector) => void;
  onViewUsage: (connector: Connector) => void;
  onManageAccess: (connector: Connector) => void;
  onDelete: (connector: Connector) => void;
}

interface ConnectorItemProps {
  connector: Connector;
  isSuperAdmin: boolean;
  /** The signed-in user's own workspace; workspace admins can edit only its connectors. */
  tenantId: string | null | undefined;
  isTesting: boolean;
  actions: ConnectorListActions;
}

function TestResultBadge({ result }: { result: string | null }) {
  const parsed = parseTestResult(result);
  if (!result) {
    return <span className="text-xs text-text-muted">Not tested</span>;
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs',
        parsed.success ? 'text-green-600' : 'text-red-600'
      )}
      title={parsed.error}
    >
      {parsed.success ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
      {parsed.success ? 'OK' : 'Failed'}
    </span>
  );
}

function getConnectorPermissions(connector: Connector, isSuperAdmin: boolean, tenantId: string | null | undefined) {
  const isSystem = connector.workspaceId === null;
  const canEdit = isSuperAdmin || (!isSystem && connector.workspaceId === tenantId);
  return { isSystem, canEdit, canDelete: canEdit };
}

/** The row menu: edit, enable or disable, usage, workspace access and delete. */
function ConnectorActionsMenu({ connector, isSuperAdmin, tenantId, actions }: Omit<ConnectorItemProps, 'isTesting'>) {
  const { isSystem, canEdit, canDelete } = getConnectorPermissions(connector, isSuperAdmin, tenantId);
  if (!(canEdit || canDelete || (isSuperAdmin && isSystem))) return null;

  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <Button variant="ghost" size="xs" iconOnly leftIcon={<MoreVertical className="w-4 h-4" />} aria-label="More options" />
      </DropdownTrigger>
      <DropdownMenu align="right">
        {canEdit && (
          <DropdownItem onClick={() => actions.onEdit(connector)}>
            <Pencil className="w-4 h-4 mr-2" />
            Edit
          </DropdownItem>
        )}
        {canEdit && (
          <DropdownItem onClick={() => actions.onToggle(connector)}>
            {connector.isEnabled ? (
              <>
                <X className="w-4 h-4 mr-2" />
                Disable
              </>
            ) : (
              <>
                <Check className="w-4 h-4 mr-2" />
                Enable
              </>
            )}
          </DropdownItem>
        )}
        <DropdownItem onClick={() => actions.onViewUsage(connector)}>
          <BarChart3 className="w-4 h-4 mr-2" />
          View Usage
        </DropdownItem>
        {isSuperAdmin && isSystem && (
          <DropdownItem onClick={() => actions.onManageAccess(connector)}>
            <Shield className="w-4 h-4 mr-2" />
            Workspace Access
          </DropdownItem>
        )}
        {canDelete && (
          <DropdownItem
            destructive
            onClick={() => actions.onDelete(connector)}
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Delete
          </DropdownItem>
        )}
      </DropdownMenu>
    </Dropdown>
  );
}

/** Phone layout for one connector. */
function ConnectorCard({ connector, isSuperAdmin, tenantId, isTesting, actions }: ConnectorItemProps) {
  const { isSystem } = getConnectorPermissions(connector, isSuperAdmin, tenantId);

  return (
    <MobileCard
      title={
        <div className="flex items-center gap-2">
          <ProviderIcon provider={connector.provider} />
          <span className="font-medium text-text-primary">{connector.name}</span>
        </div>
      }
      subtitle={getProviderDisplayName(connector.provider)}
      badge={<StatusBadge status={connector.isEnabled} />}
      actions={
        <div className="flex items-center gap-1">
          <Button
            variant="secondary"
            size="xs"
            onClick={() => actions.onTest(connector)}
            isLoading={isTesting}
            disabled={isTesting}
          >
            <RefreshCw className="w-3 h-3" />
          </Button>
          <ConnectorActionsMenu connector={connector} isSuperAdmin={isSuperAdmin} tenantId={tenantId} actions={actions} />
        </div>
      }
      details={
        <CardDetailsGrid>
          <CardDetailItem label="Scope" value={<ScopeBadge scope={isSystem} />} />
          <CardDetailItem label="Test" value={<TestResultBadge result={connector.lastTestResult} />} />
          <CardDetailItem label="Calls" value={connector.callCount.toLocaleString()} />
          <CardDetailItem
            label="Last Used"
            value={connector.lastUsedAt ? new Date(connector.lastUsedAt).toLocaleDateString() : 'Never'}
          />
        </CardDetailsGrid>
      }
    />
  );
}

/** Desktop table row for one connector. */
function ConnectorRow({ connector, isSuperAdmin, tenantId, isTesting, actions }: ConnectorItemProps) {
  const { isSystem } = getConnectorPermissions(connector, isSuperAdmin, tenantId);

  return (
    <tr className="hover:bg-bg-tertiary transition-colors">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <ProviderIcon provider={connector.provider} />
          <div>
            <div className="font-medium text-text-primary">{connector.name}</div>
            <div className="text-xs text-text-secondary">
              {getProviderDisplayName(connector.provider)}
            </div>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <ScopeBadge scope={isSystem} />
      </td>
      <td className="px-4 py-3">
        <StatusBadge status={connector.isEnabled} />
      </td>
      <td className="px-4 py-3">
        <TestResultBadge result={connector.lastTestResult} />
      </td>
      <td className="px-4 py-3 text-sm text-text-secondary">
        {connector.callCount.toLocaleString()}
      </td>
      <td className="px-4 py-3 text-sm text-text-muted">
        {connector.lastUsedAt
          ? new Date(connector.lastUsedAt).toLocaleDateString()
          : 'Never'}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="xs"
            onClick={() => actions.onTest(connector)}
            isLoading={isTesting}
            disabled={isTesting}
          >
            <RefreshCw className="w-3 h-3 mr-1" />
            Test
          </Button>
          <ConnectorActionsMenu connector={connector} isSuperAdmin={isSuperAdmin} tenantId={tenantId} actions={actions} />
        </div>
      </td>
    </tr>
  );
}

const COLUMNS: Array<[label: string, width: string]> = [
  ['Provider', '22%'],
  ['Scope', '12%'],
  ['Status', '12%'],
  ['Test', '10%'],
  ['Calls', '10%'],
  ['Last Used', '14%'],
  ['Actions', '20%'],
];

interface ConnectorGroupProps {
  title: string;
  icon: ComponentType<{ className?: string }>;
  iconClassName: string;
  connectors: Connector[];
  isSuperAdmin: boolean;
  tenantId: string | null | undefined;
  /** The connector whose connection test is running, if any. */
  testingConnectorId: string | undefined;
  actions: ConnectorListActions;
}

/** One card of connectors (AI providers, or storage and email): cards on phones, a table on desktop. */
export function ConnectorGroup({
  title,
  icon: Icon,
  iconClassName,
  connectors,
  isSuperAdmin,
  tenantId,
  testingConnectorId,
  actions,
}: ConnectorGroupProps) {
  if (connectors.length === 0) return null;

  const itemProps = (connector: Connector) => ({
    connector,
    isSuperAdmin,
    tenantId,
    isTesting: testingConnectorId === connector.id,
    actions,
  });

  return (
    <div className="card">
      <div className="p-4 border-b border-border-primary">
        <h2 className="font-medium text-text-primary flex items-center gap-2">
          <Icon className={cn('w-5 h-5', iconClassName)} />
          {title}
        </h2>
      </div>
      {/* Mobile Card View */}
      <div className="md:hidden p-4 space-y-3">
        {connectors.map((connector) => <ConnectorCard key={connector.id} {...itemProps(connector)} />)}
      </div>
      {/* Desktop Table View */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full min-w-[800px]">
          <thead>
            <tr className="border-b border-border-primary bg-bg-tertiary">
              {COLUMNS.map(([label, width]) => (
                <th
                  key={label}
                  className="px-4 py-2 text-left text-xs font-medium text-text-secondary uppercase tracking-wider"
                  style={{ width }}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border-primary">
            {connectors.map((connector) => <ConnectorRow key={connector.id} {...itemProps(connector)} />)}
          </tbody>
        </table>
      </div>
    </div>
  );
}
