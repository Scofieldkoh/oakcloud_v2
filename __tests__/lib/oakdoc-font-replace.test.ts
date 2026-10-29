// @vitest-environment jsdom
import { strFromU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { replaceOakDocFont } from '@/lib/document-editor/oakdoc-font-replace';
import { buildBlankOakDocBytes } from '@/lib/document-editor/oakdoc-html-import';
import { inspectOakDocPackage } from '@/lib/document-editor/oakdoc-package-policy';
import { encodeOakDocZipText } from '@/lib/document-editor/oakdoc-zip';

describe('replaceOakDocFont', () => {
  it('switches Aptos defaults and runs to Arial, leaving other fonts alone', () => {
    const files = unzipSync(buildBlankOakDocBytes());
    const styles = strFromU8(files['word/styles.xml']).replace(/Arial/g, 'Aptos');
    files['word/styles.xml'] = encodeOakDocZipText(styles);
    files['word/document.xml'] = encodeOakDocZipText(strFromU8(files['word/document.xml']).replace(
      '<w:body>',
      '<w:body><w:p><w:r><w:rPr><w:rFonts w:ascii="Aptos" w:hAnsi="Georgia"/></w:rPr><w:t>Aptos text</w:t></w:r></w:p>',
    ));
    const result = replaceOakDocFont(zipSync(files), 'Aptos', 'Arial');
    const out = unzipSync(result.bytes);
    const document = strFromU8(out['word/document.xml']);
    expect(strFromU8(out['word/styles.xml'])).not.toContain('Aptos');
    expect(document).toContain('<w:rFonts w:ascii="Arial" w:hAnsi="Georgia"/>');
    // Text that merely says the font name is not a font setting.
    expect(document).toContain('<w:t>Aptos text</w:t>');
    expect(result.replaced).toBeGreaterThan(1);
    expect(() => inspectOakDocPackage(result.bytes, 'master')).not.toThrow();
  });

  it('returns the same bytes when the font is not used', () => {
    const bytes = buildBlankOakDocBytes();
    const result = replaceOakDocFont(bytes, 'Aptos', 'Arial');
    expect(result.replaced).toBe(0);
    expect(result.bytes).toBe(bytes);
  });
});
