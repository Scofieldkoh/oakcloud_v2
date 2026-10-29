import { OAKDOC_FIELD_TAGS } from '@/lib/document-editor/oakdoc-field-registry';
import { inspectOakDocFields } from '@/lib/document-editor/oakdoc-fields';
import { inspectOakDocRepeaters } from '@/lib/document-editor/oakdoc-repeaters';
import { oakDocPickerKeysInUse } from '@/lib/document-editor/oakdoc-custom-fields';

/**
 * The repeater tags and picker keys a document can carry a name for: its
 * repeating sections and the pickers its fields use. Names of anything
 * else are dropped on save (writeOakDocRepeaterSections).
 */
export function oakDocNamedKeysIn(bytes: Uint8Array): string[] {
  return [
    ...inspectOakDocRepeaters(bytes).tags,
    ...oakDocPickerKeysInUse(inspectOakDocFields(bytes, OAKDOC_FIELD_TAGS).tags),
  ];
}
