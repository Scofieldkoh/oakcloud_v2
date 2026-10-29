import { describe, expect, it } from 'vitest';
import {
  RESERVED_GENERATED_METADATA_KEYS,
  RESERVED_TEMPLATE_CONTENT_JSON_KEYS,
  TEMPLATE_AUTHORITY_KEYS,
  assertNoReservedKeys,
  mergeUserJsonPreservingReserved,
  stripKeys,
} from '@/lib/document-editor/oakdoc-reserved-metadata';
import { ValidationError } from '@/lib/errors';

const oakDoc = { schemaVersion: 1, storageKey: 't/templates/oakdoc/assets/a.docx', sha256: 'a'.repeat(64) };

describe('OakDoc reserved metadata', () => {
  it('preserves reserved keys a generic writer omits', () => {
    const merged = mergeUserJsonPreservingReserved(
      { oakDoc, layout: { version: 1 } },
      { layout: { version: 2 } },
      RESERVED_TEMPLATE_CONTENT_JSON_KEYS,
      'contentJson',
    );
    expect(merged).toEqual({ oakDoc, layout: { version: 2 } });
  });

  it('allows reserved keys to round-trip unchanged regardless of key order', () => {
    const merged = mergeUserJsonPreservingReserved(
      { oakDoc },
      { oakDoc: { sha256: oakDoc.sha256, storageKey: oakDoc.storageKey, schemaVersion: 1 }, note: 'x' },
      RESERVED_TEMPLATE_CONTENT_JSON_KEYS,
      'contentJson',
    );
    expect(merged).toEqual({ oakDoc, note: 'x' });
  });

  it('rejects forged or altered reserved keys with a safe reason code', () => {
    expect(() => mergeUserJsonPreservingReserved(
      { oakDoc },
      { oakDoc: { ...oakDoc, storageKey: 'other-tenant/templates/oakdoc/assets/x.docx' } },
      RESERVED_TEMPLATE_CONTENT_JSON_KEYS,
      'contentJson',
    )).toThrow(ValidationError);

    try {
      mergeUserJsonPreservingReserved(
        { selectedParties: {} },
        { documentEngine: 'OAKDOC', oakDocGenerated: { sha256: 'b'.repeat(64) } },
        RESERVED_GENERATED_METADATA_KEYS,
        'metadata',
      );
      expect.unreachable();
    } catch (error) {
      expect((error as ValidationError).details).toMatchObject({
        reason: 'OAKDOC_RESERVED_METADATA',
        keys: ['documentEngine', 'oakDocGenerated'],
      });
    }
  });

  it('keeps reserved keys when a writer clears the object', () => {
    expect(mergeUserJsonPreservingReserved(
      { documentEngine: 'OAKDOC', note: 'x' },
      null,
      RESERVED_GENERATED_METADATA_KEYS,
      'metadata',
    )).toEqual({ documentEngine: 'OAKDOC' });
    expect(mergeUserJsonPreservingReserved({ note: 'x' }, null, RESERVED_GENERATED_METADATA_KEYS, 'metadata'))
      .toBeNull();
  });

  it('forbids reserved keys on untrusted creates and strips authority from copies', () => {
    expect(() => assertNoReservedKeys({ oakDoc }, RESERVED_TEMPLATE_CONTENT_JSON_KEYS, 'contentJson'))
      .toThrow(ValidationError);
    expect(() => assertNoReservedKeys({ layout: {} }, RESERVED_TEMPLATE_CONTENT_JSON_KEYS, 'contentJson'))
      .not.toThrow();
    expect(stripKeys({ oakDoc, oakDocMigration: { preference: 'OAKDOC' }, oakDocSeedMigration: {} }, TEMPLATE_AUTHORITY_KEYS))
      .toEqual({ oakDoc });
  });
});
