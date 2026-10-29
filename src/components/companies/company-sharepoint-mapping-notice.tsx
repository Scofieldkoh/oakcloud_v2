'use client';

import { useState } from 'react';
import { AlertTriangle, ExternalLink, FolderOpen } from 'lucide-react';
import { useConnectors } from '@/hooks/use-connectors';
import { usePermissions } from '@/hooks/use-permissions';
import { useCompanySharePointFolder, useSetCompanySharePointFolder, useSharePointFilingSettings } from '@/hooks/use-sharepoint-folders';
import { SharePointFolderPicker, type SharePointFolderPickerValue } from '@/components/connectors/sharepoint/sharepoint-folder-picker';
import { useToast } from '@/components/ui/toast';
import { getCompanyFolderSearchTerm } from '@/lib/sharepoint/company-folder-search';

interface CompanySharePointMappingNoticeProps {
  companyId: string;
  companyName?: string | null;
}

interface FilingSettings {
  enabled?: boolean;
  clientDocumentsRoot?: SharePointFolderPickerValue | null;
}

/**
 * One-line SharePoint folder status for a selected company. Warns when the
 * company has no folder mapping and lets the user map one in place, using the
 * same picker and API as the company profile.
 */
export function CompanySharePointMappingNotice({ companyId, companyName }: CompanySharePointMappingNoticeProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const { success, error: showError } = useToast();
  const { can } = usePermissions(companyId);
  const connectorsQuery = useConnectors({ provider: 'SHAREPOINT', isEnabled: true, includeSystem: false, limit: 100 });
  const mappingQuery = useCompanySharePointFolder(companyId);
  const mapping = mappingQuery.data;
  const connectorId = mapping?.connectorId ?? connectorsQuery.data?.connectors.find((connector) => connector.workspaceId)?.id;
  const settingsQuery = useSharePointFilingSettings(connectorId);
  const settings = settingsQuery.data as FilingSettings | undefined;
  const setMapping = useSetCompanySharePointFolder();

  if (mappingQuery.isLoading || mappingQuery.isError) return null;
  // No SharePoint connector in this workspace: a folder mapping means nothing yet.
  if (connectorsQuery.isSuccess && !connectorId) return null;

  if (mapping) {
    return (
      <p className="flex min-w-0 items-center gap-1.5 text-xs text-text-muted">
        <FolderOpen className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="shrink-0">SharePoint folder:</span>
        <a
          href={mapping.folderWebUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-w-0 items-center gap-1 font-medium text-oak-primary hover:underline"
        >
          <span className="truncate">{mapping.folderName}</span>
          <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
        </a>
      </p>
    );
  }

  const clientDocumentsRoot = settings?.clientDocumentsRoot ?? null;
  const canMap = Boolean(can.updateCompany && connectorId && clientDocumentsRoot);
  const consequence = settings?.enabled
    ? 'Signed documents will be filed to the unassigned folder.'
    : 'Signed documents cannot be filed to its SharePoint folder.';
  let hint: string | null = null;
  if (!can.updateCompany) {
    hint = 'Ask someone who can edit this company to map it.';
  } else if (settingsQuery.isSuccess && !clientDocumentsRoot) {
    hint = 'Set the Client Documents root in SharePoint connector settings first.';
  }

  const select = async (folder: SharePointFolderPickerValue) => {
    if (!connectorId) return;
    try {
      await setMapping.mutateAsync({ companyId, connectorId, folder });
      setPickerOpen(false);
      success(`SharePoint folder mapped to ${folder.name}`);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'SharePoint mapping update failed');
    }
  };

  return (
    <div className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400" role="status">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <p className="min-w-0">
        No SharePoint folder is mapped for this company. {consequence}{' '}
        {canMap ? (
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            disabled={setMapping.isPending}
            className="font-medium text-oak-primary underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-oak-primary/30 disabled:opacity-50"
          >
            {setMapping.isPending ? 'Saving…' : 'Map folder'}
          </button>
        ) : hint ? (
          <span className="text-text-muted">{hint}</span>
        ) : null}
      </p>
      {canMap && connectorId ? (
        <SharePointFolderPicker
          isOpen={pickerOpen}
          onCancel={() => setPickerOpen(false)}
          connectorId={connectorId}
          mode="client-folder"
          initialSearch={companyName ? getCompanyFolderSearchTerm(companyName) : ''}
          fixedRoot={clientDocumentsRoot}
          companyName={companyName ?? undefined}
          allowCreate
          onConfirm={(folder) => void select(folder)}
        />
      ) : null}
    </div>
  );
}
