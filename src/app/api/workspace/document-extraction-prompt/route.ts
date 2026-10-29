import { NextResponse } from 'next/server';
import { z } from 'zod';
import { canManageWorkspace, requireAuth } from '@/lib/auth';
import { routeErrorResponse } from '@/lib/api-route-errors';
import {
  DOCUMENT_EXTRACTION_PROMPT_VARIABLES,
  getDocumentExtractionPromptSettings,
  updateDocumentExtractionPromptSettings,
} from '@/services/document-extraction-prompt-settings.service';

const quickContextSchema = z.object({
  id: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(40),
  value: z.string().trim().min(1).max(1000),
});

const updatePromptSettingsSchema = z.object({
  promptTemplate: z.string().trim().min(1).max(30000).optional(),
  quickContexts: z.array(quickContextSchema).max(12).optional(),
});

function jsonError(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}

function settingsResponse(settings: Awaited<ReturnType<typeof getDocumentExtractionPromptSettings>>) {
  return NextResponse.json({
    success: true,
    data: {
      ...settings,
      variables: DOCUMENT_EXTRACTION_PROMPT_VARIABLES,
    },
  });
}

export async function GET() {
  try {
    const session = await requireAuth();
    const workspaceId = session.tenantId;

    if (!workspaceId) {
      return jsonError(400, 'Workspace context required');
    }

    const settings = await getDocumentExtractionPromptSettings(workspaceId);
    return settingsResponse(settings);
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await requireAuth();
    const workspaceId = session.tenantId;

    if (!workspaceId) {
      return jsonError(400, 'Workspace context required');
    }

    if (!canManageWorkspace(session, workspaceId)) {
      return jsonError(403, 'Forbidden');
    }

    const parsed = updatePromptSettingsSchema.parse(await request.json());
    const settings = await updateDocumentExtractionPromptSettings(workspaceId, parsed);

    return settingsResponse(settings);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(400, error.issues[0]?.message || 'Invalid request');
    }
    return routeErrorResponse(error);
  }
}
