import { zipSync } from 'fflate';

import { encodeOakDocZipText } from '@/lib/document-editor/oakdoc-zip';

/**
 * Build small synthetic DOCX/OOXML ZIP packages for jsdom tests.
 *
 * The shared OakDoc ZIP encoder ensures each UTF-8 XML payload is allocated
 * in the same Uint8Array realm that fflate.zipSync() expects.
 */
export function createDocxFixture(
  parts: Readonly<Record<string, string>>,
): Uint8Array {
  const entries: Record<string, Uint8Array> = {};

  for (const [path, xml] of Object.entries(parts)) {
    entries[path] = encodeOakDocZipText(xml);
  }

  return zipSync(entries);
}
