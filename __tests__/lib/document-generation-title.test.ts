import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DOCUMENT_GENERATION_TITLE_PATTERN,
  formatDocumentGenerationTitle,
  resolveDocumentGenerationTitle,
  selectDocumentGenerationTitleDate,
  isAutoDocumentGenerationTitle,
} from '@/lib/document-generation-title';

describe('document generation titles', () => {
  it('formats the default title with the template, company, and local date', () => {
    expect(formatDocumentGenerationTitle(
      'Appointment of Corp Sec',
      'Flowmind AI Pte. Limited',
      new Date(2026, 7, 29, 12),
    )).toBe('Appointment of Corp Sec_Flowmind AI Pte. Limited_29 Aug 2026');
  });

  it('recognises generated defaults while leaving custom titles alone', () => {
    expect(isAutoDocumentGenerationTitle(
      DEFAULT_DOCUMENT_GENERATION_TITLE_PATTERN,
      'Appointment of Corp Sec',
    )).toBe(true);
    expect(isAutoDocumentGenerationTitle('Untitled - Appointment of Corp Sec', 'Appointment of Corp Sec'))
      .toBe(true);
    expect(isAutoDocumentGenerationTitle(
      'Appointment of Corp Sec_Flowmind AI Pte. Limited_29 Aug 2026',
      'Appointment of Corp Sec',
    )).toBe(true);
    expect(isAutoDocumentGenerationTitle('Board approval - August', 'Appointment of Corp Sec'))
      .toBe(false);
  });

  it('resolves the supported title tokens and preserves a manual title', () => {
    expect(resolveDocumentGenerationTitle({
      title: DEFAULT_DOCUMENT_GENERATION_TITLE_PATTERN,
      templateName: 'DR_Appointment of Corp Sec',
      companyName: 'AI 4 Solutions Pte Ltd.',
      date: '2025-11-07',
    })).toBe('DR_Appointment of Corp Sec_AI 4 Solutions Pte Ltd._7 Nov 2025');

    expect(resolveDocumentGenerationTitle({
      title: 'Directors resolution – custom title',
      templateName: 'Ignored',
      companyName: 'Ignored',
      date: '2025-11-07',
    })).toBe('Directors resolution – custom title');
  });

  it('uses the selected agreement or custom date, then the generation date', () => {
    expect(selectDocumentGenerationTitleDate({
      values: { resolution_date: '2025-11-07' },
      serviceAgreementDate: '2026-01-02',
    })).toBe('2026-01-02');
    expect(selectDocumentGenerationTitleDate({
      values: { resolution_date: '2025-11-07' },
      selectedFieldKey: 'resolution_date',
    })).toBe('2025-11-07');
    expect(selectDocumentGenerationTitleDate({
      values: { resolution_date: '2025-11-07', meeting_date: '2025-12-01' },
      selectedFieldKey: 'meeting_date',
    })).toBe('2025-12-01');
    expect(selectDocumentGenerationTitleDate({
      values: {},
      fallbackDate: new Date(2026, 7, 31, 12),
    })).toEqual(new Date(2026, 7, 31, 12));
  });
});
