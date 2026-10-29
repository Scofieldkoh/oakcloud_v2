import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const otherWorkspaceId = '22222222-2222-4222-8222-222222222222';
const pipelineId = '33333333-3333-4333-8333-333333333333';
const pipelineVersionId = '44444444-4444-4444-8444-444444444444';
const taskId = '55555555-5555-4555-8555-555555555555';
const stageId = '66666666-6666-4666-8666-666666666666';
const checklistItemId = '77777777-7777-4777-8777-777777777777';

const session = {
  id: 'user-1',
  email: 'user@example.com',
  firstName: 'Test',
  lastName: 'User',
  tenantId: workspaceId,
  isSuperAdmin: false,
  isWorkspaceAdmin: false,
  hasAllCompaniesAccess: false,
  companyIds: [],
};

vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn() }));
vi.mock('@/services/tasks/access', () => ({
  requireTaskAccess: vi.fn(),
  requireTaskCollectionAccess: vi.fn(),
  requireTaskCompanyAccess: vi.fn(),
  requireTaskOutcomeAccess: vi.fn(),
  requireTenantWideTaskAccess: vi.fn(),
}));
vi.mock('@/services/tasks', () => ({
  archiveTask: vi.fn(),
  archiveTaskPipeline: vi.fn(),
  cancelTask: vi.fn(),
  completeTaskStage: vi.fn(),
  createTask: vi.fn(),
  createTaskPipeline: vi.fn(),
  duplicateTaskPipeline: vi.fn(),
  getTask: vi.fn(),
  getTaskResources: vi.fn(),
  getTaskPipeline: vi.fn(),
  getTaskStageDetail: vi.fn(),
  linkTaskStageOutcome: vi.fn(),
  listTaskPipelines: vi.fn(),
  pauseTask: vi.fn(),
  reopenTaskStage: vi.fn(),
  resumeTask: vi.fn(),
  searchTasks: vi.fn(),
  skipTaskStage: vi.fn(),
  reconcileTaskStageOutcome: vi.fn(),
  updateTaskMetadata: vi.fn(),
  updateTaskPipeline: vi.fn(),
  updateTaskStageChecklistItem: vi.fn(),
  updateTaskStageMetadata: vi.fn(),
}));

import { requireAuth } from '@/lib/auth';
import {
  archiveTask,
  archiveTaskPipeline,
  completeTaskStage,
  createTask,
  createTaskPipeline,
  duplicateTaskPipeline,
  getTask,
  getTaskResources,
  getTaskPipeline,
  getTaskStageDetail,
  linkTaskStageOutcome,
  listTaskPipelines,
  pauseTask,
  searchTasks,
  skipTaskStage,
  updateTaskMetadata,
  updateTaskPipeline,
  updateTaskStageChecklistItem,
  updateTaskStageMetadata,
} from '@/services/tasks';
import {
  GET as listPipelines,
  POST as createPipeline,
} from '@/app/api/task-pipelines/route';
import {
  DELETE as archivePipeline,
  GET as getPipeline,
  PATCH as updatePipeline,
} from '@/app/api/task-pipelines/[id]/route';
import * as pipelineDetailRoute from '@/app/api/task-pipelines/[id]/route';
import { POST as duplicatePipeline } from '@/app/api/task-pipelines/[id]/duplicate/route';
import { GET as listTasks, POST as createTaskRoute } from '@/app/api/tasks/route';
import {
  DELETE as archiveTaskRoute,
  GET as getTaskRoute,
  PATCH as updateTaskRoute,
} from '@/app/api/tasks/[taskId]/route';
import { GET as getTaskResourcesRoute } from '@/app/api/tasks/[taskId]/resources/route';
import { POST as updateTaskStatus } from '@/app/api/tasks/[taskId]/status/route';
import * as taskStatusRoute from '@/app/api/tasks/[taskId]/status/route';
import {
  GET as getStage,
  PATCH as updateStage,
} from '@/app/api/tasks/[taskId]/stages/[stageId]/route';
import { POST as transitionStage } from '@/app/api/tasks/[taskId]/stages/[stageId]/transition/route';

