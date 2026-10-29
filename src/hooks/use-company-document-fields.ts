'use client';

import { useCallback, useEffect, useState } from 'react';
import type { CompanyFieldHomeId } from '@/lib/document-editor/oakdoc-company-field-ids';

export class CompanyDocumentFieldSaveError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

/**
 * What the given `company.*` tags print for the company, by tag. Null until
 * loaded, or when they could not be loaded (the warning is advisory, so a
 * failed load shows nothing rather than an error).
 */
export function useCompanyDocumentFieldValues(companyId: string | null, tags: readonly string[]) {
  const [loaded, setLoaded] = useState<{ key: string; values: Record<string, string> } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const tagList = tags.join(',');
  const key = `${companyId ?? ''}|${tagList}`;

  useEffect(() => {
    if (!companyId || !tagList) return;
    const controller = new AbortController();
    fetch(
      `/api/companies/${encodeURIComponent(companyId)}/document-fields?tags=${encodeURIComponent(tagList)}`,
      { signal: controller.signal },
    )
      .then((response) => (response.ok ? response.json() : null))
      .then((body: unknown) => {
        const values = body && typeof body === 'object' ? (body as { values?: unknown }).values : null;
        if (values && typeof values === 'object') setLoaded({ key, values: values as Record<string, string> });
      })
      .catch(() => {
        // Advisory only: leave the warning hidden.
      });
    return () => controller.abort();
  }, [companyId, tagList, key, reloadKey]);

  const reload = useCallback(() => setReloadKey((count) => count + 1), []);
  // Values of another company or tag set are never shown; a reload keeps the current ones until it lands.
  return { values: loaded?.key === key ? loaded.values : null, reload };
}

/** Save a missing company value to where the company keeps it. */
export async function saveCompanyDocumentField(
  companyId: string,
  input: { fieldId: CompanyFieldHomeId; value: string },
): Promise<{ fieldId: CompanyFieldHomeId; value: string; values: Record<string, string> }> {
  const response = await fetch(`/api/companies/${encodeURIComponent(companyId)}/document-fields`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = response.status === 403
      ? 'You do not have permission to update this company. Use the value for this document only, or ask someone who can.'
      : typeof body?.error === 'string' ? body.error : 'Unable to save the value.';
    throw new CompanyDocumentFieldSaveError(message, response.status);
  }
  return body;
}
