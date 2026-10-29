import { Prisma } from '@/generated/prisma';
import { prisma } from '@/lib/prisma';
import { currentDateInSingapore, type DateOnly } from '@/services/service-schedule';
import {
  isPostpaidTrigger,
  POSTPAID_SCHEDULE_ENTRY_KEY,
  POSTPAID_TRIGGER_OBLIGATIONS,
  postpaidBillingPeriodKey,
  postpaidGenerationKey,
} from './postpaid-triggers';
import { parseTieredPricing, priceTieredQuantity, type TieredPricing } from './tiered-pricing';

export { isPostpaidGenerationKey, POSTPAID_GENERATION_PREFIX, POSTPAID_SCHEDULE_ENTRY_KEY } from './postpaid-triggers';

/**
 * Postpaid fee lines bill once per Year of Assessment when their trigger
 * filing is set to Filed. Entries are keyed by fee line and YA, so setting
 * Filed again, or filing both ECI and Form C, never adds a second entry.
 * Moving the YA back from Filed cancels an entry that is still Open; filing
 * again reopens it. Billed, waived and staff-cancelled entries are kept.
 *
 * A fee line priced by quantity tiers bills its tier price for the quantity
 * staff enter when they mark the filing Filed (applyPostpaidQuantities). An
 * entry raised without one, e.g. by reconciliation, bills 0.00 until staff
 * enter the quantity.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export const POSTPAID_UNFILED_REASON = 'Filing status is no longer Filed';

export type PostpaidBillingSyncResult = {
  created: number;
  reopened: number;
  cancelled: number;
  updated: number;
};

type FiledObligation = { obligationCode: string | null; yearOfAssessment: number | null; completedAt: Date | null };

type PostpaidService = {
  id: string;
  companyId: string;
  startDate: Date;
  engagementStartYearOfAssessment: number | null;
  feeLines: Array<{ id: string; amount: Prisma.Decimal; currency: string; postpaidTrigger: string | null; tieredPricing: unknown }>;
};

function dateValue(value: DateOnly): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function amountString(value: unknown): string {
  if (value instanceof Prisma.Decimal) return value.toFixed(2);
  return new Prisma.Decimal(String(value)).toFixed(2);
}

/**
 * What a postpaid entry bills: the fixed amount, or for a tiered line the
 * tier price of its quantity (0.00 until a quantity is entered).
 */
export function postpaidEntryAmount(
  feeLine: { amount: unknown; tieredPricing: unknown },
  quantity: unknown,
): string {
  const pricing = parseTieredPricing(feeLine.tieredPricing);
  if (!pricing) return amountString(feeLine.amount);
  if (quantity == null) return '0.00';
  return priceTieredQuantity(pricing, amountString(quantity));
}

/**
 * The YAs a service bills for, each with the day its trigger was first filed.
 * A YA bills from the service's engagement start YA onwards; with no
 * engagement start YA, it bills when it was filed on or after the service
 * start.
 */
export function postpaidBillableYears(
  service: Pick<PostpaidService, 'startDate' | 'engagementStartYearOfAssessment'>,
  trigger: string | null,
  filed: readonly FiledObligation[],
): Map<number, DateOnly> {
  const result = new Map<number, DateOnly>();
  if (!isPostpaidTrigger(trigger)) return result;
  const codes = POSTPAID_TRIGGER_OBLIGATIONS[trigger];
  const serviceStart = service.startDate.toISOString().slice(0, 10);
  for (const row of filed) {
    if (!row.obligationCode || !codes.includes(row.obligationCode)) continue;
    if (row.yearOfAssessment == null || !row.completedAt) continue;
    const filedOn = currentDateInSingapore(row.completedAt);
    if (service.engagementStartYearOfAssessment != null) {
      if (row.yearOfAssessment < service.engagementStartYearOfAssessment) continue;
    } else if (filedOn < serviceStart) {
      continue;
    }
    const earlier = result.get(row.yearOfAssessment);
    if (!earlier || filedOn < earlier) result.set(row.yearOfAssessment, filedOn);
  }
  return result;
}

