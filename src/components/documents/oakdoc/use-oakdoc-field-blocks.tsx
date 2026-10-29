'use client';

import {
  useCallback,
  useRef,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import {
  useEditorCaret,
  type DocxEditorRef,
  type EditorCaret,
  type EditorCommand,
} from '@docx-editor.dev/react';
import type { OakDocFieldDefinition } from '@/lib/document-editor/oakdoc-fields';
import {
  OAKDOC_FIELD_DRAG_TYPE,
  oakDocFieldBlockAction,
  oakDocFieldInside,
  oakDocFieldRanges,
  type OakDocFieldRange,
} from '@/lib/document-editor/oakdoc-field-blocks';

const BLOCKED_TYPING_HINT =
  'Fields cannot be typed into. Press Delete to remove a field, or Ctrl+X then Ctrl+V to move it.';

/** Mirrors the editor's caret into a ref; must render inside `DocxEditor`. */
function OakDocCaretProbe({ caretRef }: { caretRef: MutableRefObject<EditorCaret | null> }) {
  caretRef.current = useEditorCaret();
  return null;
}

export interface OakDocFieldBlockOptions {
  editorRef: RefObject<DocxEditorRef | null>;
  disabled?: boolean;
  /** Removes field controls an edit left empty; their removal is remounted. */
  cleanup: (bytes: Uint8Array) => { bytes: Uint8Array; removed: number };
  onRepaired: (bytes: Uint8Array, message: string) => void;
  onChanged: () => void;
  onHint: (message: string) => void;
  /** Insert a field dragged from the field list at the caret placed at the drop point. */
  onDropField?: (field: OakDocFieldDefinition) => void;
}

interface SelectedField {
  paragraphId: string;
  range: OakDocFieldRange;
}

function paragraphFieldRanges(container: HTMLElement, paragraphId: string): OakDocFieldRange[] {
  const selector = `[data-paragraph-id="${CSS.escape(paragraphId)}"][data-start][data-end]`;
  return oakDocFieldRanges(
    Array.from(container.querySelectorAll<HTMLElement>(selector)).map((element) => ({
      start: Number(element.dataset.start),
      end: Number(element.dataset.end),
      text: element.textContent ?? '',
    })),
  );
}

/** The paragraph offset under a page point, from the laid-out text run there. */
function caretFromPoint(x: number, y: number): EditorCaret | null {
  const position = document.caretPositionFromPoint?.(x, y);
  const node = position?.offsetNode;
  const run = (node?.nodeType === Node.TEXT_NODE ? node.parentElement : node as Element | null)
    ?.closest<HTMLElement>('[data-paragraph-id][data-start]');
  if (!position || !run?.dataset.paragraphId) return null;
  const start = Number(run.dataset.start);
  const end = Number(run.dataset.end);
  const offset = node?.nodeType === Node.TEXT_NODE ? position.offset : 0;
  if (!Number.isFinite(start)) return null;
  return {
    paragraphId: run.dataset.paragraphId,
    offset: Math.min(start + offset, Number.isFinite(end) ? end : start + offset),
  };
}

/**
 * Makes OakDoc fields behave as blocks in an authoring editor. Spread
 * `onKeyDownCapture` and `onPointerUpCapture` on the element wrapping the
 * editor and render `probe` as a child of `DocxEditor`.
 */
export function useOakDocFieldBlocks({
  editorRef,
  disabled = false,
  cleanup,
  onRepaired,
  onChanged,
  onHint,
  onDropField,
}: OakDocFieldBlockOptions) {
  const caretRef = useRef<EditorCaret | null>(null);
  const selectedRef = useRef<SelectedField | null>(null);

  const selectField = useCallback((paragraphId: string, range: OakDocFieldRange) => {
    const editor = editorRef.current?.getEditor();
    if (!editor) return false;
    const result = editor.exec({
      type: 'setSelection',
      range: {
        anchor: { paragraphId, offset: range.start },
        head: { paragraphId, offset: range.end },
      },
    } as EditorCommand);
    if (result.ok) selectedRef.current = { paragraphId, range };
    return result.ok;
  }, [editorRef]);

  // A deleted or cut field leaves its empty control behind, which the editor
  // shows as a prompt; remove it once the editor has applied the edit.
  const removeEmptiedFields = useCallback(() => {
    window.setTimeout(() => {
      void (async () => {
        const handle = editorRef.current;
        const buffer = await handle?.save();
        if (!buffer) return;
        const cleaned = cleanup(new Uint8Array(buffer));
        if (cleaned.removed === 0) return;
        onRepaired(cleaned.bytes, cleaned.removed === 1 ? 'Field removed.' : `${cleaned.removed} fields removed.`);
        onChanged();
      })().catch(() => undefined);
    }, 0);
  }, [cleanup, editorRef, onChanged, onRepaired]);

  const onKeyDownCapture = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    if (disabled || event.nativeEvent.isComposing) return;
    const editor = editorRef.current?.getEditor();
    const caret = caretRef.current;
    if (!editor || !caret) return;

    const { key } = event;
    const modifier = event.ctrlKey || event.metaKey || event.altKey;
    const typing = !modifier && (key.length === 1 || key === 'Enter' || key === 'Tab');
    const removing = key === 'Backspace' || key === 'Delete' || (modifier && key.toLowerCase() === 'x');

    if (!editor.snapshot().selectionCollapsed) {
      const selected = selectedRef.current;
      const onSelectedField = selected
        && selected.paragraphId === caret.paragraphId
        && (caret.offset === selected.range.start || caret.offset === selected.range.end);
      if (onSelectedField && typing) {
        event.preventDefault();
        event.stopPropagation();
        onHint(BLOCKED_TYPING_HINT);
        return;
      }
      if (removing) {
        selectedRef.current = null;
        removeEmptiedFields();
      }
      return;
    }

    selectedRef.current = null;
    const action = oakDocFieldBlockAction({
      key,
      modifier,
      offset: caret.offset,
      ranges: paragraphFieldRanges(event.currentTarget, caret.paragraphId),
    });
    if (!action) return;
    if (action.kind === 'block') {
      event.preventDefault();
      event.stopPropagation();
      onHint(BLOCKED_TYPING_HINT);
      return;
    }
    // Select the whole field and let the editor's own delete remove it.
    if (selectField(caret.paragraphId, action.range)) {
      selectedRef.current = null;
      removeEmptiedFields();
    }
  }, [disabled, editorRef, onHint, removeEmptiedFields, selectField]);

  const onPointerUpCapture = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (disabled) return;
    const container = event.currentTarget;
    // Read the caret after the editor has placed it for this click.
    window.setTimeout(() => {
      const editor = editorRef.current?.getEditor();
      const caret = caretRef.current;
      if (!editor || !caret || !editor.snapshot().selectionCollapsed) return;
      const range = oakDocFieldInside(paragraphFieldRanges(container, caret.paragraphId), caret.offset);
      if (range) selectField(caret.paragraphId, range);
    }, 0);
  }, [disabled, editorRef, selectField]);

  const onDragOver = useCallback((event: ReactDragEvent<HTMLElement>) => {
    if (disabled || !onDropField || !event.dataTransfer.types.includes(OAKDOC_FIELD_DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, [disabled, onDropField]);

  const onDrop = useCallback((event: ReactDragEvent<HTMLElement>) => {
    if (disabled || !onDropField) return;
    const payload = event.dataTransfer.getData(OAKDOC_FIELD_DRAG_TYPE);
    if (!payload) return;
    event.preventDefault();
    let field: OakDocFieldDefinition;
    try {
      field = JSON.parse(payload) as OakDocFieldDefinition;
    } catch {
      return;
    }
    if (!field?.tag) return;
    const caret = caretFromPoint(event.clientX, event.clientY);
    const editor = editorRef.current?.getEditor();
    if (caret && editor) {
      editor.exec({
        type: 'setSelection',
        range: { anchor: caret, head: caret },
      } as EditorCommand);
    }
    window.setTimeout(() => onDropField(field), 0);
  }, [disabled, editorRef, onDropField]);

  const getCaret = useCallback(() => caretRef.current, []);

  return {
    onDragOver,
    onDrop,
    getCaret,
    probe: <OakDocCaretProbe caretRef={caretRef} />,
    onKeyDownCapture,
    onPointerUpCapture,
  };
}
