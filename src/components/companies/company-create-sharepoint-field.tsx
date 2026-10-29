'use client';

import { useContext, useState } from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import { CheckCircle2, FolderOpen } from 'lucide-react';
import { FormInput } from '@/components/ui/form-input';
import { Button } from '@/components/ui/button';
import { useConnectors } from '@/hooks/use-connectors';
import { useSharePointFilingSettings } from '@/hooks/use-sharepoint-folders';
import { SharePointFolderPicker, type SharePointFolderPickerValue } from '@/components/connectors/sharepoint/sharepoint-folder-picker';

export type PendingSharePointSelection =
  | { kind: 'unmapped' }
  | { kind: 'selected'; connectorId: string; folder: SharePointFolderPickerValue }
  | { kind: 'requested'; connectorId: string; name: string };

export function CompanyCreateSharePointField({ onChange }: { onChange: (selection: PendingSharePointSelection) => void }) {
  const queryClient = useContext(QueryClientContext);
  if (!queryClient) return null;
  return <CompanyCreateSharePointFieldWithQuery onChange={onChange} />;
}

function CompanyCreateSharePointFieldWithQuery({ onChange }: { onChange: (selection: PendingSharePointSelection) => void }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [requestedName, setRequestedName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [selection, setSelection] = useState<PendingSharePointSelection>({ kind: 'unmapped' });
  const connectorsQuery = useConnectors({ provider: 'SHAREPOINT', isEnabled: true, includeSystem: false, limit: 100 });
  const connector = connectorsQuery.data?.connectors.find((item) => item.workspaceId);
  const settingsQuery = useSharePointFilingSettings(connector?.id);
  const settings = settingsQuery.data as { clientDocumentsRoot?: SharePointFolderPickerValue | null } | undefined;
  const update = (next: PendingSharePointSelection) => { setSelection(next); onChange(next); };
  return <section aria-label="Company folder" className="space-y-3 border-t border-border-primary pt-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-semibold text-text-primary">Company folder <span className="font-normal text-text-tertiary">(optional)</span></h3>
      <span className="text-xs text-text-secondary">SharePoint</span>
    </div>
    {selection.kind === 'selected' ? (
      <div className="flex flex-col gap-3 rounded-xl border border-status-success/30 bg-status-success/10 p-3 text-sm shadow-elevation-1 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3" role="status">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-status-success/15 text-status-success" aria-hidden="true">
            <FolderOpen className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-text-primary">
              <CheckCircle2 className="h-3.5 w-3.5 text-status-success" aria-hidden="true" />
              Selected company folder
            </div>
            <span className="mt-0.5 block break-words font-medium text-text-primary">{selection.folder.name}</span>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
          <Button variant="secondary" size="sm" onClick={() => setPickerOpen(true)}>Change</Button>
          <Button variant="ghost" size="sm" onClick={() => update({ kind: 'unmapped' })}>Clear</Button>
        </div>
      </div>
    ) : selection.kind === 'requested' ? (
      <div className="flex items-center justify-between gap-2 rounded-md bg-background-secondary p-3 text-xs">
        <span className="min-w-0 break-words text-text-primary">{selection.name}<span className="ml-2 text-text-secondary">New folder</span></span>
        <Button variant="ghost" size="xs" onClick={() => update({ kind: 'unmapped' })}>Clear</Button>
      </div>
    ) : null}
    <div className="flex flex-wrap gap-2">
      {selection.kind !== 'selected' && <Button variant="secondary" size="sm" onClick={() => setPickerOpen(true)} disabled={!connector?.id || !settings?.clientDocumentsRoot}>Select existing</Button>}
      <Button variant="secondary" size="sm" onClick={() => setCreatingFolder(true)} disabled={!connector} aria-expanded={creatingFolder}>New folder</Button>
    </div>
    {creatingFolder && <div className="space-y-2">
      <FormInput label="Folder name" value={requestedName} onChange={(event) => setRequestedName(event.target.value)} placeholder="Company folder name" inputSize="sm" />
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => {
          if (!requestedName.trim() || !connector) return;
          update({ kind: 'requested', connectorId: connector.id, name: requestedName.trim() });
          setCreatingFolder(false);
        }} disabled={!requestedName.trim() || !connector}>Use new folder</Button>
        <Button variant="ghost" size="sm" onClick={() => setCreatingFolder(false)}>Cancel</Button>
      </div>
    </div>}
    <SharePointFolderPicker isOpen={pickerOpen} onCancel={() => setPickerOpen(false)} connectorId={connector?.id ?? ''} mode="client-folder" fixedRoot={settings?.clientDocumentsRoot} onConfirm={(folder) => { update({ kind: 'selected', connectorId: connector!.id, folder }); setPickerOpen(false); setCreatingFolder(false); }} />
  </section>;
}
