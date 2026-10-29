import { NextRequest } from 'next/server';
import { applyConversationAction } from '@/services/business-assistant/conversation.service';
import { handleAssistantError, noStore, readJson, routeActor } from '../../../_helpers';

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await readJson(request);
    const actor = await routeActor(request, request.nextUrl.searchParams.get('workspaceId'));
    const conversation = await applyConversationAction(actor, id, body);
    return noStore({ conversation });
  } catch (error) {
    return handleAssistantError(error);
  }
}
