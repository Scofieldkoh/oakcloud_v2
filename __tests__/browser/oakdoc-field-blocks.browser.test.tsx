import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { strFromU8, unzipSync, zipSync, strToU8 } from 'fflate';
import { OakDocDocumentHost } from '@/components/documents/oakdoc/oakdoc-document-host';
import { pruneDeletedOakDocFields } from '@/lib/document-editor/oakdoc-fields';
import { OAKDOC_FIELD_TAGS } from '@/lib/document-editor/oakdoc-field-registry';
import { OAKDOC_FIELD_DRAG_TYPE } from '@/lib/document-editor/oakdoc-field-blocks';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';

function field(tag: string, id: number) {
  return `<w:sdt><w:sdtPr><w:alias w:val="${tag}"/><w:tag w:val="${tag}"/><w:id w:val="${id}"/></w:sdtPr>`
    + `<w:sdtContent><w:r><w:t>{{${tag}}}</w:t></w:r></w:sdtContent></w:sdt>`;
}

function docx(): Uint8Array {
  const body = '<w:p w14:paraId="00000001"><w:r><w:t>Top line</w:t></w:r></w:p>'
    + `<w:p w14:paraId="11111111"><w:r><w:t xml:space="preserve">RESOLVED that </w:t></w:r>${field('company.name', 5)}`
    + '<w:r><w:t xml:space="preserve"> ends</w:t></w:r></w:p>';
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/document.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${W}" xmlns:w14="${W14}"><w:body>${body}<w:sectPr/></w:body></w:document>`),
    'word/_rels/document.xml.rels': strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>'),
  });
}

function bodyXml(bytes: Uint8Array): string {
  const xml = strFromU8(unzipSync(bytes)['word/document.xml']);
  return xml.slice(xml.indexOf('<w:body>'), xml.indexOf('<w:sectPr'));
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const unmounts: Array<() => void> = [];
afterEach(() => {
  while (unmounts.length > 0) unmounts.pop()!();
});

async function mountHost() {
  const host = document.createElement('div');
  host.style.height = '700px';
  host.style.width = '1000px';
  document.body.appendChild(host);
  const persist = vi.fn(async (_bytes: Uint8Array) => ({ revision: 2 }));
  const root = createRoot(host);
  unmounts.push(() => {
    root.unmount();
    host.remove();
  });
  await act(async () => {
    root.render(
      <OakDocDocumentHost
        entityKey="partial:blocks"
        baseRevision={1}
        title="Blocks"
        readOnly={false}
        description="Word partial"
        loadingLabel="Loading…"
        load={async () => docx()}
        persist={persist}
        cleanup={(bytes) => pruneDeletedOakDocFields(bytes, OAKDOC_FIELD_TAGS)}
        fieldBlocks
      />,
    );
  });
  for (let i = 0; i < 100 && !host.querySelector('[data-paragraph-id]'); i += 1) await wait(50);
  await wait(200);
  const span = (text: string) => Array.from(host.querySelectorAll<HTMLElement>('span[data-start]'))
    .find((element) => element.textContent?.includes(text))!;
  const save = async () => {
    await userEvent.click(host.querySelector('button')!);
    await wait(300);
    return bodyXml(persist.mock.calls.at(-1)![0]);
  };
  return { host, span, save };
}

describe('OakDoc field blocks', () => {
  it('blocks typing inside a field and moves text typed at its edge out of it', async () => {
    const { span, save } = await mountHost();
    await userEvent.click(span('{{company.name}}'));
    await wait(100);
    await userEvent.keyboard('{ArrowLeft}{ArrowRight}{ArrowRight}XY');
    await userEvent.click(span('ends'));
    await userEvent.keyboard('{End}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}Z');
    const saved = await save();
    expect(saved).not.toContain('XY');
    expect(saved).toContain('<w:t>{{company.name}}</w:t></w:r></w:sdtContent></w:sdt><w:r><w:t>Z</w:t></w:r>');
  });

  it('removes the whole field on Backspace right after it', async () => {
    const { span, save } = await mountHost();
    await userEvent.click(span('ends'));
    await userEvent.keyboard('{End}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{Backspace}');
    await wait(500);
    await userEvent.click(span('Top'));
    await userEvent.keyboard('Q');
    const saved = await save();
    expect(saved).not.toContain('<w:sdt>');
    expect(saved).not.toContain('company.name');
    expect(saved).toContain('RESOLVED that ');
  });

  it('moves a clicked field with cut and paste and leaves no empty field behind', async () => {
    const { span, save } = await mountHost();
    await userEvent.click(span('{{company.name}}'));
    await wait(100);
    await userEvent.keyboard('{Control>}x{/Control}');
    await wait(500);
    await userEvent.click(span('Top'));
    await userEvent.keyboard('{Home}{Control>}v{/Control}');
    await wait(300);
    const saved = await save();
    expect(saved.match(/<w:sdt>/g)).toHaveLength(1);
    expect(saved).not.toContain('<w:sdtContent/>');
    expect(saved.indexOf('{{company.name}}')).toBeLessThan(saved.indexOf('Top line'));
  });

  it('inserts a field dragged from the field list where it is dropped', async () => {
    const { span, save } = await mountHost();
    const target = span('Top');
    target.scrollIntoView({ block: 'center' });
    await wait(100);
    const rect = target.getBoundingClientRect();
    const transfer = new DataTransfer();
    transfer.setData(OAKDOC_FIELD_DRAG_TYPE, JSON.stringify({ tag: 'company.uen', label: 'UEN', category: 'Company' }));
    const point = { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: rect.right - 1, clientY: rect.top + rect.height / 2 };
    target.dispatchEvent(new DragEvent('dragover', point));
    target.dispatchEvent(new DragEvent('drop', point));
    await wait(800);
    const saved = await save();
    // Dropped at the end of "Top", the field lands between it and " line".
    expect(saved).toMatch(/Top<\/w:t><\/w:r><w:sdt>.*company\.uen.*<w:t xml:space="preserve"> line/);
  });
});
