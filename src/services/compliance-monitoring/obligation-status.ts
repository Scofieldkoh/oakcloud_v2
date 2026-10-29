import { prisma } from '@/lib/prisma';
import type { Prisma } from '@/generated/prisma';
import { ValidationError } from '@/lib/errors';
import { applyPostpaidQuantities, syncPostpaidBilling, type PostpaidQuantityInput } from '@/services/billing/postpaid';
import {
  COMPANY_OBLIGATION_STATUS_LABELS,
  companyObligationStatusOf,
  isCompanyObligationStatus,
  type CompanyObligationStatus,
} from './obligation-status-labels';

export {
  COMPANY_OBLIGATION_STATUSES,
  COMPANY_OBLIGATION_STATUS_LABELS,
  companyObligationStatusOf,
  isCompanyObligationStatus,
  type CompanyObligationStatus,
} from './obligation-status-labels';

/**
 * Staff-facing filing status for a company obligation period. Each choice maps
 * onto the stored occurrence status and filing responsibility, so the writer
 * keeps it: STAFF responsibility is never replaced by a projection, and
 * completed or waived rows are preserved. Postpaid billing entries follow
 * the Filed status (see billing/postpaid).
 */

type Db = Prisma.TransactionClient | typeof prisma;

const RESPONSIBILITY_FOR: Partial<Record<CompanyObligationStatus, 'OAKCLOUD' | 'EXTERNAL_PROVIDER' | 'UNCONFIRMED'>> = {
  TO_BE_CONFIRMED: 'UNCONFIRMED',
  PENDING_FILING: 'OAKCLOUD',
  MANAGED_EXTERNALLY: 'EXTERNAL_PROVIDER',
};

export type SetCompanyObligationStatusInput = {
  tenantId: string;
  companyId: string;
  obligationCode: string;
  periodKey: string;
  status: CompanyObligationStatus;
  actorId: string | null;
  /** With Filed: quantities for the tiered postpaid fees it bills. */
  billingQuantities?: readonly PostpaidQuantityInput[];
};

/**
 * Record a staff status on every stored occurrence of one company obligation
 * period. Returns how many occurrences changed; zero when the writer has not
 * created that period yet.
 */
export async function setCompanyObligationStatus(
  input: SetCompanyObligationStatusInput,
  db: Db = prisma,
): Promise<number> {
  if (!isCompanyObligationStatus(input.status)) throw new ValidationError('Unknown filing status');
  const occurrences = await db.deadlineOccurrence.findMany({
    where: {
      tenantId: input.tenantId,
      companyId: input.companyId,
      ownershipScope: 'COMPANY',
      obligationCode: input.obligationCode,
      obligationPeriodKey: input.periodKey,
      status: { not: 'CANCELLED' },
    },
    select: { id: true, status: true, filingResponsibility: true, completedAt: true, yearOfAssessment: true },
  });
  const now = new Date();
  let changed = 0;
  for (const occurrence of occurrences) {
    if (companyObligationStatusOf(occurrence) === input.status) continue;
    const data: Prisma.DeadlineOccurrenceUncheckedUpdateInput = {};
    if (input.status === 'FILED') {
      Object.assign(data, {
        status: 'COMPLETED',
        completedAt: occurrence.completedAt ?? now,
        completedById: input.actorId,
        waivedAt: null,
        waivedById: null,
        waiverReason: null,
        filingStatusUnconfirmed: false,
      });
    } else if (input.status === 'NOT_REQUIRED') {
      Object.assign(data, {
        status: 'WAIVED',
        waivedAt: now,
        waivedById: input.actorId,
        waiverReason: 'Marked not required by staff',
        completedAt: null,
        completedById: null,
        filingStatusUnconfirmed: false,
      });
    } else {
      Object.assign(data, {
        status: 'OPEN',
        completedAt: null,
        completedById: null,
        waivedAt: null,
        waivedById: null,
        waiverReason: null,
      });
    }

    const responsibility = RESPONSIBILITY_FOR[input.status];
    if (responsibility && responsibility !== occurrence.filingResponsibility) {
      Object.assign(data, {
        filingResponsibility: responsibility,
        responsibilitySource: 'STAFF',
        responsibilityConfirmedAt: responsibility === 'UNCONFIRMED' ? null : now,
        responsibilityConfirmedById: responsibility === 'UNCONFIRMED' ? null : input.actorId,
      });
      await db.deadlineResponsibilityChange.create({
        data: {
          tenantId: input.tenantId,
          occurrenceId: occurrence.id,
          previousResponsibility: (occurrence.filingResponsibility ?? null) as never,
          newResponsibility: responsibility,
          source: 'STAFF',
          actorId: input.actorId,
          reason: `Filing status set to ${COMPANY_OBLIGATION_STATUS_LABELS[input.status]}`,
        },
      });
    }
    await db.deadlineOccurrence.update({ where: { id: occurrence.id }, data });
    changed += 1;
  }
  // Postpaid fees pegged to this filing bill (or stop billing) with it.
  if (changed > 0) {
    await syncPostpaidBilling({ tenantId: input.tenantId, companyId: input.companyId, cancelledById: input.actorId }, db);
  }
  const yearOfAssessment = occurrences.find((occurrence) => occurrence.yearOfAssessment != null)?.yearOfAssessment;
  if (input.status === 'FILED' && input.billingQuantities?.length && yearOfAssessment != null) {
    await applyPostpaidQuantities({
      tenantId: input.tenantId,
      companyId: input.companyId,
      yearOfAssessment,
      quantities: input.billingQuantities,
    }, db);
  }
  return changed;
}
