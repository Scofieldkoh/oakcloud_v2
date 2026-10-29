import { randomUUID } from 'node:crypto';
import { Prisma } from '@/generated/prisma';
import { prisma } from '@/lib/prisma';
import { createAuditLog } from '@/lib/audit';
import { signedDocumentFilenameCandidate, MAX_AUTOMATIC_FILENAME_CANDIDATES } from './filename';
import type { ClaimedSharePointFiling } from './types';

const DEFAULT_LEASE_MS = 15 * 60 * 1000;
const MAX_AUTOMATIC_ATTEMPTS = 10;

export async function claimFilingJobs(input: { tenantId: string; connectorId?: string; limit: number; leaseMs?: number }): Promise<ClaimedSharePointFiling[]> {
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + (input.leaseMs ?? DEFAULT_LEASE_MS));
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string; tenantId: string; envelopeId: string; envelopeDocumentId: string; connectorId: string }>>(Prisma.sql`
      SELECT f."id", f."tenant_id" AS "tenantId", f."envelope_id" AS "envelopeId", f."envelope_document_id" AS "envelopeDocumentId", f."connector_id" AS "connectorId"
      FROM "esigning_sharepoint_filings" f
      JOIN "esigning_envelopes" e ON e."id" = f."envelope_id"
      JOIN "esigning_envelope_documents" d ON d."id" = f."envelope_document_id"
      WHERE f."tenant_id" = ${input.tenantId}
        ${input.connectorId ? Prisma.sql`AND f."connector_id" = ${input.connectorId}` : Prisma.empty}
        AND e."status" = 'COMPLETED'
        AND e."pdfGenerationStatus" = 'COMPLETED'
        AND d."signedStoragePath" IS NOT NULL
        AND ((f."status" IN ('PENDING', 'FAILED_RETRYABLE') AND f."available_at" <= ${now})
          OR (f."status" = 'PROCESSING' AND f."lease_expires_at" <= ${now}))
      ORDER BY f."available_at" ASC, f."created_at" ASC
      LIMIT ${Math.max(1, Math.min(input.limit, 100))}
      FOR UPDATE SKIP LOCKED
    `);
    const claimed: ClaimedSharePointFiling[] = [];
    for (const row of rows) {
      const claimToken = randomUUID();
      const current = await tx.esigningSharePointFiling.findUnique({ where: { id: row.id }, select: { attempts: true } });
      const result = await tx.esigningSharePointFiling.updateMany({
        where: { id: row.id, tenantId: input.tenantId, OR: [{ status: { in: ['PENDING', 'FAILED_RETRYABLE'] }, availableAt: { lte: now } }, { status: 'PROCESSING', leaseExpiresAt: { not: null, lte: now } }] },
        data: { status: 'PROCESSING', attempts: { increment: 1 }, claimedAt: now, leaseExpiresAt, claimToken },
      });
      if (result.count === 1) claimed.push({ ...row, claimToken, attempts: (current?.attempts ?? 0) + 1 });
    }
    return claimed;
  });
}

export async function releaseExpiredClaims(input: { tenantId?: string; now?: Date }): Promise<number> {
  const now = input.now ?? new Date();
  const result = await prisma.esigningSharePointFiling.updateMany({
    where: { ...(input.tenantId ? { tenantId: input.tenantId } : {}), status: 'PROCESSING', leaseExpiresAt: { not: null, lte: now } },
    data: { status: 'PENDING', availableAt: now, claimedAt: null, leaseExpiresAt: null, claimToken: null },
  });
  return result.count;
}

export async function completeClaim(input: { jobId: string; tenantId: string; claimToken: string; destinationDriveId: string; destinationId: string; targetFileName: string; uploadedDriveId: string; uploadedItemId: string; uploadedWebUrl: string; uploadedFileName: string; sourceSignedHash?: string; sourceSize?: number }): Promise<boolean> {
  const filedAt = new Date();
  const result = await prisma.esigningSharePointFiling.updateMany({
    where: { id: input.jobId, tenantId: input.tenantId, status: 'PROCESSING', claimToken: input.claimToken },
    data: { status: 'COMPLETED', resolvedDestinationDriveId: input.destinationDriveId, resolvedDestinationId: input.destinationId, targetFileName: input.targetFileName, uploadedDriveId: input.uploadedDriveId, uploadedItemId: input.uploadedItemId, uploadedWebUrl: input.uploadedWebUrl, uploadedFileName: input.uploadedFileName, sourceSignedHash: input.sourceSignedHash, sourceSize: input.sourceSize, filedAt, claimedAt: null, leaseExpiresAt: null, claimToken: null, lastErrorCode: null, lastError: null },
  });
  return result.count === 1;
}

