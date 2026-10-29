import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PipelineBuilder, pipelineToDraft } from '@/components/tasks/pipelines/pipeline-builder';
import { PipelineList } from '@/components/tasks/pipelines/pipeline-list';
import {
  EditPipelineWorkspace,
  NewPipelineWorkspace,
  PipelinesListWorkspace,
} from '@/components/tasks/pipelines/pipeline-workspace';
import type { TaskPipeline } from '@/hooks/use-task-pipelines';

const hookMocks = vi.hoisted(() => ({
  archive: vi.fn(),
  create: vi.fn(),
  duplicate: vi.fn(),
  update: vi.fn(),
  useArchiveTaskPipeline: vi.fn(),
  useCreateTaskPipeline: vi.fn(),
  useDuplicateTaskPipeline: vi.fn(),
  useTaskPipeline: vi.fn(),
  useTaskPipelines: vi.fn(),
  useUpdateTaskPipeline: vi.fn(),
}));

vi.mock('@/hooks/use-task-pipelines', () => ({
  useArchiveTaskPipeline: hookMocks.useArchiveTaskPipeline,
  useCreateTaskPipeline: hookMocks.useCreateTaskPipeline,
  useDuplicateTaskPipeline: hookMocks.useDuplicateTaskPipeline,
  useTaskPipeline: hookMocks.useTaskPipeline,
  useTaskPipelines: hookMocks.useTaskPipelines,
  useUpdateTaskPipeline: hookMocks.useUpdateTaskPipeline,
}));

const pipeline: TaskPipeline = {
  id: 'pipeline-1', name: 'Annual review', description: 'Annual statutory review',
  createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z', deletedAt: null,
  versions: [{ id: 'version-1', version: 2, publishedAt: '2026-07-01T00:00:00.000Z', stages: [{
    id: 'stage-1', name: 'Prepare documents', description: null, position: 0,
    actionType: 'DOCUMENT_GENERATION', icon: 'FileText', isRequired: true,
    actionConfig: { checklistItems: [{ label: 'Verify records', position: 0 }], templateId: '11111111-1111-4111-8111-111111111111' },
  }] }],
};

function useMutationMock(execute: (variables: unknown) => Promise<unknown>) {
  const [error, setError] = useState<Error | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [variables, setVariables] = useState<unknown>();
  const mutateAsync = async (nextVariables: unknown) => {
    setVariables(nextVariables);
    setIsPending(true);
    setError(null);
    try {
      return await execute(nextVariables);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError : new Error('Request failed'));
      throw nextError;
    } finally {
      setIsPending(false);
    }
  };
  return {
    error,
    isPending,
    mutate: (nextVariables: unknown) => {
      void mutateAsync(nextVariables).catch(() => undefined);
    },
    mutateAsync,
    reset: () => setError(null),
    variables,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  hookMocks.useTaskPipelines.mockReturnValue({
    data: [pipeline],
    error: null,
    isLoading: false,
  });
  hookMocks.useTaskPipeline.mockReturnValue({
    data: pipeline,
    error: null,
    isLoading: false,
  });
  hookMocks.archive.mockResolvedValue({});
  hookMocks.create.mockResolvedValue(pipeline);
  hookMocks.duplicate.mockResolvedValue(pipeline);
  hookMocks.update.mockResolvedValue(pipeline);
  hookMocks.useArchiveTaskPipeline.mockImplementation(() => useMutationMock((variables) => hookMocks.archive(variables)));
  hookMocks.useCreateTaskPipeline.mockImplementation(() => useMutationMock((variables) => hookMocks.create(variables)));
  hookMocks.useDuplicateTaskPipeline.mockImplementation(() => useMutationMock((variables) => hookMocks.duplicate(variables)));
  hookMocks.useUpdateTaskPipeline.mockImplementation(() => useMutationMock((variables) => hookMocks.update(variables)));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    json: async () => [],
    ok: true,
  }));
});

