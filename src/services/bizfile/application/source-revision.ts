import type { PrismaTransactionClient } from '@/services/contact.service';

export interface BizFileSourceRevisionCheck {
  tenantId: string;
  documentId: string;
  /** The source revision captured by the immutable preparation. */
  expectedSourceRevision: number;
}

export class BizFileSourceRevisionError extends Error {
  readonly code: 'INVALID_SOURCE_REVISION' | 'SOURCE_NOT_FOUND' | 'STALE_BIZFILE_SOURCE';

  constructor(
    code: 'INVALID_SOURCE_REVISION' | 'SOURCE_NOT_FOUND' | 'STALE_BIZFILE_SOURCE',
    message: string,
  ) {
    super(message);
    this.name = 'BizFileSourceRevisionError';
    this.code = code;
  }
}

type SourceRow = { sourceRevision?: unknown };

function assertExpectedRevision(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new BizFileSourceRevisionError(
      'INVALID_SOURCE_REVISION',
      'BizFile source revision must be a non-negative safe integer',
    );
  }
}

function sourceRevision(value: unknown): number {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === 'bigint' && value >= BigInt(0) && value <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(value);
  throw new BizFileSourceRevisionError('SOURCE_NOT_FOUND', 'BizFile source revision is unavailable');
}

/**
 * Lock the authoritative source row and compare its revision to the one
 * captured during preparation. The raw query is intentional: a Prisma
 * findFirst read does not acquire a row lock and would leave a race between
 * this check and the document/company writes in the same transaction.
 *
 * The delegate fallback keeps unit-test transactions lightweight. Production
 * Prisma transactions always expose $queryRawUnsafe and therefore take the
 * `FOR UPDATE` path above the fallback.
 */
export async function assertFreshBizFileSourceRevision(
  tx: PrismaTransactionClient,
  check: BizFileSourceRevisionCheck,
): Promise<number> {
  assertExpectedRevision(check.expectedSourceRevision);

  const raw = tx as unknown as {
    $queryRawUnsafe?: <T = unknown>(query: string, ...values: unknown[]) => Promise<T>;
  };

  let row: SourceRow | undefined;
  if (typeof raw.$queryRawUnsafe === 'function') {
    const rows = await raw.$queryRawUnsafe<SourceRow[]>(
      'SELECT "source_revision" AS "sourceRevision" FROM "documents" WHERE "id" = $1 AND "tenantId" = $2 AND "deleted_at" IS NULL FOR UPDATE',
      check.documentId,
      check.tenantId,
    );
    row = Array.isArray(rows) ? rows[0] : undefined;
  } else {
    const document = (tx as unknown as {
      document?: {
        findFirst?: (args: unknown) => Promise<SourceRow | null>;
      };
    }).document;
    if (typeof document?.findFirst !== 'function') {
      throw new BizFileSourceRevisionError('SOURCE_NOT_FOUND', 'BizFile source revision cannot be checked');
    }
    row = (await document.findFirst({
      where: { id: check.documentId, tenantId: check.tenantId, deletedAt: null },
      select: { sourceRevision: true },
    })) ?? undefined;
  }

  if (!row) {
    throw new BizFileSourceRevisionError('SOURCE_NOT_FOUND', 'BizFile source document not found');
  }
  const actualSourceRevision = sourceRevision(row.sourceRevision);
  if (actualSourceRevision !== check.expectedSourceRevision) {
    throw new BizFileSourceRevisionError(
      'STALE_BIZFILE_SOURCE',
      `STALE_BIZFILE_SOURCE: expected source revision ${check.expectedSourceRevision}, found ${actualSourceRevision}`,
    );
  }
  return actualSourceRevision;
}
