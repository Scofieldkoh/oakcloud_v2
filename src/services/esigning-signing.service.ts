import { prisma } from '@/lib/prisma';
import { randomUUID } from 'node:crypto';
import { verifyPassword } from '@/lib/encryption';
import {
  clearEsigningChallengeCookie,
  clearEsigningSessionCookie,
  createEsigningDownloadToken,
  getEsigningChallengeClaims,
  getEsigningSessionClaims,
  hashEsigningAccessToken,
  setEsigningChallengeCookie,
  setEsigningSessionCookie,
  verifyEsigningAccessLinkToken,
  verifyEsigningScopedToken,
} from '@/lib/esigning-session';
import type { SaveEsigningFieldValuesInput } from '@/lib/validations/esigning';
import type {
  EsigningSignedSignatureDto,
  EsigningSigningSessionDto,
  EsigningSigningSessionStatusDto,
} from '@/types/esigning';
import type { EsigningEnvelopeStatus, Prisma } from '@/generated/prisma';
import { storage } from '@/lib/storage';
import {
  getEsigningDocumentOriginalFileName,
  getEsigningDocumentPdfFileName,
  getEsigningDocumentVariantFileName,
} from '@/lib/esigning-document-filename';
import {
  getEsigningDocumentVisibility,
  isEsigningDocumentVisibleToRecipient,
} from '@/lib/esigning-document-visibility';
import { createLogger } from '@/lib/logger';
import { sendEsigningDeclinedEmailToSender } from '@/services/esigning-notification.service';
import { activateNextQueuedEsigningRecipients } from '@/services/esigning-envelope.service';
import {
  recordEsigningEnvelopeEmailDeliveryResults,
  withEsigningDeliveryTarget,
} from '@/services/esigning-email-delivery.service';
import { summarizeEsigningUserAgent } from '@/services/esigning-evidence';
import { isRequiredEsigningFieldComplete, saveRecipientFieldValues } from '@/services/esigning-field.service';
import {
  getEsigningPostCompletionSummary,
  isTerminalEsigningEmailDeliveryStatus,
  isTerminalPostCompletionStatus,
  queueEsigningCompletionWork,
  toEsigningCopyDeliveryDtoStatus,
} from '@/services/esigning-completion.service';
import { safelyReconcileEsigningEnvelopeTaskOutcomes } from '@/services/tasks/integration.service';
import {
  processQueuedServiceAgreementActivations,
  queueServiceAgreementActivationsForEnvelope,
} from '@/services/service-agreement';

const log = createLogger('esigning-signing');

export async function safelyProcessServiceAgreementActivations(envelopeId: string): Promise<void> {
  try {
    await processQueuedServiceAgreementActivations({ limit: 10, concurrency: 2 });
  } catch (error) {
    const correlationId = randomUUID();
    log.warn('Service Agreement activation will be retried by the scheduler', {
      envelopeId,
      correlationId,
      error,
    });
  }
}

export async function processEsigningCompletionArtifacts(input: {
  envelopeCompleted: boolean;
  envelopeId: string;
}): Promise<void> {
  if (!input.envelopeCompleted) {
    return;
  }

  try {
    const { generateEsigningEnvelopeArtifactsNow } = await import(
      '@/services/esigning-pdf.service'
    );
    await generateEsigningEnvelopeArtifactsNow({ envelopeId: input.envelopeId });
  } catch (error) {
    const correlationId = randomUUID();
    log.warn('Immediate signed-document generation failed', {
      envelopeId: input.envelopeId,
      correlationId,
      error,
    });
  }
}

export async function finalizeEsigningEnvelopeCompletion(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    envelopeId: string;
    currentStatus: EsigningEnvelopeStatus;
    remainingSignerCount: number;
    completedAt: Date;
  },
): Promise<boolean> {
  if (input.remainingSignerCount === 0) {
    const completionUpdate = await tx.esigningEnvelope.updateMany({
      where: {
        id: input.envelopeId,
        status: { in: ['SENT', 'IN_PROGRESS'] },
      },
      data: {
        status: 'COMPLETED',
        completedAt: input.completedAt,
        pdfGenerationStatus: 'PENDING',
        pdfGenerationClaimedAt: null,
        pdfGenerationError: null,
      },
    });
    if (completionUpdate.count === 0) return false;

    await tx.generatedDocument?.updateMany({
      where: {
        tenantId: input.tenantId,
        signedAt: null,
        esigningEnvelopeDocuments: {
          some: { envelopeId: input.envelopeId },
        },
      },
      data: { signedAt: input.completedAt },
    });

    await tx.esigningEnvelopeEvent.create({
      data: {
        tenantId: input.tenantId,
        envelopeId: input.envelopeId,
        action: 'COMPLETED',
      },
    });
    await queueServiceAgreementActivationsForEnvelope(tx, input.envelopeId, input.completedAt);
    await queueEsigningCompletionWork(tx, {
      tenantId: input.tenantId,
      envelopeId: input.envelopeId,
      completedAt: input.completedAt,
    });
    return true;
  }

  if (input.currentStatus === 'SENT') {
    await tx.esigningEnvelope.updateMany({
      where: { id: input.envelopeId, status: 'SENT' },
      data: { status: 'IN_PROGRESS' },
    });
  }
  return false;
}

