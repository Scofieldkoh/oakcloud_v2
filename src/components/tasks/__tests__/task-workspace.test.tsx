import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskWorkspace } from '@/components/tasks/task-workspace';
import type { TaskPipeline } from '@/hooks/use-task-pipelines';
import type { TaskListItem, TaskResourcesResponse, TaskStageDetail } from '@/services/tasks/types';

const hookMocks = vi.hoisted(() => ({
  archive: vi.fn(),
  create: vi.fn(),
  stageTransition: vi.fn(),
  stageUpdate: vi.fn(),
  status: vi.fn(),
  update: vi.fn(),
  useArchiveTask: vi.fn(),
  useCompanies: vi.fn(),
  useCreateTask: vi.fn(),
  useCurrentWorkspaceUsers: vi.fn(),
  useTaskPipelines: vi.fn(),
  useTaskStage: vi.fn(),
  useTaskResources: vi.fn(),
  useTaskStageTransition: vi.fn(),
  useTaskStatusMutation: vi.fn(),
  useTasks: vi.fn(),
  useUpdateTask: vi.fn(),
  useUpdateTaskStage: vi.fn(),
}));
const navigationMocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  searchParams: new URLSearchParams(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: navigationMocks.push,
    replace: navigationMocks.replace,
  }),
  useSearchParams: () => navigationMocks.searchParams,
}));
vi.mock('@/hooks/use-tasks', () => ({
  useArchiveTask: hookMocks.useArchiveTask,
  useCreateTask: hookMocks.useCreateTask,
  useTaskStage: hookMocks.useTaskStage,
  useTaskResources: hookMocks.useTaskResources,
  useTaskStageTransition: hookMocks.useTaskStageTransition,
  useTaskStatusMutation: hookMocks.useTaskStatusMutation,
  useTasks: hookMocks.useTasks,
  useUpdateTask: hookMocks.useUpdateTask,
  useUpdateTaskStage: hookMocks.useUpdateTaskStage,
}));
vi.mock('@/hooks/use-task-resources', () => ({
  useTaskResources: hookMocks.useTaskResources,
}));
vi.mock('@/hooks/use-task-pipelines', () => ({
  useTaskPipelines: hookMocks.useTaskPipelines,
}));
vi.mock('@/hooks/use-companies', () => ({
  useCompanies: hookMocks.useCompanies,
}));
vi.mock('@/hooks/use-admin', () => ({
  useCurrentWorkspaceUsers: hookMocks.useCurrentWorkspaceUsers,
}));
vi.mock('@/hooks/use-auth', () => ({
  useSession: () => ({ data: { id: 'user-1', tenantId: 'tenant-1', isSuperAdmin: false } }),
}));
vi.mock('@/components/ui/workspace-selector', () => ({
  useActiveWorkspaceId: () => 'tenant-1',
}));
vi.mock('@/components/ui/company-select', () => ({
  CompanySelect: ({ placeholder }: { placeholder?: string }) => (
    <input
      aria-label="All companies"
      aria-controls="company-select-options"
      aria-expanded="false"
      placeholder={placeholder}
      readOnly
      role="combobox"
    />
  ),
}));
vi.mock('@/hooks/use-user-preferences', () => ({
  useUserPreferences: () => ({
    data: {
      'tasks:list:columns:v1': {
        key: 'tasks:list:columns:v1',
        value: {},
        updatedAt: null,
      },
    },
  }),
  useUpsertUserPreference: () => ({ mutate: vi.fn() }),
}));

