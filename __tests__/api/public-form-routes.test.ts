// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@/generated/prisma';
import { ApiError, ErrorCodes } from '@/lib/errors';

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  getPublicFormBySlug: vi.fn(),
  createPublicUpload: vi.fn(),
  savePublicDraft: vi.fn(),
  getPublicDraftByCode: vi.fn(),
  emailPublicFormDraft: vi.fn(),
}));

vi.mock('@/lib/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rate-limit')>()),
  checkRateLimit: mocks.checkRateLimit,
}));
vi.mock('@/services/form-builder.service', () => ({
  getPublicFormBySlug: mocks.getPublicFormBySlug,
  createPublicUpload: mocks.createPublicUpload,
  savePublicDraft: mocks.savePublicDraft,
  getPublicDraftByCode: mocks.getPublicDraftByCode,
  emailPublicFormDraft: mocks.emailPublicFormDraft,
}));

const IP = '192.0.2.44';
const SLUG = 'client-onboarding';
const ACCESS_TOKEN = 'draft-access-token-0123456789';

const allowed = { allowed: true, remaining: 9, resetAt: Date.now() + 60_000, isLockedOut: false };
const denied = { allowed: false, remaining: 0, resetAt: Date.now() + 60_000, isLockedOut: false };

function jsonRequest(path: string, method = 'GET', body?: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { 'x-forwarded-for': IP, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const slugParams = () => ({ params: Promise.resolve({ slug: SLUG }) });
const draftParams = () => ({ params: Promise.resolve({ slug: SLUG, draftCode: 'AB12C' }) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkRateLimit.mockReturnValue(allowed);
});

describe.each([
  {
    name: 'GET /api/forms/public/[slug]',
    get: async () => (await import('@/app/api/forms/public/[slug]/route')).GET,
    wrap: (form: unknown) => form,
  },
  {
    name: 'GET /api/public-bootstrap/forms/[slug]',
    get: async () => (await import('@/app/api/public-bootstrap/forms/[slug]/route')).GET,
    wrap: (form: unknown) => ({ form }),
  },
])('$name', ({ get, wrap }) => {
  const form = { id: 'form-1', slug: SLUG, title: 'Client onboarding', fields: [] };

  it('returns the published form, rate-limited per ip and slug', async () => {
    mocks.getPublicFormBySlug.mockResolvedValue(form);
    const response = await (await get())(jsonRequest(`/f/${SLUG}`), slugParams());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(wrap(form));
    expect(mocks.getPublicFormBySlug).toHaveBeenCalledWith(SLUG);
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(`form-view:${IP}:${SLUG}`, expect.any(Object));
  });

  it('returns 404 when the form is not published', async () => {
    mocks.getPublicFormBySlug.mockResolvedValue(null);
    const response = await (await get())(jsonRequest(`/f/${SLUG}`), slugParams());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Form not found' });
  });

  it('returns 429 without loading the form when rate limited', async () => {
    mocks.checkRateLimit.mockReturnValue(denied);
    const response = await (await get())(jsonRequest(`/f/${SLUG}`), slugParams());

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: 'Too many requests' });
    expect(mocks.getPublicFormBySlug).not.toHaveBeenCalled();
  });

  it('hides a Prisma error behind a generic 500', async () => {
    mocks.getPublicFormBySlug.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Invalid `prisma.form.findFirst()` invocation', {
        code: 'P1001',
        clientVersion: 'test',
      })
    );
    const response = await (await get())(jsonRequest(`/f/${SLUG}`), slugParams());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Internal server error' });
  });
});

