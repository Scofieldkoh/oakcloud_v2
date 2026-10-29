import { describe, expect, it, vi } from 'vitest';
import type { FormField } from '@/generated/prisma';
import {
  sanitizeSubmissionAnswers,
  sanitizeSubmissionMetadata,
  validateRequiredPublicAnswers,
} from '@/services/form-submission.service';
import { sanitizePublicAnswers as sanitizeDraftAnswers } from '@/services/form-draft.service';
import {
  computeFormDefinitionHash,
  evaluateCompanyIncorporationSubmission,
  recheckAdvisoryCompanyNames,
} from '@/services/company-incorporation-intake.service';
import { CompanyNameCheckUnavailableError } from '@/lib/external/company-name-check';
import {
  INCORPORATION_KEYS as K,
  buildSgCompanyIncorporationFields,
} from '@/lib/form-templates/sg-company-incorporation';
import { saveFormFieldsSchema } from '@/lib/validations/form-builder';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/storage', () => ({ storage: {}, StorageKeys: {} }));
vi.mock('@/lib/view-count-buffer', () => ({ incrementViewCount: vi.fn() }));
vi.mock('@/lib/audit', () => ({ createAuditLog: vi.fn() }));
vi.mock('@/lib/email', () => ({
  getAppBaseUrl: () => 'http://localhost',
  sendEmail: vi.fn(),
}));
vi.mock('@/lib/email-templates', () => ({ formDraftEmail: vi.fn() }));
vi.mock('@/services/form-pdf.service', () => ({
  buildSubmissionPdfBuffer: vi.fn(),
  resolveSubmissionPdfFileName: vi.fn(),
  resolveSubmissionUploadFileNames: vi.fn(),
}));
vi.mock('@/services/form-option-preset.service', () => ({
  resolvePresetOptionsForFields: async (fields: FormField[]) => fields,
}));

let fieldCounter = 0;
function makeField(overrides: Partial<FormField>): FormField {
  fieldCounter += 1;
  return {
    id: `field-${fieldCounter}`,
    formId: 'form-1',
    tenantId: 'tenant-1',
    optionPresetId: null,
    type: 'SHORT_TEXT',
    label: 'Field',
    key: `field_${fieldCounter}`,
    placeholder: null,
    subtext: null,
    helpText: null,
    inputType: 'text',
    options: null,
    validation: null,
    condition: null,
    isRequired: false,
    hideLabel: false,
    isReadOnly: false,
    layoutWidth: 100,
    position: fieldCounter,
    createdAt: new Date('2026-09-29T00:00:00.000Z'),
    updatedAt: new Date('2026-09-29T00:00:00.000Z'),
    ...overrides,
  };
}

function repeatForm(): FormField[] {
  return [
    makeField({ type: 'PAGE_BREAK', key: 'people_start', inputType: 'repeat_start', validation: { repeatMinItems: 1 } }),
    makeField({
      type: 'SINGLE_CHOICE',
      key: 'kind',
      isRequired: true,
      options: [{ value: 'individual', label: 'Individual' }, { value: 'organisation', label: 'Organisation' }],
    }),
    makeField({ key: 'name', isRequired: true }),
    makeField({ key: 'registration', isRequired: true, condition: { fieldKey: 'kind', operator: 'equals', value: 'organisation' } }),
    makeField({ type: 'PAGE_BREAK', key: 'people_end', inputType: 'repeat_end' }),
  ];
}

describe('repeat rows on submission', () => {
  it('keeps every row of a repeated text answer', () => {
    const fields = repeatForm();
    const answers = sanitizeSubmissionAnswers(fields, { name: ['  Tan Mei Ling ', 'Holdco Ltd'], kind: ['individual', 'organisation'] }, new Set());
    expect(answers.name).toEqual(['Tan Mei Ling', 'Holdco Ltd']);
  });

  it('checks required fields against each row’s own answers', () => {
    const fields = repeatForm();
    const answers = sanitizeSubmissionAnswers(fields, {
      kind: ['individual', 'organisation'],
      name: ['Tan Mei Ling', 'Holdco Ltd'],
      registration: ['', ''],
    }, new Set());
    expect(() => validateRequiredPublicAnswers(fields, answers, new Set())).toThrow(/row 2/);

    const complete = { ...answers, registration: ['', '202612345K'] };
    expect(() => validateRequiredPublicAnswers(fields, complete, new Set())).not.toThrow();
  });
});

describe('draft answers', () => {
  it('round-trips a company name and repeated text through a draft save', () => {
    const fields = [
      makeField({ type: 'COMPANY_NAME_CHECK', key: 'proposed_name' }),
      ...repeatForm(),
    ];
    const saved = sanitizeDraftAnswers(fields, { proposed_name: ' Harbour Lane Pte. Ltd. ', name: ['A', '', 'C'] }, new Set());
    expect(saved.proposed_name).toBe(' Harbour Lane Pte. Ltd. ');
    expect(saved.name).toEqual(['A', '', 'C']);
  });
});

