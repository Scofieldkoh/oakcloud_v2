'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDocxEditor, useEditorCommand } from '@docx-editor.dev/react';
import {
  createBrowserAutomationHost,
  type DocxEditorInstance,
} from '@docx-editor.dev/core/editor';
import type { AutomationHost, AutomationOperation } from '@docx-editor.dev/core/automation';

/** Word's level text for "(a)", "(b)", "(c)": `%1` is the item's own letter. */
export const OAKDOC_LETTERED_LIST_FORMAT = ['(', 0, ')'] as const;
const LABEL = 'Lettered list (a), (b), (c)';

type Handle = Extract<AutomationOperation, { op: 'getParagraphList' }>['paragraph'];

function run(host: AutomationHost, operations: AutomationOperation[]) {
  const response = host.execute({ operations });
  return response.ok ? response.results : null;
}

function valueOf(result: { status: string; value?: unknown } | undefined): unknown {
  if (!result || result.status !== 'ok') return undefined;
  const value = result.value as { handle?: unknown; handles?: unknown; value?: unknown; text?: unknown };
  return value.handle ?? value.handles ?? value.value ?? value.text;
}

/**
 * Turns the selected body paragraphs into one new top-level list lettered (a), (b), (c).
 *
 * The editor's own buttons only offer bullets and 1, 2, 3 (letters appear one indent down),
 * so this starts a fresh list on the first paragraph, joins the rest to it at level 0, and
 * overrides that list's level 0 to lower-case letters. The override lives on the new
 * `w:num`, so other numbered lists in the document keep their numbers. Returns false when
 * the selection is not in body paragraphs.
 */
export function applyOakDocLetteredList(editor: DocxEditorInstance): boolean {
  const selection = editor.snapshot().selection;
  if (!selection || !('paraId' in selection.from) || !('paraId' in selection.to)) return false;
  const fromId = selection.from.paraId;
  const toId = selection.to.paraId;

  const host = createBrowserAutomationHost(editor);
  try {
    const [documentResult] = run(host, [{ op: 'getDocument' }]) ?? [];
    const document = valueOf(documentResult) as Handle | undefined;
    if (!document) return false;
    const [bodyResult] = run(host, [{ op: 'getBody', document }]) ?? [];
    const body = valueOf(bodyResult) as Handle | undefined;
    if (!body) return false;
    const [paragraphsResult] = run(host, [{ op: 'getParagraphs', body }]) ?? [];
    const paragraphs = (valueOf(paragraphsResult) as Handle[] | undefined) ?? [];
    const ids = (run(host, paragraphs.map((paragraph) => ({ op: 'getParagraphId', paragraph }))) ?? [])
      .map((result) => valueOf(result));
    const start = ids.indexOf(fromId);
    const end = ids.indexOf(toId);
    if (start < 0 || end < 0) return false;
    const selected = paragraphs.slice(Math.min(start, end), Math.max(start, end) + 1);

    const [listResult] = run(host, [{ op: 'startNewList', paragraph: selected[0] }]) ?? [];
    const list = valueOf(listResult) as Handle | undefined;
    if (!list) return false;
    const [listIdResult] = run(host, [{ op: 'getListId', list }]) ?? [];
    const listId = valueOf(listIdResult);
    if (typeof listId !== 'number') return false;
    return run(host, [
      ...selected.slice(1).map((paragraph) => ({ op: 'attachToList' as const, paragraph, listId, level: 0 })),
      { op: 'setListLevelFormat', list, level: 0, format: { numbering: 'LowerLetter', formatString: OAKDOC_LETTERED_LIST_FORMAT } },
    ]) !== null;
  } finally {
    host.dispose();
  }
}

function LetteredListIcon() {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} aria-hidden="true" focusable="false">
      <g fill="currentColor" fontFamily="Arial, Helvetica, sans-serif" fontSize="9" fontWeight="700">
        <text x="0.5" y="8">a</text>
        <text x="0.5" y="15.5">b</text>
        <text x="0.5" y="23">c</text>
      </g>
      <path d="M9 4.5h14v2H9zM9 12h14v2H9zM9 19.5h14v2H9z" fill="currentColor" />
    </svg>
  );
}

/**
 * Adds a "Lettered list" button to the packaged toolbar, right after its Numbered list
 * button. Render it as a child of `DocxEditor`. The packaged editor has no slot for host
 * buttons inside its toolbar groups, so the button is portalled next to the numbered list
 * control and re-attached whenever the toolbar re-renders that group.
 */
export function OakDocLetteredListButton() {
  const editor = useDocxEditor();
  const numbered = useEditorCommand('list.numbered');
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const root = anchorRef.current?.closest('.docx-editor') ?? anchorRef.current?.ownerDocument.body;
    if (!root) return;
    const container = document.createElement('span');
    container.className = 'oakdoc-lettered-list-slot';
    container.style.display = 'contents';
    const attach = () => {
      const target = root.querySelector<HTMLElement>('[data-testid="docx-toolbar"] button[data-slot="list.numbered"]');
      if (!target) {
        if (container.isConnected) container.remove();
        return;
      }
      if (target.nextElementSibling !== container) target.after(container);
    };
    attach();
    setSlot(container);
    const observer = new MutationObserver(attach);
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      container.remove();
      setSlot(null);
    };
  }, []);

  const apply = useCallback(() => {
    if (editor) applyOakDocLetteredList(editor);
  }, [editor]);

  return (
    <>
      <span ref={anchorRef} hidden />
      {slot
        ? createPortal(
            <button
              type="button"
              className="docx-toolbar__button"
              data-slot="oakdoc.list.lettered"
              aria-label={LABEL}
              title={LABEL}
              disabled={!editor || !numbered.isEnabled}
              onMouseDown={(event) => event.preventDefault()}
              onClick={apply}
            >
              <LetteredListIcon />
            </button>,
            slot,
          )
        : null}
    </>
  );
}
