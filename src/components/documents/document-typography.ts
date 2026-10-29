export const DOCUMENT_FONT_OPTIONS = [
  { value: 'Arial, Helvetica, sans-serif', label: 'Arial' },
  { value: "'Times New Roman', Times, serif", label: 'Times New Roman' },
  { value: "'Courier New', Courier, monospace", label: 'Courier New' },
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: 'Verdana, Geneva, sans-serif', label: 'Verdana' },
  { value: "'Trebuchet MS', sans-serif", label: 'Trebuchet MS' },
  { value: "'Lucida Console', Monaco, monospace", label: 'Lucida Console' },
] as const;

export const DOCUMENT_FONT_SIZE_OPTIONS = [
  '8pt', '9pt', '10pt', '11pt', '12pt', '14pt',
  '16pt', '18pt', '20pt', '24pt', '28pt', '36pt',
] as const;

export const DEFAULT_DOCUMENT_FONT_FAMILY = DOCUMENT_FONT_OPTIONS[0].value;
export const DEFAULT_DOCUMENT_FONT_SIZE = '11pt';

const FONT_SIZE_UNITS_TO_POINTS: Record<string, number> = {
  pt: 1,
  px: 72 / 96,
  pc: 12,
  in: 72,
  cm: 72 / 2.54,
  mm: 72 / 25.4,
  q: 72 / 101.6,
  em: 12,
  rem: 12,
  '%': 0.12,
};

/**
 * Maps a CSS font-size value to the nearest supported document size.
 * Absolute units convert exactly; em/rem/percent values use the browser
 * default 16px base, which is the practical fallback when computed styles are
 * unavailable. Already-supported sizes pass through unchanged.
 */
export function normalizeDocumentFontSize(
  value: string,
  fallback: string = DEFAULT_DOCUMENT_FONT_SIZE,
): string {
  const trimmed = value.trim().toLowerCase();
  if ((DOCUMENT_FONT_SIZE_OPTIONS as readonly string[]).includes(trimmed)) {
    return trimmed;
  }

  const match =
    /^([+-]?(?:\d+\.?\d*|\.\d+))(pt|px|pc|in|cm|mm|q|em|rem|%)$/.exec(trimmed);
  if (!match) return fallback;

  const factor = FONT_SIZE_UNITS_TO_POINTS[match[2]];
  const points = Number(match[1]) * (factor ?? 1);
  if (!Number.isFinite(points) || points <= 0) return fallback;

  let closest = fallback;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const option of DOCUMENT_FONT_SIZE_OPTIONS) {
    const distance = Math.abs(Number.parseFloat(option) - points);
    if (distance < closestDistance) {
      closest = option;
      closestDistance = distance;
    }
  }
  return closest;
}
