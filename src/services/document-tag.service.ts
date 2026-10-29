/**
 * Document Tag Service
 *
 * Manages custom tags for organizing processing documents.
 * Supports two tag scopes:
 * - Tenant Tags (companyId = NULL): Shared across all companies in tenant
 * - Company Tags (companyId = UUID): Specific to one company
 */

import { prisma } from '@/lib/prisma';
import { createLogger } from '@/lib/logger';
import type { TagColor, Prisma } from '@/generated/prisma';

const log = createLogger('document-tag-service');

// ============================================================================
// Types
// ============================================================================

export type TagScope = 'tenant' | 'company';

export interface TagResult {
  id: string;
  name: string;
  color: TagColor;
  description: string | null;
  usageCount: number;
  lastUsedAt: Date | null;
  createdAt: Date;
  companyId: string | null;  // null = tenant tag, uuid = company tag
  scope: TagScope;           // 'tenant' or 'company' for UI
}

export interface DocumentTagInfo {
  id: string;
  tagId: string;
  name: string;
  color: TagColor;
  addedAt: Date;
  addedById: string;
  scope: TagScope; // 'tenant' or 'company'
}

export interface TenantCompanyParams {
  tenantId: string;
  companyId: string;
  userId: string;
}

export interface TenantOnlyParams {
  tenantId: string;
  userId: string;
}

// Helper to convert database tag to TagResult
function toTagResult(tag: {
  id: string;
  name: string;
  color: TagColor;
  description: string | null;
  usageCount: number;
  lastUsedAt: Date | null;
  createdAt: Date;
  companyId: string | null;
}): TagResult {
  return {
    id: tag.id,
    name: tag.name,
    color: tag.color,
    description: tag.description,
    usageCount: tag.usageCount,
    lastUsedAt: tag.lastUsedAt,
    createdAt: tag.createdAt,
    companyId: tag.companyId,
    scope: tag.companyId ? 'company' : 'tenant',
  };
}

// ============================================================================
// Tag CRUD Operations
// ============================================================================

/**
 * Create a new company-level tag
 */
export async function createTag(
  input: { name: string; color?: TagColor; description?: string },
  params: TenantCompanyParams
): Promise<TagResult> {
  const { name, color = 'GRAY', description } = input;
  const { tenantId, companyId, userId } = params;

  // Check for existing tag with same name (case-insensitive) in company scope
  const existing = await prisma.documentTag.findFirst({
    where: {
      tenantId,
      companyId,
      name: { equals: name, mode: 'insensitive' },
      deletedAt: null,
    },
  });

  if (existing) {
    throw new Error('A tag with this name already exists');
  }

  const tag = await prisma.documentTag.create({
    data: {
      tenantId,
      companyId,
      name: name.trim(),
      color,
      description: description?.trim(),
      createdById: userId,
    },
  });

  log.info(`Created company tag "${name}" for company ${companyId}`);

  return toTagResult(tag);
}

/**
 * Create a new tenant-level (shared) tag
 */
export async function createWorkspaceTag(
  input: { name: string; color?: TagColor; description?: string },
  params: TenantOnlyParams
): Promise<TagResult> {
  const { name, color = 'GRAY', description } = input;
  const { tenantId, userId } = params;

  // Check for existing tenant tag with same name (case-insensitive)
  const existing = await prisma.documentTag.findFirst({
    where: {
      tenantId,
      companyId: null,
      name: { equals: name, mode: 'insensitive' },
      deletedAt: null,
    },
  });

  if (existing) {
    throw new Error('A shared tag with this name already exists');
  }

  const tag = await prisma.documentTag.create({
    data: {
      tenantId,
      companyId: null, // NULL = tenant-level tag
      name: name.trim(),
      color,
      description: description?.trim(),
      createdById: userId,
    },
  });

  log.info(`Created tenant tag "${name}" for tenant ${tenantId}`);

  return toTagResult(tag);
}

/**
 * Update an existing company tag
 */
