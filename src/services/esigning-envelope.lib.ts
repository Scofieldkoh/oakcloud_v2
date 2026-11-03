import { Prisma } from '@/generated/prisma';
import type { SessionUser } from '@/lib/auth';
import { hasPermission, hasTenantWidePermission, requireAnyPermission } from '@/lib/rbac';
import { prisma } from '@/lib/prisma';
import {
  lockEsigningEnvelopeForUpdate,
  type LockedEsigningEnvelopeRow,
} from '@/services/esigning-envelope-lock';
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

export type EsigningPermissionAction = 'create' | 'read' | 'update' | 'delete' | 'manage';

/** The e-signing actions one actor holds in one scope (a company, or tenant-wide). */
export type EsigningPermissionFlags = Record<EsigningPermissionAction, boolean>;

/**
 * What one actor may do with e-signing envelopes, resolved once per request.
 *
 * Company access lives here and in the `can*Envelope` helpers below, so route
 * handlers and services never reason about companies themselves.
 */
export interface EsigningActorScope {
  tenantId: string;
  /** Workspace admin or super admin: every action on every envelope. */
  isAdmin: boolean;
  /** Held through tenant-wide role assignments (no company) only. */
  tenantWide: EsigningPermissionFlags;
  /**
   * Effective flags per company the actor has a company-specific assignment for
   * (`session.companyIds`). Any other company falls back to `tenantWide`, which is
   * the override rule `hasPermission(…, companyId)` applies.
   */
  companies: Record<string, EsigningPermissionFlags>;
  /** Held through any assignment. Only for gating before a company is known. */
  any: EsigningPermissionFlags;
}

/** The facts about an envelope that decide access. */
export interface EsigningEnvelopeAccessRef {
  createdById: string;
  companyId: string | null;
  /**
   * When the caller has it, an envelope of another tenant is never accessible. Callers
   * also filter their queries by tenant; this is the second line.
   */
  tenantId?: string;
}

const ESIGNING_PERMISSION_ACTIONS: readonly EsigningPermissionAction[] = [
  'create',
  'read',
  'update',
  'delete',
  'manage',
];

function allFlags(value: boolean): EsigningPermissionFlags {
  return { create: value, read: value, update: value, delete: value, manage: value };
}

function hasAnyFlag(flags: EsigningPermissionFlags): boolean {
  return ESIGNING_PERMISSION_ACTIONS.some((action) => flags[action]);
}

async function resolveFlags(
  check: (action: EsigningPermissionAction) => Promise<boolean>
): Promise<EsigningPermissionFlags> {
  const results = await Promise.all(ESIGNING_PERMISSION_ACTIONS.map((action) => check(action)));
  const flags = allFlags(false);
  ESIGNING_PERMISSION_ACTIONS.forEach((action, index) => {
    flags[action] = results[index];
  });
  return flags;
}

/**
 * Entry gate for the read routes (list, detail, events, PDFs, package download): the
 * user needs SOME e-signing permission, not necessarily `read`. Envelopes with no
 * company are readable by every e-signing user of the tenant, so a user whose only
 * grant is create, update or delete must get past the route. What they can then see is
 * decided by `buildEsigningEnvelopeReadWhere` and `canReadEnvelope`, so company
 * envelopes still need `read` in that company (or being the creator). Mutation routes
 * keep their own, action-specific gates.
 */
export async function requireEsigningReadEntry(session: SessionUser): Promise<void> {
  if (session.isSuperAdmin || session.isWorkspaceAdmin) {
    return;
  }
  await requireAnyPermission(
    session,
    ESIGNING_PERMISSION_ACTIONS.map((action) => ({ resource: 'esigning' as const, action }))
  );
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
      isAdmin: true,
      tenantWide: allFlags(true),
      companies: {},
      any: allFlags(true),
    };
  }

  const companyIds = Array.from(new Set(session.companyIds ?? []));
  const [any, tenantWide, companyFlags] = await Promise.all([
    resolveFlags((action) => hasPermission(session.id, 'esigning', action)),
    resolveFlags((action) => hasTenantWidePermission(session.id, 'esigning', action)),
    Promise.all(
      companyIds.map(
        async (companyId) =>
          [
            companyId,
            await resolveFlags((action) => hasPermission(session.id, 'esigning', action, companyId)),
          ] as const
      )
    ),
  ]);

  if (!hasAnyFlag(any)) {
    throw new Error('Permission denied: esigning');
  }

  return {
    tenantId,
    isAdmin: false,
    tenantWide,
    companies: Object.fromEntries(companyFlags),
    any,
  };
}

