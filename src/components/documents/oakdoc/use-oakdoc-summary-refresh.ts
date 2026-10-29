import { useCallback, useEffect, useRef, type RefObject } from 'react';
import type { DocxEditorRef } from '@docx-editor.dev/react';

/** How long typing pauses before the summaries are read again. */
const REFRESH_DELAY_MS = 600;

/**
 * Re-reads the editor's document a moment after the author stops editing,
 * so lists built from it (fields and repeating sections in the document)
 * drop what was deleted by typing, cutting or undoing. Returns the
 * function to call on each editor change.
 */
export function useOakDocSummaryRefresh(
  editorRef: RefObject<DocxEditorRef | null>,
  onBytes: (bytes: Uint8Array) => void,
): () => void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onBytesRef = useRef(onBytes);
  onBytesRef.current = onBytes;

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const handle = editorRef.current;
      if (!handle) return;
      void handle.save()
        .then((buffer) => {
          if (buffer) onBytesRef.current(new Uint8Array(buffer));
        })
        .catch(() => {
          // The next change or save reads the document again.
        });
    }, REFRESH_DELAY_MS);
  }, [editorRef]);
}

/** Keeps the previous value when the new one has the same content, so effects keyed on it do not re-run. */
export function keepIfSame<T>(next: T): (current: T) => T {
  return (current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next);
}
