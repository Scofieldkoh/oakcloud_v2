'use client';

import { useState } from 'react';
import { CheckCircle2, CircleAlert, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useSharePointFilingSettings, useUpdateSharePointFilingSettings } from '@/hooks/use-sharepoint-folders';
import { SharePointFolderPicker, type SharePointFolderPickerValue } from './sharepoint-folder-picker';
import { SharePointFolderField } from './sharepoint-folder-field';
import { SharePointUnassignedQueue } from './sharepoint-unassigned-queue';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';

export function SharePointFilingSettings({ connectorId }: { connectorId: string }) {
  const settingsQuery = useSharePointFilingSettings(connectorId);
  const update = useUpdateSharePointFilingSettings();
  const [picker, setPicker] = useState<'client' | 'orphan' | null>(null);
  const [checking, setChecking] = useState(false);
  const confirmDialog = useConfirmDialog();
  const settings = settingsQuery.data as { connectorName?: string; deploymentEnabled?: boolean; enabled?: boolean; enabledAt?: string | null; lastVerifiedAt?: string | null; configVersion?: number; clientDocumentsRoot?: SharePointFolderPickerValue | null; orphanDocumentsFolder?: SharePointFolderPickerValue | null; canEnable?: boolean } | undefined;
  const save = async (input: Record<string, unknown>) => update.mutateAsync({ connectorId, ...input });
  const checkConnection = async () => {
    setChecking(true);
    try { await fetch(`/api/sharepoint/connection-status?connectorId=${encodeURIComponent(connectorId)}`).then(async (response) => { if (!response.ok) throw new Error((await response.json()).error || 'Connection check failed'); }); await settingsQuery.refetch(); } finally { setChecking(false); }
  };
  if (settingsQuery.isLoading) return <div className="rounded-xl border border-border-primary p-4 text-sm text-text-secondary">Loading SharePoint filing settings…</div>;
  if (settingsQuery.isError || !settings) return <div className="rounded-xl border border-status-error/30 bg-status-error/10 p-4 text-sm text-status-error">SharePoint filing settings are unavailable.</div>;
  const rootsReady = Boolean(settings.clientDocumentsRoot && settings.orphanDocumentsFolder);
  const deploymentBlocked = !settings.deploymentEnabled;
  const enabledDisabledReason = deploymentBlocked ? 'The deployment gate is off.' : !rootsReady ? 'Select and verify both folders first.' : undefined;
  const choose = (kind: 'client' | 'orphan') => setPicker(kind);
  const confirm = async (folder: SharePointFolderPickerValue) => {
    const input = picker === 'client' ? { clientDocumentsRoot: folder } : { orphanDocumentsFolder: folder };
    await save(input);
    setPicker(null);
  };
  return (
    <section className="space-y-4 rounded-xl border border-border-primary bg-background-secondary p-4 sm:p-5" aria-labelledby={`sharepoint-filing-${connectorId}`}>
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 id={`sharepoint-filing-${connectorId}`} className="text-sm font-semibold text-text-primary">Automatic signed-document filing</h3><p className="mt-1 text-xs text-text-secondary">Completed PDFs are filed into verified SharePoint folders. Historical envelopes are excluded.</p></div><Button variant="secondary" size="sm" onClick={checkConnection} isLoading={checking} leftIcon={<Link2 className="h-4 w-4" />}>Check connection</Button></div>
      <div className="grid gap-4 md:grid-cols-2"><SharePointFolderField label="Client Documents root" value={settings.clientDocumentsRoot} onSelect={() => choose('client')} onClear={() => void save({ clientDocumentsRoot: null })} disabled={update.isPending} /><SharePointFolderField label="Unassigned / review root" value={settings.orphanDocumentsFolder} onSelect={() => choose('orphan')} onClear={() => void save({ orphanDocumentsFolder: null })} disabled={update.isPending} /></div>
      <div className="flex flex-wrap items-start justify-between gap-4 border-t border-border-primary pt-4"><Checkbox label="Enable automatic signed-document filing" description={enabledDisabledReason ?? 'Newly completed envelopes only; changing roots disables filing and starts a new cutover.'} checked={settings.enabled ?? false} disabled={!settings.canEnable && !settings.enabled || update.isPending} onChange={async (event) => { const enabled = event.target.checked; if (enabled && !(await confirmDialog.confirm({ title: 'Enable automatic filing?', description: 'Newly completed envelopes will be filed to SharePoint. Historical envelopes will not be filed automatically.', confirmLabel: 'Enable filing', variant: 'info' }))) return; void save({ enabled }); }} /><div className="text-xs text-text-muted">{settings.enabled ? <span className="inline-flex items-center gap-1 text-status-success"><CheckCircle2 className="h-3.5 w-3.5" />Enabled {settings.enabledAt ? `from ${new Date(settings.enabledAt).toLocaleString()}` : ''}</span> : <span className="inline-flex items-center gap-1"><CircleAlert className="h-3.5 w-3.5" />Disabled · config v{settings.configVersion ?? 1}</span>}</div></div>
      <SharePointFolderPicker isOpen={picker !== null} onCancel={() => setPicker(null)} connectorId={connectorId} mode="browse" currentValue={picker === 'client' ? settings.clientDocumentsRoot : settings.orphanDocumentsFolder} onConfirm={confirm} allowCreate />
      <SharePointUnassignedQueue connectorId={connectorId} />
      {confirmDialog.dialog}
    </section>
  );
}
