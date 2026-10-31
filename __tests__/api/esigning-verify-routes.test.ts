// @vitest-environment node
import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashBlake3 } from '@/lib/encryption';
import { NotFoundError } from '@/lib/errors';

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  getEsigningVerificationData: vi.fn(),
  findIssuedArtifactMatch: vi.fn(),
}));

vi.mock('@/lib/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rate-limit')>()),
  checkRateLimit: mocks.checkRateLimit,
}));
vi.mock('@/services/esigning-certificate.service', () => ({
  getEsigningVerificationData: mocks.getEsigningVerificationData,
  findIssuedArtifactMatch: mocks.findIssuedArtifactMatch,
}));

const IP = '198.51.100.7';
const CERTIFICATE_ID = 'CERT-2026-0001';
const PDF_BYTES = '%PDF-1.7 signed';

const allowed = { allowed: true, remaining: 9, resetAt: Date.now() + 60_000, isLockedOut: false };
const denied = { allowed: false, remaining: 0, resetAt: Date.now() + 60_000, isLockedOut: false };

const params = { params: Promise.resolve({ certificateId: CERTIFICATE_ID }) };

const verification = {
  certificateId: CERTIFICATE_ID,
  documents: [
    { id: 'doc-1', fileName: 'Agreement.pdf', hash: hashBlake3(Buffer.from(PDF_BYTES)) },
    { id: 'doc-2', fileName: 'Annex.pdf', hash: 'other-hash' },
  ],
};

function checkRequest(file: File | null, headers: Record<string, string> = {}): NextRequest {
  const formData = new FormData();
  if (file) formData.set('file', file);
  return new Request(`http://localhost/api/esigning/verify/${CERTIFICATE_ID}/check`, {
    method: 'POST',
    headers: { 'x-forwarded-for': IP, ...headers },
    body: formData,
  }) as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkRateLimit.mockReturnValue(allowed);
  mocks.getEsigningVerificationData.mockResolvedValue(verification);
  mocks.findIssuedArtifactMatch.mockResolvedValue({
    matched: false,
    fileHash: 'unmatched-hash',
    documentId: null,
    artifact: null,
  });
});

describe('GET /api/esigning/verify/[certificateId]', () => {
  async function get() {
    const { GET } = await import('@/app/api/esigning/verify/[certificateId]/route');
    return GET(
      new Request(`http://localhost/api/esigning/verify/${CERTIFICATE_ID}`, {
        headers: { 'x-forwarded-for': IP },
      }) as NextRequest,
      params
    );
  }

  it('returns the verification data, rate-limited per certificate', async () => {
    const response = await get();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(verification);
    expect(mocks.getEsigningVerificationData).toHaveBeenCalledWith(CERTIFICATE_ID);
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(`esigning_verify:${IP}:${CERTIFICATE_ID}`, expect.any(Object));
  });

  it('returns 429 without a lookup when rate limited', async () => {
    mocks.checkRateLimit.mockReturnValue(denied);
    const response = await get();

    expect(response.status).toBe(429);
    expect(mocks.getEsigningVerificationData).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown certificate', async () => {
    mocks.getEsigningVerificationData.mockRejectedValue(new NotFoundError('Certificate not found'));
    const response = await get();

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Certificate not found', code: 'NOT_FOUND' });
  });
});

describe('POST /api/esigning/verify/[certificateId]/check', () => {
  async function check(file: File | null, headers?: Record<string, string>) {
    const { POST } = await import('@/app/api/esigning/verify/[certificateId]/check/route');
    return POST(checkRequest(file, headers), params);
  }

  const pdf = () => new File([PDF_BYTES], 'upload.pdf', { type: 'application/pdf' });

  it('matches an uploaded file against everything issued for the certificate', async () => {
    const artifact = {
      kind: 'DOCUMENT_WITH_CERTIFICATE',
      version: 2,
      issuedAt: '2026-10-31T00:00:00.000Z',
      isCurrent: true,
      source: 'ISSUED_ARTIFACT',
    };
    mocks.findIssuedArtifactMatch.mockResolvedValue({
      matched: true,
      fileHash: 'file-hash',
      documentId: 'doc-1',
      artifact,
    });
    const response = await check(pdf(), { origin: 'http://localhost' });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      matched: true,
      fileHash: 'file-hash',
      document: verification.documents[0],
      artifact,
    });
    const [certificateId, uploaded] = mocks.findIssuedArtifactMatch.mock.calls[0];
    expect(certificateId).toBe(CERTIFICATE_ID);
    expect(Buffer.from(uploaded).toString()).toBe(PDF_BYTES);
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(`esigning_verify:${IP}:${CERTIFICATE_ID}`, expect.any(Object));
  });

  it('reports a match for a certificate-only file with no document', async () => {
    mocks.findIssuedArtifactMatch.mockResolvedValue({
      matched: true,
      fileHash: 'cert-hash',
      documentId: null,
      artifact: { kind: 'CERTIFICATE', version: 1, issuedAt: '2026-10-31T00:00:00.000Z', isCurrent: false, source: 'ISSUED_ARTIFACT' },
    });
    const body = await (await check(pdf())).json();

    expect(body).toMatchObject({ matched: true, document: null, artifact: { kind: 'CERTIFICATE', isCurrent: false } });
  });

  it('reports no match for a different file', async () => {
    mocks.findIssuedArtifactMatch.mockResolvedValue({
      matched: false,
      fileHash: hashBlake3(Buffer.from('tampered')),
      documentId: null,
      artifact: null,
    });
    const response = await check(new File(['tampered'], 'upload.pdf'));

    expect(await response.json()).toEqual({
      matched: false,
      fileHash: hashBlake3(Buffer.from('tampered')),
      document: null,
      artifact: null,
    });
  });

  it('rejects a cross-origin upload with 403 before rate limiting or looking up the certificate', async () => {
    const response = await check(pdf(), { origin: 'https://evil.example' });

    expect(response.status).toBe(403);
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
    expect(mocks.getEsigningVerificationData).not.toHaveBeenCalled();
  });

  it('returns 429 when rate limited', async () => {
    mocks.checkRateLimit.mockReturnValue(denied);
    const response = await check(pdf());

    expect(response.status).toBe(429);
    expect(mocks.getEsigningVerificationData).not.toHaveBeenCalled();
  });

  it('returns 400 when no file is provided', async () => {
    const response = await check(null);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'No file provided' });
    expect(mocks.getEsigningVerificationData).not.toHaveBeenCalled();
  });

  it('hides an internal lookup error behind a generic 500', async () => {
    mocks.getEsigningVerificationData.mockRejectedValue(new TypeError('secret column "hash" missing'));
    const response = await check(pdf());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Internal server error' });
  });
});
