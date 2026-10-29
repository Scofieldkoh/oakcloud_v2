import { randomBytes } from 'crypto';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { cookies } from 'next/headers';
import { getAppBaseUrl } from '@/lib/email';
import { hashSha256 } from '@/lib/encryption';

const TOKEN_ISSUER = 'oakcloud-esigning';
const TOKEN_AUDIENCE = 'esigning';
const MIN_SECRET_LENGTH = 32;

export const ESIGNING_SESSION_COOKIE = 'esigning_session';
export const ESIGNING_CHALLENGE_COOKIE = 'esigning_challenge';

const DEFAULT_SIGNING_SESSION_TTL_SECONDS = 30 * 60;
const DEFAULT_SIGNING_CHALLENGE_TTL_SECONDS = 5 * 60;
const DEFAULT_SIGNING_DOWNLOAD_TTL_SECONDS = 15 * 60;
const DEFAULT_SIGNING_DELIVERY_TTL_SECONDS = 7 * 24 * 60 * 60;

export type EsigningTokenScope =
  | 'esigning_challenge'
  | 'esigning_session'
  | 'esigning_access'
  | 'esigning_download'
  | 'esigning_delivery';

export interface EsigningTokenClaims extends JWTPayload {
  recipientId: string;
  envelopeId: string;
  sessionVersion: number;
  scope: EsigningTokenScope;
  sessionId?: string;
}

export interface EsigningDeliveryTokenClaims extends JWTPayload {
  envelopeId: string;
  recipientId?: string;
  actorType: 'recipient' | 'sender';
  scope: 'esigning_delivery';
}

function getEsigningTokenSecret(): Uint8Array {
  const secret =
    process.env.ESIGNING_SESSION_SECRET ||
    process.env.FORM_RESPONSE_TOKEN_SECRET ||
    process.env.JWT_SECRET;

  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('ESIGNING_SESSION_SECRET (or fallback secret) is required in production');
    }

    return new TextEncoder().encode('development-esigning-session-secret-only');
  }

  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`ESIGNING session secret must be at least ${MIN_SECRET_LENGTH} characters long`);
  }

  return new TextEncoder().encode(secret);
}

function parseTtlSeconds(value: string | undefined, fallbackSeconds: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallbackSeconds;
  }

  return Math.max(30, Math.floor(parsed));
}

export function getEsigningSessionTtlSeconds(): number {
  return parseTtlSeconds(
    process.env.ESIGNING_SESSION_TTL_SECONDS,
    DEFAULT_SIGNING_SESSION_TTL_SECONDS
  );
}

export function getEsigningChallengeTtlSeconds(): number {
  return parseTtlSeconds(
    process.env.ESIGNING_CHALLENGE_TTL_SECONDS,
    DEFAULT_SIGNING_CHALLENGE_TTL_SECONDS
  );
}

export function getEsigningDownloadTtlSeconds(): number {
  return parseTtlSeconds(
    process.env.ESIGNING_DOWNLOAD_TTL_SECONDS,
    DEFAULT_SIGNING_DOWNLOAD_TTL_SECONDS
  );
}

export function getEsigningDeliveryTtlSeconds(): number {
  return parseTtlSeconds(
    process.env.ESIGNING_DELIVERY_TTL_SECONDS,
    DEFAULT_SIGNING_DELIVERY_TTL_SECONDS
  );
}

const ESIGNING_TOKEN_SECRET = getEsigningTokenSecret();

function buildCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge,
  };
}

export function createEsigningAccessToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashEsigningAccessToken(token: string): string {
  return hashSha256(token);
}

