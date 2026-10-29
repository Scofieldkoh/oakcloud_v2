import { computeChanges, createAuditLog } from '@/lib/audit';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import type { TenantAwareParams } from '@/lib/types';
import { runSerializableTransaction } from '@/lib/prisma-transaction';
import type {
  CreateServiceFamilyInput,
  CreateServiceVariantInput,
  SearchServiceCatalogInput,
  ServiceVariantFeeTemplateInput,
  UpdateServiceFamilyInput,
  UpdateServiceVariantInput,
} from '@/lib/validations/service-catalog';
import { Prisma } from '@/generated/prisma';
import { validateVariantRuleAssociations } from '@/services/deadline-rule/association-validation';
import { hashConfiguration } from '@/services/service-schedule/hash';
import { isPostpaidTrigger } from '@/services/billing/postpaid-triggers';
import { parseTieredPricing } from '@/services/billing/tiered-pricing';
import type {
  ServiceCatalogDto,
  ServiceFamilyDto,
  ServiceVariantDto,
} from './types';

function variantInclude(tenantId: string) {
  return {
    sowPartial: {
      select: {
        id: true,
        name: true,
        displayName: true,
        version: true,
        placeholders: true,
      },
    },
    defaultFeeTemplates: {
      where: { tenantId },
      orderBy: [{ displayOrder: 'asc' as const }, { description: 'asc' as const }],
    },
    deadlineRuleAssociations: {
      where: { tenantId, archivedAt: null },
      orderBy: [{ displayOrder: 'asc' as const }, { createdAt: 'asc' as const }],
      include: {
        rule: {
          select: { id: true, code: true, name: true, currentVersionId: true },
        },
      },
    },
  } satisfies Prisma.ServiceVariantInclude;
}

type VariantRecord = Prisma.ServiceVariantGetPayload<{
  include: ReturnType<typeof variantInclude>;
}>;

function familyInclude(tenantId: string) {
  return {
    variants: {
      where: {
        tenantId,
        deletedAt: null,
        family: { tenantId, deletedAt: null },
        sowPartial: { tenantId, deletedAt: null },
      },
      include: variantInclude(tenantId),
      orderBy: [{ displayOrder: 'asc' as const }, { name: 'asc' as const }],
    },
  } satisfies Prisma.ServiceFamilyInclude;
}

type FamilyRecord = Prisma.ServiceFamilyGetPayload<{
  include: ReturnType<typeof familyInclude>;
}>;

async function persistVariantDeadlineRules(
  tx: Prisma.TransactionClient,
  variantId: string,
  tenantId: string,
  associations: NonNullable<import('@/lib/validations/service-catalog').CreateServiceVariantInput['deadlineRules']>,
) {
  await validateVariantRuleAssociations(tx, tenantId, associations);
  await tx.serviceVariantDeadlineRule.deleteMany({
    where: { tenantId, serviceVariantId: variantId },
  });
  if (associations.length === 0) return;
  await tx.serviceVariantDeadlineRule.createMany({
    data: associations.map((association) => ({
      tenantId,
      serviceVariantId: variantId,
      ruleId: association.ruleId,
      enabledByDefault: association.enabledByDefault,
      parameterDefaults: association.parameterDefaults as Prisma.InputJsonValue,
      scheduleDefaults: association.scheduleDefaults as Prisma.InputJsonValue,
      displayOrder: association.displayOrder,
    })),
  });
}

function deadlineRuleFingerprint(
  associations: NonNullable<CreateServiceVariantInput['deadlineRules']>,
): string {
  return hashConfiguration(associations.map((association) => ({
    ruleId: association.ruleId,
    enabledByDefault: association.enabledByDefault,
    parameterDefaults: association.parameterDefaults,
    scheduleDefaults: association.scheduleDefaults,
    displayOrder: association.displayOrder,
  })));
}

