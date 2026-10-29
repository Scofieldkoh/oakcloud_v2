/**
 * Document Generator Service
 *
 * Business logic for generating and managing documents.
 * Handles document lifecycle: draft -> finalized -> archived.
 * Fully integrated with multi-tenancy support.
 */

import { rejectRetiredA4Operation } from '@/lib/document-editor/a4-retirement';
import { prisma } from '@/lib/prisma';
import { createAuditLog, computeChanges } from '@/lib/audit';
import {
  prepareCompanyContext,
  type PlaceholderContext,
  type ContactData,
} from '@/lib/placeholder-resolver';
import { resolveTemplateFields } from '@/lib/template-field-runtime';
import { loadStoredFieldRegistry } from '@/lib/template-field-registry';
import {
  normalizeStoredFieldDefinitionInput,
  resolveTopLevelCustomValues,
} from '@/lib/document-editor/template-field-workflow';
import {
  InvalidDocumentEngineError,
  readGeneratedDocumentEngineState,
} from '@/lib/document-editor/document-engine';
import {
  assertGeneratedOakDocReadyForFinalization,
  cloneOakDocGeneratedDocument,
} from '@/services/oakdoc-generation.service';
import {
  RESERVED_GENERATED_CONTENT_JSON_KEYS,
  RESERVED_GENERATED_METADATA_KEYS,
  mergeUserJsonPreservingReserved,
} from '@/lib/document-editor/oakdoc-reserved-metadata';
import { getPartialsUsedInTemplate } from '@/services/template-partial.service';
import { getCompanyById } from '@/services/company.service';
import {
  getDocumentPartyOptions,
  resolveDocumentPartySelections,
} from '@/services/document-party.service';
import { addSectionAnchors, extractSections } from '@/services/document-validation.service';
import {
  analyzeTemplateContent,
  extractPartialReferences,
  getRequiredPartySelections,
  type TemplateDiagnostics,
} from '@/lib/template-analysis';
import type {
  CreateDocumentFromTemplateInput,
  CreateBlankDocumentInput,
  UpdateGeneratedDocumentInput,
  SearchGeneratedDocumentsInput,
  CloneDocumentInput,
  CreateDocumentCommentInput,
} from '@/lib/validations/generated-document';
import { Prisma } from '@/generated/prisma';
import type {
  GeneratedDocument,
  DocumentComment,
  GeneratedDocumentStatus,
  EsigningEnvelopeStatus,
} from '@/generated/prisma';
import type { TenantAwareParams } from '@/lib/types';
import type { TaskLaunchContext } from '@/services/tasks/types';
import { ApiError, ErrorCodes, NotFoundError, ValidationError } from '@/lib/errors';
import { createLogger } from '@/lib/logger';
import { readActiveGenerationSession } from '@/lib/document-generation-session';
import { metadataHasUnresolvedTemplateData } from '@/lib/document-finalization';
import { safelyReconcileGeneratedDocumentTaskOutcomes } from '@/services/tasks/integration.service';
import {
  assembleServiceAgreementTemplate,
  getServiceAgreementDraftById,
} from '@/services/service-agreement';
import {
  assertGeneratedDocumentCanBeUnfinalized,
  queueTaskEsigningPreparationsForGeneratedDocument,
} from '@/services/tasks/esigning-preparation.service';
import { assertRevisionPrecondition } from '@/lib/document-editor/revision-concurrency';
import {
  claimGeneratedDocumentRevision,
  readGeneratedDocumentRevision,
  readGeneratedDocumentRevisions,
} from '@/lib/document-editor/generated-document-revision';

const log = createLogger('document-generator');

export type GeneratedDocumentWithRevision = GeneratedDocument & { revision: number };

export interface GeneratedDocumentWithRelations extends GeneratedDocument {
  revision: number;
  template?: { id: string; name: string; category: string } | null;
  company?: { id: string; name: string; uen: string } | null;
  createdBy?: { id: string; firstName: string; lastName: string };
  finalizedBy?: { id: string; firstName: string; lastName: string } | null;
  esigningEnvelopeDocuments?: Array<{
    envelope: {
      id: string;
      title: string;
      status: EsigningEnvelopeStatus;
      completedAt: Date | null;
    };
  }>;
  comments?: DocumentCommentWithReplies[];
  _count?: { comments: number; drafts: number };
}

export interface DocumentCommentWithReplies extends DocumentComment {
  user?: { id: string; firstName: string; lastName: string } | null;
  replies?: DocumentCommentWithReplies[];
  parent?: DocumentComment | null;
}

export interface RenderTemplateForGenerationParams {
  templateId?: string;
  templateContent?: string;
  templateName?: string;
  templateCategory?: string;
  templateVersion?: number;
  tenantId: string;
  userId?: string;
  companyId?: string | null;
  contactIds?: string[];
  selectedDirectorId?: string;
  selectedDirectorIds?: string[];
  selectedShareholderId?: string;
  selectedContactId?: string;
  customData?: Record<string, unknown>;
  contextOverride?: PlaceholderContext;
  generatedBy?: string;
  mode?: 'preview' | 'test' | 'generate' | 'validate';
  serviceAgreementId?: string;
  generatedDocumentId?: string;
}

export interface RenderTemplateForGenerationResult {
  template: { id: string; name: string; category: string; version: number };
  content: string;
  contentHtml: string;
  rawResolvedContent: string;
  sections: ReturnType<typeof extractSections>;
  missingPlaceholders: string[];
  missingPartials: string[];
  contextSummary: { hasCompany: boolean; hasContacts: boolean; hasCustomData: boolean };
  blockingErrors: string[];
  context: PlaceholderContext;
  diagnostics: TemplateDiagnostics;
  dependencySnapshot: {
    templateId: string;
    templateName: string;
    templateVersion: number;
    partials: Array<{
      name: string;
      found: boolean;
      version?: number | null;
      updatedAt?: string | null;
    }>;
    serviceAgreement?: {
      id: string;
      items: Array<{
        itemId: string;
        variantVersion: number;
        partialVersion: number;
        dependencies: Array<{ id: string; name: string; version: number; updatedAt: string }>;
      }>;
    };
  };
}

