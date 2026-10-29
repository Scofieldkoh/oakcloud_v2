import { prisma } from '@/lib/prisma';
import type { EsigningSharePointFilingStatus } from '@/generated/prisma';
import { createAuditLog } from '@/lib/audit';
import { parseSharePointRelativeFolderPath } from '@/lib/sharepoint/relative-folder-path';
import type { SharePointFolderRef } from '@/lib/sharepoint/folder-reference';
import { decodeSharePointCursor, downloadSharePointItemContent, encodeSharePointCursor, getCanonicalSharePointItem, getWorkspaceSharePointContext, SharePointServiceError } from '@/services/sharepoint.service';
import { findItemByName, sha256Content, uploadSignedDocument } from '@/services/sharepoint-signed-upload.service';
import { moveItemToFolder, resolveOrCreateRelativePath, verifyFolder } from '@/services/sharepoint-folder.service';
import { isImmediateChildOfRoot } from '@/services/sharepoint-folder.service';
import { getSharePointFilingSettings } from '@/services/sharepoint-filing-settings.service';
import { preferredSignedDocumentFileName } from './filename';
import { downloadSharePointFilingSource } from './source';

const RECOVERY_LIMIT = 100;

export interface SharePointFilingQueueItem {
  id: string;
  envelopeId: string;
  envelopeDocumentId: string;
  connectorId: string;
  companyId: string | null;
  companyNameSnapshot: string | null;
  documentTitleSnapshot: string;
  destinationKind: string;
  routingReason: string;
  intendedRelativePath: string | null;
  status: string;
  attempts: number;
  availableAt: string;
  lastErrorCode: string | null;
  lastError: string | null;
  targetFileName: string | null;
  uploadedItemId: string | null;
  uploadedWebUrl: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  envelopeTitle: string;
  documentFileName: string;
  completedAt: string | null;
}

interface RecoveryJob {
  id: string;
  tenantId: string;
  envelopeId: string;
  envelopeDocumentId: string;
  companyId: string | null;
  connectorId: string;
  destinationKind: string;
  routingReason: string;
  companyNameSnapshot: string | null;
  documentTitleSnapshot: string;
  intendedRelativePath: string | null;
  orphanDriveId: string;
  orphanFolderItemId: string;
  status: string;
  attempts: number;
  availableAt: Date;
  lastErrorCode: string | null;
  lastError: string | null;
  targetFileName: string | null;
  uploadedItemId: string | null;
  uploadedDriveId: string | null;
  uploadedWebUrl: string | null;
  uploadedFileName: string | null;
  sourceSignedHash: string | null;
  sourceSize: number | null;
  resolvedAt: Date | null;
  resolutionNote: string | null;
  envelope: { title: string; certificateId: string; completedAt: Date | null };
  envelopeDocument: { fileName: string; signedStoragePath: string | null; signedHash: string | null; fileSize: number };
}

const recoverySelect = {
  id: true,
  tenantId: true,
  envelopeId: true,
  envelopeDocumentId: true,
  companyId: true,
  connectorId: true,
  destinationKind: true,
  routingReason: true,
  companyNameSnapshot: true,
  documentTitleSnapshot: true,
  intendedRelativePath: true,
  orphanDriveId: true,
  orphanFolderItemId: true,
  status: true,
  attempts: true,
  availableAt: true,
  lastErrorCode: true,
  lastError: true,
  targetFileName: true,
  uploadedItemId: true,
  uploadedDriveId: true,
  uploadedWebUrl: true,
  uploadedFileName: true,
  sourceSignedHash: true,
  sourceSize: true,
  resolvedAt: true,
  resolutionNote: true,
  envelope: { select: { title: true, certificateId: true, completedAt: true } },
  envelopeDocument: { select: { fileName: true, signedStoragePath: true, signedHash: true, fileSize: true } },
} as const;

