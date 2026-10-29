import { describe, expect, it } from 'vitest';
import { evaluateBizFileFullStateIndependentReview } from '../full-state-review-contract';
import { DEVELOPMENT_REVIEWER_FIXTURES } from './reviewer-annotated-fixtures';

describe('annotated independent-review development fixtures', () => {
  it.each(DEVELOPMENT_REVIEWER_FIXTURES)('$id — $description', (fixture) => {
    const result = evaluateBizFileFullStateIndependentReview(fixture.input);
    expect(result.disposition).toBe(fixture.expectedDisposition);
    expect(result.factualPass).toBe(fixture.expectedDisposition === 'PASS');
    if (fixture.expectedAttribution) {
      expect(result.findings.some((finding) => finding.attribution === fixture.expectedAttribution)).toBe(true);
    }
  });

  it('contains every predeclared development scenario exactly once', () => {
    const ids = DEVELOPMENT_REVIEWER_FIXTURES.map((fixture) => fixture.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      'dev.correct-import',
      'dev.selected-field-defect',
      'dev.unselected-field-defect',
      'dev.unauthorized-write',
      'dev.missing-section',
      'dev.unreadable-source',
      'dev.ambiguous-evidence',
      'dev.later-human-edit',
      'dev.source-drift',
    ]);
  });
});
