import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDebouncedSearch } from '@/hooks/use-debounced-search';

describe('useDebouncedSearch', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('commits the draft once typing pauses', () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() => useDebouncedSearch('', onCommit));

    act(() => result.current.setDraft('ann'));
    act(() => vi.advanceTimersByTime(200));
    act(() => result.current.setDraft('annual'));
    act(() => vi.advanceTimersByTime(299));
    expect(onCommit).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('annual');
  });

  it('keeps typing when the committed query echoes back late', () => {
    const onCommit = vi.fn();
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedSearch(value, onCommit),
      { initialProps: { value: '' } },
    );

    act(() => result.current.setDraft('ann'));
    act(() => vi.advanceTimersByTime(300));
    act(() => result.current.setDraft('annu'));
    rerender({ value: 'ann' });

    expect(result.current.draft).toBe('annu');
  });

  it('takes outside changes and commits clears immediately', () => {
    const onCommit = vi.fn();
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedSearch(value, onCommit),
      { initialProps: { value: 'tax' } },
    );

    rerender({ value: '' });
    expect(result.current.draft).toBe('');

    act(() => result.current.commitNow('gst'));
    expect(onCommit).toHaveBeenCalledWith('gst');
    act(() => vi.advanceTimersByTime(300));
    expect(onCommit).toHaveBeenCalledTimes(1);
  });
});
