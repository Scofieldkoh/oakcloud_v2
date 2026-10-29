'use client';

import { useEffect, useRef, useState } from 'react';

/** Delay used by list search boxes before a typed query is applied. */
export const SEARCH_DEBOUNCE_MS = 300;

/**
 * Keeps a local draft for a search box and commits it after the user pauses
 * typing. Outside changes to `value` (a cleared chip, a restored URL) replace
 * the draft, except for the echo of a query this hook just committed, so a
 * slow round trip never overwrites what the user is still typing.
 */
export function useDebouncedSearch(
  value: string,
  onCommit: (value: string) => void,
  delayMs = SEARCH_DEBOUNCE_MS,
) {
  const [draft, setDraft] = useState(value);
  const lastCommitted = useRef(value);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  useEffect(() => {
    if (value === lastCommitted.current) return;
    lastCommitted.current = value;
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (draft === lastCommitted.current) return undefined;
    const timer = window.setTimeout(() => {
      lastCommitted.current = draft;
      onCommitRef.current(draft);
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, draft]);

  const commitNow = (next: string) => {
    setDraft(next);
    lastCommitted.current = next;
    onCommitRef.current(next);
  };

  return { draft, setDraft, commitNow };
}
