import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCodes } from '@/lib/errors';
import type { DateOnly } from '@/services/service-schedule';
import {
  businessCalendarInputSchema,
  businessCalendarUpdateSchema,
} from '@/lib/validations/business-calendar';

const prismaMock = vi.hoisted(() => ({
  businessCalendar: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  businessHoliday: {
    findMany: vi.fn(),
    create: vi.fn(),
    createMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  serviceCycle: {
    findMany: vi.fn(),
  },
  deadlineOccurrence: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
  clientServiceDeadlineRule: {
    findMany: vi.fn(),
  },
  serviceScheduleReconciliationRequest: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
  $transaction: vi.fn(),
}));

const auditMock = vi.hoisted(() => ({
  createAuditLog: vi.fn(),
  computeChanges: vi.fn((existing: Record<string, unknown>, next: Record<string, unknown>, fields: string[]) => {
    const changes: Record<string, { old: unknown; new: unknown }> = {};
    for (const field of fields) {
      if (next[field] !== undefined && JSON.stringify(existing[field]) !== JSON.stringify(next[field])) {
        changes[field] = { old: existing[field], new: next[field] };
      }
    }
    return Object.keys(changes).length > 0 ? changes : null;
  }),
}));

const evaluatorMock = vi.hoisted(() => ({
  evaluateDeadlineRule: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/audit', () => auditMock);
vi.mock('@/services/service-schedule/evaluator', () => evaluatorMock);

import {
  createBusinessCalendar,
  getBusinessCalendar,
  getBusinessCalendarSnapshot,
  listBusinessCalendars,
  previewBusinessCalendarImpact,
  updateBusinessCalendar,
  listWorkspaceHolidays,
} from '@/services/business-calendar';

const actor = { tenantId: 'tenant-1', userId: 'user-1' };

const input = {
  name: 'Singapore Business Calendar',
  jurisdictionCode: 'SG',
  timeZone: 'Asia/Singapore',
  weekendDays: [6, 0],
  holidays: [
    { date: '2026-08-09', name: 'National Day', description: null },
  ],
  isActive: true,
};

const calendarRecord = {
  id: 'calendar-1',
  tenantId: actor.tenantId,
  name: input.name,
  jurisdictionCode: input.jurisdictionCode,
  timeZone: input.timeZone,
  weekendDays: [0, 6],
  revision: 3,
  isActive: true,
  archivedAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  holidays: [
    {
      id: 'holiday-1',
      tenantId: actor.tenantId,
      calendarId: 'calendar-1',
      date: new Date('2026-08-09T00:00:00.000Z'),
      name: 'National Day',
      description: null,
      isActive: true,
    },
  ],
};

describe('business calendar service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    evaluatorMock.evaluateDeadlineRule.mockReset();
    prismaMock.$transaction.mockImplementation(async (callback) => callback(prismaMock));
    prismaMock.serviceCycle.findMany.mockResolvedValue([]);
    prismaMock.deadlineOccurrence.findMany.mockResolvedValue([]);
    prismaMock.clientServiceDeadlineRule.findMany.mockResolvedValue([]);
    prismaMock.serviceScheduleReconciliationRequest.findUnique.mockResolvedValue(null);
    prismaMock.serviceScheduleReconciliationRequest.upsert.mockResolvedValue({ id: 'reconciliation-1', dedupeKey: 'dedupe-1' });
  });

  it('counts failed cycles once and preserves immutable rows before warning classification', async () => {
    const cycle = {
      id: 'cycle-1',
      tenantId: actor.tenantId,
      clientServiceId: 'service-1',
      ruleId: 'rule-1',
      ruleVersionId: 'version-1',
      companyId: 'company-1',
      periodKey: '2026',
      periodStart: new Date('2026-01-01T00:00:00.000Z'),
      periodEnd: new Date('2026-12-31T00:00:00.000Z'),
      origin: 'RULE',
    };
    const context = {
      tenantId: actor.tenantId,
      clientServiceId: 'service-1',
      ruleId: 'rule-1',
      parameterValues: {},
      scheduleEntries: [],
      clientService: { tenantId: actor.tenantId, companyId: 'company-1', company: {} },
      rule: {
        tenantId: actor.tenantId,
        currentVersion: {
          id: 'version-1',
          recurrence: {},
          applicability: {},
          milestoneTemplates: [],
        },
      },
    };
    prismaMock.businessCalendar.findFirst.mockResolvedValue(calendarRecord);
    prismaMock.serviceCycle.findMany.mockResolvedValue([cycle]);
    prismaMock.clientServiceDeadlineRule.findMany.mockResolvedValue([context]);
    evaluatorMock.evaluateDeadlineRule.mockImplementation(() => {
      throw new Error('missing evaluator input');
    });

    const emptyCycleImpact = await previewBusinessCalendarImpact('calendar-1', input, actor);
    expect(emptyCycleImpact.counts).toEqual({ recalculated: 0, preserved: 0, warnings: 1 });

    prismaMock.deadlineOccurrence.findMany.mockResolvedValue([{
      id: 'deadline-completed',
      tenantId: actor.tenantId,
      calculatedDueDate: new Date('2026-08-15T00:00:00.000Z'),
      operativeDueDate: new Date('2026-08-15T00:00:00.000Z'),
      dateOverridden: false,
      status: 'COMPLETED',
      origin: 'RULE',
      cycleId: cycle.id,
      milestoneKey: 'milestone-1',
      scheduleEntryKey: '',
      cycle,
    }]);

    const immutableImpact = await previewBusinessCalendarImpact('calendar-1', input, actor);
    expect(immutableImpact.counts).toEqual({ recalculated: 0, preserved: 1, warnings: 1 });
  });

  it('uses one injected Singapore date for every impact decision', async () => {
    const cycle = {
      id: 'cycle-clock',
      tenantId: actor.tenantId,
      clientServiceId: 'service-clock',
      ruleId: 'rule-clock',
      ruleVersionId: 'version-clock',
      companyId: 'company-clock',
      periodKey: '2026',
      periodStart: new Date('2026-01-01T00:00:00.000Z'),
      periodEnd: new Date('2026-12-31T00:00:00.000Z'),
    };
    const context = {
      tenantId: actor.tenantId,
      clientServiceId: cycle.clientServiceId,
      ruleId: cycle.ruleId,
      parameterValues: {},
      scheduleEntries: [],
      clientService: { tenantId: actor.tenantId, companyId: cycle.companyId, company: {} },
      rule: {
        tenantId: actor.tenantId,
        currentVersion: {
          id: cycle.ruleVersionId,
          recurrence: {},
          applicability: {},
          milestoneTemplates: [{
            milestoneKey: 'milestone-1',
            name: 'Milestone',
            description: null,
            type: 'STATUTORY' as const,
            generationMode: 'ONCE_PER_CYCLE' as const,
            dateExpression: {},
            businessDayAdjustment: 'NONE' as const,
            displayOrder: 1,
            isActive: true,
          }],
        },
      },
    };
    prismaMock.businessCalendar.findFirst.mockResolvedValue(calendarRecord);
    prismaMock.serviceCycle.findMany.mockResolvedValue([cycle]);
    prismaMock.clientServiceDeadlineRule.findMany.mockResolvedValue([context]);
    prismaMock.deadlineOccurrence.findMany.mockResolvedValue([{
      id: 'deadline-clock',
      tenantId: actor.tenantId,
      calculatedDueDate: new Date('2026-08-20T00:00:00.000Z'),
      operativeDueDate: new Date('2026-08-19T00:00:00.000Z'),
      dateOverridden: false,
      status: 'OPEN',
      origin: 'RULE',
      cycleId: cycle.id,
      milestoneKey: 'milestone-1',
      scheduleEntryKey: '',
      cycle,
    }]);
    evaluatorMock.evaluateDeadlineRule.mockReturnValue({
      byKey: {
        'milestone-1:': { calculatedDueDate: '2026-08-20' },
      },
      evaluationHash: 'a'.repeat(64),
      sourceSnapshot: {},
      applicability: { state: 'APPLICABLE' },
    });
    const boundaryDates = ['2026-08-20', '2026-08-18'];
    let clockCalls = 0;

    const impact = await previewBusinessCalendarImpact('calendar-1', input, actor, {
      now: () => (boundaryDates[clockCalls++] ?? '2026-08-18') as DateOnly,
    });

    expect(clockCalls).toBe(1);
    expect(impact.counts).toEqual({ recalculated: 0, preserved: 1, warnings: 0 });
  });

  it('preserves manual cycles without evaluating or fingerprinting their evaluator state', async () => {
    const manualCycle = {
      id: 'cycle-manual',
      tenantId: actor.tenantId,
      clientServiceId: 'service-manual',
      ruleId: 'rule-manual',
      ruleVersionId: 'version-manual',
      companyId: 'company-manual',
      periodKey: '2026',
      periodStart: new Date('2026-01-01T00:00:00.000Z'),
      periodEnd: new Date('2026-12-31T00:00:00.000Z'),
      origin: 'MANUAL_TRIGGER',
    };
    const manualContext = {
      tenantId: actor.tenantId,
      clientServiceId: manualCycle.clientServiceId,
      ruleId: manualCycle.ruleId,
      parameterValues: {},
      scheduleEntries: [],
      clientService: { tenantId: actor.tenantId, companyId: manualCycle.companyId, company: {} },
      rule: {
        tenantId: actor.tenantId,
        currentVersion: {
          id: manualCycle.ruleVersionId,
          recurrence: {},
          applicability: {},
          milestoneTemplates: [],
        },
      },
    };
    prismaMock.businessCalendar.findFirst.mockResolvedValue(calendarRecord);
    prismaMock.serviceCycle.findMany.mockResolvedValue([manualCycle]);
    prismaMock.clientServiceDeadlineRule.findMany.mockResolvedValue([manualContext]);
    prismaMock.deadlineOccurrence.findMany.mockResolvedValue([{
      id: 'deadline-manual',
      tenantId: actor.tenantId,
      calculatedDueDate: new Date('2026-08-20T00:00:00.000Z'),
      operativeDueDate: new Date('2026-08-20T00:00:00.000Z'),
      dateOverridden: false,
      status: 'OPEN',
      origin: 'MANUAL_TRIGGER',
      cycleId: manualCycle.id,
      milestoneKey: 'milestone-manual',
      scheduleEntryKey: '',
      cycle: manualCycle,
    }]);
    evaluatorMock.evaluateDeadlineRule.mockImplementation(() => {
      throw new Error('manual cycles must never be evaluated');
    });

    const impact = await previewBusinessCalendarImpact('calendar-1', input, actor);

    expect(evaluatorMock.evaluateDeadlineRule).not.toHaveBeenCalled();
    expect(impact.counts).toEqual({ recalculated: 0, preserved: 1, warnings: 0 });
  });

  it('warns once for each zero-occurrence rule cycle missing evaluator context or input', async () => {
    const missingContextCycle = {
      id: 'cycle-missing-context',
      tenantId: actor.tenantId,
      clientServiceId: 'service-missing-context',
      ruleId: 'rule-missing-context',
      ruleVersionId: 'version-missing-context',
      companyId: 'company-missing-context',
      periodKey: '2026',
      periodStart: new Date('2026-01-01T00:00:00.000Z'),
      periodEnd: new Date('2026-12-31T00:00:00.000Z'),
      origin: 'RULE',
    };
    const missingInputCycle = {
      id: 'cycle-missing-input',
      tenantId: actor.tenantId,
      clientServiceId: 'service-missing-input',
      ruleId: 'rule-missing-input',
      ruleVersionId: 'version-missing-input',
      companyId: 'company-missing-input',
      periodKey: '2026',
      periodStart: new Date('2026-01-01T00:00:00.000Z'),
      periodEnd: new Date('2026-12-31T00:00:00.000Z'),
      origin: 'RULE',
    };
    const missingInputContext = {
      tenantId: actor.tenantId,
      clientServiceId: missingInputCycle.clientServiceId,
      ruleId: missingInputCycle.ruleId,
      parameterValues: {},
      scheduleEntries: [],
      clientService: { tenantId: actor.tenantId, companyId: missingInputCycle.companyId, company: {} },
      rule: { tenantId: actor.tenantId, currentVersion: null },
    };
    prismaMock.businessCalendar.findFirst.mockResolvedValue(calendarRecord);
    prismaMock.serviceCycle.findMany.mockResolvedValue([missingContextCycle, missingInputCycle]);
    prismaMock.clientServiceDeadlineRule.findMany.mockResolvedValue([missingInputContext]);
    prismaMock.deadlineOccurrence.findMany.mockResolvedValue([]);

    const first = await previewBusinessCalendarImpact('calendar-1', input, actor);
    const second = await previewBusinessCalendarImpact('calendar-1', input, actor);

    expect(first.counts).toEqual({ recalculated: 0, preserved: 0, warnings: 2 });
    expect(second.counts).toEqual(first.counts);
    expect(second.previewFingerprint).toBe(first.previewFingerprint);
    expect(evaluatorMock.evaluateDeadlineRule).not.toHaveBeenCalled();
  });

  it('returns an immutable Asia/Singapore calendar snapshot with tenant-scoped holidays', async () => {
    prismaMock.businessCalendar.findFirst.mockResolvedValue(calendarRecord);

    const snapshot = await getBusinessCalendarSnapshot('calendar-1', actor);

    expect(snapshot).toEqual({
      id: 'calendar-1',
      timeZone: 'Asia/Singapore',
      revision: 3,
      weekendDays: new Set([0, 6]),
      holidays: new Set(['2026-08-09']),
    });
    expect(prismaMock.businessCalendar.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'calendar-1', tenantId: actor.tenantId, isActive: true }),
      include: expect.objectContaining({
        holidays: expect.objectContaining({
          where: expect.objectContaining({ tenantId: actor.tenantId, calendarId: 'calendar-1', isActive: true }),
        }),
      }),
    }));

    expect(() => (snapshot.weekendDays as Set<number>).add(1)).toThrow();
    expect(snapshot.weekendDays).toEqual(new Set([0, 6]));
  });

  it('keeps calendar list and detail DTOs tenant-scoped and date-safe', async () => {
    prismaMock.businessCalendar.findMany.mockResolvedValue([calendarRecord]);
    prismaMock.businessCalendar.findFirst.mockResolvedValue(calendarRecord);

    const list = await listBusinessCalendars(actor);
    const detail = await getBusinessCalendar('calendar-1', actor);

    expect(list.calendars).toHaveLength(1);
    expect(list.calendars[0]).toMatchObject({ id: 'calendar-1', revision: 3 });
    expect(list.calendars[0].holidays[0].date).toBe('2026-08-09');
    expect(detail.holidays[0].date).toBe('2026-08-09');
    expect(prismaMock.businessCalendar.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: actor.tenantId },
      include: expect.objectContaining({
        holidays: expect.objectContaining({ where: expect.objectContaining({ tenantId: actor.tenantId }) }),
      }),
    }));
  });

  it('creates revision 1 with holidays and audit in one transaction', async () => {
    prismaMock.businessCalendar.create.mockResolvedValue({
      ...calendarRecord,
      id: 'calendar-2',
      revision: 1,
      holidays: [],
    });
    prismaMock.businessHoliday.createMany.mockResolvedValue({ count: 1 });

    const result = await createBusinessCalendar(input, actor);

    expect(result).toMatchObject({ id: 'calendar-2', revision: 1, timeZone: 'Asia/Singapore' });
    expect(prismaMock.$transaction).toHaveBeenCalledOnce();
    expect(prismaMock.businessCalendar.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ tenantId: actor.tenantId, revision: 1, timeZone: 'Asia/Singapore' }),
    }));
    expect(prismaMock.businessHoliday.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ tenantId: actor.tenantId, calendarId: 'calendar-2', date: new Date('2026-08-09T00:00:00.000Z') })],
    }));
    expect(auditMock.createAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: actor.tenantId,
      userId: actor.userId,
      action: 'CREATE',
      entityType: 'BusinessCalendar',
      entityId: 'calendar-2',
    }), prismaMock);
  });

  it('increments revision once, replaces holidays atomically, and audits the change', async () => {
    prismaMock.businessCalendar.findFirst.mockResolvedValue(calendarRecord);
    prismaMock.businessHoliday.findMany.mockResolvedValue(calendarRecord.holidays);
    prismaMock.businessCalendar.update.mockResolvedValue({
      ...calendarRecord,
      revision: 4,
      holidays: [],
    });
    prismaMock.businessHoliday.update.mockResolvedValue({});
    prismaMock.businessHoliday.create.mockResolvedValue({});
    prismaMock.businessHoliday.updateMany.mockResolvedValue({ count: 0 });

    const preview = await previewBusinessCalendarImpact('calendar-1', input, actor);

    const result = await updateBusinessCalendar('calendar-1', {
      ...input,
      expectedRevision: 3,
      proposedHash: preview.proposedHash,
      previewFingerprint: preview.previewFingerprint,
    }, actor);

    expect(result).toMatchObject({ revision: 4 });
    expect(prismaMock.businessCalendar.update).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'calendar-1', tenantId: actor.tenantId, revision: 3 }),
      data: expect.objectContaining({ revision: { increment: 1 }, weekendDays: [0, 6] }),
    }));
    expect(auditMock.createAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'UPDATE',
      entityType: 'BusinessCalendar',
      entityId: 'calendar-1',
    }), prismaMock);
    expect(prismaMock.serviceScheduleReconciliationRequest.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        tenantId: actor.tenantId,
        scopeType: 'BUSINESS_CALENDAR',
        scopeId: 'calendar-1',
        triggerType: 'BUSINESS_CALENDAR_CHANGED',
      }),
    }));
  });

  it('rejects an update when its impact preview is stale', async () => {
    prismaMock.businessCalendar.findFirst.mockResolvedValue(calendarRecord);

    await expect(updateBusinessCalendar('calendar-1', {
      ...input,
      expectedRevision: 3,
      proposedHash: 'a'.repeat(64),
      previewFingerprint: 'stale',
    }, actor)).rejects.toMatchObject({
      code: ErrorCodes.IMPACT_CHANGED,
      statusCode: 409,
    });

    expect(prismaMock.businessCalendar.update).not.toHaveBeenCalled();
    expect(auditMock.createAuditLog).not.toHaveBeenCalled();
  });

  it('builds complete-scope impact counts while limiting deterministic samples to 100', async () => {
    const occurrences = Array.from({ length: 105 }, (_, index) => ({
      id: `deadline-${String(index + 1).padStart(3, '0')}`,
      tenantId: actor.tenantId,
      calculatedDueDate: new Date('2026-08-15T00:00:00.000Z'),
      operativeDueDate: new Date('2026-08-15T00:00:00.000Z'),
      dateOverridden: false,
      status: 'OPEN',
      origin: 'RULE',
      cycleId: `cycle-${index + 1}`,
      cycle: { tenantId: actor.tenantId, businessCalendarId: 'calendar-1', periodKey: `2026-${index + 1}` },
    }));
    prismaMock.businessCalendar.findFirst.mockResolvedValue(calendarRecord);
    prismaMock.deadlineOccurrence.findMany.mockResolvedValue(occurrences);

    const impact = await previewBusinessCalendarImpact('calendar-1', input, actor);

    expect(impact.samples).toHaveLength(100);
    expect(impact.samples[0]).toEqual(expect.objectContaining({ deadlineId: 'deadline-001' }));
    expect(impact.samples[0]).not.toHaveProperty('explanation');
    expect(impact.counts.preserved).toBe(105);
    expect(prismaMock.deadlineOccurrence.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        tenantId: actor.tenantId,
        cycle: expect.objectContaining({ tenantId: actor.tenantId, businessCalendarId: 'calendar-1' }),
      }),
      orderBy: [{ id: 'asc' }],
    }));
  });
});

