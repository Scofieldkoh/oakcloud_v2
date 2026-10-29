import { prisma } from '@/lib/prisma';
import { createLogger } from '@/lib/logger';
import { createAuditLog } from '@/lib/audit';
import { parseSharePointSettings } from '@/lib/validations/connector';
import {
  downloadSharePointItemContent,
  getCanonicalSharePointItem,
  getWorkspaceSharePointContext,
  SharePointServiceError,
} from '@/services/sharepoint.service';
import { resolveOrCreateRelativePath } from '@/services/sharepoint-folder.service';
import {
  findItemByName,
  sha256Content,
  uploadSignedDocument,
  uploadedItemMatches,
} from '@/services/sharepoint-signed-upload.service';
import {
  claimFilingJobs,
  completeClaim,
  failClaim,
  markClaimReviewRequired,
  releaseExpiredClaims,
  reserveTargetFileName,
  routeClaimToOrphan,
} from './repository';
import { preferredSignedDocumentFileName } from './filename';
import { isSharePointSignedFilingDeploymentEnabled } from '@/services/sharepoint-filing-settings.service';
import { repairMissingFilingJobsForWorkspace } from './enqueue';
import type { ClaimedSharePointFiling } from './types';
import { downloadSharePointFilingSource } from './source';

const log = createLogger('esigning-sharepoint-filing');
const MAX_SIGNED_DOCUMENT_BYTES = 250 * 1024 * 1024;
const MAX_RECONCILIATION_BYTES = 250 * 1024 * 1024;

export interface SharePointFilingWorkerResult {
  jobId: string;
  outcome: 'completed' | 'retryable' | 'permanent' | 'review-required' | 'stale-worker' | 'paused';
  errorCode?: string;
}

export interface SharePointFilingBatchResult {
  processed: number;
  completed: number;
  retryable: number;
  permanent: number;
  reviewRequired: number;
  paused: number;
  waitingForSource: number;
}

interface FilingForWork {
  id: string;
  tenantId: string;
  envelopeId: string;
  envelopeDocumentId: string;
  connectorId: string;
  destinationKind: 'INTENDED' | 'ORPHAN';
  routingReason: string;
  companyNameSnapshot: string | null;
  documentTitleSnapshot: string;
  intendedCompanyDriveId: string | null;
  intendedCompanyFolderId: string | null;
  intendedRelativePath: string | null;
  orphanDriveId: string;
  orphanFolderItemId: string;
  targetFileName: string | null;
  uploadedItemId: string | null;
  uploadedDriveId: string | null;
  uploadedWebUrl: string | null;
  uploadedFileName: string | null;
  sourceSignedHash: string | null;
  sourceSize: number | null;
  envelope: { completedAt: Date | null; certificateId: string; title: string };
  envelopeDocument: { signedStoragePath: string | null; signedHash: string | null; fileName: string; fileSize: number };
}

function isPdf(content: Buffer): boolean {
  return content.subarray(0, 5).toString('ascii') === '%PDF-';
}

function errorDetails(error: unknown): { code: string; retryable: boolean; retryAfterMs?: number; message: string } {
  if (error instanceof SharePointServiceError) {
    return { code: error.code, retryable: error.retryable, retryAfterMs: error.retryAfterMs, message: error.message };
  }
  if (error instanceof Error) {
    return { code: 'WORKER_ERROR', retryable: true, message: 'Signed-document filing encountered a temporary error' };
  }
  return { code: 'WORKER_ERROR', retryable: true, message: 'Signed-document filing encountered a temporary error' };
}

async function loadFiling(claim: ClaimedSharePointFiling): Promise<FilingForWork | null> {
  return prisma.esigningSharePointFiling.findFirst({
    where: { id: claim.id, tenantId: claim.tenantId, status: 'PROCESSING', claimToken: claim.claimToken },
    select: {
      id: true,
      tenantId: true,
      envelopeId: true,
      envelopeDocumentId: true,
      connectorId: true,
      destinationKind: true,
      routingReason: true,
      companyNameSnapshot: true,
      documentTitleSnapshot: true,
      intendedCompanyDriveId: true,
      intendedCompanyFolderId: true,
      intendedRelativePath: true,
      orphanDriveId: true,
      orphanFolderItemId: true,
      targetFileName: true,
      uploadedItemId: true,
      uploadedDriveId: true,
      uploadedWebUrl: true,
      uploadedFileName: true,
      sourceSignedHash: true,
      sourceSize: true,
      envelope: { select: { completedAt: true, certificateId: true, title: true } },
      envelopeDocument: { select: { signedStoragePath: true, signedHash: true, fileName: true, fileSize: true } },
    },
  }) as Promise<FilingForWork | null>;
}

