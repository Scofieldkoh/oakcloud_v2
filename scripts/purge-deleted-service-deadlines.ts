import { pathToFileURL } from 'node:url';
import { prisma } from '../src/lib/prisma';
import { purgeDeletedServiceObligations } from '../src/services/compliance-monitoring/writer';
import { currentDateInSingapore } from '../src/services/service-schedule/date-only';
import { flag, option } from './lib/oakdoc-cli-args';

/**
 * Remove company ECI / Form C deadlines left behind by client services that
 * were permanently deleted before deletion cleaned them up:
 *
 *   npx tsx scripts/purge-deleted-service-deadlines.ts --email <login> [--apply]
 *
 * Without --apply it only lists what would be removed. Deadlines another
 * service still covers are kept.
 */
class Preview extends Error {}

export async function main(argv: readonly string[]) {
  const email = option(argv, 'email')?.trim();
  const apply = flag(argv, 'apply');
  const user = email
    ? await prisma.user.findFirst({
        where: { email: { equals: email, mode: 'insensitive' }, deletedAt: null, isActive: true },
        select: { tenantId: true },
      })
    : null;
  if (!user?.tenantId) throw new Error('--email must name an active user in a workspace');
  const tenantId = user.tenantId;
  const today = currentDateInSingapore();

  const [coverages, orphanLinks] = await Promise.all([
    prisma.companyMonitoringCoverage.findMany({ where: { tenantId, clientServiceId: null }, select: { companyId: true } }),
    prisma.deadlineOccurrenceCoverageLink.findMany({
      where: { tenantId, reason: 'CONTRACTED_DELIVERY', coverageId: null, deliveryScopeId: null },
      select: { occurrence: { select: { companyId: true } } },
    }),
  ]);
  const companyIds = [...new Set([
    ...coverages.map((row) => row.companyId),
    ...orphanLinks.map((row) => row.occurrence.companyId),
  ])].sort();

  const removed: { company: string; filing: string; period: string | null; dueDate: string; status: string }[] = [];
  for (const companyId of companyIds) {
    try {
      await prisma.$transaction(async (tx) => {
        const company = await tx.company.findFirst({ where: { id: companyId, tenantId }, select: { name: true } });
        const rows = await tx.deadlineOccurrence.findMany({
          where: { tenantId, companyId, ownershipScope: 'COMPANY' },
          select: { id: true, obligationCode: true, obligationPeriodKey: true, operativeDueDate: true, status: true },
        });
        await purgeDeletedServiceObligations(tx, { tenantId, companyId, today });
        const remaining = new Set((await tx.deadlineOccurrence.findMany({
          where: { tenantId, companyId, ownershipScope: 'COMPANY' },
          select: { id: true },
        })).map((row) => row.id));
        for (const row of rows) {
          if (remaining.has(row.id)) continue;
          removed.push({
            company: company?.name ?? companyId,
            filing: row.obligationCode ?? '',
            period: row.obligationPeriodKey,
            dueDate: row.operativeDueDate.toISOString().slice(0, 10),
            status: row.status,
          });
        }
        if (!apply) throw new Preview();
      });
    } catch (error) {
      if (!(error instanceof Preview)) throw error;
    }
  }

  console.info(JSON.stringify({ applied: apply, companies: companyIds.length, removed }, null, 2));
  if (!apply && companyIds.length > 0) console.info('Nothing was changed. Re-run with --apply to remove these.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : 'Cleanup failed');
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
