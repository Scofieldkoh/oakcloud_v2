import { SignJWT, jwtVerify } from 'jose';

const TOKEN_ISSUER = 'oakcloud-form';
const TOKEN_AUDIENCE = 'form-response-pdf';
const MIN_SECRET_LENGTH = 32;

const DEFAULT_SUBMIT_DOWNLOAD_TTL_SECONDS = 30 * 60; // 30 minutes
const DEFAULT_SUBMIT_EMAIL_REQUEST_TTL_SECONDS = 30 * 60; // 30 minutes
const DEFAULT_EMAIL_LINK_DOWNLOAD_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

export type PublicFormResponseTokenScope =
  | 'public_form_pdf_download'
  | 'public_form_pdf_email_request';

function getFormResponseTokenSecret(): Uint8Array {
  const secret =
    process.env.FORM_RESPONSE_TOKEN_SECRET ||
    process.env.SHARE_VERIFICATION_SECRET ||
    process.env.JWT_SECRET;

  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('FORM_RESPONSE_TOKEN_SECRET (or fallback secret) is required in production');
    }
    return new TextEncoder().encode('development-form-response-token-secret-only');
  }

  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`Form response token secret must be at least ${MIN_SECRET_LENGTH} characters long`);
  }

  return new TextEncoder().encode(secret);
}

function parseTtlSeconds(envValue: string | undefined, fallbackSeconds: number): number {
  const parsed = Number(envValue);
  if (!Number.isFinite(parsed)) return fallbackSeconds;
  if (parsed < 30) return 30;
  return Math.floor(parsed);
}

function getSubmitDownloadTtlSeconds(): number {
  return parseTtlSeconds(
    process.env.FORM_RESPONSE_SUBMIT_DOWNLOAD_TOKEN_TTL_SECONDS,
    DEFAULT_SUBMIT_DOWNLOAD_TTL_SECONDS
  );
}

function getSubmitEmailRequestTtlSeconds(): number {
  return parseTtlSeconds(
    process.env.FORM_RESPONSE_SUBMIT_EMAIL_REQUEST_TOKEN_TTL_SECONDS,
    DEFAULT_SUBMIT_EMAIL_REQUEST_TTL_SECONDS
  );
}

function getEmailLinkDownloadTtlSeconds(): number {
  return parseTtlSeconds(
    process.env.FORM_RESPONSE_EMAIL_LINK_TOKEN_TTL_SECONDS,
    DEFAULT_EMAIL_LINK_DOWNLOAD_TTL_SECONDS
  );
}

const FORM_RESPONSE_TOKEN_SECRET = getFormResponseTokenSecret();

export async function createPublicFormResponseToken(input: {
  slug: string;
  submissionId: string;
  scope: PublicFormResponseTokenScope;
  expiresInSeconds: number;
}): Promise<string> {
  const ttlSeconds = Number.isFinite(input.expiresInSeconds)
    ? Math.max(30, Math.floor(input.expiresInSeconds))
    : DEFAULT_SUBMIT_DOWNLOAD_TTL_SECONDS;

  return new SignJWT({
    slug: input.slug,
    submissionId: input.submissionId,
    scope: input.scope,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(TOKEN_ISSUER)
    .setAudience(TOKEN_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds} seconds`)
    .sign(FORM_RESPONSE_TOKEN_SECRET);
}

export async function verifyPublicFormResponseToken(
  token: string,
  expected: {
    slug: string;
    submissionId: string;
    scope: PublicFormResponseTokenScope;
  }
): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, FORM_RESPONSE_TOKEN_SECRET, {
      issuer: TOKEN_ISSUER,
      audience: TOKEN_AUDIENCE,
    });

    return (
      payload.slug === expected.slug &&
      payload.submissionId === expected.submissionId &&
      payload.scope === expected.scope
    );
  } catch {
    return false;
  }
}

export function getPublicFormResponseSubmitDownloadTokenTtlSeconds(): number {
  return getSubmitDownloadTtlSeconds();
}

export function getPublicFormResponseSubmitEmailRequestTokenTtlSeconds(): number {
  return getSubmitEmailRequestTtlSeconds();
}

export function getPublicFormResponseEmailLinkTokenTtlSeconds(): number {
  return getEmailLinkDownloadTtlSeconds();
}
