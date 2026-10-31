import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { prisma } from '@/lib/prisma';
import { hashBlake3 } from '@/lib/encryption';
import { storage, StorageKeys } from '@/lib/storage';
import { markFilingJobsForTerminalSourceFailure } from '@/services/esigning-sharepoint-filing/enqueue';
import {
  getEsigningDocumentOriginalFileName,
  getEsigningDocumentPdfFileName,
  getEsigningDocumentVariantFileName,
} from '@/lib/esigning-document-filename';
import { isEsigningDocumentVisibleToRecipient } from '@/lib/esigning-document-visibility';
import { Prisma } from '@/generated/prisma';
import { createEsigningPdfTextFonts } from '@/services/esigning-pdf-fonts';
import {
  buildEsigningDeliveryDownloadUrl,
  createEsigningDeliveryToken,
  verifyEsigningDeliveryToken,
} from '@/lib/esigning-session';
import { renderEsigningCertificatePdf } from '@/services/esigning-certificate-pdf.renderer';
import { sendEsigningPdfFailureEmailToSender } from '@/services/esigning-notification.service';
import {
  ESIGNING_RENDERER_VERSION,
  EsigningArtifactError,
  SOURCE_DIGEST_MISMATCH_PREFIX,
  buildSourceDigests,
  formatSourceDigestMismatchMessage,
  getCurrentCertificateArtifact,
  getCurrentDocumentArtifact,
  getCurrentIssuedVersion,
  inspectCurrentIssuedVersion,
  isSourceDigestMismatchMessage,
  mergeIssuedPdfs,
  persistIssuedVersion,
  readIssuedArtifact,
  type NewIssuedArtifact,
} from '@/services/esigning-issued-artifacts';
import {
  recordEsigningEnvelopeEmailDeliveryResults,
  withEsigningDeliveryTarget,
} from '@/services/esigning-email-delivery.service';

const PROCESSING_LEASE_MS = 15 * 60 * 1000;
const MAX_EMAIL_ATTACHMENT_BYTES = 20 * 1024 * 1024;

function toPdfBounds(input: {
  pageWidth: number;
  pageHeight: number;
  xPercent: number;
  yPercent: number;
  widthPercent: number;
  heightPercent: number;
}) {
  const width = input.pageWidth * input.widthPercent;
  const height = input.pageHeight * input.heightPercent;
  const x = input.pageWidth * input.xPercent;
  const y = input.pageHeight - input.pageHeight * input.yPercent - height;

  return { x, y, width, height };
}

export async function buildCertificatePdf(input: {
  envelope: Awaited<ReturnType<typeof loadEnvelopeForPdf>>;
  document?: Awaited<ReturnType<typeof loadEnvelopeForPdf>>['documents'][number];
}) {
  return renderEsigningCertificatePdf({
    envelope: input.envelope,
  });
}

/**
 * Email attachments are the stored document+certificate files, byte for byte. They are not merged
 * here: the merged PDF is built once when the artifacts are generated and hashed then, so what is
 * attached is exactly what the public verification check recognises.
 */
export async function buildEmailAttachments(input: {
  documents: Array<{
    fileName: string;
    originalFileName?: string | null;
    content: Buffer;
  }>;
}): Promise<Array<{
  filename: string;
  content: Buffer;
  contentType: string;
}>> {
  const totalBytes = input.documents.reduce((sum, document) => sum + document.content.byteLength, 0);
  if (totalBytes > MAX_EMAIL_ATTACHMENT_BYTES) {
    return [];
  }

  return input.documents.map((document) => ({
    filename: getEsigningDocumentVariantFileName(document, 'signed'),
    content: document.content,
    contentType: 'application/pdf',
  }));
}

function sanitizePdfBaseName(value: string): string {
  return value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .slice(0, 120) || 'esigning-package';
}

