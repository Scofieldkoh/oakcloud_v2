import { describe, expect, it } from 'vitest';
import { BIZFILE_CORRECTION_FIELDS, BIZFILE_CORRECTION_FINDING_CODES, eligibleBizFileCorrectionFindings } from '@/components/business-assistant/correction-fields';
import { BIZFILE_CORRECTION_SOURCE_PATHS } from '@/lib/bizfile-correction-contract';

describe('BizFile correction fields', () => {
  it('presents exactly the deterministic scalar or one-to-one correction paths', () => {
    const paths = BIZFILE_CORRECTION_FIELDS.map((field) => field.path);
    expect(paths).toContain('entityDetails.name');
    expect(paths).toContain('addresses.registered');
    expect(paths).toContain('auditor');
    expect(paths).not.toContain('officers');
    expect(paths).not.toContain('shareholders');
    expect(paths).not.toContain('charges');
    expect(new Set(paths).size).toBe(paths.length);
    expect([...paths].sort()).toEqual(Object.keys(BIZFILE_CORRECTION_SOURCE_PATHS).sort());
  });

  it('keeps the correction finding contract explicit', () => {
    expect(BIZFILE_CORRECTION_FINDING_CODES).toEqual([
      'SELECTED_FIELD_MISMATCH',
      'PERSISTED_FIELD_MISSING',
      'APPROVED_FIELD_MISMATCH',
    ]);
  });

  it('returns only allowlisted findings with immutable expected values', () => {
    expect(eligibleBizFileCorrectionFindings([
      { id: 'eligible', code: 'SELECTED_FIELD_MISMATCH', path: 'entityDetails.name', changeId: 'change-1', expected: 'Correct Name', actual: 'Wrong Name' },
      { id: 'collection', code: 'SELECTED_FIELD_MISMATCH', path: 'officers', changeId: 'change-2', expected: [] },
      { id: 'wrong-code', code: 'SOURCE_HASH_MISMATCH', path: 'entityDetails.name', changeId: 'change-3', expected: 'Ignored' },
      { id: 'no-expected', code: 'PERSISTED_FIELD_MISSING', path: 'homeCurrency', changeId: 'change-4' },
    ])).toEqual([
      expect.objectContaining({ id: 'eligible', path: 'entityDetails.name', label: 'Company name', expected: 'Correct Name', actual: 'Wrong Name' }),
    ]);
  });

  it('keeps null as a valid reviewed correction and exposes one correction per factual path', () => {
    const findings = eligibleBizFileCorrectionFindings([
      { id: 'first', code: 'PERSISTED_FIELD_MISSING', path: 'auditor', changeId: 'change-1', expected: null },
      { id: 'duplicate-path', code: 'APPROVED_FIELD_MISMATCH', path: 'auditor', changeId: 'change-2', expected: { name: 'Other' } },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ id: 'first', expected: null });
  });
});
