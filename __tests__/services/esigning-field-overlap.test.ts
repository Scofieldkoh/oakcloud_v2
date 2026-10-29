import { describe, expect, it } from 'vitest';
import { detectEsigningFieldOverlapWarnings } from '@/services/esigning-field.service';
import type { EsigningFieldDefinitionInput } from '@/lib/validations/esigning';

function field(overrides: Partial<EsigningFieldDefinitionInput> = {}): EsigningFieldDefinitionInput {
  return {
    id: crypto.randomUUID(),
    documentId: '00000000-0000-4000-8000-000000000001',
    recipientId: '00000000-0000-4000-8000-000000000101',
    type: 'SIGNATURE',
    pageNumber: 1,
    xPercent: 0.1,
    yPercent: 0.1,
    widthPercent: 0.2,
    heightPercent: 0.1,
    required: true,
    label: null,
    placeholder: null,
    sortOrder: 0,
    ...overrides,
  };
}

describe('detectEsigningFieldOverlapWarnings', () => {
  it('returns warnings for fields that overlap on the same document page', () => {
    const first = field({ id: '00000000-0000-4000-8000-000000000201' });
    const second = field({
      id: '00000000-0000-4000-8000-000000000202',
      xPercent: 0.25,
      yPercent: 0.15,
    });

    expect(detectEsigningFieldOverlapWarnings([first, second])).toEqual([
      {
        fieldIds: [first.id, second.id],
        documentId: first.documentId,
        pageNumber: 1,
        message: '2 fields overlap on page 1',
      },
    ]);
  });

  it('ignores fields on different documents or pages', () => {
    const first = field();
    const differentPage = field({ pageNumber: 2 });
    const differentDocument = field({
      documentId: '00000000-0000-4000-8000-000000000002',
    });

    expect(detectEsigningFieldOverlapWarnings([first, differentPage, differentDocument])).toEqual([]);
  });
});