function withEnvelopeArtifactVersion(metadata: Prisma.JsonValue | null | undefined): Prisma.InputJsonValue {
  const base =
    metadata && !Array.isArray(metadata) && typeof metadata === 'object'
      ? { ...(metadata as Record<string, unknown>) }
      : {};

  return {
    ...base,
    artifactVersion: ESIGNING_RENDERER_VERSION,
  } satisfies Prisma.InputJsonValue;
}

export async function mergePdfBuffers(buffers: Uint8Array[]): Promise<Buffer> {
  const mergedPdf = await PDFDocument.create();

  for (const buffer of buffers) {
    const sourcePdf = await PDFDocument.load(new Uint8Array(buffer));
    const copiedPages = await mergedPdf.copyPages(sourcePdf, sourcePdf.getPageIndices());
    copiedPages.forEach((page) => mergedPdf.addPage(page));
  }

  return Buffer.from(await mergedPdf.save());
}

export async function composeEsigningEnvelopePackage(input: {
  variant: 'documents' | 'documents_with_certificates' | 'certificates';
  signedBuffers: Buffer[];
  certificateBuffer?: Buffer;
}): Promise<Buffer> {
  if (input.variant === 'certificates') {
    if (!input.certificateBuffer) {
      throw new Error('Completion certificate is not available');
    }
    return mergePdfBuffers([input.certificateBuffer]);
  }

  if (input.signedBuffers.length === 0) {
    throw new Error('No generated PDFs are available for download');
  }

  const buffers: Buffer[] = [...input.signedBuffers];
  if (input.variant === 'documents_with_certificates') {
    if (!input.certificateBuffer) {
      throw new Error('Completion certificate is not available');
    }
    buffers.push(input.certificateBuffer);
  }

  return mergePdfBuffers(buffers);
}
export async function buildDeliveryDocumentLinks(input: {
  envelopeId: string;
  actorType: 'recipient' | 'sender';
  recipientId?: string;
  documents: Array<{
    id: string;
    fileName: string;
    originalFileName?: string | null;
  }>;
}): Promise<Array<{
  label: string;
  signedUrl: string;
  certificateUrl: string;
}>> {
  const token = await createEsigningDeliveryToken({
    envelopeId: input.envelopeId,
    actorType: input.actorType,
    recipientId: input.recipientId,
  });

  return input.documents.map((document) => ({
    label: getEsigningDocumentOriginalFileName(document),
    signedUrl: buildEsigningDeliveryDownloadUrl({
      token,
      documentId: document.id,
      variant: 'signed',
    }),
    certificateUrl: buildEsigningDeliveryDownloadUrl({
      token,
      documentId: document.id,
      variant: 'certificate',
    }),
  }));
}