describe('business calendar validation', () => {
  it('normalizes sorted unique weekend and holiday values while rejecting invalid dates', () => {
    const parsed = businessCalendarInputSchema.parse(input);
    expect(parsed.weekendDays).toEqual([0, 6]);
    expect(parsed.holidays.map((holiday) => holiday.date)).toEqual(['2026-08-09']);

    expect(() => businessCalendarInputSchema.parse({ ...input, holidays: [{ ...input.holidays[0], date: '2026-02-29' }] })).toThrow();
    expect(() => businessCalendarInputSchema.parse({ ...input, weekendDays: [0, 0] })).toThrow();
    expect(() => businessCalendarInputSchema.parse({ ...input, timeZone: 'UTC' })).toThrow();
    expect(() => businessCalendarInputSchema.parse({ ...input, unexpected: true })).toThrow();
  });

  it('requires a current revision and both lowercase SHA-256 preview hashes', () => {
    expect(() => businessCalendarUpdateSchema.parse({ ...input, expectedRevision: 0, proposedHash: 'a'.repeat(64), previewFingerprint: 'b'.repeat(64) })).toThrow();
    expect(() => businessCalendarUpdateSchema.parse({ ...input, expectedRevision: 1, proposedHash: 'A'.repeat(64), previewFingerprint: 'b'.repeat(64) })).toThrow();
  });
});

