// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@/generated/prisma';
import { ApiError, ErrorCodes, UnauthorizedError } from '@/lib/errors';

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  createPublicSubmission: vi.fn(),
  exportPublicFormResponsePdf: vi.fn(),
  emailPublicFormResponsePdfLink: vi.fn(),
  createPublicFormResponseToken: vi.fn(),
  verifyPublicFormResponseToken: vi.fn(),
}));

vi.mock('@/lib/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rate-limit')>()),
  checkRateLimit: mocks.checkRateLimit,
}));
vi.mock('@/lib/form-response-token', () => ({
  createPublicFormResponseToken: mocks.createPublicFormResponseToken,
  verifyPublicFormResponseToken: mocks.verifyPublicFormResponseToken,
  getPublicFormResponseSubmitDownloadTokenTtlSeconds: () => 900,
  getPublicFormResponseSubmitEmailRequestTokenTtlSeconds: () => 1800,
  getPublicFormResponseEmailLinkTokenTtlSeconds: () => 604_800,
}));
vi.mock('@/services/form-builder.service', () => ({
  createPublicSubmission: mocks.createPublicSubmission,
  exportPublicFormResponsePdf: mocks.exportPublicFormResponsePdf,
  emailPublicFormResponsePdfLink: mocks.emailPublicFormResponsePdfLink,
}));

const IP = '192.0.2.44';
const SLUG = 'client-onboarding';
const SUBMISSION_ID = 'submission-1';
const EMAIL_ACCESS_TOKEN = 'email-access-token-0123456789';

const allowed = { allowed: true, remaining: 9, resetAt: Date.now() + 60_000, isLockedOut: false };
const denied = { allowed: false, remaining: 0, resetAt: Date.now() + 60_000, isLockedOut: false };

