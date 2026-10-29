// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { BUSINESS_ASSISTANT_CORRECTION_TRANSACTION_LIMITS } from '@/services/business-assistant/correction-transaction';

const connectionString = process.env.BUSINESS_ASSISTANT_TEST_DATABASE_URL;
const suite = connectionString ? describe : describe.skip;

suite('Business Assistant correction concurrency on PostgreSQL', () => {
  let control: Client;

  beforeAll(async () => {
    const url = new URL(connectionString!);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)
      || !/(?:^|[_-])test(?:[_-]|$)/i.test(url.pathname.slice(1))
      || url.port === '5433') {
      throw new Error('Correction concurrency tests require the isolated disposable PostgreSQL database.');
    }
    control = new Client({ connectionString });
    await control.connect();
  });

  afterAll(async () => {
    await control?.end();
  });

  async function expectAdvisoryWait(pid: number): Promise<void> {
    await expect.poll(async () => {
      const result = await control.query('SELECT wait_event FROM pg_stat_activity WHERE pid = $1', [pid]);
      return result.rows[0]?.wait_event;
    }, { timeout: 2_000, interval: 20 }).toBe('advisory');
  }

  it('measures the shared correction barrier wait against the configured transaction runtime budget', async () => {
    const blocker = new Client({ connectionString });
    const correction = new Client({ connectionString });
    await Promise.all([blocker.connect(), correction.connect()]);
    try {
      await blocker.query('BEGIN');
      await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended('oakcloud:business-operation:correction-test', 0))");

      await correction.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await correction.query(`SET LOCAL statement_timeout = '${BUSINESS_ASSISTANT_CORRECTION_TRANSACTION_LIMITS.timeoutMs}ms'`);
      const correctionPid = Number((await correction.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
      const startedAt = Date.now();
      const waiting = correction.query("SELECT pg_advisory_xact_lock_shared(hashtextextended('oakcloud:business-operation:correction-test', 0))");
      await expectAdvisoryWait(correctionPid);

      await blocker.query('COMMIT');
      await waiting;
      const waitedMs = Date.now() - startedAt;
      expect(waitedMs).toBeGreaterThan(0);
      expect(waitedMs).toBeLessThan(BUSINESS_ASSISTANT_CORRECTION_TRANSACTION_LIMITS.timeoutMs);
      await correction.query('COMMIT');
    } finally {
      await blocker.query('ROLLBACK').catch(() => undefined);
      await correction.query('ROLLBACK').catch(() => undefined);
      await Promise.all([blocker.end(), correction.end()]);
    }
  });

  it('fails closed on a bounded PostgreSQL lock timeout without applying a later statement', async () => {
    const blocker = new Client({ connectionString });
    const correction = new Client({ connectionString });
    await Promise.all([blocker.connect(), correction.connect()]);
    try {
      await blocker.query('BEGIN');
      await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended('oakcloud:business-operation:correction-timeout', 0))");

      await correction.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await correction.query("SET LOCAL statement_timeout = '150ms'");
      const startedAt = Date.now();
      await expect(correction.query("SELECT pg_advisory_xact_lock_shared(hashtextextended('oakcloud:business-operation:correction-timeout', 0))"))
        .rejects.toMatchObject({ code: '57014' });
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(100);
      await expect(correction.query('SELECT 1')).rejects.toMatchObject({ code: '25P02' });
      await correction.query('ROLLBACK');
    } finally {
      await blocker.query('ROLLBACK').catch(() => undefined);
      await correction.query('ROLLBACK').catch(() => undefined);
      await Promise.all([blocker.end(), correction.end()]);
    }
  });
});
