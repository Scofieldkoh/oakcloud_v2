/**
 * General-Purpose Task Scheduler
 *
 * A modular, reusable scheduler for running periodic tasks.
 * Tasks are registered with their own cron patterns and can be
 * enabled/disabled independently.
 *
 * Usage:
 * 1. Create a task handler that implements TaskRegistration
 * 2. Register it with scheduler.registerTask()
 * 3. Call scheduler.initialize() on application startup
 *
 * Configuration via environment variables:
 * - SCHEDULER_ENABLED=true (master switch for the scheduler)
 * - SCHEDULER_{TASK_ID}_ENABLED=true (enable individual tasks)
 * - SCHEDULER_{TASK_ID}_CRON=pattern (custom cron pattern)
 *
 * Example:
 * - SCHEDULER_ENABLED=true
 * - SCHEDULER_BACKUP_ENABLED=true
 * - SCHEDULER_BACKUP_CRON="0,15,30,45 * * * *"
 */

import cron, { ScheduledTask as CronTask } from 'node-cron';
import { createLogger } from '@/lib/logger';
import type {
  TaskResult,
  ScheduledTask,
  TaskRegistration,
  SchedulerStatus,
  TaskExecutionLog,
} from './types';

const log = createLogger('scheduler');

class TaskScheduler {
  private isInitialized = false;
  private tasks: Map<string, ScheduledTask> = new Map();
  private cronJobs: Map<string, CronTask> = new Map();
  private executionHistory: TaskExecutionLog[] = [];
  private readonly maxHistorySize = 100;

  /**
   * Register a task with the scheduler
   *
   * Tasks should be registered before calling initialize().
   * Each task gets its own cron job based on its configuration.
   */
  registerTask(registration: TaskRegistration): void {
    if (this.isInitialized) {
      log.warn(`Cannot register task "${registration.id}" after scheduler is initialized`);
      return;
    }

    if (this.tasks.has(registration.id)) {
      log.warn(`Task "${registration.id}" is already registered, skipping`);
      return;
    }

    // Determine environment variable names
    const taskIdUpper = registration.id.toUpperCase().replace(/-/g, '_');
    const enabledEnvVar = registration.enabledEnvVar || `SCHEDULER_${taskIdUpper}_ENABLED`;
    const cronEnvVar = registration.cronEnvVar || `SCHEDULER_${taskIdUpper}_CRON`;

    // Check if task is enabled
    const enabled = process.env[enabledEnvVar] === 'true';
    const cronPattern = process.env[cronEnvVar] || registration.defaultCronPattern;

    const task: ScheduledTask = {
      id: registration.id,
      name: registration.name,
      description: registration.description,
      enabled,
      cronPattern,
      execute: registration.execute,
    };

    this.tasks.set(registration.id, task);
    log.debug(`Registered task "${registration.id}" (enabled: ${enabled}, cron: ${cronPattern})`);
  }

  /**
   * Initialize the scheduler
   *
   * This should be called once on application startup (e.g., in instrumentation.ts).
   * It starts cron jobs for all enabled tasks.
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      log.debug('Scheduler already initialized, skipping');
      return;
    }

    // Check master switch
    const isEnabled = process.env.SCHEDULER_ENABLED === 'true';
    if (!isEnabled) {
      log.info('Scheduler is disabled (SCHEDULER_ENABLED != true)');
      return;
    }

    log.info('Initializing task scheduler...');

    // Start cron jobs for each enabled task
    for (const [taskId, task] of this.tasks) {
      if (!task.enabled) {
        log.debug(`Task "${taskId}" is disabled, skipping`);
        continue;
      }

      if (!cron.validate(task.cronPattern)) {
        log.error(`Invalid cron pattern for task "${taskId}": ${task.cronPattern}`);
        continue;
      }

      const cronJob = cron.schedule(task.cronPattern, async () => {
        await this.executeTask(taskId);
      });

      this.cronJobs.set(taskId, cronJob);
      log.info(`Started task "${task.name}" with pattern: ${task.cronPattern}`);
    }

    this.isInitialized = true;

    const enabledCount = Array.from(this.tasks.values()).filter((t) => t.enabled).length;
    log.info(`Scheduler initialized with ${enabledCount} active task(s)`);
  }

  /**
   * Execute a specific task by ID
   *
   * This is called by the cron job, but can also be called manually
   * for testing or one-off execution.
   */
  async executeTask(taskId: string): Promise<TaskResult> {
    const task = this.tasks.get(taskId);
    if (!task) {
      const error = `Task "${taskId}" not found`;
      log.error(error);
      return { success: false, error };
    }

    const startedAt = new Date();
    log.info(`Executing task "${task.name}"...`);

    try {
      const result = await task.execute();
      const completedAt = new Date();
      const durationMs = completedAt.getTime() - startedAt.getTime();

      // Log execution
      this.addExecutionLog({
        taskId,
        taskName: task.name,
        startedAt,
        completedAt,
        durationMs,
        result,
      });

      if (result.success) {
        log.info(`Task "${task.name}" completed in ${durationMs}ms: ${result.message || 'Success'}`);
      } else {
        log.warn(`Task "${task.name}" failed in ${durationMs}ms: ${result.error || 'Unknown error'}`);
      }

      return result;
    } catch (error) {
      const completedAt = new Date();
      const durationMs = completedAt.getTime() - startedAt.getTime();
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      const result: TaskResult = {
        success: false,
        error: errorMessage,
      };

      this.addExecutionLog({
        taskId,
        taskName: task.name,
        startedAt,
        completedAt,
        durationMs,
        result,
      });

      log.error(`Task "${task.name}" threw an exception after ${durationMs}ms:`, error);
      return result;
    }
  }

