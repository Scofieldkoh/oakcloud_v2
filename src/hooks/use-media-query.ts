'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Hook that tracks a CSS media query with proper SSR hydration support.
 *
 * Uses useSyncExternalStore for proper hydration without layout shifts.
 * On the server, returns false by default. On the client, returns the
 * actual media query result.
 *
 * @param query - CSS media query string (e.g., '(min-width: 768px)')
 * @returns Boolean indicating if the media query matches
 *
 * @example
 * ```tsx
 * const isDesktop = useMediaQuery('(min-width: 1024px)');
 * const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
 * ```
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (callback: () => void) => {
      if (typeof window.matchMedia !== 'function') return () => undefined;
      const mediaQuery = window.matchMedia(query);
      mediaQuery.addEventListener('change', callback);
      return () => mediaQuery.removeEventListener('change', callback);
    },
    [query]
  );

  const getSnapshot = useCallback(() => {
    if (typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(query).matches;
  }, [query]);

  // Return false during SSR to prevent hydration mismatch
  const getServerSnapshot = useCallback(() => false, []);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// Predefined breakpoint hooks for convenience
export function useIsMobile(): boolean {
  return !useMediaQuery('(min-width: 768px)');
}

export function useIsTablet(): boolean {
  const isMin768 = useMediaQuery('(min-width: 768px)');
  const isMax1024 = useMediaQuery('(max-width: 1023px)');
  return isMin768 && isMax1024;
}

export function useIsDesktop(): boolean {
  return useMediaQuery('(min-width: 1024px)');
}

export function useIsLargeDesktop(): boolean {
  return useMediaQuery('(min-width: 1280px)');
}

// Reduced motion preference
export function usePrefersReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}
