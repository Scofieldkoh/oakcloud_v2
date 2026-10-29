'use client';

import {
  useCallback,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react';
import type { DocxEditorRef, EditorCommand } from '@docx-editor.dev/react';
import {
  oakDocCaretTouchesSectionBoundary,
  oakDocSelectionCrossesSectionBoundary,
  preserveTransferredOakDocSections,
} from '@/lib/document-editor/oakdoc-section-compatibility';

export interface OakDocSectionDeleteGuardOptions {
  editorRef: RefObject<DocxEditorRef | null>;
  /** Bytes of the currently mounted document (structure evidence only). */
  documentBytes: Uint8Array | null;
  disabled?: boolean;
  /** Optional post-repair cleanup, e.g. pruning deleted template fields. */
  cleanup?: (bytes: Uint8Array) => { bytes: Uint8Array; removed: number };
  /** Mount repaired bytes; `message` describes what was preserved. */
  onRepaired: (bytes: Uint8Array, message: string) => void;
  onChanged: () => void;
  onBusyChange?: (busy: boolean) => void;
  onError: (message: string) => void;
}

/**
 * Narrow section-boundary Delete/Backspace repair shared by every OakDoc host
 * (templates, batch review, standalone drafts). Native editing is otherwise
 * untouched; see docs/debug/oakdoc-normal-delete-layout.md.
 */
export function useOakDocSectionDeleteGuard({
  editorRef,
  documentBytes,
  disabled = false,
  cleanup,
  onRepaired,
  onChanged,
  onBusyChange,
  onError,
}: OakDocSectionDeleteGuardOptions) {
  const selectionCrossesSectionBoundary = useCallback((): boolean => {
    const handle = editorRef.current;
    if (!handle || !documentBytes) return false;

    const snapshot = handle.snapshot();
    if (snapshot.selectionCollapsed || !snapshot.selection) return false;

    const from = snapshot.selection.from;
    const to = snapshot.selection.to;
    if (!('paraId' in from) || !('paraId' in to)) return false;

    const fromId = from.paraId.toUpperCase();
    const toId = to.paraId.toUpperCase();
    if (fromId === toId) return false;

    return oakDocSelectionCrossesSectionBoundary({
      docxBytes: documentBytes,
      fromParagraphId: fromId,
      toParagraphId: toId,
    });
  }, [documentBytes, editorRef]);

  const collapsedCaretTouchesSectionBoundary = useCallback((): boolean => {
    const handle = editorRef.current;
    if (!handle || !documentBytes) return false;

    const snapshot = handle.snapshot();
    if (!snapshot.selectionCollapsed || !snapshot.selection) return false;
    const from = snapshot.selection.from;
    if (!('paraId' in from)) return false;

    return oakDocCaretTouchesSectionBoundary({
      docxBytes: documentBytes,
      paragraphId: from.paraId,
    });
  }, [documentBytes, editorRef]);

  const applyRepair = useCallback((
    beforeBytes: Uint8Array,
    afterBytes: Uint8Array,
    alwaysReportChange: boolean,
  ) => {
    const repaired = preserveTransferredOakDocSections({ beforeBytes, afterBytes });
    const cleaned = cleanup ? cleanup(repaired.bytes) : { bytes: repaired.bytes, removed: 0 };
    if (repaired.restored > 0 || cleaned.removed > 0) {
      const sectionMessage = repaired.restored > 0 ? ' Word section layout was preserved.' : '';
      const fieldMessage = cleaned.removed > 0
        ? ` Removed ${cleaned.removed} deleted OakDoc field${cleaned.removed === 1 ? '' : 's'}.`
        : '';
      onRepaired(cleaned.bytes, `Content deleted.${sectionMessage}${fieldMessage}`);
      onChanged();
    } else if (alwaysReportChange) {
      onChanged();
    }
  }, [cleanup, onChanged, onRepaired]);

  const repairSectionBoundaryDelete = useCallback(async () => {
    const handle = editorRef.current;
    if (!handle) return;
    onBusyChange?.(true);
    try {
      const beforeBuffer = await handle.save();
      if (!beforeBuffer) throw new Error('OakDoc could not snapshot the document before deletion.');

      const editor = handle.getEditor();
      const selection = editor?.snapshot().selection;
      if (!editor || !selection) throw new Error('OakDoc could not resolve the selected content.');

      const deleted = editor.exec({ type: 'deleteText', target: selection } as EditorCommand);
      if (!deleted.ok) throw new Error(deleted.reason || 'OakDoc could not delete the selected content.');

      const afterBuffer = await handle.save();
      if (!afterBuffer) throw new Error('OakDoc could not snapshot the document after deletion.');
      applyRepair(new Uint8Array(beforeBuffer), new Uint8Array(afterBuffer), true);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Could not safely delete the selection.');
    } finally {
      onBusyChange?.(false);
    }
  }, [applyRepair, editorRef, onBusyChange, onError]);

  const repairNativeCollapsedSectionDelete = useCallback((
    beforeSave: Promise<ArrayBuffer | null>,
  ) => {
    // A collapsed caret exposes no character offset through the public editor
    // API. Capture live pre-delete bytes, let the native delete run, then
    // compare. The strict repair is a no-op unless a w:sectPr was transferred.
    queueMicrotask(() => {
      void (async () => {
        const handle = editorRef.current;
        if (!handle) return;
        try {
          const beforeBuffer = await beforeSave;
          if (!beforeBuffer) return;
          const afterBuffer = await handle.save();
          if (!afterBuffer) return;
          applyRepair(new Uint8Array(beforeBuffer), new Uint8Array(afterBuffer), false);
        } catch (error) {
          onError(error instanceof Error ? error.message : 'Could not verify Word section layout after deletion.');
        }
      })();
    });
  }, [applyRepair, editorRef, onError]);

  return useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    if (disabled || (event.key !== 'Backspace' && event.key !== 'Delete')) return;

    if (selectionCrossesSectionBoundary()) {
      // The editor transfers the later paragraph's w:sectPr onto the
      // surviving paragraph when a range delete joins across a section.
      event.preventDefault();
      event.stopPropagation();
      void repairSectionBoundaryDelete();
      return;
    }

    if (!collapsedCaretTouchesSectionBoundary()) return;
    const handle = editorRef.current;
    if (!handle) return;
    repairNativeCollapsedSectionDelete(handle.save());
  }, [
    collapsedCaretTouchesSectionBoundary,
    disabled,
    editorRef,
    repairNativeCollapsedSectionDelete,
    repairSectionBoundaryDelete,
    selectionCrossesSectionBoundary,
  ]);
}
