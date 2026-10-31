// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { hashBlake3 } from '@/lib/encryption';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { extractPdfPageTexts } from '../helpers/pdf-text';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (process.env.CI === 'true' && !testDatabaseUrl) {
  describe('E-signing Unicode PDF PostgreSQL configuration', () => {
    it('requires TEST_DATABASE_URL in CI', () => {
      throw new Error('TEST_DATABASE_URL must reference an isolated PostgreSQL test database in CI');
    });
  });
}

// Real PDF generation and real database; only object storage is swapped for memory.
const memoryStorage = vi.hoisted(() => new Map<string, Buffer>());

vi.mock('@/lib/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/storage')>();
  return {
    ...actual,
    storage: {
      upload: async (key: string, data: Buffer) => {
        memoryStorage.set(key, Buffer.from(data));
      },
      download: async (key: string) => {
        const data = memoryStorage.get(key);
        if (!data) throw new Error(`missing object ${key}`);
        return data;
      },
      exists: async (key: string) => memoryStorage.has(key),
    },
  };
});

vi.mock('@/services/esigning-notification.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/esigning-notification.service')>()),
  sendEsigningPdfFailureEmailToSender: vi.fn(async () => undefined),
}));

const describePostgres = testDatabaseUrl ? describe : describe.skip;

const SIGNERS = [
  { name: 'John Tan', value: 'John Tan' },
  { name: 'Tan Wei Ming 陈伟明', value: 'Tan Wei Ming 陈伟明' },
  { name: 'Nguyễn Văn A', value: 'Nguyễn Văn A' },
  { name: 'Priya Rao', value: 'Fee: ₹1,50,000' },
] as const;

