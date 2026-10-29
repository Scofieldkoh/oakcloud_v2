import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskFilters } from '@/components/tasks/task-filters';
import { TaskFormModal } from '@/components/tasks/task-form-modal';
import { TaskList } from '@/components/tasks/task-list';
import { TaskStageModal } from '@/components/tasks/task-stage-modal';
import { TaskStagePipeline } from '@/components/tasks/task-stage-pipeline';
import { TaskStageActionType } from '@/generated/prisma';
import type { TaskPipeline } from '@/hooks/use-task-pipelines';
import { getStageActionAdapter } from '@/services/tasks/action-registry';
import type {
  TaskListItem,
  TaskResourcesResponse,
  TaskStageDetail,
  TaskStageSummary,
} from '@/services/tasks/types';

const preferenceMocks = vi.hoisted(() => ({
  save: vi.fn(),
}));

const esigningMocks = vi.hoisted(() => ({
  attachGeneratedDocuments: vi.fn(),
  recipientManualLink: vi.fn(),
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
  useUpsertUserPreference: () => ({ mutate: preferenceMocks.save }),
}));

vi.mock('@/hooks/use-esigning', () => ({
  useAttachGeneratedEsigningDocuments: () => ({
    mutateAsync: esigningMocks.attachGeneratedDocuments,
    isPending: false,
  }),
  useEsigningRecipientManualLink: () => ({
    mutateAsync: esigningMocks.recipientManualLink,
    isPending: false,
  }),
}));

vi.mock('@/components/ui/company-select', async () => {
  const { useState } = await import('react');
  const { AsyncSearchSelect } = await import('@/components/ui/async-search-select');
  type Option = { id: string; name: string; label: string; description: string; uen: string | null };
  function LabelledCompanySelect({ label, value, onChange, placeholder, disabled, pinned = [], allowReselect }: {
    label: string;
    value: string;
    onChange: (id: string, company: Option | null) => void;
    placeholder?: string;
    disabled?: boolean;
    pinned?: Option[];
    allowReselect?: boolean;
  }) {
    const [query, setQuery] = useState('');
    const options = pinned.filter((option) => option.label.toLowerCase().includes(query.toLowerCase()));
    return (
      <AsyncSearchSelect<Option>
        label={label}
        value={value}
        onChange={onChange}
        options={options}
        isLoading={false}
        searchQuery={query}
        onSearchChange={setQuery}
        placeholder={placeholder}
        disabled={disabled}
        allowReselect={allowReselect}
      />
    );
  }
  return {
    // Filters with a label search the companies passed as `pinned`, standing in for the server.
    CompanySelect: (props: { label?: string; placeholder?: string } & Record<string, unknown>) => (props.label
      ? <LabelledCompanySelect {...(props as unknown as Parameters<typeof LabelledCompanySelect>[0])} />
      : <input aria-label="All companies" placeholder={props.placeholder} readOnly />),
  };
});

/** Types into the Existing company picker, reopening it first when a company is already selected. */
function searchExistingCompany(name: string) {
  let select = screen.getByRole('combobox', { name: 'Existing company' });
  if (select.tagName !== 'INPUT') {
    fireEvent.click(select);
    select = screen.getByRole('combobox', { name: 'Existing company' });
  }
  fireEvent.focus(select);
  fireEvent.change(select, { target: { value: name } });
  fireEvent.keyDown(select, { key: 'Enter' });
}

const stages: TaskStageSummary[] = [
  { id: 'stage-1', name: 'Profile', position: 0, actionType: 'COMPANY_PROFILE', icon: 'Building2', isRequired: true, status: 'NOT_STARTED' },
  { id: 'stage-2', name: 'Documents', position: 1, actionType: 'DOCUMENT_GENERATION', icon: 'FileText', isRequired: true, status: 'IN_PROGRESS' },
  { id: 'stage-3', name: 'Waiting review', position: 2, actionType: 'MANUAL', icon: 'CircleCheckBig', isRequired: false, status: 'WAITING' },
  { id: 'stage-4', name: 'Signing', position: 3, actionType: 'ESIGNING', icon: 'PenLine', isRequired: true, status: 'COMPLETED' },
  { id: 'stage-5', name: 'Optional check', position: 4, actionType: 'MANUAL', icon: 'CheckSquare', isRequired: false, status: 'SKIPPED' },
  { id: 'stage-6', name: 'Outcome', position: 5, actionType: 'MANUAL', icon: 'Mail', isRequired: true, status: 'FAILED' },
];

const task: TaskListItem = {
  id: 'task-1',
  title: 'Annual compliance review',
  description: 'Prepare and complete the annual review.',
  status: 'IN_PROGRESS',
  dueDate: '2026-07-30T00:00:00.000Z',
  createdAt: '2026-07-20T00:00:00.000Z',
  updatedAt: '2026-07-26T00:00:00.000Z',
  company: { id: 'company-1', name: 'Acme Pte Ltd' },
  owner: { id: 'owner-1', firstName: 'Sam', lastName: 'Chen', email: 'sam@example.com' },
  pipelineVersion: {
    id: 'version-1',
    version: 2,
    pipeline: { id: 'pipeline-1', name: 'Annual review' },
  },
  stages,
};

const pipeline: TaskPipeline = {
  id: 'pipeline-1',
  name: 'Annual review',
  description: null,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  deletedAt: null,
  versions: [{
    id: 'version-1',
    version: 2,
    publishedAt: '2026-07-01T00:00:00.000Z',
    stages: [],
  }],
};

const stageDetail: TaskStageDetail = {
  ...stages[1],
  taskId: task.id,
  description: 'Generate and link the engagement contract.',
  notes: 'Use the approved terms.',
  skipReason: null,
  startedAt: '2026-07-25T02:30:00.000Z',
  completedAt: null,
  assigneeId: 'owner-1',
  assignee: task.owner,
  checklistItems: [{
    id: 'check-1',
    label: 'Confirm company profile',
    position: 0,
    isCompleted: true,
    completedAt: '2026-07-25T03:00:00.000Z',
  }, {
    id: 'check-2',
    label: 'Confirm signing contact',
    position: 1,
    isCompleted: false,
    completedAt: null,
  }],
  outcome: null,
  blockers: [{ code: 'SIGNER_REQUIRED', message: 'Add a signing contact to continue' }],
  launch: {
    href: '/generated-documents/generate',
    context: { taskId: task.id, taskStageId: 'stage-2' },
  },
  outcomeSummary: 'Draft engagement contract (IN_PROGRESS)',
};

const taskListFilterProps = {
  filters: {},
  pipelines: [pipeline],
  companies: [task.company!],
  owners: [task.owner!],
  onFiltersChange: vi.fn(),
  onUpdateMetadata: vi.fn().mockResolvedValue(undefined),
};

beforeEach(() => {
  vi.clearAllMocks();
  esigningMocks.attachGeneratedDocuments.mockResolvedValue({});
  esigningMocks.recipientManualLink.mockResolvedValue({});
});

