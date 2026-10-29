import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getEsigningPostCompletionSummary,
  buildEsigningCompletionDeliveryTargets,
  processEsigningAutoFileJob,
  processEsigningCompletionDelivery,
  processQueuedEsigningCompletionWork,
} from '@/services/esigning-completion.service';
import { ensureEsigningEnvelopeArtifacts } from '@/services/esigning-pdf.service';

const mocks = vi.hoisted(() => ({
  findManyEnvelope: vi.fn(),
  updateManyEnvelope: vi.fn(),
  findUniqueEnvelope: vi.fn(),
  findFirstEnvelope: vi.fn(),
  updateEnvelope: vi.fn(),
  updateManyDelivery: vi.fn(),
  findUniqueDelivery: vi.fn(),
  findFirstDelivery: vi.fn(),
  updateDelivery: vi.fn(),
  createDelivery: vi.fn(),
  createDeliveryAttempt: vi.fn(),
  documentUpsert: vi.fn(),
  auditLogUpsert: vi.fn(),
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  download: vi.fn(),
  upload: vi.fn(),
  exists: vi.fn(),
  sendCompletion: vi.fn(),
  createAuditLog: vi.fn(),
  generateArtifactsNow: vi.fn(),
  ensureArtifacts: vi.fn(),
  buildLinks: vi.fn(),
  buildAttachments: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    esigningEnvelope: {
      findMany: mocks.findManyEnvelope,
      updateMany: mocks.updateManyEnvelope,
      findUnique: mocks.findUniqueEnvelope,
      findFirst: mocks.findFirstEnvelope,
      update: mocks.updateEnvelope,
    },
    esigningEmailDelivery: {
      updateMany: mocks.updateManyDelivery,
      findUnique: mocks.findUniqueDelivery,
      findFirst: mocks.findFirstDelivery,
      update: mocks.updateDelivery,
      create: mocks.createDelivery,
    },
    esigningEmailDeliveryAttempt: {
      create: mocks.createDeliveryAttempt,
    },
    document: {
      upsert: mocks.documentUpsert,
    },
    auditLog: {
      upsert: mocks.auditLogUpsert,
    },
    $transaction: mocks.transaction,
  },
}));

