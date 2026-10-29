/** Bizfile processing orchestration. Company persistence lives in company-sync.ts. */
import { prisma } from '@/lib/prisma';
import { createAuditLog } from '@/lib/audit';
import { createCompanyContactRelation, type PrismaTransactionClient } from '../contact.service';
import { previewContactIdentity, resolveOrCreateContact } from '../contact-identity.service';
import type { ContactIdentityCandidate, ContactResolutionDecision } from '@/types/contact-identity';
import type {
  ExtractedBizFileData,
  OfficerAction,
  SelectiveProcessingResult,
  ProcessingResult,
} from './types';
import { mapIdentificationType } from './types';
import { normalizeExtractedData } from './normalizer';
import { syncCompanyFromBizfileInTransaction } from './company-sync';
import { applyBizFileChangePlanInTransaction } from './canonical-sync';
import type { BizFileChange, BizFileChangePlan } from './change-plan';
import { hashBizFileValue } from './change-plan';
import {
  createBizFileOperationRepository,
  type BizFileOperationEffectInput,
  type BizFileOperationRepository,
} from './application/operation-repository';
import { acquireBizFileOperationLock, type BizFileOperationClaimFence } from './application/operation-reconciliation';
import { prepareDocumentPages } from '../document-processing.service';
import {
  generateApprovedDocumentFilename,
  buildApprovedStorageKey,
  getFileExtension,
} from '@/lib/storage/filename';
import { storage } from '@/lib/storage';
import { createLogger } from '@/lib/logger';
import type { TaskLaunchContext } from '@/services/tasks/types';
import { acquireBusinessOperationBarrier } from '@/lib/business-operation-backup-barrier';
import { evaluateFreshAuthorization } from '@/lib/fresh-authorization';
import { assertFreshBizFileSourceRevision } from './application/source-revision';

const log = createLogger('bizfile-processor');

// Vendor name used for BizFile documents in the document vault and generated filenames
const ACRA_VENDOR_NAME = 'ACRA';

export interface CanonicalBizFileOperationContext {
  /** Stable caller supplied idempotency key for one approved mutation. */
  operationId: string;
  capabilityId?: string;
  capabilityVersion?: string;
  schemaVersion?: string;
  /** Injected in tests or by an adapter; production uses the Prisma delegates. */
  operationRepository?: BizFileOperationRepository;
  /** Immutable source evidence reference captured during preparation. */
  sourceEvidence?: unknown;
  /** Required downstream work declared by the canonical capability. */
  effectIntents?: Omit<BizFileOperationEffectInput, 'receiptId'>[];
  /** Current durable assistant claim, when invoked by the worker. */
  claim?: BizFileOperationClaimFence;
}

