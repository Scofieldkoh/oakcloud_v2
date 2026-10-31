/**
 * Sending, resending, voiding and completion retry of e-signing envelopes,
 * plus the scheduled expiry, reminder, cleanup and signer-queue jobs.
 */

import type { SessionUser } from '@/lib/auth';
import { canAccessCompany } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createAuditLog } from '@/lib/audit';
import { storage, StorageKeys } from '@/lib/storage';
import { createEsigningAccessLinkToken, buildEsigningSigningUrl } from '@/lib/esigning-session';
import { ESIGNING_LIMITS } from '@/lib/validations/esigning';
import type { EsigningEnvelopeDetailDto, EsigningManualLinkDto } from '@/types/esigning';
import {
  sendEsigningExpiredEmailToSender,
  sendEsigningExpiryWarningEmailToSender,
  sendEsigningVoidedEmailToRecipient,
} from '@/services/esigning-notification.service';
import {
  recordEsigningEnvelopeEmailDeliveryResults,
  withEsigningDeliveryTarget,
  type RecordedEsigningEmailDeliveryResult,
} from '@/services/esigning-email-delivery.service';
import { detectEsigningFieldOverlapWarnings } from '@/services/esigning-field.service';
import {
  canMutateEnvelope,
  createEnvelopeEvent,
  formatUserName,
  getEnvelopeAggregate,
  getInitialActiveSignerRecipientIds,
  resolveEsigningActorScope,
  selectNextQueuedSignerRecipients,
  validateEnvelopeSendReadiness,
} from '@/services/esigning-envelope.lib';
import { safelyReconcileEsigningEnvelopeTaskOutcomes } from '@/services/tasks/integration.service';
import { lockEsigningEnvelopeForUpdate } from '@/services/esigning-envelope-lock';
import { getEsigningEnvelopeDetail } from './lifecycle';
import {
  log,
  type PreparedRecipientNotification,
  hasRecipientEmail,
  buildConsentDisclosureSnapshot,
  validateSigningOrderConfiguration,
  prepareRecipientNotifications,
  prepareReminderNotifications,
  deliverPreparedNotifications,
  diffInWholeDays,
  getEnvelopeSenderName,
  getSentAtFromEvents,
  isExpiryWarningEvent,
} from './shared';

