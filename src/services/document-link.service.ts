/**
 * Document Link Service
 *
 * Manages links between related processing documents (e.g., PO -> Invoice chains).
 * Supports bi-directional linking with typed relationships.
 */

import { prisma } from '@/lib/prisma';
import { createLogger } from '@/lib/logger';
import type { DocumentLinkType, Prisma } from '@/generated/prisma';

const log = createLogger('document-link-service');

// ============================================================================
// Types
// ============================================================================

export interface DocumentLinkInput {
  sourceDocumentId: string;
  targetDocumentId: string;
  linkType: DocumentLinkType;
  notes?: string;
  linkedById: string;
}

export interface DocumentLinkResult {
  id: string;
  sourceDocumentId: string;
  targetDocumentId: string;
  linkType: DocumentLinkType;
  notes: string | null;
  linkedById: string;
  linkedAt: Date;
}

export interface LinkedDocumentInfo {
  id: string;
  documentId: string;
  fileName: string;
  pipelineStatus: string;
  documentCategory: string | null;
  vendorName: string | null;
  documentNumber: string | null;
  totalAmount: string | null;
  currency: string | null;
  revisionStatus: string | null;
  linkId: string;
  linkType: DocumentLinkType;
  linkDirection: 'source' | 'target';
  notes: string | null;
  linkedAt: Date;
}

// Link type display labels
export const linkTypeLabels: Record<DocumentLinkType, string> = {
  PO_TO_DN: 'PO â†’ Delivery Note',
  PO_TO_INVOICE: 'PO â†’ Invoice',
  DN_TO_INVOICE: 'Delivery Note â†’ Invoice',
  INVOICE_TO_CN: 'Invoice â†’ Credit Note',
  INVOICE_TO_DN_ADJ: 'Invoice â†’ Debit Note',
  QUOTE_TO_PO: 'Quote â†’ PO',
  CONTRACT_TO_PO: 'Contract â†’ PO',
  RELATED: 'Related Document',
};

// Reverse link type labels (when viewing from target's perspective)
export const reverseLinkTypeLabels: Record<DocumentLinkType, string> = {
  PO_TO_DN: 'Delivery Note â† PO',
  PO_TO_INVOICE: 'Invoice â† PO',
  DN_TO_INVOICE: 'Invoice â† Delivery Note',
  INVOICE_TO_CN: 'Credit Note â† Invoice',
  INVOICE_TO_DN_ADJ: 'Debit Note â† Invoice',
  QUOTE_TO_PO: 'PO â† Quote',
  CONTRACT_TO_PO: 'PO â† Contract',
  RELATED: 'Related Document',
};

// ============================================================================
// Create Link
// ============================================================================

/**
 * Create a link between two processing documents
 */
export async function createDocumentLink(
  input: DocumentLinkInput
): Promise<DocumentLinkResult> {
  const { sourceDocumentId, targetDocumentId, linkType, notes, linkedById } = input;

  // Validate that both documents exist and are in the same tenant
  const [sourceDoc, targetDoc] = await Promise.all([
    prisma.processingDocument.findUnique({
      where: { id: sourceDocumentId },
      include: { document: { select: { tenantId: true, companyId: true } } },
    }),
    prisma.processingDocument.findUnique({
      where: { id: targetDocumentId },
      include: { document: { select: { tenantId: true, companyId: true } } },
    }),
  ]);

  if (!sourceDoc) {
    throw new Error('Source document not found');
  }
  if (!targetDoc) {
    throw new Error('Target document not found');
  }

  // Ensure same tenant
  if (sourceDoc.document.tenantId !== targetDoc.document.tenantId) {
    throw new Error('Cannot link documents from different tenants');
  }

  // Prevent self-linking
  if (sourceDocumentId === targetDocumentId) {
    throw new Error('Cannot link a document to itself');
  }

  // Check for existing link (in either direction with same type)
  const existingLink = await prisma.documentLink.findFirst({
    where: {
      OR: [
        { sourceDocumentId, targetDocumentId, linkType },
        { sourceDocumentId: targetDocumentId, targetDocumentId: sourceDocumentId, linkType },
      ],
    },
  });

  if (existingLink) {
    throw new Error('A link of this type already exists between these documents');
  }

  const link = await prisma.documentLink.create({
    data: {
      sourceDocumentId,
      targetDocumentId,
      linkType,
      notes: notes || null,
      linkedById,
    },
  });

  log.info(`Created document link: ${sourceDocumentId} -> ${targetDocumentId} (${linkType})`);

  return {
    id: link.id,
    sourceDocumentId: link.sourceDocumentId,
    targetDocumentId: link.targetDocumentId,
    linkType: link.linkType,
    notes: link.notes,
    linkedById: link.linkedById,
    linkedAt: link.linkedAt,
  };
}

