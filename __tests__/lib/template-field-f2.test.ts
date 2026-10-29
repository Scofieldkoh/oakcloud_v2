import { describe, expect, it, vi } from 'vitest';

import {
  C06_TRUSTED_RICH_ORIGINS,
  createDeclarativeFieldContentFragment,
  createTrustedRichContentFragment,
  type ResolvedContentFragment,
} from '@/lib/a4-content-policy';
import {
  loadLosslessStoredFieldDefinition,
  type FieldLifecycleSnapshot,
  type FieldOwnerScope,
  type LosslessStoredFieldDefinition,
} from '@/lib/template-field-contract';
import { applyFieldLifecycleTransaction } from '@/lib/template-field-lifecycle';
import {
  adaptLegacyFlattenedFieldValues,
  renderResolvedFieldFragment,
  resolveScopedFieldValue,
  resolveScopedTemplateFieldSource,
  resolveScopedTemplateFieldSources,
} from '@/lib/template-field-resolution';

const TEMPLATE_SCOPE: FieldOwnerScope = { kind: 'template', id: 'template-f2' };
const PARTIAL_A_SCOPE: FieldOwnerScope = { kind: 'partial', id: 'partial-a', label: 'Partial A' };
const PARTIAL_B_SCOPE: FieldOwnerScope = { kind: 'partial', id: 'partial-b', label: 'Partial B' };

function definition(
  scope: FieldOwnerScope,
  stored: Readonly<Record<string, unknown>>,
): LosslessStoredFieldDefinition {
  return loadLosslessStoredFieldDefinition({ scope, definition: stored });
}

function snapshot(
  content: string,
  definitions: readonly LosslessStoredFieldDefinition[],
  dependentMetadata: Readonly<Record<string, unknown>> = {},
): FieldLifecycleSnapshot {
  return { content, definitions, dependentMetadata };
}

