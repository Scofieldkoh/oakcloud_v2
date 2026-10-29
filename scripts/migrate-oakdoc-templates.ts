import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { prisma } from '@/lib/prisma';
import { migrateCanonicalOakDocTemplates } from '@/services/oakdoc-consolidated-migration.service';
import { flag, uuidOption } from './lib/oakdoc-cli-args';

/**
 * Create or update the canonical OakDoc templates in one workspace.
 *
 *   tsx scripts/migrate-oakdoc-templates.ts --workspace <id> --operator <user id>          (dry run)
 *   tsx scripts/migrate-oakdoc-templates.ts --workspace <id> --operator <user id> --apply  (writes)
 *
 * The workspace and operator are always explicit; there is no all-workspace
 * mode and no "earliest user" fallback.
 */
export async function runTemplateMigration(argv: readonly string[]) {
  const tenantId = uuidOption(argv, 'workspace');
  const userId = uuidOption(argv, 'operator');
  const operator = await prisma.user.findFirst({
    where: { id: userId, tenantId, isActive: true, deletedAt: null },
    select: { id: true },
  });
  if (!operator) throw new Error('The operator is not an active member of this workspace');

  if (!flag(argv, 'apply')) {
    return {
      mode: 'dry-run',
      workspaceId: tenantId,
      operatorId: userId,
      note: 'No changes made. Re-run with --apply to create or update the canonical OakDoc templates.',
    };
  }
  const result = await migrateCanonicalOakDocTemplates({ tenantId, userId });
  return {
    mode: 'apply',
    workspaceId: tenantId,
    standard: result.standard,
    serviceAgreement: result.serviceAgreement,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runTemplateMigration(process.argv.slice(2))
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error) => {
      console.error('OakDoc template migration failed:', error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