export type SyncPostpaidBillingInput = {
  tenantId: string;
  companyId: string;
  /** Sync one service instead of every service of the company. */
  clientServiceId?: string;
  /** Who cancels an entry whose YA is no longer Filed (a user or a reconciliation request). */
  cancelledById?: string | null;
  cancellationReconciliationRequestId?: string | null;
};

/**
 * Bring a company's postpaid billing entries in line with its filed
 * obligations. Without a cancelling user or request, entries are only
 * created or reopened.
 */
export async function syncPostpaidBilling(
  input: SyncPostpaidBillingInput,
  db: Db = prisma,
): Promise<PostpaidBillingSyncResult> {
  const result: PostpaidBillingSyncResult = { created: 0, reopened: 0, cancelled: 0, updated: 0 };
  const services = await db.clientService.findMany({
    where: {
      tenantId: input.tenantId,
      companyId: input.companyId,
      ...(input.clientServiceId ? { id: input.clientServiceId } : {}),
      status: 'ACTIVE',
      deletedAt: null,
      billingDisposition: 'CONFIGURED',
      feeLines: { some: { billingTiming: 'POSTPAID', isActive: true, deletedAt: null } },
    },
    select: {
      id: true,
      companyId: true,
      startDate: true,
      engagementStartYearOfAssessment: true,
      feeLines: {
        where: { billingTiming: 'POSTPAID', isActive: true, deletedAt: null },
        select: { id: true, amount: true, currency: true, postpaidTrigger: true, tieredPricing: true },
      },
    },
  }) as PostpaidService[];
  if (services.length === 0) return result;

  const filed = await db.deadlineOccurrence.findMany({
    where: {
      tenantId: input.tenantId,
      companyId: input.companyId,
      ownershipScope: 'COMPANY',
      obligationCode: { in: [...new Set(Object.values(POSTPAID_TRIGGER_OBLIGATIONS).flat())] },
      status: 'COMPLETED',
      yearOfAssessment: { not: null },
    },
    select: { obligationCode: true, yearOfAssessment: true, completedAt: true },
  });

  for (const service of services) {
    for (const feeLine of service.feeLines) {
      const billable = postpaidBillableYears(service, feeLine.postpaidTrigger, filed);
      const generationKey = postpaidGenerationKey(feeLine.id);
      const existing = await db.billingOccurrence.findMany({
        where: { tenantId: input.tenantId, clientServiceId: service.id, feeLineId: feeLine.id, generationKey },
        select: {
          id: true,
          billingPeriodKey: true,
          status: true,
          cancellationReason: true,
          dateOverridden: true,
          valueOverridden: true,
          baseAmount: true,
          baseCurrency: true,
          quantity: true,
        },
      });
      const byPeriod = new Map(existing.map((row) => [row.billingPeriodKey, row]));

      const creates: Prisma.BillingOccurrenceCreateManyInput[] = [];
      for (const [yearOfAssessment, filedOn] of billable) {
        const periodKey = postpaidBillingPeriodKey(yearOfAssessment);
        const row = byPeriod.get(periodKey);
        if (!row) {
          const amount = postpaidEntryAmount(feeLine, null);
          creates.push({
            tenantId: input.tenantId,
            companyId: service.companyId,
            clientServiceId: service.id,
            feeLineId: feeLine.id,
            billingPeriodKey: periodKey,
            scheduleEntryKey: POSTPAID_SCHEDULE_ENTRY_KEY,
            generationKey,
            calculatedExpectedDate: dateValue(filedOn),
            operativeExpectedDate: dateValue(filedOn),
            baseAmount: amount,
            baseCurrency: feeLine.currency,
            operativeAmount: amount,
            operativeCurrency: feeLine.currency,
            status: 'OPEN',
          });
          continue;
        }
        if (row.status === 'CANCELLED' && row.cancellationReason === POSTPAID_UNFILED_REASON) {
          await db.billingOccurrence.update({
            where: { id: row.id },
            data: {
              status: 'OPEN',
              cancelledAt: null,
              cancelledById: null,
              cancellationReason: null,
              cancellationReconciliationRequestId: null,
              calculatedExpectedDate: dateValue(filedOn),
              ...(row.dateOverridden ? {} : { operativeExpectedDate: dateValue(filedOn) }),
            },
          });
          result.reopened += 1;
          continue;
        }
        // Keep an Open entry's fee in step with the line, as prepaid rows are.
        const amount = postpaidEntryAmount(feeLine, row.quantity);
        if (row.status === 'OPEN'
          && (amountString(row.baseAmount) !== amount || row.baseCurrency !== feeLine.currency)) {
          await db.billingOccurrence.update({
            where: { id: row.id },
            data: {
              baseAmount: amount,
              baseCurrency: feeLine.currency,
              ...(row.valueOverridden ? {} : { operativeAmount: amount, operativeCurrency: feeLine.currency }),
            },
          });
          result.updated += 1;
        }
      }
      if (creates.length > 0) {
        const created = await db.billingOccurrence.createMany({ data: creates, skipDuplicates: true });
        result.created += created.count;
      }

      const billablePeriods = new Set([...billable.keys()].map(postpaidBillingPeriodKey));
      const unfiled = existing.filter((row) => row.status === 'OPEN' && !billablePeriods.has(row.billingPeriodKey));
      if (unfiled.length > 0 && (input.cancelledById || input.cancellationReconciliationRequestId)) {
        const cancelled = await db.billingOccurrence.updateMany({
          where: { id: { in: unfiled.map((row) => row.id) }, status: 'OPEN' },
          data: {
            status: 'CANCELLED',
            cancelledAt: new Date(),
            cancelledById: input.cancelledById ?? null,
            cancellationReason: POSTPAID_UNFILED_REASON,
            cancellationReconciliationRequestId: input.cancelledById ? null : input.cancellationReconciliationRequestId ?? null,
          },
        });
        result.cancelled += cancelled.count;
      }
    }
  }
  return result;
}

