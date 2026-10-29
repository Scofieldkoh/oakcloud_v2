import { describe, expect, it } from 'vitest';

import { validateBillingTestEnvironment } from '../../scripts/require-billing-test-env.mjs';

describe('billing acceptance preflight', () => {
  it('requires TEST_DATABASE_URL for PostgreSQL acceptance', () => {
    expect(validateBillingTestEnvironment('postgres', {})).toEqual({
      ok: false,
      missing: ['TEST_DATABASE_URL'],
    });
  });

  it('accepts a PostgreSQL acceptance environment without exposing values', () => {
    expect(validateBillingTestEnvironment('postgres', { TEST_DATABASE_URL: 'redacted-test-url' })).toEqual({
      ok: true,
      missing: [],
    });
  });

  it('requires both TEST_DATABASE_URL and the performance flag', () => {
    expect(validateBillingTestEnvironment('performance', { TEST_DATABASE_URL: 'redacted-test-url' })).toEqual({
      ok: false,
      missing: ['RUN_PERFORMANCE_TESTS=true'],
    });
    expect(validateBillingTestEnvironment('performance', { RUN_PERFORMANCE_TESTS: 'true' })).toEqual({
      ok: false,
      missing: ['TEST_DATABASE_URL'],
    });
  });

  it('accepts performance only when the explicit true flag is present', () => {
    expect(validateBillingTestEnvironment('performance', {
      TEST_DATABASE_URL: 'redacted-test-url',
      RUN_PERFORMANCE_TESTS: 'true',
    })).toEqual({ ok: true, missing: [] });
    expect(validateBillingTestEnvironment('performance', {
      TEST_DATABASE_URL: 'redacted-test-url',
      RUN_PERFORMANCE_TESTS: '1',
    })).toEqual({ ok: false, missing: ['RUN_PERFORMANCE_TESTS=true'] });
  });
});
