import { Prisma } from '@/generated/prisma';
import { prisma } from '@/lib/prisma';
import { createAuditLog } from '@/lib/audit';
import { sharePointFolderRefSchema } from '@/lib/sharepoint/folder-reference';
import { getSharePointFilingSettings } from './sharepoint-filing-settings.service';
import { isImmediateChildOfRoot, verifyFolder } from './sharepoint-folder.service';
import { SharePointServiceError } from './sharepoint.service';

export interface CompanySharePointFolderDto {
  id: string;
  companyId: string;
  connectorId: string;
  driveId: string;
  folderItemId: string;
  folderName: string;
  folderWebUrl: string;
  lastVerifiedAt: string | null;
  isStale: boolean;
}

function mapDto(value: {
  id: string;
  companyId: string;
  connectorId: string;
  driveId: string;
  folderItemId: string;
  folderName: string;
  folderWebUrl: string;
  lastVerifiedAt: Date | null;
}): CompanySharePointFolderDto {
  return {
    ...value,
    lastVerifiedAt: value.lastVerifiedAt?.toISOString() ?? null,
    isStale: !value.lastVerifiedAt,
  };
}

async function getCompany(companyId: string, tenantId: string) {
  const company = await prisma.company.findFirst({ where: { id: companyId, tenantId, deletedAt: null }, select: { id: true, name: true, tenantId: true } });
  if (!company) throw new SharePointServiceError({ code: 'COMPANY_NOT_FOUND', category: 'AUTHORIZATION', statusCode: 404, message: 'Company not found' });
  return company;
}

export async function getCompanySharePointFolder(input: { tenantId: string; companyId: string }): Promise<CompanySharePointFolderDto | null> {
  await getCompany(input.companyId, input.tenantId);
  const mapping = await prisma.companySharePointFolder.findFirst({ where: { companyId: input.companyId, tenantId: input.tenantId } });
  return mapping ? mapDto(mapping) : null;
}

export async function setCompanySharePointFolder(input: {
  tenantId: string;
  userId: string;
  companyId: string;
  connectorId: string;
  folder: unknown;
}): Promise<CompanySharePointFolderDto> {
  const company = await getCompany(input.companyId, input.tenantId);
  const folder = sharePointFolderRefSchema.parse(input.folder);
  const settings = await getSharePointFilingSettings({ workspaceId: input.tenantId, connectorId: input.connectorId });
  if (!settings.clientDocumentsRoot) throw new SharePointServiceError({ code: 'ROOT_NOT_CONFIGURED', category: 'CONFIGURATION', statusCode: 400, message: 'Configure the Client Documents root before mapping a company' });
  if (folder.driveId !== settings.clientDocumentsRoot.driveId) throw new SharePointServiceError({ code: 'DRIVE_MISMATCH', category: 'VALIDATION', statusCode: 400, message: 'Company folder must use the configured SharePoint drive' });

  const canonical = await verifyFolder({ workspaceId: input.tenantId, connectorId: input.connectorId, driveId: folder.driveId, itemId: folder.itemId });
  const immediate = await isImmediateChildOfRoot({ workspaceId: input.tenantId, connectorId: input.connectorId, driveId: canonical.driveId, rootItemId: settings.clientDocumentsRoot.itemId, itemId: canonical.itemId });
  if (!immediate) throw new SharePointServiceError({ code: 'OUTSIDE_ALLOWED_ROOT', category: 'VALIDATION', statusCode: 400, message: 'Company folder must be an immediate child of Client Documents' });

  try {
    const saved = await prisma.$transaction(async (tx) => {
      const previous = await tx.companySharePointFolder.findUnique({ where: { companyId: company.id } });
      const mapping = await tx.companySharePointFolder.upsert({
        where: { companyId: company.id },
        create: {
          tenantId: input.tenantId,
          companyId: company.id,
          connectorId: input.connectorId,
          driveId: canonical.driveId,
          folderItemId: canonical.itemId,
          folderName: canonical.name,
          folderWebUrl: canonical.webUrl,
          lastVerifiedAt: new Date(),
          verifiedById: input.userId,
        },
        update: {
          tenantId: input.tenantId,
          connectorId: input.connectorId,
          driveId: canonical.driveId,
          folderItemId: canonical.itemId,
          folderName: canonical.name,
          folderWebUrl: canonical.webUrl,
          lastVerifiedAt: new Date(),
          verifiedById: input.userId,
        },
      });
      await createAuditLog({
        tenantId: input.tenantId,
        userId: input.userId,
        companyId: company.id,
        action: previous ? 'UPDATE' : 'CREATE',
        entityType: 'CompanySharePointFolder',
        entityId: mapping.id,
        entityName: company.name,
        summary: `${previous ? 'Updated' : 'Created'} SharePoint folder mapping for "${company.name}"`,
        changeSource: 'MANUAL',
        metadata: { connectorId: input.connectorId, oldFolderItemId: previous?.folderItemId ?? null, folderItemId: canonical.itemId, driveId: canonical.driveId },
      }, tx);
      return mapping;
    });
    return mapDto(saved);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new SharePointServiceError({ code: 'FOLDER_ALREADY_MAPPED', category: 'VALIDATION', statusCode: 409, message: 'This SharePoint folder is already mapped to another company' });
    }
    throw error;
  }
}

