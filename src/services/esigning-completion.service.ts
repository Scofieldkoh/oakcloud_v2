import { randomUUID } from 'node:crypto';
import { v5 as uuidv5 } from 'uuid';
import { Prisma } from '@/generated/prisma';
import { prisma } from '@/lib/prisma';
import { storage, StorageKeys } from '@/lib/storage';
import { ensureFilingJobsForCompletedEnvelope } from '@/services/esigning-sharepoint-filing/enqueue';
import { getEsigningDocumentOriginalFileName } from '@/lib/esigning-document-filename';
import { isEsigningDocumentVisibleToRecipient } from '@/lib/esigning-document-visibility';
import { createAuditLog } from '@/lib/audit';
import { createLogger } from '@/lib/logger';
import type {
  EsigningCompletionDeliveryStatusDto,
  EsigningCopyDeliveryStatusDto,
  EsigningPostCompletionDto,
} from '@/types/esigning';
import type { EsigningPdfGenerationStatus } from '@/generated/prisma';
import { sendEsigningCompletionEmail } from '@/services/esigning-notification.service';
import {
  buildDeliveryDocumentLinks,
  buildEmailAttachments,
  ensureEsigningEnvelopeArtifacts,
  generateEsigningEnvelopeArtifactsNow,
} from '@/services/esigning-pdf.service';

const log = createLogger('esigning-completion');

const PROCESSING_LEASE_MS = 15 * 60 * 1000;
const AUTO_FILE_NAMESPACE = '0ab5455a-3dcf-4660-8dfe-c6bc1d495301';
const AUTO_FILE_AUDIT_NAMESPACE = '6f81c9e1-2b54-4d68-a4c9-8b16e62b0d27';
const MAX_AUTO_FILE_ATTEMPTS = 5;
const MAX_DELIVERY_ATTEMPTS = 5;

type ClaimedCompletionDelivery = {
  id: string;
  tenantId: string;
  envelopeId: string;
  claimToken: string;
};

type ClaimedAutoFileJob = {
  envelopeId: string;
  tenantId: string;
  claimToken: string;
};

type CompletionDeliveryOutcome =
  | { status: 'sent' }
  | { status: 'retryable-failure'; error: string }
  | { status: 'permanent-failure'; error: string }
  | { status: 'stale-worker' };

type AutoFileOutcome =
  | { status: 'completed' }
  | { status: 'retryable-failure'; error: string }
  | { status: 'permanent-failure'; error: string }
  | { status: 'stale-worker' }
  | { status: 'not-required' };

class LostEsigningClaimError extends Error {}

function retryDelay(attemptCount: number): number {
  return Math.min(60 * 60_000, 5_000 * (2 ** Math.min(attemptCount, 8)));
}

function buildSignedPackageFileName(fileName: string): string {
  return fileName.toLowerCase().endsWith('.pdf')
    ? fileName.replace(/\.pdf$/i, '-signed.pdf')
    : `${fileName}-signed.pdf`;
}

export function isTerminalPostCompletionStatus(
  status: string | null | undefined
): boolean {
  return ['NOT_REQUIRED', 'COMPLETED', 'FAILED_PERMANENT'].includes(status ?? '');
}

export function isTerminalEsigningEmailDeliveryStatus(
  status: string | null | undefined
): boolean {
  return ['SUCCEEDED', 'FAILED_PERMANENT'].includes(status ?? '');
}

export function toEsigningCompletionDeliveryDtoStatus(
  status: string | null | undefined
): EsigningCompletionDeliveryStatusDto {
  switch (status) {
    case 'PENDING':
    case 'PROCESSING':
      return 'PENDING';
    case 'FAILED_RETRYABLE':
      return 'RETRYING';
    case 'FAILED_PERMANENT':
      return 'FAILED';
    case 'SUCCEEDED':
      return 'COMPLETED';
    default:
      return 'NOT_TRACKED';
  }
}

export function toEsigningCopyDeliveryDtoStatus(
  status: string | null | undefined
): EsigningCopyDeliveryStatusDto {
  switch (status) {
    case 'PENDING':
    case 'PROCESSING':
      return 'PENDING';
    case 'FAILED_RETRYABLE':
      return 'RETRYING';
    case 'FAILED_PERMANENT':
      return 'FAILED';
    case 'SUCCEEDED':
      return 'SENT';
    default:
      return 'NOT_TRACKED';
  }
}