async function canonicalFolder(
  context: Awaited<ReturnType<typeof getWorkspaceSharePointContext>>,
  driveId: string,
  itemId: string,
) {
  if (driveId !== context.driveId) {
    throw new SharePointServiceError({ code: 'DRIVE_MISMATCH', category: 'VALIDATION', statusCode: 400, message: 'SharePoint destination is outside the configured drive' });
  }
  const folder = await getCanonicalSharePointItem(context, itemId);
  if (!folder.isFolder) {
    throw new SharePointServiceError({ code: 'DESTINATION_NOT_FOLDER', category: 'VALIDATION', statusCode: 400, message: 'SharePoint destination is not a folder' });
  }
  return folder;
}

async function resolveDestination(
  claim: ClaimedSharePointFiling,
  filing: FilingForWork,
  context: Awaited<ReturnType<typeof getWorkspaceSharePointContext>>,
): Promise<{ driveId: string; folderId: string }> {
  if (filing.destinationKind === 'INTENDED' && filing.intendedCompanyDriveId && filing.intendedCompanyFolderId) {
    try {
      const companyFolder = await canonicalFolder(context, filing.intendedCompanyDriveId, filing.intendedCompanyFolderId);
      if (!filing.intendedRelativePath) return { driveId: context.driveId, folderId: companyFolder.id };
      const destination = await resolveOrCreateRelativePath({
        workspaceId: claim.tenantId,
        connectorId: filing.connectorId,
        driveId: context.driveId,
        rootFolder: { driveId: context.driveId, itemId: companyFolder.id, name: companyFolder.name, webUrl: companyFolder.webUrl },
        segments: filing.intendedRelativePath,
      });
      return { driveId: context.driveId, folderId: destination.id };
    } catch (error) {
      if (error instanceof SharePointServiceError && (error.code === 'FOLDER_NOT_FOUND' || error.code === 'DESTINATION_NOT_FOLDER')) {
        const routed = await routeClaimToOrphan({ jobId: claim.id, tenantId: claim.tenantId, claimToken: claim.claimToken, routingReason: 'COMPANY_FOLDER_UNAVAILABLE', errorCode: error.code, error: error.message });
        if (!routed) throw new Error('SharePoint filing claim is no longer owned');
        await createAuditLog({ tenantId: claim.tenantId, action: 'UPDATE', entityType: 'EsigningSharePointFiling', entityId: claim.id, summary: 'Routed signed-document filing to SharePoint orphan folder', changeSource: 'SYSTEM', metadata: { reason: 'COMPANY_FOLDER_UNAVAILABLE', previousErrorCode: error.code } });
        filing.destinationKind = 'ORPHAN';
      } else {
        throw error;
      }
    }
  }

  const orphanFolder = await canonicalFolder(context, filing.orphanDriveId, filing.orphanFolderItemId);
  return { driveId: context.driveId, folderId: orphanFolder.id };
}

async function remoteItemMatches(
  context: Awaited<ReturnType<typeof getWorkspaceSharePointContext>>,
  item: { id: string; driveId: string; parentItemId?: string; size?: number; fileHash?: string },
  destinationFolderId: string,
  content: Buffer,
  sourceHash: string,
): Promise<boolean> {
  if (!uploadedItemMatches({ item, destinationFolderId, driveId: context.driveId, expectedSize: content.length, expectedHash: sourceHash })) return false;
  if (item.fileHash === sourceHash) return true;
  const remoteContent = await downloadSharePointItemContent(context, item.id, MAX_RECONCILIATION_BYTES);
  return sha256Content(remoteContent) === sourceHash;
}

async function adoptRemoteItem(
  claim: ClaimedSharePointFiling,
  filing: FilingForWork,
  item: { id: string; name: string; webUrl: string; driveId: string },
  destination: { driveId: string; folderId: string },
  sourceHash: string,
  sourceSize: number,
): Promise<SharePointFilingWorkerResult> {
  const completed = await completeClaim({
    jobId: claim.id,
    tenantId: claim.tenantId,
    claimToken: claim.claimToken,
    destinationDriveId: destination.driveId,
    destinationId: destination.folderId,
    targetFileName: item.name,
    uploadedDriveId: item.driveId,
    uploadedItemId: item.id,
    uploadedWebUrl: item.webUrl,
    uploadedFileName: item.name,
    sourceSignedHash: sourceHash,
    sourceSize,
  });
  if (completed) {
    await createAuditLog({ tenantId: claim.tenantId, action: 'UPLOAD', entityType: 'EsigningSharePointFiling', entityId: filing.id, summary: `Completed ${filing.destinationKind.toLowerCase()} signed-document SharePoint filing`, changeSource: 'SYSTEM', metadata: { destinationKind: filing.destinationKind, uploadedItemId: item.id, targetFileName: item.name, reconciled: true } });
  }
  return { jobId: filing.id, outcome: completed ? 'completed' : 'stale-worker' };
}

