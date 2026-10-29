import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const pathnameState = vi.hoisted(() => ({ value: '/companies' }));
const searchParamsState = vi.hoisted(() => ({ value: new URLSearchParams() }));

vi.mock('next/navigation', () => ({
  usePathname: () => pathnameState.value,
  useSearchParams: () => searchParamsState.value,
}));

import { useNavigationProgress } from '@/hooks/use-navigation-progress';

function Harness() {
  const { isNavigating } = useNavigationProgress();
  return (
    <>
      <span data-testid="nav-state">{String(isNavigating)}</span>
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- raw anchor intentionally exercises the hook's click interception */}
      <a href="/contacts" onClick={(e) => e.preventDefault()}>
        Contacts
      </a>
    </>
  );
}

describe('useNavigationProgress', () => {
  beforeEach(() => {
    pathnameState.value = '/companies';
    searchParamsState.value = new URLSearchParams();
    window.history.replaceState({}, '', '/companies');
  });

  it('does not replace the browser history API', () => {
    const pushState = window.history.pushState;
    const replaceState = window.history.replaceState;

    render(<Harness />);

    expect(window.history.pushState).toBe(pushState);
    expect(window.history.replaceState).toBe(replaceState);
  });

  it('starts navigation on an internal link click and stops when the route changes', () => {
    const { rerender } = render(<Harness />);

    fireEvent.click(screen.getByRole('link', { name: 'Contacts' }));
    expect(screen.getByTestId('nav-state')).toHaveTextContent('true');

    pathnameState.value = '/contacts';
    rerender(<Harness />);
    expect(screen.getByTestId('nav-state')).toHaveTextContent('false');
  });

  it('does not start the progress overlay on browser back/forward', () => {
    const { rerender } = render(<Harness />);

    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(screen.getByTestId('nav-state')).toHaveTextContent('false');

    pathnameState.value = '/contacts';
    rerender(<Harness />);
    expect(screen.getByTestId('nav-state')).toHaveTextContent('false');
  });
});
