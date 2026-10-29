'use client';

import { useRef, useState, type ReactNode } from 'react';
import { format } from 'date-fns';
import { CloudUpload, Download, ExternalLink, FileArchive, Plus, RefreshCw, RotateCcw, Square, Trash2, Upload } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Pagination } from '@/components/ui/pagination';
import { StatusBadge, type StatusType } from '@/components/ui/status-badge';
import {
  TableBody,
  TableCell,
  TableEmptyState,
  TableHead,
  TableHeaderCell,
  TableHeaderRow,
  TableRoot,
  TableRow,
  TableShell,
  TableViewport,
} from '@/components/ui/data-table';
import { MobileCard, CardDetailsGrid, CardDetailItem } from '@/components/ui/responsive-table';
import { useToast } from '@/components/ui/toast';
import {
  formatBytes,
  getBackupStatusLabel,
  fullBackupDownloadUrl,
  isRunning,
  useBackupSettings,
  useCopyBackupToSharePoint,
  useCreateFullBackup,
  useDeleteFullBackup,
  useFullBackups,
  useSharePointBackupTarget,
  useStopFullBackup,
  useUploadFullBackup,
  type SystemBackup,
} from '@/hooks/use-full-backup';
import { cn } from '@/lib/utils';
import { BackupPasswordCard } from './backup-password-card';
import { FullBackupScheduleCard } from './full-backup-schedule-card';
import { FullRestoreModal } from './full-restore-modal';
import { SharePointBackupCard } from './sharepoint-backup-card';

const SOURCE_LABELS: Record<SystemBackup['source'], string> = {
  MANUAL: 'Manual',
  SCHEDULED: 'Scheduled',
  UPLOADED: 'Uploaded',
};

/** Stop marks a backup FAILED with this step; it is shown as stopped, not as an error. */
function isStopped(backup: SystemBackup): boolean {
  return backup.status === 'FAILED' && backup.currentStep === 'Stopped';
}

function statusLabel(backup: SystemBackup): string {
  return isStopped(backup) ? 'Stopped' : getBackupStatusLabel(backup.status);
}

function statusBadge(backup: SystemBackup): StatusType {
  if (isStopped(backup)) return 'inactive';
  if (backup.status === 'FAILED') return 'failed';
  if (isRunning(backup.status)) return 'pending';
  return 'success';
}

function canUse(backup: SystemBackup): boolean {
  return Boolean(backup.archiveKey) && (backup.status === 'COMPLETED' || backup.status === 'RESTORED');
}

function Progress({ backup }: { backup: SystemBackup }) {
  if (!isRunning(backup.status)) {
    const note = backup.errorMessage || (backup.currentStep && !['Completed', 'Restored'].includes(backup.currentStep) ? backup.currentStep : null);
    return note ? (
      <div className={cn('text-xs mt-1 line-clamp-2', backup.errorMessage && !isStopped(backup) ? 'text-status-error' : 'text-text-tertiary')}>{note}</div>
    ) : null;
  }
  return (
    <div className="mt-1">
      <div className="w-full h-1.5 bg-background-tertiary rounded-full overflow-hidden">
        <div className="h-full bg-accent-primary transition-all duration-300" style={{ width: `${backup.progress}%` }} />
      </div>
      <div className="text-xs text-text-tertiary mt-0.5">{backup.currentStep || `${backup.progress}%`}</div>
    </div>
  );
}

