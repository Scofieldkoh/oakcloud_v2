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
 * Rows and files are append-only. A regeneration writes version n+1 under its own `v{n+1}/{attempt}/`
 * storage folder and moves the envelope pointers in one transaction; earlier rows and files are not
 * touched. The attempt folder is unique to one generation attempt, and the publishing transaction is
 * fenced by the generation claim, so a worker whose lease expired can neither overwrite a file another
 * worker published nor change the envelope the replacement worker completed.
 *
 * Every read and write here is scoped by `tenantId`; callers pass the tenant they were authorised for
 * (the public certificate lookup is the one place that discovers it, from the certificate id).
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
  | 'ARTIFACTS_PROCESSING'
  | 'ARTIFACT_CLAIM_LOST'
  | 'ENVELOPE_NOT_FOUND';

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
  /** Multi-document envelopes only: the stored "Download all" package without the certificate. */
  packageDocuments: IssuedArtifactRecord | null;
  /** Multi-document envelopes only: the stored "Download all" package with the certificate. */
  packageWithCertificate: IssuedArtifactRecord | null;
}

/** Which of the derived files (beyond the signed documents) the caller is about to serve. */
export interface IssuedNeeds {
  certificates: boolean;
  packageDocuments: boolean;
  packageWithCertificate: boolean;
}

export type IssuedPackageVariant = 'documents' | 'documents_with_certificates';

export function issuedNeedsFor(input: {
  requireCertificates?: boolean;
  requirePackage?: IssuedPackageVariant | null;
}): IssuedNeeds {
  return {
    certificates: Boolean(input.requireCertificates) || input.requirePackage === 'documents_with_certificates',
    packageDocuments: input.requirePackage === 'documents',
    packageWithCertificate: input.requirePackage === 'documents_with_certificates',
  };
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
  tenantId: string,
  envelopeId: string,
  version: number,
): Promise<IssuedVersionSnapshot> {
  const rows = await prisma.esigningIssuedArtifact.findMany({
    where: { tenantId, envelopeId, version },
    orderBy: { createdAt: 'asc' },
  });
  const snapshot: IssuedVersionSnapshot = {
    version,
    certificate: null,
    signedByDocumentId: new Map(),
    withCertificateByDocumentId: new Map(),
    packageDocuments: null,
    packageWithCertificate: null,
  };
  for (const row of rows) {
    if (row.kind === 'CERTIFICATE') {
      snapshot.certificate = row;
    } else if (row.kind === 'PACKAGE_DOCUMENTS') {
      snapshot.packageDocuments = row;
    } else if (row.kind === 'PACKAGE_DOCUMENTS_WITH_CERTIFICATE') {
      snapshot.packageWithCertificate = row;
    } else if (row.kind === 'SIGNED_DOCUMENT' && row.documentId) {
      snapshot.signedByDocumentId.set(row.documentId, row);
    } else if (row.kind === 'DOCUMENT_WITH_CERTIFICATE' && row.documentId) {
      snapshot.withCertificateByDocumentId.set(row.documentId, row);
    }
  }
  return snapshot;
}

