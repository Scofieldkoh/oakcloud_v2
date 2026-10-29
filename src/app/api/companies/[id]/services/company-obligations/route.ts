import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { createErrorResponse, requireSessionWorkspaceId } from '@/lib/api-helpers';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/rbac';
import { MONITORING_PROFILES } from '@/services/compliance-monitoring/catalog';
import { previewCompanyObligations } from '@/services/compliance-monitoring/writer';
import { setCompanyObligationStatus } from '@/services/compliance-monitoring/obligation-status';
import { setEngagementStartYearOfAssessment } from '@/services/compliance-monitoring/engagement-start';
import { companyObligationStatusEntrySchema, engagementStartYearOfAssessmentSchema } from '@/lib/validations/client-service';
import { ValidationError } from '@/lib/errors';
import { currentDateInSingapore } from '@/services/service-schedule';
import type { DateOnly } from '@/services/service-schedule';

const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const querySchema = z.object({
  profiles: z.array(z.enum(MONITORING_PROFILES as [string, ...string[]])).max(MONITORING_PROFILES.length),
  start: dateOnlySchema.optional(),
  end: dateOnlySchema.optional(),
  serviceId: z.string().uuid().optional(),
  fromYa: z.coerce.number().int().optional(),
}).strict();

/**
 * The company's statutory obligations (ECI, Form C) as the company writer
 * projects them. `profiles` and `start` add the coverage a service being added
 * would start. With `serviceId`, obligations show only when that service
 * started company monitoring.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    await requirePermission(session, 'company', 'read', id);
    const tenantId = requireSessionWorkspaceId(session);
    const { searchParams } = new URL(request.url);
    const query = querySchema.parse({
      profiles: (searchParams.get('profiles') ?? '').split(',').filter(Boolean),
      start: searchParams.get('start') ?? undefined,
      end: searchParams.get('end') ?? undefined,
      serviceId: searchParams.get('serviceId') ?? undefined,
      fromYa: searchParams.get('fromYa') ?? undefined,
    });
    if (query.serviceId) {
      const coverage = await prisma.companyMonitoringCoverage.findFirst({
        where: { tenantId, companyId: id, clientServiceId: query.serviceId },
        select: { id: true },
      });
      if (!coverage) return NextResponse.json({ items: [], notices: [], engagementStartYearOfAssessment: null });
    }
    const preview = await previewCompanyObligations({
      tenantId,
      companyId: id,
      today: currentDateInSingapore(),
      serviceId: query.serviceId,
      ...(query.profiles.length > 0 ? {
        proposedCoverage: {
          profiles: query.profiles,
          monitoringStart: (query.start ?? null) as DateOnly | null,
          monitoringEnd: (query.end ?? null) as DateOnly | null,
          engagementStartYearOfAssessment: query.fromYa ?? null,
        },
      } : {}),
    });
    return NextResponse.json(preview);
  } catch (error) {
    return createErrorResponse(error);
  }
}

/** Record a staff filing status on a stored company obligation period. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    await requirePermission(session, 'company', 'update', id);
    const tenantId = requireSessionWorkspaceId(session);
    const input = companyObligationStatusEntrySchema.parse(await request.json());
    const changed = await prisma.$transaction((tx) => setCompanyObligationStatus({
      tenantId,
      companyId: id,
      obligationCode: input.obligationCode,
      periodKey: input.periodKey,
      status: input.status,
      actorId: session.id,
      billingQuantities: input.billingQuantities,
    }, tx));
    if (changed === 0) {
      const exists = await prisma.deadlineOccurrence.count({
        where: { tenantId, companyId: id, ownershipScope: 'COMPANY', obligationCode: input.obligationCode, obligationPeriodKey: input.periodKey },
      });
      if (exists === 0) throw new ValidationError('This deadline has not been created yet. Turn on company monitoring, then try again.');
    }
    return NextResponse.json({ changed });
  } catch (error) {
    return createErrorResponse(error);
  }
}

/** Set the first Year of Assessment an existing service files. */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    await requirePermission(session, 'company', 'update', id);
    const tenantId = requireSessionWorkspaceId(session);
    const input = engagementStartYearOfAssessmentSchema.parse(await request.json());
    const result = await setEngagementStartYearOfAssessment({
      tenantId,
      companyId: id,
      clientServiceId: input.serviceId,
      yearOfAssessment: input.yearOfAssessment,
      actorId: session.id,
    });
    return NextResponse.json(result);
  } catch (error) {
    return createErrorResponse(error);
  }
}
