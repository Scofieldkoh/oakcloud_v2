'use client';

import { useEffect } from 'react';
import { RefreshCw, History } from 'lucide-react';
import type { RevisionStatus, DocumentCategory } from '@/generated/prisma';
import { cn } from '@/lib/utils';
import { revisionStatusConfig, formatDateTime, formatCurrency } from './helpers';

export function HistoryDropdown({
  revisions,
  isLoading,
  onClose,
  categoryLabels,
  currentRevisionId,
  viewingSnapshotId,
  onViewSnapshot,
  onExitSnapshot,
}: {
  revisions?: Array<{
    id: string;
    revisionNumber: number;
    status: RevisionStatus;
    revisionType: string;
    documentCategory: DocumentCategory | null;
    vendorName: string | null;
    totalAmount: string;
    currency: string;
    createdAt: string;
    approvedAt: string | null;
  }>;
  isLoading: boolean;
  onClose: () => void;
  categoryLabels: Record<DocumentCategory, string>;
  currentRevisionId: string | null;
  viewingSnapshotId: string | null;
  onViewSnapshot: (revisionId: string, revisionNumber: number) => void;
  onExitSnapshot: () => void;
}) {
  useEffect(() => {
    const handleClickOutside = () => onClose();
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [onClose]);

  return (
    <div
      className="absolute bottom-full right-0 mb-2 w-80 bg-background-secondary border border-border-primary rounded-lg shadow-lg z-50"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="p-3 border-b border-border-primary">
        <h4 className="text-sm font-medium text-text-primary">Revision History</h4>
      </div>
      <div className="max-h-64 overflow-y-auto">
        {isLoading ? (
          <div className="p-4 flex items-center justify-center">
            <RefreshCw className="w-4 h-4 animate-spin text-text-muted" />
          </div>
        ) : revisions && revisions.length > 0 ? (
          <div className="p-2 space-y-2">
            {revisions.map((rev) => {
              const isCurrentRevision = rev.id === currentRevisionId;
              const isViewingThis = viewingSnapshotId === rev.id;
              return (
                <div
                  key={rev.id}
                  className={cn(
                    'p-3 rounded-lg border cursor-pointer transition-all group relative',
                    isViewingThis
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 ring-2 ring-blue-500/30'
                      : isCurrentRevision
                        ? 'border-oak-primary/50 bg-oak-primary/5'
                        : rev.status === 'APPROVED'
                          ? 'border-status-success/30 bg-status-success/5 hover:border-status-success/50'
                          : rev.status === 'DRAFT'
                            ? 'border-status-warning/30 bg-status-warning/5 hover:border-status-warning/50'
                            : 'border-border-primary bg-background-tertiary hover:border-border-secondary'
                  )}
                  onClick={() => {
                    if (isCurrentRevision) {
                      onExitSnapshot();
                    } else {
                      onViewSnapshot(rev.id, rev.revisionNumber);
                    }
                  }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-text-primary">#{rev.revisionNumber}</span>
                      {isCurrentRevision && (
                        <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-oak-primary/20 text-oak-primary">
                          Current
                        </span>
                      )}
                      {isViewingThis && (
                        <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-blue-500/20 text-blue-600 dark:text-blue-400">
                          Viewing
                        </span>
                      )}
                    </div>
                    <span className={cn('px-1.5 py-0.5 rounded text-xs font-medium', revisionStatusConfig[rev.status].bgColor, revisionStatusConfig[rev.status].color)}>
                      {revisionStatusConfig[rev.status].label}
                    </span>
                  </div>
                  <div className="text-xs text-text-secondary space-y-0.5">
                    <div>{rev.documentCategory ? categoryLabels[rev.documentCategory] : '-'}</div>
                    <div>{formatCurrency(rev.totalAmount, rev.currency)}</div>
                    <div className="text-text-muted">{formatDateTime(rev.createdAt)}</div>
                  </div>
                  {/* Hover hint */}
                  {!isCurrentRevision && !isViewingThis && (
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-background-primary/80 rounded-lg">
                      <span className="text-xs font-medium text-text-secondary flex items-center gap-1">
                        <History className="w-3 h-3" />
                        View Snapshot
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="p-4 text-center text-text-muted text-sm">
            No revision history
          </div>
        )}
      </div>
    </div>
  );
}
