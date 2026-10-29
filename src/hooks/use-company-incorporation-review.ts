'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from '@/hooks/use-auth';
import { useActiveWorkspaceId } from '@/components/ui/workspace-selector';
import type {
  CompanyIncorporationReviewUpdate,
  CompanyIncorporationReviewView,
} from '@/services/company-incorporation-review.service';

function reviewUrl(formId: string, submissionId: string, tenantId?: string | null, sourceQuery?: string): string {
  const params = new URLSearchParams();
  if (tenantId) params.set('tenantId', tenantId);
  if (sourceQuery) params.set('sourceQuery', sourceQuery);
  const query = params.toString();
  return `/api/forms/${encodeURIComponent(formId)}/responses/${encodeURIComponent(submissionId)}/incorporation-review${query ? `?${query}` : ''}`;
}

async function readJson<T>(response: Response, fallback: string): Promise<T> {
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || fallback);
  }
  return response.json();
}

const reviewKey = (formId: string, submissionId: string, tenantId?: string | null) =>
  ['forms', formId, 'responses', submissionId, 'incorporation-review', tenantId ?? null] as const;

export function useCompanyIncorporationReview(formId: string, submissionId: string, enabled: boolean) {
  const { data: session } = useSession();
  const activeTenantId = useActiveWorkspaceId(session?.isSuperAdmin ?? false, session?.tenantId);

  return useQuery({
    queryKey: reviewKey(formId, submissionId, activeTenantId),
    queryFn: async () => readJson<CompanyIncorporationReviewView>(
      await fetch(reviewUrl(formId, submissionId, activeTenantId)),
      'Failed to load the incorporation checklist'
    ),
    enabled: enabled && !!formId && !!submissionId && (session?.isSuperAdmin ? !!activeTenantId : true),
  });
}

export function useKycSourceSearch(formId: string, submissionId: string, sourceQuery: string) {
  const { data: session } = useSession();
  const activeTenantId = useActiveWorkspaceId(session?.isSuperAdmin ?? false, session?.tenantId);
  const trimmed = sourceQuery.trim();

  return useQuery({
    queryKey: [...reviewKey(formId, submissionId, activeTenantId), 'sources', trimmed],
    queryFn: async () => {
      const view = await readJson<CompanyIncorporationReviewView>(
        await fetch(reviewUrl(formId, submissionId, activeTenantId, trimmed)),
        'Failed to search responses'
      );
      return view.sourceCandidates;
    },
    enabled: trimmed.length >= 2,
  });
}

export function useUpdateCompanyIncorporationReview(formId: string, submissionId: string) {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const activeTenantId = useActiveWorkspaceId(session?.isSuperAdmin ?? false, session?.tenantId);

  return useMutation({
    mutationFn: async (update: CompanyIncorporationReviewUpdate) => readJson<CompanyIncorporationReviewView>(
      await fetch(reviewUrl(formId, submissionId, activeTenantId), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      }),
      'Failed to update the incorporation checklist'
    ),
    onSuccess: (view) => {
      queryClient.setQueryData(reviewKey(formId, submissionId, activeTenantId), view);
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: reviewKey(formId, submissionId, activeTenantId) });
    },
  });
}
