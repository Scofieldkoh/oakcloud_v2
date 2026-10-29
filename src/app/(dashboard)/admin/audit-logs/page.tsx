'use client';

import { useState } from 'react';
import { useSession } from '@/hooks/use-auth';
import { useAuditLogs, useAuditLogStats, type AuditLog } from '@/hooks/use-admin';
import { Alert } from '@/components/ui/alert';
import { Pagination } from '@/components/ui/pagination';
import {
  Activity,
  User,
  Clock,
  Filter,
  ChevronDown,
  ChevronUp,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
} from 'lucide-react';
import { MobileCollapsibleSection } from '@/components/ui/collapsible-section';
import { CardDetailsGrid, CardDetailItem } from '@/components/ui/responsive-table';
import { format, subDays } from 'date-fns';
import { cn } from '@/lib/utils';

const AUDIT_ACTIONS = [
  { value: 'CREATE', label: 'Create', color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' },
  { value: 'UPDATE', label: 'Update', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' },
  { value: 'DELETE', label: 'Delete', color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' },
  { value: 'LOGIN', label: 'Login', color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300' },
  { value: 'LOGOUT', label: 'Logout', color: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300' },
  { value: 'LOGIN_FAILED', label: 'Login Failed', color: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300' },
  { value: 'UPLOAD', label: 'Upload', color: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300' },
  { value: 'EXTRACT', label: 'Extract', color: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300' },
];

const ENTITY_TYPES = [
  'Company',
  'Contact',
  'Document',
  'User',
  'Tenant',
  'Officer',
  'Shareholder',
];

function getActionColor(action: string) {
  const found = AUDIT_ACTIONS.find((a) => a.value === action);
  return found?.color || 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300';
}

/** Sortable column header component */
function SortableHeader({
  label,
  field,
  sortBy,
  sortOrder,
  onSort,
}: {
  label: string;
  field: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  onSort?: (field: string) => void;
}) {
  const isActive = sortBy === field;

  if (!onSort) {
    return <th>{label}</th>;
  }

  return (
    <th className="cursor-pointer select-none">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onSort(field);
        }}
        className={cn(
          'inline-flex items-center gap-1 hover:text-text-primary transition-colors',
          isActive ? 'text-text-primary' : ''
        )}
      >
        <span>{label}</span>
        <span className="flex-shrink-0">
          {isActive ? (
            sortOrder === 'asc' ? (
              <ArrowUp className="w-3.5 h-3.5" />
            ) : (
              <ArrowDown className="w-3.5 h-3.5" />
            )
          ) : (
            <ArrowUpDown className="w-3.5 h-3.5 text-text-muted" />
          )}
        </span>
      </button>
    </th>
  );
}

function ExpandedChanges({ changes }: { changes: Record<string, { old: unknown; new: unknown }> | null }) {
  if (!changes || Object.keys(changes).length === 0) {
    return <span className="text-text-muted text-sm">No changes recorded</span>;
  }

  return (
    <div className="space-y-2">
      {Object.entries(changes).map(([field, { old: oldVal, new: newVal }]) => (
        <div key={field} className="text-sm">
          <span className="font-medium text-text-primary">{field}:</span>
          <div className="ml-4 mt-1 space-y-1">
            <div className="flex items-start gap-2">
              <span className="text-red-500 text-xs font-medium">OLD:</span>
              <span className="text-text-secondary break-all">
                {oldVal === null || oldVal === undefined ? '(empty)' : JSON.stringify(oldVal)}
              </span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-green-500 text-xs font-medium">NEW:</span>
              <span className="text-text-secondary break-all">
                {newVal === null || newVal === undefined ? '(empty)' : JSON.stringify(newVal)}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function AuditLogCard({ log }: { log: AuditLog }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = (log.changes && Object.keys(log.changes).length > 0) || log.reason || log.metadata;

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn('badge text-xs', getActionColor(log.action))}>
              {log.action.replace(/_/g, ' ')}
            </span>
            <span className="text-xs text-text-muted">
              {format(new Date(log.createdAt), 'MMM d, HH:mm')}
            </span>
          </div>
          <div className="mt-2">
            {log.summary ? (
              <span className="text-sm text-text-primary">{log.summary}</span>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-sm text-text-secondary">{log.entityType}</span>
                {log.entityName && (
                  <span className="text-sm text-text-primary truncate">&quot;{log.entityName}&quot;</span>
                )}
              </div>
            )}
          </div>
        </div>
        {hasDetails && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-2 hover:bg-background-tertiary rounded flex-shrink-0"
          >
            {expanded ? (
              <ChevronUp className="w-4 h-4 text-text-muted" />
            ) : (
              <ChevronDown className="w-4 h-4 text-text-muted" />
            )}
          </button>
        )}
      </div>

      <div className="mt-3 pt-3 border-t border-border-primary">
        <CardDetailsGrid>
          <CardDetailItem
            label="User"
            value={
              log.user ? (
                <div className="flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5 text-text-muted" />
                  <span>{log.user.firstName} {log.user.lastName}</span>
                </div>
              ) : 'System'
            }
          />
          <CardDetailItem label="Source" value={log.changeSource} />
        </CardDetailsGrid>
      </div>

      {expanded && hasDetails && (
        <div className="mt-3 pt-3 border-t border-border-primary space-y-3">
          {log.reason && (
            <div>
              <span className="text-xs font-medium text-text-muted uppercase">Reason:</span>
              <p className="text-sm text-text-primary mt-1">{log.reason}</p>
            </div>
          )}
          {log.changes && Object.keys(log.changes).length > 0 && (
            <div>
              <span className="text-xs font-medium text-text-muted uppercase">Changes:</span>
              <div className="mt-2 p-3 bg-background-secondary rounded-md border border-border-primary">
                <ExpandedChanges changes={log.changes} />
              </div>
            </div>
          )}
          {log.metadata && Object.keys(log.metadata).length > 0 && (
            <div>
              <span className="text-xs font-medium text-text-muted uppercase">Details:</span>
              <div className="mt-2 p-3 bg-background-secondary rounded-md border border-border-primary text-sm">
                <pre className="whitespace-pre-wrap text-text-secondary text-xs overflow-x-auto">
                  {JSON.stringify(log.metadata, null, 2)}
                </pre>
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-2 text-xs text-text-muted">
            {log.entityId && <span className="truncate">ID: {log.entityId.slice(0, 8)}...</span>}
            {log.ipAddress && <span>IP: {log.ipAddress}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function AuditLogRow({ log }: { log: AuditLog }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = (log.changes && Object.keys(log.changes).length > 0) || log.reason || log.metadata;

  return (
    <>
      <tr
        className={cn(
          hasDetails && 'cursor-pointer hover:bg-background-tertiary/50',
          expanded && 'bg-background-tertiary/30'
        )}
        onClick={() => hasDetails && setExpanded(!expanded)}
      >
        <td>
          <div className="flex items-center gap-2">
            <Clock className="w-3.5 h-3.5 text-text-muted" />
            <span className="text-sm text-text-secondary">
              {format(new Date(log.createdAt), 'MMM d, yyyy HH:mm:ss')}
            </span>
          </div>
        </td>
        <td>
          <span className={cn('badge', getActionColor(log.action))}>
            {log.action.replace(/_/g, ' ')}
          </span>
        </td>
        <td className="max-w-md">
          {log.summary ? (
            <span className="text-sm text-text-primary">{log.summary}</span>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-sm text-text-secondary">{log.entityType}</span>
              {log.entityName && (
                <span className="text-sm text-text-primary">&quot;{log.entityName}&quot;</span>
              )}
            </div>
          )}
          {log.reason && !expanded && (
            <p className="text-xs text-text-muted mt-0.5 truncate max-w-xs">
              Reason: {log.reason}
            </p>
          )}
        </td>
        <td>
          {log.user ? (
            <div className="flex items-center gap-2">
              <User className="w-3.5 h-3.5 text-text-muted" />
              <span className="text-sm text-text-secondary">
                {log.user.firstName} {log.user.lastName}
              </span>
            </div>
          ) : (
            <span className="text-text-muted text-sm">System</span>
          )}
        </td>
        <td>
          <span className="text-xs text-text-muted font-mono">
            {log.changeSource}
          </span>
        </td>
        <td>
          {hasDetails && (
            <button className="p-1 hover:bg-background-tertiary rounded">
              {expanded ? (
                <ChevronUp className="w-4 h-4 text-text-muted" />
              ) : (
                <ChevronDown className="w-4 h-4 text-text-muted" />
              )}
            </button>
          )}
        </td>
      </tr>
      {expanded && hasDetails && (
        <tr className="bg-background-tertiary/20">
          <td colSpan={6} className="p-4">
            <div className="space-y-3">
              {log.reason && (
                <div>
                  <span className="text-xs font-medium text-text-muted uppercase">Reason:</span>
                  <p className="text-sm text-text-primary mt-1">{log.reason}</p>
                </div>
              )}
              {log.changes && Object.keys(log.changes).length > 0 && (
                <div>
                  <span className="text-xs font-medium text-text-muted uppercase">Changes:</span>
                  <div className="mt-2 p-3 bg-background-secondary rounded-md border border-border-primary">
                    <ExpandedChanges changes={log.changes} />
                  </div>
                </div>
              )}
              {log.metadata && Object.keys(log.metadata).length > 0 && (
                <div>
                  <span className="text-xs font-medium text-text-muted uppercase">Details:</span>
                  <div className="mt-2 p-3 bg-background-secondary rounded-md border border-border-primary text-sm">
                    <pre className="whitespace-pre-wrap text-text-secondary">
                      {JSON.stringify(log.metadata, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
              <div className="flex flex-wrap gap-4 text-xs text-text-muted">
                {log.entityId && <span>Entity ID: {log.entityId}</span>}
                {log.ipAddress && <span>IP: {log.ipAddress}</span>}
                {log.requestId && <span>Request ID: {log.requestId}</span>}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function AuditLogsPage() {
  const { data: session } = useSession();

  const [actionFilter, setActionFilter] = useState('');
  const [entityTypeFilter, setEntityTypeFilter] = useState('');
  const [startDate, setStartDate] = useState(format(subDays(new Date(), 30), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [showFilters, setShowFilters] = useState(false);
  const [sortBy, setSortBy] = useState<string>('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
    setPage(1);
  };

  const { data, isLoading, error } = useAuditLogs({
    action: actionFilter || undefined,
    entityType: entityTypeFilter || undefined,
    startDate: startDate ? new Date(startDate).toISOString() : undefined,
    endDate: endDate ? new Date(endDate + 'T23:59:59').toISOString() : undefined,
    page,
    limit,
    sortBy,
    sortOrder,
  });

  const { data: stats } = useAuditLogStats({
    startDate: startDate ? new Date(startDate).toISOString() : undefined,
    endDate: endDate ? new Date(endDate + 'T23:59:59').toISOString() : undefined,
  });

  const canViewAuditLogs =
    session?.isSuperAdmin ||
    session?.isWorkspaceAdmin;

  if (!canViewAuditLogs) {
    return (
      <div className="p-4 sm:p-6">
        <Alert variant="error">You do not have permission to access this page.</Alert>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl font-semibold text-text-primary">
          Audit Logs
        </h1>
        <p className="text-sm text-text-secondary mt-1">
          Track all system activity and changes
        </p>
      </div>

      {/* Stats Cards */}
      {stats && (
        <MobileCollapsibleSection title="Statistics" count={4} className="mb-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="card">
              <div className="text-2xl font-semibold text-text-primary">
                {stats.totalLogs?.toLocaleString() || 0}
              </div>
              <div className="text-xs text-text-secondary mt-1">Total Events</div>
            </div>
            {stats.actionCounts?.slice(0, 3).map((stat: { action: string; count: number }) => (
              <div key={stat.action} className="card">
                <div className="text-2xl font-semibold text-text-primary">
                  {stat.count.toLocaleString()}
                </div>
                <div className="text-xs text-text-secondary mt-1">
                  {stat.action.replace(/_/g, ' ')}
                </div>
              </div>
            ))}
          </div>
        </MobileCollapsibleSection>
      )}

      {/* Filters Toggle */}
      <button
        onClick={() => setShowFilters(!showFilters)}
        className="flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary mb-4"
      >
        <Filter className="w-4 h-4" />
        {showFilters ? 'Hide Filters' : 'Show Filters'}
        {showFilters ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {/* Filters */}
      {showFilters && (
        <div className="card mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="label">Action</label>
              <select
                value={actionFilter}
                onChange={(e) => {
                  setActionFilter(e.target.value);
                  setPage(1);
                }}
                className="input input-sm w-full"
              >
                <option value="">All Actions</option>
                {AUDIT_ACTIONS.map((action) => (
                  <option key={action.value} value={action.value}>
                    {action.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label">Entity Type</label>
              <select
                value={entityTypeFilter}
                onChange={(e) => {
                  setEntityTypeFilter(e.target.value);
                  setPage(1);
                }}
                className="input input-sm w-full"
              >
                <option value="">All Types</option>
                {ENTITY_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label">Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  setPage(1);
                }}
                className="input input-sm w-full"
              />
            </div>

            <div>
              <label className="label">End Date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  setPage(1);
                }}
                className="input input-sm w-full"
              />
            </div>
          </div>
        </div>
      )}

      {/* Error State */}
      {error && (
        <Alert variant="error" className="mb-4">
          {error instanceof Error ? error.message : 'Failed to load audit logs'}
        </Alert>
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="text-center py-12 text-text-secondary">Loading audit logs...</div>
      )}

      {/* Audit Logs - Mobile Card View */}
      {data && (
        <div className="md:hidden space-y-3">
          {data.logs.length === 0 ? (
            <div className="card p-8 text-center text-text-secondary">
              <Activity className="w-8 h-8 mx-auto mb-2 opacity-50" />
              No audit logs found
            </div>
          ) : (
            data.logs.map((log: AuditLog) => (
              <AuditLogCard key={log.id} log={log} />
            ))
          )}

          {/* Mobile Pagination */}
          {data.totalPages > 0 && (
            <div className="mt-4">
              <Pagination
                page={data.page}
                totalPages={data.totalPages}
                total={data.totalCount}
                limit={data.limit}
                onPageChange={setPage}
                onLimitChange={(newLimit) => {
                  setLimit(newLimit);
                  setPage(1);
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* Audit Logs - Desktop Table */}
      {data && (
        <div className="hidden md:block">
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <SortableHeader label="Timestamp" field="createdAt" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} />
                    <SortableHeader label="Action" field="action" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} />
                    <th>Description</th>
                    <th>User</th>
                    <th>Source</th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {data.logs.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-8 text-text-secondary">
                        No audit logs found
                      </td>
                    </tr>
                  ) : (
                    data.logs.map((log: AuditLog) => (
                      <AuditLogRow key={log.id} log={log} />
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Desktop Pagination */}
          {data.totalPages > 0 && (
            <div className="mt-4">
              <Pagination
                page={data.page}
                totalPages={data.totalPages}
                total={data.totalCount}
                limit={data.limit}
                onPageChange={setPage}
                onLimitChange={(newLimit) => {
                  setLimit(newLimit);
                  setPage(1);
                }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