/** The artifacts of the envelope's current version, or null when nothing has been issued. */
export async function getCurrentIssuedVersion(
  tenantId: string,
  envelopeId: string,
): Promise<IssuedVersionSnapshot | null> {
  const envelope = await prisma.esigningEnvelope.findFirst({
    where: { id: envelopeId, tenantId },
    select: { currentArtifactVersion: true },
  });
  if (!envelope || envelope.currentArtifactVersion == null) {
    return null;
  }
  return loadIssuedVersion(tenantId, envelopeId, envelope.currentArtifactVersion);
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

export async function getCurrentCertificateArtifact(
  tenantId: string,
  envelopeId: string,
): Promise<IssuedArtifactRecord> {
  const version = await getCurrentIssuedVersion(tenantId, envelopeId);
  return requireRecord(version?.certificate, 'The completion certificate');
}

export async function getCurrentDocumentArtifact(
  tenantId: string,
  envelopeId: string,
  documentId: string,
  kind: 'SIGNED_DOCUMENT' | 'DOCUMENT_WITH_CERTIFICATE',
): Promise<IssuedArtifactRecord> {
  const version = await getCurrentIssuedVersion(tenantId, envelopeId);
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
 * uploaded (under this attempt's own folder).
 *
 * The first statement is a fence: it only matches while the envelope is still PROCESSING under the
 * claim this attempt took (`claimId`, a unique value, never the lease time) and still at the version it started from. A worker whose
 * lease expired and was replaced matches nothing, so it throws `ARTIFACT_CLAIM_LOST` and changes
 * nothing. The unique (envelope, version, kind, document) index is the second line of defence.
 */
export async function persistIssuedVersion(input: {
  tenantId: string;
  envelopeId: string;
  version: number;
  /** The envelope's `currentArtifactVersion` when this attempt started. */
  previousVersion: number | null;
  /** The unique `pdfGenerationClaimId` this attempt wrote when it took the claim. */
  claimId: string;
  rendererVersion: number;
  artifacts: NewIssuedArtifact[];
  envelopeMetadata: Prisma.InputJsonValue;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const fenced = await tx.esigningEnvelope.updateMany({
      where: {
        id: input.envelopeId,
        tenantId: input.tenantId,
        status: 'COMPLETED',
        pdfGenerationStatus: 'PROCESSING',
        pdfGenerationClaimId: input.claimId,
        currentArtifactVersion: input.previousVersion,
      },
      data: {
        currentArtifactVersion: input.version,
        pdfGenerationStatus: 'COMPLETED',
        pdfGenerationClaimedAt: null,
        pdfGenerationClaimId: null,
        pdfGenerationError: null,
        metadata: input.envelopeMetadata,
      },
    });
    if (fenced.count !== 1) {
      throw new EsigningArtifactError(
        'ARTIFACT_CLAIM_LOST',
        'This generation no longer holds the envelope claim; its result was discarded',
        { envelopeId: input.envelopeId, version: input.version },
      );
    }

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
        await tx.esigningEnvelopeDocument.updateMany({
          where: { id: artifact.documentId, envelopeId: input.envelopeId, tenantId: input.tenantId },
          data: { signedStoragePath: artifact.storagePath, signedHash: artifact.blake3 },
        });
      }
    }
  });
}

/**
 * Delete files a generation attempt uploaded but did not publish. The paths are unique to the
 * attempt, so nothing another worker published can be affected; as a guard against an ambiguous
 * commit, a path that some row references is never deleted. Best effort: an orphaned object is
 * unreferenced and harmless.
 */
export async function discardUnpublishedFiles(input: {
  tenantId: string;
  envelopeId: string;
  paths: string[];
}): Promise<void> {
  if (input.paths.length === 0) return;
  try {
    const referenced = await prisma.esigningIssuedArtifact.findMany({
      where: { tenantId: input.tenantId, envelopeId: input.envelopeId, storagePath: { in: input.paths } },
      select: { storagePath: true },
    });
    const keep = new Set(referenced.map((row) => row.storagePath));
    for (const path of input.paths) {
      if (keep.has(path)) continue;
      try {
        await storage.delete(path);
      } catch (error) {
        log.warn('Could not delete an unpublished issued file', { envelopeId: input.envelopeId, path, error });
      }
    }
  } catch (error) {
    log.warn('Could not clean up unpublished issued files', { envelopeId: input.envelopeId, error });
  }
}

export type CurrentVersionState = 'ready' | 'regenerate';

/**
 * Decide whether the current issued version can be served as it is.
 *
 * `regenerate` only when nothing has been issued, or a file of the current version is gone from
 * storage. A different renderer version is deliberately not a reason: issued means immutable.
 * For an envelope that predates the certificate, merged or package rows, the missing derived files
 * are backfilled here (once, from the stored signed documents and certificate) instead of re-rendering.
 */
