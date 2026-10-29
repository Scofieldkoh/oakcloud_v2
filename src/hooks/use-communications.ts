import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from '@/hooks/use-auth';
import { useActiveWorkspaceId } from '@/components/ui/workspace-selector';
import {
  usePersistSessionListSnapshot,
  useSessionListRestore,
} from '@/hooks/use-session-query-restore';

export interface CommunicationConnectorStatus {
  configured: boolean;
  reason?: 'missing_connector' | 'missing_mailboxes';
  message?: string;
  provider?: 'ONEDRIVE' | 'SHAREPOINT';
  source?: 'tenant' | 'system';
  connectorId?: string;
  mailboxUserIds: string[];
  ingestAllEmails: boolean;
}

export interface CommunicationItem {
  id: string;
  companyId: string;
  companyName: string;
  isUnmatched: boolean;
  subject: string | null;
  preview: string;
  body: string;
  fromEmail: string | null;
  toEmails: string[];
  mailboxUserId: string | null;
  receivedAt: string;
}

export interface CommunicationsResponse {
  connector: CommunicationConnectorStatus;
  communications: CommunicationItem[];
}

function isCommunicationsResponse(value: unknown): value is CommunicationsResponse {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<CommunicationsResponse>;
  return (
    !!candidate.communications &&
    Array.isArray(candidate.communications) &&
    !!candidate.connector &&
    typeof candidate.connector === 'object'
  );
}

export interface IngestCommunicationsInput {
  lookbackDays: number;
  maxMessagesPerMailbox?: number;
}

export interface IngestCommunicationsResult {
  connectorProvider: 'ONEDRIVE' | 'SHAREPOINT';
  connectorSource: 'tenant' | 'system';
  mailboxUserIds: string[];
  lookbackDays: number;
  scannedMessages: number;
  matchedCompanies: number;
  storedCommunications: number;
  skippedExistingCommunications: number;
  importedCompanyEmails: number;
}

export interface UpdateCommunicationMailboxesInput {
  mailboxUserIds?: string[];
  ingestAllEmails?: boolean;
}

export interface DeleteCommunicationInput {
  id: string;
}

export interface BulkDeleteCommunicationsInput {
  ids: string[];
}

export function useCommunications(limit: number = 100) {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const activeTenantId = useActiveWorkspaceId(
    session?.isSuperAdmin ?? false,
    session?.tenantId
  );
  const queryKey = ['communications', activeTenantId, limit] as const;
  const { initialData, restoredFromSession } = useSessionListRestore<CommunicationsResponse>(
    queryClient,
    queryKey,
    { validate: isCommunicationsResponse },
  );

  const query = useQuery<CommunicationsResponse>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('limit', String(limit));
      if (activeTenantId) {
        params.set('tenantId', activeTenantId);
      }

      const response = await fetch(`/api/communications?${params.toString()}`);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch communications');
      }

      return response.json();
    },
    initialData,
    initialDataUpdatedAt: restoredFromSession ? 0 : undefined,
  });

  usePersistSessionListSnapshot(queryKey, query.data);

  return query;
}

export function useIngestCommunications() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const activeTenantId = useActiveWorkspaceId(
    session?.isSuperAdmin ?? false,
    session?.tenantId
  );

  return useMutation<IngestCommunicationsResult, Error, IngestCommunicationsInput>({
    mutationFn: async (data) => {
      const response = await fetch('/api/communications/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          tenantId: activeTenantId,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to ingest communications');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['communications'] });
    },
  });
}

export function useUpdateCommunicationMailboxes() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const activeTenantId = useActiveWorkspaceId(
    session?.isSuperAdmin ?? false,
    session?.tenantId
  );

  return useMutation<
    { connector: CommunicationConnectorStatus },
    Error,
    UpdateCommunicationMailboxesInput
  >({
    mutationFn: async (data) => {
      const response = await fetch('/api/communications/mailboxes', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          tenantId: activeTenantId,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to update mailbox settings');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['communications'] });
    },
  });
}

export function useDeleteCommunication() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const activeTenantId = useActiveWorkspaceId(
    session?.isSuperAdmin ?? false,
    session?.tenantId
  );

  return useMutation<{ success: boolean }, Error, DeleteCommunicationInput>({
    mutationFn: async ({ id }) => {
      const response = await fetch(`/api/communications/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: activeTenantId,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete communication');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['communications'] });
    },
  });
}

export function useBulkDeleteCommunications() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const activeTenantId = useActiveWorkspaceId(
    session?.isSuperAdmin ?? false,
    session?.tenantId
  );

  return useMutation<
    { deleted: number; skipped: number },
    Error,
    BulkDeleteCommunicationsInput
  >({
    mutationFn: async ({ ids }) => {
      const response = await fetch('/api/communications/bulk', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: activeTenantId,
          ids,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to bulk delete communications');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['communications'] });
    },
  });
}
