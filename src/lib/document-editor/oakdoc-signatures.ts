import { strFromU8, unzipSync, zipSync } from 'fflate';
import { encodeOakDocZipText } from '@/lib/document-editor/oakdoc-zip';
import {
  WORD_NS,
  findParagraphById,
  getWordVal,
  setWordVal,
  wordChild,
  wordChildren,
} from '@/lib/document-editor/oakdoc-blocks';

const DOCUMENT_PART = 'word/document.xml';
const SIGNATURE_TAG_PREFIX = 'oakdoc.signature.v1.';

export type OakDocSignatureKind =
  | 'provider'
  | 'clientAcceptance'
  | 'sowClient'
  | 'authorisedRepresentativeSpecimen';

export interface OakDocSignatureDefinition {
  kind: OakDocSignatureKind;
  tag: string;
  label: string;
  role: 'provider' | 'client' | 'authorisedRepresentative';
  purpose: 'agreement' | 'statementOfWork' | 'specimen';
}

export interface OakDocSignatureMarker extends OakDocSignatureDefinition {
  controlId?: string;
  paraId?: string;
}

export interface OakDocSignatureSummary {
  count: number;
  tags: string[];
  markers: OakDocSignatureMarker[];
}

export const OAKDOC_SIGNATURE_DEFINITIONS: readonly OakDocSignatureDefinition[] = [
  {
    kind: 'provider',
    tag: SIGNATURE_TAG_PREFIX + 'provider',
    label: 'Oaktree / provider signature',
    role: 'provider',
    purpose: 'agreement',
  },
  {
    kind: 'clientAcceptance',
    tag: SIGNATURE_TAG_PREFIX + 'client-acceptance',
    label: 'Client acceptance signature',
    role: 'client',
    purpose: 'agreement',
  },
  {
    kind: 'sowClient',
    tag: SIGNATURE_TAG_PREFIX + 'sow-client',
    label: 'SOW client signature',
    role: 'client',
    purpose: 'statementOfWork',
  },
  {
    kind: 'authorisedRepresentativeSpecimen',
    tag: SIGNATURE_TAG_PREFIX + 'authorised-representative-specimen',
    label: 'Authorised representative specimen signature',
    role: 'authorisedRepresentative',
    purpose: 'specimen',
  },
] as const;

export const OAKDOC_SIGNATURE_BY_TAG = new Map(
  OAKDOC_SIGNATURE_DEFINITIONS.map((definition) => [definition.tag, definition]),
);

export const OAKDOC_SIGNATURE_TAGS = new Set(
  OAKDOC_SIGNATURE_DEFINITIONS.map((definition) => definition.tag),
);

function parseXml(bytes: Uint8Array): XMLDocument {
  const parser = new DOMParser();
  const xml = parser.parseFromString(strFromU8(bytes), 'application/xml');
  if (xml.getElementsByTagName('parsererror').length > 0) {
    throw new Error('OakDoc could not parse WordprocessingML.');
  }
  return xml;
}

function serializeXml(xml: XMLDocument): Uint8Array<ArrayBuffer> {
  return encodeOakDocZipText(new XMLSerializer().serializeToString(xml));
}

function contentControlTag(sdt: Element): string {
  const properties = wordChild(sdt, 'sdtPr');
  return properties ? getWordVal(wordChild(properties, 'tag')) : '';
}

function contentControlId(sdt: Element): string {
  const properties = wordChild(sdt, 'sdtPr');
  return properties ? getWordVal(wordChild(properties, 'id')) : '';
}

function nextContentControlId(xml: XMLDocument): string {
  const used = Array.from(xml.getElementsByTagNameNS(WORD_NS, 'id'))
    .map((element) => Number(getWordVal(element)))
    .filter((value) => Number.isInteger(value) && value > 0);
  const max = used.length > 0 ? Math.max(...used) : 1000;
  return String(max >= 2_000_000_000 ? 1001 : max + 1);
}

function createMarkerControl(
  xml: XMLDocument,
  definition: OakDocSignatureDefinition,
): Element {
  const sdt = xml.createElementNS(WORD_NS, 'w:sdt');
  const properties = xml.createElementNS(WORD_NS, 'w:sdtPr');

  const alias = xml.createElementNS(WORD_NS, 'w:alias');
  setWordVal(alias, definition.label);
  properties.appendChild(alias);

  const tag = xml.createElementNS(WORD_NS, 'w:tag');
  setWordVal(tag, definition.tag);
  properties.appendChild(tag);

  const id = xml.createElementNS(WORD_NS, 'w:id');
  setWordVal(id, nextContentControlId(xml));
  properties.appendChild(id);

  const content = xml.createElementNS(WORD_NS, 'w:sdtContent');
  const run = xml.createElementNS(WORD_NS, 'w:r');
  const text = xml.createElementNS(WORD_NS, 'w:t');
  text.textContent = `[Signature: ${definition.label}]`;
  run.appendChild(text);
  content.appendChild(run);

  sdt.appendChild(properties);
  sdt.appendChild(content);
  return sdt;
}