async function loadEnvelopeForPdf(envelopeId: string) {
  const envelope = await prisma.esigningEnvelope.findUnique({
    where: { id: envelopeId },
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
        orderBy: [
          { sortOrder: 'asc' },
          { createdAt: 'asc' },
        ],
      },
      events: {
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!envelope) {
    throw new Error('Envelope not found');
  }

  const fieldValues = await prisma.esigningDocumentFieldValue.findMany({
    where: {
      recipient: {
        envelopeId,
      },
    },
  });

  return {
    ...envelope,
    fieldValues,
  };
}

type PdfEnvelope = Awaited<ReturnType<typeof loadEnvelopeForPdf>>;

async function renderSignedDocument(
  envelope: PdfEnvelope,
  document: PdfEnvelope['documents'][number],
  originalBuffer: Buffer,
): Promise<Buffer> {
  const fieldValuesByDefinitionId = new Map(
    envelope.fieldValues.map((value) => [value.fieldDefinitionId, value]),
  );
  const originalPdf = await PDFDocument.load(originalBuffer);
  // Helvetica only covers WinAnsi, so it is kept for the fixed ASCII stamp and checkbox mark. Field
  // values are user text and use the bundled Unicode fonts (subset on embed, see esigning-pdf-fonts).
  const font = await originalPdf.embedFont(StandardFonts.Helvetica);
  const textFonts = await createEsigningPdfTextFonts(originalPdf);

  for (let pageIndex = 0; pageIndex < originalPdf.getPageCount(); pageIndex += 1) {
    const pageNumber = pageIndex + 1;
    const page = originalPdf.getPage(pageIndex);
    const { width, height } = page.getSize();

    page.drawText(envelope.certificateId, {
      x: 24,
      y: 14,
      size: 8,
      font,
      color: rgb(0.45, 0.5, 0.56),
    });

    const pageFields = envelope.fieldDefinitions.filter(
      (field) => field.documentId === document.id && field.pageNumber === pageNumber,
    );

    for (const field of pageFields) {
      const value = fieldValuesByDefinitionId.get(field.id);
      const bounds = toPdfBounds({
        pageWidth: width,
        pageHeight: height,
        xPercent: field.xPercent,
        yPercent: field.yPercent,
        widthPercent: field.widthPercent,
        heightPercent: field.heightPercent,
      });

      if ((field.type === 'SIGNATURE' || field.type === 'INITIALS') && value?.signatureStoragePath) {
        const imageBuffer = await storage.download(value.signatureStoragePath);
        const image = await originalPdf.embedPng(imageBuffer);
        page.drawImage(image, {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
        });
        continue;
      }

      if (field.type === 'CHECKBOX') {
        page.drawRectangle({
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          borderColor: rgb(0.1, 0.15, 0.2),
          borderWidth: 1,
        });
        if (value?.value === 'true') {
          page.drawText('X', {
            x: bounds.x + 3,
            y: bounds.y + bounds.height / 4,
            size: Math.max(10, bounds.height * 0.8),
            font,
            color: rgb(0.16, 0.3, 0.27),
          });
        }
        continue;
      }

      if (value?.value) {
        textFonts.drawText(page, value.value, {
          x: bounds.x + 2,
          y: bounds.y + Math.max(2, bounds.height / 3),
          size: Math.max(9, Math.min(12, bounds.height * 0.65)),
          color: rgb(0.1, 0.15, 0.2),
          maxWidth: bounds.width - 4,
        });
      }
    }
  }

  return Buffer.from(await originalPdf.save());
}

/**
 * Generate the next artifact version. Nothing is uploaded until every source has been verified and
 * every file rendered, and earlier versions' rows and files are never touched: the new files go under
 * `v{n}/` and one transaction inserts the rows and moves the envelope pointers.
 */
async function generateEnvelopeArtifacts(envelopeId: string): Promise<void> {
  const envelope = await loadEnvelopeForPdf(envelopeId);

  if (envelope.status !== 'COMPLETED') {
    throw new Error('Only completed envelopes can generate signed PDFs');
  }

  const latest = await prisma.esigningIssuedArtifact.aggregate({
    where: { envelopeId },
    _max: { version: true },
  });
  const version = Math.max(envelope.currentArtifactVersion ?? 0, latest._max.version ?? 0) + 1;

  // Pre-pass: the originals are the evidence the signed copy is built from. Verify every one against
  // the digest recorded at upload, reuse the downloaded bytes, and stop before writing anything.
  const originals = new Map<string, Buffer>();
  const originalHashes: Record<string, string> = {};
  for (const document of envelope.documents) {
    const buffer = await storage.download(document.storagePath);
    const actual = hashBlake3(buffer);
    if (actual !== document.originalHash) {
      throw new EsigningArtifactError(
        'SOURCE_DIGEST_MISMATCH',
        formatSourceDigestMismatchMessage(getEsigningDocumentOriginalFileName(document)),
        { documentId: document.id, expected: document.originalHash, actual },
      );
    }
    originals.set(document.id, buffer);
    originalHashes[document.id] = document.originalHash;
  }

  const issuedAt = envelope.completedAt ?? envelope.createdAt;
  const certificateBuffer = await buildCertificatePdf({ envelope });
  const certificateBlake3 = hashBlake3(certificateBuffer);
  const certificatePath = StorageKeys.esigningIssuedCertificate(envelope.tenantId, envelope.id, version);

  const files: Array<{
    path: string;
    buffer: Buffer;
    metadata: Record<string, string>;
    artifact: NewIssuedArtifact;
  }> = [
    {
      path: certificatePath,
      buffer: certificateBuffer,
      metadata: {
        envelopeId: envelope.id,
        certificateId: envelope.certificateId,
        version: String(version),
      },
      artifact: {
        documentId: null,
        kind: 'CERTIFICATE',
        storagePath: certificatePath,
        blake3: certificateBlake3,
        byteSize: certificateBuffer.byteLength,
        sourceDigests: buildSourceDigests({ originalHashes }),
      },
    },
  ];

  for (const document of envelope.documents) {
    const signedBuffer = await renderSignedDocument(
      envelope,
      document,
      originals.get(document.id) as Buffer,
    );
    const signedBlake3 = hashBlake3(signedBuffer);
    const mergedBuffer = await mergeIssuedPdfs([signedBuffer, certificateBuffer], issuedAt);
    const signedPath = StorageKeys.esigningIssuedSignedDocument(
      envelope.tenantId,
      envelope.id,
      version,
      document.id,
    );
    const mergedPath = StorageKeys.esigningIssuedDocumentWithCertificate(
      envelope.tenantId,
      envelope.id,
      version,
      document.id,
    );
    const metadata = {
      envelopeId: envelope.id,
      documentId: document.id,
      certificateId: envelope.certificateId,
      version: String(version),
    };
    files.push(
      {
        path: signedPath,
        buffer: signedBuffer,
        metadata,
        artifact: {
          documentId: document.id,
          kind: 'SIGNED_DOCUMENT',
          storagePath: signedPath,
          blake3: signedBlake3,
          byteSize: signedBuffer.byteLength,
          sourceDigests: buildSourceDigests({ originalHashes }),
        },
      },
      {
        path: mergedPath,
        buffer: mergedBuffer,
        metadata,
        artifact: {
          documentId: document.id,
          kind: 'DOCUMENT_WITH_CERTIFICATE',
          storagePath: mergedPath,
          blake3: hashBlake3(mergedBuffer),
          byteSize: mergedBuffer.byteLength,
          sourceDigests: buildSourceDigests({ originalHashes, certificateBlake3, signedBlake3 }),
        },
      },
    );
  }

  for (const file of files) {
    await storage.upload(file.path, file.buffer, {
      contentType: 'application/pdf',
      metadata: file.metadata,
    });
  }

  await persistIssuedVersion({
    tenantId: envelope.tenantId,
    envelopeId: envelope.id,
    version,
    rendererVersion: ESIGNING_RENDERER_VERSION,
    artifacts: files.map((file) => file.artifact),
    envelopeMetadata: withEnvelopeArtifactVersion(envelope.metadata),
  });
}

/**
 * Take the generation lease with a conditional update, so two callers cannot both generate.
 * `lazy` is the on-demand path (a download, email or filing noticed something is missing); the
 * scheduler and the explicit retry use the other one. A source-digest failure is never retried by a
 * lazy caller: it would fail identically and send another failure email.
 */
async function claimEnvelopeForGeneration(envelopeId: string, options: { lazy: boolean }): Promise<boolean> {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - PROCESSING_LEASE_MS);
  const claim = await prisma.esigningEnvelope.updateMany({
    where: {
      id: envelopeId,
      status: 'COMPLETED',
      OR: [
        { pdfGenerationStatus: null },
        { pdfGenerationStatus: 'PENDING' },
        ...(options.lazy ? [{ pdfGenerationStatus: 'COMPLETED' as const }] : []),
        options.lazy
          ? {
              pdfGenerationStatus: 'FAILED' as const,
              OR: [
                { pdfGenerationError: null },
                { pdfGenerationError: { not: { startsWith: SOURCE_DIGEST_MISMATCH_PREFIX } } },
              ],
            }
          : { pdfGenerationStatus: 'FAILED' as const },
        {
          pdfGenerationStatus: 'PROCESSING',
          pdfGenerationClaimedAt: { lt: staleBefore },
        },
      ],
    },
    data: {
      pdfGenerationStatus: 'PROCESSING',
      pdfGenerationClaimedAt: now,
      pdfGenerationError: null,
    },
  });
  return claim.count === 1;
}

