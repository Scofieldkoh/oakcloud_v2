/**
 * Documents in e-signing envelopes: uploads, generated documents, order,
 * names and visibility.
 */

import { randomUUID } from 'crypto';
import { PDFDocument } from 'pdf-lib';
import type { Prisma } from '@/generated/prisma';
import type { SessionUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ConflictError } from '@/lib/errors';
import { hashBlake3 } from '@/lib/encryption';
import { createAuditLog } from '@/lib/audit';
import { storage, StorageKeys } from '@/lib/storage';
import {
  removeEsigningDocumentVisibility,
  setEsigningDocumentVisibility,
  type EsigningDocumentVisibility,
} from '@/lib/esigning-document-visibility';
import { detectOfficeDocumentType, getPdfFileNameForUpload } from '@/lib/office-conversion';
import { convertOfficeDocumentToPdfWithMicrosoftGraph } from '@/services/microsoft-graph-document-conversion.service';
import { ESIGNING_LIMITS } from '@/lib/validations/esigning';
import type { EsigningEnvelopeDetailDto } from '@/types/esigning';
import { exportToPDF } from '@/services/document-export.service';
import {
  canMoveEnvelopeToCompany,
  canMutateEnvelope,
  lockEnvelopeForAuthorizedChange,
  resolveEsigningActorScope,
  type EsigningActorScope,
} from '@/services/esigning-envelope.lib';
import { lockEsigningEnvelopeForUpdate } from '@/services/esigning-envelope-lock';
import { saveEnvelopeFieldDefinitions } from '@/services/esigning-field.service';
import type { SaveEsigningFieldDefinitionsInput } from '@/lib/validations/esigning';
import { getEsigningEnvelopeDetail } from './lifecycle';
import {
  log,
  assertGeneratedDocumentCompanyMatchesEnvelope,
  assertExportMatchesRevision,
} from './shared';

/**
 * Locks the envelope and re-checks that the actor may still edit it, inside the
 * transaction that writes. Returns the locked row for further revalidation.
 */
async function lockDraftForEdit(
  tx: Prisma.TransactionClient,
  input: {
    scope: EsigningActorScope;
    session: SessionUser;
    tenantId: string;
    envelopeId: string;
    notDraftMessage: string;
  },
) {
  const locked = await lockEnvelopeForAuthorizedChange(tx, {
    scope: input.scope,
    session: input.session,
    tenantId: input.tenantId,
    envelopeId: input.envelopeId,
    check: canMutateEnvelope,
  });
  if (locked.status !== 'DRAFT') {
    throw new Error(input.notDraftMessage);
  }
  return locked;
}