// ============================================================================
// Get Links
// ============================================================================

/**
 * Get all linked documents for a processing document
 * Returns links where the document is either source or target
 */
export async function getDocumentLinks(
  processingDocumentId: string
): Promise<LinkedDocumentInfo[]> {
  // Get links where this doc is the source
  const sourceLinks = await prisma.documentLink.findMany({
    where: { sourceDocumentId: processingDocumentId },
    include: {
      targetDocument: {
        include: {
          document: { select: { fileName: true } },
          currentRevision: {
            select: {
              status: true,
              documentCategory: true,
              vendorName: true,
              documentNumber: true,
              totalAmount: true,
              currency: true,
            },
          },
        },
      },
    },
    orderBy: { linkedAt: 'desc' },
  });

  // Get links where this doc is the target
  const targetLinks = await prisma.documentLink.findMany({
    where: { targetDocumentId: processingDocumentId },
    include: {
      sourceDocument: {
        include: {
          document: { select: { fileName: true } },
          currentRevision: {
            select: {
              status: true,
              documentCategory: true,
              vendorName: true,
              documentNumber: true,
              totalAmount: true,
              currency: true,
            },
          },
        },
      },
    },
    orderBy: { linkedAt: 'desc' },
  });

  const results: LinkedDocumentInfo[] = [];

  // Process source links (this doc links TO these docs)
  for (const link of sourceLinks) {
    const doc = link.targetDocument;
    results.push({
      id: doc.id,
      documentId: doc.documentId,
      fileName: doc.document.fileName,
      pipelineStatus: doc.pipelineStatus,
      documentCategory: doc.currentRevision?.documentCategory || null,
      vendorName: doc.currentRevision?.vendorName || null,
      documentNumber: doc.currentRevision?.documentNumber || null,
      totalAmount: doc.currentRevision?.totalAmount?.toString() || null,
      currency: doc.currentRevision?.currency || null,
      revisionStatus: doc.currentRevision?.status || null,
      linkId: link.id,
      linkType: link.linkType,
      linkDirection: 'target',
      notes: link.notes,
      linkedAt: link.linkedAt,
    });
  }

  // Process target links (these docs link TO this doc)
  for (const link of targetLinks) {
    const doc = link.sourceDocument;
    results.push({
      id: doc.id,
      documentId: doc.documentId,
      fileName: doc.document.fileName,
      pipelineStatus: doc.pipelineStatus,
      documentCategory: doc.currentRevision?.documentCategory || null,
      vendorName: doc.currentRevision?.vendorName || null,
      documentNumber: doc.currentRevision?.documentNumber || null,
      totalAmount: doc.currentRevision?.totalAmount?.toString() || null,
      currency: doc.currentRevision?.currency || null,
      revisionStatus: doc.currentRevision?.status || null,
      linkId: link.id,
      linkType: link.linkType,
      linkDirection: 'source',
      notes: link.notes,
      linkedAt: link.linkedAt,
    });
  }

  // Sort by linked date (newest first)
  results.sort((a, b) => b.linkedAt.getTime() - a.linkedAt.getTime());

  return results;
}

// ============================================================================
// Delete Link
// ============================================================================

/**
 * Delete a document link
 */
