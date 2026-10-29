'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from '@/hooks/use-auth';
import { useActiveWorkspaceId } from '@/components/ui/workspace-selector';
import {
  usePersistSessionListSnapshot,
  useSessionListRestore,
} from '@/hooks/use-session-query-restore';
import type {
  CreateEsigningEnvelopeInput,
  EsigningFieldDefinitionInput,
  EsigningListQueryInput,
  EsigningRecipientInput,
  UpdateEsigningEnvelopeInput,
  UpdateEsigningRecipientInput,
} from '@/lib/validations/esigning';
import type {
  EsigningCompanyFilterOptionDto,
  EsigningEnvelopeDetailDto,
  EsigningEnvelopeListItem,
  EsigningManualLinkDto,
  EsigningEnvelopeStatusCounts,
} from '@/types/esigning';
import type { TaskLaunchContext } from '@/services/tasks/types';

export type { EsigningEnvelopeDetailDto } from '@/types/esigning';

interface EsigningListResult {
  envelopes: EsigningEnvelopeListItem[];
  companyOptions: EsigningCompanyFilterOptionDto[];
  total: number;
  page: number;
  limit: number;
  statusCounts: EsigningEnvelopeStatusCounts;
}

function isEsigningListResult(value: unknown): value is EsigningListResult {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<EsigningListResult>;
  return (
    !!candidate.envelopes &&
    Array.isArray(candidate.envelopes) &&
    typeof candidate.total === 'number'
  );
}

function withTenant(path: string, tenantId?: string | null): string {
  if (!tenantId) {
    return path;
  }

  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}tenantId=${encodeURIComponent(tenantId)}`;
}

async function readJsonError(response: Response, fallback: string): Promise<never> {
  const error = await response.json().catch(() => ({}));
  throw new Error(error.error || fallback);
}

async function fetchEsigningEnvelopes(
  params: Partial<EsigningListQueryInput>,
  tenantId?: string | null
): Promise<EsigningListResult> {
  const searchParams = new URLSearchParams();
  if (params.query) searchParams.set('query', params.query);
  if (params.status) searchParams.set('status', params.status);
  if (params.statuses?.length) searchParams.set('statuses', params.statuses.join(','));
  if (params.companyId) searchParams.set('companyId', params.companyId);
  if (params.documentName) searchParams.set('documentName', params.documentName);
  if (params.recipientQuery) searchParams.set('recipientQuery', params.recipientQuery);
  if (params.recipientStatus) searchParams.set('recipientStatus', params.recipientStatus);
  if (params.signingOrder) searchParams.set('signingOrder', params.signingOrder);
  if (params.createdFrom) searchParams.set('createdFrom', params.createdFrom);
  if (params.createdTo) searchParams.set('createdTo', params.createdTo);
  if (params.sentFrom) searchParams.set('sentFrom', params.sentFrom);
  if (params.sentTo) searchParams.set('sentTo', params.sentTo);
  if (params.completedFrom) searchParams.set('completedFrom', params.completedFrom);
  if (params.completedTo) searchParams.set('completedTo', params.completedTo);
  if (params.createdBy) searchParams.set('createdBy', params.createdBy);
  if (params.page) searchParams.set('page', String(params.page));
  if (params.limit) searchParams.set('limit', String(params.limit));
  if (params.sortBy) searchParams.set('sortBy', params.sortBy);
  if (params.sortOrder) searchParams.set('sortOrder', params.sortOrder);

  const response = await fetch(
    withTenant(`/api/esigning/envelopes${searchParams.toString() ? `?${searchParams.toString()}` : ''}`, tenantId)
  );

  if (!response.ok) {
    await readJsonError(response, 'Failed to fetch envelopes');
  }

  return response.json();
}

async function fetchEsigningEnvelopeDetail(id: string, tenantId?: string | null): Promise<EsigningEnvelopeDetailDto> {
  const response = await fetch(withTenant(`/api/esigning/envelopes/${id}`, tenantId));

  if (!response.ok) {
    await readJsonError(response, 'Failed to fetch envelope');
  }

  return response.json();
}

export type CreateEsigningEnvelopeRequest = CreateEsigningEnvelopeInput & {
  taskContext?: TaskLaunchContext;
  generatedDocumentId?: string;
  generatedDocumentIds?: string[];
};

async function createEnvelopeRequest(
  payload: CreateEsigningEnvelopeRequest & { tenantId?: string | null }
): Promise<EsigningEnvelopeDetailDto> {
  const response = await fetch('/api/esigning/envelopes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    await readJsonError(response, 'Failed to create envelope');
  }

  return response.json();
}

async function updateEnvelopeRequest(
  id: string,
  payload: UpdateEsigningEnvelopeInput & { tenantId?: string | null }
): Promise<EsigningEnvelopeDetailDto> {
  const response = await fetch(`/api/esigning/envelopes/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    await readJsonError(response, 'Failed to update envelope');
  }

  return response.json();
}

