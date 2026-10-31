import { PDFDocument } from 'pdf-lib';
import type { EsigningIssuedArtifactKind, Prisma } from '@/generated/prisma';
import { prisma } from '@/lib/prisma';
import { hashBlake3 } from '@/lib/encryption';
import { createLogger } from '@/lib/logger';
import { storage, StorageKeys } from '@/lib/storage';

/**
 * Issued artifacts (OAK-008 / OAK-021).
 *
 * Every PDF we hand out for a completed envelope is recorded here with the BLAKE3 hash of the exact
 * bytes: the signed document, the certificate, and the signed document with the certificate appended
 * (the file that is emailed and filed). The merged file is built once at generation time and stored,
 * so every send, filing and download serves the same bytes and the public check can recognise them.
 *
 * Rows and files are append-only. A regeneration writes version n+1 under its own `v{n+1}/` storage
 * folder and moves the envelope pointers in one transaction; earlier rows and files are not touched.
 */

const log = createLogger('esigning-issued-artifacts');

/** Recorded on each row so it is clear which renderer produced the bytes. Not used to trigger regeneration. */
export const ESIGNING_RENDERER_VERSION = 12;

/** Prefix of `pdfGenerationError` for a source-digest failure; lets lazy callers avoid retrying it. */
export const SOURCE_DIGEST_MISMATCH_PREFIX = '[SOURCE_DIGEST_MISMATCH]';

export type IssuedArtifactKind = EsigningIssuedArtifactKind;

export type EsigningArtifactErrorCode =
  | 'SOURCE_DIGEST_MISMATCH'
  | 'ARTIFACT_HASH_MISMATCH'
  | 'ARTIFACT_NOT_FOUND'
  | 'ARTIFACTS_PROCESSING';

/** Typed failure so callers do not have to classify by message text. */
export class EsigningArtifactError extends Error {
  readonly code: EsigningArtifactErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: EsigningArtifactErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'EsigningArtifactError';
    this.code = code;
    this.details = details;
  }
}

export interface IssuedArtifactRecord {
  id: string;
  tenantId: string;
  envelopeId: string;
  documentId: string | null;
  version: number;
  kind: IssuedArtifactKind;
  storagePath: string;
  blake3: string;
  byteSize: number | null;
  rendererVersion: number;
  sourceDigests: Prisma.JsonValue;
  createdAt: Date;
}

export interface IssuedVersionSnapshot {
  version: number;
  certificate: IssuedArtifactRecord | null;
  signedByDocumentId: Map<string, IssuedArtifactRecord>;
  withCertificateByDocumentId: Map<string, IssuedArtifactRecord>;
}

export interface NewIssuedArtifact {
  documentId: string | null;
  kind: IssuedArtifactKind;
  storagePath: string;
  blake3: string;
  byteSize: number | null;
  sourceDigests: Prisma.InputJsonValue;
}

export function formatSourceDigestMismatchMessage(fileName: string): string {
  return `${SOURCE_DIGEST_MISMATCH_PREFIX} The original of "${fileName}" no longer matches the digest recorded when it was uploaded, so the signed PDF was not generated.`;
}

export function isSourceDigestMismatchMessage(message: string | null | undefined): boolean {
  return Boolean(message?.startsWith(SOURCE_DIGEST_MISMATCH_PREFIX));
}

/**
 * Merge PDFs without anything that varies between runs (no "now" timestamps, fixed producer), so the
 * same inputs always produce the same bytes. That makes a duplicated backfill harmless.
 */
