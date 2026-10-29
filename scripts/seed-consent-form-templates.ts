/**
 * Seed the starter consent forms into a workspace: "F45" (consent to act as
 * director, one document for each director ticked on Configure) and "F45B"
 * (consent to act as secretary, one for each contact ticked on the
 * "Corporate secretary to be appointed" list).
 *
 *   npx tsx scripts/seed-consent-form-templates.ts --email <login> [--replace]
 *
 * Creates each template the workspace has none of by that name. An existing
 * one is left alone unless --replace is given, which saves the starter layout
 * over it as a new version (in-app edits, including a contacts shortlist,
 * are overwritten).
 */
import { pathToFileURL } from 'node:url';
import { prisma } from '../src/lib/prisma';
import { ensureA4ServerDomGlobals } from '../src/lib/document-editor/a4-server-dom';
import { createOakDocTemplate, updateOakDocTemplate } from '../src/services/oakdoc-template.service';
import { CONSENT_FORM_STARTERS } from '../src/content/secretarial/consent-forms-oakdoc';
import { flag, option } from './lib/oakdoc-cli-args';

async function operator(): Promise<{ tenantId: string; userId: string }> {
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

async function main() {
  ensureA4ServerDomGlobals();
  const params = await operator();
  const replace = flag(process.argv, 'replace');
  for (const starter of CONSENT_FORM_STARTERS) {
    const existing = await prisma.documentTemplate.findFirst({
      where: { tenantId: params.tenantId, name: starter.name, deletedAt: null },
      select: { id: true, version: true },
    });
    if (existing && !replace) {
      console.info(`"${starter.name}" already exists (${existing.id}); left unchanged. Pass --replace to overwrite it with the starter layout.`);
      continue;
    }
    const buffer = Buffer.from(starter.build());
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
      console.info(`Replaced "${updated.name}" (${updated.id}) with the starter layout.`);
      continue;
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
    console.info(`Created "${created.name}" (${created.id}). Open Document Templates to review it.`);
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