export function getEsigningPostCompletionSummary(
  envelope: {
    status: string;
    pdfGenerationStatus: string | null | undefined;
    autoFilingStatus: string | null | undefined;
  },
  deliveries: Array<{ kind: string; status: string }>
): EsigningPostCompletionDto {
  const completionDeliveries = deliveries.filter(
    (delivery) =>
      delivery.kind === 'COMPLETION' &&
      (delivery.status === 'PENDING' ||
        delivery.status === 'PROCESSING' ||
        delivery.status === 'SUCCEEDED' ||
        delivery.status === 'FAILED_RETRYABLE' ||
        delivery.status === 'FAILED_PERMANENT')
  );

  const completionDeliveryStatus: EsigningCompletionDeliveryStatusDto =
    envelope.status !== 'COMPLETED'
      ? 'NOT_TRACKED'
      : completionDeliveries.length === 0
        ? 'NOT_TRACKED'
        : completionDeliveries.some(
            (delivery) => delivery.status === 'PENDING' || delivery.status === 'PROCESSING'
          )
          ? 'PENDING'
          : completionDeliveries.some((delivery) => delivery.status === 'FAILED_RETRYABLE')
            ? 'RETRYING'
            : completionDeliveries.some((delivery) => delivery.status === 'FAILED_PERMANENT')
              ? 'FAILED'
              : 'COMPLETED';

  return {
    artifactStatus: (envelope.pdfGenerationStatus ?? null) as EsigningPdfGenerationStatus | null,
    autoFilingStatus: (envelope.autoFilingStatus ?? 'NOT_REQUIRED') as EsigningPostCompletionDto['autoFilingStatus'],
    completionDeliveryStatus,
    failedCompletionDeliveryCount: completionDeliveries.filter(
      (delivery) =>
        delivery.status === 'FAILED_RETRYABLE' || delivery.status === 'FAILED_PERMANENT'
    ).length,
  };
}

type EsigningCompletionDeliveryTargetInput = {
  tenantId: string;
  envelopeId: string;
  completedAt: Date;
  title: string;
  createdById: string;
  senderEmail: string;
  copyEmails: string[];
  recipients: Array<{
    id: string;
    email: string | null;
    type: 'SIGNER' | 'CC';
    accessMode: 'EMAIL_LINK' | 'EMAIL_WITH_CODE' | 'MANUAL_LINK';
  }>;
};

export function buildEsigningCompletionDeliveryTargets(
  input: EsigningCompletionDeliveryTargetInput
) {
  const subject = `Completed: ${input.title}`;
  const seenEmails = new Set<string>();
  const normalizeEmail = (email: string) => email.trim().toLowerCase();
  const targets: Array<{
    tenantId: string;
    envelopeId: string;
    recipientId: string | null;
    audience: 'RECIPIENT' | 'SENDER' | 'COPY';
    kind: 'COMPLETION';
    targetKey: string;
    toEmail: string;
    subject: string;
    status: 'PENDING';
    attemptCount: number;
    availableAt: Date;
  }> = [];

  const addTarget = (target: {
    recipientId: string | null;
    audience: 'RECIPIENT' | 'SENDER' | 'COPY';
    targetKey: string;
    email: string | null;
  }) => {
    if (!target.email?.trim()) {
      return;
    }

    const normalizedEmail = normalizeEmail(target.email);
    if (seenEmails.has(normalizedEmail)) {
      return;
    }
    seenEmails.add(normalizedEmail);
    targets.push({
      tenantId: input.tenantId,
      envelopeId: input.envelopeId,
      recipientId: target.recipientId,
      audience: target.audience,
      kind: 'COMPLETION',
      targetKey: target.targetKey,
      toEmail: normalizedEmail,
      subject,
      status: 'PENDING',
      attemptCount: 0,
      availableAt: input.completedAt,
    });
  };

  addTarget({
    recipientId: null,
    audience: 'SENDER',
    targetKey: `sender:${input.createdById}`,
    email: input.senderEmail,
  });

  [...input.recipients]
    // A manual link controls how the signing request is delivered. Once the
    // envelope is complete, an email address on the recipient is still a
    // valid completion-copy destination.
    .sort((left, right) => Number(left.type === 'CC') - Number(right.type === 'CC'))
    .forEach((recipient) => {
      addTarget({
        recipientId: recipient.id,
        audience: 'RECIPIENT',
        targetKey: `recipient:${recipient.id}`,
        email: recipient.email,
      });
    });

  for (const email of input.copyEmails ?? []) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
      continue;
    }
    addTarget({
      recipientId: null,
      audience: 'COPY',
      targetKey: `copy:${normalizedEmail}`,
      email: normalizedEmail,
    });
  }

  return targets;
}

