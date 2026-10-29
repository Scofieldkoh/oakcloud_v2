'use client';

import { useCallback, useEffect, useLayoutEffect, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Shared pieces for the SearchableSelect and AsyncSearchSelect popovers. */

export interface SelectPopoverPosition {
  top: number;
  left: number;
  width: number;
  inputTop: number;
}

const EMPTY_POSITION: SelectPopoverPosition = { top: 0, left: 0, width: 0, inputTop: 0 };

function measure(element: HTMLElement, popoverHeight: number) {
  const rect = element.getBoundingClientRect();
  const top = rect.bottom + 4;
  return {
    position: { top, left: rect.left, width: rect.width, inputTop: rect.top },
    openAbove: top + popoverHeight > window.innerHeight - 16,
  };
}

/**
 * Keeps a portal popover attached to its control: measured before paint on
 * open, flipped above when there is no room below, and re-measured on any
 * scroll or resize while open.
 */
export function useSelectPopoverPosition(anchorRef: RefObject<HTMLElement | null>, isOpen: boolean, popoverHeight: number) {
  const [position, setPosition] = useState<SelectPopoverPosition>(EMPTY_POSITION);
  const [openAbove, setOpenAbove] = useState(false);

  const apply = useCallback(() => {
    if (!anchorRef.current) return;
    const next = measure(anchorRef.current, popoverHeight);
    setPosition(next.position);
    setOpenAbove(next.openAbove);
  }, [anchorRef, popoverHeight]);

  useLayoutEffect(() => {
    if (isOpen) apply();
  }, [apply, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleScrollOrResize = () => requestAnimationFrame(apply);
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);
    return () => {
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [apply, isOpen]);

  return { position, openAbove };
}

/** Vertical placement for a popover from `useSelectPopoverPosition`. */
export function selectPopoverVerticalStyle(position: SelectPopoverPosition, openAbove: boolean): CSSProperties {
  return openAbove ? { bottom: window.innerHeight - position.inputTop + 4 } : { top: position.top };
}

/** Moves a highlighted index for the arrow, Home and End keys. Returns null for other keys. */
export function nextHighlightedIndex(key: string, current: number, count: number, first = 0): number | null {
  if (count === 0) return null;
  switch (key) {
    case 'ArrowDown':
      return current < count - 1 ? current + 1 : current;
    case 'ArrowUp':
      return current > 0 ? current - 1 : first;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

interface SelectPopoverMessageProps {
  kind: 'loading' | 'empty' | 'error';
  children: ReactNode;
  onRetry?: () => void;
}

/** Loading, no-results and failed-request message inside a select popover. */
export function SelectPopoverMessage({ kind, children, onRetry }: SelectPopoverMessageProps) {
  if (kind === 'loading') {
    return (
      <div role="status" className="flex items-center justify-center gap-2 px-3 py-6 text-sm text-text-muted">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        {children}
      </div>
    );
  }
  if (kind === 'error') {
    return (
      <div role="alert" className="px-3 py-5 text-center text-sm text-status-error">
        <p>{children}</p>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 rounded-md px-2 py-1 text-xs font-medium text-oak-primary transition-colors hover:bg-background-tertiary"
          >
            Try again
          </button>
        ) : null}
      </div>
    );
  }
  return <div className="px-3 py-6 text-center text-sm text-text-muted">{children}</div>;
}

/** Keyboard hint footer shared by the select popovers. */
export function SelectKeyboardHints({ openAbove = false }: { openAbove?: boolean }) {
  const hints: Array<[string, string]> = [['↑↓', 'Navigate'], ['Enter', 'Select'], ['Esc', 'Close']];
  return (
    <div
      className={cn(
        'bg-background-secondary px-3 py-2',
        openAbove ? 'rounded-t-xl border-b border-border-primary' : 'rounded-b-xl border-t border-border-primary',
      )}
    >
      <div className="flex items-center gap-3 text-xs text-text-muted">
        {hints.map(([key, action]) => (
          <span key={key}>
            <kbd className="rounded bg-background-tertiary px-1.5 py-0.5 text-[10px]">{key}</kbd> {action}
          </span>
        ))}
      </div>
    </div>
  );
}