describe('submission metadata', () => {
  const advisory = makeField({ type: 'COMPANY_NAME_CHECK', key: 'proposed_name', validation: { nameCheckMode: 'advisory' } });

  it('drops server-owned keys and client name results for advisory fields', () => {
    const metadata = sanitizeSubmissionMetadata({
      companyIncorporation: { templateKey: 'sg_company_incorporation' },
      companyIncorporationReview: { revision: 99 },
      responseReviewStatus: 'reviewed',
      aiReview: {},
      responseTags: ['vip'],
      nameCheckResults: { proposed_name: { name: 'Acme', available: true, checkedAt: 'x', records: [] } },
    }, [advisory], { proposed_name: 'Acme' });
    expect(metadata).toEqual({});
  });

  it('keeps the server recheck result', () => {
    const metadata = sanitizeSubmissionMetadata({}, [advisory], { proposed_name: 'Acme' }, {
      proposed_name: {
        name: 'Acme', available: false, assessment: 'UNAVAILABLE', checkedAt: 'x', dataAsOf: null, records: [], reasonCodes: ['CHECK_TIMED_OUT'],
      },
    });
    expect((metadata.nameCheckResults as Record<string, { source: string }>).proposed_name.source).toBe('server');
  });
});

describe('advisory name recheck', () => {
  const field = { key: 'proposed_name', type: 'COMPANY_NAME_CHECK' as const, validation: { nameCheckMode: 'advisory' } };

  it('records a timeout for staff review instead of blocking', async () => {
    const check = vi.fn(() => new Promise<never>(() => undefined));
    const results = await recheckAdvisoryCompanyNames([field], { proposed_name: 'Acme' }, { timeoutMs: 10, check });
    expect(results.proposed_name).toMatchObject({ assessment: 'UNAVAILABLE', reasonCodes: ['CHECK_TIMED_OUT'], source: 'server' });
  });

  it('records a service outage', async () => {
    const check = vi.fn(async () => { throw new CompanyNameCheckUnavailableError('down'); });
    const results = await recheckAdvisoryCompanyNames([field], { proposed_name: 'Acme' }, { check });
    expect(results.proposed_name.reasonCodes).toEqual(['CHECK_UNAVAILABLE']);
  });

  it('checks the proposed and alternative names at the same time', async () => {
    const started: string[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const check = vi.fn(async (name: string) => {
      started.push(name);
      await gate;
      return { assessment: 'AVAILABLE' as const, checkedAt: 'x', dataAsOf: null, records: [], reasonCodes: [] };
    });
    const pending = recheckAdvisoryCompanyNames(
      [field, { ...field, key: 'alternative_name_1' }],
      { proposed_name: 'Acme', alternative_name_1: 'Acme Two' },
      { check: check as never }
    );
    await Promise.resolve();
    expect(started).toEqual(['Acme', 'Acme Two']);
    release();
    expect(Object.keys(await pending).sort()).toEqual(['alternative_name_1', 'proposed_name']);
  });

  it('rethrows unexpected errors and skips strict fields', async () => {
    const check = vi.fn(async () => { throw new Error('bug'); });
    await expect(recheckAdvisoryCompanyNames([field], { proposed_name: 'Acme' }, { check })).rejects.toThrow('bug');
    const strict = await recheckAdvisoryCompanyNames([{ ...field, validation: null }], { proposed_name: 'Acme' }, { check });
    expect(strict).toEqual({});
  });
});

describe('company incorporation submission record', () => {
  const fields = saveFormFieldsSchema.parse({
    fields: buildSgCompanyIncorporationFields({ firmName: 'Oaktree', ssicPresetId: '00000000-0000-4000-8000-000000000001', nationalityPresetId: '00000000-0000-4000-8000-000000000002', countryPresetId: '00000000-0000-4000-8000-000000000003' }),
  }).fields.map((field, index) => makeField({
    ...field,
    optionPresetId: null,
    options: field.key === K.primarySsic || field.key === K.secondarySsic
      ? [{ value: '62011', label: '62011 Software development' }, { value: '62021', label: '62021 IT consultancy' }]
      : (field.options as FormField['options']) ?? null,
    condition: (field.condition as FormField['condition']) ?? null,
    validation: (field.validation as FormField['validation']) ?? null,
    position: index,
  }));
  const settings = { template: { key: 'sg_company_incorporation', version: 1 } };
  const answers = {
    [K.proposedName]: 'Harbour Lane',
    [K.primarySsic]: '62011',
    [K.businessDescription]: 'Software',
    [K.partyKind]: ['individual'],
    [K.partyName]: ['Tan Mei Ling'],
    [K.partyRoles]: [['shareholder', 'director']],
    [K.ownershipPercent]: ['100'],
    [K.partyResident]: [['yes']],
    [K.shareCount]: '1000',
    [K.secretaryService]: ['yes'],
  };

  it('stores issues, parties with stable ids and SSIC labels', () => {
    const record = evaluateCompanyIncorporationSubmission({ settings, fields, answers, nameChecks: {}, today: '2026-09-29' });
    expect(record?.ssic.primary).toEqual({ code: '62011', label: '62011 Software development' });
    expect(record?.partyRows[0]).toMatchObject({ resident: true, shares: '1000' });
    expect(record?.partyRows[0].partyRowId).toMatch(/^party_/);
    expect(record?.issues.map((issue) => issue.code)).toContain('name_not_checked');
    expect(record?.definitionHash).toBe(computeFormDefinitionHash(fields));
  });

  it('rejects an SSIC code outside the catalogue and ignores unbound forms', () => {
    expect(() => evaluateCompanyIncorporationSubmission({
      settings, fields, answers: { ...answers, [K.primarySsic]: '99999' }, nameChecks: {},
    })).toThrow(/primary business activity/);
    expect(evaluateCompanyIncorporationSubmission({ settings: {}, fields, answers, nameChecks: {} })).toBeNull();
  });
});
