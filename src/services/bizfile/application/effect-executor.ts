import { createHash, randomUUID } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { z } from 'zod';

import type { PrismaTransactionClient } from '@/services/contact.service';
import { Prisma } from '@/generated/prisma';
import { prisma } from '@/lib/prisma';
import { storage as defaultStorage } from '@/lib/storage';
import type { StorageAdapter } from '@/lib/storage/types';
import { StorageKeys } from '@/lib/storage/config';
import { getFileExtension } from '@/lib/storage/filename';
import { runSerializableTransaction } from '@/lib/prisma-transaction';
import { acquireBusinessOperationBarrier } from '@/lib/business-operation-backup-barrier';
import { hashBizFileValue } from '../change-plan';

export const BIZFILE_REQUIRED_EFFECT_KINDS = ['STORAGE_FINALIZE', 'PAGE_PREPARATION'] as const;
export type BizFileRequiredEffectKind = typeof BIZFILE_REQUIRED_EFFECT_KINDS[number];

export type BizFileEffectState =
  | 'PENDING'
  | 'PROCESSING'
  | 'COMPLETE'
  | 'FAILED_RETRYABLE'
  | 'FAILED_PERMANENT';

export interface BizFileEffectClaim {
  id: string;
  tenantId: string;
  receiptId: string;
  operationId: string;
  documentId: string;
  companyId: string;
  effectKind: string;
  target: string;
  payload: unknown;
  payloadHash: string | null;
  attemptCount: number;
  claimToken: string;
  claimGeneration: number;
  leaseExpiresAt: Date;
}

export type BizFileEffectOutcomeStatus =
  | 'COMPLETE'
  | 'PENDING'
  | 'FAILED'
  | 'STALE_WORKER';

export interface BizFileEffectOutcome {
  status: BizFileEffectOutcomeStatus;
  effectId: string;
  receiptId: string;
  effectKind: string;
  attemptCount: number;
  pageCount?: number;
  destinationKey?: string;
  safeError?: {
    code: string;
    message: string;
    retryable: boolean;
  };
}

export interface BizFileEffectDrainResult {
  claimed: number;
  completed: number;
  pending: number;
  failed: number;
  staleWorkers: number;
  errors: number;
}

export interface BizFileEffectExecutorOptions {
  /** Prisma client or a test double exposing `$transaction`. */
  db?: EffectDatabase;
  /** Storage adapter used for source reads, copy, and destination verification. */
  storage?: Pick<StorageAdapter, 'copy' | 'download' | 'exists'>;
  /** Injectable clock for deterministic retry/lease tests. */
  now?: () => Date;
  /** Lease held while storage or PDF work runs outside the database. */
  leaseMs?: number;
  /** Maximum number of claims for one effect before permanent failure. */
  maxAttempts?: number;
  /** Initial retry delay. */
  retryBaseMs?: number;
  /** Maximum retry delay. */
  retryMaxMs?: number;
  /** Maximum effects drained by one invocation. */
  batchSize?: number;
  /** Restrict a drain to one committed receipt. */
  receiptId?: string;
}

export interface FinalizeBizFileEffectsResult {
  effectStatus: 'PENDING' | 'COMPLETE' | 'FAILED';
  drained: BizFileEffectDrainResult;
}

interface EffectDatabase {
  $transaction<T>(
    work: (tx: PrismaTransactionClient) => Promise<T>,
    options?: { isolationLevel?: 'Serializable'; maxWait?: number; timeout?: number },
  ): Promise<T>;
  bizFileOperationEffectIntent: PrismaTransactionClient['bizFileOperationEffectIntent'];
  bizFileOperationReceipt: PrismaTransactionClient['bizFileOperationReceipt'];
  bizFileOperationEvidence: PrismaTransactionClient['bizFileOperationEvidence'];
  document: PrismaTransactionClient['document'];
  processingDocument: PrismaTransactionClient['processingDocument'];
  documentPage: PrismaTransactionClient['documentPage'];
  workspaceBackup?: PrismaTransactionClient['workspaceBackup'];
}

interface RawQueryClient {
  $queryRawUnsafe?<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
}

interface RawEffectRow {
  id: string;
  tenantId: string;
  receiptId: string;
  operationId: string;
  documentId: string;
  companyId: string;
  effectKind: string;
  target: string;
  payload: unknown;
  payloadHash: string | null;
  attemptCount: number;
  claimGeneration: number | null;
}

interface CurrentDocument {
  id: string;
  tenantId: string;
  companyId: string | null;
  storageKey: string;
  fileName: string;
  originalFileName: string;
  mimeType: string;
  sourceRevision: number;
  isLatest: boolean;
  deletedAt: Date | null;
}

interface SourceManifest {
  documentId: string;
  storageKey: string;
  sourceRevision: number;
  sourceHash: string;
}

interface ParsedStoragePayload {
  documentId: string;
  storageKey: string;
  sourceHash: string;
  sourceRevision: number;
  destinationKey?: string;
}

interface ParsedPagePayload {
  documentId: string;
  storageKey: string;
  mimeType: string;
  sourceHash: string;
  sourceRevision: number;
  finalizedSourceRevision: number;
}

interface ParsedPage {
  pageNumber: number;
  width: number;
  height: number;
  renderDpi: number;
}

const storagePayloadSchema = z.object({
  documentId: z.string().min(1).max(200),
  storageKey: z.string().min(1).max(1000),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  sourceRevision: z.number().int().nonnegative(),
  destinationKey: z.string().min(1).max(1000).optional(),
}).strict();

const pagePayloadSchema = z.object({
  documentId: z.string().min(1).max(200),
  storageKey: z.string().min(1).max(1000),
  mimeType: z.string().min(1).max(200),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  sourceRevision: z.number().int().nonnegative(),
  finalizedSourceRevision: z.number().int().nonnegative(),
}).strict();