export type { TenantAwareParams } from '@/lib/types';

const TRACKED_FIELDS: (keyof GeneratedDocument)[] = [
  'title',
  'content',
  'status',
  'useLetterhead',
];

function withRevision<T extends GeneratedDocument>(document: T, revision: number): T & { revision: number } {
  return { ...document, revision };
}

function generatedDocumentStateConflict(deleted = false): ApiError {
  return new ApiError(
    ErrorCodes.CONFLICT,
    deleted
      ? 'This resource is deleted.'
      : 'This resource is not editable in its current state.',
    409,
    {
      resourceType: 'GeneratedDocument',
      action: 'reload-read-only',
    },
  );
}

async function buildContactsContext(
  contactIds: string[] | undefined,
  tenantId: string,
): Promise<{ firstContact?: ContactData; contacts: ContactData[] }> {
  if (!contactIds || contactIds.length === 0) return { contacts: [] };

  const contacts = await prisma.contact.findMany({
    where: { id: { in: contactIds }, tenantId, deletedAt: null },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      fullName: true,
      contactType: true,
      fullAddress: true,
      nationality: true,
      identificationNumber: true,
      contactDetails: {
        where: { deletedAt: null, companyId: null },
        select: { detailType: true, value: true },
      },
    },
  });

  const orderedContacts = contactIds
    .map((id) => contacts.find((contact) => contact.id === id))
    .filter((contact): contact is NonNullable<typeof contact> => Boolean(contact));

  const mappedContacts = orderedContacts.map((contact) => {
    const email = contact.contactDetails?.find((detail) => detail.detailType === 'EMAIL');
    const phone = contact.contactDetails?.find((detail) => detail.detailType === 'PHONE');
    return {
      id: contact.id,
      fullName: contact.fullName || `${contact.firstName || ''} ${contact.lastName || ''}`.trim(),
      firstName: contact.firstName,
      lastName: contact.lastName,
      contactType: contact.contactType,
      email: email?.value || null,
      phone: phone?.value || null,
      fullAddress: contact.fullAddress,
      nationality: contact.nationality,
      identificationNumber: contact.identificationNumber,
    } satisfies ContactData;
  });

  return { firstContact: mappedContacts[0], contacts: mappedContacts };
}

function buildBlockingErrors(
  missingPlaceholders: string[],
  missingPartials: string[],
  diagnostics?: Pick<TemplateDiagnostics, 'circularPartials' | 'syntaxErrors'>,
): string[] {
  const errors: string[] = [];
  if (missingPlaceholders.length > 0) {
    errors.push(`Unresolved placeholders: ${missingPlaceholders.join(', ')}`);
  }
  if (missingPartials.length > 0) {
    errors.push(`Missing partials: ${missingPartials.join(', ')}`);
  }
  if (diagnostics?.circularPartials.length) {
    errors.push(`Circular partial references: ${diagnostics.circularPartials.join(', ')}`);
  }
  if (diagnostics?.syntaxErrors.length) {
    errors.push(`Template syntax errors: ${diagnostics.syntaxErrors.join('; ')}`);
  }
  return errors;
}

