import {
  appendOakDocPartialCustomFields,
  mergeOakDocRepeaterSectionSummaries,
  oakDocContactShortlist,
  oakDocRepeaterSectionSummary,
  type OakDocCustomFieldContact,
  type OakDocRepeaterSectionSummary,
} from '@/lib/document-editor/oakdoc-custom-fields';
import { resolutionPartialIds, type ResolutionComposition } from '@/lib/resolution-composition';
import { normalizeStoredPlaceholders, storageFormatToCustomPlaceholders } from '@/lib/template-analysis';
import type { CustomPlaceholderDefinition } from '@/types/placeholders';

/**
 * A resolution document's field tags: its template's, then those of the
 * partials chosen for its numbered resolutions, so a repeater inside a
 * chosen partial (officers, directors) gets its Configure picker.
 */
export function resolutionItemFieldTags(
  templateTags: readonly string[] | undefined,
  resolution: ResolutionComposition | null | undefined,
  partials: ReadonlyArray<{ id: string; fieldTags?: readonly string[] }>,
): readonly string[] | undefined {
  const ids = new Set(resolutionPartialIds(resolution));
  if (ids.size === 0) return templateTags;
  const tags = partials.filter((partial) => ids.has(partial.id)).flatMap((partial) => partial.fieldTags ?? []);
  return tags.length === 0 ? templateTags : Array.from(new Set([...(templateTags ?? []), ...tags]));
}

/**
 * A resolution document's fields: its template's, then the custom fields of
 * the partials chosen for its numbered resolutions. Generation adds the same
 * fields (withResolutionPartialFields), so Configure asks for what prints.
 */
export function resolutionItemFields(
  templateFields: CustomPlaceholderDefinition[],
  resolution: ResolutionComposition | null | undefined,
  partials: ReadonlyArray<{ id: string; placeholders: unknown }>,
): CustomPlaceholderDefinition[] {
  const ids = resolutionPartialIds(resolution);
  if (ids.length === 0) return templateFields;
  const byId = new Map(partials.map((partial) => [partial.id, partial]));
  const chosen = ids.flatMap((id) => byId.get(id) ?? []);
  const partialFields = storageFormatToCustomPlaceholders(
    normalizeStoredPlaceholders(appendOakDocPartialCustomFields([], chosen)),
  );
  const taken = new Set(templateFields.map((field) => field.key));
  const added = partialFields.filter((field) => !taken.has(field.key));
  return added.length === 0 ? templateFields : [...templateFields, ...added];
}

/**
 * A resolution document's contacts shortlist: its template's, then those of
 * the partials chosen for its numbered resolutions, together. Null when none
 * sets one (any contact). Generation reads the same placeholders.
 */
export function resolutionItemContactShortlist(
  templateShortlist: readonly OakDocCustomFieldContact[] | null | undefined,
  resolution: ResolutionComposition | null | undefined,
  partials: ReadonlyArray<{ id: string; placeholders: unknown }>,
): OakDocCustomFieldContact[] | null {
  const ids = resolutionPartialIds(resolution);
  const base = templateShortlist ? [...templateShortlist] : [];
  if (ids.length === 0) return base.length > 0 ? base : null;
  const byId = new Map(partials.map((partial) => [partial.id, partial]));
  const chosen = ids.flatMap((id) => byId.get(id) ?? []);
  const fromPartials = oakDocContactShortlist(appendOakDocPartialCustomFields([], chosen)) ?? [];
  const seen = new Set(base.map((contact) => contact.id));
  const merged = [...base, ...fromPartials.filter((contact) => !seen.has(contact.id))];
  return merged.length > 0 ? merged : null;
}

/**
 * A resolution document's section names and contacts lists: its template's,
 * then those of the partials chosen for its numbered resolutions.
 */
export function resolutionItemRepeaterSections(
  templateSections: OakDocRepeaterSectionSummary | null | undefined,
  resolution: ResolutionComposition | null | undefined,
  partials: ReadonlyArray<{ id: string; placeholders: unknown }>,
): OakDocRepeaterSectionSummary {
  const ids = resolutionPartialIds(resolution);
  if (ids.length === 0) return mergeOakDocRepeaterSectionSummaries(templateSections, null);
  const byId = new Map(partials.map((partial) => [partial.id, partial]));
  const chosen = ids.flatMap((id) => byId.get(id) ?? []);
  return mergeOakDocRepeaterSectionSummaries(
    templateSections,
    oakDocRepeaterSectionSummary(appendOakDocPartialCustomFields([], chosen)),
  );
}
