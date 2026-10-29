import { describe, expect, it } from 'vitest';

import {
  C06_TRUSTED_RICH_ORIGINS,
  createTrustedRichContentFragment,
} from '@/lib/a4-content-policy';
import {
  loadLosslessStoredFieldDefinition,
  type FieldOwnerScope,
  type LosslessStoredFieldDefinition,
} from '@/lib/template-field-contract';
import { applyFieldLifecycleTransaction } from '@/lib/template-field-lifecycle';
import {
  renderResolvedFieldFragment,
  resolveScopedTemplateFieldSource,
} from '@/lib/template-field-resolution';

const SCOPE: FieldOwnerScope = { kind: 'template', id: 'template-f2-edge' };

function field(stored: Readonly<Record<string, unknown>>): LosslessStoredFieldDefinition {
  return loadLosslessStoredFieldDefinition({ scope: SCOPE, definition: stored });
}

describe('FIELDS F2 escaping and lifecycle edge cases', () => {
  it('escapes modifier results instead of granting modifier output rich authority', () => {
    const note = field({
      id: 'modifier-note', key: 'custom.note', label: 'Note', type: 'text',
    });
    const result = resolveScopedTemplateFieldSource({
      source: {
        scope: SCOPE,
        content: '<p>{{UCASE(custom.note)}}</p>',
        definitions: [note],
      },
      context: {
        kind: 'global',
        valuesByIdentity: { [note.identity]: '<em>A & B</em>' },
      },
    });
    expect(result.resolved).toBe('<p>&lt;EM&gt;A &amp; B&lt;/EM&gt;</p>');
    expect(result.diagnostics).toEqual([]);
  });

  it('keeps an optional empty value local and reports a required missing value by typed identity', () => {
    const optional = field({
      id: 'optional-note', key: 'custom.optional', label: 'Optional', type: 'text',
    });
    const required = field({
      id: 'required-note', key: 'custom.required', label: 'Required', type: 'text', required: true,
    });
    const result = resolveScopedTemplateFieldSource({
      source: {
        scope: SCOPE,
        content: '<p>Before {{custom.optional}} middle {{custom.required}} after</p>',
        definitions: [optional, required],
      },
      context: {
        kind: 'contact',
        id: 'contact-1',
        valuesByIdentity: { [optional.identity]: '' },
      },
    });
    expect(result.resolved).toBe('<p>Before  middle {{custom.required}} after</p>');
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'required-scoped-value-missing',
        fieldIdentity: required.identity,
        context: { kind: 'contact', id: 'contact-1' },
      }),
    ]);
  });

  it('does not double-encode an already-sanitized trusted-rich fragment', () => {
    const trusted = createTrustedRichContentFragment({
      html: '<span>A &amp; B</span>',
      origin: C06_TRUSTED_RICH_ORIGINS.canonicalBuilder,
    });
    const result = renderResolvedFieldFragment(trusted, {
      sanitizeTrustedRich: (html) => html,
    });
    expect(result).toEqual({
      status: 'rendered',
      kind: 'trusted-rich',
      html: '<span>A &amp; B</span>',
    });
  });

  it('deletes an unused field without confirmation and retains unrelated metadata', () => {
    const unused = field({
      id: 'unused-field', key: 'custom.unused', label: 'Unused', type: 'text', future: { keep: true },
    });
    const sibling = field({
      id: 'sibling-field', key: 'custom.sibling', label: 'Sibling', type: 'text', siblingFuture: 3,
    });
    const result = applyFieldLifecycleTransaction({
      scope: SCOPE,
      snapshot: {
        content: '<p>{{custom.sibling}}</p>',
        definitions: [unused, sibling],
        dependentMetadata: { unrelated: ['keep'] },
      },
      intent: {
        kind: 'delete',
        identity: unused.identity,
        referenceAction: 'remove-references',
      },
    });
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(result.transaction.changedOccurrenceIds).toEqual([]);
    expect(result.transaction.after.content).toBe('<p>{{custom.sibling}}</p>');
    expect(result.transaction.after.definitions).toEqual([sibling]);
    expect(result.transaction.after.dependentMetadata).toEqual({ unrelated: ['keep'] });
  });
});