describe('FIELDS F2 scoped resolution and C06 interpolation', () => {
  it('resolves one semantic key independently across parent and two partial owner scopes', () => {
    const parent = definition(TEMPLATE_SCOPE, {
      id: 'parent-note', key: 'custom.note', label: 'Note', type: 'text', futureParent: true,
    });
    const partialA = definition(PARTIAL_A_SCOPE, {
      id: 'partial-a-note', key: 'custom.note', label: 'Note', type: 'text', futureA: { version: 2 },
    });
    const partialB = definition(PARTIAL_B_SCOPE, {
      id: 'partial-b-note', key: 'custom.note', label: 'Note', type: 'text', futureB: ['keep'],
    });
    const sources = [
      { scope: TEMPLATE_SCOPE, content: '<p>{{custom.note}}</p>', definitions: [parent] },
      { scope: PARTIAL_A_SCOPE, content: '<li>{{custom.note}}</li>', definitions: [partialA] },
      { scope: PARTIAL_B_SCOPE, content: '<td>{{custom.note}}</td>', definitions: [partialB] },
    ];

    const first = resolveScopedTemplateFieldSources({
      sources,
      context: {
        kind: 'company',
        id: 'company-1',
        valuesByIdentity: {
          [parent.identity]: 'Parent 1',
          [partialA.identity]: 'Partial A 1',
          [partialB.identity]: 'Partial B 1',
        },
      },
    });
    expect(first.map((item) => item.resolved)).toEqual([
      '<p>Parent 1</p>', '<li>Partial A 1</li>', '<td>Partial B 1</td>',
    ]);
    expect(first.flatMap((item) => item.parserDiagnostics)).toEqual([]);

    const second = resolveScopedTemplateFieldSources({
      sources,
      context: {
        kind: 'company',
        id: 'company-2',
        valuesByIdentity: {
          [parent.identity]: 'Parent 2',
          [partialA.identity]: 'Partial A 2',
          [partialB.identity]: 'Partial B 2',
        },
      },
    });
    expect(second.map((item) => item.resolved)).toEqual([
      '<p>Parent 2</p>', '<li>Partial A 2</li>', '<td>Partial B 2</td>',
    ]);
  });

  it('shares values only through explicit structured-identity bindings', () => {
    const parent = definition(TEMPLATE_SCOPE, {
      id: 'parent-reference', key: 'custom.reference', label: 'Reference', type: 'text',
    });
    const partial = definition(PARTIAL_A_SCOPE, {
      id: 'partial-reference', key: 'custom.reference', label: 'Reference', type: 'text',
    });
    const resolved = resolveScopedFieldValue({
      definition: partial,
      allDefinitions: [parent, partial],
      bindings: [{ targetIdentity: partial.identity, sourceIdentity: parent.identity }],
      context: {
        kind: 'invoice', id: 'invoice-1', valuesByIdentity: { [parent.identity]: 'INV-1001' },
      },
    });
    expect(resolved.effectiveIdentity).toBe(parent.identity);
    expect(resolved.value).toEqual({ kind: 'text', value: 'INV-1001' });
    expect(resolved.diagnostics).toEqual([]);
  });

  it('rejects ambiguous legacy flattened values unless an exact identity binding is supplied', () => {
    const parent = definition(TEMPLATE_SCOPE, {
      id: 'legacy-parent', key: 'custom.note', label: 'Note', type: 'text',
    });
    const partial = definition(PARTIAL_A_SCOPE, {
      id: 'legacy-partial', key: 'custom.note', label: 'Note', type: 'text',
    });

    const ambiguous = adaptLegacyFlattenedFieldValues({
      definitions: [parent, partial],
      values: { note: 'legacy' },
    });
    expect(ambiguous.ok).toBe(false);
    expect(ambiguous.valuesByIdentity).toEqual({});
    expect(ambiguous.diagnostics).toEqual([
      expect.objectContaining({ code: 'ambiguous-legacy-value', legacyKey: 'note' }),
    ]);

    const explicit = adaptLegacyFlattenedFieldValues({
      definitions: [parent, partial],
      values: { note: 'legacy' },
      explicitBindings: { note: partial.identity },
    });
    expect(explicit.ok).toBe(true);
    expect(explicit.valuesByIdentity).toEqual({ [partial.identity]: 'legacy' });
  });

  it('escapes ordinary text exactly once at interpolation and never reparses inserted braces', () => {
    const field = definition(TEMPLATE_SCOPE, {
      id: 'escaping', key: 'custom.note', label: 'Note', type: 'text',
    });
    const resolved = resolveScopedTemplateFieldSource({
      source: {
        scope: TEMPLATE_SCOPE,
        content: '<p>{{custom.note}}</p>',
        definitions: [field],
      },
      context: {
        kind: 'global',
        valuesByIdentity: {
          [field.identity]: 'A & B <em>"Q" \'S\'</em> {{custom.attack}}',
        },
      },
    });
    expect(resolved.resolved).toBe(
      '<p>A &amp; B &lt;em&gt;&quot;Q&quot; &#39;S&#39;&lt;/em&gt; {{custom.attack}}</p>',
    );
    expect(resolved.diagnostics).toEqual([]);
  });

  it('normalizes multiline text once and keeps markup characters escaped', () => {
    const field = definition(TEMPLATE_SCOPE, {
      id: 'multiline', key: 'custom.notes', label: 'Notes', type: 'textarea',
    });
    const resolved = resolveScopedTemplateFieldSource({
      source: { scope: TEMPLATE_SCOPE, content: '{{custom.notes}}', definitions: [field] },
      context: {
        kind: 'employee',
        id: 'employee-1',
        valuesByIdentity: { [field.identity]: 'one\r\ntwo\rthree & four' },
      },
    });
    expect(resolved.resolved).toBe('one<br>two<br>three &amp; four');
  });

  it('keeps client render metadata declarative and requires canonical rich origin plus sanitizer', () => {
    const declarative = createDeclarativeFieldContentFragment({
      value: '<strong>plain</strong>',
      renderMode: 'trusted-html',
      clientMetadata: { trusted: true },
    });
    expect(renderResolvedFieldFragment(declarative)).toEqual({
      status: 'rendered',
      kind: 'text',
      html: '&lt;strong&gt;plain&lt;/strong&gt;',
    });

    const trusted = createTrustedRichContentFragment({
      html: '<strong>safe</strong><script>remove()</script>',
      origin: C06_TRUSTED_RICH_ORIGINS.templatePartial,
    });
    expect(renderResolvedFieldFragment(trusted)).toEqual({
      status: 'blocked',
      diagnostic: expect.objectContaining({ code: 'missing-rich-sanitizer' }),
    });

    const sanitizer = vi.fn((html: string) => html.replace(/<script>[\s\S]*?<\/script>/g, ''));
    expect(renderResolvedFieldFragment(trusted, { sanitizeTrustedRich: sanitizer })).toEqual({
      status: 'rendered',
      kind: 'trusted-rich',
      html: '<strong>safe</strong>',
    });
    expect(sanitizer).toHaveBeenCalledWith(
      trusted.html,
      C06_TRUSTED_RICH_ORIGINS.templatePartial,
    );

    const forged = {
      kind: 'trusted-rich',
      html: '<strong>forged</strong>',
      origin: { name: 'template-partial' },
    } as unknown as ResolvedContentFragment;
    expect(renderResolvedFieldFragment(forged, { sanitizeTrustedRich: sanitizer })).toEqual({
      status: 'blocked',
      diagnostic: expect.objectContaining({ code: 'untrusted-rich-origin' }),
    });
  });

  it('blocks legacy rich HTML unless both compatibility binding and sanitizer are explicit', () => {
    const legacy: ResolvedContentFragment = {
      kind: 'legacy-rich',
      html: '<b>legacy</b>',
      compatibilityBinding: 'legacy:signature',
    };
    expect(renderResolvedFieldFragment(legacy)).toEqual({
      status: 'blocked',
      diagnostic: expect.objectContaining({ code: 'unapproved-legacy-rich-binding' }),
    });
    expect(renderResolvedFieldFragment(legacy, {
      approvedLegacyRichBindings: new Set(['legacy:signature']),
      sanitizeApprovedLegacyRich: (html) => html,
    })).toEqual({ status: 'rendered', kind: 'legacy-rich', html: '<b>legacy</b>' });
  });

  it('preserves unsupported legacy structured fields instead of stringifying them', () => {
    const legacy = definition(TEMPLATE_SCOPE, {
      id: 'legacy-list', key: 'custom.items', label: 'Items', type: 'list', futureMode: 'preserve',
    });
    const resolved = resolveScopedTemplateFieldSource({
      source: { scope: TEMPLATE_SCOPE, content: '<p>{{custom.items}}</p>', definitions: [legacy] },
      context: {
        kind: 'global',
        valuesByIdentity: { [legacy.identity]: { rows: ['A', 'B'] } },
      },
    });
    expect(resolved.resolved).toBe('<p>{{custom.items}}</p>');
    expect(resolved.diagnostics).toEqual([
      expect.objectContaining({ code: 'unsupported-legacy-field-value', fieldIdentity: legacy.identity }),
    ]);
  });
});