export async function queueEsigningCompletionWork(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    envelopeId: string;
    completedAt: Date;
  }
): Promise<void> {
  const envelope = await tx.esigningEnvelope.findUnique({
    where: { id: input.envelopeId },
    select: {
      id: true,
      tenantId: true,
      title: true,
      companyId: true,
      createdById: true,
      completionCopyEmails: true,
      recipients: {
        select: {
          id: true,
          email: true,
          type: true,
          accessMode: true,
        },
      },
      createdBy: {
        select: {
          email: true,
        },
      },
    },
  });

  if (!envelope || envelope.tenantId !== input.tenantId) {
    throw new Error('Envelope not found for completion queueing');
  }

  const deliveries = buildEsigningCompletionDeliveryTargets({
    tenantId: input.tenantId,
    envelopeId: input.envelopeId,
    completedAt: input.completedAt,
    title: envelope.title,
    createdById: envelope.createdById,
    senderEmail: envelope.createdBy.email,
    copyEmails: envelope.completionCopyEmails ?? [],
    recipients: envelope.recipients,
  });

  await tx.esigningEmailDelivery.createMany({
    data: deliveries,
    skipDuplicates: true,
  });

  await tx.esigningEnvelope.update({
    where: { id: input.envelopeId },
    data: envelope.companyId
      ? {
          autoFilingStatus: 'PENDING',
          autoFilingAttempts: 0,
          autoFilingAvailableAt: input.completedAt,
          autoFilingError: null,
        }
      : {
          autoFilingStatus: 'NOT_REQUIRED',
      },
  });

  // SharePoint filing is an independent per-document queue. Queue its rows in
  // this same transaction, but never let its state drive the legacy internal
  // auto-filing status above.
  await ensureFilingJobsForCompletedEnvelope(tx, input.envelopeId, input.completedAt);
}

async function claimAutoFileJobs(input: {
  limit: number;
  leaseMs: number;
}): Promise<ClaimedAutoFileJob[]> {
  const now = new Date();
  const leaseExpiry = new Date(now.getTime() + input.leaseMs);

  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string; tenantId: string }>>(Prisma.sql`
      SELECT e."id", e."tenantId"
      FROM "esigning_envelopes" e
      WHERE e."status" = 'COMPLETED'
        AND e."pdfGenerationStatus" = 'COMPLETED'
        AND (
          (
            e."autoFilingStatus" IN ('PENDING', 'FAILED_RETRYABLE')
            AND e."autoFilingAvailableAt" IS NOT NULL
            AND e."autoFilingAvailableAt" <= ${now}
          )
          OR (
            e."autoFilingStatus" = 'PROCESSING'
            AND e."autoFilingLeaseExpiresAt" IS NOT NULL
            AND e."autoFilingLeaseExpiresAt" <= ${now}
          )
        )
      ORDER BY e."autoFilingAvailableAt" ASC
      LIMIT ${input.limit}
      FOR UPDATE SKIP LOCKED
    `);

    const claimed: ClaimedAutoFileJob[] = [];
    for (const row of rows) {
      const claimToken = randomUUID();
      const result = await tx.esigningEnvelope.updateMany({
        where: {
          id: row.id,
          tenantId: row.tenantId,
          status: 'COMPLETED',
          pdfGenerationStatus: 'COMPLETED',
          OR: [
            {
              autoFilingStatus: { in: ['PENDING', 'FAILED_RETRYABLE'] },
              autoFilingAvailableAt: { not: null, lte: now },
            },
            {
              autoFilingStatus: 'PROCESSING',
              autoFilingLeaseExpiresAt: { not: null, lte: now },
            },
          ],
        },
        data: {
          autoFilingStatus: 'PROCESSING',
          autoFilingClaimedAt: now,
          autoFilingLeaseExpiresAt: leaseExpiry,
          autoFilingClaimToken: claimToken,
        },
      });
      if (result.count === 1) {
        claimed.push({ envelopeId: row.id, tenantId: row.tenantId, claimToken });
      }
    }
    return claimed;
  });
}

async function isAutoFileClaimCurrent(
  claim: ClaimedAutoFileJob,
  tx?: Prisma.TransactionClient
): Promise<boolean> {
  const db = tx ?? prisma;
  const current = await db.esigningEnvelope.findFirst({
    where: {
      id: claim.envelopeId,
      tenantId: claim.tenantId,
      autoFilingStatus: 'PROCESSING',
      autoFilingClaimToken: claim.claimToken,
    },
    select: { id: true },
  });
  return current !== null;
}