  /**
   * Stop the scheduler and all running tasks
   *
   * Call this for graceful shutdown.
   */
  stop(): void {
    for (const [taskId, cronJob] of this.cronJobs) {
      cronJob.stop();
      log.debug(`Stopped cron job for task "${taskId}"`);
    }

    this.cronJobs.clear();
    this.isInitialized = false;
    log.info('Scheduler stopped');
  }

  /**
   * Stop a specific task
   */
  stopTask(taskId: string): boolean {
    const cronJob = this.cronJobs.get(taskId);
    if (cronJob) {
      cronJob.stop();
      this.cronJobs.delete(taskId);
      log.info(`Stopped task "${taskId}"`);
      return true;
    }
    return false;
  }

  /**
   * Start a specific task (if it was stopped)
   */
  startTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) {
      log.warn(`Task "${taskId}" not found`);
      return false;
    }

    if (this.cronJobs.has(taskId)) {
      log.warn(`Task "${taskId}" is already running`);
      return false;
    }

    if (!cron.validate(task.cronPattern)) {
      log.error(`Invalid cron pattern for task "${taskId}": ${task.cronPattern}`);
      return false;
    }

    const cronJob = cron.schedule(task.cronPattern, async () => {
      await this.executeTask(taskId);
    });

    this.cronJobs.set(taskId, cronJob);
    log.info(`Started task "${task.name}" with pattern: ${task.cronPattern}`);
    return true;
  }

  /**
   * Check if the scheduler is running
   */
  isRunning(): boolean {
    return this.isInitialized && this.cronJobs.size > 0;
  }

  /**
   * Check if a specific task is running
   */
  isTaskRunning(taskId: string): boolean {
    return this.cronJobs.has(taskId);
  }

  /**
   * Get scheduler status for admin UI
   */
  getStatus(): SchedulerStatus {
    return {
      enabled: process.env.SCHEDULER_ENABLED === 'true',
      running: this.isRunning(),
      tasks: Array.from(this.tasks.values()).map((task) => ({
        id: task.id,
        name: task.name,
        description: task.description,
        enabled: task.enabled,
        cronPattern: task.cronPattern,
      })),
    };
  }

  /**
   * Get a specific task's configuration
   */
  getTask(taskId: string): ScheduledTask | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * Get all registered tasks
   */
  getTasks(): ScheduledTask[] {
    return Array.from(this.tasks.values());
  }

  /**
   * Get recent execution history
   */
  getExecutionHistory(taskId?: string, limit: number = 20): TaskExecutionLog[] {
    let history = this.executionHistory;

    if (taskId) {
      history = history.filter((log) => log.taskId === taskId);
    }

    return history.slice(-limit);
  }

  /**
   * Add an execution log entry
   */
  private addExecutionLog(entry: TaskExecutionLog): void {
    this.executionHistory.push(entry);

    // Trim history if it exceeds max size
    if (this.executionHistory.length > this.maxHistorySize) {
      this.executionHistory = this.executionHistory.slice(-this.maxHistorySize);
    }
  }
}

// Export singleton instance
export const scheduler = new TaskScheduler();

// Re-export types
export type { TaskResult, ScheduledTask, TaskRegistration, SchedulerStatus, TaskExecutionLog };
