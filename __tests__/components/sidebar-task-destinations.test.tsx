import { fireEvent, render, screen } from '@testing-library/react';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({
  data: {
    id: 'user-1',
    email: 'user@example.com',
    isSuperAdmin: false,
    isWorkspaceAdmin: false,
  },
}));

const servicesSettings = vi.hoisted(() => ({
  data: { workspaceEnabled: false, deadlineWritesEnabled: false },
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/tasks',
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href, prefetch: _prefetch, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { children: ReactNode; href: string; prefetch?: boolean }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock('next/image', () => ({
  default: () => null,
}));

vi.mock('@/hooks/use-auth', () => ({
  useSession: () => authState,
  useLogout: () => ({ mutate: vi.fn() }),
}));

vi.mock('@/hooks/use-services-workspace-settings', () => ({
  useServicesWorkspaceSettings: () => servicesSettings,
}));

vi.mock('@/components/ui/company-selector', () => ({
  SidebarCompanyButton: () => null,
}));

vi.mock('@/components/ui/dropdown', () => ({
  Dropdown: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownLabel: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownItem: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownSeparator: () => null,
}));

import { Sidebar } from '@/components/ui/sidebar';
import { useUIStore } from '@/stores/ui-store';

describe('Sidebar task workspace destinations', () => {
  beforeEach(() => {
    authState.data.isSuperAdmin = false;
    authState.data.isWorkspaceAdmin = false;
    servicesSettings.data.workspaceEnabled = false;
    window.matchMedia = vi.fn().mockImplementation(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    useUIStore.setState({ sidebarCollapsed: false, sidebarMobileOpen: false, theme: 'light' });
  });

  it('exposes Tasks without Pipelines or legacy workflow links', () => {
    render(<Sidebar />);

    const menu = screen.getByRole('navigation', { name: 'Main menu' });
    expect(menu).toContainElement(screen.getByRole('link', { name: 'Tasks' }));
    expect(screen.getByRole('link', { name: 'Tasks' })).toHaveAttribute('href', '/tasks');
    expect(screen.queryByRole('link', { name: 'Pipelines' })).not.toBeInTheDocument();
    expect(screen.queryByText('Workflow')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Projects' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Templates' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Services' })).not.toBeInTheDocument();
  });

  it('exposes the Services pages as an Administration sub-menu to workspace administrators', () => {
    authState.data.isWorkspaceAdmin = true;

    render(<Sidebar />);

    const servicesGroup = screen.getByRole('button', { name: 'Services' });
    expect(screen.getByRole('navigation', { name: 'Main menu' })).toContainElement(servicesGroup);
    expect(servicesGroup).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(servicesGroup);

    expect(screen.getByRole('link', { name: 'Service Catalog' })).toHaveAttribute('href', '/admin/services/catalog');
    expect(screen.getByRole('link', { name: 'Deadline Rules' })).toHaveAttribute('href', '/admin/services/deadline-rules');
    expect(screen.getByRole('link', { name: 'Business Calendar' })).toHaveAttribute('href', '/admin/services/business-calendar');
  });

  it('exposes the operational Services destination only when the workspace enables it', () => {
    servicesSettings.data.workspaceEnabled = true;

    render(<Sidebar />);

    expect(screen.getByRole('link', { name: 'Services' })).toHaveAttribute('href', '/services');
  });

  it('keeps operational destinations together in the requested order before Document Vault', () => {
    servicesSettings.data.workspaceEnabled = true;

    render(<Sidebar />);

    const menu = screen.getByRole('navigation', { name: 'Main menu' });
    const links = [...menu.querySelectorAll('a')].map((link) => link.textContent?.trim());
    expect(links).toEqual(expect.arrayContaining(['Tasks', 'Services', 'Deadlines', 'Billing', 'Document Vault']));
    const requestedOrder = ['Tasks', 'Services', 'Deadlines', 'Billing', 'Document Vault'];
    const indexes = requestedOrder.map((name) => links.indexOf(name));
    expect(indexes).toEqual([...indexes].sort((left, right) => left - right));
    expect(screen.getByRole('link', { name: 'Deadlines' })).toHaveAttribute('href', '/deadlines');
    expect(screen.getByRole('link', { name: 'Billing' })).toHaveAttribute('href', '/billing');
  });
});
