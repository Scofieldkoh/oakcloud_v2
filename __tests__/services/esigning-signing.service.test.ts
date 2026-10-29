import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  finalizeEsigningEnvelopeCompletion,
  getEsigningSigningSessionStatus,
  loadEsigningSigningSession,
  saveEsigningSigningFieldValues,
} from '@/services/esigning-signing.service';
import { getEsigningPostCompletionSummary } from '@/services/esigning-completion.service';
import { retryEsigningEnvelopeCompletionProcessing } from '@/services/esigning-envelope.service';

const serviceAgreementMock = vi.hoisted(() => ({
  processQueuedServiceAgreementActivations: vi.fn(),
  queueServiceAgreementActivationsForEnvelope: vi.fn().mockResolvedValue(0),
}));

const prismaMocks = vi.hoisted(() => ({
  findFirstRecipient: vi.fn(),
  countRecipients: vi.fn(),
  findFirstEnvelope: vi.fn(),
  fieldValueFindMany: vi.fn(),
  emailDeliveryFindMany: vi.fn(),
  transaction: vi.fn(),
  envelopeUpdateMany: vi.fn(),
  deliveryUpdateMany: vi.fn(),
}));

const sessionMocks = vi.hoisted(() => ({
  getEsigningSessionClaims: vi.fn(),
  createEsigningDownloadToken: vi.fn(),
}));

const storageMocks = vi.hoisted(() => ({
  getSignedUrl: vi.fn(),
  download: vi.fn(),
}));

const rbacMocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
}));

const fieldServiceMocks = vi.hoisted(() => ({
  saveRecipientFieldValues: vi.fn(),
}));

vi.mock('@/services/service-agreement', () => serviceAgreementMock);
vi.mock('@/lib/esigning-session', () => sessionMocks);
vi.mock('@/lib/storage', () => ({ storage: storageMocks }));
vi.mock('@/lib/audit', () => ({ createAuditLog: vi.fn() }));
vi.mock('@/lib/rbac', () => ({ hasPermission: rbacMocks.hasPermission }));
vi.mock('@/services/esigning-field.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/esigning-field.service')>();
  return {
    ...actual,
    saveRecipientFieldValues: fieldServiceMocks.saveRecipientFieldValues,
  };
});
vi.mock('@/lib/prisma', () => ({
  prisma: {
    esigningDocumentFieldValue: {
      findMany: prismaMocks.fieldValueFindMany,
    },
    esigningEnvelopeRecipient: {
      findFirst: prismaMocks.findFirstRecipient,
      count: prismaMocks.countRecipients,
    },
    esigningEnvelope: {
      findFirst: prismaMocks.findFirstEnvelope,
      updateMany: prismaMocks.envelopeUpdateMany,
    },
    esigningEmailDelivery: {
      findMany: prismaMocks.emailDeliveryFindMany,
      updateMany: prismaMocks.deliveryUpdateMany,
    },
    $transaction: prismaMocks.transaction,
  },
}));

function makeEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    id: 'envelope-1',
    tenantId: 'tenant-1',
    title: 'NDA',
    companyId: 'company-1',
    createdById: 'user-1',
    recipients: [
      { id: 'recipient-1', email: 'signer@example.com', accessMode: 'EMAIL_LINK' },
      { id: 'recipient-2', email: 'cc@example.com', accessMode: 'EMAIL_WITH_CODE' },
      { id: 'recipient-3', email: 'manual@example.com', accessMode: 'MANUAL_LINK' },
    ],
    createdBy: { email: 'sender@example.com' },
    ...overrides,
  };
}

function makeTx(envelope = makeEnvelope()) {
  return {
    esigningEnvelope: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUnique: vi.fn().mockResolvedValue(envelope),
      update: vi.fn().mockResolvedValue({}),
    },
    esigningEnvelopeEvent: {
      create: vi.fn().mockResolvedValue({}),
    },
    esigningEmailDelivery: {
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    esigningEnvelopeDocument: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    generatedDocument: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    serviceAgreement: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };
}

