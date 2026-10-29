import { act, renderHook } from '@testing-library/react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useColumnResize } from '@/hooks/use-column-resize';

type ColumnId = 'name' | 'status';

function setup(savedWidths: Partial<Record<ColumnId, number>> = {}) {
  const onResize = vi.fn();
  const onResizeEnd = vi.fn();
  const hook = renderHook(() => useColumnResize<ColumnId>({
    getWidth: (columnId) => savedWidths[columnId],
    getDefaultWidth: () => 150,
    clampWidth: (width) => Math.min(400, Math.max(60, Math.round(width))),
    onResize,
    onResizeEnd,
  }));
  return { ...hook, onResize, onResizeEnd };
}

function pointerDown(clientX: number, headerWidth = 0) {
  const header = document.createElement('th');
  header.getBoundingClientRect = () => ({ width: headerWidth } as DOMRect);
  const handle = document.createElement('span');
  header.appendChild(handle);
  return {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    currentTarget: handle,
    clientX,
    pointerId: 1,
  } as unknown as PointerEvent<HTMLElement>;
}

function firePointer(type: 'pointermove' | 'pointerup' | 'pointercancel', clientX = 0) {
  const event = new Event(type) as Event & { clientX: number };
  event.clientX = clientX;
  act(() => {
    window.dispatchEvent(event);
  });
}

function key(name: string) {
  return { key: name, preventDefault: vi.fn() } as unknown as KeyboardEvent<HTMLElement>;
}

describe('useColumnResize', () => {
  it('drags from the saved width, shows the live width, and saves once on release', () => {
    const { result, onResize, onResizeEnd } = setup({ name: 200 });

    act(() => result.current.startResize(pointerDown(100), 'name'));
    expect(document.body.style.cursor).toBe('col-resize');

    firePointer('pointermove', 150);
    expect(result.current.liveWidths.name).toBe(250);
    expect(onResize).toHaveBeenLastCalledWith('name', 250);
    expect(onResizeEnd).not.toHaveBeenCalled();

    firePointer('pointerup');
    expect(onResizeEnd).toHaveBeenCalledOnce();
    expect(onResizeEnd).toHaveBeenCalledWith('name', 250);
    expect(result.current.liveWidths).toEqual({});
    expect(document.body.style.cursor).toBe('');
  });

  it('starts from the measured header when nothing is saved, and keeps widths within limits', () => {
    const { result, onResizeEnd } = setup();

    act(() => result.current.startResize(pointerDown(0, 180), 'status'));
    firePointer('pointermove', -500);
    firePointer('pointerup');
    expect(onResizeEnd).toHaveBeenCalledWith('status', 60);

    act(() => result.current.startResize(pointerDown(0, 180), 'status'));
    firePointer('pointermove', 1000);
    firePointer('pointerup');
    expect(onResizeEnd).toHaveBeenLastCalledWith('status', 400);
  });

  it('falls back to the default width for a header that has not been laid out', () => {
    const { result, onResizeEnd } = setup();

    act(() => result.current.startResize(pointerDown(0, 0), 'name'));
    firePointer('pointermove', 10);
    firePointer('pointerup');
    expect(onResizeEnd).toHaveBeenCalledWith('name', 160);
  });

  it('saves nothing when the browser cancels the drag', () => {
    const { result, onResizeEnd } = setup({ name: 200 });

    act(() => result.current.startResize(pointerDown(0), 'name'));
    firePointer('pointermove', 40);
    firePointer('pointercancel');
    firePointer('pointerup');

    expect(onResizeEnd).not.toHaveBeenCalled();
    expect(result.current.liveWidths).toEqual({});
  });

  it('resizes by 10px per arrow key and ignores other keys', () => {
    const { result, onResize, onResizeEnd } = setup({ name: 200 });

    act(() => result.current.resizeWithKeyboard(key('ArrowRight'), 'name'));
    expect(onResize).toHaveBeenCalledWith('name', 210);
    expect(onResizeEnd).toHaveBeenCalledWith('name', 210);

    act(() => result.current.resizeWithKeyboard(key('ArrowLeft'), 'status'));
    expect(onResizeEnd).toHaveBeenLastCalledWith('status', 140);

    act(() => result.current.resizeWithKeyboard(key('Enter'), 'name'));
    expect(onResizeEnd).toHaveBeenCalledTimes(2);
  });
});