type SigningContext = Awaited<ReturnType<typeof getSigningContext>>;

function getVisibleSigningDocumentIds(context: SigningContext): Set<string> {
  return new Set(
    context.envelope.documents
      .filter((document) =>
        isEsigningDocumentVisibleToRecipient({
          metadata: context.envelope.metadata,
          documentId: document.id,
          recipientId: context.recipient.id,
          fieldDefinitions: context.envelope.fieldDefinitions,
        })
      )
      .map((document) => document.id)
  );
}

function toIsoString(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function isTerminalEnvelopeStatus(status: string): boolean {
  return ['VOIDED', 'DECLINED', 'EXPIRED'].includes(status);
}

async function getSigningContext(input: {
  recipientId: string;
  envelopeId: string;
  sessionVersion: number;
}) {
  const envelope = await prisma.esigningEnvelope.findFirst({
    where: {
      id: input.envelopeId,
      recipients: {
        some: {
          id: input.recipientId,
        },
      },
    },
    include: {
      tenant: {
        select: {
          id: true,
          name: true,
        },
      },
      company: {
        select: {
          id: true,
          name: true,
        },
      },
      createdBy: {
        select: {
          firstName: true,
          lastName: true,
          email: true,
        },
      },
      documents: {
        orderBy: { sortOrder: 'asc' },
      },
      recipients: {
        orderBy: [
          { signingOrder: 'asc' },
          { createdAt: 'asc' },
        ],
      },
      fieldDefinitions: {
        where: { recipientId: input.recipientId },
        orderBy: [
          { sortOrder: 'asc' },
          { createdAt: 'asc' },
        ],
      },
    },
  });

  if (!envelope) {
    throw new Error('Envelope not found');
  }

  const recipient = envelope.recipients.find((entry) => entry.id === input.recipientId);
  if (!recipient) {
    throw new Error('Recipient not found');
  }
  if (recipient.sessionVersion !== input.sessionVersion) {
    throw new Error('Signing session expired');
  }
  if (recipient.type !== 'SIGNER') {
    throw new Error('Only signer recipients can access this session');
  }
  if (envelope.expiresAt && envelope.expiresAt.getTime() < Date.now()) {
    throw new Error('This envelope has expired');
  }
  if (isTerminalEnvelopeStatus(envelope.status)) {
    throw new Error(`This envelope is ${envelope.status.toLowerCase()}`);
  }
  if (
    recipient.status === 'QUEUED' &&
    envelope.status !== 'COMPLETED'
  ) {
    throw new Error('This signing step is not active yet');
  }

  const fieldValues = await prisma.esigningDocumentFieldValue.findMany({
    where: {
      recipientId: input.recipientId,
      fieldDefinition: {
        envelopeId: input.envelopeId,
      },
    },
    orderBy: { updatedAt: 'asc' },
  });

  return {
    envelope,
    recipient,
    fieldValues,
  };
}

async function requireSigningSession(): Promise<{
  recipientId: string;
  envelopeId: string;
  sessionVersion: number;
  sessionId: string | null;
}> {
  const claims = await getEsigningSessionClaims();
  if (!claims) {
    throw new Error('Unauthorized');
  }

  return {
    recipientId: claims.recipientId,
    envelopeId: claims.envelopeId,
    sessionVersion: claims.sessionVersion,
    sessionId: claims.sessionId ?? null,
  };
}

async function setOrReuseEsigningSessionCookie(input: {
  recipientId: string;
  envelopeId: string;
  sessionVersion: number;
}) {
  const existingClaims = await getEsigningSessionClaims();
  const shouldReuseSessionId =
    existingClaims?.scope === 'esigning_session' &&
    existingClaims.recipientId === input.recipientId &&
    existingClaims.envelopeId === input.envelopeId &&
    existingClaims.sessionVersion === input.sessionVersion;

  await setEsigningSessionCookie({
    ...input,
    sessionId: shouldReuseSessionId ? existingClaims.sessionId : undefined,
  });
}

function getViewSessionIdFromMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }

  const sessionId = (metadata as { sessionId?: unknown }).sessionId;
  return typeof sessionId === 'string' && sessionId.trim() ? sessionId : null;
}