function makeSigningSessionEnvelope(overrides: Record<string, unknown> = {}) {
  const currentRecipient = {
    id: 'recipient-current',
    name: 'Current Signer',
    email: 'current@example.com',
    type: 'SIGNER',
    status: 'VIEWED',
    sessionVersion: 1,
    accessMode: 'EMAIL_LINK',
    consentedAt: new Date('2026-09-11T08:00:00.000Z'),
    viewedAt: new Date('2026-09-11T08:01:00.000Z'),
    signedAt: null,
    signingOrder: 2,
    colorTag: '#06b6d4',
  };

  return {
    id: 'envelope-1',
    tenantId: 'tenant-1',
    tenant: { id: 'tenant-1', name: 'Acme Pte Ltd' },
    company: null,
    title: 'Service Agreement',
    message: 'Please review and sign.',
    status: 'IN_PROGRESS',
    pdfGenerationStatus: null,
    certificateId: 'certificate-1',
    createdById: 'sender-1',
    createdBy: { firstName: 'Sender', lastName: 'User', email: 'sender@example.com' },
    completedAt: null,
    expiresAt: null,
    autoFilingStatus: 'NOT_REQUIRED',
    consentVersion: '1.0',
    documents: [
      {
        id: 'document-1',
        fileName: 'agreement.pdf',
        originalFileName: null,
        pageCount: 2,
        fileSize: 1024,
        originalHash: 'original-hash',
        signedHash: null,
        storagePath: 'tenant-1/envelope-1/document-1/original.pdf',
        signedStoragePath: null,
        sortOrder: 0,
      },
    ],
    recipients: [
      currentRecipient,
      {
        id: 'recipient-prior',
        name: 'Prior Signer',
        email: 'prior@example.com',
        type: 'SIGNER',
        status: 'SIGNED',
        sessionVersion: 1,
        accessMode: 'EMAIL_LINK',
        consentedAt: new Date('2026-09-11T07:00:00.000Z'),
        viewedAt: new Date('2026-09-11T07:01:00.000Z'),
        signedAt: new Date('2026-09-11T07:02:00.000Z'),
        signingOrder: 1,
        colorTag: '#22c55e',
      },
      {
        id: 'recipient-pending',
        name: 'Pending Signer',
        email: 'pending@example.com',
        type: 'SIGNER',
        status: 'NOTIFIED',
        sessionVersion: 1,
        accessMode: 'EMAIL_LINK',
        consentedAt: null,
        viewedAt: null,
        signedAt: null,
        signingOrder: 3,
        colorTag: '#f59e0b',
      },
    ],
    fieldDefinitions: [
      {
        id: 'field-current',
        documentId: 'document-1',
        recipientId: 'recipient-current',
        type: 'SIGNATURE',
        pageNumber: 1,
        xPercent: 10,
        yPercent: 20,
        widthPercent: 25,
        heightPercent: 8,
        required: true,
        label: null,
        placeholder: null,
        sortOrder: 0,
      },
    ],
    ...overrides,
  };
}

