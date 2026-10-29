'use client';

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { QueryClient, QueryKey } from '@tanstack/react-query';

/**
 * Session-scoped cache for list page snapshots.
 *
 * Next.js restores the previous page from its in-memory router cache on
 * back/forward, but TanStack Query data is only kept in memory. After a full
 * page load (refresh, direct URL, or a native/hard restore) the query cache is
 * cold, so list pages that gate rendering on a bootstrap request show a
 * spinner until the server responds again. Persisting the last-known snapshot
 * in sessionStorage lets those pages render the previous rows instantly and
 * refresh in the background.
 */

const CACHE_PREFIX = 'oakcloud:list-cache';
const CACHE_VERSION = 1;
const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024; // 2 MB guard against quota errors
// This external-store gate keeps SSR and hydration on the same snapshot, then
// permits browser-only sessionStorage reads immediately after hydration.
const subscribeToHydration = () => () => {};
const getClientHydrationSnapshot = () => true;
const getServerHydrationSnapshot = () => false;

/**
 * Deterministic serialization that is insensitive to object key order, so the
 * same query key always maps to the same storage key.
 */
export function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`);
  return `{${entries.join(',')}}`;
}

export function sessionListStorageKey(queryKey: QueryKey): string {
  return `${CACHE_PREFIX}:v${CACHE_VERSION}:${stableSerialize(queryKey)}`;
}

export function readSessionListSnapshot<T>(queryKey: QueryKey): T | undefined {
  if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') {
    return undefined;
  }
  try {
    const raw = sessionStorage.getItem(sessionListStorageKey(queryKey));
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

export function writeSessionListSnapshot<T>(queryKey: QueryKey, data: T): void {
  if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') {
    return;
  }
  try {
    const raw = JSON.stringify(data);
    if (raw.length > MAX_SNAPSHOT_BYTES) return;
    sessionStorage.setItem(sessionListStorageKey(queryKey), raw);
  } catch {
    // Best effort only: quota errors or non-serializable data must not break the page.
  }
}

interface SessionListRestoreOptions<T> {
  enabled?: boolean;
  validate?: (value: unknown) => value is T;
}

/**
 * Returns a session snapshot to seed a query with when the in-memory cache is
 * cold. When the cache is already warm, the session snapshot is ignored.
 */
export function useSessionListRestore<T>(
  queryClient: QueryClient,
  queryKey: QueryKey,
  options: SessionListRestoreOptions<T> = {},
): { initialData: T | undefined; restoredFromSession: boolean } {
  const { enabled = true, validate } = options;
  const serializedKey = stableSerialize(queryKey);
  const canReadSessionSnapshot = useSyncExternalStore(
    subscribeToHydration,
    getClientHydrationSnapshot,
    getServerHydrationSnapshot,
  );

  return useMemo(() => {
    if (!enabled || !canReadSessionSnapshot) {
      return { initialData: undefined, restoredFromSession: false };
    }
    if (queryClient.getQueryData<T>(queryKey) !== undefined) {
      return { initialData: undefined, restoredFromSession: false };
    }
    const snapshot = readSessionListSnapshot<T>(queryKey);
    const valid = snapshot !== undefined && (!validate || validate(snapshot));
    return {
      initialData: valid ? snapshot : undefined,
      restoredFromSession: valid,
    };
    // queryKey contents are captured through serializedKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, serializedKey, validate, queryClient, canReadSessionSnapshot]);
}

/**
 * Persists query data to sessionStorage whenever it changes. Pass `undefined`
 * to disable persistence for a particular query.
 */
export function usePersistSessionListSnapshot<T>(
  queryKey: QueryKey,
  data: T | undefined,
): void {
  const serializedKey = stableSerialize(queryKey);

  useEffect(() => {
    if (data === undefined) return;
    writeSessionListSnapshot(queryKey, data);
    // queryKey contents are captured through serializedKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, serializedKey]);
}
