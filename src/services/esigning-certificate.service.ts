import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import { hashBlake3, hashSha256 } from '@/lib/encryption';
import { NotFoundError } from '@/lib/errors';
import type { EsigningIssuedArtifactKind as IssuedArtifactKind } from '@/generated/prisma';
import {
  buildEsigningEventLabel,
  formatEsigningAccessModeLabel,
  isEsigningPositiveEvent,
  summarizeEsigningUserAgent,
} from '@/services/esigning-evidence';

function formatCertificateDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function randomSuffix(length: number = 6): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let output = '';

  for (let index = 0; index < length; index += 1) {
    output += alphabet[Math.floor(Math.random() * alphabet.length)];
  }

  return output;
}

export async function generateUniqueEsigningCertificateId(): Promise<string> {
  const dateSegment = formatCertificateDate(new Date());

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const certificateId = `OAK-ES-${dateSegment}-${randomSuffix()}`;
    const existing = await prisma.esigningEnvelope.findUnique({
      where: { certificateId },
      select: { id: true },
    });

    if (!existing) {
      return certificateId;
    }
  }

  return `OAK-ES-${dateSegment}-${hashSha256(randomUUID()).slice(0, 8).toUpperCase()}`;
}

export async function getEsigningVerificationData(certificateId: string) {
  const envelope = await prisma.esigningEnvelope.findUnique({
    where: { certificateId },
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
      documents: {
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          fileName: true,
          signedHash: true,
          originalHash: true,
          signedStoragePath: true,
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
          accessMode: true,
          signingOrder: true,
          viewedAt: true,
          consentedAt: true,
          consentIp: true,
          consentUserAgent: true,
          signedAt: true,
          signedIp: true,
          signedUserAgent: true,
        },
      },
      events: {
        orderBy: { createdAt: 'asc' },
        include: {
          recipient: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      },
    },
  });

  if (!envelope) {
    throw new Error('Certificate not found');
  }

  // Copies emailed before issued artifacts were recorded were never fingerprinted. Rows created by the
  // migration or the first-delivery backfill carry a "backfilled" marker.
  const legacyIssuedCopies =
    (await prisma.esigningIssuedArtifact.count({
      where: {
        envelopeId: envelope.id,
        sourceDigests: { path: ['backfilled'], equals: true },
      },
    })) > 0;

  return {
    certificateId: envelope.certificateId,
    envelopeId: envelope.id,
    title: envelope.title,
    status: envelope.status,
    completedAt: envelope.completedAt?.toISOString() ?? null,
    tenantName: envelope.tenant.name,
    companyName: envelope.company?.name ?? null,
    // The public list shows only the current hash of each document, never earlier versions.
    documents: envelope.documents.map((document) => ({
      id: document.id,
      fileName: document.fileName,
      hash: document.signedHash ?? document.originalHash,
      hasSignedCopy: Boolean(document.signedStoragePath),
    })),
    /** False when this envelope completed before issued copies were fingerprinted. */
    emailedCopiesVerifiable: !legacyIssuedCopies,
    recipients: envelope.recipients.map((recipient) => ({
      id: recipient.id,
      name: recipient.name,
      emailMasked: maskEmailAddress(recipient.email),
      type: recipient.type,
      status: recipient.status,
      accessMode: recipient.accessMode,
      accessModeLabel: formatEsigningAccessModeLabel(recipient.accessMode),
      signingOrder: recipient.signingOrder,
      viewedAt: recipient.viewedAt?.toISOString() ?? null,
      consentedAt: recipient.consentedAt?.toISOString() ?? null,
      consentIp: recipient.consentIp ?? null,
      consentDevice: summarizeEsigningUserAgent(recipient.consentUserAgent),
      signedAt: recipient.signedAt?.toISOString() ?? null,
      signedIp: recipient.signedIp ?? null,
      signedDevice: summarizeEsigningUserAgent(recipient.signedUserAgent),
    })),
    events: envelope.events.map((event) => ({
      id: event.id,
      timestamp: event.createdAt.toISOString(),
      action: event.action,
      label: buildEsigningEventLabel({
        action: event.action,
        recipientName: event.recipient?.name ?? null,
      }),
      recipientId: event.recipient?.id ?? null,
      recipientName: event.recipient?.name ?? null,
      isPositive: isEsigningPositiveEvent(event.action),
    })),
  };
}

function maskEmailAddress(email: string | null): string | null {
  if (!email) {
    return null;
  }

  const [localPart, domainPart] = email.split('@');
  if (!localPart || !domainPart) {
    return email;
  }

  const visibleLocal = localPart.length <= 1
    ? localPart
    : `${localPart[0]}${'*'.repeat(Math.max(1, localPart.length - 1))}`;

  return `${visibleLocal}@${domainPart}`;
}

export interface IssuedArtifactMatch {
  matched: boolean;
  /** BLAKE3 of the uploaded file. */
  fileHash: string;
  documentId: string | null;
  artifact: {
    kind: IssuedArtifactKind | null;
    version: number | null;
    issuedAt: string;
    isCurrent: boolean;
    /** `SHAREPOINT_FILING_RECORD`: a file filed before issued artifacts were recorded, matched by SHA-256. */
    source: 'ISSUED_ARTIFACT' | 'SHAREPOINT_FILING_RECORD';
  } | null;
}

/**
 * Compare an uploaded file with everything issued for the certificate: every version and kind of
 * issued artifact (by BLAKE3), and then, for files filed to SharePoint before artifacts were
 * recorded, the SHA-256 kept on the completed filing. It reports a match for an earlier version too;
 * `isCurrent` says whether it is the version currently served.
 */
export async function findIssuedArtifactMatch(
  certificateId: string,
  buffer: Buffer,
): Promise<IssuedArtifactMatch> {
  const envelope = await prisma.esigningEnvelope.findUnique({
    where: { certificateId },
    select: { id: true, currentArtifactVersion: true },
  });
  if (!envelope) {
    throw new NotFoundError('Certificate not found');
  }

  const fileHash = hashBlake3(buffer);
  const rows = await prisma.esigningIssuedArtifact.findMany({
    where: { envelopeId: envelope.id, blake3: fileHash },
    orderBy: [{ version: 'desc' }, { createdAt: 'asc' }],
  });
  const match =
    rows.find((row) => row.version === envelope.currentArtifactVersion) ?? rows[0] ?? null;
  if (match) {
    return {
      matched: true,
      fileHash,
      documentId: match.documentId,
      artifact: {
        kind: match.kind,
        version: match.version,
        issuedAt: match.createdAt.toISOString(),
        isCurrent: match.version === envelope.currentArtifactVersion,
        source: 'ISSUED_ARTIFACT',
      },
    };
  }

  const filing = await prisma.esigningSharePointFiling.findFirst({
    where: {
      envelopeId: envelope.id,
      status: 'COMPLETED',
      sourceSignedHash: hashSha256(buffer),
    },
    select: { envelopeDocumentId: true, filedAt: true, updatedAt: true },
  });
  if (filing) {
    return {
      matched: true,
      fileHash,
      documentId: filing.envelopeDocumentId,
      artifact: {
        kind: 'DOCUMENT_WITH_CERTIFICATE',
        version: null,
        issuedAt: (filing.filedAt ?? filing.updatedAt).toISOString(),
        isCurrent: false,
        source: 'SHAREPOINT_FILING_RECORD',
      },
    };
  }

  return { matched: false, fileHash, documentId: null, artifact: null };
}