export async function uploadEsigningEnvelopeDocument(
  session: SessionUser,
  tenantId: string,
  envelopeId: string,
  file: File,
  options?: {
    originalFileName?: string;
    /**
     * Company to give an envelope that has none yet (a generated document's company).
     * Applied in the same transaction as the document, after the actor's right to put
     * the envelope in that company is checked against the locked row.
     */
    assignCompanyId?: string | null;
  },
): Promise<EsigningEnvelopeDetailDto> {
  const scope = await resolveEsigningActorScope(session, tenantId);
  const envelope = await prisma.esigningEnvelope.findFirst({
    where: { id: envelopeId, tenantId },
    include: {
      documents: {
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          pageCount: true,
          sortOrder: true,
        },
      },
    },
  });

  if (!envelope) {
    throw new Error('Envelope not found');
  }
  if (!canMutateEnvelope(scope, session, envelope)) {
    throw new Error('Forbidden');
  }
  if (envelope.status !== 'DRAFT') {
    throw new Error('Documents can only be uploaded while the envelope is a draft');
  }
  if (envelope.documents.length >= ESIGNING_LIMITS.MAX_DOCUMENTS) {
    throw new Error(`An envelope can contain at most ${ESIGNING_LIMITS.MAX_DOCUMENTS} documents`);
  }
  if (file.size > ESIGNING_LIMITS.MAX_FILE_SIZE_BYTES) {
    throw new Error('File exceeds the maximum allowed size');
  }

  const uploadedBuffer = Buffer.from(await file.arrayBuffer());
  const documentType = detectOfficeDocumentType(uploadedBuffer, file.name, file.type);
  if (!documentType) {
    throw new Error('Only PDF and Word documents (.pdf, .docx, .doc) are supported');
  }

  const pdfBuffer =
    documentType === 'pdf'
      ? uploadedBuffer
      : await convertOfficeDocumentToPdfWithMicrosoftGraph({
          tenantId,
          buffer: uploadedBuffer,
          fileName: file.name,
          mimeType: file.type,
        });
  const originalFileName = options?.originalFileName ?? file.name;
  const storedFileName = documentType === 'pdf' ? file.name : getPdfFileNameForUpload(file.name);

  let pdfDoc: PDFDocument;
  try {
    pdfDoc = await PDFDocument.load(pdfBuffer);
  } catch (error) {
    throw new Error(
      `Unable to parse the PDF${documentType === 'pdf' ? '' : ' generated from the Word document'}${
        error instanceof Error && error.message ? `: ${error.message}` : ''
      }`
    );
  }

  const pageCount = pdfDoc.getPageCount();
  if (pageCount > ESIGNING_LIMITS.MAX_PAGES_PER_DOCUMENT) {
    throw new Error(
      `A single document cannot exceed ${ESIGNING_LIMITS.MAX_PAGES_PER_DOCUMENT} pages`
    );
  }

  const totalPages = envelope.documents.reduce((sum, document) => sum + document.pageCount, 0) + pageCount;
  if (totalPages > ESIGNING_LIMITS.MAX_TOTAL_PAGES) {
    throw new Error(`An envelope cannot exceed ${ESIGNING_LIMITS.MAX_TOTAL_PAGES} pages in total`);
  }

  const documentId = randomUUID();
  const storagePath = StorageKeys.esigningOriginalDocument(tenantId, envelopeId, documentId, '.pdf');
  const sortOrder = envelope.documents.length;

  await storage.upload(storagePath, pdfBuffer, {
    contentType: 'application/pdf',
    metadata: {
      tenantId,
      envelopeId,
      documentId,
      originalFileName,
      originalContentType: file.type,
      sourceFormat: documentType,
    },
  });

  try {
    await prisma.$transaction(async (tx) => {
      const locked = await lockDraftForEdit(tx, {
        scope,
        session,
        tenantId,
        envelopeId,
        notDraftMessage: 'Documents can only be uploaded while the envelope is a draft',
      });
      const assignCompanyId = options?.assignCompanyId ?? null;
      if (assignCompanyId) {
        assertGeneratedDocumentCompanyMatchesEnvelope(locked.companyId, assignCompanyId);
        if (
          !locked.companyId &&
          !canMoveEnvelopeToCompany(scope, session, locked, assignCompanyId)
        ) {
          throw new Error('Forbidden');
        }
      }
      await tx.esigningEnvelopeDocument.create({
        data: {
          id: documentId,
          tenantId,
          envelopeId,
          fileName: storedFileName,
          originalFileName,
          storagePath,
          originalHash: hashBlake3(pdfBuffer),
          pageCount,
          sortOrder,
          fileSize: pdfBuffer.length,
        },
      });
      if (assignCompanyId && !locked.companyId) {
        await tx.esigningEnvelope.update({
          where: { id: envelopeId },
          data: { companyId: assignCompanyId },
        });
      }
    });
  } catch (error) {
    await storage.delete(storagePath).catch(() => undefined);
    throw error;
  }

  await createAuditLog({
    tenantId,
    userId: session.id,
    companyId: envelope.companyId ?? undefined,
    action: 'UPLOAD',
    entityType: 'EsigningEnvelope',
    entityId: envelopeId,
    entityName: envelope.title,
    summary: `Uploaded document "${file.name}" to e-signing envelope "${envelope.title}"`,
    metadata: {
      documentId,
      pageCount,
      fileSize: pdfBuffer.length,
      originalFileSize: file.size,
      originalFileName,
      sourceFormat: documentType,
      convertedToPdf: documentType !== 'pdf',
    },
  });

  return getEsigningEnvelopeDetail(session, tenantId, envelopeId);
}

async function assertStillFinalizedAtRevision(
  tx: Prisma.TransactionClient,
  tenantId: string,
  generatedDocumentId: string,
  revision: number,
) {
  const [locked] = await tx.$queryRaw<Array<{ status: string; revision: number; deleted_at: Date | null }>>`
    SELECT status::text AS status, revision, deleted_at
    FROM generated_documents
    WHERE id = ${generatedDocumentId} AND tenant_id = ${tenantId}
    FOR SHARE
  `;
  if (!locked || locked.deleted_at || locked.status !== 'FINALIZED' || locked.revision !== revision) {
    throw new ConflictError('The document changed while its PDF was being prepared. Try again.');
  }
}

export async function uploadGeneratedDocumentToEsigningEnvelope(
  session: SessionUser,
  tenantId: string,
  envelopeId: string,
  generatedDocumentId: string,
): Promise<EsigningEnvelopeDetailDto> {
  const document = await prisma.generatedDocument.findFirst({
    where: {
      id: generatedDocumentId,
      tenantId,
      status: 'FINALIZED',
      deletedAt: null,
    },
    select: { id: true, title: true, companyId: true },
  });
  if (!document) {
    throw new Error('Selected generated document must be finalized and eligible');
  }

  const scope = await resolveEsigningActorScope(session, tenantId);
  const envelope = await prisma.esigningEnvelope.findFirst({
    where: { id: envelopeId, tenantId, deletedAt: null },
    select: { companyId: true, createdById: true },
  });
  if (!envelope) {
    throw new Error('Envelope not found');
  }
  // Decide before rendering or writing anything. An envelope with no company takes the
  // document's company, so the actor needs the right to put it there.
  if (!canMutateEnvelope(scope, session, envelope)) {
    throw new Error('Forbidden');
  }
  assertGeneratedDocumentCompanyMatchesEnvelope(envelope.companyId, document.companyId);
  if (
    !envelope.companyId &&
    document.companyId &&
    !canMoveEnvelopeToCompany(scope, session, envelope, document.companyId)
  ) {
    throw new Error('Forbidden');
  }

  const pdf = await exportToPDF({
    documentId: document.id,
    tenantId,
    userId: session.id,
  });
  const file = new File(
    [new Uint8Array(pdf.buffer)],
    pdf.filename || `${document.title}.pdf`,
    { type: 'application/pdf' },
  );
  return uploadEsigningEnvelopeDocument(
    session,
    tenantId,
    envelopeId,
    file,
    { originalFileName: document.title, assignCompanyId: document.companyId },
  );
}