async function lockCanonicalOperation(
  tx: PrismaTransactionClient,
  tenantId: string,
  userId: string,
  documentId: string,
  companyId: string | undefined,
  mode: 'CREATE' | 'UPDATE',
  operationId: string,
  operationContextClaim?: BizFileOperationClaimFence,
): Promise<void> {
  const raw = tx as unknown as {
    $executeRaw?: (...args: unknown[]) => Promise<unknown>;
    $queryRawUnsafe?: (...args: unknown[]) => Promise<unknown>;
  };
  const canCoordinate = typeof raw.$executeRaw === 'function' && typeof raw.$queryRawUnsafe === 'function';
  if (canCoordinate) {
    await acquireBusinessOperationBarrier(
      raw as Pick<PrismaTransactionClient, '$executeRaw'>,
      tenantId,
      'shared',
    );
    const documentDecision = await evaluateFreshAuthorization({
      userId,
      workspaceId: tenantId,
      permission: { resource: 'document', action: 'read' },
      resource: { kind: 'document', id: documentId },
    }, tx);
    if (!documentDecision.allowed) throw new Error(`Fresh authorization denied BizFile source access: ${documentDecision.reason ?? 'permission_denied'}`);
    const companyDecision = await evaluateFreshAuthorization({
      userId,
      workspaceId: tenantId,
      permission: { resource: 'company', action: mode === 'CREATE' ? 'create' : 'update' },
      ...(companyId ? { resource: { kind: 'company' as const, id: companyId } } : {}),
    }, tx);
    if (!companyDecision.allowed) throw new Error(`Fresh authorization denied BizFile company mutation: ${companyDecision.reason ?? 'permission_denied'}`);
  }
  if (typeof raw.$queryRawUnsafe === 'function') await acquireBizFileOperationLock(tx, tenantId, operationId);
  if (operationContextClaim) {
    const currentClaim = await tx.businessAssistantRunItem.findFirst({
      where: {
        id: operationContextClaim.runItemId,
        tenantId,
        operationId,
        claimToken: operationContextClaim.claimToken,
        claimGeneration: operationContextClaim.claimGeneration,
        leaseExpiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
    if (!currentClaim) throw new Error('BIZFILE_OPERATION_CLAIM_FENCED');
  }
}

type Officer = NonNullable<ExtractedBizFileData['officers']>[number];
type Shareholder = NonNullable<ExtractedBizFileData['shareholders']>[number];

function splitIndividualName(name: string): { firstName: string; lastName?: string } {
  const [firstName = '', ...rest] = name.trim().split(/\s+/);
  const lastName = rest.join(' ');
  return { firstName, ...(lastName ? { lastName } : {}) };
}

function officerIdentityCandidate(officer: Officer, sourceRecordId: string): ContactIdentityCandidate {
  return {
    source: 'BIZFILE',
    sourceRecordId,
    contactType: 'INDIVIDUAL',
    ...splitIndividualName(officer.name),
    identificationType: mapIdentificationType(officer.identificationType) || undefined,
    identificationNumber: officer.identificationNumber,
    nationality: officer.nationality,
    fullAddress: officer.address,
  };
}

function shareholderIdentityCandidate(
  shareholder: Shareholder,
  sourceRecordId: string,
): ContactIdentityCandidate {
  if (shareholder.type === 'CORPORATE') {
    return {
      source: 'BIZFILE',
      sourceRecordId,
      contactType: 'CORPORATE',
      corporateName: shareholder.name,
      corporateUen: shareholder.identificationNumber,
      fullAddress: shareholder.address,
    };
  }
  return {
    source: 'BIZFILE',
    sourceRecordId,
    contactType: 'INDIVIDUAL',
    ...splitIndividualName(shareholder.name),
    identificationType: mapIdentificationType(shareholder.identificationType) || undefined,
    identificationNumber: shareholder.identificationNumber,
    nationality: shareholder.nationality,
    fullAddress: shareholder.address,
  };
}

function reviewedDecision(
  decision: Officer['contactResolution'] | Shareholder['contactResolution'],
): ContactResolutionDecision {
  return decision ?? { action: 'AUTO' };
}

async function resolveBizfileContact(
  record: Officer | Shareholder,
  kind: 'officer' | 'shareholder',
  sourceIndex: number,
  context: { tenantId: string; userId: string; tx: PrismaTransactionClient },
  autoCreatedContactIds: Set<string>,
): Promise<string> {
  const sourceRecordId = `${kind === 'officer' ? 'officers' : 'shareholders'}.${sourceIndex}`;
  const candidate = kind === 'officer'
    ? officerIdentityCandidate(record as Officer, sourceRecordId)
    : shareholderIdentityCandidate(record as Shareholder, sourceRecordId);
  const decision = record.contactResolution;

  if (!decision) {
    const match = await previewContactIdentity(candidate, context.tenantId, context.tx);
    if (match && !autoCreatedContactIds.has(match.contactId)) {
      throw new Error(`Review the contact match for ${sourceRecordId} before continuing`);
    }
  }

  const result = await resolveOrCreateContact(candidate, reviewedDecision(decision), context);
  if (!decision && (result.outcome === 'CREATED' || result.outcome === 'RESTORED')) {
    autoCreatedContactIds.add(result.contact.id);
  }
  return result.contact.id;
}

function durableTaskContext(taskContext?: TaskLaunchContext) {
  if (!taskContext) return undefined;
  return {
    taskId: taskContext.taskId,
    taskStageId: taskContext.taskStageId,
    ...(taskContext.returnTo ? { returnTo: taskContext.returnTo } : {}),
  };
}

async function persistTaskRecovery(
  tx: PrismaTransactionClient,
  companyId: string,
  tenantId: string,
  taskContext?: TaskLaunchContext,
) {
  if (!taskContext) return;
  await tx.company.update({
    where: { id: companyId },
    data: { taskIntegrationContext: durableTaskContext(taskContext) },
  });
  await tx.taskCompanyRecoveryContext.upsert({
    where: { tenantId_taskStageId: { tenantId, taskStageId: taskContext.taskStageId } },
    create: {
      tenantId,
      companyId,
      taskId: taskContext.taskId,
      taskStageId: taskContext.taskStageId,
      returnTo: taskContext.returnTo,
    },
    update: {
      companyId,
      taskId: taskContext.taskId,
      returnTo: taskContext.returnTo,
    },
  });
}

/** Readable BizFile name, e.g. BizFile_2025-03-22_ACRA_<receipt no>.pdf. */
export function bizFileApprovedFileName(data: ExtractedBizFileData, currentName: string): string {
  return generateApprovedDocumentFilename({
    documentSubCategory: 'BIZFILE',
    documentDate: data.documentMetadata?.receiptDate
      ? new Date(data.documentMetadata.receiptDate)
      : null,
    contactName: ACRA_VENDOR_NAME,
    documentNumber: data.documentMetadata?.receiptNo || null,
    currency: 'SGD',
    totalAmount: 0,
    originalExtension: getFileExtension(currentName),
  });
}

async function persistDocumentApproval(
  tx: PrismaTransactionClient,
  args: {
    documentId: string;
    companyId: string;
    tenantId: string;
    userId: string;
    data: ExtractedBizFileData;
  },
): Promise<string> {
  // Give the approved BizFile its readable name here, inside the approval
  // transaction, so every path (including canonical operations, whose storage
  // key is owned by STORAGE_FINALIZE) shows it in Document Processing.
  const current = await tx.document.findUnique({
    where: { id: args.documentId },
    select: { fileName: true, originalFileName: true, storageKey: true },
  });
  await tx.document.update({
    where: { id: args.documentId },
    data: {
      fileName: bizFileApprovedFileName(
        args.data,
        current?.originalFileName || current?.fileName || current?.storageKey || '',
      ),
      companyId: args.companyId,
      extractionStatus: 'COMPLETED',
      extractedAt: new Date(),
      extractedData: args.data as object,
    },
  });

  let processing = await tx.processingDocument.findUnique({
    where: { documentId: args.documentId },
    select: { id: true },
  });
  if (!processing) {
    processing = await tx.processingDocument.create({
      data: {
        documentId: args.documentId,
        tenantId: args.tenantId,
        isContainer: true,
        pipelineStatus: 'EXTRACTION_DONE',
        processingPriority: 'NORMAL',
        uploadSource: 'WEB',
      },
      select: { id: true },
    });
    const revision = await tx.documentRevision.create({
      data: {
        processingDocumentId: processing.id,
        revisionNumber: 1,
        revisionType: 'EXTRACTION',
        status: 'APPROVED',
        reason: 'BizFile extraction auto-approved',
        documentCategory: 'CORPORATE_SECRETARIAL',
        documentSubCategory: 'BIZFILE',
        vendorName: ACRA_VENDOR_NAME,
        documentNumber: args.data.documentMetadata?.receiptNo || null,
        documentDate: args.data.documentMetadata?.receiptDate
          ? new Date(args.data.documentMetadata.receiptDate)
          : null,
        currency: 'SGD',
        totalAmount: 0,
        createdById: args.userId,
        approvedById: args.userId,
        approvedAt: new Date(),
      },
      select: { id: true },
    });
    await tx.processingDocument.update({
      where: { id: processing.id },
      data: { currentRevisionId: revision.id },
    });
  }
  return processing.id;
}

async function applyReviewedData(
  documentId: string,
  extractedData: ExtractedBizFileData,
  userId: string,
  tenantId: string,
  existingCompanyId?: string,
  officerActions?: OfficerAction[],
  taskIntegrationContext?: TaskLaunchContext,
  changePlan?: BizFileChangePlan,
  operationContext?: CanonicalBizFileOperationContext,
) {
  const normalizedData = normalizeExtractedData(extractedData);
  return prisma.$transaction(async (rawTx) => {
    const tx = rawTx as PrismaTransactionClient;
    // The compatibility sync writes the company before it resolves officer
    // and shareholder contacts. Establish the shared business boundary first
    // so that those nested identity calls cannot acquire authorization locks
    // while a concurrent exclusive backup/restore holds the business lock.
    if (!changePlan) await acquireBusinessOperationBarrier(tx, tenantId, 'shared');
    const autoCreatedContactIds = new Set<string>();
    const operationRepository = operationContext?.operationRepository
      ?? (operationContext ? createBizFileOperationRepository() : null);
    let operationReceipt: Awaited<ReturnType<BizFileOperationRepository['begin']>> | null = null;
    if (operationContext && changePlan && operationRepository) {
      await lockCanonicalOperation(tx, tenantId, userId, documentId, changePlan.targetCompanyId, changePlan.mode, operationContext.operationId, operationContext.claim);
      operationReceipt = await operationRepository.begin(tx, {
        tenantId,
        operationId: operationContext.operationId,
        capabilityId: operationContext.capabilityId ?? 'bizfile.import_and_review',
        capabilityVersion: operationContext.capabilityVersion ?? '1',
        schemaVersion: operationContext.schemaVersion ?? '1',
        documentId,
        companyId: changePlan.targetCompanyId,
        mode: changePlan.mode,
        payloadHash: changePlan.canonicalHash,
        expectedAggregateRevision: changePlan.expectedAggregateRevision,
      });
      if (!operationReceipt.fresh && ['COMMITTED', 'NO_COMMIT'].includes(operationReceipt.status)) {
        if (!operationReceipt.companyId) throw new Error('Committed BizFile receipt is missing its company ID');
        const replayProcessing = await tx.processingDocument.findUnique({
          where: { documentId },
          select: { id: true },
        });
        return {
          companyId: operationReceipt.companyId,
          created: operationReceipt.mode === 'CREATE',
          beforeRevision: operationReceipt.beforeRevision ?? operationReceipt.expectedAggregateRevision,
          afterRevision: operationReceipt.afterRevision ?? operationReceipt.expectedAggregateRevision,
          changedSections: [],
          selectedChanges: [],
          operationStatus: operationReceipt.status === 'NO_COMMIT' ? 'NO_CHANGE' as const : 'COMMITTED' as const,
          processingDocumentId: replayProcessing?.id ?? '',
          normalizedData,
          operationReceiptId: operationReceipt.id,
          operationReplayed: true,
        };
      }
      if (!operationReceipt.fresh && operationReceipt.status === 'UNKNOWN') {
        throw new Error('BIZFILE_OPERATION_IN_FLIGHT: an earlier worker owns this operation');
      }
    }
    // A committed receipt is replayable even after the source has advanced;
    // it returns above before this guard. Every fresh canonical mutation must
    // then lock and compare the authoritative source revision before any
    // company or document write begins. Revision zero is meaningful and must
    // not fall back to the mutable Document.version field.
    if (changePlan) {
      await assertFreshBizFileSourceRevision(tx, {
        tenantId,
        documentId,
        // A prepared plan always carries a revision. The zero default keeps
        // older in-memory callers fail-closed without consulting Document.version.
        expectedSourceRevision: changePlan.sourceVersion ?? 0,
      });
    }
    const resolveContact = async (record: Officer | Shareholder, kind: 'officer' | 'shareholder', index: number, companyId: string) => {
      const contactId = await resolveBizfileContact(
        record,
        kind,
        index,
        { tenantId, userId, tx },
        autoCreatedContactIds,
      );
      await createCompanyContactRelation(
        contactId,
        companyId,
        kind === 'officer' ? (record as Officer).role : 'Shareholder',
        false,
        tx,
      );
      return contactId;
    };
    const synced = changePlan
      ? await applyBizFileChangePlanInTransaction({
        data: normalizedData,
        documentId,
        tenantId,
        userId,
        existingCompanyId,
        plan: changePlan,
      }, tx, { resolveContact })
      : await syncCompanyFromBizfileInTransaction({
        data: normalizedData,
        documentId,
        tenantId,
        userId,
        existingCompanyId,
        officerActions,
      }, tx, {
        resolveContact,
      });
    // Approval updates extraction status/data in the same transaction. The
    // source-revision trigger therefore advances the authoritative revision
    // before required effects are recorded. Capture that committed revision
    // and bind every effect to it instead of retaining the pre-approval plan
    // revision.
    const processingDocumentId = await persistDocumentApproval(tx, {
      documentId,
      companyId: synced.companyId,
      tenantId,
      userId,
      data: normalizedData,
    });
    if (operationContext && changePlan && operationRepository && operationReceipt) {
      const canonicalSynced = synced as Awaited<ReturnType<typeof applyBizFileChangePlanInTransaction>>;
      const committedDocument = await tx.document.findUnique({
        where: { id: documentId },
        select: { storageKey: true, mimeType: true, sourceRevision: true },
      });
      if (!committedDocument) throw new Error('Committed BizFile source document could not be read back');
      const suppliedSourceEvidence = operationContext.sourceEvidence && typeof operationContext.sourceEvidence === 'object'
        && !Array.isArray(operationContext.sourceEvidence)
        ? operationContext.sourceEvidence as Record<string, unknown>
        : {};
      const sourceHash = typeof suppliedSourceEvidence.sourceHash === 'string'
        ? suppliedSourceEvidence.sourceHash
        : changePlan.sourceHash ?? null;
      const sourceEvidence = {
        ...suppliedSourceEvidence,
        documentId,
        storageKey: committedDocument.storageKey,
        mimeType: committedDocument.mimeType,
        sourceRevision: committedDocument.sourceRevision,
        sourceHash,
      };
      const selectedChanges = canonicalSynced.selectedChanges ?? [];
      const beforeRevision = canonicalSynced.beforeRevision;
      const persistedAfter = await tx.company.findFirst({
        where: { id: canonicalSynced.companyId, tenantId },
        include: {
          addresses: true, formerNames: true, shareCapital: true,
          officers: true, shareholders: true, auditor: true, charges: true,
        },
      });
      if (!persistedAfter) throw new Error('Canonical BizFile after evidence could not be captured');
      const afterRevision = persistedAfter.aggregateRevision;
      const afterEvidence = {
        company: persistedAfter, selectedChanges, changedSections: canonicalSynced.changedSections,
        beforeRevision, afterRevision,
      };
      await operationRepository.evidence(tx, {
        receiptId: operationReceipt.id,
        tenantId,
        kind: 'SOURCE',
        artifact: sourceEvidence,
        artifactHash: hashBizFileValue(sourceEvidence),
        sourceRef: {
          documentId,
          sourceVersion: changePlan.sourceVersion ?? 0,
          sourceRevision: committedDocument.sourceRevision,
        },
      });
      await operationRepository.evidence(tx, {
        receiptId: operationReceipt.id,
        tenantId,
        kind: 'BEFORE',
        artifact: changePlan.baseline,
        artifactHash: hashBizFileValue(changePlan.baseline),
      });
      await operationRepository.evidence(tx, {
        receiptId: operationReceipt.id,
        tenantId,
        kind: 'AFTER',
        artifact: JSON.parse(JSON.stringify(afterEvidence)),
        artifactHash: hashBizFileValue(afterEvidence),
      });
      for (const effect of operationContext.effectIntents ?? []) {
        const payloadRecord = effect.payload && typeof effect.payload === 'object' && !Array.isArray(effect.payload)
          ? effect.payload as Record<string, unknown>
          : null;
        const boundPayload = effect.effectKind === 'STORAGE_FINALIZE' && payloadRecord
          ? { ...payloadRecord, documentId, storageKey: committedDocument.storageKey, sourceHash, sourceRevision: committedDocument.sourceRevision }
          : effect.effectKind === 'PAGE_PREPARATION' && payloadRecord
            ? {
              ...payloadRecord,
              documentId,
              storageKey: committedDocument.storageKey,
              mimeType: committedDocument.mimeType,
              sourceHash,
              sourceRevision: committedDocument.sourceRevision,
              finalizedSourceRevision: committedDocument.sourceRevision + 1,
            }
            : effect.payload;
        await operationRepository.effect(tx, {
          ...effect,
          receiptId: operationReceipt.id,
          payload: boundPayload,
          payloadHash: boundPayload === undefined ? effect.payloadHash : hashBizFileValue(boundPayload),
        });
      }
      await operationRepository.commit(tx, {
        receiptId: operationReceipt.id,
        tenantId,
        companyId: canonicalSynced.companyId,
        beforeRevision,
        afterRevision,
        // Even an unchanged company records document approval and evidence in
        // this transaction. NO_COMMIT is reserved for proven rollback/absence.
        status: 'COMMITTED',
        effectStatus: (operationContext.effectIntents?.length ?? 0) > 0 ? 'PENDING' : 'NOT_REQUIRED',
      });
      await createAuditLog({
        tenantId, userId, companyId: canonicalSynced.companyId,
        action: canonicalSynced.created ? 'CREATE' : 'UPDATE',
        entityType: 'Company', entityId: canonicalSynced.companyId,
        entityName: normalizedData.entityDetails.name,
        summary: `${canonicalSynced.created ? 'Created' : 'Updated'} company from an approved BizFile change plan`,
        changeSource: 'BIZFILE_UPLOAD',
        metadata: {
          documentId, operationId: operationContext.operationId,
          receiptId: operationReceipt.id, capabilityId: operationContext.capabilityId ?? 'bizfile.import_and_review',
          selectedChangeIds: changePlan.selectedChangeIds, beforeRevision, afterRevision,
        },
      }, tx);
    }
    await persistTaskRecovery(tx, synced.companyId, tenantId, taskIntegrationContext);
    return { ...synced, processingDocumentId, normalizedData, operationReceiptId: operationReceipt?.id };
  });
}

export async function processBizFileExtractionSelective(
  documentId: string,
  extractedData: ExtractedBizFileData,
  userId: string,
  tenantId: string,
  existingCompanyId: string,
  officerActions?: OfficerAction[],
  taskIntegrationContext?: TaskLaunchContext,
  changePlan?: BizFileChangePlan,
  operationContext?: CanonicalBizFileOperationContext,
): Promise<SelectiveProcessingResult> {
  const result = await applyReviewedData(
    documentId,
    extractedData,
    userId,
    tenantId,
    existingCompanyId,
    officerActions,
    taskIntegrationContext,
    changePlan,
    operationContext,
  );
  const selectedChanges: BizFileChange[] = changePlan && 'selectedChanges' in result
    ? result.selectedChanges as BizFileChange[]
    : [];
  return {
    companyId: result.companyId,
    created: false,
    updatedFields: result.changedSections,
    officerChanges: {
      added: changePlan
        ? selectedChanges.filter((change) => change.path === 'officers' && change.operation === 'ADD').length
        : extractedData.officers?.length ?? 0,
      updated: changePlan
        ? selectedChanges.filter((change) => change.path === 'officers' && change.operation === 'UPDATE').length
        : 0,
      ceased: changePlan
        ? selectedChanges.filter((change) => change.path === 'officers' && change.operation === 'CEASE').length
        : officerActions?.filter((action) => action.action === 'cease').length ?? 0,
      followUp: changePlan
        ? 0
        : officerActions?.filter((action) => action.action === 'follow_up').length ?? 0,
    },
    shareholderChanges: {
      added: changePlan
        ? selectedChanges.filter((change) => change.path === 'shareholders' && change.operation === 'ADD').length
        : extractedData.shareholders?.length ?? 0,
      updated: changePlan
        ? selectedChanges.filter((change) => change.path === 'shareholders' && change.operation === 'UPDATE').length
        : 0,
      removed: changePlan
        ? selectedChanges.filter((change) => change.path === 'shareholders' && change.operation === 'REMOVE').length
        : 0,
    },
  };
}

async function moveAndRenameDocument(
  documentId: string,
  companyId: string,
  tenantId: string,
  data: ExtractedBizFileData,
  storageKey?: string,
): Promise<string | undefined> {
  let activeStorageKey = storageKey;
  if (activeStorageKey?.includes('/pending/')) {
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      select: { fileName: true },
    });
    if (document) {
      const extension = document.fileName.match(/\.[^.]+$/)?.[0] || '';
      const nextKey = `${tenantId}/companies/${companyId}/documents/${documentId}/original${extension}`;
      try {
        await storage.move(activeStorageKey, nextKey);
        await prisma.document.update({ where: { id: documentId }, data: { storageKey: nextKey } });
        activeStorageKey = nextKey;
      } catch (error) {
        log.error(`Failed to move BizFile from ${activeStorageKey} to ${nextKey}:`, error);
      }
    }
  }

  if (!activeStorageKey) return activeStorageKey;
  try {
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      select: { fileName: true, storageKey: true },
    });
    if (!document?.storageKey) return activeStorageKey;
    const fileName = bizFileApprovedFileName(data, document.fileName || document.storageKey);
    const nextKey = buildApprovedStorageKey(document.storageKey, fileName);
    if (nextKey === document.storageKey) return activeStorageKey;
    if (await storage.exists(document.storageKey)) {
      await storage.move(document.storageKey, nextKey);
      await prisma.document.update({
        where: { id: documentId },
        data: { fileName, storageKey: nextKey },
      });
      return nextKey;
    }
    await prisma.document.update({ where: { id: documentId }, data: { fileName } });
  } catch (error) {
    log.error(`Failed to rename BizFile document: ${error}`);
  }
  return activeStorageKey;
}

