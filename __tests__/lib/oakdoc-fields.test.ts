// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';

import { createDocxFixture } from '../helpers/docx-fixture';

import {
  normalizeOakDocFields,
  pruneDeletedOakDocFields,
} from '@/lib/document-editor/oakdoc-fields';

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function docx(body: string): Uint8Array {
  const xml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:document xmlns:w="' + WORD_NS + '">',
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

function placeholderControl(tag: string, id: number, content: string): string {
  return [
    '<w:sdt>',
    '<w:sdtPr>',
    '<w:tag w:val="' + tag + '"/>',
    '<w:id w:val="' + id + '"/>',
    '<w:showingPlcHdr/>',
    '</w:sdtPr>',
    '<w:sdtContent>',
    content,
    '</w:sdtContent>',
    '</w:sdt>',
  ].join('');
}

describe('OakDoc field cleanup', () => {
  const knownTags = new Set(['company.name']);

  it('unwraps a deleted inline field instead of deleting its run structure', () => {
    const source = docx(
      '<w:p>'
      + '<w:r><w:t>Before </w:t></w:r>'
      + placeholderControl(
        'company.name',
        10,
        '<w:r><w:rPr><w:b/></w:rPr><w:t>Click here to enter text.</w:t></w:r>',
      )
      + '<w:r><w:t> After</w:t></w:r>'
      + '</w:p>',
    );

    const cleaned = pruneDeletedOakDocFields(source, knownTags);
    const output = documentXml(cleaned.bytes);

    expect(cleaned.removed).toBe(1);
    expect(output).not.toContain('<w:sdt>');
    expect(output).not.toContain('Click here to enter text');
    expect(output).toContain('<w:rPr><w:b/></w:rPr>');
    expect(output).toContain('Before ');
    expect(output).toContain(' After');
  });

  it('removes the empty field shells a cut leaves behind and keeps filled fields', () => {
    const field = (id: number, content: string) =>
      '<w:sdt><w:sdtPr><w:tag w:val="company.name"/><w:id w:val="' + id + '"/></w:sdtPr>'
      + content + '</w:sdt>';
    const source = docx(
      '<w:p>' + field(20, '<w:sdtContent><w:r><w:t>{{company.name}}</w:t></w:r></w:sdtContent>') + '</w:p>'
      + '<w:p>' + field(21, '<w:sdtContent/>')
      + '<w:r><w:t xml:space="preserve"> and </w:t></w:r>'
      + field(22, '<w:sdtContent><w:r><w:t></w:t></w:r></w:sdtContent>') + '</w:p>',
    );

    const cleaned = pruneDeletedOakDocFields(source, knownTags);
    const output = documentXml(cleaned.bytes);

    expect(cleaned.removed).toBe(2);
    expect(output.match(/<w:sdt>/g)).toHaveLength(1);
    expect(output).toContain('{{company.name}}');
    expect(output).toContain(' and ');
  });

  it('moves text typed at a field edge out of the field', () => {
    const source = docx(
      '<w:p><w:sdt><w:sdtPr><w:tag w:val="company.name"/><w:id w:val="30"/></w:sdtPr>'
      + '<w:sdtContent><w:r><w:rPr><w:b/></w:rPr><w:t>Mr {{company.name}}, Esq</w:t></w:r></w:sdtContent></w:sdt></w:p>',
    );

    const cleaned = pruneDeletedOakDocFields(source, knownTags);
    const output = documentXml(cleaned.bytes);

    expect(cleaned.removed).toBe(0);
    expect(cleaned.changed).toBe(1);
    expect(output).toContain(
      '<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Mr </w:t></w:r><w:sdt>',
    );
    expect(output).toContain('<w:t>{{company.name}}</w:t>');
    expect(output).toContain('</w:sdt><w:r><w:rPr><w:b/></w:rPr><w:t>, Esq</w:t></w:r>');
  });

  it('preserves paragraph structure when a deleted block field is inside a table cell', () => {
    const source = docx(
      '<w:tbl><w:tr><w:tc>'
      + placeholderControl(
        'company.name',
        11,
        '<w:p><w:pPr><w:jc w:val="center"/></w:pPr>'
        + '<w:r><w:t>Click here to enter text.</w:t></w:r></w:p>',
      )
      + '</w:tc></w:tr></w:tbl>',
    );

    const cleaned = pruneDeletedOakDocFields(source, knownTags);
    const output = documentXml(cleaned.bytes);

    expect(cleaned.removed).toBe(1);
    expect(output).not.toContain('<w:sdt>');
    expect(output).not.toContain('Click here to enter text');
    expect(output).toContain('<w:tc>');
    expect(output).toContain('<w:p>');
    expect(output).toContain('<w:pPr><w:jc w:val="center"/></w:pPr>');
  });

  it('keeps a newly inserted field and seeds its OakDoc token', () => {
    const before = docx('<w:p><w:r><w:t>Existing</w:t></w:r></w:p>');
    const after = docx(
      '<w:p>'
      + placeholderControl(
        'company.name',
        12,
        '<w:r><w:t>Click here to enter text.</w:t></w:r>',
      )
      + '</w:p>',
    );

    const normalized = normalizeOakDocFields({
      beforeBytes: before,
      afterBytes: after,
      insertedField: { tag: 'company.name' },
      knownTags,
    });
    const output = documentXml(normalized.bytes);

    expect(normalized.seeded).toBe(1);
    expect(normalized.removed).toBe(0);
    expect(output).toContain('{{company.name}}');
    expect(output).toContain('<w:sdt>');
    expect(output).not.toContain('w:showingPlcHdr');
  });
});
