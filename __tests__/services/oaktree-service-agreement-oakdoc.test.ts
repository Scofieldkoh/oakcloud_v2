// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import {
  OAKTREE_SERVICE_AGREEMENT_OAKDOC,
  buildOaktreeServiceAgreementOakDoc,
} from '@/content/service-agreement/oaktree-service-agreement-oakdoc';
import { buildOaktreeServiceAgreementReferenceOakDoc } from '@/content/service-agreement/oaktree-service-agreement-reference-oakdoc';
import { OAKTREE_SERVICE_AGREEMENT_V1 } from '@/content/service-agreement/oaktree-service-agreement-v1';

describe('Oaktree Master Services Agreement OakDoc master', () => {
  it('seeds the reference layout under the existing template name, so it replaces the current master', () => {
    expect(Buffer.from(buildOaktreeServiceAgreementOakDoc()).equals(
      Buffer.from(buildOaktreeServiceAgreementReferenceOakDoc()),
    )).toBe(true);
    expect(OAKTREE_SERVICE_AGREEMENT_OAKDOC.name).toBe('Oaktree Master Services Agreement (OakDoc)');
    expect(OAKTREE_SERVICE_AGREEMENT_OAKDOC.name).not.toBe(OAKTREE_SERVICE_AGREEMENT_V1.template.name);
    expect(OAKTREE_SERVICE_AGREEMENT_OAKDOC.compositionType).toBe('SERVICE_AGREEMENT');
  });

  it('builds identical bytes on every run, so an unchanged re-seed is a no-op', () => {
    expect(Buffer.from(buildOaktreeServiceAgreementOakDoc()).equals(
      Buffer.from(buildOaktreeServiceAgreementOakDoc()),
    )).toBe(true);
  });
});