async function persistAutoFileFailure(
  claim: ClaimedAutoFileJob,
  error: unknown
): Promise<AutoFileOutcome> {
  const message = error instanceof Error ? error.message : 'Unknown auto-file failure';

  return prisma.$transaction(async (tx) => {
    const current = await tx.esigningEnvelope.findFirst({
      where: {
        id: claim.envelopeId,
        tenantId: claim.tenantId,
        autoFilingStatus: 'PROCESSING',
        autoFilingClaimToken: claim.claimToken,
      },
      select: { autoFilingAttempts: true },
    });
    if (!current) {
      return { status: 'stale-worker' as const };
    }

    const attemptCount = current.autoFilingAttempts + 1;
    const permanent = attemptCount >= MAX_AUTO_FILE_ATTEMPTS;
    const updated = await tx.esigningEnvelope.updateMany({
      where: {
        id: claim.envelopeId,
        tenantId: claim.tenantId,
        autoFilingStatus: 'PROCESSING',
        autoFilingClaimToken: claim.claimToken,
      },
      data: {
        autoFilingStatus: permanent ? 'FAILED_PERMANENT' : 'FAILED_RETRYABLE',
        autoFilingAttempts: attemptCount,
        autoFilingAvailableAt: permanent
          ? null
          : new Date(Date.now() + retryDelay(attemptCount)),
        autoFilingClaimedAt: null,
        autoFilingLeaseExpiresAt: null,
        autoFilingClaimToken: null,
        autoFilingError: message,
      },
    });
    if (updated.count !== 1) {
      return { status: 'stale-worker' as const };
    }

    log.error('E-signing auto-file failed', {
      envelopeId: claim.envelopeId,
      attemptCount,
      status: permanent ? 'FAILED_PERMANENT' : 'FAILED_RETRYABLE',
      error,
    });
    return {
      status: permanent ? 'permanent-failure' as const : 'retryable-failure' as const,
      error: message,
    };
  });
}

