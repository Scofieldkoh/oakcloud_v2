import { describe, it, expect } from 'vitest';
import {
  createInitialBatchWorkspaceState,
  defaultItemConfiguration,
  documentGenerationBatchReducer,
  selectCanEnterConfigure,
  selectCanRequestPreflight,
  selectReadyCount,
  type EditableBatchItem,
  type EditableDocumentGenerationBatch,
} from '@/components/documents/generation-batch/batch-workspace-state';
import type { DocumentTemplateSummary } from '@/types/document-generation';
import { DEFAULT_DOCUMENT_GENERATION_TITLE_PATTERN } from '@/lib/document-generation-title';

function item(
  id: string,
  overrides: Partial<Omit<EditableBatchItem, 'configuration'>> & {
    configuration?: Partial<EditableBatchItem['configuration']>;
  } = {},
): EditableBatchItem {
  const configuration = {
    version: 1 as const,
    title: `Document ${id}`,
    contactIds: [],
    selectedDirectorId: null,
    selectedShareholderId: null,
    selectedContactId: null,
    itemValues: {},
    masterOverrides: {},
    useLetterhead: true,
    serviceAgreement: null,
    ...(overrides.configuration ?? {}),
  };
  const { configuration: _ignored, ...restOverrides } = overrides;
  return {
    key: id,
    id,
    templateId: `template-${id}`,
    templateName: `Template ${id}`,
    templateKind: 'STANDARD',
    templateVersion: 1,
    templateEngine: 'A4',
    status: 'READY',
    configuration,
    previewContent: '<p>x</p>',
    editedContent: null,
    editedContentJson: null,
    previewFingerprint: 'preview-1',
    reviewedFingerprint: 'reviewed-1',
    validationDiagnostics: null,
    lastError: null,
    ...restOverrides,
  };
}

function batch(items: EditableBatchItem[], overrides: Partial<EditableDocumentGenerationBatch> = {}) {
  return createInitialBatchWorkspaceState({
    id: 'batch-1',
    primaryCompanyId: 'company-1',
    activeItemId: items[0]?.id ?? null,
    currentStage: 3,
    revision: 4,
    status: 'DRAFT',
    masterFieldValues: {
      'billing_address::text': '1 Main Street',
      'client_name::text': 'Acme',
    },
    masterFields: {
      fields: [
        {
          id: 'billing_address::text',
          key: 'billing_address',
          type: 'text',
          label: 'Billing address',
          templateIds: ['template-a', 'template-b'],
          requiredTemplateIds: [],
          defaultsByTemplateId: {},
        },
        {
          id: 'client_name::text',
          key: 'client_name',
          type: 'text',
          label: 'Client legal name',
          templateIds: ['template-a', 'template-b'],
          requiredTemplateIds: [],
          defaultsByTemplateId: {},
        },
      ],
      conflicts: [],
    },
    items,
    ...overrides,
  });
}

