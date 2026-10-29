import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import {
  DR_APPOINTMENT_OF_CORP_SEC_OAKDOC_MIGRATION,
  buildOakDocMigrationContentJson,
  generateOakDocMigrationDocument,
  migrationMetadataFor,
  validateOakDocMigrationMaster,
} from '@/lib/document-editor/oakdoc-standard-template-migrations';
import { mergeOakDocTemplateMetadata } from '@/lib/document-editor/oakdoc-template';
import { ensureOakDocTemplateMigration } from '@/services/oakdoc-template-migration.service';
import { deriveOakDocTemplateFieldTags } from '@/services/oakdoc-template.service';

const params = { tenantId: 'workspace-1', userId: 'user-1' };

describe('OakDoc standard template migration framework', () => {
  it('maps every legacy field in DR_Appointment of Corp Sec to a stable OakDoc tag', () => {
    expect(DR_APPOINTMENT_OF_CORP_SEC_OAKDOC_MIGRATION.fieldMappings).toEqual([
      { legacyField: 'company.name', oakDocTag: 'company.name' },
      { legacyField: 'company.uen', oakDocTag: 'company.uen' },
      { legacyField: 'custom.resolution_date', oakDocTag: 'resolution.date' },
      {
        legacyField: 'directors[].name',
        oakDocTag: 'director.name',
        repeaterTag: 'repeat.directors',
      },
      {
        legacyField: 'directors[].role',
        oakDocTag: 'director.role',
        repeaterTag: 'repeat.directors',
      },
    ]);
    expect(DR_APPOINTMENT_OF_CORP_SEC_OAKDOC_MIGRATION.expectedConditions).toEqual([]);
  });

  it('validates the native DOCX master and rejects legacy placeholders', () => {
    const source = DR_APPOINTMENT_OF_CORP_SEC_OAKDOC_MIGRATION.buildDocx();
    const validation = validateOakDocMigrationMaster(
      DR_APPOINTMENT_OF_CORP_SEC_OAKDOC_MIGRATION,
      source,
    );

    expect(validation).toMatchObject({
      valid: true,
      errors: [],
      legacyPlaceholders: [],
      repeaterTags: ['repeat.directors'],
      conditionTags: [],
    });
    expect(validation.fieldTags).toEqual([
      'company.name',
      'company.uen',
      'director.name',
      'director.role',
      'resolution.date',
    ]);

    const files = unzipSync(source);
    expect(files['word/document.xml']).toBeDefined();
    const xml = strFromU8(files['word/document.xml']);
    expect(xml).toContain(
      '<w:pgMar w:top="850" w:right="1134" w:bottom="850" w:left="1134"',
    );
    expect(xml).not.toMatch(/\{\{[^{}]+\}\}/);
  });

  it('generates a realistic resolution with company, date and all directors resolved', () => {
    const generated = generateOakDocMigrationDocument({
      definition: DR_APPOINTMENT_OF_CORP_SEC_OAKDOC_MIGRATION,
      company: {
        id: 'company-1',
        name: 'Rocket Logistics Pte. Ltd.',
        uen: '202612345N',
        officers: [
          {
            id: 'director-1',
            name: 'Alex Tan',
            role: 'DIRECTOR',
            identificationNumber: 'S1234567A',
            isCurrent: true,
          },
          {
            id: 'director-2',
            name: 'Jamie Lim',
            role: 'NOMINEE DIRECTOR',
            identificationNumber: 'S7654321B',
            isCurrent: true,
          },
        ],
      },
      resolutionDate: '2026-09-25',
      generatedBy: 'Corporate Services Team',
    });

    expect(generated.unresolvedTags).toEqual([]);

    const files = unzipSync(generated.bytes);
    const xml = strFromU8(files['word/document.xml']);
    expect(xml).toContain('Rocket Logistics Pte. Ltd.');
    expect(xml).toContain('202612345N');
    expect(xml).toContain('25 Sep 2026');
    expect(xml).toContain('Alex Tan');
    expect(xml).toContain('Jamie Lim');
    expect(xml).toContain('Nominee Director');
    expect(xml).not.toContain('SAMPLE COMPANY PTE. LTD.');
    expect(xml).not.toContain('repeat.directors');
    expect(xml).not.toMatch(/\{\{[^{}]+\}\}/);
  });

  it('creates the migrated OakDoc template once with migration metadata and typed date input', async () => {
    const createTemplate = vi.fn().mockResolvedValue({ id: 'oakdoc-template-1' });
    const result = await ensureOakDocTemplateMigration(
      DR_APPOINTMENT_OF_CORP_SEC_OAKDOC_MIGRATION,
      params,
      {
        findExistingMigration: vi.fn().mockResolvedValue(null),
        createTemplate: createTemplate as never,
      },
    );

    expect(result).toEqual({
      migrationId: 'standard-template:dr-appointment-of-corp-sec',
      migrationVersion: 1,
      status: 'created',
      templateId: 'oakdoc-template-1',
      reason: 'created',
    });
    const input = createTemplate.mock.calls[0][0];
    expect(input.name).toBe('DR_Appointment of Corp Sec (OakDoc)');
    // The manifest is derived from the stored bytes, not supplied by callers.
    expect(input).not.toHaveProperty('fieldTags');
    expect(deriveOakDocTemplateFieldTags(new Uint8Array(input.buffer))).toEqual([
      'company.name',
      'company.uen',
      'director.name',
      'director.role',
      'repeat.directors',
      'resolution.date',
    ]);
    expect(input.placeholders).toEqual([
      {
        key: 'custom.resolution_date',
        path: 'custom.resolution_date',
        type: 'date',
        label: 'Resolution date',
        source: 'custom',
        category: 'custom',
        required: true,
      },
    ]);
    expect(input.contentJson.oakDocSeedMigration).toMatchObject({
      migrationId: 'standard-template:dr-appointment-of-corp-sec',
      migrationVersion: 1,
      legacyTemplateName: 'DR_Appointment of Corp Sec',
    });
  });

  it('preserves both untouched and user-edited migrated OakDoc templates', async () => {
    const source = DR_APPOINTMENT_OF_CORP_SEC_OAKDOC_MIGRATION.buildDocx();
    const migrationJson = buildOakDocMigrationContentJson(
      DR_APPOINTMENT_OF_CORP_SEC_OAKDOC_MIGRATION,
      source,
    );
    const migration = migrationMetadataFor(
      DR_APPOINTMENT_OF_CORP_SEC_OAKDOC_MIGRATION,
      source,
    );

    const untouched = mergeOakDocTemplateMetadata(migrationJson, {
      schemaVersion: 1,
      storageKey: 'workspace-1/templates/oakdoc/assets/source',
      fileName: 'DR_Appointment_of_Corp_Sec_OakDoc.docx',
      fileSize: source.byteLength,
      sha256: migration.sourceSha256,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      fieldTags: [...DR_APPOINTMENT_OF_CORP_SEC_OAKDOC_MIGRATION.expectedFieldTags],
    });
    const createTemplate = vi.fn();

    const seeded = await ensureOakDocTemplateMigration(
      DR_APPOINTMENT_OF_CORP_SEC_OAKDOC_MIGRATION,
      params,
      {
        findExistingMigration: vi.fn().mockResolvedValue({
          id: 'existing-oakdoc',
          contentJson: untouched,
        }),
        createTemplate: createTemplate as never,
      },
    );
    expect(seeded.reason).toBe('already-seeded');

    const edited = mergeOakDocTemplateMetadata(migrationJson, {
      schemaVersion: 1,
      storageKey: 'workspace-1/templates/oakdoc/assets/edited',
      fileName: 'DR_Appointment_of_Corp_Sec_OakDoc.docx',
      fileSize: source.byteLength + 10,
      sha256: 'a'.repeat(64),
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      fieldTags: [...DR_APPOINTMENT_OF_CORP_SEC_OAKDOC_MIGRATION.expectedFieldTags],
    });
    const preserved = await ensureOakDocTemplateMigration(
      DR_APPOINTMENT_OF_CORP_SEC_OAKDOC_MIGRATION,
      params,
      {
        findExistingMigration: vi.fn().mockResolvedValue({
          id: 'user-edited-oakdoc',
          contentJson: edited,
        }),
        createTemplate: createTemplate as never,
      },
    );

    expect(preserved.reason).toBe('existing-oakdoc-preserved');
    expect(createTemplate).not.toHaveBeenCalled();
  });
});