describe('PipelineList', () => {
  it('offers create, edit, duplicate, and archive actions', () => {
    const onCreate = vi.fn(); const onEdit = vi.fn(); const onDuplicate = vi.fn(); const onArchive = vi.fn();
    render(<PipelineList pipelines={[pipeline]} onCreate={onCreate} onEdit={onEdit} onDuplicate={onDuplicate} onArchive={onArchive} />);
    fireEvent.click(screen.getByRole('button', { name: 'Create pipeline' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Annual review' }));
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate Annual review' }));
    fireEvent.click(screen.getByRole('button', { name: 'Archive Annual review' }));
    expect(onCreate).toHaveBeenCalledOnce(); expect(onEdit).toHaveBeenCalledWith(pipeline);
    expect(onDuplicate).toHaveBeenCalledWith(pipeline); expect(onArchive).toHaveBeenCalledWith(pipeline);
  });
});

describe('PipelineBuilder', () => {
  it('edits required state, checklist, icon search, and document-template configuration', () => {
    const onSave = vi.fn();
    render(<PipelineBuilder initialDraft={pipelineToDraft(pipeline)} templates={[{ id: '11111111-1111-4111-8111-111111111111', name: 'Annual return' }, { id: '33333333-3333-4333-8333-333333333333', name: 'Board resolution' }]} onCancel={vi.fn()} onSave={onSave} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Required stage' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add checklist item' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Checklist item 2' }), { target: { value: 'Confirm template' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Search icons' }), { target: { value: 'mail' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mail' })); fireEvent.click(screen.getByRole('button', { name: 'Save pipeline' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ stages: [expect.objectContaining({
      isRequired: false, icon: 'Mail', actionConfig: expect.objectContaining({ templateIds: ['11111111-1111-4111-8111-111111111111'] }),
      checklistItems: expect.arrayContaining([expect.objectContaining({ label: 'Verify records' })]),
    })] }));
  });

  it('supports selecting multiple document templates for one stage', () => {
    const onSave = vi.fn();
    render(<PipelineBuilder initialDraft={{ name: 'Pipeline', description: '', stages: [{
      id: 'documents-stage', name: 'Prepare documents', description: '', actionType: 'DOCUMENT_GENERATION', icon: 'FileText', isRequired: true, actionConfig: {}, checklistItems: [],
    }] }} templates={[{ id: '11111111-1111-4111-8111-111111111111', name: 'Annual return' }, { id: '33333333-3333-4333-8333-333333333333', name: 'Board resolution' }]} onCancel={vi.fn()} onSave={onSave} />);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Annual return' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Board resolution' }));
    expect(screen.getByText('2 of 20 templates selected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save pipeline' }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      stages: [expect.objectContaining({
        actionConfig: { templateIds: [
          '11111111-1111-4111-8111-111111111111',
          '33333333-3333-4333-8333-333333333333',
        ] },
      })],
    }));
  });

  it('supports stage and checklist add, edit, and remove operations', () => {
    const onSave = vi.fn();
    render(<PipelineBuilder initialDraft={pipelineToDraft(pipeline)} templates={[]} onCancel={vi.fn()} onSave={onSave} />);

    fireEvent.change(screen.getByRole('textbox', { name: 'Stage name' }), { target: { value: 'Review records' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add checklist item' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Checklist item 2' }), { target: { value: 'Confirm records' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove checklist item' })[0]);
    expect(screen.queryByDisplayValue('Verify records')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add stage' }));
    expect(screen.getAllByRole('article')).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove stage' })[1]);
    expect(screen.getAllByRole('article')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Save pipeline' }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      stages: [expect.objectContaining({
        checklistItems: [{ label: 'Confirm records', position: 0 }],
        name: 'Review records',
      })],
    }));
  });

  it('validates a full definition', () => {
    const onSave = vi.fn();
    render(<PipelineBuilder initialDraft={{ name: '', description: '', stages: [] }} templates={[]} onCancel={vi.fn()} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save pipeline' }));
    expect(screen.getByText('Pipeline name is required')).toBeInTheDocument();
    expect(screen.getByText('Add at least one stage')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('reorders stages through the actual keyboard sensor and drag-end handler', async () => {
    const onSave = vi.fn();
    render(<PipelineBuilder initialDraft={{ name: 'Pipeline', description: '', stages: [
      { id: 'stage-1', name: 'Stage 1', description: '', actionType: 'MANUAL', icon: 'CircleCheckBig', isRequired: true, actionConfig: {}, checklistItems: [] },
      { id: 'stage-2', name: 'Stage 2', description: '', actionType: 'MANUAL', icon: 'CircleCheckBig', isRequired: true, actionConfig: {}, checklistItems: [] },
    ] }} templates={[]} onCancel={vi.fn()} onSave={onSave} />);
    screen.getAllByRole('article').forEach((stage, index) => {
      vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue({ bottom: (index + 1) * 100, height: 100, left: 0, right: 600, top: index * 100, width: 600, x: 0, y: index * 100, toJSON: () => ({}) } as DOMRect);
    });
    const dragHandle = screen.getAllByRole('button', { name: 'Drag stage' })[1];
    fireEvent.focus(dragHandle);
    fireEvent.keyDown(dragHandle, { key: ' ', code: 'Space' });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    fireEvent.keyDown(document, { key: 'ArrowUp', code: 'ArrowUp' });
    fireEvent.keyDown(document, { key: ' ', code: 'Space' });
    await waitFor(() => expect(screen.getAllByTestId('pipeline-stage-name').map((node) => node.textContent)).toEqual(['Stage 2', 'Stage 1']));
    fireEvent.click(screen.getByRole('button', { name: 'Save pipeline' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      stages: [
        expect.objectContaining({ name: 'Stage 2', position: 0 }),
        expect.objectContaining({ name: 'Stage 1', position: 1 }),
      ],
    }));
  });

  it('edits every action adapter configuration and saves API-valid config', () => {
    const onSave = vi.fn();
    render(<PipelineBuilder initialDraft={{ name: 'Pipeline', description: 'Description', stages: [{
      id: 'adapter-stage', name: 'Start', description: 'Stage description', actionType: 'MANUAL', icon: 'CircleCheckBig', isRequired: true, actionConfig: {}, checklistItems: [],
    }] }} templates={[{ id: '11111111-1111-4111-8111-111111111111', name: 'Annual return' }]} onCancel={vi.fn()} onSave={onSave} />);

    fireEvent.click(screen.getByRole('button', { name: 'Save pipeline' }));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({
      stages: [expect.objectContaining({ actionType: 'MANUAL', actionConfig: {} })],
    }));
    onSave.mockClear();
    fireEvent.change(screen.getByRole('combobox', { name: 'Action type' }), { target: { value: 'COMPANY_PROFILE' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Allow creating a company' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save pipeline' }));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({
      stages: [expect.objectContaining({ actionType: 'COMPANY_PROFILE', actionConfig: { allowCreate: true } })],
    }));
    onSave.mockClear();
    fireEvent.change(screen.getByRole('combobox', { name: 'Action type' }), { target: { value: 'DOCUMENT_GENERATION' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Annual return' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save pipeline' }));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({
      stages: [expect.objectContaining({
        actionType: 'DOCUMENT_GENERATION',
        actionConfig: { templateIds: ['11111111-1111-4111-8111-111111111111'] },
      })],
    }));
    onSave.mockClear();
    fireEvent.change(screen.getByRole('combobox', { name: 'Action type' }), { target: { value: 'ESIGNING' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Signing order' }), { target: { value: 'SEQUENTIAL' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Expires in days' }), { target: { value: '14' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add checklist item' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Checklist item 1' }), { target: { value: 'Review signing pack' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save pipeline' }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ stages: [expect.objectContaining({
      actionType: 'ESIGNING',
      actionConfig: { signingOrder: 'SEQUENTIAL', expiresInDays: 14 },
      checklistItems: [{ label: 'Review signing pack', position: 0 }],
    })] }));
  });

  it('restores action-specific configuration when a stage action is changed back', () => {
    const onSave = vi.fn();
    render(<PipelineBuilder initialDraft={{ name: 'Pipeline', description: 'Description', stages: [{
      id: 'restore-stage', name: 'Start', description: '', actionType: 'DOCUMENT_GENERATION', icon: 'FileText', isRequired: true, actionConfig: { templateIds: ['11111111-1111-4111-8111-111111111111'] }, checklistItems: [],
    }] }} templates={[{ id: '11111111-1111-4111-8111-111111111111', name: 'Annual return' }]} onCancel={vi.fn()} onSave={onSave} />);

    fireEvent.change(screen.getByRole('combobox', { name: 'Action type' }), { target: { value: 'COMPANY_PROFILE' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Allow creating a company' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Action type' }), { target: { value: 'DOCUMENT_GENERATION' } });
    expect(screen.getByRole('checkbox', { name: 'Annual return' })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Save pipeline' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ stages: [expect.objectContaining({
      actionConfig: { templateIds: ['11111111-1111-4111-8111-111111111111'] },
    })] }));
  });

  it('maps schema-sized field validation failures to useful messages', () => {
    const onSave = vi.fn();
    render(<PipelineBuilder initialDraft={{ name: 'x'.repeat(201), description: 'x'.repeat(2001), stages: [{
      id: 'invalid-stage', name: ' ', description: 'x'.repeat(2001), actionType: 'ESIGNING', icon: '', isRequired: true,
      actionConfig: { signingOrder: 'PARALLEL', expiresInDays: 0 }, checklistItems: [{ label: ' ', position: 0 }],
    }, {
      id: 'invalid-document-stage', name: 'Documents', description: '', actionType: 'DOCUMENT_GENERATION', icon: 'x'.repeat(101), isRequired: true,
      actionConfig: { templateId: 42 }, checklistItems: [{ label: 'x'.repeat(301), position: 0 }],
    }, {
      id: 'invalid-company-stage', name: 'Company', description: '', actionType: 'COMPANY_PROFILE', icon: 'Building2', isRequired: true,
      actionConfig: { allowCreate: 'yes' }, checklistItems: [],
    }] }} templates={[]} onCancel={vi.fn()} onSave={onSave} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Pipeline name' }), { target: { value: 'x'.repeat(201) } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Pipeline description' }), { target: { value: 'x'.repeat(2001) } });
    fireEvent.click(screen.getByRole('button', { name: 'Save pipeline' }));
    expect(screen.getByText('Pipeline name must be 200 characters or fewer')).toBeInTheDocument();
    expect(screen.getByText('Pipeline description must be 2000 characters or fewer')).toBeInTheDocument();
    expect(screen.getByText('Stage 1 name is required')).toBeInTheDocument();
    expect(screen.getByText('Stage 1 description must be 2000 characters or fewer')).toBeInTheDocument();
    expect(screen.getByText('Stage 1 icon must use a curated option')).toBeInTheDocument();
    expect(screen.getByText('Stage 1 checklist item 1 is required')).toBeInTheDocument();
    expect(screen.getByText('Stage 1 expiry must be a whole number of days')).toBeInTheDocument();
    expect(screen.getByText('Stage 2 icon must use a curated option')).toBeInTheDocument();
    expect(screen.getByText('Stage 2 checklist item 1 must be 300 characters or fewer')).toBeInTheDocument();
    expect(screen.getByText('Stage 2 templates must be valid document templates (up to 20)')).toBeInTheDocument();
    expect(screen.getByText('Stage 3 allow-create setting must be true or false')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe('PipelinesListWorkspace', () => {
  it('renders loading, query-error, and empty states', () => {
    hookMocks.useTaskPipelines.mockReturnValueOnce({ data: [], error: null, isLoading: true });
    const { rerender } = render(<PipelinesListWorkspace onCreate={vi.fn()} onEdit={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading pipelines');

    hookMocks.useTaskPipelines.mockReturnValueOnce({ data: [], error: new Error('Could not load pipelines'), isLoading: false });
    rerender(<PipelinesListWorkspace onCreate={vi.fn()} onEdit={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load pipelines');

    hookMocks.useTaskPipelines.mockReturnValueOnce({ data: [], error: null, isLoading: false });
    rerender(<PipelinesListWorkspace onCreate={vi.fn()} onEdit={vi.fn()} />);
    expect(screen.getByText('No pipelines yet')).toBeInTheDocument();
  });

  it('duplicates a pipeline and surfaces a recoverable failure', async () => {
    hookMocks.duplicate.mockRejectedValueOnce(new Error('Duplicate failed'));
    render(<PipelinesListWorkspace onCreate={vi.fn()} onEdit={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate Annual review' }));
    await waitFor(() => expect(hookMocks.duplicate).toHaveBeenCalledWith({ id: pipeline.id }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Duplicate failed');
    expect(screen.getByRole('button', { name: 'Dismiss alert' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Duplicate Annual review' })).toBeEnabled();
  });

  it('duplicates a pipeline successfully', async () => {
    render(<PipelinesListWorkspace onCreate={vi.fn()} onEdit={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate Annual review' }));
    await waitFor(() => expect(hookMocks.duplicate).toHaveBeenCalledWith({ id: pipeline.id }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('archives successfully and closes the dialog', async () => {
    render(<PipelinesListWorkspace onCreate={vi.fn()} onEdit={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Archive Annual review' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Reason' }), { target: { value: 'No longer used' } });
    fireEvent.click(screen.getByRole('button', { name: 'Archive pipeline' }));
    await waitFor(() => expect(hookMocks.archive).toHaveBeenCalledWith({ id: pipeline.id, reason: 'No longer used' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('keeps archive failure recoverable in the open dialog', async () => {
    hookMocks.archive.mockRejectedValueOnce(new Error('Archive failed'));
    render(<PipelinesListWorkspace onCreate={vi.fn()} onEdit={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Archive Annual review' }));
    const dialog = screen.getByRole('dialog');
    const reason = within(dialog).getByRole('textbox', { name: 'Reason' });
    fireEvent.change(reason, { target: { value: 'No longer used' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Archive pipeline' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Archive failed');
    expect(reason).toHaveValue('No longer used');
    expect(within(dialog).getByRole('button', { name: 'Archive pipeline' })).toBeEnabled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Archive pipeline' }));
    await waitFor(() => expect(hookMocks.archive).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

describe('Pipeline create and edit workspaces', () => {
  it('creates a pipeline and calls onSaved only after success', async () => {
    const onSaved = vi.fn();
    render(<NewPipelineWorkspace onSaved={onSaved} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Pipeline name' }), { target: { value: 'New pipeline' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add stage' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save pipeline' }));
    await waitFor(() => expect(hookMocks.create).toHaveBeenCalled());
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  });

  it('surfaces create failure without navigating away', async () => {
    hookMocks.create.mockRejectedValueOnce(new Error('Create failed'));
    const onSaved = vi.fn();
    render(<NewPipelineWorkspace onSaved={onSaved} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Pipeline name' }), { target: { value: 'New pipeline' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add stage' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save pipeline' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Create failed');
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('renders edit loading and error states', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));
    hookMocks.useTaskPipeline.mockReturnValueOnce({ data: undefined, error: null, isLoading: true });
    const { rerender } = render(<EditPipelineWorkspace pipelineId={pipeline.id} onSaved={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading pipeline');
    hookMocks.useTaskPipeline.mockReturnValueOnce({ data: undefined, error: new Error('Could not load pipeline'), isLoading: false });
    rerender(<EditPipelineWorkspace pipelineId={pipeline.id} onSaved={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load pipeline');
  });

  it('updates a pipeline and calls onSaved only after success', async () => {
    const onSaved = vi.fn();
    render(<EditPipelineWorkspace pipelineId={pipeline.id} onSaved={onSaved} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Pipeline name' }), { target: { value: 'Updated review' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save pipeline' }));
    await waitFor(() => expect(hookMocks.update).toHaveBeenCalledWith(expect.objectContaining({
      id: pipeline.id,
      payload: expect.objectContaining({ name: 'Updated review' }),
    })));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  });

  it('surfaces update failure without navigating away', async () => {
    hookMocks.update.mockRejectedValueOnce(new Error('Update failed'));
    const onSaved = vi.fn();
    render(<EditPipelineWorkspace pipelineId={pipeline.id} onSaved={onSaved} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save pipeline' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Update failed');
    expect(onSaved).not.toHaveBeenCalled();
  });
});
