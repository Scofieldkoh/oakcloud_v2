import { createLogger } from '@/lib/logger';
import { reconcileFormUrlHealth } from '@/services/form-url-health.service';
import type { TaskRegistration, TaskResult } from '../types';

const log = createLogger('form-url-health-task');

async function executeFormUrlHealthTask(): Promise<TaskResult> {
  log.info('Checking form URL health...');
  try {
    const result = await reconcileFormUrlHealth();
    return {
      success: true,
      message: `Checked ${result.checked} form URL(s); ${result.warnings} warning(s) active`,
      data: result,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error('Failed to check form URL health', error);
    return { success: false, error: errorMessage };
  }
}

export const formUrlHealthTask: TaskRegistration = {
  id: 'form-url-health',
  name: 'Form URL Health',
  description: 'Checks URL information fields and updates backend broken-link warnings',
  defaultCronPattern: '0 2 * * *',
  execute: executeFormUrlHealthTask,
};
