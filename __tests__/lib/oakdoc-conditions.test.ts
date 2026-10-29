// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';

import { createDocxFixture } from '../helpers/docx-fixture';

import {
  createOakDocCondition,
  inspectOakDocConditions,
  removeOakDocCondition,
  resolveOakDocConditions,
} from '@/lib/document-editor/oakdoc-conditions';

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WORD14_NS = 'http://schemas.microsoft.com/office/word/2010/wordml';
const CONTENT_TYPES_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const PACKAGE_RELS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';

function docx(body: string): Uint8Array {
  const documentXml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:document',
    ' xmlns:w="' + WORD_NS + '"',
    ' xmlns:w14="' + WORD14_NS + '">',
    '<w:body>',
    body,
    '<w:sectPr/>',
    '</w:body>',
    '</w:document>',
  ].join('');

  const contentTypes = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="' + CONTENT_TYPES_NS + '">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/word/document.xml"',
    ' ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
    '</Types>',
  ].join('');

  const relationships = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="' + PACKAGE_RELS_NS + '">',
    '<Relationship Id="rId1"',
    ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"',
    ' Target="word/document.xml"/>',
    '</Relationships>',
  ].join('');

  return createDocxFixture({
    '[Content_Types].xml': contentTypes,
    '_rels/.rels': relationships,
    'word/document.xml': documentXml,
  });
}

function part(bytes: Uint8Array, name: string): string {
  const files = unzipSync(bytes);
  return files[name] ? strFromU8(files[name]) : '';
}

const allowedFields = new Set([
  'company.entityType',
  'company.name',
  'system.generatedBy',
]);