/**
 * Return only the finalized signature assets that an active signer needs to
 * render marks from earlier completed signing steps. The session recipient is
 * deliberately excluded because their own values are already returned through
 * `fieldValues` below.
 */
async function loadSignaturePreview(storagePath: string): Promise<string> {
  // Signature assets are private PNGs. Serve their bytes through the authorized
  // session instead of relying on public storage URLs (unsupported locally and
  // potentially unreachable or expired in the signer's browser).
  const content = await storage.download(storagePath);
  return `data:image/png;base64,${content.toString('base64')}`;
}

async function buildSignedSignatureFields(
  context: SigningContext
): Promise<EsigningSignedSignatureDto[]> {
  const signedValues = await prisma.esigningDocumentFieldValue.findMany({
    where: {
      tenantId: context.envelope.tenantId,
      finalizedAt: { not: null },
      signatureStoragePath: { not: null },
      fieldDefinition: {
        tenantId: context.envelope.tenantId,
        envelopeId: context.envelope.id,
        type: { in: ['SIGNATURE', 'INITIALS'] },
        document: {
          tenantId: context.envelope.tenantId,
          envelopeId: context.envelope.id,
        },
      },
      recipient: {
        tenantId: context.envelope.tenantId,
        envelopeId: context.envelope.id,
        id: { not: context.recipient.id },
        type: 'SIGNER',
        status: 'SIGNED',
        signedAt: { not: null },
      },
    },
    select: {
      fieldDefinitionId: true,
      recipientId: true,
      signatureStoragePath: true,
      fieldDefinition: {
        select: {
          recipientId: true,
          documentId: true,
          pageNumber: true,
          xPercent: true,
          yPercent: true,
          widthPercent: true,
          heightPercent: true,
        },
      },
      recipient: {
        select: {
          name: true,
        },
      },
    },
    orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
  });

  return Promise.all(
    signedValues
      // Keep the value and its placement tied to the same signer even if a
      // malformed legacy row ever links them to different recipients.
      .filter((value) => value.fieldDefinition.recipientId === value.recipientId)
      .map(async (value) => ({
        fieldDefinitionId: value.fieldDefinitionId,
        signaturePreviewUrl: await loadSignaturePreview(value.signatureStoragePath!),
        signerName: value.recipient.name,
        documentId: value.fieldDefinition.documentId,
        pageNumber: value.fieldDefinition.pageNumber,
        xPercent: value.fieldDefinition.xPercent,
        yPercent: value.fieldDefinition.yPercent,
        widthPercent: value.fieldDefinition.widthPercent,
        heightPercent: value.fieldDefinition.heightPercent,
      }))
  );
}