function jsonRequest(path: string, method = 'GET', body?: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { 'x-forwarded-for': IP, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const submissionParams = () => ({ params: Promise.resolve({ slug: SLUG, submissionId: SUBMISSION_ID }) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkRateLimit.mockReturnValue(allowed);
  mocks.createPublicFormResponseToken.mockImplementation(async ({ scope }: { scope: string }) => `token:${scope}`);
  mocks.verifyPublicFormResponseToken.mockResolvedValue(true);
});

describe('POST /api/forms/public/[slug]/submit', () => {
  async function submit(body: unknown) {
    const { POST } = await import('@/app/api/forms/public/[slug]/submit/route');
    return POST(jsonRequest(`/api/forms/public/${SLUG}/submit`, 'POST', body), {
      params: Promise.resolve({ slug: SLUG }),
    });
  }

  it('returns 201 with a download token and an email-request token bound to the submission', async () => {
    mocks.createPublicSubmission.mockResolvedValue({
      id: SUBMISSION_ID,
      submittedAt: '2026-10-01T00:00:00.000Z',
      tenantId: 'tenant-1',
    });
    const response = await submit({ answers: { name: 'Jane' }, respondentEmail: ' Jane@Example.com ' });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      id: SUBMISSION_ID,
      submittedAt: '2026-10-01T00:00:00.000Z',
      pdfDownloadToken: 'token:public_form_pdf_download',
      pdfDownloadTokenTtlSeconds: 900,
      pdfEmailAccessToken: 'token:public_form_pdf_email_request',
      pdfEmailAccessTokenTtlSeconds: 1800,
    });
    expect(mocks.createPublicSubmission).toHaveBeenCalledWith(
      SLUG,
      expect.objectContaining({ answers: { name: 'Jane' }, respondentEmail: 'jane@example.com' })
    );
    expect(mocks.createPublicFormResponseToken).toHaveBeenCalledWith({
      slug: SLUG,
      submissionId: SUBMISSION_ID,
      scope: 'public_form_pdf_download',
      expiresInSeconds: 900,
    });
    expect(mocks.createPublicFormResponseToken).toHaveBeenCalledWith({
      slug: SLUG,
      submissionId: SUBMISSION_ID,
      scope: 'public_form_pdf_email_request',
      expiresInSeconds: 1800,
    });
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(`form-submit:${IP}:${SLUG}`, expect.any(Object));
  });

  it('returns 422 with the message for a missing required answer', async () => {
    mocks.createPublicSubmission.mockRejectedValue(new Error('Full name is required'));
    const response = await submit({ answers: {} });

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: 'Full name is required' });
    expect(mocks.createPublicFormResponseToken).not.toHaveBeenCalled();
  });

  it('does not leak a runtime error message that mentions "required"', async () => {
    mocks.createPublicSubmission.mockRejectedValue(new TypeError('Argument `tenantId` is required in prisma.formSubmission.create'));
    const response = await submit({ answers: {} });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Internal server error' });
  });

  it('hides a Prisma error behind a generic 500', async () => {
    mocks.createPublicSubmission.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Null constraint violation on `form_submissions.tenant_id`', {
        code: 'P2011',
        clientVersion: 'test',
      })
    );
    const response = await submit({ answers: {} });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Internal server error' });
  });

  it('maps other application errors through createErrorResponse', async () => {
    mocks.createPublicSubmission.mockRejectedValueOnce(new Error('Form not found'));
    expect((await submit({ answers: {} })).status).toBe(404);

    mocks.createPublicSubmission.mockRejectedValueOnce(new ApiError(ErrorCodes.CONFLICT, 'Form is closed', 409));
    const closed = await submit({ answers: {} });
    expect(closed.status).toBe(409);
    expect(await closed.json()).toEqual({ error: 'Form is closed', code: 'CONFLICT' });
  });

  it('keeps the status of an ApiError whose message contains "required"', async () => {
    mocks.createPublicSubmission.mockRejectedValue(new UnauthorizedError('Authentication required'));
    const response = await submit({ answers: {} });

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: 'Authentication required' });
  });

  it('returns 400 for an invalid payload', async () => {
    const response = await submit({ answers: 'nope' });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'Invalid submission payload' });
    expect(mocks.createPublicSubmission).not.toHaveBeenCalled();
  });

  it('returns 429 without submitting when rate limited', async () => {
    mocks.checkRateLimit.mockReturnValue(denied);
    const response = await submit({ answers: {} });

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: 'Too many requests' });
    expect(mocks.createPublicSubmission).not.toHaveBeenCalled();
  });
});

describe('GET /api/forms/public/[slug]/submissions/[submissionId]/pdf', () => {
  async function download(query: string) {
    const { GET } = await import('@/app/api/forms/public/[slug]/submissions/[submissionId]/pdf/route');
    return GET(jsonRequest(`/api/forms/public/${SLUG}/submissions/${SUBMISSION_ID}/pdf${query}`), submissionParams());
  }

  it('returns the PDF as an attachment for a valid download token', async () => {
    mocks.exportPublicFormResponsePdf.mockResolvedValue({ buffer: Buffer.from('%PDF-1.7'), fileName: 'Response.pdf' });
    const response = await download('?token=good-token');

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/pdf');
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="Response.pdf"');
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe('%PDF-1.7');
    expect(mocks.verifyPublicFormResponseToken).toHaveBeenCalledWith('good-token', {
      slug: SLUG,
      submissionId: SUBMISSION_ID,
      scope: 'public_form_pdf_download',
    });
    expect(mocks.exportPublicFormResponsePdf).toHaveBeenCalledWith(SLUG, SUBMISSION_ID);
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(`form-view:${IP}:${SLUG}:pdf`, expect.any(Object));
  });

  it('returns 401 without a token', async () => {
    const response = await download('');

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Download token required' });
    expect(mocks.verifyPublicFormResponseToken).not.toHaveBeenCalled();
    expect(mocks.exportPublicFormResponsePdf).not.toHaveBeenCalled();
  });

  it('returns 403 for an invalid token and counts it against the rate limit', async () => {
    mocks.verifyPublicFormResponseToken.mockResolvedValue(false);
    const response = await download('?token=guess');

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Invalid or expired download token' });
    expect(mocks.exportPublicFormResponsePdf).not.toHaveBeenCalled();
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(`form-view:${IP}:${SLUG}:pdf`, expect.any(Object));
  });

  it('returns 429 before verifying the token when rate limited', async () => {
    mocks.checkRateLimit.mockReturnValue(denied);
    const response = await download('?token=good-token');

    expect(response.status).toBe(429);
    expect(mocks.verifyPublicFormResponseToken).not.toHaveBeenCalled();
    expect(mocks.exportPublicFormResponsePdf).not.toHaveBeenCalled();
  });

  it('maps a missing submission to 404', async () => {
    mocks.exportPublicFormResponsePdf.mockRejectedValue(new Error('Submission not found'));
    const response = await download('?token=good-token');

    expect(response.status).toBe(404);
  });
});

