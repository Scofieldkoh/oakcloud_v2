import { Prisma } from '@/generated/prisma';
import type { SessionUser } from '@/lib/auth';
import { hasPermission } from '@/lib/rbac';
import { prisma } from '@/lib/prisma';
import type {
  EsigningEnvelopeDetailDto,
  EsigningEnvelopeDocumentDto,
  EsigningEnvelopeEventDto,
  EsigningEnvelopeRecipientDto,
  EsigningFieldDefinitionDto,
  EsigningFieldValueDto,
} from '@/types/esigning';
import type { EsigningListQueryInput } from '@/lib/validations/esigning';
import { getEsigningDocumentOriginalFileName } from '@/lib/esigning-document-filename';
import { getEsigningDocumentVisibility } from '@/lib/esigning-document-visibility';
import { getEsigningEmailDeliveryHealth } from '@/services/esigning-email-delivery.service';
import {
  getEsigningPostCompletionSummary,
  toEsigningCopyDeliveryDtoStatus,
} from '@/services/esigning-completion.service';

export interface EsigningActorScope {
  tenantId: string;
  canCreate: boolean;
  canReadAll: boolean;
  canUpdateAny: boolean;
  canDeleteAny: boolean;
  canManage: boolean;
}

export function toIsoString(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

export function asJsonObject(value: Prisma.JsonValue | null | undefined): Record<string, unknown> | null {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    return null;
  }

  return value as Record<string, unknown>;
}

export function isEnvelopeTerminal(status: string): boolean {
  return ['COMPLETED', 'VOIDED', 'DECLINED', 'EXPIRED'].includes(status);
}

export function buildDocumentUrls(
  tenantId: string,
  envelopeId: string,
  documentId: string
): Pick<EsigningEnvelopeDocumentDto, 'pdfUrl' | 'signedPdfUrl'> {
  const tenantQuery = `?tenantId=${encodeURIComponent(tenantId)}`;

  return {
    pdfUrl: `/api/esigning/envelopes/${envelopeId}/documents/${documentId}/pdf${tenantQuery}`,
    signedPdfUrl: `/api/esigning/envelopes/${envelopeId}/documents/${documentId}/signed-pdf${tenantQuery}`,
  };
}

export async function resolveEsigningActorScope(
  session: SessionUser,
  tenantId: string
): Promise<EsigningActorScope> {
  if (!tenantId) {
    throw new Error('Tenant context required');
  }

  if (!session.isSuperAdmin && session.tenantId !== tenantId) {
    throw new Error('Forbidden');
  }

  if (session.isSuperAdmin || session.isWorkspaceAdmin) {
    return {
      tenantId,
      canCreate: true,
      canReadAll: true,
      canUpdateAny: true,
      canDeleteAny: true,
      canManage: true,
    };
  }

  const [canCreate, canReadAll, canUpdateAny, canDeleteAny, canManage] = await Promise.all([
    hasPermission(session.id, 'esigning', 'create'),
    hasPermission(session.id, 'esigning', 'read'),
    hasPermission(session.id, 'esigning', 'update'),
    hasPermission(session.id, 'esigning', 'delete'),
    hasPermission(session.id, 'esigning', 'manage'),
  ]);

  if (!canCreate && !canReadAll && !canUpdateAny && !canDeleteAny && !canManage) {
    throw new Error('Permission denied: esigning');
  }

  return {
    tenantId,
    canCreate,
    canReadAll,
    canUpdateAny,
    canDeleteAny,
    canManage,
  };
}

export async function ensureCompanyBelongsToTenant(
  tenantId: string,
  companyId: string | null | undefined
): Promise<void> {
  if (!companyId) {
    return;
  }

  const company = await prisma.company.findFirst({
    where: {
      id: companyId,
      tenantId,
      deletedAt: null,
    },
    select: { id: true },
  });

  if (!company) {
    throw new Error('Company not found');
  }
}

