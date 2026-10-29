/** E-signing envelope listing, detail, creation, draft edits, duplication and deletion. */

import { randomUUID } from 'crypto';
import type { Prisma } from '@/generated/prisma';
import type { SessionUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createAuditLog } from '@/lib/audit';
import { storage, StorageKeys } from '@/lib/storage';
import { getEsigningDocumentVisibility } from '@/lib/esigning-document-visibility';
import {
  type CreateEsigningEnvelopeInput,
  type EsigningListQueryInput,
  type UpdateEsigningEnvelopeInput,
} from '@/lib/validations/esigning';
import type { EsigningEnvelopeDetailDto, EsigningEnvelopeListItem } from '@/types/esigning';
import { generateUniqueEsigningCertificateId } from '@/services/esigning-certificate.service';
import { getEsigningEmailDeliveryHealth } from '@/services/esigning-email-delivery.service';
import { getEsigningPostCompletionSummary, toEsigningCopyDeliveryDtoStatus } from '@/services/esigning-completion.service';
import {
  canDeleteEnvelope,
  canMutateEnvelope,
  canReadEnvelope,
  createEnvelopeEvent,
  ensureCompanyBelongsToTenant,
  formatUserName,
  getEnvelopeAggregate,
  getEnvelopeOrderBy,
  resolveEsigningActorScope,
  serializeEnvelopeDetail,
  toIsoString,
} from '@/services/esigning-envelope.lib';
import { safelyCaptureEsigningTaskStageIds, safelyReconcileTaskStageIds } from '@/services/tasks/integration.service';
import type { TaskLaunchContext } from '@/services/tasks/types';
import {
  log,
  buildDuplicateEnvelopeTitle,
  buildEsigningListDateRange,
  getDuplicateEnvelopeExpiry,
} from './shared';

