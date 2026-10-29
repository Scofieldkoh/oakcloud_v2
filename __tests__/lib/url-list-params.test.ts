// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildListUrl, parseUrlParams, urlParam, type UrlParamSpec } from '@/lib/url-list-params';

interface Params {
  query: string;
  page: number;
  sortOrder: 'asc' | 'desc';
  status?: 'LIVE' | 'STRUCK_OFF';
  officersMin?: number;
  capitalMin?: number;
  hasCharges?: boolean;
  needsReview?: true;
  tagIds?: string[];
}

const SPEC: UrlParamSpec<Params> = {
  query: urlParam.string('', { key: 'q' }),
  page: urlParam.int(1),
  sortOrder: urlParam.choice<'asc' | 'desc'>('asc'),
  status: urlParam.optional<'LIVE' | 'STRUCK_OFF'>(),
  officersMin: urlParam.optionalInt(),
  capitalMin: urlParam.optionalNumber(),
  hasCharges: urlParam.optionalBoolean(),
  needsReview: urlParam.flag(),
  tagIds: urlParam.list(),
};

describe('url list params', () => {
  it('reads defaults from an empty URL and writes nothing back', () => {
    const params = parseUrlParams(SPEC, new URLSearchParams());
    expect(params).toEqual({
      query: '', page: 1, sortOrder: 'asc', status: undefined, officersMin: undefined,
      capitalMin: undefined, hasCharges: undefined, needsReview: undefined, tagIds: undefined,
    });
    expect(buildListUrl('/companies', SPEC, params)).toBe('/companies');
  });

  it('round-trips every kind of value in spec order', () => {
    const url = '/companies?q=acme&page=3&sortOrder=desc&status=LIVE&officersMin=2&capitalMin=1000.5&hasCharges=false&needsReview=true&tagIds=a%2Cb';
    const params = parseUrlParams(SPEC, new URL(url, 'http://x').searchParams);
    expect(params).toEqual({
      query: 'acme', page: 3, sortOrder: 'desc', status: 'LIVE', officersMin: 2,
      capitalMin: 1000.5, hasCharges: false, needsReview: true, tagIds: ['a', 'b'],
    });
    expect(buildListUrl('/companies', SPEC, params)).toBe(url);
  });

  it('falls back to defaults for unreadable numbers', () => {
    const params = parseUrlParams(SPEC, new URLSearchParams('page=abc&officersMin=x&capitalMin=&needsReview=false'));
    expect(params.page).toBe(1);
    expect(params.officersMin).toBeUndefined();
    expect(params.capitalMin).toBeUndefined();
    expect(params.needsReview).toBeUndefined();
  });

  it('leaves values equal to their default out of the URL', () => {
    const params = { ...parseUrlParams(SPEC, new URLSearchParams()), page: 1, sortOrder: 'asc' as const, tagIds: [] };
    expect(buildListUrl('/companies', SPEC, params)).toBe('/companies');
  });
});
