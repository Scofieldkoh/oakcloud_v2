// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  buildOakDocResolutionValues,
  formatAgreementTerm,
  formatOakDocDate,
  oakDocIsoDate,
} from '@/lib/document-editor/oakdoc-context';
import { writeOakDocControlValue } from '@/lib/document-editor/oakdoc-fields';
import { formatServiceAgreementCurrency } from '@/services/service-agreement/renderer';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function control(content: string, properties = ''): Element {
  const xml = new DOMParser().parseFromString(
    `<w:sdt xmlns:w="${W}"><w:sdtPr><w:tag w:val="x"/>${properties}</w:sdtPr><w:sdtContent>${content}</w:sdtContent></w:sdt>`,
    'application/xml',
  );
  return xml.documentElement;
}

function texts(sdt: Element): string[] {
  return Array.from(sdt.getElementsByTagNameNS(W, 't')).map((node) => node.textContent ?? '');
}

describe('agreement value formatting', () => {
  it('formats dates by pattern without shifting the calendar day', () => {
    expect(formatOakDocDate('2026-07-09', 'd MMMM yyyy')).toBe('9 July 2026');
    expect(formatOakDocDate(new Date('2026-07-09T00:00:00.000Z'), 'd MMMM yyyy')).toBe('9 July 2026');
    expect(formatOakDocDate('2026-07-09')).toBe('9 Jul 2026');
    expect(formatOakDocDate('2026-07-09', 'dd/MM/yyyy')).toBe('09/07/2026');
    expect(oakDocIsoDate('2026-07-09T00:00:00.000Z')).toBe('2026-07-09');
    expect(oakDocIsoDate('Director')).toBeUndefined();
  });

  it('uses the agreement date when there is no effective date, whoever supplies the dates', () => {
    const values = buildOakDocResolutionValues({
      company: { id: 'company-1', name: 'Example Pte. Ltd.' } as never,
      fieldTags: ['agreement.effectiveDate'],
      agreement: { agreementDate: '2026-07-09', effectiveDate: null, termMonths: 12 },
    });
    expect(values['agreement.effectiveDate']).toBe('9 Jul 2026');
  });

  it('writes the term in words', () => {
    expect(formatAgreementTerm(12)).toBe('1 year');
    expect(formatAgreementTerm(24)).toBe('2 years');
    expect(formatAgreementTerm(18)).toBe('18 months');
    expect(formatAgreementTerm(1)).toBe('1 month');
    expect(formatAgreementTerm(0)).toBeUndefined();
  });

  it('drops cents only for whole amounts when asked', () => {
    expect(formatServiceAgreementCurrency('1500.00', 'SGD', { wholeAmounts: true })).toBe('S$1,500');
    expect(formatServiceAgreementCurrency('800.50', 'SGD', { wholeAmounts: true })).toBe('S$800.50');
    expect(formatServiceAgreementCurrency('1500.00', 'SGD')).toBe('S$1,500.00');
  });
});

describe('writeOakDocControlValue', () => {
  it('uses the control date format when an ISO date is known', () => {
    const sdt = control('<w:r><w:t>date</w:t></w:r>', '<w:date><w:dateFormat w:val="d MMMM yyyy"/></w:date>');
    writeOakDocControlValue(sdt, '9 Jul 2026', { isoDate: '2026-07-09' });
    expect(texts(sdt)).toEqual(['9 July 2026']);
  });

  it('replaces placeholder line breaks with the new lines', () => {
    const sdt = control('<w:r><w:t>old</w:t><w:br/><w:t>old</w:t></w:r>');
    writeOakDocControlValue(sdt, 'Line 1\nLine 2\nLine 3');
    expect(texts(sdt).filter(Boolean)).toEqual(['Line 1', 'Line 2', 'Line 3']);
    expect(sdt.getElementsByTagNameNS(W, 'br')).toHaveLength(2);
  });

  it('points an email hyperlink at the new address and unlinks an empty one', () => {
    const field = [
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r>',
      '<w:r><w:instrText> HYPERLINK "mailto:placeholder@example.com" </w:instrText></w:r>',
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r>',
      '<w:r><w:t>placeholder@example.com</w:t></w:r>',
      '<w:r><w:fldChar w:fldCharType="end"/></w:r>',
    ].join('');
    const linked = control(field);
    writeOakDocControlValue(linked, 'person@example.com');
    expect(linked.getElementsByTagNameNS(W, 'instrText')[0].textContent).toBe(' HYPERLINK "mailto:person@example.com" ');

    const empty = control(field);
    writeOakDocControlValue(empty, '');
    expect(empty.getElementsByTagNameNS(W, 'instrText')).toHaveLength(0);
    expect(empty.getElementsByTagNameNS(W, 'fldChar')).toHaveLength(0);
  });
});
