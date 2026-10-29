import { resolutionWorkspaceSchema } from '@/lib/validations/document-generation-batch';

/**
 * The numbered resolutions a RESOLUTION document prints: Word partials or
 * custom text, numbered in list order. Pure data and validation, shared by
 * the Configure step and the OakDoc composer (oakdoc-resolutions.ts).
 */

export type ResolutionSection =
  | {
    id: string;
    kind: 'PARTIAL';
    heading: string;
    partialId: string;
    /** Text edited on Configure; when set it prints instead of the partial. */
    body?: string | null;
  }
  | { id: string; kind: 'CUSTOM'; heading: string; body: string };

export interface ResolutionComposition {
  /** Unnumbered heading above the resolutions; blank prints nothing. */
  subject: string;
  sections: ResolutionSection[];
}

/** Shown when a resolution template is previewed in the editor. */
export const SAMPLE_RESOLUTION_COMPOSITION: ResolutionComposition = {
  subject: 'SUBJECT OF THE RESOLUTIONS',
  sections: [
    {
      id: 'sample-1',
      kind: 'CUSTOM',
      heading: 'FIRST RESOLUTION',
      body: 'RESOLVED that the text of each resolution chosen on Configure appears here.',
    },
    {
      id: 'sample-2',
      kind: 'CUSTOM',
      heading: 'SECOND RESOLUTION',
      body: 'RESOLVED that resolutions are numbered in the order they are listed.',
    },
  ],
};

/** Custom text: a blank line starts a new paragraph, a single newline a line break. */
export function customResolutionParagraphs(body: string): string[][] {
  return body
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((block) => block.split('\n').map((line) => line.trimEnd()))
    .filter((lines) => lines.some((line) => line.trim().length > 0));
}

/** A RESOLUTION template's stored preset, or null when it has none or it is malformed. */
export function readResolutionPreset(raw: unknown): ResolutionComposition | null {
  if (raw == null) return null;
  const parsed = resolutionWorkspaceSchema.safeParse(raw);
  return parsed.success && parsed.data.sections.length + parsed.data.subject.trim().length > 0
    ? parsed.data as ResolutionComposition
    : null;
}

/** A fresh copy of a preset for one document, with new section ids. */
export function instantiateResolutionPreset(
  preset: ResolutionComposition,
  createId: () => string,
): ResolutionComposition {
  return {
    subject: preset.subject,
    sections: preset.sections.map((section) => ({ ...section, id: createId() })),
  };
}

/** True when a partial's text was edited on Configure and prints as plain text. */
export function isEditedPartial(section: ResolutionSection): boolean {
  return section.kind === 'PARTIAL' && typeof section.body === 'string';
}

/** The plain text a section prints, or null when it prints the saved partial. */
export function resolutionSectionText(section: ResolutionSection): string | null {
  if (section.kind === 'CUSTOM') return section.body;
  return typeof section.body === 'string' ? section.body : null;
}

/** Validation shared by generation and the Configure step. */
export function resolutionCompositionIssues(composition: ResolutionComposition | null | undefined): string[] {
  if (!composition || composition.sections.length === 0) return ['Add at least one resolution.'];
  const issues: string[] = [];
  composition.sections.forEach((section, index) => {
    const label = `Resolution ${index + 1}`;
    if (!section.heading.trim()) issues.push(`${label} needs a heading.`);
    const text = resolutionSectionText(section);
    if (text !== null && customResolutionParagraphs(text).length === 0) {
      issues.push(`${label} needs its text.`);
    }
  });
  return issues;
}

/** Partials whose saved wording prints, in order, without repeats. */
export function resolutionPartialIds(composition: ResolutionComposition | null | undefined): string[] {
  const ids = (composition?.sections ?? []).flatMap((section) =>
    section.kind === 'PARTIAL' && !isEditedPartial(section) ? [section.partialId] : []);
  return Array.from(new Set(ids));
}