describe('e-signing prior signer preview projection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionMocks.getEsigningSessionClaims.mockResolvedValue({
      recipientId: 'recipient-current',
      envelopeId: 'envelope-1',
      sessionVersion: 1,
      sessionId: null,
    });
    sessionMocks.createEsigningDownloadToken.mockResolvedValue('download-token');
    prismaMocks.emailDeliveryFindMany.mockResolvedValue([]);
    storageMocks.download.mockResolvedValue(Buffer.from('saved-signature'));
    storageMocks.getSignedUrl.mockImplementation(
      async (path: string) => `https://storage.example/${path}`
    );
  });

  it('returns only finalized prior-signer signature assets in the session DTO', async () => {
    prismaMocks.findFirstEnvelope.mockResolvedValue(makeSigningSessionEnvelope());
    prismaMocks.fieldValueFindMany
      // Current signer draft values are returned separately from the prior
      // signer projection and must not be reused for this query.
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          fieldDefinitionId: 'field-prior',
          recipientId: 'recipient-prior',
          signatureStoragePath: 'tenant-1/envelope-1/recipient-prior/signature.png',
          fieldDefinition: {
            recipientId: 'recipient-prior',
            documentId: 'document-1',
            pageNumber: 2,
            xPercent: 30,
            yPercent: 40,
            widthPercent: 20,
            heightPercent: 7,
          },
          recipient: { name: 'Prior Signer' },
        },
      ]);

    const result = await loadEsigningSigningSession();
    const signedSignatures = result.signedSignatures ?? [];

    expect(signedSignatures).toEqual([
      {
        fieldDefinitionId: 'field-prior',
        signaturePreviewUrl:
          `data:image/png;base64,${Buffer.from('saved-signature').toString('base64')}`,
        signerName: 'Prior Signer',
        documentId: 'document-1',
        pageNumber: 2,
        xPercent: 30,
        yPercent: 40,
        widthPercent: 20,
        heightPercent: 7,
      },
    ]);
    expect(Object.keys(signedSignatures[0] ?? {}).sort()).toEqual([
      'documentId',
      'fieldDefinitionId',
      'heightPercent',
      'pageNumber',
      'signaturePreviewUrl',
      'signerName',
      'widthPercent',
      'xPercent',
      'yPercent',
    ]);
    expect(storageMocks.download).toHaveBeenCalledWith(
      'tenant-1/envelope-1/recipient-prior/signature.png'
    );
  });

  it('restores a saved draft signature without a public storage URL', async () => {
    prismaMocks.findFirstEnvelope.mockResolvedValue(makeSigningSessionEnvelope());
    const bytes = Buffer.from('saved-draft-signature');
    storageMocks.download.mockResolvedValue(bytes);
    prismaMocks.fieldValueFindMany.mockResolvedValueOnce([{
      id: 'value-current', fieldDefinitionId: 'field-current', recipientId: 'recipient-current',
      value: 'signed', signatureStoragePath: 'tenant-1/envelope-1/recipient-current/signature.png',
      filledAt: new Date(), finalizedAt: null, revision: 1,
    }]).mockResolvedValueOnce([]);

    const session = await loadEsigningSigningSession();

    expect(session.fieldValues[0].signaturePreviewUrl).toBe(`data:image/png;base64,${bytes.toString('base64')}`);
    expect(storageMocks.download).toHaveBeenCalledWith('tenant-1/envelope-1/recipient-current/signature.png');
    expect(storageMocks.getSignedUrl).not.toHaveBeenCalled();
  });

  it('scopes the read to signed signer values in the current tenant and envelope', async () => {
    prismaMocks.findFirstEnvelope.mockResolvedValue(makeSigningSessionEnvelope());
    prismaMocks.fieldValueFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await loadEsigningSigningSession();

    const priorSignatureQuery = prismaMocks.fieldValueFindMany.mock.calls[1]?.[0];
    expect(priorSignatureQuery).toEqual(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'tenant-1',
          finalizedAt: { not: null },
          signatureStoragePath: { not: null },
          fieldDefinition: expect.objectContaining({
            tenantId: 'tenant-1',
            envelopeId: 'envelope-1',
            type: { in: ['SIGNATURE', 'INITIALS'] },
            document: {
              tenantId: 'tenant-1',
              envelopeId: 'envelope-1',
            },
          }),
          recipient: {
            tenantId: 'tenant-1',
            envelopeId: 'envelope-1',
            id: { not: 'recipient-current' },
            type: 'SIGNER',
            status: 'SIGNED',
            signedAt: { not: null },
          },
        }),
      })
    );
  });
});

