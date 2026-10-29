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
import { canMutateEnvelope, resolveEsigningActorScope } from '@/services/esigning-envelope.lib';
import { getEsigningEnvelopeDetail } from './lifecycle';
import {
  log,
  assertGeneratedDocumentCompanyMatchesEnvelope,
  assertExportMatchesRevision,
} from './shared';

export async function uploadEsigningEnvelopeDocument(
  session: SessionUser,
  tenantId: string,
  envelopeId: string,
  file: File,
  options?: { originalFileName?: string },
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
  if (envelope.status !== 'DRAFT') {
    throw new Error('Documents can only be uploaded while the envelope is a draft');
  }
  if (!canMutateEnvelope(scope, session, envelope.createdById)) {
    throw new Error('Forbidden');
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

  await prisma.esigningEnvelopeDocument.create({
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

  const envelope = await prisma.esigningEnvelope.findFirst({
    where: { id: envelopeId, tenantId, deletedAt: null },
    select: { companyId: true },
  });
  if (!envelope) {
    throw new Error('Envelope not found');
  }
  assertGeneratedDocumentCompanyMatchesEnvelope(envelope.companyId, document.companyId);
  if (!envelope.companyId && document.companyId) {
    await prisma.esigningEnvelope.updateMany({
      where: { id: envelopeId, tenantId, deletedAt: null, companyId: null },
      data: { companyId: document.companyId },
    });
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
    { originalFileName: document.title },
  );
}

export async function attachGeneratedDocumentToDraftEnvelope(input: {
  tenantId: string;
  envelopeId: string;
  generatedDocumentId: string;
  actorUserId: string;
  replaceExistingGeneratedDocument?: boolean;
}): Promise<{ envelopeDocumentId: string }> {
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

export async function attachGeneratedDocumentsToDraftEnvelope(input: {
  tenantId: string;
  envelopeId: string;
  generatedDocumentIds: string[];
  actorUserId: string;
}): Promise<{ envelopeDocumentIds: string[] }> {
  const envelope = await prisma.esigningEnvelope.findFirst({
    where: {
      id: input.envelopeId,
      tenantId: input.tenantId,
      deletedAt: null,
    },
    select: {
      status: true,
      documents: {
        select: {
          generatedDocumentId: true,
        },
      },
    },
  });
  if (!envelope) throw new Error('Envelope not found');
  if (envelope.status !== 'DRAFT') {
    throw new Error('Generated documents can only be attached while the envelope is a draft');
  }

  const generatedDocumentIds = [...new Set(input.generatedDocumentIds)];
  const existingGeneratedDocumentIds = new Set(
    envelope.documents.flatMap((document) => document.generatedDocumentId ? [document.generatedDocumentId] : []),
  );
  const newDocumentCount = generatedDocumentIds.filter((id) => !existingGeneratedDocumentIds.has(id)).length;
  if (envelope.documents.length + newDocumentCount > ESIGNING_LIMITS.MAX_DOCUMENTS) {
    throw new Error(`An envelope can contain at most ${ESIGNING_LIMITS.MAX_DOCUMENTS} documents`);
  }

  const envelopeDocumentIds: string[] = [];
  for (const generatedDocumentId of generatedDocumentIds) {
    const attachment = await attachGeneratedDocumentToDraftEnvelope({
      tenantId: input.tenantId,
      envelopeId: input.envelopeId,
      generatedDocumentId,
      actorUserId: input.actorUserId,
      replaceExistingGeneratedDocument: false,
    });
    envelopeDocumentIds.push(attachment.envelopeDocumentId);
  }
  return { envelopeDocumentIds };
}

export async function attachGeneratedDocumentsToEsigningEnvelope(
  session: SessionUser,
  tenantId: string,
  envelopeId: string,
  generatedDocumentIds: string[],
): Promise<EsigningEnvelopeDetailDto> {
  const scope = await resolveEsigningActorScope(session, tenantId);
  const envelope = await prisma.esigningEnvelope.findFirst({
    where: {
      id: envelopeId,
      tenantId,
      deletedAt: null,
    },
    select: {
      status: true,
      createdById: true,
    },
  });

  if (!envelope) throw new Error('Envelope not found');
  if (envelope.status !== 'DRAFT') {
    throw new Error('Generated documents can only be attached while the envelope is a draft');
  }
  if (!canMutateEnvelope(scope, session, envelope.createdById)) {
    throw new Error('Forbidden');
  }

  await attachGeneratedDocumentsToDraftEnvelope({
    tenantId,
    envelopeId,
    generatedDocumentIds,
    actorUserId: session.id,
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
  if (envelope.status !== 'DRAFT') {
    throw new Error('Documents can only be removed while the envelope is a draft');
  }
  if (!canMutateEnvelope(scope, session, envelope.createdById)) {
    throw new Error('Forbidden');
  }

  const document = envelope.documents.find((entry) => entry.id === documentId);
  if (!document) {
    throw new Error('Document not found');
  }

  await prisma.$transaction(async (tx) => {
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
  if (envelope.status !== 'DRAFT') {
    throw new Error('Documents can only be reordered while the envelope is a draft');
  }
  if (!canMutateEnvelope(scope, session, envelope.createdById)) {
    throw new Error('Forbidden');
  }

  const currentIndex = envelope.documents.findIndex((entry) => entry.id === documentId);
  if (currentIndex === -1) {
    throw new Error('Document not found');
  }

  const boundedIndex = Math.max(0, Math.min(sortOrder, envelope.documents.length - 1));
  const reordered = [...envelope.documents];
  const [selected] = reordered.splice(currentIndex, 1);
  reordered.splice(boundedIndex, 0, selected);

  await prisma.$transaction(
    reordered.map((entry, index) =>
      prisma.esigningEnvelopeDocument.update({
        where: { id: entry.id },
        data: { sortOrder: index },
      })
    )
  );

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
  if (envelope.status !== 'DRAFT') {
    throw new Error('Documents can only be renamed while the envelope is a draft');
  }
  if (!canMutateEnvelope(scope, session, envelope.createdById)) {
    throw new Error('Forbidden');
  }

  const document = envelope.documents.find((entry) => entry.id === documentId);
  if (!document) {
    throw new Error('Document not found');
  }

  const previousFileName = document.originalFileName ?? document.fileName;
  if (previousFileName === fileName) {
    return getEsigningEnvelopeDetail(session, tenantId, envelopeId);
  }

  await prisma.esigningEnvelopeDocument.update({
    where: { id: documentId },
    data: { originalFileName: fileName },
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
  if (envelope.status !== 'DRAFT') {
    throw new Error('Document visibility can only be changed while the envelope is a draft');
  }
  if (!canMutateEnvelope(scope, session, envelope.createdById)) {
    throw new Error('Forbidden');
  }
  if (!envelope.documents.some((document) => document.id === documentId)) {
    throw new Error('Document not found');
  }

  await prisma.esigningEnvelope.update({
    where: { id: envelopeId },
    data: {
      metadata: setEsigningDocumentVisibility(envelope.metadata, documentId, visibility),
    },
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