const DEFAULT_LEASE_MS = 60_000;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_RETRY_BASE_MS = 1_000;
const DEFAULT_RETRY_MAX_MS = 60_000;
const DEFAULT_BATCH_SIZE = 20;
const MAX_BATCH_SIZE = 100;
const MAX_LEASE_MS = 15 * 60_000;
const MAX_RETRY_DELAY_MS = 24 * 60 * 60_000;

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.floor(value as number)));
}

function settings(options: BizFileEffectExecutorOptions) {
  return {
    db: options.db ?? (prisma as unknown as EffectDatabase),
    storage: options.storage ?? defaultStorage,
    now: options.now ?? (() => new Date()),
    leaseMs: boundedInteger(options.leaseMs, DEFAULT_LEASE_MS, 1_000, MAX_LEASE_MS),
    maxAttempts: boundedInteger(options.maxAttempts, DEFAULT_MAX_ATTEMPTS, 1, 20),
    retryBaseMs: boundedInteger(options.retryBaseMs, DEFAULT_RETRY_BASE_MS, 100, MAX_RETRY_DELAY_MS),
    retryMaxMs: boundedInteger(options.retryMaxMs, DEFAULT_RETRY_MAX_MS, 100, MAX_RETRY_DELAY_MS),
    batchSize: boundedInteger(options.batchSize, DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE),
  };
}

function rawQuery(tx: unknown): RawQueryClient['$queryRawUnsafe'] | undefined {
  const candidate = tx as RawQueryClient;
  return typeof candidate.$queryRawUnsafe === 'function'
    ? candidate.$queryRawUnsafe.bind(tx) as RawQueryClient['$queryRawUnsafe']
    : undefined;
}

function isRequiredEffectKind(value: string): value is BizFileRequiredEffectKind {
  return (BIZFILE_REQUIRED_EFFECT_KINDS as readonly string[]).includes(value);
}

export class BizFileEffectError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'BizFileEffectError';
  }
}

class BizFileEffectClaimFencedError extends Error {
  constructor() {
    super('The BizFile required-effect claim is no longer current.');
    this.name = 'BizFileEffectClaimFencedError';
  }
}

function safeError(error: unknown): { code: string; message: string; retryable: boolean } {
  if (error instanceof BizFileEffectError) {
    return { code: error.code, message: error.message, retryable: error.retryable };
  }
  return {
    code: 'EFFECT_EXECUTION_FAILED',
    message: 'The BizFile follow-up effect encountered a temporary failure.',
    retryable: true,
  };
}

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function sha256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

type BarrierTransaction = Pick<PrismaTransactionClient, '$executeRaw'>;

/**
 * Effect state and document/page settlement participate in the same workspace
 * barrier as canonical writes and backup/restore. Unit doubles may omit the
 * raw delegate; the real Prisma transaction always exposes it.
 */
async function acquireEffectBarrier(tx: PrismaTransactionClient, tenantId: string): Promise<void> {
  const candidate = tx as unknown as Partial<BarrierTransaction>;
  if (typeof candidate.$executeRaw !== 'function') return;
  await acquireBusinessOperationBarrier(tx as BarrierTransaction, tenantId, 'shared');
}

async function assertEffectDispatchOpen(
  db: Pick<EffectDatabase, 'workspaceBackup'>,
  tenantId: string,
): Promise<void> {
  const pausedTenantIds = await pausedEffectTenantIds(db);
  if (pausedTenantIds.includes(tenantId)) {
    throw new BizFileEffectError(
      'WORKSPACE_PAUSED',
      'BizFile follow-up effects are paused while workspace restore is in progress.',
      true,
    );
  }
}