describe('e-signing completion queueing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('queues one completion delivery for every recipient plus the sender', async () => {
    const completedAt = new Date('2026-08-01T00:00:00.000Z');
    const tx = makeTx();

    await expect(finalizeEsigningEnvelopeCompletion(tx as never, {
      tenantId: 'tenant-1',
      envelopeId: 'envelope-1',
      currentStatus: 'IN_PROGRESS',
      remainingSignerCount: 0,
      completedAt,
    })).resolves.toBe(true);

    expect(tx.esigningEmailDelivery.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          kind: 'COMPLETION',
          targetKey: 'recipient:recipient-1',
          status: 'PENDING',
          availableAt: completedAt,
        }),
        expect.objectContaining({
          kind: 'COMPLETION',
          targetKey: 'recipient:recipient-2',
          status: 'PENDING',
        }),
        expect.objectContaining({
          kind: 'COMPLETION',
          targetKey: 'sender:user-1',
          status: 'PENDING',
          toEmail: 'sender@example.com',
        }),
      ]),
      skipDuplicates: true,
    });

    const queuedData = tx.esigningEmailDelivery.createMany.mock.calls[0][0].data as unknown[];
    expect(queuedData).toHaveLength(4);
    expect(queuedData).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ targetKey: 'recipient:recipient-3' }),
      ])
    );

    expect(tx.esigningEnvelope.update).toHaveBeenCalledWith({
      where: { id: 'envelope-1' },
      data: expect.objectContaining({
        autoFilingStatus: 'PENDING',
        autoFilingAvailableAt: completedAt,
      }),
    });
  });

  it('records the first successful envelope completion on linked generated documents', async () => {
    const completedAt = new Date('2026-08-01T00:00:00.000Z');
    const tx = makeTx();

    await finalizeEsigningEnvelopeCompletion(tx as never, {
      tenantId: 'tenant-1',
      envelopeId: 'envelope-1',
      currentStatus: 'IN_PROGRESS',
      remainingSignerCount: 0,
      completedAt,
    });

    expect(tx.generatedDocument.updateMany).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-1',
        signedAt: null,
        esigningEnvelopeDocuments: {
          some: { envelopeId: 'envelope-1' },
        },
      },
      data: { signedAt: completedAt },
    });
  });

  it('marks auto-filing as NOT_REQUIRED for envelopes without a company', async () => {
    const completedAt = new Date('2026-08-01T00:00:00.000Z');
    const tx = makeTx(makeEnvelope({ companyId: null }));

    await expect(finalizeEsigningEnvelopeCompletion(tx as never, {
      tenantId: 'tenant-1',
      envelopeId: 'envelope-1',
      currentStatus: 'IN_PROGRESS',
      remainingSignerCount: 0,
      completedAt,
    })).resolves.toBe(true);

    expect(tx.esigningEnvelope.update).toHaveBeenCalledWith({
      where: { id: 'envelope-1' },
      data: { autoFilingStatus: 'NOT_REQUIRED' },
    });
  });

  it('does not create duplicate work when a repeated completion call loses the race', async () => {
    const completedAt = new Date('2026-08-01T00:00:00.000Z');
    const tx = makeTx();
    tx.esigningEnvelope.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    await finalizeEsigningEnvelopeCompletion(tx as never, {
      tenantId: 'tenant-1',
      envelopeId: 'envelope-1',
      currentStatus: 'IN_PROGRESS',
      remainingSignerCount: 0,
      completedAt,
    });
    await finalizeEsigningEnvelopeCompletion(tx as never, {
      tenantId: 'tenant-1',
      envelopeId: 'envelope-1',
      currentStatus: 'IN_PROGRESS',
      remainingSignerCount: 0,
      completedAt,
    });

    expect(tx.esigningEmailDelivery.createMany).toHaveBeenCalledTimes(1);
    expect(tx.generatedDocument.updateMany).toHaveBeenCalledTimes(1);
  });

  it('propagates a delivery-queue failure so the completion transaction rolls back', async () => {
    const completedAt = new Date('2026-08-01T00:00:00.000Z');
    const tx = makeTx();
    tx.esigningEmailDelivery.createMany.mockRejectedValue(new Error('database unavailable'));

    await expect(finalizeEsigningEnvelopeCompletion(tx as never, {
      tenantId: 'tenant-1',
      envelopeId: 'envelope-1',
      currentStatus: 'IN_PROGRESS',
      remainingSignerCount: 0,
      completedAt,
    })).rejects.toThrow('database unavailable');
  });
});

