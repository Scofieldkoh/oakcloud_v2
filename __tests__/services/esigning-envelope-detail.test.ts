import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getEsigningEnvelopeDetail } from '@/services/esigning-envelope.service';

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  fieldValueFindMany: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    esigningEnvelope: {
      findFirst: mocks.findFirst,
    },
    esigningDocumentFieldValue: {
      findMany: mocks.fieldValueFindMany,
    },
  },
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

const session = {
  id: 'user-1',
  tenantId: 'tenant-1',
  isSuperAdmin: true,
  isWorkspaceAdmin: true,
} as never;

function makeEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    id: 'envelope-1',
    tenantId: 'tenant-1',
    tenant: { id: 'tenant-1', name: 'Acme Pte Ltd' },
    title: 'NDA',
    message: null,
    status: 'COMPLETED',
    signingOrder: 'PARALLEL',
    expiresAt: null,
    reminderFrequencyDays: null,
    reminderStartDays: null,
    expiryWarningDays: null,
    companyId: null,
    company: null,
    certificateId: 'certificate-1',
    completedAt: new Date('2026-08-01T00:00:00.000Z'),
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    voidedAt: null,
    voidReason: null,
    pdfGenerationStatus: 'COMPLETED',
    pdfGenerationError: null,
    autoFilingStatus: 'COMPLETED',
    metadata: null,
    createdById: 'user-1',
    createdBy: {
      id: 'user-1',
      firstName: 'Sender',
      lastName: null,
      email: 'sender@example.com',
    },
    documents: [],
    recipients: [],
    fieldDefinitions: [],
    events: [],
    emailDeliveries: [],
    ...overrides,
  };
}

describe('e-signing envelope detail serialization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fieldValueFindMany.mockResolvedValue([]);
  });

  it('passes the real ledger snapshot into delivery health', async () => {
    mocks.findFirst.mockResolvedValue(makeEnvelope({
      emailDeliveries: [
        {
          kind: 'REQUEST',
          targetKey: 'recipient:recipient-1',
          toEmail: 'signer@example.com',
          subject: 'Signature requested',
          status: 'FAILED_RETRYABLE',
          lastError: 'SMTP rejected recipient',
          lastAttemptedAt: new Date('2026-08-01T01:00:00.000Z'),
        },
      ],
    }));

    const detail = await getEsigningEnvelopeDetail(session, 'tenant-1', 'envelope-1');

    expect(detail.emailDelivery).toMatchObject({
      status: 'failed',
      lastFailureAt: '2026-08-01T01:00:00.000Z',
      failures: [
        expect.objectContaining({
          kind: 'request',
          to: 'signer@example.com',
          error: 'SMTP rejected recipient',
        }),
      ],
    });
    expect(detail.postCompletion).toMatchObject({
      completionDeliveryStatus: 'NOT_TRACKED',
      failedCompletionDeliveryCount: 0,
    });
    expect(detail.canRetryCompletionProcessing).toBe(false);
  });

  it('scopes retry capability and completion status to failed COMPLETION rows', async () => {
    mocks.findFirst.mockResolvedValue(makeEnvelope({
      emailDeliveries: [
        {
          kind: 'REMINDER',
          targetKey: 'recipient:recipient-1:reminder:2026-08-01T00:00:00.000Z',
          toEmail: 'signer@example.com',
          subject: 'Reminder',
          status: 'FAILED_PERMANENT',
          lastError: 'permanent reminder failure',
          lastAttemptedAt: new Date('2026-08-01T01:00:00.000Z'),
        },
      ],
    }));

    let detail = await getEsigningEnvelopeDetail(session, 'tenant-1', 'envelope-1');
    expect(detail.postCompletion.completionDeliveryStatus).toBe('NOT_TRACKED');
    expect(detail.canRetryCompletionProcessing).toBe(false);

    mocks.findFirst.mockResolvedValue(makeEnvelope({
      emailDeliveries: [
        {
          kind: 'COMPLETION',
          targetKey: 'recipient:recipient-1',
          toEmail: 'signer@example.com',
          subject: 'Completed: NDA',
          status: 'FAILED_PERMANENT',
          lastError: 'completion failure',
          lastAttemptedAt: new Date('2026-08-01T02:00:00.000Z'),
        },
      ],
    }));

    detail = await getEsigningEnvelopeDetail(session, 'tenant-1', 'envelope-1');
    expect(detail.postCompletion).toMatchObject({
      completionDeliveryStatus: 'FAILED',
      failedCompletionDeliveryCount: 1,
    });
    expect(detail.canRetryCompletionProcessing).toBe(true);
  });

  it('reports NOT_TRACKED for a historical completed envelope with no completion rows', async () => {
    mocks.findFirst.mockResolvedValue(makeEnvelope());

    const detail = await getEsigningEnvelopeDetail(session, 'tenant-1', 'envelope-1');

    expect(detail.postCompletion.completionDeliveryStatus).toBe('NOT_TRACKED');
    expect(detail.emailDelivery).toMatchObject({ status: 'ok', failures: [] });
    expect(detail.canDelete).toBe(true);
  });

  it('serializes the preserved original document filename', async () => {
    mocks.findFirst.mockResolvedValue(makeEnvelope({
      documents: [{
        id: 'document-1',
        fileName: 'dr-appointment-of-corp-sec-flowmind-ai-pte-limited-2026-08-29.pdf',
        originalFileName: 'DR - Appointment of Corp Sec_Flowmind AI Pte. Limited_29 Aug 2026',
        pageCount: 1,
        sortOrder: 0,
        fileSize: 1024,
        originalHash: 'hash-1',
        signedHash: null,
      }],
    }));

    const detail = await getEsigningEnvelopeDetail(session, 'tenant-1', 'envelope-1');

    expect(detail.documents[0]).toMatchObject({
      fileName: 'DR - Appointment of Corp Sec_Flowmind AI Pte. Limited_29 Aug 2026',
      originalFileName: 'DR - Appointment of Corp Sec_Flowmind AI Pte. Limited_29 Aug 2026',
    });
  });
});
