import { randomUUID } from 'node:crypto';
import { basename, extname } from 'node:path';
import { incrementConnectorUsage, resolveConnector } from '@/services/connector.service';
import { ApiError, ErrorCodes } from '@/lib/errors';
import { createLogger } from '@/lib/logger';

const log = createLogger('microsoft-graph-conversion');

type FetchLike = typeof fetch;

interface MicrosoftGraphCredentials {
  clientId: string;
  clientSecret: string;
  tenantId: string;
  siteId?: string;
  driveId?: string;
  userId?: string;
}

interface MicrosoftGraphSettings {
  rootFolder?: string;
  driveId?: string;
  userId?: string;
}

interface GraphResolvedConnector {
  connector: {
    id: string;
    provider: string;
    credentials: Record<string, unknown>;
    settings: unknown;
  };
}

const WORD_DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function toBodyArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

function asSettings(value: unknown): MicrosoftGraphSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as MicrosoftGraphSettings;
}

function asCredentials(value: Record<string, unknown>): MicrosoftGraphCredentials {
  return value as unknown as MicrosoftGraphCredentials;
}

async function readGraphError(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null) as
    | { error?: { message?: string }; error_description?: string; errorMessage?: string }
    | null;

  return body?.error?.message || body?.error_description || body?.errorMessage || fallback;
}

async function acquireGraphToken(
  credentials: MicrosoftGraphCredentials,
  fetchImpl: FetchLike
): Promise<string> {
  const response = await fetchImpl(
    `https://login.microsoftonline.com/${credentials.tenantId}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials',
      }),
    }
  );

  if (!response.ok) {
    throw new Error(await readGraphError(response, 'Failed to acquire Microsoft Graph access token'));
  }

  const data = await response.json() as { access_token?: string };
  if (!data.access_token) {
    throw new Error('Microsoft Graph token response did not include an access token');
  }

  return data.access_token;
}

function getDriveBaseUrl(input: {
  provider: string;
  credentials: MicrosoftGraphCredentials;
  settings: MicrosoftGraphSettings;
}): string {
  const driveId = input.credentials.driveId || input.settings.driveId;
  const userId = input.credentials.userId || input.settings.userId;

  if (input.provider === 'SHAREPOINT') {
    if (!input.credentials.siteId) {
      throw new Error('SharePoint connector must include a siteId for Word-to-PDF conversion');
    }

    return driveId
      ? `https://graph.microsoft.com/v1.0/sites/${input.credentials.siteId}/drives/${driveId}`
      : `https://graph.microsoft.com/v1.0/sites/${input.credentials.siteId}/drive`;
  }

  if (driveId) {
    return `https://graph.microsoft.com/v1.0/drives/${driveId}`;
  }

  if (userId) {
    return `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userId)}/drive`;
  }

  throw new Error('OneDrive connector must include driveId or userId for Word-to-PDF conversion');
}

