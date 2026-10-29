// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ session: vi.fn(), authorize: vi.fn() }));
vi.mock('@/lib/auth', () => ({ getSession: mocks.session }));
vi.mock('@/services/business-assistant/policy.service', () => ({
  assertAssistantActor: mocks.authorize, AssistantPolicyError: class extends Error {},
}));
import { handleAssistantError, readJson, routeActor } from '@/app/api/business-assistant/_helpers';

const originalAllowedOrigins = process.env.ALLOWED_ORIGINS;

function makeRequest({ url, host, origin }: { url: string; host?: string; origin?: string } = {
  url: 'http://127.0.0.1:3000/api/business-assistant/turns',
  host: 'app.example.test',
  origin: 'https://app.example.test',
}): Request {
  const headers = new Headers();
  if (host !== undefined) headers.set('host', host);
  if (origin !== undefined) headers.set('origin', origin);
  return new Request(url, { method: 'POST', headers });
}

describe('assistant request boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ id: 'user', workspaceId: 'workspace' });
    mocks.authorize.mockResolvedValue({ allowed: true });
    delete process.env.ALLOWED_ORIGINS;
  });

  afterEach(() => {
    if (originalAllowedOrigins === undefined) {
      delete process.env.ALLOWED_ORIGINS;
    } else {
      process.env.ALLOWED_ORIGINS = originalAllowedOrigins;
    }
  });

  it('accepts a public HTTPS origin when the internal request URL uses HTTP', async () => {
    await expect(routeActor(makeRequest())).resolves.toMatchObject({ userId: 'user', tenantId: 'workspace' });
  });

  it('rejects evil and lookalike origins', async () => {
    await expect(routeActor(makeRequest({
      url: 'http://127.0.0.1:3000/api/business-assistant/turns',
      host: 'app.example.test',
      origin: 'https://app.example.test.evil',
    }))).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
  });

  it('accepts an explicitly configured origin', async () => {
    process.env.ALLOWED_ORIGINS = 'https://admin.example.test';
    await expect(routeActor(makeRequest({
      url: 'http://127.0.0.1:3000/api/business-assistant/turns',
      host: 'app.example.test',
      origin: 'https://admin.example.test/settings',
    }))).resolves.toMatchObject({ userId: 'user', tenantId: 'workspace' });
  });

  it('accepts requests without an Origin header', async () => {
    await expect(routeActor(makeRequest({
      url: 'http://127.0.0.1:3000/api/business-assistant/turns',
      host: 'app.example.test',
    }))).resolves.toMatchObject({ userId: 'user', tenantId: 'workspace' });
  });

  it('falls back to the request URL host when Host is absent', async () => {
    await expect(routeActor(makeRequest({
      url: 'https://app.example.test/api/business-assistant/turns',
      origin: 'https://app.example.test',
    }))).resolves.toMatchObject({ userId: 'user', tenantId: 'workspace' });
  });

  it('stops reading an oversized chunked body without trusting content-length', async () => {
    const cancel = vi.fn();
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { pulls += 1; controller.enqueue(new Uint8Array(600_000)); }, cancel,
    }, { highWaterMark: 0 });
    const request = { headers: new Headers({ 'content-length': '1' }), body } as Request;
    await expect(readJson(request)).rejects.toMatchObject({ status: 413 });
    expect(pulls).toBe(2);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('decodes JSON split across multibyte character boundaries', async () => {
    const bytes = new TextEncoder().encode('{"name":"王"}');
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    } });
    await expect(readJson({ headers: new Headers(), body } as Request)).resolves.toEqual({ name: '王' });
  });

  it('does not expose internal error messages even when their code is INTERNAL_ERROR', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const response = handleAssistantError(Object.assign(new Error('private database detail'), { code: 'INTERNAL_ERROR' }));
      expect(response.status).toBe(500);
      expect(JSON.stringify(await response.json())).not.toContain('private database detail');
    } finally { log.mockRestore(); }
  });
});
