/**
 * Reads and writes list-page state (search, filters, sort, paging) in the
 * page URL. A page describes its params once as a spec of codecs; parsing and
 * URL building both follow that spec, and values equal to their default are
 * left out of the URL.
 */

export interface UrlParamCodec<T> {
  /** URL key when it differs from the param name (e.g. `query` stored as `q`). */
  key?: string;
  parse(raw: string | null): T;
  /** The URL value, or undefined to leave the key out. */
  serialize(value: T): string | undefined;
}

export type UrlParamSpec<T> = { [K in keyof T]: UrlParamCodec<T[K]> };

interface KeyOption {
  key?: string;
}

function parseInteger(raw: string | null): number | undefined {
  if (raw === null || raw === '') return undefined;
  const value = parseInt(raw, 10);
  return Number.isNaN(value) ? undefined : value;
}

function parseDecimal(raw: string | null): number | undefined {
  if (raw === null || raw === '') return undefined;
  const value = parseFloat(raw);
  return Number.isNaN(value) ? undefined : value;
}

export const urlParam = {
  /** A string that falls back to `defaultValue` (empty by default). */
  string(defaultValue = '', options: KeyOption = {}): UrlParamCodec<string> {
    return {
      key: options.key,
      parse: (raw) => raw || defaultValue,
      serialize: (value) => (value && value !== defaultValue ? value : undefined),
    };
  },

  /** A string, or one of a string union, left undefined when absent. */
  optional<T extends string = string>(options: KeyOption = {}): UrlParamCodec<T | undefined> {
    return {
      key: options.key,
      parse: (raw) => (raw || undefined) as T | undefined,
      serialize: (value) => value || undefined,
    };
  },

  /** A string union with a default (sort field, sort order). */
  choice<T extends string>(defaultValue: T, options: KeyOption = {}): UrlParamCodec<T> {
    return {
      key: options.key,
      parse: (raw) => (raw || defaultValue) as T,
      serialize: (value) => (value && value !== defaultValue ? value : undefined),
    };
  },

  /** A whole number with a default (page, page size). */
  int(defaultValue: number, options: KeyOption = {}): UrlParamCodec<number> {
    return {
      key: options.key,
      parse: (raw) => parseInteger(raw) ?? defaultValue,
      serialize: (value) => (value !== undefined && value !== defaultValue ? String(value) : undefined),
    };
  },

  /** A whole number left undefined when absent. */
  optionalInt(options: KeyOption = {}): UrlParamCodec<number | undefined> {
    return {
      key: options.key,
      parse: parseInteger,
      serialize: (value) => (value === undefined ? undefined : String(value)),
    };
  },

  /** A decimal (amount) left undefined when absent. */
  optionalNumber(options: KeyOption = {}): UrlParamCodec<number | undefined> {
    return {
      key: options.key,
      parse: parseDecimal,
      serialize: (value) => (value === undefined ? undefined : String(value)),
    };
  },

  /** true, false, or undefined when absent. */
  optionalBoolean(options: KeyOption = {}): UrlParamCodec<boolean | undefined> {
    return {
      key: options.key,
      parse: (raw) => (raw === 'true' ? true : raw === 'false' ? false : undefined),
      serialize: (value) => (value === undefined ? undefined : String(value)),
    };
  },

  /** A flag that is only ever written as `true`. */
  flag(options: KeyOption = {}): UrlParamCodec<true | undefined> {
    return {
      key: options.key,
      parse: (raw) => (raw === 'true' ? true : undefined),
      serialize: (value) => (value ? 'true' : undefined),
    };
  },

  /** A comma-separated list, undefined when empty. */
  list(options: KeyOption = {}): UrlParamCodec<string[] | undefined> {
    return {
      key: options.key,
      parse: (raw) => {
        const items = raw ? raw.split(',').filter(Boolean) : [];
        return items.length > 0 ? items : undefined;
      },
      serialize: (value) => (value && value.length > 0 ? value.join(',') : undefined),
    };
  },
};

interface SearchParamsReader {
  get(name: string): string | null;
}

export function parseUrlParams<T>(spec: UrlParamSpec<T>, searchParams: SearchParamsReader): T {
  const result = {} as T;
  for (const name of Object.keys(spec) as (keyof T)[]) {
    const codec = spec[name];
    result[name] = codec.parse(searchParams.get(codec.key ?? String(name)));
  }
  return result;
}

/** The URL query for `values`, in spec order, without default values. */
export function buildUrlParams<T>(spec: UrlParamSpec<T>, values: T): URLSearchParams {
  const urlParams = new URLSearchParams();
  for (const name of Object.keys(spec) as (keyof T)[]) {
    const codec = spec[name];
    const serialized = codec.serialize(values[name]);
    if (serialized !== undefined) urlParams.set(codec.key ?? String(name), serialized);
  }
  return urlParams;
}

export function buildListUrl<T>(basePath: string, spec: UrlParamSpec<T>, values: T): string {
  const queryString = buildUrlParams(spec, values).toString();
  return queryString ? `${basePath}?${queryString}` : basePath;
}
