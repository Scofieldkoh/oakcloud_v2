import { beforeEach, describe, expect, it, vi } from 'vitest';
import { voidEsigningEnvelope } from '@/services/esigning-envelope.service';

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  transaction: vi.fn(),
  createAuditLog: vi.fn(),
  resolveEsigningActorScope: vi.fn(),
  sendVoidedEmail: vi.fn(),
  recordDeliveryResults: vi.fn(),
  getDetail: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    esigningEnvelope: { findFirst: mocks.findFirst },
    $transaction: mocks.transaction,
  },
}));

vi.mock('@/lib/audit', () => ({ createAuditLog: mocks.createAuditLog }));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

vi.mock('@/services/tasks/integration.service', () => ({
  safelyCaptureEsigningTaskStageIds: vi.fn(),
  safelyReconcileTaskStageIds: vi.fn(),
  safelyReconcileEsigningEnvelopeTaskOutcomes: vi.fn(),
}));

vi.mock('@/services/esigning-notification.service', async () => {
  const actual = await vi.importActual<typeof import('@/services/esigning-notification.service')>(
    '@/services/esigning-notification.service'
  );
  return { ...actual, sendEsigningVoidedEmailToRecipient: mocks.sendVoidedEmail };
});

vi.mock('@/services/esigning-email-delivery.service', async () => {
  const actual = await vi.importActual<typeof import('@/services/esigning-email-delivery.service')>(
    '@/services/esigning-email-delivery.service'
  );
  return { ...actual, recordEsigningEnvelopeEmailDeliveryResults: mocks.recordDeliveryResults };
});

vi.mock('@/services/esigning-envelope/lifecycle', async () => {
  const actual = await vi.importActual<typeof import('@/services/esigning-envelope/lifecycle')>(
    '@/services/esigning-envelope/lifecycle'
  );
  return { ...actual, getEsigningEnvelopeDetail: mocks.getDetail };
});

vi.mock('@/services/esigning-envelope.lib', async () => {
  const actual = await vi.importActual<typeof import('@/services/esigning-envelope.lib')>(
    '@/services/esigning-envelope.lib'
  );
  return { ...actual, resolveEsigningActorScope: mocks.resolveEsigningActorScope };
});

const session = { id: 'user-1', tenantId: 'tenant-1' } as never;

function recipient(
  id: string,
  accessMode: 'EMAIL_LINK' | 'EMAIL_WITH_CODE' | 'MANUAL_LINK',
  overrides: Record<string, unknown> = {}
) {
  return {
    id,
    name: `Recipient ${id}`,
    email: `${id}@example.com`,
    status: 'NOTIFIED',
    type: 'SIGNER',
    accessMode,
    ...overrides,
  };
}

describe('voiding an e-signing envelope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveEsigningActorScope.mockResolvedValue({ canManage: true });
    mocks.transaction.mockResolvedValue(undefined);
    mocks.createAuditLog.mockResolvedValue(undefined);
    mocks.recordDeliveryResults.mockResolvedValue(undefined);
    mocks.getDetail.mockResolvedValue({ id: 'envelope-1' });
    mocks.sendVoidedEmail.mockResolvedValue({ kind: 'voided', success: true });
  });

  it('emails link recipients but not manual link recipients', async () => {
    mocks.findFirst.mockResolvedValue({
      id: 'envelope-1',
      tenantId: 'tenant-1',
      status: 'SENT',
      title: 'Engagement letter',
      companyId: null,
      createdById: 'user-1',
      createdBy: { firstName: 'Sam', lastName: 'Tan', email: 'sam@example.com' },
      recipients: [
        recipient('email', 'EMAIL_LINK'),
        recipient('code', 'EMAIL_WITH_CODE', { status: 'VIEWED' }),
        recipient('manual', 'MANUAL_LINK'),
        recipient('manual-queued', 'MANUAL_LINK', { status: 'QUEUED' }),
        recipient('cc', 'EMAIL_LINK', { type: 'CC', status: 'QUEUED' }),
      ],
    });

    await voidEsigningEnvelope(session, 'tenant-1', 'envelope-1', 'Wrong version');

    const emailed = mocks.sendVoidedEmail.mock.calls.map(([input]) => input.to);
    expect(emailed).toEqual(['email@example.com', 'code@example.com', 'cc@example.com']);
    expect(mocks.sendVoidedEmail).toHaveBeenCalledWith(
      expect.objectContaining({ envelopeTitle: 'Engagement letter', reason: 'Wrong version' })
    );
  });
});