export async function processEsigningAutoFileJob(
  claim: ClaimedAutoFileJob
): Promise<AutoFileOutcome> {
  try {
    const envelope = await prisma.esigningEnvelope.findFirst({
      where: {
        id: claim.envelopeId,
        tenantId: claim.tenantId,
        autoFilingStatus: 'PROCESSING',
        autoFilingClaimToken: claim.claimToken,
      },
      select: {
        id: true,
        tenantId: true,
        title: true,
        companyId: true,
        createdById: true,
        certificateId: true,
        documents: {
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            fileName: true,
            originalFileName: true,
            signedStoragePath: true,
          },
        },
      },
    });

    if (!envelope) {
      return { status: 'stale-worker' };
    }

    if (!envelope.companyId) {
      const updated = await prisma.esigningEnvelope.updateMany({
        where: {
          id: claim.envelopeId,
          tenantId: claim.tenantId,
          autoFilingStatus: 'PROCESSING',
          autoFilingClaimToken: claim.claimToken,
        },
        data: {
          autoFilingStatus: 'NOT_REQUIRED',
          autoFilingAttempts: 0,
          autoFilingAvailableAt: null,
          autoFilingClaimedAt: null,
          autoFilingLeaseExpiresAt: null,
          autoFilingClaimToken: null,
          autoFilingError: null,
        },
      });
      return updated.count === 1 ? { status: 'not-required' } : { status: 'stale-worker' };
    }

    for (const document of envelope.documents) {
      if (!document.signedStoragePath) {
        throw new Error(`Signed document "${document.fileName}" is missing`);
      }
      if (!(await isAutoFileClaimCurrent(claim))) {
        return { status: 'stale-worker' };
      }

      const signedBuffer = await storage.download(document.signedStoragePath);
      if (!(await isAutoFileClaimCurrent(claim))) {
        return { status: 'stale-worker' };
      }

      const companyDocumentId = uuidv5(
        `${envelope.id}:${document.id}:signed-package`,
        AUTO_FILE_NAMESPACE
      );
      const fileName = `${companyDocumentId}.pdf`;
      const originalFileName = buildSignedPackageFileName(
        getEsigningDocumentOriginalFileName(document),
      );
      const storageKey = StorageKeys.documentOriginal(
        envelope.tenantId,
        envelope.companyId,
        companyDocumentId,
        '.pdf'
      );
      const fileSize = signedBuffer.byteLength;
      const filedAt = new Date();

      await storage.upload(storageKey, signedBuffer, {
        contentType: 'application/pdf',
        metadata: {
          tenantId: envelope.tenantId,
          companyId: envelope.companyId,
          envelopeId: envelope.id,
          envelopeDocumentId: document.id,
          certificateId: envelope.certificateId,
          originalFileName,
        },
      });
      if (!(await isAutoFileClaimCurrent(claim))) {
        return { status: 'stale-worker' };
      }

      const auditId = uuidv5(
        `${envelope.id}:${document.id}:audit`,
        AUTO_FILE_AUDIT_NAMESPACE
      );
      await prisma.$transaction(async (tx) => {
        if (!(await isAutoFileClaimCurrent(claim, tx))) {
          throw new LostEsigningClaimError();
        }

        await tx.document.upsert({
          where: { id: companyDocumentId },
          update: {
            tenantId: envelope.tenantId,
            companyId: envelope.companyId,
            uploadedById: envelope.createdById,
            documentType: 'E_SIGNED_PACKAGE',
            fileName,
            originalFileName,
            storageKey,
            fileSize,
            mimeType: 'application/pdf',
            extractionStatus: 'COMPLETED',
            extractedAt: filedAt,
            isLatest: true,
            deletedAt: null,
            deletedReason: null,
          },
          create: {
            id: companyDocumentId,
            tenantId: envelope.tenantId,
            companyId: envelope.companyId,
            uploadedById: envelope.createdById,
            documentType: 'E_SIGNED_PACKAGE',
            fileName,
            originalFileName,
            storageKey,
            fileSize,
            mimeType: 'application/pdf',
            version: 1,
            isLatest: true,
            extractionStatus: 'COMPLETED',
            extractedAt: filedAt,
          },
        });

        await createAuditLog(
          {
            id: auditId,
            tenantId: envelope.tenantId,
            userId: envelope.createdById,
            companyId: envelope.companyId ?? undefined,
            action: 'UPLOAD',
            entityType: 'Document',
            entityId: companyDocumentId,
            entityName: originalFileName,
            summary: `Auto-filed signed package "${originalFileName}" from e-signing envelope "${envelope.title}"`,
            changeSource: 'SYSTEM',
            metadata: {
              envelopeId: envelope.id,
              envelopeDocumentId: document.id,
              certificateId: envelope.certificateId,
            },
          },
          tx
        );
      });
    }

    const completed = await prisma.esigningEnvelope.updateMany({
      where: {
        id: claim.envelopeId,
        tenantId: claim.tenantId,
        autoFilingStatus: 'PROCESSING',
        autoFilingClaimToken: claim.claimToken,
      },
      data: {
        autoFilingStatus: 'COMPLETED',
        autoFilingAttempts: 0,
        autoFilingAvailableAt: null,
        autoFilingClaimedAt: null,
        autoFilingLeaseExpiresAt: null,
        autoFilingClaimToken: null,
        autoFilingError: null,
      },
    });
    return completed.count === 1 ? { status: 'completed' } : { status: 'stale-worker' };
  } catch (error) {
    if (error instanceof LostEsigningClaimError) {
      return { status: 'stale-worker' };
    }
    return persistAutoFileFailure(claim, error);
  }
}

async function claimCompletionDeliveries(input: {
  limit: number;
  leaseMs: number;
}): Promise<ClaimedCompletionDelivery[]> {
  const now = new Date();
  const leaseExpiry = new Date(now.getTime() + input.leaseMs);

  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<
      Array<{ id: string; tenantId: string; envelopeId: string }>
    >(Prisma.sql`
      SELECT d."id", d."tenantId", d."envelopeId"
      FROM "esigning_email_deliveries" d
      JOIN "esigning_envelopes" e ON e."id" = d."envelopeId"
      WHERE d."kind" = 'COMPLETION'
        AND e."status" = 'COMPLETED'
        AND e."pdfGenerationStatus" = 'COMPLETED'
        AND (
          (
            d."status" IN ('PENDING', 'FAILED_RETRYABLE')
            AND d."availableAt" <= ${now}
          )
          OR (
            d."status" = 'PROCESSING'
            AND d."leaseExpiresAt" <= ${now}
          )
        )
      ORDER BY d."availableAt" ASC
      LIMIT ${input.limit}
      FOR UPDATE SKIP LOCKED
    `);

    const claimed: ClaimedCompletionDelivery[] = [];
    for (const row of rows) {
      const claimToken = randomUUID();
      const result = await tx.esigningEmailDelivery.updateMany({
        where: {
          id: row.id,
          tenantId: row.tenantId,
          envelopeId: row.envelopeId,
          kind: 'COMPLETION',
          OR: [
            {
              status: { in: ['PENDING', 'FAILED_RETRYABLE'] },
              availableAt: { lte: now },
            },
            {
              status: 'PROCESSING',
              leaseExpiresAt: { lte: now },
            },
          ],
        },
        data: {
          status: 'PROCESSING',
          claimedAt: now,
          leaseExpiresAt: leaseExpiry,
          claimToken,
        },
      });
      if (result.count === 1) {
        claimed.push({
          id: row.id,
          tenantId: row.tenantId,
          envelopeId: row.envelopeId,
          claimToken,
        });
      }
    }
    return claimed;
  });
}