async function deleteEnvelopeRequest(id: string, tenantId?: string | null): Promise<void> {
  const response = await fetch(withTenant(`/api/esigning/envelopes/${id}`, tenantId), {
    method: 'DELETE',
  });

  if (!response.ok) {
    await readJsonError(response, 'Failed to delete envelope');
  }
}

async function duplicateEnvelopeRequest(
  id: string,
  tenantId?: string | null
): Promise<EsigningEnvelopeDetailDto> {
  const response = await fetch(`/api/esigning/envelopes/${id}/duplicate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenantId }),
  });

  if (!response.ok) {
    await readJsonError(response, 'Failed to duplicate envelope');
  }

  return response.json();
}

async function addRecipientRequest(
  envelopeId: string,
  payload: EsigningRecipientInput & { tenantId?: string | null }
): Promise<EsigningEnvelopeDetailDto> {
  const response = await fetch(`/api/esigning/envelopes/${envelopeId}/recipients`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    await readJsonError(response, 'Failed to add recipient');
  }

  return response.json();
}

async function updateRecipientRequest(
  envelopeId: string,
  recipientId: string,
  payload: UpdateEsigningRecipientInput & { tenantId?: string | null }
): Promise<{ envelope: EsigningEnvelopeDetailDto; manualLinks: EsigningManualLinkDto[] }> {
  const response = await fetch(`/api/esigning/envelopes/${envelopeId}/recipients/${recipientId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    await readJsonError(response, 'Failed to update recipient');
  }

  return response.json();
}

async function removeRecipientRequest(
  envelopeId: string,
  recipientId: string,
  tenantId?: string | null
): Promise<EsigningEnvelopeDetailDto> {
  const response = await fetch(
    withTenant(`/api/esigning/envelopes/${envelopeId}/recipients/${recipientId}`, tenantId),
    { method: 'DELETE' }
  );

  if (!response.ok) {
    await readJsonError(response, 'Failed to remove recipient');
  }

  return response.json();
}

async function reorderRecipientsRequest(
  envelopeId: string,
  payload: {
    recipientIds?: string[];
    recipients?: Array<{ recipientId: string; signingOrder: number }>;
  },
  tenantId?: string | null
): Promise<EsigningEnvelopeDetailDto> {
  const response = await fetch(`/api/esigning/envelopes/${envelopeId}/recipients/reorder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenantId, ...payload }),
  });

  if (!response.ok) {
    await readJsonError(response, 'Failed to reorder recipients');
  }

  return response.json();
}

export interface ReorderEsigningRecipientsPayload {
  recipientIds?: string[];
  recipients?: Array<{ recipientId: string; signingOrder: number }>;
}

export async function uploadEsigningDocumentRequest(
  envelopeId: string,
  file: File,
  tenantId?: string | null
): Promise<EsigningEnvelopeDetailDto> {
  const formData = new FormData();
  formData.set('file', file);
  if (tenantId) {
    formData.set('tenantId', tenantId);
  }

  const response = await fetch(`/api/esigning/envelopes/${envelopeId}/documents`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    await readJsonError(response, 'Failed to upload document');
  }

  return response.json();
}

export interface UpdateEsigningDocumentPayload {
  sortOrder?: number;
  visibility?: 'SIGNER_ONLY' | 'EVERYONE';
  fileName?: string;
}

async function updateDocumentRequest(
  envelopeId: string,
  documentId: string,
  payload: UpdateEsigningDocumentPayload,
  tenantId?: string | null
): Promise<EsigningEnvelopeDetailDto> {
  const response = await fetch(`/api/esigning/envelopes/${envelopeId}/documents/${documentId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenantId, ...payload }),
  });

  if (!response.ok) {
    await readJsonError(response, 'Failed to update document');
  }

  return response.json();
}

async function deleteDocumentRequest(
  envelopeId: string,
  documentId: string,
  tenantId?: string | null
): Promise<EsigningEnvelopeDetailDto> {
  const response = await fetch(
    withTenant(`/api/esigning/envelopes/${envelopeId}/documents/${documentId}`, tenantId),
    { method: 'DELETE' }
  );

  if (!response.ok) {
    await readJsonError(response, 'Failed to remove document');
  }

  return response.json();
}

