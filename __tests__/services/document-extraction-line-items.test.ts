import { describe, expect, it } from 'vitest';

import { mapAIResponseToResult } from '@/services/document-extraction.service';

describe('document extraction line items', () => {
  it('unwraps a confidence-bearing line number before persistence', () => {
    const result = mapAIResponseToResult(
      {
        documentCategory: { value: 'ACCOUNTS_PAYABLE', confidence: 0.99 },
        currency: { value: 'SGD', confidence: 0.99 },
        totalAmount: { value: '654.00', confidence: 0.99 },
        lineItems: [
          {
            lineNo: { value: 1, confidence: 0.99 },
            description: { value: 'Room service', confidence: 0.99 },
            amount: { value: '600.00', confidence: 0.99 },
            gstAmount: { value: '54.00', confidence: 0.99 },
          },
        ],
        overallConfidence: 0.99,
      },
      [{ pageNumber: 1, storageKey: null, imageFingerprint: 'fingerprint' }]
    );

    expect(result.lineItems?.[0]?.lineNo).toBe(1);
  });
});