/**
 * Make sure the current issued version can be served. An issued version is immutable: this only
 * generates when nothing has been issued or a file of the current version is missing from storage
 * (the new files become the next version). A different renderer version is not a reason.
 */
export async function ensureEsigningEnvelopeArtifacts(input: {
  envelopeId: string;
  requireCertificates?: boolean;
}): Promise<void> {
  const envelope = await prisma.esigningEnvelope.findUnique({
    where: { id: input.envelopeId },
    select: { id: true, status: true },
  });

  if (!envelope) {
    throw new Error('Envelope not found');
  }

  if (envelope.status !== 'COMPLETED') {
    throw new Error('Completed package is not available yet');
  }

  const state = await inspectCurrentIssuedVersion({
    envelopeId: envelope.id,
    requireCertificates: Boolean(input.requireCertificates),
  });
  if (state === 'ready') {
    return;
  }

  if (!(await claimEnvelopeForGeneration(envelope.id, { lazy: true }))) {
    const current = await prisma.esigningEnvelope.findUnique({
      where: { id: envelope.id },
      select: { pdfGenerationStatus: true, pdfGenerationError: true },
    });
    if (current?.pdfGenerationStatus === 'FAILED' && isSourceDigestMismatchMessage(current.pdfGenerationError)) {
      throw new EsigningArtifactError('SOURCE_DIGEST_MISMATCH', current.pdfGenerationError as string);
    }
    throw new EsigningArtifactError(
      'ARTIFACTS_PROCESSING',
      'Signed documents are being prepared. Try again shortly.',
    );
  }

  try {
    await generateEnvelopeArtifacts(envelope.id);
  } catch (error) {
    await markEnvelopePdfFailure(envelope.id, error);
    throw error;
  }
}