function storedDeadlineRuleFingerprint(
  associations: VariantRecord['deadlineRuleAssociations'] | undefined,
): string {
  return deadlineRuleFingerprint((associations ?? []).map((association) => ({
    ruleId: association.ruleId,
    enabledByDefault: association.enabledByDefault,
    parameterDefaults: (association.parameterDefaults ?? {}) as Record<string, unknown>,
    scheduleDefaults: (association.scheduleDefaults ?? []) as NonNullable<CreateServiceVariantInput['deadlineRules']>[number]['scheduleDefaults'],
    displayOrder: association.displayOrder,
  })));
}

function toVariantDto(variant: VariantRecord): ServiceVariantDto {
  return {
    id: variant.id,
    familyId: variant.familyId,
    code: variant.code,
    name: variant.name,
    description: variant.description,
    serviceCadence: variant.serviceCadence,
    customCadenceLabel: variant.customCadenceLabel,
    displayOrder: variant.displayOrder,
    version: variant.version,
    isActive: variant.isActive,
    monitoringProfiles: variant.monitoringProfiles ?? [],
    sowPartial: {
      id: variant.sowPartial.id,
      name: variant.sowPartial.name,
      displayName: variant.sowPartial.displayName,
      version: variant.sowPartial.version,
      placeholders: variant.sowPartial.placeholders,
    },
    feeTemplates: variant.defaultFeeTemplates.map((fee) => ({
      id: fee.id,
      description: fee.description,
      defaultAmount: fee.defaultAmount?.toString() ?? null,
      currency: fee.currency,
      billingFrequency: fee.billingFrequency,
      customFrequencyLabel: fee.customFrequencyLabel,
      billingTiming: fee.billingTiming,
      postpaidTrigger: isPostpaidTrigger(fee.postpaidTrigger) ? fee.postpaidTrigger : null,
      tieredPricing: fee.billingTiming === 'POSTPAID' ? parseTieredPricing(fee.tieredPricing) : null,
      displayOrder: fee.displayOrder,
    })),
    deadlineRules: (variant.deadlineRuleAssociations ?? []).map((association) => ({
      id: association.id,
      ruleId: association.ruleId,
      serviceVariantId: association.serviceVariantId,
      enabledByDefault: association.enabledByDefault,
      parameterDefaults: (association.parameterDefaults ?? {}) as Record<string, unknown>,
      scheduleDefaults: (association.scheduleDefaults ?? []) as unknown[],
      displayOrder: association.displayOrder,
      archivedAt: association.archivedAt,
      ...(association.rule
        ? {
            rule: {
              id: association.rule.id,
              code: association.rule.code,
              name: association.rule.name,
              currentVersionId: association.rule.currentVersionId,
            },
          }
        : {}),
    })),
  };
}

function toFamilyDto(family: FamilyRecord): ServiceFamilyDto {
  return {
    id: family.id,
    code: family.code,
    name: family.name,
    description: family.description,
    displayColor: family.displayColor,
    displayOrder: family.displayOrder,
    isActive: family.isActive,
    variants: family.variants.map(toVariantDto),
  };
}

function feeFingerprint(fees: ServiceVariantFeeTemplateInput[]): string {
  return JSON.stringify(
    fees
      .map((fee) => ({
        description: fee.description,
        defaultAmount: fee.defaultAmount ?? null,
        currency: fee.currency,
        billingFrequency: fee.billingFrequency,
        customFrequencyLabel: fee.customFrequencyLabel ?? null,
        billingTiming: fee.billingTiming ?? 'PREPAID',
        postpaidTrigger: fee.postpaidTrigger ?? null,
        tieredPricing: fee.tieredPricing ?? null,
        displayOrder: fee.displayOrder,
      }))
      .sort((left, right) => left.displayOrder - right.displayOrder),
  );
}

function storedFeeFingerprint(fees: VariantRecord['defaultFeeTemplates']): string {
  return JSON.stringify(
    fees
      .map((fee) => ({
        description: fee.description,
        defaultAmount: fee.defaultAmount?.toString() ?? null,
        currency: fee.currency,
        billingFrequency: fee.billingFrequency,
        customFrequencyLabel: fee.customFrequencyLabel,
        billingTiming: fee.billingTiming,
        postpaidTrigger: fee.postpaidTrigger ?? null,
        tieredPricing: fee.tieredPricing ?? null,
        displayOrder: fee.displayOrder,
      }))
      .sort((left, right) => left.displayOrder - right.displayOrder),
  );
}

