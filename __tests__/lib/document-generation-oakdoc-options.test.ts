import { describe, expect, it } from 'vitest';
import { mapGenerationTemplateSummaries } from '@/lib/document-generation-option-mappers';
import { OAKDOC_TEMPLATE_CONTENT } from '@/lib/document-editor/oakdoc-template';

describe('normal generation template options', () => {
  it('keeps active OakDoc templates in the normal picker source', () => {
    const templates = mapGenerationTemplateSummaries([
      {
        id: 'a4-template',
        name: 'Legacy A4',
        isActive: true,
        content: '<p>Hello</p>',
        contentJson: null,
        version: 2,
      },
      {
        id: 'oakdoc-template',
        name: 'Word Resolution',
        isActive: true,
        content: OAKDOC_TEMPLATE_CONTENT,
        contentJson: {
          oakDoc: {
            schemaVersion: 1,
            storageKey: 'tenant/templates/oakdoc/assets/master.docx',
            fileName: 'master.docx',
            fileSize: 100,
            sha256: 'a'.repeat(64),
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            fieldTags: [],
          },
        },
        version: 4,
      },
      {
        id: 'inactive-oakdoc',
        name: 'Inactive Word',
        isActive: false,
        content: OAKDOC_TEMPLATE_CONTENT,
      },
    ]);

    expect(templates.map((template) => [template.id, template.engine])).toEqual([
      ['a4-template', 'A4'],
      ['oakdoc-template', 'OAKDOC'],
    ]);
  });
});
