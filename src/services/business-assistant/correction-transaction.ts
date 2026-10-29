import { runSerializableTransaction } from '@/lib/prisma-transaction';

/**
 * Keep correction proposal writes bounded without changing the transaction
 * policy of unrelated Business Assistant or BizFile operations.
 *
 * These values intentionally match Prisma's documented interactive
 * transaction defaults today, but keeping them explicit here prevents a
 * client-default change from silently extending a correction lock window.
 */
export const BUSINESS_ASSISTANT_CORRECTION_TRANSACTION_LIMITS = Object.freeze({
  maxWaitMs: 2_000,
  timeoutMs: 5_000,
  maxAttempts: 3,
});

interface CorrectionTransactionClient<TTransaction> {
  $transaction<TResult>(
    work: (transaction: TTransaction) => Promise<TResult>,
    options: { isolationLevel: 'Serializable'; maxWait?: number; timeout?: number },
  ): Promise<TResult>;
}

/**
 * Run one correction proposal transaction with bounded acquisition/runtime
 * while retaining the repository-wide serializable-conflict retry policy.
 */
export async function runCorrectionSerializableTransaction<TTransaction, TResult>(
  client: CorrectionTransactionClient<TTransaction>,
  work: (transaction: TTransaction) => Promise<TResult>,
): Promise<TResult> {
  const boundedClient = {
    async $transaction<TValue>(
      transactionWork: (transaction: TTransaction) => Promise<TValue>,
      options: { isolationLevel: 'Serializable' },
    ): Promise<TValue> {
      return client.$transaction(transactionWork, {
        ...options,
        maxWait: BUSINESS_ASSISTANT_CORRECTION_TRANSACTION_LIMITS.maxWaitMs,
        timeout: BUSINESS_ASSISTANT_CORRECTION_TRANSACTION_LIMITS.timeoutMs,
      });
    },
  };

  return runSerializableTransaction(
    boundedClient,
    work,
    BUSINESS_ASSISTANT_CORRECTION_TRANSACTION_LIMITS.maxAttempts,
  );
}
