import { describe, expect, it } from 'vitest';
import {
  deadlineRuleArchiveSchema,
  deadlineRulePublishSchema,
} from '@/services/deadline-rule';

const base = {
  expectedCurrentVersion: 2,
  expectedDraftRevision: 4,
  draftConfigHash: 'a'.repeat(64),
  previewFingerprint: 'b'.repeat(64),
};

describe('deadline rule apply operation schemas', () => {
  it('rejects an archive operation at the publish schema boundary', () => {
    expect(() => deadlineRulePublishSchema.parse({ ...base, operation: 'ARCHIVE' })).toThrow();
  });

  it('rejects a publish operation at the archive schema boundary', () => {
    expect(() => deadlineRuleArchiveSchema.parse({ ...base, operation: 'PUBLISH', reason: 'Retired' })).toThrow();
  });

  it('accepts only the matching operation for each apply schema', () => {
    expect(deadlineRulePublishSchema.parse({ ...base, operation: 'PUBLISH' }).operation).toBe('PUBLISH');
    expect(deadlineRuleArchiveSchema.parse({ ...base, operation: 'ARCHIVE', reason: 'Retired' }).operation).toBe('ARCHIVE');
  });
});