vi.mock('@/lib/storage', () => ({
  storage: {
    download: mocks.download,
    upload: mocks.upload,
    exists: mocks.exists,
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

vi.mock('@/lib/audit', () => ({
  createAuditLog: mocks.createAuditLog,
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

vi.mock('@/services/esigning-notification.service', () => ({
  sendEsigningCompletionEmail: mocks.sendCompletion,
  sendEsigningPdfFailureEmailToSender: vi.fn(),
}));

vi.mock('@/services/esigning-pdf.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/esigning-pdf.service')>();
  return {
    ...actual,
    generateEsigningEnvelopeArtifactsNow: mocks.generateArtifactsNow,
    ensureEsigningEnvelopeArtifacts: mocks.ensureArtifacts,
    buildDeliveryDocumentLinks: mocks.buildLinks,
    buildEmailAttachments: mocks.buildAttachments,
  };
});

function makeAutoFileEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    id: 'envelope-1',
    tenantId: 'tenant-1',
    title: 'NDA',
    companyId: 'company-1',
    createdById: 'user-1',
    certificateId: 'certificate-1',
    documents: [
      {
        id: 'document-1',
        fileName: 'nda.pdf',
        signedStoragePath: 'signed/tenant-1/envelope-1/document-1.pdf',
      },
    ],
    ...overrides,
  };
}

function makeDelivery(overrides: Record<string, unknown> = {}) {
  return {
    id: 'delivery-1',
    tenantId: 'tenant-1',
    envelopeId: 'envelope-1',
    recipientId: 'recipient-1',
    audience: 'RECIPIENT',
    kind: 'COMPLETION',
    targetKey: 'recipient:recipient-1',
    toEmail: 'signer@example.com',
    subject: 'Completed: NDA',
    attemptCount: 0,
    envelope: {
      id: 'envelope-1',
      tenantId: 'tenant-1',
      title: 'NDA',
      certificateId: 'certificate-1',
      createdById: 'user-1',
      metadata: {},
      createdBy: { firstName: 'Sender', lastName: null, email: 'sender@example.com' },
      recipients: [{ id: 'recipient-1', name: 'Signer', email: 'signer@example.com' }],
      fieldDefinitions: [{ documentId: 'document-1', recipientId: 'recipient-1' }],
      documents: [
        {
          id: 'document-1',
          fileName: 'nda.pdf',
          signedStoragePath: 'signed/tenant-1/envelope-1/document-1.pdf',
        },
      ],
    },
    ...overrides,
  };
}

function transactionClient() {
  return {
    $queryRaw: mocks.queryRaw,
    esigningEnvelope: {
      updateMany: mocks.updateManyEnvelope,
      findFirst: mocks.findFirstEnvelope,
    },
    esigningEmailDelivery: {
      updateMany: mocks.updateManyDelivery,
      findFirst: mocks.findFirstDelivery,
    },
    esigningEmailDeliveryAttempt: {
      create: mocks.createDeliveryAttempt,
    },
    document: {
      upsert: mocks.documentUpsert,
    },
    auditLog: {
      upsert: mocks.auditLogUpsert,
    },
  };
}

describe('e-signing completion worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateManyEnvelope.mockResolvedValue({ count: 1 });
    mocks.updateEnvelope.mockResolvedValue({});
    mocks.updateManyDelivery.mockResolvedValue({ count: 1 });
    mocks.updateDelivery.mockResolvedValue({});
    mocks.createDeliveryAttempt.mockResolvedValue({});
    mocks.documentUpsert.mockResolvedValue({});
    mocks.auditLogUpsert.mockResolvedValue({});
    mocks.upload.mockResolvedValue(undefined);
    mocks.download.mockResolvedValue(Buffer.from('signed-pdf'));
    mocks.exists.mockResolvedValue(true);
    mocks.sendCompletion.mockResolvedValue({
      ok: true,
      kind: 'completion',
      to: 'signer@example.com',
      subject: 'Completed: NDA',
      attemptedAt: '2026-08-11T00:00:00.000Z',
      providerMessageId: 'graph-1',
    });
    mocks.createAuditLog.mockResolvedValue(undefined);
    mocks.generateArtifactsNow.mockResolvedValue('generated');
    mocks.ensureArtifacts.mockResolvedValue(undefined);
    mocks.buildLinks.mockResolvedValue([{
      label: 'nda.pdf',
      signedUrl: '/signed',
      certificateUrl: '/certificate',
    }]);
    mocks.buildAttachments.mockReturnValue([]);
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      return callback(transactionClient());
    });
    mocks.findFirstEnvelope.mockImplementation(async ({ select }: { select?: Record<string, unknown> }) => {
      if (select?.documents) {
        return makeAutoFileEnvelope();
      }
      if (select?.autoFilingAttempts) {
        return { autoFilingAttempts: 4 };
      }
      return { id: 'envelope-1' };
    });
    mocks.findFirstDelivery.mockImplementation(async ({ select }: { select?: Record<string, unknown> }) => {
      if (select?.attemptCount) {
        return { attemptCount: 0, toEmail: 'signer@example.com', subject: 'Completed: NDA' };
      }
      return makeDelivery();
    });
  });

  it('processes batch-claimed deliveries without a second claim and reports real outcomes', async () => {
    mocks.findManyEnvelope.mockResolvedValue([]); // artifact stage
    mocks.queryRaw
      .mockResolvedValueOnce([{ id: 'envelope-1', tenantId: 'tenant-1' }]) // auto-file claim
      .mockResolvedValueOnce([{ id: 'delivery-1', tenantId: 'tenant-1', envelopeId: 'envelope-1' }]); // delivery claim

    const result = await processQueuedEsigningCompletionWork({ limit: 5, concurrency: 2 });

    expect(mocks.generateArtifactsNow).not.toHaveBeenCalled();
    expect(mocks.documentUpsert).toHaveBeenCalledTimes(1);
    expect(mocks.sendCompletion).toHaveBeenCalledTimes(1);
    expect(mocks.updateManyDelivery).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'PENDING' }) })
    );
    expect(result).toMatchObject({
      autoFiled: 1,
      autoFileNotRequired: 0,
      autoFileStale: 0,
      deliveriesSent: 1,
      deliveryStale: 0,
      artifactsCompleted: 0,
      artifactsFailed: 0,
      artifactsSkipped: 0,
      processed: 2,
    });
  });

  it('filters recipient completion attachments and links using document visibility', async () => {
    const delivery = makeDelivery();
    mocks.findFirstDelivery.mockImplementation(async ({ select }: { select?: Record<string, unknown> }) => {
      if (select?.attemptCount) {
        return { attemptCount: 0, toEmail: 'signer@example.com', subject: 'Completed: NDA' };
      }
      return makeDelivery({
        envelope: {
          ...delivery.envelope,
          metadata: {
            documentVisibility: {
              'document-3': 'EVERYONE',
            },
          },
          fieldDefinitions: [
            { documentId: 'document-1', recipientId: 'recipient-1' },
            { documentId: 'document-2', recipientId: 'recipient-2' },
          ],
          documents: [
            {
              id: 'document-1',
              fileName: 'assigned.pdf',
              signedStoragePath: 'signed/tenant-1/envelope-1/document-1.pdf',
            },
            {
              id: 'document-2',
              fileName: 'other-signer.pdf',
              signedStoragePath: 'signed/tenant-1/envelope-1/document-2.pdf',
            },
            {
              id: 'document-3',
              fileName: 'everyone.pdf',
              signedStoragePath: 'signed/tenant-1/envelope-1/document-3.pdf',
            },
          ],
        },
      });
    });

    await processEsigningCompletionDelivery({
      id: 'delivery-1',
      tenantId: 'tenant-1',
      envelopeId: 'envelope-1',
      claimToken: 'claim-1',
    });

    expect(mocks.buildAttachments).toHaveBeenCalledWith({
      documents: [
        expect.objectContaining({ id: 'document-1', fileName: 'assigned.pdf' }),
        expect.objectContaining({ id: 'document-3', fileName: 'everyone.pdf' }),
      ],
    });
    expect(mocks.buildLinks).toHaveBeenCalledWith(expect.objectContaining({
      actorType: 'recipient',
      recipientId: 'recipient-1',
      documents: [
        expect.objectContaining({ id: 'document-1', fileName: 'assigned.pdf' }),
        expect.objectContaining({ id: 'document-3', fileName: 'everyone.pdf' }),
      ],
    }));
  });

  it('keeps all completion documents for sender deliveries', async () => {
    const delivery = makeDelivery();
    mocks.findFirstDelivery.mockImplementation(async ({ select }: { select?: Record<string, unknown> }) => {
      if (select?.attemptCount) {
        return { attemptCount: 0, toEmail: 'sender@example.com', subject: 'Completed: NDA' };
      }
      return makeDelivery({
        recipientId: null,
        audience: 'SENDER',
        targetKey: 'sender:user-1',
        toEmail: 'sender@example.com',
        envelope: {
          ...delivery.envelope,
          fieldDefinitions: [{ documentId: 'document-1', recipientId: 'recipient-1' }],
          documents: [
            {
              id: 'document-1',
              fileName: 'assigned.pdf',
              signedStoragePath: 'signed/tenant-1/envelope-1/document-1.pdf',
            },
            {
              id: 'document-2',
              fileName: 'private-to-other-signer.pdf',
              signedStoragePath: 'signed/tenant-1/envelope-1/document-2.pdf',
            },
          ],
        },
      });
    });

    await processEsigningCompletionDelivery({
      id: 'delivery-1',
      tenantId: 'tenant-1',
      envelopeId: 'envelope-1',
      claimToken: 'claim-1',
    });

    expect(mocks.buildLinks).toHaveBeenCalledWith(expect.objectContaining({
      actorType: 'sender',
      recipientId: undefined,
      documents: [
        expect.objectContaining({ id: 'document-1' }),
        expect.objectContaining({ id: 'document-2' }),
      ],
    }));
  });

  it('sends configured completion copies as BCC recipients', async () => {
    mocks.findFirstDelivery.mockImplementation(async ({ select }: { select?: Record<string, unknown> }) => {
      if (select?.attemptCount) {
        return { attemptCount: 0, toEmail: 'ops@example.com', subject: 'Completed: NDA' };
      }
      return makeDelivery({
        recipientId: null,
        audience: 'COPY',
        targetKey: 'copy:ops@example.com',
        toEmail: 'ops@example.com',
      });
    });

    await processEsigningCompletionDelivery({
      id: 'delivery-1',
      tenantId: 'tenant-1',
      envelopeId: 'envelope-1',
      claimToken: 'claim-1',
    });

    expect(mocks.sendCompletion).toHaveBeenCalledWith(expect.objectContaining({
      to: undefined,
      bcc: 'ops@example.com',
    }));
  });

  it('artifact repair never marks delivery complete or sends email', async () => {
    mocks.findUniqueEnvelope.mockResolvedValue({
      id: 'envelope-1',
      tenantId: 'tenant-1',
      status: 'COMPLETED',
      pdfGenerationStatus: 'PENDING',
      // Must match ESIGNING_ARTIFACT_VERSION so the repair path treats the
      // artifacts as current instead of regenerating them.
      metadata: { artifactVersion: 11 },
      documents: [
        {
          id: 'document-1',
          signedStoragePath: 'signed/tenant-1/envelope-1/document-1.pdf',
        },
      ],
    });

    await ensureEsigningEnvelopeArtifacts({
      envelopeId: 'envelope-1',
      requireCertificates: true,
    });

    expect(mocks.sendCompletion).not.toHaveBeenCalled();
    expect(mocks.documentUpsert).not.toHaveBeenCalled();
    expect(mocks.updateDelivery).not.toHaveBeenCalled();
    expect(mocks.createDeliveryAttempt).not.toHaveBeenCalled();
  });

  it('claims only completed envelopes with due times and completed PDF prerequisites', async () => {
    mocks.findManyEnvelope.mockResolvedValue([]);
    mocks.queryRaw.mockResolvedValue([]);

    await processQueuedEsigningCompletionWork({ limit: 5, concurrency: 1 });

    const autoFileSql = String(mocks.queryRaw.mock.calls[0][0].strings.join('?'));
    const deliverySql = String(mocks.queryRaw.mock.calls[1][0].strings.join('?'));
    expect(autoFileSql).toContain('"autoFilingStatus" IN (\'PENDING\', \'FAILED_RETRYABLE\')');
    expect(autoFileSql).toContain('"autoFilingAvailableAt" IS NOT NULL');
    expect(autoFileSql).toContain('"autoFilingAvailableAt" <= ');
    expect(autoFileSql).toContain('"autoFilingLeaseExpiresAt" IS NOT NULL');
    expect(autoFileSql).toContain('"autoFilingLeaseExpiresAt" <= ');
    expect(deliverySql).toContain('e."status" = \'COMPLETED\'');
    expect(deliverySql).toContain('e."pdfGenerationStatus" = \'COMPLETED\'');
    expect(deliverySql).toContain('"availableAt" <= ');
    expect(deliverySql).toContain('"leaseExpiresAt" <= ');
    expect(deliverySql).toContain('FOR UPDATE SKIP LOCKED');
  });

  it('reclaims expired leases with a fresh claim token', async () => {
    mocks.findManyEnvelope.mockResolvedValue([]);
    mocks.queryRaw
      .mockResolvedValueOnce([{ id: 'envelope-1', tenantId: 'tenant-1' }])
      .mockResolvedValueOnce([{ id: 'delivery-1', tenantId: 'tenant-1', envelopeId: 'envelope-1' }]);

    await processQueuedEsigningCompletionWork({ limit: 5, concurrency: 1 });

    const envelopeClaim = mocks.updateManyEnvelope.mock.calls.find(
      (call) => call[0]?.data?.autoFilingStatus === 'PROCESSING'
    );
    expect(envelopeClaim?.[0]).toEqual(expect.objectContaining({
      data: expect.objectContaining({
        autoFilingStatus: 'PROCESSING',
        autoFilingClaimToken: expect.any(String),
      }),
    }));

    const deliveryClaim = mocks.updateManyDelivery.mock.calls.find(
      (call) => call[0]?.data?.status === 'PROCESSING' && call[0]?.data?.claimToken
    );
    expect(deliveryClaim?.[0]).toEqual(expect.objectContaining({
      data: expect.objectContaining({
        status: 'PROCESSING',
        claimToken: expect.any(String),
      }),
    }));
  });

  it('does not count not-claimed, already-processing, or stale-worker work as success', async () => {
    mocks.findManyEnvelope.mockResolvedValue([{ id: 'envelope-1' }]);
    mocks.generateArtifactsNow.mockResolvedValue('already-processing');
    mocks.queryRaw.mockResolvedValue([]); // no auto-file or delivery claims

    const result = await processQueuedEsigningCompletionWork({ limit: 5, concurrency: 1 });

    expect(result).toMatchObject({
      processed: 0,
      artifactsCompleted: 0,
      artifactsFailed: 0,
      artifactsSkipped: 1,
      autoFiled: 0,
      autoFileFailed: 0,
      autoFileStale: 0,
      deliveriesSent: 0,
      deliveryFailed: 0,
      deliveryStale: 0,
    });
  });

  it('counts a stale delivery owner separately from sent and failed work', async () => {
    mocks.findManyEnvelope.mockResolvedValue([]);
    mocks.queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'delivery-1', tenantId: 'tenant-1', envelopeId: 'envelope-1' }]);
    mocks.findFirstDelivery.mockResolvedValue(null); // ownership was taken over

    const result = await processQueuedEsigningCompletionWork({ limit: 5, concurrency: 1 });

    expect(result).toMatchObject({
      processed: 0,
      deliveriesSent: 0,
      deliveryFailed: 0,
      deliveryStale: 1,
    });
  });

  it('deterministic auto-file reruns reuse the same document and audit ids', async () => {
    const claim = { envelopeId: 'envelope-1', tenantId: 'tenant-1', claimToken: 'token-1' };

    await processEsigningAutoFileJob(claim);
    await processEsigningAutoFileJob(claim);

    expect(mocks.documentUpsert).toHaveBeenCalledTimes(2);
    const firstCall = mocks.documentUpsert.mock.calls[0][0] as { where: { id: string }; create: { id: string } };
    const secondCall = mocks.documentUpsert.mock.calls[1][0] as { where: { id: string }; create: { id: string } };
    expect(secondCall.where.id).toBe(firstCall.where.id);
    expect(secondCall.create.id).toBe(firstCall.create.id);
    expect(mocks.createAuditLog).toHaveBeenCalledTimes(2);
    const firstAuditId = (mocks.createAuditLog.mock.calls[0][0] as { id: string }).id;
    const secondAuditId = (mocks.createAuditLog.mock.calls[1][0] as { id: string }).id;
    expect(secondAuditId).toBe(firstAuditId);
  });

  it('moves auto-filing to FAILED_PERMANENT after attempt exhaustion without throwing', async () => {
    mocks.download.mockRejectedValue(new Error('storage unavailable'));

    const outcome = await processEsigningAutoFileJob({
      envelopeId: 'envelope-1',
      tenantId: 'tenant-1',
      claimToken: 'token-1',
    });

    expect(outcome).toEqual({ status: 'permanent-failure', error: 'storage unavailable' });
    expect(mocks.updateManyEnvelope).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'envelope-1',
        autoFilingStatus: 'PROCESSING',
        autoFilingClaimToken: 'token-1',
      }),
      data: expect.objectContaining({
        autoFilingStatus: 'FAILED_PERMANENT',
        autoFilingAttempts: 5,
        autoFilingAvailableAt: null,
        autoFilingClaimToken: null,
        autoFilingError: 'storage unavailable',
      }),
    });
  });

  it('moves delivery to FAILED_PERMANENT after attempt exhaustion without throwing', async () => {
    mocks.findFirstDelivery.mockImplementation(async ({ select }: { select?: Record<string, unknown> }) => {
      if (select?.attemptCount) {
        return { attemptCount: 4, toEmail: 'signer@example.com', subject: 'Completed: NDA' };
      }
      return makeDelivery({
        envelope: {
          ...makeDelivery().envelope,
          documents: [{ id: 'document-1', fileName: 'nda.pdf', signedStoragePath: null }],
        },
      });
    });

    const outcome = await processEsigningCompletionDelivery({
      id: 'delivery-1',
      tenantId: 'tenant-1',
      envelopeId: 'envelope-1',
      claimToken: 'token-1',
    });

    expect(outcome).toEqual({
      status: 'permanent-failure',
      error: 'Signed artifacts are not ready for delivery',
    });
    expect(mocks.updateManyDelivery).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'delivery-1',
        status: 'PROCESSING',
        claimToken: 'token-1',
      }),
      data: expect.objectContaining({
        status: 'FAILED_PERMANENT',
        attemptCount: 5,
        claimToken: null,
      }),
    });
    expect(mocks.createDeliveryAttempt).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        deliveryId: 'delivery-1',
        succeeded: false,
      }),
    }));
  });

  it('records a provider rejection as a retryable failure instead of success', async () => {
    mocks.sendCompletion.mockResolvedValue({
      ok: false,
      kind: 'completion',
      to: 'signer@example.com',
      subject: 'Completed: NDA',
      attemptedAt: '2026-08-11T00:00:00.000Z',
      error: 'SMTP rejected recipient',
    });

    const outcome = await processEsigningCompletionDelivery({
      id: 'delivery-1',
      tenantId: 'tenant-1',
      envelopeId: 'envelope-1',
      claimToken: 'token-1',
    });

    expect(outcome).toEqual({ status: 'retryable-failure', error: 'SMTP rejected recipient' });
    expect(mocks.updateManyDelivery).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: 'delivery-1', claimToken: 'token-1' }),
      data: expect.objectContaining({
        status: 'FAILED_RETRYABLE',
        attemptCount: 1,
        lastError: 'SMTP rejected recipient',
        availableAt: expect.any(Date),
      }),
    });
    const failureData = mocks.updateManyDelivery.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(failureData.data).not.toHaveProperty('sentAt');
    expect(mocks.createDeliveryAttempt).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        succeeded: false,
        error: 'SMTP rejected recipient',
      }),
    }));
  });

  it('routes a thrown transport error through the same failure persistence', async () => {
    mocks.sendCompletion.mockRejectedValue(new Error('transport offline'));

    const outcome = await processEsigningCompletionDelivery({
      id: 'delivery-1',
      tenantId: 'tenant-1',
      envelopeId: 'envelope-1',
      claimToken: 'token-1',
    });

    expect(outcome).toEqual({ status: 'retryable-failure', error: 'transport offline' });
    expect(mocks.updateManyDelivery).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'FAILED_RETRYABLE',
        lastError: 'transport offline',
      }),
    }));
    const failureData = mocks.updateManyDelivery.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(failureData.data).not.toHaveProperty('sentAt');
    expect(mocks.createDeliveryAttempt).toHaveBeenCalledTimes(1);
  });

  it('writes one successful attempt and clears the claim only for provider success', async () => {
    const outcome = await processEsigningCompletionDelivery({
      id: 'delivery-1',
      tenantId: 'tenant-1',
      envelopeId: 'envelope-1',
      claimToken: 'token-1',
    });

    expect(outcome).toEqual({ status: 'sent' });
    expect(mocks.updateManyDelivery).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'delivery-1',
        status: 'PROCESSING',
        claimToken: 'token-1',
      }),
      data: expect.objectContaining({
        status: 'SUCCEEDED',
        sentAt: expect.any(Date),
        claimToken: null,
        leaseExpiresAt: null,
        lastError: null,
      }),
    });
    expect(mocks.createDeliveryAttempt).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        succeeded: true,
        providerMessageId: 'graph-1',
      }),
    }));
    expect(mocks.createDeliveryAttempt).toHaveBeenCalledTimes(1);
  });

  it('returns stale-worker when an obsolete token cannot finalize', async () => {
    mocks.findFirstDelivery.mockResolvedValue(null);

    const outcome = await processEsigningCompletionDelivery({
      id: 'delivery-1',
      tenantId: 'tenant-1',
      envelopeId: 'envelope-1',
      claimToken: 'obsolete-token',
    });

    expect(outcome).toEqual({ status: 'stale-worker' });
    expect(mocks.createDeliveryAttempt).not.toHaveBeenCalled();
  });
});

