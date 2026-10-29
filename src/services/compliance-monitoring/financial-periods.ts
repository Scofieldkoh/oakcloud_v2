import { prisma } from '@/lib/prisma';
import type { Prisma } from '@/generated/prisma';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { createAuditLog } from '@/lib/audit';
import { compareDateOnly, parseDateOnly } from '@/services/service-schedule/date-only';
import { financialYearEndInYear, normalYearOfAssessment } from '@/services/service-schedule/obligation-periods';
import type { DateOnly } from '@/services/service-schedule';
import { enqueueScheduleReconciliation } from '@/services/schedule-reconciliation/queue';

/**
 * Staff-confirmed financial periods. Confirming the first period after
 * incorporation (which may run longer than 12 months) and its Year of
 * Assessment replaces the provisional derived periods it overlaps, so company
 * tax deadlines stop needing review.
 */

export type FirstFinancialPeriodSuggestion = {
  periodStart: DateOnly;
  periodEnd: DateOnly;
  yearOfAssessment: number;
};

function toDateOnly(value: Date | null | undefined): DateOnly | null {
  return value ? value.toISOString().slice(0, 10) as DateOnly : null;
}

/** First FYE on or after incorporation, as a starting point staff can change. */
export function suggestFirstFinancialPeriod(company: {
  incorporationDate: Date | string | null;
  financialYearEndMonth: number | null;
  financialYearEndDay: number | null;
}): FirstFinancialPeriodSuggestion | null {
  const incorporation = typeof company.incorporationDate === 'string'
    ? company.incorporationDate.slice(0, 10) as DateOnly
    : toDateOnly(company.incorporationDate);
  const month = company.financialYearEndMonth;
  const day = company.financialYearEndDay;
  if (!incorporation || !month || !day) return null;
  const year = Number(incorporation.slice(0, 4));
  let end = financialYearEndInYear(year, month, day);
  if (compareDateOnly(end, incorporation) < 0) end = financialYearEndInYear(year + 1, month, day);
  return { periodStart: incorporation, periodEnd: end, yearOfAssessment: normalYearOfAssessment(end) };
}

export type ConfirmFinancialPeriodInput = {
  periodStart: DateOnly;
  periodEnd: DateOnly;
  yearOfAssessment: number;
};

/** Dates in order, at most 18 months, and a YA of the end year or the year after. */
export function validateFinancialPeriodInput(input: ConfirmFinancialPeriodInput): void {
  parseDateOnly(input.periodStart);
  parseDateOnly(input.periodEnd);
  if (compareDateOnly(input.periodEnd, input.periodStart) <= 0) {
    throw new ValidationError('The first financial year end must be after the incorporation date.');
  }
  const months = (Number(input.periodEnd.slice(0, 4)) - Number(input.periodStart.slice(0, 4))) * 12
    + Number(input.periodEnd.slice(5, 7)) - Number(input.periodStart.slice(5, 7));
  if (months > 18) {
    throw new ValidationError('The first financial year end must be within 18 months of incorporation.');
  }
  const endYear = Number(input.periodEnd.slice(0, 4));
  if (!Number.isInteger(input.yearOfAssessment) || input.yearOfAssessment < endYear || input.yearOfAssessment > endYear + 1) {
    throw new ValidationError(`The Year of Assessment for a period ending in ${endYear} must be ${endYear} or ${endYear + 1}.`);
  }
}

/**
 * Replace (or, with null, remove) the company's first confirmed financial
 * period from the company Compliance section. Runs inside the caller's
 * transaction; the caller queues company reconciliation.
 */
export async function saveFirstFinancialPeriod(
  tx: Prisma.TransactionClient,
  params: { tenantId: string; companyId: string; userId: string | null },
  input: ConfirmFinancialPeriodInput | null,
): Promise<void> {
  const first = await tx.companyFinancialPeriod.findFirst({
    where: { tenantId: params.tenantId, companyId: params.companyId, provenance: 'CONFIRMED' },
    orderBy: { periodEnd: 'asc' },
    select: { id: true },
  });
  if (!input) {
    if (first) await tx.companyFinancialPeriod.delete({ where: { id: first.id } });
    return;
  }
  validateFinancialPeriodInput(input);
  const start = new Date(`${input.periodStart}T00:00:00.000Z`);
  const end = new Date(`${input.periodEnd}T00:00:00.000Z`);
  const overlapping = await tx.companyFinancialPeriod.findFirst({
    where: {
      tenantId: params.tenantId,
      companyId: params.companyId,
      periodStart: { lte: end },
      periodEnd: { gte: start },
      ...(first ? { NOT: { id: first.id } } : {}),
    },
    select: { periodStart: true, periodEnd: true },
  });
  if (overlapping) {
    throw new ValidationError(
      `The first financial period overlaps the confirmed period ${toDateOnly(overlapping.periodStart)} to ${toDateOnly(overlapping.periodEnd)}.`,
    );
  }
  const data = {
    periodStart: start,
    periodEnd: end,
    yearsOfAssessment: [input.yearOfAssessment],
    provenance: 'CONFIRMED' as const,
    confirmedAt: new Date(),
    confirmedById: params.userId,
  };
  if (first) await tx.companyFinancialPeriod.update({ where: { id: first.id }, data });
  else await tx.companyFinancialPeriod.create({ data: { tenantId: params.tenantId, companyId: params.companyId, ...data } });
}

/**
 * Record the company's first financial year end. The first period runs from
 * incorporation to that date (it may exceed 12 months) and its YA is the
 * following year, so incomplete earlier years drop out of the obligations.
 */
export async function confirmFirstFinancialYearEnd(
  params: { tenantId: string; companyId: string; userId: string | null },
  firstFinancialYearEnd: DateOnly,
) {
  parseDateOnly(firstFinancialYearEnd);
  return prisma.$transaction(async (tx) => {
    const company = await tx.company.findFirst({
      where: { id: params.companyId, tenantId: params.tenantId, deletedAt: null },
      select: { id: true, name: true, incorporationDate: true },
    });
    if (!company) throw new NotFoundError('Company not found');
    const incorporation = toDateOnly(company.incorporationDate);
    if (!incorporation) throw new ValidationError('Record the incorporation date before the first financial year end.');

    const yearOfAssessment = normalYearOfAssessment(firstFinancialYearEnd);
    await saveFirstFinancialPeriod(tx, params, {
      periodStart: incorporation,
      periodEnd: firstFinancialYearEnd,
      yearOfAssessment,
    });

    const now = new Date();
    await enqueueScheduleReconciliation(tx, {
      tenantId: params.tenantId,
      scopeType: 'COMPANY',
      scopeId: params.companyId,
      triggerType: 'COMPANY_SOURCE_CHANGED',
      correlationId: `first-fye-${params.companyId}-${now.getTime()}`,
      requestedById: params.userId,
    });

    await createAuditLog({
      tenantId: params.tenantId,
      userId: params.userId ?? undefined,
      companyId: params.companyId,
      entityType: 'Company',
      entityId: params.companyId,
      entityName: company.name,
      action: 'UPDATE',
      changeSource: 'MANUAL',
      changes: { firstFinancialYearEnd: { old: null, new: firstFinancialYearEnd } },
    }, tx);

    return { firstFinancialYearEnd, yearOfAssessment };
  });
}
