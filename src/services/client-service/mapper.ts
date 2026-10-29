import { isPostpaidGenerationKey, isPostpaidTrigger } from '@/services/billing/postpaid-triggers';
import { parseTieredPricing } from '@/services/billing/tiered-pricing';
import { Prisma } from '@/generated/prisma';
import type { BillingScheduleConfigV1 } from '@/services/billing/types';
import type { DateOnly } from '@/services/service-schedule';
import type { ClientServiceDto } from './types';

export const clientServiceInclude = {
  company: { select: { name: true, uen: true } },
  feeLines: { orderBy: [{ displayOrder: 'asc' as const }, { createdAt: 'asc' as const }] },
  deadlineRules: {
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
    include: {
      rule: {
        select: {
          id: true,
          code: true,
          name: true,
          isActive: true,
          archivedAt: true,
          currentVersionId: true,
          currentVersion: {
            select: {
              id: true,
              version: true,
              configHash: true,
              recurrence: true,
              applicability: true,
              parameterDefinitions: {
                orderBy: [{ displayOrder: 'asc' as const }, { key: 'asc' as const }],
              },
            },
          },
        },
      },
    },
  },
  agreement: {
    select: {
      status: true,
      activationStatus: true,
      generatedDocument: { select: { id: true, title: true } },
    },
  },
} satisfies Prisma.ClientServiceInclude;

export function clientServiceDetailInclude(tenantId: string) {
  return {
    ...clientServiceInclude,
    deadlineOccurrences: {
      where: { tenantId, status: 'OPEN' as const },
      orderBy: [{ operativeDueDate: 'asc' as const }, { id: 'asc' as const }],
      include: {
        cycle: {
          select: {
            ruleId: true,
            periodKey: true,
            rule: { select: { code: true, name: true } },
          },
        },
        ruleVersion: {
          select: {
            milestoneTemplates: {
              select: { milestoneKey: true, name: true },
            },
          },
        },
      },
    },
    billingOccurrences: {
      where: { tenantId, status: 'OPEN' as const },
      orderBy: [{ operativeExpectedDate: 'asc' as const }, { id: 'asc' as const }],
      include: {
        feeLine: {
          select: { description: true, billingFrequency: true, customFrequencyLabel: true, postpaidTrigger: true, tieredPricing: true },
        },
      },
    },
  } satisfies Prisma.ClientServiceInclude;
}

export const clientServiceInternalInclude = {
  // Internal archival/lineage flows intentionally retain archived fee lines;
  // public DTO mapping below filters them from normal service responses.
  ...clientServiceInclude,
} satisfies Prisma.ClientServiceInclude;

export type ClientServiceRecord = Prisma.ClientServiceGetPayload<{
  include: typeof clientServiceInclude;
}>;

export type ClientServiceDetailRecord = Prisma.ClientServiceGetPayload<{
  include: ReturnType<typeof clientServiceDetailInclude>;
}>;

export const dateOnly = (value: Date | null): string | null =>
  value ? value.toISOString().slice(0, 10) : null;

