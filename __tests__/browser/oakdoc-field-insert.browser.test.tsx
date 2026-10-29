import { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { DocxEditor, type DocxEditorRef } from '@docx-editor.dev/react';
import { strFromU8, unzipSync, zipSync, strToU8 } from 'fflate';
import { insertOakDocField } from '@/components/documents/oakdoc/insert-oakdoc-field';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const TIMES_16 = '<w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="32"/></w:rPr>';
const ARIAL_14 = '<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="28"/></w:rPr>';
const DEFAULT_BODY = `<w:p w14:paraId="11111111"><w:r><w:t xml:space="preserve">RESOLVED that the company</w:t></w:r></w:p>`
  + `<w:p w14:paraId="22222222"><w:r><w:t xml:space="preserve">Second paragraph here</w:t></w:r></w:p>`;
function docx(body = DEFAULT_BODY): Uint8Array {
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

async function mountEditor(bytes: Uint8Array) {
  const host = document.createElement('div');
  host.style.height = '800px';
  document.body.appendChild(host);
  const ref = createRef<DocxEditorRef>();
  let ready = false;
  await act(async () => {
    createRoot(host).render(<DocxEditor ref={ref} document={bytes} mode="edit" onReady={() => { ready = true; }} />);
  });
  for (let i = 0; i < 100 && !ready; i += 1) await new Promise((r) => setTimeout(r, 50));
  return { host, ref };
}

describe('OakDoc field insert at the caret', () => {
  it('gives a new field the font and size at the caret, in text or in an empty paragraph', async () => {
    const { host, ref } = await mountEditor(docx(
      `<w:p w14:paraId="11111111"><w:r>${TIMES_16}<w:t xml:space="preserve">RESOLVED that the company</w:t></w:r></w:p>`
      + `<w:p w14:paraId="22222222"><w:pPr>${ARIAL_14}</w:pPr></w:p>`
      + `<w:p w14:paraId="33333333"><w:r><w:t xml:space="preserve">Last paragraph</w:t></w:r></w:p>`,
    ));
    const first = Array.from(host.querySelectorAll('span, div'))
      .filter((el) => el.textContent?.trim() === 'RESOLVED that the company' && (el as HTMLElement).offsetParent)
      .at(-1) as HTMLElement;
    await userEvent.click(first);
    await userEvent.keyboard('{End}');
    await insertOakDocField(ref.current, { tag: 'company.name', label: 'Company name', category: 'Company' });
    await userEvent.keyboard('{ArrowDown}{Home}');
    await insertOakDocField(ref.current, { tag: 'company.uen', label: 'UEN', category: 'Company' });

    const output = bodyXml(new Uint8Array((await ref.current!.save())!)).replace(/<w:sdtPr>.*?<\/w:sdtPr>/g, '');
    expect(output).toContain(`<w:sdt><w:sdtContent><w:r>${TIMES_16}<w:t>{{company.name}}</w:t>`);
    expect(output).toContain(`<w:sdt><w:sdtContent><w:r>${ARIAL_14}<w:t>{{company.uen}}</w:t>`);
  });

  it('fills new fields in place, without a remount, and keeps two fields in a row separate', async () => {
    const { host, ref } = await mountEditor(docx());

    const first = Array.from(host.querySelectorAll('span, div'))
      .find((el) => el.textContent?.trim() === 'RESOLVED that the company') as HTMLElement;
    await userEvent.click(first);
    // Caret after "Second " in the second paragraph.
    await userEvent.keyboard('{ArrowDown}{Home}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}');

    const name = await insertOakDocField(ref.current, { tag: 'company.name', label: 'Company name', category: 'Company' });
    const uen = await insertOakDocField(ref.current, { tag: 'company.uen', label: 'UEN', category: 'Company' });
    expect(name.bytes).toBeNull();
    expect(uen.bytes).toBeNull();
    expect(name.message).toBe('Added Company name field.');

    const output = bodyXml(new Uint8Array((await ref.current!.save())!));
    expect(output).toContain('<w:t xml:space="preserve">Second </w:t>');
    expect(output).toMatch(
      /<w:tag w:val="company\.name"\/>.*?<w:sdtContent><w:r><w:t>\{\{company\.name\}\}<\/w:t><\/w:r><\/w:sdtContent><\/w:sdt><w:sdt>.*?<w:tag w:val="company\.uen"\/>.*?<w:t>\{\{company\.uen\}\}<\/w:t>.*?<w:t>paragraph here<\/w:t>/,
    );
    expect(output).not.toContain('showingPlcHdr');
  });

  it('keeps the chosen text case in the new field\'s Word title', async () => {
    const { host, ref } = await mountEditor(docx());
    const first = Array.from(host.querySelectorAll('span, div'))
      .find((el) => el.textContent?.trim() === 'RESOLVED that the company') as HTMLElement;
    await userEvent.click(first);
    await userEvent.keyboard('{End}');
    await insertOakDocField(ref.current, { tag: 'officer.name', label: 'Officer Name', category: 'Officer', textCase: 'upper' });

    const output = bodyXml(new Uint8Array((await ref.current!.save())!));
    expect(output).toMatch(/<w:alias w:val="Officer Name · UPPERCASE"\/>.*?<w:tag w:val="officer\.name"\/>/);
  });
});
