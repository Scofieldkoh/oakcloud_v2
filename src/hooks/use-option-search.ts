/**
 * Debounced, server-backed option search for pickers that must not be capped
 * by a fixed client-side page.
 *
 * The dashboard option endpoints (`/api/companies/options`,
 * `/api/contacts/options`) accept `q` and cap `limit` at 50. Fetching a single
 * page and filtering it locally silently hides records, so every picker that
 * can exceed one page must search on the server instead.
 *
 * `known` accumulates every option this hook has ever seen so a previously
 * selected entity stays resolvable after the visible result set changes.
 *
 * @module hooks/use-option-search
 */

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface UseOptionSearchConfig<T> {
  /** Options endpoint returning `{ options: Array<Record<string, unknown>> }`. */
  endpoint: string;
  /** Maps one raw option payload into the consumer shape. */
  mapOption: (raw: Record<string, unknown>) => T;
  /** Stable identity for de-duplication. */
  getId: (option: T) => string;
  /** Page size requested from the server (endpoint caps at 50). */
  limit?: number;
  /** Debounce applied to query changes. */
  debounceMs?: number;
  /** Options rendered before the first response arrives. */
  seed?: T[];
  /** Always-visible options, e.g. the current selection. */
  pinned?: T[];
  /** Skips fetching entirely when false. */
  enabled?: boolean;
}

export interface UseOptionSearchResult<T> {
  query: string;
  setQuery: (query: string) => void;
  /** Pinned options followed by the current server result page. */
  options: T[];
  /** Every option seen so far, keyed by id. */
  known: Map<string, T>;
  isLoading: boolean;
  error: string | null;
  reload: () => void;
}

export function useOptionSearch<T>({
  endpoint,
  mapOption,
  getId,
  limit = 50,
  debounceMs = 250,
  seed,
  pinned,
  enabled = true,
}: UseOptionSearchConfig<T>): UseOptionSearchResult<T> {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [results, setResults] = useState<T[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const knownRef = useRef<Map<string, T>>(new Map());
  const [knownVersion, setKnownVersion] = useState(0);

  // Keep callbacks out of the fetch effect's dependency list so inline
  // arrow props from callers do not retrigger a request on every render.
  const mapOptionRef = useRef(mapOption);
  mapOptionRef.current = mapOption;
  const getIdRef = useRef(getId);
  getIdRef.current = getId;

  const remember = useCallback((options: T[]) => {
    let changed = false;
    for (const option of options) {
      const id = getIdRef.current(option);
      if (!knownRef.current.has(id)) changed = true;
      knownRef.current.set(id, option);
    }
    if (changed) setKnownVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    if (seed && seed.length > 0) remember(seed);
  }, [seed, remember]);

  useEffect(() => {
    if (pinned && pinned.length > 0) remember(pinned);
  }, [pinned, remember]);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setDebouncedQuery(query.trim()),
      debounceMs,
    );
    return () => window.clearTimeout(timer);
  }, [query, debounceMs]);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setIsLoading(true);
    setError(null);
    const params = new URLSearchParams({ limit: String(limit) });
    if (debouncedQuery) params.set('q', debouncedQuery);

    void (async () => {
      try {
        const response = await fetch(`${endpoint}?${params}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Search request failed');
        const payload = await response.json() as { options?: unknown };
        const raw = Array.isArray(payload.options)
          ? payload.options as Array<Record<string, unknown>>
          : [];
        const mapped = raw.map((entry) => mapOptionRef.current(entry));
        setResults(mapped);
        remember(mapped);
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(caught instanceof Error ? caught.message : 'Search failed');
        setResults([]);
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    })();

    return () => controller.abort();
  }, [endpoint, debouncedQuery, limit, enabled, remember, reloadToken]);

  const options = useMemo(() => {
    const page = results ?? seed ?? [];
    const byId = new Map<string, T>();
    for (const option of pinned ?? []) byId.set(getIdRef.current(option), option);
    for (const option of page) {
      const id = getIdRef.current(option);
      if (!byId.has(id)) byId.set(id, option);
    }
    return [...byId.values()];
  }, [results, seed, pinned]);

  const known = useMemo(
    () => new Map(knownRef.current),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [knownVersion],
  );

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  return { query, setQuery, options, known, isLoading, error, reload };
}
