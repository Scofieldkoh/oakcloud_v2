import { EventEmitter } from 'node:events';
import type { LookupAddress } from 'node:dns';
import type { lookup } from 'node:dns/promises';
import type { ClientRequest, IncomingMessage, RequestOptions } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { checkPublicHttpUrl, isPublicIpAddress } from '@/lib/public-url-checker';

type ResponseSpec = {
  status?: number;
  location?: string;
  chunks?: Buffer[];
  error?: NodeJS.ErrnoException;
  timeout?: boolean;
};

function requestQueue(specs: ResponseSpec[]) {
  const calls: RequestOptions[] = [];
  const responseDestroyMocks: Array<ReturnType<typeof vi.fn>> = [];

  const request = vi.fn((options: RequestOptions, callback: (response: IncomingMessage) => void) => {
    calls.push(options);
    const requestEmitter = new EventEmitter() as ClientRequest;
    let timeoutHandler: (() => void) | undefined;
    requestEmitter.setTimeout = vi.fn((_milliseconds: number, handler?: () => void) => {
      timeoutHandler = handler;
      return requestEmitter;
    }) as ClientRequest['setTimeout'];
    requestEmitter.destroy = vi.fn((error?: Error) => {
      if (error) queueMicrotask(() => requestEmitter.emit('error', error));
      return requestEmitter;
    }) as ClientRequest['destroy'];
    requestEmitter.end = vi.fn(() => {
      const spec = specs.shift();
      if (!spec) throw new Error('Missing mock response');
      queueMicrotask(() => {
        if (spec.timeout) {
          timeoutHandler?.();
          return;
        }
        if (spec.error) {
          requestEmitter.emit('error', spec.error);
          return;
        }
        const response = new EventEmitter() as IncomingMessage;
        response.statusCode = spec.status ?? 200;
        response.headers = spec.location ? { location: spec.location } : {};
        response.resume = vi.fn(() => response) as IncomingMessage['resume'];
        const destroy = vi.fn(() => response);
        response.destroy = destroy;
        responseDestroyMocks.push(destroy);
        callback(response);
        for (const chunk of spec.chunks ?? []) response.emit('data', chunk);
        response.emit('end');
      });
      return requestEmitter;
    }) as ClientRequest['end'];
    return requestEmitter;
  });

  return {
    calls,
    request: request as unknown as typeof import('node:http').request,
    responseDestroyMocks,
  };
}

type MockResolver = typeof lookup & ReturnType<typeof vi.fn>;

function resolver(implementation: () => Promise<LookupAddress[]>): MockResolver {
  return vi.fn(implementation) as unknown as MockResolver;
}

const publicDns = resolver(async () => [{ address: '93.184.216.34', family: 4 }]);

