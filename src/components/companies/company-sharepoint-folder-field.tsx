'use client';

import { useContext, useState } from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useConnectors } from '@/hooks/use-connectors';
import { useSharePointFilingSettings } from '@/hooks/use-sharepoint-folders';
import { SharePointFolderField } from '@/components/connectors/sharepoint/sharepoint-folder-field';
import { SharePointFolderPicker, type SharePointFolderPickerValue } from '@/components/connectors/sharepoint/sharepoint-folder-picker';
import { getCompanyFolderSearchTerm } from '@/lib/sharepoint/company-folder-search';
import type { CompanyWithRelations } from '@/services/company/types';

export function CompanySharePointFolderField({ company, canEdit = false }: { company: CompanyWithRelations; canEdit?: boolean }) {
  const queryClient = useContext(QueryClientContext);
  if (!queryClient) return null;
  return <CompanySharePointFolderFieldWithQuery company={company} canEdit={canEdit} />;
}

function CompanySharePointFolderFieldWithQuery({ company, canEdit = false }: { company: CompanyWithRelations; canEdit?: boolean }) {
  const mapping = company.sharePointFolderMapping;
  const mappingValue = mapping ? { driveId: mapping.driveId, itemId: mapping.folderItemId, name: mapping.folderName, webUrl: mapping.folderWebUrl } : null;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const connectorsQuery = useConnectors({ provider: 'SHAREPOINT', isEnabled: true, includeSystem: false, limit: 100 });
  const connectorId = mapping?.connectorId ?? connectorsQuery.data?.connectors.find((connector) => connector.workspaceId)?.id;
  const settingsQuery = useSharePointFilingSettings(connectorId);
  const save = async (url: string, options?: RequestInit) => {
    const response = await fetch(url, options);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'SharePoint mapping update failed');
    return body.folder;
  };
  const selectedSettings = settingsQuery.data as { clientDocumentsRoot?: SharePointFolderPickerValue | null } | undefined;
  const value = mappingValue;
  const select = async (folder: SharePointFolderPickerValue) => {
    if (!connectorId) return;
    setMessage(null);
    try { await save(`/api/companies/${company.id}/sharepoint-folder`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ connectorId, folder }) }); setPickerOpen(false); window.location.reload(); } catch (error) { setMessage(error instanceof Error ? error.message : 'SharePoint mapping update failed'); }
  };
  const clear = async () => {
    setMessage(null);
    try { await save(`/api/companies/${company.id}/sharepoint-folder`, { method: 'DELETE' }); window.location.reload(); } catch (error) { setMessage(error instanceof Error ? error.message : 'SharePoint mapping removal failed'); }
  };
  const verify = async () => {
    setMessage(null);
    try { await save(`/api/companies/${company.id}/sharepoint-folder/verify`, { method: 'POST' }); window.location.reload(); } catch (error) { setMessage(error instanceof Error ? error.message : 'SharePoint mapping verification failed'); }
  };
  return <div className="border-t border-border-primary p-3"><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><span className="text-[11px] font-medium uppercase tracking-wide text-text-secondary">SharePoint company folder</span>{mapping?.lastVerifiedAt && <span className="inline-flex items-center gap-1 text-xs text-status-success"><CheckCircle2 className="h-3.5 w-3.5" />Verified {new Date(String(mapping.lastVerifiedAt)).toLocaleDateString()}</span>}</div>{value ? <SharePointFolderField label="" value={value} onSelect={() => setPickerOpen(true)} onClear={canEdit ? clear : undefined} disabled={!canEdit} /> : canEdit ? <Button variant="secondary" size="sm" onClick={() => setPickerOpen(true)} disabled={!connectorId || !selectedSettings?.clientDocumentsRoot}>Select company folder</Button> : <p className="text-sm text-text-secondary">No SharePoint folder mapped.</p>}{mapping?.lastVerifiedAt === null && <div className="mt-2 flex items-center gap-2 text-xs text-amber-600"><AlertTriangle className="h-3.5 w-3.5" />Mapping needs verification.<Button variant="ghost" size="xs" onClick={verify} disabled={!canEdit}>Verify</Button></div>}{message && <p className="mt-2 text-sm text-status-error">{message}</p>}<SharePointFolderPicker isOpen={pickerOpen} onCancel={() => setPickerOpen(false)} connectorId={connectorId ?? ''} mode="client-folder" initialSearch={getCompanyFolderSearchTerm(company.name)} fixedRoot={selectedSettings?.clientDocumentsRoot} currentValue={value} companyName={company.name} allowCreate onConfirm={select} /></div>;
}