describe('document generation batch workspace state', () => {
  it('defaults new items to no letterhead and the automatic title pattern', () => {
    expect(defaultItemConfiguration('Engagement Letter')).toMatchObject({
      title: DEFAULT_DOCUMENT_GENERATION_TITLE_PATTERN,
      useLetterhead: false,
    });

    const state = batch([
      item('a', {
        configuration: { title: 'Untitled - Template a' },
      }),
    ], {
      company: { id: 'company-1', name: 'Acme Pte. Ltd.', uen: '202600001A' },
    });

    expect(state.batch.items[0].configuration.title)
      .toBe(DEFAULT_DOCUMENT_GENERATION_TITLE_PATTERN);
  });

  it('updates only automatic titles when the shared company changes', () => {
    const state = batch([
      item('a', { configuration: { title: 'Untitled - Template a' } }),
      item('b', { configuration: { title: 'Custom document title' } }),
    ], { company: null });

    const next = documentGenerationBatchReducer(state, {
      type: 'shared/company',
      companyId: 'company-2',
      companyName: 'New Company Pte. Ltd.',
    });

    expect(next.batch.items[0].configuration.title)
      .toBe(DEFAULT_DOCUMENT_GENERATION_TITLE_PATTERN);
    expect(next.batch.items[1].configuration.title).toBe('Custom document title');
  });

  it('remaps service agreement entities, service assignments, and fees when the shared company changes', () => {
    const state = batch([
      item('agreement', {
        templateKind: 'SERVICE_AGREEMENT',
        configuration: {
          serviceAgreement: {
            authorizedContactIds: ['contact-1'],
            signerContactIds: ['contact-1'],
            entityIds: ['company-1', 'company-3'],
            agreementDate: '2026-08-12',
            effectiveDate: null,
            termMonths: 12,
            items: [{
              clientKey: 'service-1',
              variantId: 'variant-1',
              entityIds: ['company-1', 'company-3'],
              startDate: '2026-08-12',
              endDate: null,
              fieldValues: {},
              displayOrder: 0,
              feeLines: [
                {
                  clientKey: 'fee-1',
                  companyId: 'company-1',
                  description: 'Primary fee',
                  amount: '500.00',
                  currency: 'SGD',
                  billingFrequency: 'ANNUALLY',
                  customFrequencyLabel: null,
                  billingStartDate: '2026-08-12',
                  displayOrder: 0,
                },
                {
                  clientKey: 'fee-2',
                  companyId: 'company-3',
                  description: 'Additional fee',
                  amount: '60.00',
                  currency: 'SGD',
                  billingFrequency: 'ANNUALLY',
                  customFrequencyLabel: null,
                  billingStartDate: '2026-08-12',
                  displayOrder: 1,
                },
              ],
            }],
          },
        },
      }),
    ]);

    const next = documentGenerationBatchReducer(state, {
      type: 'shared/company',
      companyId: 'company-2',
      companyName: 'Replacement Company',
    });

    expect(next.batch.items[0].configuration.serviceAgreement).toMatchObject({
      entityIds: ['company-2', 'company-3'],
      items: [{
        entityIds: ['company-2', 'company-3'],
        feeLines: [
          { companyId: 'company-2' },
          { companyId: 'company-3' },
        ],
      }],
    });
  });

  it('does not create Service Agreement workspace state for standard items when the shared company changes', () => {
    const state = batch([item('standard')]);

    const next = documentGenerationBatchReducer(state, {
      type: 'shared/company',
      companyId: 'company-2',
      companyName: 'Replacement Company',
    });

    expect(next.batch.items[0].configuration.serviceAgreement).toBeNull();
  });

  it('invalidates only the changed item after an item override', () => {
    const first = item('a');
    const second = item('b', {
      configuration: { masterOverrides: { billing_address: 'Old address' } },
    });
    const state = batch([first, second]);

    const next = documentGenerationBatchReducer(state, {
      type: 'item/patch',
      itemId: 'b',
      patch: { masterOverrides: { billing_address: 'New address' } },
    });

    expect(next.batch.items[0].reviewedFingerprint).toBe(first.reviewedFingerprint);
    expect(next.batch.items[1]).toMatchObject({
      reviewedFingerprint: null,
      previewFingerprint: null,
    });
    expect(next.dirty).toBe(true);
    expect(next.savedSnapshot).toBe(state.savedSnapshot);
  });

  it('freezes composition and shared setup after one output succeeds', () => {
    const state = batch([
      item('a', { status: 'GENERATED' }),
      item('b'),
    ]);
    expect(state.capabilities.canEditComposition).toBe(false);
    expect(state.capabilities.canEditSharedSetup).toBe(false);
    expect(state.capabilities.canEditItems).toBe(true);

    const unchanged = documentGenerationBatchReducer(state, {
      type: 'template/add',
      template: {
        id: 'template-c',
        name: 'KYC Checklist',
        category: 'OTHER',
        compositionType: 'STANDARD',
        version: 1,
        isActive: true,
        engine: 'A4',
        content: '',
        placeholders: [],
        createdAt: '',
        updatedAt: '',
      },
    });
    expect(unchanged.batch.items).toHaveLength(2);
  });

  it('requires a company and valid items before advancing', () => {
    const withoutCompany = batch([item('a')], { primaryCompanyId: null });
    expect(selectCanEnterConfigure(withoutCompany)).toBe(false);
    expect(selectCanEnterConfigure(batch([item('a')]))).toBe(true);

    const needsInput = batch([item('a', { status: 'NEEDS_INPUT' })]);
    expect(selectCanRequestPreflight(needsInput)).toBe(false);
    expect(selectCanRequestPreflight(batch([item('a', { status: 'READY' })]))).toBe(true);
    expect(selectReadyCount(batch([
      item('a', { status: 'READY' }),
      item('b', { status: 'GENERATED' }),
      item('c', { status: 'FAILED' }),
    ]))).toEqual({ ready: 2, total: 3 });
  });

  it('invalidates only items consuming a changed master value without an override', () => {
    const first = item('a');
    const second = item('b', {
      configuration: {
        masterOverrides: { 'client_name::text': 'Override' },
      },
    });
    const state = batch([first, second]);

    const next = documentGenerationBatchReducer(state, {
      type: 'shared/masterValue',
      fieldId: 'client_name::text',
      value: 'New shared name',
    });

    expect(next.batch.items[0].reviewedFingerprint).toBeNull();
    expect(next.batch.items[1].reviewedFingerprint).toBe(second.reviewedFingerprint);
    expect(next.batch.masterFieldValues['client_name::text']).toBe('New shared name');
  });

  it('keeps item configuration editable for incomplete items in a partial batch', () => {
    const state = batch([
      item('a', { status: 'GENERATED' }),
      item('b'),
    ]);

    const next = documentGenerationBatchReducer(state, {
      type: 'item/patch',
      itemId: 'b',
      patch: { itemValues: { reference: 'REF-1' } },
    });

    expect(next.batch.items[1].configuration.itemValues).toEqual({ reference: 'REF-1' });
    expect(next.batch.items[0].configuration.itemValues).toEqual({});
  });

  it('reorders templates and removes items without allowing an empty selection', () => {
    const state = batch([item('a'), item('b'), item('c')]);
    const reordered = documentGenerationBatchReducer(state, {
      type: 'template/reorder',
      itemId: 'c',
      direction: -1,
    });
    expect(reordered.batch.items.map((entry) => entry.key)).toEqual(['a', 'c', 'b']);

    const removed = documentGenerationBatchReducer(reordered, {
      type: 'template/remove',
      itemId: 'a',
    });
    expect(removed.batch.items.map((entry) => entry.key)).toEqual(['c', 'b']);
    expect(removed.activeItemId).toBe('c');
  });

  it('adds the same template more than once with distinct keys', () => {
    const template = {
      id: 'template-r',
      name: 'Board Resolution',
      category: 'RESOLUTION',
      compositionType: 'RESOLUTION',
      version: 1,
      isActive: true,
      engine: 'OAKDOC',
      content: '',
      placeholders: [],
      createdAt: '',
      updatedAt: '',
    } as unknown as DocumentTemplateSummary;
    const state = createInitialBatchWorkspaceState([template]);
    const twice = documentGenerationBatchReducer(state, { type: 'template/add', template });
    const thrice = documentGenerationBatchReducer(twice, { type: 'template/add', template });
    expect(thrice.batch.items.map((entry) => entry.templateId)).toEqual(['template-r', 'template-r', 'template-r']);
    expect(new Set(thrice.batch.items.map((entry) => entry.key)).size).toBe(3);
    expect(thrice.batch.items[0].key).toBe('template-r');

    const removed = documentGenerationBatchReducer(thrice, {
      type: 'template/remove',
      itemId: thrice.batch.items[1].key,
    });
    expect(removed.batch.items.map((entry) => entry.key)).toEqual([
      thrice.batch.items[0].key,
      thrice.batch.items[2].key,
    ]);
  });

  it('starts a resolution item from its template preset with fresh section ids', () => {
    const template = {
      id: 'template-p',
      name: 'Cosec Appointment',
      category: 'RESOLUTION',
      compositionType: 'RESOLUTION',
      version: 1,
      isActive: true,
      engine: 'OAKDOC',
      content: '',
      placeholders: [],
      resolutionPreset: {
        subject: 'CHANGE IN COMPANY SECRETARY',
        sections: [{ id: 'preset-1', kind: 'CUSTOM', heading: 'APPOINTMENT OF SECRETARY', body: 'RESOLVED that ...' }],
      },
      createdAt: '',
      updatedAt: '',
    } as unknown as DocumentTemplateSummary;
    const state = createInitialBatchWorkspaceState([template]);
    const twice = documentGenerationBatchReducer(state, { type: 'template/add', template });
    const [first, second] = twice.batch.items.map((entry) => entry.configuration.resolution);
    expect(first).toMatchObject({ subject: 'CHANGE IN COMPANY SECRETARY', sections: [{ heading: 'APPOINTMENT OF SECRETARY' }] });
    expect(first?.sections[0].id).not.toBe('preset-1');
    expect(second?.sections[0].id).not.toBe(first?.sections[0].id);
  });
});

