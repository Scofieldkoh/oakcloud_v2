import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Link from 'next/link';

const routerPush = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush }),
}));
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import { useUnsavedNavigationGuard } from '@/hooks/use-unsaved-navigation-guard';

function Harness({ dirty = true, customCopy = false }: { dirty?: boolean; customCopy?: boolean }) {
  const guard = useUnsavedNavigationGuard(dirty, customCopy ? {
    title: 'Leave signing session?',
    description: 'Your signature has not been submitted.',
    confirmLabel: 'Leave signing',
    cancelLabel: 'Continue signing',
  } : undefined);

  return (
    <>
      <Link href="/generated-documents">Documents</Link>
      <button type="button" onClick={guard.disarm}>Disarm</button>
      <button type="button" onClick={() => guard.requestNavigation('/generated-documents')}>
        Programmatic navigation
      </button>
      {guard.dialog}
    </>
  );
}

describe('useUnsavedNavigationGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/generated-documents/generate');
  });

  it('uses beforeunload only while dirty and armed', () => {
    const { rerender } = render(<Harness />);
    const dirtyEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirtyEvent);
    expect(dirtyEvent.defaultPrevented).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Disarm' }));
    const disarmedEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(disarmedEvent);
    expect(disarmedEvent.defaultPrevented).toBe(false);

    rerender(<Harness dirty={false} />);
    const cleanEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(cleanEvent);
    expect(cleanEvent.defaultPrevented).toBe(false);
  });

  it('defers same-origin link navigation until the user confirms', async () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole('link', { name: 'Documents' }));
    expect(screen.getByText('Unsaved changes')).toBeVisible();
    expect(routerPush).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Stay' }));
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('link', { name: 'Documents' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Leave without saving' }));
    });
    expect(routerPush).toHaveBeenCalledWith('/generated-documents');
  });

  it('defers browser back navigation and executes it once after confirmation', async () => {
    const forward = vi.spyOn(window.history, 'forward').mockImplementation(() => undefined);
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    render(<Harness />);

    fireEvent.popState(window);
    expect(forward).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Unsaved changes')).toBeVisible();

    // The browser emits a second popstate when history.forward() restores the guarded page.
    fireEvent.popState(window);

    fireEvent.click(screen.getByRole('button', { name: 'Stay' }));
    expect(back).not.toHaveBeenCalled();

    fireEvent.popState(window);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Leave without saving' }));
    });
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('defers programmatic navigation until the user confirms', async () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: 'Programmatic navigation' }));
    expect(screen.getByText('Unsaved changes')).toBeVisible();
    expect(routerPush).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Stay' }));
    expect(routerPush).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Programmatic navigation' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Leave without saving' }));
    });
    expect(routerPush).toHaveBeenCalledWith('/generated-documents');
  });

  it('navigates immediately from requestNavigation when there are no unsaved changes', () => {
    render(<Harness dirty={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'Programmatic navigation' }));
    expect(routerPush).toHaveBeenCalledWith('/generated-documents');
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
  });

  it('supports page-specific copy for other editing experiences', () => {
    render(<Harness customCopy />);

    fireEvent.click(screen.getByRole('link', { name: 'Documents' }));

    expect(screen.getByText('Leave signing session?')).toBeVisible();
    expect(screen.getByText('Your signature has not been submitted.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Leave signing' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Continue signing' })).toBeVisible();
  });
});
