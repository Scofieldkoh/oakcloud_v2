import { randomUUID } from 'node:crypto';
import { Prisma } from '@/generated/prisma';
import { createAuditLog } from '@/lib/audit';
import { parseSharePointSettings } from '@/lib/validations/connector';
import { prisma } from '@/lib/prisma';
import { snapshotFilingRoute } from './routing';

export async function ensureFilingJobsForCompletedEnvelope(tx: Prisma.TransactionClient, envelopeId: string, completedAt: Date, connectorId?: string): Promise<number> {
  if (process.env.SHAREPOINT_SIGNED_FILING_ENABLED?.toLowerCase() !== 'true') return 0;
  const envelope = await tx.esigningEnvelope.findUnique({
    where: { id: envelopeId },
    select: {
      id: true, tenantId: true, companyId: true, title: true, certificateId: true,
      company: { select: { id: true, name: true } },
      documents: { orderBy: { sortOrder: 'asc' }, select: { id: true, fileName: true, signedHash: true, fileSize: true, generatedDocument: { select: { id: true, templateId: true, templateVersion: true, title: true, sharePointRelativeFolderPathSnapshot: true, template: { select: { version: true, sharePointRelativeFolderPath: true } } } } } },
    },
  });
  if (!envelope || envelope.tenantId === null) return 0;
  const connector = await tx.connector.findFirst({
    where: {
      ...(connectorId ? { id: connectorId } : {}),
      workspaceId: envelope.tenantId,
      provider: 'SHAREPOINT',
      isEnabled: true,
      deletedAt: null,
    },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
  });
  if (!connector) return 0;
  const settings = parseSharePointSettings(connector.settings);
  const filing = settings.signedDocumentFiling;
  if (!filing.enabled || !filing.enabledAt || !filing.clientDocumentsRoot || !filing.orphanDocumentsFolder) return 0;
  const enabledAt = new Date(filing.enabledAt);
  if (Number.isNaN(enabledAt.getTime()) || completedAt < enabledAt) return 0;

  const mapping = envelope.companyId ? await tx.companySharePointFolder.findUnique({ where: { companyId: envelope.companyId } }) : null;
  let createdCount = 0;
  for (const document of envelope.documents) {
    const generated = document.generatedDocument;
    const legacyRoute = generated?.sharePointRelativeFolderPathSnapshot === null ? generated?.template?.sharePointRelativeFolderPath : undefined;
    const relativePath = generated?.sharePointRelativeFolderPathSnapshot ?? legacyRoute ?? null;
    const route = snapshotFilingRoute({ connectorId: connector.id, configVersion: filing.configVersion, companyId: envelope.companyId, companyName: envelope.company?.name ?? null, mapping: mapping ? { connectorId: mapping.connectorId, driveId: mapping.driveId, folderItemId: mapping.folderItemId } : null, templateId: generated?.templateId ?? null, templateVersion: generated?.templateVersion ?? generated?.template?.version ?? null, relativePath, orphanFolder: filing.orphanDocumentsFolder });
    // Completion processing and the repair pass can enqueue the same document
    // concurrently. Use PostgreSQL's conflict target instead of catching a
    // unique-constraint exception: a caught constraint error still aborts the
    // surrounding transaction and prevents later documents/jobs from being
    // processed.
    const now = new Date();
    const createdRows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      INSERT INTO "esigning_sharepoint_filings" (
        "id",
        "tenant_id",
        "envelope_id",
        "envelope_document_id",
        "company_id",
        "connector_id",
        "destination_kind",
        "routing_reason",
        "template_id",
        "template_version",
        "config_version",
        "company_name_snapshot",
        "document_title_snapshot",
        "intended_company_drive_id",
        "intended_company_folder_id",
        "intended_relative_path",
        "orphan_drive_id",
        "orphan_folder_item_id",
        "source_signed_hash",
        "source_size",
        "updated_at"
      )
      VALUES (
        ${randomUUID()},
        ${envelope.tenantId},
        ${envelope.id},
        ${document.id},
        ${envelope.companyId},
        ${route.connectorId},
        ${route.destinationKind}::"EsigningSharePointDestinationKind",
        ${route.routingReason}::"EsigningSharePointRoutingReason",
        ${route.templateId},
        ${route.templateVersion},
        ${route.configVersion},
        ${route.companyNameSnapshot},
        ${generated?.title || document.fileName || envelope.title},
        ${route.intendedCompanyDriveId},
        ${route.intendedCompanyFolderId},
        ${route.intendedRelativePath},
        ${route.orphanDriveId},
        ${route.orphanFolderItemId},
        ${document.signedHash},
        ${null},
        ${now}
      )
      ON CONFLICT ("envelope_document_id") DO NOTHING
      RETURNING "id"
    `);
    const created = createdRows[0];
    if (!created) continue;
    createdCount += 1;
    await createAuditLog({ tenantId: envelope.tenantId, companyId: envelope.companyId ?? undefined, action: 'CREATE', entityType: 'EsigningSharePointFiling', entityId: created.id, entityName: generated?.title || document.fileName, summary: `Queued ${route.destinationKind.toLowerCase()} signed-document SharePoint filing`, changeSource: 'SYSTEM', metadata: { envelopeId: envelope.id, envelopeDocumentId: document.id, routingReason: route.routingReason, configVersion: route.configVersion, legacyRouteFallback: Boolean(legacyRoute) } }, tx);
  }
  return createdCount;
}

export async function repairMissingFilingJobsForWorkspace(workspaceId: string, enabledAt: Date, limit = 100, connectorId?: string): Promise<number> {
  const envelopes = await prisma.esigningEnvelope.findMany({
    where: { tenantId: workspaceId, status: 'COMPLETED', completedAt: { gte: enabledAt } },
    orderBy: { completedAt: 'asc' },
    take: Math.max(1, Math.min(limit, 100)),
    select: { id: true, completedAt: true },
  });
  let repaired = 0;
  for (const envelope of envelopes) {
    if (!envelope.completedAt) continue;
    repaired += await prisma.$transaction((tx) => ensureFilingJobsForCompletedEnvelope(tx, envelope.id, envelope.completedAt!, connectorId));
  }
  return repaired;
}

export async function markFilingJobsForTerminalSourceFailure(
  tx: Prisma.TransactionClient,
  envelopeId: string,
  errorCode = 'SOURCE_GENERATION_FAILED',
  tenantId?: string,
): Promise<number> {
  const result = await tx.esigningSharePointFiling.updateMany({
    where: { envelopeId, status: { in: ['PENDING', 'FAILED_RETRYABLE'] } },
    data: { status: 'FAILED_PERMANENT', availableAt: new Date(), lastErrorCode: errorCode, lastError: 'Signed PDF generation failed; automatic SharePoint filing is not possible' },
  });
  if (result.count > 0) {
    await createAuditLog({ tenantId, action: 'UPDATE', entityType: 'EsigningSharePointFiling', entityId: envelopeId, summary: 'Marked signed-document SharePoint filing permanently failed after PDF generation failure', changeSource: 'SYSTEM', metadata: { envelopeId, errorCode, count: result.count } }, tx);
  }
  return result.count;
}