async function getRecoveryJob(workspaceId: string, jobId: string): Promise<RecoveryJob> {
  const job = await prisma.esigningSharePointFiling.findFirst({ where: { id: jobId, tenantId: workspaceId }, select: recoverySelect });
  if (!job) throw new SharePointServiceError({ code: 'FILING_NOT_FOUND', category: 'NOT_FOUND', statusCode: 404, message: 'SharePoint filing job was not found' });
  return job as RecoveryJob;
}

function toDto(job: RecoveryJob): SharePointFilingQueueItem {
  return {
    id: job.id,
    envelopeId: job.envelopeId,
    envelopeDocumentId: job.envelopeDocumentId,
    connectorId: job.connectorId,
    companyId: job.companyId,
    companyNameSnapshot: job.companyNameSnapshot,
    documentTitleSnapshot: job.documentTitleSnapshot,
    destinationKind: job.destinationKind,
    routingReason: job.routingReason,
    intendedRelativePath: job.intendedRelativePath,
    status: job.status,
    attempts: job.attempts,
    availableAt: job.availableAt.toISOString(),
    lastErrorCode: job.lastErrorCode,
    lastError: job.lastError,
    targetFileName: job.targetFileName,
    uploadedItemId: job.uploadedItemId,
    uploadedWebUrl: job.uploadedWebUrl,
    resolvedAt: job.resolvedAt?.toISOString() ?? null,
    resolutionNote: job.resolutionNote,
    envelopeTitle: job.envelope.title,
    documentFileName: job.envelopeDocument.fileName,
    completedAt: job.envelope.completedAt?.toISOString() ?? null,
  };
}

export async function listSharePointFilingRecoveryQueue(input: { workspaceId: string; connectorId: string; cursor?: string; limit?: number }): Promise<{ items: SharePointFilingQueueItem[]; nextCursor?: string; total: number }> {
  const context = await getWorkspaceSharePointContext({ workspaceId: input.workspaceId, connectorId: input.connectorId });
  const query = 'recovery';
  let offset = 0;
  if (input.cursor) {
    const cursor = decodeSharePointCursor(input.cursor);
    if (cursor.workspaceId !== input.workspaceId || cursor.connectorId !== input.connectorId || cursor.driveId !== context.driveId || cursor.parentItemId !== 'recovery' || cursor.query !== query) {
      throw new SharePointServiceError({ code: 'INVALID_CURSOR', category: 'VALIDATION', statusCode: 400, message: 'The SharePoint recovery cursor is invalid' });
    }
    offset = cursor.offset;
  }
  const orphanQueueStatuses: EsigningSharePointFilingStatus[] = ['PENDING', 'FAILED_RETRYABLE', 'COMPLETED'];
  const failedQueueStatuses: EsigningSharePointFilingStatus[] = ['FAILED_PERMANENT', 'REVIEW_REQUIRED'];
  const where = {
    tenantId: input.workspaceId,
    connectorId: input.connectorId,
    OR: [
      { destinationKind: 'ORPHAN' as const, resolvedAt: null, status: { in: orphanQueueStatuses } },
      { status: { in: failedQueueStatuses } },
    ],
  };
  const [jobs, total] = await Promise.all([
    prisma.esigningSharePointFiling.findMany({ where, select: recoverySelect, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], skip: offset, take: Math.max(1, Math.min(input.limit ?? 25, RECOVERY_LIMIT)) }),
    prisma.esigningSharePointFiling.count({ where }),
  ]);
  const nextOffset = offset + jobs.length;
  return {
    items: (jobs as unknown as RecoveryJob[]).map(toDto),
    nextCursor: nextOffset < total ? encodeSharePointCursor({ version: 1, workspaceId: input.workspaceId, connectorId: input.connectorId, driveId: context.driveId, parentItemId: 'recovery', query, offset: nextOffset }) : undefined,
    total,
  };
}