export async function inspectCurrentIssuedVersion(input: {
  tenantId: string;
  envelopeId: string;
  needs: IssuedNeeds;
}): Promise<CurrentVersionState> {
  const envelope = await prisma.esigningEnvelope.findFirst({
    where: { id: input.envelopeId, tenantId: input.tenantId },
    select: {
      id: true,
      currentArtifactVersion: true,
      documents: { select: { id: true } },
    },
  });
  if (!envelope) {
    throw new EsigningArtifactError('ENVELOPE_NOT_FOUND', 'Envelope not found');
  }
  if (envelope.currentArtifactVersion == null) {
    return 'regenerate';
  }

  const { needs } = input;
  const multiDocument = envelope.documents.length > 1;
  const needPackageDocuments = multiDocument && needs.packageDocuments;
  const needPackageWithCertificate = multiDocument && needs.packageWithCertificate;

  let version = await loadIssuedVersion(input.tenantId, envelope.id, envelope.currentArtifactVersion);

  for (const document of envelope.documents) {
    const signed = version.signedByDocumentId.get(document.id);
    if (!signed || !(await storage.exists(signed.storagePath))) {
      return 'regenerate';
    }
  }

  if (!needs.certificates && !needPackageDocuments && !needPackageWithCertificate) {
    return 'ready';
  }

  const hasEveryRow =
    (!needs.certificates ||
      (Boolean(version.certificate) &&
        envelope.documents.every((document) => version.withCertificateByDocumentId.has(document.id)))) &&
    (!needPackageDocuments || Boolean(version.packageDocuments)) &&
    (!needPackageWithCertificate || Boolean(version.packageWithCertificate));

  if (!hasEveryRow) {
    const outcome = await backfillLegacyCertificateArtifacts(input.tenantId, envelope.id, {
      certificates: needs.certificates,
      packageDocuments: needPackageDocuments,
      packageWithCertificate: needPackageWithCertificate,
    });
    if (outcome === 'legacy-certificate-missing') {
      return 'regenerate';
    }
    version = await loadIssuedVersion(input.tenantId, envelope.id, envelope.currentArtifactVersion);
  }

  const files = [
    ...(needs.certificates
      ? [version.certificate, ...envelope.documents.map((document) => version.withCertificateByDocumentId.get(document.id))]
      : []),
    ...(needPackageDocuments ? [version.packageDocuments] : []),
    ...(needPackageWithCertificate ? [version.packageWithCertificate] : []),
  ];
  for (const file of files) {
    if (!file || !(await storage.exists(file.storagePath))) {
      return 'regenerate';
    }
  }
  return 'ready';
}

/**
 * Write a backfilled file to its deterministic key. The merge is deterministic, so a concurrent
 * backfill produces the same bytes; an object already there is left alone when it is identical and
 * is an error when it is not (it is never overwritten).
 */
async function putDeterministicFile(
  path: string,
  content: Buffer,
  metadata: Record<string, string>,
): Promise<void> {
  if (await storage.exists(path)) {
    const existing = await storage.download(path);
    if (hashBlake3(existing) === hashBlake3(content)) {
      return;
    }
    throw new EsigningArtifactError(
      'ARTIFACT_HASH_MISMATCH',
      'A different file already exists where a backfilled issued file would be written',
      { path },
    );
  }
  await storage.upload(path, content, { contentType: 'application/pdf', metadata });
}

/**
 * An envelope completed before this feature has signed-document rows (from the migration) but no
 * certificate, merged or package rows. Hash the stored certificate, merge once, store the merged files
 * under the deterministic keys of the current version and add the rows. Nothing is re-rendered, so the
 * certificate and signed documents are exactly the ones issued earlier. Copies emailed before this
 * release were never fingerprinted and still cannot be verified.
 */
