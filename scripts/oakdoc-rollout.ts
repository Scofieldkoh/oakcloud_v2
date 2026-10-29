import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { prisma } from '@/lib/prisma';
import {
  applyA4LibraryRemoval,
  applyTemplateCutover,
  buildA4LibraryRemovalPlan,
  buildOakDocRolloutInventory,
  buildTemplateCutoverPlan,
} from '@/services/oakdoc-rollout.service';
import { flag, option, uuidOption } from './lib/oakdoc-cli-args';

function manifestOption(argv: readonly string[]): string {
  const manifestHash = option(argv, 'manifest');
  if (!manifestHash || !/^[a-f0-9]{64}$/.test(manifestHash)) {
    throw new Error('--manifest must be the 64-character hash printed by the dry run');
  }
  return manifestHash;
}

/**
 * OakDoc rollout for one workspace.
 *
 *   Dry run (default, no writes):
 *     tsx scripts/oakdoc-rollout.ts --workspace <id>
 *   Switch validated template pairs to Word, or roll them back to A4, using
 *   the matching plan hash from the dry run:
 *     tsx scripts/oakdoc-rollout.ts --workspace <id> --apply-template-cutover \
 *       --operator <user id> --manifest <hash> --reason "<why>"
 *     tsx scripts/oakdoc-rollout.ts --workspace <id> --apply-template-rollback \
 *       --operator <user id> --manifest <hash> --reason "<why>"
 *   Remove (soft-delete) every remaining A4 template and HTML partial, using
 *   the a4LibraryRemoval hash from the dry run:
 *     tsx scripts/oakdoc-rollout.ts --workspace <id> --remove-a4-library \
 *       --operator <user id> --manifest <hash> --reason "<why>"
 *
 * Every apply run is journaled in the audit log (OakDocRolloutRun).
 * Output is JSON with IDs, revisions, hashes and statuses only.
 */
export async function runOakDocRollout(argv: readonly string[]) {
  const tenantId = uuidOption(argv, 'workspace');
  const cutover = flag(argv, 'apply-template-cutover');
  const rollback = flag(argv, 'apply-template-rollback');
  const removeA4 = flag(argv, 'remove-a4-library');
  if ([cutover, rollback, removeA4].filter(Boolean).length > 1) {
    throw new Error('Choose one apply step per run');
  }
  if (removeA4) {
    const run = await applyA4LibraryRemoval({
      tenantId,
      userId: uuidOption(argv, 'operator'),
      manifestHash: manifestOption(argv),
      reason: option(argv, 'reason') ?? '',
    });
    return { mode: 'remove-a4-library', ...run };
  }
  if (cutover || rollback) {
    const run = await applyTemplateCutover({
      tenantId,
      userId: uuidOption(argv, 'operator'),
      direction: cutover ? 'OAKDOC' : 'LEGACY',
      manifestHash: manifestOption(argv),
      reason: option(argv, 'reason') ?? '',
    });
    return { mode: cutover ? 'apply-template-cutover' : 'apply-template-rollback', ...run };
  }
  const [inventory, templateCutover, templateRollback, a4LibraryRemoval] = await Promise.all([
    buildOakDocRolloutInventory(tenantId),
    buildTemplateCutoverPlan(tenantId, 'OAKDOC'),
    buildTemplateCutoverPlan(tenantId, 'LEGACY'),
    buildA4LibraryRemovalPlan(tenantId),
  ]);
  return { mode: 'dry-run', inventory, templateCutover, templateRollback, a4LibraryRemoval };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runOakDocRollout(process.argv.slice(2))
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if ('results' in result && result.results.some((item) => item.outcome === 'failed')) {
        process.exitCode = 1;
      }
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : 'OakDoc rollout failed');
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
