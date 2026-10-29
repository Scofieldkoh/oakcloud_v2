// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { randomBytes } from 'node:crypto';

const connectionString = process.env.BUSINESS_ASSISTANT_TEST_DATABASE_URL;
const suite = connectionString ? describe : describe.skip;
const schema = `ba_learning_test_${randomBytes(6).toString('hex')}`;

suite('Business Assistant governed learning CAS on PostgreSQL', () => {
  let control: Client;
  let first: Client;
  let second: Client;

  beforeAll(async () => {
    const url = new URL(connectionString!);
    if (!/(?:^|[_-])test(?:[_-]|$)/i.test(url.pathname.slice(1)) || url.port === '5433') {
      throw new Error('An isolated assistant test database is required');
    }
    control = new Client({ connectionString });
    first = new Client({ connectionString });
    second = new Client({ connectionString });
    await Promise.all([control.connect(), first.connect(), second.connect()]);
    await control.query(`CREATE SCHEMA "${schema}"`);
    for (const client of [control, first, second]) {
      await client.query(`SET search_path TO "${schema}"`);
      await client.query("SET statement_timeout TO '5s'");
    }
    await control.query(`
      CREATE TABLE learning_targets (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        target_key TEXT NOT NULL,
        active_version TEXT NOT NULL,
        active_value JSONB NOT NULL,
        previous_version TEXT,
        previous_value JSONB,
        active_change_id TEXT,
        revision INTEGER NOT NULL,
        UNIQUE (tenant_id, target_key)
      );
    `);
  }, 15_000);

  beforeEach(async () => {
    await Promise.all([first.query('ROLLBACK'), second.query('ROLLBACK')]);
    await control.query('TRUNCATE learning_targets');
  });

  afterAll(async () => {
    await Promise.all([first?.query('ROLLBACK'), second?.query('ROLLBACK')]);
    if (control) await control.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await Promise.all([first?.end(), second?.end(), control?.end()]);
  });

  it('allows exactly one concurrent promotion for the same bound active version and revision', async () => {
    await control.query(`
      INSERT INTO learning_targets
        (id, tenant_id, target_key, active_version, active_value, active_change_id, revision)
      VALUES
        ('target-1', 'workspace-1', 'assistant.response_detail', '1', '{"value":"concise"}', NULL, 4)
    `);

    await first.query('BEGIN');
    await second.query('BEGIN');
    const firstResult = await first.query(`
      UPDATE learning_targets
      SET active_version = '2',
          active_value = '{"value":"detailed"}',
          previous_version = active_version,
          previous_value = active_value,
          active_change_id = 'candidate-a',
          revision = revision + 1
      WHERE id = 'target-1'
        AND tenant_id = 'workspace-1'
        AND target_key = 'assistant.response_detail'
        AND active_version = '1'
        AND revision = 4
    `);
    expect(firstResult.rowCount).toBe(1);

    const competing = second.query(`
      UPDATE learning_targets
      SET active_version = '3',
          active_value = '{"value":"standard"}',
          previous_version = active_version,
          previous_value = active_value,
          active_change_id = 'candidate-b',
          revision = revision + 1
      WHERE id = 'target-1'
        AND tenant_id = 'workspace-1'
        AND target_key = 'assistant.response_detail'
        AND active_version = '1'
        AND revision = 4
    `);
    await first.query('COMMIT');
    const secondResult = await competing;
    await second.query('COMMIT');

    expect(secondResult.rowCount).toBe(0);
    const final = (await control.query(`
      SELECT active_version, active_change_id, revision, active_value
      FROM learning_targets WHERE id = 'target-1'
    `)).rows[0];
    expect(final).toMatchObject({ active_version: '2', active_change_id: 'candidate-a', revision: 5 });
    expect(final.active_value).toEqual({ value: 'detailed' });
  });

  it('prevents a stale rollback from resurrecting data after a concurrent deletion tombstone wins', async () => {
    await control.query(`
      INSERT INTO learning_targets
        (id, tenant_id, target_key, active_version, active_value, previous_version, previous_value, active_change_id, revision)
      VALUES
        ('target-1', 'workspace-1', 'assistant.response_detail', '2', '{"value":"detailed"}', '1', '{"value":"concise"}', 'candidate-a', 5)
    `);

    await first.query('BEGIN');
    await second.query('BEGIN');
    const deletion = await first.query(`
      UPDATE learning_targets
      SET active_value = '{"state":"DELETED"}',
          previous_version = NULL,
          previous_value = NULL,
          active_change_id = NULL,
          revision = revision + 1
      WHERE id = 'target-1'
        AND tenant_id = 'workspace-1'
        AND target_key = 'assistant.response_detail'
        AND revision = 5
    `);
    expect(deletion.rowCount).toBe(1);

    const staleRollback = second.query(`
      UPDATE learning_targets
      SET active_version = previous_version,
          active_value = previous_value,
          active_change_id = NULL,
          revision = revision + 1
      WHERE id = 'target-1'
        AND tenant_id = 'workspace-1'
        AND target_key = 'assistant.response_detail'
        AND active_version = '2'
        AND active_change_id = 'candidate-a'
        AND revision = 5
    `);
    await first.query('COMMIT');
    const rollbackResult = await staleRollback;
    await second.query('COMMIT');

    expect(rollbackResult.rowCount).toBe(0);
    const final = (await control.query(`
      SELECT active_version, active_change_id, previous_version, previous_value, revision, active_value
      FROM learning_targets WHERE id = 'target-1'
    `)).rows[0];
    expect(final).toMatchObject({
      active_version: '2', active_change_id: null, previous_version: null, previous_value: null, revision: 6,
    });
    expect(final.active_value).toEqual({ state: 'DELETED' });
  });

  it('keeps the CAS tenant-scoped even when another workspace has the same target key and revision', async () => {
    await control.query(`
      INSERT INTO learning_targets
        (id, tenant_id, target_key, active_version, active_value, active_change_id, revision)
      VALUES
        ('target-a', 'workspace-1', 'assistant.response_detail', '1', '{"value":"concise"}', NULL, 4),
        ('target-b', 'workspace-2', 'assistant.response_detail', '1', '{"value":"concise"}', NULL, 4)
    `);
    const result = await control.query(`
      UPDATE learning_targets
      SET active_version = '2', active_value = '{"value":"detailed"}', active_change_id = 'candidate-a', revision = revision + 1
      WHERE id = 'target-a'
        AND tenant_id = 'workspace-1'
        AND target_key = 'assistant.response_detail'
        AND active_version = '1'
        AND revision = 4
    `);
    expect(result.rowCount).toBe(1);
    const rows = (await control.query('SELECT tenant_id, active_version, revision FROM learning_targets ORDER BY tenant_id')).rows;
    expect(rows).toEqual([
      { tenant_id: 'workspace-1', active_version: '2', revision: 5 },
      { tenant_id: 'workspace-2', active_version: '1', revision: 4 },
    ]);
  });
});