describe('e-signing post-completion summary scoping', () => {
  const envelope = {
    status: 'COMPLETED',
    pdfGenerationStatus: 'COMPLETED',
    autoFilingStatus: 'COMPLETED',
  };

  it('ignores non-completion successes when deriving completion delivery status', () => {
    const summary = getEsigningPostCompletionSummary(envelope, [
      { kind: 'REQUEST', status: 'SUCCEEDED' },
      { kind: 'REMINDER', status: 'SUCCEEDED' },
    ]);

    expect(summary.completionDeliveryStatus).toBe('NOT_TRACKED');
    expect(summary.failedCompletionDeliveryCount).toBe(0);
  });

  it('ignores non-completion failures in post-completion health', () => {
    const summary = getEsigningPostCompletionSummary(envelope, [
      { kind: 'REQUEST', status: 'FAILED_PERMANENT' },
      { kind: 'REMINDER', status: 'FAILED_RETRYABLE' },
    ]);

    expect(summary.completionDeliveryStatus).toBe('NOT_TRACKED');
    expect(summary.failedCompletionDeliveryCount).toBe(0);
  });

  it('reports NOT_TRACKED for a completed envelope with no completion rows', () => {
    expect(getEsigningPostCompletionSummary(envelope, []).completionDeliveryStatus).toBe(
      'NOT_TRACKED'
    );
  });

  it('reports pending, retrying, and failed states from completion rows only', () => {
    expect(getEsigningPostCompletionSummary(envelope, [
      { kind: 'COMPLETION', status: 'PROCESSING' },
    ]).completionDeliveryStatus).toBe('PENDING');
    expect(getEsigningPostCompletionSummary(envelope, [
      { kind: 'COMPLETION', status: 'FAILED_RETRYABLE' },
    ]).completionDeliveryStatus).toBe('RETRYING');
    expect(getEsigningPostCompletionSummary(envelope, [
      { kind: 'COMPLETION', status: 'FAILED_PERMANENT' },
    ])).toMatchObject({
      completionDeliveryStatus: 'FAILED',
      failedCompletionDeliveryCount: 1,
    });
    expect(getEsigningPostCompletionSummary(envelope, [
      { kind: 'COMPLETION', status: 'SUCCEEDED' },
    ]).completionDeliveryStatus).toBe('COMPLETED');
  });
});

