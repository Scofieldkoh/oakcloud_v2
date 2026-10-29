import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@/generated/prisma';
import { prisma } from '@/lib/prisma';
import { createAuditLog } from '@/lib/audit';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import {
  mergeGeneratedOakDocMetadata,
  mergeOakDocReviewDraftMetadata,
  OAKDOC_GENERATED_CONTENT,
  readGeneratedOakDocAssetMetadata,
  readOakDocReviewDraftMetadata,
  type GeneratedOakDocAssetMetadata,
  type OakDocEditedContentMetadata,
} from '@/lib/document-editor/document-engine';
import { claimGeneratedDocumentRevision } from '@/lib/document-editor/generated-document-revision';
import { OAKDOC_MIME_TYPE } from '@/lib/document-editor/oakdoc-template';
import { storage, StorageKeys } from '@/lib/storage';
import { createLogger } from '@/lib/logger';
import { inspectOakDocPackage } from '@/lib/document-editor/oakdoc-package-policy';
import type { TenantAwareParams } from '@/lib/types';
import {
  loadMasterCatalogueForTemplateIds,
  revisionConflict,
} from './lifecycle.service';
import { mapBatchToDto } from './mapper';
import { batchInclude } from './types';
import type { DocumentGenerationBatchDto } from '@/types/document-generation-batch';

