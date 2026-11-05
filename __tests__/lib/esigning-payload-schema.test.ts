import { describe, expect, it } from 'vitest';
import { ESIGNING_IMAGE_LIMIT_ISSUE_CODE } from '@/lib/esigning-payload-limits';
import { saveEsigningFieldValuesSchema } from '@/lib/validations/esigning';

const FIELD_ID = '6f1c1d4e-2b8a-4c63-9d8e-0a1b2c3d4e5f';

function dataUrl(base64Length: number, prefix = 'data:image/png;base64,') {
  return `${prefix}${'A'.repeat(base64Length)}`;
}

function parse(values: Array<{ signatureDataUrl?: string | null; value?: string }>) {
  return saveEsigningFieldValuesSchema.safeParse({
    values: values.map((entry) => ({ fieldDefinitionId: FIELD_ID, ...entry })),
  });
}

function limitIssues(result: ReturnType<typeof parse>) {
  if (result.success) return [];
  return result.error.issues.filter(
    (issue) =>
      issue.code === 'custom' &&
      (issue.params as { code?: string } | undefined)?.code === ESIGNING_IMAGE_LIMIT_ISSUE_CODE
  );
}

describe('saveEsigningFieldValuesSchema signature images', () => {
  it('accepts a PNG data URL of a normal size and a null (clear) signature', () => {
    expect(parse([{ signatureDataUrl: dataUrl(4000) }]).success).toBe(true);
    expect(parse([{ signatureDataUrl: null }]).success).toBe(true);
    expect(parse([{ value: 'Jane' }]).success).toBe(true);
  });

  it('accepts an image right at the 1 MiB decoded limit', () => {
    // 1,398,100 base64 characters decode to 1,048,575 bytes.
    expect(parse([{ signatureDataUrl: dataUrl(1_398_100) }]).success).toBe(true);
  });

  it('rejects an image over 1 MiB decoded', () => {
    const result = parse([{ signatureDataUrl: dataUrl(1_398_104) }]);
    expect(result.success).toBe(false);
    expect(limitIssues(result)).toHaveLength(1);
    expect(limitIssues(result)[0].message).toContain('1 MiB');
  });

  it('rejects a data URL longer than the 1,400,000 character cap', () => {
    const result = parse([{ signatureDataUrl: dataUrl(2_000_000) }]);
    expect(result.success).toBe(false);
    expect(limitIssues(result)).toHaveLength(1);
  });

  it('rejects images that together are over 3 MiB per request', () => {
    expect(parse([1, 2, 3].map(() => ({ signatureDataUrl: dataUrl(1_300_000) }))).success).toBe(true);

    const result = parse([1, 2, 3, 4].map(() => ({ signatureDataUrl: dataUrl(1_300_000) })));
    expect(result.success).toBe(false);
    expect(limitIssues(result).map((issue) => issue.message)).toEqual([
      expect.stringContaining('too large together'),
    ]);
  });

  it.each([
    ['a JPEG data URL', 'data:image/jpeg;base64,AAAA'],
    ['an SVG data URL', 'data:image/svg+xml;base64,AAAA'],
    ['a non-base64 data URL', 'data:image/png,AAAA'],
    ['padding in the middle', 'data:image/png;base64,AA=AAA'],
    ['more than two padding characters', 'data:image/png;base64,AAA==='],
    ['an empty payload', 'data:image/png;base64,'],
    ['a remote URL', 'https://example.com/signature.png'],
  ])('rejects %s', (_name, signatureDataUrl) => {
    expect(parse([{ signatureDataUrl }]).success).toBe(false);
  });
});
