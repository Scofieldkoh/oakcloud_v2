import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WORD_2010_NS = 'http://schemas.microsoft.com/office/word/2010/wordml';

export interface OakDocSectionTransferRepair {
  targetParagraphId: string;
  sourceParagraphId: string;
}

export interface OakDocSectionTransferRepairResult {
  bytes: Uint8Array;
  restored: number;
  transfers: OakDocSectionTransferRepair[];
}

function parseXml(bytes: Uint8Array): XMLDocument {
  const xml = new DOMParser().parseFromString(strFromU8(bytes), 'application/xml');
  if (xml.getElementsByTagName('parsererror').length > 0) {
    throw new Error('OakDoc could not parse WordprocessingML section structure.');
  }
  return xml;
}

function paragraphId(paragraph: Element): string {
  return (
    paragraph.getAttributeNS(WORD_2010_NS, 'paraId')
    || paragraph.getAttribute('w14:paraId')
    || ''
  ).toUpperCase();
}

function directWordChild(parent: Node, localName: string): Element | undefined {
  return Array.from(parent.childNodes).find(
    (node): node is Element =>
      node.nodeType === Node.ELEMENT_NODE
      && (node as Element).namespaceURI === WORD_NS
      && (node as Element).localName === localName,
  );
}

function paragraphSection(paragraph: Element): Element | undefined {
  const properties = directWordChild(paragraph, 'pPr');
  return properties ? directWordChild(properties, 'sectPr') : undefined;
}

function bodyParagraphs(xml: XMLDocument): Element[] {
  const body = xml.getElementsByTagNameNS(WORD_NS, 'body')[0];
  if (!body) return [];
  return Array.from(body.childNodes).filter(
    (node): node is Element =>
      node.nodeType === Node.ELEMENT_NODE
      && (node as Element).namespaceURI === WORD_NS
      && (node as Element).localName === 'p',
  );
}

function sectionFingerprint(section: Element): string {
  const visit = (element: Element): unknown => ({
    namespace: element.namespaceURI || '',
    name: element.localName,
    attributes: Array.from(element.attributes)
      .filter((attribute) => attribute.namespaceURI !== 'http://www.w3.org/2000/xmlns/')
      .map((attribute) => ({
        namespace: attribute.namespaceURI || '',
        name: attribute.localName,
        value: attribute.value,
      }))
      .sort((left, right) =>
        `${left.namespace}:${left.name}:${left.value}`
          .localeCompare(`${right.namespace}:${right.name}:${right.value}`)),
    children: Array.from(element.children).map(visit),
  });

  return JSON.stringify(visit(section));
}

function zipDocxFiles(files: Record<string, Uint8Array>): Uint8Array {
  const tree: Record<string, unknown> = {};

  for (const [path, bytes] of Object.entries(files)) {
    const parts = path.split('/').filter(Boolean);
    if (parts.length === 0) continue;

    let cursor = tree;
    for (const part of parts.slice(0, -1)) {
      const existing = cursor[part];
      if (!existing || existing instanceof Uint8Array || Array.isArray(existing)) {
        cursor[part] = {};
      }
      cursor = cursor[part] as Record<string, unknown>;
    }
    cursor[parts[parts.length - 1]] = new Uint8Array(bytes);
  }

  return zipSync(tree as Zippable, { level: 6 });
}

function restoreSection(
  paragraph: Element,
  replacement: Element | undefined,
): boolean {
  const properties = directWordChild(paragraph, 'pPr');
  const current = properties ? directWordChild(properties, 'sectPr') : undefined;
  if (!properties || !current) return false;

  if (replacement) {
    properties.replaceChild(
      paragraph.ownerDocument.importNode(replacement, true),
      current,
    );
  } else {
    properties.removeChild(current);
  }
  return true;
}


export function oakDocCaretTouchesSectionBoundary(input: {
  docxBytes: Uint8Array;
  paragraphId: string;
}): boolean {
  const files = unzipSync(input.docxBytes);
  const documentBytes = files['word/document.xml'];
  if (!documentBytes) return false;

  const xml = parseXml(documentBytes);
  const paragraphs = bodyParagraphs(xml);
  const ids = paragraphs.map(paragraphId);
  const targetId = input.paragraphId.toUpperCase();
  const targetIndex = ids.indexOf(targetId);
  if (targetIndex < 0) return false;

  // The public editor snapshot intentionally does not expose a collapsed
  // caret's character offset. Restrict the async post-delete check to the
  // section paragraph itself and its immediate neighbours, which are the only
  // paragraphs a one-key Backspace/Delete can join across that boundary.
  return [targetIndex - 1, targetIndex, targetIndex + 1].some((index) =>
    index >= 0
    && index < paragraphs.length
    && Boolean(paragraphSection(paragraphs[index])),
  );
}

