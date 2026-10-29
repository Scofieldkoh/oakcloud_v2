import { NextRequest, NextResponse } from 'next/server';
import { routeErrorResponse } from '@/lib/api-route-errors';
import { requireAuth } from '@/lib/auth';
import { z } from 'zod';
import {
  getRecentConversations,
  deleteConversation,
} from '@/services/document-ai.service';

// ============================================================================
// GET /api/ai/conversations - Get recent conversations
// ============================================================================

const getQuerySchema = z.object({
  contextType: z.enum(['template', 'document']),
  contextId: z.string().optional(),
  limit: z.coerce.number().min(1).max(50).optional().default(10),
});

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();

    // Ensure tenant ID is present
    if (!session.tenantId) {
      return NextResponse.json({ error: 'Tenant context required' }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const parsed = getQuerySchema.safeParse({
      contextType: searchParams.get('contextType'),
      contextId: searchParams.get('contextId'),
      limit: searchParams.get('limit'),
    });

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid query parameters', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { contextType, contextId, limit } = parsed.data;

    const conversations = await getRecentConversations(
      session.tenantId,
      session.id,
      contextType,
      contextId,
      limit
    );

    return NextResponse.json({
      conversations: conversations.map((conv) => ({
        id: conv.id,
        contextType: conv.contextType,
        contextId: conv.contextId,
        messageCount: conv.messages.length,
        lastMessage: conv.messages[conv.messages.length - 1]?.content?.substring(0, 100),
        createdAt: conv.createdAt.toISOString(),
        updatedAt: conv.updatedAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error('Get conversations error:', error);
    return routeErrorResponse(error);
  }
}

// ============================================================================
// DELETE /api/ai/conversations - Delete a conversation
// ============================================================================

const deleteSchema = z.object({
  conversationId: z.string().min(1, 'Conversation ID is required'),
});

export async function DELETE(request: NextRequest) {
  try {
    await requireAuth();

    const body = await request.json();
    const parsed = deleteSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    await deleteConversation(parsed.data.conversationId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete conversation error:', error);
    return routeErrorResponse(error);
  }
}
