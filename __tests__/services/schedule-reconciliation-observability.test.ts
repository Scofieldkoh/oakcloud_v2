import { describe, expect, it } from 'vitest';
import { buildReconciliationLogEvent } from '@/services/schedule-reconciliation/worker';

describe('schedule reconciliation observability contract', () => {
  it('emits one safe structured event shape without document or note content', () => {
    const event = buildReconciliationLogEvent({
      tenantId: 'tenant-1',
      requestId: 'request-1',
      correlationId: 'correlation-1',
      durationMs: 12.345,
      attempt: 2,
      writeMode: 'APPLY',
      counts: {
        created: 1,
        recalculated: 2,
        cancelled: 3,
        preserved: 4,
        noChange: 5,
      },
      preservedByReason: {
        MANUAL_TRIGGER: 1,
        HISTORICAL: 1,
        COMPLETED: 1,
        WAIVED: 1,
        CANCELLED: 0,
        OVERRIDDEN: 0,
      },
      warnings: [
        {
          code: 'MISSING_INPUT',
          message: 'private free-text note and uploaded company document',
          ruleId: 'rule-1',
          missingFields: ['entityType'],
        },
      ],
    });

    expect(event).toMatchObject({
      event: 'reconciliation_request',
      tenantId: 'tenant-1',
      requestId: 'request-1',
      correlationId: 'correlation-1',
      durationMs: 12.3,
      attempt: 2,
      writeMode: 'APPLY',
      counts: {
        created: 1,
        recalculated: 2,
        cancelled: 3,
        preserved: 4,
        noChange: 5,
      },
      warnings: [{ code: 'MISSING_INPUT', ruleId: 'rule-1', missingFields: ['entityType'] }],
    });
    expect(event).not.toHaveProperty('notes');
    expect(event).not.toHaveProperty('documents');
    expect(JSON.stringify(event)).not.toContain('private free-text note');
    expect(JSON.stringify(event)).not.toContain('uploaded company document');
  });
});
