// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashBlake3 } from '@/lib/encryption';

/**
 * OAK-008 / OAK-021: every issued PDF is recorded with its BLAKE3 hash, the emailed and filed copy
 * is the stored document+certificate file, regeneration appends a version, and the public check
 * recognises any issued file. Real PDF generation, real database (oakcloud_test); only object
 * storage is swapped for memory and the outgoing email calls are captured.
 */

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (process.env.CI === 'true' && !testDatabaseUrl) {
  describe('E-signing issued artifacts PostgreSQL configuration', () => {
    it('requires TEST_DATABASE_URL in CI', () => {
      throw new Error('TEST_DATABASE_URL must reference an isolated PostgreSQL test database in CI');
    });
  });
}

/** The signing-session download reads its session cookie; everything else about it runs for real. */
const signingSession = vi.hoisted(() => ({
  claims: null as null | { recipientId: string; envelopeId: string; sessionVersion: number },
}));
vi.mock('@/lib/esigning-session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/esigning-session')>()),
  getEsigningSessionClaims: vi.fn(async () => signingSession.claims),
}));

const memory = vi.hoisted(() => ({
  files: new Map<string, Buffer>(),
  uploads: [] as string[],
  deleted: [] as string[],
  /** Every download/exists call, so a test can prove a rejected request never touched storage. */
  reads: [] as string[],
  /** Pauses the next upload whose key matches, until the test releases (or fails) it. */
  gate: null as null | {
    match: (key: string) => boolean;
    entered: () => void;
    released: Promise<void>;
  },
}));
const mail = vi.hoisted(() => ({
  completion: [] as Array<{ attachments?: Array<{ filename: string; content: Buffer }> }>,
  failures: [] as Array<{ errorMessage: string }>,
}));

vi.mock('@/lib/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/storage')>();
  return {
    ...actual,
    storage: {
      upload: async (key: string, data: Buffer) => {
        const gate = memory.gate;
        if (gate && gate.match(key)) {
          memory.gate = null; // only the first matching upload is held; later workers pass straight through
          gate.entered();
          await gate.released;
        }
        memory.uploads.push(key);
        memory.files.set(key, Buffer.from(data));
      },
      download: async (key: string) => {
        memory.reads.push(key);
        const data = memory.files.get(key);
        if (!data) throw new Error(`missing object ${key}`);
        return Buffer.from(data);
      },
      delete: async (key: string) => {
        memory.deleted.push(key);
        memory.files.delete(key);
      },
      exists: async (key: string) => {
        memory.reads.push(key);
        return memory.files.has(key);
      },
    },
  };
});

vi.mock('@/services/esigning-notification.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/esigning-notification.service')>()),
  sendEsigningCompletionEmail: vi.fn(async (input: { to?: string; attachments?: Array<{ filename: string; content: Buffer }> }) => {
    mail.completion.push({ attachments: input.attachments });
    return {
      ok: true,
      kind: 'completion',
      to: input.to ?? 'copy@example.test',
      subject: 'Completed',
      attemptedAt: new Date().toISOString(),
      providerMessageId: 'test',
    };
  }),
  sendEsigningPdfFailureEmailToSender: vi.fn(async (input: { to: string; errorMessage: string }) => {
    mail.failures.push({ errorMessage: input.errorMessage });
    return {
      ok: true,
      kind: 'pdf_failure',
      to: input.to,
      subject: 'PDF failed',
      attemptedAt: new Date().toISOString(),
      providerMessageId: 'test',
    };
  }),
}));

vi.mock('@/services/sharepoint.service', () => ({
  SharePointServiceError: class SharePointServiceError extends Error {
    code: string;
    retryable: boolean;
    constructor(input: { code: string; retryable?: boolean; message: string }) {
      super(input.message);
      this.code = input.code;
      this.retryable = input.retryable ?? false;
    }
  },
}));

const describePostgres = testDatabaseUrl ? describe : describe.skip;
const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

type Prisma = Awaited<ReturnType<typeof import('@/lib/prisma')['getPrisma']>>;

