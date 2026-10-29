import { pathToFileURL } from 'node:url';
import { canonicalizeContactAlias, canonicalizeContactName } from '@/lib/contact-identity-normalization';
import { prisma } from '@/lib/prisma';

const DEFAULT_BATCH_SIZE = 500;

export interface ContactCanonicalBackfillOptions {
  batchSize?: number;
  resumeAfter?: string | null;
}

export interface ContactCanonicalBackfillResult {
  processed: number;
  updated: number;
  skipped: number;
  failed: number;
  lastId: string | null;
}

export function parseBackfillArgs(
  args: string[],
  environment: Record<string, string | undefined> = {},
): Required<ContactCanonicalBackfillOptions> {
  let batchSize = DEFAULT_BATCH_SIZE;
  let resumeAfter: string | null = null;
  const npmArgs = [
    environment.npm_config_batch_size
      ? `--batch-size=${environment.npm_config_batch_size}`
      : null,
    environment.npm_config_resume_after
      ? `--resume-after=${environment.npm_config_resume_after}`
      : null,
  ].filter((value): value is string => value !== null);

  for (const arg of [...npmArgs, ...args]) {
    if (arg.startsWith('--batch-size=')) {
      batchSize = Number(arg.slice('--batch-size='.length));
      if (!Number.isSafeInteger(batchSize) || batchSize <= 0) {
        throw new Error('--batch-size must be a positive integer');
      }
      continue;
    }
    if (arg.startsWith('--resume-after=')) {
      resumeAfter = arg.slice('--resume-after='.length).trim() || null;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { batchSize, resumeAfter };
}

export async function backfillContactCanonicalNames(
  options: ContactCanonicalBackfillOptions = {},
): Promise<ContactCanonicalBackfillResult> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  if (!Number.isSafeInteger(batchSize) || batchSize <= 0) {
    throw new Error('batchSize must be a positive integer');
  }

  const result: ContactCanonicalBackfillResult = {
    processed: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    lastId: options.resumeAfter ?? null,
  };

  while (true) {
    const contacts = await prisma.contact.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        id: { gt: result.lastId ?? undefined },
      },
      orderBy: { id: 'asc' },
      take: batchSize,
      select: { id: true, fullName: true, canonicalName: true, alias: true, canonicalAlias: true },
    });
    if (contacts.length === 0) break;

    result.processed += contacts.length;
    const updates = contacts.flatMap((contact) => {
      const canonicalName = canonicalizeContactName(contact.fullName);
      const canonicalAlias = canonicalizeContactAlias(contact.alias);
      return contact.canonicalName === canonicalName && contact.canonicalAlias === canonicalAlias
        ? []
        : [{ id: contact.id, canonicalName, canonicalAlias }];
    });

    try {
      await prisma.$transaction(async (transaction) => {
        await Promise.all(updates.map(({ id, canonicalName, canonicalAlias }) =>
          transaction.contact.update({
            where: { id },
            data: { canonicalName, canonicalAlias },
          }),
        ));
      });
    } catch {
      result.failed += contacts.length;
      break;
    }

    result.updated += updates.length;
    result.skipped += contacts.length - updates.length;
    result.lastId = contacts[contacts.length - 1].id;
  }

  return result;
}

async function main(): Promise<void> {
  const result = await backfillContactCanonicalNames(
    parseBackfillArgs(process.argv.slice(2), process.env),
  );
  console.info(JSON.stringify(result));
  if (result.failed > 0) process.exitCode = 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (invokedPath === import.meta.url) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