export async function updateTag(
  tagId: string,
  updates: { name?: string; color?: TagColor; description?: string | null },
  params: { tenantId: string; companyId: string }
): Promise<TagResult> {
  const { tenantId, companyId } = params;

  const tag = await prisma.documentTag.findFirst({
    where: { id: tagId, tenantId, companyId, deletedAt: null },
  });

  if (!tag) {
    throw new Error('Tag not found');
  }

  // Check name uniqueness if updating name
  if (updates.name && updates.name.toLowerCase() !== tag.name.toLowerCase()) {
    const existing = await prisma.documentTag.findFirst({
      where: {
        tenantId,
        companyId,
        name: { equals: updates.name, mode: 'insensitive' },
        deletedAt: null,
        id: { not: tagId },
      },
    });
    if (existing) {
      throw new Error('A tag with this name already exists');
    }
  }

  const updated = await prisma.documentTag.update({
    where: { id: tagId },
    data: {
      name: updates.name?.trim() ?? tag.name,
      color: updates.color ?? tag.color,
      description: updates.description !== undefined ? updates.description?.trim() : tag.description,
    },
  });

  log.info(`Updated tag ${tagId}`);

  return toTagResult(updated);
}

/**
 * Update an existing tenant (shared) tag
 */
export async function updateTenantTag(
  tagId: string,
  updates: { name?: string; color?: TagColor; description?: string | null },
  params: { tenantId: string }
): Promise<TagResult> {
  const { tenantId } = params;

  const tag = await prisma.documentTag.findFirst({
    where: { id: tagId, tenantId, companyId: null, deletedAt: null },
  });

  if (!tag) {
    throw new Error('Shared tag not found');
  }

  // Check name uniqueness if updating name
  if (updates.name && updates.name.toLowerCase() !== tag.name.toLowerCase()) {
    const existing = await prisma.documentTag.findFirst({
      where: {
        tenantId,
        companyId: null,
        name: { equals: updates.name, mode: 'insensitive' },
        deletedAt: null,
        id: { not: tagId },
      },
    });
    if (existing) {
      throw new Error('A shared tag with this name already exists');
    }
  }

  const updated = await prisma.documentTag.update({
    where: { id: tagId },
    data: {
      name: updates.name?.trim() ?? tag.name,
      color: updates.color ?? tag.color,
      description: updates.description !== undefined ? updates.description?.trim() : tag.description,
    },
  });

  log.info(`Updated tenant tag ${tagId}`);

  return toTagResult(updated);
}

/**
 * Delete a company tag (soft delete)
 */
export async function deleteTag(
  tagId: string,
  params: { tenantId: string; companyId: string }
): Promise<void> {
  const { tenantId, companyId } = params;

  const tag = await prisma.documentTag.findFirst({
    where: { id: tagId, tenantId, companyId, deletedAt: null },
  });

  if (!tag) {
    throw new Error('Tag not found');
  }

  await prisma.$transaction([
    // Remove all document associations first
    prisma.processingDocumentTag.deleteMany({
      where: { tagId },
    }),
    // Soft delete the tag
    prisma.documentTag.update({
      where: { id: tagId },
      data: { deletedAt: new Date() },
    }),
  ]);

  log.info(`Deleted tag ${tagId} (${tag.name})`);
}

/**
 * Delete a tenant (shared) tag (soft delete)
 */
export async function deleteWorkspaceTag(
  tagId: string,
  params: { tenantId: string }
): Promise<void> {
  const { tenantId } = params;

  const tag = await prisma.documentTag.findFirst({
    where: { id: tagId, tenantId, companyId: null, deletedAt: null },
  });

  if (!tag) {
    throw new Error('Shared tag not found');
  }

  await prisma.$transaction([
    // Remove all document associations first
    prisma.processingDocumentTag.deleteMany({
      where: { tagId },
    }),
    // Soft delete the tag
    prisma.documentTag.update({
      where: { id: tagId },
      data: { deletedAt: new Date() },
    }),
  ]);

  log.info(`Deleted tenant tag ${tagId} (${tag.name})`);
}