function feeCreateData(
  fees: ServiceVariantFeeTemplateInput[],
  tenantId: string,
): Prisma.ServiceVariantFeeTemplateCreateWithoutVariantInput[] {
  return fees.map((fee) => ({
    tenant: { connect: { id: tenantId } },
    description: fee.description,
    defaultAmount: fee.defaultAmount ?? null,
    currency: fee.currency,
    billingFrequency: fee.billingFrequency,
    customFrequencyLabel: fee.customFrequencyLabel ?? null,
    billingTiming: fee.billingTiming ?? 'PREPAID',
    postpaidTrigger: fee.billingTiming === 'POSTPAID' ? fee.postpaidTrigger ?? null : null,
    tieredPricing: fee.billingTiming === 'POSTPAID' && fee.tieredPricing ? fee.tieredPricing : Prisma.JsonNull,
    displayOrder: fee.displayOrder,
  }));
}

async function requireFamily(
  id: string,
  tenantId: string,
  tx: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const family = await tx.serviceFamily.findFirst({
    where: { id, tenantId, deletedAt: null, isActive: true },
  });
  if (!family) throw new NotFoundError('Service family not found');
  return family;
}

async function requirePartial(
  id: string,
  tenantId: string,
  tx: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const partial = await tx.templatePartial.findFirst({
    where: { id, tenantId, deletedAt: null },
  });
  if (!partial) throw new NotFoundError('SOW partial not found');
  return partial;
}

async function ensureUniqueFamilyCode(
  code: string,
  tenantId: string,
  excludeId?: string,
  tx: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const existing = await tx.serviceFamily.findFirst({
    where: {
      tenantId,
      code,
      deletedAt: null,
      ...(excludeId ? { NOT: { id: excludeId } } : {}),
    },
  });
  if (existing) throw new ConflictError('A service family with this code already exists');
}

async function ensureUniqueVariantCode(
  code: string,
  tenantId: string,
  excludeId?: string,
  tx: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const existing = await tx.serviceVariant.findFirst({
    where: {
      tenantId,
      code,
      deletedAt: null,
      ...(excludeId ? { NOT: { id: excludeId } } : {}),
    },
  });
  if (existing) throw new ConflictError('A service variant with this code already exists');
}

export async function listServiceCatalog(
  input: SearchServiceCatalogInput,
  params: TenantAwareParams,
): Promise<ServiceCatalogDto> {
  const variantMatchBase: Prisma.ServiceVariantWhereInput = {
    tenantId: params.tenantId,
    deletedAt: null,
    sowPartial: { tenantId: params.tenantId, deletedAt: null },
  };
  const where: Prisma.ServiceFamilyWhereInput = {
    tenantId: params.tenantId,
    deletedAt: null,
    AND: [
      ...(input.isActive === undefined
        ? []
        : [{
          OR: [
            { isActive: input.isActive },
            {
              variants: {
                some: { ...variantMatchBase, isActive: input.isActive },
              },
            },
          ],
        }]),
      ...(input.query
        ? [{
            OR: [
              { code: { contains: input.query, mode: 'insensitive' as const } },
              { name: { contains: input.query, mode: 'insensitive' as const } },
              { description: { contains: input.query, mode: 'insensitive' as const } },
              {
                variants: {
                  some: {
                    ...variantMatchBase,
                    OR: [
                      { code: { contains: input.query, mode: 'insensitive' as const } },
                      { name: { contains: input.query, mode: 'insensitive' as const } },
                      { description: { contains: input.query, mode: 'insensitive' as const } },
                    ],
                  },
                },
              },
            ],
          }]
        : []),
    ],
  };

  const variantWhere: Prisma.ServiceVariantWhereInput = {
    tenantId: params.tenantId,
    deletedAt: null,
    family: { tenantId: params.tenantId, deletedAt: null },
    sowPartial: { tenantId: params.tenantId, deletedAt: null },
    ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
  };
  const tenantFamilyInclude = familyInclude(params.tenantId);
  const include = {
    variants: {
      ...tenantFamilyInclude.variants,
      where: variantWhere,
    },
  } satisfies Prisma.ServiceFamilyInclude;

  const [families, total] = await Promise.all([
    prisma.serviceFamily.findMany({
      where,
      include,
      orderBy: [
        { [input.sortBy]: input.sortOrder },
        ...(input.sortBy === 'name' ? [] : [{ name: 'asc' as const }]),
      ],
      skip: (input.page - 1) * input.limit,
      take: input.limit,
    }),
    prisma.serviceFamily.count({ where }),
  ]);

  return {
    families: families.map((family) => toFamilyDto(family as FamilyRecord)),
    total,
  };
}

