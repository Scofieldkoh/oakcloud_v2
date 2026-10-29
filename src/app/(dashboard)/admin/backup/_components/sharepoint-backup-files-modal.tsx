'use client';

import { format } from 'date-fns';
import { ExternalLink, FileArchive, Loader2 } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { formatBytes, useImportSharePointBackup, useSharePointBackupFiles } from '@/hooks/use-full-backup';

/** Lists the backup files in the SharePoint folder and copies one onto this machine to restore. */
export function SharePointBackupFilesModal({
  isOpen,
  onClose,
  folderName,
}: {
  isOpen: boolean;
  onClose: () => void;
  folderName?: string;
}) {
  const { success, error: showError } = useToast();
  const { data, isLoading, error } = useSharePointBackupFiles(isOpen);
  const importBackup = useImportSharePointBackup();
  const files = data?.files ?? [];

  const copyHere = async (itemId: string) => {
    try {
      await importBackup.mutateAsync(itemId);
      success('Copying the backup from SharePoint. When it shows as Completed below, use Restore.');
      onClose();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to copy the backup from SharePoint');
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Restore from SharePoint"
      description={folderName ? `Backup files in "${folderName}", newest first.` : undefined}
      size="lg"
    >
      <ModalBody>
        <div className="space-y-3">
          <p className="text-sm text-text-secondary">
            Copy a backup onto this machine first. It then appears in the backups list, where Restore checks it with the
            backup password before anything is replaced.
          </p>
          {error && <Alert variant="error" compact>{error instanceof Error ? error.message : 'Could not list SharePoint backups'}</Alert>}
          {isLoading && (
            <div className="flex items-center gap-2 py-6 text-sm text-text-secondary">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading backup files…
            </div>
          )}
          {!isLoading && !error && files.length === 0 && (
            <EmptyState icon={FileArchive} title="No backup files in this folder" description="Full backups appear here after they are copied to SharePoint." />
          )}
          {files.length > 0 && (
          <div className="max-h-80 overflow-y-auto divide-y divide-border-primary rounded-lg border border-border-primary">
            {files.map((file) => (
              <div key={file.itemId} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <a
                    href={file.webUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex max-w-full items-center gap-1 text-sm font-medium text-text-primary hover:underline"
                  >
                    <span className="truncate">{file.name}</span>
                    <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                  </a>
                  <div className="text-xs text-text-tertiary">
                    {formatBytes(file.size)}
                    {file.createdAt ? ` · ${format(new Date(file.createdAt), 'dd MMM yyyy HH:mm')}` : ''}
                  </div>
                </div>
                {file.backupId ? (
                  <span className="text-xs text-text-secondary whitespace-nowrap">Already on this machine</span>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="whitespace-nowrap"
                    onClick={() => copyHere(file.itemId)}
                    disabled={importBackup.isPending}
                  >
                    Copy here
                  </Button>
                )}
              </div>
            ))}
          </div>
          )}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
      </ModalFooter>
    </Modal>
  );
}
