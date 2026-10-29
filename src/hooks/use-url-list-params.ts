'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { buildListUrl, parseUrlParams, type UrlParamSpec } from '@/lib/url-list-params';

interface UpdateOptions {
  /** Go back to the first page. Defaults to true, since a filter change usually changes the result count. */
  resetPage?: boolean;
}

/**
 * List-page state kept in the URL: params start from the current URL, and
 * every change replaces the URL (without scrolling) so reloads, shared links
 * and the back button keep the same search, filters and page.
 *
 * `spec` must be a stable (module-level) object. `parse` replaces the
 * spec-based parsing when a page needs to tidy the values it reads.
 */
export function useUrlListParams<T extends { page?: number }>(
  basePath: string,
  spec: UrlParamSpec<T>,
  parse: (searchParams: URLSearchParams) => T = (searchParams) => parseUrlParams(spec, searchParams),
) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [params, setParams] = useState<T>(() => parse(new URLSearchParams(searchParams.toString())));

  const targetUrl = useMemo(() => buildListUrl(basePath, spec, params), [basePath, spec, params]);

  useEffect(() => {
    if (window.location.pathname + window.location.search !== targetUrl) {
      router.replace(targetUrl, { scroll: false });
    }
  }, [targetUrl, router]);

  const updateParams = useCallback((patch: Partial<T>, options: UpdateOptions = {}) => {
    const resetPage = options.resetPage ?? true;
    setParams((prev) => ({ ...prev, ...patch, ...(resetPage && !('page' in patch) ? { page: 1 } : {}) }));
  }, []);

  return { params, setParams, updateParams, targetUrl };
}