/**
 * Get a single company tag by ID
 */
export async function getTag(
  tagId: string,
  params: { tenantId: string; companyId: string }
): Promise<TagResult | null> {
  const { tenantId, companyId } = params;

  const tag = await prisma.documentTag.findFirst({
    where: { id: tagId, tenantId, companyId, deletedAt: null },
  });

  if (!tag) {
    return null;
  }

  return toTagResult(tag);
}

/**
 * Get a single tenant (shared) tag by ID
 */
export async function getWorkspaceTag(
  tagId: string,
  params: { tenantId: string }
): Promise<TagResult | null> {
  const { tenantId } = params;

  const tag = await prisma.documentTag.findFirst({
    where: { id: tagId, tenantId, companyId: null, deletedAt: null },
  });

  if (!tag) {
    return null;
  }

  return toTagResult(tag);
}

/**
 * Get any tag by ID (tenant or company), for operations that need to work with both
 */
export async function getAnyTag(
  tagId: string,
  params: { tenantId: string; companyId?: string }
): Promise<TagResult | null> {
  const { tenantId, companyId } = params;

  const tag = await prisma.documentTag.findFirst({
    where: {
      id: tagId,
      tenantId,
      deletedAt: null,
      // Must be either a tenant tag OR belong to the specified company
      OR: [
        { companyId: null },
        ...(companyId ? [{ companyId: companyId }] : []),
      ],
    },
  });

  if (!tag) {
    return null;
  }

  return toTagResult(tag);
}

// ============================================================================
// Tag Listing & Search
// ============================================================================

/**
 * Get all tenant (shared) tags
 */
export async function getWorkspaceTags(tenantId: string): Promise<TagResult[]> {
  const tags = await prisma.documentTag.findMany({
    where: { tenantId, companyId: null, deletedAt: null },
    orderBy: { name: 'asc' },
  });

  return tags.map(toTagResult);
}

/**
 * Get all company-specific tags (excludes tenant tags)
 */
export async function getCompanyTags(
  companyId: string,
  tenantId: string
): Promise<TagResult[]> {
  const tags = await prisma.documentTag.findMany({
    where: { companyId, tenantId, deletedAt: null },
    orderBy: { name: 'asc' },
  });

  return tags.map(toTagResult);
}

/**
 * Get all available tags for a context (tenant tags + company tags if companyId provided)
 * This is the main function for UI that needs to show all applicable tags
 */
export async function getAvailableTags(
  tenantId: string,
  companyId?: string
): Promise<TagResult[]> {
  const tags = await prisma.documentTag.findMany({
    where: {
      tenantId,
      deletedAt: null,
      OR: [
        { companyId: null }, // Tenant tags (always included)
        ...(companyId ? [{ companyId: companyId }] : []), // Company tags (if specified)
      ],
    },
    orderBy: [
      { companyId: 'asc' }, // Tenant tags (null) first
      { name: 'asc' },
    ],
  });

  return tags.map(toTagResult);
}

/**
 * Get recent tags for autocomplete (from both scopes if companyId provided)
 */
export async function getRecentTags(
  tenantId: string,
  companyId?: string,
  limit: number = 5
): Promise<TagResult[]> {
  const tags = await prisma.documentTag.findMany({
    where: {
      tenantId,
      deletedAt: null,
      lastUsedAt: { not: null },
      OR: [
        { companyId: null },
        ...(companyId ? [{ companyId: companyId }] : []),
      ],
    },
    orderBy: { lastUsedAt: 'desc' },
    take: limit,
  });

  return tags.map(toTagResult);
}

/**
 * Search tags by name (across both scopes if companyId provided)
 */
