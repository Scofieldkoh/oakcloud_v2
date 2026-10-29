'use client';

import { use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, History, User, FileUp, Pencil, Trash2, Plus, RotateCcw, RefreshCw } from 'lucide-react';
import { formatDateTime } from '@/lib/utils';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';

interface AuditLog {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  changeSource: string;
  changes: Record<string, { old: unknown; new: unknown }> | null;
  reason: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  } | null;
}

const actionIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  CREATE: Plus,
  UPDATE: Pencil,
  DELETE: Trash2,
  RESTORE: RotateCcw,
  UPLOAD: FileUp,
  EXTRACT: FileUp,
};

const actionColors: Record<string, string> = {
  CREATE: 'text-status-success',
  UPDATE: 'text-status-info',
  DELETE: 'text-status-error',
  RESTORE: 'text-status-warning',
  UPLOAD: 'text-oak-light',
  EXTRACT: 'text-oak-light',
};

async function fetchAuditLogs(companyId: string): Promise<AuditLog[]> {
  const response = await fetch(`/api/companies/${companyId}/audit`);
  if (!response.ok) {
    throw new Error('Failed to fetch audit logs');
  }
  return response.json();
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export default function CompanyAuditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();

  const { data: auditLogs, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['company-audit', id],
    queryFn: () => fetchAuditLogs(id),
  });

  useKeyboardShortcuts([
    {
      key: 'Backspace',
      ctrl: true,
      handler: () => router.push(`/companies/${id}`),
      description: 'Back to company',
    },
    {
      key: 'r',
      ctrl: true,
      handler: () => refetch(),
      description: 'Refresh audit logs',
    },
    {
      key: 'F1',
      handler: () => router.push('/companies/new'),
      description: 'Create company',
    },
    {
      key: 'F2',
      handler: () => router.push(`/companies/upload?companyId=${id}`),
      description: 'Update via BizFile',
    },
  ]);

  return (
    <div className="p-4 sm:p-6">
      {/* Header */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
        <Link
          href={`/companies/${id}`}
          title="Back to Company (Ctrl+Backspace)"
          className="inline-flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary mb-3 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Company
        </Link>
        <h1 className="text-xl sm:text-2xl font-semibold text-text-primary">
          Audit History
        </h1>
        <p className="text-sm text-text-secondary mt-1">
          Complete history of changes made to this company record
        </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refetch()}
            className="btn-secondary btn-sm flex items-center gap-2"
            title="Refresh (Ctrl+R)"
            disabled={isFetching}
          >
            <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Refresh (Ctrl+R)</span>
            <span className="sm:hidden">Refresh</span>
          </button>
          <Link href="/companies/upload" className="btn-secondary btn-sm flex items-center gap-2" title="Upload BizFile (F2)">
            <FileUp className="w-4 h-4" />
            <span className="hidden sm:inline">Upload BizFile (F2)</span>
            <span className="sm:hidden">Upload</span>
          </Link>
          <Link href="/companies/new" className="btn-primary btn-sm flex items-center gap-2" title="Add Company (F1)">
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Add Company (F1)</span>
            <span className="sm:hidden">Add</span>
          </Link>
        </div>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="space-y-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="card">
              <div className="flex gap-4">
                <div className="skeleton w-10 h-10 rounded-full" />
                <div className="flex-1 space-y-2">
                  <div className="skeleton h-4 w-48" />
                  <div className="skeleton h-3 w-32" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="card p-8 text-center">
          <p className="text-status-error">
            {error instanceof Error ? error.message : 'Failed to load audit logs'}
          </p>
        </div>
      )}

      {/* Audit Logs */}
      {auditLogs && auditLogs.length > 0 && (
        <div className="space-y-4">
          {auditLogs.map((log) => {
            const Icon = actionIcons[log.action] || History;
            const colorClass = actionColors[log.action] || 'text-text-tertiary';

            return (
              <div key={log.id} className="card">
                <div className="flex gap-4">
                  <div className={`p-2 rounded-full bg-background-elevated ${colorClass}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className={`font-medium ${colorClass}`}>
                          {log.action}
                        </span>
                        <span className="text-text-secondary">
                          {log.entityType}
                        </span>
                        {log.changeSource !== 'MANUAL' && (
                          <span className="badge badge-info text-2xs">
                            {log.changeSource.replace(/_/g, ' ')}
                          </span>
                        )}
                      </div>
                      <span className="text-sm text-text-tertiary">
                        {formatDateTime(log.createdAt)}
                      </span>
                    </div>

                    {log.user && (
                      <div className="flex items-center gap-2 text-sm text-text-secondary mb-2">
                        <User className="w-4 h-4" />
                        {log.user.firstName} {log.user.lastName}
                        <span className="text-text-muted">({log.user.email})</span>
                      </div>
                    )}

                    {log.reason && (
                      <div className="text-sm text-text-secondary mb-2">
                        <span className="text-text-tertiary">Reason:</span> {log.reason}
                      </div>
                    )}

                    {log.changes && Object.keys(log.changes).length > 0 && (
                      <div className="mt-3 space-y-1">
                        <p className="text-xs text-text-tertiary uppercase">Changes</p>
                        <div className="bg-background-tertiary rounded p-3 space-y-2">
                          {Object.entries(log.changes).map(([field, { old: oldValue, new: newValue }]) => (
                            <div key={field} className="flex items-start gap-2 text-sm">
                              <span className="text-text-secondary font-medium min-w-[120px]">
                                {field.replace(/([A-Z])/g, ' $1').trim()}:
                              </span>
                              <span className="text-status-error line-through">
                                {formatValue(oldValue)}
                              </span>
                              <span className="text-text-muted">→</span>
                              <span className="text-status-success">
                                {formatValue(newValue)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {log.metadata && Object.keys(log.metadata).length > 0 && (
                      <div className="mt-2">
                        <details className="text-sm">
                          <summary className="text-text-tertiary cursor-pointer hover:text-text-secondary">
                            View metadata
                          </summary>
                          <pre className="mt-2 bg-background-tertiary rounded p-2 text-xs overflow-x-auto">
                            {JSON.stringify(log.metadata, null, 2)}
                          </pre>
                        </details>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Empty State */}
      {auditLogs && auditLogs.length === 0 && (
        <div className="card p-12 text-center">
          <History className="w-12 h-12 text-text-muted mx-auto mb-4" />
          <h3 className="text-lg font-medium text-text-primary mb-2">No audit history</h3>
          <p className="text-text-secondary">
            Changes to this company will appear here.
          </p>
        </div>
      )}
    </div>
  );
}