export async function getSelectableServiceVariants(
  tenantId: string,
): Promise<ServiceVariantDto[]> {
  const variants = await prisma.serviceVariant.findMany({
    where: {
      tenantId,
      deletedAt: null,
      isActive: true,
      family: { tenantId, deletedAt: null, isActive: true },
      sowPartial: { tenantId, deletedAt: null },
    },
    include: variantInclude(tenantId),
    orderBy: [
      { family: { displayOrder: 'asc' } },
      { displayOrder: 'asc' },
      { name: 'asc' },
    ],
  });
  return variants.map((variant) => toVariantDto(variant as VariantRecord));
}

export async function getServiceVariant(
  id: string,
  params: TenantAwareParams,
): Promise<ServiceVariantDto> {
  const variant = await prisma.serviceVariant.findFirst({
    where: {
      id,
      tenantId: params.tenantId,
      deletedAt: null,
      family: { tenantId: params.tenantId, deletedAt: null },
      sowPartial: { tenantId: params.tenantId, deletedAt: null },
    },
    include: variantInclude(params.tenantId),
  });
  if (!variant) throw new NotFoundError('Service variant not found');
  return toVariantDto(variant);
}

export async function createServiceFamily(
  input: CreateServiceFamilyInput,
  params: TenantAwareParams,
): Promise<ServiceFamilyDto> {
  await ensureUniqueFamilyCode(input.code, params.tenantId);
  return runSerializableTransaction(prisma, async (tx) => {
    const family = await tx.serviceFamily.create({
      data: { ...input, tenantId: params.tenantId },
      include: familyInclude(params.tenantId),
    });
    await createAuditLog({
      tenantId: params.tenantId,
      userId: params.userId,
      action: 'CREATE',
      entityType: 'ServiceFamily',
      entityId: family.id,
      entityName: family.name,
      summary: `Created service family "${family.name}"`,
      changes: {
        displayColor: { old: null, new: family.displayColor },
      },
    }, tx);
    return toFamilyDto(family);
  });
}

export async function updateServiceFamily(
  id: string,
  input: UpdateServiceFamilyInput,
  params: TenantAwareParams,
): Promise<ServiceFamilyDto> {
  const existing = await prisma.serviceFamily.findFirst({
    where: { id, tenantId: params.tenantId, deletedAt: null },
  });
  if (!existing) throw new NotFoundError('Service family not found');
  if (input.code && input.code !== existing.code) {
    await ensureUniqueFamilyCode(input.code, params.tenantId, id);
  }
  return prisma.$transaction(async (tx) => {
    const family = await tx.serviceFamily.update({
      where: { id },
      data: input,
      include: familyInclude(params.tenantId),
    });
    const changes = computeChanges(
      existing as unknown as Record<string, unknown>,
      input as unknown as Record<string, unknown>,
      ['code', 'name', 'description', 'displayColor', 'displayOrder', 'isActive'],
    );
    await createAuditLog({
      tenantId: params.tenantId,
      userId: params.userId,
      action: 'UPDATE',
      entityType: 'ServiceFamily',
      entityId: family.id,
      entityName: family.name,
      summary: `Updated service family "${family.name}"`,
      changes: changes ?? undefined,
    }, tx);
    return toFamilyDto(family);
  });
}

