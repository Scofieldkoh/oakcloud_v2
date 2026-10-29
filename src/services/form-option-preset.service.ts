import { Prisma } from '@/generated/prisma';
import { createAuditLog } from '@/lib/audit';
import {
  COUNTRY_PRESET_OPTION_ENTRIES,
  NATIONALITY_PRESET_OPTION_ENTRIES,
} from '@/lib/constants/form-option-presets';
import ssic2025 from '@/lib/data/ssic-2025.json';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import {
  FORM_PRESET_MAX_OPTIONS,
  presetOptionSchema,
  type PresetOption,
} from '@/lib/validations/form-option-preset';

type ActorContext = {
  tenantId: string;
  userId?: string;
};

type CreatePresetParams = ActorContext & {
  name: string;
  options: PresetOption[];
};

type ReplacePresetParams = ActorContext & {
  name?: string;
  options?: PresetOption[];
};

const BUILT_IN_PRESETS = [
  {
    name: 'Countries',
    normalizedKey: 'countries',
    builtInKey: 'countries',
    isProtected: true,
    allowCsvReplace: false,
    options: COUNTRY_PRESET_OPTION_ENTRIES,
  },
  {
    name: 'Nationalities',
    normalizedKey: 'nationalities',
    builtInKey: 'nationalities',
    isProtected: true,
    allowCsvReplace: false,
    options: NATIONALITY_PRESET_OPTION_ENTRIES,
  },
  {
    name: ssic2025.edition,
    normalizedKey: 'ssic 2025',
    builtInKey: 'ssic',
    isProtected: true,
    allowCsvReplace: true,
    options: ssic2025.options,
  },
] as const;

export function normalizePresetKey(name: string): string {
  return name.trim().replace(/[_\s]+/g, ' ').toLocaleLowerCase('en');
}

function validateOptions(options: PresetOption[]): PresetOption[] {
  const parsed = presetOptionSchema.array().max(FORM_PRESET_MAX_OPTIONS).safeParse(options);
  if (!parsed.success) {
    throw new ValidationError('Preset options are invalid', parsed.error.flatten());
  }
  return parsed.data;
}

export async function ensureBuiltInFormOptionPresets(tenantId: string, userId?: string) {
  return prisma.formOptionPreset.createMany({
    data: BUILT_IN_PRESETS.map((preset) => ({
      tenantId,
      name: preset.name,
      normalizedKey: preset.normalizedKey,
      builtInKey: preset.builtInKey,
      isProtected: preset.isProtected,
      allowCsvReplace: preset.allowCsvReplace,
      options: preset.options as unknown as Prisma.InputJsonValue,
      optionCount: preset.options.length,
      ...(userId ? { createdById: userId, updatedById: userId } : {}),
    })),
    skipDuplicates: true,
  });
}

export async function listFormOptionPresets(tenantId: string, userId?: string) {
  await ensureBuiltInFormOptionPresets(tenantId, userId);
  return prisma.formOptionPreset.findMany({
    where: { tenantId },
    include: { _count: { select: { fields: true } } },
    orderBy: [{ isProtected: 'desc' }, { name: 'asc' }],
  });
}

export async function createFormOptionPreset(params: CreatePresetParams) {
  const name = params.name.trim();
  const normalizedKey = normalizePresetKey(name);
  const options = validateOptions(params.options);

  const existing = await prisma.formOptionPreset.findFirst({
    where: { tenantId: params.tenantId, normalizedKey },
    select: { id: true },
  });
  if (existing) throw new ConflictError('A preset with this name already exists');

  const created = await prisma.$transaction(async (tx) => {
    const preset = await tx.formOptionPreset.create({
      data: {
        tenantId: params.tenantId,
        name,
        normalizedKey,
        options: options as Prisma.InputJsonValue,
        optionCount: options.length,
        createdById: params.userId,
        updatedById: params.userId,
      },
    });
    await createAuditLog({
      tenantId: params.tenantId,
      userId: params.userId,
      action: 'CREATE',
      entityType: 'FormOptionPreset',
      entityId: preset.id,
      entityName: preset.name,
      summary: `Created form option preset "${preset.name}"`,
      metadata: { optionCount: options.length },
    }, tx);
    return preset;
  });

  return created;
}