describe('e-signing completion status serialization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionMocks.getEsigningSessionClaims.mockResolvedValue({
      recipientId: 'recipient-1',
      envelopeId: 'envelope-1',
      sessionVersion: 1,
      sessionId: null,
    });
  });

  it('reports an earlier signer as non-terminal with remaining signers', async () => {
    prismaMocks.findFirstRecipient.mockResolvedValue({
      id: 'recipient-1',
      status: 'NOTIFIED',
      signedAt: null,
      sessionVersion: 1,
      envelope: {
        id: 'envelope-1',
        status: 'IN_PROGRESS',
        expiresAt: null,
        pdfGenerationStatus: null,
        autoFilingStatus: 'NOT_REQUIRED',
        emailDeliveries: [],
      },
    });
    prismaMocks.countRecipients.mockResolvedValue(2);

    const status = await getEsigningSigningSessionStatus();

    expect(status.remainingSignerCount).toBe(2);
    expect(status.terminal).toBe(false);
    expect(status.currentRecipientDeliveryStatus).toBe('AWAITING_COMPLETION');
  });

  it('treats a final signer with a pending PDF as non-terminal', async () => {
    prismaMocks.findFirstRecipient.mockResolvedValue({
      id: 'recipient-1',
      status: 'SIGNED',
      signedAt: new Date('2026-08-11T08:00:00.000Z'),
      sessionVersion: 1,
      envelope: {
        id: 'envelope-1',
        status: 'COMPLETED',
        expiresAt: null,
        pdfGenerationStatus: 'PENDING',
        autoFilingStatus: 'NOT_REQUIRED',
        emailDeliveries: [
          {
            status: 'PENDING',
            kind: 'COMPLETION',
            targetKey: 'recipient:recipient-1',
            recipientId: 'recipient-1',
          },
        ],
      },
    });
    prismaMocks.countRecipients.mockResolvedValue(0);

    const status = await getEsigningSigningSessionStatus();

    expect(status.terminal).toBe(false);
    expect(status.currentRecipientDeliveryStatus).toBe('PENDING');
  });

  it('treats a failed PDF as terminal for public polling', async () => {
    prismaMocks.findFirstRecipient.mockResolvedValue({
      id: 'recipient-1',
      status: 'SIGNED',
      signedAt: new Date('2026-08-11T08:00:00.000Z'),
      sessionVersion: 1,
      envelope: {
        id: 'envelope-1',
        status: 'COMPLETED',
        expiresAt: null,
        pdfGenerationStatus: 'FAILED',
        autoFilingStatus: 'COMPLETED',
        emailDeliveries: [],
      },
    });
    prismaMocks.countRecipients.mockResolvedValue(0);

    const status = await getEsigningSigningSessionStatus();

    expect(status.terminal).toBe(true);
    expect(status.currentRecipientDeliveryStatus).toBe('NOT_TRACKED');
  });

  it('keeps polling while auto-file or delivery is retryable', async () => {
    prismaMocks.findFirstRecipient.mockResolvedValue({
      id: 'recipient-1',
      status: 'SIGNED',
      signedAt: new Date('2026-08-11T08:00:00.000Z'),
      sessionVersion: 1,
      envelope: {
        id: 'envelope-1',
        status: 'COMPLETED',
        expiresAt: null,
        pdfGenerationStatus: 'COMPLETED',
        autoFilingStatus: 'FAILED_RETRYABLE',
        emailDeliveries: [
          {
            status: 'FAILED_RETRYABLE',
            kind: 'COMPLETION',
            targetKey: 'recipient:recipient-1',
            recipientId: 'recipient-1',
          },
        ],
      },
    });
    prismaMocks.countRecipients.mockResolvedValue(0);

    const status = await getEsigningSigningSessionStatus();

    expect(status.terminal).toBe(false);
    expect(status.currentRecipientDeliveryStatus).toBe('RETRYING');
    expect(status.envelope.completionDeliveryStatus).toBe('RETRYING');
  });

  it('maps delivery DTO statuses from the ledger', () => {
    const envelope = {
      status: 'COMPLETED',
      pdfGenerationStatus: 'COMPLETED',
      autoFilingStatus: 'COMPLETED',
    };

    expect(
      getEsigningPostCompletionSummary(envelope, [
        { kind: 'COMPLETION', status: 'PENDING' },
        { kind: 'COMPLETION', status: 'SUCCEEDED' },
      ]).completionDeliveryStatus
    ).toBe('PENDING');
    expect(
      getEsigningPostCompletionSummary(envelope, [
        { kind: 'COMPLETION', status: 'FAILED_RETRYABLE' },
      ])
        .completionDeliveryStatus
    ).toBe('RETRYING');
    expect(
      getEsigningPostCompletionSummary(envelope, [
        { kind: 'COMPLETION', status: 'FAILED_PERMANENT' },
      ])
        .completionDeliveryStatus
    ).toBe('FAILED');
    expect(
      getEsigningPostCompletionSummary(envelope, [
        { kind: 'COMPLETION', status: 'SUCCEEDED' },
      ])
        .completionDeliveryStatus
    ).toBe('COMPLETED');
    expect(getEsigningPostCompletionSummary(envelope, []).completionDeliveryStatus).toBe(
      'NOT_TRACKED'
    );
  });
});

