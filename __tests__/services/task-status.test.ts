import { describe, expect, it } from 'vitest';
import { TaskStageStatus, TaskStatus } from '@/generated/prisma';
import { deriveTaskStatus } from '@/services/tasks/status';
import {
  archiveTaskSchema,
  createTaskSchema,
} from '@/lib/validations/task';
import { createTaskPipelineSchema } from '@/lib/validations/task-pipeline';

describe('deriveTaskStatus', () => {
  it('keeps explicit paused and cancelled overrides', () => {
    const stages = [{ status: TaskStageStatus.COMPLETED }];

    expect(deriveTaskStatus(stages, TaskStatus.PAUSED)).toBe(TaskStatus.PAUSED);
    expect(deriveTaskStatus(stages, TaskStatus.CANCELLED)).toBe(TaskStatus.CANCELLED);
  });

  it('derives not started, in progress, and completed from stage status', () => {
    expect(deriveTaskStatus([], TaskStatus.NOT_STARTED)).toBe(TaskStatus.NOT_STARTED);
    expect(deriveTaskStatus([
      { status: TaskStageStatus.NOT_STARTED },
      { status: TaskStageStatus.NOT_STARTED },
    ])).toBe(TaskStatus.NOT_STARTED);
    expect(deriveTaskStatus([
      { status: TaskStageStatus.WAITING },
      { status: TaskStageStatus.NOT_STARTED },
    ])).toBe(TaskStatus.IN_PROGRESS);
    expect(deriveTaskStatus([
      { status: TaskStageStatus.COMPLETED },
      { status: TaskStageStatus.SKIPPED },
    ])).toBe(TaskStatus.COMPLETED);
  });
});

describe('task validation', () => {
  it('accepts the minimum task creation contract', () => {
    expect(createTaskSchema.parse({
      title: 'Prepare annual return',
      pipelineVersionId: '7ff3c11a-4a8e-45c7-a201-56df360db96c',
    })).toMatchObject({
      title: 'Prepare annual return',
      pipelineVersionId: '7ff3c11a-4a8e-45c7-a201-56df360db96c',
    });
  });

  it('requires a non-empty deletion reason', () => {
    expect(() => archiveTaskSchema.parse({ reason: ' ' })).toThrow();
  });

  it('normalizes ordered stages and checklist definitions', () => {
    const parsed = createTaskPipelineSchema.parse({
      name: 'Onboarding',
      stages: [{
        name: 'Company profile',
        actionType: 'COMPANY_PROFILE',
        checklistItems: [{ label: 'Verify registered office' }],
      }],
    });

    expect(parsed.stages[0]).toMatchObject({
      position: 0,
      icon: 'Building2',
      isRequired: true,
      checklistItems: [{ label: 'Verify registered office', position: 0 }],
    });
  });
});
