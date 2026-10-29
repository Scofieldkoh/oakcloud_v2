/**
 * How an OakDoc field prints, chosen when the field is added in the
 * editor: its text case and, for a date, its date format. Both are kept in
 * the field's Word title (`w:alias`), e.g. "Full Address · UPPERCASE" or
 * "Resolution Date · dd/MM/yyyy", so they travel with that one field (into
 * partials, repeating sections and copies) and show on hover. Generation
 * prints the value that way; with neither the value prints as stored.
 */

export type OakDocFieldCase = 'upper' | 'title';

const CASE_SUFFIX: Record<OakDocFieldCase, string> = {
  upper: 'UPPERCASE',
  title: 'Title Case',
};

const SEPARATOR = ' · ';

export const OAKDOC_FIELD_CASE_OPTIONS: ReadonlyArray<{ value: '' | OakDocFieldCase; label: string }> = [
  { value: '', label: 'As stored' },
  { value: 'upper', label: CASE_SUFFIX.upper },
  { value: 'title', label: CASE_SUFFIX.title },
];

/** Common date formats offered in the field panel, as Word date patterns. */
export const OAKDOC_DATE_FORMAT_OPTIONS: readonly string[] = [
  'dd/MM/yyyy',
  'd/M/yyyy',
  'dd MMM yyyy',
  'd MMM yyyy',
  'd MMMM yyyy',
  'dd MMMM yyyy',
  'MMMM d, yyyy',
  'do MMMM yyyy',
  'yyyy-MM-dd',
];

export function isOakDocFieldCase(value: unknown): value is OakDocFieldCase {
  return value === 'upper' || value === 'title';
}

const DATE_TOKEN = /yyyy|yy|MMMM|MMM|MM|M|do|dd|d/g;
const DATE_SEPARATORS = /^[\s/.,-]*$/;

/**
 * A date format as Word writes it ("dd/MM/yyyy"), from what a person typed:
 * "dd/mm/yyyy", "D MMM YYYY"... Months are M (there is no time of day), days
 * d (do for "3rd"), years yy or yyyy, between spaces, slashes, dots, commas
 * or dashes.
 * Null when it is not a date format.
 */
export function normalizeOakDocDateFormat(input: string): string | null {
  const pattern = input.trim().replace(/\s+/g, ' ')
    .replace(/m/g, 'M').replace(/D/g, 'd').replace(/Y/g, 'y');
  if (!pattern) return null;
  const tokens = pattern.match(DATE_TOKEN) ?? [];
  if (!tokens.some((token) => token.startsWith('d')) && !tokens.some((token) => token.startsWith('M'))) return null;
  if (!DATE_SEPARATORS.test(pattern.replace(DATE_TOKEN, ''))) return null;
  // "yyy" or "ddd" would read as two tokens; refuse them rather than guess.
  if (/y{5,}|(?<!y)y{3}(?!y)|d{3,}|M{5,}/.test(pattern)) return null;
  return pattern;
}

/** The Word title for a field: its label, then the case and date format when set. */
export function oakDocFieldTitle(
  label: string,
  textCase?: OakDocFieldCase | null,
  dateFormat?: string | null,
): string {
  return [label, textCase ? CASE_SUFFIX[textCase] : null, dateFormat || null]
    .filter(Boolean)
    .join(SEPARATOR);
}

function titleParts(title: string | null | undefined): string[] {
  return (title ?? '').trim().split(SEPARATOR).slice(1);
}

/** The case a field's Word title asks for, if any. */
export function oakDocFieldCaseOfTitle(title: string | null | undefined): OakDocFieldCase | null {
  const parts = titleParts(title);
  for (const textCase of ['upper', 'title'] as const) {
    if (parts.includes(CASE_SUFFIX[textCase])) return textCase;
  }
  return null;
}

/** The date format a field's Word title asks for, if any. */
export function oakDocFieldDateFormatOfTitle(title: string | null | undefined): string | null {
  for (const part of titleParts(title)) {
    if (part === CASE_SUFFIX.upper || part === CASE_SUFFIX.title) continue;
    const pattern = normalizeOakDocDateFormat(part);
    if (pattern === part) return pattern;
  }
  return null;
}

/** "TAN WEI JIE" -> "Tan Wei Jie": each word's first letter up, the rest down. */
function titleCase(value: string): string {
  return value
    .toLocaleLowerCase('en-SG')
    .replace(/(^|[\s(/"-])(\p{L})/gu, (_, before: string, letter: string) => `${before}${letter.toLocaleUpperCase('en-SG')}`);
}

/** A value printed in the field's case. */
export function applyOakDocFieldCase(value: string, textCase: OakDocFieldCase | null): string {
  if (textCase === 'upper') return value.toLocaleUpperCase('en-SG');
  if (textCase === 'title') return titleCase(value);
  return value;
}