async function markEnvelopePdfFailure(envelopeId: string, error: unknown): Promise<void> {
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
    },
  });

  if (!envelope) {
    return;
  }

  const message = error instanceof Error ? error.message : 'Unknown error';
  const typedDetails =
    error instanceof EsigningArtifactError ? { code: error.code, ...error.details } : {};

  await prisma.$transaction(async (tx) => {
    await tx.esigningEnvelope.update({
      where: { id: envelopeId },
      data: {
        pdfGenerationStatus: 'FAILED',
        pdfGenerationClaimedAt: null,
        pdfGenerationAttempts: { increment: 1 },
        pdfGenerationError: message,
      },
    });

    await tx.esigningEnvelopeEvent.create({
      data: {
        tenantId: envelope.tenantId,
        envelopeId,
        action: 'PDF_GENERATION_FAILED',
        metadata: {
          message,
          ...typedDetails,
        },
      },
    });
    await markFilingJobsForTerminalSourceFailure(
      tx,
      envelopeId,
      'SOURCE_GENERATION_FAILED',
      envelope.tenantId,
    );
  });

  const senderName =
    [envelope.createdBy.firstName, envelope.createdBy.lastName].filter(Boolean).join(' ').trim() ||
    envelope.createdBy.email;

  const deliveryResult = await sendEsigningPdfFailureEmailToSender({
    to: envelope.createdBy.email,
    senderName,
    envelopeTitle: envelope.title,
    errorMessage: message.replace(SOURCE_DIGEST_MISMATCH_PREFIX, '').trim(),
  });
  await recordEsigningEnvelopeEmailDeliveryResults(envelopeId, [
    withEsigningDeliveryTarget(deliveryResult, {
      tenantId: envelope.tenantId,
      targetKey: `sender:${envelope.createdById}`,
      audience: 'SENDER',
    }),
  ]);
}

/**
 * Explicit generation: the completion hook, the scheduler (PENDING or an abandoned lease) and the
 * manual retry after a failure. Appends the next artifact version; it never changes an earlier one.
 */