export async function renderTemplateForGeneration(
  params: RenderTemplateForGenerationParams,
): Promise<RenderTemplateForGenerationResult> {
  const {
    templateId,
    tenantId,
    userId,
    companyId,
    contactIds = [],
    selectedDirectorId,
    selectedDirectorIds,
    selectedShareholderId,
    selectedContactId,
    customData = {},
    contextOverride,
    generatedBy,
    mode = 'preview',
    templateContent,
    templateName = 'Unsaved template',
    templateCategory = 'OTHER',
    templateVersion = 1,
    serviceAgreementId,
    generatedDocumentId,
  } = params;

  if (!tenantId) throw new Error('Tenant ID is required for template rendering');

  const template = templateId
    ? await prisma.documentTemplate.findFirst({ where: { id: templateId, tenantId, deletedAt: null } })
    : null;
  if (templateId && !template) throw new NotFoundError('Template not found');
  if (template && mode !== 'test' && !template.isActive) throw new Error('Template is not active');

  let renderContent = template?.content ?? templateContent;
  if (!renderContent) throw new Error('Template content is required for rendering');

  const fieldScope = {
    kind: 'template' as const,
    id: template?.id ?? `ad-hoc:${templateName}`,
  };
  const storedFieldDefinitions = normalizeStoredFieldDefinitionInput(template?.placeholders);
  const fieldRegistry = loadStoredFieldRegistry({
    scope: fieldScope,
    definitions: storedFieldDefinitions,
  });
  const effectiveCustomData = resolveTopLevelCustomValues({
    scope: fieldScope,
    definitions: storedFieldDefinitions,
    itemValues: customData,
  });

  const isServiceAgreement = template?.compositionType === 'SERVICE_AGREEMENT';
  if (!isServiceAgreement && serviceAgreementId) {
    throw new Error('Standard templates cannot use Service Agreement data');
  }
  if (isServiceAgreement && serviceAgreementId && !userId && mode !== 'test') {
    throw new ValidationError('An authenticated actor is required to render a Service Agreement');
  }
  const agreement = isServiceAgreement
    ? serviceAgreementId
      ? await getServiceAgreementDraftById(serviceAgreementId, userId ? { tenantId, userId } : tenantId)
      : null
    : null;
  if (isServiceAgreement && !agreement) throw new Error('A saved Service Agreement draft is required');
  if (agreement && agreement.primaryCompanyId !== companyId) {
    throw new Error('Service Agreement primary company does not match the selected company');
  }
  if (agreement && generatedDocumentId && agreement.generatedDocumentId !== generatedDocumentId) {
    throw new Error('Service Agreement does not match the document draft');
  }
  const agreementAssembly = agreement
    ? assembleServiceAgreementTemplate({ templateContent: renderContent, agreement })
    : null;
  if (agreementAssembly) renderContent = agreementAssembly.content;

  let context: PlaceholderContext = contextOverride
    ? {
        ...contextOverride,
        custom: { ...contextOverride.custom, ...effectiveCustomData },
        system: {
          ...(contextOverride.system ?? {}),
          ...(generatedBy ? { preparerName: generatedBy, generatedBy } : {}),
          currentDate: contextOverride.system?.currentDate ?? new Date(),
        },
      }
    : {
        custom: effectiveCustomData,
        system: {
          currentDate: new Date(),
          ...(generatedBy ? { preparerName: generatedBy, generatedBy } : {}),
        },
      };

  if (companyId && !context.company) {
    const company = await getCompanyById(companyId, tenantId);
    if (!company) throw new NotFoundError('Company not found');
    const partyOptions = await getDocumentPartyOptions(companyId, tenantId);
    const directorFieldsById = new Map(partyOptions.directors.map((party) => [party.id, party]));
    const shareholderFieldsById = new Map(partyOptions.shareholders.map((party) => [party.id, party]));
    const companyWithPartyFields = {
      ...company,
      officers: (company.officers ?? []).map((officer) => {
        const party = directorFieldsById.get(officer.id);
        return party
          ? { ...officer, email: party.email, phone: party.phone, letterAddress: party.address.letter }
          : officer;
      }),
      shareholders: (company.shareholders ?? []).map((shareholder) => {
        const party = shareholderFieldsById.get(shareholder.id);
        return party
          ? { ...shareholder, email: party.email, phone: party.phone, letterAddress: party.address.letter }
          : shareholder;
      }),
    };
    const companyContext = prepareCompanyContext(
      companyWithPartyFields as unknown as Parameters<typeof prepareCompanyContext>[0],
    );
    context = {
      ...context,
      ...companyContext,
      system: {
        ...companyContext.system,
        ...context.system,
        currentDate: context.system?.currentDate ?? companyContext.system?.currentDate ?? new Date(),
      },
      custom: { ...companyContext.custom, ...context.custom },
    };
  }

  const selectedContactRequiresResolution = Boolean(selectedContactId && !agreement);
  if (
    selectedDirectorIds !== undefined
    || selectedDirectorId
    || selectedShareholderId
    || selectedContactRequiresResolution
  ) {
    if (!companyId) throw new Error('Company selection is required for selected parties');
    const selections = await resolveDocumentPartySelections({
      companyId,
      tenantId,
      selectedDirectorId,
      ...(selectedDirectorIds !== undefined ? { selectedDirectorIds } : {}),
      selectedShareholderId,
      selectedContactId: selectedContactRequiresResolution ? selectedContactId : undefined,
    });
    context = { ...context, ...selections };
    if (selectedDirectorIds !== undefined) {
      const selectedDirectorIdSet = new Set(selectedDirectorIds);
      context.directors = (context.directors ?? []).filter(
        (director) => director.id && selectedDirectorIdSet.has(director.id),
      );
    }
  }

  if (agreement) {
    const authorizedRepresentatives = agreement.authorizedRepresentativeSnapshots.map(
      (representative) => ({
        id: representative.id,
        contactId: representative.id,
        name: representative.name,
        detail: representative.role,
        role: representative.role,
        contactType: 'INDIVIDUAL',
        email: representative.email ?? '',
        phone: representative.phone ?? '',
        address: { full: null, letter: null },
      }),
    );
    const signerIdSet = new Set(agreement.signerContactIds);
    const signers = authorizedRepresentatives.filter((representative) => signerIdSet.has(representative.id));
    context = {
      ...context,
      selectedContact: signers[0] ?? authorizedRepresentatives[0],
      authorizedRepresentatives,
      signers,
    };
  }

  const legacyContactContext = await buildContactsContext(contactIds, tenantId);
  const seenContactIds = new Set<string>();
  const contacts = [...(context.contacts ?? []), ...legacyContactContext.contacts].filter((contact) => {
    if (seenContactIds.has(contact.id)) return false;
    seenContactIds.add(contact.id);
    return true;
  });
  if (contacts.length > 0) {
    context = {
      ...context,
      contact: contacts[0],
      contacts,
      custom: { ...context.custom, contacts },
    };
  }
  if (agreement) {
    context = {
      ...context,
      custom: {
        ...context.custom,
        agreementDate: agreement.agreementDate,
        effectiveDate: agreement.effectiveDate ?? agreement.agreementDate,
        termMonths: String(agreement.termMonths),
      },
    };
  }

  const partialRefs = extractPartialReferences(renderContent);
  let partials: Awaited<ReturnType<typeof getPartialsUsedInTemplate>> = [];
  let partialsMap = new Map<string, string>();
  if (partialRefs.length > 0) {
    partials = await getPartialsUsedInTemplate(renderContent, tenantId);
    partialsMap = new Map(partials.map((partial) => [partial.name, partial.content]));
  }

  const diagnostics = analyzeTemplateContent({
    content: renderContent,
    placeholders: template?.placeholders,
    partials,
  });
  if (mode !== 'test') {
    const partyRequirements = getRequiredPartySelections(renderContent, partials);
    if (partyRequirements.director && !selectedDirectorId) throw new Error('Select a director for this template.');
    if (partyRequirements.shareholder && !selectedShareholderId) throw new Error('Select a shareholder for this template.');
    if (partyRequirements.contact && !selectedContactId && !agreement) {
      throw new Error('Select a company contact for this template.');
    }
  }

  const fieldResolution = resolveTemplateFields(
    renderContent,
    context,
    { missingPlaceholder: 'highlight', partialsMap },
    {
      registry: fieldRegistry.definitions,
      partials: partials.map((partial) => ({
        id: partial.id?.trim() || `legacy-partial:${partial.name}`,
        name: partial.name,
        content: partial.content ?? '',
      })),
    },
  );
  const { resolved, missing, missingPartials } = fieldResolution;
  const contentWithAnchors = addSectionAnchors(resolved);
  const sections = extractSections(contentWithAnchors);

  return {
    template: {
      id: template?.id ?? 'ad-hoc',
      name: template?.name ?? templateName,
      category: template?.category ?? templateCategory,
      version: template?.version ?? templateVersion,
    },
    content: contentWithAnchors,
    contentHtml: contentWithAnchors,
    rawResolvedContent: resolved,
    sections,
    missingPlaceholders: missing,
    missingPartials,
    contextSummary: {
      hasCompany: Boolean(companyId || context.company),
      hasContacts: contacts.length > 0,
      hasCustomData: Object.keys(effectiveCustomData).length > 0,
    },
    blockingErrors: [
      ...buildBlockingErrors(missing, missingPartials, diagnostics),
      ...(agreementAssembly?.itemDiagnostics.flatMap((item) =>
        item.missingPlaceholders.map(
          (placeholder) => `Service item ${item.itemId} is missing required field ${placeholder}`,
        ),
      ) ?? []),
    ],
    context,
    diagnostics,
    dependencySnapshot: {
      templateId: template?.id ?? 'ad-hoc',
      templateName: template?.name ?? templateName,
      templateVersion: template?.version ?? templateVersion,
      partials: diagnostics.dependencies.map((dependency) => ({
        name: dependency.name,
        found: dependency.found,
        version: dependency.version,
        updatedAt: dependency.updatedAt,
      })),
      ...(agreement
        ? {
            serviceAgreement: {
              id: agreement.id,
              items: agreement.items.map((item) => ({
                itemId: item.id,
                variantVersion: item.variantVersion,
                partialVersion: item.partialVersion,
                dependencies: item.partialDependencySnapshot,
              })),
            },
          }
        : {}),
    },
  };
}

