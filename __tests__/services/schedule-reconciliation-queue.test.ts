import { describe, expect, it, vi } from 'vitest';
import { enqueueScheduleReconciliation, scheduleReconciliationDedupeKey } from '@/services/schedule-reconciliation/queue';

const input = {
  tenantId: 'tenant-1',
  scopeType: 'RULE' as const,
  scopeId: 'rule-1',
  triggerType: 'RULE_PUBLISHED',
  correlationId: 'request-1',
  requestedById: 'user-1',
  notBefore: new Date('2026-08-18T01:02:03.000Z'),
};

type SqlShape = {
  strings?: readonly string[];
  sql?: string;
  values?: readonly unknown[];
};

function queryText(query: unknown): string {
  const shape = query as SqlShape;
  return [shape.sql, ...(shape.strings ?? [])].filter(Boolean).join(' ');
}

describe('schedule reconciliation raw queue contract', () => {
  it('uses an atomic LEAST update restricted to pending requests', async () => {
    const queryRaw = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: 'request-1',
        dedupeKey: 'canonical',
        status: 'PENDING',
        nextAttemptAt: input.notBefore,
      }]);

    const result = await enqueueScheduleReconciliation({ $queryRaw: queryRaw } as never, input);

    expect(result.dedupeKey).toBeTruthy();
    expect(queryRaw).toHaveBeenCalledTimes(2);
    const pendingUpdate = queryText(queryRaw.mock.calls[1]?.[0]);
    expect(pendingUpdate).toContain('LEAST');
    expect(pendingUpdate).toContain('"status" =');
    expect(pendingUpdate).toContain('ScheduleReconciliationStatus');
    expect(pendingUpdate).toContain('"next_attempt_at"');
    expect((queryRaw.mock.calls[1]?.[0] as SqlShape).values).toContain('PENDING');
  });

  it('creates a distinct follow-up after a locked processing request without resetting its lease', async () => {
    const queryRaw = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: 'request-1',
        dedupeKey: 'canonical',
        status: 'PROCESSING',
        nextAttemptAt: input.notBefore,
      }])
      .mockResolvedValueOnce([{
        id: 'follow-up-1',
        dedupeKey: 'follow-up',
        status: 'PENDING',
        nextAttemptAt: input.notBefore,
      }]);

    const result = await enqueueScheduleReconciliation({ $queryRaw: queryRaw } as never, input);

    expect(result.dedupeKey).not.toBe('canonical');
    expect(queryRaw).toHaveBeenCalledTimes(4);
    expect(queryText(queryRaw.mock.calls[2]?.[0])).toContain('FOR UPDATE');
    expect(queryText(queryRaw.mock.calls[3]?.[0])).toContain('ON CONFLICT');
    expect(queryText(queryRaw.mock.calls[3]?.[0])).not.toContain('lease_expires_at');
  });

  it('coalesces processing follow-ups requested within the same UTC minute', async () => {
    const rows = new Map<string, { id: string; dedupeKey: string; status: string; nextAttemptAt: Date }>();
    const canonical = scheduleReconciliationDedupeKey(input, input.notBefore);
    const processing = { id: 'request-1', dedupeKey: canonical, status: 'PROCESSING', nextAttemptAt: input.notBefore };
    const delegate = {
      findUnique: vi.fn(async ({ where }: { where: { dedupeKey: string } }) => {
        if (where.dedupeKey === canonical) return processing;
        return rows.get(where.dedupeKey) ?? null;
      }),
      upsert: vi.fn(async ({ where, create }: { where: { dedupeKey: string }; create: { dedupeKey: string; nextAttemptAt: Date } }) => {
        const existing = rows.get(where.dedupeKey);
        if (existing) return existing;
        const created = { id: `follow-${rows.size + 1}`, dedupeKey: create.dedupeKey, status: 'PENDING', nextAttemptAt: create.nextAttemptAt };
        rows.set(where.dedupeKey, created);
        return created;
      }),
    };

    const first = await enqueueScheduleReconciliation({ serviceScheduleReconciliationRequest: delegate } as never, input);
    const second = await enqueueScheduleReconciliation({ serviceScheduleReconciliationRequest: delegate } as never, {
      ...input,
      notBefore: new Date('2026-08-18T01:02:59.000Z'),
    });

    expect(first.dedupeKey).toBe(second.dedupeKey);
    expect(rows.size).toBe(1);
    expect(delegate.upsert).toHaveBeenCalledTimes(2);
  });
});
