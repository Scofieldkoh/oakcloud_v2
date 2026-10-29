import { describe, expect, it } from 'vitest';
import { createServiceAgreementClientKey } from '@/components/documents/service-agreement/client-key';

describe('createServiceAgreementClientKey', () => {
  it('stays within the 100-character client key contract', () => {
    const keys = Array.from({ length: 1_000 }, () => createServiceAgreementClientKey());

    expect(keys.every((key) => key.length >= 1 && key.length <= 100)).toBe(true);
  });

  it('generates unique keys', () => {
    const keys = Array.from({ length: 1_000 }, () => createServiceAgreementClientKey());

    expect(new Set(keys).size).toBe(keys.length);
  });
});
