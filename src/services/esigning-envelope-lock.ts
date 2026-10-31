import { Prisma, type EsigningEnvelopeStatus } from '@/generated/prisma';

export interface LockedEsigningEnvelopeRow {
  id: string;
  tenantId: string;
  status: EsigningEnvelopeStatus;
  expiresAt: Date | null;
}

/**
 * Takes a row lock on the envelope (`SELECT ... FOR UPDATE`) for the rest of the
 * transaction and returns the committed state at the moment the lock was
 * acquired.
 *
 * Every path that moves an envelope between lifecycle states (signer complete,
 * signer decline, sender void, and the stuck-envelope sweeper) takes this lock
 * first. That serialises them: the later transaction blocks until the earlier
 * one commits, and under READ COMMITTED every statement it runs afterwards
 * sees the earlier commit. Callers must re-validate state from the returned
 * row (and re-read recipients) instead of trusting data loaded before the
 * transaction started.
 */
export async function lockEsigningEnvelopeForUpdate(
  tx: Prisma.TransactionClient,
  envelopeId: string
): Promise<LockedEsigningEnvelopeRow | null> {
  const rows = await tx.$queryRaw<LockedEsigningEnvelopeRow[]>(Prisma.sql`
    SELECT
      id,
      "tenantId",
      status::text AS status,
      "expiresAt"
    FROM esigning_envelopes
    WHERE id = ${envelopeId}
    FOR UPDATE
  `);
  return rows[0] ?? null;
}
