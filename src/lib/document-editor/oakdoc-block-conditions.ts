import { strFromU8, unzipSync, zipSync } from 'fflate';
import { encodeOakDocZipText } from '@/lib/document-editor/oakdoc-zip';
import {
  WORD_NS,
  closestWordElement,
  findParagraphById,
  getWordVal,
  resolveOakDocBlockRange,
  wordChild,
  type OakDocBlockRangeKind,
} from '@/lib/document-editor/oakdoc-blocks';
import {
  createOakDocCondition,
  type OakDocConditionDefinition,
  type OakDocConditionInstance,
} from '@/lib/document-editor/oakdoc-conditions';

const DOCUMENT_PART = 'word/document.xml';
const CONDITION_TAG_PREFIX = 'oakdoc.condition.';

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

function controlTag(sdt: Element): string {
  const properties = wordChild(sdt, 'sdtPr');
  const tag = properties ? wordChild(properties, 'tag') : undefined;
  return tag
    ? (tag.getAttributeNS(WORD_NS, 'val') || tag.getAttribute('w:val') || getWordVal(tag))
    : '';
}

function closestCondition(start: Element): Element | undefined {
  let current: Element | null = start.parentElement;
  while (current) {
    if (
      current.namespaceURI === WORD_NS
      && current.localName === 'sdt'
      && controlTag(current).startsWith(CONDITION_TAG_PREFIX)
    ) {
      return current;
    }
    current = current.parentElement;
  }
  return undefined;
}

function directChildWithin(start: Element, parent: Node): Element | undefined {
  let current: Element | null = start;
  while (current?.parentNode && current.parentNode !== parent) {
    current = current.parentElement;
  }
  return current?.parentNode === parent ? current : undefined;
}

/**
 * Create an OakDoc condition over a conservative multi-block range while
 * preserving the existing condition metadata format and resolver.
 */
export function createOakDocBlockCondition(input: {
  docxBytes: Uint8Array;
  fromParaId: string;
  toParaId?: string;
  condition: OakDocConditionDefinition;
  allowedFields: ReadonlySet<string>;
}): {
  bytes: Uint8Array;
  condition: OakDocConditionInstance;
  targetKind: OakDocBlockRangeKind;
} {
  const files = unzipSync(input.docxBytes);
  const part = files[DOCUMENT_PART];
  if (!part) throw new Error('This DOCX has no word/document.xml part.');

  const sourceXml = parseXml(part);
  const sourceFrom = findParagraphById(sourceXml, input.fromParaId);
  const sourceTo = findParagraphById(sourceXml, input.toParaId || input.fromParaId);
  if (!sourceFrom || !sourceTo) {
    throw new Error('OakDoc could not map the current selection back to a Word paragraph.');
  }

  const range = resolveOakDocBlockRange(sourceFrom, sourceTo);
  const created = createOakDocCondition({
    docxBytes: input.docxBytes,
    fromParaId: input.fromParaId,
    condition: input.condition,
    allowedFields: input.allowedFields,
  });
  if (range.nodes.length === 1) {
    return {
      bytes: created.bytes,
      condition: created.condition,
      targetKind: range.kind,
    };
  }

  const createdFiles = unzipSync(created.bytes);
  const createdPart = createdFiles[DOCUMENT_PART];
  if (!createdPart) throw new Error('OakDoc condition output lost word/document.xml.');

  const xml = parseXml(createdPart);
  const from = findParagraphById(xml, input.fromParaId);
  const to = findParagraphById(xml, input.toParaId || input.fromParaId);
  if (!from || !to) {
    throw new Error('OakDoc could not relocate the selected condition range.');
  }

  const wrapper = closestCondition(from);
  const content = wrapper ? wordChild(wrapper, 'sdtContent') : undefined;
  const parent = wrapper?.parentNode;
  if (!wrapper || !content || !parent) {
    throw new Error('OakDoc could not locate the new conditional block.');
  }

  let endTarget: Element | undefined;
  if (range.kind === 'table row range') {
    endTarget = closestWordElement(to, 'tr');
  } else {
    endTarget = directChildWithin(to, parent);
  }
  if (!endTarget || endTarget.parentNode !== parent) {
    throw new Error('OakDoc could not safely extend the conditional block.');
  }

  let current = wrapper.nextSibling;
  let reachedEnd = false;
  while (current) {
    const next = current.nextSibling;
    if (current.nodeType === Node.ELEMENT_NODE) {
      const element = current as Element;
      content.appendChild(element);
      if (element === endTarget) {
        reachedEnd = true;
        break;
      }
    }
    current = next;
  }

  if (!reachedEnd) {
    throw new Error('OakDoc could not safely collect the selected conditional range.');
  }

  createdFiles[DOCUMENT_PART] = serializeXml(xml);
  return {
    bytes: zipSync(createdFiles, { level: 6 }),
    condition: created.condition,
    targetKind: range.kind,
  };
}
