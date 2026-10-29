/** Recipients of draft e-signing envelopes: add, update, remove and reorder. */

import type { SessionUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/encryption';
import { createAuditLog } from '@/lib/audit';
import {
  ESIGNING_LIMITS,
  type EsigningRecipientInput,
  type UpdateEsigningRecipientInput,
  getEsigningRecipientColor,
} from '@/lib/validations/esigning';
import type { EsigningEnvelopeDetailDto, EsigningManualLinkDto } from '@/types/esigning';
import {
  buildRecipientSigningOrder,
  canMutateEnvelope,
  ensureDuplicateSignerEmails,
  formatUserName,
  resolveEsigningActorScope,
} from '@/services/esigning-envelope.lib';
import { getEsigningEnvelopeDetail } from './lifecycle';
import {
  type PreparedRecipientNotification,
  validateSigningOrderConfiguration,
  prepareRecipientNotifications,
  deliverPreparedNotifications,
} from './shared';

export async function addEsigningEnvelopeRecipient(
  session: SessionUser,
  tenantId: string,
  envelopeId: string,
  input: EsigningRecipientInput
): Promise<EsigningEnvelopeDetailDto> {
  const scope = await resolveEsigningActorScope(session, tenantId);
  const envelope = await prisma.esigningEnvelope.findFirst({
    where: { id: envelopeId, tenantId },
    include: {
      recipients: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          type: true,
          email: true,
          signingOrder: true,
        },
      },
    },
  });

  if (!envelope) {
    throw new Error('Envelope not found');
  }
  if (envelope.status !== 'DRAFT') {
    throw new Error('Recipients can only be added while the envelope is a draft');
  }
  if (!canMutateEnvelope(scope, session, envelope.createdById)) {
    throw new Error('Forbidden');
  }
  if (envelope.recipients.length >= ESIGNING_LIMITS.MAX_RECIPIENTS) {
    throw new Error(`An envelope can have at most ${ESIGNING_LIMITS.MAX_RECIPIENTS} recipients`);
  }

  if ((input.type === 'CC' || input.accessMode !== 'MANUAL_LINK') && !input.email?.trim()) {
    throw new Error(`${input.name} requires an email address for this recipient method`);
  }
  if (input.type === 'CC' && input.accessMode !== 'EMAIL_LINK') {
    throw new Error('Receives Copy recipients are delivered by email');
  }

  const signingOrder = buildRecipientSigningOrder({
    envelopeSigningOrder: envelope.signingOrder,
    requestedSigningOrder: input.signingOrder ?? null,
    recipientType: input.type,
    existingRecipients: envelope.recipients.map((recipient) => ({
      type: recipient.type,
      signingOrder: recipient.signingOrder,
    })),
  });

  ensureDuplicateSignerEmails(
    [
      ...envelope.recipients.map((recipient) => ({
        id: recipient.id,
        email: recipient.email,
        type: recipient.type,
      })),
      {
        id: input.id ?? `new:${input.email ?? input.name}`,
        email: input.email ?? null,
        type: input.type,
      },
    ],
  );

  const signerCount = envelope.recipients.filter((recipient) => recipient.type === 'SIGNER').length;

  await prisma.esigningEnvelopeRecipient.create({
    data: {
      tenantId,
      envelopeId,
      type: input.type,
      name: input.name,
      email: input.email ?? null,
      signingOrder,
      accessMode: input.accessMode,
      accessCodeHash: input.accessCode ? hashPassword(input.accessCode) : null,
      colorTag: input.colorTag ?? getEsigningRecipientColor(signerCount),
      status: envelope.signingOrder === 'PARALLEL' && input.type === 'SIGNER' ? 'QUEUED' : 'QUEUED',
    },
  });

  await createAuditLog({
    tenantId,
    userId: session.id,
    companyId: envelope.companyId ?? undefined,
    action: 'CREATE',
    entityType: 'EsigningEnvelope',
    entityId: envelopeId,
    entityName: envelope.title,
    summary: `Added recipient "${input.name}" to e-signing envelope "${envelope.title}"`,
    metadata: {
      recipientEmail: input.email ?? null,
      recipientType: input.type,
      accessMode: input.accessMode,
    },
  });

  return getEsigningEnvelopeDetail(session, tenantId, envelopeId);
}