export async function processSharePointFilingJob(claim: ClaimedSharePointFiling): Promise<SharePointFilingWorkerResult> {
  const filing = await loadFiling(claim);
  if (!filing) return { jobId: claim.id, outcome: 'stale-worker' };

  try {
    const context = await getWorkspaceSharePointContext({ workspaceId: claim.tenantId, connectorId: filing.connectorId });
    const content = await downloadSharePointFilingSource({
      tenantId: claim.tenantId,
      envelopeId: filing.envelopeId,
      envelopeDocumentId: filing.envelopeDocumentId,
      signedStoragePath: filing.envelopeDocument.signedStoragePath,
    });
    if (content.length === 0 || content.length > MAX_SIGNED_DOCUMENT_BYTES || !isPdf(content)) {
      const result = await failClaim({ jobId: claim.id, tenantId: claim.tenantId, claimToken: claim.claimToken, code: 'SOURCE_INVALID', error: 'Signed source is not a valid PDF', retryable: false });
      return { jobId: claim.id, outcome: result === 'permanent' ? 'permanent' : result };
    }
    const sourceHash = sha256Content(content);
    const destination = await resolveDestination(claim, filing, context);
    const preferred = preferredSignedDocumentFileName({ documentTitle: filing.documentTitleSnapshot || filing.envelopeDocument.fileName || filing.envelope.title });

    // Prefer the persisted remote identity after a timeout or lease expiry.
    // A missing item is safe to recover through the reserved-name path below.
    if (filing.uploadedItemId) {
      try {
        const persistedItem = await getCanonicalSharePointItem(context, filing.uploadedItemId);
        if (await remoteItemMatches(context, persistedItem, destination.folderId, content, sourceHash)) {
          return adoptRemoteItem(claim, filing, persistedItem, destination, sourceHash, content.length);
        }
      } catch (error) {
        if (!(error instanceof SharePointServiceError && error.code === 'FOLDER_NOT_FOUND')) throw error;
      }
    }

    let suffixStart = 0;
    for (let collision = 0; collision < 100; collision += 1) {
      const reservation = await reserveTargetFileName({ jobId: claim.id, tenantId: claim.tenantId, connectorId: filing.connectorId, claimToken: claim.claimToken, destinationDriveId: destination.driveId, destinationId: destination.folderId, preferredFileName: preferred, startSuffix: suffixStart, forceNew: collision > 0 });
      if (reservation.suffix > 0) await createAuditLog({ tenantId: claim.tenantId, action: 'UPDATE', entityType: 'EsigningSharePointFiling', entityId: filing.id, summary: `Reserved SharePoint filename suffix (${reservation.suffix})`, changeSource: 'SYSTEM', metadata: { suffix: reservation.suffix, targetFileName: reservation.targetFileName } });
      const existing = await findItemByName({ workspaceId: claim.tenantId, connectorId: filing.connectorId, folderId: destination.folderId, name: reservation.targetFileName });
      if (existing) {
        if (await remoteItemMatches(context, existing, destination.folderId, content, sourceHash)) {
          return adoptRemoteItem(claim, filing, existing, destination, sourceHash, content.length);
        }
        suffixStart = reservation.suffix + 1;
        continue;
      }
      try {
        const uploaded = await uploadSignedDocument({ workspaceId: claim.tenantId, connectorId: filing.connectorId, destinationFolderId: destination.folderId, fileName: reservation.targetFileName, content, mimeType: 'application/pdf' });
        const completed = await completeClaim({ jobId: claim.id, tenantId: claim.tenantId, claimToken: claim.claimToken, destinationDriveId: destination.driveId, destinationId: destination.folderId, targetFileName: reservation.targetFileName, uploadedDriveId: uploaded.driveId, uploadedItemId: uploaded.id, uploadedWebUrl: uploaded.webUrl, uploadedFileName: uploaded.name, sourceSignedHash: sourceHash, sourceSize: content.length });
        if (completed) await createAuditLog({ tenantId: claim.tenantId, action: 'UPLOAD', entityType: 'EsigningSharePointFiling', entityId: filing.id, summary: `Completed ${filing.destinationKind.toLowerCase()} signed-document SharePoint filing`, changeSource: 'SYSTEM', metadata: { destinationKind: filing.destinationKind, uploadedItemId: uploaded.id, targetFileName: uploaded.name } });
        return { jobId: claim.id, outcome: completed ? 'completed' : 'stale-worker' };
      } catch (error) {
        const details = errorDetails(error);
        if (error instanceof SharePointServiceError && error.category === 'CONFLICT') {
          const afterConflict = await findItemByName({ workspaceId: claim.tenantId, connectorId: filing.connectorId, folderId: destination.folderId, name: reservation.targetFileName });
          if (afterConflict && await remoteItemMatches(context, afterConflict, destination.folderId, content, sourceHash)) {
            return adoptRemoteItem(claim, filing, afterConflict, destination, sourceHash, content.length);
          }
          suffixStart = reservation.suffix + 1;
          continue;
        }
        if (details.retryable) throw error;
        throw error;
      }
    }

    await markClaimReviewRequired({ jobId: claim.id, tenantId: claim.tenantId, claimToken: claim.claimToken, code: 'FILENAME_COLLISIONS_EXHAUSTED', error: 'Automatic filename candidates are exhausted' });
    return { jobId: claim.id, outcome: 'review-required', errorCode: 'FILENAME_COLLISIONS_EXHAUSTED' };
  } catch (error) {
    const details = errorDetails(error);
    const result = await failClaim({ jobId: claim.id, tenantId: claim.tenantId, claimToken: claim.claimToken, code: details.code, error: details.message, retryable: details.retryable, retryAfterMs: details.retryAfterMs });
    const outcome = result === 'retryable' ? 'retryable' : result === 'review-required' ? 'review-required' : result === 'permanent' ? 'permanent' : 'stale-worker';
    log.warn('SharePoint filing job did not complete', { jobId: claim.id, outcome, errorCode: details.code });
    return { jobId: claim.id, outcome, errorCode: details.code };
  }
}

