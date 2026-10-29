// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { inspectOakDocStructure } from '@/lib/document-editor/oakdoc-diagnostics';

const DIAGNOSTIC_FIXTURE =
  'UEsDBBQAAAAIAAspOF3tYIQ5gwEAAE4DAAARAAAAd29yZC9kb2N1bWVudC54bWyNU0tvwjAM/itV7pC2QhOqKAiYNu0wCWmbdg6JWyLlpSTQ8u+XpgVabYddbMePL5/tZLVppUguYB3XqkTZPEUJKKoZV3WJvj5fZkuUOE8UI0IrKNEVHNqsV03BND1LUD4JAMoVTYlO3psCY0dPIImbawMqxCptJfHhaGvcaMuM1RScC/hS4DxNn7AkXKEbTLb4BSQ5tdrpys+pllhXFacQoUJ5lkZLijuA+Q8RZkkzYjDl9dwHUdflUbNrp00SmBWGWPLGSrTdbrMsiwm2E369FzzMYuZAOe75BRIPrV/hLtRJG6WJuUcxqFfLWWfWQe+1SJpuiPkiTRH+5V4sezeeVPr+dtrLw3D6HiEF019N2BtryQP2wxAVIhciQtoNdqifdrrb7fI8n3QKIjwYIs7wR3v4wWbM6fIOtobxPUMi7nvA97HEEZm+qrJEwsH2ZYMvimF7wTQFUfSkh5y7fzpxcy80nPrIqz22e618WFl0D8zGXnzLnmI5oP5GqX8b+PEV1j9QSwECFAMUAAAACAALKThd7WCEOYMBAABOAwAAEQAAAAAAAAAAAAAAgAEAAAAAd29yZC9kb2N1bWVudC54bWxQSwUGAAAAAAEAAQA/AAAAsgEAAAAA';

function decodeFixture(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

describe('OakDoc structural diagnostics', () => {
  it('summarizes Word structure without recording document text', () => {
    const summary = inspectOakDocStructure(decodeFixture(DIAGNOSTIC_FIXTURE));
    const serialized = JSON.stringify(summary);

    expect(summary.paragraphs).toBe(5);
    expect(summary.paragraphIds).toEqual(['AAA111', 'BBB222']);
    expect(summary.tables).toBe(1);
    expect(summary.tableRows).toBe(1);
    expect(summary.tableCells).toBe(2);
    expect(summary.tableGridWidths).toEqual([['2400', '4800']]);
    expect(summary.cellWidths).toEqual([
      { tableIndex: 0, rowIndex: 0, cellIndex: 0, value: '2400', type: 'dxa' },
    ]);
    expect(summary.mergedCells).toEqual([
      { tableIndex: 0, rowIndex: 0, cellIndex: 0, gridSpan: '2' },
      { tableIndex: 0, rowIndex: 0, cellIndex: 1, verticalMerge: 'continue' },
    ]);
    expect(summary.emptyTableCells).toEqual([
      { tableIndex: 0, rowIndex: 0, cellIndex: 1 },
    ]);
    expect(summary.tableCellsWithoutParagraph).toEqual([
      { tableIndex: 0, rowIndex: 0, cellIndex: 1 },
    ]);
    expect(summary.drawings).toBe(1);
    expect(summary.anchors).toBe(1);
    expect(summary.inlineDrawings).toBe(0);
    expect(summary.picts).toBe(1);
    expect(summary.textBoxes).toBe(1);
    expect(summary.frames).toBe(1);
    expect(summary.sectionProperties).toBe(1);
    expect(serialized).not.toContain('Client-sensitive text');
    expect(serialized).not.toContain('Cell value');
  });
});
