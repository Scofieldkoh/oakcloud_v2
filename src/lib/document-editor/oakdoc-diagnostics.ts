import { strFromU8, unzipSync } from 'fflate';

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WORD_2010_NS = 'http://schemas.microsoft.com/office/word/2010/wordml';

export interface OakDocTableCellDiagnostic {
  tableIndex: number;
  rowIndex: number;
  cellIndex: number;
  width?: { value: string; type: string };
  gridSpan?: string;
  verticalMerge?: string;
  paragraphCount: number;
  paragraphIds: string[];
  empty: boolean;
}

export interface OakDocTableDiagnostic {
  tableIndex: number;
  gridWidths: string[];
  rowCount: number;
  cellCount: number;
  cells: OakDocTableCellDiagnostic[];
}

export interface OakDocSectionDiagnostic {
  index: number;
  paragraphId?: string;
  bodyLevel: boolean;
  type?: string;
  columns: {
    count?: string;
    equalWidth?: string;
    space?: string;
    widths: Array<{ width: string; space: string }>;
  };
  page?: { width: string; height: string; orientation: string };
  margins?: {
    top: string;
    right: string;
    bottom: string;
    left: string;
    header: string;
    footer: string;
    gutter: string;
  };
}

export interface OakDocStructuralSummary {
  paragraphs: number;
  paragraphIds: string[];
  tables: number;
  tableRows: number;
  tableCells: number;
  tableGridWidths: string[][];
  cellWidths: Array<{
    tableIndex: number;
    rowIndex: number;
    cellIndex: number;
    value: string;
    type: string;
  }>;
  mergedCells: Array<{
    tableIndex: number;
    rowIndex: number;
    cellIndex: number;
    gridSpan?: string;
    verticalMerge?: string;
  }>;
  emptyTableCells: Array<{
    tableIndex: number;
    rowIndex: number;
    cellIndex: number;
  }>;
  tableCellsWithoutParagraph: Array<{
    tableIndex: number;
    rowIndex: number;
    cellIndex: number;
  }>;
  drawings: number;
  anchors: number;
  inlineDrawings: number;
  picts: number;
  textBoxes: number;
  sectionProperties: number;
  sections: OakDocSectionDiagnostic[];
  frames: number;
  tablesDetail: OakDocTableDiagnostic[];
}

function parseXml(bytes: Uint8Array): XMLDocument {
  const xml = new DOMParser().parseFromString(strFromU8(bytes), 'application/xml');
  if (xml.getElementsByTagName('parsererror').length > 0) {
    throw new Error('OakDoc diagnostics could not parse word/document.xml.');
  }
  return xml;
}

function wordElements(parent: Document | Element, localName: string): Element[] {
  return Array.from(parent.getElementsByTagNameNS(WORD_NS, localName));
}

function directWordChildren(parent: Node, localName: string): Element[] {
  return Array.from(parent.childNodes).filter(
    (node): node is Element =>
      node.nodeType === Node.ELEMENT_NODE
      && (node as Element).namespaceURI === WORD_NS
      && (node as Element).localName === localName,
  );
}

function wordAttribute(element: Element | null | undefined, localName: string): string {
  if (!element) return '';
  return element.getAttributeNS(WORD_NS, localName)
    || element.getAttribute(`w:${localName}`)
    || '';
}

function paragraphId(paragraph: Element): string {
  return paragraph.getAttributeNS(WORD_2010_NS, 'paraId')
    || paragraph.getAttribute('w14:paraId')
    || '';
}

function isCellEmpty(cell: Element): boolean {
  const visibleText = wordElements(cell, 't')
    .map((node) => node.textContent || '')
    .join('')
    .trim();
  if (visibleText) return false;

  return wordElements(cell, 'drawing').length === 0
    && wordElements(cell, 'pict').length === 0;
}

/**
 * Development diagnostic only. It intentionally records WordprocessingML structure,
 * identifiers, and dimensions, but never paragraph/run text.
 */
