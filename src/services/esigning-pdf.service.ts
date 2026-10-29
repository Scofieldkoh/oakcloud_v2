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
import {
  buildEsigningDeliveryDownloadUrl,
  createEsigningDeliveryToken,
  verifyEsigningDeliveryToken,
} from '@/lib/esigning-session';
import { renderEsigningCertificatePdf } from '@/services/esigning-certificate-pdf.renderer';
import { sendEsigningPdfFailureEmailToSender } from '@/services/esigning-notification.service';
import {
  recordEsigningEnvelopeEmailDeliveryResults,
  withEsigningDeliveryTarget,
} from '@/services/esigning-email-delivery.service';

const PROCESSING_LEASE_MS = 15 * 60 * 1000;
const MAX_EMAIL_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const ESIGNING_ARTIFACT_VERSION = 11;

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

export async function buildEmailAttachments(input: {
  documents: Array<{
    fileName: string;
    originalFileName?: string | null;
    signedBuffer: Buffer;
    certificateBuffer?: Buffer;
  }>;
}): Promise<Array<{
  filename: string;
  content: Buffer;
  contentType: string;
}>> {
  const sourceBytes = input.documents.reduce(
    (sum, document) =>
      sum + document.signedBuffer.byteLength + (document.certificateBuffer?.byteLength ?? 0),
    0,
  );

  if (sourceBytes > MAX_EMAIL_ATTACHMENT_BYTES) {
    return [];
  }

  const attachments = await Promise.all(
    input.documents.map(async (document) => ({
      filename: getEsigningDocumentVariantFileName(document, 'signed'),
      content: document.certificateBuffer
        ? await mergePdfBuffers([document.signedBuffer, document.certificateBuffer])
        : document.signedBuffer,
      contentType: 'application/pdf',
    })),
  );
  const totalBytes = attachments.reduce((sum, attachment) => sum + attachment.content.byteLength, 0);
  if (totalBytes > MAX_EMAIL_ATTACHMENT_BYTES) {
    return [];
  }

  return attachments;
}

function sanitizePdfBaseName(value: string): string {
  return value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .slice(0, 120) || 'esigning-package';
}