export interface MaterializeDocumentTarget {
  generatedDocumentId?: string;
  expectedBatchItemId?: string;
  serviceAgreementId?: string;
}

export async function materializeDocumentFromTemplate(
  _data: CreateDocumentFromTemplateInput,
  _params: TenantAwareParams,
  _target: MaterializeDocumentTarget = {},
  _taskIntegrationContext?: TaskLaunchContext,
): Promise<GeneratedDocumentWithRevision> {
  // Generation from templates is OakDoc-only (materializeOakDocGeneratedDocument).
  return rejectRetiredA4Operation('document-generate');
}

export async function createDocumentFromTemplate(
  data: CreateDocumentFromTemplateInput,
  params: TenantAwareParams,
  taskIntegrationContext?: TaskLaunchContext,
): Promise<GeneratedDocumentWithRevision> {
  if (data.draftId) {
    const generationDraft = await prisma.generatedDocument.findFirst({
      where: { id: data.draftId, tenantId: params.tenantId, deletedAt: null },
    });
    if (
      !generationDraft
      || generationDraft.status !== 'DRAFT'
      || !readActiveGenerationSession(generationDraft.metadata)
    ) {
      throw new NotFoundError('Document draft not found');
    }
  }
  return materializeDocumentFromTemplate(
    data,
    params,
    { generatedDocumentId: data.draftId, serviceAgreementId: data.serviceAgreementId },
    taskIntegrationContext,
  );
}

export async function createBlankDocument(
  _data: CreateBlankDocumentInput,
  _params: TenantAwareParams,
  _taskIntegrationContext?: TaskLaunchContext,
): Promise<GeneratedDocumentWithRevision> {
  // Blank documents are created by createBlankOakDocDocument.
  return rejectRetiredA4Operation('document-create-blank');
}

export async function updateGeneratedDocument(
  data: UpdateGeneratedDocumentInput,
  params: TenantAwareParams,
  reason?: string,
): Promise<GeneratedDocumentWithRevision> {
  const { tenantId, userId } = params;
  assertRevisionPrecondition(data.expectedRevision, 'generated-document');

  const existing = await prisma.generatedDocument.findFirst({
    where: { id: data.id, tenantId, deletedAt: null },
  });
  if (!existing) throw new NotFoundError('Document not found');
  if (existing.status === 'FINALIZED' || existing.status === 'ARCHIVED') {
    throw generatedDocumentStateConflict();
  }

  const engine = readGeneratedDocumentEngineState(existing.metadata);
  if (data.content !== undefined || data.contentJson !== undefined) {
    if (engine === 'A4') rejectRetiredA4Operation('document-edit');
    throw new ValidationError('OakDoc document content is saved from the Word editor, not as HTML');
  }
  const contentJson = data.contentJson === undefined
    ? undefined
    : mergeUserJsonPreservingReserved(
      existing.contentJson,
      data.contentJson,
      RESERVED_GENERATED_CONTENT_JSON_KEYS,
      'contentJson',
    );
  const metadata = data.metadata === undefined
    ? undefined
    : mergeUserJsonPreservingReserved(
      existing.metadata,
      data.metadata,
      RESERVED_GENERATED_METADATA_KEYS,
      'metadata',
    );


  const updateData: Prisma.GeneratedDocumentUpdateInput = {};
  if (data.title !== undefined) updateData.title = data.title;
  if (data.content !== undefined) updateData.content = data.content;
  if (contentJson !== undefined) {
    updateData.contentJson = contentJson ? (contentJson as Prisma.InputJsonValue) : Prisma.JsonNull;
  }
  if (data.useLetterhead !== undefined) updateData.useLetterhead = data.useLetterhead;
  if (metadata !== undefined) {
    updateData.metadata = metadata ? (metadata as Prisma.InputJsonValue) : Prisma.JsonNull;
  }

  const document = await prisma.$transaction(async (tx) => {
    const claim = await claimGeneratedDocumentRevision(tx, {
      id: data.id,
      tenantId,
      expectedRevision: data.expectedRevision,
      allowedStatuses: ['DRAFT'],
    });
    const updated = await tx.generatedDocument.update({ where: { id: data.id }, data: updateData });
    return withRevision(updated, claim.revision);
  });

  const changes = computeChanges(existing as Record<string, unknown>, data, TRACKED_FIELDS as string[]);
  if (changes) {
    const changedFields = Object.keys(changes).join(', ');
    await createAuditLog({
      tenantId,
      userId,
      companyId: document.companyId ?? undefined,
      action: 'UPDATE',
      entityType: 'GeneratedDocument',
      entityId: document.id,
      entityName: document.title,
      summary: `Updated document "${document.title}" (${changedFields})`,
      changeSource: 'MANUAL',
      changes,
      reason,
    });
  }
  return document;
}