export async function updateEsigningEnvelopeRecipient(
  session: SessionUser,
  tenantId: string,
  envelopeId: string,
  recipientId: string,
  input: UpdateEsigningRecipientInput
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
  if (!canMutateEnvelope(scope, session, envelope.createdById)) {
    throw new Error('Forbidden');
  }

  const recipient = envelope.recipients.find((entry) => entry.id === recipientId);
  if (!recipient) {
    throw new Error('Recipient not found');
  }

  const nextType = input.type ?? recipient.type;
  const nextEmail = input.email === undefined ? recipient.email : input.email;
  const nextName = input.name ?? recipient.name;
  const nextAccessMode =
    nextType === 'CC' ? 'EMAIL_LINK' : (input.accessMode ?? recipient.accessMode);

  if ((nextType === 'CC' || nextAccessMode !== 'MANUAL_LINK') && !nextEmail?.trim()) {
    throw new Error(`${nextName} requires an email address for this recipient method`);
  }

  if (envelope.status !== 'DRAFT') {
    if (recipient.status === 'SIGNED' || recipient.status === 'DECLINED') {
      throw new Error('Completed or declined recipients cannot be corrected');
    }

    const disallowedKeys = ['type', 'signingOrder', 'accessMode', 'accessCode', 'colorTag'].filter(
      (key) => key in input
    );
    if (disallowedKeys.length > 0) {
      throw new Error('Only recipient name and email can be corrected after send');
    }
  }

  if (nextType === 'CC') {
    const assignedFieldCount = await prisma.esigningDocumentFieldDefinition.count({
      where: {
        envelopeId,
        recipientId,
      },
    });
    if (assignedFieldCount > 0) {
      throw new Error('Recipients with assigned fields cannot be converted to CC');
    }
  }

  ensureDuplicateSignerEmails(
    envelope.recipients.map((entry) => ({
      id: entry.id,
      email: entry.id === recipientId ? nextEmail : entry.email,
      type: entry.id === recipientId ? nextType : entry.type,
    })),
    envelope.status === 'DRAFT' ? undefined : undefined
  );

  const nextSigningOrder =
    envelope.status === 'DRAFT'
      ? buildRecipientSigningOrder({
          envelopeSigningOrder: envelope.signingOrder,
          requestedSigningOrder:
            input.signingOrder === undefined ? recipient.signingOrder : input.signingOrder,
          recipientType: nextType,
          existingRecipients: envelope.recipients
            .filter((entry) => entry.id !== recipientId)
            .map((entry) => ({
              type: entry.type,
              signingOrder: entry.signingOrder,
            })),
        })
      : recipient.signingOrder;

  let manualLinks: EsigningManualLinkDto[] = [];
  let notifications: PreparedRecipientNotification[] = [];

  if (envelope.status !== 'DRAFT' && (nextEmail !== recipient.email || nextName !== recipient.name)) {
    const isActiveRecipient = recipient.type === 'SIGNER' && ['NOTIFIED', 'VIEWED'].includes(recipient.status);

    if (isActiveRecipient) {
      const prepared = prepareRecipientNotifications([
        {
          id: recipient.id,
          name: nextName,
          email: nextEmail,
          accessMode: nextAccessMode,
        },
      ]);
      manualLinks = prepared.manualLinks;
      notifications = prepared.updates;
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.esigningEnvelopeRecipient.update({
      where: { id: recipientId },
      data: {
        name: nextName,
        email: nextEmail,
        type: envelope.status === 'DRAFT' ? nextType : undefined,
        signingOrder: envelope.status === 'DRAFT' ? nextSigningOrder : undefined,
        accessMode: envelope.status === 'DRAFT' ? nextAccessMode : undefined,
        accessCodeHash:
          envelope.status === 'DRAFT'
            ? input.accessCode === undefined
              ? recipient.accessCodeHash
              : input.accessCode
                ? hashPassword(input.accessCode)
                : null
            : undefined,
        colorTag: envelope.status === 'DRAFT' ? input.colorTag ?? recipient.colorTag : undefined,
        sessionVersion:
          envelope.status === 'DRAFT'
            ? undefined
            : { increment: 1 },
        accessTokenHash:
          envelope.status === 'DRAFT'
            ? undefined
            : notifications[0]?.accessTokenHash ?? null,
      },
    });

    if (envelope.status !== 'DRAFT' && (nextEmail !== recipient.email || nextName !== recipient.name)) {
      await tx.esigningEnvelopeEvent.create({
        data: {
          tenantId,
          envelopeId,
          recipientId,
          action: 'CORRECTED',
          metadata: {
            previousName: recipient.name,
            previousEmail: recipient.email,
            nextName,
            nextEmail,
          },
        },
      });
    }
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
    summary:
      envelope.status === 'DRAFT'
        ? `Updated recipient "${nextName}" on draft e-signing envelope "${envelope.title}"`
        : `Corrected recipient "${nextName}" on e-signing envelope "${envelope.title}"`,
    metadata: {
      recipientId,
      previousName: recipient.name,
      previousEmail: recipient.email,
      nextName,
      nextEmail,
      envelopeStatus: envelope.status,
    },
  });

  return {
    envelope: await getEsigningEnvelopeDetail(session, tenantId, envelopeId),
    manualLinks,
  };
}

