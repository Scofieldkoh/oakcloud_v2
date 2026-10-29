import { describe, expect, it, vi } from 'vitest';
import {
  BUSINESS_ASSISTANT_CORRECTION_TRANSACTION_LIMITS,
  runCorrectionSerializableTransaction,
} from '@/services/business-assistant/correction-transaction';

describe('correction serializable transaction bounds', () => {
  it('passes explicit acquisition/runtime bounds to every attempt', async () => {
    const calls: unknown[] = [];
    const client = {
      $transaction: vi.fn(async (work: (tx: object) => Promise<unknown>, options: unknown) => {
        calls.push(options);
        return work({ marker: 'tx' });
      }),
    };
    await expect(runCorrectionSerializableTransaction(client as never, async (tx) => tx)).resolves.toEqual({ marker: 'tx' });
    expect(calls).toEqual([{
      isolationLevel: 'Serializable',
      maxWait: BUSINESS_ASSISTANT_CORRECTION_TRANSACTION_LIMITS.maxWaitMs,
      timeout: BUSINESS_ASSISTANT_CORRECTION_TRANSACTION_LIMITS.timeoutMs,
    }]);
  });

  it('retries serialization conflicts only within the correction retry budget', async () => {
    let attempts = 0;
    const client = {
      $transaction: vi.fn(async (work: (tx: object) => Promise<unknown>) => {
        attempts += 1;
        if (attempts < 3) throw { code: 'P2034' };
        return work({ attempt: attempts });
      }),
    };
    await expect(runCorrectionSerializableTransaction(client as never, async (tx) => tx)).resolves.toEqual({ attempt: 3 });
    expect(client.$transaction).toHaveBeenCalledTimes(3);
  });

  it('fails after the bounded retry budget without a fourth transaction attempt', async () => {
    const conflict = Object.assign(new Error('write conflict'), { code: 'P2034' });
    const client = { $transaction: vi.fn().mockRejectedValue(conflict) };
    await expect(runCorrectionSerializableTransaction(client as never, async () => undefined)).rejects.toBe(conflict);
    expect(client.$transaction).toHaveBeenCalledTimes(BUSINESS_ASSISTANT_CORRECTION_TRANSACTION_LIMITS.maxAttempts);
    for (const call of client.$transaction.mock.calls) {
      expect(call[1]).toEqual({
        isolationLevel: 'Serializable',
        maxWait: BUSINESS_ASSISTANT_CORRECTION_TRANSACTION_LIMITS.maxWaitMs,
        timeout: BUSINESS_ASSISTANT_CORRECTION_TRANSACTION_LIMITS.timeoutMs,
      });
    }
  });

  it('does not retry a timeout or other non-serialization failure', async () => {
    const timeout = Object.assign(new Error('Transaction API error: Transaction already closed'), { code: 'P2028' });
    const client = { $transaction: vi.fn().mockRejectedValue(timeout) };
    await expect(runCorrectionSerializableTransaction(client as never, async () => undefined)).rejects.toBe(timeout);
    expect(client.$transaction).toHaveBeenCalledOnce();
  });
});
