import { Prisma } from '@/generated/prisma';
import { classifyRevisionMiss } from '@/lib/document-editor/revision-concurrency';

export type GeneratedDocumentEditableStatus = 'DRAFT' | 'FINALIZED' | 'ARCHIVED';

type RevisionReadClient = Pick<Prisma.TransactionClient, '$queryRaw'>;

export interface GeneratedDocumentRevisionState {
  revision: number;
  deletedAt: Date | null;
  status: GeneratedDocumentEditableStatus;
}

export interface GeneratedDocumentRevisionClaim {
  revision: number;
}

/**
 * Atomically claims the next GeneratedDocument revision inside the caller's
 * transaction. The revision comparison happens in PostgreSQL, never in
 * JavaScript. The successful UPDATE row lock is retained until the caller's
 * transaction commits, so the canonical mutation that follows cannot race a
 * second accepted claim.
 *
 * This helper intentionally uses SQL while the additive Prisma schema change
 * is rolling through generated clients; the physical column is frozen by C07
 * as generated_documents.revision.
 */
export async function claimGeneratedDocumentRevision(
  tx: Prisma.TransactionClient,
  input: {
    id: string;
    tenantId: string;
    expectedRevision?: number;
    allowedStatuses?: GeneratedDocumentEditableStatus[];
    requireDeleted?: boolean;
  },
): Promise<GeneratedDocumentRevisionClaim> {
  const allowedStatuses = input.allowedStatuses ?? [];
  const deletedPredicate = input.requireDeleted
    ? Prisma.sql`AND "deleted_at" IS NOT NULL`
    : Prisma.sql`AND "deleted_at" IS NULL`;
  const revisionPredicate = input.expectedRevision === undefined
    ? Prisma.empty
    : Prisma.sql`AND "revision" = ${input.expectedRevision}`;
  const statusPredicate = allowedStatuses.length === 0
    ? Prisma.empty
    : Prisma.sql`AND "status"::text IN (${Prisma.join(allowedStatuses)})`;

  const rows = await tx.$queryRaw<Array<{ revision: number }>>(Prisma.sql`
    UPDATE "generated_documents"
    SET "revision" = "revision" + 1
    WHERE "id" = ${input.id}
      AND "tenant_id" = ${input.tenantId}
      ${deletedPredicate}
      ${revisionPredicate}
      ${statusPredicate}
    RETURNING "revision"
  `);

  if (rows.length === 1) return rows[0];

  const stateRows = await tx.$queryRaw<GeneratedDocumentRevisionState[]>(Prisma.sql`
    SELECT
      "revision",
      "deleted_at" AS "deletedAt",
      "status"::text AS "status"
    FROM "generated_documents"
    WHERE "id" = ${input.id}
      AND "tenant_id" = ${input.tenantId}
    LIMIT 1
  `);
  const state = stateRows[0] ?? null;
  const statusAllowed = state
    ? allowedStatuses.length === 0 || allowedStatuses.includes(state.status)
    : false;
  const deletedStateMatches = state
    ? input.requireDeleted ? state.deletedAt !== null : state.deletedAt === null
    : false;

  classifyRevisionMiss(
    state
      ? {
          revision: state.revision,
          deleted: input.requireDeleted ? false : state.deletedAt !== null,
          locked: !deletedStateMatches || !statusAllowed,
        }
      : null,
    {
      resource: 'generated-document',
      expectedRevision: input.expectedRevision,
    },
  );
}

export async function readGeneratedDocumentRevision(
  client: RevisionReadClient,
  id: string,
  tenantId: string,
): Promise<number> {
  const rows = await client.$queryRaw<Array<{ revision: number }>>(Prisma.sql`
    SELECT "revision"
    FROM "generated_documents"
    WHERE "id" = ${id}
      AND "tenant_id" = ${tenantId}
    LIMIT 1
  `);
  if (!rows[0]) {
    classifyRevisionMiss(null, { resource: 'generated-document' });
  }
  return rows[0].revision;
}

export async function readGeneratedDocumentRevisions(
  client: RevisionReadClient,
  ids: string[],
  tenantId: string,
): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await client.$queryRaw<Array<{ id: string; revision: number }>>(Prisma.sql`
    SELECT "id", "revision"
    FROM "generated_documents"
    WHERE "tenant_id" = ${tenantId}
      AND "id" IN (${Prisma.join(ids)})
  `);
  return new Map(rows.map((row) => [row.id, row.revision]));
}