export async function finalizeDocument(
  id: string,
  params: TenantAwareParams,
  expectedRevision?: number,
): Promise<GeneratedDocumentWithRevision> {
  const { tenantId, userId } = params;
  assertRevisionPrecondition(expectedRevision, 'generated-document');

  const existing = await prisma.generatedDocument.findFirst({
    where: { id, tenantId, deletedAt: null },
  });
  if (!existing) throw new NotFoundError('Document not found');
  if (existing.status === 'FINALIZED' || existing.status === 'ARCHIVED') {
    throw generatedDocumentStateConflict();
  }
  if (metadataHasUnresolvedTemplateData(existing.metadata)) {
    throw new Error('Cannot finalize document with unresolved placeholders or partials');
  }
  const engine = readGeneratedDocumentEngineState(existing.metadata);
  if (engine === 'INVALID') throw new InvalidDocumentEngineError('generated-document');
  if (engine === 'OAKDOC') {
    await assertGeneratedOakDocReadyForFinalization(id, tenantId);
  }

  const document = await prisma.$transaction(async (tx) => {
    const claim = await claimGeneratedDocumentRevision(tx, {
      id,
      tenantId,
      expectedRevision,
      allowedStatuses: ['DRAFT'],
    });
    const updated = await tx.generatedDocument.update({
      where: { id },
      data: { status: 'FINALIZED', finalizedAt: new Date(), finalizedById: userId },
    });
    return withRevision(updated, claim.revision);
  });

  await createAuditLog({
    tenantId,
    userId,
    companyId: document.companyId ?? undefined,
    action: 'DOCUMENT_FINALIZED',
    entityType: 'GeneratedDocument',
    entityId: document.id,
    entityName: document.title,
    summary: `Finalized document "${document.title}"`,
    changeSource: 'MANUAL',
  });
  await safelyReconcileGeneratedDocumentTaskOutcomes(tenantId, document.id, userId);
  try {
    await queueTaskEsigningPreparationsForGeneratedDocument(tenantId, document.id, userId);
  } catch (error) {
    log.warn('Failed to queue E-signing preparation after document finalization', {
      documentId: document.id,
      error,
    });
  }
  return document;
}

export async function unfinalizeDocument(
  id: string,
  params: TenantAwareParams,
  reason: string,
  expectedRevision?: number,
): Promise<GeneratedDocumentWithRevision> {
  const { tenantId, userId } = params;
  assertRevisionPrecondition(expectedRevision, 'generated-document');

  const existing = await prisma.generatedDocument.findFirst({
    where: { id, tenantId, deletedAt: null },
  });
  if (!existing) throw new NotFoundError('Document not found');
  if (existing.status !== 'FINALIZED') throw generatedDocumentStateConflict();

  const document = await prisma.$transaction(async (tx) => {
    const claim = await claimGeneratedDocumentRevision(tx, {
      id,
      tenantId,
      expectedRevision,
      allowedStatuses: ['FINALIZED'],
    });
    await assertGeneratedDocumentCanBeUnfinalized(tenantId, existing.id, tx);
    const updated = await tx.generatedDocument.update({
      where: { id },
      data: { status: 'DRAFT', unfinalizedAt: new Date() },
    });
    return withRevision(updated, claim.revision);
  });

  await createAuditLog({
    tenantId,
    userId,
    companyId: document.companyId ?? undefined,
    action: 'DOCUMENT_UNFINALIZED',
    entityType: 'GeneratedDocument',
    entityId: document.id,
    entityName: document.title,
    summary: `Un-finalized document "${document.title}"`,
    changeSource: 'MANUAL',
    reason,
  });
  await safelyReconcileGeneratedDocumentTaskOutcomes(tenantId, document.id, userId);
  try {
    await queueTaskEsigningPreparationsForGeneratedDocument(tenantId, document.id, userId);
  } catch (error) {
    log.warn('Failed to queue E-signing detach after document unfinalization', {
      documentId: document.id,
      error,
    });
  }
  return document;
}

export async function archiveDocument(
  id: string,
  params: TenantAwareParams,
  reason: string,
  expectedRevision?: number,
): Promise<GeneratedDocumentWithRevision> {
  const { tenantId, userId } = params;
  assertRevisionPrecondition(expectedRevision, 'generated-document');

  const existing = await prisma.generatedDocument.findFirst({ where: { id, tenantId, deletedAt: null } });
  if (!existing) throw new NotFoundError('Document not found');
  if (existing.status === 'ARCHIVED') throw generatedDocumentStateConflict();

  const document = await prisma.$transaction(async (tx) => {
    const claim = await claimGeneratedDocumentRevision(tx, {
      id,
      tenantId,
      expectedRevision,
      allowedStatuses: ['DRAFT', 'FINALIZED'],
    });
    const updated = await tx.generatedDocument.update({ where: { id }, data: { status: 'ARCHIVED' } });
    return withRevision(updated, claim.revision);
  });

  await createAuditLog({
    tenantId,
    userId,
    companyId: document.companyId ?? undefined,
    action: 'DOCUMENT_ARCHIVED',
    entityType: 'GeneratedDocument',
    entityId: document.id,
    entityName: document.title,
    summary: `Archived document "${document.title}"`,
    changeSource: 'MANUAL',
    reason,
  });
  await safelyReconcileGeneratedDocumentTaskOutcomes(tenantId, document.id, userId);
  return document;
}

