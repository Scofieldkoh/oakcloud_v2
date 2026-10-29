/**
 * Typed fetch boundary for the batch generation APIs.
 *
 * Every mutation sends the expected revision; server-owned fields are never
 * included. Responses are parsed once and structured errors are preserved.
 */

import type {
  BatchExecutionInput,
  BatchGenerationResult,
  BatchItemMutationInput,
  CreateDocumentGenerationBatchInput,
  DocumentGenerationBatchDto,
  DocumentGenerationBatchListItem,
  UpdateDocumentGenerationBatchInput,
} from '@/types/document-generation-batch';

export class DocumentGenerationBatchApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'DocumentGenerationBatchApiError';
  }
}

async function request<T>(
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init.headers,
    },
    signal: signal ?? init.signal,
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new DocumentGenerationBatchApiError(
      (body as { error?: string } | null)?.error ?? 'Request failed',
      response.status,
      (body as { details?: unknown } | null)?.details,
    );
  }
  return body as T;
}

function mutation(input: { expectedRevision: number }, signal?: AbortSignal) {
  return {
    method: 'POST' as const,
    body: JSON.stringify(input),
    signal,
  };
}

export function createDocumentGenerationBatch(
  input: CreateDocumentGenerationBatchInput,
  signal?: AbortSignal,
): Promise<DocumentGenerationBatchDto> {
  return request('/api/document-generation-batches', {
    method: 'POST',
    body: JSON.stringify(input),
  }, signal);
}

export async function listDocumentGenerationBatches(
  signal?: AbortSignal,
): Promise<DocumentGenerationBatchListItem[]> {
  const body = await request<{ batches: DocumentGenerationBatchListItem[] }>(
    '/api/document-generation-batches',
    { method: 'GET', signal },
  );
  return body.batches;
}

export function getDocumentGenerationBatch(
  id: string,
  signal?: AbortSignal,
): Promise<DocumentGenerationBatchDto> {
  return request(`/api/document-generation-batches/${encodeURIComponent(id)}`, {
    method: 'GET',
    signal,
  });
}

export function saveDocumentGenerationBatch(
  id: string,
  input: UpdateDocumentGenerationBatchInput,
  signal?: AbortSignal,
): Promise<DocumentGenerationBatchDto> {
  return request(`/api/document-generation-batches/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  }, signal);
}

export function discardDocumentGenerationBatch(
  id: string,
  expectedRevision?: number,
  signal?: AbortSignal,
): Promise<{ discardedItemCount: number; preservedItemCount: number }> {
  return request(`/api/document-generation-batches/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    body: JSON.stringify({ expectedRevision }),
  }, signal);
}

export function previewDocumentGenerationBatchItem(
  batchId: string,
  itemId: string,
  input: BatchItemMutationInput,
  signal?: AbortSignal,
): Promise<DocumentGenerationBatchDto> {
  return request(
    `/api/document-generation-batches/${encodeURIComponent(batchId)}/items/${encodeURIComponent(itemId)}/preview`,
    mutation(input, signal),
  );
}

export function reviewDocumentGenerationBatchItem(
  batchId: string,
  itemId: string,
  input: BatchItemMutationInput,
  signal?: AbortSignal,
): Promise<DocumentGenerationBatchDto> {
  return request(
    `/api/document-generation-batches/${encodeURIComponent(batchId)}/items/${encodeURIComponent(itemId)}/review`,
    mutation(input, signal),
  );
}

export function preflightDocumentGenerationBatch(
  batchId: string,
  input: BatchExecutionInput,
  signal?: AbortSignal,
): Promise<DocumentGenerationBatchDto> {
  return request(
    `/api/document-generation-batches/${encodeURIComponent(batchId)}/preflight`,
    mutation(input, signal),
  );
}

export function generateDocumentGenerationBatch(
  batchId: string,
  input: BatchExecutionInput,
  signal?: AbortSignal,
): Promise<BatchGenerationResult> {
  return request(
    `/api/document-generation-batches/${encodeURIComponent(batchId)}/generate`,
    mutation(input, signal),
  );
}

export function retryDocumentGenerationBatchItem(
  batchId: string,
  itemId: string,
  input: BatchExecutionInput,
  signal?: AbortSignal,
): Promise<DocumentGenerationBatchDto> {
  return request(
    `/api/document-generation-batches/${encodeURIComponent(batchId)}/items/${encodeURIComponent(itemId)}/retry`,
    mutation(input, signal),
  );
}


const OAKDOC_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

async function parseApiError(response: Response): Promise<DocumentGenerationBatchApiError> {
  const body = await response.json().catch(() => null);
  return new DocumentGenerationBatchApiError(
    (body as { error?: string } | null)?.error ?? 'Request failed',
    response.status,
    (body as { details?: unknown } | null)?.details,
  );
}

export async function getOakDocGeneratedDraft(
  generatedDocumentId: string,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const response = await fetch(
    `/api/generated-documents/${encodeURIComponent(generatedDocumentId)}?format=docx`,
    { method: 'GET', signal },
  );
  if (!response.ok) throw await parseApiError(response);
  return new Uint8Array(await response.arrayBuffer());
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (
    bytes.buffer instanceof ArrayBuffer
    && bytes.byteOffset === 0
    && bytes.byteLength === bytes.buffer.byteLength
  ) {
    return bytes.buffer;
  }
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export async function saveOakDocGeneratedDraft(
  generatedDocumentId: string,
  input: {
    expectedBatchRevision: number;
    previewFingerprint: string;
    bytes: Uint8Array;
  },
  signal?: AbortSignal,
): Promise<DocumentGenerationBatchDto> {
  const query = new URLSearchParams({
    format: 'docx',
    expectedBatchRevision: String(input.expectedBatchRevision),
    previewFingerprint: input.previewFingerprint,
  });
  const response = await fetch(
    `/api/generated-documents/${encodeURIComponent(generatedDocumentId)}?${query.toString()}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': OAKDOC_MIME_TYPE },
      body: exactArrayBuffer(input.bytes),
      signal,
    },
  );
  if (!response.ok) throw await parseApiError(response);
  return response.json() as Promise<DocumentGenerationBatchDto>;
}
