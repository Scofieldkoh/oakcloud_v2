'use client';

/** The six Statistics cards above the Document Processing list. */

import {
  FileText,
  Clock,
  CheckCircle,
  AlertTriangle,
  RefreshCw,
  Eye,
} from 'lucide-react';
import { MobileCollapsibleSection } from '@/components/ui/collapsible-section';
import { cn } from '@/lib/utils';
import { type ProcessingListStats } from '@/components/processing/list/processing-list-config';

interface ProcessingStatsCardsProps {
  stats: ProcessingListStats;
  isFetching: boolean;
}

export function ProcessingStatsCards({ stats, isFetching }: ProcessingStatsCardsProps) {
  return (
    <MobileCollapsibleSection title="Statistics" count={6} className={cn('mb-6', isFetching && 'opacity-60')}>
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
        <div className="card card-compact sm:p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded bg-oak-primary/10">
              <FileText className="w-4 h-4 sm:w-5 sm:h-5 text-oak-light" />
            </div>
            <div>
              <p className="text-xl sm:text-2xl font-semibold text-text-primary">{stats.total}</p>
              <p className="text-xs sm:text-sm text-text-tertiary">Total</p>
            </div>
          </div>
        </div>

        <div className="card card-compact sm:p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded bg-status-info/10">
              <Clock className="w-4 h-4 sm:w-5 sm:h-5 text-status-info" />
            </div>
            <div>
              <p className="text-xl sm:text-2xl font-semibold text-text-primary">{stats.queued}</p>
              <p className="text-xs sm:text-sm text-text-tertiary">Queued</p>
            </div>
          </div>
        </div>

        <div className="card card-compact sm:p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded bg-status-info/10">
              <RefreshCw className="w-4 h-4 sm:w-5 sm:h-5 text-status-info" />
            </div>
            <div>
              <p className="text-xl sm:text-2xl font-semibold text-text-primary">{stats.processing}</p>
              <p className="text-xs sm:text-sm text-text-tertiary">Processing</p>
            </div>
          </div>
        </div>

        <div className="card card-compact sm:p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded bg-status-warning/10">
              <Eye className="w-4 h-4 sm:w-5 sm:h-5 text-status-warning" />
            </div>
            <div>
              <p className="text-xl sm:text-2xl font-semibold text-text-primary">{stats.pendingReview}</p>
              <p className="text-xs sm:text-sm text-text-tertiary">Pending Review</p>
            </div>
          </div>
        </div>

        <div className="card card-compact sm:p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded bg-status-success/10">
              <CheckCircle className="w-4 h-4 sm:w-5 sm:h-5 text-status-success" />
            </div>
            <div>
              <p className="text-xl sm:text-2xl font-semibold text-text-primary">{stats.approved}</p>
              <p className="text-xs sm:text-sm text-text-tertiary">Approved</p>
            </div>
          </div>
        </div>

        <div className="card card-compact sm:p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded bg-status-error/10">
              <AlertTriangle className="w-4 h-4 sm:w-5 sm:h-5 text-status-error" />
            </div>
            <div>
              <p className="text-xl sm:text-2xl font-semibold text-text-primary">{stats.failed}</p>
              <p className="text-xs sm:text-sm text-text-tertiary">Failed</p>
            </div>
          </div>
        </div>
      </div>
    </MobileCollapsibleSection>
  );
}
