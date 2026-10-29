import { describe, expect, it } from 'vitest';

import {
  SERVICE_AGREEMENT_SLOTS,
  validateServiceAgreementSlots,
  validateTemplate,
  validateTemplateSyntax,
} from '@/components/documents/template-editor/template-validation';
import { placeholderDefinitionSchema } from '@/lib/validations/document-template';

describe('template syntax validation', () => {
  it('reports unmatched and unknown constructs with actionable messages', () => {
    const issues = validateTemplateSyntax(
      // Built-in roots are open; only custom keys are checked against the template.
      '<p>{{#each directors}}</p><p>{{custom.missing}}</p>',
      new Set(['company.name']),
    );

    expect(issues.map((issue) => issue.code)).toEqual([
      'unmatched-block',
      'unknown-placeholder',
    ]);
    expect(issues[0].message).toContain('{{/each}}');
    expect(issues[1].message).toContain('custom.missing');
  });

  it('returns deterministic issues for mismatched blocks, empty loops, and unresolved partials', () => {
    const issues = validateTemplateSyntax(
      '{{#if company.name}}{{/each}}{{#each directors}}{{/each}}{{> letterhead}}{{unknown.value}}',
      new Set(['company.name']),
    );

    expect(issues.map((issue) => [issue.code, issue.severity])).toEqual([
      ['unmatched-block', 'error'],
      ['empty-loop', 'warning'],
      ['unresolved-partial', 'warning'],
      ['unknown-placeholder', 'error'],
    ]);
    expect(issues.map((issue) => issue.id)).toEqual([
      'issue-1-unmatched-block',
      'issue-2-empty-loop',
      'issue-3-unresolved-partial',
      'issue-4-unknown-placeholder',
    ]);
  });

  it('does not report known keys or supported loop fields as unknown', () => {
    const issues = validateTemplateSyntax(
      '{{#if company.name}}{{#each directors}}<p>{{this.name}}</p>{{/each}}{{/if}}',
      new Set(['company.name']),
    );

    expect(issues).toEqual([]);
  });

  it('accepts contact fields used by Service Agreement representative loops', () => {
    const issues = validateTemplateSyntax(
      '{{#each authorizedRepresentatives}}<p>{{this.name}} {{this.detail}} {{this.contactType}} {{this.email}} {{this.phone}} {{this.address.full}}</p>{{/each}}',
      new Set(),
    );

    expect(issues).toEqual([]);
  });

  it('recovers from a nested mismatch without adding an EOF error before later unknown keys', () => {
    const issues = validateTemplateSyntax(
      '{{#each directors}}{{#if company.name}}{{/each}}{{custom.missing}}',
      new Set(['company.name']),
    );

    expect(issues.map((issue) => issue.code)).toEqual([
      'unmatched-block',
      'unknown-placeholder',
    ]);
    expect(issues[0].message).toContain('{{/if}}');
  });

  it('requires each service agreement composition slot exactly once', () => {
    expect(
      validateTemplate({
        compositionType: 'SERVICE_AGREEMENT',
        content: '<p>No composition slots</p>',
        placeholders: [],
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'missing-agreement-slot',
          message: expect.stringMatching(/serviceSections/),
        }),
      ]),
    );

    const duplicate = validateServiceAgreementSlots(
      `${SERVICE_AGREEMENT_SLOTS.serviceSections}${SERVICE_AGREEMENT_SLOTS.serviceSections}` +
        SERVICE_AGREEMENT_SLOTS.feeTable +
        SERVICE_AGREEMENT_SLOTS.entityAppendix,
    );
    expect(duplicate).toEqual([
      expect.objectContaining({
        code: 'duplicate-agreement-slot',
        message: expect.stringMatching(/serviceSections/),
      }),
    ]);
  });

  it('does not require agreement slots for standard templates', () => {
    expect(
      validateTemplate({
        compositionType: 'STANDARD',
        content: '<p>Standard content</p>',
        placeholders: [],
      }),
    ).toEqual([]);
  });

  it('accepts service textarea placeholder definitions', () => {
    expect(
      placeholderDefinitionSchema.parse({
        key: 'service.fields.software',
        label: 'Accounting software',
        type: 'textarea',
        source: 'service',
        required: false,
      }),
    ).toMatchObject({ source: 'service', type: 'textarea' });
  });
});
