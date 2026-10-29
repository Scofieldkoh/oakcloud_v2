import { describe, expect, it } from 'vitest';
import {
  batchExecutionSchema,
  batchItemConfigurationSchema,
  createDocumentGenerationBatchSchema,
  updateDocumentGenerationBatchSchema,
} from '@/lib/validations/document-generation-batch';

const templateA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const templateB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const uuid = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function validBatchInput() {
  return {
    items: [{ templateId: templateA }, { templateId: templateB }],
  };
}

function validItemConfiguration() {
  return {
    version: 1 as const,
    title: 'Engagement letter',
    contactIds: [],
    selectedDirectorId: null,
    selectedShareholderId: null,
    selectedContactId: null,
    itemValues: {},
    masterOverrides: {},
    useLetterhead: true,
    serviceAgreement: null,
  };
}

describe('document generation batch validation', () => {
  it('accepts 1 to 20 ordered templates, including repeat copies of one template', () => {
    expect(createDocumentGenerationBatchSchema.safeParse(validBatchInput()).success).toBe(true);
    expect(createDocumentGenerationBatchSchema.safeParse({
      ...validBatchInput(),
      items: [validBatchInput().items[0], validBatchInput().items[0]],
    }).success).toBe(true);
    expect(createDocumentGenerationBatchSchema.safeParse({ items: [] }).success).toBe(false);
    expect(createDocumentGenerationBatchSchema.safeParse({
      items: Array.from({ length: 21 }, (_, index) => ({
        templateId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      })),
    }).success).toBe(false);
  });

  it('requires exactly one item for legacy draft adoption', () => {
    expect(createDocumentGenerationBatchSchema.safeParse({
      items: [validBatchInput().items[0]],
      legacyDraftId: uuid,
    }).success).toBe(true);
    expect(createDocumentGenerationBatchSchema.safeParse({
      ...validBatchInput(),
      legacyDraftId: uuid,
    }).success).toBe(false);
  });

  it('rejects extra client-owned fields and malformed UUIDs', () => {
    expect(createDocumentGenerationBatchSchema.safeParse({
      ...validBatchInput(),
      tenantId: uuid,
    }).success).toBe(false);
    expect(createDocumentGenerationBatchSchema.safeParse({
      items: [{ templateId: 'not-a-uuid' }],
    }).success).toBe(false);
  });

  it('validates update payloads with shared expected revision and unique order', () => {
    expect(updateDocumentGenerationBatchSchema.safeParse({
      expectedRevision: 3,
      items: [
        { templateId: templateA, configuration: validItemConfiguration() },
        { templateId: templateB, configuration: validItemConfiguration() },
      ],
    }).success).toBe(true);
    expect(updateDocumentGenerationBatchSchema.safeParse({
      expectedRevision: -1,
      items: [],
    }).success).toBe(false);
    expect(updateDocumentGenerationBatchSchema.safeParse({
      expectedRevision: 0,
      items: [
        { templateId: templateA, displayOrder: 0 },
        { templateId: templateB, displayOrder: 0 },
      ],
    }).success).toBe(false);
  });

  it('accepts an optional multi-director selection for collection loops', () => {
    expect(batchItemConfigurationSchema.safeParse({
      ...validItemConfiguration(),
      selectedDirectorIds: [uuid],
    }).success).toBe(true);
    expect(batchItemConfigurationSchema.safeParse(validItemConfiguration()).success).toBe(true);
  });

  it('accepts contacts ticked per named contacts list, keyed by a list slug', () => {
    expect(batchItemConfigurationSchema.safeParse({
      ...validItemConfiguration(),
      selectedContactListIds: { 'corporate-secretary-to-be-appointed': [uuid], auditor: [] },
    }).success).toBe(true);
    for (const key of ['Corp Sec', 'corp--sec', '-corp', 'a'.repeat(61), '']) {
      expect(batchItemConfigurationSchema.safeParse({
        ...validItemConfiguration(),
        selectedContactListIds: { [key]: [uuid] },
      }).success, key).toBe(false);
    }
    expect(batchItemConfigurationSchema.safeParse({
      ...validItemConfiguration(),
      selectedContactListIds: { 'corp-sec': ['not-a-uuid'] },
    }).success).toBe(false);
    expect(batchItemConfigurationSchema.safeParse({
      ...validItemConfiguration(),
      selectedContactListIds: Object.fromEntries(Array.from({ length: 51 }, (_, index) => [`list-${index}`, []])),
    }).success).toBe(false);
  });

  it('accepts an empty Service Agreement workspace while still validating entered items', () => {
    const workspace = {
      authorizedContactIds: [],
      authorizedRepresentativeRoles: {},
      signerContactIds: [],
      entityIds: [],
      agreementDate: '2026-08-12',
      effectiveDate: null,
      termMonths: 12,
      items: [],
    };
    expect(batchItemConfigurationSchema.safeParse({
      ...validItemConfiguration(),
      serviceAgreement: workspace,
    }).success).toBe(true);
    expect(batchItemConfigurationSchema.safeParse({
      ...validItemConfiguration(),
      serviceAgreement: {
        ...workspace,
        items: [{
          clientKey: 'item-1',
          variantId: uuid,
          entityIds: ['not-a-uuid'],
          startDate: '2026-08-12',
          endDate: null,
          fieldValues: {},
          displayOrder: 0,
          feeLines: [],
        }],
      },
    }).success).toBe(false);
    expect(batchItemConfigurationSchema.safeParse({
      ...validItemConfiguration(),
      serviceAgreement: {
        ...workspace,
        authorizedContactIds: [uuid, uuid],
      },
    }).success).toBe(false);
    expect(batchItemConfigurationSchema.safeParse({
      ...validItemConfiguration(),
      serviceAgreement: {
        ...workspace,
        signerContactIds: [templateA],
      },
    }).success).toBe(false);
  });

  it('keeps Service Agreement appointment selections scoped to selected representatives', () => {
    const workspace = {
      authorizedContactIds: [uuid],
      authorizedRepresentativeRoles: { [uuid]: 'Director' },
      signerContactIds: [uuid],
      entityIds: [],
      agreementDate: '2026-08-12',
      effectiveDate: null,
      termMonths: 12,
      items: [],
    };
    expect(batchItemConfigurationSchema.safeParse({
      ...validItemConfiguration(),
      serviceAgreement: workspace,
    }).success).toBe(true);
    expect(batchItemConfigurationSchema.safeParse({
      ...validItemConfiguration(),
      serviceAgreement: {
        ...workspace,
        authorizedRepresentativeRoles: {
          ...workspace.authorizedRepresentativeRoles,
          [templateA]: 'CEO',
        },
      },
    }).success).toBe(false);
  });

  it('accepts an activeItemId referencing a local item by its template id', () => {
    expect(updateDocumentGenerationBatchSchema.safeParse({
      expectedRevision: 1,
      activeItemId: templateB,
      items: [
        { id: uuid, templateId: templateA },
        { templateId: templateB },
      ],
    }).success).toBe(true);
    expect(updateDocumentGenerationBatchSchema.safeParse({
      expectedRevision: 1,
      activeItemId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      items: [{ id: uuid, templateId: templateA }],
    }).success).toBe(false);
  });

  it('requires expected revision for execution payloads', () => {
    expect(batchExecutionSchema.safeParse({ expectedRevision: 2 }).success).toBe(true);
    expect(batchExecutionSchema.safeParse({}).success).toBe(false);
  });
});