const task: TaskListItem = {
  id: 'task-1',
  title: 'Annual compliance review',
  description: null,
  status: 'IN_PROGRESS',
  dueDate: null,
  createdAt: '2026-07-20T00:00:00.000Z',
  updatedAt: '2026-07-26T00:00:00.000Z',
  company: { id: 'company-1', name: 'Acme Pte Ltd' },
  owner: { id: 'owner-1', firstName: 'Sam', lastName: 'Chen', email: 'sam@example.com' },
  pipelineVersion: { id: 'version-1', version: 1, pipeline: { id: 'pipeline-1', name: 'Annual review' } },
  stages: [{
    id: 'stage-1',
    name: 'Review',
    position: 0,
    actionType: 'MANUAL',
    icon: 'CircleCheckBig',
    isRequired: true,
    status: 'IN_PROGRESS',
  }],
};
const pipeline: TaskPipeline = {
  id: 'pipeline-1',
  name: 'Annual review',
  description: null,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  deletedAt: null,
  versions: [{ id: 'version-1', version: 1, publishedAt: '2026-07-01T00:00:00.000Z', stages: [] }],
};
const stage: TaskStageDetail = {
  ...task.stages[0],
  taskId: task.id,
  description: 'Review records.',
  notes: null,
  skipReason: null,
  startedAt: null,
  completedAt: null,
  assigneeId: null,
  assignee: null,
  checklistItems: [],
  outcome: null,
  blockers: [],
  launch: { href: null, context: { taskId: task.id, taskStageId: 'stage-1' } },
  outcomeSummary: null,
};
const resources: TaskResourcesResponse = {
  task: {
    id: task.id,
    title: task.title,
    status: task.status,
    dueDate: null,
    company: {
      id: task.company!.id,
      name: task.company!.name,
      uen: '202600001A',
      href: `/companies/${task.company!.id}`,
    },
    owner: { id: task.owner!.id, name: 'Sam Chen', email: task.owner!.email },
    pipelineName: task.pipelineVersion.pipeline.name,
  },
  stages: [{
    id: stage.id,
    name: stage.name,
    position: stage.position,
    actionType: stage.actionType,
    status: stage.status,
    description: stage.description,
    notes: stage.notes,
    startedAt: stage.startedAt,
    completedAt: stage.completedAt,
    assignee: null,
    checklist: [],
    blockers: [],
    resources: [],
  }],
  hasPendingResources: false,
};

function useMutationMock(mutation: (variables: unknown) => Promise<unknown>) {
  const [error, setError] = useState<Error | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [variables, setVariables] = useState<unknown>();

  const mutateAsync = async (nextVariables: unknown) => {
    setError(null);
    setIsPending(true);
    setVariables(nextVariables);
    try {
      return await mutation(nextVariables);
    } catch (caughtError) {
      const nextError = caughtError instanceof Error ? caughtError : new Error('Mutation failed');
      setError(nextError);
      throw nextError;
    } finally {
      setIsPending(false);
    }
  };

  return {
    error,
    isPending,
    mutate: (nextVariables: unknown) => { void mutateAsync(nextVariables).catch(() => undefined); },
    mutateAsync,
    reset: () => setError(null),
    variables,
  };
}

function clickTaskAction(label: 'Pause' | 'Cancel' | 'Delete') {
  fireEvent.click(screen.getAllByRole('button', { name: `Actions for ${task.title}` })[0]);
  fireEvent.click(screen.getByRole('menuitem', { name: label }));
}

beforeEach(() => {
  vi.clearAllMocks();
  navigationMocks.searchParams = new URLSearchParams();
  hookMocks.useTasks.mockReturnValue({
    data: { tasks: [task], total: 1, page: 1, limit: 20, totalPages: 1 },
    error: null,
    isLoading: false,
  });
  hookMocks.useTaskPipelines.mockReturnValue({ data: [pipeline], error: null, isLoading: false });
  hookMocks.useCompanies.mockReturnValue({ data: { companies: [task.company] }, error: null, isLoading: false });
  hookMocks.useCurrentWorkspaceUsers.mockReturnValue({ data: { users: [task.owner] }, error: null, isLoading: false });
  hookMocks.useTaskStage.mockReturnValue({ data: stage, error: null, isLoading: false });
  hookMocks.useTaskResources.mockReturnValue({
    data: resources,
    error: null,
    isLoading: false,
    refetch: vi.fn(),
  });
  hookMocks.archive.mockResolvedValue(task);
  hookMocks.create.mockResolvedValue(task);
  hookMocks.stageTransition.mockResolvedValue(task);
  hookMocks.stageUpdate.mockResolvedValue(task);
  hookMocks.status.mockResolvedValue(task);
  hookMocks.update.mockResolvedValue(task);
  hookMocks.useArchiveTask.mockImplementation(() => useMutationMock(hookMocks.archive));
  hookMocks.useCreateTask.mockImplementation(() => useMutationMock(hookMocks.create));
  hookMocks.useTaskStageTransition.mockImplementation(() => useMutationMock(hookMocks.stageTransition));
  hookMocks.useUpdateTaskStage.mockImplementation(() => useMutationMock(hookMocks.stageUpdate));
  hookMocks.useTaskStatusMutation.mockImplementation(() => useMutationMock(hookMocks.status));
  hookMocks.useUpdateTask.mockImplementation(() => useMutationMock(hookMocks.update));
});