async function persistCompletionDeliverySuccess(input: {
  claim: ClaimedCompletionDelivery;
  delivery: {
    toEmail: string;
    subject: string;
  };
  attemptedAt: Date;
  providerMessageId: string | null;
}): Promise<CompletionDeliveryOutcome> {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.esigningEmailDelivery.updateMany({
      where: {
        id: input.claim.id,
        tenantId: input.claim.tenantId,
        envelopeId: input.claim.envelopeId,
        kind: 'COMPLETION',
        status: 'PROCESSING',
        claimToken: input.claim.claimToken,
      },
      data: {
        status: 'SUCCEEDED',
        attemptCount: { increment: 1 },
        availableAt: input.attemptedAt,
        claimedAt: null,
        leaseExpiresAt: null,
        claimToken: null,
        lastAttemptedAt: input.attemptedAt,
        sentAt: input.attemptedAt,
        lastError: null,
      },
    });
    if (updated.count !== 1) {
      return { status: 'stale-worker' as const };
    }

    // At-least-once worker boundary: a provider success followed by a database
    // outage can still cause a retry unless the provider supports idempotency
    // keys. The configured provider abstraction does not yet expose one.
    await tx.esigningEmailDeliveryAttempt.create({
      data: {
        deliveryId: input.claim.id,
        toEmail: input.delivery.toEmail,
        subject: input.delivery.subject,
        succeeded: true,
        providerMessageId: input.providerMessageId,
        attemptedAt: input.attemptedAt,
      },
    });
    return { status: 'sent' as const };
  });
}

async function persistCompletionDeliveryFailure(
  claim: ClaimedCompletionDelivery,
  attemptedAt: Date,
  error: string
): Promise<CompletionDeliveryOutcome> {
  return prisma.$transaction(async (tx) => {
    const current = await tx.esigningEmailDelivery.findFirst({
      where: {
        id: claim.id,
        tenantId: claim.tenantId,
        envelopeId: claim.envelopeId,
        kind: 'COMPLETION',
        status: 'PROCESSING',
        claimToken: claim.claimToken,
      },
      select: { attemptCount: true, toEmail: true, subject: true },
    });
    if (!current) {
      return { status: 'stale-worker' as const };
    }

    const attemptCount = current.attemptCount + 1;
    const permanent = attemptCount >= MAX_DELIVERY_ATTEMPTS;
    const updated = await tx.esigningEmailDelivery.updateMany({
      where: {
        id: claim.id,
        tenantId: claim.tenantId,
        envelopeId: claim.envelopeId,
        kind: 'COMPLETION',
        status: 'PROCESSING',
        claimToken: claim.claimToken,
      },
      data: {
        status: permanent ? 'FAILED_PERMANENT' : 'FAILED_RETRYABLE',
        attemptCount,
        availableAt: permanent
          ? attemptedAt
          : new Date(attemptedAt.getTime() + retryDelay(attemptCount)),
        claimedAt: null,
        leaseExpiresAt: null,
        claimToken: null,
        lastAttemptedAt: attemptedAt,
        lastError: error,
      },
    });
    if (updated.count !== 1) {
      return { status: 'stale-worker' as const };
    }

    await tx.esigningEmailDeliveryAttempt.create({
      data: {
        deliveryId: claim.id,
        toEmail: current.toEmail,
        subject: current.subject,
        succeeded: false,
        error,
        attemptedAt,
      },
    });

    log.error('E-signing completion delivery failed', {
      deliveryId: claim.id,
      attemptCount,
      status: permanent ? 'FAILED_PERMANENT' : 'FAILED_RETRYABLE',
      error,
    });
    return {
      status: permanent ? 'permanent-failure' as const : 'retryable-failure' as const,
      error,
    };
  });
}