export async function generateEsigningEnvelopeArtifactsNow(input: {
  envelopeId: string;
}): Promise<'generated' | 'already-processing' | 'already-completed'> {
  const envelope = await prisma.esigningEnvelope.findUnique({
    where: { id: input.envelopeId },
    select: {
      id: true,
      status: true,
      pdfGenerationStatus: true,
      pdfGenerationClaimedAt: true,
    },
  });

  if (!envelope) {
    throw new Error('Envelope not found');
  }

  if (envelope.status !== 'COMPLETED') {
    throw new Error('Only completed envelopes can generate signed PDFs');
  }

  if (envelope.pdfGenerationStatus === 'COMPLETED') {
    return 'already-completed';
  }

  if (!(await claimEnvelopeForGeneration(input.envelopeId, { lazy: false }))) {
    return 'already-processing';
  }

  try {
    await generateEnvelopeArtifacts(input.envelopeId);
    return 'generated';
  } catch (error) {
    await markEnvelopePdfFailure(input.envelopeId, error);
    throw error;
  }
}

export async function downloadEsigningEnvelopePackage(input: {
  tenantId: string;
  envelopeId: string;
  variant?: 'documents' | 'documents_with_certificates' | 'certificates';
}): Promise<{
  buffer: Buffer;
  fileName: string;
}> {
  const variant = input.variant ?? 'documents_with_certificates';
  await ensureEsigningEnvelopeArtifacts({
    envelopeId: input.envelopeId,
    requireCertificates: variant !== 'documents',
  });

  const envelope = await prisma.esigningEnvelope.findFirst({
    where: {
      id: input.envelopeId,
      tenantId: input.tenantId,
    },
    include: {
      documents: {
        orderBy: { sortOrder: 'asc' },
      },
    },
  });

  if (!envelope) {
    throw new Error('Envelope not found');
  }
  if (envelope.status !== 'COMPLETED') {
    throw new Error('Completed package is not available yet');
  }
  const issued = await getCurrentIssuedVersion(envelope.id);
  if (!issued) {
    throw new Error('One or more generated PDFs are not available yet');
  }

  const signedBuffers: Buffer[] = [];
  if (variant !== 'certificates') {
    for (const document of envelope.documents) {
      const signed = issued.signedByDocumentId.get(document.id);
      if (!signed) {
        throw new Error('One or more generated PDFs are not available yet');
      }
      signedBuffers.push(await readIssuedArtifact(signed));
    }
  }

  let certificateBuffer: Buffer | undefined;
  if (variant !== 'documents') {
    if (!issued.certificate) {
      throw new Error('Completion certificate is not available');
    }
    certificateBuffer = await readIssuedArtifact(issued.certificate);
  }

  const fileNameBase = sanitizePdfBaseName(envelope.title);
  const fileName =
    variant === 'certificates'
      ? `${fileNameBase}-certificate.pdf`
      : variant === 'documents'
        ? `${fileNameBase}-documents.pdf`
        : `${fileNameBase}-documents-and-certificate.pdf`;

  // A package that is exactly one issued file is served as stored, not re-saved, so the download
  // can be recognised by the public check. Only a multi-document package has to be merged here.
  const singleDocument = envelope.documents.length === 1 ? envelope.documents[0] : null;
  if (variant === 'certificates' && certificateBuffer) {
    return { buffer: certificateBuffer, fileName };
  }
  if (singleDocument && variant === 'documents') {
    return { buffer: signedBuffers[0], fileName };
  }
  if (singleDocument && variant === 'documents_with_certificates') {
    const merged = issued.withCertificateByDocumentId.get(singleDocument.id);
    if (merged) {
      return { buffer: await readIssuedArtifact(merged), fileName };
    }
  }

  return {
    buffer: await composeEsigningEnvelopePackage({
      variant,
      signedBuffers,
      certificateBuffer,
    }),
    fileName,
  };
}

