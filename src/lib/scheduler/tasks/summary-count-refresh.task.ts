import type { TaskRegistration } from '@/lib/scheduler/types';
import { refreshCompanySummaryCounts } from '@/services/company.service';

export async function refreshSummaryCounts() {
  return refreshCompanySummaryCounts();
}

export const summaryCountRefreshTask: TaskRegistration = {
  id: 'summary-count-refresh',
  name: 'Refresh summary counts',
  description: 'Refresh denormalized company counters and materialized summary views.',
  defaultCronPattern: '30 3 * * *',
  execute: async () => {
    const result = await refreshSummaryCounts();
    return {
      success: true,
      message: `Refreshed summary counts for ${result.updated} companies`,
      data: result,
    };
  },
};