export async function retrySharePointFilingJob(input: { workspaceId: string; jobId: string; userId: string }): Promise<SharePointFilingQueueItem> {
  const job = await getRecoveryJob(input.workspaceId, input.jobId);
  if (job.resolvedAt) return toDto(job);
  await prisma.esigningSharePointFiling.updateMany({
    where: { id: input.jobId, tenantId: input.workspaceId, status: { in: ['FAILED_RETRYABLE', 'FAILED_PERMANENT', 'REVIEW_REQUIRED'] } },
    data: { status: 'PENDING', attempts: 0, availableAt: new Date(), claimedAt: null, leaseExpiresAt: null, claimToken: null, lastErrorCode: null, lastError: null },
  });
  await createAuditLog({ tenantId: input.workspaceId, userId: input.userId, action: 'UPDATE', entityType: 'EsigningSharePointFiling', entityId: input.jobId, summary: 'Retried signed-document SharePoint filing', changeSource: 'MANUAL' });
  return toDto(await getRecoveryJob(input.workspaceId, input.jobId));
}

export async function addSharePointFilingNote(input: { workspaceId: string; jobId: string; userId: string; note: string }): Promise<SharePointFilingQueueItem> {
  const note = input.note.trim();
  if (!note || note.length > 2000) throw new SharePointServiceError({ code: 'INVALID_NOTE', category: 'VALIDATION', statusCode: 400, message: 'A note between 1 and 2000 characters is required' });
  const job = await getRecoveryJob(input.workspaceId, input.jobId);
  await createAuditLog({ tenantId: input.workspaceId, userId: input.userId, action: 'UPDATE', entityType: 'EsigningSharePointFiling', entityId: input.jobId, summary: 'Added SharePoint filing recovery note', changeSource: 'MANUAL', metadata: { note } });
  return toDto(job);
}

async function resolveDestination(input: { workspaceId: string; connectorId: string; companyId: string | null; destination?: SharePointFolderRef; relativePath?: string | null }) {
  const context = await getWorkspaceSharePointContext({ workspaceId: input.workspaceId, connectorId: input.connectorId });
  if (input.destination) {
    const verified = await verifyFolder({ workspaceId: input.workspaceId, connectorId: input.connectorId, driveId: input.destination.driveId, itemId: input.destination.itemId });
    return { context, driveId: verified.driveId, folderId: verified.itemId };
  }
  if (!input.relativePath || !input.companyId) throw new SharePointServiceError({ code: 'DESTINATION_REQUIRED', category: 'VALIDATION', statusCode: 400, message: 'A verified recovery destination is required' });
  const parsed = parseSharePointRelativeFolderPath(input.relativePath);
  const mapping = await prisma.companySharePointFolder.findFirst({ where: { companyId: input.companyId, tenantId: input.workspaceId, connectorId: input.connectorId } });
  if (!mapping) throw new SharePointServiceError({ code: 'COMPANY_FOLDER_UNAVAILABLE', category: 'CONFIGURATION', statusCode: 400, message: 'The company does not have a SharePoint folder mapping for this connector' });
  const companyFolder = await verifyFolder({ workspaceId: input.workspaceId, connectorId: input.connectorId, driveId: mapping.driveId, itemId: mapping.folderItemId });
  const settings = await getSharePointFilingSettings({ workspaceId: input.workspaceId, connectorId: input.connectorId });
  if (!settings.clientDocumentsRoot || !(await isImmediateChildOfRoot({ workspaceId: input.workspaceId, connectorId: input.connectorId, driveId: companyFolder.driveId, rootItemId: settings.clientDocumentsRoot.itemId, itemId: companyFolder.itemId }))) throw new SharePointServiceError({ code: 'OUTSIDE_ALLOWED_ROOT', category: 'VALIDATION', statusCode: 400, message: 'The company mapping is not an immediate child of Client Documents' });
  const destination = await resolveOrCreateRelativePath({ workspaceId: input.workspaceId, connectorId: input.connectorId, driveId: context.driveId, rootFolder: companyFolder, segments: parsed.segments });
  return { context, driveId: context.driveId, folderId: destination.id };
}