describePostgres('e-signing issued artifacts (real generation, hashing and verification)', () => {
  let prisma: Prisma;
  let pdfService: typeof import('@/services/esigning-pdf.service');
  let issued: typeof import('@/services/esigning-issued-artifacts');
  let completion: typeof import('@/services/esigning-completion.service');
  let certificateService: typeof import('@/services/esigning-certificate.service');
  let filingSource: typeof import('@/services/esigning-sharepoint-filing/source');
  let checkRoute: typeof import('@/app/api/esigning/verify/[certificateId]/check/route');
  const tenantIds: string[] = [];
  const previousLogLevel = process.env.LOG_LEVEL;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.LOG_LEVEL = 'silent';
    prisma = (await import('@/lib/prisma')).getPrisma();
    pdfService = await import('@/services/esigning-pdf.service');
    issued = await import('@/services/esigning-issued-artifacts');
    completion = await import('@/services/esigning-completion.service');
    certificateService = await import('@/services/esigning-certificate.service');
    filingSource = await import('@/services/esigning-sharepoint-filing/source');
    checkRoute = await import('@/app/api/esigning/verify/[certificateId]/check/route');
  });

  beforeEach(() => {
    mail.completion.length = 0;
    mail.failures.length = 0;
  });

  afterEach(async () => {
    memory.files.clear();
    memory.uploads.length = 0;
    memory.deleted.length = 0;
    memory.reads.length = 0;
    memory.gate = null;
    for (const tenantId of tenantIds.splice(0)) {
      await prisma.auditLog.deleteMany({ where: { tenantId } });
      await prisma.esigningEnvelope.deleteMany({ where: { tenantId } });
      await prisma.connector.deleteMany({ where: { workspaceId: tenantId } });
      await prisma.user.deleteMany({ where: { tenantId } });
      await prisma.workspace.delete({ where: { id: tenantId } });
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
    if (previousLogLevel === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = previousLogLevel;
  });

  async function seedCompletedEnvelope(options: { documents?: number } = {}) {
    const suffix = randomUUID();
    const workspace = await prisma.workspace.create({
      data: { name: `Issued ${suffix}`, slug: `issued-${suffix}` },
    });
    tenantIds.push(workspace.id);
    const user = await prisma.user.create({
      data: {
        tenantId: workspace.id,
        email: `issued-${suffix}@example.test`,
        passwordHash: 'not-used',
        firstName: 'E-signing',
        lastName: 'Sender',
      },
    });
    const envelope = await prisma.esigningEnvelope.create({
      data: {
        tenantId: workspace.id,
        createdById: user.id,
        title: 'Services Agreement',
        status: 'COMPLETED',
        signingOrder: 'PARALLEL',
        certificateId: `OAK-ES-${suffix.slice(0, 12).toUpperCase()}`,
        completedAt: new Date('2026-10-30T00:00:00.000Z'),
        pdfGenerationStatus: 'PENDING',
      },
    });
    const recipient = await prisma.esigningEnvelopeRecipient.create({
      data: {
        tenantId: workspace.id,
        envelopeId: envelope.id,
        type: 'SIGNER',
        name: 'Priya Rao',
        email: `signer-${suffix}@example.test`,
        status: 'SIGNED',
        signedAt: new Date('2026-10-30T00:00:00.000Z'),
        colorTag: '#06b6d4',
      },
    });

    const documents: Array<{ id: string; originalBytes: Buffer; storagePath: string }> = [];
    for (let index = 0; index < (options.documents ?? 1); index += 1) {
      const original = await PDFDocument.create();
      original.addPage([595, 842]);
      const originalBytes = Buffer.from(await original.save());
      const storagePath = `${workspace.id}/esigning/${envelope.id}/originals/doc-${index}.pdf`;
      memory.files.set(storagePath, originalBytes);
      const document = await prisma.esigningEnvelopeDocument.create({
        data: {
          tenantId: workspace.id,
          envelopeId: envelope.id,
          fileName: `agreement-${index}.pdf`,
          storagePath,
          originalHash: hashBlake3(originalBytes),
          pageCount: 1,
          sortOrder: index + 1,
          fileSize: originalBytes.byteLength,
        },
      });
      const field = await prisma.esigningDocumentFieldDefinition.create({
        data: {
          tenantId: workspace.id,
          envelopeId: envelope.id,
          documentId: document.id,
          recipientId: recipient.id,
          type: 'TEXT',
          pageNumber: 1,
          xPercent: 0.1,
          yPercent: 0.1,
          widthPercent: 0.7,
          heightPercent: 0.04,
          sortOrder: 1,
        },
      });
      await prisma.esigningDocumentFieldValue.create({
        data: {
          tenantId: workspace.id,
          fieldDefinitionId: field.id,
          recipientId: recipient.id,
          value: `Signed by Priya ${index}`,
          finalizedAt: new Date('2026-10-30T00:00:00.000Z'),
        },
      });
      documents.push({ id: document.id, originalBytes, storagePath });
    }
    return { workspace, user, envelope, recipient, documents };
  }

  async function tenantOf(envelopeId: string) {
    return (await prisma.esigningEnvelope.findUniqueOrThrow({ where: { id: envelopeId }, select: { tenantId: true } })).tenantId;
  }

  async function generate(envelopeId: string) {
    return pdfService.generateEsigningEnvelopeArtifactsNow({ tenantId: await tenantOf(envelopeId), envelopeId });
  }

  /** Hold the next upload whose key matches; `release()` lets it proceed, `fail()` makes it throw. */
  function holdNextUpload(match: (key: string) => boolean) {
    let entered!: () => void;
    let release!: () => void;
    let fail!: (error: Error) => void;
    const enteredPromise = new Promise<void>((resolve) => { entered = resolve; });
    const released = new Promise<void>((resolve, reject) => { release = resolve; fail = reject; });
    released.catch(() => undefined);
    memory.gate = { match, entered, released };
    return { entered: enteredPromise, release, fail };
  }

  /** Mark a failed/finished envelope for an explicit retry, as "Retry processing" does. */
  async function requestRetry(envelopeId: string) {
    await prisma.esigningEnvelope.update({
      where: { id: envelopeId },
      data: { pdfGenerationStatus: 'PENDING', pdfGenerationError: null, pdfGenerationClaimedAt: null, pdfGenerationClaimId: null },
    });
  }

  async function sendCompletionEmail(seed: Awaited<ReturnType<typeof seedCompletedEnvelope>>, label: string) {
    const claimToken = randomUUID();
    const delivery = await prisma.esigningEmailDelivery.create({
      data: {
        tenantId: seed.workspace.id,
        envelopeId: seed.envelope.id,
        recipientId: seed.recipient.id,
        audience: 'RECIPIENT',
        kind: 'COMPLETION',
        targetKey: `recipient:${seed.recipient.id}:${label}`,
        toEmail: `${label}@example.test`,
        subject: 'Completed',
        status: 'PROCESSING',
        claimToken,
        claimedAt: new Date(),
        leaseExpiresAt: new Date(Date.now() + 60_000),
      },
    });
    const outcome = await completion.processEsigningCompletionDelivery({
      id: delivery.id,
      tenantId: seed.workspace.id,
      envelopeId: seed.envelope.id,
      claimToken,
    });
    return { outcome, attachments: mail.completion.at(-1)?.attachments ?? [] };
  }

  async function runCheck(certificateId: string, bytes: Buffer) {
    const formData = new FormData();
    formData.set('file', new File([new Uint8Array(bytes)], 'upload.pdf', { type: 'application/pdf' }));
    const request = new Request(`http://localhost/api/esigning/verify/${certificateId}/check`, {
      method: 'POST',
      headers: { origin: 'http://localhost', 'x-forwarded-for': `198.51.100.${Math.floor(Math.random() * 200)}` },
      body: formData,
    });
    const response = await checkRoute.POST(request as never, { params: Promise.resolve({ certificateId }) });
    return { status: response.status, body: await response.json() };
  }

  async function currentRows(envelopeId: string) {
    const envelope = await prisma.esigningEnvelope.findUniqueOrThrow({ where: { id: envelopeId } });
    const rows = await prisma.esigningIssuedArtifact.findMany({
      where: { envelopeId, version: envelope.currentArtifactVersion ?? -1 },
    });
    return { envelope, rows };
  }

  it('round trip: the emailed attachment is the stored file and passes the public check; a modified copy does not', async () => {
    const seed = await seedCompletedEnvelope();
    await expect(generate(seed.envelope.id)).resolves.toBe('generated');

    const { envelope, rows } = await currentRows(seed.envelope.id);
    expect(envelope.currentArtifactVersion).toBe(1);
    expect(rows.map((row) => row.kind).sort()).toEqual(['CERTIFICATE', 'DOCUMENT_WITH_CERTIFICATE', 'SIGNED_DOCUMENT']);
    const merged = rows.find((row) => row.kind === 'DOCUMENT_WITH_CERTIFICATE')!;
    // Each generation attempt writes under its own folder, so no two workers can share a key.
    expect(merged.storagePath).toMatch(
      new RegExp(
        `^${seed.workspace.id}/esigning/${seed.envelope.id}/v1/[0-9a-f-]{36}/with-certificate/${seed.documents[0].id}\\.pdf$`,
      ),
    );

    // The real delivery path builds the attachment.
    const { outcome, attachments } = await sendCompletionEmail(seed, 'first');
    expect(outcome.status).toBe('sent');
    expect(attachments).toHaveLength(1);
    const attached = attachments[0].content;
    const pages = (await PDFDocument.load(new Uint8Array(attached))).getPageCount();
    expect(pages).toBeGreaterThanOrEqual(2); // signed document + certificate
    expect(hashBlake3(attached)).toBe(merged.blake3);
    expect(attached.equals(memory.files.get(merged.storagePath)!)).toBe(true);

    // The untouched attachment verifies, through the real route and the real lookup.
    const ok = await runCheck(seed.envelope.certificateId, attached);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({
      matched: true,
      fileHash: merged.blake3,
      document: { id: seed.documents[0].id },
      artifact: { kind: 'DOCUMENT_WITH_CERTIFICATE', version: 1, isCurrent: true, source: 'ISSUED_ARTIFACT' },
    });

    // The signed document alone and the certificate alone verify too.
    const signedOnly = await runCheck(seed.envelope.certificateId, memory.files.get(rows.find((r) => r.kind === 'SIGNED_DOCUMENT')!.storagePath)!);
    expect(signedOnly.body.artifact.kind).toBe('SIGNED_DOCUMENT');
    const certificateOnly = await runCheck(seed.envelope.certificateId, memory.files.get(rows.find((r) => r.kind === 'CERTIFICATE')!.storagePath)!);
    expect(certificateOnly.body).toMatchObject({ matched: true, document: null, artifact: { kind: 'CERTIFICATE' } });

    // One byte flipped: no match.
    const modified = Buffer.from(attached);
    modified[Math.floor(modified.length / 2)] ^= 0x01;
    const bad = await runCheck(seed.envelope.certificateId, modified);
    expect(bad.status).toBe(200);
    expect(bad.body).toMatchObject({ matched: false, document: null, artifact: null });
    expect(bad.body.fileHash).not.toBe(merged.blake3);
  });

  it('every send is byte-identical, and the filing source and downloads serve the same stored bytes', async () => {
    const seed = await seedCompletedEnvelope({ documents: 2 });
    await generate(seed.envelope.id);
    const { rows } = await currentRows(seed.envelope.id);
    const mergedFor = (documentId: string) =>
      rows.find((row) => row.kind === 'DOCUMENT_WITH_CERTIFICATE' && row.documentId === documentId)!;

    const first = await sendCompletionEmail(seed, 'first');
    const second = await sendCompletionEmail(seed, 'second');
    expect(first.attachments).toHaveLength(2);
    expect(second.attachments).toHaveLength(2);
    first.attachments.forEach((attachment, index) => {
      expect(attachment.content.equals(second.attachments[index].content)).toBe(true);
      expect(hashBlake3(attachment.content)).toBe(mergedFor(seed.documents[index].id).blake3);
    });

    for (const document of seed.documents) {
      const filed = await filingSource.downloadSharePointFilingSource({
        tenantId: seed.workspace.id,
        envelopeId: seed.envelope.id,
        envelopeDocumentId: document.id,
        signedStoragePath: null,
      });
      expect(hashBlake3(filed)).toBe(mergedFor(document.id).blake3);

      const download = await pdfService.downloadEsigningDocumentPackage({
        tenantId: seed.workspace.id,
        envelopeId: seed.envelope.id,
        documentId: document.id,
        variant: 'signed_with_certificate',
      });
      expect(hashBlake3(download.buffer)).toBe(mergedFor(document.id).blake3);

      const signedDownload = await pdfService.downloadEsigningDocumentPackage({
        tenantId: seed.workspace.id,
        envelopeId: seed.envelope.id,
        documentId: document.id,
        variant: 'signed',
      });
      const signedRow = rows.find((row) => row.kind === 'SIGNED_DOCUMENT' && row.documentId === document.id)!;
      expect(hashBlake3(signedDownload.buffer)).toBe(signedRow.blake3);
    }

    // Single-file packages are served as stored, not re-saved.
    const single = await seedCompletedEnvelope();
    await generate(single.envelope.id);
    const singleRows = (await currentRows(single.envelope.id)).rows;
    const pack = await pdfService.downloadEsigningEnvelopePackage({
      tenantId: single.workspace.id,
      envelopeId: single.envelope.id,
      variant: 'documents_with_certificates',
    });
    expect(hashBlake3(pack.buffer)).toBe(singleRows.find((row) => row.kind === 'DOCUMENT_WITH_CERTIFICATE')!.blake3);
    const certificatePack = await pdfService.downloadEsigningEnvelopePackage({
      tenantId: single.workspace.id,
      envelopeId: single.envelope.id,
      variant: 'certificates',
    });
    expect(hashBlake3(certificatePack.buffer)).toBe(singleRows.find((row) => row.kind === 'CERTIFICATE')!.blake3);
  });

  it('regenerating appends version 2, leaves version 1 rows and files untouched and moves the pointers', async () => {
    const seed = await seedCompletedEnvelope();
    await generate(seed.envelope.id);
    const v1Attachment = (await sendCompletionEmail(seed, 'v1')).attachments[0].content;
    const v1 = await prisma.esigningIssuedArtifact.findMany({ where: { envelopeId: seed.envelope.id, version: 1 }, orderBy: { kind: 'asc' } });
    const v1Files = new Map(v1.map((row) => [row.storagePath, Buffer.from(memory.files.get(row.storagePath)!)]));
    const v1Document = await prisma.esigningEnvelopeDocument.findUniqueOrThrow({ where: { id: seed.documents[0].id } });

    // Something that changes the rendered bytes (a different renderer would too). Without a change,
    // two generations within the same second are byte-identical, and a file then matches both versions.
    await prisma.esigningDocumentFieldValue.updateMany({
      where: { tenantId: seed.workspace.id },
      data: { value: 'Re-rendered value' },
    });
    await requestRetry(seed.envelope.id);
    await expect(generate(seed.envelope.id)).resolves.toBe('generated');

    const envelope = await prisma.esigningEnvelope.findUniqueOrThrow({ where: { id: seed.envelope.id } });
    expect(envelope.currentArtifactVersion).toBe(2);
    expect(envelope.pdfGenerationStatus).toBe('COMPLETED');

    // Version 1: same rows, same files.
    const v1After = await prisma.esigningIssuedArtifact.findMany({ where: { envelopeId: seed.envelope.id, version: 1 }, orderBy: { kind: 'asc' } });
    expect(v1After).toEqual(v1);
    for (const [path, bytes] of v1Files) {
      expect(memory.files.get(path)!.equals(bytes)).toBe(true);
    }
    // Version 2: its own paths and rows.
    const v2 = await prisma.esigningIssuedArtifact.findMany({ where: { envelopeId: seed.envelope.id, version: 2 } });
    expect(v2).toHaveLength(3);
    for (const row of v2) {
      expect(row.storagePath).toContain('/v2/');
      expect(v1Files.has(row.storagePath)).toBe(false);
      expect(hashBlake3(memory.files.get(row.storagePath)!)).toBe(row.blake3);
    }
    // Pointers follow the current version, document only.
    const document = await prisma.esigningEnvelopeDocument.findUniqueOrThrow({ where: { id: seed.documents[0].id } });
    const v2Signed = v2.find((row) => row.kind === 'SIGNED_DOCUMENT')!;
    expect(document.signedStoragePath).toBe(v2Signed.storagePath);
    expect(document.signedHash).toBe(v2Signed.blake3);
    expect(document.signedStoragePath).not.toBe(v1Document.signedStoragePath);

    // A copy issued in version 1 still verifies, marked as not current; version 2 is current.
    const old = await runCheck(seed.envelope.certificateId, v1Attachment);
    expect(old.body).toMatchObject({ matched: true, artifact: { kind: 'DOCUMENT_WITH_CERTIFICATE', version: 1, isCurrent: false } });
    const v2Attachment = (await sendCompletionEmail(seed, 'v2')).attachments[0].content;
    expect(v2Attachment.equals(v1Attachment)).toBe(false);
    const current = await runCheck(seed.envelope.certificateId, v2Attachment);
    expect(current.body).toMatchObject({ matched: true, artifact: { version: 2, isCurrent: true } });
    // The public listing shows only the current document hash.
    const verification = await certificateService.getEsigningVerificationData(seed.envelope.certificateId);
    expect(verification.documents[0].hash).toBe(v2Signed.blake3);
  });

  it('a renderer-version bump does not regenerate an issued envelope', async () => {
    const seed = await seedCompletedEnvelope();
    await generate(seed.envelope.id);
    // The old trigger: artifactVersion in metadata differs from the renderer's current version.
    await prisma.esigningEnvelope.update({
      where: { id: seed.envelope.id },
      data: { metadata: { artifactVersion: 3 } },
    });
    const rowsBefore = await prisma.esigningIssuedArtifact.findMany({ where: { envelopeId: seed.envelope.id }, orderBy: { id: 'asc' } });
    memory.uploads.length = 0;

    await pdfService.ensureEsigningEnvelopeArtifacts({ tenantId: seed.workspace.id, envelopeId: seed.envelope.id, requireCertificates: true });
    await sendCompletionEmail(seed, 'after-bump');
    await pdfService.downloadEsigningDocumentPackage({
      tenantId: seed.workspace.id,
      envelopeId: seed.envelope.id,
      documentId: seed.documents[0].id,
      variant: 'signed_with_certificate',
    });

    expect(memory.uploads).toEqual([]);
    const envelope = await prisma.esigningEnvelope.findUniqueOrThrow({ where: { id: seed.envelope.id } });
    expect(envelope.currentArtifactVersion).toBe(1);
    expect(await prisma.esigningIssuedArtifact.findMany({ where: { envelopeId: seed.envelope.id }, orderBy: { id: 'asc' } })).toEqual(rowsBefore);
  });

  it('regenerates as the next version when a file of the current version is missing from storage', async () => {
    const seed = await seedCompletedEnvelope();
    await generate(seed.envelope.id);
    const v1 = await prisma.esigningIssuedArtifact.findMany({ where: { envelopeId: seed.envelope.id, version: 1 } });
    const lost = v1.find((row) => row.kind === 'DOCUMENT_WITH_CERTIFICATE')!;
    memory.files.delete(lost.storagePath);

    await pdfService.ensureEsigningEnvelopeArtifacts({ tenantId: seed.workspace.id, envelopeId: seed.envelope.id, requireCertificates: true });

    const envelope = await prisma.esigningEnvelope.findUniqueOrThrow({ where: { id: seed.envelope.id } });
    expect(envelope.currentArtifactVersion).toBe(2);
    // The version-1 row (and its recorded hash) is still there for verifying a copy issued earlier.
    expect(await prisma.esigningIssuedArtifact.findFirst({ where: { id: lost.id } })).toMatchObject({ blake3: lost.blake3, version: 1 });
    expect(await prisma.esigningIssuedArtifact.count({ where: { envelopeId: seed.envelope.id, version: 2 } })).toBe(3);
  });

  it('a source digest mismatch fails the envelope with an event and an email, uploads nothing, and previous files keep being served', async () => {
    const seed = await seedCompletedEnvelope();
    await generate(seed.envelope.id);
    const served = (await sendCompletionEmail(seed, 'before')).attachments[0].content;

    // The stored original no longer matches the digest recorded at upload.
    const tampered = Buffer.concat([seed.documents[0].originalBytes, Buffer.from('\n%tampered')]);
    memory.files.set(seed.documents[0].storagePath, tampered);
    await requestRetry(seed.envelope.id);
    memory.uploads.length = 0;
    mail.failures.length = 0;

    await expect(generate(seed.envelope.id)).rejects.toMatchObject({ code: 'SOURCE_DIGEST_MISMATCH' });

    expect(memory.uploads).toEqual([]);
    const envelope = await prisma.esigningEnvelope.findUniqueOrThrow({ where: { id: seed.envelope.id } });
    expect(envelope.pdfGenerationStatus).toBe('FAILED');
    expect(envelope.currentArtifactVersion).toBe(1);
    expect(envelope.pdfGenerationError).toContain('SOURCE_DIGEST_MISMATCH');
    const event = await prisma.esigningEnvelopeEvent.findFirstOrThrow({
      where: { envelopeId: seed.envelope.id, action: 'PDF_GENERATION_FAILED' },
    });
    expect(event.metadata).toMatchObject({
      code: 'SOURCE_DIGEST_MISMATCH',
      documentId: seed.documents[0].id,
      expected: hashBlake3(seed.documents[0].originalBytes),
      actual: hashBlake3(tampered),
    });
    expect(mail.failures).toHaveLength(1);
    expect(mail.failures[0].errorMessage).toContain('agreement-0.pdf');

    // Never retried by a lazy caller, and the previous version is still what gets served.
    mail.failures.length = 0;
    await pdfService.ensureEsigningEnvelopeArtifacts({ tenantId: seed.workspace.id, envelopeId: seed.envelope.id, requireCertificates: true });
    const after = await sendCompletionEmail(seed, 'after');
    expect(after.attachments[0].content.equals(served)).toBe(true);
    expect(memory.uploads).toEqual([]);
    expect(mail.failures).toEqual([]);
    expect((await prisma.esigningEnvelope.findUniqueOrThrow({ where: { id: seed.envelope.id } })).pdfGenerationStatus).toBe('FAILED');
    expect(await prisma.esigningIssuedArtifact.count({ where: { envelopeId: seed.envelope.id, version: 2 } })).toBe(0);
  });

  it('a first generation with a mismatched source fails once and a lazy caller does not retry it', async () => {
    const seed = await seedCompletedEnvelope();
    memory.files.set(seed.documents[0].storagePath, Buffer.concat([seed.documents[0].originalBytes, Buffer.from('\n%x')]));

    await expect(generate(seed.envelope.id)).rejects.toMatchObject({ code: 'SOURCE_DIGEST_MISMATCH' });
    expect(mail.failures).toHaveLength(1);

    // Downloads, emails and filing all go through ensure: they report the failure, no new email, no files.
    await expect(
      pdfService.ensureEsigningEnvelopeArtifacts({ tenantId: seed.workspace.id, envelopeId: seed.envelope.id, requireCertificates: true }),
    ).rejects.toMatchObject({ code: 'SOURCE_DIGEST_MISMATCH' });
    expect(mail.failures).toHaveLength(1);
    expect(memory.uploads.filter((key) => key.includes('/v1/'))).toEqual([]);
    expect(await prisma.esigningIssuedArtifact.count({ where: { envelopeId: seed.envelope.id } })).toBe(0);
    expect(await prisma.esigningEnvelopeEvent.count({ where: { envelopeId: seed.envelope.id, action: 'PDF_GENERATION_FAILED' } })).toBe(1);
  });

  it('only one of several concurrent generators claims the envelope and writes a version', async () => {
    const seed = await seedCompletedEnvelope();

    const results = await Promise.allSettled([
      generate(seed.envelope.id),
      generate(seed.envelope.id),
      generate(seed.envelope.id),
      pdfService.ensureEsigningEnvelopeArtifacts({ tenantId: seed.workspace.id, envelopeId: seed.envelope.id, requireCertificates: true }),
    ]);

    const generated = results.filter((result) => result.status === 'fulfilled' && result.value === 'generated');
    expect(generated).toHaveLength(1);
    for (const result of results) {
      if (result.status === 'rejected') {
        expect((result.reason as { code?: string }).code).toBe('ARTIFACTS_PROCESSING');
      } else {
        expect(['generated', 'already-processing', 'already-completed', undefined]).toContain(result.value);
      }
    }
    const rows = await prisma.esigningIssuedArtifact.findMany({ where: { envelopeId: seed.envelope.id } });
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((row) => row.version))).toEqual(new Set([1]));
    expect(memory.uploads).toHaveLength(3);
    expect((await prisma.esigningEnvelope.findUniqueOrThrow({ where: { id: seed.envelope.id } })).pdfGenerationStatus).toBe('COMPLETED');
  });

  it('rejects a second row for the same envelope, version, kind and document, including the certificate (NULL document)', async () => {
    const seed = await seedCompletedEnvelope();
    await generate(seed.envelope.id);
    const certificate = await prisma.esigningIssuedArtifact.findFirstOrThrow({
      where: { envelopeId: seed.envelope.id, version: 1, kind: 'CERTIFICATE' },
    });

    await expect(
      prisma.esigningIssuedArtifact.create({
        data: {
          tenantId: seed.workspace.id,
          envelopeId: seed.envelope.id,
          documentId: null,
          version: 1,
          kind: 'CERTIFICATE',
          storagePath: 'elsewhere.pdf',
          blake3: 'x',
          byteSize: 1,
          rendererVersion: 12,
          sourceDigests: {},
        },
      }),
    ).rejects.toThrow();
    expect(await prisma.esigningIssuedArtifact.findUniqueOrThrow({ where: { id: certificate.id } })).toEqual(certificate);
  });

  it('refuses to serve a stored file whose bytes changed after issue', async () => {
    const seed = await seedCompletedEnvelope();
    await generate(seed.envelope.id);
    const merged = await prisma.esigningIssuedArtifact.findFirstOrThrow({
      where: { envelopeId: seed.envelope.id, version: 1, kind: 'DOCUMENT_WITH_CERTIFICATE' },
    });
    memory.files.set(merged.storagePath, Buffer.from('%PDF-swapped'));

    await expect(
      pdfService.downloadEsigningDocumentPackage({
        tenantId: seed.workspace.id,
        envelopeId: seed.envelope.id,
        documentId: seed.documents[0].id,
        variant: 'signed_with_certificate',
      }),
    ).rejects.toMatchObject({ code: 'ARTIFACT_HASH_MISMATCH' });
    const send = await sendCompletionEmail(seed, 'swapped');
    expect(send.outcome.status).not.toBe('sent');
  });

  describe('a worker whose lease expired (OAK-008 / OAK-021 review finding 1)', () => {
    const isMergedUpload = (key: string) => key.includes('/with-certificate/');

    async function snapshotPublished(envelopeId: string) {
      const rows = await prisma.esigningIssuedArtifact.findMany({ where: { envelopeId }, orderBy: [{ kind: 'asc' }, { id: 'asc' }] });
      const files = new Map(rows.map((row) => [row.storagePath, Buffer.from(memory.files.get(row.storagePath)!)]));
      const envelope = await prisma.esigningEnvelope.findUniqueOrThrow({ where: { id: envelopeId } });
      const documents = await prisma.esigningEnvelopeDocument.findMany({ where: { envelopeId }, orderBy: { id: 'asc' } });
      return { rows, files, envelope, documents };
    }

    it('cannot overwrite what the replacement worker published, and leaves the COMPLETED envelope alone', async () => {
      const seed = await seedCompletedEnvelope({ documents: 2 });

      // Worker A claims, renders and uploads, then stalls just before its first merged-file upload.
      const hold = holdNextUpload(isMergedUpload);
      const workerA = generate(seed.envelope.id);
      await hold.entered;
      const claimedByA = (await prisma.esigningEnvelope.findUniqueOrThrow({ where: { id: seed.envelope.id } })).pdfGenerationClaimedAt;
      expect(claimedByA).not.toBeNull();

      // A's 15 minute lease runs out; worker B takes over, generates and commits version 1.
      await prisma.esigningEnvelope.update({
        where: { id: seed.envelope.id },
        data: { pdfGenerationClaimedAt: new Date(Date.now() - 20 * 60 * 1000) },
      });
      await expect(generate(seed.envelope.id)).resolves.toBe('generated');
      const published = await snapshotPublished(seed.envelope.id);
      expect(published.envelope.pdfGenerationStatus).toBe('COMPLETED');
      expect(published.envelope.currentArtifactVersion).toBe(1);
      expect(published.rows).toHaveLength(7); // certificate, 2 x (signed + merged), 2 packages
      const uploadsBeforeResume = memory.uploads.length;

      // A resumes: it carries on uploading, then tries to publish.
      hold.release();
      await expect(workerA).resolves.toBe('already-processing');

      // B's rows, files and BLAKE3 hashes are exactly as B left them.
      const after = await snapshotPublished(seed.envelope.id);
      expect(after.rows).toEqual(published.rows);
      for (const row of after.rows) {
        expect(after.files.get(row.storagePath)!.equals(published.files.get(row.storagePath)!)).toBe(true);
        expect(hashBlake3(memory.files.get(row.storagePath)!)).toBe(row.blake3);
      }
      expect(after.documents).toEqual(published.documents);
      // The envelope is still COMPLETED at version 1, with no failure recorded or mailed.
      expect(after.envelope.pdfGenerationStatus).toBe('COMPLETED');
      expect(after.envelope.pdfGenerationError).toBeNull();
      expect(after.envelope.currentArtifactVersion).toBe(1);
      expect(await prisma.esigningEnvelopeEvent.count({ where: { envelopeId: seed.envelope.id, action: 'PDF_GENERATION_FAILED' } })).toBe(0);
      expect(mail.failures).toEqual([]);
      // No object key was ever written twice: A chose the same version as B but its own folder.
      expect(new Set(memory.uploads).size).toBe(memory.uploads.length);
      expect(memory.uploads.length).toBeGreaterThan(uploadsBeforeResume);
      // Everything A wrote that was not published was removed; nothing B published was deleted.
      const publishedPaths = new Set(after.rows.map((row) => row.storagePath));
      expect(memory.deleted.length).toBeGreaterThan(0);
      for (const deleted of memory.deleted) expect(publishedPaths.has(deleted)).toBe(false);
      const leftovers = [...memory.files.keys()].filter((key) => key.includes('/v1/') && !publishedPaths.has(key));
      expect(leftovers).toEqual([]);
      // And the public check still recognises B's file.
      const check = await runCheck(seed.envelope.certificateId, published.files.get(published.rows.find((r) => r.kind === 'DOCUMENT_WITH_CERTIFICATE')!.storagePath)!);
      expect(check.body).toMatchObject({ matched: true, artifact: { version: 1, isCurrent: true } });
    });

    it('cannot mark the envelope FAILED when its own attempt then errors, whether the replacement finished or is still running', async () => {
      const seed = await seedCompletedEnvelope();
      const claimOf = async () => {
        const row = await prisma.esigningEnvelope.findUniqueOrThrow({ where: { id: seed.envelope.id } });
        return { status: row.pdfGenerationStatus, claimId: row.pdfGenerationClaimId, row };
      };

      // Worker A claims and stalls before its first merged upload.
      const holdA = holdNextUpload(isMergedUpload);
      const workerA = generate(seed.envelope.id);
      await holdA.entered;
      const claimA = (await claimOf()).claimId;
      expect(claimA).not.toBeNull();
      // A's lease runs out (only time is simulated: the stored claim of A is not touched otherwise).
      await prisma.esigningEnvelope.update({
        where: { id: seed.envelope.id },
        data: { pdfGenerationClaimedAt: new Date(Date.now() - 20 * 60 * 1000) },
      });

      // Worker B really takes over (a new claim identity) and is still generating.
      const holdB = holdNextUpload(isMergedUpload);
      const workerB = generate(seed.envelope.id);
      await holdB.entered;
      const claimB = (await claimOf()).claimId;
      expect(claimB).not.toBeNull();
      expect(claimB).not.toBe(claimA);

      holdA.fail(new Error('storage unavailable'));
      await expect(workerA).rejects.toThrow('storage unavailable');

      const midFlight = (await claimOf()).row;
      expect(midFlight.pdfGenerationStatus).toBe('PROCESSING');
      expect(midFlight.pdfGenerationClaimId).toBe(claimB);
      expect(midFlight.pdfGenerationError).toBeNull();
      expect(midFlight.pdfGenerationAttempts).toBe(0);
      expect(await prisma.esigningEnvelopeEvent.count({ where: { envelopeId: seed.envelope.id, action: 'PDF_GENERATION_FAILED' } })).toBe(0);
      expect(mail.failures).toEqual([]);

      // B finishes normally.
      holdB.release();
      await expect(workerB).resolves.toBe('generated');
      const published = await snapshotPublished(seed.envelope.id);
      expect(published.envelope.pdfGenerationStatus).toBe('COMPLETED');
      expect(published.envelope.pdfGenerationClaimId).toBeNull();

      // A later worker C stalls, its lease runs out, worker D really completes version 2, then C errors.
      await requestRetry(seed.envelope.id);
      const holdC = holdNextUpload(isMergedUpload);
      const workerC = generate(seed.envelope.id);
      await holdC.entered;
      await prisma.esigningEnvelope.update({
        where: { id: seed.envelope.id },
        data: { pdfGenerationClaimedAt: new Date(Date.now() - 20 * 60 * 1000) },
      });
      await expect(generate(seed.envelope.id)).resolves.toBe('generated');
      const afterD = await snapshotPublished(seed.envelope.id);
      expect(afterD.envelope.pdfGenerationStatus).toBe('COMPLETED');
      expect(afterD.envelope.currentArtifactVersion).toBe(2);

      holdC.fail(new Error('connection reset'));
      await expect(workerC).rejects.toThrow('connection reset');

      const after = await snapshotPublished(seed.envelope.id);
      expect(after.envelope.pdfGenerationStatus).toBe('COMPLETED');
      expect(after.envelope.pdfGenerationAttempts).toBe(0);
      expect(after.rows).toEqual(afterD.rows);
      for (const row of after.rows) {
        expect(after.files.get(row.storagePath)!.equals(afterD.files.get(row.storagePath)!)).toBe(true);
      }
      expect(await prisma.esigningEnvelopeEvent.count({ where: { envelopeId: seed.envelope.id, action: 'PDF_GENERATION_FAILED' } })).toBe(0);
      expect(mail.failures).toEqual([]);
    });

    // Review round 2, blocking 1: the fence is a unique claim identity, not the lease time. A request
    // prepared in the same millisecond as an old claim can install that same timestamp later; it must
    // not be mistaken for the worker whose lease already expired.
    it.each(['publication', 'failure'] as const)(
      'a delayed claim that reuses an expired worker\'s lease time cannot be completed or failed by that stale worker (%s)',
      async (mode) => {
        const seed = await seedCompletedEnvelope();
        const t0 = new Date();
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(t0);
        const realClaim = prisma.esigningEnvelope.updateMany.bind(prisma.esigningEnvelope);
        let releaseDelayedClaim!: () => void;
        let delayedClaimReady!: () => void;
        const delayedReady = new Promise<void>((resolve) => { delayedClaimReady = resolve; });
        const delayedGate = new Promise<void>((resolve) => { releaseDelayedClaim = resolve; });
        let claims = 0;
        // Only the second PROCESSING claim is held, after its arguments (including its lease time and
        // claim id) were computed. Everything it does once released is the real Prisma call.
        const spy = vi.spyOn(prisma.esigningEnvelope, 'updateMany').mockImplementation((async (args: Parameters<typeof realClaim>[0]) => {
          if (args?.data && (args.data as { pdfGenerationStatus?: string }).pdfGenerationStatus === 'PROCESSING' && ++claims === 2) {
            delayedClaimReady();
            await delayedGate;
          }
          return realClaim(args);
        }) as never);
        const observe = (promise: Promise<unknown>) => promise.then((value) => ({ value }), (error: Error) => ({ error }));

        const holdFirst = holdNextUpload(isMergedUpload);
        // Two callers start together: one takes the claim and stalls before its merged upload, the
        // other's prepared claim query is held back.
        const callerOne = observe(generate(seed.envelope.id));
        const callerTwo = observe(generate(seed.envelope.id));
        let holdDelayed: ReturnType<typeof holdNextUpload> | undefined;
        try {
          await Promise.all([holdFirst.entered, delayedReady]);
          const staleClaim = await prisma.esigningEnvelope.findUniqueOrThrow({ where: { id: seed.envelope.id } });
          expect(staleClaim.pdfGenerationStatus).toBe('PROCESSING');
          expect(staleClaim.pdfGenerationClaimedAt?.getTime()).toBe(t0.getTime());

          // The first claim expires. Worker B takes over normally and then fails on a transient error.
          vi.setSystemTime(new Date(t0.getTime() + 20 * 60 * 1000));
          const holdB = holdNextUpload(isMergedUpload);
          const workerB = observe(generate(seed.envelope.id));
          await holdB.entered;
          holdB.fail(new Error('replacement storage failure'));
          expect(await workerB).toMatchObject({ error: { message: 'replacement storage failure' } });
          const afterB = await prisma.esigningEnvelope.findUniqueOrThrow({ where: { id: seed.envelope.id } });
          expect(afterB.pdfGenerationStatus).toBe('FAILED');
          expect(afterB.pdfGenerationAttempts).toBe(1);
          mail.failures.length = 0;

          // The held claim now runs: it matches FAILED and writes the original lease time again.
          holdDelayed = holdNextUpload(isMergedUpload);
          releaseDelayedClaim();
          await holdDelayed.entered;
          const delayedClaim = await prisma.esigningEnvelope.findUniqueOrThrow({ where: { id: seed.envelope.id } });
          expect(delayedClaim.pdfGenerationStatus).toBe('PROCESSING');
          expect(delayedClaim.pdfGenerationClaimedAt?.getTime()).toBe(t0.getTime()); // same lease time as the stale worker's claim
          expect(delayedClaim.pdfGenerationClaimId).not.toBeNull();
          expect(delayedClaim.pdfGenerationClaimId).not.toBe(staleClaim.pdfGenerationClaimId); // a different identity

          // The stale worker (the first claimant) now publishes, or errors.
          if (mode === 'failure') holdFirst.fail(new Error('stale worker storage failure'));
          else holdFirst.release();
          const staleOutcome = await Promise.race([callerOne, callerTwo]);
          if (mode === 'failure') expect(staleOutcome).toMatchObject({ error: { message: 'stale worker storage failure' } });
          else expect(staleOutcome).toEqual({ value: 'already-processing' });

          // Nothing of the delayed claimant's envelope changed: still PROCESSING under its identity.
          const afterStale = await prisma.esigningEnvelope.findUniqueOrThrow({ where: { id: seed.envelope.id } });
          expect(afterStale.pdfGenerationStatus).toBe('PROCESSING');
          expect(afterStale.pdfGenerationClaimId).toBe(delayedClaim.pdfGenerationClaimId);
          expect(afterStale.pdfGenerationAttempts).toBe(1);
          expect(afterStale.pdfGenerationError).toBeNull();
          expect(afterStale.currentArtifactVersion).toBeNull();
          expect(await prisma.esigningIssuedArtifact.count({ where: { envelopeId: seed.envelope.id } })).toBe(0);
          expect(await prisma.esigningEnvelopeEvent.count({ where: { envelopeId: seed.envelope.id, action: 'PDF_GENERATION_FAILED' } })).toBe(1); // worker B's own, nothing from the stale worker
          expect(mail.failures).toEqual([]);
          expect(mail.completion).toEqual([]);

          // The delayed claimant still finishes its own work.
          holdDelayed.release();
          const finished = await Promise.all([callerOne, callerTwo]);
          expect(finished.filter((outcome) => 'value' in outcome && outcome.value === 'generated')).toHaveLength(1);
          const done = await prisma.esigningEnvelope.findUniqueOrThrow({ where: { id: seed.envelope.id } });
          expect(done.pdfGenerationStatus).toBe('COMPLETED');
          expect(done.pdfGenerationClaimId).toBeNull();
          expect(done.currentArtifactVersion).toBe(1);
          expect(await prisma.esigningIssuedArtifact.count({ where: { envelopeId: seed.envelope.id, version: 1 } })).toBe(3);
          expect(mail.failures).toEqual([]);
        } finally {
          releaseDelayedClaim();
          holdFirst.release();
          holdDelayed?.release();
          await Promise.allSettled([callerOne, callerTwo]);
          spy.mockRestore();
          vi.useRealTimers();
        }
      },
    );
  });

  describe('signing-session download of the signed document (review round 2, blocking 2)', () => {
    async function downloadAsRecipient(seed: Awaited<ReturnType<typeof seedCompletedEnvelope>>) {
      const signing = await import('@/services/esigning-signing.service');
      signingSession.claims = {
        recipientId: seed.recipient.id,
        envelopeId: seed.envelope.id,
        sessionVersion: seed.recipient.sessionVersion,
      };
      try {
        return await signing.downloadEsigningSessionDocument({ documentId: seed.documents[0].id, variant: 'signed' });
      } finally {
        signingSession.claims = null;
      }
    }

    it('recovers on the first request when the stored signed file is missing: ensure issues version 2 and the download serves it', async () => {
      const seed = await seedCompletedEnvelope();
      await generate(seed.envelope.id);
      const v1 = (await currentRows(seed.envelope.id)).rows.find((row) => row.kind === 'SIGNED_DOCUMENT')!;
      memory.files.delete(v1.storagePath);

      const result = await downloadAsRecipient(seed);

      const { envelope, rows } = await currentRows(seed.envelope.id);
      expect(envelope.currentArtifactVersion).toBe(2);
      const v2 = rows.find((row) => row.kind === 'SIGNED_DOCUMENT')!;
      expect(v2.storagePath).not.toBe(v1.storagePath);
      expect(hashBlake3(result.buffer)).toBe(v2.blake3);
      expect(result.buffer.equals(memory.files.get(v2.storagePath)!)).toBe(true);
      // The recorded fingerprint of version 1 is kept for verifying copies issued earlier.
      expect(await prisma.esigningIssuedArtifact.findUniqueOrThrow({ where: { id: v1.id } })).toMatchObject({ version: 1, blake3: v1.blake3 });
      expect(mail.failures).toEqual([]);
    });

    it('serves the current stored file when nothing is missing, without issuing a new version', async () => {
      const seed = await seedCompletedEnvelope();
      await generate(seed.envelope.id);
      const v1 = (await currentRows(seed.envelope.id)).rows.find((row) => row.kind === 'SIGNED_DOCUMENT')!;
      const result = await downloadAsRecipient(seed);
      expect(hashBlake3(result.buffer)).toBe(v1.blake3);
      expect((await currentRows(seed.envelope.id)).envelope.currentArtifactVersion).toBe(1);
    });

    it('refuses a stored signed file whose bytes changed after issue, instead of serving them', async () => {
      const seed = await seedCompletedEnvelope();
      await generate(seed.envelope.id);
      const v1 = (await currentRows(seed.envelope.id)).rows.find((row) => row.kind === 'SIGNED_DOCUMENT')!;
      memory.files.set(v1.storagePath, Buffer.from('%PDF-swapped-issued-document'));

      await expect(downloadAsRecipient(seed)).rejects.toMatchObject({ code: 'ARTIFACT_HASH_MISMATCH' });
      expect(memory.files.get(v1.storagePath)!.toString()).toBe('%PDF-swapped-issued-document');
    });
  });

  describe('tenant scoping (review finding 2)', () => {
    it('rejects an envelope id from another workspace before any generation, storage access or write', async () => {
      const owner = await seedCompletedEnvelope({ documents: 2 });
      const other = await seedCompletedEnvelope();
      const foreign = other.workspace.id;
      const envelopeBefore = await prisma.esigningEnvelope.findUniqueOrThrow({ where: { id: owner.envelope.id } });
      memory.reads.length = 0;
      memory.uploads.length = 0;

      const attempts = [
        pdfService.generateEsigningEnvelopeArtifactsNow({ tenantId: foreign, envelopeId: owner.envelope.id }),
        pdfService.ensureEsigningEnvelopeArtifacts({ tenantId: foreign, envelopeId: owner.envelope.id, requireCertificates: true }),
        pdfService.downloadEsigningEnvelopePackage({ tenantId: foreign, envelopeId: owner.envelope.id }),
        pdfService.downloadEsigningDocumentPackage({ tenantId: foreign, envelopeId: owner.envelope.id, documentId: owner.documents[0].id, variant: 'signed_with_certificate' }),
        filingSource.downloadSharePointFilingSource({ tenantId: foreign, envelopeId: owner.envelope.id, envelopeDocumentId: owner.documents[0].id, signedStoragePath: null }),
      ];
      const results = await Promise.allSettled(attempts);
      for (const result of results) {
        expect(result.status).toBe('rejected');
      }
      expect((results[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'ENVELOPE_NOT_FOUND' });
      expect((results[4] as PromiseRejectedResult).reason).toMatchObject({ code: 'SOURCE_INVALID', retryable: false });

      // No side effects: nothing read or written in storage, the envelope untouched, nothing issued, nothing mailed.
      expect(memory.reads).toEqual([]);
      expect(memory.uploads).toEqual([]);
      expect(await prisma.esigningEnvelope.findUniqueOrThrow({ where: { id: owner.envelope.id } })).toEqual(envelopeBefore);
      expect(await prisma.esigningIssuedArtifact.count({ where: { envelopeId: owner.envelope.id } })).toBe(0);
      expect(await prisma.esigningEnvelopeEvent.count({ where: { envelopeId: owner.envelope.id, action: 'PDF_GENERATION_FAILED' } })).toBe(0);
      expect(mail.failures).toEqual([]);
    });

    it('rejects foreign-tenant requests for an envelope that already has issued files, without reading them', async () => {
      const owner = await seedCompletedEnvelope();
      const other = await seedCompletedEnvelope();
      await generate(owner.envelope.id);
      const rowsBefore = await prisma.esigningIssuedArtifact.findMany({ where: { envelopeId: owner.envelope.id }, orderBy: { id: 'asc' } });
      memory.reads.length = 0;
      memory.uploads.length = 0;

      await expect(
        filingSource.downloadSharePointFilingSource({ tenantId: other.workspace.id, envelopeId: owner.envelope.id, envelopeDocumentId: owner.documents[0].id, signedStoragePath: null }),
      ).rejects.toMatchObject({ code: 'SOURCE_INVALID' });
      await expect(
        pdfService.downloadEsigningEnvelopePackage({ tenantId: other.workspace.id, envelopeId: owner.envelope.id, variant: 'certificates' }),
      ).rejects.toThrow();
      await expect(issued.getCurrentIssuedVersion(other.workspace.id, owner.envelope.id)).resolves.toBeNull();
      await expect(
        issued.getCurrentDocumentArtifact(other.workspace.id, owner.envelope.id, owner.documents[0].id, 'SIGNED_DOCUMENT'),
      ).rejects.toMatchObject({ code: 'ARTIFACT_NOT_FOUND' });
      expect(memory.reads).toEqual([]);
      expect(memory.uploads).toEqual([]);
      expect(await prisma.esigningIssuedArtifact.findMany({ where: { envelopeId: owner.envelope.id }, orderBy: { id: 'asc' } })).toEqual(rowsBefore);

      // The owning workspace is unaffected, and the filing source returns the stored merged file.
      const filed = await filingSource.downloadSharePointFilingSource({ tenantId: owner.workspace.id, envelopeId: owner.envelope.id, envelopeDocumentId: owner.documents[0].id, signedStoragePath: null });
      expect(hashBlake3(filed)).toBe(rowsBefore.find((row) => row.kind === 'DOCUMENT_WITH_CERTIFICATE')!.blake3);
      // A document id of another envelope is no use under the right tenant either.
      await expect(
        filingSource.downloadSharePointFilingSource({ tenantId: owner.workspace.id, envelopeId: owner.envelope.id, envelopeDocumentId: other.documents[0].id, signedStoragePath: null }),
      ).rejects.toMatchObject({ code: 'SOURCE_NOT_READY' });
    });

    it('the public lookup discovers the workspace from the certificate id and then stays inside it', async () => {
      const owner = await seedCompletedEnvelope();
      const other = await seedCompletedEnvelope();
      await generate(owner.envelope.id);
      await generate(other.envelope.id);
      const ownerMerged = await prisma.esigningIssuedArtifact.findFirstOrThrow({ where: { envelopeId: owner.envelope.id, kind: 'DOCUMENT_WITH_CERTIFICATE' } });

      // The other envelope's certificate id does not recognise this envelope's file, and vice versa.
      const crossed = await runCheck(other.envelope.certificateId, memory.files.get(ownerMerged.storagePath)!);
      expect(crossed.body.matched).toBe(false);
      const own = await runCheck(owner.envelope.certificateId, memory.files.get(ownerMerged.storagePath)!);
      expect(own.body.matched).toBe(true);
    });
  });

  describe('multi-document envelopes (review finding 3)', () => {
    async function pageCount(buffer: Buffer) {
      return (await PDFDocument.load(new Uint8Array(buffer))).getPageCount();
    }

    it('downloads the stored, fingerprinted package: it passes the public check, a modified copy does not', async () => {
      const seed = await seedCompletedEnvelope({ documents: 2 });
      await generate(seed.envelope.id);
      const rows = await prisma.esigningIssuedArtifact.findMany({ where: { envelopeId: seed.envelope.id, version: 1 } });
      const withCertificate = rows.find((row) => row.kind === 'PACKAGE_DOCUMENTS_WITH_CERTIFICATE')!;
      const documentsOnly = rows.find((row) => row.kind === 'PACKAGE_DOCUMENTS')!;
      expect(withCertificate.documentId).toBeNull();
      expect(documentsOnly.documentId).toBeNull();
      memory.uploads.length = 0;

      const download = await pdfService.downloadEsigningEnvelopePackage({
        tenantId: seed.workspace.id,
        envelopeId: seed.envelope.id,
        variant: 'documents_with_certificates',
      });

      // Stored bytes, served as they are: same hash as recorded, nothing merged or written on request.
      expect(hashBlake3(download.buffer)).toBe(withCertificate.blake3);
      expect(download.buffer.equals(memory.files.get(withCertificate.storagePath)!)).toBe(true);
      expect(memory.uploads).toEqual([]);
      expect(await pageCount(download.buffer)).toBeGreaterThanOrEqual(3); // two signed documents + the certificate
      const again = await pdfService.downloadEsigningEnvelopePackage({ tenantId: seed.workspace.id, envelopeId: seed.envelope.id });
      expect(again.buffer.equals(download.buffer)).toBe(true);

      // Real route, real lookup: the untouched download is recognised, one flipped byte is not.
      const ok = await runCheck(seed.envelope.certificateId, download.buffer);
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({
        matched: true,
        fileHash: withCertificate.blake3,
        document: null,
        artifact: { kind: 'PACKAGE_DOCUMENTS_WITH_CERTIFICATE', version: 1, isCurrent: true, source: 'ISSUED_ARTIFACT' },
      });
      const modified = Buffer.from(download.buffer);
      modified[Math.floor(modified.length / 2)] ^= 0x01;
      const bad = await runCheck(seed.envelope.certificateId, modified);
      expect(bad.body).toMatchObject({ matched: false, document: null, artifact: null });

      // The documents-only package is stored and recognised the same way.
      const docsDownload = await pdfService.downloadEsigningEnvelopePackage({
        tenantId: seed.workspace.id,
        envelopeId: seed.envelope.id,
        variant: 'documents',
      });
      expect(hashBlake3(docsDownload.buffer)).toBe(documentsOnly.blake3);
      expect(await pageCount(docsDownload.buffer)).toBe(2);
      const docsOk = await runCheck(seed.envelope.certificateId, docsDownload.buffer);
      expect(docsOk.body).toMatchObject({ matched: true, artifact: { kind: 'PACKAGE_DOCUMENTS' } });
      const docsModified = Buffer.from(docsDownload.buffer);
      docsModified[Math.floor(docsModified.length / 3)] ^= 0x01;
      expect((await runCheck(seed.envelope.certificateId, docsModified)).body.matched).toBe(false);
      expect(memory.uploads).toEqual([]);
    });

    it('records the package for a multi-document version that was issued without one, once, from the stored files', async () => {
      const seed = await seedCompletedEnvelope({ documents: 2 });
      await generate(seed.envelope.id);
      const packages = await prisma.esigningIssuedArtifact.findMany({
        where: { envelopeId: seed.envelope.id, kind: { in: ['PACKAGE_DOCUMENTS', 'PACKAGE_DOCUMENTS_WITH_CERTIFICATE'] } },
      });
      expect(packages).toHaveLength(2);
      // Simulate a version issued before packages were recorded.
      await prisma.esigningIssuedArtifact.deleteMany({ where: { id: { in: packages.map((row) => row.id) } } });
      for (const row of packages) memory.files.delete(row.storagePath);
      memory.uploads.length = 0;

      const first = await pdfService.downloadEsigningEnvelopePackage({ tenantId: seed.workspace.id, envelopeId: seed.envelope.id });
      const second = await pdfService.downloadEsigningEnvelopePackage({ tenantId: seed.workspace.id, envelopeId: seed.envelope.id });

      expect(second.buffer.equals(first.buffer)).toBe(true);
      expect(memory.uploads).toHaveLength(1); // written once, then served as stored
      expect(memory.uploads[0]).toBe(`${seed.workspace.id}/esigning/${seed.envelope.id}/v1/package/documents-with-certificate.pdf`);
      expect(await prisma.esigningIssuedArtifact.count({ where: { envelopeId: seed.envelope.id, kind: 'PACKAGE_DOCUMENTS_WITH_CERTIFICATE' } })).toBe(1);
      expect((await prisma.esigningEnvelope.findUniqueOrThrow({ where: { id: seed.envelope.id } })).currentArtifactVersion).toBe(1);
      const check = await runCheck(seed.envelope.certificateId, first.buffer);
      expect(check.body).toMatchObject({ matched: true, artifact: { kind: 'PACKAGE_DOCUMENTS_WITH_CERTIFICATE', version: 1, isCurrent: true } });
    });
  });

  describe('envelopes completed before issued artifacts were recorded', () => {
    /** What the migration leaves behind: signed files at the legacy keys, a v1 document-only row, no certificate rows. */
    async function seedLegacyEnvelope() {
      const seed = await seedCompletedEnvelope();
      const document = seed.documents[0];

      const signedPdf = await PDFDocument.create();
      signedPdf.addPage([595, 842]);
      const signedBytes = Buffer.from(await signedPdf.save());
      const signedPath = `${seed.workspace.id}/esigning/${seed.envelope.id}/signed/${document.id}.pdf`;
      memory.files.set(signedPath, signedBytes);

      const certificatePdf = await PDFDocument.create();
      certificatePdf.addPage([595, 842]);
      certificatePdf.addPage([595, 842]);
      const certificateBytes = Buffer.from(await certificatePdf.save());
      const certificatePath = `${seed.workspace.id}/esigning/${seed.envelope.id}/certificate.pdf`;
      memory.files.set(certificatePath, certificateBytes);

      await prisma.esigningEnvelopeDocument.update({
        where: { id: document.id },
        data: { signedStoragePath: signedPath, signedHash: hashBlake3(signedBytes) },
      });
      await prisma.esigningEnvelope.update({
        where: { id: seed.envelope.id },
        data: {
          pdfGenerationStatus: 'COMPLETED',
          currentArtifactVersion: 1,
          metadata: { artifactVersion: 11 },
        },
      });
      await prisma.esigningIssuedArtifact.create({
        data: {
          tenantId: seed.workspace.id,
          envelopeId: seed.envelope.id,
          documentId: document.id,
          version: 1,
          kind: 'SIGNED_DOCUMENT',
          storagePath: signedPath,
          blake3: hashBlake3(signedBytes),
          byteSize: null,
          rendererVersion: 11,
          sourceDigests: { backfilled: true, origin: 'migration', originalHashes: { [document.id]: hashBlake3(document.originalBytes) } },
        },
      });
      return { ...seed, signedBytes, certificateBytes, signedPath, certificatePath };
    }

    it('backfills the certificate and merged rows once, from the stored files, without re-rendering', async () => {
      const legacy = await seedLegacyEnvelope();
      memory.uploads.length = 0;

      const { outcome, attachments } = await sendCompletionEmail(legacy, 'legacy');

      expect(outcome.status).toBe('sent');
      // Only the merged file is written, under the v1 path; nothing is re-rendered or regenerated.
      expect(memory.uploads).toEqual([
        `${legacy.workspace.id}/esigning/${legacy.envelope.id}/v1/with-certificate/${legacy.documents[0].id}.pdf`,
      ]);
      const rows = await prisma.esigningIssuedArtifact.findMany({ where: { envelopeId: legacy.envelope.id }, orderBy: { kind: 'asc' } });
      expect(rows.map((row) => `${row.version}:${row.kind}`).sort()).toEqual([
        '1:CERTIFICATE',
        '1:DOCUMENT_WITH_CERTIFICATE',
        '1:SIGNED_DOCUMENT',
      ]);
      const certificateRow = rows.find((row) => row.kind === 'CERTIFICATE')!;
      expect(certificateRow.storagePath).toBe(legacy.certificatePath);
      expect(certificateRow.blake3).toBe(hashBlake3(legacy.certificateBytes));
      expect(rows.find((row) => row.kind === 'SIGNED_DOCUMENT')!.blake3).toBe(hashBlake3(legacy.signedBytes));
      const mergedRow = rows.find((row) => row.kind === 'DOCUMENT_WITH_CERTIFICATE')!;
      expect(hashBlake3(attachments[0].content)).toBe(mergedRow.blake3);
      expect((await PDFDocument.load(new Uint8Array(attachments[0].content))).getPageCount()).toBe(3);
      expect((await prisma.esigningEnvelope.findUniqueOrThrow({ where: { id: legacy.envelope.id } })).currentArtifactVersion).toBe(1);

      // A second send and the filing source reuse it: no further writes, identical bytes.
      memory.uploads.length = 0;
      const again = await sendCompletionEmail(legacy, 'legacy-again');
      expect(again.attachments[0].content.equals(attachments[0].content)).toBe(true);
      const filed = await filingSource.downloadSharePointFilingSource({
        tenantId: legacy.workspace.id,
        envelopeId: legacy.envelope.id,
        envelopeDocumentId: legacy.documents[0].id,
        signedStoragePath: legacy.signedPath,
      });
      expect(filed.equals(attachments[0].content)).toBe(true);
      expect(memory.uploads).toEqual([]);
      expect(await prisma.esigningIssuedArtifact.count({ where: { envelopeId: legacy.envelope.id } })).toBe(3);

      const check = await runCheck(legacy.envelope.certificateId, attachments[0].content);
      expect(check.body).toMatchObject({ matched: true, artifact: { kind: 'DOCUMENT_WITH_CERTIFICATE', version: 1, isCurrent: true } });
    });

    it('two concurrent first deliveries leave one consistent set of rows', async () => {
      const legacy = await seedLegacyEnvelope();

      const [first, second] = await Promise.all([
        sendCompletionEmail(legacy, 'a'),
        sendCompletionEmail(legacy, 'b'),
      ]);

      expect(first.outcome.status).toBe('sent');
      expect(second.outcome.status).toBe('sent');
      const rows = await prisma.esigningIssuedArtifact.findMany({ where: { envelopeId: legacy.envelope.id } });
      expect(rows).toHaveLength(3);
      const merged = rows.find((row) => row.kind === 'DOCUMENT_WITH_CERTIFICATE')!;
      expect(hashBlake3(memory.files.get(merged.storagePath)!)).toBe(merged.blake3);
      expect(first.attachments[0].content.equals(second.attachments[0].content)).toBe(true);
    });

    it('adds no per-envelope flag to the public data, and still matches files filed to SharePoint by their SHA-256', async () => {
      const legacy = await seedLegacyEnvelope();

      const before = await certificateService.getEsigningVerificationData(legacy.envelope.certificateId);
      expect(before).not.toHaveProperty('emailedCopiesVerifiable');

      // A file filed to SharePoint before this release: only its SHA-256 was recorded on the filing.
      const filedBefore = Buffer.from('%PDF-filed-before-the-change');
      const connector = await prisma.connector.create({
        data: { workspaceId: legacy.workspace.id, name: 'SharePoint', type: 'STORAGE', provider: 'SHAREPOINT', credentials: 'not-used' },
      });
      await prisma.esigningSharePointFiling.create({
        data: {
          tenantId: legacy.workspace.id,
          envelopeId: legacy.envelope.id,
          envelopeDocumentId: legacy.documents[0].id,
          connectorId: connector.id,
          destinationKind: 'ORPHAN',
          routingReason: 'NO_COMPANY_MAPPING',
          configVersion: 1,
          documentTitleSnapshot: 'Agreement',
          orphanDriveId: 'drive',
          orphanFolderItemId: 'folder',
          sourceSignedHash: sha256(filedBefore),
          status: 'COMPLETED',
          filedAt: new Date('2026-10-01T00:00:00.000Z'),
        },
      });

      const match = await runCheck(legacy.envelope.certificateId, filedBefore);
      expect(match.body).toMatchObject({
        matched: true,
        document: { id: legacy.documents[0].id },
        artifact: { source: 'SHAREPOINT_FILING_RECORD', isCurrent: false, version: null, issuedAt: '2026-10-01T00:00:00.000Z' },
      });
      const unrelated = await runCheck(legacy.envelope.certificateId, Buffer.from('%PDF-something-else'));
      expect(unrelated.body.matched).toBe(false);
    });

    it('the public verification response carries exactly the previously approved fields', async () => {
      const seed = await seedCompletedEnvelope();
      await generate(seed.envelope.id);

      const data = await certificateService.getEsigningVerificationData(seed.envelope.certificateId);

      expect(Object.keys(data).sort()).toEqual([
        'certificateId',
        'companyName',
        'completedAt',
        'documents',
        'envelopeId',
        'events',
        'recipients',
        'status',
        'tenantName',
        'title',
      ]);
    });
  });
});
