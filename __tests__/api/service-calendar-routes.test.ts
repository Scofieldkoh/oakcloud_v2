import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictError, ForbiddenError, NotFoundError } from '@/lib/errors';

const session = {
  id: '11111111-1111-4111-8111-111111111111',
  tenantId: '22222222-2222-4222-8222-222222222222',
  isSuperAdmin: false,
  isWorkspaceAdmin: true,
};

const CALENDAR_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_TENANT_ID = '44444444-4444-4444-8444-444444444444';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requireServiceAdministrator: vi.fn(),
  resolveWorkspaceId: vi.fn(),
  listBusinessCalendars: vi.fn(),
  getBusinessCalendar: vi.fn(),
  createBusinessCalendar: vi.fn(),
  updateBusinessCalendar: vi.fn(),
  previewBusinessCalendarImpact: vi.fn(),
  syncPublicHolidaysIfUpdated: vi.fn(),
  getPublicHolidaySourceStatus: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: mocks.requireAuth }));
vi.mock('@/lib/service-administration-auth', () => ({ requireServiceAdministrator: mocks.requireServiceAdministrator }));
vi.mock('@/lib/api-helpers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-helpers')>()),
  resolveWorkspaceId: mocks.resolveWorkspaceId,
}));
vi.mock('@/services/business-calendar', () => ({
  listBusinessCalendars: mocks.listBusinessCalendars,
  getBusinessCalendar: mocks.getBusinessCalendar,
  createBusinessCalendar: mocks.createBusinessCalendar,
  updateBusinessCalendar: mocks.updateBusinessCalendar,
  previewBusinessCalendarImpact: mocks.previewBusinessCalendarImpact,
}));

vi.mock('@/services/public-holiday-sync.service', () => ({
  syncPublicHolidaysIfUpdated: mocks.syncPublicHolidaysIfUpdated,
  getPublicHolidaySourceStatus: mocks.getPublicHolidaySourceStatus,
}));

import { GET as listCalendars, POST as createCalendar } from '@/app/api/service-calendars/route';
import {
  GET as getPublicHolidaySource,
  POST as checkPublicHolidays,
} from '@/app/api/service-calendars/public-holidays/route';
import {
  GET as getCalendar,
  PATCH as updateCalendar,
} from '@/app/api/service-calendars/[id]/route';
import { POST as previewCalendar } from '@/app/api/service-calendars/[id]/impact/route';

const validInput = {
  name: 'Singapore Business Calendar',
  jurisdictionCode: 'SG',
  timeZone: 'Asia/Singapore',
  weekendDays: [0, 6],
  holidays: [{ date: '2026-08-09', name: 'National Day', description: null }],
  isActive: true,
};