export async function attachGeneratedDocumentToDraftEnvelope(input: {
  tenantId: string;
  envelopeId: string;
  generatedDocumentId: string;
  actorUserId: string;
  replaceExistingGeneratedDocument?: boolean;
  /**
   * The acting user, when a person (not the task worker) is attaching. With it, the
   * attachment is authorized against the company the envelope will end up in, before
   * anything is rendered or written, and again under the row lock.
   */
  session?: SessionUser;
}): Promise<{ envelopeDocumentId: string }> {
  const scope = input.session
    ? await resolveEsigningActorScope(input.session, input.tenantId)
    : null;
  const envelope = await prisma.esigningEnvelope.findFirst({
    where: {
      id: input.envelopeId,
      tenantId: input.tenantId,
      deletedAt: null,
    },
    include: {
      documents: {
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          generatedDocumentId: true,
          storagePath: true,
          signedStoragePath: true,
          sortOrder: true,
          pageCount: true,
          fileSize: true,
        },
      },
    },
  });
  if (!envelope) throw new Error('Envelope not found');
  if (envelope.status !== 'DRAFT') {
    throw new Error('Generated documents can only be attached while the envelope is a draft');
  }

  const current = envelope.documents.find(
    (document) => document.generatedDocumentId === input.generatedDocumentId,
  );
  if (current) return { envelopeDocumentId: current.id };

  const generatedDocument = await prisma.generatedDocument.findFirst({
    where: {
      id: input.generatedDocumentId,
      tenantId: input.tenantId,
      status: 'FINALIZED',
      deletedAt: null,
    },
    select: { id: true, title: true, companyId: true, revision: true },
  });
  if (!generatedDocument) {
    throw new Error('Selected generated document must be finalized and eligible');
  }
  assertGeneratedDocumentCompanyMatchesEnvelope(envelope.companyId, generatedDocument.companyId);
  if (input.session && scope) {
    if (!canMutateEnvelope(scope, input.session, envelope)) {
      throw new Error('Forbidden');
    }
    // An envelope with no company takes the document's company; the actor needs the
    // right to put it there.
    if (
      !envelope.companyId &&
      generatedDocument.companyId &&
      !canMoveEnvelopeToCompany(scope, input.session, envelope, generatedDocument.companyId)
    ) {
      throw new Error('Forbidden');
    }
  }

  const exported = await exportToPDF({
    documentId: generatedDocument.id,
    tenantId: input.tenantId,
    userId: input.actorUserId,
  });
  assertExportMatchesRevision(exported, generatedDocument.revision);
  const exportedBytes = new Uint8Array(exported.buffer);
  const pdf = await PDFDocument.load(exportedBytes);
  const pdfBuffer = Buffer.from(exportedBytes);
  const pageCount = pdf.getPageCount();
  if (pageCount > ESIGNING_LIMITS.MAX_PAGES_PER_DOCUMENT) {
    throw new Error(
      `A single document cannot exceed ${ESIGNING_LIMITS.MAX_PAGES_PER_DOCUMENT} pages`,
    );
  }

  const managedDocument = input.replaceExistingGeneratedDocument === false
    ? undefined
    : envelope.documents.find((document) => document.generatedDocumentId !== null);
  const otherDocuments = envelope.documents.filter(
    (document) => document.id !== managedDocument?.id,
  );
  const totalPages = otherDocuments.reduce(
    (sum, document) => sum + document.pageCount,
    0,
  ) + pageCount;
  if (totalPages > ESIGNING_LIMITS.MAX_TOTAL_PAGES) {
    throw new Error(`An envelope cannot exceed ${ESIGNING_LIMITS.MAX_TOTAL_PAGES} pages in total`);
  }
  const totalSize = otherDocuments.reduce(
    (sum, document) => sum + document.fileSize,
    0,
  ) + pdfBuffer.length;
  if (totalSize > ESIGNING_LIMITS.MAX_TOTAL_FILE_SIZE_BYTES) {
    throw new Error('Envelope documents exceed the maximum total file size');
  }

  const envelopeDocumentId = randomUUID();
  const storagePath = StorageKeys.esigningOriginalDocument(
    input.tenantId,
    input.envelopeId,
    envelopeDocumentId,
    '.pdf',
  );
  const sortOrder = managedDocument?.sortOrder ?? envelope.documents.length;
  await storage.upload(storagePath, pdfBuffer, {
    contentType: 'application/pdf',
    metadata: {
      tenantId: input.tenantId,
      envelopeId: input.envelopeId,
      documentId: envelopeDocumentId,
      generatedDocumentId: generatedDocument.id,
      generatedDocumentRevision: String(generatedDocument.revision),
      ...(exported.provenance ? { generatedDocxSha256: exported.provenance.docxSha256 } : {}),
      originalFileName: generatedDocument.title,
      sourceFormat: 'generated-document',
    },
  });

  try {
    await prisma.$transaction(async (tx) => {
      // Decide again on the committed row: the checks above ran on a snapshot taken
      // before the PDF was rendered.
      const locked = input.session && scope
        ? await lockEnvelopeForAuthorizedChange(tx, {
          scope,
          session: input.session,
          tenantId: input.tenantId,
          envelopeId: input.envelopeId,
          check: canMutateEnvelope,
        })
        : await lockEsigningEnvelopeForUpdate(tx, input.envelopeId);
      if (!locked || locked.status !== 'DRAFT' || locked.companyId !== envelope.companyId) {
        throw new ConflictError('The envelope changed while its PDF was being prepared. Try again.');
      }
      await assertStillFinalizedAtRevision(
        tx,
        input.tenantId,
        generatedDocument.id,
        generatedDocument.revision,
      );
      await tx.esigningEnvelopeDocument.create({
        data: {
          id: envelopeDocumentId,
          tenantId: input.tenantId,
          envelopeId: input.envelopeId,
          generatedDocumentId: generatedDocument.id,
          fileName: exported.filename || `${generatedDocument.title}.pdf`,
          originalFileName: generatedDocument.title,
          storagePath,
          originalHash: hashBlake3(pdfBuffer),
          pageCount,
          sortOrder,
          fileSize: pdfBuffer.length,
        },
      });
      if (!envelope.companyId && generatedDocument.companyId) {
        await tx.esigningEnvelope.updateMany({
          where: { id: input.envelopeId, tenantId: input.tenantId, companyId: null },
          data: { companyId: generatedDocument.companyId },
        });
      }
      if (managedDocument) {
        await tx.esigningEnvelopeDocument.delete({
          where: { id: managedDocument.id },
        });
      }
    });
  } catch (error) {
    await storage.delete(storagePath).catch(() => undefined);
    throw error;
  }

  if (managedDocument) {
    await storage.delete(managedDocument.storagePath).catch((error) => {
      log.warn('Failed to delete replaced generated E-signing document', {
        envelopeId: input.envelopeId,
        documentId: managedDocument.id,
        error,
      });
    });
    if (managedDocument.signedStoragePath) {
      await storage.delete(managedDocument.signedStoragePath).catch(() => undefined);
    }
  }

  await createAuditLog({
    tenantId: input.tenantId,
    userId: input.actorUserId,
    companyId: envelope.companyId ?? undefined,
    action: 'UPLOAD',
    entityType: 'EsigningEnvelope',
    entityId: input.envelopeId,
    entityName: envelope.title,
    summary: `Prepared generated document "${generatedDocument.title}" for E-signing`,
    changeSource: 'SYSTEM',
    metadata: {
      envelopeDocumentId,
      generatedDocumentId: generatedDocument.id,
      generatedDocumentRevision: generatedDocument.revision,
      ...(exported.provenance ? { docxSha256: exported.provenance.docxSha256 } : {}),
      pageCount,
      fileSize: pdfBuffer.length,
    },
  });
  return { envelopeDocumentId };
}

