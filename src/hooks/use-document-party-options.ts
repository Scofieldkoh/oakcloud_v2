'use client';

import { useCallback, useEffect, useState } from 'react';
import type { DocumentParty } from '@/lib/document-party';

export interface DocumentPartyOptions {
  directors: DocumentParty[];
  shareholders: DocumentParty[];
  contacts: DocumentParty[];
  /** Current officers of every role (secretary, CEO, auditor...). */
  officers: DocumentParty[];
}

const EMPTY_OPTIONS: DocumentPartyOptions = {
  directors: [],
  shareholders: [],
  contacts: [],
  officers: [],
};

/**
 * Tenant-safe party loading for the batch configurators.
 *
 * Extracted from the old wizard so standard and Service Agreement editors can
 * share one loading/error contract.
 */
export function useDocumentPartyOptions(primaryCompanyId: string | null) {
  const [options, setOptions] = useState<DocumentPartyOptions>(EMPTY_OPTIONS);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!primaryCompanyId) {
      setOptions(EMPTY_OPTIONS);
      setError(null);
      setIsLoading(false);
      return;
    }
    const controller = new AbortController();
    setIsLoading(true);
    setError(null);
    fetch(`/api/companies/${encodeURIComponent(primaryCompanyId)}/document-parties`, {
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error('Failed to load party options');
        return response.json();
      })
      .then((data: DocumentPartyOptions) => {
        setOptions({
          directors: data.directors ?? [],
          shareholders: data.shareholders ?? [],
          contacts: data.contacts ?? [],
          officers: data.officers ?? [],
        });
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setError(caught instanceof Error ? caught.message : 'Failed to load party options');
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, [primaryCompanyId, reloadKey]);

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  return { ...options, isLoading, error, reload };
}