describe('OakDoc conditional blocks', () => {
  it('wraps a paragraph with self-contained condition metadata', () => {
    const source = docx(
      '<w:p w14:paraId="A1B2C3D4"><w:r><w:t>Private company clause</w:t></w:r></w:p>',
    );

    const created = createOakDocCondition({
      docxBytes: source,
      fromParaId: 'A1B2C3D4',
      condition: {
        field: 'company.entityType',
        operator: 'equals',
        value: 'PRIVATE LIMITED COMPANY',
      },
      allowedFields,
    });

    expect(created.targetKind).toBe('paragraph');
    expect(created.condition).toMatchObject({
      field: 'company.entityType',
      operator: 'equals',
      value: 'PRIVATE LIMITED COMPANY',
    });

    const summary = inspectOakDocConditions(created.bytes);
    expect(summary.count).toBe(1);
    expect(summary.fieldTags).toEqual(['company.entityType']);
    expect(summary.conditions[0]).toMatchObject({
      id: created.condition.id,
      tag: created.condition.tag,
    });

    expect(part(created.bytes, 'word/document.xml')).toContain(created.condition.tag);
    expect(part(created.bytes, 'docProps/custom.xml')).toContain(
      'OakDoc.Condition.' + created.condition.id,
    );
    expect(part(created.bytes, '[Content_Types].xml')).toContain(
      'application/vnd.openxmlformats-officedocument.custom-properties+xml',
    );
    expect(part(created.bytes, '_rels/.rels')).toContain(
      'relationships/custom-properties',
    );
  });

  it('keeps content when an equals condition matches and removes the wrapper', () => {
    const source = docx(
      '<w:p w14:paraId="B1C2D3E4"><w:r><w:t>Keep me</w:t></w:r></w:p>',
    );
    const created = createOakDocCondition({
      docxBytes: source,
      fromParaId: 'B1C2D3E4',
      condition: {
        field: 'company.entityType',
        operator: 'equals',
        value: 'PRIVATE LIMITED COMPANY',
      },
      allowedFields,
    });

    const resolved = resolveOakDocConditions({
      docxBytes: created.bytes,
      values: { 'company.entityType': 'PRIVATE LIMITED COMPANY' },
      allowedFields,
    });

    expect(resolved).toMatchObject({
      resolved: 1,
      kept: 1,
      removed: 0,
      unresolvedFields: [],
    });
    expect(part(resolved.bytes, 'word/document.xml')).toContain('Keep me');
    expect(part(resolved.bytes, 'word/document.xml')).not.toContain(created.condition.tag);
    expect(part(resolved.bytes, 'docProps/custom.xml')).not.toContain(
      'OakDoc.Condition.' + created.condition.id,
    );
  });

  it('removes a whole table row when the condition does not match', () => {
    const source = docx(
      '<w:tbl><w:tr>'
      + '<w:tc><w:p w14:paraId="C1D2E3F4"><w:r><w:t>Corporate only</w:t></w:r></w:p></w:tc>'
      + '<w:tc><w:p w14:paraId="C1D2E3F5"><w:r><w:t>Second cell</w:t></w:r></w:p></w:tc>'
      + '</w:tr></w:tbl>',
    );

    const created = createOakDocCondition({
      docxBytes: source,
      fromParaId: 'C1D2E3F4',
      toParaId: 'C1D2E3F5',
      condition: {
        field: 'company.entityType',
        operator: 'equals',
        value: 'PUBLIC COMPANY',
      },
      allowedFields,
    });

    expect(created.targetKind).toBe('table row');

    const resolved = resolveOakDocConditions({
      docxBytes: created.bytes,
      values: { 'company.entityType': 'PRIVATE LIMITED COMPANY' },
      allowedFields,
    });

    expect(resolved).toMatchObject({
      resolved: 1,
      kept: 0,
      removed: 1,
    });
    const output = part(resolved.bytes, 'word/document.xml');
    expect(output).not.toContain('Corporate only');
    expect(output).not.toContain('Second cell');
    expect(output).not.toContain('<w:tr');
  });

  it('supports truthy and not-equals conditions', () => {
    const truthy = createOakDocCondition({
      docxBytes: docx(
        '<w:p w14:paraId="D1E2F3A4"><w:r><w:t>Prepared by user</w:t></w:r></w:p>',
      ),
      fromParaId: 'D1E2F3A4',
      condition: {
        field: 'system.generatedBy',
        operator: 'truthy',
      },
      allowedFields,
    });

    const truthyResolved = resolveOakDocConditions({
      docxBytes: truthy.bytes,
      values: { 'system.generatedBy': 'Scofield' },
      allowedFields,
    });
    expect(truthyResolved.kept).toBe(1);

    const notEquals = createOakDocCondition({
      docxBytes: docx(
        '<w:p w14:paraId="D1E2F3A5"><w:r><w:t>Different company</w:t></w:r></w:p>',
      ),
      fromParaId: 'D1E2F3A5',
      condition: {
        field: 'company.name',
        operator: 'notEquals',
        value: 'Excluded Pte. Ltd.',
      },
      allowedFields,
    });

    const notEqualsResolved = resolveOakDocConditions({
      docxBytes: notEquals.bytes,
      values: { 'company.name': 'Example Pte. Ltd.' },
      allowedFields,
    });
    expect(notEqualsResolved.kept).toBe(1);
  });

  it('treats common false-like values as false for truthy conditions', () => {
    // An amount of nothing (a directors' fee of 0.00) is false too.
    const falseLikeValues = ['', '0', 'false', 'False', 'NO', 'null', 'undefined', '0.00', 'S$0', '0,000.00'];

    for (const value of falseLikeValues) {
      const created = createOakDocCondition({
        docxBytes: docx(
          '<w:p w14:paraId="D1E2F3B4"><w:r><w:t>Conditional paragraph</w:t></w:r></w:p>',
        ),
        fromParaId: 'D1E2F3B4',
        condition: {
          field: 'system.generatedBy',
          operator: 'truthy',
        },
        allowedFields,
      });

      const resolved = resolveOakDocConditions({
        docxBytes: created.bytes,
        values: { 'system.generatedBy': value },
        allowedFields,
      });

      expect(resolved.removed).toBe(1);
      expect(part(resolved.bytes, 'word/document.xml')).not.toContain('Conditional paragraph');
    }
  });

  it('keeps non-zero amounts for truthy conditions', () => {
    for (const value of ['0.50', 'S$1,000.00', '10']) {
      const created = createOakDocCondition({
        docxBytes: docx('<w:p w14:paraId="D1E2F3B5"><w:r><w:t>Fee paragraph</w:t></w:r></w:p>'),
        fromParaId: 'D1E2F3B5',
        condition: { field: 'system.generatedBy', operator: 'truthy' },
        allowedFields,
      });
      const resolved = resolveOakDocConditions({ docxBytes: created.bytes, values: { 'system.generatedBy': value }, allowedFields });
      expect(resolved.kept).toBe(1);
    }
  });

  it('leaves conditions on a repeating section’s own fields for the section to resolve', () => {
    const created = createOakDocCondition({
      docxBytes: docx('<w:p w14:paraId="D1E2F3B6"><w:r><w:t>Company wording</w:t></w:r></w:p>'),
      fromParaId: 'D1E2F3B6',
      condition: { field: 'contact.isCorporate', operator: 'truthy' },
      allowedFields: new Set(['contact.isCorporate']),
    });
    const resolved = resolveOakDocConditions({
      docxBytes: created.bytes,
      values: {},
      allowedFields,
      deferField: (field) => field.startsWith('contact.'),
    });
    expect(resolved.resolved).toBe(0);
    expect(resolved.unresolvedFields).toEqual([]);
    expect(part(resolved.bytes, 'word/document.xml')).toContain(created.condition.tag);
  });

  it('unwraps a condition at the caret while keeping the document content', () => {
    const source = docx(
      '<w:p w14:paraId="E1F2A3B4"><w:r><w:t>Editable clause</w:t></w:r></w:p>',
    );
    const created = createOakDocCondition({
      docxBytes: source,
      fromParaId: 'E1F2A3B4',
      condition: {
        field: 'company.name',
        operator: 'truthy',
      },
      allowedFields,
    });

    const removed = removeOakDocCondition({
      docxBytes: created.bytes,
      paraId: 'E1F2A3B4',
    });

    expect(removed.condition.id).toBe(created.condition.id);
    expect(inspectOakDocConditions(removed.bytes).count).toBe(0);
    expect(part(removed.bytes, 'word/document.xml')).toContain('Editable clause');
    expect(part(removed.bytes, 'word/document.xml')).not.toContain(created.condition.tag);
    expect(part(removed.bytes, 'docProps/custom.xml')).not.toContain(
      'OakDoc.Condition.' + created.condition.id,
    );
  });

  it('leaves unknown condition fields unresolved instead of deleting content', () => {
    const source = docx(
      '<w:p w14:paraId="F1A2B3C4"><w:r><w:t>Unknown field clause</w:t></w:r></w:p>',
    );
    const created = createOakDocCondition({
      docxBytes: source,
      fromParaId: 'F1A2B3C4',
      condition: {
        field: 'company.name',
        operator: 'truthy',
      },
      allowedFields,
    });

    const resolved = resolveOakDocConditions({
      docxBytes: created.bytes,
      values: { 'company.name': 'Example Pte. Ltd.' },
      allowedFields: new Set(['company.entityType']),
    });

    expect(resolved).toMatchObject({
      resolved: 0,
      kept: 0,
      removed: 0,
      unresolvedFields: ['company.name'],
    });
    expect(part(resolved.bytes, 'word/document.xml')).toContain('Unknown field clause');
    expect(part(resolved.bytes, 'word/document.xml')).toContain(created.condition.tag);
  });
});
