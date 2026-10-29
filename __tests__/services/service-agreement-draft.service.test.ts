import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  generatedDocument: { findFirst: vi.fn() },
  company: { findMany: vi.fn() },
  companyContact: { findFirst: vi.fn(), findMany: vi.fn() },
  companyOfficer: { findMany: vi.fn() },
  companyShareholder: { findMany: vi.fn() },
  serviceVariant: { findFirst: vi.fn() },
  templatePartial: { findMany: vi.fn() },
  serviceAgreementEntity: { create: vi.fn(), deleteMany: vi.fn() },
  serviceAgreementFeeLine: { create: vi.fn(), deleteMany: vi.fn() },
  serviceAgreementItemEntity: { create: vi.fn(), deleteMany: vi.fn() },
  serviceAgreementItem: {
    create: vi.fn(),
    deleteMany: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  serviceAgreement: { findFirst: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() },
  $transaction: vi.fn(),
}));
const auditMock = vi.hoisted(() => ({ createAuditLog: vi.fn() }));
const companyAccessMock = vi.hoisted(() => ({ checkUserCompanyAccess: vi.fn() }));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/audit', () => auditMock);
vi.mock('@/services/user-company.service', () => companyAccessMock);

import {
  refreshServiceAgreementItemWording,
  getServiceAgreementDraftById,
  snapshotServiceVariant,
  upsertServiceAgreementDraft,
} from '@/services/service-agreement';
import { readOakDocSowSnapshot } from '@/lib/document-editor/oakdoc-partials';

const tenantId = 'tenant-1';
const actor = { tenantId, userId: 'user-1' };

const currentSnapshot = {
  variantId: 'variant-1',
  variantVersion: 2,
  familyName: 'Corporate Services',
  variantName: 'Corporate Secretarial',
  serviceCadence: 'ANNUALLY' as const,
  customCadenceLabel: null,
  partialId: 'partial-1',
  partialVersion: 2,
  partialContent: '<p>Expanded wording</p>',
  placeholders: [{ key: 'service.fields.software', required: true }],
  dependencies: [
    {
      id: 'nested-1',
      name: 'nested-partial',
      version: 2,
      updatedAt: '2026-07-30T00:00:00.000Z',
    },
  ],
};