export function oakDocSelectionCrossesSectionBoundary(input: {
  docxBytes: Uint8Array;
  fromParagraphId: string;
  toParagraphId: string;
}): boolean {
  const files = unzipSync(input.docxBytes);
  const documentBytes = files['word/document.xml'];
  if (!documentBytes) return false;

  const xml = parseXml(documentBytes);
  const paragraphs = bodyParagraphs(xml);
  const ids = paragraphs.map(paragraphId);
  const fromId = input.fromParagraphId.toUpperCase();
  const toId = input.toParagraphId.toUpperCase();
  if (!fromId || !toId || fromId === toId) return false;

  const fromIndex = ids.indexOf(fromId);
  const toIndex = ids.indexOf(toId);
  if (fromIndex < 0 || toIndex < 0) return false;

  const first = Math.min(fromIndex, toIndex);
  const last = Math.max(fromIndex, toIndex);

  return paragraphs.some((paragraph, index) =>
    index >= first
    && index <= last
    && Boolean(paragraphSection(paragraph)),
  );
}

/**
 * Repairs the specific @docx-editor.dev paragraph-join mutation where a deleted
 * paragraph's w:sectPr is transferred onto a surviving paragraph and replaces
 * that survivor's pre-existing section definition.
 *
 * The match is deliberately strict:
 * - the target paragraph existed before and still exists after;
 * - it carries a section definition after the edit;
 * - that after definition exactly matches a DIFFERENT section from before;
 * - that source section's paragraph was deleted by the edit;
 * - the target did not already carry that same definition before the edit.
 *
 * If the survivor had its own section definition, restore it. If it had none,
 * remove only the transferred definition. This does not recreate the deleted
 * section paragraph and does not rewrite unrelated section formatting.
 */
export function preserveTransferredOakDocSections(input: {
  beforeBytes: Uint8Array;
  afterBytes: Uint8Array;
}): OakDocSectionTransferRepairResult {
  const beforeFiles = unzipSync(input.beforeBytes);
  const afterFiles = unzipSync(input.afterBytes);
  const beforeDocument = beforeFiles['word/document.xml'];
  const afterDocument = afterFiles['word/document.xml'];

  if (!beforeDocument || !afterDocument) {
    return { bytes: input.afterBytes, restored: 0, transfers: [] };
  }

  const beforeXml = parseXml(beforeDocument);
  const afterXml = parseXml(afterDocument);

  const beforeParagraphs = new Map<string, {
    paragraph: Element;
    section?: Element;
    sectionXml?: string;
  }>();
  const beforeSections = new Map<string, { paragraph: Element; section: Element; xml: string }>();

  for (const paragraph of bodyParagraphs(beforeXml)) {
    const id = paragraphId(paragraph);
    if (!id) continue;

    const section = paragraphSection(paragraph);
    beforeParagraphs.set(id, {
      paragraph,
      ...(section
        ? { section, sectionXml: sectionFingerprint(section) }
        : {}),
    });
    if (section) {
      beforeSections.set(id, {
        paragraph,
        section,
        xml: sectionFingerprint(section),
      });
    }
  }

  if (beforeSections.size === 0) {
    return { bytes: input.afterBytes, restored: 0, transfers: [] };
  }

  const afterParagraphs = bodyParagraphs(afterXml);
  const afterIds = new Set(afterParagraphs.map(paragraphId).filter(Boolean));
  const deletedBeforeSections = Array.from(beforeSections.entries()).filter(
    ([id]) => !afterIds.has(id),
  );

  if (deletedBeforeSections.length === 0) {
    return { bytes: input.afterBytes, restored: 0, transfers: [] };
  }

  const transfers: OakDocSectionTransferRepair[] = [];

  for (const paragraph of afterParagraphs) {
    const targetId = paragraphId(paragraph);
    if (!targetId) continue;

    const ownBefore = beforeParagraphs.get(targetId);
    const afterSection = paragraphSection(paragraph);
    if (!ownBefore || !afterSection) continue;

    const afterSectionXml = sectionFingerprint(afterSection);
    if (afterSectionXml === ownBefore.sectionXml) continue;

    const transferredFrom = deletedBeforeSections.find(
      ([sourceId, source]) =>
        sourceId !== targetId
        && source.xml === afterSectionXml,
    );
    if (!transferredFrom) continue;

    if (!restoreSection(paragraph, ownBefore.section)) continue;

    transfers.push({
      targetParagraphId: targetId,
      sourceParagraphId: transferredFrom[0],
    });
  }

  if (transfers.length === 0) {
    return { bytes: input.afterBytes, restored: 0, transfers: [] };
  }

  afterFiles['word/document.xml'] = strToU8(
    new XMLSerializer().serializeToString(afterXml),
  );

  return {
    bytes: zipDocxFiles(afterFiles),
    restored: transfers.length,
    transfers,
  };
}