describePostgres('e-signing signed PDF with non-Latin field values (real generation)', () => {
  let prisma: Awaited<ReturnType<typeof import('@/lib/prisma')['getPrisma']>>;
  let generateEsigningEnvelopeArtifactsNow: typeof import('@/services/esigning-pdf.service')['generateEsigningEnvelopeArtifactsNow'];
  let saveRecipientFieldValues: typeof import('@/services/esigning-field.service')['saveRecipientFieldValues'];
  const tenantIds: string[] = [];
  const previousLogLevel = process.env.LOG_LEVEL;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.LOG_LEVEL = 'silent';
    prisma = (await import('@/lib/prisma')).getPrisma();
    ({ generateEsigningEnvelopeArtifactsNow } = await import('@/services/esigning-pdf.service'));
    ({ saveRecipientFieldValues } = await import('@/services/esigning-field.service'));
  });

  afterEach(async () => {
    memoryStorage.clear();
    for (const tenantId of tenantIds.splice(0)) {
      await prisma.auditLog.deleteMany({ where: { tenantId } });
      await prisma.esigningEnvelope.deleteMany({ where: { tenantId } });
      await prisma.user.deleteMany({ where: { tenantId } });
      await prisma.workspace.delete({ where: { id: tenantId } });
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
    if (previousLogLevel === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = previousLogLevel;
  });

  async function seedCompletedEnvelope() {
    const suffix = randomUUID();
    const workspace = await prisma.workspace.create({
      data: { name: `Unicode PDF ${suffix}`, slug: `unicode-pdf-${suffix}` },
    });
    tenantIds.push(workspace.id);
    const user = await prisma.user.create({
      data: {
        tenantId: workspace.id,
        email: `unicode-${suffix}@example.test`,
        passwordHash: 'not-used',
        firstName: 'E-signing',
        lastName: 'Sender',
      },
    });
    const envelope = await prisma.esigningEnvelope.create({
      data: {
        tenantId: workspace.id,
        createdById: user.id,
        title: '服务协议 Services Agreement',
        status: 'COMPLETED',
        signingOrder: 'PARALLEL',
        certificateId: `OAK-ES-${suffix.slice(0, 8)}`,
        completedAt: new Date('2026-08-11T00:00:00.000Z'),
        pdfGenerationStatus: 'PENDING',
        pdfGenerationAttempts: 0,
      },
    });

    const original = await PDFDocument.create();
    original.addPage([595, 842]);
    const originalBytes = Buffer.from(await original.save());
    const storagePath = `original/${workspace.id}/${envelope.id}/agreement.pdf`;
    memoryStorage.set(storagePath, originalBytes);
    const document = await prisma.esigningEnvelopeDocument.create({
      data: {
        tenantId: workspace.id,
        envelopeId: envelope.id,
        fileName: 'agreement.pdf',
        storagePath,
        originalHash: hashBlake3(originalBytes),
        pageCount: 1,
        sortOrder: 1,
        fileSize: originalBytes.byteLength,
      },
    });

    const fields: Array<{ id: string; recipientId: string; value: string }> = [];
    for (const [index, signer] of SIGNERS.entries()) {
      const recipient = await prisma.esigningEnvelopeRecipient.create({
        data: {
          tenantId: workspace.id,
          envelopeId: envelope.id,
          type: 'SIGNER',
          name: signer.name,
          email: `signer-${index}-${suffix}@example.test`,
          status: 'SIGNED',
          signedAt: new Date('2026-08-11T00:00:00.000Z'),
          colorTag: '#06b6d4',
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
          yPercent: 0.1 + index * 0.08,
          widthPercent: 0.7,
          heightPercent: 0.04,
          sortOrder: index + 1,
        },
      });
      fields.push({ id: field.id, recipientId: recipient.id, value: signer.value });
    }
    return { workspace, envelope, document, fields };
  }

  it('saves and prints Latin, Vietnamese, CJK and rupee values in the signed PDF and certificate', async () => {
    const { workspace, envelope, document, fields } = await seedCompletedEnvelope();

    // The real signing save path, so the stored value is what the PDF draws.
    for (const field of fields) {
      await saveRecipientFieldValues({
        tenantId: workspace.id,
        envelopeId: envelope.id,
        recipientId: field.recipientId,
        finalize: true,
        values: [{ fieldDefinitionId: field.id, value: field.value }],
      });
    }

    await expect(generateEsigningEnvelopeArtifactsNow({ tenantId: envelope.tenantId, envelopeId: envelope.id })).resolves.toBe('generated');

    const finished = await prisma.esigningEnvelope.findUniqueOrThrow({ where: { id: envelope.id } });
    expect(finished.pdfGenerationStatus).toBe('COMPLETED');
    expect(finished.pdfGenerationError).toBeNull();

    const updatedDocument = await prisma.esigningEnvelopeDocument.findUniqueOrThrow({ where: { id: document.id } });
    expect(updatedDocument.signedStoragePath).toBeTruthy();
    expect(updatedDocument.signedHash).toBeTruthy();

    const signed = memoryStorage.get(updatedDocument.signedStoragePath as string) as Buffer;
    const [signedText] = await extractPdfPageTexts(new Uint8Array(signed));
    for (const signer of SIGNERS) {
      expect(signedText).toContain(signer.value);
    }
    // Text drawn on the page stays a valid, small PDF: only the used glyphs are embedded.
    expect(signed.byteLength).toBeLessThan(200 * 1024);

    const certificatePath = `certificate/${workspace.id}/${envelope.id}.pdf`;
    const certificateKey = [...memoryStorage.keys()].find((key) => key.includes(envelope.id) && key.includes('certificate')) ?? certificatePath;
    const certificateText = (await extractPdfPageTexts(new Uint8Array(memoryStorage.get(certificateKey) as Buffer))).join('\n');
    expect(certificateText).toContain('Tan Wei Ming 陈伟明');
    expect(certificateText).toContain('Nguyễn Văn A');
  });

  it('refuses unsupported characters when the value is saved, long before the PDF is built', async () => {
    const { workspace, envelope, fields } = await seedCompletedEnvelope();

    await expect(
      saveRecipientFieldValues({
        tenantId: workspace.id,
        envelopeId: envelope.id,
        recipientId: fields[0].recipientId,
        values: [{ fieldDefinitionId: fields[0].id, value: 'Wei 😀' }],
      })
    ).rejects.toThrow(/cannot be printed on the signed document: "😀"/);

    expect(await prisma.esigningDocumentFieldValue.count({ where: { fieldDefinitionId: fields[0].id } })).toBe(0);
  });

  it('still completes PDF generation for a value stored before validation existed (drawn as "?")', async () => {
    const { workspace, envelope, fields } = await seedCompletedEnvelope();
    await prisma.esigningDocumentFieldValue.create({
      data: {
        tenantId: workspace.id,
        fieldDefinitionId: fields[0].id,
        recipientId: fields[0].recipientId,
        value: 'Legacy 😀 value',
        finalizedAt: new Date('2026-08-11T00:00:00.000Z'),
      },
    });

    await expect(generateEsigningEnvelopeArtifactsNow({ tenantId: envelope.tenantId, envelopeId: envelope.id })).resolves.toBe('generated');

    const finished = await prisma.esigningEnvelope.findUniqueOrThrow({ where: { id: envelope.id } });
    expect(finished.pdfGenerationStatus).toBe('COMPLETED');
  });
});
