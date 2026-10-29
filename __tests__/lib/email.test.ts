import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAppBaseUrl } from '@/lib/email';

describe('getAppBaseUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('honors EMAIL_APP_URL even when it points to localhost', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('EMAIL_APP_URL', 'http://localhost:3001/');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://service.oakcloud.app');

    expect(getAppBaseUrl()).toBe('http://localhost:3001');
  });

  it('allows localhost NEXT_PUBLIC_APP_URL in development', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('EMAIL_APP_URL', undefined);
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3001/');

    expect(getAppBaseUrl()).toBe('http://localhost:3001');
  });

  it('falls back to the production domain for localhost public URLs outside development', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('EMAIL_APP_URL', undefined);
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3001/');

    expect(getAppBaseUrl()).toBe('https://service.oakcloud.app');
  });
});