async function buildSigningSessionDto(context: SigningContext): Promise<EsigningSigningSessionDto> {
  const senderName = [context.envelope.createdBy.firstName, context.envelope.createdBy.lastName]
    .filter(Boolean)
    .join(' ')
    .trim() || context.envelope.createdBy.email;
  const fieldTypeById = new Map(
    context.envelope.fieldDefinitions.map((field) => [field.id, field.type])
  );

  const downloadToken =
    context.envelope.status === 'COMPLETED' || context.recipient.status === 'SIGNED'
      ? await createEsigningDownloadToken({
          recipientId: context.recipient.id,
          envelopeId: context.envelope.id,
          sessionVersion: context.recipient.sessionVersion,
        })
      : null;
  const completionDeliveries =
    context.envelope.status === 'COMPLETED'
      ? await prisma.esigningEmailDelivery.findMany({
          where: {
            envelopeId: context.envelope.id,
            kind: 'COMPLETION',
          },
          select: {
            kind: true,
            status: true,
            recipientId: true,
            targetKey: true,
          },
        })
      : [];
  const currentRecipientDelivery = completionDeliveries.find(
    (delivery) => delivery.recipientId === context.recipient.id
  );
  const completionSummary = getEsigningPostCompletionSummary(
    context.envelope,
    completionDeliveries
  );
  const visibleDocumentIds = getVisibleSigningDocumentIds(context);
  const signedSignatures = (await buildSignedSignatureFields(context))
    .filter((signature) => visibleDocumentIds.has(signature.documentId));

  return {
    envelope: {
      id: context.envelope.id,
      title: context.envelope.title,
      message: context.envelope.message,
      status: context.envelope.status,
      pdfGenerationStatus: context.envelope.pdfGenerationStatus ?? null,
      certificateId: context.envelope.certificateId,
      companyName: context.envelope.company?.name ?? null,
      tenantName: context.envelope.tenant.name,
      senderName,
      completedAt: toIsoString(context.envelope.completedAt),
      expiresAt: toIsoString(context.envelope.expiresAt),
      autoFilingStatus: context.envelope.autoFilingStatus ?? 'NOT_REQUIRED',
      completionDeliveryStatus: completionSummary.completionDeliveryStatus,
    },
    recipient: {
      id: context.recipient.id,
      name: context.recipient.name,
      email: context.recipient.email,
      type: context.recipient.type,
      status: context.recipient.status,
      accessMode: context.recipient.accessMode,
      consentedAt: toIsoString(context.recipient.consentedAt),
      viewedAt: toIsoString(context.recipient.viewedAt),
      signedAt: toIsoString(context.recipient.signedAt),
      colorTag: context.recipient.colorTag,
    },
    documents: context.envelope.documents
      .filter((document) => visibleDocumentIds.has(document.id))
      .map((document) => ({
      id: document.id,
      fileName: getEsigningDocumentOriginalFileName(document),
      originalFileName: getEsigningDocumentOriginalFileName(document),
      pageCount: document.pageCount,
      sortOrder: document.sortOrder,
      fileSize: document.fileSize,
      originalHash: document.originalHash,
      signedHash: document.signedHash,
      pdfUrl: `/api/esigning/sign/session/download?documentId=${encodeURIComponent(document.id)}`,
      signedPdfUrl:
        context.envelope.status === 'COMPLETED' && downloadToken
          ? `/api/esigning/sign/session/download?documentId=${encodeURIComponent(document.id)}&token=${encodeURIComponent(downloadToken)}&variant=signed`
          : null,
      visibility: getEsigningDocumentVisibility(context.envelope.metadata, document.id),
    })),
    recipients: context.envelope.recipients.map((recipient) => ({
      id: recipient.id,
      name: recipient.name,
      type: recipient.type,
      status: recipient.status,
      signingOrder: recipient.signingOrder,
      colorTag: recipient.colorTag,
    })),
    fields: context.envelope.fieldDefinitions.map((field) => ({
      id: field.id,
      documentId: field.documentId,
      recipientId: field.recipientId,
      type: field.type,
      pageNumber: field.pageNumber,
      xPercent: field.xPercent,
      yPercent: field.yPercent,
      widthPercent: field.widthPercent,
      heightPercent: field.heightPercent,
      required: field.required,
      label: field.label,
      placeholder: field.placeholder,
      sortOrder: field.sortOrder,
    })),
    currentRecipientDeliveryStatus:
      context.envelope.status === 'COMPLETED'
        ? currentRecipientDelivery
          ? toEsigningCopyDeliveryDtoStatus(currentRecipientDelivery.status)
          : 'NOT_TRACKED'
        : 'AWAITING_COMPLETION',
    fieldValues: await Promise.all(
      context.fieldValues.map(async (value) => ({
        id: value.id,
        fieldDefinitionId: value.fieldDefinitionId,
        recipientId: value.recipientId,
        value: value.value,
        signatureStoragePath: value.signatureStoragePath,
        signaturePreviewUrl:
          value.signatureStoragePath &&
          ['SIGNATURE', 'INITIALS'].includes(fieldTypeById.get(value.fieldDefinitionId) ?? '')
            ? await loadSignaturePreview(value.signatureStoragePath)
            : null,
        filledAt: toIsoString(value.filledAt),
        finalizedAt: toIsoString(value.finalizedAt),
        revision: value.revision,
      }))
    ),
    signedSignatures,
    downloadToken,
  };
}

function buildCompletionInputs(input: {
  context: SigningContext;
  values: SaveEsigningFieldValuesInput['values'];
}): SaveEsigningFieldValuesInput['values'] {
  const payloadByFieldId = new Map(input.values.map((entry) => [entry.fieldDefinitionId, entry]));
  const currentValues = new Map(input.context.fieldValues.map((value) => [value.fieldDefinitionId, value]));

  return input.context.envelope.fieldDefinitions.map((field) => {
    const payload = payloadByFieldId.get(field.id);
    const existing = currentValues.get(field.id);

    if (payload) {
      return payload;
    }

    if (field.type === 'NAME') {
      return {
        fieldDefinitionId: field.id,
        value: existing?.value ?? input.context.recipient.name,
      };
    }

    if (field.type === 'COMPANY') {
      return {
        fieldDefinitionId: field.id,
        value:
          existing?.value ??
          input.context.envelope.company?.name ??
          input.context.envelope.tenant.name,
      };
    }

    if (field.type === 'DATE_SIGNED') {
      return {
        fieldDefinitionId: field.id,
        value: existing?.value ?? formatSigningDate(new Date()),
      };
    }

    return {
      fieldDefinitionId: field.id,
      value: existing?.value ?? null,
    };
  });
}

function formatSigningDate(date: Date): string {
  const day = `${date.getDate()}`.padStart(2, '0');
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const year = `${date.getFullYear()}`;
  return `${day}-${month}-${year}`;
}

