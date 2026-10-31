// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { PDFDocument, rgb } from 'pdf-lib';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as fontkit from '@pdf-lib/fontkit';
import { extractEmbeddedFontPrograms, extractPdfPageTexts } from '../helpers/pdf-text';

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

import { createEsigningPdfTextFonts } from '@/services/esigning-pdf-fonts';

const NAMES = {
  latin: 'John Tan',
  cjk: 'Tan Wei Ming 陈伟明',
  vietnamese: 'Nguyễn Văn A',
  rupee: 'Fee: ₹1,50,000 (INR)',
} as const;

async function renderLines(lines: string[], options: { maxWidth?: number } = {}) {
  const pdf = await PDFDocument.create();
  const fonts = await createEsigningPdfTextFonts(pdf);
  const page = pdf.addPage([400, 400]);
  lines.forEach((line, index) => {
    fonts.drawText(page, line, {
      x: 10,
      y: 380 - index * 40,
      size: 12,
      color: rgb(0, 0, 0),
      maxWidth: options.maxWidth,
    });
  });
  const bytes = await pdf.save();
  return { bytes, pdf, fonts };
}

describe('embedded Unicode fonts for signed PDFs', () => {
  it.each(Object.entries(NAMES))('draws %s text and it extracts back unchanged', async (_label, text) => {
    const { bytes } = await renderLines([text]);

    const reloaded = await PDFDocument.load(bytes);
    expect(reloaded.getPageCount()).toBe(1);
    const [pageText] = await extractPdfPageTexts(bytes);
    expect(pageText).toBe(text);
  });

  it('draws mixed Latin, Vietnamese, CJK and rupee text in one line', async () => {
    const text = 'Nguyễn Văn A / 陈伟明 pays ₹100';
    const { bytes } = await renderLines([text]);
    expect((await extractPdfPageTexts(bytes))[0]).toBe(text);
  });

  it('subsets the fonts: a PDF with CJK text stays small', async () => {
    const { bytes } = await renderLines([NAMES.cjk, NAMES.vietnamese, NAMES.rupee]);
    // The CJK font file is ~7 MB; only the glyphs that were drawn may be embedded.
    expect(bytes.byteLength).toBeLessThan(150 * 1024);
  });

  it('normalises decomposed Vietnamese so it draws as the same text', async () => {
    const decomposed = 'Nguye\u0302\u0303n Va\u0306n A';
    const { bytes } = await renderLines([decomposed]);
    expect((await extractPdfPageTexts(bytes))[0]).toBe('Nguyễn Văn A');
  });

  it('wraps long Latin and CJK text inside maxWidth', async () => {
    const pdf = await PDFDocument.create();
    const fonts = await createEsigningPdfTextFonts(pdf);
    const latin = fonts.wrapText('Tan Wei Ming and a considerably longer company name pte ltd', 12, 120);
    expect(latin.length).toBeGreaterThan(1);
    for (const line of latin) expect(fonts.widthOfText(line, 12)).toBeLessThanOrEqual(120);
    expect(latin.join(' ')).toBe('Tan Wei Ming and a considerably longer company name pte ltd');

    const cjk = fonts.wrapText('陈伟明陈伟明陈伟明陈伟明陈伟明陈伟明陈伟明陈伟明', 12, 60);
    expect(cjk.length).toBeGreaterThan(1);
    for (const line of cjk) expect(fonts.widthOfText(line, 12)).toBeLessThanOrEqual(60);
    expect(cjk.join('')).toBe('陈伟明陈伟明陈伟明陈伟明陈伟明陈伟明陈伟明陈伟明');

    const unbroken = fonts.wrapText('Supercalifragilisticexpialidocious', 12, 60);
    expect(unbroken.length).toBeGreaterThan(1);
    expect(unbroken.join('')).toBe('Supercalifragilisticexpialidocious');
  });

  it('keeps explicit line breaks', async () => {
    const { bytes } = await renderLines(['Line one\nLine 二']);
    const [text] = await extractPdfPageTexts(bytes);
    expect(text).toContain('Line one');
    expect(text).toContain('Line 二');
  });

  it('draws a character no bundled font has as "?" instead of failing', async () => {
    const { bytes } = await renderLines(['Smile 😀 done']);
    expect((await extractPdfPageTexts(bytes))[0]).toBe('Smile ? done');
  });

  it('embeds glyph outlines a viewer can draw, not just a ToUnicode map', async () => {
    const text = 'TanWeiMingNguyễnVănA₹陈伟明';
    const { bytes } = await renderLines([text, text.replace('陈伟明', '李')]);
    const programs = await extractEmbeddedFontPrograms(bytes);
    expect(programs).toHaveLength(2);

    let drawableGlyphs = 0;
    for (const program of programs) {
      const font = fontkit.create(program);
      // Glyph 0 is .notdef. Every other glyph in the subset is one that was drawn, so it needs an outline.
      for (let glyphId = 1; glyphId < font.numGlyphs; glyphId += 1) {
        const { commands } = font.getGlyph(glyphId).path as unknown as { commands: unknown[] };
        expect(commands.length, `glyph ${glyphId} has no outline`).toBeGreaterThan(0);
        drawableGlyphs += 1;
      }
    }
    // 'Tan Wei Ming' etc. share letters; CJK adds 4 distinct ideographs (陈伟明李).
    expect(drawableGlyphs).toBeGreaterThanOrEqual(20);
  });

  it.each(['NotoSans-Regular-Subset.ttf', 'NotoSansSC-Regular-Subset.ttf'])(
    '%s keeps 2-byte aligned glyph data so fontkit can subset it',
    (fileName) => {
      // fontkit writes a short `loca` table when it can; odd glyph lengths then shift every glyph after
      // the first and the subset draws .notdef boxes or nothing. See assets/fonts/esigning/README.md.
      const font = fontkit.create(readFileSync(path.join(process.cwd(), 'assets', 'fonts', 'esigning', fileName)));
      const offsets = (font as unknown as { loca: { offsets: number[] } }).loca.offsets;
      const misaligned = offsets.slice(1).filter((offset, index) => (offset - offsets[index]) % 2 !== 0);
      expect(misaligned.length).toBe(0);
    }
  );
});