async function pausedEffectTenantIds(
  db: Pick<EffectDatabase, 'workspaceBackup'>,
): Promise<string[]> {
  if (!db.workspaceBackup) return [];
  const backups = await db.workspaceBackup.findMany({
    where: { status: { in: ['RESTORING', 'COMPLETED'] } },
    select: { tenantId: true, status: true, errorDetails: true },
  });
  return backups.filter((backup) => {
    if (backup.status === 'RESTORING') return true;
    const details = backup.errorDetails;
    return Boolean(details && typeof details === 'object' && !Array.isArray(details)
      && (details as Record<string, unknown>).businessAssistantDispatchPaused === true);
  }).map((backup) => backup.tenantId);
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function sourceManifestFromEvidence(evidence: { artifact: unknown; sourceRef: unknown } | null): SourceManifest {
  const artifact = asRecord(evidence?.artifact);
  const sourceRef = asRecord(evidence?.sourceRef);
  const documentId = typeof artifact?.documentId === 'string'
    ? artifact.documentId
    : typeof sourceRef?.documentId === 'string' ? sourceRef.documentId : null;
  const storageKey = typeof artifact?.storageKey === 'string' ? artifact.storageKey : null;
  const sourceRevision = nonNegativeInteger(artifact?.sourceRevision)
    ?? nonNegativeInteger(artifact?.sourceVersion)
    ?? nonNegativeInteger(sourceRef?.sourceRevision)
    ?? nonNegativeInteger(sourceRef?.sourceVersion);
  const sourceHash = typeof artifact?.sourceHash === 'string' ? artifact.sourceHash : null;
  if (!documentId || !storageKey || sourceRevision === null || !sourceHash || !/^[a-f0-9]{64}$/.test(sourceHash)) {
    throw new BizFileEffectError(
      'SOURCE_EVIDENCE_INVALID',
      'The committed BizFile receipt has incomplete source evidence.',
      false,
    );
  }
  return { documentId, storageKey, sourceRevision, sourceHash };
}

async function loadSourceManifest(
  db: EffectDatabase,
  claim: BizFileEffectClaim,
): Promise<SourceManifest> {
  const evidence = await db.bizFileOperationEvidence.findFirst({
    where: { tenantId: claim.tenantId, receiptId: claim.receiptId, kind: 'SOURCE' },
    select: { artifact: true, sourceRef: true },
  });
  return sourceManifestFromEvidence(evidence);
}

async function loadCurrentDocument(
  db: EffectDatabase,
  claim: BizFileEffectClaim,
): Promise<CurrentDocument> {
  const document = await db.document.findFirst({
    where: { id: claim.documentId, tenantId: claim.tenantId },
    select: {
      id: true,
      tenantId: true,
      companyId: true,
      storageKey: true,
      fileName: true,
      originalFileName: true,
      mimeType: true,
      sourceRevision: true,
      isLatest: true,
      deletedAt: true,
    },
  });
  if (!document) {
    throw new BizFileEffectError('SOURCE_NOT_FOUND', 'The BizFile source document no longer exists.', false);
  }
  return document as CurrentDocument;
}

function assertEffectIdentity(
  claim: BizFileEffectClaim,
  source: SourceManifest,
  payload: { documentId: string; storageKey: string; sourceHash?: string; sourceRevision?: number },
): void {
  if (!isRequiredEffectKind(claim.effectKind)) {
    throw new BizFileEffectError('UNSUPPORTED_EFFECT', 'The BizFile receipt contains an unsupported required effect.', false);
  }
  if (claim.target !== `document:${claim.documentId}` || payload.documentId !== claim.documentId || source.documentId !== claim.documentId) {
    throw new BizFileEffectError('EFFECT_TARGET_MISMATCH', 'The BizFile effect target does not match its committed source document.', false);
  }
  if (payload.storageKey !== source.storageKey) {
    throw new BizFileEffectError('SOURCE_KEY_MISMATCH', 'The BizFile effect source key does not match committed source evidence.', false);
  }
  if (payload.sourceHash && payload.sourceHash !== source.sourceHash) {
    throw new BizFileEffectError('SOURCE_HASH_MISMATCH', 'The BizFile effect source hash does not match committed source evidence.', false);
  }
  if (payload.sourceRevision !== undefined && payload.sourceRevision !== source.sourceRevision) {
    throw new BizFileEffectError('SOURCE_REVISION_MISMATCH', 'The BizFile effect source revision does not match committed source evidence.', false);
  }
}

function assertCurrentDocumentBinding(
  document: CurrentDocument,
  claim: BizFileEffectClaim,
  source: SourceManifest,
  destinationKey: string,
  finalizedSourceRevision = source.sourceRevision + 1,
): void {
  if (document.deletedAt || !document.isLatest) {
    throw new BizFileEffectError('STALE_SOURCE_DOCUMENT', 'The BizFile source is no longer the latest document.', false);
  }
  if (document.companyId !== claim.companyId) {
    throw new BizFileEffectError('DOCUMENT_COMPANY_MISMATCH', 'The BizFile source is no longer attached to the committed company.', false);
  }
  const sourceRevisionMatches = document.sourceRevision === source.sourceRevision;
  const finalizedRevisionMatches = document.storageKey === destinationKey
    && document.sourceRevision === finalizedSourceRevision;
  if (!sourceRevisionMatches && !finalizedRevisionMatches) {
    throw new BizFileEffectError('STALE_BIZFILE_SOURCE', 'The BizFile source revision advanced after this operation was committed.', false);
  }
  if (document.storageKey !== source.storageKey && document.storageKey !== destinationKey) {
    throw new BizFileEffectError('SOURCE_POINTER_CHANGED', 'The BizFile source pointer changed after this operation was committed.', false);
  }
}

function parseStoragePayload(claim: BizFileEffectClaim): ParsedStoragePayload {
  if (!claim.payloadHash || hashBizFileValue(claim.payload) !== claim.payloadHash) {
    throw new BizFileEffectError('INVALID_EFFECT_PAYLOAD', 'The BizFile storage effect payload failed integrity verification.', false);
  }
  const parsed = storagePayloadSchema.safeParse(claim.payload);
  if (!parsed.success) {
    throw new BizFileEffectError('INVALID_EFFECT_PAYLOAD', 'The BizFile storage effect payload is malformed.', false);
  }
  return parsed.data;
}

function parsePagePayload(claim: BizFileEffectClaim): ParsedPagePayload {
  if (!claim.payloadHash || hashBizFileValue(claim.payload) !== claim.payloadHash) {
    throw new BizFileEffectError('INVALID_EFFECT_PAYLOAD', 'The BizFile page effect payload failed integrity verification.', false);
  }
  const parsed = pagePayloadSchema.safeParse(claim.payload);
  if (!parsed.success) {
    throw new BizFileEffectError('INVALID_EFFECT_PAYLOAD', 'The BizFile page effect payload is malformed.', false);
  }
  return parsed.data;
}

function destinationKeyForDocument(
  document: CurrentDocument,
  claim: BizFileEffectClaim,
  sourceHash: string,
): string {
  const extension = getFileExtension(document.originalFileName || document.fileName || document.storageKey);
  const base = StorageKeys.documentOriginal(claim.tenantId, claim.companyId, document.id, extension);
  const withoutExtension = extension && base.endsWith(extension) ? base.slice(0, -extension.length) : base;
  // The hash is part of the destination identity. A later source revision can
  // therefore never copy over bytes produced by an earlier receipt.
  return `${withoutExtension}-${sourceHash}${extension}`;
}

async function lockCurrentDocument(
  tx: PrismaTransactionClient,
  claim: BizFileEffectClaim,
  source: SourceManifest,
  destinationKey: string,
  finalizedSourceRevision = source.sourceRevision + 1,
): Promise<CurrentDocument> {
  const query = rawQuery(tx);
  let document: CurrentDocument | null = null;
  if (query) {
    const rows = await query<Array<CurrentDocument>>(
      `SELECT
        "id",
        "tenantId",
        "companyId",
        "storage_key" AS "storageKey",
        "fileName",
        "originalFileName",
        "mimeType",
        "source_revision" AS "sourceRevision",
        "isLatest",
        "deleted_at" AS "deletedAt"
      FROM "documents"
      WHERE "id" = $1 AND "tenantId" = $2
      FOR UPDATE`,
      claim.documentId,
      claim.tenantId,
    );
    document = Array.isArray(rows) ? rows[0] ?? null : null;
  } else {
    const found = await tx.document.findFirst({
      where: { id: claim.documentId, tenantId: claim.tenantId },
      select: {
        id: true,
        tenantId: true,
        companyId: true,
        storageKey: true,
        fileName: true,
        originalFileName: true,
        mimeType: true,
        sourceRevision: true,
        isLatest: true,
        deletedAt: true,
      },
    });
    document = found as CurrentDocument | null;
  }
  if (!document) throw new BizFileEffectError('SOURCE_NOT_FOUND', 'The BizFile source document no longer exists.', false);
  assertCurrentDocumentBinding(document, claim, source, destinationKey, finalizedSourceRevision);
  return document;
}

async function parseSourcePages(
  sourceBytes: Buffer,
  mimeType: string,
): Promise<ParsedPage[]> {
  if (sourceBytes.length === 0) {
    throw new BizFileEffectError('SOURCE_EMPTY', 'The BizFile source artifact is empty.', false);
  }
  if (mimeType === 'application/pdf') {
    if (sourceBytes.subarray(0, 5).toString('ascii') !== '%PDF-') {
      throw new BizFileEffectError('PDF_PARSE_FAILED', 'The BizFile source is not a valid PDF.', false);
    }
    try {
      const document = await PDFDocument.load(new Uint8Array(sourceBytes), { ignoreEncryption: false });
      const pages: ParsedPage[] = [];
      for (let index = 0; index < document.getPageCount(); index += 1) {
        const page = document.getPage(index);
        const size = page.getSize();
        if (!Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0) {
          throw new Error('PDF page dimensions are invalid');
        }
        pages.push({ pageNumber: index + 1, width: Math.round(size.width), height: Math.round(size.height), renderDpi: 72 });
      }
      if (pages.length === 0) throw new Error('PDF has no pages');
      return pages;
    } catch {
      throw new BizFileEffectError('PDF_PARSE_FAILED', 'The BizFile source PDF could not be parsed.', false);
    }
  }
  if (mimeType.startsWith('image/')) {
    try {
      const image = sharp(sourceBytes, { failOn: 'error' });
      const metadata = await image.metadata();
      if (!metadata.width || !metadata.height || metadata.width <= 0 || metadata.height <= 0) {
        throw new Error('Image dimensions are invalid');
      }
      // Header metadata alone accepts truncated/malformed payloads. Force a
      // decode outside the transaction so only renderable images are persisted.
      await image.clone().raw().toBuffer();
      return [{ pageNumber: 1, width: metadata.width, height: metadata.height, renderDpi: 200 }];
    } catch {
      throw new BizFileEffectError('IMAGE_PARSE_FAILED', `The ${mimeType} source image could not be parsed.`, false);
    }
  }
  throw new BizFileEffectError('UNSUPPORTED_MIME_TYPE', `The BizFile source type ${mimeType} cannot be prepared.`, false);
}

function assertHash(content: Buffer, expected: string, code: string, message: string): void {
  if (sha256(content) !== expected) throw new BizFileEffectError(code, message, false);
}

async function executeStorageFinalize(
  claim: BizFileEffectClaim,
  options: ReturnType<typeof settings>,
  source: SourceManifest,
): Promise<{ destinationKey: string }> {
  const payload = parseStoragePayload(claim);
  assertEffectIdentity(claim, source, payload);
  if (payload.sourceRevision !== source.sourceRevision) {
    throw new BizFileEffectError('SOURCE_REVISION_MISMATCH', 'The BizFile storage effect source revision does not match committed source evidence.', false);
  }
  const document = await loadCurrentDocument(options.db, claim);
  const destinationKey = destinationKeyForDocument(document, claim, source.sourceHash);
  if (payload.destinationKey && payload.destinationKey !== destinationKey) {
    throw new BizFileEffectError('DESTINATION_KEY_MISMATCH', 'The BizFile storage destination is not deterministic for this document.', false);
  }
  assertCurrentDocumentBinding(document, claim, source, destinationKey);
  await assertEffectDispatchOpen(options.db, claim.tenantId);

  const sourceBytes = await options.storage.download(source.storageKey);
  assertHash(sourceBytes, source.sourceHash, 'SOURCE_HASH_MISMATCH', 'The BizFile source artifact failed SHA-256 verification.');

  if (source.storageKey !== destinationKey) {
    const destinationExists = await options.storage.exists(destinationKey);
    if (destinationExists) {
      const destinationBytes = await options.storage.download(destinationKey);
      assertHash(destinationBytes, source.sourceHash, 'DESTINATION_HASH_MISMATCH', 'The existing BizFile destination failed SHA-256 verification.');
    } else {
      // Copy instead of move. The pending upload remains the immutable source
      // evidence needed for recovery and independent review.
      await options.storage.copy(source.storageKey, destinationKey);
    }
    const destinationBytes = await options.storage.download(destinationKey);
    assertHash(destinationBytes, source.sourceHash, 'DESTINATION_HASH_MISMATCH', 'The copied BizFile destination failed SHA-256 verification.');
  }

  await serializable(options.db, async (tx) => {
    await acquireEffectBarrier(tx, claim.tenantId);
    const locked = await lockCurrentDocument(tx, claim, source, destinationKey);
    const alreadyFinalized = locked.storageKey === destinationKey
      && locked.sourceRevision === source.sourceRevision + 1;
    if (!alreadyFinalized) {
      const updated = await tx.document.updateMany({
        where: {
          id: locked.id,
          tenantId: claim.tenantId,
          companyId: claim.companyId,
          isLatest: true,
          deletedAt: null,
          sourceRevision: source.sourceRevision,
          storageKey: source.storageKey,
        },
        data: { storageKey: destinationKey },
      });
      if (updated.count !== 1) throw new BizFileEffectError('STALE_BIZFILE_SOURCE', 'The BizFile source changed before storage finalization.', false);
    }
    await settleCompleteInTransaction(tx, claim, options.now());
  });
  return { destinationKey };
}

async function executePagePreparation(
  claim: BizFileEffectClaim,
  options: ReturnType<typeof settings>,
  source: SourceManifest,
): Promise<{ pageCount: number }> {
  const payload = parsePagePayload(claim);
  assertEffectIdentity(claim, source, payload);
  if (payload.sourceHash !== source.sourceHash) {
    throw new BizFileEffectError('SOURCE_HASH_MISMATCH', 'The BizFile page source hash does not match committed source evidence.', false);
  }
  if (payload.sourceRevision !== source.sourceRevision
    || payload.finalizedSourceRevision !== source.sourceRevision + 1) {
    throw new BizFileEffectError('SOURCE_REVISION_MISMATCH', 'The BizFile page effect source revision does not match committed source evidence.', false);
  }
  const document = await loadCurrentDocument(options.db, claim);
  const destinationKey = destinationKeyForDocument(document, claim, source.sourceHash);
  assertCurrentDocumentBinding(document, claim, source, destinationKey, payload.finalizedSourceRevision);
  await assertEffectDispatchOpen(options.db, claim.tenantId);
  const sourceBytes = await options.storage.download(source.storageKey);
  assertHash(sourceBytes, source.sourceHash, 'SOURCE_HASH_MISMATCH', 'The BizFile source artifact failed SHA-256 verification.');
  const pages = await parseSourcePages(sourceBytes, payload.mimeType);

  await serializable(options.db, async (tx) => {
    await acquireEffectBarrier(tx, claim.tenantId);
    const locked = await lockCurrentDocument(tx, claim, source, destinationKey, payload.finalizedSourceRevision);
    const processing = await tx.processingDocument.findUnique({
      where: { documentId: locked.id },
      select: { id: true, tenantId: true },
    });
    if (!processing || processing.tenantId !== claim.tenantId) {
      throw new BizFileEffectError('PROCESSING_DOCUMENT_NOT_FOUND', 'The BizFile processing document is unavailable.', false);
    }

    for (const page of pages) {
      await tx.documentPage.upsert({
        where: { processingDocumentId_pageNumber: { processingDocumentId: processing.id, pageNumber: page.pageNumber } },
        create: {
          processingDocumentId: processing.id,
          pageNumber: page.pageNumber,
          storageKey: payload.storageKey,
          widthPx: page.width,
          heightPx: page.height,
          renderDpi: page.renderDpi,
          imageFingerprint: hashBizFileValue({ sourceHash: source.sourceHash, pageNumber: page.pageNumber }),
        },
        update: {
          storageKey: payload.storageKey,
          widthPx: page.width,
          heightPx: page.height,
          renderDpi: page.renderDpi,
          imageFingerprint: hashBizFileValue({ sourceHash: source.sourceHash, pageNumber: page.pageNumber }),
        },
      });
    }
    await tx.documentPage.deleteMany({ where: { processingDocumentId: processing.id, pageNumber: { gt: pages.length } } });
    await tx.processingDocument.update({ where: { id: processing.id }, data: { pageCount: pages.length } });
    await settleCompleteInTransaction(tx, claim, options.now());
  });
  return { pageCount: pages.length };
}

async function settleCompleteInTransaction(
  tx: PrismaTransactionClient,
  claim: BizFileEffectClaim,
  now: Date,
): Promise<void> {
  const updated = await tx.bizFileOperationEffectIntent.updateMany({
    where: {
      id: claim.id,
      tenantId: claim.tenantId,
      state: 'PROCESSING',
      claimToken: claim.claimToken,
      claimGeneration: claim.claimGeneration,
      leaseExpiresAt: { gt: now },
    },
    data: { state: 'COMPLETE', claimToken: null, leaseExpiresAt: null, nextAttemptAt: null, lastError: Prisma.DbNull },
  });
  if (updated.count !== 1) throw new BizFileEffectClaimFencedError();
  await refreshReceiptEffectStatus(tx, claim.tenantId, claim.receiptId);
}

async function refreshReceiptEffectStatus(
  tx: PrismaTransactionClient,
  tenantId: string,
  receiptId: string,
): Promise<'PENDING' | 'COMPLETE' | 'FAILED'> {
  const effects = await tx.bizFileOperationEffectIntent.findMany({
    where: { tenantId, receiptId },
    select: { state: true },
  });
  const status: 'PENDING' | 'COMPLETE' | 'FAILED' = effects.some((effect) => effect.state === 'FAILED_PERMANENT')
    ? 'FAILED'
    : effects.length > 0 && effects.every((effect) => effect.state === 'COMPLETE')
      ? 'COMPLETE'
      : 'PENDING';
  await tx.bizFileOperationReceipt.updateMany({
    where: { id: receiptId, tenantId, status: 'COMMITTED' },
    data: { effectStatus: status },
  });
  return status;
}

async function settleFailure(
  claim: BizFileEffectClaim,
  error: unknown,
  options: ReturnType<typeof settings>,
): Promise<BizFileEffectOutcome> {
  const detail = safeError(error);
  const retryable = detail.retryable && claim.attemptCount < options.maxAttempts;
  const state: 'FAILED_RETRYABLE' | 'FAILED_PERMANENT' = retryable ? 'FAILED_RETRYABLE' : 'FAILED_PERMANENT';
  const now = options.now();
  const delay = Math.min(options.retryMaxMs, options.retryBaseMs * (2 ** Math.max(0, claim.attemptCount - 1)));
  const nextAttemptAt = retryable ? new Date(now.getTime() + delay) : null;
  const effectStatus = await serializable(options.db, async (tx) => {
    const updated = await tx.bizFileOperationEffectIntent.updateMany({
      where: {
        id: claim.id,
        tenantId: claim.tenantId,
        state: 'PROCESSING',
        claimToken: claim.claimToken,
        claimGeneration: claim.claimGeneration,
        leaseExpiresAt: { gt: now },
      },
      data: {
        state,
        nextAttemptAt,
        lastError: jsonInput(detail),
        claimToken: null,
        leaseExpiresAt: null,
      },
    });
    if (updated.count !== 1) return null;
    return refreshReceiptEffectStatus(tx, claim.tenantId, claim.receiptId);
  });
  if (!effectStatus) {
    return {
      status: 'STALE_WORKER',
      effectId: claim.id,
      receiptId: claim.receiptId,
      effectKind: claim.effectKind,
      attemptCount: claim.attemptCount,
    };
  }
  return {
    status: state === 'FAILED_PERMANENT' ? 'FAILED' : 'PENDING',
    effectId: claim.id,
    receiptId: claim.receiptId,
    effectKind: claim.effectKind,
    attemptCount: claim.attemptCount,
    safeError: detail,
  };
}

async function executeClaim(
  claim: BizFileEffectClaim,
  options: ReturnType<typeof settings>,
): Promise<BizFileEffectOutcome> {
  if (!isRequiredEffectKind(claim.effectKind)) {
    return settleFailure(claim, new BizFileEffectError('UNSUPPORTED_EFFECT', 'The BizFile receipt contains an unsupported required effect.', false), options);
  }
  try {
    const source = await loadSourceManifest(options.db, claim);
    if (source.documentId !== claim.documentId) {
      throw new BizFileEffectError('SOURCE_EVIDENCE_MISMATCH', 'The committed BizFile source evidence targets another document.', false);
    }
    if (claim.effectKind === 'STORAGE_FINALIZE') {
      const result = await executeStorageFinalize(claim, options, source);
      return {
        status: 'COMPLETE',
        effectId: claim.id,
        receiptId: claim.receiptId,
        effectKind: claim.effectKind,
        attemptCount: claim.attemptCount,
        destinationKey: result.destinationKey,
      };
    }
    const result = await executePagePreparation(claim, options, source);
    return {
      status: 'COMPLETE',
      effectId: claim.id,
      receiptId: claim.receiptId,
      effectKind: claim.effectKind,
      attemptCount: claim.attemptCount,
      pageCount: result.pageCount,
    };
  } catch (error) {
    if (error instanceof BizFileEffectClaimFencedError) {
      return {
        status: 'STALE_WORKER',
        effectId: claim.id,
        receiptId: claim.receiptId,
        effectKind: claim.effectKind,
        attemptCount: claim.attemptCount,
      };
    }
    return settleFailure(claim, error, options);
  }
}

function claimRowFromDelegate(row: {
  id: string;
  tenantId: string;
  receiptId: string;
  effectKind: string;
  target: string;
  payload: unknown;
  payloadHash: string | null;
  attemptCount: number;
  claimGeneration: number | null;
  receipt: { operationId: string; documentId: string | null; companyId: string | null; status: string };
}, token: string, leaseExpiresAt: Date): BizFileEffectClaim | null {
  if (row.receipt.status !== 'COMMITTED' || !row.receipt.documentId || !row.receipt.companyId) return null;
  return {
    id: row.id,
    tenantId: row.tenantId,
    receiptId: row.receiptId,
    operationId: row.receipt.operationId,
    documentId: row.receipt.documentId,
    companyId: row.receipt.companyId,
    effectKind: row.effectKind,
    target: row.target,
    payload: row.payload,
    payloadHash: row.payloadHash,
    attemptCount: row.attemptCount,
    claimToken: token,
    claimGeneration: (row.claimGeneration ?? 0) + 1,
    leaseExpiresAt,
  };
}

/** Claim one committed BizFile effect with SKIP LOCKED and a fenced lease. */
export async function claimBizFileOperationEffect(options: BizFileEffectExecutorOptions = {}): Promise<BizFileEffectClaim | null> {
  const configured = settings(options);
  const now = configured.now();
  const token = randomUUID();
  const leaseExpiresAt = new Date(now.getTime() + configured.leaseMs);
  return serializable(configured.db, async (tx) => {
    const query = rawQuery(tx);
    if (query) {
      const rows = await query<RawEffectRow[]>(
        `SELECT
          e."id",
          e."tenant_id" AS "tenantId",
          e."receipt_id" AS "receiptId",
          r."operation_id" AS "operationId",
          r."document_id" AS "documentId",
          r."company_id" AS "companyId",
          e."effect_kind" AS "effectKind",
          e."target",
          e."payload",
          e."payload_hash" AS "payloadHash",
          e."attempt_count" AS "attemptCount",
          e."claim_generation" AS "claimGeneration"
        FROM "bizfile_operation_effect_intents" e
        JOIN "bizfile_operation_receipts" r
          ON r."tenant_id" = e."tenant_id" AND r."id" = e."receipt_id"
        WHERE NOT EXISTS (
            SELECT 1 FROM "tenant_backups" b
            WHERE b."tenant_id" = e."tenant_id"
              AND b."deleted_at" IS NULL
              AND (b."status" = 'RESTORING'
                OR (b."status" = 'COMPLETED'
                  AND b."error_details"->>'businessAssistantDispatchPaused' = 'true'))
          )
          AND r."status" = 'COMMITTED'
          AND ($3::text IS NULL OR e."tenant_id" = $3)
          AND ($4::text IS NULL OR e."receipt_id" = $4)
          AND (
            (e."state" IN ('PENDING', 'FAILED_RETRYABLE')
              AND (e."next_attempt_at" IS NULL OR e."next_attempt_at" <= $1)
              AND e."attempt_count" < $2)
            OR (e."state" = 'PROCESSING'
              AND e."lease_expires_at" IS NOT NULL
              AND e."lease_expires_at" <= $1)
          )
        ORDER BY COALESCE(e."next_attempt_at", e."created_at"), e."created_at", e."id"
        LIMIT 1`,
        now,
        configured.maxAttempts,
        null,
        options.receiptId ?? null,
      );
      const candidate = Array.isArray(rows) ? rows[0] : undefined;
      if (!candidate || !candidate.documentId || !candidate.companyId) return null;
      // The first read intentionally takes no row lock: the tenant is not
      // known until this point. Acquire the per-tenant restore barrier before
      // taking the effect row lock, then revalidate under FOR UPDATE.
      await acquireEffectBarrier(tx, candidate.tenantId);
      await assertEffectDispatchOpen(tx as unknown as Pick<EffectDatabase, 'workspaceBackup'>, candidate.tenantId);
      const lockedRows = await query<RawEffectRow[]>(
        `SELECT
          e."id",
          e."tenant_id" AS "tenantId",
          e."receipt_id" AS "receiptId",
          r."operation_id" AS "operationId",
          r."document_id" AS "documentId",
          r."company_id" AS "companyId",
          e."effect_kind" AS "effectKind",
          e."target",
          e."payload",
          e."payload_hash" AS "payloadHash",
          e."attempt_count" AS "attemptCount",
          e."claim_generation" AS "claimGeneration"
        FROM "bizfile_operation_effect_intents" e
        JOIN "bizfile_operation_receipts" r
          ON r."tenant_id" = e."tenant_id" AND r."id" = e."receipt_id"
        WHERE e."id" = $5
          AND e."tenant_id" = $3
          AND ($4::text IS NULL OR e."receipt_id" = $4)
          AND NOT EXISTS (
            SELECT 1 FROM "tenant_backups" b
            WHERE b."tenant_id" = e."tenant_id"
              AND b."deleted_at" IS NULL
              AND (b."status" = 'RESTORING'
                OR (b."status" = 'COMPLETED'
                  AND b."error_details"->>'businessAssistantDispatchPaused' = 'true'))
          )
          AND r."status" = 'COMMITTED'
          AND r."document_id" IS NOT NULL
          AND r."company_id" IS NOT NULL
          AND (
            (e."state" IN ('PENDING', 'FAILED_RETRYABLE')
              AND (e."next_attempt_at" IS NULL OR e."next_attempt_at" <= $1)
              AND e."attempt_count" < $2)
            OR (e."state" = 'PROCESSING'
              AND e."lease_expires_at" IS NOT NULL
              AND e."lease_expires_at" <= $1)
          )
        FOR UPDATE OF e SKIP LOCKED
        LIMIT 1`,
        now,
        configured.maxAttempts,
        candidate.tenantId,
        options.receiptId ?? null,
        candidate.id,
      );
      const lockedCandidate = Array.isArray(lockedRows) ? lockedRows[0] : undefined;
      if (!lockedCandidate || !lockedCandidate.documentId || !lockedCandidate.companyId) return null;
      const updated = await query<RawEffectRow[]>(
        `UPDATE "bizfile_operation_effect_intents"
        SET "state" = 'PROCESSING',
            "claim_token" = $2,
            "claim_generation" = COALESCE("claim_generation", 0) + 1,
            "lease_expires_at" = $3,
            "attempt_count" = "attempt_count" + 1,
            "updated_at" = $1
        WHERE "id" = $4 AND "tenant_id" = $5
        RETURNING
          "id",
          "tenant_id" AS "tenantId",
          "receipt_id" AS "receiptId",
          "effect_kind" AS "effectKind",
          "target",
          "payload",
          "payload_hash" AS "payloadHash",
          "attempt_count" AS "attemptCount",
          "claim_generation" AS "claimGeneration"`,
        now,
        token,
        leaseExpiresAt,
         lockedCandidate.id,
         lockedCandidate.tenantId,
      );
      const claimed = Array.isArray(updated) ? updated[0] : undefined;
      if (!claimed) return null;
      return {
        id: claimed.id,
        tenantId: claimed.tenantId,
        receiptId: claimed.receiptId,
        operationId: lockedCandidate.operationId,
        documentId: lockedCandidate.documentId,
        companyId: lockedCandidate.companyId,
        effectKind: claimed.effectKind,
        target: claimed.target,
        payload: claimed.payload,
        payloadHash: claimed.payloadHash,
        attemptCount: claimed.attemptCount,
        claimToken: token,
        claimGeneration: claimed.claimGeneration ?? 1,
        leaseExpiresAt,
      };
    }

    const candidate = await tx.bizFileOperationEffectIntent.findFirst({
      where: {
        ...(options.receiptId ? { receiptId: options.receiptId } : {}),
        state: { in: ['PENDING', 'FAILED_RETRYABLE', 'PROCESSING'] },
        OR: [
          { state: { in: ['PENDING', 'FAILED_RETRYABLE'] }, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
          { state: 'PROCESSING', leaseExpiresAt: { lte: now } },
        ],
        receipt: { status: 'COMMITTED', documentId: { not: null }, companyId: { not: null } },
      },
      orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        tenantId: true,
        receiptId: true,
        effectKind: true,
        target: true,
        payload: true,
        payloadHash: true,
        attemptCount: true,
        claimToken: true,
        claimGeneration: true,
        state: true,
        receipt: { select: { operationId: true, documentId: true, companyId: true, status: true } },
      },
    });
    if (!candidate || candidate.attemptCount >= configured.maxAttempts && candidate.state !== 'PROCESSING') return null;
    await acquireEffectBarrier(tx, candidate.tenantId);
    await assertEffectDispatchOpen(tx as unknown as Pick<EffectDatabase, 'workspaceBackup'>, candidate.tenantId);
    const refreshed = await tx.bizFileOperationEffectIntent.findFirst({
      where: {
        id: candidate.id,
        tenantId: candidate.tenantId,
        state: candidate.state,
        ...(candidate.state === 'PROCESSING'
          ? { leaseExpiresAt: { lte: now } }
          : { OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }], attemptCount: { lt: configured.maxAttempts } }),
        receipt: { status: 'COMMITTED', documentId: { not: null }, companyId: { not: null } },
      },
      select: {
        id: true,
        tenantId: true,
        receiptId: true,
        effectKind: true,
        target: true,
        payload: true,
        payloadHash: true,
        attemptCount: true,
        claimToken: true,
        claimGeneration: true,
        state: true,
        receipt: { select: { operationId: true, documentId: true, companyId: true, status: true } },
      },
    });
    if (!refreshed) return null;
    const generation = (refreshed.claimGeneration ?? 0) + 1;
    const updated = await tx.bizFileOperationEffectIntent.updateMany({
      where: {
        id: refreshed.id,
        tenantId: refreshed.tenantId,
        state: refreshed.state,
        claimToken: refreshed.claimToken,
        claimGeneration: refreshed.claimGeneration,
      },
      data: { state: 'PROCESSING', claimToken: token, claimGeneration: generation, leaseExpiresAt, attemptCount: { increment: 1 }, updatedAt: now },
    });
    if (updated.count !== 1) return null;
    return claimRowFromDelegate(refreshed, token, leaseExpiresAt);
  });
}

