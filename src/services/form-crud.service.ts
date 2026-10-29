import { randomBytes } from 'crypto';
import {
  FormFieldType,
  FormStatus,
  Prisma,
  type Form,
  type FormField,
} from '@/generated/prisma';
import { createAuditLog } from '@/lib/audit';
import { normalizeKey } from '@/lib/form-utils';
import { createLogger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { storage } from '@/lib/storage';
import type { TenantAwareParams } from '@/lib/types';
import { normalizeWorkspaceLogoUrl } from '@/lib/workspace-logo-url';
import type {
  CreateFormInput,
  FormFieldInput,
  ListFormsQueryInput,
  UpdateFormInput,
} from '@/lib/validations/form-builder';
import { toJsonInput } from './form-builder.helpers';
import { resolvePresetOptionsForFields } from './form-option-preset.service';
import { ValidationError } from '@/lib/errors';
import { parseFormTemplateBinding, preserveFormTemplateBinding } from '@/lib/form-templates';
import { computeFormDefinitionHash } from './company-incorporation-intake.service';
import { deleteUnusedFormBackgroundsSafely } from './form-background.service';

export interface FormListItem extends Form {
  fieldCount: number;
  responseCount: number;
  conversionRate: number;
}

export interface FormDetail extends Form {
  fields: FormField[];
  tenantLogoUrl: string | null;
  tenantName: string | null;
}

export interface FormListResult {
  forms: FormListItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const MAX_SLUG_ATTEMPTS = 10;
const log = createLogger('form-crud-service');

function getArchivedFormSlug(formId: string): string {
  return `archived-${formId}`;
}

async function releaseArchivedFormSlug(form: Pick<Form, 'id' | 'slug'>): Promise<void> {
  const archivedSlug = getArchivedFormSlug(form.id);
  if (form.slug === archivedSlug) {
    return;
  }

  await prisma.form.update({
    where: { id: form.id },
    data: { slug: archivedSlug },
  });
}

function makeUniqueKey(base: string, used: Set<string>): string {
  let candidate = base;
  let count = 1;

  while (used.has(candidate)) {
    count += 1;
    candidate = `${base}_${count}`;
  }

  used.add(candidate);
  return candidate;
}

function deriveKey(field: FormFieldInput): string {
  if (field.key?.trim()) {
    return normalizeKey(field.key);
  }

  if (field.label?.trim()) {
    return normalizeKey(field.label);
  }

  return normalizeKey(field.type.toLowerCase());
}

function normalizeFieldsForPersistence(fields: FormFieldInput[]): Array<{
  type: FormFieldType;
  label: string | null;
  key: string;
  placeholder: string | null;
  subtext: string | null;
  helpText: string | null;
  inputType: string | null;
  optionPresetId: string | null;
  options: Prisma.InputJsonValue | typeof Prisma.JsonNull;
  validation: Prisma.InputJsonValue | typeof Prisma.JsonNull;
  condition: Prisma.InputJsonValue | typeof Prisma.JsonNull;
  isRequired: boolean;
  hideLabel: boolean;
  isReadOnly: boolean;
  layoutWidth: number;
  position: number;
}> {
  const usedKeys = new Set<string>();

  return [...fields]
    .sort((a, b) => a.position - b.position)
    .map((field, idx) => {
      const baseKey = deriveKey(field);
      const key = makeUniqueKey(baseKey, usedKeys);

      return {
        type: field.type as FormFieldType,
        label: field.label?.trim() || null,
        key,
        placeholder: field.placeholder?.trim() || null,
        subtext: field.subtext?.trim() || null,
        helpText: field.helpText?.trim() || null,
        inputType: field.inputType || null,
        optionPresetId: field.optionPresetId ?? null,
        options: field.optionPresetId ? Prisma.JsonNull : toJsonInput(field.options ?? null),
        validation: toJsonInput(field.validation ?? null),
        condition: toJsonInput(field.condition ?? null),
        isRequired: field.isRequired ?? false,
        hideLabel: field.hideLabel ?? false,
        isReadOnly: field.isReadOnly ?? false,
        layoutWidth: field.layoutWidth ?? 100,
        position: idx,
      };
    });
}

async function generateUniqueFormSlug(): Promise<string> {
  for (let i = 0; i < MAX_SLUG_ATTEMPTS; i += 1) {
    const slug = randomBytes(8).toString('hex');
    const existing = await prisma.form.findUnique({ where: { slug }, select: { id: true } });
    if (!existing) {
      return slug;
    }
  }

  throw new Error('Failed to generate unique form slug');
}

export async function createForm(
  data: CreateFormInput,
  params: TenantAwareParams
): Promise<Form> {
  const slug = await generateUniqueFormSlug();

  const form = await prisma.form.create({
    data: {
      tenantId: params.tenantId,
      title: data.title.trim(),
      description: data.description?.trim() || null,
      status: data.status as FormStatus,
      tags: data.tags ?? [],
      slug,
      createdById: params.userId,
      updatedById: params.userId,
      settings: Prisma.JsonNull,
    },
  });

  await createAuditLog({
    tenantId: params.tenantId,
    userId: params.userId,
    action: 'CREATE',
    entityType: 'Form',
    entityId: form.id,
    entityName: form.title,
    summary: `Created form "${form.title}"`,
    changeSource: 'MANUAL',
  });

  return form;
}

export async function listForms(
  input: ListFormsQueryInput,
  params: TenantAwareParams
): Promise<FormListResult> {
  const where: Prisma.FormWhereInput = {
    tenantId: params.tenantId,
    ...(input.status ? { status: input.status as FormStatus } : {}),
  };

  if (input.query?.trim()) {
    where.OR = [
      { title: { contains: input.query.trim(), mode: 'insensitive' } },
      { description: { contains: input.query.trim(), mode: 'insensitive' } },
      { tags: { has: input.query.trim() } },
    ];
  }

  const [forms, total] = await Promise.all([
    prisma.form.findMany({
      where,
      include: {
        _count: {
          select: {
            fields: true,
            submissions: true,
          },
        },
      },
      orderBy: { [input.sortBy]: input.sortOrder },
      skip: (input.page - 1) * input.limit,
      take: input.limit,
    }),
    prisma.form.count({ where }),
  ]);

  return {
    forms: forms.map((form) => ({
      ...form,
      fieldCount: form._count.fields,
      responseCount: form._count.submissions,
      conversionRate: form.viewsCount > 0 ? Number(((form.submissionsCount / form.viewsCount) * 100).toFixed(1)) : 0,
    })),
    total,
    page: input.page,
    limit: input.limit,
    totalPages: Math.ceil(total / input.limit),
  };
}

export async function getFormById(formId: string, tenantId: string): Promise<FormDetail | null> {
  const form = await prisma.form.findFirst({
    where: {
      id: formId,
      tenantId,
      OR: [{ deletedAt: null }, { status: 'ARCHIVED' }],
    },
    include: {
      fields: {
        orderBy: { position: 'asc' },
      },
      tenant: {
        select: { logoUrl: true, name: true },
      },
    },
  });

  if (!form) {
    return null;
  }

  const fields = await resolvePresetOptionsForFields(tenantId, form.fields);

  return {
    ...form,
    fields,
    tenantLogoUrl: normalizeWorkspaceLogoUrl(form.tenant?.logoUrl),
    tenantName: form.tenant?.name ?? null,
  };
}

export async function updateForm(
  formId: string,
  data: UpdateFormInput,
  params: TenantAwareParams,
  reason?: string
): Promise<Form> {
  const existing = await prisma.form.findFirst({
    where: { id: formId, tenantId: params.tenantId, deletedAt: null },
  });

  if (!existing) {
    throw new Error('Form not found');
  }

  const nextSlug = data.slug !== undefined ? data.slug.trim() : undefined;
  if (nextSlug !== undefined && nextSlug.length === 0) {
    throw new Error('Public URL segment is required');
  }

  const nextStatus = data.status !== undefined ? data.status as FormStatus : existing.status;
  let nextSettings = data.settings !== undefined
    ? preserveFormTemplateBinding(data.settings, existing.settings)
    : undefined;

  // A guided template instance is frozen when it is first published, so answers
  // keep the meaning of the questions they were given against.
  const binding = parseFormTemplateBinding(existing.settings);
  if (binding && !binding.lockedAt && nextStatus === 'PUBLISHED') {
    const fields = await prisma.formField.findMany({ where: { formId }, orderBy: { position: 'asc' } });
    const resolvedFields = await resolvePresetOptionsForFields(params.tenantId, fields);
    const base = (nextSettings ?? existing.settings ?? {}) as Record<string, unknown>;
    nextSettings = {
      ...base,
      template: {
        ...(base.template as Record<string, unknown>),
        lockedAt: new Date().toISOString(),
        definitionHash: computeFormDefinitionHash(resolvedFields),
      },
    };
  }
  const archiveSlug = nextStatus === 'ARCHIVED' ? getArchivedFormSlug(existing.id) : undefined;

  if (nextSlug !== undefined && nextSlug !== existing.slug && nextSlug !== archiveSlug) {
    const conflict = await prisma.form.findUnique({
      where: { slug: nextSlug },
      select: { id: true, slug: true, status: true, deletedAt: true },
    });

    if (conflict && conflict.id !== existing.id) {
      if (conflict.status === 'ARCHIVED' || conflict.deletedAt) {
        await releaseArchivedFormSlug(conflict);
      } else {
        throw new Error('Public URL segment is already in use');
      }
    }
  }

  const updated = await prisma.form.update({
    where: { id: formId },
    data: {
      ...(data.title !== undefined ? { title: data.title.trim() } : {}),
      ...(data.description !== undefined ? { description: data.description?.trim() || null } : {}),
      ...(data.tags !== undefined ? { tags: data.tags } : {}),
      ...(data.status !== undefined ? { status: data.status as FormStatus } : {}),
      ...(archiveSlug ? { slug: archiveSlug, deletedAt: null } : nextSlug !== undefined ? { slug: nextSlug } : {}),
      ...(nextSettings !== undefined ? { settings: toJsonInput(nextSettings) } : {}),
      updatedById: params.userId,
    },
  });

  await createAuditLog({
    tenantId: params.tenantId,
    userId: params.userId,
    action: 'UPDATE',
    entityType: 'Form',
    entityId: updated.id,
    entityName: updated.title,
    summary: `Updated form "${updated.title}"`,
    reason,
    changeSource: 'MANUAL',
  });

  if (nextSettings !== undefined) {
    await deleteUnusedFormBackgroundsSafely(params.tenantId, formId);
  }

  return updated;
}

export async function saveFormFields(
  formId: string,
  fields: FormFieldInput[],
  params: TenantAwareParams,
  reason?: string
): Promise<FormField[]> {
  const existing = await prisma.form.findFirst({
    where: { id: formId, tenantId: params.tenantId, deletedAt: null },
    select: { id: true, title: true, settings: true },
  });

  if (!existing) {
    throw new Error('Form not found');
  }

  if (parseFormTemplateBinding(existing.settings)?.lockedAt) {
    throw new ValidationError(
      'This form was created from a template and has been published, so its questions are locked. Duplicate it to make a changed copy.'
    );
  }

  const normalizedFields = normalizeFieldsForPersistence(fields);
  const presetIds = [...new Set(normalizedFields.flatMap((field) => field.optionPresetId ? [field.optionPresetId] : []))];
  if (presetIds.length > 0) {
    const ownedPresets = await prisma.formOptionPreset.findMany({
      where: { tenantId: params.tenantId, id: { in: presetIds } },
      select: { id: true },
    });
    if (ownedPresets.length !== presetIds.length) {
      throw new ValidationError('One or more option presets are unavailable in this workspace');
    }
  }

  const savedFields = await prisma.$transaction(async (tx) => {
    await tx.formField.deleteMany({ where: { formId } });

    if (normalizedFields.length > 0) {
      await tx.formField.createMany({
        data: normalizedFields.map((field) => ({
          formId,
          tenantId: params.tenantId,
          type: field.type,
          label: field.label,
          key: field.key,
          placeholder: field.placeholder,
          subtext: field.subtext,
          helpText: field.helpText,
          inputType: field.inputType,
          optionPresetId: field.optionPresetId,
          options: field.options,
          validation: field.validation,
          condition: field.condition,
          isRequired: field.isRequired,
          hideLabel: field.hideLabel,
          isReadOnly: field.isReadOnly,
          layoutWidth: field.layoutWidth,
          position: field.position,
        })),
      });
    }

    return tx.formField.findMany({
      where: { formId },
      orderBy: { position: 'asc' },
    });
  });

  await prisma.form.update({
    where: { id: formId },
    data: { updatedById: params.userId },
  });

  await createAuditLog({
    tenantId: params.tenantId,
    userId: params.userId,
    action: 'UPDATE',
    entityType: 'Form',
    entityId: formId,
    entityName: existing.title,
    summary: `Updated fields for form "${existing.title}"`,
    reason,
    metadata: { fieldCount: savedFields.length },
    changeSource: 'MANUAL',
  });

  return savedFields;
}

export async function duplicateForm(
  formId: string,
  params: TenantAwareParams,
  overrideTitle?: string
): Promise<FormDetail> {
  const source = await prisma.form.findFirst({
    where: { id: formId, tenantId: params.tenantId, deletedAt: null },
    include: {
      fields: {
        orderBy: { position: 'asc' },
      },
    },
  });

  if (!source) {
    throw new Error('Form not found');
  }

  const slug = await generateUniqueFormSlug();
  const title = overrideTitle?.trim() || `${source.title} (Copy)`;

  const duplicated = await prisma.$transaction(async (tx) => {
    const form = await tx.form.create({
      data: {
        tenantId: params.tenantId,
        title,
        description: source.description,
        slug,
        status: 'DRAFT',
        tags: source.tags,
        // A copy is an ordinary editable form, not a template instance.
        settings: toJsonInput(preserveFormTemplateBinding(
          source.settings && typeof source.settings === 'object' && !Array.isArray(source.settings)
            ? source.settings as Record<string, unknown>
            : null,
          null
        ) ?? null),
        createdById: params.userId,
        updatedById: params.userId,
      },
      include: {
        tenant: {
          select: {
            logoUrl: true,
            name: true,
          },
        },
      },
    });

    if (source.fields.length > 0) {
      await tx.formField.createMany({
        data: source.fields.map((field) => ({
          formId: form.id,
          tenantId: params.tenantId,
          type: field.type,
          label: field.label,
          key: field.key,
          placeholder: field.placeholder,
          subtext: field.subtext,
          helpText: field.helpText,
          inputType: field.inputType,
          optionPresetId: field.optionPresetId,
          options: field.options ?? Prisma.JsonNull,
          validation: field.validation ?? Prisma.JsonNull,
          condition: field.condition ?? Prisma.JsonNull,
          isRequired: field.isRequired,
          hideLabel: field.hideLabel,
          isReadOnly: field.isReadOnly,
          layoutWidth: field.layoutWidth,
          position: field.position,
        })),
      });
    }

    const fields = await tx.formField.findMany({
      where: { formId: form.id },
      orderBy: { position: 'asc' },
    });

    return {
      ...form,
      fields,
      tenantLogoUrl: normalizeWorkspaceLogoUrl(form.tenant?.logoUrl),
      tenantName: form.tenant?.name ?? null,
    };
  });

  await createAuditLog({
    tenantId: params.tenantId,
    userId: params.userId,
    action: 'CREATE',
    entityType: 'Form',
    entityId: duplicated.id,
    entityName: duplicated.title,
    summary: `Duplicated form "${source.title}"`,
    metadata: { sourceFormId: source.id },
    changeSource: 'MANUAL',
  });

  return {
    ...duplicated,
    fields: await resolvePresetOptionsForFields(params.tenantId, duplicated.fields),
  };
}

export async function deleteForm(
  formId: string,
  params: TenantAwareParams,
  reason?: string
): Promise<Form> {
  const existing = await prisma.form.findFirst({
    where: { id: formId, tenantId: params.tenantId, deletedAt: null },
  });

  if (!existing) {
    throw new Error('Form not found');
  }

  const deleted = await prisma.form.update({
    where: { id: formId },
    data: {
      deletedAt: null,
      updatedById: params.userId,
      status: 'ARCHIVED',
      slug: getArchivedFormSlug(formId),
    },
  });

  await createAuditLog({
    tenantId: params.tenantId,
    userId: params.userId,
    action: 'DELETE',
    entityType: 'Form',
    entityId: formId,
    entityName: existing.title,
    summary: `Archived form "${existing.title}"`,
    reason,
    changeSource: 'MANUAL',
  });

  return deleted;
}

export async function hardDeleteArchivedForm(
  formId: string,
  params: TenantAwareParams
): Promise<Form> {
  const existing = await prisma.form.findFirst({
    where: {
      id: formId,
      tenantId: params.tenantId,
      OR: [{ deletedAt: null }, { status: 'ARCHIVED' }],
    },
  });

  if (!existing) {
    throw new Error('Form not found');
  }

  if (existing.status !== 'ARCHIVED') {
    throw new Error('Only archived forms can be permanently deleted');
  }

  const uploads = await prisma.formUpload.findMany({
    where: { formId, tenantId: params.tenantId },
    select: { id: true, storageKey: true },
  });

  const deleteResults = await Promise.allSettled(
    uploads.map((upload) => storage.delete(upload.storageKey))
  );

  deleteResults.forEach((result, index) => {
    if (result.status === 'fulfilled') return;

    const upload = uploads[index];
    log.error('Failed to delete form upload during permanent form deletion', {
      formId,
      uploadId: upload?.id,
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
    });
  });

  const deleted = await prisma.form.delete({
    where: { id: formId },
  });
  await deleteUnusedFormBackgroundsSafely(params.tenantId, formId, { graceMs: 0 });

  await createAuditLog({
    tenantId: params.tenantId,
    userId: params.userId,
    action: 'DELETE',
    entityType: 'Form',
    entityId: formId,
    entityName: existing.title,
    summary: `Permanently deleted archived form "${existing.title}"`,
    changeSource: 'MANUAL',
  });

  return deleted;
}
