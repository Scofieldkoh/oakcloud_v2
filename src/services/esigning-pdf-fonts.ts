import { readFileSync } from 'node:fs';
import path from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { type PDFDocument, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';
import { createLogger } from '@/lib/logger';
import { normalizeEsigningPdfText } from '@/lib/esigning-pdf-text';

const log = createLogger('esigning-pdf-fonts');

/**
 * Bundled Unicode fonts for signed e-signing PDFs (SIL OFL 1.1, subsets of Noto Sans and Noto Sans SC).
 * See `assets/fonts/esigning/README.md` for what they cover and how they were produced.
 *
 * The path is resolved from the process working directory (the repo root for `next start`, the
 * Docker image's /app and Vitest). `next.config.js` also lists the folder in
 * `outputFileTracingIncludes` so a standalone build carries it.
 */
const FONT_DIRECTORY = path.join(process.cwd(), 'assets', 'fonts', 'esigning');
const LATIN_FONT_FILE = 'NotoSans-Regular-Subset.ttf';
const CJK_FONT_FILE = 'NotoSansSC-Regular-Subset.ttf';
const FALLBACK_CHARACTER = '?';
const LINE_HEIGHT_FACTOR = 1.2;

interface LoadedFontFile {
  bytes: Uint8Array;
  codePoints: ReadonlySet<number>;
}

let loadedFonts: { latin: LoadedFontFile; cjk: LoadedFontFile } | null = null;
const standardFontCodePoints = new WeakMap<PDFFont, ReadonlySet<number>>();

function loadFontFile(fileName: string): LoadedFontFile {
  // Copy into a plain Uint8Array: pdf-lib checks `instanceof Uint8Array`, which a Node Buffer fails when
  // the global is a different realm's (jsdom test environments).
  const bytes = new Uint8Array(readFileSync(path.join(FONT_DIRECTORY, fileName)));
  // fontkit.create reads the character map only; the subset is cut from the bytes by pdf-lib at save time.
  const codePoints = new Set(fontkit.create(bytes).characterSet);
  return { bytes, codePoints };
}

function getFontFiles(): { latin: LoadedFontFile; cjk: LoadedFontFile } {
  // Read once per process: the CJK file is about 7 MB and its character map is walked a single time.
  loadedFonts ??= { latin: loadFontFile(LATIN_FONT_FILE), cjk: loadFontFile(CJK_FONT_FILE) };
  return loadedFonts;
}

function getPreferredFontCodePoints(font: PDFFont): ReadonlySet<number> {
  let codePoints = standardFontCodePoints.get(font);
  if (!codePoints) {
    codePoints = new Set(font.getCharacterSet());
    standardFontCodePoints.set(font, codePoints);
  }
  return codePoints;
}

export interface PdfTextRun {
  text: string;
  font: PDFFont;
}

export interface DrawPdfTextOptions {
  x: number;
  y: number;
  size: number;
  color: RGB;
  /** Wrap onto further lines (below `y`) so no line is wider than this. */
  maxWidth?: number;
  lineHeight?: number;
}

export interface EsigningPdfTextFonts {
  /** Splits text into runs, each drawn with a font that has all of its glyphs. */
  resolveRuns(text: string, preferredFont?: PDFFont): PdfTextRun[];
  widthOfText(text: string, size: number, preferredFont?: PDFFont): number;
  wrapText(text: string, size: number, maxWidth: number, preferredFont?: PDFFont): string[];
  /** Draws one line (no wrapping) starting at `x` and returns its width. */
  drawLine(page: PDFPage, text: string, options: Omit<DrawPdfTextOptions, 'maxWidth' | 'lineHeight'>, preferredFont?: PDFFont): number;
  /** Draws text that may contain line breaks and, with `maxWidth`, wraps it. Returns the line count. */
  drawText(page: PDFPage, text: string, options: DrawPdfTextOptions, preferredFont?: PDFFont): number;
}

/**
 * Embeds subsets of the bundled Unicode fonts in `pdf` and returns helpers that mix them per character:
 * Noto Sans for Latin, Vietnamese, Greek, Cyrillic and currency symbols (including the rupee sign),
 * Noto Sans SC for CJK ideographs, kana and CJK punctuation. Only the glyphs actually drawn are
 * written to the file.
 *
 * Text is normalised (NFC, LF) first. A character neither font can draw is drawn as "?" and logged;
 * input validation rejects those characters long before a PDF is built, so this only protects values
 * that were stored before that validation existed.
 *
 * `preferredFont` (for example Helvetica in the certificate) is used for every character it can
 * encode, so existing Latin output is unchanged and only other characters switch to the Unicode fonts.
 */
export async function createEsigningPdfTextFonts(pdf: PDFDocument): Promise<EsigningPdfTextFonts> {
  pdf.registerFontkit(fontkit);
  const files = getFontFiles();
  const latinFont = await pdf.embedFont(files.latin.bytes, { subset: true });
  const cjkFont = await pdf.embedFont(files.cjk.bytes, { subset: true });

  const pickFont = (codePoint: number, preferredFont?: PDFFont): PDFFont | null => {
    if (preferredFont && getPreferredFontCodePoints(preferredFont).has(codePoint)) return preferredFont;
    if (files.latin.codePoints.has(codePoint)) return latinFont;
    if (files.cjk.codePoints.has(codePoint)) return cjkFont;
    return null;
  };

  const resolveRuns = (text: string, preferredFont?: PDFFont): PdfTextRun[] => {
    const runs: PdfTextRun[] = [];
    const unsupported = new Set<string>();
    for (const char of normalizeEsigningPdfText(text)) {
      const codePoint = char.codePointAt(0) as number;
      let font = pickFont(codePoint, preferredFont);
      let value = char;
      if (!font) {
        unsupported.add(char);
        value = FALLBACK_CHARACTER;
        font = pickFont(FALLBACK_CHARACTER.codePointAt(0) as number, preferredFont) as PDFFont;
      }
      const last = runs[runs.length - 1];
      if (last && last.font === font) {
        last.text += value;
      } else {
        runs.push({ text: value, font });
      }
    }
    if (unsupported.size > 0) {
      log.warn('Drew characters the bundled PDF fonts cannot render as "?"', {
        codePoints: [...unsupported].map((char) => `U+${(char.codePointAt(0) as number).toString(16).toUpperCase().padStart(4, '0')}`),
      });
    }
    return runs;
  };

  const widthOfText = (text: string, size: number, preferredFont?: PDFFont): number =>
    resolveRuns(text, preferredFont).reduce((sum, run) => sum + run.font.widthOfTextAtSize(run.text, size), 0);

  const drawLine: EsigningPdfTextFonts['drawLine'] = (page, text, options, preferredFont) => {
    let cursorX = options.x;
    for (const run of resolveRuns(text, preferredFont)) {
      page.drawText(run.text, { x: cursorX, y: options.y, size: options.size, font: run.font, color: options.color });
      cursorX += run.font.widthOfTextAtSize(run.text, options.size);
    }
    return cursorX - options.x;
  };

  const wrapParagraph = (paragraph: string, size: number, maxWidth: number, preferredFont?: PDFFont): string[] => {
    // Break opportunities: after a space, and around every CJK character (they carry no spaces).
    const tokens = paragraph.match(/ +|[\u2e80-\u9fff\uff00-\uffef]|[^ \u2e80-\u9fff\uff00-\uffef]+/gu) ?? [];
    const lines: string[] = [];
    let line = '';
    const fits = (candidate: string) => widthOfText(candidate, size, preferredFont) <= maxWidth;

    for (const token of tokens) {
      if (fits(line + token)) {
        line += token;
        continue;
      }
      if (line.trim()) lines.push(line.trimEnd());
      line = '';
      const trimmed = /^ +$/.test(token) ? '' : token;
      if (fits(trimmed)) {
        line = trimmed;
        continue;
      }
      // A single word wider than the box: split it by character.
      for (const char of trimmed) {
        if (line && !fits(line + char)) {
          lines.push(line);
          line = '';
        }
        line += char;
      }
    }
    if (line.trim() || lines.length === 0) lines.push(line.trimEnd());
    return lines;
  };

  const wrapText = (text: string, size: number, maxWidth: number, preferredFont?: PDFFont): string[] =>
    normalizeEsigningPdfText(text)
      .split('\n')
      .flatMap((paragraph) => wrapParagraph(paragraph, size, maxWidth, preferredFont));

  const drawText: EsigningPdfTextFonts['drawText'] = (page, text, options, preferredFont) => {
    const lines =
      options.maxWidth === undefined
        ? normalizeEsigningPdfText(text).split('\n')
        : wrapText(text, options.size, options.maxWidth, preferredFont);
    const lineHeight = options.lineHeight ?? options.size * LINE_HEIGHT_FACTOR;
    lines.forEach((line, index) => {
      if (line) {
        drawLine(page, line, { x: options.x, y: options.y - index * lineHeight, size: options.size, color: options.color }, preferredFont);
      }
    });
    return lines.length;
  };

  return { resolveRuns, widthOfText, wrapText, drawLine, drawText };
}
