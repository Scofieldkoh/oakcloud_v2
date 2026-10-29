import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    generatedDocument: {
      create: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    serviceAgreement: {
      delete: vi.fn(),
      findFirst: vi.fn(),
    },
    documentTemplate: {
      findFirst: vi.fn(),
    },
    contact: {
      findMany: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
    },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/audit', () => ({
  createAuditLog: vi.fn(),
  computeChanges: vi.fn(),
}));

vi.mock('@/lib/placeholder-resolver', () => ({
  resolvePlaceholders: vi.fn(),
  prepareCompanyContext: vi.fn(),
  extractPartialReferences: vi.fn(() => []),
}));

vi.mock('@/services/template-partial.service', () => ({
  getPartialsUsedInTemplate: vi.fn(),
}));

vi.mock('@/services/company.service', () => ({
  getCompanyById: vi.fn(),
}));

vi.mock('@/services/document-party.service', () => ({
  getDocumentPartyOptions: vi.fn(),
  resolveDocumentPartySelections: vi.fn(),
}));

const serviceAgreementMock = vi.hoisted(() => ({
  getServiceAgreementDraft: vi.fn(),
  getServiceAgreementDraftById: vi.fn(),
}));

vi.mock('@/services/service-agreement', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/service-agreement')>()),
  ...serviceAgreementMock,
}));

vi.mock('@/lib/encryption', () => ({
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
}));

vi.mock('@/services/tasks/integration.service', () => ({
  safelyReconcileGeneratedDocumentTaskOutcomes: vi.fn(),
}));