export async function failClaim(input: { jobId: string; tenantId: string; claimToken: string; code: string; error: string; retryable: boolean; retryAfterMs?: number }): Promise<'retryable' | 'permanent' | 'review-required' | 'stale-worker'> {
  return prisma.$transaction(async (tx) => {
    const current = await tx.esigningSharePointFiling.findFirst({ where: { id: input.jobId, tenantId: input.tenantId, status: 'PROCESSING', claimToken: input.claimToken }, select: { attempts: true, envelopeDocumentId: true, destinationKind: true } });
    if (!current) return 'stale-worker';
    const review = input.retryable && current.attempts >= MAX_AUTOMATIC_ATTEMPTS;
    const status = review ? 'REVIEW_REQUIRED' : input.retryable ? 'FAILED_RETRYABLE' : 'FAILED_PERMANENT';
    const backoffMs = input.retryAfterMs ?? (5_000 * (2 ** Math.min(current.attempts, 8)));
    const availableAt = review || !input.retryable ? new Date() : new Date(Date.now() + Math.min(backoffMs, 60 * 60_000));
    await tx.esigningSharePointFiling.update({ where: { id: input.jobId }, data: { status, availableAt, lastErrorCode: input.code.slice(0, 100), lastError: input.error.slice(0, 2000), claimedAt: null, leaseExpiresAt: null, claimToken: null } });
    if (status === 'REVIEW_REQUIRED' || status === 'FAILED_PERMANENT') {
      await createAuditLog({ tenantId: input.tenantId, action: status === 'REVIEW_REQUIRED' ? 'UPDATE' : 'UPDATE', entityType: 'EsigningSharePointFiling', entityId: input.jobId, summary: status === 'REVIEW_REQUIRED' ? 'Signed-document SharePoint filing requires review' : 'Signed-document SharePoint filing failed permanently', changeSource: 'SYSTEM', metadata: { errorCode: input.code, destinationKind: current.destinationKind, envelopeDocumentId: current.envelopeDocumentId } }, tx);
    }
    return review ? 'review-required' : input.retryable ? 'retryable' : 'permanent';
  });
}

export async function markClaimReviewRequired(input: {
  jobId: string;
  tenantId: string;
  claimToken: string;
  code: string;
  error: string;
}): Promise<boolean> {
  const result = await prisma.esigningSharePointFiling.updateMany({
    where: { id: input.jobId, tenantId: input.tenantId, status: 'PROCESSING', claimToken: input.claimToken },
    data: {
      status: 'REVIEW_REQUIRED',
      availableAt: new Date(),
      lastErrorCode: input.code.slice(0, 100),
      lastError: input.error.slice(0, 2000),
      claimedAt: null,
      leaseExpiresAt: null,
      claimToken: null,
    },
  });
  if (result.count === 1) {
    await createAuditLog({
      tenantId: input.tenantId,
      action: 'UPDATE',
      entityType: 'EsigningSharePointFiling',
      entityId: input.jobId,
      summary: 'Signed-document SharePoint filing requires manual review',
      changeSource: 'SYSTEM',
      metadata: { errorCode: input.code },
    });
  }
  return result.count === 1;
}

export async function reserveTargetFileName(input: { jobId: string; tenantId: string; connectorId: string; claimToken: string; destinationDriveId: string; destinationId: string; preferredFileName: string; startSuffix?: number; forceNew?: boolean }): Promise<{ targetFileName: string; suffix: number }> {
  const existing = await prisma.esigningSharePointFiling.findFirst({ where: { id: input.jobId, tenantId: input.tenantId, claimToken: input.claimToken }, select: { targetFileName: true, resolvedDestinationDriveId: true, resolvedDestinationId: true } });
  if (!input.forceNew && existing?.targetFileName && existing.resolvedDestinationDriveId === input.destinationDriveId && existing.resolvedDestinationId === input.destinationId) return { targetFileName: existing.targetFileName, suffix: 0 };
  const startSuffix = Math.max(0, Math.min(input.startSuffix ?? 0, MAX_AUTOMATIC_FILENAME_CANDIDATES - 1));
  for (let suffix = startSuffix; suffix < MAX_AUTOMATIC_FILENAME_CANDIDATES; suffix += 1) {
    const targetFileName = signedDocumentFilenameCandidate(input.preferredFileName, suffix);
    try {
      const updated = await prisma.esigningSharePointFiling.updateMany({ where: { id: input.jobId, tenantId: input.tenantId, connectorId: input.connectorId, status: 'PROCESSING', claimToken: input.claimToken }, data: { resolvedDestinationDriveId: input.destinationDriveId, resolvedDestinationId: input.destinationId, targetFileName } });
      if (updated.count !== 1) throw new Error('SharePoint filing claim is no longer owned');
      return { targetFileName, suffix };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') continue;
      throw error;
    }
  }
  throw new Error('SharePoint filename candidates are exhausted');
}

export async function routeClaimToOrphan(input: {
  jobId: string;
  tenantId: string;
  claimToken: string;
  routingReason: 'COMPANY_FOLDER_UNAVAILABLE' | 'DESTINATION_PATH_INVALID';
  errorCode?: string;
  error?: string;
}): Promise<boolean> {
  const result = await prisma.esigningSharePointFiling.updateMany({
    where: { id: input.jobId, tenantId: input.tenantId, status: 'PROCESSING', claimToken: input.claimToken },
    data: {
      destinationKind: 'ORPHAN',
      routingReason: input.routingReason,
      resolvedDestinationDriveId: null,
      resolvedDestinationId: null,
      targetFileName: null,
      lastErrorCode: input.errorCode?.slice(0, 100),
      lastError: input.error?.slice(0, 2000),
    },
  });
  return result.count === 1;
}

export { MAX_AUTOMATIC_ATTEMPTS };
