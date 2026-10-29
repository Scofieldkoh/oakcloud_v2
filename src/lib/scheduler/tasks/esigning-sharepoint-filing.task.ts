import { createLogger } from '@/lib/logger';
import { processQueuedSharePointFilings } from '@/services/esigning-sharepoint-filing/worker';
import type { TaskRegistration, TaskResult } from '../types';

const log = createLogger('esigning-sharepoint-filing-task');

export const esigningSharePointFilingTask: TaskRegistration = {
  id: 'esigning-sharepoint-filing',
  name: 'Signed-document SharePoint filing',
  description: 'Files completed signed PDFs into verified workspace SharePoint folders',
  enabledEnvVar: 'SCHEDULER_ENABLED',
  defaultCronPattern: '* * * * *',
  execute: async (): Promise<TaskResult> => {
    try {
      const result = await processQueuedSharePointFilings({ limit: 25 });
      return {
        success: true,
        message: result.paused ? 'SharePoint signed-document filing is paused' : `Processed ${result.processed} SharePoint filing job(s)`,
        data: { ...result },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown SharePoint filing error';
      log.error('Failed to process SharePoint filing jobs', error);
      return { success: false, error: message };
    }
  },
};