export async function exchangeEsigningLinkToken(rawToken: string): Promise<{
  requiresAccessCode: boolean;
  envelopeId: string;
  recipientId: string;
  envelopeTitle: string;
  recipientName: string;
}> {
  const accessLinkClaims = await verifyEsigningAccessLinkToken(rawToken);
  if (accessLinkClaims) {
    const recipient = await prisma.esigningEnvelopeRecipient.findFirst({
      where: {
        id: accessLinkClaims.recipientId,
        envelopeId: accessLinkClaims.envelopeId,
      },
      include: {
        envelope: {
          select: {
            id: true,
            title: true,
            status: true,
            expiresAt: true,
          },
        },
      },
    });

    if (!recipient || recipient.sessionVersion !== accessLinkClaims.sessionVersion) {
      throw new Error('Signing link is invalid or has expired');
    }
    if (recipient.envelope.expiresAt && recipient.envelope.expiresAt.getTime() < Date.now()) {
      throw new Error('This envelope has expired');
    }
    if (isTerminalEnvelopeStatus(recipient.envelope.status)) {
      throw new Error(`This envelope is ${recipient.envelope.status.toLowerCase()}`);
    }

    await clearEsigningSessionCookie();

    if (recipient.accessMode === 'EMAIL_WITH_CODE') {
      await setEsigningChallengeCookie({
        recipientId: recipient.id,
        envelopeId: recipient.envelopeId,
        sessionVersion: recipient.sessionVersion,
      });

      return {
        requiresAccessCode: true,
        envelopeId: recipient.envelopeId,
        recipientId: recipient.id,
        envelopeTitle: recipient.envelope.title,
        recipientName: recipient.name,
      };
    }

    await clearEsigningChallengeCookie();
    await setOrReuseEsigningSessionCookie({
      recipientId: recipient.id,
      envelopeId: recipient.envelopeId,
      sessionVersion: recipient.sessionVersion,
    });

    return {
      requiresAccessCode: false,
      envelopeId: recipient.envelopeId,
      recipientId: recipient.id,
      envelopeTitle: recipient.envelope.title,
      recipientName: recipient.name,
    };
  }

  const recipient = await prisma.esigningEnvelopeRecipient.findFirst({
    where: {
      accessTokenHash: hashEsigningAccessToken(rawToken),
    },
    include: {
      envelope: {
        select: {
          id: true,
          title: true,
          status: true,
          expiresAt: true,
        },
      },
    },
  });

  if (!recipient) {
    throw new Error('Signing link is invalid or has expired');
  }
  if (recipient.envelope.expiresAt && recipient.envelope.expiresAt.getTime() < Date.now()) {
    throw new Error('This envelope has expired');
  }
  if (isTerminalEnvelopeStatus(recipient.envelope.status)) {
    throw new Error(`This envelope is ${recipient.envelope.status.toLowerCase()}`);
  }

  await clearEsigningSessionCookie();

  if (recipient.accessMode === 'EMAIL_WITH_CODE') {
    await setEsigningChallengeCookie({
      recipientId: recipient.id,
      envelopeId: recipient.envelopeId,
      sessionVersion: recipient.sessionVersion,
    });

    return {
      requiresAccessCode: true,
      envelopeId: recipient.envelopeId,
      recipientId: recipient.id,
      envelopeTitle: recipient.envelope.title,
      recipientName: recipient.name,
    };
  }

  await clearEsigningChallengeCookie();
  await setOrReuseEsigningSessionCookie({
    recipientId: recipient.id,
    envelopeId: recipient.envelopeId,
    sessionVersion: recipient.sessionVersion,
  });

  return {
    requiresAccessCode: false,
    envelopeId: recipient.envelopeId,
    recipientId: recipient.id,
    envelopeTitle: recipient.envelope.title,
    recipientName: recipient.name,
  };
}

export async function verifyEsigningAccessCode(accessCode: string): Promise<void> {
  const claims = await getEsigningChallengeClaims();
  if (!claims) {
    throw new Error('Unauthorized');
  }

  const recipient = await prisma.esigningEnvelopeRecipient.findFirst({
    where: {
      id: claims.recipientId,
      envelopeId: claims.envelopeId,
    },
    select: {
      id: true,
      sessionVersion: true,
      accessCodeHash: true,
    },
  });

  if (!recipient || recipient.sessionVersion !== claims.sessionVersion) {
    throw new Error('Signing challenge expired');
  }
  if (!recipient.accessCodeHash) {
    throw new Error('This recipient does not require an access code');
  }

  const verification = await verifyPassword(accessCode, recipient.accessCodeHash);
  if (!verification.isValid) {
    throw new Error('Access code is incorrect');
  }

  await clearEsigningChallengeCookie();
  await setOrReuseEsigningSessionCookie({
    recipientId: recipient.id,
    envelopeId: claims.envelopeId,
    sessionVersion: recipient.sessionVersion,
  });
}

