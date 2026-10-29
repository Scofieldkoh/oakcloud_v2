'use client';

import { useCallback, useRef, type RefObject } from 'react';
import type { DocxEditorRef, EditorCaret, EditorCommand } from '@docx-editor.dev/react';

/** The editor's scrolling viewport inside the element wrapping `DocxEditor`. */
const SCROLL_CONTAINER = '.docx-editor__scroll-container';
const RESTORE_ATTEMPTS = 20;

interface KeptView {
  scrollTop: number;
  caret: EditorCaret | null;
}

/**
 * Keeps the author's place when an editor document is remounted with new
 * bytes (a repeating section added, a deleted field pruned...). Call `keep`
 * before the remount and `restore` from the new editor's `onReady`; the
 * caret goes back to the same paragraph offset and the page to the same
 * scroll position instead of the top of the document.
 */
export function useOakDocViewKeeper(
  editorRef: RefObject<DocxEditorRef | null>,
  getCaret: () => EditorCaret | null,
) {
  const containerRef = useRef<HTMLElement | null>(null);
  const keptRef = useRef<KeptView | null>(null);

  const keep = useCallback(() => {
    const scroller = containerRef.current?.querySelector<HTMLElement>(SCROLL_CONTAINER);
    if (!scroller) return;
    keptRef.current = { scrollTop: scroller.scrollTop, caret: getCaret() };
  }, [getCaret]);

  const restore = useCallback(() => {
    const kept = keptRef.current;
    keptRef.current = null;
    if (!kept) return;
    const editor = editorRef.current?.getEditor();
    if (kept.caret && editor) {
      const command = {
        type: 'setSelection',
        range: { anchor: kept.caret, head: kept.caret },
      } as EditorCommand;
      // Paragraph ids are positions; a structural edit can retire this one.
      if (editor.can(command).ok) editor.exec(command);
    }
    // Pages lay out over a few frames after ready; retry until the viewport
    // is tall enough to take the old position.
    let attempts = 0;
    const apply = () => {
      const scroller = containerRef.current?.querySelector<HTMLElement>(SCROLL_CONTAINER);
      if (scroller) scroller.scrollTop = kept.scrollTop;
      const settled = scroller && Math.abs(scroller.scrollTop - kept.scrollTop) <= 1;
      attempts += 1;
      if (!settled && attempts < RESTORE_ATTEMPTS) window.requestAnimationFrame(apply);
    };
    window.requestAnimationFrame(apply);
  }, [editorRef]);

  return { containerRef, keep, restore };
}
