import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DEVELOPMENT_REVIEWER_FIXTURES } from '../reviewer-annotated-fixtures';
import { HELD_OUT_REVIEWER_FIXTURES } from './held-out-reviewer-fixtures';

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, stable(nested)]));
  }
  return value;
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

describe('reviewer evaluation fixture isolation', () => {
  it('keeps development and held-out identifiers in separate namespaces', () => {
    expect(DEVELOPMENT_REVIEWER_FIXTURES.every((fixture) => fixture.id.startsWith('dev.'))).toBe(true);
    expect(HELD_OUT_REVIEWER_FIXTURES.every((fixture) => fixture.id.startsWith('holdout-'))).toBe(true);
  });

  it('contains no identical evidence payload shared with development fixtures', () => {
    const development = new Set(DEVELOPMENT_REVIEWER_FIXTURES.map((fixture) => fingerprint(fixture.input)));
    const collisions = HELD_OUT_REVIEWER_FIXTURES.filter((fixture) => development.has(fingerprint(fixture.input)));
    expect(collisions.map((fixture) => fixture.id)).toEqual([]);
  });

  it('predeclares held-out expectations without invoking the reviewer', () => {
    expect(HELD_OUT_REVIEWER_FIXTURES.length).toBeGreaterThanOrEqual(10);
    expect(HELD_OUT_REVIEWER_FIXTURES.some((fixture) => fixture.expectedDisposition === 'PASS')).toBe(true);
    expect(HELD_OUT_REVIEWER_FIXTURES.some((fixture) => fixture.expectedDisposition === 'FAIL')).toBe(true);
    expect(HELD_OUT_REVIEWER_FIXTURES.some((fixture) => fixture.expectedDisposition === 'ABSTAIN')).toBe(true);
  });
});
