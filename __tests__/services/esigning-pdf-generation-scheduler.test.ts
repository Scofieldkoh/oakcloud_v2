import { describe, expect, it, vi } from 'vitest';

const completionMocks = vi.hoisted(() => ({
  processQueuedEsigningCompletionWork: vi.fn(),
}));

vi.mock('@/services/esigning-completion.service', () => completionMocks);

import { esigningPdfGenerationTask } from '@/lib/scheduler/tasks/esigning-pdf-generation.task';

describe('e-signing PDF generation scheduler fallback', () => {
  it('inherits the master scheduler switch and checks for recovery work every minute', async () => {
    expect(esigningPdfGenerationTask.enabledEnvVar).toBe('SCHEDULER_ENABLED');
    expect(esigningPdfGenerationTask.defaultCronPattern).toBe('* * * * *');

    completionMocks.processQueuedEsigningCompletionWork.mockResolvedValue({ processed: 1 });

    await expect(esigningPdfGenerationTask.execute()).resolves.toMatchObject({
      success: true,
      data: { processed: 1 },
    });
    expect(completionMocks.processQueuedEsigningCompletionWork).toHaveBeenCalledWith({ limit: 5 });
  });
});
