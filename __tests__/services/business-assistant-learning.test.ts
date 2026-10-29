import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  current: null as any,
  findMany: vi.fn(),
  findFirst: vi.fn(),
  learningUpdateMany: vi.fn(),
  actionFindFirst: vi.fn(),
  actionCreate: vi.fn(),
  activeUpdateMany: vi.fn(),
  activeCreate: vi.fn(),
  activeFindUnique: vi.fn(),
  learningCreate: vi.fn(),
  auditCreate: vi.fn(),
  backupFindMany: vi.fn(),
  access: vi.fn(),
  operationBarrier: vi.fn(),
  resolveFreshActor: vi.fn(),
  events: [] as string[],
}));

vi.mock('@/lib/prisma', () => ({ prisma: {
  businessAssistantActionRequest: { findFirst: mocks.actionFindFirst },
  workspaceBackup: { findMany: mocks.backupFindMany },
  businessAssistantLearningActiveTarget: { findUnique: mocks.activeFindUnique },
  businessAssistantLearningChange: { findMany: mocks.findMany, findFirst: mocks.findFirst, create: mocks.learningCreate },
} }));
vi.mock('@/lib/prisma-transaction', () => ({ runSerializableTransaction: async (_db: unknown, run: (tx: unknown) => unknown) => run({
  businessAssistantLearningChange: { findFirst: mocks.findFirst, updateMany: mocks.learningUpdateMany, create: mocks.learningCreate },
  businessAssistantActionRequest: { findFirst: mocks.actionFindFirst, create: mocks.actionCreate },
  businessAssistantLearningActiveTarget: { findUnique: mocks.activeFindUnique, updateMany: mocks.activeUpdateMany, create: mocks.activeCreate },
  workspaceBackup: { findMany: mocks.backupFindMany },
  auditLog: { create: mocks.auditCreate },
}) }));
vi.mock('@/lib/business-operation-backup-barrier', () => ({ acquireBusinessOperationBarrier: mocks.operationBarrier }));
vi.mock('@/lib/fresh-authorization', () => ({ resolveFreshActor: mocks.resolveFreshActor }));
vi.mock('@/services/business-assistant/policy.service', () => ({ assertAssistantAdministrativeAccess: mocks.access }));

import {
  applyLearningAction,
  createLearningCandidate,
  getActiveLearningConfiguration,
  listLearningChanges,
} from '@/services/business-assistant/learning.service';
import { evaluateLearningCandidateBehavior } from '@/services/business-assistant/learning-behavioral-evaluator';
import { createLearningLifecycleMarker } from '@/services/business-assistant/learning-active-target';
import { learningTargetDefinition, resolveLearningTarget } from '@/services/business-assistant/learning-targets';
import { setLearningPromotionTestGateForTests } from '@/services/business-assistant/learning-release-gate';

const actor = { userId: 'user', tenantId: 'workspace', requestId: 'request' };
const governedEvidence = (baselineTargetRevision = 0) => ({
  source: 'DIRECT_REQUEST',
  sourceEvidence: {},
  governance: {
    schemaVersion: '1', targetKey: 'assistant.response_detail', capabilityId: 'assistant.answer',
    capabilityVersion: '1.0', baselineTargetRevision,
  },
});
const candidate = {
  id: 'change', targetKey: 'assistant.response_detail', targetKind: 'PREFERENCE',
  risk: 'LOW', baselineVersion: '1', candidateVersion: '2', candidateValue: 'detailed',
  evidence: governedEvidence(), evaluation: null, state: 'CANDIDATE', expectedVersion: 1,
  approvedById: null, approvedAt: null, promotedAt: null, rollbackTarget: null,
  createdAt: new Date('2026-09-10T10:00:00.000Z'), updatedAt: new Date('2026-09-10T10:00:00.000Z'),
};
const request = (action: string, expectedVersion = 1) => ({
  action,
  expectedVersion,
  clientRequestId: '1d0fd7b2-16ec-4111-a0f9-6319cc5f9e75',
});

function applyMutation(row: any, data: Record<string, any>): any {
  const expectedVersion = data.expectedVersion && typeof data.expectedVersion === 'object' && 'increment' in data.expectedVersion
    ? row.expectedVersion + Number(data.expectedVersion.increment)
    : data.expectedVersion ?? row.expectedVersion;
  return { ...row, ...data, expectedVersion, updatedAt: new Date() };
}