export function inspectOakDocStructure(docxBytes: Uint8Array): OakDocStructuralSummary {
  const files = unzipSync(docxBytes);
  const documentBytes = files['word/document.xml'];
  if (!documentBytes) {
    throw new Error('OakDoc diagnostics could not find word/document.xml.');
  }

  const xml = parseXml(documentBytes);
  const paragraphs = wordElements(xml, 'p');
  const tables = wordElements(xml, 'tbl');

  const tablesDetail: OakDocTableDiagnostic[] = [];
  const cellWidths: OakDocStructuralSummary['cellWidths'] = [];
  const mergedCells: OakDocStructuralSummary['mergedCells'] = [];
  const emptyTableCells: OakDocStructuralSummary['emptyTableCells'] = [];
  const tableCellsWithoutParagraph: OakDocStructuralSummary['tableCellsWithoutParagraph'] = [];

  let tableRows = 0;
  let tableCells = 0;

  tables.forEach((table, tableIndex) => {
    const grid = directWordChildren(table, 'tblGrid')[0];
    const gridWidths = grid
      ? directWordChildren(grid, 'gridCol').map((column) => wordAttribute(column, 'w'))
      : [];
    const rows = directWordChildren(table, 'tr');
    let tableCellCount = 0;
    const cellsDetail: OakDocTableCellDiagnostic[] = [];

    rows.forEach((row, rowIndex) => {
      const cells = directWordChildren(row, 'tc');
      tableCellCount += cells.length;
      tableCells += cells.length;

      cells.forEach((cell, cellIndex) => {
        const properties = directWordChildren(cell, 'tcPr')[0];
        const tcW = properties ? directWordChildren(properties, 'tcW')[0] : undefined;
        const gridSpan = properties
          ? wordAttribute(directWordChildren(properties, 'gridSpan')[0], 'val')
          : '';
        const vMerge = properties
          ? directWordChildren(properties, 'vMerge')[0]
          : undefined;
        const verticalMerge = vMerge
          ? (wordAttribute(vMerge, 'val') || 'continue')
          : '';
        const cellParagraphs = directWordChildren(cell, 'p');
        const ids = cellParagraphs.map(paragraphId).filter(Boolean);
        const widthValue = wordAttribute(tcW, 'w');
        const widthType = wordAttribute(tcW, 'type');

        if (widthValue || widthType) {
          cellWidths.push({
            tableIndex,
            rowIndex,
            cellIndex,
            value: widthValue,
            type: widthType,
          });
        }
        if (gridSpan || verticalMerge) {
          mergedCells.push({
            tableIndex,
            rowIndex,
            cellIndex,
            ...(gridSpan ? { gridSpan } : {}),
            ...(verticalMerge ? { verticalMerge } : {}),
          });
        }
        if (isCellEmpty(cell)) {
          emptyTableCells.push({ tableIndex, rowIndex, cellIndex });
        }
        if (cellParagraphs.length === 0) {
          tableCellsWithoutParagraph.push({ tableIndex, rowIndex, cellIndex });
        }

        cellsDetail.push({
          tableIndex,
          rowIndex,
          cellIndex,
          ...(widthValue || widthType
            ? { width: { value: widthValue, type: widthType } }
            : {}),
          ...(gridSpan ? { gridSpan } : {}),
          ...(verticalMerge ? { verticalMerge } : {}),
          paragraphCount: cellParagraphs.length,
          paragraphIds: ids,
          empty: isCellEmpty(cell),
        });
      });
    });

    tableRows += rows.length;
    tablesDetail.push({
      tableIndex,
      gridWidths,
      rowCount: rows.length,
      cellCount: tableCellCount,
      cells: cellsDetail,
    });
  });

  const sections: OakDocSectionDiagnostic[] = wordElements(xml, 'sectPr').map(
    (section, index) => {
      const properties = section.parentElement;
      const paragraph = properties?.localName === 'pPr'
        ? properties.parentElement
        : null;
      const cols = directWordChildren(section, 'cols')[0];
      const pgSz = directWordChildren(section, 'pgSz')[0];
      const pgMar = directWordChildren(section, 'pgMar')[0];
      const type = wordAttribute(directWordChildren(section, 'type')[0], 'val');
      const columnChildren = cols ? directWordChildren(cols, 'col') : [];

      return {
        index,
        ...(paragraph?.namespaceURI === WORD_NS && paragraph.localName === 'p'
          ? { paragraphId: paragraphId(paragraph) || undefined }
          : {}),
        bodyLevel: section.parentElement?.localName === 'body',
        ...(type ? { type } : {}),
        columns: {
          ...(wordAttribute(cols, 'num') ? { count: wordAttribute(cols, 'num') } : {}),
          ...(wordAttribute(cols, 'equalWidth')
            ? { equalWidth: wordAttribute(cols, 'equalWidth') }
            : {}),
          ...(wordAttribute(cols, 'space') ? { space: wordAttribute(cols, 'space') } : {}),
          widths: columnChildren.map((column) => ({
            width: wordAttribute(column, 'w'),
            space: wordAttribute(column, 'space'),
          })),
        },
        ...(pgSz
          ? {
              page: {
                width: wordAttribute(pgSz, 'w'),
                height: wordAttribute(pgSz, 'h'),
                orientation: wordAttribute(pgSz, 'orient'),
              },
            }
          : {}),
        ...(pgMar
          ? {
              margins: {
                top: wordAttribute(pgMar, 'top'),
                right: wordAttribute(pgMar, 'right'),
                bottom: wordAttribute(pgMar, 'bottom'),
                left: wordAttribute(pgMar, 'left'),
                header: wordAttribute(pgMar, 'header'),
                footer: wordAttribute(pgMar, 'footer'),
                gutter: wordAttribute(pgMar, 'gutter'),
              },
            }
          : {}),
      };
    },
  );

  return {
    paragraphs: paragraphs.length,
    paragraphIds: paragraphs.map(paragraphId).filter(Boolean),
    tables: tables.length,
    tableRows,
    tableCells,
    tableGridWidths: tablesDetail.map((table) => table.gridWidths),
    cellWidths,
    mergedCells,
    emptyTableCells,
    tableCellsWithoutParagraph,
    drawings: wordElements(xml, 'drawing').length,
    anchors: xml.getElementsByTagNameNS(
      'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
      'anchor',
    ).length,
    inlineDrawings: xml.getElementsByTagNameNS(
      'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
      'inline',
    ).length,
    picts: wordElements(xml, 'pict').length,
    textBoxes: wordElements(xml, 'txbxContent').length,
    sectionProperties: wordElements(xml, 'sectPr').length,
    sections,
    frames: wordElements(xml, 'framePr').length,
    tablesDetail,
  };
}
