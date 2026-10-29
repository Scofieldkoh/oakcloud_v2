import type { Prisma } from '@/generated/prisma';
import { currentDateInSingapore } from '@/services/service-schedule/date-only';
import { financialYearEndInYear } from '@/services/service-schedule/obligation-periods';
import { obligationDefinition, isMonitoringProfile, type MonitoringProfile } from './catalog';
import { purgeDeletedServiceObligations } from './writer';

/**
 * Coverage and delivery-scope setup for a newly activated client service.
 * Monitoring starts at the recorded agreement date; ambiguous legacy filing
 * scope is stored as UNCONFIRMED and never treated as a confirmed engagement.
 */

type Tx = Prisma.TransactionClient;

const PERIOD_KEY_PATTERN = /^(?:FY\d{4}-\d{2}-\d{2}|YA\d{4})$/;
const LEGACY_YA_KEYS = new Set(['ya', 'yearofassessment', 'assessmentyear', 'taxyear']);

export type FilingScopeEntry = { obligationCode: string; periodKey: string };

export type ProposedDeliveryScope = FilingScopeEntry & {
  confirmation: 'CONFIRMED' | 'UNCONFIRMED';
  source: 'AGREEMENT_FIELD' | 'LEGACY_YA_FIELD';
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function legacyAssessmentYear(fieldValues: Record<string, unknown>): number | null {
  for (const [key, value] of Object.entries(fieldValues)) {
    if (!LEGACY_YA_KEYS.has(key.toLowerCase().replace(/[^a-z0-9]/g, ''))) continue;
    const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value : '';
    const match = text.match(/(?:YA\s*)?(20\d{2})/i);
    if (match) return Number(match[1]);
  }
  return null;
}

/**
 * Delivery scopes a service's field values propose. An explicit `filingScope`
 * list is confirmed; a legacy YA field only suggests the Form C return for that
 * YA and the ECI for the financial year ending in the year before it.
 */
export function proposedDeliveryScopes(
  fieldValues: unknown,
  profiles: readonly MonitoringProfile[],
  company: { financialYearEndMonth?: number | null; financialYearEndDay?: number | null },
): ProposedDeliveryScope[] {
  const values = asRecord(fieldValues);
  const explicit = Array.isArray(values.filingScope) ? values.filingScope : null;
  if (explicit) {
    const scopes = explicit.flatMap((entry): ProposedDeliveryScope[] => {
      const record = asRecord(entry);
      const obligationCode = typeof record.obligationCode === 'string' ? record.obligationCode : '';
      const periodKey = typeof record.periodKey === 'string' ? record.periodKey.trim().toUpperCase() : '';
      if (!obligationDefinition(obligationCode) || !PERIOD_KEY_PATTERN.test(periodKey)) return [];
      return [{ obligationCode, periodKey, confirmation: 'CONFIRMED', source: 'AGREEMENT_FIELD' }];
    });
    return dedupeScopes(scopes);
  }

  if (!profiles.includes('CORPORATE_TAX')) return [];
  const yearOfAssessment = legacyAssessmentYear(values);
  if (yearOfAssessment === null) return [];
  const scopes: ProposedDeliveryScope[] = [{
    obligationCode: 'SG_FORM_C',
    periodKey: `YA${yearOfAssessment}`,
    confirmation: 'UNCONFIRMED',
    source: 'LEGACY_YA_FIELD',
  }];
  const month = company.financialYearEndMonth;
  const day = company.financialYearEndDay;
  if (typeof month === 'number' && typeof day === 'number' && month >= 1 && month <= 12 && day >= 1) {
    scopes.push({
      obligationCode: 'SG_ECI',
      periodKey: `FY${financialYearEndInYear(yearOfAssessment - 1, month, day)}`,
      confirmation: 'UNCONFIRMED',
      source: 'LEGACY_YA_FIELD',
    });
  }
  return scopes;
}

function dedupeScopes(scopes: ProposedDeliveryScope[]): ProposedDeliveryScope[] {
  return [...new Map(scopes.map((scope) => [`${scope.obligationCode}|${scope.periodKey}`, scope])).values()];
}

export type ActivatedServiceMonitoringInput = {
  tenantId: string;
  companyId: string;
  clientServiceId: string;
  serviceVariantId: string | null;
  agreementId: string | null;
  agreementDate: Date | null;
  serviceStartDate: Date | null;
  serviceEndDate: Date | null;
  fieldValues: unknown;
  actorId: string | null;
};

export type ActivatedServiceMonitoringResult = {
  coverageIds: string[];
  deliveryScopeCount: number;
};

/**
 * Create monitoring coverage (from the variant's profiles) and delivery scopes
 * for a newly created client service. Safe to re-run: every write is keyed.
 */
export async function createMonitoringForActivatedService(
  tx: Tx,
  input: ActivatedServiceMonitoringInput,
): Promise<ActivatedServiceMonitoringResult> {
  const result: ActivatedServiceMonitoringResult = { coverageIds: [], deliveryScopeCount: 0 };
  if (!input.serviceVariantId || !tx.serviceVariant?.findFirst || !tx.companyMonitoringCoverage) return result;
  const variant = await tx.serviceVariant.findFirst({
    where: { id: input.serviceVariantId, tenantId: input.tenantId },
    select: { monitoringProfiles: true },
  });
  const profiles = (variant?.monitoringProfiles ?? []).filter(isMonitoringProfile);

  for (const profile of profiles) {
    const start = input.agreementDate ?? input.serviceStartDate;
    if (!start) continue;
    const coverage = await tx.companyMonitoringCoverage.upsert({
      where: {
        tenantId_clientServiceId_profile: {
          tenantId: input.tenantId,
          clientServiceId: input.clientServiceId,
          profile,
        },
      },
      create: {
        tenantId: input.tenantId,
        companyId: input.companyId,
        profile,
        source: 'AGREEMENT',
        agreementId: input.agreementId,
        clientServiceId: input.clientServiceId,
        monitoringStart: start,
        monitoringEnd: input.serviceEndDate,
        startSource: input.agreementDate ? 'AGREEMENT_DATE' : 'SERVICE_START_UNREVIEWED',
        createdById: input.actorId,
      },
      update: {},
    });
    result.coverageIds.push(coverage.id);
    if (!input.agreementDate) {
      await tx.companyComplianceIssue.upsert({
        where: {
          tenantId_companyId_dedupeKey: {
            tenantId: input.tenantId,
            companyId: input.companyId,
            dedupeKey: `MONITORING_START_REVIEW|||${coverage.id}`,
          },
        },
        create: {
          tenantId: input.tenantId,
          companyId: input.companyId,
          coverageId: coverage.id,
          type: 'MONITORING_START_REVIEW',
          dedupeKey: `MONITORING_START_REVIEW|||${coverage.id}`,
          message: 'The agreement date is unknown, so monitoring provisionally starts at the service start date. Confirm the monitoring start.',
        },
        update: {},
      });
    }
  }

  const company = await tx.company.findFirst({
    where: { id: input.companyId, tenantId: input.tenantId },
    select: { financialYearEndMonth: true, financialYearEndDay: true },
  });
  const scopes = proposedDeliveryScopes(input.fieldValues, profiles, company ?? {});
  if (scopes.length > 0) {
    const created = await tx.clientServiceObligationScope.createMany({
      data: scopes.map((scope) => ({
        tenantId: input.tenantId,
        companyId: input.companyId,
        clientServiceId: input.clientServiceId,
        obligationCode: scope.obligationCode,
        periodKey: scope.periodKey,
        confirmation: scope.confirmation,
        source: scope.source,
        confirmedAt: scope.confirmation === 'CONFIRMED' ? new Date() : null,
        confirmedById: scope.confirmation === 'CONFIRMED' ? input.actorId : null,
      })),
      skipDuplicates: true,
    });
    result.deliveryScopeCount = created.count;
  }
  return result;
}

/**
 * Ending a service never cancels company obligations. Coverage it created ends
 * on the service end date, and open contracted filings due after that date are
 * raised for handover review by the next company reconciliation.
 */
export async function endMonitoringForService(
  tx: Tx,
  input: { tenantId: string; clientServiceId: string; endDate: Date; actorId: string | null; reason: string },
): Promise<number> {
  if (!tx.companyMonitoringCoverage?.updateMany) return 0;
  const ended = await tx.companyMonitoringCoverage.updateMany({
    where: { tenantId: input.tenantId, clientServiceId: input.clientServiceId, status: 'ACTIVE' },
    data: {
      status: 'ENDED',
      monitoringEnd: input.endDate,
      endedAt: new Date(),
      endedById: input.actorId,
      endedReason: input.reason.slice(0, 1000),
    },
  });
  return ended.count;
}

/** Keep a service's active coverage end aligned with the service end date. */
export async function syncMonitoringEndForService(
  tx: Tx,
  input: { tenantId: string; clientServiceId: string; endDate: Date | null },
): Promise<number> {
  if (!tx.companyMonitoringCoverage?.updateMany) return 0;
  const updated = await tx.companyMonitoringCoverage.updateMany({
    where: { tenantId: input.tenantId, clientServiceId: input.clientServiceId, status: 'ACTIVE' },
    data: { monitoringEnd: input.endDate },
  });
  return updated.count;
}

/**
 * Before a client service is permanently deleted, detach its monitoring:
 * coverage ends and loses the service reference, contracted scopes are
 * released from their obligations and removed, and obligations it was filing
 * return to projected responsibility. The company obligations that only this
 * service was monitoring or filing are then removed with it (see
 * purgeDeletedServiceObligations); ones another service covers remain.
 * Returns the number of company obligations removed.
 */
export async function detachMonitoringFromDeletedService(
  tx: Tx,
  input: { tenantId: string; companyId: string; clientServiceId: string; actorId: string | null; reason: string },
): Promise<number> {
  if (!tx.companyMonitoringCoverage?.updateMany) return 0;
  const now = new Date();
  await tx.companyMonitoringCoverage.updateMany({
    where: { tenantId: input.tenantId, clientServiceId: input.clientServiceId, status: 'ACTIVE' },
    data: {
      status: 'ENDED',
      monitoringEnd: now,
      endedAt: now,
      endedById: input.actorId,
      endedReason: input.reason.slice(0, 1000),
    },
  });
  await tx.companyMonitoringCoverage.updateMany({
    where: { tenantId: input.tenantId, clientServiceId: input.clientServiceId },
    data: { clientServiceId: null },
  });
  const scopes = await tx.clientServiceObligationScope.findMany({
    where: { tenantId: input.tenantId, clientServiceId: input.clientServiceId },
    select: { id: true },
  });
  if (scopes.length > 0) {
    await tx.deadlineOccurrenceCoverageLink.updateMany({
      where: { tenantId: input.tenantId, deliveryScopeId: { in: scopes.map((scope) => scope.id) } },
      data: { deliveryScopeId: null, releasedAt: now },
    });
    await tx.clientServiceObligationScope.deleteMany({
      where: { tenantId: input.tenantId, clientServiceId: input.clientServiceId },
    });
  }
  await tx.deadlineOccurrence.updateMany({
    where: { tenantId: input.tenantId, deliveryClientServiceId: input.clientServiceId },
    data: { deliveryClientServiceId: null, filingResponsibility: 'UNCONFIRMED', responsibilitySource: 'PROJECTED' },
  });
  return purgeDeletedServiceObligations(tx, { tenantId: input.tenantId, companyId: input.companyId, today: currentDateInSingapore() });
}

