import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@/generated/prisma';
import { prisma } from '@/lib/prisma';
import { createAuditLog } from '@/lib/audit';
import { NotFoundError } from '@/lib/errors';
import { storage, StorageKeys } from '@/lib/storage';
import { ensureA4ServerDomGlobals } from '@/lib/document-editor/a4-server-dom';
import { buildBlankOakDocBytes } from '@/lib/document-editor/oakdoc-html-import';
import { inspectOakDocPackage } from '@/lib/document-editor/oakdoc-package-policy';
import {
  OAKDOC_GENERATED_CONTENT,
  mergeGeneratedOakDocMetadata,
  type GeneratedOakDocAssetMetadata,
} from '@/lib/document-editor/document-engine';
import { OAKDOC_MIME_TYPE } from '@/lib/document-editor/oakdoc-template';
import type { CreateBlankDocumentInput } from '@/lib/validations/generated-document';
import type { TenantAwareParams } from '@/lib/types';
import type { TaskLaunchContext } from '@/services/tasks/types';

function safeDocxName(title: string): string {
  const base = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || 'Document';
  return base.toLowerCase().endsWith('.docx') ? base : `${base}.docx`;
}

/**
 * Create an empty OakDoc draft. It has no template, so the asset identity
 * points at the document itself and the blank package's hash, like a
 * converted draft points at its source.
 */
export async function createBlankOakDocDocument(
  data: Pick<CreateBlankDocumentInput, 'title' | 'companyId' | 'useLetterhead'>,
  params: TenantAwareParams,
  taskIntegrationContext?: TaskLaunchContext,
) {
  const { tenantId, userId } = params;
  if (data.companyId) {
    const company = await prisma.company.findFirst({
      where: { id: data.companyId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!company) throw new NotFoundError('Company not found');
  }

  ensureA4ServerDomGlobals();
  const bytes = buildBlankOakDocBytes();
  inspectOakDocPackage(bytes, 'draft');
  const buffer = Buffer.from(bytes);
  const sha256 = createHash('sha256').update(bytes).digest('hex');

  const id = randomUUID();
  const storageKey = StorageKeys.oakDocGeneratedAsset(tenantId, id, randomUUID());
  const createdAt = new Date().toISOString();
  await storage.upload(storageKey, buffer, {
    contentType: OAKDOC_MIME_TYPE,
    metadata: { tenantId, generatedDocumentId: id, sha256, generatedBy: userId },
  });

  const asset: GeneratedOakDocAssetMetadata = {
    schemaVersion: 1,
    storageKey,
    fileName: safeDocxName(data.title),
    fileSize: buffer.byteLength,
    sha256,
    mimeType: OAKDOC_MIME_TYPE,
    templateId: id,
    templateVersion: 1,
    templateSha256: sha256,
    generatedAt: createdAt,
    fieldsUpdated: 0,
    unresolvedTags: [],
    conditionsResolved: 0,
    conditionsKept: 0,
    conditionsRemoved: 0,
    repeatersResolved: 0,
    repeaterItemsCreated: 0,
  };
  const metadata = mergeGeneratedOakDocMetadata(
    {},
    asset,
    {},
    taskIntegrationContext
      ? {
          taskId: taskIntegrationContext.taskId,
          taskStageId: taskIntegrationContext.taskStageId,
          ...(taskIntegrationContext.returnTo ? { returnTo: taskIntegrationContext.returnTo } : {}),
        }
      : undefined,
  );

  let created;
  try {
    created = await prisma.generatedDocument.create({
      data: {
        id,
        tenantId,
        companyId: data.companyId ?? null,
        title: data.title,
        content: OAKDOC_GENERATED_CONTENT,
        contentJson: { documentEngine: 'OAKDOC', schemaVersion: 1 } as Prisma.InputJsonValue,
        status: 'DRAFT',
        useLetterhead: data.useLetterhead ?? true,
        metadata: metadata as Prisma.InputJsonValue,
        createdById: userId,
      },
    });
  } catch (error) {
    await storage.delete(storageKey).catch(() => undefined);
    throw error;
  }

  await createAuditLog({
    tenantId,
    userId,
    companyId: created.companyId ?? undefined,
    action: 'DOCUMENT_GENERATED',
    entityType: 'GeneratedDocument',
    entityId: created.id,
    entityName: created.title,
    summary: `Created blank OakDoc document "${created.title}"`,
    changeSource: 'MANUAL',
    metadata: { documentEngine: 'OAKDOC' },
  });
  return { ...created, revision: 0 };
}
