import { strFromU8, unzipSync, zipSync } from 'fflate';
import { encodeOakDocZipText } from '@/lib/document-editor/oakdoc-zip';

// Parts whose w:rFonts decide what text renders in.
const FONT_PARTS = /^word\/(document|styles|numbering|header\d*|footer\d*)\.xml$/;
const RUN_FONTS = /<w:rFonts\b[^>]*>/g;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Replace a font named in `w:rFonts` (document defaults, styles, lists and
 * runs) with another, leaving every other byte of those parts alone.
 * Returns the original bytes when nothing names the font.
 */
export function replaceOakDocFont(
  bytes: Uint8Array,
  from: string,
  to: string,
): { bytes: Uint8Array; replaced: number } {
  const files = unzipSync(bytes);
  const attribute = new RegExp(`(w:(?:ascii|hAnsi|eastAsia|cs)=")${escapeRegExp(from)}(")`, 'g');
  let replaced = 0;
  for (const [name, data] of Object.entries(files)) {
    if (!FONT_PARTS.test(name)) continue;
    const xml = strFromU8(data);
    let count = 0;
    const next = xml.replace(RUN_FONTS, (tag) => tag.replace(attribute, (_match, open: string, close: string) => {
      count += 1;
      return `${open}${to}${close}`;
    }));
    if (count > 0) {
      files[name] = encodeOakDocZipText(next);
      replaced += count;
    }
  }
  return { bytes: replaced > 0 ? zipSync(files) : bytes, replaced };
}