export async function deleteGeneratedDocument(
  id: string,
  params: TenantAwareParams,
  reason: string,
  expectedRevision?: number,
): Promise<GeneratedDocumentWithRevision> {
  const { tenantId, userId } = params;
  assertRevisionPrecondition(expectedRevision, 'generated-document');

  const existing = await prisma.generatedDocument.findFirst({ where: { id, tenantId } });
  if (!existing) throw new NotFoundError('Document not found');
  if (existing.deletedAt) throw generatedDocumentStateConflict(true);

  const document = await prisma.$transaction(async (tx) => {
    const claim = await claimGeneratedDocumentRevision(tx, { id, tenantId, expectedRevision });
    const updated = await tx.generatedDocument.update({ where: { id }, data: { deletedAt: new Date() } });
    return withRevision(updated, claim.revision);
  });

  await createAuditLog({
    tenantId,
    userId,
    companyId: document.companyId ?? undefined,
    action: 'DELETE',
    entityType: 'GeneratedDocument',
    entityId: document.id,
    entityName: document.title,
    summary: `Deleted document "${document.title}"`,
    changeSource: 'MANUAL',
    reason,
  });
  await safelyReconcileGeneratedDocumentTaskOutcomes(tenantId, document.id, userId);
  return document;
}

export interface BulkDeleteGeneratedDocumentsResult {
  deleted: number;
  failed: Array<{ id: string; error: string; code?: string }>;
}

export async function bulkDeleteGeneratedDocuments(
  ids: string[],
  params: TenantAwareParams,
  reason: string,
  expectedRevisions: Record<string, number> = {},
): Promise<BulkDeleteGeneratedDocumentsResult> {
  const { tenantId, userId } = params;
  const documents = await prisma.generatedDocument.findMany({
    where: { id: { in: ids }, tenantId },
    select: { id: true, title: true, companyId: true, deletedAt: true },
  });

  const failed: Array<{ id: string; error: string; code?: string }> = [];
  let deleted = 0;
  for (const id of ids) {
    const document = documents.find((candidate) => candidate.id === id);
    if (!document) {
      failed.push({ id, error: 'Document not found' });
      continue;
    }
    if (document.deletedAt) {
      failed.push({ id, error: 'This resource is deleted.', code: ErrorCodes.CONFLICT });
      continue;
    }

    const expectedRevision = expectedRevisions[id];
    assertRevisionPrecondition(expectedRevision, 'generated-document');
    try {
      const deletedDocument = await prisma.$transaction(async (tx) => {
        const claim = await claimGeneratedDocumentRevision(tx, { id, tenantId, expectedRevision });
        const updated = await tx.generatedDocument.update({
          where: { id },
          data: { deletedAt: new Date() },
        });
        return withRevision(updated, claim.revision);
      });

      await createAuditLog({
        tenantId,
        userId,
        companyId: document.companyId ?? undefined,
        action: 'DELETE',
        entityType: 'GeneratedDocument',
        entityId: document.id,
        entityName: document.title,
        summary: `Deleted document "${document.title}"`,
        changeSource: 'MANUAL',
        reason,
        metadata: { revision: deletedDocument.revision },
      });
      await safelyReconcileGeneratedDocumentTaskOutcomes(tenantId, document.id, userId);
      deleted += 1;
    } catch (error) {
      failed.push({
        id,
        error: error instanceof Error ? error.message : 'Delete failed',
        ...(error instanceof ApiError ? { code: error.code } : {}),
      });
    }
  }

  return { deleted, failed };
}

export async function cloneDocument(
  data: CloneDocumentInput,
  params: TenantAwareParams,
): Promise<GeneratedDocumentWithRevision> {
  const { tenantId, userId } = params;
  const source = await prisma.generatedDocument.findFirst({
    where: { id: data.id, tenantId, deletedAt: null },
  });
  if (!source) throw new NotFoundError('Document not found');
  const sourceEngine = readGeneratedDocumentEngineState(source.metadata);
  if (sourceEngine === 'INVALID') throw new InvalidDocumentEngineError('generated-document');
  if (sourceEngine === 'A4') rejectRetiredA4Operation('document-clone');

  let newTitle = data.title || `Copy of ${source.title}`;
  let counter = 1;
  while (true) {
    const existing = await prisma.generatedDocument.findFirst({
      where: { tenantId, title: newTitle, deletedAt: null },
    });
    if (!existing) break;
    counter++;
    newTitle = data.title ? `${data.title} (${counter})` : `Copy of ${source.title} (${counter})`;
    if (counter > 100) throw new Error('Unable to generate unique title');
  }

  if (sourceEngine === 'OAKDOC') {
    const cloned = await cloneOakDocGeneratedDocument({ sourceId: source.id, title: newTitle }, params);
    return withRevision(cloned, 0);
  }

  const created = await prisma.generatedDocument.create({
    data: {
      tenantId,
      templateId: source.templateId,
      templateVersion: source.templateVersion,
      sharePointRelativeFolderPathSnapshot: source.sharePointRelativeFolderPathSnapshot,
      companyId: source.companyId,
      title: newTitle,
      content: source.content,
      contentJson: source.contentJson ?? undefined,
      status: 'DRAFT',
      useLetterhead: source.useLetterhead,
      placeholderData: source.placeholderData ?? undefined,
      metadata: source.metadata ?? undefined,
      createdById: userId,
    },
  });
  const document = withRevision(created, 0);

  await createAuditLog({
    tenantId,
    userId,
    companyId: document.companyId ?? undefined,
    action: 'DOCUMENT_CLONED',
    entityType: 'GeneratedDocument',
    entityId: document.id,
    entityName: document.title,
    summary: `Cloned document "${source.title}" as "${document.title}"`,
    changeSource: 'MANUAL',
    metadata: { sourceDocumentId: source.id, sourceTitle: source.title },
  });
  return document;
}

export interface GetDocumentOptions {
  includeDeleted?: boolean;
  includeComments?: boolean;
  includeBatchDrafts?: boolean;
}