export async function listEsigningEnvelopes(
  session: SessionUser,
  tenantId: string,
  query: EsigningListQueryInput
): Promise<{
  envelopes: EsigningEnvelopeListItem[];
  companyOptions: Array<{ id: string; name: string; count: number }>;
  total: number;
  page: number;
  limit: number;
  statusCounts: Record<
    'DRAFT' | 'SENT' | 'IN_PROGRESS' | 'COMPLETED' | 'VOIDED' | 'DECLINED' | 'EXPIRED',
    number
  >;
}> {
  const scope = await resolveEsigningActorScope(session, tenantId);
  const scopeWhere: Prisma.EsigningEnvelopeWhereInput = {
    tenantId,
    deletedAt: null,
  };

  if (query.query) {
    scopeWhere.OR = [
      { title: { contains: query.query, mode: 'insensitive' } },
      { company: { is: { name: { contains: query.query, mode: 'insensitive' } } } },
      {
        documents: {
          some: {
            OR: [
              { fileName: { contains: query.query, mode: 'insensitive' } },
              { originalFileName: { contains: query.query, mode: 'insensitive' } },
            ],
          },
        },
      },
      { recipients: { some: { name: { contains: query.query, mode: 'insensitive' } } } },
      { recipients: { some: { email: { contains: query.query, mode: 'insensitive' } } } },
    ];
  }
  if (!scope.canReadAll || query.createdBy === 'me') {
    scopeWhere.createdById = session.id;
  }

  const applyNonStatusFilters = (
    where: Prisma.EsigningEnvelopeWhereInput,
    includeCompany: boolean,
  ) => {
    if (includeCompany && query.companyId) {
      where.companyId = query.companyId;
    }

    if (query.documentName) {
      where.documents = {
        some: {
          OR: [
            { fileName: { contains: query.documentName, mode: 'insensitive' } },
            { originalFileName: { contains: query.documentName, mode: 'insensitive' } },
          ],
        },
      };
    }

    if (query.recipientQuery || query.recipientStatus) {
      const recipientWhere: Prisma.EsigningEnvelopeRecipientWhereInput = {};
      if (query.recipientQuery) {
        recipientWhere.OR = [
          { name: { contains: query.recipientQuery, mode: 'insensitive' } },
          { email: { contains: query.recipientQuery, mode: 'insensitive' } },
        ];
      }
      if (query.recipientStatus) {
        recipientWhere.status = query.recipientStatus;
      }
      where.recipients = { some: recipientWhere };
    }

    if (query.signingOrder) {
      where.signingOrder = query.signingOrder;
    }

    const createdAt = buildEsigningListDateRange(query.createdFrom, query.createdTo);
    if (createdAt) {
      where.createdAt = createdAt;
    }

    const completedAt = buildEsigningListDateRange(query.completedFrom, query.completedTo);
    if (completedAt) {
      where.completedAt = completedAt;
    }

    const sentAt = buildEsigningListDateRange(query.sentFrom, query.sentTo);
    if (sentAt) {
      where.events = {
        some: {
          action: 'SENT',
          createdAt: sentAt,
        },
      };
    }
  };

  const resultWhere: Prisma.EsigningEnvelopeWhereInput = { ...scopeWhere };
  applyNonStatusFilters(resultWhere, true);
  if (query.status) {
    resultWhere.status = query.status;
  } else if (query.statuses?.length) {
    resultWhere.status = { in: query.statuses };
  }

  const statusCountWhere: Prisma.EsigningEnvelopeWhereInput = { ...scopeWhere };
  applyNonStatusFilters(statusCountWhere, true);

  const companyOptionWhere: Prisma.EsigningEnvelopeWhereInput = { ...scopeWhere };
  applyNonStatusFilters(companyOptionWhere, false);
  companyOptionWhere.companyId = { not: null };
  if (query.status) {
    companyOptionWhere.status = query.status;
  } else if (query.statuses?.length) {
    companyOptionWhere.status = { in: query.statuses };
  }

  const page = query.page ?? 1;
  const limit = query.limit ?? 20;
  const skip = (page - 1) * limit;

  const [total, envelopes, groupedStatusCounts, groupedCompanyCounts] = await prisma.$transaction([
    prisma.esigningEnvelope.count({ where: resultWhere }),
    prisma.esigningEnvelope.findMany({
      where: resultWhere,
      orderBy: getEnvelopeOrderBy(query),
      skip,
      take: limit,
      include: {
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
            signingOrder: true,
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
        documents: {
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            fileName: true,
            originalFileName: true,
          },
        },
      },
    }),
    prisma.esigningEnvelope.groupBy({
      by: ['status'],
      where: statusCountWhere,
      orderBy: {
        status: 'asc',
      },
      _count: {
        status: true,
      },
    }),
    prisma.esigningEnvelope.groupBy({
      by: ['companyId'],
      where: companyOptionWhere,
      orderBy: {
        companyId: 'asc',
      },
      _count: {
        _all: true,
      },
    }),
  ]);

  const statusCounts = {
    DRAFT: 0,
    SENT: 0,
    IN_PROGRESS: 0,
    COMPLETED: 0,
    VOIDED: 0,
    DECLINED: 0,
    EXPIRED: 0,
  };

  groupedStatusCounts.forEach((entry) => {
    const count =
      typeof entry._count === 'object' && entry._count
        ? (entry._count.status ?? 0)
        : 0;
    statusCounts[entry.status] = count;
  });

  const companyIds = Array.from(new Set([
    ...groupedCompanyCounts
      .map((entry) => entry.companyId)
      .filter((id): id is string => Boolean(id)),
    ...(query.companyId ? [query.companyId] : []),
  ]));
  const companyRows =
    companyIds.length > 0
      ? await prisma.company.findMany({
          where: {
            id: { in: companyIds },
            tenantId,
          },
          select: {
            id: true,
            name: true,
          },
        })
      : [];
  const companyCountById = new Map(
    groupedCompanyCounts.flatMap((entry) => {
      if (!entry.companyId) return [];
      const count =
        typeof entry._count === 'object' && entry._count
          ? (entry._count._all ?? 0)
          : 0;
      return [[entry.companyId, count] as const];
    })
  );
  const companyOptions = companyRows
    .map((company) => ({
      id: company.id,
      name: company.name,
      count: companyCountById.get(company.id) ?? 0,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

  return {
    envelopes: envelopes.map((envelope) => ({
      id: envelope.id,
      tenantId: envelope.tenantId,
      title: envelope.title,
      status: envelope.status,
      pdfGenerationStatus: envelope.pdfGenerationStatus ?? null,
      signingOrder: envelope.signingOrder,
      certificateId: envelope.certificateId,
      createdAt: envelope.createdAt.toISOString(),
      updatedAt: envelope.updatedAt.toISOString(),
      completedAt: toIsoString(envelope.completedAt),
      expiresAt: toIsoString(envelope.expiresAt),
      companyId: envelope.companyId,
      companyName: envelope.company?.name ?? null,
      createdById: envelope.createdById,
      createdByName: formatUserName(envelope.createdBy.firstName, envelope.createdBy.lastName, envelope.createdBy.email),
      canDelete:
        ['DRAFT', 'COMPLETED', 'DECLINED', 'VOIDED'].includes(envelope.status) &&
        canDeleteEnvelope(scope, session, envelope.createdById),
      canVoid:
        ['SENT', 'IN_PROGRESS'].includes(envelope.status) &&
        (scope.canManage || canMutateEnvelope(scope, session, envelope.createdById)),
      canDuplicate: scope.canCreate && canReadEnvelope(scope, session, envelope.createdById),
      canResend:
        ['SENT', 'IN_PROGRESS'].includes(envelope.status) &&
        (scope.canManage || canMutateEnvelope(scope, session, envelope.createdById)) &&
        envelope.recipients.some(
          (recipient) =>
            recipient.type === 'SIGNER' && ['NOTIFIED', 'VIEWED'].includes(recipient.status)
        ),
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
      resendableRecipientCount: envelope.recipients.filter(
        (recipient) =>
          recipient.type === 'SIGNER' && ['NOTIFIED', 'VIEWED'].includes(recipient.status)
      ).length,
      recipientCount: envelope.recipients.length,
      signerCount: envelope.recipients.filter((recipient) => recipient.type === 'SIGNER').length,
      completedSignerCount: envelope.recipients.filter(
        (recipient) => recipient.type === 'SIGNER' && recipient.status === 'SIGNED'
      ).length,
      documentCount: envelope.documents.length,
      documents: envelope.documents.map((document) => ({
        id: document.id,
        fileName: document.fileName,
        originalFileName: document.originalFileName ?? null,
      })),
      recipients: envelope.recipients.map((recipient) => {
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
          copyDeliveryStatus:
            envelope.status === 'COMPLETED'
              ? copyDelivery
                ? toEsigningCopyDeliveryDtoStatus(copyDelivery.status)
                : 'NOT_TRACKED'
              : 'AWAITING_COMPLETION',
        };
      }),
    })),
    companyOptions,
    total,
    page,
    limit,
    statusCounts,
  };
}

export async function getEsigningEnvelopeDetail(
  session: SessionUser,
  tenantId: string,
  envelopeId: string
): Promise<EsigningEnvelopeDetailDto> {
  const scope = await resolveEsigningActorScope(session, tenantId);
  const aggregate = await getEnvelopeAggregate(envelopeId, tenantId);

  if (!canReadEnvelope(scope, session, aggregate.envelope.createdById)) {
    throw new Error('Forbidden');
  }

  return serializeEnvelopeDetail({
    envelope: aggregate.envelope,
    fieldValues: aggregate.fieldValues,
    scope,
    session,
  });
}

export async function createEsigningEnvelope(
  session: SessionUser,
  tenantId: string,
  input: CreateEsigningEnvelopeInput,
  taskIntegrationContext?: TaskLaunchContext,
): Promise<EsigningEnvelopeDetailDto> {
  const scope = await resolveEsigningActorScope(session, tenantId);
  if (!scope.canCreate) {
    throw new Error('Permission denied: esigning:create');
  }

  await ensureCompanyBelongsToTenant(tenantId, input.companyId ?? null);

  const certificateId = await generateUniqueEsigningCertificateId();
  const envelope = await prisma.esigningEnvelope.create({
    data: {
      tenantId,
      createdById: session.id,
      title: input.title,
      emailSubject: input.emailSubject?.trim() || input.title,
      message: input.message ?? null,
      completionCopyEmails: input.completionCopyEmails ?? [],
      signingOrder: input.signingOrder,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      reminderFrequencyDays: input.reminderFrequencyDays ?? null,
      reminderStartDays: input.reminderStartDays ?? null,
      expiryWarningDays: input.expiryWarningDays ?? null,
      companyId: input.companyId ?? null,
      certificateId,
      metadata: taskIntegrationContext
        ? {
          taskIntegrationContext: {
            taskId: taskIntegrationContext.taskId,
            taskStageId: taskIntegrationContext.taskStageId,
            ...(taskIntegrationContext.returnTo
              ? { returnTo: taskIntegrationContext.returnTo }
              : {}),
          },
        }
        : undefined,
    },
  });

  await createEnvelopeEvent({
    envelopeId: envelope.id,
    tenantId,
    action: 'CREATED',
    metadata: { title: envelope.title },
  });

  return getEsigningEnvelopeDetail(session, tenantId, envelope.id);
}

export async function createTaskPreparedEsigningEnvelope(input: {
  tenantId: string;
  taskContext: TaskLaunchContext;
  createdById: string;
  title: string;
  companyId?: string | null;
  signingOrder?: 'PARALLEL' | 'SEQUENTIAL' | 'MIXED';
  expiresAt?: Date | null;
}): Promise<{ id: string }> {
  const existing = await prisma.esigningEnvelope.findFirst({
    where: {
      tenantId: input.tenantId,
      deletedAt: null,
      metadata: {
        path: ['taskIntegrationContext', 'taskStageId'],
        equals: input.taskContext.taskStageId,
      },
    },
    select: { id: true },
  });
  if (existing) return existing;

  const certificateId = await generateUniqueEsigningCertificateId();
  const envelope = await prisma.esigningEnvelope.create({
    data: {
      tenantId: input.tenantId,
      createdById: input.createdById,
      title: input.title,
      emailSubject: input.title,
      status: 'DRAFT',
      signingOrder: input.signingOrder ?? 'PARALLEL',
      expiresAt: input.expiresAt ?? null,
      companyId: input.companyId ?? null,
      certificateId,
      metadata: {
        taskIntegrationContext: {
          taskId: input.taskContext.taskId,
          taskStageId: input.taskContext.taskStageId,
          ...(input.taskContext.returnTo
            ? { returnTo: input.taskContext.returnTo }
            : {}),
        },
      },
    },
    select: { id: true, title: true },
  });
  await createEnvelopeEvent({
    envelopeId: envelope.id,
    tenantId: input.tenantId,
    action: 'CREATED',
    metadata: {
      title: envelope.title,
      source: 'TASK_PREPARATION',
    },
  });
  return { id: envelope.id };
}

export async function updateDraftEsigningEnvelope(
  session: SessionUser,
  tenantId: string,
  envelopeId: string,
  input: UpdateEsigningEnvelopeInput
): Promise<EsigningEnvelopeDetailDto> {
  const scope = await resolveEsigningActorScope(session, tenantId);
  const envelope = await prisma.esigningEnvelope.findFirst({
    where: { id: envelopeId, tenantId },
    select: {
      id: true,
      status: true,
      createdById: true,
      signingOrder: true,
    },
  });

  if (!envelope) {
    throw new Error('Envelope not found');
  }
  if (envelope.status !== 'DRAFT') {
    throw new Error('Only draft envelopes can be edited');
  }
  if (!canMutateEnvelope(scope, session, envelope.createdById)) {
    throw new Error('Forbidden');
  }

  await ensureCompanyBelongsToTenant(tenantId, input.companyId ?? null);

  await prisma.$transaction(async (tx) => {
    await tx.esigningEnvelope.update({
      where: { id: envelopeId },
      data: {
        title: input.title,
        emailSubject: input.emailSubject,
        message: input.message,
        companyId: input.companyId,
        signingOrder: input.signingOrder,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : input.expiresAt === null ? null : undefined,
        reminderFrequencyDays: input.reminderFrequencyDays,
        reminderStartDays: input.reminderStartDays,
        expiryWarningDays: input.expiryWarningDays,
        completionCopyEmails: input.completionCopyEmails,
      },
    });

    if (!input.signingOrder || input.signingOrder === envelope.signingOrder) {
      return;
    }

    const recipients = await tx.esigningEnvelopeRecipient.findMany({
      where: { envelopeId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        type: true,
      },
    });

    if (input.signingOrder === 'PARALLEL') {
      await tx.esigningEnvelopeRecipient.updateMany({
        where: {
          envelopeId,
          type: 'SIGNER',
        },
        data: {
          signingOrder: null,
        },
      });
      return;
    }

    const signerIds = recipients
      .filter((recipient) => recipient.type === 'SIGNER')
      .map((recipient) => recipient.id);

    for (const [index, recipientId] of signerIds.entries()) {
      await tx.esigningEnvelopeRecipient.update({
        where: { id: recipientId },
        data: {
          signingOrder: index + 1,
        },
      });
    }
  });

  return getEsigningEnvelopeDetail(session, tenantId, envelopeId);
}

export async function duplicateEsigningEnvelope(
  session: SessionUser,
  tenantId: string,
  envelopeId: string
): Promise<EsigningEnvelopeDetailDto> {
  const scope = await resolveEsigningActorScope(session, tenantId);
  if (!scope.canCreate) {
    throw new Error('Permission denied: esigning:create');
  }

  const sourceEnvelope = await prisma.esigningEnvelope.findFirst({
    where: {
      id: envelopeId,
      tenantId,
      deletedAt: null,
    },
    include: {
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
    },
  });

  if (!sourceEnvelope) {
    throw new Error('Envelope not found');
  }
  if (!canReadEnvelope(scope, session, sourceEnvelope.createdById)) {
    throw new Error('Forbidden');
  }

  const duplicatedEnvelopeId = randomUUID();
  const certificateId = await generateUniqueEsigningCertificateId();
  const duplicatedDocuments = await Promise.all(
    sourceEnvelope.documents.map(async (document) => {
      const duplicatedDocumentId = randomUUID();
      const extension =
        StorageKeys.getExtension(document.fileName, 'application/pdf') || '.pdf';
      const storagePath = StorageKeys.esigningOriginalDocument(
        tenantId,
        duplicatedEnvelopeId,
        duplicatedDocumentId,
        extension
      );

      await storage.copy(document.storagePath, storagePath);

      return {
        sourceId: document.id,
        id: duplicatedDocumentId,
        storagePath,
        fileName: document.fileName,
        originalFileName: document.originalFileName ?? document.fileName,
        fileSize: document.fileSize,
        pageCount: document.pageCount,
        originalHash: document.originalHash,
        sortOrder: document.sortOrder,
      };
    })
  );

  const recipientIdMap = new Map<string, string>();
  const duplicatedRecipients = sourceEnvelope.recipients.map((recipient) => {
    const duplicatedRecipientId = randomUUID();
    recipientIdMap.set(recipient.id, duplicatedRecipientId);

    return {
      id: duplicatedRecipientId,
      name: recipient.name,
      email: recipient.email,
      type: recipient.type,
      signingOrder: recipient.signingOrder,
      accessMode: recipient.accessMode,
      accessCodeHash: recipient.accessCodeHash,
      colorTag: recipient.colorTag,
    };
  });

  const documentIdMap = new Map(
    duplicatedDocuments.map((document) => [document.sourceId, document.id])
  );
  const duplicatedVisibility = Object.fromEntries(
    duplicatedDocuments
      .filter((document) =>
        getEsigningDocumentVisibility(sourceEnvelope.metadata, document.sourceId) === 'EVERYONE'
      )
      .map((document) => [document.id, 'EVERYONE'])
  );

  try {
    await prisma.$transaction(async (tx) => {
      await tx.esigningEnvelope.create({
        data: {
          id: duplicatedEnvelopeId,
          tenantId,
          createdById: session.id,
          title: buildDuplicateEnvelopeTitle(sourceEnvelope.title),
          emailSubject: sourceEnvelope.emailSubject ?? sourceEnvelope.title,
          message: sourceEnvelope.message,
          signingOrder: sourceEnvelope.signingOrder,
          expiresAt: getDuplicateEnvelopeExpiry(sourceEnvelope.expiresAt),
          reminderFrequencyDays: sourceEnvelope.reminderFrequencyDays,
          reminderStartDays: sourceEnvelope.reminderStartDays,
          expiryWarningDays: sourceEnvelope.expiryWarningDays,
          completionCopyEmails: sourceEnvelope.completionCopyEmails,
          companyId: sourceEnvelope.companyId,
          certificateId,
          metadata: Object.keys(duplicatedVisibility).length > 0
            ? { documentVisibility: duplicatedVisibility }
            : undefined,
        },
      });

      if (duplicatedDocuments.length > 0) {
        await tx.esigningEnvelopeDocument.createMany({
          data: duplicatedDocuments.map((document) => ({
            id: document.id,
            tenantId,
            envelopeId: duplicatedEnvelopeId,
            fileName: document.fileName,
            originalFileName: document.originalFileName ?? document.fileName,
            storagePath: document.storagePath,
            fileSize: document.fileSize,
            pageCount: document.pageCount,
            originalHash: document.originalHash,
            sortOrder: document.sortOrder,
          })),
        });
      }

      if (duplicatedRecipients.length > 0) {
        await tx.esigningEnvelopeRecipient.createMany({
          data: duplicatedRecipients.map((recipient) => ({
            id: recipient.id,
            tenantId,
            envelopeId: duplicatedEnvelopeId,
            type: recipient.type,
            name: recipient.name,
            email: recipient.email,
            signingOrder: recipient.signingOrder,
            accessMode: recipient.accessMode,
            accessCodeHash: recipient.accessCodeHash,
            colorTag: recipient.colorTag,
          })),
        });
      }

      if (sourceEnvelope.fieldDefinitions.length > 0) {
        await tx.esigningDocumentFieldDefinition.createMany({
          data: sourceEnvelope.fieldDefinitions.map((field) => {
            const documentId = documentIdMap.get(field.documentId);
            const recipientId = recipientIdMap.get(field.recipientId);
            if (!documentId || !recipientId) {
              throw new Error('Failed to duplicate field mappings');
            }

            return {
              id: randomUUID(),
              tenantId,
              envelopeId: duplicatedEnvelopeId,
              documentId,
              recipientId,
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
            };
          }),
        });
      }

      await tx.esigningEnvelopeEvent.create({
        data: {
          tenantId,
          envelopeId: duplicatedEnvelopeId,
          action: 'CREATED',
          metadata: {
            duplicatedFromEnvelopeId: sourceEnvelope.id,
          },
        },
      });
    });
  } catch (error) {
    await storage
      .deletePrefix(StorageKeys.esigningEnvelopePrefix(tenantId, duplicatedEnvelopeId))
      .catch((storageError) => {
        log.warn('Failed to clean up duplicated envelope storage after error', {
          envelopeId: duplicatedEnvelopeId,
          storageError,
        });
      });
    throw error;
  }

  await createAuditLog({
    tenantId,
    userId: session.id,
    companyId: sourceEnvelope.companyId ?? undefined,
    action: 'CREATE',
    entityType: 'EsigningEnvelope',
    entityId: duplicatedEnvelopeId,
    entityName: buildDuplicateEnvelopeTitle(sourceEnvelope.title),
    summary: `Duplicated e-signing envelope "${sourceEnvelope.title}"`,
    metadata: {
      duplicatedFromEnvelopeId: sourceEnvelope.id,
    },
  });

  return getEsigningEnvelopeDetail(session, tenantId, duplicatedEnvelopeId);
}

export async function deleteDraftEsigningEnvelope(
  session: SessionUser,
  tenantId: string,
  envelopeId: string
): Promise<void> {
  const scope = await resolveEsigningActorScope(session, tenantId);
  const envelope = await prisma.esigningEnvelope.findFirst({
    where: { id: envelopeId, tenantId },
    select: {
      id: true,
      status: true,
      createdById: true,
      title: true,
      companyId: true,
    },
  });

  if (!envelope) {
    throw new Error('Envelope not found');
  }
  if (!['DRAFT', 'COMPLETED', 'DECLINED', 'VOIDED'].includes(envelope.status)) {
    throw new Error('Only draft, completed, declined or voided envelopes can be deleted');
  }
  if (!canDeleteEnvelope(scope, session, envelope.createdById)) {
    throw new Error('Forbidden');
  }

  const linkedTaskStageIds = await safelyCaptureEsigningTaskStageIds(
    tenantId,
    envelopeId,
  );
  await prisma.esigningEnvelope.delete({
    where: { id: envelopeId },
  });
  await safelyReconcileTaskStageIds(
    tenantId,
    linkedTaskStageIds,
    session.id,
  );

  try {
    await storage.deletePrefix(StorageKeys.esigningEnvelopePrefix(tenantId, envelopeId));
  } catch (error) {
    log.warn('Failed to delete envelope storage prefix', { envelopeId, error });
  }

  await createAuditLog({
    tenantId,
    userId: session.id,
    companyId: envelope.companyId ?? undefined,
    action: 'DELETE',
    entityType: 'EsigningEnvelope',
    entityId: envelopeId,
    entityName: envelope.title,
    summary: `Deleted ${envelope.status.toLowerCase()} e-signing envelope "${envelope.title}"`,
  });
}