describe('e-signing completion retry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rbacMocks.hasPermission.mockResolvedValue(false);
    prismaMocks.findFirstEnvelope.mockResolvedValue({
      id: 'envelope-1',
      status: 'COMPLETED',
      title: 'NDA',
      companyId: 'company-1',
      createdById: 'user-1',
      pdfGenerationStatus: 'FAILED',
      autoFilingStatus: 'FAILED_RETRYABLE',
    });
    prismaMocks.transaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) => {
        return callback({
          esigningEnvelope: { updateMany: prismaMocks.envelopeUpdateMany },
          esigningEmailDelivery: { updateMany: prismaMocks.deliveryUpdateMany },
        });
      }
    );
    prismaMocks.envelopeUpdateMany.mockResolvedValue({ count: 1 });
    prismaMocks.deliveryUpdateMany.mockResolvedValue({ count: 1 });
    prismaMocks.fieldValueFindMany.mockResolvedValue([]);
  });

  it('resets only failed completion stages', async () => {
    const now = new Date('2026-08-11T00:00:00.000Z');
    prismaMocks.findFirstEnvelope
      .mockResolvedValueOnce({
        id: 'envelope-1',
        status: 'COMPLETED',
        title: 'NDA',
        companyId: 'company-1',
        createdById: 'user-1',
        pdfGenerationStatus: 'FAILED',
        autoFilingStatus: 'FAILED_RETRYABLE',
      })
      .mockResolvedValueOnce({
        id: 'envelope-1',
        tenantId: 'tenant-1',
        title: 'NDA',
        message: null,
        status: 'COMPLETED',
        signingOrder: 'PARALLEL',
        expiresAt: null,
        reminderFrequencyDays: null,
        reminderStartDays: null,
        expiryWarningDays: null,
        companyId: 'company-1',
        company: { id: 'company-1', name: 'Acme' },
        certificateId: 'certificate-1',
        completedAt: now,
        createdAt: now,
        updatedAt: now,
        voidedAt: null,
        voidReason: null,
        pdfGenerationStatus: 'PENDING',
        pdfGenerationError: null,
        autoFilingStatus: 'PENDING',
        createdById: 'user-1',
        createdBy: { id: 'user-1', firstName: 'Sender', lastName: null, email: 'sender@example.com' },
        documents: [],
        recipients: [],
        fieldDefinitions: [],
        events: [],
        emailDeliveries: [],
      });

    await retryEsigningEnvelopeCompletionProcessing(
      {
        id: 'user-1',
        tenantId: 'tenant-1',
        isSuperAdmin: true,
        isWorkspaceAdmin: true,
      } as never,
      'tenant-1',
      'envelope-1'
    );

    expect(prismaMocks.envelopeUpdateMany).toHaveBeenCalledTimes(2);
    expect(prismaMocks.envelopeUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ pdfGenerationStatus: 'FAILED' }),
        data: expect.objectContaining({ pdfGenerationStatus: 'PENDING' }),
      })
    );
    expect(prismaMocks.envelopeUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          autoFilingStatus: { in: ['FAILED_RETRYABLE', 'FAILED_PERMANENT'] },
        }),
        data: expect.objectContaining({ autoFilingStatus: 'PENDING' }),
      })
    );
    expect(prismaMocks.deliveryUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          kind: 'COMPLETION',
          status: { in: ['FAILED_RETRYABLE', 'FAILED_PERMANENT'] },
        }),
        data: expect.objectContaining({ status: 'PENDING' }),
      })
    );
  });

  it('allows an update-scoped creator to retry their own failed completion work', async () => {
    rbacMocks.hasPermission.mockImplementation(
      async (_userId: string, _resource: string, permission: string) => permission === 'update'
    );
    const now = new Date('2026-08-11T00:00:00.000Z');
    prismaMocks.findFirstEnvelope
      .mockResolvedValueOnce({
        id: 'envelope-1',
        status: 'COMPLETED',
        title: 'NDA',
        companyId: 'company-1',
        createdById: 'user-1',
        pdfGenerationStatus: 'FAILED',
        autoFilingStatus: 'FAILED_RETRYABLE',
      })
      .mockResolvedValueOnce({
        id: 'envelope-1',
        tenantId: 'tenant-1',
        title: 'NDA',
        message: null,
        status: 'COMPLETED',
        signingOrder: 'PARALLEL',
        expiresAt: null,
        reminderFrequencyDays: null,
        reminderStartDays: null,
        expiryWarningDays: null,
        companyId: 'company-1',
        company: { id: 'company-1', name: 'Acme' },
        certificateId: 'certificate-1',
        completedAt: now,
        createdAt: now,
        updatedAt: now,
        voidedAt: null,
        voidReason: null,
        pdfGenerationStatus: 'PENDING',
        pdfGenerationError: null,
        autoFilingStatus: 'PENDING',
        createdById: 'user-1',
        createdBy: { id: 'user-1', firstName: 'Sender', lastName: null, email: 'sender@example.com' },
        documents: [],
        recipients: [],
        fieldDefinitions: [],
        events: [],
        emailDeliveries: [],
      });

    await retryEsigningEnvelopeCompletionProcessing(
      {
        id: 'user-1',
        tenantId: 'tenant-1',
        isSuperAdmin: false,
        isWorkspaceAdmin: false,
      } as never,
      'tenant-1',
      'envelope-1'
    );

    expect(prismaMocks.envelopeUpdateMany).toHaveBeenCalled();
  });

  it('forbids a non-creator without broader object access from retrying', async () => {
    rbacMocks.hasPermission.mockImplementation(
      async (_userId: string, _resource: string, permission: string) => permission === 'read'
    );
    prismaMocks.findFirstEnvelope.mockResolvedValue({
      id: 'envelope-1',
      status: 'COMPLETED',
      title: 'NDA',
      companyId: 'company-1',
      createdById: 'user-1',
      pdfGenerationStatus: 'FAILED',
      autoFilingStatus: 'FAILED_RETRYABLE',
    });

    await expect(
      retryEsigningEnvelopeCompletionProcessing(
        {
          id: 'user-2',
          tenantId: 'tenant-1',
          isSuperAdmin: false,
          isWorkspaceAdmin: false,
        } as never,
        'tenant-1',
        'envelope-1'
      )
    ).rejects.toThrow('Forbidden');

    expect(prismaMocks.envelopeUpdateMany).not.toHaveBeenCalled();
    expect(prismaMocks.transaction).not.toHaveBeenCalled();
  });
});