export function toClientServiceDto(service: ClientServiceRecord | ClientServiceDetailRecord): ClientServiceDto {
  const openDeadlineOccurrences = 'deadlineOccurrences' in service
    ? service.deadlineOccurrences.map((occurrence) => {
      const milestone = occurrence.ruleVersion.milestoneTemplates.find((template) => template.milestoneKey === occurrence.milestoneKey);
      return {
        id: occurrence.id,
        ruleId: occurrence.cycle.ruleId,
        ruleCode: occurrence.cycle.rule.code,
        ruleName: occurrence.cycle.rule.name,
        periodKey: occurrence.cycle.periodKey,
        milestoneKey: occurrence.milestoneKey,
        milestoneName: milestone?.name ?? occurrence.milestoneKey,
        scheduleEntryKey: occurrence.scheduleEntryKey,
        deadlineType: occurrence.deadlineType,
        calculatedDueDate: dateOnly(occurrence.calculatedDueDate)! as DateOnly,
        operativeDueDate: dateOnly(occurrence.operativeDueDate)! as DateOnly,
        origin: occurrence.origin,
        notes: occurrence.notes,
      };
    })
    : undefined;
  const openBillingOccurrences = 'billingOccurrences' in service
    ? service.billingOccurrences.map((occurrence) => ({
      id: occurrence.id,
      feeLineId: occurrence.feeLineId,
      description: occurrence.feeLine.description,
      amount: occurrence.operativeAmount.toFixed(2),
      currency: occurrence.operativeCurrency,
      billingFrequency: occurrence.feeLine.billingFrequency,
      customFrequencyLabel: occurrence.feeLine.customFrequencyLabel,
      postpaidTrigger: isPostpaidGenerationKey(occurrence.generationKey) && isPostpaidTrigger(occurrence.feeLine.postpaidTrigger)
        ? occurrence.feeLine.postpaidTrigger
        : null,
      quantity: occurrence.quantity == null ? null : occurrence.quantity.toFixed(2),
      tieredPricing: isPostpaidGenerationKey(occurrence.generationKey) ? parseTieredPricing(occurrence.feeLine.tieredPricing) : null,
      billingPeriodKey: occurrence.billingPeriodKey,
      scheduleEntryKey: occurrence.scheduleEntryKey,
      calculatedExpectedDate: dateOnly(occurrence.calculatedExpectedDate)! as DateOnly,
      operativeExpectedDate: dateOnly(occurrence.operativeExpectedDate)! as DateOnly,
      status: 'OPEN' as const,
      notes: occurrence.notes,
    }))
    : undefined;
  return {
    id: service.id,
    companyId: service.companyId,
    company: {
      name: service.company?.name ?? '',
      uen: service.company?.uen ?? null,
    },
    source: service.source,
    agreementId: service.agreementId,
    agreementItemId: service.agreementItemId,
    serviceVariantId: service.serviceVariantId,
    familyName: service.familyName,
    serviceName: service.serviceName,
    status: service.status,
    serviceCadence: service.serviceCadence,
    customCadenceLabel: service.customCadenceLabel,
    startDate: dateOnly(service.startDate)!,
    endDate: dateOnly(service.endDate),
    billingDisposition: service.billingDisposition ?? 'UNREVIEWED',
    billingNotRequiredReason: service.billingNotRequiredReason ?? null,
    fieldValues: (service.fieldValues ?? {}) as Record<string, string>,
    feeLines: service.feeLines
      .filter((fee) => fee.isActive !== false && fee.deletedAt == null)
      .map((fee) => ({
        id: fee.id,
        description: fee.description,
        amount: fee.amount.toFixed(2),
        currency: fee.currency,
        billingFrequency: fee.billingFrequency,
        customFrequencyLabel: fee.customFrequencyLabel,
        billingStartDate: dateOnly(fee.billingStartDate),
        scheduleConfig: (fee.scheduleConfig ?? null) as BillingScheduleConfigV1 | null,
        billingTiming: fee.billingTiming ?? 'PREPAID',
        postpaidTrigger: isPostpaidTrigger(fee.postpaidTrigger) ? fee.postpaidTrigger : null,
        tieredPricing: fee.billingTiming === 'POSTPAID' ? parseTieredPricing(fee.tieredPricing) : null,
        displayOrder: fee.displayOrder,
      })),
    ...(openDeadlineOccurrences ? { openDeadlineOccurrences } : {}),
    ...(openBillingOccurrences ? { openBillingOccurrences } : {}),
    deadlineRules: (service.deadlineRules ?? []).map((clientRule) => ({
      id: clientRule.id,
      ruleId: clientRule.ruleId,
      enabled: clientRule.enabled,
      parameterValues: (clientRule.parameterValues ?? {}) as Record<string, unknown>,
      parameterProvenance: (clientRule.parameterProvenance ?? {}) as Record<string, 'COMPANY' | 'CATALOG_DEFAULT' | 'CLIENT_OVERRIDE'>,
      scheduleEntries: (Array.isArray(clientRule.scheduleEntries) ? clientRule.scheduleEntries : []) as ClientServiceDto['deadlineRules'][number]['scheduleEntries'],
      lastEvaluatedVersionId: clientRule.lastEvaluatedVersionId,
      applicabilityState: clientRule.applicabilityState,
      applicabilityReason: clientRule.applicabilityReason,
      configHash: clientRule.configHash,
      updatedAt: clientRule.updatedAt.toISOString(),
      rule: clientRule.rule ? {
        id: clientRule.rule.id,
        code: clientRule.rule.code,
        name: clientRule.rule.name,
        isActive: clientRule.rule.isActive,
        archivedAt: dateOnly(clientRule.rule.archivedAt),
        currentVersionId: clientRule.rule.currentVersionId,
        currentVersion: clientRule.rule.currentVersion ? {
          id: clientRule.rule.currentVersion.id,
          version: clientRule.rule.currentVersion.version,
          configHash: clientRule.rule.currentVersion.configHash,
          recurrence: clientRule.rule.currentVersion.recurrence,
          applicability: clientRule.rule.currentVersion.applicability,
          parameters: clientRule.rule.currentVersion.parameterDefinitions.map((parameter) => ({
            key: parameter.key,
            label: parameter.label,
            description: parameter.helpText ?? null,
            type: parameter.type,
            required: parameter.isRequired,
            defaultValue: parameter.defaultValue,
            validation: parameter.validation,
            helpText: parameter.helpText,
            displayOrder: parameter.displayOrder,
          })),
        } : null,
      } : null,
    })),
    agreement: service.agreement && service.agreement.generatedDocument ? {
      title: service.agreement.generatedDocument.title,
      status: service.agreement.status,
      activationStatus: service.agreement.activationStatus,
      generatedDocumentId: service.agreement.generatedDocument.id,
      href: `/generated-documents/${service.agreement.generatedDocument.id}`,
    } : null,
    createdAt: service.createdAt.toISOString(),
    updatedAt: service.updatedAt.toISOString(),
  };
}