describe('TaskList', () => {
  it('renders Vault-style inline filters above their matching columns', () => {
    const onFiltersChange = vi.fn();
    render(
      <TaskList
        tasks={[task]}
        {...taskListFilterProps}
        onFiltersChange={onFiltersChange}
        onSelectStage={vi.fn()}
        onEdit={vi.fn()}
        onStatusAction={vi.fn()}
        onArchive={vi.fn()}
      />,
    );

    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(rows[0]).toHaveAttribute('data-filter-row');
    expect(rows[1]).toHaveAttribute('data-column-header-row');
    expect(within(rows[1]).getAllByRole('columnheader').map((header) => header.textContent))
      .toEqual(['Company', 'Task', 'Status', 'Pipeline', 'Stages', 'Owner', 'Due', 'Actions']);
    const filterCells = rows[0].querySelectorAll('th');
    expect(filterCells[1]).not.toContainElement(
      within(rows[0]).getByRole('combobox', { name: 'Filter tasks by status' }),
    );
    expect(filterCells[2]).toContainElement(
      within(rows[0]).getByRole('combobox', { name: 'Filter tasks by status' }),
    );
    const searchableSelects = [
      within(rows[0]).getByRole('combobox', { name: 'Filter tasks by status' }),
      within(rows[0]).getByRole('combobox', { name: 'Filter tasks by pipeline' }),
    ];
    searchableSelects.forEach((filter) => {
      expect(filter.tagName).toBe('INPUT');
      expect(filter).toHaveAttribute('aria-autocomplete', 'list');
    });
    const titleFilter = within(rows[0]).getByRole('searchbox', { name: 'Filter tasks by title' });
    const ownerFilter = within(rows[0]).getByRole('searchbox', { name: 'Filter tasks by owner' });
    expect(filterCells[1]).toContainElement(titleFilter);
    expect(filterCells[5]).toContainElement(ownerFilter);
    expect(within(filterCells[6]).getByText('All dates')).toBeVisible();
    fireEvent.change(titleFilter, { target: { value: 'annual' } });
    expect(onFiltersChange).toHaveBeenCalledWith({ page: 1, title: 'annual' });
    fireEvent.change(ownerFilter, { target: { value: 'sam' } });
    expect(onFiltersChange).toHaveBeenLastCalledWith({ page: 1, ownerQuery: 'sam' });
    expect(screen.getByTestId('task-table-scroll').firstElementChild).toHaveClass('overflow-x-auto');
    expect(screen.getByTestId('task-stage-cell')).not.toHaveClass('overflow-x-auto');
    expect(within(screen.getByTestId('task-stage-cell')).getAllByRole('button')).toHaveLength(stages.length);
    expect(within(screen.getByTestId('task-pipeline-cell')).getByText('Annual review')).toBeVisible();
    expect(within(screen.getByTestId('task-status-cell')).getByText('In progress')).toBeVisible();
    const dataCells = within(rows[2]).getAllByRole('cell');
    expect(dataCells[1]).toHaveTextContent(task.title);
    expect(dataCells[1]).not.toHaveTextContent('In progress');
  });

  it('uses the Document Vault alternate-row surface', () => {
    render(
      <TaskList
        tasks={[task, { ...task, id: 'task-2', title: 'Second task' }]}
        {...taskListFilterProps}
        onSelectStage={vi.fn()}
        onEdit={vi.fn()}
        onStatusAction={vi.fn()}
        onArchive={vi.fn()}
      />,
    );

    const bodyRows = screen.getAllByRole('row').slice(2);
    expect(bodyRows[0]).not.toHaveClass('bg-oak-row-alt');
    expect(bodyRows[1]).toHaveClass('bg-oak-row-alt', 'hover:bg-oak-row-alt-hover');
  });

  it('opens the lowest-position incomplete stage from a desktop row click', () => {
    vi.useFakeTimers();
    const onSelectStage = vi.fn();
    const waitingStage = { ...stages[2], position: 1, status: 'WAITING' as const };
    const unorderedStages: TaskStageSummary[] = [
      { ...stages[0], position: 2, status: 'NOT_STARTED' },
      { ...stages[1], position: 0, status: 'COMPLETED' },
      waitingStage,
    ];

    try {
      render(
        <TaskList
          tasks={[{ ...task, stages: unorderedStages }]}
          {...taskListFilterProps}
          onSelectStage={onSelectStage}
          onEdit={vi.fn()}
          onStatusAction={vi.fn()}
          onArchive={vi.fn()}
        />,
      );

      fireEvent.click(screen.getAllByRole('row')[2]);
      expect(onSelectStage).not.toHaveBeenCalled();
      vi.advanceTimersByTime(300);
      expect(onSelectStage).not.toHaveBeenCalled();
      vi.advanceTimersByTime(250);
      expect(onSelectStage).toHaveBeenCalledWith(
        expect.objectContaining({ id: task.id }),
        waitingStage,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a slower double-click in the metadata cell from opening a stage', () => {
    vi.useFakeTimers();
    const onSelectStage = vi.fn();

    try {
      render(
        <TaskList
          tasks={[task]}
          {...taskListFilterProps}
          onSelectStage={onSelectStage}
          onEdit={vi.fn()}
          onStatusAction={vi.fn()}
          onArchive={vi.fn()}
        />,
      );
      const taskCell = within(screen.getAllByRole('row')[2]).getAllByRole('cell')[1];

      fireEvent.click(taskCell);
      vi.advanceTimersByTime(300);
      fireEvent.doubleClick(taskCell);
      vi.advanceTimersByTime(300);

      expect(onSelectStage).not.toHaveBeenCalled();
      expect(screen.getByRole('textbox', { name: 'Edit task title' })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not navigate completed rows or duplicate interactive-child actions', () => {
    vi.useFakeTimers();
    const onSelectStage = vi.fn();
    const completeStages: TaskStageSummary[] = [
      { ...stages[0], status: 'COMPLETED' },
      { ...stages[1], status: 'SKIPPED' },
    ];

    try {
      const { rerender } = render(
        <TaskList
          tasks={[{ ...task, stages: completeStages }]}
          {...taskListFilterProps}
          onSelectStage={onSelectStage}
          onEdit={vi.fn()}
          onStatusAction={vi.fn()}
          onArchive={vi.fn()}
        />,
      );

      fireEvent.click(screen.getAllByRole('row')[2]);
      vi.advanceTimersByTime(250);
      expect(onSelectStage).not.toHaveBeenCalled();

      rerender(
        <TaskList
          tasks={[task]}
          {...taskListFilterProps}
          onSelectStage={onSelectStage}
          onEdit={vi.fn()}
          onStatusAction={vi.fn()}
          onArchive={vi.fn()}
        />,
      );
      const stageButton = screen.getAllByRole('button', { name: /Profile stage/i })[1];
      fireEvent.click(stageButton);
      vi.advanceTimersByTime(250);
      expect(onSelectStage).toHaveBeenCalledTimes(1);
      expect(onSelectStage).toHaveBeenCalledWith(task, stages[0]);

      onSelectStage.mockClear();
      fireEvent.click(screen.getAllByRole('button', { name: `Actions for ${task.title}` })[1]);
      vi.advanceTimersByTime(250);
      expect(onSelectStage).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('edits a task title on blur without opening its stage', async () => {
    vi.useFakeTimers();
    const onSelectStage = vi.fn();
    const onUpdateMetadata = vi.fn().mockResolvedValue(undefined);

    const { unmount } = render(
      <TaskList
        tasks={[task]}
        {...taskListFilterProps}
        onUpdateMetadata={onUpdateMetadata}
        onSelectStage={onSelectStage}
        onEdit={vi.fn()}
        onStatusAction={vi.fn()}
        onArchive={vi.fn()}
      />,
    );
    const taskCell = within(screen.getAllByRole('row')[2]).getAllByRole('cell')[1];

    try {
      fireEvent.click(taskCell);
      fireEvent.doubleClick(taskCell);
      vi.advanceTimersByTime(250);
      expect(onSelectStage).not.toHaveBeenCalled();

      vi.useRealTimers();
      const input = screen.getByRole('textbox', { name: 'Edit task title' });
      fireEvent.change(input, { target: { value: 'Updated annual review' } });
      fireEvent.blur(input);

      await waitFor(() => expect(onUpdateMetadata).toHaveBeenCalledTimes(1));
      expect(onUpdateMetadata).toHaveBeenCalledWith(task, { title: 'Updated annual review' });
    } finally {
      vi.useRealTimers();
      unmount();
    }
  });

  it('cancels a title edit on Escape and retains failed saves', async () => {
    const onUpdateMetadata = vi.fn().mockRejectedValue(new Error('Update failed'));
    render(
      <TaskList
        tasks={[task]}
        {...taskListFilterProps}
        onUpdateMetadata={onUpdateMetadata}
        onSelectStage={vi.fn()}
        onEdit={vi.fn()}
        onStatusAction={vi.fn()}
        onArchive={vi.fn()}
      />,
    );
    const taskCell = within(screen.getAllByRole('row')[2]).getAllByRole('cell')[1];

    fireEvent.doubleClick(taskCell);
    let input = screen.getByRole('textbox', { name: 'Edit task title' });
    fireEvent.change(input, { target: { value: 'Discard this' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onUpdateMetadata).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: 'Edit task title' })).not.toBeInTheDocument();

    fireEvent.doubleClick(taskCell);
    input = screen.getByRole('textbox', { name: 'Edit task title' });
    fireEvent.change(input, { target: { value: 'Keep this value' } });
    fireEvent.blur(input);

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save task');
    expect(screen.getByRole('textbox', { name: 'Edit task title' })).toHaveValue('Keep this value');
  });

  it('dismisses non-text inline editors on outside click or Escape', () => {
    render(
      <TaskList
        tasks={[task]}
        {...taskListFilterProps}
        onSelectStage={vi.fn()}
        onEdit={vi.fn()}
        onStatusAction={vi.fn()}
        onArchive={vi.fn()}
      />,
    );
    const cells = within(screen.getAllByRole('row')[2]).getAllByRole('cell');

    fireEvent.doubleClick(cells[0]);
    expect(screen.getByRole('combobox', { name: 'Edit company' })).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('combobox', { name: 'Edit company' })).not.toBeInTheDocument();

    fireEvent.doubleClick(cells[5]);
    expect(screen.getByRole('combobox', { name: 'Edit owner' })).toBeInTheDocument();
    fireEvent.focusIn(document.body);
    expect(screen.queryByRole('combobox', { name: 'Edit owner' })).not.toBeInTheDocument();

    fireEvent.doubleClick(cells[2]);
    expect(screen.getByRole('button', { name: 'Pause task' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: 'Pause task' })).not.toBeInTheDocument();

    fireEvent.doubleClick(cells[6]);
    expect(within(cells[6]).getByTestId('task-due-inline-editor')).toBeInTheDocument();
    fireEvent.click(within(cells[6]).getByText('30 Jul 2026'));
    const datePickerPopover = document.querySelector('[data-datepicker-popover]');
    expect(datePickerPopover).not.toBeNull();
    fireEvent.mouseDown(within(datePickerPopover as HTMLElement).getByRole('button', { name: 'Single Date' }));
    expect(within(cells[6]).getByTestId('task-due-inline-editor')).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(within(cells[6]).queryByTestId('task-due-inline-editor')).not.toBeInTheDocument();
  });

  it('clears Company, Owner, and Due through their inline editors', async () => {
    const onUpdateMetadata = vi.fn().mockResolvedValue(undefined);
    render(
      <TaskList
        tasks={[task]}
        {...taskListFilterProps}
        onUpdateMetadata={onUpdateMetadata}
        onSelectStage={vi.fn()}
        onEdit={vi.fn()}
        onStatusAction={vi.fn()}
        onArchive={vi.fn()}
      />,
    );
    const cells = within(screen.getAllByRole('row')[2]).getAllByRole('cell');

    fireEvent.doubleClick(cells[0]);
    expect(screen.getByRole('combobox', { name: 'Edit company' })).toBeInTheDocument();
    fireEvent.click(within(cells[0]).getByRole('button', { name: 'Clear selection' }));
    await waitFor(() => expect(onUpdateMetadata).toHaveBeenCalledWith(task, { companyId: null }));

    fireEvent.doubleClick(cells[5]);
    expect(screen.getByRole('combobox', { name: 'Edit owner' })).toBeInTheDocument();
    fireEvent.click(within(cells[5]).getByRole('button', { name: 'Clear selection' }));
    await waitFor(() => expect(onUpdateMetadata).toHaveBeenCalledWith(task, { ownerId: null }));

    fireEvent.doubleClick(cells[6]);
    expect(within(cells[6]).getByTestId('task-due-inline-editor')).toBeInTheDocument();
    fireEvent.click(within(cells[6]).getByRole('button', { name: 'Clear selection' }));
    await waitFor(() => expect(onUpdateMetadata).toHaveBeenCalledWith(task, { dueDate: null }));
  });

  it('offers only valid status actions from the inline status editor', () => {
    const onStatusAction = vi.fn();
    const { rerender } = render(
      <TaskList
        tasks={[task]}
        {...taskListFilterProps}
        onSelectStage={vi.fn()}
        onEdit={vi.fn()}
        onStatusAction={onStatusAction}
        onArchive={vi.fn()}
      />,
    );

    fireEvent.doubleClick(within(screen.getAllByRole('row')[2]).getAllByRole('cell')[2]);
    expect(screen.getByRole('button', { name: 'Pause task' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel task' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Complete task/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Pause task' }));
    expect(onStatusAction).toHaveBeenCalledWith(task, 'pause');

    rerender(
      <TaskList
        tasks={[{ ...task, status: 'PAUSED' }]}
        {...taskListFilterProps}
        onSelectStage={vi.fn()}
        onEdit={vi.fn()}
        onStatusAction={onStatusAction}
        onArchive={vi.fn()}
      />,
    );
    fireEvent.doubleClick(within(screen.getAllByRole('row')[2]).getAllByRole('cell')[2]);
    expect(screen.getByRole('button', { name: 'Resume task' })).toBeInTheDocument();
  });

  it('does not show redundant Unscheduled subtext for an undated task', () => {
    render(
      <TaskList
        tasks={[{ ...task, dueDate: null }]}
        {...taskListFilterProps}
        onSelectStage={vi.fn()}
        onEdit={vi.fn()}
        onStatusAction={vi.fn()}
        onArchive={vi.fn()}
      />,
    );

    const table = screen.getByRole('table');
    expect(within(table).getByText('No due date')).toBeVisible();
    expect(within(table).queryByText('Unscheduled')).not.toBeInTheDocument();
  });

  it('renders mobile cards with the full stage pipeline below the task summary', () => {
    render(
      <TaskList
        tasks={[task]}
        {...taskListFilterProps}
        onSelectStage={vi.fn()}
        onEdit={vi.fn()}
        onStatusAction={vi.fn()}
        onArchive={vi.fn()}
      />,
    );

    const card = screen.getByTestId('task-mobile-card');
    expect(card).toHaveClass('md:hidden');
    expect(within(card).getByText(task.title)).toBeInTheDocument();
    expect(within(card).getAllByRole('button', { name: /stage/i })).toHaveLength(stages.length);
  });

  it('offers metadata, pause or resume, cancel, and archive actions from one ellipsis menu', () => {
    const onEdit = vi.fn();
    const onStatusAction = vi.fn();
    const onArchive = vi.fn();
    render(
      <TaskList
        tasks={[task]}
        {...taskListFilterProps}
        onSelectStage={vi.fn()}
        onEdit={onEdit}
        onStatusAction={onStatusAction}
        onArchive={onArchive}
      />,
    );

    const actionTriggers = screen.getAllByRole('button', { name: `Actions for ${task.title}` });
    expect(actionTriggers).toHaveLength(2);
    fireEvent.click(actionTriggers[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit metadata' }));
    fireEvent.click(actionTriggers[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pause' }));
    fireEvent.click(actionTriggers[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Cancel' }));
    fireEvent.click(actionTriggers[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(onEdit).toHaveBeenCalledWith(task);
    expect(onStatusAction).toHaveBeenNthCalledWith(1, task, 'pause');
    expect(onStatusAction).toHaveBeenNthCalledWith(2, task, 'cancel');
    expect(onArchive).toHaveBeenCalledWith(task);
  });

  it('persists the final width after a desktop column is resized', () => {
    render(
      <TaskList
        tasks={[task]}
        {...taskListFilterProps}
        onSelectStage={vi.fn()}
        onEdit={vi.fn()}
        onStatusAction={vi.fn()}
        onArchive={vi.fn()}
      />,
    );

    const table = screen.getByRole('table');
    expect(table).toHaveClass('w-full', 'min-w-max');
    expect(table).not.toHaveClass('table-fixed');
    expect(table.style.width).toBe('');
    expect(table.style.minWidth).toBe('');

    const handle = screen.getByRole('separator', { name: 'Resize Company column' });
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 160 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 160 });

    expect(table.style.width).toBe('');
    expect(table.style.minWidth).toBe('');
    // 270px default Company width plus the 60px drag.
    expect(table.querySelector('colgroup col')).toHaveStyle({ width: '330px' });
    expect(preferenceMocks.save).toHaveBeenCalledWith({
      key: 'tasks:list:columns:v1',
      value: expect.objectContaining({ company: 330 }),
    });
  });
});

describe('TaskStagePipeline', () => {
  it('uses pastel status surfaces and a visible non-colour marker with accessible tooltips and mobile targets', () => {
    render(<TaskStagePipeline stages={stages} onSelectStage={vi.fn()} />);

    const buttons = screen.getAllByRole('button', { name: /stage/i });
    expect(buttons).toHaveLength(stages.length);
    expect(buttons.map((button) => button.getAttribute('data-status'))).toEqual(stages.map((stage) => stage.status));
    expect(buttons[0]).toHaveClass('bg-slate-100', 'min-h-[44px]', 'min-w-[44px]');
    expect(buttons[1]).toHaveClass('bg-blue-100');
    expect(buttons[2]).toHaveClass('bg-amber-100');
    expect(buttons[3]).toHaveClass('bg-emerald-100');
    expect(buttons[4]).toHaveClass('bg-slate-100');
    expect(buttons[5]).toHaveClass('bg-red-100');
    buttons.forEach((button) => {
      expect(button).toHaveAttribute('title');
      expect(within(button).getByTestId('stage-status-marker')).toBeVisible();
    });
  });
});

describe('TaskFilters', () => {
  it('uses the Vault toolbar with task quick filters', async () => {
    const onChange = vi.fn();
    render(
      <TaskFilters
        value={{ limit: 50 }}
        onChange={onChange}
        currentUserId="user-1"
      />,
    );

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search tasks' }), { target: { value: 'annual' } });
    fireEvent.click(screen.getByRole('button', { name: 'Owned by me' }));
    fireEvent.click(screen.getByRole('button', { name: 'Due this week' }));
    fireEvent.click(screen.getByRole('button', { name: 'In Progress' }));

    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ limit: 50, page: 1, query: 'annual' }));
    expect(onChange).toHaveBeenCalledWith({ limit: 50, page: 1, ownerId: 'user-1' });
    expect(onChange).toHaveBeenCalledWith({
      limit: 50,
      page: 1,
      dueBucket: 'thisWeek',
      dueDateFrom: undefined,
      dueDateTo: undefined,
    });
    expect(onChange).toHaveBeenCalledWith({ limit: 50, page: 1, status: 'IN_PROGRESS' });
  });
});

describe('TaskFormModal', () => {
  it('requires only title and pipeline and omits untouched optional metadata', () => {
    const onSubmit = vi.fn();
    render(
      <TaskFormModal
        isOpen
        mode="create"
        pipelines={[pipeline]}
        owners={[task.owner!]}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));
    expect(screen.getByText('Title is required')).toBeInTheDocument();
    expect(screen.getByText('Pipeline is required')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Prepare annual return' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Pipeline' }), { target: { value: 'version-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));

    expect(onSubmit).toHaveBeenCalledWith({
      title: 'Prepare annual return',
      pipelineVersionId: 'version-1',
    });
  });

  it('shows the pipeline name without its published version number', () => {
    render(
      <TaskFormModal
        isOpen
        mode="create"
        pipelines={[pipeline]}
        owners={[task.owner!]}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    const pipelineSelect = screen.getByRole('combobox', { name: 'Pipeline' });
    expect(within(pipelineSelect).getByRole('option', { name: 'Annual review' })).toBeInTheDocument();
    expect(within(pipelineSelect).queryByRole('option', { name: 'Annual review · v2' })).not.toBeInTheDocument();
  });
});

describe('TaskStageModal', () => {
  it('renders the task resources side panel beside the stage content', () => {
    const resources: TaskResourcesResponse = {
      task: {
        id: task.id,
        title: task.title,
        status: task.status,
        dueDate: task.dueDate,
        company: {
          id: task.company!.id,
          name: task.company!.name,
          uen: '202600001A',
          href: `/companies/${task.company!.id}`,
        },
        owner: { id: task.owner!.id, name: 'Sam Chen', email: task.owner!.email },
        pipelineName: task.pipelineVersion.pipeline.name,
      },
      stages: [0, 1, 2].map((position) => ({
        id: `resource-stage-${position}`,
        name: `Resource stage ${position + 1}`,
        position,
        actionType: 'MANUAL' as const,
        status: 'COMPLETED' as const,
        description: null,
        notes: null,
        startedAt: null,
        completedAt: null,
        assignee: null,
        checklist: [],
        blockers: [],
        resources: [],
      })),
      hasPendingResources: false,
    };

    render(
      <TaskStageModal
        isOpen
        stage={stageDetail}
        resources={resources}
        taskDueDate={task.dueDate}
        onClose={vi.fn()}
        onUpdateMetadata={vi.fn()}
        onTransition={vi.fn()}
      />,
    );

    expect(screen.getByTestId('pipeline-stage-modal-main')).toBeVisible();
    expect(screen.getByTestId('task-resources-panel')).toBeVisible();
    expect(screen.getAllByTestId(/task-resource-stage-/)).toHaveLength(3);
    expect(screen.getByTestId('pipeline-stage-modal-footer')).toBeVisible();
  });

  it('uses the same pipeline modal shell for document, e-signing, and manual stages', () => {
    const stageVariants: Array<{
      stage: TaskStageDetail;
      outcomeLabel: string;
    }> = [
      {
        stage: stageDetail,
        outcomeLabel: 'Linked document',
      },
      {
        stage: {
          ...stageDetail,
          id: 'stage-esigning',
          name: 'E-Signing',
          description: 'Send the approved contract for signatures.',
          actionType: 'ESIGNING',
          outcomeSummary: 'Signature request for engagement contract',
        },
        outcomeLabel: 'Linked signing request',
      },
      {
        stage: {
          ...stageDetail,
          id: 'stage-manual',
          name: 'Client review',
          description: 'Confirm the client has reviewed the engagement.',
          actionType: 'MANUAL',
          outcomeSummary: 'Client review recorded',
          launch: { href: null, context: stageDetail.launch.context },
        },
        outcomeLabel: 'Linked outcome',
      },
    ];

    stageVariants.forEach(({ stage, outcomeLabel }) => {
      const { unmount } = render(
        <TaskStageModal
          isOpen
          stage={stage}
          taskDueDate={task.dueDate}
          onClose={vi.fn()}
          onUpdateMetadata={vi.fn()}
          onTransition={vi.fn()}
        />,
      );

      const dialog = screen.getByRole('dialog');
      expect(dialog.firstElementChild).toHaveClass('sm:max-w-[90vw]', 'border-l-4');
      expect(dialog).toHaveAccessibleDescription(stage.description!);
      expect(screen.queryByRole('heading', { name: 'Overview' })).not.toBeInTheDocument();
      expect(screen.getByTestId('pipeline-stage-modal-body')).toHaveClass('p-5', 'sm:p-6');
      expect(screen.getByTestId('pipeline-stage-modal-footer')).toHaveClass('px-6', 'py-4');
      expect(within(screen.getByTestId('stage-linked-outcome-card')).getByText(outcomeLabel)).toBeVisible();
      expect(within(screen.getByTestId('stage-secondary-details')).getByText('Due Date')).toBeVisible();
      expect(screen.getByRole('status')).toHaveClass('min-h-4');
      unmount();
    });
  });

  it('places prominent stage details before a two-to-one Company Profile action row', async () => {
    const companyAdapter = getStageActionAdapter(TaskStageActionType.COMPANY_PROFILE);
    const linkedCompany = { id: 'company-linked', name: 'DAP Atelier (S) Pte. Ltd.', uen: '202400002B' };
    const companyStage: TaskStageDetail = {
      ...stageDetail,
      id: 'stage-company',
      name: 'Company Profile',
      actionType: 'COMPANY_PROFILE',
      status: 'COMPLETED',
      blockers: [],
      outcomeSummary: 'Linked company: DAP Atelier (S) Pte. Ltd.',
      startedAt: '2026-07-28T10:10:00+08:00',
      completedAt: '2026-07-28T10:10:00+08:00',
      launch: companyAdapter.launch({
        tenantId: 'tenant-1',
        stage: {
          id: 'stage-company',
          tenantId: 'tenant-1',
          taskId: task.id,
          actionType: TaskStageActionType.COMPANY_PROFILE,
          actionConfig: { allowCreate: true },
          status: 'NOT_STARTED',
          task: { companyId: null },
        },
      }),
    };
    const onStartBizFileReview = vi.fn().mockResolvedValue(undefined);
    render(
      <TaskStageModal
        isOpen
        stage={companyStage}
        companies={[linkedCompany, { ...task.company!, uen: '202400001A' }]}
        taskCompanyId={linkedCompany.id}
        taskDueDate={task.dueDate}
        onClose={vi.fn()}
        onUpdateMetadata={vi.fn()}
        onTransition={vi.fn()}
        onStartBizFileReview={onStartBizFileReview}
      />,
    );

    const dialogPanel = screen.getByRole('dialog').firstElementChild;
    expect(dialogPanel).toHaveClass('sm:max-w-[90vw]');
    expect(dialogPanel).toHaveClass('border-l-4', 'border-l-emerald-500');
    expect(dialogPanel).not.toHaveClass('border-t-4');

    const modalTitle = screen.getByRole('heading', { name: 'Company Profile' });
    const statusBadge = screen.getByTestId('stage-status-badge');
    expect(modalTitle.parentElement).toContainElement(statusBadge);
    expect(statusBadge).toHaveTextContent('Complete');
    expect(screen.getByText('Link or create Company profile for the task')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Overview' })).not.toBeInTheDocument();
    expect(screen.queryByText('Link or create the authoritative Company profile for this client.')).not.toBeInTheDocument();

    const linkedOutcomeCard = screen.getByTestId('stage-linked-outcome-card');
    const secondaryDetails = screen.getByTestId('stage-secondary-details');
    const createOptionHeading = screen.getByRole('heading', { name: '1. Create a new company profile' });
    const existingOptionHeading = screen.getByRole('heading', { name: '2. Or link an existing company' });
    expect(screen.queryByRole('heading', { name: 'Link Company details' })).not.toBeInTheDocument();
    expect(createOptionHeading).toHaveClass('text-base');
    expect(existingOptionHeading).toHaveClass('text-base');
    expect(screen.getByText('BizFile or manual entry')).toHaveClass('text-text-muted');
    const uploadHeading = screen.getByRole('heading', { name: 'Upload BizFile' });
    const uploadButton = screen.getByRole('button', { name: 'Upload and review BizFile' });
    const createLink = screen.getByRole('link', { name: 'Enter company manually' });
    const notes = screen.getByRole('textbox', { name: 'Notes' });
    expect(modalTitle.compareDocumentPosition(linkedOutcomeCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(linkedOutcomeCard.compareDocumentPosition(secondaryDetails) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(linkedOutcomeCard).not.toContainElement(secondaryDetails);
    expect(secondaryDetails.compareDocumentPosition(createOptionHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(createOptionHeading.compareDocumentPosition(uploadHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(uploadHeading.compareDocumentPosition(createLink) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(createLink.compareDocumentPosition(existingOptionHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(existingOptionHeading.compareDocumentPosition(notes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByTestId('company-profile-create-panel')).toHaveLength(1);
    expect(screen.getByTestId('company-profile-create-option')).not.toHaveClass('ml-4', 'pl-4', 'border-l');
    expect(screen.getByTestId('company-profile-existing-option')).not.toHaveClass('ml-4', 'pl-4', 'border-l');
    expect(screen.getByTestId('company-profile-action-row')).toHaveClass('sm:grid-cols-3');
    expect(uploadButton).toHaveClass('sm:col-span-2');
    expect(uploadButton).toHaveClass('disabled:opacity-70');
    expect(createLink).toHaveClass('sm:col-span-1');
    expect(notes).toHaveAttribute('rows', '4');
    expect(linkedOutcomeCard).toHaveClass('bg-oak-primary/5');
    expect(within(linkedOutcomeCard).getByText('Linked company')).toBeVisible();
    expect(within(linkedOutcomeCard).getByText('DAP Atelier (S) Pte. Ltd.')).toHaveClass('font-medium');
    expect(within(linkedOutcomeCard).queryByText(/Linked company:/)).not.toBeInTheDocument();
    expect(screen.getByTestId('company-profile-dropzone')).toHaveClass('min-h-44');
    expect(screen.getByTestId('company-profile-create-panel')).toHaveClass('p-4');
    expect(screen.queryByText(/Search for an existing company and link it/)).not.toBeInTheDocument();
    expect(screen.getByText('Existing company')).toBeVisible();
    expect(screen.getByText('Search by company name or UEN')).toBeVisible();
    expect(screen.getByTestId('company-profile-existing-option')).toHaveAttribute('data-selection-state', 'unchanged');

    searchExistingCompany('Acme');
    expect(screen.getByRole('combobox', { name: 'Existing company' })).toHaveTextContent('Acme Pte Ltd');

    const fileInput = screen.getByLabelText('Upload BizFile file');
    const firstFile = new File(['pdf'], 'first-bizfile.pdf', { type: 'application/pdf' });
    fireEvent.change(fileInput, { target: { files: [firstFile] } });
    expect(await screen.findByText('first-bizfile.pdf')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Remove first-bizfile.pdf' }));
    expect(screen.queryByText('first-bizfile.pdf')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload and review BizFile' })).toBeDisabled();

    const replacementFile = new File(['replacement'], 'replacement-bizfile.pdf', { type: 'application/pdf' });
    fireEvent.change(fileInput, { target: { files: [replacementFile] } });
    expect(await screen.findByText('replacement-bizfile.pdf')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Upload and review BizFile' }));
    await waitFor(() => expect(onStartBizFileReview).toHaveBeenCalledWith(replacementFile));

    expect(within(linkedOutcomeCard).getByText('Linked company')).toBeVisible();
    expect(within(secondaryDetails).getByText('Assignee')).toBeVisible();
    expect(within(secondaryDetails).getByText('Due Date')).toBeVisible();
    expect(within(secondaryDetails).getByText('Started')).toBeVisible();
    expect(within(secondaryDetails).getByText('Completed')).toBeVisible();
    expect(within(secondaryDetails).getAllByText('28 Jul 2026, 10:10')).toHaveLength(2);
    expect(within(secondaryDetails).getByText('Assignee')).toHaveClass('text-text-secondary');
    expect(within(linkedOutcomeCard).queryByText('Assignee')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('stage-secondary-timeline')).getByText('Assignee')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Previous stage' })).toHaveClass('text-text-secondary');
    expect(screen.getByRole('button', { name: 'Next stage' })).toHaveClass('text-text-secondary');
    expect(screen.getByRole('button', { name: 'Close modal' })).toHaveClass('min-h-12', 'min-w-12');
  });

  it('distinguishes an unchanged company from a replacement and a first-time link', () => {
    const linkedCompany = { id: 'company-linked', name: 'DAP Atelier (S) Pte. Ltd.' };
    const replacementCompany = { id: 'company-replacement', name: 'New Company Pte. Ltd.' };
    const companyStage: TaskStageDetail = {
      ...stageDetail,
      id: 'stage-company',
      name: 'Company Profile',
      actionType: 'COMPANY_PROFILE',
      status: 'COMPLETED',
      blockers: [],
      launch: {
        href: `/companies/${linkedCompany.id}`,
        context: { taskId: task.id, taskStageId: 'stage-company' },
      },
      outcomeSummary: `Linked company: ${linkedCompany.name}`,
    };
    const onTransition = vi.fn();
    const selectCompany = searchExistingCompany;

    const { unmount } = render(
      <TaskStageModal
        isOpen
        stage={companyStage}
        companies={[linkedCompany, replacementCompany]}
        taskCompanyId={linkedCompany.id}
        onClose={vi.fn()}
        onUpdateMetadata={vi.fn()}
        onTransition={onTransition}
      />,
    );

    expect(screen.getByRole('button', { name: 'Company already linked' })).toBeDisabled();
    expect(screen.getByTestId('company-profile-existing-option')).toHaveAttribute('data-selection-state', 'unchanged');

    selectCompany(replacementCompany.name);
    expect(screen.getByTestId('company-profile-existing-option')).toHaveAttribute('data-selection-state', 'replacement');
    fireEvent.click(screen.getByRole('button', { name: 'Replace linked company' }));
    expect(onTransition).toHaveBeenCalledWith({
      action: 'linkOutcome',
      outcome: { type: 'COMPANY', companyId: replacementCompany.id },
    });

    unmount();
    render(
      <TaskStageModal
        isOpen
        stage={{ ...companyStage, outcomeSummary: null }}
        companies={[linkedCompany, replacementCompany]}
        taskCompanyId={null}
        onClose={vi.fn()}
        onUpdateMetadata={vi.fn()}
        onTransition={onTransition}
      />,
    );

    selectCompany(linkedCompany.name);
    expect(screen.getByTestId('company-profile-existing-option')).toHaveAttribute('data-selection-state', 'new');
    expect(screen.getByRole('button', { name: 'Link selected company' })).toBeEnabled();
  });

  it('explains why a Company Profile stage is failed and offers relinking', () => {
    const companyStage: TaskStageDetail = {
      ...stageDetail,
      id: 'stage-company',
      name: 'Company Profile',
      actionType: 'COMPANY_PROFILE',
      status: 'FAILED',
      blockers: [],
      outcomeSummary: null,
      launch: {
        href: null,
        context: { taskId: task.id, taskStageId: 'stage-company' },
      },
    };

    render(
      <TaskStageModal
        isOpen
        stage={companyStage}
        companies={[{ id: 'company-other', name: 'Other Pte. Ltd.' }]}
        taskCompanyId={null}
        onClose={vi.fn()}
        onUpdateMetadata={vi.fn()}
        onTransition={vi.fn()}
      />,
    );

    expect(screen.getByRole('alert', { name: 'Linked company no longer available' }))
      .toHaveTextContent(/no longer available.*marked as failed/i);
    expect(screen.getByRole('heading', { name: '2. Or link an existing company' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Select an existing company' })).toBeDisabled();
  });

  it('autosaves notes after typing without a manual save action', async () => {
    let resolveSave!: () => void;
    const onUpdateMetadata = vi.fn(() => new Promise<void>((resolve) => {
      resolveSave = resolve;
    }));
    render(
      <TaskStageModal
        isOpen
        stage={stageDetail}
        onClose={vi.fn()}
        onUpdateMetadata={onUpdateMetadata}
        onTransition={vi.fn()}
      />,
    );

    const notes = screen.getByRole('textbox', { name: 'Notes' });
    const saveStatus = screen.getByRole('status');
    expect(saveStatus).toBeEmptyDOMElement();
    expect(saveStatus).toHaveClass('min-h-4');

    fireEvent.change(notes, { target: { value: 'Autosaved stage note' } });

    expect(screen.queryByRole('button', { name: 'Save notes' })).not.toBeInTheDocument();
    expect(screen.queryByText('Changes save automatically')).not.toBeInTheDocument();
    expect(await screen.findByText('Saving…', {}, { timeout: 1500 })).toBeVisible();
    expect(onUpdateMetadata).toHaveBeenCalledWith({ notes: 'Autosaved stage note' });
    resolveSave();
    expect(await screen.findByText('Saved')).toBeVisible();
  });

  it('shows concise notes feedback when autosave fails', async () => {
    render(
      <TaskStageModal
        isOpen
        stage={stageDetail}
        onClose={vi.fn()}
        onUpdateMetadata={vi.fn().mockRejectedValue(new Error('Stage update failed'))}
        onTransition={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'Notes' }), {
      target: { value: 'Unsaved stage note' },
    });

    expect(await screen.findByText('Couldn’t save', {}, { timeout: 1500 })).toBeVisible();
  });

  it('keeps company creation available after completion and navigates to the next stage', () => {
    const onNavigateStage = vi.fn();
    render(
      <TaskStageModal
        isOpen
        stage={{
          ...stageDetail,
          id: 'stage-company',
          name: 'Company Profile',
          actionType: 'COMPANY_PROFILE',
          status: 'COMPLETED',
          blockers: [],
          launch: {
            href: '/companies/company-1',
            context: { taskId: task.id, taskStageId: 'stage-company' },
          },
          outcomeSummary: 'Linked company: Acme Pte Ltd',
        }}
        companies={[task.company!]}
        taskCompanyId={task.company!.id}
        onClose={vi.fn()}
        onUpdateMetadata={vi.fn()}
        onTransition={vi.fn()}
        onStartBizFileReview={vi.fn()}
        onNavigateStage={onNavigateStage}
        hasNextStage
      />,
    );

    expect(screen.getByRole('heading', { name: 'Upload BizFile' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Enter company manually' })).toHaveAttribute(
      'href',
      '/companies/new?taskId=task-1&taskStageId=stage-company&returnTo=%2Ftasks',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next stage' }));
    expect(onNavigateStage).toHaveBeenCalledWith('next');
  });

  it('honors the Company stage create policy while keeping existing-company linking available', () => {
    const companyAdapter = getStageActionAdapter(TaskStageActionType.COMPANY_PROFILE);
    const makeCompanyStage = (allowCreate: boolean): TaskStageDetail => ({
      ...stageDetail,
      id: 'stage-company',
      actionType: 'COMPANY_PROFILE',
      blockers: [],
      launch: companyAdapter.launch({
        tenantId: 'tenant-1',
        stage: {
          id: 'stage-company',
          tenantId: 'tenant-1',
          taskId: task.id,
          actionType: TaskStageActionType.COMPANY_PROFILE,
          actionConfig: { allowCreate },
          status: 'NOT_STARTED',
          task: { companyId: null },
        },
      }),
    });
    const onTransition = vi.fn();
    const { rerender } = render(
      <TaskStageModal
        isOpen
        stage={makeCompanyStage(false)}
        companies={[task.company!]}
        onClose={vi.fn()}
        onUpdateMetadata={vi.fn()}
        onTransition={onTransition}
      />,
    );

    expect(screen.queryByRole('link', { name: 'Create company' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Create a new company' })).not.toBeInTheDocument();
    searchExistingCompany(task.company!.name);
    fireEvent.click(screen.getByRole('button', { name: 'Link selected company' }));
    expect(onTransition).toHaveBeenCalledWith({
      action: 'linkOutcome',
      outcome: { type: 'COMPANY', companyId: task.company!.id },
    });

    rerender(
      <TaskStageModal
        isOpen
        stage={makeCompanyStage(true)}
        companies={[task.company!]}
        onClose={vi.fn()}
        onUpdateMetadata={vi.fn()}
        onTransition={onTransition}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Clear Existing company' }));
    expect(screen.getByRole('link', { name: 'Enter company manually' })).toHaveAttribute(
      'href',
      '/companies/new?taskId=task-1&taskStageId=stage-company&returnTo=%2Ftasks',
    );
  });

  it('keeps inspection available, shows all detail, and exposes exactly one blocked primary action', () => {
    render(
      <TaskStageModal
        isOpen
        stage={stageDetail}
        onClose={vi.fn()}
        onUpdateMetadata={vi.fn()}
        onTransition={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('In progress')).toBeInTheDocument();
    expect(within(dialog).getByText(stageDetail.description!)).toBeInTheDocument();
    expect(within(dialog).getByText('Sam Chen')).toBeInTheDocument();
    expect(within(dialog).getByText('Confirm company profile')).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue(stageDetail.notes!)).toBeInTheDocument();
    expect(within(dialog).getByText(stageDetail.outcomeSummary!)).toBeInTheDocument();
    expect(within(dialog).getByText(/25 Jul 2026/)).toBeInTheDocument();
    expect(within(dialog).getByText('Add a signing contact to continue')).toBeInTheDocument();
    const primaryActions = within(dialog).getAllByTestId('stage-primary-action');
    expect(primaryActions).toHaveLength(1);
    expect(primaryActions[0]).toBeDisabled();
  });

  it('launches an existing workspace with task context and a /tasks return URL', () => {
    const readyStage = { ...stageDetail, blockers: [] };
    render(
      <TaskStageModal
        isOpen
        stage={readyStage}
        onClose={vi.fn()}
        onUpdateMetadata={vi.fn()}
        onTransition={vi.fn()}
      />,
    );

    expect(screen.getByTestId('stage-primary-action')).toHaveAttribute(
      'href',
      '/generated-documents/generate?taskId=task-1&taskStageId=stage-2&returnTo=%2Ftasks',
    );
  });

  it('selects all or individual finalized task documents before opening E-signing', () => {
    const signingStage: TaskStageDetail = {
      ...stageDetail,
      id: 'stage-signing',
      name: 'E-signing',
      position: 2,
      actionType: 'ESIGNING',
      status: 'NOT_STARTED',
      outcome: null,
      blockers: [],
      launch: {
        href: '/esigning',
        context: { taskId: task.id, taskStageId: 'stage-signing', returnTo: '/tasks' },
      },
    };
    const documentStage = {
      id: 'stage-documents',
      name: 'Generated documents',
      position: 1,
      status: 'COMPLETED' as const,
      description: null,
      notes: null,
      startedAt: null,
      completedAt: null,
      assignee: null,
      checklist: [],
      blockers: [],
      actionType: 'DOCUMENT_GENERATION' as const,
      resources: [
        {
          kind: 'generatedDocument' as const,
          id: 'doc-1',
          state: 'available' as const,
          label: 'Generated document',
          title: 'Service Agreement',
          status: 'FINALIZED',
          href: '/generated-documents/doc-1',
          reason: null,
        },
        {
          kind: 'generatedDocument' as const,
          id: 'doc-2',
          state: 'available' as const,
          label: 'Generated document',
          title: 'Privacy Notice',
          status: 'FINALIZED',
          href: '/generated-documents/doc-2',
          reason: null,
        },
      ],
    };
    const signingResourceStage = {
      id: signingStage.id,
      name: signingStage.name,
      position: signingStage.position,
      actionType: signingStage.actionType,
      status: signingStage.status,
      description: signingStage.description,
      notes: signingStage.notes,
      startedAt: signingStage.startedAt,
      completedAt: signingStage.completedAt,
      assignee: null,
      checklist: [],
      blockers: [],
      resources: [],
    };
    const taskResources: TaskResourcesResponse = {
      task: {
        id: task.id,
        title: task.title,
        status: task.status,
        dueDate: task.dueDate,
        company: null,
        owner: null,
        pipelineName: task.pipelineVersion.pipeline.name,
      },
      stages: [documentStage, signingResourceStage],
      hasPendingResources: false,
    };

    render(
      <TaskStageModal
        isOpen
        stage={signingStage}
        resources={taskResources}
        taskDueDate={task.dueDate}
        onClose={vi.fn()}
        onUpdateMetadata={vi.fn()}
        onTransition={vi.fn()}
      />,
    );

    const selectAll = screen.getByRole('checkbox', { name: 'Select all documents' });
    const firstDocument = screen.getByRole('checkbox', { name: 'Select Service Agreement' });
    const secondDocument = screen.getByRole('checkbox', { name: 'Select Privacy Notice' });
    expect(selectAll).toBeChecked();
    expect(firstDocument).toBeChecked();
    expect(secondDocument).toBeChecked();
    expect(screen.getByTestId('stage-primary-action')).toHaveAttribute(
      'href',
      expect.stringContaining('generatedDocumentIds=doc-1'),
    );

    fireEvent.click(secondDocument);
    expect(firstDocument).toBeChecked();
    expect(secondDocument).not.toBeChecked();
    expect(screen.getByTestId('stage-primary-action')).not.toHaveAttribute(
      'href',
      expect.stringContaining('generatedDocumentIds=doc-2'),
    );

    fireEvent.click(selectAll);
    expect(firstDocument).toBeChecked();
    expect(secondDocument).toBeChecked();
    fireEvent.click(selectAll);
    expect(screen.getByTestId('stage-primary-action')).toBeDisabled();
    fireEvent.click(selectAll);
    expect(firstDocument).toBeChecked();
    expect(secondDocument).toBeChecked();
  });

  it('shows document checkboxes for a linked draft signing request', () => {
    const signingStage: TaskStageDetail = {
      ...stageDetail,
      id: 'stage-signing',
      name: 'E-signing',
      position: 2,
      actionType: 'ESIGNING',
      status: 'IN_PROGRESS',
      outcome: {
        id: 'outcome-signing',
        type: 'ESIGNING_ENVELOPE',
        companyId: null,
        generatedDocumentId: null,
        esigningEnvelopeId: 'envelope-1',
      },
      blockers: [],
      launch: {
        href: '/esigning/envelope-1',
        context: { taskId: task.id, taskStageId: 'stage-signing', returnTo: '/tasks' },
      },
    };
    const documentStage = {
      id: 'stage-documents',
      name: 'Generated documents',
      position: 1,
      status: 'COMPLETED' as const,
      description: null,
      notes: null,
      startedAt: null,
      completedAt: null,
      assignee: null,
      checklist: [],
      blockers: [],
      actionType: 'DOCUMENT_GENERATION' as const,
      resources: [
        {
          kind: 'generatedDocument' as const,
          id: 'doc-1',
          state: 'available' as const,
          label: 'Generated document',
          title: 'Service Agreement',
          status: 'FINALIZED',
          href: '/generated-documents/doc-1',
          reason: null,
        },
        {
          kind: 'generatedDocument' as const,
          id: 'doc-2',
          state: 'available' as const,
          label: 'Generated document',
          title: 'Privacy Notice',
          status: 'FINALIZED',
          href: '/generated-documents/doc-2',
          reason: null,
        },
      ],
    };
    const signingResourceStage = {
      id: signingStage.id,
      name: signingStage.name,
      position: signingStage.position,
      actionType: signingStage.actionType,
      status: signingStage.status,
      description: signingStage.description,
      notes: signingStage.notes,
      startedAt: signingStage.startedAt,
      completedAt: signingStage.completedAt,
      assignee: null,
      checklist: [],
      blockers: [],
      resources: [{
        kind: 'esigningEnvelope' as const,
        id: 'envelope-1',
        state: 'available' as const,
        label: 'Signing request',
        title: 'Service Agreement',
        status: 'DRAFT',
        pdfGenerationStatus: null,
        expiresAt: null,
        completedSignatures: 0,
        requiredSignatures: 0,
        href: '/esigning/envelope-1',
        canGenerateSignerLink: false,
        generatedDocumentIds: ['doc-1'],
        documents: [{
          id: 'envelope-document-1',
          fileName: 'service-agreement.pdf',
          originalPdfHref: '/api/esigning/envelopes/envelope-1/documents/envelope-document-1/pdf',
          signedPdfHref: null,
        }],
        signers: [],
        reason: null,
      }],
    };
    const taskResources: TaskResourcesResponse = {
      task: {
        id: task.id,
        title: task.title,
        status: task.status,
        dueDate: task.dueDate,
        company: null,
        owner: null,
        pipelineName: task.pipelineVersion.pipeline.name,
      },
      stages: [documentStage, signingResourceStage],
      hasPendingResources: false,
    };

    render(
      <TaskStageModal
        isOpen
        stage={signingStage}
        resources={taskResources}
        taskDueDate={task.dueDate}
        onClose={vi.fn()}
        onUpdateMetadata={vi.fn()}
        onTransition={vi.fn()}
      />,
    );

    expect(screen.getByTestId('esigning-document-selection')).toBeVisible();
    expect(screen.getByRole('checkbox', { name: 'Select Service Agreement' })).toBeChecked();
    const secondDocument = screen.getByRole('checkbox', { name: 'Select Privacy Notice' });
    expect(secondDocument).not.toBeChecked();

    fireEvent.click(secondDocument);

    expect(secondDocument).toBeChecked();
  });

  it(
    'keeps the authoritative integrated workspace action for a completed stage',
    () => {
      const onTransition = vi.fn();
      render(
        <TaskStageModal
          isOpen
          stage={{ ...stageDetail, status: 'COMPLETED', blockers: [] }}
          onClose={vi.fn()}
          onUpdateMetadata={vi.fn()}
          onTransition={onTransition}
        />,
      );

      const primaryActions = screen.getAllByTestId('stage-primary-action');
      expect(primaryActions).toHaveLength(1);
      expect(primaryActions[0]).toHaveTextContent('Open document generator');
      expect(primaryActions[0]).toHaveAttribute(
        'href',
        '/generated-documents/generate?taskId=task-1&taskStageId=stage-2&returnTo=%2Ftasks',
      );
      expect(screen.queryByRole('button', { name: 'Reopen stage' })).not.toBeInTheDocument();
      expect(onTransition).not.toHaveBeenCalled();
    },
  );

  it('reopens a skipped integrated stage before reconciliation resumes', () => {
    const onTransition = vi.fn();
    render(
      <TaskStageModal
        isOpen
        stage={{ ...stageDetail, status: 'SKIPPED', blockers: [] }}
        onClose={vi.fn()}
        onUpdateMetadata={vi.fn()}
        onTransition={onTransition}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Reopen stage' }));
    expect(onTransition).toHaveBeenCalledWith({ action: 'reopen' });
    expect(screen.getAllByTestId('stage-primary-action')).toHaveLength(1);
  });

  it('keeps a blocked integrated terminal stage inspectable with one disabled workspace action', () => {
    render(
      <TaskStageModal
        isOpen
        stage={{ ...stageDetail, status: 'COMPLETED' }}
        onClose={vi.fn()}
        onUpdateMetadata={vi.fn()}
        onTransition={vi.fn()}
      />,
    );

    const primaryActions = screen.getAllByTestId('stage-primary-action');
    expect(primaryActions).toHaveLength(1);
    expect(primaryActions[0]).toHaveTextContent('Open document generator');
    expect(primaryActions[0]).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Reopen stage' })).not.toBeInTheDocument();
  });

  it('still reopens a completed manual stage', () => {
    const onTransition = vi.fn().mockResolvedValue(undefined);
    render(
      <TaskStageModal
        isOpen
        stage={{
          ...stageDetail,
          actionType: 'MANUAL',
          status: 'COMPLETED',
          blockers: [],
          launch: { href: null, context: stageDetail.launch.context },
        }}
        onClose={vi.fn()}
        onUpdateMetadata={vi.fn()}
        onTransition={onTransition}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Reopen stage' }));
    expect(onTransition).toHaveBeenCalledWith({ action: 'reopen' });
  });

  it('requires a reason to skip optional stages and never offers skip for required stages', () => {
    const onTransition = vi.fn();
    const optionalStage = {
      ...stageDetail,
      actionType: 'MANUAL' as const,
      isRequired: false,
      launch: { href: null, context: stageDetail.launch.context },
      blockers: [],
    };
    const { rerender } = render(
      <TaskStageModal
        isOpen
        stage={optionalStage}
        onClose={vi.fn()}
        onUpdateMetadata={vi.fn()}
        onTransition={onTransition}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Skip stage' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm skip' }));
    expect(screen.getByText('Skip reason is required')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Skip reason' }), { target: { value: 'Not needed for this engagement' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm skip' }));
    expect(onTransition).toHaveBeenCalledWith({
      action: 'skip',
      reason: 'Not needed for this engagement',
    });

    rerender(
      <TaskStageModal
        isOpen
        stage={stageDetail}
        onClose={vi.fn()}
        onUpdateMetadata={vi.fn()}
        onTransition={onTransition}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Skip stage' })).not.toBeInTheDocument();
  });
});
