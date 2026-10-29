// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';

import { createDocxFixture } from '../helpers/docx-fixture';

import { resolveOakDocFields } from '@/lib/document-editor/oakdoc-fields';
import {
  createOakDocRepeater,
  inspectOakDocRepeaters,
  OAKDOC_REPEATER_DEFINITIONS,
  removeOakDocRepeater,
  resolveOakDocRepeaters,
} from '@/lib/document-editor/oakdoc-repeaters';

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WORD14_NS = 'http://schemas.microsoft.com/office/word/2010/wordml';

function docx(body: string): Uint8Array {
  const xml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:document',
    ' xmlns:w="' + WORD_NS + '"',
    ' xmlns:w14="' + WORD14_NS + '">',
    '<w:body>',
    body,
    '<w:sectPr/>',
    '</w:body>',
    '</w:document>',
  ].join('');

  return createDocxFixture({
    'word/document.xml': xml,
  });
}

function documentXml(bytes: Uint8Array): string {
  const files = unzipSync(bytes);
  return strFromU8(files['word/document.xml']);
}

function textControl(tag: string, value: string, id: number): string {
  return [
    '<w:sdt>',
    '<w:sdtPr>',
    '<w:alias w:val="' + tag + '"/>',
    '<w:tag w:val="' + tag + '"/>',
    '<w:id w:val="' + id + '"/>',
    '</w:sdtPr>',
    '<w:sdtContent><w:r><w:t>' + value + '</w:t></w:r></w:sdtContent>',
    '</w:sdt>',
  ].join('');
}

