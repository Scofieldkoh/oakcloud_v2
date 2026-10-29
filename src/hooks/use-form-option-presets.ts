'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useActiveWorkspaceId } from '@/components/ui/workspace-selector';
import { useSession } from '@/hooks/use-auth';
import type { PresetCsvError } from '@/lib/form-option-preset-csv';
import type { PresetOption } from '@/lib/validations/form-option-preset';

export type FormOptionPresetListItem = {
  id: string;
  name: string;
  builtInKey: string | null;
  isProtected: boolean;
  allowCsvReplace: boolean;
  options: PresetOption[];
  optionCount: number;
  updatedAt: string;
  _count: { fields: number };
};

export type PresetCsvPreview = {
  detectedColumns: string[];
  totalRows: number;
  validRows: number;
  rejectedRows: number;
  errors: PresetCsvError[];
  sample: PresetOption[];
};

export class PresetRequestError extends Error {
  constructor(message: string, public details?: Partial<PresetCsvPreview>) {
    super(message);
    this.name = 'PresetRequestError';
  }
}

export const formOptionPresetKeys = {
  list: (tenantId?: string | null) => ['form-option-presets', tenantId] as const,
};

async function parseResponse<T>(responseOrPromise: Response | Promise<Response>): Promise<T> {
  const response = await responseOrPromise;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new PresetRequestError(body.error || 'Preset request failed', body);
  return body as T;
}

function usePresetTenantId() {
  const { data: session } = useSession();
  return useActiveWorkspaceId(session?.isSuperAdmin ?? false, session?.tenantId);
}

function tenantQuery(tenantId?: string | null) {
  return tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : '';
}

export function useFormOptionPresets() {
  const tenantId = usePresetTenantId();
  return useQuery({
    queryKey: formOptionPresetKeys.list(tenantId),
    queryFn: () => parseResponse<FormOptionPresetListItem[]>(
      fetch(`/api/forms/presets${tenantQuery(tenantId)}`),
    ),
    enabled: Boolean(tenantId),
  });
}

function useInvalidatePresets(tenantId?: string | null) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: formOptionPresetKeys.list(tenantId) });
}

export function usePreviewFormOptionPresetCsv() {
  const tenantId = usePresetTenantId();
  return useMutation({
    mutationFn: (csv: string) => parseResponse<PresetCsvPreview>(fetch('/api/forms/presets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenantId, preview: true, csv }),
    })),
  });
}

export function useCreateFormOptionPreset() {
  const tenantId = usePresetTenantId();
  const invalidate = useInvalidatePresets(tenantId);
  return useMutation({
    mutationFn: ({ name, csv }: { name: string; csv: string }) =>
      parseResponse<FormOptionPresetListItem>(fetch('/api/forms/presets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenantId, name, csv }),
      })),
    onSuccess: invalidate,
  });
}

export function useUpdateFormOptionPreset() {
  const tenantId = usePresetTenantId();
  const invalidate = useInvalidatePresets(tenantId);
  return useMutation({
    mutationFn: ({ id, name, csv }: { id: string; name?: string; csv?: string }) =>
      parseResponse<FormOptionPresetListItem>(fetch(`/api/forms/presets/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenantId, name, csv }),
      })),
    onSuccess: invalidate,
  });
}

export function useDeleteFormOptionPreset() {
  const tenantId = usePresetTenantId();
  const invalidate = useInvalidatePresets(tenantId);
  return useMutation({
    mutationFn: (id: string) => parseResponse<FormOptionPresetListItem>(
      fetch(`/api/forms/presets/${id}${tenantQuery(tenantId)}`, { method: 'DELETE' }),
    ),
    onSuccess: invalidate,
  });
}