function SharePointCopy({ backup }: { backup: SystemBackup }) {
  if (backup.sharePointStatus === 'UPLOADED') {
    return backup.sharePointWebUrl ? (
      <a
        href={backup.sharePointWebUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-xs text-oak-primary hover:underline"
      >
        Copied
        <ExternalLink className="h-3 w-3" aria-hidden="true" />
      </a>
    ) : (
      <span className="text-xs text-text-secondary">Copied</span>
    );
  }
  if (backup.sharePointStatus === 'UPLOADING') return <span className="text-xs text-text-secondary">Copying…</span>;
  if (backup.sharePointStatus === 'FAILED') {
    return <span className="text-xs text-status-error line-clamp-2" title={backup.sharePointError ?? undefined}>{backup.sharePointError || 'Copy failed'}</span>;
  }
  return <span className="text-xs text-text-tertiary">-</span>;
}

export function FullBackupsPanel() {
  const { success, error: showError } = useToast();
  const [page, setPage] = useState(1);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<SystemBackup | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SystemBackup | null>(null);
  const [stopTarget, setStopTarget] = useState<SystemBackup | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const { data, isLoading, isFetching, error, refetch } = useFullBackups(page);
  const { data: settings } = useBackupSettings();
  const createBackup = useCreateFullBackup();
  const deleteBackup = useDeleteFullBackup();
  const stopBackup = useStopFullBackup();
  const uploadBackup = useUploadFullBackup(setUploadProgress);
  const copyToSharePoint = useCopyBackupToSharePoint();
  const { data: sharePoint } = useSharePointBackupTarget();
  const hasSharePointTarget = Boolean(sharePoint?.target);

  const backups = data?.backups ?? [];
  const anyRunning = backups.some((backup) => isRunning(backup.status) && backup.source !== 'UPLOADED');

  const startBackup = async () => {
    try {
      await createBackup.mutateAsync({});
      success('Full backup started');
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to start the backup');
    }
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploadProgress(0);
    try {
      await uploadBackup.mutateAsync(file);
      success('Backup file uploaded. Use Restore to check and restore it.');
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploadProgress(null);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteBackup.mutateAsync(deleteTarget.id);
      success('Backup deleted');
      setDeleteTarget(null);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to delete the backup');
    }
  };

  const confirmStop = async () => {
    if (!stopTarget) return;
    try {
      await stopBackup.mutateAsync(stopTarget.id);
      success('Backup stopped');
      setStopTarget(null);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to stop the backup');
    }
  };

  const copy = async (backup: SystemBackup) => {
    try {
      await copyToSharePoint.mutateAsync(backup.id);
      success('Copying the backup to SharePoint');
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to copy the backup to SharePoint');
    }
  };

  const rowActions = (backup: SystemBackup): ReactNode => (
    <div className="flex items-center justify-end gap-1">
      {canUse(backup) && (
        <>
          <a href={fullBackupDownloadUrl(backup.id)} download aria-label="Download backup file" title="Download">
            <Button variant="ghost" size="sm" tabIndex={-1}><Download className="w-4 h-4" /></Button>
          </a>
          <Button variant="ghost" size="sm" onClick={() => setRestoreTarget(backup)} aria-label="Restore backup" title="Restore">
            <RotateCcw className="w-4 h-4" />
          </Button>
          {hasSharePointTarget && backup.sharePointStatus !== 'UPLOADED' && backup.sharePointStatus !== 'UPLOADING' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => copy(backup)}
              disabled={copyToSharePoint.isPending}
              aria-label="Copy backup to SharePoint"
              title="Copy to SharePoint"
            >
              <CloudUpload className="w-4 h-4" />
            </Button>
          )}
        </>
      )}
      {backup.source !== 'UPLOADED' && (backup.status === 'PENDING' || backup.status === 'IN_PROGRESS') && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setStopTarget(backup)}
          aria-label="Stop backup"
          title="Stop"
          className="text-status-error hover:text-status-error"
        >
          <Square className="w-4 h-4" />
        </Button>
      )}
      {!isRunning(backup.status) && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setDeleteTarget(backup)}
          aria-label="Delete backup"
          title="Delete"
          className="text-status-error hover:text-status-error"
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      )}
    </div>
  );

  const details = (backup: SystemBackup) => ({
    size: backup.sizeBytes ? formatBytes(backup.sizeBytes) : '-',
    records: backup.rowsCount ? backup.rowsCount.toLocaleString() : '-',
    files: backup.rowsCount || backup.filesCount ? backup.filesCount.toLocaleString() : '-',
    created: format(new Date(backup.createdAt), 'dd MMM yyyy HH:mm'),
  });

  return (
    <div className="space-y-4">
      <Alert variant="info" compact>
        A full backup holds everything: every workspace, user, company, document, template, setting and connector,
        plus all stored files. Download it (or upload it on another machine) to move Oakcloud. Also keep a safe copy of
        your <code>.env</code> file: email, AI keys and the tunnel token live there, not in the database.
      </Alert>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <BackupPasswordCard settings={settings} />
        <FullBackupScheduleCard settings={settings} />
      </div>
      <SharePointBackupCard />

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={cn('w-4 h-4 mr-1', isFetching && 'animate-spin')} />
          Refresh
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept=".oakbackup"
          className="hidden"
          onChange={(event) => upload(event.target.files?.[0])}
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={() => fileInput.current?.click()}
          disabled={uploadProgress !== null}
          isLoading={uploadProgress !== null}
        >
          <Upload className="w-4 h-4 mr-1" />
          {uploadProgress !== null ? `Uploading ${Math.round(uploadProgress * 100)}%` : 'Upload backup file'}
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={startBackup}
          disabled={!settings?.hasPassword || anyRunning}
          isLoading={createBackup.isPending}
        >
          <Plus className="w-4 h-4 mr-1" />
          Back up now
        </Button>
      </div>

      {error && <Alert variant="error">{error instanceof Error ? error.message : 'Failed to load backups'}</Alert>}

      <div className="md:hidden space-y-3">
        {!isLoading && backups.length === 0 && (
          <EmptyState icon={FileArchive} title="No full backups yet" description="Set a backup password, then back up now." />
        )}
        {backups.map((backup) => {
          const info = details(backup);
          return (
            <MobileCard
              key={backup.id}
              title={<span className="font-medium text-text-primary">{backup.name}</span>}
              subtitle={<span className="text-xs text-text-tertiary">{SOURCE_LABELS[backup.source]}</span>}
              badge={<StatusBadge status={statusBadge(backup)} label={statusLabel(backup)} size="xs" />}
              actions={rowActions(backup)}
              details={
                <>
                  <Progress backup={backup} />
                  <CardDetailsGrid>
                    <CardDetailItem label="Size" value={info.size} />
                    <CardDetailItem label="Records" value={info.records} />
                    <CardDetailItem label="Files" value={info.files} />
                    <CardDetailItem label="Created" value={info.created} />
                    <CardDetailItem label="SharePoint" value={<SharePointCopy backup={backup} />} />
                  </CardDetailsGrid>
                </>
              }
            />
          );
        })}
      </div>

      <TableShell className="hidden md:block" isFetching={isFetching && !isLoading}>
        <TableViewport>
          <TableRoot>
            <TableHead>
              <TableHeaderRow hasFilters={false}>
                <TableHeaderCell label="Backup" />
                <TableHeaderCell label="Status" />
                <TableHeaderCell label="Size" />
                <TableHeaderCell label="Records" />
                <TableHeaderCell label="Files" />
                <TableHeaderCell label="Created" />
                <TableHeaderCell label="SharePoint" />
                <TableHeaderCell label="Actions" align="right" />
              </TableHeaderRow>
            </TableHead>
            <TableBody>
              {!isLoading && backups.length === 0 && (
                <TableEmptyState
                  colSpan={8}
                  message={<EmptyState icon={FileArchive} title="No full backups yet" description="Set a backup password, then back up now." />}
                />
              )}
              {backups.map((backup, index) => {
                const info = details(backup);
                return (
                  <TableRow key={backup.id} index={index}>
                    <TableCell>
                      <div className="font-medium">{backup.name}</div>
                      <div className="text-xs text-text-tertiary">{SOURCE_LABELS[backup.source]}</div>
                    </TableCell>
                    <TableCell className="min-w-[14rem]">
                      <StatusBadge status={statusBadge(backup)} label={statusLabel(backup)} size="xs" />
                      <Progress backup={backup} />
                    </TableCell>
                    <TableCell>{info.size}</TableCell>
                    <TableCell>{info.records}</TableCell>
                    <TableCell>{info.files}</TableCell>
                    <TableCell>{info.created}</TableCell>
                    <TableCell className="max-w-[12rem]"><SharePointCopy backup={backup} /></TableCell>
                    <TableCell>{rowActions(backup)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </TableRoot>
        </TableViewport>
      </TableShell>

      {(data?.totalPages ?? 1) > 1 && (
        <Pagination page={page} totalPages={data?.totalPages ?? 1} total={data?.totalCount ?? 0} limit={20} onPageChange={setPage} />
      )}

      <FullRestoreModal backup={restoreTarget} onClose={() => setRestoreTarget(null)} />
      <ConfirmDialog
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Delete full backup"
        description={`Delete "${deleteTarget?.name}"? Its backup file is removed from this machine. Copies you downloaded or copied to SharePoint are not affected.`}
        confirmLabel="Delete"
        variant="danger"
        isLoading={deleteBackup.isPending}
      />
      <ConfirmDialog
        isOpen={stopTarget !== null}
        onClose={() => setStopTarget(null)}
        onConfirm={confirmStop}
        title="Stop backup"
        description={`Stop "${stopTarget?.name}"? The half-made backup is thrown away and nothing in Oakcloud changes. You can start a new backup straight after.`}
        confirmLabel="Stop backup"
        variant="danger"
        isLoading={stopBackup.isPending}
      />
    </div>
  );
}
