import { randomUUID } from 'node:crypto';
import { prisma } from '../../src/lib/prisma';
import { createOakDocTemplate, updateOakDocTemplate } from '../../src/services/oakdoc-template.service';
import { createOakDocPartial, updateOakDocPartial } from '../../src/services/oakdoc-partial.service';
import { setDocumentTemplateResolutionPreset } from '../../src/services/document-template.service';
import type { CorpSecPartial, CorpSecResolutionTemplate } from '../../src/content/secretarial/corp-sec-resolutions';
import type { ResolutionComposition } from '../../src/lib/resolution-composition';
import type { PlaceholderDefinition } from '../../src/lib/validations/document-template';
import { option } from './oakdoc-cli-args';

/** Shared by the corporate secretarial seeds: find-or-create partials and templates by name. */

export type Operator = { tenantId: string; userId: string };

export async function operator(): Promise<Operator> {
  const email = option(process.argv, 'email')?.trim().toLowerCase() ?? '';
  const user = email
    ? await prisma.user.findFirst({
        where: { email: { equals: email, mode: 'insensitive' }, deletedAt: null, isActive: true },
        select: { id: true, tenantId: true },
      })
    : null;
  if (!user?.tenantId) throw new Error('--email must name an active user in a workspace');
  return { tenantId: user.tenantId, userId: user.id };
}

/** The partial's id, creating it when missing (and overwriting it with --replace). */
export async function seedPartial(partial: CorpSecPartial, params: Operator, replace: boolean): Promise<string> {
  const existing = await prisma.templatePartial.findFirst({
    where: { tenantId: params.tenantId, name: partial.name },
    select: { id: true, version: true, deletedAt: true },
  });
  if (existing?.deletedAt) {
    throw new Error(`The partial "${partial.name}" is in the Recycle Bin. Restore or purge it, then run this again.`);
  }
  if (existing && !replace) {
    console.info(`Partial "${partial.displayName}" already exists; left unchanged.`);
    return existing.id;
  }
  const { bytes, placeholders } = partial.build();
  const fileName = `${partial.name}.docx`;
  if (existing) {
    await updateOakDocPartial({
      id: existing.id,
      expectedRevision: existing.version,
      fileName,
      buffer: Buffer.from(bytes),
      displayName: partial.displayName,
      header: partial.header,
      description: null,
      placeholders,
    }, params);
    console.info(`Replaced partial "${partial.displayName}".`);
    return existing.id;
  }
  const created = await createOakDocPartial({
    id: randomUUID(),
    name: partial.name,
    displayName: partial.displayName,
    header: partial.header,
    category: 'RESOLUTION',
    fileName,
    buffer: Buffer.from(bytes),
    placeholders,
  }, params);
  console.info(`Created partial "${partial.displayName}".`);
  return created.id;
}

export interface TemplateStarter {
  name: string;
  description: string;
  fileName: string;
  category: 'RESOLUTION' | 'LETTER' | 'MINUTES' | 'NOTICE' | 'CERTIFICATE' | 'CONTRACT' | 'OTHER';
  compositionType: 'RESOLUTION' | 'STANDARD';
  bytes: Uint8Array;
  placeholders: PlaceholderDefinition[];
}

/** The template's id when it was created or replaced; null when left unchanged. */
export async function seedTemplate(starter: TemplateStarter, params: Operator, replace: boolean): Promise<string | null> {
  const existing = await prisma.documentTemplate.findFirst({
    where: { tenantId: params.tenantId, name: starter.name, deletedAt: null },
    select: { id: true, version: true },
  });
  if (existing && !replace) {
    console.info(`"${starter.name}" already exists; left unchanged. Pass --replace to overwrite it with the starter layout.`);
    return null;
  }
  const buffer = Buffer.from(starter.bytes);
  if (existing) {
    const updated = await updateOakDocTemplate({
      id: existing.id,
      expectedRevision: existing.version,
      category: starter.category,
      compositionType: starter.compositionType,
      fileName: starter.fileName,
      buffer,
      placeholders: starter.placeholders,
    }, params);
    console.info(`Replaced "${updated.name}" with the starter layout.`);
    return updated.id;
  }
  const created = await createOakDocTemplate({
    name: starter.name,
    description: starter.description,
    category: starter.category,
    compositionType: starter.compositionType,
    isActive: true,
    fileName: starter.fileName,
    buffer,
    placeholders: starter.placeholders,
  }, params);
  console.info(`Created "${created.name}".`);
  return created.id;
}

/**
 * Seeds a resolution template and, when it was created or replaced, presets
 * its resolutions from the partials' ids.
 */
export async function seedResolutionTemplate(
  template: CorpSecResolutionTemplate,
  partialIds: ReadonlyMap<CorpSecPartial, string>,
  params: Operator,
  replace: boolean,
): Promise<void> {
  const templateId = await seedTemplate({ ...template, bytes: template.build() }, params, replace);
  if (!templateId) return;
  const preset: ResolutionComposition = {
    subject: template.heading ?? '',
    sections: template.partials.map((partial, index) => {
      const partialId = partialIds.get(partial);
      if (!partialId) throw new Error(`No partial "${partial.displayName}" for "${template.name}"`);
      return { id: `preset-${index + 1}`, kind: 'PARTIAL' as const, heading: partial.header, partialId };
    }),
  };
  await setDocumentTemplateResolutionPreset(templateId, preset, params);
}
