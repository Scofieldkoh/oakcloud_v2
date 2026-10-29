/**
 * Document Validation Service Tests
 *
 * Tests for the document validation service used in document generation.
 * Tests placeholder detection, category assignment, and extraction.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { resolveDocumentPartySelections } from '@/services/document-party.service';
import { resolvePartials } from '@/services/template-partial.service';
import { OAKTREE_SERVICE_AGREEMENT_V1 } from '@/content/service-agreement/oaktree-service-agreement-v1';
import {
  extractSections,
  validateForGeneration,
} from '@/services/document-validation.service';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    documentTemplate: { findFirst: vi.fn() },
    company: { findFirst: vi.fn() },
  },
}));

vi.mock('@/services/template-partial.service', () => ({
  resolvePartials: vi.fn((content: string) => Promise.resolve(content)),
}));

vi.mock('@/services/document-party.service', () => ({
  resolveDocumentPartySelections: vi.fn(),
}));

const serviceAgreementMock = vi.hoisted(() => ({
  assembleServiceAgreementTemplate: vi.fn(),
  getServiceAgreementDraftById: vi.fn(),
}));

vi.mock('@/services/service-agreement', () => serviceAgreementMock);

const company = {
  id: 'company-1',
  name: 'Oakcloud Pte. Ltd.',
  uen: '202600001A',
  addresses: [],
  officers: [],
  shareholders: [],
};

const selectedDirector = {
  id: 'officer-1',
  contactId: 'contact-director',
  name: 'Alice Tan',
  detail: 'DIRECTOR',
  email: 'alice@example.com',
  phone: null,
  address: { full: '1 Main Street', letter: '1 Main Street' },
};

describe('Document Validation Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.company.findFirst).mockResolvedValue(company as never);
    vi.mocked(resolveDocumentPartySelections).mockResolvedValue({});
    serviceAgreementMock.getServiceAgreementDraftById.mockResolvedValue(null);
    serviceAgreementMock.assembleServiceAgreementTemplate.mockReturnValue({
      content: '',
      itemDiagnostics: [],
    });
  });

  describe('validateForGeneration', () => {
    it('requires only singular selections referenced by the resolved template', async () => {
      vi.mocked(prisma.documentTemplate.findFirst).mockResolvedValue({
        id: 'template-1',
        name: 'Letter',
        content: '{{> party-fields}}',
        placeholders: [],
      } as never);
      vi.mocked(resolvePartials).mockResolvedValueOnce(
        '{{selectedDirector.name}}{{selectedContact.email}}'
      );

      const result = await validateForGeneration('tenant-1', {
        templateId: 'template-1',
        companyId: 'company-1',
      });

      expect(result.errors.map((error) => error.message)).toEqual([
        'Select a director for this template.',
        'Select a company contact for this template.',
      ]);
      expect(resolveDocumentPartySelections).not.toHaveBeenCalled();
    });

    it.each([
      {
        error: 'Selected director is not a current director of this company',
        field: 'selectedDirector',
        category: 'directors',
      },
      {
        error: 'Selected shareholder is not a current shareholder of this company',
        field: 'selectedShareholder',
        category: 'shareholders',
      },
      {
        error: 'Selected contact is not linked to this company',
        field: 'selectedContact',
        category: 'contacts',
      },
    ])('converts the secure resolver error for $field into a validation error', async ({
      error,
      field,
      category,
    }) => {
      vi.mocked(prisma.documentTemplate.findFirst).mockResolvedValue({
        id: 'template-1',
        name: 'Letter',
        content: '{{company.name}}',
        placeholders: [],
      } as never);
      vi.mocked(resolveDocumentPartySelections).mockRejectedValue(new Error(error));

      const result = await validateForGeneration('tenant-1', {
        templateId: 'template-1',
        companyId: 'company-1',
        selectedDirectorId: 'officer-1',
        selectedShareholderId: 'shareholder-1',
        selectedContactId: 'contact-1',
      });

      expect(resolveDocumentPartySelections).toHaveBeenCalledTimes(1);
      expect(result.errors).toContainEqual({ field, message: error, category });
    });

    it('requires a company before validating a supplied party selection', async () => {
      vi.mocked(prisma.documentTemplate.findFirst).mockResolvedValue({
        id: 'template-1',
        name: 'Letter',
        content: '{{selectedDirector.name}}',
        placeholders: [],
      } as never);

      const result = await validateForGeneration('tenant-1', {
        templateId: 'template-1',
        selectedDirectorId: 'officer-1',
      });

      expect(result.errors).toContainEqual({
        field: 'company',
        message: 'Company selection is required for selected parties',
        category: 'company',
      });
      expect(resolveDocumentPartySelections).not.toHaveBeenCalled();
    });

    it('reports non-empty selected party leaves as available placeholders', async () => {
      vi.mocked(prisma.documentTemplate.findFirst).mockResolvedValue({
        id: 'template-1',
        name: 'Letter',
        content: '{{selectedDirector.name}}{{selectedDirector.address.letter}}',
        placeholders: [],
      } as never);
      vi.mocked(resolveDocumentPartySelections).mockResolvedValue({ selectedDirector });

      const result = await validateForGeneration('tenant-1', {
        templateId: 'template-1',
        companyId: 'company-1',
        selectedDirectorId: 'officer-1',
      }, 'Taylor User');

      expect(result.resolvedData.selectedDirector).toEqual(selectedDirector);
      expect(result.resolvedData.availablePlaceholders).toEqual(
        expect.arrayContaining([
          'system.preparerName',
          'selectedDirector.name',
          'selectedDirector.address.letter',
        ])
      );
      expect(result.resolvedData.missingPlaceholders).toEqual([]);
    });

    it.each([
      ['Taylor User', true],
      ['   ', false],
    ])('reports preparer placeholders according to trusted name %j', async (preparerName, available) => {
      vi.mocked(prisma.documentTemplate.findFirst).mockResolvedValue({
        id: 'template-1',
        name: 'Prepared letter',
        content: '{{system.preparerName}}{{system.generatedBy}}',
        placeholders: [],
      } as never);

      const result = await validateForGeneration('tenant-1', {
        templateId: 'template-1',
        customData: {
          preparerName: 'Client Supplied',
          generatedBy: 'Client Supplied',
        },
      }, preparerName);

      for (const key of ['system.preparerName', 'system.generatedBy']) {
        expect(result.resolvedData.availablePlaceholders.includes(key)).toBe(available);
      }
    });

    it('accepts company.address.letter when a current registered address exists', async () => {
      vi.mocked(prisma.documentTemplate.findFirst).mockResolvedValue({
        id: 'template-1',
        name: 'Letter',
        content: '{{company.address.letter}}',
        placeholders: [],
      } as never);
      vi.mocked(prisma.company.findFirst).mockResolvedValue({
        ...company,
        addresses: [{
          addressType: 'REGISTERED_OFFICE',
          fullAddress: '10 Anson Road, #10-01, Singapore 079903',
          isCurrent: true,
          block: '10',
          streetName: 'Anson Road',
          level: '10',
          unit: '01',
          buildingName: null,
          postalCode: '079903',
          country: 'Singapore',
        }],
      } as never);

      const result = await validateForGeneration('tenant-1', {
        templateId: 'template-1',
        companyId: 'company-1',
      });

      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.resolvedData.availablePlaceholders).toContain('company.address.letter');
      expect(result.resolvedData.missingPlaceholders).toEqual([]);
    });

    it('returns pinned service-item diagnostics as blocking validation errors', async () => {
      vi.mocked(prisma.documentTemplate.findFirst).mockResolvedValue({
        id: 'template-1',
        name: 'Service Agreement',
        content: '{{@agreement.serviceSections}}{{@agreement.feeTable}}{{@agreement.entityAppendix}}',
        placeholders: [],
        compositionType: 'SERVICE_AGREEMENT',
      } as never);
      serviceAgreementMock.getServiceAgreementDraftById.mockResolvedValue({
        id: 'agreement-1',
        generatedDocumentId: 'document-1',
        primaryCompanyId: 'company-1',
        authorizedContactIds: ['contact-1'],
        signerContactIds: ['contact-1'],
        authorizedRepresentativeSnapshots: [{
          id: 'contact-1',
          name: 'Alex Tan',
          role: 'Director',
          email: 'alex@example.com',
          phone: null,
        }],
      });
      serviceAgreementMock.assembleServiceAgreementTemplate.mockReturnValue({
        content: '<p>Agreement</p>',
        itemDiagnostics: [{
          itemId: 'item-1',
          missingPlaceholders: ['service.fields.software'],
        }],
      });

      const result = await validateForGeneration(
        'tenant-1',
        {
          draftId: 'document-1',
          templateId: 'template-1',
          companyId: 'company-1',
          serviceAgreementId: 'agreement-1',
        },
        'Taylor User',
        'user-1',
      );

      expect(result.errors).toContainEqual({
        field: 'service.fields.software',
        message: 'Service item item-1 is missing required field service.fields.software',
        category: 'custom',
      });
      expect(result.isValid).toBe(false);
    });

    it('does not require custom data for representative and signer loops in the seed template', async () => {
      const templateContent = OAKTREE_SERVICE_AGREEMENT_V1.template.content;
      vi.mocked(prisma.documentTemplate.findFirst).mockResolvedValue({
        id: 'template-1',
        name: 'Service Agreement',
        content: templateContent,
        placeholders: [],
        compositionType: 'SERVICE_AGREEMENT',
      } as never);
      serviceAgreementMock.getServiceAgreementDraftById.mockResolvedValue({
        id: 'agreement-1',
        generatedDocumentId: 'document-1',
        primaryCompanyId: 'company-1',
        authorizedRepresentativeSnapshots: [{
          id: 'contact-1',
          name: 'Alex Tan',
          role: 'Director',
          email: 'alex@example.com',
          phone: null,
        }],
        signerContactIds: ['contact-1'],
      });
      serviceAgreementMock.assembleServiceAgreementTemplate.mockReturnValue({
        content: templateContent,
        itemDiagnostics: [],
      });

      const result = await validateForGeneration(
        'tenant-1',
        {
          draftId: 'document-1',
          templateId: 'template-1',
          companyId: 'company-1',
          serviceAgreementId: 'agreement-1',
        },
        'Taylor User',
        'user-1',
      );

      expect(result.resolvedData.requiredPlaceholders).not.toContain('authorizedRepresentatives');
      expect(result.resolvedData.requiredPlaceholders).not.toContain('signers');
      expect(result.errors.map((error) => error.field)).not.toContain('authorizedRepresentatives');
      expect(result.errors.map((error) => error.field)).not.toContain('signers');
    });

    it('validates Service Agreement contact placeholders from the saved representative snapshot', async () => {
      vi.mocked(prisma.documentTemplate.findFirst).mockResolvedValue({
        id: 'template-1',
        name: 'Service Agreement',
        content: '{{selectedContact.name}}',
        placeholders: [],
        compositionType: 'SERVICE_AGREEMENT',
      } as never);
      serviceAgreementMock.getServiceAgreementDraftById.mockResolvedValue({
        id: 'agreement-1',
        generatedDocumentId: 'document-1',
        primaryCompanyId: 'company-1',
        authorizedRepresentativeSnapshots: [{
          id: 'deleted-contact',
          name: 'Pinned representative',
          role: 'Director',
          email: 'pinned@example.com',
          phone: null,
        }],
        signerContactIds: ['deleted-contact'],
      });
      serviceAgreementMock.assembleServiceAgreementTemplate.mockReturnValue({
        content: '{{selectedContact.name}}',
        itemDiagnostics: [],
      });
      vi.mocked(resolveDocumentPartySelections).mockRejectedValue(
        new Error('Selected contact is not linked to this company'),
      );

      const result = await validateForGeneration(
        'tenant-1',
        {
          draftId: 'document-1',
          templateId: 'template-1',
          companyId: 'company-1',
          serviceAgreementId: 'agreement-1',
          selectedContactId: 'deleted-contact',
        },
        'Taylor User',
        'user-1',
      );

      expect(resolveDocumentPartySelections).not.toHaveBeenCalled();
      expect(result.errors).toEqual([]);
      expect(result.resolvedData.selectedContact).toEqual(expect.objectContaining({
        id: 'deleted-contact',
        name: 'Pinned representative',
      }));
    });
  });

  describe('extractSections', () => {
    it('should extract h1 sections from HTML content', () => {
      const html = `
        <h1>Introduction</h1>
        <p>Some content here.</p>
        <h1>Main Section</h1>
        <p>More content.</p>
      `;

      const sections = extractSections(html);

      expect(sections).toHaveLength(2);
      expect(sections[0].title).toBe('Introduction');
      expect(sections[0].level).toBe(1);
      expect(sections[1].title).toBe('Main Section');
      expect(sections[1].level).toBe(1);
    });

    it('should extract h2 sections from HTML content', () => {
      const html = `
        <h2>First Subsection</h2>
        <p>Content.</p>
        <h2>Second Subsection</h2>
        <p>More content.</p>
      `;

      const sections = extractSections(html);

      expect(sections).toHaveLength(2);
      expect(sections[0].title).toBe('First Subsection');
      expect(sections[0].level).toBe(2);
      expect(sections[1].title).toBe('Second Subsection');
      expect(sections[1].level).toBe(2);
    });

    it('should extract mixed heading levels', () => {
      const html = `
        <h1>Chapter 1</h1>
        <h2>Section 1.1</h2>
        <h3>Subsection 1.1.1</h3>
        <h2>Section 1.2</h2>
        <h1>Chapter 2</h1>
      `;

      const sections = extractSections(html);

      expect(sections).toHaveLength(5);
      expect(sections[0].title).toBe('Chapter 1');
      expect(sections[0].level).toBe(1);
      expect(sections[1].title).toBe('Section 1.1');
      expect(sections[1].level).toBe(2);
      expect(sections[2].title).toBe('Subsection 1.1.1');
      expect(sections[2].level).toBe(3);
      expect(sections[3].title).toBe('Section 1.2');
      expect(sections[3].level).toBe(2);
      expect(sections[4].title).toBe('Chapter 2');
      expect(sections[4].level).toBe(1);
    });

    it('should handle headings with attributes', () => {
      const html = `
        <h1 class="title">Title with Class</h1>
        <h2 id="section-id" style="color: blue;">Styled Section</h2>
      `;

      const sections = extractSections(html);

      expect(sections).toHaveLength(2);
      expect(sections[0].title).toBe('Title with Class');
      expect(sections[1].title).toBe('Styled Section');
    });

    it('should return empty array for content without headings', () => {
      const html = `
        <p>Just a paragraph.</p>
        <div>A div element.</div>
        <span>Some text.</span>
      `;

      const sections = extractSections(html);

      expect(sections).toHaveLength(0);
    });

    it('should handle empty content', () => {
      const sections = extractSections('');
      expect(sections).toHaveLength(0);
    });

    it('should strip HTML tags from heading content', () => {
      const html = `
        <h1><strong>Bold</strong> and <em>italic</em> text</h1>
        <h2><span class="highlight">Highlighted</span> heading</h2>
      `;

      const sections = extractSections(html);

      expect(sections).toHaveLength(2);
      expect(sections[0].title).toBe('Bold and italic text');
      expect(sections[1].title).toBe('Highlighted heading');
    });

    it('should generate unique IDs for sections', () => {
      const html = `
        <h1>First Section</h1>
        <h1>Second Section</h1>
        <h1>Third Section</h1>
      `;

      const sections = extractSections(html);

      const ids = sections.map(s => s.id);
      const uniqueIds = new Set(ids);

      expect(uniqueIds.size).toBe(ids.length);
    });

    it('should handle headings up to h6', () => {
      const html = `
        <h1>Level 1</h1>
        <h2>Level 2</h2>
        <h3>Level 3</h3>
        <h4>Level 4</h4>
        <h5>Level 5</h5>
        <h6>Level 6</h6>
      `;

      const sections = extractSections(html);

      expect(sections).toHaveLength(6);
      for (let i = 0; i < 6; i++) {
        expect(sections[i].level).toBe(i + 1);
        expect(sections[i].title).toBe(`Level ${i + 1}`);
      }
    });
  });
});
