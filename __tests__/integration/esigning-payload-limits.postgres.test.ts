// @vitest-environment node
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * OAK-009: signature images are decoded and re-encoded before they are stored, and an invalid image
 * is refused before the signing transaction can finalize anything. These tests run the real signing
 * service against PostgreSQL with only storage, PDF generation and notifications replaced.
 */

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (process.env.CI === 'true' && !testDatabaseUrl) {
  describe('E-signing payload limits PostgreSQL configuration', () => {
    it('requires TEST_DATABASE_URL in CI', () => {
      throw new Error('TEST_DATABASE_URL must reference an isolated PostgreSQL test database in CI');
    });
  });
}

const sessionContext = new AsyncLocalStorage<{ recipientId: string; envelopeId: string }>();

const storageMocks = vi.hoisted(() => {
  const files = new Map<string, Buffer>();
  return {
    files,
    upload: vi.fn(async (path: string, body: Buffer) => {
      files.set(path, body);
    }),
    download: vi.fn(async (path: string) => {
      const body = files.get(path);
      if (!body) throw new Error(`no such file ${path}`);
      return body;
    }),
  };
});

vi.mock('@/lib/esigning-session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/esigning-session')>();
  return {
    ...actual,
    getEsigningSessionClaims: vi.fn(async () => {
      const store = sessionContext.getStore();
      return store
        ? { ...store, sessionVersion: 1, sessionId: 'limits-session', scope: 'esigning_session' }
        : null;
    }),
    clearEsigningSessionCookie: vi.fn(async () => undefined),
  };
});

vi.mock('@/lib/storage', () => ({
  storage: {
    download: storageMocks.download,
    upload: storageMocks.upload,
    exists: vi.fn(async () => true),
  },
  StorageKeys: {
    esigningSignatureAsset: (tenantId: string, envelopeId: string, recipientId: string, kind: string) =>
      `esigning/${tenantId}/${envelopeId}/${recipientId}/${kind}.png`,
  },
}));

vi.mock('@/services/esigning-pdf.service', () => ({
  generateEsigningEnvelopeArtifactsNow: vi.fn(async () => 'generated'),
}));

vi.mock('@/services/tasks/integration.service', () => ({
  safelyReconcileEsigningEnvelopeTaskOutcomes: vi.fn(async () => undefined),
  safelyCaptureEsigningTaskStageIds: vi.fn(async () => undefined),
  safelyReconcileTaskStageIds: vi.fn(async () => undefined),
}));

const describePostgres = testDatabaseUrl ? describe : describe.skip;

const PNG_TRAILER = 'TRAILING-BYTES-THAT-MUST-NOT-BE-STORED';

async function pngDataUrl(options: { trailingBytes?: boolean } = {}) {
  const png = await sharp({ create: { width: 320, height: 90, channels: 4, background: '#1d4ed8' } })
    .png()
    .toBuffer();
  const bytes = options.trailingBytes ? Buffer.concat([png, Buffer.from(PNG_TRAILER)]) : png;
  return { dataUrl: `data:image/png;base64,${bytes.toString('base64')}`, sent: bytes };
}