export async function sendEsigningEnvelope(
  session: SessionUser,
  tenantId: string,
  envelopeId: string
): Promise<{
  envelope: EsigningEnvelopeDetailDto;
  manualLinks: EsigningManualLinkDto[];
}> {
  const scope = await resolveEsigningActorScope(session, tenantId);
  const aggregate = await getEnvelopeAggregate(envelopeId, tenantId);
  const { envelope } = aggregate;

  if (envelope.status !== 'DRAFT') {
    throw new Error('Only draft envelopes can be sent');
  }
  if (!canMutateEnvelope(scope, session, envelope.createdById)) {
    throw new Error('Forbidden');
  }

  validateEnvelopeSendReadiness({
    maxTotalFileSizeBytes: ESIGNING_LIMITS.MAX_TOTAL_FILE_SIZE_BYTES,
    documents: envelope.documents.map((document) => ({
      fileSize: document.fileSize,
    })),
    recipients: envelope.recipients.map((recipient) => ({
      id: recipient.id,
      name: recipient.name,
      email: recipient.email,
      type: recipient.type,
      accessMode: recipient.accessMode,
      accessCodeHash: recipient.accessCodeHash,
    })),
    fieldDefinitions: envelope.fieldDefinitions.map((field) => ({
      id: field.id,
      recipientId: field.recipientId,
      type: field.type,
      documentId: field.documentId,
      pageNumber: field.pageNumber,
      xPercent: field.xPercent,
      yPercent: field.yPercent,
      widthPercent: field.widthPercent,
      heightPercent: field.heightPercent,
    })),
  });
  const fieldWarnings = detectEsigningFieldOverlapWarnings(
    envelope.fieldDefinitions.map((field) => ({
      id: field.id,
      documentId: field.documentId,
      pageNumber: field.pageNumber,
      xPercent: field.xPercent,
      yPercent: field.yPercent,
      widthPercent: field.widthPercent,
      heightPercent: field.heightPercent,
    }))
  );

  const totalPages = envelope.documents.reduce((sum, document) => sum + document.pageCount, 0);
  if (totalPages > ESIGNING_LIMITS.MAX_TOTAL_PAGES) {
    throw new Error(`An envelope cannot exceed ${ESIGNING_LIMITS.MAX_TOTAL_PAGES} pages in total`);
  }

  validateSigningOrderConfiguration({
    envelopeSigningOrder: envelope.signingOrder,
    recipients: envelope.recipients.map((recipient) => ({
      id: recipient.id,
      name: recipient.name,
      type: recipient.type,
      signingOrder: recipient.signingOrder,
    })),
  });

  const initialRecipientIds = getInitialActiveSignerRecipientIds({
    envelopeSigningOrder: envelope.signingOrder,
    recipients: envelope.recipients.map((recipient) => ({
      id: recipient.id,
      type: recipient.type,
      signingOrder: recipient.signingOrder,
    })),
  });

  const activeRecipients = envelope.recipients.filter(
    (recipient) => recipient.type === 'SIGNER' && initialRecipientIds.includes(recipient.id)
  );

  const preparedNotifications = prepareRecipientNotifications(
    activeRecipients.map((recipient) => ({
      id: recipient.id,
      name: recipient.name,
      email: recipient.email,
      accessMode: recipient.accessMode,
    }))
  );

  await prisma.$transaction(async (tx) => {
    await tx.esigningEnvelope.update({
      where: { id: envelopeId },
      data: {
        status: 'SENT',
        consentVersion: '1.0',
        consentDisclosureSnapshot: buildConsentDisclosureSnapshot(),
      },
    });

    for (const recipient of envelope.recipients) {
      const prepared = preparedNotifications.updates.find((entry) => entry.recipientId === recipient.id);
      await tx.esigningEnvelopeRecipient.update({
        where: { id: recipient.id },
        data: {
          status:
            recipient.type === 'SIGNER' && initialRecipientIds.includes(recipient.id)
              ? 'NOTIFIED'
              : 'QUEUED',
          accessTokenHash: prepared?.accessTokenHash ?? null,
          viewedAt: null,
          signedAt: null,
          declinedAt: null,
          declineReason: null,
        },
      });
    }

    if (envelope.fieldDefinitions.length > 0) {
      await tx.esigningDocumentFieldValue.createMany({
        data: envelope.fieldDefinitions.map((field) => ({
          tenantId,
          fieldDefinitionId: field.id,
          recipientId: field.recipientId,
          revision: 1,
        })),
        skipDuplicates: true,
      });
    }

    await tx.esigningEnvelopeEvent.create({
      data: {
        tenantId,
        envelopeId,
        action: 'SENT',
        metadata: {
          activeRecipientIds: initialRecipientIds,
        },
      },
    });
  });
  await safelyReconcileEsigningEnvelopeTaskOutcomes(tenantId, envelopeId, session.id);

  const senderName = formatUserName(
    envelope.createdBy.firstName,
    envelope.createdBy.lastName,
    envelope.createdBy.email
  );
  await deliverPreparedNotifications({
    envelopeId: envelope.id,
    tenantId: envelope.tenantId,
    senderName,
    envelopeTitle: envelope.title,
    emailSubject: envelope.emailSubject ?? envelope.title,
    message: envelope.message,
    expiresAt: envelope.expiresAt,
    notifications: preparedNotifications.updates,
  });

  await createAuditLog({
    tenantId,
    userId: session.id,
    companyId: envelope.companyId ?? undefined,
    action: 'UPDATE',
    entityType: 'EsigningEnvelope',
    entityId: envelopeId,
    entityName: envelope.title,
    summary: `Sent e-signing envelope "${envelope.title}"`,
    metadata: {
      recipientCount: envelope.recipients.length,
      documentCount: envelope.documents.length,
    },
  });

  return {
    envelope: {
      ...(await getEsigningEnvelopeDetail(session, tenantId, envelopeId)),
      fieldWarnings,
    },
    manualLinks: preparedNotifications.manualLinks,
  };
}