describe('service agreement draft persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (callback) => callback(prismaMock));
    prismaMock.serviceAgreement.findFirst.mockResolvedValue(null);
    prismaMock.companyOfficer.findMany.mockResolvedValue([]);
    prismaMock.companyShareholder.findMany.mockResolvedValue([]);
    companyAccessMock.checkUserCompanyAccess.mockResolvedValue(true);
  });

  it('pins expanded nested partials while retaining service placeholders', async () => {
    prismaMock.serviceVariant.findFirst.mockResolvedValue({
      id: 'variant-1',
      version: 2,
      name: 'Corporate Secretarial',
      serviceCadence: 'ANNUALLY',
      customCadenceLabel: null,
      family: { name: 'Corporate Services' },
      sowPartial: {
        id: 'partial-1',
        name: 'corporate-secretarial',
        version: 2,
        content: '<h2>{{> nested-partial}}</h2>{{service.fields.software}}',
        placeholders: [{ key: 'service.fields.software', required: true }],
      },
    });
    prismaMock.templatePartial.findMany.mockResolvedValue([
      {
        id: 'nested-1',
        name: 'nested-partial',
        version: 2,
        content: 'Nested wording',
        updatedAt: new Date('2026-07-30T00:00:00.000Z'),
      },
    ]);

    const snapshot = await snapshotServiceVariant('variant-1', tenantId);

    expect(snapshot.partialContent).toBe(
      '<h2>Nested wording</h2>{{service.fields.software}}',
    );
    expect(snapshot.dependencies).toEqual(currentSnapshot.dependencies);
  });

  it('pins the exact bytes of a Word scope-of-work partial', async () => {
    const sha = 'b'.repeat(64);
    const storageKey = `tenant-1/template-partials/partial-1/oakdoc/${sha}.docx`;
    prismaMock.templatePartial.findMany.mockClear();
    prismaMock.serviceVariant.findFirst.mockResolvedValue({
      id: 'variant-1',
      version: 2,
      name: 'Corporate Secretarial',
      serviceCadence: 'ANNUALLY',
      customCadenceLabel: null,
      family: { name: 'Corporate Services' },
      sowPartial: {
        id: 'partial-1',
        name: 'corporate-secretarial',
        version: 5,
        content: '<p data-oakdoc-partial="true">Word-native partial.</p>',
        placeholders: [],
        contentJson: {
          oakDoc: {
            schemaVersion: 1,
            storageKey,
            fileName: 'sow.docx',
            fileSize: 100,
            sha256: sha,
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            fieldTags: ['company.name'],
          },
          oakDocPartials: [],
        },
      },
    });

    const snapshot = await snapshotServiceVariant('variant-1', tenantId);

    expect(prismaMock.templatePartial.findMany).not.toHaveBeenCalled();
    expect(snapshot.partialVersion).toBe(5);
    expect(snapshot.placeholders).toEqual([]);
    expect(readOakDocSowSnapshot(snapshot.partialContent)).toEqual({
      pin: { partialId: 'partial-1', version: 5, sha256: sha, storageKey, nested: [] },
      fieldTags: ['company.name'],
    });
  });

  it('merges required service placeholders declared by nested partials', async () => {
    prismaMock.serviceVariant.findFirst.mockResolvedValue({
      id: 'variant-1',
      version: 2,
      name: 'Corporate Secretarial',
      serviceCadence: 'ANNUALLY',
      customCadenceLabel: null,
      family: { name: 'Corporate Services' },
      sowPartial: {
        id: 'partial-1',
        name: 'corporate-secretarial',
        version: 2,
        content: '<h2>{{> nested-partial}}</h2>',
        placeholders: [],
      },
    });
    prismaMock.templatePartial.findMany.mockResolvedValue([
      {
        id: 'nested-1',
        name: 'nested-partial',
        version: 2,
        content: '{{service.fields.software}}',
        placeholders: [
          {
            key: 'service.fields.software',
            label: 'Accounting software',
            type: 'text',
            required: true,
          },
        ],
        updatedAt: new Date('2026-07-30T00:00:00.000Z'),
      },
    ]);

    const snapshot = await snapshotServiceVariant('variant-1', tenantId);

    expect(snapshot.placeholders).toEqual([
      expect.objectContaining({
        key: 'service.fields.software',
        required: true,
      }),
    ]);
  });

  it('updates a persisted item in place when its variant changes', async () => {
    const companyId = '11111111-1111-4111-8111-111111111111';
    const contactId = '22222222-2222-4222-8222-222222222222';
    const secondContactId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const documentId = '33333333-3333-4333-8333-333333333333';
    const agreementId = '44444444-4444-4444-8444-444444444444';
    const itemId = '55555555-5555-4555-8555-555555555555';
    const oldVariantId = '66666666-6666-4666-8666-666666666666';
    const newVariantId = '77777777-7777-4777-8777-777777777777';
    const entityId = '88888888-8888-4888-8888-888888888888';
    const now = new Date('2026-07-30T00:00:00.000Z');

    prismaMock.generatedDocument.findFirst.mockResolvedValue({ id: documentId });
    prismaMock.company.findMany.mockResolvedValue([
      { id: companyId, name: 'Alpha Pte. Ltd.', uen: '11111111A' },
    ]);
    companyAccessMock.checkUserCompanyAccess.mockResolvedValue(true);
    prismaMock.companyContact.findMany.mockResolvedValue([
      {
        relationship: 'Director',
        contact: {
          id: contactId,
          fullName: 'Alex Tan',
          contactDetails: [],
        },
      },
      {
        relationship: 'Manager',
        contact: {
          id: secondContactId,
          fullName: 'Bea Lim',
          contactDetails: [],
        },
      },
    ]);
    prismaMock.companyShareholder.findMany.mockResolvedValue([{
      contact: {
        id: contactId,
        fullName: 'Alex Tan',
        contactDetails: [],
      },
    }]);
    prismaMock.serviceAgreement.findUnique
      .mockResolvedValueOnce({
        id: agreementId,
        status: 'DRAFT',
        items: [{ id: itemId, serviceVariantId: oldVariantId }],
        entities: [{ id: entityId, companyId }],
      })
      .mockResolvedValueOnce({
        id: agreementId,
        generatedDocumentId: documentId,
        primaryCompanyId: companyId,
        authorizedRepresentativeSnapshots: [
          { id: contactId, name: 'Alex Tan', role: 'Director', email: null, phone: null },
          { id: secondContactId, name: 'Bea Lim', role: 'Manager', email: null, phone: null },
        ],
        signerContactIds: [contactId, secondContactId],
        agreementDate: now,
        effectiveDate: now,
        termMonths: 12,
        status: 'DRAFT',
        entities: [
          {
            id: entityId,
            companyId,
            nameSnapshot: 'Alpha Pte. Ltd.',
            uenSnapshot: '11111111A',
            displayOrder: 0,
          },
        ],
        items: [],
        createdAt: now,
        updatedAt: now,
      });
    prismaMock.serviceAgreement.upsert.mockResolvedValue({ id: agreementId });
    prismaMock.serviceAgreementEntity.create.mockResolvedValue({ id: entityId });
    prismaMock.serviceVariant.findFirst.mockResolvedValue({
      id: newVariantId,
      version: 3,
      name: 'Updated Service',
      serviceCadence: 'MONTHLY',
      customCadenceLabel: null,
      family: { name: 'Accounting' },
      sowPartial: {
        id: '99999999-9999-4999-8999-999999999999',
        name: 'updated-service',
        version: 4,
        content: '<p>Updated wording</p>',
        placeholders: [],
      },
    });
    prismaMock.templatePartial.findMany.mockResolvedValue([]);
    prismaMock.serviceAgreementItem.create.mockResolvedValue({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });
    prismaMock.serviceAgreementItem.update.mockResolvedValue({ id: itemId });

    await upsertServiceAgreementDraft(
      documentId,
      {
        primaryCompanyId: companyId,
        authorizedContactIds: [contactId, secondContactId],
        authorizedRepresentativeRoles: {
          [contactId]: 'Shareholder',
          [secondContactId]: 'Manager',
        },
        signerContactIds: [contactId, secondContactId],
        entityIds: [companyId],
        agreementDate: '2026-07-30',
        effectiveDate: '2026-07-30',
        termMonths: 12,
        items: [
          {
            id: itemId,
            clientKey: 'item-1',
            variantId: newVariantId,
            entityIds: [companyId],
            startDate: '2026-07-30',
            endDate: null,
            fieldValues: {},
            displayOrder: 0,
            feeLines: [
              {
                clientKey: 'fee-1',
                companyId,
                description: 'Monthly fee',
                amount: '100.00',
                currency: 'SGD',
                billingFrequency: 'MONTHLY',
                displayOrder: 0,
              },
            ],
          },
        ],
      },
      actor,
    );

    expect(prismaMock.serviceAgreementItem.create).not.toHaveBeenCalled();
    expect(prismaMock.serviceAgreement.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        signerContactIds: [contactId, secondContactId],
        authorizedRepresentativeSnapshots: [
          expect.objectContaining({
            id: contactId,
            name: 'Alex Tan',
            role: 'Shareholder',
          }),
          expect.objectContaining({ id: secondContactId, name: 'Bea Lim' }),
        ],
      }),
    }));
    expect(prismaMock.serviceAgreementItem.update).toHaveBeenCalledWith({
      where: { id: itemId },
      data: expect.objectContaining({
        serviceVariantId: newVariantId,
        variantVersion: 3,
        partialVersion: 4,
      }),
    });
  });

  it('preserves the pinned representative when the unchanged source contact was deleted', async () => {
    const companyId = '11111111-1111-4111-8111-111111111111';
    const contactId = '22222222-2222-4222-8222-222222222222';
    const documentId = '33333333-3333-4333-8333-333333333333';
    const agreementId = '44444444-4444-4444-8444-444444444444';
    const itemId = '55555555-5555-4555-8555-555555555555';
    const variantId = '66666666-6666-4666-8666-666666666666';
    const entityId = '77777777-7777-4777-8777-777777777777';
    const now = new Date('2026-07-30T00:00:00.000Z');
    const pinnedRepresentative = {
      id: contactId,
      name: 'Pinned Representative',
      role: 'Director',
      email: 'pinned@example.com',
      phone: '+65 6000 0000',
    };

    prismaMock.generatedDocument.findFirst.mockResolvedValue({ id: documentId });
    prismaMock.company.findMany.mockResolvedValue([
      { id: companyId, name: 'Alpha Pte. Ltd.', uen: '11111111A' },
    ]);
    prismaMock.serviceAgreement.findUnique
      .mockResolvedValueOnce({
        id: agreementId,
        status: 'DRAFT',
        primaryCompanyId: companyId,
        authorizedRepresentativeSnapshots: [pinnedRepresentative],
        signerContactIds: [contactId],
        items: [{
          id: itemId,
          serviceVariantId: variantId,
          partialPlaceholdersSnapshot: [],
        }],
        entities: [{ id: entityId, companyId }],
      })
      .mockResolvedValueOnce({
        id: agreementId,
        generatedDocumentId: documentId,
        primaryCompanyId: companyId,
        authorizedRepresentativeSnapshots: [pinnedRepresentative],
        signerContactIds: [contactId],
        agreementDate: now,
        effectiveDate: now,
        termMonths: 12,
        status: 'DRAFT',
        entities: [{
          id: entityId,
          companyId,
          nameSnapshot: 'Alpha Pte. Ltd.',
          uenSnapshot: '11111111A',
          displayOrder: 0,
        }],
        items: [],
        createdAt: now,
        updatedAt: now,
      });
    prismaMock.serviceAgreement.upsert.mockResolvedValue({ id: agreementId });
    prismaMock.serviceAgreementEntity.create.mockResolvedValue({ id: entityId });
    prismaMock.serviceAgreementItem.update.mockResolvedValue({ id: itemId });

    const saved = await upsertServiceAgreementDraft(
      documentId,
      {
        primaryCompanyId: companyId,
        authorizedContactIds: [contactId],
        signerContactIds: [contactId],
        entityIds: [companyId],
        agreementDate: '2026-07-30',
        effectiveDate: '2026-07-30',
        termMonths: 12,
        items: [{
          id: itemId,
          clientKey: itemId,
          variantId,
          entityIds: [companyId],
          startDate: '2026-07-30',
          endDate: null,
          fieldValues: {},
          displayOrder: 0,
          feeLines: [{
            clientKey: 'fee-1',
            companyId,
            description: 'Annual fee',
            amount: '500.00',
            currency: 'SGD',
            billingFrequency: 'ANNUALLY',
            displayOrder: 0,
          }],
        }],
      },
      actor,
    );

    expect(prismaMock.companyContact.findMany).not.toHaveBeenCalled();
    expect(saved.authorizedRepresentativeSnapshots).toEqual([pinnedRepresentative]);
    expect(prismaMock.serviceAgreement.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        authorizedRepresentativeSnapshots: [pinnedRepresentative],
        signerContactIds: [contactId],
      }),
    }));
  });

  it('rejects a changed role on a saved representative when it is not current', async () => {
    const companyId = '11111111-1111-4111-8111-111111111111';
    const contactId = '22222222-2222-4222-8222-222222222222';
    const documentId = '33333333-3333-4333-8333-333333333333';
    const itemId = '55555555-5555-4555-8555-555555555555';
    const variantId = '66666666-6666-4666-8666-666666666666';
    const pinnedRepresentative = {
      id: contactId,
      name: 'Pinned Representative',
      role: 'Director',
      email: 'pinned@example.com',
      phone: '+65 6000 0000',
    };
    prismaMock.generatedDocument.findFirst.mockResolvedValue({ id: documentId });
    prismaMock.company.findMany.mockResolvedValue([
      { id: companyId, name: 'Alpha Pte. Ltd.', uen: '11111111A' },
    ]);
    prismaMock.serviceAgreement.findUnique.mockResolvedValue({
      id: 'agreement-1',
      status: 'DRAFT',
      primaryCompanyId: companyId,
      authorizedRepresentativeSnapshots: [pinnedRepresentative],
      items: [{
        id: itemId,
        serviceVariantId: variantId,
        partialPlaceholdersSnapshot: [],
      }],
      entities: [],
    });
    prismaMock.companyContact.findMany.mockResolvedValue([{
      relationship: 'Director',
      contact: {
        id: contactId,
        fullName: 'Pinned Representative',
        contactDetails: [],
      },
    }]);

    await expect(upsertServiceAgreementDraft(documentId, {
      primaryCompanyId: companyId,
      authorizedContactIds: [contactId],
      authorizedRepresentativeRoles: { [contactId]: 'CEO' },
      signerContactIds: [contactId],
      entityIds: [companyId],
      agreementDate: '2026-07-30',
      effectiveDate: '2026-07-30',
      termMonths: 12,
      items: [{
        id: itemId,
        clientKey: itemId,
        variantId,
        entityIds: [companyId],
        startDate: '2026-07-30',
        endDate: null,
        fieldValues: {},
        displayOrder: 0,
        feeLines: [{
          clientKey: 'fee-1',
          companyId,
          description: 'Annual fee',
          amount: '500.00',
          currency: 'SGD',
          billingFrequency: 'ANNUALLY',
          displayOrder: 0,
        }],
      }],
    }, actor)).rejects.toThrow('CEO is not a current appointment');
  });

  it('rechecks access to every agreement entity when a draft is read', async () => {
    const now = new Date('2026-07-30T00:00:00.000Z');
    prismaMock.serviceAgreement.findFirst.mockResolvedValue({
      id: 'agreement-1',
      generatedDocumentId: 'document-1',
      primaryCompanyId: 'company-1',
      authorizedRepresentativeSnapshots: [{
        id: 'contact-1',
        name: 'Alex Tan',
        role: 'Director',
        email: null,
        phone: null,
      }],
      signerContactIds: ['contact-1'],
      agreementDate: now,
      effectiveDate: now,
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
      createdAt: now,
      updatedAt: now,
    });
    prismaMock.company.findMany.mockResolvedValue([
      { id: 'company-1', name: 'Alpha Pte. Ltd.', uen: '11111111A' },
    ]);
    companyAccessMock.checkUserCompanyAccess.mockResolvedValue(false);

    await expect(getServiceAgreementDraftById(
      'agreement-1',
      actor,
    )).rejects.toMatchObject({ statusCode: 403 });
  });

  it('refreshes only pinned wording fields and preserves structured entered data', async () => {
    prismaMock.serviceAgreementItem.findFirst.mockResolvedValue({
      id: 'item-1',
      tenantId,
      serviceVariantId: 'variant-1',
      variantVersion: 1,
      partialVersion: 1,
      agreement: { status: 'DRAFT' },
    });
    prismaMock.serviceVariant.findFirst.mockResolvedValue({
      id: 'variant-1',
      version: currentSnapshot.variantVersion,
      name: currentSnapshot.variantName,
      serviceCadence: currentSnapshot.serviceCadence,
      customCadenceLabel: null,
      family: { name: currentSnapshot.familyName },
      sowPartial: {
        id: currentSnapshot.partialId,
        name: 'corporate-secretarial',
        version: currentSnapshot.partialVersion,
        content: currentSnapshot.partialContent,
        placeholders: currentSnapshot.placeholders,
      },
    });
    prismaMock.templatePartial.findMany.mockResolvedValue([]);
    prismaMock.serviceAgreementItem.update.mockResolvedValue({
      id: 'item-1',
      ...currentSnapshot,
      serviceVariantId: 'variant-1',
      familyNameSnapshot: currentSnapshot.familyName,
      variantNameSnapshot: currentSnapshot.variantName,
      sowPartialId: currentSnapshot.partialId,
      partialContentSnapshot: currentSnapshot.partialContent,
      partialPlaceholdersSnapshot: currentSnapshot.placeholders,
      partialDependencySnapshot: [],
      startDate: new Date('2026-07-30'),
      endDate: null,
      fieldValues: { software: 'Xero' },
      displayOrder: 0,
      entityLinks: [],
      feeLines: [],
      serviceVariant: { version: 2, sowPartial: { version: 2 } },
    });

    await refreshServiceAgreementItemWording(
      'item-1',
      { expectedVariantVersion: 1, expectedPartialVersion: 1 },
      actor,
    );

    expect(prismaMock.serviceAgreementItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({
          fieldValues: expect.anything(),
          startDate: expect.anything(),
        }),
      }),
    );
  });

  it('rejects refresh when the caller versions are stale', async () => {
    prismaMock.serviceAgreementItem.findFirst.mockResolvedValue({
      id: 'item-1',
      tenantId,
      serviceVariantId: 'variant-1',
      variantVersion: 2,
      partialVersion: 3,
      agreement: { status: 'DRAFT' },
    });

    await expect(
      refreshServiceAgreementItemWording(
        'item-1',
        { expectedVariantVersion: 1, expectedPartialVersion: 3 },
        actor,
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});
