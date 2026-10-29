import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (process.env.CI === 'true' && !testDatabaseUrl) {
  describe('E-signing completion worker PostgreSQL configuration', () => {
    it('requires TEST_DATABASE_URL in CI', () => {
      throw new Error('TEST_DATABASE_URL must reference an isolated PostgreSQL test database in CI');
    });
  });
}

vi.mock('@/lib/storage', () => ({
  storage: {
    download: vi.fn(async () => Buffer.from('signed-pdf')),
    upload: vi.fn(async () => undefined),
    exists: vi.fn(async () => true),
  },
  StorageKeys: {
    documentOriginal: (tenantId: string, companyId: string, id: string, ext: string) =>
      `original/${tenantId}/${companyId}/${id}${ext}`,
    esigningSignedDocument: (tenantId: string, envelopeId: string, id: string) =>
      `signed/${tenantId}/${envelopeId}/${id}.pdf`,
    esigningEnvelopeCertificate: (tenantId: string, envelopeId: string) =>
      `certificate/${tenantId}/${envelopeId}.pdf`,
    esigningCertificateDocument: (tenantId: string, envelopeId: string, id: string) =>
      `certificate/${tenantId}/${envelopeId}/${id}.pdf`,
  },
}));

vi.mock('@/services/esigning-pdf.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/esigning-pdf.service')>();
  return {
    ...actual,
    generateEsigningEnvelopeArtifactsNow: vi.fn(async () => 'generated'),
    ensureEsigningEnvelopeArtifacts: vi.fn(async () => undefined),
    // The worker tests use sentinel storage bytes rather than real PDFs. Keep
    // attachment assembly out of this concurrency fixture; PDF merge coverage
    // lives in the certificate PDF service tests.
    buildEmailAttachments: vi.fn(async () => []),
  };
});

const describePostgres = testDatabaseUrl ? describe : describe.skip;