describe('e-signing completion copy delivery targets', () => {
  it('deduplicates copy emails against the sender and recipient deliveries', () => {
    const targets = buildEsigningCompletionDeliveryTargets({
      tenantId: 'tenant-1',
      envelopeId: 'envelope-1',
      completedAt: new Date('2026-09-09T00:00:00.000Z'),
      title: 'NDA',
      createdById: 'user-1',
      senderEmail: 'Owner@Example.com',
      copyEmails: ['signer@example.com', 'ops@example.com', 'OPS@example.com'],
      recipients: [
        {
          id: 'recipient-1',
          email: 'Signer@Example.com',
          type: 'SIGNER',
          accessMode: 'EMAIL_LINK',
        },
        {
          id: 'recipient-2',
          email: 'signer@example.com',
          type: 'CC',
          accessMode: 'EMAIL_LINK',
        },
        {
          id: 'recipient-3',
          email: null,
          type: 'SIGNER',
          accessMode: 'MANUAL_LINK',
        },
      ],
    });

    expect(targets.map((target) => [target.audience, target.toEmail])).toEqual([
      ['SENDER', 'owner@example.com'],
      ['RECIPIENT', 'signer@example.com'],
      ['COPY', 'ops@example.com'],
    ]);
  });

  it('includes emailed manual-link signers in completion delivery targets', () => {
    const targets = buildEsigningCompletionDeliveryTargets({
      tenantId: 'tenant-1',
      envelopeId: 'envelope-1',
      completedAt: new Date('2026-09-09T00:00:00.000Z'),
      title: 'NDA',
      createdById: 'user-1',
      senderEmail: 'owner@example.com',
      copyEmails: [],
      recipients: [{
        id: 'recipient-1',
        email: 'manual-link-signer@example.com',
        type: 'SIGNER',
        accessMode: 'MANUAL_LINK',
      }],
    });

    expect(targets).toEqual(expect.arrayContaining([
      expect.objectContaining({
        audience: 'RECIPIENT',
        recipientId: 'recipient-1',
        toEmail: 'manual-link-signer@example.com',
      }),
    ]));
  });
});