describe('one document per person', () => {
  const people = [
    { id: '11111111-1111-4111-8111-111111111111', name: 'Liang Joo Heong' },
    { id: '22222222-2222-4222-8222-222222222222', name: 'Yuly Mirawati' },
    { id: '33333333-3333-4333-8333-333333333333', name: 'Tan Wei Jie' },
  ];
  const form = (key: string, overrides: Parameters<typeof item>[1] = {}) => item(key, {
    templateId: 'template-f45',
    templateName: 'F45',
    templateEngine: 'OAKDOC',
    ...overrides,
    configuration: { title: DEFAULT_DOCUMENT_GENERATION_TITLE_PATTERN, ...(overrides.configuration ?? {}) },
  });
  const setPeople = (state: ReturnType<typeof batch>, itemId: string, chosen: typeof people, tag = 'repeat.directors') =>
    documentGenerationBatchReducer(state, { type: 'items/set-document-people', itemId, tag, people: chosen });

  it('makes a document for each person picked, titled with their name and narrowed to them', () => {
    const state = batch([item('a'), form('f45'), item('b')]);
    const next = setPeople(state, 'f45', people.slice(0, 2));
    expect(next.batch.items.map((entry) => entry.templateId)).toEqual(['template-a', 'template-f45', 'template-f45', 'template-b']);
    const [first, second] = next.batch.items.slice(1, 3);
    expect(first.key).toBe('f45');
    expect(first.configuration).toMatchObject({
      title: 'F45 - Liang Joo Heong',
      selectedDirectorIds: [people[0].id],
      documentPerson: { tag: 'repeat.directors', id: people[0].id, name: 'Liang Joo Heong' },
    });
    expect(second.id).toBeUndefined();
    expect(second.previewContent).toBeNull();
    expect(second.configuration).toMatchObject({
      title: 'F45 - Yuly Mirawati',
      selectedDirectorIds: [people[1].id],
    });
    expect(next.activeItemId).toBe('a');
    expect(next.dirty).toBe(true);
  });

  it('keeps each person\'s document, reuses the others and removes the rest', () => {
    const two = setPeople(batch([form('f45')]), 'f45', people.slice(0, 2));
    const secondKey = two.batch.items[1].key;
    // Untick the first person: their document is reused for nobody else, so it goes.
    const one = setPeople(two, 'f45', [people[1]]);
    expect(one.batch.items.map((entry) => entry.key)).toEqual([secondKey]);
    expect(one.activeItemId).toBe(secondKey);
    // Nobody: one document stays, for nobody yet, with its automatic title back.
    const none = setPeople(one, secondKey, []);
    expect(none.batch.items).toHaveLength(1);
    expect(none.batch.items[0].configuration).toMatchObject({
      documentPerson: null,
      selectedDirectorIds: [],
      title: DEFAULT_DOCUMENT_GENERATION_TITLE_PATTERN,
    });
  });

  it('narrows a named contacts list and keeps the person when choices are copied in', () => {
    const tag = 'repeat.contacts.corporate-secretary-to-be-appointed';
    const state = setPeople(batch([form('f45b'), item('other')]), 'f45b', [people[2]], tag);
    expect(state.batch.items[0].configuration.selectedContactListIds).toEqual({
      'corporate-secretary-to-be-appointed': [people[2].id],
    });
    const copied = documentGenerationBatchReducer(state, {
      type: 'items/patch-many',
      itemIds: ['f45b'],
      patch: { selectedContactListIds: { 'corporate-secretary-to-be-appointed': [people[0].id, people[1].id] } },
    });
    expect(copied.batch.items[0].configuration.selectedContactListIds).toEqual({
      'corporate-secretary-to-be-appointed': [people[2].id],
    });
  });

  it('goes back to one document for nobody when the company changes', () => {
    const state = setPeople(batch([form('f45'), item('other')]), 'f45', people.slice(0, 2));
    const next = documentGenerationBatchReducer(state, { type: 'shared/company', companyId: 'company-2', companyName: 'Other' });
    expect(next.batch.items.map((entry) => entry.templateId)).toEqual(['template-f45', 'template-other']);
    expect(next.batch.items[0].configuration.documentPerson).toBeNull();
  });

  it('stays within the batch limit', () => {
    const many = Array.from({ length: 25 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      name: `Director ${index}`,
    }));
    const next = setPeople(batch([item('a'), form('f45')]), 'f45', many);
    expect(next.batch.items).toHaveLength(20);
  });
});
