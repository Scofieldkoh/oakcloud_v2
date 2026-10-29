import { describe, expect, it, vi } from 'vitest';
import type { FormField } from '@/generated/prisma';
import {
  sanitizeSubmissionMetadata,
  validateCompanyNameCheckResults,
} from '@/services/form-submission.service';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/storage', () => ({ storage: {}, StorageKeys: {} }));
vi.mock('@/lib/view-count-buffer', () => ({ incrementViewCount: vi.fn() }));
vi.mock('@/lib/audit', () => ({ createAuditLog: vi.fn() }));
vi.mock('@/lib/email', () => ({
  getAppBaseUrl: () => 'http://localhost',
  sendEmail: vi.fn(),
}));
vi.mock('@/services/form-pdf.service', () => ({
  buildSubmissionPdfBuffer: vi.fn(),
  resolveSubmissionPdfFileName: vi.fn(),
  resolveSubmissionUploadFileNames: vi.fn(),
}));
vi.mock('@/services/form-option-preset.service', () => ({
  resolvePresetOptionsForFields: async (fields: FormField[]) => fields,
}));

function makeNameCheckField(overrides: Partial<FormField> = {}): FormField {
  return {
    id: 'field-1',
    formId: 'form-1',
    tenantId: 'tenant-1',
    optionPresetId: null,
    type: 'COMPANY_NAME_CHECK',
    label: 'Company name',
    key: 'company_name',
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
    position: 0,
    createdAt: new Date('2026-08-06T00:00:00.000Z'),
    updatedAt: new Date('2026-08-06T00:00:00.000Z'),
    ...overrides,
  };
}

const validResult = {
  name: 'Acme Holdings',
  available: true,
  checkedAt: '2026-08-06T00:00:00.000Z',
  records: [],
};

describe('company name check submission validation', () => {
  it('rejects a submission without a check result', () => {
    expect(() => validateCompanyNameCheckResults(
      [makeNameCheckField()],
      { company_name: 'Acme Holdings' },
      {}
    )).toThrow('Company name availability check is required');
  });

  it('rejects a check result that does not match the answer', () => {
    expect(() => validateCompanyNameCheckResults(
      [makeNameCheckField()],
      { company_name: 'Acme Holdings' },
      {
        nameCheckResults: {
          company_name: { ...validResult, name: 'Other Name' },
        },
      }
    )).toThrow('Company name availability check is required');
  });

  it('accepts a valid check result', () => {
    expect(() => validateCompanyNameCheckResults(
      [makeNameCheckField()],
      { company_name: 'Acme Holdings' },
      {
        nameCheckResults: {
          company_name: validResult,
        },
      }
    )).not.toThrow();
  });

  it('rejects an unavailable check result', () => {
    expect(() => validateCompanyNameCheckResults(
      [makeNameCheckField()],
      { company_name: 'Acme Holdings' },
      {
        nameCheckResults: {
          company_name: {
            ...validResult,
            available: false,
            records: [{
              uen: '201904999E',
              entityName: 'BIF IV ACME HOLDINGS PTE. LTD.',
              entityStatus: 'LIVE COMPANY',
            }],
          },
        },
      }
    )).toThrow('Similar names were found for Company name');
  });

  it('skips fields hidden by condition', () => {
    const field = makeNameCheckField({
      condition: {
        fieldKey: 'show_name_check',
        operator: 'equals',
        value: 'yes',
      },
    });

    expect(() => validateCompanyNameCheckResults(
      [field],
      { show_name_check: 'no', company_name: '' },
      {}
    )).not.toThrow();
  });
});

describe('sanitizeSubmissionMetadata', () => {
  it('keeps only valid name check results for COMPANY_NAME_CHECK fields', () => {
    const shortTextField = makeNameCheckField({
      id: 'field-2',
      type: 'SHORT_TEXT',
      key: 'full_name',
    });
    const fields = [makeNameCheckField(), shortTextField];
    const answers = {
      company_name: 'Acme Holdings',
      full_name: 'John Doe',
    };

    const metadata = {
      userAgent: 'test-agent',
      locale: 'en',
      nameCheckResults: {
        company_name: validResult,
        unknown_key: validResult,
        full_name: validResult,
        invalid_entry: {
          name: 'Acme Holdings',
          available: true,
          records: [],
        },
      },
    };

    const sanitized = sanitizeSubmissionMetadata(metadata, fields, answers);

    expect(sanitized.userAgent).toBe('test-agent');
    expect(sanitized.locale).toBe('en');
    expect(sanitized.nameCheckResults).toEqual({
      company_name: validResult,
    });
  });

  it('drops results whose name does not match the stored answer', () => {
    const sanitized = sanitizeSubmissionMetadata(
      {
        nameCheckResults: {
          company_name: { ...validResult, name: 'Stale Name' },
        },
      },
      [makeNameCheckField()],
      { company_name: 'Acme Holdings' }
    );

    expect(sanitized.nameCheckResults).toBeUndefined();
  });

  it('caps records at the allowed limit', () => {
    const records = Array.from({ length: 15 }, (_, index) => ({
      uen: `UEN-${index}`,
      entityName: `Company ${index}`,
      entityStatus: 'LIVE COMPANY',
    }));

    const sanitized = sanitizeSubmissionMetadata(
      {
        nameCheckResults: {
          company_name: {
            ...validResult,
            available: false,
            records,
          },
        },
      },
      [makeNameCheckField()],
      { company_name: 'Acme Holdings' }
    );

    const results = sanitized.nameCheckResults as Record<string, { records: unknown[] }>;
    expect(results.company_name.records).toHaveLength(10);
  });
});
