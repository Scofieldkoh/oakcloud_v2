import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { page, userEvent } from 'vitest/browser';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
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
  const paragraphs = Array.from({ length: 3 }, (_, index) => {
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

describe('OakDoc field panel follows the document', () => {
  beforeAll(() => { (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
  afterAll(() => { (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false; });
  let root: Root;
  afterEach(async () => {
    await act(async () => root.unmount());
  });

  it('drops a repeating section from the panel once it is deleted from the page', async () => {
    await page.viewport(1200, 700);
    const host = document.createElement('div');
    host.style.height = '680px';
    document.body.replaceChildren(host);
    root = createRoot(host);
    await act(async () => root.render(
      <OakDocDocumentHost
        entityKey="partial:test"
        baseRevision={1}
        title="Test partial"
        readOnly={false}
        description="Word partial"
        loadingLabel="Loading"
        load={async () => docx()}
        persist={vi.fn(async () => ({ revision: 2 }))}
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
    await waitFor(() => Boolean(scroller()?.textContent?.includes('Paragraph 2 of the resolution')), 'the document');

    const target = Array.from(scroller().querySelectorAll<HTMLElement>('span, div'))
      .filter((element) => element.textContent?.trim() === 'Paragraph 2 of the resolution' && element.offsetParent)
      .at(-1)!;
    await userEvent.click(target);
    await act(async () => userEvent.click(screen.getByRole('button', { name: /^Repeating sections/ })));
    await act(async () => userEvent.click(screen.getByRole('button', { name: 'Directors' })));
    await act(async () => userEvent.click(screen.getByRole('button', { name: 'Add Directors section' })));
    await waitFor(() => Boolean(screen.queryByRole('list', { name: 'Directors sections' })), 'the section in the panel');

    // Select the whole page and delete it.
    const remaining = Array.from(scroller().querySelectorAll<HTMLElement>('span, div'))
      .filter((element) => element.textContent?.trim() === 'Paragraph 1 of the resolution' && element.offsetParent)
      .at(-1)!;
    await userEvent.click(remaining);
    await userEvent.keyboard('{Control>}a{/Control}{Backspace}');
    await waitFor(() => !scroller().textContent?.includes('of the resolution'), 'the page to empty');
    await waitFor(() => !screen.queryByRole('list', { name: 'Directors sections' }), 'the section to leave the panel');
    expect(screen.queryByText('In this document')).not.toBeInTheDocument();
  });
});
