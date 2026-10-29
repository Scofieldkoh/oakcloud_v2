import { Prisma } from '@/generated/prisma';

type BarrierClient = Pick<Prisma.TransactionClient, '$executeRaw'>;

/**
 * Transactions that change durable business-operation state take a shared lock.
 * Workspace snapshots and restores take the exclusive lock before reading their
 * cutoff. The lock is transaction-scoped; callers must pass the transaction client.
 *
 * Order: business-operation barrier, contact-merge barrier (when needed), then
 * authorization/run/operation/domain locks. Never acquire this after domain locks.
 */
export async function acquireBusinessOperationBarrier(
  transaction: BarrierClient,
  tenantId: string,
  mode: 'shared' | 'exclusive' = 'shared',
): Promise<void> {
  if (!tenantId) throw new Error('Workspace is required for a business operation barrier');
  const key = `oakcloud:business-operation:${tenantId}`;
  if (mode === 'exclusive') {
    await transaction.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
    );
  } else {
    await transaction.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock_shared(hashtextextended(${key}, 0))`,
    );
  }
}
