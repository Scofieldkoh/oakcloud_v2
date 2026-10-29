/**
 * Document Comment Service
 *
 * Manages comments and annotations on generated documents for review workflows.
 * Supports internal document review comments.
 *
 * Features:
 * - Internal comments (authenticated users)
 * - Text selection highlighting
 * - Comment threading (replies)
 * - Resolve/reopen workflow
 * - Moderation (hide/unhide)
 */

import { prisma } from '@/lib/prisma';
import { createAuditContext, logCreate, logUpdate, logDelete } from '@/lib/audit';
import { MAX_COMMENT_LENGTH } from '@/lib/constants/application';
import { Prisma } from '@/generated/prisma';
import type { DocumentComment } from '@/generated/prisma';

// ============================================================================
// Types
// ============================================================================

// Comment with relations
export interface CommentWithRelations extends DocumentComment {
  user?: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  } | null;
  resolvedBy?: {
    id: string;
    firstName: string;
    lastName: string;
  } | null;
  hiddenBy?: {
    id: string;
    firstName: string;
    lastName: string;
  } | null;
  replies?: CommentWithRelations[];
  _count?: {
    replies: number;
  };
}

// Input for creating internal comments (authenticated users)
export interface CreateInternalCommentInput {
  documentId: string;
  content: string;
  selectionStart?: number;
  selectionEnd?: number;
  selectedText?: string;
  parentId?: string;
}

// Input for updating a comment
export interface UpdateCommentInput {
  content: string;
}

// ============================================================================
// Include definitions for queries
// ============================================================================

const commentInclude = {
  user: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
    },
  },
  resolvedBy: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
    },
  },
  hiddenBy: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
    },
  },
  _count: {
    select: {
      replies: true,
    },
  },
} satisfies Prisma.DocumentCommentInclude;

const commentWithRepliesInclude = {
  ...commentInclude,
  replies: {
    where: { deletedAt: null },
    include: commentInclude,
    orderBy: { createdAt: 'asc' as const },
  },
};

// ============================================================================
// Internal Comment Functions (Authenticated)
// ============================================================================

/**
 * Create an internal comment (authenticated user)
 */
export async function createComment(
  tenantId: string,
  userId: string,
  input: CreateInternalCommentInput
): Promise<CommentWithRelations> {
  // Validate content length
  if (input.content.length > MAX_COMMENT_LENGTH) {
    throw new Error(`Comment cannot exceed ${MAX_COMMENT_LENGTH} characters`);
  }

  // Verify document exists and belongs to tenant
  const document = await prisma.generatedDocument.findFirst({
    where: {
      id: input.documentId,
      tenantId,
      deletedAt: null,
    },
  });

  if (!document) {
    throw new Error('Document not found');
  }

  // If parentId provided, verify parent exists
  if (input.parentId) {
    const parent = await prisma.documentComment.findFirst({
      where: {
        id: input.parentId,
        documentId: input.documentId,
        deletedAt: null,
      },
    });

    if (!parent) {
      throw new Error('Parent comment not found');
    }
  }

  const comment = await prisma.documentComment.create({
    data: {
      documentId: input.documentId,
      userId,
      content: input.content,
      selectionStart: input.selectionStart,
      selectionEnd: input.selectionEnd,
      selectedText: input.selectedText,
      parentId: input.parentId,
      status: 'OPEN',
    },
    include: commentInclude,
  });

  // Audit log
  const ctx = await createAuditContext({
    tenantId,
    userId,
    changeSource: 'MANUAL',
  });

  await logCreate(ctx, 'DocumentComment', comment.id, undefined, {
    documentId: input.documentId,
    hasSelection: !!input.selectedText,
    isReply: !!input.parentId,
  });

  return comment as CommentWithRelations;
}

/**
 * Update a comment (only author can update)
 */
export async function updateComment(
  tenantId: string,
  userId: string,
  commentId: string,
  input: UpdateCommentInput
): Promise<CommentWithRelations> {
  // Validate content length
  if (input.content.length > MAX_COMMENT_LENGTH) {
    throw new Error(`Comment cannot exceed ${MAX_COMMENT_LENGTH} characters`);
  }

  // Find comment and verify ownership
  const comment = await prisma.documentComment.findFirst({
    where: {
      id: commentId,
      deletedAt: null,
    },
    include: {
      document: { select: { tenantId: true } },
    },
  });

  if (!comment || comment.document.tenantId !== tenantId) {
    throw new Error('Comment not found');
  }

  if (comment.userId !== userId) {
    throw new Error('Only the author can edit this comment');
  }

  if (comment.status === 'RESOLVED') {
    throw new Error('Cannot edit a resolved comment');
  }

  const updated = await prisma.documentComment.update({
    where: { id: commentId },
    data: {
      content: input.content,
      updatedAt: new Date(),
    },
    include: commentInclude,
  });

  // Audit log
  const ctx = await createAuditContext({
    tenantId,
    userId,
    changeSource: 'MANUAL',
  });

  await logUpdate(ctx, 'DocumentComment', commentId, {
    content: { old: comment.content, new: input.content },
  });

  return updated as CommentWithRelations;
}

