/**
 * Scheduler Types
 *
 * Type definitions for the general-purpose task scheduler.
 */

/**
 * Result of a scheduled task execution
 */
export interface TaskResult {
  success: boolean;
  message?: string;
  data?: Record<string, unknown>;
  error?: string;
}

/**
 * A scheduled task handler
 */
export interface ScheduledTask {
  /** Unique identifier for this task type */
  id: string;

  /** Human-readable name for the task */
  name: string;

  /** Description of what the task does */
  description?: string;

  /** Whether this task is enabled */
  enabled: boolean;

  /** Cron pattern for when to check/run this task */
  cronPattern: string;

  /**
   * Execute the task
   *
   * This function is called by the scheduler when the cron pattern matches.
   * It should handle its own error logging and not throw errors that would
   * crash the scheduler.
   *
   * @returns Promise<TaskResult> with success/failure status
   */
  execute: () => Promise<TaskResult>;
}

/**
 * Task registration options
 */
export interface TaskRegistration {
  /** Unique identifier for this task type */
  id: string;

  /** Human-readable name for the task */
  name: string;

  /** Description of what the task does */
  description?: string;

  /** Environment variable to check for enabled state (default: SCHEDULER_{ID}_ENABLED) */
  enabledEnvVar?: string;

  /** Environment variable for cron pattern (default: SCHEDULER_{ID}_CRON) */
  cronEnvVar?: string;

  /** Default cron pattern if not specified in environment */
  defaultCronPattern: string;

  /**
   * Execute the task
   *
   * @returns Promise<TaskResult> with success/failure status
   */
  execute: () => Promise<TaskResult>;
}

/**
 * Scheduler status for admin UI
 */
export interface SchedulerStatus {
  /** Whether the scheduler is enabled globally */
  enabled: boolean;

  /** Whether the scheduler is currently running */
  running: boolean;

  /** List of registered tasks with their status */
  tasks: Array<{
    id: string;
    name: string;
    description?: string;
    enabled: boolean;
    cronPattern: string;
  }>;
}

/**
 * Task execution log entry
 */
export interface TaskExecutionLog {
  taskId: string;
  taskName: string;
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
  result: TaskResult;
}