export function canReadEnvelope(
  scope: EsigningActorScope,
  session: SessionUser,
  createdById: string
): boolean {
  return scope.canReadAll || createdById === session.id;
}

export function canMutateEnvelope(
  scope: EsigningActorScope,
  session: SessionUser,
  createdById: string
): boolean {
  return scope.canUpdateAny || createdById === session.id;
}

export function canDeleteEnvelope(
  scope: EsigningActorScope,
  session: SessionUser,
  createdById: string
): boolean {
  return scope.canDeleteAny || createdById === session.id;
}

export async function getEnvelopeAggregate(envelopeId: string, tenantId?: string) {
  const [envelope, fieldValues] = await Promise.all([
    prisma.esigningEnvelope.findFirst({
      where: {
        id: envelopeId,
        ...(tenantId ? { tenantId } : {}),
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
            id: true,
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
          orderBy: [
            { sortOrder: 'asc' },
            { createdAt: 'asc' },
          ],
        },
        events: {
          orderBy: { createdAt: 'desc' },
          include: {
            recipient: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        emailDeliveries: {
          select: {
            kind: true,
            targetKey: true,
            toEmail: true,
            subject: true,
            status: true,
            lastError: true,
            lastAttemptedAt: true,
          },
        },
      },
    }),
    prisma.esigningDocumentFieldValue.findMany({
      where: {
        recipient: {
          envelopeId,
        },
      },
      orderBy: { updatedAt: 'asc' },
    }),
  ]);

  if (!envelope) {
    throw new Error('Envelope not found');
  }

  return { envelope, fieldValues };
}

export function formatUserName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  email: string
): string {
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
  return fullName || email;
}