export async function replaceFormOptionPreset(id: string, params: ReplacePresetParams) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.formOptionPreset.findFirst({
      where: { id, tenantId: params.tenantId },
    });
    if (!current) throw new NotFoundError('Form option preset not found');
    if (params.name !== undefined && current.isProtected) {
      throw new ForbiddenError('Built-in preset names cannot be changed');
    }
    if (params.options !== undefined && !current.allowCsvReplace) {
      throw new ForbiddenError('This built-in preset cannot be replaced');
    }
    if (params.name === undefined && params.options === undefined) {
      throw new ValidationError('Provide a name or options to update');
    }

    const name = params.name?.trim() ?? current.name;
    const normalizedKey = normalizePresetKey(name);
    if (normalizedKey !== current.normalizedKey) {
      const conflict = await tx.formOptionPreset.findFirst({
        where: { tenantId: params.tenantId, normalizedKey, id: { not: id } },
        select: { id: true },
      });
      if (conflict) throw new ConflictError('A preset with this name already exists');
    }

    const options = params.options === undefined ? undefined : validateOptions(params.options);
    const updated = await tx.formOptionPreset.update({
      where: { id },
      data: {
        name,
        normalizedKey,
        ...(options ? {
          options: options as Prisma.InputJsonValue,
          optionCount: options.length,
        } : {}),
        updatedById: params.userId,
      },
    });
    await createAuditLog({
      tenantId: params.tenantId,
      userId: params.userId,
      action: 'UPDATE',
      entityType: 'FormOptionPreset',
      entityId: updated.id,
      entityName: updated.name,
      summary: `Updated form option preset "${updated.name}"`,
      changes: {
        name: { old: current.name, new: name },
        optionCount: { old: current.optionCount, new: options?.length ?? current.optionCount },
      },
    }, tx);
    return updated;
  });
}

export async function deleteFormOptionPreset(id: string, params: ActorContext) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.formOptionPreset.findFirst({
      where: { id, tenantId: params.tenantId },
      select: { id: true, name: true, isProtected: true },
    });
    if (!current) throw new NotFoundError('Form option preset not found');
    if (current.isProtected) throw new ConflictError('Built-in presets cannot be deleted');

    const usageCount = await tx.formField.count({
      where: { tenantId: params.tenantId, optionPresetId: id },
    });
    if (usageCount > 0) {
      throw new ConflictError(`This preset is used by ${usageCount} form field${usageCount === 1 ? '' : 's'}`);
    }

    const deleted = await tx.formOptionPreset.delete({ where: { id } });
    await createAuditLog({
      tenantId: params.tenantId,
      userId: params.userId,
      action: 'DELETE',
      entityType: 'FormOptionPreset',
      entityId: deleted.id,
      entityName: deleted.name,
      summary: `Deleted form option preset "${deleted.name}"`,
    }, tx);
    return deleted;
  });
}

export async function resolvePresetOptionsForFields<
  T extends { optionPresetId: string | null; options: unknown },
>(tenantId: string, fields: T[]): Promise<T[]> {
  const presetIds = [...new Set(fields.flatMap((field) => field.optionPresetId ? [field.optionPresetId] : []))];
  if (presetIds.length === 0) return fields;

  const presets = await prisma.formOptionPreset.findMany({
    where: { tenantId, id: { in: presetIds } },
    select: { id: true, options: true },
  });
  const optionsByPresetId = new Map(presets.map((preset) => [preset.id, preset.options]));

  const missingId = presetIds.find((presetId) => !optionsByPresetId.has(presetId));
  if (missingId) throw new NotFoundError('A linked form option preset was not found');

  return fields.map((field) => field.optionPresetId
    ? { ...field, options: optionsByPresetId.get(field.optionPresetId) }
    : field);
}
