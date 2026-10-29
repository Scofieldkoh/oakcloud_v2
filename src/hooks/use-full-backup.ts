/**
 * Hooks for full (whole-install) backups: list, create, upload, check, restore
 * and the backup password / schedule settings.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export type BackupStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'RESTORING' | 'RESTORED' | 'DELETED';

const STATUS_LABELS: Record<BackupStatus, string> = {
  PENDING: 'Pending',
  IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  RESTORING: 'Restoring',
  RESTORED: 'Restored',
  DELETED: 'Deleted',
};

export function getBackupStatusLabel(status: BackupStatus): string {
  return STATUS_LABELS[status] ?? status;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export type SystemBackupSource = 'MANUAL' | 'SCHEDULED' | 'UPLOADED';

export interface SystemBackup {
  id: string;
  name: string;
  source: SystemBackupSource;
  status: BackupStatus;
  archiveKey: string | null;
  sizeBytes: number;
  rowsCount: number;
  filesCount: number;
  manifestJson: {
    skippedFiles?: Array<{ key: string; reason: string }>;
    lockedSecrets?: number;
    workspaces?: Array<{ id: string; name: string }>;
  } | null;
  progress: number;
  currentStep: string | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  restoredAt: string | null;
  sharePointStatus: 'UPLOADING' | 'UPLOADED' | 'FAILED' | null;
  sharePointWebUrl: string | null;
  sharePointError: string | null;
  sharePointUploadedAt: string | null;
}

export interface SharePointBackupTarget {
  connectorId: string;
  connectorName: string | null;
  workspaceName: string | null;
  driveId: string;
  folderId: string;
  folderName: string;
  folderUrl: string;
  maxBackups: number;
}

export interface SharePointBackupConnector {
  id: string;
  name: string;
  workspaceId: string;
  workspaceName: string;
}

export interface SharePointBackupFile {
  itemId: string;
  name: string;
  size: number;
  webUrl: string;
  createdAt: string | null;
  backupId: string | null;
}

export interface FullBackupPreview {
  backupId: string;
  name: string;
  createdAt: string;
  workspaces: Array<{ id: string; name: string }>;
  totals: { rows: number; files: number; fileBytes: number };
  counts: { users: number; companies: number; contacts: number; documents: number; templates: number; connectors: number };
  skippedFiles: number;
  lockedSecrets: number;
  blockers: string[];
  warnings: string[];
  modules: BackupModuleSummary[];
}

export interface BackupModuleSummary {
  key: string;
  label: string;
  description: string;
  backupRows: number;
  liveRows: number;
}

export interface ModuleChange {
  module: string;
  label: string;
  added: number;
  replaced: number;
  removed: number;
  unchanged: number;
}

export interface ModuleRestorePreview {
  backupId: string;
  modules: string[];
  changes: ModuleChange[];
  links: Array<{ fromModule: string; toModule: string; addModule: string; rows: number; message: string }>;
  suggestedModules: string[];
  missingFiles: number;
  blockers: string[];
  warnings: string[];
}

export interface BackupSettings {
  hasPassword: boolean;
  passwordUpdatedAt: string | null;
  scheduleEnabled: boolean;
  cronPattern: string;
  timezone: string;
  maxBackups: number;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastError: string | null;
}

interface FullBackupsResponse {
  backups: SystemBackup[];
  totalCount: number;
  totalPages: number;
}

/** Chunks stay under the API's 10 MB request limit. */
const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;
const RUNNING: BackupStatus[] = ['PENDING', 'IN_PROGRESS', 'RESTORING'];

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body as T;
}

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

export const fullBackupKeys = {
  all: ['full-backups'] as const,
  list: (page: number) => ['full-backups', 'list', page] as const,
  settings: ['full-backups', 'settings'] as const,
  sharePoint: ['full-backups', 'sharepoint'] as const,
  sharePointFiles: ['full-backups', 'sharepoint', 'files'] as const,
};

export function useFullBackups(page: number) {
  return useQuery({
    queryKey: fullBackupKeys.list(page),
    queryFn: () => requestJson<FullBackupsResponse>(`/api/admin/backup/full?page=${page}&limit=20`),
    // Poll while anything is running so progress bars move.
    refetchInterval: (query) =>
      query.state.data?.backups.some((backup) => RUNNING.includes(backup.status) || backup.sharePointStatus === 'UPLOADING')
        ? 2000
        : false,
  });
}

export function useBackupSettings() {
  return useQuery({
    queryKey: fullBackupKeys.settings,
    queryFn: () => requestJson<BackupSettings>('/api/admin/backup/settings'),
  });
}

function useInvalidatingMutation<TInput, TResult>(mutationFn: (input: TInput) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: () => queryClient.invalidateQueries({ queryKey: fullBackupKeys.all }),
  });
}

export function useCreateFullBackup() {
  return useInvalidatingMutation((input: { name?: string }) =>
    requestJson<{ backupId: string }>('/api/admin/backup/full', jsonInit('POST', input)));
}

