import { describe, expect, it, vi, beforeEach } from 'vitest';

describe('service schedule reconciliation scheduler task', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs batch processing with limit 20 and concurrency 4', async () => {
    const processBatchMock = vi.fn().mockResolvedValue({
      claimed: 2,
      completed: 2,
      failed: 0,
      summaries: [],
    });

    vi.doMock('@/services/schedule-reconciliation/worker', () => ({
      processScheduleReconciliationBatch: processBatchMock,
    }));

    const { runServiceScheduleReconciliationTask } = await import(
      '@/lib/scheduler/tasks/service-schedule-reconciliation.task'
    );

    const result = await runServiceScheduleReconciliationTask();

    expect(processBatchMock).toHaveBeenCalledWith({
      limit: 20,
      concurrency: 4,
    });
    expect(result).toMatchObject({ claimed: 2, completed: 2, failed: 0 });
  });
});