/** Execute one already claimed effect. Storage/PDF work stays outside DB transactions. */
export async function executeBizFileOperationEffect(
  claim: BizFileEffectClaim,
  options: BizFileEffectExecutorOptions = {},
): Promise<BizFileEffectOutcome> {
  return executeClaim(claim, settings(options));
}

/** Drain committed effects for every caller, including receipts created by UI routes. */
export async function drainBizFileOperationEffects(
  options: BizFileEffectExecutorOptions = {},
): Promise<BizFileEffectDrainResult> {
  const configured = settings(options);
  const result: BizFileEffectDrainResult = { claimed: 0, completed: 0, pending: 0, failed: 0, staleWorkers: 0, errors: 0 };
  for (let index = 0; index < configured.batchSize; index += 1) {
    let claim: BizFileEffectClaim | null;
    try {
      claim = await claimBizFileOperationEffect({ ...options, db: configured.db, now: configured.now, storage: configured.storage, batchSize: configured.batchSize });
    } catch {
      result.errors += 1;
      break;
    }
    if (!claim) break;
    result.claimed += 1;
    try {
      const outcome = await executeBizFileOperationEffect(claim, { ...options, db: configured.db, now: configured.now, storage: configured.storage });
      if (outcome.status === 'COMPLETE') result.completed += 1;
      else if (outcome.status === 'PENDING') result.pending += 1;
      else if (outcome.status === 'FAILED') result.failed += 1;
      else result.staleWorkers += 1;
    } catch {
      result.errors += 1;
    }
  }
  return result;
}

