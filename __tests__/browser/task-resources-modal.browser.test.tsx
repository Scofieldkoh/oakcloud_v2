import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { TaskStageModal } from '@/components/tasks/task-stage-modal';
import type { TaskResourcesResponse, TaskStageDetail } from '@/services/tasks/types';
import '@/app/globals.css';

const stage = {
  id: 'stage-1',
  taskId: 'task-1',
  name: 'Review records',
  position: 1,
  actionType: 'MANUAL',
  icon: 'clipboard-check',
  isRequired: true,
  status: 'IN_PROGRESS',
  description: 'Review the linked company records.',
  notes: null,
  skipReason: null,
  startedAt: '2026-08-29T08:00:00.000Z',
  completedAt: null,
  assigneeId: null,
  assignee: null,
  checklistItems: [],
  outcome: null,
  blockers: [],
  launch: { href: null, context: { taskId: 'task-1', taskStageId: 'stage-1', returnTo: '/tasks' } },
  outcomeSummary: null,
} as TaskStageDetail;

const resources: TaskResourcesResponse = {
  task: {
    id: 'task-1',
    title: 'Annual compliance review',
    status: 'IN_PROGRESS',
    dueDate: null,
    company: { id: 'company-1', name: 'Oakcloud Pte Ltd', uen: '202600001A', href: '/companies/company-1' },
    owner: null,
    pipelineName: 'Annual review',
  },
  stages: [{
    id: 'stage-1',
    name: 'Review records',
    position: 1,
    actionType: 'MANUAL',
    status: 'IN_PROGRESS',
    description: 'Review the linked company records.',
    notes: null,
    startedAt: '2026-08-29T08:00:00.000Z',
    completedAt: null,
    assignee: null,
    checklist: [],
    blockers: [],
    resources: [{
      id: 'company-1',
      kind: 'company',
      state: 'available',
      label: 'Linked company',
      reason: null,
      name: 'Oakcloud Pte Ltd',
      uen: '202600001A',
      href: '/companies/company-1',
    }],
  }],
  hasPendingResources: false,
};

function renderTaskStageModal(onTransition = vi.fn()) {
  render(
    <TaskStageModal
      isOpen
      stage={stage}
      resources={resources}
      onClose={() => undefined}
      onUpdateMetadata={() => undefined}
      onTransition={onTransition}
    />,
  );
  return onTransition;
}

describe('Task resources modal browser surface', () => {
  afterEach(() => cleanup());

  it('keeps the resources panel beside the stage content on desktop and supports the primary action', async () => {
    await page.viewport(1280, 800);
    const onTransition = renderTaskStageModal();

    const main = screen.getByTestId('pipeline-stage-modal-main');
    const panel = screen.getByTestId('task-resources-panel');
    const resourcesAside = screen.getByRole('complementary', { name: 'Task resources' });
    const body = screen.getByTestId('pipeline-stage-modal-body');
    const mainRect = main.getBoundingClientRect();
    const panelRect = resourcesAside.getBoundingClientRect();

    expect(panel).toBeVisible();
    expect(screen.getByRole('dialog').firstElementChild).toHaveClass('sm:max-w-[90vw]');
    expect(body).toHaveClass('lg:grid-cols-[minmax(0,7fr)_minmax(0,3fr)]');
    expect(screen.getByText('202600001A')).toBeVisible();
    expect(panelRect.left).toBeGreaterThanOrEqual(mainRect.right);
    expect(panelRect.width / (mainRect.width + panelRect.width)).toBeCloseTo(0.3, 2);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Complete stage' }));
    expect(onTransition).toHaveBeenCalledWith({ action: 'complete' });
  });

  it('stacks the resources panel below the stage content on mobile', async () => {
    await page.viewport(390, 844);
    renderTaskStageModal();

    const main = screen.getByTestId('pipeline-stage-modal-main');
    const panel = screen.getByTestId('task-resources-panel');

    expect(panel).toBeVisible();
    expect(within(screen.getByTestId('task-resource-stage-stage-1')).getByText('Oakcloud Pte Ltd')).toBeVisible();
    expect(panel.getBoundingClientRect().top).toBeGreaterThanOrEqual(main.getBoundingClientRect().bottom);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  });
});
