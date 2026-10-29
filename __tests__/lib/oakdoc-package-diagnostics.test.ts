import { describe, expect, it } from 'vitest';
import { createDocxFixture } from '../helpers/docx-fixture';

import {
  diagnoseOakDocPackage,
  extractDocxSemanticText,
} from '@/lib/document-editor/oakdoc-package-diagnostics';

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

function docx(parts: Record<string, string>): Uint8Array {
  return createDocxFixture({
    '[Content_Types].xml': CONTENT_TYPES,
    ...parts,
  });
}

function documentXml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>${body}</w:body>
</w:document>`;
}

describe('OakDoc package diagnostics', () => {
  it('accepts a resolved DOCX with required semantics, relationships, media and structure', () => {
    const bytes = docx({
      'word/document.xml': documentXml(`
        <w:p><w:r><w:t>Service Agreement</w:t></w:r></w:p>
        <w:p><w:r><w:t>ACME PTE. LTD.</w:t></w:r></w:p>
        <w:tbl>
          <w:tr>
            <w:tc><w:p><w:r><w:t>Annual corporate secretarial fee</w:t></w:r></w:p></w:tc>
            <w:tc><w:p><w:r><w:t>S$1,200.00 per year</w:t></w:r></w:p></w:tc>
          </w:tr>
        </w:tbl>
        <w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>
      `),
      'word/_rels/document.xml.rels': `<?xml version="1.0" encoding="UTF-8"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rIdLogo" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logo.png"/>
        </Relationships>`,
      'word/media/logo.png': 'PNGDATA',
    });

    const result = diagnoseOakDocPackage(bytes, {
      requiredTextBlocks: ['Service Agreement', 'ACME PTE. LTD.', 'Annual corporate secretarial fee'],
      requiredTableCells: [
        { tableIndex: 0, rowIndex: 0, cellIndex: 0, label: 'fee description' },
        { tableIndex: 0, rowIndex: 0, cellIndex: 1, label: 'fee amount' },
      ],
    });

    expect(result.passed).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.relationshipCount).toBe(1);
    expect(result.imageRelationshipCount).toBe(1);
    expect(result.mediaCount).toBe(1);
    expect(result.sectionCount).toBe(1);
    expect(extractDocxSemanticText(bytes)).toContain('ACME PTE. LTD.');
  });

  it('detects unresolved data, broken package references and unsafe structural gaps', () => {
    const bytes = docx({
      'word/document.xml': documentXml(`
        <w:p><w:r><w:t>Service Agreement {{client.name}}</w:t></w:r></w:p>
        <w:sdt>
          <w:sdtPr><w:tag w:val="company.name"/></w:sdtPr>
          <w:sdtContent><w:p><w:r><w:t>Click here to enter text</w:t></w:r></w:p></w:sdtContent>
        </w:sdt>
        <w:sdt>
          <w:sdtPr><w:tag w:val="company.name"/></w:sdtPr>
          <w:sdtContent><w:p><w:r><w:t>Click here to enter text</w:t></w:r></w:p></w:sdtContent>
        </w:sdt>
        <w:tbl>
          <w:tr>
            <w:tc>
              <w:p/>
              <w:sectPr/>
            </w:tc>
          </w:tr>
        </w:tbl>
        <w:sectPr/>
        <w:p><w:r><w:t>Content after body section</w:t></w:r></w:p>
      `),
      'word/_rels/document.xml.rels': `<?xml version="1.0" encoding="UTF-8"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rIdMissing" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/missing.png"/>
        </Relationships>`,
      'word/media/orphan.png': '',
    });

    const result = diagnoseOakDocPackage(bytes, {
      requiredControls: [{ tag: 'company.name', minCount: 1, maxCount: 1 }],
      requiredTextBlocks: ['Limitation of Liability'],
      requiredTableCells: [
        { tableIndex: 0, rowIndex: 0, cellIndex: 0, label: 'required party' },
      ],
    });
    const codes = result.issues.map((issue) => issue.code);

    expect(result.passed).toBe(false);
    expect(result.unresolvedOakDocControls).toEqual(['company.name']);
    expect(result.unresolvedLegacyPlaceholders).toEqual(['{{client.name}}']);
    expect(codes).toEqual(expect.arrayContaining([
      'UNRESOLVED_LEGACY_PLACEHOLDER',
      'UNRESOLVED_OAKDOC_CONTROL',
      'DUPLICATE_REQUIRED_CONTROL',
      'MISSING_REQUIRED_STRUCTURAL_BLOCK',
      'SUSPICIOUS_EMPTY_REQUIRED_TABLE_CELL',
      'BROKEN_RELATIONSHIP',
      'INVALID_MEDIA',
      'ORPHANED_MEDIA',
      'ORPHANED_SECTION_PROPERTIES',
      'ORPHANED_BODY_SECTION_STRUCTURE',
    ]));
  });

  it('checks the full required table cell value rather than only its first character', () => {
    const bytes = docx({
      'word/document.xml': documentXml(`
        <w:tbl>
          <w:tr>
            <w:tc><w:p><w:r><w:t>Annual corporate secretarial fee</w:t></w:r></w:p></w:tc>
          </w:tr>
        </w:tbl>
      `),
    });

    const result = diagnoseOakDocPackage(bytes, {
      requiredTableCells: [
        { tableIndex: 0, rowIndex: 0, cellIndex: 0, label: 'fee description' },
      ],
    });

    expect(result.issues).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SUSPICIOUS_EMPTY_REQUIRED_TABLE_CELL' }),
    ]));
  });

  it('reports a package with no word/document.xml instead of guessing', () => {
    const result = diagnoseOakDocPackage(docx({
      'word/styles.xml': '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>',
    }));

    expect(result.passed).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'MISSING_DOCUMENT_XML', severity: 'error' }),
    ]));
  });
});
