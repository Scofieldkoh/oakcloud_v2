import { describe, expect, it, vi } from 'vitest';
import { fetchBizFileContactMatchPreviews } from '@/services/bizfile/contact-match-preview.client';
import type { ContactIdentityCandidate } from '@/types/contact-identity';

function candidates(count: number): ContactIdentityCandidate[] {
  return Array.from({ length: count }, (_, index) => ({
    source: 'BIZFILE', sourceRecordId: `officers.${index}`,
    contactType: 'INDIVIDUAL', firstName: `Officer ${index}`,
  }));
}

function responseFor(body: string) {
  const request = JSON.parse(body) as { candidates: ContactIdentityCandidate[] };
  return new Response(JSON.stringify({
    matches: Object.fromEntries(request.candidates.map((candidate) => [candidate.sourceRecordId, null])),
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

describe('BizFile contact preview client', () => {
  it('sends the selected tenant with every preview batch', async () => {
    const fetcher = vi.fn((_url: string, init: RequestInit) => Promise.resolve(responseFor(String(init.body))));
    await fetchBizFileContactMatchPreviews(candidates(101), fetcher, 'tenant-selected');

    expect(fetcher.mock.calls.map((call) => JSON.parse(String(call[1].body)).tenantId))
      .toEqual(['tenant-selected', 'tenant-selected']);
  });

  it('sends exactly 100 combined candidates in one request', async () => {
    const fetcher = vi.fn((_url: string, init: RequestInit) => Promise.resolve(responseFor(String(init.body))));
    const matches = await fetchBizFileContactMatchPreviews(candidates(100), fetcher);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(JSON.parse(String(fetcher.mock.calls[0][1].body)).candidates).toHaveLength(100);
    expect(Object.keys(matches)).toHaveLength(100);
  });

  it('chunks 101 combined candidates and merges matches by stable source path', async () => {
    const fetcher = vi.fn((_url: string, init: RequestInit) => Promise.resolve(responseFor(String(init.body))));
    const matches = await fetchBizFileContactMatchPreviews(candidates(101), fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.map((call) => JSON.parse(String(call[1].body)).candidates.length)).toEqual([100, 1]);
    expect(Object.keys(matches)).toHaveLength(101);
  });

  it('rejects the whole preview when any chunk fails', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(responseFor(JSON.stringify({ candidates: candidates(100) })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'failed' }), { status: 503 }));
    await expect(fetchBizFileContactMatchPreviews(candidates(101), fetcher))
      .rejects.toThrow('Unable to preview contact matches');
  });
});
