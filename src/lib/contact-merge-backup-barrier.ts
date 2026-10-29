import { Prisma } from '@/generated/prisma';

export const CONTACT_MERGE_BACKUP_BARRIER_TIMEOUT_MS = 300_000;

type BarrierClient = Pick<Prisma.TransactionClient, '$executeRaw' | '$queryRaw'>;

export function contactMergeBackupBarrierKey(tenantId: string): string {
  return `contact-merge-backup:${tenantId}`;
}

export async function acquireContactMergeBackupBarrier(
  client: BarrierClient,
  tenantId: string,
): Promise<void> {
  const key = contactMergeBackupBarrierKey(tenantId);
  await client.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
  );
}

export async function readDatabaseClock(client: BarrierClient): Promise<Date> {
  const [databaseClock] = await client.$queryRaw<Array<{ cutoff: Date }>>(
    Prisma.sql`SELECT clock_timestamp() AS cutoff`,
  );
  if (!databaseClock?.cutoff) throw new Error('Unable to read database clock');
  return databaseClock.cutoff;
}
