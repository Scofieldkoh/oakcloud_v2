import { Prisma } from '@/generated/prisma';
import { prisma } from '@/lib/prisma';
import { createAuditLog } from '@/lib/audit';
import { parseSharePointSettings, type SharePointSignedFilingUpdate } from '@/lib/validations/connector';
import { SharePointServiceError } from './sharepoint.service';
import { verifyFolder } from './sharepoint-folder.service';
import type { SharePointFolderRef } from '@/lib/sharepoint/folder-reference';

export const SHAREPOINT_SIGNED_FILING_ENV = 'SHAREPOINT_SIGNED_FILING_ENABLED';

export function isSharePointSignedFilingDeploymentEnabled(): boolean {
  return process.env[SHAREPOINT_SIGNED_FILING_ENV]?.toLowerCase() === 'true';
}

export interface SharePointFilingSettingsDto {
  connectorId: string;
  connectorName: string;
  deploymentEnabled: boolean;
  enabled: boolean;
  enabledAt: string | null;
  lastVerifiedAt: string | null;
  configVersion: number;
  clientDocumentsRoot: SharePointFolderRef | null;
  orphanDocumentsFolder: SharePointFolderRef | null;
  canEnable: boolean;
}

function serviceError(code: string, message: string, statusCode = 400): SharePointServiceError {
  return new SharePointServiceError({ code, message, statusCode, category: 'CONFIGURATION' });
}

async function getOwnedConnector(workspaceId: string, connectorId: string) {
  if (!workspaceId) throw serviceError('WORKSPACE_CONNECTOR_REQUIRED', 'A workspace-owned SharePoint connector is required', 403);
  const connector = await prisma.connector.findUnique({ where: { id: connectorId } });
  if (!connector || connector.deletedAt) throw serviceError('CONNECTOR_UNAVAILABLE', 'SharePoint connector is unavailable', 404);
  if (connector.provider !== 'SHAREPOINT' || connector.workspaceId !== workspaceId) {
    throw serviceError('WORKSPACE_CONNECTOR_REQUIRED', 'Signed-document filing requires a workspace-owned SharePoint connector', 403);
  }
  return connector;
}

function branchToDto(connector: { id: string; name: string; settings: unknown }): SharePointFilingSettingsDto {
  const parsed = parseSharePointSettings(connector.settings);
  const filing = parsed.signedDocumentFiling;
  const rootsReady = Boolean(filing.clientDocumentsRoot && filing.orphanDocumentsFolder);
  return {
    connectorId: connector.id,
    connectorName: connector.name,
    deploymentEnabled: isSharePointSignedFilingDeploymentEnabled(),
    enabled: filing.enabled,
    enabledAt: filing.enabledAt ?? null,
    lastVerifiedAt: filing.lastVerifiedAt ?? null,
    configVersion: filing.configVersion,
    clientDocumentsRoot: filing.clientDocumentsRoot ?? null,
    orphanDocumentsFolder: filing.orphanDocumentsFolder ?? null,
    canEnable: isSharePointSignedFilingDeploymentEnabled() && rootsReady && Boolean(filing.lastVerifiedAt),
  };
}

export async function getSharePointFilingSettings(input: { workspaceId: string; connectorId: string }): Promise<SharePointFilingSettingsDto> {
  const connector = await getOwnedConnector(input.workspaceId, input.connectorId);
  return branchToDto(connector);
}

function sameFolder(a: SharePointFolderRef | undefined, b: SharePointFolderRef | undefined): boolean {
  return Boolean(a && b && a.driveId === b.driveId && a.itemId === b.itemId);
}

