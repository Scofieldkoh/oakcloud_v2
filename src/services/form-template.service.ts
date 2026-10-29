import type { Form, Prisma } from '@/generated/prisma';
import { ValidationError } from '@/lib/errors';
import { parseFormTemplateBinding } from '@/lib/form-templates';
import {
  SG_COMPANY_INCORPORATION_TEMPLATE_KEY,
  SG_COMPANY_INCORPORATION_TEMPLATE_VERSION,
  SG_COMPANY_INCORPORATION_TITLE,
  buildSgCompanyIncorporationFields,
  buildSgCompanyIncorporationSettings,
} from '@/lib/form-templates/sg-company-incorporation';
import { prisma } from '@/lib/prisma';
import type { TenantAwareParams } from '@/lib/types';
import { saveFormFieldsSchema } from '@/lib/validations/form-builder';
import { createForm, saveFormFields } from './form-crud.service';
import { ensureBuiltInFormOptionPresets } from './form-option-preset.service';

export interface SeedFormResult {
  form: Form;
  action: 'created' | 'updated';
}

/**
 * Seed the Singapore Company Incorporation form into a workspace.
 *
 * An unpublished form already bound to the template is updated in place with the
 * current questions; otherwise (none yet, or every copy published and locked) a new
 * DRAFT form is created. Nothing is published; staff review and publish it in the
 * builder as usual.
 */
export async function seedCompanyIncorporationForm(params: TenantAwareParams): Promise<SeedFormResult> {
  await ensureBuiltInFormOptionPresets(params.tenantId, params.userId);
  const presetId = (builtInKey: string) => prisma.formOptionPreset.findUnique({
    where: { tenantId_builtInKey: { tenantId: params.tenantId, builtInKey } },
    select: { id: true },
  });
  const [ssicPreset, nationalityPreset, countryPreset, workspace, candidates] = await Promise.all([
    presetId('ssic'),
    presetId('nationalities'),
    presetId('countries'),
    prisma.workspace.findUnique({ where: { id: params.tenantId }, select: { name: true } }),
    prisma.form.findMany({
      where: { tenantId: params.tenantId, deletedAt: null, status: 'DRAFT' },
      select: { id: true, settings: true },
      orderBy: { updatedAt: 'desc' },
    }),
  ]);
  if (!ssicPreset || !nationalityPreset || !countryPreset) {
    throw new ValidationError('The SSIC, nationality or country option list is unavailable in this workspace');
  }

  const firmName = workspace?.name?.trim() || '';
  const fields = saveFormFieldsSchema.parse({
    fields: buildSgCompanyIncorporationFields({
      firmName,
      ssicPresetId: ssicPreset.id,
      nationalityPresetId: nationalityPreset.id,
      countryPresetId: countryPreset.id,
    }),
  }).fields;

  const existing = candidates.find((candidate) => {
    const binding = parseFormTemplateBinding(candidate.settings);
    return binding?.key === SG_COMPANY_INCORPORATION_TEMPLATE_KEY && !binding.lockedAt;
  });

  const form = existing
    ? { id: existing.id }
    : await createForm({
      title: SG_COMPANY_INCORPORATION_TITLE,
      tags: ['incorporation'],
      status: 'DRAFT',
    }, params);

  const reason = existing
    ? `Updated to template version ${SG_COMPANY_INCORPORATION_TEMPLATE_VERSION}`
    : `Seeded from template version ${SG_COMPANY_INCORPORATION_TEMPLATE_VERSION}`;
  await saveFormFields(form.id, fields, params, reason);

  // The binding is server-owned: updateForm preserves an existing binding but will
  // not accept one from a settings payload, so write it directly here. Settings the
  // template does not own (notifications, branding) are kept on an update.
  const previousSettings = existing?.settings && typeof existing.settings === 'object' && !Array.isArray(existing.settings)
    ? existing.settings as Record<string, unknown>
    : {};
  const settings = {
    ...previousSettings,
    ...buildSgCompanyIncorporationSettings({ firmName }),
    template: {
      key: SG_COMPANY_INCORPORATION_TEMPLATE_KEY,
      version: SG_COMPANY_INCORPORATION_TEMPLATE_VERSION,
      installedAt: new Date().toISOString(),
      definitionHash: null,
      lockedAt: null,
    },
  } as Prisma.InputJsonValue;

  const saved = await prisma.form.update({
    where: { id: form.id },
    // The form shows no description; the first page's introduction covers it.
    data: { settings, description: null },
  });
  return { form: saved, action: existing ? 'updated' : 'created' };
}
