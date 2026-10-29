import { prisma } from '@/lib/prisma';
import type {
  JsonValue,
  PlaceholderDefinition,
} from '@/lib/validations/document-template';
import {
  buildOakDocMigrationContentJson,
  OAKDOC_STANDARD_TEMPLATE_MIGRATIONS,
  readOakDocSeedMigrationMetadata,
  validateOakDocMigrationMaster,
  type OakDocStandardTemplateMigrationDefinition,
} from '@/lib/document-editor/oakdoc-standard-template-migrations';
import {
  readOakDocTemplateMetadata,
} from '@/lib/document-editor/oakdoc-template';
import { createOakDocTemplate } from '@/services/oakdoc-template.service';
import type { TenantAwareParams } from '@/lib/types';

export type OakDocTemplateMigrationStatus = 'created' | 'preserved';

export interface OakDocTemplateMigrationResult {
  migrationId: string;
  migrationVersion: number;
  status: OakDocTemplateMigrationStatus;
  templateId: string;
  reason: 'created' | 'already-seeded' | 'existing-oakdoc-preserved';
}

type ExistingMigrationTemplate = {
  id: string;
  contentJson: unknown;
};

export interface OakDocTemplateMigrationDependencies {
  findExistingMigration: (
    definition: OakDocStandardTemplateMigrationDefinition,
    tenantId: string,
  ) => Promise<ExistingMigrationTemplate | null>;
  createTemplate: typeof createOakDocTemplate;
}

const defaultDependencies: OakDocTemplateMigrationDependencies = {
  async findExistingMigration(definition, tenantId) {
    return prisma.documentTemplate.findFirst({
      where: {
        tenantId,
        deletedAt: null,
        OR: [
          {
            contentJson: {
              path: ['oakDocSeedMigration', 'migrationId'],
              equals: definition.migrationId,
            },
          },
          { name: definition.oakDocTemplateName },
        ],
      },
      select: {
        id: true,
        contentJson: true,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  },
  createTemplate: createOakDocTemplate,
};

export async function ensureOakDocTemplateMigration(
  definition: OakDocStandardTemplateMigrationDefinition,
  params: TenantAwareParams,
  dependencies: OakDocTemplateMigrationDependencies = defaultDependencies,
): Promise<OakDocTemplateMigrationResult> {
  const existing = await dependencies.findExistingMigration(
    definition,
    params.tenantId,
  );
  if (existing) {
    const migration = readOakDocSeedMigrationMetadata(existing.contentJson);
    const oakDoc = readOakDocTemplateMetadata(existing.contentJson);
    const isUntouchedSeed = Boolean(
      migration
      && oakDoc
      && migration.migrationVersion === definition.migrationVersion
      && oakDoc.sha256 === migration.sourceSha256
    );
    return {
      migrationId: definition.migrationId,
      migrationVersion: definition.migrationVersion,
      status: 'preserved',
      templateId: existing.id,
      reason: isUntouchedSeed ? 'already-seeded' : 'existing-oakdoc-preserved',
    };
  }

  const sourceBytes = definition.buildDocx();
  const validation = validateOakDocMigrationMaster(definition, sourceBytes);
  if (!validation.valid) {
    throw new Error(
      `OakDoc migration ${definition.migrationId} failed validation: `
      + validation.errors.join('; '),
    );
  }

  const created = await dependencies.createTemplate({
    name: definition.oakDocTemplateName,
    description: definition.description,
    category: definition.category,
    isActive: true,
    fileName: definition.fileName,
    buffer: Buffer.from(sourceBytes),
    contentJson: buildOakDocMigrationContentJson(
      definition,
      sourceBytes,
    ) as Record<string, JsonValue>,
    placeholders: definition.placeholders.map(
      (placeholder) => ({ ...placeholder }) as PlaceholderDefinition,
    ),
  }, params);

  return {
    migrationId: definition.migrationId,
    migrationVersion: definition.migrationVersion,
    status: 'created',
    templateId: created.id,
    reason: 'created',
  };
}

export async function ensureAllOakDocTemplateMigrations(
  params: TenantAwareParams,
): Promise<OakDocTemplateMigrationResult[]> {
  const results: OakDocTemplateMigrationResult[] = [];
  for (const definition of OAKDOC_STANDARD_TEMPLATE_MIGRATIONS) {
    results.push(await ensureOakDocTemplateMigration(definition, params));
  }
  return results;
}