export async function attachGeneratedDocumentsRequest(
  envelopeId: string,
  generatedDocumentIds: string[],
  tenantId?: string | null,
): Promise<EsigningEnvelopeDetailDto> {
  const response = await fetch(`/api/esigning/envelopes/${envelopeId}/documents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenantId, generatedDocumentIds }),
  });

  if (!response.ok) {
    await readJsonError(response, 'Failed to add generated documents');
  }

  return response.json();
}

async function saveFieldsRequest(
  envelopeId: string,
  fields: EsigningFieldDefinitionInput[],
  tenantId?: string | null
): Promise<EsigningEnvelopeDetailDto> {
  const response = await fetch(`/api/esigning/envelopes/${envelopeId}/fields`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tenantId,
      fields,
    }),
  });

  if (!response.ok) {
    await readJsonError(response, 'Failed to save fields');
  }

  return response.json();
}

async function sendEnvelopeRequest(
  envelopeId: string,
  tenantId?: string | null,
  taskContext?: TaskLaunchContext,
): Promise<{ envelope: EsigningEnvelopeDetailDto; manualLinks: EsigningManualLinkDto[] }> {
  const response = await fetch(`/api/esigning/envelopes/${envelopeId}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenantId, taskContext }),
  });

  if (!response.ok) {
    await readJsonError(response, 'Failed to send envelope');
  }

  return response.json();
}

async function voidEnvelopeRequest(
  envelopeId: string,
  payload: { tenantId?: string | null; reason?: string | null }
): Promise<EsigningEnvelopeDetailDto> {
  const response = await fetch(`/api/esigning/envelopes/${envelopeId}/void`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    await readJsonError(response, 'Failed to void envelope');
  }

  return response.json();
}

async function resendRecipientRequest(
  envelopeId: string,
  recipientId: string,
  tenantId?: string | null
): Promise<{ envelope: EsigningEnvelopeDetailDto; manualLinks: EsigningManualLinkDto[] }> {
  const response = await fetch(`/api/esigning/envelopes/${envelopeId}/resend/${recipientId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenantId }),
  });

  if (!response.ok) {
    await readJsonError(response, 'Failed to resend recipient');
  }

  return response.json();
}

async function recipientManualLinkRequest(
  envelopeId: string,
  recipientId: string,
  tenantId?: string | null
): Promise<EsigningManualLinkDto> {
  const response = await fetch(`/api/esigning/envelopes/${envelopeId}/manual-link/${recipientId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenantId }),
  });

  if (!response.ok) {
    await readJsonError(response, 'Failed to create signer link');
  }

  return response.json();
}

async function retryEnvelopeProcessingRequest(
  envelopeId: string,
  tenantId?: string | null
): Promise<EsigningEnvelopeDetailDto> {
  const response = await fetch(`/api/esigning/envelopes/${envelopeId}/retry-processing`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenantId }),
  });

  if (!response.ok) {
    await readJsonError(response, 'Failed to retry PDF generation');
  }

  return response.json();
}

async function resendEnvelopeRequest(
  envelopeId: string,
  tenantId?: string | null
): Promise<{ envelope: EsigningEnvelopeDetailDto; manualLinks: EsigningManualLinkDto[] }> {
  const response = await fetch(`/api/esigning/envelopes/${envelopeId}/resend`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenantId }),
  });

  if (!response.ok) {
    await readJsonError(response, 'Failed to resend active signing requests');
  }

  return response.json();
}

function useEsigningTenant() {
  const { data: session } = useSession();
  return useActiveWorkspaceId(session?.isSuperAdmin ?? false, session?.tenantId);
}

function invalidateEnvelopeQueries(queryClient: ReturnType<typeof useQueryClient>, tenantId?: string | null) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ['esigning', 'list', tenantId] }),
    queryClient.invalidateQueries({ queryKey: ['esigning', 'detail'] }),
  ]);
}

export function useEsigningEnvelopes(params: Partial<EsigningListQueryInput> = {}) {
  const tenantId = useEsigningTenant();
  const queryClient = useQueryClient();
  const queryKey = ['esigning', 'list', tenantId, params] as const;
  const { initialData, restoredFromSession } = useSessionListRestore<EsigningListResult>(
    queryClient,
    queryKey,
    { validate: isEsigningListResult },
  );

  const query = useQuery({
    queryKey,
    queryFn: () => fetchEsigningEnvelopes(params, tenantId),
    enabled: Boolean(tenantId),
    staleTime: 30_000,
    // Keep every admin list current, including empty and terminal-only lists.
    refetchInterval: 15_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: 'always',
    refetchOnMount: 'always',
    initialData,
    initialDataUpdatedAt: restoredFromSession ? 0 : undefined,
  });

  usePersistSessionListSnapshot(queryKey, query.data);

  return query;
}