function request(
  url: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'GET',
  body?: unknown,
) {
  return new NextRequest(url, {
    method,
    ...(body === undefined
      ? {}
      : {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
  });
}

const pipelineBody = {
  name: 'Client onboarding',
  stages: [
    {
      name: 'Company profile',
      actionType: 'COMPANY_PROFILE',
    },
  ],
};

const routeParams = <T extends Record<string, string>>(params: T) => ({
  params: Promise.resolve(params),
});

describe('task pipeline API routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue(session as never);
    vi.mocked(listTaskPipelines).mockResolvedValue([] as never);
    vi.mocked(createTaskPipeline).mockResolvedValue({ id: pipelineId } as never);
    vi.mocked(getTaskPipeline).mockResolvedValue({ id: pipelineId } as never);
    vi.mocked(updateTaskPipeline).mockResolvedValue({ id: pipelineId } as never);
    vi.mocked(duplicateTaskPipeline).mockResolvedValue({ id: pipelineId } as never);
    vi.mocked(archiveTaskPipeline).mockResolvedValue({ id: pipelineId } as never);
  });

  it('uses the authenticated workspace and existing company RBAC boundary', async () => {
    const response = await listPipelines(
      request(`http://localhost/api/task-pipelines?tenantId=${otherWorkspaceId}&includeArchived=true`),
    );

    expect(response.status).toBe(200);
    expect(listTaskPipelines).toHaveBeenCalledWith(workspaceId, { includeArchived: true });
  });

  it('validates and delegates pipeline create, detail, update, duplicate, and archive', async () => {
    expect((await createPipeline(
      request('http://localhost/api/task-pipelines', 'POST', pipelineBody),
    )).status).toBe(201);
    expect(createTaskPipeline).toHaveBeenCalledWith(
      workspaceId,
      {
        name: 'Client onboarding',
        stages: [
          {
            name: 'Company profile',
            actionType: 'COMPANY_PROFILE',
            checklistItems: [],
            icon: 'Building2',
            isRequired: true,
            position: 0,
          },
        ],
      },
      session.id,
    );

    expect((await getPipeline(
      request(`http://localhost/api/task-pipelines/${pipelineId}`),
      routeParams({ id: pipelineId }),
    )).status).toBe(200);
    expect(getTaskPipeline).toHaveBeenCalledWith(workspaceId, pipelineId);

    expect((await updatePipeline(
      request(`http://localhost/api/task-pipelines/${pipelineId}`, 'PATCH', pipelineBody),
      routeParams({ id: pipelineId }),
    )).status).toBe(200);
    expect(updateTaskPipeline).toHaveBeenCalledWith(
      workspaceId,
      pipelineId,
      expect.objectContaining({
        name: 'Client onboarding',
        stages: [
          expect.objectContaining({
            name: 'Company profile',
            actionType: 'COMPANY_PROFILE',
            position: 0,
          }),
        ],
      }),
      session.id,
    );

    expect((await duplicatePipeline(
      request(`http://localhost/api/task-pipelines/${pipelineId}/duplicate`, 'POST', {
        name: 'Client onboarding copy',
      }),
      routeParams({ id: pipelineId }),
    )).status).toBe(201);
    expect(duplicateTaskPipeline).toHaveBeenCalledWith(
      workspaceId,
      pipelineId,
      { name: 'Client onboarding copy' },
      session.id,
    );

    const archiveResponse = await archivePipeline(
      request(`http://localhost/api/task-pipelines/${pipelineId}`, 'DELETE', {
        reason: 'Superseded',
      }),
      routeParams({ id: pipelineId }),
    );
    expect(archiveResponse.status).toBe(200);
    expect(await archiveResponse.json()).toEqual({ id: pipelineId, archived: true });
    expect(archiveTaskPipeline).toHaveBeenCalledWith(
      workspaceId,
      pipelineId,
      'Superseded',
      session.id,
    );
  });

  it('rejects invalid pipeline bodies before calling services', async () => {
    const response = await createPipeline(
      request('http://localhost/api/task-pipelines', 'POST', {
        name: '',
        stages: [],
      }),
    );

    expect(response.status).toBe(400);
    expect(createTaskPipeline).not.toHaveBeenCalled();
  });

  it('strictly validates includeArchived', async () => {
    const response = await listPipelines(
      request('http://localhost/api/task-pipelines?includeArchived=yes'),
    );

    expect(response.status).toBe(400);
    expect(listTaskPipelines).not.toHaveBeenCalled();
  });

  it('does not expose unapproved pipeline PUT compatibility', () => {
    expect(pipelineDetailRoute).not.toHaveProperty('PUT');
  });
});

