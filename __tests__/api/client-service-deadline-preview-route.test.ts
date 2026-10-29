import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const authMock = vi.hoisted(() => ({ requireAuth: vi.fn() }));
const rbacMock = vi.hoisted(() => ({ requirePermission: vi.fn() }));
const serviceMock = vi.hoisted(() => ({ previewClientServiceDeadlineDraft: vi.fn() }));
vi.mock('@/lib/auth', () => authMock);
vi.mock('@/lib/rbac', () => rbacMock);
vi.mock('@/services/client-service', () => serviceMock);

import { POST } from '@/app/api/client-services/deadline-configuration/preview/route';

const session = {
  id: 'user-1',
  tenantId: 'tenant-1',
  isSuperAdmin: false,
  hasAllCompaniesAccess: false,
  companyIds: ['99999999-9999-4999-8999-999999999999'],
};
const body = {
  companyId: '99999999-9999-4999-8999-999999999999',
  serviceVariantId: '88888888-8888-4888-8888-888888888888',
  deadlineRules: [],
  scheduleSnapshot: {
    status: 'ACTIVE',
    serviceCadence: 'ANNUALLY',
    customCadenceLabel: null,
    startDate: '2026-08-01',
    endDate: null,
    fieldValues: {},
  },
};

describe('client-service deadline draft preview route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.requireAuth.mockResolvedValue(session);
    rbacMock.requirePermission.mockResolvedValue(undefined);
    serviceMock.previewClientServiceDeadlineDraft.mockResolvedValue({
      companyId: 'company-1',
      serviceVariantId: 'variant-1',
      today: '2026-08-27',
      horizonEnd: '2027-08-27',
      counts: { applicable: 1, disabled: 0, inapplicable: 0, missingInput: 0, warnings: 0 },
      warnings: [],
      projectedDeadlines: [{
        ruleId: 'rule-1',
        ruleCode: 'SG_ANNUAL_RETURN',
        ruleName: 'Annual Return',
        materializationPolicy: 'AUTHORITATIVE_ANNUAL_BACKLOG',
        periodKey: '2027',
        milestoneKey: 'annual-return-due',
        milestoneName: 'Annual Return due',
        scheduleEntryKey: '',
        deadlineType: 'STATUTORY',
        calculatedDueDate: '2027-07-31',
        explanation: [],
      }],
    });
  });

  it('requires company update permission for the draft company', async () => {
    const response = await POST(new NextRequest('http://localhost/api/client-services/deadline-configuration/preview', { method: 'POST', body: JSON.stringify(body) }));
    expect(response.status).toBe(200);
    expect(rbacMock.requirePermission).toHaveBeenCalledWith(session, 'company', 'update', '99999999-9999-4999-8999-999999999999');
    expect(serviceMock.previewClientServiceDeadlineDraft).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: '99999999-9999-4999-8999-999999999999', serviceVariantId: '88888888-8888-4888-8888-888888888888' }),
      {
        tenantId: 'tenant-1',
        userId: 'user-1',
        accessibleCompanyIds: ['99999999-9999-4999-8999-999999999999'],
        allCompaniesAccess: false,
      },
    );
  });

  it('rejects unknown query parameters', async () => {
    const response = await POST(new NextRequest('http://localhost/api/client-services/deadline-configuration/preview?unexpected=value', { method: 'POST', body: JSON.stringify(body) }));
    expect(response.status).toBe(400);
    expect(serviceMock.previewClientServiceDeadlineDraft).not.toHaveBeenCalled();
  });

  it('rejects malformed draft payloads before the service layer', async () => {
    const response = await POST(new NextRequest('http://localhost/api/client-services/deadline-configuration/preview', { method: 'POST', body: JSON.stringify({ ...body, companyId: 'not-a-uuid' }) }));
    expect(response.status).toBe(400);
    expect(serviceMock.previewClientServiceDeadlineDraft).not.toHaveBeenCalled();
  });

  it('returns the canonical projected deadlines for the draft', async () => {
    const response = await POST(new NextRequest('http://localhost/api/client-services/deadline-configuration/preview', { method: 'POST', body: JSON.stringify(body) }));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.projectedDeadlines).toEqual([
      expect.objectContaining({
        ruleCode: 'SG_ANNUAL_RETURN',
        calculatedDueDate: '2027-07-31',
      }),
    ]);
  });
});