export async function createEsigningScopedToken(input: {
  recipientId: string;
  envelopeId: string;
  sessionVersion: number;
  scope: EsigningTokenScope;
  expiresInSeconds: number;
  sessionId?: string;
}): Promise<string> {
  const ttlSeconds = Math.max(30, Math.floor(input.expiresInSeconds));

  return new SignJWT({
    recipientId: input.recipientId,
    envelopeId: input.envelopeId,
    sessionVersion: input.sessionVersion,
    scope: input.scope,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(TOKEN_ISSUER)
    .setAudience(TOKEN_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds} seconds`)
    .sign(ESIGNING_TOKEN_SECRET);
}

export async function verifyEsigningScopedToken(
  token: string,
  expectedScope: EsigningTokenScope
): Promise<EsigningTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, ESIGNING_TOKEN_SECRET, {
      issuer: TOKEN_ISSUER,
      audience: TOKEN_AUDIENCE,
    });

    if (payload.scope !== expectedScope) {
      return null;
    }

    return payload as EsigningTokenClaims;
  } catch {
    return null;
  }
}

export async function setEsigningSessionCookie(input: {
  recipientId: string;
  envelopeId: string;
  sessionVersion: number;
  sessionId?: string;
}): Promise<string> {
  const token = await createEsigningScopedToken({
    ...input,
    scope: 'esigning_session',
    expiresInSeconds: getEsigningSessionTtlSeconds(),
    sessionId: input.sessionId ?? randomBytes(16).toString('hex'),
  });

  const cookieStore = await cookies();
  cookieStore.set(
    ESIGNING_SESSION_COOKIE,
    token,
    buildCookieOptions(getEsigningSessionTtlSeconds())
  );

  return token;
}

export async function clearEsigningSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(ESIGNING_SESSION_COOKIE);
}

export async function getEsigningSessionClaims(): Promise<EsigningTokenClaims | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(ESIGNING_SESSION_COOKIE)?.value;

  if (!token) {
    return null;
  }

  return verifyEsigningScopedToken(token, 'esigning_session');
}

export async function setEsigningChallengeCookie(input: {
  recipientId: string;
  envelopeId: string;
  sessionVersion: number;
}): Promise<string> {
  const token = await createEsigningScopedToken({
    ...input,
    scope: 'esigning_challenge',
    expiresInSeconds: getEsigningChallengeTtlSeconds(),
  });

  const cookieStore = await cookies();
  cookieStore.set(
    ESIGNING_CHALLENGE_COOKIE,
    token,
    buildCookieOptions(getEsigningChallengeTtlSeconds())
  );

  return token;
}

export async function clearEsigningChallengeCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(ESIGNING_CHALLENGE_COOKIE);
}

export async function getEsigningChallengeClaims(): Promise<EsigningTokenClaims | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(ESIGNING_CHALLENGE_COOKIE)?.value;

  if (!token) {
    return null;
  }

  return verifyEsigningScopedToken(token, 'esigning_challenge');
}

export async function createEsigningDownloadToken(input: {
  recipientId: string;
  envelopeId: string;
  sessionVersion: number;
}): Promise<string> {
  return createEsigningScopedToken({
    ...input,
    scope: 'esigning_download',
    expiresInSeconds: getEsigningDownloadTtlSeconds(),
  });
}

export async function createEsigningAccessLinkToken(input: {
  recipientId: string;
  envelopeId: string;
  sessionVersion: number;
  expiresInSeconds?: number;
}): Promise<string> {
  return createEsigningScopedToken({
    ...input,
    scope: 'esigning_access',
    expiresInSeconds: input.expiresInSeconds ?? getEsigningDeliveryTtlSeconds(),
  });
}

export async function verifyEsigningAccessLinkToken(
  token: string
): Promise<EsigningTokenClaims | null> {
  return verifyEsigningScopedToken(token, 'esigning_access');
}

export async function createEsigningDeliveryToken(input: {
  envelopeId: string;
  actorType: 'recipient' | 'sender';
  recipientId?: string;
  expiresInSeconds?: number;
}): Promise<string> {
  const ttlSeconds = Math.max(
    30,
    Math.floor(input.expiresInSeconds ?? getEsigningDeliveryTtlSeconds())
  );

  return new SignJWT({
    envelopeId: input.envelopeId,
    recipientId: input.recipientId,
    actorType: input.actorType,
    scope: 'esigning_delivery',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(TOKEN_ISSUER)
    .setAudience(TOKEN_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds} seconds`)
    .sign(ESIGNING_TOKEN_SECRET);
}

export async function verifyEsigningDeliveryToken(
  token: string
): Promise<EsigningDeliveryTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, ESIGNING_TOKEN_SECRET, {
      issuer: TOKEN_ISSUER,
      audience: TOKEN_AUDIENCE,
    });

    if (payload.scope !== 'esigning_delivery') {
      return null;
    }

    if (typeof payload.envelopeId !== 'string' || typeof payload.actorType !== 'string') {
      return null;
    }

    if (payload.actorType !== 'recipient' && payload.actorType !== 'sender') {
      return null;
    }

    if (payload.recipientId !== undefined && typeof payload.recipientId !== 'string') {
      return null;
    }

    return payload as EsigningDeliveryTokenClaims;
  } catch {
    return null;
  }
}

export function buildEsigningSigningUrl(token: string, baseUrl?: string): string {
  const normalizedBaseUrl = (baseUrl ?? getAppBaseUrl()).trim().replace(/\/+$/, '');
  return `${normalizedBaseUrl}/esigning/sign/${token}`;
}

export function buildEsigningVerificationUrl(certificateId: string): string {
  return `${getAppBaseUrl()}/verify/${encodeURIComponent(certificateId)}`;
}

export function buildEsigningDeliveryDownloadUrl(input: {
  token: string;
  documentId: string;
  variant?: 'signed' | 'certificate';
}): string {
  const searchParams = new URLSearchParams({
    token: input.token,
    documentId: input.documentId,
    variant: input.variant ?? 'signed',
  });

  return `${getAppBaseUrl()}/api/esigning/delivery/download?${searchParams.toString()}`;
}

export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get('origin') || request.headers.get('referer');
  if (!origin) {
    return true;
  }

  const forwardedProto = request.headers.get('x-forwarded-proto');
  const forwardedHost = request.headers.get('x-forwarded-host');
  const requestOrigin =
    forwardedProto && forwardedHost
      ? `${forwardedProto}://${forwardedHost}`
      : new URL(request.url).origin;

  try {
    const originUrl = new URL(origin);
    return originUrl.origin === requestOrigin;
  } catch {
    return false;
  }
}
