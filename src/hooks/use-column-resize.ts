'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

export interface UseColumnResizeOptions<Id extends string> {
  /** The column's saved width, or undefined when the user has not resized it. */
  getWidth: (columnId: Id) => number | undefined;
  /** Width used when there is no saved width and the header cannot be measured. */
  getDefaultWidth: (columnId: Id) => number;
  /** Keeps a width within the column's limits. `clampWidth(0, id)` must return the column's minimum. */
  clampWidth: (width: number, columnId: Id) => number;
  /** Called on every pointer move while dragging, for tables that store the live width themselves. */
  onResize?: (columnId: Id, width: number) => void;
  /** Called once with the final width, when a drag ends or an arrow key changes the width. */
  onResizeEnd: (columnId: Id, width: number) => void;
  /** Pixels per ArrowLeft/ArrowRight press. Defaults to 10. */
  keyboardStep?: number;
}

/**
 * Column resizing for tables built on `TableHeaderCell`: drag the header's
 * resize handle, or focus it and press the left and right arrow keys.
 *
 * While dragging, `liveWidths` holds the width being dragged so the table can
 * show it before it is saved. It is cleared when the drag ends, at the same
 * time `onResizeEnd` receives the final width. A cancelled drag (the browser
 * takes over the pointer) saves nothing.
 */
export function useColumnResize<Id extends string>({
  getWidth,
  getDefaultWidth,
  clampWidth,
  onResize,
  onResizeEnd,
  keyboardStep = 10,
}: UseColumnResizeOptions<Id>) {
  const [liveWidths, setLiveWidths] = useState<Partial<Record<Id, number>>>({});
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanupRef.current?.(), []);

  const startResize = useCallback((event: PointerEvent<HTMLElement>, columnId: Id) => {
    event.preventDefault();
    event.stopPropagation();
    cleanupRef.current?.();

    const handle = event.currentTarget;
    const header = handle.closest('th');
    // A header that has not been laid out measures 0px; fall back to the default width.
    const measuredWidth = header?.getBoundingClientRect().width ?? 0;
    const startWidth = getWidth(columnId)
      ?? (measuredWidth > 0 && measuredWidth >= clampWidth(0, columnId) ? measuredWidth : getDefaultWidth(columnId));
    const startX = event.clientX;
    const pointerId = event.pointerId;
    let latestWidth = startWidth;

    const onMove = (moveEvent: globalThis.PointerEvent) => {
      latestWidth = clampWidth(startWidth + (moveEvent.clientX - startX), columnId);
      setLiveWidths((current) => ({ ...current, [columnId]: latestWidth }));
      onResize?.(columnId, latestWidth);
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      try {
        handle.releasePointerCapture(pointerId);
      } catch {
        // Pointer capture is unavailable in some browsers and test environments.
      }
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      setLiveWidths((current) => {
        if (!(columnId in current)) return current;
        const next = { ...current };
        delete next[columnId];
        return next;
      });
      if (cleanupRef.current === cleanup) cleanupRef.current = null;
    };
    const onUp = () => {
      cleanup();
      onResizeEnd(columnId, latestWidth);
    };
    const onCancel = () => cleanup();

    cleanupRef.current = cleanup;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    try {
      handle.setPointerCapture(pointerId);
    } catch {
      // Pointer capture is unavailable in some browsers and test environments.
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  }, [clampWidth, getDefaultWidth, getWidth, onResize, onResizeEnd]);

  const resizeWithKeyboard = useCallback((event: KeyboardEvent<HTMLElement>, columnId: Id) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const currentWidth = getWidth(columnId) ?? getDefaultWidth(columnId);
    const nextWidth = clampWidth(currentWidth + (event.key === 'ArrowRight' ? keyboardStep : -keyboardStep), columnId);
    onResize?.(columnId, nextWidth);
    onResizeEnd(columnId, nextWidth);
  }, [clampWidth, getDefaultWidth, getWidth, keyboardStep, onResize, onResizeEnd]);

  return { liveWidths, startResize, resizeWithKeyboard };
}
