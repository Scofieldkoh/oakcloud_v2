import { describe, expect, it, vi } from 'vitest';
import {
  applyProcessingFilters,
  processingListUrl,
  processingParamsFromUrl,
} from '@/components/processing/list/processing-list-url';
import { buildProcessingFilterChips } from '@/components/processing/list/processing-filter-chips';
import { processingListStats } from '@/components/processing/list/processing-list-config';
import type { ProcessingDocumentSearchResult } from '@/hooks/use-processing-documents';

describe('processing list URL', () => {
  it('uses defaults when the URL has no filters', () => {
    const params = processingParamsFromUrl(new URLSearchParams());
    expect(params).toMatchObject({ page: 1, limit: 20, sortBy: 'createdAt', sortOrder: 'desc' });
    expect(processingListUrl(params)).toBe('/processing');
  });

  it('round-trips filters, tags and amount ranges', () => {
    const url = '/processing?page=2&needsReview=true&tagIds=t1%2Ct2&currency=SGD&tax=7&totalFrom=10&totalTo=99.5';
    const params = processingParamsFromUrl(new URLSearchParams(url.split('?')[1]));
    expect(params).toMatchObject({
      page: 2,
      needsReview: true,
      tagIds: ['t1', 't2'],
      currency: 'SGD',
      totalFrom: 10,
      totalTo: 99.5,
      tax: 7,
    });
    expect(processingListUrl(params)).toBe(url);
  });
});

describe('applyProcessingFilters', () => {
  const prev = { page: 3, limit: 50, sortBy: 'fileName', sortOrder: 'asc' as const, search: 'acme', vendorName: 'Acme', total: 5 };

  it('goes back to page 1 and keeps sort, search and untouched filters', () => {
    expect(applyProcessingFilters(prev, { needsReview: true })).toMatchObject({
      page: 1, limit: 50, sortBy: 'fileName', sortOrder: 'asc', search: 'acme', vendorName: 'Acme', total: 5, needsReview: true,
    });
  });

  it('turns an amount range into from and to, clearing the single amount', () => {
    const next = applyProcessingFilters(prev, { totalFilter: { mode: 'range', range: { from: 1, to: 2 } } });
    expect(next).toMatchObject({ total: undefined, totalFrom: 1, totalTo: 2 });
  });

  it('keeps an explicit page', () => {
    expect(applyProcessingFilters(prev, { page: 4 }).page).toBe(4);
  });
});

describe('buildProcessingFilterChips', () => {
  it('names tags and removes a chip through the filter handler', () => {
    const onChange = vi.fn();
    const chips = buildProcessingFilterChips(
      { needsReview: true, tagIds: ['t1'] },
      [{ id: 't1', name: 'Urgent', color: 'RED' }] as never,
      onChange,
    );
    expect(chips.map((chip) => chip.key)).toEqual(['needsReview', 'tags']);
    expect(chips[1].value).toContain('Urgent');
    chips[0].onRemove();
    expect(onChange).toHaveBeenCalledWith({ needsReview: undefined });
  });
});

describe('processingListStats', () => {
  it('counts the documents on screen by status', () => {
    const data = {
      total: 9,
      documents: [
        { pipelineStatus: 'QUEUED', currentRevision: null },
        { pipelineStatus: 'EXTRACTION_DONE', currentRevision: { status: 'DRAFT' } },
        { pipelineStatus: 'EXTRACTION_DONE', currentRevision: { status: 'APPROVED' } },
        { pipelineStatus: 'DEAD_LETTER', currentRevision: null },
      ],
    } as unknown as ProcessingDocumentSearchResult;
    expect(processingListStats(data)).toEqual({ total: 9, queued: 1, processing: 0, pendingReview: 1, approved: 1, failed: 1 });
    expect(processingListStats(undefined)).toBeNull();
  });
});
