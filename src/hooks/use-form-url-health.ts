'use client';

import { useQuery } from '@tanstack/react-query';
import { useActiveWorkspaceId } from '@/components/ui/workspace-selector';
import { useSession } from '@/hooks/use-auth';

export type FormUrlWarningSummary = {
  formId: string;
  warningCount: number;
  lastCheckedAt: string | null;
};

export type FormUrlHealthDetail = {
  id: string;
  formId: string;
  fieldKey: string;
  checkedUrl: string;
  classification: 'HEALTHY' | 'UNVERIFIABLE' | 'FAILED';
  lastHttpStatus: number | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  consecutiveFailures: number;
  lastCheckedAt: string;
  lastSucceededAt: string | null;
  warningActivatedAt: string | null;
};

export const formUrlHealthKeys = {
  summaries: (tenantId?: string | null) => ['form-url-health', tenantId] as const,
  details: (tenantId: string | null | undefined, formId: string | null | undefined) =>
    ['form-url-health', tenantId, formId] as const,
};

function useHealthTenantId() {
  const { data: session } = useSession();
  return useActiveWorkspaceId(session?.isSuperAdmin ?? false, session?.tenantId);
}

function tenantQuery(tenantId?: string | null) {
  return tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : '';
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Unable to load URL health');
  return body as T;
}

export function useFormUrlWarningSummaries() {
  const tenantId = useHealthTenantId();
  return useQuery({
    queryKey: formUrlHealthKeys.summaries(tenantId),
    queryFn: () => getJson<FormUrlWarningSummary[]>(`/api/forms/url-health${tenantQuery(tenantId)}`),
    enabled: Boolean(tenantId),
  });
}

export function useFormUrlHealthDetails(formId?: string | null) {
  const tenantId = useHealthTenantId();
  return useQuery({
    queryKey: formUrlHealthKeys.details(tenantId, formId),
    queryFn: () => getJson<FormUrlHealthDetail[]>(`/api/forms/${formId}/url-health${tenantQuery(tenantId)}`),
    enabled: Boolean(tenantId && formId),
  });
}
