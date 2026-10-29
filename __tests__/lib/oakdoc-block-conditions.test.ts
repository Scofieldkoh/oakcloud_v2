// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';

import { createDocxFixture } from '../helpers/docx-fixture';
import { createOakDocBlockCondition } from '@/lib/document-editor/oakdoc-block-conditions';
import { closestWordElement } from '@/lib/document-editor/oakdoc-blocks';
import { resolveOakDocConditions } from '@/lib/document-editor/oakdoc-conditions';

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WORD14_NS = 'http://schemas.microsoft.com/office/word/2010/wordml';
const CONTENT_TYPES_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const PACKAGE_RELS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';

function docx(body: string): Uint8Array {
  return createDocxFixture({
    '[Content_Types].xml': [
      '<Types xmlns="' + CONTENT_TYPES_NS + '">',
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
      '<Default Extension="xml" ContentType="application/xml"/>',
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
      '</Types>',
    ].join(''),
    '_rels/.rels': [
      '<Relationships xmlns="' + PACKAGE_RELS_NS + '">',
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
      '</Relationships>',
    ].join(''),
    'word/document.xml': [
      '<w:document xmlns:w="' + WORD_NS + '" xmlns:w14="' + WORD14_NS + '">',
      '<w:body>' + body + '<w:sectPr/></w:body></w:document>',
    ].join(''),
  });
}

function part(bytes: Uint8Array): string {
  return strFromU8(unzipSync(bytes)['word/document.xml']);
}

const allowed = new Set(['company.name']);

describe('OakDoc multi-block conditions', () => {
  it('walks from a paragraph to its containing Word table row', () => {
    const xml = new DOMParser().parseFromString(
      '<w:document xmlns:w="' + WORD_NS + '"><w:body><w:tbl><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl></w:body></w:document>',
      'application/xml',
    );
    const paragraph = xml.getElementsByTagNameNS(WORD_NS, 'p')[0];
    const row = closestWordElement(paragraph, 'tr');

    expect(row?.localName).toBe('tr');
    expect(row?.namespaceURI).toBe(WORD_NS);
  });

  it('wraps multiple sibling paragraphs and unwraps all of them when kept', () => {
    const created = createOakDocBlockCondition({
      docxBytes: docx(
        '<w:p w14:paraId="A1B2C3D4"><w:r><w:t>First clause</w:t></w:r></w:p>'
        + '<w:p w14:paraId="A1B2C3D5"><w:r><w:t>Second clause</w:t></w:r></w:p>',
      ),
      fromParaId: 'A1B2C3D4',
      toParaId: 'A1B2C3D5',
      condition: { field: 'company.name', operator: 'truthy' },
      allowedFields: allowed,
    });

    expect(created.targetKind).toBe('block range');
    const resolved = resolveOakDocConditions({
      docxBytes: created.bytes,
      values: { 'company.name': 'Example Pte. Ltd.' },
      allowedFields: allowed,
    });
    const output = part(resolved.bytes);
    expect(resolved.kept).toBe(1);
    expect(output).toContain('First clause');
    expect(output).toContain('Second clause');
    expect(output).not.toContain(created.condition.tag);
  });

  it('wraps multiple sibling table rows and removes the entire region when false', () => {
    const created = createOakDocBlockCondition({
      docxBytes: docx(
        '<w:tbl>'
        + '<w:tr><w:tc><w:p w14:paraId="B1C2D3E4"><w:r><w:t>Row one</w:t></w:r></w:p></w:tc></w:tr>'
        + '<w:tr><w:tc><w:p w14:paraId="B1C2D3E5"><w:r><w:t>Row two</w:t></w:r></w:p></w:tc></w:tr>'
        + '</w:tbl>',
      ),
      fromParaId: 'B1C2D3E4',
      toParaId: 'B1C2D3E5',
      condition: { field: 'company.name', operator: 'equals', value: 'Keep' },
      allowedFields: allowed,
    });

    expect(created.targetKind).toBe('table row range');
    const resolved = resolveOakDocConditions({
      docxBytes: created.bytes,
      values: { 'company.name': 'Remove' },
      allowedFields: allowed,
    });
    const output = part(resolved.bytes);
    expect(resolved.removed).toBe(1);
    expect(output).not.toContain('Row one');
    expect(output).not.toContain('Row two');
  });

  it('rejects a controlled region that crosses a Word section boundary', () => {
    expect(() => createOakDocBlockCondition({
      docxBytes: docx(
        '<w:p w14:paraId="C1D2E3F4"><w:r><w:t>First</w:t></w:r></w:p>'
        + '<w:p w14:paraId="C1D2E3F5"><w:pPr><w:sectPr/></w:pPr><w:r><w:t>Second</w:t></w:r></w:p>',
      ),
      fromParaId: 'C1D2E3F4',
      toParaId: 'C1D2E3F5',
      condition: { field: 'company.name', operator: 'truthy' },
      allowedFields: allowed,
    })).toThrow('section boundary');
  });
});
