import { randomUUID } from 'node:crypto';
import { createAuditLog } from '@/lib/audit';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { createMonitoringForActivatedService } from '@/services/compliance-monitoring/coverage';
import { reconcileCompanyObligations } from '@/services/compliance-monitoring/writer';
import { setCompanyObligationStatus } from '@/services/compliance-monitoring/obligation-status';
import { getServiceWorkspaceFlagsForTenant } from '@/services/schedule-reconciliation/settings';
import { currentDateInSingapore } from '@/services/service-schedule/date-only';
import { isSerializationConflict, runSerializableTransaction } from '@/lib/prisma-transaction';
import type { TenantAwareParams } from '@/lib/types';
import type { ClientServiceDeadlineRuleInput, CreateManualClientServiceInput, CreateManualClientServiceRequest } from '@/lib/validations/client-service';
import { Prisma } from '@/generated/prisma';
import type { BillingDisposition } from '@/generated/prisma';
import { ClientServiceWriteConflictError, DuplicateClientServiceError } from './errors';
import { snapshotClientServiceFees, summarizeClientServiceFees } from './fee-summary';
import { clientServiceInclude, dateOnly, toClientServiceDto } from './mapper';
import {
  enqueueScheduleReconciliation,
  processScheduleReconciliationBatch,
} from '@/services/schedule-reconciliation';
import { assertConfiguredBillingState, canonicalizeBillingSchedule } from '@/services/billing/schedule';
import { canonicalDeadlineRuleAudit, persistClientServiceDeadlineRules, validateClientServiceDeadlineRules } from './service';

const parseDateOnly = (value: string): Date => new Date(`${value}T00:00:00.000Z`);

function scheduleConfigForFee(
  fee: CreateManualClientServiceInput['feeLines'][number],
  requireMaterializable: boolean,
) {
  // Postpaid lines bill on a filing and carry no schedule.
  if (fee.billingTiming === 'POSTPAID') return null;
  return canonicalizeBillingSchedule({
    billingFrequency: fee.billingFrequency,
    billingStartDate: fee.billingStartDate,
    customFrequencyLabel: fee.customFrequencyLabel,
    scheduleConfig: fee.scheduleConfig,
  }, { requireMaterializable });
}