describe('public URL checker', () => {
  it('accepts only publicly routable IP addresses', () => {
    expect(isPublicIpAddress('127.0.0.1')).toBe(false);
    expect(isPublicIpAddress('10.0.0.1')).toBe(false);
    expect(isPublicIpAddress('169.254.169.254')).toBe(false);
    expect(isPublicIpAddress('192.0.2.1')).toBe(false);
    expect(isPublicIpAddress('::1')).toBe(false);
    expect(isPublicIpAddress('fc00::1')).toBe(false);
    expect(isPublicIpAddress('fe80::1')).toBe(false);
    expect(isPublicIpAddress('93.184.216.34')).toBe(true);
    expect(isPublicIpAddress('2606:4700:4700::1111')).toBe(true);
    expect(isPublicIpAddress('not-an-ip')).toBe(false);
  });

  it('rejects malformed and non-HTTP URLs without resolving them', async () => {
    const resolve = vi.fn();
    await expect(checkPublicHttpUrl('not a URL', { resolve })).resolves.toMatchObject({ errorCode: 'INVALID_URL' });
    await expect(checkPublicHttpUrl('file:///etc/passwd', { resolve })).resolves.toMatchObject({ errorCode: 'UNSUPPORTED_PROTOCOL' });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('blocks a hostname when any DNS result is non-public', async () => {
    const queue = requestQueue([]);
    const result = await checkPublicHttpUrl('https://example.com/path', {
      resolve: resolver(async () => [
        { address: '93.184.216.34', family: 4 as const },
        { address: '127.0.0.1', family: 4 as const },
      ]),
      secureRequest: queue.request,
    });

    expect(result.errorCode).toBe('NON_PUBLIC_ADDRESS');
    expect(queue.calls).toHaveLength(0);
  });

  it('pins the public DNS address while preserving HTTP host and TLS server name', async () => {
    const queue = requestQueue([{ status: 204 }]);
    const result = await checkPublicHttpUrl('https://example.com:8443/resource?q=1', {
      resolve: publicDns,
      secureRequest: queue.request,
    });

    expect(result).toMatchObject({ status: 204, finalUrl: 'https://example.com:8443/resource?q=1', errorCode: null });
    expect(queue.calls[0]).toMatchObject({
      hostname: '93.184.216.34',
      port: '8443',
      path: '/resource?q=1',
      method: 'HEAD',
      servername: 'example.com',
      headers: { Host: 'example.com:8443' },
    });
  });

  it('uses GET fallback only after HEAD 405 or 501', async () => {
    const fallback = requestQueue([{ status: 405 }, { status: 200 }]);
    await expect(checkPublicHttpUrl('http://example.com', {
      resolve: publicDns,
      request: fallback.request,
    })).resolves.toMatchObject({ status: 200, errorCode: null });
    expect(fallback.calls.map((call) => call.method)).toEqual(['HEAD', 'GET']);

    const forbidden = requestQueue([{ status: 403 }]);
    await checkPublicHttpUrl('http://example.com', { resolve: publicDns, request: forbidden.request });
    expect(forbidden.calls.map((call) => call.method)).toEqual(['HEAD']);
  });

  it('revalidates every redirect and rejects a sixth redirect', async () => {
    const queue = requestQueue([
      { status: 302, location: '/one' },
      { status: 302, location: '/two' },
      { status: 302, location: '/three' },
      { status: 302, location: '/four' },
      { status: 302, location: '/five' },
      { status: 302, location: '/six' },
    ]);
    const resolve = resolver(async () => [{ address: '93.184.216.34', family: 4 }]);

    const result = await checkPublicHttpUrl('http://example.com', { resolve, request: queue.request });

    expect(result).toMatchObject({ status: null, errorCode: 'TOO_MANY_REDIRECTS' });
    expect(resolve).toHaveBeenCalledTimes(6);
    expect(queue.calls).toHaveLength(6);
  });

  it('rejects redirects without a location or with embedded credentials', async () => {
    const missingLocation = requestQueue([{ status: 302 }]);
    await expect(checkPublicHttpUrl('http://example.com', {
      resolve: publicDns,
      request: missingLocation.request,
    })).resolves.toMatchObject({ status: null, errorCode: 'MISSING_REDIRECT_LOCATION' });

    const credentials = requestQueue([{ status: 302, location: 'https://user:secret@example.com/private' }]);
    await expect(checkPublicHttpUrl('http://example.com', {
      resolve: publicDns,
      request: credentials.request,
    })).resolves.toMatchObject({ status: null, errorCode: 'URL_CREDENTIALS_NOT_ALLOWED' });
    expect(credentials.calls).toHaveLength(1);
  });

  it('returns bounded DNS, request-timeout, and GET body results', async () => {
    const dnsError = Object.assign(new Error('lookup failed'), { code: 'ENOTFOUND' });
    await expect(checkPublicHttpUrl('https://missing.example', {
      resolve: resolver(async () => { throw dnsError; }),
    })).resolves.toMatchObject({ status: null, errorCode: 'ENOTFOUND' });

    const timeout = requestQueue([{ timeout: true }]);
    await expect(checkPublicHttpUrl('http://example.com', {
      resolve: publicDns,
      request: timeout.request,
    })).resolves.toMatchObject({ status: null, errorCode: 'ETIMEDOUT' });

    const largeBody = requestQueue([{ status: 405 }, { status: 200, chunks: [Buffer.alloc(65 * 1024)] }]);
    await expect(checkPublicHttpUrl('http://example.com', {
      resolve: publicDns,
      request: largeBody.request,
    })).resolves.toMatchObject({ status: 200, errorCode: null });
    expect(largeBody.responseDestroyMocks[1]).toHaveBeenCalled();
  });
});
