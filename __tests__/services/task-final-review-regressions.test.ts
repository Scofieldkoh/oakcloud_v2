import { describe, expect, it } from 'vitest';
import { TaskStageActionType, TaskStageStatus } from '@/generated/prisma';
import {
  getStageActionAdapter,
} from '@/services/tasks/action-registry';
import {
  parseTaskLaunchContext,
  withTaskLaunchContext,
} from '@/lib/task-launch-context';
import { toPublicTaskDto } from '@/services/tasks/task.service';
import {
  createTaskSchema,
  updateTaskMetadataSchema,
} from '@/lib/validations/task';
import { taskPipelineStageSchema } from '@/lib/validations/task-pipeline';

const taskId = '11111111-1111-4111-8111-111111111111';
const taskStageId = '22222222-2222-4222-8222-222222222222';

describe('final task review regressions', () => {
  it('removes every sensitive owner field from public task responses', () => {
    const dto = toPublicTaskDto({
      id: taskId,
      title: 'Annual filing',
      description: null,
      status: 'NOT_STARTED',
      dueDate: new Date('2026-08-01T00:00:00.000Z'),
      createdAt: new Date('2026-07-27T00:00:00.000Z'),
      updatedAt: new Date('2026-07-27T00:00:00.000Z'),
      company: null,
      owner: {
        id: '33333333-3333-4333-8333-333333333333',
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@example.com',
        passwordHash: 'secret-hash',
        passwordResetToken: 'secret-token',
        passwordResetExpires: new Date('2026-07-28T00:00:00.000Z'),
        mustChangePassword: true,
      },
      pipelineVersion: {
        id: '44444444-4444-4444-8444-444444444444',
        version: 1,
        pipeline: {
          id: '55555555-5555-4555-8555-555555555555',
          name: 'Onboarding',
        },
      },
      stages: [],
    } as never);

    expect(dto.owner).toEqual({
      id: '33333333-3333-4333-8333-333333333333',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
    });
    expect(JSON.stringify(dto)).not.toMatch(
      /passwordHash|passwordResetToken|passwordResetExpires|mustChangePassword/,
    );
  });

  it('accepts date-only task input and stores the same UTC calendar date', () => {
    const created = createTaskSchema.parse({
      title: 'Annual filing',
      pipelineVersionId: '44444444-4444-4444-8444-444444444444',
      dueDate: '2026-08-01',
    });
    const updated = updateTaskMetadataSchema.parse({ dueDate: '2026-08-02' });

    expect(created.dueDate?.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(updated.dueDate?.toISOString()).toBe('2026-08-02T00:00:00.000Z');
  });

  it('allows only safe app-relative return paths and preserves launch parameters', () => {
    expect(parseTaskLaunchContext({
      taskId,
      taskStageId,
      returnTo: '/tasks?page=2',
    })).toEqual({ taskId, taskStageId, returnTo: '/tasks?page=2' });
    expect(() => parseTaskLaunchContext({
      taskId,
      taskStageId,
      returnTo: '//evil.example/tasks',
    })).toThrow();
    expect(() => parseTaskLaunchContext({
      taskId,
      taskStageId,
      returnTo: 'https://evil.example/tasks',
    })).toThrow();
    expect(withTaskLaunchContext('/companies/new?source=task', {
      taskId,
      taskStageId,
      returnTo: '/tasks',
    })).toBe(
      `/companies/new?source=task&taskId=${taskId}&taskStageId=${taskStageId}&returnTo=%2Ftasks`,
    );
  });

  it('uses strict adapter configs, curated icons, and launch defaults', () => {
    expect(() => getStageActionAdapter(TaskStageActionType.DOCUMENT_GENERATION)
      .parseConfig({ templateId: taskId, color: 'red' })).toThrow();
    expect(() => taskPipelineStageSchema.parse({
      name: 'Unsafe',
      actionType: 'MANUAL',
      icon: 'ArbitraryIcon',
    })).toThrow();

    const document = getStageActionAdapter(TaskStageActionType.DOCUMENT_GENERATION);
    const launch = document.launch({
      tenantId: 'tenant-a',
      stage: {
        id: taskStageId,
        tenantId: 'tenant-a',
        taskId,
        actionType: TaskStageActionType.DOCUMENT_GENERATION,
        actionConfig: { templateId: taskId },
        status: TaskStageStatus.NOT_STARTED,
      },
    });
    expect(launch.href).toBe(
      `/generated-documents/generate?templateId=${taskId}`,
    );

    const company = getStageActionAdapter(TaskStageActionType.COMPANY_PROFILE);
    expect(company.blockers({
      tenantId: 'tenant-a',
      stage: {
        id: taskStageId,
        tenantId: 'tenant-a',
        taskId,
        actionType: TaskStageActionType.COMPANY_PROFILE,
        actionConfig: null,
        status: TaskStageStatus.NOT_STARTED,
        task: { companyId: null },
      },
    })).toEqual([]);
  });
});
