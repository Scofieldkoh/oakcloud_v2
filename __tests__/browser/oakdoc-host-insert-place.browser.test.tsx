import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { page, userEvent } from 'vitest/browser';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { strFromU8, unzipSync, zipSync, strToU8 } from 'fflate';
import { OakDocDocumentHost } from '@/components/documents/oakdoc/oakdoc-document-host';
import { OakDocFieldPanel } from '@/components/documents/oakdoc/oakdoc-field-panel';
import { pruneDeletedOakDocFields } from '@/lib/document-editor/oakdoc-fields';
import { OAKDOC_FIELD_TAGS } from '@/lib/document-editor/oakdoc-field-registry';
import '@docx-editor.dev/core/styles/editor.css';
import '@/app/globals.css';

vi.mock('@/hooks/use-contacts', () => ({ useContacts: () => ({ data: { contacts: [] }, isLoading: false, error: null, refetch: vi.fn() }) }));

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';

function docx(): Uint8Array {
  const paragraphs = Array.from({ length: 80 }, (_, index) => {
    const id = (0x10000000 + index).toString(16).toUpperCase();
    return `<w:p w14:paraId="${id}"><w:r><w:t xml:space="preserve">Paragraph ${index + 1} of the resolution</w:t></w:r></w:p>`;
  }).join('');
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/document.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${W}" xmlns:w14="${W14}"><w:body>${paragraphs}<w:sectPr/></w:body></w:document>`),
    'word/_rels/document.xml.rels': strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>'),
  });
}

function scroller(): HTMLElement {
  return document.querySelector<HTMLElement>('.docx-editor__scroll-container')!;
}

async function waitFor(check: () => boolean, label: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

describe('OakDoc editor keeps the author\'s place', () => {
  beforeAll(() => { (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
  afterAll(() => { (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false; });
  let root: Root;
  afterEach(async () => {
    await act(async () => root.unmount());
  });

  it('adds a field where the caret is, without jumping to the top, and keeps the place when a section is added', async () => {
    await page.viewport(1200, 700);
    const host = document.createElement('div');
    host.style.height = '680px';
    document.body.replaceChildren(host);
    root = createRoot(host);
    const persist = vi.fn(async () => ({ revision: 2 }));
    await act(async () => root.render(
      <OakDocDocumentHost
        entityKey="partial:test"
        baseRevision={1}
        title="Test partial"
        readOnly={false}
        description="Word partial"
        loadingLabel="Loading"
        load={async () => docx()}
        persist={persist}
        cleanup={(bytes) => pruneDeletedOakDocFields(bytes, OAKDOC_FIELD_TAGS)}
        fieldBlocks
        renderSidebar={(api) => (
          <OakDocFieldPanel
            presentTags={api.fieldTags}
            onInsert={(field) => void api.insertField(field)}
            disabled={api.disabled}
            customFields={[]}
            onCustomFieldsChange={vi.fn()}
            repeaterTags={api.repeaters.tags}
            repeaterCount={api.repeaters.count}
            onAddRepeater={(definition) => void api.addRepeater(definition)}
            onRemoveRepeaterAtCaret={() => void api.removeRepeaterAtCaret()}
            sections={{ names: {}, shortlists: {} }}
            onSectionsChange={vi.fn()}
          />
        )}
      />,
    ));
    await waitFor(() => Boolean(scroller() && scroller().scrollHeight > scroller().clientHeight + 500), 'the document');

    // Scroll well down the page and click into a paragraph there.
    scroller().scrollTop = 1200;
    await new Promise((resolve) => setTimeout(resolve, 300));
    // A paragraph in the middle of the viewport.
    const view = scroller().getBoundingClientRect();
    let target: HTMLElement | null = null;
    for (let y = view.top + view.height / 2; !target && y < view.bottom; y += 8) {
      target = document.elementFromPoint(view.left + 200, y)?.closest<HTMLElement>('[data-paragraph-id][data-start]') ?? null;
    }
    if (!target) throw new Error('No paragraph in view');
    const paragraphText = Array.from(document.querySelectorAll<HTMLElement>(
      `[data-paragraph-id="${CSS.escape(target.dataset.paragraphId!)}"][data-start]`,
    )).map((element) => element.textContent).join('');
    const number = /Paragraph (\d+) of/.exec(paragraphText)?.[1];
    if (!number) throw new Error(`Unexpected paragraph text: ${paragraphText}`);
    await userEvent.click(target);
    await userEvent.keyboard('{End}');
    const before = scroller().scrollTop;
    expect(before).toBeGreaterThan(500);

    await act(async () => userEvent.click(screen.getByRole('button', { name: /^Company/ })));
    await act(async () => userEvent.click(screen.getByRole('button', { name: 'Company Name' })));
    await act(async () => userEvent.click(screen.getByRole('button', { name: 'Add Company Name' })));
    await waitFor(() => screen.queryByText('1 in document') !== null, 'the insert');
    expect(Math.abs(scroller().scrollTop - before)).toBeLessThan(150);

    // Making the paragraph repeat remounts the document; the page stays put.
    await act(async () => userEvent.click(screen.getByRole('button', { name: /^Repeating sections/ })));
    await act(async () => userEvent.click(screen.getByRole('button', { name: 'Directors' })));
    await act(async () => userEvent.click(screen.getByRole('button', { name: 'Add Directors section' })));
    await waitFor(() => screen.queryByRole('list', { name: 'Directors sections' }) !== null, 'the section');
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(Math.abs(scroller().scrollTop - before)).toBeLessThan(150);

    // The field sits at the end of the clicked paragraph.
    const saved = await (async () => {
      await act(async () => userEvent.click(screen.getByRole('button', { name: 'Save DOCX' })));
      await waitFor(() => persist.mock.calls.length > 0, 'the save');
      return (persist.mock.calls[0] as unknown[])[0] as Uint8Array;
    })();
    const xml = strFromU8(unzipSync(saved)['word/document.xml']);
    expect(xml).toMatch(new RegExp(`Paragraph ${number} of the resolution</w:t></w:r><w:sdt>.*?<w:tag w:val="company\\.name"/>`));
  });
});