export async function mergeIssuedPdfs(buffers: Uint8Array[], issuedAt: Date): Promise<Buffer> {
  const merged = await PDFDocument.create({ updateMetadata: false });
  for (const buffer of buffers) {
    const source = await PDFDocument.load(new Uint8Array(buffer), { updateMetadata: false });
    const pages = await merged.copyPages(source, source.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
  }
  merged.setProducer('OakCloud e-Sign');
  merged.setCreator('OakCloud e-Sign');
  merged.setCreationDate(issuedAt);
  merged.setModificationDate(issuedAt);
  return Buffer.from(await merged.save());
}

export async function loadIssuedVersion(
  envelopeId: string,
  version: number,
): Promise<IssuedVersionSnapshot> {
  const rows = await prisma.esigningIssuedArtifact.findMany({
    where: { envelopeId, version },
    orderBy: { createdAt: 'asc' },
  });
  const snapshot: IssuedVersionSnapshot = {
    version,
    certificate: null,
    signedByDocumentId: new Map(),
    withCertificateByDocumentId: new Map(),
  };
  for (const row of rows) {
    if (row.kind === 'CERTIFICATE') {
      snapshot.certificate = row;
    } else if (row.kind === 'SIGNED_DOCUMENT' && row.documentId) {
      snapshot.signedByDocumentId.set(row.documentId, row);
    } else if (row.kind === 'DOCUMENT_WITH_CERTIFICATE' && row.documentId) {
      snapshot.withCertificateByDocumentId.set(row.documentId, row);
    }
  }
  return snapshot;
}

/** The artifacts of the envelope's current version, or null when nothing has been issued. */
export async function getCurrentIssuedVersion(envelopeId: string): Promise<IssuedVersionSnapshot | null> {
  const envelope = await prisma.esigningEnvelope.findUnique({
    where: { id: envelopeId },
    select: { currentArtifactVersion: true },
  });
  if (!envelope || envelope.currentArtifactVersion == null) {
    return null;
  }
  return loadIssuedVersion(envelopeId, envelope.currentArtifactVersion);
}

/**
 * Read an issued file and check it against the hash recorded when it was issued. A mismatch means the
 * stored object changed after issue; it is reported, never silently served or regenerated.
 */
export async function readIssuedArtifact(record: IssuedArtifactRecord): Promise<Buffer> {
  const buffer = await storage.download(record.storagePath);
  const actual = hashBlake3(buffer);
  if (actual !== record.blake3) {
    throw new EsigningArtifactError(
      'ARTIFACT_HASH_MISMATCH',
      `Stored ${record.kind.toLowerCase().replace(/_/g, ' ')} (version ${record.version}) no longer matches the hash recorded when it was issued`,
      { artifactId: record.id, expected: record.blake3, actual },
    );
  }
  return buffer;
}

function requireRecord<T extends IssuedArtifactRecord | null | undefined>(
  record: T,
  description: string,
): NonNullable<T> {
  if (!record) {
    throw new EsigningArtifactError('ARTIFACT_NOT_FOUND', `${description} has not been issued yet`);
  }
  return record as NonNullable<T>;
}

export async function getCurrentCertificateArtifact(envelopeId: string): Promise<IssuedArtifactRecord> {
  const version = await getCurrentIssuedVersion(envelopeId);
  return requireRecord(version?.certificate, 'The completion certificate');
}

export async function getCurrentDocumentArtifact(
  envelopeId: string,
  documentId: string,
  kind: 'SIGNED_DOCUMENT' | 'DOCUMENT_WITH_CERTIFICATE',
): Promise<IssuedArtifactRecord> {
  const version = await getCurrentIssuedVersion(envelopeId);
  const record =
    kind === 'SIGNED_DOCUMENT'
      ? version?.signedByDocumentId.get(documentId)
      : version?.withCertificateByDocumentId.get(documentId);
  return requireRecord(
    record,
    kind === 'SIGNED_DOCUMENT' ? 'The signed document' : 'The signed document with its certificate',
  );
}

export function buildSourceDigests(input: {
  originalHashes: Record<string, string>;
  certificateBlake3?: string;
  signedBlake3?: string;
  extra?: Record<string, Prisma.InputJsonValue>;
}): Prisma.InputJsonValue {
  return {
    originalHashes: input.originalHashes,
    ...(input.certificateBlake3 ? { certificateBlake3: input.certificateBlake3 } : {}),
    ...(input.signedBlake3 ? { signedBlake3: input.signedBlake3 } : {}),
    ...(input.extra ?? {}),
  };
}

/**
 * Insert a new version and move the envelope pointers, in one transaction. Files must already be
 * uploaded. The unique (envelopeId, version, kind, document) index makes a competing writer fail
 * rather than overwrite.
 */
export async function persistIssuedVersion(input: {
  tenantId: string;
  envelopeId: string;
  version: number;
  rendererVersion: number;
  artifacts: NewIssuedArtifact[];
  envelopeMetadata: Prisma.InputJsonValue;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.esigningIssuedArtifact.createMany({
      data: input.artifacts.map((artifact) => ({
        tenantId: input.tenantId,
        envelopeId: input.envelopeId,
        documentId: artifact.documentId,
        version: input.version,
        kind: artifact.kind,
        storagePath: artifact.storagePath,
        blake3: artifact.blake3,
        byteSize: artifact.byteSize,
        rendererVersion: input.rendererVersion,
        sourceDigests: artifact.sourceDigests,
      })),
    });

    for (const artifact of input.artifacts) {
      if (artifact.kind === 'SIGNED_DOCUMENT' && artifact.documentId) {
        await tx.esigningEnvelopeDocument.update({
          where: { id: artifact.documentId },
          data: { signedStoragePath: artifact.storagePath, signedHash: artifact.blake3 },
        });
      }
    }

    await tx.esigningEnvelope.update({
      where: { id: input.envelopeId },
      data: {
        currentArtifactVersion: input.version,
        pdfGenerationStatus: 'COMPLETED',
        pdfGenerationClaimedAt: null,
        pdfGenerationError: null,
        metadata: input.envelopeMetadata,
      },
    });
  });
}

