/**
 * data.gov.sg dataset client (server-only)
 *
 * Small, bounded client for single data.gov.sg datasets: dataset metadata and
 * the initiate/poll download flow. Requests go only to fixed government hosts
 * and to the presigned S3 bucket data.gov.sg hands out for downloads.
 *
 * The ACRA sync keeps its own copy of this logic; it is not migrated here to
 * keep that import path unchanged.
 */

const METADATA_HOST = 'https://api-production.data.gov.sg';
const DOWNLOAD_API_HOST = 'https://api-open.data.gov.sg';

// data.gov.sg returns presigned URLs to this S3 bucket for dataset downloads.
const DOWNLOAD_BUCKET_HOSTS = new Set(['s3.ap-southeast-1.amazonaws.com']);
const DOWNLOAD_BUCKET_PATH_PREFIX = '/table-downloads-ingest.data.gov.sg/';

const DATASET_ID_PATTERN = /^d_[a-f0-9]{32}$/;

export const DATA_GOV_SG_REQUEST_TIMEOUT_MS = 30_000;

// A browser-like User-Agent keeps the request from being blocked by the
// WAF/CloudFront layers in front of the government endpoints.
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

export interface DataGovSgDatasetMetadata {
  datasetId: string;
  name: string | null;
  lastUpdatedAt: string;
  format: string | null;
  managedBy: string | null;
}

export interface DataGovSgDownloadOptions {
  pollAttempts?: number;
  pollBackoffMs?: number;
  timeoutMs?: number;
}

interface DownloadApiResponse {
  data?: {
    status?: string;
    url?: string;
    message?: string;
  } | null;
}

export function assertDataGovSgDatasetId(datasetId: string): void {
  if (!DATASET_ID_PATTERN.test(datasetId)) {
    throw new Error(`Invalid data.gov.sg dataset id: ${datasetId}`);
  }
}

function getApiHeaders(): Record<string, string> {
  const apiKey = process.env.DATAGOV_API_KEY || '';
  return {
    Accept: 'application/json',
    'User-Agent': USER_AGENT,
    ...(apiKey ? { 'x-api-key': apiKey } : {}),
  };
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    return await fetch(url, { ...init, cache: 'no-store', signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** True for the presigned download URLs data.gov.sg hands out. */
export function isAllowedDataGovSgDownloadUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  if (url.hostname.endsWith('.data.gov.sg')) return true;
  return DOWNLOAD_BUCKET_HOSTS.has(url.hostname) && url.pathname.startsWith(DOWNLOAD_BUCKET_PATH_PREFIX);
}

/** Read one dataset's metadata; throws when the response is unusable. */
export async function fetchDataGovSgDatasetMetadata(datasetId: string): Promise<DataGovSgDatasetMetadata> {
  assertDataGovSgDatasetId(datasetId);
  const response = await fetchWithTimeout(
    `${METADATA_HOST}/v2/public/api/datasets/${datasetId}/metadata`,
    { method: 'GET', headers: getApiHeaders() },
    DATA_GOV_SG_REQUEST_TIMEOUT_MS,
  );
  if (!response.ok) {
    throw new Error(`dataset metadata returned ${response.status}`);
  }
  const body = (await response.json()) as { data?: Record<string, unknown> | null };
  const data = body?.data;
  const lastUpdatedAt = data?.lastUpdatedAt;
  if (typeof lastUpdatedAt !== 'string' || !lastUpdatedAt.trim()) {
    throw new Error('dataset metadata has no lastUpdatedAt');
  }
  const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);
  return {
    datasetId,
    name: text(data?.name),
    lastUpdatedAt: lastUpdatedAt.trim(),
    format: text(data?.format),
    managedBy: text(data?.managedBy),
  };
}

/** Obtain a download URL for one dataset via the initiate/poll endpoints. */
export async function requestDataGovSgDownloadUrl(
  datasetId: string,
  options: DataGovSgDownloadOptions = {},
): Promise<string> {
  assertDataGovSgDatasetId(datasetId);
  const pollAttempts = options.pollAttempts ?? 5;
  const pollBackoffMs = options.pollBackoffMs ?? 3_000;
  const accept = (url: string | undefined): string | null => {
    if (!url) return null;
    if (!isAllowedDataGovSgDownloadUrl(url)) {
      throw new Error(`dataset ${datasetId} download URL is not on an allowed host`);
    }
    return url;
  };

  const initiate = await fetchWithTimeout(
    `${DOWNLOAD_API_HOST}/v1/public/api/datasets/${datasetId}/initiate-download`,
    { method: 'GET', headers: getApiHeaders() },
    DATA_GOV_SG_REQUEST_TIMEOUT_MS,
  );
  if (initiate.ok) {
    const body = (await initiate.json()) as DownloadApiResponse;
    const url = accept(body?.data?.url);
    if (url) return url;
  }

  for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
    const poll = await fetchWithTimeout(
      `${DOWNLOAD_API_HOST}/v1/public/api/datasets/${datasetId}/poll-download`,
      { method: 'GET', headers: getApiHeaders() },
      DATA_GOV_SG_REQUEST_TIMEOUT_MS,
    );
    if (!poll.ok) {
      throw new Error(`dataset ${datasetId} download poll returned ${poll.status}`);
    }
    const body = (await poll.json()) as DownloadApiResponse;
    const url = accept(body?.data?.url);
    if (url) return url;
    if (body?.data?.status !== 'DOWNLOAD_PROCESSING') {
      throw new Error(`dataset ${datasetId} download returned unexpected status: ${body?.data?.status ?? 'unknown'}`);
    }
    await sleep(pollBackoffMs);
  }

  throw new Error(`dataset ${datasetId} download did not become ready`);
}

/** Download a small dataset file as text. */
export async function downloadDataGovSgDatasetText(
  datasetId: string,
  options: DataGovSgDownloadOptions & { maxBytes?: number } = {},
): Promise<string> {
  const url = await requestDataGovSgDownloadUrl(datasetId, options);
  const response = await fetchWithTimeout(
    url,
    // Presigned URLs never redirect; refusing redirects keeps the host allowlist meaningful.
    { method: 'GET', headers: { 'User-Agent': USER_AGENT }, redirect: 'error' },
    options.timeoutMs ?? DATA_GOV_SG_REQUEST_TIMEOUT_MS,
  );
  if (!response.ok) {
    throw new Error(`dataset ${datasetId} download returned ${response.status}`);
  }
  const text = await response.text();
  const maxBytes = options.maxBytes ?? 5 * 1024 * 1024;
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    throw new Error(`dataset ${datasetId} download is larger than expected`);
  }
  return text;
}
