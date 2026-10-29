// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { randomBytes } from 'node:crypto';

const connectionString = process.env.BUSINESS_ASSISTANT_TEST_DATABASE_URL;
const suite = connectionString ? describe : describe.skip;
const schema = `bizfile_correction_race_${randomBytes(6).toString('hex')}`;

suite('BizFile correction prefetch/transaction races on PostgreSQL', () => {
  let control: Client;

  beforeAll(async () => {
    const url = new URL(connectionString!);
    if (url.protocol !== 'postgresql:'
      || url.hostname !== '127.0.0.1'
      || url.port !== '55439'
      || url.pathname !== '/business_assistant_test'
      || url.username !== 'assistant_test') {
      throw new Error('BizFile correction race tests require the dedicated PostgreSQL database on 127.0.0.1:55439.');
    }
    control = new Client({ connectionString });
    await control.connect();
    await control.query(`CREATE SCHEMA "${schema}"`);
    await control.query(`SET search_path TO "${schema}"`);
    await control.query(`
      CREATE TABLE correction_state (
        id text PRIMARY KEY,
        baseline_revision integer NOT NULL,
        source_revision integer NOT NULL,
        source_version integer NOT NULL,
        storage_key text NOT NULL
      )
    `);
  }, 15_000);

  afterAll(async () => {
    if (!control) return;
    await control.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await control.end();
  });

  async function client(): Promise<Client> {
    const result = new Client({ connectionString });
    await result.connect();
    await result.query(`SET search_path TO "${schema}"`);
    return result;
  }

  it('measures a bounded lock wait instead of waiting indefinitely behind a concurrent writer', async () => {
    const id = `lock-${randomBytes(4).toString('hex')}`;
    await control.query(
      'INSERT INTO correction_state VALUES ($1, 4, 2, 1, $2)',
      [id, 'final/source.pdf'],
    );
    const holder = await client();
    const contender = await client();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT id FROM correction_state WHERE id = $1 FOR UPDATE', [id]);

      await contender.query('BEGIN');
      await contender.query("SET LOCAL lock_timeout = '100ms'");
      const started = performance.now();
      let error: unknown;
      try {
        await contender.query('SELECT id FROM correction_state WHERE id = $1 FOR UPDATE', [id]);
      } catch (caught) {
        error = caught;
      }
      const elapsedMs = performance.now() - started;

      expect(error).toMatchObject({ code: '55P03' });
      expect(elapsedMs).toBeGreaterThanOrEqual(50);
      expect(elapsedMs).toBeLessThan(1_000);
      await contender.query('ROLLBACK');
      await holder.query('ROLLBACK');
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined);
      await contender.query('ROLLBACK').catch(() => undefined);
      await Promise.all([holder.end(), contender.end()]);
    }
  });

  it.each([
    ['baseline revision', 'baseline_revision', 5],
    ['source revision', 'source_revision', 3],
    ['source version', 'source_version', 2],
    ['source pointer', 'storage_key', 'retained/source.pdf'],
  ] as const)('detects %s drift between evidence prefetch and transactional revalidation', async (_label, column, changedValue) => {
    const id = `race-${column}-${randomBytes(4).toString('hex')}`;
    await control.query(
      'INSERT INTO correction_state VALUES ($1, 4, 2, 1, $2)',
      [id, 'final/source.pdf'],
    );
    const prefetched = (await control.query(
      'SELECT baseline_revision, source_revision, source_version, storage_key FROM correction_state WHERE id = $1',
      [id],
    )).rows[0];

    await control.query(`UPDATE correction_state SET "${column}" = $2 WHERE id = $1`, [id, changedValue]);

    const operation = await client();
    try {
      await operation.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const current = (await operation.query(
        'SELECT baseline_revision, source_revision, source_version, storage_key FROM correction_state WHERE id = $1 FOR UPDATE',
        [id],
      )).rows[0];
      expect(current).not.toEqual(prefetched);
      const unchanged = current.baseline_revision === prefetched.baseline_revision
        && current.source_revision === prefetched.source_revision
        && current.source_version === prefetched.source_version
        && current.storage_key === prefetched.storage_key;
      expect(unchanged).toBe(false);
      await operation.query('ROLLBACK');
    } finally {
      await operation.query('ROLLBACK').catch(() => undefined);
      await operation.end();
    }
  });
});
