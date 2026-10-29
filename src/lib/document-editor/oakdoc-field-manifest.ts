import { ensureA4ServerDomGlobals } from '@/lib/document-editor/a4-server-dom';
import { inspectOakDocFields } from '@/lib/document-editor/oakdoc-fields';
import { inspectOakDocConditions } from '@/lib/document-editor/oakdoc-conditions';
import {
  classifyOakDocTag,
  OAKDOC_CONDITION_FIELD_TAGS,
} from '@/lib/document-editor/oakdoc-field-registry';

/**
 * The field manifest is derived from the stored bytes, never from the
 * caller: every registered field, repeater and signature control in the
 * document plus the fields its conditions test. Unknown tags stay in the
 * document (they are reported at generation) but are not trusted here.
 */
export function deriveOakDocTemplateFieldTags(bytes: Uint8Array): string[] {
  ensureA4ServerDomGlobals();
  const controls = inspectOakDocFields(bytes).tags
    .filter((tag) => {
      const kind = classifyOakDocTag(tag);
      return kind !== 'unknown'
        && kind !== 'condition'
        && kind !== 'agreement-slot'
        && kind !== 'resolution-slot'
        && kind !== 'partial';
    });
  const conditionFields = inspectOakDocConditions(bytes).fieldTags
    .filter((tag) => OAKDOC_CONDITION_FIELD_TAGS.has(tag));
  return Array.from(new Set([...controls, ...conditionFields])).sort();
}