export async function loadEsigningSigningSession(): Promise<EsigningSigningSessionDto> {
  const claims = await requireSigningSession();
  const context = await getSigningContext(claims);
  return buildSigningSessionDto(context);
}

export async function getEsigningSigningSessionStatus(): Promise<EsigningSigningSessionStatusDto> {
  const claims = await requireSigningSession();

  const recipient = await prisma.esigningEnvelopeRecipient.findFirst({
    where: {
      id: claims.recipientId,
      envelopeId: claims.envelopeId,
    },
    select: {
      id: true,
      status: true,
      signedAt: true,
      sessionVersion: true,
      envelope: {
        select: {
          id: true,
          status: true,
          expiresAt: true,
          pdfGenerationStatus: true,
          autoFilingStatus: true,
          emailDeliveries: {
            select: {
              status: true,
              kind: true,
              targetKey: true,
              recipientId: true,
            },
          },
        },
      },
    },
  });

  if (!recipient || recipient.sessionVersion !== claims.sessionVersion) {
    throw new Error('Signing session expired');
  }
  if (recipient.envelope.expiresAt && recipient.envelope.expiresAt.getTime() < Date.now()) {
    throw new Error('This envelope has expired');
  }
  if (isTerminalEnvelopeStatus(recipient.envelope.status)) {
    throw new Error(`This envelope is ${recipient.envelope.status.toLowerCase()}`);
  }

  const envelope = recipient.envelope;
  const currentRecipientDelivery = envelope.emailDeliveries.find(
    (delivery) =>
      delivery.kind === 'COMPLETION' && delivery.recipientId === claims.recipientId
  );
  const summary = getEsigningPostCompletionSummary(envelope, envelope.emailDeliveries);
  const remainingSignerCount = await prisma.esigningEnvelopeRecipient.count({
    where: {
      envelopeId: claims.envelopeId,
      type: 'SIGNER',
      status: { not: 'SIGNED' },
    },
  });
  const currentDeliveryStatus = currentRecipientDelivery?.status ?? 'NOT_TRACKED';
  const terminal =
    envelope.status === 'COMPLETED' &&
    ['COMPLETED', 'FAILED'].includes(envelope.pdfGenerationStatus ?? '') &&
    isTerminalPostCompletionStatus(envelope.autoFilingStatus) &&
    (isTerminalEsigningEmailDeliveryStatus(currentDeliveryStatus) ||
      currentDeliveryStatus === 'NOT_TRACKED');

  return {
    envelope: {
      id: envelope.id,
      status: envelope.status,
      expiresAt: toIsoString(envelope.expiresAt),
      pdfGenerationStatus: envelope.pdfGenerationStatus ?? null,
      autoFilingStatus: envelope.autoFilingStatus ?? 'NOT_REQUIRED',
      completionDeliveryStatus: summary.completionDeliveryStatus,
    },
    recipient: {
      id: recipient.id,
      status: recipient.status,
      signedAt: toIsoString(recipient.signedAt),
    },
    currentRecipientDeliveryStatus:
      envelope.status === 'COMPLETED'
        ? currentRecipientDelivery
          ? toEsigningCopyDeliveryDtoStatus(currentRecipientDelivery.status)
          : 'NOT_TRACKED'
        : 'AWAITING_COMPLETION',
    remainingSignerCount,
    terminal,
  };
}

