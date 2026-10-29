import { describe, expect, it } from 'vitest';
import {
  describeCondition,
  getConditionDependents,
  getPublishReadiness,
} from '@/components/forms/builder-analysis';
import type { BuilderField } from '@/components/forms/builder-utils';

function field(overrides: Partial<BuilderField>): BuilderField {
  return {
    clientId: overrides.clientId || overrides.key || 'field',
    type: overrides.type || 'SHORT_TEXT',
    label: overrides.label ?? 'Field',
    key: overrides.key || 'field',
    placeholder: '',
    subtext: '',
    helpText: '',
    inputType: 'text',
    options: [],
    validation: null,
    condition: null,
    isRequired: false,
    hideLabel: false,
    isReadOnly: false,
    showOnSummary: false,
    layoutWidth: 100,
    position: 0,
    ...overrides,
  };
}

describe('form builder analysis', () => {
  it('describes grouped conditions using field labels', () => {
    const fields = [
      field({ label: 'Status', key: 'status' }),
      field({ label: 'Approval notes', key: 'approval_notes' }),
    ];

    expect(describeCondition({
      logic: 'and',
      rules: [
        { fieldKey: 'status', operator: 'equals', value: 'Approved' },
        { fieldKey: 'approval_notes', operator: 'is_visible' },
      ],
    }, fields)).toBe('Status equals Approved and Approval notes is visible');
  });

  it('finds fields that depend on a key through nested condition groups', () => {
    const fields = [
      field({ label: 'Status', key: 'status' }),
      field({
        label: 'Approval notes',
        key: 'approval_notes',
        condition: {
          logic: 'or',
          rules: [
            { fieldKey: 'status', operator: 'equals', value: 'Approved' },
            { fieldKey: 'status', operator: 'equals', value: 'Pending' },
          ],
        },
      }),
    ];

    expect(getConditionDependents(fields, 'status').map((item) => item.key)).toEqual(['approval_notes']);
  });

  it('reports publish blockers and warnings for unsafe forms', () => {
    const readiness = getPublishReadiness({
      title: '',
      slug: 'a',
      draftSaveEnabled: true,
      fields: [
        field({ label: '', key: 'name' }),
        field({
          label: 'Upload',
          key: 'upload',
          type: 'FILE_UPLOAD',
          validation: null,
        }),
        field({
          label: 'Conditional',
          key: 'conditional',
          condition: { fieldKey: 'missing_field', operator: 'equals', value: 'Yes' },
        }),
      ],
    });

    expect(readiness.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Form title is required.' }),
      expect.objectContaining({ message: 'Custom URL segment must be at least 3 characters.' }),
      expect.objectContaining({ message: 'Field 1 has no visible label.' }),
      expect.objectContaining({ message: 'Conditional references missing field key "missing_field".' }),
    ]));
    expect(readiness.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'No response summary fields are selected.' }),
      expect.objectContaining({ message: 'Upload has no upload size limit configured.' }),
      expect.objectContaining({ message: 'Draft saving is enabled. Confirm the form asks for an email or other respondent identifier.' }),
    ]));
  });

  it('does not warn when required fields are intentionally conditionally hidden', () => {
    const readiness = getPublishReadiness({
      title: 'Annual return checklist',
      slug: 'annual-return-checklist',
      draftSaveEnabled: false,
      fields: [
        field({
          label: 'Company is listed',
          key: 'company_is_listed',
          type: 'SINGLE_CHOICE',
          options: [
            { label: 'Yes', value: 'Yes' },
            { label: 'No', value: 'No' },
          ],
          showOnSummary: true,
        }),
        field({
          label: 'Financial Statement',
          key: 'financial_statement',
          type: 'FILE_UPLOAD',
          isRequired: true,
          condition: { fieldKey: 'company_is_listed', operator: 'equals', value: 'Yes' },
          validation: { maxFileSizeMb: 50 },
        }),
      ],
    });

    expect(readiness.warnings.map((item) => item.message)).not.toContain(
      'Financial Statement is required but hidden until conditions are met.'
    );
  });
});
