import type { DeadlineAwarenessItem, DeadlineScope } from './types';
import { addMonthsClamped, compareDateOnly, currentDateInSingapore, type DateOnly } from '@/services/service-schedule';

const LOOKBACK_DAYS = 90;
const LOOKAHEAD_DAYS = 370;

type AwarenessDb = {
  clientService?: {
    findMany?: (args: unknown) => Promise<unknown[]>;
  };
  deadlineOccurrence?: {
    findMany?: (args: unknown) => Promise<unknown[]>;
  };
};

type ServiceRow = {
  id: string;
  companyId: string;
  familyName: string;
  serviceName: string;
  status: string;
  startDate: Date | string;
  endDate?: Date | string | null;
  fieldValues?: unknown;
  company?: {
    id: string;
    name: string;
    displayAlias?: string | null;
    uen?: string | null;
    accountsDueDate?: Date | string | null;
    financialYearEndDay?: number | null;
    financialYearEndMonth?: number | null;
  } | null;
  serviceVariant?: {
    code?: string | null;
    name?: string | null;
    family?: { code?: string | null; name?: string | null } | null;
  } | null;
};

type ExistingOccurrenceRow = {
  id: string;
  companyId: string;
  operativeDueDate: Date | string;
  status: string;
  clientService?: {
    id?: string;
    familyName?: string;
    serviceName?: string;
  } | null;
  cycle?: {
    rule?: {
      code?: string;
      name?: string;
    } | null;
  } | null;
};

function asDateOnly(value: Date | string): DateOnly {
  return (value instanceof Date ? value.toISOString() : value).slice(0, 10) as DateOnly;
}

function addDays(value: DateOnly, days: number): DateOnly {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10) as DateOnly;
}

function serviceIdentity(service: ServiceRow): string {
  return [
    service.familyName,
    service.serviceName,
    service.serviceVariant?.code,
    service.serviceVariant?.name,
    service.serviceVariant?.family?.code,
    service.serviceVariant?.family?.name,
  ].filter(Boolean).join(' ').toLowerCase();
}

export function isNomineeDirectorService(service: ServiceRow): boolean {
  return /nominee[\s_-]*director/.test(serviceIdentity(service));
}

export function isCorporateTaxService(service: ServiceRow): boolean {
  const value = serviceIdentity(service);
  if (/\bgst\b|goods\s*(?:and|&)\s*services?\s*tax/.test(value)) return false;
  return /corporate[\s_-]*tax|income[\s_-]*tax|\btaxation\b|\bcorporate\s+income\b/.test(value);
}

function parseAssessmentYearValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 2000 && value <= 2200) return value;
  if (typeof value !== 'string') return null;
  const match = value.match(/(?:YA\s*)?(20\d{2})/i);
  if (!match) return null;
  const year = Number(match[1]);
  return year >= 2000 && year <= 2200 ? year : null;
}

export function extractAssessmentYear(service: ServiceRow): number | null {
  if (service.fieldValues && typeof service.fieldValues === 'object' && !Array.isArray(service.fieldValues)) {
    const values = service.fieldValues as Record<string, unknown>;
    for (const [key, value] of Object.entries(values)) {
      const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (['ya', 'yearofassessment', 'assessmentyear', 'taxyear'].includes(normalized)) {
        const parsed = parseAssessmentYearValue(value);
        if (parsed) return parsed;
      }
    }
  }
  return parseAssessmentYearValue(service.serviceName);
}

function withinAwarenessWindow(date: DateOnly, today: DateOnly): boolean {
  return compareDateOnly(date, addDays(today, -LOOKBACK_DAYS)) >= 0
    && compareDateOnly(date, addDays(today, LOOKAHEAD_DAYS)) <= 0;
}

function companyDto(service: ServiceRow) {
  const company = service.company;
  return {
    id: company?.id ?? service.companyId,
    name: company?.name ?? '',
    displayAlias: company?.displayAlias ?? null,
    uen: company?.uen ?? null,
  };
}

function serviceDto(service: ServiceRow) {
  return {
    id: service.id,
    name: service.serviceName,
    familyName: service.familyName,
  };
}