function encodeGraphPath(path: string): string {
  return path
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function sanitizeTempFileName(fileName: string): string {
  const extension = extname(fileName) || '.docx';
  const rawBaseName = basename(fileName, extension) || 'document';
  const safeBaseName = rawBaseName.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'document';
  return `.oakcloud-esigning-${randomUUID()}-${safeBaseName}${extension}`;
}

function getTemporaryUploadPath(settings: MicrosoftGraphSettings, fileName: string): string {
  const rootFolder = settings.rootFolder?.replace(/^\/+|\/+$/g, '');
  const tempFileName = sanitizeTempFileName(fileName);
  return rootFolder ? `${rootFolder}/${tempFileName}` : tempFileName;
}

async function resolveMicrosoftGraphStorageConnector(tenantId: string): Promise<GraphResolvedConnector> {
  // Selection mirrors hasMicrosoftGraphDocumentConversionConnector(): an
  // unusable SharePoint connector falls through to a usable OneDrive one.
  const sharePoint = await resolveConnector(tenantId, 'STORAGE', 'SHAREPOINT') as GraphResolvedConnector | null;
  if (isGraphConversionConnectorUsable(sharePoint)) return sharePoint as GraphResolvedConnector;
  const oneDrive = await resolveConnector(tenantId, 'STORAGE', 'ONEDRIVE') as GraphResolvedConnector | null;
  if (isGraphConversionConnectorUsable(oneDrive)) return oneDrive as GraphResolvedConnector;

  if (!sharePoint && !oneDrive) {
    throw new GraphConversionUnavailableError('Configure a SharePoint or OneDrive connector before uploading Word documents');
  }
  throw new GraphConversionUnavailableError(
    'Configure a SharePoint or OneDrive connector with a valid document library before uploading Word documents',
  );
}

function isGraphConversionConnectorUsable(resolved: GraphResolvedConnector | null): boolean {
  if (!resolved) {
    return false;
  }

  const credentials = asCredentials(resolved.connector.credentials);
  const settings = asSettings(resolved.connector.settings);

  if (resolved.connector.provider === 'SHAREPOINT') {
    return Boolean(credentials.siteId);
  }

  if (resolved.connector.provider === 'ONEDRIVE') {
    return Boolean(credentials.driveId || settings.driveId || credentials.userId || settings.userId);
  }

  return false;
}

export async function hasMicrosoftGraphDocumentConversionConnector(tenantId: string): Promise<boolean> {
  const sharePointConnector = await resolveConnector(tenantId, 'STORAGE', 'SHAREPOINT') as GraphResolvedConnector | null;
  if (isGraphConversionConnectorUsable(sharePointConnector)) {
    return true;
  }

  const oneDriveConnector = await resolveConnector(tenantId, 'STORAGE', 'ONEDRIVE') as GraphResolvedConnector | null;
  return isGraphConversionConnectorUsable(oneDriveConnector);
}

const GRAPH_REQUEST_TIMEOUT_MS = 60_000;
const GRAPH_MAX_RETRIES = 2;
const GRAPH_MAX_RETRY_DELAY_MS = 10_000;

/** No connector is usable; conversion (PDF/signing) is unavailable, DOCX still works. */
export class GraphConversionUnavailableError extends ApiError {
  constructor(message: string) {
    super(ErrorCodes.SERVICE_UNAVAILABLE, message, 503, { reason: 'OAKDOC_CONVERTER_UNAVAILABLE' });
    this.name = 'GraphConversionUnavailableError';
  }
}

/** Microsoft 365 rejected or failed the conversion request. */
export class GraphConversionError extends ApiError {
  constructor(message: string, public readonly status?: number) {
    super(ErrorCodes.SERVICE_UNAVAILABLE, message, 503, {
      reason: 'OAKDOC_CONVERTER_UNAVAILABLE',
      ...(status ? { status } : {}),
    });
    this.name = 'GraphConversionError';
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new GraphConversionError('Microsoft 365 conversion was cancelled'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new GraphConversionError('Microsoft 365 conversion was cancelled'));
    }, { once: true });
  });
}

function retryDelayMs(response: Response, attempt: number): number {
  const header = Number(response.headers.get('retry-after'));
  const seconds = Number.isFinite(header) && header > 0 ? header : 2 ** attempt;
  return Math.min(seconds * 1000, GRAPH_MAX_RETRY_DELAY_MS);
}

/**
 * Bounded Graph request: per-attempt timeout, caller cancellation and a small
 * number of retries for throttling (429) and transient (502/503/504) replies.
 */
async function graphFetch(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    if (signal?.aborted) throw new GraphConversionError('Microsoft 365 conversion was cancelled');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GRAPH_REQUEST_TIMEOUT_MS);
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    let response: Response;
    try {
      response = await fetchImpl(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new GraphConversionError(
          signal?.aborted ? 'Microsoft 365 conversion was cancelled' : 'Microsoft 365 conversion timed out',
        );
      }
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
    const transient = response.status === 429 || response.status === 502
      || response.status === 503 || response.status === 504;
    if (!transient || attempt >= GRAPH_MAX_RETRIES) return response;
    await sleep(retryDelayMs(response, attempt), signal);
  }
}