export async function processBizFileExtraction(
  documentId: string,
  extractedData: ExtractedBizFileData,
  userId: string,
  tenantId: string,
  storageKey?: string,
  mimeType?: string,
  taskIntegrationContext?: TaskLaunchContext,
  changePlan?: BizFileChangePlan,
  operationContext?: CanonicalBizFileOperationContext,
): Promise<ProcessingResult> {
  const normalizedData = normalizeExtractedData(extractedData);
  const existing = changePlan?.mode === 'UPDATE'
    ? { id: changePlan.targetCompanyId }
    : undefined;
  const result = await applyReviewedData(
    documentId,
    normalizedData,
    userId,
    tenantId,
    existing?.id,
    undefined,
    taskIntegrationContext,
    changePlan,
    operationContext,
  );

  if (!operationContext) {
    const activeStorageKey = await moveAndRenameDocument(
      documentId,
      result.companyId,
      tenantId,
      normalizedData,
      storageKey,
    );
    if (activeStorageKey && mimeType) {
      await prepareDocumentPages(result.processingDocumentId, activeStorageKey, mimeType);
    }
  }

  if (!operationContext) await createAuditLog({
    tenantId,
    userId,
    companyId: result.companyId,
    action: result.created ? 'CREATE' : 'UPDATE',
    entityType: 'Company',
    entityId: result.companyId,
    entityName: normalizedData.entityDetails.name,
    summary: `${result.created ? 'Created' : 'Updated'} company "${normalizedData.entityDetails.name}" (UEN: ${normalizedData.entityDetails.uen}) from BizFile extraction`,
    changeSource: 'BIZFILE_UPLOAD',
    metadata: { documentId, extractedFields: Object.keys(normalizedData) },
  });

  return {
    companyId: result.companyId,
    created: result.created,
    ...(operationContext && 'operationReceiptId' in result ? { operationReceiptId: result.operationReceiptId } : {}),
  };
}