/** The caps on documents, pages and bytes one envelope may hold. */
function assertEnvelopeWithinDocumentLimits(
  documents: Array<{ pageCount: number; fileSize: number }>,
): void {
  if (documents.length > ESIGNING_LIMITS.MAX_DOCUMENTS) {
    throw new Error(`An envelope can contain at most ${ESIGNING_LIMITS.MAX_DOCUMENTS} documents`);
  }
  const totalPages = documents.reduce((sum, document) => sum + document.pageCount, 0);
  if (totalPages > ESIGNING_LIMITS.MAX_TOTAL_PAGES) {
    throw new Error(`An envelope cannot exceed ${ESIGNING_LIMITS.MAX_TOTAL_PAGES} pages in total`);
  }
  const totalSize = documents.reduce((sum, document) => sum + document.fileSize, 0);
  if (totalSize > ESIGNING_LIMITS.MAX_TOTAL_FILE_SIZE_BYTES) {
    throw new Error('Envelope documents exceed the maximum total file size');
  }
}

/**
 * Attaches several finalized generated documents to a draft envelope as one unit: either
 * every document is attached, or nothing changes.
 *
 * Order matters. With a `session`, the whole selection and the company the envelope will
 * end up in (its own, or the one its documents bring) are authorized first, before any PDF
 * is rendered or uploaded. The rows are then written in a single transaction under the
 * envelope's row lock, where access is decided again on the committed row. Uploaded objects
 * are deleted when any step fails.
 */
