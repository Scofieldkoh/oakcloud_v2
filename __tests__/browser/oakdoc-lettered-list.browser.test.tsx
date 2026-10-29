import { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { DocxEditor, type DocxEditorRef } from '@docx-editor.dev/react';
import { strFromU8, unzipSync, zipSync, strToU8 } from 'fflate';
import '@docx-editor.dev/core/styles/editor.css';
import { OakDocLetteredListButton } from '@/components/documents/oakdoc/oakdoc-lettered-list';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';

function paragraph(id: string, text: string): string {
  return `<w:p w14:paraId="${id}"><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

function docx(): Uint8Array {
  const body = paragraph('11111111', 'RESOLVED that')
    + paragraph('22222222', 'the resignation be accepted; or')
    + paragraph('33333333', 'the appointment be terminated.')
    + paragraph('44444444', 'Closing words');
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/document.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${W}" xmlns:w14="${W14}"><w:body>${body}<w:sectPr/></w:body></w:document>`),
    'word/_rels/document.xml.rels': strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>'),
  });
}

function textElement(host: HTMLElement, text: string): HTMLElement {
  return Array.from(host.querySelectorAll('span, div'))
    .find((el) => el.textContent?.trim() === text) as HTMLElement;
}

describe('OakDoc lettered list button', () => {
  it('sits next to Numbered list and letters the selected paragraphs (a), (b) at the top level', async () => {
    await page.viewport(1400, 900);
    const host = document.createElement('div');
    host.style.height = '800px';
    host.style.width = '1400px';
    document.body.appendChild(host);
    const ref = createRef<DocxEditorRef>();
    let ready = false;
    let changes = 0;
    await act(async () => {
      createRoot(host).render(
        <DocxEditor
          ref={ref}
          document={docx()}
          mode="edit"
          onReady={() => { ready = true; }}
          onChange={() => { changes += 1; }}
        >
          <OakDocLetteredListButton />
        </DocxEditor>,
      );
    });
    for (let i = 0; i < 100 && !ready; i += 1) await new Promise((r) => setTimeout(r, 50));

    const numbered = host.querySelector('[data-testid="docx-toolbar"] button[data-slot="list.numbered"]');
    const button = host.querySelector<HTMLButtonElement>('button[data-slot="oakdoc.list.lettered"]');
    expect(button).not.toBeNull();
    expect(numbered?.nextElementSibling?.contains(button)).toBe(true);

    await userEvent.click(textElement(host, 'the resignation be accepted; or'));
    await userEvent.keyboard('{Home}{Shift>}{ArrowDown}{End}{/Shift}');
    const before = changes;
    await userEvent.click(button!);
    await new Promise((r) => setTimeout(r, 300));
    expect(changes).toBeGreaterThan(before);

    const files = unzipSync(new Uint8Array((await ref.current!.save())!));
    const body = strFromU8(files['word/document.xml']);
    const numbering = strFromU8(files['word/numbering.xml']);
    const numIds = [...body.matchAll(/<w:numId w:val="(\d+)"\/>/g)].map((match) => match[1]);
    expect(numIds).toHaveLength(2);
    expect(new Set(numIds).size).toBe(1);
    expect(body).not.toMatch(/<w:ilvl w:val="[1-9]"\/>/);
    expect(numbering).toContain('<w:numFmt w:val="lowerLetter"/>');
    expect(numbering).toContain('<w:lvlText w:val="(%1)"/>');
    // The surrounding paragraphs stay out of the list.
    expect(body.split('RESOLVED that')[0]).not.toContain('<w:numPr>');
    expect(body.split('the appointment be terminated.')[1]).not.toContain('<w:numPr>');
  });
});
