'use client';

import { Archive, Loader2, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { useArchiveClientService, useDeleteClientServicePermanently } from '@/hooks/use-client-services';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';
import type { ServiceRosterItem } from '@/services/service-roster';

type ServiceBulkAction = 'archive' | 'delete';

export interface ServiceBulkNotice {
  variant: 'success' | 'error';
  title: string;
  details: string;
}

interface ServiceBulkActionsToolbarProps {
  selectedServices: ServiceRosterItem[];
  onSelectionChange: (items: ServiceRosterItem[]) => void;
  onRefresh: () => Promise<unknown>;
  onNotice: (notice: ServiceBulkNotice | null) => void;
  onClearSelection: () => void;
}

export function ServiceBulkActionsToolbar({
  selectedServices,
  onSelectionChange,
  onRefresh,
  onNotice,
  onClearSelection,
}: ServiceBulkActionsToolbarProps) {
  const archiveClientService = useArchiveClientService();
  const deleteClientServicePermanently = useDeleteClientServicePermanently();
  const [confirmAction, setConfirmAction] = useState<ServiceBulkAction | null>(null);
  const [busyAction, setBusyAction] = useState<ServiceBulkAction | null>(null);
  const selectedCount = selectedServices.length;
  if (selectedCount === 0) return null;

  const serviceLabel = selectedCount === 1 ? 'service' : 'services';
  const isBusy = busyAction !== null || archiveClientService.isPending || deleteClientServicePermanently.isPending;
  const closeConfirmation = () => {
    if (!isBusy) setConfirmAction(null);
  };

  const runBulkAction = async (action: ServiceBulkAction, reason: string) => {
    if (selectedServices.length === 0) return;
    setBusyAction(action);
    onNotice(null);

    const outcomes = await Promise.all(selectedServices.map(async (item) => {
      try {
        if (action === 'archive') {
          await archiveClientService.mutateAsync({ id: item.id, companyId: item.companyId, reason });
        } else {
          await deleteClientServicePermanently.mutateAsync({
            id: item.id,
            companyId: item.companyId,
            expectedUpdatedAt: item.updatedAt,
            reason,
          });
        }
        return { item, success: true as const };
      } catch (error) {
        return {
          item,
          success: false as const,
          error: error instanceof Error ? error.message : 'Request failed',
        };
      }
    }));

    const failed = outcomes.filter((outcome): outcome is Extract<typeof outcome, { success: false }> => !outcome.success);
    const succeeded = outcomes.length - failed.length;
    onSelectionChange(failed.map((outcome) => outcome.item));

    let refreshError: string | null = null;
    if (succeeded > 0) {
      try {
        await onRefresh();
      } catch (error) {
        refreshError = error instanceof Error ? error.message : 'Unable to refresh the Services roster';
      }
    }

    const actionLabel = action === 'archive' ? 'Archived' : 'Permanently deleted';
    if (failed.length > 0 || refreshError) {
      const failureDetails = failed.length > 0
        ? `${failed.length} failed: ${[...new Set(failed.map((outcome) => outcome.error))].join(', ')}`
        : 'The roster could not be refreshed; please reload to confirm the result.';
      onNotice({
        variant: 'error',
        title: `${actionLabel} ${succeeded} of ${outcomes.length} selected service${outcomes.length === 1 ? '' : 's'}`,
        details: failureDetails,
      });
    } else {
      onNotice({
        variant: 'success',
        title: `${actionLabel} ${succeeded} service${succeeded === 1 ? '' : 's'}`,
        details: 'The Services roster has been refreshed.',
      });
    }
    setBusyAction(null);
  };

  const confirm = async (reason: string | undefined) => {
    if (!confirmAction) return;
    await runBulkAction(confirmAction, reason ?? '');
    setConfirmAction(null);
  };

  const actionButton = (action: ServiceBulkAction, label: string, Icon: typeof Archive) => (
    <button
      type="button"
      onClick={() => setConfirmAction(action)}
      disabled={isBusy}
      className={cn(
        'flex min-h-10 items-center gap-1 rounded-md px-2 py-2 text-text-secondary transition-colors sm:gap-2 sm:px-3 sm:py-1.5',
        action === 'delete' ? 'hover:bg-status-error/10 hover:text-status-error' : 'hover:bg-status-warning/10 hover:text-status-warning',
        isBusy && 'cursor-not-allowed opacity-50',
      )}
      aria-label={label}
      title={`${label} selected ${serviceLabel}`}
    >
      {isBusy && confirmAction === action ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Icon className="h-4 w-4" aria-hidden="true" />}
      <span className="text-xs sm:text-sm">{label}</span>
    </button>
  );

  return (
    <>
      <div
        role="toolbar"
        aria-label="Selected service actions"
        className="fixed bottom-4 left-1/2 z-40 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-1 rounded-lg border border-border-primary bg-background-primary px-2 py-2 shadow-xl animate-in slide-in-from-bottom-4 sm:bottom-6 sm:gap-2 sm:px-4 sm:py-3"
      >
        <div className="flex items-center gap-1 border-r border-border-primary pr-2 sm:gap-2 sm:pr-3">
          <span className="whitespace-nowrap text-xs text-text-secondary sm:text-sm">
            <span className="font-medium text-text-primary">{selectedCount}</span>{' '}
            <span className="hidden xs:inline">selected</span>
          </span>
          <button
            type="button"
            onClick={onClearSelection}
            disabled={isBusy}
            className="btn-ghost btn-xs min-h-9 min-w-9 p-1 sm:min-h-0 sm:min-w-0"
            title="Clear selection"
            aria-label="Clear selection"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="flex items-center gap-0.5 sm:gap-1">
          {actionButton('archive', 'Archive', Archive)}
          {actionButton('delete', 'Delete permanently', Trash2)}
        </div>
      </div>

      <ConfirmDialog
        isOpen={confirmAction === 'archive'}
        onClose={closeConfirmation}
        onConfirm={confirm}
        title={`Archive selected ${serviceLabel}?`}
        description={`This will remove the selected ${serviceLabel} from active Services lists. You can include archived services later.`}
        confirmLabel={`Archive ${serviceLabel}`}
        requireReason
        reasonLabel="Archive reason"
        reasonPlaceholder="Explain why these services are being archived"
        reasonMinLength={10}
        isLoading={isBusy && confirmAction === 'archive'}
      />
      <ConfirmDialog
        isOpen={confirmAction === 'delete'}
        onClose={closeConfirmation}
        onConfirm={confirm}
        title={`Permanently delete selected ${serviceLabel}?`}
        description={`This permanently removes the selected ${serviceLabel} and all related deadline and billing history. This cannot be undone.`}
        confirmLabel={`Delete ${serviceLabel} permanently`}
        requireReason
        reasonLabel="Deletion reason"
        reasonPlaceholder="Explain why these services and their history must be deleted"
        reasonMinLength={10}
        isLoading={isBusy && confirmAction === 'delete'}
      />
    </>
  );
}