const log = createLogger('oakdoc-batch-draft');

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function saveOakDocBatchDraft(
  input: {
    generatedDocumentId: string;
    expectedBatchRevision: number;
    previewFingerprint: string;
    bytes: Uint8Array;
  },
  params: TenantAwareParams,
): Promise<DocumentGenerationBatchDto> {
  if (!/^[a-f0-9]{64}$/i.test(input.previewFingerprint)) {
    throw new ValidationError('OakDoc preview fingerprint is invalid');
  }
  inspectOakDocPackage(input.bytes, 'draft');

  const existing = await prisma.generatedDocument.findFirst({
    where: {
      id: input.generatedDocumentId,
      tenantId: params.tenantId,
      deletedAt: null,
    },
    include: {
      batchItem: true,
    },
  });
  if (!existing) throw new NotFoundError('Generated document not found');
  if (existing.status !== 'DRAFT') {
    throw new ValidationError('Only draft OakDoc documents can be edited');
  }
  const item = existing.batchItem;
  if (!item) {
    throw new ValidationError('This OakDoc draft is not attached to a generation batch');
  }
  if (item.previewFingerprint !== input.previewFingerprint) {
    throw new ConflictError('The OakDoc preview changed before this edit was saved', {
      stale: true,
    });
  }

  const currentAsset = readGeneratedOakDocAssetMetadata(existing.metadata);
  const currentReview = readOakDocReviewDraftMetadata(existing.metadata);
  if (!currentAsset || !currentReview) {
    throw new ValidationError('Render the OakDoc preview before editing it');
  }
  if (currentReview.previewFingerprint !== input.previewFingerprint) {
    throw new ConflictError('The OakDoc draft no longer matches the current preview', {
      stale: true,
    });
  }

  const digest = sha256(input.bytes);
  const savedAt = new Date().toISOString();
  const storageKey = StorageKeys.oakDocGeneratedAsset(
    params.tenantId,
    existing.id,
    randomUUID(),
  );

  await storage.upload(storageKey, Buffer.from(input.bytes), {
    contentType: OAKDOC_MIME_TYPE,
    metadata: {
      tenantId: params.tenantId,
      generatedDocumentId: existing.id,
      templateId: currentAsset.templateId,
      templateVersion: String(currentAsset.templateVersion),
      templateSha256: currentAsset.templateSha256,
      sha256: digest,
      generatedBy: params.userId,
      previewFingerprint: input.previewFingerprint,
      edited: 'true',
    },
  });

  let batch;
  try {
    batch = await prisma.$transaction(async (tx) => {
      const claimed = await tx.documentGenerationBatch.updateMany({
        where: {
          id: item.batchId,
          tenantId: params.tenantId,
          deletedAt: null,
          revision: input.expectedBatchRevision,
        },
        data: { revision: { increment: 1 } },
      });
      if (claimed.count !== 1) {
        throw await revisionConflict(item.batchId, params.tenantId);
      }

      await claimGeneratedDocumentRevision(tx, {
        id: existing.id,
        tenantId: params.tenantId,
        expectedRevision: existing.revision,
        allowedStatuses: ['DRAFT'],
      });

      const nextAsset: GeneratedOakDocAssetMetadata = {
        ...currentAsset,
        storageKey,
        fileSize: input.bytes.byteLength,
        sha256: digest,
        generatedAt: savedAt,
      };
      const metadataRecord = (
        existing.metadata
        && typeof existing.metadata === 'object'
        && !Array.isArray(existing.metadata)
      )
        ? existing.metadata as Record<string, unknown>
        : {};
      const selectedPartiesValue = metadataRecord.selectedParties;
      const selectedParties = (
        selectedPartiesValue
        && typeof selectedPartiesValue === 'object'
        && !Array.isArray(selectedPartiesValue)
      )
        ? selectedPartiesValue as Record<string, unknown>
        : {};
      const generatedMetadata = mergeGeneratedOakDocMetadata(
        existing.metadata,
        nextAsset,
        selectedParties,
      );
      const metadata = mergeOakDocReviewDraftMetadata(generatedMetadata, {
        schemaVersion: 1,
        previewFingerprint: input.previewFingerprint,
        savedAt,
        edited: true,
      });
      const editedContentJson: OakDocEditedContentMetadata = {
        documentEngine: 'OAKDOC',
        schemaVersion: 1,
        oakDocDraftSha256: digest,
        previewFingerprint: input.previewFingerprint,
        savedAt,
      };

      await tx.generatedDocument.update({
        where: { id: existing.id },
        data: {
          content: OAKDOC_GENERATED_CONTENT,
          contentJson: {
            documentEngine: 'OAKDOC',
            schemaVersion: 1,
          } as Prisma.InputJsonValue,
          metadata: metadata as Prisma.InputJsonValue,
        },
      });
      await tx.documentGenerationBatchItem.update({
        where: { id: item.id },
        data: {
          editedContent: OAKDOC_GENERATED_CONTENT,
          editedContentJson: editedContentJson as unknown as Prisma.InputJsonValue,
          reviewedFingerprint: null,
          status: 'PREVIEWED',
          validationDiagnostics: Prisma.DbNull,
        },
      });

      return tx.documentGenerationBatch.findFirstOrThrow({
        where: { id: item.batchId },
        include: batchInclude,
      });
    });
  } catch (error) {
    // Pre-commit failure: the new upload is unreferenced and safe to remove.
    await storage.delete(storageKey).catch(() => undefined);
    throw error;
  }

  // Post-commit work never deletes the committed asset or fails the save.
  if (
    currentAsset.storageKey !== storageKey
    && currentAsset.storageKey.startsWith(
      `${params.tenantId}/generated-documents/${existing.id}/oakdoc/`,
    )
  ) {
    try {
      await storage.delete(currentAsset.storageKey);
    } catch (error) {
      log.warn('Failed to delete superseded OakDoc batch draft asset', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  try {
    await createAuditLog({
      tenantId: params.tenantId,
      userId: params.userId,
      companyId: existing.companyId ?? undefined,
      action: 'UPDATE',
      entityType: 'GeneratedDocument',
      entityId: existing.id,
      entityName: existing.title,
      summary: `Saved edited OakDoc draft "${existing.title}"`,
      changeSource: 'MANUAL',
      metadata: {
        documentEngine: 'OAKDOC',
        previewFingerprint: input.previewFingerprint,
        sha256: digest,
      },
    });
  } catch (error) {
    log.warn('Failed to audit OakDoc batch draft save', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const catalogue = await loadMasterCatalogueForTemplateIds(
    batch.items.map((entry) => entry.templateId),
    params.tenantId,
  );
  return mapBatchToDto(batch, catalogue);
}
