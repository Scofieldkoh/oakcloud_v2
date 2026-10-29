import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { issueBizFilePreparationToken, verifyBizFilePreparationToken } from '@/services/bizfile/application/preparation-token';

describe('BizFile preparation binding', () => {
  const binding = { actorId: 'actor', tenantId: 'tenant', documentId: 'document', planHash: 'a'.repeat(64), contextHash: 'b'.repeat(64) };
  const now = Date.UTC(2026, 8, 7);
  beforeEach(() => vi.stubEnv('BUSINESS_ASSISTANT_PREPARATION_SECRET', 'test-only-preparation-signing-secret-32-characters'));
  afterEach(() => vi.unstubAllEnvs());

  it('verifies an exact binding and rejects the expiration boundary', () => {
    const { token, expiresAt } = issueBizFilePreparationToken(binding, now);
    expect(() => verifyBizFilePreparationToken(token, binding, now + 1)).not.toThrow();
    expect(() => verifyBizFilePreparationToken(token, binding, Date.parse(expiresAt))).toThrow('expired');
  });

  it.each(['actorId', 'tenantId', 'documentId', 'planHash', 'contextHash'] as const)('rejects reuse with a different %s', (field) => {
    const { token } = issueBizFilePreparationToken(binding, now);
    expect(() => verifyBizFilePreparationToken(token, { ...binding, [field]: 'changed' }, now)).toThrow('does not match');
  });

  it('rejects edited payloads even when their hash is recomputed by a caller', () => {
    const { token } = issueBizFilePreparationToken(binding, now);
    const [body, signature] = token.split('.');
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    payload.planHash = 'c'.repeat(64);
    const edited = `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${signature}`;
    expect(() => verifyBizFilePreparationToken(edited, { ...binding, planHash: payload.planHash }, now)).toThrow('does not match');
  });

  it.each(['', 'abc', 'abc.def.ghi', 'a'.repeat(4097)])('rejects malformed tokens', (token) => {
    expect(() => verifyBizFilePreparationToken(token, binding, now)).toThrow('does not match');
  });

  it('fails closed without a signing secret', () => {
    vi.stubEnv('BUSINESS_ASSISTANT_PREPARATION_SECRET', ''); vi.stubEnv('JWT_SECRET', '');
    expect(() => issueBizFilePreparationToken(binding, now)).toThrow('signing secret');
  });
});