function existingKey(companyId: string, ruleCode: string, dueDate: DateOnly): string {
  return `${companyId}|${ruleCode}|${dueDate}`;
}

function fyeDate(year: number, month: number, day: number): DateOnly | null {
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(day) || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10) as DateOnly;
}

function monitoringCandidates(service: ServiceRow, today: DateOnly): Array<{
  ruleCode: string;
  ruleName: string;
  milestoneName: string;
  dueDate: DateOnly;
}> {
  const company = service.company;
  if (!company) return [];
  const items: Array<{ ruleCode: string; ruleName: string; milestoneName: string; dueDate: DateOnly }> = [];

  if (company.accountsDueDate) {
    const annualReturn = asDateOnly(company.accountsDueDate);
    if (withinAwarenessWindow(annualReturn, today)) {
      items.push({ ruleCode: 'SG_ANNUAL_RETURN', ruleName: 'Singapore Annual Return', milestoneName: 'Annual Return due date', dueDate: annualReturn });
    }
    const agm = addMonthsClamped(annualReturn, -1);
    if (withinAwarenessWindow(agm, today)) {
      items.push({ ruleCode: 'SG_AGM_DUE', ruleName: 'Singapore AGM Due Date', milestoneName: 'AGM due date', dueDate: agm });
    }
  }

  const month = company.financialYearEndMonth;
  const day = company.financialYearEndDay;
  if (month && day) {
    const year = Number(today.slice(0, 4));
    for (let fyeYear = year - 1; fyeYear <= year + 1; fyeYear += 1) {
      const fye = fyeDate(fyeYear, month, day);
      if (!fye) continue;
      const eci = addMonthsClamped(fye, 3);
      if (withinAwarenessWindow(eci, today)) {
        items.push({ ruleCode: 'SG_ECI', ruleName: 'Singapore ECI', milestoneName: 'ECI due date', dueDate: eci });
      }
      const formC = `${String(fyeYear + 1).padStart(4, '0')}-11-30` as DateOnly;
      if (withinAwarenessWindow(formC, today)) {
        items.push({ ruleCode: 'SG_FORM_C', ruleName: 'Singapore Form C', milestoneName: 'Form C due date', dueDate: formC });
      }
    }
  }

  return items;
}

