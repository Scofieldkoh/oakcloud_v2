import { Prisma } from '@/generated/prisma';

/** The advisory key shared by authorization writers and aggregate statement gates. */
export const AUTHORIZATION_GLOBAL_ADVISORY_KEY = 'oakcloud:authorization:global';

type AuthorizationMutationGateClient = Pick<Prisma.TransactionClient, '$executeRaw'>;

/**
 * Acquire the same transaction-scoped gate used by the database statement
 * triggers before explicitly locking contacts or other domain rows.
 */
export async function acquireAuthorizationMutationGate(
  client: AuthorizationMutationGateClient,
): Promise<void> {
  await client.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${AUTHORIZATION_GLOBAL_ADVISORY_KEY}, 0))`,
  );
}