export function useEsigningEnvelope(id: string | null) {
  const tenantId = useEsigningTenant();

  return useQuery({
    queryKey: ['esigning', 'detail', tenantId, id],
    queryFn: () => fetchEsigningEnvelopeDetail(id!, tenantId),
    enabled: Boolean(id && tenantId),
    staleTime: 15_000,
    refetchInterval: (query) => {
      const data = query.state.data as EsigningEnvelopeDetailDto | undefined;
      if (!data) {
        return 10_000;
      }
      return ['DRAFT', 'SENT', 'IN_PROGRESS', 'COMPLETED'].includes(data.status) ? 10_000 : false;
    },
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: 'always',
    refetchOnMount: 'always',
  });
}

export function useCreateEsigningEnvelope() {
  const tenantId = useEsigningTenant();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: CreateEsigningEnvelopeRequest) =>
      createEnvelopeRequest({ ...payload, tenantId }),
    onSuccess: async (result) => {
      await invalidateEnvelopeQueries(queryClient, tenantId);
      queryClient.setQueryData(['esigning', 'detail', tenantId, result.id], result);
    },
  });
}

export function useUpdateEsigningEnvelope(id: string) {
  const tenantId = useEsigningTenant();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: UpdateEsigningEnvelopeInput) =>
      updateEnvelopeRequest(id, { ...payload, tenantId }),
    onSuccess: async (result) => {
      queryClient.setQueryData(['esigning', 'detail', tenantId, id], result);
      await invalidateEnvelopeQueries(queryClient, tenantId);
    },
  });
}

export function useDeleteEsigningEnvelope() {
  const tenantId = useEsigningTenant();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deleteEnvelopeRequest(id, tenantId),
    onSuccess: async () => {
      await invalidateEnvelopeQueries(queryClient, tenantId);
    },
  });
}

export function useDuplicateEsigningEnvelope() {
  const tenantId = useEsigningTenant();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => duplicateEnvelopeRequest(id, tenantId),
    onSuccess: async (result) => {
      queryClient.setQueryData(['esigning', 'detail', tenantId, result.id], result);
      await invalidateEnvelopeQueries(queryClient, tenantId);
    },
  });
}

export function useAddEsigningRecipient(envelopeId: string) {
  const tenantId = useEsigningTenant();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: EsigningRecipientInput) =>
      addRecipientRequest(envelopeId, { ...payload, tenantId }),
    onSuccess: async (result) => {
      queryClient.setQueryData(['esigning', 'detail', tenantId, envelopeId], result);
      await invalidateEnvelopeQueries(queryClient, tenantId);
    },
  });
}

export function useUpdateEsigningRecipient(envelopeId: string, recipientId: string) {
  const tenantId = useEsigningTenant();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: UpdateEsigningRecipientInput) =>
      updateRecipientRequest(envelopeId, recipientId, { ...payload, tenantId }),
    onSuccess: async (result) => {
      queryClient.setQueryData(['esigning', 'detail', tenantId, envelopeId], result.envelope);
      await invalidateEnvelopeQueries(queryClient, tenantId);
    },
  });
}

export function useRemoveEsigningRecipient(envelopeId: string, recipientId: string) {
  const tenantId = useEsigningTenant();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => removeRecipientRequest(envelopeId, recipientId, tenantId),
    onSuccess: async (result) => {
      queryClient.setQueryData(['esigning', 'detail', tenantId, envelopeId], result);
      await invalidateEnvelopeQueries(queryClient, tenantId);
    },
  });
}

export function useReorderEsigningRecipients(envelopeId: string) {
  const tenantId = useEsigningTenant();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: ReorderEsigningRecipientsPayload) =>
      reorderRecipientsRequest(envelopeId, payload, tenantId),
    onSuccess: async (result) => {
      queryClient.setQueryData(['esigning', 'detail', tenantId, envelopeId], result);
      await invalidateEnvelopeQueries(queryClient, tenantId);
    },
  });
}

