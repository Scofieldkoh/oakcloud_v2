// @vitest-environment jsdom
import { strFromU8, unzipSync, zipSync } from 'fflate';
import { encodeOakDocZipText } from '@/lib/document-editor/oakdoc-zip';
import { describe, expect, it } from 'vitest';
import { buildBlankOakDocBytes } from '@/lib/document-editor/oakdoc-html-import';
import { classifyOakDocTag } from '@/lib/document-editor/oakdoc-field-registry';
import { deriveOakDocTemplateFieldTags } from '@/lib/document-editor/oakdoc-field-manifest';
import { inspectOakDocPartialReferences, oakDocPartialTag } from '@/lib/document-editor/oakdoc-partials';
import {
  OAKDOC_RESOLUTION_ITEMS_TAG,
  composeOakDocResolutions,
  hasOakDocResolutionSlot,
  insertOakDocResolutionSlot,
  readOakDocPlainText,
  unlockOakDocResolutionSlotContent,
  previewOakDocResolutionSlot,
  clearOakDocResolutionSlotPreview,
  RESOLUTION_SLOT_PLACEHOLDER,
} from '@/lib/document-editor/oakdoc-resolutions';
import { APPROVE_SHARE_TRANSFER, LODGEMENT, TRANSFEROR_LIST } from '@/content/secretarial/corp-sec-resolutions';

import { buildBoardResolutionOakDocMaster } from '@/content/resolution/board-resolution-oakdoc';
import { readResolutionPreset, resolutionCompositionIssues } from '@/lib/resolution-composition';
import { inspectOakDocPackage } from '@/lib/document-editor/oakdoc-package-policy';

const PARTIAL = '44444444-4444-4444-8444-444444444444';

function documentXml(bytes: Uint8Array): string {
  return strFromU8(unzipSync(bytes)['word/document.xml']);
}