vi.mock('@/services/tasks/esigning-preparation.service', () => ({
  assertGeneratedDocumentCanBeUnfinalized: vi.fn(),
  queueTaskEsigningPreparationsForGeneratedDocument: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import {
  cloneDocument,
  createBlankDocument,
  createDocumentFromTemplate,
  updateGeneratedDocument,
  finalizeDocument,
  getGeneratedDocumentById,
  renderTemplateForGeneration,
  searchGeneratedDocuments,
  unfinalizeDocument,
} from '@/services/document-generator.service';
import { extractPartialReferences, resolvePlaceholders } from '@/lib/placeholder-resolver';
import { getPartialsUsedInTemplate } from '@/services/template-partial.service';
import {
  getDocumentPartyOptions,
  resolveDocumentPartySelections,
} from '@/services/document-party.service';
import {
  assertGeneratedDocumentCanBeUnfinalized,
  queueTaskEsigningPreparationsForGeneratedDocument,
} from '@/services/tasks/esigning-preparation.service';

describe('Document generator service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.generatedDocument.findMany).mockResolvedValue([]);
    vi.mocked(prisma.generatedDocument.count).mockResolvedValue(0);
    vi.mocked(prisma.generatedDocument.update).mockResolvedValue({
      id: 'doc-1',
      title: 'Updated document',
      companyId: null,
    } as never);
    vi.mocked(getPartialsUsedInTemplate).mockResolvedValue([]);
    vi.mocked(resolvePlaceholders).mockReturnValue({
      resolved: '<p>Resolved template content</p>',
      missing: [],
      missingPartials: [],
    });
    vi.mocked(prisma.contact.findMany).mockResolvedValue([]);
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null);
    serviceAgreementMock.getServiceAgreementDraft.mockResolvedValue(null);
    serviceAgreementMock.getServiceAgreementDraftById.mockResolvedValue(null);
    vi.mocked(prisma.serviceAgreement.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ revision: 1 }] as never);
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) => callback(prisma));
    vi.mocked(getDocumentPartyOptions).mockResolvedValue({
      directors: [],
      shareholders: [],
      contacts: [],
      officers: [],
    });
    vi.mocked(resolveDocumentPartySelections).mockResolvedValue({});
  });

  it('loads live linked envelope summaries with document details', async () => {
    vi.mocked(prisma.generatedDocument.findFirst).mockResolvedValue(null);

    await getGeneratedDocumentById('doc-1', 'workspace-1');

    expect(prisma.generatedDocument.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          esigningEnvelopeDocuments: {
            where: { envelope: { deletedAt: null } },
            orderBy: { createdAt: 'desc' },
            select: {
              envelope: {
                select: {
                  id: true,
                  title: true,
                  status: true,
                  completedAt: true,
                },
              },
            },
          },
        }),
      }),
    );
  });

  it('requires a workspace id for generated document search', async () => {
    await expect(
      searchGeneratedDocuments(
        {
          page: 1,
          limit: 20,
          sortBy: 'updatedAt',
          sortOrder: 'desc',
        },
        ''
      )
    ).rejects.toThrow('Tenant ID is required for generated documents search');

    expect(prisma.generatedDocument.findMany).not.toHaveBeenCalled();
    expect(prisma.generatedDocument.count).not.toHaveBeenCalled();
  });

  it('applies the workspace filter to list and count queries', async () => {
    await searchGeneratedDocuments(
      {
        query: 'minutes',
        page: 2,
        limit: 10,
        sortBy: 'updatedAt',
        sortOrder: 'desc',
      },
      'workspace-1'
    );

    expect(prisma.generatedDocument.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'workspace-1',
          deletedAt: null,
          OR: expect.any(Array),
        }),
        skip: 10,
        take: 10,
      })
    );
    expect(prisma.generatedDocument.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        tenantId: 'workspace-1',
        deletedAt: null,
      }),
    });
  });

  it('excludes incomplete batch children from document search', async () => {
    await searchGeneratedDocuments(
      {
        page: 1,
        limit: 20,
        sortBy: 'updatedAt',
        sortOrder: 'desc',
      },
      'workspace-1',
    );

    expect(prisma.generatedDocument.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            { OR: [{ batchItem: null }, { batchItem: { status: 'GENERATED' } }] },
          ]),
        }),
      }),
    );
    expect(prisma.generatedDocument.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        AND: expect.arrayContaining([
          { OR: [{ batchItem: null }, { batchItem: { status: 'GENERATED' } }] },
        ]),
      }),
    });
  });

  it('applies title, created-by, signed, and updated date filters to generated document search', async () => {
    await searchGeneratedDocuments(
      {
        page: 1,
        limit: 20,
        sortBy: 'updatedAt',
        sortOrder: 'desc',
        title: 'minutes',
        createdBy: 'sam',
        signedFrom: '2026-07-01',
        signedTo: '2026-07-31',
        updatedFrom: '2026-08-01',
        updatedTo: '2026-08-07',
      },
      'workspace-1'
    );

    expect(prisma.generatedDocument.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'workspace-1',
          deletedAt: null,
          title: { contains: 'minutes', mode: 'insensitive' },
          createdBy: {
            OR: [
              { firstName: { contains: 'sam', mode: 'insensitive' } },
              { lastName: { contains: 'sam', mode: 'insensitive' } },
            ],
          },
          signedAt: {
            gte: expect.any(Date),
            lte: expect.any(Date),
          },
          updatedAt: {
            gte: expect.any(Date),
            lte: expect.any(Date),
          },
        }),
      })
    );
  });

  it('sorts generated documents by related company and creator fields', async () => {
    await searchGeneratedDocuments(
      {
        page: 1,
        limit: 20,
        sortBy: 'companyName',
        sortOrder: 'asc',
      },
      'workspace-1'
    );

    expect(prisma.generatedDocument.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { company: { name: 'asc' } },
      })
    );

    await searchGeneratedDocuments(
      {
        page: 1,
        limit: 20,
        sortBy: 'createdByName',
        sortOrder: 'desc',
      },
      'workspace-1'
    );

    expect(prisma.generatedDocument.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        orderBy: { createdBy: { firstName: 'desc' } },
      })
    );

    await searchGeneratedDocuments(
      {
        page: 1,
        limit: 20,
        sortBy: 'templateName',
        sortOrder: 'asc',
      },
      'workspace-1'
    );

    expect(prisma.generatedDocument.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        orderBy: { template: { name: 'asc' } },
      })
    );
  });

  it('sorts generated documents by signed date', async () => {
    await searchGeneratedDocuments(
      {
        page: 1,
        limit: 20,
        sortBy: 'signedAt',
        sortOrder: 'asc',
      },
      'workspace-1',
    );

    expect(prisma.generatedDocument.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { signedAt: 'asc' },
      }),
    );
  });

  it('does not finalize documents with unresolved placeholders or partials', async () => {
    vi.mocked(prisma.generatedDocument.findFirst).mockResolvedValue({
      id: 'doc-1',
      tenantId: 'workspace-1',
      title: 'Incomplete document',
      status: 'DRAFT',
      deletedAt: null,
      metadata: {
        missingPlaceholders: ['company.name'],
        missingPartials: ['signing-block'],
      },
    } as never);

    await expect(
      finalizeDocument('doc-1', { tenantId: 'workspace-1', userId: 'user-1' })
    ).rejects.toThrow('Cannot finalize document with unresolved placeholders or partials');

    expect(prisma.generatedDocument.update).not.toHaveBeenCalled();
  });

  it('queues background E-signing preparation after finalization', async () => {
    vi.mocked(prisma.generatedDocument.findFirst).mockResolvedValue({
      id: 'doc-1',
      tenantId: 'workspace-1',
      title: 'Final contract',
      status: 'DRAFT',
      deletedAt: null,
      metadata: null,
    } as never);
    vi.mocked(prisma.generatedDocument.update).mockResolvedValue({
      id: 'doc-1',
      title: 'Final contract',
      companyId: null,
      status: 'FINALIZED',
    } as never);

    await finalizeDocument('doc-1', {
      tenantId: 'workspace-1',
      userId: 'user-1',
    });

    expect(queueTaskEsigningPreparationsForGeneratedDocument)
      .toHaveBeenCalledWith('workspace-1', 'doc-1', 'user-1');
  });

  it('blocks unfinalization for a non-draft prepared envelope and queues detach otherwise', async () => {
    vi.mocked(prisma.generatedDocument.findFirst).mockResolvedValue({
      id: 'doc-1',
      tenantId: 'workspace-1',
      title: 'Final contract',
      status: 'FINALIZED',
      deletedAt: null,
      metadata: null,
    } as never);
    vi.mocked(prisma.generatedDocument.update).mockResolvedValue({
      id: 'doc-1',
      title: 'Final contract',
      companyId: null,
      status: 'DRAFT',
    } as never);
    vi.mocked(assertGeneratedDocumentCanBeUnfinalized)
      .mockRejectedValueOnce(new Error(
        'Void the active E-signing envelope before unfinalizing this document',
      ));

    await expect(unfinalizeDocument(
      'doc-1',
      { tenantId: 'workspace-1', userId: 'user-1' },
      'Needs changes',
    )).rejects.toThrow('Void the active E-signing envelope');
    expect(prisma.generatedDocument.update).not.toHaveBeenCalled();

    vi.mocked(assertGeneratedDocumentCanBeUnfinalized).mockResolvedValue(undefined);
    await unfinalizeDocument(
      'doc-1',
      { tenantId: 'workspace-1', userId: 'user-1' },
      'Needs changes',
    );
    expect(assertGeneratedDocumentCanBeUnfinalized)
      .toHaveBeenLastCalledWith('workspace-1', 'doc-1', prisma);
    expect(queueTaskEsigningPreparationsForGeneratedDocument)
      .toHaveBeenCalledWith('workspace-1', 'doc-1', 'user-1');
  });

  it('renders templates through one shared path with contacts, sections, and unresolved data', async () => {
    vi.mocked(prisma.documentTemplate.findFirst).mockResolvedValue({
      id: 'template-1',
      tenantId: 'workspace-1',
      name: 'Resolution',
      category: 'RESOLUTION',
      content: '<h1>{{contact.fullName}}</h1><p>{{> signing-block}}</p>',
      contentJson: null,
      version: 1,
      isActive: true,
    } as never);
    vi.mocked(prisma.contact.findMany).mockResolvedValue([
      {
        id: 'contact-1',
        firstName: 'Jane',
        lastName: 'Tan',
        fullName: 'Jane Tan',
        contactType: 'CLIENT',
        fullAddress: '1 Example Road',
        nationality: 'Singaporean',
        identificationNumber: 'S1234567A',
        contactDetails: [{ detailType: 'EMAIL', value: 'jane@example.com' }],
      },
    ] as never);
    vi.mocked(getPartialsUsedInTemplate).mockResolvedValue([
      { name: 'signing-block', content: '<p>{{missing.value}}</p>' },
    ] as never);
    vi.mocked(extractPartialReferences).mockReturnValue(['signing-block']);
    vi.mocked(resolvePlaceholders).mockReturnValue({
      resolved: '<h1>Jane Tan</h1><p><span class="placeholder-missing">[missing.value]</span></p>',
      missing: ['missing.value'],
      missingPartials: [],
    });

    const result = await renderTemplateForGeneration({
      templateId: 'template-1',
      tenantId: 'workspace-1',
      contactIds: ['contact-1'],
      customData: {},
      mode: 'preview',
    });

    expect(resolvePlaceholders).toHaveBeenCalledWith(
      '<h1>{{contact.fullName}}</h1><p>{{> signing-block}}</p>',
      expect.objectContaining({
        contact: expect.objectContaining({ fullName: 'Jane Tan' }),
        contacts: [expect.objectContaining({ fullName: 'Jane Tan' })],
      }),
      expect.objectContaining({
        missingPlaceholder: 'highlight',
        partialsMap: new Map([['signing-block', '<p>{{missing.value}}</p>']]),
      })
    );
    expect(result.content).toContain('id="section-0"');
    expect(result.sections).toEqual([
      expect.objectContaining({ id: 'section-0', title: 'Jane Tan', level: 1 }),
    ]);
    expect(result.missingPlaceholders).toEqual(['missing.value']);
    expect(result.contextSummary).toEqual({
      hasCompany: false,
      hasContacts: true,
      hasCustomData: false,
    });
    expect(result.blockingErrors).toContain('Unresolved placeholders: missing.value');
  });

  it('renders unsaved template content through the shared path', async () => {
    vi.mocked(extractPartialReferences).mockReturnValue([]);
    vi.mocked(resolvePlaceholders).mockReturnValue({
      resolved: '<h1>Preview Draft</h1>',
      missing: [],
      missingPartials: [],
    });

    const result = await renderTemplateForGeneration({
      tenantId: 'workspace-1',
      templateContent: '<h1>{{custom.title}}</h1>',
      templateName: 'Editor draft',
      customData: { title: 'Preview Draft' },
      mode: 'test',
    });

    expect(prisma.documentTemplate.findFirst).not.toHaveBeenCalled();
    expect(resolvePlaceholders).toHaveBeenCalledWith(
      '<h1>{{custom.title}}</h1>',
      expect.objectContaining({
        custom: expect.objectContaining({ title: 'Preview Draft' }),
      }),
      expect.objectContaining({ missingPlaceholder: 'highlight' })
    );
    expect(result.template).toEqual({
      id: 'ad-hoc',
      name: 'Editor draft',
      category: 'OTHER',
      version: 1,
    });
    expect(result.content).toContain('Preview Draft');
  });

  it.each([
    ['selectedDirector.name', 'selectedDirectorId', 'Select a director for this template.'],
    ['selectedShareholder.name', 'selectedShareholderId', 'Select a shareholder for this template.'],
    ['selectedContact.name', 'selectedContactId', 'Select a company contact for this template.'],
  ])('rejects preview when %s is referenced without %s', async (placeholder, _idField, message) => {
    await expect(renderTemplateForGeneration({
      tenantId: 'workspace-1',
      companyId: 'company-1',
      templateContent: `<p>{{${placeholder}}}</p>`,
      contextOverride: {
        company: { id: 'company-1', name: 'Example Pte. Ltd.', uen: '202600001A' },
      },
      mode: 'preview',
    })).rejects.toThrow(message);
  });

  it('rejects preview when a nested partial introduces an omitted singular selection', async () => {
    vi.mocked(extractPartialReferences).mockReturnValue(['party-block']);
    vi.mocked(getPartialsUsedInTemplate).mockResolvedValue([
      { name: 'party-block', content: '<p>{{selectedDirector.name}}</p>' },
    ] as never);

    await expect(renderTemplateForGeneration({
      tenantId: 'workspace-1',
      templateContent: '<div>{{> party-block}}</div>',
      mode: 'preview',
    })).rejects.toThrow('Select a director for this template.');
  });

  it('refuses A4 generation, blank A4 documents and A4 copies now that the editor is retired', async () => {
    const params = { tenantId: 'workspace-1', userId: 'user-1' };
    await expect(createDocumentFromTemplate(
      { templateId: 'template-1', companyId: 'company-1', title: 'Party letter' },
      params,
    )).rejects.toMatchObject({ details: { reason: 'A4_EDITOR_RETIRED', operation: 'document-generate' } });
    await expect(createBlankDocument({ title: 'Blank', content: '', useLetterhead: true }, params))
      .rejects.toMatchObject({ details: { reason: 'A4_EDITOR_RETIRED' } });

    vi.mocked(prisma.generatedDocument.findFirst).mockResolvedValue({
      id: 'document-1',
      tenantId: 'workspace-1',
      status: 'DRAFT',
      title: 'Old letter',
      content: '<p>Old</p>',
      contentJson: null,
      metadata: {},
    } as never);
    await expect(cloneDocument({ id: 'document-1' }, params))
      .rejects.toMatchObject({ details: { reason: 'A4_EDITOR_RETIRED', operation: 'document-clone' } });
    await expect(updateGeneratedDocument({ id: 'document-1', expectedRevision: 0, content: '<p>New</p>' }, params))
      .rejects.toMatchObject({ details: { reason: 'A4_EDITOR_RETIRED', operation: 'document-edit' } });
    expect(prisma.generatedDocument.create).not.toHaveBeenCalled();
  });

  it('keeps server-validated selected parties independent from legacy override contacts', async () => {
    const selectedContact = {
      id: 'contact-1',
      contactId: 'contact-1',
      name: 'Selected Contact',
      detail: 'Secretary',
      contactType: 'INDIVIDUAL',
      email: 'selected@example.com',
      phone: '+65 6000 0000',
      address: { letter: '10 Main Street', full: '10 Main Street' },
    };
    const selections = {
      selectedDirector: { ...selectedContact, id: 'officer-1', name: 'Director One' },
      selectedShareholder: { ...selectedContact, id: 'shareholder-1', name: 'Shareholder One' },
      selectedContact,
    };
    vi.mocked(resolveDocumentPartySelections).mockResolvedValue(selections);

    const result = await renderTemplateForGeneration({
      tenantId: 'workspace-1',
      companyId: 'company-1',
      templateContent: '<p>{{selectedContact.name}}</p>',
      contextOverride: {
        company: { id: 'company-1', name: 'Example Pte. Ltd.', uen: '202600001A' },
        contacts: [{ id: 'legacy-1', fullName: 'Legacy Contact', contactType: 'INDIVIDUAL' }],
      },
      selectedDirectorId: 'officer-1',
      selectedShareholderId: 'shareholder-1',
      selectedContactId: 'contact-1',
    });

    expect(resolveDocumentPartySelections).toHaveBeenCalledWith({
      companyId: 'company-1',
      tenantId: 'workspace-1',
      selectedDirectorId: 'officer-1',
      selectedShareholderId: 'shareholder-1',
      selectedContactId: 'contact-1',
    });
    expect(result.context).toEqual(expect.objectContaining(selections));
    expect(result.context.contact).toEqual(expect.objectContaining({
      id: 'legacy-1',
      fullName: 'Legacy Contact',
    }));
    expect(result.context.contacts).toEqual([
      expect.objectContaining({ id: 'legacy-1', fullName: 'Legacy Contact' }),
    ]);
    expect(result.context.custom?.contacts).toEqual(result.context.contacts);
  });

  it('keeps selectedContactId independent when legacy contactIds are also supplied', async () => {
    vi.mocked(resolveDocumentPartySelections).mockResolvedValue({
      selectedContact: {
        id: 'contact-1',
        contactId: 'contact-1',
        name: 'Selected Contact',
        detail: 'Secretary',
        contactType: 'INDIVIDUAL',
        email: 'selected@example.com',
        phone: '+65 6000 0000',
        address: { letter: '10 Main Street', full: '10 Main Street' },
      },
    });
    vi.mocked(prisma.contact.findMany).mockResolvedValue([
      {
        id: 'contact-1',
        firstName: 'Selected',
        lastName: 'Contact',
        fullName: 'Selected Contact',
        contactType: 'INDIVIDUAL',
        fullAddress: '10 Main Street',
        nationality: null,
        identificationNumber: null,
        contactDetails: [],
      },
      {
        id: 'contact-2',
        firstName: 'Legacy',
        lastName: 'Contact',
        fullName: 'Legacy Contact',
        contactType: 'INDIVIDUAL',
        fullAddress: '20 Side Street',
        nationality: null,
        identificationNumber: null,
        contactDetails: [],
      },
    ] as never);

    const result = await renderTemplateForGeneration({
      tenantId: 'workspace-1',
      companyId: 'company-1',
      templateContent: '<p>{{contact.fullName}}</p>',
      contextOverride: {
        company: { id: 'company-1', name: 'Example Pte. Ltd.', uen: '202600001A' },
      },
      contactIds: ['contact-1', 'contact-2'],
      selectedContactId: 'contact-1',
    });

    expect(prisma.contact.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: { in: ['contact-1', 'contact-2'] },
        tenantId: 'workspace-1',
        deletedAt: null,
      },
    }));
    expect(result.context.contacts?.map((contact) => contact.id)).toEqual([
      'contact-1',
      'contact-2',
    ]);
    expect(result.context.selectedContact?.id).toBe('contact-1');
    expect(result.context.contact).toBe(result.context.contacts?.[0]);
    expect(result.context.custom?.contacts).toBe(result.context.contacts);
  });

  it('renders Service Agreement representative and signer collections from saved snapshots', async () => {
    vi.mocked(prisma.documentTemplate.findFirst).mockResolvedValue({
      id: 'template-1',
      tenantId: 'workspace-1',
      name: 'Service Agreement',
      category: 'CONTRACT',
      content: [
        '<p>{{selectedContact.name}} {{selectedContact.detail}} ',
        '{{selectedContact.email}} {{selectedContact.phone}}</p>',
        '{{@agreement.serviceSections}}',
        '{{@agreement.feeTable}}',
        '{{@agreement.entityAppendix}}',
      ].join(''),
      version: 1,
      isActive: true,
      compositionType: 'SERVICE_AGREEMENT',
      placeholders: [],
    } as never);
    serviceAgreementMock.getServiceAgreementDraftById.mockResolvedValue({
      id: 'agreement-1',
      generatedDocumentId: 'document-1',
      primaryCompanyId: 'company-1',
      authorizedContactIds: ['deleted-contact', 'second-contact'],
      signerContactIds: ['deleted-contact', 'second-contact'],
      authorizedRepresentativeSnapshots: [
        {
          id: 'deleted-contact',
          name: 'Pinned Name',
          role: 'Director',
          email: 'pinned@example.com',
          phone: '+65 6123 4567',
        },
        {
          id: 'second-contact',
          name: 'Second Signer',
          role: 'Manager',
          email: 'second@example.com',
          phone: null,
        },
      ],
      agreementDate: '2026-07-30',
      effectiveDate: '2026-08-01',
      termMonths: 12,
      status: 'DRAFT',
      entities: [{
        id: 'entity-1',
        companyId: 'company-1',
        nameSnapshot: 'Alpha Pte. Ltd.',
        uenSnapshot: '11111111A',
        displayOrder: 0,
      }],
      items: [],
      createdAt: '2026-07-30T00:00:00.000Z',
      updatedAt: '2026-07-30T00:00:00.000Z',
    });

    const result = await renderTemplateForGeneration({
      tenantId: 'workspace-1',
      userId: 'user-1',
      companyId: 'company-1',
      templateId: 'template-1',
      serviceAgreementId: 'agreement-1',
      generatedDocumentId: 'document-1',
      // The wizard retains this historical ID, even after the contact has
      // been removed. The saved representative snapshot must remain usable.
      selectedContactId: 'deleted-contact',
      contextOverride: {
        company: { id: 'company-1', name: 'Alpha Pte. Ltd.', uen: '11111111A' },
      },
    });

    expect(resolveDocumentPartySelections).not.toHaveBeenCalled();
    expect(result.context.selectedContact).toEqual(expect.objectContaining({
      id: 'deleted-contact',
      name: 'Pinned Name',
      detail: 'Director',
      email: 'pinned@example.com',
      phone: '+65 6123 4567',
    }));
    expect(result.context.authorizedRepresentatives?.map((representative) => representative.id))
      .toEqual(['deleted-contact', 'second-contact']);
    expect(result.context.signers?.map((signer) => signer.id))
      .toEqual(['deleted-contact', 'second-contact']);
  });

  it('renders Service Agreement representative email/phone as blank when the snapshot omits them', async () => {
    vi.mocked(prisma.documentTemplate.findFirst).mockResolvedValue({
      id: 'template-1',
      tenantId: 'workspace-1',
      name: 'Service Agreement',
      category: 'CONTRACT',
      content: [
        '<p>{{selectedContact.name}} {{selectedContact.detail}} ',
        '{{selectedContact.email}} {{selectedContact.phone}}</p>',
        '{{@agreement.serviceSections}}',
        '{{@agreement.feeTable}}',
        '{{@agreement.entityAppendix}}',
      ].join(''),
      version: 1,
      isActive: true,
      compositionType: 'SERVICE_AGREEMENT',
      placeholders: [],
    } as never);
    serviceAgreementMock.getServiceAgreementDraftById.mockResolvedValue({
      id: 'agreement-1',
      generatedDocumentId: 'document-1',
      primaryCompanyId: 'company-1',
      authorizedContactIds: ['contact-1'],
      signerContactIds: ['contact-1'],
      authorizedRepresentativeSnapshots: [{
        id: 'contact-1',
        name: 'Pinned Name',
        role: 'Director',
        email: null,
        phone: null,
      }],
      agreementDate: '2026-07-30',
      effectiveDate: '2026-08-01',
      termMonths: 12,
      status: 'DRAFT',
      entities: [{
        id: 'entity-1',
        companyId: 'company-1',
        nameSnapshot: 'Alpha Pte. Ltd.',
        uenSnapshot: '11111111A',
        displayOrder: 0,
      }],
      items: [],
      createdAt: '2026-07-30T00:00:00.000Z',
      updatedAt: '2026-07-30T00:00:00.000Z',
    });

    const result = await renderTemplateForGeneration({
      tenantId: 'workspace-1',
      userId: 'user-1',
      companyId: 'company-1',
      templateId: 'template-1',
      serviceAgreementId: 'agreement-1',
      generatedDocumentId: 'document-1',
      selectedContactId: 'contact-1',
      contextOverride: {
        company: { id: 'company-1', name: 'Alpha Pte. Ltd.', uen: '11111111A' },
      },
    });

    expect(result.context.selectedContact).toEqual(expect.objectContaining({
      id: 'contact-1',
      name: 'Pinned Name',
      detail: 'Director',
      email: '',
      phone: '',
    }));
  });

});