describe('governed Business Assistant learning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('VITEST', 'true');
    vi.stubEnv('NODE_ENV', 'test');
    setLearningPromotionTestGateForTests(false);
    mocks.events.length = 0;
    mocks.current = { ...candidate, evidence: governedEvidence() };
    mocks.access.mockResolvedValue({ isAdmin: true });
    mocks.operationBarrier.mockResolvedValue(undefined);
    mocks.resolveFreshActor.mockResolvedValue({ isWorkspaceAdmin: true, isSuperAdmin: false, internalRole: 'ADMIN' });
    mocks.activeFindUnique.mockResolvedValue(null);
    mocks.activeUpdateMany.mockResolvedValue({ count: 1 });
    mocks.activeCreate.mockImplementation(({ data }) => ({ id: 'target', revision: 1, ...data }));
    mocks.backupFindMany.mockResolvedValue([]);
    mocks.findMany.mockResolvedValue([]);
    mocks.findFirst.mockImplementation(async () => mocks.current);
    mocks.learningUpdateMany.mockImplementation(async ({ data }) => {
      mocks.current = applyMutation(mocks.current, data);
      return { count: 1 };
    });
    mocks.learningCreate.mockImplementation(({ data }) => ({ ...candidate, ...data }));
    mocks.actionFindFirst.mockResolvedValue(null);
    mocks.actionCreate.mockResolvedValue({ id: 'audit-request' });
    mocks.auditCreate.mockResolvedValue({ id: 'audit-log' });
  });

  afterEach(() => {
    setLearningPromotionTestGateForTests(false);
    vi.unstubAllEnvs();
  });

  it('runs server-owned held-out runtime behavior cases and keeps release eligibility separate', async () => {
    const result = await applyLearningAction(actor, 'change', request('EVALUATE'));
    expect(result.evaluation).toMatchObject({
      source: 'SERVER_HELD_OUT_BEHAVIORAL_CASES', staticChecksPassed: true,
      behavioralEvaluation: 'PASSED', promotionEligible: false,
      releaseState: 'GATED_PENDING_RELEASE_REQUIREMENTS', passed: true, cases: 6, passedChecks: 6,
    });
    expect(result.allowedActions).toEqual(['EVALUATE', 'APPROVE', 'REJECT']);
    expect(mocks.learningUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'change', tenantId: 'workspace', ownerId: 'user', expectedVersion: 1 },
    }));
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      summary: 'Applied governed learning action EVALUATE',
      metadata: expect.objectContaining({ lifecycleAction: 'EVALUATE', candidateExpectedVersion: 1, resultingExpectedVersion: 2 }),
    }) }));
  });

  it('authorizes approval only when the evaluation is cryptographically bound to this candidate', async () => {
    const evaluation = evaluateLearningCandidateBehavior(candidate);
    mocks.current = { ...candidate, state: 'EVALUATED', evaluation };
    const result = await applyLearningAction(actor, 'change', request('APPROVE'));
    expect(result.state).toBe('APPROVED');
    expect(mocks.learningUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ approvedById: 'user', approvedAt: expect.any(Date) }),
    }));
  });

  it('rejects schema-only or copied evaluation evidence', async () => {
    mocks.current = { ...candidate, state: 'EVALUATED', evaluation: { source: 'STATIC_VALIDATION', staticChecksPassed: true, passed: true } };
    await expect(applyLearningAction(actor, 'change', request('APPROVE'))).rejects.toThrow('held-out behavioral evaluation');
    const evaluation = evaluateLearningCandidateBehavior(candidate);
    mocks.current = { ...candidate, state: 'EVALUATED', candidateValue: 'concise', evaluation };
    await expect(applyLearningAction(actor, 'change', request('APPROVE'))).rejects.toThrow('held-out behavioral evaluation');
    expect(mocks.learningUpdateMany).not.toHaveBeenCalled();
  });

  it('keeps production promotion blocked after valid behavioral evaluation and approval', async () => {
    const evaluation = evaluateLearningCandidateBehavior(candidate);
    mocks.current = { ...candidate, state: 'APPROVED', evaluation, approvedById: 'user', approvedAt: new Date() };
    await expect(applyLearningAction(actor, 'change', request('PROMOTE'))).rejects.toThrow('remains gated');
    expect(mocks.activeUpdateMany).not.toHaveBeenCalled();
    expect(mocks.activeCreate).not.toHaveBeenCalled();
  });

  it('exercises authorized activation only through the test harness and records immutable lineage', async () => {
    setLearningPromotionTestGateForTests(true);
    const evaluation = evaluateLearningCandidateBehavior(candidate);
    mocks.current = { ...candidate, state: 'APPROVED', evaluation, approvedById: 'user', approvedAt: new Date() };

    const result = await applyLearningAction(actor, 'change', request('PROMOTE'));
    expect(result.state).toBe('PROMOTED');
    expect(mocks.activeCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      tenantId: 'workspace', targetKey: 'assistant.response_detail', activeVersion: '2', activeChangeId: 'change', updatedById: 'user',
      activeValue: expect.objectContaining({ __oakcloudLearningTarget: expect.objectContaining({ state: 'ACTIVE', changeId: 'change' }) }),
    }) }));
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      tenantId: 'workspace', userId: 'user', action: 'UPDATE', entityType: 'BUSINESS_ASSISTANT_LEARNING', entityId: 'change',
      metadata: expect.objectContaining({ lifecycleAction: 'PROMOTE', baselineTargetRevision: 0, activeRevision: 1, testOnlyActivation: true }),
    }) }));
  });

  it('rejects ABA stale promotion even when the version string returned to the original baseline', async () => {
    setLearningPromotionTestGateForTests(true);
    const evaluation = evaluateLearningCandidateBehavior(candidate);
    mocks.current = { ...candidate, state: 'APPROVED', evidence: governedEvidence(4), evaluation, approvedById: 'user', approvedAt: new Date() };
    mocks.activeFindUnique.mockResolvedValue({
      id: 'target', activeVersion: '1', activeValue: 'concise', activeChangeId: null,
      revision: 6, previousVersion: '3', previousValue: 'standard',
    });
    await expect(applyLearningAction(actor, 'change', request('PROMOTE'))).rejects.toThrow('changed since candidate creation');
    expect(mocks.activeUpdateMany).not.toHaveBeenCalled();
  });

  it('rejects a target revision race when compare-and-swap loses after the bound active read', async () => {
    setLearningPromotionTestGateForTests(true);
    const bound = { ...candidate, evidence: governedEvidence(4) };
    const evaluation = evaluateLearningCandidateBehavior(bound);
    mocks.current = { ...bound, state: 'APPROVED', evaluation, approvedById: 'user', approvedAt: new Date() };
    mocks.activeFindUnique.mockResolvedValue({
      id: 'target', activeVersion: '1', activeValue: 'concise', activeChangeId: null,
      revision: 4, previousVersion: null, previousValue: null,
    });
    mocks.activeUpdateMany.mockResolvedValue({ count: 0 });
    await expect(applyLearningAction(actor, 'change', request('PROMOTE'))).rejects.toThrow('changed during promotion');
    expect(mocks.learningUpdateMany).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it('rejects candidates created before target-revision lineage binding', async () => {
    setLearningPromotionTestGateForTests(true);
    const oldCandidate = { ...candidate, evidence: {} };
    const evaluation = evaluateLearningCandidateBehavior(oldCandidate);
    mocks.current = { ...oldCandidate, state: 'APPROVED', evaluation, approvedById: 'user', approvedAt: new Date() };
    await expect(applyLearningAction(actor, 'change', request('PROMOTE'))).rejects.toThrow('predates governed target-revision binding');
    expect(mocks.activeCreate).not.toHaveBeenCalled();
  });

  it('rejects an action-level expected-version race with an explicit candidate CAS', async () => {
    mocks.learningUpdateMany.mockResolvedValue({ count: 0 });
    await expect(applyLearningAction(actor, 'change', request('EVALUATE'))).rejects.toThrow('changed during this action');
    expect(mocks.auditCreate).not.toHaveBeenCalled();
    expect(mocks.actionCreate).not.toHaveBeenCalled();
  });

  it('rejects a stale expected version before attempting any action mutation', async () => {
    mocks.current = { ...candidate, expectedVersion: 2 };
    await expect(applyLearningAction(actor, 'change', request('EVALUATE', 1))).rejects.toThrow('refresh before applying');
    expect(mocks.learningUpdateMany).not.toHaveBeenCalled();
  });

  it('does not let rollback bypass deactivation, expiry, or deletion of the active pointer', async () => {
    const definition = learningTargetDefinition('assistant.response_detail')!;
    mocks.current = { ...candidate, state: 'PROMOTED', rollbackTarget: '1', expectedVersion: 2 };
    for (const lifecycleState of ['DEACTIVATED', 'EXPIRED', 'DELETED'] as const) {
      mocks.activeFindUnique.mockResolvedValue({
        id: 'target', activeVersion: '2', activeValue: createLearningLifecycleMarker(definition, lifecycleState),
        activeChangeId: null, revision: 3, previousVersion: '1', previousValue: 'concise',
      });
      await expect(applyLearningAction(actor, 'change', request('ROLLBACK', 2))).rejects.toThrow('rollback is stale');
    }
    expect(mocks.activeUpdateMany).not.toHaveBeenCalled();
  });

  it('wraps caller evidence with server-owned baseline revision and prevents governance-field injection', async () => {
    mocks.activeFindUnique.mockResolvedValue({ activeVersion: '1', activeValue: 'concise', revision: 9 });
    const result = await createLearningCandidate(actor, {
      targetKey: 'assistant.response_detail', targetKind: 'PREFERENCE', baselineVersion: '1', candidateVersion: '2',
      candidateValue: 'detailed', evidence: { governance: { baselineTargetRevision: 999, targetKey: 'database.url' }, note: 'source evidence' },
    });
    const data = mocks.learningCreate.mock.calls[0][0].data;
    expect(data.evidence).toMatchObject({
      source: 'DIRECT_REQUEST',
      sourceEvidence: { governance: { baselineTargetRevision: 999, targetKey: 'database.url' }, note: 'source evidence' },
      governance: { baselineTargetRevision: 9, targetKey: 'assistant.response_detail', capabilityId: 'assistant.answer', capabilityVersion: '1.0' },
    });
    expect(result.targetKey).toBe('assistant.response_detail');
  });

  it('rejects arbitrary runtime, code, and database learning targets', async () => {
    for (const targetKey of ['runtime.provider.model', 'database.url', 'code.worker.dispatch']) {
      await expect(createLearningCandidate(actor, {
        targetKey, targetKind: 'PREFERENCE', baselineVersion: '1', candidateVersion: '2', candidateValue: 'concise', evidence: {},
      })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    }
    expect(mocks.learningCreate).not.toHaveBeenCalled();
  });

  it.each([
    ['prompt_profile', 'assistant.prompt_profile', 'PROMPT_PROFILE', { tone: 'warm', maxSentences: 3, includeCitations: true }],
    ['assistant.prompt_profile', 'assistant.prompt_profile', 'PROMPT_PROFILE', { tone: 'direct', maxSentences: 5, includeCitations: false }],
    ['preference.prompt_profile', 'assistant.prompt_profile', 'PROMPT_PROFILE', { tone: 'warm', maxSentences: 2, includeCitations: false }],
    ['assistant.preference.prompt_profile', 'assistant.prompt_profile', 'PROMPT_PROFILE', { tone: 'direct', maxSentences: 6, includeCitations: true }],
    ['preference.response_detail', 'assistant.response_detail', 'PREFERENCE', 'detailed'],
    ['assistant.preference.response_detail', 'assistant.response_detail', 'PREFERENCE', 'standard'],
  ] as const)('resolves explicit legacy alias %s to %s', async (targetKey, canonicalTargetKey, targetKind, candidateValue) => {
    const resolved = resolveLearningTarget(targetKey);
    expect(resolved).toMatchObject({ canonicalKey: canonicalTargetKey, aliasUsed: targetKey !== canonicalTargetKey });
    const result = await createLearningCandidate(actor, { targetKey, targetKind, baselineVersion: '1', candidateVersion: '2', candidateValue, evidence: {} });
    expect(mocks.learningCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ targetKey: canonicalTargetKey, targetKind }) }));
    expect(result.targetKey).toBe(canonicalTargetKey);
  });

  it('does not normalize unlisted aliases by prefix stripping', () => {
    expect(resolveLearningTarget('assistant.preference.database.url')).toBeUndefined();
    expect(resolveLearningTarget('preference.runtime.provider')).toBeUndefined();
    expect(resolveLearningTarget('assistant.assistant.response_detail')).toBeUndefined();
  });

  it('prevents deleted target resurrection during candidate creation', async () => {
    const definition = learningTargetDefinition('assistant.response_detail')!;
    mocks.activeFindUnique.mockResolvedValue({ activeVersion: '2', revision: 5, activeValue: createLearningLifecycleMarker(definition, 'DELETED') });
    await expect(createLearningCandidate(actor, {
      targetKey: 'assistant.response_detail', targetKind: 'PREFERENCE', baselineVersion: '2', candidateVersion: '3', candidateValue: 'detailed', evidence: {},
    })).rejects.toThrow('cannot be recreated');
    expect(mocks.learningCreate).not.toHaveBeenCalled();
  });

  it('takes the business barrier before fresh authorization and candidate writes', async () => {
    mocks.operationBarrier.mockImplementation(async () => { mocks.events.push('business-barrier'); });
    mocks.resolveFreshActor.mockImplementation(async () => { mocks.events.push('fresh-authorization'); return { isWorkspaceAdmin: true, isSuperAdmin: false, internalRole: 'ADMIN' }; });
    mocks.activeFindUnique.mockImplementation(async () => { mocks.events.push('active-target-read'); return null; });
    mocks.learningCreate.mockImplementation(async ({ data }) => { mocks.events.push('candidate-write'); return { ...candidate, ...data }; });
    mocks.auditCreate.mockImplementation(async () => { mocks.events.push('audit-write'); return { id: 'audit-log' }; });
    await createLearningCandidate(actor, { targetKey: 'assistant.response_detail', targetKind: 'PREFERENCE', baselineVersion: '1', candidateVersion: '2', candidateValue: 'detailed', evidence: {} });
    expect(mocks.events).toEqual(['business-barrier', 'fresh-authorization', 'active-target-read', 'candidate-write', 'audit-write']);
  });

  it('requires real administrator access even for listing learning candidates', async () => {
    mocks.access.mockResolvedValue({ isAdmin: false });
    await expect(listLearningChanges(actor)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it('denies a candidate when authority is revoked after preflight', async () => {
    mocks.resolveFreshActor.mockResolvedValue({ isWorkspaceAdmin: false, isSuperAdmin: false, internalRole: 'STAFF' });
    await expect(createLearningCandidate(actor, { targetKey: 'assistant.response_detail', targetKind: 'PREFERENCE', baselineVersion: '1', candidateVersion: '2', candidateValue: 'detailed', evidence: {} }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mocks.learningCreate).not.toHaveBeenCalled();
  });

  it('rechecks the restore pause marker before tenant configuration writes', async () => {
    mocks.backupFindMany.mockResolvedValue([{ status: 'RESTORING', errorDetails: null }]);
    await expect(createLearningCandidate(actor, { targetKey: 'assistant.response_detail', targetKind: 'PREFERENCE', baselineVersion: '1', candidateVersion: '2', candidateValue: 'detailed', evidence: {} }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mocks.learningCreate).not.toHaveBeenCalled();
  });

  it('reads legacy direct active values and hides expired/deleted envelopes behind source-controlled defaults', async () => {
    mocks.activeFindUnique.mockResolvedValue({ activeVersion: '2', activeValue: 'detailed' });
    await expect(getActiveLearningConfiguration('workspace', 'assistant.preference.response_detail'))
      .resolves.toEqual({ version: '2', value: 'detailed' });
    const definition = learningTargetDefinition('assistant.response_detail')!;
    mocks.activeFindUnique.mockResolvedValue({ activeVersion: '2', activeValue: createLearningLifecycleMarker(definition, 'EXPIRED') });
    await expect(getActiveLearningConfiguration('workspace', 'assistant.response_detail')).resolves.toEqual({ version: '1', value: 'concise' });
    mocks.activeFindUnique.mockResolvedValue({ activeVersion: '2', activeValue: createLearningLifecycleMarker(definition, 'DELETED') });
    await expect(getActiveLearningConfiguration('workspace', 'assistant.response_detail')).resolves.toEqual({ version: '1', value: 'concise' });
  });
});