describe('workspace holidays', () => {
  beforeEach(() => vi.clearAllMocks());

  it('merges active calendars by date and keeps the first calendar weekend', async () => {
    prismaMock.businessCalendar.findMany.mockResolvedValueOnce([
      { weekendDays: [6, 0], holidays: [{ date: new Date('2026-08-10T00:00:00.000Z'), name: 'National Day' }] },
      { weekendDays: [5], holidays: [
        { date: new Date('2026-08-10T00:00:00.000Z'), name: 'National Day' },
        { date: new Date('2026-08-03T00:00:00.000Z'), name: 'Office closure' },
      ] },
    ]);

    await expect(listWorkspaceHolidays({ tenantId: 'tenant-1', from: '2026-08-01' as DateOnly, to: '2026-08-31' as DateOnly })).resolves.toEqual({
      weekendDays: [0, 6],
      holidays: [{ date: '2026-08-03', name: 'Office closure' }, { date: '2026-08-10', name: 'National Day' }],
    });
    expect(prismaMock.businessCalendar.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 'tenant-1', isActive: true, archivedAt: null },
    }));
  });

  it('falls back to Saturday and Sunday without an active calendar', async () => {
    prismaMock.businessCalendar.findMany.mockResolvedValueOnce([]);
    await expect(listWorkspaceHolidays({ tenantId: 'tenant-1', from: '2026-08-01' as DateOnly, to: '2026-08-31' as DateOnly })).resolves.toEqual({ weekendDays: [0, 6], holidays: [] });
  });
});
