import { pathToFileURL } from 'node:url';
import { prisma } from '../src/lib/prisma';
import { replaceOakDocFont } from '../src/lib/document-editor/oakdoc-font-replace';
import { readOakDocTemplateMetadata } from '../src/lib/document-editor/oakdoc-template';
import { downloadOakDocTemplate, updateOakDocTemplate } from '../src/services/oakdoc-template.service';
import {
  downloadOakDocPartial,
  readOakDocPartialMetadata,
  updateOakDocPartial,
} from '../src/services/oakdoc-partial.service';
import { flag, option } from './lib/oakdoc-cli-args';

/**
 * Switch a font across a workspace's Word templates and partials, e.g. the
 * Aptos default of documents started blank:
 *
 *   npx tsx scripts/oakdoc-replace-font.ts --email <login> [--from Aptos] [--to Arial] [--apply]
 *
 * Without --apply it only lists what would change. With --apply each changed
 * document is saved as a new version, which can be rolled back like any edit.
 */
async function main(argv: readonly string[]) {
  const email = option(argv, 'email')?.trim();
  const from = option(argv, 'from') ?? 'Aptos';
  const to = option(argv, 'to') ?? 'Arial';
  const apply = flag(argv, 'apply');
  const user = email
    ? await prisma.user.findFirst({
        where: { email: { equals: email, mode: 'insensitive' }, deletedAt: null, isActive: true },
        select: { id: true, tenantId: true },
      })
    : null;
  if (!user?.tenantId) throw new Error('--email must name an active user in a workspace');
  const actor = { tenantId: user.tenantId, userId: user.id };

  const changes: { kind: 'template' | 'partial'; name: string; replaced: number }[] = [];

  const templates = await prisma.documentTemplate.findMany({
    where: { tenantId: actor.tenantId, deletedAt: null },
    select: { id: true, name: true, version: true, contentJson: true },
    orderBy: { name: 'asc' },
  });
  for (const template of templates) {
    const metadata = readOakDocTemplateMetadata(template.contentJson);
    if (!metadata) continue;
    const { buffer } = await downloadOakDocTemplate(template.id, actor.tenantId);
    const result = replaceOakDocFont(new Uint8Array(buffer), from, to);
    if (result.replaced === 0) continue;
    changes.push({ kind: 'template', name: template.name, replaced: result.replaced });
    if (apply) {
      await updateOakDocTemplate({
        id: template.id,
        expectedRevision: template.version,
        fileName: metadata.fileName,
        buffer: Buffer.from(result.bytes),
      }, actor);
    }
  }

  const partials = await prisma.templatePartial.findMany({
    where: { tenantId: actor.tenantId, deletedAt: null },
    select: { id: true, name: true, displayName: true, contentJson: true },
    orderBy: { name: 'asc' },
  });
  for (const partial of partials) {
    const metadata = readOakDocPartialMetadata(partial.contentJson);
    if (!metadata) continue;
    const { buffer, version } = await downloadOakDocPartial(partial.id, actor.tenantId);
    const result = replaceOakDocFont(new Uint8Array(buffer), from, to);
    if (result.replaced === 0) continue;
    changes.push({ kind: 'partial', name: partial.displayName || partial.name, replaced: result.replaced });
    if (apply) {
      await updateOakDocPartial({
        id: partial.id,
        expectedRevision: version,
        fileName: metadata.fileName,
        buffer: Buffer.from(result.bytes),
      }, actor);
    }
  }

  console.info(JSON.stringify({ from, to, applied: apply, changes }, null, 2));
  if (!apply && changes.length > 0) console.info('Nothing was saved. Re-run with --apply to save these changes.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : 'Font replacement failed');
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