async function graphJson<T>(
  fetchImpl: FetchLike,
  url: string,
  token: string,
  options: RequestInit,
  signal?: AbortSignal,
): Promise<T> {
  const response = await graphFetch(fetchImpl, url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers ?? {}),
    },
  }, signal);

  if (!response.ok) {
    throw new GraphConversionError(
      await readGraphError(response, `Microsoft Graph request failed: ${response.status}`),
      response.status,
    );
  }

  return response.json() as Promise<T>;
}

async function graphDelete(fetchImpl: FetchLike, url: string, token: string): Promise<void> {
  const response = await graphFetch(fetchImpl, url, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok && response.status !== 404) {
    throw new Error(await readGraphError(response, `Failed to delete temporary Graph item: ${response.status}`));
  }
}

export interface GraphPdfConversionResult {
  buffer: Buffer;
  connectorId: string;
  provider: string;
  /** Temporary-file cleanup failed; the PDF is still valid. */
  cleanupFailed: boolean;
}

export async function convertOfficeDocumentToPdfWithMicrosoftGraphDetailed(input: {
  tenantId: string;
  fileName: string;
  mimeType?: string;
  buffer: Buffer;
  fetchImpl?: FetchLike;
  signal?: AbortSignal;
}): Promise<GraphPdfConversionResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const resolved = await resolveMicrosoftGraphStorageConnector(input.tenantId);
  const credentials = asCredentials(resolved.connector.credentials);
  const settings = asSettings(resolved.connector.settings);
  const token = await acquireGraphToken(credentials, fetchImpl);
  const driveBaseUrl = getDriveBaseUrl({
    provider: resolved.connector.provider,
    credentials,
    settings,
  });
  const temporaryPath = getTemporaryUploadPath(settings, input.fileName);

  let uploadedItemId: string | null = null;
  let result: Buffer | null = null;
  let primaryError: unknown = null;

  try {
    const uploaded = await graphJson<{ id: string }>(
      fetchImpl,
      `${driveBaseUrl}/root:/${encodeGraphPath(temporaryPath)}:/content?@microsoft.graph.conflictBehavior=replace`,
      token,
      {
        method: 'PUT',
        headers: {
          'Content-Type': input.mimeType || WORD_DOCX_MIME_TYPE,
        },
        body: toBodyArrayBuffer(input.buffer),
      },
      input.signal,
    );
    uploadedItemId = uploaded.id;

    const pdfResponse = await graphFetch(fetchImpl, `${driveBaseUrl}/items/${uploaded.id}/content?format=pdf`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }, input.signal);

    if (!pdfResponse.ok) {
      throw new GraphConversionError(
        await readGraphError(pdfResponse, `Microsoft Graph PDF conversion failed: ${pdfResponse.status}`),
        pdfResponse.status,
      );
    }

    const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer());
    if (!pdfBuffer.subarray(0, 4).equals(Buffer.from('%PDF'))) {
      throw new GraphConversionError('Microsoft Graph conversion response was not a PDF');
    }

    await incrementConnectorUsage(resolved.connector.id);
    result = pdfBuffer;
  } catch (error) {
    primaryError = error;
  }

  // Cleanup never masks the primary error and never discards a good PDF.
  let cleanupFailed = false;
  if (uploadedItemId) {
    try {
      await graphDelete(fetchImpl, `${driveBaseUrl}/items/${uploadedItemId}`, token);
    } catch (error) {
      cleanupFailed = true;
      log.warn('Failed to delete temporary Microsoft 365 conversion file', {
        connectorId: resolved.connector.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (primaryError || !result) throw primaryError;
  return {
    buffer: result,
    connectorId: resolved.connector.id,
    provider: resolved.connector.provider,
    cleanupFailed,
  };
}

export async function convertOfficeDocumentToPdfWithMicrosoftGraph(input: {
  tenantId: string;
  fileName: string;
  mimeType?: string;
  buffer: Buffer;
  fetchImpl?: FetchLike;
  signal?: AbortSignal;
}): Promise<Buffer> {
  return (await convertOfficeDocumentToPdfWithMicrosoftGraphDetailed(input)).buffer;
}
