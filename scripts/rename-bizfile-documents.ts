import { pathToFileURL } from 'node:url';
import { prisma } from '../src/lib/prisma';
import { bizFileApprovedFileName } from '../src/services/bizfile/processor';
import type { ExtractedBizFileData } from '../src/services/bizfile/types';
import { flag, option } from './lib/oakdoc-cli-args';

/**
 * Give approved BizFile documents that still carry their upload name
 * (<uuid>.pdf) the readable BizFile name shown in Document Processing:
 *
 *   npx tsx scripts/rename-bizfile-documents.ts --email <login> [--apply]
 *
 * Without --apply it only lists the renames. Only the display name changes;
 * stored files stay where they are. Names someone already changed are kept.
 */
const UPLOAD_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]+$/i;

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

  const documents = await prisma.document.findMany({
    where: { tenantId: user.tenantId, documentType: 'BIZFILE', extractionStatus: 'COMPLETED', deletedAt: null },
    select: {
      id: true, fileName: true, originalFileName: true, storageKey: true, extractedData: true,
      company: { select: { name: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const renamed: { company: string | null; from: string; to: string }[] = [];
  for (const document of documents) {
    if (!UPLOAD_NAME.test(document.fileName) || !document.extractedData) continue;
    const fileName = bizFileApprovedFileName(
      document.extractedData as unknown as ExtractedBizFileData,
      document.originalFileName || document.fileName || document.storageKey,
    );
    if (fileName === document.fileName) continue;
    renamed.push({ company: document.company?.name ?? null, from: document.fileName, to: fileName });
    if (apply) await prisma.document.update({ where: { id: document.id }, data: { fileName } });
  }

  console.info(JSON.stringify({ applied: apply, checked: documents.length, renamed }, null, 2));
  if (!apply && renamed.length > 0) console.info('Nothing was changed. Re-run with --apply to rename these.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : 'Rename failed');
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
