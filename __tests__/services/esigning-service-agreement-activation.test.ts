import { beforeEach, describe, expect, it, vi } from 'vitest';

const activationMock = vi.hoisted(() => ({
  processQueuedServiceAgreementActivations: vi.fn(),
  queueServiceAgreementActivationsForEnvelope: vi.fn(),
}));
const completionMock = vi.hoisted(() => ({
  queueEsigningCompletionWork: vi.fn(),
}));
vi.mock('@/services/service-agreement', () => activationMock);
vi.mock('@/services/esigning-completion.service', () => completionMock);
vi.mock('@/lib/logger', () => ({ createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }) }));

import { finalizeEsigningEnvelopeCompletion, safelyProcessServiceAgreementActivations } from '@/services/esigning-signing.service';
import { serviceAgreementActivationTask } from '@/lib/scheduler/tasks/service-agreement-activation.task';

describe('E-signing Service Agreement activation integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('queues activation only after winning the authoritative completion transition', async () => {
    const completedAt = new Date('2026-08-01T00:00:00.000Z');
    const tx = {
      esigningEnvelope: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      esigningEnvelopeEvent: { create: vi.fn().mockResolvedValue({}) },
    };

    await expect(finalizeEsigningEnvelopeCompletion(tx as never, {
      tenantId: 'tenant-1', envelopeId: 'envelope-1', currentStatus: 'IN_PROGRESS', remainingSignerCount: 0, completedAt,
    })).resolves.toBe(true);
    expect(tx.esigningEnvelopeEvent.create).toHaveBeenCalledWith({ data: { tenantId: 'tenant-1', envelopeId: 'envelope-1', action: 'COMPLETED' } });
    expect(activationMock.queueServiceAgreementActivationsForEnvelope).toHaveBeenCalledWith(tx, 'envelope-1', completedAt);
    expect(completionMock.queueEsigningCompletionWork).toHaveBeenCalledWith(tx, {
      tenantId: 'tenant-1',
      envelopeId: 'envelope-1',
      completedAt,
    });
  });

  it('does not queue activation when another request already completed the envelope', async () => {
    const completedAt = new Date('2026-08-01T00:00:00.000Z');
    const tx = {
      esigningEnvelope: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      esigningEnvelopeEvent: { create: vi.fn() },
    };

    await expect(finalizeEsigningEnvelopeCompletion(tx as never, {
      tenantId: 'tenant-1', envelopeId: 'envelope-1', currentStatus: 'IN_PROGRESS', remainingSignerCount: 0, completedAt,
    })).resolves.toBe(false);
    expect(tx.esigningEnvelopeEvent.create).not.toHaveBeenCalled();
    expect(activationMock.queueServiceAgreementActivationsForEnvelope).not.toHaveBeenCalled();
    expect(completionMock.queueEsigningCompletionWork).not.toHaveBeenCalled();
  });

  it('moves a non-final signer envelope into progress without queueing activation', async () => {
    const tx = {
      esigningEnvelope: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      esigningEnvelopeEvent: { create: vi.fn() },
    };

    await expect(finalizeEsigningEnvelopeCompletion(tx as never, {
      tenantId: 'tenant-1', envelopeId: 'envelope-1', currentStatus: 'SENT', remainingSignerCount: 1, completedAt: new Date('2026-08-01T00:00:00.000Z'),
    })).resolves.toBe(false);
    expect(tx.esigningEnvelope.updateMany).toHaveBeenCalledWith({ where: { id: 'envelope-1', status: 'SENT' }, data: { status: 'IN_PROGRESS' } });
    expect(activationMock.queueServiceAgreementActivationsForEnvelope).not.toHaveBeenCalled();
    expect(completionMock.queueEsigningCompletionWork).not.toHaveBeenCalled();
  });
  it('does not fail signature completion when post-commit activation fails', async () => {
    activationMock.processQueuedServiceAgreementActivations.mockRejectedValue(new Error('temporary database failure'));
    await expect(safelyProcessServiceAgreementActivations('envelope-1')).resolves.toBeUndefined();
  });

  it('allows the scheduled task to claim work after the immediate attempt fails', async () => {
    activationMock.processQueuedServiceAgreementActivations
      .mockRejectedValueOnce(new Error('temporary database failure'))
      .mockResolvedValueOnce({ claimed: 1, completed: 1, failed: 0 });
    await safelyProcessServiceAgreementActivations('envelope-1');
    await expect(serviceAgreementActivationTask.execute()).resolves.toMatchObject({ success: true, data: { claimed: 1, completed: 1, failed: 0 } });
    expect(activationMock.processQueuedServiceAgreementActivations).toHaveBeenCalledTimes(2);
  });
});
