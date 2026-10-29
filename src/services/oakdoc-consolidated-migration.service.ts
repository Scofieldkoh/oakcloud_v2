import { createHash } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import type { TenantAwareParams } from '@/lib/types';
import {
  OAKDOC_STANDARD_TEMPLATE_MIGRATIONS,
} from '@/lib/document-editor/oakdoc-standard-template-migrations';
import {
  OAKTREE_SERVICE_AGREEMENT_OAKDOC,
  buildOaktreeServiceAgreementOakDoc,
} from '@/content/service-agreement/oaktree-service-agreement-oakdoc';
import { OAKTREE_SERVICE_AGREEMENT_V1 } from '@/content/service-agreement/oaktree-service-agreement-v1';
import { readOakDocTemplateMetadata } from '@/lib/document-editor/oakdoc-template';
import {
  ensureAllOakDocTemplateMigrations,
  type OakDocTemplateMigrationResult,
} from '@/services/oakdoc-template-migration.service';
import { createOakDocTemplate } from '@/services/oakdoc-template.service';
import { linkOakDocMigration } from '@/services/oakdoc-migration.service';

export interface ConsolidatedOakDocMigrationTemplateResult {
  templateId: string;
  templateName: string;
  status: 'created' | 'preserved';
  legacyTemplateId: string | null;
  linked: boolean;
  active: boolean;
}

export interface ConsolidatedOakDocMigrationResult {
  tenantId: string;
  standard: OakDocTemplateMigrationResult[];
  serviceAgreement: ConsolidatedOakDocMigrationTemplateResult;
}

async function findLegacyTemplate(tenantId: string, name: string) {
  return prisma.documentTemplate.findFirst({
    where: {
      tenantId,
      name,
      deletedAt: null,
    },
    select: {
      id: true,
      version: true,
      isActive: true,
    },
  });
}

async function ensureServiceAgreementOakDoc(params: TenantAwareParams) {
  const source = Buffer.from(buildOaktreeServiceAgreementOakDoc());
  const digest = createHash('sha256').update(source).digest('hex');

  const existing = await prisma.documentTemplate.findFirst({
    where: {
      tenantId: params.tenantId,
      name: OAKTREE_SERVICE_AGREEMENT_OAKDOC.name,
      deletedAt: null,
    },
  });

  if (existing) {
    const metadata = readOakDocTemplateMetadata(existing.contentJson);
    if (!metadata) {
      throw new Error(
        `A non-OakDoc template already uses the reserved name "${OAKTREE_SERVICE_AGREEMENT_OAKDOC.name}".`,
      );
    }

    return {
      template: existing,
      status: 'preserved' as const,
      sourceMatchesSeed:
        metadata.sha256 === digest
        && metadata.fileName === OAKTREE_SERVICE_AGREEMENT_OAKDOC.fileName,
    };
  }

  const template = await createOakDocTemplate({
    name: OAKTREE_SERVICE_AGREEMENT_OAKDOC.name,
    description: OAKTREE_SERVICE_AGREEMENT_OAKDOC.description,
    category: OAKTREE_SERVICE_AGREEMENT_OAKDOC.category,
    compositionType: OAKTREE_SERVICE_AGREEMENT_OAKDOC.compositionType,
    isActive: OAKTREE_SERVICE_AGREEMENT_OAKDOC.isActive,
    fileName: OAKTREE_SERVICE_AGREEMENT_OAKDOC.fileName,
    buffer: source,
  }, params);

  return {
    template,
    status: 'created' as const,
    sourceMatchesSeed: true,
  };
}

async function linkIfPossible(input: {
  tenantId: string;
  userId: string;
  oakDocTemplateId: string;
  oakDocVersion: number;
  legacyTemplateName: string;
}): Promise<{ legacyTemplateId: string | null; linked: boolean }> {
  const legacy = await findLegacyTemplate(input.tenantId, input.legacyTemplateName);
  if (!legacy) {
    return { legacyTemplateId: null, linked: false };
  }

  await linkOakDocMigration({
    oakDocTemplateId: input.oakDocTemplateId,
    legacyTemplateId: legacy.id,
    expectedRevision: input.oakDocVersion,
    reason: 'Linked by consolidated OakDoc template migration',
  }, {
    tenantId: input.tenantId,
    userId: input.userId,
  });

  return { legacyTemplateId: legacy.id, linked: true };
}

export async function migrateCanonicalOakDocTemplates(
  params: TenantAwareParams,
): Promise<ConsolidatedOakDocMigrationResult> {
  const standard = await ensureAllOakDocTemplateMigrations(params);

  for (const definition of OAKDOC_STANDARD_TEMPLATE_MIGRATIONS) {
    const seeded = standard.find((item) => item.migrationId === definition.migrationId);
    if (!seeded) continue;

    const oakDoc = await prisma.documentTemplate.findFirst({
      where: {
        id: seeded.templateId,
        tenantId: params.tenantId,
        deletedAt: null,
      },
      select: { id: true, version: true },
    });
    if (!oakDoc) {
      throw new Error(`Seeded OakDoc template ${seeded.templateId} was not found`);
    }

    await linkIfPossible({
      tenantId: params.tenantId,
      userId: params.userId,
      oakDocTemplateId: oakDoc.id,
      oakDocVersion: oakDoc.version,
      legacyTemplateName: definition.legacyTemplateName,
    });
  }

  const serviceAgreementSeed = await ensureServiceAgreementOakDoc(params);
  const serviceAgreementTemplate = await prisma.documentTemplate.findFirst({
    where: {
      id: serviceAgreementSeed.template.id,
      tenantId: params.tenantId,
      deletedAt: null,
    },
    select: {
      id: true,
      name: true,
      version: true,
      isActive: true,
    },
  });
  if (!serviceAgreementTemplate) {
    throw new Error('Seeded OakDoc Service Agreement template was not found');
  }

  const serviceAgreementLink = await linkIfPossible({
    tenantId: params.tenantId,
    userId: params.userId,
    oakDocTemplateId: serviceAgreementTemplate.id,
    oakDocVersion: serviceAgreementTemplate.version,
    legacyTemplateName: OAKTREE_SERVICE_AGREEMENT_V1.template.name,
  });

  return {
    tenantId: params.tenantId,
    standard,
    serviceAgreement: {
      templateId: serviceAgreementTemplate.id,
      templateName: serviceAgreementTemplate.name,
      status: serviceAgreementSeed.status,
      legacyTemplateId: serviceAgreementLink.legacyTemplateId,
      linked: serviceAgreementLink.linked,
      active: serviceAgreementTemplate.isActive,
    },
  };
}