export async function attachGeneratedDocumentsToDraftEnvelope(input: {
  tenantId: string;
  envelopeId: string;
  generatedDocumentIds: string[];
  actorUserId: string;
  /**
   * The acting user, when a person (not the task worker) is attaching. Without it no
   * permission check is made, as for the task worker.
   */
  session?: SessionUser;
}): Promise<{ envelopeDocumentIds: string[] }> {
  const scope = input.session
    ? await resolveEsigningActorScope(input.session, input.tenantId)
    : null;
  const envelope = await prisma.esigningEnvelope.findFirst({
    where: {
      id: input.envelopeId,
      tenantId: input.tenantId,
      deletedAt: null,
    },
    select: {
      title: true,
      status: true,
      createdById: true,
      companyId: true,
      documents: {
        select: {
          id: true,
          generatedDocumentId: true,
          pageCount: true,
          fileSize: true,
        },
      },
    },
  });
  if (!envelope) throw new Error('Envelope not found');
  if (input.session && scope && !canMutateEnvelope(scope, input.session, envelope)) {
    throw new Error('Forbidden');
  }
  if (envelope.status !== 'DRAFT') {
    throw new Error('Generated documents can only be attached while the envelope is a draft');
  }

  const generatedDocumentIds = [...new Set(input.generatedDocumentIds)];
  const attachedIds = new Map(
    envelope.documents.flatMap((document) =>
      document.generatedDocumentId ? [[document.generatedDocumentId, document.id] as const] : [],
    ),
  );
  const pendingIds = generatedDocumentIds.filter((id) => !attachedIds.has(id));
  if (envelope.documents.length + pendingIds.length > ESIGNING_LIMITS.MAX_DOCUMENTS) {
    throw new Error(`An envelope can contain at most ${ESIGNING_LIMITS.MAX_DOCUMENTS} documents`);
  }

  const found = pendingIds.length === 0
    ? []
    : await prisma.generatedDocument.findMany({
      where: {
        id: { in: pendingIds },
        tenantId: input.tenantId,
        status: 'FINALIZED',
        deletedAt: null,
      },
      select: { id: true, title: true, companyId: true, revision: true },
    });
  const pending = pendingIds.map((id) => found.find((document) => document.id === id));
  const generatedDocuments = pending.flatMap((document) => (document ? [document] : []));
  if (generatedDocuments.length !== pendingIds.length) {
    throw new Error('Selected generated document must be finalized and eligible');
  }

  // The company the envelope ends up in: its own, or else the one its documents share.
  const targetCompanyId =
    envelope.companyId ?? generatedDocuments.find((document) => document.companyId)?.companyId ?? null;
  for (const document of generatedDocuments) {
    assertGeneratedDocumentCompanyMatchesEnvelope(targetCompanyId, document.companyId);
  }
  if (
    input.session &&
    scope &&
    !envelope.companyId &&
    targetCompanyId &&
    !canMoveEnvelopeToCompany(scope, input.session, envelope, targetCompanyId)
  ) {
    throw new Error('Forbidden');
  }

  // Everything is allowed. Render every document and check the limits before uploading any.
  const prepared: Array<{
    generatedDocument: (typeof generatedDocuments)[number];
    envelopeDocumentId: string;
    storagePath: string;
    pdfBuffer: Buffer;
    pageCount: number;
    fileName: string;
    docxSha256?: string;
  }> = [];
  for (const generatedDocument of generatedDocuments) {
    const exported = await exportToPDF({
      documentId: generatedDocument.id,
      tenantId: input.tenantId,
      userId: input.actorUserId,
    });
    assertExportMatchesRevision(exported, generatedDocument.revision);
    const exportedBytes = new Uint8Array(exported.buffer);
    const pdf = await PDFDocument.load(exportedBytes);
    const pageCount = pdf.getPageCount();
    if (pageCount > ESIGNING_LIMITS.MAX_PAGES_PER_DOCUMENT) {
      throw new Error(
        `A single document cannot exceed ${ESIGNING_LIMITS.MAX_PAGES_PER_DOCUMENT} pages`,
      );
    }
    const envelopeDocumentId = randomUUID();
    prepared.push({
      generatedDocument,
      envelopeDocumentId,
      storagePath: StorageKeys.esigningOriginalDocument(
        input.tenantId,
        input.envelopeId,
        envelopeDocumentId,
        '.pdf',
      ),
      pdfBuffer: Buffer.from(exportedBytes),
      pageCount,
      fileName: exported.filename || `${generatedDocument.title}.pdf`,
      docxSha256: exported.provenance?.docxSha256,
    });
    assertEnvelopeWithinDocumentLimits([
      ...envelope.documents,
      ...prepared.map((entry) => ({ pageCount: entry.pageCount, fileSize: entry.pdfBuffer.length })),
    ]);
  }

  const uploadedPaths: string[] = [];
  try {
    for (const entry of prepared) {
      uploadedPaths.push(entry.storagePath);
      await storage.upload(entry.storagePath, entry.pdfBuffer, {
        contentType: 'application/pdf',
        metadata: {
          tenantId: input.tenantId,
          envelopeId: input.envelopeId,
          documentId: entry.envelopeDocumentId,
          generatedDocumentId: entry.generatedDocument.id,
          generatedDocumentRevision: String(entry.generatedDocument.revision),
          ...(entry.docxSha256 ? { generatedDocxSha256: entry.docxSha256 } : {}),
          originalFileName: entry.generatedDocument.title,
          sourceFormat: 'generated-document',
        },
      });
    }

    await prisma.$transaction(async (tx) => {
      // Decide again on the committed row: the checks above ran on a snapshot taken
      // before the PDFs were rendered.
      const locked = input.session && scope
        ? await lockEnvelopeForAuthorizedChange(tx, {
          scope,
          session: input.session,
          tenantId: input.tenantId,
          envelopeId: input.envelopeId,
          check: canMutateEnvelope,
        })
        : await lockEsigningEnvelopeForUpdate(tx, input.envelopeId);
      if (!locked || locked.status !== 'DRAFT' || locked.companyId !== envelope.companyId) {
        throw new ConflictError('The envelope changed while its PDFs were being prepared. Try again.');
      }
      const committed = await tx.esigningEnvelopeDocument.findMany({
        where: { envelopeId: input.envelopeId },
        select: { generatedDocumentId: true, pageCount: true, fileSize: true, sortOrder: true },
      });
      if (
        committed.some(
          (document) => document.generatedDocumentId && pendingIds.includes(document.generatedDocumentId),
        )
      ) {
        throw new ConflictError('The envelope changed while its PDFs were being prepared. Try again.');
      }
      assertEnvelopeWithinDocumentLimits([
        ...committed,
        ...prepared.map((entry) => ({ pageCount: entry.pageCount, fileSize: entry.pdfBuffer.length })),
      ]);
      for (const entry of prepared) {
        await assertStillFinalizedAtRevision(
          tx,
          input.tenantId,
          entry.generatedDocument.id,
          entry.generatedDocument.revision,
        );
      }
      const firstSortOrder = Math.max(committed.length, ...committed.map((document) => document.sortOrder + 1));
      for (const [index, entry] of prepared.entries()) {
        await tx.esigningEnvelopeDocument.create({
          data: {
            id: entry.envelopeDocumentId,
            tenantId: input.tenantId,
            envelopeId: input.envelopeId,
            generatedDocumentId: entry.generatedDocument.id,
            fileName: entry.fileName,
            originalFileName: entry.generatedDocument.title,
            storagePath: entry.storagePath,
            originalHash: hashBlake3(entry.pdfBuffer),
            pageCount: entry.pageCount,
            sortOrder: firstSortOrder + index,
            fileSize: entry.pdfBuffer.length,
          },
        });
      }
      if (!envelope.companyId && targetCompanyId) {
        await tx.esigningEnvelope.updateMany({
          where: { id: input.envelopeId, tenantId: input.tenantId, companyId: null },
          data: { companyId: targetCompanyId },
        });
      }
    });
  } catch (error) {
    await Promise.all(uploadedPaths.map((path) => storage.delete(path).catch(() => undefined)));
    throw error;
  }

  for (const entry of prepared) {
    await createAuditLog({
      tenantId: input.tenantId,
      userId: input.actorUserId,
      companyId: envelope.companyId ?? undefined,
      action: 'UPLOAD',
      entityType: 'EsigningEnvelope',
      entityId: input.envelopeId,
      entityName: envelope.title,
      summary: `Prepared generated document "${entry.generatedDocument.title}" for E-signing`,
      changeSource: 'SYSTEM',
      metadata: {
        envelopeDocumentId: entry.envelopeDocumentId,
        generatedDocumentId: entry.generatedDocument.id,
        generatedDocumentRevision: entry.generatedDocument.revision,
        ...(entry.docxSha256 ? { docxSha256: entry.docxSha256 } : {}),
        pageCount: entry.pageCount,
        fileSize: entry.pdfBuffer.length,
      },
    });
  }

  const preparedByGeneratedId = new Map(
    prepared.map((entry) => [entry.generatedDocument.id, entry.envelopeDocumentId] as const),
  );
  return {
    envelopeDocumentIds: generatedDocumentIds.map(
      (id) => attachedIds.get(id) ?? preparedByGeneratedId.get(id)!,
    ),
  };
}