export type CurrentVersionState = 'ready' | 'regenerate';

/**
 * Decide whether the current issued version can be served as it is.
 *
 * `regenerate` only when nothing has been issued, or a file of the current version is gone from
 * storage. A different renderer version is deliberately not a reason: issued means immutable.
 * For a version-1 envelope that predates the certificate/merged rows, the certificate and merged
 * files are backfilled here (once, from the stored legacy certificate) instead of re-rendering.
 */
export async function inspectCurrentIssuedVersion(input: {
  envelopeId: string;
  requireCertificates: boolean;
}): Promise<CurrentVersionState> {
  const envelope = await prisma.esigningEnvelope.findUnique({
    where: { id: input.envelopeId },
    select: {
      id: true,
      currentArtifactVersion: true,
      documents: { select: { id: true } },
    },
  });
  if (!envelope || envelope.currentArtifactVersion == null) {
    return 'regenerate';
  }

  let version = await loadIssuedVersion(envelope.id, envelope.currentArtifactVersion);

  for (const document of envelope.documents) {
    const signed = version.signedByDocumentId.get(document.id);
    if (!signed || !(await storage.exists(signed.storagePath))) {
      return 'regenerate';
    }
  }

  if (!input.requireCertificates) {
    return 'ready';
  }

  const hasEveryCertificateRow =
    Boolean(version.certificate) &&
    envelope.documents.every((document) => version.withCertificateByDocumentId.has(document.id));

  if (!hasEveryCertificateRow) {
    const outcome = await backfillLegacyCertificateArtifacts(envelope.id);
    if (outcome === 'legacy-certificate-missing') {
      return 'regenerate';
    }
    version = await loadIssuedVersion(envelope.id, envelope.currentArtifactVersion);
  }

  const files = [
    version.certificate,
    ...envelope.documents.map((document) => version.withCertificateByDocumentId.get(document.id)),
  ];
  for (const file of files) {
    if (!file || !(await storage.exists(file.storagePath))) {
      return 'regenerate';
    }
  }
  return 'ready';
}

/**
 * Version 1 of an envelope completed before this feature has signed-document rows (from the
 * migration) but no certificate or merged rows. Hash the stored certificate, merge once, store the
 * merged files under the v1 paths and add the rows. Nothing is re-rendered, so the certificate and
 * signed documents are exactly the ones issued earlier. Copies emailed before this release were never
 * fingerprinted and still cannot be verified.
 */