describe('task API routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue(session as never);
    vi.mocked(searchTasks).mockResolvedValue({
      tasks: [],
      total: 0,
      page: 2,
      limit: 25,
      totalPages: 0,
    } as never);
    vi.mocked(createTask).mockResolvedValue({ id: taskId } as never);
    vi.mocked(getTask).mockResolvedValue({ id: taskId } as never);
    vi.mocked(getTaskResources).mockResolvedValue({
      task: { id: taskId },
      stages: [],
      hasPendingResources: false,
    } as never);
    vi.mocked(updateTaskMetadata).mockResolvedValue({ id: taskId } as never);
    vi.mocked(archiveTask).mockResolvedValue({ id: taskId } as never);
    vi.mocked(pauseTask).mockResolvedValue({ id: taskId, status: 'PAUSED' } as never);
  });

  it('parses every supported task list filter, pagination, and sort option', async () => {
    const response = await listTasks(request(
      `http://localhost/api/tasks?q=annual&pipeline=${pipelineId}`
      + `&company=${pipelineId}&owner=${pipelineVersionId}&status=IN_PROGRESS`
      + '&dueBucket=overdue&page=2&limit=25&sortBy=dueDate&sortOrder=desc'
      + `&tenantId=${otherWorkspaceId}`,
    ));

    expect(response.status).toBe(200);
    expect(searchTasks).toHaveBeenCalledWith(workspaceId, {
      query: 'annual',
      pipelineId,
      companyId: pipelineId,
      ownerId: pipelineVersionId,
      status: 'IN_PROGRESS',
      dueBucket: 'overdue',
      page: 2,
      limit: 25,
      sortBy: 'dueDate',
      sortOrder: 'desc',
    });
  });

  it('rejects invalid task list enums and unsafe pagination', async () => {
    const response = await listTasks(request(
      'http://localhost/api/tasks?status=BLOCKED&dueBucket=missing&page=0&limit=1000',
    ));

    expect(response.status).toBe(400);
    expect(searchTasks).not.toHaveBeenCalled();
  });

  it('validates and delegates task create, detail, update, and archive', async () => {
    const createBody = {
      title: 'Annual filing',
      pipelineVersionId,
      tenantId: otherWorkspaceId,
    };
    expect((await createTaskRoute(
      request('http://localhost/api/tasks', 'POST', createBody),
    )).status).toBe(201);
    expect(createTask).toHaveBeenCalledWith(
      workspaceId,
      {
        title: 'Annual filing',
        pipelineVersionId,
      },
      session.id,
    );

    expect((await getTaskRoute(
      request(`http://localhost/api/tasks/${taskId}`),
      routeParams({ taskId }),
    )).status).toBe(200);
    expect(getTask).toHaveBeenCalledWith(workspaceId, taskId, session.id);

    expect((await updateTaskRoute(
      request(`http://localhost/api/tasks/${taskId}`, 'PATCH', { ownerId: null }),
      routeParams({ taskId }),
    )).status).toBe(200);
    expect(updateTaskMetadata).toHaveBeenCalledWith(
      workspaceId,
      taskId,
      { ownerId: null },
      session.id,
    );

    const archiveResponse = await archiveTaskRoute(
      request(`http://localhost/api/tasks/${taskId}`, 'DELETE', { reason: 'Duplicate' }),
      routeParams({ taskId }),
    );
    expect(archiveResponse.status).toBe(200);
    expect(await archiveResponse.json()).toEqual({ id: taskId, archived: true });
    expect(archiveTask).toHaveBeenCalledWith(
      workspaceId,
      taskId,
      'Duplicate',
      session.id,
    );
  });

  it('dispatches only approved task status actions', async () => {
    expect((await updateTaskStatus(
      request(`http://localhost/api/tasks/${taskId}/status`, 'POST', { action: 'pause' }),
      routeParams({ taskId }),
    )).status).toBe(200);
    expect(pauseTask).toHaveBeenCalledWith(workspaceId, taskId, session.id);

    const response = await updateTaskStatus(
      request(`http://localhost/api/tasks/${taskId}/status`, 'POST', { action: 'complete' }),
      routeParams({ taskId }),
    );
    expect(response.status).toBe(400);
  });

  it('loads task resources through the authenticated workspace and task access boundary', async () => {
    const response = await getTaskResourcesRoute(
      request(`http://localhost/api/tasks/${taskId}/resources`),
      routeParams({ taskId }),
    );

    expect(response.status).toBe(200);
    expect(getTaskResources).toHaveBeenCalledWith(session, workspaceId, taskId);
  });

  it('requires authenticated workspace context before task access', async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ...session, tenantId: null } as never);

    const response = await getTaskRoute(
      request(`http://localhost/api/tasks/${taskId}`),
      routeParams({ taskId }),
    );
    expect(response.status).toBe(400);
    expect(getTask).not.toHaveBeenCalled();
  });

  it('does not expose unapproved task status PATCH compatibility', () => {
    expect(taskStatusRoute).not.toHaveProperty('PATCH');
  });
});