/** The actor's flags for a company, or for tenant-wide scope when `companyId` is empty. */
export function getEsigningFlagsForCompany(
  scope: EsigningActorScope,
  companyId: string | null | undefined
): EsigningPermissionFlags {
  if (scope.isAdmin || !companyId) {
    return scope.tenantWide;
  }
  return scope.companies[companyId] ?? scope.tenantWide;
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

/**
 * The one place the envelope access rule lives.
 *
 * - Envelope in company C: allowed when the actor holds the action for C, or is the
 *   creator and still holds some e-signing permission for C.
 * - Envelope without a company: allowed when the actor holds the action through a
 *   tenant-wide role, or is the creator. (Reading is wider: see `canReadEnvelope`.)
 *
 * Admins always pass. Nothing is ever allowed across tenants.
 */
function canActOnEnvelope(
  scope: EsigningActorScope,
  session: SessionUser,
  envelope: EsigningEnvelopeAccessRef,
  action: EsigningPermissionAction
): boolean {
  if (envelope.tenantId !== undefined && envelope.tenantId !== scope.tenantId) {
    return false;
  }

  if (scope.isAdmin) {
    return true;
  }

  const flags = getEsigningFlagsForCompany(scope, envelope.companyId);
  if (flags[action]) {
    return true;
  }

  if (envelope.createdById !== session.id) {
    return false;
  }

  return envelope.companyId ? hasAnyFlag(flags) : true;
}

/**
 * An envelope with no company belongs to nobody in particular, so every e-signing user of
 * the tenant can read it (an actor scope only exists for users who hold some e-signing
 * permission). Changing, sending and deleting it still follow `canActOnEnvelope`.
 */
export function canReadEnvelope(
  scope: EsigningActorScope,
  session: SessionUser,
  envelope: EsigningEnvelopeAccessRef
): boolean {
  if (envelope.tenantId !== undefined && envelope.tenantId !== scope.tenantId) {
    return false;
  }
  if (!envelope.companyId) {
    return true;
  }
  return canActOnEnvelope(scope, session, envelope, 'read');
}

export function canMutateEnvelope(
  scope: EsigningActorScope,
  session: SessionUser,
  envelope: EsigningEnvelopeAccessRef
): boolean {
  return canActOnEnvelope(scope, session, envelope, 'update');
}

export function canDeleteEnvelope(
  scope: EsigningActorScope,
  session: SessionUser,
  envelope: EsigningEnvelopeAccessRef
): boolean {
  return canActOnEnvelope(scope, session, envelope, 'delete');
}

/** Void, resend, retry processing and manual links: `manage`, or the right to update. */
export function canManageEnvelope(
  scope: EsigningActorScope,
  session: SessionUser,
  envelope: EsigningEnvelopeAccessRef
): boolean {
  return (
    canActOnEnvelope(scope, session, envelope, 'manage') ||
    canActOnEnvelope(scope, session, envelope, 'update')
  );
}

/**
 * Changing an envelope's company needs update rights on the current company and on
 * the target. For both, a real `update` grant is required: the creator exception only
 * covers ordinary edits, so a creator who lost update rights on the source company
 * cannot move the envelope, and nobody can push an envelope into a company they
 * cannot edit. An envelope with no company has no grant to check, so there the
 * ordinary rule (tenant-wide update, or the creator) applies.
 */
export function canMoveEnvelopeToCompany(
  scope: EsigningActorScope,
  session: SessionUser,
  envelope: EsigningEnvelopeAccessRef,
  targetCompanyId: string | null
): boolean {
  if (scope.isAdmin) {
    return true;
  }
  const sourceAllowed = envelope.companyId
    ? getEsigningFlagsForCompany(scope, envelope.companyId).update
    : canMutateEnvelope(scope, session, envelope);
  if (!sourceAllowed) {
    return false;
  }
  return targetCompanyId
    ? getEsigningFlagsForCompany(scope, targetCompanyId).update
    : canMutateEnvelope(scope, session, { createdById: envelope.createdById, companyId: null });
}

/**
 * Re-checks an actor's access against the envelope row itself, under a row lock, inside
 * the transaction that writes. The envelope the service authorized was read before the
 * transaction, and a concurrent company move would make that read stale: the write
 * would land in a company the actor cannot reach. Locking first means a move commits
 * either before this check (and is seen here) or after this transaction (and waits).
 * Throws before any write, so a denied caller leaves nothing behind.
 */
export async function lockEnvelopeForAuthorizedChange(
  tx: Prisma.TransactionClient,
  input: {
    scope: EsigningActorScope;
    session: SessionUser;
    tenantId: string;
    envelopeId: string;
    check: (
      scope: EsigningActorScope,
      session: SessionUser,
      envelope: EsigningEnvelopeAccessRef
    ) => boolean;
  }
): Promise<LockedEsigningEnvelopeRow> {
  const locked = await lockEsigningEnvelopeForUpdate(tx, input.envelopeId);
  if (!locked || locked.tenantId !== input.tenantId) {
    throw new Error('Envelope not found');
  }
  if (!input.check(input.scope, input.session, locked)) {
    throw new Error('Forbidden');
  }
  return locked;
}

/** Creating needs `create` for the company, or from any assignment when there is none yet. */
export function canCreateEnvelopeForCompany(
  scope: EsigningActorScope,
  companyId: string | null | undefined
): boolean {
  if (scope.isAdmin) {
    return true;
  }
  return companyId ? getEsigningFlagsForCompany(scope, companyId).create : scope.any.create;
}

export function assertCanCreateEnvelopeForCompany(
  scope: EsigningActorScope,
  companyId: string | null | undefined
): void {
  if (!canCreateEnvelopeForCompany(scope, companyId)) {
    throw new Error('Permission denied: esigning:create');
  }
}

/**
 * Prisma `where` limiting envelopes to the ones `canReadEnvelope` allows. The list,
 * the total, the status counts and the company counts all start from this, so a
 * count never includes an envelope the actor cannot open. It says nothing about the
 * tenant: callers must add `tenantId` (the admin case returns an empty filter).
 */
export function buildEsigningEnvelopeReadWhere(
  scope: EsigningActorScope,
  session: SessionUser
): Prisma.EsigningEnvelopeWhereInput {
  if (scope.isAdmin) {
    return {};
  }

  const clauses: Prisma.EsigningEnvelopeWhereInput[] = [];
  const own = { createdById: session.id };

  // No company: every e-signing user of the tenant (the caller's query adds the tenant).
  clauses.push({ companyId: null });

  // Companies with their own assignment (these override the tenant-wide roles).
  const explicitIds = Object.keys(scope.companies);
  const readableIds = explicitIds.filter((id) => scope.companies[id].read);
  const creatorOnlyIds = explicitIds.filter(
    (id) => !scope.companies[id].read && hasAnyFlag(scope.companies[id])
  );
  if (readableIds.length > 0) {
    clauses.push({ companyId: { in: readableIds } });
  }
  if (creatorOnlyIds.length > 0) {
    clauses.push({ companyId: { in: creatorOnlyIds }, ...own });
  }

  // Every other company falls back to the tenant-wide roles.
  const otherCompanies = {
    not: null,
    ...(explicitIds.length > 0 ? { notIn: explicitIds } : {}),
  };
  if (scope.tenantWide.read) {
    clauses.push({ companyId: otherCompanies });
  } else if (hasAnyFlag(scope.tenantWide)) {
    clauses.push({ companyId: otherCompanies, ...own });
  }

  return { OR: clauses };
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
  const accessRef: EsigningEnvelopeAccessRef = {
    createdById: envelope.createdById,
    companyId: envelope.companyId,
  };
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
    canEdit: envelope.status === 'DRAFT' && canMutateEnvelope(scope, session, accessRef),
    canDelete:
      ['DRAFT', 'COMPLETED'].includes(envelope.status) &&
      canDeleteEnvelope(scope, session, accessRef),
    canSend: envelope.status === 'DRAFT' && canMutateEnvelope(scope, session, accessRef),
    canVoid: ['SENT', 'IN_PROGRESS'].includes(envelope.status) && canManageEnvelope(scope, session, accessRef),
    canDuplicate:
      canCreateEnvelopeForCompany(scope, envelope.companyId) &&
      canReadEnvelope(scope, session, accessRef),
    canRetryCompletionProcessing:
      envelope.status === 'COMPLETED' &&
      (envelope.pdfGenerationStatus === 'FAILED' ||
        ['FAILED_RETRYABLE', 'FAILED_PERMANENT'].includes(envelope.autoFilingStatus ?? '') ||
        (envelope.emailDeliveries ?? []).some((delivery) =>
          delivery.kind === 'COMPLETION' &&
          ['FAILED_RETRYABLE', 'FAILED_PERMANENT'].includes(delivery.status)
        )) &&
      canManageEnvelope(scope, session, accessRef),
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
