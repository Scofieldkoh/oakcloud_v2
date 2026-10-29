'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { DocxEditorRef, EditorCommand } from '@docx-editor.dev/react';

type OakDocEditor = NonNullable<ReturnType<DocxEditorRef['getEditor']>>;
type DocRange = NonNullable<ReturnType<OakDocEditor['snapshot']>['selection']>;

interface CapturedSelection {
  text: string;
  range: DocRange;
  /** The editor's local revision when the selection was taken. */
  revision: number;
}

export type OakDocAiEditResult = { ok: true } | { ok: false; message: string };

/**
 * AI output is inserted as plain text in one run: markup is dropped, so a
 * response can never inject Word structure, fields or HTML.
 */
export function toPlainAiText(content: string): string {
  return content
    .replace(/<[^>]*>/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '')
    .replace(/(\*\*|__|\*|_|`)(\S(?:.*?\S)?)\1/g, '$2')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Tracks the OakDoc selection for the AI sidebar and applies its output.
 * A replacement uses the selection captured with the text the user saw; if
 * the document changed since then it is refused rather than applied to
 * whatever now sits at that position.
 */
export function useOakDocAiSelection(input: {
  editorRef: RefObject<DocxEditorRef | null>;
  enabled: boolean;
  /** Changes when a new document is loaded into a fresh editor. */
  documentKey: number;
  getRevision: () => number;
}) {
  const { editorRef, enabled, documentKey } = input;
  const [selection, setSelection] = useState<CapturedSelection | null>(null);
  const selectionRef = useRef<CapturedSelection | null>(null);
  // Read through a ref so a new callback identity never re-subscribes.
  const getRevisionRef = useRef(input.getRevision);
  getRevisionRef.current = input.getRevision;
  const getRevision = useCallback(() => getRevisionRef.current(), []);

  const capture = useCallback(() => {
    const editor = editorRef.current?.getEditor();
    const range = editor?.snapshot().selection;
    const next = editor && range
      ? { text: String(editor.query({ type: 'selectedText' }) ?? ''), range, revision: getRevision() }
      : null;
    selectionRef.current = next;
    setSelection(next);
  }, [editorRef, getRevision]);

  useEffect(() => {
    if (!enabled) return undefined;
    const editor = editorRef.current?.getEditor();
    if (!editor) return undefined;
    capture();
    return editor.on('selectionChange', capture);
  }, [capture, documentKey, editorRef, enabled]);

  const apply = useCallback((mode: 'insert' | 'replace', content: string): OakDocAiEditResult => {
    const editor = editorRef.current?.getEditor();
    const handle = editorRef.current;
    const captured = selectionRef.current;
    if (!editor || !handle) return { ok: false, message: 'OakDoc is not ready.' };
    const text = toPlainAiText(content);
    if (!text) return { ok: false, message: 'The AI response has no text to add.' };
    if (!captured) return { ok: false, message: 'Place the caret in the document first.' };
    if (captured.revision !== getRevision()) {
      return { ok: false, message: 'The document changed after that selection. Select the text again.' };
    }
    if (mode === 'replace' && !captured.text) {
      return { ok: false, message: 'Select the text to replace first.' };
    }

    const command = (mode === 'replace'
      ? { type: 'replaceText', target: captured.range, text }
      : { type: 'insertText', target: captured.range.to, text }) as EditorCommand;
    const allowed = editor.can(command);
    if (!allowed.ok) return { ok: false, message: allowed.reason || 'OakDoc cannot change the text there.' };
    const result = handle.exec(command);
    if (!result.ok) return { ok: false, message: result.reason || 'OakDoc could not change the text.' };
    return { ok: true };
  }, [editorRef, getRevision]);

  return {
    selectedText: selection?.text || undefined,
    insert: useCallback((content: string) => apply('insert', content), [apply]),
    replace: useCallback((content: string) => apply('replace', content), [apply]),
  };
}
