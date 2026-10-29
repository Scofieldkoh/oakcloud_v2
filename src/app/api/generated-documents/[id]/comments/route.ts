import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { createDocumentCommentSchema } from '@/lib/validations/generated-document';
import {
  createDocumentComment,
  resolveComment,
  hideComment,
  unhideComment,
  getGeneratedDocumentById,
} from '@/services/document-generator.service';
import { prisma } from '@/lib/prisma';
import { createErrorResponse, requireSessionWorkspaceId } from '@/lib/api-helpers';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/generated-documents/[id]/comments
 * Get all comments for a document
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { id } = await params;

    // Check read permission
    await requirePermission(session, 'document', 'read');

    const { searchParams } = new URL(request.url);
    const tenantId = requireSessionWorkspaceId(session);

    // Verify document exists and belongs to the current workspace.
    const document = await getGeneratedDocumentById(id, tenantId);
    if (!document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    const includeHidden = searchParams.get('includeHidden') === 'true' && session.isWorkspaceAdmin;

    // Get comments (top-level with replies)
    const comments = await prisma.documentComment.findMany({
      where: {
        documentId: id,
        parentId: null,
        deletedAt: null,
        ...(includeHidden ? {} : { hiddenAt: null }),
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
        replies: {
          where: {
            deletedAt: null,
            ...(includeHidden ? {} : { hiddenAt: null }),
          },
          orderBy: { createdAt: 'asc' },
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
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
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(comments);
  } catch (error) {
    return createErrorResponse(error);
  }
}

/**
 * POST /api/generated-documents/[id]/comments
 * Create a comment on a document (internal user)
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    const { id } = await params;

    // Check update permission
    await requirePermission(session, 'document', 'update');

    const body = await request.json();
    const data = createDocumentCommentSchema.parse({ ...body, documentId: id });

    const tenantId = requireSessionWorkspaceId(session);

    // Get IP address
    const ipAddress =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') ||
      null;

    const comment = await createDocumentComment(data, ipAddress, {
      tenantId,
      userId: session.id,
    });

    return NextResponse.json(comment, { status: 201 });
  } catch (error) {
    return createErrorResponse(error);
  }
}

/**
 * PATCH /api/generated-documents/[id]/comments
 * Resolve, hide, or unhide a comment
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    await params; // Validate route exists

    // Check update permission
    await requirePermission(session, 'document', 'update');

    const body = await request.json();
    const { action, commentId, reason } = body;

    if (!commentId) {
      return NextResponse.json({ error: 'Comment ID is required' }, { status: 400 });
    }

    const tenantId = requireSessionWorkspaceId(session);

    let comment;

    switch (action) {
      case 'resolve':
        comment = await resolveComment(commentId, { tenantId, userId: session.id });
        break;
      case 'hide':
        if (!reason) {
          return NextResponse.json(
            { error: 'Reason is required for hiding a comment' },
            { status: 400 }
          );
        }
        comment = await hideComment(commentId, reason, { tenantId, userId: session.id });
        break;
      case 'unhide':
        comment = await unhideComment(commentId, { tenantId, userId: session.id });
        break;
      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    return NextResponse.json(comment);
  } catch (error) {
    return createErrorResponse(error);
  }
}