export type PostpaidEngagementStartConflict = {
  clientServiceId: string;
  serviceName: string;
  engagementStartYearOfAssessment: number;
};

/**
 * Services with a postpaid fee line billed on this filing whose engagement
 * start YA is after the filing's YA, so filing it raises no bill for them.
 */
export async function findPostpaidEngagementStartConflicts(
  input: { tenantId: string; companyId: string; obligationCode: string; yearOfAssessment: number },
  db: Db = prisma,
): Promise<PostpaidEngagementStartConflict[]> {
  const triggers = Object.entries(POSTPAID_TRIGGER_OBLIGATIONS)
    .filter(([, codes]) => codes.includes(input.obligationCode))
    .map(([trigger]) => trigger);
  if (triggers.length === 0) return [];
  const services = await db.clientService.findMany({
    where: {
      tenantId: input.tenantId,
      companyId: input.companyId,
      status: 'ACTIVE',
      deletedAt: null,
      billingDisposition: 'CONFIGURED',
      engagementStartYearOfAssessment: { gt: input.yearOfAssessment },
      feeLines: { some: { billingTiming: 'POSTPAID', postpaidTrigger: { in: triggers }, isActive: true, deletedAt: null } },
    },
    select: { id: true, serviceName: true, engagementStartYearOfAssessment: true },
    orderBy: { serviceName: 'asc' },
  });
  return services.map((service) => ({
    clientServiceId: service.id,
    serviceName: service.serviceName,
    engagementStartYearOfAssessment: service.engagementStartYearOfAssessment!,
  }));
}

/**
 * For company filings about to be set to Filed, the ones that would raise no
 * postpaid bill because their YA is before a service's engagement start.
 */
