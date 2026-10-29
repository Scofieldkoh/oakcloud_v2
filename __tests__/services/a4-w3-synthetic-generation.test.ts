import { beforeEach, describe, expect, it, vi } from 'vitest';

const taskMocks = vi.hoisted(() => ({
  findTaskStageOutcome: vi.fn(),
  getTaskStageDetail: vi.fn(),
  linkTaskStageOutcome: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    taskStageOutcome: { findFirst: taskMocks.findTaskStageOutcome },
  },
}));

vi.mock('@/services/tasks/stage.service', () => ({
  getTaskStageDetail: taskMocks.getTaskStageDetail,
  linkTaskStageOutcome: taskMocks.linkTaskStageOutcome,
  reconcileTaskStageOutcome: vi.fn(),
}));

vi.mock('@/services/tasks/access', () => ({
  requireTaskAccess: vi.fn(),
  requireTaskOutcomeAccess: vi.fn(),
}));

import { SERVICE_AGREEMENT_SLOTS } from '@/lib/service-agreement-template';
import { assembleServiceAgreementTemplate } from '@/services/service-agreement/renderer';
import type { ServiceAgreementDraftDto } from '@/services/service-agreement/types';
import { linkFirstGeneratedDocumentTaskOutcomeForBatch } from '@/services/tasks/integration.service';

describe('W3 synthetic Service Agreement generation regression', () => {
  it('assembles a snapshot-only agreement without signing, filing, messaging or live records', () => {
    const agreement: ServiceAgreementDraftDto = {
      id: 'synthetic-agreement',
      generatedDocumentId: 'synthetic-document',
      primaryCompanyId: 'synthetic-company',
      authorizedContactIds: ['synthetic-contact'],
      signerContactIds: ['synthetic-contact'],
      authorizedRepresentativeSnapshots: [{
        id: 'synthetic-contact',
        name: 'Synthetic Representative',
        role: 'Director',
        email: 'synthetic@example.invalid',
        phone: null,
      }],
      agreementDate: '2026-09-13',
      effectiveDate: '2026-09-13',
      termMonths: 12,
      status: 'DRAFT',
      entities: [{
        id: 'synthetic-entity',
        companyId: 'synthetic-company',
        nameSnapshot: 'Synthetic & Co <Test>',
        uenSnapshot: 'SYNTHETIC-UEN',
        displayOrder: 0,
      }],
      items: [{
        id: 'synthetic-item',
        serviceVariantId: 'synthetic-variant',
        variantVersion: 4,
        familyNameSnapshot: 'Corporate Services',
        variantNameSnapshot: 'Synthetic Secretarial Service',
        serviceCadence: 'ANNUALLY',
        customCadenceLabel: null,
        sowPartialId: 'synthetic-partial',
        partialVersion: 7,
        partialContentSnapshot: '<h2>{{service.variantName}}</h2><p>{{service.fields.scope}}</p>',
        partialPlaceholdersSnapshot: [],
        partialDependencySnapshot: [],
        entityIds: ['synthetic-entity'],
        startDate: '2026-09-13',
        startDateOverridden: false,
        endDate: null,
        fieldValues: { scope: 'Annual filing & compliance <safe>' },
        displayOrder: 0,
        feeLines: [{
          id: 'synthetic-fee',
          agreementEntityId: 'synthetic-entity',
          companyId: 'synthetic-company',
          description: 'Synthetic annual service',
          amount: '1800.00',
          currency: 'SGD',
          billingFrequency: 'ANNUALLY',
          customFrequencyLabel: null,
          billingStartDate: '2026-09-13',
          billingStartDateOverridden: false,
          displayOrder: 0,
        }],
        staleVariantVersion: false,
        stalePartialVersion: false,
      }],
      createdAt: '2026-09-13T00:00:00.000Z',
      updatedAt: '2026-09-13T00:00:00.000Z',
    };

    const templateContent = [
      '<h1>Service Agreement</h1>',
      SERVICE_AGREEMENT_SLOTS.serviceSections,
      SERVICE_AGREEMENT_SLOTS.feeTable,
      SERVICE_AGREEMENT_SLOTS.entityAppendix,
    ].join('');
    const result = assembleServiceAgreementTemplate({ templateContent, agreement });

    expect(result.itemDiagnostics).toEqual([]);
    expect(result.content).toContain('Synthetic Secretarial Service');
    expect(result.content).toContain('Annual filing &amp; compliance &lt;safe&gt;');
    expect(result.content).toContain('Synthetic &amp; Co &lt;Test&gt;');
    expect(result.content).toContain('S$1,800.00 per year');
    expect(result.content).toContain('data-service-agreement-item-id="synthetic-item"');
    expect(result.content).not.toContain('{{@agreement.');
  });
});

describe('W3 synthetic task-launched generation regression', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    taskMocks.findTaskStageOutcome.mockResolvedValue(null);
    taskMocks.getTaskStageDetail.mockResolvedValue({ id: 'synthetic-stage' });
    taskMocks.linkTaskStageOutcome.mockResolvedValue({ id: 'synthetic-outcome' });
  });

  it('links only the first successful generated document to the originating task stage', async () => {
    await linkFirstGeneratedDocumentTaskOutcomeForBatch({
      tenantId: 'synthetic-tenant',
      taskContext: {
        taskId: 'synthetic-task',
        taskStageId: 'synthetic-stage',
        returnTo: '/tasks/synthetic-task',
      },
      userId: 'synthetic-user',
      successes: [
        { itemId: 'item-1', documentId: 'document-1', title: 'Synthetic One' },
        { itemId: 'item-2', documentId: 'document-2', title: 'Synthetic Two' },
      ],
    });

    expect(taskMocks.findTaskStageOutcome).toHaveBeenCalledWith({
      where: {
        tenantId: 'synthetic-tenant',
        taskStageId: 'synthetic-stage',
        type: 'GENERATED_DOCUMENT',
      },
      select: { id: true },
    });
    expect(taskMocks.getTaskStageDetail).toHaveBeenCalledWith(
      'synthetic-tenant',
      'synthetic-task',
      'synthetic-stage',
    );
    expect(taskMocks.linkTaskStageOutcome).toHaveBeenCalledTimes(1);
    expect(taskMocks.linkTaskStageOutcome).toHaveBeenCalledWith(
      'synthetic-tenant',
      'synthetic-stage',
      {
        type: 'GENERATED_DOCUMENT',
        generatedDocumentId: 'document-1',
      },
      'synthetic-user',
      { protectAuthoritativeCompany: true },
    );
  });

  it('does not overwrite an existing authoritative task outcome on retry', async () => {
    taskMocks.findTaskStageOutcome.mockResolvedValue({ id: 'already-linked' });

    await linkFirstGeneratedDocumentTaskOutcomeForBatch({
      tenantId: 'synthetic-tenant',
      taskContext: {
        taskId: 'synthetic-task',
        taskStageId: 'synthetic-stage',
      },
      userId: 'synthetic-user',
      successes: [{ itemId: 'item-1', documentId: 'document-1', title: 'Synthetic One' }],
    });

    expect(taskMocks.getTaskStageDetail).not.toHaveBeenCalled();
    expect(taskMocks.linkTaskStageOutcome).not.toHaveBeenCalled();
  });
});