export async function removeCompanySharePointFolder(input: { tenantId: string; userId: string; companyId: string }): Promise<void> {
  const company = await getCompany(input.companyId, input.tenantId);
  await prisma.$transaction(async (tx) => {
    const existing = await tx.companySharePointFolder.findUnique({ where: { companyId: company.id } });
    if (!existing) return;
    await tx.companySharePointFolder.delete({ where: { companyId: company.id } });
    await createAuditLog({
      tenantId: input.tenantId,
      userId: input.userId,
      companyId: company.id,
      action: 'DELETE',
      entityType: 'CompanySharePointFolder',
      entityId: existing.id,
      entityName: company.name,
      summary: `Removed SharePoint folder mapping for "${company.name}"`,
      changeSource: 'MANUAL',
      metadata: { connectorId: existing.connectorId, driveId: existing.driveId, folderItemId: existing.folderItemId },
    }, tx);
  });
}

export async function verifyCompanySharePointFolder(input: { tenantId: string; userId: string; companyId: string }): Promise<CompanySharePointFolderDto> {
  const company = await getCompany(input.companyId, input.tenantId);
  const existing = await prisma.companySharePointFolder.findFirst({ where: { companyId: company.id, tenantId: input.tenantId } });
  if (!existing) throw new SharePointServiceError({ code: 'MAPPING_NOT_FOUND', category: 'VALIDATION', statusCode: 404, message: 'Company has no SharePoint folder mapping' });
  try {
    const canonical = await verifyFolder({ workspaceId: input.tenantId, connectorId: existing.connectorId, driveId: existing.driveId, itemId: existing.folderItemId });
    const settings = await getSharePointFilingSettings({ workspaceId: input.tenantId, connectorId: existing.connectorId });
    if (!settings.clientDocumentsRoot) throw new SharePointServiceError({ code: 'ROOT_NOT_CONFIGURED', category: 'CONFIGURATION', statusCode: 400, message: 'Configure the Client Documents root before verifying a company mapping' });
    if (!(await isImmediateChildOfRoot({ workspaceId: input.tenantId, connectorId: existing.connectorId, driveId: canonical.driveId, rootItemId: settings.clientDocumentsRoot.itemId, itemId: canonical.itemId }))) {
      throw new SharePointServiceError({ code: 'OUTSIDE_ALLOWED_ROOT', category: 'VALIDATION', statusCode: 400, message: 'Company folder is no longer an immediate child of Client Documents' });
    }
    const updated = await prisma.companySharePointFolder.update({ where: { id: existing.id }, data: { driveId: canonical.driveId, folderItemId: canonical.itemId, folderName: canonical.name, folderWebUrl: canonical.webUrl, lastVerifiedAt: new Date(), verifiedById: input.userId } });
    await createAuditLog({ tenantId: input.tenantId, userId: input.userId, companyId: company.id, action: 'UPDATE', entityType: 'CompanySharePointFolder', entityId: existing.id, entityName: company.name, summary: `Verified SharePoint folder mapping for "${company.name}"`, changeSource: 'MANUAL', metadata: { connectorId: existing.connectorId, folderItemId: canonical.itemId, driveId: canonical.driveId } });
    return mapDto(updated);
  } catch (error) {
    if (error instanceof SharePointServiceError && error.code === 'FOLDER_NOT_FOUND') {
      await prisma.companySharePointFolder.update({ where: { id: existing.id }, data: { lastVerifiedAt: null } });
    }
    throw error;
  }
}
