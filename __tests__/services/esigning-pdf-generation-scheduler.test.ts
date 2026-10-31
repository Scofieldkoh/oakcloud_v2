import { describe, expect, it, vi } from 'vitest';

const completionMocks = vi.hoisted(() => ({
  processQueuedEsigningCompletionWork: vi.fn(),
}));
const signingMocks = vi.hoisted(() => ({
  sweepStuckEsigningEnvelopes: vi.fn(),
}));

vi.mock('@/services/esigning-completion.service', () => completionMocks);
vi.mock('@/services/esigning-signing.service', () => signingMocks);

import { esigningPdfGenerationTask } from '@/lib/scheduler/tasks/esigning-pdf-generation.task';

describe('e-signing PDF generation scheduler fallback', () => {
  it('inherits the master scheduler switch and checks for recovery work every minute', async () => {
    expect(esigningPdfGenerationTask.enabledEnvVar).toBe('SCHEDULER_ENABLED');
    expect(esigningPdfGenerationTask.defaultCronPattern).toBe('* * * * *');

    completionMocks.processQueuedEsigningCompletionWork.mockResolvedValue({ processed: 1 });
    signingMocks.sweepStuckEsigningEnvelopes.mockResolvedValue({ found: 0, completed: 0, failed: 0 });

    await expect(esigningPdfGenerationTask.execute()).resolves.toMatchObject({
      success: true,
      data: { processed: 1 },
    });
    expect(completionMocks.processQueuedEsigningCompletionWork).toHaveBeenCalledWith({ limit: 5 });
  });

  it('sweeps stuck envelopes before the completion queue and survives a sweep failure', async () => {
    const order: string[] = [];
    signingMocks.sweepStuckEsigningEnvelopes.mockImplementationOnce(async () => {
      order.push('sweep');
      return { found: 1, completed: 1, failed: 0 };
    });
    completionMocks.processQueuedEsigningCompletionWork.mockImplementationOnce(async () => {
      order.push('queue');
      return { processed: 0 };
    });

    await expect(esigningPdfGenerationTask.execute()).resolves.toMatchObject({
      success: true,
      data: { processed: 0, stuckEnvelopeSweep: { found: 1, completed: 1, failed: 0 } },
    });
    expect(order).toEqual(['sweep', 'queue']);

    signingMocks.sweepStuckEsigningEnvelopes.mockRejectedValueOnce(new Error('db down'));
    completionMocks.processQueuedEsigningCompletionWork.mockResolvedValueOnce({ processed: 2 });
    await expect(esigningPdfGenerationTask.execute()).resolves.toMatchObject({
      success: true,
      data: { processed: 2 },
    });
  });
});