export async function archiveServiceFamily(
  id: string,
  reason: string,
  params: TenantAwareParams,
): Promise<{ id: string; archived: true }> {
  const existing = await prisma.serviceFamily.findFirst({
    where: { id, tenantId: params.tenantId, deletedAt: null },
  });
  if (!existing) throw new NotFoundError('Service family not found');
  return prisma.$transaction(async (tx) => {
    const variantCount = await tx.serviceVariant.count({
      where: { tenantId: params.tenantId, familyId: id, deletedAt: null },
    });
    if (variantCount > 0) {
      throw new ConflictError('Archive the family variants before archiving this service family');
    }
    await tx.serviceFamily.update({
      where: { id },
      data: { isActive: false, deletedAt: new Date() },
    });
    await createAuditLog({
      tenantId: params.tenantId,
      userId: params.userId,
      action: 'DELETE',
      entityType: 'ServiceFamily',
      entityId: id,
      entityName: existing.name,
      summary: `Archived service family "${existing.name}"`,
      reason,
    }, tx);
    return { id, archived: true as const };
  });
}

export async function createServiceVariant(
  input: CreateServiceVariantInput,
  params: TenantAwareParams,
): Promise<ServiceVariantDto> {
  return runSerializableTransaction(prisma, async (tx) => {
    await Promise.all([
      requireFamily(input.familyId, params.tenantId, tx),
      requirePartial(input.sowPartialId, params.tenantId, tx),
      ensureUniqueVariantCode(input.code, params.tenantId, undefined, tx),
    ]);

    const variant = await tx.serviceVariant.create({
      data: {
        tenantId: params.tenantId,
        familyId: input.familyId,
        sowPartialId: input.sowPartialId,
        code: input.code,
        name: input.name,
        description: input.description,
        serviceCadence: input.serviceCadence,
        customCadenceLabel: input.customCadenceLabel,
        displayOrder: input.displayOrder,
        isActive: input.isActive,
        monitoringProfiles: input.monitoringProfiles ?? [],
        defaultFeeTemplates: {
          create: feeCreateData(input.feeTemplates, params.tenantId),
        },
      },
      include: variantInclude(params.tenantId),
    });
    if (input.deadlineRules !== undefined) {
      await persistVariantDeadlineRules(tx, variant.id, params.tenantId, input.deadlineRules);
    }
    const postWrite = input.deadlineRules === undefined
      ? variant
      : await tx.serviceVariant.findFirst({
          where: { id: variant.id, tenantId: params.tenantId, deletedAt: null },
          include: variantInclude(params.tenantId),
        });
    if (!postWrite) throw new NotFoundError('Service variant not found after association update');
    await createAuditLog(
      {
        tenantId: params.tenantId,
        userId: params.userId,
        action: 'CREATE',
        entityType: 'ServiceVariant',
        entityId: variant.id,
        entityName: variant.name,
        summary: `Created service variant "${variant.name}"`,
        metadata: { version: postWrite.version },
      },
      tx,
    );
    return toVariantDto(postWrite);
  });
}