export async function updateSharePointFilingSettings(
  input: { workspaceId: string; userId: string } & SharePointSignedFilingUpdate,
): Promise<SharePointFilingSettingsDto> {
  const connector = await getOwnedConnector(input.workspaceId, input.connectorId);
  if (!connector.isEnabled) throw serviceError('CONNECTOR_DISABLED', 'SharePoint connector is disabled');

  const current = parseSharePointSettings(connector.settings);
  const currentFiling = current.signedDocumentFiling;
  const rootProvided = input.clientDocumentsRoot !== undefined;
  const orphanProvided = input.orphanDocumentsFolder !== undefined;

  let clientDocumentsRoot = currentFiling.clientDocumentsRoot;
  let orphanDocumentsFolder = currentFiling.orphanDocumentsFolder;
  let rootsChanged = false;

  if (rootProvided) {
    if (input.clientDocumentsRoot === null) {
      clientDocumentsRoot = undefined;
      rootsChanged = Boolean(currentFiling.clientDocumentsRoot);
    } else {
      const requestedRoot = input.clientDocumentsRoot;
      if (!requestedRoot) throw serviceError('ROOT_NOT_CONFIGURED', 'Client Documents root is required');
      const canonical = await verifyFolder({ workspaceId: input.workspaceId, connectorId: input.connectorId, driveId: requestedRoot.driveId, itemId: requestedRoot.itemId });
      rootsChanged = !sameFolder(currentFiling.clientDocumentsRoot, canonical);
      clientDocumentsRoot = canonical;
    }
  }
  if (orphanProvided) {
    if (input.orphanDocumentsFolder === null) {
      orphanDocumentsFolder = undefined;
      rootsChanged = rootsChanged || Boolean(currentFiling.orphanDocumentsFolder);
    } else {
      const requestedFolder = input.orphanDocumentsFolder;
      if (!requestedFolder) throw serviceError('ROOT_NOT_CONFIGURED', 'Unassigned folder is required');
      const canonical = await verifyFolder({ workspaceId: input.workspaceId, connectorId: input.connectorId, driveId: requestedFolder.driveId, itemId: requestedFolder.itemId });
      rootsChanged = rootsChanged || !sameFolder(currentFiling.orphanDocumentsFolder, canonical);
      orphanDocumentsFolder = canonical;
    }
  }

  if (clientDocumentsRoot && orphanDocumentsFolder) {
    if (clientDocumentsRoot.driveId !== orphanDocumentsFolder.driveId) {
      throw serviceError('DRIVE_MISMATCH', 'Client Documents and unassigned folders must use the same SharePoint drive');
    }
    if (sameFolder(clientDocumentsRoot, orphanDocumentsFolder)) {
      throw serviceError('ROOT_FOLDERS_MUST_DIFFER', 'Client Documents and unassigned folders must be different folders');
    }
  }

  let enabled = currentFiling.enabled;
  let enabledAt = currentFiling.enabledAt;
  let lastVerifiedAt = currentFiling.lastVerifiedAt;
  let configVersion = currentFiling.configVersion;

  if (rootsChanged) {
    enabled = false;
    enabledAt = undefined;
    // The roots have just been verified through Graph above. Keep that
    // verification marker so the administrator can explicitly enable the new
    // configuration, while still forcing a fresh enabledAt cutover.
    lastVerifiedAt = clientDocumentsRoot && orphanDocumentsFolder ? new Date().toISOString() : undefined;
    configVersion += 1;
  }

  if (input.enabled !== undefined) {
    if (input.enabled) {
      if (!isSharePointSignedFilingDeploymentEnabled()) throw serviceError('DEPLOYMENT_DISABLED', 'Automatic signed-document filing is disabled for this deployment');
      if (!clientDocumentsRoot || !orphanDocumentsFolder) throw serviceError('ROOT_NOT_CONFIGURED', 'Configure both SharePoint filing folders before enabling automatic filing');
      // Reverify both roots at the enablement cutover. Canonical values are
      // persisted even when a folder was renamed since the last check.
      const [clientCanonical, orphanCanonical] = await Promise.all([
        verifyFolder({ workspaceId: input.workspaceId, connectorId: input.connectorId, driveId: clientDocumentsRoot.driveId, itemId: clientDocumentsRoot.itemId }),
        verifyFolder({ workspaceId: input.workspaceId, connectorId: input.connectorId, driveId: orphanDocumentsFolder.driveId, itemId: orphanDocumentsFolder.itemId }),
      ]);
      if (clientCanonical.driveId !== orphanCanonical.driveId) throw serviceError('DRIVE_MISMATCH', 'Filing folders must use the same SharePoint drive');
      if (sameFolder(clientCanonical, orphanCanonical)) throw serviceError('ROOT_FOLDERS_MUST_DIFFER', 'Filing folders must be different folders');
      clientDocumentsRoot = clientCanonical;
      orphanDocumentsFolder = orphanCanonical;
      lastVerifiedAt = new Date().toISOString();
      enabledAt = new Date().toISOString();
      enabled = true;
    } else {
      enabled = false;
    }
  }

  const nextFiling: Record<string, unknown> = {
    ...currentFiling,
    enabled,
    configVersion,
  };
  if (enabledAt) nextFiling.enabledAt = enabledAt;
  else delete nextFiling.enabledAt;
  if (lastVerifiedAt) nextFiling.lastVerifiedAt = lastVerifiedAt;
  else delete nextFiling.lastVerifiedAt;
  if (clientDocumentsRoot) nextFiling.clientDocumentsRoot = clientDocumentsRoot;
  else delete nextFiling.clientDocumentsRoot;
  if (orphanDocumentsFolder) nextFiling.orphanDocumentsFolder = orphanDocumentsFolder;
  else delete nextFiling.orphanDocumentsFolder;

  const nextSettings: Record<string, unknown> = {
    ...current,
    signedDocumentFiling: nextFiling,
  };

  const saved = await prisma.$transaction(async (tx) => {
    const result = await tx.connector.updateMany({
      where: { id: connector.id, workspaceId: input.workspaceId, updatedAt: connector.updatedAt },
      data: { settings: nextSettings as Prisma.InputJsonValue },
    });
    if (result.count !== 1) throw serviceError('SETTINGS_CONFLICT', 'SharePoint settings changed while you were editing them', 409);
    await createAuditLog({
      tenantId: input.workspaceId,
      userId: input.userId,
      action: 'UPDATE',
      entityType: 'Connector',
      entityId: connector.id,
      entityName: connector.name,
      summary: enabled ? 'Enabled automatic signed-document SharePoint filing' : rootsChanged ? 'Updated automatic signed-document SharePoint filing roots' : 'Updated automatic signed-document SharePoint filing settings',
      changeSource: 'MANUAL',
      metadata: {
        signedDocumentFiling: true,
        enabled,
        rootsChanged,
        configVersion,
        enabledAt: enabledAt ?? null,
        clientDocumentsRoot: clientDocumentsRoot ? { driveId: clientDocumentsRoot.driveId, itemId: clientDocumentsRoot.itemId } : null,
        orphanDocumentsFolder: orphanDocumentsFolder ? { driveId: orphanDocumentsFolder.driveId, itemId: orphanDocumentsFolder.itemId } : null,
      },
    }, tx);
    return tx.connector.findUniqueOrThrow({ where: { id: connector.id } });
  });
  return branchToDto(saved);
}