function getEnvelopeArtifactVersion(metadata: Prisma.JsonValue | null | undefined): number | null {
  if (!metadata || Array.isArray(metadata) || typeof metadata !== 'object') {
    return null;
  }

  const raw = (metadata as Record<string, unknown>).artifactVersion;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

function withEnvelopeArtifactVersion(metadata: Prisma.JsonValue | null | undefined): Prisma.InputJsonValue {
  const base =
    metadata && !Array.isArray(metadata) && typeof metadata === 'object'
      ? { ...(metadata as Record<string, unknown>) }
      : {};

  return {
    ...base,
    artifactVersion: ESIGNING_ARTIFACT_VERSION,
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
export async function composeEsigningDocumentPackage(input: {
  signedBuffer: Buffer;
  certificateBuffer?: Buffer;
}): Promise<Buffer> {
  if (!input.certificateBuffer) {
    return input.signedBuffer;
  }
  return mergePdfBuffers([input.signedBuffer, input.certificateBuffer]);
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

async function generateEnvelopeArtifacts(envelopeId: string): Promise<void> {
  const envelope = await loadEnvelopeForPdf(envelopeId);

  if (envelope.status !== 'COMPLETED') {
    throw new Error('Only completed envelopes can generate signed PDFs');
  }

  const fieldValuesByDefinitionId = new Map(
    envelope.fieldValues.map((value) => [value.fieldDefinitionId, value]),
  );
  const certificateBuffer = await buildCertificatePdf({ envelope });
  const certificateStoragePath = StorageKeys.esigningEnvelopeCertificate(
    envelope.tenantId,
    envelope.id,
  );

  await storage.upload(certificateStoragePath, certificateBuffer, {
    contentType: 'application/pdf',
    metadata: {
      envelopeId: envelope.id,
      certificateId: envelope.certificateId,
    },
  });

  for (const document of envelope.documents) {
    const originalBuffer = await storage.download(document.storagePath);
    const originalPdf = await PDFDocument.load(originalBuffer);
    const font = await originalPdf.embedFont(StandardFonts.Helvetica);

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
          page.drawText(value.value, {
            x: bounds.x + 2,
            y: bounds.y + Math.max(2, bounds.height / 3),
            size: Math.max(9, Math.min(12, bounds.height * 0.65)),
            font,
            color: rgb(0.1, 0.15, 0.2),
            maxWidth: bounds.width - 4,
          });
        }
      }
    }

    const signedBuffer = Buffer.from(await originalPdf.save());
    const signedHash = hashBlake3(signedBuffer);
    const signedStoragePath = StorageKeys.esigningSignedDocument(
      envelope.tenantId,
      envelope.id,
      document.id,
    );
    await storage.upload(signedStoragePath, signedBuffer, {
      contentType: 'application/pdf',
      metadata: {
        envelopeId: envelope.id,
        documentId: document.id,
        certificateId: envelope.certificateId,
      },
    });
    await prisma.esigningEnvelopeDocument.update({
      where: { id: document.id },
      data: {
        signedStoragePath,
        signedHash,
      },
    });
  }

  await prisma.esigningEnvelope.update({
    where: { id: envelope.id },
    data: {
      pdfGenerationStatus: 'COMPLETED',
      pdfGenerationClaimedAt: null,
      pdfGenerationError: null,
      metadata: withEnvelopeArtifactVersion(envelope.metadata),
    },
  });
}

export async function ensureEsigningEnvelopeArtifacts(input: {
  envelopeId: string;
  requireCertificates?: boolean;
}): Promise<void> {
  const envelope = await prisma.esigningEnvelope.findUnique({
    where: { id: input.envelopeId },
    include: {
      documents: {
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          signedStoragePath: true,
        },
      },
    },
  });

  if (!envelope) {
    throw new Error('Envelope not found');
  }

  if (envelope.status !== 'COMPLETED') {
    throw new Error('Completed package is not available yet');
  }

  let needsGeneration = false;

  if (getEnvelopeArtifactVersion(envelope.metadata) !== ESIGNING_ARTIFACT_VERSION) {
    needsGeneration = true;
  }

  if (!needsGeneration) {
    for (const document of envelope.documents) {
      if (!document.signedStoragePath || !(await storage.exists(document.signedStoragePath))) {
        needsGeneration = true;
        break;
      }
    }

    if (
      !needsGeneration &&
      input.requireCertificates &&
      !(await storage.exists(StorageKeys.esigningEnvelopeCertificate(envelope.tenantId, envelope.id)))
    ) {
      needsGeneration = true;
    }
  }

  if (!needsGeneration) {
    if (envelope.pdfGenerationStatus !== 'COMPLETED') {
      await prisma.esigningEnvelope.update({
        where: { id: envelope.id },
        data: {
          pdfGenerationStatus: 'COMPLETED',
          pdfGenerationClaimedAt: null,
          pdfGenerationError: null,
        },
      });
    }
    return;
  }

  await prisma.esigningEnvelope.update({
    where: { id: envelope.id },
    data: {
      pdfGenerationStatus: 'PROCESSING',
      pdfGenerationClaimedAt: new Date(),
      pdfGenerationError: null,
    },
  });

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
    errorMessage: message,
  });
  await recordEsigningEnvelopeEmailDeliveryResults(envelopeId, [
    withEsigningDeliveryTarget(deliveryResult, {
      tenantId: envelope.tenantId,
      targetKey: `sender:${envelope.createdById}`,
      audience: 'SENDER',
    }),
  ]);
}

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

  const now = new Date();
  const staleBefore = new Date(now.getTime() - PROCESSING_LEASE_MS);
  const claim = await prisma.esigningEnvelope.updateMany({
    where: {
      id: input.envelopeId,
      status: 'COMPLETED',
      OR: [
        { pdfGenerationStatus: null },
        { pdfGenerationStatus: 'PENDING' },
        { pdfGenerationStatus: 'FAILED' },
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

  if (claim.count === 0) {
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
  const signedBuffers: Buffer[] = [];
  if (variant !== 'certificates') {
    for (const document of envelope.documents) {
      if (!document.signedStoragePath) {
        throw new Error('One or more generated PDFs are not available yet');
      }
      signedBuffers.push(await storage.download(document.signedStoragePath));
    }
  }

  const certificateBuffer =
    variant === 'documents'
      ? undefined
      : await storage.download(
          StorageKeys.esigningEnvelopeCertificate(envelope.tenantId, envelope.id),
        );

  const fileNameBase = sanitizePdfBaseName(envelope.title);
  const fileName =
    variant === 'certificates'
      ? `${fileNameBase}-certificate.pdf`
      : variant === 'documents'
        ? `${fileNameBase}-documents.pdf`
        : `${fileNameBase}-documents-and-certificate.pdf`;

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

  const signedBuffer = await storage.download(document.signedStoragePath);
  const baseFileName = getEsigningDocumentPdfFileName(document).replace(/\.pdf$/iu, '');
  if (variant === 'signed') {
    return {
      buffer: signedBuffer,
      fileName: `${baseFileName}-signed.pdf`,
    };
  }

  const certificateBuffer = await storage.download(
    StorageKeys.esigningEnvelopeCertificate(envelope.tenantId, envelope.id),
  );
  return {
    buffer: await composeEsigningDocumentPackage({
      signedBuffer,
      certificateBuffer,
    }),
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

  const storagePath =
    variant === 'certificate'
      ? StorageKeys.esigningEnvelopeCertificate(envelope.tenantId, envelope.id)
      : document.signedStoragePath;

  if (!storagePath) {
    throw new Error('Document is not available');
  }

  const buffer = await storage.download(storagePath);
  const fileName =
    variant === 'certificate'
      ? `${sanitizePdfBaseName(envelope.title)}-certificate.pdf`
      : getEsigningDocumentVariantFileName(document, 'signed');

  return { buffer, fileName };
}
