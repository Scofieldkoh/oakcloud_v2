import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('document navigation source', () => {
  it('rebrands processing and removes Templates from Administration', () => {
    const sidebar = readSource('src/components/ui/sidebar.tsx');

    expect(sidebar).toContain("{ name: 'Document Vault', href: '/processing', icon: ScanText }");
    expect(sidebar).not.toContain("{ name: 'Templates', href: '/admin/template-partials'");
  });

  it('groups Document Templates under Administration with separate Documents and Partials pages', () => {
    const sidebar = readSource('src/components/ui/sidebar.tsx');
    const generatedDocuments = readSource('src/app/(dashboard)/generated-documents/page.tsx');
    const documents = readSource('src/app/(dashboard)/template-partials/documents/page.tsx');
    const partials = readSource('src/app/(dashboard)/template-partials/partials/page.tsx');

    expect(sidebar).toContain("id: 'document-templates',\n    name: 'Document Templates',");
    expect(sidebar).toContain("{ name: 'Documents', href: '/template-partials/documents', icon: FileText, adminOnly: true },");
    expect(sidebar).toContain("{ name: 'Partials', href: '/template-partials/partials', icon: Puzzle, adminOnly: true },");
    expect(sidebar).not.toContain("{ name: 'Document Templates', href: '/template-partials'");
    expect(generatedDocuments).not.toContain('DocumentGenerationTabs');
    expect(generatedDocuments).not.toContain('/template-partials');
    for (const page of [documents, partials]) {
      expect(page).not.toContain('DocumentGenerationTabs');
      expect(page).not.toContain('aria-label="Tabs"');
    }
  });

  it('uses Document Vault as the processing page heading', () => {
    const processing = readSource('src/app/(dashboard)/processing/page.tsx');

    expect(processing).toContain('>Document Vault</h1>');
    expect(processing).not.toContain('>Document Processing</h1>');
  });

  it('routes company document navigation through the filtered Document Vault', () => {
    const companyProfile = readSource(
      'src/components/companies/company-detail/company-profile-sections.tsx',
    );

    expect(companyProfile).toContain('href={`/processing?companyId=${companyId}`}');
    expect(companyProfile).not.toContain('href={`/companies/${companyId}/documents`}');
  });
});