export async function updateServiceVariant(
  id: string,
  input: UpdateServiceVariantInput,
  params: TenantAwareParams,
): Promise<ServiceVariantDto> {
  return runSerializableTransaction(prisma, async (tx) => {
    const existing = await tx.serviceVariant.findFirst({
      where: {
        id,
        tenantId: params.tenantId,
        deletedAt: null,
        family: { tenantId: params.tenantId, deletedAt: null },
        sowPartial: { tenantId: params.tenantId, deletedAt: null },
      },
      include: variantInclude(params.tenantId),
    });
    if (!existing) throw new NotFoundError('Service variant not found');

    await Promise.all([
      input.familyId && input.familyId !== existing.familyId
        ? requireFamily(input.familyId, params.tenantId, tx)
        : Promise.resolve(),
      input.sowPartialId && input.sowPartialId !== existing.sowPartialId
        ? requirePartial(input.sowPartialId, params.tenantId, tx)
        : Promise.resolve(),
      input.code && input.code !== existing.code
        ? ensureUniqueVariantCode(input.code, params.tenantId, id, tx)
        : Promise.resolve(),
    ]);

    const serviceCadence = input.serviceCadence ?? existing.serviceCadence;
    const customCadenceLabel =
      serviceCadence === 'CUSTOM'
        ? input.customCadenceLabel === undefined
          ? existing.customCadenceLabel
          : input.customCadenceLabel
        : null;
    if (serviceCadence === 'CUSTOM' && !customCadenceLabel) {
      throw new ValidationError('Custom cadence label is required');
    }

    const feesChanged =
      input.feeTemplates !== undefined &&
      feeFingerprint(input.feeTemplates) !== storedFeeFingerprint(existing.defaultFeeTemplates);
    const deadlineRulesChanged =
      input.deadlineRules !== undefined &&
      deadlineRuleFingerprint(input.deadlineRules) !== storedDeadlineRuleFingerprint(existing.deadlineRuleAssociations);
    const materialChanged =
      (input.name !== undefined && input.name !== existing.name) ||
      (input.sowPartialId !== undefined && input.sowPartialId !== existing.sowPartialId) ||
      serviceCadence !== existing.serviceCadence ||
      customCadenceLabel !== existing.customCadenceLabel ||
      feesChanged ||
      deadlineRulesChanged;

    if (feesChanged) {
      await tx.serviceVariantFeeTemplate.deleteMany({
        where: { tenantId: params.tenantId, variantId: id },
      });
    }

    const variant = await tx.serviceVariant.update({
      where: { id },
      data: {
        ...(input.familyId === undefined ? {} : { familyId: input.familyId }),
        ...(input.sowPartialId === undefined ? {} : { sowPartialId: input.sowPartialId }),
        ...(input.code === undefined ? {} : { code: input.code }),
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.serviceCadence === undefined ? {} : { serviceCadence }),
        ...(input.serviceCadence === undefined && input.customCadenceLabel === undefined
          ? {}
          : { customCadenceLabel }),
        ...(input.displayOrder === undefined ? {} : { displayOrder: input.displayOrder }),
        ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
        ...(input.monitoringProfiles === undefined ? {} : { monitoringProfiles: input.monitoringProfiles }),
        ...(feesChanged
          ? {
              defaultFeeTemplates: {
                create: feeCreateData(input.feeTemplates ?? [], params.tenantId),
              },
            }
          : {}),
        ...(materialChanged ? { version: { increment: 1 } } : {}),
      },
      include: variantInclude(params.tenantId),
    });
    if (input.deadlineRules !== undefined) {
      await persistVariantDeadlineRules(tx, variant.id, params.tenantId, input.deadlineRules);
    }

    const postWrite = input.deadlineRules === undefined
      ? variant
      : await tx.serviceVariant.findFirst({
          where: { id: variant.id, tenantId: params.tenantId, deletedAt: null },
          include: variantInclude(params.tenantId),
        });
    if (!postWrite) throw new NotFoundError('Service variant not found after association update');

    await createAuditLog(
      {
        tenantId: params.tenantId,
        userId: params.userId,
        action: 'UPDATE',
        entityType: 'ServiceVariant',
        entityId: variant.id,
        entityName: postWrite.name,
        summary: `Updated service variant "${postWrite.name}"`,
        metadata: materialChanged
          ? { oldVersion: existing.version, newVersion: postWrite.version }
          : undefined,
      },
      tx,
    );
    return toVariantDto(postWrite);
  });
}

export async function archiveServiceVariant(
  id: string,
  reason: string,
  params: TenantAwareParams,
): Promise<{ id: string; archived: true }> {
  const existing = await prisma.serviceVariant.findFirst({
    where: { id, tenantId: params.tenantId, deletedAt: null },
  });
  if (!existing) throw new NotFoundError('Service variant not found');
  return prisma.$transaction(async (tx) => {
    await tx.serviceVariant.update({
      where: { id },
      data: { isActive: false, deletedAt: new Date() },
    });
    await createAuditLog({
      tenantId: params.tenantId,
      userId: params.userId,
      action: 'DELETE',
      entityType: 'ServiceVariant',
      entityId: id,
      entityName: existing.name,
      summary: `Archived service variant "${existing.name}"`,
      reason,
      metadata: { version: existing.version },
    }, tx);
    return { id, archived: true as const };
  });
}
