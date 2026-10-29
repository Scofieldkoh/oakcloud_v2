/**
 * Seed the starter resolution templates into a workspace: "Board Resolution
 * (Numbered)", "Members Resolution (Numbered)" and "First Board Resolution"
 * with its seven resolution partials, preset in the reference order.
 *
 *   npx tsx scripts/seed-resolution-template.ts --email <login> [--replace]
 *
 * Creates each template and partial the workspace has none of by that name.
 * An existing one is left alone unless --replace is given, which saves the
 * starter layout over it as a new version (in-app edits are overwritten) and
 * resets the First Board Resolution's preset resolutions.
 */
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { prisma } from '../src/lib/prisma';
import { ensureA4ServerDomGlobals } from '../src/lib/document-editor/a4-server-dom';
import { createOakDocTemplate, updateOakDocTemplate } from '../src/services/oakdoc-template.service';
import { createOakDocPartial, updateOakDocPartial } from '../src/services/oakdoc-partial.service';
import { setDocumentTemplateResolutionPreset } from '../src/services/document-template.service';
import {
  BOARD_RESOLUTION_PLACEHOLDERS,
  BOARD_RESOLUTION_TEMPLATE,
  MEMBERS_RESOLUTION_TEMPLATE,
  buildBoardResolutionOakDocMaster,
  buildMembersResolutionOakDocMaster,
} from '../src/content/resolution/board-resolution-oakdoc';
import {
  FIRST_BOARD_RESOLUTION_PARTIALS,
  FIRST_BOARD_RESOLUTION_PLACEHOLDERS,
  FIRST_BOARD_RESOLUTION_TEMPLATE,
  buildFirstBoardResolutionOakDocMaster,
  type SeedResolutionPartial,
} from '../src/content/resolution/first-board-resolution-oakdoc';
import type { ResolutionComposition } from '../src/lib/resolution-composition';
import type { PlaceholderDefinition } from '../src/lib/validations/document-template';
import { flag, option } from './lib/oakdoc-cli-args';

type Operator = { tenantId: string; userId: string };

async function operator(): Promise<Operator> {
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

interface Starter {
  template: typeof BOARD_RESOLUTION_TEMPLATE;
  build: () => Uint8Array;
  placeholders: PlaceholderDefinition[];
  /** Partials the template's preset resolutions use, in order. */
  partials?: readonly SeedResolutionPartial[];
}

const STARTERS: Starter[] = [
  { template: BOARD_RESOLUTION_TEMPLATE, build: buildBoardResolutionOakDocMaster, placeholders: BOARD_RESOLUTION_PLACEHOLDERS },
  { template: MEMBERS_RESOLUTION_TEMPLATE, build: buildMembersResolutionOakDocMaster, placeholders: BOARD_RESOLUTION_PLACEHOLDERS },
  {
    template: FIRST_BOARD_RESOLUTION_TEMPLATE,
    build: buildFirstBoardResolutionOakDocMaster,
    placeholders: FIRST_BOARD_RESOLUTION_PLACEHOLDERS,
    partials: FIRST_BOARD_RESOLUTION_PARTIALS,
  },
];

/** Each partial's id, creating the missing ones (and overwriting with --replace). */
async function seedPartial(partial: SeedResolutionPartial, params: Operator, replace: boolean): Promise<string> {
  const existing = await prisma.templatePartial.findFirst({
    where: { tenantId: params.tenantId, name: partial.name },
    select: { id: true, version: true, deletedAt: true },
  });
  if (existing?.deletedAt) {
    throw new Error(`The partial "${partial.name}" is in the Recycle Bin. Restore or purge it, then run this again.`);
  }
  const fileName = `${partial.name}.docx`;
  const buffer = Buffer.from(partial.build());
  if (existing && !replace) {
    console.info(`Partial "${partial.name}" already exists; left unchanged.`);
    return existing.id;
  }
  if (existing) {
    await updateOakDocPartial({
      id: existing.id,
      expectedRevision: existing.version,
      fileName,
      buffer,
      displayName: partial.displayName,
      description: null,
      placeholders: partial.placeholders ?? [],
    }, params);
    console.info(`Replaced partial "${partial.name}" with the starter wording.`);
    return existing.id;
  }
  const created = await createOakDocPartial({
    id: randomUUID(),
    name: partial.name,
    displayName: partial.displayName,
    header: partial.header,
    category: 'RESOLUTION',
    fileName,
    buffer,
    placeholders: partial.placeholders,
  }, params);
  console.info(`Created partial "${partial.name}".`);
  return created.id;
}

async function main() {
  ensureA4ServerDomGlobals();
  const params = await operator();
  const replace = flag(process.argv, 'replace');
  for (const { template, build, placeholders, partials } of STARTERS) {
    const existing = await prisma.documentTemplate.findFirst({
      where: { tenantId: params.tenantId, name: template.name, deletedAt: null },
      select: { id: true, version: true },
    });

    if (existing && !replace) {
      console.info(`"${template.name}" already exists (${existing.id}); left unchanged. Pass --replace to overwrite it with the starter layout.`);
      continue;
    }
    const buffer = Buffer.from(build());
    let templateId: string;
    if (existing) {
      const updated = await updateOakDocTemplate({
        id: existing.id,
        expectedRevision: existing.version,
        category: template.category,
        compositionType: template.compositionType,
        fileName: template.fileName,
        buffer,
        placeholders,
      }, params);
      templateId = updated.id;
      console.info(`Replaced "${updated.name}" (${updated.id}) with the starter layout.`);
    } else {
      const created = await createOakDocTemplate({
        name: template.name,
        description: template.description,
        category: template.category,
        compositionType: template.compositionType,
        isActive: true,
        fileName: template.fileName,
        buffer,
        placeholders,
      }, params);
      templateId = created.id;
      console.info(`Created "${created.name}" (${created.id}). Open Document Templates to review it.`);
    }

    if (!partials) continue;
    const preset: ResolutionComposition = { subject: '', sections: [] };
    for (const [index, partial] of partials.entries()) {
      preset.sections.push({
        id: `preset-${index + 1}`,
        kind: 'PARTIAL',
        heading: partial.header,
        partialId: await seedPartial(partial, params, replace),
      });
    }
    await setDocumentTemplateResolutionPreset(templateId, preset, params);
    console.info(`Preset ${preset.sections.length} resolutions on "${template.name}".`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : 'Seed failed');
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