/**
 * Delete a comment (soft delete)
 */
export async function deleteComment(
  tenantId: string,
  userId: string,
  commentId: string
): Promise<void> {
  // Find comment
  const comment = await prisma.documentComment.findFirst({
    where: {
      id: commentId,
      deletedAt: null,
    },
    include: {
      document: { select: { tenantId: true } },
    },
  });

  if (!comment || comment.document.tenantId !== tenantId) {
    throw new Error('Comment not found');
  }

  // Only author or tenant admin can delete
  // Check if user is the author
  const isAuthor = comment.userId === userId;

  // Check if user is tenant admin - simplified check
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      roleAssignments: {
        include: {
          role: { select: { systemRoleType: true } },
        },
      },
    },
  });

  const isWorkspaceAdmin = user?.roleAssignments.some(
    (ra: { role: { systemRoleType: string | null } }) =>
      ra.role.systemRoleType === 'ADMIN' ||
      ra.role.systemRoleType === 'TENANT_ADMIN' ||
      ra.role.systemRoleType === 'SUPER_ADMIN'
  );

  if (!isAuthor && !isWorkspaceAdmin) {
    throw new Error('Only the author or admin can delete this comment');
  }

  // Soft delete
  await prisma.documentComment.update({
    where: { id: commentId },
    data: { deletedAt: new Date() },
  });

  // Audit log
  const ctx = await createAuditContext({
    tenantId,
    userId,
    changeSource: 'MANUAL',
  });

  await logDelete(ctx, 'DocumentComment', commentId, 'Comment', 'User deleted comment');
}

/**
 * Resolve a comment
 */
export async function resolveComment(
  tenantId: string,
  userId: string,
  commentId: string
): Promise<CommentWithRelations> {
  const comment = await prisma.documentComment.findFirst({
    where: {
      id: commentId,
      deletedAt: null,
    },
    include: {
      document: { select: { tenantId: true } },
    },
  });

  if (!comment || comment.document.tenantId !== tenantId) {
    throw new Error('Comment not found');
  }

  if (comment.status === 'RESOLVED') {
    throw new Error('Comment is already resolved');
  }

  const updated = await prisma.documentComment.update({
    where: { id: commentId },
    data: {
      status: 'RESOLVED',
      resolvedById: userId,
      resolvedAt: new Date(),
    },
    include: commentInclude,
  });

  // Audit log
  const ctx = await createAuditContext({
    tenantId,
    userId,
    changeSource: 'MANUAL',
  });

  await logUpdate(ctx, 'DocumentComment', commentId, {
    status: { old: 'OPEN', new: 'RESOLVED' },
  });

  return updated as CommentWithRelations;
}

/**
 * Reopen a resolved comment
 */
export async function reopenComment(
  tenantId: string,
  userId: string,
  commentId: string
): Promise<CommentWithRelations> {
  const comment = await prisma.documentComment.findFirst({
    where: {
      id: commentId,
      deletedAt: null,
    },
    include: {
      document: { select: { tenantId: true } },
    },
  });

  if (!comment || comment.document.tenantId !== tenantId) {
    throw new Error('Comment not found');
  }

  if (comment.status !== 'RESOLVED') {
    throw new Error('Comment is not resolved');
  }

  const updated = await prisma.documentComment.update({
    where: { id: commentId },
    data: {
      status: 'OPEN',
      resolvedById: null,
      resolvedAt: null,
    },
    include: commentInclude,
  });

  // Audit log
  const ctx = await createAuditContext({
    tenantId,
    userId,
    changeSource: 'MANUAL',
  });

  await logUpdate(ctx, 'DocumentComment', commentId, {
    status: { old: 'RESOLVED', new: 'OPEN' },
  });

  return updated as CommentWithRelations;
}

/**
 * Get all comments for a document
 */