describe('TaskWorkspace', () => {
  it('keeps the table and inline filters available when no tasks match', () => {
    hookMocks.useTasks.mockReturnValue({
      data: { tasks: [], total: 0, page: 1, limit: 20, totalPages: 1 },
      error: null,
      isLoading: false,
    });

    render(<TaskWorkspace />);

    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'All companies' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Filter tasks by pipeline' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Company/ })).toBeInTheDocument();
    const emptyTable = screen.getByRole('table');
    expect(within(emptyTable).getByText('No tasks yet').closest('td')).toHaveAttribute('colspan', '8');
    expect(within(emptyTable).getByRole('button', { name: 'Create task' })).toBeInTheDocument();
  });

  it('shows removable badges for active filters and clears them together', async () => {
    render(<TaskWorkspace />);

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search tasks' }), {
      target: { value: 'annual' },
    });
    const pipelineFilter = screen.getByRole('combobox', { name: 'Filter tasks by pipeline' });
    fireEvent.focus(pipelineFilter);
    fireEvent.change(pipelineFilter, { target: { value: 'Annual' } });
    fireEvent.keyDown(pipelineFilter, { key: 'ArrowDown' });
    fireEvent.keyDown(pipelineFilter, { key: 'Enter' });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter tasks by title' }), {
      target: { value: 'compliance' },
    });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter tasks by owner' }), {
      target: { value: 'sam' },
    });

    expect(screen.getByText('Active filters:')).toBeInTheDocument();
    expect(await screen.findByText('Search:')).toBeInTheDocument();
    expect(screen.getByText('annual')).toBeInTheDocument();
    expect(screen.getByText('Pipeline:')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Pipeline filter' }).parentElement)
      .toHaveTextContent('Pipeline:Annual review');
    expect(screen.getByRole('button', { name: 'Remove Task filter' }).parentElement)
      .toHaveTextContent('Task:compliance');
    expect(screen.getByRole('button', { name: 'Remove Owner text filter' }).parentElement)
      .toHaveTextContent('Owner text:sam');

    fireEvent.click(screen.getByRole('button', { name: 'Remove Search filter' }));
    expect(screen.queryByText('Search:')).not.toBeInTheDocument();
    expect(screen.getByText('Pipeline:')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    await waitFor(() => expect(hookMocks.useTasks).toHaveBeenLastCalledWith({
      page: 1,
      limit: 20,
    }));
    expect(screen.queryByText('Active filters:')).not.toBeInTheDocument();
  });

  it('renders primary navigation and applies quick filters to the list hook', async () => {
    render(<TaskWorkspace />);
    expect(screen.getByRole('heading', { name: 'Tasks' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Manage pipelines' })).toHaveAttribute('href', '/pipelines');
    fireEvent.click(screen.getByRole('button', { name: 'Due this week' }));
    await waitFor(() => expect(hookMocks.useTasks).toHaveBeenLastCalledWith(expect.objectContaining({
      dueBucket: 'thisWeek',
      dueDateFrom: undefined,
      dueDateTo: undefined,
    })));
    fireEvent.click(screen.getByRole('button', { name: 'Owned by me' }));
    await waitFor(() => expect(hookMocks.useTasks).toHaveBeenLastCalledWith(expect.objectContaining({
      ownerId: 'user-1',
    })));
  });

  it('saves inline task metadata through the existing update mutation', async () => {
    render(<TaskWorkspace />);
    const taskCell = within(screen.getAllByRole('row')[2]).getAllByRole('cell')[1];

    fireEvent.doubleClick(taskCell);
    const input = screen.getByRole('textbox', { name: 'Edit task title' });
    fireEvent.change(input, { target: { value: 'Updated from table' } });
    fireEvent.blur(input);

    await waitFor(() => expect(hookMocks.update).toHaveBeenCalledWith({
      id: task.id,
      payload: { title: 'Updated from table' },
    }));
  });

  it('explains pipeline, company, and owner option query failures', () => {
    hookMocks.useTaskPipelines.mockReturnValue({
      data: undefined,
      error: new Error('Pipeline options failed'),
      isLoading: false,
    });
    hookMocks.useCompanies.mockReturnValue({
      data: undefined,
      error: new Error('Company options failed'),
      isLoading: false,
    });
    hookMocks.useCurrentWorkspaceUsers.mockReturnValue({
      data: undefined,
      error: new Error('Owner options failed'),
      isLoading: false,
    });

    render(<TaskWorkspace />);

    const alert = screen.getByRole('alert', { name: 'Task options unavailable' });
    expect(alert).toHaveTextContent('Pipelines: Pipeline options failed');
    expect(alert).toHaveTextContent('Companies: Company options failed');
    expect(alert).toHaveTextContent('Owners: Owner options failed');
  });

  it('creates a task with title and pipeline only', async () => {
    render(<TaskWorkspace />);
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Title' }), { target: { value: 'Prepare annual return' } });
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Pipeline' }), { target: { value: 'version-1' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(hookMocks.create).toHaveBeenCalledWith({
      title: 'Prepare annual return',
      pipelineVersionId: 'version-1',
    }));
  });

  it('runs pause and confirmed cancel status controls', async () => {
    render(<TaskWorkspace />);
    clickTaskAction('Pause');
    await waitFor(() => expect(hookMocks.status).toHaveBeenCalledWith({ id: task.id, action: 'pause' }));
    clickTaskAction('Cancel');
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel task' }));
    await waitFor(() => expect(hookMocks.status).toHaveBeenCalledWith({ id: task.id, action: 'cancel' }));
  });

  it('requires a reason before soft-deleting a task', async () => {
    render(<TaskWorkspace />);
    clickTaskAction('Delete');
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete task' }));
    expect(within(dialog).getByText('Reason is required')).toBeInTheDocument();
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Reason' }), { target: { value: 'Created in error' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete task' }));
    await waitFor(() => expect(hookMocks.archive).toHaveBeenCalledWith({ id: task.id, reason: 'Created in error' }));
  });

  it('opens any selected stage through the reviewed detail hook', async () => {
    render(<TaskWorkspace />);
    fireEvent.click(screen.getAllByRole('button', { name: /Review stage/i })[0]);
    await waitFor(() => expect(hookMocks.useTaskStage).toHaveBeenLastCalledWith(task.id, 'stage-1'));
    expect(hookMocks.useTaskResources).toHaveBeenLastCalledWith(task.id, true);
    expect(screen.getByRole('dialog')).toHaveTextContent('Review records.');
    expect(screen.getByTestId('task-resources-panel')).toHaveTextContent('202600001A');
  });

  it('keeps the stage form visible when task resources fail to load', async () => {
    hookMocks.useTaskResources.mockReturnValue({
      data: undefined,
      error: new Error('Resources unavailable'),
      isLoading: false,
      refetch: vi.fn(),
    });

    render(<TaskWorkspace />);
    fireEvent.click(screen.getAllByRole('button', { name: /Review stage/i })[0]);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Resources unavailable');
    expect(within(dialog).getByRole('button', { name: 'Complete stage' })).toBeVisible();
  });

  it('reopens a returned task stage and provides direct navigation to the next stage', async () => {
    const nextStage = {
      id: 'stage-2',
      name: 'Prepare documents',
      position: 1,
      actionType: 'DOCUMENT_GENERATION' as const,
      icon: 'FileText',
      isRequired: true,
      status: 'NOT_STARTED' as const,
    };
    const returnedTask = { ...task, stages: [task.stages[0], nextStage] };
    navigationMocks.searchParams = new URLSearchParams(
      'taskId=task-1&taskStageId=stage-1&returnTo=%2Ftasks',
    );
    hookMocks.useTasks.mockReturnValue({
      data: { tasks: [returnedTask], total: 1, page: 1, limit: 20, totalPages: 1 },
      error: null,
      isLoading: false,
    });
    hookMocks.useTaskStage.mockImplementation((_taskId: string, stageId: string) => ({
      data: stageId === nextStage.id
        ? {
            ...stage,
            ...nextStage,
            description: 'Prepare the engagement documents.',
            launch: {
              href: '/generated-documents/generate',
              context: { taskId: task.id, taskStageId: nextStage.id },
            },
          }
        : stage,
      error: null,
      isLoading: false,
    }));

    render(<TaskWorkspace />);

    expect(await screen.findByRole('heading', { name: 'Review' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Next stage' }));
    expect(await screen.findByRole('heading', { name: 'Prepare documents' })).toBeVisible();
    expect(navigationMocks.replace).toHaveBeenCalledWith('/tasks', { scroll: false });
  });

  it('opens the next actionable stage when returning from a completed stage', async () => {
    const completedStage = {
      ...task.stages[0],
      status: 'COMPLETED' as const,
    };
    const nextStage = {
      id: 'stage-2',
      name: 'Prepare documents',
      position: 1,
      actionType: 'DOCUMENT_GENERATION' as const,
      icon: 'FileText',
      isRequired: true,
      status: 'NOT_STARTED' as const,
    };
    const returnedTask = { ...task, stages: [completedStage, nextStage] };
    navigationMocks.searchParams = new URLSearchParams(
      'taskId=task-1&taskStageId=stage-1&returnTo=%2Ftasks',
    );
    hookMocks.useTasks.mockReturnValue({
      data: { tasks: [returnedTask], total: 1, page: 1, limit: 20, totalPages: 1 },
      error: null,
      isLoading: false,
    });
    hookMocks.useTaskStage.mockImplementation((_taskId: string, stageId: string) => ({
      data: stageId === nextStage.id
        ? {
            ...stage,
            ...nextStage,
            description: 'Prepare the engagement documents.',
            launch: {
              href: '/generated-documents/generate',
              context: { taskId: task.id, taskStageId: nextStage.id },
            },
          }
        : {
            ...stage,
            ...completedStage,
            completedAt: '2026-07-26T00:00:00.000Z',
          },
      error: null,
      isLoading: false,
    }));

    render(<TaskWorkspace />);

    expect(await screen.findByRole('heading', { name: 'Prepare documents' })).toBeVisible();
    expect(hookMocks.useTaskStage).toHaveBeenLastCalledWith(task.id, nextStage.id);
    expect(navigationMocks.replace).toHaveBeenCalledWith('/tasks', { scroll: false });
  });

  it('opens the returned completed stage when it is the final stage', async () => {
    const completedStage = {
      ...task.stages[0],
      status: 'COMPLETED' as const,
    };
    const returnedTask = { ...task, stages: [completedStage] };
    navigationMocks.searchParams = new URLSearchParams(
      'taskId=task-1&taskStageId=stage-1&returnTo=%2Ftasks',
    );
    hookMocks.useTasks.mockReturnValue({
      data: { tasks: [returnedTask], total: 1, page: 1, limit: 20, totalPages: 1 },
      error: null,
      isLoading: false,
      isFetching: false,
    });
    hookMocks.useTaskStage.mockReturnValue({
      data: {
        ...stage,
        ...completedStage,
        completedAt: '2026-07-26T00:00:00.000Z',
      },
      error: null,
      isLoading: false,
    });

    render(<TaskWorkspace />);

    expect(await screen.findByRole('heading', { name: 'Review' })).toBeVisible();
    expect(hookMocks.useTaskStage).toHaveBeenLastCalledWith(task.id, completedStage.id);
    expect(navigationMocks.replace).toHaveBeenCalledWith('/tasks', { scroll: false });
  });

  it('waits for refreshed task data before advancing a returned stage', async () => {
    const completedStage = {
      ...task.stages[0],
      status: 'COMPLETED' as const,
    };
    const nextStage = {
      id: 'stage-2',
      name: 'Prepare documents',
      position: 1,
      actionType: 'DOCUMENT_GENERATION' as const,
      icon: 'FileText',
      isRequired: true,
      status: 'NOT_STARTED' as const,
    };
    const staleTask = { ...task, stages: [task.stages[0], nextStage] };
    const refreshedTask = { ...task, stages: [completedStage, nextStage] };
    let currentTask = staleTask;
    let isFetching = true;
    navigationMocks.searchParams = new URLSearchParams(
      'taskId=task-1&taskStageId=stage-1&returnTo=%2Ftasks',
    );
    hookMocks.useTasks.mockImplementation(() => ({
      data: { tasks: [currentTask], total: 1, page: 1, limit: 20, totalPages: 1 },
      error: null,
      isLoading: false,
      isFetching,
    }));
    hookMocks.useTaskStage.mockImplementation((_taskId: string, stageId: string) => ({
      data: stageId === nextStage.id
        ? {
            ...stage,
            ...nextStage,
            description: 'Prepare the engagement documents.',
            launch: {
              href: '/generated-documents/generate',
              context: { taskId: task.id, taskStageId: nextStage.id },
            },
          }
        : stage,
      error: null,
      isLoading: false,
    }));

    const view = render(<TaskWorkspace />);
    expect(screen.queryByRole('heading', { name: 'Review' })).not.toBeInTheDocument();

    currentTask = refreshedTask;
    isFetching = false;
    view.rerender(<TaskWorkspace />);

    expect(await screen.findByRole('heading', { name: 'Prepare documents' })).toBeVisible();
  });

  it('keeps a failed stage transition visible in the modal and retries it', async () => {
    hookMocks.stageTransition
      .mockRejectedValueOnce(new Error('Stage transition failed'))
      .mockResolvedValueOnce(task);

    render(<TaskWorkspace />);
    fireEvent.click(screen.getAllByRole('button', { name: /Review stage/i })[0]);
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Complete stage' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Stage transition failed');
    expect(dialog).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Complete stage' }));
    await waitFor(() => expect(hookMocks.stageTransition).toHaveBeenCalledTimes(2));
  });

  it('retains stage notes after an autosave failure and retries after the next edit', async () => {
    hookMocks.stageUpdate
      .mockRejectedValueOnce(new Error('Stage update failed'))
      .mockResolvedValueOnce(task);

    render(<TaskWorkspace />);
    fireEvent.click(screen.getAllByRole('button', { name: /Review stage/i })[0]);
    const dialog = screen.getByRole('dialog');
    const notes = within(dialog).getByRole('textbox', { name: 'Notes' });
    fireEvent.change(notes, { target: { value: 'Keep this note for retry' } });

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Stage update failed');
    expect(notes).toHaveValue('Keep this note for retry');

    fireEvent.change(notes, { target: { value: 'Keep this note for retry.' } });
    await waitFor(() => {
      expect(hookMocks.stageUpdate).toHaveBeenCalledTimes(2);
      expect(hookMocks.stageUpdate).toHaveBeenLastCalledWith({
        taskId: task.id,
        stageId: stage.id,
        payload: { notes: 'Keep this note for retry.' },
      });
    }, { timeout: 1500 });
  });

  it('keeps a failed cancellation visible in its confirmation dialog and retries it', async () => {
    hookMocks.status
      .mockRejectedValueOnce(new Error('Cancellation failed'))
      .mockResolvedValueOnce(task);

    render(<TaskWorkspace />);
    clickTaskAction('Cancel');
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel task' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Cancellation failed');
    expect(dialog).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel task' }));
    await waitFor(() => expect(hookMocks.status).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('retains the archive reason after failure and retries it from the confirmation dialog', async () => {
    hookMocks.archive
      .mockRejectedValueOnce(new Error('Archive failed'))
      .mockResolvedValueOnce(task);

    render(<TaskWorkspace />);
    clickTaskAction('Delete');
    const dialog = screen.getByRole('dialog');
    const reason = within(dialog).getByRole('textbox', { name: 'Reason' });
    fireEvent.change(reason, { target: { value: 'Created in error' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete task' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Archive failed');
    expect(reason).toHaveValue('Created in error');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete task' }));
    await waitFor(() => {
      expect(hookMocks.archive).toHaveBeenCalledTimes(2);
      expect(hookMocks.archive).toHaveBeenLastCalledWith({ id: task.id, reason: 'Created in error' });
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
