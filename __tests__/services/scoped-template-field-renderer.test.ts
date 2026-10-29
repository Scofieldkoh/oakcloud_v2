import { describe, expect, it } from 'vitest';

import type { PlaceholderContext } from '@/lib/placeholder-resolver';
import {
  renderScopedTemplateFields,
  resolveScopedFieldValueContext,
  W3_FIELD_RESOLUTION_POLICY,
} from '@/services/scoped-template-field-renderer.service';

const EMPTY_CONTEXT = {
  custom: {},
  system: { currentDate: new Date('2026-09-13T00:00:00.000Z') },
} as PlaceholderContext;

function field(id: string, key: string, type = 'text', extra: Record<string, unknown> = {}) {
  return {
    id,
    key: `custom.${key}`,
    label: key,
    type,
    source: 'custom',
    ...extra,
  };
}

describe('W3 scoped field workflow rendering', () => {
  it('keeps parent, child partial and nested partial colliding keys independent', () => {
    const result = renderScopedTemplateFields({
      templateScope: { kind: 'template', id: 'template-1' },
      content: '<p>Parent={{custom.note}}</p>{{> child}}',
      templatePlaceholders: [field('parent-note', 'note')],
      partials: [
        {
          id: 'partial-child',
          name: 'child',
          content: '<p>Child={{custom.note}}</p>{{> nested}}',
          placeholders: [field('child-note', 'note')],
        },
        {
          id: 'partial-nested',
          name: 'nested',
          content: '<p>Nested={{custom.note}}</p>',
          placeholders: [field('nested-note', 'note')],
        },
      ],
      customData: {
        note: 'PARENT',
        child_note: 'CHILD',
        nested_note: 'NESTED',
      },
      context: EMPTY_CONTEXT,
    });

    expect(result.fieldPolicy).toBe(W3_FIELD_RESOLUTION_POLICY);
    expect(result.resolved).toContain('Parent=PARENT');
    expect(result.resolved).toContain('Child=CHILD');
    expect(result.resolved).toContain('Nested=NESTED');
    expect(result.fieldDiagnostics.filter((entry) => entry.severity === 'error')).toEqual([]);
  });

  it('shares values only through an explicit structured identity binding after a legacy collision rename', () => {
    const templatePlaceholders = [
      field('parent-shared', 'shared'),
      field('child-note', 'child_note', 'text', {
        path: 'custom.note',
        sourcePartial: 'child',
        linkedTo: 'shared',
      }),
    ];
    const partials = [{
      id: 'partial-child',
      name: 'child',
      content: '<p>Child={{custom.note}}</p>',
      placeholders: [field('child-note', 'note')],
    }];

    const state = resolveScopedFieldValueContext({
      templateScope: { kind: 'template', id: 'template-1' },
      templatePlaceholders,
      partials,
      customData: { shared: 'LINKED' },
    });
    expect(state.bindings).toHaveLength(1);
    expect(state.bindings[0].targetIdentity).not.toBe(state.bindings[0].sourceIdentity);

    const result = renderScopedTemplateFields({
      templateScope: { kind: 'template', id: 'template-1' },
      content: '<p>Parent={{custom.shared}}</p>{{> child}}',
      templatePlaceholders,
      partials,
      customData: { shared: 'LINKED' },
      context: EMPTY_CONTEXT,
    });
    expect(result.resolved).toContain('Parent=LINKED');
    expect(result.resolved).toContain('Child=LINKED');
  });

  it('escapes ordinary text and never reparses user braces as template syntax', () => {
    const result = renderScopedTemplateFields({
      templateScope: { kind: 'template', id: 'template-1' },
      content: '<p>{{custom.body}}</p><p>{{company.name}}</p>',
      templatePlaceholders: [field('body', 'body', 'textarea')],
      partials: [],
      customData: {
        body: '<img src=x onerror=alert(1)>line one\n{{company.name}}',
      },
      context: {
        ...EMPTY_CONTEXT,
        company: { name: 'Canonical Company' },
      } as PlaceholderContext,
    });

    expect(result.resolved).toContain('&lt;img src=x onerror=alert(1)&gt;line one');
    expect(result.resolved).toContain('<br>');
    expect(result.resolved).toContain('{{company.name}}');
    expect(result.resolved).toContain('Canonical Company');
    expect(result.resolved).not.toContain('<img src=x');
  });

  it('preserves explicit false and exact zero values', () => {
    const result = renderScopedTemplateFields({
      templateScope: { kind: 'template', id: 'template-1' },
      content: '<p>{{custom.enabled}}/{{custom.amount}}</p>',
      templatePlaceholders: [
        field('enabled', 'enabled', 'boolean'),
        field('amount', 'amount', 'number'),
      ],
      partials: [],
      customData: { enabled: false, amount: '0' },
      context: EMPTY_CONTEXT,
    });

    expect(result.resolved).toContain('false/0');
    expect(result.missing).toEqual([]);
  });
});