export async function listDeadlineAwareness(
  scope: DeadlineScope,
  db: AwarenessDb,
  today: DateOnly = currentDateInSingapore(),
): Promise<DeadlineAwarenessItem[]> {
  if (!db.clientService?.findMany || !db.deadlineOccurrence?.findMany) return [];
  const companyFilter = scope.companyIds === undefined ? {} : { companyId: { in: scope.companyIds } };
  if (scope.companyIds?.length === 0) return [];

  const rawServices = await db.clientService.findMany({
    where: {
      tenantId: scope.tenantId,
      deletedAt: null,
      status: { in: ['ACTIVE', 'PAUSED'] },
      ...companyFilter,
    },
    include: {
      company: {
        select: {
          id: true,
          name: true,
          displayAlias: true,
          uen: true,
          accountsDueDate: true,
          financialYearEndDay: true,
          financialYearEndMonth: true,
        },
      },
      serviceVariant: {
        select: {
          code: true,
          name: true,
          family: { select: { code: true, name: true } },
        },
      },
    },
  });

  const services = (Array.isArray(rawServices) ? rawServices : []) as ServiceRow[];
  const relevant = services.filter((service) => isNomineeDirectorService(service) || isCorporateTaxService(service));
  if (relevant.length === 0) return [];

  const companyIds = [...new Set(relevant.map((service) => service.companyId))];
  const rawOccurrences = await db.deadlineOccurrence.findMany({
    where: {
      tenantId: scope.tenantId,
      companyId: { in: companyIds },
      deadlineType: 'STATUTORY',
      operativeDueDate: {
        gte: new Date(`${addDays(today, -LOOKBACK_DAYS)}T00:00:00.000Z`),
        lte: new Date(`${addDays(today, LOOKAHEAD_DAYS)}T00:00:00.000Z`),
      },
      status: { in: ['OPEN', 'COMPLETED', 'WAIVED'] },
    },
    include: {
      clientService: { select: { id: true, familyName: true, serviceName: true } },
      cycle: { select: { rule: { select: { code: true, name: true } } } },
    },
  });
  const occurrences = (Array.isArray(rawOccurrences) ? rawOccurrences : []) as ExistingOccurrenceRow[];
  const occurrenceByKey = new Map<string, ExistingOccurrenceRow>();
  for (const occurrence of occurrences) {
    const code = occurrence.cycle?.rule?.code;
    if (!code) continue;
    occurrenceByKey.set(existingKey(occurrence.companyId, code, asDateOnly(occurrence.operativeDueDate)), occurrence);
  }

  const items: DeadlineAwarenessItem[] = [];
  const seen = new Set<string>();

  const taxServices = relevant.filter(isCorporateTaxService);
  for (const service of taxServices) {
    const assessmentYear = extractAssessmentYear(service);
    if (!assessmentYear) continue;
    const priorYear = assessmentYear - 1;
    const dueDate = `${priorYear}-11-30` as DateOnly;
    if (!withinAwarenessWindow(dueDate, today)) continue;

    const priorServiceExists = taxServices.some((candidate) =>
      candidate.companyId === service.companyId
      && candidate.id !== service.id
      && extractAssessmentYear(candidate) === priorYear
    );
    const existing = occurrenceByKey.get(existingKey(service.companyId, 'SG_FORM_C', dueDate));
    if (priorServiceExists || existing) continue;

    const key = `PRIOR_TAX_YA_CONFIRMATION|${service.companyId}|${priorYear}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      id: `awareness:${key}`,
      kind: 'PRIOR_TAX_YA_CONFIRMATION',
      company: companyDto(service),
      dueDate,
      ruleCode: 'SG_FORM_C',
      ruleName: 'Singapore Form C',
      milestoneName: `YA ${priorYear} Form C filing`,
      coverageStatus: 'OUT_OF_SCOPE_REQUIRES_CONFIRMATION',
      monitoringService: serviceDto(service),
      managedService: null,
      assessmentYear: priorYear,
      message: `YA ${priorYear} is immediately before the YA ${assessmentYear} engagement. Confirm whether the client or previous tax agent will file it, or extend the engagement.`,
    });
  }

  for (const service of relevant.filter(isNomineeDirectorService)) {
    for (const candidate of monitoringCandidates(service, today)) {
      const key = `NOMINEE_DIRECTOR_MONITORING|${service.companyId}|${candidate.ruleCode}|${candidate.dueDate}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const existing = occurrenceByKey.get(existingKey(service.companyId, candidate.ruleCode, candidate.dueDate));
      items.push({
        id: `awareness:${key}`,
        kind: 'NOMINEE_DIRECTOR_MONITORING',
        company: companyDto(service),
        dueDate: candidate.dueDate,
        ruleCode: candidate.ruleCode,
        ruleName: candidate.ruleName,
        milestoneName: candidate.milestoneName,
        coverageStatus: existing ? 'MONITORED_MANAGED' : 'MONITORING_ONLY',
        monitoringService: serviceDto(service),
        managedService: existing?.clientService?.id ? {
          id: existing.clientService.id,
          name: existing.clientService.serviceName ?? '',
          familyName: existing.clientService.familyName ?? '',
        } : null,
        assessmentYear: candidate.ruleCode === 'SG_FORM_C' ? Number(candidate.dueDate.slice(0, 4)) : null,
        message: existing
          ? `Nominee director monitoring overlaps with ${existing.clientService?.serviceName ?? 'an existing service'}; the statutory deadline remains managed by that service.`
          : 'Nominee director monitoring identified this statutory deadline, but no other active service currently owns a matching managed deadline.',
      });
    }
  }

  return items.sort((left, right) => left.dueDate.localeCompare(right.dueDate) || left.company.name.localeCompare(right.company.name) || left.ruleCode.localeCompare(right.ruleCode));
}
