/**
 * Permanent (hard) deletion of generated documents.
 *
 * Soft delete (`deleteGeneratedDocument`) sends a document to the Recycle Bin;
 * purging it there (`/api/admin/purge`) calls this service to remove it for good: the database row, its sections, comments,
 * drafts and batch item (cascades), and its stored OakDoc files. Records that
 * outlive the document are unlinked rather than deleted: e-signing envelopes
 * keep their own PDF copies and task outcomes lose the link.
 *
 * Deletion is refused while the document is still load-bearing elsewhere:
 * - it is out for signature (an envelope that is SENT or IN_PROGRESS);
 * - it is a service agreement that is in effect or has client services
 *   created from it (ClientService rows restrict the agreement's deletion).
 */

import { prisma } from '@/lib/prisma';
import { createAuditLog } from '@/lib/audit';
import { ConflictError, NotFoundError } from '@/lib/errors';
import { createLogger } from '@/lib/logger';
import { storage, StorageKeys } from '@/lib/storage';
import { Prisma } from '@/generated/prisma';
import type { TenantAwareParams } from '@/lib/types';
import {
  safelyCaptureGeneratedDocumentTaskStageIds,
  safelyReconcileTaskStageIds,
} from '@/services/tasks/integration.service';

const log = createLogger('generated-document-purge');

const SIGNING_IN_PROGRESS_STATUSES = new Set(['SENT', 'IN_PROGRESS']);

export interface PermanentDeleteGeneratedDocumentResult {
  id: string;
  title: string;
  /** The draft or cancelled service agreement record removed with the document. */
  removedServiceAgreementId: string | null;
  /** E-signing envelopes that keep their own copy and are now unlinked. */
  unlinkedEnvelopeIds: string[];
}

const purgeSelect = {
  id: true,
  tenantId: true,
  companyId: true,
  title: true,
  status: true,
  deletedAt: true,
  serviceAgreement: {
    select: {
      id: true,
      status: true,
      _count: { select: { clientServices: true } },
    },
  },
  esigningEnvelopeDocuments: {
    select: { envelope: { select: { id: true, title: true, status: true } } },
  },
} satisfies Prisma.GeneratedDocumentSelect;

type PurgeCandidate = Prisma.GeneratedDocumentGetPayload<{ select: typeof purgeSelect }>;

/** Returns why the document cannot be permanently deleted, or null when it can. */
export function getPermanentDeleteBlocker(document: PurgeCandidate): string | null {
  const signing = document.esigningEnvelopeDocuments
    .map(({ envelope }) => envelope)
    .find((envelope) => SIGNING_IN_PROGRESS_STATUSES.has(envelope.status));
  if (signing) {
    return `"${document.title}" is out for signature in envelope "${signing.title}". Void the envelope first.`;
  }

  const agreement = document.serviceAgreement;
  if (agreement && agreement._count.clientServices > 0) {
    const count = agreement._count.clientServices;
    return `"${document.title}" is a service agreement with ${count} client service${count === 1 ? '' : 's'} created from it. Remove or re-link those services first.`;
  }
  if (agreement?.status === 'EFFECTIVE') {
    return `"${document.title}" is a service agreement that is in effect. Cancel the agreement first.`;
  }
  return null;
}

function isForeignKeyViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003';
}

/**
 * Permanently delete one generated document of the given workspace. Works on
 * live documents (any status, including FINALIZED) and on documents already in
 * the Recycle Bin.
 */
export async function permanentlyDeleteGeneratedDocument(
  id: string,
  params: TenantAwareParams,
  reason: string,
): Promise<PermanentDeleteGeneratedDocumentResult> {
  const { tenantId, userId } = params;

  const existing = await prisma.generatedDocument.findFirst({
    where: { id, tenantId },
    select: { id: true },
  });
  if (!existing) throw new NotFoundError('Document not found');

  const linkedTaskStageIds = await safelyCaptureGeneratedDocumentTaskStageIds(tenantId, id);

  let document: PurgeCandidate;
  try {
    document = await prisma.$transaction(async (tx) => {
      const current = await tx.generatedDocument.findFirst({
        where: { id, tenantId },
        select: purgeSelect,
      });
      if (!current) throw new NotFoundError('Document not found');

      const blocker = getPermanentDeleteBlocker(current);
      if (blocker) throw new ConflictError(blocker, { resourceType: 'GeneratedDocument', documentId: id });

      // ServiceAgreement cascades from the document; its entities and items
      // cascade from the agreement. Client services restrict, checked above.
      await tx.generatedDocument.delete({ where: { id } });
      return current;
    });
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      throw new ConflictError(
        'This document is still linked to other records (for example client services) and cannot be permanently deleted.',
        { resourceType: 'GeneratedDocument', documentId: id },
      );
    }
    throw error;
  }

  // Files are removed after the commit so a rolled-back delete never loses them.
  try {
    await storage.deletePrefix(StorageKeys.generatedDocumentPrefix(tenantId, id));
  } catch (error) {
    log.warn('Failed to remove stored files for permanently deleted document', { documentId: id, error });
  }

  const unlinkedEnvelopeIds = document.esigningEnvelopeDocuments.map(({ envelope }) => envelope.id);
  const removedServiceAgreementId = document.serviceAgreement?.id ?? null;

  await createAuditLog({
    tenantId,
    userId,
    companyId: document.companyId ?? undefined,
    action: 'DELETE',
    entityType: 'GeneratedDocument',
    entityId: document.id,
    entityName: document.title,
    summary: `Permanently deleted document "${document.title}"`,
    changeSource: 'MANUAL',
    reason,
    metadata: {
      permanent: true,
      status: document.status,
      wasInRecycleBin: document.deletedAt !== null,
      removedServiceAgreementId,
      unlinkedEnvelopeIds,
    },
  });
  await safelyReconcileTaskStageIds(tenantId, linkedTaskStageIds, userId);

  return { id: document.id, title: document.title, removedServiceAgreementId, unlinkedEnvelopeIds };
}
