import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getEsigningEmailDeliveryHealth,
  recordEsigningEnvelopeEmailDeliveryResults,
  withEsigningDeliveryTarget,
  type EsigningLedgerDeliverySnapshot,
} from '@/services/esigning-email-delivery.service';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  upsert: vi.fn(),
  create: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: mocks.transaction,
    esigningEmailDelivery: { upsert: mocks.upsert },
    esigningEmailDeliveryAttempt: { create: mocks.create },
  },
}));

function delivery(
  overrides: Partial<EsigningLedgerDeliverySnapshot> = {}
): EsigningLedgerDeliverySnapshot {
  return {
    kind: 'REQUEST',
    targetKey: 'recipient:signer-1',
    toEmail: 'signer-1@example.com',
    subject: 'Signature requested',
    status: 'SUCCEEDED',
    lastError: null,
    lastAttemptedAt: '2026-06-30T10:00:00.000Z',
    ...overrides,
  };
}

describe('e-signing email delivery health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      return callback({
        esigningEmailDelivery: { upsert: mocks.upsert },
        esigningEmailDeliveryAttempt: { create: mocks.create },
      });
    });
    mocks.upsert.mockResolvedValue({ id: 'delivery-1' });
    mocks.create.mockResolvedValue({ id: 'attempt-1' });
  });

  it('does not clear a request failure when a reminder succeeds', () => {
    const health = getEsigningEmailDeliveryHealth([
      delivery({ kind: 'REQUEST', targetKey: 'recipient:signer-1', status: 'FAILED_RETRYABLE', lastError: 'SMTP rejected recipient' }),
      delivery({ kind: 'REMINDER', targetKey: 'recipient:signer-1:reminder:2026-06-30T10:05:00.000Z', status: 'SUCCEEDED' }),
    ], null);

    expect(health.status).toBe('failed');
    expect(health.failures).toEqual([
      expect.objectContaining({ kind: 'request', targetKey: 'recipient:signer-1' }),
    ]);
  });

  it('shows a failed ledger delivery even when legacy metadata is empty', () => {
    const health = getEsigningEmailDeliveryHealth([
      delivery({ kind: 'REQUEST', status: 'FAILED_RETRYABLE', lastError: 'SMTP rejected recipient' }),
    ], null);

    expect(health.status).toBe('failed');
    expect(health.failures).toEqual([
      expect.objectContaining({
        kind: 'request',
        to: 'signer-1@example.com',
        error: 'SMTP rejected recipient',
      }),
    ]);
    expect(health.lastFailureAt).toBe('2026-06-30T10:00:00.000Z');
  });

  it('a successful ledger row clears only the matching legacy failure', () => {
    const legacy = {
      emailDelivery: {
        status: 'failed',
        lastFailureAt: '2026-06-29T09:00:00.000Z',
        failures: [
          {
            kind: 'request',
            to: 'SIGNER-1@example.com',
            subject: 'Signature requested',
            error: 'legacy SMTP failure',
            attemptedAt: '2026-06-29T09:00:00.000Z',
          },
          {
            kind: 'reminder',
            to: 'other@example.com',
            subject: 'Reminder',
            error: 'legacy reminder failure',
            attemptedAt: '2026-06-29T09:05:00.000Z',
          },
        ],
      },
    };

    const health = getEsigningEmailDeliveryHealth([
      delivery({ kind: 'REQUEST', toEmail: 'signer-1@example.com', status: 'SUCCEEDED' }),
    ], legacy);

    expect(health.status).toBe('failed');
    expect(health.failures).toEqual([
      expect.objectContaining({ kind: 'reminder', to: 'other@example.com' }),
    ]);
  });

  it('an unrelated ledger failure does not hide unmatched legacy failures', () => {
    const legacy = {
      emailDelivery: {
        status: 'failed',
        lastFailureAt: '2026-06-29T09:00:00.000Z',
        failures: [
          {
            kind: 'request',
            to: 'signer-1@example.com',
            subject: 'Signature requested',
            error: 'legacy failure',
            attemptedAt: '2026-06-29T09:00:00.000Z',
          },
        ],
      },
    };

    const health = getEsigningEmailDeliveryHealth([
      delivery({ kind: 'REMINDER', status: 'FAILED_RETRYABLE', lastError: 'ledger failure' }),
    ], legacy);

    expect(health.status).toBe('failed');
    expect(health.failures).toHaveLength(2);
    expect(health.failures).toEqual([
      expect.objectContaining({ kind: 'reminder' }),
      expect.objectContaining({ kind: 'request', to: 'signer-1@example.com' }),
    ]);
  });

  it('merges failures newest-first, limits to ten, and derives lastFailureAt', () => {
    const legacyFailures = Array.from({ length: 6 }, (_, index) => ({
      kind: 'request' as const,
      to: `legacy-${index}@example.com`,
      subject: 'Signature requested',
      error: `legacy ${index}`,
      attemptedAt: `2026-06-29T09:0${index}:00.000Z`,
    }));
    const ledgerFailures = Array.from({ length: 6 }, (_, index) =>
      delivery({
        kind: 'REMINDER',
        toEmail: `ledger-${index}@example.com`,
        status: 'FAILED_RETRYABLE',
        lastError: `ledger ${index}`,
        lastAttemptedAt: `2026-06-30T1${index}:00:00.000Z`,
      })
    );

    const health = getEsigningEmailDeliveryHealth(ledgerFailures, {
      emailDelivery: {
        status: 'failed',
        lastFailureAt: '2026-06-29T09:05:00.000Z',
        failures: legacyFailures,
      },
    });

    expect(health.failures).toHaveLength(10);
    expect(health.failures[0]).toEqual(expect.objectContaining({
      kind: 'reminder',
      to: 'ledger-5@example.com',
      attemptedAt: '2026-06-30T15:00:00.000Z',
    }));
    const times = health.failures.map((failure) => new Date(failure.attemptedAt).getTime());
    expect(times).toEqual([...times].sort((left, right) => right - left));
    expect(health.lastFailureAt).toBe('2026-06-30T15:00:00.000Z');
  });

  it('clears only the matching request failure after a successful retry', () => {
    const health = getEsigningEmailDeliveryHealth([
      delivery({ kind: 'REQUEST', targetKey: 'recipient:signer-1', status: 'SUCCEEDED' }),
      delivery({ kind: 'REQUEST', targetKey: 'recipient:signer-2', toEmail: 'signer-2@example.com', status: 'FAILED_RETRYABLE', lastError: 'SMTP rejected recipient' }),
    ], null);

    expect(health.failures).toEqual([
      expect.objectContaining({ kind: 'request', targetKey: 'recipient:signer-2' }),
    ]);
  });

  it('falls back to legacy metadata failures when the ledger has none', () => {
    const health = getEsigningEmailDeliveryHealth([], {
      emailDelivery: {
        status: 'failed',
        lastFailureAt: '2026-06-29T09:00:00.000Z',
        failures: [
          {
            kind: 'request',
            to: 'signer@example.com',
            subject: 'Signature requested',
            error: 'SMTP rejected recipient',
            attemptedAt: '2026-06-29T09:00:00.000Z',
          },
        ],
      },
    });

    expect(health.status).toBe('failed');
    expect(health.failures[0]).toEqual(expect.objectContaining({
      kind: 'request',
      targetKey: 'legacy:request:signer@example.com',
    }));
  });

  it('records a successful attempt with the provider message id', async () => {
    await recordEsigningEnvelopeEmailDeliveryResults('envelope-1', [
      withEsigningDeliveryTarget({
        ok: true,
        kind: 'request',
        to: 'signer-1@example.com',
        subject: 'Signature requested',
        attemptedAt: '2026-06-30T10:00:00.000Z',
        providerMessageId: 'graph-123',
      }, {
        tenantId: 'tenant-1',
        targetKey: 'recipient:signer-1',
        audience: 'RECIPIENT',
        recipientId: 'signer-1',
      }),
    ]);

    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        envelopeId_kind_targetKey: {
          envelopeId: 'envelope-1',
          kind: 'REQUEST',
          targetKey: 'recipient:signer-1',
        },
      },
      create: expect.objectContaining({
        tenantId: 'tenant-1',
        status: 'SUCCEEDED',
        sentAt: new Date('2026-06-30T10:00:00.000Z'),
      }),
    }));
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        deliveryId: 'delivery-1',
        succeeded: true,
        providerMessageId: 'graph-123',
      }),
    }));
  });

  it('records a failed attempt with the retained error', async () => {
    await recordEsigningEnvelopeEmailDeliveryResults('envelope-1', [
      withEsigningDeliveryTarget({
        ok: false,
        kind: 'reminder',
        to: 'signer-1@example.com',
        subject: 'Reminder',
        attemptedAt: '2026-06-30T10:05:00.000Z',
        error: 'SMTP rejected recipient',
      }, {
        tenantId: 'tenant-1',
        targetKey: 'recipient:signer-1:reminder:2026-06-30T10:05:00.000Z',
        audience: 'RECIPIENT',
        recipientId: 'signer-1',
      }),
    ]);

    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        envelopeId_kind_targetKey: {
          envelopeId: 'envelope-1',
          kind: 'REMINDER',
          targetKey: 'recipient:signer-1:reminder:2026-06-30T10:05:00.000Z',
        },
      },
      create: expect.objectContaining({
        status: 'FAILED_RETRYABLE',
        lastError: 'SMTP rejected recipient',
        sentAt: null,
      }),
    }));
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        succeeded: false,
        error: 'SMTP rejected recipient',
      }),
    }));
  });
});