export async function getDocumentComments(
  tenantId: string,
  documentId: string,
  options: {
    includeResolved?: boolean;
    includeHidden?: boolean;
    includeReplies?: boolean;
  } = {}
): Promise<CommentWithRelations[]> {
  const { includeResolved = false, includeHidden = false, includeReplies = true } = options;

  // Verify document belongs to tenant
  const document = await prisma.generatedDocument.findFirst({
    where: {
      id: documentId,
      tenantId,
      deletedAt: null,
    },
  });

  if (!document) {
    throw new Error('Document not found');
  }

  const where: Prisma.DocumentCommentWhereInput = {
    documentId,
    deletedAt: null,
    parentId: null, // Only top-level comments
  };

  if (!includeResolved) {
    where.status = 'OPEN';
  }

  if (!includeHidden) {
    where.hiddenAt = null;
  }

  const comments = await prisma.documentComment.findMany({
    where,
    include: includeReplies ? commentWithRepliesInclude : commentInclude,
    orderBy: { createdAt: 'desc' },
  });

  return comments as CommentWithRelations[];
}

/**
 * Get a single comment by ID
 */
export async function getComment(
  tenantId: string,
  commentId: string
): Promise<CommentWithRelations | null> {
  const comment = await prisma.documentComment.findFirst({
    where: {
      id: commentId,
      deletedAt: null,
    },
    include: {
      ...commentWithRepliesInclude,
      document: { select: { tenantId: true } },
    },
  });

  if (!comment || comment.document.tenantId !== tenantId) {
    return null;
  }

  return comment as CommentWithRelations;
}

// ============================================================================
// Moderation Functions
// ============================================================================

/**
 * Hide a comment (moderation)
 */
export async function hideComment(
  tenantId: string,
  userId: string,
  commentId: string,
  reason?: string
): Promise<CommentWithRelations> {
  const comment = await prisma.documentComment.findFirst({
    where: {
      id: commentId,
      deletedAt: null,
    },
    include: {
      document: { select: { tenantId: true } },
    },
  });

  if (!comment || comment.document.tenantId !== tenantId) {
    throw new Error('Comment not found');
  }

  if (comment.hiddenAt) {
    throw new Error('Comment is already hidden');
  }

  const updated = await prisma.documentComment.update({
    where: { id: commentId },
    data: {
      hiddenAt: new Date(),
      hiddenById: userId,
      hiddenReason: reason,
    },
    include: commentInclude,
  });

  // Audit log
  const ctx = await createAuditContext({
    tenantId,
    userId,
    changeSource: 'MANUAL',
  });

  await logUpdate(ctx, 'DocumentComment', commentId, {
    hidden: { old: false, new: true },
    hiddenReason: { old: null, new: reason || null },
  });

  return updated as CommentWithRelations;
}

/**
 * Unhide a previously hidden comment
 */
export async function unhideComment(
  tenantId: string,
  userId: string,
  commentId: string
): Promise<CommentWithRelations> {
  const comment = await prisma.documentComment.findFirst({
    where: {
      id: commentId,
      deletedAt: null,
    },
    include: {
      document: { select: { tenantId: true } },
    },
  });

  if (!comment || comment.document.tenantId !== tenantId) {
    throw new Error('Comment not found');
  }

  if (!comment.hiddenAt) {
    throw new Error('Comment is not hidden');
  }

  const updated = await prisma.documentComment.update({
    where: { id: commentId },
    data: {
      hiddenAt: null,
      hiddenById: null,
      hiddenReason: null,
    },
    include: commentInclude,
  });

  // Audit log
  const ctx = await createAuditContext({
    tenantId,
    userId,
    changeSource: 'MANUAL',
  });

  await logUpdate(ctx, 'DocumentComment', commentId, {
    hidden: { old: true, new: false },
  });

  return updated as CommentWithRelations;
}

// ============================================================================
// Statistics
// ============================================================================

/**
 * Get comment statistics for a document
 */
export async function getDocumentCommentStats(
  tenantId: string,
  documentId: string
): Promise<{
  total: number;
  open: number;
  resolved: number;
  hidden: number;
}> {
  // Verify document belongs to tenant
  const document = await prisma.generatedDocument.findFirst({
    where: {
      id: documentId,
      tenantId,
      deletedAt: null,
    },
  });

  if (!document) {
    throw new Error('Document not found');
  }

  const [total, open, resolved, hidden] = await Promise.all([
    prisma.documentComment.count({
      where: { documentId, deletedAt: null },
    }),
    prisma.documentComment.count({
      where: { documentId, deletedAt: null, status: 'OPEN', hiddenAt: null },
    }),
    prisma.documentComment.count({
      where: { documentId, deletedAt: null, status: 'RESOLVED' },
    }),
    prisma.documentComment.count({
      where: { documentId, deletedAt: null, hiddenAt: { not: null } },
    }),
  ]);

  return { total, open, resolved, hidden };
}
