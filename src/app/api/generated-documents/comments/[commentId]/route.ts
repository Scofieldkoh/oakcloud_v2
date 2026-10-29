import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { createErrorResponse, requireSessionWorkspaceId } from '@/lib/api-helpers';
import { z } from 'zod';
import {
  getComment,
  updateComment,
  deleteComment,
  resolveComment,
  reopenComment,
  hideComment,
  unhideComment,
} from '@/services/document-comment.service';

interface RouteParams {
  params: Promise<{ commentId: string }>;
}

// ============================================================================
// Validation Schemas
// ============================================================================

const updateCommentSchema = z.object({
  content: z.string().min(1).max(1000),
});

const actionSchema = z.object({
  action: z.enum(['resolve', 'reopen', 'hide', 'unhide']),
  reason: z.string().max(255).optional(),
});

// ============================================================================
// GET /api/generated-documents/comments/[commentId]
// Get a single comment
// ============================================================================

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { commentId } = await params;

    await requirePermission(session, 'document', 'read');

    const tenantId = requireSessionWorkspaceId(session);

    const comment = await getComment(tenantId, commentId);

    if (!comment) {
      return NextResponse.json({ error: 'Comment not found' }, { status: 404 });
    }

    return NextResponse.json(comment);
  } catch (error) {
    return createErrorResponse(error);
  }
}

// ============================================================================
// PATCH /api/generated-documents/comments/[commentId]
// Update a comment or perform an action
// ============================================================================

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { commentId } = await params;

    const tenantId = requireSessionWorkspaceId(session);

    const body = await request.json();

    // Check if this is an action (resolve, reopen, hide, unhide)
    if (body.action) {
      await requirePermission(session, 'document', 'update');

      const { action, reason } = actionSchema.parse(body);

      let result;
      switch (action) {
        case 'resolve':
          result = await resolveComment(tenantId, session.id, commentId);
          break;
        case 'reopen':
          result = await reopenComment(tenantId, session.id, commentId);
          break;
        case 'hide':
          result = await hideComment(tenantId, session.id, commentId, reason);
          break;
        case 'unhide':
          result = await unhideComment(tenantId, session.id, commentId);
          break;
      }

      return NextResponse.json(result);
    }

    // Regular content update
    await requirePermission(session, 'document', 'update');

    const { content } = updateCommentSchema.parse(body);

    const updated = await updateComment(tenantId, session.id, commentId, { content });

    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.flatten() },
        { status: 400 }
      );
    }
    return createErrorResponse(error);
  }
}

// ============================================================================
// DELETE /api/generated-documents/comments/[commentId]
// Delete a comment
// ============================================================================

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { commentId } = await params;

    await requirePermission(session, 'document', 'update');

    const tenantId = requireSessionWorkspaceId(session);

    await deleteComment(tenantId, session.id, commentId);

    return NextResponse.json({ success: true });
  } catch (error) {
    return createErrorResponse(error);
  }
}