export async function findUnbilledFilings(
  input: { tenantId: string; companyIds?: string[]; occurrenceIds: string[] },
  db: Db = prisma,
): Promise<Array<{ occurrenceId: string; services: PostpaidEngagementStartConflict[] }>> {
  if (input.occurrenceIds.length === 0) return [];
  const rows = await db.deadlineOccurrence.findMany({
    where: {
      id: { in: input.occurrenceIds },
      tenantId: input.tenantId,
      ...(input.companyIds === undefined ? {} : { companyId: { in: input.companyIds } }),
      ownershipScope: 'COMPANY',
      status: { not: 'COMPLETED' },
      obligationCode: { not: null },
      yearOfAssessment: { not: null },
    },
    select: { id: true, companyId: true, obligationCode: true, yearOfAssessment: true },
  });
  const cache = new Map<string, Promise<PostpaidEngagementStartConflict[]>>();
  const result: Array<{ occurrenceId: string; services: PostpaidEngagementStartConflict[] }> = [];
  for (const row of rows) {
    const key = `${row.companyId}|${row.obligationCode}|${row.yearOfAssessment}`;
    if (!cache.has(key)) {
      cache.set(key, findPostpaidEngagementStartConflicts({
        tenantId: input.tenantId,
        companyId: row.companyId,
        obligationCode: row.obligationCode!,
        yearOfAssessment: row.yearOfAssessment!,
      }, db));
    }
    const services = await cache.get(key)!;
    if (services.length > 0) result.push({ occurrenceId: row.id, services });
  }
  return result;
}

export type PostpaidQuantityPrompt = {
  feeLineId: string;
  clientServiceId: string;
  serviceName: string;
  description: string;
  currency: string;
  tieredPricing: TieredPricing;
};

/**
 * Tiered postpaid fee lines that filing this YA would bill and that still
 * need a quantity: no entry yet, or an Open (or reopenable) entry without one.
 */
export async function findPostpaidQuantityPrompts(
  input: { tenantId: string; companyId: string; obligationCode: string; yearOfAssessment: number },
  db: Db = prisma,
): Promise<PostpaidQuantityPrompt[]> {
  const triggers = Object.entries(POSTPAID_TRIGGER_OBLIGATIONS)
    .filter(([, codes]) => codes.includes(input.obligationCode))
    .map(([trigger]) => trigger);
  if (triggers.length === 0) return [];
  const today = currentDateInSingapore();
  const services = await db.clientService.findMany({
    where: {
      tenantId: input.tenantId,
      companyId: input.companyId,
      status: 'ACTIVE',
      deletedAt: null,
      billingDisposition: 'CONFIGURED',
      feeLines: { some: { billingTiming: 'POSTPAID', postpaidTrigger: { in: triggers }, isActive: true, deletedAt: null } },
    },
    select: {
      id: true,
      serviceName: true,
      startDate: true,
      engagementStartYearOfAssessment: true,
      feeLines: {
        where: { billingTiming: 'POSTPAID', postpaidTrigger: { in: triggers }, isActive: true, deletedAt: null },
        select: { id: true, description: true, currency: true, tieredPricing: true },
        orderBy: { displayOrder: 'asc' },
      },
    },
    orderBy: { serviceName: 'asc' },
  });
  const prompts: PostpaidQuantityPrompt[] = [];
  for (const service of services) {
    const billsThisYear = service.engagementStartYearOfAssessment != null
      ? input.yearOfAssessment >= service.engagementStartYearOfAssessment
      : service.startDate.toISOString().slice(0, 10) <= today;
    if (!billsThisYear) continue;
    for (const feeLine of service.feeLines) {
      const tieredPricing = parseTieredPricing(feeLine.tieredPricing);
      if (!tieredPricing) continue;
      const entry = await db.billingOccurrence.findFirst({
        where: {
          tenantId: input.tenantId,
          feeLineId: feeLine.id,
          billingPeriodKey: postpaidBillingPeriodKey(input.yearOfAssessment),
          generationKey: postpaidGenerationKey(feeLine.id),
        },
        select: { status: true, quantity: true, cancellationReason: true },
      });
      const needsQuantity = !entry
        || (entry.quantity == null && (entry.status === 'OPEN'
          || (entry.status === 'CANCELLED' && entry.cancellationReason === POSTPAID_UNFILED_REASON)));
      if (!needsQuantity) continue;
      prompts.push({
        feeLineId: feeLine.id,
        clientServiceId: service.id,
        serviceName: service.serviceName,
        description: feeLine.description,
        currency: feeLine.currency,
        tieredPricing,
      });
    }
  }
  return prompts;
}