/** Run the durable effect worker for one committed receipt. */
export async function finalizeBizFileOperationEffects(
  tenantId: string,
  receiptId: string,
  options: BizFileEffectExecutorOptions = {},
): Promise<FinalizeBizFileEffectsResult> {
  const configured = settings(options);
  const drained = await drainBizFileOperationEffects({
    ...options,
    db: configured.db,
    now: configured.now,
    storage: configured.storage,
    receiptId,
  });
  const receipt = await configured.db.bizFileOperationReceipt.findFirst({
    where: { tenantId, id: receiptId },
    select: { effectStatus: true },
  });
  const effectStatus = receipt?.effectStatus === 'COMPLETE'
    ? 'COMPLETE'
    : receipt?.effectStatus === 'FAILED' ? 'FAILED' : 'PENDING';
  return { effectStatus, drained };
}

async function serializable<T>(
  db: EffectDatabase,
  work: (tx: PrismaTransactionClient) => Promise<T>,
): Promise<T> {
  return runSerializableTransaction(
    db as unknown as {
      $transaction<TResult>(
        callback: (transaction: PrismaTransactionClient) => Promise<TResult>,
        options: { isolationLevel: 'Serializable' },
      ): Promise<TResult>;
    },
    work,
  );
}

export const claimBizFileEffect = claimBizFileOperationEffect;
export const executeBizFileEffect = executeBizFileOperationEffect;
export const drainBizFileEffects = drainBizFileOperationEffects;
