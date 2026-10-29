// @vitest-environment node
import { createHash } from 'node:crypto';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';

const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:t xml:space="preserve">RESOLVED THAT the scope for </w:t></w:r><w:sdt><w:sdtPr><w:tag w:val="company.name"/></w:sdtPr><w:sdtContent><w:r><w:t>Company name</w:t></w:r></w:sdtContent></w:sdt><w:r><w:t xml:space="preserve"> be approved.</w:t></w:r></w:p>
</w:body></w:document>`;
const bytes = zipSync({ 'word/document.xml': strToU8(documentXml) });
const sha256 = createHash('sha256').update(bytes).digest('hex');
const storageKey = 'tenant-1/template-partials/p-1/oakdoc/v1.docx';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    templatePartial: { findFirst: vi.fn(async () => ({ id: 'p-1', version: 4, contentJson: {} })) },
  },
}));
vi.mock('@/lib/storage', () => ({
  storage: { download: vi.fn(async () => Buffer.from(bytes)) },
  StorageKeys: {},
}));
vi.mock('@/lib/document-editor/oakdoc-template', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  readOakDocTemplateMetadata: () => ({ storageKey, sha256 }),
}));

describe('readOakDocPartialText', () => {
  it('reads a Word partial on the server, where no browser DOM exists', async () => {
    const { readOakDocPartialText } = await import('@/services/oakdoc-partial.service');
    await expect(readOakDocPartialText('p-1', 'tenant-1')).resolves.toEqual({
      text: 'RESOLVED THAT the scope for {company.name} be approved.',
      revision: 4,
    });
  });
});
