// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';

import { createDocxFixture } from '../helpers/docx-fixture';
import {
  createOakDocSignatureMarker,
  inspectOakDocSignatureMarkers,
  OAKDOC_SIGNATURE_DEFINITIONS,
  removeOakDocSignatureMarker,
} from '@/lib/document-editor/oakdoc-signatures';

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WORD14_NS = 'http://schemas.microsoft.com/office/word/2010/wordml';

function docx(body: string): Uint8Array {
  return createDocxFixture({
    'word/document.xml': [
      '<w:document xmlns:w="' + WORD_NS + '" xmlns:w14="' + WORD14_NS + '">',
      '<w:body>' + body + '<w:sectPr/></w:body></w:document>',
    ].join(''),
  });
}

function xml(bytes: Uint8Array): string {
  return strFromU8(unzipSync(bytes)['word/document.xml']);
}

describe('OakDoc signature markers', () => {
  it('creates inspectable stable metadata for every Stage 4 signature concept', () => {
    let bytes = docx(
      '<w:p w14:paraId="A1B2C3D4"><w:r><w:t>Signature area</w:t></w:r></w:p>',
    );

    for (const definition of OAKDOC_SIGNATURE_DEFINITIONS) {
      bytes = createOakDocSignatureMarker({
        docxBytes: bytes,
        paraId: 'A1B2C3D4',
        definition,
      }).bytes;
    }

    const summary = inspectOakDocSignatureMarkers(bytes);
    expect(summary.count).toBe(4);
    expect(summary.tags).toEqual([
      'oakdoc.signature.v1.authorised-representative-specimen',
      'oakdoc.signature.v1.client-acceptance',
      'oakdoc.signature.v1.provider',
      'oakdoc.signature.v1.sow-client',
    ]);
    expect(summary.markers.map((marker) => ({
      kind: marker.kind,
      role: marker.role,
      purpose: marker.purpose,
    }))).toEqual([
      { kind: 'provider', role: 'provider', purpose: 'agreement' },
      { kind: 'clientAcceptance', role: 'client', purpose: 'agreement' },
      { kind: 'sowClient', role: 'client', purpose: 'statementOfWork' },
      {
        kind: 'authorisedRepresentativeSpecimen',
        role: 'authorisedRepresentative',
        purpose: 'specimen',
      },
    ]);
  });

  it('removes only the requested managed marker and preserves surrounding content', () => {
    const provider = OAKDOC_SIGNATURE_DEFINITIONS[0];
    const created = createOakDocSignatureMarker({
      docxBytes: docx(
        '<w:p w14:paraId="B1C2D3E4"><w:r><w:t>Before signature</w:t></w:r></w:p>',
      ),
      paraId: 'B1C2D3E4',
      definition: provider,
    });

    const removed = removeOakDocSignatureMarker({
      docxBytes: created.bytes,
      paraId: 'B1C2D3E4',
      tag: provider.tag,
    });

    expect(removed.removed.kind).toBe('provider');
    expect(inspectOakDocSignatureMarkers(removed.bytes).count).toBe(0);
    expect(xml(removed.bytes)).toContain('Before signature');
  });

  it('ignores malformed or unrelated content controls during inspection', () => {
    const malformed = docx(
      '<w:p w14:paraId="C1D2E3F4">'
      + '<w:sdt><w:sdtPr><w:tag w:val="oakdoc.signature.v1.unknown"/></w:sdtPr>'
      + '<w:sdtContent><w:r><w:t>Unknown marker</w:t></w:r></w:sdtContent></w:sdt>'
      + '<w:sdt><w:sdtContent><w:r><w:t>No properties</w:t></w:r></w:sdtContent></w:sdt>'
      + '</w:p>',
    );

    expect(inspectOakDocSignatureMarkers(malformed)).toEqual({
      count: 0,
      tags: [],
      markers: [],
    });
  });
});