export async function downloadEsigningDocumentPackage(input: {
  tenantId: string;
  envelopeId: string;
  documentId: string;
  variant?: 'signed' | 'signed_with_certificate';
}): Promise<{
  buffer: Buffer;
  fileName: string;
}> {
  const variant = input.variant ?? 'signed';
  await ensureEsigningEnvelopeArtifacts({
    envelopeId: input.envelopeId,
    requireCertificates: variant === 'signed_with_certificate',
  });

  const envelope = await prisma.esigningEnvelope.findFirst({
    where: {
      id: input.envelopeId,
      tenantId: input.tenantId,
    },
    include: {
      documents: {
        orderBy: { sortOrder: 'asc' },
      },
    },
  });

  if (!envelope || envelope.status !== 'COMPLETED') {
    throw new Error('Completed package is not available yet');
  }

  const document = envelope.documents.find((entry) => entry.id === input.documentId);
  if (!document?.signedStoragePath) {
    throw new Error('Signed PDF not found');
  }

  const baseFileName = getEsigningDocumentPdfFileName(document).replace(/\.pdf$/iu, '');
  if (variant === 'signed') {
    const signed = await getCurrentDocumentArtifact(envelope.id, document.id, 'SIGNED_DOCUMENT');
    return {
      buffer: await readIssuedArtifact(signed),
      fileName: `${baseFileName}-signed.pdf`,
    };
  }

  // The stored document+certificate file; never merged on request.
  const withCertificate = await getCurrentDocumentArtifact(
    envelope.id,
    document.id,
    'DOCUMENT_WITH_CERTIFICATE',
  );
  return {
    buffer: await readIssuedArtifact(withCertificate),
    fileName: `${baseFileName}-signed-and-certificate.pdf`,
  };
}

export async function downloadEsigningDeliveryDocument(input: {
  token: string;
  documentId: string;
  variant?: 'signed' | 'certificate';
}): Promise<{
  buffer: Buffer;
  fileName: string;
}> {
  const claims = await verifyEsigningDeliveryToken(input.token);
  if (!claims) {
    throw new Error('Download link is invalid or has expired');
  }

  const envelope = await prisma.esigningEnvelope.findUnique({
    where: { id: claims.envelopeId },
    include: {
      documents: {
        orderBy: { sortOrder: 'asc' },
      },
      recipients: {
        select: {
          id: true,
        },
      },
      fieldDefinitions: {
        select: {
          documentId: true,
          recipientId: true,
        },
      },
    },
  });

  if (!envelope || envelope.status !== 'COMPLETED') {
    throw new Error('Completed package is not available');
  }

  const variant = input.variant ?? 'signed';
  await ensureEsigningEnvelopeArtifacts({
    envelopeId: envelope.id,
    requireCertificates: variant === 'certificate',
  });

  if (
    claims.actorType === 'recipient' &&
    (!claims.recipientId || !envelope.recipients.some((recipient) => recipient.id === claims.recipientId))
  ) {
    throw new Error('Download link is not valid for this recipient');
  }

  const document = envelope.documents.find((entry) => entry.id === input.documentId);
  if (!document) {
    throw new Error('Document not found');
  }

  if (
    claims.actorType === 'recipient' &&
    claims.recipientId &&
    !isEsigningDocumentVisibleToRecipient({
      metadata: envelope.metadata,
      documentId: document.id,
      recipientId: claims.recipientId,
      fieldDefinitions: envelope.fieldDefinitions,
    })
  ) {
    throw new Error('Document not found');
  }

  const buffer = await readIssuedArtifact(
    variant === 'certificate'
      ? await getCurrentCertificateArtifact(envelope.id)
      : await getCurrentDocumentArtifact(envelope.id, document.id, 'SIGNED_DOCUMENT'),
  );
  const fileName =
    variant === 'certificate'
      ? `${sanitizePdfBaseName(envelope.title)}-certificate.pdf`
      : getEsigningDocumentVariantFileName(document, 'signed');

  return { buffer, fileName };
}