describe('OakDoc numbered resolutions', () => {
  it('treats the slot as a known structural control, not a field', () => {
    expect(classifyOakDocTag(OAKDOC_RESOLUTION_ITEMS_TAG)).toBe('resolution-slot');
    const master = buildBoardResolutionOakDocMaster();
    expect(() => inspectOakDocPackage(master, 'master')).not.toThrow();
    expect(deriveOakDocTemplateFieldTags(master)).not.toContain(OAKDOC_RESOLUTION_ITEMS_TAG);
    expect(deriveOakDocTemplateFieldTags(master)).toEqual(expect.arrayContaining([
      'company.name', 'company.uen', 'resolution.date', 'repeat.directors', 'director.name', 'director.role',
    ]));
  });

  it('replaces the slot with a subject, numbered headings and bodies in the slot formatting', () => {
    const result = composeOakDocResolutions(buildBoardResolutionOakDocMaster(), {
      subject: 'CHANGE IN COMPANY SECRETARY',
      sections: [
        { id: 'a', kind: 'PARTIAL', heading: 'APPOINTMENT OF SECRETARY', partialId: PARTIAL },
        { id: 'b', kind: 'CUSTOM', heading: 'CORPORATE SERVICE PROVIDER', body: 'RESOLVED that A & B\nbe appointed.\n\nRESOLVED further.' },
      ],
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.partialIds).toEqual([PARTIAL]);
    expect(hasOakDocResolutionSlot(result.bytes)).toBe(false);
    expect(inspectOakDocPartialReferences(result.bytes)).toEqual([PARTIAL]);
    const xml = documentXml(result.bytes);
    expect(xml).toContain(`w:val="${oakDocPartialTag(PARTIAL)}"`);
    expect(xml).toMatch(/<w:b\/>[^]*?CHANGE IN COMPANY SECRETARY/);
    expect(xml).toContain('>1.</w:t><w:tab/><w:t xml:space="preserve">APPOINTMENT OF SECRETARY<');
    expect(xml).toContain('>2.</w:t><w:tab/><w:t xml:space="preserve">CORPORATE SERVICE PROVIDER<');
    expect(xml).toContain('RESOLVED that A &amp; B</w:t><w:br/><w:t xml:space="preserve">be appointed.');
    expect(xml).toContain('Times New Roman');
    expect(xml).toContain('<w:tab w:val="left" w:pos="720"/>');
  });

  it('prints edited partial text as plain paragraphs instead of the partial', () => {
    const result = composeOakDocResolutions(buildBoardResolutionOakDocMaster(), {
      subject: '',
      sections: [
        { id: 'a', kind: 'PARTIAL', heading: 'APPOINTMENT OF SECRETARY', partialId: PARTIAL, body: 'RESOLVED that John Lim be appointed.' },
      ],
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.partialIds).toEqual([]);
    expect(inspectOakDocPartialReferences(result.bytes)).toEqual([]);
    expect(documentXml(result.bytes)).toContain('RESOLVED that John Lim be appointed.');

    expect(resolutionCompositionIssues({
      subject: '',
      sections: [{ id: 'a', kind: 'PARTIAL', heading: 'X', partialId: PARTIAL, body: '  ' }],
    })).toEqual(['Resolution 1 needs its text.']);
  });

  it('reads a document as plain paragraphs with line breaks', () => {
    const composed = composeOakDocResolutions(buildBoardResolutionOakDocMaster(), {
      subject: '',
      sections: [{ id: 'b', kind: 'CUSTOM', heading: 'LODGEMENT', body: 'RESOLVED that A\nbe appointed.\n\nRESOLVED further.' }],
    });
    const text = readOakDocPlainText(composed.bytes);
    expect(text).toContain('1.\tLODGEMENT\n\nRESOLVED that A\nbe appointed.\n\nRESOLVED further.');
    expect(text).toContain('{company.name}\n\n(Registration Number {company.uen})');
  });

  it('reads stored presets and ignores malformed or empty ones', () => {
    const preset = { subject: '', sections: [{ id: 'a', kind: 'PARTIAL', heading: 'X', partialId: PARTIAL }] };
    expect(readResolutionPreset(preset)).toEqual(preset);
    expect(readResolutionPreset({ subject: '', sections: [] })).toBeNull();
    expect(readResolutionPreset({ sections: 'nope' })).toBeNull();
    expect(readResolutionPreset(null)).toBeNull();
  });

  it('reports a master without the slot', () => {
    const result = composeOakDocResolutions(buildBlankOakDocBytes(), {
      subject: '',
      sections: [{ id: 'a', kind: 'CUSTOM', heading: 'X', body: 'Y' }],
    });
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'OAKDOC_RESOLUTION_SLOT_MISSING', severity: 'error' })]);
  });

  it('inserts one slot after the caret paragraph, keeping its formatting', () => {
    const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
    const files = unzipSync(buildBlankOakDocBytes());
    files['word/document.xml'] = encodeOakDocZipText(
      `<w:document xmlns:w="${W}" xmlns:w14="${W14}"><w:body>`
      + '<w:p w14:paraId="0A1B2C3D"><w:pPr><w:jc w:val="both"/></w:pPr><w:r><w:t>Intro</w:t></w:r></w:p>'
      + '<w:p w14:paraId="0A1B2C3E"><w:r><w:t>Closing</w:t></w:r></w:p>'
      + '<w:sectPr/></w:body></w:document>',
    );
    const master = zipSync(files);
    const inserted = insertOakDocResolutionSlot({ docxBytes: master, paraId: '0a1b2c3d' });
    expect(hasOakDocResolutionSlot(inserted)).toBe(true);
    const xml = documentXml(inserted);
    expect(xml.indexOf('Intro')).toBeLessThan(xml.indexOf('Numbered resolutions'));
    expect(xml.indexOf('Numbered resolutions')).toBeLessThan(xml.indexOf('Closing'));
    expect(xml.split('<w:jc w:val="both"/>').length - 1).toBe(2);
    expect(xml).toContain('<w:lock w:val="sdtLocked"/>');
    expect(() => insertOakDocResolutionSlot({ docxBytes: inserted, paraId: '0a1b2c3d' }))
      .toThrow('already has the numbered resolutions');
  });

  it('lets the placeholder be restyled, and the resolutions follow its font', () => {
    const master = buildBoardResolutionOakDocMaster();
    expect(documentXml(master)).toContain('<w:lock w:val="sdtLocked"/>');
    expect(unlockOakDocResolutionSlotContent(master)).toBe(master);

    // A slot saved before this change locked its content too.
    const files = unzipSync(master);
    files['word/document.xml'] = encodeOakDocZipText(documentXml(master)
      .replace('<w:lock w:val="sdtLocked"/>', '<w:lock w:val="sdtContentLocked"/>')
      .replace(/(<w:sdtContent><w:p>(?:<w:pPr>.*?<\/w:pPr>)?<w:r>)(?:<w:rPr>.*?<\/w:rPr>)?/, '$1<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/></w:rPr>'));
    const legacy = zipSync(files);
    const unlocked = documentXml(unlockOakDocResolutionSlotContent(legacy));
    expect(unlocked).toContain('<w:lock w:val="sdtLocked"/>');
    expect(unlocked).not.toContain('sdtContentLocked');

    const result = composeOakDocResolutions(legacy, {
      subject: '',
      sections: [{ id: 'a', kind: 'CUSTOM', heading: 'BANK ACCOUNT', body: 'RESOLVED that an account be opened.' }],
    });
    expect(documentXml(result.bytes)).toMatch(/w:ascii="Arial"[^]*?RESOLVED that an account be opened\./);
  });

  it('previews a preset partial with its own fields and sections, and clears the preview before saving', () => {
    const master = buildBoardResolutionOakDocMaster();
    const transfer = APPROVE_SHARE_TRANSFER.build().bytes;
    const previewed = previewOakDocResolutionSlot(master, [
      { heading: 'TRANSFER OF SHARES', text: 'fallback text', partial: { id: '77777777-7777-4777-8777-777777777777', bytes: transfer } },
      { heading: 'NOTIFICATION AND LODGEMENT', text: '', partial: { id: '77777777-7777-4777-8777-777777777778', bytes: LODGEMENT.build().bytes } },
    ]);
    const xml = documentXml(previewed);
    expect(xml).not.toContain('fallback text');
    expect(xml).toContain('w:val="contact.name"');
    expect(xml).toContain('w:val="item.shares"');
    expect(xml).toContain(`repeat.contacts.${TRANSFEROR_LIST.toLowerCase()}`);
    expect(xml).toContain('>2.</w:t><w:tab/><w:t xml:space="preserve">NOTIFICATION AND LODGEMENT<');

    const cleared = clearOakDocResolutionSlotPreview(previewed);
    expect(documentXml(cleared)).toContain(RESOLUTION_SLOT_PLACEHOLDER);
    expect(documentXml(cleared)).not.toContain('item.shares');
    expect(deriveOakDocTemplateFieldTags(cleared)).toEqual(deriveOakDocTemplateFieldTags(master));
    // A plain slot is left as it is.
    expect(clearOakDocResolutionSlotPreview(master)).toBe(master);
  });

  it('previews preset resolutions in the slot without changing what generation prints', () => {
    const master = buildBoardResolutionOakDocMaster();
    const previewed = previewOakDocResolutionSlot(master, [
      { heading: 'APPOINTMENT OF SECRETARY', text: 'RESOLVED that X be appointed.\n\nRESOLVED further.' },
      { heading: 'NOTICE AND LODGEMENT', text: '' },
    ]);
    const xml = documentXml(previewed);
    expect(hasOakDocResolutionSlot(previewed)).toBe(true);
    expect(xml).toContain('Preset resolutions, which can still be changed');
    expect(xml).not.toContain(RESOLUTION_SLOT_PLACEHOLDER);
    expect(xml).toContain('>1.</w:t><w:tab/><w:t xml:space="preserve">APPOINTMENT OF SECRETARY<');
    expect(xml).toContain('>2.</w:t><w:tab/><w:t xml:space="preserve">NOTICE AND LODGEMENT<');
    expect(xml).toContain('RESOLVED that X be appointed.');
    expect(deriveOakDocTemplateFieldTags(previewed)).toEqual(deriveOakDocTemplateFieldTags(master));

    // Clearing the preset restores the placeholder, and generation output is the same either way.
    expect(documentXml(previewOakDocResolutionSlot(previewed, []))).toContain(RESOLUTION_SLOT_PLACEHOLDER);
    const composition = {
      subject: '',
      sections: [{ id: 'a', kind: 'CUSTOM' as const, heading: 'BANK ACCOUNT', body: 'RESOLVED that an account be opened.' }],
    };
    const fromMaster = documentXml(composeOakDocResolutions(master, composition).bytes);
    const fromPreview = documentXml(composeOakDocResolutions(previewed, composition).bytes);
    const body = (value: string) => value.slice(value.indexOf('BANK ACCOUNT') - 400, value.indexOf('account be opened') + 40);
    expect(body(fromPreview)).toEqual(body(fromMaster));
  });

  it('lists what Configure still needs', () => {
    expect(resolutionCompositionIssues(null)).toEqual(['Add at least one resolution.']);
    expect(resolutionCompositionIssues({
      subject: '',
      sections: [
        { id: 'a', kind: 'PARTIAL', heading: ' ', partialId: PARTIAL },
        { id: 'b', kind: 'CUSTOM', heading: 'B', body: '\n\n' },
      ],
    })).toEqual(['Resolution 1 needs a heading.', 'Resolution 2 needs its text.']);
  });
});