export async function removeEsigningEnvelopeRecipient(
  session: SessionUser,
  tenantId: string,
  envelopeId: string,
  recipientId: string
): Promise<EsigningEnvelopeDetailDto> {
  const scope = await resolveEsigningActorScope(session, tenantId);
  const envelope = await prisma.esigningEnvelope.findFirst({
    where: { id: envelopeId, tenantId },
    include: {
      company: {
        select: {
          id: true,
        },
      },
      recipients: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });

  if (!envelope) {
    throw new Error('Envelope not found');
  }
  if (envelope.status !== 'DRAFT') {
    throw new Error('Recipients can only be removed while the envelope is a draft');
  }
  if (!canMutateEnvelope(scope, session, envelope.createdById)) {
    throw new Error('Forbidden');
  }
  if (!envelope.recipients.some((recipient) => recipient.id === recipientId)) {
    throw new Error('Recipient not found');
  }

  const recipient = envelope.recipients.find((entry) => entry.id === recipientId)!;

  await prisma.esigningEnvelopeRecipient.delete({
    where: { id: recipientId },
  });

  await createAuditLog({
    tenantId,
    userId: session.id,
    companyId: envelope.companyId ?? undefined,
    action: 'DELETE',
    entityType: 'EsigningEnvelope',
    entityId: envelopeId,
    entityName: envelope.title,
    summary: `Removed recipient "${recipient.name}" from e-signing envelope "${envelope.title}"`,
    metadata: {
      recipientId,
      recipientEmail: recipient.email,
    },
  });

  return getEsigningEnvelopeDetail(session, tenantId, envelopeId);
}

export async function reorderEsigningEnvelopeRecipients(
  session: SessionUser,
  tenantId: string,
  envelopeId: string,
  input: {
    recipientIds?: string[];
    recipients?: Array<{ recipientId: string; signingOrder: number }>;
  }
): Promise<EsigningEnvelopeDetailDto> {
  const scope = await resolveEsigningActorScope(session, tenantId);
  const envelope = await prisma.esigningEnvelope.findFirst({
    where: { id: envelopeId, tenantId },
    include: {
      recipients: {
        orderBy: [
          { signingOrder: 'asc' },
          { createdAt: 'asc' },
        ],
        select: {
          id: true,
          name: true,
          type: true,
          signingOrder: true,
          createdAt: true,
        },
      },
    },
  });

  if (!envelope) {
    throw new Error('Envelope not found');
  }
  if (envelope.status !== 'DRAFT') {
    throw new Error('Recipients can only be reordered while the envelope is a draft');
  }
  if (envelope.signingOrder === 'PARALLEL') {
    throw new Error('Enable sequential signing before reordering recipients');
  }
  if (!canMutateEnvelope(scope, session, envelope.createdById)) {
    throw new Error('Forbidden');
  }

  const signerRecipients = envelope.recipients.filter((recipient) => recipient.type === 'SIGNER');
  const signerIds = signerRecipients.map((recipient) => recipient.id);
  const recipientIds = input.recipientIds ?? input.recipients?.map((recipient) => recipient.recipientId) ?? [];

  if (signerIds.length !== recipientIds.length) {
    throw new Error('Recipient reorder payload must include every signer exactly once');
  }

  const expected = new Set(signerIds);
  const provided = new Set(recipientIds);
  if (expected.size !== provided.size || signerIds.some((id) => !provided.has(id))) {
    throw new Error('Recipient reorder payload does not match the envelope signers');
  }

  const signingOrderByRecipientId = new Map<string, number>();

  if (input.recipients?.length) {
    input.recipients.forEach((recipient) => {
      signingOrderByRecipientId.set(recipient.recipientId, recipient.signingOrder);
    });

    validateSigningOrderConfiguration({
      envelopeSigningOrder: envelope.signingOrder,
      recipients: envelope.recipients.map((recipient) => ({
        id: recipient.id,
        name: recipient.name,
        type: recipient.type,
        signingOrder:
          recipient.type === 'SIGNER'
            ? signingOrderByRecipientId.get(recipient.id) ?? null
            : recipient.signingOrder,
      })),
    });
  } else {
    recipientIds.forEach((recipientId, index) => {
      signingOrderByRecipientId.set(recipientId, index + 1);
    });
  }

  await prisma.$transaction(
    signerRecipients.map((recipient) =>
      prisma.esigningEnvelopeRecipient.update({
        where: { id: recipient.id },
        data: { signingOrder: signingOrderByRecipientId.get(recipient.id) ?? null },
      })
    )
  );

  return getEsigningEnvelopeDetail(session, tenantId, envelopeId);
}
