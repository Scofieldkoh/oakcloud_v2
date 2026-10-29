import { parseSharePointRelativeFolderPath, SharePointRelativeFolderPathError } from '@/lib/sharepoint/relative-folder-path';
import type { SharePointFolderRef } from '@/lib/sharepoint/folder-reference';
import type { FilingRouteSnapshot } from './types';

export interface RouteSelectionInput {
  connectorId: string;
  configVersion: number;
  companyId?: string | null;
  companyName?: string | null;
  mapping?: { connectorId: string; driveId: string; folderItemId: string } | null;
  templateId?: string | null;
  templateVersion?: number | null;
  relativePath?: string | null;
  orphanFolder: SharePointFolderRef;
}

export function snapshotFilingRoute(input: RouteSelectionInput): FilingRouteSnapshot {
  const orphan = {
    orphanDriveId: input.orphanFolder.driveId,
    orphanFolderItemId: input.orphanFolder.itemId,
  };
  if (!input.mapping) {
    return { ...orphan, destinationKind: 'ORPHAN', routingReason: 'NO_COMPANY_MAPPING', connectorId: input.connectorId, configVersion: input.configVersion, companyId: input.companyId ?? null, companyNameSnapshot: input.companyName ?? null, templateId: input.templateId ?? null, templateVersion: input.templateVersion ?? null, intendedCompanyDriveId: null, intendedCompanyFolderId: null, intendedRelativePath: null };
  }
  if (input.mapping.connectorId !== input.connectorId) {
    return { ...orphan, destinationKind: 'ORPHAN', routingReason: 'COMPANY_FOLDER_UNAVAILABLE', connectorId: input.connectorId, configVersion: input.configVersion, companyId: input.companyId ?? null, companyNameSnapshot: input.companyName ?? null, templateId: input.templateId ?? null, templateVersion: input.templateVersion ?? null, intendedCompanyDriveId: input.mapping.driveId, intendedCompanyFolderId: input.mapping.folderItemId, intendedRelativePath: null };
  }
  if (!input.templateId) {
    return { ...orphan, destinationKind: 'INTENDED', routingReason: 'MANUAL_DOCUMENT', connectorId: input.connectorId, configVersion: input.configVersion, companyId: input.companyId ?? null, companyNameSnapshot: input.companyName ?? null, templateId: null, templateVersion: null, intendedCompanyDriveId: input.mapping.driveId, intendedCompanyFolderId: input.mapping.folderItemId, intendedRelativePath: null };
  }
  if (input.relativePath === null || input.relativePath === undefined || input.relativePath.trim() === '') {
    return { ...orphan, destinationKind: 'ORPHAN', routingReason: 'NO_TEMPLATE_PATH', connectorId: input.connectorId, configVersion: input.configVersion, companyId: input.companyId ?? null, companyNameSnapshot: input.companyName ?? null, templateId: input.templateId, templateVersion: input.templateVersion ?? null, intendedCompanyDriveId: input.mapping.driveId, intendedCompanyFolderId: input.mapping.folderItemId, intendedRelativePath: null };
  }
  try {
    const parsed = parseSharePointRelativeFolderPath(input.relativePath);
    return { ...orphan, destinationKind: 'INTENDED', routingReason: 'TEMPLATE_ROUTE', connectorId: input.connectorId, configVersion: input.configVersion, companyId: input.companyId ?? null, companyNameSnapshot: input.companyName ?? null, templateId: input.templateId, templateVersion: input.templateVersion ?? null, intendedCompanyDriveId: input.mapping.driveId, intendedCompanyFolderId: input.mapping.folderItemId, intendedRelativePath: parsed.normalized };
  } catch (error) {
    if (!(error instanceof SharePointRelativeFolderPathError)) throw error;
    return { ...orphan, destinationKind: 'ORPHAN', routingReason: 'DESTINATION_PATH_INVALID', connectorId: input.connectorId, configVersion: input.configVersion, companyId: input.companyId ?? null, companyNameSnapshot: input.companyName ?? null, templateId: input.templateId, templateVersion: input.templateVersion ?? null, intendedCompanyDriveId: input.mapping.driveId, intendedCompanyFolderId: input.mapping.folderItemId, intendedRelativePath: input.relativePath };
  }
}