describe('POST /api/forms/public/[slug]/submissions/[submissionId]/email', () => {
  async function email(body: unknown) {
    const { POST } = await import('@/app/api/forms/public/[slug]/submissions/[submissionId]/email/route');
    return POST(
      jsonRequest(`/api/forms/public/${SLUG}/submissions/${SUBMISSION_ID}/email`, 'POST', body),
      submissionParams()
    );
  }

  it('verifies the email-request token and emails a fresh download-scoped link', async () => {
    mocks.emailPublicFormResponsePdfLink.mockResolvedValue(undefined);
    const response = await email({ email: 'jane@example.com', accessToken: EMAIL_ACCESS_TOKEN });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(mocks.verifyPublicFormResponseToken).toHaveBeenCalledWith(EMAIL_ACCESS_TOKEN, {
      slug: SLUG,
      submissionId: SUBMISSION_ID,
      scope: 'public_form_pdf_email_request',
    });
    expect(mocks.createPublicFormResponseToken).toHaveBeenCalledWith({
      slug: SLUG,
      submissionId: SUBMISSION_ID,
      scope: 'public_form_pdf_download',
      expiresInSeconds: 604_800,
    });
    expect(mocks.emailPublicFormResponsePdfLink).toHaveBeenCalledWith(
      SLUG,
      SUBMISSION_ID,
      'jane@example.com',
      'token:public_form_pdf_download'
    );
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(`form-submit:${IP}:${SLUG}:email`, expect.any(Object));
  });

  it('returns 403 for an invalid email-request token without minting a link', async () => {
    mocks.verifyPublicFormResponseToken.mockResolvedValue(false);
    const response = await email({ email: 'jane@example.com', accessToken: EMAIL_ACCESS_TOKEN });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Invalid or expired email access token' });
    expect(mocks.createPublicFormResponseToken).not.toHaveBeenCalled();
    expect(mocks.emailPublicFormResponsePdfLink).not.toHaveBeenCalled();
  });

  it.each([
    ['an invalid email', { email: 'nope', accessToken: EMAIL_ACCESS_TOKEN }],
    ['a short access token', { email: 'jane@example.com', accessToken: 'short' }],
  ])('returns 400 for %s', async (_label, body) => {
    const response = await email(body);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'Invalid email payload' });
    expect(mocks.verifyPublicFormResponseToken).not.toHaveBeenCalled();
  });

  it('returns 429 before verifying the token when rate limited', async () => {
    mocks.checkRateLimit.mockReturnValue(denied);
    const response = await email({ email: 'jane@example.com', accessToken: EMAIL_ACCESS_TOKEN });

    expect(response.status).toBe(429);
    expect(mocks.verifyPublicFormResponseToken).not.toHaveBeenCalled();
    expect(mocks.emailPublicFormResponsePdfLink).not.toHaveBeenCalled();
  });
});
