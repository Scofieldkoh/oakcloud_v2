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

const memory = vi.hoisted(() => ({
  files: new Map<string, Buffer>(),
  uploads: [] as string[],
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
        memory.uploads.push(key);
        memory.files.set(key, Buffer.from(data));
      },
      download: async (key: string) => {
        const data = memory.files.get(key);
        if (!data) throw new Error(`missing object ${key}`);
        return Buffer.from(data);
      },
      exists: async (key: string) => memory.files.has(key),
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

  async function generate(envelopeId: string) {
    return pdfService.generateEsigningEnvelopeArtifactsNow({ envelopeId });
  }

  /** Mark a failed/finished envelope for an explicit retry, as "Retry processing" does. */
  async function requestRetry(envelopeId: string) {
    await prisma.esigningEnvelope.update({
      where: { id: envelopeId },
      data: { pdfGenerationStatus: 'PENDING', pdfGenerationError: null, pdfGenerationClaimedAt: null },
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
    expect(merged.storagePath).toBe(
      `${seed.workspace.id}/esigning/${seed.envelope.id}/v1/with-certificate/${seed.documents[0].id}.pdf`,
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

    await pdfService.ensureEsigningEnvelopeArtifacts({ envelopeId: seed.envelope.id, requireCertificates: true });
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

    await pdfService.ensureEsigningEnvelopeArtifacts({ envelopeId: seed.envelope.id, requireCertificates: true });

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
    await pdfService.ensureEsigningEnvelopeArtifacts({ envelopeId: seed.envelope.id, requireCertificates: true });
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
      pdfService.ensureEsigningEnvelopeArtifacts({ envelopeId: seed.envelope.id, requireCertificates: true }),
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
      pdfService.ensureEsigningEnvelopeArtifacts({ envelopeId: seed.envelope.id, requireCertificates: true }),
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

    it('tells the verify page that earlier emailed copies cannot be verified, and still matches files filed to SharePoint by their SHA-256', async () => {
      const legacy = await seedLegacyEnvelope();

      const before = await certificateService.getEsigningVerificationData(legacy.envelope.certificateId);
      expect(before.emailedCopiesVerifiable).toBe(false);

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

    it('a newly generated envelope has verifiable emailed copies', async () => {
      const seed = await seedCompletedEnvelope();
      await generate(seed.envelope.id);

      const data = await certificateService.getEsigningVerificationData(seed.envelope.certificateId);

      expect(data.emailedCopiesVerifiable).toBe(true);
    });
  });
});
