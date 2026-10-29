import { prisma } from '@/lib/prisma';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { createAuditLog } from '@/lib/audit';
import { enqueueScheduleReconciliation } from '@/services/schedule-reconciliation/queue';
import { syncPostpaidBilling } from '@/services/billing/postpaid';
import { isMonitoringProfile, obligationsForProfiles } from './catalog';

/**
 * The first Year of Assessment a service engagement files. Company obligations
 * from that YA are projected as Pending filing and earlier ones as To be
 * confirmed. Changing it hands open Pending filing and To be confirmed choices
 * back to the projection, so the new start applies to every row; Filed, Not
 * required and Managed externally choices are kept.
 */

export const MIN_ENGAGEMENT_YEAR_OF_ASSESSMENT = 2000;
export const MAX_ENGAGEMENT_YEAR_OF_ASSESSMENT = 2100;

export async function setEngagementStartYearOfAssessment(params: {
  tenantId: string;
  companyId: string;
  clientServiceId: string;
  yearOfAssessment: number | null;
  actorId: string | null;
}) {
  const { tenantId, companyId, clientServiceId, yearOfAssessment } = params;
  if (yearOfAssessment !== null && (
    !Number.isInteger(yearOfAssessment)
    || yearOfAssessment < MIN_ENGAGEMENT_YEAR_OF_ASSESSMENT
    || yearOfAssessment > MAX_ENGAGEMENT_YEAR_OF_ASSESSMENT
  )) {
    throw new ValidationError('Choose a valid Year of Assessment.');
  }

  return prisma.$transaction(async (tx) => {
    const service = await tx.clientService.findFirst({
      where: { id: clientServiceId, tenantId, companyId, deletedAt: null },
      select: {
        id: true,
        serviceName: true,
        updatedAt: true,
        engagementStartYearOfAssessment: true,
        monitoringCoverages: { select: { profile: true } },
      },
    });
    if (!service) throw new NotFoundError('Service not found');
    if (service.engagementStartYearOfAssessment === yearOfAssessment) {
      return { engagementStartYearOfAssessment: yearOfAssessment, released: 0 };
    }

    // Keep updatedAt so an open service editor can still save its own edits.
    await tx.clientService.update({
      where: { id: service.id },
      data: { engagementStartYearOfAssessment: yearOfAssessment, updatedAt: service.updatedAt },
    });

    const profiles = service.monitoringCoverages.map((coverage) => coverage.profile).filter(isMonitoringProfile);
    const codes = obligationsForProfiles(profiles).map((definition) => definition.code);
    const released = codes.length === 0 ? { count: 0 } : await tx.deadlineOccurrence.updateMany({
      where: {
        tenantId,
        companyId,
        ownershipScope: 'COMPANY',
        obligationCode: { in: codes },
        status: 'OPEN',
        responsibilitySource: 'STAFF',
        filingResponsibility: { in: ['OAKCLOUD', 'UNCONFIRMED'] },
      },
      data: { responsibilitySource: 'PROJECTED' },
    });

    // Postpaid fees bill from the engagement start YA, so re-sync them.
    await syncPostpaidBilling({ tenantId, companyId, clientServiceId: service.id, cancelledById: params.actorId }, tx);

    const now = new Date();
    await enqueueScheduleReconciliation(tx, {
      tenantId,
      scopeType: 'COMPANY',
      scopeId: companyId,
      triggerType: 'COMPANY_SOURCE_CHANGED',
      correlationId: `engagement-start-${service.id}-${now.getTime()}`,
      requestedById: params.actorId,
    });

    await createAuditLog({
      tenantId,
      userId: params.actorId ?? undefined,
      companyId,
      entityType: 'ClientService',
      entityId: service.id,
      entityName: service.serviceName,
      action: 'UPDATE',
      changeSource: 'MANUAL',
      changes: {
        engagementStartYearOfAssessment: {
          old: service.engagementStartYearOfAssessment,
          new: yearOfAssessment,
        },
      },
    }, tx);

    return { engagementStartYearOfAssessment: yearOfAssessment, released: released.count };
  });
}
