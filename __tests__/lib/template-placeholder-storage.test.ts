import { describe, expect, it } from 'vitest';

import {
  editorPlaceholdersToStorage,
  storagePlaceholdersToEditor,
} from '@/lib/template-placeholder-storage';

describe('template placeholder storage conversion', () => {
  it('round-trips service textarea definitions and forward-compatible metadata', () => {
    const stored = [{
      key: 'service.fields.software',
      label: 'Accounting software',
      type: 'textarea',
      source: 'service',
      category: 'service-input',
      path: 'service.fields.software',
      required: true,
      format: 'markdown',
      futureSetting: { rows: 6 },
    }] as const;

    const editor = storagePlaceholdersToEditor(stored);
    const roundTripped = editorPlaceholdersToStorage(editor);

    expect(roundTripped).toEqual(stored);
  });

  it('keeps textarea for custom fields instead of downgrading it', () => {
    const [editor] = storagePlaceholdersToEditor([{
      key: 'custom.notes',
      label: 'Notes',
      type: 'textarea',
      source: 'custom',
      category: 'custom',
      path: 'custom.notes',
      required: false,
    }]);

    expect(editorPlaceholdersToStorage([editor])).toEqual([{
      key: 'custom.notes',
      label: 'Notes',
      type: 'textarea',
      source: 'custom',
      category: 'custom',
      path: 'custom.notes',
      required: false,
    }]);
  });

  it('serializes a newly authored custom field under the custom namespace', () => {
    expect(editorPlaceholdersToStorage([{
      id: 'field-1',
      key: 'engagement_notes',
      label: 'Engagement notes',
      type: 'textarea',
      required: true,
    }])).toEqual([{
      key: 'custom.engagement_notes',
      label: 'Engagement notes',
      type: 'textarea',
      source: 'custom',
      category: 'custom',
      path: 'custom.engagement_notes',
      required: true,
    }]);
  });
});
