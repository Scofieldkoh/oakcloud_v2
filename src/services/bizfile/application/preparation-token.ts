import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const lifetimeMs = 30 * 60_000;
const bindingSchema = z.object({
  actorId: z.string().min(1).max(200),
  tenantId: z.string().min(1).max(200),
  documentId: z.string().min(1).max(200),
  planHash: z.string().regex(/^[a-f0-9]{64}$/),
  contextHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
const tokenSchema = bindingSchema.extend({ version: z.literal(1), issuedAt: z.number().int(), expiresAt: z.number().int() }).strict();
export type BizFilePreparationBinding = z.infer<typeof bindingSchema>;

function signingKey(): string {
  const secret = process.env.BUSINESS_ASSISTANT_PREPARATION_SECRET || process.env.JWT_SECRET;
  if (!secret || secret.length < 32) throw new Error('A preparation signing secret of at least 32 characters is required');
  return secret;
}

function signature(payload: string): Buffer {
  return createHmac('sha256', signingKey()).update('oakcloud:bizfile-preparation:v1\0').update(payload).digest();
}

/** Bind an exact server-prepared plan to its requester and task context. The
 * signature proves preparation; fresh permissions and aggregate/source guards
 * still have to pass in the canonical mutation transaction. */
export function issueBizFilePreparationToken(binding: BizFilePreparationBinding, now = Date.now()): { token: string; expiresAt: string } {
  const payload = Buffer.from(JSON.stringify({ ...bindingSchema.parse(binding), version: 1, issuedAt: now, expiresAt: now + lifetimeMs })).toString('base64url');
  return { token: `${payload}.${signature(payload).toString('base64url')}`, expiresAt: new Date(now + lifetimeMs).toISOString() };
}

export class BizFilePreparationTokenError extends Error {
  constructor(readonly code: 'INVALID_PREPARATION' | 'EXPIRED_PREPARATION') {
    super(code === 'EXPIRED_PREPARATION' ? 'The reviewed proposal has expired. Prepare it again.' : 'The preparation does not match this request. Prepare the changes again.');
  }
}

export function verifyBizFilePreparationToken(token: unknown, binding: BizFilePreparationBinding, now = Date.now(), options: { allowExpiredReceiptRead?: boolean } = {}): { expiresAt: number } {
  const invalid = () => new BizFilePreparationTokenError('INVALID_PREPARATION');
  if (typeof token !== 'string' || token.length > 4096) throw invalid();
  const parts = token.split('.');
  if (parts.length !== 2 || !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) throw invalid();
  const actual = Buffer.from(parts[1], 'base64url');
  const expected = signature(parts[0]);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw invalid();
  let value: unknown;
  try { value = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch { throw invalid(); }
  const parsed = tokenSchema.safeParse(value);
  if (!parsed.success) throw invalid();
  const payload = parsed.data;
  for (const field of Object.keys(bindingSchema.shape) as Array<keyof BizFilePreparationBinding>) {
    if (payload[field] !== binding[field]) throw invalid();
  }
  if (payload.expiresAt - payload.issuedAt !== lifetimeMs || payload.issuedAt > now + 5_000) throw invalid();
  if (payload.expiresAt <= now && !options.allowExpiredReceiptRead) throw new BizFilePreparationTokenError('EXPIRED_PREPARATION');
  return { expiresAt: payload.expiresAt };
}
