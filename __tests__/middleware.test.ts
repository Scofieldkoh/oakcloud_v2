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