function paragraphId(paragraph: Element): string | undefined {
  const value = (
    paragraph.getAttribute('w14:paraId')
    || paragraph.getAttributeNS(
      'http://schemas.microsoft.com/office/word/2010/wordml',
      'paraId',
    )
    || ''
  ).toUpperCase();
  return value || undefined;
}

export function createOakDocSignatureMarker(input: {
  docxBytes: Uint8Array;
  paraId: string;
  definition: OakDocSignatureDefinition;
}): { bytes: Uint8Array; marker: OakDocSignatureMarker } {
  const files = unzipSync(input.docxBytes);
  const documentPart = files[DOCUMENT_PART];
  if (!documentPart) throw new Error('This DOCX has no word/document.xml part.');

  const definition = OAKDOC_SIGNATURE_BY_TAG.get(input.definition.tag);
  if (!definition || definition.kind !== input.definition.kind) {
    throw new Error('This signature marker definition is not managed by OakDoc.');
  }

  const xml = parseXml(documentPart);
  const paragraph = findParagraphById(xml, input.paraId);
  if (!paragraph) {
    throw new Error('OakDoc could not map the current caret back to a Word paragraph.');
  }

  const markerControl = createMarkerControl(xml, definition);
  paragraph.appendChild(markerControl);
  files[DOCUMENT_PART] = serializeXml(xml);

  return {
    bytes: zipSync(files, { level: 6 }),
    marker: {
      ...definition,
      controlId: contentControlId(markerControl),
      paraId: paragraphId(paragraph),
    },
  };
}

export function inspectOakDocSignatureMarkers(
  docxBytes: Uint8Array,
): OakDocSignatureSummary {
  const files = unzipSync(docxBytes);
  const documentPart = files[DOCUMENT_PART];
  if (!documentPart) return { count: 0, tags: [], markers: [] };

  const xml = parseXml(documentPart);
  const markers: OakDocSignatureMarker[] = [];

  for (const sdt of Array.from(xml.getElementsByTagNameNS(WORD_NS, 'sdt'))) {
    const definition = OAKDOC_SIGNATURE_BY_TAG.get(contentControlTag(sdt));
    if (!definition) continue;
    let parent = sdt.parentElement;
    while (parent && (parent.namespaceURI !== WORD_NS || parent.localName !== 'p')) {
      parent = parent.parentElement;
    }
    markers.push({
      ...definition,
      controlId: contentControlId(sdt) || undefined,
      paraId: parent ? paragraphId(parent) : undefined,
    });
  }

  return {
    count: markers.length,
    tags: Array.from(new Set(markers.map((marker) => marker.tag))).sort(),
    markers,
  };
}

export function removeOakDocSignatureMarker(input: {
  docxBytes: Uint8Array;
  paraId: string;
  tag?: string;
}): { bytes: Uint8Array; removed: OakDocSignatureMarker } {
  const files = unzipSync(input.docxBytes);
  const documentPart = files[DOCUMENT_PART];
  if (!documentPart) throw new Error('This DOCX has no word/document.xml part.');

  if (input.tag && !OAKDOC_SIGNATURE_TAGS.has(input.tag)) {
    throw new Error('This signature marker is not managed by OakDoc.');
  }

  const xml = parseXml(documentPart);
  const paragraph = findParagraphById(xml, input.paraId);
  if (!paragraph) {
    throw new Error('OakDoc could not map the current caret back to a Word paragraph.');
  }

  const marker = Array.from(paragraph.getElementsByTagNameNS(WORD_NS, 'sdt'))
    .find((candidate) => {
      const tag = contentControlTag(candidate);
      return OAKDOC_SIGNATURE_TAGS.has(tag) && (!input.tag || tag === input.tag);
    });
  if (!marker?.parentNode) {
    throw new Error('The current paragraph does not contain an OakDoc signature marker.');
  }

  const definition = OAKDOC_SIGNATURE_BY_TAG.get(contentControlTag(marker));
  if (!definition) {
    throw new Error('The signature marker definition is unavailable.');
  }
  const removed: OakDocSignatureMarker = {
    ...definition,
    controlId: contentControlId(marker) || undefined,
    paraId: paragraphId(paragraph),
  };

  marker.parentNode.removeChild(marker);

  // Preserve Word's minimum paragraph structure if a malformed imported marker
  // was the paragraph's only child.
  if (wordChildren(paragraph).length === 0) {
    paragraph.appendChild(xml.createElementNS(WORD_NS, 'w:r'));
  }

  files[DOCUMENT_PART] = serializeXml(xml);
  return {
    bytes: zipSync(files, { level: 6 }),
    removed,
  };
}