async function enabledConnectorIds(workspaceId?: string): Promise<Array<{ id: string; workspaceId: string; enabledAt: Date | null }>> {
  const connectors = await prisma.connector.findMany({
    where: { provider: 'SHAREPOINT', isEnabled: true, deletedAt: null, workspaceId: workspaceId ?? { not: null } },
    select: { id: true, workspaceId: true, settings: true },
    orderBy: [{ workspaceId: 'asc' }, { isDefault: 'desc' }, { createdAt: 'asc' }],
  });
  return connectors.flatMap((connector) => {
    if (!connector.workspaceId) return [];
    try {
      const branch = parseSharePointSettings(connector.settings).signedDocumentFiling;
      if (!branch.enabled) return [];
      const enabledAt = branch.enabledAt ? new Date(branch.enabledAt) : null;
      return [{ id: connector.id, workspaceId: connector.workspaceId, enabledAt: enabledAt && !Number.isNaN(enabledAt.getTime()) ? enabledAt : null }];
    } catch {
      return [];
    }
  });
}

export async function processQueuedSharePointFilings(input: { limit?: number; workspaceId?: string } = {}): Promise<SharePointFilingBatchResult> {
  const result: SharePointFilingBatchResult = { processed: 0, completed: 0, retryable: 0, permanent: 0, reviewRequired: 0, paused: 0, waitingForSource: 0 };
  if (!isSharePointSignedFilingDeploymentEnabled()) {
    result.paused = 1;
    return result;
  }
  const limit = Math.max(1, Math.min(input.limit ?? 25, 100));
  const connectors = await enabledConnectorIds(input.workspaceId);
  const byWorkspace = new Map<string, Array<{ id: string; workspaceId: string; enabledAt: Date | null }>>();
  for (const connector of connectors) byWorkspace.set(connector.workspaceId, [...(byWorkspace.get(connector.workspaceId) ?? []), connector]);
  for (const [tenantId, tenantConnectors] of byWorkspace) {
    if (result.processed >= limit) break;
    await releaseExpiredClaims({ tenantId });
    for (const connector of tenantConnectors) {
      if (result.processed >= limit) break;
      if (connector.enabledAt) await repairMissingFilingJobsForWorkspace(tenantId, connector.enabledAt, Math.min(25, limit - result.processed), connector.id);
      const claims = await claimFilingJobs({ tenantId, connectorId: connector.id, limit: limit - result.processed });
      for (const claim of claims) {
        result.processed += 1;
        const completed = await processSharePointFilingJob(claim);
        if (completed.outcome === 'completed') result.completed += 1;
        else if (completed.outcome === 'retryable') result.retryable += 1;
        else if (completed.outcome === 'permanent') result.permanent += 1;
        else if (completed.outcome === 'review-required') result.reviewRequired += 1;
      }
    }
  }
  return result;
}
