import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/tasks/task-workspace', () => ({
  TaskWorkspace: () => <main data-testid="tasks-route-workspace">Tasks workspace</main>,
}));

import TasksPage from '@/app/(dashboard)/tasks/page';

describe('/tasks', () => {
  it('renders the core Tasks workspace', () => {
    render(<TasksPage />);
    expect(screen.getByTestId('tasks-route-workspace')).toHaveTextContent('Tasks workspace');
  });
});