export function serializeEnvelopeDetail(input: {
  envelope: Awaited<ReturnType<typeof getEnvelopeAggregate>>['envelope'];
  fieldValues: Awaited<ReturnType<typeof getEnvelopeAggregate>>['fieldValues'];
  scope: EsigningActorScope;
  session: SessionUser;
}): EsigningEnvelopeDetailDto {
  const { envelope, fieldValues, scope, session } = input;
  const fieldCountByRecipient = new Map<string, { total: number; required: number; signature: number }>();

  for (const field of envelope.fieldDefinitions) {
    const current = fieldCountByRecipient.get(field.recipientId) ?? { total: 0, required: 0, signature: 0 };
    current.total += 1;
    if (field.required) {
      current.required += 1;
    }
    if (field.type === 'SIGNATURE' || field.type === 'INITIALS') {
      current.signature += 1;
    }
    fieldCountByRecipient.set(field.recipientId, current);
  }

  return {
    id: envelope.id,
    tenantId: envelope.tenantId,
    title: envelope.title,
    emailSubject: envelope.emailSubject ?? envelope.title,
    message: envelope.message,
    completionCopyEmails: envelope.completionCopyEmails ?? [],
    status: envelope.status,
    signingOrder: envelope.signingOrder,
    expiresAt: toIsoString(envelope.expiresAt),
    reminderFrequencyDays: envelope.reminderFrequencyDays,
    reminderStartDays: envelope.reminderStartDays,
    expiryWarningDays: envelope.expiryWarningDays,
    companyId: envelope.companyId,
    companyName: envelope.company?.name ?? null,
    certificateId: envelope.certificateId,
    completedAt: toIsoString(envelope.completedAt),
    createdAt: envelope.createdAt.toISOString(),
    updatedAt: envelope.updatedAt.toISOString(),
    voidedAt: toIsoString(envelope.voidedAt),
    voidReason: envelope.voidReason,
    pdfGenerationStatus: envelope.pdfGenerationStatus ?? null,
    pdfGenerationError: envelope.pdfGenerationError ?? null,
    createdById: envelope.createdById,
    createdByName: formatUserName(envelope.createdBy.firstName, envelope.createdBy.lastName, envelope.createdBy.email),
    canEdit: envelope.status === 'DRAFT' && canMutateEnvelope(scope, session, envelope.createdById),
    canDelete:
      ['DRAFT', 'COMPLETED'].includes(envelope.status) &&
      canDeleteEnvelope(scope, session, envelope.createdById),
    canSend: envelope.status === 'DRAFT' && canMutateEnvelope(scope, session, envelope.createdById),
    canVoid: ['SENT', 'IN_PROGRESS'].includes(envelope.status) && (scope.canManage || canMutateEnvelope(scope, session, envelope.createdById)),
    canDuplicate: scope.canCreate && canReadEnvelope(scope, session, envelope.createdById),
    canRetryCompletionProcessing:
      envelope.status === 'COMPLETED' &&
      (envelope.pdfGenerationStatus === 'FAILED' ||
        ['FAILED_RETRYABLE', 'FAILED_PERMANENT'].includes(envelope.autoFilingStatus ?? '') ||
        (envelope.emailDeliveries ?? []).some((delivery) =>
          delivery.kind === 'COMPLETION' &&
          ['FAILED_RETRYABLE', 'FAILED_PERMANENT'].includes(delivery.status)
        )) &&
      (scope.canManage || canMutateEnvelope(scope, session, envelope.createdById)),
    emailDelivery: getEsigningEmailDeliveryHealth(envelope.emailDeliveries ?? [], envelope.metadata),
    postCompletion: getEsigningPostCompletionSummary(envelope, envelope.emailDeliveries ?? []),
    documentCount: envelope.documents.length,
    signerCount: envelope.recipients.filter((recipient) => recipient.type === 'SIGNER').length,
    recipientCount: envelope.recipients.length,
    completedSignerCount: envelope.recipients.filter((recipient) => recipient.type === 'SIGNER' && recipient.status === 'SIGNED').length,
    documents: envelope.documents.map((document) => ({
      id: document.id,
      generatedDocumentId: document.generatedDocumentId,
      fileName: getEsigningDocumentOriginalFileName(document),
      originalFileName: getEsigningDocumentOriginalFileName(document),
      pageCount: document.pageCount,
      sortOrder: document.sortOrder,
      visibility: getEsigningDocumentVisibility(envelope.metadata, document.id),
      fileSize: document.fileSize,
      originalHash: document.originalHash,
      signedHash: document.signedHash,
        ...buildDocumentUrls(envelope.tenantId, envelope.id, document.id),
      }) satisfies EsigningEnvelopeDocumentDto),
    recipients: envelope.recipients.map((recipient) => {
      const counts = fieldCountByRecipient.get(recipient.id) ?? { total: 0, required: 0, signature: 0 };
      const copyDelivery = (envelope.emailDeliveries ?? []).find(
        (delivery) =>
          delivery.kind === 'COMPLETION' &&
          delivery.targetKey === `recipient:${recipient.id}`
      );
      return {
        id: recipient.id,
        name: recipient.name,
        email: recipient.email,
        type: recipient.type,
        status: recipient.status,
        signingOrder: recipient.signingOrder,
        accessMode: recipient.accessMode,
        hasAccessCode: Boolean(recipient.accessCodeHash),
        colorTag: recipient.colorTag,
        consentedAt: toIsoString(recipient.consentedAt),
        viewedAt: toIsoString(recipient.viewedAt),
        signedAt: toIsoString(recipient.signedAt),
        declinedAt: toIsoString(recipient.declinedAt),
        declineReason: recipient.declineReason,
        fieldsAssigned: counts.total,
        requiredFieldsAssigned: counts.required,
        signatureFieldsAssigned: counts.signature,
        copyDeliveryStatus:
          envelope.status === 'COMPLETED'
            ? copyDelivery
              ? toEsigningCopyDeliveryDtoStatus(copyDelivery.status)
              : 'NOT_TRACKED'
            : 'AWAITING_COMPLETION',
      } satisfies EsigningEnvelopeRecipientDto;
    }),
    fields: envelope.fieldDefinitions.map((field) => ({
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
    }) satisfies EsigningFieldDefinitionDto),
    fieldValues: fieldValues.map((value) => ({
      id: value.id,
      fieldDefinitionId: value.fieldDefinitionId,
      recipientId: value.recipientId,
      value: value.value,
      signatureStoragePath: value.signatureStoragePath,
      filledAt: toIsoString(value.filledAt),
      finalizedAt: toIsoString(value.finalizedAt),
      revision: value.revision,
    }) satisfies EsigningFieldValueDto),
    events: envelope.events.map((event) => ({
      id: event.id,
      recipientId: event.recipientId,
      recipientName: event.recipient?.name ?? null,
      action: event.action,
      createdAt: event.createdAt.toISOString(),
      metadata: asJsonObject(event.metadata),
    }) satisfies EsigningEnvelopeEventDto),
  };
}