describePostgres('e-signing payload limits (PostgreSQL)', () => {
  let prisma: Awaited<ReturnType<typeof import('@/lib/prisma')['getPrisma']>>;
  let signing: typeof import('@/services/esigning-signing.service');
  const tenantIds: string[] = [];
  const previousLogLevel = process.env.LOG_LEVEL;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.LOG_LEVEL = 'silent';
    prisma = (await import('@/lib/prisma')).getPrisma();
    signing = await import('@/services/esigning-signing.service');
  });

  beforeEach(() => {
    storageMocks.upload.mockClear();
    storageMocks.files.clear();
  });

  afterAll(async () => {
    for (const tenantId of tenantIds.splice(0)) {
      await prisma.esigningEnvelope.deleteMany({ where: { tenantId } });
      await prisma.auditLog.deleteMany({ where: { tenantId } });
      await prisma.user.deleteMany({ where: { tenantId } });
      await prisma.workspace.delete({ where: { id: tenantId } });
    }
    await prisma.$disconnect();
    if (previousLogLevel === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = previousLogLevel;
  });

  async function seed() {
    const suffix = randomUUID();
    const workspace = await prisma.workspace.create({
      data: { name: `limits ${suffix}`, slug: `limits-${suffix}` },
    });
    tenantIds.push(workspace.id);
    const user = await prisma.user.create({
      data: {
        tenantId: workspace.id,
        email: `limits-${suffix}@example.test`,
        passwordHash: 'not-used',
        firstName: 'Limits',
        lastName: 'Sender',
      },
    });
    const envelope = await prisma.esigningEnvelope.create({
      data: {
        tenantId: workspace.id,
        createdById: user.id,
        title: 'Limits',
        status: 'IN_PROGRESS',
        signingOrder: 'PARALLEL',
        certificateId: `limits-${suffix}`,
      },
    });
    const document = await prisma.esigningEnvelopeDocument.create({
      data: {
        tenantId: workspace.id,
        envelopeId: envelope.id,
        fileName: 'a.pdf',
        storagePath: 'x',
        originalHash: 'h',
        pageCount: 1,
        sortOrder: 0,
        fileSize: 1,
      },
    });
    const recipient = await prisma.esigningEnvelopeRecipient.create({
      data: {
        tenantId: workspace.id,
        envelopeId: envelope.id,
        type: 'SIGNER',
        name: 'Signer',
        email: `signer-${suffix}@example.test`,
        signingOrder: 1,
        status: 'VIEWED',
        accessMode: 'EMAIL_LINK',
        consentedAt: new Date(),
        colorTag: '#ffffff',
      },
    });
    const fieldData = {
      tenantId: workspace.id,
      envelopeId: envelope.id,
      documentId: document.id,
      recipientId: recipient.id,
      pageNumber: 1,
      xPercent: 10,
      widthPercent: 20,
      heightPercent: 5,
      required: true,
    };
    const signatureField = await prisma.esigningDocumentFieldDefinition.create({
      data: { ...fieldData, type: 'SIGNATURE', yPercent: 10, sortOrder: 0 },
    });
    const textField = await prisma.esigningDocumentFieldDefinition.create({
      data: { ...fieldData, type: 'TEXT', yPercent: 30, sortOrder: 1 },
    });
    return { envelope, recipient, signatureField, textField, tenantId: workspace.id };
  }

  function actAs<T>(seeded: Awaited<ReturnType<typeof seed>>, fn: () => Promise<T>): Promise<T> {
    return sessionContext.run({ envelopeId: seeded.envelope.id, recipientId: seeded.recipient.id }, fn);
  }

  async function state(seeded: Awaited<ReturnType<typeof seed>>) {
    const [recipient, envelope, values, signedEvents] = await Promise.all([
      prisma.esigningEnvelopeRecipient.findUniqueOrThrow({ where: { id: seeded.recipient.id } }),
      prisma.esigningEnvelope.findUniqueOrThrow({ where: { id: seeded.envelope.id } }),
      prisma.esigningDocumentFieldValue.findMany({ where: { recipientId: seeded.recipient.id } }),
      prisma.esigningEnvelopeEvent.count({ where: { envelopeId: seeded.envelope.id, action: 'SIGNED' } }),
    ]);
    return { recipient, envelope, values, signedEvents };
  }

  it('stores a re-encoded PNG when a draft signature is saved', async () => {
    const seeded = await seed();
    const { dataUrl, sent } = await pngDataUrl({ trailingBytes: true });

    await actAs(seeded, () =>
      signing.saveEsigningSigningFieldValues([{ fieldDefinitionId: seeded.signatureField.id, signatureDataUrl: dataUrl }])
    );

    expect(storageMocks.upload).toHaveBeenCalledTimes(1);
    const [path, stored] = storageMocks.upload.mock.calls[0] as unknown as [string, Buffer];
    expect(path).toBe(`esigning/${seeded.tenantId}/${seeded.envelope.id}/${seeded.recipient.id}/signature.png`);
    expect(stored.equals(sent)).toBe(false);
    expect(stored.includes(PNG_TRAILER)).toBe(false);
    expect(await sharp(stored).metadata()).toMatchObject({ format: 'png', width: 320, height: 90 });

    const { values } = await state(seeded);
    expect(values).toHaveLength(1);
    expect(values[0].signatureStoragePath).toBe(path);
  });

  it('refuses an invalid draft image without writing a value or a file', async () => {
    const seeded = await seed();

    await expect(
      actAs(seeded, () =>
        signing.saveEsigningSigningFieldValues([
          { fieldDefinitionId: seeded.textField.id, value: 'Jane' },
          {
            fieldDefinitionId: seeded.signatureField.id,
            signatureDataUrl: `data:image/png;base64,${Buffer.from('definitely not a PNG').toString('base64')}`,
          },
        ])
      )
    ).rejects.toThrow(/not a valid PNG/);

    expect(storageMocks.upload).not.toHaveBeenCalled();
    expect((await state(seeded)).values).toHaveLength(0);
  });

  it('refuses completion with an invalid image: nothing is finalized, signed or stored', async () => {
    const seeded = await seed();

    await expect(
      actAs(seeded, () =>
        signing.completeEsigningSigningSession({
          values: [
            { fieldDefinitionId: seeded.textField.id, value: 'Jane' },
            { fieldDefinitionId: seeded.signatureField.id, signatureDataUrl: 'data:image/png;base64,iVBORw0KGgo=' },
          ],
        })
      )
    ).rejects.toThrow(/not a valid PNG/);

    const after = await state(seeded);
    expect(storageMocks.upload).not.toHaveBeenCalled();
    expect(after.recipient.status).toBe('VIEWED');
    expect(after.recipient.signedAt).toBeNull();
    expect(after.envelope.status).toBe('IN_PROGRESS');
    expect(after.values).toHaveLength(0);
    expect(after.signedEvents).toBe(0);
  });

  it('completes with a valid image and stores only the re-encoded PNG', async () => {
    const seeded = await seed();
    const { dataUrl } = await pngDataUrl({ trailingBytes: true });

    await actAs(seeded, () =>
      signing.completeEsigningSigningSession({
        values: [
          { fieldDefinitionId: seeded.textField.id, value: 'Jane' },
          { fieldDefinitionId: seeded.signatureField.id, signatureDataUrl: dataUrl },
        ],
      })
    );

    const after = await state(seeded);
    expect(after.recipient.status).toBe('SIGNED');
    expect(after.envelope.status).toBe('COMPLETED');
    expect(after.values.every((value) => value.finalizedAt)).toBe(true);
    expect(storageMocks.upload).toHaveBeenCalledTimes(1);
    const [, stored] = storageMocks.upload.mock.calls[0] as unknown as [string, Buffer];
    expect(stored.includes(PNG_TRAILER)).toBe(false);
    expect(await sharp(stored).metadata()).toMatchObject({ format: 'png' });
  });
});
