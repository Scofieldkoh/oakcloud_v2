import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  toPlainAiText,
  useOakDocAiSelection,
} from '@/components/documents/oakdoc/use-oakdoc-ai-selection';

const range = { from: { paraId: 'p1', search: 'old' }, to: { paraId: 'p1' } };

function fakeEditor(selectedText = 'old terms') {
  let onSelection: (() => void) | null = null;
  const editor = {
    snapshot: vi.fn(() => ({ selection: range })),
    query: vi.fn(() => selectedText),
    can: vi.fn(() => ({ ok: true })),
    on: vi.fn((_event: string, handler: () => void) => {
      onSelection = handler;
      return () => { onSelection = null; };
    }),
  };
  const handle = { getEditor: () => editor, exec: vi.fn(() => ({ ok: true, changed: true })) };
  return { editor, handle, fireSelection: () => onSelection?.() };
}

function setup(selectedText?: string) {
  const fake = fakeEditor(selectedText);
  let revision = 1;
  // Stable like a component's useRef.
  const editorRef = { current: fake.handle } as never;
  const hook = renderHook(() => useOakDocAiSelection({
    editorRef,
    enabled: true,
    documentKey: 1,
    getRevision: () => revision,
  }));
  return { ...fake, hook, bump: () => { revision += 1; } };
}

describe('toPlainAiText', () => {
  it('drops markup so AI output is inserted as plain text', () => {
    expect(toPlainAiText('## Terms\n\n**The Client** shall <b>pay</b> fees.\n- within 30 days'))
      .toBe('Terms The Client shall pay fees. within 30 days');
  });
});

describe('useOakDocAiSelection', () => {
  it('exposes the captured selection and replaces exactly that range', () => {
    const { hook, handle } = setup();
    expect(hook.result.current.selectedText).toBe('old terms');

    let result;
    act(() => { result = hook.result.current.replace('**new** terms'); });
    expect(result).toEqual({ ok: true });
    expect(handle.exec).toHaveBeenCalledWith({ type: 'replaceText', target: range, text: 'new terms' });
  });

  it('inserts at the end of the captured selection', () => {
    const { hook, handle } = setup('');
    act(() => { hook.result.current.insert('Added clause'); });
    expect(handle.exec).toHaveBeenCalledWith({ type: 'insertText', target: range.to, text: 'Added clause' });
  });

  it('refuses a stale selection after the document changed', () => {
    const { hook, handle, bump } = setup();
    bump();
    let result;
    act(() => { result = hook.result.current.replace('new terms'); });
    expect(result).toEqual({ ok: false, message: expect.stringMatching(/changed/) });
    expect(handle.exec).not.toHaveBeenCalled();
  });

  it('recaptures on selection change so the new selection can be used', () => {
    const { hook, handle, bump, fireSelection } = setup();
    bump();
    act(() => fireSelection());
    act(() => { hook.result.current.replace('new terms'); });
    expect(handle.exec).toHaveBeenCalledTimes(1);
  });

  it('does not replace when nothing is selected', () => {
    const { hook, handle } = setup('');
    let result;
    act(() => { result = hook.result.current.replace('new terms'); });
    expect(result).toEqual({ ok: false, message: 'Select the text to replace first.' });
    expect(handle.exec).not.toHaveBeenCalled();
  });
});
