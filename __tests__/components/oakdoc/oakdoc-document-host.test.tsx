import { act, render, screen, waitFor } from '@testing-library/react';
import { forwardRef, useImperativeHandle } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const editorState = vi.hoisted(() => ({
  onChange: null as null | (() => void),
  saveImpl: vi.fn(async () => new Uint8Array([1, 2, 3]).buffer as ArrayBuffer),
  mounts: 0,
  document: null as null | Uint8Array,
  selection: null as null | { from: { paraId: string }; to: { paraId: string } },
}));

vi.mock('@docx-editor.dev/react', () => ({
  DocxEditor: forwardRef(function MockDocxEditor(
    props: { document?: Uint8Array; onChange?: () => void; onReady?: () => void },
    ref,
  ) {
    editorState.document = props.document ?? null;
    useImperativeHandle(ref, () => ({
      save: editorState.saveImpl,
      snapshot: () => ({ selectionCollapsed: true, selection: null }),
      getEditor: () => (editorState.selection
        ? { snapshot: () => ({ selection: editorState.selection }) }
        : null),
    }));
    editorState.onChange = props.onChange ?? null;
    if (props.onReady) queueMicrotask(props.onReady);
    return <div data-testid="docx-editor" />;
  }),
}));

import { OakDocDocumentHost, type OakDocHostSidebarApi } from '@/components/documents/oakdoc/oakdoc-document-host';
import { OAKDOC_OFFICERS_REPEATER_TAG } from '@/lib/document-editor/oakdoc-repeater-definitions';
import { OAKDOC_REPEATER_DEFINITIONS } from '@/lib/document-editor/oakdoc-repeaters';
import { createDocxFixture } from '../../helpers/docx-fixture';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('OakDocDocumentHost', () => {
  beforeEach(() => {
    editorState.onChange = null;
    editorState.saveImpl.mockClear();
    editorState.selection = null;
  });

  it('lets a sidebar make the paragraph at the caret repeat for officers', async () => {
    const paragraph = createDocxFixture({
      'word/document.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
        + ' xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"><w:body>'
        + '<w:p w14:paraId="0A1B2C3D"><w:r><w:t>Secretary resigns</w:t></w:r></w:p><w:sectPr/></w:body></w:document>',
    });
    editorState.saveImpl.mockImplementation(async () => paragraph.slice().buffer as ArrayBuffer);
    editorState.selection = { from: { paraId: '0A1B2C3D' }, to: { paraId: '0A1B2C3D' } };
    let api: OakDocHostSidebarApi | null = null;
    const onDirtyChange = vi.fn();

    render(
      <OakDocDocumentHost
        entityKey="partial:p-1"
        baseRevision={1}
        title="Resignation of secretary"
        readOnly={false}
        description="Word partial"
        loadingLabel="Loading…"
        load={async () => paragraph}
        persist={vi.fn()}
        onDirtyChange={onDirtyChange}
        renderSidebar={(sidebar) => {
          api = sidebar;
          return <span>{`${sidebar.repeaters.count} repeating`}</span>;
        }}
      />,
    );
    await screen.findByTestId('docx-editor');
    expect(screen.getByText('0 repeating')).toBeInTheDocument();

    const officers = OAKDOC_REPEATER_DEFINITIONS.find((definition) => definition.tag === OAKDOC_OFFICERS_REPEATER_TAG)!;
    await act(async () => { await api!.addRepeater(officers); });

    expect(await screen.findByText('1 repeating')).toBeInTheDocument();
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  });

  it('cleans loaded and saved bytes and remounts the cleaned document after save', async () => {
    const cleanup = vi.fn((bytes: Uint8Array) => ({ bytes: new Uint8Array([...bytes, 0]), removed: 1 }));
    const persist = vi.fn(async () => ({ revision: 2 }));
    editorState.saveImpl.mockImplementation(async () => new Uint8Array([1, 2, 3]).buffer as ArrayBuffer);

    render(
      <OakDocDocumentHost
        entityKey="partial:p-2"
        baseRevision={1}
        title="Appointment of secretary"
        readOnly={false}
        description="Word partial"
        loadingLabel="Loading…"
        load={async () => new Uint8Array([9])}
        persist={persist}
        cleanup={cleanup}
      />,
    );
    await screen.findByTestId('docx-editor');
    expect(cleanup).toHaveBeenCalledWith(new Uint8Array([9]));

    await act(async () => { await Promise.resolve(); });
    act(() => editorState.onChange?.());
    act(() => { screen.getByRole('button', { name: /save docx/i }).click(); });

    await waitFor(() => expect(persist).toHaveBeenCalledOnce());
    expect((persist.mock.calls[0] as unknown as [Uint8Array])[0]).toEqual(new Uint8Array([1, 2, 3, 0]));
    await waitFor(() => expect(editorState.document).toEqual(new Uint8Array([1, 2, 3, 0])));
  });

  it('keeps edits typed during an in-flight save dirty and never reloads submitted bytes', async () => {
    const load = vi.fn(async () => new Uint8Array([9]));
    const pending = deferred<{ revision: number }>();
    const persist = vi.fn(() => pending.promise);
    const onDirtyChange = vi.fn();

    render(
      <OakDocDocumentHost
        entityKey="generated:doc-1"
        baseRevision={4}
        title="Letter"
        readOnly={false}
        description="editable generated document"
        loadingLabel="Loading…"
        load={load}
        persist={persist}
        onDirtyChange={onDirtyChange}
      />,
    );
    await screen.findByTestId('docx-editor');
    await act(async () => { await Promise.resolve(); });

    act(() => editorState.onChange?.());
    expect(screen.getByRole('button', { name: /save docx/i })).toBeEnabled();

    act(() => { screen.getByRole('button', { name: /save docx/i }).click(); });
    await waitFor(() => expect(persist).toHaveBeenCalledOnce());
    const [, snapshot, operationId] = persist.mock.calls[0] as unknown as [Uint8Array, { localRevision: number; baseRevision: number }, string];
    expect(snapshot).toMatchObject({ localRevision: 1, baseRevision: 4 });
    expect(operationId).toBeTruthy();

    act(() => editorState.onChange?.()); // typing during save
    await act(async () => { pending.resolve({ revision: 5 }); await pending.promise; });

    expect(load).toHaveBeenCalledOnce();
    expect(screen.getByRole('status')).toHaveTextContent(/unsaved/i);
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);

    persist.mockResolvedValueOnce({ revision: 6 });
    act(() => { screen.getByRole('button', { name: /save docx/i }).click(); });
    await waitFor(() => expect(persist).toHaveBeenCalledTimes(2));
    const second = persist.mock.calls[1] as unknown as [Uint8Array, { localRevision: number; baseRevision: number }];
    expect(second[1]).toMatchObject({ localRevision: 2, baseRevision: 5 });
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
  });

  it('reuses the operation id when retrying the same unsaved revision after a failure', async () => {
    const persist = vi.fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ revision: 2 });
    render(
      <OakDocDocumentHost
        entityKey="generated:doc-2"
        baseRevision={1}
        title="Letter"
        readOnly={false}
        description="editable generated document"
        loadingLabel="Loading…"
        load={async () => new Uint8Array([1])}
        persist={persist}
      />,
    );
    await screen.findByTestId('docx-editor');
    await act(async () => { await Promise.resolve(); });
    act(() => editorState.onChange?.());

    act(() => { screen.getByRole('button', { name: /save docx/i }).click(); });
    await screen.findByText('network');
    act(() => { screen.getByRole('button', { name: /save docx/i }).click(); });
    await waitFor(() => expect(persist).toHaveBeenCalledTimes(2));
    expect(persist.mock.calls[1][2]).toBe(persist.mock.calls[0][2]);
  });

  it('does not reload or reset dirty state when the persisted revision prop changes', async () => {
    const load = vi.fn(async () => new Uint8Array([1]));
    const props = {
      entityKey: 'generated:doc-3',
      title: 'Letter',
      readOnly: false,
      description: 'editable generated document',
      loadingLabel: 'Loading…',
      load,
      persist: vi.fn(),
    };
    const { rerender } = render(<OakDocDocumentHost {...props} baseRevision={1} />);
    await screen.findByTestId('docx-editor');
    await act(async () => { await Promise.resolve(); });
    act(() => editorState.onChange?.());

    rerender(<OakDocDocumentHost {...props} baseRevision={7} />);
    expect(load).toHaveBeenCalledOnce();
    expect(screen.getByRole('status')).toHaveTextContent(/unsaved/i);
  });
});