export async function attachGeneratedDocumentsToEsigningEnvelope(
  session: SessionUser,
  tenantId: string,
  envelopeId: string,
  generatedDocumentIds: string[],
): Promise<EsigningEnvelopeDetailDto> {
  await attachGeneratedDocumentsToDraftEnvelope({
    tenantId,
    envelopeId,
    generatedDocumentIds,
    actorUserId: session.id,
    session,
  });

  return getEsigningEnvelopeDetail(session, tenantId, envelopeId);
}

export async function detachGeneratedDocumentFromDraftEnvelope(input: {
  tenantId: string;
  envelopeId: string;
  generatedDocumentId: string;
  actorUserId: string;
}): Promise<void> {
  const envelope = await prisma.esigningEnvelope.findFirst({
    where: {
      id: input.envelopeId,
      tenantId: input.tenantId,
      deletedAt: null,
    },
    include: {
      documents: {
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          generatedDocumentId: true,
          storagePath: true,
          signedStoragePath: true,
          sortOrder: true,
        },
      },
    },
  });
  if (!envelope) throw new Error('Envelope not found');
  if (envelope.status !== 'DRAFT') {
    throw new Error('Generated documents can only be detached while the envelope is a draft');
  }
  const managedDocument = envelope.documents.find(
    (document) => document.generatedDocumentId === input.generatedDocumentId,
  );
  if (!managedDocument) return;

  const remaining = envelope.documents.filter(
    (document) => document.id !== managedDocument.id,
  );
  await prisma.$transaction(async (tx) => {
    await tx.esigningEnvelopeDocument.delete({
      where: { id: managedDocument.id },
    });
    for (const [sortOrder, document] of remaining.entries()) {
      if (document.sortOrder === sortOrder) continue;
      await tx.esigningEnvelopeDocument.update({
        where: { id: document.id },
        data: { sortOrder },
      });
    }
  });

  await storage.delete(managedDocument.storagePath).catch((error) => {
    log.warn('Failed to delete detached generated E-signing document', {
      envelopeId: input.envelopeId,
      documentId: managedDocument.id,
      error,
    });
  });
  if (managedDocument.signedStoragePath) {
    await storage.delete(managedDocument.signedStoragePath).catch(() => undefined);
  }
  await createAuditLog({
    tenantId: input.tenantId,
    userId: input.actorUserId,
    companyId: envelope.companyId ?? undefined,
    action: 'DELETE',
    entityType: 'EsigningEnvelope',
    entityId: input.envelopeId,
    entityName: envelope.title,
    summary: 'Detached an unfinalized generated document from E-signing',
    changeSource: 'SYSTEM',
    metadata: {
      envelopeDocumentId: managedDocument.id,
      generatedDocumentId: input.generatedDocumentId,
    },
  });
}