export async function getGeneratedDocumentById(
  id: string,
  tenantId: string,
  options: GetDocumentOptions = {},
): Promise<GeneratedDocumentWithRelations | null> {
  const {
    includeDeleted = false,
    includeComments = false,
    includeBatchDrafts = false,
  } = options;
  const where: Prisma.GeneratedDocumentWhereInput = { id, tenantId };
  if (!includeDeleted) where.deletedAt = null;
  if (!includeBatchDrafts) {
    where.AND = [{ OR: [{ batchItem: null }, { batchItem: { status: 'GENERATED' } }] }];
  }

  const document = await prisma.generatedDocument.findFirst({
    where,
    include: {
      template: { select: { id: true, name: true, category: true } },
      company: { select: { id: true, name: true, uen: true } },
      createdBy: { select: { id: true, firstName: true, lastName: true } },
      finalizedBy: { select: { id: true, firstName: true, lastName: true } },
      esigningEnvelopeDocuments: {
        where: { envelope: { deletedAt: null } },
        orderBy: { createdAt: 'desc' },
        select: {
          envelope: {
            select: { id: true, title: true, status: true, completedAt: true },
          },
        },
      },
      ...(includeComments
        ? {
            comments: {
              where: { parentId: null, deletedAt: null, hiddenAt: null },
              orderBy: { createdAt: 'desc' as const },
              include: {
                user: { select: { id: true, firstName: true, lastName: true } },
                replies: {
                  where: { deletedAt: null, hiddenAt: null },
                  orderBy: { createdAt: 'asc' as const },
                  include: { user: { select: { id: true, firstName: true, lastName: true } } },
                },
              },
            },
          }
        : {}),
      _count: { select: { comments: true, drafts: true } },
    },
  });
  if (!document) return null;
  const revision = await readGeneratedDocumentRevision(prisma, document.id, tenantId);
  return { ...document, revision } as GeneratedDocumentWithRelations;
}

