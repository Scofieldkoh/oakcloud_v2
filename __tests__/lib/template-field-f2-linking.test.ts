import { describe, expect, it } from 'vitest';

import {
  loadLosslessStoredFieldDefinition,
  type FieldOwnerScope,
} from '@/lib/template-field-contract';
import { applyFieldLifecycleTransaction } from '@/lib/template-field-lifecycle';

const TEMPLATE_SCOPE: FieldOwnerScope = { kind: 'template', id: 'linking-template' };
const PARTIAL_SCOPE: FieldOwnerScope = { kind: 'partial', id: 'linking-partial' };

describe('FIELDS F2 scoped linking migration', () => {
  it('migrates same-scope key links and explicit identity links without rewriting a same-named foreign-scope link', () => {
    const target = loadLosslessStoredFieldDefinition({
      scope: TEMPLATE_SCOPE,
      definition: {
        id: 'target-field', key: 'custom.note', path: 'custom.note', label: 'Note', type: 'text',
      },
    });
    const sameScopeKeyLink = loadLosslessStoredFieldDefinition({
      scope: TEMPLATE_SCOPE,
      definition: {
        id: 'same-scope-link', key: 'custom.same', label: 'Same', type: 'text', linkedTo: 'custom.note',
      },
    });
    const explicitIdentityLink = loadLosslessStoredFieldDefinition({
      scope: PARTIAL_SCOPE,
      definition: {
        id: 'explicit-link', key: 'custom.explicit', label: 'Explicit', type: 'text', linkedTo: target.identity,
      },
    });
    const foreignSameNamedLink = loadLosslessStoredFieldDefinition({
      scope: PARTIAL_SCOPE,
      definition: {
        id: 'foreign-key-link', key: 'custom.foreign', label: 'Foreign', type: 'text', linkedTo: 'custom.note',
      },
    });

    const result = applyFieldLifecycleTransaction({
      scope: TEMPLATE_SCOPE,
      snapshot: {
        content: '<p>{{custom.note}}</p>',
        definitions: [target, sameScopeKeyLink, explicitIdentityLink, foreignSameNamedLink],
        dependentMetadata: {},
      },
      intent: { kind: 'migrate-key', identity: target.identity, nextKey: 'custom.memo' },
    });

    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    const byId = new Map(result.transaction.after.definitions.map((item) => [item.persistedId, item]));
    expect(byId.get('same-scope-link')?.linkedTo).toBe('custom.memo');
    expect(byId.get('explicit-link')?.linkedTo).toBe(target.identity);
    expect(byId.get('foreign-key-link')?.linkedTo).toBe('custom.note');
    expect(result.transaction.after.content).toBe('<p>{{custom.memo}}</p>');
  });

  it('requires explicit confirmation before unlinking dependent definitions during delete', () => {
    const target = loadLosslessStoredFieldDefinition({
      scope: TEMPLATE_SCOPE,
      definition: {
        id: 'delete-target', key: 'custom.deleteTarget', label: 'Delete target', type: 'text',
      },
    });
    const dependent = loadLosslessStoredFieldDefinition({
      scope: TEMPLATE_SCOPE,
      definition: {
        id: 'delete-dependent', key: 'custom.dependent', label: 'Dependent', type: 'text',
        linkedTo: target.identity, futureMetadata: { keep: true },
      },
    });
    const before = {
      content: '<p>{{custom.dependent}}</p>',
      definitions: [target, dependent],
      dependentMetadata: { keep: true },
    };

    const requested = applyFieldLifecycleTransaction({
      scope: TEMPLATE_SCOPE,
      snapshot: before,
      intent: { kind: 'delete', identity: target.identity, referenceAction: 'keep-unresolved' },
    });
    expect(requested).toEqual(expect.objectContaining({
      status: 'needs-confirmation',
      identity: target.identity,
      usageCount: 0,
      occurrenceIds: [],
      linkedFieldIdentities: [dependent.identity],
    }));

    const confirmed = applyFieldLifecycleTransaction({
      scope: TEMPLATE_SCOPE,
      snapshot: before,
      intent: { kind: 'delete', identity: target.identity, referenceAction: 'keep-unresolved' },
      confirmDependentUnlink: true,
    });
    expect(confirmed.status).toBe('applied');
    if (confirmed.status !== 'applied') return;
    expect(confirmed.transaction.after.content).toBe(before.content);
    expect(confirmed.transaction.after.definitions).toHaveLength(1);
    expect(confirmed.transaction.after.definitions[0].identity).toBe(dependent.identity);
    expect(confirmed.transaction.after.definitions[0].linkedTo).toBeUndefined();
    expect(confirmed.transaction.after.definitions[0].unknownMetadata).toEqual({
      futureMetadata: { keep: true },
    });
    expect(confirmed.transaction.after.dependentMetadata).toEqual({ keep: true });
  });
});
