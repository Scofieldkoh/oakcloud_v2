import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@/generated/prisma';
import { ApiError, ErrorCodes } from '@/lib/errors';

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  recordFailure: vi.fn(),
  recordSuccess: vi.fn(),
  getEsigningChallengeClaims: vi.fn(),
  exchangeEsigningLinkToken: vi.fn(),
  loadEsigningSigningSession: vi.fn(),
  getEsigningSigningSessionStatus: vi.fn(),
  recordEsigningSigningView: vi.fn(),
  verifyEsigningAccessCode: vi.fn(),
  recordEsigningSigningConsent: vi.fn(),
  saveEsigningSigningFieldValues: vi.fn(),
  completeEsigningSigningSession: vi.fn(),
  declineEsigningSigningSession: vi.fn(),
  downloadEsigningSessionDocument: vi.fn(),
  getSession: vi.fn(),
  findUniquePreference: vi.fn(),
}));

vi.mock('@/lib/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rate-limit')>()),
  checkRateLimit: mocks.checkRateLimit,
  recordFailure: mocks.recordFailure,
  recordSuccess: mocks.recordSuccess,
}));
vi.mock('@/lib/esigning-session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/esigning-session')>()),
  getEsigningChallengeClaims: mocks.getEsigningChallengeClaims,
}));
vi.mock('@/services/esigning-signing.service', () => ({
  exchangeEsigningLinkToken: mocks.exchangeEsigningLinkToken,
  loadEsigningSigningSession: mocks.loadEsigningSigningSession,
  getEsigningSigningSessionStatus: mocks.getEsigningSigningSessionStatus,
  recordEsigningSigningView: mocks.recordEsigningSigningView,
  verifyEsigningAccessCode: mocks.verifyEsigningAccessCode,
  recordEsigningSigningConsent: mocks.recordEsigningSigningConsent,
  saveEsigningSigningFieldValues: mocks.saveEsigningSigningFieldValues,
  completeEsigningSigningSession: mocks.completeEsigningSigningSession,
  declineEsigningSigningSession: mocks.declineEsigningSigningSession,
  downloadEsigningSessionDocument: mocks.downloadEsigningSessionDocument,
}));
vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }));
vi.mock('@/lib/prisma', () => ({
  prisma: { userPreference: { findUnique: mocks.findUniquePreference } },
}));

const IP = '203.0.113.10';
const FIELD_ID = '6f1c1d4e-2b8a-4c63-9d8e-0a1b2c3d4e5f';
const DOCUMENT_ID = '0b7e8f4a-1c2d-4e3f-8a9b-1c2d3e4f5a6b';
const SIGNATURE = 'data:image/png;base64,iVBORw0KGgo=';

const allowed = { allowed: true, remaining: 9, resetAt: Date.now() + 60_000, isLockedOut: false };
const denied = { allowed: false, remaining: 0, resetAt: Date.now() + 60_000, isLockedOut: false };

