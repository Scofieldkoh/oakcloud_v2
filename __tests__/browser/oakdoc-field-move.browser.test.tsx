import { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { DocxEditor, type DocxEditorRef } from '@docx-editor.dev/react';
import { strFromU8, unzipSync, zipSync, strToU8 } from 'fflate';
import { pruneDeletedOakDocFields } from '@/lib/document-editor/oakdoc-fields';
import { OAKDOC_FIELD_TAGS } from '@/lib/document-editor/oakdoc-field-registry';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
function field(tag: string, id: number) {
  return `<w:sdt><w:sdtPr><w:alias w:val="${tag}"/><w:tag w:val="${tag}"/><w:id w:val="${id}"/></w:sdtPr><w:sdtContent><w:r><w:t>{{${tag}}}</w:t></w:r></w:sdtContent></w:sdt>`;
}
function docx(): Uint8Array {
  const body = `<w:p w14:paraId="11111111"><w:r><w:t xml:space="preserve">RESOLVED that </w:t></w:r></w:p>`
    + `<w:p w14:paraId="22222222">${field('selectedContact.name', 5)}<w:r><w:t xml:space="preserve"> and </w:t></w:r>${field('selectedContact.identificationNumber', 6)}</w:p>`;
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/document.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${W}" xmlns:w14="${W14}"><w:body>${body}<w:sectPr/></w:body></w:document>`),
    'word/_rels/document.xml.rels': strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>'),
  });
}

function bodyXml(bytes: Uint8Array): string {
  const xml = strFromU8(unzipSync(bytes)['word/document.xml']);
  return xml.slice(xml.indexOf('<w:body>'));
}

describe('OakDoc field move by cut and paste', () => {
  it('leaves no empty field controls behind once the moved paragraph is saved and pruned', async () => {
    const host = document.createElement('div');
    host.style.height = '800px';
    document.body.appendChild(host);
    const ref = createRef<DocxEditorRef>();
    let ready = false;
    await act(async () => {
      createRoot(host).render(<DocxEditor ref={ref} document={docx()} mode="edit" onReady={() => { ready = true; }} />);
    });
    for (let i = 0; i < 100 && !ready; i += 1) await new Promise((r) => setTimeout(r, 50));

    const first = Array.from(host.querySelectorAll('span, div'))
      .find((el) => el.textContent?.trim() === 'RESOLVED that') as HTMLElement;
    await userEvent.click(first);
    // Cut the field paragraph and paste it at the end of the first one.
    await userEvent.keyboard('{Control>}{Home}{/Control}{ArrowDown}{Home}{Shift>}{End}{/Shift}');
    await userEvent.keyboard('{Control>}x{/Control}');
    await new Promise((r) => setTimeout(r, 200));
    await userEvent.keyboard('{ArrowUp}{End}');
    await userEvent.keyboard('{Control>}v{/Control}');
    await new Promise((r) => setTimeout(r, 300));

    const saved = new Uint8Array((await ref.current!.save())!);
    // The editor itself leaves the cut controls behind as empty shells.
    expect(bodyXml(saved)).toContain('<w:sdtContent/>');

    const cleaned = pruneDeletedOakDocFields(saved, OAKDOC_FIELD_TAGS);
    const output = bodyXml(cleaned.bytes);
    expect(cleaned.removed).toBe(2);
    expect(output).not.toContain('<w:sdtContent/>');
    expect(output.match(/\{\{selectedContact\.name\}\}/g)).toHaveLength(1);
    expect(output.match(/\{\{selectedContact\.identificationNumber\}\}/g)).toHaveLength(1);
  });
});