export async function backfillLegacyCertificateArtifacts(
  envelopeId: string,
): Promise<'backfilled' | 'legacy-certificate-missing'> {
  const envelope = await prisma.esigningEnvelope.findUniqueOrThrow({
    where: { id: envelopeId },
    select: {
      id: true,
      tenantId: true,
      createdAt: true,
      completedAt: true,
      currentArtifactVersion: true,
      documents: { orderBy: { sortOrder: 'asc' }, select: { id: true, originalHash: true } },
    },
  });
  const version = envelope.currentArtifactVersion;
  if (version == null) {
    throw new EsigningArtifactError('ARTIFACT_NOT_FOUND', 'The envelope has no issued version to backfill');
  }

  const existing = await loadIssuedVersion(envelope.id, version);
  const certificatePath = StorageKeys.esigningEnvelopeCertificate(envelope.tenantId, envelope.id);
  const certificateRecord = existing.certificate;
  let certificateBuffer: Buffer;

  if (certificateRecord) {
    if (!(await storage.exists(certificateRecord.storagePath))) {
      return 'legacy-certificate-missing';
    }
    certificateBuffer = await readIssuedArtifact(certificateRecord);
  } else {
    if (!(await storage.exists(certificatePath))) {
      return 'legacy-certificate-missing';
    }
    certificateBuffer = await storage.download(certificatePath);
  }

  const certificateBlake3 = certificateRecord?.blake3 ?? hashBlake3(certificateBuffer);
  const originalHashes = Object.fromEntries(
    envelope.documents.map((document) => [document.id, document.originalHash]),
  );
  const firstSigned = envelope.documents
    .map((document) => existing.signedByDocumentId.get(document.id))
    .find(Boolean);
  const rendererVersion = firstSigned?.rendererVersion ?? 0;
  const backfillMarker = { backfilled: true, origin: 'first-delivery' } as const;
  const issuedAt = envelope.completedAt ?? envelope.createdAt;

  const newRows: Array<NewIssuedArtifact> = [];
  if (!certificateRecord) {
    newRows.push({
      documentId: null,
      kind: 'CERTIFICATE',
      // The certificate stays where it was written; only the merged files get new keys.
      storagePath: certificatePath,
      blake3: certificateBlake3,
      byteSize: certificateBuffer.byteLength,
      sourceDigests: buildSourceDigests({ originalHashes, extra: backfillMarker }),
    });
  }

  for (const document of envelope.documents) {
    if (existing.withCertificateByDocumentId.has(document.id)) {
      continue;
    }
    const signedRecord = requireRecord(
      existing.signedByDocumentId.get(document.id),
      'The signed document',
    );
    const signedBuffer = await readIssuedArtifact(signedRecord);
    const merged = await mergeIssuedPdfs([signedBuffer, certificateBuffer], issuedAt);
    const storagePath = StorageKeys.esigningIssuedDocumentWithCertificate(
      envelope.tenantId,
      envelope.id,
      version,
      document.id,
    );
    await storage.upload(storagePath, merged, {
      contentType: 'application/pdf',
      metadata: { envelopeId: envelope.id, documentId: document.id, version: String(version) },
    });
    newRows.push({
      documentId: document.id,
      kind: 'DOCUMENT_WITH_CERTIFICATE',
      storagePath,
      blake3: hashBlake3(merged),
      byteSize: merged.byteLength,
      sourceDigests: buildSourceDigests({
        originalHashes,
        certificateBlake3,
        signedBlake3: signedRecord.blake3,
        extra: backfillMarker,
      }),
    });
  }

  if (newRows.length > 0) {
    // skipDuplicates: a concurrent backfill produced identical rows (the merge is deterministic).
    await prisma.esigningIssuedArtifact.createMany({
      data: newRows.map((row) => ({
        tenantId: envelope.tenantId,
        envelopeId: envelope.id,
        documentId: row.documentId,
        version,
        kind: row.kind,
        storagePath: row.storagePath,
        blake3: row.blake3,
        byteSize: row.byteSize,
        rendererVersion,
        sourceDigests: row.sourceDigests,
      })),
      skipDuplicates: true,
    });
    log.info('Backfilled certificate artifacts for a version-1 envelope', {
      envelopeId: envelope.id,
      rows: newRows.length,
    });
  }

  return 'backfilled';
}