export async function deleteDocumentLink(
  linkId: string,
  userId: string
): Promise<void> {
  const link = await prisma.documentLink.findUnique({
    where: { id: linkId },
  });

  if (!link) {
    throw new Error('Link not found');
  }

  await prisma.documentLink.delete({
    where: { id: linkId },
  });

  log.info(`Deleted document link ${linkId} by user ${userId}`);
}

// ============================================================================
// Update Link
// ============================================================================

/**
 * Update a document link's notes or type
 */
export async function updateDocumentLink(
  linkId: string,
  updates: { linkType?: DocumentLinkType; notes?: string | null },
  userId: string
): Promise<DocumentLinkResult> {
  const link = await prisma.documentLink.findUnique({
    where: { id: linkId },
  });

  if (!link) {
    throw new Error('Link not found');
  }

  const updatedLink = await prisma.documentLink.update({
    where: { id: linkId },
    data: {
      linkType: updates.linkType ?? link.linkType,
      notes: updates.notes !== undefined ? updates.notes : link.notes,
    },
  });

  log.info(`Updated document link ${linkId} by user ${userId}`);

  return {
    id: updatedLink.id,
    sourceDocumentId: updatedLink.sourceDocumentId,
    targetDocumentId: updatedLink.targetDocumentId,
    linkType: updatedLink.linkType,
    notes: updatedLink.notes,
    linkedById: updatedLink.linkedById,
    linkedAt: updatedLink.linkedAt,
  };
}

// ============================================================================
// Search Linkable Documents
// ============================================================================

/**
 * Search for documents that can be linked to the given document
 * Excludes already-linked documents and the document itself
 */
export async function searchLinkableDocuments(
  processingDocumentId: string,
  tenantId: string,
  companyId: string | null,
  searchQuery?: string,
  limit: number = 20
): Promise<Array<{
  id: string;
  fileName: string;
  documentCategory: string | null;
  vendorName: string | null;
  documentNumber: string | null;
  totalAmount: string | null;
  currency: string | null;
  createdAt: Date;
}>> {
  // Get already linked document IDs
  const existingLinks = await prisma.documentLink.findMany({
    where: {
      OR: [
        { sourceDocumentId: processingDocumentId },
        { targetDocumentId: processingDocumentId },
      ],
    },
    select: {
      sourceDocumentId: true,
      targetDocumentId: true,
    },
  });

  const linkedDocIds = new Set<string>();
  linkedDocIds.add(processingDocumentId); // Exclude self
  for (const link of existingLinks) {
    linkedDocIds.add(link.sourceDocumentId);
    linkedDocIds.add(link.targetDocumentId);
  }

  // Build search conditions
  const whereConditions: Prisma.ProcessingDocumentWhereInput = {
    id: { notIn: Array.from(linkedDocIds) },
    deletedAt: null,
    document: {
      tenantId,
      ...(companyId ? { companyId } : {}),
      deletedAt: null,
    },
    // Only show documents with extraction done
    pipelineStatus: 'EXTRACTION_DONE',
  };

  // Add search query if provided
  if (searchQuery && searchQuery.trim()) {
    const query = searchQuery.trim();
    whereConditions.OR = [
      { document: { fileName: { contains: query, mode: 'insensitive' } } },
      { currentRevision: { vendorName: { contains: query, mode: 'insensitive' } } },
      { currentRevision: { documentNumber: { contains: query, mode: 'insensitive' } } },
    ];
  }

  const documents = await prisma.processingDocument.findMany({
    where: whereConditions,
    include: {
      document: { select: { fileName: true } },
      currentRevision: {
        select: {
          documentCategory: true,
          vendorName: true,
          documentNumber: true,
          totalAmount: true,
          currency: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return documents.map((doc) => ({
    id: doc.id,
    fileName: doc.document.fileName,
    documentCategory: doc.currentRevision?.documentCategory || null,
    vendorName: doc.currentRevision?.vendorName || null,
    documentNumber: doc.currentRevision?.documentNumber || null,
    totalAmount: doc.currentRevision?.totalAmount?.toString() || null,
    currency: doc.currentRevision?.currency || null,
    createdAt: doc.createdAt,
  }));
}