export async function createManualClientService(
  companyId: string,
  rawInput: CreateManualClientServiceRequest | CreateManualClientServiceInput,
  params: TenantAwareParams,
) {
  // API callers pass the parsed schema output, while older service callers may
  // still omit the billing fields. Normalize the compatibility shape here
  // without re-validating identifiers that are intentionally stubbed in unit
  // tests and trusted at this service boundary.
  const input: CreateManualClientServiceInput = {
    ...rawInput,
    status: rawInput.status ?? 'ACTIVE',
    customCadenceLabel: rawInput.customCadenceLabel ?? null,
    endDate: rawInput.endDate ?? null,
    fieldValues: rawInput.fieldValues ?? {},
    billingDisposition: (rawInput.billingDisposition ?? 'UNREVIEWED') as CreateManualClientServiceInput['billingDisposition'],
    billingNotRequiredReason: rawInput.billingDisposition === 'NOT_REQUIRED' ? rawInput.billingNotRequiredReason ?? null : null,
    feeLines: rawInput.feeLines.map((fee) => ({
      ...fee,
      customFrequencyLabel: fee.billingFrequency === 'CUSTOM' ? fee.customFrequencyLabel ?? null : null,
      billingStartDate: fee.billingStartDate ?? fee.scheduleConfig?.startDate ?? null,
      billingTiming: fee.billingTiming ?? 'PREPAID',
      postpaidTrigger: fee.billingTiming === 'POSTPAID' ? fee.postpaidTrigger ?? null : null,
      tieredPricing: fee.billingTiming === 'POSTPAID' ? fee.tieredPricing ?? null : null,
    })),
    confirmDuplicate: rawInput.confirmDuplicate ?? false,
  } as CreateManualClientServiceInput;

  const rawFeeLines = rawInput.feeLines as Array<Record<string, unknown>>;
  if (rawFeeLines.some((fee) => Object.prototype.hasOwnProperty.call(fee, 'isActive'))) {
    throw new ValidationError('Manual fee lines cannot specify lifecycle state');
  }
  if (input.billingDisposition === 'NOT_REQUIRED' && input.feeLines.length > 0) {
    throw new ValidationError('Not-required billing fee lines must be empty');
  }
  if (input.billingDisposition !== 'NOT_REQUIRED' && rawInput.billingNotRequiredReason != null) {
    throw new ValidationError('A not-required reason is only valid when billing is not required');
  }
  if (input.billingDisposition === 'CONFIGURED' && input.feeLines.length === 0) {
    throw new ValidationError('Configured billing requires at least one fee line');
  }
  const preparedFees = input.feeLines.map((fee) => {
    const scheduleConfig = scheduleConfigForFee(fee, input.billingDisposition === 'CONFIGURED');
    return {
      ...fee,
      billingStartDate: fee.billingStartDate ?? scheduleConfig?.startDate ?? null,
      scheduleConfig,
    };
  });
  assertConfiguredBillingState({
    billingDisposition: input.billingDisposition,
    feeLines: preparedFees,
  });
  try {
    const createdDto = await runSerializableTransaction(prisma, async (tx) => {
      const company = await tx.company.findFirst({
        where: { id: companyId, tenantId: params.tenantId, deletedAt: null },
        select: {
          id: true,
          entityType: true,
          status: true,
          primarySsicCode: true,
          secondarySsicCode: true,
          uen: true,
          name: true,
          financialYearEndDay: true,
          financialYearEndMonth: true,
          incorporationDate: true,
          registrationDate: true,
          accountsDueDate: true,
          hasCharges: true,
          currentOfficerCount: true,
          currentShareholderCount: true,
          annualReceiptsOrExpenditure: true,
          isGstRegistered: true,
          isRegisteredCharity: true,
          isIPC: true,
        },
      });
      if (!company) throw new NotFoundError('Company not found');

      const variant = await tx.serviceVariant.findFirst({
        where: {
          id: input.serviceVariantId,
          tenantId: params.tenantId,
          deletedAt: null,
          isActive: true,
          family: { tenantId: params.tenantId, deletedAt: null, isActive: true },
          sowPartial: { tenantId: params.tenantId, deletedAt: null },
        },
        select: { id: true, name: true, family: { select: { name: true } } },
      });
      if (!variant) throw new NotFoundError('Service variant not found');

      const duplicateWhere: Prisma.ClientServiceWhereInput = {
        tenantId: params.tenantId,
        companyId,
        serviceVariantId: input.serviceVariantId,
        startDate: parseDateOnly(input.startDate),
        deletedAt: null,
      };

      if (!input.confirmDuplicate) {
        const [total, matches] = await Promise.all([
          tx.clientService.count({ where: duplicateWhere }),
          tx.clientService.findMany({
            where: duplicateWhere,
            select: { id: true, serviceName: true, startDate: true, status: true, source: true },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 5,
          }),
        ]);
        if (total > 0) {
          throw new DuplicateClientServiceError({
            total,
            items: matches.map((match) => ({ ...match, startDate: dateOnly(match.startDate)! })),
          });
        }
      }

      const service = await tx.clientService.create({
        data: {
          tenantId: params.tenantId,
          companyId,
          source: 'MANUAL',
          agreementId: null,
          agreementItemId: null,
          serviceVariantId: variant.id,
          familyName: variant.family.name,
          serviceName: variant.name,
          status: input.status,
          serviceCadence: input.serviceCadence,
          customCadenceLabel: input.customCadenceLabel,
          startDate: parseDateOnly(input.startDate),
          endDate: input.endDate ? parseDateOnly(input.endDate) : null,
          fieldValues: input.fieldValues as Prisma.InputJsonValue,
          billingDisposition: input.billingDisposition as BillingDisposition,
          billingNotRequiredReason: input.billingDisposition === 'NOT_REQUIRED' ? input.billingNotRequiredReason : null,
          engagementStartYearOfAssessment: input.engagementStartYearOfAssessment ?? null,
        },
      });

      const feeRows = preparedFees.map((fee, displayOrder) => ({ ...fee, id: randomUUID(), displayOrder }));
      if (feeRows.length > 0) {
        await tx.clientServiceFeeLine.createMany({
          data: feeRows.map((fee) => ({
            tenantId: params.tenantId,
            clientServiceId: service.id,
            sourceAgreementFeeLineId: null,
            description: fee.description,
            amount: new Prisma.Decimal(fee.amount),
            currency: fee.currency,
            billingFrequency: fee.billingFrequency,
            customFrequencyLabel: fee.customFrequencyLabel,
            billingStartDate: fee.billingStartDate ? parseDateOnly(fee.billingStartDate) : null,
            scheduleConfig: fee.scheduleConfig ?? Prisma.JsonNull,
            billingTiming: fee.billingTiming,
            postpaidTrigger: fee.postpaidTrigger,
            tieredPricing: fee.tieredPricing ?? Prisma.JsonNull,
            isActive: true,
            displayOrder: fee.displayOrder,
          })),
        });
      }

      const feeSummary = summarizeClientServiceFees(preparedFees);
      const feeAuditSnapshot = snapshotClientServiceFees(feeRows);

      let deadlineRuleValidation;
      if (input.deadlineRules !== undefined) {
        deadlineRuleValidation = await validateClientServiceDeadlineRules(
          tx,
          { tenantId: params.tenantId, serviceVariantId: variant.id, companyId },
          input.deadlineRules,
          company,
        );
        await persistClientServiceDeadlineRules(tx, {
          tenantId: params.tenantId,
          clientServiceId: service.id,
          userId: params.userId,
        }, deadlineRuleValidation);
      }

      const variantRules = input.deadlineRules === undefined && tx.serviceVariantDeadlineRule?.findMany
        ? await tx.serviceVariantDeadlineRule.findMany({
            where: {
              serviceVariantId: variant.id,
              tenantId: params.tenantId,
              enabledByDefault: true,
              archivedAt: null,
              rule: {
                tenantId: params.tenantId,
                isActive: true,
                archivedAt: null,
                currentVersionId: { not: null },
              },
            },
            select: {
              ruleId: true,
              enabledByDefault: true,
              parameterDefaults: true,
              scheduleDefaults: true,
              rule: {
                select: {
                  id: true,
                  isActive: true,
                  archivedAt: true,
                  currentVersionId: true,
                  currentVersion: {
                    select: {
                      id: true,
                      state: true,
                      configHash: true,
                      recurrence: true,
                      applicability: true,
                      parameterDefinitions: true,
                      milestoneTemplates: true,
                    },
                  },
                },
              },
            },
          })
        : [];

      const enabledVariantRules = variantRules.filter((variantRule) => variantRule.enabledByDefault !== false);
      if (input.deadlineRules === undefined && enabledVariantRules.length > 0) {
        const defaultInputs = enabledVariantRules.map((vr) => {
          const parameterValues = (vr.parameterDefaults && typeof vr.parameterDefaults === 'object' && !Array.isArray(vr.parameterDefaults))
            ? vr.parameterDefaults as Record<string, unknown>
            : {};
          return {
            ruleId: vr.ruleId,
            enabled: true,
            parameterValues,
            parameterProvenance: Object.fromEntries(Object.keys(parameterValues).map((key) => [key, 'CATALOG_DEFAULT' as const])),
            scheduleEntries: (Array.isArray(vr.scheduleDefaults) ? vr.scheduleDefaults : []),
          };
        });
        deadlineRuleValidation = await validateClientServiceDeadlineRules(
          tx,
          { tenantId: params.tenantId, serviceVariantId: variant.id, companyId },
          defaultInputs as ClientServiceDeadlineRuleInput[],
          company,
        );
        await persistClientServiceDeadlineRules(tx, {
          tenantId: params.tenantId,
          clientServiceId: service.id,
          userId: params.userId,
        }, deadlineRuleValidation);
      }

      // Manual onboarding has no agreement date: coverage starts provisionally
      // at the service start and raises a review item to confirm it.
      await createMonitoringForActivatedService(tx, {
        tenantId: params.tenantId,
        companyId,
        clientServiceId: service.id,
        serviceVariantId: variant.id,
        agreementId: null,
        agreementDate: null,
        serviceStartDate: service.startDate,
        serviceEndDate: service.endDate,
        fieldValues: input.fieldValues,
        actorId: params.userId ?? null,
      });

      // Statuses recorded while adding need the company obligations to exist,
      // so write this company's obligations now when writes are enabled.
      const obligationStatuses = input.companyObligationStatuses ?? [];
      if (obligationStatuses.length > 0) {
        const flags = await getServiceWorkspaceFlagsForTenant(params.tenantId, tx);
        if (!flags.companyMonitoringWritesEnabled) {
          throw new ValidationError('Turn on company monitoring before recording filing statuses.');
        }
        await reconcileCompanyObligations({
          tenantId: params.tenantId,
          companyId,
          today: currentDateInSingapore(),
          writeMode: 'APPLY',
        }, tx);
        for (const entry of obligationStatuses) {
          await setCompanyObligationStatus({
            tenantId: params.tenantId,
            companyId,
            obligationCode: entry.obligationCode,
            periodKey: entry.periodKey,
            status: entry.status,
            actorId: params.userId ?? null,
          }, tx);
        }
      }

      const reconciliationCorrelationId = `manual-service-${service.id}-${Date.now()}`;
      await enqueueScheduleReconciliation(tx, {
        tenantId: params.tenantId,
        scopeType: 'CLIENT_SERVICE',
        scopeId: service.id,
        triggerType: 'CLIENT_SERVICE_CREATED',
        correlationId: reconciliationCorrelationId,
        requestedById: params.userId ?? null,
      });

      await createAuditLog({
        tenantId: params.tenantId,
        userId: params.userId,
        companyId,
        entityType: 'ClientService',
        entityId: service.id,
        entityName: variant.name,
        action: 'CREATE',
        changeSource: 'MANUAL',
        changes: {
          source: { old: null, new: 'MANUAL' },
          serviceVariantId: { old: null, new: variant.id },
          billingDisposition: { old: null, new: input.billingDisposition },
          ...(input.billingDisposition === 'NOT_REQUIRED' ? {
            billingNotRequiredReason: { old: null, new: input.billingNotRequiredReason },
          } : {}),
          feeLines: {
            old: { summary: { count: 0, totals: {} }, snapshot: snapshotClientServiceFees([]) },
            new: { summary: feeSummary, snapshot: feeAuditSnapshot },
          },
          deadlineRules: { old: canonicalDeadlineRuleAudit(undefined), new: canonicalDeadlineRuleAudit(deadlineRuleValidation) },
          reconciliationCorrelationId: { old: null, new: reconciliationCorrelationId },
          duplicateConfirmed: { old: false, new: input.confirmDuplicate },
        },
        summary: `Added manual operational service with ${feeSummary.count} fee line(s)`,
      }, tx);

      const created = await tx.clientService.findFirst({
        where: { id: service.id, tenantId: params.tenantId, deletedAt: null },
        include: clientServiceInclude,
      });
      if (!created) throw new NotFoundError('Client service not found');
      return toClientServiceDto(created);
    });
    processScheduleReconciliationBatch().catch((err) => {
      console.error('Immediate reconciliation batch failed:', err);
    });
    return createdDto;
  } catch (error) {
    if (isSerializationConflict(error)) throw new ClientServiceWriteConflictError();
    throw error;
  }
}
