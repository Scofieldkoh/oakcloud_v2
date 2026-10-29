import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/ui/toast';
import ComponentShowcasePage from '@/app/(dashboard)/admin/components/page';

const mocks = vi.hoisted(() => ({ useSession: vi.fn() }));

vi.mock('@/hooks/use-auth', () => ({ useSession: mocks.useSession }));

function renderPage() {
  return render(
    <ToastProvider>
      <ComponentShowcasePage />
    </ToastProvider>,
  );
}

describe('UI Components page', () => {
  beforeEach(() => {
    mocks.useSession.mockReturnValue({ data: { isSuperAdmin: true } });
  });

  it('is limited to super admins', () => {
    mocks.useSession.mockReturnValue({ data: { isSuperAdmin: false } });
    renderPage();
    expect(screen.getByText('You do not have permission to access this page.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Buttons' })).not.toBeInTheDocument();
  });

  it('renders every section with the real shared components', () => {
    renderPage();
    for (const title of ['Buttons', 'Form fields', 'Pickers', 'Feedback', 'Empty states', 'Filters', 'Tables', 'Dialogs and menus', 'Steps and paging']) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    }
    expect(screen.getByRole('table', { name: 'Sample services table' })).toBeInTheDocument();
    expect(screen.getByText('No companies yet')).toBeInTheDocument();
    expect(screen.getByText('No matching companies')).toBeInTheDocument();
  });

  it('switches the sample table to its empty state and clears filter chips', () => {
    renderPage();
    const tables = screen.getByRole('region', { name: 'Tables' });
    fireEvent.click(within(tables).getByRole('switch', { name: 'Show the empty table' }));
    expect(within(tables).getByText('No matching services')).toBeInTheDocument();

    const filters = screen.getByRole('region', { name: 'Filters' });
    fireEvent.click(within(filters).getByRole('button', { name: /Clear all/ }));
    expect(within(filters).getByRole('button', { name: 'Reset example' })).toBeInTheDocument();
  });
});
