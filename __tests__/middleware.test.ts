import { describe, expect, it, afterEach } from 'vitest';
import { isValidOrigin } from '@/middleware';

describe('CSRF origin validation', () => {
  const originalAllowedOrigins = process.env.ALLOWED_ORIGINS;

  afterEach(() => {
    if (originalAllowedOrigins === undefined) {
      delete process.env.ALLOWED_ORIGINS;
    } else {
      process.env.ALLOWED_ORIGINS = originalAllowedOrigins;
    }
  });

  it('requires exact scheme, host, and port equality', () => {
    process.env.ALLOWED_ORIGINS = 'https://app.example.test';

    expect(isValidOrigin('https://app.example.test', 'api.example.test')).toBe(true);
    expect(isValidOrigin('https://app.example.test.evil', 'api.example.test')).toBe(false);
    expect(isValidOrigin('https://app.example.test.attacker', 'api.example.test')).toBe(false);
  });

  it('compares URL origins without accepting paths or malformed values', () => {
    process.env.ALLOWED_ORIGINS = 'https://app.example.test/path-that-is-not-an-origin';

    expect(isValidOrigin('https://app.example.test/another-path', 'api.example.test')).toBe(true);
    expect(isValidOrigin('javascript://app.example.test', 'api.example.test')).toBe(false);
    expect(isValidOrigin('not a URL', 'api.example.test')).toBe(false);
  });

  it('keeps requests without an Origin header compatible with existing clients', () => {
    expect(isValidOrigin(null, 'api.example.test')).toBe(true);
    expect(isValidOrigin('', 'api.example.test')).toBe(true);
  });
});

describe('middleware matcher', () => {
  // Next compiles each matcher with path-to-regexp; use the same compiler it ships.
  async function matches(pathname: string) {
    const { config } = await import('@/middleware');
    // @ts-expect-error Next ships no type declarations for its compiled path-to-regexp.
    const { pathToRegexp } = (await import('next/dist/compiled/path-to-regexp')) as {
      pathToRegexp: (source: string) => unknown;
    };
    return config.matcher.some((source) => {
      const compiled = pathToRegexp(source) as unknown as RegExp | { regexp: RegExp };
      return (compiled instanceof RegExp ? compiled : compiled.regexp).test(pathname);
    });
  }

  it('still runs for ordinary API routes', async () => {
    for (const pathname of [
      '/api/auth/login',
      '/api/esigning/envelopes',
      '/api/esigning/sign/session/fields',
      '/api/esigning/verify/OAK-ES-1/route-sibling',
      '/api/esigning/verify/OAK-ES-1',
    ]) {
      expect(await matches(pathname), pathname).toBe(true);
    }
  });

  it('skips the verify upload so its body is not cut at 10 MB (the route does its own origin check and size cap)', async () => {
    for (const pathname of [
      '/api/esigning/verify/OAK-ES-20261030-ABCDEF/check',
      '/api/esigning/verify/OAK-ES-20261030-ABCDEF/check/',
    ]) {
      expect(await matches(pathname), pathname).toBe(false);
    }
  });

  it('does not run for pages', async () => {
    expect(await matches('/login')).toBe(false);
  });
});
