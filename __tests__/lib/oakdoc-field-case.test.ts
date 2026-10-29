// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  applyOakDocFieldCase,
  normalizeOakDocDateFormat,
  oakDocFieldCaseOfTitle,
  oakDocFieldDateFormatOfTitle,
  oakDocFieldTitle,
} from '@/lib/document-editor/oakdoc-field-case';
import { writeOakDocControlValue } from '@/lib/document-editor/oakdoc-fields';

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function control(alias: string): Element {
  const xml = new DOMParser().parseFromString(
    `<w:sdt xmlns:w="${WORD_NS}"><w:sdtPr><w:alias w:val="${alias}"/><w:tag w:val="officer.name"/></w:sdtPr>`
      + '<w:sdtContent><w:r><w:t>{{officer.name}}</w:t></w:r></w:sdtContent></w:sdt>',
    'application/xml',
  );
  return xml.documentElement;
}

describe('OakDoc field text case', () => {
  it('keeps the case in the field title and reads it back', () => {
    expect(oakDocFieldTitle('Full Address', 'upper')).toBe('Full Address · UPPERCASE');
    expect(oakDocFieldTitle('Officer Name', 'title')).toBe('Officer Name · Title Case');
    expect(oakDocFieldTitle('Officer Name')).toBe('Officer Name');
    expect(oakDocFieldCaseOfTitle('Full Address · UPPERCASE')).toBe('upper');
    expect(oakDocFieldCaseOfTitle('Officer Name · Title Case')).toBe('title');
    expect(oakDocFieldCaseOfTitle('Officer Name')).toBeNull();
  });

  it('prints values in upper or title case', () => {
    expect(applyOakDocFieldCase('21 Bukit Batok Crescent, #25-72', 'upper')).toBe('21 BUKIT BATOK CRESCENT, #25-72');
    expect(applyOakDocFieldCase('TAN WEI JIE', 'title')).toBe('Tan Wei Jie');
    expect(applyOakDocFieldCase('WONG LEE CHUIN (HUANG LIQIN)', 'title')).toBe('Wong Lee Chuin (Huang Liqin)');
    expect(applyOakDocFieldCase('Tan Wei Jie', null)).toBe('Tan Wei Jie');
  });

  it('writes a field value in the case its title asks for', () => {
    const upper = control('Officer Name · UPPERCASE');
    writeOakDocControlValue(upper, 'Tan Wei Jie');
    expect(upper.textContent).toBe('TAN WEI JIE');
    const stored = control('Officer Name');
    writeOakDocControlValue(stored, 'Tan Wei Jie');
    expect(stored.textContent).toBe('Tan Wei Jie');
  });

  it('keeps a date format in the field title beside the case', () => {
    expect(oakDocFieldTitle('Resolution Date', null, 'dd/MM/yyyy')).toBe('Resolution Date · dd/MM/yyyy');
    expect(oakDocFieldTitle('First FYE', 'upper', 'd MMM yyyy')).toBe('First FYE · UPPERCASE · d MMM yyyy');
    expect(oakDocFieldDateFormatOfTitle('First FYE · UPPERCASE · d MMM yyyy')).toBe('d MMM yyyy');
    expect(oakDocFieldCaseOfTitle('First FYE · UPPERCASE · d MMM yyyy')).toBe('upper');
    expect(oakDocFieldDateFormatOfTitle('Resolution Date')).toBeNull();
    expect(oakDocFieldDateFormatOfTitle('Officers (Secretary) repeater · Lettered (a), (b)')).toBeNull();
  });

  it('reads date formats as people type them', () => {
    expect(normalizeOakDocDateFormat('dd/mm/yyyy')).toBe('dd/MM/yyyy');
    expect(normalizeOakDocDateFormat('dd mmm yyyy')).toBe('dd MMM yyyy');
    expect(normalizeOakDocDateFormat(' D MMMM YYYY ')).toBe('d MMMM yyyy');
    expect(normalizeOakDocDateFormat('mmmm d, yyyy')).toBe('MMMM d, yyyy');
    expect(normalizeOakDocDateFormat('dd.mm.yy')).toBe('dd.MM.yy');
    expect(normalizeOakDocDateFormat('yyyy')).toBeNull();
    expect(normalizeOakDocDateFormat('the date')).toBeNull();
    expect(normalizeOakDocDateFormat('ddd/mm/yyy')).toBeNull();
    expect(normalizeOakDocDateFormat('')).toBeNull();
  });

  it('writes a date in the format and case its title asks for', () => {
    const date = control('First FYE · UPPERCASE · d MMM yyyy');
    writeOakDocControlValue(date, '31 December 2026', { isoDate: '2026-12-31' });
    expect(date.textContent).toBe('31 DEC 2026');
    const slashed = control('Resolution Date · dd/MM/yyyy');
    writeOakDocControlValue(slashed, '4 October 2026', { isoDate: '2026-10-04' });
    expect(slashed.textContent).toBe('04/10/2026');
  });

  it('prints the day as an ordinal with do', () => {
    expect(normalizeOakDocDateFormat('do MMMM yyyy')).toBe('do MMMM yyyy');
    expect(normalizeOakDocDateFormat('MMMM, yyyy')).toBe('MMMM, yyyy');
    const write = (iso: string) => {
      const sdt = control('Appointment date · do');
      writeOakDocControlValue(sdt, iso, { isoDate: iso });
      return sdt.textContent;
    };
    expect(write('2026-10-01')).toBe('1st');
    expect(write('2026-10-02')).toBe('2nd');
    expect(write('2026-10-03')).toBe('3rd');
    expect(write('2026-10-11')).toBe('11th');
    expect(write('2026-10-12')).toBe('12th');
    expect(write('2026-10-13')).toBe('13th');
    expect(write('2026-10-22')).toBe('22nd');
    expect(write('2026-10-31')).toBe('31st');
  });
});
