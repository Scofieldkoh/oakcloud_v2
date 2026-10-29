'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

type PendingNavigation =
  | { type: 'route'; destination: string }
  | { type: 'back' }
  | { type: 'action'; run: () => void };

export interface UnsavedNavigationGuardOptions {
  title?: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

const DEFAULT_DIALOG_COPY = {
  title: 'Unsaved changes',
  description: 'You have unsaved changes. Leave this page without saving them?',
  confirmLabel: 'Leave without saving',
  cancelLabel: 'Stay',
} as const;

export function useUnsavedNavigationGuard(
  isDirty: boolean,
  options: UnsavedNavigationGuardOptions = {},
) {
  const router = useRouter();
  const armedRef = useRef(isDirty);
  const suppressNextPopStateRef = useRef(false);
  const [pendingNavigation, setPendingNavigation] = useState<PendingNavigation | null>(null);

  useEffect(() => {
    armedRef.current = isDirty;
    if (!isDirty) setPendingNavigation(null);
  }, [isDirty]);

  const disarm = useCallback(() => {
    armedRef.current = false;
    setPendingNavigation(null);
  }, []);

  const rearm = useCallback(() => {
    armedRef.current = isDirty;
  }, [isDirty]);

  useEffect(() => {
    if (!isDirty) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!armedRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };

    const handleNavigationClick = (event: MouseEvent) => {
      if (
        !armedRef.current
        || event.defaultPrevented
        || event.button !== 0
        || event.ctrlKey
        || event.metaKey
        || event.shiftKey
        || event.altKey
      ) {
        return;
      }

      const target = event.target;
      const anchor = target instanceof Element
        ? target.closest<HTMLAnchorElement>('a[href]')
        : null;
      if (
        !anchor
        || anchor.hasAttribute('download')
        || (anchor.target && anchor.target.toLowerCase() !== '_self')
      ) {
        return;
      }

      const destination = new URL(anchor.href, window.location.href);
      if (destination.origin !== window.location.origin) return;

      const current = new URL(window.location.href);
      if (
        destination.pathname === current.pathname
        && destination.search === current.search
        && destination.hash === current.hash
      ) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
      event.stopPropagation();
      setPendingNavigation({
        type: 'route',
        destination: `${destination.pathname}${destination.search}${destination.hash}`,
      });
    };

    const handlePopState = () => {
      if (!armedRef.current) return;
      if (suppressNextPopStateRef.current) {
        suppressNextPopStateRef.current = false;
        return;
      }

      suppressNextPopStateRef.current = true;
      window.history.forward();
      setPendingNavigation({ type: 'back' });
    };

    document.addEventListener('click', handleNavigationClick, true);
    window.addEventListener('popstate', handlePopState);
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      document.removeEventListener('click', handleNavigationClick, true);
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      suppressNextPopStateRef.current = false;
    };
  }, [isDirty]);

  const cancelNavigation = useCallback(() => {
    setPendingNavigation(null);
  }, []);

  const confirmNavigation = useCallback(() => {
    const pending = pendingNavigation;
    if (!pending) return;

    armedRef.current = false;
    setPendingNavigation(null);
    if (pending.type === 'route') {
      router.push(pending.destination);
    } else if (pending.type === 'action') {
      pending.run();
    } else {
      window.history.back();
    }
  }, [pendingNavigation, router]);

  const requestNavigation = useCallback((destination: string) => {
    if (!armedRef.current) {
      router.push(destination);
      return;
    }
    setPendingNavigation({ type: 'route', destination });
  }, [router]);

  /** Runs `run` at once when clean, otherwise after the user agrees to discard (for Cancel buttons and shortcuts). */
  const requestAction = useCallback((run: () => void) => {
    if (!armedRef.current) {
      run();
      return;
    }
    setPendingNavigation({ type: 'action', run });
  }, []);

  const dialog = useMemo(() => (
    <ConfirmDialog
      isOpen={pendingNavigation !== null}
      onClose={cancelNavigation}
      onConfirm={confirmNavigation}
      title={options.title ?? DEFAULT_DIALOG_COPY.title}
      description={options.description ?? DEFAULT_DIALOG_COPY.description}
      confirmLabel={options.confirmLabel ?? DEFAULT_DIALOG_COPY.confirmLabel}
      cancelLabel={options.cancelLabel ?? DEFAULT_DIALOG_COPY.cancelLabel}
      variant="warning"
    />
  ), [cancelNavigation, confirmNavigation, options, pendingNavigation]);

  return { disarm, rearm, requestNavigation, requestAction, dialog };
}