describe('task stage API routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue(session as never);
    vi.mocked(getTaskStageDetail).mockResolvedValue({
      id: stageId,
      taskId,
      checklistItems: [{ id: checklistItemId }],
    } as never);
    vi.mocked(updateTaskStageMetadata).mockResolvedValue({ id: stageId } as never);
    vi.mocked(completeTaskStage).mockResolvedValue({ id: stageId } as never);
    vi.mocked(skipTaskStage).mockResolvedValue({ id: stageId } as never);
    vi.mocked(updateTaskStageChecklistItem).mockResolvedValue({ id: checklistItemId } as never);
    vi.mocked(linkTaskStageOutcome).mockResolvedValue({ status: 'COMPLETED' } as never);
  });

  it('loads and updates a stage through its tenant-scoped task parent', async () => {
    expect((await getStage(
      request(`http://localhost/api/tasks/${taskId}/stages/${stageId}`),
      routeParams({ taskId, stageId }),
    )).status).toBe(200);
    expect(getTaskStageDetail).toHaveBeenCalledWith(workspaceId, taskId, stageId);

    vi.mocked(getTaskStageDetail)
      .mockResolvedValueOnce({
        id: stageId,
        taskId,
        notes: null,
        checklistItems: [{ id: checklistItemId }],
      } as never)
      .mockResolvedValueOnce({
        id: stageId,
        taskId,
        notes: 'Waiting for director details',
        blockers: [],
        launch: { href: null, context: { taskId, taskStageId: stageId } },
        outcomeSummary: null,
        checklistItems: [{ id: checklistItemId }],
      } as never);

    const updateResponse = await updateStage(
      request(`http://localhost/api/tasks/${taskId}/stages/${stageId}`, 'PATCH', {
        notes: 'Waiting for director details',
      }),
      routeParams({ taskId, stageId }),
    );
    expect(updateResponse.status).toBe(200);
    expect(await updateResponse.json()).toEqual(expect.objectContaining({
      id: stageId,
      notes: 'Waiting for director details',
      blockers: [],
      outcomeSummary: null,
    }));
    expect(updateTaskStageMetadata).toHaveBeenCalledWith(
      workspaceId,
      stageId,
      { notes: 'Waiting for director details' },
      session.id,
    );
    expect(getTaskStageDetail).toHaveBeenCalledTimes(3);
  });

  it('dispatches complete, skip, checklist, and outcome transitions', async () => {
    const params = routeParams({ taskId, stageId });
    const url = `http://localhost/api/tasks/${taskId}/stages/${stageId}/transition`;

    expect((await transitionStage(
      request(url, 'POST', { action: 'complete' }),
      params,
    )).status).toBe(200);
    expect(completeTaskStage).toHaveBeenCalledWith(
      workspaceId,
      stageId,
      session.id,
    );

    expect((await transitionStage(
      request(url, 'POST', { action: 'skip', reason: 'Not applicable' }),
      params,
    )).status).toBe(200);
    expect(skipTaskStage).toHaveBeenCalledWith(
      workspaceId,
      stageId,
      'Not applicable',
      session.id,
    );

    expect((await transitionStage(
      request(url, 'POST', {
        action: 'checklist',
        checklistItemId,
        isCompleted: true,
      }),
      params,
    )).status).toBe(200);
    expect(updateTaskStageChecklistItem).toHaveBeenCalledWith(
      workspaceId,
      checklistItemId,
      { isCompleted: true },
      session.id,
    );

    const outcome = {
      type: 'COMPANY',
      companyId: pipelineId,
    };
    expect((await transitionStage(
      request(url, 'POST', { action: 'linkOutcome', outcome }),
      params,
    )).status).toBe(200);
    expect(linkTaskStageOutcome).toHaveBeenCalledWith(
      workspaceId,
      stageId,
      outcome,
      session.id,
    );
  });

  it('rejects malformed transitions before calling stage services', async () => {
    const response = await transitionStage(
      request(
        `http://localhost/api/tasks/${taskId}/stages/${stageId}/transition`,
        'POST',
        { action: 'skip', reason: '' },
      ),
      routeParams({ taskId, stageId }),
    );

    expect(response.status).toBe(400);
    expect(skipTaskStage).not.toHaveBeenCalled();
  });

  it('rejects checklist updates outside the stage named in the route', async () => {
    const response = await transitionStage(
      request(
        `http://localhost/api/tasks/${taskId}/stages/${stageId}/transition`,
        'POST',
        {
          action: 'checklist',
          checklistItemId: '88888888-8888-4888-8888-888888888888',
          isCompleted: true,
        },
      ),
      routeParams({ taskId, stageId }),
    );

    expect(response.status).toBe(404);
    expect(updateTaskStageChecklistItem).not.toHaveBeenCalled();
  });
});