export type PostpaidQuantityInput = { feeLineId: string; quantity: string };

/**
 * Record the quantities staff entered for a filed YA on its Open tiered
 * entries and bill their tier price. Run after the filing is synced; a
 * quantity for a line with no Open entry for the YA is ignored. Returns how
 * many entries changed.
 */
export async function applyPostpaidQuantities(
  input: { tenantId: string; companyId: string; yearOfAssessment: number; quantities: readonly PostpaidQuantityInput[] },
  db: Db = prisma,
): Promise<number> {
  let changed = 0;
  for (const { feeLineId, quantity } of input.quantities) {
    const entry = await db.billingOccurrence.findFirst({
      where: {
        tenantId: input.tenantId,
        companyId: input.companyId,
        feeLineId,
        billingPeriodKey: postpaidBillingPeriodKey(input.yearOfAssessment),
        generationKey: postpaidGenerationKey(feeLineId),
        status: 'OPEN',
      },
      select: { id: true, valueOverridden: true, feeLine: { select: { amount: true, tieredPricing: true } } },
    });
    if (!entry || !parseTieredPricing(entry.feeLine.tieredPricing)) continue;
    const amount = postpaidEntryAmount(entry.feeLine, quantity);
    await db.billingOccurrence.update({
      where: { id: entry.id },
      data: {
        quantity,
        baseAmount: amount,
        ...(entry.valueOverridden ? {} : { operativeAmount: amount }),
      },
    });
    changed += 1;
  }
  return changed;
}

/**
 * For company filings about to be set to Filed, the tiered postpaid fee
 * lines each would bill that need a quantity.
 */
export async function findFilingQuantityPrompts(
  input: { tenantId: string; companyIds?: string[]; occurrenceIds: string[] },
  db: Db = prisma,
): Promise<Array<{ occurrenceId: string; prompts: PostpaidQuantityPrompt[] }>> {
  if (input.occurrenceIds.length === 0) return [];
  const rows = await db.deadlineOccurrence.findMany({
    where: {
      id: { in: input.occurrenceIds },
      tenantId: input.tenantId,
      ...(input.companyIds === undefined ? {} : { companyId: { in: input.companyIds } }),
      ownershipScope: 'COMPANY',
      status: { not: 'COMPLETED' },
      obligationCode: { not: null },
      yearOfAssessment: { not: null },
    },
    select: { id: true, companyId: true, obligationCode: true, yearOfAssessment: true },
  });
  const result: Array<{ occurrenceId: string; prompts: PostpaidQuantityPrompt[] }> = [];
  const seen = new Set<string>();
  for (const row of rows) {
    // Two selected filings of one YA (ECI and Form C) bill once, so ask once.
    const prompts = (await findPostpaidQuantityPrompts({
      tenantId: input.tenantId,
      companyId: row.companyId,
      obligationCode: row.obligationCode!,
      yearOfAssessment: row.yearOfAssessment!,
    }, db)).filter((prompt) => !seen.has(`${prompt.feeLineId}|${row.yearOfAssessment}`));
    for (const prompt of prompts) seen.add(`${prompt.feeLineId}|${row.yearOfAssessment}`);
    if (prompts.length > 0) result.push({ occurrenceId: row.id, prompts });
  }
  return result;
}