export async function searchGeneratedDocuments(
  params: SearchGeneratedDocumentsInput,
  tenantId: string,
): Promise<{
  documents: GeneratedDocumentWithRelations[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> {
  if (!tenantId) throw new Error('Tenant ID is required for generated documents search');

  const where: Prisma.GeneratedDocumentWhereInput = { deletedAt: null, tenantId };
  where.AND = [{ OR: [{ batchItem: null }, { batchItem: { status: 'GENERATED' } }] }];
  if (params.query) {
    const searchTerm = params.query.trim();
    where.OR = [
      { title: { contains: searchTerm, mode: 'insensitive' } },
      { company: { name: { contains: searchTerm, mode: 'insensitive' } } },
      { template: { name: { contains: searchTerm, mode: 'insensitive' } } },
    ];
  }
  if (params.title) where.title = { contains: params.title.trim(), mode: 'insensitive' };
  if (params.companyId) where.companyId = params.companyId;
  if (params.companyName) where.company = { name: { contains: params.companyName, mode: 'insensitive' } };
  if (params.templateId) where.templateId = params.templateId;
  if (params.templateName) {
    where.template = { name: { contains: params.templateName.trim(), mode: 'insensitive' } };
  }
  if (params.status) where.status = params.status;
  if (params.createdBy) {
    const searchTerm = params.createdBy.trim();
    where.createdBy = {
      OR: [
        { firstName: { contains: searchTerm, mode: 'insensitive' } },
        { lastName: { contains: searchTerm, mode: 'insensitive' } },
      ],
    };
  }
  if (params.signedFrom || params.signedTo) {
    where.signedAt = {
      ...(params.signedFrom ? { gte: new Date(`${params.signedFrom}T00:00:00.000`) } : {}),
      ...(params.signedTo ? { lte: new Date(`${params.signedTo}T23:59:59.999`) } : {}),
    };
  }
  if (params.updatedFrom || params.updatedTo) {
    where.updatedAt = {
      ...(params.updatedFrom ? { gte: new Date(`${params.updatedFrom}T00:00:00.000`) } : {}),
      ...(params.updatedTo ? { lte: new Date(`${params.updatedTo}T23:59:59.999`) } : {}),
    };
  }

  const orderBy: Prisma.GeneratedDocumentOrderByWithRelationInput = {};
  switch (params.sortBy) {
    case 'companyName':
      orderBy.company = { name: params.sortOrder };
      break;
    case 'createdByName':
      orderBy.createdBy = { firstName: params.sortOrder };
      break;
    case 'templateName':
      orderBy.template = { name: params.sortOrder };
      break;
    default:
      orderBy[params.sortBy] = params.sortOrder;
      break;
  }

  const skip = (params.page - 1) * params.limit;
  const [documents, total] = await Promise.all([
    prisma.generatedDocument.findMany({
      where,
      include: {
        template: { select: { id: true, name: true, category: true } },
        company: { select: { id: true, name: true, uen: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        _count: { select: { comments: true, drafts: true } },
      },
      orderBy,
      skip,
      take: params.limit,
    }),
    prisma.generatedDocument.count({ where }),
  ]);
  const revisions = await readGeneratedDocumentRevisions(
    prisma,
    documents.map((document) => document.id),
    tenantId,
  );
  const documentsWithRevisions = documents.map((document) => ({
    ...document,
    revision: revisions.get(document.id) ?? 0,
  })) as GeneratedDocumentWithRelations[];

  return {
    documents: documentsWithRevisions,
    total,
    page: params.page,
    limit: params.limit,
    totalPages: Math.ceil(total / params.limit),
  };
}

export async function createDocumentComment(
  data: CreateDocumentCommentInput,
  ipAddress: string | null,
  params?: TenantAwareParams,
): Promise<DocumentComment> {
  const document = await prisma.generatedDocument.findFirst({
    where: { id: data.documentId, deletedAt: null },
    select: { tenantId: true, companyId: true, title: true },
  });
  if (!document) throw new NotFoundError('Document not found');

  if (data.parentId) {
    const parent = await prisma.documentComment.findFirst({
      where: { id: data.parentId, documentId: data.documentId, deletedAt: null },
    });
    if (!parent) throw new NotFoundError('Parent comment not found');
  }

  const comment = await prisma.documentComment.create({
    data: {
      documentId: data.documentId,
      userId: params?.userId,
      guestName: data.guestName,
      guestEmail: data.guestEmail,
      content: data.content,
      selectionStart: data.selectionStart,
      selectionEnd: data.selectionEnd,
      selectedText: data.selectedText,
      parentId: data.parentId,
      ipAddress,
    },
    include: { user: { select: { id: true, firstName: true, lastName: true } } },
  });

  if (params) {
    await createAuditLog({
      tenantId: document.tenantId,
      userId: params.userId,
      companyId: document.companyId ?? undefined,
      action: 'COMMENT_CREATED',
      entityType: 'DocumentComment',
      entityId: comment.id,
      entityName: document.title,
      summary: `Added comment on document "${document.title}"`,
      changeSource: 'MANUAL',
      metadata: {
        documentId: data.documentId,
        isReply: !!data.parentId,
        hasSelection: !!data.selectedText,
      },
    });
  }
  return comment;
}

export async function resolveComment(
  commentId: string,
  params: TenantAwareParams,
): Promise<DocumentComment> {
  const { tenantId, userId } = params;
  const comment = await prisma.documentComment.findFirst({
    where: { id: commentId },
    include: { document: { select: { tenantId: true, title: true, companyId: true } } },
  });
  if (!comment || comment.document.tenantId !== tenantId) throw new NotFoundError('Comment not found');
  if (comment.status === 'RESOLVED') throw new Error('Comment is already resolved');

  const updated = await prisma.documentComment.update({
    where: { id: commentId },
    data: { status: 'RESOLVED', resolvedById: userId, resolvedAt: new Date() },
  });
  await createAuditLog({
    tenantId,
    userId,
    companyId: comment.document.companyId ?? undefined,
    action: 'COMMENT_RESOLVED',
    entityType: 'DocumentComment',
    entityId: comment.id,
    entityName: comment.document.title,
    summary: `Resolved comment on document "${comment.document.title}"`,
    changeSource: 'MANUAL',
  });
  return updated;
}

export async function hideComment(
  commentId: string,
  reason: string,
  params: TenantAwareParams,
): Promise<DocumentComment> {
  const { tenantId, userId } = params;
  const comment = await prisma.documentComment.findFirst({
    where: { id: commentId },
    include: { document: { select: { tenantId: true, title: true, companyId: true } } },
  });
  if (!comment || comment.document.tenantId !== tenantId) throw new NotFoundError('Comment not found');

  const updated = await prisma.documentComment.update({
    where: { id: commentId },
    data: { hiddenAt: new Date(), hiddenById: userId, hiddenReason: reason },
  });
  await createAuditLog({
    tenantId,
    userId,
    companyId: comment.document.companyId ?? undefined,
    action: 'COMMENT_HIDDEN',
    entityType: 'DocumentComment',
    entityId: comment.id,
    entityName: comment.document.title,
    summary: `Hidden comment on document "${comment.document.title}"`,
    changeSource: 'MANUAL',
    reason,
  });
  return updated;
}

export async function unhideComment(
  commentId: string,
  params: TenantAwareParams,
): Promise<DocumentComment> {
  const { tenantId } = params;
  const comment = await prisma.documentComment.findFirst({
    where: { id: commentId },
    include: { document: { select: { tenantId: true, title: true, companyId: true } } },
  });
  if (!comment || comment.document.tenantId !== tenantId) throw new NotFoundError('Comment not found');
  return prisma.documentComment.update({
    where: { id: commentId },
    data: { hiddenAt: null, hiddenById: null, hiddenReason: null },
  });
}

export async function getLatestDraft(
  documentId: string,
  userId: string,
): Promise<{
  content: string;
  contentJson: unknown | null;
  createdAt: Date;
  baseRevision: number | null;
} | null> {
  const draft = await prisma.documentDraft.findFirst({
    where: { documentId, userId },
    orderBy: { createdAt: 'desc' },
    select: { content: true, contentJson: true, metadata: true, createdAt: true },
  });
  if (!draft) return null;
  const metadata = draft.metadata && typeof draft.metadata === 'object' && !Array.isArray(draft.metadata)
    ? draft.metadata as Record<string, unknown>
    : null;
  const baseRevision = typeof metadata?.baseCanonicalRevision === 'number'
    ? metadata.baseCanonicalRevision
    : null;
  return {
    content: draft.content,
    contentJson: draft.contentJson,
    createdAt: draft.createdAt,
    baseRevision,
  };
}

export async function getDocumentStats(tenantId: string): Promise<{
  total: number;
  byStatus: Record<GeneratedDocumentStatus, number>;
  recentlyCreated: number;
  recentlyFinalized: number;
  totalComments: number;
}> {
  const [total, byStatus, recentlyCreated, recentlyFinalized, totalComments] = await Promise.all([
    prisma.generatedDocument.count({ where: { tenantId, deletedAt: null } }),
    prisma.generatedDocument.groupBy({
      by: ['status'],
      where: { tenantId, deletedAt: null },
      _count: true,
    }),
    prisma.generatedDocument.count({
      where: {
        tenantId,
        deletedAt: null,
        createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
    }),
    prisma.generatedDocument.count({
      where: {
        tenantId,
        deletedAt: null,
        finalizedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
    }),
    prisma.documentComment.count({
      where: { document: { tenantId, deletedAt: null }, deletedAt: null },
    }),
  ]);

  const statusCounts: Record<GeneratedDocumentStatus, number> = {
    DRAFT: 0,
    FINALIZED: 0,
    ARCHIVED: 0,
  };
  for (const s of byStatus) statusCounts[s.status] = s._count;
  return { total, byStatus: statusCounts, recentlyCreated, recentlyFinalized, totalComments };
}