describe('task route UUID validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue(session as never);
  });

  it('rejects invalid pipeline route IDs before services', async () => {
    const invalid = 'not-a-uuid';
    const responses = await Promise.all([
      getPipeline(
        request(`http://localhost/api/task-pipelines/${invalid}`),
        routeParams({ id: invalid }),
      ),
      updatePipeline(
        request(`http://localhost/api/task-pipelines/${invalid}`, 'PATCH', pipelineBody),
        routeParams({ id: invalid }),
      ),
      archivePipeline(
        request(`http://localhost/api/task-pipelines/${invalid}`, 'DELETE', {
          reason: 'Invalid',
        }),
        routeParams({ id: invalid }),
      ),
      duplicatePipeline(
        request(`http://localhost/api/task-pipelines/${invalid}/duplicate`, 'POST', {}),
        routeParams({ id: invalid }),
      ),
    ]);

    expect(responses.map((response) => response.status)).toEqual([400, 400, 400, 400]);
    expect(getTaskPipeline).not.toHaveBeenCalled();
    expect(updateTaskPipeline).not.toHaveBeenCalled();
    expect(archiveTaskPipeline).not.toHaveBeenCalled();
    expect(duplicateTaskPipeline).not.toHaveBeenCalled();
  });

  it('rejects invalid task route IDs before services', async () => {
    const invalid = 'not-a-uuid';
    const responses = await Promise.all([
      getTaskRoute(
        request(`http://localhost/api/tasks/${invalid}`),
        routeParams({ taskId: invalid }),
      ),
      updateTaskRoute(
        request(`http://localhost/api/tasks/${invalid}`, 'PATCH', { title: 'No' }),
        routeParams({ taskId: invalid }),
      ),
      archiveTaskRoute(
        request(`http://localhost/api/tasks/${invalid}`, 'DELETE', { reason: 'Invalid' }),
        routeParams({ taskId: invalid }),
      ),
      updateTaskStatus(
        request(`http://localhost/api/tasks/${invalid}/status`, 'POST', { action: 'pause' }),
        routeParams({ taskId: invalid }),
      ),
    ]);

    expect(responses.map((response) => response.status)).toEqual([400, 400, 400, 400]);
    expect(getTask).not.toHaveBeenCalled();
    expect(updateTaskMetadata).not.toHaveBeenCalled();
    expect(archiveTask).not.toHaveBeenCalled();
    expect(pauseTask).not.toHaveBeenCalled();
  });

  it('rejects invalid nested task, stage, and checklist IDs before services', async () => {
    const invalid = 'not-a-uuid';
    const url = `http://localhost/api/tasks/${taskId}/stages/${stageId}`;
    const responses = await Promise.all([
      getStage(
        request(url),
        routeParams({ taskId: invalid, stageId }),
      ),
      updateStage(
        request(url, 'PATCH', { notes: 'No' }),
        routeParams({ taskId, stageId: invalid }),
      ),
      transitionStage(
        request(`${url}/transition`, 'POST', {
          action: 'checklist',
          checklistItemId: invalid,
          isCompleted: true,
        }),
        routeParams({ taskId, stageId }),
      ),
    ]);

    expect(responses.map((response) => response.status)).toEqual([400, 400, 400]);
    expect(getTaskStageDetail).not.toHaveBeenCalled();
    expect(updateTaskStageMetadata).not.toHaveBeenCalled();
    expect(updateTaskStageChecklistItem).not.toHaveBeenCalled();
  });
});