export async function deleteEsigningEnvelopeDocument(
  session: SessionUser,
  tenantId: string,
  envelopeId: string,
  documentId: string
): Promise<EsigningEnvelopeDetailDto> {
  const scope = await resolveEsigningActorScope(session, tenantId);
  const envelope = await prisma.esigningEnvelope.findFirst({
    where: { id: envelopeId, tenantId },
    include: {
      documents: {
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          sortOrder: true,
          storagePath: true,
          signedStoragePath: true,
        },
      },
    },
  });

  if (!envelope) {
    throw new Error('Envelope not found');
  }
  if (!canMutateEnvelope(scope, session, envelope)) {
    throw new Error('Forbidden');
  }
  if (envelope.status !== 'DRAFT') {
    throw new Error('Documents can only be removed while the envelope is a draft');
  }

  const document = envelope.documents.find((entry) => entry.id === documentId);
  if (!document) {
    throw new Error('Document not found');
  }

  await prisma.$transaction(async (tx) => {
    await lockDraftForEdit(tx, {
      scope,
      session,
      tenantId,
      envelopeId,
      notDraftMessage: 'Documents can only be removed while the envelope is a draft',
    });
    await tx.esigningEnvelopeDocument.delete({
      where: { id: documentId },
    });
    await tx.esigningEnvelope.update({
      where: { id: envelopeId },
      data: {
        metadata: removeEsigningDocumentVisibility(envelope.metadata, documentId),
      },
    });

    const remaining = envelope.documents.filter((entry) => entry.id !== documentId);
    for (const [index, entry] of remaining.entries()) {
      if (entry.sortOrder === index) {
        continue;
      }
      await tx.esigningEnvelopeDocument.update({
        where: { id: entry.id },
        data: { sortOrder: index },
      });
    }
  });

  try {
    await storage.delete(document.storagePath);
    if (document.signedStoragePath) {
      await storage.delete(document.signedStoragePath);
    }
  } catch (error) {
    log.warn('Failed to remove envelope document asset', { envelopeId, documentId, error });
  }

  await createAuditLog({
    tenantId,
    userId: session.id,
    companyId: envelope.companyId ?? undefined,
    action: 'DELETE',
    entityType: 'EsigningEnvelope',
    entityId: envelopeId,
    entityName: envelope.title,
    summary: `Removed document from e-signing envelope "${envelope.title}"`,
    metadata: {
      documentId,
    },
  });

  return getEsigningEnvelopeDetail(session, tenantId, envelopeId);
}

export async function reorderEsigningEnvelopeDocument(
  session: SessionUser,
  tenantId: string,
  envelopeId: string,
  documentId: string,
  sortOrder: number
): Promise<EsigningEnvelopeDetailDto> {
  const scope = await resolveEsigningActorScope(session, tenantId);
  const envelope = await prisma.esigningEnvelope.findFirst({
    where: { id: envelopeId, tenantId },
    include: {
      documents: {
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          sortOrder: true,
        },
      },
    },
  });

  if (!envelope) {
    throw new Error('Envelope not found');
  }
  if (!canMutateEnvelope(scope, session, envelope)) {
    throw new Error('Forbidden');
  }
  if (envelope.status !== 'DRAFT') {
    throw new Error('Documents can only be reordered while the envelope is a draft');
  }

  const currentIndex = envelope.documents.findIndex((entry) => entry.id === documentId);
  if (currentIndex === -1) {
    throw new Error('Document not found');
  }

  const boundedIndex = Math.max(0, Math.min(sortOrder, envelope.documents.length - 1));
  const reordered = [...envelope.documents];
  const [selected] = reordered.splice(currentIndex, 1);
  reordered.splice(boundedIndex, 0, selected);

  await prisma.$transaction(async (tx) => {
    await lockDraftForEdit(tx, {
      scope,
      session,
      tenantId,
      envelopeId,
      notDraftMessage: 'Documents can only be reordered while the envelope is a draft',
    });
    for (const [index, entry] of reordered.entries()) {
      await tx.esigningEnvelopeDocument.update({
        where: { id: entry.id },
        data: { sortOrder: index },
      });
    }
  });

  return getEsigningEnvelopeDetail(session, tenantId, envelopeId);
}