export function buildRecipientSigningOrder(input: {
  envelopeSigningOrder: 'PARALLEL' | 'SEQUENTIAL' | 'MIXED';
  requestedSigningOrder: number | null | undefined;
  recipientType: 'SIGNER' | 'CC';
  existingRecipients: Array<{ type: 'SIGNER' | 'CC'; signingOrder: number | null }>;
}): number | null {
  if (input.recipientType === 'CC') {
    return null;
  }

  if (input.envelopeSigningOrder === 'PARALLEL') {
    return null;
  }

  if (typeof input.requestedSigningOrder === 'number') {
    return input.requestedSigningOrder;
  }

  const existingOrders = input.existingRecipients
    .filter((recipient) => recipient.type === 'SIGNER')
    .map((recipient) => recipient.signingOrder ?? 1);

  return existingOrders.length > 0 ? Math.max(...existingOrders) + 1 : 1;
}

export function ensureDuplicateSignerEmails(
  recipients: Array<{ id: string; email: string | null; type: 'SIGNER' | 'CC' }>,
  excludingRecipientId?: string
): void {
  const signerEmails = new Map<string, string>();

  for (const recipient of recipients) {
    if (recipient.type !== 'SIGNER' || recipient.id === excludingRecipientId) {
      continue;
    }

    if (!recipient.email?.trim()) {
      continue;
    }

    const normalizedEmail = recipient.email.trim().toLowerCase();
    const existingId = signerEmails.get(normalizedEmail);
    if (existingId) {
      throw new Error(`${recipient.email} appears as a signer more than once`);
    }
    signerEmails.set(normalizedEmail, recipient.id);
  }
}

export function getInitialActiveSignerRecipientIds(input: {
  envelopeSigningOrder: 'PARALLEL' | 'SEQUENTIAL' | 'MIXED';
  recipients: Array<{ id: string; type: 'SIGNER' | 'CC'; signingOrder: number | null }>;
}): string[] {
  const signers = input.recipients.filter((recipient) => recipient.type === 'SIGNER');
  if (signers.length === 0) {
    return [];
  }

  if (input.envelopeSigningOrder === 'PARALLEL') {
    return signers.map((recipient) => recipient.id);
  }

  const firstOrder = Math.min(...signers.map((recipient) => recipient.signingOrder ?? 1));
  return signers
    .filter((recipient) => (recipient.signingOrder ?? 1) === firstOrder)
    .map((recipient) => recipient.id);
}

