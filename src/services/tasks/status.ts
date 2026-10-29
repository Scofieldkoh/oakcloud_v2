import {
  TaskStageStatus,
  TaskStatus,
  type TaskStageStatus as TaskStageStatusValue,
  type TaskStatus as TaskStatusValue,
} from '@/generated/prisma';

export interface TaskStatusStage {
  status: TaskStageStatusValue;
}

export function deriveTaskStatus(
  stages: readonly TaskStatusStage[],
  currentStatus?: TaskStatusValue,
): TaskStatusValue {
  if (currentStatus === TaskStatus.PAUSED || currentStatus === TaskStatus.CANCELLED) {
    return currentStatus;
  }

  if (stages.length === 0 || stages.every((stage) => stage.status === TaskStageStatus.NOT_STARTED)) {
    return TaskStatus.NOT_STARTED;
  }

  if (stages.every((stage) => (
    stage.status === TaskStageStatus.COMPLETED
    || stage.status === TaskStageStatus.SKIPPED
  ))) {
    return TaskStatus.COMPLETED;
  }

  return TaskStatus.IN_PROGRESS;
}
