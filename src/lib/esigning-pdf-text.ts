/**
 * Text that can be printed on a signed e-signing PDF.
 *
 * Signed PDFs draw field text with the bundled Noto Sans (Latin, Vietnamese, Greek, Cyrillic,
 * currency and general punctuation) and Noto Sans SC (CJK ideographs, kana and CJK punctuation)
 * subsets in `assets/fonts/esigning`. This module is isomorphic (no fonts or Node APIs) so the same
 * rule runs in the Zod schemas, the signing page and the PDF service.
 *
 * `ESIGNING_PDF_SUPPORTED_RANGES` is the union of the two fonts' character maps, minus control and
 * format characters. `__tests__/services/esigning-pdf-text.test.ts` compares it with the real font
 * files, so regenerate it (see `assets/fonts/esigning/README.md`) whenever a font file changes.
 */

// Generated from the font cmaps. Inclusive [first, last] code point ranges, sorted.
export const ESIGNING_PDF_SUPPORTED_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0020, 0x007E],
  [0x00A1, 0x00AC],
  [0x00AE, 0x024F],
  [0x0300, 0x0377],
  [0x037A, 0x037F],
  [0x0384, 0x038A],
  [0x038C, 0x038C],
  [0x038E, 0x03A1],
  [0x03A3, 0x03E1],
  [0x03F0, 0x04FF],
  [0x1E00, 0x1EFF],
  [0x2000, 0x200A],
  [0x2010, 0x2027],
  [0x202F, 0x205F],
  [0x20A0, 0x20C0],
  [0x2100, 0x215F],
  [0x2183, 0x2184],
  [0x2189, 0x2189],
  [0x2212, 0x2212],
  [0x25CC, 0x25CC],
  [0x3000, 0x303F],
  [0x3041, 0x3096],
  [0x3099, 0x30FF],
  [0x4E00, 0x9FEF],
  [0xFF01, 0xFF9F],
  [0xFFA1, 0xFFBE],
  [0xFFC2, 0xFFC7],
  [0xFFCA, 0xFFCF],
  [0xFFD2, 0xFFD7],
  [0xFFDA, 0xFFDC],
  [0xFFE0, 0xFFE6],
  [0xFFE8, 0xFFEE],
];

export const UNSUPPORTED_PDF_CHARACTERS_ISSUE_CODE = 'UNSUPPORTED_PDF_CHARACTERS';

// Invisible characters that often arrive through copy and paste (soft hyphen, zero-width and
// bidi marks, BOM). They carry no printable meaning, so they are dropped instead of rejected.
const INVISIBLE_FORMAT_CHARACTERS = /[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;
const MAX_REPORTED_CHARACTERS = 5;

export function isEsigningPdfCodePointSupported(codePoint: number): boolean {
  let low = 0;
  let high = ESIGNING_PDF_SUPPORTED_RANGES.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const [first, last] = ESIGNING_PDF_SUPPORTED_RANGES[mid];
    if (codePoint < first) {
      high = mid - 1;
    } else if (codePoint > last) {
      low = mid + 1;
    } else {
      return true;
    }
  }
  return false;
}

/**
 * Canonical form of user text before it is validated, stored and drawn: NFC (so decomposed
 * Vietnamese such as "e" + U+0302 + U+0303 becomes one glyph), LF line breaks, no tabs, no
 * no-break spaces and no invisible format characters.
 */
export function normalizeEsigningPdfText(text: string): string {
  return text
    .normalize('NFC')
    .replace(INVISIBLE_FORMAT_CHARACTERS, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\u00A0]/g, ' ');
}

/** Distinct characters, in order of appearance, that the signed-PDF fonts cannot draw. */
export function findUnsupportedEsigningPdfCharacters(text: string): string[] {
  const unsupported: string[] = [];
  for (const char of normalizeEsigningPdfText(text)) {
    if (char === '\n') continue;
    if (!isEsigningPdfCodePointSupported(char.codePointAt(0) as number) && !unsupported.includes(char)) {
      unsupported.push(char);
    }
  }
  return unsupported;
}

function describeCharacter(char: string): string {
  const codePoint = char.codePointAt(0) as number;
  const hex = `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
  // Control and unassigned characters cannot be shown, so name them by code point only.
  return /[\p{C}\p{Z}]/u.test(char) ? hex : `"${char}" (${hex})`;
}

export function formatUnsupportedEsigningPdfCharactersMessage(
  unsupported: readonly string[],
  subject = 'This text'
): string {
  const shown = unsupported.slice(0, MAX_REPORTED_CHARACTERS).map(describeCharacter).join(', ');
  const more =
    unsupported.length > MAX_REPORTED_CHARACTERS
      ? ` and ${unsupported.length - MAX_REPORTED_CHARACTERS} more`
      : '';
  return (
    `${subject} contains ${unsupported.length === 1 ? 'a character' : 'characters'} that cannot be printed ` +
    `on the signed document: ${shown}${more}. Use Latin (including Vietnamese), Greek, Cyrillic, ` +
    'Chinese or Japanese kana characters, numbers and common punctuation instead.'
  );
}

/** Returns a user-facing error message, or null when every character can be drawn. */
export function getUnsupportedEsigningPdfTextMessage(text: string, subject?: string): string | null {
  const unsupported = findUnsupportedEsigningPdfCharacters(text);
  return unsupported.length > 0 ? formatUnsupportedEsigningPdfCharactersMessage(unsupported, subject) : null;
}