describe('POST /api/forms/public/[slug]/uploads', () => {
  function uploadRequest(file: File | null, fieldKey?: string): Request {
    const formData = new FormData();
    if (file) formData.set('file', file);
    if (fieldKey !== undefined) formData.set('fieldKey', fieldKey);
    return new Request(`http://localhost/api/forms/public/${SLUG}/uploads`, {
      method: 'POST',
      headers: { 'x-forwarded-for': IP },
      body: formData,
    });
  }

  async function upload(file: File | null, fieldKey?: string) {
    const { POST } = await import('@/app/api/forms/public/[slug]/uploads/route');
    return POST(uploadRequest(file, fieldKey), slugParams());
  }

  const passport = () => new File(['%PDF-1.4'], 'passport.pdf', { type: 'application/pdf' });

  it('returns 201 and exposes only the public upload fields', async () => {
    mocks.createPublicUpload.mockResolvedValue({
      id: 'upload-1',
      fieldId: 'field-1',
      fileName: 'passport.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 8,
      storageKey: 'tenant-1/forms/form-1/uploads/upload-1.pdf',
      tenantId: 'tenant-1',
      formId: 'form-1',
    });
    const response = await upload(passport(), 'passport');

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      id: 'upload-1',
      fieldId: 'field-1',
      fileName: 'passport.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 8,
    });
    expect(mocks.createPublicUpload).toHaveBeenCalledWith(SLUG, 'passport', expect.any(File));
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(`form-upload:${IP}:${SLUG}`, expect.any(Object));
  });

  it('returns 400 when the file is missing', async () => {
    const response = await upload(null, 'passport');

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'File is required' });
    expect(mocks.createPublicUpload).not.toHaveBeenCalled();
  });

  it.each([
    ['an empty fieldKey', ''],
    ['a missing fieldKey', undefined],
  ])('returns 400 for %s', async (_label, fieldKey) => {
    const response = await upload(passport(), fieldKey);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'Invalid upload payload' });
    expect(mocks.createPublicUpload).not.toHaveBeenCalled();
  });

  it('returns 429 without storing when rate limited', async () => {
    mocks.checkRateLimit.mockReturnValue(denied);
    const response = await upload(passport(), 'passport');

    expect(response.status).toBe(429);
    expect(mocks.createPublicUpload).not.toHaveBeenCalled();
  });

  it('returns a service validation message as 400 and an ApiError with its status', async () => {
    mocks.createPublicUpload.mockRejectedValueOnce(new Error('File type is not allowed for this field'));
    const rejected = await upload(passport(), 'passport');
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toEqual({ error: 'File type is not allowed for this field' });

    mocks.createPublicUpload.mockRejectedValueOnce(new ApiError(ErrorCodes.NOT_FOUND, 'Form not found', 404));
    const missing = await upload(passport(), 'passport');
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'Form not found', code: 'NOT_FOUND' });
  });
});

describe('POST /api/forms/public/[slug]/drafts', () => {
  async function save(body: unknown) {
    const { POST } = await import('@/app/api/forms/public/[slug]/drafts/route');
    return POST(jsonRequest(`/api/forms/public/${SLUG}/drafts`, 'POST', body), slugParams());
  }

  it('returns 201 with the draft resume details only', async () => {
    mocks.savePublicDraft.mockResolvedValue({
      draftCode: 'AB12C',
      accessToken: ACCESS_TOKEN,
      resumeUrl: `https://app.example/forms/f/${SLUG}?draft=AB12C`,
      expiresAt: '2026-10-15T00:00:00.000Z',
      savedAt: '2026-10-01T00:00:00.000Z',
      tenantId: 'tenant-1',
      accessTokenHash: 'hash',
    });
    const response = await save({ answers: { name: 'Jane' } });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      draftCode: 'AB12C',
      accessToken: ACCESS_TOKEN,
      resumeUrl: `https://app.example/forms/f/${SLUG}?draft=AB12C`,
      expiresAt: '2026-10-15T00:00:00.000Z',
      savedAt: '2026-10-01T00:00:00.000Z',
    });
    expect(mocks.savePublicDraft).toHaveBeenCalledWith(SLUG, expect.objectContaining({ answers: { name: 'Jane' }, uploadIds: [] }));
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(`form-draft-save:${IP}:${SLUG}`, expect.any(Object));
  });

  it('returns 400 for an invalid draft code', async () => {
    const response = await save({ answers: {}, draftCode: 'bad code' });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'Invalid draft payload' });
    expect(mocks.savePublicDraft).not.toHaveBeenCalled();
  });

  it('returns 429 without saving when rate limited', async () => {
    mocks.checkRateLimit.mockReturnValue(denied);
    const response = await save({ answers: {} });

    expect(response.status).toBe(429);
    expect(mocks.savePublicDraft).not.toHaveBeenCalled();
  });
});