export async function backfillLegacyCertificateArtifacts(
  tenantId: string,
  envelopeId: string,
  needs: IssuedNeeds = { certificates: true, packageDocuments: false, packageWithCertificate: false },
): Promise<'backfilled' | 'legacy-certificate-missing'> {
  const envelope = await prisma.esigningEnvelope.findFirstOrThrow({
    where: { id: envelopeId, tenantId },
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

  const existing = await loadIssuedVersion(envelope.tenantId, envelope.id, version);
  const multiDocument = envelope.documents.length > 1;
  const wantPackageDocuments = multiDocument && needs.packageDocuments && !existing.packageDocuments;
  const wantPackageWithCertificate =
    multiDocument && needs.packageWithCertificate && !existing.packageWithCertificate;
  const needCertificate = needs.certificates || wantPackageWithCertificate;

  const certificatePath = StorageKeys.esigningEnvelopeCertificate(envelope.tenantId, envelope.id);
  const certificateRecord = existing.certificate;
  let certificateBuffer: Buffer | null = null;

  if (needCertificate) {
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
  }

  const certificateBlake3 =
    certificateRecord?.blake3 ?? (certificateBuffer ? hashBlake3(certificateBuffer) : undefined);
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
  if (needs.certificates && !certificateRecord && certificateBuffer) {
    newRows.push({
      documentId: null,
      kind: 'CERTIFICATE',
      // The certificate stays where it was written; only the merged files get new keys.
      storagePath: certificatePath,
      blake3: hashBlake3(certificateBuffer),
      byteSize: certificateBuffer.byteLength,
      sourceDigests: buildSourceDigests({ originalHashes, extra: backfillMarker }),
    });
  }

  const signedBuffers: Buffer[] = [];
  const signedBlake3s: string[] = [];
  for (const document of envelope.documents) {
    const signedRecord = requireRecord(
      existing.signedByDocumentId.get(document.id),
      'The signed document',
    );
    const needMerged = needs.certificates && !existing.withCertificateByDocumentId.has(document.id);
    if (!needMerged && !wantPackageDocuments && !wantPackageWithCertificate) {
      continue;
    }
    const signedBuffer = await readIssuedArtifact(signedRecord);
    signedBuffers.push(signedBuffer);
    signedBlake3s.push(signedRecord.blake3);
    if (!needMerged) {
      continue;
    }
    const merged = await mergeIssuedPdfs([signedBuffer, certificateBuffer as Buffer], issuedAt);
    const storagePath = StorageKeys.esigningIssuedDocumentWithCertificate(
      envelope.tenantId,
      envelope.id,
      version,
      document.id,
    );
    await putDeterministicFile(storagePath, merged, {
      envelopeId: envelope.id,
      documentId: document.id,
      version: String(version),
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

  if (wantPackageDocuments) {
    const merged = await mergeIssuedPdfs(signedBuffers, issuedAt);
    const storagePath = StorageKeys.esigningIssuedPackage(envelope.tenantId, envelope.id, version, 'documents');
    await putDeterministicFile(storagePath, merged, { envelopeId: envelope.id, version: String(version) });
    newRows.push({
      documentId: null,
      kind: 'PACKAGE_DOCUMENTS',
      storagePath,
      blake3: hashBlake3(merged),
      byteSize: merged.byteLength,
      sourceDigests: buildSourceDigests({
        originalHashes,
        extra: { ...backfillMarker, signedBlake3s },
      }),
    });
  }

  if (wantPackageWithCertificate && certificateBuffer) {
    const merged = await mergeIssuedPdfs([...signedBuffers, certificateBuffer], issuedAt);
    const storagePath = StorageKeys.esigningIssuedPackage(
      envelope.tenantId,
      envelope.id,
      version,
      'documents-with-certificate',
    );
    await putDeterministicFile(storagePath, merged, { envelopeId: envelope.id, version: String(version) });
    newRows.push({
      documentId: null,
      kind: 'PACKAGE_DOCUMENTS_WITH_CERTIFICATE',
      storagePath,
      blake3: hashBlake3(merged),
      byteSize: merged.byteLength,
      sourceDigests: buildSourceDigests({
        originalHashes,
        certificateBlake3,
        extra: { ...backfillMarker, signedBlake3s },
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
    log.info('Backfilled issued artifacts for an existing envelope', {
      envelopeId: envelope.id,
      rows: newRows.length,
    });
  }

  return 'backfilled';
}