describe('e-signing field-value save consent enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionMocks.getEsigningSessionClaims.mockResolvedValue({
      recipientId: 'recipient-1',
      envelopeId: 'envelope-1',
      sessionVersion: 1,
      sessionId: null,
    });
    fieldServiceMocks.saveRecipientFieldValues.mockResolvedValue(undefined);
  });

  function makeContextEnvelope(consentedAt: Date | null) {
    return {
      id: 'envelope-1',
      tenantId: 'tenant-1',
      tenant: { id: 'tenant-1', name: 'Acme Pte Ltd' },
      company: null,
      title: 'NDA',
      message: null,
      status: 'IN_PROGRESS',
      pdfGenerationStatus: null,
      certificateId: 'certificate-1',
      createdById: 'user-1',
      createdBy: { firstName: 'Sender', lastName: null, email: 'sender@example.com' },
      completedAt: null,
      expiresAt: null,
      autoFilingStatus: 'NOT_REQUIRED',
      consentVersion: '1.0',
      documents: [],
      recipients: [
        {
          id: 'recipient-1',
          name: 'Signer',
          email: 'signer@example.com',
          type: 'SIGNER',
          status: 'VIEWED',
          sessionVersion: 1,
          accessMode: 'EMAIL_LINK',
          consentedAt,
          viewedAt: new Date('2026-08-11T08:00:00.000Z'),
          signedAt: null,
          colorTag: '#06b6d4',
        },
      ],
      fieldDefinitions: [],
    };
  }

  it('rejects every field save before stored consent exists', async () => {
    prismaMocks.findFirstEnvelope.mockResolvedValue(makeContextEnvelope(null));
    prismaMocks.fieldValueFindMany.mockResolvedValue([]);

    await expect(
      saveEsigningSigningFieldValues([{ fieldDefinitionId: 'field-1', value: 'value' }])
    ).rejects.toThrow('Consent is required before saving signing fields');

    expect(fieldServiceMocks.saveRecipientFieldValues).not.toHaveBeenCalled();
    expect(prismaMocks.envelopeUpdateMany).not.toHaveBeenCalled();
    expect(prismaMocks.deliveryUpdateMany).not.toHaveBeenCalled();
  });

  it('persists field values normally once the recipient has consented', async () => {
    const consentedAt = new Date('2026-08-11T08:00:00.000Z');
    prismaMocks.findFirstEnvelope
      .mockResolvedValueOnce(makeContextEnvelope(consentedAt))
      .mockResolvedValueOnce(makeContextEnvelope(consentedAt));
    prismaMocks.fieldValueFindMany.mockResolvedValue([]);

    await expect(
      saveEsigningSigningFieldValues([{ fieldDefinitionId: 'field-1', value: 'value' }])
    ).resolves.toMatchObject({
      envelope: { id: 'envelope-1', status: 'IN_PROGRESS' },
      recipient: { id: 'recipient-1', consentedAt: '2026-08-11T08:00:00.000Z' },
    });

    expect(fieldServiceMocks.saveRecipientFieldValues).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        envelopeId: 'envelope-1',
        recipientId: 'recipient-1',
        values: [{ fieldDefinitionId: 'field-1', value: 'value' }],
      })
    );
  });
});