describe('GET /api/forms/public/[slug]/drafts/[draftCode]', () => {
  async function resume(query = '') {
    const { GET } = await import('@/app/api/forms/public/[slug]/drafts/[draftCode]/route');
    return GET(jsonRequest(`/api/forms/public/${SLUG}/drafts/AB12C${query}`), draftParams());
  }

  it('returns the draft for a valid access token', async () => {
    mocks.getPublicDraftByCode.mockResolvedValue({ draftCode: 'AB12C', answers: { name: 'Jane' } });
    const response = await resume(`?token=${ACCESS_TOKEN}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ draftCode: 'AB12C', answers: { name: 'Jane' } });
    expect(mocks.getPublicDraftByCode).toHaveBeenCalledWith(SLUG, 'AB12C', ACCESS_TOKEN);
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(`form-draft-resume:${IP}:${SLUG}`, expect.any(Object));
  });

  it.each([
    ['missing', ''],
    ['blank', '?token=%20%20'],
  ])('returns 401 when the access token is %s', async (_label, query) => {
    const response = await resume(query);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Access token is required to resume a draft' });
    expect(mocks.getPublicDraftByCode).not.toHaveBeenCalled();
  });

  it('rate-limits before checking the token', async () => {
    mocks.checkRateLimit.mockReturnValue(denied);
    const response = await resume();

    expect(response.status).toBe(429);
    expect(mocks.getPublicDraftByCode).not.toHaveBeenCalled();
  });

  it('maps a "not found" service error to 404', async () => {
    mocks.getPublicDraftByCode.mockRejectedValue(new Error('Draft not found'));
    const response = await resume(`?token=${ACCESS_TOKEN}`);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Draft not found' });
  });
});

describe('POST /api/forms/public/[slug]/drafts/[draftCode]/email', () => {
  async function email(body: unknown) {
    const { POST } = await import('@/app/api/forms/public/[slug]/drafts/[draftCode]/email/route');
    return POST(jsonRequest(`/api/forms/public/${SLUG}/drafts/AB12C/email`, 'POST', body), draftParams());
  }

  it('emails the draft link using its own rate-limit key', async () => {
    mocks.emailPublicFormDraft.mockResolvedValue(undefined);
    const response = await email({ email: 'jane@example.com', accessToken: ACCESS_TOKEN });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(mocks.emailPublicFormDraft).toHaveBeenCalledWith(SLUG, 'AB12C', 'jane@example.com', ACCESS_TOKEN);
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(`form-draft-save:${IP}:${SLUG}:email`, expect.any(Object));
  });

  it.each([
    ['an invalid email', { email: 'not-an-email', accessToken: ACCESS_TOKEN }],
    ['a missing access token', { email: 'jane@example.com' }],
  ])('returns 400 for %s', async (_label, body) => {
    const response = await email(body);

    expect(response.status).toBe(400);
    expect(mocks.emailPublicFormDraft).not.toHaveBeenCalled();
  });

  it('returns 429 without sending when rate limited', async () => {
    mocks.checkRateLimit.mockReturnValue(denied);
    const response = await email({ email: 'jane@example.com', accessToken: ACCESS_TOKEN });

    expect(response.status).toBe(429);
    expect(mocks.emailPublicFormDraft).not.toHaveBeenCalled();
  });

  it('maps an invalid access token from the service to 403', async () => {
    mocks.emailPublicFormDraft.mockRejectedValue(new Error('Forbidden'));
    const response = await email({ email: 'jane@example.com', accessToken: 'wrong' });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Forbidden' });
  });
});