export async function resolveSharePointFilingJob(input: { workspaceId: string; jobId: string; userId: string; connectorId?: string; destination?: SharePointFolderRef; relativePath?: string | null; note?: string | null }): Promise<SharePointFilingQueueItem> {
  const job = await getRecoveryJob(input.workspaceId, input.jobId);
  if (job.resolvedAt && job.status === 'COMPLETED') return toDto(job);
  const connectorId = input.connectorId ?? job.connectorId;
  if (connectorId !== job.connectorId) throw new SharePointServiceError({ code: 'CONNECTOR_MISMATCH', category: 'VALIDATION', statusCode: 400, message: 'Recovery must use the filing job connector' });
  const destination = await resolveDestination({ workspaceId: input.workspaceId, connectorId, companyId: job.companyId, destination: input.destination, relativePath: input.relativePath });
  let uploaded = null as Awaited<ReturnType<typeof getCanonicalSharePointItem>> | null;
  if (job.uploadedItemId) {
    try {
      uploaded = await getCanonicalSharePointItem(destination.context, job.uploadedItemId);
    } catch (error) {
      if (!(error instanceof SharePointServiceError && error.code === 'FOLDER_NOT_FOUND')) throw error;
    }
  }
  const targetFileName = job.targetFileName ?? preferredSignedDocumentFileName({ documentTitle: job.documentTitleSnapshot || job.envelopeDocument.fileName });
  if (uploaded) {
    if (uploaded.driveId !== destination.driveId) throw new SharePointServiceError({ code: 'DRIVE_MISMATCH', category: 'VALIDATION', statusCode: 400, message: 'Existing SharePoint item is in a different drive' });
    if (uploaded.parentItemId !== destination.folderId) {
      uploaded = await moveItemToFolder({ workspaceId: input.workspaceId, connectorId, driveId: destination.driveId, itemId: uploaded.id, destinationFolderId: destination.folderId, newName: targetFileName });
    }
  } else {
    const content = await downloadSharePointFilingSource({
      tenantId: input.workspaceId,
      envelopeId: job.envelopeId,
      envelopeDocumentId: job.envelopeDocumentId,
      signedStoragePath: job.envelopeDocument.signedStoragePath,
    });
    const sourceHash = sha256Content(content);
    const existing = await findItemByName({ workspaceId: input.workspaceId, connectorId, folderId: destination.folderId, name: targetFileName });
    if (existing) {
      if (existing.size !== content.length || sha256Content(await downloadSharePointItemContent(destination.context, existing.id, content.length)) !== sourceHash) throw new SharePointServiceError({ code: 'RECOVERY_FILENAME_CONFLICT', category: 'CONFLICT', statusCode: 409, message: 'A different SharePoint item already uses the recovery filename' });
      uploaded = existing;
    } else {
      uploaded = await uploadSignedDocument({ workspaceId: input.workspaceId, connectorId, destinationFolderId: destination.folderId, fileName: targetFileName, content, mimeType: 'application/pdf' });
    }
    await prisma.esigningSharePointFiling.updateMany({ where: { id: input.jobId, tenantId: input.workspaceId }, data: { sourceSignedHash: sourceHash, sourceSize: content.length } });
  }
  await prisma.esigningSharePointFiling.update({
    where: { id: input.jobId },
    data: { status: 'COMPLETED', resolvedDestinationDriveId: destination.driveId, resolvedDestinationId: destination.folderId, targetFileName: uploaded.name, uploadedDriveId: uploaded.driveId, uploadedItemId: uploaded.id, uploadedWebUrl: uploaded.webUrl, uploadedFileName: uploaded.name, filedAt: job.status === 'COMPLETED' ? undefined : new Date(), resolvedAt: new Date(), resolvedById: input.userId, resolutionNote: input.note?.trim() || undefined, claimedAt: null, leaseExpiresAt: null, claimToken: null, lastErrorCode: null, lastError: null },
  });
  await createAuditLog({ tenantId: input.workspaceId, userId: input.userId, companyId: job.companyId ?? undefined, action: 'UPDATE', entityType: 'EsigningSharePointFiling', entityId: input.jobId, summary: 'Resolved signed-document SharePoint filing', changeSource: 'MANUAL', metadata: { destinationDriveId: destination.driveId, destinationFolderId: destination.folderId, uploadedItemId: uploaded.id } });
  return toDto(await getRecoveryJob(input.workspaceId, input.jobId));
}
