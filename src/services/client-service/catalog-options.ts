import { isPostpaidTrigger } from '@/services/billing/postpaid-triggers';
import { parseTieredPricing } from '@/services/billing/tiered-pricing';
import { NotFoundError } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import type { TenantAwareParams } from '@/lib/types';
import type { PlaceholderDefinition } from '@/types/placeholders';
import { composeServicePartialGraph } from '@/services/service-agreement/snapshot';
import type {
  ManualClientServiceCatalogField,
  ManualClientServiceCatalogDeadlineRule,
  ManualClientServiceCatalogOptionsResponse,
  ManualClientServiceCatalogVariantOption,
} from './types';

const FIELD_PREFIX = 'service.fields.';
const FIELD_TYPES = new Set(['text', 'date', 'number', 'currency', 'boolean', 'textarea']);

function toOperationalField(definition: PlaceholderDefinition): ManualClientServiceCatalogField | null {
  if (!definition.key.startsWith(FIELD_PREFIX)) return null;
  const stored = definition as PlaceholderDefinition & { label?: unknown; type?: unknown; defaultValue?: unknown };
  const key = definition.key.slice(FIELD_PREFIX.length);
  if (!key) return null;
  return {
    key,
    label: typeof stored.label === 'string' && stored.label.trim() ? stored.label.trim() : key.replaceAll('_', ' ').replace(/^./, (value) => value.toUpperCase()),
    type: typeof stored.type === 'string' && FIELD_TYPES.has(stored.type) ? stored.type as ManualClientServiceCatalogField['type'] : 'text',
    defaultValue: typeof stored.defaultValue === 'string' ? stored.defaultValue : null,
  };
}

export async function getManualClientServiceCatalogOptions(
  companyId: string,
  params: TenantAwareParams,
): Promise<ManualClientServiceCatalogOptionsResponse> {
  const company = await prisma.company.findFirst({
    where: { id: companyId, tenantId: params.tenantId, deletedAt: null },
    select: {
      id: true,
      name: true,
      uen: true,
      accountsDueDate: true,
      financialYearEndDay: true,
      financialYearEndMonth: true,
      incorporationDate: true,
    },
  });
  if (!company) throw new NotFoundError('Company not found');

  const [variants, partials] = await Promise.all([
    prisma.serviceVariant.findMany({
      where: {
        tenantId: params.tenantId,
        deletedAt: null,
        isActive: true,
        family: { tenantId: params.tenantId, deletedAt: null, isActive: true },
        sowPartial: { tenantId: params.tenantId, deletedAt: null },
      },
      include: {
        family: { select: { id: true, name: true, displayColor: true, displayOrder: true } },
        sowPartial: {
          select: {
            id: true,
            name: true,
            version: true,
            content: true,
            placeholders: true,
            updatedAt: true,
          },
        },
        defaultFeeTemplates: {
          where: { tenantId: params.tenantId },
          orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
        },
        deadlineRuleAssociations: {
          where: {
            tenantId: params.tenantId,
            archivedAt: null,
            rule: {
              tenantId: params.tenantId,
              isActive: true,
              archivedAt: null,
              currentVersionId: { not: null },
            },
          },
          orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
          include: {
            rule: {
              select: {
                id: true,
                code: true,
                name: true,
                currentVersionId: true,
                currentVersion: {
                  select: {
                    id: true,
                    parameterDefinitions: {
                      orderBy: [{ displayOrder: 'asc' }, { key: 'asc' }],
                    },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: [
        { family: { displayOrder: 'asc' } },
        { family: { name: 'asc' } },
        { displayOrder: 'asc' },
        { name: 'asc' },
      ],
    }),
    prisma.templatePartial.findMany({
      where: { tenantId: params.tenantId, deletedAt: null },
      select: {
        id: true,
        name: true,
        version: true,
        content: true,
        placeholders: true,
        updatedAt: true,
      },
    }),
  ]);

  const options: ManualClientServiceCatalogVariantOption[] = variants.map((variant) => {
    const composed = composeServicePartialGraph(variant.sowPartial, partials);
    const deadlineRules: ManualClientServiceCatalogDeadlineRule[] = (variant.deadlineRuleAssociations ?? [])
      .filter((association) => association.rule?.currentVersion?.id && association.rule.currentVersionId)
      .map((association) => ({
        ruleId: association.ruleId,
        code: association.rule?.code ?? association.ruleId,
        name: association.rule?.name ?? association.ruleId,
        enabledByDefault: association.enabledByDefault,
        parameterDefaults: (association.parameterDefaults ?? {}) as Record<string, unknown>,
        scheduleDefaults: (Array.isArray(association.scheduleDefaults) ? association.scheduleDefaults : []) as ManualClientServiceCatalogDeadlineRule['scheduleDefaults'],
        currentVersionId: association.rule?.currentVersion?.id ?? association.rule?.currentVersionId ?? '',
        parameters: (association.rule?.currentVersion?.parameterDefinitions ?? []).map((parameter) => ({
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
      }));
    return {
      id: variant.id,
      name: variant.name,
      family: { id: variant.family.id, name: variant.family.name, displayColor: variant.family.displayColor ?? '#2F6F5E' },
      serviceCadence: variant.serviceCadence,
      customCadenceLabel: variant.customCadenceLabel,
      monitoringProfiles: variant.monitoringProfiles ?? [],
      fields: composed.placeholders.map(toOperationalField).filter((field): field is ManualClientServiceCatalogField => field !== null),
      feeTemplates: variant.defaultFeeTemplates.map((fee) => ({
        description: fee.description,
        defaultAmount: fee.defaultAmount ? fee.defaultAmount.toFixed(2) : null,
        currency: fee.currency,
        billingFrequency: fee.billingFrequency,
        customFrequencyLabel: fee.customFrequencyLabel,
        billingTiming: fee.billingTiming ?? 'PREPAID',
        postpaidTrigger: isPostpaidTrigger(fee.postpaidTrigger) ? fee.postpaidTrigger : null,
        tieredPricing: fee.billingTiming === 'POSTPAID' ? parseTieredPricing(fee.tieredPricing) : null,
        displayOrder: fee.displayOrder,
      })),
      deadlineRules,
    };
  });

  return {
    variants: options,
    companyContext: {
      id: company.id,
      name: company.name,
      uen: company.uen,
      accountsDueDate: company.accountsDueDate ? company.accountsDueDate.toISOString().slice(0, 10) : null,
      financialYearEndDay: company.financialYearEndDay,
      financialYearEndMonth: company.financialYearEndMonth,
      incorporationDate: company.incorporationDate ? company.incorporationDate.toISOString().slice(0, 10) : null,
    },
  };
}
