import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeadlineApiError, ErrorCodes } from '@/lib/errors';

const session = {
  id: '11111111-1111-4111-8111-111111111111',
  tenantId: '22222222-2222-4222-8222-222222222222',
  isSuperAdmin: false,
  isWorkspaceAdmin: true,
};

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requireServiceAdministrator: vi.fn(),
  resolveWorkspaceId: vi.fn(),
  listDeadlineRules: vi.fn(),
  getDeadlineRule: vi.fn(),
  createDeadlineRule: vi.fn(),
  updateDeadlineRuleDraft: vi.fn(),
  previewDeadlineRuleImpact: vi.fn(),
  publishDeadlineRule: vi.fn(),
  archiveDeadlineRule: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: mocks.requireAuth }));
vi.mock('@/lib/service-administration-auth', () => ({ requireServiceAdministrator: mocks.requireServiceAdministrator }));
vi.mock('@/lib/api-helpers', () => ({ resolveWorkspaceId: mocks.resolveWorkspaceId }));
vi.mock('@/services/deadline-rule', async () => {
  const { z } = await import('zod');
  const identity = z.object({
    operation: z.enum(['PUBLISH', 'ARCHIVE']),
    expectedCurrentVersion: z.number().int().min(0).nullable(),
    expectedDraftRevision: z.number().int().min(1),
    draftConfigHash: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict();
  return {
    listDeadlineRules: mocks.listDeadlineRules,
    getDeadlineRule: mocks.getDeadlineRule,
    createDeadlineRule: mocks.createDeadlineRule,
    updateDeadlineRuleDraft: mocks.updateDeadlineRuleDraft,
    previewDeadlineRuleImpact: mocks.previewDeadlineRuleImpact,
    publishDeadlineRule: mocks.publishDeadlineRule,
    archiveDeadlineRule: mocks.archiveDeadlineRule,
    deadlineRuleImpactPreviewSchema: identity,
    deadlineRulePublishSchema: identity.extend({ operation: z.literal('PUBLISH'), previewFingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
    deadlineRuleArchiveSchema: identity.extend({ operation: z.literal('ARCHIVE'), previewFingerprint: z.string().regex(/^[a-f0-9]{64}$/), reason: z.string().trim().min(1).max(1000) }).strict(),
  };
});

import { GET, POST } from '@/app/api/service-catalog/deadline-rules/route';
import { GET as getOne, PATCH } from '@/app/api/service-catalog/deadline-rules/[id]/route';
import { POST as previewImpact } from '@/app/api/service-catalog/deadline-rules/[id]/impact/route';
import { POST as publish } from '@/app/api/service-catalog/deadline-rules/[id]/publish/route';
import { POST as archive } from '@/app/api/service-catalog/deadline-rules/[id]/archive/route';

const draft = {
  code: 'SG_ECI',
  name: 'ECI',
  description: null,
  recurrence: { schemaVersion: 1, kind: 'ANNUALLY' },
  applicability: { schemaVersion: 1, kind: 'ALL', conditions: [] },
  parameters: [],
  milestones: [{
    key: 'eci-due',
    name: 'ECI due',
    description: null,
    type: 'STATUTORY',
    generationMode: 'ONCE_PER_CYCLE',
    expression: { kind: 'SOURCE', source: { kind: 'CYCLE_END' } },
    businessDayAdjustment: 'NONE',
    displayOrder: 0,
    isActive: true,
  }],
};

describe('deadline rule routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue(session);
    mocks.resolveWorkspaceId.mockReturnValue(session.tenantId);
  });

  it('lists tenant-scoped rules as a service administrator', async () => {
    mocks.listDeadlineRules.mockResolvedValue({ rules: [], total: 0 });
    const response = await GET(new NextRequest('http://localhost/api/service-catalog/deadline-rules'));
    expect(response.status).toBe(200);
    expect(mocks.requireServiceAdministrator).toHaveBeenCalledWith(session);
    expect(mocks.listDeadlineRules).toHaveBeenCalledWith(expect.objectContaining({ page: 1 }), {
      tenantId: session.tenantId,
      userId: session.id,
    });
  });

  it('parses and creates a strict draft payload', async () => {
    mocks.createDeadlineRule.mockResolvedValue({ id: 'rule-1' });
    const response = await POST(new NextRequest('http://localhost/api/service-catalog/deadline-rules', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...draft, tenantId: session.tenantId }),
    }));
    expect(response.status).toBe(201);
    expect(mocks.createDeadlineRule).toHaveBeenCalledWith(expect.objectContaining({ code: 'SG_ECI' }), {
      tenantId: session.tenantId,
      userId: session.id,
    });
  });

  it('loads and updates one tenant-scoped draft', async () => {
    const ruleId = '33333333-3333-4333-8333-333333333333';
    mocks.getDeadlineRule.mockResolvedValue({ id: ruleId });
    mocks.updateDeadlineRuleDraft.mockResolvedValue({ id: ruleId });
    const getResponse = await getOne(
      new NextRequest(`http://localhost/api/service-catalog/deadline-rules/${ruleId}`),
      { params: Promise.resolve({ id: ruleId }) },
    );
    const patchResponse = await PATCH(
      new NextRequest(`http://localhost/api/service-catalog/deadline-rules/${ruleId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...draft, expectedDraftRevision: 1 }),
      }),
      { params: Promise.resolve({ id: ruleId }) },
    );
    expect(getResponse.status).toBe(200);
    expect(patchResponse.status).toBe(200);
  });

  it('previews, publishes, and archives through admin-only POST routes', async () => {
    const ruleId = '33333333-3333-4333-8333-333333333333';
    const identity = {
      operation: 'PUBLISH' as const,
      expectedCurrentVersion: 2,
      expectedDraftRevision: 4,
      draftConfigHash: 'a'.repeat(64),
    };
    mocks.previewDeadlineRuleImpact.mockResolvedValue({
      ruleId,
      currentPublishedVersion: 2,
      draftRevision: 4,
      draftConfigHash: identity.draftConfigHash,
      previewFingerprint: 'b'.repeat(64),
      counts: { created: 0, recalculated: 0, cancelled: 0, preserved: 0, inapplicable: 0, missingInput: 0, conflicts: 0, warnings: 0 },
      samples: [],
    });
    mocks.publishDeadlineRule.mockResolvedValue({ id: ruleId, currentVersionId: 'version-3' });
    mocks.archiveDeadlineRule.mockResolvedValue({ id: ruleId, isActive: false });

    const impactResponse = await previewImpact(
      new NextRequest(`http://localhost/api/service-catalog/deadline-rules/${ruleId}/impact`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...identity, tenantId: session.tenantId }),
      }),
      { params: Promise.resolve({ id: ruleId }) },
    );
    const publishResponse = await publish(
      new NextRequest(`http://localhost/api/service-catalog/deadline-rules/${ruleId}/publish`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...identity, previewFingerprint: 'b'.repeat(64), tenantId: session.tenantId }),
      }),
      { params: Promise.resolve({ id: ruleId }) },
    );
    const archiveResponse = await archive(
      new NextRequest(`http://localhost/api/service-catalog/deadline-rules/${ruleId}/archive`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...identity, operation: 'ARCHIVE', previewFingerprint: 'b'.repeat(64), reason: 'Retired', tenantId: session.tenantId }),
      }),
      { params: Promise.resolve({ id: ruleId }) },
    );

    expect(impactResponse.status).toBe(200);
    expect(publishResponse.status).toBe(200);
    expect(archiveResponse.status).toBe(200);
    expect(mocks.previewDeadlineRuleImpact).toHaveBeenCalledWith(ruleId, identity, { tenantId: session.tenantId, userId: session.id });
    expect(mocks.publishDeadlineRule).toHaveBeenCalledWith(ruleId, expect.objectContaining({ previewFingerprint: 'b'.repeat(64) }), { tenantId: session.tenantId, userId: session.id });
    expect(mocks.archiveDeadlineRule).toHaveBeenCalledWith(ruleId, expect.objectContaining({ reason: 'Retired' }), { tenantId: session.tenantId, userId: session.id });
  });

  it('returns a fresh impact summary with 409 when publish is stale', async () => {
    const ruleId = '33333333-3333-4333-8333-333333333333';
    const freshImpact = { ruleId, previewFingerprint: 'c'.repeat(64), counts: {}, samples: [] };
    mocks.publishDeadlineRule.mockRejectedValue(new DeadlineApiError(
      ErrorCodes.IMPACT_CHANGED,
      'Deadline rule impact preview is stale',
      409,
      { impact: freshImpact },
    ));
    const response = await publish(
      new NextRequest(`http://localhost/api/service-catalog/deadline-rules/${ruleId}/publish`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          operation: 'PUBLISH',
          expectedCurrentVersion: 2,
          expectedDraftRevision: 4,
          draftConfigHash: 'a'.repeat(64),
          previewFingerprint: 'b'.repeat(64),
        }),
      }),
      { params: Promise.resolve({ id: ruleId }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      error: expect.objectContaining({
        code: ErrorCodes.IMPACT_CHANGED,
        details: { impact: freshImpact },
      }),
    }));
  });

  it('returns validation errors for malformed JSON, non-object JSON, invalid UUIDs, and tenant mismatches', async () => {
    const invalidJson = await POST(new NextRequest('http://localhost/api/service-catalog/deadline-rules', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"code":',
    }));
    expect(invalidJson.status).toBe(400);

    const nonObject = await POST(new NextRequest('http://localhost/api/service-catalog/deadline-rules', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([]),
    }));
    expect(nonObject.status).toBe(400);

    const invalidQueryTenant = await GET(new NextRequest(
      'http://localhost/api/service-catalog/deadline-rules?tenantId=tenant-1',
    ));
    expect(invalidQueryTenant.status).toBe(400);

    const invalidId = await getOne(
      new NextRequest('http://localhost/api/service-catalog/deadline-rules/not-a-uuid'),
      { params: Promise.resolve({ id: 'not-a-uuid' }) },
    );
    expect(invalidId.status).toBe(400);

    const mismatchedTenant = await POST(new NextRequest(
      `http://localhost/api/service-catalog/deadline-rules?tenantId=${session.tenantId}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...draft, tenantId: '44444444-4444-4444-8444-444444444444' }),
      },
    ));
    expect(mismatchedTenant.status).toBe(400);
    expect(mocks.createDeadlineRule).not.toHaveBeenCalled();

    const invalidPatchTenant = await PATCH(new NextRequest(
      `http://localhost/api/service-catalog/deadline-rules/${'33333333-3333-4333-8333-333333333333'}?tenantId=${session.tenantId}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...draft, tenantId: 'not-a-uuid' }),
      },
    ), { params: Promise.resolve({ id: '33333333-3333-4333-8333-333333333333' }) });
    expect(invalidPatchTenant.status).toBe(400);

    const mismatchedPatchTenant = await PATCH(new NextRequest(
      `http://localhost/api/service-catalog/deadline-rules/${'33333333-3333-4333-8333-333333333333'}?tenantId=${session.tenantId}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...draft, tenantId: '44444444-4444-4444-8444-444444444444' }),
      },
    ), { params: Promise.resolve({ id: '33333333-3333-4333-8333-333333333333' }) });
    expect(mismatchedPatchTenant.status).toBe(400);
    expect(mocks.updateDeadlineRuleDraft).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON and UUID metadata on impact/publish/archive routes', async () => {
    const ruleId = '33333333-3333-4333-8333-333333333333';
    const invalidImpact = await previewImpact(
      new NextRequest(`http://localhost/api/service-catalog/deadline-rules/${ruleId}/impact`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"expectedCurrentVersion":',
      }),
      { params: Promise.resolve({ id: ruleId }) },
    );
    const invalidPublishTenant = await publish(
      new NextRequest(`http://localhost/api/service-catalog/deadline-rules/${ruleId}/publish?tenantId=${session.tenantId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ operation: 'PUBLISH', expectedCurrentVersion: 2, expectedDraftRevision: 4, draftConfigHash: 'a'.repeat(64), previewFingerprint: 'b'.repeat(64), tenantId: 'not-a-uuid' }),
      }),
      { params: Promise.resolve({ id: ruleId }) },
    );
    const invalidArchiveId = await archive(
      new NextRequest('http://localhost/api/service-catalog/deadline-rules/not-a-uuid/archive', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ operation: 'ARCHIVE', expectedCurrentVersion: 2, expectedDraftRevision: 4, draftConfigHash: 'a'.repeat(64), previewFingerprint: 'b'.repeat(64), reason: 'Retired' }),
      }),
      { params: Promise.resolve({ id: 'not-a-uuid' }) },
    );

    expect(invalidImpact.status).toBe(400);
    expect(invalidPublishTenant.status).toBe(400);
    expect(invalidArchiveId.status).toBe(400);
    expect(mocks.publishDeadlineRule).not.toHaveBeenCalled();
    expect(mocks.archiveDeadlineRule).not.toHaveBeenCalled();
  });

  it('rejects unknown and duplicate query parameters on impact, publish, and archive routes', async () => {
    const ruleId = '33333333-3333-4333-8333-333333333333';
    const body = JSON.stringify({
      operation: 'PUBLISH',
      expectedCurrentVersion: 2,
      expectedDraftRevision: 4,
      draftConfigHash: 'a'.repeat(64),
      previewFingerprint: 'b'.repeat(64),
    });
    const archiveBody = JSON.stringify({ ...JSON.parse(body), operation: 'ARCHIVE', reason: 'Retired' });
    const responses = await Promise.all([
      previewImpact(new NextRequest(`http://localhost/api/service-catalog/deadline-rules/${ruleId}/impact?tenantId=${session.tenantId}&unexpected=true`, { method: 'POST', body }), { params: Promise.resolve({ id: ruleId }) }),
      publish(new NextRequest(`http://localhost/api/service-catalog/deadline-rules/${ruleId}/publish?tenantId=${session.tenantId}&tenantId=${session.tenantId}`, { method: 'POST', body }), { params: Promise.resolve({ id: ruleId }) }),
      archive(new NextRequest(`http://localhost/api/service-catalog/deadline-rules/${ruleId}/archive?unexpected=true`, { method: 'POST', body: archiveBody }), { params: Promise.resolve({ id: ruleId }) }),
    ]);
    expect(responses.map((response) => response.status)).toEqual([400, 400, 400]);
    expect(mocks.previewDeadlineRuleImpact).not.toHaveBeenCalled();
    expect(mocks.publishDeadlineRule).not.toHaveBeenCalled();
    expect(mocks.archiveDeadlineRule).not.toHaveBeenCalled();
  });
});
