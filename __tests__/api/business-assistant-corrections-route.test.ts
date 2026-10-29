// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ session: vi.fn(), authorize: vi.fn(), correction: vi.fn() }));
vi.mock('@/lib/auth', () => ({ getSession: mocks.session }));
vi.mock('@/services/business-assistant/policy.service', () => ({
  assertAssistantActor: mocks.authorize, AssistantPolicyError: class extends Error {},
}));
vi.mock('@/services/business-assistant/correction.service', () => ({ createCorrectionProposal: mocks.correction }));

import { POST } from '@/app/api/business-assistant/runs/[id]/corrections/route';

const body = { workspaceId: 'workspace', reviewId: 'review', clientRequestId: 'request', corrections: [{ findingId: 'finding', value: 'Corrected name' }] };
const request = (origin = 'https://app.example.test') => new Request('https://app.example.test/api/business-assistant/runs/run/corrections', {
  method: 'POST', headers: { 'content-type': 'application/json', origin, 'x-request-id': 'trace' }, body: JSON.stringify(body),
});
const params = { params: Promise.resolve({ id: 'run' }) };

describe('assistant correction endpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ id: 'user', workspaceId: 'workspace' });
    mocks.authorize.mockResolvedValue({ allowed: true });
    mocks.correction.mockResolvedValue({ runId: 'new-run', proposalId: 'new-proposal', revision: 1, duplicate: false });
  });

  it('uses the authenticated actor and returns an uncached proposal', async () => {
    const response = await POST(request(), params);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.correction).toHaveBeenCalledWith({
      actor: { tenantId: 'workspace', userId: 'user', requestId: 'trace', source: 'BUSINESS_ASSISTANT' }, runId: 'run', rawInput: body,
    });
    expect(await response.json()).toMatchObject({ correction: { proposalId: 'new-proposal' } });
  });

  it('rejects an unauthenticated request before preparing a correction', async () => {
    mocks.session.mockResolvedValue(null);
    expect((await POST(request(), params)).status).toBe(401);
    expect(mocks.correction).not.toHaveBeenCalled();
  });

  it('rejects a cross-origin request before preparing a correction', async () => {
    expect((await POST(request('https://other.example.test'), params)).status).toBe(403);
    expect(mocks.correction).not.toHaveBeenCalled();
  });

  it('reports a stale review as a conflict without caching it', async () => {
    mocks.correction.mockRejectedValue(Object.assign(new Error('The review has changed.'), { code: 'PROPOSAL_STALE' }));
    const response = await POST(request(), params);
    expect(response.status).toBe(409);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ error: { code: 'PROPOSAL_STALE', message: 'The review has changed.' } });
  });
});