describe('FIELDS F2 atomic lifecycle transactions', () => {
  it('inserts a field definition and reference in one transaction with metadata handoff', () => {
    const field = definition(TEMPLATE_SCOPE, {
      id: 'inserted-field', key: 'custom.note', label: 'Note', type: 'text', futureSetting: 7,
    });
    const before = snapshot('<p>Hello </p>', [], { fieldPanelOrder: [] });
    const result = applyFieldLifecycleTransaction({
      scope: TEMPLATE_SCOPE,
      snapshot: before,
      intent: { kind: 'insert-reference', definition: field, at: before.content.indexOf('</p>') },
      metadataAdapter: ({ metadata, change }) => ({
        ...metadata,
        fieldPanelOrder: [...(metadata.fieldPanelOrder as string[]), change.identity],
      }),
    });
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(result.transaction.before).toBe(before);
    expect(result.transaction.after.content).toBe('<p>Hello {{custom.note}}</p>');
    expect(result.transaction.after.definitions).toHaveLength(1);
    expect(result.transaction.after.definitions[0].unknownMetadata).toEqual({ futureSetting: 7 });
    expect(result.transaction.after.dependentMetadata).toEqual({ fieldPanelOrder: [field.identity] });
    expect(result.transaction.changedOccurrenceIds).toHaveLength(1);
  });

  it('relabels without changing stable persisted identity or unknown metadata', () => {
    const field = definition(TEMPLATE_SCOPE, {
      id: 'stable-id', key: 'custom.note', label: 'Old label', type: 'text', futureSetting: { x: 1 },
    });
    const before = snapshot('{{custom.note}}', [field]);
    const result = applyFieldLifecycleTransaction({
      scope: TEMPLATE_SCOPE,
      snapshot: before,
      intent: { kind: 'relabel', identity: field.identity, label: 'New label' },
    });
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    const [next] = result.transaction.after.definitions;
    expect(next.identity).toBe(field.identity);
    expect(next.label).toBe('New label');
    expect(next.original).toEqual({
      id: 'stable-id', key: 'custom.note', label: 'New label', type: 'text', futureSetting: { x: 1 },
    });
  });

  it('migrates key/path, every parsed reference, linked definitions and dependent metadata atomically', () => {
    const field = definition(TEMPLATE_SCOPE, {
      id: 'field-note', key: 'custom.note', path: 'custom.note', label: 'Note', type: 'text', future: 'keep',
    });
    const linked = definition(TEMPLATE_SCOPE, {
      id: 'field-copy', key: 'custom.copy', label: 'Copy', type: 'text', linkedTo: 'custom.note', linkedFuture: 9,
    });
    const before = snapshot(
      '<p>{{custom.note}} {{UCASE(custom.note)}}</p>',
      [field, linked],
      { titleDateFieldKey: 'custom.note', unrelated: { keep: true } },
    );
    const result = applyFieldLifecycleTransaction({
      scope: TEMPLATE_SCOPE,
      snapshot: before,
      intent: { kind: 'migrate-key', identity: field.identity, nextKey: 'custom.memo' },
      metadataAdapter: ({ metadata, change }) => change.kind === 'migrate-key'
        ? { ...metadata, titleDateFieldKey: change.nextKey }
        : metadata,
    });
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(result.transaction.after.content).toBe('<p>{{custom.memo}} {{UCASE(custom.memo)}}</p>');
    expect(result.transaction.changedOccurrenceIds).toHaveLength(2);
    const migrated = result.transaction.after.definitions.find((item) => item.persistedId === 'field-note')!;
    const migratedLinked = result.transaction.after.definitions.find((item) => item.persistedId === 'field-copy')!;
    expect(migrated.identity).toBe(field.identity);
    expect(migrated.key).toBe('custom.memo');
    expect(migrated.path).toBe('custom.memo');
    expect(migrated.unknownMetadata).toEqual({ future: 'keep' });
    expect(migratedLinked.linkedTo).toBe('custom.memo');
    expect(migratedLinked.unknownMetadata).toEqual({ linkedFuture: 9 });
    expect(result.transaction.after.dependentMetadata).toEqual({
      titleDateFieldKey: 'custom.memo', unrelated: { keep: true },
    });
  });

  it('requires confirmation before destructive reference removal, then preserves host structure', () => {
    const field = definition(TEMPLATE_SCOPE, {
      id: 'delete-me', key: 'custom.note', label: 'Note', type: 'text',
    });
    const before = snapshot('<p>Before {{custom.note}} after {{custom.note}}</p>', [field]);
    const requested = applyFieldLifecycleTransaction({
      scope: TEMPLATE_SCOPE,
      snapshot: before,
      intent: { kind: 'delete', identity: field.identity, referenceAction: 'remove-references' },
    });
    expect(requested).toEqual(expect.objectContaining({
      status: 'needs-confirmation', identity: field.identity, usageCount: 2,
    }));

    const confirmed = applyFieldLifecycleTransaction({
      scope: TEMPLATE_SCOPE,
      snapshot: before,
      intent: { kind: 'delete', identity: field.identity, referenceAction: 'remove-references' },
      confirmReferenceRemoval: true,
    });
    expect(confirmed.status).toBe('applied');
    if (confirmed.status !== 'applied') return;
    expect(confirmed.transaction.after.content).toBe('<p>Before  after </p>');
    expect(confirmed.transaction.after.definitions).toEqual([]);
    expect(confirmed.transaction.changedOccurrenceIds).toHaveLength(2);
  });

  it('can remove a definition while explicitly preserving unresolved legacy source', () => {
    const field = definition(TEMPLATE_SCOPE, {
      id: 'keep-source', key: 'custom.note', label: 'Note', type: 'text',
    });
    const before = snapshot('<p>{{custom.note}}</p>', [field]);
    const result = applyFieldLifecycleTransaction({
      scope: TEMPLATE_SCOPE,
      snapshot: before,
      intent: { kind: 'delete', identity: field.identity, referenceAction: 'keep-unresolved' },
    });
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(result.transaction.after.content).toBe(before.content);
    expect(result.transaction.after.definitions).toEqual([]);
  });

  it('preserves unknown metadata on definition changes and rejects structural patches without mutation', () => {
    const field = definition(TEMPLATE_SCOPE, {
      id: 'patch-field', key: 'custom.note', label: 'Note', type: 'text', futureSetting: { rows: 4 },
    });
    const before = snapshot('{{custom.note}}', [field], { untouched: true });
    const changed = applyFieldLifecycleTransaction({
      scope: TEMPLATE_SCOPE,
      snapshot: before,
      intent: {
        kind: 'change-definition',
        identity: field.identity,
        patch: { required: true, format: { mode: 'uppercase' } },
      },
    });
    expect(changed.status).toBe('applied');
    if (changed.status !== 'applied') return;
    expect(changed.transaction.after.definitions[0].original).toEqual({
      id: 'patch-field', key: 'custom.note', label: 'Note', type: 'text',
      futureSetting: { rows: 4 }, required: true, format: { mode: 'uppercase' },
    });
    expect(changed.transaction.after.dependentMetadata).toBe(before.dependentMetadata);

    const rejected = applyFieldLifecycleTransaction({
      scope: TEMPLATE_SCOPE,
      snapshot: before,
      intent: { kind: 'change-definition', identity: field.identity, patch: { key: 'custom.other' } },
    });
    expect(rejected).toEqual(expect.objectContaining({
      status: 'rejected', code: 'structural-field-patch-requires-migration',
    }));
    expect(before).toEqual(snapshot('{{custom.note}}', [field], { untouched: true }));
  });

  it('rejects cross-scope insertion instead of flattening owner identity', () => {
    const partialField = definition(PARTIAL_A_SCOPE, {
      id: 'partial-only', key: 'custom.note', label: 'Note', type: 'text',
    });
    const before = snapshot('<p></p>', []);
    const result = applyFieldLifecycleTransaction({
      scope: TEMPLATE_SCOPE,
      snapshot: before,
      intent: { kind: 'insert-reference', definition: partialField, at: 3 },
    });
    expect(result).toEqual(expect.objectContaining({ status: 'rejected', code: 'field-scope-mismatch' }));
    expect(before.content).toBe('<p></p>');
    expect(before.definitions).toEqual([]);
  });
});