describe('service calendar routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue(session);
    mocks.resolveWorkspaceId.mockReturnValue(session.tenantId);
    mocks.listBusinessCalendars.mockResolvedValue({ calendars: [] });
    mocks.getBusinessCalendar.mockResolvedValue({
      id: CALENDAR_ID,
      name: 'Singapore Business Calendar',
      jurisdictionCode: 'SG',
      timeZone: 'Asia/Singapore',
      weekendDays: [0, 6],
      revision: 1,
      isActive: false,
      archivedAt: '2026-08-10T00:00:00.000Z',
      holidays: [{ id: '55555555-5555-4555-8555-555555555555', date: '2026-08-09', name: 'National Day', description: null, isActive: false }],
    });
    mocks.createBusinessCalendar.mockResolvedValue({ id: CALENDAR_ID, ...validInput, revision: 1 });
    mocks.updateBusinessCalendar.mockResolvedValue({ id: CALENDAR_ID, ...validInput, revision: 2 });
    mocks.previewBusinessCalendarImpact.mockResolvedValue({
      calendarId: 'calendar-1',
      expectedRevision: 1,
      proposedHash: 'a'.repeat(64),
      previewFingerprint: 'b'.repeat(64),
      counts: { recalculated: 0, preserved: 0, warnings: 0 },
      samples: [],
    });
  });

  it('requires auth/admin and resolves the workspace for list reads', async () => {
    const response = await listCalendars(new NextRequest(`http://localhost/api/service-calendars?tenantId=${OTHER_TENANT_ID}`));

    expect(mocks.requireAuth).toHaveBeenCalledOnce();
    expect(mocks.requireServiceAdministrator).toHaveBeenCalledWith(session);
    expect(mocks.resolveWorkspaceId).toHaveBeenCalledWith(session, OTHER_TENANT_ID);
    expect(mocks.listBusinessCalendars).toHaveBeenCalledWith({ tenantId: session.tenantId, userId: session.id });
    expect(response.status).toBe(200);
  });

  it('creates a validated calendar and strips caller tenant ids from the service input', async () => {
    const response = await createCalendar(new NextRequest('http://localhost/api/service-calendars', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...validInput, tenantId: OTHER_TENANT_ID }),
    }));

    expect(mocks.requireServiceAdministrator).toHaveBeenCalledWith(session);
    expect(mocks.resolveWorkspaceId).toHaveBeenCalledWith(session, OTHER_TENANT_ID);
    expect(mocks.createBusinessCalendar).toHaveBeenCalledWith(validInput, { tenantId: session.tenantId, userId: session.id });
    expect(response.status).toBe(201);
  });

  it('returns 400 and never calls the service for strict invalid payloads', async () => {
    const response = await createCalendar(new NextRequest('http://localhost/api/service-calendars', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...validInput, timeZone: 'UTC', extra: true }),
    }));

    expect(mocks.createBusinessCalendar).not.toHaveBeenCalled();
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ success: false, error: { code: 'VALIDATION_ERROR' } });
  });

  it('reads and updates a calendar using tenant-scoped service calls', async () => {
    const getResponse = await getCalendar(
      new NextRequest(`http://localhost/api/service-calendars/${CALENDAR_ID}?tenantId=${OTHER_TENANT_ID}`),
      { params: Promise.resolve({ id: CALENDAR_ID }) },
    );
    const patchResponse = await updateCalendar(
      new NextRequest(`http://localhost/api/service-calendars/${CALENDAR_ID}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...validInput,
          expectedRevision: 1,
          proposedHash: 'a'.repeat(64),
          previewFingerprint: 'b'.repeat(64),
          tenantId: OTHER_TENANT_ID,
        }),
      }),
      { params: Promise.resolve({ id: CALENDAR_ID }) },
    );

    expect(mocks.getBusinessCalendar).toHaveBeenCalledWith(CALENDAR_ID, { tenantId: session.tenantId, userId: session.id });
    await expect(getResponse.json()).resolves.toMatchObject({
      id: CALENDAR_ID,
      name: 'Singapore Business Calendar',
      jurisdictionCode: 'SG',
      timeZone: 'Asia/Singapore',
      weekendDays: [0, 6],
      revision: 1,
      isActive: false,
      holidays: [{ name: 'National Day', date: '2026-08-09', isActive: false }],
    });
    expect(mocks.updateBusinessCalendar).toHaveBeenCalledWith(
      CALENDAR_ID,
      expect.objectContaining({ expectedRevision: 1, proposedHash: 'a'.repeat(64) }),
      { tenantId: session.tenantId, userId: session.id },
    );
    expect(getResponse.status).toBe(200);
    expect(patchResponse.status).toBe(200);
  });

  it('returns impact previews with stable samples and typed conflicts', async () => {
    const response = await previewCalendar(
      new NextRequest(`http://localhost/api/service-calendars/${CALENDAR_ID}/impact?tenantId=${OTHER_TENANT_ID}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...validInput, tenantId: OTHER_TENANT_ID }),
      }),
      { params: Promise.resolve({ id: CALENDAR_ID }) },
    );

    expect(mocks.previewBusinessCalendarImpact).toHaveBeenCalledWith(
      CALENDAR_ID,
      validInput,
      { tenantId: session.tenantId, userId: session.id },
    );
    expect(response.status).toBe(200);

    mocks.updateBusinessCalendar.mockRejectedValueOnce(new ConflictError('Preview changed'));
    const conflictResponse = await updateCalendar(
      new NextRequest(`http://localhost/api/service-calendars/${CALENDAR_ID}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...validInput, expectedRevision: 1, proposedHash: 'a'.repeat(64), previewFingerprint: 'b'.repeat(64) }),
      }),
      { params: Promise.resolve({ id: CALENDAR_ID }) },
    );
    expect(conflictResponse.status).toBe(409);
  });

  it('serializes authorization and not-found errors without leaking raw exceptions', async () => {
    mocks.requireServiceAdministrator.mockImplementationOnce(() => {
      throw new ForbiddenError('Service administration requires Tenant Admin access');
    });
    const forbidden = await listCalendars(new NextRequest('http://localhost/api/service-calendars'));
    expect(forbidden.status).toBe(403);

    mocks.requireServiceAdministrator.mockReset();
    mocks.requireServiceAdministrator.mockImplementation(() => undefined);
    mocks.getBusinessCalendar.mockRejectedValueOnce(new NotFoundError('Business calendar not found'));
    const missing = await getCalendar(
      new NextRequest(`http://localhost/api/service-calendars/${CALENDAR_ID}`),
      { params: Promise.resolve({ id: CALENDAR_ID }) },
    );
    expect(missing.status).toBe(404);
  });

  it('rejects invalid UUID route and tenant inputs before service calls', async () => {
    const invalidList = await listCalendars(new NextRequest('http://localhost/api/service-calendars?tenantId=tenant-2'));
    expect(invalidList.status).toBe(400);
    expect(mocks.listBusinessCalendars).not.toHaveBeenCalled();

    const invalidDetail = await getCalendar(
      new NextRequest('http://localhost/api/service-calendars/not-a-uuid'),
      { params: Promise.resolve({ id: 'not-a-uuid' }) },
    );
    expect(invalidDetail.status).toBe(400);
    expect(mocks.getBusinessCalendar).not.toHaveBeenCalled();

    const invalidPatch = await updateCalendar(
      new NextRequest('http://localhost/api/service-calendars/not-a-uuid', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...validInput, tenantId: 'not-a-uuid', expectedRevision: 1, proposedHash: 'a'.repeat(64), previewFingerprint: 'b'.repeat(64) }),
      }),
      { params: Promise.resolve({ id: 'not-a-uuid' }) },
    );
    expect(invalidPatch.status).toBe(400);
    expect(mocks.updateBusinessCalendar).not.toHaveBeenCalled();

    const invalidPatchQuery = await updateCalendar(
      new NextRequest(`http://localhost/api/service-calendars/${CALENDAR_ID}?tenantId=not-a-uuid`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...validInput, expectedRevision: 1, proposedHash: 'a'.repeat(64), previewFingerprint: 'b'.repeat(64) }),
      }),
      { params: Promise.resolve({ id: CALENDAR_ID }) },
    );
    expect(invalidPatchQuery.status).toBe(400);
    expect(mocks.updateBusinessCalendar).not.toHaveBeenCalled();

    const invalidImpact = await previewCalendar(
      new NextRequest(`http://localhost/api/service-calendars/${CALENDAR_ID}/impact`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...validInput, tenantId: 'not-a-uuid' }),
      }),
      { params: Promise.resolve({ id: CALENDAR_ID }) },
    );
    expect(invalidImpact.status).toBe(400);
    expect(mocks.previewBusinessCalendarImpact).not.toHaveBeenCalled();
  });

  it('maps malformed JSON and unknown metadata to validation responses', async () => {
    const malformed = await createCalendar(new NextRequest('http://localhost/api/service-calendars', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"name":',
    }));
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toMatchObject({ success: false, error: { code: 'VALIDATION_ERROR' } });

    const unknown = await createCalendar(new NextRequest('http://localhost/api/service-calendars', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...validInput, metadata: true }),
    }));
    expect(unknown.status).toBe(400);
    expect(mocks.createBusinessCalendar).not.toHaveBeenCalled();
  });

  it('validates both tenant sources and rejects mismatched collection POST metadata', async () => {
    const invalidBody = await createCalendar(new NextRequest(`http://localhost/api/service-calendars?tenantId=${session.tenantId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...validInput, tenantId: 'not-a-uuid' }),
    }));
    expect(invalidBody.status).toBe(400);
    expect(mocks.createBusinessCalendar).not.toHaveBeenCalled();

    const mismatched = await createCalendar(new NextRequest(`http://localhost/api/service-calendars?tenantId=${session.tenantId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...validInput, tenantId: OTHER_TENANT_ID }),
    }));
    expect(mismatched.status).toBe(400);
    expect(mocks.createBusinessCalendar).not.toHaveBeenCalled();
  });

  it('validates both tenant sources and rejects mismatched detail PATCH metadata', async () => {
    const invalidBody = await updateCalendar(new NextRequest(`http://localhost/api/service-calendars/${CALENDAR_ID}?tenantId=${session.tenantId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...validInput, tenantId: 'not-a-uuid', expectedRevision: 1, proposedHash: 'a'.repeat(64), previewFingerprint: 'b'.repeat(64) }),
    }), { params: Promise.resolve({ id: CALENDAR_ID }) });
    expect(invalidBody.status).toBe(400);
    expect(mocks.updateBusinessCalendar).not.toHaveBeenCalled();

    const mismatched = await updateCalendar(new NextRequest(`http://localhost/api/service-calendars/${CALENDAR_ID}?tenantId=${session.tenantId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...validInput, tenantId: OTHER_TENANT_ID, expectedRevision: 1, proposedHash: 'a'.repeat(64), previewFingerprint: 'b'.repeat(64) }),
    }), { params: Promise.resolve({ id: CALENDAR_ID }) });
    expect(mismatched.status).toBe(400);
    expect(mocks.updateBusinessCalendar).not.toHaveBeenCalled();
  });

  describe('public holiday source', () => {
    const status = { provider: 'DATA_GOV_SG_MOM', recordCount: 104, lastError: null };

    beforeEach(() => {
      mocks.getPublicHolidaySourceStatus.mockResolvedValue(status);
      mocks.syncPublicHolidaysIfUpdated.mockResolvedValue({
        synced: true,
        skipped: false,
        sourceChanged: true,
        recordCount: 104,
        dataAsOf: '2026-07-03T16:04:00+08:00',
        calendarsChecked: 1,
        calendarsUpdated: 1,
        calendarsFailed: 0,
        holidaysAdded: 3,
        holidaysUpdated: 0,
        holidaysArchived: 0,
        calendarResults: [{ calendarId: CALENDAR_ID, tenantId: session.tenantId }],
      });
    });

    it('forces a check and reports only the caller workspace', async () => {
      const response = await checkPublicHolidays(new NextRequest(`http://localhost/api/service-calendars/public-holidays?tenantId=${session.tenantId}`, { method: 'POST' }));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(mocks.resolveWorkspaceId).toHaveBeenCalledWith(session, session.tenantId);
      expect(mocks.syncPublicHolidaysIfUpdated).toHaveBeenCalledWith({ force: true, reportTenantId: session.tenantId });
      expect(body.result).toMatchObject({ calendarsUpdated: 1, holidaysAdded: 3 });
      expect(body.result.calendarResults).toBeUndefined();
      expect(body.status).toEqual(status);
    });

    it('requires Tenant Admin access before touching the source', async () => {
      const forbid = () => { throw new ForbiddenError('Service administration requires Tenant Admin access'); };
      mocks.requireServiceAdministrator.mockImplementationOnce(forbid).mockImplementationOnce(forbid);

      const post = await checkPublicHolidays(new NextRequest('http://localhost/api/service-calendars/public-holidays', { method: 'POST' }));
      const get = await getPublicHolidaySource(new NextRequest('http://localhost/api/service-calendars/public-holidays'));

      expect(post.status).toBe(403);
      expect(get.status).toBe(403);
      expect(mocks.syncPublicHolidaysIfUpdated).not.toHaveBeenCalled();
      expect(mocks.getPublicHolidaySourceStatus).not.toHaveBeenCalled();
    });
  });
});