export async function resendEsigningEnvelopeRecipient(
  session: SessionUser,
  tenantId: string,
  envelopeId: string,
  recipientId: string
): Promise<{
  envelope: EsigningEnvelopeDetailDto;
  manualLinks: EsigningManualLinkDto[];
}> {
  const scope = await resolveEsigningActorScope(session, tenantId);
  const envelope = await prisma.esigningEnvelope.findFirst({
    where: { id: envelopeId, tenantId },
    include: {
      createdBy: {
        select: {
          firstName: true,
          lastName: true,
          email: true,
        },
      },
      recipients: {
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!envelope) {
    throw new Error('Envelope not found');
  }
  if (!['SENT', 'IN_PROGRESS'].includes(envelope.status)) {
    throw new Error('Only sent or in-progress envelopes can be resent');
  }
  if (!canMutateEnvelope(scope, session, envelope.createdById) && !scope.canManage) {
    throw new Error('Forbidden');
  }
  if (envelope.companyId && !(await canAccessCompany(session, envelope.companyId))) {
    throw new Error('Forbidden');
  }

  const recipient = envelope.recipients.find((entry) => entry.id === recipientId);
  if (!recipient) {
    throw new Error('Recipient not found');
  }
  if (recipient.type !== 'SIGNER') {
    throw new Error('Only signer recipients can receive signing links');
  }
  if (recipient.status === 'SIGNED' || recipient.status === 'DECLINED') {
    throw new Error('Completed or declined recipients cannot be resent');
  }

  const isActiveRecipient = ['NOTIFIED', 'VIEWED'].includes(recipient.status);
  let manualLinks: EsigningManualLinkDto[] = [];
  let notifications: PreparedRecipientNotification[] = [];

  if (isActiveRecipient) {
    const prepared = prepareRecipientNotifications([
      {
        id: recipient.id,
        name: recipient.name,
        email: recipient.email,
        accessMode: recipient.accessMode,
      },
    ]);
    manualLinks = prepared.manualLinks;
    notifications = prepared.updates;
  }

  await prisma.$transaction(async (tx) => {
    await tx.esigningEnvelopeRecipient.update({
      where: { id: recipientId },
      data: {
        sessionVersion: { increment: 1 },
        accessTokenHash: notifications[0]?.accessTokenHash ?? null,
      },
    });

    await tx.esigningEnvelopeEvent.create({
      data: {
        tenantId,
        envelopeId,
        recipientId,
        action: 'REMINDER_SENT',
        metadata: {
          resent: true,
          activeRecipient: isActiveRecipient,
        },
      },
    });
  });

  if (notifications.length > 0) {
    const senderName = formatUserName(
      envelope.createdBy.firstName,
      envelope.createdBy.lastName,
      envelope.createdBy.email
    );
    await deliverPreparedNotifications({
      envelopeId: envelope.id,
      tenantId: envelope.tenantId,
      senderName,
      envelopeTitle: envelope.title,
      emailSubject: envelope.emailSubject ?? envelope.title,
      message: envelope.message,
      expiresAt: envelope.expiresAt,
      notifications,
    });
  }

  await createAuditLog({
    tenantId,
    userId: session.id,
    companyId: envelope.companyId ?? undefined,
    action: 'UPDATE',
    entityType: 'EsigningEnvelope',
    entityId: envelopeId,
    entityName: envelope.title,
    summary: `Resent signing request for "${recipient.name}" on e-signing envelope "${envelope.title}"`,
    metadata: {
      recipientId,
      recipientEmail: recipient.email,
      activeRecipient: isActiveRecipient,
    },
  });

  return {
    envelope: await getEsigningEnvelopeDetail(session, tenantId, envelopeId),
    manualLinks,
  };
}

export async function getEsigningEnvelopeRecipientManualLink(
  session: SessionUser,
  tenantId: string,
  envelopeId: string,
  recipientId: string,
  appBaseUrl?: string
): Promise<EsigningManualLinkDto> {
  const scope = await resolveEsigningActorScope(session, tenantId);
  const envelope = await prisma.esigningEnvelope.findFirst({
    where: { id: envelopeId, tenantId },
    include: {
      recipients: {
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!envelope) {
    throw new Error('Envelope not found');
  }
  if (!['SENT', 'IN_PROGRESS'].includes(envelope.status)) {
    throw new Error('Signer links are available only after the envelope has been sent');
  }
  if (!canMutateEnvelope(scope, session, envelope.createdById) && !scope.canManage) {
    throw new Error('Forbidden');
  }
  if (envelope.companyId && !(await canAccessCompany(session, envelope.companyId))) {
    throw new Error('Forbidden');
  }

  const recipient = envelope.recipients.find((entry) => entry.id === recipientId);
  if (!recipient) {
    throw new Error('Recipient not found');
  }
  if (recipient.type !== 'SIGNER') {
    throw new Error('Only signer recipients have signing links');
  }
  if (recipient.status === 'SIGNED' || recipient.status === 'DECLINED') {
    throw new Error('Completed or declined recipients do not have an active signing link');
  }
  if (!['NOTIFIED', 'VIEWED'].includes(recipient.status)) {
    throw new Error('This signer link will be available once their signing step becomes active');
  }

  const signingToken = await createEsigningAccessLinkToken({
    recipientId: recipient.id,
    envelopeId,
    sessionVersion: recipient.sessionVersion,
  });

  await createAuditLog({
    tenantId,
    userId: session.id,
    companyId: envelope.companyId ?? undefined,
    action: 'UPDATE',
    entityType: 'EsigningEnvelope',
    entityId: envelopeId,
    entityName: envelope.title,
    summary: `Copied signer link for "${recipient.name}"`,
    metadata: {
      recipientId: recipient.id,
      recipientEmail: recipient.email,
    },
  });

  return {
    recipientId: recipient.id,
    recipientName: recipient.name,
    recipientEmail: recipient.email,
    signingUrl: buildEsigningSigningUrl(signingToken, appBaseUrl),
  };
}

export async function resendEsigningEnvelopeActiveRecipients(
  session: SessionUser,
  tenantId: string,
  envelopeId: string
): Promise<{
  envelope: EsigningEnvelopeDetailDto;
  manualLinks: EsigningManualLinkDto[];
}> {
  const scope = await resolveEsigningActorScope(session, tenantId);
  const envelope = await prisma.esigningEnvelope.findFirst({
    where: { id: envelopeId, tenantId },
    include: {
      createdBy: {
        select: {
          firstName: true,
          lastName: true,
          email: true,
        },
      },
      recipients: {
        orderBy: [
          { signingOrder: 'asc' },
          { createdAt: 'asc' },
        ],
      },
    },
  });

  if (!envelope) {
    throw new Error('Envelope not found');
  }
  if (!['SENT', 'IN_PROGRESS'].includes(envelope.status)) {
    throw new Error('Only sent or in-progress envelopes can be resent');
  }
  if (!canMutateEnvelope(scope, session, envelope.createdById) && !scope.canManage) {
    throw new Error('Forbidden');
  }

  const activeRecipients = envelope.recipients.filter(
    (recipient) =>
      recipient.type === 'SIGNER' && ['NOTIFIED', 'VIEWED'].includes(recipient.status)
  );

  if (activeRecipients.length === 0) {
    throw new Error('No active signer is available to resend');
  }

  const preparedNotifications = prepareRecipientNotifications(
    activeRecipients.map((recipient) => ({
      id: recipient.id,
      name: recipient.name,
      email: recipient.email,
      accessMode: recipient.accessMode,
    }))
  );

  await prisma.$transaction(async (tx) => {
    for (const notification of preparedNotifications.updates) {
      await tx.esigningEnvelopeRecipient.update({
        where: { id: notification.recipientId },
        data: {
          sessionVersion: { increment: 1 },
          accessTokenHash: notification.accessTokenHash,
        },
      });

      await tx.esigningEnvelopeEvent.create({
        data: {
          tenantId,
          envelopeId,
          recipientId: notification.recipientId,
          action: 'REMINDER_SENT',
          metadata: {
            resent: true,
            source: 'list_row_action',
          },
        },
      });
    }
  });

  const senderName = formatUserName(
    envelope.createdBy.firstName,
    envelope.createdBy.lastName,
    envelope.createdBy.email
  );

  await deliverPreparedNotifications({
    envelopeId: envelope.id,
    tenantId: envelope.tenantId,
    senderName,
    envelopeTitle: envelope.title,
    emailSubject: envelope.emailSubject ?? envelope.title,
    message: envelope.message,
    expiresAt: envelope.expiresAt,
    notifications: preparedNotifications.updates,
  });

  await createAuditLog({
    tenantId,
    userId: session.id,
    companyId: envelope.companyId ?? undefined,
    action: 'UPDATE',
    entityType: 'EsigningEnvelope',
    entityId: envelopeId,
    entityName: envelope.title,
    summary: `Resent active signing requests for e-signing envelope "${envelope.title}"`,
    metadata: {
      recipientCount: activeRecipients.length,
      recipientIds: activeRecipients.map((recipient) => recipient.id),
    },
  });

  return {
    envelope: await getEsigningEnvelopeDetail(session, tenantId, envelopeId),
    manualLinks: preparedNotifications.manualLinks,
  };
}

export async function voidEsigningEnvelope(
  session: SessionUser,
  tenantId: string,
  envelopeId: string,
  reason?: string | null
): Promise<EsigningEnvelopeDetailDto> {
  const scope = await resolveEsigningActorScope(session, tenantId);
  const envelope = await prisma.esigningEnvelope.findFirst({
    where: { id: envelopeId, tenantId },
    include: {
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
          status: true,
          type: true,
          accessMode: true,
        },
      },
    },
  });

  if (!envelope) {
    throw new Error('Envelope not found');
  }
  if (!['SENT', 'IN_PROGRESS'].includes(envelope.status)) {
    throw new Error('Only sent or in-progress envelopes can be voided');
  }
  if (!scope.canManage && !canMutateEnvelope(scope, session, envelope.createdById)) {
    throw new Error('Forbidden');
  }

  await prisma.$transaction(async (tx) => {
    // Lock first so a void cannot overwrite a completion/decline that committed
    // after the check above, and a racing signer cannot complete a voided
    // envelope.
    const lockedEnvelope = await lockEsigningEnvelopeForUpdate(tx, envelopeId);
    if (!lockedEnvelope) {
      throw new Error('Envelope not found');
    }
    if (!['SENT', 'IN_PROGRESS'].includes(lockedEnvelope.status)) {
      throw new Error('Only sent or in-progress envelopes can be voided');
    }

    await tx.esigningEnvelope.update({
      where: { id: envelopeId },
      data: {
        status: 'VOIDED',
        voidedAt: new Date(),
        voidReason: reason ?? null,
      },
    });

    await tx.esigningEnvelopeRecipient.updateMany({
      where: { envelopeId },
      data: {
        accessTokenHash: null,
        sessionVersion: { increment: 1 },
      },
    });

    await tx.esigningEnvelopeEvent.create({
      data: {
        tenantId,
        envelopeId,
        action: 'VOIDED',
        metadata: reason ? { reason } : undefined,
      },
    });
  });
  await safelyReconcileEsigningEnvelopeTaskOutcomes(tenantId, envelopeId, session.id);

  await createAuditLog({
    tenantId,
    userId: session.id,
    companyId: envelope.companyId ?? undefined,
    action: 'UPDATE',
    entityType: 'EsigningEnvelope',
    entityId: envelopeId,
    entityName: envelope.title,
    summary: `Voided e-signing envelope "${envelope.title}"`,
    reason: reason ?? undefined,
  });

  const senderName = formatUserName(
    envelope.createdBy.firstName,
    envelope.createdBy.lastName,
    envelope.createdBy.email
  );

  const recipientsToNotify = envelope.recipients
    .filter((recipient) => ['QUEUED', 'NOTIFIED', 'VIEWED'].includes(recipient.status))
    // Manual link recipients were never emailed by Oakcloud, so they are not
    // told about the void by email either.
    .filter((recipient) => recipient.accessMode !== 'MANUAL_LINK')
    .filter(hasRecipientEmail);

  const deliveryResults: RecordedEsigningEmailDeliveryResult[] = [];
  for (const recipient of recipientsToNotify) {
    const result = await sendEsigningVoidedEmailToRecipient({
      to: recipient.email,
      recipientName: recipient.name,
      envelopeTitle: envelope.title,
      senderName,
      reason,
    });
    deliveryResults.push(withEsigningDeliveryTarget(result, {
      tenantId: envelope.tenantId,
      targetKey: `recipient:${recipient.id}`,
      audience: 'RECIPIENT',
      recipientId: recipient.id,
    }));
  }
  await recordEsigningEnvelopeEmailDeliveryResults(envelope.id, deliveryResults);

  return getEsigningEnvelopeDetail(session, tenantId, envelopeId);
}

export async function retryEsigningEnvelopeCompletionProcessing(
  session: SessionUser,
  tenantId: string,
  envelopeId: string
): Promise<EsigningEnvelopeDetailDto> {
  const scope = await resolveEsigningActorScope(session, tenantId);
  const envelope = await prisma.esigningEnvelope.findFirst({
    where: { id: envelopeId, tenantId },
    select: {
      id: true,
      status: true,
      title: true,
      companyId: true,
      createdById: true,
      pdfGenerationStatus: true,
      autoFilingStatus: true,
    },
  });

  if (!envelope) {
    throw new Error('Envelope not found');
  }
  if (envelope.status !== 'COMPLETED') {
    throw new Error('Only completed envelopes can retry completion processing');
  }
  if (!scope.canManage && !canMutateEnvelope(scope, session, envelope.createdById)) {
    throw new Error('Forbidden');
  }

  await prisma.$transaction(async (tx) => {
    await tx.esigningEnvelope.updateMany({
      where: {
        id: envelopeId,
        tenantId,
        status: 'COMPLETED',
        pdfGenerationStatus: 'FAILED',
      },
      data: {
        pdfGenerationStatus: 'PENDING',
        pdfGenerationClaimedAt: null,
        pdfGenerationError: null,
      },
    });
    await tx.esigningEnvelope.updateMany({
      where: {
        id: envelopeId,
        tenantId,
        status: 'COMPLETED',
        autoFilingStatus: { in: ['FAILED_RETRYABLE', 'FAILED_PERMANENT'] },
      },
      data: {
        autoFilingStatus: 'PENDING',
        autoFilingAvailableAt: new Date(),
        autoFilingClaimedAt: null,
        autoFilingLeaseExpiresAt: null,
        autoFilingClaimToken: null,
        autoFilingError: null,
      },
    });
    await tx.esigningEmailDelivery.updateMany({
      where: {
        envelopeId,
        tenantId,
        kind: 'COMPLETION',
        status: { in: ['FAILED_RETRYABLE', 'FAILED_PERMANENT'] },
      },
      data: {
        status: 'PENDING',
        availableAt: new Date(),
        claimedAt: null,
        leaseExpiresAt: null,
        claimToken: null,
        lastError: null,
      },
    });
  });

  await createAuditLog({
    tenantId,
    userId: session.id,
    companyId: envelope.companyId ?? undefined,
    action: 'UPDATE',
    entityType: 'EsigningEnvelope',
    entityId: envelopeId,
    entityName: envelope.title,
    summary: `Retried completion processing for "${envelope.title}"`,
  });

  return getEsigningEnvelopeDetail(session, tenantId, envelopeId);
}

export async function processExpiredEsigningEnvelopes(input?: {
  limit?: number;
}): Promise<{
  processed: number;
  expired: number;
}> {
  const now = new Date();
  const limit = input?.limit ?? 50;
  const candidates = await prisma.esigningEnvelope.findMany({
    where: {
      status: { in: ['SENT', 'IN_PROGRESS'] },
      expiresAt: { lte: now },
    },
    orderBy: { expiresAt: 'asc' },
    take: limit,
    include: {
      createdBy: {
        select: {
          firstName: true,
          lastName: true,
          email: true,
        },
      },
      recipients: {
        orderBy: [
          { signingOrder: 'asc' },
          { createdAt: 'asc' },
        ],
        select: {
          id: true,
          name: true,
          email: true,
          type: true,
          status: true,
        },
      },
    },
  });

  let expired = 0;

  for (const envelope of candidates) {
    const expiredEnvelope = await prisma.$transaction(async (tx) => {
      const updateResult = await tx.esigningEnvelope.updateMany({
        where: {
          id: envelope.id,
          status: { in: ['SENT', 'IN_PROGRESS'] },
          expiresAt: { lte: now },
        },
        data: {
          status: 'EXPIRED',
        },
      });

      if (updateResult.count === 0) {
        return false;
      }

      await tx.esigningEnvelopeRecipient.updateMany({
        where: { envelopeId: envelope.id },
        data: {
          accessTokenHash: null,
          sessionVersion: { increment: 1 },
        },
      });

      await tx.esigningEnvelopeEvent.create({
        data: {
          tenantId: envelope.tenantId,
          envelopeId: envelope.id,
          action: 'EXPIRED',
        },
      });

      await createAuditLog(
        {
          tenantId: envelope.tenantId,
          companyId: envelope.companyId ?? undefined,
          action: 'UPDATE',
          entityType: 'EsigningEnvelope',
          entityId: envelope.id,
          entityName: envelope.title,
          summary: `Envelope "${envelope.title}" expired automatically`,
          changeSource: 'SYSTEM',
          metadata: {
            expiredAt: now.toISOString(),
          },
        },
        tx
      );

      return true;
    });

    if (!expiredEnvelope) {
      continue;
    }
    await safelyReconcileEsigningEnvelopeTaskOutcomes(
      envelope.tenantId,
      envelope.id,
    );

    expired += 1;

    const senderName = getEnvelopeSenderName(envelope.createdBy);
    const pendingRecipients = envelope.recipients
      .filter((recipient) => recipient.type === 'SIGNER' && recipient.status !== 'SIGNED')
      .filter(hasRecipientEmail)
      .map((recipient) => ({
        name: recipient.name,
        email: recipient.email,
      }));

    const deliveryResult = await sendEsigningExpiredEmailToSender({
      to: envelope.createdBy.email,
      senderName,
      envelopeTitle: envelope.title,
      expiredAt: envelope.expiresAt ?? now,
      pendingRecipients,
      envelopeId: envelope.id,
    });
    await recordEsigningEnvelopeEmailDeliveryResults(envelope.id, [
      withEsigningDeliveryTarget(deliveryResult, {
        tenantId: envelope.tenantId,
        targetKey: `sender:${envelope.createdById}`,
        audience: 'SENDER',
      }),
    ]);
  }

  return {
    processed: candidates.length,
    expired,
  };
}

export async function processEsigningReminderNotifications(input?: {
  limit?: number;
}): Promise<{
  processed: number;
  remindersSent: number;
  expiryWarningsSent: number;
}> {
  const now = new Date();
  const limit = input?.limit ?? 100;
  const candidates = await prisma.esigningEnvelope.findMany({
    where: {
      status: { in: ['SENT', 'IN_PROGRESS'] },
      OR: [
        { reminderFrequencyDays: { not: null } },
        { expiryWarningDays: { not: null } },
      ],
    },
    orderBy: { updatedAt: 'asc' },
    take: limit,
    include: {
      createdBy: {
        select: {
          firstName: true,
          lastName: true,
          email: true,
        },
      },
      recipients: {
        orderBy: [
          { signingOrder: 'asc' },
          { createdAt: 'asc' },
        ],
        select: {
          id: true,
          name: true,
          email: true,
          type: true,
          status: true,
          accessMode: true,
          lastReminderAt: true,
          sessionVersion: true,
        },
      },
      events: {
        where: {
          action: {
            in: ['SENT', 'REMINDER_SENT'],
          },
        },
        orderBy: { createdAt: 'asc' },
        select: {
          action: true,
          createdAt: true,
          metadata: true,
        },
      },
    },
  });

  let remindersSent = 0;
  let expiryWarningsSent = 0;

  for (const envelope of candidates) {
    if (envelope.expiresAt && envelope.expiresAt <= now) {
      continue;
    }

    const senderName = getEnvelopeSenderName(envelope.createdBy);
    const sentAt = getSentAtFromEvents(envelope.events, envelope.updatedAt);

    if (
      envelope.expiresAt &&
      typeof envelope.expiryWarningDays === 'number' &&
      envelope.expiryWarningDays > 0
    ) {
      const daysUntilExpiry = diffInWholeDays(envelope.expiresAt, now);
      const hasWarningBeenSent = envelope.events.some((event) =>
        isExpiryWarningEvent(event, envelope.expiryWarningDays ?? 0)
      );

      if (
        daysUntilExpiry > 0 &&
        daysUntilExpiry <= envelope.expiryWarningDays &&
        !hasWarningBeenSent
      ) {
        const pendingRecipients = envelope.recipients
          .filter((recipient) => recipient.type === 'SIGNER' && recipient.status !== 'SIGNED')
          .filter(hasRecipientEmail)
          .map((recipient) => ({
            name: recipient.name,
            email: recipient.email,
          }));

        const deliveryResult = await sendEsigningExpiryWarningEmailToSender({
          to: envelope.createdBy.email,
          senderName,
          envelopeTitle: envelope.title,
          daysUntilExpiry,
          pendingRecipients,
          envelopeId: envelope.id,
        });
        await recordEsigningEnvelopeEmailDeliveryResults(envelope.id, [
          withEsigningDeliveryTarget(deliveryResult, {
            tenantId: envelope.tenantId,
            targetKey: `sender:${envelope.createdById}`,
            audience: 'SENDER',
          }),
        ]);

        await createEnvelopeEvent({
          envelopeId: envelope.id,
          tenantId: envelope.tenantId,
          action: 'REMINDER_SENT',
          metadata: {
            kind: 'expiry_warning',
            thresholdDays: envelope.expiryWarningDays,
            daysUntilExpiry,
          },
        });

        expiryWarningsSent += 1;
      }
    }

    if (typeof envelope.reminderFrequencyDays !== 'number' || envelope.reminderFrequencyDays <= 0) {
      continue;
    }

    const reminderStartDays = envelope.reminderStartDays ?? 0;
    if (diffInWholeDays(now, sentAt) < reminderStartDays) {
      continue;
    }

    const recipientsToRemind = envelope.recipients.filter((recipient) => {
      if (recipient.type !== 'SIGNER') {
        return false;
      }
      if (!['NOTIFIED', 'VIEWED'].includes(recipient.status)) {
        return false;
      }
      if (recipient.accessMode === 'MANUAL_LINK') {
        return false;
      }
      if (!recipient.email) {
        return false;
      }

      if (!recipient.lastReminderAt) {
        return true;
      }

      return diffInWholeDays(now, recipient.lastReminderAt) >= envelope.reminderFrequencyDays!;
    });

    if (recipientsToRemind.length === 0) {
      continue;
    }

    const prepared = await prepareReminderNotifications(
      envelope.id,
      recipientsToRemind.map((recipient) => ({
        id: recipient.id,
        name: recipient.name,
        email: recipient.email,
        accessMode: recipient.accessMode,
        sessionVersion: recipient.sessionVersion,
      }))
    );

    await prisma.$transaction(async (tx) => {
      for (const notification of prepared) {
        await tx.esigningEnvelopeRecipient.update({
          where: { id: notification.recipientId },
          data: {
            lastReminderAt: now,
          },
        });

        await tx.esigningEnvelopeEvent.create({
          data: {
            tenantId: envelope.tenantId,
            envelopeId: envelope.id,
            recipientId: notification.recipientId,
            action: 'REMINDER_SENT',
            metadata: {
              kind: 'recipient_reminder',
              automated: true,
            },
          },
        });
      }
    });

    await deliverPreparedNotifications({
      envelopeId: envelope.id,
      tenantId: envelope.tenantId,
      senderName,
      envelopeTitle: envelope.title,
      emailSubject: envelope.emailSubject ?? envelope.title,
      message: envelope.message,
      expiresAt: envelope.expiresAt,
      notifications: prepared,
      kind: 'reminder',
      reminderOccurrenceIso: now.toISOString(),
    });

    remindersSent += prepared.length;
  }

  return {
    processed: candidates.length,
    remindersSent,
    expiryWarningsSent,
  };
}

export async function cleanupEsigningOrphanedStorage(input?: {
  maxKeysPerTenant?: number;
}): Promise<{
  tenantsScanned: number;
  orphanedPrefixes: number;
  deletedPrefixes: number;
  failedPrefixes: string[];
}> {
  const tenants = await prisma.workspace.findMany({
    where: {
      deletedAt: null,
    },
    select: {
      id: true,
    },
  });
  const maxKeysPerTenant = input?.maxKeysPerTenant ?? 10_000;
  const failedPrefixes: string[] = [];
  let orphanedPrefixes = 0;
  let deletedPrefixes = 0;

  for (const tenant of tenants) {
    const files = await storage.list(`${tenant.id}/esigning/`, maxKeysPerTenant);
    if (files.length === 0) {
      continue;
    }

    const envelopeIds = new Set<string>();
    const envelopeKeyRegex = new RegExp(`^${tenant.id}/esigning/([^/]+)/`);
    for (const file of files) {
      const match = file.key.match(envelopeKeyRegex);
      if (match?.[1]) {
        envelopeIds.add(match[1]);
      }
    }

    if (envelopeIds.size === 0) {
      continue;
    }

    const existingEnvelopes = await prisma.esigningEnvelope.findMany({
      where: {
        tenantId: tenant.id,
        id: {
          in: [...envelopeIds],
        },
        deletedAt: null,
      },
      select: {
        id: true,
      },
    });
    const existingEnvelopeIds = new Set(existingEnvelopes.map((envelope) => envelope.id));

    for (const envelopeId of envelopeIds) {
      if (existingEnvelopeIds.has(envelopeId)) {
        continue;
      }

      orphanedPrefixes += 1;
      const prefix = StorageKeys.esigningEnvelopePrefix(tenant.id, envelopeId);

      try {
        const deletedCount = await storage.deletePrefix(prefix);
        if (deletedCount > 0) {
          deletedPrefixes += 1;
        }
      } catch (error) {
        failedPrefixes.push(prefix);
        log.warn('Failed to delete orphaned e-signing storage prefix', {
          tenantId: tenant.id,
          envelopeId,
          prefix,
          error,
        });
      }
    }
  }

  return {
    tenantsScanned: tenants.length,
    orphanedPrefixes,
    deletedPrefixes,
    failedPrefixes,
  };
}

export async function activateNextQueuedEsigningRecipients(
  envelopeId: string
): Promise<EsigningManualLinkDto[]> {
  const envelope = await prisma.esigningEnvelope.findUnique({
    where: { id: envelopeId },
    include: {
      createdBy: {
        select: {
          firstName: true,
          lastName: true,
          email: true,
        },
      },
      recipients: {
        orderBy: [
          { signingOrder: 'asc' },
          { createdAt: 'asc' },
        ],
      },
    },
  });

  if (!envelope || !['SENT', 'IN_PROGRESS'].includes(envelope.status)) {
    return [];
  }

  const activeSignerCount = envelope.recipients.filter(
    (recipient) => recipient.type === 'SIGNER' && ['NOTIFIED', 'VIEWED'].includes(recipient.status)
  ).length;

  if (activeSignerCount > 0) {
    return [];
  }

  const nextRecipientIds = selectNextQueuedSignerRecipients(
    envelope.recipients.map((recipient) => ({
      id: recipient.id,
      type: recipient.type,
      status: recipient.status,
      signingOrder: recipient.signingOrder,
    }))
  );

  if (nextRecipientIds.length === 0) {
    return [];
  }

  const nextRecipients = envelope.recipients.filter((recipient) => nextRecipientIds.includes(recipient.id));
  const preparedNotifications = prepareRecipientNotifications(
    nextRecipients.map((recipient) => ({
      id: recipient.id,
      name: recipient.name,
      email: recipient.email,
      accessMode: recipient.accessMode,
    }))
  );

  await prisma.$transaction(async (tx) => {
    for (const recipient of nextRecipients) {
      const prepared = preparedNotifications.updates.find((entry) => entry.recipientId === recipient.id);
      await tx.esigningEnvelopeRecipient.update({
        where: { id: recipient.id },
        data: {
          status: 'NOTIFIED',
          accessTokenHash: prepared?.accessTokenHash ?? null,
        },
      });
    }
  });

  const senderName = formatUserName(
    envelope.createdBy.firstName,
    envelope.createdBy.lastName,
    envelope.createdBy.email
  );
  await deliverPreparedNotifications({
    envelopeId: envelope.id,
    tenantId: envelope.tenantId,
    senderName,
    envelopeTitle: envelope.title,
    emailSubject: envelope.emailSubject ?? envelope.title,
    message: envelope.message,
    expiresAt: envelope.expiresAt,
    notifications: preparedNotifications.updates,
  });

  return preparedNotifications.manualLinks;
}