export async function searchTags(
  tenantId: string,
  companyId?: string,
  query?: string,
  limit: number = 20
): Promise<TagResult[]> {
  const where: Prisma.DocumentTagWhereInput = {
    tenantId,
    deletedAt: null,
    OR: [
      { companyId: null },
      ...(companyId ? [{ companyId: companyId }] : []),
    ],
  };

  if (query && query.trim()) {
    where.name = { contains: query.trim(), mode: 'insensitive' };
  }

  const tags = await prisma.documentTag.findMany({
    where,
    orderBy: [{ usageCount: 'desc' }, { name: 'asc' }],
    take: limit,
  });

  return tags.map(toTagResult);
}

// ============================================================================
// Document Tagging Operations
// ============================================================================

/**
 * Add a tag to a document (supports both tenant and company tags)
 */
export async function addTagToDocument(
  processingDocumentId: string,
  tagId: string,
  params: TenantCompanyParams
): Promise<DocumentTagInfo> {
  const { tenantId, companyId, userId } = params;

  // Verify tag exists and is accessible (tenant tag OR belongs to company)
  const tag = await prisma.documentTag.findFirst({
    where: {
      id: tagId,
      tenantId,
      deletedAt: null,
      OR: [
        { companyId: null }, // Tenant tag (accessible to all companies)
        { companyId: companyId }, // Company-specific tag
      ],
    },
  });

  if (!tag) {
    throw new Error('Tag not found');
  }

  // Verify document exists
  const doc = await prisma.processingDocument.findUnique({
    where: { id: processingDocumentId },
    include: { document: { select: { tenantId: true, companyId: true } } },
  });

  if (!doc) {
    throw new Error('Document not found');
  }

  // Verify document belongs to same tenant/company
  if (doc.document.tenantId !== tenantId || doc.document.companyId !== companyId) {
    throw new Error('Document does not belong to this company');
  }

  // Check if already tagged
  const existing = await prisma.processingDocumentTag.findUnique({
    where: { processingDocumentId_tagId: { processingDocumentId, tagId } },
  });

  if (existing) {
    throw new Error('Document already has this tag');
  }

  // Add tag and update usage stats in transaction
  const [docTag] = await prisma.$transaction([
    prisma.processingDocumentTag.create({
      data: {
        processingDocumentId,
        tagId,
        addedById: userId,
      },
    }),
    prisma.documentTag.update({
      where: { id: tagId },
      data: {
        usageCount: { increment: 1 },
        lastUsedAt: new Date(),
      },
    }),
  ]);

  log.info(`Added tag "${tag.name}" to document ${processingDocumentId}`);

  return {
    id: docTag.id,
    tagId: tag.id,
    name: tag.name,
    color: tag.color,
    addedAt: docTag.addedAt,
    addedById: docTag.addedById,
    scope: tag.companyId ? 'company' : 'tenant' as TagScope,
  };
}

/**
 * Remove a tag from a document (supports both tenant and company tags)
 */
export async function removeTagFromDocument(
  processingDocumentId: string,
  tagId: string,
  params: { tenantId: string; companyId: string }
): Promise<void> {
  const { tenantId, companyId } = params;

  // Verify tag exists (tenant or company tag - even if deleted, we should still be able to remove it)
  const tag = await prisma.documentTag.findFirst({
    where: {
      id: tagId,
      tenantId,
      OR: [
        { companyId: null },
        { companyId: companyId },
      ],
    },
  });

  if (!tag) {
    throw new Error('Tag not found');
  }

  const docTag = await prisma.processingDocumentTag.findUnique({
    where: { processingDocumentId_tagId: { processingDocumentId, tagId } },
  });

  if (!docTag) {
    throw new Error('Document does not have this tag');
  }

  await prisma.processingDocumentTag.delete({
    where: { id: docTag.id },
  });

  log.info(`Removed tag "${tag.name}" from document ${processingDocumentId}`);
}

/**
 * Get all tags for a document (includes scope info for UI)
 */
