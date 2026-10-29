import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@/generated/prisma';
import { invalidateRestoredAssistantDispatch } from '@/services/business-assistant-backup.service';

describe('Business Assistant backup lifecycle', () => {
  it('invalidates old claims and approvals while keeping uncertain writes on reconciliation', async () => {
    const calls: Array<{ delegate: string; where: unknown; data: unknown }> = [];
    const tx = new Proxy({}, { get: (_target, delegate) => ({ updateMany: vi.fn(async (input) => { calls.push({ delegate: String(delegate), ...input }); return { count: 1 }; }) }) });
    await invalidateRestoredAssistantDispatch(tx as Prisma.TransactionClient, 'workspace-1');
    const itemCalls = calls.filter((call) => call.delegate === 'businessAssistantRunItem');
    expect(itemCalls).toHaveLength(3);
    expect(itemCalls[1]).toMatchObject({ where: { tenantId: 'workspace-1' }, data: { executionOutcome: 'OUTCOME_UNKNOWN', lifecycleState: 'RECOVERING', activeStage: 'EXECUTION', claimToken: null } });
    expect(itemCalls[2]).toMatchObject({ where: { executionOutcome: 'COMMITTED' }, data: { claimToken: null } });
    expect(itemCalls[2].data).not.toHaveProperty('executionOutcome');
    expect(calls.find((call) => call.delegate === 'businessAssistantProposal')).toMatchObject({ data: { status: 'EXPIRED' } });
    expect(calls.some((call) => call.delegate === 'businessAssistantApproval')).toBe(false);
  });
});