function request(
  path: string,
  init: { method?: string; body?: unknown; origin?: string; headers?: Record<string, string> } = {}
): NextRequest {
  const headers: Record<string, string> = { 'x-forwarded-for': IP, 'user-agent': 'vitest', ...init.headers };
  if (init.origin) headers.origin = init.origin;
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  return new Request(`http://localhost${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }) as NextRequest;
}

type Handler = (req: NextRequest) => Promise<Response>;

interface MutatingRoute {
  name: string;
  load: () => Promise<Handler>;
  method: 'POST' | 'PUT';
  path: string;
  body: unknown;
  service: ReturnType<typeof vi.fn>;
  rateLimitKey: string;
}

const tokenParams = { params: Promise.resolve({ token: 'link-token-abc' }) };

const mutatingRoutes: MutatingRoute[] = [
  {
    name: 'POST sign/[token]',
    load: async () => {
      const { POST } = await import('@/app/api/esigning/sign/[token]/route');
      return (req) => POST(req, { params: Promise.resolve({ token: 'link-token-abc' }) });
    },
    method: 'POST',
    path: '/api/esigning/sign/link-token-abc',
    body: undefined,
    service: mocks.exchangeEsigningLinkToken,
    rateLimitKey: `esigning_sign_load:${IP}:link-token-abc`,
  },
  {
    name: 'POST session/view',
    load: async () => (await import('@/app/api/esigning/sign/session/view/route')).POST,
    method: 'POST',
    path: '/api/esigning/sign/session/view',
    body: undefined,
    service: mocks.recordEsigningSigningView,
    rateLimitKey: `esigning_sign_load:${IP}:session-view`,
  },
  {
    name: 'POST session/verify',
    load: async () => (await import('@/app/api/esigning/sign/session/verify/route')).POST,
    method: 'POST',
    path: '/api/esigning/sign/session/verify',
    body: { accessCode: '123456' },
    service: mocks.verifyEsigningAccessCode,
    rateLimitKey: `esigning_sign_verify:${IP}:recipient-1`,
  },
  {
    name: 'POST session/consent',
    load: async () => (await import('@/app/api/esigning/sign/session/consent/route')).POST,
    method: 'POST',
    path: '/api/esigning/sign/session/consent',
    body: { consented: true },
    service: mocks.recordEsigningSigningConsent,
    rateLimitKey: `esigning_sign_save:${IP}:session-consent`,
  },
  {
    name: 'PUT session/fields',
    load: async () => (await import('@/app/api/esigning/sign/session/fields/route')).PUT,
    method: 'PUT',
    path: '/api/esigning/sign/session/fields',
    body: { values: [{ fieldDefinitionId: FIELD_ID, value: 'Jane' }] },
    service: mocks.saveEsigningSigningFieldValues,
    rateLimitKey: `esigning_sign_save:${IP}:session-fields`,
  },
  {
    name: 'POST session/complete',
    load: async () => (await import('@/app/api/esigning/sign/session/complete/route')).POST,
    method: 'POST',
    path: '/api/esigning/sign/session/complete',
    body: { values: [{ fieldDefinitionId: FIELD_ID, signatureDataUrl: SIGNATURE }] },
    service: mocks.completeEsigningSigningSession,
    rateLimitKey: `esigning_sign_complete:${IP}:session-complete`,
  },
  {
    name: 'POST session/decline',
    load: async () => (await import('@/app/api/esigning/sign/session/decline/route')).POST,
    method: 'POST',
    path: '/api/esigning/sign/session/decline',
    body: { reason: 'Wrong entity name' },
    service: mocks.declineEsigningSigningSession,
    rateLimitKey: `esigning_sign_decline:${IP}:session-decline`,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkRateLimit.mockReturnValue(allowed);
  mocks.getEsigningChallengeClaims.mockResolvedValue({ recipientId: 'recipient-1' });
  for (const route of mutatingRoutes) route.service.mockResolvedValue({ ok: true });
});

describe('public e-signing mutating routes', () => {
  describe.each(mutatingRoutes)('$name', (route) => {
    const send = async (init: { origin?: string; headers?: Record<string, string> } = {}) => {
      const handler = await route.load();
      return handler(request(route.path, { method: route.method, body: route.body, ...init }));
    };

    it('rejects a cross-origin request with 403 before rate limiting or calling the service', async () => {
      const response = await send({ origin: 'https://evil.example' });

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: 'Forbidden' });
      expect(mocks.checkRateLimit).not.toHaveBeenCalled();
      expect(route.service).not.toHaveBeenCalled();
    });

    it('rejects a cross-origin Referer when Origin is absent', async () => {
      const response = await send({ headers: { referer: 'https://evil.example/page' } });

      expect(response.status).toBe(403);
      expect(route.service).not.toHaveBeenCalled();
    });

    it('accepts a same-origin request and rate-limits on the expected key', async () => {
      const response = await send({ origin: 'http://localhost' });

      expect(response.status).toBe(200);
      expect(route.service).toHaveBeenCalledTimes(1);
      expect(mocks.checkRateLimit).toHaveBeenCalledWith(route.rateLimitKey, expect.any(Object));
    });

    it('accepts a request without Origin or Referer', async () => {
      const response = await send();

      expect(response.status).toBe(200);
      expect(route.service).toHaveBeenCalledTimes(1);
    });

    it('accepts the forwarded origin behind a proxy', async () => {
      const response = await send({
        origin: 'https://sign.example.com',
        headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'sign.example.com' },
      });

      expect(response.status).toBe(200);
    });

    it('returns 429 with rate-limit headers and does not call the service when rate limited', async () => {
      mocks.checkRateLimit.mockReturnValue(denied);
      const response = await send();

      expect(response.status).toBe(429);
      expect(await response.json()).toEqual({ error: 'Rate limit exceeded' });
      expect(response.headers.get('X-RateLimit-Remaining')).toBe('0');
      expect(route.service).not.toHaveBeenCalled();
    });
  });

  it('reports a lockout as "Too many attempts"', async () => {
    mocks.checkRateLimit.mockReturnValue({ ...denied, isLockedOut: true, lockoutExpiresAt: Date.now() + 1000 });
    const { POST } = await import('@/app/api/esigning/sign/session/verify/route');
    const response = await POST(request('/api/esigning/sign/session/verify', { method: 'POST', body: { accessCode: '1234' } }));

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: 'Too many attempts' });
    expect(response.headers.get('X-RateLimit-Lockout-Expires')).not.toBeNull();
    expect(mocks.verifyEsigningAccessCode).not.toHaveBeenCalled();
  });
});

describe('POST /api/esigning/sign/[token]', () => {
  it('returns the exchange result and keys the rate limit by token', async () => {
    mocks.exchangeEsigningLinkToken.mockResolvedValue({ status: 'challenge_required' });
    const { POST } = await import('@/app/api/esigning/sign/[token]/route');
    const response = await POST(request('/api/esigning/sign/link-token-abc', { method: 'POST' }), tokenParams);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'challenge_required' });
    expect(mocks.exchangeEsigningLinkToken).toHaveBeenCalledWith('link-token-abc');
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(`esigning_sign_load:${IP}:link-token-abc`, expect.any(Object));
  });

  it('maps an ApiError to its status and code', async () => {
    mocks.exchangeEsigningLinkToken.mockRejectedValue(
      new ApiError(ErrorCodes.NOT_FOUND, 'Signing link not found', 404)
    );
    const { POST } = await import('@/app/api/esigning/sign/[token]/route');
    const response = await POST(
      request('/api/esigning/sign/x', { method: 'POST' }),
      { params: Promise.resolve({ token: 'x' }) }
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Signing link not found', code: 'NOT_FOUND' });
  });
});

describe('POST /api/esigning/sign/session/verify', () => {
  async function verify(body: unknown) {
    const { POST } = await import('@/app/api/esigning/sign/session/verify/route');
    return POST(request('/api/esigning/sign/session/verify', { method: 'POST', body }));
  }

  it('records success on the per-recipient key when the access code is accepted', async () => {
    mocks.verifyEsigningAccessCode.mockResolvedValue(undefined);
    const response = await verify({ accessCode: ' 123456 ' });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(mocks.verifyEsigningAccessCode).toHaveBeenCalledWith('123456');
    expect(mocks.recordSuccess).toHaveBeenCalledWith(`esigning_sign_verify:${IP}:recipient-1`);
    expect(mocks.recordFailure).not.toHaveBeenCalled();
  });

  it('records a failure when the access code is rejected', async () => {
    mocks.verifyEsigningAccessCode.mockRejectedValue(new Error('Invalid access code'));
    const response = await verify({ accessCode: '000000' });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid access code' });
    expect(mocks.recordFailure).toHaveBeenCalledWith(`esigning_sign_verify:${IP}:recipient-1`, expect.any(Object));
    expect(mocks.recordSuccess).not.toHaveBeenCalled();
  });

  it('records a failure for an invalid payload and does not call the service', async () => {
    const response = await verify({ accessCode: '1' });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'Invalid payload' });
    expect(mocks.recordFailure).toHaveBeenCalledTimes(1);
    expect(mocks.verifyEsigningAccessCode).not.toHaveBeenCalled();
  });

  it("falls back to the 'unknown' identifier without challenge claims", async () => {
    mocks.getEsigningChallengeClaims.mockResolvedValue(null);
    mocks.verifyEsigningAccessCode.mockResolvedValue(undefined);
    await verify({ accessCode: '123456' });

    expect(mocks.checkRateLimit).toHaveBeenCalledWith(`esigning_sign_verify:${IP}:unknown`, expect.any(Object));
    expect(mocks.recordSuccess).toHaveBeenCalledWith(`esigning_sign_verify:${IP}:unknown`);
  });
});

describe('session payload handling', () => {
  it('passes the client IP and user agent to view, consent and complete', async () => {
    const view = (await import('@/app/api/esigning/sign/session/view/route')).POST;
    const consent = (await import('@/app/api/esigning/sign/session/consent/route')).POST;
    const complete = (await import('@/app/api/esigning/sign/session/complete/route')).POST;
    const values = [{ fieldDefinitionId: FIELD_ID, signatureDataUrl: SIGNATURE }];

    await view(request('/x', { method: 'POST' }));
    await consent(request('/x', { method: 'POST', body: { consented: true } }));
    await complete(request('/x', { method: 'POST', body: { values } }));

    const meta = { ipAddress: IP, userAgent: 'vitest' };
    expect(mocks.recordEsigningSigningView).toHaveBeenCalledWith(meta);
    expect(mocks.recordEsigningSigningConsent).toHaveBeenCalledWith(meta);
    expect(mocks.completeEsigningSigningSession).toHaveBeenCalledWith({ ...meta, values });
  });

  it('rejects consent that is not literally true', async () => {
    const { POST } = await import('@/app/api/esigning/sign/session/consent/route');
    const response = await POST(request('/x', { method: 'POST', body: { consented: false } }));

    expect(response.status).toBe(400);
    expect(mocks.recordEsigningSigningConsent).not.toHaveBeenCalled();
  });

  it('rejects field values with a non-uuid field id', async () => {
    const { PUT } = await import('@/app/api/esigning/sign/session/fields/route');
    const response = await PUT(request('/x', { method: 'PUT', body: { values: [{ fieldDefinitionId: 'nope' }] } }));

    expect(response.status).toBe(400);
    expect(mocks.saveEsigningSigningFieldValues).not.toHaveBeenCalled();
  });

  it.each([
    ['fields', 'PUT', 'saveEsigningSigningFieldValues'],
    ['complete', 'POST', 'completeEsigningSigningSession'],
  ] as const)(
    'rejects text the signed PDF cannot print on session/%s with a clear message',
    async (segment, method, serviceName) => {
      const route = await import(`@/app/api/esigning/sign/session/${segment}/route`);
      const response = await route[method](
        request('/x', { method, body: { values: [{ fieldDefinitionId: FIELD_ID, value: 'Happy 😀' }] } })
      );

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.code).toBe('UNSUPPORTED_PDF_CHARACTERS');
      expect(body.error).toContain('This field contains a character that cannot be printed on the signed document');
      expect(body.error).toContain('"😀" (U+1F600)');
      expect(mocks[serviceName]).not.toHaveBeenCalled();
    }
  );

  it('passes Latin, Vietnamese, CJK and rupee text through, normalised to NFC', async () => {
    mocks.saveEsigningSigningFieldValues.mockResolvedValue({ ok: true });
    const { PUT } = await import('@/app/api/esigning/sign/session/fields/route');
    const values = ['John Tan', 'Tan Wei Ming 陈伟明', 'Nguye\u0302\u0303n Va\u0306n A', '₹ 100'];
    const response = await PUT(
      request('/x', {
        method: 'PUT',
        body: { values: values.map((value) => ({ fieldDefinitionId: FIELD_ID, value })) },
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.saveEsigningSigningFieldValues).toHaveBeenCalledWith(
      values.map((value) => expect.objectContaining({ value: value.normalize('NFC') }))
    );
  });

  it('returns success for a decline with a reason and 400 for a blank reason', async () => {
    const { POST } = await import('@/app/api/esigning/sign/session/decline/route');

    const ok = await POST(request('/x', { method: 'POST', body: { reason: '  Not mine  ' } }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ success: true });
    expect(mocks.declineEsigningSigningSession).toHaveBeenCalledWith({ reason: 'Not mine' });

    const blank = await POST(request('/x', { method: 'POST', body: { reason: '   ' } }));
    expect(blank.status).toBe(400);
    expect(mocks.declineEsigningSigningSession).toHaveBeenCalledTimes(1);
  });

  it('returns 400 "Invalid request body" for malformed JSON', async () => {
    const { POST } = await import('@/app/api/esigning/sign/session/complete/route');
    const response = await POST(new Request('http://localhost/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    }) as NextRequest);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid request body' });
    expect(mocks.completeEsigningSigningSession).not.toHaveBeenCalled();
  });

  it('hides Prisma and runtime error details behind a generic 500', async () => {
    const { POST } = await import('@/app/api/esigning/sign/session/complete/route');
    const body = { values: [{ fieldDefinitionId: FIELD_ID, value: 'x' }] };

    mocks.completeEsigningSigningSession.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('relation "esigning_envelopes" timed out', {
        code: 'P1008',
        clientVersion: 'test',
      })
    );
    const prismaResponse = await POST(request('/x', { method: 'POST', body }));
    expect(prismaResponse.status).toBe(500);
    expect(await prismaResponse.json()).toEqual({ error: 'Internal server error' });

    mocks.completeEsigningSigningSession.mockRejectedValueOnce(new TypeError("Cannot read properties of undefined (reading 'envelope')"));
    const typeErrorResponse = await POST(request('/x', { method: 'POST', body }));
    expect(typeErrorResponse.status).toBe(500);
    expect(await typeErrorResponse.json()).toEqual({ error: 'Internal server error' });
  });
});

describe('GET session/load and session/status', () => {
  it('loads the session on its own rate-limit key without an origin check', async () => {
    mocks.loadEsigningSigningSession.mockResolvedValue({ envelope: { id: 'env-1' } });
    const { GET } = await import('@/app/api/esigning/sign/session/load/route');
    const response = await GET(request('/api/esigning/sign/session/load', { origin: 'https://evil.example' }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ envelope: { id: 'env-1' } });
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(`esigning_sign_load:${IP}:session-load`, expect.any(Object));
  });

  it('returns the session status and maps "Unauthorized" to 401', async () => {
    const { GET } = await import('@/app/api/esigning/sign/session/status/route');
    mocks.getEsigningSigningSessionStatus.mockResolvedValueOnce({ status: 'SIGNED' });
    const ok = await GET(request('/api/esigning/sign/session/status'));
    expect(await ok.json()).toEqual({ status: 'SIGNED' });
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(`esigning_sign_status:${IP}:session-status`, expect.any(Object));

    mocks.getEsigningSigningSessionStatus.mockRejectedValueOnce(new Error('Unauthorized'));
    const unauthorized = await GET(request('/api/esigning/sign/session/status'));
    expect(unauthorized.status).toBe(401);
  });

  it('returns 429 without loading when rate limited', async () => {
    mocks.checkRateLimit.mockReturnValue(denied);
    const load = (await import('@/app/api/esigning/sign/session/load/route')).GET;
    const status = (await import('@/app/api/esigning/sign/session/status/route')).GET;

    expect((await load(request('/x'))).status).toBe(429);
    expect((await status(request('/x'))).status).toBe(429);
    expect(mocks.loadEsigningSigningSession).not.toHaveBeenCalled();
    expect(mocks.getEsigningSigningSessionStatus).not.toHaveBeenCalled();
  });
});

describe('GET /api/esigning/sign/session/download', () => {
  async function download(query: string) {
    const { GET } = await import('@/app/api/esigning/sign/session/download/route');
    return GET(request(`/api/esigning/sign/session/download${query}`));
  }

  it('returns the PDF inline and keys the rate limit by document', async () => {
    mocks.downloadEsigningSessionDocument.mockResolvedValue({
      buffer: Buffer.from('%PDF-1.7'),
      fileName: 'Agreement.pdf',
    });
    const response = await download(`?documentId=${DOCUMENT_ID}&token=t1&variant=signed`);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/pdf');
    expect(response.headers.get('Content-Disposition')).toBe('inline; filename="Agreement.pdf"');
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe('%PDF-1.7');
    expect(mocks.downloadEsigningSessionDocument).toHaveBeenCalledWith({
      documentId: DOCUMENT_ID,
      token: 't1',
      variant: 'signed',
    });
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(`esigning_sign_download:${IP}:${DOCUMENT_ID}`, expect.any(Object));
  });

  it('defaults to the original variant without a token', async () => {
    mocks.downloadEsigningSessionDocument.mockResolvedValue({ buffer: Buffer.from('x'), fileName: 'a.pdf' });
    await download(`?documentId=${DOCUMENT_ID}`);

    expect(mocks.downloadEsigningSessionDocument).toHaveBeenCalledWith({
      documentId: DOCUMENT_ID,
      token: undefined,
      variant: 'original',
    });
  });

  it.each([
    ['a non-uuid documentId', '?documentId=../../etc/passwd'],
    ['a missing documentId', ''],
    ['an unknown variant', `?documentId=${DOCUMENT_ID}&variant=draft`],
  ])('returns 400 for %s without rate limiting or downloading', async (_label, query) => {
    const response = await download(query);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'Invalid query' });
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
    expect(mocks.downloadEsigningSessionDocument).not.toHaveBeenCalled();
  });

  it('returns 429 when rate limited', async () => {
    mocks.checkRateLimit.mockReturnValue(denied);
    const response = await download(`?documentId=${DOCUMENT_ID}`);

    expect(response.status).toBe(429);
    expect(mocks.downloadEsigningSessionDocument).not.toHaveBeenCalled();
  });

  it('maps a service ApiError to its status', async () => {
    mocks.downloadEsigningSessionDocument.mockRejectedValue(
      new ApiError(ErrorCodes.PERMISSION_DENIED, 'Download link expired', 403)
    );
    const response = await download(`?documentId=${DOCUMENT_ID}`);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Download link expired', code: 'PERMISSION_DENIED' });
  });
});

describe('GET /api/public-bootstrap/esigning/session', () => {
  const session = { envelope: { id: 'env-1' }, recipient: { id: 'recipient-1', email: 'Jane.Doe@Example.com ' } };

  async function bootstrap() {
    const { GET } = await import('@/app/api/public-bootstrap/esigning/session/route');
    return GET(request('/api/public-bootstrap/esigning/session'));
  }

  beforeEach(() => {
    mocks.loadEsigningSigningSession.mockResolvedValue(session);
    mocks.findUniquePreference.mockResolvedValue({ value: SIGNATURE });
  });

  it('returns the saved specimen when the logged-in email matches the recipient case-insensitively', async () => {
    mocks.getSession.mockResolvedValue({ id: 'user-1', email: ' jane.doe@example.COM' });
    const response = await bootstrap();

    expect(response.status).toBe(200);
    expect(response.headers.get('Server-Timing')).not.toBeNull();
    expect(await response.json()).toEqual({ session: { ...session, savedSignatureSpecimenDataUrl: SIGNATURE } });
    expect(mocks.findUniquePreference).toHaveBeenCalledWith({
      where: { userId_key: { userId: 'user-1', key: 'esigning.signature-specimen' } },
      select: { value: true },
    });
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(`esigning_sign_load:${IP}:session-bootstrap`, expect.any(Object));
  });

  it('does not read the specimen for a different logged-in user', async () => {
    mocks.getSession.mockResolvedValue({ id: 'user-2', email: 'someone.else@example.com' });
    const response = await bootstrap();

    expect((await response.json()).session.savedSignatureSpecimenDataUrl).toBeNull();
    expect(mocks.findUniquePreference).not.toHaveBeenCalled();
  });

  it('does not read the specimen without a login', async () => {
    mocks.getSession.mockResolvedValue(null);
    const response = await bootstrap();

    expect((await response.json()).session.savedSignatureSpecimenDataUrl).toBeNull();
    expect(mocks.findUniquePreference).not.toHaveBeenCalled();
  });

  it('does not match when the recipient has no email', async () => {
    mocks.loadEsigningSigningSession.mockResolvedValue({ ...session, recipient: { id: 'r', email: null } });
    mocks.getSession.mockResolvedValue({ id: 'user-1', email: 'jane.doe@example.com' });
    const response = await bootstrap();

    expect((await response.json()).session.savedSignatureSpecimenDataUrl).toBeNull();
    expect(mocks.findUniquePreference).not.toHaveBeenCalled();
  });

  it('drops a stored specimen that is not a safe image data URL', async () => {
    mocks.getSession.mockResolvedValue({ id: 'user-1', email: 'jane.doe@example.com' });
    mocks.findUniquePreference.mockResolvedValue({ value: 'data:text/html;base64,PHNjcmlwdD4=' });
    const response = await bootstrap();

    expect((await response.json()).session.savedSignatureSpecimenDataUrl).toBeNull();
  });

  it('returns 429 without loading the session when rate limited', async () => {
    mocks.checkRateLimit.mockReturnValue(denied);
    const response = await bootstrap();

    expect(response.status).toBe(429);
    expect(mocks.loadEsigningSigningSession).not.toHaveBeenCalled();
    expect(mocks.getSession).not.toHaveBeenCalled();
  });

  it('maps a session error without calling getSession', async () => {
    mocks.loadEsigningSigningSession.mockRejectedValue(new Error('Unauthorized'));
    const response = await bootstrap();

    expect(response.status).toBe(401);
    expect(mocks.getSession).not.toHaveBeenCalled();
  });
});
