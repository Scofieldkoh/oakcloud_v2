// @vitest-environment jsdom
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  buildOakDocFromHtml,
  diagnoseHtmlForOakDocImport,
  readOakDocBodyText,
  wordTextPreservesHtmlText,
} from '@/lib/document-editor/oakdoc-html-import';
import { inspectOakDocPackage } from '@/lib/document-editor/oakdoc-package-policy';

function documentXml(bytes: Uint8Array): string {
  return strFromU8(unzipSync(bytes)['word/document.xml']);
}

function codes(html: string): string[] {
  return diagnoseHtmlForOakDocImport(html).map((entry) => entry.code);
}

describe('OakDoc HTML import', () => {
  it('keeps manually edited text, structure and page breaks in a valid package', () => {
    const html = [
      '<h1>Board resolution</h1>',
      '<p style="text-align:center">Resolved that <strong>Acme</strong> <em>appoints</em> the auditor<sup>1</sup>.</p>',
      '<ol start="3"><li>First</li><li>Second</li></ol>',
      '<span data-a4-break="page"></span>',
      '<table><thead><tr><th>Name</th><th>Role</th></tr></thead><tbody><tr><td>Jane Tan</td><td>Director</td></tr></tbody></table>',
    ].join('');

    const { bytes, diagnostics } = buildOakDocFromHtml(html);
    const xml = documentXml(bytes);

    expect(() => inspectOakDocPackage(bytes, 'draft')).not.toThrow();
    expect(diagnostics.filter((entry) => entry.severity === 'error')).toEqual([]);
    expect(xml).toContain('w:val="Heading1"');
    expect(xml).toContain('w:val="center"');
    expect(xml).toContain('w:type="page"');
    expect(xml).toContain('w:val="superscript"');
    expect(xml).toContain('3. ');
    expect(xml).toContain('4. ');
    expect(xml).toContain('<w:tbl>');
    expect(readOakDocBodyText(bytes)).toContain('Jane Tan');
    expect(wordTextPreservesHtmlText(html, readOakDocBodyText(bytes))).toBe(true);
  });

  it('reports content it cannot carry over instead of dropping it silently', () => {
    const html = [
      '<p><img src="data:image/png;base64,AA==" alt="logo"></p>',
      '<table><tr><td colspan="2">Merged</td></tr></table>',
      '<ul><li>Parent<ul><li>Child</li></ul></li></ul>',
      '<p>Dear {{director.name}}, see <a href="https://example.com">our site</a>.</p>',
      '<p style="color:red">Red</p>',
    ].join('');

    const found = diagnoseHtmlForOakDocImport(html);
    const errors = found.filter((entry) => entry.severity === 'error').map((entry) => entry.code);
    expect(errors).toEqual(expect.arrayContaining([
      'OAKDOC_IMPORT_IMAGE_DROPPED',
      'OAKDOC_IMPORT_MERGED_CELLS',
      'OAKDOC_IMPORT_NESTED_LIST',
      'OAKDOC_IMPORT_UNRESOLVED_PLACEHOLDER',
    ]));
    expect(codes(html)).toEqual(expect.arrayContaining([
      'OAKDOC_IMPORT_LINK_TARGET_DROPPED',
      'OAKDOC_IMPORT_STYLE_DROPPED',
      'OAKDOC_IMPORT_LIST_AS_TEXT',
    ]));
    expect(found.every((entry) => entry.stage === 'import')).toBe(true);

    // Nested list text is merged into the parent item, not lost.
    const { bytes } = buildOakDocFromHtml(html);
    expect(readOakDocBodyText(bytes)).toContain('Child');
  });

  it('does not report plain content', () => {
    expect(codes('<p>Plain <b>text</b> with <a href="mailto:a@b.co">a@b.co</a></p>')).toEqual([]);
  });

  it('detects text that did not make it into the Word body', () => {
    expect(wordTextPreservesHtmlText('<p>Alpha</p><p>Beta</p>', 'Alpha • Beta')).toBe(true);
    expect(wordTextPreservesHtmlText('<p>Alpha</p><p>Beta</p>', 'Alpha')).toBe(false);
  });

  it('removes active content', () => {
    const { bytes, diagnostics } = buildOakDocFromHtml('<p>Safe</p><script>alert(1)</script>');
    expect(documentXml(bytes)).not.toContain('alert');
    expect(diagnostics.map((entry) => entry.code)).toContain('OAKDOC_IMPORT_ACTIVE_CONTENT_REMOVED');
  });
});