describePostgres('e-signing completion worker PostgreSQL concurrency', () => {
  let prisma: Awaited<ReturnType<typeof import('@/lib/prisma')['getPrisma']>>;
  let processQueuedEsigningCompletionWork: typeof import('@/services/esigning-completion.service')['processQueuedEsigningCompletionWork'];
  let processEsigningCompletionDelivery: typeof import('@/services/esigning-completion.service')['processEsigningCompletionDelivery'];
  const tenantIds: string[] = [];
  const previousLogLevel = process.env.LOG_LEVEL;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.LOG_LEVEL = 'silent';
    const prismaModule = await import('@/lib/prisma');
    prisma = prismaModule.getPrisma();
    ({ processQueuedEsigningCompletionWork, processEsigningCompletionDelivery } = await import('@/services/esigning-completion.service'));
  });

  afterEach(async () => {
    for (const tenantId of tenantIds.splice(0)) {
      await prisma.auditLog.deleteMany({ where: { tenantId } });
      await prisma.document.deleteMany({ where: { tenantId } });
      await prisma.esigningEnvelope.deleteMany({ where: { tenantId } });
      await prisma.company.deleteMany({ where: { tenantId } });
      await prisma.user.deleteMany({ where: { tenantId } });
      await prisma.workspace.delete({ where: { id: tenantId } });
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
    if (previousLogLevel === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = previousLogLevel;
  });

  async function seedEnvelope(input: {
    pdfGenerationStatus?: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
    autoFilingStatus?: 'NOT_REQUIRED' | 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED_RETRYABLE' | 'FAILED_PERMANENT';
    autoFilingAvailableAt?: Date | null;
    autoFilingLeaseExpiresAt?: Date | null;
    autoFilingClaimToken?: string | null;
    companyId?: string | null;
    withDocument?: boolean;
  } = {}) {
    const suffix = randomUUID();
    const workspace = await prisma.workspace.create({
      data: { name: `E-signing ${suffix}`, slug: `esigning-${suffix}` },
    });
    tenantIds.push(workspace.id);
    const user = await prisma.user.create({
      data: {
        tenantId: workspace.id,
        email: `esigning-${suffix}@example.test`,
        passwordHash: 'not-used',
        firstName: 'E-signing',
        lastName: 'Sender',
      },
    });
    const company = input.companyId === null ? null : await prisma.company.create({
      data: {
        tenantId: workspace.id,
        uen: suffix.slice(0, 9).toUpperCase(),
        name: `Company ${suffix}`,
      },
    });
    const envelope = await prisma.esigningEnvelope.create({
      data: {
        tenantId: workspace.id,
        createdById: user.id,
        title: `NDA ${suffix.slice(0, 6)}`,
        status: 'COMPLETED',
        signingOrder: 'PARALLEL',
        certificateId: `certificate-${suffix}`,
        completedAt: new Date('2026-08-11T00:00:00.000Z'),
        pdfGenerationStatus: input.pdfGenerationStatus ?? 'COMPLETED',
        pdfGenerationAttempts: 0,
        autoFilingStatus: input.autoFilingStatus ?? 'NOT_REQUIRED',
        autoFilingAttempts: 0,
        autoFilingAvailableAt: input.autoFilingAvailableAt ?? null,
        autoFilingLeaseExpiresAt: input.autoFilingLeaseExpiresAt ?? null,
        autoFilingClaimToken: input.autoFilingClaimToken ?? null,
        companyId: input.companyId === null ? null : company?.id ?? null,
      },
    });
    const recipient = await prisma.esigningEnvelopeRecipient.create({
      data: {
        tenantId: workspace.id,
        envelopeId: envelope.id,
        type: 'SIGNER',
        name: 'E-signing Signer',
        email: `signer-${suffix}@example.test`,
        status: 'SIGNED',
        colorTag: '#06b6d4',
      },
    });
    let documentId: string | null = null;
    if (input.withDocument) {
      const document = await prisma.esigningEnvelopeDocument.create({
        data: {
          tenantId: workspace.id,
          envelopeId: envelope.id,
          fileName: 'nda.pdf',
          storagePath: `original/${workspace.id}/${envelope.id}/nda.pdf`,
          signedStoragePath: `signed/${workspace.id}/${envelope.id}/nda.pdf`,
          originalHash: 'original-hash',
          pageCount: 1,
          sortOrder: 1,
          fileSize: 1024,
        },
      });
      documentId = document.id;
    }
    return { workspace, user, company, envelope, recipient, documentId };
  }

  async function seedDelivery(input: {
    envelope: Awaited<ReturnType<typeof seedEnvelope>>['envelope'];
    tenantId: string;
    recipientId: string;
    status?: 'PENDING' | 'PROCESSING' | 'FAILED_RETRYABLE' | 'FAILED_PERMANENT';
    availableAt?: Date;
    leaseExpiresAt?: Date | null;
    claimToken?: string | null;
    attemptCount?: number;
  }) {
    return prisma.esigningEmailDelivery.create({
      data: {
        tenantId: input.tenantId,
        envelopeId: input.envelope.id,
        recipientId: input.recipientId,
        audience: 'RECIPIENT',
        kind: 'COMPLETION',
        targetKey: `recipient:${input.recipientId}`,
        toEmail: 'signer@example.test',
        subject: `Completed: ${input.envelope.title}`,
        status: input.status ?? 'PENDING',
        attemptCount: input.attemptCount ?? 0,
        availableAt: input.availableAt ?? new Date('2026-08-11T00:00:00.000Z'),
        leaseExpiresAt: input.leaseExpiresAt ?? null,
        claimToken: input.claimToken ?? null,
      },
    });
  }

  it('claims one delivery exactly once under overlapping schedulers', async () => {
    const seeded = await seedEnvelope();
    const delivery = await seedDelivery({
      envelope: seeded.envelope,
      tenantId: seeded.workspace.id,
      recipientId: seeded.recipient.id,
    });

    const results = await Promise.all([
      processQueuedEsigningCompletionWork({ limit: 1, concurrency: 1 }),
      processQueuedEsigningCompletionWork({ limit: 1, concurrency: 1 }),
    ]);

    const attempted = results.reduce(
      (sum, result) => sum + result.deliveriesSent + result.deliveryFailed + result.deliveryStale,
      0
    );
    expect(attempted).toBe(1);
    const row = await prisma.esigningEmailDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(row.status).toBe('FAILED_RETRYABLE');
    expect(row.attemptCount).toBe(1);
    expect(await prisma.esigningEmailDeliveryAttempt.count({ where: { deliveryId: delivery.id } })).toBe(1);
  });

  it('processes a freshly claimed row through its owner', async () => {
    const seeded = await seedEnvelope();
    const claimToken = randomUUID();
    const delivery = await seedDelivery({
      envelope: seeded.envelope,
      tenantId: seeded.workspace.id,
      recipientId: seeded.recipient.id,
      status: 'PROCESSING',
      leaseExpiresAt: new Date(Date.now() + 60_000),
      claimToken,
    });

    const outcome = await processEsigningCompletionDelivery({
      id: delivery.id,
      tenantId: seeded.workspace.id,
      envelopeId: seeded.envelope.id,
      claimToken,
    });

    expect(outcome.status).toBe('retryable-failure');
    const row = await prisma.esigningEmailDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(row.status).toBe('FAILED_RETRYABLE');
    expect(row.attemptCount).toBe(1);
    expect(row.claimToken).toBeNull();
    expect(row.sentAt).toBeNull();
  });

  it('prevents an obsolete token from finalizing after a lease takeover', async () => {
    const seeded = await seedEnvelope();
    const oldToken = randomUUID();
    const delivery = await seedDelivery({
      envelope: seeded.envelope,
      tenantId: seeded.workspace.id,
      recipientId: seeded.recipient.id,
      status: 'PROCESSING',
      leaseExpiresAt: new Date(Date.now() + 60_000),
      claimToken: oldToken,
    });

    const stale = await processEsigningCompletionDelivery({
      id: delivery.id,
      tenantId: seeded.workspace.id,
      envelopeId: seeded.envelope.id,
      claimToken: randomUUID(),
    });
    expect(stale).toEqual({ status: 'stale-worker' });
    expect(await prisma.esigningEmailDeliveryAttempt.count({ where: { deliveryId: delivery.id } })).toBe(0);

    const owner = await processEsigningCompletionDelivery({
      id: delivery.id,
      tenantId: seeded.workspace.id,
      envelopeId: seeded.envelope.id,
      claimToken: oldToken,
    });
    expect(owner.status).toBe('retryable-failure');
    expect(await prisma.esigningEmailDeliveryAttempt.count({ where: { deliveryId: delivery.id } })).toBe(1);
  });

  it('leaves a future-dated retry untouched', async () => {
    const seeded = await seedEnvelope();
    const delivery = await seedDelivery({
      envelope: seeded.envelope,
      tenantId: seeded.workspace.id,
      recipientId: seeded.recipient.id,
      status: 'FAILED_RETRYABLE',
      attemptCount: 1,
      availableAt: new Date(Date.now() + 60_000),
    });

    const result = await processQueuedEsigningCompletionWork({ limit: 1, concurrency: 1 });

    expect(result.deliveriesSent + result.deliveryFailed + result.deliveryStale).toBe(0);
    const row = await prisma.esigningEmailDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(row).toMatchObject({ status: 'FAILED_RETRYABLE', attemptCount: 1 });
  });

  it('reclaims an expired processing lease with a new token', async () => {
    const seeded = await seedEnvelope();
    const delivery = await seedDelivery({
      envelope: seeded.envelope,
      tenantId: seeded.workspace.id,
      recipientId: seeded.recipient.id,
      status: 'PROCESSING',
      leaseExpiresAt: new Date(Date.now() - 60_000),
      claimToken: randomUUID(),
    });

    const result = await processQueuedEsigningCompletionWork({ limit: 1, concurrency: 1 });

    expect(result.deliveriesSent + result.deliveryFailed).toBe(1);
    const row = await prisma.esigningEmailDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(row.status).toBe('FAILED_RETRYABLE');
    expect(row.attemptCount).toBe(1);
    expect(row.claimToken).toBeNull();
  });

  it('keeps delivery attempts at zero while PDF generation is not completed', async () => {
    const seeded = await seedEnvelope({ pdfGenerationStatus: 'PENDING' });
    const delivery = await seedDelivery({
      envelope: seeded.envelope,
      tenantId: seeded.workspace.id,
      recipientId: seeded.recipient.id,
    });

    const result = await processQueuedEsigningCompletionWork({ limit: 1, concurrency: 1 });

    expect(result.deliveriesSent + result.deliveryFailed).toBe(0);
    const row = await prisma.esigningEmailDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(row).toMatchObject({ status: 'PENDING', attemptCount: 0 });
  });

  it('creates exactly one auto-filed document and one success audit under overlap', async () => {
    const seeded = await seedEnvelope({
      autoFilingStatus: 'PENDING',
      autoFilingAvailableAt: new Date('2026-08-11T00:00:00.000Z'),
      withDocument: true,
    });
    await seedDelivery({
      envelope: seeded.envelope,
      tenantId: seeded.workspace.id,
      recipientId: seeded.recipient.id,
      availableAt: new Date('2026-08-11T00:00:00.000Z'),
    });

    const results = await Promise.all([
      processQueuedEsigningCompletionWork({ limit: 1, concurrency: 1 }),
      processQueuedEsigningCompletionWork({ limit: 1, concurrency: 1 }),
    ]);

    const autoFiled = results.reduce((sum, result) => sum + result.autoFiled, 0);
    expect(autoFiled).toBe(1);
    const documents = await prisma.document.findMany({
      where: { tenantId: seeded.workspace.id, documentType: 'E_SIGNED_PACKAGE' },
    });
    expect(documents).toHaveLength(1);
    const audits = await prisma.auditLog.findMany({
      where: {
        tenantId: seeded.workspace.id,
        entityType: 'Document',
        entityId: documents[0].id,
        action: 'UPLOAD',
      },
    });
    expect(audits).toHaveLength(1);
    const envelope = await prisma.esigningEnvelope.findUniqueOrThrow({
      where: { id: seeded.envelope.id },
    });
    expect(envelope.autoFilingStatus).toBe('COMPLETED');
    expect(envelope.autoFilingClaimToken).toBeNull();
  });
});