export async function getDocumentTags(
  processingDocumentId: string
): Promise<DocumentTagInfo[]> {
  const docTags = await prisma.processingDocumentTag.findMany({
    where: { processingDocumentId },
    include: { tag: true },
    orderBy: { addedAt: 'desc' },
  });

  return docTags
    .filter((dt) => dt.tag.deletedAt === null) // Exclude deleted tags
    .map((dt) => ({
      id: dt.id,
      tagId: dt.tag.id,
      name: dt.tag.name,
      color: dt.tag.color,
      addedAt: dt.addedAt,
      addedById: dt.addedById,
      scope: dt.tag.companyId ? 'company' : 'tenant' as TagScope,
    }));
}

/**
 * Get or create a tag (for quick tagging with new tag names)
 * First checks for matching tenant tag, then company tag, then creates company tag
 */
export async function getOrCreateTag(
  name: string,
  color: TagColor = 'GRAY',
  params: TenantCompanyParams
): Promise<TagResult> {
  const { tenantId, companyId, userId } = params;

  // Try to find existing tenant or company tag (case-insensitive)
  const existing = await prisma.documentTag.findFirst({
    where: {
      tenantId,
      name: { equals: name.trim(), mode: 'insensitive' },
      deletedAt: null,
      OR: [
        { companyId: null }, // Tenant tag
        { companyId: companyId }, // Company tag
      ],
    },
    orderBy: { companyId: 'asc' }, // Prefer tenant tags (null comes first)
  });

  if (existing) {
    return toTagResult(existing);
  }

  // Create new company tag (not tenant tag - that requires admin permission)
  return createTag({ name, color }, { tenantId, companyId, userId });
}

/**
 * Create a tag and immediately add it to a document
 */
export async function createAndAddTagToDocument(
  processingDocumentId: string,
  input: { name: string; color?: TagColor },
  params: TenantCompanyParams
): Promise<DocumentTagInfo> {
  const { tenantId, companyId, userId } = params;

  // Get or create the tag
  const tag = await getOrCreateTag(input.name, input.color, params);

  // Add to document
  return addTagToDocument(processingDocumentId, tag.id, { tenantId, companyId, userId });
}

// ============================================================================
// Bulk Operations
// ============================================================================

/**
 * Add a tag to multiple documents (supports both tenant and company tags)
 */
export async function bulkAddTagToDocuments(
  processingDocumentIds: string[],
  tagId: string,
  params: TenantCompanyParams
): Promise<{ succeeded: number; failed: number; errors: string[] }> {
  const { tenantId, companyId, userId } = params;
  const errors: string[] = [];
  let succeeded = 0;
  let failed = 0;

  // Verify tag exists (tenant or company)
  const tag = await prisma.documentTag.findFirst({
    where: {
      id: tagId,
      tenantId,
      deletedAt: null,
      OR: [
        { companyId: null },
        { companyId: companyId },
      ],
    },
  });

  if (!tag) {
    throw new Error('Tag not found');
  }

  for (const docId of processingDocumentIds) {
    try {
      await addTagToDocument(docId, tagId, { tenantId, companyId, userId });
      succeeded++;
    } catch (error) {
      failed++;
      if (error instanceof Error && !error.message.includes('already has this tag')) {
        errors.push(`${docId}: ${error.message}`);
      }
    }
  }

  log.info(`Bulk added tag "${tag.name}" to ${succeeded} documents (${failed} failed)`);

  return { succeeded, failed, errors };
}

/**
 * Remove a tag from multiple documents (supports both tenant and company tags)
 */
export async function bulkRemoveTagFromDocuments(
  processingDocumentIds: string[],
  tagId: string,
  params: { tenantId: string; companyId: string }
): Promise<{ succeeded: number; failed: number }> {
  const { tenantId, companyId } = params;
  let succeeded = 0;
  let failed = 0;

  for (const docId of processingDocumentIds) {
    try {
      await removeTagFromDocument(docId, tagId, { tenantId, companyId });
      succeeded++;
    } catch {
      failed++;
    }
  }

  log.info(`Bulk removed tag from ${succeeded} documents (${failed} failed)`);

  return { succeeded, failed };
}
