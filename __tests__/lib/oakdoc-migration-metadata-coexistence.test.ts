import { describe, expect, it } from 'vitest';

import {
  DR_APPOINTMENT_OF_CORP_SEC_OAKDOC_MIGRATION,
  buildOakDocMigrationContentJson,
  readOakDocSeedMigrationMetadata,
} from '@/lib/document-editor/oakdoc-standard-template-migrations';
import {
  createOakDocMigrationMetadata,
  mergeOakDocMigrationMetadata,
  readOakDocMigrationMetadata,
} from '@/lib/document-editor/oakdoc-migration';

describe('OakDoc migration metadata coexistence', () => {
  it('preserves seed identity when Stage 7 legacy-link metadata is added', () => {
    const seeded = buildOakDocMigrationContentJson(
      DR_APPOINTMENT_OF_CORP_SEC_OAKDOC_MIGRATION,
    );
    const linked = mergeOakDocMigrationMetadata(
      seeded,
      createOakDocMigrationMetadata({
        legacyTemplateId: 'legacy-template-1',
        legacyTemplateVersion: 3,
        linkedAt: '2026-09-26T01:00:00.000Z',
      }),
    );

    expect(readOakDocSeedMigrationMetadata(linked)).toMatchObject({
      migrationId: 'standard-template:dr-appointment-of-corp-sec',
      migrationVersion: 1,
      legacyTemplateName: 'DR_Appointment of Corp Sec',
    });
    expect(readOakDocMigrationMetadata(linked)).toMatchObject({
      legacyTemplateId: 'legacy-template-1',
      legacyTemplateVersion: 3,
      preference: 'LEGACY',
    });
    expect(linked).toHaveProperty('oakDocSeedMigration');
    expect(linked).toHaveProperty('oakDocMigration');
  });

  it('still reads Stage 3 records written before the metadata-key split', () => {
    const current = buildOakDocMigrationContentJson(
      DR_APPOINTMENT_OF_CORP_SEC_OAKDOC_MIGRATION,
    ) as Record<string, unknown>;
    const legacyShape = {
      oakDocMigration: current.oakDocSeedMigration,
    };

    expect(readOakDocSeedMigrationMetadata(legacyShape)).toMatchObject({
      migrationId: 'standard-template:dr-appointment-of-corp-sec',
      migrationVersion: 1,
    });
  });
});
