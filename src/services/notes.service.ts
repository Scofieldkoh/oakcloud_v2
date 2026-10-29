/**
 * Notes Service
 *
 * Business logic for managing internal notes with multi-tab support.
 * Handles CRUD operations for note tabs on companies and contacts.
 */

import { prisma } from '@/lib/prisma';
import { createAuditLog, type AuditContext } from '@/lib/audit';
import type { NoteTab, Prisma } from '@/generated/prisma';

// ============================================================================
// Types
// ============================================================================

export type EntityType = 'company' | 'contact';

function buildEntityWhere(
  entityType: EntityType,
  entityId: string,
  tenantId?: string
): Prisma.NoteTabWhereInput {
  const entityScope =
    entityType === 'company' ? { companyId: entityId } : { contactId: entityId };

  if (!tenantId) {
    return entityScope;
  }

  return entityType === 'company'
    ? { ...entityScope, company: { tenantId, deletedAt: null } }
    : { ...entityScope, contact: { tenantId, deletedAt: null } };
}

export interface NoteTabData {
  id: string;
  title: string;
  content: string | null;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateNoteTabInput {
  title?: string;
  content?: string;
}

export interface UpdateNoteTabInput {
  title?: string;
  content?: string;
}

// ============================================================================
// Query Functions
// ============================================================================

/**
 * Get all note tabs for an entity (company or contact)
 */
export async function getNoteTabs(
  entityType: EntityType,
  entityId: string,
  tenantId?: string
): Promise<NoteTabData[]> {
  const tabs = await prisma.noteTab.findMany({
    where: buildEntityWhere(entityType, entityId, tenantId),
    orderBy: { order: 'asc' },
  });

  return tabs;
}

/**
 * Get a single note tab by ID
 */
export async function getNoteTabById(tabId: string): Promise<NoteTab | null> {
  return prisma.noteTab.findUnique({
    where: { id: tabId },
  });
}

// ============================================================================
// Mutation Functions
// ============================================================================

/**
 * Create a new note tab
 */
export async function createNoteTab(
  entityType: EntityType,
  entityId: string,
  input: CreateNoteTabInput,
  auditContext?: AuditContext,
  tenantId?: string
): Promise<NoteTab> {
  // Guard against cross-tenant note creation when tenant context is provided.
  if (tenantId) {
    const entity = entityType === 'company'
      ? await prisma.company.findFirst({
          where: { id: entityId, tenantId, deletedAt: null },
          select: { id: true },
        })
      : await prisma.contact.findFirst({
          where: { id: entityId, tenantId, deletedAt: null },
          select: { id: true },
        });

    if (!entity) {
      throw new Error('Parent entity not found');
    }
  }

  // Get the next order number
  const maxOrder = await prisma.noteTab.aggregate({
    where: buildEntityWhere(entityType, entityId, tenantId),
    _max: { order: true },
  });

  const nextOrder = (maxOrder._max.order ?? -1) + 1;

  const data: Parameters<typeof prisma.noteTab.create>[0]['data'] = {
    title: input.title || 'General',
    content: input.content || null,
    order: nextOrder,
    ...(entityType === 'company'
      ? { company: { connect: { id: entityId } } }
      : { contact: { connect: { id: entityId } } }),
  };

  const tab = await prisma.noteTab.create({ data });

  // Audit log
  if (auditContext) {
    await createAuditLog({
      ...auditContext,
      action: 'CREATE',
      entityType: 'NoteTab',
      entityId: tab.id,
      entityName: tab.title,
      metadata: { title: tab.title, parentEntityType: entityType, parentEntityId: entityId },
    });
  }

  return tab;
}

/**
 * Update a note tab (title or content)
 */
export async function updateNoteTab(
  tabId: string,
  input: UpdateNoteTabInput,
  auditContext?: AuditContext
): Promise<NoteTab> {
  const existingTab = await prisma.noteTab.findUnique({
    where: { id: tabId },
  });

  if (!existingTab) {
    throw new Error('Note tab not found');
  }

  const updateData: Parameters<typeof prisma.noteTab.update>[0]['data'] = {};

  if (input.title !== undefined) {
    updateData.title = input.title;
  }
  if (input.content !== undefined) {
    updateData.content = input.content;
  }

  const tab = await prisma.noteTab.update({
    where: { id: tabId },
    data: updateData,
  });

  // Audit log
  if (auditContext) {
    const changes: Record<string, { old: unknown; new: unknown }> = {};
    if (input.title !== undefined && input.title !== existingTab.title) {
      changes.title = { old: existingTab.title, new: input.title };
    }
    // Log content changes with truncated preview for better audit visibility
    if (input.content !== undefined && input.content !== existingTab.content) {
      // Strip HTML tags for preview
      const stripHtml = (html: string | null) => {
        if (!html) return '';
        return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      };
      const oldPreview = stripHtml(existingTab.content);
      const newPreview = stripHtml(input.content);
      // Truncate to 100 chars for preview
      const truncate = (str: string, len: number) =>
        str.length > len ? str.substring(0, len) + '...' : str;
      changes.content = {
        old: oldPreview ? truncate(oldPreview, 100) : '[empty]',
        new: newPreview ? truncate(newPreview, 100) : '[empty]',
      };
    }

    if (Object.keys(changes).length > 0) {
      await createAuditLog({
        ...auditContext,
        action: 'UPDATE',
        entityType: 'NoteTab',
        entityId: tabId,
        entityName: tab.title,
        changes,
      });
    }
  }

  return tab;
}

/**
 * Delete a note tab
 */
export async function deleteNoteTab(
  tabId: string,
  auditContext?: AuditContext
): Promise<void> {
  const tab = await prisma.noteTab.findUnique({
    where: { id: tabId },
  });

  if (!tab) {
    throw new Error('Note tab not found');
  }

  await prisma.noteTab.delete({
    where: { id: tabId },
  });

  // Audit log
  if (auditContext) {
    await createAuditLog({
      ...auditContext,
      action: 'DELETE',
      entityType: 'NoteTab',
      entityId: tabId,
      entityName: tab.title,
    });
  }
}

/**
 * Reorder note tabs
 */
export async function reorderNoteTabs(
  tabIds: string[],
  auditContext?: AuditContext
): Promise<void> {
  await prisma.$transaction(
    tabIds.map((id, index) =>
      prisma.noteTab.update({
        where: { id },
        data: { order: index },
      })
    )
  );

  if (auditContext) {
    await createAuditLog({
      ...auditContext,
      action: 'UPDATE',
      entityType: 'NoteTab',
      entityId: tabIds[0],
      metadata: { reordered: tabIds },
    });
  }
}

/**
 * Check if a note tab belongs to an entity
 */
export async function verifyNoteTabOwnership(
  tabId: string,
  entityType: EntityType,
  entityId: string,
  tenantId?: string
): Promise<boolean> {
  const tab = await prisma.noteTab.findUnique({
    where: { id: tabId },
    include: {
      company: { select: { tenantId: true, deletedAt: true } },
      contact: { select: { tenantId: true, deletedAt: true } },
    },
  });

  if (!tab) return false;

  if (entityType === 'company') {
    return (
      tab.companyId === entityId &&
      (!tenantId || (tab.company?.tenantId === tenantId && tab.company.deletedAt === null))
    );
  } else {
    return (
      tab.contactId === entityId &&
      (!tenantId || (tab.contact?.tenantId === tenantId && tab.contact.deletedAt === null))
    );
  }
}
