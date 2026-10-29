'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CloudUpload, DownloadCloud } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormInput } from '@/components/ui/form-input';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { SharePointFolderField } from '@/components/connectors/sharepoint/sharepoint-folder-field';
import { SharePointFolderPicker, type SharePointFolderPickerValue } from '@/components/connectors/sharepoint/sharepoint-folder-picker';
import {
  useClearSharePointBackupTarget,
  useSaveSharePointBackupTarget,
  useSharePointBackupTarget,
} from '@/hooks/use-full-backup';
import { SharePointBackupFilesModal } from './sharepoint-backup-files-modal';

const FOLDERS_ENDPOINT = '/api/admin/backup/sharepoint/folders';

export function SharePointBackupCard() {
  const { success, error: showError } = useToast();
  const { data, isLoading } = useSharePointBackupTarget();
  const saveTarget = useSaveSharePointBackupTarget();
  const clearTarget = useClearSharePointBackupTarget();
  const [connectorId, setConnectorId] = useState('');
  const [folder, setFolder] = useState<SharePointFolderPickerValue | null>(null);
  const [maxBackups, setMaxBackups] = useState('30');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);

  const target = data?.target ?? null;
  const connectors = data?.connectors ?? [];

  useEffect(() => {
    if (!data) return;
    setConnectorId(data.target?.connectorId ?? data.connectors[0]?.id ?? '');
    setFolder(data.target
      ? { driveId: data.target.driveId, itemId: data.target.folderId, name: data.target.folderName, webUrl: data.target.folderUrl }
      : null);
    setMaxBackups(String(data.target?.maxBackups ?? 30));
  }, [data]);

  const keep = Number(maxBackups);
  const keepValid = Number.isInteger(keep) && keep >= 1 && keep <= 365;
  const dirty = Boolean(folder) && (
    !target || target.connectorId !== connectorId || target.folderId !== folder?.itemId || target.maxBackups !== keep
  );

  const save = async () => {
    if (!folder) return;
    try {
      await saveTarget.mutateAsync({ connectorId, folderId: folder.itemId, maxBackups: keep });
      success('SharePoint backup folder saved. New full backups are copied there.');
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to save the SharePoint folder');
    }
  };

  const clear = async () => {
    try {
      await clearTarget.mutateAsync();
      success('Backups are no longer copied to SharePoint');
      setConfirmClear(false);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to stop SharePoint copies');
    }
  };

  const connectorOptions = connectors.map((connector) => ({
    value: connector.id,
    label: connector.name,
    description: connector.workspaceName ? `Workspace: ${connector.workspaceName}` : undefined,
  }));

  return (
    <div className="bg-background-secondary rounded-lg border border-border-primary p-4">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
        <div className="flex items-start gap-3">
          <CloudUpload className="w-5 h-5 text-text-secondary mt-0.5" />
          <div>
            <div className="text-sm font-medium text-text-primary">SharePoint copy</div>
            <div className="text-xs text-text-secondary mt-0.5">
              {target
                ? `Every full backup is copied to this folder. The newest ${target.maxBackups} Oakcloud backup files are kept there.`
                : 'Pick a SharePoint folder to keep a cloud copy of every full backup.'}
            </div>
          </div>
        </div>
        {target && (
          <Button variant="secondary" size="sm" className="shrink-0 whitespace-nowrap" onClick={() => setFilesOpen(true)}>
            <DownloadCloud className="w-4 h-4 mr-1" />
            Restore from SharePoint
          </Button>
        )}
      </div>

      {!isLoading && connectors.length === 0 ? (
        <p className="text-sm text-text-secondary">
          Add a SharePoint connector for a workspace on the{' '}
          <Link href="/admin/connectors" className="text-oak-primary hover:underline">Connectors</Link> page first.
          On a new machine, add it there before restoring from SharePoint.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-[minmax(12rem,1fr)_minmax(14rem,2fr)_minmax(8rem,10rem)] gap-3 items-end">
            <SearchableSelect
              label="Connector"
              options={connectorOptions}
              value={connectorId}
              onChange={(value) => {
                setConnectorId(value);
                if (value !== connectorId) setFolder(null);
              }}
              size="sm"
              loading={isLoading}
            />
            <SharePointFolderField
              label="Backup folder"
              value={folder}
              onSelect={() => setPickerOpen(true)}
              onClear={target ? () => setConfirmClear(true) : undefined}
              disabled={!connectorId}
              size="sm"
            />
            <FormInput
              label="Keep the newest"
              type="number"
              min={1}
              max={365}
              inputSize="sm"
              value={maxBackups}
              onChange={(event) => setMaxBackups(event.target.value)}
              error={keepValid ? undefined : 'Between 1 and 365'}
            />
          </div>
          <div className="flex justify-end mt-3">
            <Button variant="secondary" size="sm" onClick={save} disabled={!dirty || !keepValid} isLoading={saveTarget.isPending}>
              Save folder
            </Button>
          </div>
        </>
      )}

      {connectorId && (
        <SharePointFolderPicker
          isOpen={pickerOpen}
          connectorId={connectorId}
          currentValue={folder}
          allowCreate
          suggestedFolderName="Oakcloud backups"
          foldersEndpoint={FOLDERS_ENDPOINT}
          onClose={() => setPickerOpen(false)}
          onConfirm={(value) => {
            setFolder(value);
            setPickerOpen(false);
          }}
        />
      )}
      <SharePointBackupFilesModal isOpen={filesOpen} onClose={() => setFilesOpen(false)} folderName={target?.folderName} />
      <ConfirmDialog
        isOpen={confirmClear}
        onClose={() => setConfirmClear(false)}
        onConfirm={clear}
        title="Stop copying to SharePoint"
        description="New full backups will stay on this machine only. Backup files already in SharePoint are left there."
        confirmLabel="Stop copying"
        isLoading={clearTarget.isPending}
      />
    </div>
  );
}
