import { describe, expect, it } from 'vitest';

import { validateTemplateSyntax as validateEditorTemplateSyntax } from '@/components/documents/template-editor/template-validation';
import {
  mergeTemplateAndPartialPlaceholders,
  normalizeStoredPlaceholders,
  storageFormatToCustomPlaceholders,
} from '@/lib/template-analysis';
import { resolvePlaceholders } from '@/lib/placeholder-resolver';
import { resolveTemplateFields } from '@/lib/template-field-runtime';
import {
  editorPlaceholdersToStorage,
  storagePlaceholdersToEditor,
} from '@/lib/template-placeholder-storage';
import type { CustomPlaceholderDefinition } from '@/types/placeholders';

/** F1 closes parser/identity/storage gaps; F2 escaping/coercion baselines remain explicit. */
describe('FIELDS F1 compatibility adoption', () => {
  it('spaced simple syntax accepted by editor validation also resolves through the F1 front end', () => {
    const source = '<p>{{ custom.note }}</p>';
    const issues = validateEditorTemplateSyntax(source, new Set(['custom.note']));
    expect(issues).toEqual([]);

    const result = resolveTemplateFields(source, { custom: { note: 'Resolved note' } });
    expect(result.resolved).toBe('<p>Resolved note</p>');
    expect(result.missing).toEqual([]);
  });

  it('formatting inside a field expression is diagnosed', () => {
    const source = '<p>{{custom.<b>note</b>}}</p>';
    const issues = validateEditorTemplateSyntax(source, new Set(['custom.note']));
    expect(issues).toEqual([
      expect.objectContaining({
        code: 'unknown-placeholder',
        diagnosticCode: 'formatted-expression',
      }),
    ]);
  });

  it('a no-change editor round-trip preserves legacy list type', () => {
    const stored = [{
      key: 'custom.items', label: 'Items', type: 'list', source: 'custom',
      category: 'custom', path: 'custom.items', required: false, options: ['A', 'B'],
    }];
    expect(editorPlaceholdersToStorage(storagePlaceholdersToEditor(stored))).toEqual(stored);
  });

  it('a no-change editor round-trip preserves legacy conditional type', () => {
    const stored = [{
      key: 'custom.enabled', label: 'Enabled', type: 'conditional', source: 'custom',
      category: 'custom', path: 'custom.enabled', required: false, format: 'yes-no',
    }];
    expect(editorPlaceholdersToStorage(storagePlaceholdersToEditor(stored))).toEqual(stored);
  });

  it('loading the same stored field twice yields the same identity', () => {
    const stored = [{
      key: 'custom.note', label: 'Note', type: 'text', source: 'custom',
      category: 'custom', path: 'custom.note',
    }];
    const [first] = storagePlaceholdersToEditor(stored);
    const [second] = storagePlaceholdersToEditor(stored);
    expect(first.id).toBe(second.id);
  });

  it('the two field adapters agree on an omitted required flag without persisting it', () => {
    const stored = [{
      key: 'custom.note', label: 'Note', type: 'text', source: 'custom',
      category: 'custom', path: 'custom.note',
    }];
    const [editorAdapter] = storagePlaceholdersToEditor(stored);
    const [analysisAdapter] = storageFormatToCustomPlaceholders(normalizeStoredPlaceholders(stored));
    expect(editorAdapter.required).toBe(false);
    expect(editorAdapter.required).toBe(analysisAdapter.required);
    expect(editorPlaceholdersToStorage([editorAdapter])).toEqual(stored);
  });

  it('parent and partial collisions retain the same scoped key instead of renaming input identity', () => {
    const templatePlaceholders: CustomPlaceholderDefinition[] = [{
      id: 'template-note', key: 'note', label: 'Parent note', type: 'text', required: false,
    }];
    const merged = mergeTemplateAndPartialPlaceholders({
      templatePlaceholders,
      templateContent: '{{> review-partial}}',
      partials: [{
        id: 'partial-1', name: 'review-partial', content: '<p>{{custom.note}}</p>',
        placeholders: [{
          key: 'custom.note', label: 'Partial note', type: 'text', source: 'custom',
          category: 'custom', path: 'custom.note', required: false,
        }],
      }],
    });
    expect(merged.map((field) => field.key)).toEqual(['note', 'note']);
    expect(merged[0].id).not.toBe(merged[1].id);
  });

  it('nested partial field discovery includes nested definitions', () => {
    const merged = mergeTemplateAndPartialPlaceholders({
      templatePlaceholders: [],
      templateContent: '{{> outer}}',
      partials: [
        { id: 'partial-outer', name: 'outer', content: '{{> inner}}', placeholders: [] },
        {
          id: 'partial-inner', name: 'inner', content: '<p>{{custom.note}}</p>',
          placeholders: [{
            key: 'custom.note', label: 'Nested note', type: 'text', source: 'custom',
            category: 'custom', path: 'custom.note', required: false,
          }],
        },
      ],
    });
    expect(merged).toEqual([
      expect.objectContaining({ sourceName: 'inner', key: 'note' }),
    ]);
  });

  it.fails('F2 baseline: ordinary text values cannot introduce HTML markup', () => {
    const result = resolvePlaceholders(
      '<p>{{custom.note}}</p>',
      { custom: { note: 'A & B <em>literal</em>' } },
    );
    expect(result.resolved).toBe('<p>A &amp; B &lt;em&gt;literal&lt;/em&gt;</p>');
  });

  it.fails('F2 baseline: ISO-looking text remains text unless its field type says date', () => {
    const result = resolvePlaceholders(
      '<p>{{custom.reference}}</p>',
      { custom: { reference: '2026-09-11' } },
    );
    expect(result.resolved).toBe('<p>2026-09-11</p>');
  });
});