export async function processEsigningCompletionDelivery(
  claim: ClaimedCompletionDelivery
): Promise<CompletionDeliveryOutcome> {
  const attemptedAt = new Date();

  try {
    const delivery = await prisma.esigningEmailDelivery.findFirst({
      where: {
        id: claim.id,
        tenantId: claim.tenantId,
        envelopeId: claim.envelopeId,
        kind: 'COMPLETION',
        status: 'PROCESSING',
        claimToken: claim.claimToken,
      },
      include: {
        envelope: {
          select: {
            id: true,
            tenantId: true,
            title: true,
            certificateId: true,
            createdById: true,
            metadata: true,
            createdBy: {
              select: {
                firstName: true,
                lastName: true,
                email: true,
              },
            },
            recipients: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
            documents: {
              orderBy: { sortOrder: 'asc' },
              select: {
                id: true,
                fileName: true,
                originalFileName: true,
                signedStoragePath: true,
              },
            },
            fieldDefinitions: {
              select: {
                documentId: true,
                recipientId: true,
              },
            },
          },
        },
      },
    });

    if (!delivery) {
      return { status: 'stale-worker' };
    }
    if (delivery.envelope.documents.length === 0) {
      throw new Error('Completed envelope has no signed documents to deliver');
    }

    const isRecipientDelivery = delivery.audience === 'RECIPIENT';
    const recipientId = isRecipientDelivery ? delivery.recipientId ?? undefined : undefined;
    if (isRecipientDelivery && !recipientId) {
      throw new Error('Completion recipient is missing its recipient identity');
    }

    const deliveryDocuments =
      isRecipientDelivery
        ? delivery.envelope.documents.filter((document) =>
            isEsigningDocumentVisibleToRecipient({
              metadata: delivery.envelope.metadata,
              documentId: document.id,
              recipientId: recipientId as string,
              fieldDefinitions: delivery.envelope.fieldDefinitions,
            })
          )
        : delivery.envelope.documents;

    if (deliveryDocuments.length === 0) {
      throw new Error('No documents are visible to this completion recipient');
    }
    await ensureEsigningEnvelopeArtifacts({
      envelopeId: delivery.envelope.id,
      requireCertificates: true,
    });

    if (deliveryDocuments.some((document) => !document.signedStoragePath)) {
      throw new Error('Signed artifacts are not ready for delivery');
    }

    const [certificateBuffer, signedBuffers] = await Promise.all([
      storage.download(
        StorageKeys.esigningEnvelopeCertificate(
          delivery.envelope.tenantId,
          delivery.envelope.id,
        ),
      ),
      Promise.all(
        deliveryDocuments.map(async (document) => ({
          id: document.id,
          fileName: document.fileName,
          originalFileName: document.originalFileName,
          signedBuffer: await storage.download(document.signedStoragePath as string),
        })),
      ),
    ]);
    const documentsWithCertificate = signedBuffers.map((document) => ({
      ...document,
      certificateBuffer,
    }));
    const attachments = await buildEmailAttachments({ documents: documentsWithCertificate });
    const actorType = isRecipientDelivery ? 'recipient' : 'sender';
    const documentLinks = await buildDeliveryDocumentLinks({
      envelopeId: delivery.envelope.id,
      actorType,
      recipientId,
      documents: deliveryDocuments.map((document) => ({
        id: document.id,
        fileName: document.fileName,
        originalFileName: document.originalFileName,
      })),
    });
    const recipientName =
      delivery.audience === 'SENDER'
        ? [delivery.envelope.createdBy.firstName, delivery.envelope.createdBy.lastName]
            .filter(Boolean)
            .join(' ')
            .trim() || delivery.envelope.createdBy.email
        : delivery.audience === 'COPY'
          ? 'there'
          : delivery.envelope.recipients.find((recipient) => recipient.id === delivery.recipientId)?.name
            ?? 'there';

    const isBccDelivery = delivery.audience === 'COPY';
    const result = await sendEsigningCompletionEmail({
      to: isBccDelivery ? undefined : delivery.toEmail,
      bcc: isBccDelivery ? delivery.toEmail : undefined,
      recipientName,
      envelopeTitle: delivery.envelope.title,
      certificateId: delivery.envelope.certificateId,
      documentLinks,
      attachments,
      actorType,
    });

    if (!result.ok) {
      return persistCompletionDeliveryFailure(
        claim,
        attemptedAt,
        result.error ?? 'Email provider did not accept the message'
      );
    }

    return persistCompletionDeliverySuccess({
      claim,
      delivery: {
        toEmail: delivery.toEmail,
        subject: delivery.subject,
      },
      attemptedAt,
      providerMessageId: result.providerMessageId ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown delivery failure';
    return persistCompletionDeliveryFailure(claim, attemptedAt, message);
  }
}

export async function processQueuedEsigningCompletionWork(input?: {
  limit?: number;
  concurrency?: number;
  leaseMs?: number;
}): Promise<{
  processed: number;
  artifactsCompleted: number;
  artifactsFailed: number;
  artifactsSkipped: number;
  autoFiled: number;
  autoFileFailed: number;
  autoFileRetryableFailed: number;
  autoFilePermanentFailed: number;
  autoFileStale: number;
  autoFileNotRequired: number;
  deliveriesSent: number;
  deliveryFailed: number;
  deliveryRetryableFailed: number;
  deliveryPermanentFailed: number;
  deliveryStale: number;
}> {
  const limit = input?.limit ?? 5;
  const concurrency = Math.max(1, input?.concurrency ?? 1);
  const leaseMs = input?.leaseMs ?? PROCESSING_LEASE_MS;
  const staleBefore = new Date(Date.now() - PROCESSING_LEASE_MS);

  let artifactsCompleted = 0;
  let artifactsFailed = 0;
  let artifactsSkipped = 0;
  let autoFiled = 0;
  let autoFileRetryableFailed = 0;
  let autoFilePermanentFailed = 0;
  let autoFileStale = 0;
  let autoFileNotRequired = 0;
  let deliveriesSent = 0;
  let deliveryRetryableFailed = 0;
  let deliveryPermanentFailed = 0;
  let deliveryStale = 0;

  const artifactCandidates = await prisma.esigningEnvelope.findMany({
    where: {
      status: 'COMPLETED',
      OR: [
        { pdfGenerationStatus: 'PENDING' },
        {
          pdfGenerationStatus: 'PROCESSING',
          pdfGenerationClaimedAt: { lt: staleBefore },
        },
      ],
    },
    orderBy: { updatedAt: 'asc' },
    take: limit,
    select: { id: true },
  });

  for (let index = 0; index < artifactCandidates.length; index += concurrency) {
    const batch = artifactCandidates.slice(index, index + concurrency);
    const results = await Promise.allSettled(
      batch.map(async (candidate) => {
        const outcome = await generateEsigningEnvelopeArtifactsNow({ envelopeId: candidate.id });
        return outcome;
      })
    );
    for (const result of results) {
      if (result.status === 'fulfilled') {
        if (result.value === 'generated') {
          artifactsCompleted += 1;
        } else {
          artifactsSkipped += 1;
        }
      } else {
        artifactsFailed += 1;
      }
    }
  }

  const autoFileClaims = await claimAutoFileJobs({ limit, leaseMs });
  for (let index = 0; index < autoFileClaims.length; index += concurrency) {
    const batch = autoFileClaims.slice(index, index + concurrency);
    const outcomes = await Promise.all(batch.map(processEsigningAutoFileJob));
    for (const outcome of outcomes) {
      switch (outcome.status) {
        case 'completed':
          autoFiled += 1;
          break;
        case 'retryable-failure':
          autoFileRetryableFailed += 1;
          break;
        case 'permanent-failure':
          autoFilePermanentFailed += 1;
          break;
        case 'stale-worker':
          autoFileStale += 1;
          break;
        case 'not-required':
          autoFileNotRequired += 1;
          break;
      }
    }
  }

  const deliveryClaims = await claimCompletionDeliveries({ limit, leaseMs });
  for (let index = 0; index < deliveryClaims.length; index += concurrency) {
    const batch = deliveryClaims.slice(index, index + concurrency);
    const outcomes = await Promise.all(batch.map(processEsigningCompletionDelivery));
    for (const outcome of outcomes) {
      switch (outcome.status) {
        case 'sent':
          deliveriesSent += 1;
          break;
        case 'retryable-failure':
          deliveryRetryableFailed += 1;
          break;
        case 'permanent-failure':
          deliveryPermanentFailed += 1;
          break;
        case 'stale-worker':
          deliveryStale += 1;
          break;
      }
    }
  }

  const autoFileFailed = autoFileRetryableFailed + autoFilePermanentFailed;
  const deliveryFailed = deliveryRetryableFailed + deliveryPermanentFailed;
  return {
    processed:
      artifactsCompleted +
      artifactsFailed +
      autoFiled +
      autoFileFailed +
      autoFileNotRequired +
      deliveriesSent +
      deliveryFailed,
    artifactsCompleted,
    artifactsFailed,
    artifactsSkipped,
    autoFiled,
    autoFileFailed,
    autoFileRetryableFailed,
    autoFilePermanentFailed,
    autoFileStale,
    autoFileNotRequired,
    deliveriesSent,
    deliveryFailed,
    deliveryRetryableFailed,
    deliveryPermanentFailed,
    deliveryStale,
  };
}
