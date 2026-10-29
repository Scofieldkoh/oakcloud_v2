/**
 * Field blocks: in the authoring editors an OakDoc field behaves as one unit.
 * Its `{{tag}}` text cannot be typed into, a click selects the whole field,
 * and Delete/Backspace next to or inside it removes the whole field.
 *
 * The editor reports the caret as a paragraph offset, and the laid-out page
 * marks each text run with its offsets, so field ranges are found by locating
 * `{{tag}}` tokens in the paragraph's text.
 */

/** Drag data type carrying an `OakDocFieldDefinition` from the field list. */
export const OAKDOC_FIELD_DRAG_TYPE = 'application/x-oakdoc-field';

export interface OakDocTextRun {
  start: number;
  end: number;
  text: string;
}

export interface OakDocFieldRange {
  start: number;
  end: number;
}

export type OakDocFieldBlockAction =
  | { kind: 'block' }
  | { kind: 'remove'; range: OakDocFieldRange };

const FIELD_TOKEN = /\{\{[^{}\s]+\}\}/g;

/** Field token ranges in one paragraph, from its laid-out runs in any order. */
export function oakDocFieldRanges(runs: readonly OakDocTextRun[]): OakDocFieldRange[] {
  // A paragraph split across pages paints some runs twice; keep one per start.
  const byStart = new Map<number, OakDocTextRun>();
  for (const run of runs) {
    if (Number.isFinite(run.start) && Number.isFinite(run.end) && !byStart.has(run.start)) {
      byStart.set(run.start, run);
    }
  }
  const ordered = [...byStart.values()].sort((a, b) => a.start - b.start);
  const ranges: OakDocFieldRange[] = [];
  let text = '';
  let base = ordered[0]?.start ?? 0;

  const collect = () => {
    for (const match of text.matchAll(FIELD_TOKEN)) {
      const start = base + (match.index ?? 0);
      ranges.push({ start, end: start + match[0].length });
    }
  };

  for (const run of ordered) {
    // Runs that do not join (an image or tab between them) start a new span.
    if (run.start !== base + text.length) {
      collect();
      text = '';
      base = run.start;
    }
    text += run.text;
  }
  collect();
  return ranges;
}

/** The field the caret sits strictly inside, if any. */
export function oakDocFieldInside(
  ranges: readonly OakDocFieldRange[],
  offset: number,
): OakDocFieldRange | null {
  return ranges.find((range) => range.start < offset && offset < range.end) ?? null;
}

/**
 * What a key press at a collapsed caret should do to a field, or null to let
 * the editor handle it. Text typed at a field's edge is allowed; saving moves
 * it out of the field.
 */
export function oakDocFieldBlockAction(input: {
  key: string;
  modifier: boolean;
  offset: number;
  ranges: readonly OakDocFieldRange[];
}): OakDocFieldBlockAction | null {
  const { key, modifier, offset, ranges } = input;
  const inside = oakDocFieldInside(ranges, offset);

  if (key === 'Backspace') {
    const range = inside ?? ranges.find((candidate) => candidate.end === offset);
    return range ? { kind: 'remove', range } : null;
  }
  if (key === 'Delete') {
    const range = inside ?? ranges.find((candidate) => candidate.start === offset);
    return range ? { kind: 'remove', range } : null;
  }
  if (!inside || modifier) return null;
  if (key.length === 1 || key === 'Enter' || key === 'Tab') return { kind: 'block' };
  return null;
}
