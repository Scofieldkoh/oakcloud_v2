import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DocumentGenerationBatchApiError,
  createDocumentGenerationBatch,
  generateDocumentGenerationBatch,
  previewDocumentGenerationBatchItem,
  saveDocumentGenerationBatch,
} from '@/lib/document-generation-batch-api';

describe('document generation batch API client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends revision on every mutation and omits server-owned fields', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      id: 'batch-1',
      revision: 1,
      items: [],
    }), { status: 200 }));

    await saveDocumentGenerationBatch('batch-1', {
      expectedRevision: 0,
      primaryCompanyId: 'company-1',
      items: [{ templateId: 'template-1' }],
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/document-generation-batches/batch-1');
    expect(JSON.parse(String(init?.body))).toEqual({
      expectedRevision: 0,
      primaryCompanyId: 'company-1',
      items: [{ templateId: 'template-1' }],
    });
  });

  it('preserves structured 409 and 422 details', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      error: 'Batch changed',
      details: { currentRevision: 8 },
    }), { status: 409 }));
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      error: 'Batch is not ready',
      details: { items: [{ itemId: 'item-1' }] },
    }), { status: 422 }));

    await expect(createDocumentGenerationBatch({
      items: [{ templateId: 'template-1' }],
    })).rejects.toMatchObject({
      status: 409,
      details: { currentRevision: 8 },
    });

    const error = await generateDocumentGenerationBatch('batch-1', { expectedRevision: 1 })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DocumentGenerationBatchApiError);
    expect(error).toMatchObject({
      status: 422,
      details: { items: [{ itemId: 'item-1' }] },
    });
  });

  it('forwards AbortSignal for previews', async () => {
    const signal = new AbortController().signal;
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));

    await previewDocumentGenerationBatchItem(
      'batch-1',
      'item-1',
      { expectedRevision: 2 },
      signal,
    );

    expect(vi.mocked(fetch).mock.calls[0][1]?.signal).toBe(signal);
  });
});
