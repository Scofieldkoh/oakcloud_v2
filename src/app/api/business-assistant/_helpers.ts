import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { isValidOrigin } from '@/lib/request-origin';
import { assertAssistantActor, AssistantPolicyError } from '@/services/business-assistant/policy.service';

export interface AssistantRouteActor {
  userId: string;
  tenantId: string;
  requestId: string;
  session: SessionUser;
}

export async function routeActor(request: Request, workspaceId?: string | null): Promise<AssistantRouteActor> {
  const session = await getSession();
  if (!session) throw new AssistantRouteError(401, 'UNAUTHORIZED', 'Authentication is required.');
  const tenantId = workspaceId ?? session.workspaceId ?? session.tenantId;
  if (!tenantId) throw new AssistantRouteError(400, 'VALIDATION_FAILED', 'Select a workspace before using Business Assistant.');
  const origin = request.headers.get('origin');
  const host = request.headers.get('host') || new URL(request.url).host;
  if (!isValidOrigin(origin, host)) throw new AssistantRouteError(403, 'FORBIDDEN', 'The request origin is not allowed.');
  try {
    await assertAssistantActor(session.id, tenantId);
  } catch (error) {
    if (error instanceof AssistantPolicyError) throw new AssistantRouteError(403, error.safeError.code, error.safeError.message);
    throw error;
  }
  return { userId: session.id, tenantId, requestId: request.headers.get('x-request-id')?.slice(0, 200) || randomUUID(), session };
}

export async function readJson(request: Request): Promise<unknown> {
  const maxBytes = 1_100_000;
  const declaredLength = request.headers.get('content-length');
  if (declaredLength) {
    const parsedLength = Number(declaredLength);
    if (!Number.isFinite(parsedLength) || parsedLength < 0 || parsedLength > maxBytes) {
      throw new AssistantRouteError(413, 'VALIDATION_FAILED', 'Request body is too large.');
    }
  }
  try {
    if (!request.body) throw new AssistantRouteError(400, 'VALIDATION_FAILED', 'Request body must be valid JSON.');
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maxBytes) {
          await reader.cancel().catch(() => undefined);
          throw new AssistantRouteError(413, 'VALIDATION_FAILED', 'Request body is too large.');
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const text = Buffer.concat(chunks, bytes).toString('utf8');
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof AssistantRouteError) throw error;
    throw new AssistantRouteError(400, 'VALIDATION_FAILED', 'Request body must be valid JSON.');
  }
}

export function noStore<T>(body: T, init: ResponseInit = {}): NextResponse<T> {
  const headers = new Headers(init.headers);
  headers.set('Cache-Control', 'private, no-store');
  return NextResponse.json(body, { ...init, headers });
}

export function handleAssistantError(error: unknown): NextResponse {
  if (error instanceof AssistantRouteError) return noStore({ error: { code: error.code, message: error.message } }, { status: error.status });
  if (error instanceof AssistantPolicyError) return noStore({ error: error.safeError }, { status: error.safeError.code === 'NOT_FOUND' ? 404 : 403 });
  const safeCodes = new Set([
    'VALIDATION_FAILED', 'FORBIDDEN', 'NOT_FOUND', 'PROPOSAL_STALE', 'APPROVAL_EXPIRED',
    'ACTION_CONFLICT', 'RATE_LIMITED', 'OUTCOME_UNKNOWN', 'EVIDENCE_UNAVAILABLE',
    'CAPABILITY_VERSION_UNAVAILABLE', 'WORKSPACE_PAUSED',
  ]);
  if (error && typeof error === 'object' && 'code' in error && typeof (error as { code?: unknown }).code === 'string') {
    const code = (error as { code: string }).code;
    if (safeCodes.has(code)) {
      const status = code === 'NOT_FOUND' ? 404 : code === 'FORBIDDEN' ? 403 : code === 'VALIDATION_FAILED' ? 400 : code === 'APPROVAL_EXPIRED' || code === 'PROPOSAL_STALE' || code === 'ACTION_CONFLICT' ? 409 : code === 'RATE_LIMITED' ? 429 : 400;
      return noStore({ error: { code, message: error instanceof Error ? error.message : 'Business Assistant request failed.' } }, { status });
    }
  }
  console.error('[business-assistant] route error', error instanceof Error ? error.message : error);
  return noStore({ error: { code: 'INTERNAL_ERROR', message: 'Business Assistant could not complete the request.' } }, { status: 500 });
}

export class AssistantRouteError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = 'AssistantRouteError';
  }
}