export function useDeleteFullBackup() {
  return useInvalidatingMutation((backupId: string) =>
    requestJson<{ success: boolean }>(`/api/admin/backup/full/${backupId}`, { method: 'DELETE' }));
}

export function useStopFullBackup() {
  return useInvalidatingMutation((backupId: string) =>
    requestJson<{ stopped: boolean }>(`/api/admin/backup/full/${backupId}/stop`, { method: 'POST' }));
}

export function useSetBackupPassword() {
  return useInvalidatingMutation((password: string) =>
    requestJson<{ success: boolean }>('/api/admin/backup/settings/password', jsonInit('PUT', { password })));
}

export function useUpdateBackupSchedule() {
  return useInvalidatingMutation((input: Pick<BackupSettings, 'scheduleEnabled' | 'cronPattern' | 'timezone' | 'maxBackups'>) =>
    requestJson<BackupSettings>('/api/admin/backup/settings', jsonInit('PUT', input)));
}

export function usePreviewFullRestore() {
  return useMutation({
    mutationFn: (input: { backupId: string; password: string }) =>
      requestJson<FullBackupPreview>(`/api/admin/backup/full/${input.backupId}/preview`, jsonInit('POST', { password: input.password })),
  });
}

export function useStartFullRestore() {
  return useInvalidatingMutation((input: { backupId: string; password: string; confirmation: string }) =>
    requestJson<{ started: boolean }>(`/api/admin/backup/full/${input.backupId}/restore`, jsonInit('POST', {
      password: input.password,
      confirmation: input.confirmation,
    })));
}

export function usePreviewModuleRestore() {
  return useMutation({
    mutationFn: (input: { backupId: string; password: string; modules: string[] }) =>
      requestJson<ModuleRestorePreview>(`/api/admin/backup/full/${input.backupId}/modules/preview`, jsonInit('POST', {
        password: input.password,
        modules: input.modules,
      })),
  });
}

export function useStartModuleRestore() {
  return useInvalidatingMutation((input: {
    backupId: string;
    password: string;
    modules: string[];
    restoreMissingFiles: boolean;
    confirmation: string;
  }) =>
    requestJson<{ started: boolean }>(`/api/admin/backup/full/${input.backupId}/modules/restore`, jsonInit('POST', {
      password: input.password,
      modules: input.modules,
      restoreMissingFiles: input.restoreMissingFiles,
      confirmation: input.confirmation,
    })));
}

/** Uploads a backup file in chunks, reporting progress from 0 to 1. */
export function useUploadFullBackup(onProgress: (fraction: number) => void) {
  return useInvalidatingMutation(async (file: File) => {
    const { backupId } = await requestJson<{ backupId: string }>(
      '/api/admin/backup/full/uploads',
      jsonInit('POST', { fileName: file.name, size: file.size }),
    );
    for (let offset = 0; offset < file.size; offset += UPLOAD_CHUNK_BYTES) {
      const chunk = file.slice(offset, offset + UPLOAD_CHUNK_BYTES);
      await requestJson(`/api/admin/backup/full/uploads/${backupId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream', 'X-Upload-Offset': String(offset) },
        body: chunk,
      });
      onProgress(Math.min(1, (offset + chunk.size) / file.size));
    }
    await requestJson(`/api/admin/backup/full/uploads/${backupId}`, { method: 'POST' });
    return { backupId };
  });
}

export function fullBackupDownloadUrl(backupId: string): string {
  return `/api/admin/backup/full/${backupId}/download`;
}

export function isRunning(status: BackupStatus): boolean {
  return RUNNING.includes(status);
}

export function useSharePointBackupTarget() {
  return useQuery({
    queryKey: fullBackupKeys.sharePoint,
    queryFn: () =>
      requestJson<{ target: SharePointBackupTarget | null; connectors: SharePointBackupConnector[] }>('/api/admin/backup/sharepoint'),
  });
}

export function useSaveSharePointBackupTarget() {
  return useInvalidatingMutation((input: { connectorId: string; folderId: string; maxBackups: number }) =>
    requestJson<{ target: SharePointBackupTarget }>('/api/admin/backup/sharepoint', jsonInit('PUT', input)));
}

export function useClearSharePointBackupTarget() {
  return useInvalidatingMutation((_input: void) =>
    requestJson<{ success: boolean }>('/api/admin/backup/sharepoint', { method: 'DELETE' }));
}

export function useSharePointBackupFiles(enabled: boolean) {
  return useQuery({
    queryKey: fullBackupKeys.sharePointFiles,
    queryFn: () => requestJson<{ files: SharePointBackupFile[] }>('/api/admin/backup/sharepoint/files'),
    enabled,
  });
}

export function useImportSharePointBackup() {
  return useInvalidatingMutation((itemId: string) =>
    requestJson<{ backupId: string }>('/api/admin/backup/sharepoint/files', jsonInit('POST', { itemId })));
}

export function useCopyBackupToSharePoint() {
  return useInvalidatingMutation((backupId: string) =>
    requestJson<{ success: boolean }>(`/api/admin/backup/full/${backupId}/sharepoint`, { method: 'POST' }));
}