export function useUploadEsigningDocument(envelopeId: string) {
  const tenantId = useEsigningTenant();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (file: File) => uploadEsigningDocumentRequest(envelopeId, file, tenantId),
    onSuccess: async (result) => {
      queryClient.setQueryData(['esigning', 'detail', tenantId, envelopeId], result);
      await invalidateEnvelopeQueries(queryClient, tenantId);
    },
  });
}

export function useUpdateEsigningDocument(envelopeId: string) {
  const tenantId = useEsigningTenant();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ documentId, ...payload }: UpdateEsigningDocumentPayload & { documentId: string }) =>
      updateDocumentRequest(envelopeId, documentId, payload, tenantId),
    onSuccess: async (result) => {
      queryClient.setQueryData(['esigning', 'detail', tenantId, envelopeId], result);
      await invalidateEnvelopeQueries(queryClient, tenantId);
    },
  });
}

export function useDeleteEsigningDocument(envelopeId: string, documentId: string) {
  const tenantId = useEsigningTenant();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => deleteDocumentRequest(envelopeId, documentId, tenantId),
    onSuccess: async (result) => {
      queryClient.setQueryData(['esigning', 'detail', tenantId, envelopeId], result);
      await invalidateEnvelopeQueries(queryClient, tenantId);
    },
  });
}

export function useAttachGeneratedEsigningDocuments(envelopeId: string) {
  const tenantId = useEsigningTenant();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (generatedDocumentIds: string[]) =>
      attachGeneratedDocumentsRequest(envelopeId, generatedDocumentIds, tenantId),
    onSuccess: async (result) => {
      queryClient.setQueryData(['esigning', 'detail', tenantId, envelopeId], result);
      await invalidateEnvelopeQueries(queryClient, tenantId);
    },
  });
}

export function useSaveEsigningFields(envelopeId: string) {
  const tenantId = useEsigningTenant();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (fields: EsigningFieldDefinitionInput[]) =>
      saveFieldsRequest(envelopeId, fields, tenantId),
    onSuccess: async (result) => {
      queryClient.setQueryData(['esigning', 'detail', tenantId, envelopeId], result);
      await invalidateEnvelopeQueries(queryClient, tenantId);
    },
  });
}

export function useSendEsigningEnvelope(envelopeId: string) {
  const tenantId = useEsigningTenant();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (taskContext?: TaskLaunchContext) => (
      sendEnvelopeRequest(envelopeId, tenantId, taskContext)
    ),
    onSuccess: async (result) => {
      queryClient.setQueryData(['esigning', 'detail', tenantId, envelopeId], result.envelope);
      await invalidateEnvelopeQueries(queryClient, tenantId);
    },
  });
}

export function useVoidEsigningEnvelope(envelopeId: string) {
  const tenantId = useEsigningTenant();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (reason?: string | null) =>
      voidEnvelopeRequest(envelopeId, { tenantId, reason }),
    onSuccess: async (result) => {
      queryClient.setQueryData(['esigning', 'detail', tenantId, envelopeId], result);
      await invalidateEnvelopeQueries(queryClient, tenantId);
    },
  });
}

export function useResendEsigningRecipient(envelopeId: string, recipientId: string) {
  const tenantId = useEsigningTenant();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => resendRecipientRequest(envelopeId, recipientId, tenantId),
    onSuccess: async (result) => {
      queryClient.setQueryData(['esigning', 'detail', tenantId, envelopeId], result.envelope);
      await invalidateEnvelopeQueries(queryClient, tenantId);
    },
  });
}

export function useEsigningRecipientManualLink(envelopeId: string, recipientId: string) {
  const tenantId = useEsigningTenant();

  return useMutation({
    mutationFn: () => recipientManualLinkRequest(envelopeId, recipientId, tenantId),
  });
}

export function useRetryEsigningEnvelopeProcessing(envelopeId: string) {
  const tenantId = useEsigningTenant();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => retryEnvelopeProcessingRequest(envelopeId, tenantId),
    onSuccess: async (result) => {
      queryClient.setQueryData(['esigning', 'detail', tenantId, envelopeId], result);
      await invalidateEnvelopeQueries(queryClient, tenantId);
    },
  });
}

export function useResendEsigningEnvelope() {
  const tenantId = useEsigningTenant();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (envelopeId: string) => resendEnvelopeRequest(envelopeId, tenantId),
    onSuccess: async (result, envelopeId) => {
      queryClient.setQueryData(['esigning', 'detail', tenantId, envelopeId], result.envelope);
      await invalidateEnvelopeQueries(queryClient, tenantId);
    },
  });
}
