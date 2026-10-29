// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';

import { createDocxFixture } from '../helpers/docx-fixture';
import {
  createOakDocGenericRepeater,
  inspectOakDocGenericRepeaters,
  nameOakDocRepeaterItems,
  resolveOakDocGenericRepeaters,
  setOakDocGenericRepeaterLettering,
} from '@/lib/document-editor/oakdoc-generic-repeaters';
import { oakDocItemLetter } from '@/lib/document-editor/oakdoc-repeater-lettering';
import { oakDocOfficersRepeaterDefinition } from '@/lib/document-editor/oakdoc-repeater-definitions';

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WORD14_NS = 'http://schemas.microsoft.com/office/word/2010/wordml';

function docx(body: string): Uint8Array {
  return createDocxFixture({
    'word/document.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + `<w:document xmlns:w="${WORD_NS}" xmlns:w14="${WORD14_NS}"><w:body>${body}<w:sectPr/></w:body></w:document>`,
  });
}

function xml(bytes: Uint8Array): string {
  return strFromU8(unzipSync(bytes)['word/document.xml']);
}

function field(tag: string, id: number): string {
  return `<w:sdt><w:sdtPr><w:tag w:val="${tag}"/><w:id w:val="${id}"/></w:sdtPr>`
    + `<w:sdtContent><w:r><w:t>{{${tag}}}</w:t></w:r></w:sdtContent></w:sdt>`;
}

const INDENTED = '<w:pPr><w:ind w:left="720"/><w:jc w:val="both"/></w:pPr>';
const RUN = '<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr>';

/** A resignation partial: two indented paragraphs repeated for each secretary. */
function resignationSection(): Uint8Array {
  const source = docx(
    `<w:p w14:paraId="B1000001">${INDENTED}<w:r>${RUN}<w:t xml:space="preserve">the resignation of </w:t></w:r>${field('officer.name', 11)}</w:p>`
    + `<w:p w14:paraId="B1000002">${INDENTED}<w:r>${RUN}<w:t xml:space="preserve">In the event that </w:t></w:r>${field('officer.name', 12)}</w:p>`,
  );
  return createOakDocGenericRepeater({
    docxBytes: source,
    fromParaId: 'B1000001',
    toParaId: 'B1000002',
    definition: oakDocOfficersRepeaterDefinition(['SECRETARY']),
  }).bytes;
}

const company = {
  id: 'c1',
  name: 'Example',
  uen: '202600001A',
  officers: [
    { id: 's1', contactId: 'p1', name: 'LIM WEI SIANG', role: 'SECRETARY', isCurrent: true },
    { id: 's2', contactId: 'p2', name: 'HO WEI XIONG', role: 'SECRETARY', isCurrent: true },
  ],
};

describe('OakDoc repeating section lettering', () => {
  it('turns lettering on and off in the section title and reports it', () => {
    const plain = resignationSection();
    const tag = 'repeat.officers.secretary';
    expect(inspectOakDocGenericRepeaters(plain).letteredTags).toEqual([]);

    const lettered = setOakDocGenericRepeaterLettering({ docxBytes: plain, tag, lettered: true });
    expect(xml(lettered)).toContain('w:val="Officers (Secretary) repeater · Lettered (a), (b)"');
    expect(inspectOakDocGenericRepeaters(lettered).letteredTags).toEqual([tag]);
    // Already lettered: the same bytes come back.
    expect(setOakDocGenericRepeaterLettering({ docxBytes: lettered, tag, lettered: true })).toBe(lettered);
    // Items keep the plain section name.
    expect(xml(nameOakDocRepeaterItems(lettered))).not.toMatch(/repeatingSectionItem[^]*Lettered/);

    const off = setOakDocGenericRepeaterLettering({ docxBytes: lettered, tag, lettered: false });
    expect(xml(off)).toContain('w:val="Officers (Secretary) repeater"');
    expect(xml(off)).not.toContain('Lettered');
    expect(inspectOakDocGenericRepeaters(off).letteredTags).toEqual([]);
  });

  it('letters each person and indents their text when two or more are listed', () => {
    const bytes = setOakDocGenericRepeaterLettering({
      docxBytes: resignationSection(),
      tag: 'repeat.officers.secretary',
      lettered: true,
    });
    const resolved = resolveOakDocGenericRepeaters({
      docxBytes: bytes,
      data: { company, selectedOfficerIds: ['s1', 's2'] },
    });
    expect(resolved.itemsCreated).toBe(2);
    const out = xml(resolved.bytes);
    expect(out).toMatch(/<w:t>\(a\)<\/w:t><w:tab\/><\/w:r><w:r>[^]*?the resignation of [^]*?LIM WEI SIANG/);
    expect(out).toMatch(/<w:t>\(b\)<\/w:t><w:tab\/><\/w:r><w:r>[^]*?the resignation of [^]*?HO WEI XIONG/);
    // The letter keeps the paragraph's font and sits where the text was; the text moves one indent in.
    expect(out).toContain('<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr><w:t>(a)</w:t>');
    expect(out.match(/<w:tabs><w:tab w:val="left" w:pos="1440"\/><\/w:tabs><w:ind w:left="1440" w:hanging="720"\/>/g)).toHaveLength(2);
    // The second paragraph of each person lines up with the text after the letter.
    expect(out.match(/<w:ind w:left="1440"\/>/g)).toHaveLength(2);
  });

  it('prints one person without a letter', () => {
    const bytes = setOakDocGenericRepeaterLettering({
      docxBytes: resignationSection(),
      tag: 'repeat.officers.secretary',
      lettered: true,
    });
    const out = xml(resolveOakDocGenericRepeaters({
      docxBytes: bytes,
      data: { company, selectedOfficerIds: ['s1'] },
    }).bytes);
    expect(out).toContain('LIM WEI SIANG');
    expect(out).not.toContain('(a)');
    expect(out).not.toContain('w:left="1440"');
  });

  it('leaves an unlettered section as it was', () => {
    const out = xml(resolveOakDocGenericRepeaters({
      docxBytes: resignationSection(),
      data: { company, selectedOfficerIds: ['s1', 's2'] },
    }).bytes);
    expect(out).not.toContain('(a)');
    expect(out).not.toContain('w:left="1440"');
  });

  it('counts letters past z', () => {
    expect([0, 1, 25, 26, 27].map(oakDocItemLetter)).toEqual(['a', 'b', 'z', 'aa', 'ab']);
  });
});