export async function renameEsigningEnvelopeDocument(
  session: SessionUser,
  tenantId: string,
  envelopeId: string,
  documentId: string,
  fileName: string
): Promise<EsigningEnvelopeDetailDto> {
  const scope = await resolveEsigningActorScope(session, tenantId);
  const envelope = await prisma.esigningEnvelope.findFirst({
    where: { id: envelopeId, tenantId },
    select: {
      id: true,
      title: true,
      status: true,
      companyId: true,
      createdById: true,
      documents: {
        select: {
          id: true,
          originalFileName: true,
          fileName: true,
        },
      },
    },
  });

  if (!envelope) {
    throw new Error('Envelope not found');
  }
  if (!canMutateEnvelope(scope, session, envelope)) {
    throw new Error('Forbidden');
  }
  if (envelope.status !== 'DRAFT') {
    throw new Error('Documents can only be renamed while the envelope is a draft');
  }

  const document = envelope.documents.find((entry) => entry.id === documentId);
  if (!document) {
    throw new Error('Document not found');
  }

  const previousFileName = document.originalFileName ?? document.fileName;
  if (previousFileName === fileName) {
    return getEsigningEnvelopeDetail(session, tenantId, envelopeId);
  }

  await prisma.$transaction(async (tx) => {
    await lockDraftForEdit(tx, {
      scope,
      session,
      tenantId,
      envelopeId,
      notDraftMessage: 'Documents can only be renamed while the envelope is a draft',
    });
    await tx.esigningEnvelopeDocument.update({
      where: { id: documentId },
      data: { originalFileName: fileName },
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
    summary: `Renamed document in e-signing envelope "${envelope.title}"`,
    metadata: {
      documentId,
      previousFileName,
      fileName,
    },
  });

  return getEsigningEnvelopeDetail(session, tenantId, envelopeId);
}

export async function updateEsigningEnvelopeDocumentVisibility(
  session: SessionUser,
  tenantId: string,
  envelopeId: string,
  documentId: string,
  visibility: EsigningDocumentVisibility
): Promise<EsigningEnvelopeDetailDto> {
  const scope = await resolveEsigningActorScope(session, tenantId);
  const envelope = await prisma.esigningEnvelope.findFirst({
    where: { id: envelopeId, tenantId },
    select: {
      id: true,
      title: true,
      status: true,
      companyId: true,
      createdById: true,
      metadata: true,
      documents: {
        select: { id: true },
      },
    },
  });

  if (!envelope) {
    throw new Error('Envelope not found');
  }
  if (!canMutateEnvelope(scope, session, envelope)) {
    throw new Error('Forbidden');
  }
  if (envelope.status !== 'DRAFT') {
    throw new Error('Document visibility can only be changed while the envelope is a draft');
  }
  if (!envelope.documents.some((document) => document.id === documentId)) {
    throw new Error('Document not found');
  }

  await prisma.$transaction(async (tx) => {
    await lockDraftForEdit(tx, {
      scope,
      session,
      tenantId,
      envelopeId,
      notDraftMessage: 'Document visibility can only be changed while the envelope is a draft',
    });
    await tx.esigningEnvelope.update({
      where: { id: envelopeId },
      data: {
        metadata: setEsigningDocumentVisibility(envelope.metadata, documentId, visibility),
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
    summary: `Changed document visibility in e-signing envelope "${envelope.title}"`,
    metadata: {
      documentId,
      visibility,
    },
  });

  return getEsigningEnvelopeDetail(session, tenantId, envelopeId);
}

/**
 * Replaces an envelope's field definitions. The company rule lives here, in the service
 * layer, and is decided on the locked row in the transaction that writes.
 */
export async function saveEsigningEnvelopeFields(
  session: SessionUser,
  tenantId: string,
  envelopeId: string,
  input: SaveEsigningFieldDefinitionsInput,
): Promise<{
  envelope: EsigningEnvelopeDetailDto;
  fieldWarnings: Awaited<ReturnType<typeof saveEnvelopeFieldDefinitions>>;
}> {
  const scope = await resolveEsigningActorScope(session, tenantId);
  const envelope = await prisma.esigningEnvelope.findFirst({
    where: { id: envelopeId, tenantId },
    select: { id: true, status: true, companyId: true, createdById: true },
  });
  if (!envelope) {
    throw new Error('Envelope not found');
  }
  if (!canMutateEnvelope(scope, session, envelope)) {
    throw new Error('Forbidden');
  }

  const fieldWarnings = await prisma.$transaction(async (tx) => {
    await lockDraftForEdit(tx, {
      scope,
      session,
      tenantId,
      envelopeId,
      notDraftMessage: 'Fields can only be edited while the envelope is a draft',
    });
    return saveEnvelopeFieldDefinitions(envelopeId, input, tx);
  });

  return {
    envelope: await getEsigningEnvelopeDetail(session, tenantId, envelopeId),
    fieldWarnings,
  };
}
