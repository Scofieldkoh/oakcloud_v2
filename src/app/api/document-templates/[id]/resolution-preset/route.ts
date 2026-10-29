import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/rbac';
import { createErrorResponse, requireSessionWorkspaceId } from '@/lib/api-helpers';
import { updateResolutionPresetSchema } from '@/lib/validations/document-template';
import { setDocumentTemplateResolutionPreset } from '@/services/document-template.service';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * PUT /api/document-templates/[id]/resolution-preset
 * Save the resolutions a resolution template pre-fills on Configure
 * ({ resolutionPreset: { subject, sections } | null }).
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAuth();
    await requirePermission(session, 'document', 'update');
    const tenantId = requireSessionWorkspaceId(session);
    const { id } = await params;

    const { resolutionPreset } = updateResolutionPresetSchema.parse(await request.json());
    const template = await setDocumentTemplateResolutionPreset(id, resolutionPreset, {
      tenantId,
      userId: session.id,
    });
    return NextResponse.json({
      id: template.id,
      resolutionPreset: template.resolutionPreset,
      revision: template.version,
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}