describe('OakDoc repeating sections', () => {
  it('repeats one paragraph for each current director and resolves item fields', () => {
    const source = docx(
      '<w:p w14:paraId="A1B2C3D4">'
      + '<w:r><w:t>Director: </w:t></w:r>'
      + textControl('director.name', '{{director.name}}', 10)
      + '<w:r><w:t> of </w:t></w:r>'
      + textControl('company.name', '{{company.name}}', 11)
      + '</w:p>',
    );

    const created = createOakDocRepeater({
      docxBytes: source,
      fromParaId: 'A1B2C3D4',
      definition: OAKDOC_REPEATER_DEFINITIONS[0],
    });

    expect(created.targetKind).toBe('paragraph');
    expect(inspectOakDocRepeaters(created.bytes)).toEqual({
      count: 1,
      tags: ['repeat.directors'],
      letteredTags: [],
    });
    expect(documentXml(created.bytes)).toContain('w15:repeatingSection');

    const expanded = resolveOakDocRepeaters({
      docxBytes: created.bytes,
      company: {
        id: 'company-1',
        name: 'Example Pte. Ltd.',
        uen: '202600001A',
        officers: [
          {
            id: 'director-1',
            name: 'John Tan',
            role: 'Director',
            isCurrent: true,
          },
          {
            id: 'director-2',
            name: 'Jane Lim',
            role: 'Managing Director',
            isCurrent: true,
          },
          {
            id: 'ceased-director',
            name: 'Ceased Person',
            role: 'Director',
            isCurrent: false,
          },
        ],
      },
    });

    expect(expanded).toMatchObject({
      repeatersResolved: 1,
      itemsCreated: 2,
      fieldsResolved: 2,
    });

    const withCompany = resolveOakDocFields(expanded.bytes, {
      'company.name': 'Example Pte. Ltd.',
    });
    const output = documentXml(withCompany.bytes);

    expect(output).toContain('John Tan');
    expect(output).toContain('Jane Lim');
    expect(output).not.toContain('Ceased Person');
    expect(output).not.toContain('repeat.directors');
    expect(output).not.toContain('director.name');
    expect(output.match(/<w:p(?:\s|>)/g)).toHaveLength(2);
    expect(output.match(/Example Pte\. Ltd\./g)).toHaveLength(2);

    const paraIds = Array.from(output.matchAll(/w14:paraId="([^"]+)"/g))
      .map((match) => match[1]);
    expect(new Set(paraIds).size).toBe(paraIds.length);

    const ids = Array.from(output.matchAll(/<w:id[^>]+w:val="([^"]+)"/g))
      .map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('repeats a whole table row for each current shareholder', () => {
    const source = docx(
      '<w:tbl>'
      + '<w:tr>'
      + '<w:tc><w:p w14:paraId="B1C2D3E4">'
      + textControl('shareholder.name', '{{shareholder.name}}', 20)
      + '</w:p></w:tc>'
      + '<w:tc><w:p w14:paraId="B1C2D3E5">'
      + textControl('shareholder.numberOfShares', '{{shareholder.numberOfShares}}', 21)
      + '</w:p></w:tc>'
      + '</w:tr>'
      + '</w:tbl>',
    );

    const created = createOakDocRepeater({
      docxBytes: source,
      fromParaId: 'B1C2D3E4',
      toParaId: 'B1C2D3E5',
      definition: OAKDOC_REPEATER_DEFINITIONS[1],
    });

    expect(created.targetKind).toBe('table row');

    const expanded = resolveOakDocRepeaters({
      docxBytes: created.bytes,
      company: {
        id: 'company-1',
        name: 'Example Pte. Ltd.',
        uen: '202600001A',
        shareholders: [
          {
            id: 'shareholder-1',
            name: 'Alice',
            numberOfShares: 1000,
            isCurrent: true,
          },
          {
            id: 'shareholder-2',
            name: 'Bob',
            numberOfShares: 2500,
            isCurrent: true,
          },
        ],
      },
    });

    const output = documentXml(expanded.bytes);
    expect(expanded).toMatchObject({
      repeatersResolved: 1,
      itemsCreated: 2,
      fieldsResolved: 4,
    });
    expect(output.match(/<w:tr(?:\s|>)/g)).toHaveLength(2);
    expect(output).toContain('Alice');
    expect(output).toContain('Bob');
    expect(output).toContain('1,000');
    expect(output).toContain('2,500');
    expect(output).not.toContain('repeat.shareholders');
  });

  it('removes a repeating template structure when there are no matching current items', () => {
    const source = docx(
      '<w:p w14:paraId="C1D2E3F4">'
      + textControl('director.name', '{{director.name}}', 30)
      + '</w:p>',
    );

    const created = createOakDocRepeater({
      docxBytes: source,
      fromParaId: 'C1D2E3F4',
      definition: OAKDOC_REPEATER_DEFINITIONS[0],
    });

    const expanded = resolveOakDocRepeaters({
      docxBytes: created.bytes,
      company: {
        id: 'company-1',
        name: 'Example Pte. Ltd.',
        uen: '202600001A',
        officers: [],
      },
    });

    const output = documentXml(expanded.bytes);
    expect(expanded.itemsCreated).toBe(0);
    expect(output).not.toContain('C1D2E3F4');
    expect(output).not.toContain('repeat.directors');
  });
  it('unwraps a repeater at the caret while keeping the template structure', () => {
    const source = docx(
      '<w:p w14:paraId="D1E2F3A4">'
      + textControl('director.name', '{{director.name}}', 40)
      + '</w:p>',
    );

    const created = createOakDocRepeater({
      docxBytes: source,
      fromParaId: 'D1E2F3A4',
      definition: OAKDOC_REPEATER_DEFINITIONS[0],
    });

    const removed = removeOakDocRepeater({
      docxBytes: created.bytes,
      paraId: 'D1E2F3A4',
    });

    const output = documentXml(removed.bytes);
    expect(removed.tag).toBe('repeat.directors');
    expect(inspectOakDocRepeaters(removed.bytes).count).toBe(0);
    expect(output).toContain('D1E2F3A4');
    expect(output).toContain('director.name');
    expect(output).not.toContain('w15:repeatingSection');
  });

});
