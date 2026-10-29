import { Suspense } from 'react';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PipelinesPage from '@/app/(dashboard)/pipelines/page';
import NewPipelinePage from '@/app/(dashboard)/pipelines/new/page';
import EditPipelinePage from '@/app/(dashboard)/pipelines/[id]/page';

const listWorkspace = vi.fn((_: unknown) => <div>Pipeline list workspace</div>);
const newWorkspace = vi.fn((_: unknown) => <div>New pipeline workspace</div>);
const editWorkspace = vi.fn((_: unknown) => <div>Edit pipeline workspace</div>);

vi.mock('@/components/tasks/pipelines/pipeline-workspace', () => ({
  PipelinesListWorkspace: (props: unknown) => listWorkspace(props),
  NewPipelineWorkspace: (props: unknown) => newWorkspace(props),
  EditPipelineWorkspace: (props: unknown) => editWorkspace(props),
}));

describe('pipeline routes', () => {
  it('renders the list and new builder workspaces', () => {
    render(<PipelinesPage />);
    expect(screen.getByText('Pipeline list workspace')).toBeInTheDocument();
    expect(listWorkspace).toHaveBeenCalledOnce();

    render(<NewPipelinePage />);
    expect(screen.getByText('New pipeline workspace')).toBeInTheDocument();
    expect(newWorkspace).toHaveBeenCalledOnce();
  });

  it('renders the edit workspace for the selected pipeline id', async () => {
    await act(async () => {
      render(
        <Suspense fallback={<div>Loading route</div>}>
          <EditPipelinePage params={Promise.resolve({ id: 'pipeline-123' })} />
        </Suspense>
      );
    });

    expect(screen.getByText('Edit pipeline workspace')).toBeInTheDocument();
    expect(editWorkspace).toHaveBeenCalledWith(expect.objectContaining({ pipelineId: 'pipeline-123' }));
  });
});
