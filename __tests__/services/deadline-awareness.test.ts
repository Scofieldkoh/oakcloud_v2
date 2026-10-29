import { describe, expect, it, vi } from 'vitest';
import { extractAssessmentYear, isCorporateTaxService, isNomineeDirectorService, listDeadlineAwareness } from '@/services/deadline/awareness';

function service(overrides: Record<string, unknown> = {}) {
  return {
    id: 'service-1',
    companyId: 'company-1',
    familyName: 'Corporate Tax',
    serviceName: 'Corporate Tax YA 2027',
    status: 'ACTIVE',
    startDate: new Date('2026-09-01T00:00:00.000Z'),
    fieldValues: { yearOfAssessment: '2027' },
    company: {
      id: 'company-1',
      name: 'Example Pte Ltd',
      displayAlias: 'Example',
      uen: '202600001A',
      accountsDueDate: new Date('2027-07-31T00:00:00.000Z'),
      financialYearEndDay: 31,
      financialYearEndMonth: 12,
    },
    serviceVariant: {
      code: 'CORPORATE_TAX',
      name: 'Corporate Tax',
      family: { code: 'TAX', name: 'Tax' },
    },
    ...overrides,
  };
}

describe('deadline awareness', () => {
  it('recognises tax and nominee-director services and extracts YA', () => {
    expect(isCorporateTaxService(service())).toBe(true);
    expect(extractAssessmentYear(service())).toBe(2027);
    expect(isNomineeDirectorService(service({
      familyName: 'Nominee Director',
      serviceName: 'Nominee Director Service',
      serviceVariant: { code: 'NOMINEE_DIRECTOR', name: 'Nominee Director', family: { code: 'CORP_SEC', name: 'Corporate Secretarial' } },
    }))).toBe(true);
  });

  it('creates a prior-YA confirmation when the preceding tax YA is outside scope', async () => {
    const db = {
      clientService: { findMany: vi.fn().mockResolvedValue([service()]) },
      deadlineOccurrence: { findMany: vi.fn().mockResolvedValue([]) },
    };

    const result = await listDeadlineAwareness({ tenantId: 'tenant-1' }, db, '2026-09-22');

    expect(result).toEqual([expect.objectContaining({
      kind: 'PRIOR_TAX_YA_CONFIRMATION',
      dueDate: '2026-11-30',
      assessmentYear: 2026,
      coverageStatus: 'OUT_OF_SCOPE_REQUIRES_CONFIRMATION',
    })]);
  });

  it('suppresses the prior-YA warning when a matching YA service exists', async () => {
    const db = {
      clientService: { findMany: vi.fn().mockResolvedValue([
        service(),
        service({ id: 'service-prior', serviceName: 'Corporate Tax YA 2026', fieldValues: { yearOfAssessment: '2026' } }),
      ]) },
      deadlineOccurrence: { findMany: vi.fn().mockResolvedValue([]) },
    };

    const result = await listDeadlineAwareness({ tenantId: 'tenant-1' }, db, '2026-09-22');

    expect(result.some((item) => item.kind === 'PRIOR_TAX_YA_CONFIRMATION')).toBe(false);
  });

  it('marks nominee-director deadlines as monitored-managed when another service owns the same statutory event', async () => {
    const nominee = service({
      id: 'nominee-1',
      familyName: 'Nominee Director',
      serviceName: 'Nominee Director Service',
      fieldValues: {},
      serviceVariant: { code: 'NOMINEE_DIRECTOR', name: 'Nominee Director', family: { code: 'CORP_SEC', name: 'Corporate Secretarial' } },
    });
    const db = {
      clientService: { findMany: vi.fn().mockResolvedValue([nominee]) },
      deadlineOccurrence: { findMany: vi.fn().mockResolvedValue([{
        id: 'deadline-1',
        companyId: 'company-1',
        operativeDueDate: new Date('2026-11-30T00:00:00.000Z'),
        status: 'OPEN',
        clientService: { id: 'tax-1', familyName: 'Corporate Tax', serviceName: 'Corporate Tax YA 2026' },
        cycle: { rule: { code: 'SG_FORM_C', name: 'Singapore Form C' } },
      }]) },
    };

    const result = await listDeadlineAwareness({ tenantId: 'tenant-1' }, db, '2026-09-22');
    const formC = result.find((item) => item.kind === 'NOMINEE_DIRECTOR_MONITORING' && item.ruleCode === 'SG_FORM_C' && item.dueDate === '2026-11-30');

    expect(formC).toMatchObject({
      coverageStatus: 'MONITORED_MANAGED',
      managedService: { id: 'tax-1' },
      monitoringService: { id: 'nominee-1' },
    });
  });

  it('creates monitoring-only awareness when nominee director has no matching managed service', async () => {
    const nominee = service({
      id: 'nominee-1',
      familyName: 'Nominee Director',
      serviceName: 'Nominee Director Service',
      fieldValues: {},
      serviceVariant: { code: 'NOMINEE_DIRECTOR', name: 'Nominee Director', family: { code: 'CORP_SEC', name: 'Corporate Secretarial' } },
    });
    const db = {
      clientService: { findMany: vi.fn().mockResolvedValue([nominee]) },
      deadlineOccurrence: { findMany: vi.fn().mockResolvedValue([]) },
    };

    const result = await listDeadlineAwareness({ tenantId: 'tenant-1' }, db, '2026-09-22');

    expect(result).toContainEqual(expect.objectContaining({
      kind: 'NOMINEE_DIRECTOR_MONITORING',
      ruleCode: 'SG_FORM_C',
      dueDate: '2026-11-30',
      coverageStatus: 'MONITORING_ONLY',
      managedService: null,
    }));
  });
});