export async function recordEsigningSigningView(input?: {
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<EsigningSigningSessionDto> {
  const claims = await requireSigningSession();
  const context = await getSigningContext(claims);
  const canRecordRepeatView = context.recipient.status === 'NOTIFIED' || context.recipient.status === 'VIEWED';

  if (!canRecordRepeatView) {
    return loadEsigningSigningSession();
  }

  const priorViewEvents = claims.sessionId
    ? await prisma.esigningEnvelopeEvent.findMany({
        where: {
          envelopeId: context.envelope.id,
          recipientId: context.recipient.id,
          action: 'VIEWED',
        },
        select: {
          metadata: true,
        },
      })
    : [];
  const hasRecordedThisSession = claims.sessionId
    ? priorViewEvents.some((event) => getViewSessionIdFromMetadata(event.metadata) === claims.sessionId)
    : context.recipient.status !== 'NOTIFIED';

  if (!hasRecordedThisSession) {
    await prisma.$transaction(async (tx) => {
      if (context.recipient.status === 'NOTIFIED') {
        await tx.esigningEnvelopeRecipient.update({
          where: { id: context.recipient.id },
          data: {
            status: 'VIEWED',
            viewedAt: context.recipient.viewedAt ?? new Date(),
          },
        });

        if (context.envelope.status === 'SENT') {
          await tx.esigningEnvelope.update({
            where: { id: context.envelope.id },
            data: { status: 'IN_PROGRESS' },
          });
        }
      }

      await tx.esigningEnvelopeEvent.create({
        data: {
          tenantId: context.envelope.tenantId,
          envelopeId: context.envelope.id,
          recipientId: context.recipient.id,
          action: 'VIEWED',
          metadata: {
            sessionId: claims.sessionId,
            ipAddress: input?.ipAddress ?? null,
            userAgent: input?.userAgent ?? null,
            device: summarizeEsigningUserAgent(input?.userAgent),
          },
        },
      });
    });
  }

  return loadEsigningSigningSession();
}

export async function recordEsigningSigningConsent(input: {
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<EsigningSigningSessionDto> {
  const claims = await requireSigningSession();
  const context = await getSigningContext(claims);

  if (!context.recipient.consentedAt) {
    await prisma.$transaction(async (tx) => {
      await tx.esigningEnvelopeRecipient.update({
        where: { id: context.recipient.id },
        data: {
          consentedAt: new Date(),
          consentIp: input.ipAddress ?? null,
          consentUserAgent: input.userAgent ?? null,
        },
      });

      await tx.esigningEnvelopeEvent.create({
        data: {
          tenantId: context.envelope.tenantId,
          envelopeId: context.envelope.id,
          recipientId: context.recipient.id,
          action: 'CONSENTED',
          metadata: {
            consentVersion: context.envelope.consentVersion,
          },
        },
      });
    });
  }

  return loadEsigningSigningSession();
}

export async function saveEsigningSigningFieldValues(
  values: SaveEsigningFieldValuesInput['values']
): Promise<EsigningSigningSessionDto> {
  const claims = await requireSigningSession();
  const context = await getSigningContext(claims);

  if (!context.recipient.consentedAt) {
    throw new Error('Consent is required before saving signing fields');
  }

  if (context.recipient.status === 'SIGNED' || context.recipient.status === 'DECLINED') {
    throw new Error('This signing session is already complete');
  }

  await saveRecipientFieldValues({
    tenantId: context.envelope.tenantId,
    envelopeId: context.envelope.id,
    recipientId: context.recipient.id,
    values,
  });

  return loadEsigningSigningSession();
}

export async function completeEsigningSigningSession(input: {
  values: SaveEsigningFieldValuesInput['values'];
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<EsigningSigningSessionDto> {
  const claims = await requireSigningSession();
  const context = await getSigningContext(claims);

  if (context.recipient.status === 'SIGNED') {
    return loadEsigningSigningSession();
  }
  if (context.recipient.status === 'DECLINED') {
    throw new Error('This signing session has been declined');
  }
  if (!context.recipient.consentedAt) {
    throw new Error('Consent is required before signing');
  }

  const completionInputs = buildCompletionInputs({
    context,
    values: input.values,
  });

  let envelopeCompleted = false;
  await prisma.$transaction(async (tx) => {
    await saveRecipientFieldValues(
      {
        tenantId: context.envelope.tenantId,
        envelopeId: context.envelope.id,
        recipientId: context.recipient.id,
        values: completionInputs,
        finalize: true,
      },
      tx
    );

    const finalizedValues = await tx.esigningDocumentFieldValue.findMany({
      where: {
        recipientId: context.recipient.id,
        fieldDefinition: {
          envelopeId: context.envelope.id,
        },
      },
    });
    const finalizedValueMap = new Map(
      finalizedValues.map((value) => [value.fieldDefinitionId, value])
    );

    for (const field of context.envelope.fieldDefinitions) {
      const value = finalizedValueMap.get(field.id);
      if (
        !isRequiredEsigningFieldComplete({
          fieldType: field.type,
          required: field.required,
          value: value?.value,
          signatureStoragePath: value?.signatureStoragePath,
        })
      ) {
        throw new Error(`Required field "${field.label || field.type}" is incomplete`);
      }
    }

    const now = new Date();
    await tx.esigningEnvelopeRecipient.update({
      where: { id: context.recipient.id },
      data: {
        status: 'SIGNED',
        signedAt: now,
        signedIp: input.ipAddress ?? null,
        signedUserAgent: input.userAgent ?? null,
      },
    });

    await tx.esigningEnvelopeEvent.create({
      data: {
        tenantId: context.envelope.tenantId,
        envelopeId: context.envelope.id,
        recipientId: context.recipient.id,
        action: 'SIGNED',
      },
    });

    const remainingSignerCount = await tx.esigningEnvelopeRecipient.count({
      where: {
        envelopeId: context.envelope.id,
        type: 'SIGNER',
        status: {
          not: 'SIGNED',
        },
      },
    });

    envelopeCompleted = await finalizeEsigningEnvelopeCompletion(tx, {
      tenantId: context.envelope.tenantId,
      envelopeId: context.envelope.id,
      currentStatus: context.envelope.status,
      remainingSignerCount,
      completedAt: now,
    });
  });
  await processEsigningCompletionArtifacts({
    envelopeCompleted,
    envelopeId: context.envelope.id,
  });
  if (envelopeCompleted) {
    await safelyProcessServiceAgreementActivations(context.envelope.id);
  }
  await safelyReconcileEsigningEnvelopeTaskOutcomes(
    context.envelope.tenantId,
    context.envelope.id,
  );

  try {
    await activateNextQueuedEsigningRecipients(context.envelope.id);
  } catch (error) {
    log.warn('Failed to activate queued signer recipients after completion', {
      envelopeId: context.envelope.id,
      error,
    });
  }

  return loadEsigningSigningSession();
}

export async function declineEsigningSigningSession(input: {
  reason: string;
}): Promise<void> {
  const claims = await requireSigningSession();
  const context = await getSigningContext(claims);

  if (context.recipient.status === 'SIGNED') {
    throw new Error('A completed signer cannot decline');
  }
  if (context.recipient.status === 'DECLINED') {
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.esigningEnvelopeRecipient.update({
      where: { id: context.recipient.id },
      data: {
        status: 'DECLINED',
        declinedAt: new Date(),
        declineReason: input.reason,
      },
    });

    await tx.esigningEnvelope.update({
      where: { id: context.envelope.id },
      data: {
        status: 'DECLINED',
      },
    });

    await tx.esigningEnvelopeRecipient.updateMany({
      where: {
        envelopeId: context.envelope.id,
      },
      data: {
        accessTokenHash: null,
        sessionVersion: { increment: 1 },
      },
    });

    await tx.esigningEnvelopeEvent.create({
      data: {
        tenantId: context.envelope.tenantId,
        envelopeId: context.envelope.id,
        recipientId: context.recipient.id,
        action: 'DECLINED',
        metadata: {
          reason: input.reason,
        },
      },
    });
  });
  await safelyReconcileEsigningEnvelopeTaskOutcomes(
    context.envelope.tenantId,
    context.envelope.id,
  );

  await clearEsigningSessionCookie();

  const deliveryResult = await sendEsigningDeclinedEmailToSender({
    to: context.envelope.createdBy.email,
    senderName:
      [context.envelope.createdBy.firstName, context.envelope.createdBy.lastName]
        .filter(Boolean)
        .join(' ')
        .trim() || context.envelope.createdBy.email,
    envelopeTitle: context.envelope.title,
    recipientName: context.recipient.name,
    declineReason: input.reason,
  });
  await recordEsigningEnvelopeEmailDeliveryResults(context.envelope.id, [
    withEsigningDeliveryTarget(deliveryResult, {
      tenantId: context.envelope.tenantId,
      targetKey: `sender:${context.envelope.createdById}`,
      audience: 'SENDER',
    }),
  ]);
}

export async function downloadEsigningSessionDocument(input: {
  documentId: string;
  variant?: 'original' | 'signed';
  token?: string | null;
}): Promise<{
  buffer: Buffer;
  fileName: string;
}> {
  let claims = await getEsigningSessionClaims();

  if (!claims && input.token) {
    claims = await verifyEsigningScopedToken(input.token, 'esigning_download');
  }

  if (!claims) {
    throw new Error('Unauthorized');
  }

  const context = await getSigningContext({
    recipientId: claims.recipientId,
    envelopeId: claims.envelopeId,
    sessionVersion: claims.sessionVersion,
  });

  const visibleDocumentIds = getVisibleSigningDocumentIds(context);
  const document = context.envelope.documents.find((entry) => entry.id === input.documentId);
  if (!document || !visibleDocumentIds.has(document.id)) {
    throw new Error('Document not found');
  }

  if (input.variant === 'signed') {
    const { ensureEsigningEnvelopeArtifacts } = await import('@/services/esigning-pdf.service');
    await ensureEsigningEnvelopeArtifacts({
      envelopeId: context.envelope.id,
      requireCertificates: false,
    });
  }

  const storagePath =
    input.variant === 'signed'
      ? document.signedStoragePath
      : document.storagePath;

  if (!storagePath) {
    throw new Error('Document is not available');
  }

  const buffer = await storage.download(storagePath);
  const fileName =
    input.variant === 'signed'
      ? getEsigningDocumentVariantFileName(document, 'signed')
      : getEsigningDocumentPdfFileName(document);

  return { buffer, fileName };
}
