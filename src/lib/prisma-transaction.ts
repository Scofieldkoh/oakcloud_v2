interface SerializableTransactionClient<TTransaction> {
  $transaction<TResult>(
    work: (transaction: TTransaction) => Promise<TResult>,
    options: { isolationLevel: 'Serializable' },
  ): Promise<TResult>;
}

export function isSerializationConflict(error: unknown): boolean {
  const seen = new Set<object>();
  let current: unknown = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const candidate = current as { code?: unknown; originalCode?: unknown; kind?: unknown; cause?: unknown };
    const code = typeof candidate.code === 'string'
      ? candidate.code
      : typeof candidate.originalCode === 'string' ? candidate.originalCode : '';
    if (code === 'P2034' || code === '40001' || code === '40P01' || candidate.kind === 'TransactionWriteConflict') return true;
    current = candidate.cause;
  }
  return false;
}

export async function runSerializableTransaction<TTransaction, TResult>(
  client: SerializableTransactionClient<TTransaction>,
  work: (transaction: TTransaction) => Promise<TResult>,
  maxAttempts = 3,
): Promise<TResult> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await client.$transaction(work, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (!isSerializationConflict(error) || attempt === maxAttempts) throw error;
    }
  }
  throw new Error('Serializable transaction retry limit reached');
}
