// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import {
  OAKDOC_PACKAGE_LIMITS,
  OakDocPackageError,
  inspectOakDocPackage,
} from '@/lib/document-editor/oakdoc-package-policy';

const CONTENT_TYPES = '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
  + '<Override PartName="/word/document.xml" '
  + 'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
  + '</Types>';
const DOCUMENT = '<w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>Hello</w:t></w:r></w:p></w:body></w:document>';

function docx(extra: Record<string, string | Uint8Array> = {}, base = true): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  if (base) {
    entries['[Content_Types].xml'] = strToU8(CONTENT_TYPES);
    entries['word/document.xml'] = strToU8(DOCUMENT);
  }
  for (const [name, value] of Object.entries(extra)) {
    entries[name] = typeof value === 'string' ? strToU8(value) : value;
  }
  return zipSync(entries);
}

function checkOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(OakDocPackageError);
    return (error as OakDocPackageError).check;
  }
  return undefined;
}

describe('OakDoc package policy', () => {
  it('accepts a minimal Word package and reports its identity', () => {
    const bytes = docx();
    const result = inspectOakDocPackage(bytes, 'master');
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.parts).toEqual(['[Content_Types].xml', 'word/document.xml']);
    expect(result.entryCount).toBe(2);
  });

  it('rejects empty, non-ZIP and legacy/encrypted Word files', () => {
    expect(checkOf(() => inspectOakDocPackage(new Uint8Array(), 'draft'))).toBe('empty');
    expect(checkOf(() => inspectOakDocPackage(strToU8('hello'), 'draft'))).toBe('not-zip');
    expect(checkOf(() => inspectOakDocPackage(
      new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1]),
      'draft',
    ))).toBe('encrypted');
  });

  it('enforces the compressed master and draft limits separately', () => {
    const big = new Uint8Array(OAKDOC_PACKAGE_LIMITS.masterCompressedBytes + 1);
    big[0] = 0x50;
    big[1] = 0x4b;
    expect(checkOf(() => inspectOakDocPackage(big, 'master'))).toBe('compressed-size');
    expect(checkOf(() => inspectOakDocPackage(big, 'draft'))).toBe('unreadable');
  });

  it('rejects packages without the Word main part or with a macro content type', () => {
    expect(checkOf(() => inspectOakDocPackage(
      docx({ '[Content_Types].xml': CONTENT_TYPES }, false),
      'draft',
    ))).toBe('missing-main-part');
    expect(checkOf(() => inspectOakDocPackage(zipSync({
      '[Content_Types].xml': strToU8('<Types><Override PartName="/word/document.xml" ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/></Types>'),
      'word/document.xml': strToU8(DOCUMENT),
    }), 'draft'))).toBe('content-type');
  });

  it('rejects traversal paths, duplicate parts and macro payloads', () => {
    expect(checkOf(() => inspectOakDocPackage(docx({ '../evil.xml': '<a/>' }), 'draft'))).toBe('entry-path');
    expect(checkOf(() => inspectOakDocPackage(docx({ 'WORD/document.xml': DOCUMENT }), 'draft'))).toBe('entry-duplicate');
    expect(checkOf(() => inspectOakDocPackage(docx({ 'word/vbaProject.bin': new Uint8Array([1, 2]) }), 'draft')))
      .toBe('entry-executable');
  });

  it('rejects DTDs, entity declarations and excessive nesting', () => {
    expect(checkOf(() => inspectOakDocPackage(docx({
      'word/styles.xml': '<!DOCTYPE x [<!ENTITY e "boom">]><x>&e;</x>',
    }), 'draft'))).toBe('xml-dtd');
    const deep = `${'<a>'.repeat(OAKDOC_PACKAGE_LIMITS.xmlDepth + 1)}${'</a>'.repeat(OAKDOC_PACKAGE_LIMITS.xmlDepth + 1)}`;
    expect(checkOf(() => inspectOakDocPackage(docx({ 'word/footer1.xml': deep }), 'draft'))).toBe('xml-bounds');
  });

  it('only allows external hyperlinks with safe schemes', () => {
    const rels = (type: string, target: string) => '<Relationships>'
      + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}" TargetMode="External"/>`
      + '</Relationships>';
    const ok = inspectOakDocPackage(docx({ 'word/_rels/document.xml.rels': rels('hyperlink', 'https://oakcloud.example') }), 'draft');
    expect(ok.externalHyperlinkCount).toBe(1);
    expect(checkOf(() => inspectOakDocPackage(
      docx({ 'word/_rels/document.xml.rels': rels('hyperlink', 'javascript:alert(1)') }),
      'draft',
    ))).toBe('hyperlink-scheme');
    expect(checkOf(() => inspectOakDocPackage(
      docx({ 'word/_rels/document.xml.rels': rels('image', 'https://tracker.example/pixel.png') }),
      'draft',
    ))).toBe('external-relationship');
    expect(checkOf(() => inspectOakDocPackage(
      docx({ 'word/_rels/settings.xml.rels': rels('attachedTemplate', 'file:///share/evil.dotm') }),
      'draft',
    ))).toBe('external-relationship');
  });

  it('rejects highly compressible bombs by expansion ratio', () => {
    const bomb = strToU8('a'.repeat(3 * 1024 * 1024));
    expect(checkOf(() => inspectOakDocPackage(docx({ 'word/media/blob.bin': bomb }), 'draft'))).toBe('expansion-ratio');
  });
});