export function validateEnvelopeSendReadiness(input: {
  maxTotalFileSizeBytes: number;
  documents: Array<{ fileSize: number }>;
  recipients: Array<{
    id: string;
    name: string;
    email: string | null;
    type: 'SIGNER' | 'CC';
    accessMode: 'EMAIL_LINK' | 'EMAIL_WITH_CODE' | 'MANUAL_LINK';
    accessCodeHash: string | null;
  }>;
  fieldDefinitions: Array<{
    id?: string | null;
    recipientId: string;
    type: string;
    documentId?: string;
    pageNumber?: number;
    xPercent?: number;
    yPercent?: number;
    widthPercent?: number;
    heightPercent?: number;
  }>;
}): void {
  if (input.documents.length === 0) {
    throw new Error('Add at least one document before sending');
  }

  const totalSize = input.documents.reduce((sum, document) => sum + document.fileSize, 0);
  if (totalSize > input.maxTotalFileSizeBytes) {
    throw new Error('Envelope exceeds the maximum total file size');
  }

  const signers = input.recipients.filter((recipient) => recipient.type === 'SIGNER');
  if (signers.length === 0) {
    throw new Error('Add at least one signer before sending');
  }

  ensureDuplicateSignerEmails(
    input.recipients.map((recipient) => ({
      id: recipient.id,
      email: recipient.email,
      type: recipient.type,
    }))
  );

  if (input.fieldDefinitions.length === 0) {
    throw new Error('This envelope has no signer fields');
  }

  for (const signer of signers) {
    const signerFields = input.fieldDefinitions.filter((field) => field.recipientId === signer.id);
    if (signerFields.length === 0) {
      throw new Error(`Signer ${signer.name} has no fields assigned`);
    }

    const hasSignatureField = signerFields.some((field) => field.type === 'SIGNATURE' || field.type === 'INITIALS');
    if (!hasSignatureField) {
      throw new Error(`Signer ${signer.name} has no signature fields assigned`);
    }

    if (signer.accessMode === 'EMAIL_WITH_CODE' && !signer.accessCodeHash) {
      throw new Error(`${signer.name} requires an access code`);
    }

    if (signer.accessMode !== 'MANUAL_LINK' && !signer.email?.trim()) {
      throw new Error(`${signer.name} requires an email address for this recipient method`);
    }
  }

  const emailRecipients = input.recipients.filter(
    (recipient) => recipient.type === 'CC' || recipient.accessMode !== 'MANUAL_LINK'
  );
  for (const recipient of emailRecipients) {
    if (!recipient.email?.trim()) {
      throw new Error(`${recipient.name} requires an email address for this recipient method`);
    }
  }
}

export async function createEnvelopeEvent(input: {
  envelopeId: string;
  tenantId: string;
  recipientId?: string | null;
  action: 'CREATED' | 'SENT' | 'VIEWED' | 'CONSENTED' | 'SIGNED' | 'DECLINED' | 'VOIDED' | 'CORRECTED' | 'COMPLETED' | 'REMINDER_SENT' | 'EXPIRED' | 'PDF_GENERATION_FAILED';
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  await prisma.esigningEnvelopeEvent.create({
    data: {
      tenantId: input.tenantId,
      envelopeId: input.envelopeId,
      recipientId: input.recipientId ?? null,
      action: input.action,
      metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}

export function getEnvelopeOrderBy(
  query: EsigningListQueryInput
): Prisma.EsigningEnvelopeOrderByWithRelationInput | Prisma.EsigningEnvelopeOrderByWithRelationInput[] {
  const sortBy = query.sortBy ?? 'updatedAt';
  const sortOrder = query.sortOrder ?? 'desc';

  if (sortBy === 'companyName') {
    return [
      { company: { name: sortOrder } },
      { updatedAt: 'desc' },
    ];
  }

  if (sortBy === 'details') {
    return [
      { documents: { _count: sortOrder } },
      { recipients: { _count: sortOrder } },
      { updatedAt: 'desc' },
    ];
  }

  return {
    [sortBy]: sortOrder,
  };
}

export function selectNextQueuedSignerRecipients(recipients: Array<{
  id: string;
  type: 'SIGNER' | 'CC';
  status: string;
  signingOrder: number | null;
}>): string[] {
  const queuedSigners = recipients
    .filter((recipient) => recipient.type === 'SIGNER' && recipient.status === 'QUEUED')
    .sort((left, right) => (left.signingOrder ?? 1) - (right.signingOrder ?? 1));

  if (queuedSigners.length === 0) {
    return [];
  }

  const nextOrder = queuedSigners[0]?.signingOrder ?? 1;
  return queuedSigners
    .filter((recipient) => (recipient.signingOrder ?? 1) === nextOrder)
    .map((recipient) => recipient.id);
}
