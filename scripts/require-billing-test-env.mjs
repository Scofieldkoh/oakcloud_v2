import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);

/** @param {'postgres'|'performance'} mode @param {Record<string, string | undefined>} [env=process.env] */
export function validateBillingTestEnvironment(mode, env = process.env) {
  const missing = [];
  if (!env.TEST_DATABASE_URL) missing.push('TEST_DATABASE_URL');
  if (mode === 'performance' && env.RUN_PERFORMANCE_TESTS !== 'true') {
    missing.push('RUN_PERFORMANCE_TESTS=true');
  }
  return { ok: missing.length === 0, missing };
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const mode = process.argv[2];
  if (mode !== 'postgres' && mode !== 'performance') {
    console.error('Usage: node scripts/require-billing-test-env.mjs <postgres|performance>');
    process.exit(1);
  }
  const result = validateBillingTestEnvironment(mode);
  if (!result.ok) {
    console.error(`Missing required billing test environment: ${result.missing.join(', ')}`);
    process.exit(1);
  }
}
